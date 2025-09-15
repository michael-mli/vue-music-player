# Project Overview

## 🎵 Vue Music Player

A modern, feature-rich web-based music player built with Vue.js 3, designed to replace legacy PHP-based music systems while maintaining full compatibility with existing file structures and playlists.

## ✨ Key Features

### Core Functionality
- **🎶 Music Playback**: Full-featured audio player with queue management
- **📱 Progressive Web App**: Installable with offline capabilities
- **🔍 Smart Search**: Real-time search with intelligent filtering
- **📋 Playlist Management**: Create, edit, and organize custom playlists
- **❤️ Favorites**: Mark and manage favorite songs
- **🎨 Modern UI**: Spotify-inspired responsive design

### Advanced Features
- **🌐 Multi-language Support**: English and Chinese localization
- **🎵 Lyrics Display**: Collapsible lyrics panel with search
- **⏰ Sleep Timer**: Auto-pause functionality with customizable timers
- **📊 Playtime Tracking**: Session and total playtime statistics
- **🎛️ Audio Controls**: Volume, shuffle, repeat, and seeking
- **📱 Media Session API**: Background playback controls and notifications

### Technical Features
- **🔄 Network Resilience**: Auto-retry and connectivity handling
- **⚡ Performance Optimized**: Lazy loading and efficient caching
- **🛡️ Type Safety**: Full TypeScript implementation
- **📦 Modern Build**: Vite-powered development and production builds

## 🏗️ Technology Stack

### Frontend Framework
- **Vue.js 3**: Composition API with TypeScript
- **Pinia**: Modern state management
- **Vue Router**: Client-side routing
- **Vue I18n**: Internationalization

### Development Tools
- **Vite**: Fast build tool and dev server
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **ESLint + Prettier**: Code quality and formatting

### PWA & Performance
- **Vite PWA Plugin**: Service worker and caching
- **Workbox**: Advanced caching strategies
- **Web APIs**: Media Session, Storage, Network Information

### Backend Integration
- **RESTful APIs**: Flexible backend communication
- **Cloudflare Workers**: Serverless backend option
- **File Compatibility**: Legacy PHP system support

## 🎯 Project Goals

### Primary Objectives
1. **Modern User Experience**: Intuitive, responsive interface
2. **Performance**: Fast loading and smooth playback
3. **Compatibility**: Seamless migration from legacy systems
4. **Reliability**: Robust error handling and network resilience
5. **Accessibility**: WCAG compliant and keyboard navigation

### Technical Objectives
1. **Type Safety**: Full TypeScript coverage
2. **Maintainability**: Clean, documented codebase
3. **Scalability**: Architecture supporting growth
4. **Performance**: Sub-3-second load times
5. **PWA Compliance**: Full offline functionality

## 📊 System Architecture

### High-Level Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Vue Frontend  │◄──►│   API Gateway   │◄──►│  File Storage   │
│                 │    │                 │    │                 │
│ • Components    │    │ • REST API      │    │ • MP3 Files     │
│ • Pinia Stores  │    │ • Authentication│    │ • Lyrics Files  │
│ • PWA Service   │    │ • Rate Limiting │    │ • Playlists     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Component Hierarchy
```
App.vue
├── Header.vue
├── Sidebar.vue
├── Router View
│   ├── Home.vue (Dashboard)
│   ├── Library.vue (Song Browser)
│   ├── Search.vue (Search Interface)
│   └── Playlist.vue (Playlist Management)
├── Player Components
│   ├── PlayerControls.vue
│   ├── ProgressBar.vue
│   ├── VolumeControl.vue
│   └── MusicVisualizer.vue
└── UI Components
    ├── Modals (Playlist, Install)
    ├── Notifications
    └── Language Switcher
```

### Data Flow
```
User Interaction → Component → Pinia Store → API Service → Backend
                                    ↓
Audio Element ← Media Session ← Player Store ← API Response
```

## 🔧 Configuration System

### Environment-Based Configuration
The application uses a centralized configuration system supporting multiple deployment scenarios:

```typescript
interface AppConfig {
  // API Configuration
  apiBaseUrl: string      // Backend API endpoint
  musicBaseUrl: string    // Music file base URL
  lyricsBaseUrl: string   // Lyrics file base URL
  
  // Application Settings
  appTitle: string        // Application title
  enableMockData: boolean // Development mock data
  
  // Audio Settings
  defaultVolume: number   // Default playback volume
  maxCachedSongs: number  // Cache limit
  
  // UI Settings
  songsPerPage: number    // Pagination size
  searchDebounceMs: number // Search delay
}
```

### Deployment Modes
- **Development**: Local dev server with hot reload
- **Production**: Optimized build with caching
- **Staging**: Subdirectory deployment support
- **Legacy**: PHP system compatibility mode

## 📁 File Structure Compatibility

The system maintains compatibility with existing file structures:

### Music Files
```
/music/
├── link.1.mp3      # Song ID 1
├── link.2.mp3      # Song ID 2
└── ...
├── link.1282.mp3   # Song ID 1282
```

### Lyrics Files
```
/lyrics/
├── link.1.mp3.l    # Lyrics for song 1
├── link.2.mp3.l    # Lyrics for song 2
└── ...
```

### Playlist Files
```
/data/
├── user.playlist1.pl   # User playlist 1
├── user.playlist2.pl   # User playlist 2
└── ...
```

## 🎨 Design Philosophy

### User Experience Principles
1. **Simplicity**: Clean, uncluttered interface
2. **Consistency**: Uniform design patterns
3. **Accessibility**: Keyboard and screen reader support
4. **Responsiveness**: Mobile-first design approach
5. **Performance**: Smooth animations and interactions

### Visual Design
- **Color Scheme**: Dark theme with accent colors
- **Typography**: Clear, readable font hierarchy
- **Iconography**: Consistent icon system
- **Spacing**: Logical spacing and rhythm
- **Feedback**: Clear loading and error states

## 🚀 Getting Started

### Quick Start
1. Clone the repository
2. Install dependencies: `npm install`
3. Start development server: `npm run dev`
4. Open http://localhost:5173

### Next Steps
- [Development Setup](./03-Development-Setup.md) for detailed configuration
- [System Architecture](./04-System-Architecture.md) for technical deep dive
- [API Integration](./07-API-Integration.md) for backend setup

---

**Related Documentation:**
- [Quick Start Guide](./02-Quick-Start.md)
- [System Architecture](./04-System-Architecture.md)
- [Development Setup](./03-Development-Setup.md)