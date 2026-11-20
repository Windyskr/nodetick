import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useI18n, useT, useTF } from '../../i18n';
import { api } from '../../lib/api';
import { shortDate, todayStr } from '../../lib/date';
import {
  addDays,
  calendarDays,
  checkinTotals,
  dayToStamp,
  formatAmount,
  habitStreaks,
  heatLevel,
  isDueOn,
  isPlannedDay,
  lastDay,
  monthEnd,
  monthlySeries,
  monthRate,
  progressOn,
  shiftMonth,
  weekdayIndex,
  withinRange,
  type HabitContext,
} from '../../lib/habits';
import type { Habit, HabitRecord } from '../../lib/types';
import { MenuItem, Popover } from '../../components/Popover';
import { firstYear, habitContext, loadedFloor, useHabitStore } from '../../stores/habits';
import { HabitAvatar, logFace, useDayLabel, useHabitUnit, usePeriodLabel, useRuleSummary, type useHabitCheckin } from './HabitCheckin';

type Checkin = ReturnType<typeof useHabitCheckin>;

/** Heatmap / bar fills: one hue (the theme accent) mixed into the surface, so dark mode flips with it. */
const LEVEL_FILL = [
  'var(--color-hover)',
  'color-mix(in srgb, var(--color-tt) 28%, var(--nt-surface))',
  'color-mix(in srgb, var(--color-tt) 52%, var(--nt-surface))',
  'color-mix(in srgb, var(--color-tt) 76%, var(--nt-surface))',
  'var(--color-tt)',
];
const MUTED_BAR = 'color-mix(in srgb, var(--color-tt) 34%, var(--nt-surface))';

function monthTitle(month: string, locale: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

function monthShort(index: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1)));
}

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

function StatTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[#fafafa] px-3 py-2.5">
      <div className="truncate text-[12px] text-ink-3">{label}</div>
      <div className="mt-1 flex min-w-0 items-baseline gap-1">
        <span className="text-[20px] font-semibold leading-6 text-ink">{value}</span>
        {unit && <span className="truncate text-[12px] text-ink-3">{unit}</span>}
      </div>
    </div>
  );
}

function MonthCalendar({ habit, ctx, month, today, onDay }: {
  habit: Habit;
  ctx: HabitContext;
  month: string;
  today: string;
  onDay: (day: string) => void;
}) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const unitOf = useHabitUnit();
  const days = calendarDays(month, 'SU');
  const weekdays = days.slice(0, 7).map((day) =>
    new Intl.DateTimeFormat(t('habitLocale'), { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)));
  return (
    <div className="grid grid-cols-7 gap-y-1.5 text-center text-[11px] text-ink-3">
      {weekdays.map((name, index) => <div key={index} aria-hidden="true">{name}</div>)}
      {days.map((day) => {
        const inMonth = day.slice(0, 7) === month;
        const { value, goal, met } = progressOn(ctx, day);
        const planned = isPlannedDay(ctx.rule, day);
        const clickable = day <= today && (planned || met || value > 0);
        const ratio = Math.min(1, value / goal);
        const label = `${shortDate(day, lang)} · ${met ? t('habitCheckedIn') : value > 0 ? `${formatAmount(value)}/${formatAmount(goal)} ${unitOf(habit)}` : planned ? t('habitNoCheckin') : t('habitNotScheduled')}`;
        const number = Number(day.slice(8, 10));
        let circle = 'text-ink-2';
        if (met) circle = 'bg-tt font-medium text-white';
        else if (day === today && isDueOn(ctx, day)) circle = 'border-2 border-tt text-tt';
        else if (!planned || day > today) circle = 'text-ink-3/60';
        return (
          <button
            key={day}
            type="button"
            disabled={!clickable}
            title={label}
            aria-label={label}
            aria-pressed={met}
            onClick={() => onDay(day)}
            className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full disabled:cursor-default ${inMonth ? '' : 'opacity-35'} ${clickable ? 'hover:bg-hover' : ''}`}
          >
            {!met && value > 0 ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full p-[2px]" style={{ background: `conic-gradient(var(--color-tt) ${ratio * 360}deg, var(--color-line) 0deg)` }}>
                <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-ink-2">{number}</span>
              </span>
            ) : (
              <span className={`flex h-7 w-7 items-center justify-center rounded-full ${circle}`}>{number}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** One year as a GitHub-style grid: a column per week (from Sunday), a cell per day shaded by progress. */
function YearHeatmap({ habit, ctx, year, today }: { habit: Habit; ctx: HabitContext; year: number; today: string }) {
  const t = useT();
  const f = useTF();
  const lang = useI18n((s) => s.lang);
  const unitOf = useHabitUnit();
  const first = `${year}-01-01`;
  const start = addDays(first, -weekdayIndex(first));
  const last = `${year}-12-31`;
  const columns = Math.floor((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 / 7) + 1;
  const pitch = 12;
  const top = 20;
  const width = columns * pitch - 2;
  const cells: ReactNode[] = [];
  const labels: ReactNode[] = [];
  let metDays = 0;
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < 7; row++) {
      const day = addDays(start, column * 7 + row);
      if (day < first || day > last) continue;
      if (day.slice(8) === '01') {
        labels.push(<text key={day} x={column * pitch} y={14} fontSize={15} fill="var(--color-ink-3)">{monthShort(Number(day.slice(5, 7)) - 1, t('habitLocale'))}</text>);
      }
      const level = heatLevel(ctx, day);
      if (level === 4) metDays++;
      const outside = day > today || !withinRange(ctx.rule, day);
      const { value, goal } = progressOn(ctx, day);
      const detail = level === 4 ? t('habitCheckedIn') : value > 0 ? `${formatAmount(value)}/${formatAmount(goal)} ${unitOf(habit)}` : t('habitNoCheckin');
      cells.push(
        <rect key={day} x={column * pitch} y={top + row * pitch} width={10} height={10} rx={2} fill={LEVEL_FILL[level]} opacity={outside && level === 0 ? 0.45 : 1}>
          <title>{`${shortDate(day, lang)} · ${detail}`}</title>
        </rect>,
      );
    }
  }
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${top + 7 * pitch - 2}`} className="block h-auto w-full" role="img" aria-label={f('habitHeatmapSummary', year, metDays)}>
        {labels}
        {cells}
      </svg>
      <figcaption className="mt-2 flex items-center justify-end gap-1 text-[11px] text-ink-3">
        <span>{t('habitLegendLess')}</span>
        {LEVEL_FILL.map((fill, index) => <span key={index} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: fill }} aria-hidden="true" />)}
        <span>{t('habitLegendMore')}</span>
      </figcaption>
    </figure>
  );
}

/** A clean axis maximum: 1, 2 or 5 times a power of ten, at least `value`. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].map((step) => step * power).find((candidate) => candidate >= value) ?? 10 * power);
}

/** Twelve monthly columns of a year; the month shown in the calendar carries the accent. */
function MonthlyTrend({ series, year, selectedMonth, measure }: { series: number[]; year: number; selectedMonth: string; measure: string }) {
  const t = useT();
  const f = useTF();
  const W = 320;
  const H = 132;
  const left = 26;
  const right = W - 4;
  const topPad = 16;
  const bottom = H - 16;
  const max = niceMax(Math.max(...series));
  const ticks = [0, max / 2, max];
  const slot = (right - left) / 12;
  const barWidth = Math.min(14, slot - 6);
  const y = (value: number) => bottom - (value / max) * (bottom - topPad);
  const selectedIndex = Number(selectedMonth.slice(0, 4)) === year ? Number(selectedMonth.slice(5, 7)) - 1 : -1;
  const locale = t('habitLocale');
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={f('habitTrendSummary', year, measure)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={left - 5} y={y(tick) + 3} fontSize={9} textAnchor="end" fill="var(--color-ink-3)" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmount(tick)}</text>
          </g>
        ))}
        {series.map((value, index) => {
          const x = left + slot * index + (slot - barWidth) / 2;
          const height = bottom - y(value);
          const radius = Math.min(4, height, barWidth / 2);
          const selected = index === selectedIndex;
          return (
            <g key={index}>
              {height > 0 && (
                <path
                  d={`M${x},${bottom} V${bottom - height + radius} Q${x},${bottom - height} ${x + radius},${bottom - height} H${x + barWidth - radius} Q${x + barWidth},${bottom - height} ${x + barWidth},${bottom - height + radius} V${bottom} Z`}
                  fill={selected ? 'var(--color-tt)' : MUTED_BAR}
                />
              )}
              {/* The hit area is the whole column, not just the painted bar. */}
              <rect x={left + slot * index} y={topPad} width={slot} height={bottom - topPad} fill="transparent">
                <title>{`${monthShort(index, locale)} · ${formatAmount(value)} ${measure}`}</title>
              </rect>
              {selected && value > 0 && (
                <text x={x + barWidth / 2} y={bottom - height - 4} fontSize={9} textAnchor="middle" fill="var(--color-ink)" fontWeight={600}>{formatAmount(value)}</text>
              )}
              <text x={left + slot * index + slot / 2} y={H - 3} fontSize={9} textAnchor="middle" fill={selected ? 'var(--color-ink)' : 'var(--color-ink-3)'}>{monthShort(index, locale)}</text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{f('habitTrendSummary', year, measure)}</caption>
        <tbody>
          {series.map((value, index) => (
            <tr key={index}><th scope="row">{monthShort(index, locale)}</th><td>{formatAmount(value)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export default function HabitDetail({ habit, checkin, onClose, onEdit, onArchive, onRestore, onDelete, overlay }: {
  habit: Habit;
  checkin: Checkin;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  /** Narrow screens: a full-screen sheet with a back button. */
  overlay?: boolean;
}) {
  const t = useT();
  const f = useTF();
  const lang = useI18n((s) => s.lang);
  const unitOf = useHabitUnit();
  const ruleSummary = useRuleSummary();
  const periodLabel = usePeriodLabel();
  const dayLabel = useDayLabel();
  const checkins = useHabitStore((s) => s.checkins[habit.id]);
  const years = useHabitStore((s) => s.years[habit.id]);
  const today = todayStr();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [records, setRecords] = useState<HabitRecord[] | null>(null);
  const [recordsError, setRecordsError] = useState(false);
  const ctx = useMemo(() => habitContext(habit, checkins), [habit, checkins]);
  const rule = ctx.rule;
  const count = rule.target === 'count';
  const unit = unitOf(habit);
  const startYear = firstYear(habit);
  const daysUnit = (n: number) => t(n === 1 ? 'habitDay' : 'habitDays');
  const currentYear = Number(today.slice(0, 4));

  useEffect(() => {
    setMonth(today.slice(0, 7));
    setYear(currentYear);
    void useHabitStore.getState().loadFullHistory(habit).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit.id]);

  useEffect(() => {
    void useHabitStore.getState().ensureYears([habit.id], [year]).catch(() => undefined);
  }, [habit.id, year]);

  useEffect(() => {
    void useHabitStore.getState().ensureYears([habit.id], [Number(month.slice(0, 4))]).catch(() => undefined);
    let live = true;
    setRecords(null);
    setRecordsError(false);
    api.listHabitRecords(habit.id, dayToStamp(`${month}-01`), dayToStamp(monthEnd(month)))
      .then((rows) => { if (live) setRecords(rows); })
      .catch(() => { if (live) setRecordsError(true); });
    return () => { live = false; };
  }, [habit.id, month]);

  const streaks = useMemo(() => habitStreaks(ctx, today, loadedFloor(years)), [ctx, today, years]);
  const monthTotals = checkinTotals(ctx, month.replace('-', ''));
  const allTotals = checkinTotals(ctx);
  const rate = monthRate(ctx, month, today);
  const series = useMemo(() => monthlySeries(ctx, year, count ? 'amount' : 'days'), [ctx, year, count]);
  const ends = lastDay(rule);
  const period = periodLabel(habit, checkins, today);
  const archived = habit.status !== 0;

  const onDay = (day: string) => {
    if (count) checkin.openDay(habit, day);
    else void checkin.act(habit, day);
  };
  const saveRecord = (saved: HabitRecord | null, stamp: number) =>
    setRecords((current) => {
      const rest = (current ?? []).filter((item) => item.stamp !== stamp);
      return (saved ? [...rest, saved] : rest).sort((a, b) => a.stamp - b.stamp);
    });

  const menu = (
    <Popover
      align="right"
      panelClass="w-[168px]"
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-expanded={open} title={t('habitMoreActions')} aria-label={t('habitMoreActions')} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"><MoreHorizontal size={19} /></button>
      )}
    >
      {(close) => <>
        <MenuItem icon={<Pencil size={15} />} label={t('habitEdit')} onClick={() => { close(); onEdit(); }} />
        {archived
          ? <MenuItem icon={<ArchiveRestore size={15} />} label={t('habitRestore')} onClick={() => { close(); onRestore(); }} />
          : <MenuItem icon={<Archive size={15} />} label={t('habitArchive')} onClick={() => { close(); onArchive(); }} />}
        <MenuItem icon={<Trash2 size={15} />} label={t('habitDeleteForever')} danger onClick={() => { close(); onDelete(); }} />
      </>}
    </Popover>
  );

  const body = (
    <>
      <header className="flex h-[68px] shrink-0 items-center gap-3 px-5">
        {overlay && (
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="-ml-2 flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover"><ChevronLeft size={20} /></button>
        )}
        <HabitAvatar habit={habit} size={32} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold leading-5">{habit.name}</h2>
          <div className="truncate text-[12px] text-ink-3">
            {ruleSummary(rule)}
            {count && ` · ${f('habitGoalPerDay', formatAmount(habit.goal ?? 1), unit)}`}
            {archived && ` · ${t('habitArchived')}`}
          </div>
        </div>
        {menu}
        {!overlay && (
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"><X size={18} /></button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10">
        {habit.encouragement?.trim() && (
          <p className="mb-3 rounded-lg bg-tt-light px-3 py-2 text-[13px] leading-5 text-tt">{habit.encouragement}</p>
        )}
        {(rule.startDate || ends || period) && (
          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-3">
            {rule.startDate && <span>{f('habitStartedOn', dayLabel(rule.startDate))}</span>}
            {ends && <span>{f(ends < today ? 'habitEndedOn' : 'habitEndsOn', dayLabel(ends))}</span>}
            {period && <span>{period}</span>}
          </div>
        )}

        <section className="rounded-xl border border-line px-3 pb-3 pt-2" aria-label={monthTitle(month, t('habitLocale'))}>
          <div className="mb-2 flex items-center">
            <h3 className="flex-1 pl-1 text-[13px] font-medium">{monthTitle(month, t('habitLocale'))}</h3>
            {month !== today.slice(0, 7) && (
              <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="mr-1 rounded-md px-2 py-0.5 text-[12px] text-tt hover:bg-hover">{t('habitThisMonth')}</button>
            )}
            <NavButton label={t('previousMonth')} onClick={() => setMonth(shiftMonth(month, -1))} disabled={Number(month.slice(0, 4)) <= startYear && month.slice(5) === '01'}><ChevronLeft size={16} /></NavButton>
            <NavButton label={t('nextMonth')} onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= today.slice(0, 7)}><ChevronRight size={16} /></NavButton>
          </div>
          <MonthCalendar habit={habit} ctx={ctx} month={month} today={today} onDay={onDay} />
        </section>

        <section className="mt-3 grid grid-cols-2 gap-2" aria-label={t('habitStats')}>
          <StatTile label={t('habitMonthCheckins')} value={String(monthTotals.days)} unit={daysUnit(monthTotals.days)} />
          <StatTile label={t('habitTotalCheckins')} value={String(allTotals.days)} unit={daysUnit(allTotals.days)} />
          <StatTile label={t('habitMonthRate')} value={rate == null ? '—' : String(rate)} unit={rate == null ? undefined : '%'} />
          <StatTile label={t('habitCurrentStreak')} value={String(streaks.current)} unit={daysUnit(streaks.current)} />
          <StatTile label={t('habitLongestStreak')} value={String(streaks.longest)} unit={daysUnit(streaks.longest)} />
          {count && <StatTile label={t('habitMonthAmount')} value={formatAmount(monthTotals.amount)} unit={unit} />}
          {count && <StatTile label={t('habitTotalAmount')} value={formatAmount(allTotals.amount)} unit={unit} />}
        </section>

        <section className="mt-5" aria-label={t('habitLogTitle')}>
          <div className="mb-1 flex items-center">
            <h3 className="flex-1 text-[13px] font-medium">{t('habitLogTitle')}</h3>
            <button
              type="button"
              onClick={() => {
                const day = month === today.slice(0, 7) ? today : monthEnd(month);
                const existing = records?.find((item) => item.stamp === dayToStamp(day));
                checkin.openLog(habit, day, existing, (saved) => saveRecord(saved, dayToStamp(day)));
              }}
              title={t('habitAddLog')}
              aria-label={t('habitAddLog')}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-tt"
            >
              <Plus size={16} />
            </button>
          </div>
          {recordsError ? (
            <div className="py-2 text-[12px] text-p-high">{t('habitActionFailed')}</div>
          ) : records == null ? (
            <div className="py-2 text-[12px] text-ink-3">{t('loading')}</div>
          ) : records.length === 0 ? (
            <div className="py-2 text-[12px] text-ink-3">{t('habitNoLogs')}</div>
          ) : (
            <ul className="divide-y divide-line/70">
              {[...records].reverse().map((record) => {
                const day = `${String(record.stamp).slice(0, 4)}-${String(record.stamp).slice(4, 6)}-${String(record.stamp).slice(6, 8)}`;
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => checkin.openLog(habit, day, record, (saved) => saveRecord(saved, record.stamp))}
                      className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-hover"
                      title={t('habitEditLog')}
                    >
                      <span className="text-[20px] leading-6" aria-hidden="true">{logFace(record.emoji)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] text-ink-3">{shortDate(day, lang)}</span>
                        <span className="block whitespace-pre-wrap break-words text-[13px] text-ink">{record.content || t('habitLogEmpty')}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-5" aria-label={t('habitYearStats')}>
          <div className="mb-2 flex items-center">
            <h3 className="flex-1 text-[13px] font-medium">{f('habitYearTitle', year)}</h3>
            <NavButton label={t('habitPreviousYear')} onClick={() => setYear(year - 1)} disabled={year <= startYear}><ChevronLeft size={16} /></NavButton>
            <NavButton label={t('habitNextYear')} onClick={() => setYear(year + 1)} disabled={year >= currentYear}><ChevronRight size={16} /></NavButton>
          </div>
          <YearHeatmap habit={habit} ctx={ctx} year={year} today={today} />
          <h4 className="mb-1 mt-4 text-[12px] font-medium text-ink-2">{count ? f('habitTrendAmount', unit) : t('habitTrendDays')}</h4>
          <MonthlyTrend series={series} year={year} selectedMonth={month} measure={count ? unit : t('habitDays')} />
        </section>
      </div>
    </>
  );

  if (overlay) {
    return <div className="fixed inset-0 z-40 flex flex-col bg-white">{body}</div>;
  }
  return <aside className="flex h-full min-w-0 flex-1 flex-col border-l border-line" aria-label={habit.name}>{body}</aside>;
}
