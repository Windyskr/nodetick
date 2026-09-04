import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { serverError, useT } from '../i18n';
import { LogoMark } from '../components/Logo';

export default function Register() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [needInvite, setNeedInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The very first account is the admin and needs no invite code.
  useEffect(() => {
    document.title = '创建账号 · NodeTick';
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.register(email, password, invite || undefined);
      window.location.href = '/app';
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setNeedInvite(true);
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
        <h1 className="mb-6 text-center text-[18px] font-semibold">{t('registerTitle')}</h1>
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
        <label className="mb-1 block text-[13px] text-ink-2" htmlFor="password">{t('passwordHint')}</label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
        />
        {needInvite && (
          <>
            <label className="mb-1 block text-[13px] text-ink-2" htmlFor="invite">{t('inviteCode')}</label>
            <input
              id="invite"
              type="text"
              required
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              className="mb-4 w-full rounded-md border border-line px-3 py-2 text-[14px] focus:border-tt"
            />
          </>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-tt py-2 text-[14px] font-medium text-white transition-colors hover:bg-tt-hover disabled:opacity-60"
        >
          {busy ? t('creating') : t('createAccount')}
        </button>
        <p className="mt-4 text-center text-[13px] text-ink-3">
          {t('alreadyHave')}{' '}
          <Link to="/login" className="text-tt hover:underline">{t('signIn')}</Link>
        </p>
      </form>
    </div>
  );
}
