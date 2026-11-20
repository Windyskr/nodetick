import { describe, expect, it } from 'vitest';
import {
  LUNAR_MAX_YEAR,
  LUNAR_MIN_YEAR,
  leapMonthOf,
  lunarAnniversary,
  lunarDayName,
  lunarMonthDays,
  lunarMonthName,
  lunarMonthsOf,
  lunarToSolar,
  lunarYearName,
  nextLunarYearly,
  solarToLunar,
} from '../src/lib/lunar';

describe('lunar ↔ solar conversion', () => {
  it('finds the Spring Festival of each year', () => {
    const springFestivals: Record<number, string> = {
      1900: '1900-01-31', 1949: '1949-01-29', 1954: '1954-02-03', 1980: '1980-02-16', 1990: '1990-01-27',
      2000: '2000-02-05', 2008: '2008-02-07', 2012: '2012-01-23', 2020: '2020-01-25', 2021: '2021-02-12',
      2022: '2022-02-01', 2023: '2023-01-22', 2024: '2024-02-10', 2025: '2025-01-29', 2026: '2026-02-17',
      2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03', 2033: '2033-01-31',
      2050: '2050-01-23', 2100: '2100-02-09',
    };
    for (const [year, day] of Object.entries(springFestivals)) {
      expect(lunarToSolar(Number(year), 1, 1), year).toBe(day);
      expect(solarToLunar(day), day).toEqual({ year: Number(year), month: 1, day: 1, leap: false });
    }
    // 除夕 2026 is the 29th: that 腊月 has 29 days.
    expect(solarToLunar('2027-02-05')).toEqual({ year: 2026, month: 12, day: 29, leap: false });
  });

  it("handles 2023's leap second month", () => {
    expect(leapMonthOf(2023)).toBe(2);
    expect(leapMonthOf(2024)).toBe(0);
    expect(lunarMonthsOf(2023).slice(0, 4)).toEqual([
      { month: 1, leap: false }, { month: 2, leap: false }, { month: 2, leap: true }, { month: 3, leap: false },
    ]);
    expect(lunarMonthsOf(2023)).toHaveLength(13);
    expect(solarToLunar('2023-03-21')).toEqual({ year: 2023, month: 2, day: 30, leap: false });
    expect(solarToLunar('2023-03-22')).toEqual({ year: 2023, month: 2, day: 1, leap: true });
    expect(solarToLunar('2023-04-19')).toEqual({ year: 2023, month: 2, day: 29, leap: true });
    expect(solarToLunar('2023-04-20')).toEqual({ year: 2023, month: 3, day: 1, leap: false });
    expect(lunarMonthDays(2023, 2, true)).toBe(29);
    expect(lunarToSolar(2023, 2, 30, true)).toBeNull();
    expect(lunarToSolar(2024, 2, 1, true)).toBeNull();
  });

  it('knows the festivals of 2026', () => {
    expect(lunarToSolar(2026, 1, 15)).toBe('2026-03-03'); // 元宵
    expect(lunarToSolar(2026, 5, 5)).toBe('2026-06-19'); // 端午
    expect(lunarToSolar(2026, 7, 7)).toBe('2026-08-19'); // 七夕
    expect(lunarToSolar(2026, 8, 15)).toBe('2026-09-25'); // 中秋
    expect(lunarToSolar(2026, 9, 9)).toBe('2026-10-18'); // 重阳
    expect(lunarToSolar(2026, 12, 23)).toBe('2027-01-30'); // 小年 (腊月廿三)
    expect(solarToLunar('2026-11-20')).toEqual({ year: 2026, month: 10, day: 12, leap: false });
  });

  it('rejects days outside 1900-01-31…2100-12-31 and impossible dates', () => {
    expect(solarToLunar('1900-01-30')).toBeNull();
    expect(solarToLunar('2101-01-01')).toBeNull();
    expect(solarToLunar('2026-02-30')).toBeNull();
    expect(solarToLunar('not a day')).toBeNull();
    expect(lunarToSolar(1899, 1, 1)).toBeNull();
    expect(lunarToSolar(2026, 13, 1)).toBeNull();
    expect(lunarToSolar(2026, 1, 0)).toBeNull();
  });

  it('round-trips every day from 1900 to 2100', () => {
    let previous = solarToLunar('1900-01-31')!;
    for (let ms = Date.UTC(1900, 1, 1); ms <= Date.UTC(2100, 11, 31); ms += 86400000) {
      const day = new Date(ms).toISOString().slice(0, 10);
      const lunar = solarToLunar(day)!;
      expect(lunarToSolar(lunar.year, lunar.month, lunar.day, lunar.leap)).toBe(day);
      expect(lunar.day === 1 || lunar.day === previous.day + 1).toBe(true);
      previous = lunar;
    }
  });

  it("matches the browser's Chinese calendar at every month start, apart from documented years", () => {
    // ICU lands a day off when a new moon falls within minutes of Beijing
    // midnight (2027-02-06 23:56, 2030-02-03 00:07, 2012-08-17 23:54,
    // 2018-11-08 00:02, …) and disagrees on 1987's leap month and pre-1929 years.
    const disputed = new Set([1917, 1922, 1953, 1954, 1955, 1987, 1998, 2012, 2018, 2026, 2027, 2029, 2030, 2070]);
    const format = new Intl.DateTimeFormat('en-US-u-ca-chinese', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
    if (format.resolvedOptions().calendar !== 'chinese') return; // a runtime without the Chinese calendar
    let months = 0;
    for (let year = LUNAR_MIN_YEAR; year <= LUNAR_MAX_YEAR; year++) {
      if (disputed.has(year)) continue;
      for (const { month, leap } of lunarMonthsOf(year)) {
        const first = lunarToSolar(year, month, 1, leap)!;
        const parts = Object.fromEntries(format.formatToParts(new Date(`${first}T00:00:00Z`)).map((part) => [part.type, part.value]));
        expect(`${parts.relatedYear}-${parts.month}-${parts.day}`, first).toBe(`${year}-${month}${leap ? 'bis' : ''}-1`);
        months++;
      }
    }
    expect(months).toBeGreaterThan(2300);
  });
});

describe('lunar anniversaries', () => {
  it('repeats on the lunar date, leap months and 30ths falling back', () => {
    expect(nextLunarYearly('1990-10-03', '2026-11-20')).toBe(lunarToSolar(2027, 8, 15)); // 中秋 1990 → 2027
    expect(nextLunarYearly('1990-10-03', '2026-09-25')).toBe('2026-09-25');
    expect(nextLunarYearly('2030-01-01', '2026-11-20')).toBe('2030-01-01'); // not started yet
    // Born in 闰二月 2023: the regular 二月 in years without that leap month.
    expect(nextLunarYearly('2023-03-22', '2023-04-01')).toBe(lunarToSolar(2024, 2, 1));
    expect(lunarAnniversary({ year: 2023, month: 2, day: 1, leap: true }, 2023)).toBe('2023-03-22');
    // 除夕 of lunar 2023 is 腊月三十 (2024-02-09); 腊月 2024 has 29 days, so it falls on 廿九.
    expect(solarToLunar('2024-02-09')).toEqual({ year: 2023, month: 12, day: 30, leap: false });
    expect(lunarMonthDays(2024, 12)).toBe(29);
    expect(nextLunarYearly('2024-02-09', '2024-03-01')).toBe('2025-01-28');
    expect(solarToLunar('2025-01-28')).toEqual({ year: 2024, month: 12, day: 29, leap: false });
    expect(nextLunarYearly('2100-06-01', '2100-12-01')).toBeNull(); // past the table
  });
});

describe('lunar names', () => {
  it('names months, days and years the traditional way', () => {
    expect([1, 2, 10, 11, 12].map((month) => lunarMonthName(month))).toEqual(['正月', '二月', '十月', '冬月', '腊月']);
    expect(lunarMonthName(2, true)).toBe('闰二月');
    expect([1, 9, 10, 11, 15, 19, 20, 21, 23, 29, 30].map(lunarDayName)).toEqual(
      ['初一', '初九', '初十', '十一', '十五', '十九', '二十', '廿一', '廿三', '廿九', '三十'],
    );
    expect(lunarDayName(31)).toBe('');
    expect([1984, 2023, 2026, 1900].map(lunarYearName)).toEqual(['甲子', '癸卯', '丙午', '庚子']);
  });
});
