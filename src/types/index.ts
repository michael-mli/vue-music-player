export interface Song {
  id: number
  title: string
  filename: string
  duration?: number
  lyrics?: string
  isFavorite: boolean
}

export interface Playlist {
  id: string
  name: string
  songs: number[]
  createdAt: Date
  updatedAt: Date
}

export interface PlayerState {
  currentSong: Song | null
  isPlaying: boolean
  volume: number
  isMuted: boolean
  currentTime: number
  duration: number
  shuffle: boolean
  repeat: 'none' | 'one' | 'all'
  queue: Song[]
  currentIndex: number
}

export interface User {
  username: string
  playlists: Playlist[]
  favorites: number[]
}

export interface APIResponse<T> {
  success: boolean
  data: T
  message?: string
}

export type PlayMode = 'shuffle' | 'sequential' | 'repeat-one' | 'repeat-all'

export interface MediaSessionMetadata {
  title: string
  artist: string
  album?: string
  artwork?: MediaImage[]
}