"""Install an isolated official Chrome for Testing binary in the current user cache."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version', help='Pin a published Chrome for Testing version; default: official stable manifest')
args = parser.parse_args()
if args.version and not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', args.version):
    parser.error('Version must have four numeric components')
manifest_url = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'
with urllib.request.urlopen(manifest_url, timeout=15) as response:
    manifest = json.load(response)
stable = manifest['channels']['Stable']
version = args.version or stable['version']
assert re.fullmatch(r'\d+\.\d+\.\d+\.\d+', version)
url = (next(item['url'] for item in stable['downloads']['chrome'] if item['platform'] == 'linux64')
       if version == stable['version'] else
       f'https://storage.googleapis.com/chrome-for-testing-public/{version}/linux64/chrome-linux64.zip')
assert url == f'https://storage.googleapis.com/chrome-for-testing-public/{version}/linux64/chrome-linux64.zip'
base = Path.home() / '.cache' / 'ktv-party-cft'
base.mkdir(mode=0o700, parents=True, exist_ok=True)
assert not base.is_symlink()
destination = base / version
stage = Path(tempfile.mkdtemp(prefix='ktv-cft-download.', dir=base))
try:
    if not destination.exists():
        archive = stage / 'chrome.zip'
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(url, timeout=30) as response, archive.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                assert size <= 300 * 1024 * 1024, 'Unexpected download size'
                output.write(chunk)
                digest.update(chunk)
        with zipfile.ZipFile(archive) as bundle:
            for item in bundle.infolist():
                p = Path(item.filename)
                assert p.parts[0] == 'chrome-linux64' and not p.is_absolute() and '..' not in p.parts
                assert (item.external_attr >> 16) & 0o170000 != 0o120000, 'Unexpected archive symlink'
            bundle.extractall(stage / 'unpacked')
        unpacked = stage / 'unpacked' / 'chrome-linux64'
        for name in ['chrome', 'chrome_crashpad_handler', 'chrome_sandbox']:
            p = unpacked / name
            if p.exists():
                p.chmod(0o700)
        unpacked.joinpath('ktv-download.json').write_text(json.dumps({
            'version': version, 'manifestTimestamp': manifest['timestamp'],
            'url': url, 'bytes': size, 'archiveSha256': digest.hexdigest(),
        }) + '\n')
        unpacked.joinpath('ktv-download.json').chmod(0o600)
        os.replace(unpacked, destination)
        destination.chmod(0o700)
    executable = destination / 'chrome'
    observed = subprocess.run([str(executable), '--version'], check=True, timeout=15,
                              capture_output=True, text=True).stdout.strip()
    assert version in observed, 'Binary version disagrees with pinned manifest'
    metadata = json.loads(destination.joinpath('ktv-download.json').read_text())
    print(json.dumps({'binary': str(executable), 'observedVersion': observed,
                      'archiveSha256': metadata['archiveSha256'], 'bytes': metadata['bytes']}))
finally:
    shutil.rmtree(stage)
