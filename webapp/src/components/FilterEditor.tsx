import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Project, Tag, TaskFilter, FilterDateMode } from '../lib/types';
import { useT, type Key } from '../i18n';
import { projectDisplayName } from '../lib/project';
import { isSubmitEnter } from '../lib/keys';
import { PRIORITY_LEVELS, priorityLabel } from './RoundCheck';

type FilterInput = Omit<TaskFilter, 'id' | 'sortOrder' | 'createdTime' | 'modifiedTime'> & { sortOrder?: number };

const DATE_OPTIONS: FilterDateMode[] = ['any', 'today', 'tomorrow', 'week', 'overdue', 'custom'];
const DATE_LABEL_KEYS: Record<FilterDateMode, Key> = {
  any: 'filterDate_any',
  today: 'filterDate_today',
  tomorrow: 'filterDate_tomorrow',
  week: 'filterDate_week',
  overdue: 'filterDate_overdue',
  custom: 'filterDate_custom',
};

export default function FilterEditor({
  projects,
  tags,
  initialFilter,
  onSave,
  onClose,
}: {
  projects: Project[];
  tags: Tag[];
  initialFilter?: TaskFilter;
  onSave: (input: FilterInput) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [advanced, setAdvanced] = useState(false);
  const [name, setName] = useState(initialFilter?.name ?? '');
  const [logic, setLogic] = useState<'and' | 'or'>(initialFilter?.logic ?? 'and');
  const [dateMode, setDateMode] = useState<FilterDateMode>(initialFilter?.dateMode ?? 'any');
  const [dateStart, setDateStart] = useState(initialFilter?.dateStart ?? '');
  const [dateEnd, setDateEnd] = useState(initialFilter?.dateEnd ?? '');
  const [projectIds, setProjectIds] = useState<string[]>(initialFilter?.projectIds ?? []);
  const [tagsSelected, setTagsSelected] = useState<string[]>(initialFilter?.tags ?? []);
  const [priorities, setPriorities] = useState<number[]>(initialFilter?.priorities ?? []);
  const [statuses, setStatuses] = useState<number[]>(initialFilter?.statuses ?? []);
  const [saving, setSaving] = useState(false);

  const toggle = <T,>(value: T, values: T[], setValues: (next: T[]) => void) => {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave({
        name: trimmed,
        logic,
        dateMode,
        dateStart: dateStart || null,
        dateEnd: dateEnd || null,
        projectIds,
        tags: tagsSelected,
        priorities,
        statuses,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('addFilter')}
        className="max-h-[min(760px,calc(100vh-32px))] w-full max-w-[520px] overflow-y-auto rounded-xl border border-line bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[17px] font-semibold">{t(initialFilter ? 'editFilter' : 'addFilter')}</h2>
          <button type="button" onClick={onClose} title={t('close')} className="rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={17} />
          </button>
        </div>

        <div className="px-5 pb-5 pt-4">
          <div className="mb-3 flex items-center justify-center gap-1 rounded-full bg-hover p-0.5 text-[12px]">
            <button type="button" onClick={() => setAdvanced(false)} className={`flex-1 rounded-full px-3 py-1.5 ${!advanced ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-3'}`}>{t('filterNormal')}</button>
            <button type="button" onClick={() => setAdvanced(true)} className={`flex-1 rounded-full px-3 py-1.5 ${advanced ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-3'}`}>{t('filterAdvanced')}</button>
          </div>

          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => isSubmitEnter(e) && void submit()}
            placeholder={t('filterNamePh')}
            className="w-full rounded-md border border-tt px-3 py-2 text-[14px] shadow-[0_0_0_2px_rgba(71,114,250,0.08)] placeholder:text-ink-3"
          />

          {advanced && (
            <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-2">
              <span>{t('filterMatch')}</span>
              <button type="button" onClick={() => setLogic('and')} className={`rounded-md border px-2.5 py-1 ${logic === 'and' ? 'border-tt bg-tt-light text-tt' : 'border-line'}`}>{t('filterAll')}</button>
              <button type="button" onClick={() => setLogic('or')} className={`rounded-md border px-2.5 py-1 ${logic === 'or' ? 'border-tt bg-tt-light text-tt' : 'border-line'}`}>{t('filterAny')}</button>
            </div>
          )}

          <FilterField label={t('filterDate')}>
            <div className="flex flex-wrap gap-1.5">
              {DATE_OPTIONS.map((value) => (
                <Chip
                  key={value}
                  active={dateMode === value}
                  label={t(DATE_LABEL_KEYS[value])}
                  onClick={() => setDateMode(value)}
                />
              ))}
            </div>
            {dateMode === 'custom' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="rounded-md border border-line px-2 py-1.5 text-[12px]" aria-label={t('filterStart')} />
                <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="rounded-md border border-line px-2 py-1.5 text-[12px]" aria-label={t('filterEnd')} />
              </div>
            )}
          </FilterField>

          <FilterField label={t('filterList')}>
            <div className="flex flex-wrap gap-1.5">
              {projects.map((project) => (
                <Chip
                  key={project.id}
                  active={projectIds.includes(project.id)}
                  label={projectDisplayName(project, t)}
                  onClick={() => toggle(project.id, projectIds, setProjectIds)}
                />
              ))}
            </div>
          </FilterField>

          <FilterField label={t('filterPriority')}>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITY_LEVELS.map((value) => (
                <Chip key={value} active={priorities.includes(value)} label={priorityLabel(value)} onClick={() => toggle(value, priorities, setPriorities)} />
              ))}
            </div>
          </FilterField>

          <FilterField label={t('filterTag')}>
            <div className="flex flex-wrap gap-1.5">
              {tags.length === 0 ? <span className="text-[12px] text-ink-3">{t('noTags')}</span> : tags.map((tag) => (
                <Chip key={tag.name} active={tagsSelected.includes(tag.name)} label={`#${tag.label}`} onClick={() => toggle(tag.name, tagsSelected, setTagsSelected)} />
              ))}
            </div>
          </FilterField>

          <FilterField label={t('filterStatus')}>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={statuses.length === 0} label={t('filterAnyStatus')} onClick={() => setStatuses([])} />
              <Chip active={statuses.includes(0)} label={t('filterIncomplete')} onClick={() => toggle(0, statuses, setStatuses)} />
              <Chip active={statuses.includes(2)} label={t('filterCompleted')} onClick={() => toggle(2, statuses, setStatuses)} />
            </div>
          </FilterField>

          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-line px-4 py-2 text-[13px] text-ink-2 hover:bg-hover">{t('cancel')}</button>
            <button type="button" disabled={!name.trim() || saving} onClick={() => void submit()} className="rounded-md bg-tt px-5 py-2 text-[13px] font-medium text-white hover:bg-tt-hover disabled:cursor-not-allowed disabled:opacity-50">{t('save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      {children}
    </div>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${active ? 'border-tt bg-tt-light text-tt' : 'border-line text-ink-2 hover:border-tt/50 hover:text-tt'}`}>
      {label}
    </button>
  );
}
