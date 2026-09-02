import { useEffect, useState } from 'react';
import { Calendar, Flag, Inbox, Plus, Trash2, X } from 'lucide-react';
import type { Task, TaskComment } from '../../lib/types';
import { useStore, INBOX_ID } from '../../stores/store';
import { api } from '../../lib/api';
import { relTime, todayStr } from '../../lib/date';
import { scheduleLabel } from '../../components/taskSchedule';
import { RoundCheck, PRIORITY_COLORS, priorityLabel } from '../../components/RoundCheck';
import { ScheduleMenu, type TaskSchedule } from '../../components/ScheduleMenu';
import { MenuItem, Popover } from '../../components/Popover';
import { useT, useTF } from '../../i18n';
import { projectDisplayName } from '../../lib/project';

/**
 * Right-hand task detail panel, TickTick-style: title, description,
 * subtasks, tags, comments, and a bottom bar with list + actions.
 */
export default function TaskDetail({ task }: { task: Task }) {
  const { projects, saveTask, toggleComplete, trashTask, selectTask } = useStore();
  const t = useT();
  const f = useTF();
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.content);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [addingTag, setAddingTag] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDesc(task.content);
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
  useEffect(() => setDesc(task.content), [task.content]);

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) void saveTask(task.id, { title: next });
    else setTitle(task.title);
  };
  const commitDesc = () => {
    if (desc !== task.content) void saveTask(task.id, { content: desc });
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
    if (!task.tags.includes(t)) void saveTask(task.id, { tags: [...task.tags, t] });
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
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-line bg-white">
      {/* top row */}
      <div className="flex items-center gap-3 px-5 pb-2 pt-4">
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
              {[3, 2, 1, 0].map((p) => (
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
      <div className="min-h-0 flex-1 overflow-y-auto px-5">
        {task.focusSummaries?.[0]?.estimatedPomo != null && (
          <div className="mb-2 text-[12px] text-tt">
            {f('estimatedPomo', task.focusSummaries[0].estimatedPomo ?? 0)}
          </div>
        )}
        <textarea
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className="w-full resize-none bg-transparent text-[20px] font-bold leading-snug text-ink"
          style={{ height: 'auto' }}
          onInput={(e) => {
            const el = e.target as HTMLTextAreaElement;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
        />
        <textarea
          value={desc}
            placeholder={t('description')}
          rows={4}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={commitDesc}
          className="mt-2 w-full bg-transparent text-[13.5px] leading-relaxed text-ink-2 placeholder:text-ink-3"
        />

        {/* subtasks */}
        <div className="mt-4">
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            {t('subtasks')} {task.items.length > 0 && `· ${task.items.filter((i) => i.status === 2).length}/${task.items.length}`}
          </div>
          {task.items.map((item) => (
            <div key={item.id} className="group flex items-center gap-2.5 py-[6px]">
              <RoundCheck checked={item.status === 2} size={16} onClick={() => toggleItem(item.id)} />
              <span className={`flex-1 text-[14px] ${item.status === 2 ? 'text-ink-3 line-through' : ''}`}>
                {item.title}
              </span>
              <button
                type="button"
                title="Remove subtask"
                className="hidden text-ink-3 hover:text-p-high group-hover:block"
                onClick={() => setItems(task.items.filter((i) => i.id !== item.id))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2.5 py-[6px]">
            <Plus size={16} className="text-ink-3" />
            <input
              value={newSubtask}
              placeholder={t('addSubtask')}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
              className="w-full bg-transparent text-[14px] placeholder:text-ink-3"
            />
          </div>
        </div>

        {/* tags */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
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
        <div className="mt-6">
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{t('comments')}</div>
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
            onKeyDown={(e) => e.key === 'Enter' && void sendComment()}
            className="mt-2 w-full rounded-md bg-hover px-3 py-2 text-[13px] placeholder:text-ink-3"
          />
        </div>
        <div className="h-6" />
      </div>

      {/* bottom bar */}
      <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-ink-3">
        <Popover
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
          title={t('deleteToTrash')}
          className="rounded-md p-1.5 hover:bg-hover hover:text-p-high"
          onClick={() => {
            void trashTask(task);
            selectTask(null);
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </aside>
  );
}
