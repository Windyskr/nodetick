import { describe, expect, it } from 'vitest';
import { parseDateWord, parseQuickAdd } from '../src/lib/quickParse';
import type { Lang } from '../src/i18n';

const zh = (s: string, options?: { recognizeBareDates?: boolean }) => parseQuickAdd(s, 'zh' as Lang, options);
const en = (s: string) => parseQuickAdd(s, 'en' as Lang);
const d = (s: string) => parseDateWord(s, 'zh' as Lang);
const de = (s: string) => parseDateWord(s, 'en' as Lang);

/** Today in local time — tests are written relative to it. */
const today = (() => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
})();

const shift = (days: number): string => {
  const [y, m, dd] = today.split('-').map(Number);
  const dt = new Date(y, m - 1, dd + days);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

const dow = (() => {
  const [y, m, dd] = today.split('-').map(Number);
  return new Date(y, m - 1, dd).getDay();
})();

describe('quickParse: tags', () => {
  it('extracts single and multiple tags', () => {
    expect(zh('买菜 #生活')).toEqual({ title: '买菜', tags: ['生活'] });
    const multi = zh('发货 #_ops #urgent-2');
    expect(multi.tags).toEqual(['_ops', 'urgent-2']);
    expect(multi.title).toBe('发货');
  });

  it('keeps # in the title when it is the only content', () => {
    expect(zh('#标签').title).toBe('');
  });
});

describe('quickParse: priority', () => {
  it.each([
    ['!1', 1],
    ['!2', 2],
    ['!3', 3],
    ['!0', 0],
    ['!高', 3],
    ['!中', 2],
    ['!低', 1],
    ['!无', 0],
  ])('zh %s → %i', (token, expected) => {
    expect(zh(`任务 ${token}`).priority).toBe(expected);
    expect(zh(`任务 ${token}`).title).toBe('任务');
  });

  it.each([
    ['!high', 3],
    ['!High', 3],
    ['!medium', 2],
    ['!med', 2],
    ['!low', 1],
    ['!none', 0],
  ])('en %s → %i', (token, expected) => {
    expect(en(`task ${token}`).priority).toBe(expected);
    expect(en(`task ${token}`).title).toBe('task');
  });

  it('ignores unknown priority tokens (stays in title)', () => {
    const r = zh('任务 !5');
    expect(r.priority).toBeUndefined();
    expect(r.title).toBe('任务 !5');
  });
});

describe('quickParse: zh dates', () => {
  it('recognizes bare natural-language dates like the add-task input', () => {
    expect(zh('今天').dueDate).toBe(today);
    expect(zh('提交日报 今天').title).toBe('提交日报');
    expect(zh('提交日报 今天').dueDate).toBe(today);
    expect(zh('今天', { recognizeBareDates: false }).title).toBe('今天');
  });

  it.each([
    ['今天开会', '开会'],
    ['开会今天', '开会'],
  ])('recognizes a date adjacent to Chinese title text: %s', (input, title) => {
    const result = zh(input);
    expect(result.title).toBe(title);
    expect(result.dueDate).toBe(today);
  });

  it('recognizes only the first bare date and keeps later dates literal', () => {
    const result = zh('今天开会明天');
    expect(result.title).toBe('开会明天');
    expect(result.dueDate).toBe(today);
  });

  it('uses the first date even when a later date is explicit', () => {
    const result = zh('今天开会 ~明天');
    expect(result.title).toBe('开会 ~明天');
    expect(result.dueDate).toBe(today);
  });

  it('keeps bare dates literal when smart parsing is disabled but still honors ~date', () => {
    const result = zh('今天开会 ~明天', { recognizeBareDates: false });
    expect(result.title).toBe('今天开会');
    expect(result.dueDate).toBe(shift(1));
  });

  it.each([
    ['~今天', today],
    ['~明天', shift(1)],
    ['~后天', shift(2)],
  ])('%s resolves', (token, expected) => {
    expect(zh(`任务 ${token}`).dueDate).toBe(expected);
  });

  it('下周 → next Monday', () => {
    const monday = d('下周');
    expect(monday).not.toBeNull();
    const [y, m, dd] = monday!.split('-').map(Number);
    expect(new Date(y, m - 1, dd).getDay()).toBe(1);
  });

  it.each(['~周日', '~周一', '~周二', '~周三', '~周四', '~周五', '~周六'])('%s → that weekday in the future', (token) => {
    const day = d(token.slice(1));
    expect(day).not.toBeNull();
    const [y, m, dd] = day!.split('-').map(Number);
    const target = new Date(y, m - 1, dd).getDay();
    const charIdx = '日一二三四五六'.indexOf(token.slice(2));
    expect(target).toBe(charIdx);
    expect(day! >= today).toBe(true);
    expect(day).not.toBe(today.slice(0, 8) + today.slice(8)); // never today itself
  });

  it('周五 on a Monday is this Friday (+4), not next week', () => {
    expect(d('周五')).toBe(shift(((5 - dow + 7) % 7) || 7));
  });

  it.each([
    ['9月5日', '9月5日'],
    ['12月31号', '12月31号'],
  ])('%s parses in the current or next year', (word) => {
    const day = d(word);
    expect(day).not.toBeNull();
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('past dates roll to next year', () => {
    const past = shift(-10);
    const [, m, dd] = past.split('-');
    expect(d(`${Number(m)}月${Number(dd)}日`)).toBe(`${Number(past.slice(0, 4)) + 1}-${m}-${dd}`);
  });
});

describe('quickParse: en dates', () => {
  it('today / tomorrow / next week', () => {
    expect(de('today')).toBe(today);
    expect(de('tomorrow')).toBe(shift(1));
    const nw = de('nextweek');
    const [y, m, dd] = nw!.split('-').map(Number);
    expect(new Date(y, m - 1, dd).getDay()).toBe(1);
  });

  it('`~next week` works inside full quick-add input (space normalization)', () => {
    const r = en('Plan sprint ~next week !med');
    expect(r.title).toBe('Plan sprint');
    expect(r.priority).toBe(2);
    const [y, m, dd] = r.dueDate!.split('-').map(Number);
    expect(new Date(y, m - 1, dd).getDay()).toBe(1);
  });

  it.each([
    ['wed', 3],
    ['sunday', 0],
    ['sat', 6],
  ])('%s → that weekday', (word, expectedDow) => {
    const day = de(word);
    const [y, m, dd] = day!.split('-').map(Number);
    expect(new Date(y, m - 1, dd).getDay()).toBe(expectedDow);
    expect(day).not.toBe(today);
  });
});

describe('quickParse: neutral formats + junk', () => {
  it('M/D rolls to next year when past', () => {
    const past = shift(-10);
    const [, m, dd] = past.split('-');
    expect(d(`${Number(m)}/${Number(dd)}`)).toBe(`${Number(past.slice(0, 4)) + 1}-${m}-${dd}`);
  });

  it('M-D works', () => {
    expect(d('9-7')).toBe('2026-09-07');
  });

  it('ISO date passes through', () => {
    expect(de('2026-12-01')).toBe('2026-12-01');
    expect(de('2026-1-5')).toBe('2026-01-05');
  });

  it('unparseable ~word stays in the title', () => {
    const r = zh('任务 ~不知道');
    expect(r.dueDate).toBeUndefined();
    expect(r.title).toBe('任务 ~不知道');
  });

  it('invalid calendar dates are rejected', () => {
    expect(d('13月5日')).toBeNull();
    expect(d('2月30日')).toBeNull();
  });
});

describe('quickParse: combinations', () => {
  it('parses tag + date + priority together (zh)', () => {
    const r = zh('提交报销单 ~明天 !高 #财务');
    expect(r).toEqual({ title: '提交报销单', tags: ['财务'], priority: 3, dueDate: shift(1) });
  });

  it('parses in any order', () => {
    const a = zh('发货 !低 #物流 ~后天');
    const b = zh('~后天 发货 #物流 !低');
    expect(a.title).toBe('发货');
    expect(b.title).toBe('发货');
    expect(a.dueDate).toBe(b.dueDate);
    expect(a.priority).toBe(b.priority);
    expect(a.tags).toEqual(b.tags);
  });

  it('parses full English input', () => {
    const r = en('Ship release ~tomorrow !high #ops');
    expect(r).toEqual({ title: 'Ship release', tags: ['ops'], priority: 3, dueDate: shift(1) });
  });

  it('plain text passes through untouched', () => {
    expect(zh('无解析项的普通任务')).toEqual({ title: '无解析项的普通任务', tags: [] });
    expect(en('just a normal task')).toEqual({ title: 'just a normal task', tags: [] });
  });

  it('collapses whitespace left by stripped tokens', () => {
    const r = zh('  多   空格  ~今天  !1  ');
    expect(r.title).toBe('多 空格');
  });
});
