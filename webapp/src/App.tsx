import { Navigate, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import AppLayout from './pages/app/AppLayout';
import TasksPage from './pages/app/TasksPage';
import CalendarPage from './pages/app/CalendarPage';
import MatrixPage from './pages/app/MatrixPage';
import HabitPage from './pages/app/HabitPage';
import FocusPage from './pages/app/FocusPage';
import CountdownPage from './pages/app/CountdownPage';
import TokensPage from './pages/app/TokensPage';
import SearchPage from './pages/app/SearchPage';
import SummaryPage from './pages/app/SummaryPage';

export default function App() {
  return (
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
        <Route path="habit" element={<HabitPage />} />
        <Route path="focus" element={<FocusPage />} />
        <Route path="countdown" element={<CountdownPage />} />
        <Route path="tokens" element={<TokensPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
