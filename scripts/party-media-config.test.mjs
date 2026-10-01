import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { prepareMediaConfig } from './prepare-ktv-media-config.mjs'

const network = { publicIp: '203.0.113.10', turnDomain: 'turn.example.com', origin: 'https://music.example.com', networkInterface: 'ens5' }
test('media configuration stays private, shares the exact provider keys and cannot overwrite an existing release', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-private-config-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'release')
  await prepareMediaConfig({ ...network, directory })
  const backend = await fs.readFile(path.join(directory, 'backend.env'), 'utf8'), worker = await fs.readFile(path.join(directory, 'worker.env'), 'utf8')
  const keys = Object.fromEntries(backend.trim().split('\n').map(line => line.split('=')))
  assert.match(keys.KTV_MEDIA_API_SECRET, /^[0-9a-f]{64}$/); assert.notEqual(keys.KTV_MEDIA_API_SECRET, keys.KTV_MEDIA_CONTROL_SECRET)
  for (const key of ['KTV_MEDIA_API_KEY', 'KTV_MEDIA_API_SECRET', 'KTV_MEDIA_CONTROL_SECRET']) assert.ok(worker.includes(`${key}=${keys[key]}\n`))
  assert.ok(worker.includes(`KTV_MEDIA_TURN_DOMAIN=${network.turnDomain}\nKTV_MEDIA_TURN_TLS_PORT=5349\n`))
  assert.ok((await fs.readFile(path.join(directory, 'livekit.yaml'), 'utf8')).includes(keys.KTV_MEDIA_API_SECRET))
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700)
  for (const file of ['backend.env', 'worker.env', 'livekit.yaml']) assert.equal((await fs.stat(path.join(directory, file))).mode & 0o777, 0o600)
  await assert.rejects(prepareMediaConfig({ ...network, directory }), { code: 'EEXIST' })
  assert.equal(await fs.readFile(path.join(directory, 'backend.env'), 'utf8'), backend)
})
test('invalid network values cannot inject configuration or create private files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-invalid-config-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'release')
  for (const invalid of [{ publicIp: '127.0.0.1\nkeys: stolen' }, { origin: 'https://music.example.com/path' },
    { origin: 'https://user:pass@music.example.com' }, { turnDomain: 'turn.example.com\nkeys:' }, { networkInterface: 'ens5]\nkeys:' }]) {
    await assert.rejects(prepareMediaConfig({ ...network, ...invalid, directory }))
    await assert.rejects(fs.access(directory), { code: 'ENOENT' })
  }
})
