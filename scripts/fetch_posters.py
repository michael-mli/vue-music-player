#!/usr/bin/env python3
"""
Reuse same-title library covers, then fetch missing posters from the iTunes Search API.

For each published legacy or Dig song, keep valid existing artwork, then reuse a
same-title library poster before querying iTunes. Copies use the song's resolved
legacy/import poster directory. --force still attempts an iTunes refresh first.

Use --reuse-only for an offline backfill, --dry-run to preview matches without
writing posters, and --report PATH to save donor IDs and remaining misses.
Requires Pillow (already installed in the ingestion Python environment).

Usage:
  python3 scripts/fetch_posters.py [--max N] [--force] [--start ID] [--only ID[,ID...]]
  python3 scripts/fetch_posters.py --reuse-only --dry-run --report /tmp/cover-plan.json
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from music_library import library
from poster_reuse import PosterIndex, valid_poster
from pathlib import Path

ITUNES_URL = "https://itunes.apple.com/search"
MIN_VALID_BYTES = 1500          # smaller than this = not a real image
SLEEP_OK = 0.35                 # polite delay between successful requests
SLEEP_429 = 12                  # backoff when rate-limited
MAX_RETRIES = 4
UA = "Mozilla/5.0 (poster-fetch; +music-player)"


def read_title(song_id: int) -> str | None:
    imported_title = library.imported.get(song_id, {}).get('title')
    if imported_title:
        return imported_title
    path = library.lyrics(song_id)
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
    if not valid_poster(Path(tmp)):
        os.unlink(tmp)
        return False
    os.replace(tmp, dest)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=None, help="highest song id (default: all published songs)")
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--force", action="store_true", help="re-download even if poster exists")
    ap.add_argument("--only", type=str, default=None, help="comma-separated ids to fetch")
    ap.add_argument("--reuse-only", action="store_true", help="reuse library covers only; no external requests")
    ap.add_argument("--dry-run", action="store_true", help="report reusable covers without writing covers or making requests")
    ap.add_argument("--report", help="write a JSON summary including donor IDs and unmatched songs")
    ap.add_argument("--metadata", default=os.path.join(os.environ.get('WEB_ROOT', '/var/www/html/others/music'), 'metadata.json'))
    args = ap.parse_args()

    ids = library.ids()
    if args.only:
        requested = {int(x) for x in args.only.split(',') if x.strip()}
        ids = [sid for sid in ids if sid in requested]
    else:
        ids = [sid for sid in ids if sid >= args.start and (args.max is None or sid <= args.max)]
    index = PosterIndex(library, args.metadata)
    report = {'total': len(ids), 'existing': 0, 'downloaded': 0, 'reused': [], 'unmatched': [], 'errors': [], 'dry_run': args.dry_run}

    def log(sid, name, line):
        folder = library.poster(sid).parent
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / name).open('a', encoding='utf-8') as handle:
            handle.write(line + '\n')

    for n, sid in enumerate(ids, 1):
        dest = library.poster(sid)
        if valid_poster(dest) and (not args.force or args.dry_run or args.reuse_only):
            report['existing'] += 1
            continue
        record = index.record(sid)
        match = index.find(sid)
        if match and (not args.force or args.dry_run or args.reuse_only):
            try:
                if args.dry_run or index.copy(match):
                    report['reused'].append(match)
                    print(f"{'WOULD REUSE' if args.dry_run else 'REUSED'} #{sid} {record['title']} <- #{match['donor_id']} {match['donor_title']}", flush=True)
                    if not args.dry_run:
                        log(sid, '_reuse.jsonl', json.dumps(match, ensure_ascii=False))
                continue
            except (OSError, ValueError) as error:
                report['errors'].append({'id': sid, 'error': str(error)})
                print(f"REUSE FAILED #{sid}: {error}", flush=True)
        if args.reuse_only or args.dry_run:
            report['unmatched'].append(record)
            continue
        title = record['title']
        if not title:
            report['unmatched'].append(record)
            log(sid, '_misses.log', f"{sid}\tNO_TITLE")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        url = itunes_artwork(f"{title} {record['artist']}".strip())
        if url and download(url, str(dest)):
            report['downloaded'] += 1
            index.valid_donor.cache_clear()
            index.add(sid)
            print(f"[{n}/{len(ids)}] DOWNLOADED #{sid} {title}", flush=True)
        elif match and index.copy(match):
            report['reused'].append(match)
            log(sid, '_reuse.jsonl', json.dumps(match, ensure_ascii=False))
        else:
            report['unmatched'].append(record)
            log(sid, '_misses.log', f"{sid}\t{'DL_FAIL' if url else 'NO_ART'}\t{title}")
        time.sleep(SLEEP_OK)

    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f"DONE total={len(ids)} existing={report['existing']} reused={len(report['reused'])} "
          f"downloaded={report['downloaded']} unmatched={len(report['unmatched'])} errors={len(report['errors'])}", flush=True)
    return 1 if report['errors'] else 0


if __name__ == "__main__":
    sys.exit(main())
