import { Hono } from 'hono';
import type { Env } from '../env.js';
import { getSessionUser } from '../auth.js';
import { readJsonObject } from '../util.js';
import { importMicrosoftTodoChunk, MsTodoImportError } from '../services/mstodo.js';

/**
 * Microsoft To Do import for the web app (mounted at /api/import/microsoft,
 * behind the same-origin check of the session routes).
 *
 * Sign-in uses the OAuth device code flow: it needs no redirect URI, so one
 * Entra app registration serves every NodeTick deployment (by default the
 * shared app below). The worker relays
 * the two sign-in calls to Microsoft and hands the access token (read-only
 * To Do scope) to the browser, which reads Graph directly and posts the
 * lists back to /tasks in chunks.
 */

type State = { Bindings: Env; Variables: { userId?: string } };

export const msTodoImport = new Hono<State>();

const AUTHORITY = 'https://login.microsoftonline.com';
const SCOPE = 'Tasks.Read';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const MAX_DEVICE_CODE = 4096;
const NOT_CONFIGURED = 'Microsoft To Do import is turned off on this server (MS_TODO_CLIENT_ID is set to off).';

/**
 * The maintainer's shared Entra app (any Entra tenant plus personal accounts,
 * public client flows on, delegated Tasks.Read), used when MS_TODO_CLIENT_ID
 * is unset. It may be disabled at any time, so a deployment can set its own.
 */
export const SHARED_MS_TODO_CLIENT_ID = '3d591cb1-29ed-41a5-8cda-9384dd283e11';

/** The app to sign in with: MS_TODO_CLIENT_ID, the shared app when unset, none when "off". */
function microsoftApp(env: Env): { clientId: string; endpoint: string } | null {
  const setting = env.MS_TODO_CLIENT_ID?.trim();
  if (setting?.toLowerCase() === 'off') return null;
  const clientId = setting || SHARED_MS_TODO_CLIENT_ID;
  const tenant = env.MS_TODO_TENANT?.trim() || 'common';
  return { clientId, endpoint: `${AUTHORITY}/${encodeURIComponent(tenant)}/oauth2/v2.0` };
}

/**
 * POST a form to Microsoft's identity platform. The error text is
 * error_description without the trace, correlation and timestamp details
 * Microsoft appends (on new lines or, as returned in practice, inline).
 */
async function postForm(url: string, params: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    return { ok: false, body: {} as Record<string, unknown>, message: 'Could not reach Microsoft sign-in.' };
  }
  const parsed = await response.json().catch(() => null);
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const description = typeof body.error_description === 'string'
    ? body.error_description.split(/\r?\n|\s+Trace ID:/)[0].trim()
    : '';
  return { ok: response.ok, body, message: description || `Microsoft sign-in failed (${response.status}).` };
}

const positive = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

msTodoImport.use('*', async (c, next) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userId', userId);
  await next();
});

msTodoImport.get('/config', (c) => c.json({ configured: microsoftApp(c.env) !== null }));

/** Start a device code sign-in: the user enters `userCode` at `verificationUri`. */
msTodoImport.post('/device', async (c) => {
  const app = microsoftApp(c.env);
  if (!app) return c.json({ error: NOT_CONFIGURED }, 503);
  const result = await postForm(`${app.endpoint}/devicecode`, { client_id: app.clientId, scope: SCOPE });
  const { device_code: deviceCode, user_code: userCode, verification_uri: verificationUri } = result.body;
  if (!result.ok || typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
    return c.json({ error: result.message }, 502);
  }
  return c.json({
    deviceCode,
    userCode,
    verificationUri,
    expiresIn: positive(result.body.expires_in, 900),
    interval: positive(result.body.interval, 5),
  });
});

/** Poll once for the token of a started sign-in. */
msTodoImport.post('/token', async (c) => {
  const app = microsoftApp(c.env);
  if (!app) return c.json({ error: NOT_CONFIGURED }, 503);
  const b = await readJsonObject(c.req);
  if (typeof b.deviceCode !== 'string' || !b.deviceCode || b.deviceCode.length > MAX_DEVICE_CODE) {
    return c.json({ error: 'deviceCode is required' }, 400);
  }
  const result = await postForm(`${app.endpoint}/token`, {
    grant_type: DEVICE_CODE_GRANT,
    client_id: app.clientId,
    device_code: b.deviceCode,
  });
  if (result.ok && typeof result.body.access_token === 'string') {
    return c.json({ status: 'ok', accessToken: result.body.access_token, expiresIn: positive(result.body.expires_in, 3600) });
  }
  switch (result.body.error) {
    case 'authorization_pending':
      return c.json({ status: 'pending' });
    case 'slow_down':
      return c.json({ status: 'slow_down' });
    case 'authorization_declined':
      return c.json({ status: 'declined' });
    case 'expired_token':
      return c.json({ status: 'expired' });
    default:
      return c.json({ error: result.message }, 502);
  }
});

/** Import one chunk of a list's tasks (see importMicrosoftTodoChunk). */
msTodoImport.post('/tasks', async (c) => {
  const b = await readJsonObject(c.req);
  try {
    return c.json(await importMicrosoftTodoChunk(c.env, c.get('userId')!, b));
  } catch (error) {
    if (error instanceof MsTodoImportError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});
