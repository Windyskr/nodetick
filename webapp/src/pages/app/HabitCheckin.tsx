import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Pencil, Smile, Trash2, Undo2, X } from 'lucide-react';
import { useI18n, useT, useTF } from '../../i18n';
import { localDayClock, shortDate, todayStr, weekdayShort } from '../../lib/date';
import {
  dayToStamp,
  effectiveGoal,
  formatAmount,
  isDueOn,
  isFlexible,
  isPlannedDay,
  parseHabitRule,
  periodProgress,
  progressOn,
  WEEKDAY_CODES,
  type HabitRule,
} from '../../lib/habits';
import type { Habit, HabitCheckinEntry, HabitRecord } from '../../lib/types';
import { api } from '../../lib/api';
import { entryKey, entryTimeOn, habitContext, useHabitStore } from '../../stores/habits';

/** Habit check-in pieces shared by the habit page, its detail panel and the Today list. */

export const HABIT_COLORS = ['#97e38b', '#9dc9ff', '#f6c684', '#f3a7a7', '#c9b4f7', '#8edbd4'];

export function habitEmoji(iconRes: string | null | undefined): string | null {
  return iconRes?.startsWith('emoji:') ? iconRes.slice('emoji:'.length) : null;
}

export function HabitIcon({ habit, size = 18 }: { habit: Pick<Habit, 'iconRes'>; size?: number }) {
  const emoji = habitEmoji(habit.iconRes);
  if (emoji) return <span className="leading-none" style={{ fontSize: size }}>{emoji}</span>;
  return <Smile size={size} strokeWidth={2} />;
}

export function HabitAvatar({ habit, size = 32 }: { habit: Pick<Habit, 'iconRes' | 'color'>; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-white"
      style={{ width: size, height: size, backgroundColor: habit.color ?? HABIT_COLORS[0] }}
    >
      <HabitIcon habit={habit} size={Math.round(size * 0.56)} />
    </span>
  );
}

/** The unit a count habit shows: TickTick's default "Count" reads as times / 次. */
export function useHabitUnit() {
  const t = useT();
  return (habit: Pick<Habit, 'unit'>) => {
    const unit = habit.unit?.trim();
    return !unit || unit.toLowerCase() === 'count' ? t('habitUnit') : unit;
  };
}

/** "11月20日" in the current year, "2025年10月1日" / "Oct 1, 2025" in others. */
export function useDayLabel() {
  const t = useT();
  const lang = useI18n((state) => state.lang);
  return (day: string) => (day.slice(0, 4) === todayStr().slice(0, 4)
    ? shortDate(day, lang)
    : new Intl.DateTimeFormat(t('habitLocale'), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)));
}

/** The amount one tap adds to a count habit. */
export const habitStep = (habit: Pick<Habit, 'step'>) => (habit.step != null && habit.step > 0 ? habit.step : 1);

/** "Every day", "Mon, Wed, Fri", "3 days a week", "Every 2 days"… */
export function useRuleSummary() {
  const t = useT();
  const f = useTF();
  const lang = useI18n((state) => state.lang);
  return (rule: HabitRule) => {
    switch (rule.frequency) {
      case 'weekly': {
        if (rule.weekdays.length === 7) return t('habitEveryDay');
        // 2026-11-15 is a Sunday: index the week from there.
        const names = rule.weekdays.map((code) => weekdayShort(`2026-11-${String(15 + WEEKDAY_CODES.indexOf(code)).padStart(2, '0')}`, lang));
        return names.join(t('habitListSeparator'));
      }
      case 'interval': return f('habitEveryNDays', rule.interval);
      case 'perWeek': return f('habitTimesPerWeek', rule.times);
      case 'perMonth': return f('habitTimesPerMonth', rule.times);
      default: return t('habitEveryDay');
    }
  };
}

export type CircleState = 'done' | 'partial' | 'today' | 'missed' | 'open' | 'off';

/**
 * TickTick's check-in circle: filled when done, a progress ring when part of
 * a count is in, outlined for today, slashed for a missed or unscheduled day.
 */
export function CheckinCircle({ state, ratio = 0, size = 20 }: { state: CircleState; ratio?: number; size?: number }) {
  const ring = Math.max(2, Math.round(size / 10));
  if (state === 'done') {
    return (
      <span className="flex items-center justify-center rounded-full bg-tt text-white" style={{ width: size, height: size }}>
        <Check size={Math.round(size * 0.6)} strokeWidth={2.7} />
      </span>
    );
  }
  if (state === 'partial') {
    return (
      <span
        className="flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          padding: ring,
          background: `conic-gradient(var(--color-tt) ${Math.min(1, Math.max(0, ratio)) * 360}deg, var(--color-line) 0deg)`,
        }}
      >
        <span className="h-full w-full rounded-full bg-white" />
      </span>
    );
  }
  const border = state === 'today' ? 'border-tt' : state === 'open' ? 'border-line' : 'border-line opacity-80';
  return (
    <span className={`relative flex items-center justify-center rounded-full border-2 ${border}`} style={{ width: size, height: size }}>
      {(state === 'missed' || state === 'off') && (
        <span className="absolute h-px rotate-[-45deg] bg-line" style={{ width: size }} />
      )}
    </span>
  );
}

/** Circle state and fill of a habit on a day. */
export function circleFor(habit: Habit, checkins: Parameters<typeof habitContext>[1], day: string, today: string): { state: CircleState; ratio: number } {
  const ctx = habitContext(habit, checkins);
  const { value, goal, met } = progressOn(ctx, day);
  if (met) return { state: 'done', ratio: 1 };
  if (value > 0) return { state: 'partial', ratio: value / goal };
  if (!isPlannedDay(ctx.rule, day)) return { state: 'off', ratio: 0 };
  // A flexible habit whose week or month is already filled doesn't ask for today.
  if (day === today) return { state: isDueOn(ctx, day) ? 'today' : 'open', ratio: 0 };
  if (day > today) return { state: 'open', ratio: 0 };
  return { state: isFlexible(ctx.rule) ? 'open' : 'missed', ratio: 0 };
}

/** Flexible rules: "This week 1/3" / "This month 4/10"; null for fixed rules. */
export function usePeriodLabel() {
  const f = useTF();
  return (habit: Habit, checkins: Parameters<typeof habitContext>[1], today: string): string | null => {
    const ctx = habitContext(habit, checkins);
    if (!isFlexible(ctx.rule)) return null;
    const { done, quota } = periodProgress(ctx, today);
    return f(ctx.rule.frequency === 'perWeek' ? 'habitWeekProgress' : 'habitMonthProgress', done, quota);
  };
}

// --- Dialog chrome ---

export function Dialog({
  children,
  onClose,
  width = 400,
  z = 'z-[55]',
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  width?: number;
  z?: string;
  label: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 ${z} flex items-center justify-center bg-black/10 px-4`} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100vh-32px)] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-[0_5px_18px_rgba(0,0,0,0.2)]"
        style={{ width }}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog onClose={onClose} width={360} z="z-[58]" label={title}>
      <div className="p-5">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <p className="mt-3 text-[13px] leading-5 text-ink-2">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 min-w-[82px] rounded-lg border border-black/10 px-3 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`h-8 min-w-[82px] rounded-lg px-3 text-[13px] font-medium text-white disabled:opacity-60 ${danger ? 'bg-p-high hover:opacity-90' : 'bg-tt hover:bg-tt-hover'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Check-in log (habit_records) ---

const LOG_FACES = ['😞', '😕', '😐', '🙂', '😄'];

/** A log's emoji value (0–100) as one of the five faces. */
export function logFace(emoji: number): string {
  return LOG_FACES[Math.min(4, Math.max(0, Math.round(emoji / 20) - 1))] ?? LOG_FACES[2];
}

function logSuppressed(): boolean {
  try {
    return localStorage.getItem('ntk_habit_log_suppressed') === '1';
  } catch {
    return false;
  }
}

export function HabitLogDialog({
  habit,
  day,
  record,
  prompted,
  onClose,
  onSaved,
}: {
  habit: Habit;
  day: string;
  record?: HabitRecord | null;
  /** Opened by a check-in (autoLog): offers "don't show again". */
  prompted?: boolean;
  onClose: () => void;
  onSaved?: (record: HabitRecord | null) => void;
}) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const [content, setContent] = useState(record?.content ?? '');
  const [emoji, setEmoji] = useState(record?.emoji ?? 80);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<HabitRecord | null>) => {
    setBusy(true);
    setError(null);
    try {
      // Not `onSaved?.(await action())`: an optional call skips its arguments.
      const saved = await action();
      onSaved?.(saved);
      onClose();
    } catch {
      setError(t('habitActionFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog onClose={onClose} width={440} z="z-[57]" label={t('habitLogTitle')}>
      <div className="p-5">
        <div className="flex items-center gap-3">
          <HabitAvatar habit={habit} size={30} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-semibold">{habit.name}</h2>
            <div className="text-[12px] text-ink-3">{t('habitLogTitle')} · {shortDate(day, lang)} {weekdayShort(day, lang)}</div>
          </div>
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"><X size={18} /></button>
        </div>
        <div className="mt-5 flex justify-center gap-3" role="radiogroup" aria-label={t('habitLogMood')}>
          {LOG_FACES.map((face, index) => {
            const value = (index + 1) * 20;
            return (
              <button
                key={face}
                type="button"
                role="radio"
                aria-label={face}
                aria-checked={emoji === value}
                onClick={() => setEmoji(value)}
                className={'flex h-9 w-9 items-center justify-center rounded-full text-[22px] ' + (emoji === value ? 'bg-tt-light ring-2 ring-tt' : 'bg-hover hover:bg-selected')}
              >
                {face}
              </button>
            );
          })}
        </div>
        <textarea
          autoFocus
          value={content}
          maxLength={8192}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t('habitLogPlaceholder')}
          aria-label={t('habitLogTitle')}
          className="mt-5 h-28 w-full rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-tt"
        />
        {error && <div className="mt-2 text-[12px] text-p-high">{error}</div>}
        <div className="mt-4 flex items-center gap-2">
          {prompted && (
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.setItem('ntk_habit_log_suppressed', '1');
                } catch {
                  // Storage may be off; closing the prompt still works.
                }
                onClose();
              }}
              className="text-[12px] text-ink-3 hover:text-tt"
            >
              {t('habitLogSuppress')}
            </button>
          )}
          {record && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(async () => {
                await api.deleteHabitRecord(habit.id, record.stamp);
                return null;
              })}
              className="text-[12px] text-p-high hover:underline"
            >
              {t('habitLogDelete')}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="h-8 min-w-[82px] rounded-lg border border-black/10 px-3 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => api.addHabitRecord(habit.id, dayToStamp(day), content, emoji))}
              className="h-8 min-w-[82px] rounded-lg bg-tt px-3 text-[13px] font-medium text-white hover:bg-tt-hover disabled:opacity-60"
            >
              {t('habitSave')}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// --- A count habit's day: progress, entries, add / edit / remove ---

function parseAmount(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() && Number.isFinite(value) && value > 0 && value <= 1_000_000 ? value : null;
}

function HabitDayDialog({
  habit,
  day,
  focusAmount,
  onClose,
  onReset,
  onGoalMet,
}: {
  habit: Habit;
  day: string;
  focusAmount?: boolean;
  onClose: () => void;
  onReset: () => void;
  onGoalMet: () => void;
}) {
  const t = useT();
  const f = useTF();
  const lang = useI18n((s) => s.lang);
  const unitOf = useHabitUnit();
  const stamp = dayToStamp(day);
  const checkins = useHabitStore((s) => s.checkins[habit.id]);
  const entries = useHabitStore((s) => s.entries[entryKey(habit.id, stamp)]);
  const { loadEntries, addEntry, updateEntry, removeEntry } = useHabitStore.getState();
  const [amount, setAmount] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string; clock: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const unit = unitOf(habit);
  const step = habitStep(habit);
  const { value, goal, met } = progressOn(habitContext(habit, checkins), day);
  const listed = (entries ?? []).reduce((sum, entry) => sum + entry.value, 0);
  const unitemized = Math.round((value - listed) * 1e6) / 1e6;

  useEffect(() => {
    if (!entries) void loadEntries(habit.id, stamp).catch(() => setError(t('habitActionFailed')));
    if (focusAmount) amountRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit.id, stamp]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const wasMet = met;
    try {
      await action();
      const now = progressOn(habitContext(habit, useHabitStore.getState().checkins[habit.id]), day);
      if (!wasMet && now.met) onGoalMet();
    } catch {
      setError(t('habitActionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const add = (event?: FormEvent) => {
    event?.preventDefault();
    const parsed = parseAmount(amount);
    if (parsed == null) {
      setError(t('habitAmountInvalid'));
      return;
    }
    void run(async () => {
      await addEntry(habit, day, parsed);
      setAmount('');
    });
  };

  const saveEdit = (entry: HabitCheckinEntry) => {
    if (!editing) return;
    const parsed = parseAmount(editing.value);
    if (parsed == null || !/^\d{2}:\d{2}$/.test(editing.clock)) {
      setError(t('habitAmountInvalid'));
      return;
    }
    const patch = {
      ...(parsed !== entry.value ? { value: parsed } : {}),
      ...(editing.clock !== localDayClock(entry.time)?.clock ? { time: entryTimeOn(day, editing.clock) } : {}),
    };
    if (!Object.keys(patch).length) {
      setEditing(null);
      return;
    }
    void run(async () => {
      await updateEntry(habit, entry, patch);
      setEditing(null);
    });
  };

  const sorted = [...(entries ?? [])].sort((a, b) => (localDayClock(a.time)?.clock ?? '').localeCompare(localDayClock(b.time)?.clock ?? ''));
  return (
    <Dialog onClose={onClose} width={400} label={habit.name}>
      <div className="flex items-center gap-3 px-5 pt-5">
        <HabitAvatar habit={habit} size={30} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold">{habit.name}</h2>
          <div className="text-[12px] text-ink-3">{shortDate(day, lang)} {weekdayShort(day, lang)}</div>
        </div>
        <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"><X size={18} /></button>
      </div>
      <div className="px-5 pt-4">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-ink-2">{t('habitCurrentProgress')}</span>
          <span><span className="text-[18px] font-semibold text-ink">{formatAmount(value)}</span><span className="text-ink-3"> / {formatAmount(goal)} {unit}</span></span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover"
          role="progressbar"
          aria-label={t('habitCurrentProgress')}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={value}
        >
          <div className="h-full rounded-full bg-tt transition-[width]" style={{ width: `${Math.min(100, (value / goal) * 100)}%` }} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
        <div className="text-[12px] font-medium text-ink-3">{t('habitEntries')}</div>
        {entries == null ? (
          <div className="py-3 text-[13px] text-ink-3">{t('loading')}</div>
        ) : sorted.length === 0 && unitemized <= 0 ? (
          <div className="py-3 text-[13px] text-ink-3">{t('habitNoEntries')}</div>
        ) : (
          <ul className="mt-1 divide-y divide-line/70">
            {sorted.map((entry) => {
              const clock = localDayClock(entry.time)?.clock ?? '--:--';
              if (editing?.id === entry.id) {
                return (
                  <li key={entry.id} className="flex h-11 items-center gap-2">
                    <input type="time" value={editing.clock} aria-label={t('habitEntryTime')} onChange={(event) => setEditing({ ...editing, clock: event.target.value })} className="h-8 w-[92px] rounded-lg border border-black/10 px-2 text-[13px] outline-none focus:border-tt" />
                    <input type="number" min="0" step="any" value={editing.value} aria-label={t('habitEntryAmount')} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') saveEdit(entry); }} className="h-8 min-w-0 flex-1 rounded-lg border border-black/10 px-2 text-[13px] outline-none focus:border-tt" />
                    <span className="shrink-0 text-[12px] text-ink-3">{unit}</span>
                    <button type="button" disabled={busy} onClick={() => saveEdit(entry)} title={t('habitSave')} aria-label={t('habitSave')} className="flex h-7 w-7 items-center justify-center rounded-md text-tt hover:bg-hover"><Check size={16} /></button>
                    <button type="button" onClick={() => setEditing(null)} title={t('cancel')} aria-label={t('cancel')} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover"><X size={15} /></button>
                  </li>
                );
              }
              return (
                <li key={entry.id} className="group flex h-11 items-center gap-3 text-[13px]">
                  <span className="w-11 shrink-0 tabular-nums text-ink-3">{clock}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">+{formatAmount(entry.value)} {unit}</span>
                  <button type="button" onClick={() => setEditing({ id: entry.id, value: String(entry.value), clock: localDayClock(entry.time)?.clock ?? '12:00' })} title={t('habitEntryEdit')} aria-label={t('habitEntryEdit')} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"><Pencil size={14} /></button>
                  <button type="button" disabled={busy} onClick={() => void run(() => removeEntry(habit, entry))} title={t('habitEntryRemove')} aria-label={t('habitEntryRemove')} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-p-high"><Trash2 size={14} /></button>
                </li>
              );
            })}
            {unitemized > 0 && (
              <li className="flex h-11 items-center gap-3 text-[13px] text-ink-3" title={t('habitUnitemizedHint')}>
                <span className="w-11 shrink-0">--:--</span>
                <span className="min-w-0 flex-1 truncate">+{formatAmount(unitemized)} {unit} · {t('habitUnitemized')}</span>
              </li>
            )}
          </ul>
        )}
      </div>
      <form onSubmit={add} className="flex items-center gap-2 px-5 pt-3">
        <button type="button" disabled={busy} onClick={() => void run(() => addEntry(habit, day, step))} className="h-8 shrink-0 rounded-lg bg-tt-light px-3 text-[13px] font-medium text-tt hover:opacity-90 disabled:opacity-60">
          +{formatAmount(step)} {unit}
        </button>
        <input
          ref={amountRef}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={amount}
          placeholder={t('habitAmountPh')}
          aria-label={t('habitEntryAmount')}
          onChange={(event) => { setAmount(event.target.value); setError(null); }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-black/10 px-3 text-[13px] outline-none focus:border-tt"
        />
        <button type="submit" disabled={busy} className="h-8 shrink-0 rounded-lg bg-tt px-3 text-[13px] font-medium text-white hover:bg-tt-hover disabled:opacity-60">{t('habitAddEntry')}</button>
      </form>
      {error && <div className="px-5 pt-2 text-[12px] text-p-high">{error}</div>}
      <div className="mt-4 flex h-[52px] shrink-0 items-center border-t border-line/70 px-5">
        <button type="button" disabled={value <= 0} onClick={onReset} className="text-[13px] text-p-high hover:underline disabled:cursor-default disabled:text-ink-3 disabled:no-underline">{t('habitReset')}</button>
        <span className="ml-3 text-[12px] text-ink-3">{met ? t('habitGoalMet') : f('habitRemaining', formatAmount(Math.max(0, goal - value)), unit)}</span>
        <button type="button" onClick={onClose} className="ml-auto h-8 min-w-[82px] rounded-lg border border-black/10 px-3 text-[13px] text-ink-2 hover:bg-hover">{t('habitDone')}</button>
      </div>
    </Dialog>
  );
}

// --- The check-in action, shared by every place that checks habits in ---

type Target = { habit: Habit; day: string };

/**
 * `act(habit, day)` checks a habit in the way its target and record mode ask
 * for: a boolean habit completes the day (a done day asks before resetting,
 * or toggles straight off with `quick`); a count habit adds its step (auto),
 * opens the day to enter an amount (manual) or completes the rest of the goal
 * (complete); a done count day opens its entries. Render `ui` once.
 */
export function useHabitCheckin() {
  const t = useT();
  const f = useTF();
  const lang = useI18n((s) => s.lang);
  const unitOf = useHabitUnit();
  const [dayTarget, setDayTarget] = useState<(Target & { focusAmount?: boolean }) | null>(null);
  const [resetTarget, setResetTarget] = useState<Target | null>(null);
  const [logTarget, setLogTarget] = useState<(Target & { record?: HabitRecord | null; prompted?: boolean; onSaved?: (record: HabitRecord | null) => void }) | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const showToast = (text: string, undo?: () => Promise<void>) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };

  const promptLog = (habit: Habit, day: string, rule: HabitRule) => {
    if (rule.autoLog && !logSuppressed()) setLogTarget({ habit, day, prompted: true });
  };

  const act = async (habit: Habit, day: string, options: { quick?: boolean } = {}) => {
    const key = `${habit.id}:${day}`;
    if (busyKey === key || day > todayStr()) return;
    const store = useHabitStore.getState();
    const rule = parseHabitRule(habit);
    const ctx = habitContext(habit, store.checkins[habit.id]);
    const { value, goal, met } = progressOn(ctx, day);
    if (!met && value <= 0 && !isPlannedDay(rule, day)) return;
    if (rule.target === 'count' && (met || rule.recordMode === 'manual')) {
      setDayTarget({ habit, day, focusAmount: !met });
      return;
    }
    if (rule.target === 'complete' && met && !options.quick) {
      setResetTarget({ habit, day });
      return;
    }
    setBusyKey(key);
    try {
      if (rule.target === 'complete') {
        await store.setDayValue(habit, day, met ? 0 : effectiveGoal(null, habit.goal), met ? 0 : 2);
        if (!met) promptLog(habit, day, rule);
        return;
      }
      const amount = rule.recordMode === 'complete' ? Math.max(0, goal - value) : habitStep(habit);
      if (amount <= 0) {
        setDayTarget({ habit, day });
        return;
      }
      const entry = await store.addEntry(habit, day, amount);
      if (entry) {
        showToast(f('habitEntryAdded', `${formatAmount(amount)} ${unitOf(habit)}`, habit.name), async () => {
          await useHabitStore.getState().removeEntry(habit, entry);
        });
      }
      if (progressOn(habitContext(habit, useHabitStore.getState().checkins[habit.id]), day).met) promptLog(habit, day, rule);
    } catch {
      showToast(t('habitActionFailed'));
    } finally {
      setBusyKey(null);
    }
  };

  const reset = async (target: Target) => {
    const key = `${target.habit.id}:${target.day}`;
    setBusyKey(key);
    try {
      await useHabitStore.getState().setDayValue(target.habit, target.day, 0, 0);
      setResetTarget(null);
    } catch {
      showToast(t('habitActionFailed'));
    } finally {
      setBusyKey(null);
    }
  };

  const ui = (
    <>
      {dayTarget && (
        <HabitDayDialog
          habit={dayTarget.habit}
          day={dayTarget.day}
          focusAmount={dayTarget.focusAmount}
          onClose={() => setDayTarget(null)}
          onReset={() => setResetTarget({ habit: dayTarget.habit, day: dayTarget.day })}
          onGoalMet={() => promptLog(dayTarget.habit, dayTarget.day, parseHabitRule(dayTarget.habit))}
        />
      )}
      {resetTarget && (
        <ConfirmDialog
          title={t('habitResetTitle')}
          message={f('habitResetMessage', shortDate(resetTarget.day, lang))}
          confirmLabel={t('habitReset')}
          busy={busyKey === `${resetTarget.habit.id}:${resetTarget.day}`}
          onClose={() => setResetTarget(null)}
          onConfirm={() => void reset(resetTarget)}
        />
      )}
      {logTarget && (
        <HabitLogDialog
          habit={logTarget.habit}
          day={logTarget.day}
          record={logTarget.record}
          prompted={logTarget.prompted}
          onClose={() => setLogTarget(null)}
          onSaved={logTarget.onSaved}
        />
      )}
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[60] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-full bg-[#191919] px-5 py-2.5 text-[13px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.3)] ring-1 ring-white/10">
          <span className="truncate">{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium hover:bg-white/25"
              onClick={() => {
                const undo = toast.undo;
                setToast(null);
                void undo?.().catch(() => showToast(t('habitActionFailed')));
              }}
            >
              <Undo2 size={12} /> {t('undo')}
            </button>
          )}
          <button type="button" aria-label={t('close')} className="shrink-0 text-white/60 hover:text-white" onClick={() => setToast(null)}>
            <X size={13} />
          </button>
        </div>
      )}
    </>
  );

  return {
    act,
    busyKey,
    /** Open a count habit's day (entries) directly. */
    openDay: (habit: Habit, day: string) => setDayTarget({ habit, day }),
    /** Write or edit the log of a day. */
    openLog: (habit: Habit, day: string, record?: HabitRecord | null, onSaved?: (record: HabitRecord | null) => void) =>
      setLogTarget({ habit, day, record, onSaved }),
    ui,
  };
}

