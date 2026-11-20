import type { Lang } from '../i18n';
import { addDays } from './date';

export interface ParsedQuickAdd {
  title: string;
  tags: string[];
  priority?: number;
  dueDate?: string;
  /** 'HH:MM' when the date phrase names a time: a timed task instead of an all-day one. */
  time?: string;
  /** RRULE when the phrase repeats ("每周一", "every day"). */
  repeat?: string;
}

export interface QuickParseOptions {
  recognizeBareDates?: boolean;
}

export interface QuickDateToken {
  text: string;
  start: number;
  end: number;
  dueDate: string;
  time?: string;
  repeat?: string;
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * TickTick-style quick-add parsing:
 *   `#tag` → tag;  `!1 !2 !3` / `!high !medium !low` / `!高 !中 !低` → priority;
 *   a date phrase (or the same with `~`) → due date, time and repeat:
 *   `明天下午3点`, `周五`, `9月5日`, `3天后`, `每周一早上9点`, `每月15号`,
 *   `today`, `tomorrow 3pm`, `in 2 weeks`, `every monday at 9am`.
 * Matched tokens are stripped from the title.
 */
export function parseQuickAdd(raw: string, lang: Lang, options: QuickParseOptions = {}): ParsedQuickAdd {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (lang === 'en') text = text.replace(/~next\s+week/gi, '~nextweek');
  const tags: string[] = [];
  let priority: number | undefined;

  // tags
  for (const m of text.matchAll(/#([^\s#]+)/g)) {
    tags.push(m[1]);
  }
  text = text.replace(/#[^\s#]+/g, ' ');

  // priority: `!` followed by level 0-3 or a level word (zh or en), stored as
  // TickTick's values (0 none, 1 low, 3 medium, 5 high)
  const pri = /(?:^|\s)!(\S+)(?=\s|$)/i.exec(text);
  if (pri) {
    const word = pri[1].toLowerCase();
    const map: Record<string, number> = {
      '0': 0, '1': 1, '2': 3, '3': 5,
      high: 5, medium: 3, med: 3, low: 1, none: 0,
      高: 5, 中: 3, 低: 1, 无: 0,
    };
    if (word in map) {
      priority = map[word];
      text = text.replace(pri[0], ' ');
    }
  }

  // A quick-add task has one date slot. Pick the first date-looking token in
  // source order, regardless of whether it is explicit (`~明天`) or implicit
  // (`明天`), then leave every later date-looking word in the title.
  const dateTokens = findQuickDateTokens(text, lang);
  const firstDate = dateTokens[0];
  const dateTok = firstDate && (firstDate.text.startsWith('~') || options.recognizeBareDates !== false)
    ? firstDate
    : dateTokens.find((token) => token.text.startsWith('~'));
  const result: ParsedQuickAdd = { title: '', tags, priority };
  if (dateTok) {
    result.dueDate = dateTok.dueDate;
    if (dateTok.time) result.time = dateTok.time;
    if (dateTok.repeat) result.repeat = dateTok.repeat;
    text = `${text.slice(0, dateTok.start)} ${text.slice(dateTok.end)}`;
  }
  result.title = text.replace(/\s+/g, ' ').trim();
  if (result.priority === undefined) delete result.priority;
  return result;
}

/** Find a natural-language date token while retaining its source position for the input UI. */
export function findQuickDateToken(raw: string, lang: Lang, now = new Date()): QuickDateToken | null {
  return findQuickDateTokens(raw, lang, now)[0] ?? null;
}

// --- Chinese phrases ---------------------------------------------------------

const ZH_DAY = '[一二三四五六日天]';
const ZH_CN = '[零〇一二两三四五六七八九十]';
const ZH_NUM = `(?:\\d{1,2}|${ZH_CN}{1,3})`;
const ZH_PERIOD = '(?:早上|早晨|清晨|上午|中午|下午|傍晚|晚上|今晚|明晚|夜里|凌晨)';
const ZH_MINUTE = `(?:\\d{1,2}分?|半|一刻|三刻|${ZH_CN}{1,3}分)`;
const ZH_TIME = `(?:${ZH_PERIOD}?${ZH_NUM}[点时](?:${ZH_MINUTE})?|${ZH_PERIOD}?\\d{1,2}[:：]\\d{2})`;
const ZH_WEEK = '(?:周|星期|礼拜)';
const ZH_DATE = [
  '大后天', '今天', '明天', '后天',
  `下个?${ZH_WEEK}${ZH_DAY}`, `下个?${ZH_WEEK}`, `(?:这|本)${ZH_WEEK}${ZH_DAY}`, `${ZH_WEEK}${ZH_DAY}`, '周末',
  `(?:\\d{1,3}|${ZH_CN}{1,3})天后`, `(?:\\d{1,2}|${ZH_CN}{1,3})(?:周|个星期)后`,
  '下个?月\\d{1,2}[号日]', '\\d{1,2}月\\d{1,2}[日号]', '\\d{4}-\\d{1,2}-\\d{1,2}', '\\d{1,2}[/-]\\d{1,2}',
].join('|');
const ZH_REPEAT = [
  '每天', '每日', '每个?工作日',
  `每个?${ZH_WEEK}${ZH_DAY}(?:[、,，和及]${ZH_DAY})*`, `每个?${ZH_WEEK}`,
  '每个?月\\d{1,2}[号日]', '每个?月', '每年\\d{1,2}月\\d{1,2}[日号]', '每年',
  `每隔?(?:\\d{1,3}|${ZH_CN}{1,3})(?:天|周|个星期|个?月|年)`,
].join('|');
const ZH_TOKEN = new RegExp(`~?(?:(?:${ZH_REPEAT})(?:${ZH_TIME})?|(?:${ZH_DATE})(?:${ZH_TIME})?|${ZH_TIME})`, 'g');

// --- English phrases ---------------------------------------------------------

const EN_WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun)';
const EN_MONTH = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';
const EN_TIME = '(?:at\\s+)?(?:\\d{1,2}(?::\\d{2})?\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)|\\d{1,2}:\\d{2}|noon|midnight)';
const EN_DATE = [
  'day\\s+after\\s+tomorrow', 'today', 'tonight', 'tomorrow', 'tmrw', 'tmr',
  `next\\s+${EN_WEEKDAY}`, 'next\\s+week', 'nextweek', `this\\s+${EN_WEEKDAY}`, EN_WEEKDAY,
  'in\\s+\\d{1,3}\\s+(?:days?|weeks?)', '\\d{4}-\\d{1,2}-\\d{1,2}', '\\d{1,2}[/-]\\d{1,2}',
  `${EN_MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?`, `\\d{1,2}(?:st|nd|rd|th)?\\s+${EN_MONTH}`,
].join('|');
const EN_REPEAT = [
  'every\\s+day', 'every\\s+other\\s+day', 'daily', 'every\\s+weekday', 'weekdays',
  `every\\s+(?:other\\s+)?${EN_WEEKDAY}(?:\\s*(?:,|and|&)\\s*${EN_WEEKDAY})*`,
  'every\\s+week', 'weekly', 'every\\s+month', 'monthly', 'every\\s+year', 'yearly', 'annually',
  'every\\s+\\d{1,3}\\s+(?:days?|weeks?|months?|years?)',
].join('|');
const EN_TOKEN = new RegExp(
  `(?:^|\\s)(~?(?:(?:${EN_REPEAT}|${EN_DATE})(?:\\s+${EN_TIME})?|${EN_TIME}(?:\\s+(?:${EN_DATE}))?))(?=\\s|$|[,.;!?])`,
  'gi',
);

/** Find all valid natural-language date tokens in source order. */
export function findQuickDateTokens(raw: string, lang: Lang, now = new Date()): QuickDateToken[] {
  const tokens: QuickDateToken[] = [];
  const pattern = lang === 'zh' ? ZH_TOKEN : EN_TOKEN;
  for (const match of raw.matchAll(new RegExp(pattern.source, pattern.flags))) {
    const source = lang === 'zh' ? match[0] : match[1];
    const start = (match.index ?? 0) + match[0].indexOf(source);
    const phrase = source.replace(/^~/, '');
    const resolved = lang === 'zh' ? resolveZh(phrase, now) : resolveEn(phrase.toLowerCase().replace(/\s+/g, ' '), now);
    if (resolved) tokens.push({ text: source, start, end: start + source.length, ...resolved });
  }
  return tokens;
}

/** Resolve a single date token to a local 'YYYY-MM-DD', or null. */
export function parseDateWord(word: string, lang: Lang): string | null {
  const resolved = lang === 'zh' ? resolveZh(word, new Date()) : resolveEn(word.toLowerCase().replace(/\s+/g, ' '), new Date());
  return resolved && !resolved.time && !resolved.repeat ? resolved.dueDate : null;
}

interface Resolved {
  dueDate: string;
  time?: string;
  repeat?: string;
}

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const clockOf = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const weekdayOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

/** 一 → 1, 十二 → 12, 二十三 → 23, 两 → 2 (and plain digits). */
function zhNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === '十') return 10;
  const tens = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(text);
  if (tens) return (tens[1] ? digits[tens[1]] : 1) * 10 + (tens[2] ? digits[tens[2]] : 0);
  return text.length === 1 && text in digits ? digits[text] : null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "下午3点半" → { time: '15:30', day: 'today'|'tomorrow'|null }. */
function zhTime(text: string): { time: string; forced: 'today' | 'tomorrow' | null } | null {
  const match = new RegExp(`^(${ZH_PERIOD})?(?:(${ZH_NUM})[点时](${ZH_MINUTE})?|(\\d{1,2})[:：](\\d{2}))$`).exec(text);
  if (!match) return null;
  const period = match[1] ?? '';
  let hour = zhNumber(match[2] ?? match[4] ?? '');
  let minute = 0;
  const minuteText = match[3] ?? match[5] ?? '';
  if (minuteText === '半') minute = 30;
  else if (minuteText === '一刻') minute = 15;
  else if (minuteText === '三刻') minute = 45;
  else if (minuteText) minute = zhNumber(minuteText.replace(/分$/, '')) ?? -1;
  if (hour == null || hour > 24 || minute < 0 || minute > 59) return null;
  if (/下午|傍晚|晚上|今晚|明晚|夜里/.test(period)) {
    if (hour < 12) hour += 12;
  } else if (period === '中午') {
    if (hour < 3) hour += 12;
  } else if (/凌晨|早上|早晨|清晨|上午/.test(period)) {
    if (hour === 12) hour = 0;
  } else if (hour >= 1 && hour <= 6) {
    // "3点开会": an afternoon hour unless 上午/凌晨 says otherwise.
    hour += 12;
  }
  if (hour === 24) hour = 0;
  if (hour > 23) return null;
  return { time: `${pad2(hour)}:${pad2(minute)}`, forced: period === '今晚' ? 'today' : period === '明晚' ? 'tomorrow' : null };
}

function zhDate(text: string, today: string): string | null {
  if (text === '今天') return today;
  if (text === '明天') return addDays(today, 1);
  if (text === '后天') return addDays(today, 2);
  if (text === '大后天') return addDays(today, 3);
  if (text === '周末') return nextWeekday(today, 6, true);
  let m = /^下个?(?:周|星期|礼拜)([一二三四五六日天])?$/.exec(text);
  if (m) {
    if (!m[1]) return nextWeekday(today, 1);
    // "下周三" is Wednesday of next week (weeks start on Monday in Chinese).
    const target = m[1] === '日' || m[1] === '天' ? 7 : WEEKDAY_ZH.indexOf(m[1]);
    const dow = weekdayOf(today) || 7;
    return addDays(today, 7 - dow + target);
  }
  m = /^(?:这|本)(?:周|星期|礼拜)([一二三四五六日天])$/.exec(text);
  if (m) {
    const target = m[1] === '日' || m[1] === '天' ? 7 : WEEKDAY_ZH.indexOf(m[1]);
    const dow = weekdayOf(today) || 7;
    return addDays(today, target - dow);
  }
  m = /^(?:周|星期|礼拜)([一二三四五六日天])$/.exec(text);
  if (m) return nextWeekday(today, m[1] === '天' ? 0 : WEEKDAY_ZH.indexOf(m[1]));
  m = new RegExp(`^(\\d{1,3}|${ZH_CN}{1,3})天后$`).exec(text);
  if (m) {
    const n = zhNumber(m[1]);
    return n != null && n > 0 ? addDays(today, n) : null;
  }
  m = new RegExp(`^(\\d{1,2}|${ZH_CN}{1,3})(?:周|个星期)后$`).exec(text);
  if (m) {
    const n = zhNumber(m[1]);
    return n != null && n > 0 ? addDays(today, n * 7) : null;
  }
  m = /^下个?月(\d{1,2})[号日]$/.exec(text);
  if (m) {
    const [y, mo] = today.split('-').map(Number);
    const next = new Date(y, mo, 1);
    return validDate(next.getFullYear(), next.getMonth() + 1, Number(m[1]));
  }
  m = /^(\d{1,2})月(\d{1,2})[日号]$/.exec(text);
  if (m) return futureDate(Number(m[1]), Number(m[2]), today);
  return numericDate(text, today);
}

/** M/D, M-D (this year, or next once past) and YYYY-MM-DD. */
function numericDate(text: string, today: string): string | null {
  const slash = /^(\d{1,2})[/\-](\d{1,2})$/.exec(text);
  if (slash) return futureDate(Number(slash[1]), Number(slash[2]), today);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

/** A repeat rule and its first day on or after `today` (after it, when the time has passed). */
interface RepeatSpec {
  rule: string;
  /** Whether `day` repeats under the rule (from `from` on). */
  matches: (day: string, from: string) => boolean;
  /** Days between occurrences when the rule has no weekday/month-day pattern. */
  step?: (day: string) => string;
}

function firstOccurrence(spec: RepeatSpec, today: string, skipToday: boolean): string {
  let day = skipToday ? addDays(today, 1) : today;
  if (spec.step && skipToday) return spec.step(today);
  for (let i = 0; i < 400; i++, day = addDays(day, 1)) if (spec.matches(day, today)) return day;
  return today;
}

const addMonths = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1 + n, 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(Math.min(d, last))}`;
};

function daily(interval: number): RepeatSpec {
  return {
    rule: interval > 1 ? `RRULE:FREQ=DAILY;INTERVAL=${interval}` : 'RRULE:FREQ=DAILY',
    matches: () => true,
    step: (day) => addDays(day, interval),
  };
}

function weekly(days: number[], interval = 1): RepeatSpec {
  const codes = [1, 2, 3, 4, 5, 6, 0].filter((day) => days.includes(day)).map((day) => RRULE_DAYS[day]);
  return {
    rule: `RRULE:FREQ=WEEKLY;${interval > 1 ? `INTERVAL=${interval};` : ''}BYDAY=${codes.join(',')}`,
    matches: (day) => days.includes(weekdayOf(day)),
  };
}

const WEEKDAYS_RULE: RepeatSpec = {
  rule: 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
  matches: (day) => weekdayOf(day) >= 1 && weekdayOf(day) <= 5,
};

function monthly(monthDay: number | null, today: string, interval = 1): RepeatSpec {
  const dayOfMonth = monthDay ?? Number(today.slice(8, 10));
  return {
    rule: `RRULE:FREQ=MONTHLY;${interval > 1 ? `INTERVAL=${interval};` : ''}BYMONTHDAY=${dayOfMonth}`,
    matches: (day) => Number(day.slice(8, 10)) === dayOfMonth,
  };
}

function yearly(month: number | null, monthDay: number | null, today: string, interval = 1): RepeatSpec | null {
  const m = month ?? Number(today.slice(5, 7));
  const d = monthDay ?? Number(today.slice(8, 10));
  if (!validDate(2024, m, d)) return null; // 2024 is a leap year: Feb 29 is fine
  return {
    rule: interval > 1 ? `RRULE:FREQ=YEARLY;INTERVAL=${interval}` : 'RRULE:FREQ=YEARLY',
    matches: (day) => Number(day.slice(5, 7)) === m && Number(day.slice(8, 10)) === d,
  };
}

function zhRepeat(text: string, today: string): RepeatSpec | null {
  if (text === '每天' || text === '每日') return daily(1);
  if (/^每个?工作日$/.test(text)) return WEEKDAYS_RULE;
  let m = /^每个?(?:周|星期|礼拜)([一二三四五六日天](?:[、,，和及][一二三四五六日天])*)?$/.exec(text);
  if (m) {
    const days = m[1] ? [...m[1].replace(/[、,，和及]/g, '')].map((c) => (c === '天' ? 0 : WEEKDAY_ZH.indexOf(c))) : [weekdayOf(today)];
    return weekly([...new Set(days)]);
  }
  m = /^每个?月(?:(\d{1,2})[号日])?$/.exec(text);
  if (m) {
    const day = m[1] ? Number(m[1]) : null;
    return day != null && (day < 1 || day > 31) ? null : monthly(day, today);
  }
  m = /^每年(?:(\d{1,2})月(\d{1,2})[日号])?$/.exec(text);
  if (m) return yearly(m[1] ? Number(m[1]) : null, m[2] ? Number(m[2]) : null, today);
  m = new RegExp(`^每(隔)?(\\d{1,3}|${ZH_CN}{1,3})(天|周|个星期|个?月|年)$`).exec(text);
  if (m) {
    const n = zhNumber(m[2]);
    if (n == null || n < 1) return null;
    // 每隔一天 = every other day: "skip n" means a period of n + 1.
    const interval = m[1] ? n + 1 : n;
    if (m[3] === '天') return daily(interval);
    if (m[3] === '周' || m[3] === '个星期') return { ...weekly([weekdayOf(today)], interval), step: (day) => addDays(day, interval * 7) };
    if (m[3].endsWith('月')) return { ...monthly(null, today, interval), step: (day) => addMonths(day, interval) };
    const spec = yearly(null, null, today, interval);
    return spec && { ...spec, step: (day) => addMonths(day, interval * 12) };
  }
  return null;
}

/** Split a phrase into a leading repeat or date part and a trailing time. */
function resolveZh(phrase: string, now: Date): Resolved | null {
  const today = localDay(now);
  const repeatPart = new RegExp(`^(?:${ZH_REPEAT})`).exec(phrase)?.[0];
  const datePart = repeatPart ? undefined : new RegExp(`^(?:${ZH_DATE})`).exec(phrase)?.[0];
  const rest = phrase.slice((repeatPart ?? datePart ?? '').length);
  const clock = rest ? zhTime(rest) : null;
  if (rest && !clock) return null;
  return finish({ today, now, repeat: repeatPart ? zhRepeat(repeatPart, today) : undefined, day: datePart ? zhDate(datePart, today) : undefined, clock, partsFound: Boolean(repeatPart || datePart) });
}

function finish({ today, now, repeat, day, clock, partsFound }: {
  today: string;
  now: Date;
  repeat?: RepeatSpec | null;
  day?: string | null;
  clock: { time: string; forced: 'today' | 'tomorrow' | null } | null;
  partsFound: boolean;
}): Resolved | null {
  if (repeat === null || day === null) return null;
  if (!partsFound && !clock) return null;
  const passed = clock ? clock.time <= clockOf(now) : false;
  if (repeat) {
    const first = firstOccurrence(repeat, today, passed);
    return { dueDate: first, repeat: repeat.rule, ...(clock ? { time: clock.time } : {}) };
  }
  if (day) return { dueDate: day, ...(clock ? { time: clock.time } : {}) };
  // A time alone is today, or tomorrow once it has passed ("今晚"/"明晚" say which).
  const forcedDay = clock!.forced === 'today' ? today : clock!.forced === 'tomorrow' ? addDays(today, 1) : null;
  return { dueDate: forcedDay ?? (passed ? addDays(today, 1) : today), time: clock!.time };
}

// --- English resolution -------------------------------------------------------

const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function enWeekday(word: string): number {
  return WEEKDAY_EN.findIndex((day) => day === word || day.startsWith(word.slice(0, 3)) && word.length >= 3 && day.startsWith(word));
}

function enTime(text: string): { time: string; forced: null } | null {
  const t = text.replace(/^at\s+/, '');
  if (t === 'noon') return { time: '12:00', forced: null };
  if (t === 'midnight') return { time: '00:00', forced: null };
  const m = /^(\d{1,2})(?::(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const suffix = m[3]?.replace(/\./g, '');
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return { time: `${pad2(hour)}:${pad2(minute)}`, forced: null };
}

function enDate(text: string, today: string): string | null {
  if (text === 'today' || text === 'tonight') return today;
  if (text === 'tomorrow' || text === 'tmr' || text === 'tmrw') return addDays(today, 1);
  if (text === 'day after tomorrow') return addDays(today, 2);
  if (text === 'next week' || text === 'nextweek') return nextWeekday(today, 1);
  let m = /^next (\w+)$/.exec(text);
  if (m) {
    const target = enWeekday(m[1]);
    if (target < 0) return null;
    // "next friday": the Friday of next week.
    const dow = weekdayOf(today) || 7;
    return addDays(today, 7 - dow + (target || 7));
  }
  m = /^this (\w+)$/.exec(text);
  if (m) {
    const target = enWeekday(m[1]);
    return target < 0 ? null : nextWeekday(today, target, true);
  }
  m = /^in (\d{1,3}) (days?|weeks?)$/.exec(text);
  if (m) return Number(m[1]) > 0 ? addDays(today, Number(m[1]) * (m[2].startsWith('week') ? 7 : 1)) : null;
  m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/.exec(text) ?? null;
  if (m && EN_MONTHS.includes(m[1].slice(0, 3))) return futureDate(EN_MONTHS.indexOf(m[1].slice(0, 3)) + 1, Number(m[2]), today);
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/.exec(text);
  if (m && EN_MONTHS.includes(m[2].slice(0, 3))) return futureDate(EN_MONTHS.indexOf(m[2].slice(0, 3)) + 1, Number(m[1]), today);
  const weekday = enWeekday(text);
  if (weekday >= 0) return nextWeekday(today, weekday);
  return numericDate(text, today);
}

function enRepeat(text: string, today: string): RepeatSpec | null {
  if (text === 'every day' || text === 'daily') return daily(1);
  if (text === 'every other day') return daily(2);
  if (text === 'every weekday' || text === 'weekdays') return WEEKDAYS_RULE;
  if (text === 'every week' || text === 'weekly') return weekly([weekdayOf(today)]);
  if (text === 'every month' || text === 'monthly') return monthly(null, today);
  if (text === 'every year' || text === 'yearly' || text === 'annually') return yearly(null, null, today);
  let m = /^every (\d{1,3}) (days?|weeks?|months?|years?)$/.exec(text);
  if (m) {
    const n = Number(m[1]);
    if (n < 1) return null;
    if (m[2].startsWith('day')) return daily(n);
    if (m[2].startsWith('week')) return { ...weekly([weekdayOf(today)], n), step: (day) => addDays(day, n * 7) };
    if (m[2].startsWith('month')) return { ...monthly(null, today, n), step: (day) => addMonths(day, n) };
    const spec = yearly(null, null, today, n);
    return spec && { ...spec, step: (day) => addMonths(day, n * 12) };
  }
  m = /^every (other )?(.+)$/.exec(text);
  if (m) {
    const days = m[2].split(/\s*(?:,|and|&)\s*/).map(enWeekday);
    if (!days.length || days.some((day) => day < 0)) return null;
    return weekly([...new Set(days)], m[1] ? 2 : 1);
  }
  return null;
}

function resolveEn(phrase: string, now: Date): Resolved | null {
  const today = localDay(now);
  const head = new RegExp(`^(?:${EN_REPEAT}|${EN_DATE})(?=\\s|$)`, 'i').exec(phrase)?.[0];
  if (head) {
    const rest = phrase.slice(head.length).trim();
    const clock = rest ? enTime(rest) : null;
    if (rest && !clock) return null;
    const isRepeat = new RegExp(`^(?:${EN_REPEAT})$`, 'i').test(head);
    let day = isRepeat ? undefined : enDate(head, today);
    // "tonight 8" is no time, but "tonight" alone is today.
    if (head === 'tonight' && clock && Number(clock.time.slice(0, 2)) < 12) clock.time = `${pad2(Number(clock.time.slice(0, 2)) + 12)}${clock.time.slice(2)}`;
    if (day === undefined && !isRepeat) day = null;
    return finish({ today, now, repeat: isRepeat ? enRepeat(head, today) : undefined, day, clock, partsFound: true });
  }
  // A time first, optionally followed by a date: "3pm tomorrow".
  const timeHead = new RegExp(`^${EN_TIME}`, 'i').exec(phrase)?.[0];
  if (!timeHead) return null;
  const clock = enTime(timeHead.trim());
  const rest = phrase.slice(timeHead.length).trim();
  if (!clock) return null;
  if (!rest) return finish({ today, now, clock, partsFound: false });
  const day = enDate(rest, today);
  return day ? { dueDate: day, time: clock.time } : null;
}

/** Next occurrence of the given weekday (0=Sunday); today counts as next week unless `includeToday`. */
function nextWeekday(today: string, target: number, includeToday = false): string | null {
  if (target < 0) return null;
  const dow = weekdayOf(today);
  const ahead = ((target - dow + 7) % 7) || (includeToday ? 0 : 7);
  return addDays(today, ahead);
}

/** Day in the current year; rolls to next year if it would land in the past. */
function futureDate(month: number, day: number, today: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  const candidate = validDate(year, month, day);
  if (!candidate) return validDate(year + 1, month, day);
  return candidate < today ? validDate(year + 1, month, day) : candidate;
}

/** Format y/m/d only when it is a real calendar date (rejects 2月30日). */
function validDate(year: number, month: number, day: number): string | null {
  const dt = new Date(year, month - 1, day);
  const p = (n: number) => String(n).padStart(2, '0');
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${year}-${p(month)}-${p(day)}`;
}
