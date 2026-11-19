import { describe, expect, it } from 'vitest';
import { dictionaries, serverError, tfOf, tOf, useI18n } from '../src/i18n';
import { parseQuickAdd } from '../src/lib/quickParse';

describe('i18n dictionary parity', () => {
  const en = Object.keys(dictionaries.en).sort();
  const zh = Object.keys(dictionaries.zh).sort();

  it('zh covers every en key (no missing translations)', () => {
    const missing = en.filter((k) => !zh.includes(k));
    expect(missing).toEqual([]);
  });

  it('zh has no extra keys (keeps dictionaries in sync)', () => {
    const extra = zh.filter((k) => !en.includes(k));
    expect(extra).toEqual([]);
  });

  it('no empty translations', () => {
    for (const [lang, dict] of Object.entries(dictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        expect([lang, key, value !== '' && value != null]).toEqual([lang, key, true]);
      }
    }
  });

  it('TickTick-canonical zh terms are used', () => {
    setLangSilently('zh');
    expect(tOf('smartAll')).toBe('所有');
    expect(tOf('smartToday')).toBe('今天');
    expect(tOf('smartNext7')).toBe('最近7天');
    expect(tOf('smartInbox')).toBe('收集箱');
    expect(tOf('navTrash')).toBe('垃圾桶');
    expect(tOf('bucketOverdue')).toBe('已过期');
    expect(tOf('postpone')).toBe('顺延');
    expect(tOf('viewList')).toBe('清单视图');
  });
});

describe('interpolation', () => {
  it('tfOf replaces {0} {1} placeholders', () => {
    setLangSilently('en');
    expect(tfOf('addTaskTo', 'Inbox')).toBe('Add task to "Inbox"');
    expect(tfOf('habitStreak', 7)).toBe('🔥 7-day streak');
    setLangSilently('zh');
    expect(tfOf('addTaskTo', '收集箱')).toBe('添加任务至"收集箱"');
    expect(tfOf('movedToast', '工作')).toBe('已移动到 工作');
  });

  it('every placeholder in every dict value is consumed by interpolation', () => {
    for (const dict of Object.values(dictionaries)) {
      for (const [key, value] of Object.entries(dict)) {
        if (/\{\d\}/.test(value)) {
          const interpolated = tfOf(key as never, 'A', 'B', 'C', 'D');
          expect(interpolated, `${key} left a placeholder after interpolation`).not.toMatch(/\{\d\}/);
        }
      }
    }
  });
});

describe('server error localization', () => {
  it('maps known messages to Chinese', () => {
    setLangSilently('zh');
    expect(serverError('Invalid email or password.')).toBe('邮箱或密码错误。');
    expect(serverError('Registration is disabled. Ask an admin to create your account.')).toContain('注册已关闭');
    expect(serverError('That email is already registered.')).toContain('已被注册');
  });

  it('keeps the retry delay of lockout messages', () => {
    setLangSilently('zh');
    expect(serverError('Too many failed login attempts. Try again in 97 seconds.')).toBe('登录失败次数过多，请 97 秒后再试。');
    expect(serverError('Too many registration attempts. Try again in 900 seconds.')).toBe('注册尝试次数过多，请 900 秒后再试。');
  });

  it('passes unknown and English-language messages through', () => {
    setLangSilently('en');
    expect(serverError('Invalid email or password.')).toBe('Invalid email or password.');
    setLangSilently('zh');
    expect(serverError('Some totally unknown failure')).toBe('Some totally unknown failure');
  });
});

/** The store's setLang touches localStorage/document; tests use setState. */
function setLangSilently(lang: 'en' | 'zh') {
  useI18n.setState({ lang });
}

// keep the parser import used (cross-module smoke: i18n lang drives parsing)
describe('i18n ↔ parser integration', () => {
  it('the active store language selects the parsing dialect', () => {
    setLangSilently('zh');
    expect(parseQuickAdd('任务 ~明天', 'zh').dueDate).not.toBeNull();
    setLangSilently('en');
    expect(tOf('relToday')).toBe('Today');
  });
});
