import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, env, reset, SELF } from 'cloudflare:test';
import worker from '../src/index.js';
import { issueApiToken } from '../src/auth.js';
import { ensureSchema, resetSchemaCheck } from '../src/db.js';
import { serializeCountdown } from '../src/serialize.js';
import {
  countdownBody,
  countdownFallsOn,
  countdownReminderCandidates,
  dispatchDueNotifications,
  localizedPayload,
} from '../src/services/notifications.js';
import {
  LUNAR_MAX_YEAR,
  LUNAR_MIN_YEAR,
  leapMonthOf,
  lunarAnniversary,
  lunarMonthDays,
  lunarNewYear,
  lunarToSolar,
  lunarYearlyFallsOn,
  nextLunarYearly,
  solarToLunar,
} from '../src/lunar.js';

// Same isolation as api.test.ts: a fresh D1 and schema check per test.
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
async function bootstrap(): Promise<{ token: string; cookie: string; userId: string }> {
  const reg = await SELF.fetch(`${HOST}/api/register`, { ...json({ email: EMAIL, password: PASSWORD }), redirect: 'manual' });
  expect(reg.status).toBe(200);
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];
  const created = await SELF.fetch(`${HOST}/api/tokens`, { ...json({ name: 'test' }, { Cookie: cookie }) });
  expect(created.status).toBe(200);
  const token = ((await created.json()) as { token: string }).token;
  const me = (await (await SELF.fetch(`${HOST}/api/me`, { headers: { Cookie: cookie } })).json()) as { id: string };
  return { token, cookie, userId: me.id };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

type Countdown = Record<string, unknown> & { id: string };

function client(token: string) {
  const call = (method: string, path: string, body?: unknown) =>
    SELF.fetch(`${HOST}/open/v1${path}`, { method, headers: auth(token), body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    call,
    create: async (body: unknown) => {
      const res = await call('POST', '/countdown', body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      return (await res.json()) as Countdown;
    },
    update: async (id: string, body: unknown) => {
      const res = await call('POST', `/countdown/${id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      return (await res.json()) as Countdown;
    },
    list: async () => (await (await call('GET', '/countdown')).json()) as Countdown[],
  };
}

describe('countdown API', () => {
  it('creates, returns and lists every field', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const created = await api.create({
      name: '  Mom  ', date: '1990-10-03', kind: 'birthday', reminders: ['1-week', 'same-day', '1-day', 'same-day'],
      reminderTime: '08:30', repeatFlag: 'yearly', lunar: true, calculation: 'standard', style: 3,
      color: '#E5484D', icon: '🎂', numberFormat: 'ymd', note: 'Buy flowers', pinned: true, showInCalendar: false,
    });
    expect(created).toMatchObject({
      name: 'Mom', date: '1990-10-03', kind: 'birthday',
      // Deduplicated and ordered by lead.
      reminders: ['same-day', '1-day', '1-week'],
      reminderTime: '08:30', repeatFlag: 'yearly', lunar: true, style: 3, color: '#E5484D', icon: '🎂',
      numberFormat: 'ymd', note: 'Buy flowers', pinned: true, archived: false, archivedTime: null,
      showInCalendar: false, sortOrder: 0, displayMode: 'on-day',
    });
    expect(Date.parse(String(created.createdTime))).toBeGreaterThan(Date.now() - 60_000);

    // Defaults for a minimal countdown.
    const minimal = await api.create({ name: 'Launch', date: '2027-01-01' });
    expect(minimal).toMatchObject({
      kind: 'countdown', reminders: [], reminderTime: null, repeatFlag: null, lunar: false, calculation: 'standard',
      style: 0, color: '#4772FA', icon: null, numberFormat: 'days', note: '', pinned: false, archived: false, showInCalendar: true,
    });
    expect((await api.list()).map((c) => c.id).sort()).toEqual([created.id, minimal.id].sort());
  });

  it('updates fields partially, archives with a timestamp and resets the reminder time', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const created = await api.create({ name: 'Trip', date: '2027-03-01', reminders: ['3-days'], reminderTime: '07:00', note: 'Passports' });

    const archived = await api.update(created.id, { archived: true });
    expect(archived).toMatchObject({ archived: true, name: 'Trip', note: 'Passports', reminders: ['3-days'], reminderTime: '07:00' });
    expect(Date.parse(String(archived.archivedTime))).toBeGreaterThan(Date.now() - 60_000);
    // Archiving again keeps the original archive time.
    expect((await api.update(created.id, { archived: true })).archivedTime).toBe(archived.archivedTime);

    const restored = await api.update(created.id, { archived: false, reminderTime: null, note: '', repeatFlag: 'monthly' });
    expect(restored).toMatchObject({ archived: false, archivedTime: null, reminderTime: null, note: '', repeatFlag: 'monthly' });
    // An empty repeat clears it, like null.
    expect((await api.update(created.id, { repeatFlag: '' })).repeatFlag).toBeNull();
    expect((await api.update(created.id, { pinned: true, sortOrder: 5, numberFormat: 'ymd', showInCalendar: false }))).toMatchObject({
      pinned: true, sortOrder: 5, numberFormat: 'ymd', showInCalendar: false, name: 'Trip',
    });
  });

  it('rejects malformed input with 400', async () => {
    const { token } = await bootstrap();
    const api = client(token);
    const base = { name: 'x', date: '2026-12-31' };
    const bad: Record<string, unknown>[] = [
      { ...base, date: '2026-02-30' },
      { ...base, reminders: ['tomorrow'] },
      { ...base, reminders: 'same-day' },
      { ...base, reminders: Array(11).fill('same-day') },
      { ...base, reminderTime: '9:00' },
      { ...base, reminderTime: '24:00' },
      { ...base, reminderTime: 900 },
      { ...base, note: 123 },
      { ...base, note: 'x'.repeat(4001) },
      { ...base, pinned: 'yes' },
      { ...base, archived: 1 },
      { ...base, lunar: 'true' },
      { ...base, showInCalendar: 0 },
      { ...base, numberFormat: 'weeks' },
      { ...base, repeatFlag: 'weekly' },
      { ...base, repeatFlag: 5 },
      { ...base, style: 5 },
      { ...base, color: 'red' },
      { ...base, kind: 'party' },
      // Lunar dates need the 1900–2100 table.
      { ...base, date: '1900-01-30', lunar: true },
      { ...base, date: '2101-01-01', lunar: true },
    ];
    for (const body of bad) {
      expect((await api.call('POST', '/countdown', body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    const created = await api.create(base);
    for (const body of [{ reminders: ['1-year'] }, { pinned: null, archived: 'no' }, { reminderTime: '12:60' }, { date: '' }, { name: '   ' }]) {
      expect((await api.call('POST', `/countdown/${created.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await api.list())[0]).toMatchObject({ name: 'x', reminders: [], pinned: false });
  });

  it("never reads or writes another user's countdowns", async () => {
    const { token } = await bootstrap();
    const owner = client(token);
    const mine = await owner.create({ name: 'Mine', date: '2027-01-01', note: 'secret' });
    await env.DB.prepare('INSERT INTO users (id, email, password_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('other-user', 'other@example.com', 'test-only', '33'.repeat(16), 0, Date.now()).run();
    const other = client(await issueApiToken(env.DB, 'other-user', 'test'));
    expect(await other.list()).toEqual([]);
    expect((await other.call('POST', `/countdown/${mine.id}`, { archived: true })).status).toBe(404);
    expect((await other.call('DELETE', `/countdown/${mine.id}`)).status).toBe(404);
    expect((await owner.list())[0]).toMatchObject({ id: mine.id, archived: false, note: 'secret' });
  });

  it('reads legacy sort orders as pinned / archived and writes the real flags on the next save', async () => {
    const { token, userId } = await bootstrap();
    const api = client(token);
    await ensureSchema(env);
    const insert = (id: string, name: string, order: number) =>
      env.DB.prepare('INSERT INTO countdowns (id, user_id, name, date, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, userId, name, '2027-05-01', order, Date.now()).run();
    await insert('legacy-pinned', 'Pinned', -1_000_000_000);
    await insert('legacy-archived', 'Archived', 1_000_000_000);
    await insert('legacy-restored', 'Restored', 1_000_000_000);
    const byId = async () => Object.fromEntries((await api.list()).map((c) => [c.id, c]));
    const listed = await byId();
    expect(listed['legacy-pinned']).toMatchObject({ pinned: true, archived: false, sortOrder: 0 });
    expect(listed['legacy-archived']).toMatchObject({ pinned: false, archived: true, sortOrder: 0 });

    expect(await api.update('legacy-pinned', { name: 'Pinned!' })).toMatchObject({ name: 'Pinned!', pinned: true, sortOrder: 0 });
    const archived = await api.update('legacy-archived', { note: 'moved' });
    expect(archived).toMatchObject({ archived: true, sortOrder: 0, note: 'moved' });
    expect(archived.archivedTime).not.toBeNull();
    expect(await api.update('legacy-restored', { archived: false })).toMatchObject({ archived: false, archivedTime: null, sortOrder: 0 });
    const rows = await env.DB.prepare('SELECT id, pinned, archived, sort_order FROM countdowns ORDER BY id').all();
    expect(rows.results).toEqual([
      { id: 'legacy-archived', pinned: 0, archived: 1, sort_order: 0 },
      { id: 'legacy-pinned', pinned: 1, archived: 0, sort_order: 0 },
      { id: 'legacy-restored', pinned: 0, archived: 0, sort_order: 0 },
    ]);
  });

  it('answers list, create and update in one database round trip each', async () => {
    const { cookie } = await bootstrap();
    const counter = countingWorker();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const call = async (path: string, init: RequestInit = {}) => {
      counter.reset();
      const res = await counter.fetch(path, { ...init, headers });
      expect(res.status, path).toBe(200);
      return { body: (await res.json()) as Countdown, queries: counter.queries() };
    };
    await call('/open/v1/countdown'); // warm the schema check
    // Each count includes the session lookup.
    const created = await call('/open/v1/countdown', { method: 'POST', body: JSON.stringify({ name: 'Hot', date: '2027-01-01', reminders: ['same-day'] }) });
    expect(created.queries).toBe(2);
    expect((await call(`/open/v1/countdown/${created.body.id}`, { method: 'POST', body: JSON.stringify({ pinned: true, note: 'n' }) })).queries).toBe(2);
    expect((await call('/open/v1/countdown')).queries).toBe(2);
  });
});

describe('lunar calendar', () => {
  it('finds the Spring Festival of each year', () => {
    const springFestivals: Record<number, string> = {
      1900: '1900-01-31', 1949: '1949-01-29', 1950: '1950-02-17', 1954: '1954-02-03', 1980: '1980-02-16', 1990: '1990-01-27',
      2000: '2000-02-05', 2001: '2001-01-24', 2008: '2008-02-07', 2010: '2010-02-14', 2020: '2020-01-25',
      2021: '2021-02-12', 2022: '2022-02-01', 2023: '2023-01-22', 2024: '2024-02-10', 2025: '2025-01-29',
      2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03',
      2031: '2031-01-23', 2033: '2033-01-31', 2050: '2050-01-23', 2100: '2100-02-09',
    };
    for (const [year, day] of Object.entries(springFestivals)) {
      expect(lunarNewYear(Number(year)), year).toBe(day);
      expect(solarToLunar(day)).toEqual({ year: Number(year), month: 1, day: 1, leap: false });
    }
    // The day before is 除夕 of the previous lunar year.
    expect(solarToLunar('2027-02-05')).toEqual({ year: 2026, month: 12, day: 29, leap: false });
  });

  it("handles 2023's leap second month and the 2033 leap eleventh month", () => {
    expect(leapMonthOf(2023)).toBe(2);
    expect(lunarMonthDays(2023, 2)).toBe(30);
    expect(lunarMonthDays(2023, 2, true)).toBe(29);
    expect(solarToLunar('2023-03-21')).toEqual({ year: 2023, month: 2, day: 30, leap: false });
    expect(solarToLunar('2023-03-22')).toEqual({ year: 2023, month: 2, day: 1, leap: true });
    expect(solarToLunar('2023-04-19')).toEqual({ year: 2023, month: 2, day: 29, leap: true });
    expect(solarToLunar('2023-04-20')).toEqual({ year: 2023, month: 3, day: 1, leap: false });
    expect(lunarToSolar(2023, 2, 1, true)).toBe('2023-03-22');
    expect(lunarToSolar(2024, 2, 1, true)).toBeNull(); // 2024 has no leap month 2
    expect(lunarToSolar(2023, 2, 30, true)).toBeNull(); // the leap month has 29 days
    expect(leapMonthOf(2033)).toBe(11);
    expect(lunarToSolar(2033, 11, 1, true)).toBe('2033-12-22');
    // Mid-Autumn (八月十五) and Dragon Boat (五月初五).
    expect(['2023-09-29', '2024-09-17', '2025-10-06', '2026-09-25'].map((day) => solarToLunar(day))).toEqual(
      [2023, 2024, 2025, 2026].map((year) => ({ year, month: 8, day: 15, leap: false })),
    );
    expect(lunarToSolar(2026, 5, 5)).toBe('2026-06-19');
    expect(solarToLunar('1900-01-30')).toBeNull();
    expect(solarToLunar('2101-01-01')).toBeNull();
    expect(solarToLunar('2026-02-30')).toBeNull();
  });

  it('round-trips every day from 1900 to 2100', () => {
    let previous: { year: number; month: number; day: number; leap: boolean } | null = null;
    for (let ms = Date.UTC(1900, 0, 31); ms <= Date.UTC(2100, 11, 31); ms += 86400000) {
      const day = new Date(ms).toISOString().slice(0, 10);
      const lunar = solarToLunar(day)!;
      expect(lunarToSolar(lunar.year, lunar.month, lunar.day, lunar.leap)).toBe(day);
      if (previous && lunar.day !== 1) expect(lunar.day).toBe(previous.day + 1);
      previous = lunar;
    }
  });

  it('moves leap-month and 30th anniversaries to days that exist', () => {
    const leapBorn = solarToLunar('2023-03-22')!; // 闰二月初一
    expect(lunarAnniversary(leapBorn, 2024)).toBe(lunarToSolar(2024, 2, 1)); // no leap 2nd month: the regular one
    // Find a 30th whose month is short the next year: it falls on the 29th.
    let checked = 0;
    for (let year = 2000; year < 2040; year++) {
      for (let month = 1; month <= 12; month++) {
        if (lunarMonthDays(year, month) !== 30 || lunarMonthDays(year + 1, month) !== 29) continue;
        const original = solarToLunar(lunarToSolar(year, month, 30)!)!;
        expect(lunarAnniversary(original, year + 1)).toBe(lunarToSolar(year + 1, month, 29));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(nextLunarYearly('1990-10-03', '2026-11-20')).toBe(lunarToSolar(2027, 8, 15));
    expect(nextLunarYearly('1990-10-03', '2026-09-25')).toBe('2026-09-25');
    expect(nextLunarYearly('2030-01-01', '2026-11-20')).toBe('2030-01-01'); // not started yet
    expect(lunarYearlyFallsOn('1990-10-03', '2026-09-25')).toBe(true);
    expect(lunarYearlyFallsOn('1990-10-03', '2026-10-03')).toBe(false);
    expect(lunarYearlyFallsOn('1990-10-03', '1989-09-14')).toBe(false); // before the start
  });

  it.runIf(chineseCalendarAvailable())('matches the runtime Chinese calendar at every month start, apart from documented years', () => {
    // ICU computes new moons astronomically and lands a day off when one falls
    // within minutes of Beijing midnight (e.g. 2027-02-06 23:56, 2030-02-03
    // 00:07, 2012-08-17 23:54); it also disagrees on 1987's leap month and on
    // the pre-1929 years. The table follows the published calendar there.
    const disputed = new Set([1917, 1922, 1953, 1954, 1955, 1987, 1998, 2012, 2018, 2026, 2027, 2029, 2030, 2070]);
    const format = new Intl.DateTimeFormat('en-US-u-ca-chinese', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
    let months = 0;
    for (let year = LUNAR_MIN_YEAR; year <= LUNAR_MAX_YEAR; year++) {
      if (disputed.has(year)) continue;
      for (let month = 1; month <= 12; month++) {
        for (const leap of month === leapMonthOf(year) ? [false, true] : [false]) {
          const first = lunarToSolar(year, month, 1, leap)!;
          const parts = Object.fromEntries(format.formatToParts(new Date(`${first}T00:00:00Z`)).map((p) => [p.type, p.value]));
          expect(`${parts.relatedYear}-${parts.month}-${parts.day}`, first).toBe(`${year}-${month}${leap ? 'bis' : ''}-1`);
          months++;
        }
      }
    }
    expect(months).toBeGreaterThan(2300);
  });
});

describe('countdown reminder candidates', () => {
  const setting = { user_id: 'u1', timezone: 'Asia/Shanghai', all_day_time: '09:00', sound_enabled: 1 };
  const ALL = ['same-day', '1-day', '2-days', '3-days', '1-week', '1-month'];
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'c1', name: 'Launch', icon: null, date: '2026-12-25', reminders: JSON.stringify(ALL), repeat_flag: null,
    reminder_time: null, lunar: 0, calculation: 'standard', ...overrides,
  });
  /** Candidates at 09:00 Shanghai (01:00Z) on `day`, as [token, zh body, en body]. */
  const at = (day: string, overrides: Record<string, unknown> = {}, instant = `${day}T01:00:00Z`) =>
    countdownReminderCandidates(row(overrides), setting, Date.parse(instant)).map((candidate) => [
      candidate.dedupeKey.split(':').pop(), localizedPayload(candidate, 'zh').body, localizedPayload(candidate, 'en').body,
    ]);

  it('announces each lead on its day with localized bodies', () => {
    expect(at('2026-12-25')).toEqual([['same-day', '今天', 'Today']]);
    expect(at('2026-12-24')).toEqual([['1-day', '还有 1 天', '1 day to go']]);
    expect(at('2026-12-23')).toEqual([['2-days', '还有 2 天', '2 days to go']]);
    expect(at('2026-12-22')).toEqual([['3-days', '还有 3 天', '3 days to go']]);
    expect(at('2026-12-18')).toEqual([['1-week', '还有 7 天', '7 days to go']]);
    expect(at('2026-11-25')).toEqual([['1-month', '还有 30 天', '30 days to go']]);
    for (const day of ['2026-12-21', '2026-11-24', '2026-11-26', '2026-12-26']) expect(at(day), day).toEqual([]);
    // Only the selected tokens fire; the legacy pair keeps working.
    expect(at('2026-12-22', { reminders: '["same-day","3-days"]' })).toEqual([['3-days', '还有 3 天', '3 days to go']]);
    expect(at('2026-12-24', { reminders: '["same-day","3-days"]' })).toEqual([]);
    const [candidate] = countdownReminderCandidates(row({ icon: '🚀' }), setting, Date.parse('2026-12-25T01:00:00Z'));
    expect(candidate).toMatchObject({ title: '🚀 Launch', url: '/app/countdown?countdown=c1', tag: 'countdown-c1-2026-12-25', sourceType: 'countdown' });
  });

  it('reminds a calendar month ahead, short months on their last day', () => {
    expect(at('2027-02-28', { date: '2027-03-31', reminders: '["1-month"]' })).toEqual([['1-month', '还有 31 天', '31 days to go']]);
    expect(at('2027-02-28', { date: '2027-03-29', reminders: '["1-month"]' })).toEqual([['1-month', '还有 29 天', '29 days to go']]);
    expect(at('2027-03-01', { date: '2027-03-31', reminders: '["1-month"]' })).toEqual([]);
    expect(at('2028-02-29', { date: '2028-03-31', reminders: '["1-month"]' })).toEqual([['1-month', '还有 31 天', '31 days to go']]);
    expect(at('2027-01-31', { date: '2027-02-28', reminders: '["1-month"]' })).toEqual([]);
    expect(at('2027-01-28', { date: '2027-02-28', reminders: '["1-month"]' })).toEqual([['1-month', '还有 31 天', '31 days to go']]);
    // A monthly repeat announces next month's occurrence on this month's.
    expect(at('2026-11-15', { date: '2026-01-15', repeat_flag: 'monthly', reminders: '["same-day","1-month"]' })).toEqual([
      ['same-day', '今天', 'Today'], ['1-month', '还有 30 天', '30 days to go'],
    ]);
  });

  it("fires at the countdown's reminder time in the user's zone, else at the all-day time", () => {
    const newYork = { ...setting, timezone: 'America/New_York' };
    const candidates = (time: string | null, instant: string, zone = newYork) =>
      countdownReminderCandidates(row({ reminder_time: time, reminders: '["same-day"]' }), zone, Date.parse(instant)).length;
    // 20:30 on Dec 25 in New York (EST, UTC-5) is 01:30Z on Dec 26.
    expect(candidates('20:30', '2026-12-26T01:30:00Z')).toBe(1);
    expect(candidates('20:30', '2026-12-26T01:39:00Z')).toBe(1); // still inside the cron's lookback
    expect(candidates('20:30', '2026-12-26T01:45:00Z')).toBe(0);
    expect(candidates('20:30', '2026-12-25T14:00:00Z')).toBe(0); // 09:00 local: the all-day time does not apply
    expect(candidates(null, '2026-12-25T14:00:00Z')).toBe(1);
    expect(candidates(null, '2026-12-25T13:00:00Z', { ...newYork, all_day_time: '08:00' })).toBe(1);
    expect(candidates('99:99', '2026-12-25T14:00:00Z')).toBe(1); // malformed: the all-day time
    // Summer time: 20:30 EDT (UTC-4) on Jul 4.
    const july = (instant: string) => countdownReminderCandidates(
      row({ date: '2026-07-04', reminder_time: '20:30', reminders: '["same-day"]' }), newYork, Date.parse(instant)).length;
    expect(july('2026-07-05T00:30:00Z')).toBe(1);
    expect(july('2026-07-05T01:30:00Z')).toBe(0);
  });

  it('counts workdays for workday countdowns', () => {
    // 2026-12-25 is a Friday; 2026-12-28 a Monday.
    expect(new Date('2026-12-25T00:00:00Z').getUTCDay()).toBe(5);
    const workday = { calculation: 'workday', date: '2026-12-28' };
    expect(at('2026-12-25', workday)).toEqual([['3-days', '还有 1 个工作日', '1 workday to go']]);
    expect(at('2026-12-21', workday)).toEqual([['1-week', '还有 5 个工作日', '5 workdays to go']]);
    // Friday to Sunday has no workday in between: calendar days instead.
    expect(at('2026-12-25', { calculation: 'workday', date: '2026-12-27' })).toEqual([['2-days', '还有 2 天', '2 days to go']]);
    expect(countdownBody(0, true)).toEqual({ zh: '今天', en: 'Today' });
  });

  it('repeats lunar countdowns on their lunar date', () => {
    const midAutumn = { date: '1990-10-03', repeat_flag: 'yearly', lunar: 1, reminders: '["same-day","3-days"]' };
    expect(solarToLunar('1990-10-03')).toEqual({ year: 1990, month: 8, day: 15, leap: false });
    expect(at('2026-09-25', midAutumn)).toEqual([['same-day', '今天', 'Today']]);
    expect(at('2026-09-22', midAutumn)).toEqual([['3-days', '还有 3 天', '3 days to go']]);
    expect(at('2026-10-03', midAutumn)).toEqual([]); // the solar anniversary is not it
    expect(at('2026-10-03', { ...midAutumn, lunar: 0 })).toEqual([['same-day', '今天', 'Today']]);
    // Born in 2023's leap second month: the regular second month in other years.
    const leapBorn = { date: '2023-03-22', repeat_flag: 'yearly', lunar: 1, reminders: '["same-day"]' };
    expect(at('2023-03-22', leapBorn)).toEqual([['same-day', '今天', 'Today']]);
    expect(at('2024-03-10', leapBorn)).toEqual([['same-day', '今天', 'Today']]);
    expect(countdownFallsOn('2023-03-22', 'yearly', '2024-03-10', true)).toBe(true);
    expect(countdownFallsOn('2023-03-22', 'yearly', '2024-03-22', true)).toBe(false);
    // Lunar only changes yearly repeats; one-off dates stay put.
    expect(countdownFallsOn('2026-09-25', null, '2026-09-25', true)).toBe(true);
    expect(countdownFallsOn('2026-01-31', 'monthly', '2026-02-28', true)).toBe(true);
  });
});

describe('countdown reminder dispatch', () => {
  // Real-time-adjacent day so the hourly delivery cleanup keeps our claims.
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const b64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function pushEnv() {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    return { ...env, VAPID_PUBLIC_KEY: b64url(publicKey), VAPID_PRIVATE_KEY: privateKey.d!, VAPID_SUBJECT: 'mailto:test@example.com' };
  }

  async function pushUser() {
    const { token, userId } = await bootstrap();
    const saved = await SELF.fetch(`${HOST}/open/v1/notification/settings`, {
      method: 'PUT', headers: auth(token), body: JSON.stringify({
        enabled: true, taskEnabled: true, habitEnabled: true, countdownEnabled: true, soundEnabled: true,
        timezone: 'Asia/Shanghai', allDayTime: '09:00',
      }),
    });
    expect(saved.status).toBe(200);
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const p256dh = b64url(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    await env.DB.prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), userId, 'https://push.example/device', p256dh, b64url(crypto.getRandomValues(new Uint8Array(16))), Date.now(), Date.now()).run();
    return { api: client(token), userId };
  }

  it('sends at the reminder time once, and never for archived countdowns', async () => {
    const { api, userId } = await pushUser();
    await api.create({ name: 'Evening', date: day, reminders: ['same-day'], reminderTime: '21:30' });
    await api.create({ name: 'Archived', date: day, reminders: ['same-day'], reminderTime: '21:30', archived: true });
    const restored = await api.create({ name: 'Restored', date: day, reminders: ['same-day'], reminderTime: '21:30', archived: true });
    await api.update(restored.id, { archived: false });
    // Archived and pinned by a web build from before the columns.
    await env.DB.prepare(
      "INSERT INTO countdowns (id, user_id, name, date, reminders, reminder_time, sort_order, created_at) VALUES (?, ?, ?, ?, '[\"same-day\"]', '21:30', ?, ?)",
    ).bind('legacy-archived', userId, 'Legacy archived', day, 1_000_000_000, Date.now()).run();
    await env.DB.prepare(
      "INSERT INTO countdowns (id, user_id, name, date, reminders, reminder_time, sort_order, created_at) VALUES (?, ?, ?, ?, '[\"same-day\"]', '21:30', ?, ?)",
    ).bind('legacy-pinned', userId, 'Legacy pinned', day, -1_000_000_000, Date.now()).run();
    const testEnv = await pushEnv();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 201 }));
    try {
      // 21:30 in Shanghai is 13:30Z; 09:00 (the all-day time) is not it.
      expect(await dispatchDueNotifications(testEnv, Date.parse(`${day}T01:00:00Z`))).toEqual({ candidates: 0, sent: 0, failed: 0 });
      expect(await dispatchDueNotifications(testEnv, Date.parse(`${day}T13:30:00Z`))).toEqual({ candidates: 3, sent: 3, failed: 0 });
      // The next cron run still sees them inside the lookback window: no resend.
      expect(await dispatchDueNotifications(testEnv, Date.parse(`${day}T13:31:00Z`))).toEqual({ candidates: 3, sent: 0, failed: 0 });
    } finally {
      fetchSpy.mockRestore();
    }
    const sent = await env.DB.prepare('SELECT source_id FROM notification_deliveries ORDER BY source_id').all<{ source_id: string }>();
    const ids = (await api.list()).filter((c) => ['Evening', 'Restored'].includes(String(c.name))).map((c) => c.id);
    expect(sent.results.map((r) => r.source_id).sort()).toEqual([...ids, 'legacy-pinned'].sort());
  });

  it('scans only unarchived countdowns with reminders through the partial index', async () => {
    await ensureSchema(env);
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT id, name, icon, date, reminders, repeat_flag, reminder_time, lunar, calculation
       FROM countdowns INDEXED BY idx_countdowns_reminders
       WHERE user_id = ? AND reminders != '[]' AND archived = 0 AND sort_order < 1000000000`,
    ).bind('u').all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join('\n')).toContain('USING INDEX idx_countdowns_reminders');
    const list = await env.DB.prepare('EXPLAIN QUERY PLAN SELECT * FROM countdowns WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
      .bind('u').all<{ detail: string }>();
    expect(list.results.map((row) => row.detail).join('\n')).toContain('USING INDEX idx_countdowns_user_order');
  });
});

describe('countdown schema upgrade', () => {
  it('adds the new columns and indexes to an older countdowns table, keeping its rows', async () => {
    await ensureSchema(env);
    await env.DB.prepare('DROP TABLE countdowns').run();
    // The table as deployed before notes, pin/archive and lunar dates.
    await env.DB.prepare(`CREATE TABLE countdowns (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, date TEXT, kind TEXT NOT NULL DEFAULT 'countdown',
      reminders TEXT NOT NULL DEFAULT '[]', repeat_flag TEXT, calculation TEXT NOT NULL DEFAULT 'standard',
      display_mode TEXT NOT NULL DEFAULT 'on-day', style INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#4772FA',
      icon TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`).run();
    await env.DB.prepare(
      "INSERT INTO countdowns (id, user_id, name, date, reminders, sort_order, created_at) VALUES ('old', 'u', 'Old', '2027-01-01', '[\"same-day\"]', 1000000000, 1)",
    ).run();
    await env.DB.prepare("UPDATE schema_meta SET version = 'older'").run();
    resetSchemaCheck();
    await ensureSchema(env);
    const row = await env.DB.prepare("SELECT * FROM countdowns WHERE id = 'old'").first<Record<string, unknown>>();
    expect(row).toMatchObject({
      name: 'Old', note: '', pinned: 0, archived: 0, archived_at: null, reminder_time: null, lunar: 0, number_format: 'days', show_in_calendar: 1,
    });
    expect(serializeCountdown(row!)).toMatchObject({ archived: true, sortOrder: 0, showInCalendar: true });
    const indexes = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'countdowns'").all<{ name: string }>();
    expect(indexes.results.map((index) => index.name)).toEqual(expect.arrayContaining(['idx_countdowns_user_order', 'idx_countdowns_reminders']));
  });
});

describe('countdown backup', () => {
  it('round-trips the new fields and imports older backups with defaults', async () => {
    const { token, cookie } = await bootstrap();
    const api = client(token);
    const created = await api.create({
      name: 'Anniversary', date: '2019-05-20', kind: 'anniversary', reminders: ['same-day', '1-week'], reminderTime: '19:00',
      repeatFlag: 'yearly', lunar: true, note: 'Dinner', pinned: true, numberFormat: 'ymd', showInCalendar: false, style: 4,
    });
    const archived = await api.update(created.id, { archived: true });
    const backup = (await (await SELF.fetch(`${HOST}/api/export`, { headers: { Cookie: cookie } })).json()) as { countdowns: Record<string, unknown>[] };
    await api.update(created.id, { note: 'changed', pinned: false, archived: false, lunar: false, reminderTime: null, numberFormat: 'days', showInCalendar: true });

    // A row exported before the new columns existed, archived the legacy way.
    const legacy = {
      id: 'legacy-row', name: 'Old', date: '2027-01-01', kind: 'holiday', reminders: '["3-days"]', repeat_flag: 'yearly',
      calculation: 'standard', display_mode: 'always', style: 1, color: '#43A047', icon: null, sort_order: 1_000_000_000, created_at: Date.now(),
    };
    const imported = await SELF.fetch(`${HOST}/api/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ app: 'nodetick', countdowns: [...backup.countdowns, legacy] }),
    });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({ imported: 2, skipped: 0 });
    const byId = Object.fromEntries((await api.list()).map((c) => [c.id, c]));
    expect(byId[created.id]).toEqual(archived);
    expect(byId['legacy-row']).toMatchObject({
      name: 'Old', archived: true, pinned: false, sortOrder: 0, note: '', lunar: false, reminderTime: null,
      numberFormat: 'days', showInCalendar: true, displayMode: 'always', reminders: ['3-days'],
    });
  });
});

function chineseCalendarAvailable(): boolean {
  try {
    return new Intl.DateTimeFormat('en-US-u-ca-chinese').resolvedOptions().calendar === 'chinese';
  } catch {
    return false;
  }
}

/** The worker with a D1 binding that counts queries like the per-request limit does (see api.test.ts). */
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
