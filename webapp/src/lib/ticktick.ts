/**
 * TickTick backup import, browser side: read the CSV that TickTick's
 * "Generate backup" produces, map each row to a NodeTick-shaped task, group
 * them by list and post them to /api/import/ticktick/tasks in chunks.
 *
 * TickTick documents no format for the file. What is known from parsers in
 * the wild: a few metadata lines precede the header row; columns are Folder
 * Name, List Name, Title, Kind, Tags, Content, Is Check list, Start Date,
 * Due Date, Reminder, Repeat, Priority, Status (0 normal, 1 completed,
 * 2 archived), Created Time, Completed Time, Order, Timezone, Is All Day,
 * Is Floating, Column Name, Column Order, View Mode, taskId and parentId;
 * times look like 2025-12-27T03:57:34+0000; checklist items are concatenated
 * into Content, each after ▫ (open) or ▪ (done). Columns are read by name
 * and every value is optional, so other versions of the file still import.
 */

export interface ImportTask {
  id: string;
  parentId: string | null;
  title: string;
  content: string | null;
  kind: 'TASK' | 'NOTE';
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

export interface TickTickList {
  key: string;
  folder: string;
  name: string;
  /** TickTick's inbox, imported into NodeTick's inbox. */
  inbox: boolean;
  viewMode: 'list' | 'kanban' | 'timeline';
  columns: { name: string; sortOrder: number }[];
  tasks: ImportTask[];
}

export interface TickTickBackup {
  lists: TickTickList[];
  /** Rows that could not be read (too few cells). */
  invalid: number;
}

export class TickTickFormatError extends Error {}

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2025-12-27T03:57:34+0000" (or with .000, Z, +00:00) as a timestamp. */
export function parseInstant(value: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const zone = match[4] ? (match[4] === 'Z' ? 'Z' : `${match[4].slice(0, 3)}:${match[4].slice(-2)}`) : 'Z';
  const ms = Date.parse(`${match[1]}T${match[2] ?? '00:00'}:${match[3] ?? '00'}${zone}`);
  return Number.isNaN(ms) ? null : ms;
}

/** NodeTick's API form of an instant: yyyy-MM-ddTHH:mm:ss+0000. */
function apiInstant(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');
}

function validZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day of an instant in `timeZone`. */
function dayIn(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

const truthy = (value: string | undefined) => /^(y|yes|true|1)$/i.test((value ?? '').trim());

const TRIGGER = /^(-?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** Signed minutes of an iCal duration such as -P1DT15H or PT0S; null if malformed. */
export function triggerMinutes(value: string): number | null {
  const match = TRIGGER.exec(value.trim().replace(/^TRIGGER:/i, '').toUpperCase());
  if (!match || /^-?P$/.test(match[0])) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total = Number(weeks ?? 0) * 7 * 1440 + Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0) + Math.floor(Number(seconds ?? 0) / 60);
  return sign ? -total : total;
}

/** A positive number of minutes as an iCal duration in days, hours and minutes (no weeks: the notifier reads D/H/M/S). */
const duration = (minutes: number) => {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return `P${days ? `${days}D` : ''}${hours || rest ? `T${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}` : ''}`;
};

/**
 * NodeTick reminders. Timed tasks keep TickTick's offsets before the start.
 * TickTick counts all-day reminders from midnight (P0DT9H = 09:00 that day,
 * -P0DT15H = 09:00 the day before); NodeTick fires all-day reminders at the
 * user's all-day time, so they become whole days before the date.
 */
export function mapReminders(value: string, allDay: boolean): string[] {
  const out: string[] = [];
  for (const token of value.split(/[,;\n\r]+/)) {
    const minutes = token.trim() ? triggerMinutes(token) : null;
    if (minutes == null) continue;
    const before = allDay ? -Math.floor(minutes / 1440) * 1440 : -minutes;
    if (before < 0) continue; // after the date or start: NodeTick cannot remind then
    const reminder = before === 0 ? 'TRIGGER:PT0S' : `TRIGGER:-${duration(before)}`;
    if (!out.includes(reminder)) out.push(reminder);
  }
  return out.slice(0, 20);
}

function repeatFlag(value: string): string | null {
  const line = value.split(/\r?\n|\r/).map((part) => part.trim()).find((part) => /FREQ=/i.test(part));
  if (!line) return null;
  const rule = line.replace(/^RRULE:/i, '').trim();
  return /^[A-Za-z0-9=;,:+\-]+$/.test(rule) && rule.length <= 500 ? `RRULE:${rule.toUpperCase()}` : null;
}

function priority(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n >= 5 ? 5 : n >= 3 ? 3 : n >= 1 ? 1 : 0;
}

/** TickTick's CSV codes: 0 normal, 1 completed, 2 archived (closed); -1 is won't do. */
function status(value: string): number {
  const n = Number(value.trim());
  if (n === 1 || n === 2) return 2;
  if (n === -1) return -1;
  return 0;
}

function tags(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(/[,，]/)) {
    const tag = part.trim().replace(/^#/, '').slice(0, 64);
    if (tag && !out.some((existing) => existing.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 100);
}

/** Checklist tasks: text before the first ▫/▪ is the description, each marker starts an item. */
export function splitChecklist(content: string): { content: string; items: { title: string; status: number }[] } {
  const parts = content.split(/([▫▪])/);
  const items: { title: string; status: number }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i + 1]?.trim();
    if (title) items.push({ title: title.slice(0, 512), status: parts[i] === '▪' ? 2 : 0 });
  }
  return { content: parts[0].trim(), items: items.slice(0, 100) };
}

/** One CSV row as a task, in the user's zone when the row names none. */
export function mapRow(row: Record<string, string>, fallbackZone: string): ImportTask & { folder: string; list: string; viewMode: string; columnOrder: number } {
  const zone = validZone(row['Timezone']?.trim() ?? '') ? row['Timezone'].trim() : fallbackZone;
  const allDay = truthy(row['Is All Day']);
  const start = parseInstant(row['Start Date'] ?? '');
  const due = parseInstant(row['Due Date'] ?? '');
  let startDate: string | null = null;
  let dueDate: string | null = null;
  if (allDay) {
    // NodeTick keeps all-day days as <day>T00:00:00+0000 with an inclusive
    // end; TickTick stores local midnight in UTC and an exclusive end.
    const startDay = start != null ? dayIn(start, zone) : null;
    let dueDay = due != null ? dayIn(due, zone) : null;
    if (startDay && dueDay && dueDay > startDay) dueDay = previousDay(dueDay);
    startDate = startDay ? `${startDay}T00:00:00+0000` : null;
    dueDate = dueDay ? `${dueDay}T00:00:00+0000` : null;
  } else {
    startDate = start != null ? apiInstant(start) : null;
    dueDate = due != null ? apiInstant(due) : null;
  }
  // A single moment or day is a due date, as NodeTick's own tasks have it.
  if (startDate && dueDate && startDate === dueDate) startDate = null;
  if (startDate && !dueDate) [startDate, dueDate] = [null, startDate];

  const kindValue = (row['Kind'] ?? '').trim().toUpperCase();
  let content = (row['Content'] ?? '').replace(/\r\n?/g, '\n');
  let items: ImportTask['items'] = [];
  if (kindValue === 'CHECKLIST' || truthy(row['Is Check list'])) ({ content, items } = splitChecklist(content));
  const taskStatus = status(row['Status'] ?? '');
  const completed = parseInstant(row['Completed Time'] ?? '');
  const created = parseInstant(row['Created Time'] ?? '');
  const order = Number(row['Order']);
  const columnOrder = Number(row['Column Order']);
  const folder = (row['Folder Name'] ?? '').trim();
  const list = (row['List Name'] ?? '').trim();
  const title = (row['Title'] ?? '').replace(/\s+/g, ' ').trim();
  return {
    id: ((row['taskId'] ?? '').trim() || `csv:${folder}/${list}/${title}/${row['Created Time'] ?? ''}`).slice(0, 1024),
    parentId: (row['parentId'] ?? '').trim() || null,
    title: title.slice(0, 1024),
    content: content.trim() ? content.slice(0, 64 * 1024) : null,
    kind: kindValue === 'NOTE' ? 'NOTE' : 'TASK',
    startDate,
    dueDate,
    timeZone: startDate || dueDate ? zone : null,
    isAllDay: allDay && Boolean(startDate || dueDate),
    priority: priority(row['Priority'] ?? ''),
    status: taskStatus,
    repeatFlag: repeatFlag(row['Repeat'] ?? ''),
    reminders: mapReminders(row['Reminder'] ?? '', allDay),
    items,
    tags: tags(row['Tags'] ?? ''),
    completedTime: taskStatus !== 0 && completed != null ? apiInstant(completed) : null,
    createdTime: created != null ? apiInstant(created) : null,
    sortOrder: Number.isSafeInteger(order) ? order : 0,
    column: (row['Column Name'] ?? '').trim().slice(0, 128) || null,
    folder,
    list,
    viewMode: (row['View Mode'] ?? '').trim().toLowerCase(),
    columnOrder: Number.isSafeInteger(columnOrder) ? columnOrder : 0,
  };
}

const INBOX_NAMES = /^(inbox|收集箱)$/i;

/** Parse a TickTick CSV backup into lists of tasks, in the order the file lists them. */
export function readTickTickBackup(text: string, fallbackZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): TickTickBackup {
  const body = text.replace(/^﻿/, '');
  // Metadata lines (date, version, a status legend) come before the header.
  let at = body.indexOf('"Folder Name"');
  if (at < 0) at = body.search(/^Folder Name,/m);
  if (at < 0) throw new TickTickFormatError('not a TickTick backup');
  const [header, ...rows] = parseCsv(body.slice(at));
  const names = header.map((name) => name.trim());
  if (!names.includes('Title') || !names.includes('List Name')) throw new TickTickFormatError('not a TickTick backup');
  const zone = validZone(fallbackZone) ? fallbackZone : 'UTC';
  const lists = new Map<string, TickTickList>();
  let invalid = 0;
  for (const cells of rows) {
    if (cells.length === 1 && cells[0].trim() === '') continue; // blank line
    if (cells.length < Math.min(names.length, 3)) {
      invalid++;
      continue;
    }
    const record: Record<string, string> = {};
    names.forEach((name, index) => { record[name] = cells[index] ?? ''; });
    const task = mapRow(record, zone);
    const inbox = !task.folder && (!task.list || INBOX_NAMES.test(task.list));
    const key = inbox ? '\u0000inbox' : `${task.folder}\u0000${task.list}`;
    let list = lists.get(key);
    if (!list) {
      list = { key, folder: inbox ? '' : task.folder, name: inbox ? 'Inbox' : task.list, inbox, viewMode: 'list', columns: [], tasks: [] };
      lists.set(key, list);
    }
    if (task.viewMode === 'kanban' || task.viewMode === 'timeline') list.viewMode = task.viewMode;
    if (task.column && !list.columns.some((column) => column.name === task.column)) {
      list.columns.push({ name: task.column, sortOrder: task.columnOrder });
    }
    const { folder: _folder, list: _list, viewMode: _viewMode, columnOrder: _columnOrder, ...plain } = task;
    list.tasks.push(plain);
  }
  for (const list of lists.values()) list.columns.sort((a, b) => a.sortOrder - b.sortOrder);
  return { lists: [...lists.values()], invalid };
}

/**
 * Chunks of at most `size` tasks with every parent before its subtasks and,
 * where they fit, a whole family in one chunk.
 */
export function chunkFamilies(tasks: ImportTask[], size = 100): ImportTask[][] {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string, ImportTask[]>();
  const roots: ImportTask[] = [];
  for (const task of tasks) {
    if (task.parentId && task.parentId !== task.id && ids.has(task.parentId)) {
      children.set(task.parentId, [...(children.get(task.parentId) ?? []), task]);
    } else roots.push(task);
  }
  const seen = new Set<string>();
  const family = (root: ImportTask): ImportTask[] => {
    const out: ImportTask[] = [];
    const stack = [root];
    while (stack.length) {
      const task = stack.shift()!;
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      out.push(task);
      stack.unshift(...(children.get(task.id) ?? []));
    }
    return out;
  };
  const families = roots.map(family);
  // Parent cycles leave tasks no root reaches; import them on their own.
  for (const task of tasks) if (!seen.has(task.id)) families.push(family(task));

  const chunks: ImportTask[][] = [];
  let current: ImportTask[] = [];
  for (const members of families) {
    if (current.length && current.length + members.length > size) {
      chunks.push(current);
      current = [];
    }
    for (const task of members) {
      if (current.length === size) {
        chunks.push(current);
        current = [];
      }
      current.push(task);
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export interface TickTickChunk {
  list: { name: string; folder: string; viewMode: string; inbox: boolean };
  columns: { name: string; sortOrder: number }[];
  tasks: ImportTask[];
}

export interface TickTickChunkResult {
  projectId: string;
  created: number;
  skipped: number;
  invalid: number;
}

export interface TickTickProgress {
  list: TickTickList;
  listIndex: number;
  listCount: number;
}

export interface TickTickTotals {
  lists: number;
  created: number;
  skipped: number;
}

/** Import the lists one chunk at a time; open tasks only unless asked otherwise. */
export async function importTickTickLists(
  lists: TickTickList[],
  opts: {
    includeCompleted: boolean;
    send: (chunk: TickTickChunk) => Promise<TickTickChunkResult>;
    signal?: AbortSignal;
    onProgress?: (progress: TickTickProgress, totals: TickTickTotals) => void;
  },
): Promise<TickTickTotals> {
  const totals: TickTickTotals = { lists: 0, created: 0, skipped: 0 };
  for (const [listIndex, list] of lists.entries()) {
    opts.onProgress?.({ list, listIndex, listCount: lists.length }, totals);
    const tasks = opts.includeCompleted ? list.tasks : list.tasks.filter((task) => task.status === 0);
    const target = { name: list.name, folder: list.folder, viewMode: list.viewMode, inbox: list.inbox };
    // An empty list still becomes an (empty) NodeTick list.
    for (const chunk of tasks.length ? chunkFamilies(tasks) : [[]]) {
      opts.signal?.throwIfAborted();
      const result = await opts.send({ list: target, columns: list.columns, tasks: chunk });
      totals.created += result.created;
      totals.skipped += result.skipped;
    }
    totals.lists++;
  }
  return totals;
}
