// Reload only after the requested worker is active. A timeout must leave the
// current application open so the user can retry rather than reload old code.
export async function applyPwaUpdate(serviceWorker: Pick<ServiceWorkerContainer, 'getRegistration'>,
  reload: () => void, timeoutMs = 8000): Promise<void> {
  const registration = await serviceWorker.getRegistration()
  if (!registration) throw new Error('PWA_UPDATE_UNAVAILABLE')
  const waiting = registration.waiting
  if (waiting) {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true; clearTimeout(timer); waiting.removeEventListener('statechange', changed)
        error ? reject(error) : resolve()
      }
      const changed = () => {
        if (waiting.state === 'redundant') finish(new Error('PWA_UPDATE_REPLACED'))
        else if (waiting.state === 'activated') {
          finish(registration.active === waiting ? undefined : new Error('PWA_UPDATE_REPLACED'))
        }
      }
      const timer = setTimeout(() => finish(new Error('PWA_UPDATE_TIMEOUT')), timeoutMs)
      waiting.addEventListener('statechange', changed)
      changed()
      if (!settled) {
        try { waiting.postMessage({ type: 'SKIP_WAITING' }) } catch { finish(new Error('PWA_UPDATE_UNAVAILABLE')) }
      }
    })
  } else if (registration.installing || registration.active?.state !== 'activated') throw new Error('PWA_UPDATE_PENDING')
  reload()
}
