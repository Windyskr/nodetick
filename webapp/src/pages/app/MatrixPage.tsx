import { useMemo, useState, type DragEvent } from 'react';
import { useStore } from '../../stores/store';
import { useT } from '../../i18n';
import type { Task } from '../../lib/types';
import { TaskRow } from './TaskRow';
import { PRIORITY } from '../../components/RoundCheck';

/**
 * Eisenhower matrix. Priority maps to quadrants the TickTick way:
 * High = Urgent & Important, Medium = Important, Low = Urgent, None = neither.
 */
const QUADRANTS: { titleKey: 'q1' | 'q2' | 'q3' | 'q4'; hintKey: 'q1hint' | 'q2hint' | 'q3hint' | 'q4hint'; priority: number; tint: string }[] = [
  { titleKey: 'q1', hintKey: 'q1hint', priority: PRIORITY.high, tint: '#d54848' },
  { titleKey: 'q2', hintKey: 'q2hint', priority: PRIORITY.medium, tint: '#faa80c' },
  { titleKey: 'q3', hintKey: 'q3hint', priority: PRIORITY.low, tint: '#4772fa' },
  { titleKey: 'q4', hintKey: 'q4hint', priority: PRIORITY.none, tint: '#9aa0a6' },
];

export default function MatrixPage() {
  const { tasks, saveTask } = useStore();
  const t = useT();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverPriority, setDragOverPriority] = useState<number | null>(null);

  const byPriority = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const q of QUADRANTS) map.set(q.priority, []);
    for (const t2 of tasks) {
      if (t2.parentId) continue;
      map.get(t2.priority)?.push(t2);
    }
    return map;
  }, [tasks]);

  const dropTask = (priority: number, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const taskId = draggedTaskId ?? event.dataTransfer.getData('text/plain');
    setDraggedTaskId(null);
    setDragOverPriority(null);
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.priority === priority) return;
    void saveTask(task.id, { projectId: task.projectId, priority });
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-16 min-w-0 shrink-0 items-center px-5">
        <h1 className="text-[20px] font-bold">{t('matrixTitle')}</h1>
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 overflow-y-auto px-[22px] pb-[15px] lg:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-rows-2 lg:overflow-hidden">
        {QUADRANTS.map((q) => {
          const list = byPriority.get(q.priority) ?? [];
          return (
            <div
              key={q.priority}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverPriority(q.priority);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragOverPriority((current) => current === q.priority ? null : current);
                }
              }}
              onDrop={(event) => dropTask(q.priority, event)}
              className={`flex min-h-[220px] min-w-0 max-w-full flex-col rounded-xl border transition-colors ${
                dragOverPriority === q.priority ? 'border-tt bg-tt-light/30 ring-2 ring-tt/10' : 'border-line'
              }`}
            >
              <div className="flex min-w-0 items-baseline gap-2 border-b border-line/70 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: q.tint }} />
                <span className="text-[14px] font-semibold">{t(q.titleKey)}</span>
                <span className="min-w-0 truncate text-[12px] text-ink-3">{t(q.hintKey)}</span>
                <span className="ml-auto text-[12px] text-ink-3">{list.length}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {list.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-ink-3">{t('matrixEmpty')}</div>
                ) : (
                  list.map((t2) => (
                    <div
                      key={t2.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', t2.id);
                        setDraggedTaskId(t2.id);
                      }}
                      onDragEnd={() => {
                        setDraggedTaskId(null);
                        setDragOverPriority(null);
                      }}
                      className={draggedTaskId === t2.id ? 'opacity-45' : ''}
                    >
                      <TaskRow task={t2} showProject />
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
