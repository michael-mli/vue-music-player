import api from './api'
import type { APIResponse, Song } from '@/types'

export interface DigSong {
  key: string
  title: string
  artist: string
  album: string
  duration: number
  source: string
  libraryId: number | null
  verification?: 'verified' | 'unverified' | 'unavailable'
}
export interface DigJob {
  id: string
  status: 'running' | 'complete' | 'failed'
  result?: { song: Song; alreadyAdded: boolean; titleOnlyLyrics?: boolean }
  code?: string
  message?: string
}
export const digService = {
  library(): Promise<APIResponse<Song[]>> {
    return api.get('/dig/library')
  },
  search(q: string, page: number, includeUnavailable = false): Promise<APIResponse<{ songs: DigSong[]; page: number; totalPages: number; excluded: number }>> {
    // Search includes a server-side prescan of every result (synced lyrics +
    // audio probe), so allow enough time for slow upstream providers.
    return api.get('/dig/search', { params: { q, page, ...(includeUnavailable ? { includeUnavailable: '1' } : {}) }, timeout: 120000 })
  },
  add(key: string, manualLyrics?: string): Promise<APIResponse<DigJob>> {
    return api.post('/dig/import', { key, ...(manualLyrics !== undefined ? { manualLyrics } : {}) })
  },
  preview(key: string, signal: AbortSignal): Promise<APIResponse<{ token: string }>> {
    return api.post('/dig/preview', { key }, { signal })
  },
  lyrics(key: string, signal?: AbortSignal): Promise<APIResponse<{ lrc: string }>> {
    return api.post('/dig/lyrics', { key }, { signal })
  },
  status(id: string): Promise<APIResponse<DigJob>> {
    return api.get(`/dig/import/${encodeURIComponent(id)}`)
  },
}
