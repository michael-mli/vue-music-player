// User store backed by Node's built-in SQLite (no native deps to compile).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

// v2 schema: guests (kind='guest', email NULL) + profile fields. `username` is the
// public handle — unique, case-insensitive, server-generated for guests.
const SCHEMA_V2 = `
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
    last_login TEXT
  );
`

export function initDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'auth.db')
  const db = new DatabaseSync(dbPath)

  const hasUsers = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`).get()
  if (!hasUsers) {
    db.exec(SCHEMA_V2)
    return db
  }

  const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name)
  if (!cols.includes('username')) {
    // v1 → v2 migration (v1 rows are all Google sign-ins). Back the file up first.
    try { fs.copyFileSync(dbPath, dbPath + '.bak-v1') } catch { /* best effort */ }
    db.exec('BEGIN')
    try {
      db.exec('ALTER TABLE users RENAME TO users_v1')
      db.exec(SCHEMA_V2)
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
      console.log('[db] migrated users table to v2 (guest + profile fields)')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}
