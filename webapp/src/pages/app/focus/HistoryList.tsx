import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MoreHorizontal, Pencil, Timer, Trash2 } from 'lucide-react';
import { MenuItem, Popover } from '../../../components/Popover';
import { localDayClock } from '../../../lib/date';
import type { Focus } from '../../../lib/types';
import { useT } from '../../../i18n';
import { recordKey } from './data';
import { dayLabel, ModalShell, PomoIcon, useCompactDuration, useLang } from './ui';

/**
 * The focus history grouped by local day, newest first. The next page loads
 * when the end of the list scrolls into view.
 */
export function HistoryList({
  records,
  hasMore,
  loading,
  failed,
  onMore,
  taskTitle,
  onEdit,
  onDelete,
  empty,
}: {
  records: Focus[];
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  onMore: () => void;
  /** Title of a linked task; undefined when it no longer exists. */
  taskTitle: (taskId: string) => string | undefined;
  onEdit: (record: Focus) => void;
  onDelete: (record: Focus) => void;
  empty: string;
}) {
  const t = useT();
  const lang = useLang();
  const compact = useCompactDuration();
  const sentinel = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const byDay = new Map<string, Focus[]>();
    for (const record of records) {
      const day = localDayClock(record.startTime)?.day;
      if (!day) continue;
      const list = byDay.get(day) ?? [];
      list.push(record);
      byDay.set(day, list);
    }
    return [...byDay.entries()];
  }, [records]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasMore || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onMore();
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, onMore, records.length]);

  if (!records.length && !loading) {
    return failed
      ? <div className="rounded-xl border border-line px-4 py-8 text-center text-[13px] text-p-high">{t('focusLoadError')}</div>
      : <div className="rounded-xl border border-line px-4 py-8 text-center text-[13px] text-ink-3">{empty}</div>;
  }

  return (
    <div>
      {groups.map(([day, group]) => (
        <section key={day} className="border-b border-line/70 last:border-b-0">
          <h4 className="pt-4 text-[12px] font-medium text-ink-3">{dayLabel(day, lang)}</h4>
          <ul className="pb-1 pt-1">
            {group.map((record) => {
              const start = localDayClock(record.startTime)?.clock ?? '';
              const end = localDayClock(record.endTime)?.clock ?? '';
              const title = record.taskId ? taskTitle(record.taskId) ?? t('focusDeletedTask') : null;
              const type = record.type === 0 ? t('focusPomodoro') : t('focusStopwatch');
              return (
                <li key={recordKey(record)} className="group relative flex items-start gap-3 rounded-lg py-3 pr-8 hover:bg-hover/60">
                  <button
                    type="button"
                    onClick={() => onEdit(record)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    aria-label={`${t('focusEditRecord')}: ${start}${end ? ` - ${end}` : ''}`}
                  >
                    <span className="w-[96px] shrink-0 pl-1 text-[12px] tabular-nums text-ink-2">
                      {start}{end ? ` - ${end}` : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[12px] text-ink-2">
                        <span title={type} className="flex items-center">
                          {record.type === 0 ? <PomoIcon size={13} /> : <Timer size={13} className="text-tt" />}
                          <span className="sr-only">{type}</span>
                        </span>
                        {compact(record.duration ?? 0)}
                        {record.added && <span className="rounded bg-hover px-1.5 py-px text-[10px] text-ink-3">{t('focusManual')}</span>}
                      </span>
                      {title && <span className="mt-1 block truncate text-[13px] text-ink">{title}</span>}
                      {record.note && <span className="mt-1 line-clamp-2 block whitespace-pre-line break-words text-[12px] text-ink-3">{record.note}</span>}
                    </span>
                  </button>
                  <div className="absolute right-1 top-2.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
                    <Popover
                      align="right"
                      panelClass="w-32"
                      trigger={(open, toggle) => (
                        <button
                          type="button"
                          onClick={toggle}
                          aria-expanded={open}
                          title={t('more')}
                          aria-label={t('more')}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
                        >
                          <MoreHorizontal size={15} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem icon={<Pencil size={14} />} label={t('focusEditRecord')} onClick={() => { close(); onEdit(record); }} />
                          <MenuItem icon={<Trash2 size={14} />} label={t('delete')} danger onClick={() => { close(); onDelete(record); }} />
                        </>
                      )}
                    </Popover>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div ref={sentinel} className="h-px" />
      {loading && (
        <div className="flex justify-center py-4 text-ink-3" aria-label={t('loading')}>
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}
      {failed && records.length > 0 && (
        <button type="button" onClick={onMore} className="block w-full py-3 text-center text-[12px] text-p-high hover:underline">
          {t('focusLoadError')}
        </button>
      )}
    </div>
  );
}

export function DeleteRecordDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <ModalShell title={t('focusDeleteRecordTitle')} onClose={onClose} className="w-[360px]">
      <p className="text-[13px] leading-5 text-ink-2">{t('focusDeleteRecordMessage')}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-5 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { setBusy(true); onConfirm(); }}
          className="h-10 rounded-lg bg-p-high px-5 text-[13px] text-white hover:opacity-90 disabled:opacity-50"
        >
          {t('delete')}
        </button>
      </div>
    </ModalShell>
  );
}
