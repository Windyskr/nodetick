import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useStore } from '../../stores/store';
import IconRail from './IconRail';
import Sidebar from './Sidebar';
import TaskDetail from './TaskDetail';
import Toast from '../../components/Toast';

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { booted, me, boot, selectedTaskId, selectedTask } = useStore();

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

  // The detail panel accompanies the task-centric pages only.
  const showDetail =
    selectedTaskId !== null &&
    /^\/app\/(tasks|calendar|matrix)/.test(location.pathname) &&
    selectedTask() !== null;
  const floatingDetail = showDetail && !taskWorkspace;

  return (
    <div className="flex h-full overflow-hidden">
      <IconRail />
      {showSidebar && <Sidebar />}
      <div
        className={`flex min-w-0 ${
          taskWorkspace ? 'w-[511px] shrink-0' : 'flex-1'
        }`}
      >
        <Outlet />
      </div>
      {showDetail && !floatingDetail && selectedTask() && <TaskDetail key={selectedTask()!.id} task={selectedTask()!} />}
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
      {taskWorkspace && !showDetail && (
        <div className="min-w-0 flex-1 border-l border-line bg-white" aria-hidden="true" />
      )}
      <Toast />
    </div>
  );
}
