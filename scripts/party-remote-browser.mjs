// A bounded, owned remote Chrome fixture. SSH must already trust the target key.
// The app/CDP forwards bind loopback only; no production profiles are reused.
import { execFile, spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs/promises'

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

export async function createOwnedRemoteBrowser({ host, knownHosts, micFile, frontendPort, debugPort = 9243, isolatedOutput = false }) {
  if (!/^[A-Za-z0-9_-]+@[A-Za-z0-9.-]+$/.test(host || '') || !knownHosts ||
    ![debugPort, ...(frontendPort === undefined ? [] : [frontendPort])].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535) || frontendPort === debugPort) {
    throw new Error('Invalid owned remote browser fixture configuration')
  }
  const remotePorts = [debugPort, ...(frontendPort === undefined ? [] : [frontendPort])]
  const portFilter = '( ' + remotePorts.map(port => `sport = :${port}`).join(' or ') + ' )'
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
    root = await ssh(`test -x /usr/bin/google-chrome && test -z "$(/usr/bin/ss -ltnH '${portFilter}')" && umask 077 && mktemp -d /tmp/ktv-room-browser.XXXXXX`)
    if (!/^\/tmp\/ktv-room-browser\.[A-Za-z0-9]+$/.test(root)) { root = undefined; throw new Error('Remote owned directory was not verified') }
    if (micFile) await run('scp', [...options, micFile, `${host}:${root}/microphone.wav`])
    if(isolatedOutput) {
      await ssh('test -x /usr/bin/pulseaudio && command -v python3 >/dev/null')
      const capture = await fs.readFile(new URL('./party-av-pulse-capture.py',import.meta.url),'utf8')
      await ssh(`umask 077; cat > ${shell(root+'/capture.py')}`,capture)
    }
    const script = `#!/bin/bash
set -u
root="$1"
child=''
pulse=''
monitor=''
cleanup() {
  trap - EXIT TERM INT
  if test -n "$child"; then
    kill -TERM -- "-$child" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$child" 2>/dev/null || true
  fi
  for owned in "$monitor" "$pulse"; do
    if test -n "$owned"; then kill -TERM "$owned" 2>/dev/null || true; fi
  done
  for owned in "$monitor" "$pulse"; do
    if test -n "$owned"; then wait "$owned" 2>/dev/null || true; fi
  done
  rm -rf -- "$root"
}
trap cleanup EXIT TERM INT
${isolatedOutput ? `
mkdir -m 700 "$root/runtime"
export XDG_RUNTIME_DIR="$root/runtime"
export PULSE_SERVER="unix:$root/pulse.sock"
export PULSE_SINK=ktv_av
cat > "$root/pulse.pa" <<KTV_PRIVATE_PULSE
load-module module-native-protocol-unix socket=$root/pulse.sock auth-anonymous=1
load-module module-null-sink sink_name=ktv_av rate=44100 channels=1 format=float32le
set-default-sink ktv_av
KTV_PRIVATE_PULSE
DBUS_SESSION_BUS_ADDRESS="unix:path=$root/no-session-bus" /usr/bin/pulseaudio -n --daemonize=no --exit-idle-time=-1 --use-pid-file=no --disable-shm=yes --file="$root/pulse.pa" --log-target="file:$root/pulse.log" &
pulse=$!
for attempt in $(seq 1 50); do test -S "$root/pulse.sock" && break; sleep .1; done
test -S "$root/pulse.sock" || exit 1
for attempt in $(seq 1 50); do test "$(/usr/bin/pactl -s "$PULSE_SERVER" get-default-sink 2>/dev/null)" = ktv_av && break; sleep .1; done
test "$(/usr/bin/pactl -s "$PULSE_SERVER" get-default-sink 2>/dev/null)" = ktv_av || exit 1
python3 -u "$root/capture.py" > "$root/av-audio.jsonl" 2> "$root/capture-errors.log" &
monitor=$!
` : ''}
timeout --signal=TERM --kill-after=5s 900s /usr/bin/google-chrome \\
  --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu \\
  --no-first-run --no-default-browser-check --no-proxy-server \\
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \\
  --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \\
  ${micFile ? '--use-file-for-fake-audio-capture="$root/microphone.wav"' : ''} \\
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
      ...(frontendPort === undefined ? [] : ['-R', `127.0.0.1:${frontendPort}:127.0.0.1:${frontendPort}`]), host], { stdio: 'ignore' })
    let forwardError = false
    forward.on('error', () => { forwardError = true })
    const debuggerUrl = `http://127.0.0.1:${debugPort}`
    for (let attempt = 0; attempt < 100; attempt++) {
      if (forwardError || forward.exitCode !== null || forward.signalCode !== null) throw new Error('Owned SSH forwards did not start')
      let ready = false
      try { ready = (await fetch(debuggerUrl + '/json/version', { signal: AbortSignal.timeout(1000) })).ok } catch { /* Wait for the owned browser and forwards. */ }
      if (ready) {
        const listeners = (await ssh(`/usr/bin/ss -ltnH '${portFilter}'`))
          .split('\n').filter(Boolean).map(line => line.trim().split(/\s+/)[3])
        if (listeners.length !== remotePorts.length || !remotePorts.every(port => listeners.includes(`127.0.0.1:${port}`))) {
          throw new Error('Owned remote forwards/browser must bind loopback only')
        }
        return { debuggerUrl, close, ...(isolatedOutput ? { async audioEvidence() {
          const raw=await ssh('python3 - '+shell(root),`import json,pathlib,sys
root=pathlib.Path(sys.argv[1])
error=(root/'capture-errors.log').read_text().strip().splitlines()
lines=(root/'av-audio.jsonl').read_text().splitlines()
print(json.dumps({'error':error[-1][:200] if error else None,'events':[json.loads(line) for line in lines[-258:]]}))
`)
          const result=JSON.parse(raw)
          if(result.error) throw new Error('Owned output monitor failed: '+result.error)
          return result.events
        } } : {}) }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if(isolatedOutput) {
      const diagnostics=await ssh('python3 - '+shell(root),`import json,pathlib,sys
root=pathlib.Path(sys.argv[1])
print(json.dumps({name:(root/name).read_text().splitlines()[-5:] if (root/name).exists() else [] for name in ['pulse.log','capture-errors.log']}))
`)
      throw new Error('Owned output browser did not start: '+diagnostics)
    }
    throw new Error('Owned remote Chrome did not start')
  } catch (error) {
    await close()
    throw error
  }
}
