#!/usr/bin/env bash
# One-time setup: Python venv + TUIO bridge deps (websockets, python-osc).
# Only needed for TUIO output — the app itself runs with just `npm install && npm run dev`.
set -euo pipefail
cd "$(dirname "$0")"                      # repo root

PY="${PYTHON:-python3.12}"
if ! command -v "$PY" >/dev/null 2>&1; then
  PY=python3
fi
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "ERROR: python3 not found. Install Python 3 (brew install python@3.12) or set PYTHON=/path/to/python3"
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
    echo "ERROR: could not remove .venv (root-owned files inside)."
    echo "  Run:  sudo rm -rf .venv  &&  ./setup.sh"
    exit 1
  fi
fi
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q -U pip
echo "→ bridge deps (websockets, python-osc)"
.venv/bin/pip install -q -r bridge/requirements.txt

echo "→ verify"
.venv/bin/python -c "import websockets, pythonosc; print('  bridge deps OK')"
echo "done. Next: ./run.sh"
