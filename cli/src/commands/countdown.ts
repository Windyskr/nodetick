import chalk from 'chalk';
import { getApi } from '../lib/api.js';
import { numberOption } from '../lib/options.js';
import { formatCountdownRow, formatJson } from '../lib/output.js';

type Options = Record<string, string | boolean | undefined>;
type Command = import('commander').Command;

async function listCountdowns(options: { json?: boolean }) {
  const api = await getApi();
  const countdowns = await api.getCountdowns();
  if (options.json) {
    console.log(formatJson(countdowns));
    return;
  }
  if (countdowns.length === 0) {
    console.log('No countdowns found.');
    return;
  }
  for (const countdown of countdowns) {
    console.log(formatCountdownRow(countdown));
  }
}

async function createCountdown(options: Options & { json?: boolean }) {
  const api = await getApi();
  const countdown = await api.createCountdown({
    name: options.name,
    date: options.date,
    sortOrder: numberOption('--sort-order', options.sortOrder, { integer: true }),
  });
  if (options.json) {
    console.log(formatJson(countdown));
    return;
  }
  console.log(`${chalk.green('Created:')} ${countdown.name}`);
  console.log(chalk.dim(`ID: ${countdown.id}`));
}

async function updateCountdown(countdownId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const countdown = await api.updateCountdown(countdownId, {
    name: options.name,
    date: options.date,
    sortOrder: numberOption('--sort-order', options.sortOrder, { integer: true }),
  });
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
    .description('List all countdowns')
    .option('--json', 'Output as JSON')
    .action(listCountdowns);

  countdown
    .command('create')
    .description('Create a countdown')
    .requiredOption('--name <name>', 'Countdown name')
    .requiredOption('--date <date>', 'Target date (YYYY-MM-DD)')
    .option('--sort-order <n>', 'Sort order')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await createCountdown(options);
    });

  countdown
    .command('update <countdownId>')
    .description('Update a countdown')
    .option('--name <name>', 'Countdown name')
    .option('--date <date>', 'Target date (YYYY-MM-DD)')
    .option('--sort-order <n>', 'Sort order')
    .option('--json', 'Output as JSON')
    .action(updateCountdown);

  countdown
    .command('delete <countdownId>')
    .description('Delete a countdown')
    .action(deleteCountdown);
}
