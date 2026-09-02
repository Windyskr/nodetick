import type { Key } from '../i18n';
import type { Project } from './types';

/** Stable identifiers for projects owned by the application rather than the user. */
export const INBOX_ID = 'inbox';

/** System project labels are translated at the display boundary, never persisted. */
const SYSTEM_PROJECT_LABELS: Record<string, Key> = {
  [INBOX_ID]: 'smartInbox',
};

type ProjectLike = Pick<Project, 'id' | 'name'> | null | undefined;
type Translate = (key: Key) => string;

/** Return the user-visible name while preserving ordinary user-created project names. */
export function projectDisplayName(project: ProjectLike, t: Translate, fallback = ''): string {
  if (!project) return fallback;
  const labelKey = SYSTEM_PROJECT_LABELS[project.id];
  return labelKey ? t(labelKey) : project.name;
}
