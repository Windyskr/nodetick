import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import type { Column, Task } from '../../lib/types';
import { useStore } from '../../stores/store';
import { useT } from '../../i18n';
import { TaskRow } from './TaskRow';

/**
 * Kanban board for a project: one column per task_columns row plus an
 * "Uncategorized" first column. Cards move via HTML5 drag & drop.
 */
export default function KanbanBoard({
  projectId,
  sorter,
}: {
  projectId: string;
  sorter: (a: Task, b: Task) => number;
}) {
  const { tasks, upsertTask, projects } = useStore();
  const t = useT();
  const viewMode = projects.find((p) => p.id === projectId)?.viewMode;
  const [columns, setColumns] = useState<Column[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.projectData(projectId).then((data) => {
      if (alive) setColumns(data.columns);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    const loose: Task[] = [];
    for (const t of tasks) {
      if (t.projectId !== projectId) continue;
      if (t.columnId && columns.some((c) => c.id === t.columnId)) {
        const list = map.get(t.columnId) ?? [];
        list.push(t);
        map.set(t.columnId, list);
      } else {
        loose.push(t);
      }
    }
    for (const [, list] of map) list.sort(sorter);
    loose.sort(sorter);
    return { map, loose };
  }, [tasks, projectId, columns, sorter]);

  const move = async (taskId: string, columnId: string | null) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || (task.columnId ?? null) === columnId) return;
    upsertTask({ ...task, columnId });
    await api.updateTask(taskId, { projectId, columnId });
  };

  const addColumn = async () => {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    const col = await api.createColumn(projectId, name);
    setColumns((cols) => [...cols, col]);
    setNewName('');
    setAdding(false);
  };

  const drop = (columnId: string | null) => {
    const id = dragOver && dragOver.startsWith('task:') ? dragOver.slice(5) : null;
    setDragOver(null);
    if (id) void move(id, columnId);
  };

  const cell = (columnId: string | null, title: string, list: Task[]) => (
    <div
      key={columnId ?? '__none'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver((cur) => (cur?.startsWith('task:') ? cur : `col:${columnId ?? 'none'}`));
      }}
      onDragLeave={() => setDragOver((cur) => (cur === `col:${columnId ?? 'none'}` ? null : cur))}
      onDrop={() => drop(columnId)}
      className={`flex max-h-full w-[270px] shrink-0 flex-col rounded-xl bg-[#f7f7f7] ${
        dragOver === `col:${columnId ?? 'none'}` ? 'ring-2 ring-tt/40' : ''
      }`}
    >
      <div className="px-4 pb-1 pt-3 text-[13px] font-semibold text-ink-2">
        {title} <span className="ml-1 font-normal text-ink-3">{list.length}</span>
      </div>
      <div className="min-h-[80px] flex-1 overflow-y-auto px-2 pb-2">
        {list.map((t) => (
          <div
            key={t.id}
            draggable
            onDragStart={() => setDragOver(`task:${t.id}`)}
            onDragEnd={() => setDragOver(null)}
            onDrop={(e) => {
              e.stopPropagation();
              drop(columnId);
            }}
            className="mt-2 rounded-lg bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
          >
            {/* board cards reuse the row chrome without the bottom border */}
            <div className="[&>div]:border-b-0">
              <TaskRow task={t} showProject={false} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-5 pb-6 pt-2">
      {cell(null, t('uncategorized'), byColumn.loose)}
      {columns.map((c) => cell(c.id, c.name, byColumn.map.get(c.id) ?? []))}
      <div className="w-[270px] shrink-0">
        {adding ? (
          <input
            autoFocus
            value={newName}
            placeholder={t('columnNamePh')}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => void addColumn()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addColumn();
              if (e.key === 'Escape') {
                setNewName('');
                setAdding(false);
              }
            }}
            className="w-full rounded-lg border border-tt px-3 py-2 text-[13px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-3 text-[13px] text-ink-3 hover:border-tt hover:text-tt"
          >
            <Plus size={14} /> {t('addColumn')}
          </button>
        )}
      </div>
      {/* viewMode dependency keeps columns fresh after a project switch */}
      <span className="hidden">{viewMode}</span>
    </div>
  );
}
