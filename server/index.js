// Karaoke backend — Phase 1: Google Sign-In + roles + JWT sessions.
// nginx proxies /api → this service. Admin ingest + user management land in later phases.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
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
app.use(express.json())
app.use(cors({ origin: true }))

const now = () => new Date().toISOString()
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, picture: u.picture, role: u.role })

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: `${SESSION_TTL_HOURS}h`,
  })
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

// eslint-disable-next-line no-unused-vars -- used by later phases (admin routes)
function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') return res.status(403).json({ success: false, message: 'admin only' })
  next()
}

app.get('/api/health', (req, res) =>
  res.json({ success: true, data: { ok: true, configOk, users: db.prepare('SELECT COUNT(*) c FROM users').get().c, ts: now() } }),
)

// Verify a Google ID token (from Google Identity Services), upsert the user, return a JWT.
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
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (!user) {
      const role = adminEmails.has(email) ? 'admin' : 'user'
      const info = db
        .prepare('INSERT INTO users (email, name, picture, role, created_at, last_login) VALUES (?,?,?,?,?,?)')
        .run(email, p.name || '', p.picture || '', role, now(), now())
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
    }
    res.json({ success: true, data: { token: signToken(user), user: publicUser(user) } })
  } catch {
    res.status(401).json({ success: false, message: 'google verification failed' })
  }
})

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub)
  if (!u) return res.status(401).json({ success: false, message: 'user gone' })
  res.json({ success: true, data: publicUser(u) })
})

// Stateless JWT — logout is client-side (drop the token). Endpoint kept for symmetry.
app.post('/api/auth/logout', (req, res) => res.json({ success: true, data: {} }))

app.listen(Number(PORT), '127.0.0.1', () => console.log(`[auth] listening on 127.0.0.1:${PORT}`))
