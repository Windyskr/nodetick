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
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];
  const created = await SELF.fetch(`${HOST}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'test' }),
  });
  return ((await created.json()) as { token: string }).token;
}

function api(token: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await SELF.fetch(`${HOST}/open/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

describe('nested tags', () => {
  it('nests one level deep and keeps sub-tags in step on rename and delete', async () => {
    const call = api(await bootstrap());
    for (const name of ['work', 'meetings', 'calls', 'home']) await call('POST', '/tag', { name, label: name });

    expect((await call('POST', '/tag/meetings', { parentId: 'Work' })).body).toMatchObject({ name: 'meetings', parentId: 'work' });
    await call('POST', '/tag/calls', { parentId: 'work' });

    // One level only, no self-parenting, and the parent has to exist.
    expect((await call('POST', '/tag/home', { parentId: 'meetings' })).status).toBe(400);
    expect((await call('POST', '/tag/work', { parentId: 'home' })).status).toBe(400);
    expect((await call('POST', '/tag/home', { parentId: 'home' })).status).toBe(400);
    expect((await call('POST', '/tag/home', { parentId: 'nope' })).status).toBe(400);
    expect((await call('POST', '/tag/home', { parentId: 42 })).status).toBe(400);

    // Renaming the parent carries the sub-tags along.
    await call('POST', '/tag/work', { name: 'job', label: 'Job' });
    const parents = async () => Object.fromEntries(((await call('GET', '/tag')).body as { name: string; parentId: string | null }[]).map((tag) => [tag.name, tag.parentId]));
    expect(await parents()).toEqual({ job: null, meetings: 'job', calls: 'job', home: null });

    // Leaving parentId out keeps it; null clears it.
    await call('POST', '/tag/meetings', { color: '#4772FA' });
    expect((await parents()).meetings).toBe('job');
    await call('POST', '/tag/meetings', { parentId: null });
    expect((await parents()).meetings).toBeNull();

    // Deleting the parent promotes its sub-tags.
    await call('DELETE', '/tag/job');
    expect(await parents()).toEqual({ meetings: null, calls: null, home: null });
  });
});
