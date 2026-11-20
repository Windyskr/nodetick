import { afterEach, describe, expect, it } from 'vitest';
import { reset, SELF } from 'cloudflare:test';
import { resetSchemaCheck } from '../src/db.js';

afterEach(async () => {
  await reset();
  resetSchemaCheck();
});

const HOST = 'https://nodetick.test';

async function bootstrap(): Promise<string> {
  const reg = await SELF.fetch(`${HOST}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'hunter2hunter2' }),
    redirect: 'manual',
  });
  expect(reg.status).toBe(200);
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];
  const created = await SELF.fetch(`${HOST}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'test' }),
  });
  return ((await created.json()) as { token: string }).token;
}

function api(token: string) {
  return async <T = Record<string, unknown>>(path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await SELF.fetch(`${HOST}/open/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
}

describe('task search', () => {
  it('needs every word and also looks in checklist items and tags', async () => {
    const call = api(await bootstrap());
    await call('/project');
    await call('/task', { projectId: 'inbox', title: 'Plan offsite', items: [{ title: 'Book the barn' }], tags: ['Work'] });
    await call('/task', { projectId: 'inbox', title: 'Buy oat milk', content: 'barista brand' });

    const titles = async (keywords: string) =>
      (await call<{ title: string }[]>('/task/search', { keywords })).body.map((task) => task.title);
    expect(await titles('offsite barn')).toEqual(['Plan offsite']);
    expect(await titles('offsite milk')).toEqual([]);
    expect(await titles('work')).toEqual(['Plan offsite']);
    expect(await titles('#wo')).toEqual(['Plan offsite']);
    expect(await titles('#barn')).toEqual([]);
    expect(await titles('MILK   barista')).toEqual(['Buy oat milk']);
    expect((await titles('#')).sort()).toEqual(['Buy oat milk', 'Plan offsite']);
  });
});

describe('saved filters', () => {
  it('stores keywords, kinds and the new date modes', async () => {
    const call = api(await bootstrap());
    const created = await call('/filter', {
      name: 'Notes about rent',
      dateMode: 'next7',
      keywords: '  rent  ',
      kinds: ['note', 'note'],
      statuses: [-1],
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ dateMode: 'next7', keywords: 'rent', kinds: ['note'], statuses: [-1] });

    const updated = await call(`/filter/${created.body.id}`, { dateMode: 'nodate', kinds: [] });
    expect(updated.body).toMatchObject({ dateMode: 'nodate', keywords: 'rent', kinds: [] });
    expect((await call(`/filter/${created.body.id}`, { dateMode: 'month' })).body.dateMode).toBe('month');

    // Filters saved before these fields existed read back with empty defaults.
    const legacy = await call('/filter', { name: 'Old', dateMode: 'today' });
    expect(legacy.body).toMatchObject({ keywords: '', kinds: [] });
  });

  it('rejects malformed keywords, kinds and date modes', async () => {
    const call = api(await bootstrap());
    for (const body of [
      { name: 'x', keywords: 42 },
      { name: 'x', keywords: 'a'.repeat(201) },
      { name: 'x', kinds: ['event'] },
      { name: 'x', kinds: 'note' },
      { name: 'x', dateMode: 'fortnight' },
    ]) {
      expect((await call('/filter', body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});
