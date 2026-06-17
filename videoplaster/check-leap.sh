#!/usr/bin/env bash
# Quick check: is the Ultraleap service up and is a Leap device connected?
set -euo pipefail
cd "$(dirname "$0")"
PYV=.venv/bin/python
[ -x "$PYV" ] || { echo "run ./setup.sh first"; exit 1; }
"$PYV" - <<'EOF'
import leap
try:
    s = leap.get_server_status(2000)
    print("service version:", s.get("version"))
    devs = s.get("devices", [])
    if devs:
        print(f"DEVICE(S) CONNECTED: {len(devs)} -> {devs}")
        print("READY — run ./spike.sh (Phase 0 gate), then ./run.sh")
    else:
        print("NO DEVICE connected.")
        print("  → Plug in the Leap Motion Controller 2 (USB) and confirm the Ultraleap")
        print("    control panel shows it. Then re-run ./check-leap.sh")
except Exception as e:
    print("ERROR talking to Ultraleap service:", repr(e))
    print("  → Is the Ultraleap tracking service running?")
EOF
