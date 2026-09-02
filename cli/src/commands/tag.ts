import chalk from 'chalk';
import { getApi } from '../lib/api.js';
import { formatJson, formatTagRow } from '../lib/output.js';

type Command = import('commander').Command;

async function listTags(options: { json?: boolean }) {
  const api = await getApi();
  const tags = await api.getTags();
  if (options.json) {
    console.log(formatJson(tags));
    return;
  }
  if (tags.length === 0) {
    console.log('No tags found.');
    return;
  }
  for (const tag of tags) {
    console.log(formatTagRow(tag));
  }
}

async function createTag(options: { name: string; label: string; json?: boolean }) {
  const api = await getApi();
  const tag = await api.createTag({ name: options.name, label: options.label });
  if (options.json) {
    console.log(formatJson(tag));
    return;
  }
  console.log(`${chalk.green('Created tag:')} ${tag.label}`);
}

export function registerTagCommand(program: Command) {
  const tag = program.command('tag').description('List and create tags');
  tag
    .command('list')
    .description('List all tags')
    .option('--json', 'Output as JSON')
    .action(listTags);
  tag
    .command('create')
    .description('Create a tag')
    .requiredOption('--name <name>', 'Tag name (lowercase, max 64 chars)')
    .requiredOption('--label <label>', 'Tag label (max 64 chars)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await createTag(options);
    });
}
