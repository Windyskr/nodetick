import { afterEach, describe, expect, it } from 'vitest';
import { createExecutionContext, env, reset, SELF } from 'cloudflare:test';
import worker from '../src/index.js';
import { issueApiToken } from '../src/auth.js';
import { ensureSchema, resetSchemaCheck } from '../src/db.js';
import { historyPage, offsetSegments, Zone, zonedDayStart } from '../src/services/focus.js';

// Same isolation as api.test.ts: every test starts from an empty D1.
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

/** A second account, straight in D1, with its own API token. */
async function otherUser(): Promise<string> {
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind('other-user', 'other@example.com', 'test-only', '33'.repeat(16), 0, Date.now()).run();
  return issueApiToken(env.DB, 'other-user', 'test');
}

type Json = Record<string, unknown>;

function client(token: string) {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await SELF.fetch(`${HOST}/open/v1${path}`, { ...init, headers: auth(token) });
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
  return {
    get: (path: string) => call(path),
    post: (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) }),
    del: (path: string) => call(path, { method: 'DELETE' }),
    focus: async (body: Json) => {
      const res = await call('/focus', { method: 'POST', body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as { id: string } & Json;
    },
  };
}

interface Stats {
  tz: string;
  total: { pomoCount: number; pomoSeconds: number; stopwatchSeconds: number; seconds: number; records: number; firstDay: string | null };
  period: { pomoCount: number; pomoSeconds: number; stopwatchSeconds: number; seconds: number; records: number } | null;
  days: { day: string; pomoCount: number; seconds: number }[];
  byTask: { taskId: string | null; title: string | null; projectId: string | null; seconds: number; count: number; pomoCount: number }[];
  byProject: { projectId: string | null; seconds: number; count: number; pomoCount: number }[];
  byHour: number[];
}

describe('focus stats', () => {
  it('groups days and hours in the requested time zone across midnight', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    // 23:30 and 00:10 in Shanghai on either side of midnight, the second one
    // written in UTC; a stopwatch session over two hours; one the day before.
    await api.focus({ type: 0, startTime: '2026-03-01T23:30:00+0800', endTime: '2026-03-01T23:55:00+0800' });
    await api.focus({ type: 0, startTime: '2026-03-01T16:10:00+0000', endTime: '2026-03-01T16:35:00+0000' });
    await api.focus({ type: 1, startTime: '2026-03-02T09:00:00+0800', endTime: '2026-03-02T10:30:00+0800' });
    await api.focus({ type: 0, startTime: '2026-02-28T15:40:00Z', endTime: '2026-02-28T16:05:00Z', duration: 1500 });

    const shanghai = (await api.get('/focus/stats?from=2026-03-01&to=2026-03-02&tz=Asia/Shanghai')).body as unknown as Stats;
    expect(shanghai.tz).toBe('Asia/Shanghai');
    expect(shanghai.period).toEqual({ pomoCount: 2, pomoSeconds: 3000, stopwatchSeconds: 5400, seconds: 8400, records: 3 });
    expect(shanghai.days).toEqual([
      { day: '2026-03-01', pomoCount: 1, seconds: 1500 },
      { day: '2026-03-02', pomoCount: 1, seconds: 6900 },
    ]);
    expect(shanghai.byHour[23]).toBe(1500);
    expect(shanghai.byHour[0]).toBe(1500);
    expect(shanghai.byHour[9]).toBe(3600);
    expect(shanghai.byHour[10]).toBe(1800);
    expect(shanghai.byHour.reduce((a, b) => a + b, 0)).toBe(8400);
    expect(shanghai.total).toEqual({
      pomoCount: 3, pomoSeconds: 4500, stopwatchSeconds: 5400, seconds: 9900, records: 4, firstDay: '2026-02-28',
    });

    // The same records seen from UTC: both pomodoros fall on March 1.
    const utc = (await api.get('/focus/stats?from=2026-03-01&to=2026-03-02')).body as unknown as Stats;
    expect(utc.tz).toBe('UTC');
    expect(utc.days).toEqual([
      { day: '2026-03-01', pomoCount: 2, seconds: 3000 },
      { day: '2026-03-02', pomoCount: 0, seconds: 5400 },
    ]);
    expect(utc.byHour[15]).toBe(1500);
    expect(utc.byHour[16]).toBe(1500);
    expect(utc.byHour[1]).toBe(3600);

    // A session that crosses midnight counts for the day it started on, its
    // minutes spread over both hours.
    const late = (await api.get('/focus/stats?from=2026-02-28&to=2026-02-28&tz=Asia/Shanghai')).body as unknown as Stats;
    expect(late.days).toEqual([{ day: '2026-02-28', pomoCount: 1, seconds: 1500 }]);
    expect(late.byHour[23]).toBe(1200);
    expect(late.byHour[0]).toBe(300);
  });

  it('follows DST transitions (America/New_York)', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const pomo = (startTime: string) => api.focus({ type: 0, startTime, duration: 1500 });
    // Spring forward on 2026-03-08 at 02:00 EST (07:00Z): a 23-hour day.
    await pomo('2026-03-08T04:30:00Z'); // 23:30 EST, March 7
    await pomo('2026-03-08T05:30:00Z'); // 00:30 EST
    await pomo('2026-03-08T07:30:00Z'); // 03:30 EDT
    await pomo('2026-03-09T03:30:00Z'); // 23:30 EDT, still March 8
    await pomo('2026-03-09T04:30:00Z'); // 00:30 EDT, March 9
    // Fall back on 2026-11-01 at 02:00 EDT (06:00Z): 01:00-02:00 happens twice.
    await pomo('2026-11-01T05:30:00Z'); // 01:30 EDT
    await pomo('2026-11-01T06:30:00Z'); // 01:30 EST
    await pomo('2026-11-02T04:30:00Z'); // 23:30 EST, still November 1
    await pomo('2026-11-02T05:30:00Z'); // 00:30 EST, November 2

    const spring = (await api.get('/focus/stats?from=2026-03-08&to=2026-03-08&tz=America/New_York')).body as unknown as Stats;
    expect(spring.period?.records).toBe(3);
    expect(spring.days).toEqual([{ day: '2026-03-08', pomoCount: 3, seconds: 4500 }]);
    expect([spring.byHour[0], spring.byHour[3], spring.byHour[23]]).toEqual([1500, 1500, 1500]);

    const fall = (await api.get('/focus/stats?from=2026-11-01&to=2026-11-01&tz=America/New_York')).body as unknown as Stats;
    expect(fall.period?.records).toBe(3);
    expect(fall.byHour[1]).toBe(3000);
    expect(fall.byHour[23]).toBe(1500);

    const all = (await api.get('/focus/stats?from=2026-03-07&to=2026-11-02&tz=America/New_York')).body as unknown as Stats;
    expect(all.days.map((d) => [d.day, d.pomoCount])).toEqual([
      ['2026-03-07', 1], ['2026-03-08', 3], ['2026-03-09', 1], ['2026-11-01', 3], ['2026-11-02', 1],
    ]);
    expect(all.total.firstDay).toBe('2026-03-07');
  });

  it('finds the local start of a day whose midnight a DST jump skips', () => {
    // Havana springs forward at midnight: 2026-03-08 begins at 01:00 CDT.
    const zone = new Zone('America/Havana');
    const day = Date.parse('2026-03-08T00:00:00Z');
    const segments = offsetSegments(zone, day - 2 * 86_400_000, day + 2 * 86_400_000);
    expect(new Date(zonedDayStart(segments, day)).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(new Date(zonedDayStart(segments, day + 86_400_000)).toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('ranks tasks and lists, narrows to one task, and keeps users apart', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    await api.get('/project'); // inbox
    const project = (await api.post('/project', { name: 'Work' })).body as { id: string };
    const report = (await api.post('/task', { title: 'Write report', projectId: project.id })).body as { id: string };
    const errand = (await api.post('/task', { title: 'Errand', projectId: 'inbox' })).body as { id: string };
    await api.focus({ type: 0, taskId: report.id, startTime: '2026-05-04T09:00:00+0800', duration: 1500 });
    await api.focus({ type: 0, taskId: report.id, startTime: '2026-05-04T10:00:00+0800', duration: 1500 });
    await api.focus({ type: 1, taskId: errand.id, startTime: '2026-05-04T14:00:00+0800', duration: 600 });
    await api.focus({ type: 1, startTime: '2026-05-04T20:00:00+0800', duration: 900 });

    const other = client(await otherUser());
    await other.focus({ type: 0, startTime: '2026-05-04T09:00:00+0800', duration: 3000 });

    const mine = (await api.get('/focus/stats?from=2026-05-04&to=2026-05-04&tz=Asia/Shanghai')).body as unknown as Stats;
    expect(mine.total.records).toBe(4);
    expect(mine.byTask).toEqual([
      { taskId: report.id, title: 'Write report', projectId: project.id, seconds: 3000, count: 2, pomoCount: 2 },
      { taskId: null, title: null, projectId: null, seconds: 900, count: 1, pomoCount: 0 },
      { taskId: errand.id, title: 'Errand', projectId: 'inbox', seconds: 600, count: 1, pomoCount: 0 },
    ]);
    expect(mine.byProject).toEqual([
      { projectId: project.id, seconds: 3000, count: 2, pomoCount: 2 },
      { projectId: null, seconds: 900, count: 1, pomoCount: 0 },
      { projectId: 'inbox', seconds: 600, count: 1, pomoCount: 0 },
    ]);

    const task = (await api.get(`/focus/stats?taskId=${report.id}`)).body as unknown as Stats;
    expect(task.total).toMatchObject({ pomoCount: 2, seconds: 3000, records: 2, firstDay: '2026-05-04' });
    expect(task.period).toBeNull();
    expect(task.days).toEqual([]);

    const theirs = (await other.get('/focus/stats?from=2026-05-04&to=2026-05-04&tz=Asia/Shanghai')).body as unknown as Stats;
    expect(theirs.total.records).toBe(1);
    expect(theirs.byTask).toEqual([{ taskId: null, title: null, projectId: null, seconds: 3000, count: 1, pomoCount: 1 }]);
    const foreignTask = (await other.get(`/focus/stats?taskId=${report.id}&from=2026-05-04&to=2026-05-04`)).body as unknown as Stats;
    expect(foreignTask.total.records).toBe(0);
    expect(foreignTask.period?.records).toBe(0);
    expect(foreignTask.byTask).toEqual([]);
  });

  it('validates the time zone and the range', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const status = async (query: string) => (await api.get(`/focus/stats${query}`)).status;
    expect(await status('')).toBe(200);
    expect(await status('?tz=Mars/Olympus_Mons')).toBe(400);
    expect(await status(`?tz=${'A'.repeat(65)}`)).toBe(400);
    expect(await status('?from=2026-01-01')).toBe(400);
    expect(await status('?from=2026-01-10&to=2026-01-09')).toBe(400);
    expect(await status('?from=2026-02-01&to=2026-02-30')).toBe(400);
    expect(await status('?from=2026-1-1&to=2026-01-02')).toBe(400);
    expect(await status('?from=2026-01-01&to=2027-01-06')).toBe(200); // 371 days
    expect(await status('?from=2026-01-01&to=2027-01-07')).toBe(400);
    expect(await status(`?taskId=${'x'.repeat(129)}`)).toBe(400);
    const empty = (await api.get('/focus/stats?from=2026-01-01&to=2026-01-31&tz=Europe/Berlin')).body as unknown as Stats;
    expect(empty.total).toEqual({ pomoCount: 0, pomoSeconds: 0, stopwatchSeconds: 0, seconds: 0, records: 0, firstDay: null });
    expect(empty.period?.records).toBe(0);
    expect(empty.byHour).toHaveLength(24);
  });
});

describe('focus history', () => {
  it('pages newest first by instant through mixed offsets and ties', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    // Text order differs from instant order here: the +1400 record is the
    // oldest instant but sorts first among the 2026-06-02 strings.
    const ids = {
      tieA: (await api.focus({ type: 0, startTime: '2026-06-02T08:00:00+0800', duration: 1500 })).id, // 00:00Z
      tieB: (await api.focus({ type: 1, startTime: '2026-06-02T00:00:00Z', duration: 600 })).id, // 00:00Z
      utc: (await api.focus({ type: 0, startTime: '2026-06-02T05:00:00+0000', duration: 1500 })).id, // 05:00Z
      east: (await api.focus({ type: 0, startTime: '2026-06-02T10:00:00+1400', duration: 1500 })).id, // 06-01 20:00Z
      west: (await api.focus({ type: 0, startTime: '2026-06-01T20:00:00-0500', duration: 1500 })).id, // 06-02 01:00Z
    };
    const expected = [ids.utc, ids.west, ...[ids.tieA, ids.tieB].sort().reverse(), ids.east];

    const all = (await api.get('/focus/history')).body as { records: { id: string }[]; nextBefore: string | null };
    expect(all.records.map((r) => r.id)).toEqual(expected);
    expect(all.nextBefore).toBeNull();

    const pages = async (limit: number) => {
      const seen: string[][] = [];
      let before: string | null = '';
      while (before !== null) {
        const page = (await api.get(`/focus/history?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`)).body as {
          records: { id: string }[]; nextBefore: string | null;
        };
        seen.push(page.records.map((r) => r.id));
        before = page.nextBefore;
      }
      return seen;
    };
    expect((await pages(2)).flat()).toEqual(expected);
    // A page of three would split the tied pair: it ends before them instead.
    const threes = await pages(3);
    expect(threes).toEqual([expected.slice(0, 2), expected.slice(2)]);

    const older = (await api.get(`/focus/history?before=${encodeURIComponent('2026-06-02T01:00:00Z')}`)).body as { records: { id: string }[] };
    expect(older.records.map((r) => r.id)).toEqual(expected.slice(2));

    const other = client(await otherUser());
    expect(((await other.get('/focus/history')).body as { records: unknown[] }).records).toEqual([]);
  });

  it('pages a long history with mixed offsets without gaps or repeats', async () => {
    const { token, cookie } = await bootstrap();
    const me = (await (await SELF.fetch(`${HOST}/api/me`, { headers: { Cookie: cookie } })).json()) as { id: string };
    const offsets = [480, 0, -300, 840, -720, 330];
    const base = Date.parse('2026-01-01T00:00:00Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    const written = (ms: number, offset: number) => {
      const d = new Date(ms + offset * 60_000);
      const sign = offset < 0 ? '-' : '+';
      const abs = Math.abs(offset);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
    };
    const rows = Array.from({ length: 330 }, (_, i) => ({ id: `rec${String(i).padStart(21, '0')}`, ms: base + i * 23 * 60_000 }));
    await env.DB.batch(rows.map((row, i) => env.DB.prepare(
      'INSERT INTO focus_records (id, user_id, type, start_time, duration, created_at) VALUES (?, ?, ?, ?, 1380, 0)',
    ).bind(row.id, me.id, i % 2, written(row.ms, offsets[i % offsets.length]))));
    const expected = [...rows].sort((a, b) => b.ms - a.ms).map((row) => row.id);

    const api = client(token);
    for (const limit of [100, 7]) {
      const seen: string[] = [];
      let before: string | null = '';
      let pages = 0;
      while (before !== null && pages++ < 100) {
        const page = (await api.get(`/focus/history?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`)).body as {
          records: { id: string }[]; nextBefore: string | null;
        };
        expect(page.records.length).toBeLessThanOrEqual(limit);
        seen.push(...page.records.map((r) => r.id));
        before = page.nextBefore;
      }
      expect(seen).toEqual(expected);
    }
  });

  it('places only rows no unfetched row can precede', () => {
    // Fetched in text order with a limit of 3: the last row's wall clock
    // bounds what is still unfetched, so c (08:00Z) waits for the next page,
    // where an unfetched row could still precede it.
    const rows = [
      { id: 'a', start_time: '2026-01-02T09:00:00+0800' }, // 01:00Z
      { id: 'b', start_time: '2026-01-02T00:00:00-1200' }, // 12:00Z
      { id: 'c', start_time: '2026-01-01T08:00:00+0000' }, // 08:00Z
    ];
    const page = historyPage(rows, Number.POSITIVE_INFINITY, 10, 3);
    // safe = 2026-01-01T08:01Z + 15h = 23:01Z: only b (Jan 2 12:00Z) and a (01:00Z) are certain.
    expect(page.records.map((r) => r.id)).toEqual(['b', 'a']);
    expect(page.nextBefore).toBe(Date.parse('2026-01-01T23:01:00Z'));
  });

  it('validates its parameters', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    for (const query of ['?limit=0', '?limit=101', '?limit=abc', '?limit=1.5', '?before=yesterday', '?before=2026-02-30T00:00:00Z']) {
      expect((await api.get(`/focus/history${query}`)).status, query).toBe(400);
    }
    expect((await api.get('/focus/history?limit=100')).status).toBe(200);
  });
});

describe('focus record update', () => {
  it('updates fields, recomputes the duration and checks ownership', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    await api.get('/project');
    const task = (await api.post('/task', { title: 'Deep work', projectId: 'inbox' })).body as { id: string };
    const record = await api.focus({ type: 0, startTime: '2026-04-07T09:00:00+0800', endTime: '2026-04-07T09:25:00+0800', note: 'a' });
    expect(record).toMatchObject({ duration: 1500, added: false, etag: '0' });
    const update = (body: Json) => api.post(`/focus/${record.id}`, body);

    // ticktick-cli sends the type along.
    const noted = await update({ type: 0, note: 'b' });
    expect(noted.status).toBe(200);
    expect(noted.body).toMatchObject({ note: 'b', duration: 1500, etag: '1', startTime: '2026-04-07T09:00:00+0800' });
    expect((await update({ type: 1, note: 'c' })).status).toBe(404);

    expect((await update({ endTime: '2026-04-07T09:35:00+0800' })).body).toMatchObject({ duration: 2100 });
    expect((await update({ pauseDuration: 300 })).body).toMatchObject({ duration: 1800, pauseDuration: 300 });
    expect((await update({ duration: 1000 })).body).toMatchObject({ duration: 1000 });
    expect((await update({ note: 'kept' })).body).toMatchObject({ duration: 1000 });
    expect((await update({ startTime: '2026-04-07T10:00:00+0800' })).status).toBe(400);

    expect((await update({ taskId: task.id })).body).toMatchObject({ taskId: task.id });
    expect((await update({ taskId: null, note: '' })).body).toMatchObject({ taskId: null, note: null });
    expect((await update({ taskId: 'missing' })).status).toBe(404);
    expect((await update({ added: true })).body).toMatchObject({ added: true });

    for (const body of [{ note: 5 }, { added: 'yes' }, { startTime: '2026-02-30T09:00:00+0800' }, { duration: -1 }, { duration: '60' }, { type: '0' }, { taskId: 7 }]) {
      expect((await update(body)).status, JSON.stringify(body)).toBe(400);
    }

    const other = client(await otherUser());
    expect((await other.post(`/focus/${record.id}`, { note: 'mine now' })).status).toBe(404);
    await other.get('/project');
    const theirTask = (await other.post('/task', { title: 'Theirs', projectId: 'inbox' })).body as { id: string };
    expect((await update({ taskId: theirTask.id })).status).toBe(404);

    const stored = (await api.get(`/focus/${record.id}?type=0`)).body;
    expect(stored).toMatchObject({ note: null, taskId: null, duration: 1000, added: true, startTime: '2026-04-07T09:00:00+0800', endTime: '2026-04-07T09:35:00+0800' });
  });

  it('creates manual records and subtracts pauses from a derived duration', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const manual = await api.focus({ type: 1, startTime: '2026-04-07T09:00:00+0800', endTime: '2026-04-07T09:30:00+0800', pauseDuration: 300, added: true });
    expect(manual).toMatchObject({ duration: 1500, pauseDuration: 300, added: true });
    const reversed = await api.post('/focus', { type: 0, startTime: '2026-04-07T09:30:00+0800', endTime: '2026-04-07T09:00:00+0800', duration: 60 });
    expect(reversed.status).toBe(400);
    expect((await api.post('/focus', { type: 0, added: 1 })).status).toBe(400);

    expect((await api.del(`/focus/${manual.id}?type=0`)).status).toBe(404);
    expect((await api.del(`/focus/${manual.id}?type=1`)).body).toMatchObject({ id: manual.id });
    expect((await api.get(`/focus/${manual.id}?type=1`)).status).toBe(404);
  });

  it('round-trips the manual flag through backups', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    await api.focus({ type: 1, startTime: '2026-04-07T09:00:00+0800', duration: 600, added: true });
    const backup = (await api.get('/backup/export')).body as { focusRecords: Json[] };
    expect(backup.focusRecords[0].added).toBe(1);
    // Older backups have no `added` column: it defaults to 0.
    const legacy = { ...backup.focusRecords[0], id: 'legacy00000000000000000a' } as Json;
    delete legacy.added;
    const imported = await api.post('/backup/import', { app: 'nodetick', focusRecords: [legacy] });
    expect(imported.body).toEqual({ imported: 1, skipped: 0 });
    expect((await api.get('/focus/legacy00000000000000000a?type=1')).body).toMatchObject({ added: false, duration: 600 });
  });
});

describe('focus database usage', () => {
  /** The worker with a D1 binding that counts queries like the Free plan's per-request limit. */
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

  it('answers stats, history and edits in one round trip after the session lookup', async () => {
    const { cookie } = await bootstrap();
    const counter = countingWorker();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const call = async (path: string, init: RequestInit = {}) => {
      counter.reset();
      const res = await counter.fetch(path, { ...init, headers });
      expect(res.status, path).toBe(200);
      return { body: (await res.json()) as Json, queries: counter.queries() };
    };
    await call('/open/v1/project'); // warm the schema check
    const created = await call('/open/v1/focus', { method: 'POST', body: JSON.stringify({ type: 0, startTime: '2026-04-07T09:00:00+0800', duration: 1500 }) });
    expect(created.queries).toBe(2);
    expect((await call('/open/v1/focus/stats?from=2025-11-21&to=2026-11-20&tz=Asia/Shanghai')).queries).toBe(2);
    expect((await call('/open/v1/focus/stats?tz=Asia/Shanghai')).queries).toBe(2);
    expect((await call('/open/v1/focus/history?limit=50')).queries).toBe(2);
    expect((await call(`/open/v1/focus/${created.body.id}`, { method: 'POST', body: JSON.stringify({ note: 'x' }) })).queries).toBe(3);
    expect((await call(`/open/v1/focus/${created.body.id}?type=0`, { method: 'DELETE' })).queries).toBe(2);
  });

  it('reads history and stats ranges through the start-time index', async () => {
    await ensureSchema(env);
    const plan = async (sql: string, ...params: unknown[]) =>
      (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()).results.map((row) => row.detail).join('\n');
    expect(await plan('SELECT * FROM focus_records WHERE user_id = ? AND start_time < ? ORDER BY start_time DESC LIMIT ?', 'u', '2026', 10))
      .toContain('USING INDEX idx_focus_user_start (user_id=? AND start_time<?)');
    expect(await plan('SELECT * FROM focus_records WHERE user_id = ? AND start_time IS NOT NULL ORDER BY start_time DESC LIMIT ?', 'u', 10))
      .toContain('USING INDEX idx_focus_user_start');
    expect(await plan('SELECT type, start_time, end_time, duration, task_id FROM focus_records WHERE user_id = ? AND start_time >= ? AND start_time < ? LIMIT ?', 'u', '2026', '2027', 10))
      .toContain('USING INDEX idx_focus_user_start (user_id=? AND start_time>? AND start_time<?)');
    expect(await plan('SELECT COUNT(*) FROM focus_records WHERE user_id = ? AND task_id = ?', 'u', 't'))
      .toContain('idx_focus_user_task');
  });
});
