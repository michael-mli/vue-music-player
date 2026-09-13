"""Reuse existing library artwork by song title, without fuzzy/substring matching."""
from collections import defaultdict
from functools import lru_cache
import json
from pathlib import Path
import re
import tempfile
import os
import unicodedata

from PIL import Image

MIN_VALID_BYTES = 1500


def normalize(text):
    return ' '.join(unicodedata.normalize('NFKC', text or '').casefold().split())


def title_key(title, artist='', versions=False):
    text = normalize(title).replace('《', '').replace('》', '')
    if not versions:
        return text
    # Legacy lyric headers frequently append the singer after a spaced dash.
    text = re.split(r'\s+[-–—]\s+', text, maxsplit=1)[0]
    artist_key = normalize(artist)

    def annotation(match):
        label = match[1]
        is_version = re.search(r'版|女声|女聲|男声|男聲|合唱|主题曲|主題曲|伴奏|\blive\b|\bcover\b|dj|remix|acoustic|instrumental', label)
        is_artist = artist_key and artist_key in normalize(label)
        return '' if is_version or is_artist or label.lstrip().startswith('&') else match[0]

    text = re.sub(r'\(([^()]*)\)', annotation, text)
    text = re.sub(r'(?:国语|國語|粤语|粵語|女生|男生|女声|女聲|男声|男聲|合唱)版$', '', text)
    text = re.sub(r'歌词$', '', text)
    return normalize(text)


def usable_title(title):
    key = normalize(title)
    return bool(key and not re.match(r'^(?:https?://|link\.\d+|song \d+$|artist:|歌手[:：])', key)
                and not key.endswith('.mp3'))


def valid_poster(path):
    try:
        if path.stat().st_size < MIN_VALID_BYTES:
            return False
        with Image.open(path) as image:
            if image.format != 'JPEG' or min(image.size) < 32:
                return False
            image.load()
        return True
    except (OSError, ValueError, SyntaxError):
        return False


class PosterIndex:
    def __init__(self, library, metadata_path=None):
        self.library = library
        self.metadata = {}
        if metadata_path:
            try:
                raw = json.loads(Path(metadata_path).read_text())
                self.metadata = raw.get('songs', raw)
            except (OSError, ValueError, AttributeError):
                pass
        self.exact = defaultdict(list)
        self.base = defaultdict(list)
        self.built = False
        self.records = {}

    def record(self, sid):
        if sid not in self.records:
            meta = self.library.imported.get(sid) or self.metadata.get(str(sid), {})
            title = meta.get('title', '')
            if not usable_title(title):
                try:
                    with self.library.lyrics(sid).open(encoding='utf-8', errors='ignore') as handle:
                        title = handle.readline().strip()
                except OSError:
                    title = ''
            self.records[sid] = {'id': sid, 'title': title if usable_title(title) else '',
                                 'artist': meta.get('artist', '') or ''}
        return self.records[sid]

    def add(self, sid):
        record = self.record(sid)
        if record['title']:
            for index, versions in ((self.exact, False), (self.base, True)):
                key = title_key(record['title'], record['artist'], versions)
                if key and sid not in index[key]:
                    index[key].append(sid)

    def build(self):
        if self.built:
            return
        # Index titles once; decode only candidate donor images, not the entire collection.
        for sid in self.library.ids():
            self.add(sid)
        self.built = True

    @lru_cache(maxsize=None)
    def valid_donor(self, sid):
        return valid_poster(self.library.poster(sid))

    def find(self, sid):
        self.build()
        target = self.record(sid)
        if not target['title']:
            return None
        artist = normalize(target['artist'])
        for index, versions in ((self.exact, False), (self.base, True)):
            key = title_key(target['title'], target['artist'], versions)
            candidates = sorted(index.get(key, []), key=lambda donor: (
                not (artist and normalize(self.record(donor)['artist']) == artist),
                title_key(self.record(donor)['title']) != key, donor))
            for donor in candidates:
                if donor != sid and self.valid_donor(donor):
                    return {**target, 'donor_id': donor, 'donor_title': self.record(donor)['title'],
                            'donor_artist': self.record(donor)['artist'],
                            'match': 'base-title' if versions else 'exact-title'}
        return None

    def copy(self, match):
        dest = self.library.poster(match['id'])
        if valid_poster(dest):
            return False
        source = self.library.poster(match['donor_id'])
        if not valid_poster(source):
            raise ValueError(f'Donor poster is no longer valid: {source}')
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(dir=dest.parent, prefix=f'.{dest.name}.', suffix='.tmp', delete=False) as handle:
                tmp = Path(handle.name)
                handle.write(source.read_bytes())
            if not valid_poster(tmp):
                raise ValueError(f'Invalid copied poster from {source}')
            if valid_poster(dest):
                return False
            os.chmod(tmp, 0o644)
            os.replace(tmp, dest)
            self.valid_donor.cache_clear()
            self.add(match['id'])
            return True
        finally:
            if tmp and tmp.exists():
                tmp.unlink()
