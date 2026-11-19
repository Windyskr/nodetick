import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckSquare,
  ChevronDown,
  Code2,
  History,
  Italic,
  Link2,
  List,
  ListOrdered,
  Plus,
  Quote,
  Strikethrough,
  Underline,
  X,
} from 'lucide-react';
import { useStore } from '../../stores/store';
import { useI18n, useT } from '../../i18n';
import { addDays, dayOf, todayStr } from '../../lib/date';
import { projectDisplayName } from '../../lib/project';
import type { Task } from '../../lib/types';
import { isSubmitEnter } from '../../lib/keys';
import { hasTag } from '../../lib/tags';

type SummaryStatus = 'all' | 'active' | 'completed';
type SummaryGroup = 'status' | 'list' | 'date';

type SummaryTemplate = {
  id: string;
  name: string;
  start: string;
  end: string;
  projectId: string;
  status: SummaryStatus;
  tag: string;
  group: SummaryGroup;
  showContent: boolean;
  includeNext: boolean;
};

const SUMMARY_TEMPLATES_KEY = 'nodetick.summary.templates';

function loadTemplates(): SummaryTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(SUMMARY_TEMPLATES_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekStart(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const current = new Date(year, month - 1, date);
  return localDay(new Date(year, month - 1, date - current.getDay()));
}

function shortDay(day: string, lang: 'en' | 'zh'): string {
  const [, month, date] = day.split('-').map(Number);
  return lang === 'zh' ? `${month}月${date}日` : `${month}/${date}`;
}

function taskRange(task: Task): { start: string | null; end: string | null } {
  const start = dayOf(task.startDate) ?? dayOf(task.dueDate);
  const end = dayOf(task.dueDate) ?? dayOf(task.startDate);
  if (start && end && end < start) return { start: end, end: start };
  return { start, end };
}

function taskInRange(task: Task, start: string, end: string): boolean {
  const range = taskRange(task);
  if (range.start && range.end) return range.start <= end && range.end >= start;
  const completedDay = dayOf(task.completedTime);
  return completedDay != null && completedDay >= start && completedDay <= end;
}

function ToolButton({ title, onClick, children }: { title: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[42px] items-center justify-between gap-3 px-[18px] py-2">
      <span className="text-[14px] text-ink">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function SettingSelect({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <span className="relative inline-flex max-w-[190px] items-center">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-[190px] appearance-none truncate bg-transparent pr-5 text-[13px] text-ink-3 outline-none"
      >
        {children}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-0 text-ink-3" />
    </span>
  );
}

export default function SummaryPage() {
  const { tasks, completed, projects, showToast } = useStore();
  const t = useT();
  const lang = useI18n((state) => state.lang);
  const today = todayStr();
  const initialStart = weekStart(today);
  const initialEnd = addDays(initialStart, 6);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<SummaryStatus>('all');
  const [tag, setTag] = useState('');
  const [group, setGroup] = useState<SummaryGroup>('status');
  const [showContent, setShowContent] = useState(true);
  const [includeNext, setIncludeNext] = useState(false);
  const [templates, setTemplates] = useState<SummaryTemplate[]>(loadTemplates);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => [...tasks, ...completed], [tasks, completed]);
  const tags = useMemo(() => [...new Set(all.flatMap((task) => task.tags))].sort(), [all]);
  const reportEnd = includeNext ? addDays(end, 7) : end;
  const filtered = useMemo(() => all.filter((task) => {
    if (!taskInRange(task, start, reportEnd)) return false;
    if (projectId && task.projectId !== projectId) return false;
    if (status === 'active' && task.status === 2) return false;
    if (status === 'completed' && task.status !== 2) return false;
    if (tag && !hasTag(task, tag)) return false;
    return true;
  }), [all, start, reportEnd, projectId, status, tag]);

  const reportGroups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of filtered) {
      let key = '';
      if (group === 'status') key = task.status === 2 ? t('summaryCompleted') : t('summaryIncomplete');
      else if (group === 'list') key = projectDisplayName(projects.find((project) => project.id === task.projectId), t, t('smartInbox'));
      else key = dayOf(task.dueDate) ?? dayOf(task.startDate) ?? t('summaryNoDate');
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return [...map.entries()];
  }, [filtered, group, projects, t]);

  const doneCount = filtered.filter((task) => task.status === 2).length;
  const activeCount = filtered.length - doneCount;
  const rangeLabel = `${shortDay(start, lang)}-${shortDay(end, lang)}`;
  const editorKey = `${start}:${end}:${reportEnd}:${projectId}:${status}:${tag}:${group}:${showContent}`;

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard?.writeText(editorRef.current?.innerText ?? '');
      showToast({ messageKey: 'summaryCopied' });
    } catch {
      // Clipboard is optional on localhost.
    }
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const next = [...templates, {
      id: crypto.randomUUID(), name, start, end, projectId, status, tag, group,
      showContent, includeNext,
    }];
    setTemplates(next);
    localStorage.setItem(SUMMARY_TEMPLATES_KEY, JSON.stringify(next));
    setTemplateName('');
    setTemplateDialogOpen(false);
    showToast({ messageKey: 'summaryTemplateSaved' });
  };

  const applyTemplate = (template: SummaryTemplate) => {
    setStart(template.start);
    setEnd(template.end);
    setProjectId(template.projectId);
    setStatus(template.status);
    setTag(template.tag);
    setGroup(template.group);
    setShowContent(template.showContent);
    setIncludeNext(template.includeNext);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 gap-5 bg-white">
      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex h-[58px] shrink-0 items-center gap-2 px-5">
          <List size={20} className="text-ink-2" />
          <h1 className="text-[20px] font-bold leading-8">{t('summary')}</h1>
        </div>

        <div className="mx-5 flex h-[38px] shrink-0 items-center gap-0.5 overflow-hidden rounded-t-lg border border-line px-3 text-ink-2">
          <ToolButton title={t('summaryHeading')} onClick={() => exec('formatBlock', 'h2')}><span className="text-[18px] font-medium">H</span></ToolButton>
          <ToolButton title={t('summaryBold')} onClick={() => exec('bold')}><Bold size={19} /></ToolButton>
          <ToolButton title={t('summaryHighlight')} onClick={() => exec('hiliteColor', '#dfff00')}><span className="rounded bg-[#dfff00] px-1 text-[17px] text-ink">A</span></ToolButton>
          <ToolbarDivider />
          <ToolButton title={t('summaryChecklist')} onClick={() => exec('insertUnorderedList')}><CheckSquare size={19} /></ToolButton>
          <ToolButton title={t('summaryBullets')} onClick={() => exec('insertUnorderedList')}><List size={19} /></ToolButton>
          <ToolButton title={t('summaryNumbers')} onClick={() => exec('insertOrderedList')}><ListOrdered size={19} /></ToolButton>
          <ToolbarDivider />
          <ToolButton title={t('summaryItalic')} onClick={() => exec('italic')}><Italic size={19} /></ToolButton>
          <ToolButton title={t('summaryUnderline')} onClick={() => exec('underline')}><Underline size={19} /></ToolButton>
          <ToolButton title={t('summaryStrike')} onClick={() => exec('strikeThrough')}><Strikethrough size={19} /></ToolButton>
          <ToolbarDivider />
          <ToolButton title={t('summaryAlign')} onClick={() => exec('justifyLeft')}><AlignLeft size={19} /></ToolButton>
          <ToolButton title={t('summaryHistory')} onClick={() => exec('formatBlock', 'p')}><History size={19} /></ToolButton>
          <ToolButton title={t('summaryLink')} onClick={() => exec('createLink', window.prompt(t('summaryLinkPrompt')) ?? '')}><Link2 size={19} /></ToolButton>
          <ToolButton title={t('summaryCode')} onClick={() => exec('formatBlock', 'pre')}><Code2 size={19} /></ToolButton>
          <ToolButton title={t('summaryQuote')} onClick={() => exec('formatBlock', 'blockquote')}><Quote size={19} /></ToolButton>
          <div className="hidden items-center gap-1 md:flex">
            <ToolButton title={t('summaryAlignCenter')} onClick={() => exec('justifyCenter')}><AlignCenter size={18} /></ToolButton>
            <ToolButton title={t('summaryAlignRight')} onClick={() => exec('justifyRight')}><AlignRight size={18} /></ToolButton>
          </div>
        </div>

        <div
          key={editorKey}
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="mx-5 min-h-0 flex-1 overflow-y-auto border-x border-line px-4 pb-12 pt-3 text-[16px] leading-relaxed text-ink outline-none"
        >
          <h2 className="mb-4 text-[23px] font-bold">{rangeLabel}</h2>
          {filtered.length === 0 ? (
            <p className="text-[16px] text-ink-2">{t('summaryEmpty')}</p>
          ) : (
            <>
              <p className="mb-5 text-ink-2">{t('summaryStats').replace('{0}', String(doneCount)).replace('{1}', String(activeCount))}</p>
              {reportGroups.map(([label, groupTasks]) => (
                <section key={label} className="mb-5">
                  <h3 className="mb-2 text-[17px] font-semibold">{label} <span className="font-normal text-ink-3">{groupTasks.length}</span></h3>
                  <ul className="space-y-1.5 pl-5">
                    {groupTasks.map((task) => (
                      <li key={task.id} className={task.status === 2 ? 'text-ink-3 line-through' : ''}>
                        {task.title || t('untitled')}
                        {showContent && (task.content || task.desc) && <div className="text-[13px] text-ink-3 no-underline">{task.content || task.desc}</div>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
        <div className="mx-5 flex h-12 shrink-0 items-center justify-end gap-4 border-x border-b border-line px-4 text-[14px] text-ink-2">
          <button type="button" className="hover:text-ink" onClick={() => setTemplateDialogOpen(true)}>{t('summarySaveAs')}</button>
          <button type="button" className="hover:text-ink" onClick={() => void copySummary()}>{t('copy')}</button>
        </div>
      </main>

      <aside className="hidden w-[320px] shrink-0 overflow-y-auto bg-white pr-5 lg:block">
        <div className="h-[113px] pt-5">
          <h2 className="text-[16px] font-bold leading-5">{t('summaryTemplates')}</h2>
          <button type="button" title={t('summaryNewTemplate')} onClick={() => setTemplateDialogOpen(true)} className="mt-3 flex h-7 w-7 items-center justify-center rounded-full bg-hover text-ink-3 hover:bg-tt-light hover:text-tt">
            <Plus size={20} />
          </button>
          {templates.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {templates.map((template) => (
                <button key={template.id} type="button" onClick={() => applyTemplate(template)} className="rounded-md bg-hover px-2.5 py-1 text-[13px] text-ink-2 hover:bg-tt-light hover:text-tt">
                  {template.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <h3 className="h-[26px] text-[16px] font-bold leading-5">{t('summaryFilterSettings')}</h3>
        <div className="relative overflow-visible rounded-xl bg-[#fafafa]">
          <SummaryDateRow start={start} end={end} onStart={setStart} onEnd={setEnd} label={t('summaryDate')} value={rangeLabel} open={datePickerOpen} onToggle={() => setDatePickerOpen((value) => !value)} />
          <SettingRow label={t('filterList')}>
            <SettingSelect value={projectId} onChange={setProjectId}>
              <option value="">{t('summaryAllLists')}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, t)}</option>)}
            </SettingSelect>
          </SettingRow>
          <SettingRow label={t('filterStatus')}>
            <SettingSelect value={status} onChange={(value) => setStatus(value as SummaryStatus)}>
              <option value="all">{t('summaryAllStatus')}</option>
              <option value="active">{t('filterIncomplete')}</option>
              <option value="completed">{t('filterCompleted')}</option>
            </SettingSelect>
          </SettingRow>
          <SettingRow label={t('summaryMore')}>
            <SettingSelect value={tag} onChange={setTag}>
              <option value="">{t('summaryNone')}</option>
              {tags.map((item) => <option key={item} value={item}>#{item}</option>)}
            </SettingSelect>
          </SettingRow>
        </div>

        <h3 className="h-[46px] pt-5 text-[16px] font-bold leading-5">{t('summaryDisplaySettings')}</h3>
        <div className="overflow-hidden rounded-xl bg-[#fafafa]">
          <SettingRow label={t('groupBy')}>
            <SettingSelect value={group} onChange={(value) => setGroup(value as SummaryGroup)}>
              <option value="status">{t('summaryGroupStatus')}</option>
              <option value="list">{t('summaryGroupList')}</option>
              <option value="date">{t('summaryGroupDate')}</option>
            </SettingSelect>
          </SettingRow>
          <SettingRow label={t('summaryContent')}>
            <SettingSelect value={showContent ? 'all' : 'title'} onChange={(value) => setShowContent(value === 'all')}>
              <option value="all">{t('summaryContentAll')}</option>
              <option value="title">{t('summaryContentTitle')}</option>
            </SettingSelect>
          </SettingRow>
        </div>

        <div className="flex h-[46px] items-end justify-between pb-1 text-[16px] font-semibold">
          <span>{t('summaryNextPeriod')}</span>
          <button type="button" role="switch" aria-checked={includeNext} onClick={() => setIncludeNext((value) => !value)} className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${includeNext ? 'justify-end bg-tt' : 'justify-start bg-[#e4e4e4]'}`}>
            <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
          </button>
        </div>
      </aside>

      {templateDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onMouseDown={() => setTemplateDialogOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="summary-template-title" className="w-[440px] rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex h-14 items-center px-5">
              <h2 id="summary-template-title" className="text-[17px] font-bold">{t('summarySaveAs')} {t('summaryTemplates')}</h2>
              <button type="button" title={t('close')} className="ml-auto text-ink-3 hover:text-ink" onClick={() => setTemplateDialogOpen(false)}><X size={20} /></button>
            </div>
            <div className="px-5 pb-5">
              <p className="mb-4 text-[14px] text-ink-2">{t('summaryTemplateDescription')}</p>
              <input autoFocus value={templateName} onChange={(event) => setTemplateName(event.target.value)} onKeyDown={(event) => { if (isSubmitEnter(event)) saveTemplate(); }} placeholder={t('summaryTemplateName')} className="h-9 w-full rounded-md border border-line px-3 text-[14px] outline-none focus:border-tt" />
            </div>
            <div className="flex h-[58px] items-center justify-end gap-2 border-t border-line px-5">
              <button type="button" className="h-[30px] min-w-[100px] rounded-md border border-line px-4 text-[14px]" onClick={() => setTemplateDialogOpen(false)}>{t('close')}</button>
              <button type="button" disabled={!templateName.trim()} className="h-[30px] min-w-[100px] rounded-md bg-tt px-4 text-[14px] text-white disabled:opacity-40" onClick={saveTemplate}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryDateRow({ start, end, onStart, onEnd, label, value, open, onToggle }: { start: string; end: string; onStart: (value: string) => void; onEnd: (value: string) => void; label: string; value: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-white">
      <button type="button" onClick={onToggle} className="flex min-h-[42px] w-full items-center justify-between gap-2 px-[18px] py-2">
        <span className="text-[14px] text-ink">{label}</span>
        <span className="text-[13px] text-ink-3">{value}</span>
      </button>
      {open && <div className="absolute left-0 top-[44px] z-20 grid w-full grid-cols-2 gap-2 rounded-lg border border-line bg-white p-3 shadow-lg">
        <input type="date" value={start} onChange={(event) => onStart(event.target.value)} className="min-w-0 rounded-md border border-line bg-white px-2 py-1.5 text-[11px] text-ink-2" aria-label={`${label} start`} />
        <input type="date" value={end} onChange={(event) => onEnd(event.target.value)} className="min-w-0 rounded-md border border-line bg-white px-2 py-1.5 text-[11px] text-ink-2" aria-label={`${label} end`} />
      </div>}
    </div>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 hidden h-5 w-px bg-line sm:block" />;
}
