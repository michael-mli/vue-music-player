import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import express from 'express'
import WebSocket from 'ws'
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
  const realtime = registerKtvRoutes(app, { db, authMiddleware, secret: 'test-only-secret', isKaraokeSong: (id) => id <= 10 })
  const server = app.listen(0, '127.0.0.1')
  realtime.attach(server)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/ktv`
  t.after(async () => {
    realtime.close()
    await new Promise((resolve) => server.close(resolve))
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  async function request(method, route, actor, payload) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(typeof actor === 'object'
        ? { Authorization: `KtvDevice ${actor.device}` }
        : { 'X-Test-User': String(actor) }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  return { db, request, socketUrl: `ws://127.0.0.1:${server.address().port}/api/ktv/ws`, origin: `http://127.0.0.1:${server.address().port}` }
}

function nextSnapshot(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('snapshot timeout')) }, 3000)
    function cleanup() { clearTimeout(timeout); ws.off('message', onMessage); ws.off('close', onClose) }
    function onMessage(raw) {
      const message = JSON.parse(raw.toString())
      if (message.type !== 'snapshot') return
      cleanup()
      resolve(message.data)
    }
    function onClose(code) { cleanup(); reject(new Error(`socket closed ${code}`)) }
    ws.on('message', onMessage)
    ws.on('close', onClose)
  })
}

async function openSocket(url, origin, ticket) {
  const ws = new WebSocket(url, { origin })
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const first = nextSnapshot(ws)
  ws.send(JSON.stringify({ type: 'authenticate', ticket }))
  return { ws, first }
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

test('queue requests survive retries, rotate singers fairly, and require host priority approval', async (t) => {
  const { db, request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Queue room', displayName: 'Host', approvalRequired: false })
  const { room, invitationCode } = created.body.data
  const alex = (await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })).body.data.self
  const sam = (await request('POST', '/join', 3, { code: invitationCode, displayName: 'Sam' })).body.data.self
  const queuePath = `/rooms/${room.id}/queue`
  async function add(actor, songId, requestNext = false, commandId = randomUUID()) {
    return request('POST', queuePath, actor, { songId, title: `Track ${songId}`, requestNext, commandId })
  }
  const commandId = randomUUID()
  const first = await add(2, 1, false, commandId)
  assert.equal(first.status, 200)
  assert.equal(first.body.data.queue.length, 1)
  const same = await add(2, 1, false, commandId)
  assert.equal(same.status, 200)
  assert.equal(same.body.data.queue.length, 1)
  assert.equal(await add(2, 2, false, commandId).then((r) => r.status), 409)
  assert.equal(await add(4, 2).then((r) => r.status), 403)
  assert.equal(await add(2, 99).then((r) => r.status), 409)
  const secondAlex = await add(2, 2)
  assert.equal(secondAlex.status, 200)
  const firstSam = await add(3, 3, true)
  assert.equal(firstSam.status, 200)
  const thirdAlex = await add(2, 4)
  assert.equal(thirdAlex.status, 200)
  assert.equal(await add(2, 5).then((r) => r.status), 409)
  let queue = (await request('GET', `/rooms/${room.id}`, 1)).body.data.queue
  assert.deepEqual(queue.map((entry) => entry.songId), [1, 3, 2, 4])
  assert.equal(queue[1].priorityRequested, true)
  assert.equal(queue[1].priorityApproved, false)
  assert.equal(queue[1].singerMemberId, sam.id)
  assert.equal(queue[0].singerMemberId, alex.id)
  const priorityPath = `${queuePath}/${queue[1].id}/approve-next`
  assert.equal(await request('POST', priorityPath, 2, { commandId: randomUUID() }).then((r) => r.status), 403)
  const approveId = randomUUID()
  assert.equal(await request('POST', priorityPath, 1, { commandId: approveId }).then((r) => r.status), 200)
  assert.equal(await request('POST', priorityPath, 1, { commandId: approveId }).then((r) => r.status), 200)
  queue = (await request('GET', `/rooms/${room.id}`, 2)).body.data.queue
  assert.deepEqual(queue.map((entry) => entry.songId), [3, 1, 2, 4])
  assert.equal(await request('POST', `${queuePath}/${queue[1].id}/cancel`, 3, { commandId: randomUUID() }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${queuePath}/${queue[1].id}/cancel`, 2, { commandId: randomUUID() }).then((r) => r.status), 200)
  const left = (await request('POST', `/rooms/${room.id}/members/${sam.id}/remove`, 1)).body.data
  assert.equal(left.queue.at(-1).songId, 3)
  assert.equal(left.queue.at(-1).state, 'held')
  assert.equal(await request('GET', `/rooms/${room.id}`, 3).then((r) => r.status), 403)
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM ktv_queue_entries WHERE room_id = ? AND state = 'queued'").get(room.id).total, 2)
})

test('simultaneous same-song requests create distinct durable entries', async (t) => {
  const { db, request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Two singers', displayName: 'Host', approvalRequired: false })
  const { room, invitationCode } = created.body.data
  await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  await request('POST', '/join', 3, { code: invitationCode, displayName: 'Sam' })
  const queuePath = `/rooms/${room.id}/queue`
  const [first, second] = await Promise.all([2, 3].map((actor) =>
    request('POST', queuePath, actor, { songId: 1, title: 'Same song', requestNext: false, commandId: randomUUID() }),
  ))
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  const queue = (await request('GET', `/rooms/${room.id}`, 1)).body.data.queue
  assert.equal(queue.length, 2)
  assert.notEqual(queue[0].id, queue[1].id)
  assert.notEqual(queue[0].singerMemberId, queue[1].singerMemberId)
  const dbPath = db.prepare('PRAGMA database_list').all()[0].file
  const reopened = initDb(path.dirname(dbPath))
  t.after(() => reopened.close())
  assert.equal(reopened.prepare('SELECT COUNT(*) AS total FROM ktv_queue_entries WHERE room_id = ?').get(room.id).total, 2)
  assert.equal(reopened.prepare('SELECT COUNT(*) AS total FROM ktv_command_receipts WHERE room_id = ?').get(room.id).total, 2)
})

test('room sockets use one-use tickets, redact pending views, broadcast changes and revoke removal', async (t) => {
  const { request, socketUrl, origin } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Live room', displayName: 'Host' })
  const { room, invitationCode } = created.body.data
  const joined = await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  const memberId = joined.body.data.self.id
  assert.equal(await request('POST', `/rooms/${room.id}/socket-ticket`, 4, {}).then((r) => r.status), 403)
  const hostTicket = (await request('POST', `/rooms/${room.id}/socket-ticket`, 1, {})).body.data.ticket
  const guestTicket = (await request('POST', `/rooms/${room.id}/socket-ticket`, 2, {})).body.data.ticket
  const host = await openSocket(socketUrl, origin, hostTicket)
  let guest = await openSocket(socketUrl, origin, guestTicket)
  assert.equal((await host.first).invitationCode, invitationCode)
  const pending = await guest.first
  assert.equal(pending.self.admission, 'pending')
  assert.equal(pending.members, undefined)
  assert.equal(pending.queue, undefined)
  const reused = new WebSocket(socketUrl, { origin })
  await new Promise((resolve, reject) => { reused.once('open', resolve); reused.once('error', reject) })
  const denied = new Promise((resolve) => reused.once('close', resolve))
  reused.send(JSON.stringify({ type: 'authenticate', ticket: guestTicket }))
  assert.equal(await denied, 4401)

  const hostApproval = nextSnapshot(host.ws)
  const guestApproval = nextSnapshot(guest.ws)
  const approved = await request('POST', `/rooms/${room.id}/members/${memberId}/approve`, 1, {})
  assert.equal(approved.status, 200)
  assert.equal((await hostApproval).members.length, 2)
  assert.equal((await guestApproval).self.admission, 'admitted')

  guest.ws.terminate()
  const reconnectTicket = (await request('POST', `/rooms/${room.id}/socket-ticket`, 2, {})).body.data.ticket
  guest = await openSocket(socketUrl, origin, reconnectTicket)
  assert.equal((await guest.first).members.length, 2)

  const hostQueue = nextSnapshot(host.ws)
  const guestQueue = nextSnapshot(guest.ws)
  const song = await request('POST', `/rooms/${room.id}/queue`, 2, {
    songId: 1, title: 'Live song', requestNext: false, commandId: randomUUID(),
  })
  assert.equal(song.status, 200)
  assert.equal((await hostQueue).queue[0].title, 'Live song')
  assert.equal((await guestQueue).queue[0].title, 'Live song')

  const removedClose = new Promise((resolve) => guest.ws.once('close', resolve))
  const hostRemoval = nextSnapshot(host.ws)
  await request('POST', `/rooms/${room.id}/members/${memberId}/remove`, 1, {})
  assert.equal(await removedClose, 4403)
  assert.equal((await hostRemoval).members.length, 1)
  assert.equal(await request('POST', `/rooms/${room.id}/socket-ticket`, 2, {}).then((r) => r.status), 403)

  const hostClosed = new Promise((resolve) => host.ws.once('close', resolve))
  await request('POST', `/rooms/${room.id}/close`, 1, {})
  assert.equal(await hostClosed, 4410)
})

test('room socket rejects an untrusted browser origin before authentication', async (t) => {
  const { socketUrl } = await setup(t)
  const edgeOrigin = new WebSocket(socketUrl, { origin: socketUrl.replace('ws:', 'https:').replace('/api/ktv/ws', '') })
  await new Promise((resolve, reject) => { edgeOrigin.once('open', resolve); edgeOrigin.once('error', reject) })
  edgeOrigin.close()
  const ws = new WebSocket(socketUrl, { origin: 'https://untrusted.example' })
  ws.on('error', () => {})
  const status = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('upgrade timeout')), 3000)
    ws.once('unexpected-response', (_, response) => {
      clearTimeout(timeout)
      response.resume()
      resolve(response.statusCode)
    })
  })
  assert.equal(status, 403)
})

test('display pairing is one-use, room-scoped, read-only, and revocable on an open socket', async (t) => {
  const { db, request, socketUrl, origin } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Paired stage', displayName: 'Host' })
  const { room, invitationCode } = created.body.data
  const issued = await request('POST', `/rooms/${room.id}/pairings`, 1, { scope: 'display' })
  assert.equal(issued.status, 200)
  const code = issued.body.data.code
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.notEqual(db.prepare('SELECT code_hash FROM ktv_pairings WHERE room_id = ?').get(room.id).code_hash, code)
  const redeemed = await request('POST', '/pairings/redeem', 4, { code })
  assert.equal(redeemed.status, 200)
  const { credential, deviceId, memberId, scope } = redeemed.body.data
  assert.equal(scope, 'display')
  assert.equal(memberId, created.body.data.self.id)
  assert.equal(await request('POST', '/pairings/redeem', 4, { code }).then((r) => r.status), 400)
  assert.notEqual(db.prepare('SELECT secret_hash FROM ktv_device_grants WHERE id = ?').get(deviceId).secret_hash, credential)
  const device = { device: credential }
  const view = await request('GET', `/rooms/${room.id}`, device)
  assert.equal(view.status, 200)
  assert.equal(view.body.data.deviceScope, 'display')
  assert.equal(view.body.data.invitationCode, undefined)
  assert.equal(view.body.data.members.length, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ktv_members WHERE room_id = ?').get(room.id).total, 1)
  assert.equal(await request('GET', `/rooms/${randomUUID()}`, device).then((r) => r.status), 403)
  assert.equal(await request('POST', `/rooms/${room.id}/queue`, device, {
    songId: 1, title: 'No', requestNext: false, commandId: randomUUID(),
  }).then((r) => r.status), 403)
  const ticket = (await request('POST', `/rooms/${room.id}/socket-ticket`, device, {})).body.data.ticket
  const pairedSocket = await openSocket(socketUrl, origin, ticket)
  const first = await pairedSocket.first
  assert.equal(first.deviceScope, 'display')
  assert.equal(first.invitationCode, undefined)
  const changed = nextSnapshot(pairedSocket.ws)
  await request('POST', `/rooms/${room.id}/settings`, 1, { locked: true })
  assert.equal((await changed).room.locked, true)
  const closed = new Promise((resolve) => pairedSocket.ws.once('close', resolve))
  await request('POST', `/rooms/${room.id}/devices/${deviceId}/revoke`, 1, {})
  assert.equal(await closed, 4403)
  assert.equal(await request('GET', `/rooms/${room.id}`, device).then((r) => r.status), 403)
  assert.equal(await request('POST', `/rooms/${room.id}/socket-ticket`, device, {}).then((r) => r.status), 403)
  assert.equal(invitationCode.length, 8)
})

test('controller pairing inherits current membership and is revoked when member leaves', async (t) => {
  const { request } = await setup(t)
  const created = await request('POST', '/rooms', 1, {
    name: 'Paired phone', displayName: 'Host', approvalRequired: false,
  })
  const { room, invitationCode } = created.body.data
  const joined = await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  const issued = await request('POST', `/rooms/${room.id}/pairings`, 2, { scope: 'controller' })
  const paired = await request('POST', '/pairings/redeem', 4, { code: issued.body.data.code })
  const device = { device: paired.body.data.credential }
  const added = await request('POST', `/rooms/${room.id}/queue`, device, {
    songId: 1, title: 'From phone', requestNext: true, commandId: randomUUID(),
  })
  assert.equal(added.status, 200)
  assert.equal(added.body.data.deviceScope, 'controller')
  assert.equal(added.body.data.queue[0].requesterMemberId, joined.body.data.self.id)
  assert.equal(await request('POST', `/rooms/${room.id}/settings`, device, { locked: true }).then((r) => r.status), 403)
  const spare = await request('POST', `/rooms/${room.id}/pairings`, 2, { scope: 'display' })
  await request('POST', `/rooms/${room.id}/members/${joined.body.data.self.id}/remove`, 1, {})
  assert.equal(await request('GET', `/rooms/${room.id}`, device).then((r) => r.status), 403)
  assert.equal(await request('POST', '/pairings/redeem', 4, { code: spare.body.data.code }).then((r) => r.status), 400)
})

test('pairing replaces pending codes and limits a membership to three devices', async (t) => {
  const { request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Device limit', displayName: 'Host' })
  const roomId = created.body.data.room.id
  const oldCode = (await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'display' })).body.data.code
  const firstCode = (await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'display' })).body.data.code
  assert.equal(await request('POST', '/pairings/redeem', 4, { code: oldCode }).then((r) => r.status), 400)
  const first = await request('POST', '/pairings/redeem', 4, { code: firstCode })
  assert.equal(first.status, 200)
  const secondCode = (await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'controller' })).body.data.code
  assert.equal(await request('POST', '/pairings/redeem', 4, { code: secondCode }).then((r) => r.status), 200)
  assert.equal(await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'display' }).then((r) => r.status), 409)
  const devices = await request('GET', `/rooms/${roomId}/devices`, 1)
  assert.equal(devices.body.data.length, 2)
  await request('POST', `/rooms/${roomId}/devices/${first.body.data.deviceId}/revoke`, 1, {})
  assert.equal(await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'display' }).then((r) => r.status), 200)
})

test('co-host permissions follow the room matrix and demotion updates paired controllers', async (t) => {
  const { request, socketUrl, origin } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Moderated room', displayName: 'Host' })).body.data
  const root = `/rooms/${created.room.id}`
  const members = {}
  for (const actor of [2, 3]) {
    members[actor] = (await request('POST', '/join', actor, { code: created.invitationCode, displayName: `Guest ${actor}` })).body.data.self.id
    await request('POST', `${root}/members/${members[actor]}/approve`, 1)
    const promoted = await request('POST', `${root}/members/${members[actor]}/role`, 1, { role: 'cohost', commandId: randomUUID() })
    assert.equal(promoted.status, 200)
    assert.equal(promoted.body.data.members.find((member) => member.id === members[actor]).role, 'cohost')
  }
  members[4] = (await request('POST', '/join', 4, { code: created.invitationCode, displayName: 'New guest' })).body.data.self.id
  const cohostView = (await request('GET', root, 2)).body.data
  assert.equal(cohostView.self.role, 'cohost')
  assert.equal(cohostView.members.find((member) => member.id === members[4]).admission, 'pending')
  assert.equal(cohostView.invitationCode, undefined)

  const code = (await request('POST', `${root}/pairings`, 2, { scope: 'controller' })).body.data.code
  const device = { device: (await request('POST', '/pairings/redeem', 4, { code })).body.data.credential }
  const displayCode = (await request('POST', `${root}/pairings`, 2, { scope: 'display' })).body.data.code
  const display = { device: (await request('POST', '/pairings/redeem', 4, { code: displayCode })).body.data.credential }
  const displayView = (await request('GET', root, display)).body.data
  assert.equal(displayView.members.length, 3)
  assert.equal(displayView.excludedMembers, undefined)
  assert.equal(displayView.invitationCode, undefined)

  assert.equal(await request('POST', `${root}/members/${members[4]}/approve`, device, { commandId: randomUUID() }).then((r) => r.status), 200)
  const song = (await request('POST', `${root}/queue`, 4, {
    songId: 1, title: 'Guest song', requestNext: true, commandId: randomUUID(),
  })).body.data.queue[0]
  assert.equal(await request('POST', `${root}/queue/${song.id}/approve-next`, device, { commandId: randomUUID() }).then((r) => r.status), 200)
  assert.equal(await request('POST', `${root}/queue/${song.id}/cancel`, 2, { commandId: randomUUID() }).then((r) => r.status), 200)
  assert.equal(await request('POST', `${root}/settings`, device, { locked: true }).then((r) => r.status), 200)
  assert.equal(await request('POST', `${root}/settings`, 4, { locked: false }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[3]}/remove`, 2).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[3]}/block`, device, { commandId: randomUUID() }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[4]}/role`, 2, { role: 'cohost', commandId: randomUUID() }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[4]}/transfer-host`, device, { commandId: randomUUID() }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/invitations/rotate`, 2).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/close`, device).then((r) => r.status), 403)

  const ticket = (await request('POST', `${root}/socket-ticket`, device, {})).body.data.ticket
  const connected = await openSocket(socketUrl, origin, ticket)
  assert.equal((await connected.first).self.role, 'cohost')
  const demoted = nextSnapshot(connected.ws)
  await request('POST', `${root}/members/${members[2]}/role`, 1, { role: 'member', commandId: randomUUID() })
  assert.equal((await demoted).self.role, 'member')
  assert.equal(await request('POST', `${root}/settings`, device, { locked: false }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[4]}/remove`, device).then((r) => r.status), 403)
  connected.ws.close()
})

test('rejection, block, unblock, and restore preserve identity without reviving old grants or tickets', async (t) => {
  const { db, request, socketUrl, origin } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Access lifecycle', displayName: 'Host' })).body.data
  const root = `/rooms/${created.room.id}`
  const joined = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Alex' })).body.data
  const memberId = joined.self.id
  const memberPath = `${root}/members/${memberId}`
  const rejectId = randomUUID()
  const rejected = await request('POST', `${memberPath}/reject`, 1, { commandId: rejectId })
  assert.equal(rejected.status, 200)
  assert.equal(rejected.body.data.excludedMembers[0].admission, 'rejected')
  assert.equal((await request('POST', `${memberPath}/reject`, 1, { commandId: rejectId })).body.data.room.revision, rejected.body.data.room.revision)
  const declinedView = (await request('GET', root, 2)).body.data
  assert.equal(declinedView.self.admission, 'rejected')
  assert.equal(declinedView.members, undefined)
  assert.equal(declinedView.queue, undefined)
  assert.equal(declinedView.excludedMembers, undefined)
  assert.equal(await request('POST', `${root}/settings`, 2, { locked: true }).then((r) => r.status), 403)
  await request('POST', `${memberPath}/approve`, 1, { commandId: randomUUID() })
  const originalTicket = (await request('POST', `${root}/socket-ticket`, 2, {})).body.data.ticket
  const code = (await request('POST', `${root}/pairings`, 2, { scope: 'display' })).body.data.code
  const device = { device: (await request('POST', '/pairings/redeem', 4, { code })).body.data.credential }
  const deviceTicket = (await request('POST', `${root}/socket-ticket`, device, {})).body.data.ticket
  const liveTicket = (await request('POST', `${root}/socket-ticket`, device, {})).body.data.ticket
  const connected = await openSocket(socketUrl, origin, liveTicket)
  await connected.first
  const disconnected = new Promise((resolve) => connected.ws.once('close', resolve))
  const blocked = await request('POST', `${memberPath}/block`, 1, { commandId: randomUUID() })
  assert.equal(blocked.status, 200)
  assert.equal(blocked.body.data.excludedMembers[0].blocked, true)
  assert.equal(await disconnected, 4403)
  assert.equal(await request('GET', root, 2).then((r) => r.status), 403)
  assert.equal(await request('GET', root, device).then((r) => r.status), 403)
  assert.equal((await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Alex' })).body.code, 'ROOM_BLOCKED')
  assert.equal(await request('POST', `${memberPath}/approve`, 1, { commandId: randomUUID() }).then((r) => r.status), 409)
  await request('POST', `${memberPath}/unblock`, 1, { commandId: randomUUID() })
  assert.equal(await request('GET', root, 2).then((r) => r.status), 403)
  const restored = await request('POST', `${memberPath}/approve`, 1, { commandId: randomUUID() })
  assert.equal(restored.status, 200)
  assert.equal((await request('GET', root, 2)).body.data.self.id, memberId)
  assert.equal(await request('GET', root, device).then((r) => r.status), 403)
  for (const ticket of [originalTicket, deviceTicket]) {
    const ws = new WebSocket(socketUrl, { origin })
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    const denied = new Promise((resolve) => ws.once('close', resolve))
    ws.send(JSON.stringify({ type: 'authenticate', ticket }))
    assert.equal(await denied, 4401)
  }
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_members WHERE room_id = ?').get(created.room.id).total, 2)
})

test('host transfer rolls back failures, updates sockets and paired controls, and survives retries and races', async (t) => {
  const { db, request, socketUrl, origin } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Host transfer', displayName: 'Host', approvalRequired: false })).body.data
  const root = `/rooms/${created.room.id}`
  const next = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Next host' })).body.data.self.id
  const third = (await request('POST', '/join', 3, { code: created.invitationCode, displayName: 'Third' })).body.data.self.id
  const code = (await request('POST', `${root}/pairings`, 1, { scope: 'controller' })).body.data.code
  const device = { device: (await request('POST', '/pairings/redeem', 4, { code })).body.data.credential }
  const ticket = (await request('POST', `${root}/socket-ticket`, device, {})).body.data.ticket
  const oldHost = await openSocket(socketUrl, origin, ticket)
  assert.equal((await oldHost.first).invitationCode, created.invitationCode)
  const nextTicket = (await request('POST', `${root}/socket-ticket`, 2, {})).body.data.ticket
  const newHost = await openSocket(socketUrl, origin, nextTicket)
  await newHost.first
  const transferId = randomUUID()
  db.exec(`CREATE TRIGGER fail_transfer BEFORE UPDATE OF role ON ktv_members
    WHEN NEW.role = 'host' BEGIN SELECT RAISE(ABORT, 'test transfer failure'); END`)
  assert.equal(await request('POST', `${root}/members/${next}/transfer-host`, device, { commandId: transferId }).then((r) => r.status), 500)
  assert.equal(db.prepare("SELECT id FROM ktv_members WHERE room_id = ? AND role = 'host'").get(created.room.id).id, created.self.id)
  assert.equal(db.prepare('SELECT 1 FROM ktv_command_receipts WHERE command_id = ?').get(transferId), undefined)
  db.exec('DROP TRIGGER fail_transfer')
  const oldUpdate = nextSnapshot(oldHost.ws)
  const newUpdate = nextSnapshot(newHost.ws)
  const transferred = await request('POST', `${root}/members/${next}/transfer-host`, device, { commandId: transferId })
  assert.equal(transferred.status, 200)
  assert.equal(transferred.body.data.self.role, 'member')
  assert.equal(transferred.body.data.invitationCode, undefined)
  assert.equal((await oldUpdate).self.role, 'member')
  assert.equal((await newUpdate).invitationCode, created.invitationCode)
  assert.equal(await request('POST', `${root}/settings`, device, { locked: true }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/close`, 1).then((r) => r.status), 403)
  const replay = await request('POST', `${root}/members/${next}/transfer-host`, 1, { commandId: transferId })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.data.room.revision, transferred.body.data.room.revision)
  assert.equal(await request('POST', `${root}/members/${third}/transfer-host`, 1, { commandId: transferId }).then((r) => r.status), 409)
  const raced = await Promise.all([created.self.id, third].map((memberId) =>
    request('POST', `${root}/members/${memberId}/transfer-host`, 2, { commandId: randomUUID() })))
  assert.deepEqual(raced.map((result) => result.status).sort(), [200, 403])
  assert.equal(db.prepare("SELECT COUNT(*) total FROM ktv_members WHERE room_id = ? AND role = 'host'").get(created.room.id).total, 1)
  oldHost.ws.close()
  newHost.ws.close()
})

test('existing membership tables migrate additively and retain co-host and block metadata on restart', async (t) => {
  const { db, request } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Migration', displayName: 'Host', approvalRequired: false })).body.data
  const root = `/rooms/${created.room.id}`
  const member = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Alex' })).body.data.self.id
  const other = (await request('POST', '/join', 3, { code: created.invitationCode, displayName: 'Sam' })).body.data.self.id
  // Recreate the pre-moderation table shape while preserving existing rows/FKs.
  db.exec('ALTER TABLE ktv_members DROP COLUMN cohost_at; ALTER TABLE ktv_members DROP COLUMN blocked_at')
  const dataDir = path.dirname(db.prepare('PRAGMA database_list').all()[0].file)
  let reopened = initDb(dataDir)
  reopened.close()
  assert.equal((await request('GET', root, 2)).body.data.self.id, member)
  await request('POST', `${root}/members/${member}/role`, 1, { role: 'cohost', commandId: randomUUID() })
  await request('POST', `${root}/members/${other}/block`, 1, { commandId: randomUUID() })
  reopened = initDb(dataDir)
  t.after(() => reopened.close())
  assert.ok(reopened.prepare('SELECT cohost_at FROM ktv_members WHERE id = ?').get(member).cohost_at)
  assert.ok(reopened.prepare('SELECT blocked_at FROM ktv_members WHERE id = ?').get(other).blocked_at)
  assert.equal(reopened.prepare('PRAGMA foreign_key_check').all().length, 0)
  assert.equal(reopened.prepare('SELECT COUNT(*) total FROM users').get().total, 4)
})
