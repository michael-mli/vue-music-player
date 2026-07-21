import api from './api'
import type { Playlist, APIResponse } from '@/types'

const PLAYLISTS_STORAGE_KEY = 'mics-music-playlists'

const LEGACY_SAMPLE_PLAYLISTS = [
  { id: '1', name: 'My Favorites', songs: [1, 5, 10, 15, 20] },
  { id: '2', name: 'Rock Classics', songs: [2, 7, 12, 18, 25] },
  { id: '3', name: 'Chill Vibes', songs: [3, 8, 13, 22, 30] },
]

function defaultPlaylist(): Playlist {
  const timestamp = new Date()
  return {
    id: 'local-default',
    name: '',
    songs: [],
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function asDate(value: unknown): Date {
  const date = new Date(typeof value === 'string' || value instanceof Date ? value : Date.now())
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function normalizePlaylist(value: Partial<Playlist> & Record<string, unknown>): Playlist {
  return {
    id: String(value.id),
    name: typeof value.name === 'string' ? value.name : '',
    songs: Array.isArray(value.songs)
      ? [...new Set(value.songs.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
      : [],
    isDefault: value.isDefault === true,
    createdAt: asDate(value.createdAt),
    updatedAt: asDate(value.updatedAt),
  }
}

function isLegacySample(playlist: Playlist): boolean {
  return LEGACY_SAMPLE_PLAYLISTS.some((sample) =>
    playlist.id === sample.id
    && playlist.name === sample.name
    && playlist.songs.length === sample.songs.length
    && playlist.songs.every((songId, index) => songId === sample.songs[index]),
  )
}

function saveLocalPlaylists(playlists: Playlist[]): void {
  try {
    localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(playlists))
  } catch (error) {
    console.error('Error saving local playlists:', error)
  }
}

function getLocalPlaylists(): Playlist[] {
  let playlists: Playlist[] = []
  try {
    const stored = localStorage.getItem(PLAYLISTS_STORAGE_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    if (Array.isArray(parsed)) playlists = parsed.map(normalizePlaylist)
  } catch (error) {
    console.error('Error reading local playlists:', error)
  }

  // Remove only the exact sample lists shipped by the old mock implementation.
  // Any renamed or otherwise edited user list is preserved.
  playlists = playlists.filter((playlist) => !isLegacySample(playlist))

  const defaultIndex = playlists.findIndex((playlist) => playlist.isDefault)
  if (defaultIndex < 0) {
    playlists.unshift(defaultPlaylist())
  } else {
    playlists = playlists.map((playlist, index) => ({
      ...playlist,
      isDefault: index === defaultIndex,
    }))
  }

  saveLocalPlaylists(playlists)
  return playlists
}

function localId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function remotePlaylistResponse(response: APIResponse<Playlist>): APIResponse<Playlist> {
  return { ...response, data: normalizePlaylist(response.data as Playlist & Record<string, unknown>) }
}

export const playlistService = {
  async getPlaylists(registered: boolean): Promise<APIResponse<Playlist[]>> {
    if (!registered) return { success: true, data: getLocalPlaylists() }
    const response = await api.get<never, APIResponse<Playlist[]>>('/playlists')
    return {
      ...response,
      data: response.data.map((playlist) =>
        normalizePlaylist(playlist as Playlist & Record<string, unknown>)),
    }
  },

  async createPlaylist(
    playlist: Pick<Playlist, 'name' | 'songs'>,
    registered: boolean,
  ): Promise<APIResponse<Playlist>> {
    if (registered) {
      const response = await api.post<never, APIResponse<Playlist>>('/playlists', playlist)
      return remotePlaylistResponse(response)
    }

    const playlists = getLocalPlaylists()
    const timestamp = new Date()
    const created: Playlist = {
      id: localId(),
      name: playlist.name,
      songs: [...playlist.songs],
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    playlists.push(created)
    saveLocalPlaylists(playlists)
    return { success: true, data: created }
  },

  async updatePlaylist(
    id: string,
    updates: Partial<Pick<Playlist, 'name' | 'songs'>>,
    registered: boolean,
  ): Promise<APIResponse<Playlist>> {
    if (registered) {
      const response = await api.put<never, APIResponse<Playlist>>(`/playlists/${id}`, updates)
      return remotePlaylistResponse(response)
    }

    const playlists = getLocalPlaylists()
    const index = playlists.findIndex((playlist) => playlist.id === id)
    if (index < 0) throw new Error('Playlist not found')
    playlists[index] = {
      ...playlists[index],
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.songs !== undefined ? { songs: [...updates.songs] } : {}),
      updatedAt: new Date(),
    }
    saveLocalPlaylists(playlists)
    return { success: true, data: playlists[index] }
  },

  async deletePlaylist(id: string, registered: boolean): Promise<APIResponse<void>> {
    if (registered) return api.delete(`/playlists/${id}`)

    const playlists = getLocalPlaylists()
    const target = playlists.find((playlist) => playlist.id === id)
    if (!target) throw new Error('Playlist not found')
    if (target.isDefault) throw new Error('The default playlist cannot be deleted')
    saveLocalPlaylists(playlists.filter((playlist) => playlist.id !== id))
    return { success: true, data: undefined }
  },
}
