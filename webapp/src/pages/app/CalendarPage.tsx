import { useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, MoreHorizontal, PanelLeft, Plus } from 'lucide-react';
import { useStore } from '../../stores/store';
import { useI18n, useT } from '../../i18n';
import type { Task } from '../../lib/types';
import { addDays, allDayDate, dayDistance, dayOf, daysInRange, moveDateToDay, timeOf, todayStr } from '../../components/taskSchedule';
import { RoundCheck } from '../../components/RoundCheck';
import { MenuItem, Popover } from '../../components/Popover';
import { isSubmitEnter } from '../../lib/keys';

const WEEKDAYS: Record<string, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
};
const MONTHS: Record<string, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
};
const YEAR_MONTHS_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

const pad = (n: number) => String(n).padStart(2, '0');
const CALENDAR_VIEWS = ['year', 'month', 'week', 'day', 'schedule', 'multiDay', 'multiWeek'] as const;
type CalendarView = (typeof CALENDAR_VIEWS)[number];
const CALENDAR_VIEW_LABELS: Record<CalendarView, { en: string; zh: string }> = {
  year: { en: 'Year view', zh: '年视图' },
  month: { en: 'Month view', zh: '月视图' },
  week: { en: 'Week view', zh: '周视图' },
  day: { en: 'Day view', zh: '日视图' },
  schedule: { en: 'Schedule view', zh: '日程视图' },
  multiDay: { en: 'Multi-day view', zh: '多日视图' },
  multiWeek: { en: 'Multi-week view', zh: '多周视图' },
};
const PROJECT_COLORS = ['#4772fa', '#2e9b72', '#d06a8a', '#8b63d9', '#d3b52b', '#e07850', '#4ba8c4'];

function fallbackProjectColor(projectId: string): string {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

function taskClock(task: Task, separator = '–'): string {
  if (task.isAllDay) return '';
  const start = timeOf(task.startDate);
  const end = timeOf(task.dueDate);
  if (start && end) return `${start}${separator}${end}`;
  return start ?? end ?? '';
}

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

function cursorFor(day: string): { year: number; month0: number } {
  return { year: Number(day.slice(0, 4)), month0: Number(day.slice(5, 7)) - 1 };
}

function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00`).getDay();
}

function startOfWeek(day: string): string {
  return addDays(day, -weekdayOf(day));
}

function dayNumber(day: string): number {
  return Number(day.slice(8, 10));
}

function lunarDayLabel(day: string): string {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { day: 'numeric' }).formatToParts(new Date(`${day}T00:00:00`));
    const value = Number(parts.find((part) => part.type === 'day')?.value);
    if (!Number.isInteger(value) || value < 1 || value > 30) return '';
    if (value === 10) return '初十';
    if (value === 20) return '二十';
    if (value === 30) return '三十';
    const ones = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (value < 10) return `初${ones[value]}`;
    if (value < 20) return `十${ones[value - 10]}`;
    return `廿${ones[value - 20]}`;
  } catch {
    return '';
  }
}

function shiftYear(day: string, delta: number): string {
  const year = Number(day.slice(0, 4)) + delta;
  const month0 = Number(day.slice(5, 7)) - 1;
  const date = Number(day.slice(8, 10));
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return `${year}-${pad(month0 + 1)}-${pad(Math.min(date, lastDay))}`;
}

function timeMinutes(value: string | null): number | null {
  const clock = timeOf(value);
  if (!clock) return null;
  const [hour, minute] = clock.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return hour * 60 + minute;
}

function isTimed(task: Task): boolean {
  return !task.isAllDay && (timeMinutes(task.startDate) !== null || timeMinutes(task.dueDate) !== null);
}

function taskDurationMinutes(task: Task): number {
  const start = timeMinutes(task.startDate);
  const end = timeMinutes(task.dueDate);
  if (start !== null && end !== null && end > start && dayOf(task.startDate) === dayOf(task.dueDate)) return end - start;
  return 45;
}

function CalendarTask({
  task,
  selected,
  compact = false,
  variant = 'list',
  showClock = true,
  accent,
  style,
  onSelect,
  onToggle,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  selected: boolean;
  compact?: boolean;
  variant?: 'list' | 'event' | 'agenda';
  showClock?: boolean;
  accent?: string;
  style?: CSSProperties;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const event = variant === 'event';
  const agenda = variant === 'agenda';
  const agendaAccent = agenda && accent ? `color-mix(in srgb, ${accent} 78%, var(--nt-surface))` : accent;
  const tintedStyle = !selected && accent
    ? { backgroundColor: `color-mix(in srgb, ${accent} ${event ? 30 : agenda ? 8 : 16}%, transparent)`, borderLeft: `${event || agenda ? 4 : 2}px solid ${agendaAccent}`, color: event ? `color-mix(in srgb, ${accent} 45%, var(--color-ink))` : undefined, ...style }
    : style;
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(task.id)}
      style={tintedStyle}
      className={`${event ? 'block overflow-hidden rounded-[4px] px-2 py-1' : agenda ? 'flex min-h-[60px] flex-col items-stretch gap-0 overflow-hidden rounded-[6px] px-[14px] pt-[10px] pb-[10px]' : `flex items-center gap-1 rounded px-1 ${compact ? 'py-[2px] text-[11.5px]' : 'py-1 text-[12px]'}`} cursor-pointer ${
        selected
          ? 'bg-selected'
          : task.status === 2
            ? 'text-ink-3 hover:bg-hover'
            : 'text-ink hover:bg-hover'
      }`}
    >
      {!event && !agenda && <RoundCheck checked={task.status === 2} priority={task.priority} size={compact ? 12 : 14} onClick={() => onToggle(task)} />}
      {event ? (
        <>
          <span className={`block max-w-full overflow-hidden text-clip break-words text-[12px] font-medium leading-4 ${task.status === 2 ? 'line-through' : ''}`}>{task.title}</span>
          {showClock && taskClock(task, '-') && <span className="block h-[14px] max-w-full overflow-hidden text-clip text-[10px] leading-[14px]" style={{ color: accent ? `color-mix(in srgb, ${accent} 60%, transparent)` : undefined }}>{taskClock(task, '-')}</span>}
        </>
      ) : agenda ? (
        <>
          {showClock && taskClock(task, ' - ') && <span className="block max-w-full truncate text-[13px] leading-[18px] text-tt">{taskClock(task, ' - ')}</span>}
          <span className={`block max-w-full overflow-hidden break-words text-[14px] font-medium leading-5 ${task.status === 2 ? 'line-through text-ink-3' : ''}`}>{task.title}</span>
        </>
      ) : (
        <>
          <span className={`min-w-0 flex-1 truncate ${task.status === 2 ? 'line-through' : ''}`}>{task.title}</span>
          {showClock && taskClock(task) && <span className="shrink-0 text-[10px] text-ink-3">{taskClock(task)}</span>}
        </>
      )}
    </div>
  );
}

function AgendaTask({
  task,
  selected,
  isLast,
  accent,
  onSelect,
  onToggle,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  selected: boolean;
  isLast: boolean;
  accent: string;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const start = timeOf(task.startDate) ?? timeOf(task.dueDate);
  return (
    <div className={`relative ${isLast ? '' : 'mb-6'}`}>
      {!isLast && <span className="pointer-events-none absolute bottom-[-34px] left-[-35px] top-[31px] w-px bg-line" />}
      <div className="absolute left-[-46px] top-[9px] z-10">
        <RoundCheck checked={task.status === 2} priority={task.priority} size={22} onClick={() => onToggle(task)} />
      </div>
      {start && <span className="absolute left-[-100px] top-3 text-[13px] leading-4 tabular-nums text-ink-3">{start}</span>}
      <CalendarTask
        task={task}
        selected={selected}
        variant="agenda"
        accent={accent}
        onSelect={onSelect}
        onToggle={onToggle}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    </div>
  );
}

function TimeGrid({
  days,
  byDay,
  today,
  lang,
  selectedTaskId,
  onSelect,
  onToggle,
  onDragStart,
  onDragEnd,
  taskAccent,
  dragOverDay,
  onDragOver,
  onDrop,
}: {
  days: string[];
  byDay: Map<string, Task[]>;
  today: string;
  lang: string;
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  taskAccent: (task: Task) => string;
  dragOverDay: string | null;
  onDragOver: (day: string) => void;
  onDrop: (day: string, event: DragEvent<HTMLElement>) => void;
}) {
  const startHour = 6;
  const endHour = 22;
  const hourHeight = 52;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const height = (endHour - startHour) * hourHeight;
  const columns = `52px repeat(${days.length}, minmax(132px, 1fr))`;

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line">
      <div className="grid min-w-[980px]" style={{ gridTemplateColumns: columns }}>
        <div className="sticky top-0 z-10 h-11 border-b border-line bg-white" />
        {days.map((day) => {
          const isToday = day === today;
          return (
            <div key={day} className={`sticky top-0 z-10 h-11 border-b border-l border-line bg-white px-2 py-1.5 text-center text-[11px] ${isToday ? 'text-tt' : 'text-ink-3'}`}>
              <div>{WEEKDAYS[lang][weekdayOf(day)]}</div>
              <div className={`mx-auto mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-semibold ${isToday ? 'bg-tt text-white' : 'text-ink-2'}`}>
                {dayNumber(day)}
              </div>
            </div>
          );
        })}

        <div className="relative border-r border-line bg-white" style={{ height }}>
          {hours.slice(0, -1).map((hour, index) => (
            <span key={hour} className="absolute left-0 right-0 border-t border-line/60" style={{ top: index * hourHeight }}>
              <span className="absolute -top-2 right-1 text-[10px] tabular-nums text-ink-3">{pad(hour)}:00</span>
            </span>
          ))}
          <span className="absolute bottom-0 right-1 text-[10px] tabular-nums text-ink-3">{pad(endHour)}:00</span>
        </div>
        {days.map((day) => {
          const timed = (byDay.get(day) ?? []).filter(isTimed);
          return (
            <div
              key={day}
              onDragOver={(event) => {
                event.preventDefault();
                onDragOver(day);
              }}
              onDrop={(event) => onDrop(day, event)}
              className={`relative border-l border-line ${dragOverDay === day ? 'bg-tt-light/50' : ''}`}
              style={{ height }}
            >
              {hours.slice(0, -1).map((hour, index) => (
                <span key={hour} className="pointer-events-none absolute left-0 right-0 border-t border-line/60" style={{ top: index * hourHeight }} />
              ))}
              {timed.map((task) => {
                const minutes = timeMinutes(task.startDate) ?? timeMinutes(task.dueDate) ?? startHour * 60;
                const top = Math.max(2, Math.min(height - 30, ((minutes - startHour * 60) / 60) * hourHeight + 2));
                const taskHeight = Math.max(30, Math.min(124, (taskDurationMinutes(task) / 60) * hourHeight - 4));
                return (
                  <CalendarTask
                    key={task.id}
                    task={task}
                    selected={selectedTaskId === task.id}
                    variant="event"
                    accent={taskAccent(task)}
                    style={{ position: 'absolute', left: 4, right: 4, top, minHeight: taskHeight, alignItems: 'flex-start' }}
                    onSelect={onSelect}
                    onToggle={onToggle}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AllDayGrid({
  days,
  byDay,
  selectedTaskId,
  allDayLabel,
  addTaskLabel,
  addingDay,
  quickAdd,
  onSelect,
  onToggle,
  onDragStart,
  onDragEnd,
  taskAccent,
  dragOverDay,
  onDragOver,
  onDrop,
  onAdd,
}: {
  days: string[];
  byDay: Map<string, Task[]>;
  selectedTaskId: string | null;
  allDayLabel: string;
  addTaskLabel: string;
  addingDay: string | null;
  quickAdd: (day: string) => ReactNode;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  taskAccent: (task: Task) => string;
  dragOverDay: string | null;
  onDragOver: (day: string) => void;
  onDrop: (day: string, event: DragEvent<HTMLElement>) => void;
  onAdd: (day: string) => void;
}) {
  const columns = `72px repeat(${days.length}, minmax(132px, 1fr))`;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <div className="grid min-w-[980px]" style={{ gridTemplateColumns: columns }}>
        <div className="border-b border-line px-2 py-2 text-[11px] text-ink-3">{allDayLabel}</div>
        {days.map((day) => (
          <div
            key={day}
            onDragOver={(event) => {
              event.preventDefault();
              onDragOver(day);
            }}
            onDrop={(event) => onDrop(day, event)}
            className={`group/day min-h-[58px] border-b border-l border-line px-1.5 py-1 ${dragOverDay === day ? 'bg-tt-light/50' : ''}`}
          >
            {(byDay.get(day) ?? []).filter((task) => !isTimed(task)).map((task) => (
              <CalendarTask
                key={task.id}
                task={task}
                selected={selectedTaskId === task.id}
                compact
                accent={taskAccent(task)}
                onSelect={onSelect}
                onToggle={onToggle}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
            {addingDay === day ? quickAdd(day) : (
              <button type="button" title={addTaskLabel} onClick={() => onAdd(day)} className="mt-1 flex h-5 w-5 items-center justify-center rounded text-ink-3 opacity-0 hover:bg-hover hover:text-tt group-hover/day:opacity-100">
                <Plus size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgendaView({
  days,
  byDay,
  today,
  lang,
  selectedTaskId,
  allDayLabel,
  noTasksLabel,
  addTaskLabel,
  addingDay,
  quickAdd,
  taskAccent,
  onSelect,
  onToggle,
  onDragStart,
  onDragEnd,
  dragOverDay,
  onDragOver,
  onDrop,
  onAdd,
}: {
  days: string[];
  byDay: Map<string, Task[]>;
  today: string;
  lang: string;
  selectedTaskId: string | null;
  allDayLabel: string;
  noTasksLabel: string;
  addTaskLabel: string;
  addingDay: string | null;
  quickAdd: (day: string) => ReactNode;
  taskAccent: (task: Task) => string;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  dragOverDay: string | null;
  onDragOver: (day: string) => void;
  onDrop: (day: string, event: DragEvent<HTMLElement>) => void;
  onAdd: (day: string) => void;
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-2xl border border-line">
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const allDay = list.filter((task) => !isTimed(task));
          const timed = list.filter(isTimed);
          return (
            <section
              key={day}
              onDragOver={(event) => {
                event.preventDefault();
                onDragOver(day);
              }}
              onDrop={(event) => onDrop(day, event)}
              className={`group min-h-[120px] border-b border-line/70 last:border-b-0 ${dragOverDay === day ? 'bg-tt-light/40' : ''}`}
            >
              <div className="relative flex min-w-[760px] flex-col pl-[230px] pr-4 pt-6 pb-9">
                <div className="relative -mt-[9px] flex min-w-0 flex-col pl-[100px] pt-[9px]">
                  <div className={`absolute left-[-130px] top-1 flex items-start ${day === today ? 'text-tt' : 'text-ink-2'}`}>
                    <span className="mr-2 text-[24px] font-bold leading-[30px]">{dayNumber(day)}</span>
                    <span className={`flex flex-col text-[12px] font-medium leading-4 ${day === today ? 'text-tt/80' : 'text-ink-3'}`}>
                      <span>{WEEKDAYS[lang][weekdayOf(day)]}</span>
                      {lang === 'zh' && <span className="origin-left scale-[.92]">{lunarDayLabel(day)}</span>}
                    </span>
                  </div>

                  {allDay.length > 0 && (
                    <div className="mb-6">
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">{allDayLabel}</div>
                      <div className="space-y-1">
                        {allDay.map((task) => (
                          <CalendarTask
                            key={task.id}
                            task={task}
                            selected={selectedTaskId === task.id}
                            compact
                            showClock={false}
                            accent={taskAccent(task)}
                            onSelect={onSelect}
                            onToggle={onToggle}
                            onDragStart={onDragStart}
                            onDragEnd={onDragEnd}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {timed.length > 0 ? timed.map((task, index) => (
                    <AgendaTask
                      key={task.id}
                      task={task}
                      selected={selectedTaskId === task.id}
                      isLast={index === timed.length - 1}
                      accent={taskAccent(task)}
                      onSelect={onSelect}
                      onToggle={onToggle}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                    />
                  )) : list.length === 0 ? (
                    <div className="py-1 text-[14px] text-ink-3">{noTasksLabel}</div>
                  ) : null}

                  {addingDay === day ? quickAdd(day) : (
                    <button type="button" title={addTaskLabel} onClick={() => onAdd(day)} className="absolute right-4 top-6 flex h-5 w-5 items-center justify-center rounded text-ink-3 opacity-0 hover:bg-hover hover:text-tt group-hover:opacity-100">
                      <Plus size={12} />
                    </button>
                  )}
                </div>
              </div>
            </section>
          );
        })}
    </div>
  );
}

function MultiWeekView({
  days,
  byDay,
  today,
  lang,
  selectedTaskId,
  addTaskLabel,
  addingDay,
  quickAdd,
  taskAccent,
  onSelect,
  onToggle,
  onDragStart,
  onDragEnd,
  dragOverDay,
  onDragOver,
  onDrop,
  onAdd,
}: {
  days: string[];
  byDay: Map<string, Task[]>;
  today: string;
  lang: string;
  addTaskLabel: string;
  selectedTaskId: string | null;
  addingDay: string | null;
  quickAdd: (day: string) => ReactNode;
  taskAccent: (task: Task) => string;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  dragOverDay: string | null;
  onDragOver: (day: string) => void;
  onDrop: (day: string, event: DragEvent<HTMLElement>) => void;
  onAdd: (day: string) => void;
}) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-line">
      <div className="flex h-full min-h-[480px] min-w-[760px] flex-col">
        <div className="grid grid-cols-7 border-b border-line text-center text-[12px] font-medium text-ink-3">
          {WEEKDAYS[lang].map((weekday) => <div key={weekday} className="py-2">{weekday}</div>)}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-2">
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const isToday = day === today;
            return (
              <div
                key={day}
                onDragOver={(event) => {
                  event.preventDefault();
                  onDragOver(day);
                }}
                onDragLeave={() => onDragOver('')}
                onDrop={(event) => onDrop(day, event)}
                className={`group/day min-h-[220px] border-b border-r border-line/70 px-1.5 pb-1.5 pt-1.5 [&:nth-child(7n)]:border-r-0 ${dragOverDay === day ? 'bg-tt-light/60' : ''}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] ${isToday ? 'bg-tt font-bold text-white' : 'text-ink-2'}`}>{dayNumber(day)}</span>
                  <button type="button" title={addTaskLabel} onClick={() => onAdd(day)} className="text-ink-3 opacity-0 transition-opacity hover:text-tt group-hover/day:opacity-100"><Plus size={12} /></button>
                </div>
                <div className="space-y-1">
                  {list.slice(0, 8).map((task) => (
                    <CalendarTask
                      key={task.id}
                      task={task}
                      selected={selectedTaskId === task.id}
                      compact
                      accent={taskAccent(task)}
                      onSelect={onSelect}
                      onToggle={onToggle}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                    />
                  ))}
                  {list.length > 8 && <div className="px-1 text-[10.5px] text-ink-3">+{list.length - 8}</div>}
                  {addingDay === day && quickAdd(day)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** TickTick-style calendar with month, week, day, agenda and multi-day views. */
export default function CalendarPage() {
  const { projects, tasks, completed, createTask, saveTask, toggleComplete, selectTask, selectedTaskId } = useStore();
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const today = todayStr();
  const [cursor, setCursor] = useState(() => cursorFor(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const [view, setView] = useState<CalendarView>('month');
  const [showCompleted, setShowCompleted] = useState(true);
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [showMiniCalendar, setShowMiniCalendar] = useState(true);

  const projectColors = useMemo(() => {
    const colors = new Map<string, string>();
    projects.forEach((project, index) => colors.set(project.id, project.color || PROJECT_COLORS[index % PROJECT_COLORS.length]));
    return colors;
  }, [projects]);
  const taskAccent = (task: Task) => projectColors.get(task.projectId) ?? fallbackProjectColor(task.projectId);

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month0), [cursor]);
  const mini = grid;
  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDay);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [selectedDay]);
  const multiDayDays = useMemo(() => Array.from({ length: 3 }, (_, index) => addDays(selectedDay, index)), [selectedDay]);
  const multiWeekDays = useMemo(() => Array.from({ length: 14 }, (_, index) => addDays(startOfWeek(selectedDay), index)), [selectedDay]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    const push = (task: Task) => {
      for (const day of daysInRange(task.startDate, task.dueDate)) {
        const list = map.get(day) ?? [];
        list.push(task);
        map.set(day, list);
      }
    };
    for (const task of tasks) push(task);
    if (showCompleted) for (const task of completed) push(task);
    for (const list of map.values()) {
      list.sort((a, b) =>
        Number(a.status === 2) - Number(b.status === 2) ||
        (a.startDate ?? a.dueDate ?? '').localeCompare(b.startDate ?? b.dueDate ?? '') ||
        b.priority - a.priority,
      );
    }
    return map;
  }, [tasks, completed, showCompleted]);

  const chooseDay = (day: string) => {
    setSelectedDay(day);
    setCursor(cursorFor(day));
  };

  const move = (taskId: string, day: string) => {
    const task = tasks.find((item) => item.id === taskId) ?? completed.find((item) => item.id === taskId);
    if (!task) return;
    const anchor = dayOf(task.startDate) ?? dayOf(task.dueDate);
    if (!anchor) return;
    const delta = dayDistance(anchor, day);
    if (delta == null || delta === 0) return;
    const patch: Record<string, unknown> = { projectId: task.projectId, isAllDay: task.isAllDay };
    if (task.startDate) {
      const startDay = dayOf(task.startDate);
      if (startDay) patch.startDate = moveDateToDay(task.startDate, addDays(startDay, delta), task.isAllDay);
    }
    if (task.dueDate) {
      const dueDay = dayOf(task.dueDate);
      if (dueDay) patch.dueDate = moveDateToDay(task.dueDate, addDays(dueDay, delta), task.isAllDay);
    }
    void saveTask(taskId, patch);
  };

  const dropOn = (day: string, event?: DragEvent<HTMLElement>) => {
    event?.preventDefault();
    setDragOverDay(null);
    const taskId = dragTaskId ?? event?.dataTransfer.getData('text/plain') ?? null;
    if (taskId) move(taskId, day);
    setDragTaskId(null);
  };

  const addOn = async (day: string) => {
    const title = draft.trim();
    setAddingDay(null);
    setDraft('');
    if (!title) return;
    await createTask({ title, projectId: 'inbox', dueDate: allDayDate(day) });
  };

  const quickAdd = (day: string) => (
    <input
      autoFocus
      value={draft}
      placeholder={t('taskTitlePh')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void addOn(day)}
      onKeyDown={(event) => {
        if (isSubmitEnter(event)) void addOn(day);
        if (event.key === 'Escape') {
          setAddingDay(null);
          setDraft('');
        }
      }}
      className="w-full rounded border border-tt px-1 py-[2px] text-[11.5px]"
    />
  );

  const step = (delta: number) => {
    if (view === 'month') {
      setCursor(({ year, month0 }) => {
        const month = month0 + delta;
        const next = { year: year + Math.floor(month / 12), month0: ((month % 12) + 12) % 12 };
        const nextDay = `${next.year}-${pad(next.month0 + 1)}-01`;
        setSelectedDay(nextDay);
        return next;
      });
      return;
    }
    if (view === 'year') {
      setCursor((current) => ({ year: current.year + delta, month0: current.month0 }));
      setSelectedDay((day) => shiftYear(day, delta));
      return;
    }
    const distance = view === 'week' || view === 'schedule' ? 7 : view === 'multiDay' ? 3 : view === 'multiWeek' ? 14 : 1;
    const nextDay = addDays(selectedDay, delta * distance);
    chooseDay(nextDay);
  };

  const goToday = () => {
    setSelectedDay(today);
    setCursor(cursorFor(today));
  };

  const headerTitle = view === 'year'
    ? lang === 'zh' ? `${cursor.year}年` : String(cursor.year)
    : lang === 'zh' ? `${Number(selectedDay.slice(5, 7))}月` : MONTHS.en[Number(selectedDay.slice(5, 7)) - 1].slice(0, 3);

  const miniWeekdays = lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : WEEKDAYS.en.map((weekday) => weekday[0]);
  const viewOptions = CALENDAR_VIEWS.map((value) => ({
    value,
    label: value === 'year' ? t('calendarYear') : value === 'month' ? t('calendarMonth') : value === 'week' ? t('calendarWeek') : value === 'day' ? t('calendarDay') : value === 'schedule' ? t('calendarSchedule') : value === 'multiDay' ? t('calendarMultiDay') : t('calendarMultiWeek'),
  }));
  const rangedDays = view === 'week' ? weekDays : view === 'multiDay' ? multiDayDays : [selectedDay];
  const addFromHeader = () => {
    const title = window.prompt(t('taskTitlePh'))?.trim();
    if (title) void createTask({ title, projectId: 'inbox', dueDate: allDayDate(selectedDay) });
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <div className="flex min-h-16 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMiniCalendar((current) => !current)}
            title={t('calendarToggleMiniCalendar')}
            aria-label={t('calendarToggleMiniCalendar')}
            aria-pressed={showMiniCalendar}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink ${showMiniCalendar ? 'bg-hover' : ''}`}
          >
            <PanelLeft size={20} strokeWidth={1.8} />
          </button>
          <h1 className="truncate text-[20px] font-bold">{headerTitle}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={addFromHeader} title={t('addTask')} aria-label={t('addTask')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line text-ink-2 hover:bg-hover hover:text-tt">
            <Plus size={18} />
          </button>
          <select
            value={view}
            aria-label={t('calendarViewOptions')}
            onChange={(event) => setView(event.target.value as CalendarView)}
            className="h-9 rounded-xl border border-line bg-white px-3 text-[13px] font-medium text-ink-2"
          >
            {viewOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <div className="flex h-9 items-center overflow-hidden rounded-xl border border-line text-ink-2">
            <button type="button" onClick={() => step(-1)} className="flex h-full w-9 items-center justify-center border-r border-line hover:bg-hover hover:text-ink" title={t('calendarPrevious')} aria-label={t('calendarPrevious')}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={goToday} className="h-full min-w-[58px] border-r border-line px-2 text-[13px] hover:bg-hover hover:text-ink">
              {t('calendarToday')}
            </button>
            <button type="button" onClick={() => step(1)} className="flex h-full w-9 items-center justify-center hover:bg-hover hover:text-ink" title={t('calendarNext')} aria-label={t('calendarNext')}>
              <ChevronRight size={16} />
            </button>
          </div>
          <Popover align="right" panelClass="w-48" trigger={(open, toggle) => (
            <button type="button" onClick={toggle} title={t('calendarMore')} aria-label={t('calendarMore')} className={`flex h-9 w-9 items-center justify-center rounded-xl text-ink-2 hover:bg-hover hover:text-ink ${open ? 'bg-hover' : ''}`}>
              <MoreHorizontal size={19} />
            </button>
          )}>
            {(close) => (
              <MenuItem
                icon={showCompleted ? <Eye size={15} /> : <EyeOff size={15} />}
                label={showCompleted ? t('hideCompleted') : t('showCompleted')}
                onClick={() => {
                  close();
                  setShowCompleted((current) => !current);
                }}
              />
            )}
          </Popover>
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 ${view === 'year' ? 'gap-0 px-0 pb-0 pt-0' : 'gap-3 px-4 pb-4 pt-2'}`}>
        {showMiniCalendar && view !== 'year' && <div className="hidden w-[180px] shrink-0 flex-col rounded-xl border border-line p-3 lg:flex">
          <div className="mb-2 text-center text-[13px] font-semibold">
            {lang === 'zh' ? `${cursor.year}年${cursor.month0 + 1}月` : `${MONTHS.en[cursor.month0].slice(0, 3)} ${cursor.year}`}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] text-ink-3">
            {miniWeekdays.map((weekday, index) => <span key={`${weekday}${index}`}>{weekday}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px]">
            {mini.map((day) => {
              const inMonth = Number(day.slice(5, 7)) === cursor.month0 + 1;
              const isToday = day === today;
              const isSelected = day === selectedDay;
              return (
                <button
                  key={day}
                  type="button"
                  title={day}
                  onClick={() => chooseDay(day)}
                  className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full ${
                    isToday ? 'bg-tt font-semibold text-white' : isSelected ? 'bg-tt-light font-semibold text-tt' : inMonth ? 'text-ink-2 hover:bg-hover' : 'text-line'
                  }`}
                >
                  {dayNumber(day)}
                </button>
              );
            })}
          </div>
          <div className="mt-auto text-[11px] leading-snug text-ink-3">
            {t('calendarDragHint')}
          </div>
        </div>}

        {view === 'month' && (
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-7 border-b border-line text-center text-[12px] font-medium text-ink-3">
              {WEEKDAYS[lang].map((weekday) => <div key={weekday} className="py-1.5">{weekday}</div>)}
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
              {grid.map((day) => {
                const inMonth = Number(day.slice(5, 7)) === cursor.month0 + 1;
                const isToday = day === today;
                const list = byDay.get(day) ?? [];
                const weekend = [0, 6].includes(weekdayOf(day));
                return (
                  <div
                    key={day}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverDay(day);
                    }}
                    onDragLeave={() => setDragOverDay((current) => current === day ? null : current)}
                    onDrop={(event) => dropOn(day, event)}
                    className={`group/day flex min-h-0 flex-col border-b border-r border-line/60 px-1.5 pb-1 pt-1 [&:nth-child(7n)]:border-r-0 ${dragOverDay === day ? 'bg-tt-light/60' : !inMonth ? 'bg-[#fafafa]' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => chooseDay(day)}
                        className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] ${
                          isToday ? 'bg-tt font-bold text-white' : inMonth ? weekend ? 'text-p-high/80' : 'text-ink-2' : 'text-line'
                        }`}
                      >
                        {dayNumber(day)}
                      </button>
                      {inMonth && (
                        <button type="button" title={t('addTask')} className="text-ink-3 opacity-0 transition-opacity hover:text-tt group-hover/day:opacity-100" onClick={() => { setAddingDay(day); setDraft(''); }}>
                          <Plus size={12} />
                        </button>
                      )}
                    </div>
                    <div className="min-h-0 flex-1 space-y-[3px] overflow-y-auto">
                      {list.slice(0, 4).map((task) => (
                        <CalendarTask
                          key={task.id}
                          task={task}
                          selected={selectedTaskId === task.id}
                          compact
                          accent={taskAccent(task)}
                          onSelect={selectTask}
                          onToggle={(item) => void toggleComplete(item)}
                          onDragStart={setDragTaskId}
                          onDragEnd={() => setDragTaskId(null)}
                        />
                      ))}
                      {list.length > 4 && <div className="px-1 text-[10.5px] text-ink-3">{t('moreCount').replace('{0}', String(list.length - 4))}</div>}
                      {addingDay === day && quickAdd(day)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(view === 'week' || view === 'day' || view === 'multiDay') && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <AllDayGrid
              days={rangedDays}
              byDay={byDay}
              selectedTaskId={selectedTaskId}
              allDayLabel={t('allDay')}
              addTaskLabel={t('addTask')}
              addingDay={addingDay}
              quickAdd={quickAdd}
              onSelect={selectTask}
              onToggle={(task) => void toggleComplete(task)}
              onDragStart={setDragTaskId}
              onDragEnd={() => setDragTaskId(null)}
              taskAccent={taskAccent}
              dragOverDay={dragOverDay}
              onDragOver={setDragOverDay}
              onDrop={dropOn}
              onAdd={(day) => { setAddingDay(day); setDraft(''); }}
            />
            <TimeGrid
              days={rangedDays}
              byDay={byDay}
              today={today}
              lang={lang}
              selectedTaskId={selectedTaskId}
              onSelect={selectTask}
              onToggle={(task) => void toggleComplete(task)}
              onDragStart={setDragTaskId}
              onDragEnd={() => setDragTaskId(null)}
              taskAccent={taskAccent}
              dragOverDay={dragOverDay}
              onDragOver={setDragOverDay}
              onDrop={dropOn}
            />
          </div>
        )}

        {view === 'schedule' && (
          <AgendaView
            days={weekDays}
            byDay={byDay}
            today={today}
            lang={lang}
            selectedTaskId={selectedTaskId}
            allDayLabel={t('allDay')}
            noTasksLabel={t('calendarNoTasks')}
            addTaskLabel={t('addTask')}
            addingDay={addingDay}
            quickAdd={quickAdd}
            taskAccent={taskAccent}
            onSelect={selectTask}
            onToggle={(task) => void toggleComplete(task)}
            onDragStart={setDragTaskId}
            onDragEnd={() => setDragTaskId(null)}
            dragOverDay={dragOverDay}
            onDragOver={setDragOverDay}
            onDrop={dropOn}
            onAdd={(day) => { setAddingDay(day); setDraft(''); }}
          />
        )}

        {view === 'multiWeek' && (
          <MultiWeekView
            days={multiWeekDays}
            byDay={byDay}
            today={today}
            lang={lang}
            selectedTaskId={selectedTaskId}
            addTaskLabel={t('addTask')}
            addingDay={addingDay}
            quickAdd={quickAdd}
            taskAccent={taskAccent}
            onSelect={selectTask}
            onToggle={(task) => void toggleComplete(task)}
            onDragStart={setDragTaskId}
            onDragEnd={() => setDragTaskId(null)}
            dragOverDay={dragOverDay}
            onDragOver={setDragOverDay}
            onDrop={dropOn}
            onAdd={(day) => { setAddingDay(day); setDraft(''); }}
          />
        )}

        {view === 'year' && (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pb-28 pt-0 sm:px-8 xl:px-11">
            <div className="grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-11">
              {Array.from({ length: 12 }, (_, month0) => {
                const days = monthGrid(cursor.year, month0);
                const monthPrefix = `${cursor.year}-${pad(month0 + 1)}`;
                const count = days.reduce((total, day) => total + (day.startsWith(monthPrefix) ? byDay.get(day)?.length ?? 0 : 0), 0);
                return (
                  <button
                    key={month0}
                    type="button"
                    onClick={() => {
                      setCursor({ year: cursor.year, month0 });
                      setSelectedDay(`${cursor.year}-${pad(month0 + 1)}-01`);
                      setView('month');
                    }}
                    className="group min-w-0 text-left"
                  >
                    <div className="flex h-[34px] items-center justify-between px-3 text-[22px] font-medium leading-[26px]">
                      <span>{lang === 'zh' ? YEAR_MONTHS_ZH[month0] : MONTHS.en[month0]}</span>
                      {count > 0 && <span className="text-[12px] font-normal text-ink-3">{count}</span>}
                    </div>
                    <div className="mt-3 grid grid-cols-7 grid-rows-[42px_repeat(6,32px)] text-center">
                      <div className="col-span-7 grid grid-cols-7 text-[15px] text-ink-3">
                        {(lang === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : WEEKDAYS.en.map((weekday) => weekday[0])).map((weekday, index) => <span key={`${weekday}${index}`} className="flex items-center justify-center">{weekday}</span>)}
                      </div>
                      {days.map((day) => {
                        const inMonth = Number(day.slice(5, 7)) === month0 + 1;
                        const taskCount = inMonth ? (byDay.get(day)?.length ?? 0) : 0;
                        const intensity = Math.min(taskCount, 4);
                        const heatStyle = intensity > 0 && day !== today
                          ? { backgroundColor: `color-mix(in srgb, var(--color-tt) ${10 + intensity * 9}%, transparent)` }
                          : undefined;
                        return (
                          <span key={day} style={heatStyle} className={`relative flex h-8 items-center justify-center text-[15px] ${day === today ? 'mx-auto w-8 rounded-full bg-tt font-semibold text-white' : inMonth ? 'text-ink-2' : 'text-line'}`}>
                            {dayNumber(day)}
                          </span>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2">
        <div className="pointer-events-auto flex h-12 items-center gap-0.5 rounded-full bg-[#777] p-1.5 text-white shadow-[0_2px_8px_rgba(0,0,0,0.24)]">
          {CALENDAR_VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={`h-9 rounded-full px-3 text-[13px] whitespace-nowrap transition-colors ${view === value ? 'bg-white/20 font-medium' : 'hover:bg-white/10'}`}
            >
              {CALENDAR_VIEW_LABELS[value][lang]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
