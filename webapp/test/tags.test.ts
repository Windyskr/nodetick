import { describe, expect, it } from 'vitest';
import { hasTag, hasTagOrSubTag, tagKey, tagTree, uniqueTags } from '../src/lib/tags';
import { EMPTY_TASK_FILTERS, matchesTaskFilters } from '../src/components/TaskFilterMenu';
import type { Task } from '../src/lib/types';

describe('tag matching', () => {
  it('treats tags case-insensitively, like the server', () => {
    // The server lists "#Family" as name "family"; the task keeps "Family".
    expect(tagKey(' Family ')).toBe('family');
    expect(hasTag({ tags: ['Family'] }, 'family')).toBe(true);
    expect(hasTag({ tags: ['family'] }, 'Family')).toBe(true);
    expect(hasTag({ tags: ['购物'] }, '购物')).toBe(true);
    expect(hasTag({ tags: ['Families'] }, 'family')).toBe(false);
  });

  it('merges tag lists keeping the first spelling', () => {
    expect(uniqueTags(['Work', 'work', 'Home', ' ', 'HOME'])).toEqual(['Work', 'Home']);
  });

  it('list filters match a capitalized task tag', () => {
    const task = { tags: ['Family'], priority: 0, dueDate: null, startDate: null, status: 0 } as unknown as Task;
    expect(matchesTaskFilters(task, { ...EMPTY_TASK_FILTERS, tag: 'family' })).toBe(true);
  });
});

describe('nested tags', () => {
  const tags = [
    { name: 'work', parentId: null },
    { name: 'meetings', parentId: 'work' },
    { name: 'home', parentId: null },
    { name: 'orphan', parentId: 'gone' },
  ];

  it('builds one level of tree, keeping orphans at the top', () => {
    expect(tagTree(tags).map(({ tag, children }) => [tag.name, children.map((child) => child.name)])).toEqual([
      ['work', ['meetings']],
      ['home', []],
      ['orphan', []],
    ]);
  });

  it('lists tasks of sub-tags on a parent tag page', () => {
    expect(hasTagOrSubTag({ tags: ['Meetings'] }, 'work', tags)).toBe(true);
    expect(hasTagOrSubTag({ tags: ['work'] }, 'work', tags)).toBe(true);
    expect(hasTagOrSubTag({ tags: ['work'] }, 'meetings', tags)).toBe(false);
    expect(hasTagOrSubTag({ tags: ['home'] }, 'work', tags)).toBe(false);
  });
});
