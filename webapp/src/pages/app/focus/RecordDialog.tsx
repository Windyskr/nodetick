import { useMemo, useState } from 'react';
import { Timer } from 'lucide-react';
import { api } from '../../../lib/api';
import { parseInstant, todayStr } from '../../../lib/date';
import { isoWithOffset } from '../../../lib/focusTimer';
import type { Focus, Task } from '../../../lib/types';
import { useT, useTF } from '../../../i18n';
import { ModalShell, PomoIcon, useCompactDuration } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localClock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const DAY_MS = 86_400_000;

/** Start and end of a record as the form shows them (local date + HH:mm). */
function initialTimes(record?: Focus) {
  const start = record ? parseInstant(record.startTime) : null;
  if (start == null) {
    // A new record: the half hour that just ended.
    const end = new Date();
    end.setSeconds(0, 0);
    const begin = new Date(end.getTime() - 25 * 60_000);
    return { date: localDay(begin), start: localClock(begin), end: localClock(end) };
  }
  const span = ((record?.duration ?? 0) + (record?.pauseDuration ?? 0)) * 1000;
  const end = parseInstant(record?.endTime) ?? start + span;
  return { date: localDay(new Date(start)), start: localClock(new Date(start)), end: localClock(new Date(end)) };
}

/**
 * Add a record by hand, or edit one: task, note and times. An end earlier
 * than the start means the next day. Editing keeps the record's pauses, so
 * the focused time is the span minus them.
 */
export default function RecordDialog({
  record,
  tasks,
  onClose,
  onSaved,
}: {
  record?: Focus;
  tasks: Task[];
  onClose: () => void;
  onSaved: (record: Focus) => void;
}) {
  const t = useT();
  const f = useTF();
  const compact = useCompactDuration();
  const initial = useMemo(() => initialTimes(record), [record]);
  const [type, setType] = useState<0 | 1>(record?.type === 1 ? 1 : 0);
  const [taskId, setTaskId] = useState(record?.taskId ?? '');
  const [note, setNote] = useState(record?.note ?? '');
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const pause = record?.pauseDuration ?? 0;
  const startMs = new Date(`${date}T${start}:00`).getTime();
  let endMs = new Date(`${date}T${end}:00`).getTime();
  const nextDay = Number.isFinite(endMs) && Number.isFinite(startMs) && endMs <= startMs;
  if (nextDay) endMs += DAY_MS;
  const span = Math.round((endMs - startMs) / 1000);
  const focused = span - pause;
  const timesChanged = !record || date !== initial.date || start !== initial.start || end !== initial.end;
  const error = !date || !start || !end || !Number.isFinite(span)
    ? t('focusRecordInvalid')
    : timesChanged && endMs > Date.now() + 60_000
      ? t('focusRecordFuture')
      : timesChanged && focused <= 0
        ? t('focusRecordInvalid')
        : null;

  // The task list offers open tasks, plus the record's own task when it is done.
  const options = useMemo(() => {
    const linked = record?.taskId ? tasks.find((task) => task.id === record.taskId) : undefined;
    const open = tasks.filter((task) => task.status === 0 && !task.deletedTime);
    return linked && !open.includes(linked) ? [linked, ...open] : open;
  }, [record, tasks]);

  const save = async () => {
    if (error || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const times = timesChanged ? { startTime: isoWithOffset(startMs), endTime: isoWithOffset(endMs) } : {};
      const task = taskId !== (record?.taskId ?? '') ? { taskId: taskId || null } : {};
      const saved = record
        ? await api.updateFocus(record.id, { type: record.type, note, ...task, ...times })
        : await api.addFocus({ type, ...times, duration: focused, pauseDuration: 0, added: true, ...(taskId ? { taskId } : {}), ...(note.trim() ? { note } : {}) });
      onSaved(saved);
      onClose();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  const field = 'h-9 rounded-lg border border-line bg-white px-2.5 text-[13px] text-ink outline-none focus:border-tt';
  return (
    <ModalShell title={record ? t('focusEditRecord') : t('focusAddRecord')} onClose={onClose} className="w-[440px]">
      <div className="space-y-4">
        {!record && (
          <div>
            <div className="mb-2 text-[13px] font-medium text-ink-2">{t('focusTimerMode')}</div>
            <div className="inline-flex rounded-lg bg-hover p-0.5 text-[13px]">
              {([0, 1] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={type === value}
                  onClick={() => setType(value)}
                  className={`flex h-8 items-center gap-1.5 rounded-md px-3 ${type === value ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
                >
                  {value === 0 ? <PomoIcon size={13} /> : <Timer size={13} />}
                  {value === 0 ? t('focusPomodoro') : t('focusStopwatch')}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{t('focusRecordTask')}</span>
          <select value={taskId} onChange={(event) => setTaskId(event.target.value)} className={`${field} w-full`}>
            <option value="">{t('focusUnlinked')}</option>
            {record?.taskId && !options.some((task) => task.id === record.taskId) && (
              <option value={record.taskId}>{t('focusDeletedTask')}</option>
            )}
            {options.map((task) => (
              <option key={task.id} value={task.id}>{task.title || t('untitled')}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{t('focusRecordDate')}</span>
            <input type="date" value={date} max={todayStr()} onChange={(event) => setDate(event.target.value)} className={`${field} w-full`} />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{t('focusRecordStart')}</span>
            <input type="time" value={start} onChange={(event) => setStart(event.target.value)} className={`${field} w-full`} />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 flex items-baseline gap-1 text-[13px] font-medium text-ink-2">
              {t('focusRecordEnd')}
              {nextDay && <span className="text-[11px] font-normal text-ink-3">{t('focusNextDay')}</span>}
            </span>
            <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} className={`${field} w-full`} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
          {Number.isFinite(focused) && focused > 0 && <span>{f('focusRecordFocused', compact(focused))}</span>}
          {pause > 0 && <span>{f('focusRecordPaused', compact(pause))}</span>}
          {error && <span className="text-p-high">{error}</span>}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{t('focusNotes')}</span>
          <textarea
            value={note}
            maxLength={4000}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('focusNotesPh')}
            className="h-20 w-full resize-none rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-3 focus:border-tt"
          />
        </label>
        {failed && <div className="text-[12px] text-p-high">{t('focusSaveError')}</div>}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-5 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
        <button
          type="button"
          disabled={!!error || saving}
          onClick={() => void save()}
          className="h-10 rounded-lg bg-tt px-6 text-[13px] text-white hover:bg-tt-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('save')}
        </button>
      </div>
    </ModalShell>
  );
}
