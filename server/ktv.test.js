import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { initDb } from './db.js'
import { registerKtvRoutes } from './ktv-routes.js'

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-test-'))
  const db = initDb(dir)
  for (const username of ['host', 'alex1', 'alex2', 'outsider']) {
    db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)")
      .run(username, new Date().toISOString())
  }
  const app = express()
  app.use(express.json())
  const authMiddleware = (req, res, next) => {
    const id = Number(req.headers['x-test-user'])
    if (!Number.isInteger(id) || !id) return res.sendStatus(401)
    req.auth = { sub: id }
    next()
  }
  registerKtvRoutes(app, { db, authMiddleware, secret: 'test-only-secret' })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/ktv`
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  async function request(method, route, actor, payload) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Test-User': String(actor) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  return { db, request }
}

test('invited guests enter names, retain random IDs, and wait for host approval', async (t) => {
  const { db, request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Friday songs', displayName: 'Host' })
  assert.equal(created.status, 200)
  assert.equal(created.headers.get('cache-control'), 'no-store')
  const { room, invitationCode, self } = created.body.data
  assert.match(room.id, /^[0-9a-f-]{36}$/)
  assert.match(self.id, /^[0-9a-f-]{36}$/)
  assert.equal(self.role, 'host')
  assert.match(invitationCode, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.equal(await request('GET', `/rooms/${room.id}`, 4).then((r) => r.status), 403)

  const blank = await request('POST', '/join', 2, { code: invitationCode, displayName: '  ' })
  assert.equal(blank.status, 400)
  const first = await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  assert.equal(first.status, 200)
  assert.equal(first.body.data.self.admission, 'pending')
  assert.equal(first.body.data.members, undefined)
  assert.equal(first.body.data.invitationCode, undefined)
  const memberId = first.body.data.self.id
  const repeated = await request('POST', '/join', 2, { code: invitationCode })
  assert.equal(repeated.body.data.self.id, memberId)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_members WHERE room_id = ?').get(room.id).total, 2)

  const second = await request('POST', '/join', 3, { code: invitationCode, displayName: 'Alex' })
  assert.equal(second.status, 200)
  assert.notEqual(second.body.data.self.id, memberId)
  const waiting = await request('GET', `/rooms/${room.id}`, 2)
  assert.equal(waiting.body.data.members, undefined)
  const hostView = await request('GET', `/rooms/${room.id}`, 1)
  assert.equal(hostView.body.data.members.filter((m) => m.admission === 'pending').length, 2)

  const forbidden = await request('POST', `/rooms/${room.id}/members/${memberId}/approve`, 3)
  assert.equal(forbidden.status, 403)
  const approved = await request('POST', `/rooms/${room.id}/members/${memberId}/approve`, 1)
  assert.equal(approved.status, 200)
  const admitted = await request('GET', `/rooms/${room.id}`, 2)
  assert.equal(admitted.body.data.self.id, memberId)
  assert.equal(admitted.body.data.members.length, 2)
  assert.equal(admitted.body.data.invitationCode, undefined)
  assert.equal(admitted.body.data.members.some((m) => m.admission === 'pending'), false)

  const removed = await request('POST', `/rooms/${room.id}/members/${memberId}/remove`, 1)
  assert.equal(removed.status, 200)
  assert.equal(await request('GET', `/rooms/${room.id}`, 2).then((r) => r.status), 403)
  assert.equal(await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' }).then((r) => r.status), 403)
})

test('host can rotate invitations, lock joining, and close the room', async (t) => {
  const { request } = await setup(t)
  const created = await request('POST', '/rooms', 1, {
    name: 'Open stage', displayName: 'Host', approvalRequired: false,
  })
  const { room, invitationCode } = created.body.data
  const joined = await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  assert.equal(joined.body.data.self.admission, 'admitted')
  assert.equal(await request('POST', `/rooms/${room.id}/settings`, 2, { locked: true }).then((r) => r.status), 403)
  const locked = await request('POST', `/rooms/${room.id}/settings`, 1, { locked: true })
  assert.equal(locked.body.data.room.locked, true)
  assert.equal(await request('POST', '/join', 3, { code: invitationCode, displayName: 'Alex' }).then((r) => r.status), 403)
  const unlocked = await request('POST', `/rooms/${room.id}/settings`, 1, { locked: false })
  assert.equal(unlocked.body.data.room.locked, false)

  const rotated = await request('POST', `/rooms/${room.id}/invitations/rotate`, 1)
  const newCode = rotated.body.data.invitationCode
  assert.notEqual(newCode, invitationCode)
  assert.equal(await request('POST', '/join', 3, { code: invitationCode, displayName: 'Alex' }).then((r) => r.status), 400)
  assert.equal(await request('POST', '/join', 3, { code: newCode, displayName: 'Alex' }).then((r) => r.status), 200)

  const closed = await request('POST', `/rooms/${room.id}/close`, 1)
  assert.equal(closed.body.data.status, 'closed')
  assert.equal(await request('GET', `/rooms/${room.id}`, 1).then((r) => r.status), 410)
  assert.equal(await request('POST', '/join', 4, { code: newCode, displayName: 'Guest' }).then((r) => r.status), 400)
})

test('room schema is additive and persists after reopening the database', async (t) => {
  const { db, request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Persisted', displayName: 'Host' })
  const roomId = created.body.data.room.id
  const dbPath = db.prepare('PRAGMA database_list').all()[0].file
  const reopened = initDb(path.dirname(dbPath))
  t.after(() => reopened.close())
  assert.equal(reopened.prepare('SELECT name FROM ktv_rooms WHERE id = ?').get(roomId).name, 'Persisted')
  assert.equal(reopened.prepare('SELECT COUNT(*) count FROM users').get().count, 4)
})
