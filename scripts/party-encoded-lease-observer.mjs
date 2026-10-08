// Passive fixture instrumentation only. Preserve native delivery and retain no
// URL, grant, identity, exception text, frame payload or arbitrary worker data.
export function installEncodedLeaseObserver() {
  const NativeWorker = window.Worker, events = []
  let workers = 0
  window.__encodedLeaseEvents = events
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args)
      let url
      try { url = new URL(args[0], window.location.href) } catch { return }
      if (url.origin !== window.location.origin || !/^\/assets\/partyEncodedLease\.worker-[A-Za-z0-9_-]+\.js$/.test(url.pathname)) return
      const worker = ++workers
      if (worker > 32) return
      const record = (type, reason) => {
        events.push({ worker, type, time: performance.now(), ...(reason ? { reason } : {}) })
        if (events.length > 64) events.shift()
      }
      this.addEventListener('message', ({ data }) => {
        if (data?.type === 'ready') record('ready')
        else if (data?.type === 'silent') record('silent',
          ['identity', 'invalid', 'expired', 'clock', 'stream', 'stopped', 'keyframe-unsupported', 'keyframe']
            .includes(data.reason) ? data.reason : 'unknown')
      })
      this.addEventListener('error', () => record('error'))
      this.addEventListener('messageerror', () => record('messageerror'))
    }
  }
}
