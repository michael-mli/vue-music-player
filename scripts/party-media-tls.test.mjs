import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { installMediaCertificate, restartMediaAfterRenewal } from './renew-ktv-media-tls.mjs'

const exec = promisify(execFile), hostname = 'turn.example.com'
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-tls-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const issued = path.join(directory, 'acme/config/live/ktv-party-turn')
  await fs.mkdir(issued, { recursive: true })
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3', '-subj', `/CN=${hostname}`,
    '-addext', `subjectAltName=DNS:${hostname}`, '-keyout', path.join(issued, 'privkey.pem'), '-out', path.join(issued, 'fullchain.pem')])
  const database = path.join(directory, 'room.db'), db = new DatabaseSync(database)
  db.exec("CREATE TABLE ktv_rooms(id TEXT, status TEXT, performance_mode TEXT); CREATE TABLE ktv_playback(room_id TEXT, state TEXT); INSERT INTO ktv_rooms VALUES ('room', 'open', 'online'); INSERT INTO ktv_playback VALUES ('room', 'playing')")
  db.close()
  return { directory, issued, database }
}

test('renewed TURN certificates validate hostname/key and install private files', async t => {
  const { directory, issued } = await fixture(t)
  await assert.rejects(installMediaCertificate({ directory, hostname: 'other.example.com' }), /validation/)
  await installMediaCertificate({ directory, hostname })
  for (const name of ['fullchain.pem', 'privkey.pem']) {
    assert.equal((await fs.stat(path.join(directory, 'tls', name))).mode & 0o777, 0o600)
    assert.deepEqual(await fs.readFile(path.join(directory, 'tls', name)), await fs.readFile(path.join(issued, name)))
  }
  assert.equal((await fs.stat(path.join(directory, '.tls-restart-needed'))).mode & 0o777, 0o600)
  const installedKey = await fs.readFile(path.join(directory, 'tls/privkey.pem'))
  await exec('openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', path.join(issued, 'privkey.pem')])
  await assert.rejects(installMediaCertificate({ directory, hostname }), /validation/)
  assert.deepEqual(await fs.readFile(path.join(directory, 'tls/privkey.pem')), installedKey)
})

test('certificate renewal defers a running performance and retries when idle', async t => {
  const { directory, database } = await fixture(t)
  await installMediaCertificate({ directory, hostname })
  const calls = [], run = async (command, args) => { calls.push(args); return { stdout: 'true\n' } }
  assert.equal(await restartMediaAfterRenewal({ directory, database, run }), 'deferred-active-performance')
  assert.equal(calls.length, 0)
  const db = new DatabaseSync(database); db.exec("UPDATE ktv_playback SET state = 'paused'"); db.close()
  assert.equal(await restartMediaAfterRenewal({ directory, database, run }), 'restarted-idle-media')
  assert.deepEqual(calls.map(args => args[0]), ['inspect', 'restart'])
  await assert.rejects(fs.access(path.join(directory, '.tls-restart-needed')))
  assert.equal(await restartMediaAfterRenewal({ directory, database, run }), 'unchanged')
  assert.equal(calls.length, 2)
})

test('a stopped media service uses the new certificate at its next deliberate start', async t => {
  const { directory, database } = await fixture(t)
  await installMediaCertificate({ directory, hostname })
  const db = new DatabaseSync(database); db.exec("UPDATE ktv_rooms SET performance_mode = 'local'"); db.close()
  const calls = [], run = async (command, args) => { calls.push(args); return { stdout: 'false\n' } }
  assert.equal(await restartMediaAfterRenewal({ directory, database, run }), 'installed-for-next-start')
  assert.equal(calls.length, 1)
})

test('provider or database failures retain the renewal restart marker', async t => {
  const { directory, database } = await fixture(t)
  await installMediaCertificate({ directory, hostname })
  const db = new DatabaseSync(database); db.exec("UPDATE ktv_playback SET state = 'paused'"); db.close()
  await assert.rejects(restartMediaAfterRenewal({ directory, database, run: async () => { throw new Error('Docker unavailable') } }))
  await fs.access(path.join(directory, '.tls-restart-needed'))
  await assert.rejects(restartMediaAfterRenewal({ directory, database: path.join(directory, 'missing.db') }))
  await fs.access(path.join(directory, '.tls-restart-needed'))
})
