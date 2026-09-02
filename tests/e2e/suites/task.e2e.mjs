import { eq, has, ok } from '../lib.mjs';

export async function run({ h }) {
  const pfx = h.pfx;

  // Fixture projects (cleaned up at the end of this suite).
  const work = h.j(['project', 'create', '--name', `${pfx}-tasks`], 'fixture project work');
  const other = h.j(['project', 'create', '--name', `${pfx}-other`], 'fixture project other');
  const due = '2026-09-10T09:00:00+0000';
  const ids = [];

  h.test('task create: minimal (title + project)', () => {
    const t = h.j(['task', 'create', '--title', `${pfx}-minimal`, '--project', work.id], 'task create minimal');
    ok(/^[0-9a-f]{24}$/.test(t.id), 'id is a 24-hex ObjectId');
    eq(t.projectId, work.id, 'projectId');
    eq(t.title, `${pfx}-minimal`, 'title');
    eq(t.status, 0, 'status defaults to open');
    eq(t.priority, 0, 'priority defaults to none');
    ids.push(t.id);
  });

  h.test('task create: missing --project fails', () => {
    h.runFails(['task', 'create', '--title', 'x'], "required option", 'task create validation');
  });

  h.test('task create: unknown project fails', () => {
    h.runFails(
      ['task', 'create', '--title', 'x', '--project', '0'.repeat(24)],
      'project not found',
      'task create unknown project',
    );
  });

  h.test('task create: full options round-trip', () => {
    const t = h.j(
      [
        'task', 'create',
        '--title', `${pfx}-full`,
        '--project', work.id,
        '--content', 'main body text',
        '--desc', 'checklist description',
        '--priority', '5',
        '--due-date', due,
        '--start-date', '2026-09-01T09:00:00+0000',
        '--time-zone', 'Asia/Shanghai',
        '--reminders', 'TRIGGER:-PT60M,TRIGGER:-P1D',
        '--repeat', 'RRULE:FREQ=DAILY;INTERVAL=1',
        '--sort-order', '-1',
        '--items', 'oat milk,bread',
        '--tags', 'groceries,urgent',
      ],
      'task create full',
    );
    eq(t.priority, 5, 'priority');
    eq(t.dueDate, due, 'dueDate verbatim');
    eq(t.startDate, '2026-09-01T09:00:00+0000', 'startDate verbatim');
    eq(t.timeZone, 'Asia/Shanghai', 'timeZone');
    eq(t.reminders, ['TRIGGER:-PT60M', 'TRIGGER:-P1D'], 'reminders split');
    eq(t.repeatFlag, 'RRULE:FREQ=DAILY;INTERVAL=1', 'repeatFlag');
    eq(t.tags.sort(), ['groceries', 'urgent'], 'tags');
    eq(t.items.map((i) => i.title), ['oat milk', 'bread'], 'CSV items become checklist items');
    ok(t.items.every((i) => /^[0-9a-f]{24}$/.test(i.id)), 'items got server-side ids');
    ids.push(t.id);
  });

  h.test('task create: JSON items (with pre-done status)', () => {
    const t = h.j(
      ['task', 'create', '--title', `${pfx}-json-items`, '--project', work.id,
        '--items', JSON.stringify([{ title: 'done already', status: 1 }, { title: 'pending' }])],
      'task create json items',
    );
    eq(t.items.length, 2, 'two items');
    eq(t.items[0].status, 1, 'first item done');
    eq(t.items[1].status, 0, 'second item open');
    ids.push(t.id);
  });

  h.test('task get: JSON round-trip', () => {
    const created = h.j(['task', 'create', '--title', `${pfx}-getme`, '--project', work.id], 'create for get');
    const got = h.j(['task', 'get', work.id, created.id], 'task get');
    eq(got.id, created.id, 'id');
    eq(got.title, `${pfx}-getme`, 'title');
    const text = h.runOk(['task', 'get', work.id, created.id], 'task get text');
    has(text.stdout, `${pfx}-getme`, 'text shows title');
    has(text.stdout, 'Status:    Open', 'text shows status');
    ids.push(created.id);
  });

  h.test('task get: unknown id fails', () => {
    h.runFails(['task', 'get', work.id, '0'.repeat(24)], 'task not found', 'task get 404');
  });

  h.test('task update: fields merge', () => {
    const t = h.j(['task', 'create', '--title', `${pfx}-upd`, '--project', work.id], 'create for update');
    const u = h.j(
      ['task', 'update', t.id, '--id', t.id, '--project', work.id,
        '--title', `${pfx}-upd2`, '--content', 'new content', '--priority', '3'],
      'task update',
    );
    eq(u.title, `${pfx}-upd2`, 'updated title');
    eq(u.content, 'new content', 'updated content');
    eq(u.priority, 3, 'updated priority');
    ids.push(t.id);
  });

  h.test('task update: focus summaries (estimated pomo/duration)', () => {
    const t = h.j(['task', 'create', '--title', `${pfx}-pomo`, '--project', work.id], 'create for pomo');
    const u = h.j(
      ['task', 'update', t.id, '--id', t.id, '--project', work.id,
        '--estimated-pomo', '3', '--estimated-duration', '1500'],
      'task update pomo',
    );
    eq(u.focusSummaries[0].estimatedPomo, 3, 'estimatedPomo');
    eq(u.focusSummaries[0].estimatedDuration, 1500, 'estimatedDuration');
    ids.push(t.id);
  });

  h.test('task update: parent link and unlink', () => {
    const parent = h.j(['task', 'create', '--title', `${pfx}-parent`, '--project', work.id], 'create parent');
    const child = h.j(['task', 'create', '--title', `${pfx}-child`, '--project', work.id], 'create child');

    const linked = h.j(
      ['task', 'update', child.id, '--id', child.id, '--project', work.id, '--parent-id', parent.id],
      'link parent',
    );
    eq(linked.parentId, parent.id, 'child.parentId');

    const parentAfter = h.j(['task', 'get', work.id, parent.id], 'parent after link');
    ok(parentAfter.childIds.includes(child.id), 'parent.childIds contains child');

    const unlinked = h.j(
      ['task', 'update', child.id, '--id', child.id, '--project', work.id, '--parent-id', 'null'],
      'unlink parent',
    );
    ok(unlinked.parentId == null, 'parentId cleared');
    const parentAfter2 = h.j(['task', 'get', work.id, parent.id], 'parent after unlink');
    ok(!parentAfter2.childIds.includes(child.id), 'parent.childIds no longer contains child');
    ids.push(parent.id, child.id);
  });

  h.test('task update: unknown parent fails', () => {
    const t = h.j(['task', 'create', '--title', `${pfx}-orphan`, '--project', work.id], 'create orphan');
    h.runFails(
      ['task', 'update', t.id, '--id', t.id, '--project', work.id, '--parent-id', '0'.repeat(24)],
      'parent task not found',
      'update with bad parent',
    );
    ids.push(t.id);
  });

  h.test('task complete: marks done and records time', () => {
    const t = h.j(['task', 'create', '--title', `${pfx}-done`, '--project', work.id], 'create for complete');
    h.runOk(['task', 'complete', work.id, t.id], 'task complete');
    const got = h.j(['task', 'get', work.id, t.id], 'get after complete');
    eq(got.status, 2, 'status completed');
    ok(got.completedTime, 'completedTime set');
    ids.push(t.id);
  });

  h.test('task completed: lists by project and time window', () => {
    const list = h.j(['task', 'completed', '--projects', work.id], 'task completed');
    ok(list.some((t) => t.title === `${pfx}-done`), 'contains completed task');

    const now = new Date();
    const iso = (d) => d.toISOString().replace('Z', '+0000');
    const window = h.j(
      ['task', 'completed', '--projects', work.id,
        '--start-date', iso(new Date(now - 3600e3)), '--end-date', iso(new Date(now + 3600e3))],
      'task completed window',
    );
    ok(window.some((t) => t.title === `${pfx}-done`), 'inside window');

    const old = h.j(
      ['task', 'completed', '--projects', work.id,
        '--start-date', '2020-01-01T00:00:00+0000', '--end-date', '2020-01-02T00:00:00+0000'],
      'task completed old window',
    );
    eq(old, [], 'empty for an old window');
  });

  h.test('task filter: project + priority + tag + status', () => {
    const byPriority = h.j(['task', 'filter', '--projects', work.id, '--priority', '5'], 'filter priority');
    ok(byPriority.some((t) => t.title === `${pfx}-full`), 'finds high-priority task');

    const byTag = h.j(['task', 'filter', '--projects', work.id, '--tag', 'groceries'], 'filter tag');
    ok(byTag.some((t) => t.title === `${pfx}-full`), 'finds tagged task');

    const open = h.j(['task', 'filter', '--projects', work.id, '--status', '0'], 'filter open');
    ok(open.every((t) => t.status === 0), 'only open tasks');

    const done = h.j(['task', 'filter', '--projects', work.id, '--status', '2'], 'filter completed');
    ok(done.some((t) => t.title === `${pfx}-done`), 'finds completed task');
  });

  h.test('task search: keywords / tags / status / due window', () => {
    const kw = h.j(['task', 'search', `${pfx}-full`], 'search keyword');
    ok(kw.some((t) => t.title === `${pfx}-full`), 'finds by keyword');

    const tag = h.j(['task', 'search', '--tags', 'urgent'], 'search tag');
    ok(tag.some((t) => t.title === `${pfx}-full`), 'finds by tag');

    const window = h.j(
      ['task', 'search', '--due-from', '2026-09-10T00:00:00+0000', '--due-to', '2026-09-11T00:00:00+0000'],
      'search due window',
    );
    ok(window.some((t) => t.title === `${pfx}-full`), 'finds inside due window');
    const outside = h.j(
      ['task', 'search', '--due-from', '2020-01-01T00:00:00+0000', '--due-to', '2020-01-02T00:00:00+0000'],
      'search outside window',
    );
    eq(outside, [], 'empty outside window');
  });

  h.test('task move: single and batch', () => {
    const t1 = h.j(['task', 'create', '--title', `${pfx}-move1`, '--project', work.id], 'create move1');
    const t2 = h.j(['task', 'create', '--title', `${pfx}-move2`, '--project', work.id], 'create move2');

    const moved = h.j(
      ['task', 'move', '--from', work.id, '--to', other.id, '--task', t1.id],
      'task move single',
    );
    eq(moved[0].projectId, other.id, 'moved to destination');

    const batch = h.j(
      ['task', 'move',
        '--from', other.id, '--from', work.id,
        '--to', work.id, '--to', other.id,
        '--task', t1.id, '--task', t2.id],
      'task move batch',
    );
    eq(batch.find((x) => x.id === t1.id).projectId, work.id, 'batch: t1 back');
    eq(batch.find((x) => x.id === t2.id).projectId, other.id, 'batch: t2 moved');
    ids.push(t1.id, t2.id);
  });

  h.test('task move: mismatched --from/--to/--task counts fail', () => {
    h.runFails(
      ['task', 'move', '--from', work.id, '--to', other.id, '--task', 'a', '--task', 'b'],
      'same number of times',
      'move count mismatch',
    );
  });

  h.test('task comment: add / list / delete', () => {
    const t = h.j(['task', 'create', '--title', `${pfx}-commented`, '--project', work.id], 'create for comments');

    const c = h.j(['task', 'comment', 'add', work.id, t.id, '--title', 'first note'], 'comment add');
    ok(/^[0-9a-f]{24}$/.test(c.id), 'comment id');
    eq(c.title, 'first note', 'comment title');

    const list = h.j(['task', 'comment', 'list', work.id, t.id], 'comment list');
    ok(list.some((x) => x.id === c.id), 'list contains comment');

    h.runOk(['task', 'comment', 'delete', work.id, t.id, c.id], 'comment delete');
    const after = h.j(['task', 'comment', 'list', work.id, t.id], 'comment list after delete');
    ok(!after.some((x) => x.id === c.id), 'comment removed');
    ids.push(t.id);
  });

  h.test('task comment: literally empty title fails', () => {
    const t = h.j(['task', 'create', '--title', `${pfx}-nocmt`, '--project', work.id], 'create for bad comment');
    h.runFails(
      ['task', 'comment', 'add', work.id, t.id, '--title', ''],
      'title is required',
      'comment add empty title',
    );
    ids.push(t.id);
  });

  h.test('task delete: removes the task', () => {
    const t = h.j(['task', 'create', '--title', `${pfx}-del`, '--project', work.id], 'create for delete');
    h.runOk(['task', 'delete', work.id, t.id], 'task delete');
    h.runFails(['task', 'get', work.id, t.id], 'task not found', 'task get after delete');
  });

  // Cleanup fixture projects (cascades remaining tasks).
  h.runOk(['project', 'delete', work.id], 'cleanup fixture work');
  h.runOk(['project', 'delete', other.id], 'cleanup fixture other');
}
