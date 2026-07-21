export interface Song {
  id: number
  title: string
  filename: string
  duration?: number
  lyrics?: string
  isFavorite: boolean
  matchType?: 'title' | 'lyrics'
  artist?: string
  album?: string
  year?: number
  genre?: string
  language?: string
  categoryIds?: number[]
  profileLocked?: boolean
}

/** Per-song metadata built offline by scripts/build_metadata.py → /data/metadata.json */
export interface SongMeta {
  title?: string
  artist?: string
  album?: string
  year?: number
  genre?: string
  language?: string
  duration?: number
}

/** Which metadata field the quick search filters on. */
export type SearchScope = 'all' | 'title' | 'artist' | 'album' | 'year' | 'genre'

export interface SongCategory {
  id: number
  slug: string
  nameEn: string
  nameZh: string
  isDefault: boolean
  songCount: number
}

export interface CategoryAssignment {
  songId: number
  categoryId: number
  source: 'auto' | 'manual'
}

export interface CategoryData {
  categories: SongCategory[]
  assignments: CategoryAssignment[]
  lockedSongIds: number[]
}

/** A single time-stamped lyric line (parsed from LRC). `time` is seconds from start. */
export interface LyricLine {
  time: number
  text: string
}

export interface Playlist {
  id: string
  name: string
  songs: number[]
  isDefault: boolean
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

/** An identity: system-assigned guest or a registered (Google) account. */
export interface AuthUser {
  id: number
  email: string | null
  username: string
  name: string
  picture: string
  avatar?: string | null
  bio?: string | null
  role: 'admin' | 'user'
  kind: 'guest' | 'google'
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