import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { useT } from '../../../i18n';
import { durationTicks, type HeatCell } from '../../../lib/focusPeriods';
import { useElementWidth } from './ui';

/**
 * Focus charts in plain SVG: one series each, in the theme color, so they
 * follow the blue / violet / green / dark themes. Every chart card can switch
 * to a table of the same numbers, and every mark has a hover/focus tooltip.
 */

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export function ChartCard({
  title,
  subtitle,
  table,
  children,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  table?: TableData;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-white p-4 ${className}`}>
      <div className="mb-3 flex min-h-7 items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium text-ink">{title}</h3>
          {subtitle && <div className="mt-0.5 text-[12px] text-ink-3">{subtitle}</div>}
        </div>
        {table && (
          <button
            type="button"
            onClick={() => setAsTable((value) => !value)}
            title={asTable ? t('focusChartView') : t('focusTableView')}
            aria-label={asTable ? t('focusChartView') : t('focusTableView')}
            aria-pressed={asTable}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"
          >
            {asTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
          </button>
        )}
      </div>
      {asTable && table ? <DataTable table={table} /> : children}
    </section>
  );
}

function DataTable({ table }: { table: TableData }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-white text-ink-3">
          <tr>
            {table.columns.map((column, index) => (
              <th key={column} className={`py-1.5 font-medium ${index > 0 ? 'text-right' : ''}`}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-line/70">
              {row.map((cell, index) => (
                <td key={index} className={`py-1.5 text-ink-2 ${index > 0 ? 'text-right tabular-nums' : 'max-w-[220px] truncate'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tooltip: the value leads, the label follows. */
function Tip({ x, y, width, value, label }: { x: number; y: number; width: number; value: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tipWidth, setTipWidth] = useState(0);
  useEffect(() => setTipWidth(ref.current?.offsetWidth ?? 0), [value, label]);
  const left = Math.min(Math.max(x - tipWidth / 2, 0), Math.max(0, width - tipWidth));
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-line bg-white px-2 py-1 shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
      style={{ left, top: y, transform: 'translateY(calc(-100% - 6px))' }}
    >
      <div className="text-[12px] font-semibold text-ink">{value}</div>
      <div className="text-[11px] text-ink-3">{label}</div>
    </div>
  );
}

export interface ColumnDatum {
  key: string;
  /** Seconds. */
  value: number;
  /** Axis text under the column ('' leaves it out). */
  tick: string;
  /** Tooltip label, e.g. the full date. */
  label: string;
}

/** Path of a column with 4px rounded data end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Vertical columns over a duration axis (trend, hours of the day). */
export function ColumnChart({
  data,
  format,
  height = 176,
  ariaLabel,
}: {
  data: ColumnDatum[];
  format: (seconds: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [active, setActive] = useState<number | null>(null);
  const axis = 44;
  const top = 10;
  const bottom = 22;
  const plotWidth = Math.max(0, width - axis);
  const plotHeight = height - top - bottom;
  const ticks = durationTicks(Math.max(0, ...data.map((d) => d.value)));
  const max = ticks[ticks.length - 1] || 1;
  const band = data.length ? plotWidth / data.length : 0;
  // Thin columns: at most 24px, and a 2px surface gap when they get close.
  const barWidth = Math.max(1, Math.min(24, band * 0.6, band - 2));
  const y = (value: number) => top + plotHeight - (value / max) * plotHeight;
  const current = active == null ? null : data[active];

  return (
    <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={axis} x2={width} y1={y(tick)} y2={y(tick)} style={{ stroke: 'var(--color-line)' }} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={axis - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="fill-ink-3 text-[10px] tabular-nums">
                {format(tick)}
              </text>
            </g>
          ))}
          {data.map((datum, index) => {
            const x = axis + index * band + (band - barWidth) / 2;
            const h = (datum.value / max) * plotHeight;
            return (
              <g key={datum.key}>
                {datum.value > 0 && (
                  <path
                    d={columnPath(x, y(datum.value), barWidth, h)}
                    style={{ fill: 'var(--color-tt)', opacity: active == null || active === index ? 1 : 0.55 }}
                  />
                )}
                {datum.tick && (
                  <text x={axis + index * band + band / 2} y={height - 6} textAnchor="middle" className="fill-ink-3 text-[10px]">
                    {datum.tick}
                  </text>
                )}
                {/* The whole band is the hit target, not just the painted column. */}
                <rect
                  x={axis + index * band}
                  y={top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`${datum.label}: ${format(datum.value)}`}
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                />
              </g>
            );
          })}
        </svg>
      )}
      {current && active != null && (
        <Tip x={axis + active * band + band / 2} y={y(current.value)} width={width} value={format(current.value)} label={current.label} />
      )}
    </div>
  );
}

export interface RankDatum {
  key: string;
  name: string;
  seconds: number;
  pomoCount: number;
  /** Identity mark beside the name (a list's color). */
  swatch?: string | null;
}

/** Ranked horizontal bars, largest first, one hue; values printed at the row end. */
export function RankBars({
  data,
  format,
  pomo,
  limit = 6,
}: {
  data: RankDatum[];
  format: (seconds: number) => string;
  pomo: ReactNode;
  limit?: number;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.seconds));
  const shown = all ? data : data.slice(0, limit);
  return (
    <div>
      <ul className="space-y-3">
        {shown.map((datum) => (
          <li key={datum.key} className="min-w-0">
            <div className="flex items-center gap-2 text-[13px]">
              {datum.swatch !== undefined && (
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: datum.swatch ?? 'var(--color-line)' }} />
              )}
              <span className="min-w-0 flex-1 truncate text-ink-2">{datum.name}</span>
              <span className="shrink-0 text-[12px] text-ink-2">{format(datum.seconds)}</span>
              {datum.pomoCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 text-[12px] text-ink-3">
                  {datum.pomoCount}
                  {pomo}
                </span>
              )}
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-hover">
              <div className="h-2 rounded-full" style={{ width: `${Math.max(1.5, (datum.seconds / max) * 100)}%`, background: 'var(--color-tt)' }} />
            </div>
          </li>
        ))}
      </ul>
      {data.length > limit && (
        <button type="button" onClick={() => setAll((value) => !value)} className="mt-3 text-[12px] text-tt hover:underline">
          {all ? t('focusShowLess') : t('focusShowAll')}
        </button>
      )}
    </div>
  );
}

/** Sequential steps of the theme color over the surface (dark mode starts dark). */
export const HEAT_FILLS = [
  'var(--color-line)',
  'color-mix(in srgb, var(--color-tt) 28%, var(--nt-surface))',
  'color-mix(in srgb, var(--color-tt) 52%, var(--nt-surface))',
  'color-mix(in srgb, var(--color-tt) 76%, var(--nt-surface))',
  'var(--color-tt)',
];

/**
 * GitHub-style calendar heatmap: a column per week, Sunday on top. Scrolls
 * sideways on narrow screens, starting at the latest weeks.
 */
export function Heatmap({
  weeks,
  monthTick,
  weekdayTick,
  describe,
  less,
  more,
}: {
  weeks: HeatCell[][];
  /** Month label for a week column starting a month ('' otherwise). */
  monthTick: (week: HeatCell[]) => string;
  weekdayTick: (row: number) => string;
  describe: (cell: HeatCell) => { value: string; label: string };
  less: string;
  more: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scroller);
  const [active, setActive] = useState<HeatCell | null>(null);
  const left = 30;
  const top = 18;
  const gap = 3;
  const cell = Math.max(9, Math.min(14, Math.floor((width - left) / Math.max(1, weeks.length)) - gap));
  const step = cell + gap;
  const svgWidth = left + weeks.length * step;
  const svgHeight = top + 7 * step;

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks, width]);

  const activePos = (() => {
    if (!active) return null;
    const column = weeks.findIndex((week) => week.some((c) => c.day === active.day));
    const row = weeks[column]?.findIndex((c) => c.day === active.day) ?? 0;
    return { x: left + column * step + cell / 2 - (scroller.current?.scrollLeft ?? 0), y: top + row * step };
  })();

  return (
    <div className="relative">
      <div ref={scroller} className="overflow-x-auto" onPointerLeave={() => setActive(null)} onScroll={() => setActive(null)}>
        {width > 0 && (
          <svg width={svgWidth} height={svgHeight} className="block">
            {weeks.map((week, column) => {
              const tick = monthTick(week);
              return tick ? (
                <text key={`m${week[0].day}`} x={left + column * step} y={11} className="fill-ink-3 text-[10px]">{tick}</text>
              ) : null;
            })}
            {[1, 3, 5].map((row) => (
              <text key={row} x={0} y={top + row * step + cell - 1} className="fill-ink-3 text-[10px]">{weekdayTick(row)}</text>
            ))}
            {weeks.map((week, column) =>
              week.map((day, row) =>
                day.outside ? null : (
                  <rect
                    key={day.day}
                    x={left + column * step}
                    y={top + row * step}
                    width={cell}
                    height={cell}
                    rx={2}
                    style={{ fill: HEAT_FILLS[day.level] }}
                    stroke={active?.day === day.day ? 'var(--color-ink-2)' : 'none'}
                    strokeWidth={1}
                    onPointerEnter={() => setActive(day)}
                  />
                ),
              ),
            )}
          </svg>
        )}
      </div>
      {active && activePos && (
        <Tip x={activePos.x} y={activePos.y} width={width} {...describe(active)} />
      )}
      <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-ink-3">
        <span className="mr-1">{less}</span>
        {HEAT_FILLS.map((fill) => (
          <span key={fill} className="h-[11px] w-[11px] rounded-[2px]" style={{ background: fill }} />
        ))}
        <span className="ml-1">{more}</span>
      </div>
    </div>
  );
}
