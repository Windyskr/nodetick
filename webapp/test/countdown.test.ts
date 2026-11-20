import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Countdown } from '../src/lib/types';

const updateCountdown = vi.fn();
const listCountdowns = vi.fn();
vi.mock('../src/lib/api', () => ({
  api: {
    listCountdowns: (...args: unknown[]) => listCountdowns(...args),
    updateCountdown: (...args: unknown[]) => updateCountdown(...args),
  },
}));

const {
  addMonthsClamped,
  countdownDays,
  countdownProgress,
  countdownTarget,
  countdownYears,
  isPastCountdown,
  occurrencesBetween,
  orderBetween,
  parseLegacyNotes,
  parseViewPrefs,
  previousOccurrence,
  sortCountdowns,
  ymdBetween,
} = await import('../src/lib/countdown');
const { lunarToSolar } = await import('../src/lib/lunar');
const { useCountdowns } = await import('../src/stores/countdowns');

const countdown = (overrides: Partial<Countdown> = {}): Countdown => ({
  id: 'c1', name: 'Event', date: '2026-12-25', kind: 'countdown', reminders: [], repeatFlag: null, calculation: 'standard',
  displayMode: 'on-day', style: 0, color: '#4772FA', icon: null, sortOrder: 0, note: '', pinned: false, archived: false,
  archivedTime: null, reminderTime: null, lunar: false, numberFormat: 'days', showInCalendar: true, createdTime: null,
  ...overrides,
});

const TODAY = '2026-11-20'; // a Friday

describe('countdown target (next occurrence)', () => {
  it('keeps one-off dates and moves solar repeats to the next occurrence', () => {
    expect(countdownTarget(countdown({ date: '2026-12-25' }), TODAY)).toBe('2026-12-25');
    expect(countdownTarget(countdown({ date: '2020-05-20' }), TODAY)).toBe('2020-05-20');
    expect(countdownTarget(countdown({ date: '1990-03-15', repeatFlag: 'yearly' }), TODAY)).toBe('2027-03-15');
    expect(countdownTarget(countdown({ date: '1990-11-20', repeatFlag: 'yearly' }), TODAY)).toBe(TODAY);
    expect(countdownTarget(countdown({ date: '2000-02-29', repeatFlag: 'yearly' }), TODAY)).toBe('2027-02-28');
    expect(countdownTarget(countdown({ date: '2026-01-31', repeatFlag: 'monthly' }), TODAY)).toBe('2026-11-30');
    expect(countdownTarget(countdown({ date: '2027-06-01', repeatFlag: 'yearly' }), TODAY)).toBe('2027-06-01'); // not started
    expect(countdownTarget(countdown({ date: null }), TODAY)).toBeNull();
  });

  it('repeats lunar countdowns on their lunar date', () => {
    const midAutumn = countdown({ date: '1990-10-03', repeatFlag: 'yearly', lunar: true }); // 八月十五
    expect(countdownTarget(midAutumn, TODAY)).toBe(lunarToSolar(2027, 8, 15));
    expect(countdownTarget(midAutumn, '2026-09-01')).toBe('2026-09-25');
    // The solar anniversary would be Oct 3; a lunar one-off stays on its day.
    expect(countdownTarget({ ...midAutumn, lunar: false }, '2026-09-01')).toBe('2026-10-03');
    expect(countdownTarget({ ...midAutumn, repeatFlag: null }, '2026-09-01')).toBe('1990-10-03');
    // Lunar does not change monthly repeats.
    expect(countdownTarget(countdown({ date: '2026-01-31', repeatFlag: 'monthly', lunar: true }), TODAY)).toBe('2026-11-30');
    // Born in 2023's 闰二月: the regular 二月 in other years.
    expect(countdownTarget(countdown({ date: '2023-03-22', repeatFlag: 'yearly', lunar: true }), '2024-01-01')).toBe('2024-03-10');
  });
});

describe('day counting', () => {
  it('counts calendar days, negative once past', () => {
    expect(countdownDays(TODAY, '2026-12-25')).toBe(35);
    expect(countdownDays(TODAY, TODAY)).toBe(0);
    expect(countdownDays(TODAY, '2026-11-19')).toBe(-1);
    expect(countdownDays('2026-03-07', '2026-03-09')).toBe(2); // across a DST change in many zones
    expect(countdownDays('2020-05-20', TODAY)).toBe(2375);
  });

  it('counts workdays like the original day-by-day loop', () => {
    // Friday → Monday: just Monday; Friday → Sunday: none.
    expect(countdownDays(TODAY, '2026-11-23', true)).toBe(1);
    expect(countdownDays(TODAY, '2026-11-22', true)).toBe(0);
    expect(countdownDays(TODAY, '2026-11-27', true)).toBe(5);
    expect(countdownDays(TODAY, '2026-11-16', true)).toBe(-4); // Mon–Thu before today
    expect(countdownDays(TODAY, TODAY, true)).toBe(0);
    const loop = (start: string, end: string) => {
      const direction = end >= start ? 1 : -1;
      let cursor = Date.parse(`${start}T00:00:00Z`);
      const target = Date.parse(`${end}T00:00:00Z`);
      let total = 0;
      while (cursor !== target) {
        cursor += direction * 86400000;
        const weekday = new Date(cursor).getUTCDay();
        if (weekday !== 0 && weekday !== 6) total += direction;
      }
      return total;
    };
    const day = (offset: number) => new Date(Date.UTC(2026, 0, 1) + offset * 86400000).toISOString().slice(0, 10);
    for (let a = 0; a < 21; a++) {
      for (let b = 0; b < 400; b += 3) expect(countdownDays(day(a), day(b), true), `${day(a)} → ${day(b)}`).toBe(loop(day(a), day(b)));
    }
  });
});

describe('years, months and days', () => {
  it('splits a distance by calendar months, clamping month ends', () => {
    expect(ymdBetween(TODAY, '2026-12-25')).toEqual({ years: 0, months: 1, days: 5 });
    expect(ymdBetween('2020-05-20', TODAY)).toEqual({ years: 6, months: 6, days: 0 });
    expect(ymdBetween(TODAY, '2020-05-20')).toEqual({ years: 6, months: 6, days: 0 });
    expect(ymdBetween('2024-01-31', '2024-03-01')).toEqual({ years: 0, months: 1, days: 1 });
    expect(ymdBetween('2023-03-31', '2023-04-30')).toEqual({ years: 0, months: 1, days: 0 });
    expect(ymdBetween('2024-02-29', '2025-02-28')).toEqual({ years: 1, months: 0, days: 0 });
    expect(ymdBetween(TODAY, TODAY)).toEqual({ years: 0, months: 0, days: 0 });
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-03-31', -13)).toBe('2025-02-28');
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('calendar occurrences', () => {
  it('lists every day a countdown falls on in a range', () => {
    expect(occurrencesBetween(countdown({ date: '2026-01-31', repeatFlag: 'monthly' }), '2027-01-25', '2027-04-05'))
      .toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(occurrencesBetween(countdown({ date: '1990-10-03', repeatFlag: 'yearly', lunar: true }), '2026-01-01', '2027-12-31'))
      .toEqual(['2026-09-25', lunarToSolar(2027, 8, 15)]);
    expect(occurrencesBetween(countdown({ date: '2026-12-25' }), '2026-12-01', '2026-12-31')).toEqual(['2026-12-25']);
    expect(occurrencesBetween(countdown({ date: '2026-12-25' }), '2027-01-01', '2027-01-31')).toEqual([]);
    expect(occurrencesBetween(countdown({ date: '2027-03-10', repeatFlag: 'monthly' }), '2027-01-01', '2027-04-30')).toEqual(['2027-03-10', '2027-04-10']);
  });
});

describe('ring progress and ordinals', () => {
  it('measures the current wait', () => {
    const monthly = countdown({ date: '2026-01-10', repeatFlag: 'monthly' });
    expect(previousOccurrence(monthly, '2026-12-10')).toBe('2026-11-10');
    expect(countdownProgress(monthly, TODAY, '2026-12-10')).toBeCloseTo(10 / 30);
    const yearly = countdown({ date: '1990-03-15', repeatFlag: 'yearly' });
    expect(previousOccurrence(yearly, '2027-03-15')).toBe('2026-03-15');
    const lunarYearly = countdown({ date: '1990-10-03', repeatFlag: 'yearly', lunar: true });
    expect(previousOccurrence(lunarYearly, lunarToSolar(2027, 8, 15)!)).toBe('2026-09-25');
    // One-off: from the day it was created.
    const launch = countdown({ date: '2026-12-20', createdTime: '2026-10-21T08:00:00.000Z' });
    expect(countdownProgress(launch, TODAY, '2026-12-20')).toBeCloseTo(30 / 60, 1);
    expect(countdownProgress(countdown({ date: '2026-12-20' }), TODAY, '2026-12-20')).toBe(0);
    expect(countdownProgress(launch, TODAY, TODAY)).toBe(1);
  });

  it('counts birthdays and anniversaries', () => {
    expect(countdownYears(countdown({ date: '1990-03-15', repeatFlag: 'yearly' }), '2027-03-15')).toBe(37);
    expect(countdownYears(countdown({ date: '1990-10-03', repeatFlag: 'yearly', lunar: true }), '2026-09-25')).toBe(36);
    expect(countdownYears(countdown({ date: '2026-12-25' }), '2026-12-25')).toBeNull();
    expect(countdownYears(countdown({ date: '2027-01-01', repeatFlag: 'yearly' }), '2027-01-01')).toBeNull();
  });
});

describe('ordering and filters', () => {
  const items = [
    countdown({ id: 'past', date: '2026-10-01', sortOrder: 3, createdTime: '2026-01-03T00:00:00Z' }),
    countdown({ id: 'older-past', date: '2025-01-01', sortOrder: 1, createdTime: '2026-01-05T00:00:00Z' }),
    countdown({ id: 'soon', date: '2026-11-25', sortOrder: 2, createdTime: '2026-01-02T00:00:00Z' }),
    countdown({ id: 'later', date: '2027-05-01', sortOrder: 0, createdTime: '2026-01-04T00:00:00Z' }),
    countdown({ id: 'pinned', date: '2028-01-01', sortOrder: 9, pinned: true, createdTime: '2026-01-01T00:00:00Z' }),
  ];
  const ids = (list: Countdown[]) => list.map((item) => item.id);

  it('puts pinned first, then sorts by date, custom order or creation', () => {
    expect(ids(sortCountdowns(items, 'date', TODAY))).toEqual(['pinned', 'soon', 'later', 'past', 'older-past']);
    expect(ids(sortCountdowns(items, 'manual', TODAY))).toEqual(['pinned', 'later', 'older-past', 'soon', 'past']);
    expect(ids(sortCountdowns(items, 'created', TODAY))).toEqual(['pinned', 'older-past', 'later', 'past', 'soon']);
  });

  it('knows past one-offs and fits custom orders between neighbours', () => {
    expect(items.filter((item) => isPastCountdown(item, TODAY)).map((item) => item.id)).toEqual(['past', 'older-past']);
    expect(isPastCountdown(countdown({ date: '2020-01-01', repeatFlag: 'yearly' }), TODAY)).toBe(false);
    expect(orderBetween(1024, 2048)).toBe(1536);
    expect(orderBetween(null, 0)).toBe(-1024);
    expect(orderBetween(5, null)).toBe(1029);
    expect(orderBetween(null, null)).toBe(0);
  });

  it('reads view preferences with defaults and the legacy group toggle', () => {
    expect(parseViewPrefs(null)).toEqual({ sort: 'date', layout: 'cards', showPast: true, groupByKind: false });
    expect(parseViewPrefs(null, '1').groupByKind).toBe(true);
    expect(parseViewPrefs('{"sort":"manual","layout":"list","showPast":false,"groupByKind":false}', '1'))
      .toEqual({ sort: 'manual', layout: 'list', showPast: false, groupByKind: false });
    expect(parseViewPrefs('{not json')).toEqual(parseViewPrefs(null));
    expect(parseViewPrefs('{"sort":"random","layout":7}')).toMatchObject({ sort: 'date', layout: 'cards' });
  });

  it('keeps only real notes from the legacy local storage', () => {
    expect(parseLegacyNotes('{"a":"Buy flowers","b":"   ","c":5,"":"x"}')).toEqual({ a: 'Buy flowers' });
    expect(parseLegacyNotes('[1,2]')).toEqual({});
    expect(parseLegacyNotes('oops')).toEqual({});
    expect(parseLegacyNotes(null)).toEqual({});
  });
});

describe('legacy note migration', () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    });
    updateCountdown.mockReset();
    listCountdowns.mockReset();
    useCountdowns.setState({ items: [], loaded: false, failed: false });
  });

  it('moves notes kept in this browser to the server once', async () => {
    storage.set('ntk_countdown_notes', JSON.stringify({ a: 'Buy flowers', b: 'Local text', gone: 'Deleted countdown', c: 'Retry me' }));
    listCountdowns.mockResolvedValue([countdown({ id: 'a' }), countdown({ id: 'b', note: 'Server note' }), countdown({ id: 'c' })]);
    updateCountdown.mockImplementation(async (id: string, patch: { note: string }) => {
      if (id === 'c') throw new Error('offline');
      return countdown({ id, note: patch.note });
    });
    await useCountdowns.getState().load();
    // The server note wins; the deleted countdown's note is dropped; a failure is kept for next time.
    expect(updateCountdown.mock.calls).toEqual([['a', { note: 'Buy flowers' }], ['c', { note: 'Retry me' }]]);
    expect(useCountdowns.getState().items.map((item) => item.note)).toEqual(['Buy flowers', 'Server note', '']);
    expect(JSON.parse(storage.get('ntk_countdown_notes')!)).toEqual({ c: 'Retry me' });

    updateCountdown.mockImplementation(async (id: string, patch: { note: string }) => countdown({ id, note: patch.note }));
    await useCountdowns.getState().load();
    expect(storage.has('ntk_countdown_notes')).toBe(false);
    updateCountdown.mockClear();
    await useCountdowns.getState().load();
    expect(updateCountdown).not.toHaveBeenCalled();
  });

  it('rolls an optimistic update back when the server refuses it', async () => {
    useCountdowns.setState({ items: [countdown({ id: 'a', pinned: false })], loaded: true });
    let reject: (error: Error) => void = () => {};
    updateCountdown.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const pending = useCountdowns.getState().update('a', { pinned: true });
    expect(useCountdowns.getState().items[0].pinned).toBe(true);
    reject(new Error('400'));
    await expect(pending).rejects.toThrow('400');
    expect(useCountdowns.getState().items[0].pinned).toBe(false);
  });
});
