import type { Countdown } from './types';
import { addDays, dayOf, localDayClock, nextOccurrence } from './date';
import { nextLunarYearly, solarToLunar } from './lunar';

/**
 * Countdown (倒数纪念日) logic shared by the countdown page and the calendar:
 * which day a countdown counts toward, day counts, spans and ordering. The
 * server mirrors the occurrence rules for reminders
 * (worker/src/services/notifications.ts, countdownFallsOn).
 */

export type CountdownKind = Countdown['kind'];
export const COUNTDOWN_KINDS: CountdownKind[] = ['countdown', 'anniversary', 'birthday', 'holiday'];

/** Reminder tokens the server understands, nearest lead first. */
export const REMINDER_TOKENS = ['same-day', '1-day', '2-days', '3-days', '1-week', '1-month'] as const;
export type ReminderToken = (typeof REMINDER_TOKENS)[number];

type Dated = Pick<Countdown, 'date' | 'repeatFlag' | 'lunar'>;

const pad = (n: number) => String(n).padStart(2, '0');
const utc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function dayDiff(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86400000);
}

/** Whether a countdown repeats every year on its lunar date (农历每年). */
export function isLunarYearly(countdown: Dated): boolean {
  const day = dayOf(countdown.date);
  return Boolean(countdown.lunar && countdown.repeatFlag === 'yearly' && day && solarToLunar(day));
}

/**
 * The day a countdown counts toward on `today`: its date, or for a repeat the
 * next occurrence on or after today (monthly and yearly repeats are solar,
 * with 29th–31st falling back to the month end; lunar ones follow the lunar
 * calendar). Repeats never point before their original date.
 */
export function countdownTarget(countdown: Dated, today: string): string | null {
  const day = dayOf(countdown.date);
  if (!day) return null;
  if (isLunarYearly(countdown)) return nextLunarYearly(day, today) ?? day;
  return nextOccurrence(day, countdown.repeatFlag, today);
}

/** Mon–Fri days among the `count` days after `start`. */
function weekdaysAfter(start: string, count: number): number {
  let total = Math.floor(count / 7) * 5;
  const weekday = new Date(utc(start)).getUTCDay();
  for (let i = 1; i <= count % 7; i++) {
    const day = (weekday + i) % 7;
    if (day !== 0 && day !== 6) total += 1;
  }
  return total;
}

/**
 * Signed days from `today` to `target`, negative once it has passed. Workday
 * countdowns count Monday–Friday only: the days after today up to the
 * target, or, for a past target, from it up to yesterday.
 */
export function countdownDays(today: string, target: string, workdays = false): number {
  const total = dayDiff(today, target);
  if (!workdays || total === 0) return total;
  // `|| 0`: a past gap of weekend days only is 0, not -0.
  return total > 0 ? weekdaysAfter(today, total) : -weekdaysAfter(addDays(target, -1), -total) || 0;
}

/** `day` moved by whole months, clamped to the month end (01-31 + 1 → 02-28). */
export function addMonthsClamped(day: string, months: number): string {
  const total = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(Number(day.slice(8, 10)), last))}`;
}

export interface Span {
  years: number;
  months: number;
  days: number;
}

/** The calendar distance between two days as years, months and days. */
export function ymdBetween(a: string, b: string): Span {
  const [from, to] = a <= b ? [a, b] : [b, a];
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  if (addMonthsClamped(from, months) > to) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12, days: dayDiff(addMonthsClamped(from, months), to) };
}

/** Every day in [start, end] a countdown falls on (for the calendar). */
export function occurrencesBetween(countdown: Dated, start: string, end: string): string[] {
  const out: string[] = [];
  let from = start;
  for (let i = 0; i < 400; i++) {
    const day = countdownTarget(countdown, from);
    if (!day || day < from || day > end) break;
    out.push(day);
    if (countdown.repeatFlag !== 'yearly' && countdown.repeatFlag !== 'monthly') break;
    from = addDays(day, 1);
  }
  return out;
}

/** The occurrence before `target` of a repeating countdown, or null (first one, or no repeat). */
export function previousOccurrence(countdown: Dated, target: string): string | null {
  const from = countdown.repeatFlag === 'monthly'
    ? addMonthsClamped(target, -1)
    : countdown.repeatFlag === 'yearly'
      // A lunar year has 353–385 days.
      ? isLunarYearly(countdown) ? addDays(target, -390) : addMonthsClamped(target, -12)
      : null;
  if (!from) return null;
  const previous = countdownTarget(countdown, from);
  return previous && previous < target ? previous : null;
}

/**
 * How far the current wait has come (0–1), for the ring style: through the
 * repeat cycle, or since the countdown was created; a day that has come is full.
 */
export function countdownProgress(countdown: Dated & Pick<Countdown, 'createdTime'>, today: string, target: string): number {
  if (target <= today) return 1;
  const created = localDayClock(countdown.createdTime)?.day ?? null;
  const start = previousOccurrence(countdown, target) ?? created;
  if (!start || start >= target || start > today) return 0;
  return Math.min(1, Math.max(0, dayDiff(start, today) / dayDiff(start, target)));
}

/** For a yearly countdown, the years an occurrence is past its original date (lunar years for lunar ones). */
export function countdownYears(countdown: Dated, target: string): number | null {
  const day = dayOf(countdown.date);
  if (!day || countdown.repeatFlag !== 'yearly') return null;
  const years = isLunarYearly(countdown)
    ? (solarToLunar(target)?.year ?? 0) - (solarToLunar(day)?.year ?? 0)
    : Number(target.slice(0, 4)) - Number(day.slice(0, 4));
  return years > 0 ? years : null;
}

export type CountdownSort = 'date' | 'manual' | 'created';

/**
 * Pinned first. By date: upcoming ones nearest first, then past ones most
 * recent first. Manual: sortOrder. Created: newest first.
 */
export function sortCountdowns(items: Countdown[], sort: CountdownSort, today: string): Countdown[] {
  const targets = new Map(items.map((item) => [item.id, countdownTarget(item, today) ?? '']));
  const created = (item: Countdown) => item.createdTime ?? '';
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'manual') return a.sortOrder - b.sortOrder || created(a).localeCompare(created(b));
    if (sort === 'created') return created(b).localeCompare(created(a));
    const ta = targets.get(a.id)!;
    const tb = targets.get(b.id)!;
    const pastA = ta < today;
    const pastB = tb < today;
    if (pastA !== pastB) return pastA ? 1 : -1;
    return (pastA ? tb.localeCompare(ta) : ta.localeCompare(tb)) || created(a).localeCompare(created(b));
  });
}

/** A one-off countdown whose day has passed (it counts up: "已经 N 天"). */
export function isPastCountdown(countdown: Dated, today: string): boolean {
  const target = countdownTarget(countdown, today);
  return target != null && target < today;
}

/** Sort order that places an item between two neighbours of a manual ordering. */
export function orderBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return 0;
  if (before == null) return after! - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}

export interface CountdownViewPrefs {
  sort: CountdownSort;
  layout: 'cards' | 'list';
  showPast: boolean;
  groupByKind: boolean;
}

export const VIEW_PREFS_KEY = 'ntk_countdown_view';
/** Older builds stored only the group toggle. */
const LEGACY_GROUP_KEY = 'ntk_countdown_groups';

export function parseViewPrefs(raw: string | null, legacyGroups: string | null = null): CountdownViewPrefs {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown>;
  } catch {
    // corrupt prefs: defaults
  }
  return {
    sort: value.sort === 'manual' || value.sort === 'created' ? value.sort : 'date',
    layout: value.layout === 'list' ? 'list' : 'cards',
    showPast: value.showPast !== false,
    groupByKind: typeof value.groupByKind === 'boolean' ? value.groupByKind : legacyGroups === '1',
  };
}

export function readViewPrefs(): CountdownViewPrefs {
  try {
    return parseViewPrefs(localStorage.getItem(VIEW_PREFS_KEY), localStorage.getItem(LEGACY_GROUP_KEY));
  } catch {
    return parseViewPrefs(null);
  }
}

export function saveViewPrefs(prefs: CountdownViewPrefs): void {
  try {
    localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage can be unavailable; the prefs last for this session
  }
}

/** Notes older builds kept in this browser only; moved to the server once (stores/countdowns.ts). */
export const LEGACY_NOTES_KEY = 'ntk_countdown_notes';

export function parseLegacyNotes(raw: string | null): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === 'string' && entry[1].trim() !== ''));
  } catch {
    return {};
  }
}
