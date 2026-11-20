import { useRef, useState } from 'react';
import { Check, FileUp, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';
import {
  importTickTickLists,
  readTickTickBackup,
  TickTickFormatError,
  type TickTickBackup,
  type TickTickProgress,
  type TickTickTotals,
} from '../../lib/ticktick';
import { useT, useTF } from '../../i18n';
import { useEscape } from '../../lib/useEscape';
import { errorMessage } from '../../lib/errors';
import { useStore } from '../../stores/store';

type Step =
  | { kind: 'file' }
  | { kind: 'lists'; backup: TickTickBackup }
  | { kind: 'importing'; progress: TickTickProgress | null }
  | { kind: 'done'; totals: TickTickTotals; stopped: boolean };

const secondary = 'h-8 rounded-md border border-line px-3 text-[13px] text-ink-2 hover:bg-hover';
const primary = 'flex h-8 items-center gap-1.5 rounded-md bg-tt px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50';

/** 从 TickTick 导入: read the CSV backup in the browser, pick lists, import them chunk by chunk. */
export default function TickTickImportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const f = useTF();
  const [step, setStep] = useState<Step>({ kind: 'file' });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeClosed, setIncludeClosed] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const backup = useRef<TickTickBackup | null>(null);
  const abort = useRef<AbortController | null>(null);

  const close = () => {
    abort.current?.abort();
    onClose();
  };
  useEscape(close);

  const readFile = async (file: File) => {
    setError(null);
    setReading(true);
    try {
      const parsed = readTickTickBackup(await file.text());
      backup.current = parsed;
      setSelected(new Set(parsed.lists.map((list) => list.key)));
      setStep({ kind: 'lists', backup: parsed });
    } catch (err) {
      setError(err instanceof TickTickFormatError ? t('ttImportBadFile') : errorMessage(err));
    } finally {
      setReading(false);
    }
  };

  const runImport = async (current: TickTickBackup) => {
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setStep({ kind: 'importing', progress: null });
    let totals: TickTickTotals = { lists: 0, created: 0, skipped: 0 };
    let stopped = false;
    try {
      totals = await importTickTickLists(current.lists.filter((list) => selected.has(list.key)), {
        includeCompleted: includeClosed,
        send: (chunk) => api.ticktickImport(chunk),
        signal: controller.signal,
        onProgress: (progress, running) => {
          totals = running;
          setStep({ kind: 'importing', progress });
        },
      });
    } catch (err) {
      stopped = true;
      if (!controller.signal.aborted) setError(errorMessage(err));
    }
    if (totals.created) void useStore.getState().refresh().catch(() => undefined);
    setStep({ kind: 'done', totals, stopped });
  };

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const errorLine = error && <p className="mt-3 text-[12px] text-p-high">{error}</p>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('ttImport')}
        className="w-full max-w-md rounded-xl border border-line bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{t('ttImport')}</h2>
          <button type="button" onClick={close} aria-label={t('close')} className="rounded-md px-2 py-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        {step.kind === 'file' && (
          <>
            <p className="text-[13px] leading-relaxed text-ink-2">{t('ttImportIntro')}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{t('ttImportWhat')}</p>
            {errorLine}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void readFile(file);
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} className={secondary}>{t('cancel')}</button>
              <button type="button" disabled={reading} onClick={() => fileRef.current?.click()} className={primary}>
                {reading ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
                {t('ttImportChooseFile')}
              </button>
            </div>
          </>
        )}

        {step.kind === 'lists' && (
          <>
            <div className="mb-1.5 text-[12px] font-medium text-ink-3">{t('msImportChooseLists')}</div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
              {step.backup.lists.map((list) => {
                const open = list.tasks.filter((task) => task.status === 0).length;
                return (
                  <label key={list.key} className="flex cursor-pointer items-center gap-2.5 border-b border-line/60 px-3 py-2 last:border-b-0 hover:bg-hover">
                    <input type="checkbox" checked={selected.has(list.key)} onChange={() => toggle(list.key)} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {list.inbox ? t('smartInbox') : list.name}
                      {list.folder && <span className="ml-1.5 text-[11px] text-ink-3">{list.folder}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {list.inbox ? t('msImportIntoInbox') : f('ttImportCounts', open, list.tasks.length - open)}
                    </span>
                  </label>
                );
              })}
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
              {t('ttImportIncludeClosed')}
            </label>
            {step.backup.invalid > 0 && <p className="mt-2 text-[12px] text-ink-3">{f('ttImportInvalid', step.backup.invalid)}</p>}
            {errorLine}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setStep({ kind: 'file' })} className={secondary}>{t('ttImportChooseFile')}</button>
              <button type="button" disabled={selected.size === 0} onClick={() => void runImport(step.backup)} className={primary}>
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
                  ? f('ttImportProgress', step.progress.list.inbox ? t('smartInbox') : step.progress.list.name, step.progress.listIndex + 1, step.progress.listCount)
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
              <span>{step.stopped ? f('msImportStopped', step.totals.created) : f('msImportDone', step.totals.created, step.totals.lists)}</span>
            </div>
            {step.totals.skipped > 0 && <p className="mt-1.5 text-[12px] text-ink-3">{f('msImportSkipped', step.totals.skipped)}</p>}
            <p className="mt-1.5 text-[12px] text-ink-3">{t('msImportAgain')}</p>
            {errorLine}
            <div className="mt-4 flex justify-end gap-2">
              {step.stopped && backup.current && (
                <button type="button" onClick={() => { setError(null); setStep({ kind: 'lists', backup: backup.current! }); }} className={secondary}>
                  {t('msImportBack')}
                </button>
              )}
              <button type="button" onClick={close} className={primary}>{t('msImportFinish')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
