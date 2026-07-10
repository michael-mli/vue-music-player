#!/usr/bin/env bash
# Build/refresh the song metadata index (data/metadata.json) used by scoped search.
# Wraps scripts/build_metadata.py with production paths and publishes to mc3.
#
# Usage:
#   metadata.sh <id> [<id> ...]   # build metadata for specific song ids
#   metadata.sh --auto            # build for every song still missing metadata
set -euo pipefail

REPO=/home/mli/others/vue-music-player
MUSIC_MOUNT=/mnt/yteatalk/music
# App web root — data/ is owned by another user, so metadata.json lives at the root;
# the frontend falls back from /data/metadata.json to /metadata.json.
WEB_ROOT=/var/www/html/others/music
OUT=$WEB_ROOT/metadata.json
PY=/home/mli/miniconda3/bin/python3
MC3=mc3.micsapp.com

if [ $# -eq 0 ] || [ "${1:-}" = "--auto" ]; then
  echo "building metadata for all songs missing it ..."
  MUSIC_DIR=$MUSIC_MOUNT "$PY" "$REPO/scripts/build_metadata.py" --out "$OUT"
else
  CSV=$(echo "$*" | tr ' ' '\n' | grep -E '^[0-9]+$' | paste -sd, -)
  [ -z "$CSV" ] && { echo "no valid numeric ids"; exit 1; }
  echo "building metadata for ids: $CSV"
  MUSIC_DIR=$MUSIC_MOUNT "$PY" "$REPO/scripts/build_metadata.py" --out "$OUT" --only "$CSV" --force
fi

# Publish to mc3 (same pattern as ingest.sh; non-fatal if unreachable)
rsync -a "$OUT" "$MC3:$OUT" 2>/dev/null || echo "warn: metadata rsync to mc3 failed"

echo "== metadata done =="
