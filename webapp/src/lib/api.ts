import type {
  ApiToken,
  Countdown,
  Focus,
  Habit,
  HabitRecord,
  HabitYear,
  Me,
  Project,
  ProjectData,
  ProjectGroup,
  Tag,
  Task,
  TaskComment,
  TaskFilter,
} from './types';

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
  if (res.status === 401) throw new ApiError(401, 'Unauthorized');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// --- Session (/api) ---

export const api = {
  me: () => get<Me>('/api/me'),
  login: (email: string, password: string) => post<{ ok: true }>('/api/login', { email, password }),
  register: (email: string, password: string, invite?: string) =>
    post<{ ok: true }>('/api/register', { email, password, ...(invite ? { invite } : {}) }),
  logout: () => post<{ ok: true }>('/api/logout'),

  // --- Tokens (/api) ---
  listTokens: () => get<ApiToken[]>('/api/tokens'),
  createToken: (name: string) => post<{ token: string }>('/api/tokens', { name }),
  revokeToken: (id: string) => post<{ ok: true }>(`/api/tokens/${id}/revoke`),

  // --- Projects (/open/v1) ---
  listProjects: () => get<Project[]>('/open/v1/project'),
  createProject: (name: string, viewMode = 'list') =>
    post<Project>('/open/v1/project', { name, viewMode }),
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'viewMode' | 'groupId'>>) =>
    post<Project>(`/open/v1/project/${id}`, patch),
  deleteProject: (id: string) => del<void>(`/open/v1/project/${id}`),
  listGroups: () => get<ProjectGroup[]>('/open/v1/project/group'),
  createGroup: (name: string) => post<ProjectGroup>('/open/v1/project/group', { name }),
  deleteGroup: (id: string) => del<void>(`/open/v1/project/group/${id}`),
  projectData: (id: string) => get<ProjectData>(`/open/v1/project/${id}/data`),
  createColumn: (projectId: string, name: string) =>
    post<ProjectData['columns'][number]>(`/open/v1/project/${projectId}/column`, { name }),

  // --- Tasks (/open/v1) ---
  filterTasks: (query: Record<string, unknown> = {}) => post<Task[]>('/open/v1/task/filter', query),
  searchTasks: (keywords: string) => post<Task[]>('/open/v1/task/search', { keywords }),
  listCompleted: (query: Record<string, unknown> = {}) =>
    post<Task[]>('/open/v1/task/completed', query),
  listTrash: () => get<Task[]>('/open/v1/task/trash'),
  createTask: (input: Record<string, unknown>) => post<Task>('/open/v1/task', input),
  updateTask: (id: string, patch: Record<string, unknown>) => post<Task>(`/open/v1/task/${id}`, patch),
  completeTask: (projectId: string, taskId: string) =>
    post<void>(`/open/v1/project/${projectId}/task/${taskId}/complete`),
  deleteTask: (projectId: string, taskId: string) =>
    del<void>(`/open/v1/project/${projectId}/task/${taskId}`),
  restoreTask: (taskId: string) => post<Task>(`/open/v1/task/trash/${taskId}/restore`),
  purgeTask: (taskId: string) => del<void>(`/open/v1/task/trash/${taskId}`),

  // --- Comments ---
  listComments: (projectId: string, taskId: string) =>
    get<TaskComment[]>(`/open/v1/project/${projectId}/task/${taskId}/comments`),
  addComment: (projectId: string, taskId: string, title: string) =>
    post<TaskComment>(`/open/v1/project/${projectId}/task/${taskId}/comment`, { title }),

  // --- Tags ---
  listTags: () => get<Tag[]>('/open/v1/tag'),
  upsertTag: (name: string, label: string) => post<Tag>('/open/v1/tag', { name, label }),

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
  deleteHabit: (id: string) => post<Habit>(`/open/v1/habit/${id}`, { status: 2 }),
  checkin: (habitId: string, stamp: number, value: number, options: { goal?: number; status?: number } = {}) =>
    post<HabitYear>(`/open/v1/habit/${habitId}/checkin`, { stamp, value, ...options }),
  listCheckins: (habitIds: string[], from: number, to: number) =>
    get<HabitYear[]>(
      `/open/v1/habit/checkins?habitIds=${habitIds.join(',')}&from=${from}&to=${to}`,
    ),
  listHabitRecords: (habitId: string, from: number, to: number) =>
    get<HabitRecord[]>(`/open/v1/habit/${habitId}/records?from=${from}&to=${to}`),
  addHabitRecord: (habitId: string, stamp: number, content: string, emoji: number) =>
    post<HabitRecord>(`/open/v1/habit/${habitId}/record`, { stamp, content, emoji }),

  // --- Focus ---
  listFocus: (from: string, to: string, type = 0) =>
    get<Focus[]>(`/open/v1/focus?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=${type}`),
  addFocus: (input: Record<string, unknown>) => post<Focus>('/open/v1/focus', input),

  // --- Countdowns ---
  listCountdowns: () => get<Countdown[]>('/open/v1/countdown'),
  createCountdown: (input: Omit<Countdown, 'id' | 'sortOrder'> & { sortOrder?: number }) =>
    post<Countdown>('/open/v1/countdown', input),
  updateCountdown: (id: string, patch: Partial<Omit<Countdown, 'id'>>) =>
    post<Countdown>(`/open/v1/countdown/${id}`, patch),
  deleteCountdown: (id: string) => del<void>(`/open/v1/countdown/${id}`),
};

/** Checkin range covering the whole year of `stamp`. */
export const yearRange = (stamp: number): [number, number] => {
  const year = Math.floor(stamp / 10000);
  return [year * 10000 + 101, year * 10000 + 1231];
};
