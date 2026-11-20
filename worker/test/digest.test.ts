import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, reset, SELF } from 'cloudflare:test';
import { resetSchemaCheck } from '../src/db.js';
import { digestCandidates, type SettingRow } from '../src/services/notifications.js';

afterEach(async () => {
  await reset();
  resetSchemaCheck();
  vi.restoreAllMocks();
});

const HOST = 'https://nodetick.test';
const SETTINGS = {
  enabled: true, taskEnabled: true, habitEnabled: true, countdownEnabled: true,
  soundEnabled: true, timezone: 'Asia/Shanghai', allDayTime: '09:00',
};

async function bootstrap() {
  const reg = await SELF.fetch(`${HOST}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'hunter2hunter2' }),
    redirect: 'manual',
  });
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];
  const me = (await (await SELF.fetch(`${HOST}/api/me`, { headers: { Cookie: cookie } })).json()) as { id: string };
  const created = await SELF.fetch(`${HOST}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'test' }),
  });
  const token = ((await created.json()) as { token: string }).token;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await SELF.fetch(`${HOST}/open/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  await call('GET', '/project');
  return { userId: me.id, call };
}

describe('daily digest settings', () => {
  it('stores the digest switch and time, and keeps them when a client leaves them out', async () => {
    const { call } = await bootstrap();
    expect((await call('GET', '/notification/config')).body.settings).toMatchObject({ digestEnabled: false, digestTime: '08:00' });
    expect((await call('PUT', '/notification/settings', { ...SETTINGS, digestEnabled: true, digestTime: '07:30' })).status).toBe(200);
    expect((await call('GET', '/notification/config')).body.settings).toMatchObject({ digestEnabled: true, digestTime: '07:30' });
    // An older client sends only the original fields.
    expect((await call('PUT', '/notification/settings', { ...SETTINGS, allDayTime: '10:00' })).status).toBe(200);
    expect((await call('GET', '/notification/config')).body.settings).toMatchObject({ digestEnabled: true, digestTime: '07:30', allDayTime: '10:00' });
    for (const bad of [{ digestTime: '24:00' }, { digestTime: '7:30' }, { digestEnabled: 'yes' }]) {
      expect((await call('PUT', '/notification/settings', { ...SETTINGS, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe('daily digest', () => {
  // 2030-03-15 08:00 in Shanghai is 00:00 UTC.
  const DIGEST_AT = Date.parse('2030-03-15T00:00:00Z');
  const setting = (userId: string, patch: Partial<SettingRow> = {}): SettingRow => ({
    user_id: userId, enabled: 1, task_enabled: 1, habit_enabled: 1, countdown_enabled: 1, sound_enabled: 1,
    timezone: 'Asia/Shanghai', all_day_time: '09:00', digest_enabled: 1, digest_time: '08:00', ...patch,
  });

  it("lists today's open tasks by priority and counts the overdue ones", async () => {
    const { userId, call } = await bootstrap();
    const add = (title: string, patch: Record<string, unknown>) => call('POST', '/task', { projectId: 'inbox', title, ...patch });
    await add('Pay rent', { dueDate: '2030-03-15T00:00:00+0000', isAllDay: true });
    await add('Call the bank', { dueDate: '2030-03-15T10:00:00+0800', priority: 5 });
    // 23:30 UTC on the 14th is 07:30 on the 15th in Shanghai.
    await add('Early run', { dueDate: '2030-03-14T23:30:00+0000', priority: 3 });
    await add('Water plants', { dueDate: '2030-03-15T00:00:00+0000', isAllDay: true });
    await add('Late report', { dueDate: '2030-03-12T00:00:00+0000', isAllDay: true });
    await add('Tomorrow', { dueDate: '2030-03-16T00:00:00+0000', isAllDay: true });
    const done = await add('Done already', { dueDate: '2030-03-15T00:00:00+0000', isAllDay: true });
    await call('POST', `/task/${done.body.id}`, { projectId: 'inbox', status: 2 });

    const [digest, ...rest] = await digestCandidates(env.DB, setting(userId), DIGEST_AT);
    expect(rest).toEqual([]);
    expect(digest).toMatchObject({
      dedupeKey: `digest:${userId}:2030-03-15`,
      url: '/app/tasks/today',
      title: { zh: '今日任务', en: "Today's tasks" },
      body: {
        zh: '今天 4 项：Call the bank、Early run、Pay rent…；另有 1 项已过期',
        en: '4 today: Call the bank, Early run, Pay rent…; 1 overdue',
      },
    });
  });

  it('reads tasks only at the digest time, and stays quiet on an empty day or when off', async () => {
    const { userId } = await bootstrap();
    const prepare = vi.spyOn(env.DB, 'prepare');
    expect(await digestCandidates(env.DB, setting(userId), DIGEST_AT + 2 * 3600000)).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
    expect(await digestCandidates(env.DB, setting(userId, { digest_enabled: 0 }), DIGEST_AT)).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
    expect(await digestCandidates(env.DB, setting(userId), DIGEST_AT)).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
