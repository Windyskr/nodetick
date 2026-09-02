import { Hono } from 'hono';
import { Env, Vars } from '../env.js';
import {
  createSession,
  destroySession,
  getSessionUser,
  issueApiToken,
} from '../auth.js';
import {
  genId,
  hashPassword,
  isSameOriginRequest,
  isStateChangingMethod,
  randomHex,
  RequestBodyTooLargeError,
  isRequestBodyTooLarge,
  timingSafeEqualStr,
} from '../util.js';
import {
  checkLoginAttempt,
  clearLoginAttempts,
  clientIp,
  consumeRegistrationAttempt,
  maybeTrimAuditLog,
  recordFailedLogin,
  REGISTRATION_WINDOW_MINUTES,
  writeAuditEvent,
} from '../services/security.js';
type State = { Bindings: Env; Variables: { userId?: string } };

export const web = new Hono<State>();

web.use('*', async (c, next) => {
  if (
    isStateChangingMethod(c.req.raw.method) &&
    !isSameOriginRequest(c.req.url, c.req.header('Origin'), c.req.header('Referer'))
  ) {
    return c.json({ error: 'Cross-origin request blocked' }, 403);
  }
  await next();
});

/**
 * JSON endpoints backing the SPA: session auth and personal API token
 * management. Cookie-based, same-origin only (SameSite=Lax plus the explicit
 * Origin/Referer check keeps these CSRF-safe without a per-session token).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_INVITE_LENGTH = 256;

const readJson = async (c: { req: { json: <T>() => Promise<T> } }) =>
  c.req.json<unknown>().then((value) => {
    if (isRequestBodyTooLarge(c.req)) throw new RequestBodyTooLargeError();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }).catch((error) => {
    if (error instanceof RequestBodyTooLargeError || isRequestBodyTooLarge(c.req)) {
      throw new RequestBodyTooLargeError();
    }
    return {} as Record<string, unknown>;
  });

web.post('/register', async (c) => {
  const registrationIp = clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For'));
  const registrationAttempt = await consumeRegistrationAttempt(c.env.DB, registrationIp);
  if (!registrationAttempt.allowed) {
    const retryAfter = registrationAttempt.retryAfterSeconds ?? REGISTRATION_WINDOW_MINUTES * 60;
    c.header('Retry-After', String(retryAfter));
    return c.json(
      { error: `Too many registration attempts. Try again in ${retryAfter} seconds.` },
      429,
    );
  }
  const b = await readJson(c);
  if (typeof b.email !== 'string' || typeof b.password !== 'string' ||
      (b.invite != null && typeof b.invite !== 'string')) {
    return c.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, 400);
  }
  const email = b.email.trim().toLowerCase();
  const password = b.password;
  const invite = b.invite ?? '';
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, 400);
  }
  if (invite.length > MAX_INVITE_LENGTH) {
    return c.json({ error: 'Registration requires a valid invite code.' }, 403);
  }
  const hasUsers = await c.env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
  const inviteValid = !!c.env.INVITE_CODE && await timingSafeEqualStr(invite, c.env.INVITE_CODE ?? '');
  if (hasUsers && !inviteValid) {
    return c.json({ error: 'Registration requires a valid invite code.' }, 403);
  }
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) {
    return c.json({ error: 'That email is already registered.' }, 409);
  }
  const salt = randomHex(16);
  const id = genId();
  const passwordHash = await hashPassword(password, salt);
  let inserted;
  try {
    // Determine first-user/admin status inside the INSERT. The pre-check above
    // is only for a fast error; this statement closes the concurrent
    // first-registration race where two requests both observe an empty table.
    inserted = await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, salt, is_admin, created_at)
       SELECT ?, ?, ?, ?, CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 1 ELSE 0 END, ?
       WHERE NOT EXISTS (SELECT 1 FROM users) OR ? = 1`,
    )
      .bind(id, email, passwordHash, salt, Date.now(), inviteValid ? 1 : 0)
      .run();
  } catch (error) {
    const duplicate = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (duplicate) return c.json({ error: 'That email is already registered.' }, 409);
    throw error;
  }
  if (!inserted.meta.changes) {
    return c.json({ error: 'Registration requires a valid invite code.' }, 403);
  }
  const created = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(id).first<{ is_admin: number }>();
  const isAdmin = !!created?.is_admin;
  await createSession(c, id);
  await writeAuditEvent(
    c.env.DB,
    { userId: id, action: isAdmin ? 'user.register.first_admin' : 'user.register', metadata: { email } },
    clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')),
  );
  return c.json({ ok: true, email, isAdmin });
});

web.post('/login', async (c) => {
  const b = await readJson(c);
  if (typeof b.email !== 'string' || typeof b.password !== 'string') {
    return c.json({ error: 'Invalid email or password.' }, 400);
  }
  const email = b.email.trim().toLowerCase();
  const password = b.password;
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: 'Invalid email or password.' }, 400);
  }
  const ip = clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For'));

  // Per-IP lockout after repeated failures (NodeWarden-style); an independent
  // account key is tracked too so rotating IPs cannot dodge the account lock.
  const attempt = await checkLoginAttempt(c.env.DB, ip, email);
  if (!attempt.allowed) {
    await writeAuditEvent(c.env.DB, { action: 'login.locked', level: 'security', metadata: { email } }, ip);
    c.header('Retry-After', String(attempt.retryAfterSeconds ?? 120));
    return c.json(
      { error: `Too many failed login attempts. Try again in ${attempt.retryAfterSeconds ?? 120} seconds.` },
      429,
    );
  }

  const user = await c.env.DB.prepare(
    'SELECT id, password_hash, salt, is_admin FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{
      id: string;
      password_hash: string;
      salt: string;
      is_admin: number;
    }>();
  if (user) {
    const hash = await hashPassword(password, user.salt);
    if (await timingSafeEqualStr(hash, user.password_hash)) {
      await clearLoginAttempts(c.env.DB, ip, email);
      await createSession(c, user.id);
      await writeAuditEvent(c.env.DB, { userId: user.id, action: 'login.success', metadata: { email } }, ip);
      return c.json({ ok: true, email, isAdmin: !!user.is_admin });
    }
  }
  const lock = await recordFailedLogin(c.env.DB, ip, email);
  await writeAuditEvent(
    c.env.DB,
    { action: lock.allowed ? 'login.failed' : 'login.locked', level: 'security', metadata: { email } },
    ip,
  );
  // Constant-ish response time on failure to blunt timing probes.
  await new Promise((r) => setTimeout(r, 300));
  if (!lock.allowed) {
    c.header('Retry-After', String(lock.retryAfterSeconds ?? 120));
    return c.json(
      { error: `Too many failed login attempts. Try again in ${lock.retryAfterSeconds ?? 120} seconds.` },
      429,
    );
  }
  return c.json({ error: 'Invalid email or password.' }, 401);
});

web.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

web.get('/me', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const user = await c.env.DB.prepare('SELECT email, is_admin FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string; is_admin: number }>();
  return c.json({ id: userId, email: user?.email ?? 'unknown', isAdmin: !!user?.is_admin });
});

web.get('/tokens', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const rows = await c.env.DB.prepare(
    'SELECT id, name, created_at, last_used_at, revoked FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(userId)
    .all();
  return c.json(
    rows.results.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      createdAt: r.created_at ? new Date(Number(r.created_at)).toISOString() : null,
      lastUsedAt: r.last_used_at ? new Date(Number(r.last_used_at)).toISOString() : null,
      revoked: !!r.revoked,
    })),
  );
});

web.post('/tokens', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const b = await readJson(c);
  if (b.name != null && typeof b.name !== 'string') return c.json({ error: 'name must be a string' }, 400);
  const rawName = b.name?.trim() ?? '';
  if (rawName.length > 64) return c.json({ error: 'name is too long' }, 400);
  const name = rawName || 'default';
  const token = await issueApiToken(c.env.DB, userId, name);
  await writeAuditEvent(c.env.DB, { userId, action: 'token.created', metadata: { name } }, clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')));
  return c.json({ token });
});

web.post('/tokens/:tokenId/revoke', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  await c.env.DB.prepare('UPDATE api_tokens SET revoked = 1 WHERE id = ? AND user_id = ?')
    .bind(c.req.param('tokenId'), userId)
    .run();
  await writeAuditEvent(c.env.DB, { userId, action: 'token.revoked' }, clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')));
  return c.json({ ok: true });
});
