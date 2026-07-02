#!/usr/bin/env bash
# Freeze the Python TUIO bridge into a Tauri sidecar binary.
#
# Prereq: the project venv with websockets + python-osc installed
# (the same env that runs bridge/tuio-bridge.py — created by ./setup.sh).
#
# Output: src-tauri/binaries/videoplaster-bridge-<target-triple>
# (named with the Rust host triple, as Tauri sidecars require).
set -euo pipefail

cd "$(dirname "$0")/.."            # -> repo root

VENV="${VENV:-.venv}"
TRIPLE="$(rustc -vV | sed -n 's/host: //p')"
OUT="src-tauri/binaries"
mkdir -p "$OUT"

# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --quiet pyinstaller

# --paths bridge: resolve `import tuio` (sibling of tuio-bridge.py).
python -m PyInstaller --onefile --name videoplaster-bridge \
  --distpath "$OUT" \
  --workpath build/pyi --specpath build/pyi \
  --paths bridge \
  --collect-submodules websockets \
  bridge/tuio-bridge.py

mv -f "$OUT/videoplaster-bridge" "$OUT/videoplaster-bridge-$TRIPLE"
echo "built $OUT/videoplaster-bridge-$TRIPLE"
