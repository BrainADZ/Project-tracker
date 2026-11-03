export const MARKETING_SCHEMA = `
CREATE TABLE IF NOT EXISTS marketing_clients (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  platforms TEXT NOT NULL DEFAULT '',
  brand_notes TEXT NOT NULL DEFAULT '',
  monthly_target INTEGER NOT NULL DEFAULT 15,
  social_id INTEGER REFERENCES users(id),
  designer_id INTEGER REFERENCES users(id),
  manager_id INTEGER REFERENCES users(id),
  head_id INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS marketing_jobs (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES marketing_clients(id) ON DELETE CASCADE,
  post_type TEXT NOT NULL DEFAULT 'Still',
  platform TEXT NOT NULL DEFAULT 'Instagram',
  social_owner_id INTEGER REFERENCES users(id),
  work_date TEXT NOT NULL,
  publish_date TEXT,
  workflow TEXT NOT NULL DEFAULT 'Not Started',
  started_at TEXT,
  finished_at TEXT,
  calendar_item_id INTEGER UNIQUE,
  internal_state TEXT NOT NULL DEFAULT 'pending',
  client_state TEXT NOT NULL DEFAULT 'pending',
  delay_reason TEXT NOT NULL DEFAULT '',
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_marketing_jobs_date ON marketing_jobs(work_date, client_id);
CREATE TABLE IF NOT EXISTS marketing_reports (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES marketing_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  report_date TEXT NOT NULL,
  accomplished TEXT NOT NULL,
  blockers TEXT NOT NULL DEFAULT '',
  next_plan TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(client_id, user_id, report_date)
);
CREATE TABLE IF NOT EXISTS marketing_plans (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES marketing_clients(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  target INTEGER NOT NULL,
  strategy TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  UNIQUE(client_id, month)
);
CREATE TABLE IF NOT EXISTS marketing_calendar_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES marketing_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  post_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  publish_date TEXT NOT NULL,
  production_due TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_reviews (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES marketing_clients(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES marketing_plans(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  decision TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_daily_work (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_date TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL,
  delay_reason TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_marketing_daily_work_date ON marketing_daily_work(work_date);
CREATE TABLE IF NOT EXISTS daily_reporting (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,
  work_type TEXT NOT NULL DEFAULT 'Still',
  social_id INTEGER REFERENCES users(id),
  start_time TEXT NOT NULL DEFAULT '',
  completion_time TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Not Started',
  delay_reason TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_reporting_date ON daily_reporting(report_date);
`;
