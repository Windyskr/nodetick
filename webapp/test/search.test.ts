import { describe, expect, it } from 'vitest';
import { compareResults, highlightParts, matchTask, rememberSearch, searchTerms } from '../src/lib/search';
import { matchesSavedFilter, savedDateMatch, type FilterConditions } from '../src/components/TaskFilterMenu';
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

const item = (title: string) => ({ id: title, title, status: 0, sortOrder: 0, startDate: null, isAllDay: false, timeZone: null, completedTime: null });

const NONE: FilterConditions = {
  logic: 'and', dateMode: 'any', dateStart: null, dateEnd: null,
  projectIds: [], tags: [], priorities: [], statuses: [], keywords: '', kinds: [],
};

describe('search terms', () => {
  it('splits on whitespace, lower-cases and drops duplicates and bare #', () => {
    expect(searchTerms('  Buy  MILK buy # #Home ')).toEqual(['buy', 'milk', '#home']);
    expect(searchTerms('')).toEqual([]);
  });
});

describe('matchTask', () => {
  const task = makeTask({
    title: 'Plan the offsite',
    content: '## Venue\n- [ ] Book **the barn** near the lake for 30 people',
    items: [item('Send invitations')],
    tags: ['Work'],
  });

  it('needs every term somewhere in the task', () => {
    expect(matchTask(task, ['offsite', 'barn'])).not.toBeNull();
    expect(matchTask(task, ['offsite', 'castle'])).toBeNull();
  });

  it('ranks the whole phrase in the title above scattered matches', () => {
    expect(matchTask(task, ['plan', 'the'])!.score).toBe(4);
    expect(matchTask(task, ['offsite', 'plan'])!.score).toBe(3);
    expect(matchTask(task, ['offsite', 'barn'])!.score).toBe(2);
    expect(matchTask(task, ['barn'])!.score).toBe(1);
  });

  it('reports a readable description excerpt or the matching subtask', () => {
    const fromBody = matchTask(task, ['barn'])!.snippet!;
    expect(fromBody.field).toBe('content');
    expect(fromBody.text).toContain('Book the barn near the lake');
    expect(fromBody.text).not.toContain('**');
    expect(matchTask(task, ['invitations'])!.snippet).toEqual({ field: 'item', text: 'Send invitations' });
  });

  it('matches tags by name, and #name only against tags', () => {
    expect(matchTask(task, ['work'])).not.toBeNull();
    expect(matchTask(task, ['#wo'])).not.toBeNull();
    expect(matchTask(task, ['#offsite'])).toBeNull();
  });

  it('matches Chinese text without spaces', () => {
    expect(matchTask(makeTask({ title: '周五交季度报告' }), ['报告'])).not.toBeNull();
  });
});

describe('highlightParts', () => {
  it('marks every case-insensitive occurrence and keeps the original text', () => {
    expect(highlightParts('Milk and milkshake', ['milk'])).toEqual([
      { text: 'Milk', hit: true },
      { text: ' and ', hit: false },
      { text: 'milk', hit: true },
      { text: 'shake', hit: false },
    ]);
  });

  it('prefers the longer of overlapping terms and escapes regex characters', () => {
    expect(highlightParts('a+b milk tea', ['milk', 'milk tea', 'a+b']).filter((part) => part.hit).map((part) => part.text))
      .toEqual(['a+b', 'milk tea']);
  });

  it('leaves tag-only terms out', () => {
    expect(highlightParts('work', ['#work'])).toEqual([{ text: 'work', hit: false }]);
  });
});

describe('result order', () => {
  it('puts open tasks first, then better matches, pinned, earlier due dates', () => {
    const results = [
      { task: makeTask({ id: 'done', status: 2 }), match: { score: 4, snippet: null } },
      { task: makeTask({ id: 'later', dueDate: '2026-09-09T00:00:00+0000' }), match: { score: 1, snippet: null } },
      { task: makeTask({ id: 'sooner', dueDate: '2026-09-01T00:00:00+0000' }), match: { score: 1, snippet: null } },
      { task: makeTask({ id: 'pinned', pinned: true }), match: { score: 1, snippet: null } },
      { task: makeTask({ id: 'title' }), match: { score: 3, snippet: null } },
    ];
    expect(results.sort(compareResults).map((result) => result.task.id)).toEqual(['title', 'pinned', 'sooner', 'later', 'done']);
  });
});

describe('saved filters with keywords, kinds and new date modes', () => {
  const today = '2026-09-10'; // a Thursday

  it('always requires the keywords, even with "any condition" logic', () => {
    const task = makeTask({ title: 'Pay rent', priority: 5 });
    expect(matchesSavedFilter(task, { ...NONE, keywords: 'rent' }, today)).toBe(true);
    expect(matchesSavedFilter(task, { ...NONE, logic: 'or', priorities: [5], keywords: 'groceries' }, today)).toBe(false);
  });

  it('tells notes from tasks', () => {
    const note = makeTask({ kind: 'NOTE' });
    const checklist = makeTask({ kind: 'CHECKLIST' });
    expect(matchesSavedFilter(note, { ...NONE, kinds: ['note'] }, today)).toBe(true);
    expect(matchesSavedFilter(checklist, { ...NONE, kinds: ['note'] }, today)).toBe(false);
    expect(matchesSavedFilter(checklist, { ...NONE, kinds: ['task'] }, today)).toBe(true);
  });

  it('matches won\'t-do tasks by status -1', () => {
    expect(matchesSavedFilter(makeTask({ status: -1 }), { ...NONE, statuses: [-1] }, today)).toBe(true);
    expect(matchesSavedFilter(makeTask({ status: 0 }), { ...NONE, statuses: [-1] }, today)).toBe(false);
  });

  it('handles next 7 days, this month, no date and open-only overdue', () => {
    const due = (day: string, patch: Partial<Task> = {}) => makeTask({ dueDate: `${day}T00:00:00+0000`, ...patch });
    expect(savedDateMatch(due('2026-09-16'), { ...NONE, dateMode: 'next7' }, today)).toBe(true);
    expect(savedDateMatch(due('2026-09-17'), { ...NONE, dateMode: 'next7' }, today)).toBe(false);
    expect(savedDateMatch(due('2026-09-30'), { ...NONE, dateMode: 'month' }, today)).toBe(true);
    expect(savedDateMatch(due('2026-10-01'), { ...NONE, dateMode: 'month' }, today)).toBe(false);
    expect(savedDateMatch(makeTask({}), { ...NONE, dateMode: 'nodate' }, today)).toBe(true);
    expect(savedDateMatch(due('2026-09-01'), { ...NONE, dateMode: 'nodate' }, today)).toBe(false);
    expect(savedDateMatch(due('2026-09-01'), { ...NONE, dateMode: 'overdue' }, today)).toBe(true);
    expect(savedDateMatch(due('2026-09-01', { status: 2 }), { ...NONE, dateMode: 'overdue' }, today)).toBe(false);
  });

  it('keeps filters saved before keywords and kinds existed working', () => {
    const legacy = { ...NONE } as Partial<FilterConditions>;
    delete legacy.keywords;
    delete legacy.kinds;
    expect(matchesSavedFilter(makeTask({}), legacy as FilterConditions, today)).toBe(true);
  });
});

describe('recent searches', () => {
  it('moves a repeated query to the front, case-insensitively, and caps the list', () => {
    let recent: string[] = [];
    for (const query of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) recent = rememberSearch(recent, query);
    expect(recent).toHaveLength(8);
    expect(rememberSearch(recent, '  H ')).toEqual(['H', 'i', 'g', 'f', 'e', 'd', 'c', 'b']);
    expect(rememberSearch(recent, '   ')).toBe(recent);
  });
});
