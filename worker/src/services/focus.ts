import { parseApiDate } from '../util.js';

/**
 * Focus statistics and history (NodeTick extensions to the Open API).
 *
 * Focus times are stored as written, with their own UTC offset
 * ("2026-08-01T09:00:00+0800", "...Z"), so SQL can only narrow by the text's
 * day prefix; the exact instant checks and the grouping by the user's time
 * zone happen here.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Largest UTC offset a focus time can carry: validated input allows ±14:59. */
export const MAX_OFFSET_MS = 15 * HOUR_MS;

/** The canonical name of an IANA time zone, or null when the runtime does not know it. */
export function validTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 64) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** UTC offsets of one time zone, read from Intl. */
export class Zone {
  private readonly format: Intl.DateTimeFormat;

  constructor(readonly name: string) {
    this.format = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  }

  /** Offset (ms, east positive) in effect at the instant `ms`. */
  offsetAt(ms: number): number {
    const part: Record<string, number> = {};
    for (const { type, value } of this.format.formatToParts(ms)) if (type !== 'literal') part[type] = Number(value);
    const wall = Date.UTC(part.year, part.month - 1, part.day, part.hour % 24, part.minute, part.second);
    return wall - (ms - (((ms % 1000) + 1000) % 1000));
  }
}

/** An offset in effect from `start` until the next segment's start. */
export interface OffsetSegment {
  start: number;
  offset: number;
}

/** Sampling step of offsetSegments: no zone changes its offset twice within a week. */
const SAMPLE_MS = 7 * DAY_MS;

/**
 * The zone's offsets over [from, to]: one Intl call per week plus a binary
 * search per transition, about 90 calls for a year instead of one per
 * record (a daily sample cost ~0.9 ms of CPU per request).
 */
export function offsetSegments(zone: Zone, from: number, to: number): OffsetSegment[] {
  const first = zone.offsetAt(from);
  const segments: OffsetSegment[] = [{ start: Number.NEGATIVE_INFINITY, offset: first }];
  let previous = from;
  let previousOffset = first;
  while (previous < to) {
    const next = Math.min(previous + SAMPLE_MS, to);
    const offset = zone.offsetAt(next);
    if (offset !== previousOffset) {
      let lo = previous; // still the old offset
      let hi = next; // already the new one
      while (hi - lo > 1000) {
        const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
        if (zone.offsetAt(mid) === previousOffset) lo = mid;
        else hi = mid;
      }
      segments.push({ start: hi, offset });
      previousOffset = offset;
    }
    previous = next;
  }
  return segments;
}

export function offsetFor(segments: OffsetSegment[], ms: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= ms) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo].offset;
}

/**
 * First instant of a local calendar day, given as the UTC midnight of that
 * date: the first moment whose wall clock reads that day. A day whose
 * midnight is skipped by a DST jump starts at the jump.
 */
export function zonedDayStart(segments: OffsetSegment[], localMidnight: number): number {
  for (let i = 0; i < segments.length; i++) {
    const end = i + 1 < segments.length ? segments[i + 1].start : Number.POSITIVE_INFINITY;
    const candidate = Math.max(segments[i].start, localMidnight - segments[i].offset);
    if (candidate < end) return candidate;
  }
  return localMidnight - segments[segments.length - 1].offset;
}

/** 'YYYY-MM-DD' → UTC midnight ms, or null for anything but a real date. */
export function parseDay(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : ms;
}

const dayText = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The UTC calendar day of an instant, as stored-text bounds: a stored time's
 * YYYY-MM-DD prefix is its local day, within a day of its UTC day, so
 * `start_time >= textDayBefore(from)` and `< textDayAfter(to)` can only
 * over-include.
 */
export const textDayBefore = (ms: number) => dayText(ms - DAY_MS);
export const textDayAfter = (ms: number) => dayText(ms + 2 * DAY_MS);

export interface FocusStatsRow {
  type: unknown;
  start_time: unknown;
  end_time: unknown;
  duration: unknown;
  task_id: unknown;
}

export interface FocusTaskRow {
  id: unknown;
  title: unknown;
  project_id: unknown;
}

interface Tally {
  pomoCount: number;
  pomoSeconds: number;
  stopwatchSeconds: number;
  seconds: number;
  records: number;
}

const emptyTally = (): Tally => ({ pomoCount: 0, pomoSeconds: 0, stopwatchSeconds: 0, seconds: 0, records: 0 });

function addTo(tally: Tally, pomodoro: boolean, seconds: number) {
  tally.records++;
  tally.seconds += seconds;
  if (pomodoro) {
    tally.pomoCount++;
    tally.pomoSeconds += seconds;
  } else {
    tally.stopwatchSeconds += seconds;
  }
}

export const MAX_STATS_TASKS = 100;

/**
 * Aggregate the records that start in [fromMs, toMs). A session counts
 * toward the day it starts on; the hour distribution spreads its focused
 * time over the wall-clock hours it spans.
 */
export function aggregateFocus(
  rows: FocusStatsRow[],
  tasks: FocusTaskRow[],
  fromMs: number,
  toMs: number,
  segments: OffsetSegment[],
) {
  const period = emptyTally();
  const days = new Map<number, { pomoCount: number; seconds: number }>();
  const byTask = new Map<string, { taskId: string | null; seconds: number; count: number; pomoCount: number }>();
  const byProject = new Map<string, { projectId: string | null; seconds: number; count: number; pomoCount: number }>();
  const byHour = new Array<number>(24).fill(0);
  const taskInfo = new Map(tasks.map((task) => [String(task.id), task]));

  for (const row of rows) {
    const start = parseApiDate(row.start_time);
    if (typeof start !== 'number' || start < fromMs || start >= toMs) continue;
    const pomodoro = Number(row.type) === 0;
    const seconds = Math.max(0, Number(row.duration) || 0);
    addTo(period, pomodoro, seconds);

    const local = start + offsetFor(segments, start);
    const dayIndex = Math.floor(local / DAY_MS);
    const day = days.get(dayIndex) ?? { pomoCount: 0, seconds: 0 };
    day.seconds += seconds;
    if (pomodoro) day.pomoCount++;
    days.set(dayIndex, day);

    const taskId = row.task_id == null || row.task_id === '' ? null : String(row.task_id);
    const taskEntry = byTask.get(taskId ?? '') ?? { taskId, seconds: 0, count: 0, pomoCount: 0 };
    taskEntry.seconds += seconds;
    taskEntry.count++;
    if (pomodoro) taskEntry.pomoCount++;
    byTask.set(taskId ?? '', taskEntry);

    const projectId = taskId ? (taskInfo.get(taskId)?.project_id == null ? null : String(taskInfo.get(taskId)!.project_id)) : null;
    const projectEntry = byProject.get(projectId ?? '') ?? { projectId, seconds: 0, count: 0, pomoCount: 0 };
    projectEntry.seconds += seconds;
    projectEntry.count++;
    if (pomodoro) projectEntry.pomoCount++;
    byProject.set(projectId ?? '', projectEntry);

    if (seconds > 0) {
      const end = parseApiDate(row.end_time);
      // Pauses are spread evenly over the span; a span over a day is a stray record.
      const span = Math.min(DAY_MS, typeof end === 'number' && end > start ? end - start : seconds * 1000);
      const perMs = seconds / span;
      for (let t = local, stop = local + span; t < stop;) {
        const hourEnd = (Math.floor(t / HOUR_MS) + 1) * HOUR_MS;
        const slice = Math.min(hourEnd, stop) - t;
        byHour[((Math.floor(t / HOUR_MS) % 24) + 24) % 24] += slice * perMs;
        t += slice;
      }
    }
  }

  const ranked = <T extends { seconds: number; count: number }>(values: Iterable<T>) =>
    [...values].sort((a, b) => b.seconds - a.seconds || b.count - a.count);
  return {
    period,
    days: [...days.entries()].sort(([a], [b]) => a - b).map(([index, value]) => ({ day: dayText(index * DAY_MS), ...value })),
    byTask: ranked(byTask.values()).slice(0, MAX_STATS_TASKS).map((entry) => {
      const task = entry.taskId ? taskInfo.get(entry.taskId) : undefined;
      return {
        taskId: entry.taskId,
        title: task?.title == null ? null : String(task.title),
        projectId: task?.project_id == null ? null : String(task.project_id),
        seconds: entry.seconds,
        count: entry.count,
        pomoCount: entry.pomoCount,
      };
    }),
    byProject: ranked(byProject.values()),
    byHour: byHour.map((value) => Math.round(value)),
  };
}

/** The local day (in `zone`) of the earliest of these stored start times. */
export function firstLocalDay(startTimes: unknown[], zone: Zone): string | null {
  let first = Number.POSITIVE_INFINITY;
  for (const value of startTimes) {
    const ms = parseApiDate(value);
    if (typeof ms === 'number' && ms < first) first = ms;
  }
  return Number.isFinite(first) ? dayText(first + zone.offsetAt(first)) : null;
}

// --- History paging ---

/** Rows fetched beyond the page size, so the exact instant order has slack. */
export const HISTORY_SLACK = 100;

/** Upper text bound for rows that may start before `before`: their wall clock is under before + 15h. */
export function historyTextBound(before: number): string {
  return new Date(before + MAX_OFFSET_MS + 2 * 60_000).toISOString().slice(0, 16);
}

/** Wall-clock minute (as UTC ms) of a stored time's 'YYYY-MM-DDTHH:MM' prefix. */
function wallMinute(value: unknown): number | null {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
}

/**
 * One page of history, newest first by instant, from rows fetched in
 * descending text order (`fetched` = the SQL limit). Text order is wall-clock
 * order, which differs from instant order by up to the offsets involved, so
 * only rows whose instant is later than anything left unfetched can be
 * placed; `nextBefore` (exclusive) continues below the last placed row.
 * Records sharing an instant never straddle two pages.
 */
export function historyPage<T extends Record<string, unknown>>(
  rows: T[],
  before: number,
  limit: number,
  fetched: number,
): { records: T[]; nextBefore: number | null } {
  const exhausted = rows.length < fetched;
  const timed = rows.flatMap((row) => {
    const ms = parseApiDate(row.start_time);
    return typeof ms === 'number' && ms < before ? [{ row, ms }] : [];
  });
  const newestFirst = (a: { row: T; ms: number }, b: { row: T; ms: number }) =>
    b.ms - a.ms || String(b.row.id).localeCompare(String(a.row.id));

  // Unfetched rows sort at or below the last fetched text, so their wall
  // clock is before its minute's end and their instant before `safe`.
  let safe = Number.NEGATIVE_INFINITY;
  if (!exhausted) {
    const lowest = wallMinute(rows[rows.length - 1]?.start_time);
    safe = lowest == null ? Number.POSITIVE_INFINITY : lowest + 60_000 + MAX_OFFSET_MS;
  }
  const certain = timed.filter((item) => item.ms >= safe).sort(newestFirst);

  if (!certain.length && !exhausted) {
    if (safe < before) return { records: [], nextBefore: safe };
    // Over a hundred records within ~30 hours: place what was fetched.
    const page = timed.sort(newestFirst).slice(0, limit);
    return { records: page.map((item) => item.row), nextBefore: page.length ? page[page.length - 1].ms : null };
  }

  let page = certain.slice(0, limit);
  if (certain.length > limit) {
    const boundary = page[page.length - 1].ms;
    if (certain[limit].ms === boundary) {
      const trimmed = page.filter((item) => item.ms !== boundary);
      page = trimmed.length ? trimmed : certain.filter((item) => item.ms === boundary);
    }
    return { records: page.map((item) => item.row), nextBefore: page[page.length - 1].ms };
  }
  return { records: page.map((item) => item.row), nextBefore: exhausted ? null : safe };
}
