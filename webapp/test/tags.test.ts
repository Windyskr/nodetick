import { describe, expect, it } from 'vitest';
import { hasTag, tagKey, uniqueTags } from '../src/lib/tags';
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
