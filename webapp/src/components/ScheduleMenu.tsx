import { useState, type ReactNode } from 'react';
import {
  Bell,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Moon,
  Repeat,
  Sun,
  Sunrise,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, useT } from '../i18n';
import {
  addDays,
  allDayDate,
  dateTimeParts,
  localDateTime,
  todayStr,
} from './taskSchedule';

export interface TaskSchedule {
  startDate: string | null;
  dueDate: string | null;
  isAllDay: boolean;
  reminders?: string[];
  repeatFlag?: string | null;
}

interface ScheduleMenuProps {
  startDate: string | null;
  dueDate: string | null;
  isAllDay: boolean;
  reminders?: string[];
  repeatFlag?: string | null;
  onSave: (schedule: TaskSchedule) => void;
}

type Tab = 'date' | 'range';
type ExpandedOption = 'reminder' | 'repeat' | null;

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
};
const WEEKDAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['日', '一', '二', '三', '四', '五', '六'],
};

/** RRULE weekday codes in Monday-first display order. */
const REPEAT_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
/** JS getDay() index (Sun=0) → RRULE code. */
const DAY_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Human label for any stored repeat rule the menu can produce. */
function describeRepeat(
  flag: string | null | undefined,
  label: (key: 'repeatNone' | 'repeatDaily' | 'repeatWeekly' | 'repeatWeekdays' | 'repeatMonthly' | 'repeatYearly' | 'repeatSet') => string,
): string {
  if (!flag) return label('repeatNone');
  const body = flag.replace(/^RRULE:/i, '').toUpperCase();
  const parts = new Map(body.split(';').map((p) => p.split('=') as [string, string]));
  const freq = parts.get('FREQ');
  const byDay = parts.get('BYDAY')?.split(',').filter(Boolean) ?? [];
  if (freq === 'DAILY') {
    if (byDay.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => byDay.includes(d))) return label('repeatWeekdays');
    return label('repeatDaily');
  }
  if (freq === 'WEEKLY') return label('repeatWeekly');
  if (freq === 'MONTHLY') return label('repeatMonthly');
  if (freq === 'YEARLY') return label('repeatYearly');
  return label('repeatSet');
}

function weeklyFlag(days: string[]): string {
  const ordered = REPEAT_CODES.filter((code) => days.includes(code));
  return `RRULE:FREQ=WEEKLY;BYDAY=${ordered.join(',')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function monthGrid(year: number, month0: number): string[] {
  const first = new Date(year, month0, 1);
  const start = new Date(year, month0, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  });
}

function parseMonth(day: string): { year: number; month0: number } {
  const [year, month] = day.split('-').map(Number);
  return { year, month0: month - 1 };
}

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** TickTick-style date, all-day, time-range, reminder, and repeat editor. */
export function ScheduleMenu({
  startDate,
  dueDate,
  isAllDay: initialAllDay,
  reminders: initialReminders = [],
  repeatFlag: initialRepeatFlag = null,
  onSave,
}: ScheduleMenuProps) {
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const today = todayStr();
  const start = dateTimeParts(startDate, initialAllDay);
  const end = dateTimeParts(dueDate, initialAllDay);
  const initialDay = end.date || start.date || today;
  const initialMonth = parseMonth(initialDay);
  const [tab, setTab] = useState<Tab>(startDate && dueDate ? 'range' : 'date');
  const [cursor, setCursor] = useState(initialMonth);
  const [allDay, setAllDay] = useState(initialAllDay);
  const [startDay, setStartDay] = useState(start.date);
  const [startClock, setStartClock] = useState(start.time);
  const [endDay, setEndDay] = useState(end.date);
  const [endClock, setEndClock] = useState(end.time);
  const [reminders, setReminders] = useState(initialReminders);
  const [repeatFlag, setRepeatFlag] = useState(initialRepeatFlag);
  const [weeklyPicker, setWeeklyPicker] = useState(false);
  const [weeklyDays, setWeeklyDays] = useState<string[]>(() => {
    const match = /^RRULE:FREQ=WEEKLY;BYDAY=(.+)$/i.exec(initialRepeatFlag ?? '');
    return match ? match[1].split(',').filter((code) => (REPEAT_CODES as readonly string[]).includes(code)) : [];
  });
  const [expanded, setExpanded] = useState<ExpandedOption>(null);
  const [error, setError] = useState('');

  const selectedDay = endDay || startDay || today;
  const grid = monthGrid(cursor.year, cursor.month0);

  const chooseDay = (day: string) => {
    setEndDay(day);
    setError('');
  };

  const quickDay = (kind: 'today' | 'tomorrow' | 'nextWeek' | 'tonight' | 'clear') => {
    if (kind === 'clear') {
      setStartDay('');
      setEndDay('');
      setStartClock('');
      setEndClock('');
      setAllDay(false);
      return;
    }
    const day = kind === 'today' ? today : kind === 'tomorrow' ? addDays(today, 1) : kind === 'nextWeek' ? addDays(today, 7) : today;
    setStartDay('');
    setEndDay(day);
    setError('');
    if (kind === 'tonight') {
      setAllDay(false);
      setStartClock('');
      setEndClock('20:00');
    } else {
      setAllDay(true);
      setStartClock('');
      setEndClock('');
    }
    setCursor(parseMonth(day));
  };

  const save = () => {
    setError('');
    const startValue = allDay
      ? (startDay ? allDayDate(startDay) : null)
      : (startDay || startClock ? localDateTime(startDay, startClock) : null);
    const endValue = allDay
      ? (endDay ? allDayDate(endDay) : null)
      : (endDay || endClock ? localDateTime(endDay, endClock) : null);

    if (!allDay) {
      const incomplete = (startDay && !startClock) || (!startDay && startClock) ||
        (endDay && !endClock) || (!endDay && endClock);
      if (incomplete || (startDay && !startValue) || (endDay && !endValue)) {
        setError(t('scheduleIncomplete'));
        return;
      }
    }
    if (startValue && endValue && Date.parse(endValue) < Date.parse(startValue)) {
      setError(t('scheduleEndBeforeStart'));
      return;
    }
    onSave({ startDate: startValue, dueDate: endValue, isAllDay: allDay, reminders, repeatFlag });
  };

  const clear = () => onSave({ startDate: null, dueDate: null, isAllDay: false });

  const enableTime = () => {
    setAllDay(false);
    if (!endDay) setEndDay(selectedDay);
    if (!endClock) setEndClock('09:00');
  };

  const reminderLabel = reminders.length === 0
    ? t('reminderNone')
    : reminders[0] === 'TRIGGER:-PT0M'
      ? t('reminderOnTime')
      : reminders[0] === 'TRIGGER:-PT15M'
        ? t('reminder15m')
        : reminders[0] === 'TRIGGER:-PT1H'
          ? t('reminder1h')
          : t('reminderSet');
  const repeatLabel = describeRepeat(repeatFlag, t);

  return (
    <div className="w-[360px] max-w-[calc(100vw-24px)] p-3" onClick={(event) => event.stopPropagation()}>
      <div className="flex rounded-xl bg-[#f3f3f3] p-1">
        <TabButton active={tab === 'date'} label={t('dateTab')} onClick={() => setTab('date')} />
        <TabButton active={tab === 'range'} label={t('rangeTab')} onClick={() => setTab('range')} />
      </div>

      {tab === 'date' ? (
        <>
          <div className="mt-4 grid grid-cols-5 gap-1">
            <QuickButton icon={Sun} title={t('relToday')} onClick={() => quickDay('today')} />
            <QuickButton icon={Sunrise} title={t('relTomorrow')} onClick={() => quickDay('tomorrow')} />
            <QuickButton icon={CalendarPlus} title={t('nextWeek')} onClick={() => quickDay('nextWeek')} />
            <QuickButton icon={Moon} title={t('tonight')} onClick={() => quickDay('tonight')} />
            <QuickButton icon={X} title={t('clear')} onClick={() => quickDay('clear')} />
          </div>

          <div className="mt-3 flex items-center justify-between px-1">
            <div className="text-[18px] font-medium text-ink">
              {lang === 'zh' ? `${cursor.year}年${cursor.month0 + 1}月` : `${MONTHS.en[cursor.month0]} ${cursor.year}`}
            </div>
            <div className="flex items-center gap-1 text-ink-3">
              <button type="button" onClick={() => stepMonth(setCursor, cursor, -1)} className="rounded-md p-1 hover:bg-hover hover:text-ink" title={t('previousMonth')}>
                <ChevronLeft size={17} />
              </button>
              <button type="button" onClick={() => setCursor(parseMonth(today))} className="rounded-full p-1 text-[16px] leading-none hover:bg-hover hover:text-ink" title={t('relToday')}>
                ○
              </button>
              <button type="button" onClick={() => stepMonth(setCursor, cursor, 1)} className="rounded-md p-1 hover:bg-hover hover:text-ink" title={t('nextMonth')}>
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-7 text-center text-[11px] text-ink-3">
            {WEEKDAYS[lang].map((weekday) => <span key={weekday} className="py-1">{weekday}</span>)}
            {grid.map((day) => {
              const inMonth = Number(day.slice(5, 7)) === cursor.month0 + 1;
              const selected = day === selectedDay;
              const isToday = day === today;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => chooseDay(day)}
                  className={`mx-auto flex h-9 w-9 flex-col items-center justify-center rounded-full text-[13px] transition-colors ${
                    selected ? 'bg-tt font-semibold text-white' : isToday ? 'bg-tt-light font-semibold text-tt' : inMonth ? 'text-ink-2 hover:bg-hover' : 'text-line'
                  }`}
                >
                  {Number(day.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="mt-4 space-y-3">
          <ScheduleField label={t('startTime')} date={startDay} time={startClock} allDay={allDay} onDate={setStartDay} onTime={setStartClock} />
          <ScheduleField label={t('endTime')} date={endDay} time={endClock} allDay={allDay} onDate={setEndDay} onTime={setEndClock} />
          <div className="flex items-center justify-between border-t border-line pt-3 text-[13px] text-ink-2">
            <span>{t('allDay')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={allDay}
              onClick={() => setAllDay((value) => !value)}
              className={`relative h-6 w-11 rounded-full transition-colors ${allDay ? 'bg-tt' : 'bg-line'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${allDay ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
      )}

      {tab === 'date' && (
        <div className="mt-3 border-t border-line pt-1">
          <div
            className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-1.5 hover:bg-hover"
            onClick={() => (allDay ? enableTime() : setTab('range'))}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === 'Enter' && (allDay ? enableTime() : setTab('range'))}
          >
            <Clock3 size={19} className="text-ink-3" />
            <span className="flex-1 text-[14px] text-ink-2">{t('time')}</span>
            <span className="text-[13px] text-ink-3">
              {allDay ? t('setTime') : (startClock && endClock ? `${startClock}–${endClock}` : endClock || startClock || t('setTime'))}
            </span>
            <ChevronRight size={16} className="text-ink-3" />
          </div>
        </div>
      )}

      <div className="mt-1 border-t border-line pt-1">
        <OptionRow icon={<Bell size={19} />} label={t('reminder')} value={reminderLabel} onClick={() => setExpanded(expanded === 'reminder' ? null : 'reminder')} />
        {expanded === 'reminder' && (
          <OptionPicker
            options={[
              [t('reminderNone'), []],
              [t('reminderOnTime'), ['TRIGGER:-PT0M']],
              [t('reminder15m'), ['TRIGGER:-PT15M']],
              [t('reminder1h'), ['TRIGGER:-PT1H']],
            ]}
            selected={reminders}
            onPick={(value) => {
              setReminders(value);
              setExpanded(null);
            }}
          />
        )}
        <OptionRow icon={<Repeat size={19} />} label={t('repeat')} value={repeatLabel} onClick={() => setExpanded(expanded === 'repeat' ? null : 'repeat')} />
        {expanded === 'repeat' && (
          <div className="mb-1 ml-8 rounded-md bg-hover p-1">
            {([
              [t('repeatNone'), null],
              [t('repeatDaily'), 'RRULE:FREQ=DAILY'],
              [t('repeatWeekdays'), 'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR'],
              [t('repeatWeekly'), 'weekly'],
              [t('repeatMonthly'), 'RRULE:FREQ=MONTHLY'],
              [t('repeatYearly'), 'RRULE:FREQ=YEARLY'],
            ] as [string, string | null][]).map(([label, value]) => {
              const isWeekly = value === 'weekly';
              const active = isWeekly
                ? !!repeatFlag?.toUpperCase().startsWith('RRULE:FREQ=WEEKLY')
                : value === null
                  ? repeatFlag == null
                  : repeatFlag === value;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (value === null) {
                      setRepeatFlag(null);
                      setWeeklyPicker(false);
                      setExpanded(null);
                    } else if (value === 'weekly') {
                      // Default to the selected day's weekday when unset.
                      if (weeklyDays.length === 0) {
                        const day = new Date(`${selectedDay}T00:00:00`).getDay();
                        setWeeklyDays([DAY_CODE[day]]);
                        setRepeatFlag(weeklyFlag([DAY_CODE[day]]));
                      } else {
                        setRepeatFlag(weeklyFlag(weeklyDays));
                      }
                      setWeeklyPicker(true);
                    } else {
                      setRepeatFlag(value);
                      setWeeklyPicker(false);
                      setExpanded(null);
                    }
                  }}
                  className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[12px] text-ink-2 hover:bg-white"
                >
                  {label}
                  {active && <span className="text-tt">✓</span>}
                </button>
              );
            })}
            {weeklyPicker && (
              <div className="flex gap-1 px-2.5 pb-1.5 pt-0.5">
                {REPEAT_CODES.map((code, index) => {
                  // REPEAT_CODES is Monday-first; the label array is Sunday-first.
                  const dayIndex = (index + 1) % 7;
                  const on = weeklyDays.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = on && weeklyDays.length > 1
                          ? weeklyDays.filter((d) => d !== code)
                          : on
                            ? weeklyDays
                            : [...weeklyDays, code];
                        setWeeklyDays(next);
                        setRepeatFlag(weeklyFlag(next));
                      }}
                      className={`h-7 flex-1 rounded-full text-[11px] transition-colors ${
                        on ? 'bg-tt font-medium text-white' : 'bg-white text-ink-2 hover:text-tt'
                      }`}
                    >
                      {WEEKDAYS[lang][dayIndex]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="mt-2 rounded-md bg-[#fff3f3] px-2.5 py-1.5 text-[11px] text-p-high">{error}</div>}
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <button type="button" onClick={clear} className="flex-1 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-2 hover:bg-hover">
          {t('clear')}
        </button>
        <button type="button" onClick={save} className="flex-1 rounded-lg bg-tt px-3 py-2 text-[13px] font-medium text-white hover:bg-tt/90">
          {t('confirm')}
        </button>
      </div>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-1.5 text-[14px] transition-colors ${active ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2'}`}
    >
      {label}
    </button>
  );
}

function QuickButton({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-12 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-tt">
      <Icon size={25} strokeWidth={1.7} />
    </button>
  );
}

function ScheduleField({
  label,
  date,
  time,
  allDay,
  onDate,
  onTime,
}: {
  label: string;
  date: string;
  time: string;
  allDay: boolean;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[42px_1fr] items-center gap-2 text-[13px] text-ink-2">
      <span>{label}</span>
      <span className="flex min-w-0 gap-1.5">
        <input type="date" value={date} onChange={(event) => onDate(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-line px-2 py-2 text-[13px] text-ink" />
        {!allDay && <input type="time" value={time} onChange={(event) => onTime(event.target.value)} className="w-[92px] rounded-lg border border-line px-2 py-2 text-[13px] text-ink" />}
      </span>
    </label>
  );
}

function OptionRow({ icon, label, value, onClick }: { icon: ReactNode; label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-10 w-full items-center gap-3 rounded-md px-1.5 text-left hover:bg-hover">
      <span className="text-ink-3">{icon}</span>
      <span className="flex-1 text-[14px] text-ink-2">{label}</span>
      <span className="max-w-[150px] truncate text-[13px] text-ink-3">{value}</span>
      <ChevronRight size={16} className="text-ink-3" />
    </button>
  );
}

function OptionPicker<T extends string[] | string | null>({
  options,
  selected,
  onPick,
}: {
  options: [string, T][];
  selected: T;
  onPick: (value: T) => void;
}) {
  return (
    <div className="mb-1 ml-8 rounded-md bg-hover p-1">
      {options.map(([label, value]) => {
        const active = Array.isArray(value) && Array.isArray(selected)
          ? sameValues(value, selected)
          : value === selected;
        return (
          <button key={label} type="button" onClick={() => onPick(value)} className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-[12px] text-ink-2 hover:bg-white">
            {label}
            {active && <span className="text-tt">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function stepMonth(
  setCursor: (value: { year: number; month0: number }) => void,
  cursor: { year: number; month0: number },
  delta: number,
) {
  const month = cursor.month0 + delta;
  setCursor({ year: cursor.year + Math.floor(month / 12), month0: ((month % 12) + 12) % 12 });
}
