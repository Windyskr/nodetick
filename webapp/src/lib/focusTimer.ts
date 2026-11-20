/**
 * Focus timer state machine (pure: every function takes `now`). The state is
 * wall-clock based (phase start, active time banked before the current run,
 * pause totals), so it survives reloads and background throttling: whoever
 * reads it later computes the same elapsed time.
 *
 * Pomodoro: focus → short break, a long break after every N pomodoros → focus.
 * Stopwatch: one focus phase that runs until it is ended. Breaks are never
 * recorded.
 */

export type FocusMode = 'pomodoro' | 'stopwatch';
export type FocusPhase = 'focus' | 'shortBreak' | 'longBreak';
export type FocusStatus = 'idle' | 'running' | 'paused';
export type NoiseKind = 'off' | 'white' | 'pink' | 'brown';

export interface FocusSettings {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** A long break follows every this many pomodoros. */
  longBreakInterval: number;
  autoStartNext: boolean;
  autoBreak: boolean;
  sound: boolean;
  browserTitle: boolean;
  noise: NoiseKind;
  /** 0-100. */
  noiseVolume: number;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartNext: false,
  autoBreak: false,
  sound: true,
  browserTitle: false,
  noise: 'off',
  noiseVolume: 40,
};

export const SETTING_LIMITS = {
  pomodoroMinutes: [1, 120],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 60],
  longBreakInterval: [1, 12],
  noiseVolume: [0, 100],
} as const;

const NOISES: NoiseKind[] = ['off', 'white', 'pink', 'brown'];

function bounded(value: unknown, fallback: number, [min, max]: readonly [number, number]): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

/** Settings from storage; unknown keys (the old "sync" switch) are dropped. */
export function parseFocusSettings(raw: unknown): FocusSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_FOCUS_SETTINGS;
  const value = raw as Record<string, unknown>;
  const d = DEFAULT_FOCUS_SETTINGS;
  return {
    pomodoroMinutes: bounded(value.pomodoroMinutes, d.pomodoroMinutes, SETTING_LIMITS.pomodoroMinutes),
    shortBreakMinutes: bounded(value.shortBreakMinutes, d.shortBreakMinutes, SETTING_LIMITS.shortBreakMinutes),
    longBreakMinutes: bounded(value.longBreakMinutes, d.longBreakMinutes, SETTING_LIMITS.longBreakMinutes),
    longBreakInterval: bounded(value.longBreakInterval, d.longBreakInterval, SETTING_LIMITS.longBreakInterval),
    autoStartNext: value.autoStartNext === true,
    autoBreak: value.autoBreak === true,
    sound: value.sound !== false,
    browserTitle: value.browserTitle === true,
    noise: NOISES.includes(value.noise as NoiseKind) ? (value.noise as NoiseKind) : d.noise,
    noiseVolume: bounded(value.noiseVolume, d.noiseVolume, SETTING_LIMITS.noiseVolume),
  };
}

export interface FocusTimer {
  mode: FocusMode;
  phase: FocusPhase;
  status: FocusStatus;
  /** When the current focus session or break began (ms); null while idle. */
  startedAt: number | null;
  /** Start of the current running stretch; null unless running. */
  runningSince: number | null;
  /** Active time banked before the running stretch (ms). */
  elapsedBefore: number;
  /** When the timer was paused; null unless paused. */
  pausedAt: number | null;
  /** Paused time banked so far (ms), not counting a pause in progress. */
  pausedTotal: number;
  /** Planned length of the running pomodoro or break (ms); 0 for the stopwatch. */
  plannedMs: number;
  /** Pomodoros completed in this cycle; drives the long break. */
  cycle: number;
  taskId: string | null;
  note: string;
}

export const IDLE_TIMER: FocusTimer = {
  mode: 'pomodoro',
  phase: 'focus',
  status: 'idle',
  startedAt: null,
  runningSince: null,
  elapsedBefore: 0,
  pausedAt: null,
  pausedTotal: 0,
  plannedMs: 0,
  cycle: 0,
  taskId: null,
  note: '',
};

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const numOrNull = (value: unknown) => value === null || num(value);

/** A timer read back from storage, or the idle timer when it is malformed. */
export function parseFocusTimer(raw: unknown): FocusTimer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return IDLE_TIMER;
  const v = raw as Record<string, unknown>;
  const valid =
    (v.mode === 'pomodoro' || v.mode === 'stopwatch') &&
    (v.phase === 'focus' || v.phase === 'shortBreak' || v.phase === 'longBreak') &&
    (v.status === 'idle' || v.status === 'running' || v.status === 'paused') &&
    numOrNull(v.startedAt) && numOrNull(v.runningSince) && numOrNull(v.pausedAt) &&
    num(v.elapsedBefore) && num(v.pausedTotal) && num(v.plannedMs) && num(v.cycle) &&
    (v.taskId === null || typeof v.taskId === 'string') && typeof v.note === 'string';
  if (!valid) return IDLE_TIMER;
  const timer = v as unknown as FocusTimer;
  // The fields each status relies on must be there.
  if (timer.status === 'running' && (timer.runningSince == null || timer.startedAt == null)) return IDLE_TIMER;
  if (timer.status === 'paused' && (timer.pausedAt == null || timer.startedAt == null)) return IDLE_TIMER;
  if (timer.phase !== 'focus' && timer.mode !== 'pomodoro') return IDLE_TIMER;
  return { ...IDLE_TIMER, ...timer };
}

/** Sessions shorter than this are discarded (the user is asked first). */
export const MIN_RECORD_MS = 5 * 60_000;
/**
 * A phase that ended longer ago than this ended while no tab was running the
 * timer (closed, or the computer asleep): the next phase waits for the user
 * instead of starting on its own.
 */
export const AUTO_START_GRACE_MS = 2 * 60_000;

/** A finished session, ready to save as a focus record. */
export interface FocusRecordDraft {
  /** Unique per session, so several tabs never save it twice. */
  key: string;
  type: 0 | 1;
  startMs: number;
  endMs: number;
  /** Focused seconds. */
  duration: number;
  /** Paused seconds. */
  pauseDuration: number;
  taskId: string | null;
  note: string;
}

export type FocusEvent =
  | { kind: 'focusDone'; at: number; record: FocusRecordDraft; next: 'shortBreak' | 'longBreak' }
  | { kind: 'breakDone'; at: number };

export const isBreak = (phase: FocusPhase) => phase !== 'focus';

export function plannedFor(phase: FocusPhase, settings: FocusSettings): number {
  const minutes = phase === 'shortBreak' ? settings.shortBreakMinutes : phase === 'longBreak' ? settings.longBreakMinutes : settings.pomodoroMinutes;
  return minutes * 60_000;
}

/** Active (unpaused) time of the current phase. */
export function elapsedMs(timer: FocusTimer, now: number): number {
  const running = timer.status === 'running' && timer.runningSince != null ? Math.max(0, now - timer.runningSince) : 0;
  return timer.elapsedBefore + running;
}

/** Paused time of the current phase, including a pause in progress. */
export function pausedMs(timer: FocusTimer, now: number): number {
  return timer.pausedTotal + (timer.status === 'paused' && timer.pausedAt != null ? Math.max(0, now - timer.pausedAt) : 0);
}

/** When the running pomodoro or break reaches zero; null for anything else. */
export function phaseEnd(timer: FocusTimer): number | null {
  if (timer.status !== 'running' || timer.plannedMs <= 0 || timer.runningSince == null) return null;
  return timer.runningSince + (timer.plannedMs - timer.elapsedBefore);
}

const timed = (timer: FocusTimer) => timer.mode === 'pomodoro' || isBreak(timer.phase);

/** What the clock face shows: time left for pomodoros and breaks, time spent for the stopwatch. */
export function displayMs(timer: FocusTimer, settings: FocusSettings, now: number): number {
  if (!timed(timer)) return timer.status === 'idle' ? 0 : elapsedMs(timer, now);
  if (timer.status === 'idle') return plannedFor(timer.phase, settings);
  return Math.max(0, timer.plannedMs - elapsedMs(timer, now));
}

/** Whole seconds for the clock: a countdown rounds up, reading 25:00 at the start and 00:00 only at the end. */
export function displaySeconds(timer: FocusTimer, settings: FocusSettings, now: number): number {
  const ms = displayMs(timer, settings, now);
  return timed(timer) ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
}

/** Share of the planned phase that has passed (0 for the stopwatch and idle timers). */
export function progressOf(timer: FocusTimer, now: number): number {
  if (timer.status === 'idle' || timer.plannedMs <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs(timer, now) / timer.plannedMs));
}

function draft(timer: FocusTimer, endMs: number, focused: number, paused: number): FocusRecordDraft {
  const type = timer.mode === 'pomodoro' ? 0 : 1;
  const startMs = timer.startedAt ?? endMs - focused - paused;
  return {
    key: `${type}:${startMs}`,
    type,
    startMs,
    endMs,
    duration: Math.round(focused / 1000),
    pauseDuration: Math.round(paused / 1000),
    taskId: timer.taskId,
    note: timer.note.trim(),
  };
}

/** Ready for the next pomodoro (or stopwatch), keeping the task and the cycle. */
function idleFocus(timer: FocusTimer, cycle: number): FocusTimer {
  return { ...IDLE_TIMER, mode: timer.mode, taskId: timer.taskId, cycle };
}

export function startFocus(
  timer: FocusTimer,
  settings: FocusSettings,
  now: number,
  options: { mode?: FocusMode; taskId?: string | null } = {},
): FocusTimer {
  const mode = options.mode ?? timer.mode;
  return {
    ...IDLE_TIMER,
    mode,
    status: 'running',
    startedAt: now,
    runningSince: now,
    plannedMs: mode === 'pomodoro' ? settings.pomodoroMinutes * 60_000 : 0,
    // Switching to the stopwatch ends the pomodoro cycle.
    cycle: mode === 'pomodoro' ? timer.cycle : 0,
    taskId: options.taskId !== undefined ? options.taskId : timer.taskId,
  };
}

/** Start the break that is waiting (after a pomodoro, without auto-start). */
export function startBreak(timer: FocusTimer, settings: FocusSettings, now: number): FocusTimer {
  if (!isBreak(timer.phase) || timer.status !== 'idle') return timer;
  return { ...timer, status: 'running', startedAt: now, runningSince: now, elapsedBefore: 0, pausedAt: null, pausedTotal: 0, plannedMs: plannedFor(timer.phase, settings) };
}

export function pause(timer: FocusTimer, now: number): FocusTimer {
  if (timer.status !== 'running') return timer;
  return { ...timer, status: 'paused', elapsedBefore: elapsedMs(timer, now), runningSince: null, pausedAt: now };
}

export function resume(timer: FocusTimer, now: number): FocusTimer {
  if (timer.status !== 'paused') return timer;
  return { ...timer, status: 'running', pausedTotal: pausedMs(timer, now), pausedAt: null, runningSince: now };
}

/** Skip the break (waiting or running): on to the next pomodoro. */
export function skipBreak(timer: FocusTimer, settings: FocusSettings, now: number): FocusTimer {
  if (!isBreak(timer.phase)) return timer;
  const next = idleFocus(timer, timer.cycle);
  return settings.autoStartNext ? startFocus(next, settings, now) : next;
}

/** Whether ending now keeps the session (otherwise the user confirms discarding it). */
export function longEnoughToSave(timer: FocusTimer, now: number): boolean {
  return timer.phase === 'focus' && timer.status !== 'idle' && elapsedMs(timer, now) >= MIN_RECORD_MS;
}

/**
 * End the session now ("End" after pausing, or stopping the stopwatch). A
 * focus session of five minutes or more becomes a record; ending early also
 * ends the pomodoro cycle. Ending a break skips it.
 */
export function finish(timer: FocusTimer, settings: FocusSettings, now: number): { timer: FocusTimer; record: FocusRecordDraft | null } {
  if (timer.status === 'idle') return { timer, record: null };
  if (isBreak(timer.phase)) return { timer: skipBreak(timer, settings, now), record: null };
  const focused = Math.min(elapsedMs(timer, now), timer.plannedMs > 0 ? timer.plannedMs : Number.POSITIVE_INFINITY);
  const record = focused >= MIN_RECORD_MS ? draft(timer, now, focused, pausedMs(timer, now)) : null;
  return { timer: idleFocus(timer, 0), record };
}

/** Throw the session away. */
export function abandon(timer: FocusTimer): FocusTimer {
  if (isBreak(timer.phase)) return idleFocus(timer, timer.cycle);
  return idleFocus(timer, 0);
}

/** Choose pomodoro or stopwatch while nothing runs; a waiting break is dropped. */
export function setMode(timer: FocusTimer, mode: FocusMode): FocusTimer {
  if (timer.status !== 'idle' || (timer.mode === mode && !isBreak(timer.phase))) return timer;
  return { ...IDLE_TIMER, mode, taskId: timer.taskId, cycle: mode === 'pomodoro' && !isBreak(timer.phase) ? timer.cycle : 0 };
}

/**
 * Complete every phase that has run out by `now`: a finished pomodoro yields
 * a record and a break, a finished break the next pomodoro. Each phase
 * starts when the previous one ended, so the timeline stays exact however
 * late this runs; auto-start only applies to phases that ended within
 * AUTO_START_GRACE_MS.
 */
export function advance(timer: FocusTimer, settings: FocusSettings, now: number): { timer: FocusTimer; events: FocusEvent[] } {
  const events: FocusEvent[] = [];
  let current = timer;
  for (let guard = 0; guard < 8; guard++) {
    const end = phaseEnd(current);
    if (end == null || end > now) break;
    const recent = now - end < AUTO_START_GRACE_MS;
    if (current.phase === 'focus') {
      const cycle = current.cycle + 1;
      const next = cycle % settings.longBreakInterval === 0 ? 'longBreak' : 'shortBreak';
      events.push({ kind: 'focusDone', at: end, record: draft(current, end, current.plannedMs, current.pausedTotal), next });
      const waiting: FocusTimer = { ...IDLE_TIMER, mode: 'pomodoro', phase: next, taskId: current.taskId, cycle };
      current = settings.autoBreak && recent ? startBreak(waiting, settings, end) : waiting;
    } else {
      events.push({ kind: 'breakDone', at: end });
      const waiting = idleFocus(current, current.cycle);
      current = settings.autoStartNext && recent ? startFocus(waiting, settings, end) : waiting;
    }
  }
  return { timer: current, events };
}

/** Local ISO time with offset, the format the Open API stores ("2026-04-07T09:00:00+0800"). */
export function isoWithOffset(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`;
}

/** The POST /focus body for a finished session. */
export function recordPayload(record: FocusRecordDraft, withTask = true): Record<string, unknown> {
  return {
    type: record.type,
    startTime: isoWithOffset(record.startMs),
    endTime: isoWithOffset(record.endMs),
    duration: record.duration,
    pauseDuration: record.pauseDuration,
    ...(withTask && record.taskId ? { taskId: record.taskId } : {}),
    ...(record.note ? { note: record.note } : {}),
  };
}
