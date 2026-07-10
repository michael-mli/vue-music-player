// Karaoke backend — Phase 1: Google Sign-In + roles + JWT sessions.
// nginx proxies /api → this service. Admin ingest + user management land in later phases.
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { spawn } from 'node:child_process'
import { OAuth2Client } from 'google-auth-library'
import { initDb } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// override:true so a restart always reflects the current .env.server (pm2 may carry a
// stale env snapshot from an earlier start).
dotenv.config({ path: path.join(__dirname, '..', '.env.server'), override: true })

const {
  GOOGLE_CLIENT_ID,
  JWT_SECRET,
  PORT = '3101',
  ADMIN_EMAILS = '',
  DATA_DIR = '/var/www/html/others/music/_auth',
  SESSION_TTL_HOURS = '168',
  REPO_DIR = '/home/mli/others/vue-music-player',
  WEB_ROOT = '/var/www/html/others/music',
} = process.env

const configOk = Boolean(GOOGLE_CLIENT_ID && JWT_SECRET)
if (!configOk) {
  console.warn('[auth] WARNING: GOOGLE_CLIENT_ID / JWT_SECRET missing — auth endpoints will 503 until .env.server is filled in')
}

const adminEmails = new Set(
  ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
)
const db = initDb(DATA_DIR)
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

const app = express()
// Bumped limit: profile avatars travel as small base64 data URLs (~≤150KB)
app.use(express.json({ limit: '300kb' }))
app.use(cors({ origin: true }))

const now = () => new Date().toISOString()
const publicUser = (u) => ({
  id: u.id, email: u.email, username: u.username, name: u.name, picture: u.picture,
  avatar: u.avatar, bio: u.bio, role: u.role, kind: u.kind,
})

// Guests get a long-lived token — it IS their identity; expiring it would orphan them.
function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: user.kind === 'guest' ? '3650d' : `${SESSION_TTL_HOURS}h`,
  })
}

// ─── Guest identities ────────────────────────────────────────────────────────
const GUEST_NAMES = [
  'Oliver', 'Emma', 'Liam', 'Sophia', 'Noah', 'Ava', 'Ethan', 'Mia', 'Lucas', 'Luna',
  'Mason', 'Chloe', 'Henry', 'Grace', 'Leo', 'Zoe', 'Jack', 'Lily', 'Owen', 'Ruby',
  'Felix', 'Ivy', 'Oscar', 'Nora', 'Max', 'Stella', 'Miles', 'Hazel', 'Jasper', 'Violet',
  'Hugo', 'Daisy', 'Arthur', 'Willow', 'Theo', 'Aurora', 'Finn', 'Penny', 'Reuben', 'Iris',
]

function generateUsername() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const base = GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]
    const candidate = attempt === 0 && Math.random() < 0.3
      ? base
      : `${base}${Math.floor(Math.random() * 900) + 100}`
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)
    if (!exists) return candidate
  }
  return `Guest${Date.now() % 1000000}`
}

// Light abuse guard on open guest creation: per-IP daily cap.
const guestHits = new Map()
function guestRateOk(ip) {
  const day = new Date().toISOString().slice(0, 10)
  const entry = guestHits.get(ip)
  if (!entry || entry.day !== day) { guestHits.set(ip, { day, count: 1 }); return true }
  entry.count++
  return entry.count <= 30
}

// Reads a Bearer token if present without rejecting the request.
function optionalAuth(req) {
  const h = req.headers.authorization || ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!t) return null
  try { return jwt.verify(t, JWT_SECRET) } catch { return null }
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ success: false, message: 'no token' })
  try {
    req.auth = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ success: false, message: 'invalid token' })
  }
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ success: false, message: 'admin only' })
  next()
}

// ─── Shared-song link previews ───────────────────────────────────────────────
// Chat apps (WeChat/WhatsApp/etc.) read the raw HTML without running JS, so the SPA's
// dynamic tab title never reaches them. nginx routes /music here; we serve the deployed
// index.html with the <title> and og: tags rewritten for the shared song, so previews
// show "song — note" while browsers still boot the exact same app.
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

let songMetaCache = { mtime: 0, songs: {} }
function songTitle(id) {
  try {
    const p = path.join(WEB_ROOT, 'metadata.json')
    const mtime = fs.statSync(p).mtimeMs
    if (mtime !== songMetaCache.mtime) {
      songMetaCache = { mtime, songs: JSON.parse(fs.readFileSync(p, 'utf8')).songs || {} }
    }
    return songMetaCache.songs[String(id)]?.title || null
  } catch {
    return null
  }
}

app.get(['/music', '/music/'], (req, res) => {
  let html
  try {
    html = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8')
  } catch {
    return res.status(404).send('not found')
  }
  const id = parseInt(req.query.song, 10)
  if (Number.isInteger(id) && id > 0 && id < 100000) {
    const note = typeof req.query.note === 'string' ? req.query.note.slice(0, 200).trim() : ''
    const host = req.headers.host || 'music.micstec.com'
    const title = songTitle(id) || `Song ${id}`
    const label = note ? `${title} — ${note}` : title
    const url = `https://${host}/music/?song=${id}${note ? `&note=${encodeURIComponent(note)}` : ''}`
    const tags = [
      `<meta property="og:title" content="${escapeHtml(label)}">`,
      `<meta property="og:description" content="${escapeHtml(note || "Listen on Mic's Music Player")}">`,
      `<meta property="og:type" content="music.song">`,
      `<meta property="og:url" content="${escapeHtml(url)}">`,
      `<meta property="og:image" content="https://${escapeHtml(host)}/poster/link.${id}.jpg">`,
      `<meta name="twitter:card" content="summary">`,
    ].join('\n    ')
    html = html.replace(
      /<title>.*?<\/title>/,
      `<title>${escapeHtml(label)} | Mic's Music Player</title>\n    ${tags}`,
    )
  }
  res.setHeader('Cache-Control', 'no-cache')
  res.type('html').send(html)
})

app.get('/api/health', (req, res) =>
  res.json({ success: true, data: { ok: true, configOk, users: db.prepare('SELECT COUNT(*) c FROM users').get().c, ts: now() } }),
)

// Create a guest identity: server-generated unique English username, long-lived token.
// Idempotent for callers that already carry a valid token.
app.post('/api/auth/guest', (req, res) => {
  if (!JWT_SECRET) return res.status(503).json({ success: false, message: 'auth not configured' })
  const existing = optionalAuth(req)
  if (existing) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.sub)
    if (u) return res.json({ success: true, data: { token: signToken(u), user: publicUser(u) } })
  }
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown'
  if (!guestRateOk(String(ip))) return res.status(429).json({ success: false, message: 'too many guest accounts' })
  const username = generateUsername()
  const info = db
    .prepare("INSERT INTO users (username, role, kind, created_at, last_login) VALUES (?, 'user', 'guest', ?, ?)")
    .run(username, now(), now())
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  res.json({ success: true, data: { token: signToken(user), user: publicUser(user) } })
})

// Verify a Google ID token (from Google Identity Services), upsert the user, return a JWT.
// When the caller carries a guest token, the guest row is upgraded in place (keeps id,
// username, avatar, bio) so the identity "becomes" registered.
app.post('/api/auth/google', async (req, res) => {
  if (!configOk) return res.status(503).json({ success: false, message: 'auth not configured' })
  const { credential } = req.body || {}
  if (!credential) return res.status(400).json({ success: false, message: 'missing credential' })
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID })
    const p = ticket.getPayload()
    const email = (p.email || '').toLowerCase()
    if (!email || !p.email_verified) {
      return res.status(401).json({ success: false, message: 'unverified google account' })
    }
    const caller = optionalAuth(req)
    const guest = caller
      ? db.prepare("SELECT * FROM users WHERE id = ? AND kind = 'guest'").get(caller.sub)
      : null

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!user && guest) {
      // Register: attach the Google account to the existing guest identity.
      const role = adminEmails.has(email) ? 'admin' : guest.role
      db.prepare("UPDATE users SET email = ?, name = ?, picture = ?, role = ?, kind = 'google', last_login = ? WHERE id = ?")
        .run(email, p.name || guest.name || '', p.picture || '', role, now(), guest.id)
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(guest.id)
    } else if (!user) {
      const role = adminEmails.has(email) ? 'admin' : 'user'
      const username = generateUsername()
      const info = db
        .prepare("INSERT INTO users (email, username, name, picture, role, kind, created_at, last_login) VALUES (?,?,?,?,?,'google',?,?)")
        .run(email, username, p.name || '', p.picture || '', role, now(), now())
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
    } else {
      db.prepare('UPDATE users SET name = ?, picture = ?, last_login = ? WHERE id = ?').run(
        p.name || user.name, p.picture || user.picture, now(), user.id,
      )
      // Bootstrap admins always keep admin.
      if (adminEmails.has(email) && user.role !== 'admin') {
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', user.id)
        user.role = 'admin'
      }
      // The Google account already exists — drop the now-orphaned guest row.
      if (guest && guest.id !== user.id) {
        db.prepare("DELETE FROM users WHERE id = ? AND kind = 'guest'").run(guest.id)
      }
    }
    res.json({ success: true, data: { token: signToken(user), user: publicUser(user) } })
  } catch {
    res.status(401).json({ success: false, message: 'google verification failed' })
  }
})

// ─── Self-service profile ────────────────────────────────────────────────────
app.patch('/api/profile', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub)
  if (!u) return res.status(401).json({ success: false, message: 'user gone' })
  const { username, name, bio, avatar } = req.body || {}

  if (username !== undefined) {
    if (typeof username !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username)) {
      return res.status(400).json({ success: false, message: 'username: 3-20 chars, letters/digits/_, starts with a letter' })
    }
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, u.id)
    if (clash) return res.status(409).json({ success: false, message: 'username already taken' })
  }
  if (name !== undefined && (typeof name !== 'string' || name.length > 60)) {
    return res.status(400).json({ success: false, message: 'name too long (max 60)' })
  }
  if (bio !== undefined && (typeof bio !== 'string' || bio.length > 300)) {
    return res.status(400).json({ success: false, message: 'bio too long (max 300)' })
  }
  if (avatar !== undefined && avatar !== '' &&
      (typeof avatar !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(avatar) || avatar.length > 150000)) {
    return res.status(400).json({ success: false, message: 'avatar must be a small png/jpeg/webp image' })
  }

  db.prepare('UPDATE users SET username = ?, name = ?, bio = ?, avatar = ? WHERE id = ?').run(
    username !== undefined ? username : u.username,
    name !== undefined ? name : u.name,
    bio !== undefined ? bio : u.bio,
    avatar !== undefined ? avatar : u.avatar,
    u.id,
  )
  res.json({ success: true, data: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) })
})

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub)
  if (!u) return res.status(401).json({ success: false, message: 'user gone' })
  res.json({ success: true, data: publicUser(u) })
})

// Stateless JWT — logout is client-side (drop the token). Endpoint kept for symmetry.
app.post('/api/auth/logout', (req, res) => res.json({ success: true, data: {} }))

// ─── Admin: batch jobs (ingest Phase 2, metadata) ───────────────────────────
// In-memory job registry (ephemeral; restart clears history).
const jobs = new Map()
let jobSeq = 0

// Validate request ids — only positive integers, capped, deduped. No shell strings.
function parseIds(body, max) {
  const raw = Array.isArray(body?.ids) ? body.ids : []
  const ids = [...new Set(raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0 && n < 100000))]
  if (ids.length > max) return null
  return ids
}

// Spawn a repo script and stream its output into the job log.
// Args are passed as an array (no shell) → the ids can't inject shell.
function startJob(kind, argv, ids, email) {
  const jobId = `job-${++jobSeq}`
  const job = { id: jobId, kind, ids, running: true, log: [], startedAt: now(), exitCode: null, by: email }
  jobs.set(jobId, job)

  const child = spawn('bash', argv, { cwd: REPO_DIR, env: process.env })
  const push = (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line) { job.log.push(line); if (job.log.length > 2000) job.log.shift() }
    }
  }
  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('close', (code) => { job.running = false; job.exitCode = code })
  child.on('error', (e) => { job.running = false; job.exitCode = -1; job.log.push(`spawn error: ${e.message}`) })
  return jobId
}

function jobStatus(req, res) {
  const job = jobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ success: false, message: 'no such job' })
  res.json({ success: true, data: { running: job.running, exitCode: job.exitCode, ids: job.ids, log: job.log } })
}

app.post('/api/admin/ingest', authMiddleware, requireAdmin, (req, res) => {
  const ids = parseIds(req.body, 200)
  if (!ids) return res.status(400).json({ success: false, message: 'too many ids (max 200)' })
  if (!ids.length) return res.status(400).json({ success: false, message: 'provide 1..N numeric song ids' })
  const jobId = startJob('ingest', ['scripts/karaoke/ingest.sh', ...ids.map(String)], ids, req.auth.email)
  res.json({ success: true, data: { jobId, ids } })
})

// Build song metadata (artist/album/year/genre) → data/metadata.json.
// Empty ids = process every song still missing metadata.
app.post('/api/admin/metadata', authMiddleware, requireAdmin, (req, res) => {
  const ids = parseIds(req.body, 500)
  if (!ids) return res.status(400).json({ success: false, message: 'too many ids (max 500)' })
  const argv = ids.length ? ['scripts/metadata.sh', ...ids.map(String)] : ['scripts/metadata.sh', '--auto']
  const jobId = startJob('metadata', argv, ids, req.auth.email)
  res.json({ success: true, data: { jobId, ids } })
})

app.get('/api/admin/ingest/:jobId', authMiddleware, requireAdmin, jobStatus)
app.get('/api/admin/jobs/:jobId', authMiddleware, requireAdmin, jobStatus)

// ─── Admin: user management (Phase 3) ────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, email, username, name, picture, avatar, role, kind, created_at, last_login FROM users ORDER BY id').all()
  res.json({ success: true, data: rows })
})

app.patch('/api/admin/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const role = req.body?.role
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ success: false, message: 'role must be admin|user' })
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!target) return res.status(404).json({ success: false, message: 'no such user' })
  // Guard against removing the last admin (or self-demotion causing lockout).
  if (target.role === 'admin' && role === 'user') {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c
    if (admins <= 1) return res.status(400).json({ success: false, message: 'cannot demote the last admin' })
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
  res.json({ success: true, data: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) })
})

app.delete('/api/admin/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  if (id === req.auth.sub) return res.status(400).json({ success: false, message: 'cannot delete yourself' })
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!target) return res.status(404).json({ success: false, message: 'no such user' })
  if (target.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c
    if (admins <= 1) return res.status(400).json({ success: false, message: 'cannot delete the last admin' })
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  res.json({ success: true, data: { id } })
})

app.listen(Number(PORT), '127.0.0.1', () => console.log(`[auth] listening on 127.0.0.1:${PORT}`))
