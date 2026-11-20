import { useState } from 'react';
import { useT } from '../../../i18n';
import { isSubmitEnter } from '../../../lib/keys';
import { INBOX_ID, projectDisplayName } from '../../../lib/project';
import type { Project } from '../../../lib/types';
import { Dialog } from './ui';

const primary = 'h-8 min-w-[88px] rounded-md bg-tt px-4 text-[13px] text-white disabled:opacity-40';
const secondary = 'h-8 min-w-[88px] rounded-md border border-line px-4 text-[13px] text-ink hover:bg-hover';

/** Save the current settings as a template, or rename one (optionally taking the current settings). */
export function TemplateDialog({ initialName, editing, onSave, onClose }: {
  initialName: string;
  editing: boolean;
  onSave: (name: string, takeCurrent: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [takeCurrent, setTakeCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length > 0 && name.trim().length <= 64;
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSave(name.trim(), !editing || takeCurrent);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t(editing ? 'summaryEditTemplateTitle' : 'summarySaveTemplateTitle')}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={secondary} onClick={onClose}>{t('cancel')}</button>
          <button type="button" className={primary} disabled={!valid || busy} onClick={() => void save()}>{t('save')}</button>
        </>
      )}
    >
      {!editing && <p className="mb-3 text-[13px] text-ink-2">{t('summaryTemplateDescription')}</p>}
      <input
        autoFocus
        value={name}
        maxLength={64}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (isSubmitEnter(event)) void save();
        }}
        placeholder={t('summaryTemplateName')}
        aria-label={t('summaryTemplateName')}
        className="h-9 w-full rounded-md border border-line px-3 text-[14px] outline-none focus:border-tt"
      />
      {editing && (
        <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={takeCurrent} onChange={(event) => setTakeCurrent(event.target.checked)} className="accent-[var(--color-tt)]" />
          {t('summaryTemplateUpdateConfig')}
        </label>
      )}
    </Dialog>
  );
}

/** Keep a copy of the summary as a note in a list. */
export function NoteDialog({ initialTitle, projects, onSave, onClose }: {
  initialTitle: string;
  projects: Project[];
  onSave: (title: string, projectId: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(initialTitle);
  const [projectId, setProjectId] = useState(INBOX_ID);
  const [busy, setBusy] = useState(false);
  const open = projects.filter((project) => !project.closed);
  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(title.trim(), projectId);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t('summaryNoteDialogTitle')}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={secondary} onClick={onClose}>{t('cancel')}</button>
          <button type="button" className={primary} disabled={!title.trim() || busy} onClick={() => void save()}>{t('save')}</button>
        </>
      )}
    >
      <p className="mb-3 text-[13px] text-ink-2">{t('summaryNoteDescription')}</p>
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (isSubmitEnter(event)) void save();
        }}
        aria-label={t('summaryTemplateName')}
        className="h-9 w-full rounded-md border border-line px-3 text-[14px] outline-none focus:border-tt"
      />
      <label className="mt-3 flex items-center gap-3 text-[13px] text-ink-2">
        <span className="shrink-0">{t('summaryList')}</span>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-white px-2 text-[13px] text-ink">
          {open.map((project) => (
            <option key={project.id} value={project.id}>{projectDisplayName(project, t)}</option>
          ))}
        </select>
      </label>
    </Dialog>
  );
}
