import chalk from 'chalk';
import { getApi } from '../lib/api.js';
import { numberOption } from '../lib/options.js';
import { formatCountdownRow, formatJson } from '../lib/output.js';

type Options = Record<string, string | boolean | undefined>;
type Command = import('commander').Command;

const REMINDERS = 'same-day,1-day,2-days,3-days,1-week,1-month';

/** Request fields from the create/update options; the server validates the values. */
function countdownFields(options: Options) {
  const text = (value: string | boolean | undefined) => (typeof value === 'string' ? value : undefined);
  const repeat = text(options.repeat);
  const reminders = text(options.reminders);
  const reminderTime = text(options.reminderTime);
  return {
    name: text(options.name),
    date: text(options.date),
    kind: text(options.kind),
    repeatFlag: repeat === undefined ? undefined : repeat === 'none' ? null : repeat,
    lunar: typeof options.lunar === 'boolean' ? options.lunar : undefined,
    reminders: reminders === undefined ? undefined : reminders === 'none' ? [] : reminders.split(',').map((s) => s.trim()).filter(Boolean),
    reminderTime: reminderTime === undefined ? undefined : reminderTime === 'default' ? null : reminderTime,
    calculation: text(options.calculation),
    note: text(options.note),
    color: text(options.color),
    icon: text(options.icon),
    style: numberOption('--style', options.style, { integer: true }),
    numberFormat: text(options.format),
    pinned: typeof options.pin === 'boolean' ? options.pin : undefined,
    archived: typeof options.archive === 'boolean' ? options.archive : undefined,
    showInCalendar: typeof options.calendar === 'boolean' ? options.calendar : undefined,
    sortOrder: numberOption('--sort-order', options.sortOrder, { integer: true }),
  };
}

function addFieldOptions(command: Command): Command {
  return command
    .option('--kind <kind>', 'countdown, anniversary, birthday or holiday')
    .option('--repeat <repeat>', 'none, monthly or yearly')
    .option('--lunar', 'The date is a Chinese lunar date: yearly repeats follow the lunar calendar (pass its Gregorian day as --date)')
    .option('--no-lunar', 'Use the Gregorian calendar')
    .option('--reminders <list>', `Comma-separated: ${REMINDERS}, or "none"`)
    .option('--reminder-time <HH:MM>', 'Reminder time, or "default" for the all-day reminder time')
    .option('--calculation <mode>', 'standard, or workday to count Monday–Friday only')
    .option('--note <text>', 'Note')
    .option('--color <hex>', 'Card color, e.g. #E5484D')
    .option('--icon <emoji>', 'Icon (an emoji)')
    .option('--style <n>', 'Card style 0–4: classic, solid, calendar, soft, ring')
    .option('--format <format>', 'Number format: days or ymd (years, months, days)')
    .option('--pin', 'Pin to the top')
    .option('--no-pin', 'Unpin')
    .option('--archive', 'Archive')
    .option('--no-archive', 'Restore from the archive')
    .option('--calendar', 'Show in the web calendar')
    .option('--no-calendar', 'Hide from the web calendar')
    .option('--sort-order <n>', 'Sort order (custom sort)')
    .option('--json', 'Output as JSON');
}

async function listCountdowns(options: { json?: boolean; archived?: boolean }) {
  const api = await getApi();
  const all = await api.getCountdowns();
  // --json stays the raw API list; the table hides archived ones unless asked.
  if (options.json) {
    console.log(formatJson(options.archived ? all.filter((c) => c.archived) : all));
    return;
  }
  const countdowns = all.filter((c) => Boolean(c.archived) === Boolean(options.archived));
  if (countdowns.length === 0) {
    console.log(options.archived ? 'No archived countdowns.' : 'No countdowns found.');
    return;
  }
  for (const countdown of countdowns) {
    console.log(formatCountdownRow(countdown));
  }
}

async function createCountdown(options: Options & { json?: boolean }) {
  const api = await getApi();
  const countdown = await api.createCountdown(countdownFields(options));
  if (options.json) {
    console.log(formatJson(countdown));
    return;
  }
  console.log(`${chalk.green('Created:')} ${countdown.name}`);
  console.log(chalk.dim(`ID: ${countdown.id}`));
}

async function updateCountdown(countdownId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const countdown = await api.updateCountdown(countdownId, countdownFields(options));
  if (options.json) {
    console.log(formatJson(countdown));
    return;
  }
  console.log(`${chalk.green('Updated:')} ${countdown.name}`);
}

async function deleteCountdown(countdownId: string) {
  const api = await getApi();
  await api.deleteCountdown(countdownId);
  console.log(chalk.green('Countdown deleted'));
}

export function registerCountdownCommand(program: Command) {
  const countdown = program.command('countdown').description('Manage countdowns');

  countdown
    .command('list')
    .description('List countdowns (archived ones with --archived)')
    .option('--archived', 'List archived countdowns')
    .option('--json', 'Output as JSON')
    .action(listCountdowns);

  addFieldOptions(
    countdown
      .command('create')
      .description('Create a countdown')
      .requiredOption('--name <name>', 'Countdown name')
      .requiredOption('--date <date>', 'Target date (YYYY-MM-DD)'),
  ).action(async (options) => {
    await createCountdown(options);
  });

  addFieldOptions(
    countdown
      .command('update <countdownId>')
      .description('Update a countdown (only the given options change)')
      .option('--name <name>', 'Countdown name')
      .option('--date <date>', 'Target date (YYYY-MM-DD)'),
  ).action(updateCountdown);

  countdown
    .command('delete <countdownId>')
    .description('Delete a countdown')
    .action(deleteCountdown);
}
