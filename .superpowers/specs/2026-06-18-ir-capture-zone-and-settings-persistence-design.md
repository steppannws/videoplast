# IR Capture Zone + Settings Persistence — Design

**Date:** 2026-06-18
**Status:** approved (pre-Phase-2 corrections)

## Context

After the Phase 0 hardware gate passed and Phase 1 (mouse → water → warp → TUIO) was verified end-to-end, two usability gaps surfaced before starting Phase 2 (LeapImageSource on-rig):

1. **Settings don't persist.** Only the projection-corner sliders (`vp_pins`) and the IR 4-point calibration (`vp_corners`) survive a reload. Every other control — water (intensity/viscosity/radius), blob detection (threshold, min/max area, blur, erosion), invert, fisheye + k1/k2, and the source dropdown — resets to its HTML default on reload. Re-tuning each session is tedious.

2. **The motion-capture zone is invisible and awkward to set.** The IR capture region is defined by a one-shot "click 4 corners" flow (`calibCorners` → 4 clicks on `irPreview` → `setCorners` → camera→surface homography). There is no visual indication of the resulting region and no way to nudge a single corner afterward.

Intended outcome: all controls persist across reloads, and the capture zone is a clearly-drawn, directly-adjustable rectangle on the IR preview.

## Decisions (user-selected)

- **Zone UX:** draggable green handles on the IR preview (WYSIWYG), replacing the blind 4-click flow.
- **Zone shape:** axis-aligned rectangle (no perspective correction). Accepted tradeoff: if the sensor is tilted relative to the surface, mapping is approximate. Fisheye/undistort still runs first.
- **Persistence scope:** every slider/checkbox + both corner sets + the selected source.

## Design

### 1. Settings persistence (unified)

New module `js/persist.js`:

- A single localStorage key `vp_settings` holding one JSON object: `{ [controlId]: value, roi: {x,y,w,h} }`.
- `loadSettings()` / `saveSettings(obj)` with try/catch (corrupt JSON → `{}`).
- `bindControl(id, apply)` helper: on load, if a saved value exists, set `el.value`/`el.checked` from it; then read the control's current value and call `apply(value)` so the live object syncs. On `input`/`change`, write the value into `vp_settings`, persist, and call `apply(value)`. Handles `range`, `checkbox`, and `select` by element type.

In `app.js`, route **every** control through `bindControl` instead of the current ad-hoc handlers:
- 8 projection-corner sliders → update `warp.pins[k][axis]`.
- 3 water sliders → `water.intensity/damp/radius`.
- 5 detection sliders + `invert` → `leapSrc.opt.*` (guarded: only when `leapSrc` active).
- `undistort` + `k1`/`k2` → `leapSrc.undist.*` (+ `map=null` to rebuild).
- source `<select>` → `setSource(value)`; restore last source on boot.

Removes the bespoke `vp_pins` / `vp_corners` keys (superseded by `vp_settings`).

### 2. Capture zone — rectangle ROI

`js/leap-image-source.js`:
- Replace `corners` / `H` / `setCorners()` with `this.roi = {x,y,w,h}` normalized to 0..1 of image dims (default `{x:0,y:0,w:1,h:1}` = full frame) and `setRoi(roi)`.
- Mapping in `_onFrame`: for each blob center `(cx,cy)`, `u=(cx/this.w - roi.x)/roi.w`, `v=(cy/this.h - roi.y)/roi.h`; keep blobs with `u,v ∈ [0,1]`; emit as touch with `strength = min(1, bright/255)`. Outside the rect → ignored (the rectangle is the active motion zone).
- `computeH`/`applyH` no longer used here. WarpGL keeps using `computeH` for projection — unchanged.

### 3. Overlay + drag on `irPreview`

In `app.js` `drawPreview(rgba, w, h, blobs)` (called each IR frame):
- Existing: draw IR image + green rects on detected blobs.
- Add: dim the area **outside** the ROI (semi-transparent dark fill) so the active zone stands out; stroke the ROI rectangle in green; draw a small filled green square handle at each of the 4 corners. Coordinates map normalized `roi` → preview-canvas pixels (preview is 320×240, IR 512×512 — scale independently per axis).

Drag handlers on `irPreview`:
- `mousedown`: hit-test the 4 handles (within a few px in preview space). If hit, begin dragging that corner.
- `mousemove`: convert pointer to normalized image coords; resize the rectangle axis-aligned with the **opposite** corner fixed (TL drag sets left+top; TR sets right+top; BR sets right+bottom; BL sets left+bottom). Clamp to [0,1] and enforce a minimum size. Recompute `{x,y,w,h}`, call `leapSrc.setRoi(...)`.
- `mouseup`: write `roi` into `vp_settings` and persist.

Button change in `index.html`: `CALIBRATE CORNERS` → **RESET ZONE** (`resetZone`), which sets `roi` back to full frame and persists. Replaces the click-4-corners flow (and its `cornerMode`/`cornerPts` state in `app.js` is removed).

## Files

- `js/persist.js` — new (loadSettings/saveSettings/bindControl).
- `js/leap-image-source.js` — `roi` + linear map replaces corner homography.
- `js/app.js` — route all controls through `bindControl`; ROI overlay draw + drag; reset-zone button; restore source on boot; remove `cornerMode` flow.
- `index.html` — relabel button to RESET ZONE (id `resetZone`).

## Testing

- **Unit (pure):** extract the ROI map as a pure exported helper `roiMap(cx, cy, w, h, roi)` → `{u, v}` and add `js/leap-image-source.test.js` covering inside / outside / edge cases (TDD: test first). Keeps `node --test` coverage meaningful for the one piece of new logic.
- **Existing:** `npm test` (14) + `pytest` (3) must stay green — no changes to homography/blobs/tracking/tuio.
- **Manual:** reload page → all sliders/checkboxes/source keep their last values. Switch to LEAP IR → green rectangle + handles drawn over the IR feed, area outside dimmed. Drag a handle → rectangle resizes axis-aligned; reload → zone persists. RESET ZONE → full-frame rect. Confirm only blobs inside the rect produce water drops / TUIO cursors.

## Out of scope

- Perspective (quad) capture zone — explicitly rejected in favor of the rectangle.
- Phase 2 detection tuning on real hardware (follows this work).
