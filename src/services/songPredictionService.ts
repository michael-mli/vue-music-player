/**
 * Song Prediction Service
 * Predicts upcoming songs based on current player state and play modes
 */

import type { Song } from '@/types'

interface PlayerState {
  queue: Song[]
  currentIndex: number
  shuffle: boolean
  repeat: 'none' | 'one' | 'all'
}

class SongPredictionService {
  /**
   * Predicts the next songs that will play based on current player state
   */
  predictUpcomingSongs(playerState: PlayerState, count: number = 2): Song[] {
    const { queue, currentIndex, shuffle, repeat } = playerState
    
    if (queue.length === 0) {
      return []
    }

    const upcomingSongs: Song[] = []
    
    // Handle repeat one mode - current song will repeat
    if (repeat === 'one') {
      const currentSong = queue[currentIndex]
      if (currentSong) {
        // For repeat one, just return the current song
        return Array(count).fill(currentSong)
      }
      return []
    }

    if (shuffle) {
      return this.predictShuffleMode(queue, currentIndex, count, repeat)
    } else {
      return this.predictSequentialMode(queue, currentIndex, count, repeat)
    }
  }

  /**
   * Predicts songs for shuffle mode
   */
  private predictShuffleMode(queue: Song[], currentIndex: number, count: number, repeat: 'none' | 'one' | 'all'): Song[] {
    const upcomingSongs: Song[] = []
    const availableSongs = [...queue]
    
    // Remove current song from available songs to avoid immediate repetition
    availableSongs.splice(currentIndex, 1)
    
    // If no more songs available and repeat is not 'all', return empty
    if (availableSongs.length === 0 && repeat !== 'all') {
      return []
    }

    // Generate predictions based on weighted random selection
    // This is a best-effort prediction since shuffle is random
    for (let i = 0; i < count; i++) {
      if (availableSongs.length === 0) {
        if (repeat === 'all') {
          // Reset available songs when we've exhausted the queue
          availableSongs.push(...queue)
        } else {
          break // No more songs available
        }
      }

      // Use a pseudo-random approach for more predictable caching
      // Favor songs that haven't been played recently (if we had that data)
      // For now, use a simple distribution
      const randomIndex = Math.floor(Math.random() * availableSongs.length)
      const selectedSong = availableSongs[randomIndex]
      
      upcomingSongs.push(selectedSong)
      availableSongs.splice(randomIndex, 1) // Remove to avoid immediate repetition
    }

    return upcomingSongs
  }

  /**
   * Predicts songs for sequential mode
   */
  private predictSequentialMode(queue: Song[], currentIndex: number, count: number, repeat: 'none' | 'one' | 'all'): Song[] {
    const upcomingSongs: Song[] = []
    
    for (let i = 0; i < count; i++) {
      const nextIndex = currentIndex + 1 + i
      
      if (nextIndex < queue.length) {
        // Normal case - next song in queue
        upcomingSongs.push(queue[nextIndex])
      } else if (repeat === 'all') {
        // Wrap around to beginning of queue
        const wrappedIndex = (nextIndex) % queue.length
        upcomingSongs.push(queue[wrappedIndex])
      } else {
        // No more songs (repeat is 'none')
        break
      }
    }

    return upcomingSongs
  }

  /**
   * Predicts what songs might be played if user hits "previous"
   * Useful for pre-caching in both directions
   */
  predictPreviousSongs(playerState: PlayerState, count: number = 1): Song[] {
    const { queue, currentIndex, shuffle, repeat } = playerState
    
    if (queue.length === 0) {
      return []
    }

    const previousSongs: Song[] = []

    if (shuffle) {
      // For shuffle mode, we can't really predict previous songs
      // since it depends on the actual play history
      return []
    }

    // Sequential mode
    for (let i = 0; i < count; i++) {
      const prevIndex = currentIndex - 1 - i
      
      if (prevIndex >= 0) {
        // Normal case - previous song in queue
        previousSongs.push(queue[prevIndex])
      } else if (repeat === 'all') {
        // Wrap around to end of queue
        const wrappedIndex = queue.length + prevIndex
        if (wrappedIndex >= 0) {
          previousSongs.push(queue[wrappedIndex])
        }
      } else {
        // No more previous songs
        break
      }
    }

    return previousSongs
  }

  /**
   * Gets all songs that might be played soon (next + previous)
   * This gives us a more comprehensive cache strategy
   */
  predictAllUpcomingSongs(playerState: PlayerState, nextCount: number = 2, prevCount: number = 1): Song[] {
    const nextSongs = this.predictUpcomingSongs(playerState, nextCount)
    const prevSongs = this.predictPreviousSongs(playerState, prevCount)
    
    // Combine and deduplicate
    const allSongs = [...nextSongs, ...prevSongs]
    const unique = allSongs.filter((song, index, self) => 
      self.findIndex(s => s.id === song.id) === index
    )
    
    return unique
  }

  /**
   * Checks if a song is likely to be played soon
   */
  isSongUpcoming(songId: number, playerState: PlayerState, lookAhead: number = 3): boolean {
    const upcoming = this.predictAllUpcomingSongs(playerState, lookAhead, 1)
    return upcoming.some(song => song.id === songId)
  }
}

// Export singleton instance
export const songPredictionService = new SongPredictionService()