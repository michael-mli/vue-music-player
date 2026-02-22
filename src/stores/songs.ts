import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Song } from '@/types'
import { songService } from '@/services/songService'
import config from '@/config'
import { stripHtmlTags } from '@/utils/htmlSanitizer'

export const useSongsStore = defineStore('songs', () => {
  // State
  const songs = ref<Song[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref('')
  const currentPage = ref(1)
  const pageSize = ref(config.songsPerPage)

  // Title loading progress (0–100, -1 = not loading)
  const titleLoadingProgress = ref(-1)

  // State for search with lyrics
  const searchResults = ref<Song[]>([])
  const isSearching = ref(false)

  // Getters
  const filteredSongs = computed(() => {
    if (!searchQuery.value) return songs.value
    
    // Return search results if we have them from lyrics search
    if (searchResults.value.length > 0 || isSearching.value) {
      return searchResults.value
    }
    
    // Fallback to basic title search
    const query = searchQuery.value.toLowerCase()
    return songs.value.filter(song => 
      song.title.toLowerCase().includes(query)
    )
  })

  const paginatedSongs = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value
    const end = start + pageSize.value
    return songs.value.slice(start, end)
  })

  const paginatedSearchSongs = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value
    const end = start + pageSize.value
    return filteredSongs.value.slice(start, end)
  })

  const totalPages = computed(() => {
    return Math.ceil(songs.value.length / pageSize.value)
  })

  const totalSearchPages = computed(() => {
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

      let raw: Song[]
      // Use mock data in development or when explicitly enabled
      if (config.enableMockData) {
        const response = await songService.getMockSongs()
        raw = response.data
      } else {
        const response = await songService.getAllSongs()
        raw = response.data
      }

      songs.value = raw
    } catch (err) {
      error.value = 'Failed to load songs'
      console.error('Error fetching songs:', err)
    } finally {
      loading.value = false
    }
  }

  // Fetch uncached song titles in the background, updating songs in-place as they arrive.
  async function fetchUncachedTitles() {
    if (!config.enableMockData) return
    const maxId = songs.value.length > 0 ? Math.max(...songs.value.map(s => s.id)) : 0
    if (maxId === 0) return

    titleLoadingProgress.value = 0
    const fetchedIds = await songService.fetchUncachedTitles(maxId, (fetched, total) => {
      titleLoadingProgress.value = Math.round((fetched / total) * 100)
    })
    titleLoadingProgress.value = -1

    // Update song titles in-place from the freshly populated cache
    if (fetchedIds.length > 0) {
      const cache = songService._loadTitleCache()
      songs.value = songs.value.map(s => {
        const cached = cache.get(s.id)
        return cached && s.title !== cached ? { ...s, title: cached } : s
      })
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

  async function searchSongs(query: string) {
    searchQuery.value = query
    currentPage.value = 1
    
    // Require at least 2 characters
    if (!query.trim() || query.trim().length < 2) {
      searchResults.value = []
      isSearching.value = false
      return
    }
    
    isSearching.value = true
    searchResults.value = []
    
    try {
      const queryLower = query.toLowerCase().trim()
      const queryWords = queryLower.split(/\s+/).filter(word => word.length > 0)
      const matchingSongs: Song[] = []
      
      // Helper function to check if text matches all query words
      const matchesAllWords = (text: string) => {
        // Strip HTML tags for search purposes but keep the content
        const strippedText = stripHtmlTags(text).toLowerCase()
        return queryWords.every(word => strippedText.includes(word))
      }
      
      // First pass: Get all title matches (fast)
      const titleMatches: Song[] = []
      const songsToCheckLyrics: Song[] = []
      
      for (const song of songs.value) {
        if (matchesAllWords(song.title)) {
          titleMatches.push({ ...song, matchType: 'title' })
        } else {
          songsToCheckLyrics.push(song)
        }
      }
      
      // Add title matches immediately
      matchingSongs.push(...titleMatches)
      searchResults.value = [...matchingSongs]
      
      // Second pass: Check lyrics for songs without title matches (smaller batches, smarter caching)
      const batchSize = 10 // Reduced batch size for better responsiveness
      
      for (let i = 0; i < songsToCheckLyrics.length && isSearching.value; i += batchSize) {
        const batch = songsToCheckLyrics.slice(i, i + batchSize)
        
        // Process batch in parallel
        const batchPromises = batch.map(async (song) => {
          try {
            // Check if lyrics already loaded and cached
            if (song.lyrics) {
              if (matchesAllWords(song.lyrics)) {
                return { ...song, matchType: 'lyrics' as const }
              }
              return null
            }
            
            // Load lyrics
            const lyricsResponse = await songService.getMockLyrics(song.id)
            if (lyricsResponse.success) {
              // Always cache the lyrics for future searches
              const songIndex = songs.value.findIndex(s => s.id === song.id)
              if (songIndex !== -1) {
                songs.value[songIndex] = { ...songs.value[songIndex], lyrics: lyricsResponse.data }
              }
              
              // Check if it matches our search
              if (matchesAllWords(lyricsResponse.data)) {
                return { ...song, lyrics: lyricsResponse.data, matchType: 'lyrics' as const }
              }
            }
            return null
          } catch (error) {
            console.error(`Error loading lyrics for song ${song.id}:`, error)
            return null
          }
        })
        
        const batchResults = await Promise.all(batchPromises)
        const validResults = batchResults.filter(result => result !== null) as Song[]
        
        if (validResults.length > 0) {
          matchingSongs.push(...validResults)
          // Update results progressively
          searchResults.value = [...matchingSongs]
        }
        
        // Break if search query changed (user typed something else)
        if (searchQuery.value.toLowerCase().trim() !== queryLower) {
          break
        }
        
        // Yield control to keep UI responsive
        if (i + batchSize < songsToCheckLyrics.length) {
          await new Promise(resolve => setTimeout(resolve, 5))
        }
      }
      
      // Final update if still searching
      if (isSearching.value && searchQuery.value.toLowerCase().trim() === queryLower) {
        searchResults.value = matchingSongs
      }
    } catch (error) {
      console.error('Error during search:', error)
      searchResults.value = []
    } finally {
      isSearching.value = false
    }
  }

  function clearSearch() {
    searchQuery.value = ''
    searchResults.value = []
    isSearching.value = false
    currentPage.value = 1
  }

  function resetToLibraryMode() {
    clearSearch()
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
    
    const titlePromises: Promise<string>[] = []
    const songsToUpdate: Array<{ index: number; song: Song }> = []
    
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

  function updateSongDuration(songId: number, duration: number) {
    const song = songs.value.find(s => s.id === songId)
    if (song && song.duration !== duration) {
      song.duration = duration
    }
  }

  return {
    // State
    songs,
    loading,
    error,
    searchQuery,
    currentPage,
    pageSize,
    searchResults,
    isSearching,
    titleLoadingProgress,
    
    // Getters
    filteredSongs,
    paginatedSongs,
    paginatedSearchSongs,
    totalPages,
    totalSearchPages,
    favoriteSongs,
    
    // Actions
    fetchSongs,
    fetchUncachedTitles,
    getSongById,
    getSongLyrics,
    searchSongs,
    clearSearch,
    resetToLibraryMode,
    setPage,
    nextPage,
    previousPage,
    toggleFavorite,
    getRandomSongs,
    updateSongDuration,
    loadTitlesForCurrentPage
  }
})