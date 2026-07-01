#!/usr/bin/env bash
# Onboard new song(s): poster + synced lyrics + karaoke instrumental, then publish and
# sync mc3. All three underlying steps are idempotent (skip what's already done).
#
# Usage:
#   ingest.sh <id> [<id> ...]     # onboard specific song ids
#   ingest.sh --auto              # find source songs that have no instrumental yet
#
# Instrumental generation prefers the GPU box (mics_cli active profile); if it's
# unreachable it falls back to local CPU. Posters live on the shared /data mount (visible
# to both hosts automatically); /karaoke and /synced are rsynced to mc3.
set -euo pipefail

REPO=/home/mli/others/vue-music-player
MUSIC_MOUNT=/mnt/yteatalk/music
LYRICS_DIR=$MUSIC_MOUNT/lyrics
KDIR=/var/www/html/others/music/karaoke
SYNCDIR=/var/www/html/others/music/synced
SCAN=$REPO/scripts/karaoke/karaoke_scan.csv
PY=/home/mli/miniconda3/bin/python3
GPU_HOST=https://mics5070wsl.micstec.com
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

# ---- 1. posters (iTunes) ---------------------------------------------------------------
echo "== posters =="
MUSIC_DIR=$MUSIC_MOUNT "$PY" "$REPO/scripts/fetch_posters.py" --only "$CSV" || true

# ---- 2. synced lyrics (LRCLIB) ---------------------------------------------------------
echo "== synced lyrics =="
"$PY" "$REPO/scripts/karaoke/fetch_synced_lyrics.py" \
  --lyrics-dir "$LYRICS_DIR" --out-dir "$SYNCDIR" --scan "$SCAN" --ids "$CSV" || true

# ---- 3. instrumental (GPU preferred, CPU fallback) -------------------------------------
echo "== instrumental =="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$GPU_HOST/" 2>/dev/null || echo 000)
if [ "$code" != "502" ] && [ "$code" != "000" ] && command -v mics_cli >/dev/null; then
  echo "using GPU box (http $code)"
  mics_cli exec "cd ~/karaoke_gpu && venv/bin/python gpu_batch.py $IDS 2>&1 | grep -aE 'ok |FAIL|skip|BATCH_DONE'" --timeout 300 || true
  for id in $IDS; do
    mics_cli download "/home/mli/karaoke_gpu/out/link.$id.instrumental.mp3" -o "$KDIR/link.$id.instrumental.mp3" >/dev/null 2>&1 || true
  done
else
  echo "GPU unreachable (http $code) — CPU fallback"
  nice -n 19 env OMP_NUM_THREADS=3 "$PY" "$REPO/scripts/karaoke/separate.py" \
    --music-dir "$MUSIC_MOUNT" --ids "$CSV" --out-dir "$KDIR" --bitrate 192k --max-duration 600 || true
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
