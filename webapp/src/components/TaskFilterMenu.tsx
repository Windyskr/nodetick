import type { ReactNode } from 'react';
import { Flag, Tag } from 'lucide-react';
import type { Task, Tag as TaskTag, TaskFilter } from '../lib/types';
import { addDays, dayOf, todayStr } from '../lib/date';
import { useT } from '../i18n';

export type FilterDate = 'any' | 'today' | 'week' | 'overdue';

export interface TaskFilters {
  date: FilterDate;
  priority: number | null;
  tag: string | null;
}

export const EMPTY_TASK_FILTERS: TaskFilters = {
  date: 'any',
  priority: null,
  tag: null,
};

function taskDays(task: Pick<Task, 'startDate' | 'dueDate'>): { start: string | null; end: string | null } {
  const start = dayOf(task.startDate) ?? dayOf(task.dueDate);
  const end = dayOf(task.dueDate) ?? dayOf(task.startDate);
  return start && end && end < start ? { start: end, end: start } : { start, end };
}

export function matchesTaskFilters(task: Task, filters: TaskFilters, today = todayStr()): boolean {
  if (filters.priority != null && task.priority !== filters.priority) return false;
  if (filters.tag != null && !task.tags.includes(filters.tag)) return false;

  if (filters.date === 'any') return true;
  const range = taskDays(task);
  if (!range.start || !range.end) return false;
  if (filters.date === 'overdue') return range.end < today;
  if (filters.date === 'today') return range.start <= today && range.end >= today;

  const weekEnd = addDays(today, 7);
  return range.start <= weekEnd && range.end >= today;
}

export function filterTasks(tasks: Task[], filters: TaskFilters): Task[] {
  if (filters.date === 'any' && filters.priority == null && filters.tag == null) return tasks;
  return tasks.filter((task) => matchesTaskFilters(task, filters));
}

export function activeFilterCount(filters: TaskFilters): number {
  return Number(filters.date !== 'any') + Number(filters.priority != null) + Number(filters.tag != null);
}

function weekBounds(today: string): [string, string] {
  const [year, month, date] = today.split('-').map(Number);
  const start = new Date(year, month - 1, date - new Date(year, month - 1, date).getDay());
  const startDay = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return [startDay, addDays(startDay, 6)];
}

function savedDateMatch(task: Task, filter: TaskFilter, today: string): boolean {
  if (filter.dateMode === 'any') return true;
  const range = taskDays(task);
  if (!range.start || !range.end) return false;
  if (filter.dateMode === 'overdue') return range.end < today;
  if (filter.dateMode === 'today') return range.start <= today && range.end >= today;
  if (filter.dateMode === 'tomorrow') {
    const tomorrow = addDays(today, 1);
    return range.start <= tomorrow && range.end >= tomorrow;
  }
  if (filter.dateMode === 'week') {
    const [start, end] = weekBounds(today);
    return range.start <= end && range.end >= start;
  }
  const start = filter.dateStart ?? filter.dateEnd;
  const end = filter.dateEnd ?? filter.dateStart;
  if (!start || !end) return true;
  return range.start <= end && range.end >= start;
}

/** Match a persisted TickTick-style smart-list definition. */
export function matchesSavedFilter(task: Task, filter: TaskFilter, today = todayStr()): boolean {
  const checks: boolean[] = [];
  if (filter.projectIds.length) checks.push(filter.projectIds.includes(task.projectId));
  if (filter.tags.length) checks.push(filter.tags.some((tag) => task.tags.includes(tag)));
  if (filter.priorities.length) checks.push(filter.priorities.includes(task.priority));
  if (filter.statuses.length) checks.push(filter.statuses.includes(task.status));
  if (filter.dateMode !== 'any') checks.push(savedDateMatch(task, filter, today));
  if (!checks.length) return true;
  return filter.logic === 'or' ? checks.some(Boolean) : checks.every(Boolean);
}

export function filterSavedTasks(tasks: Task[], filter: TaskFilter): Task[] {
  return tasks.filter((task) => matchesSavedFilter(task, filter));
}

export function TaskFilterMenu({
  filters,
  tags,
  onChange,
  onClear,
}: {
  filters: TaskFilters;
  tags: TaskTag[];
  onChange: (next: TaskFilters) => void;
  onClear: () => void;
}) {
  const t = useT();
  const dateOptions: [FilterDate, string][] = [
    ['any', t('filterAnyDate')],
    ['today', t('filterToday')],
    ['week', t('filterThisWeek')],
    ['overdue', t('filterOverdue')],
  ];
  const priorityOptions: [number | null, string][] = [
    [null, t('filterAnyPriority')],
    [3, t('priorityHigh')],
    [2, t('priorityMedium')],
    [1, t('priorityLow')],
    [0, t('priorityNone')],
  ];

  return (
    <div className="w-[292px] p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[14px] font-semibold text-ink">{t('filterTitle')}</div>
        {activeFilterCount(filters) > 0 && (
          <button type="button" onClick={onClear} className="text-[12px] text-tt hover:underline">
            {t('clearFilters')}
          </button>
        )}
      </div>

      <FilterSection label={t('filterDate')}>
        <div className="flex flex-wrap gap-1.5">
          {dateOptions.map(([value, label]) => (
            <ChoiceButton
              key={value}
              active={filters.date === value}
              label={label}
              onClick={() => onChange({ ...filters, date: value })}
            />
          ))}
        </div>
      </FilterSection>

      <FilterSection label={t('filterPriority')} icon={<Flag size={13} />}>
        <div className="flex flex-wrap gap-1.5">
          {priorityOptions.map(([value, label]) => (
            <ChoiceButton
              key={label}
              active={filters.priority === value}
              label={label}
              onClick={() => onChange({ ...filters, priority: value })}
            />
          ))}
        </div>
      </FilterSection>

      <FilterSection label={t('filterTag')} icon={<Tag size={13} />}>
        {tags.length === 0 ? (
          <div className="rounded-md bg-hover px-2.5 py-2 text-[12px] text-ink-3">{t('noTags')}</div>
        ) : (
          <select
            value={filters.tag ?? ''}
            onChange={(e) => onChange({ ...filters, tag: e.target.value || null })}
            className="w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-[12px] text-ink-2 focus:border-tt"
          >
            <option value="">{t('filterAnyTag')}</option>
            {tags.map((tag) => (
              <option key={tag.name} value={tag.name}>
                #{tag.label}
              </option>
            ))}
          </select>
        )}
      </FilterSection>

      <div className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-3">
        {t('filterHint')}
      </div>
    </div>
  );
}

function FilterSection({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function ChoiceButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? 'border-tt bg-tt-light font-medium text-tt'
          : 'border-line bg-white text-ink-2 hover:border-tt/50 hover:text-tt'
      }`}
    >
      {label}
    </button>
  );
}
