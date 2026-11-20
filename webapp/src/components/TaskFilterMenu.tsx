import type { ReactNode } from 'react';
import { Flag, Tag } from 'lucide-react';
import type { Task, Tag as TaskTag, TaskFilter } from '../lib/types';
import { addDays, dayOf, todayStr } from '../lib/date';
import { useT } from '../i18n';
import { PRIORITY_LEVELS, priorityLabel } from './RoundCheck';
import { hasTag } from '../lib/tags';
import { matchTask, searchTerms } from '../lib/search';

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
  if (filters.tag != null && !hasTag(task, filters.tag)) return false;

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

function monthBounds(today: string): [string, string] {
  const [year, month] = today.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  const prefix = today.slice(0, 7);
  return [`${prefix}-01`, `${prefix}-${String(last).padStart(2, '0')}`];
}

/** The conditions of a saved filter (or of a live search, which saves as one). */
export type FilterConditions = Pick<
  TaskFilter,
  'logic' | 'dateMode' | 'dateStart' | 'dateEnd' | 'projectIds' | 'tags' | 'priorities' | 'statuses' | 'keywords' | 'kinds'
>;

export function savedDateMatch(task: Task, filter: Pick<TaskFilter, 'dateMode' | 'dateStart' | 'dateEnd'>, today: string): boolean {
  if (filter.dateMode === 'any') return true;
  const range = taskDays(task);
  if (filter.dateMode === 'nodate') return !range.start && !range.end;
  if (!range.start || !range.end) return false;
  const overlaps = (start: string, end: string) => range.start! <= end && range.end! >= start;
  if (filter.dateMode === 'overdue') return range.end < today && task.status === 0;
  if (filter.dateMode === 'today') return overlaps(today, today);
  if (filter.dateMode === 'tomorrow') {
    const tomorrow = addDays(today, 1);
    return overlaps(tomorrow, tomorrow);
  }
  if (filter.dateMode === 'week') return overlaps(...weekBounds(today));
  if (filter.dateMode === 'next7') return overlaps(today, addDays(today, 6));
  if (filter.dateMode === 'month') return overlaps(...monthBounds(today));
  const start = filter.dateStart ?? filter.dateEnd;
  const end = filter.dateEnd ?? filter.dateStart;
  if (!start || !end) return true;
  return overlaps(start, end);
}

/** Notes are kind NOTE; plain and checklist tasks count as tasks. */
export function taskKindOf(task: Pick<Task, 'kind'>): 'task' | 'note' {
  return task.kind === 'NOTE' ? 'note' : 'task';
}

/**
 * Match a persisted TickTick-style smart-list definition. Keywords always
 * have to match; the other conditions combine with the filter's logic.
 */
export function matchesSavedFilter(task: Task, filter: FilterConditions, today = todayStr()): boolean {
  const terms = searchTerms(filter.keywords ?? '');
  if (terms.length && !matchTask(task, terms)) return false;
  const checks: boolean[] = [];
  if (filter.projectIds.length) checks.push(filter.projectIds.includes(task.projectId));
  if (filter.tags.length) checks.push(filter.tags.some((tag) => hasTag(task, tag)));
  if (filter.priorities.length) checks.push(filter.priorities.includes(task.priority));
  if (filter.statuses.length) checks.push(filter.statuses.includes(task.status));
  if (filter.kinds?.length) checks.push(filter.kinds.includes(taskKindOf(task)));
  if (filter.dateMode !== 'any') checks.push(savedDateMatch(task, filter, today));
  if (!checks.length) return true;
  return filter.logic === 'or' ? checks.some(Boolean) : checks.every(Boolean);
}

export function filterSavedTasks(tasks: Task[], filter: FilterConditions): Task[] {
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
    ...PRIORITY_LEVELS.map((value): [number, string] => [value, priorityLabel(value)]),
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
