import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useStore } from '../../stores/store';
import IconRail from './IconRail';
import Sidebar from './Sidebar';
import TaskDetail from './TaskDetail';
import Toast from '../../components/Toast';
import { useT } from '../../i18n';
import { PageSpinner } from '../../components/PageSpinner';
import { watchPushLanguage } from '../../lib/push';

/** Persisted width (px) of the task detail panel; null → 36% like the original. */
const DETAIL_WIDTH_KEY = 'ntk_detail_width';

function readDetailWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(DETAIL_WIDTH_KEY));
    return Number.isFinite(value) && value >= 280 ? value : null;
  } catch {
    return null;
  }
}

const clampDetailWidth = (px: number) =>
  Math.min(Math.max(px, 280), Math.max(340, Math.floor(window.innerWidth * 0.6)));

/** Phones: the 240px sidebar plus the 280px+ detail column left the task list no width. */
const NARROW_QUERY = '(max-width: 767px)';

function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { booted, me, boot, selectedTaskId, selectedTask, navOpen, setNavOpen } = useStore();
  const [detailWidth, setDetailWidth] = useState<number | null>(readDetailWidth);
  const narrow = useNarrowScreen();
  const t = useT();

  // Reminders follow the UI language: re-tag this device's push subscription on switch.
  useEffect(() => watchPushLanguage(), []);

  // The list drawer closes once the user picks a destination.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, setNavOpen]);

  // Drag handle on the detail panel's left edge resizes and persists it,
  // like the reference app's detail-dragger.
  const startDetailDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const move = (ev: PointerEvent) => setDetailWidth(clampDetailWidth(window.innerWidth - ev.clientX));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(DETAIL_WIDTH_KEY, String(clampDetailWidth(window.innerWidth - ev.clientX)));
      } catch {
        // storage may be unavailable; the width lives only for this session
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    void boot().then((ok) => {
      if (!ok) {
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, {
          replace: true,
        });
      } else {
        const taskId = new URLSearchParams(window.location.search).get('task');
        if (taskId) useStore.getState().selectTask(taskId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // TickTick-style global shortcuts: `n` jumps to the quick-add field,
  // `/` jumps to search, Escape clears multi-selection. Typing contexts
  // (inputs, textareas, editors) are ignored.
  useEffect(() => {
    const focusSelector = (selector: string) => {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
        el?.focus();
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        navigate('/app/search');
        focusSelector('[data-search-input]');
      } else if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        if (!location.pathname.startsWith('/app/tasks')) navigate('/app/tasks/inbox');
        focusSelector('[data-quick-add]');
      } else if (event.key === 'Escape') {
        // Official behavior: Esc closes the open task detail first.
        const { selectedTaskId: openTask } = useStore.getState();
        if (openTask) useStore.getState().selectTask(null);
        useStore.getState().setNavOpen(false);
        useStore.getState().clearSelection();
        useStore.getState().dismissToast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (!booted) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={22} className="animate-spin text-ink-3" />
      </div>
    );
  }
  if (!me) return null;

  // The secondary task sidebar belongs to the task workspace only. Calendar
  // and the other top-level tools use the full content area, like TickTick.
  const showSidebar =
    location.pathname.startsWith('/app/tasks') || location.pathname === '/app/summary';
  const taskWorkspace = location.pathname.startsWith('/app/tasks');

  // The detail panel accompanies the task-centric pages only (search results
  // are task rows too: without it, clicking a result did nothing).
  const showDetail =
    selectedTaskId !== null &&
    /^\/app\/(tasks|calendar|matrix|search)/.test(location.pathname) &&
    selectedTask() !== null;
  const floatingDetail = showDetail && !taskWorkspace && !narrow;

  return (
    <div className="flex h-full overflow-hidden">
      <IconRail />
      {showSidebar && !narrow && <Sidebar />}
      {showSidebar && narrow && navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNavOpen(false);
          }}
        >
          <div className="ml-[50px] h-full w-fit shadow-[0_12px_36px_rgba(0,0,0,0.18)]">
            <Sidebar />
          </div>
        </div>
      )}
      {/* The reference layout keeps the content column flex-1 and a permanent
          36% detail panel on the right (empty until a task is selected). */}
      <div className="flex min-w-0 flex-1">
        {/* Pages load lazily (App.tsx); keep the rail and sidebar meanwhile. */}
        <Suspense fallback={<PageSpinner />}>
          <Outlet />
        </Suspense>
      </div>
      {narrow && showDetail && selectedTask() && (
        <div className="fixed inset-0 z-40 flex flex-col bg-white">
          <div className="flex h-11 shrink-0 items-center border-b border-line px-2">
            <button
              type="button"
              onClick={() => useStore.getState().selectTask(null)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[14px] text-ink-2 hover:bg-hover"
            >
              <ChevronLeft size={18} /> {t('close')}
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <TaskDetail key={selectedTask()!.id} task={selectedTask()!} />
          </div>
        </div>
      )}
      {taskWorkspace && !narrow && (
        <div
          className="relative h-full shrink-0 border-l border-line bg-white"
          style={{ width: detailWidth ?? '36%', minWidth: 280 }}
        >
          <div
            onPointerDown={startDetailDrag}
            className="absolute left-0 top-0 z-10 h-full w-[5px] cursor-ew-resize hover:bg-tt/20"
            aria-hidden="true"
          />
          {showDetail && !floatingDetail && selectedTask() && (
            <TaskDetail key={selectedTask()!.id} task={selectedTask()!} />
          )}
        </div>
      )}
      {floatingDetail && selectedTask() && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/5 pt-[162px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) useStore.getState().selectTask(null);
          }}
        >
          <TaskDetail key={selectedTask()!.id} task={selectedTask()!} variant="modal" />
        </div>
      )}
      <Toast />
    </div>
  );
}
