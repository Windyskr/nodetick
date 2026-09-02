import { useMemo } from 'react';
import { useStore } from '../../stores/store';
import { useT } from '../../i18n';
import type { Task } from '../../lib/types';
import { TaskRow } from './TaskRow';

/**
 * Eisenhower matrix. Priority maps to quadrants the TickTick way:
 * High = Urgent & Important, Medium = Important, Low = Urgent, None = neither.
 */
const QUADRANTS: { titleKey: 'q1' | 'q2' | 'q3' | 'q4'; hintKey: 'q1hint' | 'q2hint' | 'q3hint' | 'q4hint'; priority: number; tint: string }[] = [
  { titleKey: 'q1', hintKey: 'q1hint', priority: 3, tint: '#d54848' },
  { titleKey: 'q2', hintKey: 'q2hint', priority: 2, tint: '#faa80c' },
  { titleKey: 'q3', hintKey: 'q3hint', priority: 1, tint: '#4772fa' },
  { titleKey: 'q4', hintKey: 'q4hint', priority: 0, tint: '#9aa0a6' },
];

export default function MatrixPage() {
  const tasks = useStore((s) => s.tasks);
  const t = useT();

  const byPriority = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const q of QUADRANTS) map.set(q.priority, []);
    for (const t2 of tasks) {
      if (t2.parentId) continue;
      map.get(t2.priority)?.push(t2);
    }
    return map;
  }, [tasks]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="min-w-0 px-5 pb-1 pt-4">
        <h1 className="text-[20px] font-bold">{t('matrixTitle')}</h1>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 p-4 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
        {QUADRANTS.map((q) => {
          const list = byPriority.get(q.priority) ?? [];
          return (
            <div key={q.priority} className="flex min-w-0 max-w-full min-h-[220px] flex-col rounded-xl border border-line">
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
                  list.map((t2) => <TaskRow key={t2.id} task={t2} showProject />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
