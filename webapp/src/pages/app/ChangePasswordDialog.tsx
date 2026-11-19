import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { serverError, useT } from '../../i18n';
import { useEscape } from '../../lib/useEscape';

function inputClass() {
  return 'h-8 w-full rounded-md border border-line bg-white px-2 text-[13px] outline-none focus:border-tt';
}

/** 修改密码 dialog: verifies the current password server-side and re-signs in. */
export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  useEscape(onClose);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError(t('passwordTooShort'));
      return;
    }
    if (next !== confirm) {
      setError(t('passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(serverError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('changePassword')}
        className="w-full max-w-sm rounded-xl border border-line bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{t('changePassword')}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-2 px-1 pb-1 pt-2">
          <input
            type="password"
            className={inputClass()}
            placeholder={t('currentPassword')}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <input
            type="password"
            className={inputClass()}
            placeholder={t('newPassword')}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <input
            type="password"
            className={inputClass()}
            placeholder={t('confirmPassword')}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {error && <div className="text-[12px] text-[#d54848]">{error}</div>}
          {done && <div className="text-[12px] text-[#47a04c]">{t('passwordChanged')}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md border border-line px-3 text-[13px] text-ink-2 hover:bg-hover"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || done}
              className="h-8 rounded-md bg-tt px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t('savePassword')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
