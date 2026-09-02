import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import type { Task } from '../lib/types';
import { useT } from '../i18n';
import { TaskRow } from '../pages/app/TaskRow';

const PREVIEW_COUNT = 5;

/**
 * Collapsible "Completed" group that previews a handful of rows and expands
 * on demand, like TickTick's 查看更多.
 */
export function CompletedGroup({
  tasks,
  sorter,
  showProject = false,
  showDetails = false,
}: {
  tasks: Task[];
  sorter?: (a: Task, b: Task) => number;
  showProject?: boolean;
  showDetails?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const sorted = sorter ? [...tasks].sort(sorter) : [...tasks].sort((a, b) => (b.completedTime ?? '').localeCompare(a.completedTime ?? ''));
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - visible.length;

  return (
    <div>
      <div className="flex items-center gap-1 px-5 pb-1 pt-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[14px] font-bold text-ink"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {t('groupCompleted')}
          <span className="ml-1 font-normal text-ink-3">{tasks.length}</span>
        </button>
      </div>
      {open && (
        <div>
          {visible.map((task) => (
            <TaskRow key={task.id} task={task} showProject={showProject} showDetails={showDetails} />
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full px-5 py-2.5 text-left text-[13px] text-tt hover:bg-hover"
            >
              {t('viewMore')}
            </button>
          )}
          {expanded && sorted.length > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="flex w-full items-center gap-1 px-5 py-2.5 text-left text-[13px] text-ink-3 hover:bg-hover"
            >
              <ChevronUp size={13} /> {t('showLess')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
