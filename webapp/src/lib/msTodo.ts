/**
 * Microsoft To Do import, browser side: read lists and tasks from Microsoft
 * Graph with the token from the worker's device code relay, then post them to
 * the worker in chunks (POST /api/import/microsoft/tasks maps and stores them).
 */

export const GRAPH_ROOT = 'https://graph.microsoft.com/';
const GRAPH = `${GRAPH_ROOT}v1.0`;

export interface MsTodoList {
  id: string;
  displayName: string;
  wellknownListName: string;
  isShared: boolean;
}

export type MsTodoTask = Record<string, unknown> & { id: string };

export interface MsImportChunk {
  list: Pick<MsTodoList, 'id' | 'displayName' | 'wellknownListName'>;
  tasks: MsTodoTask[];
  timeZone: string;
}

export interface MsImportChunkResult {
  projectId: string;
  created: number;
  skipped: number;
  invalid: number;
  attachments: number;
}

/** POST /api/import/microsoft/device */
export interface MsDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** POST /api/import/microsoft/token */
export type MsTokenPoll =
  | { status: 'ok'; accessToken: string; expiresIn: number }
  | { status: 'pending' | 'slow_down' | 'declined' | 'expired' };

export class GraphError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface GraphOptions {
  token: string;
  signal?: AbortSignal;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

type Json = Record<string, unknown>;

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 5;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/** GET a Graph URL, waiting out throttling (429 + Retry-After) and transient errors. */
async function graphGet(url: string, opts: GraphOptions): Promise<Json> {
  // nextLink URLs come from the response; never send the token elsewhere.
  if (!url.startsWith(GRAPH_ROOT)) throw new GraphError(0, `Unexpected Microsoft Graph link: ${url}`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? delay;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${opts.token}` }, signal: opts.signal });
    if (res.ok) return (await res.json()) as Json;
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      await sleep(retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** attempt, opts.signal);
      continue;
    }
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new GraphError(res.status, body?.error?.message || `Microsoft Graph request failed (${res.status})`);
  }
}

/** Follow @odata.nextLink through every page of a collection. */
async function* pages(url: string, opts: GraphOptions): AsyncGenerator<Json[]> {
  let next: string | null = url;
  while (next) {
    const page = await graphGet(next, opts);
    yield Array.isArray(page.value) ? (page.value as Json[]) : [];
    next = typeof page['@odata.nextLink'] === 'string' ? page['@odata.nextLink'] : null;
  }
}

export async function listTodoLists(opts: GraphOptions): Promise<MsTodoList[]> {
  const lists: MsTodoList[] = [];
  for await (const page of pages(`${GRAPH}/me/todo/lists`, opts)) {
    for (const list of page) {
      if (typeof list.id !== 'string' || !list.id) continue;
      lists.push({
        id: list.id,
        displayName: typeof list.displayName === 'string' ? list.displayName : '',
        wellknownListName: typeof list.wellknownListName === 'string' ? list.wellknownListName : 'none',
        isShared: list.isShared === true,
      });
    }
  }
  return lists;
}

/**
 * Ways to ask for a list's tasks, most efficient first. Graph documents
 * $expand on single tasks only, so when the collection rejects a variant
 * (400) the next one is tried and remembered for the remaining lists.
 */
const TASK_QUERIES: { query: string; completedFilter: boolean }[] = [
  { query: '$top=100&$expand=checklistItems,linkedResources', completedFilter: true },
  { query: '$expand=checklistItems', completedFilter: false },
];

export interface TaskQueryState {
  variant: number;
}

/** Every task of one list, a Graph page at a time. */
export async function* todoTaskPages(
  listId: string,
  includeCompleted: boolean,
  opts: GraphOptions,
  state: TaskQueryState = { variant: 0 },
): AsyncGenerator<MsTodoTask[]> {
  const base = `${GRAPH}/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
  for (;;) {
    const variant = TASK_QUERIES[state.variant];
    const filter = !includeCompleted && variant.completedFilter
      ? `&$filter=${encodeURIComponent("status ne 'completed'")}`
      : '';
    let first = true;
    try {
      for await (const page of pages(`${base}?${variant.query}${filter}`, opts)) {
        first = false;
        yield page.filter((task): task is MsTodoTask =>
          typeof task.id === 'string' && (includeCompleted || task.status !== 'completed'));
      }
      return;
    } catch (error) {
      const rejected = error instanceof GraphError && error.status === 400;
      if (!first || !rejected || state.variant >= TASK_QUERIES.length - 1) throw error;
      state.variant++;
    }
  }
}

const TASK_FIELDS = [
  'id', 'title', 'importance', 'status', 'isReminderOn', 'reminderDateTime', 'dueDateTime', 'startDateTime',
  'completedDateTime', 'createdDateTime', 'lastModifiedDateTime', 'categories', 'recurrence', 'hasAttachments',
] as const;
/** Long notes are cut here (the worker keeps 64 KB of text) so one task cannot fill a request. */
const MAX_BODY_CHARS = 100_000;

const pick = (value: unknown, keys: readonly string[]): Json | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Json;
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
};

/** Only the fields the worker reads (drops @odata.etag and the like). */
export function slimTask(task: MsTodoTask): MsTodoTask {
  const out = pick(task, TASK_FIELDS) as MsTodoTask;
  const body = pick(task.body, ['contentType', 'content']);
  if (body) out.body = { ...body, content: typeof body.content === 'string' ? body.content.slice(0, MAX_BODY_CHARS) : '' };
  if (Array.isArray(task.checklistItems)) {
    out.checklistItems = task.checklistItems.map((item) => pick(item, ['displayName', 'isChecked', 'checkedDateTime'])).filter(Boolean);
  }
  if (Array.isArray(task.linkedResources)) {
    out.linkedResources = task.linkedResources.map((item) => pick(item, ['displayName', 'webUrl', 'applicationName'])).filter(Boolean);
  }
  return out;
}

const encoder = new TextEncoder();

/** Split tasks into request-sized chunks (the worker takes 1 MB and 200 tasks per request). */
export function chunkTasks(tasks: MsTodoTask[], maxCount = 100, maxBytes = 600_000): MsTodoTask[][] {
  const chunks: MsTodoTask[][] = [];
  let current: MsTodoTask[] = [];
  let bytes = 0;
  for (const task of tasks) {
    const size = encoder.encode(JSON.stringify(task)).length + 1;
    if (current.length && (current.length >= maxCount || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(task);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export interface MsImportProgress {
  list: MsTodoList;
  listIndex: number;
  listCount: number;
  /** Tasks of this list sent so far. */
  listTasks: number;
}

export interface MsImportTotals {
  lists: number;
  created: number;
  skipped: number;
  attachments: number;
}

export interface ImportListsOptions extends GraphOptions {
  includeCompleted: boolean;
  timeZone: string;
  send: (chunk: MsImportChunk) => Promise<MsImportChunkResult>;
  onProgress?: (progress: MsImportProgress, totals: MsImportTotals) => void;
}

/**
 * Import the chosen lists one after another. `totals` is updated in place, so
 * a caller that stops (aborts) midway still knows what was imported.
 */
export async function importTodoLists(
  lists: MsTodoList[],
  opts: ImportListsOptions,
  totals: MsImportTotals = { lists: 0, created: 0, skipped: 0, attachments: 0 },
): Promise<MsImportTotals> {
  const state: TaskQueryState = { variant: 0 };
  for (const [listIndex, list] of lists.entries()) {
    const target = { id: list.id, displayName: list.displayName, wellknownListName: list.wellknownListName };
    let listTasks = 0;
    const report = () => opts.onProgress?.({ list, listIndex, listCount: lists.length, listTasks }, totals);
    report();
    const send = async (tasks: MsTodoTask[]) => {
      opts.signal?.throwIfAborted();
      const result = await opts.send({ list: target, tasks, timeZone: opts.timeZone });
      listTasks += tasks.length;
      totals.created += result.created;
      totals.skipped += result.skipped;
      totals.attachments += result.attachments;
      report();
    };
    let sent = false;
    for await (const page of todoTaskPages(list.id, opts.includeCompleted, opts, state)) {
      for (const chunk of chunkTasks(page.map(slimTask))) {
        await send(chunk);
        sent = true;
      }
    }
    // An empty list still becomes an (empty) NodeTick list.
    if (!sent) await send([]);
    totals.lists++;
  }
  return totals;
}
