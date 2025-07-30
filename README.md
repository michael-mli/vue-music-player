# Mic's Music Player

A modern Vue.js music player with PWA support, built to replace the existing PHP-based music player while maintaining compatibility with the current file structure.

## Features

- 🎵 **Modern UI**: Spotify-inspired design with dark/light theme support
- 🌍 **Internationalization**: Support for English and Chinese
- 📱 **PWA Ready**: Installable app with offline support
- 🎧 **Advanced Player**: Shuffle, repeat, volume control, progress seeking
- 📝 **Lyrics Display**: Real-time lyrics with search functionality
- 📚 **Playlist Management**: Create, edit, and manage custom playlists
- 🔍 **Search**: Search across song titles and lyrics
- ❤️ **Favorites**: Mark and organize favorite songs
- ⌨️ **Keyboard Shortcuts**: Space to play/pause, arrow keys for navigation

## Tech Stack

- **Frontend**: Vue.js 3 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **State Management**: Pinia
- **Icons**: Heroicons
- **PWA**: Vite PWA Plugin + Workbox
- **i18n**: Vue I18n

## Development

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
cd vue-music-player
npm install
```

### Configuration

The app uses environment variables for configuration. Copy and modify the example:

```bash
# For development with mock data
cp .env .env.local

# For development with real PHP server
cp .env.local.example .env.local
# Edit .env.local with your server details
```

### Development Server

```bash
npm run dev
```

The app will start at `http://localhost:5173` and proxy music files from your configured server.

### Build for Production

```bash
# Production build (same directory deployment)
npm run build

# Staging build (subdirectory deployment)  
npm run build -- --mode staging

# Custom environment
npm run build -- --mode production --env-file .env.custom
```

### Preview Production Build

```bash
npm run preview
```

## File Structure Compatibility

The app is designed to work with the existing file structure:

- **Music files**: `/link.{1-1282}.mp3`
- **Lyrics**: `/lyrics/link.{number}.mp3.l`
- **Playlists**: `/data/{user}.{playlist}.pl`

## Keyboard Shortcuts

- `Space`: Play/Pause
- `Ctrl/Cmd + →`: Next song
- `Ctrl/Cmd + ←`: Previous song  
- `Ctrl/Cmd + L`: Toggle lyrics panel

## PWA Features

- Install app on desktop/mobile
- Offline music playback (cached songs)
- Background audio with Media Session API
- Auto-update notifications
- App shortcuts

## API Integration

The app uses mock data during development. To integrate with the PHP backend:

1. Update the API base URL in `src/services/api.ts`
2. Replace mock service calls with real API calls in stores
3. Implement the PHP API endpoints as specified in the PRD

## Contributing

1. Follow the existing code style and patterns
2. Use TypeScript for type safety
3. Add i18n keys for new text content
4. Test PWA features in production build
5. Ensure accessibility compliance

## License

MIT License - see LICENSE file for details