#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { program } from 'commander';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

program
  .name('nodetick')
  .description('NodeTick CLI – tasks, projects, habits, and focus against your own Cloudflare')
  .version(version);

const commands: Record<string, [string, () => Promise<unknown>]> = {
  auth: [
    'OAuth and token storage',
    async () => (await import('./commands/auth.js')).registerAuthCommand,
  ],
  task: [
    'Create, update, and query tasks',
    async () => (await import('./commands/task.js')).registerTaskCommand,
  ],
  project: [
    'List and manage projects',
    async () => (await import('./commands/project.js')).registerProjectCommand,
  ],
  habit: [
    'Manage habits and check-ins',
    async () => (await import('./commands/habit.js')).registerHabitCommand,
  ],
  focus: [
    'Create, query, and delete focus / Pomodoro records',
    async () => (await import('./commands/focus.js')).registerFocusCommand,
  ],
  tag: [
    'List and create tags',
    async () => (await import('./commands/tag.js')).registerTagCommand,
  ],
  countdown: [
    'Manage countdowns',
    async () => (await import('./commands/countdown.js')).registerCountdownCommand,
  ],
  backup: [
    'Export or import a full account backup',
    async () => (await import('./commands/backup.js')).registerBackupCommand,
  ],
};

// Register lightweight placeholders (fast top-level --help), but load the real
// command tree for whichever top-level command the user actually invoked.
const args = process.argv.slice(2);
// Own keys only: `a in commands` would match prototype names like "constructor".
const commandName = args.find((a) => !a.startsWith('-') && Object.hasOwn(commands, a));
if (commandName) {
  const register = (await commands[commandName][1]()) as (p: typeof program) => void;
  for (const [name, [description]] of Object.entries(commands)) {
    if (name !== commandName) program.command(name).description(description);
  }
  register(program);
} else {
  for (const [name, [description]] of Object.entries(commands)) {
    program.command(name).description(description);
  }
}

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
