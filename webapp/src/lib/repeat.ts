import type { Key, Lang } from '../i18n';
import { shortDate } from './date';

/**
 * Human label for a stored repeat rule (RRULE), matching what the worker's
 * recurrence engine does: "Monthly on the 2nd Tuesday", "每年11月第4个周四",
 * plus the end of the series (UNTIL / COUNT).
 */

type Translate = (key: Key, ...args: (string | number)[]) => string;

interface RepeatParts {
  freq: string;
  interval: number;
  byDay: { weekday: number; nth: number | null }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  until: string | null;
  count: number | null;
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WEEKDAY_NAMES: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ints = (value: string | undefined) =>
  (value ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0);

export function parseRepeat(flag: string): RepeatParts | null {
  const parts = new Map(
    flag.trim().replace(/^RRULE:/i, '').toUpperCase().split(';').map((part) => {
      const eq = part.indexOf('=');
      return [part.slice(0, eq).trim(), part.slice(eq + 1).trim()] as [string, string];
    }),
  );
  const freq = parts.get('FREQ');
  if (!freq) return null;
  const until = /^(\d{4})(\d{2})(\d{2})/.exec(parts.get('UNTIL') ?? '');
  const count = Number(parts.get('COUNT'));
  return {
    freq,
    interval: Math.max(1, Number(parts.get('INTERVAL')) || 1),
    byDay: (parts.get('BYDAY') ?? '').split(',').flatMap((token) => {
      const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim());
      return match ? [{ weekday: WEEKDAY_CODES.indexOf(match[2]), nth: match[1] ? Number(match[1]) : null }] : [];
    }),
    byMonthDay: ints(parts.get('BYMONTHDAY')),
    byMonth: ints(parts.get('BYMONTH')),
    bySetPos: ints(parts.get('BYSETPOS')),
    until: until ? `${until[1]}-${until[2]}-${until[3]}` : null,
    count: Number.isInteger(count) && count > 0 ? count : null,
  };
}

function ordinal(n: number, lang: Lang): string {
  if (lang === 'zh') return n === -1 ? '最后一个' : n < 0 ? `倒数第${-n}个` : `第${n}个`;
  if (n === -1) return 'last';
  const abs = Math.abs(n);
  const suffix = abs % 100 >= 11 && abs % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][abs % 10] ?? 'th';
  return n < 0 ? `${abs}${suffix}-to-last` : `${abs}${suffix}`;
}

/** The single "nth weekday" a rule picks (BYDAY=2TU, or BYDAY=TU;BYSETPOS=2), if that is all it picks. */
function nthWeekday(parts: RepeatParts): { weekday: number; nth: number } | null {
  if (parts.byDay.length !== 1 || parts.byMonthDay.length) return null;
  const [{ weekday, nth }] = parts.byDay;
  if (nth !== null) return parts.bySetPos.length ? null : { weekday, nth };
  return parts.bySetPos.length === 1 ? { weekday, nth: parts.bySetPos[0] } : null;
}

export function describeRepeat(flag: string | null | undefined, lang: Lang, t: Translate): string {
  if (!flag) return t('repeatNone');
  const parts = parseRepeat(flag);
  if (!parts) return t('repeatSet');
  const n = parts.interval;
  const nth = nthWeekday(parts);
  let label: string;
  if (parts.freq === 'DAILY') {
    const weekdays = parts.byDay.map((d) => d.weekday).sort().join(',') === '1,2,3,4,5';
    label = weekdays ? t('repeatWeekdays') : n > 1 ? t('repeatEveryDays', n) : t('repeatDaily');
  } else if (parts.freq === 'WEEKLY') {
    label = n > 1 ? t('repeatEveryWeeks', n) : t('repeatWeekly');
  } else if (parts.freq === 'MONTHLY') {
    const period = n > 1 ? t('repeatEveryMonths', n) : t('repeatMonthly');
    if (nth) label = t('repeatOnDay', period, ordinal(nth.nth, lang), WEEKDAY_NAMES[lang][nth.weekday]);
    else if (!parts.byDay.length && parts.byMonthDay.join(',') === '-1') label = t('repeatLastDay', period);
    else label = period;
  } else if (parts.freq === 'YEARLY') {
    const period = n > 1 ? t('repeatEveryYears', n) : t('repeatYearly');
    const month = parts.byMonth.length === 1 ? parts.byMonth[0] : null;
    label = nth && month
      ? t('repeatOnDayOfMonth', period, ordinal(nth.nth, lang), WEEKDAY_NAMES[lang][nth.weekday], lang === 'zh' ? `${month}月` : MONTH_NAMES[month - 1])
      : period;
  } else {
    return t('repeatSet');
  }
  if (parts.until) {
    const year = parts.until.slice(0, 4);
    const day = shortDate(parts.until, lang);
    return t('repeatUntil', label, lang === 'zh' ? `${year}年${day}` : `${day}, ${year}`);
  }
  if (parts.count === 1) return t('repeatLastTime', label);
  if (parts.count) return t('repeatTimesLeft', label, parts.count);
  return label;
}
