import { useMemo, useState } from 'react';
import { Flag, Hash, Inbox } from 'lucide-react';
import { useStore } from '../../stores/store';
import { useI18n, useT, useTF, type Key } from '../../i18n';
import { shortDate, todayStr, weekdayShort } from '../../lib/date';
import { INBOX_ID, projectDisplayName } from '../../lib/project';
import { completionCalendar, computeStats, heatLevel, type Bucket, type StatsRange } from '../../lib/stats';
import { BarList, ChartCard, ColumnChart, DataTable, Heatmap, StatTile, type Column } from '../../components/charts';
import { PRIORITY_COLORS, priorityLabel } from '../../components/RoundCheck';

const RANGE_KEY = 'ntk_stats_range';
const RANGES: [StatsRange, Key][] = [['7d', 'statsRange7d'], ['30d', 'statsRange30d'], ['12w', 'statsRange12w'], ['12m', 'statsRange12m']];
const MAX_ROWS = 8;
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function readRange(): StatsRange {
  try {
    const value = localStorage.getItem(RANGE_KEY);
    return RANGES.some(([range]) => range === value) ? (value as StatsRange) : '30d';
  } catch {
    return '30d';
  }
}

/** Task statistics: completions over time, on-time rate, a year of activity, and where the work went. */
export default function StatsPage() {
  const t = useT();
  const f = useTF();
  const lang = useI18n((state) => state.lang);
  const { tasks, completed, abandoned, projects, tags } = useStore();
  const [range, setRange] = useState<StatsRange>(readRange);
  const [projectId, setProjectId] = useState('');
  const today = todayStr();

  const stats = useMemo(
    () => computeStats({ open: tasks, completed, abandoned, range, today, projectId: projectId || null }),
    [tasks, completed, abandoned, range, today, projectId],
  );
  const calendar = useMemo(
    () => completionCalendar(projectId ? completed.filter((task) => task.projectId === projectId) : completed, today),
    [completed, projectId, today],
  );
  const calendarMax = Math.max(0, ...calendar.map((cell) => cell.count));

  const pickRange = (value: StatsRange) => {
    setRange(value);
    try {
      localStorage.setItem(RANGE_KEY, value);
    } catch {
      // The choice lasts for this visit when storage is unavailable.
    }
  };

  const monthName = (day: string, withYear = false) => {
    const month = Number(day.slice(5, 7));
    if (lang === 'zh') return withYear ? `${day.slice(0, 4)}年${month}月` : `${month}月`;
    return withYear ? `${MONTHS_EN[month - 1]} ${day.slice(0, 4)}` : MONTHS_EN[month - 1];
  };
  const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const bucketText = (bucket: Bucket) => {
    if (range === '12m') return monthName(bucket.start, true);
    if (range === '12w') return `${shortDate(bucket.start, lang)} – ${shortDate(bucket.end, lang)}`;
    return `${shortDate(bucket.start, lang)} ${weekdayShort(bucket.start, lang)}`;
  };
  const tasksText = (value: number) => f('statsTasks', value);

  const trend: Column[] = stats.series.map(({ bucket, value }, index, all) => {
    let label = '';
    if (range === '7d') label = weekdayShort(bucket.start, lang);
    else if (range === '30d') label = (all.length - 1 - index) % 5 === 0 ? md(bucket.start) : '';
    else if (range === '12w') label = index % 2 === 1 ? md(bucket.start) : '';
    else label = monthName(bucket.start);
    return { label, full: bucketText(bucket), value };
  });

  const projectName = (id: string) =>
    projectDisplayName(projects.find((project) => project.id === id), t, id === INBOX_ID ? t('smartInbox') : id);
  const projectColor = (id: string) => projects.find((project) => project.id === id)?.color ?? '#4772FA';
  const listRows = stats.byProject.slice(0, MAX_ROWS).map(({ id, value }) => ({
    key: id,
    text: projectName(id),
    value,
    label: (
      <>
        {id === INBOX_ID
          ? <Inbox size={12} className="shrink-0 text-ink-3" />
          : <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: projectColor(id) }} />}
        <span className="truncate">{projectName(id)}</span>
      </>
    ),
  }));
  const tagLabel = (name: string) => tags.find((tag) => tag.name === name)?.label ?? name;
  const tagRows = stats.byTag.slice(0, MAX_ROWS).map(({ name, value }) => ({
    key: name,
    text: `#${tagLabel(name)}`,
    value,
    label: <><Hash size={12} className="shrink-0 text-ink-3" /><span className="truncate">{tagLabel(name)}</span></>,
  }));
  const priorityRows = stats.byPriority.map(({ priority, value }) => ({
    key: String(priority),
    text: priorityLabel(priority),
    value,
    label: <><Flag size={12} className="shrink-0" style={{ color: PRIORITY_COLORS[priority] }} /><span>{priorityLabel(priority)}</span></>,
  }));
  const hours: Column[] = stats.byHour.map((value, hour) => ({ label: hour % 6 === 0 ? String(hour) : '', full: f('statsHour', hour), value }));
  // Weekdays in the app's week order (Sunday first); 2026-11-15 is a Sunday.
  const weekdays: Column[] = stats.byWeekday.map((value, index) => {
    const name = weekdayShort(`2026-11-${String(15 + index).padStart(2, '0')}`, lang);
    return { label: name, full: name, value };
  });
  const monthTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const cell of calendar) if (cell.count > 0) totals.set(cell.day.slice(0, 7), (totals.get(cell.day.slice(0, 7)) ?? 0) + cell.count);
    return [...totals.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [calendar]);

  const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
  const delta = stats.completed - stats.previousCompleted;
  const columnsTable = (columns: Column[]) => (
    <DataTable head={[t('statsPeriod'), t('statsCount')]} rows={columns.map((column) => [column.full, column.value])} />
  );
  const rowsTable = (head: string, rows: { text: string; value: number }[]) => (
    <DataTable head={[head, t('statsCount')]} rows={rows.map((row) => [row.text, row.value])} />
  );
  const nothing = <p className="py-6 text-center text-[13px] text-ink-3">{t('statsNoData')}</p>;

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
      <div className="mx-auto max-w-[960px] px-5 pb-12">
        <header className="flex h-16 items-center">
          <h1 className="text-[20px] font-bold">{t('statsTitle')}</h1>
        </header>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-hover p-0.5" role="group" aria-label={t('statsPeriod')}>
            {RANGES.map(([value, key]) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                onClick={() => pickRange(value)}
                className={`rounded-md px-3 py-1 text-[13px] transition-colors ${range === value ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            aria-label={t('filterList')}
            className="h-8 max-w-[220px] rounded-lg border border-line bg-white px-2 text-[13px] text-ink-2"
          >
            <option value="">{t('filterAnyList')}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{projectName(project.id)}</option>)}
          </select>
        </div>

        {completed.length === 0 && tasks.length === 0 ? (
          <div className="rounded-xl border border-line px-6 py-16 text-center text-[13px] text-ink-3">{t('statsEmpty')}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile
                label={t('statsCompleted')}
                value={String(stats.completed)}
                detail={delta === 0 ? t('statsSamePrevious') : f('statsVsPrevious', `${delta > 0 ? '+' : ''}${delta}`)}
                tone={delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}
              />
              <StatTile label={t('statsCompletionRate')} value={percent(stats.dueCompleted, stats.due)} detail={f('statsCompletionRateDetail', stats.dueCompleted, stats.due)} />
              <StatTile label={t('statsOnTimeRate')} value={percent(stats.onTime, stats.withDue)} detail={f('statsOnTimeDetail', stats.onTime, stats.withDue)} />
              <StatTile label={t('statsOverdue')} value={String(stats.overdueNow)} detail={f('statsOverdueDetail', stats.openNow)} />
            </div>
            <p className="mb-4 mt-2 text-[12px] text-ink-3">{f('statsSummaryLine', stats.totalCompleted, stats.created)}</p>

            <div className="grid gap-4">
              <ChartCard title={t('statsTrend')} subtitle={t(RANGES.find(([value]) => value === range)![1])} table={columnsTable(trend)}>
                <ColumnChart columns={trend} format={tasksText} ariaLabel={t('statsTrend')} />
              </ChartCard>

              <ChartCard
                title={t('statsCalendar')}
                table={<DataTable head={[t('statsPeriod'), t('statsCount')]} rows={monthTotals.map(([month, value]) => [monthName(`${month}-01`, true), value])} />}
              >
                <Heatmap
                  cells={calendar}
                  level={(count) => heatLevel(count, calendarMax)}
                  format={(cell) => `${tasksText(cell.count)} · ${shortDate(cell.day, lang)} ${weekdayShort(cell.day, lang)}`}
                  monthLabel={(day) => monthName(day)}
                  weekdayLabels={[weekdayShort('2026-11-16', lang), weekdayShort('2026-11-18', lang), weekdayShort('2026-11-20', lang)]}
                  legend={[t('statsLess'), t('statsMore')]}
                  ariaLabel={t('statsCalendarAria')}
                />
              </ChartCard>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title={t('statsByList')} table={rowsTable(t('filterList'), listRows)}>
                  {listRows.length ? <BarList rows={listRows} format={String} total={stats.completed} ariaLabel={t('statsByList')} /> : nothing}
                </ChartCard>
                <ChartCard title={t('statsByTag')} table={rowsTable(t('filterTag'), tagRows)}>
                  {tagRows.length ? <BarList rows={tagRows} format={String} total={stats.completed} ariaLabel={t('statsByTag')} /> : nothing}
                </ChartCard>
                <ChartCard title={t('statsByPriority')} table={rowsTable(t('filterPriority'), priorityRows)}>
                  {stats.completed ? <BarList rows={priorityRows} format={String} total={stats.completed} ariaLabel={t('statsByPriority')} /> : nothing}
                </ChartCard>
                <ChartCard title={t('statsByWeekday')} table={columnsTable(weekdays)}>
                  {stats.completed ? <ColumnChart columns={weekdays} format={tasksText} height={120} ariaLabel={t('statsByWeekday')} /> : nothing}
                </ChartCard>
                <ChartCard title={t('statsByHour')} table={columnsTable(hours)} className="lg:col-span-2">
                  {stats.completed ? <ColumnChart columns={hours} format={tasksText} height={120} ariaLabel={t('statsByHour')} /> : nothing}
                </ChartCard>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
