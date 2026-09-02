import chalk from 'chalk';
import { getApi } from '../lib/api.js';
import { formatHabitRow, formatHabitView, formatJson } from '../lib/output.js';

type Options = Record<string, string | boolean | undefined>;
type Command = import('commander').Command;

function parseStringList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function habitFields(options: Options) {
  return {
    name: options.name,
    iconRes: options.iconRes,
    color: options.color,
    sortOrder: options.sortOrder ? parseInt(options.sortOrder as string, 10) : undefined,
    status: options.status ? parseInt(options.status as string, 10) : undefined,
    encouragement: options.encouragement,
    type: options.type,
    goal: options.goal != null ? Number(options.goal) : undefined,
    step: options.step != null ? Number(options.step) : undefined,
    unit: options.unit,
    repeatRule: options.repeat,
    reminders: options.reminders ? parseStringList(options.reminders as string) : undefined,
    sectionId: options.sectionId,
    style: options.style ? parseInt(options.style as string, 10) : undefined,
  };
}

async function getHabitCmd(habitId: string, options: { json?: boolean }) {
  const api = await getApi();
  const habit = await api.getHabit(habitId);
  if (options.json) {
    console.log(formatJson(habit));
    return;
  }
  console.log(formatHabitView(habit));
}

async function listHabitsCmd(options: { json?: boolean }) {
  const api = await getApi();
  const habits = await api.listHabits();
  if (options.json) {
    console.log(formatJson(habits));
    return;
  }
  if (habits.length === 0) {
    console.log('No habits.');
    return;
  }
  for (const h of habits) {
    console.log(formatHabitRow(h));
  }
}

async function createHabitCmd(options: Options & { json?: boolean }) {
  const api = await getApi();
  const habit = await api.createHabit(habitFields(options));
  if (options.json) {
    console.log(formatJson(habit));
    return;
  }
  console.log(`${chalk.green('Created:')} ${habit.name}`);
  console.log(chalk.dim(`ID: ${habit.id}`));
}

async function updateHabitCmd(habitId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const habit = await api.updateHabit(habitId, habitFields(options));
  if (options.json) {
    console.log(formatJson(habit));
    return;
  }
  console.log(`${chalk.green('Updated:')} ${habit.name}`);
}

async function checkinCmd(habitId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const stamp = parseInt(options.stamp as string, 10);
  if (Number.isNaN(stamp) || String(stamp).length !== 8) {
    throw new Error('stamp must be YYYYMMDD, e.g. 20260407');
  }
  const agg = await api.createHabitCheckin(habitId, {
    stamp,
    time: options.time,
    opTime: options.opTime,
    value: options.value != null ? Number(options.value) : undefined,
    goal: options.goal != null ? Number(options.goal) : undefined,
    status: options.status ? parseInt(options.status as string, 10) : undefined,
  });
  if (options.json) {
    console.log(formatJson(agg));
    return;
  }
  console.log(`${chalk.green('Check-in:')} habit ${agg.habitId} (${agg.year ?? ''})`);
}

async function checkinsCmd(options: Options & { json?: boolean }) {
  const api = await getApi();
  const habitIds = parseStringList(options.habits as string);
  if (habitIds.length === 0) {
    throw new Error('Provide at least one habit id in --habits');
  }
  const from = parseInt(options.from as string, 10);
  const to = parseInt(options.to as string, 10);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error('from and to must be YYYYMMDD integers');
  }
  const rows = await api.getHabitCheckins(habitIds, from, to);
  if (options.json) {
    console.log(formatJson(rows));
    return;
  }
  for (const row of rows) {
    console.log(chalk.bold(`${row.habitId} (${row.year})`));
    const checkins = (row.checkins ?? []) as Record<string, unknown>[];
    for (const c of checkins) {
      console.log(`  ${c.stamp}  value:${c.value ?? '-'}  goal:${c.goal ?? '-'}`);
    }
  }
}

export function registerHabitCommand(program: Command) {
  const habit = program.command('habit').description('Manage habits and check-ins');

  habit
    .command('get <habitId>')
    .description('Get habit by id')
    .option('--json', 'Output as JSON')
    .action(getHabitCmd);

  habit
    .command('list')
    .description('List all habits')
    .option('--json', 'Output as JSON')
    .action(listHabitsCmd);

  habit
    .command('create')
    .description('Create a habit')
    .requiredOption('--name <name>', 'Habit name')
    .option('--icon-res <id>', 'Icon resource id')
    .option('--color <hex>', 'Color')
    .option('--sort-order <n>', 'Sort order')
    .option('--status <n>', 'Status code')
    .option('--encouragement <text>', 'Encouragement message')
    .option('--type <type>', 'Habit type string')
    .option('--goal <n>', 'Goal')
    .option('--step <n>', 'Step')
    .option('--unit <u>', 'Unit')
    .option('--repeat <rrule>', 'Repeat rule, e.g. RRULE:FREQ=DAILY;INTERVAL=1')
    .option('--reminders <list>', 'Comma-separated reminders')
    .option('--section-id <id>', 'Section id')
    .option('--style <n>', 'Style')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await createHabitCmd(options);
    });

  habit
    .command('update <habitId>')
    .description('Update a habit')
    .option('--name <name>', 'Habit name')
    .option('--icon-res <id>', 'Icon resource id')
    .option('--color <hex>', 'Color')
    .option('--sort-order <n>', 'Sort order')
    .option('--status <n>', 'Status code')
    .option('--encouragement <text>', 'Encouragement message')
    .option('--type <type>', 'Habit type string')
    .option('--goal <n>', 'Goal')
    .option('--step <n>', 'Step')
    .option('--unit <u>', 'Unit')
    .option('--repeat <rrule>', 'Repeat rule')
    .option('--reminders <list>', 'Comma-separated reminders')
    .option('--section-id <id>', 'Section id')
    .option('--style <n>', 'Style')
    .option('--json', 'Output as JSON')
    .action(async (habitId: string, options) => {
      await updateHabitCmd(habitId, options);
    });

  habit
    .command('checkin <habitId>')
    .description('Create or update a check-in (stamp YYYYMMDD)')
    .requiredOption('--stamp <YYYYMMDD>', 'Date stamp, e.g. 20260407')
    .option('--time <iso>', 'Check-in time (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--op-time <iso>', 'Operation time')
    .option('--value <n>', 'Value (default 1.0)')
    .option('--goal <n>', 'Goal for entry')
    .option('--status <n>', 'Status')
    .option('--json', 'Output as JSON')
    .action(checkinCmd);

  habit
    .command('checkins')
    .description('Query check-ins for habits in a date range')
    .requiredOption('--habits <ids>', 'Comma-separated habit ids')
    .requiredOption('--from <YYYYMMDD>', 'Start date stamp')
    .requiredOption('--to <YYYYMMDD>', 'End date stamp')
    .option('--json', 'Output as JSON')
    .action(checkinsCmd);
}
