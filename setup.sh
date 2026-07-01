#!/usr/bin/env bash
# One-time setup: Python 3.11 venv + bridge deps + LeapC Python bindings.
# Run the Ultraleap tracking software installer (https://leap2.ultraleap.com/) FIRST —
# the LeapC bindings build against the LeapC library it installs.
set -euo pipefail
cd "$(dirname "$0")"                      # repo root
ROOT="$(pwd)"                             # leapc-python-bindings lives at the repo root

# Python 3.12 — the Ultraleap macOS SDK ships a prebuilt leapc_cffi for cpython-312,
# so matching 3.12 means the LeapC binding needs NO compilation.
PY="${PYTHON:-python3.12}"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "ERROR: $PY not found. Install Python 3.12 (brew install python@3.12) or set PYTHON=/path/to/python3.12"
  exit 1
fi

echo "→ venv (.venv) with $($PY --version)"
# A venv is not relocatable: its scripts (pip/activate) hardcode absolute paths.
# If .venv was created elsewhere (repo moved/renamed), its pip shebang points at a
# stale path → "bad interpreter". Detect that by comparing the embedded path and
# recreate, instead of reusing a broken venv.
if [ -d .venv ] && ! head -1 .venv/bin/pip 2>/dev/null | grep -q "$(pwd)/.venv/"; then
  echo "  (stale/moved venv — recreating)"
  chmod -R u+w .venv 2>/dev/null || true
  if ! rm -rf .venv 2>/dev/null; then
    echo "ERROR: could not remove .venv (root-owned files inside — likely libusb)."
    echo "  Run:  sudo rm -rf .venv  &&  ./setup.sh"
    exit 1
  fi
fi
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q -U pip
echo "→ bridge deps (websockets, python-osc)"
.venv/bin/pip install -q -r bridge/requirements.txt

echo "→ LeapC Python bindings (ultraleap/leapc-python-bindings)"
BIND="$ROOT/leapc-python-bindings"
if [ ! -d "$BIND" ]; then
  git clone --depth 1 https://github.com/ultraleap/leapc-python-bindings "$BIND"
fi
.venv/bin/pip install -q -r "$BIND/requirements.txt" || true
if .venv/bin/pip install -e "$BIND/leapc-python-api"; then
  echo "→ leapc bindings installed"
else
  echo "WARNING: leapc bindings failed to build."
  echo "  Likely cause: Ultraleap tracking software not installed yet, or LeapC not found."
  echo "  Install from https://leap2.ultraleap.com/ (Controller 2, macOS) then re-run ./setup.sh"
fi

echo "→ PS Eye support (optional; PlayStation Eye IR camera)"
if command -v brew >/dev/null 2>&1; then
  # pseyepy links libusb via cffi and its __init__ imports its ui module (tkinter).
  brew list libusb          >/dev/null 2>&1 || brew install libusb
  brew list python-tk@3.12  >/dev/null 2>&1 || brew install python-tk@3.12
  # libusb is keg-only: put its headers/libs on the compiler search path so the
  # pseyepy C extension finds <libusb-1.0/libusb.h> and links libusb-1.0.
  LIBUSB="$(brew --prefix libusb)"
  export CPATH="$LIBUSB/include${CPATH:+:$CPATH}"
  export LIBRARY_PATH="$LIBUSB/lib${LIBRARY_PATH:+:$LIBRARY_PATH}"
else
  echo "  (no brew — skipping libusb/python-tk prereqs; PS Eye may not import)"
fi
if .venv/bin/pip install -q -r bridge/requirements-pseye.txt; then
  echo "  PS Eye deps installed"
else
  echo "  WARNING: PS Eye deps failed (optional) — bridge still works for MOUSE/LEAP IR/TUIO"
fi

echo "→ verify"
.venv/bin/python -c "import leap; print('  leap import OK')" 2>/dev/null \
  || echo "  leap NOT importable yet (install Ultraleap software, then re-run setup) — bridge still works for MOUSE/TUIO"
.venv/bin/python -c "import pseyepy; print('  pseyepy import OK')" 2>/dev/null \
  || echo "  pseyepy NOT importable (optional — only needed for the PS EYE source)"
echo "done. Next: ./spike.sh  (Phase 0 gate)  then  ./run.sh"
