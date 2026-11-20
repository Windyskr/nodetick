import chalk from 'chalk';

const PRIORITY_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Low',
  3: 'Medium',
  5: 'High',
};

const STATUS_LABELS: Record<number, string> = {
  0: 'Open',
  2: 'Completed',
};

type Task = Record<string, unknown>;

function priorityColor(priority: number) {
  switch (priority) {
    case 5:
      return chalk.red;
    case 3:
      return chalk.yellow;
    case 1:
      return chalk.blue;
    default:
      return chalk.dim;
  }
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

export function formatTaskRow(task: Task): string {
  const priority = Number(task.priority ?? 0);
  const pColor = priorityColor(priority);
  const pLabel = PRIORITY_LABELS[priority] ?? String(priority);
  const status = task.status === 2 ? chalk.green('[done]') : '';
  const due = task.dueDate ? chalk.dim(` due:${task.dueDate}`) : '';
  return `  ${chalk.dim(str(task.id))} ${pColor(`[${pLabel}]`)} ${str(task.title)}${due} ${status}`.trimEnd();
}

export function formatTaskView(task: Task): string {
  const lines: string[] = [];
  lines.push(chalk.bold(str(task.title)));
  lines.push('');
  lines.push(`ID:        ${str(task.id)}`);
  lines.push(`Project:   ${str(task.projectId)}`);
  lines.push(`Priority:  ${PRIORITY_LABELS[Number(task.priority ?? 0)] ?? str(task.priority)}`);
  lines.push(`Status:    ${STATUS_LABELS[Number(task.status ?? 0)] ?? str(task.status)}`);
  if (task.content) lines.push(`Content:   ${str(task.content)}`);
  if (task.desc) lines.push(`Desc:      ${str(task.desc)}`);
  if (task.startDate) lines.push(`Start:     ${str(task.startDate)}`);
  if (task.dueDate) lines.push(`Due:       ${str(task.dueDate)}`);
  if (task.timeZone) lines.push(`Timezone:  ${str(task.timeZone)}`);
  if (task.repeatFlag) lines.push(`Repeat:    ${str(task.repeatFlag)}`);
  if (task.parentId) lines.push(`Parent:    ${str(task.parentId)}`);
  if (task.completedTime) lines.push(`Completed: ${str(task.completedTime)}`);
  if (task.kind) lines.push(`Kind:      ${str(task.kind)}`);
  const tags = task.tags as string[] | undefined;
  if (tags?.length) lines.push(`Tags:      ${tags.join(', ')}`);
  const reminders = task.reminders as string[] | undefined;
  if (reminders?.length) lines.push(`Reminders: ${reminders.join(', ')}`);
  const items = task.items as Record<string, unknown>[] | undefined;
  if (items?.length) {
    lines.push('');
    lines.push(chalk.dim(`--- Subtasks (${items.length}) ---`));
    for (const item of items) {
      const check = item.status === 1 ? chalk.green('[x]') : '[ ]';
      lines.push(`  ${check} ${str(item.title)}`);
    }
  }
  const focusSummaries = task.focusSummaries as Record<string, unknown>[] | undefined;
  if (focusSummaries?.length) {
    lines.push('');
    lines.push(chalk.dim(`--- Focus Summaries (${focusSummaries.length}) ---`));
    for (const [idx, s] of focusSummaries.entries()) {
      lines.push(`  #${idx + 1}`);
      if (s.estimatedDuration != null) lines.push(`    estimatedDuration: ${s.estimatedDuration}s`);
      if (s.estimatedPomo != null) lines.push(`    estimatedPomo: ${s.estimatedPomo} (max 60)`);
      if (s.pomoCount != null) lines.push(`    pomoCount: ${s.pomoCount}`);
      if (s.pomoDuration != null) lines.push(`    pomoDuration: ${s.pomoDuration}s`);
      if (s.stopwatchDuration != null) lines.push(`    stopwatchDuration: ${s.stopwatchDuration}s`);
    }
  }
  return lines.join('\n');
}

export function formatProjectRow(project: Task): string {
  const closed = project.closed ? chalk.dim(' [closed]') : '';
  const color = project.color ? chalk.dim(` ${str(project.color)}`) : '';
  return `  ${chalk.dim(str(project.id))} ${str(project.name)}${color}${closed}`;
}

export function formatProjectView(data: Task): string {
  const project = (data.project ?? {}) as Task;
  const tasks = (data.tasks ?? []) as Task[];
  const columns = (data.columns ?? []) as Task[];
  const lines: string[] = [];
  lines.push(chalk.bold(str(project.name)));
  lines.push('');
  lines.push(`ID:        ${str(project.id)}`);
  if (project.color) lines.push(`Color:     ${str(project.color)}`);
  if (project.viewMode) lines.push(`View:      ${str(project.viewMode)}`);
  if (project.kind) lines.push(`Kind:      ${str(project.kind)}`);
  if (project.groupId) lines.push(`Group:     ${str(project.groupId)}`);
  lines.push(`Closed:    ${project.closed ? 'Yes' : 'No'}`);
  if (columns.length > 0) {
    lines.push('');
    lines.push(chalk.dim(`--- Columns (${columns.length}) ---`));
    for (const col of columns) {
      lines.push(`  ${chalk.dim(str(col.id))} ${str(col.name)}`);
    }
  }
  if (tasks.length > 0) {
    lines.push('');
    lines.push(chalk.dim(`--- Tasks (${tasks.length}) ---`));
    for (const task of tasks) {
      lines.push(formatTaskRow(task));
    }
  }
  return lines.join('\n');
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

const FOCUS_TYPE_LABEL: Record<number, string> = {
  0: 'Pomodoro',
  1: 'Timing',
};

export function formatFocusRow(f: Task): string {
  const t = FOCUS_TYPE_LABEL[Number(f.type)] ?? String(f.type);
  const range = f.startTime && f.endTime ? chalk.dim(` ${str(f.startTime)} → ${str(f.endTime)}`) : '';
  const note = f.note ? chalk.dim(` — ${str(f.note)}`) : '';
  return `  ${chalk.dim(str(f.id))} [${t}]${range}${note}`.trimEnd();
}

export function formatFocusView(f: Task): string {
  const lines: string[] = [];
  const t = FOCUS_TYPE_LABEL[Number(f.type)] ?? String(f.type);
  lines.push(chalk.bold(str(f.id)));
  lines.push('');
  lines.push(`Type:      ${t} (${str(f.type)})`);
  if (f.taskId) lines.push(`Task:      ${str(f.taskId)}`);
  if (f.note) lines.push(`Note:      ${str(f.note)}`);
  if (f.startTime) lines.push(`Start:     ${str(f.startTime)}`);
  if (f.endTime) lines.push(`End:       ${str(f.endTime)}`);
  if (f.duration != null) lines.push(`Duration:  ${str(f.duration)}s`);
  if (f.pauseDuration != null) lines.push(`Paused:    ${str(f.pauseDuration)}s`);
  if (f.added) lines.push('Added:     manually');
  if (f.status != null) lines.push(`Status:    ${str(f.status)}`);
  if (f.etag) lines.push(`ETag:      ${str(f.etag)}`);
  return lines.join('\n');
}

export function formatHabitRow(h: Task): string {
  const goal = h.goal != null ? chalk.dim(` goal:${str(h.goal)}`) : '';
  return `  ${chalk.dim(str(h.id))} ${str(h.name)}${goal}`;
}

export function formatHabitView(h: Task): string {
  const lines: string[] = [];
  lines.push(chalk.bold(str(h.name)));
  lines.push('');
  lines.push(`ID:        ${str(h.id)}`);
  if (h.color) lines.push(`Color:     ${str(h.color)}`);
  if (h.iconRes) lines.push(`Icon:      ${str(h.iconRes)}`);
  if (h.repeatRule) lines.push(`Repeat:    ${str(h.repeatRule)}`);
  if (h.goal != null) lines.push(`Goal:      ${str(h.goal)}`);
  if (h.step != null) lines.push(`Step:      ${str(h.step)}`);
  if (h.unit) lines.push(`Unit:      ${str(h.unit)}`);
  if (h.status != null) lines.push(`Status:    ${str(h.status)}`);
  if (h.encouragement) lines.push(`Note:      ${str(h.encouragement)}`);
  if (h.etag) lines.push(`ETag:      ${str(h.etag)}`);
  return lines.join('\n');
}

export function formatCommentRow(c: Task): string {
  const time = c.createdTime ? chalk.dim(` ${str(c.createdTime)}`) : '';
  return `  ${chalk.dim(str(c.id))} ${str(c.title)}${time}`;
}

export function formatProjectGroupRow(g: Task): string {
  const mode = g.viewMode ? chalk.dim(` ${str(g.viewMode)}`) : '';
  return `  ${chalk.dim(str(g.id))} ${str(g.name)}${mode}`;
}

export function formatColumnRow(c: Task): string {
  return `  ${chalk.dim(str(c.id))} ${str(c.name)}`;
}

export function formatTagRow(t: Task): string {
  const color = t.color ? chalk.dim(` ${str(t.color)}`) : '';
  return `  ${str(t.label)}${color}`;
}

export function formatCountdownRow(c: Task): string {
  const date = c.date != null ? chalk.dim(` date:${str(c.date)}`) : '';
  const name = str(c.name) || str(c.id);
  const repeat = c.repeatFlag ? chalk.dim(` ${c.lunar ? 'lunar-' : ''}${str(c.repeatFlag)}`) : c.lunar ? chalk.dim(' lunar') : '';
  const kind = c.kind && c.kind !== 'countdown' ? chalk.dim(` ${str(c.kind)}`) : '';
  const flags = `${c.pinned ? chalk.yellow(' [pinned]') : ''}${c.archived ? chalk.dim(' [archived]') : ''}`;
  return `  ${chalk.dim(str(c.id))} ${name}${date}${kind}${repeat}${flags}`;
}
