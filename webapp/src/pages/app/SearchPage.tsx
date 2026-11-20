import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Clock, Flag, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { FilterDateMode, FilterKind, Project, Task } from '../../lib/types';
import { useT, useTF } from '../../i18n';
import { todayStr } from '../../lib/date';
import { INBOX_ID, projectDisplayName } from '../../lib/project';
import { useStore } from '../../stores/store';
import { TaskRow } from './TaskRow';
import { PRIORITY_COLORS, PRIORITY_LEVELS, priorityLabel } from '../../components/RoundCheck';
import { isSubmitEnter } from '../../lib/keys';
import { Popover } from '../../components/Popover';
import { matchesSavedFilter, type FilterConditions } from '../../components/TaskFilterMenu';
import { DATE_LABEL_KEYS, DATE_OPTIONS, KIND_LABEL_KEYS, KIND_OPTIONS } from '../../components/FilterEditor';
import {
  compareResults,
  highlightParts,
  matchTask,
  persistRecentSearches,
  readRecentSearches,
  rememberSearch,
  searchTerms,
  type TaskMatch,
} from '../../lib/search';

const STATUS_OPTIONS = [0, 2, -1] as const;
const STATUS_LABEL_KEYS = { 0: 'filterIncomplete', 2: 'filterCompleted', [-1]: 'filterAbandoned' } as const;

type Result = { task: Task; match: TaskMatch };

function toggled<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/** A filter chip with a dropdown; highlighted while it narrows the results. */
function FilterChip({ label, active, children, wide = false }: { label: string; active: boolean; children: (close: () => void) => ReactNode; wide?: boolean }) {
  return (
    <Popover
      panelClass={`${wide ? 'w-64' : 'w-52'} max-h-80 overflow-y-auto`}
      trigger={(open, toggle) => (
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className={`inline-flex h-7 max-w-[220px] items-center gap-1 rounded-md border pl-2.5 pr-1.5 text-[12px] transition-colors ${
            active ? 'border-tt/60 bg-tt-light text-tt' : 'border-line bg-white text-ink-2 hover:bg-hover'
          }`}
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={12} className={active ? 'text-tt' : 'text-ink-3'} />
        </button>
      )}
    >
      {children}
    </Popover>
  );
}

function OptionRow({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover ${checked ? 'text-tt' : 'text-ink'}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      {checked && <Check size={14} className="shrink-0" />}
    </button>
  );
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((part, index) => part.hit
        ? <mark key={index} className="rounded-[2px] bg-tt-light px-px text-tt">{part.text}</mark>
        : <span key={index}>{part.text}</span>)}
    </>
  );
}

/** "Work", or "Work +2" when several values are picked. */
function chipLabel(base: string, names: string[]): string {
  if (!names.length) return base;
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}

/** TickTick-style search across every task, with filters that save as a smart list. */
export default function SearchPage() {
  const t = useT();
  const f = useTF();
  const navigate = useNavigate();
  const { tasks, completed, abandoned, projects, tags, addFilter, showToast } = useStore();
  const [query, setQuery] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [dateMode, setDateMode] = useState<FilterDateMode>('any');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [priorities, setPriorities] = useState<number[]>([]);
  const [kinds, setKinds] = useState<FilterKind[]>([]);
  const [statuses, setStatuses] = useState<number[]>([]);
  const [recent, setRecent] = useState<string[]>(readRecentSearches);
  const [saveOpen, setSaveOpen] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const today = todayStr();

  // Typing stays responsive with thousands of tasks: results trail the input.
  const deferredQuery = useDeferredValue(query);
  const terms = useMemo(() => searchTerms(deferredQuery), [deferredQuery]);
  const conditions: FilterConditions = useMemo(() => ({
    logic: 'and',
    dateMode,
    dateStart: dateMode === 'custom' ? dateStart || null : null,
    dateEnd: dateMode === 'custom' ? dateEnd || null : null,
    projectIds,
    tags: tagNames,
    priorities,
    statuses,
    keywords: '',
    kinds,
  }), [dateMode, dateStart, dateEnd, projectIds, tagNames, priorities, statuses, kinds]);
  const conditionCount = projectIds.length + tagNames.length + priorities.length + statuses.length + kinds.length + Number(dateMode !== 'any');
  const searching = terms.length > 0 || conditionCount > 0;

  const results = useMemo(() => {
    if (!searching) return [] as Result[];
    const out: Result[] = [];
    for (const task of [...tasks, ...completed, ...abandoned]) {
      const match = matchTask(task, terms);
      if (match && matchesSavedFilter(task, conditions, today)) out.push({ task, match });
    }
    return out.sort(compareResults);
  }, [searching, tasks, completed, abandoned, terms, conditions, today]);
  const openResults = results.filter((result) => result.task.status === 0);
  const doneResults = results.filter((result) => result.task.status !== 0);

  const remember = (value = query) => {
    const next = rememberSearch(recent, value);
    if (next === recent) return;
    setRecent(next);
    persistRecentSearches(next);
  };

  const clearConditions = () => {
    setProjectIds([]);
    setTagNames([]);
    setDateMode('any');
    setDateStart('');
    setDateEnd('');
    setPriorities([]);
    setKinds([]);
    setStatuses([]);
  };

  const saveFilter = async () => {
    const name = filterName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await addFilter({ name, ...conditions, keywords: query.trim() });
      remember();
      setSaveOpen(false);
      setFilterName('');
      showToast({ messageKey: 'searchFilterSaved' });
    } finally {
      setSaving(false);
    }
  };

  const projectName = (project: Project | undefined, id: string) =>
    projectDisplayName(project, t, id === INBOX_ID ? t('smartInbox') : id);
  const projectNames = projectIds.map((id) => projectName(projects.find((project) => project.id === id), id));
  const tagLabels = tagNames.map((name) => `#${tags.find((tag) => tag.name === name)?.label ?? name}`);
  const dateLabel = dateMode === 'custom' && (dateStart || dateEnd)
    ? `${dateStart || '…'} ~ ${dateEnd || '…'}`
    : t(DATE_LABEL_KEYS[dateMode]);

  const renderResult = ({ task, match }: Result) => (
    <TaskRow
      key={task.id}
      task={task}
      showProject
      showDetails
      highlight={terms}
      snippet={match.snippet && (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
          <span className="shrink-0 rounded bg-hover px-1 text-[11px]">{t(match.snippet.field === 'item' ? 'searchInSubtask' : 'searchInDescription')}</span>
          <span className="truncate"><Highlighted text={match.snippet.text} terms={terms} /></span>
        </div>
      )}
    />
  );

  const summary = [
    query.trim() && `"${query.trim()}"`,
    projectNames.length > 0 && `${t('filterList')}: ${projectNames.join(', ')}`,
    tagLabels.length > 0 && `${t('filterTag')}: ${tagLabels.join(', ')}`,
    dateMode !== 'any' && `${t('filterDate')}: ${dateLabel}`,
    priorities.length > 0 && `${t('filterPriority')}: ${priorities.map(priorityLabel).join(', ')}`,
    kinds.length > 0 && `${t('filterKind')}: ${kinds.map((kind) => t(KIND_LABEL_KEYS[kind])).join(', ')}`,
    statuses.length > 0 && `${t('filterStatus')}: ${statuses.map((status) => t(STATUS_LABEL_KEYS[status as 0 | 2 | -1])).join(', ')}`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-[54px] shrink-0 items-center gap-2 px-5">
        <button type="button" title={t('close')} aria-label={t('close')} onClick={() => navigate('/app/tasks/all')} className="text-ink-2 hover:text-ink"><X size={20} /></button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Search size={18} className="shrink-0 text-ink-3" />
          <input
            ref={inputRef}
            data-search-input
            autoFocus
            value={query}
            maxLength={200}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchTitle')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (isSubmitEnter(event)) remember();
              if (event.key === 'Escape' && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery('');
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
          />
          {query && (
            <button type="button" title={t('searchClear')} aria-label={t('searchClear')} onClick={() => { setQuery(''); inputRef.current?.focus(); }} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink">
              <X size={15} />
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={!searching}
          title={searching ? undefined : t('searchNoConditions')}
          onClick={() => setSaveOpen(true)}
          className="h-[30px] shrink-0 rounded-lg border border-line px-3 text-[13px] text-tt hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent"
        >
          {t('searchSaveFilter')}
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pb-2.5">
        <FilterChip label={chipLabel(t('filterAnyList'), projectNames)} active={projectIds.length > 0} wide>
          {() => (
            <>
              <OptionRow checked={projectIds.length === 0} onClick={() => setProjectIds([])}>{t('filterAnyList')}</OptionRow>
              <div className="my-1 border-t border-line" />
              {projects.filter((project) => !project.closed).map((project) => (
                <OptionRow key={project.id} checked={projectIds.includes(project.id)} onClick={() => setProjectIds((ids) => toggled(ids, project.id))}>
                  <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: project.color ?? '#4772FA' }} />
                  <span className="truncate">{projectName(project, project.id)}</span>
                </OptionRow>
              ))}
            </>
          )}
        </FilterChip>
        <FilterChip label={chipLabel(t('filterAnyTag'), tagLabels)} active={tagNames.length > 0}>
          {() => (
            <>
              <OptionRow checked={tagNames.length === 0} onClick={() => setTagNames([])}>{t('filterAnyTag')}</OptionRow>
              <div className="my-1 border-t border-line" />
              {tags.length === 0 && <div className="px-3 py-1.5 text-[12px] text-ink-3">{t('noTags')}</div>}
              {tags.map((tag) => (
                <OptionRow key={tag.name} checked={tagNames.includes(tag.name)} onClick={() => setTagNames((names) => toggled(names, tag.name))}>
                  <span className="truncate">#{tag.label}</span>
                </OptionRow>
              ))}
            </>
          )}
        </FilterChip>
        <FilterChip label={dateMode === 'any' ? t('filterDate') : dateLabel} active={dateMode !== 'any'} wide>
          {(close) => (
            <>
              {DATE_OPTIONS.map((mode) => (
                <OptionRow key={mode} checked={dateMode === mode} onClick={() => { setDateMode(mode); if (mode !== 'custom') close(); }}>
                  {t(DATE_LABEL_KEYS[mode])}
                </OptionRow>
              ))}
              {dateMode === 'custom' && (
                <div className="grid grid-cols-2 gap-2 px-3 pb-2 pt-1">
                  <input type="date" value={dateStart} max={dateEnd || undefined} onChange={(event) => setDateStart(event.target.value)} aria-label={t('filterStart')} className="min-w-0 rounded-md border border-line bg-white px-1.5 py-1 text-[12px]" />
                  <input type="date" value={dateEnd} min={dateStart || undefined} onChange={(event) => setDateEnd(event.target.value)} aria-label={t('filterEnd')} className="min-w-0 rounded-md border border-line bg-white px-1.5 py-1 text-[12px]" />
                </div>
              )}
            </>
          )}
        </FilterChip>
        <FilterChip label={chipLabel(t('filterAnyPriority'), priorities.map(priorityLabel))} active={priorities.length > 0}>
          {() => (
            <>
              <OptionRow checked={priorities.length === 0} onClick={() => setPriorities([])}>{t('filterAnyPriority')}</OptionRow>
              <div className="my-1 border-t border-line" />
              {PRIORITY_LEVELS.map((value) => (
                <OptionRow key={value} checked={priorities.includes(value)} onClick={() => setPriorities((values) => toggled(values, value))}>
                  <Flag size={13} style={{ color: PRIORITY_COLORS[value] }} />
                  {priorityLabel(value)}
                </OptionRow>
              ))}
            </>
          )}
        </FilterChip>
        <FilterChip label={chipLabel(t('filterAnyKind'), kinds.map((kind) => t(KIND_LABEL_KEYS[kind])))} active={kinds.length > 0}>
          {() => (
            <>
              <OptionRow checked={kinds.length === 0} onClick={() => setKinds([])}>{t('filterAnyKind')}</OptionRow>
              <div className="my-1 border-t border-line" />
              {KIND_OPTIONS.map((kind) => (
                <OptionRow key={kind} checked={kinds.includes(kind)} onClick={() => setKinds((values) => toggled(values, kind))}>
                  {t(KIND_LABEL_KEYS[kind])}
                </OptionRow>
              ))}
            </>
          )}
        </FilterChip>
        <FilterChip label={chipLabel(t('filterAnyStatus'), statuses.map((status) => t(STATUS_LABEL_KEYS[status as 0 | 2 | -1])))} active={statuses.length > 0}>
          {() => (
            <>
              <OptionRow checked={statuses.length === 0} onClick={() => setStatuses([])}>{t('filterAnyStatus')}</OptionRow>
              <div className="my-1 border-t border-line" />
              {STATUS_OPTIONS.map((status) => (
                <OptionRow key={status} checked={statuses.includes(status)} onClick={() => setStatuses((values) => toggled(values, status))}>
                  {t(STATUS_LABEL_KEYS[status])}
                </OptionRow>
              ))}
            </>
          )}
        </FilterChip>
        {conditionCount > 0 && (
          <button type="button" onClick={clearConditions} className="h-7 rounded-md px-2 text-[12px] text-ink-3 hover:bg-hover hover:text-ink">
            {t('clearFilters')}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line pb-12" onClickCapture={() => remember()}>
        {!searching ? (
          <div className="px-5 pt-5">
            {recent.length > 0 && (
              <section className="mb-6">
                <div className="mb-2 flex items-center">
                  <h2 className="text-[12px] font-semibold text-ink-3">{t('searchRecent')}</h2>
                  <button type="button" onClick={() => { setRecent([]); persistRecentSearches([]); }} className="ml-auto text-[12px] text-ink-3 hover:text-tt">{t('searchClearRecent')}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((item) => (
                    <span key={item} className="group inline-flex h-7 items-center gap-1 rounded-full bg-hover pl-3 pr-1 text-[13px] text-ink-2">
                      <button type="button" onClick={() => { setQuery(item); inputRef.current?.focus(); }} className="inline-flex items-center gap-1.5 hover:text-tt">
                        <Clock size={12} className="text-ink-3" />{item}
                      </button>
                      <button
                        type="button"
                        title={t('searchRemoveRecent')}
                        aria-label={t('searchRemoveRecent')}
                        onClick={(event) => { event.stopPropagation(); const next = recent.filter((value) => value !== item); setRecent(next); persistRecentSearches(next); }}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-ink-3 opacity-60 hover:bg-white hover:text-ink group-hover:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            )}
            <div className="flex flex-col items-center pt-10 text-center">
              <Search size={36} strokeWidth={1.4} className="text-line" />
              <p className="mt-3 max-w-[440px] text-[13px] leading-5 text-ink-3">{t('searchHint')}</p>
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center pt-16 text-center">
            <p className="text-[13px] text-ink-3">{t('searchEmpty')}</p>
            {conditionCount > 0 && (
              <button type="button" onClick={clearConditions} className="mt-3 rounded-md border border-line px-3 py-1 text-[12px] text-tt hover:bg-hover">{t('clearFilters')}</button>
            )}
          </div>
        ) : (
          <>
            <div className="px-5 pb-1 pt-2.5 text-[12px] text-ink-3">{f('searchResults', results.length)}</div>
            {openResults.map(renderResult)}
            {doneResults.length > 0 && (
              <>
                <div className="px-5 pb-1 pt-4 text-[12px] font-semibold text-ink-3">
                  {t('filterCompleted')} · {t('filterAbandoned')} <span className="font-normal">{doneResults.length}</span>
                </div>
                {doneResults.map(renderResult)}
              </>
            )}
          </>
        )}
      </div>

      {saveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={() => setSaveOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="save-filter-title" className="w-[440px] max-w-full rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex h-14 items-center border-b border-line px-5">
              <h2 id="save-filter-title" className="text-[17px] font-semibold">{t('searchSaveFilter')}</h2>
              <button type="button" title={t('close')} aria-label={t('close')} onClick={() => setSaveOpen(false)} className="ml-auto text-ink-3"><X size={18} /></button>
            </div>
            <div className="p-5">
              <input
                autoFocus
                value={filterName}
                maxLength={128}
                onChange={(event) => setFilterName(event.target.value)}
                onKeyDown={(event) => {
                  if (isSubmitEnter(event)) void saveFilter();
                  if (event.key === 'Escape') setSaveOpen(false);
                }}
                placeholder={t('filterNamePh')}
                className="h-9 w-full rounded-md border border-tt px-3 text-[14px] outline-none"
              />
              {summary.length > 0 && (
                <div className="mt-3 rounded-lg bg-hover px-3 py-2">
                  <div className="mb-1 text-[11px] font-semibold text-ink-3">{t('searchConditions')}</div>
                  <ul className="space-y-0.5 text-[12px] text-ink-2">
                    {summary.map((line) => <li key={line} className="truncate">{line}</li>)}
                  </ul>
                </div>
              )}
              <p className="mt-2 text-[12px] text-ink-3">{t('searchFilterKeywordHint')}</p>
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
