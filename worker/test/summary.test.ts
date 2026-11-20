import { afterEach, describe, expect, it } from 'vitest';
import { env, reset, SELF } from 'cloudflare:test';
import { resetSchemaCheck } from '../src/db.js';
import { DEFAULT_SUMMARY_CONFIG, MAX_SUMMARY_TEMPLATES } from '../src/services/summary.js';

afterEach(async () => {
  await reset();
  resetSchemaCheck();
});

const HOST = 'https://nodetick.test';

async function signUp(): Promise<string> {
  const reg = await SELF.fetch(`${HOST}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'hunter2hunter2' }),
    redirect: 'manual',
  });
  expect(reg.status).toBe(200);
  return reg.headers.get('set-cookie')!.split(';')[0];
}

async function secondUser(adminCookie: string): Promise<string> {
  const created = await SELF.fetch(`${HOST}/api/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie, Origin: HOST },
    body: JSON.stringify({ email: 'second@example.com', password: 'hunter2hunter2', admin: false }),
  });
  expect(created.status).toBe(200);
  const login = await SELF.fetch(`${HOST}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: HOST },
    body: JSON.stringify({ email: 'second@example.com', password: 'hunter2hunter2' }),
  });
  return login.headers.get('set-cookie')!.split(';')[0];
}

function api(cookie: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await SELF.fetch(`${HOST}/open/v1${path}`, {
      method,
      headers: { Cookie: cookie, Origin: HOST, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

describe('summary state', () => {
  it('starts from the defaults and keeps config and draft apart', async () => {
    const call = api(await signUp());
    expect((await call('GET', '/summary/state')).body).toEqual({ config: DEFAULT_SUMMARY_CONFIG, draft: null, draftKey: null, modifiedTime: null });

    // Missing keys default, lists come back in a fixed order without repeats, and the title is always shown.
    const saved = await call('POST', '/summary/state', {
      config: { range: 'custom', from: '2026-11-01', to: '2026-11-30', statuses: ['open', 'completed', 'open'], fields: ['list', 'status'], priorities: [5, 0], tags: ['work', 'work'], extra: 1 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.config).toEqual({
      ...DEFAULT_SUMMARY_CONFIG,
      range: 'custom', from: '2026-11-01', to: '2026-11-30',
      statuses: ['completed', 'open'], priorities: [0, 5], tags: ['work'],
      fields: ['status', 'title', 'list'],
    });

    // A draft leaves the config alone, and the reverse.
    await call('POST', '/summary/state', { draft: '# Week\n- [x] Ship it', draftKey: 'k1' });
    await call('POST', '/summary/state', { config: { range: 'lastWeek', groupBy: 'list', nextPeriod: true } });
    const state = (await call('GET', '/summary/state')).body;
    expect(state).toMatchObject({ draft: '# Week\n- [x] Ship it', draftKey: 'k1' });
    expect(state.config).toMatchObject({ range: 'lastWeek', from: null, to: null, groupBy: 'list', nextPeriod: true, statuses: [] });

    await call('POST', '/summary/state', { draft: null, draftKey: null });
    expect((await call('GET', '/summary/state')).body).toMatchObject({ draft: null, draftKey: null, config: { range: 'lastWeek' } });
  });

  it('rejects malformed settings', async () => {
    const call = api(await signUp());
    const bad = [
      { config: 'week' },
      { config: { range: 'fortnight' } },
      { config: { range: 'custom', from: '2026-11-01' } },
      { config: { range: 'custom', from: '2026-11-31', to: '2026-12-01' } },
      { config: { range: 'custom', from: '2026-11-10', to: '2026-11-01' } },
      { config: { range: 'custom', from: '2000-01-01', to: '2026-01-01' } },
      { config: { statuses: ['done'] } },
      { config: { priorities: ['5'] } },
      { config: { fields: ['title', 'mood'] } },
      { config: { groupBy: 'weekday' } },
      { config: { nextPeriod: 'yes' } },
      { config: { projectIds: [42] } },
      { config: { tags: Array.from({ length: 101 }, (_, i) => `t${i}`) } },
      { draft: 7 },
      { draft: 'x'.repeat(200_001) },
      { draftKey: 'k'.repeat(2049) },
    ];
    for (const body of bad) expect((await call('POST', '/summary/state', body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    expect((await call('GET', '/summary/state')).body.modifiedTime).toBeNull();
  });

  it('reads a damaged stored config as the default', async () => {
    const cookie = await signUp();
    const call = api(cookie);
    await call('POST', '/summary/state', { draft: 'text' });
    await env.DB.prepare("UPDATE summary_state SET config_json = '{not json'").run();
    expect((await call('GET', '/summary/state')).body).toMatchObject({ config: DEFAULT_SUMMARY_CONFIG, draft: 'text' });
  });
});

describe('summary templates', () => {
  it('creates, lists, renames, updates and deletes templates per user', async () => {
    const adminCookie = await signUp();
    const call = api(adminCookie);
    const weekly = await call('POST', '/summary/template', { name: '  Weekly  ', config: { range: 'lastWeek', groupBy: 'list' } });
    expect(weekly.status).toBe(200);
    expect(weekly.body).toMatchObject({ name: 'Weekly', sortOrder: 0, config: { range: 'lastWeek', groupBy: 'list' } });
    const daily = (await call('POST', '/summary/template', { name: 'Daily', config: { range: 'today' }, sortOrder: -1 })).body;
    expect((await call('GET', '/summary/template')).body.map((t: { name: string }) => t.name)).toEqual(['Daily', 'Weekly']);

    const renamed = await call('POST', `/summary/template/${weekly.body.id}`, { name: 'Last week' });
    expect(renamed.body).toMatchObject({ name: 'Last week', config: { range: 'lastWeek', groupBy: 'list' } });
    const updated = await call('POST', `/summary/template/${weekly.body.id}`, { config: { range: 'thisMonth', fields: ['status', 'title'] } });
    expect(updated.body).toMatchObject({ name: 'Last week', config: { range: 'thisMonth', groupBy: 'status', fields: ['status', 'title'] } });

    for (const body of [{ name: '' }, { name: 'x'.repeat(65) }, { name: 3 }, { config: { range: 'soon' } }, { sortOrder: 'first' }]) {
      expect((await call('POST', `/summary/template/${daily.id}`, body)).status).toBe(400);
    }
    expect((await call('POST', '/summary/template', { config: {} })).status).toBe(400);

    // Another account can't see or touch them.
    const other = api(await secondUser(adminCookie));
    expect((await other('GET', '/summary/template')).body).toEqual([]);
    expect((await other('POST', `/summary/template/${daily.id}`, { name: 'Mine' })).status).toBe(404);
    expect((await other('DELETE', `/summary/template/${daily.id}`)).status).toBe(404);

    expect((await call('DELETE', `/summary/template/${daily.id}`)).status).toBe(200);
    expect((await call('DELETE', `/summary/template/${daily.id}`)).status).toBe(404);
    expect((await call('GET', '/summary/template')).body.map((t: { name: string }) => t.name)).toEqual(['Last week']);
  });

  it(`keeps at most ${MAX_SUMMARY_TEMPLATES} templates`, async () => {
    const call = api(await signUp());
    const user = await env.DB.prepare('SELECT id FROM users LIMIT 1').first<{ id: string }>();
    const now = new Date().toISOString();
    await env.DB.batch(Array.from({ length: MAX_SUMMARY_TEMPLATES - 1 }, (_, i) =>
      env.DB.prepare('INSERT INTO summary_templates (id, user_id, name, config_json, sort_order, created_at, modified_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .bind(`t${i}`, user!.id, `T${i}`, '{}', now, now)));
    expect((await call('POST', '/summary/template', { name: 'Last one', config: {} })).status).toBe(200);
    expect((await call('POST', '/summary/template', { name: 'One too many', config: {} })).status).toBe(400);
  });

  it('travels with the backup', async () => {
    const call = api(await signUp());
    const created = (await call('POST', '/summary/template', { name: 'Weekly', config: { range: 'lastWeek' } })).body;
    const backup = (await call('GET', '/backup/export')).body;
    expect(backup.summaryTemplates).toHaveLength(1);

    await call('DELETE', `/summary/template/${created.id}`);
    expect((await call('POST', '/backup/import', backup)).status).toBe(200);
    expect((await call('GET', '/summary/template')).body).toMatchObject([{ id: created.id, name: 'Weekly', config: { range: 'lastWeek' } }]);
  });
});
