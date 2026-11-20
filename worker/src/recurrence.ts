/**
 * RRULE engine for the repeat rules NodeTick stores in tasks.repeat_flag:
 *
 *   RRULE:FREQ=DAILY|WEEKLY|MONTHLY|YEARLY
 *   ;INTERVAL=n                 every n days/weeks/months/years (default 1)
 *   ;BYDAY=MO,FR                weekdays; with MONTHLY/YEARLY an ordinal picks
 *   ;BYDAY=2TU / -1FR           the nth (or nth-from-last) one in the month, or
 *                               in the year when YEARLY has no BYMONTH
 *   ;BYMONTHDAY=15 / 1,15 / -1  days of the month (-1 is the last day)
 *   ;BYMONTH=11                 months, for YEARLY
 *   ;BYSETPOS=2 / -1            the nth of the days the other parts select
 *   ;UNTIL=20270131[T235959Z]   last day (or moment) an occurrence may fall on
 *   ;COUNT=n                    occurrences left, the current one included
 *
 * Dates are wall-clock strings (`YYYY-MM-DD` with an optional
 * `THH:MM:SS±HHMM` suffix). Only the calendar day advances; the time and
 * offset are kept verbatim so recurring reminders keep their time.
 *
 * Two deliberate departures from RFC 5545: a day of the month that a month
 * lacks falls on its last day instead of being skipped (31 → 30, Feb 29 →
 * Feb 28), and since each completed occurrence spawns the next one as a new
 * task, COUNT is decremented on that clone instead of counted from DTSTART.
 */

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_MS = 86_400_000;
/** Search horizons for rules that rarely (or never) match, e.g. BYDAY=5FR;BYMONTH=2. */
const MAX_MONTH_PERIODS = 1200;
const MAX_YEAR_PERIODS = 400;

export interface WeekdayNum {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** 2 = second, -1 = last; null = every such weekday. */
  nth: number | null;
}

export interface RuleParts {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  /** BYDAY weekdays without their ordinals: the DAILY / WEEKLY filter. */
  byDay: Set<number> | null;
  /** BYDAY as written, ordinals included: used by MONTHLY / YEARLY. */
  byWeekday: WeekdayNum[] | null;
  byMonthDay: number[] | null;
  byMonth: number[] | null;
  bySetPos: number[] | null;
  /** Last allowed day (YYYY-MM-DD). */
  until: string | null;
  /** UNTIL as a UTC timestamp when it carries a time (…T235959Z). */
  untilInstant: number | null;
  count: number | null;
}

/** Comma-separated non-zero integers with |n| in [1, max]; null when any is invalid. */
function intList(value: string, max: number, allowNegative: boolean): number[] | null {
  const out: number[] = [];
  for (const token of value.split(',')) {
    const n = Number(token.trim());
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > max || (n < 0 && !allowNegative)) return null;
    out.push(n);
  }
  return out;
}

const BYDAY_TOKEN = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/;

function parseByDay(value: string): WeekdayNum[] | null {
  const out: WeekdayNum[] = [];
  for (const token of value.split(',')) {
    const match = BYDAY_TOKEN.exec(token.trim());
    if (!match) return null;
    const nth = match[1] ? Number(match[1]) : null;
    if (nth !== null && (nth === 0 || Math.abs(nth) > 53)) return null;
    out.push({ weekday: (WEEKDAY_CODES as readonly string[]).indexOf(match[2]), nth });
  }
  return out;
}

const UNTIL_VALUE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

/** Parse an RRULE string; returns null for absent/invalid rules. Unknown or malformed parts are ignored. */
export function parseRule(repeatFlag: string | null | undefined): RuleParts | null {
  if (!repeatFlag) return null;
  const body = repeatFlag.trim().replace(/^RRULE:/i, '');
  if (!body) return null;
  const rule: RuleParts = {
    freq: 'DAILY',
    interval: 1,
    byDay: null,
    byWeekday: null,
    byMonthDay: null,
    byMonth: null,
    bySetPos: null,
    until: null,
    untilInstant: null,
    count: null,
  };
  let hasFreq = false;
  for (const part of body.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim().toUpperCase();
    if (key === 'FREQ' && ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(value)) {
      rule.freq = value as RuleParts['freq'];
      hasFreq = true;
    } else if (key === 'INTERVAL') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 999) rule.interval = parsed;
    } else if (key === 'BYDAY') {
      const weekdays = parseByDay(value);
      if (weekdays?.length) {
        rule.byWeekday = weekdays;
        rule.byDay = new Set(weekdays.map((w) => w.weekday));
      }
    } else if (key === 'BYMONTHDAY') {
      rule.byMonthDay = intList(value, 31, true);
    } else if (key === 'BYMONTH') {
      rule.byMonth = intList(value, 12, false);
    } else if (key === 'BYSETPOS') {
      rule.bySetPos = intList(value, 366, true);
    } else if (key === 'UNTIL') {
      const m = UNTIL_VALUE.exec(value);
      const day = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
      if (m && day && isRealDay(day)) {
        rule.until = day;
        rule.untilInstant = m[7] ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
      }
    } else if (key === 'COUNT') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 9999) rule.count = parsed;
    }
  }
  return hasFreq ? rule : null;
}

function isRealDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/** Split a stored date into its calendar day and the verbatim time suffix. */
function splitDate(value: string): { day: string; suffix: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(value);
  if (!match || !isRealDay(match[1])) return null;
  return { day: match[1], suffix: match[2] };
}

function toUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Monday-based week index, used to honor WEEKLY INTERVAL. */
function weekIndex(day: string): number {
  return Math.floor((toUtc(day) + 4 * DAY_MS) / (7 * DAY_MS));
}

/** The nth (1-based, or negative from the end) entry of `list`, if any. */
function nthOf<T>(list: T[], nth: number): T | undefined {
  return list[nth > 0 ? nth - 1 : list.length + nth];
}

/** BYSETPOS: keep only the listed positions of a sorted candidate list. */
function setPositions(days: string[], positions: number[] | null): string[] {
  if (!positions) return days;
  const picked = positions.map((p) => nthOf(days, p)).filter((d): d is string => d !== undefined);
  return [...new Set(picked)].sort();
}

/** Days of month y-m chosen by BYDAY / BYMONTHDAY, else `fallbackDay` (clamped). */
function monthDays(rule: RuleParts, y: number, m: number, fallbackDay: number): string[] {
  const dim = daysInMonth(y, m);
  let days: number[];
  if (rule.byWeekday) {
    days = [];
    const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    for (const { weekday, nth } of rule.byWeekday) {
      const matches: number[] = [];
      for (let d = ((weekday - firstWeekday + 7) % 7) + 1; d <= dim; d += 7) matches.push(d);
      if (nth === null) days.push(...matches);
      else {
        const pick = nthOf(matches, nth);
        if (pick !== undefined) days.push(pick);
      }
    }
    if (rule.byMonthDay) {
      const allowed = new Set(rule.byMonthDay.map((v) => (v > 0 ? v : dim + v + 1)));
      days = days.filter((d) => allowed.has(d));
    }
  } else if (rule.byMonthDay) {
    days = rule.byMonthDay.map((v) => (v > 0 ? Math.min(v, dim) : dim + v + 1)).filter((d) => d >= 1);
  } else {
    days = [Math.min(fallbackDay, dim)];
  }
  return [...new Set(days)].sort((a, b) => a - b).map((d) => ymd(y, m, d));
}

/** Days of year y: BYMONTH months (default: the anchor's), or year-wide BYDAY ordinals. */
function yearDays(rule: RuleParts, y: number, anchorMonth: number, anchorDay: number): string[] {
  let days: string[] = [];
  if (rule.byWeekday && !rule.byMonth) {
    // Without BYMONTH, a BYDAY ordinal counts through the whole year (BYDAY=20MO).
    const jan1 = Date.UTC(y, 0, 1);
    for (const { weekday, nth } of rule.byWeekday) {
      const matches: string[] = [];
      for (let ms = jan1 + ((weekday - new Date(jan1).getUTCDay() + 7) % 7) * DAY_MS; new Date(ms).getUTCFullYear() === y; ms += 7 * DAY_MS) {
        matches.push(fromUtc(ms));
      }
      if (nth === null) days.push(...matches);
      else {
        const pick = nthOf(matches, nth);
        if (pick !== undefined) days.push(pick);
      }
    }
    if (rule.byMonthDay) {
      days = days.filter((day) => {
        const [yy, mm, dd] = day.split('-').map(Number);
        const dim = daysInMonth(yy, mm);
        return rule.byMonthDay!.some((v) => (v > 0 ? v : dim + v + 1) === dd);
      });
    }
  } else {
    for (const m of rule.byMonth ?? [anchorMonth]) days.push(...monthDays(rule, y, m, anchorDay));
  }
  return setPositions([...new Set(days)].sort(), rule.bySetPos);
}

/**
 * The first rule day strictly after `floor`, stepping from `anchor` (itself
 * an occurrence: it fixes the interval phase and the default day/month).
 * UNTIL is applied by the caller; here it only ends the search early.
 */
function dayAfter(rule: RuleParts, anchor: string, floor: string): string | null {
  const anchorMs = toUtc(anchor);
  const start = floor > anchor ? floor : anchor;
  const startMs = toUtc(start);
  const [year, month, day] = anchor.split('-').map(Number);
  const pastUntil = (d: string) => rule.until !== null && d > rule.until;

  if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') {
    const stepDays = rule.freq === 'DAILY' ? rule.interval : 7 * rule.interval;
    if (!rule.byDay) {
      // Same phase as the anchor: the first anchor + k·step after the floor.
      const k = Math.floor((startMs - anchorMs) / (stepDays * DAY_MS)) + 1;
      return fromUtc(anchorMs + k * stepDays * DAY_MS);
    }
    // Weekday filter: DAILY ignores INTERVAL here (as before); WEEKLY keeps
    // only the weeks `interval` apart from the anchor's week.
    for (let ms = startMs + DAY_MS, i = 0; i < 7 * rule.interval + 7; i++, ms += DAY_MS) {
      const d = fromUtc(ms);
      if (!rule.byDay.has(new Date(ms).getUTCDay())) continue;
      if (rule.freq === 'WEEKLY' && (weekIndex(d) - weekIndex(anchor)) % rule.interval !== 0) continue;
      return d;
    }
    return null;
  }

  if (rule.freq === 'MONTHLY') {
    const [fy, fm] = start.split('-').map(Number);
    // Skip whole periods that end before the floor.
    const first = Math.max(0, Math.floor(((fy - year) * 12 + (fm - month)) / rule.interval));
    for (let period = first; period < first + MAX_MONTH_PERIODS; period++) {
      const total = month - 1 + period * rule.interval;
      const y = year + Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (pastUntil(ymd(y, m, 1))) return null;
      const found = setPositions(monthDays(rule, y, m, day), rule.bySetPos).find((d) => d > start);
      if (found) return found;
    }
    return null;
  }

  const [fy] = start.split('-').map(Number);
  const first = Math.max(0, Math.floor((fy - year) / rule.interval));
  for (let period = first; period < first + MAX_YEAR_PERIODS; period++) {
    const y = year + period * rule.interval;
    if (pastUntil(ymd(y, 1, 1))) return null;
    const found = yearDays(rule, y, month, day).find((d) => d > start);
    if (found) return found;
  }
  return null;
}

/** An occurrence's moment, when the stored date carries a time and an offset. */
function instantOf(day: string, suffix: string): number | null {
  const time = /^T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})$/.exec(suffix);
  if (!time) return null;
  const zone = time[2] === 'Z' ? 'Z' : time[2].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
  const ms = Date.parse(`${day}T${time[1]}${zone}`);
  return Number.isNaN(ms) ? null : ms;
}

function withinUntil(rule: RuleParts, day: string, suffix: string): boolean {
  if (rule.until === null) return true;
  const instant = rule.untilInstant === null ? null : instantOf(day, suffix);
  return instant === null ? day <= rule.until : instant <= rule.untilInstant!;
}

/** The next occurrence's day after `floor`, or null once UNTIL has passed. */
function occurrenceAfter(rule: RuleParts, anchor: string, floor: string, suffix: string): string | null {
  const next = dayAfter(rule, anchor, floor);
  return next !== null && withinUntil(rule, next, suffix) ? next : null;
}

/**
 * The next occurrence strictly after both the current scheduled day and
 * `afterDay` (the completion day), so a rule never spawns a past-due clone.
 * Returns the new full date string with the original time suffix, or null
 * when the rule or anchor date is unusable or UNTIL has passed. COUNT is not
 * looked at; see nextRepeat.
 */
export function nextOccurrence(
  repeatFlag: string | null | undefined,
  anchorDate: string | null | undefined,
  afterDay?: string,
): string | null {
  const rule = parseRule(repeatFlag);
  const split = anchorDate ? splitDate(anchorDate) : null;
  if (!rule || !split) return null;
  const floor = afterDay && afterDay > split.day ? afterDay : split.day;
  const next = occurrenceAfter(rule, split.day, floor, split.suffix);
  return next ? `${next}${split.suffix}` : null;
}

export interface NextRepeat {
  /** Date of the next occurrence, with the anchor's time suffix. */
  date: string;
  /** Rule the next occurrence carries (COUNT reduced by what was used up). */
  repeatFlag: string;
}

/**
 * What completing an occurrence spawns: like nextOccurrence, plus COUNT.
 * COUNT counts the occurrences left including the current one; occurrences
 * skipped because the task was completed late are used up as well, so the
 * series still ends where it would have. Null when the series is over.
 */
export function nextRepeat(
  repeatFlag: string | null | undefined,
  anchorDate: string | null | undefined,
  afterDay?: string,
): NextRepeat | null {
  const rule = parseRule(repeatFlag);
  const split = anchorDate ? splitDate(anchorDate) : null;
  if (!repeatFlag || !rule || !split) return null;
  const floor = afterDay && afterDay > split.day ? afterDay : split.day;
  if (rule.count === null) {
    const next = occurrenceAfter(rule, split.day, floor, split.suffix);
    return next ? { date: `${next}${split.suffix}`, repeatFlag } : null;
  }
  let left = rule.count;
  let current = split.day;
  for (;;) {
    left -= 1; // the current occurrence is done
    if (left <= 0) return null;
    const next = occurrenceAfter(rule, current, current, split.suffix);
    if (next === null) return null;
    if (next > floor) {
      return { date: `${next}${split.suffix}`, repeatFlag: repeatFlag.replace(/COUNT=\d+/i, `COUNT=${left}`) };
    }
    current = next;
  }
}

/** The calendar-day part of a stored date string (`YYYY-MM-DD`). */
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** Add n calendar days to a `YYYY-MM-DD` day string. */
export function addDays(day: string, delta: number): string {
  return fromUtc(toUtc(day) + delta * DAY_MS);
}
