import chalk from 'chalk';
import { getApi } from '../lib/api.js';
import { numberListOption, numberOption } from '../lib/options.js';
import { formatFocusRow, formatFocusView, formatJson } from '../lib/output.js';

type Options = Record<string, string | boolean | undefined>;
type Command = import('commander').Command;

function parseFocusType(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s === '0' || s === 'pomodoro' || s === 'p') return 0;
  if (s === '1' || s === 'timing' || s === 't') return 1;
  const n = parseInt(raw, 10);
  if (n === 0 || n === 1) return n;
  throw new Error(`Invalid focus type "${raw}". Use 0|pomodoro|p or 1|timing|t.`);
}

async function getFocusCmd(focusId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const type = parseFocusType(options.type as string);
  const focus = await api.getFocus(focusId, type);
  if (options.json) {
    console.log(formatJson(focus));
    return;
  }
  console.log(formatFocusView(focus));
}

async function listFocusCmd(options: Options & { json?: boolean }) {
  const api = await getApi();
  const type = parseFocusType(options.type as string);
  const list = await api.listFocus(options.from as string, options.to as string, type);
  if (options.json) {
    console.log(formatJson(list));
    return;
  }
  if (list.length === 0) {
    console.log('No focus records in range.');
    return;
  }
  for (const f of list) {
    console.log(formatFocusRow(f));
  }
}

async function createFocusCmd(options: Options & { json?: boolean }) {
  const api = await getApi();
  const type = parseFocusType(options.type as string);
  const focus = await api.createFocus({
    type,
    taskId: options.taskId,
    note: options.note,
    startTime: options.startTime,
    endTime: options.endTime,
    pauseDuration: numberOption('--pause-duration', options.pauseDuration, { integer: true }),
    duration: numberOption('--duration', options.duration, { integer: true }),
    relationType: numberListOption('--relation-type', options.relationType, { integer: true }),
  });
  if (options.json) {
    console.log(formatJson(focus));
    return;
  }
  console.log(`${chalk.green('Created:')} ${focus.id}`);
  console.log(formatFocusView(focus));
}

function parseBool(raw: string, label: string): boolean {
  const s = raw.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  throw new Error(`${label} must be true/false`);
}

async function updateFocusCmd(focusId: string, options: Options & { json?: boolean }) {
  const type = parseFocusType(options.type as string);
  const rawTask = options.taskId as string | undefined;
  // `--task-id none` (or "") unlinks the task, like `task update --parent-id none`.
  const taskId = rawTask === undefined ? undefined : rawTask === '' || rawTask.toLowerCase() === 'none' ? null : rawTask;
  const input = {
    type,
    taskId,
    note: options.note as string | undefined,
    startTime: options.startTime as string | undefined,
    endTime: options.endTime as string | undefined,
    duration: numberOption('--duration', options.duration, { integer: true }),
    pauseDuration: numberOption('--pause-duration', options.pauseDuration, { integer: true }),
    added: options.added != null ? parseBool(String(options.added), '--added') : undefined,
  };
  if (Object.entries(input).every(([key, value]) => key === 'type' || value === undefined)) {
    throw new Error('Specify at least one field to update: --task-id, --note, --start-time, --end-time, --duration, --pause-duration, --added');
  }
  if (input.startTime && input.endTime && Date.parse(input.endTime.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) < Date.parse(input.startTime.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))) {
    throw new Error('--end-time must not be earlier than --start-time');
  }
  const api = await getApi();
  const focus = await api.updateFocus(focusId, input);
  if (options.json) {
    console.log(formatJson(focus));
    return;
  }
  console.log(`${chalk.green('Updated:')} ${focus.id}`);
  console.log(formatFocusView(focus));
}

async function deleteFocusCmd(focusId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const type = parseFocusType(options.type as string);
  const focus = await api.deleteFocus(focusId, type);
  if (options.json) {
    console.log(formatJson(focus));
    return;
  }
  console.log(`${chalk.green('Deleted:')} ${focus.id}`);
}

export function registerFocusCommand(program: Command) {
  const focus = program
    .command('focus')
    .description('Create, query, update, and delete focus / Pomodoro records');

  focus
    .command('get <focusId>')
    .description('Get one focus record by id')
    .requiredOption('--type <type>', '0|pomodoro or 1|timing')
    .option('--json', 'Output as JSON')
    .action(getFocusCmd);

  focus
    .command('list')
    .description('List focus records in a time range (max 30 days)')
    .requiredOption('--from <iso>', 'Range start (yyyy-MM-ddTHH:mm:ss+ZZZZ)')
    .requiredOption('--to <iso>', 'Range end (yyyy-MM-ddTHH:mm:ss+ZZZZ)')
    .requiredOption('--type <type>', '0|pomodoro or 1|timing')
    .option('--json', 'Output as JSON')
    .action(listFocusCmd);

  focus
    .command('create')
    .description('Create a focus record')
    .requiredOption('--type <type>', '0|pomodoro or 1|timing')
    .option('--task-id <taskId>', 'Associated task id')
    .option('--note <note>', 'Focus note (max 5000 chars)')
    .option('--start-time <iso>', 'Start time (yyyy-MM-ddTHH:mm:ss+ZZZZ)')
    .option('--end-time <iso>', 'End time (yyyy-MM-ddTHH:mm:ss+ZZZZ)')
    .option('--pause-duration <seconds>', 'Pause duration in seconds')
    .option('--duration <seconds>', 'Focus duration in seconds')
    .option('--relation-type <types>', 'Comma-separated relation type integers')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await createFocusCmd(options);
    });

  focus
    .command('update <focusId>')
    .description('Update a focus record (type required; new times recompute the duration)')
    .requiredOption('--type <type>', '0|pomodoro or 1|timing')
    .option('--task-id <taskId>', 'Associated task id ("none" unlinks it)')
    .option('--note <note>', 'Focus note ("" clears it)')
    .option('--start-time <iso>', 'Start time (yyyy-MM-ddTHH:mm:ss+ZZZZ)')
    .option('--end-time <iso>', 'End time (yyyy-MM-ddTHH:mm:ss+ZZZZ)')
    .option('--duration <seconds>', 'Focus duration in seconds')
    .option('--pause-duration <seconds>', 'Pause duration in seconds')
    .option('--added <bool>', 'Manually added (true/false)')
    .option('--json', 'Output as JSON')
    .action(updateFocusCmd);

  focus
    .command('delete <focusId>')
    .description('Delete a focus record')
    .requiredOption('--type <type>', '0|pomodoro or 1|timing')
    .option('--json', 'Output as JSON')
    .action(deleteFocusCmd);
}
