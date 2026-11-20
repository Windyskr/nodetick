import { useMemo, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Pin } from 'lucide-react';
import type { Countdown } from '../../lib/types';
import { countdownDays, countdownProgress, countdownTarget, ymdBetween, type Span } from '../../lib/countdown';
import { countdownIcon, KIND_KEY, useCountdownText } from './countdownText';

/** What a countdown shows on a given day. */
export interface CountdownFacts {
  /** The day it counts toward (next occurrence for repeats). */
  target: string | null;
  /** Signed days to the target (workdays for workday countdowns), negative once past. */
  days: number | null;
  span: Span | null;
  isToday: boolean;
  past: boolean;
  workdays: boolean;
}

export function countdownFacts(countdown: Countdown, today: string): CountdownFacts {
  const target = countdownTarget(countdown, today);
  const workdays = countdown.calculation === 'workday';
  return {
    target,
    days: target ? countdownDays(today, target, workdays) : null,
    span: target ? ymdBetween(today, target) : null,
    isToday: target === today,
    past: target != null && target < today,
    workdays,
  };
}

/** "距离 2026年12月25日 还有" / "Days since …", or just the day when it is today. */
export function useCountdownCaption(countdown: Countdown, facts: CountdownFacts): string {
  const text = useCountdownText();
  if (!facts.target) return '';
  const label = text.dayLabel(countdown, facts.target);
  if (facts.isToday) return label;
  return text.f(facts.past ? 'countdownSinceDate' : 'countdownUntilDate', label);
}

type NumberSize = 'xl' | 'lg' | 'md' | 'sm';
const NUMBER: Record<NumberSize, { number: string; unit: string; ymd: string; today: string }> = {
  xl: { number: 'text-[52px] font-light', unit: 'ml-1.5 text-[14px]', ymd: 'text-[38px] font-light', today: 'text-[44px] font-light' },
  lg: { number: 'text-[42px] font-semibold', unit: 'ml-1 text-[13px] font-medium', ymd: 'text-[30px] font-semibold', today: 'text-[32px] font-semibold' },
  md: { number: 'text-[30px] font-semibold', unit: 'ml-0.5 text-[12px] font-medium', ymd: 'text-[22px] font-semibold', today: 'text-[22px] font-semibold' },
  sm: { number: 'text-[21px] font-semibold', unit: 'ml-0.5 text-[12px]', ymd: 'text-[18px] font-semibold', today: 'text-[15px] font-semibold' },
};

/** The big number: days (with unit), years/months/days, or "今天". */
export function CountdownNumber({ countdown, facts, size, className = '' }: { countdown: Countdown; facts: CountdownFacts; size: NumberSize; className?: string }) {
  const text = useCountdownText();
  const classes = NUMBER[size];
  if (facts.days == null) return <span className={`${classes.number} leading-none ${className}`}>—</span>;
  if (facts.isToday) return <span className={`${classes.today} leading-none ${className}`}>{text.t('countdownToday')}</span>;
  const count = Math.abs(facts.days);
  const span = facts.span;
  if (countdown.numberFormat === 'ymd' && !facts.workdays && span && (span.years || span.months)) {
    const parts: [number, string][] = [];
    if (span.years) parts.push([span.years, text.t('countdownYears')]);
    if (span.months) parts.push([span.months, text.t('countdownMonths')]);
    if (span.days) parts.push([span.days, text.t('countdownDaysShort')]);
    return (
      <span className={`inline-flex flex-wrap items-baseline justify-center gap-x-1 leading-none tabular-nums ${className}`}>
        {parts.map(([value, unit]) => (
          <span key={unit} className="inline-flex items-baseline">
            <span className={classes.ymd}>{value}</span>
            <span className={classes.unit}>{unit}</span>
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-baseline leading-none tabular-nums ${className}`}>
      <span className={classes.number}>{count}</span>
      <span className={classes.unit}>{text.unit(count, facts.workdays)}</span>
    </span>
  );
}

function Ring({ progress, color, size, stroke, children }: { progress: number; color: string; size: number; stroke: number; children: ReactNode }) {
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        {progress > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${length * progress} ${length}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export interface CardDrag {
  draggable: boolean;
  over: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

interface CardProps {
  countdown: Countdown;
  today: string;
  onOpen?: () => void;
  /** Hover actions (pin, more) from the page. */
  actions?: ReactNode;
  selected?: boolean;
  drag?: CardDrag;
}

function interactiveProps(name: string, onOpen?: () => void, drag?: CardDrag) {
  return {
    role: onOpen ? 'button' : undefined,
    tabIndex: onOpen ? 0 : undefined,
    'aria-label': onOpen ? name : undefined,
    onClick: onOpen,
    onKeyDown: onOpen ? (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen();
      }
    } : undefined,
    draggable: drag?.draggable || undefined,
    onDragStart: drag?.onDragStart,
    onDragOver: drag?.onDragOver,
    onDrop: drag?.onDrop,
    onDragEnd: drag?.onDragEnd,
  };
}

const tint = (color: string, percent: number, base = 'transparent') => `color-mix(in srgb, ${color} ${percent}%, ${base})`;

/** A countdown card in one of the five styles (persisted `style` 0–4). */
export function CountdownCard({ countdown, today, onOpen, actions, selected = false, drag }: CardProps) {
  const text = useCountdownText();
  const facts = useMemo(() => countdownFacts(countdown, today), [countdown, today]);
  const caption = useCountdownCaption(countdown, facts);
  const name = countdown.name ?? '';
  const icon = countdownIcon(countdown);
  const color = countdown.color;
  const style = Math.min(4, Math.max(0, Math.trunc(countdown.style) || 0));
  // No overflow clipping here: the hover menu's panel has to reach past the card.
  const shell = `group relative h-[188px] min-w-0 rounded-xl text-left transition-shadow ${onOpen ? 'cursor-pointer' : ''} ${
    selected ? 'ring-2 ring-tt' : drag?.over ? 'ring-2 ring-tt/50' : ''
  }`;
  const props = interactiveProps(name, onOpen, drag);
  const hover = actions && (
    <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>
      {actions}
    </div>
  );
  const pin = (className: string) => countdown.pinned && <Pin size={13} aria-label={text.t('countdownPinned')} className={`absolute left-3 top-3 rotate-45 ${className}`} fill="currentColor" />;

  if (style === 1) {
    return (
      <article {...props} className={`${shell} text-white`} style={{ background: `linear-gradient(140deg, ${color} 0%, ${tint(color, 70, '#000')} 100%)`, boxShadow: `0 6px 18px ${tint(color, 28)}` }}>
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl" aria-hidden="true">
          <span className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
          <span className="absolute -bottom-10 right-10 h-24 w-24 rounded-full bg-white/10" />
        </span>
        {pin('text-white/80')}
        <div className="relative flex h-full flex-col px-5 pb-4 pt-5">
          <div className="flex min-w-0 items-center gap-2 pr-16 text-[15px] font-semibold">
            <span className="text-[18px] leading-none">{icon}</span>
            <span className="truncate">{name}</span>
          </div>
          <div className="mt-auto"><CountdownNumber countdown={countdown} facts={facts} size="lg" /></div>
          <div className="mt-2 truncate text-[12px] text-white/80">{caption}</div>
        </div>
        {hover}
      </article>
    );
  }

  if (style === 2) {
    const target = facts.target ?? today;
    return (
      <article {...props} className={`${shell} border border-line bg-white shadow-[0_3px_14px_rgba(0,0,0,0.04)]`}>
        <div className="relative flex h-[42px] items-center justify-between rounded-t-[11px] px-4 text-[13px] font-medium text-white" style={{ background: color }}>
          <span className="pointer-events-none absolute left-9 top-[-4px] h-3 w-[6px] rounded-full bg-white/60" />
          <span className="pointer-events-none absolute right-9 top-[-4px] h-3 w-[6px] rounded-full bg-white/60" />
          <span className="truncate">{text.month(target)}</span>
          <span className="shrink-0 pl-2">{text.weekday(target)}</span>
        </div>
        {countdown.pinned && <Pin size={12} aria-label={text.t('countdownPinned')} className="absolute bottom-3 left-3 rotate-45 text-ink-3" fill="currentColor" />}
        <div className="flex h-[146px] flex-col items-center justify-center px-4">
          <CountdownNumber countdown={countdown} facts={facts} size="xl" className="text-ink" />
          <div className="mt-3 flex max-w-full items-center gap-1.5 text-[14px] font-semibold">
            <span className="text-[15px] leading-none">{icon}</span>
            <span className="truncate">{name}</span>
          </div>
          <div className="mt-0.5 max-w-full truncate text-[11.5px] text-ink-3">{caption}</div>
        </div>
        {hover}
      </article>
    );
  }

  if (style === 3) {
    return (
      <article {...props} className={`${shell} border`} style={{ background: tint(color, 12, 'var(--nt-surface)'), borderColor: tint(color, 24, 'var(--color-line)') }}>
        <div className="flex h-full flex-col p-5">
          <div className="flex items-start justify-between gap-2 pr-16">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-[22px] shadow-[0_2px_8px_rgba(0,0,0,0.06)]" style={{ background: tint('var(--nt-surface)', 88) }}>{icon}</span>
            {countdown.pinned && <Pin size={13} aria-label={text.t('countdownPinned')} className="mt-1 rotate-45" style={{ color }} fill="currentColor" />}
          </div>
          <div className="mt-auto flex items-end justify-between gap-3">
            <div className="min-w-0 pb-0.5">
              <div className="mb-1 inline-block rounded-full px-2 py-[1px] text-[11px] font-medium" style={{ color, background: tint(color, 14) }}>{text.t(KIND_KEY[countdown.kind])}</div>
              <div className="truncate text-[15px] font-semibold text-ink">{name}</div>
              <div className="truncate text-[12px] text-ink-2">{caption}</div>
            </div>
            <span className="shrink-0" style={{ color }}><CountdownNumber countdown={countdown} facts={facts} size="lg" /></span>
          </div>
        </div>
        {hover}
      </article>
    );
  }

  if (style === 4) {
    const progress = facts.target ? countdownProgress(countdown, today, facts.target) : 0;
    const digits = String(Math.abs(facts.days ?? 0)).length;
    const ringNumber = facts.isToday ? 'text-[22px]' : digits <= 3 ? 'text-[30px]' : digits === 4 ? 'text-[25px]' : 'text-[20px]';
    const ymd = countdown.numberFormat === 'ymd' && !facts.workdays && facts.span && (facts.span.years || facts.span.months);
    return (
      <article {...props} className={`${shell} border border-line bg-white shadow-[0_3px_14px_rgba(0,0,0,0.04)]`}>
        {pin('text-ink-3')}
        <div className="flex h-full items-center gap-4 px-5">
          <Ring progress={progress} color={color} size={100} stroke={8}>
            {facts.isToday || facts.days == null
              ? <span className={`${ringNumber} font-semibold leading-none`} style={{ color }}>{facts.isToday ? text.t('countdownToday') : '—'}</span>
              : <>
                <span className={`${ringNumber} font-semibold leading-none tabular-nums`} style={{ color }}>{Math.abs(facts.days)}</span>
                <span className="mt-1 text-[11px] text-ink-3">{text.unit(Math.abs(facts.days), facts.workdays)}</span>
              </>}
          </Ring>
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex min-w-0 items-start gap-1.5 text-[15px] font-semibold leading-[20px]">
              <span className="shrink-0 text-[16px] leading-[20px]">{icon}</span>
              <span className="line-clamp-2 min-w-0 break-words">{name}</span>
            </div>
            <div className="mt-1.5 line-clamp-2 text-[12px] leading-[17px] text-ink-3">{caption}</div>
            {ymd && facts.span && <div className="mt-1.5 text-[12px] font-medium" style={{ color }}>{text.span(facts.span)}</div>}
          </div>
        </div>
        {hover}
      </article>
    );
  }

  return (
    <article {...props} className={`${shell} border border-line bg-white text-center shadow-[0_3px_14px_rgba(0,0,0,0.035)]`}>
      {pin('text-ink-3')}
      <div className="mt-7 flex items-center justify-center gap-2 px-12 text-[16px] font-semibold">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px]" style={{ backgroundColor: tint(color, 14) }}>{icon}</span>
        <span className="truncate">{name}</span>
      </div>
      <div className="mt-2 flex h-[76px] items-center justify-center px-3" style={{ color }}>
        <CountdownNumber countdown={countdown} facts={facts} size="xl" />
      </div>
      <div className="truncate px-4 text-[12px] text-ink-3">{caption}</div>
      {hover}
    </article>
  );
}

/** The list layout's row. */
export function CountdownRow({ countdown, today, onOpen, actions, selected = false, drag }: CardProps) {
  const text = useCountdownText();
  const facts = useMemo(() => countdownFacts(countdown, today), [countdown, today]);
  const caption = useCountdownCaption(countdown, facts);
  const name = countdown.name ?? '';
  const props = interactiveProps(name, onOpen, drag);
  const repeat = countdown.repeatFlag ? text.repeat(countdown) : null;
  return (
    <div
      {...props}
      className={`group flex h-[62px] min-w-0 cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 transition-colors hover:bg-hover ${
        selected ? 'border-tt' : drag?.over ? 'border-tt/60' : 'border-line'
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[17px]" style={{ backgroundColor: tint(countdown.color, 16) }}>{countdownIcon(countdown)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[14px] font-medium">{name}</span>
          {countdown.pinned && <Pin size={12} aria-label={text.t('countdownPinned')} className="shrink-0 rotate-45 text-ink-3" fill="currentColor" />}
        </div>
        <div className="truncate text-[12px] text-ink-3">{repeat ? `${caption} · ${repeat}` : caption}</div>
      </div>
      {actions && (
        <div className="hidden shrink-0 gap-1 group-focus-within:flex group-hover:flex" onClick={(event) => event.stopPropagation()}>{actions}</div>
      )}
      <span className="shrink-0" style={{ color: countdown.color }}>
        <CountdownNumber countdown={countdown} facts={facts} size="sm" />
      </span>
    </div>
  );
}
