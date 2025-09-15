# Cloudflare Backend Implementation Guide

Complete implementation guide for deploying the Vue Music Player backend using Cloudflare's serverless platform with Workers, D1, R2, and KV.

## 🏗️ Architecture Overview

### Cloudflare Stack Components
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Vue Frontend   │◄──►│ Cloudflare Edge │◄──►│ Origin Services │
│                 │    │                 │    │                 │
│ • PWA App       │    │ • Workers       │    │ • D1 Database   │
│ • Service Worker│    │ • KV Cache      │    │ • R2 Storage    │
│ • Edge Caching  │    │ • Rate Limiting │    │ • Analytics     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Service Breakdown
- **Cloudflare Workers**: API endpoints and business logic
- **Cloudflare D1**: SQL database for metadata
- **Cloudflare R2**: Object storage for MP3/lyrics files  
- **Cloudflare KV**: Fast caching and session storage
- **Cloudflare Pages**: Frontend hosting (optional)
- **Cloudflare Analytics**: Performance monitoring

## 🚀 Project Setup

### 1. Prerequisites
```bash
# Install Wrangler CLI globally
npm install -g wrangler

# Authenticate with Cloudflare
wrangler login

# Verify account access
wrangler whoami
```

### 2. Initialize Worker Project
```bash
# Create new project
mkdir music-player-api && cd music-player-api

# Initialize with TypeScript template
wrangler init --typescript

# Install dependencies
npm install @cloudflare/workers-types
npm install --save-dev typescript @types/node
```

### 3. Project Structure
```
music-player-api/
├── src/
│   ├── index.ts              # Main worker entry
│   ├── router.ts             # Request routing
│   ├── handlers/
│   │   ├── songs.ts          # Song management
│   │   ├── playlists.ts      # Playlist operations
│   │   ├── lyrics.ts         # Lyrics handling
│   │   └── health.ts         # Health checks
│   ├── models/
│   │   ├── song.ts           # Song data model
│   │   ├── playlist.ts       # Playlist model
│   │   └── user.ts           # User model
│   ├── services/
│   │   ├── database.ts       # D1 operations
│   │   ├── storage.ts        # R2 operations
│   │   ├── cache.ts          # KV operations
│   │   └── auth.ts           # Authentication
│   └── utils/
│       ├── cors.ts           # CORS handling
│       ├── validation.ts     # Input validation
│       └── errors.ts         # Error handling
├── migrations/
│   └── 001_initial_schema.sql
├── wrangler.toml             # Cloudflare config
├── package.json
└── tsconfig.json
```

## 🗄️ Database Setup (D1)

### 1. Create D1 Database
```bash
# Create production database
wrangler d1 create music-player-db

# Create development database
wrangler d1 create music-player-db-dev
```

### 2. Database Schema
```sql
-- migrations/001_initial_schema.sql

-- Songs table
CREATE TABLE songs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  duration INTEGER DEFAULT 0,
  file_size INTEGER DEFAULT 0,
  file_format TEXT DEFAULT 'mp3',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Playlists table
CREATE TABLE playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Playlist songs junction table
CREATE TABLE playlist_songs (
  playlist_id INTEGER NOT NULL,
  song_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

-- User favorites
CREATE TABLE user_favorites (
  user_id TEXT NOT NULL,
  song_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, song_id),
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

-- User sessions for analytics
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_playtime INTEGER DEFAULT 0,
  songs_played INTEGER DEFAULT 0
);

-- Performance indexes
CREATE INDEX idx_songs_title ON songs(title);
CREATE INDEX idx_songs_created_at ON songs(created_at DESC);
CREATE INDEX idx_playlists_user_id ON playlists(user_id);
CREATE INDEX idx_playlists_public ON playlists(is_public, created_at DESC);
CREATE INDEX idx_playlist_songs_playlist ON playlist_songs(playlist_id, position);
CREATE INDEX idx_user_favorites_user ON user_favorites(user_id, created_at DESC);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id, started_at DESC);

-- Full-text search for songs (if supported)
CREATE VIRTUAL TABLE songs_fts USING fts5(title, content=songs, content_rowid=id);

-- Triggers for updated_at
CREATE TRIGGER update_songs_timestamp 
  AFTER UPDATE ON songs 
  BEGIN 
    UPDATE songs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

CREATE TRIGGER update_playlists_timestamp 
  AFTER UPDATE ON playlists 
  BEGIN 
    UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;
```

### 3. Run Migrations
```bash
# Apply to development database
wrangler d1 execute music-player-db-dev --file=./migrations/001_initial_schema.sql

# Apply to production database
wrangler d1 execute music-player-db --file=./migrations/001_initial_schema.sql

# Verify schema
wrangler d1 execute music-player-db --command="SELECT name FROM sqlite_master WHERE type='table';"
```

## 📦 File Storage (R2)

### 1. Create R2 Buckets
```bash
# Create production bucket
wrangler r2 bucket create music-files

# Create development bucket  
wrangler r2 bucket create music-files-dev

# List buckets
wrangler r2 bucket list
```

### 2. Upload Existing Files
```bash
# Bulk upload script
#!/bin/bash
# upload-music.sh

BUCKET_NAME="music-files"
LOCAL_MUSIC_DIR="./music"
LOCAL_LYRICS_DIR="./lyrics"

echo "Uploading music files..."
for file in "$LOCAL_MUSIC_DIR"/*.mp3; do
  filename=$(basename "$file")
  echo "Uploading $filename"
  wrangler r2 object put "$BUCKET_NAME/music/$filename" --file="$file" \
    --content-type="audio/mpeg" \
    --cache-control="public, max-age=31536000"
done

echo "Uploading lyrics files..."
for file in "$LOCAL_LYRICS_DIR"/*.l; do
  filename=$(basename "$file")
  echo "Uploading $filename"
  wrangler r2 object put "$BUCKET_NAME/lyrics/$filename" --file="$file" \
    --content-type="text/plain" \
    --cache-control="public, max-age=86400"
done

echo "Upload complete!"
```

### 3. Configure Custom Domain
```bash
# Add custom domain for R2 bucket
wrangler r2 bucket create music-files --domain music.yourdomain.com

# Configure DNS (add to your DNS provider)
# Type: CNAME
# Name: music
# Value: music-files.your-account-id.r2.cloudflarestorage.com
```

## ⚡ Worker Implementation

### 1. Main Entry Point
```typescript
// src/index.ts
import { router } from './router'
import { corsHeaders } from './utils/cors'

export interface Env {
  // Database
  DB: D1Database
  
  // Storage
  R2: R2Bucket
  
  // Cache
  KV: KVNamespace
  
  // Environment variables
  JWT_SECRET: string
  ALLOWED_ORIGINS: string
  RATE_LIMIT_PER_MINUTE: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      const response = await router(request, env, ctx)
      
      // Add CORS headers to all responses
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value)
      })
      
      return response
    } catch (error) {
      console.error('Worker error:', error)
      
      return new Response(
        JSON.stringify({ 
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }),
        { 
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      )
    }
  }
}
```

### 2. Request Router
```typescript
// src/router.ts
import { handleSongs } from './handlers/songs'
import { handlePlaylists } from './handlers/playlists'
import { handleLyrics } from './handlers/lyrics'
import { handleHealth } from './handlers/health'
import type { Env } from './index'

export async function router(
  request: Request, 
  env: Env, 
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  // Health check
  if (path === '/health' || path === '/') {
    return handleHealth(request, env)
  }

  // API routes
  if (path.startsWith('/api/songs')) {
    return handleSongs(request, env, ctx)
  }
  
  if (path.startsWith('/api/playlists')) {
    return handlePlaylists(request, env, ctx)
  }
  
  if (path.startsWith('/api/lyrics')) {
    return handleLyrics(request, env, ctx)
  }

  // File serving (if not using custom R2 domain)
  if (path.startsWith('/music/') || path.startsWith('/lyrics/')) {
    return handleFileRequest(request, env)
  }

  return new Response('Not Found', { status: 404 })
}

async function handleFileRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const key = url.pathname.slice(1) // Remove leading slash
  
  const object = await env.R2.get(key)
  
  if (!object) {
    return new Response('File not found', { status: 404 })
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  
  return new Response(object.body, { headers })
}
```

### 3. Database Service
```typescript
// src/services/database.ts
import type { Env } from '../index'

export class DatabaseService {
  constructor(private env: Env) {}

  async getAllSongs(limit = 50, offset = 0, search?: string) {
    let query = `
      SELECT id, title, duration, file_size, created_at 
      FROM songs 
    `
    const params: any[] = []

    if (search) {
      query += ` WHERE title LIKE ? `
      params.push(`%${search}%`)
    }

    query += ` ORDER BY id LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const result = await this.env.DB.prepare(query)
      .bind(...params)
      .all()

    return {
      songs: result.results,
      total: result.results.length,
      hasMore: result.results.length === limit
    }
  }

  async getSongById(id: number) {
    const query = 'SELECT * FROM songs WHERE id = ?'
    return await this.env.DB.prepare(query).bind(id).first()
  }

  async createPlaylist(userId: string, name: string, description?: string) {
    const query = `
      INSERT INTO playlists (user_id, name, description)
      VALUES (?, ?, ?)
      RETURNING id, name, created_at
    `
    
    return await this.env.DB.prepare(query)
      .bind(userId, name, description || null)
      .first()
  }

  async addSongToPlaylist(playlistId: number, songId: number, position?: number) {
    // Get current max position if not specified
    if (position === undefined) {
      const maxPos = await this.env.DB.prepare(
        'SELECT MAX(position) as max_pos FROM playlist_songs WHERE playlist_id = ?'
      ).bind(playlistId).first() as { max_pos: number | null }
      
      position = (maxPos?.max_pos || 0) + 1
    }

    const query = `
      INSERT INTO playlist_songs (playlist_id, song_id, position)
      VALUES (?, ?, ?)
      ON CONFLICT (playlist_id, song_id) DO UPDATE SET position = excluded.position
    `
    
    return await this.env.DB.prepare(query)
      .bind(playlistId, songId, position)
      .run()
  }

  async getUserFavorites(userId: string) {
    const query = `
      SELECT s.*, uf.created_at as favorited_at
      FROM songs s
      JOIN user_favorites uf ON s.id = uf.song_id
      WHERE uf.user_id = ?
      ORDER BY uf.created_at DESC
    `
    
    const result = await this.env.DB.prepare(query).bind(userId).all()
    return result.results
  }

  async addToFavorites(userId: string, songId: number) {
    const query = `
      INSERT INTO user_favorites (user_id, song_id)
      VALUES (?, ?)
      ON CONFLICT (user_id, song_id) DO NOTHING
    `
    
    return await this.env.DB.prepare(query).bind(userId, songId).run()
  }

  async removeFromFavorites(userId: string, songId: number) {
    const query = 'DELETE FROM user_favorites WHERE user_id = ? AND song_id = ?'
    return await this.env.DB.prepare(query).bind(userId, songId).run()
  }
}
```

### 4. Songs Handler
```typescript
// src/handlers/songs.ts
import { DatabaseService } from '../services/database'
import type { Env } from '../index'

export async function handleSongs(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method
  const pathParts = url.pathname.split('/').filter(Boolean)
  
  const db = new DatabaseService(env)

  try {
    // GET /api/songs - List songs with optional search
    if (method === 'GET' && pathParts.length === 2) {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
      const offset = parseInt(url.searchParams.get('offset') || '0')
      const search = url.searchParams.get('search') || undefined

      const result = await db.getAllSongs(limit, offset, search)
      
      // Add file URLs
      const songsWithUrls = result.songs.map((song: any) => ({
        ...song,
        url: `https://music.yourdomain.com/music/link.${song.id}.mp3`,
        lyricsUrl: `https://music.yourdomain.com/lyrics/link.${song.id}.mp3.l`
      }))

      return new Response(JSON.stringify({
        data: songsWithUrls,
        pagination: {
          limit,
          offset,
          total: result.total,
          hasMore: result.hasMore
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // GET /api/songs/:id - Get single song
    if (method === 'GET' && pathParts.length === 3) {
      const songId = parseInt(pathParts[2])
      
      if (isNaN(songId)) {
        return new Response('Invalid song ID', { status: 400 })
      }

      const song = await db.getSongById(songId)
      
      if (!song) {
        return new Response('Song not found', { status: 404 })
      }

      return new Response(JSON.stringify({
        ...song,
        url: `https://music.yourdomain.com/music/link.${song.id}.mp3`,
        lyricsUrl: `https://music.yourdomain.com/lyrics/link.${song.id}.mp3.l`
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response('Not Found', { status: 404 })
    
  } catch (error) {
    console.error('Songs handler error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
}
```

## ⚙️ Configuration

### 1. Wrangler Configuration
```toml
# wrangler.toml
name = "music-player-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

# Development environment
[env.development]
vars = { 
  ENVIRONMENT = "development",
  ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000",
  RATE_LIMIT_PER_MINUTE = "100"
}

[[env.development.d1_databases]]
binding = "DB"
database_name = "music-player-db-dev"
database_id = "your-dev-database-id"

[[env.development.kv_namespaces]]
binding = "KV"
id = "your-dev-kv-namespace-id"

[[env.development.r2_buckets]]
binding = "R2"
bucket_name = "music-files-dev"

# Production environment
[env.production]
vars = { 
  ENVIRONMENT = "production",
  ALLOWED_ORIGINS = "https://music.yourdomain.com",
  RATE_LIMIT_PER_MINUTE = "60"
}

[[env.production.d1_databases]]
binding = "DB"
database_name = "music-player-db"
database_id = "your-prod-database-id"

[[env.production.kv_namespaces]]
binding = "KV"
id = "your-prod-kv-namespace-id"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "music-files"

# Secrets (set via CLI)
# wrangler secret put JWT_SECRET --env production
```

### 2. TypeScript Configuration
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

## 🚀 Deployment

### 1. Set Secrets
```bash
# Set JWT secret
wrangler secret put JWT_SECRET --env production

# Verify secrets
wrangler secret list --env production
```

### 2. Deploy to Production
```bash
# Deploy to production
wrangler deploy --env production

# Deploy to development
wrangler deploy --env development

# Check deployment status
wrangler deployments list
```

### 3. Custom Domains
```bash
# Add custom domain for API
wrangler custom-domains add api.yourdomain.com --env production

# Verify domain setup
wrangler custom-domains list
```

### 4. Monitor Deployment
```bash
# View real-time logs
wrangler tail --env production

# Check analytics
wrangler analytics --env production
```

## 🔧 Frontend Integration

### 1. Update Environment Variables
```env
# .env.production
VITE_API_BASE_URL=https://api.yourdomain.com/api
VITE_MUSIC_BASE_URL=https://music.yourdomain.com/music
VITE_LYRICS_BASE_URL=https://music.yourdomain.com/lyrics
VITE_ENABLE_MOCK_DATA=false
```

### 2. Update API Service
```typescript
// src/services/api.ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

class ApiClient {
  private baseURL: string

  constructor() {
    this.baseURL = API_BASE_URL
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    })

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  // Songs API
  async getSongs(params: GetSongsParams = {}) {
    const searchParams = new URLSearchParams()
    
    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.search) searchParams.set('search', params.search)

    return this.request<GetSongsResponse>(`/songs?${searchParams}`)
  }

  async getSong(id: number) {
    return this.request<Song>(`/songs/${id}`)
  }

  // Playlists API
  async getPlaylists(userId: string) {
    return this.request<GetPlaylistsResponse>(`/playlists?userId=${userId}`)
  }

  async createPlaylist(data: CreatePlaylistData) {
    return this.request<Playlist>('/playlists', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }
}

export const apiClient = new ApiClient()
```

## 📊 Monitoring & Analytics

### 1. Built-in Analytics
```bash
# View worker analytics
wrangler analytics --env production

# View R2 analytics
wrangler r2 stats music-files

# View D1 analytics
wrangler d1 insights music-player-db
```

### 2. Custom Metrics
```typescript
// src/utils/analytics.ts
export class Analytics {
  constructor(private env: Env) {}

  async trackApiRequest(endpoint: string, method: string, duration: number, status: number) {
    // Store in KV for aggregation
    const key = `analytics:${new Date().toISOString().slice(0, 10)}:${endpoint}:${method}`
    const existing = await this.env.KV.get(key, 'json') || { count: 0, totalDuration: 0, errors: 0 }
    
    const updated = {
      count: existing.count + 1,
      totalDuration: existing.totalDuration + duration,
      errors: existing.errors + (status >= 400 ? 1 : 0)
    }
    
    await this.env.KV.put(key, JSON.stringify(updated), { expirationTtl: 86400 * 30 }) // 30 days
  }

  async trackSongPlay(songId: number, userId: string, duration: number) {
    // Track in D1 for detailed analytics
    await this.env.DB.prepare(`
      INSERT INTO song_plays (song_id, user_id, duration, played_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(songId, userId, duration).run()
  }
}
```

## 🛡️ Security Best Practices

### 1. Rate Limiting
```typescript
// src/utils/rateLimiter.ts
export class RateLimiter {
  constructor(private env: Env) {}

  async checkLimit(identifier: string, limit: number = 60): Promise<boolean> {
    const key = `rateLimit:${identifier}:${Math.floor(Date.now() / 60000)}` // per minute
    const current = await this.env.KV.get(key)
    const count = current ? parseInt(current) : 0
    
    if (count >= limit) {
      return false
    }
    
    await this.env.KV.put(key, (count + 1).toString(), { expirationTtl: 60 })
    return true
  }
}
```

### 2. Input Validation
```typescript
// src/utils/validation.ts
export function validateSongId(id: string): number {
  const songId = parseInt(id)
  if (isNaN(songId) || songId < 1 || songId > 9999) {
    throw new Error('Invalid song ID')
  }
  return songId
}

export function validatePlaylistName(name: string): string {
  if (!name || name.length < 1 || name.length > 100) {
    throw new Error('Playlist name must be 1-100 characters')
  }
  return name.trim()
}
```

## 🔄 Data Migration

### 1. Migration Script
```typescript
// scripts/migrate-data.ts
import { readdir, readFile } from 'fs/promises'
import { parse } from 'path'

async function migrateMusicFiles() {
  const musicDir = './music'
  const files = await readdir(musicDir)
  
  for (const file of files) {
    if (file.endsWith('.mp3')) {
      const { name } = parse(file)
      const id = parseInt(name.replace('link.', ''))
      
      if (!isNaN(id)) {
        // Upload to R2
        const fileBuffer = await readFile(`${musicDir}/${file}`)
        await uploadToR2(`music/${file}`, fileBuffer)
        
        // Add to D1
        await addSongToDatabase(id, `Song ${id}`)
        
        console.log(`Migrated: ${file}`)
      }
    }
  }
}

async function migratePlaylists() {
  const dataDir = './data'
  const files = await readdir(dataDir)
  
  for (const file of files) {
    if (file.endsWith('.pl')) {
      const content = await readFile(`${dataDir}/${file}`, 'utf-8')
      const [user, playlist] = file.replace('.pl', '').split('.')
      
      const songIds = content.split('\n')
        .filter(line => line.trim())
        .map(line => parseInt(line.trim()))
        .filter(id => !isNaN(id))
      
      await createPlaylistInDatabase(user, playlist, songIds)
      console.log(`Migrated playlist: ${file}`)
    }
  }
}
```

## 🚨 Troubleshooting

### Common Issues
1. **CORS Errors**: Verify `ALLOWED_ORIGINS` environment variable
2. **Database Connection**: Check D1 binding configuration
3. **File Not Found**: Verify R2 bucket setup and file uploads
4. **Rate Limiting**: Adjust limits based on usage patterns

### Debugging Commands
```bash
# View logs in real-time
wrangler tail --env production

# Test specific endpoints
curl -X GET "https://api.yourdomain.com/api/songs?limit=5"

# Check database content
wrangler d1 execute music-player-db --command="SELECT COUNT(*) FROM songs;"

# List R2 objects
wrangler r2 object list music-files --limit 10
```

---

**Related Documentation:**
- [API Specifications](./17-API-Specifications.md)
- [Build & Deployment](./10-Build-Deployment.md)
- [Data Migration](./18-Data-Migration.md)