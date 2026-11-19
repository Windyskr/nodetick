import { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import { useStore } from '../../stores/store';
import { useI18n, useT } from '../../i18n';
import { addDays, dayOf, todayStr, weekdayShort } from '../../lib/date';
import type { Task } from '../../lib/types';

const MAX_DAYS = 60;

function dateLabel(day: string, lang: 'en' | 'zh'): string {
  const [, month, date] = day.split('-').map(Number);
  return lang === 'zh' ? `${month}/${date}` : `${month}/${date}`;
}

function taskRange(task: Task): { start: string | null; end: string | null } {
  const start = dayOf(task.startDate) ?? dayOf(task.dueDate);
  const end = dayOf(task.dueDate) ?? dayOf(task.startDate);
  if (start && end && end < start) return { start: end, end: start };
  return { start, end };
}

function dayIndex(from: string, day: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = day.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

function daysBetween(from: string, to: string): string[] {
  const count = Math.min(MAX_DAYS, Math.max(1, dayIndex(from, to) + 1));
  return Array.from({ length: count }, (_, index) => addDays(from, index));
}

/** Compact project timeline: one bar per task across its start/end days. */
export default function TimelineBoard({ tasks, sorter }: { tasks: Task[]; sorter: (a: Task, b: Task) => number }) {
  const selectTask = useStore((s) => s.selectTask);
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const today = todayStr();

  const { days, dated, undated } = useMemo(() => {
    const ranges = tasks.map(taskRange).filter((range): range is { start: string; end: string } => !!range.start && !!range.end);
    const first = ranges.reduce<string | null>((current, range) => (!current || range.start < current ? range.start : current), null) ?? today;
    const last = ranges.reduce<string | null>((current, range) => (!current || range.end > current ? range.end : current), null) ?? addDays(first, 6);
    const timelineEnd = dayIndex(first, last) >= MAX_DAYS ? addDays(first, MAX_DAYS - 1) : last;
    const timelineDays = daysBetween(first, timelineEnd);
    const datedTasks = tasks.filter((task) => taskRange(task).start).sort(sorter);
    return {
      days: timelineDays,
      dated: datedTasks,
      undated: tasks.filter((task) => !taskRange(task).start).sort(sorter),
    };
  }, [tasks, sorter, today]);

  const columns = `220px repeat(${days.length}, minmax(64px, 1fr))`;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-5 pb-6 pt-2">
      <div className="min-w-[760px] overflow-hidden rounded-xl border border-line bg-white">
        <div className="grid border-b border-line bg-[#fafafa] text-[11px] text-ink-3" style={{ gridTemplateColumns: columns }}>
          <div className="flex items-center gap-1.5 border-r border-line px-3 py-2 font-semibold text-ink-2">
            <CalendarClock size={14} /> {t('navTasks')}
          </div>
          {days.map((day) => (
            <div key={day} className={`border-r border-line px-2 py-2 text-center last:border-r-0 ${day === today ? 'font-semibold text-tt' : ''}`}>
              <div>{weekdayShort(day, lang)}</div>
              <div className="mt-0.5">{dateLabel(day, lang)}</div>
            </div>
          ))}
        </div>

        {dated.map((task) => {
          const range = taskRange(task);
          if (!range.start || !range.end) return null;
          const start = Math.max(0, dayIndex(days[0], range.start));
          const end = Math.min(days.length - 1, dayIndex(days[0], range.end));
          if (start >= days.length || end < 0) return null;
          const left = `${(start / days.length) * 100}%`;
          const width = `${((Math.max(start, end) - start + 1) / days.length) * 100}%`;
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => selectTask(task.id)}
              className="grid min-h-[45px] w-full border-b border-line/70 text-left last:border-b-0 hover:bg-hover"
              style={{ gridTemplateColumns: columns }}
            >
              <span className="flex min-w-0 items-center gap-2 border-r border-line px-3 py-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${task.status === 2 ? 'bg-[#bdbdbd]' : 'bg-tt'}`} />
                <span className={`truncate text-[13px] ${task.status === 2 ? 'text-ink-3 line-through' : 'text-ink'}`}>{task.title || t('untitled')}</span>
              </span>
              <span className="relative col-start-2 block min-w-0" style={{ gridColumn: '2 / -1' }}>
                <span className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(64px, 1fr))` }}>
                  {days.map((day) => <span key={day} className="border-r border-line/50 last:border-r-0" />)}
                </span>
                <span
                  className={`absolute top-2 h-7 rounded-md px-2 text-[11px] leading-7 ${task.status === 2 ? 'bg-[#e6e6e6] text-ink-3 line-through' : 'bg-tt-light text-tt'}`}
                  style={{ left, width }}
                >
                  <span className="block truncate">{task.title || t('untitled')}</span>
                </span>
              </span>
            </button>
          );
        })}

        {undated.length > 0 && (
          <div className="border-t border-line">
            <div className="bg-[#fafafa] px-3 py-2 text-[12px] font-medium text-ink-3">
              {t('bucketNoDate')} · {undated.length}
            </div>
            {/* Undated tasks can't sit on the timeline; list them so they can be opened and scheduled. */}
            {undated.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => selectTask(task.id)}
                className="flex min-h-[40px] w-full items-center gap-2 border-t border-line/70 px-3 py-2 text-left hover:bg-hover"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${task.status === 2 ? 'bg-[#bdbdbd]' : 'bg-tt'}`} />
                <span className={`truncate text-[13px] ${task.status === 2 ? 'text-ink-3 line-through' : 'text-ink'}`}>
                  {task.title || t('untitled')}
                </span>
              </button>
            ))}
          </div>
        )}
        {tasks.length === 0 && <div className="px-4 py-12 text-center text-[13px] text-ink-3">{t('emptyNoTasks')}</div>}
      </div>
    </div>
  );
}
