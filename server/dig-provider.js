// Adapter for go-music-dl's public /music routes. Search returns HTML song-card
// attributes; download_lrc and download return the assets for that exact source/id.
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'

// Decode a bounded sample, rather than trusting an audio MIME type or ID3 tag.
// No files are stored and no song ID is allocated during this check.
export function validateAudioSample(sample, signal) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.env.FFMPEG_BIN || 'ffmpeg', [
      '-nostdin', '-v', 'error', '-protocol_whitelist', 'pipe', '-i', 'pipe:0',
      '-map', '0:a:0', '-t', '1', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1',
    ], { encoding: 'buffer', timeout: 5000, maxBuffer: 128 * 1024, signal }, (error, output) => {
      if (error?.code === 'ENOENT' || error?.killed || signal?.aborted) {
        reject(new DigError('SOURCE_UNAVAILABLE', 'Audio verification could not finish.', 503))
      } else if (error || output.length < 1600) {
        // A bounded prefix can omit container metadata or enough audio frames.
        // Failure to decode that prefix does not prove the full song is broken.
        reject(new DigError('SAMPLE_UNVERIFIED', 'Playback could not be confirmed from this sample.', 422))
      } else resolve()
    })
    child.stdin.on('error', () => {}) // Decoder can reject a sample before stdin finishes.
    child.stdin.end(sample)
  })
}

export class DigError extends Error {
  constructor(code, message, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

function decodeHtml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (raw, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[entity.toLowerCase()] || raw
  })
}

export function parseSearchHtml(html) {
  if (/Security Verification|TencentEOCaptcha|EO_Bot_Ssid|__tst_status/i.test(html)) {
    throw new DigError('SOURCE_VERIFICATION', 'The music source requires security verification. Please try again later.', 503)
  }
  const songs = []
  for (const match of html.matchAll(/<li\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)]
      .map((attr) => [attr[1], decodeHtml(attr[3] ?? attr[4])]))
    if (!attrs.class?.split(/\s+/).includes('song-card')) continue
    if (!attrs['data-id'] || !attrs['data-source'] || !attrs['data-name']) continue
    // Local-file entries belong to the upstream server, not the public catalogue.
    if (['local', 'local-file'].includes(attrs['data-source'])) continue
    let extra = null
    try { extra = JSON.parse(attrs['data-extra'] || 'null') } catch { /* optional */ }
    songs.push({
      id: attrs['data-id'], source: attrs['data-source'], title: attrs['data-name'],
      artist: attrs['data-artist'] || '', album: attrs['data-album'] || '',
      duration: Math.max(0, Number(attrs['data-duration']) || 0), extra,
    })
  }
  if (!songs.length && !/未找到符合条件的资源/.test(html)) {
    throw new DigError('SOURCE_RESPONSE', 'The music source returned an unexpected search page.')
  }
  return {
    songs,
    page: Number(html.match(/data-current-page=["'](\d+)/)?.[1] || 1),
    totalPages: Number(html.match(/data-total-pages=["'](\d+)/)?.[1] || 1),
  }
}

export function validateSyncedLyrics(text) {
  if (/Security Verification|TencentEOCaptcha|EO_Bot_Ssid|__tst_status/i.test(text)) {
    throw new DigError('SOURCE_VERIFICATION', 'The music source requires security verification.', 503)
  }
  if (!/^\s*(?:\[\d{1,2}:[0-5]\d(?:[.:]\d{1,3})?\])+\s*\S/m.test(text)
    || /<html\b|<!doctype/i.test(text)) {
    throw new DigError('NO_SYNCED_LYRICS', 'This result has no synchronized lyrics. Choose another version.', 422)
  }
  return text.replace(/^\uFEFF/, '')
}

export function plainLyrics(title, lrc) {
  const lines = lrc.split(/\r?\n/).filter((line) => /\[\d{1,2}:\d{2}/.test(line))
    .map((line) => line.replace(/\[[^\]]*\]/g, '').replace(/<\d{1,2}:\d{2}(?:\.\d+)?>/g, '').trim())
  return `${title.replace(/[\r\n]+/g, ' ')}\n\n${lines.join('\n')}\n`
}

export function createDigProvider({ baseUrl = 'https://music.zkkp.nyc.mn/music', fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl.replace(/\/+$/, '') + '/')
  async function open(endpoint, params, limit, timeout, options = {}) {
    let url = new URL(endpoint, base)
    url.search = new URLSearchParams(params).toString()
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout)
    for (let redirects = 0; redirects <= 3; redirects++) {
      let response
      try {
        response = await fetchImpl(url, {
          redirect: 'manual', signal,
          headers: { Accept: '*/*', ...(options.range ? { Range: options.range } : {}) },
        })
      } catch {
        throw new DigError('SOURCE_UNAVAILABLE', 'Could not reach the music source. Please try again.', 503)
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        url = new URL(response.headers.get('location') || '', url)
        if (url.origin !== base.origin) throw new DigError('SOURCE_RESPONSE', 'Unexpected music source redirect.')
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        if (endpoint === 'download_lrc' && response.status === 404) {
          throw new DigError('NO_SYNCED_LYRICS', 'This result has no synchronized lyrics. Choose another version.', 422)
        }
        throw new DigError('SOURCE_UNAVAILABLE', `The music source returned HTTP ${response.status}.`, 503)
      }
      if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel()
        throw new DigError('ASSET_TOO_LARGE', 'The music source returned a file that is too large.', 422)
      }
      return response
    }
    throw new DigError('SOURCE_RESPONSE', 'Too many music source redirects.')
  }
  async function request(endpoint, params, limit, timeout, signal) {
    const response = await open(endpoint, params, limit, timeout, signal ? { signal } : undefined)
    const chunks = []
    let size = 0
    try {
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > limit) throw new DigError('ASSET_TOO_LARGE', 'The music source returned a file that is too large.', 422)
        chunks.push(chunk)
      }
    } catch (error) {
      if (error instanceof DigError) throw error
      throw new DigError('SOURCE_UNAVAILABLE', 'The music source download was interrupted. Please retry.', 503)
    }
    return Buffer.concat(chunks)
  }
  function songParams(song) {
    return {
      id: song.id, source: song.source, name: song.title, artist: song.artist,
      album: song.album, duration: String(song.duration), extra: JSON.stringify(song.extra),
    }
  }
  // Only explicit audio errors or excessive size disqualify a result by
  // default. Missing lyrics, partial-sample failures and timeouts are uncertain.
  const DEFINITIVE_VERIFY_CODES = new Set(['INVALID_AUDIO', 'ASSET_TOO_LARGE'])
  // Open the audio stream and inspect headers + the first chunk, shared by
  // preview playback and prescan verification.
  async function openAudio(song, { timeout = 90000, signal, range } = {}) {
    const limit = 100 * 1024 * 1024
    const response = await open('download', { ...songParams(song), stream: '1' }, limit, timeout,
      { ...(signal ? { signal } : {}), ...(range ? { range } : {}) })
    const type = response.headers.get('content-type') || 'application/octet-stream'
    if (/json|text\/|html/i.test(type) || !response.body) {
      await response.body?.cancel()
      throw new DigError('INVALID_AUDIO', 'This version is unavailable for playback.', 422)
    }
    // Inspect the beginning before sending headers: some providers return an
    // error document with status 200 and a misleading audio content type.
    const reader = response.body.getReader()
    const first = await reader.read()
    const prefix = Buffer.from(first.value || []).subarray(0, 3000).toString('utf8')
    const startsAtBeginning = !range || /^bytes=0-/.test(range)
    if (first.done || (startsAtBeginning && /<html\b|<!doctype|^\s*[{[]|EO_Bot_Ssid|__tst_status/i.test(prefix))) {
      await reader.cancel()
      throw new DigError('INVALID_AUDIO', 'This version is unavailable for playback.', 422)
    }
    return { response, reader, first }
  }
  // Read at most 256 KB, including across split network chunks, then actually
  // decode audio. A 200 response or an ID3 header alone is not a successful probe.
  async function verifyAudio(song, { timeout = 15000, signal } = {}) {
    const limit = 256 * 1024
    const { reader, first } = await openAudio(song, { timeout, signal, range: `bytes=0-${limit - 1}` })
    const chunks = []
    let size = 0
    let chunk = first
    try {
      while (!chunk.done && size < limit) {
        const bytes = Buffer.from(chunk.value).subarray(0, limit - size)
        chunks.push(bytes)
        size += bytes.length
        if (size < limit) chunk = await reader.read()
      }
    } finally { await reader.cancel() }
    await validateAudioSample(Buffer.concat(chunks), signal)
  }
  // Missing lyrics prevents import, but does not prove audio is unplayable.
  // Keep checking audio so such versions can still be offered for listening.
  async function readLyrics(song, options = {}) {
    const body = await request('download_lrc', { ...songParams(song), format: 'auto' }, 1024 * 1024, options.timeout ?? 45000, options.signal)
    return validateSyncedLyrics(body.toString('utf8'))
  }
  async function verify(song, { lyricsTimeout = 12000, audioTimeout = 15000, signal } = {}) {
    let lyricsOk = false
    try {
      await readLyrics(song, { timeout: lyricsTimeout, signal })
      lyricsOk = true
    } catch (error) {
      if (DEFINITIVE_VERIFY_CODES.has(error?.code)) return { verdict: 'bad', reason: error.code }
    }
    try {
      await verifyAudio(song, { timeout: audioTimeout, signal })
    } catch (error) {
      if (DEFINITIVE_VERIFY_CODES.has(error?.code)) return { verdict: 'bad', reason: error.code }
      return { verdict: 'unknown' }
    }
    return { verdict: lyricsOk ? 'ok' : 'unknown' }
  }
  return {
    async preview(song, options = {}) {
      const { response, reader, first } = await openAudio(song, { timeout: 90000, signal: options.signal, range: options.range })
      const limit = 100 * 1024 * 1024
      let size = first.value.length
      const body = new ReadableStream({
        start(controller) { controller.enqueue(first.value) },
        async pull(controller) {
          try {
            const chunk = await reader.read()
            if (chunk.done) { controller.close(); return }
            size += chunk.value.length
            if (size > limit) {
              await reader.cancel()
              throw new DigError('ASSET_TOO_LARGE', 'The music source returned a file that is too large.', 422)
            }
            controller.enqueue(chunk.value)
          } catch (error) { controller.error(error) }
        },
        cancel(reason) { return reader.cancel(reason) },
      })
      return new Response(body, { status: response.status, headers: response.headers })
    },
    async search(query, page) {
      const body = await request('search', { q: query, type: 'song', page: String(page), page_size: '20' }, 5 * 1024 * 1024, 45000)
      return parseSearchHtml(body.toString('utf8'))
    },
    async lyrics(song, options = {}) {
      return readLyrics(song, options)
    },
    verify,
    async download(song, target) {
      const body = await request('download', { ...songParams(song), stream: '1' }, 100 * 1024 * 1024, 90000)
      const prefix = body.subarray(0, 3000).toString('utf8')
      if (/Security Verification|TencentEOCaptcha|EO_Bot_Ssid|__tst_status/i.test(prefix)) {
        throw new DigError('SOURCE_VERIFICATION', 'The music source requires security verification.', 503)
      }
      if (body.length < 2048 || /<html\b|<!doctype|^\s*[{[]/i.test(prefix)) {
        throw new DigError('INVALID_AUDIO', 'This result did not return playable audio. Choose another version.', 422)
      }
      await fs.writeFile(target, body, { flag: 'wx' })
    },
  }
}
