CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'default',
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS project_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  view_mode TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  view_mode TEXT NOT NULL DEFAULT 'list',
  kind TEXT NOT NULL DEFAULT 'TASK',
  group_id TEXT,
  closed INTEGER NOT NULL DEFAULT 0,
  permission TEXT NOT NULL DEFAULT 'write',
  etag INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_projects_user_order ON projects(user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS task_columns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  task_desc TEXT,
  kind TEXT NOT NULL DEFAULT 'TASK',
  start_date TEXT,
  due_date TEXT,
  time_zone TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  repeat_flag TEXT,
  reminders TEXT,
  items TEXT,
  tags TEXT,
  parent_id TEXT,
  child_ids TEXT,
  column_id TEXT,
  completed_time TEXT,
  focus_summaries TEXT,
  etag INTEGER NOT NULL DEFAULT 0,
  created_time TEXT,
  modified_time TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(user_id, project_id, deleted);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_filters_user_order ON filters(user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon_res TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 0,
  encouragement TEXT,
  type TEXT,
  goal REAL,
  step REAL,
  unit TEXT,
  repeat_rule TEXT,
  reminders TEXT,
  section_id TEXT,
  style INTEGER,
  etag INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  stamp INTEGER NOT NULL,
  value REAL,
  goal REAL,
  status INTEGER,
  time TEXT,
  op_time TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(habit_id, stamp)
);
CREATE INDEX IF NOT EXISTS idx_checkins_habit ON habit_checkins(habit_id, stamp);

CREATE TABLE IF NOT EXISTS habit_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  stamp INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  emoji INTEGER NOT NULL DEFAULT 50,
  op_time TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(habit_id, stamp)
);
CREATE INDEX IF NOT EXISTS idx_habit_records_habit ON habit_records(habit_id, stamp);

CREATE TABLE IF NOT EXISTS focus_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type INTEGER NOT NULL,
  task_id TEXT,
  note TEXT,
  start_time TEXT,
  end_time TEXT,
  duration INTEGER,
  pause_duration INTEGER,
  relation TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  etag INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_user_type ON focus_records(user_id, type);

CREATE TABLE IF NOT EXISTS countdowns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  date TEXT,
  kind TEXT NOT NULL DEFAULT 'countdown',
  reminders TEXT NOT NULL DEFAULT '[]',
  repeat_flag TEXT,
  calculation TEXT NOT NULL DEFAULT 'standard',
  display_mode TEXT NOT NULL DEFAULT 'on-day',
  style INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#4772FA',
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  task_enabled INTEGER NOT NULL DEFAULT 1,
  habit_enabled INTEGER NOT NULL DEFAULT 1,
  countdown_enabled INTEGER NOT NULL DEFAULT 1,
  sound_enabled INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  all_day_time TEXT NOT NULL DEFAULT '09:00',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  sent_at INTEGER,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_created ON notification_deliveries(created_at);

CREATE TABLE IF NOT EXISTS login_attempts_ip (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_attempts_ip (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registration_attempts_updated ON registration_attempts_ip(updated_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  level TEXT NOT NULL,
  ip TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
