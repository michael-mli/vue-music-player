"""Cover backfill and ingestion checks using only temporary media and a temporary DB."""
import contextlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from music_library import MusicLibrary
from poster_reuse import PosterIndex, title_key, valid_poster
import fetch_posters


class PosterReuseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.legacy = self.root / 'legacy'
        self.imports = self.root / 'imports'
        for folder in (self.legacy, self.imports):
            (folder / 'lyrics').mkdir(parents=True)
            (folder / 'poster').mkdir()
        self.db = self.root / 'auth.db'
        with contextlib.closing(sqlite3.connect(self.db)) as db:
            db.execute('CREATE TABLE imported_songs (id INTEGER,title TEXT,artist TEXT,album TEXT,duration REAL)')
            db.execute("INSERT INTO imported_songs VALUES (1370, '孤城(微醺女声版)', 'Singer', '', 243)")
            db.commit()
        self.library = MusicLibrary(self.legacy, self.imports, self.db)
        self.meta = self.root / 'metadata.json'
        self.meta.write_text('{}')
        self.track(1370, '孤城(微醺女声版)')

    def track(self, sid, title):
        self.library.audio(sid).write_bytes(b'audio')
        self.library.lyrics(sid).write_text(title + '\nLyrics')

    def cover(self, sid, color='red'):
        path = self.library.poster(sid)
        Image.new('RGB', (600, 600), color).save(path, 'JPEG')
        return path.read_bytes()

    def index(self):
        return PosterIndex(self.library, self.meta)

    def run_cli(self, *args):
        with patch.object(fetch_posters, 'library', self.library), \
                patch('sys.argv', ['fetch_posters', '--metadata', str(self.meta), *args]), \
                patch.object(fetch_posters, 'itunes_artwork') as itunes, \
                contextlib.redirect_stdout(io.StringIO()):
            result = fetch_posters.main()
        return result, itunes

    def test_normalization_handles_versions_but_preserves_meaningful_subtitles(self):
        for title in ['《孤城》 (女生版)', '孤城（国风DJ）', '孤城 (Cover Somebody)', '孤城(Live) - Singer']:
            self.assertEqual(title_key(title, versions=True), '孤城')
        self.assertEqual(title_key(' Ｈｅｌｌｏ   World '), 'hello world')
        self.assertEqual(title_key('东方之珠(刘德华，那英)', '刘德华', True), '东方之珠')
        self.assertNotEqual(title_key('Song (Part Two)', versions=True), 'song')
        self.assertNotEqual(title_key('孤城故事', versions=True), '孤城')

    def test_exact_title_prefers_same_artist_and_preserves_donor_bytes(self):
        for sid in [1, 2, 3]:
            self.track(sid, 'Same song')
        self.meta.write_text(json.dumps({'songs': {'1': {'title': 'Same song', 'artist': 'Other'},
                                                     '2': {'title': 'Same song', 'artist': 'Singer'},
                                                     '3': {'title': 'Same song', 'artist': 'Singer'}}}))
        self.cover(1)
        expected = self.cover(2, 'blue')
        index = self.index()
        match = index.find(3)
        self.assertEqual(match['donor_id'], 2)
        self.assertTrue(index.copy(match))
        self.assertEqual(self.library.poster(3).read_bytes(), expected)
        self.assertEqual(self.library.poster(2).read_bytes(), expected)
        self.assertFalse(index.copy(match))

    def test_ingestion_only_scopes_targets_and_reuses_legacy_cover_for_import(self):
        self.track(12, '孤城')
        expected = self.cover(12)
        result, itunes = self.run_cli('--only', '1370')
        self.assertEqual(result, 0)
        itunes.assert_not_called()
        self.assertEqual(self.library.poster(1370).read_bytes(), expected)
        record = json.loads((self.imports / 'poster/_reuse.jsonl').read_text())
        self.assertEqual((record['id'], record['donor_id'], record['match']), (1370, 12, 'base-title'))

    def test_base_title_prefers_an_unqualified_donor_over_another_cover_version(self):
        self.track(1, '孤城(男生版)')
        self.track(12, '孤城')
        self.cover(1)
        self.cover(12)
        self.assertEqual(self.index().find(1370)['donor_id'], 12)

    def test_imported_cover_can_supply_a_legacy_song(self):
        self.track(12, '孤城')
        self.cover(1370)
        self.assertEqual(self.index().find(12)['donor_id'], 1370)

    def test_dry_run_reports_matches_without_writes_or_network(self):
        self.track(12, '孤城')
        self.cover(12)
        report = self.root / 'report.json'
        result, itunes = self.run_cli('--reuse-only', '--dry-run', '--report', str(report))
        self.assertEqual(result, 0)
        itunes.assert_not_called()
        self.assertFalse(self.library.poster(1370).exists())
        self.assertFalse((self.imports / 'poster/_reuse.jsonl').exists())
        self.assertEqual(json.loads(report.read_text())['reused'][0]['donor_id'], 12)

    def test_invalid_donors_and_unpublished_imports_are_not_reused(self):
        self.track(1, '孤城')
        self.library.poster(1).write_bytes(b'<html>Error</html>' * 1000)
        Image.new('RGB', (600, 600)).save(self.imports / 'poster/link.9999.jpg')
        (self.imports / 'lyrics/link.9999.mp3.l').write_text('孤城')
        (self.imports / 'link.9999.mp3').write_bytes(b'orphan')
        self.assertFalse(valid_poster(self.library.poster(1)))
        self.assertIsNone(self.index().find(1370))

    def test_no_substring_match_and_existing_cover_is_preserved(self):
        self.track(1, '孤城故事')
        self.cover(1)
        self.assertIsNone(self.index().find(1370))
        self.track(2, '孤城')
        self.cover(2)
        expected = self.cover(1370, 'blue')
        result, itunes = self.run_cli('--only', '1370')
        self.assertEqual(result, 0)
        itunes.assert_not_called()
        self.assertEqual(self.library.poster(1370).read_bytes(), expected)

    def test_placeholder_titles_cannot_match(self):
        for sid in [1, 2]:
            self.track(sid, 'Artist: Somebody')
        self.cover(1)
        self.assertIsNone(self.index().find(2))

    def test_missing_match_keeps_the_itunes_fallback(self):
        with patch.object(fetch_posters, 'library', self.library), \
                patch('sys.argv', ['fetch_posters', '--metadata', str(self.meta), '--only', '1370']), \
                patch.object(fetch_posters, 'itunes_artwork', return_value=None) as itunes, \
                patch.object(fetch_posters.time, 'sleep'), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fetch_posters.main(), 0)
        itunes.assert_called_once_with('孤城(微醺女声版) Singer')
        self.assertFalse(self.library.poster(1370).exists())


if __name__ == '__main__':
    unittest.main()
