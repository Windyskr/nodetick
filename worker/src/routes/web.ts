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

// --- Backup: full JSON export/import + iCal export (session, same-origin) ---

const MAX_IMPORT_ITEMS = 5000;

/** Dump every user-owned row as a single JSON backup document. */
web.get('/export', async (c) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const all = async (table: string, order: string) =>
    (await c.env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${order}`).bind(userId).all()).results;
  const [projects, groups, tags, filters, tasks, habits, checkins, habitRecords, focus, countdowns] = await Promise.all([
    all('projects', 'sort_order'),
    all('project_groups', 'sort_order'),
    all('tags', 'sort_order'),
    all('filters', 'sort_order'),
    all('tasks', 'created_time'),
    all('habits', 'sort_order'),
    c.env.DB.prepare(
      'SELECT c.* FROM habit_checkins c JOIN habits h ON h.id = c.habit_id WHERE c.user_id = ?',
    ).bind(userId).all().then((r) => r.results),
    c.env.DB.prepare(
      'SELECT r.* FROM habit_records r JOIN habits h ON h.id = r.habit_id WHERE r.user_id = ?',
    ).bind(userId).all().then((r) => r.results),
    all('focus_records', 'created_at'),
    all('countdowns', 'sort_order'),
  ]);
  const body = {
    app: 'nodetick',
    version: 1,
    exportedAt: new Date().toISOString(),
    projects,
    projectGroups: groups,
    tags,
    filters,
    tasks,
    habits,
    habitCheckins: checkins,
    habitRecords,
    focusRecords: focus,
    countdowns,
  };
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
  let parsed: Record<string, unknown>;
  try {
    const raw = await c.req.json<unknown>();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('shape');
    parsed = raw as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || isRequestBodyTooLarge(c.req)) throw error;
    return c.json({ error: 'expected a NodeTick backup JSON object' }, 400);
  }
  if (parsed.app !== 'nodetick') return c.json({ error: 'not a NodeTick backup file' }, 400);

  let imported = 0;
  const upsert = async (table: string, rows: unknown, columns: string[]) => {
    if (!Array.isArray(rows)) return;
    if (rows.length > MAX_IMPORT_ITEMS) throw new Error(`too many ${table} rows`);
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      if (typeof row.id !== 'string' || !row.id || row.id.length > 128) continue;
      const names = ['user_id', ...columns];
      const values = [userId, ...columns.map((col) => row[col] ?? null)];
      const placeholders = names.map(() => '?').join(', ');
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`,
      ).bind(...values).run();
      imported++;
    }
  };

  // Columns mirror schema.sql; unknown/extra fields in the backup are ignored.
  try {
    await upsert('project_groups', parsed.projectGroups, ['id', 'name', 'view_mode', 'sort_order', 'created_at']);
    await upsert('projects', parsed.projects, ['id', 'name', 'color', 'sort_order', 'view_mode', 'kind', 'group_id', 'closed', 'permission', 'etag', 'created_at']);
    await upsert('tags', parsed.tags, ['id', 'name', 'label', 'color', 'sort_order', 'parent_id', 'created_at']);
    await upsert('filters', parsed.filters, ['id', 'name', 'filter_json', 'sort_order', 'created_at', 'modified_at']);
    await upsert(
      'tasks',
      parsed.tasks,
      ['id', 'project_id', 'title', 'content', 'task_desc', 'kind', 'start_date', 'due_date', 'time_zone', 'is_all_day',
        'priority', 'status', 'sort_order', 'repeat_flag', 'reminders', 'items', 'tags', 'parent_id', 'child_ids',
        'column_id', 'completed_time', 'focus_summaries', 'etag', 'created_time', 'modified_time', 'deleted', 'deleted_time'],
    );
    await upsert(
      'habits',
      parsed.habits,
      ['id', 'name', 'icon_res', 'color', 'sort_order', 'status', 'encouragement', 'type', 'goal', 'step', 'unit',
        'repeat_rule', 'reminders', 'section_id', 'style', 'etag', 'created_at'],
    );
    await upsert('habit_checkins', parsed.habitCheckins, ['id', 'habit_id', 'stamp', 'value', 'goal', 'status', 'time', 'op_time', 'created_at']);
    await upsert('habit_records', parsed.habitRecords, ['id', 'habit_id', 'stamp', 'content', 'emoji', 'op_time', 'created_at']);
    await upsert('focus_records', parsed.focusRecords, ['id', 'type', 'task_id', 'note', 'start_time', 'end_time', 'duration', 'pause_duration', 'relation', 'status', 'etag', 'created_at']);
    await upsert('countdowns', parsed.countdowns, ['id', 'name', 'date', 'kind', 'reminders', 'repeat_flag', 'calculation', 'display_mode', 'style', 'color', 'icon', 'sort_order', 'created_at']);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('too many')) {
      return c.json({ error: error.message }, 413);
    }
    throw error;
  }
  return c.json({ ok: true, imported });
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
