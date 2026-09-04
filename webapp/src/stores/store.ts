import { create } from 'zustand';
import { ApiError, api } from '../lib/api';
import type { Me, Project, ProjectGroup, Tag, Task, TaskFilter } from '../lib/types';

export { INBOX_ID } from '../lib/project';

export interface ToastState {
  messageKey:
    | 'toastCompleted'
    | 'toastTrashed'
    | 'movedToast'
    | 'shareCopied'
    | 'summaryCopied'
    | 'summaryTemplateSaved'
    | 'searchFilterSaved';
  messageArg?: string;
  undo?: () => void;
}

interface AppState {
  booted: boolean;
  me: Me | null;
  projects: Project[];
  groups: ProjectGroup[];
  tags: Tag[];
  filters: TaskFilter[];
  tasks: Task[]; // active
  completed: Task[];
  trash: Task[];
  selectedTaskId: string | null;
  error: string | null;
  toast: ToastState | null;

  showToast: (toast: ToastState) => void;
  dismissToast: () => void;

  boot: () => Promise<boolean>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;

  selectTask: (id: string | null) => void;
  selectedTask: () => Task | null;

  upsertTask: (task: Task) => void;
  createTask: (input: {
    title: string;
    projectId: string;
    kind?: string;
    tags?: string[];
    priority?: number;
    reminders?: string[];
    repeatFlag?: string | null;
    content?: string;
    startDate?: string;
    dueDate?: string;
    isAllDay?: boolean;
    timeZone?: string;
    columnId?: string;
    parentId?: string;
  }) => Promise<Task>;
  toggleComplete: (task: Task, opts?: { silent?: boolean }) => Promise<void>;
  saveTask: (id: string, patch: Record<string, unknown>) => Promise<Task>;
  trashTask: (task: Task, opts?: { silent?: boolean }) => Promise<void>;
  duplicateTask: (task: Task) => Promise<void>;
  moveTask: (task: Task, projectId: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  purgeTask: (id: string) => Promise<void>;
  postponeAll: (bucketDay: string) => Promise<void>;

  addProject: (name: string, viewMode?: string) => Promise<Project>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setProjectView: (id: string, viewMode: string) => Promise<void>;
  addGroup: (name: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  addFilter: (input: Omit<TaskFilter, 'id' | 'sortOrder' | 'createdTime' | 'modifiedTime'> & { sortOrder?: number }) => Promise<TaskFilter>;
  updateFilter: (id: string, patch: Partial<TaskFilter>) => Promise<void>;
  deleteFilter: (id: string) => Promise<void>;
}

export const useStore = create<AppState>((set, getState) => ({
  booted: false,
  me: null,
  projects: [],
  groups: [],
  tags: [],
  filters: [],
  tasks: [],
  completed: [],
  trash: [],
  selectedTaskId: null,
  error: null,
  toast: null,

  showToast: (toast) => {
    set({ toast });
    if (getState().toast === toast) {
      setTimeout(() => {
        if (getState().toast === toast) set({ toast: null });
      }, 5000);
    }
  },
  dismissToast: () => set({ toast: null }),

  boot: async () => {
    try {
      const me = await api.me();
      set({ me });
      await getState().refresh();
      set({ booted: true, error: null });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        set({ me: null, booted: true });
        return false;
      }
      set({ error: String((e as Error).message), booted: true });
      return false;
    }
  },

  refresh: async () => {
    const [projects, groups, tags, filters, tasks, completed, trash] = await Promise.all([
      api.listProjects(),
      api.listGroups(),
      api.listTags(),
      api.listFilters(),
      api.filterTasks({ status: [0] }),
      api.listCompleted({}),
      api.listTrash(),
    ]);
    set({ projects, groups, tags, filters, tasks, completed, trash });
  },

  logout: async () => {
    await api.logout().catch(() => undefined);
    set({ me: null, tasks: [], completed: [], trash: [], projects: [], groups: [], tags: [], filters: [], selectedTaskId: null });
  },

  selectTask: (id) => set({ selectedTaskId: id }),
  selectedTask: () => {
    const { tasks, completed, trash, selectedTaskId } = getState();
    if (!selectedTaskId) return null;
    return (
      tasks.find((t) => t.id === selectedTaskId) ??
      completed.find((t) => t.id === selectedTaskId) ??
      trash.find((t) => t.id === selectedTaskId) ??
      null
    );
  },

  upsertTask: (task) =>
    set((s) => {
      const replace = (list: Task[]) => {
        const i = list.findIndex((t) => t.id === task.id);
        if (i === -1) return list;
        const next = list.slice();
        next[i] = task;
        return next;
      };
      if (task.status === 2) {
        return { tasks: s.tasks.filter((t) => t.id !== task.id), completed: replace(s.completed) };
      }
      return { tasks: replace(s.tasks), completed: s.completed.filter((t) => t.id !== task.id) };
    }),

  createTask: async (input) => {
    const hasSchedule = input.startDate != null || input.dueDate != null;
    const task = await api.createTask({
      title: input.title,
      projectId: input.projectId,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.reminders?.length ? { reminders: input.reminders } : {}),
      ...(input.repeatFlag ? { repeatFlag: input.repeatFlag } : {}),
      ...(input.content ? { content: input.content } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(hasSchedule ? { isAllDay: input.isAllDay ?? !input.startDate } : {}),
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
      ...(input.columnId ? { columnId: input.columnId } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
    });
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  toggleComplete: async (task, opts) => {
    if (task.status === 2) {
      const updated = await api.updateTask(task.id, { projectId: task.projectId, status: 0 });
      set((s) => ({
        completed: s.completed.filter((t) => t.id !== task.id),
        tasks: [...s.tasks, updated],
      }));
    } else {
      await api.completeTask(task.projectId, task.id);
      const completedAt = new Date().toISOString();
      const done: Task = { ...task, status: 2, completedTime: completedAt };
      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id), completed: [done, ...s.completed] }));
      if (!opts?.silent) {
        getState().showToast({
          messageKey: 'toastCompleted',
          undo: () => void getState().toggleComplete(done, { silent: true }),
        });
      }
    }
  },

  saveTask: async (id, patch) => {
    const state = getState();
    const current =
      state.tasks.find((task) => task.id === id) ??
      state.completed.find((task) => task.id === id) ??
      state.trash.find((task) => task.id === id) ??
      null;
    const projectId = (patch.projectId as string) ?? current?.projectId;
    if (!projectId) throw new Error('Task project not found');
    const task = await api.updateTask(id, { ...patch, projectId });
    // projectId may have changed → refresh lists conservatively but cheaply:
    set((s) => {
      const move = (list: Task[]) => list.filter((t) => t.id !== id);
      return { tasks: [...move(s.tasks), task].filter((t) => t.status !== 2), completed: task.status === 2 ? [task, ...move(s.completed)] : move(s.completed) };
    });
    return task;
  },

  trashTask: async (task, opts) => {
    await api.deleteTask(task.projectId, task.id);
    const trashed: Task = { ...task, deletedTime: new Date().toISOString() };
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== task.id),
      completed: s.completed.filter((t) => t.id !== task.id),
      trash: [trashed, ...s.trash],
      selectedTaskId: s.selectedTaskId === task.id ? null : s.selectedTaskId,
    }));
    if (!opts?.silent) {
      getState().showToast({
        messageKey: 'toastTrashed',
        undo: () => void getState().restoreTask(task.id),
      });
    }
  },

  duplicateTask: async (task) => {
    const copy = await api.createTask({
      title: task.title,
      projectId: task.projectId,
      priority: task.priority,
      ...(task.startDate ? { startDate: task.startDate } : {}),
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
      ...(task.startDate || task.dueDate ? { isAllDay: task.isAllDay } : {}),
      ...(task.timeZone ? { timeZone: task.timeZone } : {}),
      ...(task.tags.length ? { tags: task.tags } : {}),
      ...(task.content ? { content: task.content } : {}),
      ...(task.items.length
        ? { items: task.items.map((i) => ({ title: i.title, status: i.status })) }
        : {}),
    });
    set((s) => ({ tasks: [...s.tasks, copy] }));
  },

  moveTask: async (task, projectId) => {
    if (task.projectId === projectId) return;
    const moved = await api.updateTask(task.id, { projectId });
    if (moved.status === 2) {
      set((s) => ({
        completed: [...s.completed.filter((t) => t.id !== moved.id), moved],
        tasks: s.tasks.filter((t) => t.id !== moved.id),
      }));
    } else {
      set((s) => ({
        tasks: [...s.tasks.filter((t) => t.id !== moved.id), moved],
        completed: s.completed.filter((t) => t.id !== moved.id),
      }));
    }
  },

  restoreTask: async (id) => {
    const task = await api.restoreTask(id);
    set((s) => ({ trash: s.trash.filter((t) => t.id !== id), tasks: [...s.tasks, task] }));
  },

  purgeTask: async (id) => {
    await api.purgeTask(id);
    set((s) => ({ trash: s.trash.filter((t) => t.id !== id) }));
  },

  postponeAll: async (today) => {
    const overdue = getState().tasks.filter((t) => {
      const d = t.dueDate?.slice(0, 10);
      return d && d < today && !t.parentId;
    });
    await Promise.all(overdue.map((t) => api.updateTask(t.id, { projectId: t.projectId, dueDate: `${today}T00:00:00+0000` })));
    await getState().refresh();
  },

  addProject: async (name, viewMode = 'list') => {
    const project = await api.createProject(name, viewMode);
    set((s) => ({ projects: [...s.projects, project] }));
    return project;
  },

  renameProject: async (id, name) => {
    const project = await api.updateProject(id, { name });
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? project : p)) }));
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      tasks: s.tasks.filter((t) => t.projectId !== id),
      selectedTaskId: null,
    }));
  },

  setProjectView: async (id, viewMode) => {
    const project = await api.updateProject(id, { viewMode });
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? project : p)) }));
  },

  addGroup: async (name) => {
    const group = await api.createGroup(name);
    set((s) => ({ groups: [...s.groups, group] }));
  },

  deleteGroup: async (id) => {
    await api.deleteGroup(id);
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      projects: s.projects.map((p) => (p.groupId === id ? { ...p, groupId: null } : p)),
    }));
  },

  addFilter: async (input) => {
    const filter = await api.createFilter(input);
    set((s) => ({ filters: [...s.filters, filter] }));
    return filter;
  },

  updateFilter: async (id, patch) => {
    const filter = await api.updateFilter(id, patch);
    set((s) => ({ filters: s.filters.map((item) => (item.id === id ? filter : item)) }));
  },

  deleteFilter: async (id) => {
    await api.deleteFilter(id);
    set((s) => ({ filters: s.filters.filter((item) => item.id !== id) }));
  },
}));
