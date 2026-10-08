import { createHash } from 'node:crypto'
import { stat, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fail } from './ktv-errors.js'

const run = promisify(execFile)
const MAX_AUDIO_BYTES = 32 * 1024 * 1024
const MAX_DURATION_MS = 10 * 60 * 1000

// Resolve only numeric catalog IDs against operator-owned roots. Descriptor
// versions are content hashes; no caller-supplied path or URL is accepted.
export function createKtvAssets({ musicRoot, karaokeRoot, importRoot, syncedRoot, lyricsRoot, ffprobe = 'ffprobe' }) {
  const cache = new Map()
  async function file(root, name, url, required = false, limit = MAX_AUDIO_BYTES) {
    try {
      const filename = path.join(root, name)
      const info = await stat(filename)
      if (!info.isFile() || info.size > limit || !info.size) fail(409, 'ASSET_UNAVAILABLE', 'Song asset exceeds the supported size')
      return { filename, url, bytes: info.size, signature: `${info.size}:${info.mtimeMs}:${info.ctimeMs}` }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (required) fail(409, 'ASSET_UNAVAILABLE', 'Instrumental audio is unavailable')
      return null
    }
  }
  async function audio(info) {
    const [bytes, result] = await Promise.all([
      readFile(info.filename),
      run(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration,sample_rate,channels',
        '-show_entries', 'format=duration', '-of', 'json', info.filename], { timeout: 10_000, maxBuffer: 64 * 1024 }),
    ])
    const probe = JSON.parse(result.stdout)
    const stream = probe.streams?.[0]
    const durationMs = Math.round(Number(stream?.duration || probe.format?.duration) * 1000)
    if (!stream || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS ||
      Number(stream.channels) > 2) fail(409, 'ASSET_UNAVAILABLE', 'Song audio format or duration is unsupported')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    // Versioned query bypasses the existing solo-player CacheFirst /\.mp3$/
    // route. A replaced asset cannot remain trapped in an old PWA audio cache.
    return { url: `${info.url}?ktvAsset=${sha256}`, bytes: bytes.length, sha256,
      durationMs, sampleRate: Number(stream.sample_rate), channels: Number(stream.channels), alignmentOffsetMs: 0 }
  }
  return async function resolve(songId) {
    if (!Number.isSafeInteger(songId) || songId < 1) fail(400, 'INVALID_SONG', 'Choose a valid song')
    const imported = await file(importRoot, `link.${songId}.mp3`, `/api/dig/files/link.${songId}.mp3`)
    const original = imported || await file(musicRoot, `link.${songId}.mp3`, `/data/link.${songId}.mp3`)
    const instrumental = await file(karaokeRoot, `link.${songId}.instrumental.mp3`, `/karaoke/link.${songId}.instrumental.mp3`, true)
    const lyric = (imported && await file(path.join(importRoot, 'synced'), `link.${songId}.lrc`, null, false, 128 * 1024)) ||
      await file(syncedRoot, `link.${songId}.lrc`, null, false, 128 * 1024)
    const manual = !lyric && ((imported && await file(path.join(importRoot, 'lyrics'), `link.${songId}.mp3.l`, null, false, 128 * 1024)) ||
      await file(lyricsRoot, `link.${songId}.mp3.l`, null, false, 128 * 1024))
    const signature = [instrumental, original, lyric, manual].map(info => info ? `${info.filename}:${info.signature}` : '').join('|')
    if (cache.get(songId)?.signature === signature) return cache.get(songId).promise
    const promise = (async () => {
      try {
        const [backing, vocal, text] = await Promise.all([
          audio(instrumental), original ? audio(original) : null,
          lyric || manual ? readFile((lyric || manual).filename, 'utf8') : null,
        ])
        const lyrics = { mode: lyric ? 'synced' : manual ? 'plain' : 'missing', text,
          sha256: text === null ? null : createHash('sha256').update(text).digest('hex') }
        const descriptor = { songId, durationMs: backing.durationMs, instrumental: backing, original: vocal, lyrics,
          alignmentVerified: false, durationDifferenceMs: vocal ? vocal.durationMs - backing.durationMs : null }
        return { ...descriptor, version: createHash('sha256').update(JSON.stringify(descriptor)).digest('hex') }
      } catch (error) {
        cache.delete(songId)
        if (error.status) throw error
        fail(409, 'ASSET_UNAVAILABLE', 'Song assets could not be prepared')
      }
    })()
    cache.set(songId, { signature, promise })
    if (cache.size > 50) cache.delete(cache.keys().next().value)
    return promise
  }
}
