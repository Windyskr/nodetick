import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, CloudOff, Loader2 } from 'lucide-react';
import { useStore } from '../../stores/store';
import IconRail from './IconRail';
import Sidebar from './Sidebar';
import TaskDetail from './TaskDetail';
import Toast from '../../components/Toast';
import { useT } from '../../i18n';
import { PageSpinner } from '../../components/PageSpinner';
import { watchPushLanguage } from '../../lib/push';
import { ApiError } from '../../lib/api';
import { errorMessage, isRequestError } from '../../lib/errors';

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

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** False while the browser reports no network connection. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Shown instead of the workspace when the first load fails for a reason other than being signed out. */
function BootError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center px-6" role="alert">
      <div className="flex max-w-[360px] flex-col items-center text-center">
        <CloudOff size={40} strokeWidth={1.5} className="text-ink-3" />
        <h1 className="mt-4 text-[17px] font-semibold text-ink">{t('bootErrorTitle')}</h1>
        <p className="mt-2 text-[13px] leading-5 text-ink-2">{message}</p>
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={onSignOut} className="h-9 rounded-lg border border-line px-4 text-[13px] text-ink-2 hover:bg-hover">{t('signOut')}</button>
          <button type="button" onClick={onRetry} className="h-9 rounded-lg bg-tt px-5 text-[13px] font-medium text-white hover:bg-tt-hover">{t('retry')}</button>
        </div>
      </div>
    </div>
  );
}

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
  const { booted, me, boot, error, selectedTaskId, selectedTask, navOpen, setNavOpen } = useStore();
  const online = useOnline();
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

  const signInAgain = () =>
    navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`, { replace: true });

  const start = () => {
    void boot().then((ok) => {
      if (!ok) {
        // A failed load (server error, offline) keeps the user here with a
        // retry; only a missing session goes to the sign-in page.
        if (!useStore.getState().error) signInAgain();
      } else {
        const taskId = new URLSearchParams(window.location.search).get('task');
        if (taskId) useStore.getState().selectTask(taskId);
      }
    });
  };

  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Requests that fail outside a handler (saving, completing, moving…) would
  // otherwise fail silently: say what happened, and send an expired session
  // to the sign-in page.
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isRequestError(event.reason)) return;
      event.preventDefault();
      if (event.reason instanceof ApiError && event.reason.status === 401) {
        signInAgain();
        return;
      }
      useStore.getState().showToast({ messageKey: 'toastError', messageArg: errorMessage(event.reason) });
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
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
  if (!me) {
    if (!error) return null;
    return (
      <BootError
        message={error}
        onRetry={() => {
          useStore.setState({ booted: false, error: null });
          start();
        }}
        onSignOut={() => {
          void useStore.getState().logout().then(() => navigate('/login', { replace: true }));
        }}
      />
    );
  }

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
      {!online && (
        <div role="status" className="fixed left-1/2 top-3 z-[70] -translate-x-1/2 rounded-full bg-[#191919] px-4 py-1.5 text-[12px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.3)] ring-1 ring-white/10">
          {t('offlineBanner')}
        </div>
      )}
      <Toast />
    </div>
  );
}
