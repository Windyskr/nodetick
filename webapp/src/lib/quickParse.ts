import type { Lang } from '../i18n';
import { addDays, todayStr } from './date';

export interface ParsedQuickAdd {
  title: string;
  tags: string[];
  priority?: number;
  dueDate?: string;
}

export interface QuickParseOptions {
  recognizeBareDates?: boolean;
}

export interface QuickDateToken {
  text: string;
  start: number;
  end: number;
  dueDate: string;
}

const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * TickTick-style quick-add parsing:
 *   `#tag` → tag;  `today` / `明天` / `周五` / `9月5日` (or the same with `~`) → due date;
 *   `!1 !2 !3` / `!high !medium !low` / `!高 !中 !低` → priority.
 * Matched tokens are stripped from the title.
 */
export function parseQuickAdd(raw: string, lang: Lang, options: QuickParseOptions = {}): ParsedQuickAdd {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (lang === 'en') text = text.replace(/~next\s+week/gi, '~nextweek');
  const tags: string[] = [];
  let priority: number | undefined;
  let dueDate: string | undefined;

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
  if (dateTok) {
    dueDate = dateTok.dueDate;
    text = `${text.slice(0, dateTok.start)} ${text.slice(dateTok.end)}`;
  }

  return { title: text.replace(/\s+/g, ' ').trim(), tags, priority, dueDate };
}

/** Find a natural-language date token while retaining its source position for the input UI. */
export function findQuickDateToken(raw: string, lang: Lang): QuickDateToken | null {
  return findQuickDateTokens(raw, lang)[0] ?? null;
}

/** Find all valid natural-language date tokens in source order. */
export function findQuickDateTokens(raw: string, lang: Lang): QuickDateToken[] {
  const pattern = lang === 'zh'
    // Chinese does not use spaces between a date word and the title, so
    // `今天开会` and `开会今天` must both keep the date token visible.
    ? /(~?(?:今天|明天|后天|下周|周[日一二三四五六]|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}|\d{1,2}月\d{1,2}[日号]))/g
    : /(?:^|\s)(~?(?:today|tomorrow|next\s+week|nextweek|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|\d{1,2}[/-]\d{1,2}|\d{4}-\d{1,2}-\d{1,2}))(?=\s|$)/gi;

  const tokens: QuickDateToken[] = [];
  for (const match of raw.matchAll(pattern)) {
    const source = match[1];
    const start = (match.index ?? 0) + match[0].indexOf(source);
    const word = source.replace(/^~/, '').replace(/\s+/g, '');
    const dueDate = parseDateWord(word, lang);
    if (dueDate) tokens.push({ text: source, start, end: start + source.length, dueDate });
  }
  return tokens;
}

/** Resolve a single date token to a local 'YYYY-MM-DD', or null. */
export function parseDateWord(word: string, lang: Lang): string | null {
  const w = lang === 'zh' ? word : word.toLowerCase();
  const today = todayStr();

  if (lang === 'zh') {
    if (w === '今天') return today;
    if (w === '明天') return addDays(today, 1);
    if (w === '后天') return addDays(today, 2);
    if (w === '下周') return nextWeekday(today, 1);
    const zhou = /^周([日一二三四五六])$/.exec(w);
    if (zhou) return nextWeekday(today, WEEKDAY_ZH.indexOf(zhou[1]));
    const cn = /^(\d{1,2})月(\d{1,2})[日号]$/.exec(w);
    if (cn) return futureDate(Number(cn[1]), Number(cn[2]));
  } else {
    if (w === 'today') return today;
    if (w === 'tomorrow') return addDays(today, 1);
    if (w === 'nextweek' || w === 'next_week') return nextWeekday(today, 1);
    const enIdx = WEEKDAY_EN.findIndex((d) => d === w || d.slice(0, 3) === w);
    if (enIdx >= 0) return nextWeekday(today, enIdx);
  }

  // language-neutral: M/D, M-D, YYYY-MM-DD
  const slash = /^(\d{1,2})[/\-](\d{1,2})$/.exec(w);
  if (slash) return futureDate(Number(slash[1]), Number(slash[2]));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

/** Next occurrence of the given weekday (0=Sunday); today counts as next week. */
function nextWeekday(today: string, target: number): string | null {
  if (target < 0) return null;
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const ahead = ((target - dow + 7) % 7) || 7;
  return addDays(today, ahead);
}

/** Day in the current year; rolls to next year if it would land in the past. */
function futureDate(month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = new Date().getFullYear();
  const candidate = validDate(year, month, day);
  if (!candidate) return null;
  return candidate < todayStr() ? validDate(year + 1, month, day) : candidate;
}

/** Format y/m/d only when it is a real calendar date (rejects 2月30日). */
function validDate(year: number, month: number, day: number): string | null {
  const dt = new Date(year, month - 1, day);
  const p = (n: number) => String(n).padStart(2, '0');
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${year}-${p(month)}-${p(day)}`;
}
