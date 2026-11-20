import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Countdown } from '../../lib/types';
import { occurrencesBetween } from '../../lib/countdown';
import { useStore } from '../../stores/store';
import { useCountdowns } from '../../stores/countdowns';
import { countdownIcon, useCountdownText } from './countdownText';

/**
 * Countdown occurrences per day in [start, end], for the calendar's read-only
 * all-day chips: active countdowns with "Show in calendar" on, while the
 * countdown feature is enabled.
 */
export function useCalendarCountdowns(start: string, end: string): Map<string, Countdown[]> {
  const enabled = useStore((state) => state.features.countdown);
  const { items, loaded, load } = useCountdowns();
  useEffect(() => {
    if (enabled && !loaded) void load();
  }, [enabled, loaded, load]);
  return useMemo(() => {
    const byDay = new Map<string, Countdown[]>();
    if (!enabled) return byDay;
    for (const countdown of items) {
      if (countdown.archived || !countdown.showInCalendar) continue;
      for (const day of occurrencesBetween(countdown, start, end)) byDay.set(day, [...(byDay.get(day) ?? []), countdown]);
    }
    return byDay;
  }, [enabled, items, start, end]);
}

/** A countdown on a calendar day; opens it on the countdown page. */
export function CountdownChip({ countdown }: { countdown: Countdown }) {
  const navigate = useNavigate();
  const { f } = useCountdownText();
  const name = countdown.name ?? '';
  return (
    <button
      type="button"
      title={f('countdownChip', name)}
      aria-label={f('countdownChip', name)}
      onClick={() => navigate(`/app/countdown?countdown=${encodeURIComponent(countdown.id)}`)}
      className="flex w-full min-w-0 items-center gap-1 rounded px-1 py-[2px] text-left text-[11.5px] text-ink hover:brightness-95"
      style={{ backgroundColor: `color-mix(in srgb, ${countdown.color} 16%, transparent)`, borderLeft: `2px solid ${countdown.color}` }}
    >
      <span className="shrink-0 text-[11px] leading-none">{countdownIcon(countdown)}</span>
      <span className="min-w-0 truncate">{name}</span>
    </button>
  );
}
