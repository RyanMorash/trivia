import type Database from 'better-sqlite3';

// Numbered migrations keyed on PRAGMA user_version. Append only — never edit
// a shipped migration.
const migrations: string[] = [
  // 1: initial schema
  `
  CREATE TABLE question_sets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    question_set_id INTEGER NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE questions (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 100,
    media_url TEXT,
    notes TEXT
  );

  CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE game_rounds (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    round_type TEXT NOT NULL,
    title TEXT NOT NULL,
    config_json TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    game_id INTEGER NOT NULL REFERENCES games(id),
    status TEXT NOT NULL DEFAULT 'lobby',
    showrunner_key TEXT NOT NULL,
    host_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE buzzer_mappings (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    buzzer_id TEXT NOT NULL,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE(session_id, buzzer_id)
  );

  CREATE TABLE score_events (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    round_index INTEGER,
    question_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE game_events (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, seq)
  );

  CREATE INDEX idx_score_events_session ON score_events(session_id);
  CREATE INDEX idx_game_events_session ON game_events(session_id, seq);
  `,
];

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    const sql = migrations[v]!;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
