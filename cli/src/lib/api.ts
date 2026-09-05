import { getAccessToken } from './auth.js';
import { getServerUrl } from './config.js';

/**
 * NodeTick Open API client. Mirrors the TickTick Open API v1 surface at
 * `{server}/open/v1/*`.
 */
export class NodeTickApi {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NodeTick API error ${response.status}: ${text}`);
    }
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return (await response.json()) as T;
    }
    return undefined as T;
  }

  // --- Task ---

  async getTask(projectId: string, taskId: string): Promise<Record<string, unknown>> {
    return this.request(`/project/${projectId}/task/${taskId}`);
  }

  async createTask(input: unknown): Promise<Record<string, unknown>> {
    return this.request('/task', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateTask(taskId: string, input: unknown): Promise<Record<string, unknown>> {
    return this.request(`/task/${taskId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async completeTask(projectId: string, taskId: string): Promise<void> {
    await this.request(`/project/${projectId}/task/${taskId}/complete`, {
      method: 'POST',
    });
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.request(`/project/${projectId}/task/${taskId}`, {
      method: 'DELETE',
    });
  }

  async moveTasks(moves: unknown[]): Promise<Record<string, unknown>[]> {
    return this.request('/task/move', {
      method: 'POST',
      body: JSON.stringify(moves),
    });
  }

  async getCompletedTasks(filter: unknown): Promise<Record<string, unknown>[]> {
    return this.request('/task/completed', {
      method: 'POST',
      body: JSON.stringify(filter),
    });
  }

  async filterTasks(filter: unknown): Promise<Record<string, unknown>[]> {
    return this.request('/task/filter', {
      method: 'POST',
      body: JSON.stringify(filter),
    });
  }

  async searchTasks(search: unknown): Promise<Record<string, unknown>[]> {
    return this.request('/task/search', {
      method: 'POST',
      body: JSON.stringify(search),
    });
  }

  async getTaskComments(projectId: string, taskId: string): Promise<Record<string, unknown>[]> {
    return this.request(`/project/${projectId}/task/${taskId}/comments`);
  }

  async addTaskComment(
    projectId: string,
    taskId: string,
    input: unknown,
  ): Promise<Record<string, unknown>> {
    return this.request(`/project/${projectId}/task/${taskId}/comment`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteTaskComment(projectId: string, taskId: string, commentId: string): Promise<void> {
    await this.request(`/project/${projectId}/task/${taskId}/comment/${commentId}`, {
      method: 'DELETE',
    });
  }

  // --- Project ---

  async getProjects(): Promise<Record<string, unknown>[]> {
    return this.request('/project');
  }

  async getProject(projectId: string): Promise<Record<string, unknown>> {
    return this.request(`/project/${projectId}`);
  }

  async getProjectWithData(projectId: string): Promise<Record<string, unknown>> {
    return this.request(`/project/${projectId}/data`);
  }

  async createProject(input: unknown): Promise<Record<string, unknown>> {
    return this.request('/project', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateProject(projectId: string, input: unknown): Promise<Record<string, unknown>> {
    return this.request(`/project/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request(`/project/${projectId}`, { method: 'DELETE' });
  }

  async getProjectGroups(): Promise<Record<string, unknown>[]> {
    return this.request('/project/group');
  }

  async createProjectGroup(input: unknown): Promise<Record<string, unknown>> {
    return this.request('/project/group', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateProjectGroup(groupId: string, input: unknown): Promise<Record<string, unknown>> {
    return this.request(`/project/group/${groupId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteProjectGroup(groupId: string): Promise<void> {
    await this.request(`/project/group/${groupId}`, { method: 'DELETE' });
  }

  async getColumns(projectId: string): Promise<Record<string, unknown>[]> {
    return this.request(`/project/${projectId}/column`);
  }

  async createColumn(projectId: string, input: unknown): Promise<Record<string, unknown>> {
    return this.request(`/project/${projectId}/column`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateColumn(
    projectId: string,
    columnId: string,
    input: unknown,
  ): Promise<Record<string, unknown>> {
    return this.request(`/project/${projectId}/column/${columnId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // --- Tag ---

  async getTags(): Promise<Record<string, unknown>[]> {
    return this.request('/tag');
  }

  async createTag(input: unknown): Promise<Record<string, unknown>> {
    return this.request('/tag', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // --- Focus ---

  async getFocus(focusId: string, type: number): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ type: String(type) });
    return this.request(`/focus/${encodeURIComponent(focusId)}?${q}`);
  }

  async listFocus(
    from: string,
    to: string,
    type: number,
  ): Promise<Record<string, unknown>[]> {
    const q = new URLSearchParams({ from, to, type: String(type) });
    return this.request(`/focus?${q}`);
  }

  async createFocus(input: unknown): Promise<Record<string, unknown>> {
    return this.request('/focus', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteFocus(focusId: string, type: number): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ type: String(type) });
    return this.request(`/focus/${encodeURIComponent(focusId)}?${q}`, {
      method: 'DELETE',
    });
  }

  // --- Habit ---

  async getHabit(habitId: string): Promise<Record<string, unknown>> {
    return this.request(`/habit/${encodeURIComponent(habitId)}`);
  }

  async listHabits(): Promise<Record<string, unknown>[]> {
    return this.request('/habit');
  }

  async createHabit(input: unknown): Promise<Record<string, unknown>> {
    return this.request('/habit', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateHabit(habitId: string, input: unknown): Promise<Record<string, unknown>> {
    return this.request(`/habit/${encodeURIComponent(habitId)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async createHabitCheckin(
    habitId: string,
    input: unknown,
  ): Promise<Record<string, unknown>> {
    return this.request(`/habit/${encodeURIComponent(habitId)}/checkin`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getHabitCheckins(
    habitIds: string[],
    from: number,
    to: number,
  ): Promise<Record<string, unknown>[]> {
    const q = new URLSearchParams({
      habitIds: habitIds.join(','),
      from: String(from),
      to: String(to),
    });
    return this.request(`/habit/checkins?${q}`);
  }

  // --- Countdown ---

  async getCountdowns(): Promise<Record<string, unknown>[]> {
    return this.request('/countdown');
  }

  async createCountdown(input: unknown): Promise<Record<string, unknown>> {
    return this.request('/countdown', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateCountdown(
    countdownId: string,
    input: unknown,
  ): Promise<Record<string, unknown>> {
    return this.request(`/countdown/${countdownId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteCountdown(countdownId: string): Promise<void> {
    await this.request(`/countdown/${countdownId}`, { method: 'DELETE' });
  }

  // --- Backup ---

  async exportBackup(): Promise<Record<string, unknown>> {
    return this.request('/backup/export');
  }

  async importBackup(backup: unknown): Promise<{ imported: number }> {
    return this.request('/backup/import', {
      method: 'POST',
      body: JSON.stringify(backup),
    });
  }
}

export async function getApi(): Promise<NodeTickApi> {
  const [baseUrl, token] = await Promise.all([getServerUrl(), getAccessToken()]);
  return new NodeTickApi(`${baseUrl}/open/v1`, token);
}
