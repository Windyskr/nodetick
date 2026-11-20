import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Shirt,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { Popover } from '../../components/Popover';
import type { Countdown } from '../../lib/types';
import { todayStr } from '../../lib/date';
import {
  COUNTDOWN_KINDS,
  isPastCountdown,
  orderBetween,
  readViewPrefs,
  saveViewPrefs,
  sortCountdowns,
  type CountdownKind,
  type CountdownSort,
  type CountdownViewPrefs,
} from '../../lib/countdown';
import { useCountdowns } from '../../stores/countdowns';
import { CountdownCard, CountdownRow, type CardDrag } from './CountdownCard';
import CountdownDetail from './CountdownDetail';
import CountdownEditor, { type CountdownDraft } from './CountdownEditor';
import { KIND_ICON, KIND_KEY, useCountdownText } from './countdownText';

const WIDE_QUERY = '(min-width: 1024px)';

function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}

type Editing = { countdown: Countdown | null; kind: CountdownKind; step: 1 | 2 };

export default function CountdownPage() {
  const { t } = useCountdownText();
  const { items, loaded, failed, allDayTime, load, loadAllDayTime, add, update, remove } = useCountdowns();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('countdown');
  const [prefs, setPrefs] = useState<CountdownViewPrefs>(readViewPrefs);
  const [archiveMode, setArchiveMode] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [focusNote, setFocusNote] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const wide = useWideScreen();
  const today = todayStr();

  useEffect(() => {
    void load();
    void loadAllDayTime();
  }, [load, loadAllDayTime]);

  const selected = selectedId ? items.find((item) => item.id === selectedId) ?? null : null;
  // A countdown opened from a link (reminder, calendar) shows in its own list.
  useEffect(() => {
    if (selected) setArchiveMode(selected.archived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const select = (id: string | null, note = false) => {
    setFocusNote(note);
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set('countdown', id);
      else next.delete('countdown');
      return next;
    }, { replace: true });
  };

  // Escape closes the detail like the task detail (the editor closes itself first).
  useEffect(() => {
    if (!selectedId || editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, editing]);

  const changePrefs = (patch: Partial<CountdownViewPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveViewPrefs(next);
  };

  const scoped = useMemo(() => items.filter((item) => item.archived === archiveMode), [items, archiveMode]);
  const visible = useMemo(() => {
    const shown = archiveMode || prefs.showPast ? scoped : scoped.filter((item) => !isPastCountdown(item, today));
    return sortCountdowns(shown, prefs.sort, today);
  }, [scoped, archiveMode, prefs.showPast, prefs.sort, today]);
  const groups = prefs.groupByKind
    ? COUNTDOWN_KINDS.map((kind) => ({ kind, items: visible.filter((item) => item.kind === kind) })).filter((group) => group.items.length > 0)
    : [{ kind: null, items: visible }];
  const archivedCount = items.filter((item) => item.archived).length;

  const quietly = (promise: Promise<unknown>) => void promise.catch((error: unknown) => console.error(error));
  const togglePin = (item: Countdown) => quietly(update(item.id, { pinned: !item.pinned }));
  const toggleArchive = (item: Countdown) => {
    if (selectedId === item.id) select(null);
    quietly(update(item.id, { archived: !item.archived }));
  };
  const removeItem = (item: Countdown) => {
    if (!window.confirm(t('deleteCountdownConfirm'))) return;
    if (selectedId === item.id) select(null);
    quietly(remove(item.id));
  };

  const saveDraft = async (draft: CountdownDraft) => {
    if (!editing) return;
    if (editing.countdown) {
      await update(editing.countdown.id, draft);
    } else {
      // New countdowns go last in the custom order.
      const last = items.reduce((max, item) => Math.max(max, item.sortOrder), 0);
      const created = await add({ ...draft, displayMode: 'on-day', pinned: false, archived: false, sortOrder: last + 1024 });
      setArchiveMode(false);
      // The side panel shows the new countdown; on small screens the sheet would hide the list.
      if (wide) select(created.id);
    }
    setEditing(null);
  };

  /** Custom order: drop `dragId` next to `target`, renumbering only when there is no gap. */
  const dropOn = (target: Countdown) => {
    const moving = visible.find((item) => item.id === dragId);
    setDragId(null);
    setOverId(null);
    if (!moving || moving.id === target.id || moving.pinned !== target.pinned) return;
    const without = visible.filter((item) => item.id !== moving.id);
    const index = without.findIndex((item) => item.id === target.id);
    const insertAt = visible.indexOf(moving) < visible.indexOf(target) ? index + 1 : index;
    const before = without[insertAt - 1] ?? null;
    const after = without[insertAt] ?? null;
    const order = orderBetween(before?.sortOrder ?? null, after?.sortOrder ?? null);
    if ((!before || before.sortOrder < order) && (!after || order < after.sortOrder)) {
      quietly(update(moving.id, { sortOrder: order }));
      return;
    }
    const next = [...without];
    next.splice(insertAt, 0, moving);
    next.forEach((item, position) => {
      if (item.sortOrder !== (position + 1) * 1024) quietly(update(item.id, { sortOrder: (position + 1) * 1024 }));
    });
  };

  const dragFor = (item: Countdown): CardDrag | undefined => (prefs.sort !== 'manual' ? undefined : {
    draggable: true,
    over: overId === item.id && dragId !== item.id,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.id);
      setDragId(item.id);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragId) return;
      event.preventDefault();
      setOverId(item.id);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      dropOn(item);
    },
    onDragEnd: () => {
      setDragId(null);
      setOverId(null);
    },
  });

  const actionsFor = (item: Countdown) => (
    <>
      {!item.archived && prefs.layout === 'cards' && (
        <button
          type="button"
          title={item.pinned ? t('countdownUnpin') : t('countdownPin')}
          aria-label={item.pinned ? t('countdownUnpin') : t('countdownPin')}
          aria-pressed={item.pinned}
          onClick={() => togglePin(item)}
          className={`flex h-8 w-8 items-center justify-center rounded-[7px] text-white ${item.pinned ? 'bg-tt' : 'bg-[#858585]'}`}
        >
          <Pin size={16} fill="currentColor" />
        </button>
      )}
      <Popover
        align="right"
        panelClass="w-[176px]"
        trigger={(open, toggle) => (
          <button
            type="button"
            title={t('more')}
            aria-label={t('more')}
            aria-expanded={open}
            onClick={toggle}
            className={prefs.layout === 'cards' ? 'flex h-8 w-8 items-center justify-center rounded-[7px] bg-[#858585] text-white' : 'flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-selected'}
          >
            <MoreHorizontal size={18} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuRow icon={<Pencil size={16} />} label={t('countdownEdit')} onClick={() => { close(); setEditing({ countdown: item, kind: item.kind, step: 1 }); }} />
            <MenuRow icon={<Shirt size={16} />} label={t('countdownStyle')} onClick={() => { close(); setEditing({ countdown: item, kind: item.kind, step: 2 }); }} />
            <MenuRow icon={<StickyNote size={16} />} label={t('countdownNote')} onClick={() => { close(); select(item.id, true); }} />
            {!item.archived && prefs.layout === 'list' && (
              <MenuRow icon={<Pin size={16} />} label={item.pinned ? t('countdownUnpin') : t('countdownPin')} onClick={() => { close(); togglePin(item); }} />
            )}
            <MenuRow
              icon={item.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              label={item.archived ? t('countdownRestore') : t('countdownArchive')}
              onClick={() => { close(); toggleArchive(item); }}
            />
            <MenuRow icon={<Trash2 size={16} />} label={t('countdownDelete')} danger onClick={() => { close(); removeItem(item); }} />
          </>
        )}
      </Popover>
    </>
  );

  const renderItem = (item: Countdown) => {
    const props = {
      countdown: item,
      today,
      selected: item.id === selectedId,
      onOpen: () => select(item.id),
      actions: actionsFor(item),
      drag: dragFor(item),
    };
    return prefs.layout === 'list' ? <CountdownRow key={item.id} {...props} /> : <CountdownCard key={item.id} {...props} />;
  };
  const renderItems = (list: Countdown[]) => (prefs.layout === 'list'
    ? <div className="flex max-w-[760px] flex-col gap-2">{list.map(renderItem)}</div>
    : <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,272px),1fr))] gap-4">{list.map(renderItem)}</div>);

  const pastOnly = !archiveMode && !prefs.showPast && visible.length === 0 && scoped.length > 0;
  let content: ReactNode;
  if (!loaded) content = <div className="pt-16 text-center text-[13px] text-ink-3">{t('loading')}</div>;
  else if (failed && items.length === 0) {
    content = (
      <div className="pt-16 text-center text-[13px] text-ink-3">
        {t('countdownLoadFailed')}
        <button type="button" onClick={() => void load()} className="ml-2 text-tt hover:underline">{t('countdownRetry')}</button>
      </div>
    );
  } else if (visible.length === 0) {
    content = <div className="mx-auto max-w-[360px] px-6 pt-16 text-center text-[13px] leading-5 text-ink-3">{archiveMode ? t('countdownArchivedEmpty') : pastOnly ? t('countdownPastHidden') : t('countdownEmpty')}</div>;
  } else {
    content = (
      <div className="space-y-7 px-4 pb-10 pt-3 sm:px-[22px]">
        {prefs.sort === 'manual' && visible.length > 1 && <p className="-mt-1 text-[12px] text-ink-3">{t('countdownDragHint')}</p>}
        {groups.map((group) => (
          <section key={group.kind ?? 'all'}>
            {group.kind && (
              <h2 className="mb-3 flex items-baseline gap-2 text-[14px] font-semibold text-ink-2">
                {t(KIND_KEY[group.kind])}<span className="text-[12px] font-normal text-ink-3">{group.items.length}</span>
              </h2>
            )}
            {renderItems(group.items)}
          </section>
        ))}
      </div>
    );
  }

  const detail = selected && (
    <CountdownDetail
      key={selected.id}
      countdown={selected}
      today={today}
      allDayTime={allDayTime}
      focusNote={focusNote}
      onClose={() => select(null)}
      onEdit={() => setEditing({ countdown: selected, kind: selected.kind, step: 1 })}
      onStyle={() => setEditing({ countdown: selected, kind: selected.kind, step: 2 })}
      onTogglePin={() => togglePin(selected)}
      onToggleArchive={() => toggleArchive(selected)}
      onDelete={() => removeItem(selected)}
      onChange={(patch) => quietly(update(selected.id, patch))}
    />
  );

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 flex-col bg-[#fafafa]">
        <header className="flex h-16 shrink-0 items-center gap-2 pl-4 pr-4 sm:pl-[26px] sm:pr-[22px]">
          <Popover
            panelClass="w-[204px]"
            trigger={(open, toggle) => (
              <button type="button" onClick={toggle} aria-expanded={open} className="-ml-2 flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-[20px] font-bold hover:bg-hover">
                <span className="truncate">{archiveMode ? t('countdownArchivedView') : t('countdownTitle')}</span>
                <ChevronDown size={14} className="shrink-0 text-ink-3" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuRow label={t('countdownActive')} checked={!archiveMode} onClick={() => { setArchiveMode(false); close(); }} />
                <MenuRow label={t('countdownArchivedView')} count={archivedCount} checked={archiveMode} onClick={() => { setArchiveMode(true); close(); }} />
              </>
            )}
          </Popover>
          <div className="ml-auto flex items-center gap-1">
            <Popover
              align="right"
              panelClass="w-[168px]"
              trigger={(open, toggle) => (
                <button type="button" title={t('newCountdown')} aria-label={t('newCountdown')} aria-expanded={open} onClick={toggle} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink">
                  <Plus size={21} />
                </button>
              )}
            >
              {(close) => COUNTDOWN_KINDS.map((kind) => (
                <MenuRow key={kind} icon={<span className="text-[15px] leading-none">{KIND_ICON[kind]}</span>} label={t(KIND_KEY[kind])} onClick={() => { close(); setEditing({ countdown: null, kind, step: 1 }); }} />
              ))}
            </Popover>
            <Popover
              align="right"
              panelClass="w-[212px]"
              trigger={(open, toggle) => (
                <button type="button" title={t('more')} aria-label={t('more')} aria-expanded={open} onClick={toggle} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink">
                  <MoreHorizontal size={20} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="px-5 pb-1 pt-2 text-[12px] text-ink-3">{t('countdownSort')}</div>
                  {(['date', 'manual', 'created'] as CountdownSort[]).map((sort) => (
                    <MenuRow
                      key={sort}
                      label={t(sort === 'date' ? 'countdownSortDate' : sort === 'manual' ? 'countdownSortManual' : 'countdownSortCreated')}
                      checked={prefs.sort === sort}
                      onClick={() => { changePrefs({ sort }); close(); }}
                    />
                  ))}
                  <div className="my-1 border-t border-line" />
                  <MenuRow icon={<LayoutGrid size={16} />} label={t('countdownLayoutCards')} checked={prefs.layout === 'cards'} onClick={() => { changePrefs({ layout: 'cards' }); close(); }} />
                  <MenuRow icon={<List size={16} />} label={t('countdownLayoutList')} checked={prefs.layout === 'list'} onClick={() => { changePrefs({ layout: 'list' }); close(); }} />
                  <div className="my-1 border-t border-line" />
                  <MenuRow label={t('countdownShowGroups')} toggle checked={prefs.groupByKind} onClick={() => { changePrefs({ groupByKind: !prefs.groupByKind }); close(); }} />
                  <MenuRow label={t('countdownShowPast')} toggle checked={prefs.showPast} onClick={() => { changePrefs({ showPast: !prefs.showPast }); close(); }} />
                </>
              )}
            </Popover>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{content}</main>
      </div>

      {detail && (wide ? (
        <aside className="h-full w-[380px] shrink-0 border-l border-line bg-white">{detail}</aside>
      ) : (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/20"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) select(null); }}
        >
          <div className="h-full w-full max-w-[420px] bg-white shadow-[0_12px_36px_rgba(0,0,0,0.18)]">{detail}</div>
        </div>
      ))}

      {editing && (
        <CountdownEditor
          initial={editing.countdown}
          kind={editing.kind}
          initialStep={editing.step}
          today={today}
          allDayTime={allDayTime}
          onClose={() => setEditing(null)}
          onSave={saveDraft}
        />
      )}
    </div>
  );
}

/** A menu row; `checked` makes it a radio (one of a set) or a checkbox (a toggle) item. */
function MenuRow({ icon, label, count, checked, toggle = false, danger = false, onClick }: {
  icon?: ReactNode; label: string; count?: number; checked?: boolean; toggle?: boolean; danger?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={checked == null ? 'menuitem' : toggle ? 'menuitemcheckbox' : 'menuitemradio'}
      aria-checked={checked}
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-3 whitespace-nowrap px-5 text-left text-[14px] hover:bg-hover ${danger ? 'text-p-high' : 'text-ink'}`}
    >
      {icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 truncate">{label}</span>
      {count != null && count > 0 && <span className="text-[12px] text-ink-3">{count}</span>}
      {checked && <Check size={16} className="ml-auto shrink-0 text-tt" />}
    </button>
  );
}
