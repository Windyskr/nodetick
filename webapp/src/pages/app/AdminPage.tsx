import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../lib/api';
import type { AdminUser } from '../../lib/types';
import { useStore } from '../../stores/store';
import { useT, useTF } from '../../i18n';

/**
 * 管理员用户管理: list accounts, create users, reset passwords, delete users.
 * The backend enforces admin-only access; this page is a thin front for it.
 */
export default function AdminPage() {
  const { me } = useStore();
  const t = useT();
  const f = useTF();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [asAdmin, setAsAdmin] = useState(false);

  const load = async () => {
    try {
      setUsers(await api.adminListUsers());
      setLoaded(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.adminCreateUser(email.trim(), password, asAdmin);
      setEmail('');
      setPassword('');
      setAsAdmin(false);
      setAdding(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resetPassword = async (user: AdminUser) => {
    const next = window.prompt(f('adminResetPrompt', user.email));
    if (!next) return;
    setError(null);
    try {
      await api.adminResetPassword(user.id, next);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (user: AdminUser) => {
    if (!window.confirm(f('adminDeleteConfirm', user.email))) return;
    setError(null);
    try {
      await api.adminDeleteUser(user.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 pb-10">
        <div className="flex items-center justify-between pb-1 pt-4">
          <h1 className="text-[20px] font-bold">{t('adminTitle')}</h1>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-tt px-3 text-[13px] font-medium text-white hover:opacity-90"
          >
            <UserPlus size={14} /> {t('adminAddUser')}
          </button>
        </div>
        <p className="pb-3 text-[12px] text-ink-3">{t('adminHint')}</p>

        {error && <div className="mb-3 rounded-md bg-[#fdecec] px-3 py-2 text-[12px] text-[#d54848]">{error}</div>}

        {adding && (
          <form onSubmit={create} className="mb-3 space-y-2 rounded-xl border border-line p-3">
            <input
              type="email"
              required
              placeholder={t('adminEmail')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-8 w-full rounded-md border border-line px-2 text-[13px] outline-none focus:border-tt"
            />
            <input
              type="text"
              required
              minLength={8}
              placeholder={t('adminInitialPassword')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-8 w-full rounded-md border border-line px-2 text-[13px] outline-none focus:border-tt"
            />
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={asAdmin} onChange={(e) => setAsAdmin(e.target.checked)} />
              {t('adminAsAdmin')}
            </label>
            <button
              type="submit"
              className="h-8 rounded-md bg-tt px-3 text-[13px] font-medium text-white hover:opacity-90"
            >
              {t('adminCreate')}
            </button>
          </form>
        )}

        <div className="overflow-hidden rounded-xl border border-line bg-white">
          {users.map((user) => (
            <div key={user.id} className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px]">{user.email}</span>
                  {user.isAdmin && (
                    <span className="shrink-0 rounded bg-tt-light px-1.5 py-0.5 text-[11px] text-tt">{t('accountAdmin')}</span>
                  )}
                  {user.id === me?.id && (
                    <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[11px] text-ink-3">{t('adminYou')}</span>
                  )}
                </div>
                <div className="text-[11px] text-ink-3">
                  {f('adminTaskCount', user.tasks)} · {new Date(user.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                title={t('adminResetPassword')}
                className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
                onClick={() => void resetPassword(user)}
              >
                <KeyRound size={15} />
              </button>
              {user.id !== me?.id && (
                <button
                  type="button"
                  title={t('adminDeleteUser')}
                  className="rounded-md p-1.5 text-ink-3 hover:bg-[#fdecec] hover:text-[#d54848]"
                  onClick={() => void remove(user)}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {loaded && users.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-ink-3">{t('emptyNoTasks')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
