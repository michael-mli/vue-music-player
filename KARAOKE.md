# Karaoke — Solution Design

Karaoke mode in this player is two independent features that combine into one experience:

1. **Instrumental playback** — swap the audio source to a vocals-removed version of the
   track so the user can sing over it.
2. **Synced lyrics** — show the lyrics line-by-line, highlighting the current line in time
   with playback (and letting the user click a line to seek).

The two halves are deliberately decoupled: synced lyrics improve the normal listening
experience even with vocals present, and the instrumental can play even when no synced
lyrics are found. Karaoke "mode" is just both switched on together.

---

## 1. Instrumental playback

### Where instrumentals come from

There is **no public library of instrumental versions** of arbitrary copyrighted songs —
they have to be generated. We pre-process each MP3 **offline** with
[Demucs](https://github.com/facebookresearch/demucs) (Meta's source-separation model),
keep the drums/bass/other stems, drop the vocals, and re-encode the result to MP3.

This was validated on real catalog samples before committing to the approach — see
`KARAOKE_PROGRESS.md` (Phase 0). Headline: separation works on every bitrate; quality
tracks bitrate (320k cleanest, 128k usable), and ~57% of the catalog is 128k.

### File convention

Instrumentals live **next to the originals** at the music base URL (`VITE_MUSIC_BASE_URL`,
e.g. `/data`), so the existing URL machinery (`getMusicUrl`) just works:

```
/data/link.42.mp3                 ← original (vocals + music)
/data/link.42.instrumental.mp3    ← generated instrumental
/data/karaoke_manifest.json       ← list of ids that have an instrumental
```

Because separating the whole catalog is a long offline job (and may be done incrementally
or on a GPU box), the app must know **which** songs have an instrumental. Rather than
probe with 404-prone HEAD requests, the pipeline writes a **manifest**:

```json
{ "version": 1, "generatedAt": "2026-06-29T13:00:00Z", "ids": [1, 100, 250, 1000] }
```

The app fetches this once on startup, caches it, and exposes `isAvailable(id)`.

### How the swap works (app side)

`stores/player.ts` owns a persisted `karaokeMode` boolean. Source selection is centralized
in one helper:

```
sourceUrlFor(song):
  if karaokeMode && karaokeService.isAvailable(song.id):
      return getInstrumentalUrl(song.id)   // always network — never the cached vocal blob
  return cachedBlobUrl(song.id) ?? getMusicUrl(`link.${id}.mp3`)
```

Key rules:
- **Karaoke bypasses the in-memory blob cache.** The cache holds the *vocal* version
  (preloaded for background playback); in karaoke mode we always fetch the instrumental
  over the network. The PWA background-playback guarantees only apply to the original.
- **Toggling mid-song is seamless.** `toggleKaraoke()` captures `currentTime` + play state,
  swaps `audio.src`, and on `loadedmetadata` seeks back to the saved position and resumes.
- **Availability gates the UI.** The toggle is disabled (not hidden) when the current song
  has no instrumental, with a tooltip explaining why.

### Generating the catalog (offline pipeline)

`scripts/karaoke/` contains:
- `separate.py` — runs Demucs on one or more MP3s, writes `link.{id}.instrumental.mp3`.
- `run-batch.sh` — iterates the music dir, **skips already-done** files, calls `separate.py`,
  then rebuilds `karaoke_manifest.json`.
- `build-manifest.sh` — (re)scans for `*.instrumental.mp3` and writes the manifest.
- `README.md` — setup + run instructions (CPU vs GPU, runtime expectations).

CPU separation is ~6–9 min/song; **GPU is strongly recommended** for the full ~1,339-track
catalog. The pipeline is idempotent and resumable, so it can run in chunks.

---

## 2. Synced lyrics

### Data source: LRCLIB

The existing `.l` lyrics files are **plain text with no timing**, so today's "auto-scroll"
just interpolates scroll position against playback progress (a fake). Real synced lyrics
need per-line timestamps (LRC format: `[mm:ss.xx] line text`).

We pull these from [LRCLIB](https://lrclib.net) — a free, no-auth, FOSS-friendly synced
lyrics API (~3M tracks). `services/lyricsService.ts`:
- queries LRCLIB by track title (+ duration when known) via `/api/search`,
- parses the returned `syncedLyrics` LRC into `LyricLine[] = { time, text }`,
- caches results in `localStorage` (including negative results, to avoid re-querying),
- returns `null` when nothing matches.

**Honest limitation:** LRCLIB matches on **metadata** (artist + title + duration). This
catalog has no artist field and titles are derived from the first lyric line, so match
rate will be **modest**. This is best-effort enrichment, not a guarantee.

### Rendering & fallback (`LyricsPanel.vue`)

```
if synced lyrics available and automatic lyrics selected and karaoke mode on:
    render KaraokeGuide with current phrase, previous line, and upcoming lyrics
else if synced lyrics available and automatic lyrics selected:
    render line-by-line; highlight the active line (binary-search currentTime);
    auto-center the active line; click a line → player.seek(line.time)
else:
    fall back to the existing plain-text rendering + progress-based auto-scroll
```

The active-line lookup is a binary search over the sorted `time` array on each
`currentTime` tick — cheap, no per-line watchers.

The Karaoke page also uses `KaraokeGuide` while listening to the original vocals.
The guide provides an entry countdown during the intro and explicitly timed breaks,
a line progress bar, replay with a two-second lead-in, next-line seeking, a song
timeline, and an expandable full lyric list. Its fullscreen button opens a larger
stage on supported browsers; playback controls remain available there.

Enhanced LRC word timestamps (`<mm:ss.xx>` or inline `[mm:ss.xx]`) are preserved
and used for word highlighting. Standard LRC uses line progress only. Breaks
require blank timed lines or explicit vocal end markers; long intervals alone do
not imply silence. Manual lyrics remain available through the existing toggle.

Run `npm run test:lyrics` to verify parsing, countdowns, seeking, and end states.

**Timing adjustment:** Open **Adjust lyric timing** in the singing guide or regular
synced-lyrics panel. Choose the **First sung line**, then enter its actual playback
time in **Singing starts at (seconds)** (for example, `25.5`), or tap **Starts now**
when you hear that line begin. The app calculates the correction automatically.
Blank lines and common credits are skipped by default; the selector lets users
choose the right line when a source includes other introductory text. Both the
chosen line and correction are saved per song in this browser.

**Fine-tune offset** retains the **Earlier** / **Later** buttons (0.5-second steps)
and direct offset field. Positive offsets delay lyrics; negative offsets advance
them. Reset restores the source timing. Timing applies to line and word cues,
countdowns, and lyric seek/replay targets, including while paused. Both lyric views
share the settings. The audio and original LRC files are unchanged.

---

## Paired original vocal guide

In regular Karaoke (`/sing`), enable karaoke mode, select a song, and click
**Pair vocal guide**. Scan the QR code on another device and tap **Start vocal
guide**. The main player keeps playing the instrumental; the paired device
plays the original recording with vocals. Use headphones for a private guide.

The guide follows play/pause, seeking, playback rate, and song changes, including
while the host browses other pages. Each guide has its own volume and a saved
timing adjustment (positive values advance the guide for delayed outputs such
as Bluetooth). Clock estimation removes device clock differences, and ongoing
drift correction keeps the media timelines aligned. Physical speaker/headphone
latency still depends on the devices; use the timing slider to tune it by ear.

Keep both pages open. Guide playback requests a screen wake lock where supported
and pauses if host updates or the network connection stop. **End pairing**,
turning off karaoke, or entering KTV Party invalidates the link. Host reloads
require a fresh pairing; guide reloads preserve the pairing but require another
tap to enable audio. Sessions expire after 12 hours or two minutes without host
updates, and restarting the backend also invalidates them.

This uses the existing backend through `/api/karaoke-guide/sessions`, independently
of KTV Party features or media infrastructure. Deploy the frontend and restart the
backend together. No extra WebSocket proxy configuration is needed. Pairing tokens
live in the QR link fragment; the guide removes that fragment after opening and
uses a read-only token. Live sync responses are never cached by the PWA.

Run `npm run test:karaoke-guide` for route authorization, lifecycle, playback state,
clock mapping, and drift correction tests. After `npm run build`, run
`npm run test:karaoke-guide:browser` for isolated two-device Chrome acceptance.

## Configuration

| Key | Purpose | Default |
|-----|---------|---------|
| `VITE_MUSIC_BASE_URL` | also serves `*.instrumental.mp3` + manifest | `/data` |
| `VITE_KARAOKE_ENABLED` | master switch for the feature | `true` |
| `VITE_LRCLIB_BASE_URL` | synced-lyrics API base | `https://lrclib.net` |

If `VITE_KARAOKE_ENABLED=false`, the manifest is never fetched and the toggle is hidden —
the app behaves exactly as before.

---

## Files touched / added

**Added**
- `scripts/karaoke/{separate.py,run-batch.sh,build-manifest.sh,README.md,requirements.txt}`
- `src/services/karaokeService.ts` — manifest fetch/cache + `isAvailable(id)`
- `src/services/lyricsService.ts` — LRCLIB fetch + LRC parse + cache

**Modified**
- `src/config/index.ts` — `getInstrumentalUrl`, manifest URL, karaoke/LRCLIB config
- `src/types/index.ts` — `LyricLine`, karaoke-related types
- `src/stores/player.ts` — `karaokeMode`, `sourceUrlFor`, live swap, `toggleKaraoke`
- `src/components/Player/PlayerControls.vue` — karaoke mic toggle (desktop + mobile)
- `src/components/Lyrics/LyricsPanel.vue` — synced highlighting + click-to-seek
- `src/locales/{en,zh}.json` — karaoke strings

---

## Non-goals / future

- **Live (in-browser) vocal removal** — not feasible; separation is offline only.
- **Generating word timestamps** — the guide uses enhanced LRC when provided;
  it does not estimate syllable timings for line-only lyrics or parse YRC/QRC.
- **Scoring / pitch detection** — out of scope.
- **Caching instrumentals in the service worker** — the PWA audio cache currently targets
  originals; extending it to instrumentals is a follow-up.
