import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/lib/types';

const calls: string[] = [];
const record = <T>(name: string, value: T) => async (...args: unknown[]) => {
  calls.push(`${name}${args.length ? ` ${String(args[0])}` : ''}`);
  return typeof value === 'function' ? (value as (...a: unknown[]) => unknown)(...args) : value;
};

vi.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    completeTask: record('completeTask', null),
    deleteTask: record('deleteTask', undefined),
    updateTask: record('updateTask', (id: string, patch: Partial<Task>) => ({ ...current(id), ...patch })),
    // Everything refresh() loads.
    listProjects: record('refresh', []),
    listGroups: record('refresh', []),
    listTags: record('refresh', []),
    listFilters: record('refresh', []),
    filterTasks: record('refresh', []),
    listCompleted: record('refresh', []),
    listTrash: record('refresh', []),
  },
}));

const { useStore } = await import('../src/stores/store');

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, projectId: 'inbox', title: id, content: '', desc: '', kind: 'TASK', startDate: null, dueDate: null,
    timeZone: null, isAllDay: false, priority: 0, pinned: false, status: 0, sortOrder: 0, repeatFlag: null,
    reminders: [], items: [], tags: [], parentId: null, childIds: [], columnId: null, columnName: null,
    completedTime: null, focusSummaries: [], etag: '0', createdTime: null, modifiedTime: null, deletedTime: null,
    ...extra,
  } as Task;
}

function current(id: string): Task {
  return useStore.getState().tasks.find((t) => t.id === id)!;
}

beforeEach(() => {
  calls.length = 0;
  useStore.setState({ tasks: [task('a'), task('b'), task('c')], completed: [], abandoned: [], trash: [], selectedIds: ['a', 'b'] });
});

describe('batch actions', () => {
  it('complete the selection without reloading everything', async () => {
    await useStore.getState().batchComplete();
    expect(calls).toEqual(['completeTask inbox', 'completeTask inbox']);
    const s = useStore.getState();
    expect(s.tasks.map((t) => t.id)).toEqual(['c']);
    expect(s.completed.map((t) => [t.id, t.status])).toEqual(expect.arrayContaining([['a', 2], ['b', 2]]));
    expect(s.selectedIds).toEqual([]);
  });

  it('set dates and priorities in place', async () => {
    await useStore.getState().batchPriority(5);
    expect(useStore.getState().tasks.filter((t) => t.priority === 5).map((t) => t.id)).toEqual(['a', 'b']);
    useStore.setState({ selectedIds: ['c'] });
    await useStore.getState().batchSetDate('2026-11-21T00:00:00+0000', true);
    expect(current('c')).toMatchObject({ dueDate: '2026-11-21T00:00:00+0000', isAllDay: true });
    expect(calls).toEqual(['updateTask a', 'updateTask b', 'updateTask c']);
  });

  it('move and trash in place unless subtasks are involved', async () => {
    await useStore.getState().batchMove('work');
    expect(calls).toEqual(['updateTask a', 'updateTask b']);
    expect(useStore.getState().tasks.filter((t) => t.projectId === 'work').map((t) => t.id).sort()).toEqual(['a', 'b']);

    calls.length = 0;
    useStore.setState({ selectedIds: ['c'] });
    await useStore.getState().batchTrash();
    expect(calls).toEqual(['deleteTask inbox']);
    expect(useStore.getState().trash.map((t) => t.id)).toEqual(['c']);
  });

  it('reload when the server rewires parents and subtasks', async () => {
    useStore.setState({ tasks: [task('p', { childIds: ['k'] }), task('k', { parentId: 'p' })], selectedIds: ['k'] });
    await useStore.getState().batchMove('work');
    expect(calls.filter((c) => c.startsWith('refresh'))).toHaveLength(8);

    calls.length = 0;
    useStore.setState({ tasks: [task('p', { childIds: ['k'] }), task('k', { parentId: 'p' })], selectedIds: ['p'] });
    await useStore.getState().batchTrash();
    expect(calls[0]).toBe('deleteTask inbox');
    expect(calls.filter((c) => c.startsWith('refresh'))).toHaveLength(8);
  });
});
