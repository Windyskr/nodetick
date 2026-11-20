import { useCallback, useMemo, useState } from 'react';
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
  SkipForward,
  Timer,
} from 'lucide-react';
import { Popover } from '../../components/Popover';
import { api } from '../../lib/api';
import type { Focus, Task } from '../../lib/types';
import { fmtClock, parseInstant, todayStr } from '../../lib/date';
import {
  displaySeconds,
  type FocusMode,
  type FocusSettings,
  type FocusTimer,
  isBreak,
  longEnoughToSave,
  type NoiseKind,
  pausedMs,
  progressOf,
  SETTING_LIMITS,
} from '../../lib/focusTimer';
import { useFocus, useNow } from '../../stores/focus';
import { useStore } from '../../stores/store';
import { useT, useTF, type Key } from '../../i18n';
import { useFocusHistory, useFocusStats } from './focus/data';
import { DeleteRecordDialog, HistoryList } from './focus/HistoryList';
import RecordDialog from './focus/RecordDialog';
import StatsDialog from './focus/StatsDialog';
import { BREAK_COLOR, ModalShell, PomoIcon, StatTile, useCompactDuration } from './focus/ui';

interface FocusPreset {
  id: string;
  name: string;
  mode: FocusMode;
  minutes: number;
}

const PRESETS_KEY = 'ntk_focus_presets';
const TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * 196;

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

function TimerDial({ timer, progress, elapsedSeconds, color }: { timer: FocusTimer; progress: number; elapsedSeconds: number; color: string }) {
  if (timer.mode === 'stopwatch' && !isBreak(timer.phase)) {
    const activeTicks = timer.status !== 'idle' ? Math.min(60, Math.floor(Math.max(0, elapsedSeconds)) % 60 + 1) : 0;
    return (
      <svg aria-hidden="true" className="absolute left-1/2 top-1/2 h-[104.44%] w-[104.44%] -translate-x-1/2 -translate-y-1/2" viewBox="0 0 376 376">
        {Array.from({ length: 60 }, (_, index) => (
          <line
            key={index}
            x1="188"
            y1="4"
            x2="188"
            y2="22"
            style={index < activeTicks ? { stroke: color } : { stroke: 'var(--color-ink)', strokeOpacity: 0.1 }}
            strokeWidth="2.5"
            transform={`rotate(${index * 6} 188 188)`}
          />
        ))}
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 400 400">
      <circle style={{ stroke: 'var(--color-ink)', strokeOpacity: 0.1 }} cx="200" cy="200" r="196" strokeWidth="8" fill="none" />
      <circle
        style={{ stroke: color }}
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

export default function FocusPage() {
  const t = useT();
  const f = useTF();
  const compact = useCompactDuration();
  const focus = useFocus();
  const { timer, settings } = focus;
  const tasks = useStore((state) => state.tasks);
  const completed = useStore((state) => state.completed);
  const abandoned = useStore((state) => state.abandoned);
  const trash = useStore((state) => state.trash);
  const [presets, setPresets] = useState<FocusPreset[]>(readPresets);
  const [presetOpen, setPresetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [recordDialog, setRecordDialog] = useState<{ record?: Focus } | null>(null);
  const [deleting, setDeleting] = useState<Focus | null>(null);
  const [showSessionDetails, setShowSessionDetails] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const history = useFocusHistory(focus.recordsVersion);
  const today = todayStr();
  const todayStats = useFocusStats({ from: today, to: today }, focus.recordsVersion);

  const allTasks = useMemo(() => [...tasks, ...completed, ...abandoned, ...trash], [tasks, completed, abandoned, trash]);
  const taskById = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks]);
  const selectedTask = timer.taskId ? taskById.get(timer.taskId) : undefined;
  const taskTitle = useCallback((id: string) => {
    const task = taskById.get(id);
    return task ? task.title || t('untitled') : undefined;
  }, [taskById, t]);

  const onBreak = isBreak(timer.phase);
  const sessionActive = timer.phase === 'focus' && timer.status !== 'idle';
  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2400);
  };

  const requestEnd = () => {
    if (longEnoughToSave(timer, Date.now())) focus.finish();
    else setEndConfirmOpen(true);
  };

  const savePreset = (input: Omit<FocusPreset, 'id'>) => {
    const next = [...presets, { ...input, id: `focus-preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }];
    setPresets(next);
    persist(PRESETS_KEY, next);
    setPresetOpen(false);
    flash(t('focusPresetSaved'));
  };

  const applyPreset = (preset: FocusPreset, close: () => void) => {
    focus.setMode(preset.mode);
    if (preset.mode === 'pomodoro' && preset.minutes !== settings.pomodoroMinutes) {
      focus.updateSettings({ ...settings, pomodoroMinutes: preset.minutes });
    }
    close();
  };

  const onRecordSaved = (record: Focus) => {
    history.upsert(record);
    focus.recordsChanged();
  };

  const confirmDelete = (record: Focus) => {
    api.deleteFocus(record.id, record.type).then(
      () => {
        history.remove(record);
        focus.recordsChanged();
        setDeleting(null);
      },
      () => {
        setDeleting(null);
        flash(t('focusSaveError'));
      },
    );
  };


  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-white lg:flex-row lg:overflow-hidden">
      <section className="flex w-full shrink-0 flex-col border-b border-line lg:h-full lg:w-3/5 lg:min-w-[560px] lg:border-b-0 lg:border-r">
        <header className="relative flex h-16 shrink-0 items-center gap-2 border-b border-line px-4 md:px-[26px]">
          <h1 className="shrink-0 text-[18px] font-bold md:text-[20px]">{t('focusTitle')}</h1>
          {timer.status === 'idle' && !onBreak && (
            <div className="flex items-center text-[13px] text-ink-2 md:absolute md:left-1/2 md:-translate-x-1/2">
              {(['pomodoro', 'stopwatch'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={timer.mode === mode}
                  onClick={() => focus.setMode(mode)}
                  className={`px-2.5 py-1.5 transition-colors md:px-[22px] ${timer.mode === mode ? 'font-medium text-ink' : 'hover:text-ink'}`}
                >
                  {mode === 'pomodoro' ? t('focusPomodoro') : t('focusStopwatch')}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            {timer.status === 'idle' && !onBreak && (
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
                  title={t('more')}
                  aria-label={t('more')}
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
                  <button type="button" onClick={() => { close(); setStatsOpen(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover">
                    <BarChart3 size={15} /> {t('focusStatsMenu')}
                  </button>
                  <button type="button" onClick={() => { close(); setSettingsOpen(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover">
                    <Settings2 size={15} /> {t('focusSettings')}
                  </button>
                </>
              )}
            </Popover>
          </div>
        </header>

        <TimerArea selectedTask={selectedTask} tasks={tasks} presets={presets} onPreset={applyPreset} onRequestEnd={requestEnd} />
      </section>

      <aside className="min-w-0 flex-1 lg:overflow-hidden">
        {sessionActive && showSessionDetails ? (
          <ActiveFocusPanel
            timer={timer}
            records={history.records}
            selectedTask={selectedTask}
            onNoteChange={focus.setNote}
            onBack={() => setShowSessionDetails(false)}
          />
        ) : (
          <div className="flex min-w-0 flex-col lg:h-full lg:overflow-hidden">
            <header className="flex h-16 shrink-0 items-center border-b border-line px-[22px]">
              <h2 className="text-[14px] font-medium">{t('focusOverview')}</h2>
              {sessionActive && (
                <button type="button" onClick={() => setShowSessionDetails(true)} className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-tt hover:bg-hover">
                  <Timer size={14} /> {t('focusRunning')}
                </button>
              )}
            </header>
            <div className="min-h-0 flex-1 px-[22px] pb-8 lg:overflow-y-auto">
              <div className={`mt-2 grid grid-cols-2 gap-3 transition-opacity ${todayStats.loading && todayStats.data ? 'opacity-60' : ''}`}>
                <StatTile label={t('focusTomatoesToday')} value={todayStats.data?.period?.pomoCount ?? 0} />
                <StatTile label={t('focusTodayDuration')} value={compact(todayStats.data?.period?.seconds ?? 0)} />
                <StatTile label={t('focusTotalTomatoes')} value={todayStats.data?.total.pomoCount ?? 0} />
                <StatTile label={t('focusTotalDuration')} value={compact(todayStats.data?.total.seconds ?? 0)} />
              </div>
              {focus.pending.length > 0 && focus.saveFailed && (
                <div className="mt-3 rounded-lg bg-p-medium/15 px-3 py-2 text-[12px] text-ink-2">{f('focusSavePending', focus.pending.length)}</div>
              )}
              <div className="mb-2 mt-10 flex items-center">
                <h3 className="text-[14px] font-medium">{t('focusRecords')}</h3>
                <div className="ml-auto flex items-center gap-1">
                  <button type="button" onClick={() => setRecordDialog({})} title={t('focusAddRecord')} aria-label={t('focusAddRecord')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
                    <Plus size={16} />
                  </button>
                  <button type="button" onClick={() => setStatsOpen(true)} title={t('focusStatsMenu')} aria-label={t('focusStatsMenu')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
                    <BarChart3 size={15} />
                  </button>
                  <button type="button" onClick={focus.recordsChanged} title={t('focusRefresh')} aria-label={t('focusRefresh')} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
                    <RotateCcw size={15} />
                  </button>
                </div>
              </div>
              <HistoryList
                records={history.records}
                hasMore={history.nextBefore != null}
                loading={history.loading}
                failed={history.failed}
                onMore={history.loadMore}
                taskTitle={taskTitle}
                onEdit={(record) => setRecordDialog({ record })}
                onDelete={setDeleting}
                empty={t('focusEmpty')}
              />
            </div>
          </div>
        )}
      </aside>

      {notice && <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-[13px] text-white shadow-lg">{notice}</div>}
      {presetOpen && <FocusPresetModal settings={settings} onClose={() => setPresetOpen(false)} onSave={savePreset} />}
      {settingsOpen && <FocusSettingsModal settings={settings} onClose={() => setSettingsOpen(false)} onSave={focus.updateSettings} />}
      {statsOpen && <StatsDialog onClose={() => setStatsOpen(false)} />}
      {recordDialog && <RecordDialog record={recordDialog.record} tasks={allTasks} onClose={() => setRecordDialog(null)} onSaved={onRecordSaved} />}
      {deleting && <DeleteRecordDialog onClose={() => setDeleting(null)} onConfirm={() => confirmDelete(deleting)} />}
      {endConfirmOpen && (
        <FocusAbandonModal
          onClose={() => setEndConfirmOpen(false)}
          onAbandon={() => { setEndConfirmOpen(false); focus.abandon(); }}
        />
      )}
    </div>
  );
}

const PRIMARY = 'flex h-12 w-[158px] shrink-0 items-center justify-center rounded-full text-[15px] text-white transition-colors disabled:opacity-60';
const SECONDARY = 'flex h-12 w-[158px] shrink-0 items-center justify-center rounded-full border bg-white text-[15px] transition-colors';

/** Task or phase line, the clock face and the buttons; the only part that ticks. */
function TimerArea({
  selectedTask,
  tasks,
  presets,
  onPreset,
  onRequestEnd,
}: {
  selectedTask?: Task;
  tasks: Task[];
  presets: FocusPreset[];
  onPreset: (preset: FocusPreset, close: () => void) => void;
  onRequestEnd: () => void;
}) {
  const t = useT();
  const f = useTF();
  const timer = useFocus((state) => state.timer);
  const settings = useFocus((state) => state.settings);
  const focus = useFocus.getState();
  const now = useNow(timer.status === 'running', 250);
  const onBreak = isBreak(timer.phase);
  const seconds = displaySeconds(timer, settings, now);
  const color = onBreak ? BREAK_COLOR : 'var(--color-tt)';
  const cycleDots = timer.mode === 'pomodoro'
    ? {
      interval: settings.longBreakInterval,
      done: timer.phase === 'longBreak' && timer.cycle > 0 ? settings.longBreakInterval : timer.cycle % settings.longBreakInterval,
    }
    : null;

  return (
    <main className="relative flex min-h-0 flex-1 flex-col items-center pb-8 lg:overflow-hidden lg:pb-0">
      <div className="mt-[clamp(20px,10vh,112px)] flex min-h-9 items-center">
        {onBreak ? (
          <div className="text-[15px] font-medium" style={{ color: BREAK_COLOR }}>
            {timer.phase === 'longBreak' ? t('focusPhaseLongBreak') : t('focusPhaseShortBreak')}
          </div>
        ) : (
          <TaskPicker
            selectedTask={selectedTask}
            tasks={tasks}
            presets={timer.status === 'idle' ? presets : []}
            onTaskChange={(id) => focus.setTask(id || null)}
            onPreset={onPreset}
          />
        )}
      </div>
      <div className="relative mb-[clamp(16px,8vh,92px)] mt-[clamp(16px,6vh,72px)] h-[min(360px,42vh,calc(100vw_-_110px))] w-[min(360px,42vh,calc(100vw_-_110px))] shrink-0">
        <TimerDial timer={timer} progress={progressOf(timer, now)} elapsedSeconds={timer.mode === 'stopwatch' ? seconds : 0} color={color} />
        <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center">
          <div className="text-[clamp(40px,7vh,54px)] font-normal leading-[1.2] tabular-nums tracking-[-0.02em] text-ink" role="timer" aria-live="off">
            {fmtClock(seconds)}
          </div>
          {cycleDots && (
            <div className="mt-2 flex gap-1.5" title={f('focusCycle', cycleDots.done, cycleDots.interval)} aria-label={f('focusCycle', cycleDots.done, cycleDots.interval)}>
              {Array.from({ length: cycleDots.interval }, (_, index) => (
                <span key={index} className="h-1.5 w-1.5 rounded-full" style={{ background: index < cycleDots.done ? color : 'var(--color-line)' }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {timer.status === 'idle' && !onBreak && (
        <button type="button" onClick={() => focus.start()} className={`${PRIMARY} bg-tt shadow-[0_4px_14px_rgba(71,114,250,0.22)] hover:bg-tt-hover`}>
          <Play size={17} fill="currentColor" className="mr-2" />
          {t('startTitle')}
        </button>
      )}
      {timer.status === 'running' && !onBreak && (
        <button type="button" onClick={focus.pause} className={`${SECONDARY} border-tt text-tt hover:bg-tt-light`}>
          <Pause size={17} fill="currentColor" className="mr-2" />
          {t('pauseTitle')}
        </button>
      )}
      {timer.status === 'paused' && (
        <div className="relative flex shrink-0 flex-col items-center gap-4">
          {/* Sits in the ring's bottom margin, so the two buttons still fit ~800px windows. */}
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[13px] text-ink-3">{t('focusPaused')}</div>
          <button type="button" onClick={focus.resume} className={`${PRIMARY} bg-tt shadow-[0_4px_14px_rgba(71,114,250,0.22)] hover:bg-tt-hover`}>
            <Play size={17} fill="currentColor" className="mr-2" />
            {t('focusResume')}
          </button>
          <button type="button" onClick={onBreak ? focus.skipBreak : onRequestEnd} className={`${SECONDARY} border-line text-ink-2 hover:bg-hover`}>
            <Check size={17} className="mr-2" />
            {onBreak ? t('focusSkipBreak') : t('focusEnd')}
          </button>
        </div>
      )}
      {onBreak && timer.status === 'idle' && (
        <div className="flex shrink-0 flex-col items-center gap-4">
          <button type="button" onClick={focus.startBreak} className={PRIMARY} style={{ background: BREAK_COLOR }}>
            <Play size={17} fill="currentColor" className="mr-2" />
            {t('focusStartBreak')}
          </button>
          <button type="button" onClick={focus.skipBreak} className={`${SECONDARY} border-line text-ink-2 hover:bg-hover`}>
            <SkipForward size={17} className="mr-2" />
            {t('focusSkipBreak')}
          </button>
        </div>
      )}
      {onBreak && timer.status === 'running' && (
        <button type="button" onClick={focus.skipBreak} className={`${SECONDARY} border-line text-ink-2 hover:bg-hover`}>
          <SkipForward size={17} className="mr-2" />
          {t('focusSkipBreak')}
        </button>
      )}
    </main>
  );
}

function TaskPicker({
  selectedTask,
  tasks,
  presets,
  onTaskChange,
  onPreset,
}: {
  selectedTask?: Task;
  tasks: Task[];
  presets: FocusPreset[];
  onTaskChange: (id: string) => void;
  onPreset: (preset: FocusPreset, close: () => void) => void;
}) {
  const t = useT();
  const f = useTF();
  const label = t('focusTaskPicker');
  return (
    <Popover
      panelClass="max-h-80 w-72 overflow-y-auto"
      trigger={(open, toggle) => (
        <button
          type="button"
          aria-expanded={open}
          aria-label={t('focusSelectTask')}
          onClick={toggle}
          className="flex min-w-0 items-center justify-center gap-0 rounded-lg px-2 py-1.5 text-[14px] text-ink-2 hover:bg-hover"
        >
          <span className="max-w-[220px] truncate">{selectedTask?.title ?? label}</span>
          <ChevronDown size={15} className="text-ink-3" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-3 py-2 text-[11px] font-semibold text-ink-3">{t('focusSelectTask')}</div>
          <button
            type="button"
            onClick={() => { onTaskChange(''); close(); }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover ${!selectedTask ? 'bg-tt-light text-tt' : ''}`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line"><PomoIcon size={12} /></span>
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
              <span className="min-w-0 flex-1 truncate">{task.title || t('untitled')}</span>
              {selectedTask?.id === task.id && <Check size={14} className="ml-auto" />}
            </button>
          ))}
          {tasks.length === 0 && <div className="px-3 py-2 text-[12px] text-ink-3">{t('noTask')}</div>}
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
                  {preset.mode === 'pomodoro' ? <PomoIcon size={13} /> : <Timer size={13} className="text-tt" />}
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  <span className="text-[11px] text-ink-3">{preset.mode === 'pomodoro' ? f('focusDurM', preset.minutes) : '∞'}</span>
                </button>
              ))}
            </>
          )}
        </>
      )}
    </Popover>
  );
}

const HOUR_MS = 3_600_000;
const PX_PER_HOUR = 96;

/**
 * During a session: today's focus on an hour grid around now (records and
 * the running session, with a pomodoro's planned end), and the session note.
 */
function ActiveFocusPanel({
  timer,
  records,
  selectedTask,
  onNoteChange,
  onBack,
}: {
  timer: FocusTimer;
  records: Focus[];
  selectedTask?: Task;
  onNoteChange: (value: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  // The grid moves 1px every ~40s: a slow clock is plenty.
  const now = useNow(timer.status === 'running', 10_000);
  const pomodoro = timer.mode === 'pomodoro';
  const first = new Date(now - 2 * HOUR_MS);
  first.setMinutes(0, 0, 0);
  const windowStart = first.getTime();
  const windowEnd = windowStart + 4 * HOUR_MS;
  const y = (ms: number) => ((Math.min(Math.max(ms, windowStart), windowEnd) - windowStart) / HOUR_MS) * PX_PER_HOUR;
  const blocks = records.flatMap((record) => {
    const start = parseInstant(record.startTime);
    if (start == null) return [];
    const end = parseInstant(record.endTime) ?? start + ((record.duration ?? 0) + (record.pauseDuration ?? 0)) * 1000;
    if (end <= windowStart || start >= windowEnd) return [];
    return [{ key: `${record.type}:${record.id}`, top: y(start), height: Math.max(2, y(end) - y(start)) }];
  });
  const sessionStart = timer.startedAt ?? now;
  const plannedEnd = pomodoro ? sessionStart + timer.plannedMs + pausedMs(timer, now) : now;
  const hours = Array.from({ length: 5 }, (_, index) => new Date(windowStart + index * HOUR_MS));

  return (
    <div className="flex min-w-0 flex-col px-6 pb-6 lg:h-full lg:overflow-hidden">
      <header className="mt-6 flex h-11 shrink-0 items-center lg:mt-12">
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
      <div className="mb-6 mt-6 flex-none overflow-hidden pb-3">
        <div className="relative ml-12 mt-2.5" style={{ height: 4 * PX_PER_HOUR + 1 }}>
          {hours.map((hour, index) => (
            <div key={hour.getTime()} className="absolute left-0 right-0 border-t border-line" style={{ top: index * PX_PER_HOUR }}>
              <span className="absolute right-full top-[-8px] mr-2 text-right text-[12px] leading-[14px] tabular-nums text-ink-3">
                {`${String(hour.getHours()).padStart(2, '0')}:00`}
              </span>
            </div>
          ))}
          {blocks.map((block) => (
            <div key={block.key} className="absolute left-[2px] right-0 rounded-sm bg-tt/25" style={{ top: block.top, height: block.height }} />
          ))}
          {pomodoro && (
            <div className="absolute left-[2px] right-0 rounded-sm border border-tt/30 bg-tt/5" style={{ top: y(sessionStart), height: Math.max(2, y(plannedEnd) - y(sessionStart)) }} />
          )}
          <div className="absolute left-[2px] right-0 rounded-sm bg-tt/45" style={{ top: y(sessionStart), height: Math.max(2, y(now) - y(sessionStart)) }} />
          <div className="absolute left-0 right-px z-10 h-px bg-p-high" style={{ top: y(now) }}>
            <div className="absolute left-[-4px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-p-high" />
          </div>
        </div>
      </div>
      <div className="flex-none">
        <h2 className="text-[16px] font-medium leading-[22px] text-ink-2">{t('focusNotes')}</h2>
        <textarea
          value={timer.note}
          maxLength={4000}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder={t('focusNotesPh')}
          className="mt-3 h-[100px] w-full resize-none rounded-lg border border-transparent bg-[#fafafa] px-2.5 py-2 text-[13px] leading-5 text-ink-2 outline-none placeholder:text-ink-3 focus:border-tt focus:bg-white"
        />
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
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-p-high/10"><PomoIcon size={26} /></div>
        <input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('focusPresetName')}
          className="h-10 min-w-0 flex-1 rounded-lg border border-tt px-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-tt"
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

type NumberSetting = 'pomodoroMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakInterval';
const NOISES: [NoiseKind, Key][] = [['off', 'focusNoiseOff'], ['white', 'focusNoiseWhite'], ['pink', 'focusNoisePink'], ['brown', 'focusNoiseBrown']];

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
  const setNumber = (key: NumberSetting, value: string) => {
    const number = Number(value);
    if (Number.isFinite(number)) setDraft((current) => ({ ...current, [key]: Math.round(number) }));
  };
  const row = (key: NumberSetting, label: string) => (
    <label className="flex items-center justify-between gap-3 py-2 text-[13px]">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" min={SETTING_LIMITS[key][0]} max={SETTING_LIMITS[key][1]} value={draft[key]} onChange={(event) => setNumber(key, event.target.value)} className="h-8 w-20 rounded-md border border-line px-2 text-center text-[13px] outline-none focus:border-tt" />
        <span className="flex w-12 items-center text-ink-3">{key === 'longBreakInterval' ? <PomoIcon size={14} /> : t('focusMinutes')}</span>
      </div>
    </label>
  );
  const check = (key: 'browserTitle' | 'autoStartNext' | 'autoBreak' | 'sound', label: string, hint?: string) => (
    <div className="py-2">
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))} className="h-4 w-4 accent-tt" />
        {label}
      </label>
      {hint && <div className="mt-1 pl-6 text-[11px] leading-4 text-ink-3">{hint}</div>}
    </div>
  );
  const valid = (Object.keys(SETTING_LIMITS) as (keyof typeof SETTING_LIMITS)[]).every((key) => {
    const [min, max] = SETTING_LIMITS[key];
    return draft[key] >= min && draft[key] <= max;
  });
  return (
    <ModalShell title={t('focusSettings')} onClose={onClose} className="w-[472px]">
      <div className="divide-y divide-line/70">
        <div className="pb-3">{check('browserTitle', t('focusBrowserTitle'), t('focusBrowserTitleHint'))}</div>
        <div className="py-3">
          <div className="mb-2 text-[12px] font-medium text-ink-3">{t('focusTimerOptions')}</div>
          {row('pomodoroMinutes', t('focusPomodoroLength'))}
          {row('shortBreakMinutes', t('focusShortBreak'))}
          {row('longBreakMinutes', t('focusLongBreak'))}
          {row('longBreakInterval', t('focusLongBreakInterval'))}
        </div>
        <div className="py-3">
          <div className="mb-2 text-[12px] font-medium text-ink-3">{t('focusAutoOptions')}</div>
          {check('autoStartNext', t('focusAutoStart'))}
          {check('autoBreak', t('focusAutoBreak'))}
        </div>
        <div className="pt-3">
          <div className="mb-2 text-[12px] font-medium text-ink-3">{t('focusSoundOptions')}</div>
          {check('sound', t('focusSound'))}
          <div className="flex flex-wrap items-center gap-2 py-2 text-[13px] text-ink-2">
            <span className="mr-1">{t('focusNoise')}</span>
            <div className="flex rounded-lg bg-hover p-0.5">
              {NOISES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.noise === value}
                  onClick={() => setDraft((current) => ({ ...current, noise: value }))}
                  className={`h-7 rounded-md px-2.5 text-[12px] ${draft.noise === value ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
          {draft.noise !== 'off' && (
            <label className="flex items-center gap-3 py-2 text-[13px] text-ink-2">
              <span>{t('focusNoiseVolume')}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={draft.noiseVolume}
                onChange={(event) => setDraft((current) => ({ ...current, noiseVolume: Number(event.target.value) }))}
                className="flex-1 accent-tt"
              />
              <span className="w-8 text-right tabular-nums text-ink-3">{draft.noiseVolume}</span>
            </label>
          )}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-5 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
        <button type="button" disabled={!valid} onClick={() => { onSave(draft); onClose(); }} className="h-10 rounded-lg bg-tt px-6 text-[13px] text-white hover:bg-tt-hover disabled:cursor-not-allowed disabled:opacity-40">{t('save')}</button>
      </div>
    </ModalShell>
  );
}
