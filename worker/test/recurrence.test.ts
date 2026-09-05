import { describe, expect, it } from 'vitest';
import { nextOccurrence, parseRule } from '../src/recurrence.js';

describe('parseRule', () => {
  it('reads freq, interval and byday', () => {
    expect(parseRule('RRULE:FREQ=DAILY')).toMatchObject({ freq: 'DAILY', interval: 1 });
    expect(parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR')).toMatchObject({
      freq: 'WEEKLY',
      interval: 2,
    });
    expect(parseRule('RRULE:FREQ=MONTHLY;BYMONTHDAY=15')).toMatchObject({ byMonthDay: 15 });
  });

  it('rejects absent or malformed rules', () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule('')).toBeNull();
    expect(parseRule('RRULE:FREQ=SECONDLY')).toBeNull();
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
