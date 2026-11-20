import { useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Countdown } from '../../lib/types';
import { dayOf } from '../../lib/date';
import { COUNTDOWN_KINDS, REMINDER_TOKENS, type CountdownKind } from '../../lib/countdown';
import {
  LUNAR_FIRST_DAY,
  LUNAR_LAST_DAY,
  LUNAR_MAX_YEAR,
  LUNAR_MIN_YEAR,
  leapMonthOf,
  lunarDayName,
  lunarMonthDays,
  lunarMonthName,
  lunarMonthsOf,
  lunarToSolar,
  lunarYearName,
  solarToLunar,
} from '../../lib/lunar';
import { useEscape } from '../../lib/useEscape';
import { CountdownCard } from './CountdownCard';
import { COUNTDOWN_COLORS, countdownIcon, KIND_ICON, KIND_KEY, REMINDER_KEY, STYLE_KEYS, useCountdownText } from './countdownText';

/** The fields the editor owns; pin, archive and order are changed elsewhere. */
export type CountdownDraft = Pick<Countdown,
  'name' | 'date' | 'kind' | 'reminders' | 'reminderTime' | 'repeatFlag' | 'lunar' | 'calculation'
  | 'style' | 'color' | 'icon' | 'numberFormat' | 'note' | 'showInCalendar'>;

const KIND_COLOR: Record<CountdownKind, string> = { countdown: '#4772FA', anniversary: '#E5484D', birthday: '#EC4899', holiday: '#F59E0B' };

export const ICON_CHOICES = [
  '⏳', '🎂', '💞', '🎉', '🎁', '💍', '❤️', '👶', '🎓', '✈️', '🏖️', '🏠', '💼', '📅', '⭐', '🌙',
  '☀️', '🎄', '🧧', '🏮', '🥮', '🎆', '🍰', '🎈', '🚀', '🏆', '📚', '💪', '🐶', '🐱', '🌸', '🍀',
  '🎵', '⚽', '🎬', '🩺', '🧳', '🔔',
];

export function emptyDraft(kind: CountdownKind, today: string): CountdownDraft {
  return {
    name: '', date: today, kind, reminders: ['same-day', '3-days'], reminderTime: null,
    // Birthdays, anniversaries and holidays come back every year.
    repeatFlag: kind === 'countdown' ? null : 'yearly', lunar: false, calculation: 'standard',
    style: 0, color: KIND_COLOR[kind], icon: null, numberFormat: 'days', note: '', showInCalendar: true,
  };
}

export function draftOf(countdown: Countdown, today: string): CountdownDraft {
  return {
    name: countdown.name ?? '', date: dayOf(countdown.date) ?? today, kind: countdown.kind, reminders: countdown.reminders,
    reminderTime: countdown.reminderTime, repeatFlag: countdown.repeatFlag, lunar: countdown.lunar, calculation: countdown.calculation,
    style: countdown.style, color: countdown.color, icon: countdown.icon, numberFormat: countdown.numberFormat, note: countdown.note,
    showInCalendar: countdown.showInCalendar,
  };
}

const inLunarRange = (day: string | null) => Boolean(day && day >= LUNAR_FIRST_DAY && day <= LUNAR_LAST_DAY);

export default function CountdownEditor({ initial, kind, initialStep = 1, today, allDayTime, onClose, onSave }: {
  initial: Countdown | null;
  kind: CountdownKind;
  initialStep?: 1 | 2;
  today: string;
  allDayTime: string;
  onClose: () => void;
  onSave: (draft: CountdownDraft) => Promise<void>;
}) {
  const text = useCountdownText();
  const { t, f } = text;
  const [draft, setDraft] = useState<CountdownDraft>(() => (initial ? draftOf(initial, today) : emptyDraft(kind, today)));
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [iconsOpen, setIconsOpen] = useState(false);
  useEscape(onClose);
  const update = <K extends keyof CountdownDraft>(key: K, value: CountdownDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const valid = Boolean(draft.name?.trim() && draft.date && (!draft.lunar || inLunarRange(draft.date)));
  const preview: Countdown = {
    ...draft, name: draft.name?.trim() || t('eventNamePh'), id: initial?.id ?? 'preview', displayMode: initial?.displayMode ?? 'on-day',
    sortOrder: 0, pinned: false, archived: false, archivedTime: null, createdTime: initial?.createdTime ?? null,
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave({ ...draft, name: draft.name?.trim() ?? '', note: draft.note.trim() ? draft.note : '' });
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    if (step === 1 && !initial) setStep(2);
    else void save();
  };
  const setCalendar = (lunar: boolean) => setDraft((current) => ({
    ...current, lunar,
    // Lunar dates repeat yearly or not at all.
    repeatFlag: lunar && current.repeatFlag === 'monthly' ? 'yearly' : current.repeatFlag,
  }));
  const toggleReminder = (token: string) => update('reminders', draft.reminders.includes(token)
    ? draft.reminders.filter((item) => item !== token)
    : REMINDER_TOKENS.filter((item) => item === token || draft.reminders.includes(item)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4 py-4" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={step === 1 ? (initial ? t('editCountdown') : t('newCountdown')) : t('countdownStyle')}
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[440px] flex-col rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex h-14 shrink-0 items-center px-5">
          <h2 className="text-[17px] font-bold">{step === 1 ? (initial ? t('editCountdown') : t('newCountdown')) : t('countdownStyle')}</h2>
          <button type="button" title={t('close')} aria-label={t('close')} onClick={onClose} className="ml-auto rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink"><X size={19} /></button>
        </div>

        {step === 1 ? (
          <div className="min-h-0 space-y-3 overflow-y-auto px-6 pb-5">
            <div className="flex items-center gap-4">
              <button
                type="button"
                title={t('countdownIcon')}
                aria-label={t('countdownIcon')}
                aria-expanded={iconsOpen}
                onClick={() => setIconsOpen((open) => !open)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[20px] hover:ring-2 hover:ring-tt/30"
                style={{ backgroundColor: `color-mix(in srgb, ${draft.color} 16%, transparent)` }}
              >
                {countdownIcon(draft)}
              </button>
              <input
                autoFocus
                value={draft.name ?? ''}
                maxLength={128}
                onChange={(event) => update('name', event.target.value)}
                placeholder={t('eventNamePh')}
                aria-label={t('eventNamePh')}
                className="h-9 min-w-0 flex-1 border-b border-line bg-transparent px-1 text-[14px] outline-none focus:border-tt"
              />
            </div>
            {iconsOpen && <IconGrid value={draft.icon} kind={draft.kind} onChange={(icon) => { update('icon', icon); setIconsOpen(false); }} />}

            <Row label={t('countdownDate')} top>
              <div className="space-y-1.5">
                <Segmented
                  value={draft.lunar ? 'lunar' : 'solar'}
                  options={[{ value: 'solar', label: t('countdownSolar') }, { value: 'lunar', label: t('countdownLunar'), disabled: !inLunarRange(draft.date) }]}
                  onChange={(value) => setCalendar(value === 'lunar')}
                />
                {draft.lunar && inLunarRange(draft.date)
                  ? <LunarDatePicker value={draft.date!} onChange={(day) => update('date', day)} />
                  : <input type="date" required value={draft.date ?? ''} onChange={(event) => event.target.value && update('date', event.target.value)} className="field" aria-label={t('countdownDate')} />}
                <div className="text-[12px] text-ink-3">
                  {draft.date && (draft.lunar ? f('countdownSolarHint', text.date(draft.date, true)) : inLunarRange(draft.date) ? text.lunarOf(draft.date) : t('countdownLunarRange'))}
                </div>
              </div>
            </Row>

            <Row label={t('repeat')}>
              <select value={draft.repeatFlag ?? ''} onChange={(event) => update('repeatFlag', event.target.value || null)} className="field" aria-label={t('repeat')}>
                <option value="">{t('countdownRepeatNone')}</option>
                {!draft.lunar && <option value="monthly">{t('countdownMonthly')}</option>}
                <option value="yearly">{draft.lunar ? t('countdownLunarYearly') : t('countdownYearly')}</option>
              </select>
            </Row>

            <Row label={t('reminder')} top>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_TOKENS.map((token) => {
                  const on = draft.reminders.includes(token);
                  return (
                    <button
                      key={token}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleReminder(token)}
                      className={`h-7 rounded-full border px-2.5 text-[12px] transition-colors ${on ? 'border-tt bg-tt-light text-tt' : 'border-line text-ink-2 hover:bg-hover'}`}
                    >
                      {t(REMINDER_KEY[token])}
                    </button>
                  );
                })}
              </div>
              {draft.reminders.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="shrink-0 text-[12px] text-ink-3">{t('countdownReminderTime')}</span>
                  <select
                    value={draft.reminderTime == null ? 'default' : 'custom'}
                    onChange={(event) => update('reminderTime', event.target.value === 'custom' ? allDayTime : null)}
                    className="field !w-auto min-w-0"
                    aria-label={t('countdownReminderTime')}
                  >
                    <option value="default">{f('countdownReminderTimeDefault', allDayTime)}</option>
                    <option value="custom">{t('countdownReminderTimeCustom')}</option>
                  </select>
                  {draft.reminderTime != null && (
                    <input type="time" value={draft.reminderTime} onChange={(event) => event.target.value && update('reminderTime', event.target.value)} className="field !w-[104px]" aria-label={t('countdownReminderTime')} />
                  )}
                </div>
              )}
            </Row>

            <Row label={t('countdownType')}>
              <select value={draft.kind} onChange={(event) => update('kind', event.target.value as CountdownKind)} className="field" aria-label={t('countdownType')}>
                {COUNTDOWN_KINDS.map((value) => <option key={value} value={value}>{t(KIND_KEY[value])}</option>)}
              </select>
            </Row>

            <Row label={t('countdownCalculation')}>
              <select value={draft.calculation} onChange={(event) => update('calculation', event.target.value as CountdownDraft['calculation'])} className="field" aria-label={t('countdownCalculation')}>
                <option value="standard">{t('countdownStandard')}</option>
                <option value="workday">{t('countdownWorkday')}</option>
              </select>
            </Row>

            <Row label={t('countdownShowInCalendar')} inline>
              <Switch checked={draft.showInCalendar} label={t('countdownShowInCalendar')} onChange={(value) => update('showInCalendar', value)} />
            </Row>

            <textarea
              value={draft.note}
              maxLength={4000}
              rows={2}
              onChange={(event) => update('note', event.target.value)}
              placeholder={t('countdownNotePh')}
              aria-label={t('countdownNote')}
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] outline-none focus:border-tt"
            />
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto px-6 pb-5">
            <div className="mx-auto w-full max-w-[296px]"><CountdownCard countdown={preview} today={today} /></div>
            <Section label={t('countdownStyle')}>
              <div className="flex flex-wrap gap-2">
                {STYLE_KEYS.map((key, style) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={draft.style === style}
                    onClick={() => update('style', style)}
                    className="shrink-0 text-center"
                  >
                    {/* A real card at 70/296 scale: all five fit one row of the dialog. */}
                    <span className={`relative block h-[45px] w-[70px] overflow-hidden rounded-md border ${draft.style === style ? 'border-tt ring-2 ring-tt/40' : 'border-line'}`}>
                      <span className="pointer-events-none absolute left-0 top-0 block w-[296px] origin-top-left scale-[0.2365]" aria-hidden="true">
                        <CountdownCard countdown={{ ...preview, style }} today={today} />
                      </span>
                    </span>
                    <span className={`mt-1 block text-[12px] ${draft.style === style ? 'font-medium text-tt' : 'text-ink-2'}`}>{t(key)}</span>
                  </button>
                ))}
              </div>
            </Section>
            <Section label={t('countdownColor')}>
              <div className="flex flex-wrap gap-2">
                {COUNTDOWN_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={color}
                    aria-pressed={draft.color.toUpperCase() === color}
                    onClick={() => update('color', color)}
                    className={`h-6 w-6 rounded-full ${draft.color.toUpperCase() === color ? 'ring-2 ring-offset-2 ring-offset-[var(--nt-surface)]' : ''}`}
                    style={{ backgroundColor: color, ['--tw-ring-color' as string]: color }}
                  />
                ))}
              </div>
            </Section>
            <Section label={t('countdownNumberFormat')}>
              <Segmented
                value={draft.numberFormat}
                options={[{ value: 'days', label: t('countdownFormatDays') }, { value: 'ymd', label: t('countdownFormatYmd'), disabled: draft.calculation === 'workday' }]}
                onChange={(value) => update('numberFormat', value as CountdownDraft['numberFormat'])}
              />
            </Section>
            <Section label={t('countdownIcon')}>
              <IconGrid value={draft.icon} kind={draft.kind} onChange={(icon) => update('icon', icon)} />
            </Section>
          </div>
        )}

        <div className="flex min-h-[58px] shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {failed && <span role="alert" className="mr-auto text-[12px] text-p-high">{t('countdownSaveFailed')}</span>}
          <button type="button" onClick={() => (step === 1 ? onClose() : setStep(1))} className="h-[30px] min-w-[88px] rounded-md border border-line px-3 text-[13px] hover:bg-hover">
            {step === 1 ? t('cancel') : t('countdownBack')}
          </button>
          {/* Distinct keys: if React reused the "Next" element as the submit
              button, the click that switches steps would also submit the form. */}
          {step === 1 && (
            <button key="next" type="button" disabled={!valid} onClick={() => setStep(2)} className={`h-[30px] min-w-[88px] rounded-md px-3 text-[13px] disabled:opacity-40 ${initial ? 'border border-line hover:bg-hover' : 'bg-tt text-white hover:bg-tt-hover'}`}>
              {t('countdownNext')}
            </button>
          )}
          {(step === 2 || initial) && (
            <button key="save" type="submit" disabled={!valid || saving} className="h-[30px] min-w-[88px] rounded-md bg-tt px-3 text-[13px] text-white hover:bg-tt-hover disabled:opacity-40">
              {initial ? t('save') : t('confirm')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Label beside the control; on phones (< 480px) above it, unless `inline`. */
function Row({ label, top = false, inline = false, children }: { label: string; top?: boolean; inline?: boolean; children: ReactNode }) {
  // Literal class names: Tailwind only generates classes it finds in the source.
  const layout = inline
    ? 'flex-row items-center gap-3'
    : `flex-col gap-1 min-[480px]:flex-row min-[480px]:gap-3 ${top ? 'min-[480px]:items-start' : 'min-[480px]:items-center'}`;
  const labelWidth = inline ? 'w-[84px]' : `min-[480px]:w-[84px] ${top ? 'min-[480px]:pt-2' : ''}`;
  return (
    <div className={`flex min-h-8 ${layout}`}>
      <span className={`shrink-0 text-[13px] leading-4 text-ink-2 ${labelWidth}`}>{label}</span>
      <div className="min-w-0 flex-1 [&_.field]:h-8 [&_.field]:w-full [&_.field]:rounded-md [&_.field]:border [&_.field]:border-line [&_.field]:bg-white [&_.field]:px-2 [&_.field]:text-[13px]">{children}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[13px] font-medium text-ink-2">{label}</h3>
      {children}
    </section>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: string; disabled?: boolean }[]; onChange: (value: string) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-hover p-0.5 text-[12px]" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={`h-7 rounded-md px-3 transition-colors disabled:opacity-40 ${value === option.value ? 'bg-white font-medium text-tt shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-ink-2 hover:text-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-tt' : 'bg-[#d4d4d4]'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function IconGrid({ value, kind, onChange }: { value: string | null; kind: CountdownKind; onChange: (icon: string | null) => void }) {
  const { t } = useCountdownText();
  const cell = (selected: boolean) => `flex h-9 w-9 items-center justify-center rounded-lg text-[19px] transition-colors ${selected ? 'bg-tt-light ring-1 ring-tt' : 'hover:bg-hover'}`;
  return (
    <div className="flex flex-wrap gap-1" role="listbox" aria-label={t('countdownIcon')}>
      <button type="button" role="option" aria-selected={value == null} title={t('countdownIconDefault')} aria-label={t('countdownIconDefault')} onClick={() => onChange(null)} className={cell(value == null)}>
        {KIND_ICON[kind]}
      </button>
      {ICON_CHOICES.map((icon) => (
        <button key={icon} type="button" role="option" aria-selected={value === icon} aria-label={icon} onClick={() => onChange(icon)} className={cell(value === icon)}>
          {icon}
        </button>
      ))}
    </div>
  );
}

const LUNAR_YEARS = Array.from({ length: LUNAR_MAX_YEAR - LUNAR_MIN_YEAR + 1 }, (_, index) => LUNAR_MIN_YEAR + index);

/** Picks a lunar year, month (闰月 included) and day; reports the solar day. */
function LunarDatePicker({ value, onChange }: { value: string; onChange: (day: string) => void }) {
  const { f } = useCountdownText();
  const lunar = solarToLunar(value);
  if (!lunar) return null;
  const choose = (year: number, month: number, leap: boolean, day: number) => {
    const isLeap = leap && leapMonthOf(year) === month;
    const solar = lunarToSolar(year, month, Math.min(day, lunarMonthDays(year, month, isLeap)), isLeap);
    if (solar && solar <= LUNAR_LAST_DAY) onChange(solar);
  };
  const days = lunarMonthDays(lunar.year, lunar.month, lunar.leap);
  return (
    <div className="flex gap-2">
      <select value={lunar.year} onChange={(event) => choose(Number(event.target.value), lunar.month, lunar.leap, lunar.day)} className="field !w-auto min-w-0 flex-[1.3]" aria-label={f('countdownLunarYearOption', lunar.year, lunarYearName(lunar.year))}>
        {LUNAR_YEARS.map((year) => <option key={year} value={year}>{f('countdownLunarYearOption', year, lunarYearName(year))}</option>)}
      </select>
      <select
        value={`${lunar.month}${lunar.leap ? '+' : ''}`}
        onChange={(event) => choose(lunar.year, Number.parseInt(event.target.value, 10), event.target.value.endsWith('+'), lunar.day)}
        className="field !w-auto min-w-0 flex-1"
        aria-label={lunarMonthName(lunar.month, lunar.leap)}
      >
        {lunarMonthsOf(lunar.year).map((month) => (
          <option key={`${month.month}${month.leap}`} value={`${month.month}${month.leap ? '+' : ''}`}>
            {f(month.leap ? 'countdownLunarLeapMonthOption' : 'countdownLunarMonthOption', month.month, lunarMonthName(month.month, month.leap))}
          </option>
        ))}
      </select>
      <select value={lunar.day} onChange={(event) => choose(lunar.year, lunar.month, lunar.leap, Number(event.target.value))} className="field !w-auto min-w-0 flex-1" aria-label={lunarDayName(lunar.day)}>
        {Array.from({ length: days }, (_, index) => index + 1).map((day) => (
          <option key={day} value={day}>{f('countdownLunarDayOption', day, lunarDayName(day))}</option>
        ))}
      </select>
    </div>
  );
}
