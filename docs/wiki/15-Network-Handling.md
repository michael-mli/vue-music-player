# Network Handling

Comprehensive guide to network connectivity management, offline support, and resilient audio streaming in the Vue Music Player.

## 🌐 Network Architecture

### Connection Management Strategy
The Vue Music Player implements a multi-layered approach to network handling:

1. **Real-time Connectivity Monitoring**
2. **Automatic Retry Logic**
3. **Graceful Degradation**
4. **Service Worker Caching**
5. **Background Sync**

## 🔄 Connectivity Detection

### Online/Offline Events
The player store monitors network status using the Navigator Online API:

```typescript
// stores/player.ts
const isOnline = ref(navigator.onLine)
const networkRetryAttempts = ref(0)
const maxRetryAttempts = 3
const retryDelay = 2000 // 2 seconds

function setupNetworkListeners() {
  window.addEventListener('online', () => {
    isOnline.value = true
    networkRetryAttempts.value = 0
    console.log('Network connection restored')
    
    // Resume playback if was interrupted
    if (lastPlayState.value && !isPlaying.value && currentSong.value) {
      handleNetworkReconnect()
    }
  })
  
  window.addEventListener('offline', () => {
    isOnline.value = false
    console.log('Network connection lost')
  })
}
```

### Connection Quality Detection
Advanced connection monitoring using Network Information API:

```typescript
// utils/networkMonitor.ts
interface ConnectionInfo {
  effectiveType: '2g' | '3g' | '4g' | 'slow-2g'
  downlink: number
  rtt: number
  saveData: boolean
}

function getConnectionInfo(): ConnectionInfo | null {
  const connection = (navigator as any).connection || 
                    (navigator as any).mozConnection || 
                    (navigator as any).webkitConnection

  if (connection) {
    return {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData
    }
  }
  return null
}

// Adjust quality based on connection
function adaptToConnectionSpeed() {
  const info = getConnectionInfo()
  if (info?.effectiveType === 'slow-2g' || info?.effectiveType === '2g') {
    // Reduce audio quality or enable aggressive caching
    enableLowBandwidthMode()
  }
}
```

## 🔄 Automatic Retry Logic

### Audio Error Handling
Comprehensive error handling for audio loading failures:

```typescript
// stores/player.ts
function handleAudioError(error: MediaError) {
  const errorMessages = {
    [MediaError.MEDIA_ERR_ABORTED]: 'Playback aborted',
    [MediaError.MEDIA_ERR_NETWORK]: 'Network error',
    [MediaError.MEDIA_ERR_DECODE]: 'Decode error',
    [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: 'Format not supported'
  }

  console.error('Audio error:', errorMessages[error.code])

  switch (error.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      handleNetworkRetry()
      break
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      skipToNextSong()
      break
    default:
      showErrorNotification(errorMessages[error.code])
  }
}

async function handleNetworkRetry() {
  if (networkRetryAttempts.value >= maxRetryAttempts) {
    console.log('Max retry attempts reached')
    showNetworkErrorNotification()
    return
  }

  networkRetryAttempts.value++
  console.log(`Retry attempt ${networkRetryAttempts.value}/${maxRetryAttempts}`)

  // Exponential backoff
  const delay = retryDelay * Math.pow(2, networkRetryAttempts.value - 1)
  await new Promise(resolve => setTimeout(resolve, delay))

  if (currentSong.value && audioElement.value) {
    const currentTimeBeforeRetry = currentTime.value

    try {
      // Reload audio source
      audioElement.value.load()
      
      // Restore playback position
      if (currentTimeBeforeRetry > 0) {
        audioElement.value.currentTime = currentTimeBeforeRetry
      }

      // Resume if was playing
      if (lastPlayState.value) {
        await audioElement.value.play()
      }

      networkRetryAttempts.value = 0 // Reset on success
    } catch (error) {
      console.error('Retry failed:', error)
      
      if (networkRetryAttempts.value >= maxRetryAttempts) {
        // Final fallback: skip to next song
        setTimeout(() => nextSong(), 1000)
      }
    }
  }
}
```

### Smart Reconnection
Intelligent reconnection handling for network restoration:

```typescript
async function handleNetworkReconnect() {
  if (!currentSong.value || !audioElement.value) return

  try {
    // Wait for connection stabilization
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Reload current song
    audioElement.value.src = getMusicUrl(`link.${currentSong.value.id}.mp3`)
    audioElement.value.load()
    
    // Test connection with HEAD request
    const response = await fetch(audioElement.value.src, { method: 'HEAD' })
    if (!response.ok) {
      throw new Error('Source not accessible')
    }
    
    // Resume playback
    if (lastPlayState.value) {
      await audioElement.value.play()
      showSuccessNotification('Playback resumed')
    }
  } catch (error) {
    console.error('Failed to resume after reconnect:', error)
    showErrorNotification('Unable to resume playback')
  }
}
```

## 📱 Mobile Network Switching

### WiFi to Mobile Data Transition
Special handling for mobile network transitions:

```typescript
// Enhanced next song logic for mobile scenarios
async function nextSong() {
  if (!canPlayNext.value) return

  let nextIndex = getNextSongIndex()
  currentIndex.value = nextIndex
  networkRetryAttempts.value = 0 // Reset for new song

  try {
    await playSong(queue.value[nextIndex])
  } catch (error) {
    console.error('Failed to play next song:', error)
    
    // Mobile-specific handling
    if (isMobileDevice() && !isOnline.value) {
      // Queue song for when connection returns
      queueSongForResume(queue.value[nextIndex])
      showNotification('Song queued for when connection returns')
      return
    }
    
    // Standard retry logic
    handleNetworkRetry()
  }
}

// Mobile device detection
function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
}

// Queue management for offline scenarios
const pendingSongs = ref<Song[]>([])

function queueSongForResume(song: Song) {
  pendingSongs.value.push(song)
}

// Resume queued songs when online
window.addEventListener('online', () => {
  if (pendingSongs.value.length > 0) {
    const nextSong = pendingSongs.value.shift()
    if (nextSong) {
      playSong(nextSong)
    }
  }
})
```

## 💾 Service Worker Caching

### Cache Strategy Configuration
Multi-tiered caching for different content types:

```typescript
// vite.config.ts - Service Worker configuration
VitePWA({
  workbox: {
    runtimeCaching: [
      // Music files - Cache First with long expiration
      {
        urlPattern: ({ request }) => 
          request.destination === 'audio' || 
          request.url.includes('.mp3'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'music-files',
          expiration: {
            maxEntries: 100,
            maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
          },
          cacheKeyWillBeUsed: async ({ request }) => {
            // Add version to cache key for updates
            return `${request.url}?v=${BUILD_VERSION}`
          }
        }
      },
      
      // API responses - Network First with fallback
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache',
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 24 * 60 * 60 // 1 day
          },
          networkTimeoutSeconds: 5
        }
      },
      
      // Lyrics files - Stale While Revalidate
      {
        urlPattern: ({ url }) => url.pathname.includes('/lyrics/'),
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'lyrics-cache',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 7 * 24 * 60 * 60 // 7 days
          }
        }
      }
    ]
  }
})
```

### Advanced Caching Logic
Custom service worker for intelligent caching:

```javascript
// public/sw.js - Custom service worker
self.addEventListener('fetch', event => {
  const { request } = event
  
  // Handle music file requests with special logic
  if (request.url.includes('.mp3')) {
    event.respondWith(handleMusicRequest(request))
  }
  
  // Handle API requests with retry logic
  if (request.url.includes('/api/')) {
    event.respondWith(handleApiRequest(request))
  }
})

async function handleMusicRequest(request) {
  try {
    // Try cache first
    const cachedResponse = await caches.match(request)
    if (cachedResponse) {
      return cachedResponse
    }
    
    // Network request with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout
    
    const response = await fetch(request, {
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    
    // Cache successful responses
    if (response.ok) {
      const cache = await caches.open('music-files')
      cache.put(request, response.clone())
    }
    
    return response
  } catch (error) {
    // Return cached version or offline page
    const cachedResponse = await caches.match(request)
    return cachedResponse || new Response('Offline', { status: 503 })
  }
}
```

## 🔄 Background Sync

### Queue Management for Offline Actions
Background sync for user actions when offline:

```typescript
// services/backgroundSync.ts
class BackgroundSyncManager {
  private syncQueue: Array<{
    action: string
    data: any
    timestamp: number
  }> = []

  queueAction(action: string, data: any) {
    this.syncQueue.push({
      action,
      data,
      timestamp: Date.now()
    })
    
    // Save to IndexedDB for persistence
    this.saveQueueToStorage()
    
    // Register background sync
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
      navigator.serviceWorker.ready.then(registration => {
        registration.sync.register('background-sync')
      })
    }
  }

  async processQueue() {
    while (this.syncQueue.length > 0) {
      const item = this.syncQueue.shift()
      if (!item) continue

      try {
        await this.executeAction(item.action, item.data)
      } catch (error) {
        // Re-queue if failed
        this.syncQueue.unshift(item)
        break
      }
    }
    
    this.saveQueueToStorage()
  }

  private async executeAction(action: string, data: any) {
    switch (action) {
      case 'createPlaylist':
        await playlistService.createPlaylist(data)
        break
      case 'addToFavorites':
        await songService.addToFavorites(data.songId)
        break
      case 'updatePlaytime':
        await analyticsService.updatePlaytime(data)
        break
    }
  }
}

// Usage in components
const syncManager = new BackgroundSyncManager()

// Queue offline actions
function addToFavorites(songId: number) {
  if (navigator.onLine) {
    songService.addToFavorites(songId)
  } else {
    syncManager.queueAction('addToFavorites', { songId })
    showNotification('Action queued for when online')
  }
}
```

## 📊 Network Performance Monitoring

### Performance Metrics Collection
Monitor network performance for optimization:

```typescript
// utils/performanceMonitor.ts
class NetworkPerformanceMonitor {
  private metrics: Array<{
    url: string
    duration: number
    size: number
    success: boolean
    timestamp: number
  }> = []

  recordRequest(url: string, startTime: number, response: Response) {
    const duration = performance.now() - startTime
    const size = parseInt(response.headers.get('content-length') || '0')
    
    this.metrics.push({
      url,
      duration,
      size,
      success: response.ok,
      timestamp: Date.now()
    })
    
    // Analyze and adapt
    this.analyzePerformance()
  }

  private analyzePerformance() {
    const recentMetrics = this.metrics.slice(-10) // Last 10 requests
    const avgDuration = recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length
    const successRate = recentMetrics.filter(m => m.success).length / recentMetrics.length
    
    // Adapt caching strategy based on performance
    if (avgDuration > 5000) { // Slow connection
      this.enableAggressiveCaching()
    }
    
    if (successRate < 0.8) { // High failure rate
      this.increaseRetryDelay()
    }
  }

  private enableAggressiveCaching() {
    // Increase cache duration and prefetch more content
    console.log('Enabling aggressive caching due to slow connection')
  }

  private increaseRetryDelay() {
    // Increase retry delays for unstable connections
    console.log('Increasing retry delays due to connection instability')
  }
}
```

## 🎵 Streaming Optimization

### Adaptive Bitrate Streaming
Dynamic quality adjustment based on connection:

```typescript
// services/adaptiveStreaming.ts
class AdaptiveStreamingManager {
  private connectionSpeed: number = 0
  private bufferLevel: number = 0

  determineOptimalQuality(): 'high' | 'medium' | 'low' {
    const connection = getConnectionInfo()
    
    if (!connection) return 'medium'
    
    // Base decision on effective connection type
    switch (connection.effectiveType) {
      case '4g':
        return this.bufferLevel > 10 ? 'high' : 'medium'
      case '3g':
        return 'medium'
      case '2g':
      case 'slow-2g':
        return 'low'
      default:
        return 'medium'
    }
  }

  async loadWithFallback(songId: number): Promise<string> {
    const quality = this.determineOptimalQuality()
    const urls = {
      high: `${MUSIC_BASE_URL}/hq/link.${songId}.mp3`,
      medium: `${MUSIC_BASE_URL}/link.${songId}.mp3`,
      low: `${MUSIC_BASE_URL}/lq/link.${songId}.mp3`
    }

    // Try preferred quality first, fallback to lower
    const qualityOrder = this.getQualityFallbackOrder(quality)
    
    for (const q of qualityOrder) {
      try {
        const response = await fetch(urls[q], { method: 'HEAD' })
        if (response.ok) {
          return urls[q]
        }
      } catch (error) {
        continue
      }
    }
    
    throw new Error('No viable audio source found')
  }
}
```

## 🚨 Error Recovery Strategies

### Graceful Degradation
Comprehensive fallback mechanisms:

```typescript
// utils/errorRecovery.ts
class ErrorRecoveryManager {
  async handlePlaybackFailure(song: Song, error: Error): Promise<boolean> {
    console.error('Playback failure:', error.message)
    
    // Strategy 1: Retry with different source
    try {
      await this.retryWithAlternativeSource(song)
      return true
    } catch (e) {
      console.log('Alternative source failed')
    }
    
    // Strategy 2: Skip to next available song
    try {
      await this.skipToNextAvailableSong()
      return true
    } catch (e) {
      console.log('No next song available')
    }
    
    // Strategy 3: Enter offline mode
    this.enterOfflineMode()
    return false
  }

  private async retryWithAlternativeSource(song: Song) {
    // Try different CDN or mirror
    const alternativeUrl = `${BACKUP_CDN_URL}/link.${song.id}.mp3`
    const response = await fetch(alternativeUrl, { method: 'HEAD' })
    
    if (response.ok) {
      audioElement.value!.src = alternativeUrl
      await audioElement.value!.play()
    } else {
      throw new Error('Alternative source unavailable')
    }
  }

  private async skipToNextAvailableSong() {
    const queue = usePlayerStore().queue
    const currentIndex = usePlayerStore().currentIndex
    
    // Find next playable song
    for (let i = currentIndex + 1; i < queue.length; i++) {
      try {
        await this.testSongAvailability(queue[i])
        await usePlayerStore().playSong(queue[i], queue, i)
        return
      } catch (e) {
        continue
      }
    }
    
    throw new Error('No available songs in queue')
  }

  private enterOfflineMode() {
    showNotification('Entering offline mode - limited functionality available')
    // Disable features requiring network
    // Show offline indicator
    // Cache current state
  }
}
```

## 📱 Mobile-Specific Optimizations

### Data Saver Mode
Respect user preferences for data usage:

```typescript
// utils/dataSaver.ts
class DataSaverManager {
  shouldOptimizeForDataSaving(): boolean {
    // Check Save-Data header
    if ('connection' in navigator) {
      const connection = (navigator as any).connection
      if (connection?.saveData) {
        return true
      }
    }
    
    // Check user preference
    const userPreference = localStorage.getItem('dataSaverMode')
    return userPreference === 'true'
  }

  getOptimizedSettings(): AudioSettings {
    if (this.shouldOptimizeForDataSaving()) {
      return {
        preload: 'none', // Don't preload audio
        quality: 'low',   // Use lower quality
        cacheSize: 10,    // Smaller cache
        prefetch: false   // Disable prefetching
      }
    }
    
    return {
      preload: 'metadata',
      quality: 'high',
      cacheSize: 50,
      prefetch: true
    }
  }
}
```

## 🔍 Debugging Network Issues

### Network Diagnostics
Built-in diagnostic tools:

```typescript
// utils/networkDiagnostics.ts
class NetworkDiagnostics {
  async runDiagnostics(): Promise<DiagnosticReport> {
    const report: DiagnosticReport = {
      connectivity: await this.testConnectivity(),
      apiHealth: await this.testApiHealth(),
      audioSources: await this.testAudioSources(),
      performance: await this.measurePerformance()
    }
    
    console.log('Network Diagnostics Report:', report)
    return report
  }

  private async testConnectivity(): Promise<ConnectivityTest> {
    try {
      const response = await fetch('https://httpbin.org/get', {
        method: 'GET',
        cache: 'no-cache'
      })
      
      return {
        online: response.ok,
        latency: performance.now(),
        status: response.status
      }
    } catch (error) {
      return {
        online: false,
        latency: -1,
        error: error.message
      }
    }
  }

  private async testApiHealth(): Promise<ApiHealthTest> {
    try {
      const response = await fetch('/api/health')
      return {
        available: response.ok,
        responseTime: performance.now(),
        status: response.status
      }
    } catch (error) {
      return {
        available: false,
        error: error.message
      }
    }
  }
}

// Usage
const diagnostics = new NetworkDiagnostics()
diagnostics.runDiagnostics().then(report => {
  if (!report.connectivity.online) {
    showOfflineNotification()
  }
})
```

---

**Related Documentation:**
- [Performance Optimization](./11-Performance-Optimization.md)
- [PWA Features](./12-PWA-Features.md)
- [Mobile Optimization](./14-Mobile-Optimization.md)
- [Common Issues](./19-Common-Issues.md)