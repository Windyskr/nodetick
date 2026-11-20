import { addDays } from './date';

/**
 * Periods of the focus statistics view (pure; days are local 'YYYY-MM-DD'
 * strings). Weeks start on Sunday, like the calendar.
 */

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

export interface Period {
  kind: PeriodKind;
  /** First day, inclusive. */
  from: string;
  /** Last day, inclusive. */
  to: string;
}

export interface DayTotal {
  day: string;
  pomoCount: number;
  seconds: number;
}

export const WEEK_START = 0;

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
const lastDayOfMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

export function weekdayOf(day: string): number {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d).getDay();
}

export function periodOf(kind: PeriodKind, day: string): Period {
  const [y, m] = parts(day);
  if (kind === 'day') return { kind, from: day, to: day };
  if (kind === 'week') {
    const from = addDays(day, -((weekdayOf(day) - WEEK_START + 7) % 7));
    return { kind, from, to: addDays(from, 6) };
  }
  if (kind === 'month') return { kind, from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` };
  return { kind, from: `${y}-01-01`, to: `${y}-12-31` };
}

/** The period `delta` steps away (−1 is the previous one). */
export function shiftPeriod(period: Period, delta: number): Period {
  const [y, m] = parts(period.from);
  if (period.kind === 'day') return periodOf('day', addDays(period.from, delta));
  if (period.kind === 'week') return periodOf('week', addDays(period.from, 7 * delta));
  if (period.kind === 'month') {
    const index = y * 12 + (m - 1) + delta;
    return periodOf('month', `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`);
  }
  return periodOf('year', `${y + delta}-01-01`);
}

export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/**
 * The heatmap's range: the 53 weeks that end with the week holding the
 * period's last day (a calendar year fits, starting with the week of Jan 1).
 */
export function heatmapRange(period: Period): { from: string; to: string } {
  const lastWeek = periodOf('week', period.to);
  return { from: addDays(lastWeek.from, -52 * 7), to: lastWeek.to };
}

export interface HeatCell {
  day: string;
  seconds: number;
  pomoCount: number;
  /** 0 (nothing) to 4. */
  level: number;
  /** Outside the shown range (padding of a partial week). */
  outside: boolean;
}

/** Fixed focus-time classes, so a color means the same in every year. */
export const HEAT_LEVELS = [0, 3600, 2 * 3600, 4 * 3600] as const;

export function heatLevel(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < HEAT_LEVELS[1]) return 1;
  if (seconds < HEAT_LEVELS[2]) return 2;
  if (seconds < HEAT_LEVELS[3]) return 3;
  return 4;
}

/** Columns of seven days (Sunday first) covering [from, to]. */
export function heatmapWeeks(from: string, to: string, days: DayTotal[], within?: { from: string; to: string }): HeatCell[][] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const weeks: HeatCell[][] = [];
  for (let start = periodOf('week', from).from; start <= to; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      const value = byDay.get(day);
      const outside = day < from || day > to || (within != null && (day < within.from || day > within.to));
      const seconds = outside ? 0 : value?.seconds ?? 0;
      return { day, seconds, pomoCount: outside ? 0 : value?.pomoCount ?? 0, level: heatLevel(seconds), outside };
    }));
  }
  return weeks;
}

export interface TrendBucket {
  /** The day ('YYYY-MM-DD') or month ('YYYY-MM') the bar stands for. */
  key: string;
  seconds: number;
  pomoCount: number;
}

/**
 * Bars of the trend chart: the seven days up to the day (day view), the
 * days of the week or month, or the months of the year.
 */
export function trendBuckets(period: Period, days: DayTotal[]): TrendBucket[] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const dayBucket = (day: string) => ({ key: day, seconds: byDay.get(day)?.seconds ?? 0, pomoCount: byDay.get(day)?.pomoCount ?? 0 });
  if (period.kind === 'day') return daysOf(addDays(period.from, -6), period.from).map(dayBucket);
  if (period.kind !== 'year') return daysOf(period.from, period.to).map(dayBucket);
  const year = period.from.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${pad(i + 1)}`, seconds: 0, pomoCount: 0 }));
  for (const d of days) {
    if (d.day.slice(0, 4) !== year) continue;
    const bucket = months[Number(d.day.slice(5, 7)) - 1];
    bucket.seconds += d.seconds;
    bucket.pomoCount += d.pomoCount;
  }
  return months;
}

/** Sum of the days inside [from, to]. */
export function totalOf(days: DayTotal[], from: string, to: string): { seconds: number; pomoCount: number } {
  let seconds = 0;
  let pomoCount = 0;
  for (const d of days) {
    if (d.day < from || d.day > to) continue;
    seconds += d.seconds;
    pomoCount += d.pomoCount;
  }
  return { seconds, pomoCount };
}

const TICK_STEPS = [60, 300, 600, 900, 1800, 3600, 2 * 3600, 3 * 3600, 4 * 3600, 6 * 3600, 12 * 3600, 24 * 3600, 48 * 3600, 96 * 3600, 240 * 3600, 480 * 3600];

/** Round duration ticks (seconds) from 0 to at least `max`, at most five of them. */
export function durationTicks(max: number): number[] {
  const top = Math.max(max, 60);
  const step = TICK_STEPS.find((s) => top / s <= 4) ?? Math.ceil(top / 4 / 3600) * 3600;
  const ticks: number[] = [];
  for (let value = 0; value < top + step; value += step) {
    ticks.push(value);
    if (value >= top) break;
  }
  return ticks;
}

/** Relative change from the previous period; null when it had nothing to compare with. */
export function changeRatio(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return (current - previous) / previous;
}

/** The hour with the most focus, or null when there is none. */
export function peakHour(byHour: number[]): number | null {
  let best: number | null = null;
  byHour.forEach((value, hour) => {
    if (value > 0 && (best == null || value > byHour[best])) best = hour;
  });
  return best;
}

/** Whether the period is the one holding `today` (nothing later to go to). */
export function isCurrentPeriod(period: Period, today: string): boolean {
  return period.from <= today && today <= period.to;
}
