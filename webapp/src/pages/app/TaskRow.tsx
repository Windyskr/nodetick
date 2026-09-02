import { useState } from 'react';
import { AlignLeft, Bell, Calendar, MoreHorizontal, Repeat, RotateCcw, Trash2 } from 'lucide-react';
import type { Task } from '../../lib/types';
import { useStore } from '../../stores/store';
import { dayOf, scheduleLabel, todayStr } from '../../components/taskSchedule';
import { RoundCheck } from '../../components/RoundCheck';
import { ScheduleMenu } from '../../components/ScheduleMenu';
import { MenuItem, Popover } from '../../components/Popover';
import { useT, type Key } from '../../i18n';
import { projectDisplayName } from '../../lib/project';

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
}: {
  task: Task;
  showProject?: boolean;
  showDetails?: boolean;
}) {
  const { selectTask, selectedTaskId, toggleComplete, trashTask, restoreTask, purgeTask, saveTask, duplicateTask, moveTask, showToast } =
    useStore();
  const t = useT();
  const [menuView, setMenuView] = useState<'main' | 'move'>('main');
  const selected = selectedTaskId === task.id;
  const done = task.status === 2;
  const badge = showProject ? projectBadge(task.projectId, t) : null;
  const subtasks = task.items.length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => selectTask(task.id)}
      onKeyDown={(e) => e.key === 'Enter' && selectTask(task.id)}
      className={`group flex cursor-pointer items-center gap-3 border-b border-line/70 px-5 py-[10px] transition-colors ${
        selected ? 'bg-selected' : 'hover:bg-hover'
      }`}
    >
      <RoundCheck checked={done} priority={task.priority} onClick={() => void toggleComplete(task)} />
      <div className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${done ? 'text-ink-3 line-through' : 'text-ink'}`}>
          {task.title || <span className="text-ink-3">{t('untitled')}</span>}
        </span>
        {showDetails && (
          <div className="mt-0.5 flex min-w-0 items-center gap-2 truncate text-[11px] text-ink-3">
            {(task.content || task.desc) && <span className="truncate">{t('hasDescription')}</span>}
            {task.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="shrink-0">#{tag}</span>
            ))}
            {subtasks > 0 && <span className="shrink-0">☑ {task.items.filter((i) => i.status === 2).length}/{subtasks}</span>}
          </div>
        )}
      </div>
      {/* inline indicators */}
      <span className="hidden shrink-0 items-center gap-1.5 text-ink-3 group-hover:hidden sm:flex">
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
        <span className="text-[12px] text-ink-3">☑ {task.items.filter((i) => i.status === 2).length}/{subtasks}</span>
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

      {task.deletedTime ? (
        <span className="flex w-10 shrink-0 gap-1">
          <button
            type="button"
            title={t('restore')}
            className="text-ink-3 opacity-0 transition-opacity hover:text-tt group-hover:opacity-100"
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
            className="text-ink-3 opacity-0 transition-opacity hover:text-p-high group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              void purgeTask(task.id);
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
                className="text-ink-3 opacity-0 transition-opacity hover:text-tt group-hover:opacity-100"
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
                className="text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
              >
                <MoreHorizontal size={15} />
              </button>
            )}
          >
            {(close) =>
              menuView === 'main' ? (
                <>
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
                  <MenuItem
                    label={done ? t('deleteForever') : t('delete')}
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
                    void moveTask(task, projectId).then(() => {
                      const name = projectDisplayName(useStore.getState().projects.find((p) => p.id === projectId), t);
                      showToast({ messageKey: 'movedToast', messageArg: name });
                    });
                  }}
                />
              )
            }
          </Popover>
        </span>
      )}
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
