# Karaoke vocal-removal pipeline

Offline batch that turns each `link.{id}.mp3` into a vocals-removed
`link.{id}.instrumental.mp3` and writes a `karaoke_manifest.json` the app reads to know
which songs have an instrumental.

See `../../KARAOKE.md` for the overall design.

## Setup

```bash
# CPU (slow but works anywhere)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install demucs soundfile
# ffmpeg must be installed and on PATH
```

For the **full catalog**, use a GPU machine — Demucs auto-detects CUDA. Install the CUDA
build of torch/torchaudio from https://pytorch.org instead of the CPU index above.

> Note: torchaudio's default saver needs `torchcodec` and breaks on some CPU installs.
> `separate.py` sidesteps this by saving via `soundfile` + `ffmpeg`, so you do **not**
> need torchcodec.

## Pre-scan (recommended first)

Long files are almost always multi-song rips (medleys / whole albums in one MP3) — useless
for karaoke and by far the heaviest CPU hogs. Scan the catalog to see the distribution:

```bash
./scan.sh /mnt/yteatalk/music
```

Example (this catalog): 1,339 songs / 138.7 h audio, of which **33 files (2.5%) are >10 min
but account for 35% of the audio (49.2 h)** — the longest is 223 min. The batch skips these
by default (`--max-duration 600`, i.e. 10 min), saving ~91 h of CPU. Override the cap with
`MAX_DURATION=<seconds>` (0 = no cap).

## Run

```bash
# One or a few ids
python3 separate.py --music-dir /mnt/yteatalk/music --ids 1,100,250

# Explicit files
python3 separate.py /mnt/yteatalk/music/link.42.mp3

# Whole catalog + manifest (idempotent, resumable; skips files > 10 min by default)
./run-batch.sh /mnt/yteatalk/music

# Same, but no duration cap (process everything, including long rips)
MAX_DURATION=0 ./run-batch.sh /mnt/yteatalk/music

# Just rebuild the manifest after copying instrumentals in by hand
./build-manifest.sh /mnt/yteatalk/music
```

## Output

```
/mnt/yteatalk/music/link.42.instrumental.mp3   # one per processed song
/mnt/yteatalk/music/karaoke_manifest.json      # { version, generatedAt, ids: [...] }
```

The music dir must be the same location the app serves as `VITE_MUSIC_BASE_URL` (e.g.
`/data`), so the instrumentals and manifest are reachable at
`/data/link.{id}.instrumental.mp3` and `/data/karaoke_manifest.json`.

## Performance & quality

- CPU: ~6–9 min/song. GPU: a few seconds/song.
- Quality tracks source bitrate (validated: 320k cleanest, 128k usable with faint HF
  artifacts). `--bitrate` controls the output encode (default `192k`).
- Idempotent: re-running skips songs whose instrumental already exists (`--force` to redo).
