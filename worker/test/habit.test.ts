import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, env, reset, SELF } from 'cloudflare:test';
import worker from '../src/index.js';
import { issueApiToken } from '../src/auth.js';
import { ensureSchema, resetSchemaCheck } from '../src/db.js';
import { dispatchDueNotifications, habitCandidates, type SettingRow } from '../src/services/notifications.js';
import {
  addDays,
  goalMet,
  isPlannedDay,
  needsCheckin,
  parseHabitSchedule,
  periodOf,
  periodQuota,
  WEEKDAY_CODES,
  withinRange,
} from '../src/services/habitSchedule.js';

afterEach(async () => {
  await reset();
  resetSchemaCheck();
});

const HOST = 'https://nodetick.test';
const EMAIL = 'admin@example.com';
const PASSWORD = 'hunter2hunter2';

function json(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

/** Register the first (admin) user and mint an API token via /api. */
async function bootstrap(): Promise<{ token: string; cookie: string }> {
  const reg = await SELF.fetch(`${HOST}/api/register`, {
    ...json({ email: EMAIL, password: PASSWORD }),
    redirect: 'manual',
  });
  expect(reg.status).toBe(200);
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];
  const created = await SELF.fetch(`${HOST}/api/tokens`, { ...json({ name: 'test' }, { Cookie: cookie }) });
  expect(created.status).toBe(200);
  const token = ((await created.json()) as { token: string }).token;
  return { token, cookie };
}

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

/** A second account, created directly (registration closes after the first). */
async function otherUser(): Promise<string> {
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind('other-user', 'other@example.com', 'test-only', '33'.repeat(16), 0, Date.now()).run();
  return issueApiToken(env.DB, 'other-user', 'test');
}

function client(token: string) {
  const call = (method: string, path: string, body?: unknown) =>
    SELF.fetch(`${HOST}/open/v1${path}`, {
      method,
      headers: auth(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ok = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await call(method, path, body);
    expect(res.status, `${method} ${path}`).toBe(200);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
  return { call, ok };
}

type CheckinRow = { stamp: number; value: number | null; goal: number | null; status: number | null };
type Entry = { id: string; habitId: string; stamp: number; value: number; time: string | null };
type EntryResponse = { habitId: string; year: number; checkins: CheckinRow[]; entries: Entry[] };

const dayOfWeek = (day: string) => WEEKDAY_CODES[new Date(`${day}T00:00:00Z`).getUTCDay()];
const stampOf = (day: string) => Number(day.replaceAll('-', ''));

describe('habit schedule (shared test vectors with webapp/test/habits.test.ts)', () => {
  it('reads every frequency, the start, the duration and UNTIL', () => {
    const daily = parseHabitSchedule('RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA\nX-NODETICK-FREQ:daily\nX-NODETICK-START:20261101\nX-NODETICK-DAYS:0');
    expect(daily).toMatchObject({ frequency: 'daily', startDate: '2026-11-01', durationDays: null });
    expect(parseHabitSchedule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR')).toMatchObject({ frequency: 'weekly', weekdays: ['MO', 'WE', 'FR'] });
    expect(parseHabitSchedule('RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA\nX-NODETICK-FREQ:weekly').frequency).toBe('weekly');
    expect(parseHabitSchedule('RRULE:FREQ=DAILY;INTERVAL=3\nX-NODETICK-START:20261101')).toMatchObject({ frequency: 'interval', interval: 3 });
    expect(parseHabitSchedule('RRULE:FREQ=DAILY;INTERVAL=1').frequency).toBe('daily');
    expect(parseHabitSchedule('RRULE:FREQ=WEEKLY;TT_TIMES=3;WKST=MO')).toMatchObject({ frequency: 'perWeek', times: 3, weekStart: 'MO' });
    expect(parseHabitSchedule('RRULE:FREQ=MONTHLY;TT_TIMES=10')).toMatchObject({ frequency: 'perMonth', times: 10, weekStart: 'SU' });
    expect(parseHabitSchedule('RRULE:FREQ=DAILY;UNTIL=20261231T000000Z')).toMatchObject({ until: '2026-12-31' });
    expect(parseHabitSchedule('DTSTART;VALUE=DATE:20260105\nRRULE:FREQ=DAILY;COUNT=10')).toMatchObject({ startDate: '2026-01-05', durationDays: 10 });
    expect(parseHabitSchedule(null)).toMatchObject({ frequency: 'daily', startDate: null, durationDays: null });
    expect(parseHabitSchedule('RRULE:FREQ=YEARLY;BYMONTH=1').frequency).toBe('daily');
  });

  it('decides planned days, the run and periods', () => {
    const weekdays = parseHabitSchedule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\nX-NODETICK-START:20261101\nX-NODETICK-DAYS:30');
    expect(isPlannedDay(weekdays, '2026-11-02')).toBe(true); // Monday
    expect(isPlannedDay(weekdays, '2026-11-03')).toBe(false); // Tuesday
    expect(isPlannedDay(weekdays, '2026-10-30')).toBe(false); // a Friday before the start
    expect(withinRange(weekdays, '2026-11-30')).toBe(true); // day 30
    expect(withinRange(weekdays, '2026-12-01')).toBe(false); // day 31
    const interval = parseHabitSchedule('RRULE:FREQ=DAILY;INTERVAL=3\nX-NODETICK-START:20261101');
    expect(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((day) => isPlannedDay(interval, day)))
      .toEqual([true, false, false, true]);
    const perWeek = parseHabitSchedule('RRULE:FREQ=WEEKLY;TT_TIMES=3');
    expect(periodOf(perWeek, '2026-11-20')).toEqual({ start: '2026-11-15', end: '2026-11-21' });
    expect(periodOf(parseHabitSchedule('RRULE:FREQ=WEEKLY;TT_TIMES=3;WKST=MO'), '2026-11-22')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(periodOf(parseHabitSchedule('RRULE:FREQ=MONTHLY;TT_TIMES=3'), '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    // A week cut by the start date asks for no more days than it has.
    const late = parseHabitSchedule('RRULE:FREQ=WEEKLY;TT_TIMES=5\nX-NODETICK-START:20261119');
    expect(periodQuota(late, periodOf(late, '2026-11-20'))).toBe(3);
  });

  it('meets goals by status or value and keeps flexible quotas', () => {
    expect(goalMet({ value: 8, goal: 8, status: 0 }, 8)).toBe(true);
    expect(goalMet({ value: 3, goal: null, status: null }, 8)).toBe(false);
    expect(goalMet({ value: 0, goal: 8, status: 2 }, 8)).toBe(true);
    expect(goalMet({ value: 9, goal: 8, status: 1 }, 8)).toBe(false);
    expect(goalMet({ value: 1, goal: 0, status: null }, null)).toBe(true);
    const perWeek = parseHabitSchedule('RRULE:FREQ=WEEKLY;TT_TIMES=2');
    expect(needsCheckin(perWeek, '2026-11-20', new Set(['2026-11-16']))).toBe(true);
    expect(needsCheckin(perWeek, '2026-11-20', new Set(['2026-11-16', '2026-11-18']))).toBe(false);
    expect(needsCheckin(perWeek, '2026-11-20', new Set(['2026-11-20']))).toBe(false);
    // The previous week's check-ins don't count.
    expect(needsCheckin(perWeek, '2026-11-20', new Set(['2026-11-13', '2026-11-14']))).toBe(true);
    const weekdays = parseHabitSchedule('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(needsCheckin(weekdays, '2026-11-20', new Set())).toBe(false);
    expect(needsCheckin(weekdays, '2026-11-23', new Set())).toBe(true);
  });
});

describe('habit API extensions', () => {
  it('lists the built-in sections and returns createdTime', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    expect(await api.ok('GET', '/habit/sections')).toEqual([
      { id: '_morning', name: '_morning', sortOrder: 0 },
      { id: '_afternoon', name: '_afternoon', sortOrder: 1 },
      { id: '_night', name: '_night', sortOrder: 2 },
    ]);
    const habit = await api.ok('POST', '/habit', { name: 'Read', sectionId: '_night', encouragement: 'One page' });
    expect(habit).toMatchObject({ name: 'Read', sectionId: '_night', encouragement: 'One page' });
    expect(String(habit.createdTime)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0000$/);
    // Archive (TickTick status 1) and restore through the update endpoint.
    expect(await api.ok('POST', `/habit/${habit.id}`, { status: 1 })).toMatchObject({ status: 1 });
    expect(await api.ok('POST', `/habit/${habit.id}`, { status: 0, encouragement: '' })).toMatchObject({ status: 0, encouragement: '' });
  });

  it('validates habit fields and entry input', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    expect((await api.call('POST', '/habit', { name: 'Long', encouragement: 'x'.repeat(513) })).status).toBe(400);
    expect((await api.call('POST', '/habit', { name: 'Rule', repeatRule: 'R'.repeat(2049) })).status).toBe(400);
    const habit = await api.ok('POST', '/habit', { name: 'Water', goal: 8, type: 'Real', unit: 'cups' });
    expect((await api.call('POST', `/habit/${habit.id}`, { unit: 'u'.repeat(65) })).status).toBe(400);
    const entry = (body: unknown) => api.call('POST', `/habit/${habit.id}/checkin/entry`, body);
    expect((await entry({ stamp: 20261120, value: '2' })).status).toBe(400);
    expect((await entry({ stamp: 20261120, value: 0 })).status).toBe(400);
    expect((await entry({ stamp: 20261120, value: -1 })).status).toBe(400);
    expect((await entry({ stamp: 20261120, value: 2_000_000 })).status).toBe(400);
    expect((await entry({ stamp: 20261131, value: 1 })).status).toBe(400);
    expect((await entry({ stamp: 20261120, value: 1, time: 'noon' })).status).toBe(400);
    expect((await entry({ stamp: 20261120, value: 1, goal: 'eight' })).status).toBe(400);
    expect((await api.call('GET', `/habit/${habit.id}/checkin/entries?from=20250101&to=20261231`)).status).toBe(400);
    expect((await api.call('POST', `/habit/${habit.id}/checkin/entry/nope`, {})).status).toBe(400);
    expect((await api.call('DELETE', `/habit/${habit.id}/record/2026`)).status).toBe(400);
  });

  it('adds, edits and removes check-in entries, keeping the day total and status in step', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const habit = await api.ok('POST', '/habit', { name: 'Water', goal: 8, step: 2, type: 'Real', unit: 'cups' });
    const add = (value: number, extra: Record<string, unknown> = {}) =>
      api.ok<EntryResponse>('POST', `/habit/${habit.id}/checkin/entry`, { stamp: 20261231, value, ...extra });

    const first = await add(2, { time: '2026-12-31T09:15:00+0800' });
    expect(first.year).toBe(2026);
    expect(first.checkins).toEqual([expect.objectContaining({ stamp: 20261231, value: 2, goal: 8, status: 0 })]);
    expect(first.entries).toEqual([expect.objectContaining({ value: 2, time: '2026-12-31T09:15:00+0800', stamp: 20261231 })]);

    const second = await add(0.1);
    const third = await add(0.2);
    expect(third.checkins[0].value).toBe(2.3); // rounded, not 2.3000000000000003
    expect(third.entries.map((e) => e.value)).toEqual([2, 0.1, 0.2]);
    expect(second.entries[1].time).toMatch(/\+0000$/); // server time when none is sent

    // Editing the amount moves the total; the goal is met at 8.
    const edited = await api.ok<EntryResponse>('POST', `/habit/${habit.id}/checkin/entry/${first.entries[0].id}`, { value: 7.7 });
    expect(edited.checkins[0]).toMatchObject({ value: 8, status: 2 });
    expect(edited.entries[0]).toMatchObject({ value: 7.7, time: '2026-12-31T09:15:00+0800' });
    // Editing only the time leaves the total alone.
    const moved = await api.ok<EntryResponse>('POST', `/habit/${habit.id}/checkin/entry/${first.entries[0].id}`, { time: '2026-12-31T07:00:00+0800' });
    expect(moved.checkins[0]).toMatchObject({ value: 8, status: 2 });
    expect(moved.entries[0].time).toBe('2026-12-31T07:00:00+0800');

    // Undo: removing an entry takes its amount off and reopens the day.
    const undone = await api.ok<EntryResponse>('DELETE', `/habit/${habit.id}/checkin/entry/${third.entries[2].id}`);
    expect(undone.checkins[0]).toMatchObject({ value: 7.8, status: 0 });
    expect(undone.entries.map((e) => e.value)).toEqual([7.7, 0.1]);
    expect((await api.call('DELETE', `/habit/${habit.id}/checkin/entry/${third.entries[2].id}`)).status).toBe(404);

    const listed = await api.ok<Entry[]>('GET', `/habit/${habit.id}/checkin/entries?from=20261201&to=20261231`);
    expect(listed.map((e) => e.value)).toEqual([7.7, 0.1]);

    // A new day starts from the goal the client sends, else the habit's.
    const nextYear = await add(1, { stamp: 20270101, goal: 3 });
    expect(nextYear).toMatchObject({ year: 2027, checkins: [expect.objectContaining({ stamp: 20270101, goal: 3, value: 1 })] });

    // TickTick's upsert still sets the day's value, and replaces the itemized entries.
    const upsert = await api.ok<{ checkins: CheckinRow[] }>('POST', `/habit/${habit.id}/checkin`, { stamp: 20261231, value: 5 });
    expect(upsert.checkins.find((c) => c.stamp === 20261231)?.value).toBe(5);
    expect(await api.ok('GET', `/habit/${habit.id}/checkin/entries?from=20261231&to=20261231`)).toEqual([]);
    // Entries added afterwards build on that total.
    expect((await add(1)).checkins.find((c) => c.stamp === 20261231)?.value).toBe(6);
  });

  it('applies concurrent check-ins atomically', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const habit = await api.ok('POST', '/habit', { name: 'Push-ups', goal: 50, type: 'Real' });
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      api.call('POST', `/habit/${habit.id}/checkin/entry`, { stamp: 20261120, value: i + 1 })));
    expect(responses.map((res) => res.status)).toEqual(Array(12).fill(200));
    const day = (await api.ok<{ checkins: CheckinRow[] }[]>('GET', `/habit/checkins?habitIds=${habit.id}&from=20261120&to=20261120`))[0].checkins[0];
    expect(day).toMatchObject({ value: 78, status: 2 }); // 1 + 2 + ... + 12
    const entries = await api.ok<Entry[]>('GET', `/habit/${habit.id}/checkin/entries?from=20261120&to=20261120`);
    expect(entries).toHaveLength(12);

    // Concurrent removals of the same entry subtract it once.
    const removals = await Promise.all(Array.from({ length: 4 }, () =>
      api.call('DELETE', `/habit/${habit.id}/checkin/entry/${entries[11].id}`)));
    expect(removals.map((res) => res.status).sort()).toEqual([200, 404, 404, 404]);
    const after = (await api.ok<{ checkins: CheckinRow[] }[]>('GET', `/habit/checkins?habitIds=${habit.id}&from=20261120&to=20261120`))[0].checkins[0];
    // Concurrent inserts land in any order: subtract whichever entry was removed.
    expect(after).toMatchObject({ value: 78 - entries[11].value, status: 2 });
  });

  it('caps the entries of one day', async () => {
    const { token, cookie } = await bootstrap();
    const me = (await (await SELF.fetch(`${HOST}/api/me`, { headers: { Cookie: cookie } })).json()) as { id: string };
    const api = client(token);
    const habit = await api.ok('POST', '/habit', { name: 'Sips', goal: 1000, type: 'Real' });
    await env.DB.batch(Array.from({ length: 100 }, (_, i) => env.DB.prepare(
      'INSERT INTO habit_checkin_entries (id, user_id, habit_id, stamp, value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(`entry${i}`, me.id, habit.id, 20261120, 1, i)));
    const res = await api.call('POST', `/habit/${habit.id}/checkin/entry`, { stamp: 20261120, value: 1 });
    expect(res.status).toBe(409);
    // Nothing was added to the day.
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM habit_checkins').first<{ n: number }>()).toEqual({ n: 0 });
    expect((await api.call('POST', `/habit/${habit.id}/checkin/entry`, { stamp: 20261121, value: 1 })).status).toBe(200);
  });

  it("keeps every habit endpoint to the caller's own habits", async () => {
    const { token } = await bootstrap();
    const owner = client(token);
    const other = client(await otherUser());
    const habit = await owner.ok('POST', '/habit', { name: 'Mine', goal: 3, type: 'Real' });
    const added = await owner.ok<EntryResponse>('POST', `/habit/${habit.id}/checkin/entry`, { stamp: 20261120, value: 1 });
    await owner.ok('POST', `/habit/${habit.id}/record`, { stamp: 20261120, content: 'mine', emoji: 80 });
    const entryId = added.entries[0].id;

    const statuses = await Promise.all([
      other.call('GET', `/habit/${habit.id}`),
      other.call('POST', `/habit/${habit.id}`, { name: 'Taken' }),
      other.call('POST', `/habit/${habit.id}/checkin`, { stamp: 20261120, value: 9 }),
      other.call('POST', `/habit/${habit.id}/checkin/entry`, { stamp: 20261120, value: 9 }),
      other.call('POST', `/habit/${habit.id}/checkin/entry/${entryId}`, { value: 9 }),
      other.call('DELETE', `/habit/${habit.id}/checkin/entry/${entryId}`),
      other.call('GET', `/habit/${habit.id}/checkin/entries?from=20261101&to=20261130`),
      other.call('GET', `/habit/${habit.id}/records?from=20261101&to=20261130`),
      other.call('POST', `/habit/${habit.id}/record`, { stamp: 20261120, content: 'theirs' }),
      other.call('DELETE', `/habit/${habit.id}/record/20261120`),
      other.call('DELETE', `/habit/${habit.id}`),
    ]);
    expect(statuses.map((res) => res.status)).toEqual(Array(11).fill(404));
    // Another user's own habit can't reach this entry either.
    const theirs = await other.ok('POST', '/habit', { name: 'Theirs' });
    expect((await other.call('DELETE', `/habit/${theirs.id}/checkin/entry/${entryId}`)).status).toBe(404);
    expect((await other.call('POST', `/habit/${theirs.id}/checkin/entry/${entryId}`, { value: 5 })).status).toBe(404);

    const day = (await owner.ok<{ checkins: CheckinRow[] }[]>('GET', `/habit/checkins?habitIds=${habit.id}&from=20261120&to=20261120`))[0].checkins;
    expect(day).toEqual([expect.objectContaining({ value: 1, status: 0 })]);
    expect(await owner.ok('GET', `/habit/${habit.id}/records?from=20261120&to=20261120`)).toEqual([
      expect.objectContaining({ content: 'mine', emoji: 80 }),
    ]);
    expect(await owner.ok('GET', `/habit/${habit.id}`)).toMatchObject({ name: 'Mine' });
  });

  it('deletes a habit with its check-ins, entries and logs only', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const doomed = await api.ok('POST', '/habit', { name: 'Doomed', goal: 2, type: 'Real' });
    const kept = await api.ok('POST', '/habit', { name: 'Kept', goal: 2, type: 'Real' });
    for (const habit of [doomed, kept]) {
      await api.ok('POST', `/habit/${habit.id}/checkin/entry`, { stamp: 20261119, value: 1 });
      await api.ok('POST', `/habit/${habit.id}/checkin`, { stamp: 20261118, value: 2 });
      await api.ok('POST', `/habit/${habit.id}/record`, { stamp: 20261119, content: 'note' });
    }
    const count = async (table: string) =>
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;
    expect([await count('habits'), await count('habit_checkins'), await count('habit_checkin_entries'), await count('habit_records')])
      .toEqual([2, 4, 2, 2]);

    expect((await api.call('DELETE', `/habit/${doomed.id}`)).status).toBe(200);
    expect([await count('habits'), await count('habit_checkins'), await count('habit_checkin_entries'), await count('habit_records')])
      .toEqual([1, 2, 1, 1]);
    expect((await api.call('GET', `/habit/${doomed.id}`)).status).toBe(404);
    expect((await api.call('DELETE', `/habit/${doomed.id}`)).status).toBe(404);
    const left = await env.DB.prepare('SELECT DISTINCT habit_id FROM habit_checkins').all<{ habit_id: string }>();
    expect(left.results).toEqual([{ habit_id: kept.id }]);

    // Removing a log.
    expect((await api.call('DELETE', `/habit/${kept.id}/record/20261119`)).status).toBe(200);
    expect((await api.call('DELETE', `/habit/${kept.id}/record/20261119`)).status).toBe(404);
  });

  it('backs up check-in entries and restores them for their owner only', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const habit = await api.ok('POST', '/habit', { name: 'Water', goal: 8, type: 'Real' });
    const added = await api.ok<EntryResponse>('POST', `/habit/${habit.id}/checkin/entry`, { stamp: 20261120, value: 3, time: '2026-11-20T08:00:00+0800' });
    const backup = await api.ok<Record<string, unknown>>('GET', '/backup/export');
    expect(backup.habitCheckinEntries).toEqual([
      expect.objectContaining({ id: added.entries[0].id, habit_id: habit.id, stamp: 20261120, value: 3, time: '2026-11-20T08:00:00+0800' }),
    ]);

    // Another user importing the export takes nothing over.
    const other = client(await otherUser());
    const foreign = await other.ok<{ imported: number; skipped: number }>('POST', '/backup/import', backup);
    expect(foreign.imported).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM habit_checkin_entries WHERE user_id = 'other-user'").first()).toEqual({ n: 0 });

    // The owner gets the entry back after removing it.
    await api.ok('DELETE', `/habit/${habit.id}/checkin/entry/${added.entries[0].id}`);
    expect(await api.ok('GET', `/habit/${habit.id}/checkin/entries?from=20261120&to=20261120`)).toEqual([]);
    const restored = await api.ok<{ imported: number }>('POST', '/backup/import', backup);
    expect(restored.imported).toBeGreaterThan(0);
    expect(await api.ok('GET', `/habit/${habit.id}/checkin/entries?from=20261120&to=20261120`)).toEqual([
      expect.objectContaining({ id: added.entries[0].id, value: 3 }),
    ]);
    const day = (await api.ok<{ checkins: CheckinRow[] }[]>('GET', `/habit/checkins?habitIds=${habit.id}&from=20261120&to=20261120`))[0].checkins;
    expect(day).toEqual([expect.objectContaining({ value: 3 })]);
  });
});

describe('habit reminders', () => {
  // Real-time-adjacent days keep the hourly delivery cleanup away from our claims.
  const today = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const at = (day: string, time = '01:00:00') => Date.parse(`${day}T${time}Z`); // 09:00 in Shanghai
  const b64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const settings = {
    enabled: true, taskEnabled: true, habitEnabled: true, countdownEnabled: true,
    soundEnabled: true, timezone: 'Asia/Shanghai', allDayTime: '09:00',
  };

  async function pushEnv() {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    return { ...env, VAPID_PUBLIC_KEY: b64url(publicKey), VAPID_PRIVATE_KEY: privateKey.d!, VAPID_SUBJECT: 'mailto:test@example.com' };
  }

  async function pushUser() {
    const { token, cookie } = await bootstrap();
    const me = (await (await SELF.fetch(`${HOST}/api/me`, { headers: { Cookie: cookie } })).json()) as { id: string };
    const saved = await SELF.fetch(`${HOST}/open/v1/notification/settings`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify(settings),
    });
    expect(saved.status).toBe(200);
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const p256dh = b64url(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), me.id, 'https://push.example/device', p256dh, b64url(crypto.getRandomValues(new Uint8Array(16))), Date.now(), Date.now()).run();
    return { api: client(token), userId: me.id };
  }

  /** Names of the habits whose 09:00 (Shanghai) reminder went out on `day`. */
  async function remindedOn(testEnv: Awaited<ReturnType<typeof pushEnv>>, day: string): Promise<string[]> {
    await dispatchDueNotifications(testEnv, at(day));
    const sent = await env.DB.prepare(
      "SELECT h.name FROM notification_deliveries d JOIN habits h ON h.id = d.source_id WHERE d.source_type = 'habit' AND d.dedupe_key LIKE ?",
    ).bind(`%:${day}:%`).all<{ name: string }>();
    return sent.results.map((row) => row.name).sort();
  }

  it('fires only on scheduled days inside the run, for active habits not yet done', async () => {
    const { api } = await pushUser();
    const code = dayOfWeek(today);
    const otherCode = dayOfWeek(addDays(today, 1));
    const rule = (lines: string[]) => lines.join('\n');
    const start = stampOf(addDays(today, -10));
    const make = (name: string, extra: Record<string, unknown>) =>
      api.ok('POST', '/habit', { name, reminders: ['09:00'], ...extra });
    await make('Daily', { repeatRule: rule(['RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA', `X-NODETICK-START:${start}`]) });
    await make('No rule', {});
    await make('On this weekday', { repeatRule: `RRULE:FREQ=WEEKLY;BYDAY=${code}` });
    await make('Other weekday', { repeatRule: `RRULE:FREQ=WEEKLY;BYDAY=${otherCode}` });
    await make('Ended', { repeatRule: rule(['RRULE:FREQ=DAILY', `X-NODETICK-START:${start}`, 'X-NODETICK-DAYS:7']) });
    await make('Not started', { repeatRule: rule(['RRULE:FREQ=DAILY', `X-NODETICK-START:${stampOf(addDays(today, 1))}`]) });
    await make('Every 2 days, on', { repeatRule: rule(['RRULE:FREQ=DAILY;INTERVAL=2', `X-NODETICK-START:${start}`]) });
    await make('Every 2 days, off', { repeatRule: rule(['RRULE:FREQ=DAILY;INTERVAL=2', `X-NODETICK-START:${stampOf(addDays(today, -9))}`]) });
    await make('Archived', { status: 1 });
    await make('Deleted', { status: 2 });
    await make('No reminders', { reminders: [] });
    const done = await make('Done', { goal: 1 });
    await api.ok('POST', `/habit/${done.id}/checkin`, { stamp: stampOf(today), value: 1, status: 2 });
    const partial = await make('Half done', { goal: 4, type: 'Real' });
    await api.ok('POST', `/habit/${partial.id}/checkin/entry`, { stamp: stampOf(today), value: 2 });
    const doneByEntries = await make('Done by entries', { goal: 2, type: 'Real' });
    await api.ok('POST', `/habit/${doneByEntries.id}/checkin/entry`, { stamp: stampOf(today), value: 2 });

    const testEnv = await pushEnv();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 201 }));
    try {
      expect(await remindedOn(testEnv, today)).toEqual(['Daily', 'Every 2 days, on', 'Half done', 'No rule', 'On this weekday']);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps flexible habits quiet once the week or month has its days', async () => {
    const { api } = await pushUser();
    // The week ends today, so the two days before it are in the same week.
    const weekStart = dayOfWeek(addDays(today, 1));
    const perWeek = await api.ok('POST', '/habit', {
      name: 'Twice a week', reminders: ['09:00'], repeatRule: `RRULE:FREQ=WEEKLY;TT_TIMES=2;WKST=${weekStart}`,
    });
    const open = await api.ok('POST', '/habit', {
      name: 'Three times a week', reminders: ['09:00'], repeatRule: `RRULE:FREQ=WEEKLY;TT_TIMES=3;WKST=${weekStart}`,
    });
    for (const habit of [perWeek, open]) {
      for (const day of [addDays(today, -1), addDays(today, -2)]) {
        await api.ok('POST', `/habit/${habit.id}/checkin`, { stamp: stampOf(day), value: 1 });
      }
    }
    const testEnv = await pushEnv();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 201 }));
    try {
      expect(await remindedOn(testEnv, today)).toEqual(['Three times a week']);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('sends the encouragement as the body and reads check-ins only when a reminder is due', async () => {
    const { api, userId } = await pushUser();
    await api.ok('POST', '/habit', { name: 'Stretch', reminders: ['09:00'], encouragement: 'Loosen up!' });
    await api.ok('POST', '/habit', { name: 'Walk', reminders: ['09:00'] });
    const setting: SettingRow = {
      user_id: userId, enabled: 1, task_enabled: 1, habit_enabled: 1, countdown_enabled: 1, sound_enabled: 1,
      timezone: 'Asia/Shanghai', all_day_time: '09:00',
    };
    const prepare = vi.spyOn(env.DB, 'prepare');
    try {
      // 08:00 Shanghai: nothing is due, so the scan never touches check-ins.
      expect(await habitCandidates(env.DB, setting, at(today, '00:00:00'))).toEqual([]);
      expect(prepare.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.includes('habit_checkins'))).toEqual([]);
      const due = await habitCandidates(env.DB, setting, at(today));
      expect(due.map((item) => [item.title, item.body])).toEqual([
        ['Stretch', 'Loosen up!'],
        ['Walk', { zh: '今天还没有打卡', en: "You haven't checked in today" }],
      ]);
      expect(prepare.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.includes('habit_checkins'))).toHaveLength(1);
    } finally {
      prepare.mockRestore();
    }
  });

  it('scans habits through the partial index', async () => {
    await ensureSchema(env);
    const plan = async (sql: string, ...params: unknown[]) =>
      (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((row) => row.detail).join('\n');
    expect(await plan(
      `SELECT id FROM habits INDEXED BY idx_habits_reminders
       WHERE user_id = ? AND reminders IS NOT NULL AND reminders != '[]' AND status = 0`,
      'u',
    )).toContain('USING INDEX idx_habits_reminders');
    expect(await plan(
      `SELECT habit_id FROM habit_checkins
       WHERE habit_id IN (SELECT value FROM json_each(?)) AND user_id = ? AND stamp BETWEEN ? AND ?`,
      '["h"]', 'u', 20261101, 20261130,
    )).toContain('USING INDEX idx_checkins_habit');
    expect(await plan('SELECT * FROM habits WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC', 'u'))
      .toContain('USING INDEX idx_habits_user_order');
  });
});

describe('habit round trips', () => {
  /** The worker with a D1 binding that counts queries like the per-request limit does (a batch is one). */
  function countingWorker() {
    let queries = 0;
    const unwrapped = new WeakMap<object, D1PreparedStatement>();
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
      const proxy = new Proxy(statement, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (typeof value !== 'function') return value;
          if (prop === 'bind') return (...args: unknown[]) => wrap(value.apply(target, args));
          if (prop === 'run' || prop === 'all' || prop === 'first' || prop === 'raw') {
            return (...args: unknown[]) => {
              queries++;
              return value.apply(target, args);
            };
          }
          return value.bind(target);
        },
      });
      unwrapped.set(proxy, statement);
      return proxy;
    };
    const db = new Proxy(env.DB, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        if (prop === 'prepare') return (sql: string) => wrap(value.call(target, sql));
        if (prop === 'batch') {
          return (statements: D1PreparedStatement[]) => {
            queries++;
            return value.call(target, statements.map((statement) => unwrapped.get(statement) ?? statement));
          };
        }
        return value.bind(target);
      },
    });
    const fetch = (path: string, init?: RequestInit) =>
      worker.fetch(new Request(`${HOST}${path}`, init), { ...env, DB: db }, createExecutionContext());
    return { fetch, queries: () => queries, reset: () => { queries = 0; } };
  }

  it('answers the habit page in one round trip after the session lookup', async () => {
    const { cookie } = await bootstrap();
    const counter = countingWorker();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const call = async (path: string, init: RequestInit = {}) => {
      counter.reset();
      const res = await counter.fetch(path, { ...init, headers });
      expect(res.status, path).toBe(200);
      const text = await res.text();
      return { body: text ? JSON.parse(text) as Record<string, unknown> : null, queries: counter.queries() };
    };
    await call('/open/v1/project'); // warm the schema check
    const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) });

    expect((await call('/open/v1/habit/sections')).queries).toBe(1);
    const created = await post('/open/v1/habit', { name: 'Water', goal: 8, type: 'Real' });
    expect(created.queries).toBe(2);
    const id = String(created.body!.id);
    expect((await post(`/open/v1/habit/${id}`, { name: 'More water' })).queries).toBe(2);
    expect((await post(`/open/v1/habit/${id}/checkin`, { stamp: 20261120, value: 1 })).queries).toBe(2);
    const added = await post(`/open/v1/habit/${id}/checkin/entry`, { stamp: 20261120, value: 2 });
    expect(added.queries).toBe(2);
    const entryId = (added.body!.entries as Entry[])[0].id;
    expect((await post(`/open/v1/habit/${id}/checkin/entry/${entryId}`, { value: 3 })).queries).toBe(2);
    expect((await call(`/open/v1/habit/${id}/checkin/entries?from=20261101&to=20261130`)).queries).toBe(2);
    expect((await call(`/open/v1/habit/${id}/checkin/entry/${entryId}`, { method: 'DELETE' })).queries).toBe(2);
    expect((await post(`/open/v1/habit/${id}/record`, { stamp: 20261120, content: 'ok' })).queries).toBe(2);
    expect((await call(`/open/v1/habit/${id}/records?from=20261101&to=20261130`)).queries).toBe(2);
    expect((await call(`/open/v1/habit/${id}`, { method: 'DELETE' })).queries).toBe(2);
  });
});
