# Frequently Asked Questions (FAQ)

Comprehensive answers to frequently asked questions about the Vue Music Player project.

## 🚀 General Questions

### Q: What is the Vue Music Player?
**A**: The Vue Music Player is a modern, progressive web application built with Vue.js 3 that provides a Spotify-like music listening experience. It's designed to replace legacy PHP-based music systems while maintaining full compatibility with existing file structures and playlists.

### Q: What are the main features?
**A**: Key features include:
- **Modern Audio Player**: Full-featured with queue management, shuffle, repeat
- **Progressive Web App**: Installable with offline capabilities  
- **Smart Search**: Real-time search with filtering
- **Playlist Management**: Create, edit, and organize custom playlists
- **Lyrics Display**: Collapsible lyrics panel with search
- **Multi-language Support**: English and Chinese localization
- **Network Resilience**: Auto-retry and connectivity handling
- **Performance Optimized**: Fast loading with efficient caching

### Q: Is it free to use?
**A**: Yes, the Vue Music Player is open source and free to use. You can deploy it on your own servers or use cloud services like Cloudflare.

### Q: Can I use it with my existing music collection?
**A**: Absolutely! The player is designed to work with existing music collections and maintains compatibility with legacy file naming conventions (`link.{id}.mp3`).

## 🔧 Technical Questions

### Q: What technologies does it use?
**A**: The tech stack includes:
- **Frontend**: Vue.js 3, TypeScript, Pinia, Vue Router, Tailwind CSS
- **Build**: Vite, PWA plugin
- **Backend Options**: PHP (legacy), Cloudflare Workers, Node.js
- **Storage**: Cloudflare R2, local files, or any HTTP-accessible storage

### Q: What are the system requirements?
**A**: 
- **Development**: Node.js 18+, npm 8+, modern browser
- **Production**: Any web server capable of serving static files
- **Browser Support**: Chrome 80+, Firefox 75+, Safari 13.1+, Edge 80+

### Q: How do I migrate from an existing PHP music player?
**A**: The migration process involves:
1. Keep your existing music files and directory structure
2. Update API endpoints to match the new backend
3. Migrate playlist files to the new format
4. Configure environment variables
5. Deploy the Vue frontend

See the [Data Migration Guide](./18-Data-Migration.md) for detailed steps.

### Q: Can I deploy it in a subdirectory?
**A**: Yes! The player supports subdirectory deployment. Set the `base` property in `vite.config.ts` and use the staging build mode:
```bash
npm run build -- --mode staging
```

## 🎵 Music & Audio Questions

### Q: What audio formats are supported?
**A**: The player supports all formats that the HTML5 Audio API supports in your browser:
- **MP3**: Primary format (universally supported)
- **OGG**: Good browser support
- **WAV**: Uncompressed, larger files
- **M4A**: Good quality, modern browsers

### Q: How does the file naming convention work?
**A**: The system uses a simple naming pattern:
- **Music files**: `link.{id}.mp3` (e.g., `link.1.mp3`, `link.123.mp3`)
- **Lyrics files**: `link.{id}.mp3.l` (e.g., `link.1.mp3.l`)
- **ID range**: 1-9999 (configurable)

### Q: Can I use custom file naming?
**A**: While the default system uses `link.{id}.mp3`, you can modify the `getMusicUrl()` function in `src/config/index.ts` to support custom naming patterns.

### Q: How are playlists stored?
**A**: Playlists can be stored in multiple ways:
- **Local Storage**: For client-side only playlists
- **Database**: Using your backend API (recommended)
- **File-based**: Legacy `.pl` files for compatibility

### Q: Does it support lyrics?
**A**: Yes! The player has a built-in lyrics panel that:
- Displays lyrics from `.l` files
- Supports search within lyrics
- Can be collapsed/expanded
- Auto-scrolls during playback (if configured)

## 📱 Mobile & PWA Questions

### Q: Can I install it as an app on my phone?
**A**: Yes! The Vue Music Player is a Progressive Web App (PWA) that can be installed on mobile devices:
- **Android**: Chrome will show an "Add to Home Screen" prompt
- **iOS**: Use Safari's "Add to Home Screen" feature
- **Desktop**: Chrome and Edge support desktop PWA installation

### Q: Does it work offline?
**A**: Partially. The PWA caches:
- **Application files**: HTML, CSS, JavaScript
- **Recently played songs**: Cached automatically
- **API responses**: Short-term caching
- **Playlists**: Local storage backup

Note: New songs require internet connection to download initially.

### Q: Why doesn't audio play automatically on mobile?
**A**: Mobile browsers have strict autoplay policies. The player handles this by:
- Showing play buttons instead of auto-starting
- Displaying notifications when user interaction is required
- Resuming playback after user gestures

### Q: What about battery usage?
**A**: The player is optimized for mobile battery life:
- Efficient CSS animations using transforms
- Background processing only when needed
- Audio element optimization
- Sleep timer functionality to auto-pause

## 🌐 Network & Performance Questions

### Q: How does it handle poor network connections?
**A**: The player includes comprehensive network handling:
- **Automatic retry**: Failed requests are retried with exponential backoff
- **Connection monitoring**: Detects online/offline states
- **Smart caching**: Aggressive caching for music files
- **Graceful degradation**: Continues functioning with limited connectivity
- **Mobile switching**: Handles WiFi to mobile data transitions

### Q: How much data does it use?
**A**: Data usage depends on:
- **Audio quality**: ~3-5MB per song for standard MP3
- **Cache efficiency**: Previously played songs use no additional data
- **API calls**: Minimal overhead (~1-2KB per request)
- **Lyrics**: Negligible (typically <1KB per song)

### Q: Can I control data usage?
**A**: Yes, through several methods:
- **Data Saver Mode**: Respects browser `Save-Data` header
- **Cache settings**: Configurable cache sizes
- **Quality selection**: Support for multiple bitrates
- **Preload settings**: Control how much is buffered

### Q: How fast does it load?
**A**: Performance targets:
- **Initial load**: <3 seconds on 3G, <1 second on WiFi
- **Song switching**: <500ms for cached songs
- **Search results**: <200ms response time
- **PWA install**: <2 seconds after initial cache

## 🛠️ Development Questions

### Q: How do I set up the development environment?
**A**: Quick setup:
```bash
git clone <repository>
cd vue-music-player
npm install
npm run dev
```

See the [Quick Start Guide](./02-Quick-Start.md) for detailed instructions.

### Q: Can I customize the appearance?
**A**: Absolutely! The player uses Tailwind CSS for styling:
- **Colors**: Modify `tailwind.config.js` theme
- **Components**: Edit Vue components in `src/components/`
- **Layout**: Adjust responsive breakpoints
- **Animations**: Customize transitions and effects

### Q: How do I add new features?
**A**: The codebase is well-structured for extensions:
1. **State management**: Use Pinia stores
2. **API integration**: Extend `src/services/`
3. **UI components**: Add to `src/components/`
4. **Routing**: Update `src/router/`

### Q: Can I contribute to the project?
**A**: Yes! Contributions are welcome:
- Report bugs and issues
- Suggest new features
- Submit pull requests
- Improve documentation
- Share usage examples

See [Contributing Guide](./21-Contributing.md) for details.

## 🔐 Security & Privacy Questions

### Q: Is my music data private?
**A**: Privacy depends on your deployment:
- **Self-hosted**: You control all data
- **Cloud deployment**: Subject to provider policies
- **Local storage**: Data stays on your device
- **No tracking**: The app doesn't track user behavior by default

### Q: How is user authentication handled?
**A**: Authentication is flexible:
- **No auth**: Public music player (default)
- **JWT tokens**: For API-based user management
- **Session-based**: For traditional server setups
- **OAuth**: Can integrate with external providers

### Q: Are there any security considerations?
**A**: Standard web security practices apply:
- **HTTPS required**: For PWA and production use
- **CORS configuration**: Properly configure API endpoints
- **Input validation**: All user inputs are validated
- **Rate limiting**: API endpoints include rate limiting

## 💾 Data & Storage Questions

### Q: Where is my data stored?
**A**: Data storage is distributed:
- **Songs metadata**: Backend database or API
- **Playlists**: Backend database or local storage
- **User preferences**: Local storage
- **Cache**: Browser cache and IndexedDB
- **Music files**: Your server or CDN

### Q: What happens if I clear my browser data?
**A**: Effects of clearing browser data:
- **Lost**: Local playlists, preferences, cache
- **Retained**: Server-stored playlists and favorites
- **Recoverable**: Login again to restore server data

### Q: Can I export my playlists?
**A**: Yes, playlists can be exported:
- **JSON format**: For backup and migration
- **M3U format**: For compatibility with other players
- **CSV format**: For spreadsheet import

### Q: How much storage space does it use?
**A**: Storage usage breakdown:
- **Application cache**: ~5-10MB (static files)
- **Music cache**: ~50-100MB (configurable)
- **Local data**: <1MB (playlists, preferences)
- **Total**: Usually 50-110MB depending on usage

## 🌍 Deployment Questions

### Q: What hosting options are available?
**A**: Multiple deployment options:
- **Static hosting**: Netlify, Vercel, GitHub Pages
- **Traditional servers**: Apache, Nginx
- **Cloud platforms**: Cloudflare Pages, AWS S3
- **CDN deployment**: Global content delivery

### Q: Can I use Cloudflare for backend?
**A**: Yes! Cloudflare provides excellent backend options:
- **Workers**: Serverless API endpoints
- **D1**: SQL database
- **R2**: Object storage for music files
- **KV**: Fast caching layer

See the [Cloudflare Backend Guide](./16-Cloudflare-Backend.md) for implementation details.

### Q: How do I set up HTTPS?
**A**: HTTPS setup options:
- **Let's Encrypt**: Free SSL certificates
- **Cloudflare**: Free SSL/TLS encryption
- **Hosting provider**: Many include SSL certificates
- **Self-signed**: For development only

### Q: Can it scale to many users?
**A**: Yes, the architecture is designed to scale:
- **Static frontend**: Highly cacheable and fast
- **CDN distribution**: Global content delivery
- **API scaling**: Serverless or traditional scaling
- **Database optimization**: Efficient queries and indexing

## 🎛️ Configuration Questions

### Q: How do I configure the app for my setup?
**A**: Configuration uses environment variables:
```env
VITE_API_BASE_URL=https://api.yourdomain.com/api
VITE_MUSIC_BASE_URL=https://music.yourdomain.com
VITE_LYRICS_BASE_URL=https://music.yourdomain.com/lyrics
VITE_ENABLE_MOCK_DATA=false
```

### Q: Can I use mock data for testing?
**A**: Yes! Set `VITE_ENABLE_MOCK_DATA=true` to use built-in mock data for development and testing.

### Q: How do I configure different environments?
**A**: Use multiple environment files:
- `.env.development` - Development settings
- `.env.staging` - Staging environment
- `.env.production` - Production configuration
- `.env.local` - Local overrides (git-ignored)

### Q: What build modes are available?
**A**: Multiple build configurations:
- `npm run dev` - Development with hot reload
- `npm run build` - Production build
- `npm run build -- --mode staging` - Staging build
- `npm run preview` - Preview production build

## 🐛 Troubleshooting Questions

### Q: The music player won't start, what should I check?
**A**: Common issues and solutions:
1. **Check Node.js version**: Should be 18+
2. **Verify dependencies**: Run `npm install`
3. **Check ports**: Default is 5173, may conflict
4. **Browser compatibility**: Use modern browser
5. **Console errors**: Check browser developer tools

### Q: Songs aren't loading, what's wrong?
**A**: Troubleshooting steps:
1. **Check file URLs**: Verify `VITE_MUSIC_BASE_URL`
2. **Test direct access**: Try opening music URL directly
3. **CORS issues**: Ensure proper CORS headers
4. **File permissions**: Check server file permissions
5. **Network issues**: Test API connectivity

### Q: PWA installation isn't working?
**A**: PWA requirements:
1. **HTTPS**: Required for production PWA
2. **Valid manifest**: Check `/manifest.json`
3. **Service worker**: Must register successfully
4. **Icons**: Proper icon sizes and formats

### Q: Audio doesn't play on mobile?
**A**: Mobile-specific issues:
1. **Autoplay policy**: Requires user interaction
2. **Silent mode**: iOS may be in silent mode
3. **Audio format**: Check browser support
4. **Network**: Poor connection may cause issues

### Q: Performance is slow, how can I optimize?
**A**: Performance optimization:
1. **Enable caching**: Configure service worker
2. **Reduce bundle size**: Check for large dependencies
3. **Optimize images**: Use proper formats and sizes
4. **CDN usage**: Serve static assets from CDN
5. **Database indexing**: Optimize API queries

For more detailed troubleshooting, see [Common Issues](./19-Common-Issues.md).

## 📚 Learning Resources

### Q: Where can I learn more about the technologies used?
**A**: Recommended learning resources:
- **Vue.js**: [Vue.js Official Guide](https://vuejs.org/guide/)
- **TypeScript**: [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- **Pinia**: [Pinia Documentation](https://pinia.vuejs.org/)
- **Vite**: [Vite Guide](https://vitejs.dev/guide/)
- **PWA**: [MDN PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)

### Q: How can I get help with specific issues?
**A**: Support options:
1. **Documentation**: Start with project documentation
2. **Common Issues**: Check troubleshooting guide
3. **GitHub Issues**: Search existing issues or create new ones
4. **Community**: Join discussions and forums
5. **Contributing**: Help improve the project

### Q: Are there video tutorials available?
**A**: While there aren't official video tutorials yet, you can:
- Follow the written documentation step-by-step
- Check YouTube for Vue.js and PWA tutorials
- Look for community-created content
- Consider contributing tutorials yourself!

---

**Need more help?** Check out these related documentation pages:
- [Common Issues](./19-Common-Issues.md) - Detailed troubleshooting
- [Quick Start Guide](./02-Quick-Start.md) - Getting started
- [Development Setup](./03-Development-Setup.md) - Detailed setup
- [API Specifications](./17-API-Specifications.md) - API documentation