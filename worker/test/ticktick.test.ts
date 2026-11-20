import { afterEach, describe, expect, it } from 'vitest';
import { env, reset, SELF } from 'cloudflare:test';
import { resetSchemaCheck } from '../src/db.js';

afterEach(async () => {
  await reset();
  resetSchemaCheck();
});

const HOST = 'https://nodetick.test';

async function signUp(email = 'admin@example.com'): Promise<string> {
  const reg = await SELF.fetch(`${HOST}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2' }),
    redirect: 'manual',
  });
  expect(reg.status).toBe(200);
  return reg.headers.get('set-cookie')!.split(';')[0];
}

/** A second user, created by the admin and signed in. */
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

const importChunk = (cookie: string, body: unknown, origin = HOST) =>
  SELF.fetch(`${HOST}/api/import/ticktick/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify(body),
  });

const projects = async (cookie: string) =>
  (await (await SELF.fetch(`${HOST}/open/v1/project`, { headers: { Cookie: cookie } })).json()) as Record<string, unknown>[];

const task = (id: string, patch: Record<string, unknown> = {}) => ({
  id, parentId: null, title: id, content: null, kind: 'TASK', startDate: null, dueDate: null, timeZone: null, isAllDay: false,
  priority: 0, status: 0, repeatFlag: null, reminders: [], items: [], tags: [], completedTime: null, createdTime: null, sortOrder: 0, column: null,
  ...patch,
});

const PROJECTS_CHUNK = {
  list: { name: 'Projects', folder: 'Work', viewMode: 'kanban', inbox: false },
  columns: [{ name: 'To do', sortOrder: 0 }, { name: 'Doing', sortOrder: 1 }],
  tasks: [
    task('t2', {
      title: 'Ship v2', content: 'Release notes', startDate: '2026-11-27T00:00:00+0000', dueDate: '2026-11-28T00:00:00+0000',
      timeZone: 'Asia/Shanghai', isAllDay: true, priority: 5, repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=1',
      reminders: ['TRIGGER:PT0S', 'TRIGGER:-P1D'], tags: ['work', 'Urgent'], column: 'Doing', createdTime: '2026-11-02T02:00:00+0000',
    }),
    task('t3', {
      parentId: 't2', title: 'Write docs', kind: 'CHECKLIST', dueDate: '2026-11-20T06:30:00+0000', column: 'To do',
      items: [{ title: 'Intro', status: 0 }, { title: 'Setup', status: 2 }],
    }),
    task('t4', { title: 'Old task', status: 2, completedTime: '2026-10-05T03:00:00+0000' }),
  ],
};

describe('TickTick import', () => {
  it('creates the folder, list, columns, subtasks and tags in one request', async () => {
    const cookie = await signUp();
    const res = await importChunk(cookie, PROJECTS_CHUNK);
    expect(res.status).toBe(200);
    const result = (await res.json()) as { projectId: string; created: number; skipped: number; invalid: number };
    expect(result).toMatchObject({ created: 3, skipped: 0, invalid: 0 });

    const project = (await projects(cookie)).find((p) => p.id === result.projectId)!;
    expect(project).toMatchObject({ name: 'Projects', viewMode: 'kanban' });
    const group = await env.DB.prepare('SELECT name FROM project_groups WHERE id = ?').bind(project.groupId).first<{ name: string }>();
    expect(group?.name).toBe('Work');

    const data = (await (await SELF.fetch(`${HOST}/open/v1/project/${result.projectId}/data`, { headers: { Cookie: cookie } })).json()) as {
      tasks: Record<string, unknown>[];
      columns: { id: string; name: string }[];
    };
    expect(data.columns.map((column) => column.name)).toEqual(['To do', 'Doing']);
    const byTitle = (title: string) => data.tasks.find((t) => t.title === title)!;
    const ship = byTitle('Ship v2');
    const docs = byTitle('Write docs');
    expect(ship).toMatchObject({
      isAllDay: true, priority: 5, repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=1', reminders: ['TRIGGER:PT0S', 'TRIGGER:-P1D'],
      columnId: data.columns[1].id, childIds: [docs.id],
    });
    expect(docs).toMatchObject({ parentId: ship.id, kind: 'CHECKLIST', columnId: data.columns[0].id });
    expect((docs.items as { title: string; status: number }[]).map((item) => [item.title, item.status])).toEqual([['Intro', 0], ['Setup', 2]]);

    const completed = (await (await SELF.fetch(`${HOST}/open/v1/task/completed`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    })).json()) as Record<string, unknown>[];
    expect(completed.map((t) => [t.title, t.completedTime])).toEqual([['Old task', '2026-10-05T03:00:00+0000']]);

    const tags = (await (await SELF.fetch(`${HOST}/open/v1/tag`, { headers: { Cookie: cookie } })).json()) as { name: string }[];
    expect(tags.map((tag) => tag.name).sort()).toEqual(['urgent', 'work']);
  });

  it('only adds new tasks when the same backup is imported again', async () => {
    const cookie = await signUp();
    await importChunk(cookie, PROJECTS_CHUNK);
    const projectId = (await projects(cookie)).find((p) => p.name === 'Projects')!.id;
    // The user renames the imported list and edits a task in NodeTick.
    await SELF.fetch(`${HOST}/open/v1/project/${projectId}`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Renamed' }),
    });
    const again = await importChunk(cookie, { ...PROJECTS_CHUNK, tasks: [...PROJECTS_CHUNK.tasks, task('t9', { title: 'New in TickTick' })] });
    expect(await again.json()).toMatchObject({ projectId, created: 1, skipped: 3 });
    const names = (await projects(cookie)).map((p) => p.name);
    expect(names).toContain('Renamed');
    expect(names).not.toContain('Projects');
    const rows = await env.DB.prepare('SELECT child_ids FROM tasks WHERE title = ?').bind('Ship v2').all<{ child_ids: string }>();
    expect(rows.results).toHaveLength(1);
    expect(JSON.parse(rows.results[0].child_ids)).toHaveLength(1);
  });

  it('imports the TickTick inbox into the inbox and keeps users apart', async () => {
    const admin = await signUp();
    const other = await secondUser(admin);
    for (const cookie of [admin, other]) {
      const res = await importChunk(cookie, { list: { name: 'Inbox', inbox: true }, tasks: [task('same-id', { title: 'Buy milk' })] });
      expect(await res.json()).toMatchObject({ projectId: 'inbox', created: 1 });
    }
    const rows = await env.DB.prepare('SELECT id, user_id, project_id FROM tasks WHERE title = ?').bind('Buy milk').all<{ id: string; user_id: string; project_id: string }>();
    expect(rows.results).toHaveLength(2);
    expect(new Set(rows.results.map((row) => row.id)).size).toBe(2);
    expect(rows.results.every((row) => row.project_id === 'inbox')).toBe(true);
  });

  it('drops values the task routes would reject instead of failing the chunk', async () => {
    const cookie = await signUp();
    const res = await importChunk(cookie, {
      list: { name: 'Messy', viewMode: 'galaxy' },
      tasks: [
        task('ok', {
          title: 'x'.repeat(2000), startDate: '2026-02-30T00:00:00+0000', dueDate: 'tomorrow', priority: 4, status: 7, kind: 'EVENT',
          reminders: ['TRIGGER:-PT5M', 'remind me', 'TRIGGER:-P1W'], repeatFlag: 'FREQ=DAILY', tags: ['a', 'a', 42, ''], sortOrder: 1.5,
          parentId: 'missing-parent',
        }),
        { title: 'no id' },
        'not an object',
      ],
    });
    expect(await res.json()).toMatchObject({ created: 1, invalid: 2 });
    const row = await env.DB.prepare('SELECT * FROM tasks WHERE user_id IS NOT NULL').first<Record<string, unknown>>();
    expect(row).toMatchObject({
      start_date: null, due_date: null, priority: 0, status: 0, kind: 'TASK', repeat_flag: null, sort_order: 0, parent_id: null,
      reminders: JSON.stringify(['TRIGGER:-PT5M']), tags: JSON.stringify(['a']),
    });
    expect(String(row!.title)).toHaveLength(1024);
    const project = (await projects(cookie)).find((p) => p.name === 'Messy');
    expect(project?.viewMode).toBe('list');
  });

  it('validates the request', async () => {
    const cookie = await signUp();
    expect((await importChunk(cookie, { list: {}, tasks: [] })).status).toBe(400);
    expect((await importChunk(cookie, { list: { name: 'x' }, tasks: {} })).status).toBe(400);
    expect((await importChunk(cookie, { list: { name: 'x' }, tasks: Array.from({ length: 201 }, (_, i) => task(`t${i}`)) })).status).toBe(413);
    expect((await importChunk(cookie, { list: { name: 'x' }, tasks: [] }, 'https://evil.example')).status).toBe(403);
    const anonymous = await SELF.fetch(`${HOST}/api/import/ticktick/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: HOST }, body: JSON.stringify({ list: { name: 'x' }, tasks: [] }),
    });
    expect(anonymous.status).toBe(401);
  });
});
