#!/usr/bin/env bash
# Scan a music directory for link.{id}.instrumental.mp3 files and write
# karaoke_manifest.json listing the available ids. The app fetches this to know
# which songs have an instrumental (so the karaoke toggle is enabled for them).
#
# Usage: build-manifest.sh /path/to/music-dir
set -euo pipefail

MUSIC_DIR="${1:-}"
if [[ -z "$MUSIC_DIR" || ! -d "$MUSIC_DIR" ]]; then
  echo "Usage: $0 <music-dir>" >&2
  exit 1
fi

MANIFEST="$MUSIC_DIR/karaoke_manifest.json"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Collect ids, numerically sorted.
ids="$(
  find "$MUSIC_DIR" -maxdepth 1 -name 'link.*.instrumental.mp3' -printf '%f\n' 2>/dev/null \
    | sed -E 's/^link\.([0-9]+)\.instrumental\.mp3$/\1/' \
    | sort -n
)"

count="$(printf '%s\n' "$ids" | grep -c . || true)"
csv="$(printf '%s\n' "$ids" | grep . | paste -sd, - || true)"

printf '{"version":1,"generatedAt":"%s","ids":[%s]}\n' "$GENERATED_AT" "$csv" > "$MANIFEST"
echo "Wrote $MANIFEST ($count instrumentals)"
