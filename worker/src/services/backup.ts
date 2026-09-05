import { Env } from '../env.js';

/**
 * Full-account backup: dump every user-owned row into one JSON document and
 * merge-import a previously exported document back (upserts by row id).
 * Shared by the same-origin web routes (/api/export, /api/import) and the
 * Open API backup endpoints used by the CLI.
 */

export const BACKUP_APP_ID = 'nodetick';
export const BACKUP_VERSION = 1;
export const MAX_IMPORT_ITEMS = 5000;

export type BackupDocument = Record<string, unknown>;

/** Import rejection with the HTTP status the caller should return. */
export class BackupImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = 'BackupImportError';
  }
}

/** Dump every user-owned row as a single JSON backup document. */
export async function exportBackup(env: Env, userId: string): Promise<BackupDocument> {
  const all = async (table: string, order: string) =>
    (await env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${order}`).bind(userId).all()).results;
  const [projects, groups, tags, filters, tasks, habits, checkins, habitRecords, focus, countdowns] = await Promise.all([
    all('projects', 'sort_order'),
    all('project_groups', 'sort_order'),
    all('tags', 'sort_order'),
    all('filters', 'sort_order'),
    all('tasks', 'created_time'),
    all('habits', 'sort_order'),
    env.DB.prepare(
      'SELECT c.* FROM habit_checkins c JOIN habits h ON h.id = c.habit_id WHERE c.user_id = ?',
    ).bind(userId).all().then((r) => r.results),
    env.DB.prepare(
      'SELECT r.* FROM habit_records r JOIN habits h ON h.id = r.habit_id WHERE r.user_id = ?',
    ).bind(userId).all().then((r) => r.results),
    all('focus_records', 'created_at'),
    all('countdowns', 'sort_order'),
  ]);
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    projects,
    projectGroups: groups,
    tags,
    filters,
    tasks,
    habits,
    habitCheckins: checkins,
    habitRecords,
    focusRecords: focus,
    countdowns,
  };
}

/**
 * Merge-import a previously exported backup (upserts by id). Throws
 * BackupImportError for files that are not NodeTick backups or exceed the
 * per-table row limit; unknown/extra fields are ignored.
 */
export async function importBackup(
  env: Env,
  userId: string,
  parsed: unknown,
): Promise<{ imported: number }> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupImportError('expected a NodeTick backup JSON object', 400);
  }
  const doc = parsed as Record<string, unknown>;
  if (doc.app !== BACKUP_APP_ID) {
    throw new BackupImportError('not a NodeTick backup file', 400);
  }

  let imported = 0;
  const upsert = async (table: string, rows: unknown, columns: string[]) => {
    if (!Array.isArray(rows)) return;
    if (rows.length > MAX_IMPORT_ITEMS) {
      throw new BackupImportError(`too many ${table} rows`, 413);
    }
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      if (typeof row.id !== 'string' || !row.id || row.id.length > 128) continue;
      const names = ['user_id', ...columns];
      const values = [userId, ...columns.map((col) => row[col] ?? null)];
      const placeholders = names.map(() => '?').join(', ');
      await env.DB.prepare(
        `INSERT OR REPLACE INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`,
      ).bind(...values).run();
      imported++;
    }
  };

  // Columns mirror schema.sql; keep this list in sync when tables change.
  await upsert('project_groups', doc.projectGroups, ['id', 'name', 'view_mode', 'sort_order', 'created_at']);
  await upsert('projects', doc.projects, ['id', 'name', 'color', 'sort_order', 'view_mode', 'kind', 'group_id', 'closed', 'permission', 'etag', 'created_at']);
  await upsert('tags', doc.tags, ['id', 'name', 'label', 'color', 'sort_order', 'parent_id', 'created_at']);
  await upsert('filters', doc.filters, ['id', 'name', 'filter_json', 'sort_order', 'created_at', 'modified_at']);
  await upsert(
    'tasks',
    doc.tasks,
    ['id', 'project_id', 'title', 'content', 'task_desc', 'kind', 'start_date', 'due_date', 'time_zone', 'is_all_day',
      'priority', 'pinned', 'status', 'sort_order', 'repeat_flag', 'reminders', 'items', 'tags', 'parent_id', 'child_ids',
      'column_id', 'completed_time', 'focus_summaries', 'etag', 'created_time', 'modified_time', 'deleted', 'deleted_time'],
  );
  await upsert(
    'habits',
    doc.habits,
    ['id', 'name', 'icon_res', 'color', 'sort_order', 'status', 'encouragement', 'type', 'goal', 'step', 'unit',
      'repeat_rule', 'reminders', 'section_id', 'style', 'etag', 'created_at'],
  );
  await upsert('habit_checkins', doc.habitCheckins, ['id', 'habit_id', 'stamp', 'value', 'goal', 'status', 'time', 'op_time', 'created_at']);
  await upsert('habit_records', doc.habitRecords, ['id', 'habit_id', 'stamp', 'content', 'emoji', 'op_time', 'created_at']);
  await upsert('focus_records', doc.focusRecords, ['id', 'type', 'task_id', 'note', 'start_time', 'end_time', 'duration', 'pause_duration', 'relation', 'status', 'etag', 'created_at']);
  await upsert('countdowns', doc.countdowns, ['id', 'name', 'date', 'kind', 'reminders', 'repeat_flag', 'calculation', 'display_mode', 'style', 'color', 'icon', 'sort_order', 'created_at']);

  return { imported };
}
