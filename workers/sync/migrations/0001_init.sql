CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS identities (
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id),
  login             TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  client_label  TEXT,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  invite_code   TEXT NOT NULL UNIQUE,
  seq           INTEGER NOT NULL DEFAULT 0,
  purged_seq    INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL CHECK (role IN ('owner','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS items (
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('folder','build','comp')),
  parent_id   TEXT,
  body        TEXT,
  version     INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_by  TEXT NOT NULL REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (team_id, id)
);
CREATE INDEX IF NOT EXISTS items_team_seq ON items(team_id, seq);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id);
