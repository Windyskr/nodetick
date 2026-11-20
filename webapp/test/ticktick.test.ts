import { describe, expect, it } from 'vitest';
import {
  chunkFamilies,
  importTickTickLists,
  mapReminders,
  parseCsv,
  readTickTickBackup,
  splitChecklist,
  TickTickFormatError,
  type ImportTask,
  type TickTickChunk,
} from '../src/lib/ticktick';

const HEADER = '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId"';

const row = (cells: Record<string, string>) => {
  const names = HEADER.split(',').map((name) => name.replaceAll('"', ''));
  return names.map((name) => `"${(cells[name] ?? '').replaceAll('"', '""')}"`).join(',');
};

// The preamble mirrors what parsers in the wild skip: a date, a version and
// a quoted, multi-line status legend.
const BACKUP = [
  '﻿"Date: 2026-11-20+0000"',
  '"Version: 7.1"',
  '"Status: \r\n0 Normal\r\n1 Completed\r\n2 Archived"',
  HEADER,
  row({ 'List Name': 'Inbox', Title: 'Buy milk', Kind: 'TEXT', Tags: 'shopping, #Errands', Priority: '0', Status: '0', 'Created Time': '2026-11-01T02:00:00+0000', Order: '-1099511627776', Timezone: 'Asia/Shanghai', taskId: 't1' }),
  row({
    'Folder Name': 'Work', 'List Name': 'Projects', Title: 'Ship v2', Kind: 'TEXT', Tags: 'work,urgent', Content: 'Release "notes",\r\nchangelog',
    'Start Date': '2026-11-26T16:00:00+0000', 'Due Date': '2026-11-28T16:00:00+0000', Reminder: 'TRIGGER:P0DT9H0M0S,TRIGGER:-P0DT15H0M0S', Repeat: 'RRULE:FREQ=WEEKLY;INTERVAL=1',
    Priority: '5', Status: '0', Timezone: 'Asia/Shanghai', 'Is All Day': 'true', 'Column Name': 'Doing', 'Column Order': '1', 'View Mode': 'kanban', taskId: 't2',
  }),
  row({
    'Folder Name': 'Work', 'List Name': 'Projects', Title: 'Write docs', Kind: 'CHECKLIST', Content: 'Outline first▫Intro▪Setup ▫ API ', 'Is Check list': 'Y',
    'Start Date': '2026-11-20T06:30:00+0000', 'Due Date': '2026-11-20T06:30:00+0000', Reminder: 'TRIGGER:-PT15M', Priority: '3', Status: '0',
    Timezone: 'Asia/Shanghai', 'Is All Day': 'false', 'Column Name': 'To do', 'Column Order': '0', 'View Mode': 'kanban', taskId: 't3', parentId: 't2',
  }),
  row({
    'Folder Name': 'Work', 'List Name': 'Projects', Title: 'Old task', Kind: 'TEXT', Priority: '1', Status: '1', 'Created Time': '2026-10-01T02:00:00+0000',
    'Completed Time': '2026-10-05T03:00:00+0000', Timezone: 'Asia/Shanghai', 'Column Name': 'Doing', 'Column Order': '1', 'View Mode': 'kanban', taskId: 't4',
  }),
  row({ 'List Name': 'Reading', Title: 'Note about a book', Kind: 'NOTE', Content: 'Quotes', Status: '0', taskId: 't5' }),
  '"broken"',
  '',
].join('\r\n');

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes, line breaks and CRLF', () => {
    expect(parseCsv('a,"b,c","say ""hi""","line1\r\nline2"\r\nx,y\n')).toEqual([
      ['a', 'b,c', 'say "hi"', 'line1\r\nline2'],
      ['x', 'y'],
    ]);
  });
});

describe('readTickTickBackup', () => {
  const backup = readTickTickBackup(BACKUP, 'Europe/Berlin');
  const byTitle = (title: string) => backup.lists.flatMap((list) => list.tasks).find((task) => task.title === title)!;

  it('skips the metadata lines and groups tasks by folder and list', () => {
    expect(backup.lists.map((list) => [list.folder, list.name, list.inbox, list.tasks.length])).toEqual([
      ['', 'Inbox', true, 1],
      ['Work', 'Projects', false, 3],
      ['', 'Reading', false, 1],
    ]);
    expect(backup.invalid).toBe(1);
  });

  it('keeps kanban columns in their order', () => {
    const projects = backup.lists[1];
    expect(projects.viewMode).toBe('kanban');
    expect(projects.columns).toEqual([{ name: 'To do', sortOrder: 0 }, { name: 'Doing', sortOrder: 1 }]);
  });

  it('turns an all-day range into local days with an inclusive end', () => {
    const task = byTitle('Ship v2');
    expect(task).toMatchObject({
      isAllDay: true,
      startDate: '2026-11-27T00:00:00+0000',
      dueDate: '2026-11-28T00:00:00+0000',
      timeZone: 'Asia/Shanghai',
      repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=1',
      priority: 5,
      tags: ['work', 'urgent'],
      content: 'Release "notes",\nchangelog',
      column: 'Doing',
    });
    // 09:00 on the day and 09:00 the day before become "on the day" and "1 day early".
    expect(task.reminders).toEqual(['TRIGGER:PT0S', 'TRIGGER:-P1D']);
  });

  it('reads checklist items and keeps a single moment as the due date', () => {
    const task = byTitle('Write docs');
    expect(task.content).toBe('Outline first');
    expect(task.items).toEqual([
      { title: 'Intro', status: 0 },
      { title: 'Setup', status: 2 },
      { title: 'API', status: 0 },
    ]);
    expect(task).toMatchObject({ startDate: null, dueDate: '2026-11-20T06:30:00+0000', isAllDay: false, parentId: 't2', reminders: ['TRIGGER:-PT15M'] });
  });

  it('maps statuses, notes, tags and the rest', () => {
    expect(byTitle('Old task')).toMatchObject({ status: 2, completedTime: '2026-10-05T03:00:00+0000', priority: 1 });
    expect(byTitle('Note about a book')).toMatchObject({ kind: 'NOTE', content: 'Quotes', status: 0, startDate: null, timeZone: null });
    expect(byTitle('Buy milk')).toMatchObject({ tags: ['shopping', 'Errands'], sortOrder: -1099511627776, createdTime: '2026-11-01T02:00:00+0000' });
  });

  it('rejects files that are not TickTick backups', () => {
    expect(() => readTickTickBackup('name,email\nx,y')).toThrow(TickTickFormatError);
  });
});

describe('reminders', () => {
  it('keeps timed offsets and drops the ones after the start', () => {
    expect(mapReminders('TRIGGER:PT0S, TRIGGER:-PT1H30M ; -P1D\nTRIGGER:PT10M', false)).toEqual(['TRIGGER:PT0S', 'TRIGGER:-PT1H30M', 'TRIGGER:-P1D']);
  });

  it('rounds all-day offsets to whole days before the date', () => {
    expect(mapReminders('TRIGGER:-P1DT15H0M0S,TRIGGER:P1DT9H', true)).toEqual(['TRIGGER:-P2D']);
    expect(mapReminders('nonsense,TRIGGER:,P', true)).toEqual([]);
  });
});

describe('splitChecklist', () => {
  it('leaves text without markers alone', () => {
    expect(splitChecklist('plain text')).toEqual({ content: 'plain text', items: [] });
  });
});

const task = (id: string, parentId: string | null = null): ImportTask => ({
  id, parentId, title: id, content: null, kind: 'TASK', startDate: null, dueDate: null, timeZone: null, isAllDay: false,
  priority: 0, status: 0, repeatFlag: null, reminders: [], items: [], tags: [], completedTime: null, createdTime: null, sortOrder: 0, column: null,
});

describe('chunkFamilies', () => {
  it('sends parents first and keeps a family in one chunk when it fits', () => {
    const tasks = [task('child', 'parent'), task('a'), task('parent'), task('grandchild', 'child'), task('b')];
    const chunks = chunkFamilies(tasks, 3);
    expect(chunks.map((chunk) => chunk.map((t) => t.id))).toEqual([['a'], ['parent', 'child', 'grandchild'], ['b']]);
  });

  it('splits families larger than a chunk and survives parent cycles', () => {
    const big = [task('root'), ...Array.from({ length: 4 }, (_, i) => task(`c${i}`, 'root'))];
    expect(chunkFamilies(big, 2).map((chunk) => chunk.length)).toEqual([2, 2, 1]);
    const cycle = [task('x', 'y'), task('y', 'x')];
    expect(chunkFamilies(cycle).flat().map((t) => t.id).sort()).toEqual(['x', 'y']);
  });
});

describe('importTickTickLists', () => {
  it('sends open tasks only unless asked, and an empty chunk for an empty list', async () => {
    const backup = readTickTickBackup(BACKUP, 'UTC');
    const sent: TickTickChunk[] = [];
    const totals = await importTickTickLists(backup.lists, {
      includeCompleted: false,
      send: async (chunk) => {
        sent.push(chunk);
        return { projectId: 'p', created: chunk.tasks.length, skipped: 0, invalid: 0 };
      },
    });
    expect(totals).toEqual({ lists: 3, created: 4, skipped: 0 });
    expect(sent.flatMap((chunk) => chunk.tasks.map((t) => t.title))).not.toContain('Old task');
    expect(sent[1].list).toEqual({ name: 'Projects', folder: 'Work', viewMode: 'kanban', inbox: false });
  });
});
