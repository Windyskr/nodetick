import { Hono } from 'hono';
import { Env, Vars } from '../env.js';
import {
  serializeCheckin,
  serializeCheckinEntry,
  serializeCountdown,
  serializeFocus,
  serializeFilter,
  serializeHabit,
  serializeHabitRecord,
  serializeTag,
} from '../serialize.js';
import { genId, nonStringField, nowIso, parseApiDate, parseJsonArray, readJsonObject, RequestBodyTooLargeError, isRequestBodyTooLarge } from '../util.js';
import { BackupImportError, exportBackup, importBackup } from '../services/backup.js';
import { COUNTDOWN_REMINDERS } from '../services/notifications.js';
import { LUNAR_FIRST_DAY, LUNAR_LAST_DAY } from '../lunar.js';
import { runBatches } from '../db.js';
import {
  aggregateFocus,
  firstLocalDay,
  type FocusStatsRow,
  type FocusTaskRow,
  HISTORY_SLACK,
  historyPage,
  historyTextBound,
  MAX_OFFSET_MS,
  offsetSegments,
  type OffsetSegment,
  parseDay,
  textDayAfter,
  textDayBefore,
  validTimeZone,
  Zone,
  zonedDayStart,
} from '../services/focus.js';
import { tagKey } from './tasks.js';

type State = { Bindings: Env; Variables: Vars };

export const misc = new Hono<State>();

const MAX_HABIT_NAME = 256;
const MAX_HABIT_IDS = 100;
const MAX_CHECKIN_RANGE_DAYS = 366;
const MAX_REMINDERS = 100;
const MAX_REMINDER_LENGTH = 512;
const MAX_HABIT_RECORD_CONTENT = 8192;
/** One check-in entry's amount, and how many entries one habit day may hold. */
const MAX_CHECKIN_ENTRY_VALUE = 1_000_000;
const MAX_CHECKIN_ENTRIES_PER_DAY = 100;
const MAX_FOCUS_NOTE = 64 * 1024;
const MAX_FOCUS_RESULTS = 5000;
const MAX_RELATION_TYPES = 32;
const MAX_COUNTDOWN_NAME = 128;
const MAX_COUNTDOWN_DATE = 32;
const MAX_COUNTDOWN_REMINDERS = 10;
const MAX_FOCUS_SECONDS = 366 * 24 * 60 * 60;
const MAX_FILTER_NAME = 128;
const MAX_FILTER_VALUES = 100;
const MAX_FILTER_VALUE_LENGTH = 128;
const MAX_FILTER_DATE_LENGTH = 10;

function focusType(value: string | undefined): 0 | 1 | null {
  if (value === '0') return 0;
  if (value === '1') return 1;
  return null;
}

function strictFocusNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const FOCUS_ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function validFocusDate(value: unknown): value is string {
  // parseApiDate also rejects impossible days that Date.parse rolls over (02-30 → 03-02).
  return typeof value === 'string' && value.length <= 64 && FOCUS_ISO_DATE.test(value) && typeof parseApiDate(value) === 'number';
}

function invalidFocusRelation(value: unknown): boolean {
  return value != null && (
    !Array.isArray(value) ||
    value.length > MAX_RELATION_TYPES ||
    value.some((item) => typeof item !== 'number' || !Number.isInteger(item))
  );
}

function invalidStringArray(value: unknown, maxItems: number, maxItemLength: number): boolean {
  return Array.isArray(value) && (value.length > maxItems || value.some((item) => typeof item !== 'string' || item.length > maxItemLength));
}

function validStamp(value: unknown): number | null {
  const raw = String(value ?? '');
  if (!/^\d{8}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1970 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return Number(raw);
}

function stampDay(value: number): number {
  const raw = String(value);
  return Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8))) / 86400000;
}

function finiteNumber(value: unknown, fallback: number | null = null): number | null {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const COUNTDOWN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTDOWN_KINDS = ['countdown', 'anniversary', 'birthday', 'holiday'] as const;
const COUNTDOWN_CALCULATIONS = ['standard', 'workday'] as const;
const COUNTDOWN_DISPLAY_MODES = ['on-day', 'always'] as const;
const COUNTDOWN_REPEATS = ['yearly', 'monthly'] as const;
const COUNTDOWN_NUMBER_FORMATS = ['days', 'ymd'] as const;
const COUNTDOWN_CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_COUNTDOWN_NOTE = 4000;

function validCountdownDate(value: unknown): value is string {
  if (typeof value !== 'string' || !COUNTDOWN_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

function countdownInput(b: Record<string, unknown>, partial = false) {
  const name = b.name;
  const date = b.date;
  if ((!partial || name != null) && (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_COUNTDOWN_NAME)) {
    return { error: `name must be 1-${MAX_COUNTDOWN_NAME} chars` } as const;
  }
  if ((!partial || date != null) && (!validCountdownDate(date) || date.length > MAX_COUNTDOWN_DATE)) {
    return { error: 'date must be a valid YYYY-MM-DD date' } as const;
  }
  for (const key of ['pinned', 'archived', 'lunar', 'showInCalendar'] as const) {
    if (b[key] != null && typeof b[key] !== 'boolean') return { error: `${key} must be a boolean` } as const;
  }
  // Lunar dates convert through the 1900–2100 table (src/lunar.ts).
  if (b.lunar === true && typeof date === 'string' && (date < LUNAR_FIRST_DAY || date > LUNAR_LAST_DAY)) {
    return { error: `lunar dates must fall between ${LUNAR_FIRST_DAY} and ${LUNAR_LAST_DAY}` } as const;
  }
  const note = b.note;
  if (note != null && (typeof note !== 'string' || note.length > MAX_COUNTDOWN_NOTE)) {
    return { error: `note must be a string of at most ${MAX_COUNTDOWN_NOTE} chars` } as const;
  }
  const reminderTime = b.reminderTime;
  if (reminderTime != null && (typeof reminderTime !== 'string' || !COUNTDOWN_CLOCK.test(reminderTime))) {
    return { error: 'reminderTime must be HH:MM, or null for the all-day reminder time' } as const;
  }
  const numberFormat = b.numberFormat;
  if (numberFormat != null && !isOneOf(COUNTDOWN_NUMBER_FORMATS, numberFormat)) {
    return { error: `numberFormat must be one of: ${COUNTDOWN_NUMBER_FORMATS.join(', ')}` } as const;
  }
  const sortOrder = b.sortOrder;
  if (sortOrder != null && (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder))) {
    return { error: 'sortOrder must be a finite number' } as const;
  }
  const kind = b.kind;
  if (kind != null && (typeof kind !== 'string' || !COUNTDOWN_KINDS.includes(kind as typeof COUNTDOWN_KINDS[number]))) {
    return { error: 'kind is invalid' } as const;
  }
  const calculation = b.calculation;
  if (calculation != null && (typeof calculation !== 'string' || !COUNTDOWN_CALCULATIONS.includes(calculation as typeof COUNTDOWN_CALCULATIONS[number]))) {
    return { error: 'calculation is invalid' } as const;
  }
  const displayMode = b.displayMode;
  if (displayMode != null && (typeof displayMode !== 'string' || !COUNTDOWN_DISPLAY_MODES.includes(displayMode as typeof COUNTDOWN_DISPLAY_MODES[number]))) {
    return { error: 'displayMode is invalid' } as const;
  }
  const reminders = b.reminders;
  if (reminders != null && (!Array.isArray(reminders) || reminders.length > MAX_COUNTDOWN_REMINDERS || reminders.some((item) => !isOneOf(COUNTDOWN_REMINDERS, item)))) {
    return { error: `reminders must be a list of: ${COUNTDOWN_REMINDERS.join(', ')}` } as const;
  }
  const repeatFlag = b.repeatFlag;
  if (repeatFlag != null && repeatFlag !== '' && !isOneOf(COUNTDOWN_REPEATS, repeatFlag)) {
    return { error: 'repeatFlag must be yearly, monthly or null' } as const;
  }
  const style = b.style;
  if (style != null && (typeof style !== 'number' || !Number.isInteger(style) || style < 0 || style > 4)) {
    return { error: 'style must be an integer from 0 to 4' } as const;
  }
  const color = b.color;
  if (color != null && (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))) {
    return { error: 'color must be a hex color' } as const;
  }
  const icon = b.icon;
  if (icon != null && (typeof icon !== 'string' || icon.length > 32)) {
    return { error: 'icon must be a string' } as const;
  }
  const flag = (value: unknown) => (typeof value === 'boolean' ? (value ? 1 : 0) : null);
  return {
    value: {
      name: typeof name === 'string' ? name.trim() : null,
      date: typeof date === 'string' ? date : null,
      kind: typeof kind === 'string' ? kind : null,
      // Deduplicated, nearest lead first.
      reminders: Array.isArray(reminders) ? COUNTDOWN_REMINDERS.filter((token) => reminders.includes(token)) : null,
      repeatFlag: typeof repeatFlag === 'string' && repeatFlag ? repeatFlag : null,
      calculation: typeof calculation === 'string' ? calculation : null,
      displayMode: typeof displayMode === 'string' ? displayMode : null,
      style: typeof style === 'number' ? style : null,
      color: typeof color === 'string' ? color : null,
      icon: typeof icon === 'string' ? icon : null,
      sortOrder: typeof sortOrder === 'number' ? sortOrder : null,
      note: typeof note === 'string' ? note : null,
      pinned: flag(b.pinned),
      archived: flag(b.archived),
      reminderTime: typeof reminderTime === 'string' ? reminderTime : null,
      lunar: flag(b.lunar),
      numberFormat: typeof numberFormat === 'string' ? numberFormat : null,
      showInCalendar: flag(b.showInCalendar),
    },
  } as const;
}

function invalidFiniteNumber(value: unknown): boolean {
  return value != null && value !== '' && !Number.isFinite(Number(value));
}

function invalidText(value: unknown, maxLength: number): boolean {
  return value != null && (typeof value !== 'string' || value.length > maxLength);
}

/** Reject with 400 when a listed field is present but not a string (instead of storing "[object Object]"). */
function stringFieldError(b: Record<string, unknown>, keys: readonly string[]): string | null {
  const field = nonStringField(b, keys);
  return field ? `${field} must be a string` : null;
}

const HABIT_STRING_FIELDS = ['name', 'iconRes', 'color', 'encouragement', 'type', 'unit', 'repeatRule', 'sectionId'] as const;

/** Length caps for the habit string fields other than the name. */
const HABIT_FIELD_LIMITS: Readonly<Record<string, number>> = {
  iconRes: 128, color: 32, encouragement: 512, type: 32, unit: 64, repeatRule: 2048, sectionId: 64,
};

function habitFieldError(b: Record<string, unknown>): string | null {
  const stringError = stringFieldError(b, HABIT_STRING_FIELDS);
  if (stringError) return stringError;
  for (const [key, max] of Object.entries(HABIT_FIELD_LIMITS)) {
    if (typeof b[key] === 'string' && (b[key] as string).length > max) return `${key} must be at most ${max} characters`;
  }
  return null;
}

function invalidNumericArray(value: unknown, maxItems: number): boolean {
  return Array.isArray(value) && (
    value.length > maxItems || value.some((item) => item == null || item === '' || !Number.isInteger(Number(item)))
  );
}

export const FILTER_DATE_MODES = ['any', 'today', 'tomorrow', 'week', 'next7', 'month', 'overdue', 'nodate', 'custom'] as const;
export const FILTER_KINDS = ['task', 'note'] as const;
const MAX_FILTER_KEYWORDS = 200;

type FilterValue = {
  logic: 'and' | 'or';
  dateMode: typeof FILTER_DATE_MODES[number];
  dateStart: string | null;
  dateEnd: string | null;
  projectIds: string[];
  tags: string[];
  priorities: number[];
  statuses: number[];
  /** NodeTick extension: search words that must all match, saved from the search page. */
  keywords: string;
  /** NodeTick extension: 'task' and/or 'note' (kind NOTE); empty matches both. */
  kinds: string[];
};

function validFilterDate(value: unknown): boolean {
  if (value == null || value === '') return true;
  const raw = String(value);
  if (raw.length !== MAX_FILTER_DATE_LENGTH || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

function normalizeFilter(value: Record<string, unknown>): { value?: FilterValue; error?: string } {
  const dateMode = String(value.dateMode ?? 'any');
  if (!(FILTER_DATE_MODES as readonly string[]).includes(dateMode)) {
    return { error: 'dateMode is invalid' };
  }
  if (value.keywords != null && (typeof value.keywords !== 'string' || value.keywords.length > MAX_FILTER_KEYWORDS)) {
    return { error: `keywords must be a string of at most ${MAX_FILTER_KEYWORDS} characters` };
  }
  if (value.kinds != null && (!Array.isArray(value.kinds) || value.kinds.some((kind) => !(FILTER_KINDS as readonly unknown[]).includes(kind)))) {
    return { error: `kinds must only contain ${FILTER_KINDS.join(', ')}` };
  }
  if (!validFilterDate(value.dateStart) || !validFilterDate(value.dateEnd)) {
    return { error: 'dateStart/dateEnd must be YYYY-MM-DD dates' };
  }
  const dateStart = value.dateStart == null || value.dateStart === '' ? null : String(value.dateStart);
  const dateEnd = value.dateEnd == null || value.dateEnd === '' ? null : String(value.dateEnd);
  if (dateStart && dateEnd && dateEnd < dateStart) return { error: 'dateEnd must not precede dateStart' };
  for (const [key, max] of [
    ['projectIds', MAX_FILTER_VALUES],
    ['tags', MAX_FILTER_VALUES],
  ] as const) {
    if (invalidStringArray(value[key], max, MAX_FILTER_VALUE_LENGTH)) {
      return { error: `${key} contains too many or too-long values` };
    }
  }
  for (const [key, max] of [['priorities', 8], ['statuses', 8] ] as const) {
    if (invalidNumericArray(value[key], max)) return { error: `${key} contains invalid values` };
  }
  return {
    value: {
      logic: value.logic === 'or' ? 'or' : 'and',
      dateMode: dateMode as FilterValue['dateMode'],
      dateStart,
      dateEnd,
      projectIds: Array.isArray(value.projectIds) ? value.projectIds.map(String) : [],
      tags: Array.isArray(value.tags) ? value.tags.map(String) : [],
      priorities: Array.isArray(value.priorities) ? value.priorities.map(Number) : [],
      statuses: Array.isArray(value.statuses) ? value.statuses.map(Number) : [],
      keywords: typeof value.keywords === 'string' ? value.keywords.trim() : '',
      kinds: Array.isArray(value.kinds) ? [...new Set(value.kinds.map(String))] : [],
    },
  };
}

// --- Saved filters / smart lists ---

misc.get('/filter', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM filters WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
  )
    .bind(userId)
    .all();
  return c.json(rows.results.map(serializeFilter));
});

misc.post('/filter', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, ['name']);
  if (stringError) return c.json({ error: stringError }, 400);
  const name = String(b.name ?? '').trim();
  if (!name || name.length > MAX_FILTER_NAME) {
    return c.json({ error: `name is required (max ${MAX_FILTER_NAME} chars)` }, 400);
  }
  const normalized = normalizeFilter(b);
  if (!normalized.value) return c.json({ error: normalized.error ?? 'invalid filter' }, 400);
  const sortOrder = finiteNumber(b.sortOrder, 0);
  if (sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const id = genId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO filters (id, user_id, name, filter_json, sort_order, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, name, JSON.stringify(normalized.value), sortOrder, now, now)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM filters WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
  return c.json(serializeFilter(row!));
});

misc.post('/filter/:filterId', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('filterId');
  const existing = await c.env.DB.prepare('SELECT * FROM filters WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Record<string, unknown>>();
  if (!existing) return c.json({ error: 'filter not found' }, 404);
  let oldValue: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(existing.filter_json ?? '{}')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) oldValue = parsed as Record<string, unknown>;
  } catch {
    // Treat a malformed legacy value as an empty filter and repair it below.
  }
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, ['name']);
  if (stringError) return c.json({ error: stringError }, 400);
  const merged = { ...oldValue, ...b };
  const name = String(merged.name ?? existing.name ?? '').trim();
  if (!name || name.length > MAX_FILTER_NAME) {
    return c.json({ error: `name is required (max ${MAX_FILTER_NAME} chars)` }, 400);
  }
  const normalized = normalizeFilter(merged);
  if (!normalized.value) return c.json({ error: normalized.error ?? 'invalid filter' }, 400);
  const sortOrder = finiteNumber(merged.sortOrder, Number(existing.sort_order ?? 0));
  if (sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  await c.env.DB.prepare(
    `UPDATE filters SET name = ?, filter_json = ?, sort_order = ?, modified_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(name, JSON.stringify(normalized.value), sortOrder, nowIso(), id, userId)
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM filters WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
  return c.json(serializeFilter(row!));
});

misc.delete('/filter/:filterId', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB.prepare('DELETE FROM filters WHERE id = ? AND user_id = ?')
    .bind(c.req.param('filterId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'filter not found' }, 404);
  return c.body(null, 200);
});

// --- Tags ---

misc.get('/tag', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM tags WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
  )
    .bind(userId)
    .all();
  return c.json(rows.results.map(serializeTag));
});

misc.post('/tag', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, ['name', 'label', 'color']);
  if (stringError) return c.json({ error: stringError }, 400);
  const name = String(b.name ?? '').trim().toLowerCase();
  const label = String(b.label ?? '').trim();
  if (!name || name.length > 64) return c.json({ error: 'name is required (max 64 chars)' }, 400);
  if (!label || label.length > 64) return c.json({ error: 'label is required (max 64 chars)' }, 400);
  const existing = await c.env.DB.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?')
    .bind(userId, name)
    .first<{ id: string }>();
  if (existing) {
    await c.env.DB.prepare('UPDATE tags SET label = ?, color = COALESCE(?, color) WHERE id = ?')
      .bind(label, b.color != null ? String(b.color) : null, existing.id)
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO tags (id, user_id, name, label, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(genId(), userId, name, label, b.color != null ? String(b.color) : null, Date.now())
      .run();
  }
  const row = await c.env.DB.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?')
    .bind(userId, name)
    .first();
  return c.json(serializeTag(row!));
});

/**
 * Why `name` can't sit under `parent`, or null: the parent must exist, be a
 * top-level tag and not be the tag itself, and a tag with sub-tags can't
 * become a sub-tag.
 */
async function tagNestingError(db: D1Database, userId: string, name: string, parent: string): Promise<string | null> {
  if (parent === name) return 'a tag cannot be its own parent';
  const [parentRow, children] = await db.batch<{ parent_id: string | null; n?: number }>([
    db.prepare('SELECT parent_id FROM tags WHERE user_id = ? AND name = ?').bind(userId, parent),
    db.prepare('SELECT COUNT(*) AS n FROM tags WHERE user_id = ? AND parent_id = ?').bind(userId, name),
  ]);
  if (!parentRow.results.length) return 'parent tag not found';
  if (parentRow.results[0].parent_id) return 'tags nest one level deep: the parent is a sub-tag';
  if (Number(children.results[0]?.n ?? 0) > 0) return 'tags nest one level deep: this tag has sub-tags';
  return null;
}

/**
 * Rename/relabel/recolor an existing tag. Renaming also rewrites the tag
 * inside every task's tags array so filters and tag pages stay consistent.
 */
misc.post('/tag/:tagName', async (c) => {
  const userId = c.get('userId');
  const oldName = c.req.param('tagName').trim().toLowerCase();
  const existing = await c.env.DB.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?')
    .bind(userId, oldName)
    .first<Record<string, unknown>>();
  if (!existing) return c.json({ error: 'tag not found' }, 404);

  const b = await readJsonObject(c.req);
  const stringError = stringFieldError(b, ['name', 'label', 'color']);
  if (stringError) return c.json({ error: stringError }, 400);
  const rawName = b.name != null ? String(b.name).trim().toLowerCase() : oldName;
  if (!rawName || rawName.length > 64) return c.json({ error: 'name must be 1-64 chars' }, 400);
  if (rawName !== oldName) {
    const clash = await c.env.DB.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?')
      .bind(userId, rawName)
      .first<{ id: string }>();
    if (clash) return c.json({ error: 'a tag with that name already exists' }, 409);
  }
  const label = String(b.label ?? rawName).trim() || rawName;
  if (label.length > 64) return c.json({ error: 'label must be at most 64 chars' }, 400);
  const color = b.color == null || b.color === '' ? null : String(b.color);
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return c.json({ error: 'color must be a hex color' }, 400);
  const sortOrder = finiteNumber(b.sortOrder);
  // Nesting (NodeTick extension, like TickTick's `parent`): parentId names the
  // parent tag; null or '' makes the tag top-level. One level deep, as in TickTick.
  let parent: string | null | undefined;
  if (Object.hasOwn(b, 'parentId')) {
    if (b.parentId != null && typeof b.parentId !== 'string') return c.json({ error: 'parentId must be a tag name' }, 400);
    parent = b.parentId ? b.parentId.trim().toLowerCase() : null;
    if (parent) {
      const nestingError = await tagNestingError(c.env.DB, userId, oldName, parent);
      if (nestingError) return c.json({ error: nestingError }, 400);
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE tags SET name = ?, label = ?, color = COALESCE(?, color), sort_order = COALESCE(?, sort_order),
         parent_id = CASE WHEN ? THEN ? ELSE parent_id END
       WHERE id = ? AND user_id = ?`,
    ).bind(rawName, label, color, sortOrder, parent !== undefined ? 1 : 0, parent ?? null, existing.id, userId),
    // Sub-tags follow a renamed parent.
    c.env.DB.prepare('UPDATE tags SET parent_id = ? WHERE user_id = ? AND parent_id = ?').bind(rawName, userId, oldName),
  ]);

  if (rawName !== oldName) {
    // Rewrite the tag in every task that references it.
    const rows = await c.env.DB.prepare(
      'SELECT id, tags FROM tasks WHERE user_id = ? AND tags IS NOT NULL',
    )
      .bind(userId)
      .all<{ id: string; tags: string }>();
    const updates: D1PreparedStatement[] = [];
    for (const r of rows.results) {
      const tags = parseJsonArray<string>(r.tags).map(String);
      // Task rows keep the typed case ("Work"); match on the tag name.
      if (!tags.some((tag) => tagKey(tag) === oldName)) continue;
      const next = [...new Set(tags.map((tag) => (tagKey(tag) === oldName ? rawName : tag)))];
      updates.push(c.env.DB.prepare('UPDATE tasks SET tags = ?, modified_time = ?, etag = etag + 1 WHERE id = ? AND user_id = ?')
        .bind(JSON.stringify(next), nowIso(), r.id, userId));
    }
    await runBatches(c.env.DB, updates);
  }

  const row = await c.env.DB.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?')
    .bind(userId, rawName)
    .first();
  return c.json(serializeTag(row!));
});

/** Delete a tag and strip it from every task's tags array. */
misc.delete('/tag/:tagName', async (c) => {
  const userId = c.get('userId');
  const name = c.req.param('tagName').trim().toLowerCase();
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM tags WHERE user_id = ? AND name = ?').bind(userId, name),
    // Its sub-tags become top-level tags.
    c.env.DB.prepare('UPDATE tags SET parent_id = NULL WHERE user_id = ? AND parent_id = ?').bind(userId, name),
  ]);
  if (!res.meta.changes) return c.json({ error: 'tag not found' }, 404);
  const rows = await c.env.DB.prepare(
    'SELECT id, tags FROM tasks WHERE user_id = ? AND tags IS NOT NULL',
  )
    .bind(userId)
    .all<{ id: string; tags: string }>();
  const updates: D1PreparedStatement[] = [];
  for (const r of rows.results) {
    const tags = parseJsonArray<string>(r.tags).map(String);
    if (!tags.some((tag) => tagKey(tag) === name)) continue;
    const next = tags.filter((tag) => tagKey(tag) !== name);
    updates.push(c.env.DB.prepare('UPDATE tasks SET tags = ?, modified_time = ?, etag = etag + 1 WHERE id = ? AND user_id = ?')
      .bind(next.length ? JSON.stringify(next) : null, nowIso(), r.id, userId));
  }
  await runBatches(c.env.DB, updates);
  return c.body(null, 200);
});

// --- Habits ---

misc.get('/habit', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM habits WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
  )
    .bind(userId)
    .all();
  return c.json(rows.results.map(serializeHabit));
});

/**
 * TickTick's habit sections (ticktick-cli `habit section list`). NodeTick has
 * the three built-in sections and no custom ones; a habit with any other
 * sectionId (TickTick uses "-1") belongs to "Others".
 */
const HABIT_SECTIONS = ['_morning', '_afternoon', '_night'].map((id, sortOrder) => ({ id, name: id, sortOrder }));

misc.get('/habit/sections', (c) => c.json(HABIT_SECTIONS));

misc.get('/habit/checkins', async (c) => {
  const userId = c.get('userId');
  const habitIds = (c.req.query('habitIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((id, index, all) => all.indexOf(id) === index);
  if (!habitIds.length || habitIds.length > MAX_HABIT_IDS) {
    return c.json({ error: `habitIds must contain 1-${MAX_HABIT_IDS} ids` }, 400);
  }
  const from = validStamp(c.req.query('from'));
  const to = validStamp(c.req.query('to'));
  if (from == null || to == null) {
    return c.json({ error: 'habitIds, from, to are required (YYYYMMDD stamps)' }, 400);
  }
  if (to < from || stampDay(to) - stampDay(from) > MAX_CHECKIN_RANGE_DAYS) {
    return c.json({ error: `check-in range must not exceed ${MAX_CHECKIN_RANGE_DAYS} days` }, 400);
  }
  const year = Math.floor(from / 10000);
  // One query for every habit: the ids travel as a JSON array, since D1 caps
  // bound parameters at 100 per statement.
  const rows = await c.env.DB.prepare(
    `SELECT * FROM habit_checkins
     WHERE habit_id IN (SELECT value FROM json_each(?)) AND user_id = ? AND stamp BETWEEN ? AND ?
     ORDER BY stamp ASC`,
  )
    .bind(JSON.stringify(habitIds), userId, from, to)
    .all();
  const byHabit = new Map<string, ReturnType<typeof serializeCheckin>[]>(habitIds.map((id) => [id, []]));
  for (const row of rows.results) byHabit.get(String(row.habit_id))?.push(serializeCheckin(row));
  return c.json(habitIds.map((habitId) => ({ habitId, year, checkins: byHabit.get(habitId)! })));
});

misc.get('/habit/:habitId/records', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const from = validStamp(c.req.query('from'));
  const to = validStamp(c.req.query('to'));
  if (from == null || to == null) {
    return c.json({ error: 'from and to are required (YYYYMMDD stamps)' }, 400);
  }
  if (to < from || stampDay(to) - stampDay(from) > MAX_CHECKIN_RANGE_DAYS) {
    return c.json({ error: `record range must not exceed ${MAX_CHECKIN_RANGE_DAYS} days` }, 400);
  }
  const [habit, rows] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?').bind(habitId, userId),
    c.env.DB.prepare(
      'SELECT * FROM habit_records WHERE habit_id = ? AND user_id = ? AND stamp BETWEEN ? AND ? ORDER BY stamp ASC',
    ).bind(habitId, userId, from, to),
  ]);
  if (!habit.results.length) return c.json({ error: 'habit not found' }, 404);
  return c.json(rows.results.map(serializeHabitRecord));
});

/** NodeTick extension: a habit's itemized check-ins in a date range (at most 366 days). */
misc.get('/habit/:habitId/checkin/entries', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const from = validStamp(c.req.query('from'));
  const to = validStamp(c.req.query('to'));
  if (from == null || to == null) {
    return c.json({ error: 'from and to are required (YYYYMMDD stamps)' }, 400);
  }
  if (to < from || stampDay(to) - stampDay(from) > MAX_CHECKIN_RANGE_DAYS) {
    return c.json({ error: `entry range must not exceed ${MAX_CHECKIN_RANGE_DAYS} days` }, 400);
  }
  const [habit, rows] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?').bind(habitId, userId),
    c.env.DB.prepare(
      'SELECT * FROM habit_checkin_entries WHERE habit_id = ? AND user_id = ? AND stamp BETWEEN ? AND ? ORDER BY stamp ASC, created_at ASC, id ASC',
    ).bind(habitId, userId, from, to),
  ]);
  if (!habit.results.length) return c.json({ error: 'habit not found' }, 404);
  return c.json(rows.results.map(serializeCheckinEntry));
});

misc.get('/habit/:habitId', async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?')
    .bind(c.req.param('habitId'), userId)
    .first();
  if (!row) return c.json({ error: 'habit not found' }, 404);
  return c.json(serializeHabit(row));
});

misc.post('/habit', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const fieldError = habitFieldError(b);
  if (fieldError) return c.json({ error: fieldError }, 400);
  const name = String(b.name ?? '').trim();
  if (!name || name.length > MAX_HABIT_NAME) return c.json({ error: `name is required (max ${MAX_HABIT_NAME} chars)` }, 400);
  if (invalidStringArray(b.reminders, MAX_REMINDERS, MAX_REMINDER_LENGTH)) {
    return c.json({ error: 'reminders contains too many or too-long values' }, 413);
  }
  if ([b.sortOrder, b.status, b.goal, b.step, b.style].some(invalidFiniteNumber)) {
    return c.json({ error: 'numeric habit fields must be finite numbers' }, 400);
  }
  const row = await c.env.DB.prepare(
    `INSERT INTO habits
      (id, user_id, name, icon_res, color, sort_order, status, encouragement, type, goal, step,
       unit, repeat_rule, reminders, section_id, style, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      genId(),
      userId,
      name,
      b.iconRes != null ? String(b.iconRes) : null,
      b.color != null ? String(b.color) : null,
      finiteNumber(b.sortOrder, 0),
      finiteNumber(b.status, 0),
      b.encouragement != null ? String(b.encouragement) : null,
      b.type != null ? String(b.type) : null,
      finiteNumber(b.goal),
      finiteNumber(b.step),
      b.unit != null ? String(b.unit) : null,
      b.repeatRule != null ? String(b.repeatRule) : null,
      Array.isArray(b.reminders) ? JSON.stringify(b.reminders.map(String)) : null,
      b.sectionId != null ? String(b.sectionId) : null,
      finiteNumber(b.style),
      Date.now(),
    )
    .first();
  return c.json(serializeHabit(row!));
});

misc.post('/habit/:habitId', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const fieldError = habitFieldError(b);
  if (fieldError) return c.json({ error: fieldError }, 400);
  if (b.name != null && (!String(b.name).trim() || String(b.name).trim().length > MAX_HABIT_NAME)) {
    return c.json({ error: `name must be 1-${MAX_HABIT_NAME} chars` }, 400);
  }
  if (invalidStringArray(b.reminders, MAX_REMINDERS, MAX_REMINDER_LENGTH)) {
    return c.json({ error: 'reminders contains too many or too-long values' }, 413);
  }
  if ([b.sortOrder, b.status, b.goal, b.step, b.style].some(invalidFiniteNumber)) {
    return c.json({ error: 'numeric habit fields must be finite numbers' }, 400);
  }
  const row = await c.env.DB.prepare(
    `UPDATE habits SET
       name = COALESCE(?, name), icon_res = COALESCE(?, icon_res), color = COALESCE(?, color),
       sort_order = COALESCE(?, sort_order), status = COALESCE(?, status),
       encouragement = COALESCE(?, encouragement), type = COALESCE(?, type),
       goal = COALESCE(?, goal), step = COALESCE(?, step), unit = COALESCE(?, unit),
       repeat_rule = COALESCE(?, repeat_rule), reminders = COALESCE(?, reminders),
       section_id = COALESCE(?, section_id), style = COALESCE(?, style), etag = etag + 1
     WHERE id = ? AND user_id = ?
     RETURNING *`,
  )
    .bind(
      b.name != null ? String(b.name) : null,
      b.iconRes != null ? String(b.iconRes) : null,
      b.color != null ? String(b.color) : null,
      finiteNumber(b.sortOrder),
      finiteNumber(b.status),
      b.encouragement != null ? String(b.encouragement) : null,
      b.type != null ? String(b.type) : null,
      finiteNumber(b.goal),
      finiteNumber(b.step),
      b.unit != null ? String(b.unit) : null,
      b.repeatRule != null ? String(b.repeatRule) : null,
      Array.isArray(b.reminders) ? JSON.stringify(b.reminders.map(String)) : null,
      b.sectionId != null ? String(b.sectionId) : null,
      finiteNumber(b.style),
      c.req.param('habitId'),
      userId,
    )
    .first();
  if (!row) return c.json({ error: 'habit not found' }, 404);
  return c.json(serializeHabit(row));
});

/**
 * NodeTick extension: delete a habit for good, with its check-ins, check-in
 * entries and logs. (Archiving is TickTick's `status: 1` via the update.)
 */
misc.delete('/habit/:habitId', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const results = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('DELETE FROM habit_checkin_entries WHERE habit_id = ? AND user_id = ?').bind(habitId, userId),
    c.env.DB.prepare('DELETE FROM habit_checkins WHERE habit_id = ? AND user_id = ?').bind(habitId, userId),
    c.env.DB.prepare('DELETE FROM habit_records WHERE habit_id = ? AND user_id = ?').bind(habitId, userId),
    c.env.DB.prepare('DELETE FROM habits WHERE id = ? AND user_id = ? RETURNING id').bind(habitId, userId),
  ]);
  if (!results[3].results.length) return c.json({ error: 'habit not found' }, 404);
  return c.body(null, 200);
});

/**
 * Check-in status from the day's value and goal (the row's own goal, else the
 * habit's; 1 when unset or not positive): 2 once the goal is met, else 0.
 * The entry endpoints change the value in SQL, so they set it there too.
 */
const CHECKIN_STATUS_SQL = `status = CASE WHEN COALESCE(value, 0) >= IIF(
    COALESCE(goal, (SELECT h.goal FROM habits h WHERE h.id = habit_checkins.habit_id), 1) > 0,
    COALESCE(goal, (SELECT h.goal FROM habits h WHERE h.id = habit_checkins.habit_id), 1), 1) - 1e-9
  THEN 2 ELSE 0 END`;

misc.post('/habit/:habitId/checkin', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const b = await readJsonObject(c.req);
  const stamp = validStamp(b.stamp);
  if (stamp == null) {
    return c.json({ error: 'stamp must be YYYYMMDD' }, 400);
  }
  const value = finiteNumber(b.value, 1);
  const goal = finiteNumber(b.goal);
  const status = finiteNumber(b.status);
  if (value == null || goal === null && b.goal != null || status === null && b.status != null ||
      invalidText(b.time, 64) || invalidText(b.opTime, 64)) {
    return c.json({ error: 'value, goal and status must be finite numbers; time fields must be short' }, 400);
  }

  // One round trip: the habit check, the upsert (which only runs for the
  // user's own habit) and the year's check-ins go out as one batch. An
  // explicit day value replaces the day's itemized check-in entries, so the
  // entries never claim more than the day's total.
  const year = Math.floor(stamp / 10000);
  const [habit, , , checkins] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?').bind(habitId, userId),
    c.env.DB.prepare(
    `INSERT INTO habit_checkins (id, user_id, habit_id, stamp, value, goal, status, time, op_time, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM habits WHERE id = ? AND user_id = ?)
     ON CONFLICT(habit_id, stamp) DO UPDATE SET
       value = COALESCE(excluded.value, value),
       goal = COALESCE(excluded.goal, goal),
       status = COALESCE(excluded.status, status),
       time = COALESCE(excluded.time, time),
       op_time = COALESCE(excluded.op_time, op_time)`,
  )
    .bind(
      genId(),
      userId,
      habitId,
      stamp,
      value,
      goal,
      status,
      b.time != null ? String(b.time) : null,
      b.opTime != null ? String(b.opTime) : nowIso(),
      Date.now(),
      habitId,
      userId,
    ),
    c.env.DB.prepare('DELETE FROM habit_checkin_entries WHERE habit_id = ? AND user_id = ? AND stamp = ?')
      .bind(habitId, userId, stamp),
    c.env.DB.prepare(
      'SELECT * FROM habit_checkins WHERE habit_id = ? AND user_id = ? AND stamp BETWEEN ? AND ? ORDER BY stamp ASC',
    ).bind(habitId, userId, year * 10000 + 101, year * 10000 + 1231),
  ]);
  if (!habit.results.length) return c.json({ error: 'habit not found' }, 404);
  return c.json({ habitId, year, checkins: checkins.results.map(serializeCheckin) });
});

// --- Check-in entries (NodeTick extension) ---
// A count habit's day can hold several check-ins (amount + time). Each entry
// endpoint changes the entry and the day's total in habit_checkins in one
// batch (one round trip, one transaction), so concurrent check-ins never lose
// an increment and TickTick clients keep reading the day's total. They answer
// with the year's check-ins (like POST /checkin) plus the day's entries.

function checkinEntryValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_CHECKIN_ENTRY_VALUE ? value : null;
}

const ENTRY_ERROR = `value must be a number above 0 and at most ${MAX_CHECKIN_ENTRY_VALUE}; time must be an ISO 8601 date-time`;

function entryResponse(
  habitId: string,
  stamp: number,
  checkins: D1Result<Record<string, unknown>>,
  entries: D1Result<Record<string, unknown>>,
) {
  return {
    habitId,
    year: Math.floor(stamp / 10000),
    checkins: checkins.results.map(serializeCheckin),
    entries: entries.results.map(serializeCheckinEntry),
  };
}

/** One of this entry's columns (or an expression over them), for the user's habit. */
const entryLookup = (column: string) =>
  `(SELECT ${column} FROM habit_checkin_entries WHERE id = ? AND user_id = ? AND habit_id = ?)`;

/** Add an entry: `{ stamp, value, time?, goal? }`; the day's total grows by `value`. */
misc.post('/habit/:habitId/checkin/entry', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const b = await readJsonObject(c.req);
  const stamp = validStamp(b.stamp);
  if (stamp == null) return c.json({ error: 'stamp must be YYYYMMDD' }, 400);
  const value = checkinEntryValue(b.value);
  if (value == null || (b.time != null && !validFocusDate(b.time))) return c.json({ error: ENTRY_ERROR }, 400);
  if (b.goal != null && (typeof b.goal !== 'number' || !Number.isFinite(b.goal) || b.goal <= 0)) {
    return c.json({ error: 'goal must be a positive number' }, 400);
  }
  const goal = typeof b.goal === 'number' ? b.goal : null;
  const entryId = genId();
  const time = typeof b.time === 'string' ? b.time : nowIso();
  const year = Math.floor(stamp / 10000);
  const db = c.env.DB;
  const [habit, inserted, , , checkins, entries] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?').bind(habitId, userId),
    db.prepare(
      `INSERT INTO habit_checkin_entries (id, user_id, habit_id, stamp, value, time, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM habits WHERE id = ? AND user_id = ?)
         AND (SELECT COUNT(*) FROM habit_checkin_entries WHERE habit_id = ? AND stamp = ?) < ?
       RETURNING id`,
    ).bind(entryId, userId, habitId, stamp, value, time, Date.now(), habitId, userId, habitId, stamp, MAX_CHECKIN_ENTRIES_PER_DAY),
    // Runs only when the entry went in. A new day starts at the habit's goal.
    db.prepare(
      `INSERT INTO habit_checkins (id, user_id, habit_id, stamp, value, goal, status, time, op_time, created_at)
       SELECT ?, ?, ?, ?, ?, COALESCE(?, (SELECT goal FROM habits WHERE id = ? AND user_id = ?)), 0, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM habit_checkin_entries WHERE id = ? AND user_id = ?)
       ON CONFLICT(habit_id, stamp) DO UPDATE SET
         value = ROUND(COALESCE(habit_checkins.value, 0) + excluded.value, 6),
         goal = COALESCE(?, habit_checkins.goal, excluded.goal),
         op_time = excluded.op_time`,
    ).bind(genId(), userId, habitId, stamp, value, goal, habitId, userId, time, nowIso(), Date.now(), entryId, userId, goal),
    db.prepare(`UPDATE habit_checkins SET ${CHECKIN_STATUS_SQL} WHERE habit_id = ? AND user_id = ? AND stamp = ?`)
      .bind(habitId, userId, stamp),
    db.prepare('SELECT * FROM habit_checkins WHERE habit_id = ? AND user_id = ? AND stamp BETWEEN ? AND ? ORDER BY stamp ASC')
      .bind(habitId, userId, year * 10000 + 101, year * 10000 + 1231),
    db.prepare('SELECT * FROM habit_checkin_entries WHERE habit_id = ? AND user_id = ? AND stamp = ? ORDER BY created_at ASC, id ASC')
      .bind(habitId, userId, stamp),
  ]);
  if (!habit.results.length) return c.json({ error: 'habit not found' }, 404);
  if (!inserted.results.length) {
    return c.json({ error: `a day holds at most ${MAX_CHECKIN_ENTRIES_PER_DAY} check-in entries` }, 409);
  }
  return c.json(entryResponse(habitId, stamp, checkins, entries));
});

/** Edit an entry's amount and/or time: `{ value?, time? }`; the day's total follows the amount. */
misc.post('/habit/:habitId/checkin/entry/:entryId', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const entryId = c.req.param('entryId');
  const b = await readJsonObject(c.req);
  const value = b.value == null ? null : checkinEntryValue(b.value);
  if ((b.value != null && value == null) || (b.time != null && !validFocusDate(b.time)) || (b.value == null && b.time == null)) {
    return c.json({ error: ENTRY_ERROR }, 400);
  }
  const time = typeof b.time === 'string' ? b.time : null;
  const db = c.env.DB;
  const key = [entryId, userId, habitId];
  const results = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?').bind(habitId, userId),
    // Before the entry changes: shift the day's total by (new - old); a no-op without a new value.
    db.prepare(
      `UPDATE habit_checkins SET
         value = MAX(0, ROUND(COALESCE(value, 0) + ? - COALESCE(${entryLookup('value')}, ?), 6)), op_time = ?
       WHERE ? IS NOT NULL AND habit_id = ? AND user_id = ? AND stamp = ${entryLookup('stamp')}`,
    ).bind(value, ...key, value, nowIso(), value, habitId, userId, ...key),
    db.prepare(
      'UPDATE habit_checkin_entries SET value = COALESCE(?, value), time = COALESCE(?, time) WHERE id = ? AND user_id = ? AND habit_id = ? RETURNING stamp',
    ).bind(value, time, ...key),
    db.prepare(`UPDATE habit_checkins SET ${CHECKIN_STATUS_SQL} WHERE habit_id = ? AND user_id = ? AND stamp = ${entryLookup('stamp')}`)
      .bind(habitId, userId, ...key),
    db.prepare(
      `SELECT * FROM habit_checkins WHERE habit_id = ? AND user_id = ?
         AND stamp BETWEEN ${entryLookup('stamp / 10000 * 10000 + 101')} AND ${entryLookup('stamp / 10000 * 10000 + 1231')}
       ORDER BY stamp ASC`,
    ).bind(habitId, userId, ...key, ...key),
    db.prepare(
      `SELECT * FROM habit_checkin_entries WHERE habit_id = ? AND user_id = ? AND stamp = ${entryLookup('stamp')}
       ORDER BY created_at ASC, id ASC`,
    ).bind(habitId, userId, ...key),
  ]);
  const [habit, , updated, , checkins, entries] = results;
  if (!habit.results.length) return c.json({ error: 'habit not found' }, 404);
  if (!updated.results.length) return c.json({ error: 'check-in entry not found' }, 404);
  return c.json(entryResponse(habitId, Number(updated.results[0].stamp), checkins, entries));
});

/** Remove an entry (undo); the day's total drops by its amount. */
misc.delete('/habit/:habitId/checkin/entry/:entryId', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const entryId = c.req.param('entryId');
  const db = c.env.DB;
  const key = [entryId, userId, habitId];
  // The entry goes last: until then the other statements find its day through it.
  const [habit, , , checkins, entries, deleted] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?').bind(habitId, userId),
    db.prepare(
      `UPDATE habit_checkins SET
         value = MAX(0, ROUND(COALESCE(value, 0) - COALESCE(${entryLookup('value')}, 0), 6)), op_time = ?
       WHERE habit_id = ? AND user_id = ? AND stamp = ${entryLookup('stamp')}`,
    ).bind(...key, nowIso(), habitId, userId, ...key),
    db.prepare(`UPDATE habit_checkins SET ${CHECKIN_STATUS_SQL} WHERE habit_id = ? AND user_id = ? AND stamp = ${entryLookup('stamp')}`)
      .bind(habitId, userId, ...key),
    db.prepare(
      `SELECT * FROM habit_checkins WHERE habit_id = ? AND user_id = ?
         AND stamp BETWEEN ${entryLookup('stamp / 10000 * 10000 + 101')} AND ${entryLookup('stamp / 10000 * 10000 + 1231')}
       ORDER BY stamp ASC`,
    ).bind(habitId, userId, ...key, ...key),
    db.prepare(
      `SELECT * FROM habit_checkin_entries WHERE habit_id = ? AND user_id = ? AND stamp = ${entryLookup('stamp')} AND id != ?
       ORDER BY created_at ASC, id ASC`,
    ).bind(habitId, userId, ...key, entryId),
    db.prepare('DELETE FROM habit_checkin_entries WHERE id = ? AND user_id = ? AND habit_id = ? RETURNING stamp').bind(...key),
  ]);
  if (!habit.results.length) return c.json({ error: 'habit not found' }, 404);
  if (!deleted.results.length) return c.json({ error: 'check-in entry not found' }, 404);
  return c.json(entryResponse(habitId, Number(deleted.results[0].stamp), checkins, entries));
});

misc.post('/habit/:habitId/record', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const b = await readJsonObject(c.req);
  const stamp = validStamp(b.stamp);
  if (stamp == null || typeof b.content !== 'string' || b.content.length > MAX_HABIT_RECORD_CONTENT) {
    return c.json({ error: `stamp must be YYYYMMDD and content must be a string of at most ${MAX_HABIT_RECORD_CONTENT} characters` }, 400);
  }
  const emoji = b.emoji === undefined ? 50 : b.emoji;
  if (typeof emoji !== 'number' || !Number.isInteger(emoji) || emoji < 0 || emoji > 100) {
    return c.json({ error: 'emoji must be an integer between 0 and 100' }, 400);
  }

  // One round trip: the upsert only runs for the user's own habit.
  const row = await c.env.DB.prepare(
    `INSERT INTO habit_records (id, user_id, habit_id, stamp, content, emoji, op_time, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM habits WHERE id = ? AND user_id = ?)
     ON CONFLICT(habit_id, stamp) DO UPDATE SET
       content = excluded.content,
       emoji = excluded.emoji,
       op_time = excluded.op_time
     RETURNING *`,
  )
    .bind(genId(), userId, habitId, stamp, b.content, emoji, nowIso(), Date.now(), habitId, userId)
    .first();
  if (!row) return c.json({ error: 'habit not found' }, 404);
  return c.json(serializeHabitRecord(row));
});

/** NodeTick extension: delete one day's check-in log. */
misc.delete('/habit/:habitId/record/:stamp', async (c) => {
  const userId = c.get('userId');
  const stamp = validStamp(c.req.param('stamp'));
  if (stamp == null) return c.json({ error: 'stamp must be YYYYMMDD' }, 400);
  const res = await c.env.DB.prepare('DELETE FROM habit_records WHERE habit_id = ? AND user_id = ? AND stamp = ?')
    .bind(c.req.param('habitId'), userId, stamp)
    .run();
  if (!res.meta.changes) return c.json({ error: 'habit record not found' }, 404);
  return c.body(null, 200);
});

// --- Focus records ---

const MAX_FOCUS_RANGE_DAYS = 30;
/** Stats ranges: a calendar year, or the 53 weeks of a contribution heatmap. */
const MAX_STATS_RANGE_DAYS = 371;
const MAX_STATS_RECORDS = 20_000;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_HISTORY_LIMIT = 50;
const MAX_FOCUS_TASK_ID = 128;
const DAY_MS = 86_400_000;

interface FocusInput {
  type?: 0 | 1;
  /** null unlinks the task. */
  taskId?: string | null;
  note?: string | null;
  startTime?: string;
  endTime?: string;
  duration?: number;
  pauseDuration?: number;
  relationType?: number[];
  added?: boolean;
}

/**
 * Validate a focus record body. Creating requires `type`; an update takes
 * any subset, where an absent or null field stays as it is, except that null
 * or "" clears `taskId` and `note`.
 */
function focusInput(b: Record<string, unknown>, update: boolean): { error: string } | { value: FocusInput } {
  const value: FocusInput = {};
  if (!update || b.type != null) {
    if (b.type !== 0 && b.type !== 1) return { error: 'type must be 0 (pomodoro) or 1 (timing)' };
    value.type = b.type;
  }
  if (b.note != null && (typeof b.note !== 'string' || b.note.length > MAX_FOCUS_NOTE)) {
    return { error: 'note must be a string of at most 65536 characters' };
  }
  if (b.note !== undefined) value.note = typeof b.note === 'string' && b.note ? b.note : null;
  if (invalidFocusRelation(b.relationType)) {
    return { error: 'relationType must contain at most 32 integer values' };
  }
  if (Array.isArray(b.relationType)) value.relationType = b.relationType as number[];
  if (b.taskId != null && typeof b.taskId !== 'string') return { error: 'taskId must be a string' };
  if (b.taskId !== undefined) {
    const taskId = typeof b.taskId === 'string' ? b.taskId.trim() : '';
    if (taskId.length > MAX_FOCUS_TASK_ID) return { error: 'taskId is too long' };
    value.taskId = taskId || null;
  }
  for (const key of ['startTime', 'endTime'] as const) {
    if (b[key] == null) continue;
    if (!validFocusDate(b[key])) return { error: `${key} must be a valid ISO 8601 date` };
    value[key] = b[key];
  }
  for (const key of ['duration', 'pauseDuration'] as const) {
    if (b[key] == null) continue;
    const seconds = strictFocusNumber(b[key]);
    if (seconds == null || seconds < 0 || seconds > MAX_FOCUS_SECONDS) {
      return { error: `${key} must be a non-negative number of seconds` };
    }
    value[key] = seconds;
  }
  if (b.added != null) {
    if (typeof b.added !== 'boolean') return { error: 'added must be a boolean' };
    value.added = b.added;
  }
  return { value };
}

/** Whole seconds from start to end (negative when reversed); null unless both parse. */
function focusSpan(startTime: unknown, endTime: unknown): number | null {
  const start = parseApiDate(startTime);
  const end = parseApiDate(endTime);
  return typeof start === 'number' && typeof end === 'number' ? Math.round((end - start) / 1000) : null;
}

/** The focused part of a span: its length minus the pauses. */
const focusedSeconds = (span: number, pause: number | null | undefined) => Math.max(0, span - (pause ?? 0));

misc.get('/focus', async (c) => {
  const userId = c.get('userId');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const type = focusType(c.req.query('type'));
  if (!from || !to || type == null) {
    return c.json({ error: 'from, to and type are required' }, 400);
  }
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!validFocusDate(from) || !validFocusDate(to) || Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return c.json({ error: 'from/to must be valid ISO 8601 dates' }, 400);
  }
  if (toMs < fromMs) return c.json({ error: 'to must not precede from' }, 400);
  if (toMs - fromMs > MAX_FOCUS_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return c.json({ error: `time range must not exceed ${MAX_FOCUS_RANGE_DAYS} days` }, 400);
  }
  // Narrow by day in SQL so the result cap applies to the requested window,
  // not to the user's whole history. A stored time's YYYY-MM-DD prefix is
  // its local day, within a day of its UTC day, so this padded range can
  // only over-include; the exact instant check below decides.
  const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM focus_records WHERE user_id = ? AND type = ? AND start_time >= ? AND start_time < ? ORDER BY start_time ASC LIMIT ?',
  )
    .bind(userId, type, utcDay(fromMs - 86400000), utcDay(toMs + 2 * 86400000), MAX_FOCUS_RESULTS + 1)
    .all();
  if (rows.results.length > MAX_FOCUS_RESULTS) {
    return c.json({ error: `focus result set exceeds ${MAX_FOCUS_RESULTS} records` }, 413);
  }
  const out = rows.results.filter((r) => {
    const t = r.start_time ? Date.parse(String(r.start_time)) : NaN;
    if (Number.isNaN(t)) return false;
    return t >= fromMs && t <= toMs;
  });
  return c.json(out.map(serializeFocus));
});

/**
 * NodeTick extension: focus statistics. `total` covers all time; with
 * `from`/`to` (local days, inclusive, at most 371) the period totals, the
 * days, the tasks and lists and the hour-of-day spread are computed in `tz`
 * (IANA, default UTC). `taskId` narrows everything to one task. One D1 round
 * trip; the period's records are read once more to name their tasks.
 */
misc.get('/focus/stats', async (c) => {
  const userId = c.get('userId');
  const tzRaw = c.req.query('tz');
  const tz = tzRaw ? validTimeZone(tzRaw) : 'UTC';
  if (!tz) return c.json({ error: 'tz must be an IANA time zone such as Asia/Shanghai' }, 400);
  const fromRaw = c.req.query('from') || null;
  const toRaw = c.req.query('to') || null;
  if ((fromRaw == null) !== (toRaw == null)) return c.json({ error: 'from and to must be given together' }, 400);
  const fromDay = parseDay(fromRaw);
  const toDay = parseDay(toRaw);
  if (fromRaw && (fromDay == null || toDay == null)) return c.json({ error: 'from/to must be YYYY-MM-DD dates' }, 400);
  if (fromDay != null && toDay != null) {
    if (toDay < fromDay) return c.json({ error: 'to must not precede from' }, 400);
    if ((toDay - fromDay) / DAY_MS >= MAX_STATS_RANGE_DAYS) {
      return c.json({ error: `range must not exceed ${MAX_STATS_RANGE_DAYS} days` }, 400);
    }
  }
  const taskId = c.req.query('taskId') || null;
  if (taskId && taskId.length > MAX_FOCUS_TASK_ID) return c.json({ error: 'taskId is too long' }, 400);

  const zone = new Zone(tz);
  let window: { fromMs: number; toMs: number; segments: OffsetSegment[] } | null = null;
  if (fromDay != null && toDay != null) {
    const segments = offsetSegments(zone, fromDay - MAX_OFFSET_MS - DAY_MS, toDay + 2 * DAY_MS + MAX_OFFSET_MS);
    window = { fromMs: zonedDayStart(segments, fromDay), toMs: zonedDayStart(segments, toDay + DAY_MS), segments };
  }

  const db = c.env.DB;
  const scope = taskId ? ' AND task_id = ?' : '';
  const scoped = (...args: unknown[]) => (taskId ? [userId, taskId, ...args] : [userId, ...args]);
  const statements = [
    db.prepare(
      `SELECT COUNT(*) AS records,
         COALESCE(SUM(CASE WHEN type = 0 THEN 1 ELSE 0 END), 0) AS pomoCount,
         COALESCE(SUM(CASE WHEN type = 0 AND duration > 0 THEN duration ELSE 0 END), 0) AS pomoSeconds,
         COALESCE(SUM(CASE WHEN type = 1 AND duration > 0 THEN duration ELSE 0 END), 0) AS stopwatchSeconds
       FROM focus_records WHERE user_id = ?${scope}`,
    ).bind(...scoped()),
    // The earliest instant lies within three text days of the smallest start_time.
    db.prepare(
      `SELECT start_time FROM focus_records WHERE user_id = ?${scope} AND start_time < (
         SELECT date(substr(MIN(start_time), 1, 10), '+3 day') FROM focus_records WHERE user_id = ?${scope}
       ) ORDER BY start_time LIMIT 1000`,
    ).bind(...scoped(), ...scoped()),
  ];
  if (window) {
    const lo = textDayBefore(window.fromMs);
    const hi = textDayAfter(window.toMs);
    statements.push(
      db.prepare(
        `SELECT type, start_time, end_time, duration, task_id FROM focus_records
         WHERE user_id = ?${scope} AND start_time >= ? AND start_time < ? LIMIT ?`,
      ).bind(...scoped(lo, hi, MAX_STATS_RECORDS + 1)),
      db.prepare(
        `SELECT id, title, project_id FROM tasks WHERE user_id = ? AND id IN (
           SELECT task_id FROM focus_records WHERE user_id = ?${scope} AND start_time >= ? AND start_time < ? AND task_id IS NOT NULL
         )`,
      ).bind(userId, ...scoped(lo, hi)),
    );
  }
  const [totals, firsts, records, tasks] = await db.batch<Record<string, unknown>>(statements);
  if (records && records.results.length > MAX_STATS_RECORDS) {
    return c.json({ error: `focus result set exceeds ${MAX_STATS_RECORDS} records` }, 413);
  }
  const sums = totals.results[0] ?? {};
  const pomoSeconds = Number(sums.pomoSeconds ?? 0);
  const stopwatchSeconds = Number(sums.stopwatchSeconds ?? 0);
  const aggregate = window
    ? aggregateFocus(
      records.results as unknown as FocusStatsRow[],
      tasks.results as unknown as FocusTaskRow[],
      window.fromMs,
      window.toMs,
      window.segments,
    )
    : null;
  return c.json({
    tz,
    from: fromRaw,
    to: toRaw,
    taskId,
    total: {
      pomoCount: Number(sums.pomoCount ?? 0),
      pomoSeconds,
      stopwatchSeconds,
      seconds: pomoSeconds + stopwatchSeconds,
      records: Number(sums.records ?? 0),
      firstDay: firstLocalDay(firsts.results.map((row) => row.start_time), zone),
    },
    period: aggregate?.period ?? null,
    days: aggregate?.days ?? [],
    byTask: aggregate?.byTask ?? [],
    byProject: aggregate?.byProject ?? [],
    byHour: aggregate?.byHour ?? [],
  });
});

/**
 * NodeTick extension: the whole history of both record types, newest first
 * by instant, `limit` (at most 100) at a time. Pass the previous page's
 * `nextBefore` as `before`; it is null after the oldest record.
 */
misc.get('/focus/history', async (c) => {
  const userId = c.get('userId');
  const beforeRaw = c.req.query('before') || null;
  if (beforeRaw && !validFocusDate(beforeRaw)) return c.json({ error: 'before must be a valid ISO 8601 date' }, 400);
  const before = beforeRaw ? (parseApiDate(beforeRaw) as number) : Number.POSITIVE_INFINITY;
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    return c.json({ error: `limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}` }, 400);
  }
  const fetched = limit + HISTORY_SLACK;
  const rows = Number.isFinite(before)
    ? await c.env.DB.prepare('SELECT * FROM focus_records WHERE user_id = ? AND start_time < ? ORDER BY start_time DESC LIMIT ?')
      .bind(userId, historyTextBound(before), fetched)
      .all()
    : await c.env.DB.prepare('SELECT * FROM focus_records WHERE user_id = ? AND start_time IS NOT NULL ORDER BY start_time DESC LIMIT ?')
      .bind(userId, fetched)
      .all();
  const page = historyPage(rows.results, before, limit, fetched);
  return c.json({
    records: page.records.map(serializeFocus),
    nextBefore: page.nextBefore == null ? null : new Date(page.nextBefore).toISOString(),
  });
});

misc.get('/focus/:focusId', async (c) => {
  const userId = c.get('userId');
  const type = focusType(c.req.query('type'));
  if (type == null) return c.json({ error: 'type is required' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT * FROM focus_records WHERE id = ? AND type = ? AND user_id = ?',
  )
    .bind(c.req.param('focusId'), type, userId)
    .first();
  if (!row) return c.json({ error: 'focus record not found' }, 404);
  return c.json(serializeFocus(row));
});

misc.post('/focus', async (c) => {
  const userId = c.get('userId');
  const parsed = focusInput(await readJsonObject(c.req), false);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  if (input.taskId) {
    const task = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?')
      .bind(input.taskId, userId)
      .first();
    if (!task) return c.json({ error: 'task not found' }, 404);
  }
  const span = focusSpan(input.startTime, input.endTime);
  if (span != null && span < 0) return c.json({ error: 'endTime must not precede startTime' }, 400);
  const duration = input.duration ?? (span != null && span > 0 ? focusedSeconds(span, input.pauseDuration) : null);
  if (duration != null && duration > MAX_FOCUS_SECONDS) {
    return c.json({ error: 'duration is too long' }, 400);
  }
  const row = await c.env.DB.prepare(
    `INSERT INTO focus_records
      (id, user_id, type, task_id, note, start_time, end_time, duration, pause_duration, relation, added, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      genId(),
      userId,
      input.type,
      input.taskId ?? null,
      input.note ?? null,
      input.startTime ?? null,
      input.endTime ?? null,
      duration,
      input.pauseDuration ?? null,
      input.relationType ? JSON.stringify(input.relationType) : null,
      input.added ? 1 : 0,
      Date.now(),
    )
    .first();
  return c.json(serializeFocus(row!));
});

/**
 * Update a record: the TickTick Open API's POST /focus/{focusId}
 * (ticktick-cli `focus update`), whose `type` must match the record's when
 * given. Same validation as create; new times or pauses recompute the
 * duration unless the body sets one.
 */
misc.post('/focus/:focusId', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('focusId');
  const parsed = focusInput(await readJsonObject(c.req), true);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const input = parsed.value;
  const db = c.env.DB;
  const [found, task] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM focus_records WHERE id = ? AND user_id = ?').bind(id, userId),
    ...(input.taskId ? [db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(input.taskId, userId)] : []),
  ]);
  const existing = found.results[0];
  if (!existing || (input.type != null && Number(existing.type) !== input.type)) {
    return c.json({ error: 'focus record not found' }, 404);
  }
  if (input.taskId && !task.results.length) return c.json({ error: 'task not found' }, 404);
  const startTime = input.startTime ?? (existing.start_time == null ? null : String(existing.start_time));
  const endTime = input.endTime ?? (existing.end_time == null ? null : String(existing.end_time));
  const span = focusSpan(startTime, endTime);
  if (span != null && span < 0) return c.json({ error: 'endTime must not precede startTime' }, 400);
  const pauseDuration = input.pauseDuration ?? (existing.pause_duration == null ? null : Number(existing.pause_duration));
  const retimed = input.startTime != null || input.endTime != null || input.pauseDuration != null;
  const duration = input.duration
    ?? (retimed && span != null && span > 0
      ? focusedSeconds(span, pauseDuration)
      : existing.duration == null ? null : Number(existing.duration));
  if (duration != null && duration > MAX_FOCUS_SECONDS) return c.json({ error: 'duration is too long' }, 400);
  const row = await db.prepare(
    `UPDATE focus_records SET task_id = ?, note = ?, start_time = ?, end_time = ?, duration = ?,
       pause_duration = ?, relation = ?, added = ?, etag = etag + 1
     WHERE id = ? AND user_id = ?
     RETURNING *`,
  )
    .bind(
      input.taskId !== undefined ? input.taskId : existing.task_id ?? null,
      input.note !== undefined ? input.note : existing.note ?? null,
      startTime,
      endTime,
      duration,
      pauseDuration,
      input.relationType ? JSON.stringify(input.relationType) : existing.relation ?? null,
      input.added != null ? (input.added ? 1 : 0) : existing.added ?? 0,
      id,
      userId,
    )
    .first();
  if (!row) return c.json({ error: 'focus record not found' }, 404);
  return c.json(serializeFocus(row));
});

misc.delete('/focus/:focusId', async (c) => {
  const userId = c.get('userId');
  const type = focusType(c.req.query('type'));
  if (type == null) return c.json({ error: 'type is required' }, 400);
  const row = await c.env.DB.prepare(
    'DELETE FROM focus_records WHERE id = ? AND type = ? AND user_id = ? RETURNING *',
  )
    .bind(c.req.param('focusId'), type, userId)
    .first();
  if (!row) return c.json({ error: 'focus record not found' }, 404);
  return c.json(serializeFocus(row));
});

// --- Countdowns ---
// List mirrors the official Open API; create/update/delete are NodeTick
// extensions (the official API is read-only here).

misc.get('/countdown', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM countdowns WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC',
  )
    .bind(userId)
    .all();
  return c.json(rows.results.map(serializeCountdown));
});

misc.post('/countdown', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const parsed = countdownInput(b);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const value = parsed.value;
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `INSERT INTO countdowns (
      id, user_id, name, date, kind, reminders, repeat_flag, calculation,
      display_mode, style, color, icon, sort_order, created_at,
      note, pinned, archived, archived_at, reminder_time, lunar, number_format, show_in_calendar
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`,
  )
    .bind(
      genId(), userId, value.name, value.date, value.kind ?? 'countdown',
      JSON.stringify(value.reminders ?? []), value.repeatFlag,
      value.calculation ?? 'standard', value.displayMode ?? 'on-day',
      value.style ?? 0, value.color ?? '#4772FA', value.icon,
      value.sortOrder ?? 0, now,
      value.note ?? '', value.pinned ?? 0, value.archived ?? 0, value.archived ? now : null,
      value.reminderTime, value.lunar ?? 0, value.numberFormat ?? 'days', value.showInCalendar ?? 1,
    )
    .first();
  return c.json(serializeCountdown(row!));
});

misc.post('/countdown/:countdownId', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const parsed = countdownInput(b, true);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const value = parsed.value;
  // Absent fields keep their value. A row still carrying a legacy sort order
  // (-1e9 pinned, >= 1e9 archived, see serializeCountdown) gets the real
  // flags and sort order 0 on this save, unless the request sets them.
  const row = await c.env.DB.prepare(
    `UPDATE countdowns SET
      name = COALESCE(?1, name), date = COALESCE(?2, date), kind = COALESCE(?3, kind),
      reminders = COALESCE(?4, reminders), repeat_flag = CASE WHEN ?5 THEN ?6 ELSE repeat_flag END,
      calculation = COALESCE(?7, calculation), display_mode = COALESCE(?8, display_mode),
      style = COALESCE(?9, style), color = COALESCE(?10, color),
      icon = CASE WHEN ?11 THEN ?12 ELSE icon END,
      note = COALESCE(?13, note),
      reminder_time = CASE WHEN ?14 THEN ?15 ELSE reminder_time END,
      lunar = COALESCE(?16, lunar), number_format = COALESCE(?17, number_format),
      show_in_calendar = COALESCE(?18, show_in_calendar),
      pinned = COALESCE(?19, CASE WHEN ?21 IS NULL AND sort_order <= -1000000000 THEN 1 ELSE pinned END),
      archived = COALESCE(?20, CASE WHEN ?21 IS NULL AND sort_order >= 1000000000 THEN 1 ELSE archived END),
      archived_at = CASE
        WHEN ?20 IS NULL THEN CASE WHEN ?21 IS NULL AND sort_order >= 1000000000 THEN COALESCE(archived_at, ?22) ELSE archived_at END
        WHEN ?20 = 1 THEN CASE WHEN archived = 1 OR sort_order >= 1000000000 THEN COALESCE(archived_at, ?22) ELSE ?22 END
        ELSE NULL END,
      sort_order = COALESCE(?21, CASE WHEN sort_order <= -1000000000 OR sort_order >= 1000000000 THEN 0 ELSE sort_order END)
      WHERE id = ?23 AND user_id = ?24
      RETURNING *`,
  )
    .bind(
      value.name, value.date, value.kind,
      value.reminders ? JSON.stringify(value.reminders) : null,
      Object.hasOwn(b, 'repeatFlag') ? 1 : 0, value.repeatFlag,
      value.calculation, value.displayMode, value.style, value.color,
      Object.hasOwn(b, 'icon') ? 1 : 0, value.icon,
      value.note,
      Object.hasOwn(b, 'reminderTime') ? 1 : 0, value.reminderTime,
      value.lunar, value.numberFormat, value.showInCalendar,
      value.pinned, value.archived, value.sortOrder, Date.now(),
      c.req.param('countdownId'),
      userId,
    )
    .first();
  if (!row) return c.json({ error: 'countdown not found' }, 404);
  return c.json(serializeCountdown(row));
});

misc.delete('/countdown/:countdownId', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB.prepare('DELETE FROM countdowns WHERE id = ? AND user_id = ?')
    .bind(c.req.param('countdownId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'countdown not found' }, 404);
  return c.body(null, 200);
});

// --- Backup ---
// NodeTick extension: the same full-account JSON backup the web UI serves,
// exposed to token-authenticated API clients (the CLI).

misc.get('/backup/export', async (c) => {
  return c.json(await exportBackup(c.env, c.get('userId')));
});

misc.post('/backup/import', async (c) => {
  let parsed: unknown;
  try {
    parsed = await c.req.json<unknown>();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || isRequestBodyTooLarge(c.req)) throw error;
    return c.json({ error: 'expected a NodeTick backup JSON object' }, 400);
  }
  try {
    return c.json(await importBackup(c.env, c.get('userId'), parsed));
  } catch (error) {
    if (error instanceof BackupImportError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});
