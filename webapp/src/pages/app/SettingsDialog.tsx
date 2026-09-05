import { useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { useStore, type FeatureKey } from '../../stores/store';
import { useT } from '../../i18n';

function CheckRow({
  checked,
  title,
  desc,
  onToggle,
}: {
  checked: boolean;
  title: string;
  desc: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-hover"
    >
      <span
        className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors ${
          checked ? 'border-tt bg-tt text-white' : 'border-line bg-white text-transparent'
        }`}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2.5 6.2l2.4 2.4 4.6-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] text-ink">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{desc}</span>
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-1">
      <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</div>
      {children}
    </div>
  );
}

function inputClass() {
  return 'h-8 w-full rounded-md border border-line bg-white px-2 text-[13px] outline-none focus:border-tt';
}

/** 修改密码 form: verifies the current password server-side and re-signs in. */
function PasswordSection() {
  const t = useT();
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 px-2">
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
      <button
        type="submit"
        disabled={busy}
        className="h-8 rounded-md bg-tt px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {t('savePassword')}
      </button>
    </form>
  );
}

/**
 * 设置 dialog mirroring the reference app: 功能模块 toggles the optional
 * tool buttons on the rail, 智能清单 toggles sidebar smart-list entries.
 * Preferences persist to localStorage via the store.
 */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { features, toggleFeature } = useStore();
  const t = useT();

  const modules: [FeatureKey, string, string][] = [
    ['matrix', t('navMatrix'), t('featureDescMatrix')],
    ['focus', t('navFocus'), t('featureDescFocus')],
    ['habit', t('navHabits'), t('featureDescHabit')],
    ['countdown', t('navCountdowns'), t('featureDescCountdown')],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('settings')}
        className="w-full max-w-sm rounded-xl border border-line bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{t('settings')}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <Section title={t('featureModules')}>
          {modules.map(([key, title, desc]) => (
            <CheckRow key={key} checked={features[key]} title={title} desc={desc} onToggle={() => toggleFeature(key)} />
          ))}
        </Section>

        <Section title={t('smartListsSettings')}>
          <CheckRow
            checked={features.summary}
            title={t('summary')}
            desc={t('featureDescSummary')}
            onToggle={() => toggleFeature('summary')}
          />
        </Section>

        <Section title={t('accountSection')}>
          <PasswordSection />
        </Section>
      </div>
    </div>
  );
}
