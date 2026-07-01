# VIDEOPLASTER 02

**English** · [Español](./README.es.md)

A web-based touch-detection and touch-reactive visual-effects application. It uses IR image processing, GPU-accelerated effects, 4-pin keystone correction, and TUIO output over UDP.

---

## Quick Start

```bash
npm install
./setup.sh        # Python venv (3.12) + LeapC bindings (one-time)
npm run dev       # http://localhost:8000/  (MOUSE source works with no hardware)
./run.sh          # full app: Python bridge (IR + TUIO) + Vite dev server
```

- **`npm run dev`** — frontend only. Use the `MOUSE` source to develop without hardware.
- **`./run.sh`** — frontend + Python bridge (IR frames over WS :7681, TUIO over UDP :3333).

---

## System Requirements

### Hardware
- **Leap Motion Controller 2** *(optional; a `MOUSE` fallback is always available)*
  - Mount 15–30 cm behind the acrylic surface.
  - IR reflections from fingers touching the acrylic trigger detection.
  - Rear-projection compatible (the IR-pass filter blocks visible projector light).

### Software
- **macOS** (Apple Silicon or Intel)
- **Node.js** 18+ and **npm**
- **Python 3.12** — the Ultraleap SDK ships a prebuilt `leapc_cffi` for 3.12, avoiding compilation.
  ```bash
  brew install python@3.12
  ```
- **Ultraleap Tracking Software v6.2.0+** — download from https://leap2.ultraleap.com/ (select *Leap Motion Controller 2*), install, and run the tracking service.

---

## Installation

```bash
# 1. Install the Ultraleap Tracking Software (see link above) and launch the service.

# 2. Verify Python 3.12
python3.12 --version            # Python 3.12.x  (brew install python@3.12 if missing)

# 3. Clone & set up
git clone <repo-url>
cd <repo>
npm install                     # Node dependencies
./setup.sh                      # .venv + LeapC bindings + websockets + python-osc
./check-leap.sh                 # must print: DEVICE(S) CONNECTED
```

---

## Project Structure

The frontend is a **Vite + vanilla TypeScript** app (no framework), organized by feature. The backend is a small **Python bridge**; an optional **Tauri** shell packages it as a desktop app.

```
.                               # repo root
├── index.html                  # entry: a single <div id="ui"> + loads src/core/app.ts
├── styles/                     # extracted CSS
│   ├── tokens.css              # design tokens (colors, sizes, fonts as CSS variables)
│   ├── base.css                # reset, page shell, canvases
│   └── ui.css                  # control-panel styles
├── src/
│   ├── core/                   # bootstrap + render pipeline
│   │   ├── app.ts              # ~110-line bootstrap: mount panel, wire controllers, start loop
│   │   ├── render-loop.ts      # per-frame pipeline (bg → effect → warp → overlay)
│   │   └── background.ts       # image/video background layer
│   ├── config/                 # declarative configuration
│   │   ├── controls.ts         # the control panel described as data
│   │   └── defaults.ts         # single source of truth for detection/canvas defaults
│   ├── types/                  # domain model (domain / effect / settings + barrel)
│   ├── ui/                     # UI layer
│   │   ├── control-factory.ts  # reusable DOM builders (Slider / Checkbox / Section …)
│   │   ├── controls-panel.ts   # builds #ui from config/controls.ts
│   │   ├── effect-controller.ts + effect-param-panel.ts   # effect selection + params
│   │   ├── pin-controller.ts   # corner-pin overlay, drag + arrow-key nudge
│   │   ├── ir-calibrator.ts    # IR preview + ROI calibration
│   │   ├── overlay.ts          # keyboard layer + calibration grid
│   │   └── persist.ts          # localStorage + typed control binding
│   ├── gl/                     # WebGL primitives
│   │   ├── gl-util.ts          # shader/program/quad/texture helpers
│   │   ├── base-effect.ts      # shared effect scaffolding (FBO, textures, setBackground)
│   │   ├── warp-gl.ts          # 4-pin keystone perspective correction
│   │   └── homography.ts       # camera ↔ surface coordinate mapping
│   ├── effects/                # 6 touch-reactive effects + registry
│   │   ├── registry.ts         # EFFECTS list (order = number-key index)
│   │   └── water/ink/reveal/thermal/shatter/particles-gl.ts
│   ├── sources/                # touch sources + registry
│   │   ├── touch-source.ts     # base + MouseTouchSource
│   │   ├── ir-source.ts        # IR provider → pipeline
│   │   ├── leap-z-source.ts    # Leap hand tracking (Z threshold)
│   │   ├── source-manager.ts + source-registry.ts   # source switching
│   │   └── output.ts           # TouchEmitter → bridge
│   ├── ir/                     # IR detection pipeline
│   │   ├── pipeline.ts         # gray frame → tracked touches
│   │   ├── provider.ts / ws-frame-provider.ts / camera-frame-provider.ts
│   │   ├── blobs.ts / tracking.ts / preprocess.ts / undistort.ts
│   └── util/                   # math.ts (clamp, …)
├── bridge/                     # Python backend: WS :7681 (IR) + TUIO UDP :3333
├── src-tauri/                  # Tauri desktop shell (see "Standalone macOS App")
└── vite.config.ts / tsconfig.json / package.json
```

### Data flow

1. **IR capture** — the Python bridge reads raw IR frames from LeapC and sends `(width, height, grayscale)` over WebSocket :7681.
2. **Image processing** (`src/ir/`) — background subtraction → blur/erosion → blob detection → optional fisheye undistortion.
3. **Tracking** (`ir/tracking.ts`) — temporal proximity matching (`maxDist = 0.08`) emits `down` / `move` / `up` touch events.
4. **Mapping** (`gl/homography.ts`, `ir/pipeline.ts`) — camera pixels → normalized surface UV `[0,1]`, with a capture ROI.
5. **Render & output** — the active effect reacts to touches; `gl/warp-gl.ts` applies keystone correction; `sources/output.ts` broadcasts TUIO to UDP :3333.

---

## Effects

Six touch-reactive GPU effects, selectable from the **EFFECT** dropdown or with **number keys 1–6**:

| Key | Effect | Description |
|-----|--------|-------------|
| 1 | **WATER** | Wave-equation ripples that distort the background |
| 2 | **INK BLOOM** | Navier-Stokes-lite fluid ink that swirls and flows |
| 3 | **EROSION REVEAL** | Touch erodes a cover layer to reveal the background |
| 4 | **THERMAL HEAT** | Heat diffuses and cools, tinted with a thermal palette |
| 5 | **SHATTER GLASS** | Procedural voronoi shards crack where touched |
| 6 | **PARTICLE CHAOS** | GPU particles pushed by touch and curl-noise |

Each effect exposes its own tunable parameters (built dynamically under the dropdown) and persists them per effect.

---

## Sources & Calibration

Pick a source from the **SOURCE** dropdown:

- **MOUSE** — develop without hardware.
- **LEAP IR** — IR blob detection through the Leap (primary; needs the bridge).
- **PS EYE** — PlayStation Eye IR camera via the bridge *(optional; see Tauri section)*.
- **IR CAMERA** — a generic IR webcam via `getUserMedia`.
- **LEAP Z** — Leap hand tracking + Z threshold (backup).

**LEAP IR / IR CAMERA calibration:**
1. **CAPTURE BG** — with nothing touching the surface, store an empty frame for background subtraction.
2. **Calibrate the ROI** — drag the 4 corner handles on the IR preview to match the acrylic bounds.
3. **Tune detection** — `THRESHOLD` (blob brightness), `MIN/MAX AREA` (pixel-count filter), `BLUR` / `EROSION` (denoise), `MIRROR X/Y` (flip), `FISHEYE` + `K1/K2` (lens correction).
4. **Point your TUIO client** at `127.0.0.1:3333`.

---

## Commands

```bash
npm run dev            # dev server with HMR (http://localhost:8000/)
npm run build          # production bundle → dist/
npm run preview        # serve dist/ locally
npm run typecheck      # TypeScript strict type-check
npm test               # tsc + 45 unit tests (node --test)
./run.sh               # bridge + dev server together
./check-leap.sh        # verify the Leap device is connected
./spike.sh             # Phase 0: raw IR proof-of-concept

.venv/bin/python -m pytest bridge/test_tuio.py -q   # 3 TUIO encoding tests
```

The **45 unit tests** cover the pure logic: background, blobs, homography, IR pipeline/preprocess/provider, IR source, Leap-Z, touch source, tracking, UI overlay, warp, and the effect registry.

---

## Controls & Keyboard

### UI panel
- **FIT SCREEN** — canvas fills the viewport (overrides manual width/height).
- **TEST GRID** — overlay the calibration grid + corner anchors.
- **RESET ANCHORS** — set all 4 pins back to zero offset.
- **CANVAS** — manual width/height sliders.
- **SOURCE** — MOUSE / LEAP IR / PS EYE / IR CAMERA / LEAP Z.
- **IMAGE** — load a background image/video; scale X/Y; rotate.
- **EFFECT** — pick 1 of 6 effects; tune its parameters.
- **PINS** — per-corner X/Y offsets (keystone correction).
- **IR DETECT** — threshold, area, blur, erosion, mirror, fisheye K1/K2.

### Keyboard (projection mode)
- **H** — hide/show the UI panel
- **F** — toggle fullscreen · **Esc** — exit fullscreen + show UI
- **1–6** — select effect
- **G** — toggle the calibration grid
- **Click a corner pin**, then **arrow keys** to nudge ±1px (**Shift** = ±10px)

---

## Configuration

### Local storage
Control values (sliders, checkboxes, ROI, active effect) persist to `localStorage` under key `vp_settings`.
```javascript
localStorage.getItem('vp_settings')     // view all settings as JSON
localStorage.removeItem('vp_settings')  // reset to defaults
```

### TUIO output
- **Protocol**: TUIO 1.1 (binary OSC bundles) · **Port**: UDP 3333
- **Messages**: `/tuio/2Dcur` (touches), `/tuio/fseq` (frame sequence)
- **Clients**: TUIO Mouse, Max/MSP, Processing, or any OSC listener

### Mounting notes
- Mount the Leap ~15–30 cm behind the acrylic so fingers are in focus.
- The IR-pass filter blocks the projector's visible light → no pollution.
- Use stable USB power (avoid brownouts).

---

## Standalone macOS App (Tauri)

The app can ship as a double-clickable `.app` that bundles the Leap bridge and runs the WebGL frontend fullscreen. The frontend is unchanged — it still talks to the bridge over `ws://localhost:7681`; Tauri only owns the window and the bridge process lifecycle.

```bash
npm run tauri:dev        # vite + webview; backend spawns the bridge sidecar
npm run build-bridge     # freeze bridge with PyInstaller → src-tauri/binaries/…
npm run tauri:build      # vite build + .app + .dmg (host arch)
```

The bridge supports `--device leap|pseye|none` (default `leap`); the frontend also switches the device live via a WS control message. **PS Eye support is optional** (the bridge guards the imports):
```bash
brew install libusb
.venv/bin/pip install -r bridge/requirements-pseye.txt   # cython + numpy + pseyepy
```

For signing/notarization, set the Developer ID identity in `tauri.conf.json` and export `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`.

---

## Troubleshooting

**No IR image (Phase 0)** — confirm the Ultraleap service is running, `./check-leap.sh` prints `DEVICE(S) CONNECTED`, the Controller 2 USB is plugged in, and `./setup.sh` installed the Python 3.12 bindings.

**Bridge connection fails** — run `.venv/bin/python bridge/leap-bridge.py` and watch stderr for LeapC errors; reconnect USB + restart the Ultraleap service.

**TUIO not arriving** — verify the client listens on `127.0.0.1:3333`, the firewall isn't blocking UDP 3333 (`sudo lsof -i :3333`), and the bridge logs "TUIO sender ready".

**Touches not detected (LEAP IR)** — click **CAPTURE BG** first; raise `THRESHOLD` if too many blobs; lower `MIN AREA` for small touches; toggle **MIRROR X/Y** if the image is flipped.

**Low FPS** — reduce blur / detection work; profile with Chrome DevTools (Performance).

---

## Technology Stack

- **Frontend**: TypeScript 5.7, Vite 6, WebGL (effects + keystone warp), zero runtime dependencies
- **Backend**: Python 3.12, LeapC FFI, websockets, python-osc
- **Desktop**: Tauri 2 (optional macOS `.app`)
- **Testing**: Node native test runner (`--experimental-strip-types`)
- **Communication**: WebSocket (IR frames), UDP/OSC (TUIO touches)

---
## Links

- [Leap Motion Controller 2](https://leap2.ultraleap.com/) · [LeapC Python bindings](https://github.com/ultraleap/leapc-python-bindings)
- [TUIO 1.1 Protocol](http://www.tuio.org/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/docs/)
