#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/mli/others/vue-music-player}"
PYTHON_BIN="${CATEGORY_PYTHON:-python3}"

echo "== automatic category profiling started =="
exec "$PYTHON_BIN" "$REPO_DIR/scripts/profile_categories.py"
