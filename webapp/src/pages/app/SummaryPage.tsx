import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, FileText, Image as ImageIcon, Mail, Menu, NotebookPen, PanelRight, RotateCcw, Share2 } from 'lucide-react';
import { useStore } from '../../stores/store';
import { useFocus } from '../../stores/focus';
import { useI18n, useT } from '../../i18n';
import { api } from '../../lib/api';
import { todayStr } from '../../lib/date';
import { errorMessage } from '../../lib/errors';
import { projectDisplayName } from '../../lib/project';
import {
  buildSummary,
  DEFAULT_SUMMARY_CONFIG,
  followingPeriod,
  periodLabel,
  resolvePeriod,
  summaryDraftKey,
  type SummaryConfig,
  type SummaryPeriod,
  type SummaryState,
  type SummaryTemplate,
} from '../../lib/summary';
import { RichTextEditor, type RichEditorHandle } from '../../components/editor';
import { PageSpinner } from '../../components/PageSpinner';
import { SettingsPanel } from './summary/SettingsPanel';
import { NoteDialog, TemplateDialog } from './summary/dialogs';
import { anchorOf, FloatingMenu } from './summary/ui';
import { canShare, copySummary, downloadBlob, emailSummary, printSummary, shareSummary, summaryFileName, summaryImage } from './summary/exporters';

/** Remembered show/hide of the settings column on wide windows. */
const PANEL_KEY = 'ntk_summary_panel';
/** Below this the settings open over the summary instead of beside it. */
const WIDE_QUERY = '(min-width: 1100px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Focused seconds per task in a period, for the "focus time" field. */
function useFocusSeconds(period: SummaryPeriod | null): Map<string, number> | undefined {
  const [seconds, setSeconds] = useState<Map<string, number>>();
  const version = useFocus((state) => state.recordsVersion);
  const from = period?.from;
  const to = period?.to;
  useEffect(() => {
    if (!from || !to) {
      setSeconds(undefined);
      return;
    }
    let alive = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    api.focusStats({ tz, from, to }).then(
      (stats) => alive && setSeconds(new Map(stats.byTask.flatMap((entry) => (entry.taskId ? [[entry.taskId, entry.seconds] as const] : [])))),
      // Longer than the statistics allow (over a year): no focus times.
      () => alive && setSeconds(undefined),
    );
    return () => {
      alive = false;
    };
  }, [from, to, version]);
  return seconds;
}

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export default function SummaryPage() {
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const tasks = useStore((state) => state.tasks);
  const completed = useStore((state) => state.completed);
  const abandoned = useStore((state) => state.abandoned);
  const projects = useStore((state) => state.projects);
  const tags = useStore((state) => state.tags);
  const { showToast, setNavOpen, createTask } = useStore();
  const today = todayStr();

  const [state, setState] = useState<SummaryState | null>(null);
  const [templates, setTemplates] = useState<SummaryTemplate[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const wide = useMediaQuery(WIDE_QUERY);
  const [pinnedPanel, setPinnedPanel] = useState(() => localStorage.getItem(PANEL_KEY) !== '0');
  const [overlayPanel, setOverlayPanel] = useState(false);
  const panelOpen = wide ? pinnedPanel : overlayPanel;
  const [templateDialog, setTemplateDialog] = useState<{ template: SummaryTemplate | null } | null>(null);
  const [noteDialog, setNoteDialog] = useState(false);
  const [saveMenu, setSaveMenu] = useState<ReturnType<typeof anchorOf> | null>(null);
  const editorRef = useRef<RichEditorHandle>(null);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    Promise.all([api.summaryState(), api.listSummaryTemplates()]).then(
      ([loaded, list]) => {
        if (!alive) return;
        setState(loaded);
        setTemplates(list);
      },
      (error) => alive && setLoadError(error),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const config = state?.config ?? DEFAULT_SUMMARY_CONFIG;
  const period = useMemo(() => resolvePeriod(config, today), [config, today]);
  const next = useMemo(() => (config.nextPeriod ? followingPeriod(config.range, period) : null), [config.nextPeriod, config.range, period]);
  const wantFocus = config.fields.includes('focus');
  const focus = useFocusSeconds(wantFocus ? period : null);
  const nextFocus = useFocusSeconds(wantFocus ? next : null);
  const data = useMemo(() => ({ tasks: [...tasks, ...completed, ...abandoned], projects, tags }), [tasks, completed, abandoned, projects, tags]);
  const generated = useMemo(
    () => buildSummary({ config, data, lang, today, focus, nextFocus }),
    [config, data, lang, today, focus, nextFocus],
  );
  const draftKey = useMemo(() => summaryDraftKey(config, today), [config, today]);
  const draft = state?.draft != null && state.draftKey === draftKey ? state.draft : null;
  const value = draft ?? generated;
  const title = `${t('summary')} ${periodLabel(period, lang, today)}`;

  // Edits and settings are saved as they happen; these refs give the
  // debounced and unmount-time saves the latest values.
  const latest = useRef({ generated, draftKey, hasDraft: draft != null });
  latest.current = { generated, draftKey, hasDraft: draft != null };
  const pendingConfig = useRef<SummaryConfig | null>(null);
  const configTimer = useRef<number | undefined>(undefined);
  const flushConfig = useCallback(() => {
    window.clearTimeout(configTimer.current);
    const pending = pendingConfig.current;
    if (!pending) return;
    pendingConfig.current = null;
    void api.saveSummaryState({ config: pending });
  }, []);
  useEffect(() => () => flushConfig(), [flushConfig]);

  const updateConfig = (patch: Partial<SummaryConfig>) => {
    if (!state) return;
    const nextConfig = { ...state.config, ...patch };
    setState({ ...state, config: nextConfig });
    pendingConfig.current = nextConfig;
    window.clearTimeout(configTimer.current);
    configTimer.current = window.setTimeout(flushConfig, 400);
  };

  /** The editor reports edits (debounced): keep them as the draft, or drop the draft once the text matches the tasks again. */
  const onEdit = (markdown: string) => {
    const { generated: fresh, draftKey: key, hasDraft } = latest.current;
    if (markdown === fresh) {
      if (!hasDraft) return;
      setState((current) => current && { ...current, draft: null, draftKey: null });
      void api.saveSummaryState({ draft: null, draftKey: null });
      return;
    }
    setState((current) => current && { ...current, draft: markdown, draftKey: key });
    void api.saveSummaryState({ draft: markdown, draftKey: key });
  };

  const regenerate = () => {
    setState((current) => current && { ...current, draft: null, draftKey: null });
    editorRef.current?.setMarkdown(generated);
    void api.saveSummaryState({ draft: null, draftKey: null });
  };

  const togglePanel = () => {
    if (!wide) {
      setOverlayPanel((open) => !open);
      return;
    }
    const nextOpen = !pinnedPanel;
    setPinnedPanel(nextOpen);
    localStorage.setItem(PANEL_KEY, nextOpen ? '1' : '0');
  };

  const saveTemplate = async (name: string, takeCurrent: boolean) => {
    const editing = templateDialog?.template;
    if (editing) {
      const updated = await api.updateSummaryTemplate(editing.id, { name, ...(takeCurrent ? { config } : {}) });
      setTemplates((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      return;
    }
    const created = await api.createSummaryTemplate({ name, config });
    setTemplates((list) => [...list, created]);
    showToast({ messageKey: 'summaryTemplateSaved' });
  };

  const deleteTemplate = async (template: SummaryTemplate) => {
    await api.deleteSummaryTemplate(template.id);
    setTemplates((list) => list.filter((item) => item.id !== template.id));
    showToast({
      messageKey: 'summaryTemplateDeleted',
      undo: () => {
        void api.createSummaryTemplate({ name: template.name, config: template.config }).then((created) => setTemplates((list) => [...list, created]));
      },
    });
  };

  // The rendered text (for copying as rich text, printing and the image); null while the plain-text fallback shows.
  const prose = () => docRef.current?.querySelector<HTMLElement>('.nt-prose') ?? null;
  const markdownNow = () => editorRef.current?.getMarkdown() ?? value;

  const copy = async () => {
    try {
      await copySummary(markdownNow(), prose()?.innerHTML ?? null);
      showToast({ messageKey: 'summaryCopied' });
    } catch (error) {
      showToast({ messageKey: 'toastError', messageArg: errorMessage(error) });
    }
  };

  const saveImage = async () => {
    const element = prose();
    try {
      if (!element) throw new Error('no editor');
      const blob = await summaryImage(element, cssVar('--nt-surface', '#ffffff'), cssVar('--color-tt', '#4772fa'));
      downloadBlob(blob, summaryFileName(title, 'png'));
    } catch {
      showToast({ messageKey: 'toastError', messageArg: t('summaryImageFailed') });
    }
  };

  const savePdf = () => {
    const element = prose();
    const escaped = markdownNow().replace(/&/g, '&amp;').replace(/</g, '&lt;');
    printSummary(title, element ? element.innerHTML : `<pre>${escaped}</pre>`);
  };

  const sendEmail = async () => {
    const text = markdownNow();
    if (!emailSummary(title, text)) {
      await copySummary(text, null);
      showToast({ messageKey: 'summaryEmailCopied' });
    }
  };

  const saveNote = async (noteTitle: string, projectId: string) => {
    await createTask({ title: noteTitle, projectId, kind: 'NOTE', content: markdownNow() });
    const project = projects.find((item) => item.id === projectId);
    showToast({ messageKey: 'summaryNoteSaved', messageArg: projectDisplayName(project, t, t('smartInbox')) });
  };

  const share = async () => {
    try {
      await shareSummary(title, markdownNow());
    } catch (error) {
      showToast({ messageKey: 'toastError', messageArg: errorMessage(error) });
    }
  };

  const panel = state && (
    <SettingsPanel
      config={config}
      onChange={updateConfig}
      templates={templates}
      onApplyTemplate={(template) => updateConfig(template.config)}
      onNewTemplate={() => setTemplateDialog({ template: null })}
      onEditTemplate={(template) => setTemplateDialog({ template })}
      onDeleteTemplate={(template) => void deleteTemplate(template)}
      projects={projects}
      tags={tags}
      today={today}
      onClose={wide ? undefined : () => setOverlayPanel(false)}
    />
  );

  const saveItem = (icon: ReactNode, label: string, action: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setSaveMenu(null);
        action();
      }}
      className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left text-[13px] text-ink hover:bg-hover"
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex h-full min-w-0 flex-1 bg-white">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-5">
          {/* Phones hide the list sidebar behind this button (see AppLayout). */}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            title={t('sectionLists')}
            aria-label={t('sectionLists')}
            className="-ml-2 shrink-0 rounded-md p-1 text-ink-2 hover:bg-hover md:hidden"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-[20px] font-bold">{t('summary')}</h1>
          {draft != null && (
            <span className="ml-2 flex items-center gap-1.5 text-[12px] text-ink-3">
              <span>{t('summaryEdited')}</span>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={regenerate} title={t('summaryRegenerateHint')} className="flex items-center gap-1 rounded-md px-1 py-0.5 text-tt hover:bg-tt-light">
                <RotateCcw size={12} />
                {t('summaryRegenerate')}
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={togglePanel}
            aria-pressed={panelOpen}
            title={t(panelOpen ? 'summaryHidePanel' : 'summaryShowPanel')}
            aria-label={t(panelOpen ? 'summaryHidePanel' : 'summaryShowPanel')}
            className={`ml-auto rounded-md p-1.5 hover:bg-hover ${panelOpen ? 'text-tt' : 'text-ink-2'}`}
          >
            <PanelRight size={19} />
          </button>
        </header>

        <div className="mx-5 flex min-h-0 flex-1 flex-col">
          {loadError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-ink-2">
              <p>{errorMessage(loadError)}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-md border border-line px-3 py-1.5 text-ink hover:bg-hover">
                {t('retry')}
              </button>
            </div>
          ) : !state ? (
            <PageSpinner />
          ) : (
            <div ref={docRef} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line [&_.nt-toolbar]:sticky [&_.nt-toolbar]:top-0 [&_.nt-toolbar]:z-[2] [&_.nt-toolbar]:bg-[var(--nt-surface)] [&_.nt-toolbar]:px-3">
              <RichTextEditor
                ref={editorRef}
                value={value}
                onChange={onEdit}
                toolbar="fixed"
                size="document"
                ariaLabel={t('summaryEditorLabel')}
                className="min-h-full px-0 [&_.nt-editor-body]:px-5 [&_.nt-editor-body]:pb-10 [&_.nt-editor-body]:pt-3"
              />
            </div>
          )}
        </div>

        <footer className="mx-5 flex h-12 shrink-0 items-center justify-end gap-1 text-[13px] text-ink-2">
          <button
            type="button"
            disabled={!state}
            aria-haspopup="menu"
            aria-expanded={!!saveMenu}
            onClick={(event) => {
              const anchor = anchorOf(event.currentTarget);
              setSaveMenu((open) => (open ? null : anchor));
            }}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <FileText size={15} />
            {t('summarySaveAs')}
          </button>
          <button type="button" disabled={!state} onClick={() => void copy()} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 hover:bg-hover hover:text-ink disabled:opacity-40">
            <Copy size={15} />
            {t('copy')}
          </button>
        </footer>
      </main>

      {panel && wide && panelOpen && <aside className="w-[300px] shrink-0 border-l border-line bg-white">{panel}</aside>}
      {panel && !wide && panelOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/20"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOverlayPanel(false);
          }}
        >
          <aside className="h-full w-[min(320px,90vw)] bg-white shadow-[0_12px_36px_rgba(0,0,0,0.18)]">{panel}</aside>
        </div>
      )}

      {saveMenu && (
        <FloatingMenu anchor={saveMenu} onClose={() => setSaveMenu(null)} width={180} label={t('summarySaveAs')}>
          {saveItem(<FileText size={15} className="text-[#e5534b]" />, t('summarySaveAsPdf'), savePdf)}
          {saveItem(<ImageIcon size={15} className="text-[#e8a33d]" />, t('summarySaveAsImage'), () => void saveImage())}
          {saveItem(<Mail size={15} className="text-tt" />, t('summarySendEmail'), () => void sendEmail())}
          {saveItem(<NotebookPen size={15} className="text-[#3fa66b]" />, t('summarySaveAsNote'), () => setNoteDialog(true))}
          {canShare() && saveItem(<Share2 size={15} className="text-ink-2" />, t('summaryShare'), () => void share())}
        </FloatingMenu>
      )}

      {templateDialog && (
        <TemplateDialog
          initialName={templateDialog.template?.name ?? ''}
          editing={!!templateDialog.template}
          onSave={saveTemplate}
          onClose={() => setTemplateDialog(null)}
        />
      )}
      {noteDialog && (
        <NoteDialog initialTitle={title} projects={projects} onSave={saveNote} onClose={() => setNoteDialog(false)} />
      )}
    </div>
  );
}
