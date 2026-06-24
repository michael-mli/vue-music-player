#!/usr/bin/env python3
"""
Fetch song cover posters from the iTunes Search API.

For each song id (1..MAX), the title is the first line of its lyrics file
(<MUSIC>/lyrics/link.{id}.mp3.l). We query the iTunes Search API by title,
download the album artwork (upscaled to 600x600) and save it as
<MUSIC>/poster/link.{id}.jpg.

Songs with no usable title or no search result are skipped — the app falls
back to a bundled default poster for those.

Resumable: existing non-trivial poster files are skipped. Misses are logged
to <MUSIC>/poster/_misses.log so a later pass can retry them.

Usage:
  python3 scripts/fetch_posters.py [--max N] [--force] [--start ID] [--only ID[,ID...]]
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

MUSIC_DIR = os.environ.get("MUSIC_DIR", "/mnt/yteatalk/music")
LYRICS_DIR = os.path.join(MUSIC_DIR, "lyrics")
POSTER_DIR = os.path.join(MUSIC_DIR, "poster")
MISS_LOG = os.path.join(POSTER_DIR, "_misses.log")

ITUNES_URL = "https://itunes.apple.com/search"
MIN_VALID_BYTES = 1500          # smaller than this = not a real image
SLEEP_OK = 0.35                 # polite delay between successful requests
SLEEP_429 = 12                  # backoff when rate-limited
MAX_RETRIES = 4
UA = "Mozilla/5.0 (poster-fetch; +music-player)"


def read_title(song_id: int) -> str | None:
    path = os.path.join(LYRICS_DIR, f"link.{song_id}.mp3.l")
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            first = f.readline().strip()
    except OSError:
        return None
    if not first:
        return None
    low = first.lower()
    # Skip junk first lines that are clearly not a song name
    if "link." in low or low.endswith(".mp3") or low.startswith("http"):
        return None
    return first


def itunes_artwork(title: str) -> str | None:
    qs = urllib.parse.urlencode({"term": title, "entity": "song", "limit": 1})
    req = urllib.request.Request(f"{ITUNES_URL}?{qs}", headers={"User-Agent": UA})
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results") or []
            if not results:
                return None
            art = results[0].get("artworkUrl100")
            if not art:
                return None
            # Upscale: iTunes serves any size by swapping the dimension token
            return art.replace("100x100bb.jpg", "600x600bb.jpg")
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and attempt < MAX_RETRIES - 1:
                time.sleep(SLEEP_429 * (attempt + 1))
                continue
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 * (attempt + 1))
                continue
            return None
    return None


def download(url: str, dest: str) -> bool:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            blob = resp.read()
    except Exception:
        return False
    if len(blob) < MIN_VALID_BYTES:
        return False
    tmp = dest + ".tmp"
    with open(tmp, "wb") as f:
        f.write(blob)
    os.replace(tmp, dest)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=None, help="highest song id (default: read song_number.txt)")
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--force", action="store_true", help="re-download even if poster exists")
    ap.add_argument("--only", type=str, default=None, help="comma-separated ids to fetch")
    args = ap.parse_args()

    os.makedirs(POSTER_DIR, exist_ok=True)

    if args.max is None:
        try:
            with open(os.path.join(MUSIC_DIR, "song_number.txt")) as f:
                args.max = int(f.read().strip())
        except OSError:
            args.max = 1283

    if args.only:
        ids = [int(x) for x in args.only.split(",") if x.strip()]
    else:
        ids = list(range(args.start, args.max + 1))

    total = len(ids)
    got = skipped = no_title = no_art = fail = 0
    miss = open(MISS_LOG, "a", encoding="utf-8")

    for n, sid in enumerate(ids, 1):
        dest = os.path.join(POSTER_DIR, f"link.{sid}.jpg")
        if not args.force and os.path.exists(dest) and os.path.getsize(dest) >= MIN_VALID_BYTES:
            skipped += 1
            continue

        title = read_title(sid)
        if not title:
            no_title += 1
            miss.write(f"{sid}\tNO_TITLE\n"); miss.flush()
            continue

        url = itunes_artwork(title)
        if not url:
            no_art += 1
            miss.write(f"{sid}\tNO_ART\t{title}\n"); miss.flush()
            time.sleep(SLEEP_OK)
            continue

        if download(url, dest):
            got += 1
            if got % 25 == 0 or n == total:
                print(f"[{n}/{total}] got={got} skip={skipped} noTitle={no_title} "
                      f"noArt={no_art} fail={fail}  last: #{sid} {title}", flush=True)
        else:
            fail += 1
            miss.write(f"{sid}\tDL_FAIL\t{title}\t{url}\n"); miss.flush()
        time.sleep(SLEEP_OK)

    miss.close()
    print(f"DONE total={total} got={got} skipped={skipped} "
          f"noTitle={no_title} noArt={no_art} fail={fail}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
