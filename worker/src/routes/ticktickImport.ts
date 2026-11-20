import { Hono } from 'hono';
import type { Env } from '../env.js';
import { getSessionUser } from '../auth.js';
import { readJsonObject } from '../util.js';
import { importTickTickChunk, TickTickImportError } from '../services/ticktick.js';

/**
 * TickTick backup import for the web app (mounted at /api/import/ticktick,
 * behind the same-origin check of the session routes). The browser parses
 * the CSV backup and posts each list here in chunks.
 */

type State = { Bindings: Env; Variables: { userId?: string } };

export const ticktickImport = new Hono<State>();

ticktickImport.use('*', async (c, next) => {
  const userId = await getSessionUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userId', userId);
  await next();
});

/** Import one chunk of a list's tasks (see importTickTickChunk). */
ticktickImport.post('/tasks', async (c) => {
  const b = await readJsonObject(c.req);
  try {
    return c.json(await importTickTickChunk(c.env, c.get('userId')!, b));
  } catch (error) {
    if (error instanceof TickTickImportError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});
