"""Resolve legacy and published Dig songs for offline ingestion tools."""
from functools import cached_property
import os
from pathlib import Path
import re
import shlex
import sqlite3


class MusicLibrary:
    def __init__(self, legacy_root, import_root, database):
        self.legacy_root = Path(legacy_root)
        self.import_root = Path(import_root)
        self.database = Path(database)

    @classmethod
    def from_environment(cls):
        # Direct CLI runs need the same storage paths as the backend. Read only
        # path settings, without sourcing a shell file or exposing credentials.
        settings = {}
        config = Path(__file__).resolve().parent.parent / '.env.server'
        if config.is_file():
            for line in config.read_text().splitlines():
                match = re.match(r'\s*(?:export\s+)?(DATA_DIR|DIG_MUSIC_DIR|MUSIC_DIR|WEB_ROOT)\s*=\s*(.*)', line)
                if match:
                    values = shlex.split(match[2], comments=True)
                    if values:
                        settings[match[1]] = values[0]
        settings.update(os.environ)
        web = Path(settings.get('WEB_ROOT', '/var/www/html/others/music'))
        data = Path(settings.get('DATA_DIR', str(web / '_auth')))
        return cls(settings.get('MUSIC_DIR', str(web / 'data')),
                   settings.get('DIG_MUSIC_DIR', str(data / 'music')), data / 'auth.db')

    @cached_property
    def imported(self):
        if not self.database.is_file():
            return {}
        with sqlite3.connect(self.database.resolve().as_uri() + '?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='imported_songs'").fetchone():
                return {}
            columns = {row['name'] for row in db.execute('PRAGMA table_info(imported_songs)')}
            mode = ',lyrics_mode' if 'lyrics_mode' in columns else ''
            return {row['id']: dict(row) for row in db.execute('SELECT id,title,artist,album,duration' + mode + ' FROM imported_songs')}

    def root(self, song_id):
        return self.import_root if song_id in self.imported else self.legacy_root

    def audio(self, song_id):
        return self.root(song_id) / f'link.{song_id}.mp3'

    def lyrics(self, song_id):
        return self.root(song_id) / 'lyrics' / f'link.{song_id}.mp3.l'

    def poster(self, song_id):
        return self.root(song_id) / 'poster' / f'link.{song_id}.jpg'

    def ids(self):
        ids = set(self.imported)
        for file in self.legacy_root.glob('link.*.mp3'):
            match = re.fullmatch(r'link\.(\d+)\.mp3', file.name)
            if match and file.is_file() and file.stat().st_size > 0:
                ids.add(int(match[1]))
        return sorted(ids)


library = MusicLibrary.from_environment()

if __name__ == '__main__':
    print(' '.join(map(str, library.ids())))
