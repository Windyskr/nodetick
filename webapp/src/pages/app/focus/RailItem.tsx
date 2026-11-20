import { NavLink } from 'react-router-dom';
import { IconFocus } from '../../../components/tickIcons';
import { fmtClock } from '../../../lib/date';
import { displaySeconds, isBreak, progressOf } from '../../../lib/focusTimer';
import { useFocus, useNow } from '../../../stores/focus';
import { useT, useTF } from '../../../i18n';
import { BREAK_COLOR } from './ui';

const RING = 2 * Math.PI * 16;

/** "24:13" under an hour, "1h5m" past it, to fit inside the 40px rail button. */
function railClock(seconds: number, f: ReturnType<typeof useTF>): string {
  if (seconds < 3600) return fmtClock(seconds);
  return f('focusDurHM', Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60));
}

/**
 * The rail's focus entry. While a session or break runs it turns into a
 * progress ring with the time left (pomodoro) or spent (stopwatch), on
 * every page; it always leads back to the focus page.
 */
export function FocusRailItem() {
  const t = useT();
  const f = useTF();
  const timer = useFocus((state) => state.timer);
  const settings = useFocus((state) => state.settings);
  const busy = timer.status !== 'idle';
  const now = useNow(timer.status === 'running', 1000);
  const base = 'relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors';

  if (!busy) {
    return (
      <NavLink
        to="/app/focus"
        title={t('navFocus')}
        className={({ isActive }) => `${base} ${isActive ? 'text-tt' : 'text-[#8c8c8c] hover:bg-hover hover:text-ink-2'}`}
      >
        <IconFocus size={20} />
      </NavLink>
    );
  }

  const seconds = displaySeconds(timer, settings, now);
  // The stopwatch has no end: its ring fills once an hour.
  const progress = timer.plannedMs > 0 ? progressOf(timer, now) : (seconds % 3600) / 3600;
  const paused = timer.status === 'paused';
  const label = `${paused ? t('focusPaused') : isBreak(timer.phase) ? t('focusOnBreak') : t('focusRunning')} ${fmtClock(seconds)}`;
  const color = isBreak(timer.phase) ? BREAK_COLOR : 'var(--color-tt)';
  return (
    <NavLink to="/app/focus" title={label} aria-label={label} className={`${base} hover:bg-hover`}>
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true" className="absolute" style={{ opacity: paused ? 0.5 : 1 }}>
        <circle cx="19" cy="19" r="16" fill="none" strokeWidth="2.5" style={{ stroke: 'var(--color-line)' }} />
        <circle
          cx="19"
          cy="19"
          r="16"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - progress)}
          transform="rotate(-90 19 19)"
          style={{ stroke: color }}
        />
      </svg>
      <span className={`relative text-[9.5px] font-semibold tabular-nums tracking-[-0.02em] ${paused ? 'text-ink-3' : 'text-ink-2'}`}>
        {railClock(seconds, f)}
      </span>
    </NavLink>
  );
}
