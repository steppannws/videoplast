# Leap IR Mirror (X/Y) — Design

**Date:** 2026-06-18
**Status:** approved

## Context

The Leap Motion Controller 2 is mounted behind the white acrylic and views the touch surface from the far side, so its IR image is reversed relative to what the user sees. Detected touches land mirrored. The user needs to flip (mirror) the IR camera image. Both axes requested: `MIRROR X` (left-right) and `MIRROR Y` (up-down), to cover any mount orientation.

## Design

- `LeapImageSource` gains `this.mirror = { x: false, y: false }`.
- In `_onFrame`, immediately after the gray→RGBA conversion and **before** undistort, apply a pure `flipImage(rgba, w, h, flipX, flipY)` that returns a flipped copy (no-op when both false). Placing the flip first makes undistort, background-subtraction, blob detection, the IR preview, and the ROI→surface mapping all operate on the same mirrored frame — touches map correctly.
- Pure exported helper `flipImage(rgba, w, h, flipX, flipY) -> Uint8ClampedArray` (RGBA), unit-tested.

### UI + wiring

- `index.html`: two checkboxes in the LEAP IR section — `MIRROR X` (`id="mirrorX"`), `MIRROR Y` (`id="mirrorY"`).
- `app.js`: a `mirrorOpt = { x:false, y:false }` holder (mirrors `detOpt`/`undistOpt` pattern). `bindControl("mirrorX", ...)` / `bindControl("mirrorY", ...)` update the holder and the live `leapSrc.mirror`; `setSource("leap-ir")` does `Object.assign(leapSrc.mirror, mirrorOpt)`. Persists via the existing `vp_settings`.

### Note

Capturing the IR background stores the frame in its current mirror orientation. Toggling MIRROR after a capture invalidates the background (orientation mismatch) — re-capture background after flipping.

## Files

- `js/leap-image-source.js` — `mirror` field, `flipImage` helper applied in `_onFrame`.
- `js/leap-image-source.test.js` — `flipImage` unit tests.
- `index.html` — two checkboxes.
- `js/app.js` — `mirrorOpt` holder + `bindControl` + apply on source creation.

## Testing

- **Unit:** `flipImage` — flipX swaps columns, flipY swaps rows, both flips diagonal, no-flip returns identical pixels. Existing `npm test` (22) + `pytest` (3) stay green.
- **Manual:** LEAP IR source, wave a hand near one edge; toggle MIRROR X → the bright region (and resulting touch) appears on the opposite side in the preview; MIRROR Y flips top/bottom; settings persist across reload.

## Out of scope

- Mirroring the projection/output canvas (that is the WarpGL corner mapping, already done).
