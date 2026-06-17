# VIDEOPLASTER 02

Leap Motion **Controller 2 (Gemini)** mounted **behind** a white acrylic, used as an **IR camera**
(no depth) → touch detection → GPU water effect + **TUIO** output. Rear projection.

Pluggable touch source: **LEAP IR** (primary), **LEAP Z** (backup), **MOUSE** (no hardware).
One Python helper (`bridge/leap-bridge.py`) serves IR frames to the browser (WS :7681), receives
detected touches, and emits TUIO 1.1 over UDP :3333. The browser does all detection + rendering.

## Prerequisites

1. **Ultraleap tracking software** — install FIRST. Controller 2 is supported on macOS
   (incl. Apple Silicon). Get it from **https://leap2.ultraleap.com/** → select *Leap Motion
   Controller 2* → install. This provides the tracking service **and** the `LeapC` library the
   Python bindings build against. (Without it, only the MOUSE source + TUIO work.)
2. **Python 3.12** — the system default here is pyenv 3.7 (too old). 3.12 specifically: the Ultraleap
   macOS SDK ships a **prebuilt `leapc_cffi` for cpython-312**, so matching 3.12 means the LeapC binding
   needs no compilation (just `cffi` at runtime, pulled by `setup.sh`). `setup.sh` builds a `.venv` with
   `python3.12`. Install if missing: `brew install python@3.12`.

## Setup (once)

```bash
cd videoplaster
./setup.sh          # .venv (py3.11) + websockets/python-osc + LeapC bindings
```

`setup.sh` clones `ultraleap/leapc-python-bindings` next to the repo and `pip install -e`'s it into
`.venv`. If the bindings fail to build, the Ultraleap software is not installed yet — install it,
then re-run `./setup.sh`.

## Daily start (on-rig testing)

1. Plug in the **Leap Motion Controller 2** (USB). Confirm the Ultraleap control panel detects it.
2. `./check-leap.sh` → must print **DEVICE(S) CONNECTED**. If it says NO DEVICE, fix USB / control
   panel before going further (the rest can't work without a connected device).
3. `./spike.sh` → Phase 0 gate (below).
4. `./run.sh` → the app.

## Phase 0 — feasibility GATE

It is not guaranteed this Gemini exposes raw IR images via LeapC. Prove it before relying on the IR
path:

```bash
./spike.sh          # starts the IR spike + server
# open http://localhost:8000/spike/spike.html
```

- **Live IR image visible** (a hand shows as bright regions) → **PASS**. Record width×height + fps in
  the "Phase 0 result" section below.
- **Nothing / policy error** → this Gemini does not expose images. Use the **LEAP Z** source instead
  (see caveat), or rethink the sensing approach.

## Run

```bash
./run.sh            # bridge (IR + touches→TUIO udp:3333) + server
# open http://localhost:8000/
```

Pick a source from the dropdown. The bridge auto-stops when you Ctrl+C the server.

## Sources

- **LEAP IR** (primary): IR image → undistort → background subtract → blobs → homography → touches.
- **LEAP Z** (backup): hand tracking + Z threshold (open-air, ~25 cm zone). ⚠ Connects to the legacy
  Leap WebSocket `:6437`, an Orion-era feature. The modern macOS Gemini/Hyperion service may expose
  **only LeapC, not WS :6437** — so this source may not connect. The IR path is the real one.
- **MOUSE**: develop/tune the whole pipeline (water + TUIO) with no hardware.

## Calibration (LEAP IR)

1. **CAPTURAR FONDO** with nothing touching the acrylic (captures the empty IR frame to subtract).
2. **CALIBRAR ESQUINAS**, then click the 4 acrylic corners in the preview.
3. Tune **threshold / area / erosion** so a hover does NOT trigger but a touch does.
4. If fisheye distortion at the edges is bad, enable **undistort** and adjust **K1/K2**.
5. Point a TUIO client (e.g. TUIO Mouse) at `127.0.0.1:3333`.

## Mounting notes

- Mount the Leap **~15–30 cm behind** the acrylic so the finger plane is roughly in focus and the IR
  spreads to cover area.
- The Leap's IR-pass filter rejects the projector's visible light — the projected image does not
  pollute the IR feed.

## Scripts

| Script | Does |
|--------|------|
| `./setup.sh` | venv (py3.12) + deps + LeapC bindings (re-runnable) |
| `./check-leap.sh` | is the service up + a device connected? |
| `./spike.sh` | Phase 0 gate: live IR image in the browser |
| `./run.sh`   | bridge + server for the real app |

## Tests

```bash
npm test                                  # 14 JS unit tests (pure logic)
.venv/bin/python -m pytest bridge/test_tuio.py -q   # 3 TUIO encoding tests
```

## Phase 0 result

- **2026-06-17 (setup, gate pending hardware):** Ultraleap service **v6.2.0** running; LeapC Python
  bindings working on **Python 3.12** (SDK prebuilt cpython-312 cffi); `set_policy_flags([PolicyFlag.Images])`
  accepted. BUT **no Leap device was connected** (`get_server_status` → `devices: []`) → no image events
  yet. GATE PENDING: reconnect the Controller 2, `./check-leap.sh`, then `./spike.sh`.
- **API facts (now baked into spike + bridge):** `PolicyFlag` is in `leap.enums` (not `leap.*`); image
  pixels come from the raw cffi struct `event.image[0]._data` — `.properties.{width,height,bpp}`, `.data`
  (void*), `.offset` — read via `leap.ffi.buffer(cast("uint8_t*", data) + offset, w*h*bpp)`. The Image
  wrapper itself only exposes `matrix_version`.

<!-- after a successful ./spike.sh, record: width×height, bpp, fps -->

