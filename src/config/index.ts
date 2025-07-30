/**
 * Application configuration
 * Centralized configuration management for different environments
 */

export interface AppConfig {
  // API Configuration
  apiBaseUrl: string
  musicBaseUrl: string
  lyricsBaseUrl: string
  
  // App Settings
  appTitle: string
  enableMockData: boolean
  
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
  
  // App Settings
  appTitle: "Mic's Music Player",
  enableMockData: false,
  
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
  appTitle: import.meta.env.VITE_APP_TITLE || defaultConfig.appTitle,
  enableMockData: import.meta.env.VITE_ENABLE_MOCK_DATA === 'true',
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
 * Get full URL for a lyrics file
 */
export function getLyricsUrl(filename: string): string {
  const baseUrl = config.lyricsBaseUrl
  const separator = baseUrl && !baseUrl.endsWith('/') ? '/' : ''
  return `${baseUrl}${separator}${filename}`
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