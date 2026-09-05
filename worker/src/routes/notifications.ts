import { Hono } from 'hono';
import type { Env, Vars } from '../env.js';
import { genId, readJsonObject } from '../util.js';
import { pushConfigured, sendToUser } from '../services/notifications.js';

export const notifications = new Hono<{ Bindings: Env; Variables: Vars }>();

const ENDPOINT_MAX = 4096;
const KEY_RE = /^[A-Za-z0-9_-]+$/;

notifications.get('/notification/config', async (c) => {
  const userId = c.get('userId');
  const row = await c.env.DB.prepare(
    `SELECT enabled, task_enabled, habit_enabled, countdown_enabled, sound_enabled, timezone, all_day_time
     FROM notification_settings WHERE user_id = ?`,
  ).bind(userId).first<Record<string, unknown>>();
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = ?')
    .bind(userId).first<{ total: number }>();
  return c.json({
    configured: pushConfigured(c.env),
    publicKey: c.env.VAPID_PUBLIC_KEY?.trim() ?? '',
    subscribedDevices: Number(count?.total ?? 0),
    settings: {
      enabled: row ? Boolean(row.enabled) : Number(count?.total ?? 0) > 0,
      taskEnabled: row ? Boolean(row.task_enabled) : true,
      habitEnabled: row ? Boolean(row.habit_enabled) : true,
      countdownEnabled: row ? Boolean(row.countdown_enabled) : true,
      soundEnabled: row ? Boolean(row.sound_enabled) : true,
      timezone: String(row?.timezone ?? 'UTC'),
      allDayTime: String(row?.all_day_time ?? '09:00'),
    },
  });
});

notifications.put('/notification/settings', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const boolKeys = ['enabled', 'taskEnabled', 'habitEnabled', 'countdownEnabled', 'soundEnabled'] as const;
  if (boolKeys.some((key) => typeof b[key] !== 'boolean') || typeof b.timezone !== 'string' || typeof b.allDayTime !== 'string') {
    return c.json({ error: 'invalid notification settings' }, 400);
  }
  if (b.timezone.length > 128 || !/^\d{2}:\d{2}$/.test(b.allDayTime)) return c.json({ error: 'invalid notification time' }, 400);
  try { new Intl.DateTimeFormat('en-US', { timeZone: b.timezone }).format(); } catch { return c.json({ error: 'invalid timezone' }, 400); }
  const [hour, minute] = b.allDayTime.split(':').map(Number);
  if (hour > 23 || minute > 59) return c.json({ error: 'invalid notification time' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO notification_settings
      (user_id, enabled, task_enabled, habit_enabled, countdown_enabled, sound_enabled, timezone, all_day_time, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, task_enabled=excluded.task_enabled,
       habit_enabled=excluded.habit_enabled, countdown_enabled=excluded.countdown_enabled,
       sound_enabled=excluded.sound_enabled, timezone=excluded.timezone,
       all_day_time=excluded.all_day_time, updated_at=excluded.updated_at`,
  ).bind(userId, b.enabled ? 1 : 0, b.taskEnabled ? 1 : 0, b.habitEnabled ? 1 : 0, b.countdownEnabled ? 1 : 0, b.soundEnabled ? 1 : 0, b.timezone, b.allDayTime, Date.now()).run();
  return c.json({ ok: true });
});

notifications.post('/notification/subscribe', async (c) => {
  if (!pushConfigured(c.env)) return c.json({ error: 'Web Push is not configured' }, 503);
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  const keys = b.keys && typeof b.keys === 'object' && !Array.isArray(b.keys) ? b.keys as Record<string, unknown> : {};
  if (typeof b.endpoint !== 'string' || b.endpoint.length > ENDPOINT_MAX || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !KEY_RE.test(keys.p256dh) || !KEY_RE.test(keys.auth) || keys.p256dh.length > 256 || keys.auth.length > 128) {
    return c.json({ error: 'invalid push subscription' }, 400);
  }
  let endpoint: URL;
  try { endpoint = new URL(b.endpoint); } catch { return c.json({ error: 'invalid push endpoint' }, 400); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return c.json({ error: 'push endpoint must use HTTPS' }, 400);
  const host = endpoint.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')) {
    return c.json({ error: 'invalid push endpoint host' }, 400);
  }
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh,
       auth=excluded.auth, user_agent=excluded.user_agent, updated_at=excluded.updated_at`,
  ).bind(genId(), userId, endpoint.toString(), keys.p256dh, keys.auth, (c.req.header('User-Agent') ?? '').slice(0, 512), now, now).run();
  return c.json({ ok: true });
});

notifications.delete('/notification/subscribe', async (c) => {
  const userId = c.get('userId');
  const b = await readJsonObject(c.req);
  if (typeof b.endpoint !== 'string' || b.endpoint.length > ENDPOINT_MAX) return c.json({ error: 'invalid endpoint' }, 400);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(userId, b.endpoint).run();
  return c.json({ ok: true });
});

notifications.post('/notification/test', async (c) => {
  const userId = c.get('userId');
  if (!pushConfigured(c.env)) return c.json({ error: 'Web Push is not configured' }, 503);
  const result = await sendToUser(c.env, userId, {
    title: 'NodeTick 通知测试', body: '通知功能已经连接成功。', tag: `test-${Date.now()}`,
    url: '/app/tasks/today', sourceType: 'test', sourceId: 'test',
  });
  if (!result.sent) return c.json({ error: 'No notification could be delivered', ...result }, 502);
  return c.json(result);
});
