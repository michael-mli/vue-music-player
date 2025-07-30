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
  const shuffle = ref(false)
  const repeat = ref<'none' | 'one' | 'all'>('none')
  const queue = ref<Song[]>([])
  const currentIndex = ref(0)
  const audioElement = ref<HTMLAudioElement | null>(null)

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

  // Actions
  function initializeAudio() {
    audioElement.value = new Audio()
    audioElement.value.volume = volume.value

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
      updateMediaSession()
    })

    audioElement.value.addEventListener('pause', () => {
      isPlaying.value = false
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
      play()
    }
  }

  function play() {
    if (audioElement.value && currentSong.value) {
      audioElement.value.play()
      updateMediaSession()
    }
  }

  function pause() {
    if (audioElement.value) {
      audioElement.value.pause()
    }
  }

  function togglePlay() {
    if (isPlaying.value) {
      pause()
    } else {
      play()
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
      play()
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

      navigator.mediaSession.setActionHandler('play', play)
      navigator.mediaSession.setActionHandler('pause', pause)
      navigator.mediaSession.setActionHandler('nexttrack', nextSong)
      navigator.mediaSession.setActionHandler('previoustrack', previousSong)
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
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
    
    // Getters
    progress,
    formattedCurrentTime,
    formattedDuration,
    canPlayNext,
    canPlayPrevious,
    
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
    toggleRepeat
  }
})