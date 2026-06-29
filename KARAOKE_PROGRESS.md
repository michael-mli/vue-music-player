# Karaoke — Implementation Progress

Tracks the phases of building karaoke mode. See `KARAOKE.md` for the design.

Status key: ✅ done · 🚧 in progress · ⬜ not started · 🔁 ongoing/offline

---

## Phase 0 — Feasibility validation ✅

Proved vocal removal works on the real catalog before building anything.

- ✅ Probed catalog: all 44.1kHz stereo; bitrate mix **~57% @128k, ~16% @192k, ~26% @320k**.
- ✅ Ran Demucs (htdemucs, two-stem) on 3 real samples: link.1 (320k), link.250 + link.1000 (128k).
- ✅ Measured loudness + spectrograms: confident vocal extraction at **all** bitrates;
  drums/bass preserved; 128k adds faint synthetic HF haze above the encode's brick-wall.
- ✅ User listened to the samples (uploaded to droppy) and approved the quality.

**Verdict:** viable. Quality tracks bitrate; ~75% of catalog expected "good enough."

---

## Phase 1 — Vocal-removal pipeline ✅ (code) · 🔁 (full run)

Offline batch that turns `link.{id}.mp3` → `link.{id}.instrumental.mp3` + manifest.

- ✅ `scripts/karaoke/separate.py` — Demucs → instrumental MP3 for one/many files.
- ✅ `scripts/karaoke/run-batch.sh` — iterate music dir, skip done, rebuild manifest.
- ✅ `scripts/karaoke/build-manifest.sh` — scan `*.instrumental.mp3` → `karaoke_manifest.json`
  (verified: emits sorted, valid JSON).
- ✅ `scripts/karaoke/README.md` + `requirements.txt`.
- ⬜ Seed prod: copy the 3 validated instrumentals + manifest into the music dir.
  **Blocked here** — the S3 music mount is read-only from this environment; run
  `run-batch.sh` (or copy the files) **on the server**.
- 🔁 **Full catalog run** — long offline job (GPU recommended); run incrementally.

---

## Phase 2 — Config + manifest service ✅

- ✅ `config/index.ts`: `getInstrumentalUrl(id)`, `getKaraokeManifestUrl()`,
  `VITE_KARAOKE_ENABLED`, `VITE_LRCLIB_BASE_URL` (+ `.env.local.example` documented).
- ✅ `services/karaokeService.ts`: fetch/cache manifest, `isAvailable(id)`, `ensureLoaded()`.

---

## Phase 3 — Synced lyrics (LRCLIB) ✅

- ✅ `types/index.ts`: `LyricLine`.
- ✅ `services/lyricsService.ts`: LRCLIB fetch by title/duration, `parseLrc`,
  `activeLineIndex` (binary search), localStorage cache (incl. misses), fallback to plain `.l`.
- ✅ Verified parser against real LRC (metadata headers excluded, fractional + `mm:ss`
  timestamps, multi-tag lines) and confirmed live LRCLIB response shape.

---

## Phase 4 — Player store: karaoke mode ✅

- ✅ `karaokeMode` ref (persisted) + `karaokeAvailable` getter for current song.
- ✅ Centralized source selection (`sourceUrlFor`) across playSong / playSongFromHistory.
- ✅ `toggleKaraoke()` with live source swap preserving position + play state; karaoke
  bypasses the in-memory vocal blob and uses the network instrumental.

---

## Phase 5 — UI ✅

- ✅ `PlayerControls.vue`: karaoke mic toggle (desktop + mobile), green when active,
  disabled when the current song has no instrumental.
- ✅ `LyricsPanel.vue`: synced line highlighting + auto-center + click-to-seek + "Synced"
  badge; plain-text fallback + progress auto-scroll intact.
- ✅ `locales/en.json` + `zh.json`: karaoke strings.

---

## Phase 6 — Verify ✅ (build) · ⬜ (live)

- ✅ `npm run type-check` clean.
- ✅ `npm run build` clean (pre-existing dynamic-import warning only).
- ✅ Unit-validated LRC parser + active-line search; confirmed LRCLIB API reachable.
- ⬜ **Manual end-to-end test** — needs instrumentals + manifest live on the server
  (blocked by the read-only mount here). Once seeded: toggle swaps audio mid-song; synced
  lyrics highlight + click-to-seek; fallback works for non-instrumental songs.

---

## Phase 7 — Deploy ✅

- ✅ Branch `feat/karaoke` pushed; PR #1 opened.
- ✅ Karaoke assets served from a writable `/karaoke/` path (the `/data` music dir is a
  read-only S3 mount) via `VITE_KARAOKE_BASE_URL`.
- ✅ Deployed frontend + seeded 3 validated instrumentals (songs 1, 250, 1000) to:
  - **music.micstec.com** (primary) — verified manifest + instrumental serve 200.
  - **mc3.micsapp.com** — verified manifest + instrumental serve 200, bundle baked.
- 🔁 Bounded local batch (songs 2–25) running niced on the primary host to widen coverage;
  rebuilds the primary manifest on completion. **mc3 is not auto-synced** — re-copy
  `/karaoke/` to mc3 after the batch to extend its coverage.

## Done / not-done summary

**Live now on both hosts:** karaoke toggle enabled for songs 1, 250, 1000; disabled
(safely) for the rest. All app code + offline pipeline + docs shipped; type-checks/builds clean.

**Remaining:**
1. **Full-catalog separation** — ~1,300 songs left; needs a GPU box for a reasonable runtime
   (`scripts/karaoke/run-batch.sh <music-dir>`, resumable). The local bounded batch only
   covers a small chunk.
2. **Sync new instrumentals to mc3** (and any other mirror hosts) after each batch.
3. Manual listen-test of the live toggle on a seeded song.

## Known limitations

- LRCLIB match rate is **modest** for this catalog (no artist metadata) — best-effort;
  plain lyrics remain the fallback.
- Service-worker caching of instrumentals is a follow-up (not scheduled).
