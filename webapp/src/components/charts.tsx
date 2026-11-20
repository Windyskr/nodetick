import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { niceTicks } from '../lib/stats';
import { useT } from '../i18n';

/**
 * Small, theme-aware chart pieces: one series each, drawn in the theme accent
 * (--color-tt) on the page surface, so the four themes and dark mode need no
 * palette of their own. Text always uses the ink tokens, never the series
 * color. Every mark answers hover and keyboard focus with a tooltip, and each
 * card can switch to a table holding the same numbers.
 */

/** Sequential steps of the accent for heat cells, light (few) to strong (many). */
export const HEAT_COLORS = [
  'var(--color-line)',
  'color-mix(in oklab, var(--color-tt) 30%, var(--nt-surface))',
  'color-mix(in oklab, var(--color-tt) 52%, var(--nt-surface))',
  'color-mix(in oklab, var(--color-tt) 76%, var(--nt-surface))',
  'var(--color-tt)',
];

export function ChartCard({ title, subtitle, table, children, className = '' }: {
  title: string;
  subtitle?: string;
  /** The same numbers as a table; adds a chart/table switch to the card. */
  table?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const [asTable, setAsTable] = useState(false);
  const label = t(asTable ? 'statsShowChart' : 'statsShowTable');
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-white px-4 pb-4 pt-3 ${className}`}>
      <header className="mb-3 flex min-h-7 items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="truncate text-[12px] text-ink-3">{subtitle}</p>}
        </div>
        {table && (
          <button
            type="button"
            title={label}
            aria-label={label}
            onClick={() => setAsTable((value) => !value)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
          >
            {asTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
          </button>
        )}
      </header>
      {asTable ? <div className="max-h-[320px] overflow-auto">{table}</div> : children}
    </section>
  );
}

/** A two-column table of labels and values for a card's table view. */
export function DataTable({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-left text-ink-3">
          <th className="py-1 pr-3 font-medium">{head[0]}</th>
          <th className="py-1 text-right font-medium">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value], index) => (
          <tr key={index} className="border-t border-line/70 text-ink-2">
            <td className="py-1 pr-3">{label}</td>
            <td className="py-1 text-right tabular-nums text-ink">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tooltip({ value, label, left }: { value: string; label?: string; left: number | string }) {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#191919] px-2 py-1 text-center shadow-lg ring-1 ring-white/10"
      style={{ left }}
    >
      <div className="text-[12px] font-semibold text-white">{value}</div>
      {label && <div className="text-[11px] text-white/70">{label}</div>}
    </div>
  );
}

export interface Column {
  /** Axis label (may be empty to thin out a crowded axis). */
  label: string;
  /** Full label for the tooltip and the table. */
  full: string;
  value: number;
}

/**
 * Columns from a shared baseline: at most 24px wide, 4px rounded tops, square
 * at the baseline, a hairline grid with clean ticks, and the value of the
 * hovered or focused column in a tooltip.
 */
export function ColumnChart({ columns, format, height = 150, ariaLabel }: {
  columns: Column[];
  format: (value: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...columns.map((column) => column.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  // Narrow columns: end labels would stick out of the card, so they align to its edges.
  const dense = columns.length > 12;
  return (
    <div className="flex gap-2" role="group" aria-label={ariaLabel}>
      <div className="relative w-7 shrink-0 text-right text-[11px] tabular-nums text-ink-3" style={{ height }} aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: height - (tick / top) * height }}>{tick}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }}>
          {ticks.map((tick) => (
            <div key={tick} className="absolute inset-x-0 h-px bg-line" style={{ top: height - (tick / top) * height }} aria-hidden="true" />
          ))}
          <div className="absolute inset-0 flex items-end">
            {columns.map((column, index) => (
              <div
                key={index}
                tabIndex={0}
                aria-label={`${column.full}: ${format(column.value)}`}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive((current) => (current === index ? null : current))}
                onFocus={() => setActive(index)}
                onBlur={() => setActive((current) => (current === index ? null : current))}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center px-px outline-none"
              >
                <div
                  className={`w-full max-w-6 rounded-t-[4px] bg-tt transition-opacity ${active === index ? 'opacity-70' : ''}`}
                  style={{ height: column.value > 0 ? Math.max(2, (column.value / top) * height) : 0 }}
                />
                {active === index && <Tooltip value={format(column.value)} label={column.full} left="50%" />}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1 flex h-4 text-[11px] text-ink-3" aria-hidden="true">
          {columns.map((column, index) => (
            <span key={index} className="relative min-w-0 flex-1">
              <span
                className={`absolute top-0 whitespace-nowrap ${dense && index === 0 ? 'left-0' : dense && index === columns.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
              >
                {column.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Horizontal bars for a breakdown: label, a thin bar in proportion, the value and share at the tip. */
export function BarList({ rows, format, total, ariaLabel }: {
  rows: { key: string; label: ReactNode; text: string; value: number }[];
  format: (value: number) => string;
  /** Share base; defaults to the sum of the rows. */
  total?: number;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const sum = total ?? rows.reduce((acc, row) => acc + row.value, 0);
  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {rows.map((row) => (
        <li key={row.key} className="text-[12px]" aria-label={`${row.text}: ${format(row.value)}`}>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-ink-2">{row.label}</span>
            <span className="shrink-0 font-medium text-ink">{format(row.value)}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-ink-3">{sum > 0 ? `${Math.round((row.value / sum) * 100)}%` : '—'}</span>
          </div>
          <div className="h-2 rounded-full bg-line/60" aria-hidden="true">
            <div className="h-2 rounded-full bg-tt" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A year of days as a GitHub-style grid (weeks as columns, Sunday on top),
 * colored by a one-hue ramp of the accent; future days are blank.
 */
export function Heatmap({ cells, level, format, monthLabel, weekdayLabels, legend, ariaLabel }: {
  cells: { day: string; count: number }[];
  /** What the grid shows, for screen readers (the card's table view has the numbers). */
  ariaLabel: string;
  level: (count: number) => number;
  format: (cell: { day: string; count: number }) => string;
  monthLabel: (day: string) => string;
  /** Labels for the Monday, Wednesday and Friday rows. */
  weekdayLabels: [string, string, string];
  legend: [string, string];
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const weeks = Math.ceil(cells.length / 7);
  const GAP = 2;
  // Fill the card on wide screens; below 9px a cell is too small to hover, so scroll instead.
  const CELL = width ? Math.max(9, Math.min(15, Math.floor((width - 28 - (weeks - 1) * GAP) / weeks))) : 11;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // When the year doesn't fit, show the latest weeks first.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [CELL, cells.length]);
  let lastLabel = -3;
  const months = Array.from({ length: weeks }, (_, week) => {
    const first = cells[week * 7];
    const previous = week > 0 ? cells[(week - 1) * 7] : null;
    const starts = !previous || previous.day.slice(5, 7) !== first.day.slice(5, 7);
    // A month that starts within three weeks of the last label would overlap it.
    if (!starts || week - lastLabel < 3) return '';
    lastLabel = week;
    return monthLabel(first.day);
  });
  const activeCell = active == null ? null : cells[active];
  return (
    <div ref={scroller} className="overflow-x-auto pb-1">
      <div className="relative inline-block min-w-full">
        <div className="ml-7 flex text-[11px] text-ink-3" style={{ gap: GAP }} aria-hidden="true">
          {months.map((label, week) => (
            <span key={week} className="overflow-visible whitespace-nowrap" style={{ width: CELL }}>{label}</span>
          ))}
        </div>
        <div className="mt-1 flex" style={{ gap: GAP }}>
          <div className="sticky left-0 z-[1] mr-1 grid w-6 bg-white text-[10px] leading-none text-ink-3" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }} aria-hidden="true">
            <span />
            <span className="self-center">{weekdayLabels[0]}</span>
            <span />
            <span className="self-center">{weekdayLabels[1]}</span>
            <span />
            <span className="self-center">{weekdayLabels[2]}</span>
            <span />
          </div>
          <div
            role="img"
            aria-label={ariaLabel}
            aria-describedby={`${id}-legend`}
            className="relative grid grid-flow-col"
            style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, gridAutoColumns: `${CELL}px`, gap: GAP }}
            onPointerLeave={() => setActive(null)}
          >
            {cells.map((cell, index) => (
              <span
                key={cell.day}
                onPointerEnter={() => setActive(cell.count >= 0 ? index : null)}
                className={`rounded-[2px] ${active === index ? 'ring-1 ring-ink-3' : ''}`}
                style={{ background: cell.count < 0 ? 'transparent' : HEAT_COLORS[level(cell.count)] }}
              />
            ))}
            {activeCell && active != null && (
              <Tooltip value={format(activeCell)} left={Math.floor(active / 7) * (CELL + GAP) + CELL / 2} />
            )}
          </div>
        </div>
        <div id={`${id}-legend`} className="mt-2 flex items-center justify-end gap-1 text-[11px] text-ink-3">
          <span>{legend[0]}</span>
          {HEAT_COLORS.map((color) => <span key={color} className="h-[11px] w-[11px] rounded-[2px]" style={{ background: color }} />)}
          <span>{legend[1]}</span>
        </div>
      </div>
    </div>
  );
}

/** A labelled number with an optional comparison line. */
export function StatTile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'up' | 'down' | 'flat' }) {
  const toneClass = tone === 'up' ? 'text-[#2e9b72]' : tone === 'down' ? 'text-p-high' : 'text-ink-3';
  return (
    <div className="min-w-0 rounded-xl bg-[#fafafa] px-4 py-3">
      <div className="truncate text-[12px] text-ink-3">{label}</div>
      <div className="mt-1 text-[24px] font-semibold leading-tight text-ink">{value}</div>
      {detail && <div className={`mt-0.5 truncate text-[12px] ${toneClass}`}>{detail}</div>}
    </div>
  );
}
