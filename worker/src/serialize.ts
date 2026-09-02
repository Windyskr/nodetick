import { parseJsonArray } from './util.js';

type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function serializeTask(r: Row) {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    title: String(r.title),
    content: str(r.content) ?? '',
    desc: str(r.task_desc) ?? '',
    kind: str(r.kind) ?? 'TASK',
    startDate: str(r.start_date),
    dueDate: str(r.due_date),
    timeZone: str(r.time_zone),
    isAllDay: !!r.is_all_day,
    priority: Number(r.priority ?? 0),
    status: Number(r.status ?? 0),
    sortOrder: Number(r.sort_order ?? 0),
    repeatFlag: str(r.repeat_flag),
    reminders: parseJsonArray<string>(r.reminders as string),
    items: parseJsonArray<Record<string, unknown>>(r.items as string),
    tags: parseJsonArray<string>(r.tags as string),
    parentId: str(r.parent_id),
    childIds: parseJsonArray<string>(r.child_ids as string),
    columnId: str(r.column_id),
    columnName: null,
    completedTime: str(r.completed_time),
    focusSummaries: parseJsonArray<Record<string, unknown>>(r.focus_summaries as string),
    etag: String(r.etag ?? 0),
    createdTime: str(r.created_time),
    modifiedTime: str(r.modified_time),
    deletedTime: str(r.deleted_time),
  };
}

export function serializeProject(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name),
    color: str(r.color),
    sortOrder: Number(r.sort_order ?? 0),
    closed: !!r.closed,
    groupId: str(r.group_id),
    viewMode: str(r.view_mode) ?? 'list',
    permission: str(r.permission) ?? 'write',
    kind: str(r.kind) ?? 'TASK',
    etag: String(r.etag ?? 0),
  };
}

export function serializeColumn(r: Row) {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    name: String(r.name),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

export function serializeGroup(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name),
    viewMode: str(r.view_mode) ?? 'list',
    sortOrder: Number(r.sort_order ?? 0),
  };
}

export function serializeTag(r: Row) {
  return {
    name: String(r.name),
    label: String(r.label),
    color: str(r.color),
    sortOrder: Number(r.sort_order ?? 0),
    parentId: str(r.parent_id),
  };
}

export function serializeFilter(r: Row) {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(String(r.filter_json ?? '{}')) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    // Keep a corrupt legacy filter usable as an empty filter instead of
    // allowing malformed JSON to break the whole sidebar response.
  }
  const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String).slice(0, 100) : [];
  const numbers = (value: unknown): number[] => Array.isArray(value)
    ? value.map(Number).filter((n) => Number.isInteger(n)).slice(0, 16)
    : [];
  const mode = String(parsed.dateMode ?? 'any');
  return {
    id: String(r.id),
    name: String(r.name),
    logic: parsed.logic === 'or' ? 'or' : 'and',
    dateMode: ['any', 'today', 'tomorrow', 'week', 'overdue', 'custom'].includes(mode) ? mode : 'any',
    dateStart: parsed.dateStart == null ? null : String(parsed.dateStart),
    dateEnd: parsed.dateEnd == null ? null : String(parsed.dateEnd),
    projectIds: strings(parsed.projectIds),
    tags: strings(parsed.tags),
    priorities: numbers(parsed.priorities),
    statuses: numbers(parsed.statuses),
    sortOrder: Number(r.sort_order ?? 0),
    createdTime: str(r.created_at),
    modifiedTime: str(r.modified_at),
  };
}

export function serializeHabit(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name),
    iconRes: str(r.icon_res),
    color: str(r.color),
    sortOrder: Number(r.sort_order ?? 0),
    status: Number(r.status ?? 0),
    encouragement: str(r.encouragement),
    type: str(r.type),
    goal: r.goal == null ? null : Number(r.goal),
    step: r.step == null ? null : Number(r.step),
    unit: str(r.unit),
    repeatRule: str(r.repeat_rule),
    reminders: parseJsonArray<string>(r.reminders as string),
    sectionId: str(r.section_id),
    style: r.style == null ? null : Number(r.style),
    etag: String(r.etag ?? 0),
  };
}

export interface CheckinRow {
  stamp: number;
  value: number | null;
  goal: number | null;
  status: number | null;
  time: string | null;
}

export function serializeCheckin(r: Row): CheckinRow {
  return {
    stamp: Number(r.stamp),
    value: r.value == null ? null : Number(r.value),
    goal: r.goal == null ? null : Number(r.goal),
    status: r.status == null ? null : Number(r.status),
    time: str(r.time),
  };
}

export function serializeFocus(r: Row) {
  return {
    id: String(r.id),
    type: Number(r.type),
    taskId: str(r.task_id),
    note: str(r.note),
    startTime: str(r.start_time),
    endTime: str(r.end_time),
    duration: r.duration == null ? null : Number(r.duration),
    pauseDuration: r.pause_duration == null ? null : Number(r.pause_duration),
    relationType: parseJsonArray<number>(r.relation as string),
    status: Number(r.status ?? 0),
    etag: String(r.etag ?? 0),
  };
}

export function serializeComment(r: Row) {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    projectId: String(r.project_id),
    title: String(r.title),
    createdTime: str(r.created_at) ? new Date(Number(r.created_at)).toISOString() : null,
  };
}

export function serializeCountdown(r: Row) {
  return {
    id: String(r.id),
    name: str(r.name),
    date: str(r.date),
    sortOrder: Number(r.sort_order ?? 0),
  };
}
