# Videoplaster – Development Guide

Architecture notes for contributors. User-facing docs live in [README.md](README.md).

## Stack

- **Frontend:** Vite 6 + vanilla TypeScript 5.7 (no framework), WebGL1, Canvas 2D.
- **Bridge (optional):** Python 3 (`websockets`, `python-osc`) — WS→TUIO relay only.
- **Desktop shell (optional):** Tauri v2, spawns the frozen bridge as a sidecar.
- **Tests:** `node --test --experimental-strip-types` + `tsc --noEmit` (`npm test`).
  - Note: strip-only mode rejects constructor parameter properties in any module a test imports — assign fields in the constructor body instead.

## Source layout

```
src/
  core/       app.ts (bootstrap/wiring) · render-loop.ts · background.ts
  gl/         warp-gl.ts (two-layer warp render) · quad.ts (mesh math) ·
              homography.ts (H solve/apply) · base-effect.ts · gl-util.ts
  effects/    registry.ts + 6 GPU effects (water, ink, reveal, thermal, shatter, particles)
  ir/         pipeline.ts (frame → touches) · camera-frame-provider.ts (getUserMedia) ·
              preprocess.ts · blobs.ts · tracking.ts · undistort.ts · provider.ts
  sources/    source-registry.ts (mouse | ir-camera) · source-manager.ts ·
              touch-source.ts · ir-source.ts · output.ts (WS touch emitter)
  ui/         pin-controller.ts (warp editor) · ir-calibrator.ts · overlay.ts (keys) ·
              controls-panel.ts / control-factory.ts / controls.ts (declarative panel) ·
              effect-controller.ts · persist.ts (localStorage)
  config/     controls.ts (panel layout) · defaults.ts
  types/      domain.ts · effect.ts · settings.ts
bridge/       tuio-bridge.py (WS :7681 → TUIO UDP :3333) · tuio.py · test_tuio.py
scripts/      build-bridge.sh (PyInstaller sidecar)
src-tauri/    Rust shell: kiosk window + sidecar lifecycle
```

## Data flow

```
CAMERA (getUserMedia)            MOUSE (DOM events)
        │ gray frames                    │
        ▼                                │
ir/pipeline.ts                           │
  mirror → undistort → bg-subtract /     │
  motion-diff → brightness/contrast →    │
  findBlobs → ROI map → touch map →      │
  BlobTracker → TouchEv                  │
        └────────────┬───────────────────┘
                     ▼
        app.ts emitTouch fan-out:
          • active effect (GPU sim)
          • output.ts → WS :7681 → bridge → TUIO UDP :3333
          • pin-controller SHOW TOUCHES overlay
                     ▼
        render-loop: background → effect → warp-gl draw → overlay draw
```

## Two-layer warp (`gl/quad.ts` + `gl/warp-gl.ts`)

- **Layer 1 — corners:** 4 px offsets → homography `H` (unit square → screen), solved by
  `computeH`, guarded against degenerate corner layouts (keeps last valid H).
- **Layer 2 — mesh:** `MeshState { ku, kv, off }` — non-uniform knots (4–8 per axis, ends
  pinned at 0/1) and unit-space offsets per control point. `evalMesh(m, u, v)` evaluates a
  non-uniform Catmull-Rom surface (Hermite form, finite-difference tangents parameterized
  by knot values) for position **and** texture-uv with the same operator — so the identity
  mesh maps (u,v)→(u,v) exactly at any knot spacing (no image distortion when flat).
- `insertKnot` samples the current surface so splits preserve the shape; `removeKnot`
  drops interior knots. Both return new states (undo-friendly).
- Render: 32×32 tessellation; per vertex `clip = H(evalMesh(u,v).pos)`, `uv = evalMesh.uv`;
  static index buffer, per-frame vertex buffer. TEST PATTERN swaps the sampled texture for
  a generated checkerboard.

## Warp editor (`ui/pin-controller.ts`)

Modes `corners` / `mesh` (Tab or panel buttons). Corner/mesh point drag, body-drag move,
ZOOM scale, arrow nudge, double-click-on-line knot insert (nearest point on the sampled
polyline, interpolated param), `−COL`/`−ROW` removal, Ctrl+Z/Ctrl+Shift+Z undo/redo
(50-snapshot stacks), SHOW TOUCHES crosshairs. Persistence: `warpCorners` (px offsets)
and `warpMesh` (`MeshState`) in the `vp_settings` localStorage blob, validated on load.

## Detection pipeline knobs

All wired declaratively in `config/controls.ts` → `SourceManager`: threshold, min/max
area, blur, erosion, brightness/contrast, invert, diff mode (abs), motion mode + rate,
mirror X/Y, fisheye K1/K2, ROI (dragged on the calibrator preview), touch map (post-ROI
affine). The calibrator (`ui/ir-calibrator.ts`) shows the processed frame + binary mask
with blob boxes and a HUD.

## Bridge & TUIO

`bridge/tuio-bridge.py` is a pure relay: JSON touch events in over WS :7681 →
TUIO 1.1 `/tuio/2Dcur` bundles out over UDP :3333 (encoding in `bridge/tuio.py`,
tested by `bridge/test_tuio.py`). It has no capture role — the camera is read in-browser.

## Commands

```bash
npm run dev          # Vite on :8000
npm test             # tsc --noEmit + all node --test suites
./setup.sh           # python venv for the bridge
./run.sh             # bridge + vite
./scripts/build-bridge.sh   # freeze sidecar (needs rustc for the triple)
npm run tauri:dev    # desktop shell
```

## Conventions

- Pure logic lives in plain exported functions next to the class that uses it — unit-test
  those (`quad.ts`, `overlay.ts`, `blobs.ts`, …).
- Panel controls are declared once in `config/controls.ts`; ids double as localStorage keys.
- No new dependencies without a strong reason.
