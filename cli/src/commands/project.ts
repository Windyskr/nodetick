import chalk from 'chalk';
import { getApi } from '../lib/api.js';
import { numberOption } from '../lib/options.js';
import {
  formatColumnRow,
  formatJson,
  formatProjectGroupRow,
  formatProjectRow,
  formatProjectView,
} from '../lib/output.js';

type Options = Record<string, string | boolean | undefined>;
type Command = import('commander').Command;

async function listProjects(options: { json?: boolean }) {
  const api = await getApi();
  const projects = await api.getProjects();
  if (options.json) {
    console.log(formatJson(projects));
    return;
  }
  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }
  for (const project of projects) {
    console.log(formatProjectRow(project));
  }
}

async function getProject(projectId: string, options: { json?: boolean }) {
  const api = await getApi();
  const project = await api.getProject(projectId);
  if (options.json) {
    console.log(formatJson(project));
    return;
  }
  console.log(chalk.bold(String(project.name)));
  console.log('');
  console.log(`ID:        ${project.id}`);
  if (project.color) console.log(`Color:     ${project.color}`);
  if (project.viewMode) console.log(`View:      ${project.viewMode}`);
  if (project.kind) console.log(`Kind:      ${project.kind}`);
  if (project.groupId) console.log(`Group:     ${project.groupId}`);
  console.log(`Closed:    ${project.closed ? 'Yes' : 'No'}`);
}

async function getProjectData(projectId: string, options: { json?: boolean }) {
  const api = await getApi();
  const data = await api.getProjectWithData(projectId);
  if (options.json) {
    console.log(formatJson(data));
    return;
  }
  console.log(formatProjectView(data));
}

function projectFields(options: Options) {
  return {
    name: options.name,
    color: options.color,
    sortOrder: numberOption('--sort-order', options.sortOrder, { integer: true }),
    viewMode: options.viewMode,
    kind: options.kind,
  };
}

async function createProject(options: Options & { json?: boolean }) {
  const api = await getApi();
  const project = await api.createProject(projectFields(options));
  if (options.json) {
    console.log(formatJson(project));
    return;
  }
  console.log(`${chalk.green('Created:')} ${project.name}`);
  console.log(chalk.dim(`ID: ${project.id}`));
}

async function updateProject(projectId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const project = await api.updateProject(projectId, projectFields(options));
  if (options.json) {
    console.log(formatJson(project));
    return;
  }
  console.log(`${chalk.green('Updated:')} ${project.name}`);
}

async function deleteProject(projectId: string) {
  const api = await getApi();
  await api.deleteProject(projectId);
  console.log(chalk.green('Project deleted'));
}

async function listProjectGroups(options: { json?: boolean }) {
  const api = await getApi();
  const groups = await api.getProjectGroups();
  if (options.json) {
    console.log(formatJson(groups));
    return;
  }
  if (groups.length === 0) {
    console.log('No project groups found.');
    return;
  }
  for (const group of groups) {
    console.log(formatProjectGroupRow(group));
  }
}

async function createProjectGroup(options: Options & { json?: boolean }) {
  const api = await getApi();
  const group = await api.createProjectGroup({ name: options.name });
  if (options.json) {
    console.log(formatJson(group));
    return;
  }
  console.log(`${chalk.green('Created group:')} ${group.name}`);
  console.log(chalk.dim(`ID: ${group.id}`));
}

async function updateProjectGroup(groupId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const group = await api.updateProjectGroup(groupId, { name: options.name });
  if (options.json) {
    console.log(formatJson(group));
    return;
  }
  console.log(`${chalk.green('Updated group:')} ${group.name}`);
}

async function deleteProjectGroup(groupId: string) {
  const api = await getApi();
  await api.deleteProjectGroup(groupId);
  console.log(chalk.green('Project group deleted'));
}

async function listColumns(projectId: string, options: { json?: boolean }) {
  const api = await getApi();
  const columns = await api.getColumns(projectId);
  if (options.json) {
    console.log(formatJson(columns));
    return;
  }
  if (columns.length === 0) {
    console.log('No columns found.');
    return;
  }
  for (const column of columns) {
    console.log(formatColumnRow(column));
  }
}

async function createColumn(projectId: string, options: Options & { json?: boolean }) {
  const api = await getApi();
  const column = await api.createColumn(projectId, { name: options.name });
  if (options.json) {
    console.log(formatJson(column));
    return;
  }
  console.log(`${chalk.green('Created column:')} ${column.name}`);
  console.log(chalk.dim(`ID: ${column.id}`));
}

async function updateColumn(
  projectId: string,
  columnId: string,
  options: Options & { json?: boolean },
) {
  const api = await getApi();
  const column = await api.updateColumn(projectId, columnId, { name: options.name });
  if (options.json) {
    console.log(formatJson(column));
    return;
  }
  console.log(`${chalk.green('Updated column:')} ${column.name}`);
}

export function registerProjectCommand(program: Command) {
  const project = program.command('project').description('List and manage projects');

  project
    .command('list')
    .description('List projects')
    .option('--json', 'Output as JSON')
    .action(listProjects);

  project
    .command('get <projectId>')
    .description('Fetch project by ID')
    .option('--json', 'Output as JSON')
    .action(getProject);

  project
    .command('data <projectId>')
    .description('Fetch project with tasks and columns')
    .option('--json', 'Output as JSON')
    .action(getProjectData);

  project
    .command('create')
    .description('Create a project')
    .requiredOption('--name <name>', 'Project name')
    .option('--color <color>', 'Project color (e.g. "#F18181")')
    .option('--sort-order <n>', 'Sort order')
    .option('--view-mode <mode>', 'View mode: list, kanban, timeline')
    .option('--kind <kind>', 'Project kind: TASK, NOTE')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await createProject(options);
    });

  project
    .command('update <projectId>')
    .description('Update project fields')
    .option('--name <name>', 'Project name')
    .option('--color <color>', 'Project color')
    .option('--sort-order <n>', 'Sort order')
    .option('--view-mode <mode>', 'View mode: list, kanban, timeline')
    .option('--kind <kind>', 'Project kind: TASK, NOTE')
    .option('--json', 'Output as JSON')
    .action(updateProject);

  project
    .command('delete <projectId>')
    .description('Delete a project')
    .action(deleteProject);

  const group = project.command('group').description('Project groups (folders)');
  group
    .command('list')
    .description('List project groups')
    .option('--json', 'Output as JSON')
    .action(listProjectGroups);
  group
    .command('create')
    .description('Create a project group')
    .requiredOption('--name <name>', 'Group name (max 64 chars)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await createProjectGroup(options);
    });
  group
    .command('update <groupId>')
    .description('Update a project group')
    .option('--name <name>', 'Group name')
    .option('--json', 'Output as JSON')
    .action(updateProjectGroup);
  group
    .command('delete <groupId>')
    .description('Delete a project group')
    .action(deleteProjectGroup);

  const column = project.command('column').description('Kanban columns');
  column
    .command('list <projectId>')
    .description('List columns in a project')
    .option('--json', 'Output as JSON')
    .action(listColumns);
  column
    .command('create <projectId>')
    .description('Create a column')
    .requiredOption('--name <name>', 'Column name')
    .option('--json', 'Output as JSON')
    .action(createColumn);
  column
    .command('update <projectId> <columnId>')
    .description('Update a column')
    .option('--name <name>', 'Column name')
    .option('--json', 'Output as JSON')
    .action(updateColumn);
}
