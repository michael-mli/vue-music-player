# Deployment Guide

This guide covers different deployment scenarios for the Vue.js music player with configurable MP3 file paths.

## 📁 **File Structure Overview**

```
your-web-server/
├── music/                    # Your existing music directory
│   ├── link.1.mp3           # Music files
│   ├── link.2.mp3
│   ├── ...
│   ├── lyrics/              # Lyrics directory
│   │   ├── link.1.mp3.l
│   │   └── ...
│   ├── index.php            # Existing PHP app
│   └── ...
└── vue-app/                 # Vue app deployment (optional)
```

## 🔧 **Configuration Options**

### **Environment Variables**

| Variable | Description | Development | Production |
|----------|-------------|-------------|------------|
| `VITE_MUSIC_BASE_URL` | Base URL for MP3 files | `http://localhost:8080` | `/music` |
| `VITE_LYRICS_BASE_URL` | Base URL for lyrics | `http://localhost:8080/lyrics` | `/music/lyrics` |
| `VITE_API_BASE_URL` | API endpoint base | `http://localhost:8080/api` | `/api` |
| `VITE_ENABLE_MOCK_DATA` | Use mock data | `true` | `false` |

## 🚀 **Deployment Scenarios**

### **Scenario 1: Same Directory Deployment (Recommended)**

Deploy Vue app in the same directory as your music files.

```bash
# Build the app
npm run build

# Deploy to your music directory  
cp -r dist/* /path/to/your/music/

# Configuration
VITE_MUSIC_BASE_URL=""           # Same directory
VITE_LYRICS_BASE_URL="lyrics"    # Relative path
```

**Result:**
- Vue app: `http://yourdomain.com/music/`
- Music files: `http://yourdomain.com/music/link.1.mp3`
- PHP app: `http://yourdomain.com/music/index.php`

### **Scenario 2: Subdirectory Deployment**

Deploy Vue app in a subdirectory.

```bash
# Build with staging config
npm run build -- --mode staging

# Deploy to subdirectory
mkdir -p /path/to/your/music/app
cp -r dist/* /path/to/your/music/app/

# Configuration (.env.staging)
VITE_MUSIC_BASE_URL="../"        # Go up one level
VITE_LYRICS_BASE_URL="../lyrics" # Go up one level
```

**Result:**
- Vue app: `http://yourdomain.com/music/app/`
- Music files: `http://yourdomain.com/music/link.1.mp3`

### **Scenario 3: Separate Server/CDN**

Deploy Vue app on different server, music files on CDN.

```bash
# Configuration
VITE_MUSIC_BASE_URL="https://cdn.yourdomain.com/music"
VITE_LYRICS_BASE_URL="https://cdn.yourdomain.com/music/lyrics"
VITE_API_BASE_URL="https://api.yourdomain.com"
```

### **Scenario 4: Development Setup**

For local development against existing PHP server.

```bash
# Copy example config
cp .env.local.example .env.local

# Edit .env.local
VITE_MUSIC_BASE_URL="http://localhost:8080"
VITE_ENABLE_MOCK_DATA="false"

# Start dev server
npm run dev
```

## 📋 **Step-by-Step Deployment**

### **For Same Directory (Production)**

1. **Configure environment:**
```bash
# Create .env.production.local (overrides .env.production)
echo 'VITE_MUSIC_BASE_URL=""' > .env.production.local
echo 'VITE_LYRICS_BASE_URL="lyrics"' >> .env.production.local
```

2. **Build the app:**
```bash
npm run build
```

3. **Backup existing files:**
```bash
cd /path/to/your/music
cp index.html index.html.backup 2>/dev/null || true
```

4. **Deploy:**
```bash
cp -r vue-music-player/dist/* /path/to/your/music/
```

5. **Test:**
- Vue app: `http://yourdomain.com/music/`
- Music playback should work
- Lyrics should load from existing files

### **For Subdirectory (Staging)**

1. **Build with staging config:**
```bash
npm run build -- --mode staging
```

2. **Deploy:**
```bash
mkdir -p /path/to/your/music/vue-app
cp -r dist/* /path/to/your/music/vue-app/
```

3. **Test:**
- Vue app: `http://yourdomain.com/music/vue-app/`

## 🔍 **Troubleshooting**

### **Music Files Not Loading**

Check browser network tab for 404 errors:

```bash
# If seeing: GET http://yourdomain.com/link.1.mp3 404
# Your VITE_MUSIC_BASE_URL is wrong

# Should be one of:
VITE_MUSIC_BASE_URL=""                    # Same directory
VITE_MUSIC_BASE_URL="/music"              # Absolute path  
VITE_MUSIC_BASE_URL="../"                 # Relative path
VITE_MUSIC_BASE_URL="https://cdn.com"     # Full URL
```

### **Lyrics Not Loading**

```bash
# Check lyrics path in network tab
# If seeing: GET http://yourdomain.com/lyrics/link.1.mp3.l 404

# Adjust:
VITE_LYRICS_BASE_URL="lyrics"             # Same directory
VITE_LYRICS_BASE_URL="/music/lyrics"      # Absolute path
```

### **CORS Issues**

If music files are on different domain:

```apache
# Add to .htaccess in music directory
Header set Access-Control-Allow-Origin "*"
Header set Access-Control-Allow-Methods "GET, OPTIONS"
```

## 📝 **Custom Configuration**

You can also modify `src/config/index.ts` directly:

```typescript
// For custom paths or additional logic
export function getMusicUrl(filename: string): string {
  // Custom logic here
  if (filename.includes('special')) {
    return `https://special-cdn.com/${filename}`
  }
  
  const baseUrl = config.musicBaseUrl
  return `${baseUrl}/${filename}`
}
```

## 🔄 **Environment Switching**

```bash
# Development
npm run dev

# Build for production
npm run build

# Build for staging  
npm run build -- --mode staging

# Build with custom env file
npm run build -- --mode production --env-file .env.custom
```

This configuration system ensures your MP3 files are properly accessible regardless of your deployment architecture!
## Shared-song link previews (nginx)

Chat apps read raw HTML without running JS, so `/music?song=N` previews need server-side
tags. The auth backend (`server/index.js`) serves the deployed `index.html` with
`<title>`/`og:` tags rewritten (song title from `metadata.json`, `?note=`, poster image).
Route it in the nginx site config, before the SPA `location /`:

```nginx
# NB: the add_header lines are required. Defining ANY add_header in a location stops
# inheritance of the server-level security headers — including a Content-Security-Policy
# without 'unsafe-eval' that breaks the SPA (vue-i18n compiles messages with eval), which
# otherwise makes shared links load a blank page forever. "location /" already defines
# its own add_header, which is why the rest of the app never sees that CSP.
location = /music {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
location = /music/ {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```
