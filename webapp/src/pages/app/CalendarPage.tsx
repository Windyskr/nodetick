import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useStore } from '../../stores/store';
import { useI18n, useT } from '../../i18n';
import type { Task } from '../../lib/types';
import { addDays, allDayDate, dayDistance, dayOf, daysInRange, moveDateToDay, timeOf, todayStr } from '../../components/taskSchedule';
import { RoundCheck } from '../../components/RoundCheck';

const WEEKDAYS: Record<string, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
};
const MONTHS: Record<string, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
};

const pad = (n: number) => String(n).padStart(2, '0');

function taskClock(task: Task): string {
  if (task.isAllDay) return '';
  const start = timeOf(task.startDate);
  const end = timeOf(task.dueDate);
  if (start && end) return `${start}–${end}`;
  return start ?? end ?? '';
}

/** 6x7 grid of day strings covering the month of (year, month0). */
function monthGrid(year: number, month0: number): string[] {
  const first = new Date(year, month0, 1);
  const start = new Date(year, month0, 1 - first.getDay());
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return cells;
}

/**
 * Month calendar (TickTick's #c/all/calendar/m): scheduled tasks occupy every
 * day in their start/end range, drag a card to another day to reschedule it,
 * and "+" in a cell quick-adds a dated task.
 */
export default function CalendarPage() {
  const { tasks, completed, createTask, saveTask, toggleComplete, selectTask, selectedTaskId } = useStore();
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const today = todayStr();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y, month0: m - 1 };
  });
  const [showCompleted, setShowCompleted] = useState(true);
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month0), [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    const push = (t: Task) => {
      for (const day of daysInRange(t.startDate, t.dueDate)) {
        const list = map.get(day) ?? [];
        list.push(t);
        map.set(day, list);
      }
    };
    for (const t of tasks) push(t);
    if (showCompleted) for (const t of completed) push(t);
    for (const list of map.values()) {
      list.sort((a, b) =>
        Number(a.status === 2) - Number(b.status === 2) ||
        (a.startDate ?? a.dueDate ?? '').localeCompare(b.startDate ?? b.dueDate ?? '') ||
        b.priority - a.priority);
    }
    return map;
  }, [tasks, completed, showCompleted]);

  const move = (taskId: string, day: string) => {
    const t = tasks.find((x) => x.id === taskId) ?? completed.find((x) => x.id === taskId);
    if (!t) return;
    const anchor = dayOf(t.startDate) ?? dayOf(t.dueDate);
    if (!anchor) return;
    const delta = dayDistance(anchor, day);
    if (delta == null || delta === 0) return;
    const patch: Record<string, unknown> = { projectId: t.projectId, isAllDay: t.isAllDay };
    if (t.startDate) {
      const startDay = dayOf(t.startDate);
      if (startDay) patch.startDate = moveDateToDay(t.startDate, addDays(startDay, delta), t.isAllDay);
    }
    if (t.dueDate) {
      const dueDay = dayOf(t.dueDate);
      if (dueDay) patch.dueDate = moveDateToDay(t.dueDate, addDays(dueDay, delta), t.isAllDay);
    }
    void saveTask(taskId, patch);
  };

  const addOn = async (day: string) => {
    const title = draft.trim();
    setAddingDay(null);
    setDraft('');
    if (!title) return;
    await createTask({ title, projectId: 'inbox', dueDate: allDayDate(day) });
  };

  const step = (delta: number) =>
    setCursor(({ year, month0 }) => {
      const m = month0 + delta;
      return { year: year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 };
    });

  const mini = monthGrid(cursor.year, cursor.month0).slice(0, 42);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-5 pb-1 pt-4">
        <h1 className="text-[20px] font-bold">
          {lang === 'zh' ? `${cursor.year}年${MONTHS.zh[cursor.month0]}` : `${MONTHS.en[cursor.month0]} ${cursor.year}`}
        </h1>
        <div className="flex items-center gap-1 text-ink-3">
          <button type="button" onClick={() => step(-1)} className="rounded-md p-1 hover:bg-hover hover:text-ink" title={lang === 'zh' ? '上个月' : 'Previous month'}>
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              const [y, m] = today.split('-').map(Number);
              setCursor({ year: y, month0: m - 1 });
            }}
            className="rounded-md px-2 py-0.5 text-[12px] hover:bg-hover hover:text-ink"
          >
            {t('relToday')}
          </button>
          <button type="button" onClick={() => step(1)} className="rounded-md p-1 hover:bg-hover hover:text-ink" title={lang === 'zh' ? '下个月' : 'Next month'}>
            <ChevronRight size={16} />
          </button>
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-3">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="accent-[#4772fa]"
          />
          {lang === 'zh' ? '显示已完成' : 'Show completed'}
        </label>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4 pt-2">
        {/* mini month picker */}
        <div className="hidden w-[180px] shrink-0 flex-col rounded-xl border border-line p-3 lg:flex">
          <div className="mb-2 text-center text-[13px] font-semibold">
            {lang === 'zh' ? `${cursor.year}年${cursor.month0 + 1}月` : `${MONTHS.en[cursor.month0].slice(0, 3)} ${cursor.year}`}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] text-ink-3">
            {(lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : WEEKDAYS.en.map((w) => w[0])).map((w, i) => (
              <span key={`${w}${i}`}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px]">
            {mini.map((day) => {
              const inMonth = Number(day.slice(5, 7)) === cursor.month0 + 1;
              const isToday = day === today;
              return (
                <span
                  key={day}
                  className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full ${
                    isToday ? 'bg-tt font-semibold text-white' : inMonth ? 'text-ink-2' : 'text-line'
                  }`}
                >
                  {Number(day.slice(8, 10))}
                </span>
              );
            })}
          </div>
          <div className="mt-auto text-[11px] leading-snug text-ink-3">
            {t('calendarDragHint')}
          </div>
        </div>

        {/* month grid */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-7 border-b border-line text-center text-[12px] font-medium text-ink-3">
            {WEEKDAYS[lang].map((w) => (
              <div key={w} className="py-1.5">{w}</div>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
            {grid.map((day) => {
              const inMonth = Number(day.slice(5, 7)) === cursor.month0 + 1;
              const isToday = day === today;
              const list = byDay.get(day) ?? [];
              const weekend = [0, 6].includes(new Date(day + 'T00:00:00').getDay());
              return (
                <div
                  key={day}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverDay(day);
                  }}
                  onDragLeave={() => setDragOverDay((cur) => (cur === day ? null : cur))}
                  onDrop={() => {
                    setDragOverDay(null);
                    if (dragTaskId) move(dragTaskId, day);
                    setDragTaskId(null);
                  }}
                  className={`group/day flex min-h-0 flex-col border-b border-r border-line/60 px-1.5 pb-1 pt-1 [&:nth-child(7n)]:border-r-0 ${
                    dragOverDay === day ? 'bg-tt-light/60' : !inMonth ? 'bg-[#fafafa]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] ${
                        isToday
                          ? 'bg-tt font-bold text-white'
                          : inMonth
                            ? weekend ? 'text-p-high/80' : 'text-ink-2'
                            : 'text-line'
                      }`}
                    >
                      {Number(day.slice(8, 10))}
                    </span>
                    {inMonth && (
                      <button
                        type="button"
                        title={t('addTask')}
                        className="text-ink-3 opacity-0 transition-opacity hover:text-tt group-hover/day:opacity-100"
                        onClick={() => {
                          setAddingDay(day);
                          setDraft('');
                        }}
                      >
                        <Plus size={12} />
                      </button>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 space-y-[3px] overflow-y-auto">
                    {list.slice(0, 4).map((t) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          setDragTaskId(t.id);
                        }}
                        onDragEnd={() => setDragTaskId(null)}
                        onClick={() => selectTask(t.id)}
                        className={`flex cursor-pointer items-center gap-1 rounded px-1 py-[2px] text-[11.5px] leading-tight ${
                          selectedTaskId === t.id
                            ? 'bg-selected'
                            : t.status === 2
                              ? 'text-ink-3 hover:bg-hover'
                              : 'text-ink hover:bg-hover'
                        }`}
                      >
                        <RoundCheck
                          checked={t.status === 2}
                          priority={t.priority}
                          size={12}
                          onClick={() => void toggleComplete(t)}
                        />
                        <span className={`min-w-0 flex-1 truncate ${t.status === 2 ? 'line-through' : ''}`}>{t.title}</span>
                        {taskClock(t) && <span className="shrink-0 text-[10px] text-ink-3">{taskClock(t)}</span>}
                      </div>
                    ))}
                    {list.length > 4 && (
                      <div className="px-1 text-[10.5px] text-ink-3">{t('moreCount').replace('{0}', String(list.length - 4))}</div>
                    )}
                    {addingDay === day && (
                      <input
                        autoFocus
                        value={draft}
                        placeholder={t('taskTitlePh')}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => void addOn(day)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void addOn(day);
                          if (e.key === 'Escape') {
                            setAddingDay(null);
                            setDraft('');
                          }
                        }}
                        className="w-full rounded border border-tt px-1 py-[2px] text-[11.5px]"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
