import moduleUrl from './partyLeaseGuard.worklet.js?url'

const installed = new WeakMap<AudioContext, Promise<void>>()
const modules = new WeakMap<AudioContext, Promise<void>>()
export function installPartyLeaseGuard(context: AudioContext): Promise<void> {
  let task = installed.get(context)
  if (!task) {
    task = (async () => {
      if (!context.audioWorklet?.addModule || typeof AudioWorkletNode !== 'function') throw new Error('AUDIO_LEASE_GUARD_UNAVAILABLE')
      let module = modules.get(context)
      if (!module) {
        module = context.audioWorklet.addModule(moduleUrl)
        modules.set(context, module)
        void module.catch(() => modules.delete(context))
      }
      await module
      // Verify the rendering realm has a usable clock before enabling output.
      await new Promise<void>((resolve, reject) => {
        const node = new AudioWorkletNode(context, 'party-lease-guard', {
          numberOfInputs: 0, numberOfOutputs: 1, processorOptions: { preflight: true },
        })
        let finished = false
        const timer = window.setTimeout(() => finish(new Error('AUDIO_LEASE_GUARD_UNAVAILABLE')), 3000)
        const finish = (error?: Error) => {
          if (finished) return
          finished = true
          window.clearTimeout(timer); node.port.onmessage = null; node.onprocessorerror = null
          node.port.close(); node.disconnect(); error ? reject(error) : resolve()
        }
        node.port.onmessage = ({ data }) => { if (data?.type === 'ready') finish() }
        node.onprocessorerror = () => finish(new Error('AUDIO_LEASE_GUARD_UNAVAILABLE'))
      })
    })()
    installed.set(context, task)
    void task.catch(() => installed.delete(context))
  }
  return task
}

export function createPartyLeaseGuard(context: AudioContext, remainingMs: number) {
  const node = new AudioWorkletNode(context, 'party-lease-guard', {
    numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max',
    processorOptions: { expiry: Date.now() + remainingMs },
  })
  let sequence = 0, closed = false
  return { node, renew(remaining: number) {
    if (closed) return
    node.port.postMessage({ type: 'renew', sequence: ++sequence, expiry: Date.now() + remaining })
  }, close() {
    if (closed) return
    closed = true; node.port.postMessage({ type: 'stop' }); node.port.onmessage = null; node.onprocessorerror = null
    node.port.close(); node.disconnect()
  } }
}
