#!/usr/bin/env bash
# Pre-scan the catalog: record each song's duration (and size) so the batch can skip
# over-long files. Long files are almost always multi-song rips (medleys / full albums in
# one MP3) — pointless to "de-vocal" and the heaviest CPU hogs. The CSV this writes
# (id,duration_sec,bytes) doubles as the worklist for run-batch.sh --from-scan.
#
# Usage: scan.sh <music-dir> [out-csv]
#   default out-csv: <music-dir>/karaoke_scan.csv
set -euo pipefail

MUSIC_DIR="${1:-}"
OUT="${2:-}"
if [[ -z "$MUSIC_DIR" || ! -d "$MUSIC_DIR" ]]; then
  echo "Usage: $0 <music-dir> [out-csv]" >&2
  exit 1
fi
# Default the CSV to the scripts dir if the music dir is read-only.
OUT="${OUT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/karaoke_scan.csv}"

probe() {
  local f="$1"
  local id dur sz
  id="$(basename "$f" | sed -E 's/^link\.([0-9]+)\.mp3$/\1/')"
  sz="$(stat -c%s "$f" 2>/dev/null || echo 0)"
  dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null || echo 0)"
  printf '%s,%.0f,%s\n' "$id" "${dur:-0}" "$sz"
}
export -f probe

echo "Scanning $MUSIC_DIR ..." >&2
# -maxdepth 1, originals only (exclude *.instrumental.mp3), parallel header reads.
find "$MUSIC_DIR" -maxdepth 1 -name 'link.*.mp3' ! -name '*.instrumental.mp3' -print0 \
  | xargs -0 -P 16 -I{} bash -c 'probe "$@"' _ {} \
  | sort -t, -k1 -n > "$OUT"

# Summary
awk -F, '
  { n++; d=$2; total+=d; if(d>max){max=d}
    if(d<=300)b5++; else if(d<=480)b8++; else if(d<=600)b10++;
    else if(d<=900)b15++; else b15p++ }
  END{
    printf "Scanned %d songs, total %.1f h\n", n, total/3600
    printf "  <= 5 min : %d\n", b5
    printf "  5-8 min  : %d\n", b8
    printf "  8-10 min : %d\n", b10
    printf "  10-15 min: %d\n", b15
    printf "  > 15 min : %d   <-- almost certainly multi-song rips\n", b15p
    printf "  longest  : %.1f min\n", max/60
  }' "$OUT" >&2
echo "Wrote $OUT" >&2
