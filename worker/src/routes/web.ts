import { Hono } from 'hono';
import { Env, Vars } from '../env.js';
import {
  createSession,
  destroySession,
  getSessionId,
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
import { BackupImportError, exportBackup, importBackup } from '../services/backup.js';
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

/** Registration is only open while the deployment has no users at all: the
 * first account bootstraps itself as admin, afterwards admins create users. */
web.get('/register/status', async (c) => {
  const hasUsers = await c.env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
  return c.json({ open: !hasUsers });
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
  const hasUsers = await c.env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
  if (hasUsers) {
    return c.json({ error: 'Registration is disabled. Ask an admin to create your account.' }, 403);
  }
  const b = await readJson(c);
  if (typeof b.email !== 'string' || typeof b.password !== 'string') {
    return c.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, 400);
  }
  const email = b.email.trim().toLowerCase();
  const password = b.password;
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, 400);
  }
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) {
    return c.json({ error: 'That email is already registered.' }, 409);
  }
  const salt = randomHex(16);
  const id = genId();
  const passwordHash = await hashPassword(password, salt);
  // First-user bootstrap only: the WHERE guard closes the race where two
  // concurrent registrations both observe an empty users table.
  let inserted;
  try {
    inserted = await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, salt, is_admin, created_at)
       SELECT ?, ?, ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
    )
      .bind(id, email, passwordHash, salt, Date.now())
      .run();
  } catch (error) {
    const duplicate = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (duplicate) return c.json({ error: 'That email is already registered.' }, 409);
    throw error;
  }
  if (!inserted.meta.changes) {
    return c.json({ error: 'Registration is disabled. Ask an admin to create your account.' }, 403);
  }
  await createSession(c, id);
  await writeAuditEvent(
    c.env.DB,
    { userId: id, action: 'user.register.first_admin', metadata: { email } },
    clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')),
  );
  return c.json({ ok: true, email, isAdmin: true });
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

// --- Account: change password ---

web.post('/password', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const b = await readJson(c);
  if (typeof b.currentPassword !== 'string' || typeof b.newPassword !== 'string') {
    return c.json({ error: 'Enter the current and the new password.' }, 400);
  }
  if (b.newPassword.length < 8 || b.newPassword.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: 'The new password must be at least 8 characters.' }, 400);
  }
  const user = await c.env.DB.prepare('SELECT password_hash, salt FROM users WHERE id = ?')
    .bind(userId)
    .first<{ password_hash: string; salt: string }>();
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const currentHash = await hashPassword(b.currentPassword, user.salt);
  if (!(await timingSafeEqualStr(currentHash, user.password_hash))) {
    return c.json({ error: 'Current password is incorrect.' }, 400);
  }
  const salt = randomHex(16);
  const passwordHash = await hashPassword(b.newPassword, salt);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .bind(passwordHash, salt, userId)
    .run();
  // The old hash no longer matches, so drop every other session of this user.
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(userId, getSessionId(c) ?? '')
    .run();
  await writeAuditEvent(
    c.env.DB,
    { userId, action: 'user.password.change', metadata: {} },
    clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')),
  );
  return c.json({ ok: true });
});

// --- Admin: user management (the first registered account is the admin) ---

/** Whether the user id belongs to an admin account. */
const isAdminUser = async (db: D1Database, userId: string): Promise<boolean> => {
  const row = await db.prepare('SELECT is_admin FROM users WHERE id = ?')
    .bind(userId)
    .first<{ is_admin: number }>();
  return !!row?.is_admin;
};

web.get('/admin/users', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await isAdminUser(c.env.DB, userId))) return c.json({ error: 'Admin only.' }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_admin, u.created_at,
       (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id) AS task_count
     FROM users u ORDER BY u.created_at ASC, u.id ASC`,
  ).all<{ id: string; email: string; is_admin: number; created_at: number; task_count: number }>();
  return c.json(
    rows.results.map((r) => ({
      id: r.id,
      email: r.email,
      isAdmin: !!r.is_admin,
      createdAt: r.created_at,
      tasks: r.task_count,
    })),
  );
});

web.post('/admin/users', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await isAdminUser(c.env.DB, userId))) return c.json({ error: 'Admin only.' }, 403);
  const b = await readJson(c);
  if (typeof b.email !== 'string' || typeof b.password !== 'string') {
    return c.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, 400);
  }
  const email = b.email.trim().toLowerCase();
  const password = b.password;
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH || password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, 400);
  }
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return c.json({ error: 'That email is already registered.' }, 409);
  const salt = randomHex(16);
  const id = genId();
  const passwordHash = await hashPassword(password, salt);
  const isAdmin = b.admin === true ? 1 : 0;
  try {
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, email, passwordHash, salt, isAdmin, Date.now())
      .run();
  } catch (error) {
    const duplicate = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (duplicate) return c.json({ error: 'That email is already registered.' }, 409);
    throw error;
  }
  await writeAuditEvent(
    c.env.DB,
    { userId, action: 'admin.user.create', metadata: { email } },
    clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')),
  );
  return c.json({ id, email, isAdmin: !!isAdmin });
});

web.post('/admin/users/:id/password', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await isAdminUser(c.env.DB, userId))) return c.json({ error: 'Admin only.' }, 403);
  const b = await readJson(c);
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: 'The password must be at least 8 characters.' }, 400);
  }
  const target = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; email: string }>();
  if (!target) return c.json({ error: 'User not found.' }, 404);
  const salt = randomHex(16);
  const passwordHash = await hashPassword(b.password, salt);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .bind(passwordHash, salt, target.id)
    .run();
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
  await writeAuditEvent(
    c.env.DB,
    { userId, action: 'admin.user.password_reset', metadata: { email: target.email } },
    clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')),
  );
  return c.json({ ok: true });
});

web.delete('/admin/users/:id', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await isAdminUser(c.env.DB, userId))) return c.json({ error: 'Admin only.' }, 403);
  const id = c.req.param('id');
  if (id === userId) return c.json({ error: 'You cannot delete your own account.' }, 400);
  const target = await c.env.DB.prepare('SELECT id, email, is_admin FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: string; email: string; is_admin: number }>();
  if (!target) return c.json({ error: 'User not found.' }, 404);
  if (target.is_admin) {
    const remaining = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != ?',
    )
      .bind(id)
      .first<{ n: number }>();
    if (!remaining?.n) return c.json({ error: 'Cannot delete the last admin.' }, 400);
  }
  for (const table of [
    'sessions', 'api_tokens', 'oauth_codes', 'project_groups', 'projects', 'task_columns',
    'tasks', 'task_comments', 'tags', 'filters', 'habits', 'habit_checkins', 'habit_records',
    'focus_records', 'countdowns', 'notification_settings', 'push_subscriptions',
    'notification_deliveries',
  ]) {
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(id).run();
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await writeAuditEvent(
    c.env.DB,
    { userId, action: 'admin.user.delete', metadata: { email: target.email } },
    clientIp(c.req.header('CF-Connecting-IP'), c.req.header('X-Forwarded-For')),
  );
  return c.json({ ok: true });
});

// --- Backup: full JSON export/import + iCal export (session, same-origin) ---

web.get('/export', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = await exportBackup(c.env, userId);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="nodetick-backup-${stamp}.json"`,
    },
  });
});

/** Merge-import a previously exported backup (upserts by id). */
web.post('/import', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  let parsed: unknown;
  try {
    parsed = await c.req.json<unknown>();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || isRequestBodyTooLarge(c.req)) throw error;
    return c.json({ error: 'expected a NodeTick backup JSON object' }, 400);
  }
  try {
    return c.json(await importBackup(c.env, userId, parsed));
  } catch (error) {
    if (error instanceof BackupImportError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

/** iCal feed of scheduled tasks for calendar clients. */
web.get('/export/calendar.ics', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND deleted = 0 AND status = 0 AND (due_date IS NOT NULL OR start_date IS NOT NULL)',
  )
    .bind(userId)
    .all<Record<string, unknown>>();

  const basic = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };
  const escapeText = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const day = (value: unknown): string | null => {
    const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null;
    return match ? match[1].replace(/-/g, '') : null;
  };

  const now = basic(new Date().toISOString())!;
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NodeTick//Backup//EN', 'CALSCALE:GREGORIAN'];
  for (const r of rows.results) {
    const allDay = Number(r.is_all_day ?? 0) === 1;
    const dtStart = allDay ? day(r.start_date ?? r.due_date) : basic(r.start_date ?? r.due_date);
    if (!dtStart) continue;
    const dtEnd = allDay ? day(r.due_date ?? r.start_date) : basic(r.due_date);
    lines.push('BEGIN:VEVENT', `UID:${String(r.id)}@nodetick`, `DTSTAMP:${now}`);
    lines.push(allDay ? `DTSTART;VALUE=DATE:${dtStart}` : `DTSTART:${dtStart}`);
    if (dtEnd && dtEnd >= dtStart) lines.push(allDay ? `DTEND;VALUE=DATE:${dtEnd}` : `DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeText(String(r.title ?? ''))}`);
    if (r.content) lines.push(`DESCRIPTION:${escapeText(String(r.content)).slice(0, 900)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="nodetick-tasks.ics"',
    },
  });
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
