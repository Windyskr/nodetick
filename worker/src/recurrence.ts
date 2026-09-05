/**
 * Minimal RRULE engine covering the TickTick-compatible subset of repeat
 * rules NodeTick stores in tasks.repeat_flag:
 *
 *   RRULE:FREQ=DAILY|WEEKLY|MONTHLY|YEARLY
 *   ;INTERVAL=n            (default 1)
 *   ;BYDAY=MO,TU,...       (weekday filter for DAILY/WEEKLY)
 *   ;BYMONTHDAY=n          (day of month for MONTHLY)
 *   ;BYMONTH=n             (month for YEARLY)
 *
 * Dates are wall-clock strings (`YYYY-MM-DD` with an optional `THH:MM:SS±HHMM`
 * suffix). Only the calendar day advances; the original time-of-day and UTC
 * offset are preserved verbatim so recurring reminders keep their time.
 */

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

interface RuleParts {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byDay: Set<number> | null;
  byMonthDay: number | null;
  byMonth: number | null;
}

/** Parse an RRULE string; returns null for absent/invalid rules. */
export function parseRule(repeatFlag: string | null | undefined): RuleParts | null {
  if (!repeatFlag) return null;
  const body = repeatFlag.trim().replace(/^RRULE:/i, '');
  if (!body) return null;
  let freq: RuleParts['freq'] | null = null;
  let interval = 1;
  let byDay: Set<number> | null = null;
  let byMonthDay: number | null = null;
  let byMonth: number | null = null;
  for (const part of body.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim().toUpperCase();
    if (key === 'FREQ' && ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(value)) {
      freq = value as RuleParts['freq'];
    } else if (key === 'INTERVAL') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 999) interval = parsed;
    } else if (key === 'BYDAY') {
      const codes = value.split(',').map((code) => (WEEKDAY_CODES as readonly string[]).indexOf(code.trim()));
      if (codes.length && codes.every((code) => code >= 0)) byDay = new Set(codes);
    } else if (key === 'BYMONTHDAY') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 31) byMonthDay = parsed;
    } else if (key === 'BYMONTH') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) byMonth = parsed;
    }
  }
  return freq ? { freq, interval, byDay, byMonthDay, byMonth } : null;
}

/** Split a stored date into its calendar day and the verbatim time suffix. */
function splitDate(value: string): { day: string; suffix: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(value);
  if (!match) return null;
  const { 1: day, 2: suffix } = match;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  return { day, suffix };
}

function toUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Monday-based week index, used to honor WEEKLY INTERVAL. */
function weekIndex(day: string): number {
  return Math.floor((toUtc(day) + 4 * 86400000) / (7 * 86400000));
}

/**
 * The next occurrence strictly after both the current scheduled day and
 * `afterDay` (the completion day), so a rule never spawns a past-due clone.
 * Returns the new full date string with the original time suffix, or null
 * when the rule or anchor date is unusable.
 */
export function nextOccurrence(
  repeatFlag: string | null | undefined,
  anchorDate: string | null | undefined,
  afterDay?: string,
): string | null {
  const rule = parseRule(repeatFlag);
  if (!rule || !anchorDate) return null;
  const split = splitDate(anchorDate);
  if (!split) return null;

  const floorDay = afterDay && afterDay > split.day ? afterDay : split.day;
  const floorMs = toUtc(floorDay);
  const [year, month, day] = split.day.split('-').map(Number);

  let candidate: string | null = null;
  const accept = (ms: number): boolean => {
    if (ms <= floorMs) return false;
    const dayStr = fromUtc(ms);
    if (candidate === null || dayStr < candidate) candidate = dayStr;
    return true;
  };

  if (rule.freq === 'DAILY') {
    if (rule.byDay) {
      // Day-by-day scan honoring the weekday filter (e.g. every weekday).
      let ms = toUtc(split.day);
      for (let i = 0; i < 3660 && candidate === null; i++) {
        ms += 86400000;
        if (rule.byDay.has(new Date(ms).getUTCDay())) accept(ms);
      }
    } else {
      let ms = toUtc(split.day) + rule.interval * 86400000;
      while (candidate === null && ms - floorMs < 3660 * 86400000) {
        if (accept(ms)) break;
        ms += rule.interval * 86400000;
      }
    }
  } else if (rule.freq === 'WEEKLY') {
    if (!rule.byDay) {
      // Same weekday, `interval` weeks later (and later still when overdue).
      let ms = toUtc(split.day) + 7 * rule.interval * 86400000;
      for (let i = 0; i < 600 && candidate === null; i++) {
        if (accept(ms)) break;
        ms += 7 * rule.interval * 86400000;
      }
    } else {
      let ms = toUtc(split.day);
      for (let i = 0; i < 3660 && candidate === null; i++) {
        ms += 86400000;
        const dayStr = fromUtc(ms);
        if (!rule.byDay.has(new Date(ms).getUTCDay())) continue;
        if ((weekIndex(dayStr) - weekIndex(split.day)) % rule.interval !== 0) continue;
        accept(ms);
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    const wantedDay = rule.byMonthDay ?? day;
    for (let step = 1; step <= 1200 && candidate === null; step++) {
      const total = (month - 1) + step * rule.interval;
      const y = year + Math.floor(total / 12);
      const m = (total % 12) + 1;
      const d = Math.min(wantedDay, daysInMonth(y, m));
      accept(Date.UTC(y, m - 1, d));
    }
  } else {
    const wantedMonth = rule.byMonth ?? month;
    const wantedDay = rule.byMonthDay ?? day;
    for (let step = 1; step <= 120 && candidate === null; step++) {
      const y = year + step * rule.interval;
      const d = Math.min(wantedDay, daysInMonth(y, wantedMonth));
      accept(Date.UTC(y, wantedMonth - 1, d));
    }
  }

  return candidate ? `${candidate}${split.suffix}` : null;
}

/** The calendar-day part of a stored date string (`YYYY-MM-DD`). */
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** Add n calendar days to a `YYYY-MM-DD` day string. */
export function addDays(day: string, delta: number): string {
  return fromUtc(toUtc(day) + delta * 86400000);
}
