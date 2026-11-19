import fs from 'node:fs';
import path from 'node:path';
import { eq, has, ok } from '../lib.mjs';

export async function run({ h }) {
  const pfx = h.pfx;
  const file = path.join(h.home, `${pfx}-backup.json`);
  const project = h.j(['project', 'create', '--name', `${pfx}-backup`], 'fixture project');
  const task = h.j(['task', 'create', '--title', `${pfx}-backed-up`, '--project', project.id], 'fixture task');

  h.test('backup export: writes the file and reports row counts', () => {
    const summary = h.j(['backup', 'export', file], 'backup export');
    eq(summary.file, file, 'target path');
    ok(summary.tasks >= 1 && summary.projects >= 1, 'counts tasks and projects');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    eq(doc.app, 'nodetick', 'backup app marker');
    ok(doc.tasks.some((t) => t.id === task.id), 'fixture task exported');
  });

  h.test('backup import: own rows are restored and never skipped', () => {
    // Re-import only the fixture rows: the suite may run against a real
    // account, whose other rows must not be rewritten.
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const subset = path.join(h.home, `${pfx}-subset.json`);
    fs.writeFileSync(subset, JSON.stringify({
      app: doc.app,
      version: doc.version,
      projects: doc.projects.filter((p) => p.id === project.id),
      tasks: doc.tasks.filter((t) => t.id === task.id),
    }));
    h.runOk(['task', 'update', task.id, '--id', task.id, '--project', project.id, '--title', `${pfx}-changed`], 'change task');
    const result = h.j(['backup', 'import', subset], 'backup import');
    eq(result.imported, 2, 'fixture project + task imported');
    eq(result.skipped, 0, 'own rows are never skipped');
    eq(h.j(['task', 'get', project.id, task.id], 'task after import').title, `${pfx}-backed-up`, 'title restored');
  });

  h.test('backup import: rejects files that are not NodeTick backups', () => {
    const bogus = path.join(h.home, `${pfx}-bogus.json`);
    fs.writeFileSync(bogus, JSON.stringify({ app: 'other' }));
    h.runFails(['backup', 'import', bogus], 'not a NodeTick backup', 'import foreign file');
    fs.writeFileSync(bogus, '{oops');
    const r = h.runFails(['backup', 'import', bogus], null, 'import invalid JSON');
    has(r.stderr, 'is not valid JSON', 'invalid JSON message');
  });

  h.runOk(['project', 'delete', project.id], 'cleanup fixture project');
}
