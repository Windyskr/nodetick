import { useFocus } from '../../../stores/focus';
import { useTF } from '../../../i18n';
import { useFocusStats } from './data';
import { PomoIcon, useLongDuration } from './ui';

/** "已专注 1小时20分 · 3🍅" in the task detail: the task's all-time focus. */
export function TaskFocusTotal({ taskId }: { taskId: string }) {
  const f = useTF();
  const long = useLongDuration();
  const version = useFocus((state) => state.recordsVersion);
  const { data } = useFocusStats({ taskId }, version);
  const total = data?.taskId === taskId ? data.total : null;
  if (!total || total.records === 0) return null;
  return (
    <div className="mb-2 flex items-center gap-1 text-[12px] text-ink-3">
      <span>{f('focusTaskFocused', long(total.seconds))}</span>
      {total.pomoCount > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span title={f('focusPomosLabel', total.pomoCount)}>
            <span aria-hidden="true" className="flex items-center gap-0.5">
              {total.pomoCount}
              <PomoIcon size={12} />
            </span>
            <span className="sr-only">{f('focusPomosLabel', total.pomoCount)}</span>
          </span>
        </>
      )}
    </div>
  );
}
