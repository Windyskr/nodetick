import { useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlignLeft, Ban, Bell, Calendar, CheckSquare, MoreHorizontal, Pin, PinOff, Repeat, RotateCcw, Square, StickyNote, Timer, Trash2 } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useStore } from '../../stores/store';
import { useFocus } from '../../stores/focus';
import { dayOf, scheduleLabel, todayStr } from '../../components/taskSchedule';
import { RoundCheck } from '../../components/RoundCheck';
import { ScheduleMenu } from '../../components/ScheduleMenu';
import { MenuItem, Popover } from '../../components/Popover';
import { useT, type Key } from '../../i18n';
import { projectDisplayName } from '../../lib/project';
import { highlightParts } from '../../lib/search';
import { descriptionPreview } from '../../lib/markdownText';

const EMOJI_RE = /^\p{Extended_Pictographic}/u;

function projectBadge(projectId: string, t: (key: Key) => string) {
  const project = useStore.getState().projects.find((p) => p.id === projectId);
  if (!project) return null;
  const emoji = EMOJI_RE.exec(project.name)?.[0];
  return { name: projectDisplayName(project, t), emoji, color: project.color ?? '#4772FA' };
}

function DateChip({ task }: { task: Task }) {
  const anchor = task.dueDate ?? task.startDate;
  const day = dayOf(anchor);
  if (!day || !anchor) return null;
  const today = todayStr();
  const overdue = day < today && task.status !== 2;
  const isToday = day === today;
  return (
    <span className={`text-[12px] ${overdue ? 'text-p-high' : isToday ? 'text-tt' : 'text-ink-3'}`}>
      {scheduleLabel(task.startDate, task.dueDate, task.isAllDay)}
    </span>
  );
}

/**
 * A task row in the list. Hover reveals a quick date picker; the "…" menu
 * duplicates, moves, or deletes. Variant `trash` swaps controls for
 * restore/purge; completed rows show the gray filled check.
 */
export function TaskRow({
  task,
  showProject = true,
  showDetails = false,
  siblings,
  canDrag = false,
  highlight,
  snippet,
  layout = 'row',
}: {
  task: Task;
  showProject?: boolean;
  showDetails?: boolean;
  /** Rendered sibling order used for drag-reorder persistence. */
  siblings?: string[];
  /** Dragging is only offered in custom-sort views, like TickTick. */
  canDrag?: boolean;
  /** Search terms to mark in the title. */
  highlight?: string[];
  /** Extra line under the title (search: where the match was found). */
  snippet?: ReactNode;
  /** `card`: the title wraps on its own line with the details under it (Kanban board). */
  layout?: 'row' | 'card';
}) {
  const { selectTask, selectedTaskId, toggleComplete, trashTask, restoreTask, purgeTask, saveTask, duplicateTask, moveTask, showToast, toggleSelect, selectedIds, reorderTasks, abandonTask, restoreAbandoned } =
    useStore();
  const t = useT();
  const navigate = useNavigate();
  const focusEnabled = useStore((state) => state.features.focus);
  const [menuView, setMenuView] = useState<'main' | 'move'>('main');
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null);
  const selected = selectedTaskId === task.id;
  const checked = selectedIds.includes(task.id);
  const done = task.status === 2;
  const abandoned = task.status === -1;
  const badge = showProject ? projectBadge(task.projectId, t) : null;
  const subtasks = task.items.length;

  const isNote = task.kind === 'NOTE';
  const doneCount = task.items.filter((i) => i.status === 2).length;
  const titleText = task.title
    ? highlight?.length
      ? highlightParts(task.title, highlight).map((part, index) => part.hit
        ? <mark key={index} className="rounded-[2px] bg-tt-light px-px text-tt">{part.text}</mark>
        : part.text)
      : task.title
    : <span className="text-ink-3">{t('untitled')}</span>;
  const selectBox = (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={t('selectForBatch')}
      onClick={(e) => {
        e.stopPropagation();
        toggleSelect(task.id);
      }}
      className={`shrink-0 text-ink-3 transition-opacity hover:text-tt ${
        checked ? 'text-tt opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
      }`}
    >
      {checked ? <CheckSquare size={15} className="text-tt" /> : <Square size={15} />}
    </button>
  );
  // Notes can't be completed: a note icon stands where the check would be.
  const check = isNote ? (
    <span title={t('filterKind_note')} className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-ink-3">
      <StickyNote size={15} />
    </span>
  ) : (
    // Trashed tasks can't be completed (the API answers 404); restore first.
    <RoundCheck checked={done} priority={task.priority} title={task.deletedTime ? undefined : t('markComplete')} onClick={task.deletedTime ? undefined : () => void toggleComplete(task)} />
  );
  const actions = (
    <>
      {task.deletedTime ? (
        <span className="flex w-10 shrink-0 gap-1">
          <button
            type="button"
            title={t('restore')}
            className="text-ink-3 opacity-0 transition-opacity hover:text-tt group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void restoreTask(task.id);
            }}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            title={t('deleteForever')}
            className="text-ink-3 opacity-0 transition-opacity hover:text-p-high group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void purgeTask(task.id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </span>
      ) : abandoned ? (
        <span className="flex w-10 shrink-0 gap-1">
          <button
            type="button"
            title={t('restore')}
            className="text-ink-3 opacity-0 transition-opacity hover:text-tt group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void restoreAbandoned(task.id);
            }}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            title={t('delete')}
            className="text-ink-3 opacity-0 transition-opacity hover:text-p-high group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void trashTask(task);
            }}
          >
            <Trash2 size={14} />
          </button>
        </span>
      ) : (
        <span className="flex w-10 shrink-0 items-center justify-end gap-1">
          {/* hover quick date */}
          <Popover
            align="right"
            trigger={(_o, toggle) => (
              <button
                type="button"
                title={t('setDate')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                className="text-ink-3 opacity-0 transition-opacity hover:text-tt group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <Calendar size={14} />
              </button>
            )}
          >
            {(close) => (
              <ScheduleMenu
                startDate={task.startDate}
                dueDate={task.dueDate}
                isAllDay={task.isAllDay}
                reminders={task.reminders}
                repeatFlag={task.repeatFlag}
                onSave={(schedule) => {
                  void saveTask(task.id, { projectId: task.projectId, ...schedule });
                  close();
                }}
              />
            )}
          </Popover>
          <Popover
            align="right"
            trigger={(_o, toggle) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuView('main');
                  toggle();
                }}
                title={t('more')}
                aria-label={t('more')}
                className="text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <MoreHorizontal size={15} />
              </button>
            )}
          >
            {(close) =>
              menuView === 'main' ? (
                <>
                  <MenuItem
                    icon={task.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    label={task.pinned ? t('unpinTask') : t('pinTask')}
                    onClick={() => {
                      close();
                      void saveTask(task.id, { projectId: task.projectId, pinned: !task.pinned });
                    }}
                  />
                  {focusEnabled && !done && (
                    <MenuItem
                      icon={<Timer size={14} />}
                      label={t('focusStartTask')}
                      onClick={() => {
                        close();
                        useFocus.getState().startForTask(task.id);
                        navigate('/app/focus');
                      }}
                    />
                  )}
                  <MenuItem
                    label={t('duplicateTask')}
                    onClick={() => {
                      close();
                      void duplicateTask(task);
                    }}
                  />
                  <MenuItem
                    label={t('moveTo')}
                    onClick={() => setMenuView('move')}
                  />
                  {!done && (
                    <MenuItem
                      label={t('abandonTask')}
                      icon={<Ban size={14} />}
                      onClick={() => {
                        close();
                        void abandonTask(task);
                      }}
                    />
                  )}
                  <MenuItem
                    // Completed tasks go to the trash too (undo + restore), so
                    // "delete forever" would misdescribe this action.
                    label={t('delete')}
                    danger
                    icon={<Trash2 size={14} />}
                    onClick={() => {
                      close();
                      void trashTask(task);
                    }}
                  />
                </>
              ) : (
                <MoveList
                  onPick={(projectId) => {
                    close();
                    const from = task.projectId;
                    void moveTask(task, projectId).then(() => {
                      const name = projectDisplayName(useStore.getState().projects.find((p) => p.id === projectId), t);
                      showToast({
                        messageKey: 'movedToast',
                        messageArg: name,
                        undo: () => {
                          const { tasks, completed } = useStore.getState();
                          const moved = tasks.find((x) => x.id === task.id) ?? completed.find((x) => x.id === task.id);
                          if (moved) void moveTask(moved, from);
                        },
                      });
                    });
                  }}
                />
              )
            }
          </Popover>
        </span>
      )}
    </>
  );

  // The attributes both layouts share: click to open, Ctrl/Cmd-click to multi-select, drag to reorder.
  const shared = {
    role: 'button' as const,
    tabIndex: 0,
    draggable: canDrag,
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!canDrag) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      setDropPos(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    },
    onDragLeave: () => setDropPos(null),
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const pos = dropPos;
      setDropPos(null);
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === task.id) return;
      void reorderTasks(draggedId, task.id, siblings, pos === 'after' ? 'after' : 'before');
    },
    onDragEnd: () => setDropPos(null),
    onClick: (e: MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        toggleSelect(task.id);
        return;
      }
      selectTask(task.id);
    },
    onKeyDown: (e: KeyboardEvent) => e.key === 'Enter' && selectTask(task.id),
  };
  const dropLine = (
    <>
      {dropPos === 'before' && <span className="absolute -top-px left-4 right-4 h-0.5 rounded bg-tt" />}
      {dropPos === 'after' && <span className="absolute -bottom-px left-4 right-4 h-0.5 rounded bg-tt" />}
    </>
  );

  if (layout === 'card') {
    const meta = [
      (task.dueDate || task.startDate) && <DateChip key="date" task={task} />,
      task.pinned && <span key="pin" title={t('pinned')}><Pin size={12} /></span>,
      task.reminders.length > 0 && <span key="bell" title={t('reminder')}><Bell size={12} /></span>,
      task.repeatFlag && <span key="repeat" title={t('repeat')}><Repeat size={12} /></span>,
      (task.content || task.desc) && <span key="desc" title={t('hasDescription')}><AlignLeft size={12} /></span>,
      subtasks > 0 && (
        <span key="items" className="inline-flex items-center gap-0.5 text-[11.5px]">
          <CheckSquare size={12} />
          {doneCount}/{subtasks}
        </span>
      ),
      ...task.tags.slice(0, 3).map((tag) => <span key={`tag:${tag}`} className="max-w-[96px] truncate text-[11.5px]">#{tag}</span>),
    ].filter(Boolean);
    return (
      <div
        {...shared}
        className={`group relative cursor-pointer rounded-lg px-3 py-2.5 transition-colors ${selected || checked ? 'bg-selected' : 'hover:bg-hover'} ${dropPos ? 'ring-1 ring-tt/50' : ''}`}
      >
        {dropLine}
        <div className="flex items-start gap-2">
          <span className="mt-px">{check}</span>
          <div className="min-w-0 flex-1">
            <span className={`line-clamp-3 break-words text-[13.5px] leading-[1.45] ${done || abandoned ? 'text-ink-3 line-through' : 'text-ink'}`}>
              {titleText}
            </span>
            {snippet}
            {meta.length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">{meta}</div>}
          </div>
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div
      {...shared}
      className={`group relative flex cursor-pointer items-center gap-3 border-b border-line/70 px-5 py-[9px] transition-colors ${
        selected || checked ? 'bg-selected' : 'hover:bg-hover'
      } ${dropPos ? 'ring-1 ring-tt/50' : ''}`}
    >
      {dropLine}
      {selectBox}
      {check}
      <div className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${done || abandoned ? 'text-ink-3 line-through' : 'text-ink'}`}>
          {titleText}
        </span>
        {snippet}
        {showDetails && (
          <div className="mt-0.5 flex min-w-0 items-center gap-2 truncate text-[11px] text-ink-3">
            {/* The description's first line, as text (search rows show their own excerpt). */}
            {(task.content || task.desc) && <span className="truncate">{(!snippet && descriptionPreview(task.content || task.desc)) || t('hasDescription')}</span>}
            {task.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="shrink-0">#{tag}</span>
            ))}
            {subtasks > 0 && (
              <span className="inline-flex shrink-0 items-center gap-0.5">
                <CheckSquare size={12} />
                {task.items.filter((i) => i.status === 2).length}/{subtasks}
              </span>
            )}
          </div>
        )}
      </div>
      {/* inline indicators */}
      <span className="hidden shrink-0 items-center gap-1.5 text-ink-3 group-hover:hidden sm:flex">
        {task.pinned && (
          <span title={t('pinned')}><Pin size={12} /></span>
        )}
        {task.reminders.length > 0 && (
          <span title={t('reminder')}><Bell size={12} /></span>
        )}
        {task.repeatFlag && (
          <span title={t('repeat')}><Repeat size={12} /></span>
        )}
        {(task.content || task.desc) && (
          <span title={t('hasDescription')}><AlignLeft size={12} /></span>
        )}
      </span>
      {subtasks > 0 && !done && !showDetails && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] text-ink-3">
          <CheckSquare size={12} />
          {task.items.filter((i) => i.status === 2).length}/{subtasks}
        </span>
      )}
      {badge && (
        <span className="hidden items-center gap-1 text-[12px] text-ink-3 sm:flex">
          {badge.emoji ? (
            <span className="text-[12px] leading-none">{badge.emoji}</span>
          ) : (
            <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: badge.color }} />
          )}
          <span className="max-w-[120px] truncate">
            {badge.emoji ? badge.name.slice(badge.emoji.length).trim() : badge.name}
          </span>
        </span>
      )}
      <DateChip task={task} />
      {actions}
    </div>
  );
}

function MoveList({ onPick }: { onPick: (projectId: string) => void }) {
  const projects = useStore((s) => s.projects);
  const t = useT();
  return (
    <div className="max-h-64 overflow-y-auto">
      {projects.map((p) => (
        <MenuItem key={p.id} label={projectDisplayName(p, t)} onClick={() => onPick(p.id)} />
      ))}
    </div>
  );
}
