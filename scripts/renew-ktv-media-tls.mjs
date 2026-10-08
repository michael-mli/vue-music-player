import fs from 'node:fs/promises'
import path from 'node:path'
import { X509Certificate, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const execute = promisify(execFile)
const image = 'certbot/certbot:v5.8.0@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20'
const marker = '.tls-restart-needed'
async function atomicWrite(target, bytes) {
  const draft = target + '.' + randomUUID()
  try { await fs.writeFile(draft, bytes, { flag: 'wx', mode: 0o600 }); await fs.rename(draft, target) }
  finally { await fs.rm(draft, { force: true }) }
}

export async function installMediaCertificate({ directory, hostname }) {
  const issued = path.join(directory, 'acme/config/live/ktv-party-turn')
  const [chain, key] = await Promise.all(['fullchain.pem', 'privkey.pem'].map(name => fs.readFile(path.join(issued, name))))
  const certificate = new X509Certificate(chain)
  if (!certificate.checkHost(hostname) || Date.parse(certificate.validTo) < Date.now() + 24 * 60 * 60 * 1000 ||
    !certificate.publicKey.export({ type: 'spki', format: 'der' }).equals(createPublicKey(createPrivateKey(key)).export({ type: 'spki', format: 'der' }))) {
    throw new Error('TURN certificate validation failed')
  }
  const tls = path.join(directory, 'tls')
  await fs.mkdir(tls, { recursive: true, mode: 0o700 })
  const [old, oldKey] = await Promise.all(['fullchain.pem', 'privkey.pem'].map(name => fs.readFile(path.join(tls, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error })))
  if (!old?.equals(chain) || !oldKey?.equals(key)) {
    // The SFU reads this pair only at startup. Publish both files before asking
    // it to restart; leave a durable retry marker if an active song defers that.
    await atomicWrite(path.join(tls, 'privkey.pem'), key)
    await atomicWrite(path.join(tls, 'fullchain.pem'), chain)
    await atomicWrite(path.join(directory, marker), Buffer.from(certificate.validTo + '\n'))
  }
  return { expiresAt: certificate.validTo }
}

export async function restartMediaAfterRenewal({ directory, database, container = 'ktv-party-media', run = execute }) {
  const pending = path.join(directory, marker)
  try { await fs.access(pending) } catch (error) { if (error.code === 'ENOENT') return 'unchanged'; throw error }
  const db = new DatabaseSync(database, { readOnly: true })
  let active
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    active = db.prepare(`SELECT COUNT(*) AS total FROM ktv_playback p JOIN ktv_rooms r ON r.id = p.room_id
      WHERE r.status = 'open' AND r.performance_mode != 'local' AND p.state IN ('preparing', 'scheduled', 'playing')`).get().total
  } finally { db.close() }
  if (active) return 'deferred-active-performance'
  let running
  try { running = (await run('docker', ['inspect', '--format', '{{.State.Running}}', container], { timeout: 10000 })).stdout.trim() === 'true' }
  catch (error) { if (/No such object|No such container/.test(error.stderr || '')) running = false; else throw error }
  if (running) await run('docker', ['restart', container], { timeout: 20000 })
  await fs.rm(pending, { force: true })
  return running ? 'restarted-idle-media' : 'installed-for-next-start'
}

export async function renewMediaCertificate({ directory, webroot, hostname, database, container = 'ktv-party-media', run = execute }) {
  if (![directory, webroot, database].every(value => typeof value === 'string' && path.isAbsolute(value)) ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname || '') || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(container)) {
    throw new Error('Invalid TURN renewal configuration')
  }
  await run('docker', ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
    '--mount', `type=bind,src=${path.join(directory, 'acme')},dst=/run/acme`,
    '--mount', `type=bind,src=${webroot},dst=/var/www/acme`, image,
    'renew', '--config-dir', '/run/acme/config', '--work-dir', '/run/acme/work', '--logs-dir', '/run/acme/logs',
    '--non-interactive', '--quiet', '--cert-name', 'ktv-party-turn', '--webroot-path', '/var/www/acme'], { timeout: 180000, maxBuffer: 1024 * 1024 })
  const certificate = await installMediaCertificate({ directory, hostname })
  const status = await restartMediaAfterRenewal({ directory, database, container, run })
  return { ...certificate, status }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}
    for (let index = 2; index < process.argv.length; index += 2) {
      const name = process.argv[index].replace(/^--/, ''), value = process.argv[index + 1]
      if (!['directory', 'webroot', 'hostname', 'database', 'container'].includes(name) || !value || options[name]) throw new Error('Invalid arguments')
      options[name] = value
    }
    console.log('TURN certificate:', JSON.stringify(await renewMediaCertificate(options)))
  } catch { console.error('TURN certificate renewal failed; private logs and the pending restart marker are retained.'); process.exitCode = 1 }
}
