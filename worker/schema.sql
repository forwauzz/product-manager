CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS shots (
  feature TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT
);
