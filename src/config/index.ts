/**
 * Application configuration
 * Centralized configuration management for different environments
 */

export interface AppConfig {
  // API Configuration
  apiBaseUrl: string
  musicBaseUrl: string
  lyricsBaseUrl: string
  posterBaseUrl: string
  
  // App Settings
  appTitle: string
  enableMockData: boolean

  // Karaoke
  karaokeEnabled: boolean
  karaokeBaseUrl: string
  lrclibBaseUrl: string
  
  // Audio Settings
  defaultVolume: number
  maxCachedSongs: number
  audioFormats: string[]
  
  // UI Settings
  songsPerPage: number
  searchDebounceMs: number
  
  // PWA Settings
  enableServiceWorker: boolean
  cacheStrategy: 'cacheFirst' | 'networkFirst' | 'staleWhileRevalidate'
}

// Default configuration
const defaultConfig: AppConfig = {
  // API Configuration
  apiBaseUrl: '/api',
  musicBaseUrl: '',
  lyricsBaseUrl: '/lyrics',
  posterBaseUrl: '/poster',

  // App Settings
  appTitle: "Mic's Music Player",
  enableMockData: false,

  // Karaoke
  karaokeEnabled: true,
  // Where instrumentals + manifest live. Empty = co-located with the music files
  // (musicBaseUrl). Override (e.g. "/karaoke") when the music dir is read-only.
  karaokeBaseUrl: '',
  lrclibBaseUrl: 'https://lrclib.net',
  
  // Audio Settings
  defaultVolume: 0.8,
  maxCachedSongs: 50,
  audioFormats: ['mp3', 'wav', 'ogg'],
  
  // UI Settings
  songsPerPage: 50,
  searchDebounceMs: 300,
  
  // PWA Settings
  enableServiceWorker: true,
  cacheStrategy: 'cacheFirst'
}

// Environment-specific configuration
const config: AppConfig = {
  ...defaultConfig,
  
  // Override with environment variables
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || defaultConfig.apiBaseUrl,
  musicBaseUrl: import.meta.env.VITE_MUSIC_BASE_URL || defaultConfig.musicBaseUrl,
  lyricsBaseUrl: import.meta.env.VITE_LYRICS_BASE_URL || defaultConfig.lyricsBaseUrl,
  posterBaseUrl: import.meta.env.VITE_POSTER_BASE_URL || defaultConfig.posterBaseUrl,
  appTitle: import.meta.env.VITE_APP_TITLE || defaultConfig.appTitle,
  enableMockData: import.meta.env.VITE_ENABLE_MOCK_DATA === 'true',
  karaokeEnabled: import.meta.env.VITE_KARAOKE_ENABLED !== 'false',
  karaokeBaseUrl: import.meta.env.VITE_KARAOKE_BASE_URL || defaultConfig.karaokeBaseUrl,
  lrclibBaseUrl: import.meta.env.VITE_LRCLIB_BASE_URL || defaultConfig.lrclibBaseUrl,
}

/**
 * Get full URL for a music file
 */
export function getMusicUrl(filename: string): string {
  const baseUrl = config.musicBaseUrl
  const separator = baseUrl && !baseUrl.endsWith('/') ? '/' : ''
  return `${baseUrl}${separator}${filename}`
}

/**
 * Get full URL for a karaoke asset. Uses karaokeBaseUrl when set, otherwise falls back to
 * the music base (co-located with the originals). Override the base when the music dir is
 * read-only (e.g. an S3 mount) so instrumentals can be served from a writable path.
 */
export function getKaraokeUrl(filename: string): string {
  const baseUrl = config.karaokeBaseUrl || config.musicBaseUrl
  const separator = baseUrl && !baseUrl.endsWith('/') ? '/' : ''
  return `${baseUrl}${separator}${filename}`
}

/**
 * Get the karaoke instrumental URL for a song id. Instrumentals are generated offline by
 * the vocal-removal pipeline (scripts/karaoke) and served as link.{id}.instrumental.mp3.
 * See KARAOKE.md.
 */
export function getInstrumentalUrl(songId: number): string {
  return getKaraokeUrl(`link.${songId}.instrumental.mp3`)
}

/**
 * Get the URL of the karaoke manifest (list of song ids that have an instrumental).
 */
export function getKaraokeManifestUrl(): string {
  return getKaraokeUrl('karaoke_manifest.json')
}

/**
 * Get full URL for a lyrics file
 */
export function getLyricsUrl(filename: string): string {
  const baseUrl = config.lyricsBaseUrl
  const separator = baseUrl && !baseUrl.endsWith('/') ? '/' : ''
  return `${baseUrl}${separator}${filename}`
}

/** Bundled fallback poster, used when a song has no downloaded cover art. */
export const DEFAULT_POSTER_URL = '/poster-default.svg'

/**
 * Get the cover poster URL for a song id. Posters are downloaded into the music
 * store as poster/link.{id}.jpg; missing ones 404 and the <img> @error handler
 * swaps in DEFAULT_POSTER_URL.
 */
export function getPosterUrl(songId: number): string {
  const baseUrl = config.posterBaseUrl
  const separator = baseUrl && !baseUrl.endsWith('/') ? '/' : ''
  return `${baseUrl}${separator}link.${songId}.jpg`
}

/**
 * Get full API URL
 */
export function getApiUrl(endpoint: string): string {
  const baseUrl = config.apiBaseUrl
  const separator = baseUrl && !baseUrl.endsWith('/') && !endpoint.startsWith('/') ? '/' : ''
  return `${baseUrl}${separator}${endpoint}`
}

/**
 * Check if we're in development mode
 */
export function isDevelopment(): boolean {
  return import.meta.env.DEV
}

/**
 * Check if we're in production mode
 */
export function isProduction(): boolean {
  return import.meta.env.PROD
}

export default config