import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { useI18n, useT, useTF, type Lang } from '../../../i18n';
import { useEscape } from '../../../lib/useEscape';
import type { Period } from '../../../lib/focusPeriods';

/** Shared pieces of the focus page, its dialogs and charts. */

/** Breaks wear a calm green instead of the theme color. */
export const BREAK_COLOR = '#1baf7a';

export function ModalShell({
  title,
  onClose,
  children,
  className = 'w-[440px]',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[88vh] max-w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-[0_10px_36px_rgba(0,0,0,0.18)] ${className}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center">
          <h2 className="text-[18px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} title={t('close')} aria-label={t('close')} className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The pomodoro mark: a tomato (drawn, since emoji fonts are not a given). */
export function PomoIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className={`inline-block shrink-0 ${className}`}>
      <circle cx="8" cy="9.2" r="6" fill="#f0604d" />
      <path d="M8 3.6c-.9-1-2.3-1.2-3.4-.8.7.3 1.3.8 1.6 1.4-.9 0-1.8.3-2.4.9 1.2.1 2.4.4 3.3 1L8 4.9l.9 1.2c.9-.6 2.1-.9 3.3-1-.6-.6-1.5-.9-2.4-.9.3-.6.9-1.1 1.6-1.4-1.1-.4-2.5-.2-3.4.8Z" fill="#3fa34d" />
      <ellipse cx="5.6" cy="8.4" rx="1.1" ry="1.7" fill="#fff" opacity="0.28" />
    </svg>
  );
}

/** "1h20m" / "25m" for tiles and charts (TickTick writes these the same in both languages). */
export function useCompactDuration() {
  const f = useTF();
  return (seconds: number) => {
    const safe = Math.max(0, Math.round(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours > 0) return minutes > 0 ? f('focusDurHM', hours, minutes) : f('focusDurH', hours);
    return f('focusDurM', minutes);
  };
}

/** "1小时20分" / "1h 20m" for prose. */
export function useLongDuration() {
  const f = useTF();
  return (seconds: number) => {
    const safe = Math.max(0, Math.round(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours > 0) return minutes > 0 ? f('hoursMinutes', hours, minutes) : f('focusHoursLong', hours);
    return f('minutes', minutes);
  };
}

const locale = (lang: Lang) => (lang === 'zh' ? 'zh-CN' : 'en-US');
/** Local noon of a day, safe from DST edges. */
export const dayDate = (day: string) => new Date(`${day}T12:00:00`);

/** "11月20日 周五" / "Fri, Nov 20" (with the year when it is not this year). */
export function dayLabel(day: string, lang: Lang, options: { weekday?: boolean } = {}): string {
  const sameYear = day.slice(0, 4) === String(new Date().getFullYear());
  return new Intl.DateTimeFormat(locale(lang), {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    ...(options.weekday === false ? {} : { weekday: 'short' }),
  }).format(dayDate(day));
}

export function monthLabel(month: string, lang: Lang, style: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(locale(lang), { month: style }).format(dayDate(`${month}-01`));
}

export function weekdayLabel(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { weekday: 'short' }).format(dayDate(day));
}

/** Title of a stats period: a day, a week range, a month or a year. */
export function periodLabel(period: Period, lang: Lang): string {
  const loc = locale(lang);
  if (period.kind === 'day') return dayLabel(period.from, lang);
  if (period.kind === 'month') return new Intl.DateTimeFormat(loc, { year: 'numeric', month: 'long' }).format(dayDate(period.from));
  if (period.kind === 'year') return new Intl.DateTimeFormat(loc, { year: 'numeric' }).format(dayDate(period.from));
  // Intl's zh ranges come out numeric ("11/15 – 11/21"); two day labels read better.
  return `${dayLabel(period.from, lang, { weekday: false })} – ${dayLabel(period.to, lang, { weekday: false })}`;
}

export function useLang(): Lang {
  return useI18n((state) => state.lang);
}

/** The browser's IANA time zone, as the stats API wants it. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Width of an element, kept current with a ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth);
  }, [ref]);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function StatTile({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-[73px] flex-col justify-center rounded-xl bg-[#fafafa] px-4 py-3">
      <div className="truncate text-[12px] text-ink-3">{label}</div>
      <div className="mt-1 text-[23px] font-medium leading-none text-ink">{value}</div>
      {children}
    </div>
  );
}
