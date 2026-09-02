import { Hono } from 'hono';
import { Env, Vars } from './env.js';
import { ensureSchema } from './db.js';
import { getSessionUser, newCsrf, verifyCsrf } from './auth.js';
import {
  genId,
  isRequestBodyTooLarge,
  randomHex,
  readJsonObject,
  RequestBodyTooLargeError,
  sha256Hex,
} from './util.js';
import { consentPage } from './ui.js';

export const DEFAULT_CLIENT_ID = 'nodetick-cli';
export const OAUTH_SCOPES = 'tasks:read tasks:write';
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CLIENT_ID_LENGTH = 64;
const MAX_CODE_LENGTH = 128;
const MAX_CODE_VERIFIER_LENGTH = 128;
const MAX_CODE_CHALLENGE_LENGTH = 128;
const MAX_REDIRECT_URI_LENGTH = 2048;
const MAX_STATE_LENGTH = 512;
const MAX_SCOPE_LENGTH = 256;

type State = { Bindings: Env; Variables: Vars };

function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return (u.protocol === 'http:' || u.protocol === 'https:') &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  method: string;
  responseType: string;
  scope: string;
}

function readAuthorizeParams(read: (key: string) => string | null): AuthorizeParams | string {
  const clientId = read('client_id') ?? '';
  const redirectUri = read('redirect_uri') ?? '';
  const codeChallenge = read('code_challenge') ?? '';
  const state = read('state') ?? '';
  const scope = read('scope') ?? OAUTH_SCOPES;
  if (clientId.length > MAX_CLIENT_ID_LENGTH || redirectUri.length > MAX_REDIRECT_URI_LENGTH ||
      codeChallenge.length > MAX_CODE_CHALLENGE_LENGTH || state.length > MAX_STATE_LENGTH ||
      scope.length > MAX_SCOPE_LENGTH) {
    return 'OAuth parameter is too long';
  }
  if (clientId !== DEFAULT_CLIENT_ID) return 'unknown client_id';
  if (!isLoopbackRedirect(redirectUri)) return 'redirect_uri must be a loopback URL';
  if ((read('response_type') ?? '') !== 'code') return 'response_type must be "code"';
  if ((read('code_challenge_method') ?? '') !== 'S256') {
    return 'code_challenge_method must be S256';
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return 'code_challenge must be a valid S256 challenge';
  return {
    clientId,
    redirectUri,
    state,
    codeChallenge,
    method: 'S256',
    responseType: 'code',
    scope,
  };
}

const fromForm = (form: Record<string, string>) => (key: string) => form[key] ?? null;

export const oauth = new Hono<{ Bindings: Env; Variables: Vars }>();

oauth.get('/authorize', async (c) => {
  await ensureSchema(c.env);
  const params = readAuthorizeParams((key) => c.req.query(key) ?? null);
  if (typeof params === 'string') {
    return c.text(`OAuth error: ${params}`, 400);
  }
  const userId = await getSessionUser(c);
  if (!userId) {
    const next = encodeURIComponent(c.req.url);
    return c.redirect(`/login?next=${next}`);
  }
  return c.html(await consentPage(c, params));
});

oauth.post('/authorize', async (c) => {
  await ensureSchema(c.env);
  const userId = await getSessionUser(c);
  if (!userId) return c.text('Not signed in', 401);
  const form = await c.req.parseBody();
  if (isRequestBodyTooLarge(c.req)) throw new RequestBodyTooLargeError();
  if (!(await verifyCsrf(c, form['csrf'] as string | undefined))) {
    return c.text('Invalid CSRF token', 403);
  }
  const params = readAuthorizeParams(
    fromForm({
      client_id: String(form['client_id'] ?? ''),
      redirect_uri: String(form['redirect_uri'] ?? ''),
      state: String(form['state'] ?? ''),
      code_challenge: String(form['code_challenge'] ?? ''),
      code_challenge_method: String(form['code_challenge_method'] ?? ''),
      response_type: 'code',
      scope: String(form['scope'] ?? ''),
    }),
  );
  if (typeof params === 'string') return c.text(`OAuth error: ${params}`, 400);

  const code = randomHex(32);
  await c.env.DB.prepare(
    'INSERT INTO oauth_codes (code_hash, user_id, code_challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256Hex(code), userId, params.codeChallenge, params.redirectUri, Date.now() + CODE_TTL_MS)
    .run();
  const target = new URL(params.redirectUri);
  target.searchParams.set('code', code);
  if (params.state) target.searchParams.set('state', params.state);
  return c.redirect(target.toString());
});

function base64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

oauth.post('/token', async (c) => {
  await ensureSchema(c.env);
  let form: Record<string, string>;
  const contentType = (c.req.header('Content-Type') ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    form = Object.fromEntries(
      Object.entries(await readJsonObject(c.req)).map(([k, v]) => [k, String(v)]),
    );
  } else {
    const text = await c.req.text();
    if (isRequestBodyTooLarge(c.req)) throw new RequestBodyTooLargeError();
    form = Object.fromEntries(new URLSearchParams(text).entries());
  }

  if (form['grant_type'] !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400);
  }
  if (!form.code || !form.client_id || !form.code_verifier || !form.redirect_uri) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  if (form.client_id.length > MAX_CLIENT_ID_LENGTH || form.code.length > MAX_CODE_LENGTH ||
      form.code_verifier.length > MAX_CODE_VERIFIER_LENGTH || form.redirect_uri.length > MAX_REDIRECT_URI_LENGTH) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  if (form.code_verifier.length < 43 || !/^[A-Za-z0-9._~-]+$/.test(form.code_verifier)) {
    return c.json({ error: 'invalid_grant', error_description: 'invalid code_verifier' }, 400);
  }
  const codeHash = await sha256Hex(form['code'] ?? '');
  const claimedAt = Date.now();
  // Claim the code with a conditional UPDATE before reading it. A
  // select-then-delete sequence lets two concurrent exchanges both observe
  // the same code and mint two tokens.
  const claim = await c.env.DB.prepare(
    'UPDATE oauth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL',
  )
    .bind(claimedAt, codeHash)
    .run();
  if (!claim.meta.changes) {
    return c.json({ error: 'invalid_grant', error_description: 'code is invalid or already used' }, 400);
  }
  const row = await c.env.DB.prepare(
    'SELECT user_id, code_challenge, redirect_uri, expires_at FROM oauth_codes WHERE code_hash = ? AND consumed_at = ?',
  )
    .bind(codeHash, claimedAt)
    .first<{ user_id: string; code_challenge: string; redirect_uri: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) {
    return c.json({ error: 'invalid_grant', error_description: 'code is invalid or expired' }, 400);
  }
  // Single-use: remove the claimed code regardless of the rest of the
  // validation outcome. The consumed marker prevents replay during the
  // validation window; the conditional delete avoids deleting a replacement
  // row if storage behavior ever changes.
  await c.env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ? AND consumed_at = ?')
    .bind(codeHash, claimedAt)
    .run();

  if (form['client_id'] !== DEFAULT_CLIENT_ID) {
    return c.json({ error: 'invalid_client' }, 401);
  }
  if ((form['redirect_uri'] ?? '') !== row.redirect_uri) {
    return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }
  const challenge = base64url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form['code_verifier'] ?? '')),
  );
  if (challenge !== row.code_challenge) {
    return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
  }

  const token = `ntk_${randomHex(32)}`;
  await c.env.DB.prepare(
    'INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(genId(), row.user_id, 'oauth (nodetick-cli)', await sha256Hex(token), Date.now())
    .run();

  return c.json({
    access_token: token,
    token_type: 'Bearer',
    scope: OAUTH_SCOPES,
    expires_in: null,
  });
});

/** Create an authorization code directly (used by tests to skip the browser flow). */
export async function createTestCode(
  db: D1Database,
  userId: string,
  codeChallenge: string,
  redirectUri: string,
): Promise<string> {
  const code = randomHex(32);
  await db
    .prepare(
      'INSERT INTO oauth_codes (code_hash, user_id, code_challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(await sha256Hex(code), userId, codeChallenge, redirectUri, Date.now() + CODE_TTL_MS)
    .run();
  return code;
}

export { newCsrf };
