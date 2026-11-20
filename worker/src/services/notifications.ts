import {
  buildPushPayload,
  type PushSubscription,
  type VapidKeys,
} from '@block65/webcrypto-web-push';
import type { Env } from '../env.js';
import { ensureSchema } from '../db.js';
import { daysInMonth, genId, parseJsonArray } from '../util.js';

/** Languages a push subscription can receive (the device's UI language). */
export type PushLang = 'zh' | 'en';
/** User content (task names) stays a plain string; app copy carries both languages. */
export type Localized = string | Readonly<Record<PushLang, string>>;

/** App-provided notification copy, picked per device by the subscription's language. */
export const NOTIFICATION_TEXT = {
  taskDue: { zh: '任务到时间了', en: 'Task is due now' },
  taskSoon: { zh: '任务即将开始', en: 'Task starts soon' },
  habitPending: { zh: '今天还没有打卡', en: "You haven't checked in today" },
  countdownToday: { zh: '今天', en: 'Today' },
  countdownSoon: { zh: '还有 3 天', en: '3 days to go' },
  testTitle: { zh: 'NodeTick 通知测试', en: 'NodeTick test notification' },
  testBody: { zh: '通知功能已经连接成功。', en: 'Notifications are working.' },
} as const;

export function pushLang(value: unknown): PushLang {
  return value === 'en' ? 'en' : 'zh';
}

/** The payload a given device receives: title/body resolved to its language. */
export function localizedPayload(payload: NotificationPayload, lang: PushLang) {
  const pick = (value: Localized) => (typeof value === 'string' ? value : value[lang]);
  return { ...payload, title: pick(payload.title), body: pick(payload.body) };
}

export interface NotificationPayload {
  title: Localized;
  body: Localized;
  tag: string;
  url: string;
  sourceType: 'task' | 'habit' | 'countdown' | 'test';
  sourceId: string;
  sound?: 'on' | 'off';
}

interface Candidate extends NotificationPayload {
  userId: string;
  scheduledAt: number;
  dedupeKey: string;
}

type SettingRow = {
  user_id: string;
  enabled: number;
  task_enabled: number;
  habit_enabled: number;
  countdown_enabled: number;
  sound_enabled: number;
  timezone: string;
  all_day_time: string;
};

const LOOKBACK_MS = 10 * 60 * 1000;
const LOOKAHEAD_MS = 45 * 1000;

export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim() && env.VAPID_SUBJECT?.trim());
}

function validTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return value;
  } catch {
    return 'UTC';
  }
}

export function localParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

/** Convert a wall-clock date/time in an IANA zone to a UTC timestamp. */
export function zonedTimestamp(day: string, time: string, timeZone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) return null;
  const wanted = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]));
  let guess = wanted;
  for (let index = 0; index < 2; index += 1) {
    const shown = localParts(new Date(guess), timeZone);
    const represented = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    guess += wanted - represented;
  }
  return guess;
}

function localDay(now: Date, timeZone: string): string {
  const part = localParts(now, timeZone);
  return `${part.year}-${String(part.month).padStart(2, '0')}-${String(part.day).padStart(2, '0')}`;
}

function parseAnchor(value: unknown, timeZone: string, allDayTime: string, allDay = false): number | null {
  if (typeof value !== 'string' || !value) return null;
  // All-day dates keep the calendar day in their YYYY-MM-DD prefix (the
  // webapp stores `<day>T00:00:00+0000`), so they fire at the user's all-day
  // time on that day in their zone, not at the literal UTC-midnight instant.
  const day = allDay ? /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] : undefined;
  if (day) return zonedTimestamp(day, allDayTime, timeZone);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return zonedTimestamp(value, allDayTime, timeZone);
  const direct = Date.parse(value);
  if (!Number.isNaN(direct) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return direct;
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return local ? zonedTimestamp(local[1], local[2], timeZone) : (Number.isNaN(direct) ? null : direct);
}

function reminderOffset(value: string): number | null {
  // "-PT15M" / "-P1DT2H" fire before the anchor; TickTick's on-time trigger
  // is "PT0S". Other positive (after-the-anchor) offsets are not supported.
  const match = /^TRIGGER:(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const offset = (Number(match[2] ?? 0) * 86400 + Number(match[3] ?? 0) * 3600 +
    Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0)) * 1000;
  return match[1] || offset === 0 ? offset : null;
}

function dueNow(timestamp: number, now: number): boolean {
  return timestamp >= now - LOOKBACK_MS && timestamp <= now + LOOKAHEAD_MS;
}

function dayStamp(day: string): number {
  return Number(day.replaceAll('-', ''));
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** A repeat's occurrence in a month, clamped to its last day (31st → Feb 28/29, Feb 29 → Feb 28). */
function occurrenceIn(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

/**
 * Whether a countdown dated `date` (YYYY-MM-DD) falls on `day`. Yearly and
 * monthly repeats recur from the original date onwards; days that a short
 * month lacks fall on that month's last day instead of being skipped.
 */
export function countdownFallsOn(date: string, repeat: unknown, day: string): boolean {
  if (day < date) return false;
  if (repeat !== 'yearly' && repeat !== 'monthly') return day === date;
  const year = Number(day.slice(0, 4));
  const month = repeat === 'yearly' ? Number(date.slice(5, 7)) : Number(day.slice(5, 7));
  return day === occurrenceIn(year, month, Number(date.slice(8, 10)));
}

async function settings(db: D1Database): Promise<SettingRow[]> {
  const rows = await db.prepare(
    `SELECT u.id AS user_id,
       COALESCE(s.enabled, 1) AS enabled,
       COALESCE(s.task_enabled, 1) AS task_enabled,
       COALESCE(s.habit_enabled, 1) AS habit_enabled,
       COALESCE(s.countdown_enabled, 1) AS countdown_enabled,
       COALESCE(s.sound_enabled, 1) AS sound_enabled,
       COALESCE(s.timezone, 'UTC') AS timezone,
       COALESCE(s.all_day_time, '09:00') AS all_day_time
     FROM users u JOIN push_subscriptions p ON p.user_id = u.id
     LEFT JOIN notification_settings s ON s.user_id = u.id
     GROUP BY u.id`,
  ).all<SettingRow>();
  return rows.results;
}

async function taskCandidates(db: D1Database, setting: SettingRow, now: number): Promise<Candidate[]> {
  if (!setting.task_enabled) return [];
  // Runs every minute: the partial index holds only active tasks with
  // reminders, so completed and plain tasks are never read (D1 bills rows read).
  const rows = await db.prepare(
    `SELECT id, title, start_date, due_date, is_all_day, reminders FROM tasks INDEXED BY idx_tasks_reminders
     WHERE user_id = ? AND reminders IS NOT NULL AND status = 0 AND deleted = 0
       AND (due_date IS NOT NULL OR start_date IS NOT NULL)`,
  ).bind(setting.user_id).all<Record<string, unknown>>();
  const out: Candidate[] = [];
  for (const row of rows.results) {
    // A ranged task fires at its start; due_date is the fallback for tasks
    // that only have a deadline.
    const anchor = parseAnchor(
      row.start_date ?? row.due_date, setting.timezone, setting.all_day_time, Number(row.is_all_day ?? 0) === 1,
    );
    if (anchor == null) continue;
    for (const reminder of parseJsonArray<string>(String(row.reminders ?? '[]'))) {
      const offset = reminderOffset(reminder);
      if (offset == null) continue;
      const scheduledAt = anchor - offset;
      if (!dueNow(scheduledAt, now)) continue;
      const id = String(row.id);
      out.push({
        userId: setting.user_id, scheduledAt,
        dedupeKey: `task:${id}:${reminder}:${scheduledAt}`,
        sourceType: 'task', sourceId: id, tag: `task-${id}`,
        title: String(row.title), body: offset === 0 ? NOTIFICATION_TEXT.taskDue : NOTIFICATION_TEXT.taskSoon,
        url: `/app/tasks/all?task=${encodeURIComponent(id)}`,
        sound: setting.sound_enabled ? 'on' : 'off',
      });
    }
  }
  return out;
}

async function habitCandidates(db: D1Database, setting: SettingRow, now: number): Promise<Candidate[]> {
  if (!setting.habit_enabled) return [];
  const today = localDay(new Date(now), validTimeZone(setting.timezone));
  const stamp = dayStamp(today);
  const rows = await db.prepare(
    `SELECT h.id, h.name, h.reminders FROM habits h
     WHERE h.user_id = ? AND h.status = 0 AND h.reminders IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM habit_checkins c WHERE c.user_id = h.user_id AND c.habit_id = h.id
           AND c.stamp = ? AND c.status = 2
       )`,
  ).bind(setting.user_id, stamp).all<Record<string, unknown>>();
  const out: Candidate[] = [];
  for (const row of rows.results) {
    for (const reminder of parseJsonArray<string>(String(row.reminders ?? '[]'))) {
      const match = /^(\d{2}):(\d{2})$/.exec(reminder);
      if (!match) continue;
      const scheduledAt = zonedTimestamp(today, reminder, setting.timezone);
      if (scheduledAt == null || !dueNow(scheduledAt, now)) continue;
      const id = String(row.id);
      out.push({
        userId: setting.user_id, scheduledAt,
        dedupeKey: `habit:${id}:${today}:${reminder}`,
        sourceType: 'habit', sourceId: id, tag: `habit-${id}-${today}`,
        title: String(row.name), body: NOTIFICATION_TEXT.habitPending, url: '/app/habit',
        sound: setting.sound_enabled ? 'on' : 'off',
      });
    }
  }
  return out;
}

async function countdownCandidates(db: D1Database, setting: SettingRow, now: number): Promise<Candidate[]> {
  if (!setting.countdown_enabled) return [];
  const today = localDay(new Date(now), validTimeZone(setting.timezone));
  const rows = await db.prepare(
    `SELECT id, name, date, reminders, repeat_flag FROM countdowns WHERE user_id = ? AND reminders != '[]'`,
  ).bind(setting.user_id).all<Record<string, unknown>>();
  const out: Candidate[] = [];
  for (const row of rows.results) {
    const eventDay = String(row.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDay)) continue;
    for (const reminder of parseJsonArray<string>(String(row.reminders ?? '[]'))) {
      const lead = reminder === 'same-day' ? 0 : reminder === '3-days' ? 3 : null;
      // Match the day the reminder points at (today + lead), so a Jan 2 event
      // is announced on Dec 30 and a monthly 31st still fires in short months.
      if (lead == null || !countdownFallsOn(eventDay, row.repeat_flag, addDays(today, lead))) continue;
      const scheduledAt = zonedTimestamp(today, setting.all_day_time, setting.timezone);
      if (scheduledAt == null || !dueNow(scheduledAt, now)) continue;
      const id = String(row.id);
      out.push({
        userId: setting.user_id, scheduledAt,
        dedupeKey: `countdown:${id}:${today}:${reminder}`,
        sourceType: 'countdown', sourceId: id, tag: `countdown-${id}-${today}`,
        title: String(row.name), body: lead === 0 ? NOTIFICATION_TEXT.countdownToday : NOTIFICATION_TEXT.countdownSoon, url: '/app/countdown',
        sound: setting.sound_enabled ? 'on' : 'off',
      });
    }
  }
  return out;
}

export async function sendToUser(env: Env, userId: string, payload: NotificationPayload): Promise<{ sent: number; failed: number }> {
  if (!pushConfigured(env)) return { sent: 0, failed: 0 };
  const rows = await env.DB.prepare(
    'SELECT id, endpoint, p256dh, auth, lang FROM push_subscriptions WHERE user_id = ?',
  ).bind(userId).all<{ id: string; endpoint: string; p256dh: string; auth: string; lang: string | null }>();
  const vapid: VapidKeys = {
    subject: env.VAPID_SUBJECT!.trim(),
    publicKey: env.VAPID_PUBLIC_KEY!.trim(),
    privateKey: env.VAPID_PRIVATE_KEY!.trim(),
  };
  let sent = 0;
  let failed = 0;
  await Promise.all(rows.results.map(async (row) => {
    const subscription: PushSubscription = { endpoint: row.endpoint, expirationTime: null, keys: { p256dh: row.p256dh, auth: row.auth } };
    try {
      // Each device gets the copy in its own UI language (stored at subscribe time).
      const data = localizedPayload(payload, pushLang(row.lang));
      const request = await buildPushPayload({ data, options: { ttl: 300, urgency: 'high', topic: payload.tag.slice(0, 32) } }, subscription, vapid);
      // Workers does not implement redirect:"error". Keep redirects manual so
      // a subscription endpoint cannot turn this into an arbitrary follow-up request.
      const response = await fetch(row.endpoint, { ...request, redirect: 'manual' });
      if (response.ok) sent += 1;
      else {
        failed += 1;
        if (response.status === 404 || response.status === 410) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
        }
      }
    } catch (error) {
      failed += 1;
      console.error('push delivery failed', error);
    }
  }));
  return { sent, failed };
}

async function claim(db: D1Database, candidate: Candidate): Promise<boolean> {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO notification_deliveries
      (id, user_id, dedupe_key, source_type, source_id, scheduled_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'sending', ?)`,
  ).bind(genId(), candidate.userId, candidate.dedupeKey, candidate.sourceType, candidate.sourceId, candidate.scheduledAt, Date.now()).run();
  return Boolean(result.meta.changes);
}

export async function dispatchDueNotifications(env: Env, now = Date.now()): Promise<{ candidates: number; sent: number; failed: number }> {
  if (!pushConfigured(env)) return { candidates: 0, sent: 0, failed: 0 };
  await ensureSchema(env);
  const all: Candidate[] = [];
  for (const setting of await settings(env.DB)) {
    if (!setting.enabled) continue;
    setting.timezone = validTimeZone(setting.timezone);
    all.push(
      ...await taskCandidates(env.DB, setting, now),
      ...await habitCandidates(env.DB, setting, now),
      ...await countdownCandidates(env.DB, setting, now),
    );
  }
  let sent = 0;
  let failed = 0;
  for (const candidate of all) {
    if (!await claim(env.DB, candidate)) continue;
    const result = await sendToUser(env, candidate.userId, candidate);
    sent += result.sent;
    failed += result.failed;
    await env.DB.prepare(
      "UPDATE notification_deliveries SET status = ?, sent_at = ? WHERE dedupe_key = ?",
    ).bind(result.sent > 0 ? 'sent' : 'failed', Date.now(), candidate.dedupeKey).run();
  }
  // Pruning 90-day-old delivery records once an hour is plenty.
  if (new Date(now).getUTCMinutes() === 0) {
    await env.DB.prepare('DELETE FROM notification_deliveries WHERE created_at < ?').bind(now - 90 * 86400000).run();
  }
  return { candidates: all.length, sent, failed };
}
