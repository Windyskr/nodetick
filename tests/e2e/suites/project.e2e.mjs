import { eq, has, ok } from '../lib.mjs';

export async function run({ h }) {
  const pfx = h.pfx;

  let projectId;
  let columnId;
  let groupId;

  h.test('project create: TASK project with color/view-mode', () => {
    const p = h.j(['project', 'create', '--name', `${pfx}-work`, '--color', '#F18181', '--view-mode', 'kanban', '--kind', 'TASK'], 'project create');
    ok(p.id && /^[0-9a-f]{24}$/.test(p.id), 'id is a 24-hex ObjectId');
    eq(p.name, `${pfx}-work`, 'name');
    eq(p.color, '#F18181', 'color');
    eq(p.viewMode, 'kanban', 'viewMode');
    eq(p.kind, 'TASK', 'kind');
    eq(p.closed, false, 'closed defaults to false');
    projectId = p.id;
  });

  h.test('project create: NOTE kind', () => {
    const p = h.j(['project', 'create', '--name', `${pfx}-notes`, '--kind', 'NOTE'], 'project create NOTE');
    eq(p.kind, 'NOTE', 'kind NOTE');
    h.runOk(['project', 'delete', p.id], 'cleanup NOTE project');
  });

  h.test('project create: missing --name fails', () => {
    h.runFails(['project', 'create'], 'required option', 'project create validation');
  });

  h.test('project list: contains the created project', () => {
    const list = h.j(['project', 'list'], 'project list');
    ok(list.some((p) => p.id === projectId), 'list contains created project');
  });

  h.test('project get: round-trips fields', () => {
    const p = h.j(['project', 'get', projectId], 'project get');
    eq(p.id, projectId, 'id');
    eq(p.name, `${pfx}-work`, 'name');
    eq(p.viewMode, 'kanban', 'viewMode');
    const r = h.runOk(['project', 'get', projectId], 'project get text');
    has(r.stdout, `${pfx}-work`, 'text output shows name');
  });

  h.test('project get: unknown id fails', () => {
    h.runFails(['project', 'get', '0'.repeat(24)], null, 'project get 404');
  });

  h.test('project update: name/color/view-mode', () => {
    const p = h.j(['project', 'update', projectId, '--name', `${pfx}-work2`, '--color', '#4AB8A9', '--view-mode', 'list'], 'project update');
    eq(p.name, `${pfx}-work2`, 'updated name');
    eq(p.color, '#4AB8A9', 'updated color');
    eq(p.viewMode, 'list', 'updated viewMode');
  });

  h.test('project data: returns project + tasks + columns', () => {
    const d = h.j(['project', 'data', projectId], 'project data');
    eq(d.project.id, projectId, 'project.id');
    ok(Array.isArray(d.tasks), 'tasks array');
    ok(Array.isArray(d.columns), 'columns array');
  });

  h.test('project column create / list / update', () => {
    const col = h.j(['project', 'column', 'create', projectId, '--name', 'In progress'], 'column create');
    eq(col.projectId, projectId, 'column.projectId');
    eq(col.name, 'In progress', 'column.name');
    columnId = col.id;

    const cols = h.j(['project', 'column', 'list', projectId], 'column list');
    ok(cols.some((c) => c.id === columnId), 'list contains column');

    const upd = h.j(['project', 'column', 'update', projectId, columnId, '--name', 'Done'], 'column update');
    eq(upd.name, 'Done', 'updated column name');

    const d = h.j(['project', 'data', projectId], 'project data after column');
    eq(d.columns.length, 1, 'data exposes one column');
  });

  h.test('project group: create / list / update / delete', () => {
    const g = h.j(['project', 'group', 'create', '--name', `${pfx}-life`], 'group create');
    eq(g.name, `${pfx}-life`, 'group name');
    groupId = g.id;

    const groups = h.j(['project', 'group', 'list'], 'group list');
    ok(groups.some((x) => x.id === groupId), 'list contains group');

    const upd = h.j(['project', 'group', 'update', groupId, '--name', `${pfx}-life2`], 'group update');
    eq(upd.name, `${pfx}-life2`, 'updated group name');

    h.runOk(['project', 'group', 'delete', groupId], 'group delete');
    const after = h.j(['project', 'group', 'list'], 'group list after delete');
    ok(!after.some((x) => x.id === groupId), 'group removed');
  });

  h.test('project data: text output renders sections', () => {
    const r = h.runOk(['project', 'data', projectId], 'project data text');
    has(r.stdout, 'Columns (1)', 'columns section');
    // The CLI renders the tasks section only when at least one task exists.
    ok(!r.stdout.includes('Tasks ('), 'no tasks section for an empty project');
  });

  h.test('project delete: removes the project and cascades', () => {
    h.runOk(['project', 'delete', projectId], 'project delete');
    h.runFails(['project', 'get', projectId], null, 'project get after delete');
    // Columns of a deleted project resolve to an empty list (lenient server).
    const cols = h.runOk(['project', 'column', 'list', projectId], 'column list after delete');
    has(cols.stdout, 'No columns found', 'cascade removed the columns');
  });
}
