import { describe, expect, it } from 'vitest';
import { findQuickDateToken, parseQuickAdd } from '../src/lib/quickParse';

// Friday 2026-11-20, 10:00 local time.
const NOW = new Date(2026, 10, 20, 10, 0);
const zh = (text: string) => {
  const token = findQuickDateToken(text, 'zh', NOW);
  return token && { text: token.text, dueDate: token.dueDate, time: token.time, repeat: token.repeat };
};
const en = (text: string) => {
  const token = findQuickDateToken(text, 'en', NOW);
  return token && { text: token.text, dueDate: token.dueDate, time: token.time, repeat: token.repeat };
};

describe('Chinese times', () => {
  it('reads a date with a time of day', () => {
    expect(zh('明天下午3点开会')).toEqual({ text: '明天下午3点', dueDate: '2026-11-21', time: '15:00', repeat: undefined });
    expect(zh('周五下午两点复盘')).toMatchObject({ dueDate: '2026-11-27', time: '14:00' });
    expect(zh('后天上午10:30面试')).toMatchObject({ dueDate: '2026-11-22', time: '10:30' });
    expect(zh('12月25日晚上8点半')).toMatchObject({ dueDate: '2026-12-25', time: '20:30' });
  });

  it('puts a lone time today, or tomorrow once it has passed', () => {
    expect(zh('下午3点半交报告')).toMatchObject({ text: '下午3点半', dueDate: '2026-11-20', time: '15:30' });
    expect(zh('早上8点跑步')).toMatchObject({ dueDate: '2026-11-21', time: '08:00' });
    expect(zh('今晚8点看电影')).toMatchObject({ dueDate: '2026-11-20', time: '20:00' });
    expect(zh('明晚七点')).toMatchObject({ dueDate: '2026-11-21', time: '19:00' });
    expect(zh('中午12点')).toMatchObject({ time: '12:00' });
    expect(zh('三点一刻')).toMatchObject({ time: '15:15' });
  });

  it('reads 1–6 o\'clock without a period word as the afternoon', () => {
    expect(zh('3点开会')).toMatchObject({ dueDate: '2026-11-20', time: '15:00' });
    expect(zh('凌晨3点')).toMatchObject({ dueDate: '2026-11-21', time: '03:00' });
    expect(zh('9点开会')).toMatchObject({ dueDate: '2026-11-21', time: '09:00' });
  });

  it('rejects impossible times', () => {
    expect(zh('25点')).toBeNull();
    expect(zh('3点70分')).toBeNull();
  });
});

describe('Chinese dates', () => {
  it('counts weeks from Monday', () => {
    expect(zh('下周三')).toMatchObject({ dueDate: '2026-11-25' });
    expect(zh('下周日')).toMatchObject({ dueDate: '2026-11-29' });
    expect(zh('本周日')).toMatchObject({ dueDate: '2026-11-22' });
    expect(zh('周末')).toMatchObject({ dueDate: '2026-11-21' });
    expect(zh('星期一')).toMatchObject({ dueDate: '2026-11-23' });
  });

  it('reads relative and month dates', () => {
    expect(zh('3天后')).toMatchObject({ dueDate: '2026-11-23' });
    expect(zh('三天后')).toMatchObject({ dueDate: '2026-11-23' });
    expect(zh('两周后')).toMatchObject({ dueDate: '2026-12-04' });
    expect(zh('下个月5号')).toMatchObject({ dueDate: '2026-12-05' });
    expect(zh('1月1日')).toMatchObject({ dueDate: '2027-01-01' });
    expect(zh('大后天')).toMatchObject({ dueDate: '2026-11-23' });
  });
});

describe('Chinese repeats', () => {
  it('builds rules and finds the first occurrence', () => {
    expect(zh('每天早上8点跑步')).toEqual({ text: '每天早上8点', dueDate: '2026-11-21', time: '08:00', repeat: 'RRULE:FREQ=DAILY' });
    expect(zh('每周一例会')).toMatchObject({ dueDate: '2026-11-23', repeat: 'RRULE:FREQ=WEEKLY;BYDAY=MO' });
    expect(zh('每周一、三、五健身')).toMatchObject({ dueDate: '2026-11-20', repeat: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR' });
    expect(zh('每周五下午4点')).toMatchObject({ dueDate: '2026-11-20', time: '16:00' });
    expect(zh('每个工作日')).toMatchObject({ dueDate: '2026-11-20', repeat: 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR' });
    expect(zh('每月15号交房租')).toMatchObject({ dueDate: '2026-12-15', repeat: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15' });
    expect(zh('每年3月8日')).toMatchObject({ dueDate: '2027-03-08', repeat: 'RRULE:FREQ=YEARLY' });
    expect(zh('每周')).toMatchObject({ dueDate: '2026-11-20', repeat: 'RRULE:FREQ=WEEKLY;BYDAY=FR' });
  });

  it('reads intervals; 每隔一天 is every other day', () => {
    expect(zh('每隔一天浇花')).toMatchObject({ dueDate: '2026-11-20', repeat: 'RRULE:FREQ=DAILY;INTERVAL=2' });
    expect(zh('每3天')).toMatchObject({ repeat: 'RRULE:FREQ=DAILY;INTERVAL=3' });
    expect(zh('每2周')).toMatchObject({ dueDate: '2026-11-20', repeat: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR' });
    expect(zh('每两个月')).toMatchObject({ repeat: 'RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=20' });
  });
});

describe('English', () => {
  it('reads dates with times', () => {
    expect(en('call mom tomorrow at 3pm')).toEqual({ text: 'tomorrow at 3pm', dueDate: '2026-11-21', time: '15:00', repeat: undefined });
    expect(en('3pm tomorrow call mom')).toMatchObject({ dueDate: '2026-11-21', time: '15:00' });
    expect(en('meeting 10:30')).toMatchObject({ dueDate: '2026-11-20', time: '10:30' });
    expect(en('breakfast 8am')).toMatchObject({ dueDate: '2026-11-21', time: '08:00' });
    expect(en('movie tonight 8pm')).toMatchObject({ dueDate: '2026-11-20', time: '20:00' });
    expect(en('lunch at noon')).toMatchObject({ time: '12:00' });
  });

  it('reads weekdays, months and relative dates', () => {
    expect(en('review next friday')).toMatchObject({ dueDate: '2026-11-27' });
    expect(en('review in 2 weeks')).toMatchObject({ dueDate: '2026-12-04' });
    expect(en('party dec 31')).toMatchObject({ dueDate: '2026-12-31' });
    expect(en('party 31st december')).toMatchObject({ dueDate: '2026-12-31' });
    expect(en('dentist 5/20')).toMatchObject({ dueDate: '2027-05-20' });
  });

  it('builds repeat rules', () => {
    expect(en('standup every weekday at 9am')).toMatchObject({ dueDate: '2026-11-23', time: '09:00', repeat: 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR' });
    expect(en('gym every monday and thursday')).toMatchObject({ dueDate: '2026-11-23', repeat: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH' });
    expect(en('pay rent monthly')).toMatchObject({ dueDate: '2026-11-20', repeat: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=20' });
    expect(en('water plants every 3 days')).toMatchObject({ repeat: 'RRULE:FREQ=DAILY;INTERVAL=3' });
    expect(en('sync every other week')).toBeNull();
  });

  it('needs whole words', () => {
    expect(en('todays plan')).toBeNull();
    expect(en('mayor visit')).toBeNull();
  });
});

describe('parseQuickAdd with times and repeats', () => {
  it('strips the phrase and returns time and repeat with tags and priority', () => {
    const parsed = parseQuickAdd('每周一早上9点例会 #工作 !高', 'zh');
    expect(parsed.title).toBe('例会');
    expect(parsed.tags).toEqual(['工作']);
    expect(parsed.priority).toBe(5);
    expect(parsed.time).toBe('09:00');
    expect(parsed.repeat).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });
});
