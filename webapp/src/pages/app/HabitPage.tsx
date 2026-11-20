import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Flame,
  Grid2X2,
  List,
  MoreHorizontal,
  Plus,
  Settings2,
  Smile,
  Trash2,
  X,
} from 'lucide-react';
import type { Habit } from '../../lib/types';
import { lastNDays, todayStr, weekdayShort } from '../../lib/date';
import { habitStreaks, isDueOn, metOn } from '../../lib/habits';
import { useI18n, useT, useTF, type Key } from '../../i18n';
import { MenuItem, Popover } from '../../components/Popover';
import { habitContext, loadedFloor, useHabitStore } from '../../stores/habits';
import {
  CheckinCircle,
  circleFor,
  ConfirmDialog,
  Dialog,
  HabitAvatar,
  useHabitCheckin,
  usePeriodLabel,
  useRuleSummary,
} from './HabitCheckin';
import HabitForm, { HABIT_SECTIONS, habitSection, type HabitSection } from './HabitForm';
import HabitDetail from './HabitDetail';

const SECTION_KEYS: Record<HabitSection, Key> = {
  _morning: 'habitSectionMorning',
  _afternoon: 'habitSectionAfternoon',
  _night: 'habitSectionNight',
  '-1': 'habitOther',
};

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

/** The detail panel turns into a full-screen sheet below the lg breakpoint. */
function useCompactDetail(): boolean {
  const query = '(max-width: 1023px)';
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setCompact(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return compact;
}

function EmptyHabitArtwork() {
  return (
    <div className="relative mx-auto h-[162px] w-[260px]" aria-hidden="true">
      <div className="absolute bottom-2 left-1/2 h-[68px] w-[218px] -translate-x-1/2 rounded-[50%] bg-[#fafafa]" />
      <div className="absolute left-[52px] top-[45px] h-[56px] w-[164px] rotate-[-5deg] rounded-[18px] border border-line bg-white shadow-[0_8px_18px_rgba(25,25,25,0.04)]">
        <div className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg border-2 border-tt text-tt">
          <Smile size={17} strokeWidth={2} />
        </div>
        <div className="absolute left-[52px] top-3 h-2 w-[76px] rounded-full bg-tt-light" />
        <div className="absolute left-[52px] top-7 h-2 w-[48px] rounded-full bg-tt-light opacity-70" />
      </div>
      <div className="absolute left-[70px] top-[24px] h-10 w-[150px] rotate-[7deg] rounded-[14px] bg-hover" />
      <div className="absolute left-[113px] top-[5px] flex h-10 w-10 items-center justify-center rounded-full bg-tt-light text-tt">
        <Check size={20} strokeWidth={2.4} />
      </div>
      <span className="absolute right-[32px] top-[38px] h-2 w-2 rounded-full bg-[#faa80c]" />
      <span className="absolute left-[37px] top-[95px] h-2 w-2 rounded-full bg-[#97e38b]" />
    </div>
  );
}

/** One day of the week header: how many of the habits due that day are done. */
function HeaderDayStatus({ today, completed, total }: { today: boolean; completed: number; total: number }) {
  const full = total > 0 && completed === total;
  if (full) return <CheckinCircle state="done" size={28} />;
  if (completed > 0) return <CheckinCircle state="partial" ratio={completed / total} size={28} />;
  return <CheckinCircle state={today ? 'today' : total > 0 ? 'missed' : 'off'} size={28} />;
}

interface CardStats {
  streak: number;
  weekDays: number;
  period: string | null;
  doneToday: boolean;
}

function HabitCard({ habit, days, today, stats, variant, selected, onSelect, onDay, busyKey }: {
  habit: Habit;
  days: string[];
  today: string;
  stats: CardStats;
  variant: 'grid' | 'list';
  selected: boolean;
  onSelect: () => void;
  onDay: (day: string) => void;
  busyKey: string | null;
}) {
  const t = useT();
  const f = useTF();
  const lang = useI18n((s) => s.lang);
  const checkins = useHabitStore((s) => s.checkins[habit.id]);
  const identity = (
    <>
      <HabitAvatar habit={habit} size={32} />
      <div className="ml-3 min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium leading-5">{habit.name}</div>
        <div className="flex items-center gap-2 truncate text-[11px] leading-4 text-ink-3">
          <span className="flex items-center gap-1" title={stats.period ?? f('habitWeekDaysHint', stats.weekDays)}>
            <BarChart3 size={11} className="text-tt" aria-hidden="true" />
            {stats.period ?? `${stats.weekDays} ${t(stats.weekDays === 1 ? 'habitDay' : 'habitDays')}`}
          </span>
          <span className="flex items-center gap-1" title={f('habitStreakHint', stats.streak)}>
            <Flame size={11} className="text-[#ff6f6f]" aria-hidden="true" />
            {stats.streak} {t(stats.streak === 1 ? 'habitDay' : 'habitDays')}
          </span>
        </div>
      </div>
    </>
  );
  const statuses = (
    <div className={`flex shrink-0 items-center justify-between ${variant === 'grid' ? 'w-full' : 'w-[196px] sm:w-[220px]'}`}>
      {days.map((day) => {
        const { state, ratio } = circleFor(habit, checkins, day, today);
        const label = `${habit.name} · ${weekdayShort(day, lang)} ${Number(day.slice(8))} · ${state === 'done' ? t('habitCheckedIn') : state === 'off' ? t('habitNotScheduled') : t('habitNoCheckin')}`;
        return (
          <button
            key={day}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={state === 'done'}
            disabled={state === 'off' || busyKey === `${habit.id}:${day}`}
            onClick={(event) => {
              event.stopPropagation();
              onDay(day);
            }}
            className="flex h-9 w-6 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
          >
            <CheckinCircle state={state} ratio={ratio} size={20} />
          </button>
        );
      })}
    </div>
  );
  const ring = selected ? 'ring-2 ring-tt/40' : '';
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onSelect();
    }
  };
  if (variant === 'grid') {
    return (
      <div role="button" tabIndex={0} aria-label={habit.name} onClick={onSelect} onKeyDown={keyDown} className={`flex h-[110px] min-w-0 cursor-pointer flex-col rounded-[10px] bg-white px-4 pb-2 pt-3 shadow-[0_0_12px_rgba(25,25,25,0.06)] ${ring}`}>
        <div className="flex min-w-0 items-center">{identity}</div>
        <div className="mt-auto">{statuses}</div>
      </div>
    );
  }
  return (
    <div role="button" tabIndex={0} aria-label={habit.name} onClick={onSelect} onKeyDown={keyDown} className="cursor-pointer px-4 py-[5px] sm:px-[22px]">
      <div className={`flex h-[60px] min-w-0 items-center rounded-[10px] bg-white px-4 shadow-[0_0_12px_rgba(25,25,25,0.05)] ${ring}`}>
        {identity}{statuses}
      </div>
    </div>
  );
}

function SectionHeader({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="mx-5 mb-1 mt-3 flex items-center gap-1 text-[13px] font-bold text-ink">
      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      {label}
      <span className="ml-1 font-normal text-ink-3">{count}</span>
    </button>
  );
}

function HabitSettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [showInSmartLists, setShowInSmartLists] = useState(() => readFlag('ntk_habits_in_smart_lists', true));
  const [groupByStatus, setGroupByStatus] = useState(() => readFlag('ntk_habits_group_status', false));
  const update = (key: string, value: boolean, setter: (value: boolean) => void) => {
    setter(value);
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // Storage may be off; the switch still applies to this page view.
    }
    window.dispatchEvent(new Event('nodetick:habit-settings'));
  };
  return (
    <Dialog onClose={onClose} width={440} z="z-[60]" label={t('habitSettingsTitle')}>
      <header className="flex h-14 items-center px-5">
        <h2 className="text-[16px] font-semibold">{t('habitSettingsTitle')}</h2>
        <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="ml-auto rounded-md p-1 text-ink-3 hover:bg-hover"><X size={18} /></button>
      </header>
      <div className="px-5 pb-5">
        <label className="flex h-14 items-center border-b border-line/70 text-[13px]">
          <span className="flex-1">{t('habitShowInSmartLists')}</span>
          <input type="checkbox" checked={showInSmartLists} onChange={(event) => update('ntk_habits_in_smart_lists', event.target.checked, setShowInSmartLists)} className="h-4 w-4 accent-[var(--color-tt)]" />
        </label>
        <label className="flex min-h-16 items-start pt-4 text-[13px]">
          <span className="flex-1 pr-4">
            <span className="block">{t('habitGroupByStatus')}</span>
            <span className="mt-1 block text-[12px] text-ink-3">{t('habitGroupByStatusHint')}</span>
          </span>
          <input type="checkbox" checked={groupByStatus} onChange={(event) => update('ntk_habits_group_status', event.target.checked, setGroupByStatus)} className="mt-0.5 h-4 w-4 accent-[var(--color-tt)]" />
        </label>
      </div>
    </Dialog>
  );
}

function exportHabits(habits: Habit[], checkins: ReturnType<typeof useHabitStore.getState>['checkins']) {
  const payload = habits.map((habit) => ({ ...habit, checkins: [...(checkins[habit.id]?.values() ?? [])] }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nodetick-habits-${todayStr()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function HabitPage() {
  const t = useT();
  const f = useTF();
  const lang = useI18n((s) => s.lang);
  const { habits, checkins, years, loaded } = useHabitStore();
  const checkin = useHabitCheckin();
  const ruleSummary = useRuleSummary();
  const periodLabel = usePeriodLabel();
  const compact = useCompactDetail();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('habit'));
  const [formHabit, setFormHabit] = useState<Habit | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Habit | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<HabitSection>>(new Set());
  const [groupByStatus, setGroupByStatus] = useState(() => readFlag('ntk_habits_group_status', false));
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem('ntk_habit_view') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const today = todayStr();
  const days = useMemo(() => lastNDays(7), [today]);

  useEffect(() => {
    void useHabitStore.getState().load().catch(() => setError(t('habitLoadFailed')));
    if (searchParams.has('habit')) setSearchParams({}, { replace: true });
    const onSettings = () => setGroupByStatus(readFlag('ntk_habits_group_status', false));
    window.addEventListener('nodetick:habit-settings', onSettings);
    return () => window.removeEventListener('nodetick:habit-settings', onSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(() => habits.filter((habit) => habit.status === 0), [habits]);
  // Old web builds "deleted" habits with status 2; they show with the archived ones.
  const archived = useMemo(() => habits.filter((habit) => habit.status !== 0), [habits]);

  const stats = useMemo(() => {
    const out = new Map<string, CardStats>();
    for (const habit of active) {
      const ctx = habitContext(habit, checkins[habit.id]);
      out.set(habit.id, {
        streak: habitStreaks(ctx, today, loadedFloor(years[habit.id])).current,
        weekDays: days.filter((day) => metOn(ctx, day)).length,
        period: periodLabel(habit, checkins[habit.id], today),
        doneToday: metOn(ctx, today),
      });
    }
    return out;
    // periodLabel only depends on the language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, checkins, years, today, days, lang]);

  // A streak that runs into the oldest loaded year pulls in the year before.
  useEffect(() => {
    for (const habit of active) void useHabitStore.getState().extendStreakHistory(habit).catch(() => undefined);
  }, [active, years]);

  const daySummary = useMemo(() => days.map((day) => {
    let total = 0;
    let completed = 0;
    for (const habit of active) {
      const ctx = habitContext(habit, checkins[habit.id]);
      if (!isDueOn(ctx, day)) continue;
      total++;
      if (metOn(ctx, day)) completed++;
    }
    return { day, total, completed };
  }), [active, checkins, days]);

  const sections = useMemo(() => HABIT_SECTIONS.map((section) => {
    const list = active.filter((habit) => habitSection(habit) === section);
    if (groupByStatus) list.sort((a, b) => Number(stats.get(a.id)?.doneToday) - Number(stats.get(b.id)?.doneToday));
    return { section, habits: list };
  }).filter((group) => group.habits.length > 0), [active, groupByStatus, stats]);
  const showSectionHeaders = sections.some((group) => group.section !== '-1');

  const selected = habits.find((habit) => habit.id === selectedId) ?? null;

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch {
      setError(t('habitActionFailed'));
    }
  };

  const renderCards = (list: Habit[]) => (
    <div className={viewMode === 'grid' ? 'grid grid-cols-1 gap-[10px] px-5 pb-2 pt-[5px] sm:grid-cols-2' : 'pb-2'}>
      {list.map((habit) => (
        <HabitCard
          key={habit.id}
          habit={habit}
          days={days}
          today={today}
          stats={stats.get(habit.id) ?? { streak: 0, weekDays: 0, period: null, doneToday: false }}
          variant={viewMode}
          selected={habit.id === selectedId}
          onSelect={() => setSelectedId(habit.id)}
          onDay={(day) => void checkin.act(habit, day)}
          busyKey={checkin.busyKey}
        />
      ))}
    </div>
  );

  const titleMenu = (
    <Popover
      align="left"
      panelClass="w-[180px]"
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" className="flex min-w-0 items-center gap-1 text-left" title={t('habitViewOptions')}>
          <h1 className="truncate text-[20px] font-bold">{view === 'active' ? t('habitTitle') : t('habitArchivedTitle')}</h1>
          <ChevronDown size={14} className="mt-0.5 shrink-0 text-ink-3" />
        </button>
      )}
    >
      {(close) => <>
        <MenuItem icon={view === 'active' ? <Check size={15} /> : <span className="w-[15px]" />} label={t('habitAllHabits')} onClick={() => { close(); setView('active'); }} />
        <MenuItem icon={view === 'archived' ? <Check size={15} /> : <span className="w-[15px]" />} label={`${t('habitArchivedTitle')}${archived.length ? ` (${archived.length})` : ''}`} onClick={() => { close(); setView('archived'); }} />
      </>}
    </Popover>
  );

  const detail = selected && (
    <HabitDetail
      key={selected.id}
      habit={selected}
      checkin={checkin}
      overlay={compact}
      onClose={() => setSelectedId(null)}
      onEdit={() => setFormHabit(selected)}
      onArchive={() => void run(() => useHabitStore.getState().setStatus(selected.id, 1))}
      onRestore={() => void run(() => useHabitStore.getState().setStatus(selected.id, 0))}
      onDelete={() => setDeleteTarget(selected)}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden lg:w-[64%] lg:shrink-0">
        <header className="flex h-16 shrink-0 items-center border-b border-line/50 px-5 sm:px-[26px]">
          {titleMenu}
          <div className="ml-auto flex items-center gap-4">
            {view === 'active' && (
              <button
                type="button"
                title={viewMode === 'grid' ? t('habitListView') : t('habitGridView')}
                aria-label={viewMode === 'grid' ? t('habitListView') : t('habitGridView')}
                onClick={() => setViewMode((current) => {
                  const next = current === 'grid' ? 'list' : 'grid';
                  try { localStorage.setItem('ntk_habit_view', next); } catch { /* storage can be unavailable */ }
                  return next;
                })}
                className="flex h-8 w-6 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"
              >
                {viewMode === 'grid' ? <Grid2X2 size={19} strokeWidth={1.8} /> : <List size={20} strokeWidth={1.8} />}
              </button>
            )}
            <button type="button" title={t('newHabit')} aria-label={t('newHabit')} onClick={() => setFormHabit(null)} className="flex h-8 w-6 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"><Plus size={23} strokeWidth={1.8} /></button>
            <Popover
              align="right"
              panelClass="w-[180px]"
              trigger={(open, toggle) => <button type="button" onClick={toggle} aria-expanded={open} title={t('habitMoreActions')} aria-label={t('habitMoreActions')} className="flex h-8 w-6 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"><MoreHorizontal size={20} /></button>}
            >
              {(close) => <>
                <MenuItem icon={<Archive size={15} />} label={t('habitArchivedTitle')} onClick={() => { close(); setView('archived'); }} />
                <MenuItem icon={<Settings2 size={15} />} label={t('habitSettings')} onClick={() => { close(); setShowSettings(true); }} />
                <MenuItem icon={<Download size={15} />} label={t('habitExport')} onClick={() => { close(); exportHabits(habits, checkins); }} />
              </>}
            </Popover>
          </div>
        </header>

        {error && (
          <div role="alert" className="mx-5 mt-2 flex items-center rounded-lg bg-[#fdf0f0] px-3 py-2 text-[13px] text-p-high">
            <span className="flex-1">{error}</span>
            <button type="button" aria-label={t('close')} onClick={() => setError(null)}><X size={14} /></button>
          </div>
        )}

        {view === 'active' && (
          <div className="mx-3 flex h-[96px] shrink-0 justify-between sm:mx-[30px]" aria-label={t('habitWeekSummary')}>
            {daySummary.map(({ day, total, completed }) => {
              const isToday = day === today;
              return (
                <div
                  key={day}
                  title={f('habitDaySummary', completed, total)}
                  className={'mt-0.5 flex h-[84px] w-0 flex-1 flex-col items-center pt-[10px] text-[12px] ' + (isToday ? 'text-tt' : 'text-ink-3')}
                >
                  <span className="leading-[17px]">{weekdayShort(day, lang)}</span>
                  <span className={'text-[14px] leading-[21px] ' + (isToday ? 'font-semibold' : 'font-medium')}>{Number(day.slice(8, 10))}</span>
                  <HeaderDayStatus today={isToday} completed={completed} total={total} />
                </div>
              );
            })}
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto pb-16">
          {!loaded ? (
            <div className="pt-16 text-center text-ink-3">{t('loading')}</div>
          ) : view === 'archived' ? (
            archived.length === 0 ? (
              <div className="pt-24 text-center text-[13px] text-ink-3">{t('habitArchivedEmpty')}</div>
            ) : (
              <ul className="px-4 pt-3 sm:px-[22px]">
                {archived.map((habit) => (
                  <li key={habit.id} className="mb-2">
                    <div role="button" tabIndex={0} aria-label={habit.name} onClick={() => setSelectedId(habit.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') setSelectedId(habit.id); }} className={`flex h-[60px] cursor-pointer items-center rounded-[10px] bg-white px-4 shadow-[0_0_12px_rgba(25,25,25,0.05)] ${habit.id === selectedId ? 'ring-2 ring-tt/40' : ''}`}>
                      <span className="opacity-60"><HabitAvatar habit={habit} size={32} /></span>
                      <div className="ml-3 min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium text-ink-2">{habit.name}</div>
                        <div className="truncate text-[11px] text-ink-3">{ruleSummary(habitContext(habit, undefined).rule)}</div>
                      </div>
                      <button type="button" title={t('habitRestore')} aria-label={`${t('habitRestore')} ${habit.name}`} onClick={(event) => { event.stopPropagation(); void run(() => useHabitStore.getState().setStatus(habit.id, 0)); }} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-tt hover:bg-hover">
                        <ArchiveRestore size={15} /><span className="hidden sm:inline">{t('habitRestore')}</span>
                      </button>
                      <button type="button" title={t('habitDeleteForever')} aria-label={`${t('habitDeleteForever')} ${habit.name}`} onClick={(event) => { event.stopPropagation(); setDeleteTarget(habit); }} className="ml-1 flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-p-high hover:bg-hover">
                        <Trash2 size={15} /><span className="hidden sm:inline">{t('habitDelete')}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : active.length === 0 ? (
            <div className="pt-[96px]">
              <div className="w-full overflow-hidden text-center">
                <EmptyHabitArtwork />
                <span className="mt-2 block text-[14px] font-medium leading-5 text-ink">{t('habitEmptyTitle')}</span>
                <span className="mt-1 block text-[12px] leading-[17px] text-ink-3">{t('habitEmptyHint')}</span>
                <button type="button" onClick={() => setFormHabit(null)} className="mt-4 h-8 rounded-lg bg-tt px-4 text-[13px] font-medium text-white hover:bg-tt-hover">{t('newHabit')}</button>
              </div>
            </div>
          ) : showSectionHeaders ? (
            sections.map((group) => {
              const open = !collapsed.has(group.section);
              return (
                <section key={group.section} aria-label={t(SECTION_KEYS[group.section])}>
                  <SectionHeader
                    label={t(SECTION_KEYS[group.section])}
                    count={group.habits.length}
                    open={open}
                    onToggle={() => setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(group.section)) next.delete(group.section);
                      else next.add(group.section);
                      return next;
                    })}
                  />
                  {open && renderCards(group.habits)}
                </section>
              );
            })
          ) : (
            renderCards(sections.flatMap((group) => group.habits))
          )}
        </main>
      </div>

      {compact ? detail : (detail || (
        <aside className="hidden min-w-0 flex-1 flex-col items-center justify-center border-l border-line text-[13px] text-ink-3 lg:flex">
          <BarChart3 size={28} className="mb-2 text-line" aria-hidden="true" />
          {t('habitSelectHint')}
        </aside>
      ))}

      {formHabit !== undefined && (
        <HabitForm
          habit={formHabit}
          onClose={() => setFormHabit(undefined)}
          onSave={async (input) => {
            const saved = await useHabitStore.getState().saveHabit(formHabit?.id ?? null, input);
            setFormHabit(undefined);
            if (!formHabit) setSelectedId(saved.id);
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={t('habitDeleteTitle')}
          message={f('habitDeleteMessage', deleteTarget.name)}
          confirmLabel={t('habitDelete')}
          danger
          busy={deleting}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleting(true);
            void run(async () => {
              await useHabitStore.getState().deleteHabit(target.id);
              if (selectedId === target.id) setSelectedId(null);
            }).finally(() => {
              setDeleting(false);
              setDeleteTarget(null);
            });
          }}
        />
      )}
      {showSettings && <HabitSettingsDialog onClose={() => setShowSettings(false)} />}
      {checkin.ui}
    </div>
  );
}
