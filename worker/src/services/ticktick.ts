import type { Env } from '../env.js';
import { INBOX_ID, insertInbox } from '../routes/projects.js';
import { tagKey } from '../routes/tasks.js';
import { genId, nowIso, parseApiDate, sha256Hex } from '../util.js';

/**
 * TickTick backup import. The browser parses TickTick's CSV backup and posts
 * one list at a time, in chunks, already shaped like NodeTick tasks; this
 * module validates the values and writes the list (with its folder and
 * kanban columns) and the tasks in a single D1 batch per chunk.
 *
 * Ids derive from the user id and TickTick's ids, so importing the same
 * backup again only adds tasks that are new since the last run and never
 * overwrites what the user has changed in NodeTick.
 */

export const MAX_TICKTICK_CHUNK = 200;
const MAX_EXTERNAL_ID = 1024;
const MAX_NAME = 256;
const MAX_FOLDER = 64;
const MAX_COLUMN = 128;
const MAX_COLUMNS = 50;
// Mirrors the task route limits so imported rows stay editable in the app.
const MAX_TITLE = 1024;
const MAX_CONTENT = 64 * 1024;
const MAX_TAGS = 100;
const MAX_TAG_LENGTH = 64;
const MAX_ITEMS = 100;
const MAX_ITEM_TITLE = 512;
const MAX_REMINDERS = 20;
const MAX_REPEAT = 512;
const MAX_TAGS_PER_CHUNK = 500;
const VIEW_MODES = new Set(['list', 'kanban', 'timeline']);
const KINDS = new Set(['TASK', 'NOTE', 'CHECKLIST']);
const PRIORITIES = new Set([0, 1, 3, 5]);
const STATUSES = new Set([0, 2, -1]);
// What the reminder dispatcher can read (services/notifications.ts reminderOffset).
const TRIGGER = /^TRIGGER:-?P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/;

/** Import rejection with the HTTP status the caller should return. */
export class TickTickImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = 'TickTickImportError';
  }
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

async function stableId(kind: 'list' | 'folder' | 'column' | 'task', userId: string, externalId: string): Promise<string> {
  return (await sha256Hex(`ticktick:${kind}:${userId}:${externalId}`)).slice(0, 24);
}

/** A date the task routes would accept, or null. */
function apiDate(value: unknown): string | null {
  return typeof value === 'string' && typeof parseApiDate(value) === 'number' ? value.trim() : null;
}

function strings(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim().slice(0, maxLength);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

export interface TickTickTask {
  id: string;
  parentId: string | null;
  title: string;
  content: string | null;
  kind: string;
  startDate: string | null;
  dueDate: string | null;
  timeZone: string | null;
  isAllDay: boolean;
  priority: number;
  status: number;
  repeatFlag: string | null;
  reminders: string[];
  items: { title: string; status: number }[];
  tags: string[];
  completedTime: string | null;
  createdTime: string | null;
  sortOrder: number;
  column: string | null;
}

/** Validate one posted task; null when it has no usable TickTick id. */
export function readTickTickTask(value: unknown): TickTickTask | null {
  const task = obj(value);
  const id = str(task?.id).trim();
  if (!task || !id || id.length > MAX_EXTERNAL_ID) return null;
  const parentId = str(task.parentId).trim();
  const kind = str(task.kind).toUpperCase();
  const priority = Number(task.priority);
  const status = Number(task.status);
  const sortOrder = Number(task.sortOrder);
  const repeat = str(task.repeatFlag).trim();
  const column = str(task.column).trim().slice(0, MAX_COLUMN);
  const items = Array.isArray(task.items)
    ? task.items.flatMap((raw) => {
      const item = obj(raw);
      const title = str(item?.title).trim().slice(0, MAX_ITEM_TITLE);
      return title ? [{ title, status: Number(item?.status) === 2 ? 2 : 0 }] : [];
    }).slice(0, MAX_ITEMS)
    : [];
  const startDate = apiDate(task.startDate);
  let dueDate = apiDate(task.dueDate);
  // An end before the start would be rejected by the task routes: keep the start.
  if (startDate && dueDate && (parseApiDate(dueDate) as number) < (parseApiDate(startDate) as number)) dueDate = null;
  return {
    id,
    parentId: parentId && parentId.length <= MAX_EXTERNAL_ID && parentId !== id ? parentId : null,
    title: str(task.title).trim().slice(0, MAX_TITLE),
    content: str(task.content).slice(0, MAX_CONTENT) || null,
    kind: KINDS.has(kind) ? kind : 'TASK',
    startDate,
    dueDate,
    timeZone: str(task.timeZone).trim().slice(0, 64) || null,
    isAllDay: task.isAllDay === true,
    priority: PRIORITIES.has(priority) ? priority : 0,
    status: STATUSES.has(status) ? status : 0,
    repeatFlag: repeat.startsWith('RRULE:') && repeat.length <= MAX_REPEAT && !/[\r\n]/.test(repeat) ? repeat : null,
    reminders: strings(task.reminders, MAX_REMINDERS, 64).filter((reminder) => TRIGGER.test(reminder)),
    items,
    tags: strings(task.tags, MAX_TAGS, MAX_TAG_LENGTH),
    completedTime: apiDate(task.completedTime),
    createdTime: apiDate(task.createdTime),
    sortOrder: Number.isSafeInteger(sortOrder) ? sortOrder : 0,
    column: column || null,
  };
}

export interface TickTickChunkResult {
  projectId: string;
  /** Tasks added by this request. */
  created: number;
  /** Tasks skipped because an earlier import already added them. */
  skipped: number;
  /** Entries without a usable TickTick id. */
  invalid: number;
}

/**
 * Import one chunk: `{ list: { name, folder?, viewMode?, inbox? },
 * columns?: [{ name, sortOrder }], tasks: [...] }`. The inbox list goes into
 * the inbox; other lists become (or reuse) a project in a group named after
 * the TickTick folder. Subtasks keep their parent when it is imported too
 * (the client sends parents first and keeps families in one chunk).
 */
export async function importTickTickChunk(env: Env, userId: string, body: Json): Promise<TickTickChunkResult> {
  const source = obj(body.list);
  const name = str(source?.name).trim().slice(0, MAX_NAME);
  if (!source || !name) throw new TickTickImportError('list.name is required', 400);
  if (!Array.isArray(body.tasks)) throw new TickTickImportError('tasks must be an array', 400);
  if (body.tasks.length > MAX_TICKTICK_CHUNK) {
    throw new TickTickImportError(`too many tasks (max ${MAX_TICKTICK_CHUNK} per request)`, 413);
  }
  const folder = str(source.folder).trim().slice(0, MAX_FOLDER);
  const viewMode = VIEW_MODES.has(str(source.viewMode)) ? str(source.viewMode) : 'list';
  const isInbox = source.inbox === true;
  const db = env.DB;
  const now = Date.now();
  const iso = nowIso();

  const projectId = isInbox ? INBOX_ID : await stableId('list', userId, `${folder}\u0000${name}`);
  const groupId = !isInbox && folder ? await stableId('folder', userId, folder) : null;
  const statements: D1PreparedStatement[] = [];
  if (groupId) {
    statements.push(db.prepare(
      'INSERT INTO project_groups (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING',
    ).bind(groupId, userId, folder, now));
  }
  // A list imported before keeps whatever the user has changed since.
  statements.push(isInbox
    ? insertInbox(db, userId)
    : db.prepare(
      `INSERT INTO projects (id, user_id, name, sort_order, view_mode, kind, group_id, created_at)
       VALUES (?, ?, ?, 0, ?, 'TASK', ?, ?) ON CONFLICT(id, user_id) DO NOTHING`,
    ).bind(projectId, userId, name, viewMode, groupId, now));

  // Kanban columns, by name: tasks name the column they sit in.
  const columnIds = new Map<string, string>();
  const columns = Array.isArray(body.columns) ? body.columns.slice(0, MAX_COLUMNS) : [];
  for (const raw of columns) {
    const column = obj(raw);
    const columnName = str(column?.name).trim().slice(0, MAX_COLUMN);
    if (!columnName || columnIds.has(columnName)) continue;
    const id = await stableId('column', userId, `${projectId}\u0000${columnName}`);
    columnIds.set(columnName, id);
    const order = Number(column?.sortOrder);
    statements.push(db.prepare(
      `INSERT INTO task_columns (id, user_id, project_id, name, sort_order, created_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(id, userId, projectId, columnName, Number.isSafeInteger(order) ? order : 0, now, projectId, userId));
  }

  const tags = new Map<string, string>();
  const taskStatements: D1PreparedStatement[] = [];
  const childLinks: D1PreparedStatement[] = [];
  let invalid = 0;
  for (const value of body.tasks) {
    const task = readTickTickTask(value);
    if (!task) {
      invalid++;
      continue;
    }
    for (const tag of task.tags) {
      if (tags.size < MAX_TAGS_PER_CHUNK && !tags.has(tagKey(tag))) tags.set(tagKey(tag), tag);
    }
    const id = await stableId('task', userId, task.id);
    const parentId = task.parentId ? await stableId('task', userId, task.parentId) : null;
    const items = task.items.map((item, index) => ({
      id: genId(),
      title: item.title,
      status: item.status,
      sortOrder: index,
      startDate: null,
      isAllDay: false,
      timeZone: null,
      completedTime: null,
    }));
    const completedTime = task.status === 0 ? null : task.completedTime;
    const createdTime = task.createdTime ?? iso;
    // `WHERE true` lets SQLite tell the upsert clause from a join's ON.
    taskStatements.push(db.prepare(
      `INSERT INTO tasks
        (id, user_id, project_id, title, content, kind, start_date, due_date, time_zone, is_all_day, priority,
         status, sort_order, repeat_flag, reminders, items, tags, parent_id, column_id, completed_time,
         created_time, modified_time)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM tasks p WHERE p.id = ? AND p.user_id = ? AND p.project_id = ? AND p.deleted = 0) THEN ? END,
         ?, ?, ?, ?
       WHERE true
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      id, userId, projectId, task.title, task.content, task.kind, task.startDate, task.dueDate, task.timeZone,
      task.isAllDay ? 1 : 0, task.priority, task.status, task.sortOrder, task.repeatFlag,
      task.reminders.length ? JSON.stringify(task.reminders) : null,
      items.length ? JSON.stringify(items) : null,
      task.tags.length ? JSON.stringify(task.tags) : null,
      parentId, parentId, userId, projectId, parentId,
      task.column ? columnIds.get(task.column) ?? null : null,
      completedTime, createdTime, createdTime,
    ));
    if (parentId) {
      // Record the child on its parent once the child really points there
      // (a re-import must not re-add a subtask the user has moved since).
      childLinks.push(db.prepare(
        `UPDATE tasks SET child_ids = json_insert(CASE WHEN json_valid(child_ids) THEN child_ids ELSE '[]' END, '$[#]', ?)
         WHERE id = ? AND user_id = ? AND deleted = 0
           AND EXISTS (SELECT 1 FROM tasks c WHERE c.id = ? AND c.user_id = ? AND c.parent_id = ?)
           AND NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(tasks.child_ids) THEN tasks.child_ids ELSE '[]' END) WHERE value = ?)`,
      ).bind(id, parentId, userId, id, userId, parentId, id));
    }
  }
  for (const [tagName, label] of tags) {
    statements.push(db.prepare(
      'INSERT INTO tags (id, user_id, name, label, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO NOTHING',
    ).bind(genId(), userId, tagName, label, now));
  }

  // One batch is one D1 query against the per-request limit, however large.
  const results = await db.batch([...statements, ...taskStatements, ...childLinks]);
  const created = results
    .slice(statements.length, statements.length + taskStatements.length)
    .reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  return { projectId, created, skipped: taskStatements.length - created, invalid };
}
