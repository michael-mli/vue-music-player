// Only audio outputs contribute. Adding a camera/microphone must not stop a
// healthy room. Raw device IDs/group IDs stay in memory and are never logged.
export function partyOutputSignature(devices: readonly MediaDeviceInfo[]) {
  return JSON.stringify(devices.filter(device => device.kind === 'audiooutput').map(device => [device.deviceId, device.groupId]))
}

export function createPartyOutputMonitor(onChange: () => void) {
  const media = navigator.mediaDevices
  let stopped = false, attempt = 0, prior = '', observed = false
  async function inspect() {
    if (!media?.enumerateDevices || document.hidden || stopped) return
    const current = ++attempt
    try {
      const devices = await media.enumerateDevices()
      if (stopped || current !== attempt) return
      const signature = partyOutputSignature(devices)
      // Some browsers expose no outputs without permission. Do not invent a
      // device change when the browser cannot observe that path.
      if (signature === '[]') return
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))
      if (stopped || current !== attempt) return
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      if (!observed) prior = localStorage.getItem('party-output-fingerprint') || hash
      observed = true
      const changed = prior !== hash
      prior = hash; localStorage.setItem('party-output-fingerprint', hash)
      if (changed) onChange()
    } catch { /* Enumeration/storage availability does not grant audio readiness. */ }
  }
  media?.addEventListener('devicechange', inspect)
  document.addEventListener('visibilitychange', inspect)
  void inspect()
  return { inspect, stop: () => { stopped = true; attempt++; media?.removeEventListener('devicechange', inspect); document.removeEventListener('visibilitychange', inspect) } }
}
