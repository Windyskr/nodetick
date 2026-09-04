import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { serverError, useT } from '../i18n';
import { LogoMark } from '../components/Logo';

export default function Login() {
  const [params] = useSearchParams();
  const next = params.get('next');
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = '登录 · NodeTick';
  }, []);

  // OAuth sends an absolute same-origin URL; only allow those (no open redirect).
  const resolveNext = (): string => {
    if (!next) return '/app';
    try {
      const u = new URL(next, window.location.origin);
      // Parse relative paths too: browsers normalize backslashes in URLs, so
      // a string-prefix check can accidentally accept a backslash host variant.
      if (u.origin === window.location.origin && u.pathname.startsWith('/')) {
        return u.pathname + u.search + u.hash;
      }
    } catch {
      // fall through
    }
    return '/app';
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      window.location.href = resolveNext(); // full load so the session cookie sticks everywhere
    } catch (err) {
      setError(serverError((err as Error).message));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#fafbfc] px-4">
      <Link to="/" className="mb-8 flex items-center gap-2">
        <LogoMark size={34} />
        <span className="text-[22px] font-bold tracking-tight">NodeTick</span>
      </Link>
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-xl border border-line bg-white p-8 shadow-[0_2px_12px_rgba(0,0,0,0.05)]">
        <h1 className="mb-6 text-center text-[18px] font-semibold">{t('loginTitle')}</h1>
        {error && <div className="mb-4 rounded-md bg-[#fdf0f0] px-3 py-2 text-[13px] text-p-high">{error}</div>}
        <label className="mb-1 block text-[13px] text-ink-2" htmlFor="email">{t('email')}</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
        />
        <label className="mb-1 block text-[13px] text-ink-2" htmlFor="password">{t('password')}</label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 w-full rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-tt py-2 text-[14px] font-medium text-white transition-colors hover:bg-tt-hover disabled:opacity-60"
        >
          {busy ? t('signingIn') : t('loginTitle')}
        </button>
        <p className="mt-4 text-center text-[13px] text-ink-3">
          {t('noAccount')}{' '}
          <Link to="/register" className="text-tt hover:underline">{t('register')}</Link>
        </p>
      </form>
    </div>
  );
}
