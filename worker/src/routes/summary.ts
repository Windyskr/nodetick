import { Hono } from 'hono';
import { Env, Vars } from '../env.js';
import { genId, nowIso, readJsonObject } from '../util.js';
import {
  DEFAULT_SUMMARY_CONFIG,
  MAX_SUMMARY_DRAFT,
  MAX_SUMMARY_DRAFT_KEY,
  MAX_SUMMARY_TEMPLATE_NAME,
  MAX_SUMMARY_TEMPLATES,
  normalizeSummaryConfig,
  readStoredConfig,
  serializeSummaryTemplate,
  type SummaryConfig,
} from '../services/summary.js';

type State = { Bindings: Env; Variables: Vars };

/**
 * NodeTick extension: the Summary page's settings, templates and draft.
 * GET/POST /summary/state, GET/POST /summary/template,
 * POST/DELETE /summary/template/{id}.
 */
export const summary = new Hono<State>();

function templateName(value: unknown): { value: string } | { error: string } {
  if (typeof value !== 'string') return { error: 'name must be a string' };
  const name = value.trim();
  if (!name || name.length > MAX_SUMMARY_TEMPLATE_NAME) {
    return { error: `name is required (max ${MAX_SUMMARY_TEMPLATE_NAME} chars)` };
  }
  return { value: name };
}

function sortOrderOf(value: unknown, fallback: number): number | null {
  if (value == null) return fallback;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

summary.get('/summary/state', async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare('SELECT * FROM summary_state WHERE user_id = ?')
    .bind(userId)
    .first<Record<string, unknown>>();
  return c.json({
    config: row ? readStoredConfig(row.config_json) : DEFAULT_SUMMARY_CONFIG,
    draft: row?.draft == null ? null : String(row.draft),
    draftKey: row?.draft_key == null ? null : String(row.draft_key),
    modifiedTime: row?.modified_at == null ? null : String(row.modified_at),
  });
});

/**
 * Save any of `config`, `draft` and `draftKey`; the others keep their value.
 * `draft: null` drops the edited text.
 */
summary.post('/summary/state', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  let config: SummaryConfig | undefined;
  if ('config' in b) {
    const normalized = normalizeSummaryConfig(b.config);
    if ('error' in normalized) return c.json({ error: normalized.error }, 400);
    config = normalized.value;
  }
  if ('draft' in b && b.draft !== null && (typeof b.draft !== 'string' || b.draft.length > MAX_SUMMARY_DRAFT)) {
    return c.json({ error: `draft must be a string of at most ${MAX_SUMMARY_DRAFT} characters, or null` }, 400);
  }
  if ('draftKey' in b && b.draftKey !== null && (typeof b.draftKey !== 'string' || b.draftKey.length > MAX_SUMMARY_DRAFT_KEY)) {
    return c.json({ error: `draftKey must be a string of at most ${MAX_SUMMARY_DRAFT_KEY} characters, or null` }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT * FROM summary_state WHERE user_id = ?')
    .bind(userId)
    .first<Record<string, unknown>>();
  const next = {
    config: config ?? (existing ? readStoredConfig(existing.config_json) : DEFAULT_SUMMARY_CONFIG),
    draft: 'draft' in b ? (b.draft as string | null) : existing?.draft == null ? null : String(existing.draft),
    draftKey: 'draftKey' in b ? (b.draftKey as string | null) : existing?.draft_key == null ? null : String(existing.draft_key),
    modifiedTime: nowIso(),
  };
  await c.env.DB.prepare(
    `INSERT INTO summary_state (user_id, config_json, draft, draft_key, modified_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json, draft = excluded.draft,
       draft_key = excluded.draft_key, modified_at = excluded.modified_at`,
  )
    .bind(userId, JSON.stringify(next.config), next.draft, next.draftKey, next.modifiedTime)
    .run();
  return c.json(next);
});

summary.get('/summary/template', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM summary_templates WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
  )
    .bind(userId)
    .all();
  return c.json(rows.results.map(serializeSummaryTemplate));
});

summary.post('/summary/template', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const name = templateName(b.name);
  if ('error' in name) return c.json({ error: name.error }, 400);
  const config = normalizeSummaryConfig(b.config ?? {});
  if ('error' in config) return c.json({ error: config.error }, 400);
  const sortOrder = sortOrderOf(b.sortOrder, 0);
  if (sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);

  const id = genId();
  const now = nowIso();
  // The count check and the insert are one statement, so two quick saves can't pass the cap together.
  const res = await c.env.DB.prepare(
    `INSERT INTO summary_templates (id, user_id, name, config_json, sort_order, created_at, modified_at)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM summary_templates WHERE user_id = ?) < ?`,
  )
    .bind(id, userId, name.value, JSON.stringify(config.value), sortOrder, now, now, userId, MAX_SUMMARY_TEMPLATES)
    .run();
  if (!res.meta.changes) return c.json({ error: `at most ${MAX_SUMMARY_TEMPLATES} summary templates` }, 400);
  return c.json(serializeSummaryTemplate({
    id, name: name.value, config_json: JSON.stringify(config.value), sort_order: sortOrder, created_at: now, modified_at: now,
  }));
});

summary.post('/summary/template/:templateId', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('templateId');
  const existing = await c.env.DB.prepare('SELECT * FROM summary_templates WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Record<string, unknown>>();
  if (!existing) return c.json({ error: 'summary template not found' }, 404);
  const b = await readJsonObject(c.req);

  let name = String(existing.name ?? '');
  if ('name' in b) {
    const parsed = templateName(b.name);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    name = parsed.value;
  }
  let configJson = JSON.stringify(readStoredConfig(existing.config_json));
  if ('config' in b) {
    const parsed = normalizeSummaryConfig(b.config);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    configJson = JSON.stringify(parsed.value);
  }
  const sortOrder = sortOrderOf(b.sortOrder, Number(existing.sort_order ?? 0));
  if (sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);

  const now = nowIso();
  await c.env.DB.prepare(
    'UPDATE summary_templates SET name = ?, config_json = ?, sort_order = ?, modified_at = ? WHERE id = ? AND user_id = ?',
  )
    .bind(name, configJson, sortOrder, now, id, userId)
    .run();
  return c.json(serializeSummaryTemplate({ ...existing, name, config_json: configJson, sort_order: sortOrder, modified_at: now }));
});

summary.delete('/summary/template/:templateId', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB.prepare('DELETE FROM summary_templates WHERE id = ? AND user_id = ?')
    .bind(c.req.param('templateId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'summary template not found' }, 404);
  return c.body(null, 200);
});
