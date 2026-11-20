import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { ApiError, api } from '../lib/api';
import { fmtClock } from '../lib/date';
import { chimeNow, scheduleChime, setNoise, unlockAudio } from '../lib/focusAudio';
import {
  abandon as abandonTimer,
  advance as advanceTimer,
  DEFAULT_FOCUS_SETTINGS,
  displaySeconds,
  finish as finishTimer,
  type FocusEvent,
  type FocusMode,
  type FocusRecordDraft,
  type FocusSettings,
  type FocusTimer,
  IDLE_TIMER,
  isBreak,
  parseFocusSettings,
  parseFocusTimer,
  pause as pauseTimer,
  phaseEnd,
  recordPayload,
  resume as resumeTimer,
  setMode as setTimerMode,
  skipBreak as skipTimerBreak,
  startBreak as startTimerBreak,
  startFocus,
} from '../lib/focusTimer';
import { tfOf, tOf } from '../i18n';

/**
 * The focus timer, global to the app: it keeps running on every page,
 * survives reloads (localStorage) and is shared by open tabs (storage
 * events). One tab at a time — the visible one when there is one — runs the
 * engine that completes phases, rings and saves records (Web Locks), so a
 * session is never saved twice.
 */

const TIMER_KEY = 'ntk_focus_timer';
const SETTINGS_KEY = 'ntk_focus_settings';
/** Finished sessions not yet confirmed by the server. */
const PENDING_KEY = 'ntk_focus_pending';
/** Keys of recently saved sessions. */
const SAVED_KEY = 'ntk_focus_saved';
/** Touched whenever records change, so other tabs reload theirs. */
const RECORDS_KEY = 'ntk_focus_records';
/** The account the stored session and unsaved records belong to. */
const OWNER_KEY = 'ntk_focus_owner';

function read<T>(key: string, parse: (raw: unknown) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled or full: this tab keeps working from memory.
  }
}

function isDraft(value: unknown): value is FocusRecordDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.key === 'string' && (v.type === 0 || v.type === 1) &&
    [v.startMs, v.endMs, v.duration, v.pauseDuration].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (v.taskId === null || typeof v.taskId === 'string') && typeof v.note === 'string';
}

const parsePending = (raw: unknown): FocusRecordDraft[] => (Array.isArray(raw) ? raw.filter(isDraft).slice(-50) : []);
const parseSaved = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string').slice(-100) : []);

/** Web Locks where available; otherwise run directly (every tab then acts alone). */
async function withLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, run);
  return run();
}

/** Save one session; a task deleted meanwhile is dropped from the record instead of failing it. */
async function saveRecord(record: FocusRecordDraft): Promise<void> {
  try {
    await api.addFocus(recordPayload(record));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && record.taskId) {
      await api.addFocus(recordPayload(record, false));
      return;
    }
    throw error;
  }
}

/** The server refused the record itself; retrying would not help. */
const rejected = (error: unknown) => error instanceof ApiError && [400, 404, 413].includes(error.status);

let flushing = false;

interface FocusState {
  timer: FocusTimer;
  settings: FocusSettings;
  /** Sessions waiting to be saved (retried by the engine). */
  pending: FocusRecordDraft[];
  saveFailed: boolean;
  /** Bumped when records change here or in another tab; pages reload on it. */
  recordsVersion: number;

  start: (options?: { mode?: FocusMode; taskId?: string | null }) => void;
  /** "Start focus" on a task: link it to the running session, or start one. */
  startForTask: (taskId: string) => void;
  pause: () => void;
  resume: () => void;
  /** End the session, saving it when it lasted five minutes or more. */
  finish: () => void;
  abandon: () => void;
  startBreak: () => void;
  skipBreak: () => void;
  setMode: (mode: FocusMode) => void;
  setTask: (taskId: string | null) => void;
  setNote: (note: string) => void;
  updateSettings: (settings: FocusSettings) => void;
  /** Complete the phases that ran out (engine only); returns what happened. */
  advance: (now?: number) => FocusEvent[];
  flush: () => Promise<void>;
  /** A record was added, edited or deleted from the UI. */
  recordsChanged: () => void;
  /** Adopt what another tab wrote to `key` (null: everything). */
  syncFromStorage: (key: string | null) => void;
  /** The signed-in account; another account's session and unsaved records are dropped. */
  setOwner: (userId: string) => void;
}

export const useFocus = create<FocusState>((set, get) => {
  const commit = (timer: FocusTimer) => {
    set({ timer });
    write(TIMER_KEY, timer);
  };
  const queue = (records: FocusRecordDraft[]) => {
    // Merge with storage: another tab may have queued or saved meanwhile.
    const saved = read(SAVED_KEY, parseSaved, []);
    const pending = read(PENDING_KEY, parsePending, []);
    for (const record of records) {
      if (!saved.includes(record.key) && !pending.some((p) => p.key === record.key)) pending.push(record);
    }
    write(PENDING_KEY, pending);
    set({ pending });
  };
  const bump = () => {
    write(RECORDS_KEY, Date.now());
    set((state) => ({ recordsVersion: state.recordsVersion + 1 }));
  };

  return {
    timer: read(TIMER_KEY, parseFocusTimer, IDLE_TIMER),
    settings: read(SETTINGS_KEY, parseFocusSettings, DEFAULT_FOCUS_SETTINGS),
    pending: read(PENDING_KEY, parsePending, []),
    saveFailed: false,
    recordsVersion: 0,

    start: (options) => {
      const { timer } = get();
      // A second click (or a second tab) must not restart a running session.
      if (timer.phase === 'focus' && timer.status !== 'idle') return;
      unlockAudio();
      commit(startFocus(timer, get().settings, Date.now(), options));
    },
    startForTask: (taskId) => {
      const { timer } = get();
      if (timer.phase === 'focus' && timer.status !== 'idle') commit({ ...timer, taskId });
      else get().start({ taskId });
    },
    pause: () => commit(pauseTimer(get().timer, Date.now())),
    resume: () => {
      unlockAudio();
      commit(resumeTimer(get().timer, Date.now()));
    },
    finish: () => {
      const { timer, record } = finishTimer(get().timer, get().settings, Date.now());
      commit(timer);
      if (record) {
        queue([record]);
        void get().flush();
      }
    },
    abandon: () => commit(abandonTimer(get().timer)),
    startBreak: () => {
      unlockAudio();
      commit(startTimerBreak(get().timer, get().settings, Date.now()));
    },
    skipBreak: () => {
      unlockAudio();
      commit(skipTimerBreak(get().timer, get().settings, Date.now()));
    },
    setMode: (mode) => commit(setTimerMode(get().timer, mode)),
    setTask: (taskId) => commit({ ...get().timer, taskId }),
    setNote: (note) => commit({ ...get().timer, note }),
    updateSettings: (settings) => {
      set({ settings });
      write(SETTINGS_KEY, settings);
    },

    advance: (now = Date.now()) => {
      const { timer, events } = advanceTimer(get().timer, get().settings, now);
      if (!events.length) return events;
      commit(timer);
      const records = events.flatMap((event) => (event.kind === 'focusDone' ? [event.record] : []));
      if (records.length) queue(records);
      return events;
    },

    flush: async () => {
      if (flushing || !read(PENDING_KEY, parsePending, []).length) return;
      flushing = true;
      try {
        await withLock('ntk-focus-save', async () => {
          let pending = read(PENDING_KEY, parsePending, []);
          const saved = read(SAVED_KEY, parseSaved, []);
          let failed = false;
          let changed = false;
          for (const record of [...pending]) {
            if (!saved.includes(record.key)) {
              try {
                await saveRecord(record);
                saved.push(record.key);
                changed = true;
              } catch (error) {
                if (!rejected(error)) {
                  failed = true;
                  break;
                }
              }
            }
            pending = pending.filter((p) => p.key !== record.key);
            write(SAVED_KEY, saved.slice(-100));
            write(PENDING_KEY, pending);
          }
          set({ pending, saveFailed: failed });
          if (changed) bump();
        });
      } finally {
        flushing = false;
      }
    },

    recordsChanged: bump,

    syncFromStorage: (key) => {
      if (key === null || key === TIMER_KEY) set({ timer: read(TIMER_KEY, parseFocusTimer, IDLE_TIMER) });
      if (key === null || key === SETTINGS_KEY) set({ settings: read(SETTINGS_KEY, parseFocusSettings, DEFAULT_FOCUS_SETTINGS) });
      if (key === null || key === PENDING_KEY) set({ pending: read(PENDING_KEY, parsePending, []) });
      if (key === null || key === RECORDS_KEY || key === SAVED_KEY) set((state) => ({ recordsVersion: state.recordsVersion + 1 }));
    },

    setOwner: (userId) => {
      const owner = read(OWNER_KEY, (raw) => (typeof raw === 'string' ? raw : null), null);
      if (owner === userId) return;
      if (owner) {
        commit(IDLE_TIMER);
        write(PENDING_KEY, []);
        write(SAVED_KEY, []);
        set({ pending: [], saveFailed: false });
      }
      write(OWNER_KEY, userId);
    },
  };
});

/** Re-render every `interval` ms while `active`; returns the time of this render. */
export function useNow(active: boolean, interval = 1000): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setTick((n) => n + 1), interval);
    return () => window.clearInterval(id);
  }, [active, interval]);
  return Date.now();
}

const BASE_TITLE = 'NodeTick: To-Do List & Tasks';

function phaseLabel(timer: FocusTimer): string {
  if (timer.status === 'paused') return tOf('focusPaused');
  return isBreak(timer.phase) ? tOf('focusOnBreak') : tOf('focusRunning');
}

function notifyPhase(event: FocusEvent, settings: FocusSettings, open: () => void): void {
  if (typeof document === 'undefined' || !document.hidden) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const title = event.kind === 'focusDone' ? tOf('focusDoneTitle') : tOf('focusBreakDoneTitle');
  const body = event.kind === 'focusDone'
    ? tfOf('focusDoneBody', event.next === 'longBreak' ? settings.longBreakMinutes : settings.shortBreakMinutes)
    : tOf('focusBreakDoneBody');
  const options: NotificationOptions = { body, tag: 'ntk-focus', icon: '/favicon.svg', silent: !settings.sound };
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      open();
      notification.close();
    };
  } catch {
    // Android Chrome only shows notifications through the service worker.
    void navigator.serviceWorker?.getRegistration('/')
      .then((registration) => registration?.showNotification(title, { ...options, data: { url: '/app/focus' } }))
      .catch(() => undefined);
  }
}

/**
 * Runs the timer for the whole app (mounted once, by the icon rail): ticks
 * every second, keeps the tab title, and — in the leading tab — completes
 * phases, rings, notifies and saves.
 */
export function useFocusEngine(userId: string | undefined, open: () => void): void {
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!userId) return undefined;
    useFocus.getState().setOwner(userId);
    let disposed = false;
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    let leader = !locks;
    let queued: AbortController | null = null;
    let titled = false;

    const syncAudio = () => {
      const { timer, settings } = useFocus.getState();
      const end = leader && settings.sound ? phaseEnd(timer) : null;
      scheduleChime(end, timer.phase === 'focus' ? 'focus' : 'break');
      const focusing = leader && timer.phase === 'focus' && timer.status === 'running';
      setNoise(focusing ? settings.noise : 'off', settings.noiseVolume);
    };

    const updateTitle = () => {
      const { timer, settings } = useFocus.getState();
      if (!settings.browserTitle || timer.status === 'idle') {
        if (titled) document.title = BASE_TITLE;
        titled = false;
        return;
      }
      document.title = `${fmtClock(displaySeconds(timer, settings, Date.now()))} · ${phaseLabel(timer)}`;
      titled = true;
    };

    const tick = () => {
      if (leader) {
        const events = useFocus.getState().advance();
        if (events.length) {
          const last = events[events.length - 1];
          const { settings } = useFocus.getState();
          // Phases that ended long ago (the tab was closed) pass silently.
          if (Date.now() - last.at < 60_000) {
            if (settings.sound) chimeNow(last.at, last.kind === 'focusDone' ? 'focus' : 'break');
            notifyPhase(last, settings, () => openRef.current());
          }
          void useFocus.getState().flush();
        }
      }
      updateTitle();
    };

    const lead = () => {
      leader = true;
      tick();
      syncAudio();
      void useFocus.getState().flush();
    };

    const claim = (steal: boolean) => {
      if (!locks || leader || disposed) return;
      queued?.abort();
      const controller = new AbortController();
      queued = controller;
      // A visible tab takes over at once; hidden ones wait their turn.
      const options: LockOptions = steal ? { steal: true } : { signal: controller.signal };
      locks.request('ntk-focus-engine', options, () => new Promise<void>((release) => {
        if (disposed) {
          release();
          return;
        }
        queued = null;
        lead();
        stop = () => {
          leader = false;
          release();
        };
      })).catch(() => {
        // Aborted in the queue, or another tab stole the lock.
        const stolen = !controller.signal.aborted;
        leader = false;
        stop = null;
        syncAudio();
        if (stolen && !disposed) claim(false);
      });
    };
    let stop: (() => void) | null = null;

    const onVisibility = () => {
      if (document.visibilityState === 'visible') claim(true);
      tick();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      useFocus.getState().syncFromStorage(event.key);
    };
    const onGesture = () => {
      // A reload leaves audio locked until the next click; unlock it then.
      const { timer } = useFocus.getState();
      if (timer.status !== 'idle' || isBreak(timer.phase)) {
        unlockAudio();
        window.setTimeout(syncAudio, 50);
      }
    };
    const onOnline = () => {
      if (leader) void useFocus.getState().flush();
    };

    claim(document.visibilityState === 'visible');
    if (leader) lead();
    const interval = window.setInterval(tick, 1000);
    // Retry unsaved sessions every half minute.
    const retry = window.setInterval(() => {
      if (leader && useFocus.getState().pending.length) void useFocus.getState().flush();
    }, 30_000);
    const unsubscribe = useFocus.subscribe((state, previous) => {
      if (state.timer !== previous.timer || state.settings !== previous.settings) {
        syncAudio();
        updateTitle();
      }
    });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    window.addEventListener('online', onOnline);
    return () => {
      disposed = true;
      queued?.abort();
      stop?.();
      leader = false;
      syncAudio();
      if (titled) document.title = BASE_TITLE;
      window.clearInterval(interval);
      window.clearInterval(retry);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      window.removeEventListener('online', onOnline);
    };
  }, [userId]);
}
