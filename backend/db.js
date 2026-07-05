// db.js — SQLite database setup and schema.
// This version uses the `sqlite3` CLI so the app runs in containers without
// relying on Node's built-in SQLite support.

const { execFileSync } = require('node:child_process');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'oncall.db');

function escapeSqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function bindSql(sql, params = []) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    if (index >= params.length) {
      throw new Error(`Missing SQL parameter ${index + 1}`);
    }
    return escapeSqlValue(params[index++]);
  });
}

function runSqlBatch(sql, asJson = false) {
  const input = asJson ? `.mode json\n${sql}\n` : `${sql}\n`;
  try {
    return execFileSync('sqlite3', asJson ? ['-json', DB_PATH] : [DB_PATH], {
      input,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (asJson) {
      return execFileSync('sqlite3', [DB_PATH], {
        input: `.mode json\n${sql}\n`,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
    }
    throw error;
  }
}

function parseJsonRows(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed);
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('MEMBER','SCHEDULER','TEAM_ADMIN')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, team_id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  on_call_date TEXT NOT NULL,
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('AUTO_WEEKEND','AUTO_WEEKDAY','MANUAL')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(team_id, user_id, on_call_date)
);

CREATE TABLE IF NOT EXISTS schedule_generation_runs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  triggered_by TEXT REFERENCES users(id),
  random_seed TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED','PARTIAL')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS excel_exports (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  file_path TEXT NOT NULL,
  generated_by TEXT REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const db = {
  exec(sql) {
    runSqlBatch(sql, false);
  },
  prepare(sql) {
    return {
      run(...params) {
        const statement = bindSql(sql, params);
        const output = runSqlBatch(
          `BEGIN;
${statement};
SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid;
COMMIT;`,
          true
        );
        const rows = parseJsonRows(output);
        return rows[rows.length - 1] || { changes: 0, lastInsertRowid: 0 };
      },
      get(...params) {
        const statement = bindSql(sql, params);
        const rows = parseJsonRows(runSqlBatch(statement, true));
        return rows[0];
      },
      all(...params) {
        const statement = bindSql(sql, params);
        return parseJsonRows(runSqlBatch(statement, true));
      },
    };
  },
  transaction(fn) {
    return (...args) => fn(...args);
  },
};

db.exec(schema);

module.exports = db;
