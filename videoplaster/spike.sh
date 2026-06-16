#!/usr/bin/env bash
# Phase 0 GATE: prove this Gemini exposes raw IR images via LeapC.
# Starts the spike (Leap IR → WS:7681) + a static server, then open the viewer.
# Needs: Ultraleap tracking software running + ./setup.sh done.
set -euo pipefail
cd "$(dirname "$0")"
PYV=.venv/bin/python
[ -x "$PYV" ] || { echo "run ./setup.sh first"; exit 1; }

if ! "$PYV" -c "import leap" 2>/dev/null; then
  echo "ERROR: python 'leap' module not importable."
  echo "  → Install Ultraleap software (https://leap2.ultraleap.com/) and run ./setup.sh"
  exit 1
fi

"$PYV" spike/leap-image-spike.py &
SPIKE=$!
trap 'kill $SPIKE 2>/dev/null || true' EXIT
echo "spike PID $SPIKE  (IR frames → ws://localhost:7681)"
echo ">>> Open:  http://localhost:8000/spike/spike.html"
echo ">>> See a live IR image (hand = bright)? Gate PASSED — record size/fps in README."
echo ">>> Nothing / error? Gemini does not expose images → use LEAP Z or rethink. Ctrl+C to stop."
"$PYV" -m http.server 8000
