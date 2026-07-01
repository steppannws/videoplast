# VIDEOPLASTER — Touch Installation Rebuild — Design

**Date:** 2026-06-16
**Author:** Stepan (with Claude)
**Status:** Draft for review (rev 2 — Leap-as-IR-camera pivot)

## Context

Interactive art installation ("Videoplaster 01", Armando Frezze Durand). Physical setup is
already mounted:

- **Surface:** white acrylic, medium size (30–80 cm).
- **Geometry:** rear projection — projector behind the acrylic; sensor also behind.
- **Sensor in hand:** Leap Motion **Controller 2 (Gemini / Ultraleap)**. No separate IR camera / IR LEDs.

Goal: detect when a user **touches** the acrylic and (a) render a water/ripple effect at the
touch point that gets projected, and (b) emit the touches as **TUIO** so external apps
(TUIO Mouse, reacTIVision-style clients) can consume them.

An existing prototype (`videoplaster01_v11.html`, 831 lines, single file) tries blob detection +
MediaPipe + Leap hand-tracking + an external Python WebSocket all at once. It does not work reliably.

### Why the prototype fails (root causes)

1. **Three detectors run simultaneously**, none tuned; they fight.
2. **A plain RGB webcam cannot distinguish touch from hover.** Shadow size is only a weak proxy.
3. **Recursive camera-start bug** (`startCam` calls itself via `populateCams().then(...)`).
4. **CPU water sim at full resolution** (≈ 800k px/frame in JS + `getImageData`/`putImageData`) → lag.
5. **Dead dependency** on a Python process at `ws://localhost:8766` that is not included.

## The approach: Leap as an IR camera (no depth)

A Leap **cannot hand-track through a diffuse acrylic** — but it physically *is* a stereo IR camera
(2× ~640×240 grayscale), 3× 850 nm IR LEDs, and an **IR-pass filter**. Mounted **behind** the
acrylic, it becomes a complete rear-DI rig in one device:

- **The IR-pass filter rejects the projector.** The projector emits visible light; the Leap cameras
  only see IR → the projected image does not pollute the IR image. This is exactly why pro DI tables
  use IR. Free, and the key enabler.
- **A finger near the acrylic reflects the Leap's IR back** → bright blob (rear DI). Touch = bright/large;
  hover = dim. A brightness/size threshold yields a usable touch signal — better than front-DI shadows.
- **No depth.** Pure 2D IR image → blob detection (CCV-style) → homography → touches.

Z-based hand tracking is kept as a **secondary, pluggable backup** source for comparison.

### Critical feasibility risk (drives Phase 0)

Gemini's tracking WebSocket (`:6437`) does **not** stream images. Raw IR images are only available
via the native **LeapC** API (`eLeapPolicyFlag_Images` → `LeapImageEvent`), reached from Python via
Ultraleap's `leapc-python-bindings`. **It is not guaranteed that the installed Gemini version exposes
raw images** — Ultraleap restricted image access across versions.

**Phase 0 is a feasibility spike:** prove Python + LeapC can pull an IR frame from *this* Gemini and
display it in the browser. If it fails, the IR path is dead and we fall back to the Z source. No
other code is written until Phase 0 passes.

### Hardware caveats (if Phase 0 passes)

- **Focus/distance:** Leap optics target ~10–60 cm. Mount it ~15–30 cm behind the acrylic so the
  finger plane is roughly in focus and the IR spreads to cover area.
- **Fisheye distortion** at the edges → correct with the distortion map / radial undistort (reuse
  v11's `buildUndistMap`/`applyUndist` — now justified).
- **IR hotspot center / falloff at edges** → uneven illumination. Mitigate with **background
  subtraction** (capture an empty-surface IR frame, subtract → only new reflections = fingers) and
  an adaptive threshold.
- **Coverage** scales with mount distance; covering 80 cm may push the Leap far back, costing resolution.

## Goals

- One clean, pluggable `TouchSource` abstraction; exactly one source active at a time.
- `LeapImageSource` (primary): Leap IR image → background subtraction → blob detection → camera→surface
  homography → persistent-id touches.
- `LeapZSource` (backup): the legacy hand-tracking + Z-threshold path, kept selectable.
- `MouseTouchSource` for developing without hardware.
- GPU ping-pong water effect at solid 60 fps, distorting an optional background image/video.
- Projection keystone/corner-pin warp (reuse the existing homography) to align output to the acrylic.
- Real **TUIO 1.1 over UDP** output.
- Served as a small multi-file static project via a local HTTP server, plus one Python helper.

## Non-goals (YAGNI)

- MediaPipe hands (removed).
- A separate dedicated IR camera/LED rig (the Leap *is* the IR camera now).
- Multi-machine / network sync beyond the local helper.
- Stereo eye selection beyond "use the left image" (no 3D from the two images).

## Architecture

```
Leap Service ──(LeapC, native)──▶ [Python helper: leap-bridge.py]
                                   │  • enables image policy, grabs left IR frame
                                   │  • WS server :7681  ── IR frames (binary) ──▶ Browser
                                   │  • WS also receives detected touches  ◀── Browser
                                   └─ emits TUIO 1.1 ──udp:3333──▶ TUIO clients (python-osc)

Leap Service ──ws:6437 (tracking)──▶ [Browser]  (only for LeapZSource backup)

[Browser App]
  ├─ TouchSource: LeapImageSource (primary) | LeapZSource (backup) | MouseTouchSource
  ├─ Calibration: camera→surface homography (4-corner) + background frame
  ├─ WaterGL (ping-pong sim, consumes touches)
  ├─ WarpGL  (homography → projector quad)
  └─ sends each TouchEvent back to leap-bridge.py for TUIO out
```

**One Python helper does three jobs** — serve IR frames to the browser, receive detected touches,
emit TUIO UDP — so the install has a single helper process to start (plus the static server). This
folds the previously-separate Node TUIO bridge into Python (we need Python for LeapC anyway;
`python-osc` handles TUIO). One fewer runtime to manage on-site.

### Normalized event (the contract every source emits)

```js
TouchEvent = {
  id:       Number,   // stable per-finger/blob id (down → move → up share one id)
  x:        Number,   // [0,1] surface space, left→right
  y:        Number,   // [0,1] surface space, top→bottom
  z:        Number,   // mm above plane (Z source) or 0 (image source); informational
  strength: Number,   // [0,1]: blob brightness/size (image) or 1-z/thresh (Z); drives ripple amplitude
  state:    'down' | 'move' | 'up'
}
```

All consumers (water, TUIO) only ever see this shape. Sources are interchangeable.

## Modules

### `js/touch-source.js`
- `TouchSource` base: `start()`, `stop()`, `onTouch(cb)`, `name`.
- `MouseTouchSource`: canvas mouse/touch → surface UV → down/move/up. No hardware.

### `js/leap-image-source.js`  (primary)
- `LeapImageSource extends TouchSource`.
- Connects the Python helper WS (`ws://localhost:7681`); receives binary IR frames (raw grayscale +
  width/height header). Reconstructs into an offscreen canvas.
- **Calibration** (`ImageCalibration`):
  - Optional radial **undistort** (reuse `buildUndistMap`/`applyUndist`, K1/K2 sliders).
  - **Background subtraction:** "capturar fondo" button stores an empty-surface IR frame; each frame
    subtracts it before thresholding.
  - 4-corner **homography** camera-px → surface `[0,1]²` (reuse `computeH`/`inv3`/`gaussElim`).
  - Persist calibration (corners, K1/K2, background) to `localStorage`.
- **Blob pipeline** (reuse v11, it is sound): `boxBlur` → threshold → `morphErode`/`morphDilate` →
  connected-components `findBlobs`. Blob centroid → homography → surface UV.
- **Touch logic + ID tracking:** nearest-neighbour centroid matching across frames assigns stable
  ids; new blob = `down`, matched = `move`, lost = `up`. `strength` from blob mean-brightness/area
  (proxy for touch pressure/closeness). Threshold sliders tune touch-vs-hover.

### `js/leap-z-source.js`  (backup)
- `LeapZSource extends TouchSource` — the legacy path. Connects `ws://localhost:6437` (Gemini
  tracking), parses `hands[].fingers[].bones[]` (reuse `extractFingersGemini`). Needs a plane + Z
  threshold; emits the same `TouchEvent`. Selectable from the UI for A/B comparison.

### `js/water-gl.js`
- `WaterGL` — GPU ping-pong height field.
  - Two textures `heightPrev`/`heightCur` (float via `OES_texture_float`/`half_float`; RGBA-packing
    fallback + warning if unsupported).
  - **Update pass** (wave eq): `next = (left+right+up+down)/2 - prev`, then `*damping` (viscosity slider).
  - **Drop injection:** additive splat (radius, `strength`-scaled) at each touch UV.
  - **Render pass:** height gradient → UV offset into the background media texture; brightness from
    |height|. Output feeds the warp pass.
  - Sim at a fixed grid (e.g. 512×320), independent of display size.

### `js/warp-gl.js`
- `WarpGL` — fullscreen inverse-homography pass mapping the rendered surface onto the projector quad
  (4 draggable pins). **Reuse v11's shaders + pin UI verbatim.** Persist pins to `localStorage`.

### `js/output.js`
- `TouchEmitter` — sends each `TouchEvent` as JSON to the Python helper (`ws://localhost:7681`) for
  TUIO out. Reconnect with backoff (not v11's tight loop).

### `bridge/leap-bridge.py`  (Python helper — single process)
- LeapC via `leapc-python-bindings`; enable `eLeapPolicyFlag_Images`; per frame grab the left IR
  image (raw grayscale bytes + dimensions).
- **WS server on `:7681`** (`websockets` pkg): pushes IR frames (binary) to the browser; receives
  detected `TouchEvent` JSON back.
- **TUIO 1.1 out** (`python-osc`): translate received touches to `/tuio/2Dcur` (`source`/`alive`/
  `set`/`fseq`) bundles → UDP `127.0.0.1:3333` (configurable). `id`→session id; `x,y` pass through.
- `requirements.txt`; run with `python leap-bridge.py`.

### `js/app.js`
- Orchestrates: source dropdown (Leap-IR / Leap-Z / Mouse), calibration UI (corners, undistort,
  capture-background, threshold/area/morph sliders), the trimmed control panel (canvas size, water
  params, pins), and the render loop (`source touches → water → warp → present`), wiring touches to
  both `WaterGL` and `TouchEmitter`.

## Data flow (per frame)

1. **Leap-IR mode:** `leap-bridge.py` pushes an IR frame → `LeapImageSource` runs undistort →
   background-subtract → blob pipeline → homography → id-tracking → `TouchEvent[]`.
   (**Leap-Z / Mouse modes** produce the same events from their own inputs.)
2. Each event → `WaterGL.addDrop(x,y,strength)` **and** → `TouchEmitter.send(event)` → `leap-bridge.py`
   → TUIO UDP.
3. `WaterGL` update pass, swap textures.
4. `WaterGL` render pass distorts background media → texture.
5. `WarpGL` maps that texture onto the projector quad (4 pins).
6. `requestAnimationFrame` repeats; detection may run every other frame for perf.

## Error handling

- Helper down / images unavailable: `LeapImageSource` shows clear status; water still works via Mouse.
- Float textures unsupported: packed-RGBA fallback + warning.
- TUIO target unreachable: UDP is fire-and-forget; never blocks rendering.
- No calibration yet: source emits nothing; UI says "calibrá las 4 esquinas / capturá el fondo".
- `file://`: show the "serve over http" instruction (reuse v11's warning).

## File layout

```
videoplaster/
  index.html
  js/app.js
  js/touch-source.js       # base + MouseTouchSource
  js/leap-image-source.js  # primary: IR image → blobs → homography
  js/leap-z-source.js      # backup: hand-tracking + Z
  js/water-gl.js           # GPU ping-pong water
  js/warp-gl.js            # projection homography (from v11)
  js/output.js             # TouchEmitter (→ Python helper)
  bridge/leap-bridge.py    # LeapC images + WS + TUIO UDP
  bridge/requirements.txt
  README.md                # run steps, mounting notes, Phase 0 result
```

## How to run

1. `cd bridge && pip install -r requirements.txt && python leap-bridge.py`
   (Leap image WS on :7681, TUIO out on UDP :3333). Requires the Ultraleap Gemini service running.
2. From the project root: `python3 -m http.server 8000`.
3. Open `http://localhost:8000/` in Chrome.
4. Select source **Leap-IR**; capture background; calibrate the 4 corners.
5. Point a TUIO client (TUIO Mouse) at `127.0.0.1:3333`.

## Implementation phases (for the plan)

- **Phase 0 — Feasibility spike (gate):** minimal `leap-bridge.py` + a bare HTML page that shows the
  live Leap IR image. Proves images are reachable on this Gemini. **If this fails, stop the IR path.**
- **Phase 1 — Pipeline scaffold:** project structure, `TouchSource` base, `MouseTouchSource`, GPU
  water, warp reuse, TUIO out via the helper. Fully testable with the mouse + a TUIO listener.
- **Phase 2 — LeapImageSource:** wire IR frames into undistort → background subtraction → blobs →
  homography → id-tracking. Calibration UI.
- **Phase 3 — Tuning + LeapZSource backup + README:** threshold/area/morph tuning on the physical rig,
  add the Z backup source, document mounting distance and the Phase 0 outcome.

## Testing strategy

- `MouseTouchSource` exercises the whole pipeline (water + TUIO) with no hardware.
- TUIO: verify with a standard client that `2Dcur` alive/set/fseq arrive on :3333 with correct ids
  and `[0,1]` coords.
- Calibration: tap-4-corners, capture background, verify a known physical point maps near its UV.
- Water: visual — drops at touch points, ripples propagate, 60 fps (perf counter in UI).
