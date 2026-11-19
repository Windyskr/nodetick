import { Hono } from 'hono';
import { Env } from './env.js';
import { ensureSchema } from './db.js';
import { requireApiToken } from './auth.js';
import { oauth } from './oauth.js';
import { tasks } from './routes/tasks.js';
import { projects } from './routes/projects.js';
import { misc } from './routes/misc.js';
import { notifications } from './routes/notifications.js';
import { web } from './routes/web.js';
import { feed } from './routes/feed.js';
import { dispatchDueNotifications } from './services/notifications.js';
import { limitRequestBody, RequestBodyTooLargeError } from './util.js';
import { contentSecurityPolicy } from './ui.js';

const app = new Hono<{ Bindings: Env }>();

// Security headers for everything the worker serves (API JSON + the
// server-rendered OAuth consent page). Static assets get the same set from
// webapp/public/_headers.
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'Content-Security-Policy': contentSecurityPolicy(),
};

function withSecurityHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

app.use('*', async (c, next) => {
  // Cap request bodies (NodeWarden learned to do this after multipart
  // abuse): 1 MB is generous for every JSON endpoint we serve. Checked on
  // Content-Length before the body is read; chunked bodies are wrapped in a
  // hard byte-counting stream below.
  const contentLength = Number(c.req.header('Content-Length') ?? '');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return withSecurityHeaders(c.json({ error: 'request body too large' }, 413));
  }
  if (Number.isFinite(contentLength) && contentLength < 0) {
    return withSecurityHeaders(c.json({ error: 'invalid content length' }, 400));
  }

  if (c.req.raw.body) c.req.raw = limitRequestBody(c.req.raw, MAX_BODY_BYTES);
  await ensureSchema(c.env);
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    // A route may ship its own CSP (the OAuth consent page widens form-action).
    if (name === 'Content-Security-Policy' && c.res.headers.has(name)) continue;
    c.res.headers.set(name, value);
  }
});

const MAX_BODY_BYTES = 1024 * 1024;

// --- SPA backend: session auth + personal API tokens (JSON) ---
app.route('/api', web);

// --- OAuth PKCE (browser consent + token exchange) ---
// The consent page stays server-rendered; /login is served by the SPA, which
// honors the ?next= redirect back to the consent screen after signing in.
app.route('/oauth', oauth);

// --- TickTick Open API v1 compatible surface (Bearer token or session cookie) ---
// The calendar subscription feed mounts first: its query-token auth must win
// for /feed.ics, which external calendar clients call without cookies.
app.route('/open/v1', feed);
const api = new Hono<{ Bindings: Env; Variables: { userId: string } }>();
api.use('*', requireApiToken);
api.route('/', tasks);
api.route('/', projects);
api.route('/', misc);
api.route('/', notifications);
app.route('/open/v1', api);

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  if (err instanceof RequestBodyTooLargeError) {
    return withSecurityHeaders(c.json({ error: 'request body too large' }, 413));
  }
  // Log full details server-side; return a generic message so internals
  // (stack traces, SQL text, binding names) never reach the client.
  console.error('unhandled error:', err);
  return withSecurityHeaders(c.json({ error: 'internal server error' }, 500));
});

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(dispatchDueNotifications(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
