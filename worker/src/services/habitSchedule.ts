/**
 * Habit schedules for the reminder scan: which days a habit asks for a
 * check-in and when a check-in meets the day's goal. A port of the schedule
 * part of webapp/src/lib/habits.ts (which also does streaks and statistics);
 * keep the two in step, the test vectors in worker/test/habit.test.ts and
 * webapp/test/habits.test.ts are the same.
 *
 * A habit's repeatRule is an RRULE line plus NodeTick lines:
 *   RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA   every day (TickTick writes daily habits this way)
 *   RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR               specific weekdays
 *   RRULE:FREQ=DAILY;INTERVAL=3                    every 3 days, counted from the start date
 *   RRULE:FREQ=WEEKLY;TT_TIMES=3                   any 3 days a week (TickTick's flexible rule; WKST sets the week start, default SU)
 *   RRULE:FREQ=MONTHLY;TT_TIMES=10                 any 10 days a month
 *   X-NODETICK-START:20261101                      first day (DTSTART is read as a fallback)
 *   X-NODETICK-DAYS:30                             the habit runs for 30 days from its start; 0 = forever (RRULE COUNT is the fallback)
 * An RRULE UNTIL ends the habit after that day. Other lines don't affect the schedule.
 */

export const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];
export type HabitFrequency = 'daily' | 'weekly' | 'interval' | 'perWeek' | 'perMonth';

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
  /** YYYY-MM-DD; null when the rule has none. */
  startDate: string | null;
  /** Days the habit runs from its start date; null = forever. */
  durationDays: number | null;
  /** YYYY-MM-DD, last day (RRULE UNTIL). */
  until: string | null;
}

/** Interval rules without a start date count from here, the same in the webapp. */
const EPOCH_DAY = '1970-01-01';

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

/** Split a stored rule into its RRULE parameters and its other `KEY:VALUE` lines. */
function ruleParts(rule: string | null | undefined): { params: Map<string, string>; lines: Map<string, string> } {
  const params = new Map<string, string>();
  const lines = new Map<string, string>();
  for (const raw of String(rule ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const rrule = /^RRULE:(.*)$/i.exec(line)?.[1] ?? (/^FREQ=/i.test(line) ? line : null);
    if (rrule != null) {
      for (const part of rrule.split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0) params.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim());
      }
      continue;
    }
    const colon = line.indexOf(':');
    if (colon > 0) lines.set(line.slice(0, colon).trim().toUpperCase(), line.slice(colon + 1).trim());
  }
  return { params, lines };
}

function weekdayList(value: string | undefined): WeekdayCode[] {
  const days = new Set<WeekdayCode>();
  for (const part of (value ?? '').split(',')) {
    const code = /^(?:[+-]?\d+)?([A-Z]{2})$/.exec(part.trim().toUpperCase())?.[1];
    if (code && (WEEKDAY_CODES as readonly string[]).includes(code)) days.add(code as WeekdayCode);
  }
  return WEEKDAY_CODES.filter((code) => days.has(code));
}

export function parseHabitSchedule(rule: string | null | undefined): HabitSchedule {
  const { params, lines } = ruleParts(rule);
  const freq = (params.get('FREQ') ?? '').toUpperCase();
  const xFreq = lines.get('X-NODETICK-FREQ') ?? '';
  const byDay = weekdayList(params.get('BYDAY'));
  const interval = positiveInt(params.get('INTERVAL')) ?? positiveInt(lines.get('X-NODETICK-INTERVAL')) ?? 1;
  const times = positiveInt(params.get('TT_TIMES'));
  const weekStart = weekdayList(params.get('WKST'))[0] ?? 'SU';

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

  const dtStart = [...lines].find(([key]) => key === 'DTSTART' || key.startsWith('DTSTART;'))?.[1];
  const start = realDay(lines.get('X-NODETICK-START')) ?? realDay(dtStart);
  const rawDays = lines.get('X-NODETICK-DAYS');
  const durationDays = rawDays != null ? positiveInt(rawDays) : positiveInt(params.get('COUNT'));
  return {
    frequency,
    weekdays,
    interval: frequency === 'interval' ? interval : 1,
    times: frequency === 'perWeek' ? Math.min(times ?? 1, 7) : frequency === 'perMonth' ? Math.min(times ?? 1, 31) : 1,
    weekStart,
    startDate: start,
    durationDays,
    until: realDay(params.get('UNTIL')),
  };
}

/** Whole days from a to b (YYYY-MM-DD). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekdayIndex(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Inside the habit's run: on or after its start, within its duration, not past UNTIL. */
export function withinRange(schedule: HabitSchedule, day: string): boolean {
  if (schedule.startDate && day < schedule.startDate) return false;
  if (schedule.startDate && schedule.durationDays != null && dayDiff(schedule.startDate, day) >= schedule.durationDays) return false;
  return !(schedule.until && day > schedule.until);
}

export const isFlexible = (schedule: HabitSchedule): boolean =>
  schedule.frequency === 'perWeek' || schedule.frequency === 'perMonth';

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

/** The week (from the rule's week start) or month a flexible rule counts in; a single day otherwise. */
export function periodOf(schedule: HabitSchedule, day: string): { start: string; end: string } {
  if (schedule.frequency === 'perWeek') {
    const back = (weekdayIndex(day) - WEEKDAY_CODES.indexOf(schedule.weekStart) + 7) % 7;
    const start = addDays(day, -back);
    return { start, end: addDays(start, 6) };
  }
  if (schedule.frequency === 'perMonth') {
    const start = `${day.slice(0, 7)}-01`;
    const next = new Date(`${start}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { start, end: addDays(next.toISOString().slice(0, 10), -1) };
  }
  return { start: day, end: day };
}

/** Check-in days a period asks for: the rule's count, capped by the period's days inside the run. */
export function periodQuota(schedule: HabitSchedule, period: { start: string; end: string }): number {
  let eligible = 0;
  for (let day = period.start; day <= period.end; day = addDays(day, 1)) if (withinRange(schedule, day)) eligible++;
  return Math.min(schedule.times, eligible);
}

/** The goal a check-in is measured against: its own snapshot, else the habit's; never below 1 when unset or 0. */
export function effectiveGoal(checkinGoal: unknown, habitGoal: unknown): number {
  const goal = checkinGoal != null ? Number(checkinGoal) : habitGoal != null ? Number(habitGoal) : 1;
  return Number.isFinite(goal) && goal > 0 ? goal : 1;
}

/** Status 2 is done, status 1 is an explicit "not done"; otherwise the value decides. */
export function goalMet(checkin: { value?: unknown; goal?: unknown; status?: unknown } | undefined, habitGoal: unknown): boolean {
  if (!checkin) return false;
  const status = checkin.status == null ? null : Number(checkin.status);
  if (status === 2) return true;
  if (status === 1) return false;
  return Number(checkin.value ?? 0) >= effectiveGoal(checkin.goal, habitGoal) - 1e-9;
}

/**
 * Whether a habit still asks for a check-in on `day`, given the days of
 * that day's period whose goal is met: fixed rules on planned days that are
 * not done yet; flexible rules while the period's quota is open and `day`
 * itself is not done.
 */
export function needsCheckin(schedule: HabitSchedule, day: string, metDays: ReadonlySet<string>): boolean {
  if (!isPlannedDay(schedule, day) || metDays.has(day)) return false;
  if (!isFlexible(schedule)) return true;
  const period = periodOf(schedule, day);
  let met = 0;
  for (const metDay of metDays) if (metDay >= period.start && metDay <= period.end) met++;
  return met < periodQuota(schedule, period);
}
