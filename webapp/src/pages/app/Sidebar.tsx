import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Pencil,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useStore, INBOX_ID } from '../../stores/store';
import { MenuItem, Popover } from '../../components/Popover';
import { useT } from '../../i18n';
import { addDays, todayStr } from '../../lib/date';
import {
  IconAll,
  IconCompleted,
  IconInbox,
  IconNext7,
  IconOverdue,
  IconSummary,
  IconTag,
  IconToday,
  IconTomorrow,
  IconTrash,
  IconWontDo,
} from '../../components/tickIcons';
import { IconFunnel } from '../../components/icons';
import FilterEditor from '../../components/FilterEditor';
import ProjectSettingsDialog from './ProjectSettingsDialog';
import type { Project } from '../../lib/types';

const EMOJI_RE = /^\p{Extended_Pictographic}/u;

function isEmoji(name: string): string | null {
  const m = EMOJI_RE.exec(name);
  return m ? m[0] : null;
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    projects,
    groups,
    tasks,
    tags,
    filters,
    trash,
    addProject,
    renameProject,
    deleteProject,
    addGroup,
    deleteGroup,
    addFilter,
    updateFilter,
    deleteFilter,
    updateTag,
    deleteTag,
    updateGroup,
    features,
    abandoned,
  } =
    useStore();

  const [settingsProject, setSettingsProject] = useState<Project | null>(null);

  const [addingList, setAddingList] = useState(false);
  const t = useT();
  const [newListName, setNewListName] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [collapsedLists, setCollapsedLists] = useState(false);
  const [collapsedTags, setCollapsedTags] = useState(false);
  const [collapsedFilters, setCollapsedFilters] = useState(false);
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<(typeof filters)[number] | undefined>();

  const counts = useMemo(() => {
    const byProject: Record<string, number> = {};
    let dueToday = 0;
    let dueTomorrow = 0;
    let overdue = 0;
    let all = 0;
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    const horizon = addDays(today, 7);
    for (const t of tasks) {
      if (t.parentId) continue;
      all++;
      byProject[t.projectId] = (byProject[t.projectId] ?? 0) + 1;
      const day = t.dueDate?.slice(0, 10);
      if (day && day < today) overdue++;
      if (day && day <= today) dueToday++;
      if (day === tomorrow) dueTomorrow++;
    }
    const next7 = tasks.filter((t) => {
      const day = t.dueDate?.slice(0, 10);
      return day && day >= today && day <= horizon;
    }).length;
    return { byProject, today: dueToday, tomorrow: dueTomorrow, next7, all, overdue };
  }, [tasks]);

  const scopeActive = (prefix: string) => location.pathname.startsWith(`/app/tasks/${prefix}`);

  const itemClass = (active: boolean) =>
    `group mx-[10px] flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-[14px] transition-colors ${
      active ? 'bg-selected font-medium text-ink' : 'text-ink-2 hover:bg-hover'
    }`;

  const submitNewList = async () => {
    const name = newListName.trim();
    if (name) await addProject(name);
    setNewListName('');
    setAddingList(false);
  };

  const grouped = useMemo(() => {
    const inGroup = new Map<string, typeof projects>();
    const free: typeof projects = [];
    for (const p of projects) {
      if (p.id === INBOX_ID) continue;
      if (p.groupId) {
        const list = inGroup.get(p.groupId) ?? [];
        list.push(p);
        inGroup.set(p.groupId, list);
      } else {
        free.push(p);
      }
    }
    return { inGroup, free };
  }, [projects]);

  return (
    <>
      <aside className="flex h-full w-[240px] shrink-0 flex-col overflow-y-auto bg-[#fbfbfb] pb-2">
      {/* Smart lists */}
      <div className="space-y-0.5 pt-[14px]">
        <Link to="/app/tasks/all" className={itemClass(scopeActive('all'))}>
          <IconAll size={17} className="shrink-0 text-ink-3" />
          <span className="flex-1 truncate">{t('smartAll')}</span>
          <span className="text-[12px] text-ink-3">{counts.all}</span>
        </Link>
        <Link to="/app/tasks/today" className={itemClass(scopeActive('today'))}>
          <IconToday size={17} className="shrink-0 text-ink-3" />
          <span className="flex-1 truncate">{t('smartToday')}</span>
          <span className="text-[12px] text-ink-3">{counts.today}</span>
        </Link>
        <Link to="/app/tasks/tomorrow" className={itemClass(scopeActive('tomorrow'))}>
          <IconTomorrow size={17} className="shrink-0 text-ink-3" />
          <span className="flex-1 truncate">{t('smartTomorrow')}</span>
          <span className="text-[12px] text-ink-3">{counts.tomorrow > 0 ? counts.tomorrow : ''}</span>
        </Link>
        <Link to="/app/tasks/next7" className={itemClass(scopeActive('next7'))}>
          <IconNext7 size={17} className="shrink-0 text-ink-3" />
          <span className="flex-1 truncate">{t('smartNext7')}</span>
        </Link>
        <Link to="/app/tasks/overdue" className={itemClass(scopeActive('overdue'))}>
          <IconOverdue size={17} className={`shrink-0 ${counts.overdue > 0 ? 'text-p-high' : 'text-ink-3'}`} />
          <span className="flex-1 truncate">{t('smartOverdue')}</span>
          <span className={`text-[12px] ${counts.overdue > 0 ? 'text-p-high' : 'text-ink-3'}`}>{counts.overdue > 0 ? counts.overdue : ''}</span>
        </Link>
  <Link to="/app/tasks/inbox" className={itemClass(scopeActive('inbox'))}>
          <IconInbox size={17} className="shrink-0 text-ink-3" />
          <span className="flex-1 truncate">{t('smartInbox')}</span>
          <span className="text-[12px] text-ink-3">{counts.byProject['inbox'] ?? 0}</span>
        </Link>
        {features.summary && (
          <Link to="/app/summary" className={itemClass(location.pathname === '/app/summary')}>
            <IconSummary size={17} className="shrink-0 text-ink-3" />
            <span className="flex-1 truncate">{t('summary')}</span>
          </Link>
        )}
      </div>

      {/* Lists */}
      <div className="mt-5">
        <div className="mx-3 flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3 hover:text-ink-2"
            onClick={() => setCollapsedLists((v) => !v)}
          >
            {collapsedLists ? <ChevronRight size={12} /> : <ChevronDown size={12} />} {t('sectionLists')}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title={t('addGroup')}
              className="text-ink-3 hover:text-ink"
              onClick={() => {
                const name = window.prompt(t('groupName'));
                if (name?.trim()) void addGroup(name.trim());
              }}
            >
              <FolderPlus size={15} />
            </button>
            <button
              type="button"
              title={t('addList')}
              className="text-ink-3 hover:text-ink"
              onClick={() => setAddingList(true)}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        {!collapsedLists && (
          <div className="mt-1">
            {addingList && (
              <div className="mx-2 mb-1">
                <input
                  autoFocus
                  value={newListName}
                  placeholder={t('listName')}
                  onChange={(e) => setNewListName(e.target.value)}
                  onBlur={submitNewList}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitNewList();
                    if (e.key === 'Escape') {
                      setNewListName('');
                      setAddingList(false);
                    }
                  }}
                  className="w-full rounded-md border border-tt px-2.5 py-[6px] text-[14px]"
                />
              </div>
            )}
            {groups.map((g) => {
              const items = grouped.inGroup.get(g.id) ?? [];
              const open = openGroups[g.id] ?? true;
              return (
                <div key={g.id}>
                  <div className="group mx-2 flex items-center gap-1.5 rounded-md px-2.5 py-[7px] text-ink-2 hover:bg-hover">
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-1.5 text-left"
                      onClick={() => setOpenGroups((s) => ({ ...s, [g.id]: !open }))}
                    >
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="truncate text-[14px] font-medium">{g.name}</span>
                    </button>
                    <Popover
                      align="right"
                      trigger={(_o, toggle) => (
                        <button type="button" onClick={toggle} className="text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100">
                          <MoreHorizontal size={15} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem
                            label={t('rename')}
                            icon={<Pencil size={13} />}
                            onClick={() => {
                              close();
                              const name = window.prompt(t('groupName'), g.name);
                              if (name?.trim() && name.trim() !== g.name) void updateGroup(g.id, { name: name.trim() });
                            }}
                          />
                          <MenuItem
                            label={t('deleteGroup')}
                            danger
                            onClick={() => {
                              close();
                              if (window.confirm(t('deleteGroupConfirm'))) void deleteGroup(g.id);
                            }}
                          />
                        </>
                      )}
                    </Popover>
                  </div>
                  {open &&
                    items.map((p) => (
                      <ProjectItem
                        key={p.id}
                        id={p.id}
                        name={p.name}
                        color={p.color}
                        count={counts.byProject[p.id] ?? 0}
                        active={location.pathname === `/app/tasks/project-${p.id}`}
                        onNavigate={() => navigate(`/app/tasks/project-${p.id}`)}
                        onRename={(name) => void renameProject(p.id, name)}
                        onDelete={() => void deleteProject(p.id)}
                        onOpenSettings={() => setSettingsProject(p)}
                      />
                    ))}
                </div>
              );
            })}
            {grouped.free.map((p) => (
              <ProjectItem
                key={p.id}
                id={p.id}
                name={p.name}
                color={p.color}
                count={counts.byProject[p.id] ?? 0}
                active={location.pathname === `/app/tasks/project-${p.id}`}
                onNavigate={() => navigate(`/app/tasks/project-${p.id}`)}
                onRename={(name) => void renameProject(p.id, name)}
                onDelete={() => void deleteProject(p.id)}
                onOpenSettings={() => setSettingsProject(p)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Saved filters / smart lists */}
      <div className="mt-5">
        <div className="mx-3 flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3 hover:text-ink-2"
            onClick={() => setCollapsedFilters((v) => !v)}
          >
            {collapsedFilters ? <ChevronRight size={12} /> : <ChevronDown size={12} />} {t('filters')}
          </button>
          <button
            type="button"
            title={t('addFilter')}
            className="text-ink-3 hover:text-ink"
            onClick={() => {
              setEditingFilter(undefined);
              setFilterEditorOpen(true);
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        {!collapsedFilters && (
          <div className="mt-1">
            {filters.length === 0 && (
              <div className="mx-6 mt-1 rounded-md bg-hover px-3 py-2 text-[12px] leading-snug text-ink-3">
                {t('filtersEmpty')}
              </div>
            )}
            {filters.map((filter) => (
              <div
                key={filter.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/app/tasks/filter-${filter.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/tasks/filter-${filter.id}`)}
                className={`group mx-2 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[14px] transition-colors ${
                  location.pathname === `/app/tasks/filter-${filter.id}` ? 'bg-selected font-medium text-ink' : 'text-ink-2 hover:bg-hover'
                }`}
              >
                <IconFunnel size={16} className="shrink-0 text-ink-3" />
                <span className="flex-1 truncate">{filter.name}</span>
                <button
                  type="button"
                  title={t('editFilter')}
                  className="text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingFilter(filter);
                    setFilterEditorOpen(true);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  title={t('deleteFilter')}
                  className="text-ink-3 opacity-0 transition-opacity hover:text-p-high group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(t('deleteFilterConfirm'))) void deleteFilter(filter.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="mt-5">
        <button
          type="button"
          className="mx-3 flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3 hover:text-ink-2"
          onClick={() => setCollapsedTags((v) => !v)}
        >
            {collapsedTags ? <ChevronRight size={12} /> : <ChevronDown size={12} />} {t('sectionTags')}
        </button>
        {!collapsedTags && (
          <div className="mt-1">
            {tags.length === 0 && (
              <div className="mx-6 mt-1 rounded-md bg-hover px-3 py-2 text-[12px] leading-snug text-ink-3">
                {t('tagsEmpty')}
              </div>
            )}
            {tags.map((t) => (
              <TagItem
                key={t.name}
                label={t.label}
                color={t.color}
                active={location.pathname === `/app/tasks/tag-${t.name}`}
                onNavigate={() => navigate(`/app/tasks/tag-${t.name}`)}
                onUpdate={(patch) => void updateTag(t.name, patch)}
                onDelete={() => void deleteTag(t.name)}
              />
            ))}          </div>
        )}
      </div>

      {/* Bottom */}
      <div className="mt-auto pt-6">
        <Link to="/app/tasks/completed" className={itemClass(scopeActive('completed'))}>
          <IconCompleted size={17} className="shrink-0 text-ink-3" />
          <span className="flex-1 truncate">{t('navCompleted')}</span>
        </Link>
        <Link to="/app/tasks/abandoned" className={itemClass(scopeActive('abandoned'))}>
          <IconWontDo size={17} className="shrink-0 text-ink-3" />
          <span className="flex-1 truncate">{t('smartAbandoned')}</span>
          <span className="text-[12px] text-ink-3">{abandoned.length > 0 ? abandoned.length : ''}</span>
        </Link>
        <Link to="/app/tasks/trash" className={itemClass(scopeActive('trash'))}>
          <IconTrash size={17} className="shrink-0 text-ink-3" />
          <span className="flex-1 truncate">{t('navTrash')}</span>
          <span className="text-[12px] text-ink-3">{trash.length}</span>
        </Link>
      </div>
      </aside>
      {filterEditorOpen && (
        <FilterEditor
          projects={projects}
          tags={tags}
          initialFilter={editingFilter}
          onSave={async (input) => {
            if (editingFilter) await updateFilter(editingFilter.id, input);
            else await addFilter(input);
          }}
          onClose={() => {
            setFilterEditorOpen(false);
            setEditingFilter(undefined);
          }}
        />
      )}
      {settingsProject && (
        <ProjectSettingsDialog
          key={settingsProject.id}
          project={settingsProject}
          onClose={() => setSettingsProject(null)}
        />
      )}
    </>
  );
}

/** TickTick tag palette used by the sidebar color picker. */
const TAG_COLORS = ['#F18181', '#F3AE4E', '#F7CE50', '#A9D27F', '#6AD2CA', '#4772FA', '#8C57F1', '#F15BB5'];

function TagItem({
  label,
  color,
  active,
  onNavigate,
  onUpdate,
  onDelete,
}: {
  label: string;
  color: string | null;
  active: boolean;
  onNavigate: () => void;
  onUpdate: (patch: { name?: string; label?: string; color?: string | null }) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  if (editing) {
    return (
      <div className="mx-2 mb-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            if (trimmed && trimmed !== label) onUpdate({ label: trimmed, name: trimmed });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(label);
              setEditing(false);
            }
          }}
          className="w-full rounded-md border border-tt px-2.5 py-[6px] text-[14px]"
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === 'Enter' && onNavigate()}
      className={`group mx-2 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[14px] transition-colors ${
        active ? 'bg-selected font-medium text-ink' : 'text-ink-2 hover:bg-hover'
      }`}
    >
      <IconTag size={17} className="shrink-0" style={{ color: color ?? '#999' }} />
      <span className="flex-1 truncate">{label}</span>
      <Popover
        align="right"
        panelClass="w-[200px]"
        trigger={(_o, toggle) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            className="text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              label={t('rename')}
              onClick={() => {
                close();
                setDraft(label);
                setEditing(true);
              }}
            />
            <div className="grid grid-cols-4 gap-1.5 px-3 py-2" onClick={(e) => e.stopPropagation()}>
              {[null, ...TAG_COLORS].map((swatch) => (
                <button
                  key={swatch ?? 'none'}
                  type="button"
                  title={swatch ?? 'none'}
                  aria-label={swatch ? `color ${swatch}` : 'no color'}
                  onClick={() => {
                    onUpdate({ color: swatch });
                    close();
                  }}
                  className={`h-5 w-5 rounded-full border ${color === swatch ? 'border-ink' : 'border-transparent'} ${swatch ? '' : 'bg-line'}`}
                  style={swatch ? { background: swatch } : undefined}
                />
              ))}
            </div>
            <MenuItem
              label={t('deleteTag')}
              danger
              icon={<Trash2 size={14} />}
              onClick={() => {
                close();
                if (window.confirm(t('deleteTagConfirm'))) onDelete();
              }}
            />
          </>
        )}
      </Popover>
    </div>
  );
}

function ProjectItem({
  id,
  name,
  color,
  count,
  active,
  onNavigate,
  onRename,
  onDelete,
  onOpenSettings,
}: {
  id: string;
  name: string;
  color: string | null;
  count: number;
  active: boolean;
  onNavigate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onOpenSettings: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();
  const emoji = isEmoji(name);
  const bareName = emoji ? name.slice(emoji.length).trim() : name;

  if (editing) {
    return (
      <div className="mx-2 mb-1">
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            if (trimmed && trimmed !== name) onRename(trimmed);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="w-full rounded-md border border-tt px-2.5 py-[6px] text-[14px]"
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === 'Enter' && onNavigate()}
      className={`group mx-2 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[14px] transition-colors ${
        active ? 'bg-selected font-medium text-ink' : 'text-ink-2 hover:bg-hover'
      }`}
    >
      <span className="flex w-[17px] shrink-0 justify-center">
        {emoji ? (
          <span className="text-[13px] leading-none">{emoji}</span>
        ) : (
          <span className="inline-block h-[10px] w-[10px] rounded-[3px]" style={{ background: color ?? '#4772FA' }} />
        )}
      </span>
      <span className="flex-1 truncate">{bareName}</span>
      <Popover
        align="right"
        trigger={(_o, toggle) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            className="text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              label={t('listSettings')}
              icon={<Settings2 size={14} />}
              onClick={() => {
                close();
                onOpenSettings();
              }}
            />
            <MenuItem
              label={t('rename')}
              onClick={() => {
                close();
                setDraft(name);
                setEditing(true);
              }}
            />
            {id !== INBOX_ID && (
              <MenuItem
                label={t('deleteList')}
                danger
                onClick={() => {
                  close();
                  onDelete();
                }}
              />
            )}
          </>
        )}
      </Popover>
      <span className="text-[12px] text-ink-3 group-hover:hidden">{count > 0 ? count : ''}</span>
    </div>
  );
}
