import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Calendar, Flag, Inbox, MessageSquare, MoreHorizontal, Pin, PinOff, Plus, Timer, Trash2, X } from 'lucide-react';
import type { Task, TaskComment } from '../../lib/types';
import { useStore, INBOX_ID } from '../../stores/store';
import { api } from '../../lib/api';
import { relTime, todayStr } from '../../lib/date';
import { scheduleLabel } from '../../components/taskSchedule';
import { RoundCheck, PRIORITY_COLORS, PRIORITY_LEVELS, priorityLabel } from '../../components/RoundCheck';
import { ScheduleMenu, type TaskSchedule } from '../../components/ScheduleMenu';
import { MenuItem, Popover } from '../../components/Popover';
import { useT, useTF } from '../../i18n';
import { projectDisplayName } from '../../lib/project';
import { isSubmitEnter } from '../../lib/keys';
import { hasTag } from '../../lib/tags';
import { useFocus } from '../../stores/focus';
import { TaskFocusTotal } from './focus/TaskFocusTotal';
import { RichTextEditor } from '../../components/editor';

/**
 * Right-hand task detail panel, TickTick-style: title, description,
 * subtasks, tags, comments, and a bottom bar with list + actions.
 */
export default function TaskDetail({ task, variant = 'panel' }: { task: Task; variant?: 'panel' | 'modal' }) {
  const { projects, saveTask, toggleComplete, trashTask, abandonTask, selectTask } = useStore();
  const focusEnabled = useStore((state) => state.features.focus);
  const navigate = useNavigate();
  const t = useT();
  const f = useTF();
  const [title, setTitle] = useState(task.title);
  /** A description edit that hasn't been saved yet (kept in the editor if the save fails). */
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    let alive = true;
    api.listComments(task.projectId, task.id).then(
      (rows) => alive && setComments(rows),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep local edit buffers in sync when the task changes elsewhere.
  useEffect(() => setTitle(task.title), [task.title]);

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) void saveTask(task.id, { title: next });
    else setTitle(task.title);
  };
  // The editor reports Markdown while typing (debounced), on blur and when
  // the panel closes; saves of one task go out in order (saveTask).
  const commitDesc = (content: string) => {
    if (content === task.content) {
      setDescDraft(null);
      return;
    }
    setDescDraft(content);
    // A failed save keeps the draft, so the text stays; the app reports the error.
    void saveTask(task.id, { content }).then(() => setDescDraft((draft) => (draft === content ? null : draft)));
  };

  const setSchedule = (schedule: TaskSchedule) => {
    void saveTask(task.id, { ...schedule });
  };

  const setPriority = (priority: number) => void saveTask(task.id, { priority });

  const setProject = (projectId: string) => void saveTask(task.id, { projectId });

  const setItems = (items: Task['items']) => void saveTask(task.id, { items });

  const toggleItem = (itemId: string) =>
    setItems(
      task.items.map((i) => (i.id === itemId ? { ...i, status: i.status === 2 ? 0 : 2 } : i)),
    );

  const addSubtask = () => {
    const t = newSubtask.trim();
    if (!t) return;
    setItems([
      ...task.items,
      {
        id: `sub-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        title: t,
        status: 0,
        sortOrder: task.items.length,
        startDate: null,
        isAllDay: false,
        timeZone: null,
        completedTime: null,
      },
    ]);
    setNewSubtask('');
  };

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '');
    if (!t) {
      setAddingTag(false);
      return;
    }
    if (!hasTag(task, t)) void saveTask(task.id, { tags: [...task.tags, t] });
    setTagDraft('');
    setAddingTag(false);
  };

  const removeTag = (t: string) => void saveTask(task.id, { tags: task.tags.filter((x) => x !== t) });

  const sendComment = async () => {
    const text = commentDraft.trim();
    if (!text) return;
    const c = await api.addComment(task.projectId, task.id, text);
    setComments((rows) => [...rows, c]);
    setCommentDraft('');
  };

  const done = task.status === 2;
  const overdue = !!task.dueDate && task.dueDate.slice(0, 10) < todayStr() && !done;
  const priority = task.priority;
  const project = projects.find((p) => p.id === task.projectId);

  return (
    <aside className={`flex shrink-0 flex-col bg-white ${variant === 'modal' ? 'h-auto max-h-[calc(100vh-80px)] min-h-[300px] w-[400px] overflow-hidden rounded-xl border border-line shadow-[0_12px_36px_rgba(0,0,0,0.18)]' : 'h-full w-full'}`}>
      {/* top row */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <RoundCheck checked={done} priority={priority} onClick={() => void toggleComplete(task)} />
        <Popover
          trigger={(_o, toggle) => (
            <button
              type="button"
              onClick={toggle}
              className={`flex items-center gap-1.5 text-[13px] ${overdue ? 'text-p-high' : 'text-ink-3 hover:text-ink-2'}`}
            >
              <Calendar size={14} />
              {scheduleLabel(task.startDate, task.dueDate, task.isAllDay) || t('setDate')}
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
                setSchedule(schedule);
                close();
              }}
            />
          )}
        </Popover>
        <span className="flex-1" />
        <Popover
          align="right"
          trigger={(_o, toggle) => (
            <button
              type="button"
              onClick={toggle}
              title={f('priorityTitle', priorityLabel(priority))}
              className={priority > 0 ? '' : 'text-ink-3 hover:text-ink-2'}
              style={priority > 0 ? { color: PRIORITY_COLORS[priority] } : undefined}
            >
              <Flag size={16} />
            </button>
          )}
        >
          {(close) => (
            <>
              {PRIORITY_LEVELS.map((p) => (
                <MenuItem
                  key={p}
                  label={`${priority === p ? '✓ ' : ''}${priorityLabel(p)}`}
                  onClick={() => {
                    setPriority(p);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </Popover>
      </div>

      {/* scrollable body */}
      <div className="group/detail min-h-0 flex-1 overflow-y-auto px-6 pt-4">
        {task.focusSummaries?.[0]?.estimatedPomo != null && (
          <div className="mb-2 text-[12px] text-tt">
            {f('estimatedPomo', task.focusSummaries[0].estimatedPomo ?? 0)}
          </div>
        )}
        {focusEnabled && <TaskFocusTotal taskId={task.id} />}
        <textarea
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (isSubmitEnter(e)) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="w-full resize-none bg-transparent text-[20px] font-bold leading-snug text-ink outline-none"
          style={{ height: 'auto' }}
          onInput={(e) => {
            const el = e.target as HTMLTextAreaElement;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
        />
        <RichTextEditor
          value={descDraft ?? task.content}
          onChange={commitDesc}
          placeholder={t('taskContentPlaceholder')}
          ariaLabel={t('description')}
          className={`mt-1 ${variant === 'modal' ? 'min-h-[48px]' : 'min-h-[96px]'}`}
        />

        {/* subtasks */}
        <div className="mt-2">
          {task.items.length > 0 && (
            <div className="mb-1 text-[12px] font-semibold text-ink-3">
              {t('subtasks')} · {task.items.filter((i) => i.status === 2).length}/{task.items.length}
            </div>
          )}
          {task.items.map((item) => (
            <div key={item.id} className="group flex items-center gap-2.5 py-[6px]">
              <RoundCheck checked={item.status === 2} size={16} onClick={() => toggleItem(item.id)} />
              <span className={`flex-1 text-[14px] ${item.status === 2 ? 'text-ink-3 line-through' : ''}`}>
                {item.title}
              </span>
              <button
                type="button"
                title={t('removeSubtask')}
                aria-label={t('removeSubtask')}
                className="hidden text-ink-3 hover:text-p-high group-hover:block"
                onClick={() => setItems(task.items.filter((i) => i.id !== item.id))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className={`flex items-center gap-2.5 py-[6px] transition-opacity ${task.items.length > 0 || newSubtask ? 'opacity-100' : 'opacity-0 group-hover/detail:opacity-100 focus-within:opacity-100'}`}>
            <Plus size={16} className="text-ink-3" />
            <input
              value={newSubtask}
              placeholder={t('addSubtask')}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => isSubmitEnter(e) && addSubtask()}
              className="w-full bg-transparent text-[14px] placeholder:text-ink-3"
            />
          </div>
        </div>

        {/* tags */}
        <div className={`mt-3 flex flex-wrap items-center gap-2 transition-opacity ${task.tags.length > 0 || addingTag ? 'opacity-100' : 'opacity-0 group-hover/detail:opacity-100'}`}>
          {task.tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-md bg-hover px-2 py-0.5 text-[12px] text-ink-2"
            >
              #{t}
              <button type="button" onClick={() => removeTag(t)} className="text-ink-3 hover:text-p-high">
                <X size={11} />
              </button>
            </span>
          ))}
          {addingTag ? (
            <input
              autoFocus
              value={tagDraft}
              placeholder={t('addTag').toLowerCase()}
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={addTag}
              onKeyDown={(e) => isSubmitEnter(e) && addTag()}
              className="w-24 rounded-md border border-tt px-2 py-0.5 text-[12px]"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingTag(true)}
              className="flex items-center gap-0.5 rounded-md bg-hover px-2 py-0.5 text-[12px] text-ink-3 hover:text-tt"
            >
              <Plus size={11} /> {t('addTag')}
            </button>
          )}
        </div>

        {/* comments */}
        {commentsOpen && <div className="mt-6 border-t border-line pt-3">
          <div className="mb-1 text-[12px] font-semibold text-ink-3">{t('comments')}</div>
          {comments.map((c) => (
            <div key={c.id} className="border-b border-line/60 py-2">
              <div className="text-[13.5px] text-ink">{c.title}</div>
              <div className="mt-0.5 text-[11.5px] text-ink-3">{relTime(c.createdTime)}</div>
            </div>
          ))}
          <input
            value={commentDraft}
            placeholder={t('commentPlaceholder')}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => isSubmitEnter(e) && void sendComment()}
            className="mt-2 w-full rounded-md bg-hover px-3 py-2 text-[13px] placeholder:text-ink-3"
          />
        </div>}
        <div className="h-6" />
      </div>

      {/* bottom bar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-6 text-ink-3">
        <Popover
          side="top"
          trigger={(_o, toggle) => (
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] hover:bg-hover hover:text-ink-2"
            >
              {task.projectId === INBOX_ID ? <Inbox size={14} /> : <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: project?.color ?? '#4772FA' }} />}
              {projectDisplayName(project, t, task.projectId === INBOX_ID ? t('smartInbox') : '')}
            </button>
          )}
        >
          {(close) => (
            <div className="max-h-64 overflow-y-auto">
              {projects.map((p) => (
                <MenuItem
                  key={p.id}
                  label={`${p.id === task.projectId ? '✓ ' : ''}${projectDisplayName(p, t)}`}
                  onClick={() => {
                    if (p.id !== task.projectId) setProject(p.id);
                    close();
                  }}
                />
              ))}
            </div>
          )}
        </Popover>
        <span className="flex-1" />
        <button
          type="button"
          title={t('comments')}
          aria-pressed={commentsOpen}
          className={`rounded-md p-1.5 hover:bg-hover ${commentsOpen ? 'text-tt' : 'hover:text-ink'}`}
          onClick={() => setCommentsOpen((open) => !open)}
        >
          <MessageSquare size={17} />
        </button>
        <Popover
          align="right"
          side="top"
          trigger={(_open, toggle) => (
            <button type="button" title={t('viewOptions')} onClick={toggle} className="rounded-md p-1.5 hover:bg-hover hover:text-ink">
              <MoreHorizontal size={18} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={task.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                label={task.pinned ? t('unpinTask') : t('pinTask')}
                onClick={() => {
                  close();
                  void saveTask(task.id, { projectId: task.projectId, pinned: !task.pinned });
                }}
              />
              {focusEnabled && !done && (
                <MenuItem
                  icon={<Timer size={15} />}
                  label={t('focusStartTask')}
                  onClick={() => {
                    close();
                    useFocus.getState().startForTask(task.id);
                    navigate('/app/focus');
                  }}
                />
              )}
              {!done && (
                <MenuItem
                  icon={<Ban size={15} />}
                  label={t('abandonTask')}
                  onClick={() => {
                    close();
                    void abandonTask(task);
                    selectTask(null);
                  }}
                />
              )}
              <MenuItem
                icon={<Trash2 size={15} />}
                label={t('deleteToTrash')}
                danger
                onClick={() => {
                  close();
                  void trashTask(task);
                  selectTask(null);
                }}
              />
            </>
          )}
        </Popover>
      </div>
    </aside>
  );
}
