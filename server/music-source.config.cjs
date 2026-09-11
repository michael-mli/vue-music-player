const path = require('node:path')
const os = require('node:os')

const sourceDir = path.join(os.homedir(), '.local/share/mics-music-source')

module.exports = {
  apps: [{
    name: 'music-source',
    script: path.join(sourceDir, 'music-dl'),
    cwd: sourceDir,
    interpreter: 'none',
    // Upstream's desktop mode binds 127.0.0.1 and suppresses browser launching.
    // Its configuration UI is private to the server; public access stays in our API.
    args: ['web', '--port', '3130', '--desktop', '--no-browser'],
    autorestart: true,
    restart_delay: 3000,
    max_memory_restart: '400M',
    time: true,
  }],
}
