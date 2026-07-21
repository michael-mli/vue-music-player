#!/usr/bin/env python3
"""Automatically assign the six built-in song categories.

Language and genre tags come from metadata.json. Singer gender comes from
Wikidata and is cached locally. Songs saved manually in the admin panel are
locked and are never modified by this profiler.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


WIKIDATA_API = "https://www.wikidata.org/w/api.php"
USER_AGENT = "MicsMusicCategoryProfiler/1.0 (https://music.micstec.com)"
MALE_QID = "Q6581097"
FEMALE_QID = "Q6581072"
MUSIC_WORDS = (
    "singer", "musician", "rapper", "songwriter", "vocalist",
    "recording artist", "musical group", "band", "歌手", "音樂家",
    "音乐家", "樂團", "乐团",
)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, payload):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def claim_item_ids(entity, prop):
    ids = []
    for claim in entity.get("claims", {}).get(prop, []):
        value = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        if isinstance(value, dict) and value.get("id"):
            ids.append(value["id"])
    return ids


def genders_from_entity(entity):
    values = set(claim_item_ids(entity, "P21"))
    genders = set()
    if MALE_QID in values:
        genders.add("male-singer")
    if FEMALE_QID in values:
        genders.add("female-singer")
    return genders


class WikidataGenderResolver:
    def __init__(self, cache_path, offline=False):
        self.cache_path = cache_path
        self.offline = offline
        self.cache = {}
        self.dirty = 0
        self.cache_hits = 0
        self.lookups = 0
        try:
            with open(cache_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
                self.cache = payload.get("artists", payload)
        except (OSError, json.JSONDecodeError):
            pass

    def save(self):
        if not self.dirty:
            return
        atomic_json(self.cache_path, {
            "generated": utc_now(),
            "source": "Wikidata",
            "artists": self.cache,
        })
        self.dirty = 0

    def request(self, params):
        params = {**params, "format": "json", "formatversion": "2", "maxlag": "30"}
        url = WIKIDATA_API + "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            },
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=15) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                api_error = payload.get("error")
                if api_error:
                    if api_error.get("code") == "maxlag" and attempt < 3:
                        time.sleep(2 + attempt)
                        continue
                    raise RuntimeError(f"Wikidata API error: {api_error.get('code', 'unknown')}")
                return payload
            except urllib.error.HTTPError as error:
                if error.code == 429 and attempt < 3:
                    retry = int(error.headers.get("Retry-After", "5"))
                    time.sleep(min(max(retry, 1), 30))
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                if attempt == 3:
                    raise
                time.sleep(1 + attempt)
        return {}

    def claim_ids(self, qid, prop):
        payload = self.request({
            "action": "wbgetclaims",
            "entity": qid,
            "property": prop,
        })
        return claim_item_ids({"claims": payload.get("claims", {})}, prop)

    def lookup_one(self, artist):
        language = "zh" if re.search(r"[\u3400-\u9fff]", artist) else "en"
        payload = self.request({
            "action": "wbsearchentities",
            "search": artist,
            "language": language,
            "uselang": language,
            "type": "item",
            "limit": "7",
        })
        results = payload.get("search", [])
        musical = [
            row for row in results
            if any(word in (row.get("description") or "").lower() for word in MUSIC_WORDS)
        ]
        if not musical:
            return set(), None

        for row in musical[:3]:
            gender_ids = set(self.claim_ids(row["id"], "P21"))
            genders = set()
            if MALE_QID in gender_ids:
                genders.add("male-singer")
            if FEMALE_QID in gender_ids:
                genders.add("female-singer")
            if genders:
                return genders, row["id"]

            # Musical groups do not have P21; profile their listed members.
            member_ids = self.claim_ids(row["id"], "P527")[:12]
            member_genders = set()
            for member_id in member_ids:
                member_gender_ids = set(self.claim_ids(member_id, "P21"))
                if MALE_QID in member_gender_ids:
                    member_genders.add("male-singer")
                if FEMALE_QID in member_gender_ids:
                    member_genders.add("female-singer")
            if member_genders:
                return member_genders, row["id"]
        return set(), musical[0]["id"]

    def resolve(self, artist):
        artist = re.sub(r"\s+", " ", artist or "").strip()
        if not artist:
            return set()
        cached = self.cache.get(artist)
        if cached is not None:
            self.cache_hits += 1
            return set(cached.get("genders", []))
        if self.offline:
            return set()

        self.lookups += 1
        genders = set()
        qid = None
        try:
            genders, qid = self.lookup_one(artist)
            if not genders:
                parts = [
                    part.strip()
                    for part in re.split(r"\s*(?:,|、|;|&|\bfeat\.?\b|\bfeaturing\b)\s*", artist, flags=re.I)
                    if len(part.strip()) > 1
                ]
                if len(parts) > 1:
                    for part in parts[:8]:
                        part_genders, _ = self.lookup_one(part)
                        genders.update(part_genders)
                        time.sleep(0.1)
            self.cache[artist] = {
                "genders": sorted(genders),
                "qid": qid,
                "checkedAt": utc_now(),
            }
            self.dirty += 1
            if self.dirty >= 10:
                self.save()
            time.sleep(0.15)
        except Exception as error:
            print(f"WARN artist lookup failed: {artist}: {error}", flush=True)
        return genders


def base_slugs(meta):
    slugs = set()
    language = str(meta.get("language") or "").lower()
    if language == "zh":
        slugs.add("chinese")
    elif language:
        slugs.add("other-language")

    genre = str(meta.get("genre") or "").lower()
    if "pop" in genre:
        slugs.add("pop")
    if re.search(r"(?:rock|metal|punk)", genre):
        slugs.add("rock-and-roll")

    title = str(meta.get("title") or "")
    if re.search(r"(?:女版|female\s+version)", title, re.I):
        slugs.add("female-singer")
    if re.search(r"(?:男版|male\s+version)", title, re.I):
        slugs.add("male-singer")
    return slugs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.environ.get("CATEGORY_DB_PATH", ""))
    parser.add_argument("--metadata", default=os.environ.get("CATEGORY_METADATA_PATH", ""))
    parser.add_argument("--cache", default=os.environ.get("CATEGORY_CACHE_PATH", ""))
    parser.add_argument("--offline", action="store_true", help="use cached artist genders only")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    if not args.db or not args.metadata or not args.cache:
        parser.error("--db, --metadata, and --cache (or matching environment variables) are required")

    with open(args.metadata, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    songs = payload.get("songs", payload)
    ordered = sorted(
        ((int(song_id), meta) for song_id, meta in songs.items() if str(song_id).isdigit()),
        key=lambda row: row[0],
    )
    if args.limit > 0:
        ordered = ordered[:args.limit]

    db = sqlite3.connect(args.db, timeout=30)
    db.execute("PRAGMA busy_timeout = 30000")
    db.execute("PRAGMA foreign_keys = ON")
    category_ids = {
        slug: category_id
        for category_id, slug in db.execute("SELECT id, slug FROM categories")
    }
    required = {
        "chinese", "other-language", "male-singer",
        "female-singer", "pop", "rock-and-roll",
    }
    missing = required - set(category_ids)
    if missing:
        raise RuntimeError("missing built-in categories: " + ", ".join(sorted(missing)))
    locked = {row[0] for row in db.execute("SELECT song_id FROM song_profile_locks")}
    def profile_locked(song_id):
        return db.execute("SELECT 1 FROM song_profile_locks WHERE song_id = ?", (song_id,)).fetchone() is not None

    timestamp = utc_now()
    counts = {slug: 0 for slug in required}

    # Phase one is local and fast, so language/genre tags appear immediately.
    profiled = 0
    for song_id, meta in ordered:
        if profile_locked(song_id):
            continue
        slugs = base_slugs(meta)
        db.execute("DELETE FROM song_categories WHERE song_id = ? AND source = 'auto'", (song_id,))
        for slug in slugs:
            db.execute(
                "INSERT OR IGNORE INTO song_categories "
                "(song_id, category_id, tagged_by, source, created_at) "
                "SELECT ?, ?, NULL, 'auto', ? WHERE NOT EXISTS "
                "(SELECT 1 FROM song_profile_locks WHERE song_id = ?)",
                (song_id, category_ids[slug], timestamp, song_id),
            )
            counts[slug] += 1
        profiled += 1
    db.commit()
    print(
        f"BASE_DONE songs={profiled} locked={len(locked)} "
        f"chinese={counts['chinese']} other={counts['other-language']} "
        f"pop={counts['pop']} rock={counts['rock-and-roll']}",
        flush=True,
    )

    resolver = WikidataGenderResolver(args.cache, offline=args.offline)
    gender_counts = {"male-singer": 0, "female-singer": 0}
    for index, (song_id, meta) in enumerate(ordered, 1):
        if profile_locked(song_id):
            continue
        genders = resolver.resolve(str(meta.get("artist") or ""))
        if profile_locked(song_id):
            continue
        for slug in genders:
            if slug not in gender_counts:
                continue
            db.execute(
                "INSERT OR IGNORE INTO song_categories "
                "(song_id, category_id, tagged_by, source, created_at) "
                "SELECT ?, ?, NULL, 'auto', ? WHERE NOT EXISTS "
                "(SELECT 1 FROM song_profile_locks WHERE song_id = ?)",
                (song_id, category_ids[slug], timestamp, song_id),
            )
            gender_counts[slug] += 1
        if index % 25 == 0:
            db.commit()
            print(
                f"GENDER_PROGRESS {index}/{len(ordered)} male={gender_counts['male-singer']} "
                f"female={gender_counts['female-singer']} lookups={resolver.lookups} cache={resolver.cache_hits}",
                flush=True,
            )

    db.commit()
    resolver.save()
    db.close()
    print(
        f"DONE songs={profiled} locked={len(locked)} male={gender_counts['male-singer']} "
        f"female={gender_counts['female-singer']} lookups={resolver.lookups} cache={resolver.cache_hits} "
        "source=Wikidata",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
