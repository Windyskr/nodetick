import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Pencil, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { FilterDateMode, Task } from '../../lib/types';
import { useT } from '../../i18n';
import { addDays, dayOf, todayStr } from '../../lib/date';
import { projectDisplayName } from '../../lib/project';
import { useStore } from '../../stores/store';
import { TaskRow } from './TaskRow';
import { PRIORITY_LEVELS, priorityLabel } from '../../components/RoundCheck';
import { isSubmitEnter } from '../../lib/keys';
import { hasTag } from '../../lib/tags';

type SearchStatus = 'all' | 'active' | 'completed';

function matchesDate(task: Task, mode: FilterDateMode, today: string): boolean {
  if (mode === 'any') return true;
  const start = dayOf(task.startDate) ?? dayOf(task.dueDate);
  const end = dayOf(task.dueDate) ?? dayOf(task.startDate);
  if (!start || !end) return false;
  if (mode === 'today') return start <= today && end >= today;
  if (mode === 'tomorrow') {
    const tomorrow = addDays(today, 1);
    return start <= tomorrow && end >= tomorrow;
  }
  if (mode === 'week') return start <= addDays(today, 7) && end >= today;
  if (mode === 'overdue') return end < today && task.status !== 2;
  return true;
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="relative inline-flex h-6 items-center rounded-md border border-line bg-white pl-2.5 pr-6 text-[12px] text-ink hover:bg-hover">
      <span className="pointer-events-none">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="absolute inset-0 cursor-pointer appearance-none opacity-0">
        {children}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-1.5 text-ink-3" />
    </label>
  );
}

/** TickTick-style full-task search with combinable list, tag, date, priority and status filters. */
export default function SearchPage() {
  const t = useT();
  const navigate = useNavigate();
  const { tasks, completed, projects, tags, addFilter, showToast } = useStore();
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [tag, setTag] = useState('');
  const [dateMode, setDateMode] = useState<FilterDateMode>('any');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState<SearchStatus>('all');
  const [saveOpen, setSaveOpen] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const today = todayStr();

  const results = useMemo(() => {
    const keywords = query.trim().toLocaleLowerCase();
    return [...tasks, ...completed].filter((task) => {
      if (keywords) {
        const text = [task.title, task.content, task.desc, ...task.tags].join('\n').toLocaleLowerCase();
        if (!text.includes(keywords)) return false;
      }
      if (projectId && task.projectId !== projectId) return false;
      if (tag && !hasTag(task, tag)) return false;
      if (priority !== '' && task.priority !== Number(priority)) return false;
      if (status === 'active' && task.status === 2) return false;
      if (status === 'completed' && task.status !== 2) return false;
      return matchesDate(task, dateMode, today);
    });
  }, [tasks, completed, query, projectId, tag, priority, status, dateMode, today]);

  const saveFilter = async () => {
    const name = filterName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await addFilter({
        name,
        logic: 'and',
        dateMode,
        dateStart: null,
        dateEnd: null,
        projectIds: projectId ? [projectId] : [],
        tags: tag ? [tag] : [],
        priorities: priority !== '' ? [Number(priority)] : [],
        statuses: status === 'all' ? [] : [status === 'completed' ? 2 : 0],
      });
      setSaveOpen(false);
      setFilterName('');
      showToast({ messageKey: 'searchFilterSaved' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-[54px] shrink-0 items-center px-5">
        <button type="button" title={t('close')} onClick={() => navigate('/app/tasks/all')} className="mr-2 text-ink-2 hover:text-ink"><X size={20} /></button>
        <input
          ref={inputRef}
          data-search-input
          autoFocus
          value={query}
          placeholder={t('searchTitle')}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[20px] font-bold text-ink outline-none placeholder:text-ink"
        />
        <Pencil size={14} className="ml-2 text-ink-3" />
        <button type="button" onClick={() => setSaveOpen(true)} className="ml-auto h-[30px] rounded-lg border border-line px-4 text-[13px] text-tt hover:bg-hover">
          {t('searchSaveFilter')}
        </button>
      </header>

      <div className="flex h-[41px] shrink-0 items-start gap-2 px-5 pt-2">
        <FilterSelect label={t('filterList')} value={projectId} onChange={setProjectId}>
          <option value="">{t('summaryAllLists')}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{projectDisplayName(project, t)}</option>)}
        </FilterSelect>
        <FilterSelect label={t('filterTag')} value={tag} onChange={setTag}>
          <option value="">{t('filterAnyTag')}</option>
          {tags.map((item) => <option key={item.name} value={item.name}>#{item.label}</option>)}
        </FilterSelect>
        <FilterSelect label={t('filterDate')} value={dateMode} onChange={(value) => setDateMode(value as FilterDateMode)}>
          <option value="any">{t('filterDate_any')}</option>
          <option value="today">{t('filterDate_today')}</option>
          <option value="tomorrow">{t('filterDate_tomorrow')}</option>
          <option value="week">{t('filterDate_week')}</option>
          <option value="overdue">{t('filterDate_overdue')}</option>
        </FilterSelect>
        <FilterSelect label={t('filterPriority')} value={priority} onChange={setPriority}>
          <option value="">{t('filterAnyPriority')}</option>
          {PRIORITY_LEVELS.map((value) => <option key={value} value={value}>{priorityLabel(value)}</option>)}
        </FilterSelect>
        <FilterSelect label={t('filterStatus')} value={status} onChange={(value) => setStatus(value as SearchStatus)}>
          <option value="all">{t('filterAnyStatus')}</option>
          <option value="active">{t('filterIncomplete')}</option>
          <option value="completed">{t('filterCompleted')}</option>
        </FilterSelect>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line pb-12">
        {results.length === 0 ? (
          <div className="pt-16 text-center text-[13px] text-ink-3">{t('searchEmpty')}</div>
        ) : results.map((task) => <TaskRow key={task.id} task={task} showProject showDetails />)}
      </div>

      {saveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onMouseDown={() => setSaveOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="save-filter-title" className="w-[440px] rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex h-14 items-center border-b border-line px-5">
              <h2 id="save-filter-title" className="text-[17px] font-semibold">{t('searchSaveFilter')}</h2>
              <button type="button" title={t('close')} onClick={() => setSaveOpen(false)} className="ml-auto text-ink-3"><X size={18} /></button>
            </div>
            <div className="p-5">
              <input autoFocus value={filterName} onChange={(event) => setFilterName(event.target.value)} onKeyDown={(event) => { if (isSubmitEnter(event)) void saveFilter(); }} placeholder={t('filterNamePh')} className="h-9 w-full rounded-md border border-tt px-3 text-[14px] outline-none" />
              {query.trim() && <p className="mt-2 text-[12px] text-ink-3">{t('searchFilterKeywordHint')}</p>}
            </div>
            <div className="flex h-[58px] items-center justify-end gap-2 border-t border-line px-5">
              <button type="button" onClick={() => setSaveOpen(false)} className="h-[30px] min-w-[100px] rounded-md border border-line text-[13px]">{t('cancel')}</button>
              <button type="button" disabled={!filterName.trim() || saving} onClick={() => void saveFilter()} className="h-[30px] min-w-[100px] rounded-md bg-tt text-[13px] text-white disabled:opacity-40">{t('save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
