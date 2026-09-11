"""Offline regression checks for ingestion of a mixed legacy/Dig library."""
import os
from pathlib import Path
import shlex
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from music_library import MusicLibrary
import build_metadata
import fetch_posters
from karaoke import gpu_pool


class ImportedIngestionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.legacy = root / 'legacy'
        self.imports = root / 'imports'
        for folder in (self.legacy, self.imports):
            (folder / 'lyrics').mkdir(parents=True)
            (folder / 'synced').mkdir()
        self.db = root / 'auth.db'
        with sqlite3.connect(self.db) as db:
            db.execute('CREATE TABLE imported_songs (id INTEGER,title TEXT,artist TEXT,album TEXT,duration REAL)')
            db.execute("INSERT INTO imported_songs VALUES(1360,'Exact title','Exact artist','Exact album',233)")
        (self.legacy / 'link.1.mp3').write_bytes(b'legacy')
        (self.legacy / 'link.2.mp3').write_bytes(b'')
        (self.imports / 'link.1360.mp3').write_bytes(b'imported')
        (self.imports / 'link.1361.mp3').write_bytes(b'unpublished orphan')
        (self.imports / 'lyrics/link.1360.mp3.l').write_text('Exact title\nWords\n')
        self.lrc = b'[offset:125]\n[00:01.25]Exact words\n[00:02.75]More words\n'
        (self.imports / 'synced/link.1360.lrc').write_bytes(self.lrc)
        self.library = MusicLibrary(self.legacy, self.imports, self.db)

    def test_resolution_uses_publication_index_and_keeps_legacy(self):
        self.assertEqual(self.library.ids(), [1, 1360])
        self.assertEqual(self.library.audio(1).read_bytes(), b'legacy')
        self.assertEqual(self.library.audio(1360).read_bytes(), b'imported')
        self.assertEqual(self.library.root(1361), self.legacy)

    def test_metadata_and_poster_use_the_imported_recording(self):
        with patch.object(build_metadata, 'library', self.library), patch.object(build_metadata, 'itunes_meta') as itunes:
            meta = build_metadata.build_one(1360, use_itunes=True)
            self.assertEqual((meta['title'], meta['artist'], meta['duration']), ('Exact title', 'Exact artist', 233))
            itunes.assert_not_called()
        with patch.object(fetch_posters, 'library', self.library):
            self.assertEqual(fetch_posters.read_title(1360), 'Exact title')
        self.assertEqual(self.library.poster(1360), self.imports / 'poster/link.1360.jpg')

    def test_synced_lyrics_preserved_even_when_forced(self):
        out = Path(self.temp.name) / 'synced'
        out.mkdir()
        (out / 'link.1360.lrc').write_text('wrong version')
        env = {**os.environ, 'DATA_DIR': self.temp.name, 'DIG_MUSIC_DIR': str(self.imports), 'MUSIC_DIR': str(self.legacy)}
        result = subprocess.run([sys.executable, str(Path(__file__).parent / 'karaoke/fetch_synced_lyrics.py'),
                                 '--lyrics-dir', str(self.legacy / 'lyrics'), '--out-dir', str(out),
                                 '--ids', '1360', '--force'], env=env, capture_output=True, text=True, check=True)
        self.assertIn('preserved imported synced lyrics', result.stdout)
        self.assertEqual((out / 'link.1360.lrc').read_bytes(), self.lrc)

    def test_mixed_gpu_batch_receives_import_ids_and_both_urls(self):
        with patch.object(gpu_pool, 'library', self.library), patch.object(gpu_pool, 'ssh_base', return_value=['ssh']), \
                patch.object(gpu_pool.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 0, stdout='ok', stderr='')
            gpu_pool.run_remote_job('worker.example', [1, 1360])
            command = shlex.split(run.call_args.args[0][-1])
            self.assertIn('KARAOKE_IMPORTED_IDS=1360', command)
            self.assertIn('KARAOKE_IMPORT_URL=https://music.micstec.com/api/dig/files', command)
            self.assertIn('KARAOKE_SOURCE_URL=https://music.micstec.com/data', command)
            self.assertEqual(command[-2:], ['1', '1360'])

    def test_manual_lyrics_are_not_replaced_or_treated_as_missing_synced_assets(self):
        with sqlite3.connect(self.db) as db:
            db.execute("ALTER TABLE imported_songs ADD COLUMN lyrics_mode TEXT DEFAULT 'synced'")
            db.execute("UPDATE imported_songs SET lyrics_mode = 'manual' WHERE id = 1360")
        (self.imports / 'synced/link.1360.lrc').unlink()
        out = Path(self.temp.name) / 'synced-output'
        env = {**os.environ, 'DATA_DIR': self.temp.name, 'DIG_MUSIC_DIR': str(self.imports), 'MUSIC_DIR': str(self.legacy)}
        result = subprocess.run([sys.executable, str(Path(__file__).parent / 'karaoke/fetch_synced_lyrics.py'),
                                 '--lyrics-dir', str(self.legacy / 'lyrics'), '--out-dir', str(out),
                                 '--ids', '1360', '--force'], env=env, capture_output=True, text=True, check=True)
        self.assertIn('preserving manual, non-synced lyrics', result.stdout)
        self.assertIn('errors=0', result.stdout)
        self.assertFalse((out / 'link.1360.lrc').exists())
        self.assertEqual(self.library.lyrics(1360).read_text(), 'Exact title\nWords\n')


if __name__ == '__main__':
    unittest.main()
