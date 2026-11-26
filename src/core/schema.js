export const LIB_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS knowledge (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '',
  session_id    TEXT NOT NULL DEFAULT '',
  turn_id       TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'agent',
  created_by    TEXT NOT NULL DEFAULT 'agent',
  tier          TEXT NOT NULL DEFAULT 'tentative',
  sensitivity   TEXT NOT NULL DEFAULT 'safe',
  syncable      INTEGER NOT NULL DEFAULT 1,
  version       INTEGER NOT NULL DEFAULT 1,
  supersedes    TEXT NOT NULL DEFAULT '',
  hash          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  flagged_modified INTEGER NOT NULL DEFAULT 0,
  deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS knowledge_hash ON knowledge(hash);
CREATE INDEX IF NOT EXISTS knowledge_title ON knowledge(title);
CREATE INDEX IF NOT EXISTS knowledge_updated ON knowledge(updated_at);

CREATE TABLE IF NOT EXISTS revisions (
  knowledge_id TEXT NOT NULL,
  version      INTEGER NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (knowledge_id, version)
);

CREATE TABLE IF NOT EXISTS tombstones (
  id         TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  path         TEXT NOT NULL,
  bytes        INTEGER NOT NULL DEFAULT 0,
  sha256       TEXT NOT NULL DEFAULT '',
  pushed       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS attachments_kb ON attachments(knowledge_id);

CREATE TABLE IF NOT EXISTS _catalog (
  table_name   TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'base',
  columns_json TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  title, body, tags, tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
  INSERT INTO knowledge_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.rowid;
  INSERT INTO knowledge_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.rowid;
END;
`

export const META_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS kb_library (
  name        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'main',
  origin_host TEXT NOT NULL DEFAULT '',
  remote_db   TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT 'plugin',
  readonly    INTEGER NOT NULL DEFAULT 0,
  syncable    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_global_entry (
  library     TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (library, table_name)
);

CREATE TABLE IF NOT EXISTS kb_queue (
  id         TEXT PRIMARY KEY,
  lib        TEXT NOT NULL,
  op         TEXT NOT NULL,
  row_id     TEXT NOT NULL DEFAULT '',
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_cursor (
  lib       TEXT PRIMARY KEY,
  pulled_at TEXT NOT NULL DEFAULT '',
  pushed_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS kb_turn (
  turn_id      TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL DEFAULT '',
  session_id   TEXT NOT NULL DEFAULT '',
  cited_ids    TEXT NOT NULL DEFAULT '[]',
  created_ids  TEXT NOT NULL DEFAULT '[]',
  uncertain_ids TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_undo (
  id         TEXT PRIMARY KEY,
  op         TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  reverted   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kb_attrib (
  session_id TEXT PRIMARY KEY,
  last_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_connection (
  id         TEXT PRIMARY KEY,
  host       TEXT NOT NULL,
  port       INTEGER NOT NULL DEFAULT 3306,
  user       TEXT NOT NULL,
  tls        INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_sync_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS kb_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_backup (
  path       TEXT PRIMARY KEY,
  covers_lib TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`
