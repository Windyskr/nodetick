import { Hono } from 'hono';
import { Env, Vars } from '../env.js';
import {
  serializeCheckin,
  serializeCountdown,
  serializeFocus,
  serializeFilter,
  serializeHabit,
  serializeHabitRecord,
  serializeTag,
} from '../serialize.js';
import { genId, nowIso, readJsonObject } from '../util.js';

type State = { Bindings: Env; Variables: Vars };

export const misc = new Hono<State>();

const MAX_HABIT_NAME = 256;
const MAX_HABIT_IDS = 100;
const MAX_CHECKIN_RANGE_DAYS = 366;
const MAX_REMINDERS = 100;
const MAX_REMINDER_LENGTH = 512;
const MAX_HABIT_RECORD_CONTENT = 8192;
const MAX_FOCUS_NOTE = 64 * 1024;
const MAX_FOCUS_RESULTS = 5000;
const MAX_RELATION_TYPES = 32;
const MAX_COUNTDOWN_NAME = 128;
const MAX_COUNTDOWN_DATE = 32;
const MAX_FOCUS_SECONDS = 366 * 24 * 60 * 60;
const MAX_FILTER_NAME = 128;
const MAX_FILTER_VALUES = 100;
const MAX_FILTER_VALUE_LENGTH = 128;
const MAX_FILTER_DATE_LENGTH = 10;

function invalidStringArray(value: unknown, maxItems: number, maxItemLength: number): boolean {
  return Array.isArray(value) && (value.length > maxItems || value.some((item) => String(item).length > maxItemLength));
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

function invalidFiniteNumber(value: unknown): boolean {
  return value != null && value !== '' && !Number.isFinite(Number(value));
}

function invalidText(value: unknown, maxLength: number): boolean {
  return value != null && String(value).length > maxLength;
}

function invalidNumericArray(value: unknown, maxItems: number): boolean {
  return Array.isArray(value) && (
    value.length > maxItems || value.some((item) => item == null || item === '' || !Number.isInteger(Number(item)))
  );
}

type FilterValue = {
  logic: 'and' | 'or';
  dateMode: 'any' | 'today' | 'tomorrow' | 'week' | 'overdue' | 'custom';
  dateStart: string | null;
  dateEnd: string | null;
  projectIds: string[];
  tags: string[];
  priorities: number[];
  statuses: number[];
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
  if (!['any', 'today', 'tomorrow', 'week', 'overdue', 'custom'].includes(dateMode)) {
    return { error: 'dateMode is invalid' };
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
  const out = [];
  for (const habitId of habitIds) {
    const rows = await c.env.DB.prepare(
      'SELECT * FROM habit_checkins WHERE habit_id = ? AND user_id = ? AND stamp BETWEEN ? AND ? ORDER BY stamp ASC',
    )
      .bind(habitId, userId, from, to)
      .all();
    out.push({ habitId, year, checkins: rows.results.map(serializeCheckin) });
  }
  return c.json(out);
});

misc.get('/habit/:habitId/records', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .bind(habitId, userId)
    .first();
  if (!habit) return c.json({ error: 'habit not found' }, 404);

  const from = validStamp(c.req.query('from'));
  const to = validStamp(c.req.query('to'));
  if (from == null || to == null) {
    return c.json({ error: 'from and to are required (YYYYMMDD stamps)' }, 400);
  }
  if (to < from || stampDay(to) - stampDay(from) > MAX_CHECKIN_RANGE_DAYS) {
    return c.json({ error: `record range must not exceed ${MAX_CHECKIN_RANGE_DAYS} days` }, 400);
  }
  const rows = await c.env.DB.prepare(
    'SELECT * FROM habit_records WHERE habit_id = ? AND user_id = ? AND stamp BETWEEN ? AND ? ORDER BY stamp ASC',
  )
    .bind(habitId, userId, from, to)
    .all();
  return c.json(rows.results.map(serializeHabitRecord));
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
  const name = String(b.name ?? '').trim();
  if (!name || name.length > MAX_HABIT_NAME) return c.json({ error: `name is required (max ${MAX_HABIT_NAME} chars)` }, 400);
  if (invalidStringArray(b.reminders, MAX_REMINDERS, MAX_REMINDER_LENGTH)) {
    return c.json({ error: 'reminders contains too many or too-long values' }, 413);
  }
  if ([b.sortOrder, b.status, b.goal, b.step, b.style].some(invalidFiniteNumber)) {
    return c.json({ error: 'numeric habit fields must be finite numbers' }, 400);
  }
  const id = genId();
  await c.env.DB.prepare(
    `INSERT INTO habits
      (id, user_id, name, icon_res, color, sort_order, status, encouragement, type, goal, step,
       unit, repeat_rule, reminders, section_id, style, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
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
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
  return c.json(serializeHabit(row!));
});

misc.post('/habit/:habitId', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  if (b.name != null && (!String(b.name).trim() || String(b.name).trim().length > MAX_HABIT_NAME)) {
    return c.json({ error: `name must be 1-${MAX_HABIT_NAME} chars` }, 400);
  }
  if (invalidStringArray(b.reminders, MAX_REMINDERS, MAX_REMINDER_LENGTH)) {
    return c.json({ error: 'reminders contains too many or too-long values' }, 413);
  }
  if ([b.sortOrder, b.status, b.goal, b.step, b.style].some(invalidFiniteNumber)) {
    return c.json({ error: 'numeric habit fields must be finite numbers' }, 400);
  }
  const res = await c.env.DB.prepare(
    `UPDATE habits SET
       name = COALESCE(?, name), icon_res = COALESCE(?, icon_res), color = COALESCE(?, color),
       sort_order = COALESCE(?, sort_order), status = COALESCE(?, status),
       encouragement = COALESCE(?, encouragement), type = COALESCE(?, type),
       goal = COALESCE(?, goal), step = COALESCE(?, step), unit = COALESCE(?, unit),
       repeat_rule = COALESCE(?, repeat_rule), reminders = COALESCE(?, reminders),
       section_id = COALESCE(?, section_id), style = COALESCE(?, style), etag = etag + 1
     WHERE id = ? AND user_id = ?`,
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
    .run();
  if (!res.meta.changes) return c.json({ error: 'habit not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?')
    .bind(c.req.param('habitId'), userId)
    .first();
  return c.json(serializeHabit(row!));
});

misc.post('/habit/:habitId/checkin', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .bind(habitId, userId)
    .first();
  if (!habit) return c.json({ error: 'habit not found' }, 404);

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

  await c.env.DB.prepare(
    `INSERT INTO habit_checkins (id, user_id, habit_id, stamp, value, goal, status, time, op_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    )
    .run();

  const year = Math.floor(stamp / 10000);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM habit_checkins WHERE habit_id = ? AND user_id = ? AND CAST(stamp / 10000 AS INTEGER) = ? ORDER BY stamp ASC",
  )
    .bind(habitId, userId, year)
    .all();
  return c.json({ habitId, year, checkins: rows.results.map(serializeCheckin) });
});

misc.post('/habit/:habitId/record', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('habitId');
  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .bind(habitId, userId)
    .first();
  if (!habit) return c.json({ error: 'habit not found' }, 404);

  const b = await readJsonObject(c.req);
  const stamp = validStamp(b.stamp);
  if (stamp == null || typeof b.content !== 'string' || b.content.length > MAX_HABIT_RECORD_CONTENT) {
    return c.json({ error: `stamp must be YYYYMMDD and content must be a string of at most ${MAX_HABIT_RECORD_CONTENT} characters` }, 400);
  }
  const emoji = b.emoji === undefined ? 50 : b.emoji;
  if (typeof emoji !== 'number' || !Number.isInteger(emoji) || emoji < 0 || emoji > 100) {
    return c.json({ error: 'emoji must be an integer between 0 and 100' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO habit_records (id, user_id, habit_id, stamp, content, emoji, op_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(habit_id, stamp) DO UPDATE SET
       content = excluded.content,
       emoji = excluded.emoji,
       op_time = excluded.op_time`,
  )
    .bind(genId(), userId, habitId, stamp, b.content, emoji, nowIso(), Date.now())
    .run();

  const row = await c.env.DB.prepare(
    'SELECT * FROM habit_records WHERE habit_id = ? AND user_id = ? AND stamp = ?',
  )
    .bind(habitId, userId, stamp)
    .first();
  return c.json(serializeHabitRecord(row!));
});

// --- Focus records ---

const MAX_FOCUS_RANGE_DAYS = 30;

misc.get('/focus', async (c) => {
  const userId = c.get('userId');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const type = Number(c.req.query('type'));
  if (!from || !to || !Number.isInteger(type) || (type !== 0 && type !== 1)) {
    return c.json({ error: 'from, to and type are required' }, 400);
  }
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return c.json({ error: 'from/to must be valid ISO 8601 dates' }, 400);
  }
  if (toMs < fromMs) return c.json({ error: 'to must not precede from' }, 400);
  if (toMs - fromMs > MAX_FOCUS_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return c.json({ error: `time range must not exceed ${MAX_FOCUS_RANGE_DAYS} days` }, 400);
  }
  const rows = await c.env.DB.prepare(
    'SELECT * FROM focus_records WHERE user_id = ? AND type = ? AND start_time IS NOT NULL ORDER BY start_time ASC LIMIT ?',
  )
    .bind(userId, type, MAX_FOCUS_RESULTS + 1)
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

misc.get('/focus/:focusId', async (c) => {
  const userId = c.get('userId');
  const type = Number(c.req.query('type'));
  if (!Number.isInteger(type) || (type !== 0 && type !== 1)) return c.json({ error: 'type is required' }, 400);
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
  const b = await readJsonObject(c.req);
  const type = Number(b.type);
  if (type !== 0 && type !== 1) return c.json({ error: 'type must be 0 (pomodoro) or 1 (timing)' }, 400);
  if (b.note != null && String(b.note).length > MAX_FOCUS_NOTE) {
    return c.json({ error: 'note is too long' }, 400);
  }
  if (invalidNumericArray(b.relationType, MAX_RELATION_TYPES)) {
    return c.json({ error: 'relationType must contain at most 32 integer values' }, 400);
  }
  const taskId = b.taskId != null && String(b.taskId).trim() ? String(b.taskId).trim() : null;
  if (taskId) {
    const task = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?')
      .bind(taskId, userId)
      .first();
    if (!task) return c.json({ error: 'task not found' }, 404);
  }
  for (const key of ['startTime', 'endTime'] as const) {
    if (b[key] != null && (String(b[key]).length > 64 || Number.isNaN(Date.parse(String(b[key]))))) {
      return c.json({ error: `${key} must be a valid ISO 8601 date` }, 400);
    }
  }
  const pauseDuration = finiteNumber(b.pauseDuration);
  if (b.pauseDuration != null && (pauseDuration == null || pauseDuration < 0 || pauseDuration > MAX_FOCUS_SECONDS)) {
    return c.json({ error: 'pauseDuration must be a non-negative number' }, 400);
  }
  const id = genId();
  let duration = finiteNumber(b.duration);
  if (b.duration != null && (duration == null || duration < 0 || duration > MAX_FOCUS_SECONDS)) {
    return c.json({ error: 'duration must be a non-negative number' }, 400);
  }
  if (duration == null && b.startTime && b.endTime) {
    const startMs = Date.parse(String(b.startTime));
    const endMs = Date.parse(String(b.endTime));
    if (endMs < startMs) return c.json({ error: 'endTime must not precede startTime' }, 400);
    const ms = endMs - startMs;
    if (!Number.isNaN(ms) && ms > 0) duration = Math.round(ms / 1000);
  }
  if (duration != null && duration > MAX_FOCUS_SECONDS) {
    return c.json({ error: 'duration is too long' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO focus_records
      (id, user_id, type, task_id, note, start_time, end_time, duration, pause_duration, relation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      type,
      taskId,
      b.note != null ? String(b.note) : null,
      b.startTime != null ? String(b.startTime) : null,
      b.endTime != null ? String(b.endTime) : null,
      duration,
      pauseDuration,
      Array.isArray(b.relationType) ? JSON.stringify(b.relationType.map(Number)) : null,
      Date.now(),
    )
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM focus_records WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
  return c.json(serializeFocus(row!));
});

misc.delete('/focus/:focusId', async (c) => {
  const userId = c.get('userId');
  const type = Number(c.req.query('type'));
  if (!Number.isInteger(type) || (type !== 0 && type !== 1)) return c.json({ error: 'type is required' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT * FROM focus_records WHERE id = ? AND type = ? AND user_id = ?',
  )
    .bind(c.req.param('focusId'), type, userId)
    .first();
  if (!row) return c.json({ error: 'focus record not found' }, 404);
  await c.env.DB.prepare('DELETE FROM focus_records WHERE id = ? AND user_id = ?')
    .bind(c.req.param('focusId'), userId)
    .run();
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
  const name = String(b.name ?? '').trim();
  const date = String(b.date ?? '').trim();
  if (!name || name.length > MAX_COUNTDOWN_NAME) return c.json({ error: `name is required (max ${MAX_COUNTDOWN_NAME} chars)` }, 400);
  if (!date || date.length > MAX_COUNTDOWN_DATE) return c.json({ error: `date is required (max ${MAX_COUNTDOWN_DATE} chars)` }, 400);
  const sortOrder = finiteNumber(b.sortOrder, 0);
  if (sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const id = genId();
  await c.env.DB.prepare(
    'INSERT INTO countdowns (id, user_id, name, date, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, name, date, sortOrder, Date.now())
    .run();
  const row = await c.env.DB.prepare('SELECT * FROM countdowns WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
  return c.json(serializeCountdown(row!));
});

misc.post('/countdown/:countdownId', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  if (b.name != null && (!String(b.name).trim() || String(b.name).trim().length > MAX_COUNTDOWN_NAME)) {
    return c.json({ error: `name must be 1-${MAX_COUNTDOWN_NAME} chars` }, 400);
  }
  if (b.date != null && (!String(b.date).trim() || String(b.date).trim().length > MAX_COUNTDOWN_DATE)) {
    return c.json({ error: `date must be 1-${MAX_COUNTDOWN_DATE} chars` }, 400);
  }
  const sortOrder = finiteNumber(b.sortOrder);
  if (b.sortOrder != null && sortOrder == null) return c.json({ error: 'sortOrder must be a finite number' }, 400);
  const res = await c.env.DB.prepare(
    'UPDATE countdowns SET name = COALESCE(?, name), date = COALESCE(?, date), sort_order = COALESCE(?, sort_order) WHERE id = ? AND user_id = ?',
  )
    .bind(
      b.name != null ? String(b.name) : null,
      b.date != null ? String(b.date) : null,
      sortOrder,
      c.req.param('countdownId'),
      userId,
    )
    .run();
  if (!res.meta.changes) return c.json({ error: 'countdown not found' }, 404);
  const row = await c.env.DB.prepare('SELECT * FROM countdowns WHERE id = ? AND user_id = ?')
    .bind(c.req.param('countdownId'), userId)
    .first();
  return c.json(serializeCountdown(row!));
});

misc.delete('/countdown/:countdownId', async (c) => {
  const userId = c.get('userId');
  const res = await c.env.DB.prepare('DELETE FROM countdowns WHERE id = ? AND user_id = ?')
    .bind(c.req.param('countdownId'), userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'countdown not found' }, 404);
  return c.body(null, 200);
});
