import type { Context, MiddlewareHandler } from 'hono';
import { Env, Vars } from './env.js';
import { ensureSchema } from './db.js';
import {
  genId,
  hmacHex,
  isSameOriginRequest,
  isStateChangingMethod,
  randomHex,
  sha256Hex,
  timingSafeEqualStr,
} from './util.js';

export const SESSION_COOKIE = 'ntk_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Minimal structural context so these helpers work from both the API app and
 * the UI sub-app (Hono's Context is invariant over its generic).
 */
export interface SessionCtx {
  env: Env;
  req: {
    url: string;
    header: (name: string) => string | undefined;
  };
  header: (name: string, value: string) => void;
}

/** Extract the session id from the request cookie, or null. */
export function getSessionId(c: SessionCtx): string | null {
  const cookie = c.req.header('Cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9]+)`).exec(cookie);
  return m ? m[1] : null;
}

/** Resolve the current web-session user id, or null. */
export async function getSessionUser(c: SessionCtx): Promise<string | null> {
  const sid = getSessionId(c);
  if (!sid) return null;
  const row = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?',
  )
    .bind(sid, Date.now())
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function createSession(c: SessionCtx, userId: string): Promise<void> {
  // Session-fixation defense (NodeWarden rotates credentials at every login):
  // drop any pre-existing session bound to this browser before minting the
  // new id, so a value planted before authentication is never honored after.
  const previous = getSessionId(c);
  if (previous) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(previous).run();
  }
  const sid = randomHex(32);
  const csrf = await hmacHex(sessionSecret(c), sid);
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(sid, userId, csrf, Date.now() + SESSION_TTL_MS, Date.now())
    .run();
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
  );
}

export async function destroySession(c: SessionCtx): Promise<void> {
  const sid = getSessionId(c);
  if (sid) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  }
  c.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function sessionSecret(c: SessionCtx): string {
  const secret = (c.env.SESSION_SECRET ?? '').trim();
  // Mirror NodeWarden's secret strength gate: refuse to sign CSRF tokens
  // with a secret that is missing or too short to be meaningful.
  if (secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is not set or shorter than 32 characters. Run `pnpm --filter worker exec wrangler secret put SESSION_SECRET` with a random 32+ char string.',
    );
  }
  return secret;
}

export async function verifyCsrf(c: SessionCtx, submitted: string | undefined): Promise<boolean> {
  const sid = getSessionId(c);
  if (!sid || !submitted) return false;
  return timingSafeEqualStr(submitted, await hmacHex(sessionSecret(c), sid));
}

export function newCsrf(c: SessionCtx): Promise<string> {
  const sid = getSessionId(c) ?? '';
  return hmacHex(sessionSecret(c), sid);
}

/** Create a personal access token; the plaintext value is returned exactly once. */
export async function issueApiToken(
  db: D1Database,
  userId: string,
  name: string,
): Promise<string> {
  const token = `ntk_${randomHex(32)}`;
  await db
    .prepare(
      'INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(genId(), userId, name, await sha256Hex(token), Date.now())
    .run();
  return token;
}

type ApiEnv = { Bindings: Env; Variables: Vars };

/**
 * Auth for /open/v1/*. Accepts either a Bearer API token (CLI / external
 * clients) or the web session cookie (the SPA calls the same endpoints from
 * its own origin). Sets the userId variable on success.
 */
export const requireApiToken: MiddlewareHandler<ApiEnv> = async (c, next) => {
  await ensureSchema(c.env);
  const header = c.req.header('Authorization') ?? '';
  if (header.trim()) {
    const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!m) return c.json({ error: 'Unauthorized' }, 401);
    const tokenHash = await sha256Hex(m[1]);
    const row = await c.env.DB.prepare(
      'SELECT id, user_id FROM api_tokens WHERE token_hash = ? AND revoked = 0',
    )
      .bind(tokenHash)
      .first<{ id: string; user_id: string }>();
    if (!row) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('userId', row.user_id);
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
        .bind(Date.now(), row.id)
        .run(),
    );
    await next();
    return;
  }
  const userId = await getSessionUser(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  if (
    isStateChangingMethod(c.req.raw.method) &&
    !isSameOriginRequest(c.req.url, c.req.header('Origin'), c.req.header('Referer'))
  ) {
    return c.json({ error: 'Cross-origin request blocked' }, 403);
  }
  c.set('userId', userId);
  await next();
};

export type { Context };
