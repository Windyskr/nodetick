import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Check,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Timer,
  X,
} from 'lucide-react';
import { Popover } from '../../components/Popover';
import { api } from '../../lib/api';
import type { Focus, Task } from '../../lib/types';
import { fmtClock, lastNDays, localDayClock, parseInstant, shortDate, todayStr, weekdayShort } from '../../lib/date';
import { useI18n, useT } from '../../i18n';

type FocusMode = 'pomodoro' | 'stopwatch';
type SessionState = 'idle' | 'running' | 'paused';

interface FocusSettings {
  pomodoroMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartNext: boolean;
  autoBreak: boolean;
  sound: boolean;
  sync: boolean;
  browserTitle: boolean;
}

interface FocusPreset {
  id: string;
  name: string;
  mode: FocusMode;
  minutes: number;
}

const SETTINGS_KEY = 'ntk_focus_settings';
const PRESETS_KEY = 'ntk_focus_presets';
const MIN_RECORDED_FOCUS_SECONDS = 5 * 60;
const FOCUS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * 196;
const DEFAULT_SETTINGS: FocusSettings = {
  pomodoroMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartNext: false,
  autoBreak: false,
  sound: true,
  sync: false,
  browserTitle: false,
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function readSettings(): FocusSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SETTINGS;
    const value = raw as Record<string, unknown>;
    return {
      pomodoroMinutes: boundedNumber(value.pomodoroMinutes, DEFAULT_SETTINGS.pomodoroMinutes, 1, 120),
      shortBreakMinutes: boundedNumber(value.shortBreakMinutes, DEFAULT_SETTINGS.shortBreakMinutes, 1, 60),
      longBreakMinutes: boundedNumber(value.longBreakMinutes, DEFAULT_SETTINGS.longBreakMinutes, 1, 60),
      longBreakInterval: boundedNumber(value.longBreakInterval, DEFAULT_SETTINGS.longBreakInterval, 1, 12),
      autoStartNext: value.autoStartNext === true,
      autoBreak: value.autoBreak === true,
      sound: value.sound !== false,
      sync: value.sync === true,
      browserTitle: value.browserTitle === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readPresets(): FocusPreset[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? 'null');
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is FocusPreset => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const value = item as Record<string, unknown>;
      return (
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        value.name.trim().length > 0 &&
        (value.mode === 'pomodoro' || value.mode === 'stopwatch') &&
        typeof value.minutes === 'number' &&
        Number.isFinite(value.minutes) &&
        value.minutes >= 0 &&
        value.minutes <= 120
      );
    });
  } catch {
    return [];
  }
}

function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The current tab still works when storage is disabled or full.
  }
}

function isoWithOffset(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`;
}

// Focus times are real instants (the CLI and TickTick write UTC), so group
// and label them in the browser's time zone instead of reading the digits.
function recordDay(record: Focus): string | null {
  return localDayClock(record.startTime)?.day ?? null;
}

function recordClock(value: string | null): string {
  return localDayClock(value)?.clock ?? '';
}

const newestFirst = (a: Focus, b: Focus) => (parseInstant(b.startTime) ?? 0) - (parseInstant(a.startTime) ?? 0);

function compactDuration(seconds: number, _lang: 'en' | 'zh'): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h${minutes > 0 ? `${minutes}m` : ''}`;
  return `${minutes}m`;
}

function TimerDial({ mode, elapsed, totalSeconds, active }: { mode: FocusMode; elapsed: number; totalSeconds: number; active: boolean }) {
  if (mode === 'stopwatch') {
    const activeTicks = active ? Math.min(60, Math.floor(Math.max(0, elapsed)) + 1) : 0;
    return (
      <svg
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[104.44%] w-[104.44%] -translate-x-1/2 -translate-y-1/2"
        viewBox="0 0 376 376"
      >
        {Array.from({ length: 60 }, (_, index) => {
          const angle = index * 6;
          return (
            <line
              key={index}
              x1="188"
              y1="4"
              x2="188"
              y2="22"
              style={index < activeTicks ? { stroke: 'var(--color-tt)' } : { stroke: 'var(--color-ink)', strokeOpacity: 0.1 }}
              strokeWidth="2.5"
              transform={`rotate(${angle} 188 188)`}
            />
          );
        })}
      </svg>
    );
  }

  const progress = totalSeconds > 0 ? Math.min(1, Math.max(0, elapsed / totalSeconds)) : 0;
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 400 400"
    >
      <circle style={{ stroke: 'var(--color-ink)', strokeOpacity: 0.1 }} cx="200" cy="200" r="196" strokeWidth="8" fill="none" />
      <circle
        style={{ stroke: 'var(--color-tt)' }}
        transform="rotate(-90 200 200)"
        cx="200"
        cy="200"
        r="196"
        strokeDasharray={TIMER_RING_CIRCUMFERENCE}
        strokeDashoffset={TIMER_RING_CIRCUMFERENCE * (1 - progress)}
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function TimerFace({ mode, elapsed, totalSeconds, displaySeconds, active }: { mode: FocusMode; elapsed: number; totalSeconds: number; displaySeconds: number; active: boolean }) {
  return (
    <div className="relative mt-[clamp(16px,8vh,88px)] mb-[clamp(16px,9vh,100px)] h-[min(360px,42vh)] w-[min(360px,42vh)] shrink-0">
      <TimerDial mode={mode} elapsed={elapsed} totalSeconds={totalSeconds} active={active} />
      <div className="absolute left-1/2 top-1/2 z-[4] -translate-x-1/2 -translate-y-1/2 text-[54px] font-normal leading-[65px] tabular-nums tracking-[-0.02em] text-ink">
        {fmtClock(displaySeconds)}
      </div>
    </div>
  );
}

export default function FocusPage() {
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [records, setRecords] = useState<Focus[]>([]);
  const [taskId, setTaskId] = useState('');
  const [mode, setMode] = useState<FocusMode>('pomodoro');
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState('');
  const [settings, setSettings] = useState<FocusSettings>(readSettings);
  const [presets, setPresets] = useState<FocusPreset[]>(readPresets);
  const [presetOpen, setPresetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [showSessionDetails, setShowSessionDetails] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const activeTaskIdRef = useRef('');
  const activeModeRef = useRef<FocusMode>('pomodoro');
  const noteRef = useRef('');
  const savingRef = useRef(false);

  const pomodoroSeconds = settings.pomodoroMinutes * 60;
  const active = sessionState !== 'idle';
  const selectableTasks = tasks.filter((task) => task.status === 0);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const selectedTask = taskById.get(taskId);
  const handleTaskChange = (id: string) => {
    setTaskId(id);
    if (active) activeTaskIdRef.current = id;
  };

  const loadRecords = async () => {
    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 29);
    const to = new Date(now);
    to.setHours(23, 59, 59, 0);
    // The API rejects windows longer than 30 × 24 h. Thirty local days are an
    // hour longer when they span a DST change, which used to empty the page.
    from.setTime(Math.max(from.getTime(), to.getTime() - FOCUS_WINDOW_MS));
    try {
      const [pomodoros, stopwatch] = await Promise.all([
        api.listFocus(isoWithOffset(from), isoWithOffset(to), 0),
        api.listFocus(isoWithOffset(from), isoWithOffset(to), 1),
      ]);
      setRecords([...pomodoros, ...stopwatch].sort(newestFirst));
    } catch {
      // The empty state remains useful if the history endpoint is unavailable.
    }
  };

  useEffect(() => {
    api.filterTasks({ status: [0, 2] }).then(setTasks).catch(() => undefined);
    void loadRecords();
  }, []);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => stopTimer(), []);

  const currentElapsed = () => {
    const startedAt = startedAtRef.current;
    const live = startedAt == null ? 0 : Math.floor((Date.now() - startedAt) / 1000);
    return accumulatedRef.current + Math.max(0, live);
  };

  const resetSession = () => {
    stopTimer();
    startedAtRef.current = null;
    sessionStartRef.current = null;
    accumulatedRef.current = 0;
    activeTaskIdRef.current = '';
    setElapsed(0);
    setSessionState('idle');
    setNote('');
    noteRef.current = '';
    setShowSessionDetails(true);
  };

  const saveSession = async (seconds: number, endMs: number) => {
    if (seconds < MIN_RECORDED_FOCUS_SECONDS) return;
    const startMs = sessionStartRef.current ?? endMs - seconds * 1000;
    const noteValue = noteRef.current.trim();
    await api.addFocus({
      type: activeModeRef.current === 'pomodoro' ? 0 : 1,
      startTime: isoWithOffset(new Date(startMs)),
      endTime: isoWithOffset(new Date(endMs)),
      duration: seconds,
      ...(activeTaskIdRef.current ? { taskId: activeTaskIdRef.current } : {}),
      ...(noteValue ? { note: noteValue } : {}),
    });
    await loadRecords();
  };

  const beginFreshSession = () => {
    const now = Date.now();
    accumulatedRef.current = 0;
    startedAtRef.current = now;
    sessionStartRef.current = now;
    activeTaskIdRef.current = taskId;
    activeModeRef.current = mode;
    noteRef.current = note;
    setElapsed(0);
    setError(null);
    setShowSessionDetails(true);
    setSessionState('running');
  };

  const endSession = async (completed = false) => {
    if (sessionState === 'idle' || savingRef.current) return;
    savingRef.current = true;
    stopTimer();
    const endMs = Date.now();
    const rawSeconds = currentElapsed();
    const seconds = mode === 'pomodoro' ? Math.min(rawSeconds, pomodoroSeconds) : rawSeconds;
    const restart = completed && settings.autoStartNext;
    accumulatedRef.current = seconds;
    startedAtRef.current = null;
    setElapsed(seconds);
    setSessionState('idle');
    setSaving(true);
    try {
      await saveSession(seconds, endMs);
    } catch {
      setError(t('focusSaveError'));
    } finally {
      savingRef.current = false;
      setSaving(false);
      resetSession();
      if (restart) window.setTimeout(beginFreshSession, 0);
    }
  };

  const requestEndSession = () => {
    if (sessionState === 'idle' || savingRef.current) return;
    if (currentElapsed() < MIN_RECORDED_FOCUS_SECONDS) {
      setEndConfirmOpen(true);
      return;
    }
    void endSession();
  };

  useEffect(() => {
    if (sessionState !== 'running') return undefined;
    const tick = () => {
      const next = currentElapsed();
      if (mode === 'pomodoro' && next >= pomodoroSeconds) {
        setElapsed(pomodoroSeconds);
        void endSession(true);
        return;
      }
      setElapsed(next);
    };
    tick();
    timerRef.current = setInterval(tick, 250);
    return stopTimer;
  }, [sessionState, mode, pomodoroSeconds]);

  useEffect(() => {
    if (sessionState === 'idle') setElapsed(0);
  }, [mode, settings.pomodoroMinutes, sessionState]);

  const focusTitle = t('focusTitle');
  useEffect(() => {
    const defaultTitle = 'NodeTick: To-Do List & Tasks';
    if (!settings.browserTitle) {
      document.title = defaultTitle;
      return undefined;
    }
    const clock = mode === 'pomodoro' ? fmtClock(Math.max(0, pomodoroSeconds - elapsed)) : fmtClock(elapsed);
    document.title = `${clock} · ${focusTitle}`;
    return () => {
      document.title = defaultTitle;
    };
  }, [elapsed, focusTitle, mode, pomodoroSeconds, settings.browserTitle]);

  const pauseSession = () => {
    if (sessionState !== 'running') return;
    const next = currentElapsed();
    accumulatedRef.current = next;
    startedAtRef.current = null;
    setElapsed(next);
    stopTimer();
    setSessionState('paused');
  };

  const resumeSession = () => {
    if (sessionState !== 'paused') return;
    startedAtRef.current = Date.now();
    setSessionState('running');
  };

  const updateSettings = (next: FocusSettings) => {
    setSettings(next);
    persist(SETTINGS_KEY, next);
    if (sessionState === 'idle') setElapsed(0);
  };

  const savePreset = (input: Omit<FocusPreset, 'id'>) => {
    const preset: FocusPreset = {
      ...input,
      id: `focus-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    const next = [...presets, preset];
    setPresets(next);
    persist(PRESETS_KEY, next);
    setPresetOpen(false);
    setNotice(t('focusPresetSaved'));
    window.setTimeout(() => setNotice(null), 2400);
  };

  const usePreset = (preset: FocusPreset, close: () => void) => {
    setMode(preset.mode);
    if (preset.mode === 'pomodoro' && preset.minutes !== settings.pomodoroMinutes) {
      updateSettings({ ...settings, pomodoroMinutes: preset.minutes });
    }
    close();
  };

  const displaySeconds = mode === 'pomodoro' ? Math.max(0, pomodoroSeconds - elapsed) : elapsed;
  const stats = useMemo(() => {
    const today = todayStr();
    const durationFor = (items: Focus[]) => items.reduce((total, record) => total + Math.max(0, record.duration ?? 0), 0);
    const pomodoros = records.filter((record) => record.type === 0);
    const todayRecords = records.filter((record) => recordDay(record) === today);
    const days = lastNDays(7).map((day) => [day, durationFor(records.filter((record) => recordDay(record) === day))] as const);
    return {
      todayTomatoes: pomodoros.filter((record) => recordDay(record) === today).length,
      todaySeconds: durationFor(todayRecords),
      totalTomatoes: pomodoros.length,
      totalSeconds: durationFor(records),
      days,
      maxDaySeconds: Math.max(60, ...days.map(([, seconds]) => seconds)),
    };
  }, [records]);

  const recordGroups = useMemo(() => {
    const groups = new Map<string, Focus[]>();
    for (const record of records) {
      const day = recordDay(record);
      if (!day) continue;
      const list = groups.get(day) ?? [];
      list.push(record);
      groups.set(day, list);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [records]);

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden bg-white">
      <section className="flex h-full w-3/5 min-w-[620px] shrink-0 flex-col border-r border-line">
        <header className="relative flex h-16 shrink-0 items-center border-b border-line px-[26px]">
          <h1 className="text-[20px] font-bold">{t('focusTitle')}</h1>
          {!active && (
            <div className="absolute left-1/2 flex -translate-x-1/2 items-center text-[13px] text-ink-2">
              <button
                type="button"
                aria-pressed={mode === 'pomodoro'}
                onClick={() => { setMode('pomodoro'); setElapsed(0); }}
                className={`px-[22px] py-1.5 transition-colors ${mode === 'pomodoro' ? 'font-medium text-ink' : 'hover:text-ink'}`}
              >
                {t('focusPomodoro')}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'stopwatch'}
                onClick={() => { setMode('stopwatch'); setElapsed(0); }}
                className={`px-[22px] py-1.5 transition-colors ${mode === 'stopwatch' ? 'font-medium text-ink' : 'hover:text-ink'}`}
              >
                {t('focusStopwatch')}
              </button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            {!active && (
              <button
                type="button"
                title={t('focusPreset')}
                aria-label={t('focusPreset')}
                onClick={() => setPresetOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-2 hover:bg-hover hover:text-ink"
              >
                <Plus size={21} strokeWidth={1.8} />
              </button>
            )}
            <Popover
              align="right"
              panelClass="w-40"
              trigger={(open, toggle) => (
                <button
                  type="button"
                  title={t('focusSettings')}
                  aria-label={t('focusSettings')}
                  aria-expanded={open}
                  onClick={toggle}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <MoreHorizontal size={21} strokeWidth={1.8} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    onClick={() => { close(); setStatsOpen(true); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover"
                  >
                    <BarChart3 size={15} /> {t('focusStatsMenu')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { close(); setSettingsOpen(true); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover"
                  >
                    <Settings2 size={15} /> {t('focusSettings')}
                  </button>
                </>
              )}
            </Popover>
          </div>
        </header>

        <main className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden">
          {!active && (
            <>
              <div className="mt-[clamp(24px,12vh,128px)]">
                <TaskPicker
                  selectedTask={selectedTask}
                  tasks={selectableTasks}
                  presets={presets}
                  onTaskChange={handleTaskChange}
                  onPreset={usePreset}
                  label={t('focusTaskPicker')}
                  noTaskLabel={t('noTask')}
                  selectTaskLabel={t('focusSelectTask')}
                />
              </div>
              <TimerFace mode={mode} elapsed={elapsed} totalSeconds={pomodoroSeconds} displaySeconds={displaySeconds} active={active} />
              <button
                type="button"
                onClick={beginFreshSession}
                className="flex h-12 w-[158px] shrink-0 items-center justify-center rounded-full bg-tt text-[15px] text-white shadow-[0_4px_14px_rgba(71,114,250,0.22)] transition-colors hover:bg-tt-hover"
              >
                <Play size={17} fill="currentColor" className="mr-2" />
                {t('startTitle')}
              </button>
            </>
          )}

          {active && (
            <div className="flex w-full flex-1 flex-col items-center">
              <div className="mt-[clamp(24px,12vh,128px)]">
                <TaskPicker
                  selectedTask={selectedTask}
                  tasks={selectableTasks}
                  presets={presets}
                  onTaskChange={handleTaskChange}
                  onPreset={usePreset}
                  label={t('focusTaskPicker')}
                  noTaskLabel={t('noTask')}
                  selectTaskLabel={t('focusSelectTask')}
                />
              </div>
              <TimerFace mode={mode} elapsed={elapsed} totalSeconds={pomodoroSeconds} displaySeconds={displaySeconds} active={active} />
              {sessionState === 'running' && (
                <button
                  type="button"
                  onClick={pauseSession}
                  disabled={saving}
                  className="flex h-12 w-[158px] shrink-0 items-center justify-center rounded-full border border-tt bg-white text-[15px] text-tt transition-colors hover:bg-tt-light disabled:opacity-60"
                >
                  <Pause size={17} fill="currentColor" className="mr-2" />
                  {t('pauseTitle')}
                </button>
              )}
              {sessionState === 'paused' && (
                <div className="relative flex shrink-0 flex-col items-center gap-4">
                  {/* Sits in the ring's bottom margin, as before, so the two buttons still fit ~800px windows. */}
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[13px] text-ink-3">{t('focusPaused')}</div>
                  <button
                    type="button"
                    onClick={resumeSession}
                    disabled={saving}
                    className="flex h-12 w-[158px] items-center justify-center rounded-full bg-tt text-[15px] text-white shadow-[0_4px_14px_rgba(71,114,250,0.22)] transition-colors hover:bg-tt-hover disabled:opacity-60"
                  >
                    <Play size={17} fill="currentColor" className="mr-2" />
                    {t('focusResume')}
                  </button>
                  <button
                    type="button"
                    onClick={requestEndSession}
                    disabled={saving}
                    className="flex h-12 w-[158px] items-center justify-center rounded-full border border-line bg-white text-[15px] text-ink-2 transition-colors hover:bg-hover disabled:opacity-60"
                  >
                    <Check size={17} className="mr-2" />
                    {t('focusEnd')}
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </section>

      <aside className="min-w-0 flex-1 overflow-hidden">
        {active && showSessionDetails ? (
          <ActiveFocusPanel
            mode={mode}
            elapsed={elapsed}
            pomodoroSeconds={pomodoroSeconds}
            selectedTask={selectedTask}
            note={note}
            onNoteChange={(value) => { setNote(value); noteRef.current = value; }}
            onBack={() => setShowSessionDetails(false)}
          />
        ) : (
          <FocusOverview
            records={records}
            recordGroups={recordGroups}
            taskById={taskById}
            stats={stats}
            lang={lang}
            onStats={() => setStatsOpen(true)}
            onRefresh={() => void loadRecords()}
          />
        )}
      </aside>

      {notice && <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-[13px] text-white shadow-lg">{notice}</div>}
      {error && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-p-high px-4 py-2 text-[13px] text-white shadow-lg">
          {error}
        </div>
      )}
      {presetOpen && <FocusPresetModal settings={settings} onClose={() => setPresetOpen(false)} onSave={savePreset} />}
      {settingsOpen && <FocusSettingsModal settings={settings} onClose={() => setSettingsOpen(false)} onSave={updateSettings} />}
      {statsOpen && <FocusStatsModal stats={stats} lang={lang} onClose={() => setStatsOpen(false)} />}
      {endConfirmOpen && (
        <FocusAbandonModal
          onClose={() => setEndConfirmOpen(false)}
          onAbandon={() => { setEndConfirmOpen(false); void endSession(); }}
        />
      )}
    </div>
  );
}

function TaskPicker({
  selectedTask,
  tasks,
  presets,
  onTaskChange,
  onPreset,
  label,
  noTaskLabel,
  selectTaskLabel,
}: {
  selectedTask?: Task;
  tasks: Task[];
  presets: FocusPreset[];
  onTaskChange: (id: string) => void;
  onPreset: (preset: FocusPreset, close: () => void) => void;
  label: string;
  noTaskLabel: string;
  selectTaskLabel: string;
}) {
  return (
    <Popover
      panelClass="max-h-80 w-72 overflow-y-auto"
      trigger={(open, toggle) => (
        <button
          type="button"
          aria-expanded={open}
          aria-label={selectTaskLabel}
          onClick={toggle}
          className="flex min-w-0 items-center justify-center gap-0 rounded-lg px-0 py-1.5 text-[14px] text-ink-2 hover:bg-hover"
        >
          <span className="max-w-[220px] truncate">{selectedTask?.title ?? label}</span>
          <ChevronDown size={15} className="text-ink-3" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-3 py-2 text-[11px] font-semibold text-ink-3">{selectTaskLabel}</div>
          <button
            type="button"
            onClick={() => { onTaskChange(''); close(); }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover ${!selectedTask ? 'bg-tt-light text-tt' : ''}`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line text-[11px]">🍅</span>
            {label}
            {!selectedTask && <Check size={14} className="ml-auto" />}
          </button>
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => { onTaskChange(task.id); close(); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover ${selectedTask?.id === task.id ? 'bg-tt-light text-tt' : ''}`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-tt" />
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
              {selectedTask?.id === task.id && <Check size={14} className="ml-auto" />}
            </button>
          ))}
          {tasks.length === 0 && <div className="px-3 py-2 text-[12px] text-ink-3">{noTaskLabel}</div>}
          {presets.length > 0 && (
            <>
              <div className="mt-1 border-t border-line px-3 py-2 text-[11px] font-semibold text-ink-3">{label}</div>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onPreset(preset, close)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover"
                >
                  <span className="text-[12px] text-tt">{preset.mode === 'pomodoro' ? '🍅' : '⏱'}</span>
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  <span className="text-[11px] text-ink-3">{preset.mode === 'pomodoro' ? `${preset.minutes}m` : '∞'}</span>
                </button>
              ))}
            </>
          )}
        </>
      )}
    </Popover>
  );
}

function ActiveFocusPanel({
  mode,
  elapsed,
  pomodoroSeconds,
  selectedTask,
  note,
  onNoteChange,
  onBack,
}: {
  mode: FocusMode;
  elapsed: number;
  pomodoroSeconds: number;
  selectedTask?: Task;
  note: string;
  onNoteChange: (value: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const pomodoro = mode === 'pomodoro';
  const plannedHeight = pomodoro ? 52 : 2;
  const progress = pomodoro ? Math.min(1, Math.max(0, elapsed / pomodoroSeconds)) : 0;
  const trackTop = pomodoro ? 186 : 192;
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden px-6">
      <header className="mt-12 flex h-11 shrink-0 items-center">
        <button type="button" onClick={onBack} title={t('focusOverview')} aria-label={t('focusOverview')} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tt text-white hover:bg-tt-hover">
          <Timer size={15} strokeWidth={2.2} />
        </button>
        <h2 className="ml-3 truncate text-[18px] font-medium text-ink-2">{pomodoro ? t('focusPomodoro') : t('focusStopwatch')}</h2>
        <Popover
          align="right"
          panelClass="w-[240px]"
          trigger={(open, toggle) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              title={t('focusSelectTask')}
              aria-label={t('focusSelectTask')}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"
            >
              <Link2 size={18} strokeWidth={1.8} />
            </button>
          )}
        >
          {() => (
            <div className="px-3 py-2.5 text-[12px] text-ink-3">
              <div className="mb-1 text-[11px] font-semibold">{t('focusSelectTask')}</div>
              <div className="truncate text-[13px] text-ink-2">{selectedTask?.title ?? t('noTask')}</div>
            </div>
          )}
        </Popover>
      </header>
      <div className="mt-9 mb-[42px] flex-none min-h-[260px] overflow-hidden">
        <div className="relative ml-7 mt-2.5 mb-2.5 h-[503px]">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="relative box-border h-[125px] border-t border-line">
              <span className="absolute right-full top-[-8px] mr-2 text-right text-[12px] leading-[14px] text-ink-3">{index}</span>
            </div>
          ))}
          <div className="absolute left-0 right-px z-10 h-px bg-p-high" style={{ top: `${trackTop + 9}px` }}>
            <div className="absolute left-[-4px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-p-high" />
          </div>
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="pointer-events-auto absolute left-[2px] right-0 rounded-sm border border-tt/30 bg-tt/5"
              style={{ top: `${trackTop}px`, height: `${plannedHeight}px` }}
            >
              <div className="rounded-t-[1px] bg-[#95adf9]" style={{ height: `${Math.max(0.1, plannedHeight * progress)}px` }} />
            </div>
          </div>
        </div>
      </div>
      <div className="flex-none">
        <h2 className="text-[16px] font-medium leading-[22px] text-ink-2">{t('focusNotes')}</h2>
        <div className="mt-3">
          <textarea
            value={note}
            maxLength={4000}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder={t('focusNotesPh')}
            className="h-[100px] w-full resize-none rounded-lg border border-transparent bg-[#fafafa] px-2.5 py-2 text-[13px] leading-5 text-ink-2 outline-none placeholder:text-ink-3 focus:border-tt focus:bg-white"
          />
        </div>
      </div>
    </div>
  );
}

function FocusOverview({
  records,
  recordGroups,
  taskById,
  stats,
  lang,
  onStats,
  onRefresh,
}: {
  records: Focus[];
  recordGroups: [string, Focus[]][];
  taskById: Map<string, Task>;
  stats: {
    todayTomatoes: number;
    todaySeconds: number;
    totalTomatoes: number;
    totalSeconds: number;
  };
  lang: 'en' | 'zh';
  onStats: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center border-b border-line px-[22px]">
        <h2 className="text-[14px] font-medium">{t('focusOverview')}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-8">
        <div className="mt-2 grid grid-cols-2 gap-3">
          <StatTile label={t('focusTomatoesToday')} value={String(stats.todayTomatoes)} />
          <StatTile label={t('focusTodayDuration')} value={compactDuration(stats.todaySeconds, lang)} />
          <StatTile label={t('focusTotalTomatoes')} value={String(stats.totalTomatoes)} />
          <StatTile label={t('focusTotalDuration')} value={compactDuration(stats.totalSeconds, lang)} />
        </div>
        <div className="mb-2 mt-14 flex items-center">
          <h3 className="text-[14px] font-medium">{t('focusRecords')}</h3>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={onStats} title={t('focusStatsMenu')} aria-label={t('focusStatsMenu')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
              <BarChart3 size={15} />
            </button>
            <button type="button" onClick={onRefresh} title={t('resetTitle')} aria-label={t('resetTitle')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
        {records.length === 0 ? (
          <div className="rounded-xl border border-line px-4 py-8 text-center text-[13px] text-ink-3">{t('focusEmpty')}</div>
        ) : (
          <div>
            {recordGroups.map(([day, group]) => (
              <section key={day} className="border-b border-line/70 last:border-b-0">
                <div className="pt-4 text-[12px] font-medium text-ink-3">{shortDate(day, lang)}</div>
                <div className="pb-1 pt-1">
                  {[...group]
                    .sort(newestFirst)
                    .map((record) => {
                      const task = record.taskId ? taskById.get(record.taskId) : undefined;
                      const start = recordClock(record.startTime);
                      const end = recordClock(record.endTime);
                      return (
                        <div key={`${record.type}-${record.id}`} className="flex items-start gap-3 py-3">
                          <div className="w-[112px] shrink-0 text-[12px] tabular-nums text-ink-2">
                            {start}{end ? ` - ${end}` : ''}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-[12px] text-ink-2">
                              <span className="text-[13px] text-tt">{record.type === 0 ? '🍅' : '⏱'}</span>
                              {compactDuration(record.duration ?? 0, lang)}
                            </div>
                            {task && <div className="mt-1 truncate text-[13px] text-ink">{task.title}</div>}
                            {record.note && <div className="mt-1 truncate text-[12px] text-ink-3">{record.note}</div>}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-[73px] flex-col justify-center rounded-xl bg-[#fafafa] px-4">
      <div className="truncate text-[12px] text-ink-3">{label}</div>
      <div className="mt-1 text-[23px] font-medium leading-none tabular-nums text-ink">{value}</div>
    </div>
  );
}

function ModalShell({
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[88vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-[0_10px_36px_rgba(0,0,0,0.18)] ${className}`} onMouseDown={(event) => event.stopPropagation()}>
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

function FocusAbandonModal({ onClose, onAbandon }: { onClose: () => void; onAbandon: () => void }) {
  const t = useT();
  return (
    <ModalShell title={t('focusAbandonTitle')} onClose={onClose} className="w-[360px]">
      <p className="text-[13px] leading-5 text-ink-2">{t('focusAbandonMessage')}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-5 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
        <button type="button" onClick={onAbandon} className="h-10 rounded-lg bg-tt px-5 text-[13px] text-white hover:bg-tt-hover">{t('focusAbandon')}</button>
      </div>
    </ModalShell>
  );
}

function FocusPresetModal({
  settings,
  onClose,
  onSave,
}: {
  settings: FocusSettings;
  onClose: () => void;
  onSave: (input: Omit<FocusPreset, 'id'>) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<FocusMode>('pomodoro');
  const [minutes, setMinutes] = useState(String(settings.pomodoroMinutes));
  const validMinutes = Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 120;
  return (
    <ModalShell title={t('focusPreset')} onClose={onClose}>
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f5df] text-[24px]">🍅</div>
        <input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('focusPresetName')}
          className="h-10 min-w-0 flex-1 rounded-lg border border-tt px-3 text-[14px] outline-none placeholder:text-[#cfd5e0] focus:border-tt"
        />
      </div>
      <div className="mb-2 text-[13px] font-medium text-ink-2">{t('focusTimerMode')}</div>
      <div className="space-y-2">
        <label className="flex min-h-10 items-center gap-3 rounded-lg border border-line px-3 text-[13px] hover:bg-hover">
          <input type="radio" name="focus-preset-mode" checked={mode === 'pomodoro'} onChange={() => setMode('pomodoro')} className="accent-tt" />
          <span>{t('focusPomodoro')}</span>
          {mode === 'pomodoro' && (
            <div className="ml-auto flex items-center gap-2">
              <input type="number" min="1" max="120" value={minutes} onChange={(event) => setMinutes(event.target.value)} className="h-8 w-16 rounded-md border border-line px-2 text-center text-[13px] outline-none focus:border-tt" />
              <span className="text-ink-3">{t('focusMinutes')}</span>
            </div>
          )}
        </label>
        <label className="flex min-h-10 items-center gap-3 rounded-lg border border-line px-3 text-[13px] hover:bg-hover">
          <input type="radio" name="focus-preset-mode" checked={mode === 'stopwatch'} onChange={() => setMode('stopwatch')} className="accent-tt" />
          <span>{t('focusStopwatch')}</span>
        </label>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-5 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
        <button
          type="button"
          disabled={!name.trim() || (mode === 'pomodoro' && !validMinutes)}
          onClick={() => onSave({ name: name.trim(), mode, minutes: mode === 'pomodoro' ? Math.round(Number(minutes)) : 0 })}
          className="h-10 rounded-lg bg-tt px-6 text-[13px] text-white hover:bg-tt-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('save')}
        </button>
      </div>
    </ModalShell>
  );
}

function FocusSettingsModal({
  settings,
  onClose,
  onSave,
}: {
  settings: FocusSettings;
  onClose: () => void;
  onSave: (settings: FocusSettings) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(settings);
  const setNumber = (key: 'pomodoroMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakInterval', value: string) => {
    const number = Number(value);
    if (Number.isFinite(number)) setDraft((current) => ({ ...current, [key]: Math.round(number) }));
  };
  const row = (key: 'pomodoroMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakInterval', label: string, min: number, max: number) => (
    <label className="flex items-center justify-between gap-3 py-2 text-[13px]">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" min={min} max={max} value={draft[key]} onChange={(event) => setNumber(key, event.target.value)} className="h-8 w-20 rounded-md border border-line px-2 text-center text-[13px] outline-none focus:border-tt" />
        <span className="w-12 text-ink-3">{key === 'longBreakInterval' ? '🍅' : t('focusMinutes')}</span>
      </div>
    </label>
  );
  const check = (key: 'sync' | 'browserTitle' | 'autoStartNext' | 'autoBreak' | 'sound', label: string, hint?: string) => (
    <div className="py-2">
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-tt" />
        {label}
      </label>
      {hint && <div className="mt-1 pl-6 text-[11px] leading-4 text-ink-3">{hint}</div>}
    </div>
  );
  const valid =
    draft.pomodoroMinutes >= 1 && draft.pomodoroMinutes <= 120 &&
    draft.shortBreakMinutes >= 1 && draft.shortBreakMinutes <= 60 &&
    draft.longBreakMinutes >= 1 && draft.longBreakMinutes <= 60 &&
    draft.longBreakInterval >= 1 && draft.longBreakInterval <= 12;
  return (
    <ModalShell title={t('focusSettings')} onClose={onClose} className="w-[472px]">
      <div className="divide-y divide-line/70">
        <div className="pb-3">
          {check('sync', t('focusSync'), t('focusSyncHint'))}
          {check('browserTitle', t('focusBrowserTitle'), t('focusBrowserTitleHint'))}
        </div>
        <div className="py-3">
          <div className="mb-2 text-[12px] font-medium text-ink-3">{t('focusTimerOptions')}</div>
          {row('pomodoroMinutes', t('focusPomodoroLength'), 1, 120)}
          {row('shortBreakMinutes', t('focusShortBreak'), 1, 60)}
          {row('longBreakMinutes', t('focusLongBreak'), 1, 60)}
          {row('longBreakInterval', t('focusLongBreakInterval'), 1, 12)}
        </div>
        <div className="py-3">
          <div className="mb-2 text-[12px] font-medium text-ink-3">{t('focusAutoOptions')}</div>
          {check('autoStartNext', t('focusAutoStart'))}
          {check('autoBreak', t('focusAutoBreak'))}
        </div>
        <div className="pt-3">
          <div className="mb-2 text-[12px] font-medium text-ink-3">{t('focusSoundOptions')}</div>
          {check('sound', t('focusSound'))}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-5 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
        <button type="button" disabled={!valid} onClick={() => { onSave({ ...draft, pomodoroMinutes: boundedNumber(draft.pomodoroMinutes, 25, 1, 120), shortBreakMinutes: boundedNumber(draft.shortBreakMinutes, 5, 1, 60), longBreakMinutes: boundedNumber(draft.longBreakMinutes, 15, 1, 60), longBreakInterval: boundedNumber(draft.longBreakInterval, 4, 1, 12) }); onClose(); }} className="h-10 rounded-lg bg-tt px-6 text-[13px] text-white hover:bg-tt-hover disabled:cursor-not-allowed disabled:opacity-40">{t('save')}</button>
      </div>
    </ModalShell>
  );
}

function FocusStatsModal({
  stats,
  lang,
  onClose,
}: {
  stats: {
    todayTomatoes: number;
    todaySeconds: number;
    totalTomatoes: number;
    totalSeconds: number;
    days: readonly (readonly [string, number])[];
    maxDaySeconds: number;
  };
  lang: 'en' | 'zh';
  onClose: () => void;
}) {
  const t = useT();
  return (
    <ModalShell title={t('focusStatsMenu')} onClose={onClose} className="w-[560px]">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={t('focusTomatoesToday')} value={String(stats.todayTomatoes)} />
        <StatTile label={t('focusTodayDuration')} value={compactDuration(stats.todaySeconds, lang)} />
        <StatTile label={t('focusTotalTomatoes')} value={String(stats.totalTomatoes)} />
        <StatTile label={t('focusTotalDuration')} value={compactDuration(stats.totalSeconds, lang)} />
      </div>
      <div className="mt-7 text-[13px] font-medium">{t('last7')}</div>
      <div className="mt-4 flex h-36 items-end gap-3">
        {stats.days.map(([day, seconds]) => (
          <div key={day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="text-[10px] text-ink-3">{seconds > 0 ? compactDuration(seconds, lang) : ''}</div>
            <div className="w-full max-w-10 rounded-t-md bg-tt/75" style={{ height: `${Math.max(3, (seconds / stats.maxDaySeconds) * 92)}px` }} />
            <div className="text-[10px] text-ink-3">{weekdayShort(day, lang)}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="h-10 rounded-lg bg-tt px-6 text-[13px] text-white hover:bg-tt-hover">{t('close')}</button>
      </div>
    </ModalShell>
  );
}
