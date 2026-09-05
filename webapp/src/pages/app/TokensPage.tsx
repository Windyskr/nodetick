import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, FileUp, Link2, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { ApiToken } from '../../lib/types';
import { useT, useTF } from '../../i18n';

export default function TokensPage() {
  const t = useT();
  const f = useTF();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [feedCopied, setFeedCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setTokens(await api.listTokens());
    setLoaded(true);
  };
  useEffect(() => {
    void load();
    api.getFeedToken().then((r) => setFeedToken(r.token)).catch(() => setFeedToken(null));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { token } = await api.createToken(name.trim() || 'default');
      setMinted(token);
      setCreating(false);
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm(t('revokeConfirm'))) return;
    await api.revokeToken(id);
    setMinted(null);
    setCopied(false);
    await load();
  };

  const origin = window.location.origin;

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 pb-10">
        <div className="flex items-center pb-1 pt-4">
          <h1 className="text-[20px] font-bold">{t('tokensTitle')}</h1>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setMinted(null);
            }}
            className="ml-auto flex items-center gap-1 rounded-full bg-tt px-4 py-1.5 text-[13px] font-medium text-white hover:bg-tt-hover"
          >
            <Plus size={14} /> {t('createToken')}
          </button>
        </div>

        {minted && (
          <div className="mt-4 rounded-xl border border-tt/40 bg-tt-light p-4">
            <div className="mb-1 text-[13px] font-semibold text-tt">
              {t('tokenMinted')}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-white px-3 py-2 font-mono text-[12.5px]">{minted}</code>
              <button
                type="button"
                className="rounded-md bg-tt p-2 text-white hover:bg-tt-hover"
                title={t('copy')}
                onClick={async () => {
                  await navigator.clipboard.writeText(minted);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          </div>
        )}

        {creating && (
          <form onSubmit={create} className="mt-4 flex items-center gap-2 rounded-xl border border-line p-3">
            <input
              autoFocus
              value={name}
              placeholder={t('tokenNamePh')}
              onChange={(e) => setName(e.target.value)}
              className="w-64 rounded-md border border-line px-3 py-2 text-[13px] focus:border-tt"
            />
            <button type="submit" className="rounded-md bg-tt px-4 py-2 text-[13px] font-medium text-white hover:bg-tt-hover">
              {t('create')}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="text-ink-3 hover:text-ink">
              <X size={16} />
            </button>
            {error && <span className="text-[13px] text-p-high">{error}</span>}
          </form>
        )}

        <div className="mt-4 overflow-hidden rounded-xl border border-line">
          {!loaded ? (
            <div className="py-10 text-center text-ink-3">{t('loading')}</div>
          ) : tokens.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-ink-3">{t('noTokens')}</div>
          ) : (
            tokens.map((tk) => (
              <div key={tk.id} className="flex items-center gap-4 border-b border-line/60 px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium">{tk.name}</div>
                  <div className="text-[12px] text-ink-3">
                    {t('created')} {tk.createdAt?.slice(0, 10) ?? '—'} · {t('lastUsed')} {tk.lastUsedAt?.slice(0, 10) ?? t('never')}
                  </div>
                </div>
                {tk.revoked ? (
                  <span className="text-[12px] text-ink-3">{t('revoked')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void revoke(tk.id)}
                    className="rounded-md border border-p-high/40 px-3 py-1 text-[12px] text-p-high hover:bg-[#fdf0f0]"
                  >
                    {t('revoke')}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <h2 className="mb-2 mt-8 text-[15px] font-semibold">{t('backupTitle')}</h2>
        <div className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/export"
              download
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[13px] text-ink-2 hover:border-tt hover:text-tt"
            >
              <Download size={14} /> {t('exportJson')}
            </a>
            <a
              href="/api/export/calendar.ics"
              download
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[13px] text-ink-2 hover:border-tt hover:text-tt"
            >
              <Download size={14} /> {t('exportIcal')}
            </a>
            <button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[13px] text-ink-2 hover:border-tt hover:text-tt disabled:opacity-60"
            >
              <FileUp size={14} /> {importing ? t('loading') : t('importJson')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setImporting(true);
                setError(null);
                setImportResult(null);
                try {
                  const res = await fetch('/api/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: await file.text(),
                  });
                  const data = (await res.json().catch(() => null)) as { imported?: number; error?: string } | null;
                  if (!res.ok) throw new Error(data?.error ?? `Import failed (${res.status})`);
                  setImportResult(f('importedItems', data?.imported ?? 0));
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setImporting(false);
                }
              }}
            />
          </div>
          {importResult && <div className="mt-2 text-[12px] text-tt">{importResult}</div>}
          {error && <div className="mt-2 text-[12px] text-p-high">{error}</div>}
          <p className="mt-2 text-[12px] leading-snug text-ink-3">{t('backupHint')}</p>
        </div>

        <h2 className="mb-2 mt-8 text-[15px] font-semibold">{t('feedTitle')}</h2>
        <div className="rounded-xl border border-line p-4">
          {feedToken ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-[#0d1117] px-3 py-2 font-mono text-[12px] text-[#c9d1d9]">
                {`${origin}/open/v1/feed.ics?token=${feedToken}`}
              </code>
              <button
                type="button"
                title={t('copy')}
                className="rounded-md border border-line p-2 text-ink-3 hover:border-tt hover:text-tt"
                onClick={async () => {
                  await navigator.clipboard.writeText(`${origin}/open/v1/feed.ics?token=${feedToken}`);
                  setFeedCopied(true);
                  setTimeout(() => setFeedCopied(false), 1500);
                }}
              >
                {feedCopied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              <button
                type="button"
                title={t('feedRegenerate')}
                className="rounded-md border border-line p-2 text-ink-3 hover:border-tt hover:text-tt"
                onClick={async () => {
                  if (!window.confirm(t('feedRegenerateConfirm'))) return;
                  const { token } = await api.regenerateFeed();
                  setFeedToken(token);
                }}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          ) : (
            <div className="py-1 text-[13px] text-ink-3">{t('loading')}</div>
          )}
          <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-ink-3">
            <Link2 size={13} className="mt-0.5 shrink-0" />
            {t('feedHint')}
          </p>
        </div>

        <h2 className="mb-2 mt-8 text-[15px] font-semibold">{t('connectCli')}</h2>
        <div className="rounded-xl bg-[#0d1117] p-4 font-mono text-[12.5px] leading-relaxed text-[#c9d1d9]">
          <p><span className="text-[#7ee787]">$</span> npm install -g @nodetick/cli</p>
          <p><span className="text-[#7ee787]">$</span> nodetick auth login --server {origin}</p>
          <p className="mt-2 text-[#8b949e]">{t('orPasteToken')}</p>
          <p><span className="text-[#7ee787]">$</span> nodetick auth token &lt;ntk_…&gt; --server {origin}</p>
        </div>
      </div>
    </div>
  );
}
