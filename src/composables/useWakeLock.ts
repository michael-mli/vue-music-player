/**
 * Screen Wake Lock — keep the device screen on (so the phone doesn't dim/sleep during
 * playback or karaoke). Uses the Screen Wake Lock API (Android Chrome, iOS Safari 16.4+).
 *
 * Two drivers:
 *  - `setAuto(true)` — external signal ("music is playing") acquires the lock automatically.
 *  - `enabled`       — persisted manual override that keeps the screen on even when paused.
 *
 * The OS auto-releases the lock when the tab is hidden (backgrounded), so we re-acquire it
 * on visibilitychange while the screen should stay awake.
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
  const enabled = ref(localStorage.getItem(STORAGE_KEY) === 'true') // manual override
  const auto = ref(false) // external signal: audio is playing
  const active = ref(false) // whether a lock is actually held right now

  let sentinel: WakeLockSentinelLike | null = null
  let pending = false

  function shouldHold() {
    return supported.value && (enabled.value || auto.value)
  }

  async function acquire() {
    if (!shouldHold() || sentinel || pending) return
    pending = true
    try {
      const handle = (await navigator.wakeLock.request('screen')) as unknown as WakeLockSentinelLike
      // Preference may have changed while the request was in flight.
      if (!shouldHold()) {
        handle.release().catch(() => {})
        return
      }
      sentinel = handle
      active.value = true
      handle.addEventListener('release', () => {
        active.value = false
        sentinel = null
      })
    } catch {
      active.value = false
      sentinel = null
    } finally {
      pending = false
    }
  }

  async function release() {
    active.value = false
    if (sentinel) {
      try { await sentinel.release() } catch { /* already released */ }
      sentinel = null
    }
  }

  async function sync() {
    if (shouldHold()) await acquire()
    else await release()
  }

  function onVisibility() {
    if (!shouldHold()) return
    if (document.visibilityState === 'visible' && !sentinel && !pending) void acquire()
  }

  function setAuto(v: boolean) {
    if (auto.value === v) return
    auto.value = v
    void sync()
  }

  async function toggle() {
    enabled.value = !enabled.value
    localStorage.setItem(STORAGE_KEY, String(enabled.value))
    await sync()
  }

  if (supported.value) {
    document.addEventListener('visibilitychange', onVisibility)
    // Restore the user's previous override on mount.
    void acquire()
  }

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    release()
  })

  return { supported, enabled, auto, active, setAuto, toggle }
}