import { Hono } from 'hono';
import { Env, Vars } from '../env.js';
import { serializeComment, serializeTask } from '../serialize.js';
import { addDays, dayOf, nextOccurrence } from '../recurrence.js';
import {
  genId,
  isRequestBodyTooLarge,
  nowIso,
  parseJsonArray,
  readJsonObject,
  RequestBodyTooLargeError,
} from '../util.js';

type State = { Bindings: Env; Variables: Vars };

/** Upper bound for batch endpoints so one request cannot hammer D1. */
const MAX_BATCH = 100;
const MAX_FILTER_VALUES = 100;
const MAX_TAGS = 100;
const MAX_TAG_LENGTH = 64;
const MAX_REMINDERS = 100;
const MAX_REMINDER_LENGTH = 512;
const MAX_ITEMS = 100;
const MAX_ITEM_TITLE_LENGTH = 512;
const MAX_TASK_TITLE_LENGTH = 1024;
const MAX_TASK_TEXT_LENGTH = 64 * 1024;
const MAX_COMMENT_LENGTH = 64 * 1024;
const MAX_CHILDREN = 1000;
const MAX_ID_LENGTH = 128;
const MAX_DATE_LENGTH = 64;

interface ChecklistItem {
  id?: string;
  title?: string;
  status?: number;
  sortOrder?: number;
  startDate?: string | null;
  isAllDay?: boolean;
  timeZone?: string | null;
  completedTime?: string | null;
}

/** Normalize checklist items and make sure each has an id. */
function normalizeItems(items: unknown): ChecklistItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((raw, idx) => {
    const it = (raw ?? {}) as ChecklistItem;
    return {
      id: it.id ?? genId(),
      title: String(it.title ?? ''),
      status: Number(it.status ?? 0),
      sortOrder: it.sortOrder ?? idx,
      startDate: it.startDate ?? null,
      isAllDay: !!it.isAllDay,
      timeZone: it.timeZone ?? null,
      completedTime: it.completedTime ?? null,
    };
  });
}

function invalidStringArray(value: unknown, maxItems: number, maxItemLength: number): string | null {
  if (!Array.isArray(value)) return null;
  if (value.length > maxItems) return `too many values (max ${maxItems})`;
  if (value.some((item) => String(item).length > maxItemLength)) {
    return `value is too long (max ${maxItemLength} chars)`;
  }
  return null;
}

function invalidItems(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_ITEMS) return `too many checklist items (max ${MAX_ITEMS})`;
  if (value.some((item) => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return String(raw.title ?? '').length > MAX_ITEM_TITLE_LENGTH;
  })) {
    return `checklist item title is too long (max ${MAX_ITEM_TITLE_LENGTH} chars)`;
  }
  return null;
}

function invalidText(value: unknown, maxLength: number): boolean {
  return value != null && String(value).length > maxLength;
}

function invalidFiniteNumber(value: unknown): boolean {
  return value != null && value !== '' && !Number.isFinite(Number(value));
}

function invalidId(value: unknown): boolean {
  return value != null && String(value).length > MAX_ID_LENGTH;
}

function optionalDate(value: unknown): number | null | undefined {
  if (value == null || String(value) === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

function taskDateError(startDate: unknown, dueDate: unknown): string | null {
  const start = optionalDate(startDate);
  const due = optionalDate(dueDate);
  if (start === undefined || due === undefined) return 'startDate and dueDate must be valid dates';
  if (start != null && due != null && due < start) return 'dueDate must not precede startDate';
  return null;
}

async function readJsonValue(c: { req: { json: <T>() => Promise<T> } }): Promise<unknown> {
  try {
    const value = await c.req.json<unknown>();
    if (isRequestBodyTooLarge(c.req)) throw new RequestBodyTooLargeError();
    return value;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || isRequestBodyTooLarge(c.req)) {
      throw new RequestBodyTooLargeError();
    }
    return undefined;
  }
}

export const tasks = new Hono<State>();

// NOTE: static /task/* routes must be registered before POST /task/:taskId —
// the router matches in registration order for same-shape paths.

// --- Trash (soft delete; the webapp's recycle bin) ---

tasks.get('/task/trash', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND deleted = 1 ORDER BY deleted_time DESC',
  )
    .bind(userId)
    .all();
  return c.json(rows.results.map(serializeTask));
});

tasks.post('/task/trash/:taskId/restore', async (c) => {
  const userId = c.get('userId');
  const existing = await c.env.DB.prepare(
    'SELECT parent_id, project_id FROM tasks WHERE id = ? AND user_id = ? AND deleted = 1',
  )
    .bind(c.req.param('taskId'), userId)
    .first<{ parent_id: string | null; project_id: string }>();
  if (!existing) return c.json({ error: 'task not found' }, 404);
  let parentId = existing.parent_id ? String(existing.parent_id) : null;
  if (parentId) {
    const parent = await c.env.DB.prepare(
      'SELECT id FROM tasks WHERE id = ? AND user_id = ? AND project_id = ? AND deleted = 0',
    )
      .bind(parentId, userId, String(existing.project_id))
      .first();
    if (!parent) parentId = null;
  }
  const res = await c.env.DB.prepare(
    'UPDATE tasks SET deleted = 0, deleted_time = NULL, parent_id = ?, modified_time = ?, etag = etag + 1 WHERE id = ? AND user_id = ? AND deleted = 1',
  )
    .bind(parentId, nowIso(), c.req.param('taskId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'task not found' }, 404);
  if (parentId) await appendChildId(c.env.DB, userId, parentId, c.req.param('taskId'));
  const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
    .bind(c.req.param('taskId'), userId)
    .first();
  return c.json(serializeTask(row!));
});

tasks.delete('/task/trash/:taskId', async (c) => {
  const userId = c.get('userId');
  const existing = await c.env.DB.prepare(
    'SELECT parent_id FROM tasks WHERE id = ? AND user_id = ? AND deleted = 1',
  )
    .bind(c.req.param('taskId'), userId)
    .first<{ parent_id: string | null }>();
  if (!existing) return c.json({ error: 'task not found' }, 404);
  if (existing.parent_id) await removeChildId(c.env.DB, userId, String(existing.parent_id), c.req.param('taskId'));
  await detachChildren(c.env.DB, userId, c.req.param('taskId'));
  const res = await c.env.DB.prepare(
    'DELETE FROM tasks WHERE id = ? AND user_id = ? AND deleted = 1',
  )
    .bind(c.req.param('taskId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'task not found' }, 404);
  await c.env.DB.prepare('DELETE FROM task_comments WHERE task_id = ? AND user_id = ?')
    .bind(c.req.param('taskId'), userId)
    .run();
  return c.body(null, 200);
});

tasks.post('/task/move', async (c) => {
  const userId = c.get('userId');
  const moves = await readJsonValue(c);
  if (!Array.isArray(moves)) return c.json({ error: 'expected an array of moves' }, 400);
  if (moves.length > MAX_BATCH) return c.json({ error: `too many moves (max ${MAX_BATCH})` }, 413);
  // Validate the whole batch before moving anything: an error response must
  // never leave the earlier entries of the same request applied.
  const planned: { fromProjectId: string; toProjectId: string; taskId: string }[] = [];
  const seenTaskIds = new Set<string>();
  for (const raw of moves) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return c.json({ error: 'each move must be an object' }, 400);
    }
    const m = raw as Record<string, unknown>;
    const fromProjectId = String(m.fromProjectId ?? '').trim();
    const toProjectId = String(m.toProjectId ?? '').trim();
    const taskId = String(m.taskId ?? '').trim();
    if (!fromProjectId || !toProjectId || !taskId) {
      return c.json({ error: 'each move requires fromProjectId, toProjectId and taskId' }, 400);
    }
    if ([fromProjectId, toProjectId, taskId].some((id) => id.length > MAX_ID_LENGTH)) {
      return c.json({ error: `move identifiers must be at most ${MAX_ID_LENGTH} chars` }, 400);
    }
    if (seenTaskIds.has(taskId)) return c.json({ error: 'a task may appear only once per move request' }, 400);
    seenTaskIds.add(taskId);
    const destination = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
      .bind(toProjectId, userId)
      .first();
    if (!destination) return c.json({ error: 'destination project not found' }, 404);
    const current = await c.env.DB.prepare(
      'SELECT project_id FROM tasks WHERE id = ? AND user_id = ? AND deleted = 0',
    )
      .bind(taskId, userId)
      .first<{ project_id: string }>();
    if (!current) return c.json({ error: 'task not found' }, 404);
    if (String(current.project_id) !== fromProjectId) {
      return c.json({ error: 'task is not in fromProjectId' }, 409);
    }
    planned.push({ fromProjectId, toProjectId, taskId });
  }

  const out: ReturnType<typeof serializeTask>[] = [];
  for (const { fromProjectId, toProjectId, taskId } of planned) {
    // Re-read: an earlier move in this batch may have detached this task
    // from a parent that changed project.
    const current = await c.env.DB.prepare(
      'SELECT parent_id, column_id FROM tasks WHERE id = ? AND user_id = ? AND deleted = 0 AND project_id = ?',
    )
      .bind(taskId, userId, fromProjectId)
      .first<{ parent_id: string | null; column_id: string | null }>();
    if (!current) return c.json({ error: 'task changed before it could be moved' }, 409);
    const crossesProject = fromProjectId !== toProjectId;
    if (crossesProject) {
      if (current.parent_id) await removeChildId(c.env.DB, userId, String(current.parent_id), taskId);
      // Children stay in the source project; detach them instead of leaving
      // parent pointers that cross project boundaries.
      await detachChildren(c.env.DB, userId, taskId);
    }
    const moved = await c.env.DB.prepare(
      'UPDATE tasks SET project_id = ?, parent_id = ?, column_id = ?, modified_time = ?, etag = etag + 1 WHERE id = ? AND user_id = ? AND deleted = 0 AND project_id = ?',
    )
      .bind(
        toProjectId,
        crossesProject ? null : current.parent_id,
        crossesProject ? null : current.column_id,
        nowIso(),
        taskId,
        userId,
        fromProjectId,
      )
      .run();
    if (!moved.meta.changes) return c.json({ error: 'task changed before it could be moved' }, 409);
    const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
      .bind(taskId, userId)
      .first();
    if (row) out.push(serializeTask(row));
  }
  return c.json(out);
});

tasks.post('/task/completed', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  if (invalidStringArray(b.projectIds, MAX_FILTER_VALUES, 128)) {
    return c.json({ error: `too many projectIds (max ${MAX_FILTER_VALUES})` }, 413);
  }
  const rows = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND status = 2 AND deleted = 0 ORDER BY completed_time DESC',
  )
    .bind(userId)
    .all();
  const projectIds = Array.isArray(b.projectIds) ? b.projectIds.map(String) : null;
  const start = optionalDate(b.startDate);
  const end = optionalDate(b.endDate);
  if (start === undefined || end === undefined) return c.json({ error: 'startDate/endDate must be valid dates' }, 400);
  if (start != null && end != null && end < start) return c.json({ error: 'endDate must not precede startDate' }, 400);
  const out = rows.results
    .filter((r) => !projectIds || projectIds.includes(String(r.project_id)))
    .filter((r) => {
      if (start == null && end == null) return true;
      const t = r.completed_time ? Date.parse(String(r.completed_time)) : NaN;
      if (Number.isNaN(t)) return false;
      if (start != null && t < start) return false;
      if (end != null && t > end) return false;
      return true;
    })
    .map(serializeTask);
  return c.json(out);
});

tasks.post('/task/filter', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  for (const [key, max, itemLength] of [
    ['projectIds', MAX_FILTER_VALUES, 128],
    ['priority', MAX_FILTER_VALUES, 8],
    ['tag', MAX_TAGS, MAX_TAG_LENGTH],
    ['status', 16, 8],
  ] as const) {
    if (invalidStringArray(b[key], max, itemLength)) {
      return c.json({ error: `${key} contains too many or too-long values` }, 413);
    }
  }
  const rows = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND deleted = 0',
  )
    .bind(userId)
    .all();
  const projectIds = Array.isArray(b.projectIds) ? b.projectIds.map(String) : null;
  const priorities = Array.isArray(b.priority) ? b.priority.map(Number) : null;
  const tagFilter = Array.isArray(b.tag) ? b.tag.map(tagKey) : null;
  const statuses = Array.isArray(b.status) && b.status.length ? b.status.map(Number) : [0];
  const start = optionalDate(b.startDate);
  const end = optionalDate(b.endDate);
  if (start === undefined || end === undefined) return c.json({ error: 'startDate/endDate must be valid dates' }, 400);
  if (start != null && end != null && end < start) return c.json({ error: 'endDate must not precede startDate' }, 400);

  const out = rows.results
    .filter((r) => statuses.includes(Number(r.status)))
    .filter((r) => !projectIds || projectIds.includes(String(r.project_id)))
    .filter((r) => !priorities || priorities.includes(Number(r.priority)))
    .filter((r) => {
      if (!tagFilter) return true;
      const tags = parseJsonArray<string>(r.tags as string).map(tagKey);
      return tagFilter.some((t) => tags.includes(t));
    })
    .filter((r) => {
      if (start == null && end == null) return true;
      const raw = r.due_date ?? r.start_date;
      if (!raw) return false;
      const t = Date.parse(String(raw));
      if (Number.isNaN(t)) return false;
      if (start != null && t < start) return false;
      if (end != null && t > end) return false;
      return true;
    })
    .map(serializeTask);
  return c.json(out);
});

tasks.post('/task/search', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  if (invalidText(b.keywords, MAX_TASK_TEXT_LENGTH)) return c.json({ error: 'keywords are too long' }, 400);
  for (const [key, max, itemLength] of [
    ['projectIds', MAX_FILTER_VALUES, 128],
    ['tags', MAX_TAGS, MAX_TAG_LENGTH],
    ['status', 16, 8],
  ] as const) {
    if (invalidStringArray(b[key], max, itemLength)) {
      return c.json({ error: `${key} contains too many or too-long values` }, 413);
    }
  }
  const keywords = b.keywords != null ? String(b.keywords).trim().toLowerCase() : '';
  const rows = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE user_id = ? AND deleted = 0',
  )
    .bind(userId)
    .all();
  const projectIds = Array.isArray(b.projectIds) ? b.projectIds.map(String) : null;
  const tagFilter = Array.isArray(b.tags) ? b.tags.map(tagKey) : null;
  const statuses = Array.isArray(b.status) && b.status.length ? b.status.map(Number) : null;
  const dueFrom = optionalDate(b.dueFrom);
  const dueTo = optionalDate(b.dueTo);
  if (dueFrom === undefined || dueTo === undefined) return c.json({ error: 'dueFrom/dueTo must be valid dates' }, 400);
  if (dueFrom != null && dueTo != null && dueTo < dueFrom) return c.json({ error: 'dueTo must not precede dueFrom' }, 400);

  const out = rows.results
    .filter((r) => {
      if (!keywords) return true;
      const hay = [r.title, r.content, r.task_desc].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(keywords);
    })
    .filter((r) => !projectIds || projectIds.includes(String(r.project_id)))
    .filter((r) => {
      if (!tagFilter) return true;
      const tags = parseJsonArray<string>(r.tags as string).map(tagKey);
      return tagFilter.some((t) => tags.includes(t));
    })
    .filter((r) => !statuses || statuses.includes(Number(r.status)))
    .filter((r) => {
      if (dueFrom == null && dueTo == null) return true;
      if (!r.due_date) return false;
      const t = Date.parse(String(r.due_date));
      if (Number.isNaN(t)) return false;
      if (dueFrom != null && t < dueFrom) return false;
      if (dueTo != null && t > dueTo) return false;
      return true;
    })
    .map(serializeTask);
  return c.json(out);
});

tasks.get('/project/:projectId/task/:taskId', async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE id = ? AND project_id = ? AND user_id = ? AND deleted = 0',
  )
    .bind(c.req.param('taskId'), c.req.param('projectId'), userId)
    .first();
  if (!row) return c.json({ error: 'task not found' }, 404);
  return c.json(serializeTask(row));
});

tasks.post('/task', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const projectId = String(b.projectId ?? '').trim();
  if (!projectId) return c.json({ error: 'projectId is required' }, 400);
  if (invalidId(projectId) || invalidText(b.title, MAX_TASK_TITLE_LENGTH) || invalidText(b.content, MAX_TASK_TEXT_LENGTH) || invalidText(b.desc, MAX_TASK_TEXT_LENGTH) || invalidText(b.kind, 64) || invalidText(b.startDate, MAX_DATE_LENGTH) || invalidText(b.dueDate, MAX_DATE_LENGTH) || invalidText(b.timeZone, 128) || invalidText(b.repeatFlag, 512)) {
    return c.json({ error: 'task text is too long' }, 400);
  }
  if (invalidFiniteNumber(b.priority) || invalidFiniteNumber(b.sortOrder)) {
    return c.json({ error: 'priority and sortOrder must be finite numbers' }, 400);
  }
  const dateError = taskDateError(b.startDate, b.dueDate);
  if (dateError) return c.json({ error: dateError }, 400);
  for (const [value, max, itemLength, label] of [
    [b.tags, MAX_TAGS, MAX_TAG_LENGTH, 'tags'],
    [b.reminders, MAX_REMINDERS, MAX_REMINDER_LENGTH, 'reminders'],
  ] as const) {
    if (invalidStringArray(value, max, itemLength)) {
      return c.json({ error: `${label} contains too many or too-long values` }, 413);
    }
  }
  const itemError = invalidItems(b.items);
  if (itemError) return c.json({ error: itemError }, 413);
  const project = await c.env.DB.prepare(
    'SELECT id FROM projects WHERE id = ? AND user_id = ?',
  )
    .bind(projectId, userId)
    .first();
  if (!project) return c.json({ error: 'project not found' }, 404);

  const id = genId();
  const now = nowIso();
  const tags = Array.isArray(b.tags) ? b.tags.map(String) : [];
  const items = normalizeItems(b.items);
  const parentId = b.parentId != null && String(b.parentId).trim() ? String(b.parentId).trim() : null;
  if (parentId) {
    if (parentId.length > MAX_ID_LENGTH) return c.json({ error: 'parentId is too long' }, 400);
    if (parentId === id) return c.json({ error: 'a task cannot be its own parent' }, 400);
    const parent = await c.env.DB.prepare(
      'SELECT id FROM tasks WHERE id = ? AND user_id = ? AND project_id = ? AND deleted = 0',
    )
      .bind(parentId, userId, projectId)
      .first();
    if (!parent) return c.json({ error: 'parent task not found' }, 404);
    if (await createsParentCycle(c.env.DB, userId, id, parentId)) {
      return c.json({ error: 'parent relationship would create a cycle or exceed the nesting limit' }, 400);
    }
  }
  const columnId = b.columnId != null && String(b.columnId).trim() ? String(b.columnId).trim() : null;
  if (columnId) {
    if (columnId.length > MAX_ID_LENGTH) return c.json({ error: 'columnId is too long' }, 400);
    const column = await c.env.DB.prepare(
      'SELECT id FROM task_columns WHERE id = ? AND user_id = ? AND project_id = ?',
    )
      .bind(columnId, userId, projectId)
      .first();
    if (!column) return c.json({ error: 'column not found' }, 404);
  }

  await c.env.DB.prepare(
    `INSERT INTO tasks
      (id, user_id, project_id, title, content, task_desc, kind, start_date, due_date, time_zone,
       is_all_day, priority, pinned, status, sort_order, repeat_flag, reminders, items, tags, parent_id,
       column_id, created_time, modified_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      projectId,
      String(b.title ?? ''),
      b.content != null ? String(b.content) : null,
      b.desc != null ? String(b.desc) : null,
      b.kind != null ? String(b.kind) : 'TASK',
      b.startDate != null ? String(b.startDate) : null,
      b.dueDate != null ? String(b.dueDate) : null,
      b.timeZone != null ? String(b.timeZone) : null,
      b.isAllDay ? 1 : 0,
      Number(b.priority ?? 0),
      b.pinned ? 1 : 0,
      b.sortOrder != null ? Number(b.sortOrder) : 0,
      b.repeatFlag != null ? String(b.repeatFlag) : null,
      Array.isArray(b.reminders) ? JSON.stringify(b.reminders.map(String)) : null,
      items.length ? JSON.stringify(items) : null,
      tags.length ? JSON.stringify(tags) : null,
      parentId,
      columnId,
      now,
      now,
    )
    .run();

  await upsertTags(c.env.DB, userId, tags);
  if (parentId) await appendChildId(c.env.DB, userId, parentId, id);

  const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').bind(id, userId).first();
  return c.json(serializeTask(row!));
});

tasks.post('/task/:taskId', async (c) => {
  const userId = c.get('userId');
  const taskId = c.req.param('taskId');
  const b = await readJsonObject(c.req);
  if (invalidId(b.projectId) || invalidId(b.parentId) || invalidId(b.columnId) || invalidText(b.title, MAX_TASK_TITLE_LENGTH) || invalidText(b.content, MAX_TASK_TEXT_LENGTH) || invalidText(b.desc, MAX_TASK_TEXT_LENGTH) || invalidText(b.kind, 64) || invalidText(b.startDate, MAX_DATE_LENGTH) || invalidText(b.dueDate, MAX_DATE_LENGTH) || invalidText(b.timeZone, 128) || invalidText(b.repeatFlag, 512)) {
    return c.json({ error: 'task text is too long' }, 400);
  }
  if (invalidFiniteNumber(b.priority) || invalidFiniteNumber(b.sortOrder)) {
    return c.json({ error: 'priority and sortOrder must be finite numbers' }, 400);
  }
  for (const [value, max, itemLength, label] of [
    [b.tags, MAX_TAGS, MAX_TAG_LENGTH, 'tags'],
    [b.reminders, MAX_REMINDERS, MAX_REMINDER_LENGTH, 'reminders'],
  ] as const) {
    if (invalidStringArray(value, max, itemLength)) {
      return c.json({ error: `${label} contains too many or too-long values` }, 413);
    }
  }
  const itemError = invalidItems(b.items);
  if (itemError) return c.json({ error: itemError }, 413);
  const existing = await c.env.DB.prepare(
    'SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted = 0',
  )
    .bind(taskId, userId)
    .first<Record<string, unknown>>();
  if (!existing) return c.json({ error: 'task not found' }, 404);
  const dateError = taskDateError(
    'startDate' in b ? b.startDate : existing.start_date,
    'dueDate' in b ? b.dueDate : existing.due_date,
  );
  if (dateError) return c.json({ error: dateError }, 400);
  if (Array.isArray(b.focusSummaries) && b.focusSummaries.length > 16) {
    return c.json({ error: 'too many focus summaries' }, 413);
  }
  if (b.status != null) {
    const wanted = Number(b.status);
    // -1 = abandoned (won't do, TickTick's 已放弃), 0 = active, 2 = completed.
    if (wanted !== 0 && wanted !== 2 && wanted !== -1) return c.json({ error: 'status must be -1, 0 or 2' }, 400);
  }

  // Project move (rare via update, but supported by the API).
  let projectId = String(existing.project_id);
  if (b.projectId != null && String(b.projectId) !== projectId) {
    const target = await c.env.DB.prepare(
      'SELECT id FROM projects WHERE id = ? AND user_id = ?',
    )
      .bind(String(b.projectId), userId)
      .first();
    if (!target) return c.json({ error: 'project not found' }, 404);
    projectId = String(b.projectId);
  }

  let columnId = existing.column_id ? String(existing.column_id) : null;
  if ('columnId' in b) {
    columnId = b.columnId == null || String(b.columnId).trim() === ''
      ? null
      : String(b.columnId).trim();
    if (columnId) {
      const column = await c.env.DB.prepare(
        'SELECT id FROM task_columns WHERE id = ? AND user_id = ? AND project_id = ?',
      )
        .bind(columnId, userId, projectId)
        .first();
      if (!column) return c.json({ error: 'column not found' }, 404);
    }
  } else if (projectId !== String(existing.project_id)) {
    // Columns are project-scoped just like parents.
    columnId = null;
  }

  let parentId = existing.parent_id ? String(existing.parent_id) : null;
  // parentId: '' / 'null' / 'none' / null clears; otherwise re-parent.
  if ('parentId' in b) {
    const raw = b.parentId;
    const cleared = raw == null || String(raw).trim() === '' || ['null', 'none'].includes(String(raw).trim().toLowerCase());
    const oldParent = parentId;
    if (cleared && oldParent) {
      await removeChildId(c.env.DB, userId, oldParent, taskId);
      parentId = null;
    } else if (!cleared) {
      const newParent = String(raw).trim();
      if (!newParent || newParent === taskId) return c.json({ error: 'invalid parent task' }, 400);
      if (newParent !== oldParent || projectId !== String(existing.project_id)) {
        const parent = await c.env.DB.prepare(
          'SELECT id FROM tasks WHERE id = ? AND user_id = ? AND deleted = 0 AND project_id = ?',
        )
          .bind(newParent, userId, projectId)
          .first();
        if (!parent) return c.json({ error: 'parent task not found' }, 404);
        if (await createsParentCycle(c.env.DB, userId, taskId, newParent)) {
          return c.json({ error: 'parent relationship would create a cycle' }, 400);
        }
        if (oldParent) await removeChildId(c.env.DB, userId, oldParent, taskId);
        await appendChildId(c.env.DB, userId, newParent, taskId);
      }
      parentId = newParent;
    }
  } else if (projectId !== String(existing.project_id) && parentId) {
    // A parent must remain in the same project. Moving a child without an
    // explicit new parent would otherwise leave a cross-project reference.
    await removeChildId(c.env.DB, userId, parentId, taskId);
    parentId = null;
  }

  if (projectId !== String(existing.project_id)) {
    // A moved parent cannot keep active children in the source project.
    await detachChildren(c.env.DB, userId, taskId);
  }

  // focusSummaries: merge estimated fields, preserve read-only stats.
  let focusSummaries = existing.focus_summaries ? String(existing.focus_summaries) : null;
  if (Array.isArray(b.focusSummaries)) {
    const stored = focusSummaries ? parseJsonArray<Record<string, unknown>>(focusSummaries)[0] : undefined;
    const current = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const rawIncoming = b.focusSummaries[0];
    const incoming = rawIncoming && typeof rawIncoming === 'object' && !Array.isArray(rawIncoming)
      ? rawIncoming as Record<string, unknown>
      : {};
    if ('estimatedPomo' in incoming) current.estimatedPomo = incoming.estimatedPomo;
    if ('estimatedDuration' in incoming) current.estimatedDuration = incoming.estimatedDuration;
    focusSummaries = JSON.stringify([current]);
  }

  // status: 0 = active, 2 = completed (drives complete/uncomplete from the webapp).
  let status = Number(existing.status ?? 0);
  let completedTime = existing.completed_time;
  if (b.status != null) {
    const wanted = Number(b.status);
    status = wanted;
    completedTime = wanted === 2 ? (existing.completed_time ?? nowIso()) : null;
  }

  const tags = Array.isArray(b.tags) ? b.tags.map(String) : null;
  const items = 'items' in b ? normalizeItems(b.items) : null;

  await c.env.DB.prepare(
    `UPDATE tasks SET
      project_id = ?, title = ?, content = ?, task_desc = ?, kind = ?, start_date = ?, due_date = ?,
      time_zone = ?, is_all_day = ?, priority = ?, pinned = ?, sort_order = ?, repeat_flag = ?, reminders = ?,
      items = ?, tags = ?, parent_id = ?, column_id = ?, focus_summaries = ?,
      status = ?, completed_time = ?, modified_time = ?, etag = etag + 1
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      projectId,
      b.title != null ? String(b.title) : String(existing.title),
      'content' in b ? (b.content != null ? String(b.content) : null) : existing.content,
      'desc' in b ? (b.desc != null ? String(b.desc) : null) : existing.task_desc,
      b.kind != null ? String(b.kind) : String(existing.kind ?? 'TASK'),
      'startDate' in b ? (b.startDate != null ? String(b.startDate) : null) : existing.start_date,
      'dueDate' in b ? (b.dueDate != null ? String(b.dueDate) : null) : existing.due_date,
      'timeZone' in b ? (b.timeZone != null ? String(b.timeZone) : null) : existing.time_zone,
      'isAllDay' in b ? (b.isAllDay ? 1 : 0) : Number(existing.is_all_day ?? 0),
      b.priority != null ? Number(b.priority) : Number(existing.priority ?? 0),
      'pinned' in b ? (b.pinned ? 1 : 0) : Number(existing.pinned ?? 0),
      b.sortOrder != null ? Number(b.sortOrder) : Number(existing.sort_order ?? 0),
      'repeatFlag' in b ? (b.repeatFlag != null ? String(b.repeatFlag) : null) : existing.repeat_flag,
      Array.isArray(b.reminders) ? JSON.stringify(b.reminders.map(String)) : existing.reminders,
      items ? (items.length ? JSON.stringify(items) : null) : existing.items,
      tags ? (tags.length ? JSON.stringify(tags) : null) : existing.tags,
      parentId,
      columnId,
      focusSummaries,
      status,
      completedTime,
      nowIso(),
      taskId,
      userId,
    )
    .run();

  if (tags) await upsertTags(c.env.DB, userId, tags);

  const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').bind(taskId, userId).first();
  // Completing via the generic update also spawns the next occurrence.
  if (row && Number(row.status) === 2 && Number(existing.status ?? 0) !== 2) {
    await spawnNextOccurrence(c.env.DB, userId, row);
  }
  return c.json(serializeTask(row!));
});

tasks.post('/project/:projectId/task/:taskId/complete', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB.prepare(
    `UPDATE tasks SET status = 2, completed_time = ?, modified_time = ?, etag = etag + 1
     WHERE id = ? AND project_id = ? AND user_id = ? AND deleted = 0 AND status != 2`,
  )
    .bind(nowIso(), nowIso(), c.req.param('taskId'), c.req.param('projectId'), userId)
    .run();
  if (!res.meta.changes) {
    // Already completed: stay idempotent. Re-completing must not re-stamp the
    // completion time or spawn a duplicate next occurrence (CLI retries,
    // double clicks); the conditional UPDATE also settles concurrent calls.
    const existing = await c.env.DB.prepare(
      'SELECT id FROM tasks WHERE id = ? AND project_id = ? AND user_id = ? AND deleted = 0',
    )
      .bind(c.req.param('taskId'), c.req.param('projectId'), userId)
      .first();
    if (!existing) return c.json({ error: 'task not found' }, 404);
    return c.json(null);
  }
  const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
    .bind(c.req.param('taskId'), userId)
    .first();
  // Completing a recurring task returns the freshly spawned next occurrence.
  const next = row ? await spawnNextOccurrence(c.env.DB, userId, row) : null;
  return c.json(next);
});

tasks.delete('/project/:projectId/task/:taskId', async (c) => {
  const userId = c.get('userId');
  const taskId = c.req.param('taskId');
  const existing = await c.env.DB.prepare(
    'SELECT parent_id FROM tasks WHERE id = ? AND project_id = ? AND user_id = ? AND deleted = 0',
  )
    .bind(taskId, c.req.param('projectId'), userId)
    .first<{ parent_id: string | null }>();
  if (!existing) return c.json({ error: 'task not found' }, 404);
  // Soft delete: the task lands in the webapp's trash, gone from every view.
  await c.env.DB.prepare(
    'UPDATE tasks SET deleted = 1, deleted_time = ?, modified_time = ?, etag = etag + 1 WHERE id = ? AND user_id = ?',
  )
    .bind(nowIso(), nowIso(), taskId, userId)
    .run();
  if (existing.parent_id) await removeChildId(c.env.DB, userId, existing.parent_id, taskId);
  await detachChildren(c.env.DB, userId, taskId);
  return c.body(null, 200);
});

// --- Comments ---

tasks.get('/project/:projectId/task/:taskId/comments', async (c) => {
  const userId = c.get('userId');
  const task = await c.env.DB.prepare(
    'SELECT id FROM tasks WHERE id = ? AND project_id = ? AND user_id = ? AND deleted = 0',
  )
    .bind(c.req.param('taskId'), c.req.param('projectId'), userId)
    .first();
  if (!task) return c.json({ error: 'task not found' }, 404);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? AND project_id = ? AND user_id = ? ORDER BY created_at ASC',
  )
    .bind(c.req.param('taskId'), c.req.param('projectId'), userId)
    .all();
  return c.json(rows.results.map(serializeComment));
});

tasks.post('/project/:projectId/task/:taskId/comment', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const title = b.title != null ? String(b.title) : '';
  if (!title) return c.json({ error: 'title is required' }, 400);
  if (title.length > MAX_COMMENT_LENGTH) return c.json({ error: 'comment is too long' }, 400);
  const task = await c.env.DB.prepare(
    'SELECT id FROM tasks WHERE id = ? AND project_id = ? AND user_id = ? AND deleted = 0',
  )
    .bind(c.req.param('taskId'), c.req.param('projectId'), userId)
    .first();
  if (!task) return c.json({ error: 'task not found' }, 404);
  const id = genId();
  const createdAt = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO task_comments (id, user_id, project_id, task_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, c.req.param('projectId'), c.req.param('taskId'), title, createdAt)
    .run();
  return c.json({
    id,
    taskId: c.req.param('taskId'),
    projectId: c.req.param('projectId'),
    title,
    createdTime: new Date(createdAt).toISOString(),
  });
});

tasks.delete('/project/:projectId/task/:taskId/comment/:commentId', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB.prepare(
    'DELETE FROM task_comments WHERE id = ? AND task_id = ? AND project_id = ? AND user_id = ?',
  )
    .bind(c.req.param('commentId'), c.req.param('taskId'), c.req.param('projectId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'comment not found' }, 404);
  return c.body(null, 200);
});

// --- Shared helpers (exported for other route modules) ---

/**
 * TickTick behavior: completing a task that carries a repeat rule spawns its
 * next occurrence as a fresh active clone — dates advanced by the rule (never
 * in the past), subtasks reset to unchecked, completion state cleared.
 * Returns the serialized clone, or null when there is no usable rule/anchor.
 */
export async function spawnNextOccurrence(
  db: D1Database,
  userId: string,
  row: Record<string, unknown>,
): Promise<ReturnType<typeof serializeTask> | null> {
  const repeatFlag = row.repeat_flag ? String(row.repeat_flag) : null;
  const due = row.due_date ? String(row.due_date) : null;
  const start = row.start_date ? String(row.start_date) : null;
  const anchor = due ?? start;
  if (!repeatFlag || !anchor) return null;
  const nextAnchor = nextOccurrence(repeatFlag, anchor, dayOf(nowIso()) ?? undefined);
  if (!nextAnchor) return null;

  let nextStart: string | null;
  let nextDue: string | null;
  if (start && due) {
    // Multi-day range: shift the whole window by the rule's day advance.
    const startDay = dayOf(start);
    const dueDay = dayOf(due);
    const deltaDays = startDay && dueDay
      ? Math.round((Date.parse(`${dueDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86400000)
      : 0;
    const nextDueDay = dayOf(nextAnchor)!;
    nextDue = nextAnchor;
    const startSuffix = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(start)?.[2] ?? '';
    nextStart = `${addDays(nextDueDay, -deltaDays)}${startSuffix}`;
  } else if (start) {
    nextStart = nextAnchor;
    nextDue = null;
  } else {
    nextStart = null;
    nextDue = nextAnchor;
  }

  const items = parseJsonArray<ChecklistItem>(row.items as string).map((it) => ({
    ...it,
    status: 0,
    completedTime: null,
  }));

  // The clone re-attaches to its parent only when that parent is still active.
  const parentId = row.parent_id ? String(row.parent_id) : null;
  let cloneParent: string | null = null;
  if (parentId) {
    const parent = await db
      .prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ? AND deleted = 0 AND status = 0')
      .bind(parentId, userId)
      .first();
    cloneParent = parent ? parentId : null;
  }

  const id = genId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO tasks
        (id, user_id, project_id, title, content, task_desc, kind, start_date, due_date, time_zone,
         is_all_day, priority, pinned, status, sort_order, repeat_flag, reminders, items, tags, parent_id,
         column_id, focus_summaries, created_time, modified_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      String(row.project_id),
      String(row.title ?? ''),
      row.content != null ? String(row.content) : null,
      row.task_desc != null ? String(row.task_desc) : null,
      String(row.kind ?? 'TASK'),
      nextStart,
      nextDue,
      row.time_zone != null ? String(row.time_zone) : null,
      Number(row.is_all_day ?? 0),
      Number(row.priority ?? 0),
      Number(row.pinned ?? 0),
      Number(row.sort_order ?? 0),
      repeatFlag,
      row.reminders != null ? String(row.reminders) : null,
      items.length ? JSON.stringify(items) : null,
      row.tags != null ? String(row.tags) : null,
      cloneParent,
      row.column_id != null ? String(row.column_id) : null,
      row.focus_summaries != null ? String(row.focus_summaries) : null,
      now,
      now,
    )
    .run();
  const clone = await db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').bind(id, userId).first();
  return clone ? serializeTask(clone) : null;
}

/**
 * Tag identity: tasks keep tag text as typed ("Work"), the tags table keys
 * on the trimmed lowercase name. Compare tags through this, never verbatim.
 */
export function tagKey(tag: unknown): string {
  return String(tag).trim().toLowerCase();
}

export async function upsertTags(db: D1Database, userId: string, tags: string[]) {
  for (const name of tags.slice(0, MAX_TAGS)) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    await db
      .prepare(
        'INSERT INTO tags (id, user_id, name, label, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO NOTHING',
      )
      .bind(genId(), userId, tagKey(trimmed), trimmed, Date.now())
      .run();
  }
}

async function appendChildId(db: D1Database, userId: string, parentId: string, childId: string) {
  const parent = await db
    .prepare('SELECT child_ids FROM tasks WHERE id = ? AND user_id = ? AND deleted = 0')
    .bind(parentId, userId)
    .first<{ child_ids: string | null }>();
  if (!parent) return;
  const ids = parseJsonArray<string>(parent.child_ids).map(String).slice(0, MAX_CHILDREN);
  if (!ids.includes(childId) && ids.length < MAX_CHILDREN) ids.push(childId);
  await db
    .prepare('UPDATE tasks SET child_ids = ? WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(ids), parentId, userId)
    .run();
}

async function removeChildId(db: D1Database, userId: string, parentId: string, childId: string) {
  const parent = await db
    .prepare('SELECT child_ids FROM tasks WHERE id = ? AND user_id = ?')
    .bind(parentId, userId)
    .first<{ child_ids: string | null }>();
  if (!parent) return;
  const ids = parseJsonArray<string>(parent.child_ids).map(String).slice(0, MAX_CHILDREN);
  const next = ids.filter((x) => x !== childId);
  if (next.length !== ids.length) {
    await db
      .prepare('UPDATE tasks SET child_ids = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(next), parentId, userId)
      .run();
  }
}

/** Remove dangling parent pointers when a parent task leaves the active tree. */
async function detachChildren(db: D1Database, userId: string, parentId: string): Promise<void> {
  await db
    .prepare('UPDATE tasks SET parent_id = NULL, modified_time = ?, etag = etag + 1 WHERE parent_id = ? AND user_id = ? AND deleted = 0')
    .bind(nowIso(), parentId, userId)
    .run();
  await db
    .prepare('UPDATE tasks SET child_ids = NULL WHERE id = ? AND user_id = ?')
    .bind(parentId, userId)
    .run();
}

/** Walk the parent chain to reject cycles before updating the child pointer. */
async function createsParentCycle(
  db: D1Database,
  userId: string,
  taskId: string,
  proposedParentId: string,
): Promise<boolean> {
  let current: string | null = proposedParentId;
  for (let depth = 0; current && depth < MAX_CHILDREN; depth++) {
    if (current === taskId) return true;
    const parentRow: { parent_id: string | null } | null = await db
      .prepare('SELECT parent_id FROM tasks WHERE id = ? AND user_id = ? AND deleted = 0')
      .bind(current, userId)
      .first<{ parent_id: string | null }>();
    if (!parentRow) return false;
    current = parentRow.parent_id ? String(parentRow.parent_id) : null;
  }
  // A pre-existing chain deeper than the safety bound is treated as invalid
  // rather than allowing another write to make traversal unbounded.
  return !!current;
}
