#!/usr/bin/env bash
# Onboard new song(s): poster + synced lyrics + karaoke instrumental, then publish and
# sync mc3. All three underlying steps are idempotent (skip what's already done).
#
# Usage:
#   ingest.sh <id> [<id> ...]     # onboard specific song ids
#   ingest.sh --auto              # find source songs that have no instrumental yet
#
# Instrumental generation is distributed across the ready direct-SSH GPU pool. The script
# exits before publishing if no worker or any generated file is unavailable. Posters live
# on the shared /data mount (visible to both hosts automatically); /karaoke and /synced
# are rsynced to mc3.
set -euo pipefail

REPO=/home/mli/others/vue-music-player
MUSIC_MOUNT=/mnt/yteatalk/music
LYRICS_DIR=$MUSIC_MOUNT/lyrics
KDIR=/var/www/html/others/music/karaoke
SYNCDIR=/var/www/html/others/music/synced
SCAN=$REPO/scripts/karaoke/karaoke_scan.csv
PY=/home/mli/miniconda3/bin/python3
GPU_POOL=$REPO/scripts/karaoke/gpu_pool.py
MC3=mc3.micsapp.com

# ---- resolve ids -----------------------------------------------------------------------
if [ "${1:-}" = "--auto" ]; then
  maxid=$(cat /var/www/html/others/music/data/song_number.txt 2>/dev/null || echo 1339)
  echo "scanning 1..$maxid for source songs missing an instrumental ..." >&2
  IDS=""
  for id in $(seq 1 "$maxid"); do
    [ -s "$MUSIC_MOUNT/link.$id.mp3" ] && [ ! -f "$KDIR/link.$id.instrumental.mp3" ] && IDS="$IDS $id"
  done
else
  IDS="$*"
fi
IDS=$(echo "$IDS" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -n | tr '\n' ' ')
[ -z "$IDS" ] && { echo "nothing to ingest"; exit 0; }
CSV=$(echo "$IDS" | tr ' ' ',' | sed 's/,$//')
echo "ingesting ids: $IDS"

# Fail before doing any other ingest work. The API performs the same check before it
# creates a job; this protects direct script runs and the race where the pool stops later.
echo "== GPU preflight =="
"$PY" "$GPU_POOL" status --require-ready

# ---- 1. posters (iTunes) ---------------------------------------------------------------
echo "== posters =="
MUSIC_DIR=$MUSIC_MOUNT "$PY" "$REPO/scripts/fetch_posters.py" --only "$CSV" || true

# ---- 2. synced lyrics (LRCLIB) ---------------------------------------------------------
echo "== synced lyrics =="
"$PY" "$REPO/scripts/karaoke/fetch_synced_lyrics.py" \
  --lyrics-dir "$LYRICS_DIR" --out-dir "$SYNCDIR" --scan "$SCAN" --ids "$CSV" || true

# ---- 2b. metadata (ID3 + iTunes → data/metadata.json, powers scoped search) ------------
echo "== metadata =="
bash "$REPO/scripts/metadata.sh" $IDS || true

# ---- 3. instrumental (GPU required) ----------------------------------------------------
echo "== instrumental =="
if ! "$PY" "$GPU_POOL" dispatch --output-dir "$KDIR" $IDS; then
  echo "ERROR: Distributed GPU generation failed. No karaoke manifest was published." >&2
  exit 1
fi

# ---- 4. publish + sync mc3 -------------------------------------------------------------
echo "== publish =="
bash "$REPO/scripts/karaoke/build-manifest.sh" "$KDIR"
rsync -a "$KDIR/" "$MC3:/var/www/html/others/music/karaoke/" 2>/dev/null || echo "warn: karaoke rsync to mc3 failed"
ssh -o ConnectTimeout=8 "$MC3" 'mkdir -p /var/www/html/others/music/synced' 2>/dev/null || true
rsync -a "$SYNCDIR/" "$MC3:/var/www/html/others/music/synced/" 2>/dev/null || echo "warn: synced rsync to mc3 failed"

echo "== done =="
for id in $IDS; do
  inst=$([ -f "$KDIR/link.$id.instrumental.mp3" ] && echo yes || echo no)
  lrc=$([ -f "$SYNCDIR/link.$id.lrc" ] && echo yes || echo no)
  pos=$([ -f "$MUSIC_MOUNT/poster/link.$id.jpg" ] && echo yes || echo no)
  printf "  id %-5s instrumental=%s synced=%s poster=%s\n" "$id" "$inst" "$lrc" "$pos"
done
