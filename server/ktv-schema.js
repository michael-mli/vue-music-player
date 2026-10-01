// Additive room tables. Existing identities remain in `users`.
export function initKtvSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS ktv_output_safety (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      max_lease_ms INTEGER NOT NULL CHECK (max_lease_ms BETWEEN 8000 AND 15000),
      max_margin_ms INTEGER NOT NULL CHECK (max_margin_ms BETWEEN 500 AND 2000)
    );
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
    CREATE INDEX IF NOT EXISTS ktv_rooms_expiry ON ktv_rooms(status, expires_at);
    CREATE INDEX IF NOT EXISTS ktv_rooms_closed ON ktv_rooms(status, closed_at);
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
    CREATE TABLE IF NOT EXISTS ktv_identity_receipts (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      command_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, command_id)
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
    CREATE TABLE IF NOT EXISTS ktv_pairing_receipts (
      pairing_id TEXT NOT NULL REFERENCES ktv_pairings(id) ON DELETE CASCADE,
      command_id TEXT NOT NULL,
      grant_id TEXT NOT NULL REFERENCES ktv_device_grants(id) ON DELETE CASCADE,
      payload_hash TEXT NOT NULL,
      result_cipher TEXT NOT NULL,
      result_iv TEXT NOT NULL,
      result_tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (pairing_id, command_id)
    );
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
    CREATE TABLE IF NOT EXISTS ktv_playback (
      room_id TEXT PRIMARY KEY REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      entry_id TEXT REFERENCES ktv_queue_entries(id),
      performance_id TEXT,
      generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
      clock_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'preparing', 'scheduled', 'playing', 'paused', 'recovering')),
      position_ms REAL NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
      anchor_server_ms REAL NOT NULL DEFAULT 0,
      duration_ms REAL NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
      checkpoint_ms REAL NOT NULL DEFAULT 0 CHECK (checkpoint_ms >= 0),
      assets_json TEXT,
      pending_json TEXT,
      lyric_offset_ms INTEGER NOT NULL DEFAULT 0,
      prepare_deadline_ms REAL,
      stage_device_id TEXT,
      stage_member_id TEXT REFERENCES ktv_members(id),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ktv_turn_history (
      room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL REFERENCES ktv_queue_entries(id),
      singer_member_id TEXT NOT NULL REFERENCES ktv_members(id),
      outcome TEXT NOT NULL CHECK (outcome IN ('finished', 'skipped', 'declined')),
      round INTEGER NOT NULL CHECK (round >= 1),
      created_at TEXT NOT NULL,
      PRIMARY KEY (room_id, entry_id)
    );
  `)
  const roomColumns = db.prepare('PRAGMA table_info(ktv_rooms)').all().map(column => column.name)
  db.exec(`CREATE INDEX IF NOT EXISTS ktv_receipts_age ON ktv_command_receipts(created_at);
    CREATE INDEX IF NOT EXISTS ktv_identity_receipts_age ON ktv_identity_receipts(created_at);
    CREATE INDEX IF NOT EXISTS ktv_pairing_receipts_age ON ktv_pairing_receipts(created_at);`)
  if (!roomColumns.includes('stage_invite_visible')) {
    db.exec('ALTER TABLE ktv_rooms ADD COLUMN stage_invite_visible INTEGER NOT NULL DEFAULT 0 CHECK (stage_invite_visible IN (0, 1))')
  }
  if (!roomColumns.includes('empty_since_at')) db.exec('ALTER TABLE ktv_rooms ADD COLUMN empty_since_at TEXT')
  if (!roomColumns.includes('singer_request_limit')) db.exec('ALTER TABLE ktv_rooms ADD COLUMN singer_request_limit INTEGER CHECK (singer_request_limit BETWEEN 1 AND 10)')
  const receiptColumns = db.prepare('PRAGMA table_info(ktv_command_receipts)').all().map(column => column.name)
  for (const name of ['result_cipher', 'result_iv', 'result_tag']) if (!receiptColumns.includes(name)) {
    db.exec(`ALTER TABLE ktv_command_receipts ADD COLUMN ${name} TEXT`)
  }
  // Keep the original role/admission CHECKs and foreign keys intact. Co-host
  // capability and blocking are additive metadata on the existing membership.
  const columns = db.prepare('PRAGMA table_info(ktv_members)').all().map((column) => column.name)
  if (!columns.includes('cohost_at')) db.exec('ALTER TABLE ktv_members ADD COLUMN cohost_at TEXT')
  if (!columns.includes('blocked_at')) db.exec('ALTER TABLE ktv_members ADD COLUMN blocked_at TEXT')
  const queueColumns = db.prepare('PRAGMA table_info(ktv_queue_entries)').all().map((column) => column.name)
  if (!queueColumns.includes('host_order')) db.exec('ALTER TABLE ktv_queue_entries ADD COLUMN host_order INTEGER')
  if (!queueColumns.includes('accepted_at')) {
    db.exec(`ALTER TABLE ktv_queue_entries ADD COLUMN accepted_at TEXT;
      UPDATE ktv_queue_entries SET accepted_at = created_at WHERE requester_member_id = singer_member_id;`)
  }
  const playbackColumns = db.prepare('PRAGMA table_info(ktv_playback)').all().map(column => column.name)
  for (const [name, definition] of [
    ['guide_required', 'INTEGER NOT NULL DEFAULT 0 CHECK (guide_required IN (0, 1))'],
    ['guide_device_id', 'TEXT'],
    ['recovery_reason', 'TEXT'],
  ]) if (!playbackColumns.includes(name)) db.exec(`ALTER TABLE ktv_playback ADD COLUMN ${name} ${definition}`)
  const readinessColumns = db.prepare('PRAGMA table_info(ktv_readiness)').all().map(column => column.name)
  if (!readinessColumns.includes('advance_pending')) {
    db.exec('ALTER TABLE ktv_readiness ADD COLUMN advance_pending INTEGER NOT NULL DEFAULT 0 CHECK (advance_pending IN (0, 1))')
  }
}
