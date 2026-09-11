import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DigError, plainLyrics, validateSyncedLyrics } from './dig-provider.js'
import { initDigIngestion } from './dig-ingestion.js'

const exec = promisify(execFile)

// Always produce a real MP3, including when the source returns FLAC/M4A. No
// trimming or tempo changes: the provider's original LRC timeline is retained.
export async function convertAudio(input, output) {
  try {
    await exec(process.env.FFMPEG_BIN || 'ffmpeg', [
      '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', input,
      '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '-map_metadata', '-1', output,
    ], { timeout: 120000, maxBuffer: 1024 * 1024 })
  } catch {
    throw new DigError('INVALID_AUDIO', 'The song could not be converted to MP3. Please try another version.', 422)
  }
}

export function createDigLibrary({ db, root, legacyRoots, countPaths, convert = convertAudio }) {
  db.exec(`CREATE TABLE IF NOT EXISTS imported_songs (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
    title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL, duration REAL NOT NULL,
    added_by INTEGER NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(source, source_id)
  )`)
  if (!db.prepare('PRAGMA table_info(imported_songs)').all().some(column => column.name === 'lyrics_mode')) {
    db.exec("ALTER TABLE imported_songs ADD COLUMN lyrics_mode TEXT NOT NULL DEFAULT 'synced'")
  }
  initDigIngestion(db)
  const asSong = (row) => row && ({
    id: row.id, title: row.title, artist: row.artist, album: row.album,
    duration: row.duration, filename: `link.${row.id}.mp3`, isFavorite: false,
    lyricsMode: row.lyrics_mode,
  })
  const find = (song) => asSong(db.prepare('SELECT * FROM imported_songs WHERE source = ? AND source_id = ?').get(song.source, song.id))
  const list = () => db.prepare('SELECT * FROM imported_songs ORDER BY id DESC').all().map(asSong)

  function maxSongId() {
    let max = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM imported_songs').get().id
    let foundLegacy = false
    for (const file of countPaths) {
      try {
        const count = fs.readFileSync(file, 'utf8').trim()
        if (/^\d+$/.test(count)) { max = Math.max(max, Number(count)); foundLegacy = true }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    // Count files can lag behind files. Also skip leftovers from a process crash;
    // never overwrite an existing audio file or either of its lyric companions.
    for (const dir of [...new Set([...legacyRoots, root])]) {
      for (const folder of [dir, path.join(dir, 'lyrics'), path.join(dir, 'synced')]) {
        try {
          for (const name of fs.readdirSync(folder)) {
            const match = name.match(/^link\.(\d+)\.(?:mp3(?:\.l)?|lrc)$/)
            if (match) { max = Math.max(max, Number(match[1])); foundLegacy = true }
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    }
    if (!foundLegacy && max === 0) throw new DigError('LIBRARY_UNAVAILABLE', 'The existing song count could not be read.', 503)
    if (!Number.isSafeInteger(max) || max >= 99999) throw new DigError('LIBRARY_UNAVAILABLE', 'The song ID range is exhausted.', 503)
    return max
  }

  async function add(song, userId, provider, { manualLyrics } = {}) {
    const existing = find(song)
    if (existing) return { song: existing, alreadyAdded: true }
    // Download and validate everything before allocating an ID or publishing files.
    const manual = manualLyrics !== undefined
    if (manual && (typeof manualLyrics !== 'string' || manualLyrics.length > 20000 || manualLyrics.includes('\0'))) {
      throw new DigError('INVALID_MANUAL_LYRICS', 'Lyrics must be plain text, up to 20,000 characters.', 400)
    }
    const title = song.title.replace(/[\r\n]+/g, ' ').trim()
    let manualText = manual ? manualLyrics.replace(/\r\n?/g, '\n').trim() : ''
    // Keep the title exactly once at the beginning, including when pasted in.
    if (manualText.split('\n')[0].trim() === title) manualText = manualText.split('\n').slice(1).join('\n').trim()
    const lrc = manual ? null : validateSyncedLyrics(await provider.lyrics(song))
    fs.mkdirSync(root, { recursive: true })
    const staging = fs.mkdtempSync(path.join(root, '.pending-'))
    try {
      const input = path.join(staging, 'source')
      const audio = path.join(staging, 'audio.mp3')
      await provider.download(song, input)
      await convert(input, audio)
      if (fs.statSync(audio).size < 2048) throw new DigError('INVALID_AUDIO', 'The downloaded audio is empty.', 422)
      const lyrics = manual
        ? `${title}${manualText ? `\n\n${manualText}` : ''}\n`
        : plainLyrics(song.title, lrc)
      fs.writeFileSync(path.join(staging, 'plain'), lyrics)
      if (lrc !== null) fs.writeFileSync(path.join(staging, 'synced'), lrc)
      fs.mkdirSync(path.join(root, 'lyrics'), { recursive: true })
      fs.mkdirSync(path.join(root, 'synced'), { recursive: true })

      // SQLite serializes writers across backend processes. No await inside the
      // transaction: audio + both lyrics are published before the library entry.
      db.exec('BEGIN IMMEDIATE')
      const published = []
      const countFile = path.join(root, 'song_number.txt')
      let oldCount = null
      let countChanged = false
      try {
        oldCount = fs.existsSync(countFile) ? fs.readFileSync(countFile) : null
        const duplicate = find(song)
        if (duplicate) { db.exec('ROLLBACK'); return { song: duplicate, alreadyAdded: true } }
        const id = maxSongId() + 1
        for (const [from, to] of [
          [audio, path.join(root, `link.${id}.mp3`)],
          [path.join(staging, 'plain'), path.join(root, 'lyrics', `link.${id}.mp3.l`)],
          ...(lrc !== null ? [[path.join(staging, 'synced'), path.join(root, 'synced', `link.${id}.lrc`)]] : []),
        ]) {
          fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
          published.push(to)
        }
        db.prepare(`INSERT INTO imported_songs
          (id, source, source_id, title, artist, album, duration, added_by, created_at, lyrics_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, song.source, song.id, song.title, song.artist, song.album, song.duration, userId, new Date().toISOString(), manual ? 'manual' : 'synced')
        db.prepare('INSERT INTO dig_ingestion (song_id, updated_at) VALUES (?, ?)').run(id, Date.now())
        // Keep the same song_number.txt convention in the writable music store.
        fs.writeFileSync(path.join(staging, 'count'), `${id}\n`)
        fs.renameSync(path.join(staging, 'count'), countFile)
        countChanged = true
        const imported = { ...find(song), lyrics }
        db.exec('COMMIT')
        return { song: imported, alreadyAdded: false, titleOnlyLyrics: manual && !manualText }
      } catch (error) {
        db.exec('ROLLBACK')
        for (const file of published) fs.unlinkSync(file)
        if (countChanged) {
          if (oldCount === null) fs.unlinkSync(countFile)
          else fs.writeFileSync(countFile, oldCount)
        }
        throw error
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
  }

  function asset(relative) {
    const match = relative.match(/^(?:lyrics\/link\.(\d+)\.mp3\.l|synced\/link\.(\d+)\.lrc|link\.(\d+)\.mp3|poster\/link\.(\d+)\.jpg)$/)
    if (!match) return null
    const id = Number(match[1] || match[2] || match[3] || match[4])
    if (!db.prepare('SELECT 1 FROM imported_songs WHERE id = ?').get(id)) return null
    return path.resolve(root, relative)
  }

  const ingestion = (id) => {
    const row = db.prepare('SELECT song_id, status, attempts, next_attempt_at FROM dig_ingestion WHERE song_id = ?').get(id)
    return row ? { songId: row.song_id, status: row.status, attempts: row.attempts,
      nextAttemptAt: row.status === 'retry' ? new Date(row.next_attempt_at).toISOString() : null } : null
  }
  return { list, find, add, asset, maxSongId, ingestion }
}
