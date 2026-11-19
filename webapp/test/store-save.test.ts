import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecklistItem, Task } from '../src/lib/types';

const updateTask = vi.fn();
vi.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    updateTask: (...args: unknown[]) => updateTask(...args),
    deleteTag: async () => undefined,
    updateTag: async (_name: string, patch: { name: string }) => ({ name: patch.name, label: patch.name, color: null, sortOrder: 0, parentId: null }),
  },
}));

const { useStore } = await import('../src/stores/store');

const item = (id: string): ChecklistItem => ({
  id,
  title: id,
  status: 0,
  sortOrder: 0,
  startDate: null,
  isAllDay: false,
  timeZone: null,
  completedTime: null,
});

const task: Task = {
  id: 't1',
  projectId: 'inbox',
  title: 'Ship v1',
  content: '',
  desc: '',
  kind: 'TASK',
  startDate: null,
  dueDate: null,
  timeZone: null,
  isAllDay: false,
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
};

/** The detail panel builds each edit from the task currently in the store. */
const current = () => useStore.getState().tasks.find((t) => t.id === 't1')!;

describe('saveTask', () => {
  beforeEach(() => {
    updateTask.mockReset();
    useStore.setState({ tasks: [task], completed: [], abandoned: [], trash: [], tags: [] });
  });

  it('keeps an edit made while the previous save is still in flight', async () => {
    const pending: (() => void)[] = [];
    let server = task;
    updateTask.mockImplementation((_id: string, patch: Partial<Task>) => new Promise<Task>((resolve) => {
      pending.push(() => {
        server = { ...server, ...patch };
        resolve(server);
      });
    }));

    const first = useStore.getState().saveTask('t1', { items: [...current().items, item('a')] });
    const second = useStore.getState().saveTask('t1', { items: [...current().items, item('b')] });
    expect(current().items.map((i) => i.id)).toEqual(['a', 'b']);

    // Saves of one task are sent one at a time, in order.
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updateTask).toHaveBeenCalledTimes(1);
    pending[0]();
    await first;
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledTimes(2));
    expect(updateTask.mock.calls[1][1].items.map((i: ChecklistItem) => i.id)).toEqual(['a', 'b']);
    pending[1]();
    await second;
    expect(current().items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('rolls the optimistic edit back when the save fails', async () => {
    updateTask.mockRejectedValue(new Error('offline'));
    await expect(useStore.getState().saveTask('t1', { title: 'Renamed' })).rejects.toThrow('offline');
    expect(current().title).toBe('Ship v1');
  });
});

describe('tag edits reach tasks that typed the tag in another case', () => {
  const tag = { name: 'family', label: 'Family', color: null, sortOrder: 0, parentId: null };

  beforeEach(() => {
    useStore.setState({ tasks: [{ ...task, tags: ['Family', 'Home'] }], completed: [], abandoned: [], trash: [], tags: [tag] });
  });

  it('deleteTag strips "Family" when the tag "family" is deleted', async () => {
    await useStore.getState().deleteTag('family');
    expect(current().tags).toEqual(['Home']);
    expect(useStore.getState().tags).toEqual([]);
  });

  it('updateTag renames "Family" in tasks', async () => {
    await useStore.getState().updateTag('family', { name: 'kin' });
    expect(current().tags).toEqual(['kin', 'Home']);
  });

  it('a new tag from the detail panel is listed like the server lists it', async () => {
    useStore.setState({ tags: [] });
    updateTask.mockImplementation(async (_id: string, patch: Partial<Task>) => ({ ...task, ...patch }));
    await useStore.getState().saveTask('t1', { tags: ['Family', 'Home'] });
    expect(useStore.getState().tags.map((t) => [t.name, t.label])).toEqual([['family', 'Family'], ['home', 'Home']]);
  });
});
