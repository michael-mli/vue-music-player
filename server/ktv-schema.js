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
  `)
}
