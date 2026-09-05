/** API shapes — mirror worker/src/serialize.ts exactly. */

export interface ChecklistItem {
  id: string;
  title: string;
  status: number;
  sortOrder: number;
  startDate: string | null;
  isAllDay: boolean;
  timeZone: string | null;
  completedTime: string | null;
}

export interface FocusSummary {
  estimatedPomo?: number;
  estimatedDuration?: number;
  status?: number;
  duration?: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  content: string;
  desc: string;
  kind: string;
  startDate: string | null;
  dueDate: string | null;
  timeZone: string | null;
  isAllDay: boolean;
  priority: number;
  status: number;
  sortOrder: number;
  repeatFlag: string | null;
  reminders: string[];
  items: ChecklistItem[];
  tags: string[];
  parentId: string | null;
  childIds: string[];
  columnId: string | null;
  columnName: string | null;
  completedTime: string | null;
  focusSummaries: FocusSummary[];
  etag: string;
  createdTime: string | null;
  modifiedTime: string | null;
  deletedTime: string | null;
}

export interface Project {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  closed: boolean;
  groupId: string | null;
  viewMode: string;
  permission: string;
  kind: string;
  etag: string;
}

export interface ProjectGroup {
  id: string;
  name: string;
  viewMode: string;
  sortOrder: number;
}

export interface Column {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
}

export interface ProjectData {
  project: Project;
  tasks: Task[];
  columns: Column[];
}

export interface Tag {
  name: string;
  label: string;
  color: string | null;
  sortOrder: number;
  parentId: string | null;
}

export type FilterDateMode = 'any' | 'today' | 'tomorrow' | 'week' | 'overdue' | 'custom';

export interface TaskFilter {
  id: string;
  name: string;
  logic: 'and' | 'or';
  dateMode: FilterDateMode;
  dateStart: string | null;
  dateEnd: string | null;
  projectIds: string[];
  tags: string[];
  priorities: number[];
  statuses: number[];
  sortOrder: number;
  createdTime: string | null;
  modifiedTime: string | null;
}

export interface Habit {
  id: string;
  name: string;
  iconRes: string | null;
  color: string | null;
  sortOrder: number;
  status: number;
  encouragement: string | null;
  type: string | null;
  goal: number | null;
  step: number | null;
  unit: string | null;
  repeatRule: string | null;
  reminders: string[];
  sectionId: string | null;
  style: number | null;
  etag: string;
}

export interface CheckinRow {
  stamp: number;
  value: number | null;
  goal: number | null;
  status: number | null;
  time: string | null;
}

export interface HabitYear {
  habitId: string;
  year: number;
  checkins: CheckinRow[];
}

export interface HabitRecord {
  id: string;
  habitId: string;
  stamp: number;
  content: string;
  emoji: number;
  opTime: string | null;
}

export interface Focus {
  id: string;
  type: number;
  taskId: string | null;
  note: string | null;
  startTime: string | null;
  endTime: string | null;
  duration: number | null;
  pauseDuration: number | null;
  relationType: number[];
  status: number;
  etag: string;
}

export interface Countdown {
  id: string;
  name: string | null;
  date: string | null;
  kind: 'countdown' | 'anniversary' | 'birthday' | 'holiday';
  reminders: string[];
  repeatFlag: string | null;
  calculation: 'standard' | 'workday';
  displayMode: 'on-day' | 'always';
  style: number;
  color: string;
  icon: string | null;
  sortOrder: number;
}

export interface ApiToken {
  id: string;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface Me {
  id: string;
  email: string;
  isAdmin: boolean;
}

export interface TaskComment {
  id: string;
  taskId: string;
  projectId: string;
  title: string;
  createdTime: string | null;
}

export interface NotificationSettings {
  enabled: boolean;
  taskEnabled: boolean;
  habitEnabled: boolean;
  countdownEnabled: boolean;
  soundEnabled: boolean;
  timezone: string;
  allDayTime: string;
}

export interface NotificationConfig {
  configured: boolean;
  publicKey: string;
  subscribedDevices: number;
  settings: NotificationSettings;
}
