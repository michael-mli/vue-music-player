// User store backed by Node's built-in SQLite (no native deps to compile).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

// v3 schema: v2 identities/profile fields plus lightweight session activity used
// by the admin user-details view. `session_count` counts authenticated app-session
// starts; it is intentionally not presented as listening time.
const SCHEMA_V3 = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    username TEXT UNIQUE COLLATE NOCASE,
    name TEXT,
    picture TEXT,
    avatar TEXT,
    bio TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    kind TEXT NOT NULL DEFAULT 'guest',
    created_at TEXT NOT NULL,
    last_login TEXT,
    last_seen TEXT,
    last_ip TEXT,
    last_user_agent TEXT,
    session_count INTEGER NOT NULL DEFAULT 0
  );
`

const DEFAULT_CATEGORIES = [
  ['chinese', 'Chinese', '中文'],
  ['other-language', 'Other language', '其他语言'],
  ['male-singer', 'Male singer', '男歌手'],
  ['female-singer', 'Female singer', '女歌手'],
  ['pop', 'Pop', '流行'],
  ['rock-and-roll', 'Rock & Roll', '摇滚'],
]

function initCategorySchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name_en TEXT NOT NULL,
      name_zh TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS song_categories (
      song_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      tagged_by INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (song_id, category_id),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      FOREIGN KEY (tagged_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_song_categories_category
      ON song_categories(category_id, song_id);
  `)
  const insert = db.prepare(`
    INSERT OR IGNORE INTO categories (slug, name_en, name_zh, is_default, created_at)
    VALUES (?, ?, ?, 1, ?)
  `)
  const timestamp = new Date().toISOString()
  for (const category of DEFAULT_CATEGORIES) insert.run(...category, timestamp)
}

export function initDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'auth.db')
  const db = new DatabaseSync(dbPath)

  const hasUsers = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`).get()
  if (!hasUsers) {
    db.exec(SCHEMA_V3)
    initCategorySchema(db)
    return db
  }

  let cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name)
  if (!cols.includes('username')) {
    // v1 → v3 migration (v1 rows are all Google sign-ins). Back the file up first.
    try { fs.copyFileSync(dbPath, dbPath + '.bak-v1') } catch { /* best effort */ }
    db.exec('BEGIN')
    try {
      db.exec('ALTER TABLE users RENAME TO users_v1')
      db.exec(SCHEMA_V3)
      db.exec(`
        INSERT INTO users (id, email, name, picture, role, kind, created_at, last_login)
        SELECT id, email, name, picture, role, 'google', created_at, last_login FROM users_v1
      `)
      db.exec('DROP TABLE users_v1')
      // Backfill usernames from the email local part, unique-ified.
      const rows = db.prepare('SELECT id, email FROM users').all()
      const taken = new Set()
      for (const row of rows) {
        let base = String(row.email || 'user').split('@')[0].replace(/[^A-Za-z0-9_]/g, '') || 'user'
        if (!/^[A-Za-z]/.test(base)) base = 'u' + base
        base = base.slice(0, 16)
        let candidate = base
        let n = 2
        while (taken.has(candidate.toLowerCase())) candidate = `${base}${n++}`
        taken.add(candidate.toLowerCase())
        db.prepare('UPDATE users SET username = ? WHERE id = ?').run(candidate, row.id)
      }
      db.exec('COMMIT')
      console.log('[db] migrated users table to v3 (guest, profile, and activity fields)')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name)
  }

  // v2 → v3 can be done with additive columns, preserving every existing row.
  const activityColumns = [
    ['last_seen', 'TEXT'],
    ['last_ip', 'TEXT'],
    ['last_user_agent', 'TEXT'],
    ['session_count', 'INTEGER NOT NULL DEFAULT 0'],
  ]
  let activityMigrated = false
  for (const [name, definition] of activityColumns) {
    if (cols.includes(name)) continue
    db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`)
    activityMigrated = true
  }

  // Preserve the useful history we already have. Exact session tracking starts
  // after this migration, so an account with a prior login begins at one.
  db.exec(`
    UPDATE users
    SET
      last_seen = COALESCE(last_seen, last_login, created_at),
      session_count = CASE
        WHEN COALESCE(session_count, 0) = 0 AND last_login IS NOT NULL THEN 1
        ELSE COALESCE(session_count, 0)
      END
  `)
  if (activityMigrated) {
    console.log('[db] migrated users table to v3 (activity fields)')
  }
  initCategorySchema(db)
  return db
}
