import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Song, PlayerState, PlayMode } from '@/types'
import { getMusicUrl, getPosterUrl, getInstrumentalUrl } from '@/config'
import { songService } from '@/services/songService'
import { audioCacheService } from '@/services/audioCacheService'
import { karaokeService } from '@/services/karaokeService'
import { debugLogger, isDebugMode } from '@/services/debugLogger'

export const usePlayerStore = defineStore('player', () => {
  // State
  const currentSong = ref<Song | null>(null)
  const isPlaying = ref(false)
  const volume = ref(0.8)
  const isMuted = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const shuffle = ref(true)
  const repeat = ref<'none' | 'one' | 'all'>('none')
  const queue = ref<Song[]>([])
  const currentIndex = ref(0)
  // The exact next song, decided when the current song starts and preloaded ahead so it's
  // already buffered when the current one ends. -1 = not decided yet. This is what makes
  // background auto-advance work in an installed PWA (which blocks background network
  // fetches): the next track must already be in cache, not fetched at end-of-song.
  const nextUpIndex = ref(-1)
  const audioElement = ref<HTMLAudioElement | null>(null)
  // Object URL of the in-memory blob currently driving playback (if the track was played
  // from cache). Revoked when the next track loads so blobs don't leak.
  let currentObjectUrl: string | null = null

  // Karaoke mode: when on, play the vocals-removed instrumental for songs that have one.
  // Persisted so the preference survives reloads. See KARAOKE.md.
  const KARAOKE_MODE_KEY = 'music-player-karaoke-mode'
  const karaokeMode = ref(localStorage.getItem(KARAOKE_MODE_KEY) === 'true')

  const playHistory = ref<Song[]>([]) // Track actually played songs for previous functionality
  
  // Sleep timer state
  const sleepTimer = ref(0) // Default off, user needs to set it explicitly
  const sleepTimerRemaining = ref(0) // Remaining time in seconds
  const sleepTimerInterval = ref<number | null>(null)
  
  // Total playtime tracking
  const totalPlaytime = ref(0) // Total seconds played across all app usage (persisted)
  const sessionPlaytime = ref(0) // Seconds played in the current session — resets to 0 on stop
  const sessionStartTime = ref(0) // When current play session started
  const lastPlayState = ref(false) // Previous playing state
  const playtimeInterval = ref<number | null>(null) // Interval for updating playtime
  
  // Song range filter
  const songRangeMin = ref(0)
  const songRangeMax = ref(0)

  // Network connectivity tracking
  const isOnline = ref(navigator.onLine)
  const networkRetryAttempts = ref(0)
  const maxRetryAttempts = 3
  const retryDelay = 2000 // 2 seconds

  // Background-freeze detection: Android Chrome stops backgrounded audio after ~5 min
  // (battery optimization). We can't read that OS setting, but we can infer it happened
  // by comparing wall-clock time vs playback progress across a background period, and then
  // show a one-time hint pointing the user at Chrome → Battery → Unrestricted.
  const backgroundFreezeDetected = ref(false)
  const FREEZE_HINT_DISMISSED_KEY = 'music-bg-freeze-hint-dismissed'
  let bgHiddenAt = 0        // Date.now() when we were last backgrounded while playing
  let bgPlaytimeAtHide = 0  // totalPlaytime at that moment (counts real playback across songs)

  // Mobile stall handling - debounce to avoid aggressive reloads
  const stallTimeout = ref<number | null>(null)
  const stallDebounceMs = 10000 // Only retry after 10s of sustained stall

  // Fallback end-detection for mobile browsers that don't fire 'ended'
  const endedHandled = ref(false)
  // Tracks the pending timeupdate-fallback timeout — ensures only one is scheduled per song
  const endFallbackTimeout = ref<number | null>(null)

  // Consecutive song-skip failure guard (e.g. many missing MP3 files in a row)
  const consecutiveFailures = ref(0)
  const maxConsecutiveFailures = 15

  // Clear legacy blacklist — it was poisoned by false positives from background mode failures
  localStorage.removeItem('music-player-broken-songs')

  // Prevents pause-event side effects during song transitions (load → play)
  const isTransitioning = ref(false)

  // AbortController for current audio element's event listeners — replaced on each swap
  let currentAudioAbortController: AbortController | null = null

  /** Compact snapshot of HTMLAudioElement state for debug logs */
  function snapAudio(): string {
    const a = audioElement.value
    if (!a) return 'noAudio'
    return `rs=${a.readyState} ns=${a.networkState} paused=${a.paused} ended=${a.ended} t=${a.currentTime.toFixed(2)}/${(a.duration || 0).toFixed(2)}`
  }

  /**
   * Resolve the audio source URL for a song, honoring karaoke mode.
   *
   * In karaoke mode (and when the song has an instrumental) we always use the network
   * instrumental URL — never the in-memory blob, which holds the *vocal* version preloaded
   * for background playback. Otherwise we prefer the cached blob, falling back to the
   * normal network URL. See KARAOKE.md.
   */
  function sourceUrlFor(song: Song, cachedUrl: string | null): string {
    if (karaokeMode.value && karaokeService.isAvailable(song.id)) {
      return getInstrumentalUrl(song.id)
    }
    return cachedUrl || getMusicUrl(`link.${song.id}.mp3`)
  }

  // Getters
  const progress = computed(() => {
    return duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
  })

  /** Whether the currently-playing song has a karaoke instrumental available. */
  const karaokeAvailable = computed(() =>
    !!currentSong.value && karaokeService.isAvailable(currentSong.value.id)
  )

  const formattedCurrentTime = computed(() => {
    return formatTime(currentTime.value)
  })

  const formattedDuration = computed(() => {
    return formatTime(duration.value)
  })

  const canPlayNext = computed(() => {
    return shuffle.value || currentIndex.value < queue.value.length - 1 || repeat.value === 'all'
  })

  const canPlayPrevious = computed(() => {
    return playHistory.value.length > 0
  })

  const isSleepTimerActive = computed(() => {
    return sleepTimer.value > 0 && sleepTimerRemaining.value > 0
  })

  const formattedSleepTimer = computed(() => {
    if (!isSleepTimerActive.value) return ''
    const minutes = Math.floor(sleepTimerRemaining.value / 60)
    const seconds = sleepTimerRemaining.value % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  })

  const isSongRangeActive = computed(() => {
    return songRangeMin.value > 0 && songRangeMax.value > 0 && songRangeMax.value >= songRangeMin.value
  })

  const formattedTotalPlaytime = computed(() => {
    const totalSeconds = totalPlaytime.value
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`
    }
  })

  const formattedSessionPlaytime = computed(() => {
    const totalSeconds = sessionPlaytime.value
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`
    }
  })

  // Actions
  function initializeAudio() {
    audioElement.value = new Audio()
    audioElement.value.volume = volume.value
    
    // Load saved settings
    loadTotalPlaytime()
    loadSleepTimer()
    loadSongRange()

    // Fetch the karaoke manifest (which songs have instrumentals) in the background.
    karaokeService.ensureLoaded()
    
    // Setup network connectivity listeners
    setupNetworkListeners()
    
    // Setup audio event listeners
    setupAudioEventListeners(audioElement.value)
  }

  async function playSongFromHistory(song: Song) {
    debugLogger.info('PLAYER', `playSongFromHistory #${song.id} "${song.title}"`)
    // This function plays a song from history without adding it to history again
    isTransitioning.value = true
    lastPlayState.value = true
    currentSong.value = song
    endedHandled.value = false
    if (endFallbackTimeout.value) { clearTimeout(endFallbackTimeout.value); endFallbackTimeout.value = null }

    if (audioElement.value) {
      // Reset time and duration when switching songs
      currentTime.value = 0
      duration.value = 0

      debugLogger.info('PLAYER', `isTransitioning=true — loading #${song.id}`)
      try {
        // Check if we have a cached version of this song
        // Reuse the same audio element and prefer the fully-downloaded in-memory copy
        // (object URL) of this song, so it plays start-to-finish with NO network. That's
        // what makes background auto-advance reliable in an installed PWA, where the OS
        // throttles network once backgrounded (an un-cached track stalls on load or
        // mid-song). Falls back to the normal URL if it wasn't preloaded in time.
        debugLogger.info('PLAYER', `Loading #${song.id} into the active audio element`)
        audioElement.value.pause()
        const cachedUrl = audioCacheService.takeCachedUrl(song.id)
        const useKaraoke = karaokeMode.value && karaokeService.isAvailable(song.id)
        debugLogger.info('PLAYER', `#${song.id} source: ${useKaraoke ? 'KARAOKE INSTRUMENTAL ♪' : cachedUrl ? 'IN-MEMORY BLOB ✓' : 'NETWORK (not preloaded in time)'}`)
        audioElement.value.src = sourceUrlFor(song, cachedUrl)
        audioElement.value.load()
        audioElement.value.currentTime = 0
        // Release the previous track's in-memory blob now that we've switched off it
        if (currentObjectUrl && currentObjectUrl !== audioElement.value.src) {
          try { URL.revokeObjectURL(currentObjectUrl) } catch { /* already revoked */ }
        }
        // Only the original (non-karaoke) blob is owned here; in karaoke mode we used the
        // network instrumental and the cached blob (if any) was already taken from the cache.
        currentObjectUrl = useKaraoke ? null : cachedUrl
        if (useKaraoke && cachedUrl) {
          try { URL.revokeObjectURL(cachedUrl) } catch { /* already revoked */ }
        }

        debugLogger.info('PLAYER', `Calling play() for #${song.id}`)
        await play()
      } finally {
        isTransitioning.value = false
        debugLogger.info('PLAYER', 'isTransitioning=false')
      }

      // Trigger read-ahead caching for upcoming songs
      await triggerReadAheadCache()
    } else {
      isTransitioning.value = false
      debugLogger.error('PLAYER', 'playSongFromHistory: audioElement is null!')
    }
  }

  async function playSong(song: Song, songQueue?: Song[], index?: number) {
    debugLogger.info('PLAYER', `playSong #${song.id} "${song.title}"`)
    if (songQueue) {
      queue.value = songQueue
      currentIndex.value = index || 0
    }

    // Add current song to history before switching to new song
    if (currentSong.value && currentSong.value.id !== song.id) {
      playHistory.value.push(currentSong.value)

      // Keep history to a reasonable size (last 50 songs)
      // In shuffle mode, we only keep the last song for previous functionality
      const maxHistorySize = shuffle.value ? 1 : 50
      if (playHistory.value.length > maxHistorySize) {
        playHistory.value = playHistory.value.slice(-maxHistorySize)
      }
    }

    // Mark transition early — before any async work — so the pause event from the
    // previous song's 'ended' doesn't reset lastPlayState to false
    isTransitioning.value = true
    lastPlayState.value = true

    // Use cached title if available (titles are loaded at startup and cached in localStorage)
    if (song.title.startsWith('Song ')) {
      const cached = songService.getCachedTitle(song.id)
      if (cached) {
        song = { ...song, title: cached }
      }
    }

    currentSong.value = song
    endedHandled.value = false
    if (endFallbackTimeout.value) { clearTimeout(endFallbackTimeout.value); endFallbackTimeout.value = null }

    if (audioElement.value) {
      // Reset time and duration when switching songs
      currentTime.value = 0
      duration.value = 0

      debugLogger.info('PLAYER', `isTransitioning=true — loading #${song.id}`)
      try {
        // Reuse the same audio element and prefer the fully-downloaded in-memory copy
        // (object URL) of this song, so it plays start-to-finish with NO network. That's
        // what makes background auto-advance reliable in an installed PWA, where the OS
        // throttles network once backgrounded (an un-cached track stalls on load or
        // mid-song). Falls back to the normal URL if it wasn't preloaded in time.
        debugLogger.info('PLAYER', `Loading #${song.id} into the active audio element`)
        audioElement.value.pause()
        const cachedUrl = audioCacheService.takeCachedUrl(song.id)
        const useKaraoke = karaokeMode.value && karaokeService.isAvailable(song.id)
        debugLogger.info('PLAYER', `#${song.id} source: ${useKaraoke ? 'KARAOKE INSTRUMENTAL ♪' : cachedUrl ? 'IN-MEMORY BLOB ✓' : 'NETWORK (not preloaded in time)'}`)
        audioElement.value.src = sourceUrlFor(song, cachedUrl)
        audioElement.value.load()
        audioElement.value.currentTime = 0
        // Release the previous track's in-memory blob now that we've switched off it
        if (currentObjectUrl && currentObjectUrl !== audioElement.value.src) {
          try { URL.revokeObjectURL(currentObjectUrl) } catch { /* already revoked */ }
        }
        // Only the original (non-karaoke) blob is owned here; in karaoke mode we used the
        // network instrumental and the cached blob (if any) was already taken from the cache.
        currentObjectUrl = useKaraoke ? null : cachedUrl
        if (useKaraoke && cachedUrl) {
          try { URL.revokeObjectURL(cachedUrl) } catch { /* already revoked */ }
        }

        debugLogger.info('PLAYER', `Calling play() for #${song.id}`)
        await play()
      } finally {
        isTransitioning.value = false
        debugLogger.info('PLAYER', 'isTransitioning=false')
      }

      // Trigger read-ahead caching for upcoming songs
      await triggerReadAheadCache()
    } else {
      isTransitioning.value = false
      debugLogger.error('PLAYER', 'playSong: audioElement is null!')
    }
  }

  async function play() {
    if (!audioElement.value || !currentSong.value) {
      debugLogger.error('PLAYER', 'play(): audioElement or currentSong is null')
      return
    }
    debugLogger.info('PLAYER', `play() called — ${snapAudio()}`)
    try {
      await audioElement.value.play()
      debugLogger.info('PLAYER', 'play() succeeded ✓')
      updateMediaSession()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        debugLogger.warn('PLAYER', 'play(): AbortError — src changed while play was pending, waiting for canplay')
        await new Promise<void>((resolve) => {
          const onReady = () => {
            audioElement.value?.removeEventListener('canplay', onReady)
            resolve()
          }
          audioElement.value?.addEventListener('canplay', onReady, { once: true })
          setTimeout(resolve, 3000)
        })
        try {
          await audioElement.value!.play()
          debugLogger.info('PLAYER', 'play() retry after AbortError succeeded ✓')
          updateMediaSession()
        } catch (e2) {
          debugLogger.error('PLAYER', `play() retry after AbortError FAILED: ${String(e2)}`)
        }
        return
      }
      debugLogger.error('PLAYER', `play() error: ${String(error)}`)
      console.error('Failed to play audio:', error)
      if (error instanceof Error && error.name === 'NotAllowedError') {
        debugLogger.warn('PLAYER', 'play(): NotAllowedError — retrying in 500ms')
        await new Promise(resolve => setTimeout(resolve, 500))
        try {
          await audioElement.value!.play()
          debugLogger.info('PLAYER', 'play() retry after NotAllowedError succeeded ✓')
          updateMediaSession()
        } catch (retryError) {
          debugLogger.error('PLAYER', `play() retry after NotAllowedError FAILED: ${String(retryError)}`)
        }
      }
    }
  }

  function pause() {
    // Explicit stop ends the current session — the session counter restarts at 0
    // next time playback begins.
    sessionPlaytime.value = 0
    if (audioElement.value) {
      audioElement.value.pause()
    }
  }

  async function togglePlay() {
    if (isPlaying.value) {
      pause()
    } else {
      await play()
    }
  }

  function isSongInRange(song: Song): boolean {
    if (!isSongRangeActive.value) return true
    return song.id >= songRangeMin.value && song.id <= songRangeMax.value
  }

  /**
   * Decides which queue index plays next, honouring shuffle / repeat / song-range.
   * Returns -1 when there is no next song (end of queue with repeat off, nothing
   * eligible). Called both to advance and — ahead of time — to preload the next track.
   */
  function pickNextIndex(): number {
    if (queue.value.length === 0) return -1

    if (shuffle.value) {
      const eligibleIndices = queue.value
        .map((song, idx) => ({ song, idx }))
        .filter(({ song }) => isSongInRange(song))
        .map(({ idx }) => idx)
      if (eligibleIndices.length === 0) return -1
      return eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)]
    }

    let nextIndex = currentIndex.value + 1
    if (nextIndex >= queue.value.length) {
      if (repeat.value === 'all') nextIndex = 0
      else return -1
    }

    // In sequential mode with range active, skip songs outside the range
    if (isSongRangeActive.value) {
      const startIndex = nextIndex
      let checked = 0
      while (!isSongInRange(queue.value[nextIndex]) && checked < queue.value.length) {
        nextIndex = (nextIndex + 1) % queue.value.length
        checked++
        if (nextIndex === startIndex) return -1
      }
      if (!isSongInRange(queue.value[nextIndex])) return -1
    }

    return nextIndex
  }

  async function nextSong() {
    debugLogger.info('PLAYER', `nextSong called — currentIndex=${currentIndex.value} shuffle=${shuffle.value} canNext=${canPlayNext.value}`, snapAudio())

    // Prefer the song we already decided on and preloaded when the current track started;
    // only re-pick if that's stale/unset (queue changed, etc.).
    let nextIndex = nextUpIndex.value
    nextUpIndex.value = -1
    if (nextIndex < 0 || nextIndex >= queue.value.length) {
      nextIndex = pickNextIndex()
    }

    if (nextIndex < 0) {
      debugLogger.warn('PLAYER', 'nextSong: no next song — stopping')
      sessionPlaytime.value = 0
      return
    }

    currentIndex.value = nextIndex
    const targetSong = queue.value[nextIndex]
    debugLogger.info('PLAYER', `nextSong: advancing to index=${nextIndex} song=#${targetSong?.id} "${targetSong?.title}"`)

    // Reset network retry attempts for new song
    networkRetryAttempts.value = 0

    try {
      await playSong(targetSong)
    } catch (error) {
      debugLogger.error('PLAYER', 'nextSong: playSong threw', String(error))
      console.error('Failed to play next song:', error)

      // If we're offline, don't keep trying
      if (!isOnline.value) {
        debugLogger.warn('NET', 'Device offline — waiting for connection')
        return
      }

      // If online but failed, try to retry or skip
      handleNetworkRetry()
    }
  }

  async function previousSong() {
    if (!canPlayPrevious.value || playHistory.value.length === 0) return

    // Get the last played song from history
    const previousSong = playHistory.value.pop()
    if (!previousSong) return

    // Find the song in the current queue to set the correct index
    const songIndex = queue.value.findIndex(song => song.id === previousSong.id)
    if (songIndex !== -1) {
      currentIndex.value = songIndex
    }

    // Play the previous song without adding it back to history
    // (since it was already played before)
    await playSongFromHistory(previousSong)
  }

  function seek(time: number) {
    if (audioElement.value) {
      audioElement.value.currentTime = time
      currentTime.value = time
    }
  }

  /**
   * Toggle karaoke (instrumental) mode. The preference is persisted and applies to all
   * songs that have an instrumental. If a song is currently playing and it has an
   * instrumental, the audio source is swapped live, preserving playback position and
   * play/pause state. See KARAOKE.md.
   */
  /** Set karaoke mode explicitly and persist it (no live swap — for fresh playback). */
  function setKaraokeMode(value: boolean) {
    karaokeMode.value = value
    localStorage.setItem(KARAOKE_MODE_KEY, String(value))
  }

  async function toggleKaraoke() {
    karaokeMode.value = !karaokeMode.value
    localStorage.setItem(KARAOKE_MODE_KEY, String(karaokeMode.value))

    const audio = audioElement.value
    const song = currentSong.value
    // Mode flag is flipped regardless; only swap live when the current song actually has
    // an instrumental to switch to/from.
    if (!audio || !song || !karaokeService.isAvailable(song.id)) return

    const newSrc = karaokeMode.value
      ? getInstrumentalUrl(song.id)
      : getMusicUrl(`link.${song.id}.mp3`)
    if (audio.src === newSrc) return

    const wasPlaying = !audio.paused && !audio.ended
    const resumeAt = audio.currentTime || currentTime.value

    isTransitioning.value = true
    const restore = () => {
      try { audio.currentTime = resumeAt } catch { /* not seekable yet */ }
      currentTime.value = resumeAt
    }
    audio.addEventListener('loadedmetadata', restore, { once: true })

    // Drop any in-memory blob we were playing — we're switching to a network source.
    if (currentObjectUrl) {
      try { URL.revokeObjectURL(currentObjectUrl) } catch { /* already revoked */ }
      currentObjectUrl = null
    }

    audio.src = newSrc
    audio.load()
    audio.currentTime = resumeAt
    if (wasPlaying) {
      await play()
    }
    isTransitioning.value = false
  }

  function setVolume(newVolume: number) {
    volume.value = Math.max(0, Math.min(1, newVolume))
    if (audioElement.value) {
      audioElement.value.volume = volume.value
    }
    if (volume.value > 0) {
      isMuted.value = false
    }
  }

  function toggleMute() {
    isMuted.value = !isMuted.value
    if (audioElement.value) {
      audioElement.value.muted = isMuted.value || recordingDuck
    }
  }

  // While the karaoke recorder runs, ITS context plays the instrumental to the speakers;
  // the main element is muted meanwhile — two near-synced copies phase against each other
  // and sound like a dramatic quality drop. User mute state is preserved underneath.
  let recordingDuck = false
  function setRecordingDuck(on: boolean) {
    recordingDuck = on
    if (audioElement.value) {
      audioElement.value.muted = on || isMuted.value
    }
  }

  function toggleShuffle() {
    shuffle.value = !shuffle.value
    
    // When shuffle mode changes, trigger new cache predictions
    if (currentSong.value) {
      triggerReadAheadCache()
    }
  }

  function toggleRepeat() {
    switch (repeat.value) {
      case 'none':
        repeat.value = 'all'
        break
      case 'all':
        repeat.value = 'one'
        break
      case 'one':
        repeat.value = 'none'
        break
    }
    
    // When repeat mode changes, trigger new cache predictions
    if (currentSong.value) {
      triggerReadAheadCache()
    }
  }

  async function handleSongEnd() {
    // Prevent duplicate handling (from both 'ended' event and timeupdate fallback)
    if (endedHandled.value) {
      debugLogger.warn('PLAYER', 'handleSongEnd SKIPPED — already handled', snapAudio())
      return
    }
    endedHandled.value = true
    debugLogger.info('PLAYER', `handleSongEnd called — repeat=${repeat.value}`, snapAudio())

    if (repeat.value === 'one') {
      debugLogger.info('PLAYER', 'Repeat=one: restarting current song')
      await play()
    } else {
      await nextSong()
    }
  }
  
  function setupNetworkListeners() {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      isOnline.value = true
      networkRetryAttempts.value = 0
      console.log('Network connection restored')

      // If we were playing and got disconnected, try to resume
      if (lastPlayState.value && !isPlaying.value && currentSong.value) {
        console.log('Attempting to resume playback after network restore')
        handleNetworkReconnect()
      }
    })

    window.addEventListener('offline', () => {
      isOnline.value = false
      console.log('Network connection lost')
    })

    // Handle app returning to foreground — mobile browsers can suspend audio in background
    document.addEventListener('visibilitychange', () => {
      const hidden = document.hidden
      debugLogger.info('VIS', `visibilitychange — hidden=${hidden} lastPlayState=${lastPlayState.value} ${snapAudio()}`)

      if (hidden) {
        // Record where we were so we can tell, on return, whether the page got frozen
        if (lastPlayState.value && audioElement.value) {
          bgHiddenAt = Date.now()
          bgPlaytimeAtHide = totalPlaytime.value
        } else {
          bgHiddenAt = 0
        }
        return
      }

      // Returning to foreground: did playback freeze while we were away? Compare real
      // elapsed time against actual playback time (totalPlaytime advances ~1/s only while
      // audio is really playing, and keeps counting across song changes; it stops if the
      // page was frozen). A big shortfall after a long background period means the OS
      // throttled us — surface the Chrome "Unrestricted" hint once.
      if (bgHiddenAt > 0 && lastPlayState.value) {
        const wall = (Date.now() - bgHiddenAt) / 1000
        const played = totalPlaytime.value - bgPlaytimeAtHide
        bgHiddenAt = 0
        const isAndroid = /Android/i.test(navigator.userAgent)
        if (isAndroid && wall > 240 && wall - played > 45 &&
            !localStorage.getItem(FREEZE_HINT_DISMISSED_KEY)) {
          debugLogger.warn('VIS', `background freeze detected: ${wall.toFixed(0)}s elapsed, only ${played.toFixed(0)}s played`)
          backgroundFreezeDetected.value = true
        }
      }

      if (!audioElement.value || !currentSong.value || isTransitioning.value) return

      const audio = audioElement.value

      // If we were playing but audio is in error state (background mode on Android Chrome
      // fails all audio loads), reload and play the current song now that we're visible.
      if (lastPlayState.value && audio.error) {
        debugLogger.warn('VIS', `Foreground: audio has error code=${audio.error.code} — reloading current song`)
        playSong(currentSong.value).catch(err => {
          debugLogger.error('VIS', `Failed to reload song on foreground: ${String(err)}`)
        })
        return
      }

      // If we were playing but audio source never loaded (network throttled in background:
      // readyState 0=HAVE_NOTHING, paused=false — stuck), reload the current song.
      if (lastPlayState.value && !audio.paused && audio.readyState < 3) {
        debugLogger.warn('VIS', `Foreground: audio stalled at rs=${audio.readyState} — reloading current song`)
        playSong(currentSong.value).catch(err => {
          debugLogger.error('VIS', `Failed to reload stalled song on foreground: ${String(err)}`)
        })
        return
      }

      // If we were playing but browser paused audio (e.g. device locked), resume
      if (lastPlayState.value && audio.paused) {
        debugLogger.warn('VIS', 'Foreground: audio was paused by browser — resuming')
        audio.play().catch(err => {
          debugLogger.error('VIS', `Failed to resume on foreground: ${String(err)}`)
        })
        return
      }

      // Fallback: song ended in background but 'ended' event never fired (rare browser quirk)
      const dur = audio.duration
      if (dur && isFinite(dur) && dur > 0 && audio.currentTime >= dur - 1 && !endedHandled.value) {
        debugLogger.warn('VIS', `Foreground: song ended while in background but 'ended' never fired — advancing`)
        handleSongEnd().catch(e => console.error('handleSongEnd error:', e))
        return
      }

      debugLogger.info('VIS', `Foreground: no action needed — paused=${audio.paused} lastPlay=${lastPlayState.value} endedHandled=${endedHandled.value}`)
    })
  }
  
  function handleAudioError(error: MediaError) {
    // MediaError codes:
    // 1 = MEDIA_ERR_ABORTED - fetching aborted by user
    // 2 = MEDIA_ERR_NETWORK - network error
    // 3 = MEDIA_ERR_DECODE - decode error
    // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED - source not supported
    
    if (error.code === MediaError.MEDIA_ERR_NETWORK) {
      debugLogger.warn('PLAYER', 'MEDIA_ERR_NETWORK — attempting retry')
      handleNetworkRetry()
    } else if (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      consecutiveFailures.value++
      debugLogger.warn('PLAYER', `MEDIA_ERR_SRC_NOT_SUPPORTED — consecutiveFailures=${consecutiveFailures.value}/${maxConsecutiveFailures}`)
      if (consecutiveFailures.value >= maxConsecutiveFailures) {
        // Don't give up — wait and retry so background playback can recover
        debugLogger.error('PLAYER', `Too many consecutive failures (${consecutiveFailures.value}), cooldown 10s then retry`)
        consecutiveFailures.value = 0
        setTimeout(() => nextSong().catch(e => console.error(e)), 10_000)
        return
      }
      // Skip to next song quickly
      setTimeout(() => nextSong().catch(e => console.error(e)), 50)
    }
  }
  
  async function handleNetworkRetry() {
    if (networkRetryAttempts.value >= maxRetryAttempts) {
      console.log('Max retry attempts reached, giving up')
      return
    }
    
    networkRetryAttempts.value++
    console.log(`Network retry attempt ${networkRetryAttempts.value}/${maxRetryAttempts}`)
    
    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, retryDelay))
    
    if (currentSong.value && audioElement.value) {
      const currentTimeBeforeRetry = currentTime.value
      
      try {
        // Reload the audio source
        audioElement.value.load()
        
        // Try to seek back to where we were
        if (currentTimeBeforeRetry > 0) {
          audioElement.value.currentTime = currentTimeBeforeRetry
        }
        
        // If we were playing, try to resume
        if (lastPlayState.value) {
          await audioElement.value.play()
        }
      } catch (error) {
        console.error('Retry failed:', error)
        
        // If this was the last attempt and we're in auto-play mode, try next song
        if (networkRetryAttempts.value >= maxRetryAttempts) {
          console.log('All retries failed, attempting to play next song')
          setTimeout(() => nextSong(), 1000)
        }
      }
    }
  }
  
  async function handleNetworkReconnect() {
    if (currentSong.value && audioElement.value) {
      try {
        // Reload the current song
        audioElement.value.src = getMusicUrl(`link.${currentSong.value.id}.mp3`)
        audioElement.value.load()
        
        // Wait a bit for the connection to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Try to resume playback
        await audioElement.value.play()
      } catch (error) {
        console.error('Failed to resume after network reconnect:', error)
      }
    }
  }

  /**
   * Transfers event listeners from old audio element to new audio element
   */
  function transferAudioEventListeners(oldAudio: HTMLAudioElement, newAudio: HTMLAudioElement) {
    // Copy volume and mute state
    newAudio.volume = oldAudio.volume
    newAudio.muted = oldAudio.muted
    
    // The event listeners are already set up in initializeAudio()
    // We just need to make sure the new element has them
    setupAudioEventListeners(newAudio)
  }
  
  /**
   * Sets up event listeners for an audio element.
   * Uses AbortController so old listeners are cleanly removed when the audio element is swapped.
   */
  function setupAudioEventListeners(audio: HTMLAudioElement) {
    // Abort and replace the previous controller — this removes all listeners from the old element
    if (currentAudioAbortController) {
      currentAudioAbortController.abort()
    }
    currentAudioAbortController = new AbortController()
    const { signal } = currentAudioAbortController

    audio.addEventListener('loadedmetadata', () => {
      duration.value = audio.duration || 0
      networkRetryAttempts.value = 0
      updateMediaPositionState()
      debugLogger.info('AUDIO', `loadedmetadata — duration=${audio.duration?.toFixed(2)}s`)

      // Cache real duration and update songs store
      if (currentSong.value && audio.duration && isFinite(audio.duration)) {
        const roundedDuration = Math.round(audio.duration)
        songService.cacheDuration(currentSong.value.id, audio.duration)
        if (currentSong.value.duration !== roundedDuration) {
          currentSong.value = { ...currentSong.value, duration: roundedDuration }
        }
        // Update the song in the library so duration shows correctly
        import('@/stores/songs').then(({ useSongsStore }) => {
          useSongsStore().updateSongDuration(currentSong.value!.id, roundedDuration)
        })
      }
    }, { signal })

    let lastLoggedSecond = -1
    let lastPositionSecond = -1
    audio.addEventListener('timeupdate', () => {
      currentTime.value = audio.currentTime || 0

      // Keep the OS media-session position fresh (throttled to ~1/s) so background
      // playback is recognized as live media on stricter Android battery managers.
      const sec = Math.floor(audio.currentTime)
      if (sec !== lastPositionSecond) {
        lastPositionSecond = sec
        updateMediaPositionState()
      }

      // Log progress periodically and near the end (debug only)
      if (isDebugMode) {
        const t = Math.floor(audio.currentTime)
        const dur = audio.duration || 0
        const remaining = dur - audio.currentTime
        if (t !== lastLoggedSecond && (t % 15 === 0 || remaining < 10)) {
          lastLoggedSecond = t
          debugLogger.info('AUDIO', `timeupdate t=${audio.currentTime.toFixed(1)}s remaining=${remaining.toFixed(1)}s endedHandled=${endedHandled.value}`)
        }
      }

      // Fallback end-detection for mobile browsers that may not fire 'ended'
      // Guard: only schedule one timeout per song (timeupdate fires many times near end)
      const dur = audio.duration
      if (dur && isFinite(dur) && dur > 0 && audio.currentTime >= dur - 0.5 && !endedHandled.value && !endFallbackTimeout.value) {
        debugLogger.warn('AUDIO', `timeupdate fallback scheduled — within 0.5s of end`)
        endFallbackTimeout.value = window.setTimeout(() => {
          endFallbackTimeout.value = null
          if (endedHandled.value) return // 'ended' already handled it
          if (!audio.duration || audio.currentTime < audio.duration - 0.5) return // song moved on
          if (document.hidden) {
            // Still in background — do NOT advance here. The visibilitychange handler
            // will call handleSongEnd() when the user returns to the foreground.
            debugLogger.warn('AUDIO', 'timeupdate fallback: still in background — deferring to foreground')
            return
          }
          debugLogger.warn('AUDIO', 'timeupdate fallback: ended event never fired — forcing handleSongEnd')
          handleSongEnd().catch(e => console.error('handleSongEnd error:', e))
        }, 1500)
      }
    }, { signal })

    audio.addEventListener('ended', () => {
      // Cancel the timeupdate fallback — ended fired, no need for the backup timer
      if (endFallbackTimeout.value) { clearTimeout(endFallbackTimeout.value); endFallbackTimeout.value = null }
      debugLogger.info('AUDIO', `ended event fired — hidden=${document.hidden} ${snapAudio()}`)
      // Always advance immediately — iOS allows background audio and will play the next song
      // in background. The 50ms skip delay + 15-failure limit prevents runaway cascades.
      handleSongEnd().catch(e => console.error('handleSongEnd error:', e))
    }, { signal })

    audio.addEventListener('error', (e) => {
      const err = (e.target as HTMLAudioElement).error
      if (err) {
        debugLogger.error('AUDIO', `error event code=${err.code} msg=${err.message}`, snapAudio())
        handleAudioError(err)
      }
    }, { signal })

    audio.addEventListener('stalled', () => {
      debugLogger.warn('AUDIO', `stalled — ${snapAudio()}`)
      if (!isOnline.value) {
        debugLogger.warn('NET', 'stalled but device is offline')
        return
      }
      // Debounce: only retry if stalled for a sustained period (avoids disrupting
      // normal mobile buffering which fires stalled events frequently)
      if (stallTimeout.value) return // already waiting
      stallTimeout.value = window.setTimeout(() => {
        stallTimeout.value = null
        // Only retry if audio is still stalled (networkState 2 = NETWORK_LOADING but no data)
        if (audio.readyState < 3 && !audio.paused && isOnline.value) {
          console.warn('Sustained stall detected, attempting retry')
          handleNetworkRetry()
        }
      }, stallDebounceMs)
    }, { signal })

    // Clear stall timeout when data arrives (stall resolved naturally)
    audio.addEventListener('progress', () => {
      if (stallTimeout.value) {
        clearTimeout(stallTimeout.value)
        stallTimeout.value = null
      }
    }, { signal })

    audio.addEventListener('playing', () => {
      if (stallTimeout.value) {
        clearTimeout(stallTimeout.value)
        stallTimeout.value = null
      }
      // Reset failure streak — audio is actually decoding, so the file exists and is valid
      consecutiveFailures.value = 0
      // Start playtime tracking here (not on 'play') so we only count real audio output
      startPlaytimeTracking()
      // Start sleep timer countdown here so it only ticks against real playback,
      // not against the cascade of instant-fail 'play' events for missing files
      if (sleepTimer.value > 0 && sleepTimerRemaining.value > 0 && !sleepTimerInterval.value) {
        startSleepTimerCountdown()
      }
      debugLogger.info('AUDIO', `playing event (audio decoding) — consecutiveFailures reset — ${snapAudio()}`)
    }, { signal })

    audio.addEventListener('play', () => {
      debugLogger.info('AUDIO', `play event fired — ${snapAudio()}`)
      isPlaying.value = true
      sessionStartTime.value = Date.now()
      lastPlayState.value = true
      // NOTE: startPlaytimeTracking() and startSleepTimerCountdown() are intentionally
      // called from the 'playing' event, not here. The 'play' event fires even for URLs
      // that fail immediately (missing MP3s), so we defer those to 'playing' which only
      // fires when the browser actually starts decoding audio.
      updateMediaSession()
    }, { signal })

    audio.addEventListener('pause', () => {
      // Skip state updates during song transitions — playSong calls pause() before loading the
      // next track, so this pause is intentional and play() will be called right after
      debugLogger.info('AUDIO', `pause event fired — transitioning=${isTransitioning.value} ${snapAudio()}`)
      if (isTransitioning.value) return
      isPlaying.value = false
      stopPlaytimeTracking()
      stopSleepTimerCountdown()
      lastPlayState.value = false
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    }, { signal })

  }
  
  /**
   * Decides the exact next song now and preloads it, so it's already buffered when the
   * current track ends. This is what lets background auto-advance work in an installed
   * PWA: the next track is served from cache instead of a background network fetch (which
   * the PWA blocks). Previously the preloader guessed via a separate random pick that
   * rarely matched the song nextSong() actually chose in shuffle mode.
   */
  /**
   * Ordered list of candidate next-song indices to try, honouring shuffle / sequential /
   * range / repeat. Used to find a next song that actually preloads.
   */
  function nextIndexCandidates(max: number): number[] {
    if (queue.value.length === 0) return []

    if (shuffle.value) {
      const eligible = queue.value
        .map((song, idx) => ({ song, idx }))
        .filter(({ song }) => isSongInRange(song))
        .map(({ idx }) => idx)
      // Fisher–Yates shuffle, then take up to `max`
      for (let i = eligible.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const t = eligible[i]; eligible[i] = eligible[j]; eligible[j] = t
      }
      return eligible.slice(0, max)
    }

    const out: number[] = []
    let idx = currentIndex.value + 1
    for (let c = 0; c < queue.value.length && out.length < max; c++, idx++) {
      if (idx >= queue.value.length) {
        if (repeat.value === 'all') idx = 0
        else break
      }
      if (!isSongRangeActive.value || isSongInRange(queue.value[idx])) out.push(idx)
    }
    return out
  }

  /**
   * Decides the next song now and preloads it so it's already buffered when the current
   * track ends — required for background auto-advance in an installed PWA, which blocks
   * background network fetches. Crucially it VALIDATES each candidate by preloading and
   * skips any that fail (corrupt/unsupported files): a bad next song would error at
   * end-of-song and, in the background, the fallback isn't cached, so playback dies until
   * the app is refocused. We pick the first candidate that actually buffers.
   */
  async function triggerReadAheadCache() {
    if (queue.value.length === 0 || currentIndex.value < 0) {
      nextUpIndex.value = -1
      return
    }

    const candidates = nextIndexCandidates(8)
    if (candidates.length === 0) { nextUpIndex.value = -1; return }
    nextUpIndex.value = candidates[0] // tentative until one validates

    for (const idx of candidates) {
      const song = queue.value[idx]
      if (!song) continue
      debugLogger.info('PLAYER', `read-ahead: downloading candidate #${song.id} "${song.title}"…`)
      try {
        await audioCacheService.preloadSong(song)
      } catch (error) {
        console.warn('Error during song preloading:', error)
      }
      if (audioCacheService.isPlayable(song.id)) {
        nextUpIndex.value = idx
        const cached = audioCacheService.isCached(song.id)
        debugLogger.info('PLAYER', `read-ahead: next #${song.id} "${song.title}" ${cached ? 'cached in memory' : 'too large — will stream'}`)
        return
      }
      debugLogger.warn('PLAYER', `read-ahead: #${song.id} "${song.title}" unreachable/broken — skipping`)
    }
    debugLogger.warn('PLAYER', 'read-ahead: no playable candidate found')
  }

  function updateMediaSession() {
    if ('mediaSession' in navigator && currentSong.value) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.value.title,
        artist: 'Unknown Artist',
        artwork: [
          { src: getPosterUrl(currentSong.value.id), sizes: '600x600', type: 'image/jpeg' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }
        ]
      })

      navigator.mediaSession.setActionHandler('play', () => play())
      navigator.mediaSession.setActionHandler('pause', pause)
      navigator.mediaSession.setActionHandler('nexttrack', () => nextSong())
      navigator.mediaSession.setActionHandler('previoustrack', () => previousSong())

      // Tell the OS whether we're actively playing. Stricter Android battery managers
      // use this to decide whether to keep a backgrounded media app alive.
      navigator.mediaSession.playbackState = isPlaying.value ? 'playing' : 'paused'
      updateMediaPositionState()
    }
  }

  /**
   * Reports the current playback position to the OS media session. A continuously
   * updated position is part of what marks the app as a live media player, which helps
   * background playback survive aggressive battery optimization (e.g. newer OneUI).
   */
  function updateMediaPositionState() {
    if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return
    const audio = audioElement.value
    if (!audio) return
    const dur = audio.duration
    if (!dur || !isFinite(dur) || dur <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(audio.currentTime, 0), dur)
      })
    } catch {
      // setPositionState throws on inconsistent values mid-transition — safe to ignore
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  function setSleepTimer(minutes: number) {
    sleepTimer.value = minutes
    
    // Clear existing timer
    if (sleepTimerInterval.value) {
      clearInterval(sleepTimerInterval.value)
      sleepTimerInterval.value = null
    }
    
    if (minutes > 0) {
      // Always set remaining time in seconds when user selects a timer
      sleepTimerRemaining.value = minutes * 60
      
      // Only start countdown if music is currently playing
      if (isPlaying.value) {
        startSleepTimerCountdown()
      }
      
      console.log(`Sleep timer set for ${minutes} minutes`)
    } else {
      sleepTimerRemaining.value = 0
    }
    
    // Save the setting and remaining time
    saveSleepTimer()
  }

  function startSleepTimerCountdown() {
    if (sleepTimer.value > 0 && sleepTimerRemaining.value > 0) {
      sleepTimerInterval.value = setInterval(() => {
        sleepTimerRemaining.value--
        
        // Save every 10 seconds to persist remaining time
        if (sleepTimerRemaining.value % 10 === 0) {
          saveSleepTimer()
        }
        
        if (sleepTimerRemaining.value <= 0) {
          // Time's up, pause playback
          pause()
          clearSleepTimer()
          console.log('Sleep timer expired, playback paused')
        }
      }, 1000)
    }
  }

  function stopSleepTimerCountdown() {
    if (sleepTimerInterval.value) {
      clearInterval(sleepTimerInterval.value)
      sleepTimerInterval.value = null
      // Save the current state when stopping
      saveSleepTimer()
    }
  }

  function clearSleepTimer() {
    if (sleepTimerInterval.value) {
      clearInterval(sleepTimerInterval.value)
      sleepTimerInterval.value = null
    }
    sleepTimer.value = 0
    sleepTimerRemaining.value = 0
    saveSleepTimer()
    console.log('Sleep timer cleared')
  }

  function toggleSleepTimer() {
    // Cycle through timer options: 0 -> 30 -> 60 -> 90 -> 120 -> 0
    const options = [0, 30, 60, 90, 120]
    const currentIndex = options.indexOf(sleepTimer.value)
    const nextIndex = (currentIndex + 1) % options.length
    setSleepTimer(options[nextIndex])
  }

  function startPlaytimeTracking() {
    // Clear any existing interval
    if (playtimeInterval.value) {
      clearInterval(playtimeInterval.value)
    }
    
    // Start new interval to increment playtime every second
    playtimeInterval.value = setInterval(() => {
      totalPlaytime.value += 1
      sessionPlaytime.value += 1

      // Save to localStorage every 10 seconds to avoid too many writes
      if (totalPlaytime.value % 10 === 0) {
        saveTotalPlaytime()
      }
    }, 1000)
  }

  function stopPlaytimeTracking() {
    if (playtimeInterval.value) {
      clearInterval(playtimeInterval.value)
      playtimeInterval.value = null
      // Save current state when stopping
      saveTotalPlaytime()
    }
  }

  function updateTotalPlaytime() {
    // This function is kept for compatibility but now just saves
    saveTotalPlaytime()
  }

  function loadTotalPlaytime() {
    const saved = localStorage.getItem('music-player-total-playtime')
    if (saved) {
      totalPlaytime.value = parseInt(saved, 10) || 0
    }
  }

  function saveTotalPlaytime() {
    localStorage.setItem('music-player-total-playtime', totalPlaytime.value.toString())
  }

  function resetTotalPlaytime() {
    totalPlaytime.value = 0
    saveTotalPlaytime()
  }

  function loadSleepTimer() {
    const savedTimer = localStorage.getItem('music-player-sleep-timer')
    const savedRemaining = localStorage.getItem('music-player-sleep-timer-remaining')
    const savedTimestamp = localStorage.getItem('music-player-sleep-timer-timestamp')
    
    if (savedTimer) {
      const minutes = parseInt(savedTimer, 10) || 0
      if (minutes > 0) {
        sleepTimer.value = minutes
        
        // If there was remaining time saved, calculate how much time has passed
        if (savedRemaining && savedTimestamp) {
          const remaining = parseInt(savedRemaining, 10) || 0
          const timestamp = parseInt(savedTimestamp, 10) || 0
          const now = Date.now()
          const timePassed = Math.floor((now - timestamp) / 1000)
          
          // Calculate current remaining time
          const currentRemaining = Math.max(0, remaining - timePassed)
          
          if (currentRemaining > 0) {
            sleepTimerRemaining.value = currentRemaining
            console.log(`Sleep timer restored: ${Math.floor(currentRemaining / 60)}:${(currentRemaining % 60).toString().padStart(2, '0')} remaining`)
          } else {
            // Timer would have expired, clear it
            clearSleepTimer()
          }
        } else {
          // No active timer, but user had this setting - restore with full time
          sleepTimerRemaining.value = minutes * 60
          console.log(`Sleep timer setting restored: ${minutes} minutes (${sleepTimerRemaining.value} seconds)`)
        }
      }
    } else {
      // First time user - set default 60 minutes sleep timer
      sleepTimer.value = 60
      sleepTimerRemaining.value = 60 * 60 // 60 minutes in seconds
      saveSleepTimer()
      console.log('Default sleep timer set: 60 minutes')
    }
  }

  function setSongRange(min: number, max: number) {
    songRangeMin.value = min
    songRangeMax.value = max
    saveSongRange()
    console.log(`Song range set: ${min} - ${max}`)
  }

  function clearSongRange() {
    songRangeMin.value = 0
    songRangeMax.value = 0
    saveSongRange()
    console.log('Song range cleared')
  }

  function loadSongRange() {
    const saved = localStorage.getItem('music-player-song-range')
    if (saved) {
      try {
        const { min, max } = JSON.parse(saved)
        songRangeMin.value = min || 0
        songRangeMax.value = max || 0
      } catch {
        songRangeMin.value = 0
        songRangeMax.value = 0
      }
    }
  }

  function saveSongRange() {
    if (songRangeMin.value > 0 && songRangeMax.value > 0) {
      localStorage.setItem('music-player-song-range', JSON.stringify({
        min: songRangeMin.value,
        max: songRangeMax.value
      }))
    } else {
      localStorage.removeItem('music-player-song-range')
    }
  }

  function saveSleepTimer() {
    localStorage.setItem('music-player-sleep-timer', sleepTimer.value.toString())
    
    if (sleepTimer.value > 0 && sleepTimerRemaining.value > 0) {
      // Save the remaining time and current timestamp
      localStorage.setItem('music-player-sleep-timer-remaining', sleepTimerRemaining.value.toString())
      localStorage.setItem('music-player-sleep-timer-timestamp', Date.now().toString())
    } else {
      // Clear the remaining time data
      localStorage.removeItem('music-player-sleep-timer-remaining')
      localStorage.removeItem('music-player-sleep-timer-timestamp')
    }
  }

  /** Dismiss the background-freeze hint and remember not to show it again. */
  function dismissBackgroundFreezeHint() {
    backgroundFreezeDetected.value = false
    localStorage.setItem(FREEZE_HINT_DISMISSED_KEY, '1')
  }

  return {
    // State
    currentSong,
    isPlaying,
    volume,
    isMuted,
    currentTime,
    duration,
    shuffle,
    repeat,
    queue,
    currentIndex,
    playHistory,
    sleepTimer,
    sleepTimerRemaining,
    totalPlaytime,
    sessionPlaytime,
    audioElement,
    songRangeMin,
    songRangeMax,
    isOnline,
    networkRetryAttempts,
    backgroundFreezeDetected,
    dismissBackgroundFreezeHint,
    karaokeMode,

    // Getters
    progress,
    karaokeAvailable,
    formattedCurrentTime,
    formattedDuration,
    canPlayNext,
    canPlayPrevious,
    isSleepTimerActive,
    formattedSleepTimer,
    formattedTotalPlaytime,
    formattedSessionPlaytime,
    isSongRangeActive,
    
    // Debug-exposed internals
    endedHandled,
    isTransitioning,
    lastPlayState,

    // Actions
    initializeAudio,
    playSong,
    play,
    pause,
    togglePlay,
    nextSong,
    previousSong,
    seek,
    toggleKaraoke,
    setKaraokeMode,
    setVolume,
    toggleMute,
    setRecordingDuck,
    toggleShuffle,
    toggleRepeat,
    setSleepTimer,
    clearSleepTimer,
    toggleSleepTimer,
    resetTotalPlaytime,
    stopPlaytimeTracking,
    triggerReadAheadCache,
    setSongRange,
    clearSongRange
  }
})