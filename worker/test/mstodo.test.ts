import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, env, reset, SELF } from 'cloudflare:test';
import worker from '../src/index.js';
import { resetSchemaCheck } from '../src/db.js';
import {
  dateOnly,
  htmlToText,
  localDateTime,
  mapMicrosoftTask,
  type MapContext,
  repeatFlagOf,
  triggerBefore,
} from '../src/services/mstodo.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
  resetSchemaCheck();
});

const HOST = 'https://nodetick.test';
const SHANGHAI: MapContext = { timeZone: 'Asia/Shanghai', allDayTime: '09:00', now: '2026-11-20T00:00:00.000+0000' };
const utc = (dateTime: string) => ({ dateTime, timeZone: 'UTC' });

describe('Microsoft To Do mapping', () => {
  it('reads a due date as the day it was set, in the user zone', () => {
    // To Do stores "due 25 Nov" set in Shanghai as local midnight in UTC.
    expect(dateOnly(utc('2026-11-24T16:00:00.0000000'), 'Asia/Shanghai')).toBe('2026-11-25');
    // Set in Berlin, read in Shanghai: 07:00 on the same day still rounds to it.
    expect(dateOnly({ dateTime: '2026-11-25T00:00:00', timeZone: 'Europe/Berlin' }, 'Asia/Shanghai')).toBe('2026-11-25');
    // Set in New York (05:00Z), read in Berlin: 06:00 the same day.
    expect(dateOnly(utc('2026-11-25T05:00:00.0000000'), 'Europe/Berlin')).toBe('2026-11-25');
    // A Windows zone name is taken as the user's own wall clock.
    expect(dateOnly({ dateTime: '2026-11-25T00:00:00.0000000', timeZone: 'China Standard Time' }, 'Asia/Shanghai')).toBe('2026-11-25');
    expect(dateOnly({ dateTime: '2026-02-30T00:00:00', timeZone: 'UTC' }, 'UTC')).toBeNull();
    expect(dateOnly(undefined, 'UTC')).toBeNull();
  });

  it('formats timed dates and reminder offsets the way the webapp stores them', () => {
    expect(localDateTime(Date.UTC(2026, 10, 25, 7, 0, 42), 'Asia/Shanghai')).toBe('2026-11-25T15:00:00+0800');
    expect(localDateTime(Date.UTC(2026, 6, 1, 13, 30), 'America/New_York')).toBe('2026-07-01T09:30:00-0400');
    expect(localDateTime(Date.UTC(2026, 0, 1, 0, 0), 'Asia/Kolkata')).toBe('2026-01-01T05:30:00+0530');
    expect(triggerBefore(13 * 3600_000)).toBe('TRIGGER:-PT13H');
    expect(triggerBefore((26 * 60 + 30) * 60_000)).toBe('TRIGGER:-P1DT2H30M');
    expect(triggerBefore(2 * 86400_000)).toBe('TRIGGER:-P2D');
    expect(triggerBefore(0)).toBe('TRIGGER:-PT0M');
  });

  it('turns a due date into an all-day task', () => {
    const task = mapMicrosoftTask({ title: ' Pay rent ', dueDateTime: utc('2026-11-24T16:00:00.0000000') }, SHANGHAI);
    expect(task).toMatchObject({
      title: 'Pay rent',
      startDate: null,
      dueDate: '2026-11-25T00:00:00+0000',
      isAllDay: true,
      reminders: [],
      timeZone: 'Asia/Shanghai',
      status: 0,
      priority: 0,
    });
  });

  it('makes a reminder without a due date, or on the due day, a timed task that reminds on time', () => {
    const reminderOnly = mapMicrosoftTask({
      title: 'Call',
      isReminderOn: true,
      reminderDateTime: utc('2026-11-25T01:30:00.0000000'),
    }, SHANGHAI);
    expect(reminderOnly).toMatchObject({ dueDate: '2026-11-25T09:30:00+0800', isAllDay: false, reminders: ['TRIGGER:-PT0M'] });

    const sameDay = mapMicrosoftTask({
      title: 'Standup',
      dueDateTime: utc('2026-11-24T16:00:00.0000000'),
      isReminderOn: true,
      reminderDateTime: utc('2026-11-25T07:00:00.0000000'),
    }, SHANGHAI);
    expect(sameDay).toMatchObject({ dueDate: '2026-11-25T15:00:00+0800', isAllDay: false, reminders: ['TRIGGER:-PT0M'] });
  });

  it('keeps an earlier-day reminder as an offset before the all-day reminder time', () => {
    const task = mapMicrosoftTask({
      title: 'Passport',
      dueDateTime: utc('2026-11-24T16:00:00.0000000'),
      isReminderOn: true,
      // 20:00 the evening before, 13 hours before 09:00 on the due day.
      reminderDateTime: utc('2026-11-24T12:00:00.0000000'),
    }, SHANGHAI);
    expect(task).toMatchObject({ dueDate: '2026-11-25T00:00:00+0000', isAllDay: true, reminders: ['TRIGGER:-PT13H'] });

    // After the due day: no NodeTick equivalent, so it reminds on the due day.
    const later = mapMicrosoftTask({
      title: 'Late',
      dueDateTime: utc('2026-11-24T16:00:00'),
      isReminderOn: true,
      reminderDateTime: utc('2026-11-27T01:00:00'),
    }, SHANGHAI);
    expect(later.reminders).toEqual(['TRIGGER:-PT0M']);

    const off = mapMicrosoftTask({
      title: 'Muted',
      dueDateTime: utc('2026-11-24T16:00:00'),
      isReminderOn: false,
      reminderDateTime: utc('2026-11-24T12:00:00'),
    }, SHANGHAI);
    expect(off).toMatchObject({ isAllDay: true, reminders: [] });
  });

  it('keeps a start date before the due date as a range', () => {
    const task = mapMicrosoftTask({
      title: 'Trip',
      startDateTime: utc('2026-11-22T16:00:00'),
      dueDateTime: utc('2026-11-24T16:00:00'),
    }, SHANGHAI);
    expect(task).toMatchObject({ startDate: '2026-11-23T00:00:00+0000', dueDate: '2026-11-25T00:00:00+0000', isAllDay: true });
  });

  it('maps importance, completion, categories, steps, notes and links', () => {
    const task = mapMicrosoftTask({
      title: 'Review',
      importance: 'high',
      status: 'completed',
      completedDateTime: utc('2026-11-18T16:00:00.0000000'),
      createdDateTime: '2026-11-01T08:15:19.9359889Z',
      lastModifiedDateTime: '2026-11-18T16:05:00.1234567Z',
      categories: ['Work', 'work', ' Red category ', ''],
      body: { contentType: 'html', content: '<div>Line one<br>Line &amp; two</div><ul><li>a</li><li>b</li></ul><p>&lt;tag&gt;&nbsp;</p>' },
      linkedResources: [
        { displayName: 'Mail from Ann', webUrl: 'https://outlook.live.com/mail/0/id/1' },
        { displayName: 'no url' },
        { webUrl: 'javascript:alert(1)' },
      ],
      checklistItems: [
        { displayName: 'Draft', isChecked: true, checkedDateTime: '2026-11-10T02:00:00Z' },
        { displayName: 'Send', isChecked: false },
      ],
      dueDateTime: utc('2026-11-18T16:00:00'),
      recurrence: { pattern: { type: 'daily', interval: 1 } },
      hasAttachments: true,
    }, SHANGHAI);
    expect(task).toMatchObject({
      priority: 5,
      status: 2,
      completedTime: '2026-11-18T16:00:00.000+0000',
      createdTime: '2026-11-01T08:15:19.935+0000',
      modifiedTime: '2026-11-18T16:05:00.123+0000',
      tags: ['Work', 'Red category'],
      content: 'Line one\nLine & two\n- a\n- b\n<tag>\n\nMail from Ann: https://outlook.live.com/mail/0/id/1',
      // To Do already cloned the next occurrence; the completed copy stops repeating.
      repeatFlag: null,
      hasAttachments: true,
    });
    expect(task.items.map(({ title, status, sortOrder, completedTime }) => ({ title, status, sortOrder, completedTime }))).toEqual([
      { title: 'Draft', status: 2, sortOrder: 0, completedTime: '2026-11-10T02:00:00.000+0000' },
      { title: 'Send', status: 0, sortOrder: 1, completedTime: null },
    ]);
    expect(new Set(task.items.map((item) => item.id)).size).toBe(2);
    expect(mapMicrosoftTask({ title: 'x', importance: 'low' }, SHANGHAI).priority).toBe(1);
    expect(mapMicrosoftTask({ title: 'x', status: 'inProgress' }, SHANGHAI).status).toBe(0);
  });

  it('falls back to the last change for a completed task without a completion date', () => {
    const task = mapMicrosoftTask({ title: 'Old', status: 'completed', lastModifiedDateTime: '2025-01-02T03:04:05Z' }, SHANGHAI);
    expect(task.completedTime).toBe('2025-01-02T03:04:05.000+0000');
  });

  it('converts recurrence patterns to RRULEs', () => {
    const rule = (pattern: Record<string, unknown>, range?: Record<string, unknown>) => repeatFlagOf({ pattern, range });
    expect(rule({ type: 'daily', interval: 1 })).toBe('RRULE:FREQ=DAILY');
    expect(rule({ type: 'daily', interval: 3 })).toBe('RRULE:FREQ=DAILY;INTERVAL=3');
    expect(rule({ type: 'weekly', interval: 1, daysOfWeek: ['friday', 'monday', 'wednesday', 'tuesday', 'thursday'] }))
      .toBe('RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR');
    expect(rule({ type: 'weekly', interval: 2, daysOfWeek: ['wednesday', 'monday'] })).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    expect(rule({ type: 'weekly', interval: 1, daysOfWeek: ['sunday'] })).toBe('RRULE:FREQ=WEEKLY;BYDAY=SU');
    expect(rule({ type: 'absoluteMonthly', interval: 1, dayOfMonth: 31 })).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=31');
    expect(rule({ type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' })).toBe('RRULE:FREQ=MONTHLY;BYDAY=-1FR');
    expect(rule({ type: 'relativeMonthly', interval: 2, daysOfWeek: ['tuesday'], index: 'second' })).toBe('RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU');
    expect(rule({ type: 'absoluteYearly', interval: 1, month: 2, dayOfMonth: 29 })).toBe('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29');
    expect(rule({ type: 'relativeYearly', interval: 1, month: 11, daysOfWeek: ['thursday'], index: 'fourth' })).toBe('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH');
    expect(rule({ type: 'daily', interval: 1 }, { type: 'endDate', endDate: '2027-01-31' })).toBe('RRULE:FREQ=DAILY;UNTIL=20270131');
    expect(rule({ type: 'daily', interval: 1 }, { type: 'numbered', numberOfOccurrences: 10 })).toBe('RRULE:FREQ=DAILY;COUNT=10');
    expect(rule({ type: 'daily', interval: 1 }, { type: 'noEnd' })).toBe('RRULE:FREQ=DAILY');
    // Graph counts occurrences from the range start; COUNT is what is left from the due one.
    expect(repeatFlagOf({ pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', startDate: '2026-11-01', numberOfOccurrences: 10 } }, '2026-11-04'))
      .toBe('RRULE:FREQ=DAILY;COUNT=7');
    expect(repeatFlagOf({
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
      range: { type: 'numbered', startDate: '2026-11-02', numberOfOccurrences: 5 },
    }, '2026-11-16')).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3');
    expect(repeatFlagOf({ pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', startDate: '2026-11-01', numberOfOccurrences: 2 } }, '2026-12-01'))
      .toBe('RRULE:FREQ=DAILY;COUNT=1');
    expect(rule({ type: 'hourly', interval: 1 })).toBeNull();
    expect(repeatFlagOf(null)).toBeNull();
    // A rule needs a date to repeat from.
    expect(mapMicrosoftTask({ title: 'x', recurrence: { pattern: { type: 'daily', interval: 1 } } }, SHANGHAI).repeatFlag).toBeNull();
  });

  it('strips HTML bodies to text', () => {
    expect(htmlToText('<html><head><style>p{color:red}</style></head><body><p>Hi&#33; &#x4F60;&#22909;</p><script>x()</script></body></html>'))
      .toBe('Hi! 你好');
    expect(htmlToText('a &unknown; b')).toBe('a &unknown; b');
  });
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
}

async function signIn(): Promise<string> {
  const res = await SELF.fetch(`${HOST}/api/register`, post({ email: 'admin@example.com', password: 'hunter2hunter2' }));
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0];
}

async function addUser(adminCookie: string, email: string): Promise<string> {
  const created = await SELF.fetch(`${HOST}/api/admin/users`, post({ email, password: 'hunter2hunter2' }, { Cookie: adminCookie }));
  expect(created.status).toBe(200);
  const login = await SELF.fetch(`${HOST}/api/login`, post({ email, password: 'hunter2hunter2' }));
  expect(login.status).toBe(200);
  return login.headers.get('set-cookie')!.split(';')[0];
}

const DEFAULT_LIST = { id: 'AAMkADefault==', displayName: 'Tasks', wellknownListName: 'defaultList' };
const WORK_LIST = { id: 'AAMkAWork==', displayName: 'Work', wellknownListName: 'none' };

const workTasks = [
  {
    id: 'task-1',
    title: 'Quarterly report',
    importance: 'high',
    categories: ['Finance'],
    dueDateTime: utc('2026-11-24T16:00:00.0000000'),
    checklistItems: [{ displayName: 'Collect numbers', isChecked: false }],
  },
  { id: 'task-2', title: 'Old task', status: 'completed', completedDateTime: utc('2026-10-01T00:00:00') },
  { id: 'task-3', title: 'Weekly sync', dueDateTime: utc('2026-11-24T16:00:00'), recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] } }, hasAttachments: true },
];

async function importChunk(cookie: string, body: unknown) {
  return SELF.fetch(`${HOST}/api/import/microsoft/tasks`, post(body, { Cookie: cookie }));
}

describe('POST /api/import/microsoft/tasks', () => {
  it('needs a session and a same-origin request', async () => {
    expect((await SELF.fetch(`${HOST}/api/import/microsoft/tasks`, post({ list: WORK_LIST, tasks: [] }))).status).toBe(401);
    const cookie = await signIn();
    const crossSite = await SELF.fetch(`${HOST}/api/import/microsoft/tasks`, post({ list: WORK_LIST, tasks: [] }, {
      Cookie: cookie,
      Origin: 'https://evil.example',
    }));
    expect(crossSite.status).toBe(403);
  });

  it('imports lists into projects, the default list into the inbox, and registers tags', async () => {
    const cookie = await signIn();
    const work = await importChunk(cookie, { list: WORK_LIST, tasks: workTasks, timeZone: 'Asia/Shanghai' });
    expect(work.status).toBe(200);
    const workResult = (await work.json()) as { projectId: string; created: number; skipped: number; attachments: number };
    expect(workResult).toMatchObject({ created: 3, skipped: 0, invalid: 0, attachments: 1 });
    expect(workResult.projectId).toMatch(/^[0-9a-f]{24}$/);

    const inbox = await importChunk(cookie, {
      list: DEFAULT_LIST,
      tasks: [{ id: 'task-9', title: 'Buy milk' }],
      timeZone: 'Asia/Shanghai',
    });
    expect(await inbox.json()).toMatchObject({ projectId: 'inbox', created: 1 });

    const projects = (await (await SELF.fetch(`${HOST}/open/v1/project`, { headers: { Cookie: cookie } })).json()) as { id: string; name: string }[];
    expect(projects.map((p) => p.name).sort()).toEqual(['Inbox', 'Work']);

    const active = (await (await SELF.fetch(`${HOST}/open/v1/task/filter`, post({}, { Cookie: cookie }))).json()) as Record<string, unknown>[];
    const byTitle = Object.fromEntries(active.map((t) => [t.title, t]));
    expect(Object.keys(byTitle).sort()).toEqual(['Buy milk', 'Quarterly report', 'Weekly sync']);
    expect(byTitle['Quarterly report']).toMatchObject({
      projectId: workResult.projectId,
      priority: 5,
      tags: ['Finance'],
      dueDate: '2026-11-25T00:00:00+0000',
      isAllDay: true,
      items: [{ title: 'Collect numbers', status: 0 }],
    });
    // Graph has no manual order: imported tasks sort by date like new ones.
    expect(byTitle['Weekly sync']).toMatchObject({ repeatFlag: 'RRULE:FREQ=WEEKLY;BYDAY=TU', sortOrder: 0 });
    expect(byTitle['Buy milk']).toMatchObject({ projectId: 'inbox' });

    const completed = (await (await SELF.fetch(`${HOST}/open/v1/task/completed`, post({}, { Cookie: cookie }))).json()) as Record<string, unknown>[];
    expect(completed.map((t) => t.title)).toEqual(['Old task']);

    const tags = (await (await SELF.fetch(`${HOST}/open/v1/tag`, { headers: { Cookie: cookie } })).json()) as { name: string; label: string }[];
    expect(tags).toEqual([expect.objectContaining({ name: 'finance', label: 'Finance' })]);
  });

  it('skips what an earlier import added and keeps changes made since', async () => {
    const cookie = await signIn();
    const first = (await (await importChunk(cookie, { list: WORK_LIST, tasks: workTasks })).json()) as { projectId: string };
    const rename = await SELF.fetch(`${HOST}/open/v1/project/${first.projectId}`, post({ name: 'Job' }, { Cookie: cookie }));
    expect(rename.status).toBe(200);
    const edited = await env.DB.prepare("UPDATE tasks SET title = 'Edited' WHERE title = 'Quarterly report'").run();
    expect(edited.meta.changes).toBe(1);

    const again = await importChunk(cookie, {
      list: { ...WORK_LIST, displayName: 'Work (renamed in To Do)' },
      tasks: [...workTasks, { id: 'task-4', title: 'New since last time' }],
    });
    expect(await again.json()).toMatchObject({ projectId: first.projectId, created: 1, skipped: 3 });

    const projects = await env.DB.prepare('SELECT name FROM projects ORDER BY name').all<{ name: string }>();
    expect(projects.results.map((p) => p.name)).toEqual(['Job']);
    const titles = await env.DB.prepare('SELECT title FROM tasks ORDER BY title').all<{ title: string }>();
    expect(titles.results.map((t) => t.title)).toEqual(['Edited', 'New since last time', 'Old task', 'Weekly sync']);
  });

  it('keeps two accounts that import the same Microsoft data apart', async () => {
    const admin = await signIn();
    const other = await addUser(admin, 'second@example.com');
    for (const cookie of [admin, other]) {
      const res = await importChunk(cookie, { list: WORK_LIST, tasks: workTasks });
      expect(await res.json()).toMatchObject({ created: 3, skipped: 0 });
    }
    const counts = await env.DB.prepare('SELECT user_id, COUNT(*) AS n FROM tasks GROUP BY user_id').all<{ n: number }>();
    expect(counts.results.map((r) => r.n)).toEqual([3, 3]);
  });

  it('creates an empty list and rejects malformed chunks', async () => {
    const cookie = await signIn();
    const empty = await importChunk(cookie, { list: { id: 'AAMkAEmpty', displayName: '  ' }, tasks: [] });
    expect(await empty.json()).toMatchObject({ created: 0 });
    const names = await env.DB.prepare('SELECT name FROM projects').all<{ name: string }>();
    expect(names.results).toEqual([{ name: 'Microsoft To Do' }]);

    const invalid = await importChunk(cookie, { list: WORK_LIST, tasks: [{ title: 'no id' }, 'nope', { id: 'ok', title: 'Fine' }] });
    expect(await invalid.json()).toMatchObject({ created: 1, invalid: 2 });

    expect((await importChunk(cookie, { tasks: [] })).status).toBe(400);
    expect((await importChunk(cookie, { list: WORK_LIST, tasks: 'x' })).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ id: `t${i}`, title: `T${i}` }));
    expect((await importChunk(cookie, { list: WORK_LIST, tasks: tooMany })).status).toBe(413);
  });

  it('imports a full chunk in a single request', async () => {
    const cookie = await signIn();
    const tasks = Array.from({ length: 200 }, (_, i) => ({ id: `bulk-${i}`, title: `Task ${i}`, categories: [`tag${i % 7}`] }));
    const res = await importChunk(cookie, { list: WORK_LIST, tasks });
    expect(await res.json()).toMatchObject({ created: 200 });
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM tasks').first<{ n: number }>();
    expect(row?.n).toBe(200);
    const tags = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags').first<{ n: number }>();
    expect(tags?.n).toBe(7);
  });
});

describe('Microsoft sign-in relay', () => {
  const configured = { ...env, MS_TODO_CLIENT_ID: 'client-123' };

  /** Call the worker with Microsoft configured; SELF only sees wrangler.toml's vars. */
  async function call(path: string, cookie: string, body?: unknown, testEnv: typeof env = configured) {
    const init = body === undefined ? { headers: { Cookie: cookie } } : post(body, { Cookie: cookie });
    return worker.fetch(new Request(`${HOST}${path}`, init), testEnv, createExecutionContext());
  }

  function microsoftAnswers(...responses: [number, Record<string, unknown>][]) {
    const calls: { url: string; body: URLSearchParams }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input instanceof Request ? input.url : input), body: new URLSearchParams(String(init?.body ?? '')) });
      const [status, body] = responses.shift() ?? [500, {}];
      return Response.json(body, { status });
    });
    return calls;
  }

  it('reports whether the server has a Microsoft app', async () => {
    const cookie = await signIn();
    expect(await (await SELF.fetch(`${HOST}/api/import/microsoft/config`, { headers: { Cookie: cookie } })).json()).toEqual({ configured: false });
    expect(await (await call('/api/import/microsoft/config', cookie)).json()).toEqual({ configured: true });
    expect((await SELF.fetch(`${HOST}/api/import/microsoft/device`, post({}, { Cookie: cookie }))).status).toBe(503);
    expect((await SELF.fetch(`${HOST}/api/import/microsoft/config`)).status).toBe(401);
  });

  it('starts a device code sign-in', async () => {
    const cookie = await signIn();
    const calls = microsoftAnswers([200, {
      device_code: 'DEVICE',
      user_code: 'ABCD1234',
      verification_uri: 'https://www.microsoft.com/link',
      expires_in: 900,
      interval: 5,
      message: 'To sign in, …',
    }]);
    const res = await call('/api/import/microsoft/device', cookie, {});
    expect(await res.json()).toEqual({
      deviceCode: 'DEVICE',
      userCode: 'ABCD1234',
      verificationUri: 'https://www.microsoft.com/link',
      expiresIn: 900,
      interval: 5,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/devicecode');
    expect(Object.fromEntries(calls[0].body)).toEqual({ client_id: 'client-123', scope: 'Tasks.Read' });
  });

  it('passes Microsoft errors on without the trace lines', async () => {
    const cookie = await signIn();
    const calls = microsoftAnswers([400, {
      error: 'unauthorized_client',
      error_description: "AADSTS700016: Application with identifier 'client-123' was not found.\r\nTrace ID: 1\r\nCorrelation ID: 2",
    }]);
    const res = await call('/api/import/microsoft/device', cookie, {}, { ...configured, MS_TODO_TENANT: 'consumers' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "AADSTS700016: Application with identifier 'client-123' was not found." });
    expect(calls[0].url).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode');

    // What Microsoft actually sends: the trace details on the same line.
    microsoftAnswers([400, {
      error: 'invalid_request',
      error_description: 'AADSTS700038: 00000000-0000-0000-0000-000000000000 is not a valid application identifier. Trace ID: 20add99c Correlation ID: ac0750c0 Timestamp: 2026-11-20 01:50:04Z',
    }]);
    const inline = await call('/api/import/microsoft/device', cookie, {});
    expect(await inline.json()).toEqual({ error: 'AADSTS700038: 00000000-0000-0000-0000-000000000000 is not a valid application identifier.' });
  });

  it('polls for the token', async () => {
    const cookie = await signIn();
    const calls = microsoftAnswers(
      [400, { error: 'authorization_pending' }],
      [400, { error: 'slow_down' }],
      [400, { error: 'authorization_declined' }],
      [400, { error: 'expired_token' }],
      [400, { error: 'invalid_grant', error_description: 'AADSTS70000: bad grant\r\nTrace ID: 3' }],
      [200, { access_token: 'GRAPH-TOKEN', expires_in: 3599, token_type: 'Bearer' }],
    );
    const poll = async () => {
      const res = await call('/api/import/microsoft/token', cookie, { deviceCode: 'DEVICE' });
      return [res.status, await res.json()];
    };
    expect(await poll()).toEqual([200, { status: 'pending' }]);
    expect(await poll()).toEqual([200, { status: 'slow_down' }]);
    expect(await poll()).toEqual([200, { status: 'declined' }]);
    expect(await poll()).toEqual([200, { status: 'expired' }]);
    expect(await poll()).toEqual([502, { error: 'AADSTS70000: bad grant' }]);
    expect(await poll()).toEqual([200, { status: 'ok', accessToken: 'GRAPH-TOKEN', expiresIn: 3599 }]);
    expect(Object.fromEntries(calls[0].body)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: 'client-123',
      device_code: 'DEVICE',
    });
    expect((await call('/api/import/microsoft/token', cookie, {})).status).toBe(400);
  });

  it('reports an unreachable Microsoft', async () => {
    const cookie = await signIn();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const res = await call('/api/import/microsoft/device', cookie, {});
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Could not reach Microsoft sign-in.' });
  });
});
