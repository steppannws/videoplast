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

# Collect only the optional device packages that are actually installed, so the
# sidecar builds whether or not Leap/PS-Eye support is present in this venv.
# (leap = LeapC + libLeapC; pseyepy+numpy = PS Eye, from bridge/requirements-pseye.txt.)
OPT_FLAGS=()
for pkg in leap pseyepy numpy; do
  if python -c "import $pkg" 2>/dev/null; then
    OPT_FLAGS+=(--collect-all "$pkg")
  else
    echo "→ note: '$pkg' not installed; sidecar built without it"
  fi
done

# --paths bridge: resolve `import tuio`/`import ir_device` (siblings of leap-bridge.py).
python -m PyInstaller --onefile --name videoplaster-bridge \
  --distpath "$OUT" \
  --workpath build/pyi --specpath build/pyi \
  --paths bridge \
  "${OPT_FLAGS[@]}" \
  --collect-submodules websockets \
  bridge/leap-bridge.py

mv -f "$OUT/videoplaster-bridge" "$OUT/videoplaster-bridge-$TRIPLE"
echo "built $OUT/videoplaster-bridge-$TRIPLE"

# pseyepy uses libusb via cffi. If PyInstaller does not embed libusb-1.0.dylib,
# copy it next to the binary:  cp "$(brew --prefix libusb)/lib/libusb-1.0.0.dylib" "$OUT/"

# NOTE: if libLeapC.dylib is not embedded by --collect-all, copy it next to the
# binary and ensure the loader path resolves it (install_name_tool / rpath).
