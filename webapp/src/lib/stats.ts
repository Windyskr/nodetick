import type { Task } from './types';
import { addDays, dayOf, parseInstant } from './date';

/** Statistics over tasks, computed in the browser's time zone from data the app already holds. */

export type StatsRange = '7d' | '30d' | '12w' | '12m';

export interface Bucket {
  /** First and last local day, inclusive. */
  start: string;
  end: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function weekStart(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return addDays(day, -new Date(year, month - 1, date).getDay());
}

function monthEnd(year: number, month0: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(new Date(year, month0 + 1, 0).getDate())}`;
}

/** The buckets of a range ending today: days, Sunday-based weeks or calendar months. */
export function rangeBuckets(range: StatsRange, today: string): Bucket[] {
  if (range === '7d' || range === '30d') {
    const n = range === '7d' ? 7 : 30;
    return Array.from({ length: n }, (_, i) => {
      const day = addDays(today, i - n + 1);
      return { start: day, end: day };
    });
  }
  if (range === '12w') {
    const first = addDays(weekStart(today), -77);
    return Array.from({ length: 12 }, (_, i) => {
      const start = addDays(first, i * 7);
      return { start, end: addDays(start, 6) };
    });
  }
  const year = Number(today.slice(0, 4));
  const month0 = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(year, month0 - 11 + i, 1);
    return { start: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`, end: monthEnd(date.getFullYear(), date.getMonth()) };
  });
}

/** The same number of buckets right before `buckets`. */
export function previousSpan(buckets: Bucket[], range: StatsRange): Bucket {
  const start = buckets[0].start;
  if (range === '12m') {
    const year = Number(start.slice(0, 4));
    const month0 = Number(start.slice(5, 7)) - 1;
    const first = new Date(year, month0 - 12, 1);
    return { start: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-01`, end: addDays(start, -1) };
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 84;
  return { start: addDays(start, -days), end: addDays(start, -1) };
}

/** Local day, hour and weekday of an instant such as completedTime. */
export function localMoment(value: string | null | undefined): { day: string; hour: number; weekday: number } | null {
  const ms = parseInstant(value);
  if (ms == null) return null;
  const date = new Date(ms);
  return { day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, hour: date.getHours(), weekday: date.getDay() };
}

/** The day a task is due: its due date, else its start. */
const dueDay = (task: Task) => dayOf(task.dueDate) ?? dayOf(task.startDate);

const within = (day: string | null | undefined, span: Bucket) => day != null && day >= span.start && day <= span.end;

export interface TaskStats {
  completed: number;
  previousCompleted: number;
  created: number;
  /** Tasks due in the range up to today, and how many of them are completed. */
  due: number;
  dueCompleted: number;
  /** Tasks completed in the range that had a due day, and how many by that day. */
  withDue: number;
  onTime: number;
  openNow: number;
  overdueNow: number;
  totalCompleted: number;
  series: { bucket: Bucket; value: number }[];
  byProject: { id: string; value: number }[];
  byTag: { name: string; value: number }[];
  byPriority: { priority: number; value: number }[];
  byHour: number[];
  byWeekday: number[];
}

export function computeStats(input: {
  open: Task[];
  completed: Task[];
  abandoned: Task[];
  range: StatsRange;
  today: string;
  /** Only tasks of this list. */
  projectId?: string | null;
}): TaskStats {
  const keep = (task: Task) => !input.projectId || task.projectId === input.projectId;
  const open = input.open.filter(keep);
  const completed = input.completed.filter(keep);
  const abandoned = input.abandoned.filter(keep);
  const buckets = rangeBuckets(input.range, input.today);
  const span: Bucket = { start: buckets[0].start, end: input.today };
  const previous = previousSpan(buckets, input.range);

  const series = buckets.map((bucket) => ({ bucket, value: 0 }));
  const byProject = new Map<string, number>();
  const byTag = new Map<string, number>();
  const byPriority = new Map<number, number>([[5, 0], [3, 0], [1, 0], [0, 0]]);
  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  let inRange = 0;
  let previousCompleted = 0;
  let withDue = 0;
  let onTime = 0;
  for (const task of completed) {
    const moment = localMoment(task.completedTime);
    if (!moment) continue;
    if (within(moment.day, previous)) previousCompleted++;
    if (!within(moment.day, span)) continue;
    inRange++;
    const bucket = series.find((item) => within(moment.day, item.bucket));
    if (bucket) bucket.value++;
    byProject.set(task.projectId, (byProject.get(task.projectId) ?? 0) + 1);
    for (const tag of new Set(task.tags.map((name) => name.toLowerCase()))) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
    byPriority.set(task.priority, (byPriority.get(task.priority) ?? 0) + 1);
    byHour[moment.hour]++;
    byWeekday[moment.weekday]++;
    const due = dueDay(task);
    if (due) {
      withDue++;
      if (moment.day <= due) onTime++;
    }
  }

  let due = 0;
  let dueCompleted = 0;
  for (const task of [...open, ...completed, ...abandoned]) {
    if (!within(dueDay(task), span)) continue;
    due++;
    if (task.status === 2) dueCompleted++;
  }

  const sorted = <K,>(map: Map<K, number>) => [...map.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  return {
    completed: inRange,
    previousCompleted,
    created: [...open, ...completed, ...abandoned].filter((task) => within(localMoment(task.createdTime)?.day, span)).length,
    due,
    dueCompleted,
    withDue,
    onTime,
    openNow: open.length,
    overdueNow: open.filter((task) => {
      const day = dueDay(task);
      return day != null && day < input.today;
    }).length,
    totalCompleted: completed.length,
    series,
    byProject: sorted(byProject).map(([id, value]) => ({ id, value })),
    byTag: sorted(byTag).map(([name, value]) => ({ name, value })),
    byPriority: [...byPriority.entries()].map(([priority, value]) => ({ priority, value })),
    byHour,
    byWeekday,
  };
}

/** Completions per local day for the `weeks` weeks ending with today's week (Sunday first). */
export function completionCalendar(completed: Task[], today: string, weeks = 53): { day: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const task of completed) {
    const day = localMoment(task.completedTime)?.day;
    if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const first = addDays(weekStart(today), -(weeks - 1) * 7);
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const day = addDays(first, i);
    return { day, count: day > today ? -1 : counts.get(day) ?? 0 };
  });
}

/** Level 0–4 of a heat-map cell, relative to the busiest day (quartiles of the maximum). */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

/** Clean axis ticks from 0 to at least `max`: 0, step, 2·step… with step 1, 2 or 5 × 10ⁿ. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((value) => value >= raw) ?? 10 * power;
  const whole = Math.max(1, Math.round(step));
  const top = Math.ceil(max / whole) * whole;
  return Array.from({ length: top / whole + 1 }, (_, i) => i * whole);
}
