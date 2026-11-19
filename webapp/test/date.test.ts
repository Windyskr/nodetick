import { beforeAll, describe, expect, it } from 'vitest';
import {
  addDays,
  allDayDate,
  bucketLabel,
  bucketOf,
  dayOf,
  detailDate,
  fmtDuration,
  fmtClock,
  lastNDays,
  localDayClock,
  nextOccurrence,
  parseInstant,
  relTime,
  shortDate,
  stampOf,
  todayStr,
  weekdayShort,
} from '../src/lib/date';
import {
  dateTimeParts,
  dayDistance,
  daysInRange,
  localDateTime,
  moveDateToDay,
  postponePatch,
  scheduleLabel,
  timeOf,
} from '../src/components/taskSchedule';
import { useI18n } from '../src/i18n';

const setLang = (lang: 'en' | 'zh') => useI18n.setState({ lang });

const today = todayStr();
const shift = (days: number): string => addDays(today, days);
const iso = (day: number) => new Date().toISOString() && new Date(Date.now() - day * 86400000).toISOString();

describe('date basics', () => {
  it('dayOf extracts the YYYY-MM-DD prefix', () => {
    expect(dayOf('2026-07-18T09:00:00+0000')).toBe('2026-07-18');
    expect(dayOf('2026-07-18')).toBe('2026-07-18');
    expect(dayOf(null)).toBeNull();
    expect(dayOf('garbage')).toBeNull();
  });

  it('addDays rolls over months and years', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29'); // leap year
  });

  it('allDayDate appends the backend-compatible suffix', () => {
    expect(allDayDate('2026-09-05')).toBe('2026-09-05T00:00:00+0000');
  });

  it('round-trips local time parts without changing the calendar day', () => {
    const value = localDateTime('2026-09-05', '09:30');
    expect(value).toMatch(/^2026-09-05T09:30:00[+-]\d{4}$/);
    expect(dateTimeParts(value)).toEqual({ date: '2026-09-05', time: '09:30' });
    expect(timeOf(value)).toBe('09:30');
  });

  it('lists every day in a task range and can shift its timed values', () => {
    expect(daysInRange('2026-09-05T09:00:00+0800', '2026-09-07T11:00:00+0800')).toEqual([
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ]);
    expect(dayDistance('2026-09-05', '2026-09-07')).toBe(2);
    expect(moveDateToDay('2026-09-05T09:00:00+0800', '2026-09-06', false)).toMatch(
      /^2026-09-06T09:00:00[+-]\d{4}$/,
    );
  });

  it('postponePatch moves the due day to today and keeps clock times', () => {
    const base = { projectId: 'inbox', startDate: null };
    expect(postponePatch({ ...base, dueDate: '2026-11-16T00:00:00+0000', isAllDay: true }, '2026-11-19')).toEqual({
      projectId: 'inbox',
      isAllDay: true,
      dueDate: '2026-11-19T00:00:00+0000',
    });
    const timed = postponePatch({ ...base, dueDate: '2026-11-17T14:30:00+0800', isAllDay: false }, '2026-11-19');
    expect(timed.isAllDay).toBe(false);
    expect(dateTimeParts(timed.dueDate as string)).toEqual({ date: '2026-11-19', time: '14:30' });
    expect(timed).not.toHaveProperty('startDate');
  });

  it('postponePatch shifts a range by the same number of days', () => {
    const patch = postponePatch({
      projectId: 'work',
      startDate: '2026-11-15T09:00:00+0800',
      dueDate: '2026-11-17T18:00:00+0800',
      isAllDay: false,
    }, '2026-11-19');
    expect(dateTimeParts(patch.startDate as string)).toEqual({ date: '2026-11-17', time: '09:00' });
    expect(dateTimeParts(patch.dueDate as string)).toEqual({ date: '2026-11-19', time: '18:00' });
  });

  it('stampOf strips dashes', () => {
    expect(stampOf('2026-08-31')).toBe(20260831);
  });

  it('lastNDays is ordered oldest → newest and includes today', () => {
    const days = lastNDays(7);
    expect(days).toHaveLength(7);
    expect(days[6]).toBe(today);
    expect(days[5]).toBe(shift(-1));
  });

  it('fmtClock pads minutes and seconds', () => {
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(1500)).toBe('25:00');
    expect(fmtClock(65)).toBe('01:05');
  });

  it('parseInstant honours the offset, with or without a colon', () => {
    const ms = Date.UTC(2026, 10, 19, 3, 0);
    expect(parseInstant('2026-11-19T03:00:00.000+0000')).toBe(ms);
    expect(parseInstant('2026-11-19T11:00:00+0800')).toBe(ms);
    expect(parseInstant('2026-11-18T22:00:00-05:00')).toBe(ms);
    expect(parseInstant('garbage')).toBeNull();
    expect(parseInstant(null)).toBeNull();
  });

  it('localDayClock labels a UTC focus time in the local zone', () => {
    const local = new Date(Date.UTC(2026, 10, 18, 20, 0));
    const p = (n: number) => String(n).padStart(2, '0');
    expect(localDayClock('2026-11-18T20:00:00.000+0000')).toEqual({
      day: `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}`,
      clock: `${p(local.getHours())}:${p(local.getMinutes())}`,
    });
    expect(localDayClock('')).toBeNull();
  });
});

describe('bucketOf (relative to the real today)', () => {
  it.each([
    [-1, 'overdue'],
    [-30, 'overdue'],
    [0, 'today'],
    [1, 'tomorrow'],
    [2, 'next7'],
    [7, 'next7'],
    [8, 'later'],
  ])('%+i days → %s', (offset, expected) => {
    expect(bucketOf({ dueDate: `${shift(offset)}T00:00:00+0000` })).toBe(expected);
  });

  it('no due date → nodate', () => {
    expect(bucketOf({ dueDate: null })).toBe('nodate');
  });

  it('bucket labels are localized', () => {
    setLang('zh');
    expect(bucketLabel('overdue')).toBe('已过期');
    expect(bucketLabel('nodate')).toBe('无日期');
    setLang('en');
    expect(bucketLabel('overdue')).toBe('Overdue');
    expect(bucketLabel('nodate')).toBe('No Date');
  });
});

describe('localized rendering', () => {
  beforeAll(() => setLang('en'));

  it('shortDate: Jul 18 vs 7月18日', () => {
    setLang('en');
    expect(shortDate('2026-07-18T09:00:00+0000')).toBe('Jul 18');
    setLang('zh');
    expect(shortDate('2026-07-18T09:00:00+0000')).toBe('7月18日');
  });

  it('detailDate: relative days and year handling', () => {
    setLang('en');
    expect(detailDate(`${today}T00:00:00+0000`)).toBe('Today');
    expect(detailDate(`${shift(1)}T00:00:00+0000`)).toBe('Tomorrow');
    expect(detailDate(`${shift(-1)}T00:00:00+0000`)).toBe('Yesterday');
    expect(detailDate('2026-07-18T00:00:00+0000')).toBe('Jul 18');
    expect(detailDate('2025-07-18T00:00:00+0000')).toBe('Jul 18, 2025');
    setLang('zh');
    expect(detailDate(`${today}T00:00:00+0000`)).toBe('今天');
    expect(detailDate(`${shift(-1)}T00:00:00+0000`)).toBe('昨天');
    expect(detailDate('2026-07-18T00:00:00+0000')).toBe('7月18日');
    expect(detailDate('2025-07-18T00:00:00+0000')).toBe('2025年7月18日');
  });

  it('renders a same-day task time range', () => {
    setLang('en');
    expect(scheduleLabel('2026-09-10T09:00:00+0800', '2026-09-10T11:30:00+0800', false)).toBe(
      'Sep 10 09:00–11:30',
    );
  });

  it('weekdayShort is localized', () => {
    setLang('en');
    expect(weekdayShort('2026-09-02')).toBe('Wed');
    setLang('zh');
    expect(weekdayShort('2026-09-02')).toBe('周三');
  });

  it('fmtDuration is localized and skips zero units', () => {
    setLang('en');
    expect(fmtDuration(3661)).toBe('1h 1m');
    expect(fmtDuration(1500)).toBe('25m');
    expect(fmtDuration(59)).toBe('59s');
    setLang('zh');
    expect(fmtDuration(3661)).toBe('1小时1分');
    expect(fmtDuration(1500)).toBe('25分钟');
    expect(fmtDuration(59)).toBe('59秒');
  });

  it('relTime covers all branches', () => {
    setLang('en');
    expect(relTime(new Date().toISOString())).toBe('just now');
    expect(relTime(iso(3))).toBe('3d ago');
    setLang('zh');
    expect(relTime(new Date().toISOString())).toBe('刚刚');
    expect(relTime(new Date(Date.now() - 5 * 60000).toISOString())).toBe('5分钟前');
    expect(relTime(new Date(Date.now() - 3 * 3600000).toISOString())).toBe('3小时前');
    expect(relTime(iso(3))).toBe('3天前');
    expect(relTime(null)).toBe('');
    expect(relTime('not-a-date')).toBe('');
  });
});

describe('nextOccurrence (repeating countdowns)', () => {
  it('moves a past yearly date to its next anniversary', () => {
    expect(nextOccurrence('1970-03-15', 'yearly', '2026-11-19')).toBe('2027-03-15');
    expect(nextOccurrence('1990-12-25', 'yearly', '2026-11-19')).toBe('2026-12-25');
    expect(nextOccurrence('1990-11-19', 'yearly', '2026-11-19')).toBe('2026-11-19');
    expect(nextOccurrence('2000-02-29', 'yearly', '2026-11-19')).toBe('2027-02-28');
  });

  it('moves a past monthly date to this or next month', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-11-19')).toBe('2026-11-30');
    expect(nextOccurrence('2026-01-05', 'monthly', '2026-11-19')).toBe('2026-12-05');
    expect(nextOccurrence('2025-12-31', 'monthly', '2026-12-31')).toBe('2026-12-31');
  });

  it('leaves future and non-repeating dates alone', () => {
    expect(nextOccurrence('2026-12-31', 'yearly', '2026-11-19')).toBe('2026-12-31');
    expect(nextOccurrence('1970-03-15', null, '2026-11-19')).toBe('1970-03-15');
  });
});
