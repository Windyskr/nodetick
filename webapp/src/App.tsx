import { Suspense, lazy, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageSpinner } from './components/PageSpinner';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';

/**
 * The app pages load on demand, so the landing and sign-in pages don't ship
 * the whole workspace. After a deploy an open tab may ask for a chunk that no
 * longer exists; reload once to pick up the new build instead of crashing.
 */
const CHUNK_RELOAD_KEY = 'ntk_chunk_reload';

function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  return lazy(() =>
    load().catch((error: unknown) => {
      // At most one reload per 10 s, so a chunk that is really missing
      // surfaces as an error instead of a reload loop.
      const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
      if (Date.now() - last < 10_000) throw error;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return new Promise<never>(() => {}); // keep the spinner until the reload
    }),
  );
}

const AppLayout = lazyPage(() => import('./pages/app/AppLayout'));
const TasksPage = lazyPage(() => import('./pages/app/TasksPage'));
const CalendarPage = lazyPage(() => import('./pages/app/CalendarPage'));
const MatrixPage = lazyPage(() => import('./pages/app/MatrixPage'));
const HabitPage = lazyPage(() => import('./pages/app/HabitPage'));
const FocusPage = lazyPage(() => import('./pages/app/FocusPage'));
const CountdownPage = lazyPage(() => import('./pages/app/CountdownPage'));
const TokensPage = lazyPage(() => import('./pages/app/TokensPage'));
const AdminPage = lazyPage(() => import('./pages/app/AdminPage'));
const SearchPage = lazyPage(() => import('./pages/app/SearchPage'));
const SummaryPage = lazyPage(() => import('./pages/app/SummaryPage'));
const StatsPage = lazyPage(() => import('./pages/app/StatsPage'));

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Navigate to="tasks/all" replace />} />
          <Route path="tasks/:scope" element={<TasksPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="matrix" element={<MatrixPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="summary" element={<SummaryPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="habit" element={<HabitPage />} />
          <Route path="focus" element={<FocusPage />} />
          <Route path="countdown" element={<CountdownPage />} />
          <Route path="tokens" element={<TokensPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
