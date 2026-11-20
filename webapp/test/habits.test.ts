import { describe, expect, it } from 'vitest';
import {
  calendarDays,
  checkinTotals,
  dayToStamp,
  formatHabitRule,
  habitStreaks,
  heatLevel,
  isDueOn,
  isGoalMet,
  isPlannedDay,
  lastDay,
  monthRate,
  monthlySeries,
  parseHabitRule,
  periodOf,
  periodProgress,
  periodQuota,
  withinRange,
  type HabitContext,
  type HabitRule,
} from '../src/lib/habits';
import type { CheckinRow } from '../src/lib/types';

const rule = (repeatRule: string | null, extra: { type?: string; goal?: number | null; step?: number | null } = {}) =>
  parseHabitRule({ repeatRule, type: extra.type ?? null, goal: extra.goal ?? null, step: extra.step ?? null });

/** A habit context with check-ins: `{ '2026-11-20': 8 }` or a full row. */
function context(repeatRule: string | null, checkins: Record<string, number | Partial<CheckinRow>>, goal: number | null = null): HabitContext {
  const map = new Map<number, CheckinRow>();
  for (const [day, value] of Object.entries(checkins)) {
    const row = typeof value === 'number' ? { value } : value;
    map.set(dayToStamp(day), { stamp: dayToStamp(day), value: null, goal: null, status: null, time: null, ...row });
  }
  return { rule: rule(repeatRule), goal, checkins: map };
}

/** Met (value 1) on each listed day. */
const metDays = (days: string[]) => Object.fromEntries(days.map((day) => [day, 1]));

describe('habit rules (shared vectors with worker/test/habit.test.ts)', () => {
  it('reads every frequency, the start, the duration and UNTIL', () => {
    expect(rule('RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA\nX-NODETICK-FREQ:daily\nX-NODETICK-START:20261101\nX-NODETICK-DAYS:0'))
      .toMatchObject({ frequency: 'daily', startDate: '2026-11-01', durationDays: null });
    expect(rule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR')).toMatchObject({ frequency: 'weekly', weekdays: ['MO', 'WE', 'FR'] });
    expect(rule('RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA\nX-NODETICK-FREQ:weekly').frequency).toBe('weekly');
    expect(rule('RRULE:FREQ=DAILY;INTERVAL=3\nX-NODETICK-START:20261101')).toMatchObject({ frequency: 'interval', interval: 3 });
    expect(rule('RRULE:FREQ=DAILY;INTERVAL=1').frequency).toBe('daily');
    expect(rule('RRULE:FREQ=WEEKLY;TT_TIMES=3;WKST=MO')).toMatchObject({ frequency: 'perWeek', times: 3, weekStart: 'MO' });
    expect(rule('RRULE:FREQ=MONTHLY;TT_TIMES=10')).toMatchObject({ frequency: 'perMonth', times: 10, weekStart: 'SU' });
    expect(rule('RRULE:FREQ=DAILY;UNTIL=20261231T000000Z')).toMatchObject({ until: '2026-12-31' });
    expect(rule('DTSTART;VALUE=DATE:20260105\nRRULE:FREQ=DAILY;COUNT=10')).toMatchObject({ startDate: '2026-01-05', durationDays: 10 });
    expect(rule(null)).toMatchObject({ frequency: 'daily', startDate: null, durationDays: null });
    expect(rule('RRULE:FREQ=YEARLY;BYMONTH=1').frequency).toBe('daily');
  });

  it('reads the target, record mode and log switch, with fallbacks for rules from other clients', () => {
    expect(rule('X-NODETICK-TARGET:count\nX-NODETICK-RECORD:complete\nX-NODETICK-LOG:1')).toMatchObject({ target: 'count', recordMode: 'complete', autoLog: true });
    expect(rule('RRULE:FREQ=DAILY;INTERVAL=1', { type: 'Real', step: 2 })).toMatchObject({ target: 'count', recordMode: 'auto', autoLog: false });
    expect(rule('RRULE:FREQ=DAILY;INTERVAL=1', { goal: 8 })).toMatchObject({ target: 'count', recordMode: 'manual' });
    expect(rule('RRULE:FREQ=DAILY;INTERVAL=1', { type: 'Boolean', goal: 1 }).target).toBe('complete');
    expect(rule('X-NODETICK-TARGET:complete', { type: 'Real' }).target).toBe('complete');
  });

  it('decides planned days, the run and periods', () => {
    const weekdays = rule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\nX-NODETICK-START:20261101\nX-NODETICK-DAYS:30');
    expect(isPlannedDay(weekdays, '2026-11-02')).toBe(true);
    expect(isPlannedDay(weekdays, '2026-11-03')).toBe(false);
    expect(isPlannedDay(weekdays, '2026-10-30')).toBe(false);
    expect(withinRange(weekdays, '2026-11-30')).toBe(true);
    expect(withinRange(weekdays, '2026-12-01')).toBe(false);
    expect(lastDay(weekdays)).toBe('2026-11-30');
    const interval = rule('RRULE:FREQ=DAILY;INTERVAL=3\nX-NODETICK-START:20261101');
    expect(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((day) => isPlannedDay(interval, day)))
      .toEqual([true, false, false, true]);
    expect(periodOf(rule('RRULE:FREQ=WEEKLY;TT_TIMES=3'), '2026-11-20')).toEqual({ start: '2026-11-15', end: '2026-11-21' });
    expect(periodOf(rule('RRULE:FREQ=WEEKLY;TT_TIMES=3;WKST=MO'), '2026-11-22')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(periodOf(rule('RRULE:FREQ=MONTHLY;TT_TIMES=3'), '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    const late = rule('RRULE:FREQ=WEEKLY;TT_TIMES=5\nX-NODETICK-START:20261119');
    expect(periodQuota(late, periodOf(late, '2026-11-20'))).toBe(3);
  });

  it('writes rules back, keeping what it does not understand', () => {
    const stored = 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;WKST=MO;X-CUSTOM=1\nX-NODETICK-FREQ:weekly\nX-NODETICK-START:20261101\nX-NODETICK-DAYS:0\nX-NODETICK-TARGET:complete\nX-NODETICK-RECORD:manual\nX-NODETICK-LOG:0\nX-OTHER-CLIENT:keep me';
    const before = rule(stored);
    expect(before.extraLines).toEqual(['X-OTHER-CLIENT:keep me']);
    // Same schedule: the RRULE line survives verbatim, unknown lines too.
    const renamed = formatHabitRule({ ...before, autoLog: true }, before);
    expect(renamed.split('\n')[0]).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;WKST=MO;X-CUSTOM=1');
    expect(renamed).toContain('X-NODETICK-LOG:1');
    expect(renamed.split('\n').at(-1)).toBe('X-OTHER-CLIENT:keep me');
    expect(formatHabitRule(before, before)).toBe(stored);
    // A new schedule writes a fresh RRULE line.
    const flexible: HabitRule = { ...before, frequency: 'perWeek', times: 3 };
    const written = formatHabitRule(flexible, before);
    expect(written.split('\n')[0]).toBe('RRULE:FREQ=WEEKLY;TT_TIMES=3;WKST=MO');
    expect(rule(written)).toMatchObject({ frequency: 'perWeek', times: 3, weekStart: 'MO', startDate: '2026-11-01', extraLines: ['X-OTHER-CLIENT:keep me'] });
    // Each frequency round-trips.
    for (const next of [
      { frequency: 'daily' },
      { frequency: 'weekly', weekdays: ['TU', 'TH'] },
      { frequency: 'interval', interval: 4 },
      { frequency: 'perMonth', times: 12 },
    ] as Partial<HabitRule>[]) {
      expect(rule(formatHabitRule({ ...before, ...next }, null))).toMatchObject(next);
    }
    // Rules from the old form read the same as before.
    expect(rule('RRULE:FREQ=DAILY;INTERVAL=2\nX-NODETICK-FREQ:interval\nX-NODETICK-START:20261120\nX-NODETICK-DAYS:21\nX-NODETICK-INTERVAL:2\nX-NODETICK-TARGET:count\nX-NODETICK-RECORD:auto\nX-NODETICK-LOG:0'))
      .toMatchObject({ frequency: 'interval', interval: 2, startDate: '2026-11-20', durationDays: 21, target: 'count', recordMode: 'auto', extraLines: [] });
    expect(formatHabitRule({ ...rule(null), until: '2027-01-31' }, null).split('\n')[0]).toBe('RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA;UNTIL=20270131');
  });
});

describe('habit goals and due days', () => {
  it('meets goals by status or value', () => {
    const row = (value: number | null, goal: number | null, status: number | null): CheckinRow => ({ stamp: 20261120, value, goal, status, time: null });
    expect(isGoalMet(row(8, 8, 0), 8)).toBe(true);
    expect(isGoalMet(row(3, null, null), 8)).toBe(false);
    expect(isGoalMet(row(0, 8, 2), 8)).toBe(true);
    expect(isGoalMet(row(9, 8, 1), 8)).toBe(false);
    expect(isGoalMet(row(1, 0, null), null)).toBe(true);
    expect(isGoalMet(row(0.3, 0.3, null), null)).toBe(true);
    expect(isGoalMet(undefined, 1)).toBe(false);
  });

  it('puts fixed habits on their planned days and flexible ones on days their period still needs', () => {
    const weekdays = context('RRULE:FREQ=WEEKLY;BYDAY=MO,FR', {});
    expect(isDueOn(weekdays, '2026-11-20')).toBe(true); // Friday
    expect(isDueOn(weekdays, '2026-11-19')).toBe(false);
    const twice = context('RRULE:FREQ=WEEKLY;TT_TIMES=2', metDays(['2026-11-16']));
    expect(isDueOn(twice, '2026-11-20')).toBe(true);
    const filled = context('RRULE:FREQ=WEEKLY;TT_TIMES=2', metDays(['2026-11-16', '2026-11-18']));
    expect(isDueOn(filled, '2026-11-20')).toBe(false);
    expect(isDueOn(filled, '2026-11-18')).toBe(true); // a checked-in day stays listed
    expect(periodProgress(filled, '2026-11-20')).toMatchObject({ done: 2, quota: 2 });
    const ended = context('RRULE:FREQ=DAILY\nX-NODETICK-START:20261101\nX-NODETICK-DAYS:7', {});
    expect([isDueOn(ended, '2026-11-07'), isDueOn(ended, '2026-11-08'), isDueOn(ended, '2026-10-31')]).toEqual([true, false, false]);
  });
});

describe('habit streaks', () => {
  const today = '2026-11-20'; // a Friday
  const floor = '2026-01-01';

  it('counts consecutive days and does not break on a pending today', () => {
    const daily = context(null, metDays(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']));
    expect(habitStreaks(daily, today, floor)).toMatchObject({ current: 4, longest: 4 });
    const withToday = context(null, metDays(['2026-11-18', '2026-11-19', '2026-11-20']));
    expect(habitStreaks(withToday, today, floor)).toMatchObject({ current: 3, longest: 3 });
    const gap = context(null, metDays(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-14', '2026-11-19']));
    expect(habitStreaks(gap, today, floor)).toMatchObject({ current: 1, longest: 3 });
    expect(habitStreaks(context(null, metDays(['2026-11-18'])), today, floor).current).toBe(0);
  });

  it('skips days a fixed rule does not plan', () => {
    // Mon/Wed/Fri: 9, 11, 13, 16, 18, 20 met; the Tuesdays and weekends don't break it.
    const mwf = context('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', metDays(['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-16', '2026-11-18', '2026-11-20']));
    expect(habitStreaks(mwf, today, floor)).toMatchObject({ current: 6, longest: 6 });
    // A missed Wednesday breaks it.
    const missed = context('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', metDays(['2026-11-09', '2026-11-13', '2026-11-16', '2026-11-18']));
    expect(habitStreaks(missed, today, floor)).toMatchObject({ current: 3, longest: 3 });
    // Every 3 days from Nov 2: 2, 5, 8, 11, 14, 17, 20.
    const every3 = context('RRULE:FREQ=DAILY;INTERVAL=3\nX-NODETICK-START:20261102', metDays(['2026-11-11', '2026-11-14', '2026-11-17']));
    expect(habitStreaks(every3, today, floor)).toMatchObject({ current: 3, longest: 3 });
    // An off-day check-in still counts.
    const extra = context('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', metDays(['2026-11-16', '2026-11-17', '2026-11-18']));
    expect(habitStreaks(extra, today, floor).current).toBe(3);
  });

  it('carries flexible streaks across the rest days of a fulfilled period', () => {
    // 3 days a week, weeks from Sunday. Nov 8–14: Mon–Wed done (rest Thu–Sat).
    // Nov 15–21 (today Fri 20): Mon 16 done, 4 days remain for 2 more → still open.
    const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-16'];
    const perWeek = context('RRULE:FREQ=WEEKLY;TT_TIMES=3\nX-NODETICK-START:20261108', metDays(days));
    expect(habitStreaks(perWeek, today, floor)).toMatchObject({ current: 4, longest: 4, reachesFloor: false });
    // On Saturday the 21st one day is left and two are needed: the week can't
    // make it, so its missed Sunday breaks the streak before Monday's check-in.
    expect(habitStreaks(perWeek, '2026-11-21', floor)).toMatchObject({ current: 0, longest: 3 });
    // A past week that fell short (Nov 1–7: one day) breaks it: Nov 2 isn't part of the streak.
    const short = context('RRULE:FREQ=WEEKLY;TT_TIMES=3\nX-NODETICK-START:20261101', metDays(['2026-11-02', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-17']));
    expect(habitStreaks(short, today, floor)).toMatchObject({ current: 4, longest: 4 });
    // N days a month: October met its 2, November is still open.
    const perMonth = context('RRULE:FREQ=MONTHLY;TT_TIMES=2\nX-NODETICK-START:20261001', metDays(['2026-10-05', '2026-10-20', '2026-11-03']));
    expect(habitStreaks(perMonth, today, floor)).toMatchObject({ current: 3, longest: 3 });
  });

  it('flags a streak that reaches back past the loaded data', () => {
    const allYear = context(null, metDays(Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`)));
    expect(habitStreaks(allYear, '2026-01-30', '2026-01-01')).toMatchObject({ current: 30, reachesFloor: true });
    const started = context('RRULE:FREQ=DAILY\nX-NODETICK-START:20260101', metDays(['2026-01-01', '2026-01-02']));
    expect(habitStreaks(started, '2026-01-02', '2026-01-01').reachesFloor).toBe(false);
    expect(habitStreaks(context(null, {}), '2026-01-05', '2026-01-01').reachesFloor).toBe(false);
    expect(habitStreaks(context('RRULE:FREQ=DAILY\nX-NODETICK-START:20261201', {}), today, floor)).toEqual({ current: 0, longest: 0, reachesFloor: false });
  });
});

describe('habit statistics', () => {
  const today = '2026-11-20';

  it('rates a month by its planned days, its quota or its weeks', () => {
    // Daily, Nov 1–19 count, today only once done: 10 of 19.
    const daily = context(null, metDays(Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)));
    expect(monthRate(daily, '2026-11', today)).toBe(53);
    expect(monthRate(daily, '2026-12', today)).toBeNull();
    expect(monthRate(daily, '2026-10', today)).toBe(0);
    // Mon/Wed/Fri in November up to the 19th: 2,4,6,9,11,13,16,18 = 8 planned.
    const mwf = context('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', metDays(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-17']));
    expect(monthRate(mwf, '2026-11', today)).toBe(38);
    // 10 days a month: 4 done.
    const perMonth = context('RRULE:FREQ=MONTHLY;TT_TIMES=10', metDays(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08']));
    expect(monthRate(perMonth, '2026-11', today)).toBe(40);
    // 7 days a week over a whole past month is every day.
    const perWeek = context('RRULE:FREQ=WEEKLY;TT_TIMES=7', metDays(Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)));
    expect(monthRate(perWeek, '2026-10', today)).toBe(100);
    // Starting mid-month only asks for the days since the start.
    const started = context('RRULE:FREQ=DAILY\nX-NODETICK-START:20261118', metDays(['2026-11-18', '2026-11-19']));
    expect(monthRate(started, '2026-11', today)).toBe(100);
  });

  it('totals days and amounts and shades the heatmap', () => {
    const water = context('X-NODETICK-TARGET:count', {
      '2026-10-31': { value: 8, goal: 8 },
      '2026-11-01': { value: 0.1, goal: 8 },
      '2026-11-02': { value: 0.2, goal: 8 },
      '2026-11-03': { value: 4, goal: 8 },
      '2026-11-04': { value: 7, goal: 8 },
      '2026-11-05': { value: 9, goal: 8 },
    }, 8);
    expect(checkinTotals(water)).toEqual({ days: 2, amount: 28.3 });
    expect(checkinTotals(water, '202611')).toEqual({ days: 1, amount: 20.3 });
    expect(['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((day) => heatLevel(water, day))).toEqual([1, 2, 3, 4, 0]);
    expect(monthlySeries(water, 2026, 'days').slice(9, 11)).toEqual([1, 1]);
    expect(monthlySeries(water, 2026, 'amount').slice(9, 11)).toEqual([8, 20.3]);
  });

  it('lays out a month calendar from the week start', () => {
    const days = calendarDays('2026-11', 'SU');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-11-01'); // November 2026 starts on a Sunday
    expect(calendarDays('2026-11', 'MO')[0]).toBe('2026-10-26');
  });
});
