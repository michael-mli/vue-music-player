import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { getMusicUrl } from '@/config'
import { usePlayerStore } from '@/stores/player'
import { useAuthStore } from '@/stores/auth'
import { useSongsStore } from '@/stores/songs'
import { karaokeService } from '@/services/karaokeService'
import { guideRequest, KaraokeGuideError, karaokeRequestId, type KaraokeGuideSession,
  type KaraokePairedDevice, type KaraokeHostReply, type KaraokeRemoteCommand, type KaraokeCommandResult } from '@/services/karaokeGuideApi'
import { KaraokeGuideClock, type KaraokeGuideState } from '@/utils/karaokeGuideSync'

export const useKaraokeGuideStore = defineStore('karaokeGuide', () => {
  const player = usePlayerStore(), auth = useAuthStore(), songs = useSongsStore()
  const session = ref<KaraokeGuideSession | null>(null)
  const busy = ref(false), error = ref(''), connectedDevices = ref(0)
  const devices = ref<KaraokePairedDevice[]>([]), managing = ref(''), catalogBusy = ref(false)
  const clock = new KaraokeGuideClock()
  const pairUrl = computed(() => session.value
    ? `${window.location.origin}/sing/guide#session=${session.value.id}&token=${session.value.guideToken}` : '')
  const catalog = computed(() => songs.songs.filter(song => karaokeService.isAvailable(song.id))
    .map(song => ({ id: song.id, title: song.title.slice(0, 500), artist: (song.artist || '').slice(0, 200) })))
  let timer: number | undefined, catalogTimer: number | undefined, publishing = false, dirty = false, generation = 0, catalogDirty = false
  let audioEvents: AbortController | null = null
  const acknowledgements = new Map<string, KaraokeCommandResult>(), processed = new Map<string, KaraokeCommandResult>()

  function schedule(delay = 500) {
    window.clearTimeout(timer)
    if (session.value) timer = window.setTimeout(() => { void publish() }, delay)
  }
  function changed() { dirty = true; if (!publishing) schedule(0) }
  function execute(command: KaraokeRemoteCommand) {
    let result: KaraokeCommandResult = { id: command.id, status: 'applied' }
    try {
      if (!session.value || !player.karaokeMode || player.partyAudioOwned || clock.serverNow(performance.now()) >= command.expiresAt) throw new Error('commandExpired')
      const song = command.songId ? songs.songs.find(song => song.id === command.songId && karaokeService.isAvailable(song.id)) : null
      const run = (work: Promise<unknown>) => { void work.catch(() => { error.value = 'commandFailed' }) }
      switch (command.action) {
        case 'play': run(player.play()); break
        case 'pause': player.pause(); break
        case 'stop': player.stopPlayback(); break
        case 'skip':
          if (!player.canPlayNext) throw new Error('noNextSong')
          run(player.nextSong()); break
        case 'seek': player.seek(Math.min(command.position || 0, player.duration || command.position || 0)); break
        case 'enqueue':
          if (!song) throw new Error('songUnavailable')
          if (!player.requestedQueue.some(item => item.id === song.id) && !player.enqueueSong(song)) throw new Error('queueFull')
          break
        case 'singNow':
          if (!song) throw new Error('songUnavailable')
          player.removeQueuedSong(song.id)
          if (!player.queue.some(item => item.id === song.id)) player.queue.push(song)
          player.currentIndex = player.queue.findIndex(item => item.id === song.id)
          run(player.playSong(song)); break
        case 'removeQueued': player.removeQueuedSong(command.songId!); break
      }
    } catch (reason) { result = { id: command.id, status: 'failed', code: reason instanceof Error ? reason.message : 'commandFailed' } }
    processed.set(command.id, result); acknowledgements.set(command.id, result)
    if (processed.size > 1000) processed.delete(processed.keys().next().value!)
    changed()
  }
  function receive(result: KaraokeHostReply) {
    if (!session.value) return
    session.value.guideToken = result.guideToken
    devices.value = result.devices; connectedDevices.value = result.connectedDevices
    for (const command of result.commands) {
      const prior = processed.get(command.id)
      if (prior) acknowledgements.set(command.id, prior)
      else execute(command)
    }
  }
  async function publish() {
    const current = session.value
    if (!current || publishing) return
    publishing = true; dirty = false
    const audio = player.audioElement, song = player.currentSong
    const acks = [...acknowledgements.values()].slice(0, 50)
    const state: KaraokeGuideState = {
      song: song ? { id: song.id, title: song.title,
        url: new URL(getMusicUrl(`link.${song.id}.mp3`), window.location.origin).href } : null,
      position: audio?.currentTime || 0, duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
      playing: !!audio && player.karaokeMode && !player.partyAudioOwned && !player.isTransitioning &&
        !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3,
      rate: audio?.playbackRate || 1, sampledAt: clock.serverNow(performance.now()),
    }
    try {
      const result = await guideRequest<KaraokeHostReply>(clock, `/${current.id}`, current.hostToken, 'PUT', {
        ...state, controlsAvailable: true, queue: player.requestedQueue.map(({ id, title }) => ({ id, title: title.slice(0, 500) })), acknowledgements: acks,
      })
      if (session.value?.id !== current.id) return
      for (const ack of acks) acknowledgements.delete(ack.id)
      error.value = ''; receive(result)
    } catch (reason) {
      if (session.value?.id !== current.id) return
      connectedDevices.value = 0
      if (reason instanceof KaraokeGuideError && [403, 410].includes(reason.status)) {
        session.value = null; devices.value = []; error.value = 'expired'
      } else error.value = 'reconnecting'
    } finally { publishing = false; schedule(dirty ? 0 : 500) }
  }
  async function uploadCatalog() {
    if (catalogBusy.value) { catalogDirty = true; return }
    const current = session.value
    if (!current) return
    catalogBusy.value = true; catalogDirty = false
    const list = catalog.value, revision = karaokeRequestId()
    try {
      for (let offset = 0; offset < Math.max(1, list.length); offset += 100) {
        if (session.value?.id !== current.id) return
        await guideRequest(clock, `/${current.id}/catalog`, current.hostToken, 'PUT', {
          revision, reset: offset === 0, done: offset + 100 >= list.length, songs: list.slice(offset, offset + 100),
        })
      }
    } catch { if (session.value?.id === current.id) { catalogDirty = true; error.value = 'catalogUnavailable' } }
    finally {
      catalogBusy.value = false
      if (catalogDirty && session.value) catalogTimer = window.setTimeout(() => { void uploadCatalog() }, 2000)
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
        void guideRequest(clock, `/${result.id}`, result.hostToken, 'DELETE').catch(() => {}); return
      }
      session.value = result; processed.clear(); acknowledgements.clear()
      await publish(); await uploadCatalog()
    } catch { if (attempt === generation) error.value = 'unavailable' }
    finally { busy.value = false }
  }
  function stop() {
    generation++
    const current = session.value
    session.value = null; connectedDevices.value = 0; devices.value = []; error.value = ''
    window.clearTimeout(timer); window.clearTimeout(catalogTimer)
    if (current) void guideRequest(clock, `/${current.id}`, current.hostToken, 'DELETE', undefined, true).catch(() => {})
  }
  async function manageDevice(id: string, canControl?: boolean) {
    const current = session.value
    if (!current || managing.value) return
    managing.value = id
    try {
      const result = await guideRequest<KaraokeHostReply>(clock, `/${current.id}/devices/${id}`, current.hostToken,
        canControl === undefined ? 'DELETE' : 'PATCH', canControl === undefined ? undefined : { canControl })
      if (session.value?.id === current.id) { receive(result); error.value = '' }
    } catch { error.value = 'manageFailed' }
    finally { managing.value = '' }
  }
  watch(() => player.audioElement, audio => {
    audioEvents?.abort(); audioEvents = new AbortController()
    for (const event of ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended', 'ratechange', 'loadedmetadata', 'emptied']) {
      audio?.addEventListener(event, changed, { signal: audioEvents.signal })
    }
    changed()
  }, { immediate: true })
  watch(() => [player.currentSong?.id, player.isPlaying, player.requestedQueue.map(song => song.id).join(',')], changed)
  watch(() => JSON.stringify(catalog.value), () => {
    window.clearTimeout(catalogTimer)
    if (session.value) catalogTimer = window.setTimeout(() => { void uploadCatalog() }, 500)
  })
  watch(() => [player.karaokeMode, player.partyAudioOwned], () => { if (!player.karaokeMode || player.partyAudioOwned) stop() })
  return { session, busy, error, connectedDevices, devices, managing, catalogBusy, pairUrl, start, stop, manageDevice }
})
