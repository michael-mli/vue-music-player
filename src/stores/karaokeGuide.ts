import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { getMusicUrl } from '@/config'
import { usePlayerStore } from '@/stores/player'
import { useAuthStore } from '@/stores/auth'
import { guideRequest, KaraokeGuideError, type KaraokeGuideSession } from '@/services/karaokeGuideApi'
import { KaraokeGuideClock, type KaraokeGuideState } from '@/utils/karaokeGuideSync'

export const useKaraokeGuideStore = defineStore('karaokeGuide', () => {
  const player = usePlayerStore(), auth = useAuthStore()
  const session = ref<KaraokeGuideSession | null>(null)
  const busy = ref(false), error = ref(''), connectedDevices = ref(0)
  const clock = new KaraokeGuideClock()
  const pairUrl = computed(() => session.value
    ? `${window.location.origin}/sing/guide#session=${session.value.id}&token=${session.value.guideToken}` : '')
  let timer: number | undefined, publishing = false, dirty = false, generation = 0
  let audioEvents: AbortController | null = null

  function schedule(delay = 500) {
    window.clearTimeout(timer)
    if (session.value) timer = window.setTimeout(() => { void publish() }, delay)
  }
  function changed() {
    dirty = true
    if (!publishing) schedule(0)
  }
  async function publish() {
    const current = session.value
    if (!current || publishing) return
    publishing = true; dirty = false
    const audio = player.audioElement, song = player.currentSong
    const state: KaraokeGuideState = {
      song: song ? { id: song.id, title: song.title,
        url: new URL(getMusicUrl(`link.${song.id}.mp3`), window.location.origin).href } : null,
      position: audio?.currentTime || 0,
      duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
      playing: !!audio && player.karaokeMode && !player.partyAudioOwned && !player.isTransitioning &&
        !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3,
      rate: audio?.playbackRate || 1, sampledAt: clock.serverNow(performance.now()),
    }
    try {
      const result = await guideRequest<{ connectedDevices: number }>(clock, `/${current.id}`, current.hostToken, 'PUT', state)
      if (session.value?.id !== current.id) return
      connectedDevices.value = result.connectedDevices; error.value = ''
    } catch (reason) {
      if (session.value?.id !== current.id) return
      connectedDevices.value = 0
      if (reason instanceof KaraokeGuideError && [403, 410].includes(reason.status)) {
        session.value = null; error.value = 'expired'
      } else error.value = 'reconnecting'
    } finally {
      publishing = false
      schedule(dirty ? 0 : 500)
    }
  }
  async function start() {
    if (busy.value || session.value || !player.karaokeMode || player.partyAudioOwned) return
    const attempt = ++generation
    busy.value = true; error.value = ''
    try {
      await auth.ensureIdentity()
      if (!auth.token) throw new Error('No identity')
      const result = await guideRequest<KaraokeGuideSession>(clock, '', auth.token, 'POST', {})
      if (attempt !== generation || !player.karaokeMode || player.partyAudioOwned) {
        void guideRequest(clock, `/${result.id}`, result.hostToken, 'DELETE').catch(() => {})
        return
      }
      session.value = result
      await publish()
    } catch { if (attempt === generation) error.value = 'unavailable' }
    finally { busy.value = false }
  }
  function stop() {
    generation++
    const current = session.value
    session.value = null; connectedDevices.value = 0; error.value = ''
    window.clearTimeout(timer)
    if (current) void guideRequest(clock, `/${current.id}`, current.hostToken, 'DELETE', undefined, true).catch(() => {})
  }
  watch(() => player.audioElement, audio => {
    audioEvents?.abort()
    audioEvents = new AbortController()
    for (const event of ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended', 'ratechange', 'loadedmetadata', 'emptied']) {
      audio?.addEventListener(event, changed, { signal: audioEvents.signal })
    }
    changed()
  }, { immediate: true })
  watch(() => [player.currentSong?.id, player.isPlaying], changed)
  watch(() => [player.karaokeMode, player.partyAudioOwned], () => {
    if (!player.karaokeMode || player.partyAudioOwned) stop()
  })
  return { session, busy, error, connectedDevices, pairUrl, start, stop }
})
