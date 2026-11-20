import { describe, expect, it } from 'vitest';
import { dictionaries, type Key, type Lang } from '../src/i18n';
import { describeRepeat, parseRepeat } from '../src/lib/repeat';

const translator = (lang: Lang) => (key: Key, ...args: (string | number)[]) =>
  args.reduce<string>((text, arg, i) => text.replaceAll(`{${i}}`, String(arg)), dictionaries[lang][key]);
const en = (flag: string | null) => describeRepeat(flag, 'en', translator('en'));
const zh = (flag: string | null) => describeRepeat(flag, 'zh', translator('zh'));

describe('describeRepeat', () => {
  it('keeps the menu labels for the rules the menu creates', () => {
    expect(zh(null)).toBe('不重复');
    expect(zh('RRULE:FREQ=DAILY')).toBe('每天');
    expect(zh('RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR')).toBe('每个工作日');
    expect(zh('RRULE:FREQ=WEEKLY;BYDAY=MO,WE')).toBe('每周');
    expect(zh('RRULE:FREQ=MONTHLY')).toBe('每月');
    expect(en('RRULE:FREQ=YEARLY')).toBe('Yearly');
    expect(en('RRULE:FREQ=HOURLY')).toBe('Set');
    expect(en('not a rule')).toBe('Set');
  });

  it('names intervals', () => {
    expect(zh('RRULE:FREQ=DAILY;INTERVAL=3')).toBe('每3天');
    expect(en('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toBe('Every 2 weeks');
    expect(zh('RRULE:FREQ=MONTHLY;INTERVAL=6')).toBe('每6个月');
    expect(en('RRULE:FREQ=YEARLY;INTERVAL=2')).toBe('Every 2 years');
  });

  it('names nth-weekday rules in both encodings', () => {
    expect(zh('RRULE:FREQ=MONTHLY;BYDAY=2TU')).toBe('每月第2个周二');
    expect(en('RRULE:FREQ=MONTHLY;BYDAY=2TU')).toBe('Monthly on the 2nd Tuesday');
    expect(en('RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2')).toBe('Monthly on the 2nd Tuesday');
    expect(zh('RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR')).toBe('每2个月最后一个周五');
    expect(en('RRULE:FREQ=MONTHLY;BYDAY=-1FR')).toBe('Monthly on the last Friday');
    expect(en('RRULE:FREQ=MONTHLY;BYDAY=-2MO')).toBe('Monthly on the 2nd-to-last Monday');
    expect(en('RRULE:FREQ=MONTHLY;BYDAY=3WE')).toBe('Monthly on the 3rd Wednesday');
    expect(zh('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH')).toBe('每年11月第4个周四');
    expect(en('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH')).toBe('Yearly on the 4th Thursday of November');
    expect(zh('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1')).toBe('每月最后一天');
    // Combinations without a short name fall back to the period.
    expect(zh('RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13')).toBe('每月');
  });

  it('adds the end of the series', () => {
    expect(zh('RRULE:FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270131')).toBe('每月第2个周二，至2027年1月31日');
    expect(en('RRULE:FREQ=DAILY;UNTIL=20270131T155959Z')).toBe('Daily, until Jan 31, 2027');
    expect(zh('RRULE:FREQ=WEEKLY;COUNT=3')).toBe('每周，还剩3次');
    expect(en('RRULE:FREQ=WEEKLY;COUNT=1')).toBe('Weekly, last time');
  });
});

describe('parseRepeat', () => {
  it('reads the parts the label needs', () => {
    expect(parseRepeat('rrule:freq=monthly;interval=2;byday=+2tu;bysetpos=-1;until=20270131;count=4')).toEqual({
      freq: 'MONTHLY',
      interval: 2,
      byDay: [{ weekday: 2, nth: 2 }],
      byMonthDay: [],
      byMonth: [],
      bySetPos: [-1],
      until: '2027-01-31',
      count: 4,
    });
    expect(parseRepeat('INTERVAL=2')).toBeNull();
  });
});
