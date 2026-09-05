import { Hono } from 'hono';
import { Env } from '../env.js';
import { buildIcsCalendar } from '../ics.js';

type State = { Bindings: Env };

/**
 * Calendar subscription feed (TickTick-style 订阅日历). External calendar
 * clients (Google Calendar, Apple Calendar) poll this URL with the secret
 * token in the query string — they cannot do session cookies or Bearer
 * headers. Mounted before the token-auth sub-app so the query-token auth
 * here wins for this path.
 */
export const feed = new Hono<State>();

feed.get('/feed.ics', async (c) => {
  const token = (c.req.query('token') ?? '').trim();
  if (!token || token.length > 128) return c.json({ error: 'invalid feed token' }, 403);
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE feed_token = ?')
    .bind(token)
    .first<{ id: string }>();
  if (!user) return c.json({ error: 'invalid feed token' }, 403);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND deleted = 0 AND status = 0 AND (due_date IS NOT NULL OR start_date IS NOT NULL)',
  )
    .bind(user.id)
    .all<Record<string, unknown>>();
  return new Response(buildIcsCalendar(rows.results), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
});
