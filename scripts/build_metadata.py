#!/usr/bin/env python3
"""
Build per-song metadata (artist, album, year, genre, language, duration) into a
single JSON index the frontend loads from /data/metadata.json.

Sources, merged in priority order:
  1. ID3 tags read from <MUSIC>/link.{id}.mp3 (needs the `mutagen` package;
     silently skipped when it isn't installed)
  2. iTunes Search API, queried by title (first line of the lyrics file
     <MUSIC>/lyrics/link.{id}.mp3.l — same convention as fetch_posters.py)
  3. Heuristics: language detected from title/artist characters

Incremental by default: songs already present in the output file with an artist
are skipped. Misses are logged to <out>/../metadata_misses.log.

Usage:
  python3 scripts/build_metadata.py [--max N] [--only ID[,ID...]] [--force]
                                    [--out /path/metadata.json] [--no-itunes]
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

MUSIC_DIR = os.environ.get("MUSIC_DIR", "/mnt/yteatalk/music")
LYRICS_DIR = os.path.join(MUSIC_DIR, "lyrics")
# Web root of the deployed app (data/ would be nicer but is owned by another user);
# the frontend falls back from /data/metadata.json to /metadata.json.
DEFAULT_OUT = "/var/www/html/others/music/metadata.json"

ITUNES_URL = "https://itunes.apple.com/search"
SLEEP_OK = 0.35
SLEEP_429 = 12
MAX_RETRIES = 4
UA = "Mozilla/5.0 (metadata-fetch; +music-player)"

try:
    from mutagen.mp3 import MP3
    from mutagen.id3 import ID3
    HAVE_MUTAGEN = True
except ImportError:
    HAVE_MUTAGEN = False


def read_title(song_id: int) -> str | None:
    """Song title = first line of the lyrics file (same rule as fetch_posters.py)."""
    path = os.path.join(LYRICS_DIR, f"link.{song_id}.mp3.l")
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            first = f.readline().strip()
    except OSError:
        return None
    if not first:
        return None
    low = first.lower()
    if "link." in low or low.endswith(".mp3") or low.startswith("http"):
        return None
    return first


def detect_language(*texts: str) -> str | None:
    """Rough script-based language guess — good enough for a search facet."""
    sample = " ".join(t for t in texts if t)
    if not sample:
        return None
    if re.search(r"[가-힯]", sample):
        return "ko"
    if re.search(r"[぀-ヿ]", sample):
        return "ja"
    if re.search(r"[一-鿿]", sample):
        return "zh"
    if re.search(r"[a-zA-Z]", sample):
        return "en"
    return None


def fix_mojibake(s: str | None) -> str | None:
    """Old Chinese MP3s store GBK bytes in tags mutagen decodes as latin-1.
    If a value is all high-latin-1 mojibake, re-decode it as GBK."""
    if s and all(ord(c) < 0x100 for c in s) and any(ord(c) > 0x7F for c in s):
        try:
            return s.encode("latin-1").decode("gbk")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return s
    return s


def id3_meta(song_id: int) -> dict:
    """Read what we can from the file's ID3 tags. Empty dict if no file/tags/mutagen."""
    if not HAVE_MUTAGEN:
        return {}
    path = os.path.join(MUSIC_DIR, f"link.{song_id}.mp3")
    meta: dict = {}
    try:
        audio = MP3(path)
        if audio.info and audio.info.length:
            meta["duration"] = int(round(audio.info.length))
        tags = audio.tags or ID3()
        def text(*frames):
            for fr in frames:
                v = tags.get(fr)
                if v and str(v).strip():
                    return fix_mojibake(str(v).strip())
            return None
        artist = text("TPE1", "TPE2")
        album = text("TALB")
        title = text("TIT2")
        genre = text("TCON")
        year_raw = text("TDRC", "TYER", "TDRL")
        if artist: meta["artist"] = artist
        if album: meta["album"] = album
        if title: meta["title"] = title
        if genre and not genre.isdigit(): meta["genre"] = genre
        if year_raw:
            m = re.search(r"(19|20)\d{2}", year_raw)
            if m:
                meta["year"] = int(m.group(0))
    except Exception:
        pass
    return meta


def itunes_meta(title: str) -> dict:
    """Query the iTunes Search API by title — artist, album, year, genre."""
    qs = urllib.parse.urlencode({"term": title, "entity": "song", "limit": 1})
    req = urllib.request.Request(f"{ITUNES_URL}?{qs}", headers={"User-Agent": UA})
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results") or []
            if not results:
                return {}
            r = results[0]
            meta: dict = {}
            if r.get("artistName"): meta["artist"] = r["artistName"]
            if r.get("collectionName"): meta["album"] = r["collectionName"]
            if r.get("primaryGenreName"): meta["genre"] = r["primaryGenreName"]
            if r.get("trackName"): meta["itunes_title"] = r["trackName"]
            release = r.get("releaseDate") or ""
            m = re.match(r"(\d{4})", release)
            if m:
                meta["year"] = int(m.group(1))
            if r.get("trackTimeMillis"):
                meta["duration"] = int(round(r["trackTimeMillis"] / 1000))
            return meta
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and attempt < MAX_RETRIES - 1:
                time.sleep(SLEEP_429 * (attempt + 1))
                continue
            return {}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 * (attempt + 1))
                continue
            return {}
    return {}


def build_one(song_id: int, use_itunes: bool) -> dict | None:
    """Merge sources for one song. Returns None when nothing at all was found."""
    title = read_title(song_id)
    id3 = id3_meta(song_id)
    itunes = {}
    # ID3 tags in this library are often missing/junk — iTunes fills the gaps.
    if use_itunes and title and not (id3.get("artist") and id3.get("year") and id3.get("genre")):
        itunes = itunes_meta(title)
        time.sleep(SLEEP_OK)

    meta = {
        # Lyrics first line is the app's canonical title; ID3 is the fallback
        "title": title or id3.get("title"),
        "artist": id3.get("artist") or itunes.get("artist"),
        "album": id3.get("album") or itunes.get("album"),
        "year": id3.get("year") or itunes.get("year"),
        "genre": id3.get("genre") or itunes.get("genre"),
        "duration": id3.get("duration") or itunes.get("duration"),
    }
    meta["language"] = detect_language(meta["title"] or "", meta["artist"] or "")
    meta = {k: v for k, v in meta.items() if v}
    if not meta:
        return None
    src = []
    if id3: src.append("id3")
    if itunes: src.append("itunes")
    meta["source"] = "+".join(src) if src else "lyrics"
    return meta


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=None, help="highest song id (default: read song_number.txt)")
    ap.add_argument("--only", type=str, default=None, help="comma-separated ids to build")
    ap.add_argument("--force", action="store_true", help="rebuild even if metadata exists")
    ap.add_argument("--out", type=str, default=DEFAULT_OUT)
    ap.add_argument("--no-itunes", action="store_true", help="skip iTunes lookups (offline)")
    args = ap.parse_args()

    if not HAVE_MUTAGEN:
        print("note: python package 'mutagen' not installed — skipping ID3 tags, using iTunes only", flush=True)

    if args.max is None:
        out_dir = os.path.dirname(args.out) or "."
        candidates = [
            os.path.join(out_dir, "data", "song_number.txt"),
            os.path.join(out_dir, "song_number.txt"),
            os.path.join(MUSIC_DIR, "song_number.txt"),
        ]
        for path in candidates:
            try:
                with open(path) as f:
                    args.max = int(f.read().strip())
                break
            except (OSError, ValueError):
                continue
        if args.max is None:
            args.max = 1339

    # Load existing index (incremental runs / merging)
    index: dict = {}
    try:
        with open(args.out, "r", encoding="utf-8") as f:
            existing = json.load(f)
            index = existing.get("songs", existing) or {}
    except (OSError, json.JSONDecodeError):
        pass

    if args.only:
        ids = [int(x) for x in args.only.split(",") if x.strip()]
    else:
        ids = list(range(1, args.max + 1))

    miss_log = os.path.join(os.path.dirname(args.out) or ".", "metadata_misses.log")
    total = len(ids)
    built = skipped = missed = 0

    with open(miss_log, "a", encoding="utf-8") as miss:
        for n, sid in enumerate(ids, 1):
            key = str(sid)
            if not args.force and index.get(key, {}).get("artist"):
                skipped += 1
                continue
            meta = build_one(sid, use_itunes=not args.no_itunes)
            if meta:
                # keep previously found fields the new pass didn't produce
                index[key] = {**index.get(key, {}), **meta}
                built += 1
            else:
                missed += 1
                miss.write(f"{sid}\tNO_META\n"); miss.flush()
            if built and built % 25 == 0:
                print(f"[{n}/{total}] built={built} skip={skipped} miss={missed}  last: #{sid}", flush=True)
                _write(args.out, index)  # checkpoint so long runs survive interruption

    _write(args.out, index)
    print(f"DONE total={total} built={built} skipped={skipped} missed={missed} -> {args.out}", flush=True)
    return 0


def _write(out_path: str, index: dict) -> None:
    payload = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "count": len(index), "songs": index}
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out_path)


if __name__ == "__main__":
    sys.exit(main())
