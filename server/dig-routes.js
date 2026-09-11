import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DigError } from './dig-provider.js'

export function registerDigRoutes(app, { authMiddleware, db, library, provider, onImported }) {
  const results = new Map()
  const jobs = new Map()
  const searchHits = new Map()
  const previews = new Map()
  const activePreviews = new Map()
  const verifyCache = new Map()
  const failTrack = new Map()
  const TTL = 30 * 60 * 1000
  const VERIFY_CACHE_TTL = 10 * 60 * 1000
  const FAIL_TTL = 5 * 60 * 1000
  // A single transient failure makes a result uncertain; repeated failures
  // temporarily hide it unless the listener asks to see unavailable versions.
  const FAIL_THRESHOLD = 2
  const PRESCAN_CONCURRENCY = 6
  const PRESCAN_BUDGET_MS = 40000
  function prune() {
    for (const [key, entry] of results) if (entry.expires < Date.now()) results.delete(key)
    for (const [key, job] of jobs) if (job.status !== 'running' && job.expires < Date.now()) jobs.delete(key)
    for (const [key, hit] of searchHits) if (hit.expires < Date.now()) searchHits.delete(key)
    for (const [key, preview] of previews) if (preview.expires < Date.now()) previews.delete(key)
    for (const [key, hit] of verifyCache) if (hit.expires < Date.now()) verifyCache.delete(key)
    for (const [key, hit] of failTrack) if (hit.expires < Date.now()) failTrack.delete(key)
  }
  const songKey = (song) => `${song.source}:${song.id}`
  function failCount(song) {
    const hit = failTrack.get(songKey(song))
    return hit && hit.expires > Date.now() ? hit.count : 0
  }
  function recordPlayFailure(song) {
    const key = songKey(song)
    const hit = failTrack.get(key)
    const count = (hit && hit.expires > Date.now() ? hit.count : 0) + 1
    failTrack.set(key, { count, expires: Date.now() + FAIL_TTL })
    verifyCache.delete(key)
    if (failTrack.size > 2000) failTrack.delete(failTrack.keys().next().value)
  }
  function clearPlayFailures(song) {
    failTrack.delete(songKey(song))
  }
  function fail(res, error) {
    if (!(error instanceof DigError)) console.error('[dig]', error)
    return res.status(error.status || 500).json({ success: false, code: error.code || 'IMPORT_FAILED', message: error instanceof DigError ? error.message : 'Could not complete the request.' })
  }
  function knownUser(req, res, next) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(req.auth.sub)) {
      return res.status(401).json({ success: false, message: 'invalid user' })
    }
    next()
  }
  // Public library/media, just like legacy songs. Guests can search and import.
  app.get('/api/dig/library', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: library.list() })
  })
  app.get('/api/dig/ingestion/:id', (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404)
    const status = library.ingestion(Number(req.params.id))
    if (!status) return res.sendStatus(404)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: status })
  })
  app.get('/api/dig/files/*', (req, res) => {
    const file = library.asset(req.params[0])
    if (!file) return res.sendStatus(404)
    if (file.endsWith('.l') || file.endsWith('.lrc')) res.type('text/plain; charset=utf-8')
    res.sendFile(file, { maxAge: '1d' }) // Supports byte ranges for audio seeking.
  })
  // Extensionless URL avoids nginx's static-image regex intercepting /api/*.jpg.
  app.get('/api/dig/poster/:id', (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.sendStatus(404)
    const file = library.asset(`poster/link.${req.params.id}.jpg`)
    if (!file) return res.sendStatus(404)
    res.sendFile(file, { maxAge: '1d' })
  })
  app.get('/api/dig/search', authMiddleware, knownUser, async (req, res) => {
    prune()
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const page = Number(req.query.page || 1)
    if (!query || query.length > 200 || /^https?:/i.test(query) || !Number.isInteger(page) || page < 1 || page > 100) {
      return fail(res, new DigError('INVALID_SEARCH', 'Enter a song title or artist (up to 200 characters).', 400))
    }
    const hit = searchHits.get(req.auth.sub) || { count: 0, expires: Date.now() + 60000 }
    searchHits.set(req.auth.sub, hit)
    if (++hit.count > 20) return fail(res, new DigError('BUSY', 'Too many searches. Please wait a minute.', 429))
    try {
      const found = await provider.search(query, page)
      const { songs: playable, excluded } = await prescan(found.songs, req.query.includeUnavailable === '1')
      const songs = playable.map((song) => {
        const key = randomUUID()
        results.set(key, { song, userId: req.auth.sub, expires: Date.now() + TTL })
        return {
          key, title: song.title, artist: song.artist, album: song.album,
          duration: song.duration, source: song.source, libraryId: library.find(song)?.id || null,
          verification: song.verification,
        }
      })
      while (results.size > 2000) results.delete(results.keys().next().value)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ success: true, data: { songs, page: found.page, totalPages: found.totalPages, excluded } })
    } catch (error) { fail(res, error) }
  })
  function publicJob(job) {
    return { id: job.id, status: job.status, result: job.result, code: job.code, message: job.message }
  }
  // Rank confirmed versions first. Incomplete probes, source timeouts and
  // missing lyrics remain available to try instead of becoming false negatives.
  async function prescan(candidates, includeUnavailable = false) {
    const verdicts = new Array(candidates.length).fill('unknown')
    const now = Date.now()
    const pending = []
    candidates.forEach((song, index) => {
      if (failCount(song) >= FAIL_THRESHOLD) { verdicts[index] = 'bad'; return }
      const hit = verifyCache.get(`${song.source}:${song.id}`)
      if (hit && hit.expires > now) verdicts[index] = hit.verdict
      else pending.push(index)
    })
    if (pending.length) {
      const budget = new AbortController()
      const timer = setTimeout(() => budget.abort(), PRESCAN_BUDGET_MS)
      try {
        let cursor = 0
        const workers = Array.from({ length: Math.min(PRESCAN_CONCURRENCY, pending.length) }, async () => {
          while (cursor < pending.length && !budget.signal.aborted) {
            const index = pending[cursor++]
            const song = candidates[index]
            let verdict = 'unknown'
            try {
              verdict = (await provider.verify(song, { signal: budget.signal })).verdict || 'unknown'
            } catch {
              verdict = 'unknown'
            }
            verdicts[index] = verdict
            if (verdict !== 'unknown') {
              verifyCache.set(`${song.source}:${song.id}`, { verdict, expires: Date.now() + VERIFY_CACHE_TTL })
              if (verifyCache.size > 2000) verifyCache.delete(verifyCache.keys().next().value)
            }
          }
        })
        await Promise.all(workers)
      } finally {
        clearTimeout(timer)
      }
    }
    const songs = []
    let excluded = 0
    candidates.forEach((song, index) => {
      const failures = failCount(song)
      const verification = verdicts[index] === 'bad' || failures >= FAIL_THRESHOLD
        ? 'unavailable' : verdicts[index] === 'ok' && failures === 0 ? 'verified' : 'unverified'
      if (verification === 'unavailable' && !includeUnavailable) excluded++
      else songs.push({ ...song, verification })
    })
    const rank = { verified: 0, unverified: 1, unavailable: 2 }
    songs.sort((a, b) => rank[a.verification] - rank[b.verification])
    return { songs, excluded }
  }
  // Audio elements cannot attach the app's Authorization header. An authenticated
  // request grants a short-lived, unguessable URL for this one search result.
  app.post('/api/dig/preview', authMiddleware, knownUser, (req, res) => {
    prune()
    const entry = results.get(req.body?.key)
    if (!entry || entry.userId !== req.auth.sub) {
      return fail(res, new DigError('SEARCH_EXPIRED', 'Search again before playing this song.', 410))
    }
    if (!previews.has(entry.previewToken)) {
      entry.previewToken = randomUUID()
      previews.set(entry.previewToken, { song: entry.song, userId: entry.userId, expires: Date.now() + 10 * 60000 })
      while (previews.size > 1000) previews.delete(previews.keys().next().value)
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: { token: entry.previewToken } })
  })
  // Synced lyrics for the listen-while-previewing panel. Read-only like preview:
  // it never allocates a library ID. Responses are cached per search result so
  // re-opening the same preview does not hit the upstream source again.
  app.post('/api/dig/lyrics', authMiddleware, knownUser, async (req, res) => {
    prune()
    const entry = results.get(req.body?.key)
    if (!entry || entry.userId !== req.auth.sub) {
      return fail(res, new DigError('SEARCH_EXPIRED', 'Search again before reading these lyrics.', 410))
    }
    try {
      if (!entry.lyricsPromise) {
        entry.lyricsPromise = provider.lyrics(entry.song).catch((error) => {
          entry.lyricsPromise = null
          throw error
        })
      }
      const lrc = await entry.lyricsPromise
      res.setHeader('Cache-Control', 'private, no-store')
      res.json({ success: true, data: { lrc } })
    } catch (error) {
      console.warn('[dig lyrics]', entry.song.source, entry.song.id, error.code || error.message)
      fail(res, error)
    }
  })
  app.get('/api/dig/preview/:token', async (req, res) => {
    prune()
    res.setHeader('Cache-Control', 'private, no-store')
    const entry = previews.get(req.params.token)
    if (!entry) return fail(res, new DigError('SEARCH_EXPIRED', 'This preview has expired. Play the result again.', 410))
    // ?probe=1 is the client's error diagnosis (reads the JSON failure code
    // the audio element hides). It must not pollute failure memory or logs.
    const probe = req.query.probe === '1'
    const range = req.headers.range
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return res.sendStatus(416)
    if (!activePreviews.has(entry.userId) && activePreviews.size >= 6) {
      return fail(res, new DigError('BUSY', 'Too many previews are playing. Please try again shortly.', 429))
    }
    activePreviews.get(entry.userId)?.abort()
    const controller = new AbortController()
    activePreviews.set(entry.userId, controller)
    const disconnect = () => controller.abort()
    res.on('close', disconnect)
    try {
      const audio = await provider.preview(entry.song, { range, signal: controller.signal })
      if (controller.signal.aborted) { await audio.body?.cancel(); return }
      res.status(audio.status)
      for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const value = audio.headers.get(header)
        if (value) res.setHeader(header, value)
      }
      const source = Readable.fromWeb(audio.body)
      source.on('error', () => {
        if (!probe && !controller.signal.aborted) recordPlayFailure(entry.song)
      })
      await pipeline(source, res)
      if (!probe) clearPlayFailures(entry.song)
    } catch (error) {
      if (!controller.signal.aborted && !res.headersSent && !res.destroyed) {
        if (!probe) {
          console.warn('[dig preview]', entry.song.source, entry.song.id, error.code || error.message)
          recordPlayFailure(entry.song)
        }
        fail(res, error)
      }
    } finally {
      res.off('close', disconnect)
      controller.abort()
      if (activePreviews.get(entry.userId) === controller) activePreviews.delete(entry.userId)
    }
  })
  app.post('/api/dig/import', authMiddleware, knownUser, (req, res) => {
    prune()
    const entry = results.get(req.body?.key)
    if (!entry || entry.userId !== req.auth.sub) {
      return fail(res, new DigError('SEARCH_EXPIRED', 'Search again before adding this song.', 410))
    }
    const manualLyrics = req.body?.manualLyrics
    if (manualLyrics !== undefined && !entry.manualLyricsAllowed) {
      return fail(res, new DigError('MANUAL_LYRICS_NOT_REQUESTED', 'Check for synced lyrics before supplying manual lyrics.', 400))
    }
    const running = [...jobs.values()].filter((job) => job.status === 'running')
    const own = running.find((job) => job.userId === req.auth.sub)
    if (own?.key === req.body.key) return res.status(202).json({ success: true, data: publicJob(own) })
    if (own || running.length >= 3) return fail(res, new DigError('BUSY', 'An import is already running. Please try again shortly.', 429))
    const job = { id: randomUUID(), key: req.body.key, userId: req.auth.sub, status: 'running', expires: Date.now() + TTL }
    jobs.set(job.id, job)
    library.add(entry.song, req.auth.sub, provider, { manualLyrics }).then((result) => {
      job.status = 'complete'
      job.result = result
      // Fresh imports onboard poster/metadata/instrumental automatically.
      if (result && !result.alreadyAdded) {
        try { onImported?.(result.song.id) } catch (error) { console.error('[dig import] auto-ingest hook failed', error) }
      }
    }).catch((error) => {
      if (!(error instanceof DigError)) console.error('[dig import]', error)
      job.status = 'failed'
      job.code = error.code || 'IMPORT_FAILED'
      if (job.code === 'NO_SYNCED_LYRICS') entry.manualLyricsAllowed = true
      job.message = error instanceof DigError ? error.message : 'Could not save the song. Please try again.'
    }).finally(() => { job.expires = Date.now() + TTL })
    res.status(202).json({ success: true, data: publicJob(job) })
  })
  app.get('/api/dig/import/:id', authMiddleware, knownUser, (req, res) => {
    prune()
    const job = jobs.get(req.params.id)
    if (!job || job.userId !== req.auth.sub) return fail(res, new DigError('JOB_EXPIRED', 'Import status expired. Search again to check the library.', 404))
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: publicJob(job) })
  })
}
