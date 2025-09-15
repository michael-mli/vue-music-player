# Common Issues & Troubleshooting

Comprehensive troubleshooting guide for common issues encountered during development, deployment, and usage of the Vue Music Player.

## 🚨 Quick Diagnostic Checklist

### 1. Basic Health Check
```bash
# Verify Node.js version
node --version  # Should be 18.0+

# Check npm/yarn
npm --version   # Should be 8.0+

# Test development server
npm run dev     # Should start without errors

# Verify TypeScript
npm run type-check  # Should pass without errors
```

### 2. Environment Check
```bash
# Check environment variables
echo $VITE_API_BASE_URL
echo $VITE_MUSIC_BASE_URL
echo $VITE_ENABLE_MOCK_DATA

# Verify .env files exist
ls -la .env*
```

### 3. Network Connectivity
```bash
# Test API endpoint
curl -I https://api.yourdomain.com/health

# Test music file access
curl -I https://music.yourdomain.com/music/link.1.mp3
```

## 🔧 Development Issues

### Issue: Port Already in Use
**Symptoms**: `Error: listen EADDRINUSE: address already in use :::5173`

**Solutions**:
```bash
# Option 1: Kill process using the port
lsof -ti:5173 | xargs kill -9

# Option 2: Use different port
npm run dev -- --port 3000

# Option 3: Find and kill specific process
npx kill-port 5173
```

**Prevention**: Use port management scripts in `package.json`:
```json
{
  "scripts": {
    "dev:clean": "npx kill-port 5173 && npm run dev",
    "dev:alt": "npm run dev -- --port 3001"
  }
}
```

### Issue: Node Version Compatibility
**Symptoms**: Build failures, package installation errors

**Solutions**:
```bash
# Check current version
node --version

# Install correct version using nvm
nvm install 18
nvm use 18

# Or using n
npm install -g n
n 18

# Verify and rebuild
node --version
rm -rf node_modules package-lock.json
npm install
```

### Issue: TypeScript Errors
**Symptoms**: Type checking failures, IDE errors

**Common Fixes**:
```bash
# Clear TypeScript cache
rm -rf node_modules/.cache
rm tsconfig.tsbuildinfo

# Regenerate type definitions
npm run type-check

# Restart TypeScript server in VS Code
# Ctrl+Shift+P -> "TypeScript: Restart TS Server"
```

**Missing Type Definitions**:
```bash
# Install missing types
npm install --save-dev @types/node
npm install --save-dev @types/web
```

### Issue: Vite Build Failures
**Symptoms**: Build process stops with errors

**Solutions**:
```bash
# Clear Vite cache
rm -rf node_modules/.vite
rm -rf dist

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Build with verbose output
npm run build -- --mode development
```

**Memory Issues**:
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

## 🌐 Network & API Issues

### Issue: CORS Errors
**Symptoms**: `Access to fetch blocked by CORS policy`

**Frontend Solutions**:
```typescript
// vite.config.ts - Add proxy for development
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
```

**Backend Solutions** (PHP):
```php
// Add CORS headers
header("Access-Control-Allow-Origin: http://localhost:5173");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}
```

**Cloudflare Workers**:
```typescript
// src/utils/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
}
```

### Issue: API Connection Failures
**Symptoms**: Network errors, timeouts, 500 responses

**Diagnostic Steps**:
```bash
# Test API health
curl -v https://api.yourdomain.com/health

# Check DNS resolution
nslookup api.yourdomain.com

# Test with different methods
curl -X GET https://api.yourdomain.com/api/songs?limit=1
curl -X OPTIONS https://api.yourdomain.com/api/songs
```

**Common Fixes**:
1. **Wrong API URL**: Verify `VITE_API_BASE_URL` in environment
2. **Server Down**: Check backend server status
3. **SSL Issues**: Test with HTTP first, then configure HTTPS
4. **Firewall**: Ensure ports 80/443 are open

### Issue: Music Files Not Loading
**Symptoms**: Audio player shows loading indefinitely

**Diagnostic Steps**:
```bash
# Test direct file access
curl -I https://music.yourdomain.com/music/link.1.mp3

# Check file permissions
ls -la /path/to/music/files/

# Verify MIME types
file --mime-type /path/to/music/link.1.mp3
```

**Solutions**:
```bash
# Fix file permissions
chmod 644 /path/to/music/*.mp3

# Verify web server MIME types (Apache)
echo "AddType audio/mpeg .mp3" >> .htaccess

# Verify web server MIME types (Nginx)
# Add to nginx.conf:
# location ~* \.(mp3)$ {
#   add_header Content-Type audio/mpeg;
# }
```

## 📱 Mobile & PWA Issues

### Issue: PWA Not Installing
**Symptoms**: Install prompt not showing, installation fails

**Solutions**:
```typescript
// Check PWA requirements
// 1. HTTPS (required in production)
// 2. Valid manifest.json
// 3. Service worker registration

// Debug manifest
fetch('/manifest.json')
  .then(r => r.json())
  .then(console.log)

// Check service worker
navigator.serviceWorker.ready
  .then(registration => console.log('SW ready:', registration))
  .catch(console.error)
```

**Manifest Validation**:
```json
{
  "name": "Music Player",
  "short_name": "Music",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#1a1a1a",
  "background_color": "#000000",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### Issue: Audio Not Playing on Mobile
**Symptoms**: Player controls work but no sound on mobile devices

**Common Causes & Solutions**:

1. **Autoplay Policy**:
```typescript
// Handle autoplay restrictions
async function playWithUserGesture() {
  try {
    await audioElement.play()
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      showNotification('Tap to enable audio playback')
    }
  }
}
```

2. **iOS Silent Mode**:
```typescript
// Force audio playback on iOS
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
  audioElement.muted = false
  audioElement.volume = 1
}
```

3. **Android Audio Focus**:
```javascript
// Handle audio focus events
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Page hidden - might lose audio focus
    if (isPlaying.value) {
      lastPlayState.value = true
      pause()
    }
  } else {
    // Page visible - resume if was playing
    if (lastPlayState.value) {
      play()
    }
  }
})
```

### Issue: Network Switching Problems
**Symptoms**: Playback stops when switching from WiFi to mobile data

**This is addressed by the network handling implementation**:
```typescript
// Network change detection and recovery
function setupNetworkListeners() {
  window.addEventListener('online', () => {
    isOnline.value = true
    if (lastPlayState.value && !isPlaying.value && currentSong.value) {
      handleNetworkReconnect()
    }
  })
  
  window.addEventListener('offline', () => {
    isOnline.value = false
  })
}
```

## 🏗️ Build & Deployment Issues

### Issue: Build Size Too Large
**Symptoms**: Slow loading, large bundle warnings

**Analysis**:
```bash
# Analyze bundle size
npm run build
npx vite-bundle-analyzer dist

# Check largest files
du -sh dist/assets/*
```

**Solutions**:
```typescript
// vite.config.ts - Add chunk splitting
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          ui: ['@headlessui/vue', 'tailwindcss']
        }
      }
    }
  }
})
```

### Issue: Static File 404 Errors
**Symptoms**: Assets not found after deployment

**Common Causes**:
1. **Wrong Base Path**: Set correct `base` in `vite.config.ts`
2. **Server Configuration**: Configure web server for SPA routing

**Solutions**:
```typescript
// vite.config.ts - Set base path for subdirectory deployment
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/music-player/' : '/'
})
```

**Apache (.htaccess)**:
```apache
RewriteEngine On
RewriteRule ^(?!.*\.).*$ /index.html [L]

# Cache static assets
<FilesMatch "\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$">
  ExpiresActive On
  ExpiresDefault "access plus 1 year"
</FilesMatch>
```

**Nginx**:
```nginx
location / {
  try_files $uri $uri/ /index.html;
}

location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}
```

### Issue: Environment Variables Not Working
**Symptoms**: `undefined` values for environment variables

**Solutions**:
```bash
# Check .env file location (should be in project root)
ls -la .env*

# Verify variable names start with VITE_
# ✅ Correct
VITE_API_BASE_URL=https://api.example.com

# ❌ Incorrect
API_BASE_URL=https://api.example.com
```

**Runtime Check**:
```typescript
// Check variables are loaded
console.log('Environment:', {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  MUSIC_BASE_URL: import.meta.env.VITE_MUSIC_BASE_URL,
  MODE: import.meta.env.MODE,
  DEV: import.meta.env.DEV
})
```

## 🎵 Audio Playback Issues

### Issue: Audio Format Not Supported
**Symptoms**: Some songs don't play, format errors

**Solutions**:
```typescript
// Check audio format support
function checkAudioSupport() {
  const audio = new Audio()
  const formats = {
    mp3: audio.canPlayType('audio/mpeg'),
    ogg: audio.canPlayType('audio/ogg'),
    wav: audio.canPlayType('audio/wav'),
    m4a: audio.canPlayType('audio/mp4')
  }
  console.log('Supported formats:', formats)
  return formats
}

// Fallback format handling
async function loadAudioWithFallback(songId: number) {
  const formats = ['mp3', 'ogg', 'wav']
  
  for (const format of formats) {
    try {
      const url = `${MUSIC_BASE_URL}/link.${songId}.${format}`
      const response = await fetch(url, { method: 'HEAD' })
      if (response.ok) {
        return url
      }
    } catch (error) {
      continue
    }
  }
  
  throw new Error('No supported audio format found')
}
```

### Issue: Audio Cutting Out or Stuttering
**Symptoms**: Intermittent audio playback, buffering issues

**Solutions**:
```typescript
// Increase buffer size
audioElement.preload = 'auto'

// Monitor buffer health
audioElement.addEventListener('progress', () => {
  if (audioElement.buffered.length > 0) {
    const buffered = audioElement.buffered.end(0)
    const duration = audioElement.duration
    const bufferPercent = (buffered / duration) * 100
    
    if (bufferPercent < 25) {
      console.warn('Low buffer:', bufferPercent + '%')
    }
  }
})

// Handle stalling
audioElement.addEventListener('stalled', () => {
  console.warn('Audio stalled - network issue?')
  // Implement retry logic
})
```

### Issue: Seeking Not Working
**Symptoms**: Progress bar doesn't respond to clicks

**Debug Steps**:
```typescript
// Check if audio is seekable
audioElement.addEventListener('loadedmetadata', () => {
  console.log('Seekable ranges:', audioElement.seekable.length)
  console.log('Duration:', audioElement.duration)
})

// Verify seeking implementation
function seekTo(time: number) {
  if (audioElement && !isNaN(audioElement.duration)) {
    const seekTime = Math.max(0, Math.min(time, audioElement.duration))
    audioElement.currentTime = seekTime
    console.log('Seeking to:', seekTime)
  }
}
```

## 🗄️ Data & Storage Issues

### Issue: localStorage Quota Exceeded
**Symptoms**: Data not saving, quota exceeded errors

**Solutions**:
```typescript
// Check storage usage
function checkStorageQuota() {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    navigator.storage.estimate().then(estimate => {
      console.log('Storage quota:', estimate.quota)
      console.log('Storage usage:', estimate.usage)
      console.log('Percentage used:', (estimate.usage! / estimate.quota!) * 100)
    })
  }
}

// Implement storage cleanup
function cleanupOldData() {
  const keys = Object.keys(localStorage)
  keys.forEach(key => {
    if (key.startsWith('music-player-cache-')) {
      const data = JSON.parse(localStorage.getItem(key) || '{}')
      const age = Date.now() - (data.timestamp || 0)
      
      // Remove data older than 7 days
      if (age > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(key)
      }
    }
  })
}
```

### Issue: Playlist Data Corruption
**Symptoms**: Playlists not loading, invalid data errors

**Recovery Steps**:
```typescript
// Validate playlist data structure
function validatePlaylist(playlist: any): boolean {
  return (
    playlist &&
    typeof playlist.id === 'number' &&
    typeof playlist.name === 'string' &&
    Array.isArray(playlist.songs)
  )
}

// Recover corrupted playlists
function recoverPlaylists() {
  try {
    const playlists = JSON.parse(localStorage.getItem('playlists') || '[]')
    const validPlaylists = playlists.filter(validatePlaylist)
    
    if (validPlaylists.length !== playlists.length) {
      console.warn('Recovered playlists, some data lost')
      localStorage.setItem('playlists', JSON.stringify(validPlaylists))
    }
    
    return validPlaylists
  } catch (error) {
    console.error('Playlist recovery failed:', error)
    return []
  }
}
```

## 🔍 Performance Issues

### Issue: Slow Initial Load
**Symptoms**: Long loading times, white screen

**Optimization**:
```typescript
// Implement lazy loading
const Home = defineAsyncComponent(() => import('@/views/Home.vue'))
const Library = defineAsyncComponent(() => import('@/views/Library.vue'))

// Preload critical resources
function preloadCriticalResources() {
  const criticalSongs = [1, 2, 3] // Most popular songs
  
  criticalSongs.forEach(songId => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'audio'
    link.href = getMusicUrl(`link.${songId}.mp3`)
    document.head.appendChild(link)
  })
}
```

### Issue: Memory Leaks
**Symptoms**: Performance degrades over time, high memory usage

**Prevention**:
```typescript
// Cleanup on component unmount
onUnmounted(() => {
  // Clear intervals
  if (playtimeInterval.value) {
    clearInterval(playtimeInterval.value)
  }
  
  // Remove event listeners
  if (audioElement.value) {
    audioElement.value.removeEventListener('ended', handleSongEnd)
    audioElement.value.removeEventListener('timeupdate', updateProgress)
  }
  
  // Clear audio source
  if (audioElement.value) {
    audioElement.value.src = ''
    audioElement.value.load()
  }
})
```

## 🛠️ Debugging Tools

### Browser Developer Tools
```javascript
// Enable verbose logging
localStorage.setItem('debug', 'music-player:*')

// Monitor Pinia state
window.addEventListener('load', () => {
  if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    console.log('Vue DevTools available')
  }
})

// Performance monitoring
console.time('app-init')
// ... app initialization
console.timeEnd('app-init')
```

### Network Debugging
```bash
# Test with curl
curl -v -X GET "https://api.yourdomain.com/api/songs?limit=1"

# Monitor network traffic
# Chrome DevTools → Network tab → Filter by XHR/Fetch

# Test CORS
curl -H "Origin: http://localhost:5173" \
     -H "Access-Control-Request-Method: GET" \
     -X OPTIONS \
     https://api.yourdomain.com/api/songs
```

### Audio Debugging
```typescript
// Audio event logging
function setupAudioDebugging(audio: HTMLAudioElement) {
  const events = [
    'loadstart', 'loadeddata', 'loadedmetadata', 'canplay',
    'canplaythrough', 'play', 'pause', 'ended', 'error',
    'stalled', 'suspend', 'abort', 'emptied', 'waiting'
  ]
  
  events.forEach(event => {
    audio.addEventListener(event, () => {
      console.log(`Audio event: ${event}`, {
        currentTime: audio.currentTime,
        duration: audio.duration,
        readyState: audio.readyState,
        networkState: audio.networkState
      })
    })
  })
}
```

## 📞 Getting Additional Help

### Information to Collect
When reporting issues, include:

1. **Environment**:
   - Node.js version (`node --version`)
   - npm/yarn version
   - Operating system
   - Browser and version

2. **Error Details**:
   - Console error messages
   - Network tab responses
   - Steps to reproduce

3. **Configuration**:
   - Environment variables (sanitized)
   - Build configuration
   - Deployment setup

### Useful Commands
```bash
# Generate system report
npm run build 2>&1 | tee build-log.txt
npm run type-check 2>&1 | tee type-check.log

# Network diagnostics
nslookup api.yourdomain.com
ping api.yourdomain.com
curl -I https://api.yourdomain.com/health

# Clear all caches and restart
rm -rf node_modules/.cache
rm -rf node_modules/.vite
rm -rf dist
rm tsconfig.tsbuildinfo
npm install
npm run dev
```

---

**Related Documentation:**
- [FAQ](./20-FAQ.md)
- [Network Handling](./15-Network-Handling.md)
- [Development Setup](./03-Development-Setup.md)
- [API Specifications](./17-API-Specifications.md)