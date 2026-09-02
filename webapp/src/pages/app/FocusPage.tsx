import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import type { Focus, Task } from '../../lib/types';
import { fmtDuration, lastNDays, weekdayShort } from '../../lib/date';
import { useT, useTF } from '../../i18n';

const POMO_SECONDS = 25 * 60;

export default function FocusPage() {
  const t = useT();
  const f = useTF();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [records, setRecords] = useState<Focus[]>([]);
  const [taskId, setTaskId] = useState<string>('');
  const [remaining, setRemaining] = useState(POMO_SECONDS);
  const [running, setRunning] = useState(false);
  const startRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRecords = async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 24 * 3600 * 1000);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00+0000`;
    setRecords(await api.listFocus(iso(from), iso(to)));
  };

  useEffect(() => {
    api.filterTasks({ status: [0] }).then(setTasks).catch(() => undefined);
    void loadRecords();
  }, []);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => stopTimer(), []);

  const record = async (seconds: number) => {
    const end = new Date();
    const start = startRef.current ? new Date(startRef.current) : new Date(end.getTime() - seconds * 1000);
    await api.addFocus({
      type: 0,
      startTime: isoWithOffset(start),
      endTime: isoWithOffset(end),
      duration: seconds,
      ...(taskId ? { taskId } : {}),
    });
    await loadRecords();
  };

  const tick = () => {
    setRemaining((r) => {
      if (r <= 1) {
        stopTimer();
        setRunning(false);
        void record(POMO_SECONDS);
        startRef.current = null;
        return 0;
      }
      return r - 1;
    });
  };

  const start = () => {
    if (running) return;
    startRef.current = Date.now() - (POMO_SECONDS - remaining) * 1000;
    setRunning(true);
    timerRef.current = setInterval(tick, 1000);
  };

  const pause = () => {
    setRunning(false);
    stopTimer();
  };

  const reset = () => {
    pause();
    startRef.current = null;
    setRemaining(POMO_SECONDS);
  };

  const finishEarly = async () => {
    const elapsed = POMO_SECONDS - remaining;
    pause();
    if (elapsed >= 60) await record(elapsed);
    startRef.current = null;
    setRemaining(POMO_SECONDS);
  };

  const stats = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const day of lastNDays(7)) byDay.set(day, 0);
    for (const r of records) {
      if (r.startTime) {
        const day = r.startTime.slice(0, 10);
        if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + (r.duration ?? 0));
      }
    }
    const days = [...byDay.entries()];
    const todayKey = days[days.length - 1]?.[0];
    const todaySec = byDay.get(todayKey ?? '') ?? 0;
    const weekSec = days.reduce((acc, [, s]) => acc + s, 0);
    const max = Math.max(60, ...days.map(([, s]) => s));
    return { days, todaySec, weekSec, max };
  }, [records]);

  const selectedTask = tasks.find((t) => t.id === taskId);
  const pct = 1 - remaining / POMO_SECONDS;

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="px-5 pb-1 pt-4">
        <h1 className="text-[20px] font-bold">{t('focusTitle')}</h1>
      </div>
      <div className="mx-auto max-w-3xl px-5 pb-10">
        {/* timer */}
        <div className="mt-4 flex flex-col items-center rounded-2xl border border-line py-10">
          <div className="relative flex h-56 w-56 items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
              <circle cx="50" cy="50" r="46" fill="none" stroke="#f0f0f0" strokeWidth="5" />
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="#4772fa"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 46}`}
                strokeDashoffset={`${2 * Math.PI * 46 * (1 - pct)}`}
                style={{ transition: 'stroke-dashoffset 0.5s linear' }}
              />
            </svg>
            <div className="text-center">
              <div className="text-[40px] font-bold tabular-nums tracking-tight">
                {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
              </div>
              <div className="mt-1 max-w-[150px] truncate text-[12px] text-ink-3">
                {selectedTask ? selectedTask.title : t('focusedSession')}
              </div>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-3">
            {!running ? (
              <button
                type="button"
                onClick={start}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-tt text-white shadow-[0_4px_14px_rgba(71,114,250,0.4)] hover:bg-tt-hover"
                title={t('startTitle')}
              >
                <Play size={20} className="ml-0.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={pause}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white hover:opacity-90"
                title={t('pauseTitle')}
              >
                <Pause size={20} />
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
              title={t('resetTitle')}
            >
              <RotateCcw size={17} />
            </button>
          </div>
          <select
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="mt-6 w-64 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2"
          >
            <option value="">{t('noTask')}</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {remaining < POMO_SECONDS && (
            <button type="button" onClick={() => void finishEarly()} className="mt-3 text-[12px] text-ink-3 hover:text-tt">
              {t('finishEarly')}
            </button>
          )}
        </div>

        {/* week chart */}
        <div className="mt-6 rounded-2xl border border-line p-5">
          <div className="mb-4 flex items-baseline">
            <span className="text-[14px] font-semibold">{t('last7')}</span>
            <span className="ml-auto text-[12px] text-ink-3">
              {f('focusStats', fmtDuration(stats.todaySec), fmtDuration(stats.weekSec))}
            </span>
          </div>
          <div className="flex h-28 items-end gap-3">
            {stats.days.map(([day, sec]) => (
              <div key={day} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-ink-3">{sec > 0 ? f('minutes', Math.round(sec / 60)) : ''}</span>
                <div
                  className="w-full max-w-[36px] rounded-t-md bg-tt/85"
                  style={{ height: `${Math.max(2, (sec / stats.max) * 88)}px` }}
                />
                <span className="text-[11px] text-ink-3">{weekdayShort(day)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* records */}
        <div className="mt-6">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{t('recentSessions')}</div>
          {records.length === 0 ? (
            <div className="rounded-xl border border-line py-8 text-center text-[13px] text-ink-3">
              {t('focusEmpty')}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              {[...records]
                .sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''))
                .slice(0, 12)
                .map((r) => (
                  <div key={r.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-b-0">
                    <span className="text-[13px] text-tt">🍅</span>
                    <span className="text-[13px]">
                      {r.startTime ? `${r.startTime.slice(0, 10)} ${r.startTime.slice(11, 16)}` : ''}
                    </span>
                    <span className="ml-auto text-[13px] text-ink-2">{fmtDuration(r.duration ?? 0)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function isoWithOffset(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+0000`;
}
