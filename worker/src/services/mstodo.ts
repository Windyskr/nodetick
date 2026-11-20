import type { Env } from '../env.js';
import { addDays, dayOf, nextOccurrence } from '../recurrence.js';
import { INBOX_ID, insertInbox } from '../routes/projects.js';
import { tagKey } from '../routes/tasks.js';
import { daysInMonth, genId, nowIso, sha256Hex } from '../util.js';
import { localParts, zonedTimestamp } from './notifications.js';

/**
 * Microsoft To Do import. The browser reads lists and tasks from Microsoft
 * Graph and posts them here one chunk at a time, in Graph's own shape; this
 * module maps them to NodeTick projects and tasks.
 *
 * Ids are derived from the user id and the Graph id, so importing the same
 * list again only adds tasks that are new since the last run and never
 * overwrites what the user has changed in NodeTick since.
 */

/** Most tasks one import request may carry (the client sends 100). */
export const MAX_CHUNK_TASKS = 200;
const MAX_EXTERNAL_ID = 1024;
const MAX_TAGS_PER_CHUNK = 500;
// Mirrors the task route limits so imported rows stay editable in the app.
const MAX_TITLE = 1024;
const MAX_CONTENT = 64 * 1024;
const MAX_TAGS = 100;
const MAX_TAG_LENGTH = 64;
const MAX_ITEMS = 100;
const MAX_ITEM_TITLE = 512;
const MAX_PROJECT_NAME = 256;

/** Import rejection with the HTTP status the caller should return. */
export class MsTodoImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = 'MsTodoImportError';
  }
}

export interface MapContext {
  /** The user's IANA zone: due dates and reminders are read in it. */
  timeZone: string;
  /** "HH:mm" at which all-day reminders fire (notification settings). */
  allDayTime: string;
  /** Fallback timestamp for rows without one (NodeTick's ISO format). */
  now: string;
}

export interface ImportedItem {
  id: string;
  title: string;
  status: number;
  sortOrder: number;
  startDate: null;
  isAllDay: false;
  timeZone: null;
  completedTime: string | null;
}

export interface MappedTask {
  title: string;
  content: string | null;
  startDate: string | null;
  dueDate: string | null;
  timeZone: string | null;
  isAllDay: boolean;
  priority: number;
  status: number;
  repeatFlag: string | null;
  reminders: string[];
  items: ImportedItem[];
  tags: string[];
  completedTime: string | null;
  createdTime: string;
  modifiedTime: string;
  hasAttachments: boolean;
}

type Json = Record<string, unknown>;

const obj = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const pad = (n: number) => String(n).padStart(2, '0');

const UTC_ZONES = new Set(['', 'utc', 'etc/utc', 'etc/gmt', 'gmt', 'coordinated universal time', 'tzone://microsoft/utc']);
const GRAPH_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z)?$/;

function isIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  /** Calendar day in the user's zone. */
  day: string;
  hour: number;
  minute: number;
  /** The same moment as a UTC timestamp. */
  instant: number;
}

/**
 * Read a Graph dateTimeTimeZone in the user's zone. Graph answers in UTC
 * unless told otherwise; an IANA zone is converted; a Windows zone name
 * ("China Standard Time") is taken as the user's own wall clock.
 */
export function wallClock(value: unknown, timeZone: string): WallClock | null {
  const o = obj(value);
  const m = o ? GRAPH_DATE_TIME.exec(str(o.dateTime).trim()) : null;
  if (!o || !m) return null;
  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map((i) => Number(m[i] ?? 0));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const clock = `${pad(hour)}:${pad(minute)}`;
  const zone = m[7] ? 'UTC' : str(o.timeZone).trim();
  let instant: number | null;
  if (UTC_ZONES.has(zone.toLowerCase())) instant = Date.UTC(year, month - 1, day, hour, minute);
  else if (isIanaZone(zone)) instant = zonedTimestamp(date, clock, zone);
  else instant = zonedTimestamp(date, clock, timeZone);
  if (instant == null) return null;
  const local = localParts(new Date(instant), timeZone);
  return {
    day: `${local.year}-${pad(local.month)}-${pad(local.day)}`,
    hour: local.hour,
    minute: local.minute,
    instant,
  };
}

/**
 * The calendar day of a To Do due (or start) date. To Do stores the date as
 * midnight in the zone where it was set; read from another zone that moment
 * lands hours off, so round to the nearest midnight.
 */
export function dateOnly(value: unknown, timeZone: string): string | null {
  const clock = wallClock(value, timeZone);
  if (!clock) return null;
  return clock.hour >= 12 ? addDays(clock.day, 1) : clock.day;
}

/** A UTC timestamp as a timed NodeTick date in the user's zone: 2026-04-07T09:00:00+0800. */
export function localDateTime(instant: number, timeZone: string): string {
  const minuteStart = Math.floor(instant / 60000) * 60000;
  const p = localParts(new Date(minuteStart), timeZone);
  const offset = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - minuteStart) / 60000);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** A reminder this many milliseconds before its anchor, e.g. TRIGGER:-P1DT2H30M. */
export function triggerBefore(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes <= 0) return 'TRIGGER:-PT0M';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const time = hours || rest ? `T${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}` : '';
  return `TRIGGER:-P${days ? `${days}D` : ''}${time}`;
}

/** Graph DateTimeOffset ("2020-07-08T11:15:19.9359889Z") in NodeTick's "…19.935+0000" form. */
function isoTimestamp(value: unknown): string | null {
  const text = str(value).trim().replace(/(\.\d{3})\d+/, '$1');
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().replace('Z', '+0000');
}

const WEEKDAYS: Record<string, string> = {
  monday: 'MO', tuesday: 'TU', wednesday: 'WE', thursday: 'TH', friday: 'FR', saturday: 'SA', sunday: 'SU',
};
const WEEKDAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const WEEK_INDEX: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };

function boundedInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Occurrences left counting the one due on `dueDay`. Graph counts
 * numberOfOccurrences from the range start, NodeTick's COUNT from the
 * current occurrence (see recurrence.ts).
 */
function occurrencesLeft(rule: string, startDate: string, dueDay: string | null | undefined, total: number): number {
  if (!dueDay || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate >= dueDay) return total;
  let used = 0;
  for (let day: string | null = startDate; day !== null && day < dueDay && used < total; used++) {
    day = dayOf(nextOccurrence(rule, day));
  }
  return Math.max(1, total - used);
}

/**
 * Graph patternedRecurrence → RRULE. Weekly Monday–Friday becomes the
 * webapp's "weekdays" rule; relative patterns ("second Tuesday", "last
 * Friday") become ordinal BYDAY; an end date becomes UNTIL and a number of
 * occurrences becomes the COUNT left from the occurrence due on `dueDay`.
 */
export function repeatFlagOf(recurrence: unknown, dueDay?: string | null): string | null {
  const pattern = obj(obj(recurrence)?.pattern);
  if (!pattern) return null;
  const interval = boundedInt(pattern.interval, 1, 999) ?? 1;
  const days = WEEKDAY_ORDER.filter((code) =>
    list(pattern.daysOfWeek).some((day) => WEEKDAYS[str(day).toLowerCase()] === code));
  const monthDay = boundedInt(pattern.dayOfMonth, 1, 31);
  const month = boundedInt(pattern.month, 1, 12);
  const nth = WEEK_INDEX[str(pattern.index).toLowerCase()] ?? 1;
  const parts: string[] = [];
  switch (str(pattern.type)) {
    case 'daily':
      parts.push('FREQ=DAILY');
      break;
    case 'weekly':
      if (interval === 1 && days.join(',') === 'MO,TU,WE,TH,FR') {
        parts.push('FREQ=DAILY', 'BYDAY=MO,TU,WE,TH,FR');
        break;
      }
      parts.push('FREQ=WEEKLY');
      if (days.length) parts.push(`BYDAY=${days.join(',')}`);
      break;
    case 'absoluteMonthly':
      parts.push('FREQ=MONTHLY');
      if (monthDay) parts.push(`BYMONTHDAY=${monthDay}`);
      break;
    case 'relativeMonthly':
      parts.push('FREQ=MONTHLY');
      // Graph picks the first matching weekday when several are listed.
      if (days.length) parts.push(`BYDAY=${nth}${days[0]}`);
      break;
    case 'absoluteYearly':
      parts.push('FREQ=YEARLY');
      if (month) parts.push(`BYMONTH=${month}`);
      if (monthDay) parts.push(`BYMONTHDAY=${monthDay}`);
      break;
    case 'relativeYearly':
      parts.push('FREQ=YEARLY');
      if (month) parts.push(`BYMONTH=${month}`);
      if (days.length) parts.push(`BYDAY=${nth}${days[0]}`);
      break;
    default:
      return null;
  }
  if (interval > 1) parts.splice(1, 0, `INTERVAL=${interval}`);
  const range = obj(obj(recurrence)?.range);
  const endDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(range?.endDate));
  const count = boundedInt(range?.numberOfOccurrences, 1, 9999);
  if (str(range?.type) === 'endDate' && endDate) parts.push(`UNTIL=${endDate[1]}${endDate[2]}${endDate[3]}`);
  else if (str(range?.type) === 'numbered' && count) {
    parts.push(`COUNT=${occurrencesLeft(`RRULE:${parts.join(';')}`, str(range?.startDate), dueDay, count)}`);
  }
  return `RRULE:${parts.join(';')}`;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text of an HTML task body (Outlook writes HTML; the To Do apps write text). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Notes plus the links of linked resources (e.g. the mail behind a flagged-email task). */
function contentOf(task: Json): string | null {
  const body = obj(task.body);
  const raw = str(body?.content);
  const notes = str(body?.contentType).toLowerCase() === 'html' ? htmlToText(raw) : raw.replace(/\r\n?/g, '\n').trim();
  const links = list(task.linkedResources).flatMap((value) => {
    const resource = obj(value);
    const url = str(resource?.webUrl).trim();
    if (!resource || !/^https?:\/\//i.test(url)) return [];
    const name = (str(resource.displayName) || str(resource.applicationName)).trim();
    return [name && name !== url ? `${name}: ${url}` : url];
  });
  const content = [notes, links.join('\n')].filter(Boolean).join('\n\n');
  return content ? content.slice(0, MAX_CONTENT) : null;
}

function tagsOf(task: Json): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of list(task.categories)) {
    const label = str(value).trim().slice(0, MAX_TAG_LENGTH).trim();
    if (!label || seen.has(tagKey(label))) continue;
    seen.add(tagKey(label));
    tags.push(label);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function itemsOf(task: Json): ImportedItem[] {
  return list(task.checklistItems).flatMap((value) => {
    const item = obj(value);
    return item ? [item] : [];
  }).slice(0, MAX_ITEMS).map((item, index) => {
    const checked = item.isChecked === true;
    return {
      id: genId(),
      title: str(item.displayName).slice(0, MAX_ITEM_TITLE),
      status: checked ? 2 : 0,
      sortOrder: index,
      startDate: null,
      isAllDay: false,
      timeZone: null,
      completedTime: checked ? isoTimestamp(item.checkedDateTime) : null,
    };
  });
}

const allDay = (day: string) => `${day}T00:00:00+0000`;

/**
 * Dates and reminders. To Do has date-only due dates plus a reminder at an
 * exact moment; NodeTick reminders are offsets from the task's date. A
 * reminder without a due date, or on the due day, makes a timed task that
 * reminds on time. A reminder on an earlier day becomes an offset before the
 * all-day reminder time of the due day.
 */
function scheduleOf(task: Json, ctx: MapContext) {
  const due = dateOnly(task.dueDateTime, ctx.timeZone);
  const start = dateOnly(task.startDateTime, ctx.timeZone);
  const reminder = task.isReminderOn === true ? wallClock(task.reminderDateTime, ctx.timeZone) : null;
  if (reminder && (!due || reminder.day === due)) {
    return {
      startDate: null,
      dueDate: localDateTime(reminder.instant, ctx.timeZone),
      isAllDay: false,
      reminders: ['TRIGGER:-PT0M'],
    };
  }
  const day = due ?? start;
  if (!day) return { startDate: null, dueDate: null, isAllDay: false, reminders: [] as string[] };
  const reminders: string[] = [];
  if (reminder) {
    const anchor = zonedTimestamp(day, ctx.allDayTime, ctx.timeZone);
    // A reminder after the due day has no NodeTick equivalent: remind on the day.
    reminders.push(anchor != null && reminder.instant < anchor ? triggerBefore(anchor - reminder.instant) : 'TRIGGER:-PT0M');
  }
  return {
    startDate: start && due && start < due ? allDay(start) : null,
    dueDate: allDay(day),
    isAllDay: true,
    reminders,
  };
}

/** One Graph todoTask as the fields of a NodeTick task. */
export function mapMicrosoftTask(task: Json, ctx: MapContext): MappedTask {
  const completed = str(task.status) === 'completed';
  const schedule = scheduleOf(task, ctx);
  const importance = str(task.importance);
  const modifiedTime = isoTimestamp(task.lastModifiedDateTime) ?? ctx.now;
  const completedAt = wallClock(task.completedDateTime, ctx.timeZone);
  return {
    title: str(task.title).trim().slice(0, MAX_TITLE),
    content: contentOf(task),
    ...schedule,
    timeZone: schedule.dueDate ? ctx.timeZone : null,
    priority: importance === 'high' ? 5 : importance === 'low' ? 1 : 0,
    status: completed ? 2 : 0,
    // To Do clones a recurring task when it is completed, so the completed
    // copy no longer repeats; keeping the rule would let NodeTick clone it again.
    repeatFlag: schedule.dueDate && !completed ? repeatFlagOf(task.recurrence, dayOf(schedule.dueDate)) : null,
    items: itemsOf(task),
    tags: tagsOf(task),
    completedTime: completed
      ? (completedAt ? new Date(completedAt.instant).toISOString().replace('Z', '+0000') : modifiedTime)
      : null,
    createdTime: isoTimestamp(task.createdDateTime) ?? ctx.now,
    modifiedTime,
    hasAttachments: task.hasAttachments === true,
  };
}

async function stableId(kind: 'list' | 'task', userId: string, externalId: string): Promise<string> {
  return (await sha256Hex(`mstodo:${kind}:${userId}:${externalId}`)).slice(0, 24);
}

export interface ImportChunkResult {
  projectId: string;
  /** Tasks added by this request. */
  created: number;
  /** Tasks skipped because an earlier import already added them. */
  skipped: number;
  /** Entries without a usable Graph id. */
  invalid: number;
  /** Tasks in the chunk with file attachments, which are never imported. */
  attachments: number;
}

/**
 * Import one chunk: `{ list: { id, displayName, wellknownListName },
 * tasks: todoTask[], timeZone? }`. To Do's built-in "Tasks" list goes into
 * the inbox; every other list becomes (or reuses) a project. Graph exposes no
 * manual task order, so tasks keep sort order 0 like new ones and sort by date.
 * Everything is written in one D1 batch, which counts as a single query
 * against the Free plan's 50 queries per request.
 */
export async function importMicrosoftTodoChunk(env: Env, userId: string, body: Json): Promise<ImportChunkResult> {
  const source = obj(body.list);
  const listId = str(source?.id).trim();
  if (!source || !listId || listId.length > MAX_EXTERNAL_ID) {
    throw new MsTodoImportError('list.id is required', 400);
  }
  if (!Array.isArray(body.tasks)) throw new MsTodoImportError('tasks must be an array', 400);
  if (body.tasks.length > MAX_CHUNK_TASKS) {
    throw new MsTodoImportError(`too many tasks (max ${MAX_CHUNK_TASKS} per request)`, 413);
  }
  const settings = await env.DB.prepare('SELECT timezone, all_day_time FROM notification_settings WHERE user_id = ?')
    .bind(userId)
    .first<{ timezone: string; all_day_time: string }>();
  const ctx: MapContext = {
    // The browser's zone, else the one notifications use.
    timeZone: [str(body.timeZone).trim(), settings?.timezone ?? ''].find((zone) => zone && isIanaZone(zone)) ?? 'UTC',
    allDayTime: /^\d{2}:\d{2}$/.test(settings?.all_day_time ?? '') ? settings!.all_day_time : '09:00',
    now: nowIso(),
  };

  const db = env.DB;
  const isInbox = str(source.wellknownListName) === 'defaultList';
  const projectId = isInbox ? INBOX_ID : await stableId('list', userId, listId);
  const projectName = (str(source.displayName).trim() || 'Microsoft To Do').slice(0, MAX_PROJECT_NAME);
  const statements: D1PreparedStatement[] = [
    isInbox
      ? insertInbox(db, userId)
      // A list imported before keeps whatever name the user has given it since.
      : db.prepare(
        `INSERT INTO projects (id, user_id, name, sort_order, view_mode, kind, created_at)
         VALUES (?, ?, ?, 0, 'list', 'TASK', ?) ON CONFLICT(id, user_id) DO NOTHING`,
      ).bind(projectId, userId, projectName, Date.now()),
  ];

  const tags = new Map<string, string>();
  const taskStatements: D1PreparedStatement[] = [];
  let invalid = 0;
  let attachments = 0;
  for (const value of body.tasks) {
    const task = obj(value);
    const externalId = str(task?.id).trim();
    if (!task || !externalId || externalId.length > MAX_EXTERNAL_ID) {
      invalid++;
      continue;
    }
    const mapped = mapMicrosoftTask(task, ctx);
    if (mapped.hasAttachments) attachments++;
    for (const tag of mapped.tags) {
      if (tags.size < MAX_TAGS_PER_CHUNK && !tags.has(tagKey(tag))) tags.set(tagKey(tag), tag);
    }
    taskStatements.push(db.prepare(
      `INSERT INTO tasks
        (id, user_id, project_id, title, content, kind, start_date, due_date, time_zone, is_all_day, priority,
         status, sort_order, repeat_flag, reminders, items, tags, completed_time, created_time, modified_time)
       VALUES (?, ?, ?, ?, ?, 'TASK', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      await stableId('task', userId, externalId),
      userId,
      projectId,
      mapped.title,
      mapped.content,
      mapped.startDate,
      mapped.dueDate,
      mapped.timeZone,
      mapped.isAllDay ? 1 : 0,
      mapped.priority,
      mapped.status,
      mapped.repeatFlag,
      mapped.reminders.length ? JSON.stringify(mapped.reminders) : null,
      mapped.items.length ? JSON.stringify(mapped.items) : null,
      mapped.tags.length ? JSON.stringify(mapped.tags) : null,
      mapped.completedTime,
      mapped.createdTime,
      mapped.modifiedTime,
    ));
  }
  for (const [name, label] of tags) {
    statements.push(db.prepare(
      'INSERT INTO tags (id, user_id, name, label, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO NOTHING',
    ).bind(genId(), userId, name, label, Date.now()));
  }

  const results = await db.batch([...statements, ...taskStatements]);
  const created = results.slice(statements.length).reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  return { projectId, created, skipped: taskStatements.length - created, invalid, attachments };
}
