import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  Layers3,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Shirt,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { Popover } from '../../components/Popover';
import { api } from '../../lib/api';
import type { Countdown } from '../../lib/types';
import { dayOf, nextOccurrence, todayStr } from '../../lib/date';
import { useI18n, useT, useTF, type Key } from '../../i18n';

type Kind = Countdown['kind'];
type Draft = Omit<Countdown, 'id' | 'sortOrder'>;
const KINDS: Kind[] = ['countdown', 'anniversary', 'birthday', 'holiday'];
const KIND_ICON: Record<Kind, string> = { countdown: '⏳', anniversary: '💞', birthday: '🎂', holiday: '🎉' };
const KIND_KEY: Record<Kind, Key> = { countdown: 'countdownKind_countdown', anniversary: 'countdownKind_anniversary', birthday: 'countdownKind_birthday', holiday: 'countdownKind_holiday' };
const COLORS = ['#4772FA', '#E5484D', '#F59E0B', '#E8C547', '#43A047', '#14B8A6', '#22A6C7', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#64748B'];
const PINNED_SORT_ORDER = -1_000_000_000;
const ARCHIVED_SORT_ORDER = 1_000_000_000;
const NOTE_KEY = 'ntk_countdown_notes';
const GROUP_KEY = 'ntk_countdown_groups';

function readNotes(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(NOTE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key && typeof value === 'string'));
  } catch {
    return {};
  }
}

function persistNotes(notes: Record<string, string>): void {
  try { localStorage.setItem(NOTE_KEY, JSON.stringify(notes)); } catch { /* storage can be unavailable */ }
}

function emptyDraft(kind: Kind): Draft {
  return { name: '', date: todayStr(), kind, reminders: ['same-day', '3-days'], repeatFlag: null, calculation: 'standard', displayMode: 'on-day', style: 0, color: COLORS[0], icon: KIND_ICON[kind] };
}

function countDays(start: string, end: string, workdays: boolean): number {
  const direction = end >= start ? 1 : -1;
  let cursor = new Date(start + 'T00:00:00Z');
  const target = new Date(end + 'T00:00:00Z');
  let total = 0;
  while (cursor.getTime() !== target.getTime()) {
    cursor = new Date(cursor.getTime() + direction * 86400000);
    if (!workdays || (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6)) total += direction;
  }
  return total;
}

export default function CountdownPage() {
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const [items, setItems] = useState<Countdown[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Countdown | Kind | null>(null);
  const [editingStep, setEditingStep] = useState<1 | 2>(1);
  const [noteTarget, setNoteTarget] = useState<Countdown | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>(readNotes);
  const [addMenu, setAddMenu] = useState(false);
  const [archiveMode, setArchiveMode] = useState(false);
  const [showGroups, setShowGroups] = useState(() => {
    try { return localStorage.getItem(GROUP_KEY) === '1'; } catch { return false; }
  });
  const load = async () => { setItems(await api.listCountdowns()); setLoaded(true); };
  useEffect(() => { void load(); }, []);
  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => archiveMode ? item.sortOrder >= ARCHIVED_SORT_ORDER : item.sortOrder < ARCHIVED_SORT_ORDER);
    return [...filtered].sort((a, b) => {
      const pinned = Number(a.sortOrder === PINNED_SORT_ORDER) - Number(b.sortOrder === PINNED_SORT_ORDER);
      if (pinned) return -pinned;
      return a.sortOrder - b.sortOrder;
    });
  }, [archiveMode, items]);
  const groupedItems = useMemo(() => KINDS
    .map((kind) => ({ kind, items: visibleItems.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length > 0), [visibleItems]);
  const remove = async (id: string) => {
    if (!window.confirm(t('deleteCountdownConfirm'))) return;
    await api.deleteCountdown(id);
    await load();
  };
  const updateOrder = async (item: Countdown, sortOrder: number) => {
    await api.updateCountdown(item.id, { sortOrder });
    await load();
  };
  const openEditor = (item: Countdown, step: 1 | 2 = 1) => {
    setEditingStep(step);
    setEditing(item);
  };
  const setGrouping = (value: boolean) => {
    setShowGroups(value);
    try { localStorage.setItem(GROUP_KEY, value ? '1' : '0'); } catch { /* storage can be unavailable */ }
  };

  const renderCard = (item: Countdown) => (
    <CountdownCard
      key={item.id}
      countdown={item}
      archived={archiveMode}
      onEdit={() => openEditor(item)}
      onStyle={() => openEditor(item, 2)}
      onNote={() => setNoteTarget(item)}
      onPin={() => void updateOrder(item, item.sortOrder === PINNED_SORT_ORDER ? 0 : PINNED_SORT_ORDER)}
      onArchive={() => void updateOrder(item, archiveMode ? 0 : ARCHIVED_SORT_ORDER)}
      onDelete={() => void remove(item.id)}
    />
  );

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-[#fafafa]">
      <header className="flex h-16 items-center pl-[26px] pr-[22px]">
        <Popover
          panelClass="w-[204px]"
          trigger={(open, toggle) => (
            <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[20px] font-bold hover:bg-hover">
              {t('countdownTitle')}<ChevronDown size={14} className="text-ink-3" />
            </button>
          )}
        >
          {(close) => <>
            <button type="button" onClick={() => { setArchiveMode(false); close(); }} className="flex h-[40px] w-full items-center px-5 text-left text-[14px] hover:bg-hover">
              {lang === 'zh' ? '记录中' : 'Active'}{!archiveMode && <Check size={16} className="ml-auto text-tt" />}
            </button>
            <button type="button" onClick={() => { setArchiveMode(true); close(); }} className="flex h-[40px] w-full items-center px-5 text-left text-[14px] hover:bg-hover">
              {lang === 'zh' ? '已归档' : 'Archived'}{archiveMode && <Check size={16} className="ml-auto text-tt" />}
            </button>
          </>}
        </Popover>
        <div className="relative ml-auto flex items-center gap-4">
          <button type="button" title={t('newCountdown')} onClick={() => setAddMenu((value) => !value)} className="flex h-5 w-5 items-center justify-center"><Plus size={20} /></button>
          <Popover
            align="right"
            panelClass="w-[202px]"
            trigger={(open, toggle) => <button type="button" title={t('more')} aria-expanded={open} onClick={toggle} className="flex h-5 w-5 items-center justify-center"><MoreHorizontal size={20} /></button>}
          >
            {(close) => <CountdownMenuItem icon={<Layers3 size={16} />} label={lang === 'zh' ? '显示分组' : 'Show groups'} checked={showGroups} onClick={() => { setGrouping(!showGroups); close(); }} />}
          </Popover>
          {addMenu && <div className="absolute right-5 top-8 z-20 w-[162px] rounded-lg border border-line bg-white py-1 shadow-lg">
            {KINDS.map((kind) => <button key={kind} type="button" onClick={() => { setEditingStep(1); setEditing(kind); setAddMenu(false); }} className="flex h-[34px] w-full items-center gap-2 px-3 text-left text-[14px] hover:bg-hover"><span>{KIND_ICON[kind]}</span>{t(KIND_KEY[kind])}</button>)}
          </div>}
        </div>
      </header>
      {!loaded ? <div className="pt-16 text-center text-ink-3">{t('loading')}</div>
        : visibleItems.length === 0 ? <div className="pt-16 text-center text-[13px] text-ink-3">{archiveMode ? (lang === 'zh' ? '没有已归档的纪念日' : 'No archived countdowns') : t('countdownEmpty')}</div>
          : showGroups ? <div className="space-y-7 px-[22px] pb-10 pt-3">{groupedItems.map((group) => <section key={group.kind}><h2 className="mb-3 text-[14px] font-semibold text-ink-2">{t(KIND_KEY[group.kind])}</h2><div className="grid grid-cols-[repeat(auto-fill,minmax(280px,310px))] gap-5">{group.items.map(renderCard)}</div></section>)}</div>
            : <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,310px))] gap-5 px-[22px] pb-10 pt-3">{visibleItems.map(renderCard)}</div>}
      {editing && <CountdownModal
        initial={typeof editing === 'string' ? null : editing}
        kind={typeof editing === 'string' ? editing : editing.kind}
        initialStep={editingStep}
        onClose={() => setEditing(null)}
        onSave={async (draft, id) => { if (id) await api.updateCountdown(id, draft); else await api.createCountdown(draft); setEditing(null); await load(); }}
      />}
      {noteTarget && <CountdownNoteModal initial={notes[noteTarget.id] ?? ''} onClose={() => setNoteTarget(null)} onSave={(value) => { const next = { ...notes, [noteTarget.id]: value }; setNotes(next); persistNotes(next); setNoteTarget(null); }} />}
    </div>
  );
}

function CountdownCard({ countdown, archived, onEdit, onStyle, onNote, onPin, onArchive, onDelete }: { countdown: Countdown; archived: boolean; onEdit: () => void; onStyle: () => void; onNote: () => void; onPin: () => void; onArchive: () => void; onDelete: () => void }) {
  const t = useT();
  const f = useTF();
  const lang = useI18n((state) => state.lang);
  const [expanded, setExpanded] = useState(false);
  const today = todayStr();
  // A yearly/monthly countdown (birthday, anniversary) counts down to its next
  // occurrence, the day the server reminds about, not the original date.
  const date = dayOf(countdown.date);
  const target = date ? nextOccurrence(date, countdown.repeatFlag, today) : null;
  const days = target ? countDays(today, target, countdown.calculation === 'workday') : null;
  const past = days != null && days < 0;
  const absolute = days == null ? null : Math.abs(days);
  const number = days === 0 ? t('countdownToday') : expanded && absolute != null && absolute >= 365
    ? Math.floor(absolute / 365) + t('countdownYears') + ' ' + Math.floor((absolute % 365) / 30) + t('countdownMonths')
    : String(absolute ?? '—');
  const dateLabel = target ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(target + 'T00:00:00Z')) : '';
  return <article onClick={onEdit} className="group relative h-[194px] cursor-pointer rounded-xl border border-line bg-white text-center shadow-[0_3px_14px_rgba(0,0,0,0.035)]">
    <div className="mt-7 flex items-center justify-center gap-2 text-[17px] font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-full text-[13px]" style={{ backgroundColor: countdown.color + '22' }}>{countdown.icon ?? KIND_ICON[countdown.kind]}</span><span className="max-w-[210px] truncate">{countdown.name}</span></div>
    <button type="button" title={t('countdownFormatHint')} onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} className="mt-1 h-[82px] w-full text-[52px] font-light leading-[82px] tabular-nums" style={{ color: countdown.color }}>{number}</button>
    <div className="text-[12px] text-ink-3">{f(past ? 'countdownSinceDate' : 'countdownUntilDate', dateLabel)}</div>
    <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" onClick={(event) => event.stopPropagation()}>
      {!archived && <button type="button" title={lang === 'zh' ? '置顶' : 'Pin'} onClick={onPin} className={'flex h-9 w-9 items-center justify-center rounded-[7px] text-white ' + (countdown.sortOrder === PINNED_SORT_ORDER ? 'bg-tt' : 'bg-[#858585]')}><Pin size={18} fill="currentColor" /></button>}
      <Popover
        align="right"
        panelClass="w-[204px]"
        trigger={(open, toggle) => <button type="button" title={t('more')} aria-expanded={open} onClick={toggle} className="flex h-9 w-9 items-center justify-center rounded-[7px] bg-[#858585] text-white"><MoreHorizontal size={20} /></button>}
      >
        {(close) => <>
          <CountdownMenuItem icon={<Pencil size={16} />} label={lang === 'zh' ? '编辑' : 'Edit'} onClick={() => { close(); onEdit(); }} />
          <CountdownMenuItem icon={<Shirt size={16} />} label={lang === 'zh' ? '样式' : 'Style'} onClick={() => { close(); onStyle(); }} />
          <CountdownMenuItem icon={<StickyNote size={16} />} label={lang === 'zh' ? '备注' : 'Note'} onClick={() => { close(); onNote(); }} />
          <CountdownMenuItem icon={<Archive size={16} />} label={archived ? (lang === 'zh' ? '恢复' : 'Restore') : (lang === 'zh' ? '归档' : 'Archive')} onClick={() => { close(); onArchive(); }} />
          <CountdownMenuItem icon={<Trash2 size={16} />} label={lang === 'zh' ? '删除' : 'Delete'} danger onClick={() => { close(); onDelete(); }} />
        </>}
      </Popover>
    </div>
  </article>;
}

function CountdownMenuItem({ icon, label, checked = false, danger = false, onClick }: { icon: ReactNode; label: string; checked?: boolean; danger?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={'flex h-10 w-full items-center gap-3 whitespace-nowrap px-5 text-left text-[14px] hover:bg-hover ' + (danger ? 'text-p-high' : 'text-ink')}>
    <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
    <span>{label}</span>
    {checked && <Check size={16} className="ml-auto text-tt" />}
  </button>;
}

function CountdownModal({ initial, kind, initialStep = 1, onClose, onSave }: { initial: Countdown | null; kind: Kind; initialStep?: 1 | 2; onClose: () => void; onSave: (draft: Draft, id?: string) => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(initial ? { name: initial.name ?? '', date: dayOf(initial.date) ?? todayStr(), kind: initial.kind, reminders: initial.reminders, repeatFlag: initial.repeatFlag, calculation: initial.calculation, displayMode: initial.displayMode, style: initial.style, color: initial.color, icon: initial.icon } : emptyDraft(kind));
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [saving, setSaving] = useState(false);
  const valid = Boolean(draft.name?.trim() && draft.date);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try { await onSave({ ...draft, name: draft.name?.trim() ?? '' }, initial?.id); } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onMouseDown={onClose}>
    <form onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()} className="w-[420px] -translate-y-12 rounded-2xl bg-white shadow-2xl">
      <div className="flex h-14 items-center px-5"><h2 className="text-[17px] font-bold">{step === 1 ? (initial ? t('editCountdown') : t('create')) : t('countdownStyle')}</h2><button type="button" title={t('close')} onClick={onClose} className="ml-auto text-ink-3"><X size={19} /></button></div>
      {step === 1 ? <div className="space-y-3 px-6 pb-5">
        <div className="flex items-center gap-4"><div title={t('countdownIcon')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tt-light text-[20px]">{draft.icon ?? KIND_ICON[draft.kind]}</div><input autoFocus value={draft.name ?? ''} onChange={(event) => update('name', event.target.value)} placeholder={t('eventNamePh')} className="h-9 min-w-0 flex-1 border-b border-line px-1 text-[14px] outline-none focus:border-tt" /></div>
        <ModalRow label={t('filterDate')}><input type="date" value={draft.date ?? ''} onChange={(event) => update('date', event.target.value)} className="field" /></ModalRow>
        <ModalRow label={t('reminder')}><select value={draft.reminders.join(',')} onChange={(event) => update('reminders', event.target.value ? event.target.value.split(',') : [])} className="field"><option value="same-day,3-days">{t('countdownDefaultReminder')}</option><option value="same-day">{t('countdownSameDay')}</option><option value="">{t('reminderNone')}</option></select></ModalRow>
        <ModalRow label={t('repeat')}><select value={draft.repeatFlag ?? ''} onChange={(event) => update('repeatFlag', event.target.value || null)} className="field"><option value="">{t('summaryNone')}</option><option value="yearly">{t('countdownYearly')}</option><option value="monthly">{t('countdownMonthly')}</option></select></ModalRow>
        <ModalRow label={t('countdownType')}><select value={draft.kind} onChange={(event) => { const next = event.target.value as Kind; setDraft((current) => ({ ...current, kind: next, icon: KIND_ICON[next] })); }} className="field">{KINDS.map((value) => <option key={value} value={value}>{t(KIND_KEY[value])}</option>)}</select></ModalRow>
        <ModalRow label={t('countdownCalculation')}><select value={draft.calculation} onChange={(event) => update('calculation', event.target.value as Draft['calculation'])} className="field"><option value="standard">{t('countdownStandard')}</option><option value="workday">{t('countdownWorkday')}</option></select></ModalRow>
        <ModalRow label={t('countdownDisplay')}><select value={draft.displayMode} onChange={(event) => update('displayMode', event.target.value as Draft['displayMode'])} className="field"><option value="on-day">{t('countdownOnDay')}</option><option value="always">{t('countdownAlways')}</option></select></ModalRow>
      </div> : <div className="px-6 pb-5">
        <div className="mx-auto flex h-[140px] w-[186px] flex-col items-center rounded-xl border border-line bg-white pt-5 shadow-sm"><div className="text-[13px] font-medium">{draft.name}</div><div className="mt-1 text-[42px] font-light" style={{ color: draft.color }}>{t('countdownToday')}</div><div className="text-[10px] text-ink-3">{draft.date}</div></div>
        <div className="mt-8 flex justify-center gap-2">{[0, 1, 2, 3, 4].map((style) => <button key={style} type="button" onClick={() => update('style', style)} className={'h-[60px] w-20 rounded-md border ' + (draft.style === style ? 'border-tt ring-1 ring-tt' : 'border-line')} style={{ background: style === 1 ? draft.color + '12' : 'white' }}><span className="text-[18px]" style={{ color: draft.color }}>0</span></button>)}</div>
        <div className="mt-5 flex items-center gap-4 text-[13px]"><span>{t('countdownColor')}</span><div className="flex flex-wrap gap-1">{COLORS.map((color) => <button key={color} type="button" title={color} onClick={() => update('color', color)} className={'h-[18px] w-[18px] rounded-full ' + (draft.color === color ? 'ring-2 ring-offset-1' : '')} style={{ backgroundColor: color }} />)}</div></div>
      </div>}
      <div className="flex h-[58px] items-center justify-end gap-2 border-t border-line px-5"><button type="button" onClick={() => step === 1 ? onClose() : setStep(1)} className="h-[30px] min-w-[100px] rounded-md border border-line text-[13px]">{step === 1 ? t('cancel') : t('countdownBack')}</button>{/* Distinct keys: if React reused the "Next" element as the submit
          button, the click that switches steps would also submit the form. */}
        {step === 1 ? <button key="next" type="button" disabled={!valid} onClick={() => setStep(2)} className="h-[30px] min-w-[100px] rounded-md bg-tt text-[13px] text-white disabled:opacity-40">{t('countdownNext')}</button> : <button key="confirm" type="submit" disabled={saving} className="h-[30px] min-w-[100px] rounded-md bg-tt text-[13px] text-white disabled:opacity-40">{t('confirm')}</button>}</div>
    </form>
  </div>;
}

function CountdownNoteModal({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (value: string) => void }) {
  const lang = useI18n((state) => state.lang);
  const [value, setValue] = useState(initial);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onMouseDown={onClose}>
    <div role="dialog" aria-modal="true" aria-label={lang === 'zh' ? '纪念日备注' : 'Countdown note'} onMouseDown={(event) => event.stopPropagation()} className="w-[420px] -translate-y-12 rounded-2xl bg-white shadow-2xl">
      <div className="flex h-14 items-center px-5"><h2 className="text-[17px] font-bold">{lang === 'zh' ? '备注' : 'Note'}</h2><button type="button" onClick={onClose} className="ml-auto text-ink-3"><X size={19} /></button></div>
      <div className="px-5 pb-5"><textarea autoFocus maxLength={4000} value={value} onChange={(event) => setValue(event.target.value)} placeholder={lang === 'zh' ? '记录有关这个纪念日的内容…' : 'Write something about this countdown…'} className="h-36 w-full resize-none rounded-lg border border-line p-3 text-[14px] outline-none focus:border-tt" /></div>
      <div className="flex h-[58px] items-center justify-end gap-2 border-t border-line px-5"><button type="button" onClick={onClose} className="h-[30px] min-w-[100px] rounded-md border border-line text-[13px]">{lang === 'zh' ? '取消' : 'Cancel'}</button><button type="button" onClick={() => onSave(value)} className="h-[30px] min-w-[100px] rounded-md bg-tt text-[13px] text-white">{lang === 'zh' ? '保存' : 'Save'}</button></div>
    </div>
  </div>;
}

function ModalRow({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-h-8 items-center"><span className="w-[66px] shrink-0 text-[13px] text-ink-2">{label}</span><span className="min-w-0 flex-1 [&_.field]:h-8 [&_.field]:w-full [&_.field]:rounded-md [&_.field]:border [&_.field]:border-line [&_.field]:bg-white [&_.field]:px-2 [&_.field]:text-[13px]">{children}</span></label>;
}
