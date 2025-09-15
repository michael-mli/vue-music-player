# Quick Start Guide

Get the Vue Music Player up and running in minutes with this streamlined setup guide.

## 🚀 Prerequisites

### System Requirements
- **Node.js**: 18.0+ (LTS recommended)
- **npm**: 8.0+ or **yarn**: 1.22+
- **Modern Browser**: Chrome 80+, Firefox 75+, Safari 13.1+, Edge 80+

### Development Tools (Optional)
- **VS Code**: Recommended editor with Vue extensions
- **Git**: For version control
- **Chrome DevTools**: For debugging and performance analysis

## ⚡ 5-Minute Setup

### 1. Clone Repository
```bash
git clone https://github.com/your-username/vue-music-player.git
cd vue-music-player
```

### 2. Install Dependencies
```bash
npm install
# or
yarn install
```

### 3. Start Development Server
```bash
npm run dev
# or
yarn dev
```

### 4. Open Application
Navigate to **http://localhost:5173** in your browser.

🎉 **You're ready to go!** The application will start with mock data enabled.

## 🔧 Basic Configuration

### Environment Setup
Create `.env.local` for local development:

```env
# API Configuration
VITE_API_BASE_URL=http://localhost:8080/api
VITE_MUSIC_BASE_URL=http://localhost:8080/music
VITE_LYRICS_BASE_URL=http://localhost:8080/lyrics

# Development Settings
VITE_ENABLE_MOCK_DATA=true
VITE_APP_TITLE="My Music Player"
```

### Mock Data vs Real Backend
The application comes with built-in mock data for development:

**Mock Data (Default)**
- Pre-loaded with sample songs and playlists
- No backend server required
- Perfect for UI development and testing

**Real Backend**
- Set `VITE_ENABLE_MOCK_DATA=false`
- Requires backend API server
- See [API Integration](./07-API-Integration.md) for setup

## 📱 Development Commands

### Core Commands
```bash
# Development server with hot reload
npm run dev

# Production build
npm run build

# Preview production build locally
npm run preview

# Type checking without building
npm run type-check
```

### Advanced Commands
```bash
# Build for subdirectory deployment
npm run build -- --mode staging

# Build with custom environment file
npm run build -- --mode production --env-file .env.custom

# Development server with specific port
npm run dev -- --port 3000

# Development server with network access
npm run dev -- --host
```

## 🎵 First Steps

### 1. Explore the Interface
- **Home**: Dashboard with recent songs and playlists
- **Library**: Browse all available songs
- **Search**: Find songs by title or content
- **Sidebar**: Quick access to playlists and favorites

### 2. Play Your First Song
1. Navigate to **Library** or **Home**
2. Click any song to start playback
3. Use player controls at the bottom of the screen
4. Try keyboard shortcuts: `Space` (play/pause), `Ctrl+→` (next)

### 3. Create a Playlist
1. Click **"Create Playlist"** in the sidebar
2. Enter a playlist name
3. Add songs by clicking the **"+"** button next to any song
4. Access your playlist from the sidebar

### 4. Enable PWA Features
1. Look for the install prompt (appears automatically)
2. Click **"Install"** to add to your device
3. Enjoy offline playback and background controls

## 🛠️ Development Workflow

### Recommended VS Code Extensions
```json
{
  "recommendations": [
    "Vue.volar",
    "Vue.vscode-typescript-vue-plugin",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint"
  ]
}
```

### Hot Reload Development
The development server supports hot module replacement (HMR):
- **Template changes**: Instant updates
- **Style changes**: Live CSS injection  
- **Script changes**: Component state preservation
- **TypeScript**: Real-time type checking

### Browser DevTools Setup
1. Install **Vue.js DevTools** browser extension
2. Open DevTools → Vue tab
3. Inspect component hierarchy and Pinia stores
4. Monitor network requests in Network tab

## 🎯 Common First Tasks

### Add Your Music Collection
1. **With Backend**: Place MP3 files in `/music/` directory
2. **File Naming**: Use `link.{id}.mp3` format (e.g., `link.1.mp3`)
3. **Lyrics**: Add `.l` files in `/lyrics/` directory
4. **Update Database**: Add song metadata to your backend

### Customize Appearance
1. **App Title**: Update `VITE_APP_TITLE` in environment
2. **Colors**: Modify Tailwind theme in `tailwind.config.js`
3. **Icons**: Replace icons in `public/icons/` directory
4. **Language**: Add locale files in `src/locales/`

### Connect to Existing PHP System
1. Set `VITE_ENABLE_MOCK_DATA=false`
2. Configure API endpoints to match your PHP backend
3. Ensure CORS is properly configured
4. Test with existing music files and playlists

## 🚨 Common Issues

### Port Already in Use
```bash
# Try different port
npm run dev -- --port 3001

# Or kill process using port 5173
lsof -ti:5173 | xargs kill -9
```

### Node Version Issues
```bash
# Check Node version
node --version

# Use Node Version Manager
nvm use 18
# or
nvm install --lts
```

### Build Failures
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Check for TypeScript errors
npm run type-check
```

### CORS Issues (Real Backend)
Ensure your backend allows requests from `http://localhost:5173`:
```php
// PHP CORS headers
header("Access-Control-Allow-Origin: http://localhost:5173");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
```

## 📚 Next Steps

Once you have the basic setup running:

1. **[Development Setup](./03-Development-Setup.md)** - Detailed development environment
2. **[System Architecture](./04-System-Architecture.md)** - Understanding the codebase
3. **[API Integration](./07-API-Integration.md)** - Connecting to your backend
4. **[Build & Deployment](./10-Build-Deployment.md)** - Production deployment

## 🆘 Getting Help

### Quick Debugging
```bash
# Check if TypeScript is happy
npm run type-check

# Verify build works
npm run build

# Test production preview
npm run preview
```

### Documentation Resources
- **[Common Issues](./19-Common-Issues.md)** - Troubleshooting guide
- **[FAQ](./20-FAQ.md)** - Frequently asked questions
- **[Development Workflow](./08-Development-Workflow.md)** - Best practices

### Community Support
- Check existing GitHub issues
- Review the project's README.md
- Consult the API documentation

---

**Related Documentation:**
- [Project Overview](./01-Project-Overview.md)
- [Development Setup](./03-Development-Setup.md)
- [API Integration](./07-API-Integration.md)