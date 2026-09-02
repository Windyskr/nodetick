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
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { useStore } from '../../stores/store';
import { useI18n, useT } from '../../i18n';
import { addDays, dayOf, todayStr } from '../../lib/date';
import { projectDisplayName } from '../../lib/project';
import type { Task } from '../../lib/types';

type SummaryStatus = 'all' | 'active' | 'completed';
type SummaryGroup = 'status' | 'list' | 'date';

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
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2.5">
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
  const editorRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => [...tasks, ...completed], [tasks, completed]);
  const tags = useMemo(() => [...new Set(all.flatMap((task) => task.tags))].sort(), [all]);
  const reportEnd = includeNext ? addDays(end, 7) : end;
  const filtered = useMemo(() => all.filter((task) => {
    if (!taskInRange(task, start, reportEnd)) return false;
    if (projectId && task.projectId !== projectId) return false;
    if (status === 'active' && task.status === 2) return false;
    if (status === 'completed' && task.status !== 2) return false;
    if (tag && !task.tags.includes(tag)) return false;
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

  const share = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      showToast({ messageKey: 'shareCopied' });
    } catch {
      // Clipboard is optional on localhost.
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex items-center gap-2 px-6 pb-3 pt-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-hover text-ink-2">
            <List size={23} />
          </div>
          <h1 className="text-[24px] font-bold">{t('summary')}</h1>
          <div className="ml-auto flex items-center gap-1 text-ink-3">
            <ToolButton title={t('undo')} onClick={() => exec('undo')}><Undo2 size={18} /></ToolButton>
            <ToolButton title={t('redo')} onClick={() => exec('redo')}><Redo2 size={18} /></ToolButton>
            <ToolButton title={t('share')} onClick={() => void share()}><Link2 size={18} /></ToolButton>
          </div>
        </div>

        <div className="mx-6 flex flex-wrap items-center gap-0.5 border-b border-line px-1 py-1 text-ink-2">
          <ToolButton title={t('summaryHeading')} onClick={() => exec('formatBlock', 'h2')}><span className="text-[20px] font-medium">H</span></ToolButton>
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
          className="min-h-0 flex-1 overflow-y-auto px-7 pb-12 pt-7 text-[16px] leading-relaxed text-ink outline-none"
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
      </main>

      <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-line bg-white xl:block">
        <div className="flex items-center justify-between px-6 pb-2 pt-6">
          <h2 className="text-[17px] font-bold">{t('summaryTemplates')}</h2>
          <button type="button" title={t('summaryNewTemplate')} className="flex h-9 w-9 items-center justify-center rounded-full bg-hover text-ink-3 hover:bg-tt-light hover:text-tt">
            <Plus size={20} />
          </button>
        </div>

        <h3 className="px-6 pb-2 pt-7 text-[17px] font-bold">{t('summaryFilterSettings')}</h3>
        <div className="mx-5 overflow-hidden rounded-xl bg-[#fafafa]">
          <SummaryDateRow start={start} end={end} onStart={setStart} onEnd={setEnd} label={t('summaryDate')} value={rangeLabel} />
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

        <h3 className="px-6 pb-2 pt-7 text-[17px] font-bold">{t('summaryDisplaySettings')}</h3>
        <div className="mx-5 overflow-hidden rounded-xl bg-[#fafafa]">
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

        <div className="flex items-center justify-between px-6 py-6 text-[16px] font-semibold">
          <span>{t('summaryNextPeriod')}</span>
          <button type="button" role="switch" aria-checked={includeNext} onClick={() => setIncludeNext((value) => !value)} className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${includeNext ? 'justify-end bg-tt' : 'justify-start bg-[#e4e4e4]'}`}>
            <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
          </button>
        </div>
      </aside>
    </div>
  );
}

function SummaryDateRow({ start, end, onStart, onEnd, label, value }: { start: string; end: string; onStart: (value: string) => void; onEnd: (value: string) => void; label: string; value: string }) {
  return (
    <div className="border-b border-white px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] text-ink">{label}</span>
        <span className="text-[13px] text-ink-3">{value}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input type="date" value={start} onChange={(event) => onStart(event.target.value)} className="min-w-0 rounded-md border border-line bg-white px-2 py-1.5 text-[11px] text-ink-2" aria-label={label} />
        <input type="date" value={end} onChange={(event) => onEnd(event.target.value)} className="min-w-0 rounded-md border border-line bg-white px-2 py-1.5 text-[11px] text-ink-2" aria-label={label} />
      </div>
    </div>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 hidden h-5 w-px bg-line sm:block" />;
}
