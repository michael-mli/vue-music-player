import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'

const source = await fs.readFile(new URL('../src/services/partyCommandJournal.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const reload = () => import(`data:text/javascript;base64,${Buffer.from(compiled + '\n//' + randomUUID()).toString('base64')}`)
const errorSource = await fs.readFile(new URL('../src/services/partyErrorMessage.ts', import.meta.url), 'utf8')
const errorCode = ts.transpileModule(errorSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { partyErrorMessage } = await import(`data:text/javascript;base64,${Buffer.from(errorCode).toString('base64')}`)

test('room conflict and identity failures have English and Chinese recovery text without exposing unknown request details', async () => {
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(await fs.readFile(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    const translate = key => { const value = locale.party[key.replace(/^party\./, '')]; assert.equal(typeof value, 'string'); return value }
    const conflict = partyErrorMessage({ code: 'REVISION_CONFLICT', message: 'private-response' }, translate)
    const identity = partyErrorMessage({ response: { status: 401 } }, translate)
    const unknown = partyErrorMessage(new Error('wss://provider/rtc?access_token=private-token'), translate)
    assert.ok(conflict.length > 10 && identity.length > 10 && unknown.length > 10)
    assert.doesNotMatch([conflict, identity, unknown].join(' '), /private|access_token|wss:/)
    assert.notEqual(conflict, unknown)
    assert.equal(partyErrorMessage({ code: '__proto__' }, translate), unknown)
    assert.equal(partyErrorMessage({ code: 'toString' }, translate), unknown)
  }
})
class SessionStorage {
  values = new Map()
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}
function browser(t) {
  const previous = globalThis.window, storage = new SessionStorage()
  globalThis.window = { sessionStorage: storage }
  t.after(() => { globalThis.window = previous })
  return storage
}

test('a committed request with a lost reply reuses its ID after reload and allows a later deliberate action', async t => {
  const storage = browser(t), committed = new Map(), seen = []
  const payload = { name: 'Private room', displayName: 'Private singer' }
  let { runPartyMutation } = await reload()
  const send = async body => {
    seen.push(body.commandId)
    if (!committed.has(body.commandId)) committed.set(body.commandId, { roomId: randomUUID() })
    if (seen.length === 1) throw new Error('Reply lost after commit')
    return committed.get(body.commandId)
  }
  await assert.rejects(runPartyMutation('user:1', '/rooms', payload, send), /Reply lost/)
  assert.equal(storage.length, 1)
  ;({ runPartyMutation } = await reload())
  const replay = await runPartyMutation('user:1', '/rooms', payload, send)
  assert.equal(seen[1], seen[0]); assert.equal(committed.size, 1)
  assert.equal(storage.length, 0)
  const next = await runPartyMutation('user:1', '/rooms', payload, send)
  assert.notEqual(next.roomId, replay.roomId); assert.notEqual(seen[2], seen[0])
})

test('gateway and rate-limit failures keep the ID; definitive denial ends that attempt', async t => {
  const storage = browser(t), { runPartyMutation } = await reload(), ids = []
  for (const status of [502, 429, 403]) {
    await assert.rejects(runPartyMutation('member:1', '/rooms/r/settings', { locked: true }, async body => {
      ids.push(body.commandId); throw Object.assign(new Error('Request failed'), { status })
    }))
    assert.equal(storage.length, status === 403 ? 0 : 1)
  }
  assert.equal(new Set(ids).size, 1)
  await runPartyMutation('member:1', '/rooms/r/settings', { locked: true }, async body => { assert.notEqual(body.commandId, ids[0]); return true })
})

test('journal isolates principals and retains no invitation/name plaintext; expired attempts get new IDs', async t => {
  const storage = browser(t), first = await reload(), ids = []
  const payload = { code: 'ABCD2345', displayName: 'PrivateNickname' }
  for (const principal of ['user:1', 'user:2']) {
    await assert.rejects(first.runPartyMutation(principal, '/join', payload, async body => { ids.push(body.commandId); throw new Error('Network offline') }))
  }
  assert.notEqual(ids[0], ids[1])
  const stored = JSON.stringify([...storage.values])
  assert.ok(!stored.includes(payload.code)); assert.ok(!stored.includes(payload.displayName))
  for (const [key, value] of storage.values) storage.setItem(key, JSON.stringify({ ...JSON.parse(value), createdAt: Date.now() - 25 * 60 * 60 * 1000 }))
  const fresh = await reload()
  await fresh.runPartyMutation('user:1', '/join', payload, async body => { assert.ok(!ids.includes(body.commandId)); return true })
  assert.equal(storage.length, 0)
})

test('a full journal refuses new requests without losing IDs that may have committed', async t => {
  const storage = browser(t), first = await reload(), ids = []
  for (let index = 0; index < 100; index++) {
    await assert.rejects(first.runPartyMutation('user:1', '/rooms', { name: `Room ${index}` }, async body => {
      ids.push(body.commandId); throw new Error('Reply lost')
    }), /Reply lost/)
  }
  const next = await reload()
  let sent = false
  await assert.rejects(next.runPartyMutation('user:1', '/rooms', { name: 'Room 100' }, async () => { sent = true }), /Too many unresolved/)
  assert.equal(sent, false); assert.equal(storage.length, 100)
  await next.runPartyMutation('user:1', '/rooms', { name: 'Room 0' }, async body => { assert.equal(body.commandId, ids[0]); return true })
  assert.equal(storage.length, 99)
  await next.runPartyMutation('user:1', '/rooms', { name: 'Room 100' }, async body => { assert.ok(!ids.includes(body.commandId)); return true })
  await next.runPartyMutation('user:1', '/rooms', { name: 'Room 99' }, async body => { assert.equal(body.commandId, ids[99]); return true })
})

test('invalid stored IDs cannot become commands', async t => {
  const storage = browser(t), first = await reload()
  await assert.rejects(first.runPartyMutation('user:1', '/rooms', { name: 'Room' }, async () => { throw new Error('Offline') }))
  const key = [...storage.values.keys()][0], invalid = '------------------------------------'
  storage.setItem(key, JSON.stringify({ id: invalid, createdAt: Date.now() }))
  const next = await reload()
  await next.runPartyMutation('user:1', '/rooms', { name: 'Room' }, async body => { assert.notEqual(body.commandId, invalid); return true })
  assert.equal(storage.length, 0)
})
