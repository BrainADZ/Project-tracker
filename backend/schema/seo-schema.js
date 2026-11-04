export const SEO_SCHEMA = `
CREATE TABLE IF NOT EXISTS seo_monthly_reports (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_month TEXT NOT NULL,
  organic_sessions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  indexed_pages INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT,
  PRIMARY KEY (project_id, report_month)
);
CREATE TABLE IF NOT EXISTS seo_keywords (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  target_url TEXT NOT NULL DEFAULT '',
  search_volume INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_keyword_unique ON seo_keywords(project_id, LOWER(keyword));
CREATE INDEX IF NOT EXISTS idx_seo_keywords_project ON seo_keywords(project_id, active);
CREATE TABLE IF NOT EXISTS seo_keyword_ranks (
  keyword_id INTEGER NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  report_month TEXT NOT NULL,
  position INTEGER,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT,
  PRIMARY KEY (keyword_id, report_month)
);
`;
