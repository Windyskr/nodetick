import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addDays, todayStr } from '../../../lib/date';
import {
  changeRatio,
  heatmapRange,
  heatmapWeeks,
  isCurrentPeriod,
  peakHour,
  type Period,
  type PeriodKind,
  periodOf,
  shiftPeriod,
  trendBuckets,
} from '../../../lib/focusPeriods';
import { INBOX_ID, projectDisplayName } from '../../../lib/project';
import { useEscape } from '../../../lib/useEscape';
import { useStore } from '../../../stores/store';
import { useFocus } from '../../../stores/focus';
import { useT, useTF, type Key } from '../../../i18n';
import { ChartCard, ColumnChart, Heatmap, RankBars, type ColumnDatum, type RankDatum } from './charts';
import { useFocusStats } from './data';
import { dayLabel, monthLabel, periodLabel, PomoIcon, useCompactDuration, useLang, useLongDuration, weekdayLabel } from './ui';

const KINDS: [PeriodKind, Key][] = [['day', 'focusPeriodDay'], ['week', 'focusPeriodWeek'], ['month', 'focusPeriodMonth'], ['year', 'focusPeriodYear']];
const VS: Record<PeriodKind, Key> = { day: 'focusVsDay', week: 'focusVsWeek', month: 'focusVsMonth', year: 'focusVsYear' };
const hourRange = (hour: number) => `${hour}:00–${hour + 1}:00`;

function Delta({ current, previous, vs }: { current: number; previous: number; vs: string }) {
  const t = useT();
  const ratio = changeRatio(current, previous);
  if (ratio == null) return <div className="mt-2 text-[12px] text-ink-3">{t('focusNoBaseline')}</div>;
  if (ratio === 0) return <div className="mt-2 flex flex-wrap gap-x-1 text-[12px] text-ink-3"><span className="whitespace-nowrap">{vs}</span><span className="whitespace-nowrap">{t('focusNoChange')}</span></div>;
  const up = ratio > 0;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-1 text-[12px]">
      <span className={`flex items-center gap-0.5 whitespace-nowrap font-medium ${up ? 'text-[#1f9d55]' : 'text-p-high'}`}>
        {up ? <ArrowUp size={12} strokeWidth={2.4} /> : <ArrowDown size={12} strokeWidth={2.4} />}
        {Math.round(Math.abs(ratio) * 100)}%
      </span>
      <span className="whitespace-nowrap text-ink-3">{vs}</span>
    </div>
  );
}

/**
 * 专注统计: day / week / month / year totals against the period before, the
 * trend, rankings by task and list, the best hours, and a year heatmap.
 */
export default function StatsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const f = useTF();
  const lang = useLang();
  const compact = useCompactDuration();
  const long = useLongDuration();
  const projects = useStore((state) => state.projects);
  const version = useFocus((state) => state.recordsVersion);
  const today = todayStr();
  const [kind, setKind] = useState<PeriodKind>('week');
  const [anchor, setAnchor] = useState(today);
  useEscape(onClose);

  const period = periodOf(kind, anchor);
  const previous = shiftPeriod(period, -1);
  const heat = heatmapRange(period);
  const current = useFocusStats({ from: period.from, to: period.to }, version);
  const prior = useFocusStats({ from: previous.from, to: previous.to }, version);
  const heatStats = useFocusStats({ from: heat.from, to: heat.to }, version);
  const isCurrent = isCurrentPeriod(period, today);
  const loading = current.loading || prior.loading || heatStats.loading;

  const go = (next: Period) => setAnchor(next.kind === 'day' || !isCurrentPeriod(next, today) ? next.from : today);
  const choose = (next: PeriodKind) => {
    // Keep the shown span: today when it is the current one, else its last day.
    setAnchor(isCurrent ? today : period.to);
    setKind(next);
  };

  const stats = current.data;
  const totals = stats?.period ?? { pomoCount: 0, seconds: 0, records: 0, pomoSeconds: 0, stopwatchSeconds: 0 };
  const before = prior.data?.period ?? { pomoCount: 0, seconds: 0, records: 0, pomoSeconds: 0, stopwatchSeconds: 0 };
  const vs = t(VS[kind]);

  const trend: ColumnDatum[] = useMemo(() => {
    const source = kind === 'day' ? heatStats.data?.days ?? [] : stats?.days ?? [];
    return trendBuckets(period, source).map((bucket, _index, all) => {
      if (kind === 'year') {
        return { key: bucket.key, value: bucket.seconds, tick: monthLabel(bucket.key, lang), label: monthLabel(bucket.key, lang, 'long') };
      }
      const dayOfMonth = Number(bucket.key.slice(8, 10));
      const tick = kind === 'month'
        ? (dayOfMonth === 1 || dayOfMonth % 5 === 0) && dayOfMonth < 31 ? String(dayOfMonth) : ''
        : all.length <= 7 ? weekdayLabel(bucket.key, lang) : '';
      return { key: bucket.key, value: bucket.seconds, tick, label: dayLabel(bucket.key, lang) };
    });
  }, [kind, period.from, period.to, stats, heatStats.data, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const hours: ColumnDatum[] = (stats?.byHour.length ? stats.byHour : Array<number>(24).fill(0)).map((seconds, hour) => ({
    key: String(hour),
    value: seconds,
    tick: hour % 6 === 0 ? `${hour}:00` : '',
    label: hourRange(hour),
  }));
  const peak = peakHour(stats?.byHour ?? []);

  const projectOf = (id: string | null) => projects.find((project) => project.id === id);
  const byTask: RankDatum[] = (stats?.byTask ?? []).map((row) => ({
    key: row.taskId ?? '',
    name: row.title ?? (row.taskId ? t('focusDeletedTask') : t('focusUnlinked')),
    seconds: row.seconds,
    pomoCount: row.pomoCount,
    swatch: row.projectId ? projectOf(row.projectId)?.color ?? null : null,
  }));
  const byList: RankDatum[] = (stats?.byProject ?? []).map((row) => {
    const project = projectOf(row.projectId);
    return {
      key: row.projectId ?? '',
      name: row.projectId
        ? projectDisplayName(project, t, row.projectId === INBOX_ID ? t('smartInbox') : t('focusDeletedList'))
        : t('focusNoList'),
      seconds: row.seconds,
      pomoCount: row.pomoCount,
      swatch: project?.color ?? null,
    };
  });

  const yearView = kind === 'year';
  const weeks = heatmapWeeks(heat.from, heat.to, heatStats.data?.days ?? [], {
    from: yearView ? period.from : heat.from,
    to: yearView && period.to < today ? period.to : today,
  });
  const heatDays = (heatStats.data?.days ?? []).filter((d) => d.seconds > 0 && d.day <= today).reverse();
  const sunday = '2026-11-15';
  const total = stats?.total;
  const pomo = <PomoIcon size={12} />;
  const empty = <div className="py-6 text-center text-[12px] text-ink-3">{t('focusStatsEmpty')}</div>;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/20 md:items-center md:px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('focusStatsTitle')}
        className="flex h-full w-full flex-col overflow-hidden bg-[#fafafa] shadow-[0_10px_36px_rgba(0,0,0,0.18)] md:h-auto md:max-h-[92vh] md:max-w-[1000px] md:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-white px-5 py-3 md:px-6">
          <h2 className="text-[18px] font-semibold">{t('focusStatsTitle')}</h2>
          <div role="tablist" aria-label={t('focusStatsTitle')} className="flex rounded-lg bg-hover p-0.5 text-[13px]">
            {KINDS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={kind === value}
                onClick={() => choose(value)}
                className={`h-7 min-w-11 rounded-md px-3 ${kind === value ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <button type="button" onClick={() => go(shiftPeriod(period, -1))} title={t('focusPrevPeriod')} aria-label={t('focusPrevPeriod')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-2 hover:bg-hover">
              <ChevronLeft size={17} />
            </button>
            <span className="min-w-[7.5rem] text-center text-[14px] font-medium text-ink" aria-live="polite">{periodLabel(period, lang)}</span>
            <button type="button" disabled={isCurrent} onClick={() => go(shiftPeriod(period, 1))} title={t('focusNextPeriod')} aria-label={t('focusNextPeriod')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-2 hover:bg-hover disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent">
              <ChevronRight size={17} />
            </button>
            {!isCurrent && (
              <button type="button" onClick={() => setAnchor(today)} className="ml-1 h-7 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 hover:bg-hover">
                {t('focusThisPeriod')}
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </header>

        <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 transition-opacity md:px-6 ${loading && stats ? 'opacity-60' : ''}`}>
          {current.failed && <div className="mb-3 text-[12px] text-p-high">{t('focusLoadError')}</div>}
          <div className="grid grid-cols-3 gap-3">
            {([
              ['focusStatPomos', String(totals.pomoCount), totals.pomoCount, before.pomoCount],
              ['focusStatDuration', compact(totals.seconds), totals.seconds, before.seconds],
              ['focusStatSessions', String(totals.records), totals.records, before.records],
            ] as const).map(([label, value, now, then]) => (
              <div key={label} className="min-w-0 rounded-xl border border-line bg-white px-4 py-3">
                <div className="truncate text-[12px] text-ink-3">{t(label)}</div>
                <div className="mt-1 text-[24px] font-semibold leading-tight text-ink">{value}</div>
                <Delta current={now} previous={then} vs={vs} />
              </div>
            ))}
          </div>
          {total && total.records > 0 && total.firstDay && (
            <p className="mt-3 text-[12px] text-ink-3">{f('focusAllTime', total.pomoCount, long(total.seconds), dayLabel(total.firstDay, lang, { weekday: false }))}</p>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={t('focusTrendTitle')}
              subtitle={kind === 'day' ? t('last7') : periodLabel(period, lang)}
              table={{ columns: [t('focusColWhen'), t('focusColDuration')], rows: trend.map((d) => [d.label, compact(d.value)]) }}
            >
              <ColumnChart data={trend} format={compact} ariaLabel={t('focusTrendTitle')} />
            </ChartCard>
            <ChartCard
              title={t('focusBestTime')}
              subtitle={peak != null ? f('focusBestHour', hourRange(peak)) : periodLabel(period, lang)}
              table={{ columns: [t('focusColWhen'), t('focusColDuration')], rows: hours.filter((h) => h.value > 0).map((h) => [h.label, compact(h.value)]) }}
            >
              <ColumnChart data={hours} format={compact} ariaLabel={t('focusBestTime')} />
            </ChartCard>
            <ChartCard
              title={t('focusByTask')}
              table={{ columns: [t('focusColName'), t('focusColDuration'), t('focusColPomos'), t('focusColSessions')], rows: (stats?.byTask ?? []).map((row, i) => [byTask[i].name, compact(row.seconds), row.pomoCount, row.count]) }}
            >
              {byTask.length ? <RankBars data={byTask} format={compact} pomo={pomo} /> : empty}
            </ChartCard>
            <ChartCard
              title={t('focusByList')}
              table={{ columns: [t('focusColName'), t('focusColDuration'), t('focusColPomos'), t('focusColSessions')], rows: (stats?.byProject ?? []).map((row, i) => [byList[i].name, compact(row.seconds), row.pomoCount, row.count]) }}
            >
              {byList.length ? <RankBars data={byList} format={compact} pomo={pomo} /> : empty}
            </ChartCard>
            <ChartCard
              className="lg:col-span-2"
              title={t('focusHeatmap')}
              subtitle={yearView ? periodLabel(period, lang) : `${dayLabel(heat.from, lang, { weekday: false })} – ${dayLabel(heat.to < today ? heat.to : today, lang, { weekday: false })}`}
              table={{ columns: [t('focusColWhen'), t('focusColDuration'), t('focusColPomos')], rows: heatDays.map((d) => [dayLabel(d.day, lang), compact(d.seconds), d.pomoCount]) }}
            >
              <Heatmap
                weeks={weeks}
                monthTick={(week) => {
                  const first = week.find((cell) => cell.day.endsWith('-01') && !cell.outside);
                  return first ? monthLabel(first.day.slice(0, 7), lang) : '';
                }}
                weekdayTick={(row) => weekdayLabel(addDays(sunday, row), lang)}
                describe={(cell) => ({ value: compact(cell.seconds), label: `${dayLabel(cell.day, lang)} · ${f('focusPomosLabel', cell.pomoCount)}` })}
                less={t('focusHeatLess')}
                more={t('focusHeatMore')}
              />
            </ChartCard>
          </div>
        </div>
      </div>
    </div>
  );
}
