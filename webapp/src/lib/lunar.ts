/**
 * Chinese lunisolar calendar for lunar years 1900–2100: lunar-dated
 * countdowns (农历生日、纪念日、节日) and the calendar's lunar day labels.
 * The worker has the same table in worker/src/lunar.ts (reminders); keep
 * both in sync.
 *
 * One entry per lunar year (Hong Kong Observatory data, as in calendar.js):
 * bits 0–3 leap month (0 = none), bits 15…4 months 1…12 (1 = 30 days,
 * 0 = 29), bit 16 the leap month has 30 days. The browser's Chinese calendar
 * (Intl `ca-chinese`) is a day off whenever a new moon falls within minutes
 * of Beijing midnight (Spring Festival 2027 and 2030, 七月初一 2012, …).
 */
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090
  0x0d520, // 2100
];

export const LUNAR_MIN_YEAR = 1900;
export const LUNAR_MAX_YEAR = 2100;
/** Solar dates the table covers: 正月初一 1900 to the last day of 2100. */
export const LUNAR_FIRST_DAY = '1900-01-31';
export const LUNAR_LAST_DAY = '2100-12-31';

export interface LunarDate {
  year: number;
  month: number;
  day: number;
  leap: boolean;
}

const DAY_MS = 86400000;

function info(year: number): number | undefined {
  return Number.isInteger(year) ? LUNAR_INFO[year - LUNAR_MIN_YEAR] : undefined;
}

/** The leap month of a lunar year (闰几月), 0 when it has none. */
export function leapMonthOf(year: number): number {
  return (info(year) ?? 0) & 0xf;
}

/** Days in a lunar month (29 or 30); 0 when the year has no such month. */
export function lunarMonthDays(year: number, month: number, leap = false): number {
  const data = info(year);
  if (data === undefined || !Number.isInteger(month) || month < 1 || month > 12) return 0;
  if (leap) return (data & 0xf) === month ? (data & 0x10000 ? 30 : 29) : 0;
  return data & (0x10000 >> month) ? 30 : 29;
}

function lunarYearDays(year: number): number {
  let total = 0;
  for (let month = 1; month <= 12; month++) total += lunarMonthDays(year, month);
  const leap = leapMonthOf(year);
  return leap ? total + lunarMonthDays(year, leap, true) : total;
}

/** Day number (days since 1970-01-01) of each lunar year's 正月初一, 1900…2101. */
const YEAR_START: number[] = (() => {
  const starts = [Date.UTC(1900, 0, 31) / DAY_MS];
  for (let year = LUNAR_MIN_YEAR; year <= LUNAR_MAX_YEAR; year++) starts.push(starts[starts.length - 1] + lunarYearDays(year));
  return starts;
})();

function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(ms).toISOString().slice(0, 10) === day ? ms / DAY_MS : null;
}

/** The lunar date of a solar YYYY-MM-DD, or null outside 1900-01-31…2100-12-31. */
export function solarToLunar(day: string): LunarDate | null {
  const value = dayNumber(day);
  if (value == null || day < LUNAR_FIRST_DAY || day > LUNAR_LAST_DAY) return null;
  let year = LUNAR_MIN_YEAR;
  while (YEAR_START[year - LUNAR_MIN_YEAR + 1] <= value) year++;
  let offset = value - YEAR_START[year - LUNAR_MIN_YEAR];
  const leap = leapMonthOf(year);
  for (let month = 1; month <= 12; month++) {
    const regular = lunarMonthDays(year, month);
    if (offset < regular) return { year, month, day: offset + 1, leap: false };
    offset -= regular;
    if (month === leap) {
      const leapDays = lunarMonthDays(year, month, true);
      if (offset < leapDays) return { year, month, day: offset + 1, leap: true };
      offset -= leapDays;
    }
  }
  return null;
}

/** The solar YYYY-MM-DD of a lunar date, or null when it does not exist. */
export function lunarToSolar(year: number, month: number, day: number, leap = false): string | null {
  const length = lunarMonthDays(year, month, leap);
  if (!length || !Number.isInteger(day) || day < 1 || day > length) return null;
  let offset = YEAR_START[year - LUNAR_MIN_YEAR];
  const leapMonth = leapMonthOf(year);
  for (let m = 1; m < month; m++) {
    offset += lunarMonthDays(year, m);
    if (m === leapMonth) offset += lunarMonthDays(year, m, true);
  }
  if (leap) offset += lunarMonthDays(year, month);
  return new Date((offset + day - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The anniversary of a lunar date in lunar year `year`: a leap-month date
 * (闰月) falls in that year's leap month when it has the same one, else in
 * the regular month; a 30th falls on the 29th in a 29-day month.
 */
export function lunarAnniversary(original: LunarDate, year: number): string | null {
  if (year < LUNAR_MIN_YEAR || year > LUNAR_MAX_YEAR) return null;
  const leap = original.leap && leapMonthOf(year) === original.month;
  return lunarToSolar(year, original.month, Math.min(original.day, lunarMonthDays(year, original.month, leap)), leap);
}

/** Next anniversary on or after `today` of a lunar-yearly date (solar `date`), null past 2100. */
export function nextLunarYearly(date: string, today: string): string | null {
  if (date >= today) return date;
  const original = solarToLunar(date);
  const current = solarToLunar(today);
  if (!original || !current) return null;
  for (const year of [current.year, current.year + 1]) {
    const day = lunarAnniversary(original, year);
    if (day && day >= today) return day;
  }
  return null;
}

/** The months of a lunar year in calendar order, the leap month after its namesake. */
export function lunarMonthsOf(year: number): { month: number; leap: boolean }[] {
  const leap = leapMonthOf(year);
  const months: { month: number; leap: boolean }[] = [];
  for (let month = 1; month <= 12; month++) {
    months.push({ month, leap: false });
    if (month === leap) months.push({ month, leap: true });
  }
  return months;
}

const MONTH_NAMES = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';

/** 正月 … 冬月, 腊月; 闰二月 for a leap month. */
export function lunarMonthName(month: number, leap = false): string {
  return (leap ? '闰' : '') + (MONTH_NAMES[month - 1] ?? '');
}

/** 初一 … 初十, 十一 … 二十, 廿一 … 三十. */
export function lunarDayName(day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > 30) return '';
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  return ['初', '十', '廿'][Math.floor(day / 10)] + DIGITS[day % 10];
}

/** The sexagenary (干支) name of a lunar year: 2026 → 丙午. */
export function lunarYearName(year: number): string {
  const index = (((year - 4) % 60) + 60) % 60;
  return STEMS[index % 10] + BRANCHES[index % 12];
}
