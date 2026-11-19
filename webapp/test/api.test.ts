import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/lib/api';

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the server message of a 401 (failed login)', async () => {
    vi.stubGlobal('fetch', respond(401, { error: 'Invalid email or password.' }));
    const error = await api.login('a@b.co', 'wrong').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('Invalid email or password.');
  });

  it('falls back to "Unauthorized" for a bare 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(api.me()).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
  });

  it('reads the old web medium priority (2) as TickTick medium (3)', async () => {
    vi.stubGlobal('fetch', respond(200, [
      { id: 'a', priority: 2 },
      { id: 'b', priority: 5 },
      { id: 'c', priority: 0 },
    ]));
    const tasks = await api.filterTasks({ status: [0] });
    expect(tasks.map((t) => t.priority)).toEqual([3, 5, 0]);
  });
});
