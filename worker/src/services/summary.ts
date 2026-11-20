/**
 * Summary page settings (NodeTick extension). The summary itself is built in
 * the web app from the user's tasks; the server keeps the settings, the named
 * templates and the one edited draft, so they follow the user across devices.
 * Keep the value lists in step with webapp/src/lib/summary.ts.
 */

export const SUMMARY_RANGES = [
  'today', 'tomorrow', 'yesterday',
  'thisWeek', 'nextWeek', 'lastWeek',
  'thisMonth', 'lastMonth',
  'thisYear', 'lastYear',
  'custom',
] as const;
export const SUMMARY_STATUSES = ['completed', 'wontDo', 'inProgress', 'open'] as const;
export const SUMMARY_GROUPS = ['status', 'list', 'completedTime', 'taskTime', 'tag', 'priority'] as const;
/** In the order they appear on a line. `title` is always on. */
export const SUMMARY_FIELDS = ['status', 'progress', 'completedTime', 'taskTime', 'title', 'parent', 'tags', 'focus', 'list', 'detail'] as const;
export const SUMMARY_PRIORITIES = [0, 1, 3, 5] as const;

export type SummaryRange = (typeof SUMMARY_RANGES)[number];
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];
export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];
export type SummaryField = (typeof SUMMARY_FIELDS)[number];

export interface SummaryConfig {
  range: SummaryRange;
  /** YYYY-MM-DD, inclusive; set only for the custom range. */
  from: string | null;
  to: string | null;
  /** Empty means every list (and likewise for the other filters). */
  projectIds: string[];
  statuses: SummaryStatus[];
  priorities: number[];
  tags: string[];
  groupBy: SummaryGroup;
  fields: SummaryField[];
  /** Append the next period's tasks under their own heading. */
  nextPeriod: boolean;
}

export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  range: 'thisWeek',
  from: null,
  to: null,
  projectIds: [],
  statuses: [],
  priorities: [],
  tags: [],
  groupBy: 'status',
  fields: ['progress', 'completedTime', 'title'],
  nextPeriod: false,
};

export const MAX_SUMMARY_TEMPLATES = 100;
export const MAX_SUMMARY_TEMPLATE_NAME = 64;
/** Characters of edited Markdown kept for the draft. */
export const MAX_SUMMARY_DRAFT = 200_000;
export const MAX_SUMMARY_DRAFT_KEY = 2048;
const MAX_FILTER_VALUES = 100;
const MAX_FILTER_VALUE_LENGTH = 128;
/** Longest custom range: ten years of days. */
const MAX_RANGE_DAYS = 3660;

function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function stringList(value: unknown, name: string): { value: string[] } | { error: string } {
  if (value == null) return { value: [] };
  if (
    !Array.isArray(value) ||
    value.length > MAX_FILTER_VALUES ||
    value.some((item) => typeof item !== 'string' || !item || item.length > MAX_FILTER_VALUE_LENGTH)
  ) {
    return { error: `${name} must be an array of at most ${MAX_FILTER_VALUES} non-empty strings (max ${MAX_FILTER_VALUE_LENGTH} chars)` };
  }
  return { value: [...new Set(value as string[])] };
}

function enumList<T extends string | number>(value: unknown, allowed: readonly T[], name: string): { value: T[] } | { error: string } {
  if (value == null) return { value: [] };
  if (!Array.isArray(value) || value.some((item) => !allowed.includes(item as T))) {
    return { error: `${name} must be an array of ${allowed.join(', ')}` };
  }
  // Canonical order, no repeats: two equal configs compare equal.
  return { value: allowed.filter((item) => value.includes(item)) };
}

/**
 * Validate a summary configuration from a request. Missing keys take their
 * defaults and unknown keys are dropped; anything malformed is an error.
 */
export function normalizeSummaryConfig(raw: unknown): { value: SummaryConfig } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'config must be an object' };
  const b = raw as Record<string, unknown>;

  const range = b.range ?? DEFAULT_SUMMARY_CONFIG.range;
  if (!SUMMARY_RANGES.includes(range as SummaryRange)) return { error: `range must be one of ${SUMMARY_RANGES.join(', ')}` };
  let from: string | null = null;
  let to: string | null = null;
  if (range === 'custom') {
    if (!validDay(b.from) || !validDay(b.to)) return { error: 'a custom range needs from and to dates (YYYY-MM-DD)' };
    if (b.to < b.from) return { error: 'to must not precede from' };
    const days = (Date.parse(`${b.to}T00:00:00Z`) - Date.parse(`${b.from}T00:00:00Z`)) / 86_400_000;
    if (days >= MAX_RANGE_DAYS) return { error: `a custom range spans at most ${MAX_RANGE_DAYS} days` };
    from = b.from;
    to = b.to;
  }

  const projectIds = stringList(b.projectIds, 'projectIds');
  if ('error' in projectIds) return projectIds;
  const tags = stringList(b.tags, 'tags');
  if ('error' in tags) return tags;
  const statuses = enumList(b.statuses, SUMMARY_STATUSES, 'statuses');
  if ('error' in statuses) return statuses;
  const priorities = enumList(b.priorities, SUMMARY_PRIORITIES, 'priorities');
  if ('error' in priorities) return priorities;

  const groupBy = b.groupBy ?? DEFAULT_SUMMARY_CONFIG.groupBy;
  if (!SUMMARY_GROUPS.includes(groupBy as SummaryGroup)) return { error: `groupBy must be one of ${SUMMARY_GROUPS.join(', ')}` };

  const fields = enumList(b.fields ?? DEFAULT_SUMMARY_CONFIG.fields, SUMMARY_FIELDS, 'fields');
  if ('error' in fields) return fields;
  if (!fields.value.includes('title')) fields.value = SUMMARY_FIELDS.filter((field) => field === 'title' || fields.value.includes(field));

  if (b.nextPeriod != null && typeof b.nextPeriod !== 'boolean') return { error: 'nextPeriod must be a boolean' };

  return {
    value: {
      range: range as SummaryRange,
      from,
      to,
      projectIds: projectIds.value,
      statuses: statuses.value,
      priorities: priorities.value,
      tags: tags.value,
      groupBy: groupBy as SummaryGroup,
      fields: fields.value,
      nextPeriod: b.nextPeriod === true,
    },
  };
}

/** A stored configuration; a damaged one reads as the default rather than failing the request. */
export function readStoredConfig(json: unknown): SummaryConfig {
  try {
    const result = normalizeSummaryConfig(JSON.parse(String(json ?? '')));
    return 'value' in result ? result.value : { ...DEFAULT_SUMMARY_CONFIG };
  } catch {
    return { ...DEFAULT_SUMMARY_CONFIG };
  }
}

export function serializeSummaryTemplate(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    config: readStoredConfig(row.config_json),
    sortOrder: Number(row.sort_order ?? 0),
    createdTime: row.created_at == null ? null : String(row.created_at),
    modifiedTime: row.modified_at == null ? null : String(row.modified_at),
  };
}
