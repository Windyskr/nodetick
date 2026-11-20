import { describe, expect, it, vi } from 'vitest';
import {
  chunkTasks,
  GraphError,
  importTodoLists,
  listTodoLists,
  slimTask,
  todoTaskPages,
  type MsImportChunk,
  type MsTodoList,
  type MsTodoTask,
} from '../src/lib/msTodo';

const GRAPH = 'https://graph.microsoft.com/v1.0';

type Route = (url: URL) => Response | undefined;

/** A fake Graph: each handler answers the URLs it recognizes; requests are recorded. */
function fakeGraph(...routes: Route[]) {
  const requests: { url: URL; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const url = new URL(String(input));
    requests.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    for (const route of routes) {
      const response = route(url);
      if (response) return response;
    }
    return Response.json({ error: { message: `no route for ${url}` } }, { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests, sleep: vi.fn(async () => undefined) };
}

const page = (value: unknown[], nextLink?: string) => Response.json(nextLink ? { value, '@odata.nextLink': nextLink } : { value });

describe('reading Microsoft Graph', () => {
  it('lists every page of task lists with the bearer token', async () => {
    const graph = fakeGraph((url) => {
      if (url.pathname !== '/v1.0/me/todo/lists') return undefined;
      return url.searchParams.get('$skiptoken')
        ? page([{ id: 'b', displayName: 'Work', wellknownListName: 'none', isShared: true }, { displayName: 'no id' }])
        : page([{ id: 'a', displayName: 'Tasks', wellknownListName: 'defaultList' }], `${GRAPH}/me/todo/lists?$skiptoken=2`);
    });
    const lists = await listTodoLists({ token: 'T', ...graph });
    expect(lists).toEqual([
      { id: 'a', displayName: 'Tasks', wellknownListName: 'defaultList', isShared: false },
      { id: 'b', displayName: 'Work', wellknownListName: 'none', isShared: true },
    ]);
    expect(graph.requests.map((r) => r.auth)).toEqual(['Bearer T', 'Bearer T']);
  });

  it('waits out throttling and reports Graph errors', async () => {
    let calls = 0;
    const graph = fakeGraph(() => {
      calls++;
      if (calls === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '7' } });
      if (calls === 2) return new Response(null, { status: 503 });
      return page([]);
    });
    await expect(listTodoLists({ token: 'T', ...graph })).resolves.toEqual([]);
    expect(graph.sleep.mock.calls.map(([ms]) => ms)).toEqual([7000, 2000]);

    const denied = fakeGraph(() => Response.json({ error: { message: 'Access is denied.' } }, { status: 403 }));
    await expect(listTodoLists({ token: 'T', ...denied })).rejects.toEqual(new GraphError(403, 'Access is denied.'));
  });

  it('never follows a next link off Microsoft Graph', async () => {
    const graph = fakeGraph(() => page([], 'https://evil.example/steal'));
    await expect(listTodoLists({ token: 'T', ...graph })).rejects.toThrow(/Unexpected Microsoft Graph link/);
    expect(graph.requests).toHaveLength(1);
  });

  it('asks Graph to leave out completed tasks unless they are wanted', async () => {
    const graph = fakeGraph(() => page([{ id: '1', status: 'notStarted' }]));
    const all: MsTodoTask[][] = [];
    for await (const tasks of todoTaskPages('list/1', false, { token: 'T', ...graph })) all.push(tasks);
    for await (const tasks of todoTaskPages('list/1', true, { token: 'T', ...graph })) all.push(tasks);
    expect(all.flat().map((t) => t.id)).toEqual(['1', '1']);
    const [active, everything] = graph.requests.map((r) => r.url);
    expect(active.pathname).toBe('/v1.0/me/todo/lists/list%2F1/tasks');
    expect(active.searchParams.get('$expand')).toBe('checklistItems,linkedResources');
    expect(active.searchParams.get('$filter')).toBe("status ne 'completed'");
    expect(everything.searchParams.get('$filter')).toBeNull();
  });

  it('falls back to a plainer query when Graph rejects the first one, and remembers it', async () => {
    const graph = fakeGraph((url) => {
      if (url.searchParams.get('$expand') === 'checklistItems,linkedResources') {
        return Response.json({ error: { message: 'Invalid expand' } }, { status: 400 });
      }
      return page([
        { id: 'open', status: 'notStarted', checklistItems: [] },
        { id: 'done', status: 'completed', checklistItems: [] },
      ]);
    });
    const state = { variant: 0 };
    const seen: string[] = [];
    for await (const tasks of todoTaskPages('L', false, { token: 'T', ...graph }, state)) seen.push(...tasks.map((t) => t.id));
    // The fallback cannot filter on the server, so completed tasks are dropped here.
    expect(seen).toEqual(['open']);
    expect(state.variant).toBe(1);
    for await (const tasks of todoTaskPages('L2', true, { token: 'T', ...graph }, state)) seen.push(...tasks.map((t) => t.id));
    expect(seen).toEqual(['open', 'open', 'done']);
    expect(graph.requests.map((r) => r.url.searchParams.get('$expand'))).toEqual([
      'checklistItems,linkedResources', 'checklistItems', 'checklistItems',
    ]);
  });

  it('does not switch queries once a list has started paging', async () => {
    const graph = fakeGraph((url) => url.searchParams.get('$skiptoken')
      ? Response.json({ error: { message: 'Bad page' } }, { status: 400 })
      : page([{ id: '1' }], `${GRAPH}/me/todo/lists/L/tasks?$skiptoken=x`));
    const seen: string[] = [];
    await expect((async () => {
      for await (const tasks of todoTaskPages('L', true, { token: 'T', ...graph })) seen.push(...tasks.map((t) => t.id));
    })()).rejects.toEqual(new GraphError(400, 'Bad page'));
    expect(seen).toEqual(['1']);
  });
});

describe('preparing chunks', () => {
  it('keeps only what the worker reads', () => {
    const slim = slimTask({
      '@odata.etag': 'W/"x"',
      id: 'T1',
      title: 'Title',
      body: { contentType: 'text', content: 'x'.repeat(150_000), extra: 1 },
      checklistItems: [{ '@odata.etag': 'e', id: 'c1', displayName: 'Step', isChecked: true, createdDateTime: 'z' }],
      linkedResources: [{ id: 'l1', webUrl: 'https://example.com', displayName: 'Doc', externalId: 'x' }],
      dueDateTime: { dateTime: '2026-11-24T16:00:00.0000000', timeZone: 'UTC' },
      importance: 'high',
    });
    expect(slim).toEqual({
      id: 'T1',
      title: 'Title',
      body: { contentType: 'text', content: 'x'.repeat(100_000) },
      checklistItems: [{ displayName: 'Step', isChecked: true }],
      linkedResources: [{ webUrl: 'https://example.com', displayName: 'Doc' }],
      dueDateTime: { dateTime: '2026-11-24T16:00:00.0000000', timeZone: 'UTC' },
      importance: 'high',
    });
  });

  it('splits by count and by size', () => {
    const small = Array.from({ length: 250 }, (_, i) => ({ id: `t${i}` }));
    expect(chunkTasks(small).map((c) => c.length)).toEqual([100, 100, 50]);
    const big = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, title: '你'.repeat(100_000) }));
    // 300 KB of UTF-8 each: two fit in 600 KB, a third does not.
    expect(chunkTasks(big).map((c) => c.length)).toEqual([1, 1, 1, 1, 1]);
    expect(chunkTasks(big, 100, 700_000).map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunkTasks([])).toEqual([]);
  });
});

describe('importing lists', () => {
  const lists: MsTodoList[] = [
    { id: 'L1', displayName: 'Tasks', wellknownListName: 'defaultList', isShared: false },
    { id: 'L2', displayName: 'Empty', wellknownListName: 'none', isShared: false },
  ];

  it('posts each list in order, an empty list as an empty chunk, and adds up the results', async () => {
    const graph = fakeGraph((url) => {
      if (url.pathname.endsWith('/L1/tasks')) {
        return url.searchParams.get('$skiptoken')
          ? page(Array.from({ length: 30 }, (_, i) => ({ id: `p2-${i}` })))
          : page(Array.from({ length: 120 }, (_, i) => ({ id: `p1-${i}`, '@odata.etag': 'x' })), `${GRAPH}/me/todo/lists/L1/tasks?$skiptoken=2`);
      }
      return url.pathname.endsWith('/L2/tasks') ? page([]) : undefined;
    });
    const sent: MsImportChunk[] = [];
    const send = vi.fn(async (chunk: MsImportChunk) => {
      sent.push(chunk);
      return { projectId: 'p', created: Math.max(chunk.tasks.length - 1, 0), skipped: chunk.tasks.length ? 1 : 0, invalid: 0, attachments: 0 };
    });
    const progress = vi.fn();
    const totals = await importTodoLists(lists, {
      token: 'T', ...graph, includeCompleted: true, timeZone: 'Asia/Shanghai', send, onProgress: progress,
    });
    expect(sent.map((c) => [c.list.id, c.tasks.length])).toEqual([['L1', 100], ['L1', 20], ['L1', 30], ['L2', 0]]);
    expect(sent[0]).toMatchObject({ timeZone: 'Asia/Shanghai', list: { id: 'L1', displayName: 'Tasks', wellknownListName: 'defaultList' } });
    expect(sent[0].tasks[0]).toEqual({ id: 'p1-0' });
    expect(totals).toEqual({ lists: 2, created: 147, skipped: 3, attachments: 0 });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ listIndex: 1, listCount: 2, listTasks: 0 }),
      totals,
    );
  });

  it('stops when aborted and keeps the totals of what was sent', async () => {
    const graph = fakeGraph(() => page([{ id: 'x' }]));
    const controller = new AbortController();
    const totals = { lists: 0, created: 0, skipped: 0, attachments: 0 };
    const send = vi.fn(async () => {
      controller.abort();
      return { projectId: 'p', created: 1, skipped: 0, invalid: 0, attachments: 1 };
    });
    await expect(importTodoLists(lists, {
      token: 'T', ...graph, signal: controller.signal, includeCompleted: false, timeZone: 'UTC', send,
    }, totals)).rejects.toThrow();
    // The first list had finished; the second list's Graph request was cancelled.
    expect(send).toHaveBeenCalledTimes(1);
    expect(totals).toEqual({ lists: 1, created: 1, skipped: 0, attachments: 1 });
  });
});
