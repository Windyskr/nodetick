import { useState, type ReactNode } from 'react';
import { List, Columns3, CalendarClock, X } from 'lucide-react';
import type { Project } from '../../lib/types';
import { useStore } from '../../stores/store';
import { useT, useTF } from '../../i18n';

/** TickTick list palette for project colors. */
const LIST_COLORS = [
  '#4772FA', '#55B1E5', '#6AD2CA', '#A9D27F', '#F7CE50',
  '#F3AE4E', '#F18181', '#F15BB5', '#8C57F1', '#758AA5',
];

/** Emoji set offered as list icons (prepended to the list name). */
const LIST_EMOJIS = ['', '📌', '🏠', '💼', '🎯', '📚', '🛒', '💪', '✈️', '🎵', '💡'];

const EMOJI_RE = /^\p{Extended_Pictographic}/u;

function setNameEmoji(current: string, emoji: string): string {
  const bare = EMOJI_RE.exec(current) ? current.slice(1).trim() : current;
  return emoji ? `${emoji} ${bare}` : bare;
}

/**
 * TickTick-style list settings: rename, icon, color, default view, group, and
 * destructive delete. Changes apply immediately (live), like the official app.
 */
export default function ProjectSettingsDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { groups, updateProject, addGroup, deleteGroup, deleteProject } = useStore();
  const t = useT();
  const f = useTF();
  const [name, setName] = useState(project.name);
  const [newGroupName, setNewGroupName] = useState('');

  const commitName = () => {
    const next = name.trim();
    if (next && next !== project.name) void updateProject(project.id, { name: next });
    else setName(project.name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('listSettings')}
        className="w-full max-w-sm rounded-xl border border-line bg-white p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{t('listSettings')}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-ink-3 hover:bg-hover hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <label className="block text-[12px] font-medium text-ink-2">
          {t('listName')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && commitName()}
            className="mt-1 w-full rounded-md border border-line px-2.5 py-2 text-[14px] focus:border-tt"
          />
        </label>

        <div className="mt-3 text-[12px] font-medium text-ink-2">{t('listIcon')}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {LIST_EMOJIS.map((emoji) => {
            const currentEmoji = EMOJI_RE.exec(project.name)?.[0] ?? '';
            const active = emoji === currentEmoji;
            return (
              <button
                key={emoji || 'none'}
                type="button"
                aria-label={emoji || 'no icon'}
                onClick={() => {
                  const next = setNameEmoji(project.name, emoji);
                  setName(next);
                  void updateProject(project.id, { name: next });
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-md text-[15px] ${active ? 'bg-tt-light' : 'hover:bg-hover'}`}
              >
                {emoji || <X size={13} className="text-ink-3" />}
              </button>
            );
          })}
        </div>

        <div className="mt-3 text-[12px] font-medium text-ink-2">{t('listColor')}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {LIST_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`color ${color}`}
              onClick={() => void updateProject(project.id, { color })}
              className={`h-6 w-6 rounded-full border-2 ${project.color === color ? 'border-ink' : 'border-transparent'}`}
              style={{ background: color }}
            />
          ))}
        </div>

        <div className="mt-3 text-[12px] font-medium text-ink-2">{t('viewOptions')}</div>
        <div className="mt-1 grid grid-cols-3 gap-1">
          {([
            ['list', t('viewList'), <List size={19} key="l" />],
            ['kanban', t('viewKanban'), <Columns3 size={19} key="k" />],
            ['timeline', t('viewTimeline'), <CalendarClock size={19} key="t" />],
          ] as [string, string, ReactNode][]).map(([mode, label, icon]) => (
            <button
              key={mode}
              type="button"
              onClick={() => void updateProject(project.id, { viewMode: mode })}
              className={`flex flex-col items-center gap-0.5 rounded-md py-2 text-[11px] ${
                project.viewMode === mode ? 'bg-tt-light text-tt' : 'text-ink-2 hover:bg-hover'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 text-[12px] font-medium text-ink-2">{t('moveToGroup')}</div>
        <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto rounded-md bg-hover p-1">
          <button
            type="button"
            onClick={() => void updateProject(project.id, { groupId: null })}
            className={`w-full rounded px-2.5 py-1.5 text-left text-[13px] ${!project.groupId ? 'bg-white text-tt' : 'text-ink-2 hover:bg-white'}`}
          >
            {t('noGroup')}
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => void updateProject(project.id, { groupId: g.id })}
              className={`w-full rounded px-2.5 py-1.5 text-left text-[13px] ${project.groupId === g.id ? 'bg-white text-tt' : 'text-ink-2 hover:bg-white'}`}
            >
              {g.name}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={newGroupName}
            placeholder={t('groupName')}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const name = newGroupName.trim();
              if (name) {
                void addGroup(name);
                setNewGroupName('');
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-line px-2.5 py-1.5 text-[13px] focus:border-tt"
          />
          <button
            type="button"
            onClick={() => {
              const name = newGroupName.trim();
              if (name) {
                void addGroup(name);
                setNewGroupName('');
              }
            }}
            className="rounded-md border border-line px-3 text-[13px] text-ink-2 hover:bg-hover"
          >
            {t('addGroup')}
          </button>
        </div>
        {project.groupId && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('deleteGroupConfirm'))) void deleteGroup(project.groupId!);
            }}
            className="mt-1.5 text-[12px] text-ink-3 hover:text-p-high"
          >
            {t('deleteGroup')}: {groups.find((g) => g.id === project.groupId)?.name}
          </button>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          {project.id !== 'inbox' ? (
            <button
              type="button"
              className="text-[13px] text-p-high hover:underline"
              onClick={() => {
                if (window.confirm(f('deleteListConfirm', project.name))) {
                  void deleteProject(project.id);
                  onClose();
                }
              }}
            >
              {t('deleteList')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-tt px-4 py-2 text-[13px] font-medium text-white hover:bg-tt/90"
          >
            {t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
