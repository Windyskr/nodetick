import { describe, expect, it } from 'vitest';
import { EMPTY_TASK_FILTERS, filterTasks, matchesTaskFilters, type TaskFilters } from '../src/components/TaskFilterMenu';
import type { Task } from '../src/lib/types';

const makeTask = (patch: Partial<Task>): Task => ({
  id: 'task',
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

const today = '2026-08-31';

describe('task filters', () => {
  it('matches a task whose time span crosses the selected day', () => {
    const task = makeTask({ startDate: '2026-08-30T00:00:00+0000', dueDate: '2026-09-02T00:00:00+0000' });
    expect(matchesTaskFilters(task, { ...EMPTY_TASK_FILTERS, date: 'today' }, today)).toBe(true);
    expect(matchesTaskFilters(task, { ...EMPTY_TASK_FILTERS, date: 'overdue' }, today)).toBe(false);
  });

  it('matches the seven-day window and priority/tag conditions', () => {
    const task = makeTask({ dueDate: '2026-09-07T00:00:00+0000', priority: 3, tags: ['work'] });
    const filters: TaskFilters = { date: 'week', priority: 3, tag: 'work' };
    expect(matchesTaskFilters(task, filters, today)).toBe(true);
    expect(filterTasks([task], { ...filters, tag: 'home' })).toHaveLength(0);
  });

  it('returns the original list when no filter is active', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    expect(filterTasks(tasks, EMPTY_TASK_FILTERS)).toBe(tasks);
  });
});
