import { describe, expect, it } from 'vitest';
import { completionCalendar, computeStats, heatLevel, niceTicks, previousSpan, rangeBuckets } from '../src/lib/stats';
import type { Task } from '../src/lib/types';

const TODAY = '2026-11-20'; // a Friday

/** A timestamp at a local wall-clock time, whatever zone the tests run in. */
const at = (day: string, hour = 10) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 30).toISOString();
};

const makeTask = (patch: Partial<Task>): Task => ({
  id: Math.random().toString(36).slice(2),
  projectId: 'inbox',
  title: 'task',
  content: '',
  desc: '',
  kind: 'TASK',
  startDate: null,
  dueDate: null,
  timeZone: null,
  isAllDay: true,
  priority: 0,
  pinned: false,
  status: 0,
  sortOrder: 0,
  repeatFlag: null,
  reminders: [],
  items: [],
  tags: [],
  parentId: null,
  childIds: [],
  columnId: null,
  columnName: null,
  completedTime: null,
  focusSummaries: [],
  etag: '0',
  createdTime: null,
  modifiedTime: null,
  deletedTime: null,
  ...patch,
});

const done = (day: string, patch: Partial<Task> = {}) => makeTask({ status: 2, completedTime: at(day), ...patch });

describe('ranges', () => {
  it('ends every range with the current day, week or month', () => {
    const days = rangeBuckets('7d', TODAY);
    expect(days.map((bucket) => bucket.start)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
    const weeks = rangeBuckets('12w', TODAY);
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toEqual({ start: '2026-11-15', end: '2026-11-21' });
    expect(weeks[0].start).toBe('2026-08-30');
    const months = rangeBuckets('12m', TODAY);
    expect(months[0]).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(months[11]).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(months.find((bucket) => bucket.start === '2026-02-01')?.end).toBe('2026-02-28');
  });

  it('compares with the span right before', () => {
    expect(previousSpan(rangeBuckets('7d', TODAY), '7d')).toEqual({ start: '2026-11-07', end: '2026-11-13' });
    expect(previousSpan(rangeBuckets('12m', TODAY), '12m')).toEqual({ start: '2024-12-01', end: '2025-11-30' });
  });
});

describe('computeStats', () => {
  const completed = [
    done('2026-11-20', { dueDate: '2026-11-21T00:00:00+0000', priority: 5, tags: ['Work'], projectId: 'p1' }),
    done('2026-11-18', { dueDate: '2026-11-17T00:00:00+0000', tags: ['work', 'home'] }),
    done('2026-11-14', { priority: 3 }),
    done('2026-11-10'), // the previous week
    done('2026-11-01'), // older
  ];
  const open = [
    makeTask({ dueDate: '2026-11-19T00:00:00+0000' }), // overdue
    makeTask({ dueDate: '2026-11-25T00:00:00+0000', createdTime: at('2026-11-19') }),
  ];
  const abandoned = [makeTask({ status: -1, dueDate: '2026-11-16T00:00:00+0000' })];
  const stats = computeStats({ open, completed, abandoned, range: '7d', today: TODAY });

  it('counts completions in the range and the one before', () => {
    expect(stats.completed).toBe(3);
    expect(stats.previousCompleted).toBe(1);
    expect(stats.totalCompleted).toBe(5);
    expect(stats.series.map((point) => point.value)).toEqual([1, 0, 0, 0, 1, 0, 1]);
  });

  it('measures completion and on-time rates', () => {
    // Due in the range up to today: the overdue open task, the won't-do one, the completed one due 11-17.
    expect([stats.dueCompleted, stats.due]).toEqual([1, 3]);
    // Of the completions with a due day, the one due 11-21 was early and the one due 11-17 late.
    expect([stats.onTime, stats.withDue]).toEqual([1, 2]);
    expect([stats.overdueNow, stats.openNow, stats.created]).toEqual([1, 2, 1]);
  });

  it('breaks completions down by list, tag, priority, hour and weekday', () => {
    expect(stats.byProject).toEqual([{ id: 'inbox', value: 2 }, { id: 'p1', value: 1 }]);
    expect(stats.byTag).toEqual([{ name: 'work', value: 2 }, { name: 'home', value: 1 }]);
    expect(stats.byPriority).toEqual([{ priority: 5, value: 1 }, { priority: 3, value: 1 }, { priority: 1, value: 0 }, { priority: 0, value: 1 }]);
    expect(stats.byHour[10]).toBe(3);
    expect(stats.byWeekday[5]).toBe(1); // Friday 11-20
    expect(stats.byWeekday[6]).toBe(1); // Saturday 11-14
  });

  it('narrows everything to one list', () => {
    const one = computeStats({ open, completed, abandoned, range: '7d', today: TODAY, projectId: 'p1' });
    expect([one.completed, one.totalCompleted, one.openNow, one.due]).toEqual([1, 1, 0, 0]);
  });
});

describe('completionCalendar', () => {
  it('covers whole weeks up to today and blanks the rest of this week', () => {
    const cells = completionCalendar([done('2026-11-20'), done('2026-11-20'), done('2025-11-16')], TODAY);
    expect(cells).toHaveLength(53 * 7);
    expect(cells[0].day).toBe('2025-11-16');
    expect(cells[0].count).toBe(1);
    expect(cells.find((cell) => cell.day === TODAY)?.count).toBe(2);
    expect(cells.at(-1)).toEqual({ day: '2026-11-21', count: -1 });
  });
});

describe('scales', () => {
  it('levels heat cells by quarters of the busiest day', () => {
    expect([0, 1, 2, 3, 4, 8].map((count) => heatLevel(count, 8))).toEqual([0, 1, 1, 2, 2, 4]);
    expect(heatLevel(3, 0)).toBe(0);
  });

  it('picks clean ticks', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(23)).toEqual([0, 10, 20, 30]);
  });
});
