import { Hono } from 'hono';
import { Env, Vars } from '../env.js';
import { serializeColumn, serializeGroup, serializeProject, serializeTask } from '../serialize.js';
import { genId, nonStringField, nowIso, readJsonObject } from '../util.js';

const PROJECT_STRING_FIELDS = ['name', 'color', 'viewMode', 'kind', 'groupId'] as const;

/** 400 message when a listed field is present but not a string (String() would store "[object Object]"). */
function stringFieldError(b: Record<string, unknown>, keys: readonly string[]): string | null {
  const field = nonStringField(b, keys);
  return field ? `${field} must be a string` : null;
}

type State = { Bindings: Env; Variables: Vars };

export const projects = new Hono<State>();

/** Fixed id for the per-user inbox project, auto-created on first listing. */
export const INBOX_ID = 'inbox';
const MAX_PROJECT_NAME = 256;
const MAX_GROUP_NAME = 64;
const MAX_COLUMN_NAME = 128;

function finiteNumber(value: unknown, fallback: number | null = null): number | null {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureInbox(db: D1Database, userId: string): Promise<void> {
  const existing = await db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .bind(INBOX_ID, userId)
    .first();
  if (existing) return;
  await db.prepare(
    `INSERT OR IGNORE INTO projects (id, user_id, name, color, sort_order, closed, group_id, view_mode, permission, kind, etag, created_at)
     VALUES (?, ?, 'Inbox', '#4772FA', 0, 0, NULL, 'list', 'write', 'TASK', 0, ?)`,
  )
    .bind(INBOX_ID, userId, Date.now())
    .run();
}

// --- Projects ---

projects.get('/project', async (c) => {
  const userId = c.get('userId');
  await ensureInbox(c.env.DB, userId);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM projects WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
  )
    .bind(userId)
    .all();
  return c.json(rows.results.map(serializeProject));
});

projects.get('/project/group', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM project_groups WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
  )
    .bind(userId)
    .all();
  return c.json(rows.results.map(serializeGroup));
});

projects.post('/project/group', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, ['name']);
  if (stringError) return c.json({ error: stringError }, 400);
  const name = String(b.name ?? '').trim();
  if (!name || name.length > MAX_GROUP_NAME) return c.json({ error: `name is required (max ${MAX_GROUP_NAME} chars)` }, 400);
  const sortOrder = finiteNumber(b.sortOrder, 0);
  if (sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const id = genId();
  await c.env.DB.prepare(
    'INSERT INTO project_groups (id, user_id, name, view_mode, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, name, 'list', sortOrder, Date.now())
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM project_groups WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
  return c.json(serializeGroup(row!));
});

projects.post('/project/group/:groupId', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, ['name']);
  if (stringError) return c.json({ error: stringError }, 400);
  if (b.name != null && (!String(b.name).trim() || String(b.name).trim().length > MAX_GROUP_NAME)) {
    return c.json({ error: `name must be 1-${MAX_GROUP_NAME} chars` }, 400);
  }
  const sortOrder = finiteNumber(b.sortOrder);
  if (b.sortOrder != null && sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const res = await c.env.DB.prepare(
    'UPDATE project_groups SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ? AND user_id = ?',
  )
    .bind(
      b.name != null ? String(b.name) : null,
      sortOrder,
      c.req.param('groupId'),
      userId,
    )
    .run();
  if (!res.meta.changes) return c.json({ error: 'group not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM project_groups WHERE id = ? AND user_id = ?')
    .bind(c.req.param('groupId'), userId)
    .first();
  return c.json(serializeGroup(row!));
});

projects.delete('/project/group/:groupId', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB.prepare('DELETE FROM project_groups WHERE id = ? AND user_id = ?')
    .bind(c.req.param('groupId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'group not found' }, 404);
  await c.env.DB.prepare('UPDATE projects SET group_id = NULL WHERE group_id = ? AND user_id = ?')
    .bind(c.req.param('groupId'), userId)
    .run();
  return c.body(null, 200);
});

projects.post('/project', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, PROJECT_STRING_FIELDS);
  if (stringError) return c.json({ error: stringError }, 400);
  const name = String(b.name ?? '').trim();
  if (!name || name.length > MAX_PROJECT_NAME) {
    return c.json({ error: `name is required (max ${MAX_PROJECT_NAME} chars)` }, 400);
  }
  const groupId = b.groupId != null && String(b.groupId).trim() ? String(b.groupId).trim() : null;
  if (groupId) {
    const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ? AND user_id = ?')
      .bind(groupId, userId)
      .first();
    if (!group) return c.json({ error: 'group not found' }, 404);
  }
  const sortOrder = finiteNumber(b.sortOrder, 0);
  if (sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const id = genId();
  await c.env.DB.prepare(
    `INSERT INTO projects (id, user_id, name, color, sort_order, view_mode, kind, group_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      name,
      b.color != null ? String(b.color) : null,
      sortOrder,
      b.viewMode != null ? String(b.viewMode) : 'list',
      b.kind != null ? String(b.kind) : 'TASK',
      groupId,
      Date.now(),
    )
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(id, userId).first();
  return c.json(serializeProject(row!));
});

projects.get('/project/:projectId', async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .bind(c.req.param('projectId'), userId)
    .first();
  if (!row) return c.json({ error: 'project not found' }, 404);
  return c.json(serializeProject(row));
});

projects.get('/project/:projectId/data', async (c) => {
  const userId = c.get('userId');
  const projectId = c.req.param('projectId');
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, userId)
    .first();
  if (!project) return c.json({ error: 'project not found' }, 404);
  const taskRows = await c.env.DB.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND user_id = ? AND deleted = 0 AND status = 0",
  )
    .bind(projectId, userId)
    .all();
  const columnRows = await c.env.DB.prepare(
    'SELECT * FROM task_columns WHERE project_id = ? AND user_id = ? ORDER BY sort_order ASC',
  )
    .bind(projectId, userId)
    .all();
  return c.json({
    project: serializeProject(project),
    tasks: taskRows.results.map(serializeTask),
    columns: columnRows.results.map(serializeColumn),
  });
});

projects.post('/project/:projectId', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, PROJECT_STRING_FIELDS);
  if (stringError) return c.json({ error: stringError }, 400);
  if (b.name != null && (!String(b.name).trim() || String(b.name).trim().length > MAX_PROJECT_NAME)) {
    return c.json({ error: `name must be 1-${MAX_PROJECT_NAME} chars` }, 400);
  }
  const hasGroupId = Object.prototype.hasOwnProperty.call(b, 'groupId');
  const groupId = hasGroupId && b.groupId != null ? String(b.groupId).trim() : null;
  if (groupId) {
    const group = await c.env.DB.prepare('SELECT id FROM project_groups WHERE id = ? AND user_id = ?')
      .bind(groupId, userId)
      .first();
    if (!group) return c.json({ error: 'group not found' }, 404);
  }
  const sortOrder = finiteNumber(b.sortOrder);
  if (b.sortOrder != null && sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE projects SET
       name = COALESCE(?, name), color = COALESCE(?, color), sort_order = COALESCE(?, sort_order),
       view_mode = COALESCE(?, view_mode), kind = COALESCE(?, kind),
       group_id = CASE WHEN ? = 1 THEN ? ELSE group_id END,
       closed = COALESCE(?, closed), etag = etag + 1
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      b.name != null ? String(b.name) : null,
      b.color != null ? String(b.color) : null,
      sortOrder,
      b.viewMode != null ? String(b.viewMode) : null,
      b.kind != null ? String(b.kind) : null,
      hasGroupId ? 1 : 0,
      groupId,
      b.closed != null ? (b.closed ? 1 : 0) : null,
      c.req.param('projectId'),
      userId,
    )
    .run();
  if (!res.meta.changes) return c.json({ error: 'project not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .bind(c.req.param('projectId'), userId)
    .first();
  return c.json(serializeProject(row!));
});

projects.delete('/project/:projectId', async (c) => {
  const userId = c.get('userId');
  const projectId = c.req.param('projectId');
  const res = await c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'project not found' }, 404);
  await c.env.DB.prepare('DELETE FROM tasks WHERE project_id = ? AND user_id = ?')
    .bind(projectId, userId)
    .run();
  await c.env.DB.prepare('DELETE FROM task_columns WHERE project_id = ? AND user_id = ?')
    .bind(projectId, userId)
    .run();
  await c.env.DB.prepare('DELETE FROM task_comments WHERE project_id = ? AND user_id = ?')
    .bind(projectId, userId)
    .run();
  return c.body(null, 200);
});

// --- Kanban columns ---

projects.get('/project/:projectId/column', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM task_columns WHERE project_id = ? AND user_id = ? ORDER BY sort_order ASC',
  )
    .bind(c.req.param('projectId'), userId)
    .all();
  return c.json(rows.results.map(serializeColumn));
});

projects.post('/project/:projectId/column', async (c) => {
  const userId = c.get('userId');
  const projectId = c.req.param('projectId');
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, ['name']);
  if (stringError) return c.json({ error: stringError }, 400);
  const name = String(b.name ?? '').trim();
  if (!name || name.length > MAX_COLUMN_NAME) {
    return c.json({ error: `name is required (max ${MAX_COLUMN_NAME} chars)` }, 400);
  }
  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .bind(projectId, userId)
    .first();
  if (!project) return c.json({ error: 'project not found' }, 404);
  const sortOrder = finiteNumber(b.sortOrder, 0);
  if (sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const id = genId();
  await c.env.DB.prepare(
    'INSERT INTO task_columns (id, user_id, project_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, projectId, name, sortOrder, Date.now())
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM task_columns WHERE id = ? AND user_id = ?').bind(id, userId).first();
  return c.json(serializeColumn(row!));
});

projects.post('/project/:projectId/column/:columnId', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, ['name']);
  if (stringError) return c.json({ error: stringError }, 400);
  if (b.name != null && (!String(b.name).trim() || String(b.name).trim().length > MAX_COLUMN_NAME)) {
    return c.json({ error: `name must be 1-${MAX_COLUMN_NAME} chars` }, 400);
  }
  const sortOrder = finiteNumber(b.sortOrder);
  if (b.sortOrder != null && sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const res = await c.env.DB.prepare(
    'UPDATE task_columns SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ? AND project_id = ? AND user_id = ?',
  )
    .bind(
      b.name != null ? String(b.name) : null,
      sortOrder,
      c.req.param('columnId'),
      c.req.param('projectId'),
      userId,
    )
    .run();
  if (!res.meta.changes) return c.json({ error: 'column not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM task_columns WHERE id = ? AND user_id = ?')
    .bind(c.req.param('columnId'), userId)
    .first();
  return c.json(serializeColumn(row!));
});

/** Deleting a column detaches its tasks back to the project's uncategorized pool. */
projects.delete('/project/:projectId/column/:columnId', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB.prepare(
    'DELETE FROM task_columns WHERE id = ? AND project_id = ? AND user_id = ?',
  )
    .bind(c.req.param('columnId'), c.req.param('projectId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'column not found' }, 404);
  await c.env.DB.prepare(
    'UPDATE tasks SET column_id = NULL, modified_time = ?, etag = etag + 1 WHERE column_id = ? AND user_id = ?',
  )
    .bind(nowIso(), c.req.param('columnId'), userId)
    .run();
  return c.body(null, 200);
});

// re-export for potential reuse
export { serializeTask, nowIso };
