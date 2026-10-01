// Prepare private files only. This does not change DNS, firewalls or running services.
import fs from 'node:fs/promises'
import path from 'node:path'
import { isIPv4 } from 'node:net'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export async function prepareMediaConfig({ directory, publicIp, turnDomain, origin, networkInterface }) {
  let site
  try { site = new URL(origin) } catch { throw new Error('A public HTTPS origin is required') }
  if (site.protocol !== 'https:' || site.origin !== origin || site.username || site.password ||
    !isIPv4(publicIp) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(turnDomain || '') ||
    !/^[a-zA-Z0-9_.:-]{1,32}$/.test(networkInterface || '') || !directory) throw new Error('Invalid media network configuration')
  const target = path.resolve(directory), apiKey = 'ktv-party'
  const apiSecret = randomBytes(32).toString('hex'), controlSecret = randomBytes(32).toString('hex')
  // Exclusive creation prevents accidental key rotation or overwriting a release.
  await fs.mkdir(target, { mode: 0o700 })
  try {
    await fs.mkdir(path.join(target, 'tls'), { mode: 0o700 })
    const shared = `KTV_MEDIA_API_KEY=${apiKey}\nKTV_MEDIA_API_SECRET=${apiSecret}\nKTV_MEDIA_CONTROL_SECRET=${controlSecret}\n`
    await fs.writeFile(path.join(target, 'backend.env'), `KTV_MEDIA_ENABLED=true\nKTV_MEDIA_WORKER_URL=http://127.0.0.1:3103\n${shared}`, { flag: 'wx', mode: 0o600 })
    await fs.writeFile(path.join(target, 'worker.env'), `${shared}KTV_SFU_CONFIG=/run/ktv/livekit.yaml\nKTV_SFU_URL=http://127.0.0.1:7880\nKTV_MEDIA_WORKER_PORT=3103\nKTV_MEDIA_BACKEND_URL=http://127.0.0.1:3101\nKTV_MEDIA_ORIGINS=${origin}\nKTV_MEDIA_TURN_DOMAIN=${turnDomain}\nKTV_MEDIA_TURN_TLS_PORT=5349\n`, { flag: 'wx', mode: 0o600 })
    await fs.writeFile(path.join(target, 'livekit.yaml'), `port: 7880
bind_addresses: [127.0.0.1]
rtc:
  node_ip: ${publicIp}
  use_external_ip: false
  tcp_port: 7881
  udp_port: 7882
  interfaces:
    includes: [${JSON.stringify(networkInterface)}]
room:
  max_participants: 61
turn:
  enabled: true
  domain: ${turnDomain}
  udp_port: 3478
  tls_port: 5349
  cert_file: /run/ktv/tls/fullchain.pem
  key_file: /run/ktv/tls/privkey.pem
  relay_range_start: 30000
  relay_range_end: 30100
  ttl_seconds: 300
  per_user_relay_allocation_limit: 4
keys:
  ${apiKey}: ${apiSecret}
logging:
  level: warn
limit:
  subscription_limit_audio: 1
  subscription_limit_video: 1
  signal_message_size_limit: 524288
`, { flag: 'wx', mode: 0o600 })
    return target
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flags = new Map()
    for (let index = 2; index < process.argv.length; index += 2) {
      const name = process.argv[index], value = process.argv[index + 1]
      if (!['--directory', '--public-ip', '--turn-domain', '--origin', '--interface'].includes(name) || !value || flags.has(name)) throw new Error('Invalid arguments')
      flags.set(name, value)
    }
    const directory = await prepareMediaConfig({ directory: flags.get('--directory'), publicIp: flags.get('--public-ip'),
      turnDomain: flags.get('--turn-domain'), origin: flags.get('--origin'), networkInterface: flags.get('--interface') })
    console.log(`Private media configuration prepared in ${directory}. Install trusted TURN certificates before starting it.`)
  } catch {
    console.error('Configuration was not prepared. Supply a new directory, public IPv4, DNS-only TURN domain, HTTPS origin and network interface.'); process.exitCode = 1
  }
}
