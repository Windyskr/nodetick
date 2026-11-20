import { describe, expect, it } from 'vitest';
import {
  changeRatio,
  durationTicks,
  heatLevel,
  heatmapRange,
  heatmapWeeks,
  isCurrentPeriod,
  peakHour,
  periodOf,
  shiftPeriod,
  totalOf,
  trendBuckets,
} from '../src/lib/focusPeriods';

describe('focus stat periods', () => {
  it('finds the day, week (Sunday first), month and year around a day', () => {
    expect(periodOf('day', '2026-11-20')).toEqual({ kind: 'day', from: '2026-11-20', to: '2026-11-20' });
    expect(periodOf('week', '2026-11-20')).toEqual({ kind: 'week', from: '2026-11-15', to: '2026-11-21' });
    expect(periodOf('week', '2026-11-15')).toEqual({ kind: 'week', from: '2026-11-15', to: '2026-11-21' });
    expect(periodOf('month', '2028-02-10')).toEqual({ kind: 'month', from: '2028-02-01', to: '2028-02-29' });
    expect(periodOf('year', '2026-11-20')).toEqual({ kind: 'year', from: '2026-01-01', to: '2026-12-31' });
  });

  it('steps to neighbouring periods across month and year ends', () => {
    expect(shiftPeriod(periodOf('day', '2026-03-01'), -1).from).toBe('2026-02-28');
    expect(shiftPeriod(periodOf('week', '2026-12-31'), 1)).toMatchObject({ from: '2027-01-03', to: '2027-01-09' });
    expect(shiftPeriod(periodOf('month', '2026-01-31'), -1)).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    expect(shiftPeriod(periodOf('month', '2026-12-05'), 1)).toMatchObject({ from: '2027-01-01', to: '2027-01-31' });
    expect(shiftPeriod(periodOf('year', '2026-06-01'), -1)).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(isCurrentPeriod(periodOf('week', '2026-11-20'), '2026-11-21')).toBe(true);
    expect(isCurrentPeriod(periodOf('month', '2026-10-20'), '2026-11-21')).toBe(false);
  });

  it('builds trend bars for each view', () => {
    const days = [
      { day: '2026-11-14', pomoCount: 1, seconds: 1500 },
      { day: '2026-11-20', pomoCount: 2, seconds: 3000 },
      { day: '2026-02-03', pomoCount: 4, seconds: 6000 },
    ];
    const lastSeven = trendBuckets(periodOf('day', '2026-11-20'), days);
    expect(lastSeven.map((b) => b.key)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
    expect(lastSeven[0].seconds).toBe(1500);
    expect(trendBuckets(periodOf('week', '2026-11-20'), days).map((b) => b.seconds)).toEqual([0, 0, 0, 0, 0, 3000, 0]);
    expect(trendBuckets(periodOf('month', '2026-11-20'), days)).toHaveLength(30);
    const months = trendBuckets(periodOf('year', '2026-11-20'), days);
    expect(months.map((b) => b.key)).toHaveLength(12);
    expect(months[1]).toEqual({ key: '2026-02', seconds: 6000, pomoCount: 4 });
    expect(months[10]).toEqual({ key: '2026-11', seconds: 4500, pomoCount: 3 });
    expect(totalOf(days, '2026-11-15', '2026-11-21')).toEqual({ seconds: 3000, pomoCount: 2 });
  });

  it('lays out 53 Sunday-first weeks for the heatmap', () => {
    const range = heatmapRange(periodOf('year', '2026-04-01'));
    expect(range).toEqual({ from: '2025-12-28', to: '2027-01-02' });
    const weeks = heatmapWeeks(range.from, range.to, [{ day: '2026-01-01', pomoCount: 3, seconds: 5000 }], { from: '2026-01-01', to: '2026-12-31' });
    expect(weeks).toHaveLength(53);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toMatchObject({ day: '2025-12-28', outside: true });
    expect(weeks[0][4]).toMatchObject({ day: '2026-01-01', seconds: 5000, level: 2, outside: false });
    expect(weeks[52][6]).toMatchObject({ day: '2027-01-02', outside: true });
    expect([0, 1, 3599, 3600, 7200, 14_400].map(heatLevel)).toEqual([0, 1, 1, 2, 3, 4]);
  });

  it('picks round duration ticks, changes and the best hour', () => {
    expect(durationTicks(0)).toEqual([0, 60]);
    expect(durationTicks(1500)).toEqual([0, 600, 1200, 1800]);
    expect(durationTicks(12_000)).toEqual([0, 3600, 7200, 10_800, 14_400]);
    expect(durationTicks(100 * 3600).length).toBeLessThanOrEqual(5);
    expect(changeRatio(150, 100)).toBe(0.5);
    expect(changeRatio(50, 100)).toBe(-0.5);
    expect(changeRatio(10, 0)).toBeNull();
    expect(changeRatio(0, 0)).toBe(0);
    const hours = Array(24).fill(0);
    hours[9] = 1800;
    hours[14] = 2400;
    expect(peakHour(hours)).toBe(14);
    expect(peakHour(Array(24).fill(0))).toBeNull();
  });
});
