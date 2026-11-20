import type {
  AdminUser,
  ApiToken,
  Countdown,
  Focus,
  FocusHistoryPage,
  FocusStats,
  Habit,
  HabitCheckinEntry,
  HabitEntryResult,
  HabitRecord,
  HabitYear,
  Me,
  NotificationConfig,
  NotificationSettings,
  Project,
  ProjectData,
  ProjectGroup,
  Tag,
  Task,
  TaskComment,
  TaskFilter,
} from './types';
import type { MsDeviceCode, MsImportChunk, MsImportChunkResult, MsTokenPoll } from './msTodo';
import type { TickTickChunk, TickTickChunkResult } from './ticktick';
import type { SummaryConfig, SummaryState, SummaryTemplate } from './summary';

/** Writable countdown fields (the server fills id, archivedTime and createdTime). */
export type CountdownInput = Omit<Countdown, 'id' | 'archivedTime' | 'createdTime'>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    // Keep the server's message for 401s too: a failed login answers 401
    // "Invalid email or password.", which the login form maps to its locale.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const fallback = res.status === 401 ? 'Unauthorized' : `Request failed (${res.status})`;
    throw new ApiError(res.status, body?.error ?? fallback);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Priorities follow TickTick (0 none, 1 low, 3 medium, 5 high). Web builds
 * before that stored medium as 2, so read a stray 2 as medium.
 */
const fromApi = <T extends Task | null>(task: T): T =>
  (task && task.priority === 2 ? { ...task, priority: 3 } : task);
const fromApiList = (tasks: Task[]) => tasks.map(fromApi);

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// --- Session (/api) ---

export const api = {
  me: () => get<Me>('/api/me'),
  login: (email: string, password: string) => post<{ ok: true }>('/api/login', { email, password }),
  register: (email: string, password: string) =>
    post<{ ok: true }>('/api/register', { email, password }),
  logout: () => post<{ ok: true }>('/api/logout'),
  registrationOpen: () => get<{ open: boolean }>('/api/register/status'),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/api/password', { currentPassword, newPassword }),

  // --- Admin user management (/api) ---
  adminListUsers: () => get<AdminUser[]>('/api/admin/users'),
  adminCreateUser: (email: string, password: string, admin: boolean) =>
    post<{ id: string; email: string; isAdmin: boolean }>('/api/admin/users', { email, password, admin }),
  adminResetPassword: (id: string, password: string) =>
    post<{ ok: true }>(`/api/admin/users/${id}/password`, { password }),
  adminDeleteUser: (id: string) => del<{ ok: true }>(`/api/admin/users/${id}`),

  // --- Tokens (/api) ---
  listTokens: () => get<ApiToken[]>('/api/tokens'),
  createToken: (name: string) => post<{ token: string }>('/api/tokens', { name }),
  revokeToken: (id: string) => post<{ ok: true }>(`/api/tokens/${id}/revoke`),

  // --- Calendar subscription feed (/api) ---
  getFeedToken: () => get<{ token: string }>('/api/feed'),
  regenerateFeed: () => post<{ token: string }>('/api/feed/regenerate', {}),

  // --- Microsoft To Do import (/api) ---
  msTodoConfig: () => get<{ configured: boolean }>('/api/import/microsoft/config'),
  msTodoDeviceCode: () => post<MsDeviceCode>('/api/import/microsoft/device', {}),
  msTodoPollToken: (deviceCode: string) => post<MsTokenPoll>('/api/import/microsoft/token', { deviceCode }),
  msTodoImport: (chunk: MsImportChunk) => post<MsImportChunkResult>('/api/import/microsoft/tasks', chunk),

  // --- TickTick backup import (/api) ---
  ticktickImport: (chunk: TickTickChunk) => post<TickTickChunkResult>('/api/import/ticktick/tasks', chunk),

  // --- Browser notifications ---
  notificationConfig: () => get<NotificationConfig>('/open/v1/notification/config'),
  updateNotificationSettings: (settings: NotificationSettings) =>
    request<{ ok: true }>('/open/v1/notification/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  subscribeNotifications: (subscription: { endpoint: string; keys: { p256dh: string; auth: string }; lang?: 'zh' | 'en' }) =>
    post<{ ok: true }>('/open/v1/notification/subscribe', subscription),
  unsubscribeNotifications: (endpoint: string) =>
    request<{ ok: true }>('/open/v1/notification/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  testNotification: () => post<{ sent: number; failed: number }>('/open/v1/notification/test'),

  // --- Projects (/open/v1) ---
  listProjects: () => get<Project[]>('/open/v1/project'),
  createProject: (name: string, viewMode = 'list') =>
    post<Project>('/open/v1/project', { name, viewMode }),
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'viewMode' | 'groupId' | 'color' | 'sortOrder' | 'closed'>>) =>
    post<Project>(`/open/v1/project/${id}`, patch),
  deleteProject: (id: string) => del<void>(`/open/v1/project/${id}`),
  listGroups: () => get<ProjectGroup[]>('/open/v1/project/group'),
  createGroup: (name: string) => post<ProjectGroup>('/open/v1/project/group', { name }),
  updateGroup: (id: string, patch: { name?: string; sortOrder?: number }) =>
    post<ProjectGroup>(`/open/v1/project/group/${id}`, patch),
  deleteGroup: (id: string) => del<void>(`/open/v1/project/group/${id}`),
  projectData: (id: string) => get<ProjectData>(`/open/v1/project/${id}/data`),
  createColumn: (projectId: string, name: string) =>
    post<ProjectData['columns'][number]>(`/open/v1/project/${projectId}/column`, { name }),
  updateColumn: (projectId: string, columnId: string, patch: { name?: string; sortOrder?: number }) =>
    post<ProjectData['columns'][number]>(`/open/v1/project/${projectId}/column/${columnId}`, patch),
  deleteColumn: (projectId: string, columnId: string) =>
    del<void>(`/open/v1/project/${projectId}/column/${columnId}`),

  // --- Tasks (/open/v1) ---
  filterTasks: (query: Record<string, unknown> = {}) => post<Task[]>('/open/v1/task/filter', query).then(fromApiList),
  searchTasks: (keywords: string) => post<Task[]>('/open/v1/task/search', { keywords }).then(fromApiList),
  listCompleted: (query: Record<string, unknown> = {}) =>
    post<Task[]>('/open/v1/task/completed', query).then(fromApiList),
  listTrash: () => get<Task[]>('/open/v1/task/trash').then(fromApiList),
  createTask: (input: Record<string, unknown>) => post<Task>('/open/v1/task', input).then(fromApi),
  updateTask: (id: string, patch: Record<string, unknown>) => post<Task>(`/open/v1/task/${id}`, patch).then(fromApi),
  completeTask: (projectId: string, taskId: string) =>
    post<Task | null>(`/open/v1/project/${projectId}/task/${taskId}/complete`).then(fromApi),
  deleteTask: (projectId: string, taskId: string) =>
    del<void>(`/open/v1/project/${projectId}/task/${taskId}`),
  restoreTask: (taskId: string) => post<Task>(`/open/v1/task/trash/${taskId}/restore`).then(fromApi),
  purgeTask: (taskId: string) => del<void>(`/open/v1/task/trash/${taskId}`),

  // --- Comments ---
  listComments: (projectId: string, taskId: string) =>
    get<TaskComment[]>(`/open/v1/project/${projectId}/task/${taskId}/comments`),
  addComment: (projectId: string, taskId: string, title: string) =>
    post<TaskComment>(`/open/v1/project/${projectId}/task/${taskId}/comment`, { title }),

  // --- Tags ---
  listTags: () => get<Tag[]>('/open/v1/tag'),
  upsertTag: (name: string, label: string) => post<Tag>('/open/v1/tag', { name, label }),
  updateTag: (oldName: string, patch: { name?: string; label?: string; color?: string | null; parentId?: string | null }) =>
    post<Tag>(`/open/v1/tag/${encodeURIComponent(oldName)}`, patch),
  deleteTag: (name: string) => del<void>(`/open/v1/tag/${encodeURIComponent(name)}`),

  // --- Saved filters / smart lists ---
  listFilters: () => get<TaskFilter[]>('/open/v1/filter'),
  createFilter: (input: Omit<TaskFilter, 'id' | 'sortOrder' | 'createdTime' | 'modifiedTime'> & { sortOrder?: number }) =>
    post<TaskFilter>('/open/v1/filter', input),
  updateFilter: (id: string, patch: Partial<TaskFilter>) => post<TaskFilter>(`/open/v1/filter/${id}`, patch),
  deleteFilter: (id: string) => del<void>(`/open/v1/filter/${id}`),

  // --- Habits ---
  listHabits: () => get<Habit[]>('/open/v1/habit'),
  createHabit: (input: Record<string, unknown>) => post<Habit>('/open/v1/habit', input),
  updateHabit: (id: string, patch: Record<string, unknown>) => post<Habit>(`/open/v1/habit/${id}`, patch),
  /** Archive is status 1 (TickTick), restore is 0; delete removes the habit with its check-ins and logs. */
  setHabitStatus: (id: string, status: number) => post<Habit>(`/open/v1/habit/${id}`, { status }),
  deleteHabit: (id: string) => del<void>(`/open/v1/habit/${id}`),
  checkin: (habitId: string, stamp: number, value: number, options: { goal?: number; status?: number } = {}) =>
    post<HabitYear>(`/open/v1/habit/${habitId}/checkin`, { stamp, value, ...options }),
  listCheckins: (habitIds: string[], from: number, to: number) =>
    get<HabitYear[]>(
      `/open/v1/habit/checkins?habitIds=${habitIds.join(',')}&from=${from}&to=${to}`,
    ),
  addCheckinEntry: (habitId: string, stamp: number, value: number, options: { time?: string; goal?: number } = {}) =>
    post<HabitEntryResult>(`/open/v1/habit/${habitId}/checkin/entry`, { stamp, value, ...options }),
  updateCheckinEntry: (habitId: string, entryId: string, patch: { value?: number; time?: string }) =>
    post<HabitEntryResult>(`/open/v1/habit/${habitId}/checkin/entry/${entryId}`, patch),
  deleteCheckinEntry: (habitId: string, entryId: string) =>
    del<HabitEntryResult>(`/open/v1/habit/${habitId}/checkin/entry/${entryId}`),
  listCheckinEntries: (habitId: string, from: number, to: number) =>
    get<HabitCheckinEntry[]>(`/open/v1/habit/${habitId}/checkin/entries?from=${from}&to=${to}`),
  listHabitRecords: (habitId: string, from: number, to: number) =>
    get<HabitRecord[]>(`/open/v1/habit/${habitId}/records?from=${from}&to=${to}`),
  addHabitRecord: (habitId: string, stamp: number, content: string, emoji: number) =>
    post<HabitRecord>(`/open/v1/habit/${habitId}/record`, { stamp, content, emoji }),
  deleteHabitRecord: (habitId: string, stamp: number) => del<void>(`/open/v1/habit/${habitId}/record/${stamp}`),

  // --- Focus ---
  listFocus: (from: string, to: string, type = 0) =>
    get<Focus[]>(`/open/v1/focus?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=${type}`),
  addFocus: (input: Record<string, unknown>) => post<Focus>('/open/v1/focus', input),
  updateFocus: (id: string, patch: Record<string, unknown>) => post<Focus>(`/open/v1/focus/${encodeURIComponent(id)}`, patch),
  deleteFocus: (id: string, type: number) => del<Focus>(`/open/v1/focus/${encodeURIComponent(id)}?type=${type}`),
  /** All-time totals, plus the from–to period (local days in `tz`) when given. */
  focusStats: (query: { tz: string; from?: string; to?: string; taskId?: string }) =>
    get<FocusStats>(`/open/v1/focus/stats?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => !!entry[1]))}`),
  focusHistory: (before: string | null, limit = 50) =>
    get<FocusHistoryPage>(`/open/v1/focus/history?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),

  // --- Countdowns ---
  listCountdowns: () => get<Countdown[]>('/open/v1/countdown'),
  createCountdown: (input: CountdownInput) => post<Countdown>('/open/v1/countdown', input),
  updateCountdown: (id: string, patch: Partial<CountdownInput>) =>
    post<Countdown>(`/open/v1/countdown/${id}`, patch),
  deleteCountdown: (id: string) => del<void>(`/open/v1/countdown/${id}`),

  // --- Summary page (NodeTick extension) ---
  summaryState: () => get<SummaryState>('/open/v1/summary/state'),
  /** Save any of config, draft and draftKey; `draft: null` drops the edited text. */
  saveSummaryState: (patch: Partial<Pick<SummaryState, 'config' | 'draft' | 'draftKey'>>) =>
    post<SummaryState>('/open/v1/summary/state', patch),
  listSummaryTemplates: () => get<SummaryTemplate[]>('/open/v1/summary/template'),
  createSummaryTemplate: (input: { name: string; config: SummaryConfig }) =>
    post<SummaryTemplate>('/open/v1/summary/template', input),
  updateSummaryTemplate: (id: string, patch: { name?: string; config?: SummaryConfig }) =>
    post<SummaryTemplate>(`/open/v1/summary/template/${encodeURIComponent(id)}`, patch),
  deleteSummaryTemplate: (id: string) => del<void>(`/open/v1/summary/template/${encodeURIComponent(id)}`),
};

/** Checkin range covering the whole year of `stamp`. */
export const yearRange = (stamp: number): [number, number] => {
  const year = Math.floor(stamp / 10000);
  return [year * 10000 + 101, year * 10000 + 1231];
};
