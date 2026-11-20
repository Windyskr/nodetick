import { dictionaries, type Key, type Lang } from '../i18n';
import { addDays, fmtDuration, localDayClock, parseInstant, weekdayShort } from './date';
import { markdownToPlainText } from './markdownText';
import { INBOX_ID, projectDisplayName } from './project';
import { hasTagOrSubTag, tagKey } from './tags';
import type { Project, Tag, Task } from './types';

/*
 * The Summary page: a Markdown report of the tasks in a period, like
 * TickTick's 摘要. The settings live on the server (/summary/state and
 * /summary/template); keep these lists in step with worker/src/services/summary.ts.
 */

export const SUMMARY_RANGES = [
  'today', 'tomorrow', 'yesterday',
  'thisWeek', 'nextWeek', 'lastWeek',
  'thisMonth', 'lastMonth',
  'thisYear', 'lastYear',
  'custom',
] as const;
export const SUMMARY_STATUSES = ['completed', 'wontDo', 'inProgress', 'open'] as const;
export const SUMMARY_GROUPS = ['status', 'list', 'completedTime', 'taskTime', 'tag', 'priority'] as const;
/** In the order they appear on a line. `title` is always on. */
export const SUMMARY_FIELDS = ['status', 'progress', 'completedTime', 'taskTime', 'title', 'parent', 'tags', 'focus', 'list', 'detail'] as const;
export const SUMMARY_PRIORITIES = [5, 3, 1, 0] as const;

export type SummaryRange = (typeof SUMMARY_RANGES)[number];
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];
export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];
export type SummaryField = (typeof SUMMARY_FIELDS)[number];

export interface SummaryConfig {
  range: SummaryRange;
  /** YYYY-MM-DD, inclusive; only for the custom range. */
  from: string | null;
  to: string | null;
  /** Empty means everything (likewise for the other filters). */
  projectIds: string[];
  statuses: SummaryStatus[];
  priorities: number[];
  tags: string[];
  groupBy: SummaryGroup;
  fields: SummaryField[];
  nextPeriod: boolean;
}

export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  range: 'thisWeek',
  from: null,
  to: null,
  projectIds: [],
  statuses: [],
  priorities: [],
  tags: [],
  groupBy: 'status',
  fields: ['progress', 'completedTime', 'title'],
  nextPeriod: false,
};

export const RANGE_KEYS: Record<SummaryRange, Key> = {
  today: 'summaryRangeToday',
  tomorrow: 'summaryRangeTomorrow',
  yesterday: 'summaryRangeYesterday',
  thisWeek: 'summaryRangeThisWeek',
  nextWeek: 'summaryRangeNextWeek',
  lastWeek: 'summaryRangeLastWeek',
  thisMonth: 'summaryRangeThisMonth',
  lastMonth: 'summaryRangeLastMonth',
  thisYear: 'summaryRangeThisYear',
  lastYear: 'summaryRangeLastYear',
  custom: 'summaryRangeCustom',
};

export const STATUS_KEYS: Record<SummaryStatus, Key> = {
  completed: 'summaryStatusCompleted',
  wontDo: 'summaryStatusWontDo',
  inProgress: 'summaryStatusInProgress',
  open: 'summaryStatusOpen',
};

export const GROUP_KEYS: Record<SummaryGroup, Key> = {
  status: 'summaryGroupStatus',
  list: 'summaryGroupList',
  completedTime: 'summaryGroupCompletedTime',
  taskTime: 'summaryGroupTaskTime',
  tag: 'summaryGroupTag',
  priority: 'summaryGroupPriority',
};

export const FIELD_KEYS: Record<SummaryField, Key> = {
  status: 'summaryFieldStatus',
  progress: 'summaryFieldProgress',
  completedTime: 'summaryFieldCompletedTime',
  taskTime: 'summaryFieldTaskTime',
  title: 'summaryFieldTitle',
  parent: 'summaryFieldParent',
  tags: 'summaryFieldTags',
  focus: 'summaryFieldFocus',
  list: 'summaryFieldList',
  detail: 'summaryFieldDetail',
};

const PRIORITY_GROUP_KEYS: Record<number, Key> = {
  5: 'summaryPriorityHigh',
  3: 'summaryPriorityMedium',
  1: 'summaryPriorityLow',
  0: 'summaryPriorityNone',
};

export interface SummaryTemplate {
  id: string;
  name: string;
  config: SummaryConfig;
  sortOrder: number;
  createdTime: string | null;
  modifiedTime: string | null;
}

/** The page's saved settings and the one edited draft (GET/POST /summary/state). */
export interface SummaryState {
  config: SummaryConfig;
  draft: string | null;
  /** What the draft was written from (summaryDraftKey); it shows only while that still matches. */
  draftKey: string | null;
  modifiedTime: string | null;
}

export interface SummaryPeriod {
  /** YYYY-MM-DD, both inclusive. */
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayText = (year: number, month0: number, date: number) => {
  const d = new Date(year, month0, date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const partsOf = (day: string) => day.split('-').map(Number) as [number, number, number];

/** Weeks start on Sunday, as in the calendar and the statistics. */
function weekStart(day: string): string {
  const [year, month, date] = partsOf(day);
  return addDays(day, -new Date(year, month - 1, date).getDay());
}

function monthPeriod(year: number, month0: number): SummaryPeriod {
  return { from: dayText(year, month0, 1), to: dayText(year, month0 + 1, 0) };
}

/** The local days a range covers, seen from `today`. */
export function resolvePeriod(config: Pick<SummaryConfig, 'range' | 'from' | 'to'>, today: string): SummaryPeriod {
  const [year, month] = partsOf(today);
  switch (config.range) {
    case 'today': return { from: today, to: today };
    case 'tomorrow': return { from: addDays(today, 1), to: addDays(today, 1) };
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'nextWeek': {
      const from = addDays(weekStart(today), 7);
      return { from, to: addDays(from, 6) };
    }
    case 'lastWeek': {
      const from = addDays(weekStart(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case 'thisMonth': return monthPeriod(year, month - 1);
    case 'lastMonth': return monthPeriod(year, month - 2);
    case 'thisYear': return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'lastYear': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case 'custom':
      if (config.from && config.to) return { from: config.from, to: config.to };
      return { from: today, to: today };
    case 'thisWeek':
    default: {
      const from = weekStart(today);
      return { from, to: addDays(from, 6) };
    }
  }
}

/** The period right after `period`: the next day, week, month or year, or a custom span of the same length. */
export function followingPeriod(range: SummaryRange, period: SummaryPeriod): SummaryPeriod {
  const [year, month] = partsOf(period.from);
  if (range === 'thisMonth' || range === 'lastMonth') return monthPeriod(year, month);
  if (range === 'thisYear' || range === 'lastYear') return { from: `${year + 1}-01-01`, to: `${year + 1}-12-31` };
  const [fy, fm, fd] = partsOf(period.from);
  const [ty, tm, td] = partsOf(period.to);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
  const from = addDays(period.to, 1);
  return { from, to: addDays(from, days - 1) };
}

/** "11月20日" / "Nov 20", with the year when it isn't `today`'s. */
export function summaryDay(day: string, lang: Lang, today: string): string {
  const [year, month, date] = partsOf(day);
  const showYear = String(year) !== today.slice(0, 4);
  if (lang === 'zh') return `${showYear ? `${year}年` : ''}${month}月${date}日`;
  const name = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
  return `${name} ${date}${showYear ? `, ${year}` : ''}`;
}

/** "11月15日-11月21日" / "Nov 15 – Nov 21"; a single day is just that day. Years show when the period isn't in this one. */
export function periodLabel(period: SummaryPeriod, lang: Lang, today: string): string {
  if (period.from === period.to) return summaryDay(period.from, lang, today);
  const thisYear = period.from.slice(0, 4) === today.slice(0, 4) && period.to.slice(0, 4) === today.slice(0, 4);
  // Measured against year 0, every date shows its year.
  const reference = thisYear ? today : '0000-01-01';
  const from = summaryDay(period.from, lang, reference);
  const to = summaryDay(period.to, lang, reference);
  return lang === 'zh' ? `${from}-${to}` : `${from} – ${to}`;
}

/** Done checklist items as a percentage, or null without a checklist. */
export function checklistProgress(task: Pick<Task, 'items'>): number | null {
  if (!task.items.length) return null;
  const done = task.items.filter((item) => item.status !== 0).length;
  return Math.round((done / task.items.length) * 100);
}

/** Open tasks with some of their checklist done count as in progress, as TickTick's 进行中. */
export function summaryStatusOf(task: Pick<Task, 'status' | 'items'>): SummaryStatus {
  if (task.status === 2) return 'completed';
  if (task.status === -1) return 'wontDo';
  return (checklistProgress(task) ?? 0) > 0 ? 'inProgress' : 'open';
}

/** The wall-clock day and time stored in a task date (as the task list shows them). */
function wallParts(value: string | null | undefined, allDay: boolean): { day: string; time: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value ?? '');
  return match ? { day: match[1], time: allDay ? '' : match[2] ?? '' } : null;
}

function taskSpan(task: Task): { start: string; end: string } | null {
  const start = wallParts(task.startDate, task.isAllDay)?.day;
  const due = wallParts(task.dueDate, task.isAllDay)?.day;
  if (!start && !due) return null;
  const a = start ?? due!;
  const b = due ?? start!;
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

const isDone = (task: Task) => task.status === 2 || task.status === -1;
const completedDay = (task: Task) => localDayClock(task.completedTime)?.day ?? null;

/** Completed and abandoned tasks count on the day they were closed; open ones when their dates overlap the period. */
export function inSummaryPeriod(task: Task, period: SummaryPeriod): boolean {
  if (isDone(task)) {
    const day = completedDay(task);
    if (day) return day >= period.from && day <= period.to;
  }
  const span = taskSpan(task);
  return !!span && span.start <= period.to && span.end >= period.from;
}

export interface SummaryData {
  /** Every task that isn't in the trash: open, completed and abandoned. */
  tasks: Task[];
  projects: Project[];
  tags: Tag[];
}

/** The tasks a configuration picks for a period. Notes have no status, so they are left out. */
export function summaryTasks(config: SummaryConfig, period: SummaryPeriod, data: SummaryData): Task[] {
  return data.tasks.filter((task) => {
    if (task.kind === 'NOTE') return false;
    if (!inSummaryPeriod(task, period)) return false;
    if (config.projectIds.length && !config.projectIds.includes(task.projectId)) return false;
    if (config.statuses.length && !config.statuses.includes(summaryStatusOf(task))) return false;
    if (config.priorities.length && !config.priorities.includes(task.priority)) return false;
    if (config.tags.length && !config.tags.some((tag) => hasTagOrSubTag(task, tag, data.tags))) return false;
    return true;
  });
}

interface Group {
  key: string;
  label: string;
  tasks: Task[];
}

interface Context {
  config: SummaryConfig;
  lang: Lang;
  today: string;
  t: (key: Key) => string;
  projects: Map<string, Project>;
  projectOrder: Map<string, number>;
  tags: Map<string, Tag>;
  tagOrder: Map<string, number>;
  byId: Map<string, Task>;
  focus: Map<string, number>;
}

/** The day a task files under when grouping by date: closed tasks on their closing day. */
function groupDay(task: Task, by: 'completedTime' | 'taskTime'): string | null {
  if (by === 'completedTime' && isDone(task)) {
    const day = completedDay(task);
    if (day) return day;
  }
  return wallParts(task.dueDate, task.isAllDay)?.day ?? wallParts(task.startDate, task.isAllDay)?.day ?? null;
}

function groupTasks(tasks: Task[], ctx: Context): Group[] {
  const { config, t, lang, today } = ctx;
  const groups = new Map<string, Group>();
  const add = (key: string, label: string, task: Task) => {
    const group = groups.get(key) ?? { key, label, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  };
  for (const task of tasks) {
    switch (config.groupBy) {
      case 'status': {
        const status = summaryStatusOf(task);
        add(status, t(STATUS_KEYS[status]), task);
        break;
      }
      case 'list': {
        const project = ctx.projects.get(task.projectId);
        add(task.projectId, projectDisplayName(project, t, task.projectId === INBOX_ID ? t('smartInbox') : task.projectId), task);
        break;
      }
      case 'completedTime':
      case 'taskTime': {
        const day = groupDay(task, config.groupBy);
        add(day ?? '~', day ? `${summaryDay(day, lang, today)} ${weekdayShort(day, lang)}` : t('summaryNoDate'), task);
        break;
      }
      case 'tag': {
        const first = task.tags[0];
        const tag = first ? ctx.tags.get(tagKey(first)) : undefined;
        add(first ? tagKey(first) : '~', first ? `#${tag?.label || tag?.name || first}` : t('summaryNoTag'), task);
        break;
      }
      case 'priority': {
        const priority = PRIORITY_GROUP_KEYS[task.priority] ? task.priority : 0;
        add(String(priority), t(PRIORITY_GROUP_KEYS[priority]), task);
        break;
      }
    }
  }
  const rank = (group: Group): [number, string] => {
    switch (config.groupBy) {
      case 'status': return [SUMMARY_STATUSES.indexOf(group.key as SummaryStatus), ''];
      case 'list': return [group.key === INBOX_ID ? -1 : ctx.projectOrder.get(group.key) ?? Number.MAX_SAFE_INTEGER, group.label];
      case 'tag': return [group.key === '~' ? Number.MAX_SAFE_INTEGER : ctx.tagOrder.get(group.key) ?? Number.MAX_SAFE_INTEGER - 1, group.key];
      case 'priority': return [-Number(group.key), ''];
      default: return [group.key === '~' ? 1 : 0, group.key];
    }
  };
  return [...groups.values()].sort((a, b) => {
    const [ra, sa] = rank(a);
    const [rb, sb] = rank(b);
    return ra - rb || sa.localeCompare(sb);
  });
}

/** Closed tasks in the order they were closed; open ones by date, then priority. */
function sortTasks(tasks: Task[]): Task[] {
  const dateKey = (task: Task) => taskSpan(task)?.end ?? '~';
  return [...tasks].sort((a, b) => {
    if (isDone(a) && isDone(b)) return (parseInstant(a.completedTime) ?? 0) - (parseInstant(b.completedTime) ?? 0);
    return dateKey(a).localeCompare(dateKey(b)) || b.priority - a.priority || a.sortOrder - b.sortOrder;
  });
}

function taskTimeText(task: Task, ctx: Context): string | null {
  const start = wallParts(task.startDate, task.isAllDay);
  const due = wallParts(task.dueDate, task.isAllDay);
  const one = start ?? due;
  if (!one) return null;
  const day = (parts: { day: string; time: string }) => summaryDay(parts.day, ctx.lang, ctx.today);
  const at = (parts: { day: string; time: string }) => (parts.time ? `${day(parts)} ${parts.time}` : day(parts));
  if (!start || !due || (start.day === due.day && start.time === due.time)) return at(one);
  if (start.day === due.day) return `${at(start)}-${due.time}`;
  return `${at(start)}-${at(due)}`;
}

function taskLine(task: Task, ctx: Context): string[] {
  const { config, t } = ctx;
  const show = (field: SummaryField) => config.fields.includes(field);
  const parts: string[] = [];
  if (show('status')) parts.push(isDone(task) ? '[x]' : '[ ]');
  if (show('progress') && !isDone(task)) {
    const progress = checklistProgress(task);
    if (progress) parts.push(`[${progress}%]`);
  }
  if (show('completedTime') && config.groupBy !== 'completedTime' && isDone(task)) {
    const day = completedDay(task);
    if (day) parts.push(`[${summaryDay(day, ctx.lang, ctx.today)}]`);
  }
  if (show('taskTime') && config.groupBy !== 'taskTime') {
    const text = taskTimeText(task, ctx);
    if (text) parts.push(`[${text}]`);
  }
  parts.push(task.title.trim() || t('untitled'));
  if (show('parent') && task.parentId) {
    const parent = ctx.byId.get(task.parentId);
    if (parent) parts.push(`/${parent.title.trim() || t('untitled')}`);
  }
  if (show('tags')) {
    for (const name of task.tags) {
      const tag = ctx.tags.get(tagKey(name));
      parts.push(`#${tag?.label || tag?.name || name}`);
    }
  }
  if (show('focus')) {
    const seconds = ctx.focus.get(task.id) ?? 0;
    if (seconds > 0) parts.push(`[${t('summaryFocusValue').replace('{0}', fmtDuration(seconds, ctx.lang))}]`);
  }
  if (show('list') && config.groupBy !== 'list') {
    const project = ctx.projects.get(task.projectId);
    const name = projectDisplayName(project, t, task.projectId === INBOX_ID ? t('smartInbox') : '');
    if (name) parts.push(`<${name}>`);
  }
  const lines = [`- ${parts.join(' ')}`];
  if (show('detail')) {
    const text = markdownToPlainText(task.content || task.desc || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');
    if (text) lines.push(`    ${text}`);
    const items = task.items.filter((item) => item.title.trim()).sort((a, b) => Number(a.status !== 0) - Number(b.status !== 0) || a.sortOrder - b.sortOrder);
    for (const item of items) {
      const done = item.status !== 0;
      const day = done && show('completedTime') ? localDayClock(item.completedTime)?.day : null;
      lines.push(`    - [${done ? 'x' : ' '}] ${day ? `[${summaryDay(day, ctx.lang, ctx.today)}] ` : ''}${item.title.trim()}`);
    }
  }
  return lines;
}

function section(tasks: Task[], ctx: Context): string[] {
  const out: string[] = [];
  for (const group of groupTasks(tasks, ctx)) {
    if (out.length) out.push('');
    out.push(`## ${group.label}`);
    if (ctx.config.groupBy === 'status') {
      for (const task of sortTasks(group.tasks)) out.push(...taskLine(task, ctx));
      continue;
    }
    // Inside other groupings the tasks are split by status again, as in TickTick.
    for (const status of SUMMARY_STATUSES) {
      const some = group.tasks.filter((task) => summaryStatusOf(task) === status);
      if (!some.length) continue;
      out.push(`### ${ctx.t(STATUS_KEYS[status])}`);
      for (const task of sortTasks(some)) out.push(...taskLine(task, ctx));
    }
  }
  return out;
}

export interface SummaryOptions {
  config: SummaryConfig;
  data: SummaryData;
  lang: Lang;
  today: string;
  /** Focused seconds per task id in the period, and in the next one. */
  focus?: Map<string, number>;
  nextFocus?: Map<string, number>;
}

/** The summary as Markdown: a heading with the period, then the grouped tasks. */
export function buildSummary({ config, data, lang, today, focus, nextFocus }: SummaryOptions): string {
  const t = (key: Key) => dictionaries[lang][key];
  const base: Omit<Context, 'focus'> = {
    config,
    lang,
    today,
    t,
    projects: new Map(data.projects.map((project) => [project.id, project])),
    projectOrder: new Map(data.projects.map((project, index) => [project.id, index])),
    tags: new Map(data.tags.map((tag) => [tagKey(tag.name), tag])),
    tagOrder: new Map(data.tags.map((tag, index) => [tagKey(tag.name), index])),
    byId: new Map(data.tasks.map((task) => [task.id, task])),
  };
  const render = (period: SummaryPeriod, seconds: Map<string, number> | undefined) => {
    const tasks = summaryTasks(config, period, data);
    const body = tasks.length ? section(tasks, { ...base, focus: seconds ?? new Map() }) : [t('summaryEmpty')];
    return [`# ${periodLabel(period, lang, today)}`, '', ...body];
  };
  const period = resolvePeriod(config, today);
  const lines = render(period, focus);
  if (config.nextPeriod) lines.push('', '', ...render(followingPeriod(config.range, period), nextFocus));
  return `${lines.join('\n')}\n`;
}

/** Identifies what a draft was written from: the settings and the days they meant then. */
export function summaryDraftKey(config: SummaryConfig, today: string): string {
  const period = resolvePeriod(config, today);
  return JSON.stringify({ ...config, period });
}

/** Whether two configurations produce the same summary (used to highlight the matching template). */
export function sameSummaryConfig(a: SummaryConfig, b: SummaryConfig): boolean {
  const norm = (config: SummaryConfig) => JSON.stringify({
    ...config,
    from: config.range === 'custom' ? config.from : null,
    to: config.range === 'custom' ? config.to : null,
    projectIds: [...config.projectIds].sort(),
    tags: [...config.tags].map(tagKey).sort(),
    statuses: SUMMARY_STATUSES.filter((status) => config.statuses.includes(status)),
    priorities: SUMMARY_PRIORITIES.filter((priority) => config.priorities.includes(priority)),
    fields: SUMMARY_FIELDS.filter((field) => field === 'title' || config.fields.includes(field)),
  });
  return norm(a) === norm(b);
}
