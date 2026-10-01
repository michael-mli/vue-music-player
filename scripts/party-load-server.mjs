// Owned subprocess for party-load.test.mjs. No production paths or credentials.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from '../server/node_modules/express/index.js'
import { initDb } from '../server/db.js'
import { registerKtvRoutes } from '../server/ktv-routes.js'

if (!process.send) throw new Error('Run this fixture through test:party:load')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-load-server-'))
const db = initDb(root)
const now = new Date().toISOString()
for (let id = 1; id <= 21; id++) db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(`load-${id}`, now)
const app = express()
app.use(express.json())
const authMiddleware = (req, res, next) => {
  const id = Number(req.headers['x-test-user'])
  if (!Number.isInteger(id) || id < 1 || id > 21) return res.sendStatus(401)
  req.auth = { sub: id }; next()
}
const realtime = registerKtvRoutes(app, { db, authMiddleware, secret: 'isolated-load-only-secret', isKaraokeSong: id => id > 0 && id <= 1000 })
const server = app.listen(0, '127.0.0.1')
realtime.attach(server)
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true; realtime.close(); server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  db.close(); await fs.rm(root, { recursive: true, force: true })
  process.exit(0)
}
process.on('disconnect', () => void stop())
process.on('SIGTERM', () => void stop())
process.on('message', async message => {
  if (message.type === 'stop') { await stop(); return }
  if (message.type !== 'measure' || stopping) return
  const roomId = message.roomId
  const memory = process.memoryUsage()
  const count = table => db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE room_id = ?`).get(roomId).total
  const sizes = await Promise.all(['auth.db', 'auth.db-wal'].map(name => fs.stat(path.join(root, name)).then(stat => stat.size).catch(() => 0)))
  process.send({ id: message.id, data: { memory, members: count('ktv_members'), queue: count('ktv_queue_entries'),
    events: count('ktv_room_events'), receipts: count('ktv_command_receipts'), foreignKeyErrors: db.prepare('PRAGMA foreign_key_check').all().length,
    dbAndWalBytes: sizes.reduce((sum, size) => sum + size, 0) } })
})
await new Promise(resolve => server.once('listening', resolve))
process.send({ type: 'ready', base: `http://127.0.0.1:${server.address().port}` })
