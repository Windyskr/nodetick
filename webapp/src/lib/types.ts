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
  pinned: boolean;
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

export type FilterDateMode = 'any' | 'today' | 'tomorrow' | 'week' | 'next7' | 'month' | 'overdue' | 'nodate' | 'custom';

/** Task types a filter can pick: notes are kind NOTE, everything else is a task. */
export type FilterKind = 'task' | 'note';

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
  /** Search words that must all match (title, description, subtasks, tags); always ANDed. */
  keywords: string;
  kinds: FilterKind[];
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
  createdTime?: string | null;
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

/** One itemized check-in of a count habit's day (NodeTick extension). */
export interface HabitCheckinEntry {
  id: string;
  habitId: string;
  stamp: number;
  value: number;
  time: string | null;
}

/** What the check-in entry endpoints answer: the year's check-ins plus the day's entries. */
export interface HabitEntryResult extends HabitYear {
  entries: HabitCheckinEntry[];
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
  /** Entered by hand rather than timed. */
  added: boolean;
  etag: string;
}

/** Totals in GET /open/v1/focus/stats (`total` is all time, `period` the from–to range). */
export interface FocusTotals {
  pomoCount: number;
  pomoSeconds: number;
  stopwatchSeconds: number;
  seconds: number;
  records: number;
}

export interface FocusStats {
  tz: string;
  from: string | null;
  to: string | null;
  taskId: string | null;
  total: FocusTotals & { firstDay: string | null };
  period: FocusTotals | null;
  days: { day: string; pomoCount: number; seconds: number }[];
  byTask: { taskId: string | null; title: string | null; projectId: string | null; seconds: number; count: number; pomoCount: number }[];
  byProject: { projectId: string | null; seconds: number; count: number; pomoCount: number }[];
  /** Focused seconds per local hour of day (24 entries; empty without a range). */
  byHour: number[];
}

export interface FocusHistoryPage {
  records: Focus[];
  /** Pass as `before` for the next page; null after the oldest record. */
  nextBefore: string | null;
}

export interface Countdown {
  id: string;
  name: string | null;
  /** YYYY-MM-DD; for a lunar countdown, the solar day of its original lunar date. */
  date: string | null;
  kind: 'countdown' | 'anniversary' | 'birthday' | 'holiday';
  /** Tokens: same-day, 1-day, 2-days, 3-days, 1-week, 1-month. */
  reminders: string[];
  /** 'yearly' | 'monthly' | null; yearly + lunar repeats on the lunar date. */
  repeatFlag: string | null;
  calculation: 'standard' | 'workday';
  /** Legacy smart-list option, kept for API compatibility; the UI uses showInCalendar. */
  displayMode: 'on-day' | 'always';
  style: number;
  color: string;
  icon: string | null;
  sortOrder: number;
  note: string;
  pinned: boolean;
  archived: boolean;
  archivedTime: string | null;
  /** HH:MM; null = the all-day reminder time from the notification settings. */
  reminderTime: string | null;
  lunar: boolean;
  numberFormat: 'days' | 'ymd';
  showInCalendar: boolean;
  createdTime: string | null;
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

export interface AdminUser {
  id: string;
  email: string;
  isAdmin: boolean;
  createdAt: number;
  tasks: number;
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
  /** NodeTick's daily digest: one push at `digestTime` with today's tasks. */
  digestEnabled: boolean;
  digestTime: string;
}

export interface NotificationConfig {
  configured: boolean;
  publicKey: string;
  subscribedDevices: number;
  settings: NotificationSettings;
}
