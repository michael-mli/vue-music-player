#!/usr/bin/env bash
# Batch-generate karaoke instrumentals for the whole catalog, then rebuild the manifest.
# Idempotent and resumable: separate.py skips files whose instrumental already exists.
#
# Usage:
#   run-batch.sh /path/to/music-dir            # process every link.*.mp3
#   run-batch.sh /path/to/music-dir 1,100,250  # process only these ids
#
# Notes:
# - CPU separation is ~6-9 min/song. For the full ~1,339-track catalog, run on a GPU box
#   (Demucs auto-uses CUDA when available) or let this run for a long time in the background.
# - Safe to re-run after an interruption; already-done files are skipped.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MUSIC_DIR="${1:-}"
IDS="${2:-}"

if [[ -z "$MUSIC_DIR" || ! -d "$MUSIC_DIR" ]]; then
  echo "Usage: $0 <music-dir> [id,id,...]" >&2
  exit 1
fi

PY="${PYTHON:-python3}"

if [[ -n "$IDS" ]]; then
  "$PY" "$HERE/separate.py" --music-dir "$MUSIC_DIR" --ids "$IDS"
else
  "$PY" "$HERE/separate.py" --music-dir "$MUSIC_DIR" --all
fi

bash "$HERE/build-manifest.sh" "$MUSIC_DIR"
