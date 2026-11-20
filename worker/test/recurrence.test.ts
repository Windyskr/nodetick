import { describe, expect, it } from 'vitest';
import { nextOccurrence, nextRepeat, parseRule } from '../src/recurrence.js';

describe('parseRule', () => {
  it('reads freq, interval and byday', () => {
    expect(parseRule('RRULE:FREQ=DAILY')).toMatchObject({ freq: 'DAILY', interval: 1 });
    expect(parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR')).toMatchObject({
      freq: 'WEEKLY',
      interval: 2,
    });
    expect(parseRule('RRULE:FREQ=MONTHLY;BYMONTHDAY=15')).toMatchObject({ byMonthDay: [15] });
  });

  it('rejects absent or malformed rules', () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule('')).toBeNull();
    expect(parseRule('RRULE:FREQ=SECONDLY')).toBeNull();
  });

  it('reads ordinal weekdays, lists, set positions and the end of the series', () => {
    expect(parseRule('RRULE:FREQ=MONTHLY;BYDAY=2TU,-1FR;BYSETPOS=1,-1;BYMONTHDAY=1,15,-1')).toMatchObject({
      byWeekday: [{ weekday: 2, nth: 2 }, { weekday: 5, nth: -1 }],
      byDay: new Set([2, 5]),
      bySetPos: [1, -1],
      byMonthDay: [1, 15, -1],
    });
    expect(parseRule('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=+4TH;UNTIL=20301231')).toMatchObject({
      byMonth: [11],
      byWeekday: [{ weekday: 4, nth: 4 }],
      until: '2030-12-31',
      untilInstant: null,
    });
    expect(parseRule('RRULE:FREQ=DAILY;UNTIL=20270131T155959Z;COUNT=10')).toMatchObject({
      until: '2027-01-31',
      untilInstant: Date.UTC(2027, 0, 31, 15, 59, 59),
      count: 10,
    });
    // Malformed parts are ignored rather than half-applied.
    expect(parseRule('RRULE:FREQ=MONTHLY;BYDAY=0TU;BYMONTHDAY=0,32;BYMONTH=13;UNTIL=20270230;COUNT=0')).toMatchObject({
      byWeekday: null,
      byMonthDay: null,
      byMonth: null,
      until: null,
      count: null,
    });
  });
});

describe('nextOccurrence', () => {
  it('advances a daily all-day task by one day, preserving the suffix', () => {
    expect(nextOccurrence('RRULE:FREQ=DAILY', '2026-09-05T00:00:00+0000', '2026-09-05')).toBe(
      '2026-09-06T00:00:00+0000',
    );
  });

  it('never spawns an occurrence on or before the completion day', () => {
    // Overdue task: the missed days are skipped, next lands after completion.
    expect(nextOccurrence('RRULE:FREQ=DAILY', '2026-09-01T00:00:00+0000', '2026-09-05')).toBe(
      '2026-09-06T00:00:00+0000',
    );
  });

  it('preserves the wall-clock time and UTC offset for timed tasks', () => {
    expect(nextOccurrence('RRULE:FREQ=DAILY', '2026-09-05T09:30:00+0800', '2026-09-05')).toBe(
      '2026-09-06T09:30:00+0800',
    );
  });

  it('honors INTERVAL for daily rules', () => {
    expect(nextOccurrence('RRULE:FREQ=DAILY;INTERVAL=3', '2026-09-01T00:00:00+0000', '2026-09-01')).toBe(
      '2026-09-04T00:00:00+0000',
    );
  });

  it('weekly rules land on the next matching weekday', () => {
    // 2026-08-31 is a Monday; completed on Saturday 09-05 → next Monday 09-07.
    expect(nextOccurrence('RRULE:FREQ=WEEKLY', '2026-08-31T00:00:00+0000', '2026-09-05')).toBe(
      '2026-09-07T00:00:00+0000',
    );
  });

  it('weekly BYDAY picks the next day in the set', () => {
    // 2026-09-04 is a Friday; MO,WE,FR → next is Monday 09-07.
    expect(nextOccurrence('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-09-04T00:00:00+0000', '2026-09-04')).toBe(
      '2026-09-07T00:00:00+0000',
    );
  });

  it('weekday daily rules skip the weekend', () => {
    expect(nextOccurrence('RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', '2026-09-04T00:00:00+0000', '2026-09-04')).toBe(
      '2026-09-07T00:00:00+0000',
    );
  });

  it('biweekly rules skip a whole week', () => {
    expect(nextOccurrence('RRULE:FREQ=WEEKLY;INTERVAL=2', '2026-08-31T00:00:00+0000', '2026-08-31')).toBe(
      '2026-09-14T00:00:00+0000',
    );
  });

  it('monthly rules clamp to the last day of shorter months', () => {
    expect(nextOccurrence('RRULE:FREQ=MONTHLY', '2026-01-31T00:00:00+0000', '2026-01-31')).toBe(
      '2026-02-28T00:00:00+0000',
    );
    expect(nextOccurrence('RRULE:FREQ=MONTHLY;BYMONTHDAY=15', '2026-09-15T00:00:00+0000', '2026-09-15')).toBe(
      '2026-10-15T00:00:00+0000',
    );
  });

  it('yearly rules support month/day overrides and leap-day clamping', () => {
    expect(nextOccurrence('RRULE:FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25', '2025-12-25T00:00:00+0000', '2025-12-25')).toBe(
      '2026-12-25T00:00:00+0000',
    );
    expect(nextOccurrence('RRULE:FREQ=YEARLY', '2024-02-29T00:00:00+0000', '2024-02-29')).toBe(
      '2025-02-28T00:00:00+0000',
    );
  });

  it('returns null without a usable rule or anchor date', () => {
    expect(nextOccurrence(null, '2026-09-05T00:00:00+0000')).toBeNull();
    expect(nextOccurrence('RRULE:FREQ=DAILY', null)).toBeNull();
    expect(nextOccurrence('RRULE:FREQ=DAILY', 'not-a-date')).toBeNull();
  });
});

describe('relative and multi-day rules', () => {
  const next = (rule: string, anchor: string, after = anchor) => nextOccurrence(rule, `${anchor}T00:00:00+0000`, after);

  it('monthly on the nth weekday', () => {
    // 2026-11-10 is the second Tuesday of November; December's is the 8th.
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=2TU', '2026-11-10')).toBe('2026-12-08T00:00:00+0000');
    expect(next('RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU', '2026-11-10')).toBe('2027-01-12T00:00:00+0000');
    // The same rule written with BYSETPOS (another common encoding).
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2', '2026-11-10')).toBe('2026-12-08T00:00:00+0000');
  });

  it('monthly on the last weekday, the last day and the last working day', () => {
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=-1FR', '2026-11-27')).toBe('2026-12-25T00:00:00+0000');
    // BYMONTHDAY=-1 tracks month ends without drifting to the 28th.
    expect(next('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', '2026-01-31')).toBe('2026-02-28T00:00:00+0000');
    expect(next('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', '2026-02-28')).toBe('2026-03-31T00:00:00+0000');
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2026-01-30')).toBe('2026-02-27T00:00:00+0000');
  });

  it('skips months that lack the nth weekday', () => {
    // Fifth Fridays in 2026: Jan 30, May 29, Jul 31, Oct 30.
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=5FR', '2026-01-30')).toBe('2026-05-29T00:00:00+0000');
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=5FR', '2026-07-31')).toBe('2026-10-30T00:00:00+0000');
  });

  it('several days a month, and weekday plus day of month', () => {
    expect(next('RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15', '2026-03-01')).toBe('2026-03-15T00:00:00+0000');
    expect(next('RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15', '2026-03-15')).toBe('2026-04-01T00:00:00+0000');
    // Friday the 13th: 2026-02-13, 2026-03-13, 2026-11-13.
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', '2026-02-13')).toBe('2026-03-13T00:00:00+0000');
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', '2026-03-13')).toBe('2026-11-13T00:00:00+0000');
  });

  it('yearly on the nth weekday of a month', () => {
    // US Thanksgiving: fourth Thursday of November.
    expect(next('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', '2026-11-26')).toBe('2027-11-25T00:00:00+0000');
    // Without BYMONTH the ordinal counts through the year: the last Friday of 2026 is Dec 25.
    expect(next('RRULE:FREQ=YEARLY;BYDAY=-1FR', '2025-12-26')).toBe('2026-12-25T00:00:00+0000');
  });

  it('catches up on long-overdue tasks without giving up', () => {
    expect(next('RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', '2000-01-03', '2026-09-05')).toBe('2026-09-07T00:00:00+0000');
    expect(next('RRULE:FREQ=MONTHLY;BYDAY=2TU', '2000-01-11', '2026-11-11')).toBe('2026-12-08T00:00:00+0000');
    // Biweekly keeps the anchor's phase: 2000-01-03 + 1392 weeks = 2026-09-07.
    expect(next('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2000-01-03', '2026-09-05')).toBe('2026-09-07T00:00:00+0000');
    expect(next('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2000-01-03', '2026-09-07')).toBe('2026-09-21T00:00:00+0000');
  });

  it('gives up on rules that can never match', () => {
    expect(next('RRULE:FREQ=YEARLY;BYMONTH=2;BYDAY=5FR;BYMONTHDAY=1', '2026-01-01')).toBeNull();
  });
});

describe('end of the series', () => {
  it('stops after UNTIL', () => {
    expect(nextOccurrence('RRULE:FREQ=DAILY;UNTIL=20260907', '2026-09-06T00:00:00+0000', '2026-09-06')).toBe('2026-09-07T00:00:00+0000');
    expect(nextOccurrence('RRULE:FREQ=DAILY;UNTIL=20260907', '2026-09-07T00:00:00+0000', '2026-09-07')).toBeNull();
    expect(nextOccurrence('RRULE:FREQ=MONTHLY;BYDAY=2TU;UNTIL=20261231', '2026-12-08T00:00:00+0000', '2026-12-08')).toBeNull();
  });

  it('compares a timed UNTIL with the occurrence time', () => {
    // 09:00 in UTC+8 on Sep 7 is 01:00Z.
    expect(nextOccurrence('RRULE:FREQ=DAILY;UNTIL=20260907T000000Z', '2026-09-06T09:00:00+0800', '2026-09-06')).toBeNull();
    expect(nextOccurrence('RRULE:FREQ=DAILY;UNTIL=20260907T020000Z', '2026-09-06T09:00:00+0800', '2026-09-06')).toBe('2026-09-07T09:00:00+0800');
  });

  it('counts down COUNT on each spawned occurrence', () => {
    expect(nextRepeat('RRULE:FREQ=DAILY;COUNT=3', '2026-09-05T00:00:00+0000', '2026-09-05')).toEqual({
      date: '2026-09-06T00:00:00+0000',
      repeatFlag: 'RRULE:FREQ=DAILY;COUNT=2',
    });
    expect(nextRepeat('RRULE:FREQ=DAILY;COUNT=1', '2026-09-05T00:00:00+0000', '2026-09-05')).toBeNull();
  });

  it('uses up the occurrences a late completion skips', () => {
    // Five occurrences Sep 1–5; completing the first on Sep 4 leaves only Sep 5.
    expect(nextRepeat('RRULE:FREQ=DAILY;COUNT=5', '2026-09-01T00:00:00+0000', '2026-09-04')).toEqual({
      date: '2026-09-05T00:00:00+0000',
      repeatFlag: 'RRULE:FREQ=DAILY;COUNT=1',
    });
    expect(nextRepeat('RRULE:FREQ=DAILY;COUNT=5', '2026-09-01T00:00:00+0000', '2026-09-05')).toBeNull();
  });

  it('passes rules without COUNT through unchanged', () => {
    expect(nextRepeat('RRULE:FREQ=MONTHLY;BYDAY=-1FR', '2026-11-27T18:00:00+0800', '2026-11-27')).toEqual({
      date: '2026-12-25T18:00:00+0800',
      repeatFlag: 'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
    });
    expect(nextRepeat('RRULE:FREQ=DAILY;UNTIL=20260905', '2026-09-05T00:00:00+0000', '2026-09-05')).toBeNull();
    expect(nextRepeat(null, '2026-09-05')).toBeNull();
  });
});
