# Dig song

Open **Dig song** from the sidebar or library, search by title/artist, and select **Add to library**. Guest and Google identities can both import. Imported songs are shared with all listeners, and can be played or added to playlists normally. When synced lyrics are missing, the user is prompted to supply plain lyrics. Canceling adds nothing. Submitting blank lyrics shows a warning and saves the song title as its non-synced lyrics.

Each result also has **Play** to listen before importing, with pause, seeking and synced lyrics. Previewing pauses the library player; switching songs, starting another search or leaving the page stops the preview. Previews stream through short-lived URLs and never create files or allocate song IDs.

The adapter uses go-music-dl's `/music/search` HTML song-card data and `/music/download_lrc` + `/music/download?stream=1`. Provider audio and synced lyrics use the same upstream source, song ID, and extra metadata. It does not execute upstream HTML or accept arbitrary download URLs from clients. The upstream contract was verified against [the source implementation](https://github.com/guohuiyuan/go-music-dl/blob/main/internal/web/music.go) and [search template](https://github.com/guohuiyuan/go-music-dl/blob/main/internal/web/templates/partials/song_list.html).

## Storage and IDs

The deployed `/data` music mount is read-only. New assets therefore live in `DIG_MUSIC_DIR` (defaults to `DATA_DIR/music`) and are served by the existing API backend. For a library ending at ID 1339, the next import creates:

- `link.1340.mp3`: validated MP3; FFmpeg converts other source formats without trimming or changing tempo.
- `lyrics/link.1340.mp3.l`: title on the first line, followed by plain lyrics.
- `synced/link.1340.lrc`: the provider's original timestamps and metadata, including LRC offsets; omitted for manual-lyrics imports.
- `song_number.txt`: the latest assigned ID in the writable store.

The SQLite `imported_songs` table is the publication index. Allocation takes the maximum of legacy count files, existing media/lyrics filenames, and imported IDs under a SQLite write transaction. Downloads finish before ID allocation. Duplicate source/ID imports reuse their existing ID. Failures clean staged files and do not publish incomplete library entries. Orphaned media after a process crash is skipped, never overwritten. Existing library loading merges this public import index and registers ID-based media URLs before lyrics loading and playback.

Manual legacy writers (including the old `addsong` script outside the backend) must also account for the writable store's `song_number.txt` when allocating IDs. They do not participate in the backend transaction. Avoid running independent ID allocators concurrently. Multiple serving hosts need the same import index/media or must proxy these API routes to one backend; existing karaoke rsync scripts do not copy this store.

Offline ingestion resolves published imports through `scripts/music_library.py`, using the same database and writable store as the backend. GPU batches use `/api/dig/files/link.{id}.mp3` for imported songs and `/data/link.{id}.mp3` for legacy songs. Override these public worker URLs with `KARAOKE_IMPORT_URL` and `KARAOKE_SOURCE_URL` if needed. Metadata retains the selected recording's title/artist/album/duration; synced lyrics are copied byte-for-byte from the import, including offsets, even on forced runs. Imported posters live in the writable store and are served through `/api/dig/poster/{id}`. `ingest.sh --auto` includes both libraries. Instrumentals and the manifest keep their existing IDs, paths and mc3 publication flow.

## Manual lyrics when synced lyrics are missing

The first import attempt checks for synchronized lyrics. If it fails with `NO_SYNCED_LYRICS`, Dig song displays a lyrics form for that result. The song title is automatically saved as the first line. The user can paste plain text and select **Add with these lyrics**, or leave it blank and select **Add using title only**. Blank input shows a warning and proceeds with just the title as non-synced lyrics; canceling still adds nothing. Manual text is limited to 20,000 characters and validated on the server. The retry sends `manualLyrics` with the same user-owned result key; unsolicited overrides before the missing-lyrics prompt are rejected.

Manual imports retain the normal numeric ID allocation and audio validation. `lyrics/link.<id>.mp3.l` contains the title followed by any supplied text (a pasted matching title is not duplicated); no `.lrc` file or artificial timestamps are generated. `imported_songs.lyrics_mode` is `manual` (existing imports default to `synced`), exposed to the frontend as `lyricsMode`. Playback shows plain lyrics and skips automatic synced-lyrics lookup, including LRCLIB fallback. Ingestion also preserves this choice and skips its synced-lyrics step without treating the intentionally absent LRC as an error. Poster, metadata, instrumental generation and automatic publication still run normally.

## Automatic ingestion after adding

Every **new** Dig import inserts a `dig_ingestion` queue record in the same SQLite transaction that publishes its song ID and matching audio/lyrics. A failed import creates neither the song nor a queue item. Adding an already-imported version reuses its ID without queuing duplicate work. Existing songs are not bulk-enqueued when this feature is deployed.

The backend checks the durable queue every 5 seconds and runs `scripts/karaoke/ingest.sh <id>` for one song at a time. This uses the existing poster, exact synced-lyrics, metadata, GPU instrumental and mc3 publication pipeline. The original song is playable immediately; processing continues even after the listener leaves the page. The UI confirms that processing will run automatically. Karaoke availability refreshes every minute while the app is visible, so newly published instrumentals can become available without a page reload.

Jobs transition through `queued`, `running`, `retry` and `complete`. Failures, including unavailable GPU workers and publication failures, retry automatically after 1 minute with exponential backoff capped at 30 minutes. There is no manual retry requirement. Backend startup requeues interrupted jobs; existing pipeline outputs are reused on retry. Shell locks serialize automatic and manual ingestion and protect metadata merges. Successful completion includes publication to mc3.

For status, `GET /api/dig/ingestion/<songId>` returns the shared song's processing state and next retry time. Admins can inspect the last 100 durable job records, including failure details, at `GET /api/admin/dig-ingestion`. Execution logs also use the existing admin job registry and `pm2 logs karaoke-auth` (`[dig ingestion]` entries). Preserve `auth.db` across deployments: it holds both the library publication index and this queue.

## Running

Deploy the frontend build and restart the existing Node backend together. No nginx media alias is required; `/api/dig/files/` supports byte-range requests. Keep the import directory and auth database across releases. FFmpeg with `libmp3lame` must be available (override `FFMPEG_BIN` if necessary). See `.env.server.example` for `DIG_SOURCE_URL`, `DIG_MUSIC_DIR`, and `MUSIC_DIR`.

Imports run asynchronously, with status polling and per-user job ownership. Returning to the Dig song page in the same tab resumes status checks. If the backend restarts mid-import, repeat the search: published songs are detected from the durable index. Search-result tokens and job history expire after 30 minutes. Imports are limited to 100 MB, one active import per user, and three active imports per backend.

Search results are checked and ranked before listing. Versions with verified audio and synced lyrics appear first. Timeouts, incomplete checks, missing synced lyrics and sample-decoding failures remain visible with **Not fully verified — try Play**. A failed check of the first 256 KB cannot prove the complete recording is unplayable: some containers need metadata later in the file. Missing synced lyrics also does not prevent listening; the import flow requires either valid synchronized lyrics or explicitly supplied manual lyrics before it allocates an ID.

Explicit audio error responses and files exceeding the size limit are hidden by default. **Include unavailable versions (try anyway)** restores those results, including on otherwise empty pages, and keeps Play available. The API option is `includeUnavailable=1`; each result carries `verification` (`verified`, `unverified`, or `unavailable`). Sorting preserves the source order within each group.

Checks run with 6 concurrent workers and a 40-second total budget per search page. Completed verdicts are cached for 10 minutes per source/id. Unknown verdicts are retried next search. The backend reads at most 256 KB of each audio response, cancels the stream, and asks FFmpeg to decode a short sample in memory. A status-200 response, audio content type or ID3 header alone is not a successful check. No preview files or library IDs are created.

A failed playback invalidates its cached positive verdict and marks that version uncertain. Two failed playbacks temporarily hide it for 5 minutes, with the same include-unavailable option allowing retries. Cached checks cannot erase those failures; a completed successful stream clears them. The client's error diagnosis uses `?probe=1`, which never feeds that memory. Provider availability can still change after any check.

## Private music source

Production uses a local go-music-dl v1.1.0 instance at `http://127.0.0.1:3130/music`. Both music.micstec.com and mc3.micsapp.com use it through their shared backend. The external demo's EdgeOne verification is no longer involved.

Install or restart the pinned official Linux amd64 release with:

```sh
bash scripts/deploy_music_source.sh
```

The installer checks the archive SHA-256, installs the binary and upstream license in `~/.local/share/mics-music-source`, and saves the `music-source` PM2 process. Its `data/` directory persists across upgrades. `server/music-source.config.cjs` uses the upstream loopback-only desktop server mode on port 3130, so the source and its configuration UI are not publicly exposed. No additional nginx route is needed.

Set `DIG_SOURCE_URL=http://127.0.0.1:3130/music` in `.env.server`, then run `pm2 restart karaoke-auth`. For diagnostics use `pm2 logs music-source` and `curl http://127.0.0.1:3130/music`. Some providers or tracks may require platform login cookies; ordinary search works without them. The import still requires playable audio plus either synchronized lyrics for the exact selected version or lyrics supplied manually by the listener.

To administer platform cookies, tunnel the private service through SSH (`ssh -L 3130:127.0.0.1:3130 <music-server>`) and open `http://127.0.0.1:3130/music` locally. Leave port 3130 bound to loopback.

## Verification

Run `npm test --prefix server` for provider, ID allocation, concurrency, rollback, audio conversion, and HTTP integration checks. Run `npm run build` for TypeScript and the production frontend build. Tests use a temporary library and a synthetic audio tone; they do not alter the production library.

Run `python3 -m unittest discover -s scripts -p 'test_music_library.py'` for mixed-library ingestion, exact metadata/lyrics preservation and GPU source routing checks.
