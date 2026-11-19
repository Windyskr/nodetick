import { Check, CalendarDays, CalendarPlus, CalendarRange, Trash2, Flag, FolderInput, X } from 'lucide-react';
import { useStore } from '../../stores/store';
import { MenuItem, Popover } from '../../components/Popover';
import { useT, useTF } from '../../i18n';
import { addDays, allDayDate, todayStr } from '../../lib/date';
import { projectDisplayName } from '../../lib/project';
import { PRIORITY_LEVELS, priorityLabel } from '../../components/RoundCheck';

/**
 * TickTick-style floating toolbar for multi-selected tasks: complete, move,
 * quick date, priority, delete. Rendered by TasksPage whenever the
 * selection is non-empty.
 */
export default function BatchBar() {
  const { selectedIds, projects, clearSelection, batchComplete, batchTrash, batchMove, batchSetDate, batchPriority } =
    useStore();
  const t = useT();
  const f = useTF();
  if (selectedIds.length === 0) return null;

  const today = todayStr();
  const setDate = (day: string | null) => {
    void batchSetDate(day ? allDayDate(day) : null, true);
  };

  return (
    <div className="sticky top-0 z-20 mx-4 mb-1 flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.10)]">
      <span className="mr-1 text-[13px] font-medium text-tt">{f('selectedCount', selectedIds.length)}</span>

      <button
        type="button"
        title={t('batchComplete')}
        onClick={() => void batchComplete()}
        className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-tt"
      >
        <Check size={17} />
      </button>

      <Popover
        trigger={(_o, toggle) => (
          <button type="button" title={t('setDate')} onClick={toggle} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
            <CalendarDays size={16} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon={<CalendarDays size={14} />} label={t('relToday')} onClick={() => { close(); setDate(today); }} />
            <MenuItem icon={<CalendarPlus size={14} />} label={t('relTomorrow')} onClick={() => { close(); setDate(addDays(today, 1)); }} />
            <MenuItem icon={<CalendarRange size={14} />} label={t('nextWeek')} onClick={() => { close(); setDate(addDays(today, 7)); }} />
            <MenuItem label={t('clear')} onClick={() => { close(); setDate(null); }} />
          </>
        )}
      </Popover>

      <Popover
        trigger={(_o, toggle) => (
          <button type="button" title={f('priorityTitle', priorityLabel(0))} onClick={toggle} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
            <Flag size={16} />
          </button>
        )}
      >
        {(close) => (
          <>
            {PRIORITY_LEVELS.map((p) => (
              <MenuItem
                key={p}
                label={priorityLabel(p)}
                onClick={() => {
                  close();
                  void batchPriority(p);
                }}
              />
            ))}
          </>
        )}
      </Popover>

      <Popover
        trigger={(_o, toggle) => (
          <button type="button" title={t('moveTo')} onClick={toggle} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
            <FolderInput size={16} />
          </button>
        )}
      >
        {(close) => (
          <div className="max-h-64 overflow-y-auto">
            {projects.map((p) => (
              <MenuItem
                key={p.id}
                label={projectDisplayName(p, t)}
                onClick={() => {
                  close();
                  void batchMove(p.id);
                }}
              />
            ))}
          </div>
        )}
      </Popover>

      <button
        type="button"
        title={t('delete')}
        onClick={() => void batchTrash()}
        className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-p-high"
      >
        <Trash2 size={16} />
      </button>

      <span className="flex-1" />
      <button
        type="button"
        title={t('close')}
        onClick={clearSelection}
        className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
      >
        <X size={16} />
      </button>
    </div>
  );
}
