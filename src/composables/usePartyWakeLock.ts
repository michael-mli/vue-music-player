import { onUnmounted, ref, watch, type Ref } from 'vue'

const preferenceKey = 'party-keep-screen-awake'

export function usePartyWakeLock(inRoom: Ref<boolean>) {
  const supported = ref(typeof navigator.wakeLock?.request === 'function')
  let saved: string | null = null
  try { saved = localStorage.getItem(preferenceKey) } catch { /* Storage is optional. */ }
  const enabled = ref(saved !== 'false')
  const active = ref(false), requesting = ref(false)
  let sentinel: WakeLockSentinel | null = null, revision = 0, disposed = false
  const shouldHold = () => !disposed && inRoom.value && enabled.value && supported.value && !document.hidden

  function release() {
    revision++
    const previous = sentinel
    sentinel = null; active.value = false
    if (previous) void previous.release().catch(() => {})
  }
  async function acquire() {
    if (!shouldHold() || sentinel || requesting.value) return
    requesting.value = true
    const attempt = revision
    try {
      const handle = await navigator.wakeLock.request('screen')
      if (attempt !== revision || !shouldHold() || handle.released) {
        void handle.release().catch(() => {})
        return
      }
      sentinel = handle; active.value = true
      handle.addEventListener('release', () => {
        if (sentinel !== handle) return
        sentinel = null; active.value = false
        // Respect platform revocation. Retry on visibility return or an
        // explicit user request rather than repeatedly requesting a lock.
      })
    } catch { active.value = false }
    finally {
      requesting.value = false
      // A preference or route may have changed while the browser was deciding.
      if (attempt !== revision && shouldHold()) void acquire()
    }
  }
  function sync() {
    if (shouldHold()) void acquire()
    else release()
  }
  function setEnabled(value: boolean) {
    enabled.value = value
    try { localStorage.setItem(preferenceKey, String(value)) } catch { /* Keep the in-memory choice. */ }
    sync()
  }
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('pagehide', release)
  window.addEventListener('pageshow', sync)
  watch(inRoom, sync, { immediate: true, flush: 'sync' })
  onUnmounted(() => {
    disposed = true
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('pagehide', release)
    window.removeEventListener('pageshow', sync)
    release()
  })
  return { supported, enabled, active, requesting, setEnabled, retry: acquire }
}
