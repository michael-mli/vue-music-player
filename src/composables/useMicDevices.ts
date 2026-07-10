/**
 * Shared microphone device selection — the mic monitor, karaoke recorder and mic test all
 * capture through getMicStream() so the user's chosen input applies everywhere.
 * Selection persists in localStorage; a vanished device falls back to the system default.
 */
import { ref } from 'vue'

const DEVICE_KEY = 'music-player-mic-device'

// Module-level singletons: one selection shared by every consumer.
const devices = ref<{ deviceId: string; label: string }[]>([])
const selectedId = ref<string>(
  typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_KEY) || '' : ''
)
let listening = false

async function refresh() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    devices.value = all
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        // Labels are empty until mic permission is granted at least once
        label: d.label || `Microphone ${i + 1}`,
      }))
  } catch {
    // enumeration unsupported — the default-device path still works
  }
}

function select(id: string) {
  selectedId.value = id
  try { localStorage.setItem(DEVICE_KEY, id) } catch { /* noop */ }
}

/**
 * getUserMedia honoring the selected input device. When the saved device is unplugged
 * (OverconstrainedError/NotFoundError) it silently falls back to the system default.
 * Refreshes the device list afterwards so labels appear once permission is granted.
 */
export async function getMicStream(base: MediaTrackConstraints = {}): Promise<MediaStream> {
  const md = navigator.mediaDevices
  if (selectedId.value) {
    try {
      const stream = await md.getUserMedia({
        audio: { ...base, deviceId: { exact: selectedId.value } },
      })
      refresh()
      return stream
    } catch (e) {
      const name = (e as DOMException)?.name
      if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw e
    }
  }
  const stream = await md.getUserMedia({ audio: base })
  refresh()
  return stream
}

export function useMicDevices() {
  if (!listening && typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
    listening = true
    navigator.mediaDevices.addEventListener('devicechange', refresh)
  }
  return { devices, selectedId, refresh, select }
}
