import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Song, PlayerState, PlayMode } from '@/types'
import { getMusicUrl } from '@/config'
import { songService } from '@/services/songService'

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
  
  // Sleep timer state
  const sleepTimer = ref(0) // Default off, user needs to set it explicitly
  const sleepTimerRemaining = ref(0) // Remaining time in seconds
  const sleepTimerInterval = ref<number | null>(null)
  
  // Total playtime tracking
  const totalPlaytime = ref(0) // Total seconds played since start
  const sessionStartTime = ref(0) // When current play session started
  const lastPlayState = ref(false) // Previous playing state
  const playtimeInterval = ref<number | null>(null) // Interval for updating playtime

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
    return currentIndex.value > 0 || repeat.value === 'all'
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

    audioElement.value.addEventListener('loadedmetadata', () => {
      duration.value = audioElement.value?.duration || 0
    })

    audioElement.value.addEventListener('timeupdate', () => {
      currentTime.value = audioElement.value?.currentTime || 0
    })

    audioElement.value.addEventListener('ended', () => {
      handleSongEnd()
    })

    audioElement.value.addEventListener('play', () => {
      isPlaying.value = true
      sessionStartTime.value = Date.now()
      lastPlayState.value = true
      startPlaytimeTracking()
      
      // Start sleep timer countdown if timer is set but not running
      if (sleepTimer.value > 0 && sleepTimerRemaining.value > 0 && !sleepTimerInterval.value) {
        startSleepTimerCountdown()
      }
      
      updateMediaSession()
    })

    audioElement.value.addEventListener('pause', () => {
      isPlaying.value = false
      stopPlaytimeTracking()
      stopSleepTimerCountdown()
      lastPlayState.value = false
    })
  }

  async function playSong(song: Song, songQueue?: Song[], index?: number) {
    if (songQueue) {
      queue.value = songQueue
      currentIndex.value = index || 0
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
      audioElement.value.src = getMusicUrl(`link.${song.id}.mp3`)
      audioElement.value.load()
      await play()
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
    await playSong(queue.value[nextIndex])
  }

  async function previousSong() {
    if (!canPlayPrevious.value) return

    let prevIndex = currentIndex.value - 1

    if (prevIndex < 0) {
      if (repeat.value === 'all') {
        prevIndex = queue.value.length - 1
      } else {
        return
      }
    }

    currentIndex.value = prevIndex
    await playSong(queue.value[prevIndex])
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
  }

  async function handleSongEnd() {
    if (repeat.value === 'one') {
      await play()
    } else {
      await nextSong()
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
    sleepTimer,
    sleepTimerRemaining,
    totalPlaytime,
    
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
    stopPlaytimeTracking
  }
})