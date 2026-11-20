import { create } from 'zustand';
import { ApiError, api } from '../lib/api';
import type { Me, Project, ProjectGroup, Tag, Task, TaskFilter } from '../lib/types';
import { postponePatch } from '../components/taskSchedule';
import { hasTag, tagKey, uniqueTags } from '../lib/tags';
import { errorMessage } from '../lib/errors';

export { INBOX_ID } from '../lib/project';

/** Optional navigation entries the user can hide via the avatar menu. */
export type FeatureKey = 'summary' | 'matrix' | 'focus' | 'habit' | 'countdown';
export type FeaturePrefs = Record<FeatureKey, boolean>;

const FEATURE_PREFS_KEY = 'ntk_feature_prefs';
const DEFAULT_FEATURES: FeaturePrefs = { summary: true, matrix: true, focus: true, habit: true, countdown: true };

function readFeatures(): FeaturePrefs {
  try {
    const raw = localStorage.getItem(FEATURE_PREFS_KEY);
    if (!raw) return DEFAULT_FEATURES;
    const parsed = JSON.parse(raw) as Partial<FeaturePrefs>;
    return { ...DEFAULT_FEATURES, ...parsed };
  } catch {
    return DEFAULT_FEATURES;
  }
}

function saveFeatures(prefs: FeaturePrefs) {
  try {
    localStorage.setItem(FEATURE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage may be unavailable; the pref lives only for this session
  }
}

/** In-flight saveTask request per task id (see saveTask). */
const saveQueues = new Map<string, Promise<Task>>();

type TaskLists = Pick<AppState, 'tasks' | 'completed' | 'abandoned' | 'trash'>;

/** Swap a task in whichever list holds it, keeping its position. */
function replaceTask(s: TaskLists, task: Task): TaskLists {
  const swap = (list: Task[]) => (list.some((t) => t.id === task.id) ? list.map((t) => (t.id === task.id ? task : t)) : list);
  return { tasks: swap(s.tasks), completed: swap(s.completed), abandoned: swap(s.abandoned), trash: swap(s.trash) };
}

export interface ToastState {
  messageKey:
    | 'toastCompleted'
    | 'toastTrashed'
    | 'movedToast'
    | 'shareCopied'
    | 'summaryCopied'
    | 'summaryTemplateSaved'
    | 'searchFilterSaved'
    | 'toastError';
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
  abandoned: Task[]; // won't do (status -1)
  trash: Task[];
  selectedTaskId: string | null;
  selectedIds: string[];
  /** Narrow screens show the list sidebar as a drawer; this is its state. */
  navOpen: boolean;
  features: FeaturePrefs;
  error: string | null;
  toast: ToastState | null;

  showToast: (toast: ToastState) => void;
  dismissToast: () => void;
  toggleFeature: (key: FeatureKey) => void;

  boot: () => Promise<boolean>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;

  selectTask: (id: string | null) => void;
  selectedTask: () => Task | null;

  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setNavOpen: (open: boolean) => void;
  batchComplete: () => Promise<void>;
  batchTrash: () => Promise<void>;
  batchMove: (projectId: string) => Promise<void>;
  batchSetDate: (dueDate: string | null, isAllDay: boolean) => Promise<void>;
  batchPriority: (priority: number) => Promise<void>;
  reorderTasks: (draggedId: string, targetId: string, siblings: string[] | undefined, position: 'before' | 'after') => Promise<void>;

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
  abandonTask: (task: Task) => Promise<void>;
  restoreAbandoned: (id: string) => Promise<void>;
  saveTask: (id: string, patch: Record<string, unknown>) => Promise<Task>;
  trashTask: (task: Task, opts?: { silent?: boolean }) => Promise<void>;
  duplicateTask: (task: Task) => Promise<void>;
  moveTask: (task: Task, projectId: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  purgeTask: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  /** Move overdue tasks (optionally only `ids`) to `bucketDay`, keeping their times. */
  postponeAll: (bucketDay: string, ids?: string[]) => Promise<void>;

  addProject: (name: string, viewMode?: string) => Promise<Project>;
  renameProject: (id: string, name: string) => Promise<void>;
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'viewMode' | 'groupId' | 'color' | 'sortOrder' | 'closed'>>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setProjectView: (id: string, viewMode: string) => Promise<void>;
  addGroup: (name: string) => Promise<void>;
  updateGroup: (id: string, patch: { name?: string; sortOrder?: number }) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  addFilter: (input: Omit<TaskFilter, 'id' | 'sortOrder' | 'createdTime' | 'modifiedTime'> & { sortOrder?: number }) => Promise<TaskFilter>;
  updateFilter: (id: string, patch: Partial<TaskFilter>) => Promise<void>;
  deleteFilter: (id: string) => Promise<void>;
  updateTag: (name: string, patch: { name?: string; label?: string; color?: string | null }) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
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
  abandoned: [],
  trash: [],
  selectedTaskId: null,
  selectedIds: [],
  navOpen: false,
  features: readFeatures(),
  error: null,
  toast: null,

  toggleFeature: (key) => {
    const features = { ...getState().features, [key]: !getState().features[key] };
    saveFeatures(features);
    set({ features });
  },

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
      // Who am I and the data go out together: one wait for the server
      // instead of two. Signed out, both answer 401 without touching D1.
      const [me] = await Promise.all([api.me(), getState().refresh()]);
      set({ me, booted: true, error: null });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        set({ me: null, booted: true });
        return false;
      }
      set({ error: errorMessage(e), booted: true });
      return false;
    }
  },

  refresh: async () => {
    const [projects, groups, tags, filters, tasks, completed, abandoned, trash] = await Promise.all([
      api.listProjects(),
      api.listGroups(),
      api.listTags(),
      api.listFilters(),
      api.filterTasks({ status: [0] }),
      api.listCompleted({}),
      api.filterTasks({ status: [-1] }),
      api.listTrash(),
    ]);
    set({ projects, groups, tags, filters, tasks, completed, abandoned, trash });
  },

  logout: async () => {
    await api.logout().catch(() => undefined);
    set({ me: null, tasks: [], completed: [], abandoned: [], trash: [], projects: [], groups: [], tags: [], filters: [], selectedTaskId: null, selectedIds: [] });
  },

  selectTask: (id) => set({ selectedTaskId: id }),
  selectedTask: () => {
    const { tasks, completed, abandoned, trash, selectedTaskId } = getState();
    if (!selectedTaskId) return null;
    return (
      tasks.find((t) => t.id === selectedTaskId) ??
      completed.find((t) => t.id === selectedTaskId) ??
      abandoned.find((t) => t.id === selectedTaskId) ??
      trash.find((t) => t.id === selectedTaskId) ??
      null
    );
  },

  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
    })),
  clearSelection: () => set({ selectedIds: [] }),
  setNavOpen: (navOpen) => set({ navOpen }),

  // Batch actions reuse the single-task actions, which update the store from
  // each response; reloading everything (8 requests, every task) is kept for
  // the cases where the server also rewires parents and subtasks.
  batchComplete: async () => {
    const { selectedIds, tasks, toggleComplete } = getState();
    const targets = tasks.filter((t) => selectedIds.includes(t.id) && t.status !== 2);
    await Promise.all(targets.map((t) => toggleComplete(t, { silent: true })));
    getState().clearSelection();
  },

  batchTrash: async () => {
    const { selectedIds, tasks, trashTask } = getState();
    const targets = tasks.filter((t) => selectedIds.includes(t.id));
    await Promise.all(targets.map((t) => trashTask(t, { silent: true })));
    // Trashing a parent detaches its subtasks on the server.
    if (targets.some((t) => t.childIds.length)) await getState().refresh();
    getState().clearSelection();
  },

  batchMove: async (projectId) => {
    const { selectedIds, tasks, moveTask } = getState();
    const targets = tasks.filter((t) => selectedIds.includes(t.id) && t.projectId !== projectId);
    await Promise.all(targets.map((t) => moveTask(t, projectId)));
    // Moving to another list detaches it from its parent and its subtasks.
    if (targets.some((t) => t.parentId || t.childIds.length)) await getState().refresh();
    getState().clearSelection();
  },

  batchSetDate: async (dueDate, isAllDay) => {
    const { selectedIds, tasks, saveTask } = getState();
    const targets = tasks.filter((t) => selectedIds.includes(t.id));
    await Promise.all(targets.map((t) => saveTask(t.id, { projectId: t.projectId, dueDate, isAllDay })));
    getState().clearSelection();
  },

  batchPriority: async (priority) => {
    const { selectedIds, tasks, saveTask } = getState();
    const targets = tasks.filter((t) => selectedIds.includes(t.id));
    await Promise.all(targets.map((t) => saveTask(t.id, { projectId: t.projectId, priority })));
    getState().clearSelection();
  },

  /**
   * Drag-and-drop reorder inside a rendered group: rewrites sortOrder for the
   * affected sibling list (index * 100) and patches only changed tasks.
   */
  reorderTasks: async (draggedId, targetId, siblings, position) => {
    const state = getState();
    const base = siblings?.length
      ? siblings
      : state.tasks.filter((t) => !t.parentId).map((t) => t.id);
    const ids = base.filter((id) => id !== draggedId);
    let index = ids.indexOf(targetId);
    if (index === -1) return;
    if (position === 'after') index += 1;
    ids.splice(index, 0, draggedId);

    const byId = new Map(state.tasks.map((t) => [t.id, t]));
    const updates: { id: string; projectId: string; sortOrder: number }[] = [];
    ids.forEach((id, i) => {
      const task = byId.get(id);
      if (task && task.sortOrder !== i * 100) {
        updates.push({ id, projectId: task.projectId, sortOrder: i * 100 });
      }
    });
    set((s) => ({
      tasks: s.tasks.map((t) => {
        const u = updates.find((x) => x.id === t.id);
        return u ? { ...t, sortOrder: u.sortOrder } : t;
      }),
    }));
    await Promise.all(updates.map((u) => api.updateTask(u.id, { projectId: u.projectId, sortOrder: u.sortOrder })));
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
        return {
          tasks: s.tasks.filter((t) => t.id !== task.id),
          completed: replace(s.completed),
          abandoned: s.abandoned.filter((t) => t.id !== task.id),
        };
      }
      if (task.status === -1) {
        return {
          tasks: s.tasks.filter((t) => t.id !== task.id),
          completed: s.completed.filter((t) => t.id !== task.id),
          abandoned: replace(s.abandoned),
        };
      }
      return {
        tasks: replace(s.tasks),
        completed: s.completed.filter((t) => t.id !== task.id),
        abandoned: s.abandoned.filter((t) => t.id !== task.id),
      };
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
      const next = await api.completeTask(task.projectId, task.id);
      const completedAt = new Date().toISOString();
      const done: Task = { ...task, status: 2, completedTime: completedAt };
      set((s) => ({
        tasks: next ? [...s.tasks.filter((t) => t.id !== task.id && t.id !== next.id), next] : s.tasks.filter((t) => t.id !== task.id),
        abandoned: s.abandoned.filter((t) => t.id !== task.id),
        completed: [done, ...s.completed],
      }));
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
      state.abandoned.find((task) => task.id === id) ??
      state.trash.find((task) => task.id === id) ??
      null;
    const projectId = (patch.projectId as string) ?? current?.projectId;
    if (!projectId) throw new Error('Task project not found');
    // Apply the edit locally first: a second edit made while the first request
    // is in flight (adding subtasks or tags in a row) must build on it, not on
    // the stale task, or the first edit is overwritten and lost.
    if (current) {
      // Like JSON.stringify for the request, ignore keys set to undefined.
      const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      set((s) => replaceTask(s, { ...current, ...defined, projectId } as Task));
    }
    const previous = saveQueues.get(id) ?? Promise.resolve();
    // One task's saves go out in order so the server applies them in order.
    const request = previous.catch(() => undefined).then(() => api.updateTask(id, { ...patch, projectId }));
    saveQueues.set(id, request);
    let task: Task;
    try {
      task = await request;
    } catch (error) {
      if (saveQueues.get(id) === request) {
        saveQueues.delete(id);
        if (current) set((s) => replaceTask(s, current));
      }
      throw error;
    }
    // A newer queued save for this task will deliver the final state.
    if (saveQueues.get(id) !== request) return task;
    saveQueues.delete(id);
    // New tags added in the detail panel should surface in the sidebar at once.
    set((s) => {
      // Same shape as the server's tag list: lowercased name, typed label.
      const known = new Set(s.tags.map((tag) => tagKey(tag.name)));
      const additions = uniqueTags(task.tags)
        .filter((name) => !known.has(tagKey(name)))
        .map((name, i) => ({ name: tagKey(name), label: name, color: null, sortOrder: s.tags.length + i, parentId: null }));
      const tags = additions.length ? [...s.tags, ...additions] : s.tags;
      if (current && current.status === task.status) return { tags, ...replaceTask(s, task) };
      // The status changed → move the task to the matching list.
      const move = (list: Task[]) => list.filter((t) => t.id !== id);
      return {
        tags,
        tasks: task.status === 0 ? [...move(s.tasks), task] : move(s.tasks),
        completed: task.status === 2 ? [task, ...move(s.completed)] : move(s.completed),
        abandoned: task.status === -1 ? [task, ...move(s.abandoned)] : move(s.abandoned),
      };
    });
    return task;
  },

  trashTask: async (task, opts) => {
    await api.deleteTask(task.projectId, task.id);
    const trashed: Task = { ...task, deletedTime: new Date().toISOString() };
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== task.id),
      completed: s.completed.filter((t) => t.id !== task.id),
      abandoned: s.abandoned.filter((t) => t.id !== task.id),
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

  abandonTask: async (task) => {
    const updated = await api.updateTask(task.id, { projectId: task.projectId, status: -1 });
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== task.id),
      completed: s.completed.filter((t) => t.id !== task.id),
      abandoned: [updated, ...s.abandoned.filter((t) => t.id !== task.id)],
      selectedTaskId: s.selectedTaskId === task.id ? null : s.selectedTaskId,
    }));
  },

  restoreAbandoned: async (id) => {
    const current = getState().abandoned.find((t) => t.id === id);
    if (!current) return;
    const updated = await api.updateTask(id, { projectId: current.projectId, status: 0 });
    set((s) => ({
      abandoned: s.abandoned.filter((t) => t.id !== id),
      tasks: [...s.tasks, updated],
    }));
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

  emptyTrash: async () => {
    const ids = getState().trash.map((t) => t.id);
    await Promise.all(ids.map((id) => api.purgeTask(id)));
    set({ trash: [] });
  },

  postponeAll: async (today, ids) => {
    const overdue = getState().tasks.filter((t) => {
      const d = t.dueDate?.slice(0, 10);
      return d && d < today && !t.parentId && (!ids || ids.includes(t.id));
    });
    await Promise.all(overdue.map((t) => getState().saveTask(t.id, postponePatch(t, today))));
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

  updateProject: async (id, patch) => {
    const project = await api.updateProject(id, patch);
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

  updateGroup: async (id, patch) => {
    const group = await api.updateGroup(id, patch);
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? group : g)) }));
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

  updateTag: async (name, patch) => {
    const tag = await api.updateTag(name, patch);
    const oldName = tagKey(name);
    // A rename must reach every stored task tag so tag pages stay coherent.
    // Tasks keep tags as typed ("Work" for the tag "work"): match by key.
    const rewrite = (list: Task[]) =>
      tag.name === oldName
        ? list
        : list.map((t) => (hasTag(t, oldName) ? { ...t, tags: t.tags.map((x) => (tagKey(x) === oldName ? tag.name : x)) } : t));
    set((s) => ({
      tags: s.tags.map((item) => (tagKey(item.name) === oldName ? tag : item)),
      tasks: rewrite(s.tasks),
      completed: rewrite(s.completed),
      abandoned: rewrite(s.abandoned),
      trash: rewrite(s.trash),
    }));
  },

  deleteTag: async (name) => {
    await api.deleteTag(name);
    const oldName = tagKey(name);
    const strip = (list: Task[]) =>
      list.map((t) => (hasTag(t, oldName) ? { ...t, tags: t.tags.filter((x) => tagKey(x) !== oldName) } : t));
    set((s) => ({
      tags: s.tags.filter((item) => tagKey(item.name) !== oldName),
      tasks: strip(s.tasks),
      completed: strip(s.completed),
      abandoned: strip(s.abandoned),
      trash: strip(s.trash),
    }));
  },
}));
