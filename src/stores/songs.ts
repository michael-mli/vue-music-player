import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Song } from '@/types'
import { songService } from '@/services/songService'
import config from '@/config'

export const useSongsStore = defineStore('songs', () => {
  // State
  const songs = ref<Song[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref('')
  const currentPage = ref(1)
  const pageSize = ref(config.songsPerPage)

  // Getters
  const filteredSongs = computed(() => {
    if (!searchQuery.value) return songs.value
    
    const query = searchQuery.value.toLowerCase()
    return songs.value.filter(song => 
      song.title.toLowerCase().includes(query) ||
      song.lyrics?.toLowerCase().includes(query)
    )
  })

  const paginatedSongs = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value
    const end = start + pageSize.value
    return filteredSongs.value.slice(start, end)
  })

  const totalPages = computed(() => {
    return Math.ceil(filteredSongs.value.length / pageSize.value)
  })

  const favoriteSongs = computed(() => {
    return songs.value.filter(song => song.isFavorite)
  })

  // Actions
  async function fetchSongs() {
    try {
      loading.value = true
      error.value = null
      
      // Use mock data in development or when explicitly enabled
      if (config.enableMockData) {
        const response = await songService.getMockSongs()
        songs.value = response.data
      } else {
        const response = await songService.getAllSongs()
        songs.value = response.data
      }
    } catch (err) {
      error.value = 'Failed to load songs'
      console.error('Error fetching songs:', err)
    } finally {
      loading.value = false
    }
  }

  async function getSongById(id: number): Promise<Song | undefined> {
    let song = songs.value.find(s => s.id === id)
    
    if (!song) {
      try {
        const response = await songService.getSong(id)
        song = response.data
        // Add to songs array if not exists
        if (song && !songs.value.find(s => s.id === song!.id)) {
          songs.value.push(song)
        }
      } catch (err) {
        console.error('Error fetching song:', err)
      }
    }
    
    // Update title from lyrics if it's still generic
    if (song && song.title.startsWith('Song ')) {
      try {
        const updatedSong = await songService.updateSongTitle(song)
        // Update the song in the array
        const index = songs.value.findIndex(s => s.id === song!.id)
        if (index !== -1) {
          songs.value[index] = updatedSong
        }
        song = updatedSong
      } catch (err) {
        console.error('Error updating song title:', err)
      }
    }
    
    return song
  }

  async function getSongLyrics(id: number): Promise<string> {
    try {
      // Use mock lyrics for development
      const response = await songService.getMockLyrics(id)
      return response.data
    } catch (err) {
      console.error('Error fetching lyrics:', err)
      return ''
    }
  }

  function searchSongs(query: string) {
    searchQuery.value = query
    currentPage.value = 1
  }

  function clearSearch() {
    searchQuery.value = ''
    currentPage.value = 1
  }

  async function setPage(page: number) {
    currentPage.value = Math.max(1, Math.min(page, totalPages.value))
    // Load titles for songs on the new page
    await loadTitlesForCurrentPage()
  }

  // Load titles for songs currently visible on the page
  async function loadTitlesForCurrentPage() {
    const startIndex = (currentPage.value - 1) * pageSize.value
    const endIndex = Math.min(startIndex + pageSize.value, songs.value.length)
    
    const titlePromises = []
    const songsToUpdate = []
    
    for (let i = startIndex; i < endIndex; i++) {
      const song = songs.value[i]
      if (song && song.title.startsWith('Song ')) {
        songsToUpdate.push({ index: i, song })
        titlePromises.push(songService.getTitleFromLyrics(song.id))
      }
    }
    
    if (titlePromises.length > 0) {
      try {
        const titles = await Promise.all(titlePromises)
        
        titles.forEach((title, idx) => {
          const { index, song } = songsToUpdate[idx]
          songs.value[index] = {
            ...song,
            title: title
          }
        })
      } catch (error) {
        console.error('Error loading page titles:', error)
      }
    }
  }

  async function nextPage() {
    if (currentPage.value < totalPages.value) {
      currentPage.value++
      await loadTitlesForCurrentPage()
    }
  }

  async function previousPage() {
    if (currentPage.value > 1) {
      currentPage.value--
      await loadTitlesForCurrentPage()
    }
  }

  async function toggleFavorite(songId: number) {
    const song = songs.value.find(s => s.id === songId)
    if (song) {
      song.isFavorite = !song.isFavorite
      // TODO: Persist to backend
    }
  }

  function getRandomSongs(count: number = 10): Song[] {
    const shuffled = [...songs.value].sort(() => 0.5 - Math.random())
    return shuffled.slice(0, count)
  }

  return {
    // State
    songs,
    loading,
    error,
    searchQuery,
    currentPage,
    pageSize,
    
    // Getters
    filteredSongs,
    paginatedSongs,
    totalPages,
    favoriteSongs,
    
    // Actions
    fetchSongs,
    getSongById,
    getSongLyrics,
    searchSongs,
    clearSearch,
    setPage,
    nextPage,
    previousPage,
    toggleFavorite,
    getRandomSongs,
    loadTitlesForCurrentPage
  }
})