import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlignLeft,
  CalendarClock,
  Check,
  Columns3,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  LayoutGrid,
  List,
  ListFilter,
  Menu,
  MoreHorizontal,
  Plus,
  Printer,
  Settings2,
  Share2,
  Trash2,
} from 'lucide-react';
import { useStore, INBOX_ID } from '../../stores/store';
import { useT, useTF, type Key } from '../../i18n';
import {
  BUCKET_ORDER,
  addDays,
  bucketLabel,
  bucketOf,
  dayOf,
  stampOf,
  stampToday,
  smartListDefaultDue,
  todayStr,
  weekdayShort,
} from '../../lib/date';
import type { Habit, HabitYear, Project, Tag, Task } from '../../lib/types';
import { projectDisplayName } from '../../lib/project';
import { api, yearRange } from '../../lib/api';
import { TaskRow } from './TaskRow';
import { TaskGroup } from './TaskGroup';
import { QuickAdd } from './QuickAdd';
import { CompletedGroup } from '../../components/CompletedGroup';
import { MenuItem, Popover } from '../../components/Popover';
import {
  EMPTY_TASK_FILTERS,
  TaskFilterMenu,
  activeFilterCount,
  filterSavedTasks,
  filterTasks,
  type TaskFilters,
} from '../../components/TaskFilterMenu';
import KanbanBoard from './KanbanBoard';
import TimelineBoard from './TimelineBoard';
import ProjectSettingsDialog from './ProjectSettingsDialog';
import BatchBar from './BatchBar';
import { isSubmitEnter } from '../../lib/keys';
import { hasTag, tagKey } from '../../lib/tags';
import { PRIORITY_LEVELS, priorityLabel } from '../../components/RoundCheck';
import { useEscape } from '../../lib/useEscape';

type SortKey = 'custom' | 'time' | 'created' | 'modified' | 'title' | 'tags' | 'priority';
type GroupKey = 'custom' | 'time' | 'created' | 'tags' | 'priority' | 'none';
type ViewMode = 'list' | 'kanban' | 'timeline';

const TITLE_KEYS = {
  all: 'smartAll',
  today: 'smartToday',
  tomorrow: 'smartTomorrow',
  next7: 'smartNext7',
  inbox: 'smartInbox',
  overdue: 'smartOverdue',
  abandoned: 'smartAbandoned',
  completed: 'navCompleted',
  trash: 'navTrash',
} as const;

export default function TasksPage() {
  const { scope = 'all' } = useParams();
  const {
    tasks,
    completed,
    abandoned,
    projects,
    tags,
    filters: savedFilters,
    trash,
    postponeAll,
    setProjectView,
    clearSelection,
    emptyTrash,
  } = useStore();
  const t = useT();
  const f = useTF();
  const [sortKey, setSortKey] = useState<SortKey>('custom');
  const [groupKey, setGroupKey] = useState<GroupKey>('custom');
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setFilters(EMPTY_TASK_FILTERS);
    setHideCompleted(false);
    setShowDetails(false);
    setSortKey('custom');
    setGroupKey('custom');
    clearSelection();
  }, [scope]);

  const project = useMemo(
    () => (scope.startsWith('project-') ? projects.find((p) => p.id === scope.slice('project-'.length)) : undefined),
    [scope, projects],
  );
  const tagName = scope.startsWith('tag-') ? scope.slice('tag-'.length) : null;
  const savedFilter = useMemo(
    () => (scope.startsWith('filter-') ? savedFilters.find((item) => item.id === scope.slice('filter-'.length)) : undefined),
    [scope, savedFilters],
  );

  const titleKey = TITLE_KEYS[scope as keyof typeof TITLE_KEYS];
  // Tag links use the lowercased tag name; show the label as the user typed it.
  const tagLabel = tagName ? tags.find((tag) => tagKey(tag.name) === tagKey(tagName))?.label ?? tagName : null;
  const title =
    projectDisplayName(project, t) || savedFilter?.name || (tagLabel ? `#${tagLabel}` : titleKey ? t(titleKey) : t('smartAll'));
  // Today / Tomorrow / Next 7 Days add to the inbox with a preset date, like TickTick.
  const quickAddDue = project ? null : smartListDefaultDue(scope, todayStr());
  const quickAddProjectId =
    project?.id ?? (scope === 'inbox' || scope === 'all' || quickAddDue ? INBOX_ID : null);

  const sorter = (a: Task, b: Task): number => {
    // TickTick pins tasks to the top of the list under every sort key.
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortKey === 'priority') return b.priority - a.priority || a.title.localeCompare(b.title);
    if (sortKey === 'title') return a.title.localeCompare(b.title);
    if (sortKey === 'tags') return a.tags.join(',').localeCompare(b.tags.join(',')) || a.title.localeCompare(b.title);
    if (sortKey === 'created') return (b.createdTime ?? '').localeCompare(a.createdTime ?? '');
    if (sortKey === 'modified') return (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? '');
    if (sortKey === 'custom') return a.sortOrder - b.sortOrder || (a.dueDate ?? a.startDate ?? '9999').localeCompare(b.dueDate ?? b.startDate ?? '9999');
    return (a.dueDate ?? a.startDate ?? '9999').localeCompare(b.dueDate ?? b.startDate ?? '9999');
  };

  const isTrash = scope === 'trash';
  const isCompleted = scope === 'completed';
  const isAbandoned = scope === 'abandoned';
  const smartBucketed = !savedFilter && (scope === 'all' || scope === 'today' || scope === 'next7');

  const scopedTasks = useMemo(() => {
    if (isTrash) return trash;
    if (isCompleted) return completed;
    if (isAbandoned) return abandoned;
    if (savedFilter) return tasks;
    if (project) return tasks.filter((t) => t.projectId === project.id);
    if (tagName) return tasks.filter((t) => hasTag(t, tagName));
    if (scope === 'inbox') return tasks.filter((t) => t.projectId === INBOX_ID);
    if (scope === 'overdue')
      return tasks.filter((t) => {
        const day = dayOf(t.dueDate);
        return day !== null && day < todayStr();
      });
    if (scope === 'tomorrow')
      return tasks.filter((t) => dayOf(t.dueDate) === addDays(todayStr(), 1));
    if (scope === 'today')
      return tasks.filter((t) => {
        const day = dayOf(t.dueDate);
        return day !== null && day <= todayStr();
      });
    if (scope === 'next7')
      return tasks.filter((t) => {
        const day = dayOf(t.dueDate);
        return day !== null && day <= addDays(todayStr(), 7);
      });
    return tasks;
  }, [isTrash, isCompleted, isAbandoned, savedFilter, project, tagName, scope, tasks, completed, abandoned, trash]);

  const visible = useMemo(
    () => savedFilter ? filterSavedTasks(scopedTasks, savedFilter) : filterTasks(scopedTasks, filters),
    [savedFilter, scopedTasks, filters],
  );

  const completedInScope = useMemo(() => {
    if (isTrash || isCompleted || isAbandoned) return [];
    if (savedFilter) return filterSavedTasks(completed, savedFilter);
    if (project) return filterTasks(completed.filter((t) => t.projectId === project.id), filters);
    if (tagName) return filterTasks(completed.filter((t) => hasTag(t, tagName)), filters);
    if (scope === 'inbox') return filterTasks(completed.filter((t) => t.projectId === INBOX_ID), filters);
    if (scope === 'tomorrow') {
      return filterTasks(completed.filter((t) => dayOf(t.dueDate) === addDays(todayStr(), 1)), filters);
    }
    if (scope === 'today') {
      return filterTasks(completed.filter((t) => {
        const day = dayOf(t.dueDate);
        return day !== null && day <= todayStr();
      }), filters);
    }
    if (scope === 'next7') {
      return filterTasks(completed.filter((t) => {
        const day = dayOf(t.dueDate);
        return day !== null && day <= addDays(todayStr(), 7);
      }), filters);
    }
    return filterTasks(completed, filters);
  }, [isTrash, isCompleted, isAbandoned, savedFilter, project, tagName, scope, completed, filters]);

  // ---- render: kanban board ----
  if (project && project.viewMode === 'kanban') {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ListHeader
          title={title}
          project={project}
          onView={(mode) => void setProjectView(project.id, mode)}
          hideCompleted={hideCompleted}
          showDetails={showDetails}
          onHideCompleted={() => setHideCompleted((v) => !v)}
          onShowDetails={() => setShowDetails((v) => !v)}
        />
        <KanbanBoard projectId={project.id} sorter={sorter} />
        <BatchBarOverlay />
      </div>
    );
  }

  if (project && project.viewMode === 'timeline') {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ListHeader
          title={title}
          project={project}
          onView={(mode) => void setProjectView(project.id, mode)}
          filters={filters}
          tags={tags}
          onFilters={setFilters}
          hideCompleted={hideCompleted}
          showDetails={showDetails}
          onHideCompleted={() => setHideCompleted((v) => !v)}
          onShowDetails={() => setShowDetails((v) => !v)}
        />
        <TimelineBoard tasks={visible} sorter={sorter} />
        <BatchBarOverlay />
      </div>
    );
  }

  // ---- render: grouped flat list ----
  const buckets = new Map<string, Task[]>();
  if (smartBucketed) {
    for (const t of visible) {
      const b = bucketOf(t);
      const list = buckets.get(b) ?? [];
      list.push(t);
      buckets.set(b, list);
    }
  }
  const today = todayStr();
  // Drag reorder only in custom-sort views of a concrete list (or inbox),
  // mirroring TickTick where smart lists sort by their own rules.
  const canDragTasks = sortKey === 'custom' && (groupKey === 'custom' || groupKey === 'none') && (!!project || scope === 'inbox');
  const renderRow = (t2: Task, list: Task[], showProj: boolean) => (
    <TaskRow
      key={t2.id}
      task={t2}
      showProject={showProj}
      showDetails={showDetails}
      siblings={list.map((x) => x.id)}
      canDrag={canDragTasks}
    />
  );

  let body: ReactNode;
  if (isTrash) {
    body =
      visible.length === 0 ? (
        <Empty text={t('emptyTrash')} />
      ) : (
        <TaskGroup label={t('navTrash')} count={visible.length}>
          {[...visible].sort(sorter).map((t2) => (
            <TaskRow key={t2.id} task={t2} showProject showDetails={showDetails} />
          ))}
        </TaskGroup>
      );
  } else if (isAbandoned) {
    body =
      visible.length === 0 ? (
        <Empty text={t('emptyCalm')} />
      ) : (
        <TaskGroup label={t('smartAbandoned')} count={visible.length}>
          {[...visible].sort(sorter).map((t2) => (
            <TaskRow key={t2.id} task={t2} showProject showDetails={showDetails} />
          ))}
        </TaskGroup>
      );
  } else if (isCompleted) {
    body =
      visible.length === 0 ? (
        <Empty text={t('emptyCompleted')} />
      ) : (
        <TaskGroup label={t('groupCompleted')} count={visible.length}>
          {[...visible].sort((a, b) => (b.completedTime ?? '').localeCompare(a.completedTime ?? '')).map((t2) => (
            <TaskRow key={t2.id} task={t2} showProject showDetails={showDetails} />
          ))}
        </TaskGroup>
      );
  } else if (smartBucketed) {
    body = (
      <>
        {(scope === 'next7' ? (['overdue', 'today', 'tomorrow'] as const) : BUCKET_ORDER).map((b) => {
          if (scope === 'today' && b !== 'overdue' && b !== 'today') return null;
          const list = buckets.get(b);
          if (!list || list.length === 0) return null;
          const red = b === 'overdue';
          const sorted = [...list].sort(sorter);
          return (
            <TaskGroup
              key={b}
              label={bucketLabel(b)}
              count={list.length}
              red={red}
              action={
                red ? (
                  <button
                    type="button"
                    className="text-[13px] text-p-high hover:underline"
                    onClick={() => void postponeAll(today, list.map((task) => task.id))}
                  >
                    {t('postpone')}
                  </button>
                ) : undefined
              }
            >
              {sorted.map((t2) => renderRow(t2, sorted, scope === 'all'))}
            </TaskGroup>
          );
        })}
        {scope === 'next7' &&
          (() => {
            const byDay = new Map<string, Task[]>();
            for (const t2 of visible) {
              const day = dayOf(t2.dueDate);
              if (!day || day <= addDays(today, 1)) continue;
              const list = byDay.get(day) ?? [];
              list.push(t2);
              byDay.set(day, list);
            }
            return [...byDay.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([day, list]) => {
                const sorted = [...list].sort(sorter);
                return (
                  <TaskGroup key={day} label={weekdayShort(day)} count={list.length}>
                    {sorted.map((t2) => renderRow(t2, sorted, true))}
                  </TaskGroup>
                );
              });
          })()}
        {(scope === 'today' || scope === 'next7') && habitSmartListsEnabled() && <SmartHabitGroup />}
        {completedInScope.length > 0 && !hideCompleted && (
          <CompletedGroup tasks={completedInScope} showProject={scope === 'all'} showDetails={showDetails} />
        )}
        {visible.length === 0 && (completedInScope.length === 0 || hideCompleted) && <Empty text={t('emptyCalm')} />}
      </>
    );
  } else {
    const groupsForList = groupTasks(visible, groupKey, t);
    body = (
      <>
        {groupsForList ? groupsForList.map((group) => {
          const sorted = [...group.tasks].sort(sorter);
          return (
            <TaskGroup key={group.key} label={group.label} count={group.tasks.length}>
              {sorted.map((t2) => renderRow(t2, sorted, !!savedFilter))}
            </TaskGroup>
          );
        }) : (() => {
          const sorted = [...visible].sort(sorter);
          return sorted.map((t2) => renderRow(t2, sorted, !!savedFilter));
        })()}
        {visible.length === 0 && (
          <Empty text={scope === 'inbox' ? t('emptyInbox') : t('emptyNoTasks')} />
        )}
        {completedInScope.length > 0 && !hideCompleted && (
          <CompletedGroup tasks={completedInScope} showProject={!!savedFilter} showDetails={showDetails} />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ListHeader
        title={title}
        project={project}
        sortKey={sortKey}
        onSort={setSortKey}
        groupKey={groupKey}
        onGroup={setGroupKey}
        onView={project ? (mode) => void setProjectView(project.id, mode) : undefined}
        filters={filters}
        tags={tags}
        onFilters={setFilters}
        hideCompleted={hideCompleted}
        showDetails={showDetails}
        onHideCompleted={() => setHideCompleted((v) => !v)}
        onShowDetails={() => setShowDetails((v) => !v)}
        onEmptyTrash={
          isTrash && trash.length > 0
            ? () => {
                if (window.confirm(t('emptyTrashConfirm'))) void emptyTrash();
              }
            : undefined
        }
      />
      {quickAddProjectId && (
        <QuickAdd
          projectId={quickAddProjectId}
          placeholder={f('addTaskTo', scope === 'all' ? t('smartInbox') : title)}
          defaultDueDate={quickAddDue}
        />
      )}
      <BatchBarOverlay />
      <div className="min-h-0 flex-1 overflow-y-auto pb-16">{body}</div>
    </div>
  );
}

/** Floating batch toolbar shown whenever tasks are multi-selected. */
function BatchBarOverlay() {
  const selectedIds = useStore((s) => s.selectedIds);
  if (selectedIds.length === 0) return null;
  return (
    <div className="relative z-10 px-4 pt-1">
      <BatchBar />
    </div>
  );
}

function habitSmartListsEnabled(): boolean {
  try {
    return localStorage.getItem('ntk_habits_in_smart_lists') !== '0';
  } catch {
    return true;
  }
}

function SmartHabitGroup() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [years, setYears] = useState<Map<string, HabitYear>>(new Map());
  const t = useT();
  const stamp = stampToday();
  const day = todayStr();

  useEffect(() => {
    let live = true;
    void (async () => {
      const list = (await api.listHabits()).filter((habit) => habit.status !== 2);
      const checkins = list.length
        ? await api.listCheckins(list.map((habit) => habit.id), ...yearRange(stamp))
        : [];
      if (live) {
        setHabits(list);
        setYears(new Map(checkins.map((item) => [item.habitId, item])));
      }
    })();
    return () => { live = false; };
  }, [stamp]);

  const done = (habit: Habit) => {
    const row = years.get(habit.id)?.checkins.find((item) => item.stamp === stampOf(day));
    return (row?.value ?? 0) >= Math.max(1, row?.goal ?? habit.goal ?? 1);
  };
  const ordered = [...habits];
  try {
    if (localStorage.getItem('ntk_habits_group_status') === '1') {
      ordered.sort((a, b) => Number(done(a)) - Number(done(b)));
    }
  } catch {
    // Keep the server order when storage is unavailable.
  }
  if (!ordered.length) return null;

  return (
    <TaskGroup label={t('habitTitle')} count={ordered.length}>
      {ordered.map((habit) => {
        const checked = done(habit);
        const color = habit.color ?? '#97e38b';
        return (
          <div key={habit.id} className="flex h-10 items-center px-5 hover:bg-hover">
            <button
              type="button"
              aria-label={`${habit.name} ${checked ? 'checked' : ''}`}
              aria-pressed={checked}
              onClick={async () => {
                const goal = Math.max(1, habit.goal ?? 1);
                const next = await api.checkin(habit.id, stamp, checked ? 0 : goal, {
                  goal,
                  status: checked ? 0 : 2,
                });
                setYears((current) => new Map(current).set(habit.id, next));
              }}
              className="mr-3 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2"
              style={{ borderColor: color, backgroundColor: checked ? color : 'transparent', color: 'white' }}
            >
              {checked && <Check size={12} strokeWidth={2.8} />}
            </button>
            <span className={`min-w-0 flex-1 truncate text-[14px] ${checked ? 'text-ink-3 line-through' : 'text-ink'}`}>
              {habit.name}
            </span>
            <span className="ml-3 text-[12px] text-ink-3">{t('habitTitle')}</span>
          </div>
        );
      })}
    </TaskGroup>
  );
}

function ListHeader({
  title,
  project,
  sortKey,
  onSort,
  groupKey,
  onGroup,
  onView,
  filters,
  tags,
  onFilters,
  hideCompleted = false,
  showDetails = false,
  onHideCompleted,
  onShowDetails,
  onEmptyTrash,
}: {
  title: string;
  project?: Project;
  sortKey?: SortKey;
  onSort?: (k: SortKey) => void;
  groupKey?: GroupKey;
  onGroup?: (k: GroupKey) => void;
  onView?: (mode: ViewMode) => void;
  filters?: TaskFilters;
  tags?: Tag[];
  onFilters?: (next: TaskFilters) => void;
  hideCompleted?: boolean;
  showDetails?: boolean;
  onHideCompleted?: () => void;
  onShowDetails?: () => void;
  onEmptyTrash?: () => void;
}) {
  const { renameProject, deleteProject, addGroup, showToast, setNavOpen } = useStore();
  const t = useT();
  const f = useTF();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(project?.name ?? title);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);

  useEffect(() => {
    setTitleDraft(project?.name ?? title);
  }, [project?.name, title]);

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (project && project.id !== INBOX_ID && next && next !== project.name) {
      void renameProject(project.id, next);
    }
    setTitleDraft(project?.name ?? title);
    setEditingTitle(false);
  };

  const shareList = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      showToast({ messageKey: 'shareCopied' });
    } catch {
      // Clipboard access is optional on localhost; the menu still remains usable.
    }
  };

  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2 px-[22px]">
        {/* Phones hide the list sidebar behind this button (see AppLayout). */}
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          title={t('sectionLists')}
          aria-label={t('sectionLists')}
          className="-ml-2 shrink-0 rounded-md p-1 text-ink-2 hover:bg-hover md:hidden"
        >
          <Menu size={20} />
        </button>
        {project && project.id !== INBOX_ID ? (
          editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (isSubmitEnter(e)) commitTitle();
                if (e.key === 'Escape') {
                  setTitleDraft(project.name);
                  setEditingTitle(false);
                }
              }}
              className="min-w-0 max-w-[min(60vw,360px)] rounded-md border border-tt bg-white px-2 py-0.5 text-[20px] font-bold leading-snug text-ink shadow-[0_0_0_2px_rgba(71,114,250,0.12)]"
              aria-label={t('listName')}
            />
          ) : (
            <button
              type="button"
              title={t('rename')}
              onClick={() => setEditingTitle(true)}
              className="max-w-[min(60vw,360px)] truncate rounded-md px-1 text-left text-[20px] font-bold leading-snug hover:bg-hover"
            >
              {title}
            </button>
          )
        ) : (
          <h1 className="truncate text-[20px] font-bold">{title}</h1>
        )}

        <div className="ml-auto flex items-center gap-2.5 text-ink-3">
          {onFilters && filters && (
            <Popover
              align="right"
              panelClass="w-[292px]"
              trigger={(_o, toggle) => (
                <button
                  type="button"
                  onClick={toggle}
                  title={t('filters')}
                  className={`relative rounded-md p-1 hover:bg-hover hover:text-ink ${activeFilterCount(filters) > 0 ? 'text-tt' : ''}`}
                >
                  <ListFilter size={17} />
                  {activeFilterCount(filters) > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-tt px-0.5 text-[9px] font-semibold text-white">
                      {activeFilterCount(filters)}
                    </span>
                  )}
                </button>
              )}
            >
              {(close) => (
                <TaskFilterMenu
                  filters={filters}
                  tags={tags ?? []}
                  onChange={onFilters}
                  onClear={() => {
                    onFilters(EMPTY_TASK_FILTERS);
                    close();
                  }}
                />
              )}
            </Popover>
          )}

          {onSort && (
            <Popover
              align="right"
              panelClass="w-[246px]"
              trigger={(_o, toggle) => (
                <button type="button" onClick={toggle} title={t('sort')} className="rounded-md p-1 hover:bg-hover hover:text-ink">
                  <AlignLeft size={17} />
                </button>
              )}
            >
              {(close) => (
                <GroupSortMenu
                  groupKey={groupKey ?? 'custom'}
                  sortKey={sortKey ?? 'custom'}
                  onGroup={onGroup}
                  onSort={onSort}
                  close={close}
                />
              )}
            </Popover>
          )}

          <Popover
            align="right"
            panelClass="w-64"
            trigger={(_o, toggle) => (
              <button type="button" onClick={toggle} title={t('viewOptions')} className="rounded-md p-1 hover:bg-hover hover:text-ink">
                <MoreHorizontal size={19} />
              </button>
            )}
          >
            {(close) => (
              <>
                {onView && project && (
                  <div className="border-b border-line px-3 pb-2 pt-2">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{t('viewOptions')}</div>
                    <div className="grid grid-cols-3 gap-1">
                      <ViewChoice
                        active={project.viewMode !== 'kanban' && project.viewMode !== 'timeline'}
                        label={t('viewList')}
                        onClick={() => {
                          close();
                          onView('list');
                        }}
                      >
                        <List size={21} />
                      </ViewChoice>
                      <ViewChoice
                        active={project.viewMode === 'kanban'}
                        label={t('viewKanban')}
                        onClick={() => {
                          close();
                          onView('kanban');
                        }}
                      >
                        <Columns3 size={21} />
                      </ViewChoice>
                      <ViewChoice
                        active={project.viewMode === 'timeline'}
                        label={t('viewTimeline')}
                        onClick={() => {
                          close();
                          onView('timeline');
                        }}
                      >
                        <CalendarClock size={21} />
                      </ViewChoice>
                    </div>
                  </div>
                )}
                <div className="py-1">
                  {onHideCompleted && (
                    <MenuItem
                      icon={hideCompleted ? <Eye size={15} /> : <EyeOff size={15} />}
                      label={hideCompleted ? t('showCompleted') : t('hideCompleted')}
                      onClick={() => {
                        close();
                        onHideCompleted();
                      }}
                    />
                  )}
                  {onShowDetails && (
                    <MenuItem
                      icon={showDetails ? <EyeOff size={15} /> : <Eye size={15} />}
                      label={showDetails ? t('hideDetails') : t('showDetails')}
                      onClick={() => {
                        close();
                        onShowDetails();
                      }}
                    />
                  )}
                  <MenuItem
                    icon={<Settings2 size={15} />}
                    label={t('listSettings')}
                    onClick={() => {
                      close();
                      if (project) setProjectSettingsOpen(true);
                      else setSettingsOpen(true);
                    }}
                  />
                  {project && (
                    <>
                      <MenuItem
                        icon={<Plus size={15} />}
                        label={t('addGroup')}
                        onClick={() => {
                          close();
                          const name = window.prompt(t('groupName'));
                          if (name?.trim()) void addGroup(name.trim());
                        }}
                      />
                      <MenuItem
                        icon={<Share2 size={15} />}
                        label={t('share')}
                        onClick={() => {
                          close();
                          void shareList();
                        }}
                      />
                    </>
                  )}
                  {onEmptyTrash && (
                    <MenuItem
                      icon={<Trash2 size={15} />}
                      label={t('emptyTrashAction')}
                      danger
                      onClick={() => {
                        close();
                        onEmptyTrash();
                      }}
                    />
                  )}
                  <MenuItem
                    icon={<Printer size={15} />}
                    label={t('print')}
                    onClick={() => {
                      close();
                      window.print();
                    }}
                  />
                  {project && project.id !== INBOX_ID && (
                    <>
                      <div className="my-1 border-t border-line" />
                      <MenuItem
                        label={t('rename')}
                        onClick={() => {
                          close();
                          setEditingTitle(true);
                        }}
                      />
                      <MenuItem
                        label={t('deleteList')}
                        danger
                        onClick={() => {
                          close();
                          if (window.confirm(f('deleteListConfirm', project.name))) {
                            void deleteProject(project.id);
                          }
                        }}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </Popover>
        </div>
      </div>
      {settingsOpen && (
        <ListSettingsDialog
          hideCompleted={hideCompleted}
          showDetails={showDetails}
          onHideCompleted={onHideCompleted}
          onShowDetails={onShowDetails}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {projectSettingsOpen && project && (
        <ProjectSettingsDialog
          key={project.id}
          project={project}
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}
    </>
  );
}

function ViewChoice({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-md ${active ? 'bg-tt-light text-tt' : 'text-ink hover:bg-hover'}`}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function GroupSortMenu({
  groupKey,
  sortKey,
  onGroup,
  onSort,
  close,
}: {
  groupKey: GroupKey;
  sortKey: SortKey;
  onGroup?: (key: GroupKey) => void;
  onSort: (key: SortKey) => void;
  close: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<'group' | 'sort'>('sort');
  const groupOptions: [GroupKey, string][] = [
    ['custom', t('groupCustom')],
    ['time', t('groupTime')],
    ['created', t('groupCreated')],
    ['tags', t('groupTags')],
    ['priority', t('groupPriority')],
    ['none', t('groupNone')],
  ];
  const sortOptions: [SortKey, string][] = [
    ['custom', t('sortCustom')],
    ['time', t('sortTime')],
    ['created', t('sortCreated')],
    ['modified', t('sortModified')],
    ['title', t('sortTitle')],
    ['tags', t('sortTags')],
    ['priority', t('sortPriority')],
  ];
  const groupLabel = groupOptions.find(([value]) => value === groupKey)?.[1] ?? t('groupCustom');
  const sortLabel = sortOptions.find(([value]) => value === sortKey)?.[1] ?? t('sortCustom');

  return (
    <div className="py-1">
      <SubmenuRow
        icon={<Columns3 size={19} />}
        label={t('groupBy')}
        value={groupLabel}
        expanded={open === 'group'}
        onClick={() => setOpen((current) => current === 'group' ? 'sort' : 'group')}
      />
      {open === 'group' && onGroup && (
        <div className="mx-2 mb-1 rounded-lg bg-[#fafafa] px-1 py-1">
          {groupOptions.map(([value, label]) => (
            <SubmenuOption
              key={value}
              label={label}
              active={groupKey === value}
              onClick={() => {
                onGroup(value);
                close();
              }}
            />
          ))}
        </div>
      )}

      <SubmenuRow
        icon={<AlignLeft size={19} />}
        label={t('sortBy')}
        value={sortLabel}
        expanded={open === 'sort'}
        onClick={() => setOpen((current) => current === 'sort' ? 'group' : 'sort')}
      />
      {open === 'sort' && (
        <div className="mx-2 rounded-lg bg-[#fafafa] px-1 py-1">
          {sortOptions.map(([value, label]) => (
            <SubmenuOption
              key={value}
              label={label}
              active={sortKey === value}
              onClick={() => {
                onSort(value);
                close();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmenuRow({
  icon,
  label,
  value,
  expanded,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-hover">
      <span className="shrink-0 text-ink-2">{icon}</span>
      <span className="flex-1 whitespace-nowrap text-[14px] text-ink">{label}</span>
      <span className={`whitespace-nowrap text-[13px] ${expanded ? 'text-ink-2' : 'text-ink-3'}`}>{value}</span>
      {expanded ? <ChevronDown size={15} className="shrink-0 text-ink-3" /> : <ChevronRight size={15} className="shrink-0 text-ink-3" />}
    </button>
  );
}

function SubmenuOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] ${active ? 'bg-tt-light text-tt' : 'text-ink-2 hover:bg-white'}`}>
      <span className="whitespace-nowrap">{label}</span>
      {active && <Check size={16} />}
    </button>
  );
}

function groupTasks(tasks: Task[], key: GroupKey, translate: (key: Key) => string): { key: string; label: string; tasks: Task[] }[] | null {
  if (key === 'custom' || key === 'none') return null;
  const grouped = new Map<string, Task[]>();
  for (const task of tasks) {
    let group = '';
    switch (key) {
      case 'time':
        group = bucketOf({ dueDate: task.dueDate ?? task.startDate });
        break;
      case 'created':
        group = dayOf(task.createdTime) ?? 'no-date';
        break;
      case 'tags':
        group = task.tags[0] ?? 'no-tag';
        break;
      case 'priority':
        group = String(task.priority);
        break;
    }
    const list = grouped.get(group) ?? [];
    list.push(task);
    grouped.set(group, list);
  }
  const order = key === 'time'
    ? BUCKET_ORDER
    : key === 'priority' ? PRIORITY_LEVELS.map(String) : undefined;
  const entries = [...grouped.entries()].sort(([a], [b]) => {
    if (order) return (order.indexOf(a as never) - order.indexOf(b as never));
    return a.localeCompare(b);
  });
  return entries.map(([group, list]) => ({
    key: group,
    label: key === 'time'
      ? bucketLabel(group as typeof BUCKET_ORDER[number])
      : key === 'created'
        ? group === 'no-date' ? translate('groupNone') : group
        : key === 'tags'
          ? group === 'no-tag' ? translate('groupNone') : `#${group}`
          : PRIORITY_LEVELS.includes(Number(group)) ? priorityLabel(Number(group)) : group,
    tasks: list,
  }));
}

function ListSettingsDialog({
  hideCompleted,
  showDetails,
  onHideCompleted,
  onShowDetails,
  onClose,
}: {
  hideCompleted: boolean;
  showDetails: boolean;
  onHideCompleted?: () => void;
  onShowDetails?: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('listSettings')}
        className="w-full max-w-sm rounded-xl border border-line bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{t('listSettings')}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-hover hover:text-ink">
            {t('close')}
          </button>
        </div>
        <SettingToggle checked={hideCompleted} label={t('hideCompleted')} onClick={onHideCompleted} />
        <SettingToggle checked={showDetails} label={t('showDetails')} onClick={onShowDetails} />
      </div>
    </div>
  );
}

function SettingToggle({ checked, label, onClick }: { checked: boolean; label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between rounded-lg px-2 py-2.5 text-left text-[13px] hover:bg-hover">
      <span>{label}</span>
      <span className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-tt justify-end' : 'bg-[#d8d8d8] justify-start'}`}>
        <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center pt-24 text-ink-3">
      <LayoutGrid size={40} strokeWidth={1} className="mb-4 text-line" />
      <span className="text-[13px]">{text}</span>
    </div>
  );
}
