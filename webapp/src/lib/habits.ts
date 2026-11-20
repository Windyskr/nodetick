import type { CheckinRow, Habit } from './types';

/**
 * Habit rules, schedules, goals, streaks and statistics: the one place that
 * decides them. The habit page, its detail panel and the Today list all use
 * this module; the worker's reminder scan ports the schedule part
 * (worker/src/services/habitSchedule.ts, same test vectors).
 *
 * A habit's repeatRule is an RRULE line plus NodeTick lines:
 *   RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA   every day (how TickTick writes daily habits)
 *   RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR               specific weekdays
 *   RRULE:FREQ=DAILY;INTERVAL=3                    every 3 days, counted from the start date
 *   RRULE:FREQ=WEEKLY;TT_TIMES=3                   any 3 days a week (TickTick's flexible rule; WKST = week start, default SU)
 *   RRULE:FREQ=MONTHLY;TT_TIMES=10                 any 10 days a month
 *   X-NODETICK-FREQ:daily|weekly|interval|perWeek|perMonth   the form's choice (tells "every day" from "all seven weekdays")
 *   X-NODETICK-START:yyyymmdd                      first day (DTSTART is read as a fallback)
 *   X-NODETICK-DAYS:n                              the habit runs n days from its start; 0 = forever (RRULE COUNT as fallback)
 *   X-NODETICK-INTERVAL:n                          interval copy of the RRULE's
 *   X-NODETICK-TARGET:complete|count               one check-in a day, or an amount
 *   X-NODETICK-RECORD:auto|manual|complete         a count habit's check-in adds its step, asks for an amount, or completes the day
 *   X-NODETICK-LOG:0|1                             open the check-in log once the goal is met
 * RRULE UNTIL ends the habit after that day. Lines this module doesn't know
 * are written back untouched, and so is the RRULE line while the schedule
 * stays the same.
 */

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];
export type HabitFrequency = 'daily' | 'weekly' | 'interval' | 'perWeek' | 'perMonth';
export type HabitTarget = 'complete' | 'count';
export type HabitRecordMode = 'auto' | 'manual' | 'complete';

export interface HabitSchedule {
  frequency: HabitFrequency;
  /** 'weekly': the planned weekdays; every other frequency: all seven. */
  weekdays: WeekdayCode[];
  /** 'interval': every N days. */
  interval: number;
  /** 'perWeek' / 'perMonth': check-in days the period asks for. */
  times: number;
  /** First day of a 'perWeek' period. */
  weekStart: WeekdayCode;
  /** YYYY-MM-DD, or null when the rule has none. */
  startDate: string | null;
  /** Days the habit runs from its start date; null = forever. */
  durationDays: number | null;
  /** YYYY-MM-DD, last day (RRULE UNTIL). */
  until: string | null;
}

export interface HabitRule extends HabitSchedule {
  target: HabitTarget;
  recordMode: HabitRecordMode;
  autoLog: boolean;
  /** The stored RRULE line, written back as is while the schedule is unchanged. */
  rrule: string | null;
  /** Lines this module doesn't understand, written back verbatim. */
  extraLines: string[];
}

/** Interval rules without a start date count from here (the worker does the same). */
const EPOCH_DAY = '1970-01-01';
const KNOWN_X_LINES = new Set(['FREQ', 'START', 'DAYS', 'INTERVAL', 'TARGET', 'RECORD', 'LOG']);
const FREQUENCIES: readonly HabitFrequency[] = ['daily', 'weekly', 'interval', 'perWeek', 'perMonth'];

// --- Days (UTC arithmetic on YYYY-MM-DD, free of DST and time zones) ---

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** Whole days from a to b. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function weekdayIndex(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export const dayToStamp = (day: string): number => Number(day.replaceAll('-', ''));

export function stampToDay(stamp: number): string {
  const raw = String(stamp);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** Last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthEnd(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

export function shiftMonth(month: string, amount: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

/** Six weeks of days covering a month, starting on `weekStart`. */
export function calendarDays(month: string, weekStart: WeekdayCode = 'SU'): string[] {
  const first = `${month}-01`;
  const back = (weekdayIndex(first) - WEEKDAY_CODES.indexOf(weekStart) + 7) % 7;
  const start = addDays(first, -back);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function realDay(stamp: string | null | undefined): string | null {
  if (!stamp || !/^\d{8}/.test(stamp)) return null;
  const day = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

function positiveInt(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

function weekdayList(value: string | undefined): WeekdayCode[] {
  const days = new Set<WeekdayCode>();
  for (const part of (value ?? '').split(',')) {
    const code = /^(?:[+-]?\d+)?([A-Z]{2})$/.exec(part.trim().toUpperCase())?.[1];
    if (code && (WEEKDAY_CODES as readonly string[]).includes(code)) days.add(code as WeekdayCode);
  }
  return WEEKDAY_CODES.filter((code) => days.has(code));
}

// --- Rules ---

export function parseHabitRule(habit: Pick<Habit, 'repeatRule' | 'type' | 'goal' | 'step'>): HabitRule {
  const params = new Map<string, string>();
  const x = new Map<string, string>();
  const extraLines: string[] = [];
  let rrule: string | null = null;
  let dtStart: string | undefined;
  for (const raw of String(habit.repeatRule ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const body = /^RRULE:(.*)$/i.exec(line)?.[1] ?? (/^FREQ=/i.test(line) ? line : null);
    if (body != null && rrule == null) {
      rrule = line;
      for (const part of body.split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0) params.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim());
      }
      continue;
    }
    const nodetick = /^X-NODETICK-([A-Z]+):(.*)$/i.exec(line);
    if (nodetick && KNOWN_X_LINES.has(nodetick[1].toUpperCase())) {
      x.set(nodetick[1].toUpperCase(), nodetick[2].trim());
      continue;
    }
    const start = /^DTSTART(?:;[^:]*)?:(.*)$/i.exec(line);
    if (start) {
      dtStart = start[1].trim();
      continue;
    }
    extraLines.push(line);
  }

  const freq = (params.get('FREQ') ?? '').toUpperCase();
  const xFreq = x.get('FREQ') ?? '';
  const byDay = weekdayList(params.get('BYDAY'));
  const interval = positiveInt(params.get('INTERVAL')) ?? positiveInt(x.get('INTERVAL')) ?? 1;
  const times = positiveInt(params.get('TT_TIMES'));
  let frequency: HabitFrequency = 'daily';
  let weekdays: WeekdayCode[] = [...WEEKDAY_CODES];
  if (freq === 'WEEKLY' && times) frequency = 'perWeek';
  else if (freq === 'MONTHLY' && times) frequency = 'perMonth';
  else if (freq === 'DAILY' && interval > 1) frequency = 'interval';
  else if (freq === 'DAILY' || freq === 'WEEKLY') {
    if (byDay.length && byDay.length < 7) {
      frequency = 'weekly';
      weekdays = byDay;
    } else if (xFreq === 'weekly') frequency = 'weekly';
  } else if (!freq && xFreq === 'interval' && interval > 1) frequency = 'interval';
  // Anything else (FREQ=MONTHLY by month day, YEARLY, no rule at all) counts as every day.

  const rawDays = x.get('DAYS');
  const explicitTarget = x.get('TARGET');
  const target: HabitTarget = explicitTarget === 'count' || explicitTarget === 'complete'
    ? explicitTarget
    : habit.type === 'Real' || (habit.goal ?? 1) > 1 ? 'count' : 'complete';
  const rawRecord = x.get('RECORD');
  return {
    frequency,
    weekdays,
    interval: frequency === 'interval' ? interval : 1,
    times: frequency === 'perWeek' ? Math.min(times ?? 1, 7) : frequency === 'perMonth' ? Math.min(times ?? 1, 31) : 1,
    weekStart: weekdayList(params.get('WKST'))[0] ?? 'SU',
    startDate: realDay(x.get('START')) ?? realDay(dtStart),
    durationDays: rawDays != null ? positiveInt(rawDays) : positiveInt(params.get('COUNT')),
    until: realDay(params.get('UNTIL')),
    target,
    recordMode: rawRecord === 'auto' || rawRecord === 'manual' || rawRecord === 'complete'
      ? rawRecord
      : (habit.step ?? 0) > 0 ? 'auto' : 'manual',
    autoLog: x.get('LOG') === '1',
    rrule,
    extraLines,
  };
}

/** Same planned days (frequency, weekdays, interval, quota, week start)? */
function sameSchedule(a: HabitSchedule, b: HabitSchedule): boolean {
  if (a.frequency !== b.frequency || a.until !== b.until) return false;
  switch (a.frequency) {
    case 'weekly': return a.weekdays.join() === b.weekdays.join();
    case 'interval': return a.interval === b.interval;
    case 'perWeek': return a.times === b.times && a.weekStart === b.weekStart;
    case 'perMonth': return a.times === b.times;
    default: return true;
  }
}

function rruleFor(rule: HabitSchedule): string {
  const until = rule.until ? `;UNTIL=${rule.until.replaceAll('-', '')}` : '';
  switch (rule.frequency) {
    case 'weekly': return `RRULE:FREQ=WEEKLY;BYDAY=${(rule.weekdays.length ? rule.weekdays : WEEKDAY_CODES).join(',')}${until}`;
    case 'interval': return `RRULE:FREQ=DAILY;INTERVAL=${rule.interval}${until}`;
    case 'perWeek': return `RRULE:FREQ=WEEKLY;TT_TIMES=${rule.times}${rule.weekStart === 'SU' ? '' : `;WKST=${rule.weekStart}`}${until}`;
    case 'perMonth': return `RRULE:FREQ=MONTHLY;TT_TIMES=${rule.times}${until}`;
    default: return `RRULE:FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES.join(',')}${until}`;
  }
}

/**
 * The stored repeatRule for a rule. `previous` is the habit's rule before the
 * edit: its RRULE line is kept verbatim while the schedule is unchanged.
 */
export function formatHabitRule(rule: HabitRule, previous?: HabitRule | null): string {
  const rrule = previous?.rrule && sameSchedule(previous, rule) ? previous.rrule : rruleFor(rule);
  return [
    rrule,
    `X-NODETICK-FREQ:${FREQUENCIES.includes(rule.frequency) ? rule.frequency : 'daily'}`,
    ...(rule.startDate ? [`X-NODETICK-START:${rule.startDate.replaceAll('-', '')}`] : []),
    `X-NODETICK-DAYS:${rule.durationDays ?? 0}`,
    ...(rule.frequency === 'interval' ? [`X-NODETICK-INTERVAL:${rule.interval}`] : []),
    `X-NODETICK-TARGET:${rule.target}`,
    `X-NODETICK-RECORD:${rule.target === 'count' ? rule.recordMode : 'manual'}`,
    `X-NODETICK-LOG:${rule.autoLog ? 1 : 0}`,
    ...rule.extraLines,
  ].join('\n');
}

// --- Schedule ---

/** Inside the habit's run: on or after its start, within its duration, not past UNTIL. */
export function withinRange(schedule: HabitSchedule, day: string): boolean {
  if (schedule.startDate && day < schedule.startDate) return false;
  if (schedule.startDate && schedule.durationDays != null && dayDiff(schedule.startDate, day) >= schedule.durationDays) return false;
  return !(schedule.until && day > schedule.until);
}

export const isFlexible = (schedule: HabitSchedule): boolean =>
  schedule.frequency === 'perWeek' || schedule.frequency === 'perMonth';

/** Last day of the run, if it ends. */
export function lastDay(schedule: HabitSchedule): string | null {
  const end = schedule.startDate && schedule.durationDays != null ? addDays(schedule.startDate, schedule.durationDays - 1) : null;
  if (end && schedule.until) return end < schedule.until ? end : schedule.until;
  return end ?? schedule.until;
}

/**
 * Fixed rules: whether `day` is one of the planned days. Flexible rules have
 * no planned days, so every day inside the run qualifies.
 */
export function isPlannedDay(schedule: HabitSchedule, day: string): boolean {
  if (!withinRange(schedule, day)) return false;
  if (schedule.frequency === 'weekly') return schedule.weekdays.includes(WEEKDAY_CODES[weekdayIndex(day)]);
  if (schedule.frequency === 'interval') {
    const offset = dayDiff(schedule.startDate ?? EPOCH_DAY, day);
    return ((offset % schedule.interval) + schedule.interval) % schedule.interval === 0;
  }
  return true;
}

export interface Period {
  start: string;
  end: string;
}

/** The week (from the rule's week start) or month a flexible rule counts in; the day itself otherwise. */
export function periodOf(schedule: HabitSchedule, day: string): Period {
  if (schedule.frequency === 'perWeek') {
    const back = (weekdayIndex(day) - WEEKDAY_CODES.indexOf(schedule.weekStart) + 7) % 7;
    const start = addDays(day, -back);
    return { start, end: addDays(start, 6) };
  }
  if (schedule.frequency === 'perMonth') {
    const month = day.slice(0, 7);
    return { start: `${month}-01`, end: monthEnd(month) };
  }
  return { start: day, end: day };
}

/** Days of a period inside the run. */
export function eligibleDays(schedule: HabitSchedule, period: Period): number {
  let count = 0;
  for (let day = period.start; day <= period.end; day = addDays(day, 1)) if (withinRange(schedule, day)) count++;
  return count;
}

/** Check-in days a period asks for: the rule's count, capped by the period's days inside the run. */
export function periodQuota(schedule: HabitSchedule, period: Period): number {
  return Math.min(schedule.times, eligibleDays(schedule, period));
}

// --- Goals ---

/** The goal a check-in is measured against: its own snapshot, else the habit's; 1 when unset or not positive. */
export function effectiveGoal(checkinGoal: number | null | undefined, habitGoal: number | null | undefined): number {
  const goal = checkinGoal ?? habitGoal ?? 1;
  return Number.isFinite(goal) && goal > 0 ? goal : 1;
}

/** Status 2 is done and status 1 an explicit "not done"; otherwise the value decides. */
export function isGoalMet(checkin: CheckinRow | undefined, habitGoal: number | null | undefined): boolean {
  if (!checkin) return false;
  if (checkin.status === 2) return true;
  if (checkin.status === 1) return false;
  return (checkin.value ?? 0) >= effectiveGoal(checkin.goal, habitGoal) - 1e-9;
}

/** What one habit's numbers are computed from. */
export interface HabitContext {
  rule: HabitSchedule;
  /** The habit's goal (a check-in's own goal wins). */
  goal: number | null;
  /** Loaded check-ins by YYYYMMDD stamp. */
  checkins: ReadonlyMap<number, CheckinRow>;
}

export function checkinOn(ctx: HabitContext, day: string): CheckinRow | undefined {
  return ctx.checkins.get(dayToStamp(day));
}

export function metOn(ctx: HabitContext, day: string): boolean {
  return isGoalMet(checkinOn(ctx, day), ctx.goal);
}

/** The day's amount and goal. */
export function progressOn(ctx: HabitContext, day: string): { value: number; goal: number; met: boolean } {
  const checkin = checkinOn(ctx, day);
  return {
    value: Math.max(0, checkin?.value ?? 0),
    goal: effectiveGoal(checkin?.goal, ctx.goal),
    met: isGoalMet(checkin, ctx.goal),
  };
}

/**
 * Whether the habit asks for a check-in on `day` (the Today list, the week
 * header's rings): fixed rules on their planned days; flexible rules on days
 * whose week or month the other days haven't filled yet, and on any day that
 * is checked in itself.
 */
export function isDueOn(ctx: HabitContext, day: string): boolean {
  if (!withinRange(ctx.rule, day)) return false;
  if (!isFlexible(ctx.rule)) return isPlannedDay(ctx.rule, day);
  if (metOn(ctx, day)) return true;
  const period = periodOf(ctx.rule, day);
  let met = 0;
  for (let other = period.start; other <= period.end; other = addDays(other, 1)) {
    if (other !== day && metOn(ctx, other)) met++;
  }
  return met < periodQuota(ctx.rule, period);
}

/** Check-in days this period so far, against its quota (flexible rules). */
export function periodProgress(ctx: HabitContext, day: string): { done: number; quota: number; period: Period } {
  const period = periodOf(ctx.rule, day);
  let done = 0;
  for (let other = period.start; other <= period.end; other = addDays(other, 1)) if (metOn(ctx, other)) done++;
  return { done, quota: periodQuota(ctx.rule, period), period };
}

// --- Streaks ---

export interface Streaks {
  /** Check-in days in the streak that is still going. */
  current: number;
  longest: number;
  /** The current streak runs back to `floor`: older check-ins could extend it. */
  reachesFloor: boolean;
}

/**
 * Streaks count check-in days (days whose goal is met). Going through the days:
 * - a met day adds one, wherever it falls;
 * - today, while not met yet, neither adds nor breaks (the day isn't over);
 * - days outside the habit's run, and for fixed rules (every day, weekdays,
 *   every N days) the days that aren't planned, are neutral: a Tuesday never
 *   breaks a Mon/Wed/Fri streak;
 * - a planned day that was missed breaks the streak;
 * - flexible rules (N days a week or month) plan no particular day: a missed
 *   day breaks the streak only when its week or month falls short of its
 *   quota. A past period that met its quota carries the streak across its
 *   rest days, and the current one breaks it only once the quota can no
 *   longer be reached in the days left.
 * `floor` is the first day with loaded check-ins; nothing before it is seen.
 */
export function habitStreaks(ctx: HabitContext, today: string, floor: string): Streaks {
  const rule = ctx.rule;
  const from = rule.startDate && rule.startDate > floor ? rule.startDate : floor;
  if (from > today) return { current: 0, longest: 0, reachesFloor: false };
  const periodMet = new Map<string, number>();
  const metIn = (period: Period) => {
    let count = periodMet.get(period.start);
    if (count == null) {
      count = 0;
      for (let day = period.start; day <= period.end && day <= today; day = addDays(day, 1)) if (metOn(ctx, day)) count++;
      periodMet.set(period.start, count);
    }
    return count;
  };
  const breaks = (day: string): boolean => {
    if (day === today || !withinRange(rule, day)) return false;
    if (!isFlexible(rule)) return isPlannedDay(rule, day);
    const period = periodOf(rule, day);
    const quota = periodQuota(rule, period);
    if (period.end < today) return metIn(period) < quota;
    let reachable = metIn(period);
    for (let day = today; day <= period.end; day = addDays(day, 1)) if (withinRange(rule, day) && !metOn(ctx, day)) reachable++;
    return reachable < quota;
  };
  let current = 0;
  let longest = 0;
  let unbroken = true;
  for (let day = from; day <= today; day = addDays(day, 1)) {
    if (metOn(ctx, day)) {
      current++;
      longest = Math.max(longest, current);
    } else if (breaks(day)) {
      current = 0;
      unbroken = false;
    }
  }
  return { current, longest, reachesFloor: unbroken && from === floor && rule.startDate !== floor };
}

// --- Statistics ---

/**
 * A month's completion rate in percent, over the days up to today (today
 * counts once it is met); null when nothing was due yet.
 * - fixed rules: met planned days / planned days;
 * - N days a month: met days / the month's quota;
 * - N days a week: met days / the days the weeks ask for, each week's quota
 *   spread over its days, so a month that starts mid-week asks for part of it.
 */
export function monthRate(ctx: HabitContext, month: string, today: string): number | null {
  const rule = ctx.rule;
  const first = `${month}-01`;
  const last = monthEnd(month);
  const end = last < today ? last : today;
  if (end < first) return null;
  const counts = (day: string) => day !== today || metOn(ctx, day);
  let met = 0;
  let expected = 0;
  if (rule.frequency === 'perMonth') {
    for (let day = first; day <= end; day = addDays(day, 1)) if (withinRange(rule, day) && metOn(ctx, day)) met++;
    expected = periodQuota(rule, { start: first, end: last });
  } else if (rule.frequency === 'perWeek') {
    for (let day = first; day <= end; day = addDays(day, 1)) {
      if (!withinRange(rule, day)) continue;
      if (metOn(ctx, day)) met++;
      if (!counts(day)) continue;
      const period = periodOf(rule, day);
      expected += periodQuota(rule, period) / eligibleDays(rule, period);
    }
  } else {
    for (let day = first; day <= end; day = addDays(day, 1)) {
      if (!isPlannedDay(rule, day) || !counts(day)) continue;
      expected++;
      if (metOn(ctx, day)) met++;
    }
  }
  return expected > 0 ? Math.min(100, Math.round((met / expected) * 100)) : null;
}

/** Check-in days and the summed amount of the loaded check-ins whose stamp starts with `prefix` (YYYY, YYYYMM or ''). */
export function checkinTotals(ctx: HabitContext, prefix = ''): { days: number; amount: number } {
  let days = 0;
  let amount = 0;
  for (const [stamp, row] of ctx.checkins) {
    if (prefix && !String(stamp).startsWith(prefix)) continue;
    amount += Math.max(0, row.value ?? 0);
    if (isGoalMet(row, ctx.goal)) days++;
  }
  return { days, amount: Math.round(amount * 1e6) / 1e6 };
}

/** Heatmap intensity 0–4: 4 is a met day, 1–3 a partly done one. */
export function heatLevel(ctx: HabitContext, day: string): 0 | 1 | 2 | 3 | 4 {
  const { value, goal, met } = progressOn(ctx, day);
  if (met) return 4;
  if (value <= 0) return 0;
  return (1 + Math.min(2, Math.floor((value / goal) * 3))) as 1 | 2 | 3;
}

/** Per month of `year` (January first): check-in days, or the summed amount for count habits. */
export function monthlySeries(ctx: HabitContext, year: number, measure: 'days' | 'amount'): number[] {
  const series = Array.from({ length: 12 }, () => 0);
  for (const [stamp, row] of ctx.checkins) {
    if (Math.floor(stamp / 10000) !== year) continue;
    const month = Math.floor(stamp / 100) % 100;
    if (measure === 'amount') series[month - 1] += Math.max(0, row.value ?? 0);
    else if (isGoalMet(row, ctx.goal)) series[month - 1]++;
  }
  return series.map((value) => Math.round(value * 1e6) / 1e6);
}

/** Round an amount for display: at most two decimals, no trailing zeros. */
export function formatAmount(value: number): string {
  return String(Math.round(value * 100) / 100);
}
