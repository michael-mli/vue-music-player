import { StringDecoder } from 'node:string_decoder'
import { once } from 'node:events'

// One owned SSH channel carries timing JSON only. PCM remains on the receiver.
export function createAvEvidenceStream(child) {
  const decoder = new StringDecoder('utf8'), events = []
  const fields = ['ready', 'rate', 'fragmentFrames', 'windowFrames', 'signedMonitorLatency',
    'captureHeartbeat', 'time', 'captureQueueMs', 'captureCallMs', 'fragmentMs',
    'onAmplitude', 'offAmplitude', 'on', 'initial', 'analysisWindowMs']
  let pending = '', failure = null, closed = false, ended = false
  function fail(message) {
    failure ||= new Error(message)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  child.stdout.on('data', bytes => {
    if (failure || closed) return
    if (bytes.length > 65536) { fail('AV_EVIDENCE_CHUNK_LIMIT'); return }
    pending += decoder.write(bytes)
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
      if (line.length > 4096) { fail('AV_EVIDENCE_LINE_LIMIT'); return }
      try {
        const item = JSON.parse(line)
        if (!item || Array.isArray(item) || typeof item !== 'object' ||
          !(item.ready === true || item.captureHeartbeat === true || typeof item.on === 'boolean') ||
          (!item.ready && !Number.isFinite(item.time))) throw new Error('invalid event')
        events.push(Object.fromEntries(fields.filter(key => typeof item[key] === 'boolean' ||
          typeof item[key] === 'number' && Number.isFinite(item[key])).map(key => [key, item[key]])))
        if (events.length > 258) events.shift()
      } catch { fail('AV_EVIDENCE_INVALID_EVENT'); return }
    }
    if (pending.length > 4096) fail('AV_EVIDENCE_LINE_LIMIT')
  })
  child.on('error', () => { ended = true; if (!closed) failure ||= new Error('AV_EVIDENCE_STREAM_UNAVAILABLE') })
  child.on('exit', () => { ended = true; if (!closed) failure ||= new Error('AV_EVIDENCE_STREAM_ENDED') })
  return {
    async audioEvidence() {
      if (failure) throw failure
      if (closed) throw new Error('AV_EVIDENCE_STREAM_CLOSED')
      return events.map(item => ({ ...item }))
    },
    async close() {
      if (closed) return
      closed = true
      if (!ended && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit').catch(() => {})
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
        try { child.kill('SIGTERM'); await exited } finally { clearTimeout(timer) }
      }
    },
  }
}
