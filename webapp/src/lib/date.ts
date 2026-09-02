import type { Lang } from '../i18n';
import { tOf, type Key } from '../i18n';

/**
 * Timezone-safe date helpers. Due dates are stored like
 * `2026-07-18T09:00:00+0000`; buckets compare the `YYYY-MM-DD` prefix against
 * the local calendar day, avoiding TZ math entirely.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayOf(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dateStr);
  return m ? m[1] : null;
}

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** 'YYYY-MM-DD' + current wall time, backend-compatible format. */
export function allDayDate(dateStr: string): string {
  return `${dateStr}T00:00:00+0000`;
}

/** 'Jul 18' (en) / '7月18日' (zh). */
export function shortDate(dateStr: string, lang: Lang = useI18nLang()): string {
  const day = dayOf(dateStr);
  if (!day) return '';
  const [, m, d] = day.split('-').map(Number);
  return lang === 'zh' ? `${m}月${d}日` : `${MONTHS[m - 1]} ${d}`;
}

/** Relative hint for far dates like TickTick's detail panel ("Today", "a month ago, Jul 18"). */
export function detailDate(dateStr: string, lang: Lang = useI18nLang()): string {
  const day = dayOf(dateStr);
  if (!day) return '';
  const today = todayStr();
  if (day === today) return tOf('relToday');
  if (day === addDays(today, 1)) return tOf('relTomorrow');
  if (day === addDays(today, -1)) return tOf('relYesterday');
  const year = Number(day.slice(0, 4));
  const thisYear = new Date().getFullYear();
  const base = shortDate(dateStr, lang);
  if (lang === 'zh') return year === thisYear ? base : `${year}年${base}`;
  return year === thisYear ? base : `${base}, ${year}`;
}

export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'next7' | 'later' | 'nodate';

export function bucketOf(task: { dueDate: string | null }): Bucket {
  const day = dayOf(task.dueDate);
  if (!day) return 'nodate';
  const today = todayStr();
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  if (day <= addDays(today, 7)) return 'next7';
  return 'later';
}

export const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'tomorrow', 'next7', 'later', 'nodate'];

const BUCKET_KEY: Record<Bucket, Key> = {
  overdue: 'bucketOverdue',
  today: 'bucketToday',
  tomorrow: 'bucketTomorrow',
  next7: 'bucketNext7',
  later: 'bucketLater',
  nodate: 'bucketNoDate',
};

export const bucketLabel = (b: Bucket): string => tOf(BUCKET_KEY[b]);

/** YYYYMMDD stamp for a local date. */
export function stampOf(dateStr: string): number {
  return Number(dateStr.replaceAll('-', ''));
}

export function stampToday(): number {
  return stampOf(todayStr());
}

/** Last n local days as 'YYYY-MM-DD' strings, oldest first. */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = todayStr();
  for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

const WEEKDAYS: Record<Lang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
};

export function weekdayShort(dateStr: string, lang: Lang = useI18nLang()): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[lang][new Date(y, m - 1, d).getDay()];
}

export function fmtDuration(seconds: number, lang: Lang = useI18nLang()): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (lang === 'zh') {
    if (h > 0) return `${h}小时${m}分`;
    if (m > 0) return `${m}分钟`;
    return `${seconds}秒`;
  }
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "a month ago, Jul 18" style relative time for comments. */
export function relTime(iso: string | null, lang: Lang = useI18nLang()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (lang === 'zh') {
    if (min < 1) return '刚刚';
    if (min < 60) return `${min}分钟前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}小时前`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}天前`;
    return shortDate(iso, lang);
  }
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return shortDate(iso, lang);
}

// Imported late to avoid a circular import at module init.
import { useI18n } from '../i18n';
function useI18nLang(): Lang {
  return useI18n.getState().lang;
}
