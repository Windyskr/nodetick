import { useState, type FormEvent, type ReactNode } from 'react';
import { Bell, ChevronDown, HelpCircle, Pencil, Plus, X } from 'lucide-react';
import { useT } from '../../i18n';
import { todayStr } from '../../lib/date';
import {
  formatHabitRule,
  parseHabitRule,
  WEEKDAY_CODES,
  type HabitFrequency,
  type HabitRecordMode,
  type HabitRule,
  type HabitTarget,
  type WeekdayCode,
} from '../../lib/habits';
import type { Habit } from '../../lib/types';
import { HABIT_COLORS, habitEmoji, useDayLabel } from './HabitCheckin';

const ICONS = ['😊', '📚', '💧', '🏃', '🧘', '🌙', '❤️', '✅', '🎵', '🥗', '✍️', '🧹'];
const DURATION_PRESETS = ['7', '21', '30', '100', '365'] as const;
type Duration = 'forever' | (typeof DURATION_PRESETS)[number] | 'custom';

/** TickTick's built-in habit sections; any other sectionId (TickTick uses "-1") is "Others". */
export const HABIT_SECTIONS = ['_morning', '_afternoon', '_night', '-1'] as const;
export type HabitSection = (typeof HABIT_SECTIONS)[number];

export function habitSection(habit: Pick<Habit, 'sectionId'>): HabitSection {
  const id = habit.sectionId ?? '';
  return (HABIT_SECTIONS as readonly string[]).includes(id) ? (id as HabitSection) : '-1';
}

const HHMM = /^\d{2}:\d{2}$/;

/** A positive whole number up to `max`, else null. */
function wholeNumber(raw: string, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value > 0 && value <= max ? value : null;
}

/** A positive amount (decimals allowed) up to a million, else null. */
function amount(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() && Number.isFinite(value) && value > 0 && value <= 1_000_000 ? value : null;
}

function FieldRow({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={'flex min-w-0 items-center px-1 ' + className}>
      <span className="mr-4 w-[78px] shrink-0 pr-2 text-[13px] leading-4 text-ink">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SelectField({ value, options, onChange, ariaLabel }: {
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
      <ChevronDown size={12} className="pointer-events-none absolute right-3 top-2.5 text-ink-3" />
    </div>
  );
}

function NumberInput({ value, onChange, label, step = '1', className = 'w-20' }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  step?: string;
  className?: string;
}) {
  return (
    <input
      type="number"
      min="0"
      step={step}
      inputMode={step === '1' ? 'numeric' : 'decimal'}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className={`h-8 rounded-lg border border-black/10 px-3 text-[13px] outline-none focus:border-tt ${className}`}
    />
  );
}

const REMINDER_PRESETS = Array.from({ length: 48 }, (_, index) =>
  `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);

/**
 * Create or edit a habit. Editing starts from the parsed rule and writes it
 * back with formatHabitRule, so rule lines and reminders this form doesn't
 * know (from TickTick clients or the CLI) survive the save.
 */
export default function HabitForm({ habit, onClose, onSave }: {
  habit?: Habit | null;
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const dayLabel = useDayLabel();
  const original: HabitRule | null = habit ? parseHabitRule(habit) : null;
  const durationDays = original?.durationDays ?? null;
  const initialDuration: Duration = durationDays == null
    ? 'forever'
    : (DURATION_PRESETS as readonly string[]).includes(String(durationDays)) ? (String(durationDays) as Duration) : 'custom';

  const [name, setName] = useState(habit?.name ?? '');
  const [encouragement, setEncouragement] = useState(habit?.encouragement ?? '');
  const [frequency, setFrequency] = useState<HabitFrequency>(original?.frequency ?? 'daily');
  const [weekdays, setWeekdays] = useState<WeekdayCode[]>(original?.frequency === 'weekly' ? original.weekdays : [...WEEKDAY_CODES]);
  const [interval, setIntervalDays] = useState(String(original?.frequency === 'interval' ? original.interval : 2));
  const [weekTimes, setWeekTimes] = useState(String(original?.frequency === 'perWeek' ? original.times : 3));
  const [monthTimes, setMonthTimes] = useState(String(original?.frequency === 'perMonth' ? original.times : 10));
  const [target, setTarget] = useState<HabitTarget>(original?.target ?? 'complete');
  const [recordMode, setRecordMode] = useState<HabitRecordMode>(original?.recordMode ?? 'auto');
  // A habit saved without a start date (CLI, TickTick clients) keeps none until one is picked.
  const [startDate, setStartDate] = useState(original ? original.startDate ?? '' : todayStr());
  const [duration, setDuration] = useState<Duration>(initialDuration);
  const [customDays, setCustomDays] = useState(initialDuration === 'custom' ? String(durationDays) : '14');
  const [goal, setGoal] = useState(String(original?.target === 'count' && habit?.goal ? habit.goal : 1));
  const [step, setStep] = useState(String(habit?.step && habit.step > 0 ? habit.step : 1));
  const [unit, setUnit] = useState(habit?.unit && habit.unit.toLowerCase() !== 'count' ? habit.unit : '');
  const [section, setSection] = useState<HabitSection>(habit ? habitSection(habit) : '-1');
  const [reminders, setReminders] = useState<string[]>((habit?.reminders ?? []).filter((item) => HHMM.test(item)));
  const [reminderPicker, setReminderPicker] = useState(false);
  const [customReminder, setCustomReminder] = useState('');
  const [autoLog, setAutoLog] = useState(original?.autoLog ?? false);
  const [color, setColor] = useState(habit?.color ?? HABIT_COLORS[0]);
  /** null keeps a habit's non-emoji icon (TickTick's built-in ones) untouched. */
  const [icon, setIcon] = useState<string | null>(habit ? habitEmoji(habit.iconRes) : ICONS[0]);
  const [showLook, setShowLook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fail = (message: string) => {
    setError(message);
    return false;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) return fail(t('habitNameRequired'));
    if (trimmed.length > 256) return fail(t('habitNameTooLong'));
    if (!startDate && !habit) return fail(t('habitStartRequired'));
    if (frequency === 'weekly' && weekdays.length === 0) return fail(t('habitPickWeekday'));
    const intervalValue = wholeNumber(interval, 365);
    const weekValue = wholeNumber(weekTimes, 7);
    const monthValue = wholeNumber(monthTimes, 31);
    if (frequency === 'interval' && intervalValue == null) return fail(t('habitIntervalInvalid'));
    if (frequency === 'perWeek' && weekValue == null) return fail(t('habitWeekTimesInvalid'));
    if (frequency === 'perMonth' && monthValue == null) return fail(t('habitMonthTimesInvalid'));
    const goalValue = target === 'count' ? amount(goal) : 1;
    const stepValue = target === 'count' ? amount(step) : 0;
    if (goalValue == null || stepValue == null) return fail(t('habitAmountsInvalid'));
    const days = duration === 'forever' ? null : duration === 'custom' ? wholeNumber(customDays, 3650) : Number(duration);
    if (duration === 'custom' && days == null) return fail(t('habitDurationInvalid'));
    // The duration counts from the start date.
    if (days != null && !startDate) return fail(t('habitStartRequired'));
    if (encouragement.trim().length > 512) return fail(t('habitEncouragementTooLong'));

    // "Every 1 day" is every day.
    const effective: HabitFrequency = frequency === 'interval' && intervalValue === 1 ? 'daily' : frequency;
    const base = original ?? parseHabitRule({ repeatRule: null, type: null, goal: null, step: null });
    const next: HabitRule = {
      ...base,
      frequency: effective,
      weekdays: effective === 'weekly' ? weekdays : [...WEEKDAY_CODES],
      interval: effective === 'interval' ? intervalValue! : 1,
      times: effective === 'perWeek' ? weekValue! : effective === 'perMonth' ? monthValue! : 1,
      startDate: startDate || null,
      durationDays: days,
      target,
      recordMode,
      autoLog,
    };
    const otherReminders = (habit?.reminders ?? []).filter((item) => !HHMM.test(item));
    setSaving(true);
    try {
      await onSave({
        name: trimmed,
        encouragement: encouragement.trim(),
        iconRes: icon ? `emoji:${icon}` : habit?.iconRes ?? `emoji:${ICONS[0]}`,
        color,
        goal: goalValue,
        step: stepValue,
        unit: target === 'count' ? unit.trim() || 'Count' : 'Count',
        type: target === 'count' ? 'Real' : 'Boolean',
        repeatRule: formatHabitRule(next, original),
        reminders: [...[...reminders].sort(), ...otherReminders],
        sectionId: section,
        ...(habit ? {} : { style: 1 }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('habitActionFailed'));
    } finally {
      setSaving(false);
    }
    return true;
  };

  const addReminder = (value: string) => {
    if (!HHMM.test(value)) return;
    setReminders((current) => (current.includes(value) ? current : [...current, value].sort()));
    setReminderPicker(false);
    setCustomReminder('');
  };

  const weekdayLetter = (code: WeekdayCode) => {
    const day = 15 + WEEKDAY_CODES.indexOf(code); // 2026-11-15 is a Sunday
    return new Intl.DateTimeFormat(t('habitLocale'), { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, day)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 px-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={habit ? t('habitEditTitle') : t('habitAddTitle')}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
        onSubmit={(event) => void submit(event)}
        className="relative flex max-h-[calc(100vh-32px)] w-[460px] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_5px_18px_rgba(0,0,0,0.2)]"
      >
        <div className="flex h-14 shrink-0 items-center px-5">
          <h2 className="text-[16px] font-bold">{habit ? t('habitEditTitle') : t('habitAddTitle')}</h2>
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"><X size={18} /></button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 pb-2">
          {error && <div role="alert" className="mb-2 rounded-lg bg-[#fdf0f0] px-3 py-2 text-[13px] text-p-high">{error}</div>}

          <div className="mb-3 flex h-10 items-center px-1">
            <div className="relative mr-4 w-[78px] shrink-0">
              <button type="button" title={t('habitColor')} aria-label={t('habitColor')} aria-expanded={showLook} onClick={() => setShowLook((value) => !value)} className="relative flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ backgroundColor: color }}>
                <span className="leading-none" style={{ fontSize: 21 }}>{icon ?? habitEmoji(habit?.iconRes) ?? ICONS[0]}</span>
                <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-ink-3 shadow-sm"><Pencil size={9} /></span>
              </button>
              {showLook && (
                <div className="absolute left-0 top-10 z-10 w-[164px] rounded-lg border border-line bg-white p-2 shadow-lg">
                  <div className="mb-2 grid grid-cols-6 gap-1.5">
                    {HABIT_COLORS.map((item) => <button key={item} type="button" aria-label={item} aria-pressed={color === item} onClick={() => setColor(item)} className={'h-5 w-5 rounded-full ' + (color === item ? 'ring-2 ring-tt ring-offset-1' : '')} style={{ backgroundColor: item }} />)}
                  </div>
                  <div className="grid grid-cols-6 gap-1.5 border-t border-line pt-2">
                    {ICONS.map((item) => <button key={item} type="button" aria-label={item} aria-pressed={icon === item} onClick={() => { setIcon(item); setShowLook(false); }} className={'flex h-6 w-6 items-center justify-center rounded-md text-[16px] hover:bg-hover ' + (icon === item ? 'bg-tt-light' : '')}>{item}</button>)}
                  </div>
                </div>
              )}
            </div>
            <input autoFocus value={name} maxLength={256} placeholder={t('habitNamePh')} aria-label={t('habitName')} onChange={(event) => { setName(event.target.value); setError(null); }} className="h-8 min-w-0 flex-1 rounded-lg border border-tt px-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-tt" />
          </div>

          <FieldRow label={t('habitEncouragement')} className="mb-2 h-8">
            <input value={encouragement} maxLength={512} placeholder={t('habitEncouragementPh')} aria-label={t('habitEncouragement')} onChange={(event) => setEncouragement(event.target.value)} className="h-8 w-full rounded-lg border border-black/10 px-3 text-[13px] outline-none placeholder:text-ink-3 focus:border-tt" />
          </FieldRow>

          <FieldRow label={t('habitFrequency')} className="mb-2 min-h-8 items-start">
            <SelectField
              ariaLabel={t('habitFrequency')}
              value={frequency}
              onChange={(value) => setFrequency(value as HabitFrequency)}
              options={[
                { value: 'daily', label: t('habitEveryDay') },
                { value: 'weekly', label: t('habitSpecificDays') },
                { value: 'perWeek', label: t('habitDaysPerWeek') },
                { value: 'perMonth', label: t('habitDaysPerMonth') },
                { value: 'interval', label: t('habitEveryInterval') },
              ]}
            />
            {frequency === 'weekly' && (
              <div className="mt-2 flex items-center gap-1" role="group" aria-label={t('habitSelectDays')}>
                {WEEKDAY_CODES.map((code) => {
                  const selected = weekdays.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setWeekdays((current) => (selected ? current.filter((item) => item !== code) : WEEKDAY_CODES.filter((item) => item === code || current.includes(item))))}
                      className={'flex h-7 w-7 items-center justify-center rounded-full text-[12px] ' + (selected ? 'bg-tt text-white' : 'bg-hover text-ink-3 hover:text-ink')}
                    >
                      {weekdayLetter(code)}
                    </button>
                  );
                })}
              </div>
            )}
            {frequency === 'perWeek' && (
              <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                <span>{t('habitPerWeekPrefix')}</span>
                <NumberInput value={weekTimes} onChange={setWeekTimes} label={t('habitDaysPerWeek')} />
                <span>{t('habitPerWeekSuffix')}</span>
              </div>
            )}
            {frequency === 'perMonth' && (
              <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                <span>{t('habitPerMonthPrefix')}</span>
                <NumberInput value={monthTimes} onChange={setMonthTimes} label={t('habitDaysPerMonth')} />
                <span>{t('habitPerMonthSuffix')}</span>
              </div>
            )}
            {frequency === 'interval' && (
              <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                <span>{t('habitIntervalLabel')}</span>
                <NumberInput value={interval} onChange={setIntervalDays} label={t('habitEveryInterval')} />
                <span>{t('habitDays')}</span>
              </div>
            )}
          </FieldRow>

          <FieldRow label={t('habitTarget')} className="mb-2 min-h-8 items-start">
            <SelectField ariaLabel={t('habitTarget')} value={target} onChange={(value) => setTarget(value as HabitTarget)} options={[{ value: 'complete', label: t('habitCompleteDaily') }, { value: 'count', label: t('habitCountTarget') }]} />
            {target === 'count' && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2 text-[13px] text-ink-2">
                  <span className="shrink-0">{t('habitDailyGoal')}</span>
                  <NumberInput value={goal} onChange={setGoal} label={t('habitDailyGoal')} step="any" />
                  <input value={unit} maxLength={64} placeholder={t('habitUnitPh')} aria-label={t('habitUnitLabel')} onChange={(event) => setUnit(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-black/10 px-3 text-[13px] outline-none placeholder:text-ink-3 focus:border-tt" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[13px] text-ink-2">{t('habitRecordMode')}</span>
                  <SelectField ariaLabel={t('habitRecordMode')} value={recordMode} onChange={(value) => setRecordMode(value as HabitRecordMode)} options={[{ value: 'auto', label: t('habitRecordAuto') }, { value: 'manual', label: t('habitRecordManual') }, { value: 'complete', label: t('habitRecordComplete') }]} />
                </div>
                {recordMode === 'auto' && (
                  <div className="flex items-center gap-2 text-[13px] text-ink-2">
                    <span className="shrink-0">{t('habitStep')}</span>
                    <NumberInput value={step} onChange={setStep} label={t('habitStep')} step="any" />
                    <span className="truncate">{unit.trim() || t('habitUnit')}</span>
                  </div>
                )}
              </div>
            )}
          </FieldRow>

          <FieldRow label={t('habitStartDate')} className="mb-2 h-8">
            <div className="relative h-8 w-full">
              <div className="flex h-8 items-center rounded-lg border border-black/10 px-3 text-[13px] text-ink">{startDate ? dayLabel(startDate) : <span className="text-ink-3">{t('habitNoStartDate')}</span>}</div>
              <input aria-label={t('habitStartDate')} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="absolute inset-0 h-8 w-full cursor-pointer opacity-0" />
              <ChevronDown size={12} className="pointer-events-none absolute right-3 top-2.5 text-ink-3" />
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
            {duration === 'custom' && (
              <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                <NumberInput value={customDays} onChange={setCustomDays} label={t('habitCustomDays')} className="w-24" />
                <span>{t('habitDays')}</span>
              </div>
            )}
          </FieldRow>

          <FieldRow label={t('habitGroup')} className="mb-2 h-8">
            <SelectField
              ariaLabel={t('habitGroup')}
              value={section}
              onChange={(value) => setSection(value as HabitSection)}
              options={[
                { value: '_morning', label: t('habitSectionMorning') },
                { value: '_afternoon', label: t('habitSectionAfternoon') },
                { value: '_night', label: t('habitSectionNight') },
                { value: '-1', label: t('habitOther') },
              ]}
            />
          </FieldRow>

          <FieldRow label={t('habitReminder')} className="mb-2 min-h-[37px] items-start">
            <div className="flex min-h-[37px] flex-wrap items-center gap-2">
              {reminders.map((reminder) => (
                <button key={reminder} type="button" title={t('habitRemoveReminder')} onClick={() => setReminders((items) => items.filter((item) => item !== reminder))} className="flex h-8 items-center gap-1 rounded-lg border border-black/10 px-2 text-[13px] text-ink-2 hover:border-tt">
                  <Bell size={13} /> {reminder} <X size={12} />
                </button>
              ))}
              <div className="relative">
                <button type="button" title={t('habitAddReminder')} aria-label={t('habitAddReminder')} aria-expanded={reminderPicker} onClick={() => setReminderPicker((value) => !value)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 text-ink-3 hover:border-tt hover:text-tt"><Plus size={19} /></button>
                {reminderPicker && (
                  <div className="absolute left-0 top-9 z-20 w-36 rounded-lg border border-line bg-white py-1 shadow-lg">
                    <div className="flex items-center gap-1 border-b border-line px-2 pb-1">
                      <input type="time" value={customReminder} aria-label={t('habitReminderTime')} onChange={(event) => setCustomReminder(event.target.value)} className="h-7 min-w-0 flex-1 rounded border border-black/10 px-1 text-[12px] outline-none focus:border-tt" />
                      <button type="button" onClick={() => addReminder(customReminder)} title={t('habitAddReminder')} aria-label={t('habitAddReminder')} className="flex h-7 w-7 items-center justify-center rounded text-tt hover:bg-hover"><Plus size={15} /></button>
                    </div>
                    <div className="max-h-44 overflow-y-auto">
                      {REMINDER_PRESETS.map((option) => <button key={option} type="button" onClick={() => addReminder(option)} className="block w-full px-3 py-1.5 text-left text-[12px] text-ink-2 hover:bg-hover">{option}</button>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </FieldRow>

          <div className="mb-3 mt-3 h-px w-full bg-black/10" />
          <label className="mb-2 flex h-[30px] cursor-pointer items-center gap-2 px-1 text-[13px] text-ink-2" title={t('habitAutoLogHint')}>
            <input type="checkbox" checked={autoLog} onChange={(event) => setAutoLog(event.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-tt)]" />
            {t('habitAutoLog')}
            <HelpCircle size={14} className="text-ink-3" aria-hidden="true" />
          </label>
        </div>

        <div className="flex h-[58px] shrink-0 items-center justify-end gap-2 px-5">
          <button type="button" onClick={onClose} className="h-[30px] min-w-[100px] rounded-lg border border-black/10 px-4 text-[14px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
          <button type="submit" disabled={saving} className="h-[30px] min-w-[100px] rounded-lg bg-tt px-4 text-[14px] font-medium text-white hover:bg-tt-hover disabled:opacity-60">{t('habitSave')}</button>
        </div>
      </form>
    </div>
  );
}
