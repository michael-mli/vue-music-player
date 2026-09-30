// Additive room tables. Existing identities remain in `users`.
export function initKtvSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS ktv_rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      approval_required INTEGER NOT NULL DEFAULT 1 CHECK (approval_required IN (0, 1)),
      locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ktv_members (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('host', 'member')),
      cohost_at TEXT,
      blocked_at TEXT,
      admission TEXT NOT NULL CHECK (admission IN ('pending', 'admitted', 'rejected', 'removed')),
      joined_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (room_id, user_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ktv_one_host ON ktv_members(room_id) WHERE role = 'host';
    CREATE INDEX IF NOT EXISTS ktv_members_user ON ktv_members(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS ktv_members_room ON ktv_members(room_id, admission);
    CREATE TABLE IF NOT EXISTS ktv_invitations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      code_cipher TEXT NOT NULL,
      code_iv TEXT NOT NULL,
      code_tag TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ktv_invitation_room ON ktv_invitations(room_id, revoked_at);
    CREATE TABLE IF NOT EXISTS ktv_room_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      subject_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ktv_events_room ON ktv_room_events(room_id, id);
    CREATE TABLE IF NOT EXISTS ktv_queue_entries (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      song_id INTEGER NOT NULL CHECK (song_id > 0),
      title TEXT NOT NULL,
      requester_member_id TEXT NOT NULL REFERENCES ktv_members(id),
      singer_member_id TEXT NOT NULL REFERENCES ktv_members(id),
      accepted_at TEXT,
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'held', 'cancelled')),
      priority_requested INTEGER NOT NULL DEFAULT 0 CHECK (priority_requested IN (0, 1)),
      priority_approved INTEGER NOT NULL DEFAULT 0 CHECK (priority_approved IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ktv_queue_room ON ktv_queue_entries(room_id, state, created_at, id);
    CREATE TABLE IF NOT EXISTS ktv_command_receipts (
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      actor_member_id TEXT NOT NULL REFERENCES ktv_members(id),
      command_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (room_id, actor_member_id, command_id)
    );
    CREATE TABLE IF NOT EXISTS ktv_pairings (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES ktv_members(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL CHECK (scope IN ('display', 'controller')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      redeemed_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ktv_pairings_member ON ktv_pairings(room_id, member_id, expires_at);
    CREATE TABLE IF NOT EXISTS ktv_device_grants (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES ktv_members(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('display', 'controller')),
      secret_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ktv_grants_member ON ktv_device_grants(room_id, member_id, revoked_at);
    CREATE TABLE IF NOT EXISTS ktv_readiness (
      room_id TEXT PRIMARY KEY REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      entry_id TEXT REFERENCES ktv_queue_entries(id),
      performance_id TEXT,
      generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
      clock_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('idle', 'awaiting-singer', 'ready')),
      ready_at TEXT,
      updated_at TEXT NOT NULL,
      CHECK ((state = 'idle' AND entry_id IS NULL AND performance_id IS NULL) OR
        (state != 'idle' AND entry_id IS NOT NULL AND performance_id IS NOT NULL))
    );
  `)
  // Keep the original role/admission CHECKs and foreign keys intact. Co-host
  // capability and blocking are additive metadata on the existing membership.
  const columns = db.prepare('PRAGMA table_info(ktv_members)').all().map((column) => column.name)
  if (!columns.includes('cohost_at')) db.exec('ALTER TABLE ktv_members ADD COLUMN cohost_at TEXT')
  if (!columns.includes('blocked_at')) db.exec('ALTER TABLE ktv_members ADD COLUMN blocked_at TEXT')
  const queueColumns = db.prepare('PRAGMA table_info(ktv_queue_entries)').all().map((column) => column.name)
  if (!queueColumns.includes('accepted_at')) {
    db.exec(`ALTER TABLE ktv_queue_entries ADD COLUMN accepted_at TEXT;
      UPDATE ktv_queue_entries SET accepted_at = created_at WHERE requester_member_id = singer_member_id;`)
  }
}
