import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Song, PlayerState, PlayMode } from '@/types'
import { getMusicUrl } from '@/config'
import { songService } from '@/services/songService'
import { audioCacheService } from '@/services/audioCacheService'
import { songPredictionService } from '@/services/songPredictionService'

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
  const audioElement = ref<HTMLAudioElement | null>(null)
  const playHistory = ref<Song[]>([]) // Track actually played songs for previous functionality
  
  // Sleep timer state
  const sleepTimer = ref(0) // Default off, user needs to set it explicitly
  const sleepTimerRemaining = ref(0) // Remaining time in seconds
  const sleepTimerInterval = ref<number | null>(null)
  
  // Total playtime tracking
  const totalPlaytime = ref(0) // Total seconds played since start
  const sessionStartTime = ref(0) // When current play session started
  const lastPlayState = ref(false) // Previous playing state
  const playtimeInterval = ref<number | null>(null) // Interval for updating playtime
  
  // Network connectivity tracking
  const isOnline = ref(navigator.onLine)
  const networkRetryAttempts = ref(0)
  const maxRetryAttempts = 3
  const retryDelay = 2000 // 2 seconds

  // Getters
  const progress = computed(() => {
    return duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
  })

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

  // Actions
  function initializeAudio() {
    audioElement.value = new Audio()
    audioElement.value.volume = volume.value
    
    // Load saved settings
    loadTotalPlaytime()
    loadSleepTimer()
    
    // Setup network connectivity listeners
    setupNetworkListeners()
    
    // Setup audio event listeners
    setupAudioEventListeners(audioElement.value)
  }

  async function playSongFromHistory(song: Song) {
    // This function plays a song from history without adding it to history again
    currentSong.value = song

    if (audioElement.value) {
      // Reset time and duration when switching songs
      currentTime.value = 0
      duration.value = 0

      // Check if we have a cached version of this song
      const cachedAudio = audioCacheService.getCachedAudio(song.id)

      if (cachedAudio) {
        // Stop and pause current audio before switching to cached audio
        audioElement.value.pause()
        audioElement.value.currentTime = 0

        // Transfer state from current audio to cached audio
        audioCacheService.transferAudioState(audioElement.value, cachedAudio)

        // Replace the current audio element with the cached one
        const oldAudio = audioElement.value
        audioElement.value = cachedAudio

        // Reset the audio time to 0:00
        audioElement.value.currentTime = 0

        // Transfer all event listeners to the new audio element
        transferAudioEventListeners(oldAudio, audioElement.value)

        // Remove the old audio from cache to free memory
        audioCacheService.removeSongFromCache(song.id)

        console.log(`🚀 Using cached audio for: ${song.title}`)
      } else {
        // Stop and pause current audio before switching to new song
        audioElement.value.pause()
        audioElement.value.currentTime = 0

        // Normal loading for non-cached songs
        audioElement.value.src = getMusicUrl(`link.${song.id}.mp3`)
        audioElement.value.load()

        // Reset the audio time to 0:00
        audioElement.value.currentTime = 0
      }

      await play()

      // Trigger read-ahead caching for upcoming songs
      await triggerReadAheadCache()
    }
  }

  async function playSong(song: Song, songQueue?: Song[], index?: number) {
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

    // Load proper title if it's still generic
    if (song.title.startsWith('Song ')) {
      try {
        const updatedTitle = await songService.getTitleFromLyrics(song.id)
        song = { ...song, title: updatedTitle }
      } catch (error) {
        console.error('Error loading song title:', error)
      }
    }

    currentSong.value = song

    if (audioElement.value) {
      // Reset time and duration when switching songs
      currentTime.value = 0
      duration.value = 0

      // Check if we have a cached version of this song
      const cachedAudio = audioCacheService.getCachedAudio(song.id)

      if (cachedAudio) {
        // Stop and pause current audio before switching to cached audio
        audioElement.value.pause()
        audioElement.value.currentTime = 0

        // Transfer state from current audio to cached audio
        audioCacheService.transferAudioState(audioElement.value, cachedAudio)

        // Replace the current audio element with the cached one
        const oldAudio = audioElement.value
        audioElement.value = cachedAudio

        // Reset the audio time to 0:00
        audioElement.value.currentTime = 0

        // Transfer all event listeners to the new audio element
        transferAudioEventListeners(oldAudio, audioElement.value)

        // Remove the old audio from cache to free memory
        audioCacheService.removeSongFromCache(song.id)

        console.log(`🚀 Using cached audio for: ${song.title}`)
      } else {
        // Stop and pause current audio before switching to new song
        audioElement.value.pause()
        audioElement.value.currentTime = 0

        // Normal loading for non-cached songs
        audioElement.value.src = getMusicUrl(`link.${song.id}.mp3`)
        audioElement.value.load()

        // Reset the audio time to 0:00
        audioElement.value.currentTime = 0
      }

      await play()

      // Trigger read-ahead caching for upcoming songs
      await triggerReadAheadCache()
    }
  }

  async function play() {
    if (audioElement.value && currentSong.value) {
      try {
        await audioElement.value.play()
        updateMediaSession()
      } catch (error) {
        console.error('Failed to play audio:', error)
        // Handle autoplay policy restrictions
        if (error instanceof Error && error.name === 'NotAllowedError') {
          console.warn('Autoplay blocked by browser. User interaction required.')
        }
      }
    }
  }

  function pause() {
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

  async function nextSong() {
    if (!canPlayNext.value) return

    let nextIndex = currentIndex.value + 1

    if (shuffle.value) {
      nextIndex = Math.floor(Math.random() * queue.value.length)
    } else if (nextIndex >= queue.value.length) {
      if (repeat.value === 'all') {
        nextIndex = 0
      } else {
        return
      }
    }

    currentIndex.value = nextIndex
    
    // Reset network retry attempts for new song
    networkRetryAttempts.value = 0
    
    try {
      await playSong(queue.value[nextIndex])
    } catch (error) {
      console.error('Failed to play next song:', error)
      
      // If we're offline, don't keep trying
      if (!isOnline.value) {
        console.log('Device offline, waiting for network connection to resume playback')
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
      audioElement.value.muted = isMuted.value
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
    if (repeat.value === 'one') {
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
  }
  
  function handleAudioError(error: MediaError) {
    // MediaError codes:
    // 1 = MEDIA_ERR_ABORTED - fetching aborted by user
    // 2 = MEDIA_ERR_NETWORK - network error
    // 3 = MEDIA_ERR_DECODE - decode error
    // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED - source not supported
    
    if (error.code === MediaError.MEDIA_ERR_NETWORK) {
      console.log('Network error detected, attempting retry...')
      handleNetworkRetry()
    } else if (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      console.error('Audio source not supported, skipping to next song')
      setTimeout(() => nextSong(), 1000)
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
   * Sets up event listeners for an audio element
   */
  function setupAudioEventListeners(audio: HTMLAudioElement) {
    audio.addEventListener('loadedmetadata', () => {
      duration.value = audio.duration || 0
      networkRetryAttempts.value = 0
    })

    audio.addEventListener('timeupdate', () => {
      currentTime.value = audio.currentTime || 0
    })

    audio.addEventListener('ended', () => {
      handleSongEnd()
    })
    
    audio.addEventListener('error', (e) => {
      const error = e.target as HTMLAudioElement
      if (error.error) {
        console.error('Audio error:', error.error.code, error.error.message)
        handleAudioError(error.error)
      }
    })
    
    audio.addEventListener('stalled', () => {
      console.warn('Audio stalled - possible network issue')
      if (!isOnline.value) {
        console.log('Device is offline, waiting for connection...')
      } else {
        handleNetworkRetry()
      }
    })

    audio.addEventListener('play', () => {
      isPlaying.value = true
      sessionStartTime.value = Date.now()
      lastPlayState.value = true
      startPlaytimeTracking()
      
      if (sleepTimer.value > 0 && sleepTimerRemaining.value > 0 && !sleepTimerInterval.value) {
        startSleepTimerCountdown()
      }
      
      updateMediaSession()
    })

    audio.addEventListener('pause', () => {
      isPlaying.value = false
      stopPlaytimeTracking()
      stopSleepTimerCountdown()
      lastPlayState.value = false
    })
  }
  
  /**
   * Triggers read-ahead caching for upcoming songs
   */
  async function triggerReadAheadCache() {
    if (queue.value.length === 0 || currentIndex.value < 0) {
      return
    }
    
    const playerState = {
      queue: queue.value,
      currentIndex: currentIndex.value,
      shuffle: shuffle.value,
      repeat: repeat.value
    }
    
    // Predict upcoming songs
    const upcomingSongs = songPredictionService.predictUpcomingSongs(playerState, 2)
    
    if (upcomingSongs.length > 0) {
      console.log(`🎵 Pre-loading ${upcomingSongs.length} upcoming songs:`, upcomingSongs.map(s => s.title))
      
      // Start preloading in background (non-blocking)
      audioCacheService.preloadSongs(upcomingSongs).catch(error => {
        console.warn('Error during song preloading:', error)
      })
    }
  }

  function updateMediaSession() {
    if ('mediaSession' in navigator && currentSong.value) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.value.title,
        artist: 'Unknown Artist',
        artwork: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }
        ]
      })

      navigator.mediaSession.setActionHandler('play', () => play())
      navigator.mediaSession.setActionHandler('pause', pause)
      navigator.mediaSession.setActionHandler('nexttrack', () => nextSong())
      navigator.mediaSession.setActionHandler('previoustrack', () => previousSong())
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
    
    // Start new interval to increment total playtime every second
    playtimeInterval.value = setInterval(() => {
      totalPlaytime.value += 1
      
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
    audioElement,
    isOnline,
    networkRetryAttempts,
    
    // Getters
    progress,
    formattedCurrentTime,
    formattedDuration,
    canPlayNext,
    canPlayPrevious,
    isSleepTimerActive,
    formattedSleepTimer,
    formattedTotalPlaytime,
    
    // Actions
    initializeAudio,
    playSong,
    play,
    pause,
    togglePlay,
    nextSong,
    previousSong,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    setSleepTimer,
    clearSleepTimer,
    toggleSleepTimer,
    resetTotalPlaytime,
    stopPlaytimeTracking,
    triggerReadAheadCache
  }
})