import { useI18n, useT, useTF, type Key } from '../../i18n';
import type { Countdown } from '../../lib/types';
import { lunarDayName, lunarMonthName, solarToLunar, type LunarDate } from '../../lib/lunar';
import { isLunarYearly, REMINDER_TOKENS, type CountdownKind, type ReminderToken, type Span } from '../../lib/countdown';

export const KIND_KEY: Record<CountdownKind, Key> = {
  countdown: 'countdownKind_countdown',
  anniversary: 'countdownKind_anniversary',
  birthday: 'countdownKind_birthday',
  holiday: 'countdownKind_holiday',
};
export const KIND_ICON: Record<CountdownKind, string> = { countdown: '⏳', anniversary: '💞', birthday: '🎂', holiday: '🎉' };

export const REMINDER_KEY: Record<ReminderToken, Key> = {
  'same-day': 'countdownRemindSameDay',
  '1-day': 'countdownRemind1Day',
  '2-days': 'countdownRemind2Days',
  '3-days': 'countdownRemind3Days',
  '1-week': 'countdownRemind1Week',
  '1-month': 'countdownRemind1Month',
};

export const STYLE_KEYS: Key[] = ['countdownStyleClassic', 'countdownStyleSolid', 'countdownStyleCalendar', 'countdownStyleSoft', 'countdownStyleRing'];

export const COUNTDOWN_COLORS = ['#4772FA', '#E5484D', '#F76B15', '#F59E0B', '#43A047', '#14B8A6', '#22A6C7', '#3B82F6', '#6366F1', '#8B5CF6', '#D946EF', '#EC4899', '#A0785A', '#64748B'];

/** The icon a countdown shows: its own, else its kind's. */
export const countdownIcon = (countdown: Pick<Countdown, 'icon' | 'kind'>) => countdown.icon || KIND_ICON[countdown.kind];

/** Split a translated template around {0} so the number can be styled on its own. */
export function templateParts(template: string): [string, string] {
  const index = template.indexOf('{0}');
  return index < 0 ? [template, ''] : [template.slice(0, index), template.slice(index + 3)];
}

/** Localized labels for countdown values, in the current UI language. */
export function useCountdownText() {
  const t = useT();
  const f = useTF();
  const lang = useI18n((state) => state.lang);
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const lunar = (value: LunarDate | null) => value
    ? f(value.leap ? 'countdownLunarLeapDate' : 'countdownLunarDate', value.month, value.day, lunarMonthName(value.month, value.leap), lunarDayName(value.day))
    : '';
  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(new Date(`${day}T00:00:00Z`));
  const monthStyle = lang === 'zh' ? 'long' : 'short';
  const date = (day: string, weekday = false) =>
    format(day, { year: 'numeric', month: monthStyle, day: 'numeric', ...(weekday ? { weekday: 'short' as const } : {}) });
  return {
    t,
    f,
    lang,
    /** 2026年12月25日 / Dec 25, 2026, optionally with the weekday. */
    date,
    /** 2026年12月 / Dec 2026 */
    month: (day: string) => format(day, { year: 'numeric', month: monthStyle }),
    weekday: (day: string) => format(day, { weekday: 'short' }),
    /** 农历八月十五 / Lunar 8/15 */
    lunar,
    lunarOf: (day: string) => lunar(solarToLunar(day)),
    /** The day a card names: the lunar date for lunar countdowns, else the solar one. */
    dayLabel: (countdown: Pick<Countdown, 'lunar'>, day: string) => {
      const value = countdown.lunar ? solarToLunar(day) : null;
      return value ? lunar(value) : date(day);
    },
    unit: (count: number, workdays: boolean) => t(workdays
      ? Math.abs(count) === 1 ? 'countdownWorkdayUnit' : 'countdownWorkdaysUnit'
      : Math.abs(count) === 1 ? 'countdownDayUnit' : 'countdownDaysUnit'),
    repeat: (countdown: Pick<Countdown, 'date' | 'repeatFlag' | 'lunar'>) => !countdown.repeatFlag
      ? t('countdownRepeatNone')
      : isLunarYearly(countdown) ? t('countdownLunarYearly')
        : countdown.repeatFlag === 'yearly' ? t('countdownYearly')
          : countdown.repeatFlag === 'monthly' ? t('countdownMonthly') : countdown.repeatFlag,
    /** 当天、提前1天 · 09:00, or 无 / None. */
    reminders: (countdown: Pick<Countdown, 'reminders' | 'reminderTime'>, allDayTime: string) => {
      const labels = REMINDER_TOKENS.filter((token) => countdown.reminders.includes(token)).map((token) => t(REMINDER_KEY[token]));
      return labels.length ? `${labels.join(t('countdownListSeparator'))} · ${countdown.reminderTime ?? allDayTime}` : t('reminderNone');
    },
    /** 1年 2个月 3天 / 1y 2m 3d (zero parts left out). */
    span: (value: Span) => {
      const parts: string[] = [];
      if (value.years) parts.push(`${value.years}${t('countdownYears')}`);
      if (value.months) parts.push(`${value.months}${t('countdownMonths')}`);
      if (value.days || !parts.length) parts.push(`${value.days}${t('countdownDaysShort')}`);
      return parts.join(' ');
    },
  };
}
