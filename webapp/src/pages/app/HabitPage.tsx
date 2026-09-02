import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  Flame,
  Grid2X2,
  HelpCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Smile,
  X,
} from 'lucide-react';
import { api, yearRange } from '../../lib/api';
import type { Habit, HabitYear } from '../../lib/types';
import { addDays, lastNDays, stampOf, stampToday, todayStr, weekdayShort } from '../../lib/date';
import { useI18n, useT } from '../../i18n';

const PRIMARY = '#4772fa';
const COLORS = ['#97e38b', '#9dc9ff', '#f6c684', '#f3a7a7', '#c9b4f7', '#8edbd4'];
const ICONS = ['😊', '📚', '💧', '🏃', '🧘', '🌙', '❤️', '✅', '🎵', '🥗', '✍️', '🧹'];
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
type WeekdayCode = typeof WEEKDAY_CODES[number];
type Frequency = 'daily' | 'weekly' | 'interval';
type TargetMode = 'complete' | 'count';
type RecordMode = 'auto' | 'manual' | 'complete';
type Duration = 'forever' | '7' | '21' | '30' | '100' | '365' | 'custom';

function formatHabitDate(day: string, lang: 'en' | 'zh'): string {
  const parts = day.split('-').map(Number);
  const month = parts[1] ?? 1;
  const date = parts[2] ?? 1;
  if (lang === 'zh') return month + '月' + date + '日';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(day + 'T00:00:00'));
}

function weekdayCode(day: string): WeekdayCode {
  const parts = day.split('-').map(Number);
  const weekday = new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1).getDay();
  return WEEKDAY_CODES[weekday] ?? 'SU';
}

function dateDistance(from: string, to: string): number {
  const first = from.split('-').map(Number);
  const second = to.split('-').map(Number);
  const start = new Date(first[0] ?? 1970, (first[1] ?? 1) - 1, first[2] ?? 1);
  const end = new Date(second[0] ?? 1970, (second[1] ?? 1) - 1, second[2] ?? 1);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function extensionValue(rule: string, key: string): string | null {
  const match = new RegExp('(?:^|\\n)' + key + ':([^\\n]*)').exec(rule);
  return match?.[1] ?? null;
}

function dateFromStamp(value: string | null): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8);
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

type HabitMeta = {
  frequency: Frequency;
  startDate: string | null;
  durationDays: number | null;
  target: TargetMode;
  recordMode: RecordMode;
  autoLog: boolean;
  weeklyDays: WeekdayCode[];
  intervalDays: number;
};

function parseHabitMeta(habit: Habit): HabitMeta {
  const rule = habit.repeatRule ?? '';
  const legacyStart = /DTSTART;VALUE=DATE:(\d{8})/.exec(rule)?.[1] ?? null;
  const startDate = dateFromStamp(extensionValue(rule, 'X-NODETICK-START') ?? legacyStart);
  const explicitFrequency = extensionValue(rule, 'X-NODETICK-FREQ');
  const intervalFromRule = extensionValue(rule, 'X-NODETICK-INTERVAL') ?? /FREQ=DAILY[^\n]*INTERVAL=(\d+)/.exec(rule)?.[1] ?? null;
  const intervalDays = parsePositiveInteger(intervalFromRule) ?? 2;
  const frequency: Frequency = explicitFrequency === 'interval' || intervalFromRule != null
    ? 'interval'
    : explicitFrequency === 'daily'
      ? 'daily'
      : explicitFrequency === 'weekly'
        ? 'weekly'
        : /FREQ=DAILY/.test(rule)
          ? 'daily'
          : 'weekly';
  const byDay = /BYDAY=([A-Z,]+)/.exec(rule)?.[1]
    ?.split(',')
    .filter((value): value is WeekdayCode => (WEEKDAY_CODES as readonly string[]).includes(value)) ?? [];
  const weeklyDays = byDay.length ? byDay : [...WEEKDAY_CODES];
  const rawDuration = extensionValue(rule, 'X-NODETICK-DAYS') ?? /COUNT=(\d+)/.exec(rule)?.[1] ?? null;
  const durationDays = rawDuration === '0' || rawDuration == null ? null : parsePositiveInteger(rawDuration);
  const target: TargetMode = extensionValue(rule, 'X-NODETICK-TARGET') === 'count' || habit.type === 'Real' || (habit.goal ?? 1) > 1
    ? 'count'
    : 'complete';
  const rawRecordMode = extensionValue(rule, 'X-NODETICK-RECORD');
  const recordMode: RecordMode = rawRecordMode === 'auto' || rawRecordMode === 'complete' ? rawRecordMode : 'manual';
  return {
    frequency,
    startDate,
    durationDays,
    target,
    recordMode,
    autoLog: extensionValue(rule, 'X-NODETICK-LOG') === '1',
    weeklyDays,
    intervalDays,
  };
}

function repeatRuleFor(
  frequency: Frequency,
  startDate: string,
  duration: Duration,
  customDays: number,
  weeklyDays: WeekdayCode[],
  intervalDays: number,
  target: TargetMode,
  recordMode: RecordMode,
  autoLog: boolean,
): string {
  const selectedDays = frequency === 'daily' ? WEEKDAY_CODES : weeklyDays;
  const durationDays = duration === 'forever' ? 0 : duration === 'custom' ? customDays : Number(duration);
  return [
    frequency === 'interval'
      ? 'RRULE:FREQ=DAILY;INTERVAL=' + intervalDays
      : 'RRULE:FREQ=WEEKLY;BYDAY=' + selectedDays.join(','),
    'X-NODETICK-FREQ:' + frequency,
    'X-NODETICK-START:' + stampOf(startDate),
    'X-NODETICK-DAYS:' + durationDays,
    ...(frequency === 'interval' ? ['X-NODETICK-INTERVAL:' + intervalDays] : []),
    'X-NODETICK-TARGET:' + target,
    'X-NODETICK-RECORD:' + (target === 'count' ? recordMode : 'manual'),
    'X-NODETICK-LOG:' + (autoLog ? '1' : '0'),
  ].join('\n');
}

function isHabitActiveOnDate(habit: Habit, day: string): boolean {
  const meta = parseHabitMeta(habit);
  if (meta.startDate && day < meta.startDate) return false;
  if (meta.startDate && meta.durationDays != null && dateDistance(meta.startDate, day) >= meta.durationDays) return false;
  if (meta.frequency === 'interval') return dateDistance(meta.startDate ?? day, day) % meta.intervalDays === 0;
  return meta.frequency === 'daily' || meta.weeklyDays.includes(weekdayCode(day));
}

function habitIcon(iconRes: string | null): string | null {
  return iconRes?.startsWith('emoji:') ? iconRes.slice('emoji:'.length) : null;
}

function HabitIcon({ habit, size = 18 }: { habit?: Habit; size?: number }) {
  const emoji = habitIcon(habit?.iconRes ?? null);
  if (emoji) return <span className="leading-none" style={{ fontSize: size }}>{emoji}</span>;
  return <Smile size={size} strokeWidth={2} />;
}

function EmptyHabitArtwork() {
  return (
    <div className="relative mx-auto h-[162px] w-[260px]" aria-hidden="true">
      <div className="absolute bottom-2 left-1/2 h-[68px] w-[218px] -translate-x-1/2 rounded-[50%] bg-[#fafafa]" />
      <div className="absolute left-[52px] top-[45px] h-[56px] w-[164px] rotate-[-5deg] rounded-[18px] border border-[#f0f0f0] bg-white shadow-[0_8px_18px_rgba(25,25,25,0.04)]">
        <div className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg border-2 border-[#4772fa] text-[#4772fa]">
          <Smile size={17} strokeWidth={2} />
        </div>
        <div className="absolute left-[52px] top-3 h-2 w-[76px] rounded-full bg-[#dfe6ff]" />
        <div className="absolute left-[52px] top-7 h-2 w-[48px] rounded-full bg-[#e9edff]" />
      </div>
      <div className="absolute left-[70px] top-[24px] h-10 w-[150px] rotate-[7deg] rounded-[14px] bg-[#f7f7f7]" />
      <div className="absolute left-[113px] top-[5px] flex h-10 w-10 items-center justify-center rounded-full bg-[#eff3ff] text-[#4772fa]">
        <Check size={20} strokeWidth={2.4} />
      </div>
      <span className="absolute right-[32px] top-[38px] h-2 w-2 rounded-full bg-[#faa80c]" />
      <span className="absolute left-[37px] top-[95px] h-2 w-2 rounded-full bg-[#97e38b]" />
    </div>
  );
}

function HabitDayStatus({
  day,
  done,
  value,
  goal,
  active,
  today,
  onClick,
  label,
}: {
  day: string;
  done: boolean;
  value: number;
  goal: number;
  active: boolean;
  today: boolean;
  onClick: () => void;
  label: string;
}) {
  const partial = active && !done && value > 0 && goal > 0;
  const ratio = Math.min(1, value / goal);
  const circleClass = done
    ? 'border-tt bg-tt text-white'
    : partial
      ? 'border-transparent p-[2px]'
    : today && active
      ? 'border-tt text-tt'
      : 'border-[#ededed] text-ink-3';
  return (
    <button
      type="button"
      title={day + ' · ' + (done ? label : '')}
      aria-label={day + ' ' + (done ? label : '')}
      aria-pressed={done}
      disabled={!active}
      onClick={onClick}
      className="flex h-10 w-5 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span
        className={'relative flex h-5 w-5 items-center justify-center rounded-full border-2 ' + circleClass}
        style={partial ? { background: 'conic-gradient(' + PRIMARY + ' ' + ratio * 360 + 'deg, #ededed 0deg)' } : undefined}
      >
        {partial ? <span className="h-full w-full rounded-full bg-white" /> : done ? <Check size={12} strokeWidth={2.7} /> : !today || !active ? <span className="absolute h-px w-5 rotate-[-45deg] bg-[#e3e3e3]" /> : null}
      </span>
    </button>
  );
}

function HeaderDayStatus({ today, completed, total }: { today: boolean; completed: number; total: number }) {
  const full = total > 0 && completed === total;
  const partial = completed > 0 && !full;
  const ratio = total > 0 ? completed / total : 0;
  const circleClass = full
    ? 'border-tt bg-tt text-white'
    : partial
      ? 'border-transparent p-[2px]'
      : today
        ? 'border-tt text-tt'
        : 'border-[#ededed]';
  return (
    <span
      className={'relative flex h-7 w-7 items-center justify-center rounded-full border-2 ' + circleClass}
      style={partial ? { background: 'conic-gradient(' + PRIMARY + ' ' + ratio * 360 + 'deg, #ededed 0deg)' } : undefined}
    >
      {partial ? <span className="h-full w-full rounded-full bg-white" /> : full ? <Check size={15} strokeWidth={2.5} /> : !today ? <span className="absolute h-px w-7 rotate-[-45deg] bg-[#ededed]" /> : null}
    </span>
  );
}

function HabitRow({
  habit,
  days,
  today,
  onToggle,
  doneOn,
  progressOn,
  activeOn,
  streak,
}: {
  habit: Habit;
  days: string[];
  today: string;
  onToggle: (habit: Habit, day: string) => void;
  doneOn: (habit: Habit, day: string) => boolean;
  progressOn: (habit: Habit, day: string) => { value: number; goal: number };
  activeOn: (habit: Habit, day: string) => boolean;
  streak: number;
}) {
  const t = useT();
  const completedDays = days.filter((day) => activeOn(habit, day) && doneOn(habit, day)).length;
  const color = habit.color ?? COLORS[0];
  return (
    <div className="h-[70px] border-b border-line/70 px-[22px] py-[5px] last:border-b-0">
      <div className="flex h-[60px] min-w-0 items-center rounded-[10px] bg-white px-4 shadow-[0_0_12px_rgba(25,25,25,0.025)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: color }}>
          <HabitIcon habit={habit} size={18} />
        </span>
        <div className="ml-3 min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-5">{habit.name}</div>
          <div className="flex items-center gap-2 truncate text-[11px] leading-4 text-ink-3">
            <span className="flex items-center gap-1"><BarChart3 size={11} className="text-tt" />{completedDays} {t('habitDays')}</span>
            <span className="flex items-center gap-1"><Flame size={11} className="text-[#ff6f6f]" />{streak} {t('habitDays')}</span>
          </div>
        </div>
        <div className="flex w-[200px] shrink-0 items-center justify-between">
          {days.map((day) => (
            <HabitDayStatus
              key={day}
              day={day}
              done={doneOn(habit, day)}
              value={progressOn(habit, day).value}
              goal={progressOn(habit, day).goal}
              active={activeOn(habit, day)}
              today={day === today}
              label={t('habitCheckedIn')}
              onClick={() => onToggle(habit, day)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type HabitActionTarget = { habit: Habit; day: string };

export default function HabitPage() {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [years, setYears] = useState<Map<string, HabitYear>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [resetTarget, setResetTarget] = useState<HabitActionTarget | null>(null);
  const [countTarget, setCountTarget] = useState<HabitActionTarget | null>(null);
  const [logTarget, setLogTarget] = useState<HabitActionTarget | null>(null);
  const today = todayStr();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const days = useMemo(() => lastNDays(7), [today]);

  const load = async () => {
    const list = (await api.listHabits()).filter((h) => h.status !== 2);
    setHabits(list);
    if (list.length) {
      const stamp = stampToday();
      const rows = await api.listCheckins(list.map((h) => h.id), ...yearRange(stamp));
      setYears(new Map(rows.map((r) => [r.habitId, r])));
    } else {
      setYears(new Map());
    }
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, []);

  const doneOn = (habit: Habit, day: string): boolean => {
    const checkin = years.get(habit.id)?.checkins.find((item) => item.stamp === stampOf(day));
    if (!checkin) return false;
    const goal = checkin.goal ?? habit.goal ?? 1;
    return (checkin.value ?? 0) >= goal && goal > 0;
  };

  const dayProgress = (habit: Habit, day: string): { value: number; goal: number } => {
    const checkin = years.get(habit.id)?.checkins.find((item) => item.stamp === stampOf(day));
    return {
      value: Math.max(0, checkin?.value ?? 0),
      goal: Math.max(1, checkin?.goal ?? habit.goal ?? 1),
    };
  };

  const streak = (habit: Habit): number => {
    let count = 0;
    let day = today;
    for (;;) {
      if (!isHabitActiveOnDate(habit, day) || !doneOn(habit, day)) break;
      count++;
      day = addDays(day, -1);
    }
    return count;
  };

  const daySummary = (day: string) => {
    const scheduled = habits.filter((habit) => isHabitActiveOnDate(habit, day));
    return {
      completed: scheduled.filter((habit) => doneOn(habit, day)).length,
      total: scheduled.length,
    };
  };

  const toggleDay = async (habit: Habit, day: string) => {
    if (!isHabitActiveOnDate(habit, day)) return;
    const key = habit.id + ':' + day;
    if (busyKey === key) return;
    const existing = years.get(habit.id)?.checkins.find((item) => item.stamp === stampOf(day));
    if (existing && doneOn(habit, day)) {
      setResetTarget({ habit, day });
      return;
    }

    const meta = parseHabitMeta(habit);
    const goal = Math.max(1, habit.goal ?? existing?.goal ?? 1);
    const currentValue = Math.max(0, existing?.value ?? 0);
    if (meta.target === 'count' && meta.recordMode === 'manual') {
      setCountTarget({ habit, day });
      return;
    }
    const step = meta.target === 'count' && meta.recordMode !== 'complete' ? Math.max(1, habit.step ?? 1) : goal;
    const value = meta.target === 'count' ? Math.min(goal, currentValue + step) : goal;
    setBusyKey(key);
    try {
      const nextYear = await api.checkin(habit.id, stampOf(day), value, { goal, status: value >= goal ? 2 : 0 });
      setYears((current) => new Map(current).set(habit.id, nextYear));
      if (value >= goal && meta.autoLog && !logIsSuppressed()) setLogTarget({ habit, day });
    } finally {
      setBusyKey(null);
    }
  };

  const addCount = async (target: HabitActionTarget, increment: number) => {
    const key = target.habit.id + ':' + target.day;
    if (busyKey === key) return;
    const existing = years.get(target.habit.id)?.checkins.find((item) => item.stamp === stampOf(target.day));
    if (existing && doneOn(target.habit, target.day)) {
      setCountTarget(null);
      setResetTarget(target);
      return;
    }
    const meta = parseHabitMeta(target.habit);
    const goal = Math.max(1, target.habit.goal ?? existing?.goal ?? 1);
    const currentValue = Math.max(0, existing?.value ?? 0);
    const value = Math.min(goal, currentValue + increment);
    setBusyKey(key);
    try {
      const nextYear = await api.checkin(target.habit.id, stampOf(target.day), value, { goal, status: value >= goal ? 2 : 0 });
      setYears((current) => new Map(current).set(target.habit.id, nextYear));
      setCountTarget(null);
      if (value >= goal && meta.autoLog && !logIsSuppressed()) setLogTarget(target);
    } finally {
      setBusyKey(null);
    }
  };

  const resetDay = async (target: HabitActionTarget) => {
    const key = target.habit.id + ':' + target.day;
    setBusyKey(key);
    try {
      const goal = Math.max(1, target.habit.goal ?? 1);
      const nextYear = await api.checkin(target.habit.id, stampOf(target.day), 0, { goal, status: 0 });
      setYears((current) => new Map(current).set(target.habit.id, nextYear));
      setResetTarget(null);
    } finally {
      setBusyKey(null);
    }
  };

  const saveLog = async (target: HabitActionTarget, content: string, emoji: number) => {
    await api.addHabitRecord(target.habit.id, stampOf(target.day), content, emoji);
    setLogTarget(null);
  };

  return (
    <div className="h-full min-w-0 flex-1 overflow-hidden">
      <div className="flex h-full w-full max-w-[872px] min-w-0 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center border-b border-line/50 px-[26px]">
          <button type="button" className="flex items-center gap-1 text-left" title={t('habitViewOptions')}>
            <h1 className="text-[20px] font-bold">{t('habitTitle')}</h1>
            <ChevronDown size={14} className="mt-0.5 text-ink-3" />
          </button>
          <div className="ml-auto flex items-center gap-4">
            <button type="button" title={t('habitViewOptions')} aria-label={t('habitViewOptions')} className="flex h-8 w-5 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"><Grid2X2 size={19} strokeWidth={1.8} /></button>
            <button type="button" title={t('newHabit')} aria-label={t('newHabit')} onClick={() => setShowNew(true)} className="flex h-8 w-5 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"><Plus size={23} strokeWidth={1.8} /></button>
            <button type="button" title={t('habitViewOptions')} aria-label={t('habitViewOptions')} className="flex h-8 w-5 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"><MoreHorizontal size={20} /></button>
          </div>
        </header>

        <div className="grid h-[102px] shrink-0 grid-cols-7">
          {days.map((day) => {
            const isToday = day === today;
            const progress = daySummary(day);
            return (
              <button key={day} type="button" className={'mx-auto mt-0.5 flex h-[84px] w-16 flex-col items-center pt-[10px] text-[12px] ' + (isToday ? 'text-tt' : 'text-ink-3')}>
                <span className="leading-[17px]">{weekdayShort(day, lang)}</span>
                <span className={'text-[14px] leading-[21px] ' + (isToday ? 'font-semibold' : 'font-medium')}>{Number(day.slice(8, 10))}</span>
                <HeaderDayStatus today={isToday} completed={progress.completed} total={progress.total} />
              </button>
            );
          })}
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto">
          {!loaded ? (
            <div className="pt-16 text-center text-ink-3">{t('loading')}</div>
          ) : habits.length === 0 ? (
            <div className="pt-[126px]">
              <div className="h-[211px] w-full overflow-hidden text-center">
                <EmptyHabitArtwork />
                <span className="mt-2 block text-[14px] font-medium leading-5 text-ink">{t('habitEmptyTitle')}</span>
                <span className="mt-1 block text-[12px] leading-[17px] text-ink-3">{t('habitEmptyHint')}</span>
              </div>
            </div>
          ) : (
            <div>
              {habits.map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  days={days}
                  today={today}
                  onToggle={(item, day) => void toggleDay(item, day)}
                  doneOn={doneOn}
                  progressOn={dayProgress}
                  activeOn={isHabitActiveOnDate}
                  streak={streak(habit)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {showNew && (
        <NewHabitModal
          onClose={() => setShowNew(false)}
          onCreate={async (input) => {
            await api.createHabit(input);
            setShowNew(false);
            await load();
          }}
        />
      )}
      {resetTarget && (
        <ResetHabitModal
          onClose={() => setResetTarget(null)}
          onConfirm={() => void resetDay(resetTarget)}
          busy={busyKey === resetTarget.habit.id + ':' + resetTarget.day}
        />
      )}
      {countTarget && (
        <HabitCountModal
          target={countTarget}
          current={dayProgress(countTarget.habit, countTarget.day).value}
          goal={dayProgress(countTarget.habit, countTarget.day).goal}
          onClose={() => setCountTarget(null)}
          onConfirm={(increment) => void addCount(countTarget, increment)}
          busy={busyKey === countTarget.habit.id + ':' + countTarget.day}
        />
      )}
      {logTarget && (
        <HabitLogModal
          target={logTarget}
          onClose={() => setLogTarget(null)}
          onSave={(content, emoji) => void saveLog(logTarget, content, emoji)}
          onSuppress={() => {
            suppressLog();
            setLogTarget(null);
          }}
        />
      )}
    </div>
  );
}

function logIsSuppressed(): boolean {
  try {
    return localStorage.getItem('ntk_habit_log_suppressed') === '1';
  } catch {
    return false;
  }
}

function suppressLog() {
  try {
    localStorage.setItem('ntk_habit_log_suppressed', '1');
  } catch {
    // Storage may be disabled; closing the current prompt still works.
  }
}

function FieldRow({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={'flex min-w-0 items-center px-1 ' + className}>
      <span className="mr-[26px] w-[71px] shrink-0 pr-2 text-[13px] leading-4 text-ink">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function HabitCountModal({
  target,
  current,
  goal,
  onClose,
  onConfirm,
  busy,
}: {
  target: HabitActionTarget;
  current: number;
  goal: number;
  onClose: () => void;
  onConfirm: (increment: number) => void;
  busy: boolean;
}) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const [increment, setIncrement] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = parsePositiveInteger(increment);
    if (value == null) {
      setError(t('habitCountRequired'));
      return;
    }
    onConfirm(value);
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-transparent px-4" onMouseDown={onClose}>
      <form onMouseDown={(event) => event.stopPropagation()} onSubmit={submit} className="w-[360px] max-w-full rounded-xl bg-white p-5 shadow-[0_5px_18px_rgba(0,0,0,0.2)]">
        <h2 className="text-[16px] font-semibold">{formatHabitDate(target.day, lang)}</h2>
        <div className="mt-4 flex items-center gap-2 text-[13px] text-ink">
          <span>{t('habitAddCount')}</span>
          <input
            autoFocus
            type="number"
            min="1"
            step="1"
            value={increment}
            onChange={(event) => { setIncrement(event.target.value); setError(null); }}
            aria-label={t('habitAddCount')}
            className="h-8 min-w-0 flex-1 rounded-lg border border-tt px-3 text-[13px] outline-none focus:border-tt"
          />
          <span>{target.habit.unit || t('habitUnit')}</span>
        </div>
        <div className="mt-2 text-[12px] text-ink-3">{t('habitCurrentProgress')}: {current} / {goal}</div>
        {error && <div className="mt-2 text-[12px] text-p-high">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 min-w-[82px] rounded-lg border border-black/10 px-3 text-[13px] text-ink-2 hover:bg-hover">{t('close')}</button>
          <button type="submit" disabled={busy} className="h-8 min-w-[82px] rounded-lg bg-tt px-3 text-[13px] font-medium text-white hover:bg-tt-hover disabled:opacity-60">{t('confirm')}</button>
        </div>
      </form>
    </div>
  );
}

function SelectField({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="relative h-8 w-full">
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full appearance-none rounded-lg border border-black/10 bg-white px-3 pr-8 text-[13px] text-ink outline-none transition-colors hover:border-tt focus:border-tt">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-3 top-2 text-ink-3" />
    </div>
  );
}

function reminderOptions(): string[] {
  return Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2).toString().padStart(2, '0');
    const minute = index % 2 === 0 ? '00' : '30';
    return hour + ':' + minute;
  });
}

function weekdayLabel(code: WeekdayCode, lang: 'en' | 'zh'): string {
  const index = WEEKDAY_CODES.indexOf(code);
  if (lang === 'zh') return ['日', '一', '二', '三', '四', '五', '六'][index] ?? code;
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index] ?? code;
}

function NewHabitModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [weeklyDays, setWeeklyDays] = useState<WeekdayCode[]>([...WEEKDAY_CODES]);
  const [intervalDays, setIntervalDays] = useState('2');
  const [target, setTarget] = useState<TargetMode>('complete');
  const [recordMode, setRecordMode] = useState<RecordMode>('auto');
  const [startDate, setStartDate] = useState(todayStr());
  const [duration, setDuration] = useState<Duration>('forever');
  const [customDays, setCustomDays] = useState('14');
  const [goal, setGoal] = useState('1');
  const [step, setStep] = useState('1');
  const [unit, setUnit] = useState('');
  const [group, setGroup] = useState('other');
  const [reminders, setReminders] = useState<string[]>([]);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [autoLog, setAutoLog] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState(ICONS[0]);
  const [showColors, setShowColors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(lang === 'zh' ? '请输入习惯名称。' : 'Enter a habit name.');
      return;
    }
    if (!startDate) {
      setError(lang === 'zh' ? '请选择开始日期。' : 'Choose a start date.');
      return;
    }
    if (frequency === 'weekly' && weeklyDays.length === 0) {
      setError(lang === 'zh' ? '至少选择一天。' : 'Select at least one day.');
      return;
    }
    const intervalValue = frequency === 'interval' ? parsePositiveInteger(intervalDays) : 2;
    const goalValue = target === 'complete' ? 1 : parsePositiveInteger(goal);
    const stepValue = target === 'complete' ? 0 : parsePositiveInteger(step);
    const customDuration = duration === 'custom' ? parsePositiveInteger(customDays) : null;
    if (intervalValue == null || goalValue == null || stepValue == null || (duration === 'custom' && customDuration == null)) {
      setError(lang === 'zh' ? '目标、每次记录和持续天数必须是正整数。' : 'Target, step and duration must be positive integers.');
      return;
    }
    try {
      await onCreate({
        name: trimmed,
        iconRes: 'emoji:' + icon,
        color,
        goal: goalValue,
        step: stepValue,
        unit: target === 'complete' ? 'Count' : unit.trim() || 'Count',
        type: target === 'complete' ? 'Boolean' : 'Real',
        style: 1,
        repeatRule: repeatRuleFor(frequency, startDate, duration, customDuration ?? 0, weeklyDays, intervalValue, target, recordMode, autoLog),
        reminders,
        sectionId: group === 'other' ? '-1' : group,
        recordEnable: target === 'count' && recordMode === 'auto',
        autoLog,
        targetStartDate: stampOf(startDate),
        targetDays: duration === 'forever' ? 0 : duration === 'custom' ? customDuration : Number(duration),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this habit.');
    }
  };

  const addReminder = (value: string) => {
    setReminders((current) => current.includes(value) ? current : [...current, value].sort());
    setShowReminderPicker(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent px-4" onMouseDown={onClose}>
      <form onMouseDown={(event) => event.stopPropagation()} onSubmit={submit} className="relative flex max-h-[calc(100vh-32px)] w-[440px] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_5px_18px_rgba(0,0,0,0.2)]">
        <div className="flex h-14 shrink-0 items-center px-5">
          <h2 className="text-[16px] font-bold">{t('habitAddTitle')}</h2>
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"><X size={18} /></button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5">
          {error && <div className="mb-2 rounded-lg bg-[#fdf0f0] px-3 py-2 text-[13px] text-p-high">{error}</div>}

          <div className="mb-2 flex h-10 items-center px-1">
            <div className="relative mr-[26px] w-[71px] shrink-0">
              <button type="button" title={t('habitColor')} aria-label={t('habitColor')} onClick={() => setShowColors((value) => !value)} className="relative flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ backgroundColor: color }}>
                <span className="leading-none" style={{ fontSize: 21 }}>{icon}</span>
                <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-ink-3 shadow-sm"><Pencil size={9} /></span>
              </button>
              {showColors && (
                <div className="absolute left-0 top-10 z-10 w-[154px] rounded-lg border border-line bg-white p-2 shadow-lg">
                  <div className="mb-2 grid grid-cols-6 gap-1.5">
                    {COLORS.map((item) => <button key={item} type="button" aria-label={item} onClick={() => setColor(item)} className={'h-5 w-5 rounded-full ' + (color === item ? 'ring-2 ring-tt ring-offset-1' : '')} style={{ backgroundColor: item }} />)}
                  </div>
                  <div className="grid grid-cols-6 gap-1.5 border-t border-line pt-2">
                    {ICONS.map((item) => <button key={item} type="button" aria-label={item} onClick={() => { setIcon(item); setShowColors(false); }} className={'flex h-6 w-6 items-center justify-center rounded-md text-[16px] hover:bg-hover ' + (icon === item ? 'bg-tt-light' : '')}>{item}</button>)}
                  </div>
                </div>
              )}
            </div>
            <input autoFocus value={name} placeholder={t('habitNamePh')} onChange={(event) => { setName(event.target.value); setError(null); }} className="h-8 min-w-0 flex-1 rounded-lg border border-tt px-3 text-[14px] outline-none placeholder:text-[#d7dbe5] focus:border-tt" />
          </div>

          <FieldRow label={t('habitFrequency')} className="mb-2 min-h-8 items-start">
            <SelectField ariaLabel={t('habitFrequency')} value={frequency} onChange={(value) => setFrequency(value as Frequency)} options={[{ value: 'daily', label: t('habitEveryDay') }, { value: 'weekly', label: t('habitEveryWeek') }, { value: 'interval', label: t('habitEveryInterval') }]} />
            {frequency === 'weekly' && (
              <div className="mt-2 flex items-center gap-1">
                {WEEKDAY_CODES.map((code) => {
                  const selected = weeklyDays.includes(code);
                  return <button key={code} type="button" aria-pressed={selected} onClick={() => setWeeklyDays((current) => selected ? current.filter((item) => item !== code) : [...current, code])} className={'flex h-6 w-6 items-center justify-center rounded-full text-[11px] ' + (selected ? 'bg-tt text-white' : 'bg-hover text-ink-3 hover:text-ink')}>{weekdayLabel(code, lang)}</button>;
                })}
              </div>
            )}
            {frequency === 'interval' && (
              <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
                <span>{t('habitIntervalLabel')}</span>
                <input type="number" min="1" step="1" value={intervalDays} aria-label={t('habitEveryInterval')} onChange={(event) => setIntervalDays(event.target.value)} className="h-8 w-20 rounded-lg border border-black/10 px-3 text-[13px] outline-none focus:border-tt" />
                <span>{t('habitDays')}</span>
              </div>
            )}
          </FieldRow>
          <FieldRow label={t('habitTarget')} className="mb-2 min-h-8 items-start">
            <SelectField ariaLabel={t('habitTarget')} value={target} onChange={(value) => setTarget(value as TargetMode)} options={[{ value: 'complete', label: t('habitCompleteDaily') }, { value: 'count', label: t('habitCountTarget') }]} />
            {target === 'count' && (
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <input type="number" min="1" step="1" value={goal} aria-label={t('habitTarget')} onChange={(event) => setGoal(event.target.value)} className="h-8 w-20 rounded-lg border border-black/10 px-3 text-[13px] outline-none focus:border-tt" />
                  <input value={unit} placeholder={t('habitUnitPh')} onChange={(event) => setUnit(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-black/10 px-3 text-[13px] outline-none focus:border-tt" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[12px] text-ink-2">{t('habitRecordMode')}</span>
                  <SelectField ariaLabel={t('habitRecordMode')} value={recordMode} onChange={(value) => setRecordMode(value as RecordMode)} options={[{ value: 'auto', label: t('habitRecordAuto') }, { value: 'manual', label: t('habitRecordManual') }, { value: 'complete', label: t('habitRecordComplete') }]} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[12px] text-ink-2">{t('habitStep')}</span>
                  <input type="number" min="1" step="1" value={step} aria-label={t('habitStep')} onChange={(event) => setStep(event.target.value)} className="h-8 w-20 rounded-lg border border-black/10 px-3 text-[13px] outline-none focus:border-tt" />
                </div>
              </div>
            )}
          </FieldRow>
          <FieldRow label={t('habitStartDate')} className="mb-2 h-8">
            <div className="relative h-8 w-full">
              <div className="flex h-8 items-center rounded-lg border border-black/10 px-3 text-[13px] text-ink">{formatHabitDate(startDate, lang)}</div>
              <input aria-label={t('habitStartDate')} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="absolute inset-0 h-8 w-full cursor-pointer opacity-0" />
              <ChevronDown size={12} className="pointer-events-none absolute right-3 top-2 text-ink-3" />
            </div>
          </FieldRow>
          <FieldRow label={t('habitDuration')} className="mb-2 min-h-8 items-start">
            <SelectField
              ariaLabel={t('habitDuration')}
              value={duration}
              onChange={(value) => setDuration(value as Duration)}
              options={[
                { value: 'forever', label: t('habitForever') },
                { value: '7', label: t('habitSevenDays') },
                { value: '21', label: t('habitTwentyOneDays') },
                { value: '30', label: t('habitThirtyDays') },
                { value: '100', label: t('habitHundredDays') },
                { value: '365', label: t('habitYearDays') },
                { value: 'custom', label: t('habitCustom') },
              ]}
            />
            {duration === 'custom' && <input type="number" min="1" step="1" value={customDays} aria-label={t('habitCustomDays')} onChange={(event) => setCustomDays(event.target.value)} className="mt-2 h-8 w-full rounded-lg border border-black/10 px-3 text-[13px] outline-none focus:border-tt" />}
          </FieldRow>
          <FieldRow label={t('habitGroup')} className="mb-[3px] h-8">
            <SelectField ariaLabel={t('habitGroup')} value={group} onChange={setGroup} options={[{ value: 'other', label: t('habitOther') }]} />
          </FieldRow>
          <FieldRow label={t('habitReminder')} className="mb-2 min-h-[37px] items-start">
            <div className="flex min-h-[37px] flex-wrap items-center gap-2">
              {reminders.map((reminder) => <button key={reminder} type="button" onClick={() => setReminders((items) => items.filter((item) => item !== reminder))} className="flex h-8 items-center gap-1 rounded-lg border border-black/10 px-2 text-[13px] text-ink-2 hover:border-tt"><Bell size={13} /> {reminder} <X size={12} /></button>)}
              <div className="relative">
                <button type="button" title={t('habitAddReminder')} aria-label={t('habitAddReminder')} onClick={() => setShowReminderPicker((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 text-ink-3 hover:border-tt hover:text-tt"><Plus size={19} /></button>
                {showReminderPicker && (
                  <div className="absolute left-0 top-9 z-20 max-h-48 w-28 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg">
                    {reminderOptions().map((option) => <button key={option} type="button" onClick={() => addReminder(option)} className="block w-full px-3 py-1.5 text-left text-[12px] text-ink-2 hover:bg-hover">{option}</button>)}
                  </div>
                )}
              </div>
            </div>
          </FieldRow>

          <div className="mb-4 h-px w-full bg-black/10" />
          <label className="mb-2 flex h-[30px] cursor-pointer items-center gap-2 px-1 text-[13px] text-ink-2">
            <input type="checkbox" checked={autoLog} onChange={(event) => setAutoLog(event.target.checked)} className="h-3.5 w-3.5 accent-[#4772fa]" />
            {t('habitAutoLog')}
            <HelpCircle size={14} className="text-ink-3" />
          </label>
        </div>

        <div className="flex h-[58px] shrink-0 items-center justify-end gap-2 px-5">
          <button type="button" onClick={onClose} className="h-[30px] min-w-[100px] rounded-lg border border-black/10 px-4 text-[14px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
          <button type="submit" className="h-[30px] min-w-[100px] rounded-lg bg-tt px-4 text-[14px] font-medium text-white hover:bg-tt-hover">{t('habitSave')}</button>
        </div>
      </form>
    </div>
  );
}

function ResetHabitModal({ onClose, onConfirm, busy }: { onClose: () => void; onConfirm: () => void; busy: boolean }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-transparent px-4" onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()} className="w-[360px] max-w-full rounded-xl bg-white p-5 shadow-[0_5px_18px_rgba(0,0,0,0.2)]">
        <h2 className="text-[16px] font-semibold">{t('habitResetTitle')}</h2>
        <p className="mt-3 text-[13px] leading-5 text-ink-2">{t('habitResetMessage')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 min-w-[82px] rounded-lg border border-black/10 px-3 text-[13px] text-ink-2 hover:bg-hover">{t('close')}</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="h-8 min-w-[82px] rounded-lg bg-tt px-3 text-[13px] font-medium text-white hover:bg-tt-hover disabled:opacity-60">{t('habitReset')}</button>
        </div>
      </div>
    </div>
  );
}

function HabitLogModal({ target, onClose, onSave, onSuppress }: { target: HabitActionTarget; onClose: () => void; onSave: (content: string, emoji: number) => void; onSuppress: () => void }) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const [content, setContent] = useState('');
  const [emoji, setEmoji] = useState(50);
  const faces = ['😞', '😕', '😐', '🙂', '😄'];
  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-transparent px-4" onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()} className="w-[440px] max-w-full rounded-2xl bg-white p-5 shadow-[0_5px_18px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
          <h2 className="truncate pr-4 text-[16px] font-semibold">{target.habit.name}</h2>
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"><X size={18} /></button>
        </div>
        <div className="mt-1 text-[12px] text-ink-3">{formatHabitDate(target.day, lang)} · {weekdayShort(target.day, lang)}</div>
        <div className="mt-5 flex justify-center gap-3">
          {faces.map((face, index) => {
            const value = (index + 1) * 20;
            return <button key={face} type="button" aria-label={face} aria-pressed={emoji === value} onClick={() => setEmoji(value)} className={'flex h-9 w-9 items-center justify-center rounded-full text-[22px] ' + (emoji === value ? 'bg-tt-light ring-2 ring-tt' : 'bg-hover hover:bg-[#ededed]')}>{face}</button>;
          })}
        </div>
        <textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} placeholder={t('habitLogPlaceholder')} className="mt-5 h-28 w-full rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-tt" />
        <button type="button" onClick={onSuppress} className="mt-2 text-[12px] text-ink-3 hover:text-tt">{t('habitLogSuppress')}</button>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 min-w-[82px] rounded-lg border border-black/10 px-3 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
          <button type="button" onClick={() => onSave(content, emoji)} className="h-8 min-w-[82px] rounded-lg bg-tt px-3 text-[13px] font-medium text-white hover:bg-tt-hover">{t('habitSave')}</button>
        </div>
      </div>
    </div>
  );
}
