#!/usr/bin/env bash
# Run the installation: bridge (Leap IR images + touches→TUIO UDP:3333) + static server.
# Bridge is killed automatically when you Ctrl+C the server.
# Bridge runs even without the Leap (MOUSE source + TUIO still work).
set -euo pipefail
cd "$(dirname "$0")"
PYV=.venv/bin/python
[ -x "$PYV" ] || { echo "run ./setup.sh first"; exit 1; }

"$PYV" bridge/leap-bridge.py &
BRIDGE=$!
trap 'kill $BRIDGE 2>/dev/null || true' EXIT
echo "bridge PID $BRIDGE  (WS:7681 images+touches, TUIO → 127.0.0.1:3333)"
echo ">>> Open:  http://localhost:8000/"
echo ">>> Pick a source (MOUSE works with no hardware), calibrate, touch. Ctrl+C to stop."
"$PYV" -m http.server 8000
