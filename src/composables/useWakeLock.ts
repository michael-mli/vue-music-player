/**
 * Screen Wake Lock — keep the device screen on (so the phone doesn't dim/sleep during
 * playback or karaoke). Uses the Screen Wake Lock API (Android Chrome, iOS Safari 16.4+).
 *
 * The OS auto-releases the lock when the tab is hidden (backgrounded), so we re-acquire it
 * on visibilitychange while the user has it enabled. Preference is persisted.
 */
import { ref, onUnmounted } from 'vue'

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener: (t: string, cb: () => void) => void
}

const STORAGE_KEY = 'keep-screen-awake'

export function useWakeLock() {
  const supported = ref(typeof navigator !== 'undefined' && 'wakeLock' in navigator)
  const enabled = ref(localStorage.getItem(STORAGE_KEY) === 'true') // user's intent
  const active = ref(false) // whether a lock is actually held right now

  let sentinel: WakeLockSentinelLike | null = null

  async function acquire() {
    if (!supported.value || sentinel) return
    try {
      sentinel = (await navigator.wakeLock.request('screen')) as unknown as WakeLockSentinelLike
      active.value = true
      sentinel!.addEventListener('release', () => {
        active.value = false
        sentinel = null
      })
    } catch {
      active.value = false
      sentinel = null
    }
  }

  async function release() {
    active.value = false
    if (sentinel) {
      try { await sentinel.release() } catch { /* already released */ }
      sentinel = null
    }
  }

  function onVisibility() {
    if (enabled.value && document.visibilityState === 'visible' && !sentinel) {
      acquire()
    }
  }

  async function enable() {
    enabled.value = true
    localStorage.setItem(STORAGE_KEY, 'true')
    document.addEventListener('visibilitychange', onVisibility)
    await acquire()
  }

  async function disable() {
    enabled.value = false
    localStorage.setItem(STORAGE_KEY, 'false')
    document.removeEventListener('visibilitychange', onVisibility)
    await release()
  }

  async function toggle() {
    if (enabled.value) await disable()
    else await enable()
  }

  // Restore preference on mount.
  if (enabled.value && supported.value) {
    document.addEventListener('visibilitychange', onVisibility)
    // Acquiring requires a document that's visible; safe to attempt.
    acquire()
  }

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    release()
  })

  return { supported, enabled, active, toggle, enable, disable }
}
