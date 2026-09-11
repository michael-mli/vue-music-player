#!/usr/bin/env bash
# Install the pinned upstream binary and keep its persistent data outside releases.
set -euo pipefail
VERSION=v1.1.0
ARCHIVE_SHA256=347a519d3ec16e5e943410b931f80bd80f7e3c5bd3c4b42a6036fc9201a8aade
REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_DIR="$HOME/.local/share/mics-music-source"
STAGING_DIR=$(mktemp -d)
trap 'rm -rf "$STAGING_DIR"' EXIT

curl -fsSL --retry 2 --max-time 120 \
  "https://github.com/guohuiyuan/go-music-dl/releases/download/$VERSION/go-music-dl_linux_amd64.tar.gz" \
  -o "$STAGING_DIR/release.tar.gz"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$STAGING_DIR/release.tar.gz" | sha256sum -c -
tar -xzf "$STAGING_DIR/release.tar.gz" -C "$STAGING_DIR" music-dl LICENSE README.md
mkdir -p "$SOURCE_DIR"
install -m 755 "$STAGING_DIR/music-dl" "$SOURCE_DIR/music-dl.next"
mv "$SOURCE_DIR/music-dl.next" "$SOURCE_DIR/music-dl"
install -m 644 "$STAGING_DIR/LICENSE" "$SOURCE_DIR/LICENSE"
install -m 644 "$STAGING_DIR/README.md" "$SOURCE_DIR/README.md"
printf '%s\n' "$VERSION" > "$SOURCE_DIR/VERSION"
pm2 startOrRestart "$REPO_DIR/server/music-source.config.cjs" --only music-source
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 10 \
  http://127.0.0.1:3130/music -o /dev/null
pm2 save
