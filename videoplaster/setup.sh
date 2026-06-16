#!/usr/bin/env bash
# One-time setup: Python 3.11 venv + bridge deps + LeapC Python bindings.
# Run the Ultraleap tracking software installer (https://leap2.ultraleap.com/) FIRST —
# the LeapC bindings build against the LeapC library it installs.
set -euo pipefail
cd "$(dirname "$0")"                      # videoplaster/
ROOT="$(cd .. && pwd)"                     # repo root (face-touch/)

PY="${PYTHON:-python3.11}"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "ERROR: $PY not found. Install Python 3.11 (brew install python@3.11) or set PYTHON=/path/to/python3.11"
  exit 1
fi

echo "→ venv (.venv) with $($PY --version)"
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

echo "→ verify"
.venv/bin/python -c "import leap; print('  leap import OK')" 2>/dev/null \
  || echo "  leap NOT importable yet (install Ultraleap software, then re-run setup) — bridge still works for MOUSE/TUIO"
echo "done. Next: ./spike.sh  (Phase 0 gate)  then  ./run.sh"
