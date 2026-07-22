#!/usr/bin/env python3
"""
Batch-fetch time-synced lyrics from LRCLIB and cache them on the server, so the browser
never hits the LRCLIB API at runtime. For each song with a usable title, query LRCLIB by
title (+ closest duration), and if a synced (LRC) match exists, write it to
<out-dir>/link.{id}.lrc. Missing files simply mean "no synced lyrics" — the app falls back
to the plain .l lyrics. Idempotent (skips existing unless --force). See KARAOKE.md.

Usage:
  fetch_synced_lyrics.py --lyrics-dir /mnt/yteatalk/music/lyrics \
      --out-dir /var/www/html/others/music/synced [--scan karaoke_scan.csv] [--ids 1,2,3 | --all]
"""
import argparse, os, re, sys, time, json, urllib.parse, urllib.request

LRCLIB = "https://lrclib.net"
UA = "Mozilla/5.0 (karaoke-lyrics-cache)"
TS_RE = re.compile(r"\[\d{1,2}:\d{2}")


def read_title(lyrics_dir, sid):
    path = os.path.join(lyrics_dir, f"link.{sid}.mp3.l")
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                t = line.strip()
                if t and "link." not in t and ".mp3" not in t:
                    return t
    except Exception:
        return None
    return None


def load_durations(scan):
    d = {}
    if scan and os.path.exists(scan):
        for line in open(scan):
            parts = line.strip().split(",")
            if len(parts) >= 2:
                try:
                    d[int(parts[0])] = float(parts[1])
                except ValueError:
                    pass
    return d


def lrclib_search(title, retries=2):
    url = f"{LRCLIB}/api/search?q={urllib.parse.quote(title)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise last


def pick_synced(results, duration):
    synced = [r for r in results if r.get("syncedLyrics") and r["syncedLyrics"].strip()]
    if not synced:
        return None
    if duration and duration > 0:
        synced.sort(key=lambda r: abs((r.get("duration") or 0) - duration))
    return synced[0]["syncedLyrics"]


def collect_ids(args):
    ids = []
    if args.ids:
        ids = [int(x) for x in args.ids.split(",") if x.strip()]
    elif args.all:
        for name in os.listdir(args.lyrics_dir):
            m = re.match(r"link\.(\d+)\.mp3\.l$", name)
            if m:
                ids.append(int(m.group(1)))
        ids.sort()
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lyrics-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--scan", help="karaoke_scan.csv for duration matching")
    ap.add_argument("--ids")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--delay", type=float, default=0.25, help="seconds between LRCLIB calls")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    durations = load_durations(args.scan)
    ids = collect_ids(args)
    if not ids:
        print("no ids", file=sys.stderr)
        return 1

    found = notitle = nomatch = errors = skipped = 0
    for sid in ids:
        outp = os.path.join(args.out_dir, f"link.{sid}.lrc")
        if os.path.exists(outp) and not args.force:
            skipped += 1
            continue
        title = read_title(args.lyrics_dir, sid)
        if not title:
            notitle += 1
            continue
        try:
            results = lrclib_search(title)
            lrc = pick_synced(results, durations.get(sid))
            if lrc and TS_RE.search(lrc):
                with open(outp, "w", encoding="utf-8") as f:
                    f.write(lrc)
                found += 1
                print(f"ok {sid} \"{title[:20]}\" ({len(lrc.splitlines())} lines)", flush=True)
            else:
                nomatch += 1
        except Exception as e:
            errors += 1
            print(f"ERR {sid} {str(e)[:60]}", flush=True)
        time.sleep(args.delay)

    print(f"DONE found={found} nomatch={nomatch} notitle={notitle} errors={errors} skipped={skipped}",
          flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
