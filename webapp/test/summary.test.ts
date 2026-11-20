import { describe, expect, it } from 'vitest';
import {
  buildSummary,
  DEFAULT_SUMMARY_CONFIG,
  followingPeriod,
  periodLabel,
  resolvePeriod,
  sameSummaryConfig,
  summaryStatusOf,
  type SummaryConfig,
} from '../src/lib/summary';
import type { ChecklistItem, Project, Tag, Task } from '../src/lib/types';

// Friday 2026-11-20; weeks start on Sunday (15th–21st).
const TODAY = '2026-11-20';

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, projectId: 'inbox', title: id, content: '', desc: '', kind: 'TEXT', startDate: null, dueDate: null, timeZone: null,
  isAllDay: true, priority: 0, pinned: false, status: 0, sortOrder: 0, repeatFlag: null, reminders: [], items: [], tags: [],
  parentId: null, childIds: [], columnId: null, columnName: null, completedTime: null, focusSummaries: [], etag: '',
  createdTime: null, modifiedTime: null, deletedTime: null,
  ...patch,
});
const item = (title: string, done = false, completedTime: string | null = null): ChecklistItem => ({
  id: title, title, status: done ? 2 : 0, sortOrder: 0, startDate: null, isAllDay: false, timeZone: null, completedTime,
});
const allDay = (day: string) => `${day}T00:00:00+0000`;
// Noon UTC is the same calendar day in every time zone the tests run in.
const closed = (day: string) => `${day}T12:00:00.000Z`;

const projects: Project[] = [
  { id: 'inbox', name: 'Inbox', color: null, sortOrder: 0, closed: false, groupId: null, viewMode: 'list', permission: 'write', kind: 'TASK' } as Project,
  { id: 'work', name: '💼工作任务', color: null, sortOrder: 1, closed: false, groupId: null, viewMode: 'list', permission: 'write', kind: 'TASK' } as Project,
];
const tags: Tag[] = [
  { name: 'work', label: 'Work', color: null, sortOrder: 0, parentId: null },
  { name: 'calls', label: 'calls', color: null, sortOrder: 1, parentId: 'work' },
];

// The tasks from the TickTick comparison, plus some that must stay out.
const tasks: Task[] = [
  task('甲', { title: 'NodeTick测试 摘要甲', dueDate: allDay('2026-11-20'), startDate: allDay('2026-11-20'), items: [item('a', true), item('b', true), item('c'), item('d'), item('e')] }),
  task('乙', {
    title: 'NodeTick测试 摘要乙', dueDate: allDay('2026-11-21'), startDate: allDay('2026-11-21'), priority: 3, tags: ['calls'],
    content: '描述第一行\n**描述**第二行', items: [item('子项二'), item('子项三')], childIds: ['戊'],
  }),
  task('丙', {
    title: 'NodeTick测试 摘要丙', isAllDay: false, dueDate: '2026-11-20T15:00:00+0800', startDate: '2026-11-20T15:00:00+0800',
    priority: 5, status: 2, completedTime: closed('2026-11-20'), content: '丙的描述',
  }),
  task('丁', { title: 'NodeTick测试 摘要丁', projectId: 'work', dueDate: allDay('2026-11-18'), priority: 1, status: -1, completedTime: closed('2026-11-20') }),
  task('戊', { title: 'NodeTick测试 摘要戊', dueDate: allDay('2026-11-19'), status: 2, completedTime: closed('2026-11-19'), parentId: '乙' }),
  // Out: closed last week, no date, next week, a note.
  task('old', { dueDate: allDay('2026-11-17'), status: 2, completedTime: closed('2026-11-12') }),
  task('undated'),
  task('later', { dueDate: allDay('2026-11-23') }),
  task('note', { kind: 'NOTE', dueDate: allDay('2026-11-20') }),
];
const data = { tasks, projects, tags };
const config = (patch: Partial<SummaryConfig> = {}): SummaryConfig => ({ ...DEFAULT_SUMMARY_CONFIG, ...patch });
const build = (patch: Partial<SummaryConfig> = {}, lang: 'zh' | 'en' = 'zh', focus?: Map<string, number>) =>
  buildSummary({ config: config(patch), data, lang, today: TODAY, focus });

describe('summary periods', () => {
  it('resolves every range from today', () => {
    const at = (range: SummaryConfig['range'], today = TODAY) => resolvePeriod({ range, from: null, to: null }, today);
    expect(at('today')).toEqual({ from: '2026-11-20', to: '2026-11-20' });
    expect(at('tomorrow')).toEqual({ from: '2026-11-21', to: '2026-11-21' });
    expect(at('yesterday')).toEqual({ from: '2026-11-19', to: '2026-11-19' });
    expect(at('thisWeek')).toEqual({ from: '2026-11-15', to: '2026-11-21' });
    expect(at('nextWeek')).toEqual({ from: '2026-11-22', to: '2026-11-28' });
    expect(at('lastWeek')).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(at('thisMonth')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(at('lastMonth')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(at('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(at('thisYear')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(at('lastYear')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(resolvePeriod({ range: 'custom', from: '2026-11-02', to: '2026-11-04' }, TODAY)).toEqual({ from: '2026-11-02', to: '2026-11-04' });
  });

  it('finds the period after', () => {
    expect(followingPeriod('today', { from: TODAY, to: TODAY })).toEqual({ from: '2026-11-21', to: '2026-11-21' });
    expect(followingPeriod('thisWeek', { from: '2026-11-15', to: '2026-11-21' })).toEqual({ from: '2026-11-22', to: '2026-11-28' });
    expect(followingPeriod('lastMonth', { from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(followingPeriod('thisMonth', { from: '2026-12-01', to: '2026-12-31' })).toEqual({ from: '2027-01-01', to: '2027-01-31' });
    expect(followingPeriod('thisYear', { from: '2026-01-01', to: '2026-12-31' })).toEqual({ from: '2027-01-01', to: '2027-12-31' });
    expect(followingPeriod('custom', { from: '2026-11-02', to: '2026-11-04' })).toEqual({ from: '2026-11-05', to: '2026-11-07' });
  });

  it('labels periods in both languages, with years outside this one', () => {
    expect(periodLabel({ from: '2026-11-15', to: '2026-11-21' }, 'zh', TODAY)).toBe('11月15日-11月21日');
    expect(periodLabel({ from: '2026-11-15', to: '2026-11-21' }, 'en', TODAY)).toBe('Nov 15 – Nov 21');
    expect(periodLabel({ from: TODAY, to: TODAY }, 'zh', TODAY)).toBe('11月20日');
    expect(periodLabel({ from: '2026-12-27', to: '2027-01-02' }, 'zh', TODAY)).toBe('2026年12月27日-2027年1月2日');
    expect(periodLabel({ from: '2026-12-27', to: '2027-01-02' }, 'en', TODAY)).toBe('Dec 27, 2026 – Jan 2, 2027');
  });
});

describe('buildSummary', () => {
  it('matches TickTick with the default settings', () => {
    expect(summaryStatusOf(tasks[0])).toBe('inProgress');
    expect(build()).toBe([
      '# 11月15日-11月21日',
      '',
      '## 已完成',
      '- [11月19日] NodeTick测试 摘要戊',
      '- [11月20日] NodeTick测试 摘要丙',
      '',
      '## 已放弃',
      '- [11月20日] NodeTick测试 摘要丁',
      '',
      '## 进行中',
      '- [40%] NodeTick测试 摘要甲',
      '',
      '## 未完成',
      '- NodeTick测试 摘要乙',
      '',
    ].join('\n'));
  });

  it('shows every field in TickTick\'s order', () => {
    const all = build({ fields: ['status', 'progress', 'completedTime', 'taskTime', 'title', 'parent', 'tags', 'focus', 'list', 'detail'] }, 'zh', new Map([['甲', 1500]]));
    const lines = all.split('\n');
    expect(lines).toContain('- [x] [11月20日] [11月20日 15:00] NodeTick测试 摘要丙 <收集箱>');
    expect(lines).toContain('    丙的描述');
    expect(lines).toContain('- [x] [11月19日] [11月19日] NodeTick测试 摘要戊 /NodeTick测试 摘要乙 <收集箱>');
    expect(lines).toContain('- [x] [11月20日] [11月18日] NodeTick测试 摘要丁 <💼工作任务>');
    expect(lines).toContain('- [ ] [40%] [11月20日] NodeTick测试 摘要甲 [专注 25分钟] <收集箱>');
    // Descriptions lose their Markdown and line breaks; open checklist items come first.
    const yi = lines.indexOf('- [ ] [11月21日] NodeTick测试 摘要乙 #calls <收集箱>');
    expect(lines.slice(yi, yi + 4)).toEqual([
      '- [ ] [11月21日] NodeTick测试 摘要乙 #calls <收集箱>',
      '    描述第一行 描述第二行',
      '    - [ ] 子项二',
      '    - [ ] 子项三',
    ]);
    const jia = lines.indexOf('- [ ] [40%] [11月20日] NodeTick测试 摘要甲 [专注 25分钟] <收集箱>');
    expect(lines.slice(jia + 1, jia + 6)).toEqual(['    - [ ] c', '    - [ ] d', '    - [ ] e', '    - [x] a', '    - [x] b']);
  });

  it('groups by list, date, tag and priority with status sub-headings', () => {
    const byList = build({ groupBy: 'list', fields: ['status', 'title', 'list'] });
    expect(byList).toContain('## 收集箱\n### 已完成\n- [x] NodeTick测试 摘要戊\n- [x] NodeTick测试 摘要丙\n### 进行中\n- [ ] NodeTick测试 摘要甲\n### 未完成\n- [ ] NodeTick测试 摘要乙\n\n## 💼工作任务\n### 已放弃\n- [x] NodeTick测试 摘要丁\n');
    expect(byList).not.toContain('<收集箱>');

    const byDone = build({ groupBy: 'completedTime' });
    expect(byDone.match(/^## .*$/gm)).toEqual(['## 11月19日 周四', '## 11月20日 周五', '## 11月21日 周六']);
    expect(byDone).not.toContain('[11月20日]');

    expect(build({ groupBy: 'taskTime' }).match(/^## .*$/gm)).toEqual(['## 11月18日 周三', '## 11月19日 周四', '## 11月20日 周五', '## 11月21日 周六']);
    expect(build({ groupBy: 'tag' }).match(/^## .*$/gm)).toEqual(['## #calls', '## 无标签']);
    expect(build({ groupBy: 'priority' }).match(/^## .*$/gm)).toEqual(['## 高优先级', '## 中优先级', '## 低优先级', '## 无优先级']);
  });

  it('filters by list, status, priority and tag (with sub-tags)', () => {
    const titles = (patch: Partial<SummaryConfig>) => (build(patch).match(/摘要./g) ?? []).sort().join(',');
    expect(titles({ projectIds: ['work'] })).toBe('摘要丁');
    expect(titles({ statuses: ['completed', 'wontDo'] })).toBe('摘要丁,摘要丙,摘要戊');
    expect(titles({ statuses: ['open'] })).toBe('摘要乙');
    expect(titles({ priorities: [5, 3] })).toBe('摘要丙,摘要乙');
    expect(titles({ tags: ['work'] })).toBe('摘要乙');
    expect(build({ projectIds: ['nowhere'] })).toBe('# 11月15日-11月21日\n\n当前范围内没有符合条件的任务\n');
  });

  it('adds the next period and speaks English', () => {
    const next = build({ range: 'lastWeek', nextPeriod: true });
    expect(next).toBe([
      '# 11月8日-11月14日',
      '',
      '## 已完成',
      '- [11月12日] old',
      '',
      '',
      '# 11月15日-11月21日',
      '',
      ...build().split('\n').slice(2),
    ].join('\n'));
    const en = build({ fields: ['status', 'completedTime', 'title', 'list'] }, 'en');
    expect(en.split('\n').slice(0, 4)).toEqual(['# Nov 15 – Nov 21', '', '## Completed', '- [x] [Nov 19] NodeTick测试 摘要戊 <Inbox>']);
    expect(en).toContain("## Won't Do");
  });
});

describe('sameSummaryConfig', () => {
  it('ignores order and custom dates of other ranges', () => {
    expect(sameSummaryConfig(config({ statuses: ['open', 'completed'], tags: ['B', 'a'] }), config({ statuses: ['completed', 'open'], tags: ['a', 'b'] }))).toBe(true);
    expect(sameSummaryConfig(config({ from: '2026-01-01', to: '2026-01-02' }), config())).toBe(true);
    expect(sameSummaryConfig(config({ groupBy: 'list' }), config())).toBe(false);
  });
});
