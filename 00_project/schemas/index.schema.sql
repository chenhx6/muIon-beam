PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manifests (
  manifest_id TEXT PRIMARY KEY,
  manifest_type TEXT NOT NULL,
  schema_version TEXT,
  source_path TEXT NOT NULL UNIQUE,
  content_sha256 TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  task_name TEXT,
  source_type TEXT,
  is_upper_task INTEGER,
  objective_zh TEXT,
  status TEXT,
  source_manifest_id TEXT REFERENCES manifests(manifest_id)
);

CREATE TABLE IF NOT EXISTS models (
  model_id TEXT PRIMARY KEY,
  model_name TEXT,
  model_type TEXT,
  revision TEXT,
  source_path TEXT,
  source_manifest_id TEXT REFERENCES manifests(manifest_id)
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(task_id),
  run_kind TEXT,
  status TEXT,
  maturity_level TEXT,
  retention_level TEXT,
  parent_result_tag TEXT,
  gitee_commit TEXT,
  gitee_tag TEXT,
  drive_path TEXT,
  source_manifest_id TEXT REFERENCES manifests(manifest_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT REFERENCES runs(run_id),
  artifact_path TEXT NOT NULL,
  role TEXT,
  size INTEGER,
  sha256 TEXT,
  retention_level TEXT,
  local_status TEXT,
  drive_status TEXT,
  gitee_status TEXT,
  UNIQUE(run_id, artifact_path)
);

CREATE TABLE IF NOT EXISTS relations (
  relation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  UNIQUE(source_type, source_id, relation_type, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS archives (
  archive_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(run_id),
  drive_path TEXT,
  manifest_sha256 TEXT,
  status TEXT,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(run_id),
  report_type TEXT,
  path TEXT,
  sha256 TEXT
);

CREATE TABLE IF NOT EXISTS figures (
  figure_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(run_id),
  figure_type TEXT,
  path TEXT,
  analysis_id TEXT,
  sha256 TEXT,
  retention_level TEXT
);

CREATE TABLE IF NOT EXISTS behavior_analyses (
  analysis_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(run_id),
  question_zh TEXT,
  analysis_type TEXT,
  confidence TEXT
);

CREATE TABLE IF NOT EXISTS sync_states (
  sync_id TEXT PRIMARY KEY,
  task_id TEXT,
  run_id TEXT,
  local_commit TEXT,
  gitee_remote_commit TEXT,
  gitee_tag TEXT,
  drive_path TEXT,
  manifest_sha256 TEXT,
  status TEXT,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS cache_entries (
  cache_id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_path TEXT UNIQUE NOT NULL,
  source_model TEXT,
  source_parameters TEXT,
  software_version TEXT,
  size INTEGER,
  last_used_at TEXT,
  rebuildable INTEGER,
  locked INTEGER,
  referenced_by TEXT,
  retention_level TEXT
);
