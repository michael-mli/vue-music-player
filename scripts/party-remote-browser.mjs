// A bounded, owned remote Chrome fixture. SSH must already trust the target key.
// The app/CDP forwards bind loopback only; no production profiles are reused.
import { execFile, spawn } from 'node:child_process'
import net from 'node:net'

const shell = value => "'" + value.replaceAll("'", "'\\''") + "'"
function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: 20000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error('Owned remote browser SSH/scp operation failed'))
      else resolve(stdout.trim())
    })
    child.stdin.end(input || '')
  })
}
async function unusedLocalPort(port) {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  await new Promise(resolve => server.close(resolve))
}

export async function createOwnedRemoteBrowser({ host, knownHosts, micFile, frontendPort, debugPort = 9243 }) {
  if (!/^[A-Za-z0-9_-]+@[A-Za-z0-9.-]+$/.test(host || '') || !knownHosts || !micFile ||
    ![frontendPort, debugPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535) || frontendPort === debugPort) {
    throw new Error('Invalid owned remote browser fixture configuration')
  }
  await unusedLocalPort(debugPort)
  const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHosts}`]
  const ssh = (command, input) => run('ssh', [...options, host, command], input)
  let root, pid, forward
  async function close() {
    let removed = true
    try {
      if (root) {
        if (pid) {
          const result = await ssh('bash -s', `set -eu
root=${shell(root)}
if test -d "$root"; then
  if test -r /proc/${pid}/cmdline; then
    case "$(tr '\\0' ' ' < /proc/${pid}/cmdline)" in
      *"$root/run.sh"*) kill -TERM ${pid} ;;
      *) exit 1 ;;
    esac
  fi
  for attempt in 1 2 3 4 5; do test ! -d "$root" && break; sleep 1; done
fi
test ! -d "$root"
test -z "$(/usr/bin/ss -ltnH 'sport = :${debugPort}')"
echo removed
`)
          removed = result === 'removed'
        } else await ssh(`rm -rf -- ${shell(root)}`)
      }
    } finally {
      if (forward && forward.exitCode === null && forward.signalCode === null) {
        await new Promise(resolve => {
          const timer = setTimeout(() => forward.kill('SIGKILL'), 2000)
          forward.once('exit', () => { clearTimeout(timer); resolve() }); forward.kill('SIGTERM')
        })
      }
    }
    if (!removed) throw new Error('Remote browser fixture cleanup was not verified')
  }
  try {
    root = await ssh(`test -x /usr/bin/google-chrome && test -z "$(/usr/bin/ss -ltnH '( sport = :${debugPort} or sport = :${frontendPort} )')" && umask 077 && mktemp -d /tmp/ktv-room-browser.XXXXXX`)
    if (!/^\/tmp\/ktv-room-browser\.[A-Za-z0-9]+$/.test(root)) { root = undefined; throw new Error('Remote owned directory was not verified') }
    await run('scp', [...options, micFile, `${host}:${root}/microphone.wav`])
    const script = `#!/bin/bash
set -u
root="$1"
child=''
cleanup() {
  trap - EXIT TERM INT
  if test -n "$child"; then
    kill -TERM -- "-$child" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$child" 2>/dev/null || true
  fi
  rm -rf -- "$root"
}
trap cleanup EXIT TERM INT
timeout --signal=TERM --kill-after=5s 900s /usr/bin/google-chrome \\
  --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu \\
  --no-first-run --no-default-browser-check --no-proxy-server \\
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \\
  --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \\
  --use-file-for-fake-audio-capture="$root/microphone.wav" \\
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort} \\
  --user-data-dir="$root/profile" about:blank &
child=$!
wait "$child"
`
    const output = await ssh('bash -s', `set -eu
umask 077
root=${shell(root)}
cat > "$root/run.sh" <<'KTV_OWNED_BROWSER_SCRIPT'
${script}KTV_OWNED_BROWSER_SCRIPT
chmod 700 "$root/run.sh"
nohup setsid bash "$root/run.sh" "$root" > "$root/browser.log" 2>&1 < /dev/null &
echo $!
`)
    if (!/^[1-9][0-9]*$/.test(output)) throw new Error('Remote browser owner PID was not verified')
    pid = Number(output)
    forward = spawn('ssh', [...options, '-o', 'ExitOnForwardFailure=yes', '-N',
      '-L', `127.0.0.1:${debugPort}:127.0.0.1:${debugPort}`,
      '-R', `127.0.0.1:${frontendPort}:127.0.0.1:${frontendPort}`, host], { stdio: 'ignore' })
    let forwardError = false
    forward.on('error', () => { forwardError = true })
    const debuggerUrl = `http://127.0.0.1:${debugPort}`
    for (let attempt = 0; attempt < 100; attempt++) {
      if (forwardError || forward.exitCode !== null || forward.signalCode !== null) throw new Error('Owned SSH forwards did not start')
      let ready = false
      try { ready = (await fetch(debuggerUrl + '/json/version', { signal: AbortSignal.timeout(1000) })).ok } catch { /* Wait for the owned browser and forwards. */ }
      if (ready) {
        const listeners = (await ssh(`/usr/bin/ss -ltnH '( sport = :${frontendPort} or sport = :${debugPort} )'`))
          .split('\n').filter(Boolean).map(line => line.trim().split(/\s+/)[3])
        if (listeners.length !== 2 || !listeners.includes(`127.0.0.1:${frontendPort}`) || !listeners.includes(`127.0.0.1:${debugPort}`)) {
          throw new Error('Owned remote forwards/browser must bind loopback only')
        }
        return { debuggerUrl, close }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Owned remote Chrome did not start')
  } catch (error) {
    await close()
    throw error
  }
}
