#!/usr/bin/env bash
# Freeze the Python Leap bridge into a Tauri sidecar binary.
#
# Prereqs (hands-on, machine-specific):
#   - The project venv with the Leap bindings + websockets installed
#     (the same env that runs bridge/leap-bridge.py today).
#   - The Ultraleap runtime installed so libLeapC.dylib is resolvable.
#
# Output: src-tauri/binaries/videoplaster-bridge-<target-triple>
# (named with the Rust host triple, as Tauri sidecars require).
set -euo pipefail

cd "$(dirname "$0")/.."            # -> videoplaster/

VENV="${VENV:-.venv}"
TRIPLE="$(rustc -vV | sed -n 's/host: //p')"
OUT="src-tauri/binaries"
mkdir -p "$OUT"

# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --quiet pyinstaller

# --collect-all leap: bundle the cffi-based leap package (incl. libLeapC).
# --paths bridge: resolve `import tuio` (sibling module of leap-bridge.py).
python -m PyInstaller --onefile --name videoplaster-bridge \
  --distpath "$OUT" \
  --workpath build/pyi --specpath build/pyi \
  --paths bridge \
  --collect-all leap \
  --collect-submodules websockets \
  bridge/leap-bridge.py

mv -f "$OUT/videoplaster-bridge" "$OUT/videoplaster-bridge-$TRIPLE"
echo "built $OUT/videoplaster-bridge-$TRIPLE"

# NOTE: if libLeapC.dylib is not embedded by --collect-all, copy it next to the
# binary and ensure the loader path resolves it (install_name_tool / rpath).
