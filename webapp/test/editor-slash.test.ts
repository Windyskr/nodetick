import { describe, expect, it } from 'vitest';
import { dictionaries, type Key } from '../src/i18n';
import { SLASH_COMMANDS, closesSlashMenu, dateText, filterSlashCommands, moveSelection, opensSlashMenu } from '../src/components/editor/slash';

const en = (key: Key) => dictionaries.en[key];
const zh = (key: Key) => dictionaries.zh[key];
const ids = (query: string, label = en) => filterSlashCommands(SLASH_COMMANDS, query, label).map((command) => command.id);

describe('slash menu filtering', () => {
  it('lists every command for an empty query, in menu order', () => {
    expect(ids('')).toEqual(SLASH_COMMANDS.map((command) => command.id));
    expect(ids('   ')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('matches names and keywords in English and Chinese whatever the UI language', () => {
    expect(ids('heading')).toEqual(['h1', 'h2', 'h3']);
    expect(ids('标题')).toEqual(['h1', 'h2', 'h3']);
    expect(ids('标题', zh)).toEqual(['h1', 'h2', 'h3']);
    expect(ids('heading', zh)).toEqual(['h1', 'h2', 'h3']);
    expect(ids('二级', zh)).toEqual(['h2']);
    expect(ids('todo')).toEqual(['taskList']);
    expect(ids('待办', zh)).toEqual(['taskList']);
  });

  it('matches pinyin and pinyin initials', () => {
    expect(ids('biaoti', zh)).toEqual(['h1', 'h2', 'h3']);
    expect(ids('fgx', zh)).toEqual(['divider']);
    expect(ids('dm', zh)).toEqual(['codeBlock']);
  });

  it('ranks a name that starts with the query first', () => {
    // "Code block" starts with "co"; no other name does.
    expect(ids('co')[0]).toBe('codeBlock');
    // "List" is a keyword of both lists; "Link" starts with "li" by name.
    expect(ids('li')[0]).toBe('link');
    expect(ids('list')).toEqual(['bulletList', 'orderedList', 'taskList']);
  });

  it('ignores case and spaces', () => {
    expect(ids('Code Block')).toEqual(['codeBlock']);
    expect(ids('H1')).toEqual(['h1']);
  });

  it('finds nothing for unrelated text', () => {
    expect(ids('zzz')).toEqual([]);
  });

  it('has labels in both languages for every command', () => {
    for (const command of SLASH_COMMANDS) {
      expect(dictionaries.en[command.label]).toBeTruthy();
      expect(dictionaries.zh[command.label]).toBeTruthy();
    }
  });
});

describe('slash menu selection', () => {
  it('wraps around at both ends', () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(1, -1, 3)).toBe(0);
    expect(moveSelection(4, 1, 0)).toBe(0);
  });
});

describe('opening and closing', () => {
  it('opens on / at a line start or after a space', () => {
    expect(opensSlashMenu('', '/')).toBe(true);
    expect(opensSlashMenu('call mom ', '/')).toBe(true);
    expect(opensSlashMenu('', '／')).toBe(true);
  });

  it('stays closed inside words, dates and paths', () => {
    expect(opensSlashMenu('1', '/')).toBe(false);
    expect(opensSlashMenu('and', '/')).toBe(false);
    expect(opensSlashMenu('https:/', '/')).toBe(false);
  });

  it('opens on the IME 、 at a line start only', () => {
    expect(opensSlashMenu('', '、')).toBe(true);
    expect(opensSlashMenu('苹果', '、')).toBe(false);
    expect(opensSlashMenu('苹果 ', '、')).toBe(false);
  });

  it('closes when the slash was plain text after all', () => {
    expect(closesSlashMenu('head', 3)).toBe(false);
    expect(closesSlashMenu('zzz', 0)).toBe(false);
    expect(closesSlashMenu('zzz ', 0)).toBe(true);
    expect(closesSlashMenu('heading ', 3)).toBe(false);
    expect(closesSlashMenu(' x', 1)).toBe(true);
    expect(closesSlashMenu('x'.repeat(25), 1)).toBe(true);
  });
});

describe('date commands', () => {
  const date = new Date(2026, 10, 20, 14, 5);

  it('writes the date in the UI language', () => {
    expect(dateText('today', 'zh', date)).toBe('2026年11月20日');
    expect(dateText('today', 'en', date)).toBe('Nov 20, 2026');
  });

  it('adds the time for "current time"', () => {
    expect(dateText('now', 'zh', date)).toBe('2026年11月20日 14:05');
    expect(dateText('now', 'en', date)).toBe('Nov 20, 2026 02:05 PM');
  });
});
