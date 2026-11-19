import chalk from 'chalk';
import { getApi } from '../lib/api.js';
import { formatCommentRow, formatJson, formatTaskRow, formatTaskView } from '../lib/output.js';
import { numberListOption, numberOption } from '../lib/options.js';

function parseItems(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.split(',').map((title) => ({ title: title.trim(), status: 0 }));
  }
}

function parseStringList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim());
}

function parseParentId(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const value = raw.trim();
  if (value === '' || ['null', 'none'].includes(value.toLowerCase())) {
    return '';
  }
  return value;
}

function parseEstimatedPomo(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 60) {
    throw new Error('--estimated-pomo must be an integer between 0 and 60');
  }
  return n;
}

function parseEstimatedDuration(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new Error('--estimated-duration must be a non-negative integer (seconds)');
  }
  return n;
}

async function getTask(projectId: string, taskId: string, options: { json?: boolean }) {
  const api = await getApi();
  const task = await api.getTask(projectId, taskId);
  if (options.json) {
    console.log(formatJson(task));
    return;
  }
  console.log(formatTaskView(task));
}

async function createTask(options: Record<string, string | boolean | undefined>) {
  const api = await getApi();
  const task = await api.createTask({
    title: options.title,
    projectId: options.project,
    content: options.content,
    desc: options.desc,
    isAllDay: options.allDay,
    startDate: options.startDate,
    dueDate: options.dueDate,
    timeZone: options.timeZone,
    reminders: options.reminders ? parseStringList(options.reminders as string) : undefined,
    repeatFlag: options.repeat,
    priority: numberOption('--priority', options.priority, { integer: true }),
    sortOrder: numberOption('--sort-order', options.sortOrder, { integer: true }),
    items: options.items ? parseItems(options.items as string) : undefined,
    tags: options.tags ? parseStringList(options.tags as string) : undefined,
  });
  if (options.json) {
    console.log(formatJson(task));
    return;
  }
  console.log(`${chalk.green('Created:')} ${task.title}`);
  console.log(chalk.dim(`ID: ${task.id}`));
}

async function updateTask(
  taskId: string,
  options: Record<string, string | boolean | undefined>,
) {
  const api = await getApi();
  const estimatedPomo = parseEstimatedPomo(options.estimatedPomo as string | undefined);
  const estimatedDuration = parseEstimatedDuration(options.estimatedDuration as string | undefined);
  const focusSummaries =
    estimatedPomo != null || estimatedDuration != null
      ? [
          {
            estimatedPomo,
            estimatedDuration,
          },
        ]
      : undefined;
  const task = await api.updateTask(taskId, {
    id: options.id,
    projectId: options.project,
    parentId: parseParentId(options.parentId as string | undefined),
    focusSummaries,
    title: options.title,
    content: options.content,
    desc: options.desc,
    isAllDay: options.allDay,
    startDate: options.startDate,
    dueDate: options.dueDate,
    timeZone: options.timeZone,
    reminders: options.reminders ? parseStringList(options.reminders as string) : undefined,
    repeatFlag: options.repeat,
    priority: numberOption('--priority', options.priority, { integer: true }),
    sortOrder: numberOption('--sort-order', options.sortOrder, { integer: true }),
    items: options.items ? parseItems(options.items as string) : undefined,
    tags: options.tags ? parseStringList(options.tags as string) : undefined,
  });
  if (options.json) {
    console.log(formatJson(task));
    return;
  }
  console.log(`${chalk.green('Updated:')} ${task.title}`);
}

async function completeTask(projectId: string, taskId: string) {
  const api = await getApi();
  await api.completeTask(projectId, taskId);
  console.log(chalk.green('Task completed'));
}

async function deleteTask(projectId: string, taskId: string) {
  const api = await getApi();
  await api.deleteTask(projectId, taskId);
  console.log(chalk.green('Task deleted'));
}

interface MoveOptions {
  from: string[];
  to: string[];
  task: string[];
  json?: boolean;
}

async function moveTasks(options: MoveOptions) {
  if (options.from.length !== options.to.length || options.from.length !== options.task.length) {
    throw new Error('--from, --to, and --task must be specified the same number of times');
  }
  const moves = options.from.map((fromProjectId, i) => ({
    fromProjectId,
    toProjectId: options.to[i],
    taskId: options.task[i],
  }));
  const api = await getApi();
  const results = await api.moveTasks(moves);
  if (options.json) {
    console.log(formatJson(results));
    return;
  }
  for (const r of results) {
    console.log(`${chalk.green('Moved:')} ${r.id}`);
  }
}

async function listCompleted(options: Record<string, string | boolean | undefined>) {
  const api = await getApi();
  const tasks = await api.getCompletedTasks({
    projectIds: options.projects ? parseStringList(options.projects as string) : undefined,
    startDate: options.startDate,
    endDate: options.endDate,
  });
  if (options.json) {
    console.log(formatJson(tasks));
    return;
  }
  if (tasks.length === 0) {
    console.log('No completed tasks found.');
    return;
  }
  for (const task of tasks) {
    console.log(formatTaskRow(task));
  }
}

async function listTaskComments(
  projectId: string,
  taskId: string,
  options: { json?: boolean },
) {
  const api = await getApi();
  const comments = await api.getTaskComments(projectId, taskId);
  if (options.json) {
    console.log(formatJson(comments));
    return;
  }
  if (comments.length === 0) {
    console.log('No comments found.');
    return;
  }
  for (const comment of comments) {
    console.log(formatCommentRow(comment));
  }
}

async function addTaskComment(
  projectId: string,
  taskId: string,
  options: { title: string; json?: boolean },
) {
  const api = await getApi();
  const comment = await api.addTaskComment(projectId, taskId, { title: options.title });
  if (options.json) {
    console.log(formatJson(comment));
    return;
  }
  console.log(`${chalk.green('Added comment:')} ${comment.title}`);
  console.log(chalk.dim(`ID: ${comment.id}`));
}

async function deleteTaskComment(projectId: string, taskId: string, commentId: string) {
  const api = await getApi();
  await api.deleteTaskComment(projectId, taskId, commentId);
  console.log(chalk.green('Comment deleted'));
}

async function filterTasksCmd(options: Record<string, string | boolean | undefined>) {
  const api = await getApi();
  const tasks = await api.filterTasks({
    projectIds: options.projects ? parseStringList(options.projects as string) : undefined,
    startDate: options.startDate,
    endDate: options.endDate,
    priority: numberListOption('--priority', options.priority, { integer: true }),
    tag: options.tag ? parseStringList(options.tag as string) : undefined,
    status: numberListOption('--status', options.status, { integer: true }),
  });
  if (options.json) {
    console.log(formatJson(tasks));
    return;
  }
  if (tasks.length === 0) {
    console.log('No tasks match the filter.');
    return;
  }
  for (const task of tasks) {
    console.log(formatTaskRow(task));
  }
}

async function searchTasksCmd(
  keywords: string | undefined,
  options: Record<string, string | boolean | undefined>,
) {
  const api = await getApi();
  const tasks = await api.searchTasks({
    keywords,
    projectIds: options.projects ? parseStringList(options.projects as string) : undefined,
    tags: options.tags ? parseStringList(options.tags as string) : undefined,
    status: numberListOption('--status', options.status, { integer: true }),
    dueFrom: options.dueFrom,
    dueTo: options.dueTo,
  });
  if (options.json) {
    console.log(formatJson(tasks));
    return;
  }
  if (tasks.length === 0) {
    console.log('No matching tasks found.');
    return;
  }
  for (const task of tasks) {
    console.log(formatTaskRow(task));
  }
}

type Command = import('commander').Command;

export function registerTaskCommand(program: Command) {
  const task = program.command('task').description('Create, update, and query tasks');

  task
    .command('get <projectId> <taskId>')
    .description('Fetch a task by project and task ID')
    .option('--json', 'Output as JSON')
    .action(getTask);

  task
    .command('create')
    .description('Create a task')
    .requiredOption('--title <title>', 'Task title')
    .requiredOption('--project <projectId>', 'Project ID')
    .option('--content <content>', 'Task content')
    .option('--desc <desc>', 'Description of checklist')
    .option('--all-day', 'All day task')
    .option('--start-date <date>', 'Start date (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--due-date <date>', 'Due date (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--time-zone <tz>', 'Time zone')
    .option('--reminders <triggers>', 'Comma-separated reminder triggers')
    .option('--repeat <rule>', 'Recurring rule (RRULE format)')
    .option('--priority <n>', 'Priority: 0=None, 1=Low, 3=Medium, 5=High')
    .option('--sort-order <n>', 'Sort order')
    .option('--items <json|csv>', 'Subtasks as JSON array or comma-separated titles')
    .option('--tags <tags>', 'Comma-separated task tags')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await createTask(options);
    });

  task
    .command('update <taskId>')
    .description('Update a task')
    .requiredOption('--id <id>', 'Task ID (in body)')
    .requiredOption('--project <projectId>', 'Project ID')
    .option('--parent-id <parentId>', 'Parent task ID (use "null" or "none" to unlink parent task)')
    .option('--estimated-duration <seconds>', 'Estimated focus duration in seconds')
    .option('--estimated-pomo <count>', 'Estimated pomodoro count (0-60)')
    .option('--title <title>', 'Task title')
    .option('--content <content>', 'Task content')
    .option('--desc <desc>', 'Description of checklist')
    .option('--all-day', 'All day task')
    .option('--start-date <date>', 'Start date (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--due-date <date>', 'Due date (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--time-zone <tz>', 'Time zone')
    .option('--reminders <triggers>', 'Comma-separated reminder triggers')
    .option('--repeat <rule>', 'Recurring rule (RRULE format)')
    .option('--priority <n>', 'Priority: 0=None, 1=Low, 3=Medium, 5=High')
    .option('--sort-order <n>', 'Sort order')
    .option('--items <json|csv>', 'Subtasks as JSON array or comma-separated titles')
    .option('--tags <tags>', 'Comma-separated task tags')
    .option('--json', 'Output as JSON')
    .action(updateTask);

  task
    .command('complete <projectId> <taskId>')
    .description('Complete a task')
    .action(completeTask);

  task
    .command('delete <projectId> <taskId>')
    .description('Delete a task')
    .action(deleteTask);

  task
    .command('move')
    .description('Move tasks between projects')
    .requiredOption('--from <projectId...>', 'Source project ID(s)')
    .requiredOption('--to <projectId...>', 'Destination project ID(s)')
    .requiredOption('--task <taskId...>', 'Task ID(s) to move')
    .option('--json', 'Output as JSON')
    .action(moveTasks);

  task
    .command('completed')
    .description('List completed tasks')
    .option('--projects <ids>', 'Comma-separated project IDs')
    .option('--start-date <date>', 'Start date filter (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--end-date <date>', 'End date filter (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--json', 'Output as JSON')
    .action(listCompleted);

  task
    .command('filter')
    .description('Filter tasks with advanced criteria')
    .option('--projects <ids>', 'Comma-separated project IDs')
    .option('--start-date <date>', 'Filter by start date')
    .option('--end-date <date>', 'Filter by end date')
    .option('--priority <levels>', 'Comma-separated priority levels (0,1,3,5)')
    .option('--tag <tags>', 'Comma-separated tags')
    .option('--status <codes>', 'Comma-separated status codes (0=Open, 2=Completed)')
    .option('--json', 'Output as JSON')
    .action(filterTasksCmd);

  task
    .command('search [keywords]')
    .description('Search tasks by keywords and filters')
    .option('--projects <ids>', 'Comma-separated project IDs')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--status <codes>', 'Comma-separated status codes (0=Open, 2=Completed)')
    .option('--due-from <date>', 'Minimum due date (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--due-to <date>', 'Maximum due date (yyyy-MM-ddTHH:mm:ssZ)')
    .option('--json', 'Output as JSON')
    .action(searchTasksCmd);

  const comment = task.command('comment').description('Task comments');
  comment
    .command('list <projectId> <taskId>')
    .description('List comments on a task')
    .option('--json', 'Output as JSON')
    .action(listTaskComments);
  comment
    .command('add <projectId> <taskId>')
    .description('Add a comment to a task')
    .requiredOption('--title <title>', 'Comment text')
    .option('--json', 'Output as JSON')
    .action(addTaskComment);
  comment
    .command('delete <projectId> <taskId> <commentId>')
    .description('Delete a task comment')
    .action(deleteTaskComment);
}
