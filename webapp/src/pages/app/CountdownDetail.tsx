import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, Shirt, Trash2, X } from 'lucide-react';
import { MenuItem, Popover } from '../../components/Popover';
import type { Countdown } from '../../lib/types';
import { dayOf, localDayClock } from '../../lib/date';
import { countdownYears, ymdBetween } from '../../lib/countdown';
import { solarToLunar } from '../../lib/lunar';
import { CountdownCard, countdownFacts } from './CountdownCard';
import { Switch } from './CountdownEditor';
import { KIND_KEY, useCountdownText } from './countdownText';

/** The countdown detail: big card, dates, repeat, reminders, editable note and actions. */
export default function CountdownDetail({
  countdown,
  today,
  allDayTime,
  focusNote = false,
  onClose,
  onEdit,
  onStyle,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onChange,
}: {
  countdown: Countdown;
  today: string;
  allDayTime: string;
  focusNote?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onStyle: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onChange: (patch: Partial<Pick<Countdown, 'note' | 'showInCalendar'>>) => void;
}) {
  const text = useCountdownText();
  const { t, f } = text;
  const facts = countdownFacts(countdown, today);
  const target = facts.target;
  const original = dayOf(countdown.date);
  const years = target ? countdownYears(countdown, target) : null;
  const ordinal = years == null ? null
    : countdown.kind === 'birthday' ? f('countdownBirthdayAge', years)
      : countdown.kind === 'anniversary' ? f('countdownAnniversaryYears', years) : null;
  // zh users read the lunar date of any day; lunar countdowns show it in every language.
  const showLunar = (day: string) => (countdown.lunar || text.lang === 'zh') && solarToLunar(day) != null;
  const archivedDay = localDayClock(countdown.archivedTime)?.day;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white" role="region" aria-label={t('countdownDetails')}>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line/60 pl-5 pr-3">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{countdown.name}</h2>
        <IconButton label={t('countdownEdit')} onClick={onEdit}><Pencil size={16} /></IconButton>
        {!countdown.archived && (
          <IconButton label={countdown.pinned ? t('countdownUnpin') : t('countdownPin')} pressed={countdown.pinned} onClick={onTogglePin}>
            <Pin size={16} className={countdown.pinned ? 'rotate-45 text-tt' : ''} fill={countdown.pinned ? 'currentColor' : 'none'} />
          </IconButton>
        )}
        <Popover
          align="right"
          panelClass="w-[168px]"
          trigger={(open, toggle) => (
            <IconButton label={t('more')} pressed={open} onClick={toggle}><MoreHorizontal size={18} /></IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<Shirt size={15} />} label={t('countdownStyle')} onClick={() => { close(); onStyle(); }} />
              <MenuItem
                icon={countdown.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                label={countdown.archived ? t('countdownRestore') : t('countdownArchive')}
                onClick={() => { close(); onToggleArchive(); }}
              />
              <MenuItem icon={<Trash2 size={15} />} label={t('countdownDelete')} danger onClick={() => { close(); onDelete(); }} />
            </>
          )}
        </Popover>
        <IconButton label={t('countdownCloseDetails')} onClick={onClose}><X size={18} /></IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5">
        <div className="mx-auto max-w-[320px]">
          <CountdownCard countdown={countdown} today={today} />
        </div>

        <dl className="mt-5 divide-y divide-line/70 text-[13px]">
          {target && (
            <InfoRow label={t('countdownDate')}>
              <div>{text.date(target, true)}</div>
              {showLunar(target) && <div className="text-[12px] text-ink-3">{text.lunarOf(target)}</div>}
            </InfoRow>
          )}
          {ordinal && <InfoRow label={t(KIND_KEY[countdown.kind])}>{ordinal}</InfoRow>}
          {original && target && original !== target && (
            <InfoRow label={t('countdownStartDate')}>
              <div>{text.date(original)}</div>
              {showLunar(original) && <div className="text-[12px] text-ink-3">{text.lunarOf(original)}</div>}
            </InfoRow>
          )}
          {target && target !== today && (
            <InfoRow label={t('countdownSpan')}>{text.span(ymdBetween(today, target))}</InfoRow>
          )}
          <InfoRow label={t('repeat')}>{text.repeat(countdown)}</InfoRow>
          <InfoRow label={t('reminder')}>{text.reminders(countdown, allDayTime)}</InfoRow>
          <InfoRow label={t('countdownCalculation')}>{countdown.calculation === 'workday' ? t('countdownWorkday') : t('countdownStandard')}</InfoRow>
          <InfoRow label={t('countdownShowInCalendar')}>
            <Switch checked={countdown.showInCalendar} label={t('countdownShowInCalendar')} onChange={(value) => onChange({ showInCalendar: value })} />
          </InfoRow>
          {countdown.archived && archivedDay && <InfoRow label={t('countdownArchivedView')}>{f('countdownArchivedOn', text.date(archivedDay))}</InfoRow>}
        </dl>

        <NoteEditor key={countdown.id} note={countdown.note} autoFocus={focusNote} onSave={(note) => onChange({ note })} />
      </div>
    </div>
  );
}

function IconButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[42px] items-center gap-4 py-2">
      <dt className="w-[92px] shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink">{children}</dd>
    </div>
  );
}

/** The note saves when the field loses focus, and when the panel closes with unsaved text. */
function NoteEditor({ note, autoFocus, onSave }: { note: string; autoFocus: boolean; onSave: (note: string) => void }) {
  const { t } = useCountdownText();
  const [value, setValue] = useState(note);
  const latest = useRef({ value, note, onSave });
  latest.current = { value, note, onSave };
  useEffect(() => setValue(note), [note]);
  useEffect(() => () => {
    const { value: pending, note: saved, onSave: save } = latest.current;
    if (pending !== saved) save(pending);
  }, []);
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[13px] font-medium text-ink-2">{t('countdownNote')}</h3>
      <textarea
        autoFocus={autoFocus}
        value={value}
        maxLength={4000}
        rows={5}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => { if (value !== note) onSave(value); }}
        placeholder={t('countdownNotePh')}
        aria-label={t('countdownNote')}
        className="w-full rounded-lg border border-line bg-[#fafafa] px-3 py-2.5 text-[13px] leading-5 outline-none focus:border-tt"
      />
    </section>
  );
}
