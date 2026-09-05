import { readFile, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { getApi } from '../lib/api.js';
import { formatJson } from '../lib/output.js';

type Command = import('commander').Command;

/** Row counts for the backup document's known collections. */
function collectionCounts(backup: Record<string, unknown>): Record<string, number> {
  const names = [
    'projects', 'projectGroups', 'tags', 'filters', 'tasks', 'habits',
    'habitCheckins', 'habitRecords', 'focusRecords', 'countdowns',
  ];
  const counts: Record<string, number> = {};
  for (const name of names) {
    const rows = backup[name];
    if (Array.isArray(rows)) counts[name] = rows.length;
  }
  return counts;
}

async function exportBackup(file: string | undefined, options: { json?: boolean }) {
  const api = await getApi();
  const backup = await api.exportBackup();
  const target = file ?? `nodetick-backup-${new Date().toISOString().slice(0, 10)}.json`;
  await writeFile(target, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  const counts = collectionCounts(backup);
  if (options.json) {
    console.log(formatJson({ file: target, ...counts }));
    return;
  }
  console.log(`${chalk.green('Backup written:')} ${target}`);
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name}: ${count}`);
  }
}

async function importBackup(file: string, options: { json?: boolean }) {
  const raw = await readFile(file, 'utf8');
  let backup: unknown;
  try {
    backup = JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  const api = await getApi();
  const result = await api.importBackup(backup);
  if (options.json) {
    console.log(formatJson(result));
    return;
  }
  console.log(`${chalk.green('Imported:')} ${result.imported} rows from ${file}`);
}

export function registerBackupCommand(program: Command) {
  const backup = program.command('backup').description('Export or import a full account backup');
  backup
    .command('export')
    .description('Download every project, task, habit, focus and countdown row as one JSON file')
    .argument('[file]', `Output path (default nodetick-backup-<today>.json)`)
    .option('--json', 'Output the summary as JSON')
    .action(async (file: string | undefined, options: { json?: boolean }) => {
      await exportBackup(file, options);
    });
  backup
    .command('import')
    .description('Merge a previously exported backup file back into the account (upserts by id)')
    .argument('<file>', 'Path to a nodetick-backup-*.json file')
    .option('--json', 'Output the result as JSON')
    .action(async (file: string, options: { json?: boolean }) => {
      await importBackup(file, options);
    });
}
