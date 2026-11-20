import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';
import {
  GraphError,
  importTodoLists,
  listTodoLists,
  type MsDeviceCode,
  type MsImportProgress,
  type MsImportTotals,
  type MsTodoList,
} from '../../lib/msTodo';
import { serverError, useT, useTF } from '../../i18n';
import { useEscape } from '../../lib/useEscape';
import { useStore } from '../../stores/store';

type Step =
  | { kind: 'intro' }
  | { kind: 'code'; code: MsDeviceCode }
  | { kind: 'lists'; lists: MsTodoList[] | null }
  | { kind: 'importing'; progress: MsImportProgress | null }
  | { kind: 'done'; totals: MsImportTotals; stopped: boolean };

/** To Do's own order: the built-in Tasks list first, flagged email last. */
const listRank = (list: MsTodoList) =>
  list.wellknownListName === 'defaultList' ? 0 : list.wellknownListName === 'flaggedEmails' ? 2 : 1;

const messageOf = (error: unknown) => serverError(error instanceof Error ? error.message : String(error));

const secondary = 'h-8 rounded-md border border-line px-3 text-[13px] text-ink-2 hover:bg-hover';
const primary = 'flex h-8 items-center gap-1.5 rounded-md bg-tt px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50';

/**
 * 从 Microsoft To Do 导入: device code sign-in (the worker relays it), pick
 * lists, then read them from Microsoft Graph and import them chunk by chunk.
 */
export default function MsTodoImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const f = useTF();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = useRef<string | null>(null);
  const lists = useRef<MsTodoList[]>([]);
  const abort = useRef<AbortController | null>(null);

  const close = () => {
    abort.current?.abort();
    onClose();
  };
  useEscape(close);

  useEffect(() => {
    api.msTodoConfig().then((r) => setConfigured(r.configured)).catch(() => setConfigured(false));
    return () => abort.current?.abort();
  }, []);

  const fail = (message: string) => {
    setError(message);
    setStep({ kind: 'intro' });
  };

  const signIn = async () => {
    setError(null);
    setBusy(true);
    try {
      setStep({ kind: 'code', code: await api.msTodoDeviceCode() });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const loadLists = async () => {
    setStep({ kind: 'lists', lists: null });
    const controller = new AbortController();
    abort.current = controller;
    try {
      const found = (await listTodoLists({ token: token.current!, signal: controller.signal }))
        .sort((a, b) => listRank(a) - listRank(b));
      lists.current = found;
      setSelected(new Set(found.filter((list) => list.wellknownListName !== 'flaggedEmails').map((list) => list.id)));
      setStep({ kind: 'lists', lists: found });
    } catch (err) {
      if (!controller.signal.aborted) fail(messageOf(err));
    }
  };

  // Poll the relay until the user has signed in (or the code expires).
  useEffect(() => {
    if (step.kind !== 'code') return;
    const { code } = step;
    let stopped = false;
    let wait = code.interval * 1000;
    const deadline = Date.now() + code.expiresIn * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() > deadline) return fail(t('msImportExpired'));
      try {
        const result = await api.msTodoPollToken(code.deviceCode);
        if (stopped) return;
        if (result.status === 'ok') {
          token.current = result.accessToken;
          void loadLists();
          return;
        }
        if (result.status === 'declined') return fail(t('msImportDeclined'));
        if (result.status === 'expired') return fail(t('msImportExpired'));
        if (result.status === 'slow_down') wait += 5000;
      } catch (err) {
        if (!stopped) fail(messageOf(err));
        return;
      }
      timer = setTimeout(() => void poll(), wait);
    };
    timer = setTimeout(() => void poll(), wait);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [step]);

  const runImport = async () => {
    const chosen = lists.current.filter((list) => selected.has(list.id));
    if (!chosen.length || !token.current) return;
    const controller = new AbortController();
    abort.current = controller;
    const totals: MsImportTotals = { lists: 0, created: 0, skipped: 0, attachments: 0 };
    setError(null);
    setStep({ kind: 'importing', progress: null });
    let stopped = false;
    try {
      await importTodoLists(chosen, {
        token: token.current,
        signal: controller.signal,
        includeCompleted,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        send: (chunk) => api.msTodoImport(chunk),
        onProgress: (progress) => setStep({ kind: 'importing', progress }),
      }, totals);
    } catch (err) {
      stopped = true;
      if (err instanceof GraphError && err.status === 401) {
        token.current = null; // expired: the next attempt needs a new sign-in
        setError(t('msImportSignInAgain'));
      } else if (!controller.signal.aborted) {
        setError(messageOf(err));
      }
    }
    if (totals.created) void useStore.getState().refresh().catch(() => undefined);
    setStep({ kind: 'done', totals, stopped });
  };

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };

  const importing = step.kind === 'importing';
  const errorLine = error && <div className="mt-3 text-[12px] leading-relaxed text-[#d54848]">{error}</div>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={importing ? undefined : close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('msImport')}
        className="w-full max-w-md rounded-xl border border-line bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{t('msImport')}</h2>
          <button type="button" onClick={close} aria-label={t('close')} className="rounded-md px-2 py-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        {step.kind === 'intro' && (
          <>
            <p className="text-[13px] leading-relaxed text-ink-2">{t('msImportIntro')}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{t('msImportWhat')}</p>
            {configured === false && (
              <p className="mt-3 rounded-md bg-hover px-3 py-2 text-[12px] leading-relaxed text-ink-2">{t('msImportNotConfigured')}</p>
            )}
            {errorLine}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} className={secondary}>{t('cancel')}</button>
              <button type="button" onClick={() => void signIn()} disabled={!configured || busy} className={primary}>
                {busy && <Loader2 size={14} className="animate-spin" />}
                {t('msImportSignIn')}
              </button>
            </div>
          </>
        )}

        {step.kind === 'code' && (
          <>
            <p className="text-[13px] leading-relaxed text-ink-2">{t('msImportEnterCode')}</p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <code className="rounded-lg bg-hover px-4 py-2 font-mono text-[22px] font-semibold tracking-[0.18em]">{step.code.userCode}</code>
              <button
                type="button"
                title={t('copy')}
                aria-label={t('copy')}
                onClick={() => copyCode(step.code.userCode)}
                className="rounded-md border border-line p-2 text-ink-3 hover:border-tt hover:text-tt"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            {/^https:\/\//i.test(step.code.verificationUri) && (
              <a
                href={step.code.verificationUri}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => copyCode(step.code.userCode)}
                className="mt-3 flex items-center justify-center gap-1.5 rounded-md bg-tt px-3 py-2 text-[13px] font-medium text-white hover:opacity-90"
              >
                <ExternalLink size={14} /> {t('msImportOpenPage')}
              </a>
            )}
            <p className="mt-1.5 text-center text-[11px] text-ink-3">{step.code.verificationUri}</p>
            <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-ink-3">
              <Loader2 size={13} className="animate-spin" /> {t('msImportWaiting')}
            </div>
          </>
        )}

        {step.kind === 'lists' && (
          <>
            {step.lists === null ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-3">
                <Loader2 size={15} className="animate-spin" /> {t('msImportLoadingLists')}
              </div>
            ) : step.lists.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-3">{t('msImportNoLists')}</p>
            ) : (
              <>
                <div className="mb-1.5 text-[12px] font-medium text-ink-3">{t('msImportChooseLists')}</div>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
                  {step.lists.map((list) => (
                    <label
                      key={list.id}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3 py-2 last:border-b-0 hover:bg-hover"
                    >
                      <input type="checkbox" checked={selected.has(list.id)} onChange={() => toggle(list.id)} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{list.displayName || '—'}</span>
                      {list.wellknownListName === 'defaultList' && (
                        <span className="shrink-0 text-[11px] text-ink-3">{t('msImportIntoInbox')}</span>
                      )}
                      {list.isShared && <span className="shrink-0 text-[11px] text-ink-3">{t('msImportShared')}</span>}
                    </label>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" checked={includeCompleted} onChange={(e) => setIncludeCompleted(e.target.checked)} />
                  {t('msImportIncludeCompleted')}
                </label>
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} className={secondary}>{t('cancel')}</button>
              <button type="button" onClick={() => void runImport()} disabled={!step.lists || selected.size === 0} className={primary}>
                {t('msImportStart')}
              </button>
            </div>
          </>
        )}

        {step.kind === 'importing' && (
          <>
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <Loader2 size={14} className="shrink-0 animate-spin" />
              <span className="min-w-0 truncate">
                {step.progress
                  ? f('msImportProgress', step.progress.list.displayName, step.progress.listIndex + 1, step.progress.listCount, step.progress.listTasks)
                  : t('loading')}
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hover">
              <div
                className="h-full rounded-full bg-tt transition-[width]"
                style={{ width: `${step.progress ? (step.progress.listIndex / step.progress.listCount) * 100 : 0}%` }}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => abort.current?.abort()} className={secondary}>{t('msImportStop')}</button>
            </div>
          </>
        )}

        {step.kind === 'done' && (
          <>
            <div className="flex items-start gap-2 text-[13px]">
              {!step.stopped && <Check size={16} className="mt-0.5 shrink-0 text-[#47a04c]" />}
              <span>
                {step.stopped ? f('msImportStopped', step.totals.created) : f('msImportDone', step.totals.created, step.totals.lists)}
              </span>
            </div>
            {step.totals.skipped > 0 && <p className="mt-1.5 text-[12px] text-ink-3">{f('msImportSkipped', step.totals.skipped)}</p>}
            {step.totals.attachments > 0 && <p className="mt-1.5 text-[12px] text-ink-3">{f('msImportAttachments', step.totals.attachments)}</p>}
            <p className="mt-1.5 text-[12px] text-ink-3">{t('msImportAgain')}</p>
            {errorLine}
            <div className="mt-4 flex justify-end gap-2">
              {step.stopped && (token.current ? (
                <button type="button" onClick={() => { setError(null); setStep({ kind: 'lists', lists: lists.current }); }} className={secondary}>
                  {t('msImportBack')}
                </button>
              ) : (
                <button type="button" onClick={() => void signIn()} disabled={busy} className={secondary}>
                  {t('msImportSignIn')}
                </button>
              ))}
              <button type="button" onClick={close} className={primary}>{t('msImportFinish')}</button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
