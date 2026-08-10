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

# Collect ids for files with a valid audio stream. This prevents an HTML/login response
# saved with an .mp3 extension from being advertised as karaoke-ready.
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ERROR: ffprobe is required to build a validated karaoke manifest." >&2
  exit 1
fi

ids="$(
  find "$MUSIC_DIR" -maxdepth 1 -type f -name 'link.*.instrumental.mp3' -print0 2>/dev/null \
    | xargs -0 -r -n1 -P "${KARAOKE_VALIDATE_JOBS:-8}" bash -c '
        path="$1"
        if ffprobe -v error -select_streams a:0 -show_entries stream=codec_type \
            -of default=noprint_wrappers=1:nokey=1 "$path" 2>/dev/null | grep -qx audio; then
          basename "$path"
        else
          echo "Skipping invalid karaoke asset: $path" >&2
        fi
      ' _ \
    | sed -E 's/^link\.([0-9]+)\.instrumental\.mp3$/\1/' \
    | sort -n
)"

count="$(printf '%s\n' "$ids" | grep -c . || true)"
csv="$(printf '%s\n' "$ids" | grep . | paste -sd, - || true)"

printf '{"version":1,"generatedAt":"%s","ids":[%s]}\n' "$GENERATED_AT" "$csv" > "$MANIFEST"
echo "Wrote $MANIFEST ($count instrumentals)"
