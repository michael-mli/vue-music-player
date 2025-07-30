# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a modern Vue.js 3 music player application designed to replace an existing PHP-based music player while maintaining compatibility with the current file structure. It features a Spotify-inspired design, PWA capabilities, and supports existing music files and playlists.

## Development Commands

### Core Development
- `npm run dev` - Start development server at http://localhost:5173
- `npm run build` - Production build with type checking
- `npm run preview` - Preview production build locally
- `npm run type-check` - Run TypeScript type checking without building

### Build Variations
- `npm run build -- --mode staging` - Build for subdirectory deployment
- `npm run build -- --mode production --env-file .env.custom` - Build with custom environment

## Architecture Overview

### State Management
The application uses **Pinia** for state management with three main stores:
- `stores/player.ts` - Audio player state, playback controls, media session API
- `stores/songs.ts` - Song library, search, favorites management
- `stores/playlists.ts` - Playlist creation, editing, and management

### Component Structure
- **Player Components** (`components/Player/`) - Core audio controls, progress bar, volume
- **UI Components** (`components/UI/`) - Header, sidebar, modals, notifications
- **Lyrics Component** (`components/Lyrics/`) - Collapsible lyrics panel with search
- **Library Components** (`components/Library/`) - Song browsing and management

### File Compatibility
The app maintains compatibility with existing file structure:
- Music files: `/link.{1-1282}.mp3`
- Lyrics files: `/lyrics/link.{number}.mp3.l`
- Playlists: `/data/{user}.{playlist}.pl`

### Configuration System
Environment-based configuration in `src/config/index.ts`:
- `VITE_MUSIC_BASE_URL` - Base URL for MP3 files
- `VITE_LYRICS_BASE_URL` - Base URL for lyrics files
- `VITE_API_BASE_URL` - API endpoint base URL
- `VITE_ENABLE_MOCK_DATA` - Toggle between mock and real data

### PWA Features
Configured in `vite.config.ts` with:
- Service worker auto-registration
- Audio file caching strategy (CacheFirst, 30 days)
- API response caching (NetworkFirst, 24 hours)
- Media Session API integration for background controls

### Key Technical Details

#### Audio Management
The player store (`stores/player.ts`) handles:
- HTML5 Audio API integration
- Queue management with shuffle/repeat modes
- Media Session API for background playback controls
- Global keyboard shortcuts (Space, Ctrl+←/→, Ctrl+L)

#### Development Proxy
Vite dev server proxies:
- `/api/*` → `http://localhost:8080` (API calls)
- `/music/*` → `http://localhost:8080` (music files)
- PHP endpoints → `http://localhost:8080` (legacy compatibility)

#### TypeScript Types
Core interfaces in `src/types/index.ts`:
- `Song` - Song metadata and properties
- `Playlist` - Playlist structure
- `PlayerState` - Complete player state
- `APIResponse<T>` - Standardized API responses

### Internationalization
- Vue I18n setup in `main.ts` with English/Chinese support
- Language files in `src/locales/`
- Language switcher component with localStorage persistence

### Deployment Architecture
Supports multiple deployment scenarios:
1. Same directory as existing PHP app (recommended)
2. Subdirectory deployment with relative paths
3. Separate server/CDN deployment
4. Development setup against existing PHP server

See `DEPLOYMENT.md` for detailed deployment instructions and configurations.