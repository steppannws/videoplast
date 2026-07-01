# Canvas Background + Projection Corner Mapping — Design

**Date:** 2026-06-18
**Status:** approved

## Context

The output canvas currently renders the water effect over a flat 2×2 blue background, and projection-corner calibration is slider-only (absolute pixel destinations). The user wants to improve the canvas to match the older `videoplaster01_v11.html` prototype: load an **image or video** as the canvas background, and **drag corner pins on the canvas** to keystone-map it onto a projector. The look and controls should match v11 (monospace control bar, `+` corner handles, grid/registration default), but with **English labels**.

This is the projection/output side of the installation — independent of the IR sensing pipeline (which already works).

## Decisions (user-selected)

- **Resizable canvas**: add WIDTH/HEIGHT sliders that resize the canvas live (v11 has ANCHO/ALTO).
- **UI restyle**: adopt v11's monospace control-bar style across the UI, with **English** labels.
- **Default canvas** (no media): grid + L-shaped corner registration brackets + centered title.
- **Pins as offsets** (v11 semantics): `0px` = no warp, range −400…400; `+` drag handles **hidden when media is loaded** (exactly like v11).

## Design

### 1. Background source — `js/background.js` (new)

`BackgroundCanvas` owns a 2D `<canvas>` sized to the current canvas W×H.

- `loadFile(file)` — `image/*` → `Image`; `video/*` → muted looping autoplay `<video>` (via `URL.createObjectURL`). Sets `hasMedia=true`.
- `clear()` — drop media, `hasMedia=false`.
- transform state `scaleX, scaleY, rot` (set from SCALE X / SCALE Y / ROT sliders).
- `resize(w,h)` — resize the backing canvas.
- `draw()` — render one frame and return the canvas:
  - **media**: `translate(W/2,H/2) → rotate(rot°) → scale(scaleX,scaleY)`, aspect-fill `drawImage` (v11 `drawSource` math: `ar=sw/sh; cAr=W/H; if(ar>cAr){dh=H;dw=H*ar}else{dw=W;dh=W/ar}`).
  - **no media**: black fill; 40px grid `rgba(255,255,255,0.65)` lw 0.5; L-brackets in the 4 corners; centered `VIDEOPLASTER 02` (bold 15px) + `armandofrezzedurand.com` (10px, dim). Title text is a module constant (easy to change).

The render loop calls `bg.draw()` then `water.setBackground(bg.canvas)` each frame, replacing the one-time 2×2 blue. Existing `WaterGL.setBackground(source)` already uploads any canvas/image/video via `texImage2D`, so no water-shader change. Media files are **not** persisted across reload (transient, like v11); SCALE/ROT slider values are.

### 2. Projection corners — `WarpGL` offsets + draggable handles

`js/warp-gl.js`:
- Replace absolute `this.pins` with **offsets** `this.off = {tl:{x:0,y:0}, tr:{x:0,y:0}, br:{x:0,y:0}, bl:{x:0,y:0}}`.
- `baseCorners()` → `[tl(0,0), tr(w,0), br(w,h), bl(0,h)]`; `cornerPositions()` → base + offset per corner (the warped destination points).
- `draw(srcTex)` computes `H = computeH(baseCorners, cornerPositions)` as before (same shader).
- `setPinOffset(k, axis, v)`, `resize(w, h)` (updates `this.w/this.h`).

`index.html`: a transparent `<canvas id="pinCanvas">` absolutely positioned over `#glCanvas` inside `#wrap`, `pointer-events:none` (visual only).

`js/app.js`:
- `drawPins()` each frame: clear `pinCanvas`; **return early if `bg.hasMedia`** (v11 hides handles over media); else for each corner at `warp.cornerPositions()` draw v11 handle — `rgba(0,0,0,0.55)` fill + `rgba(255,255,255,0.65)` stroke circle r≈11, a `+` crosshair (±7px), and the `TL/TR/BR/BL` label above (8px monospace).
- Drag: **capture-phase** `mousedown` on `#glCanvas` → map client→canvas px (account for CSS scale) → if within ~18px of a corner, set `dragging=k`, `e.stopPropagation()` (so the mouse touch-source does NOT emit a ripple). `mousemove`/`mouseup` on `window`: update `warp.off[k] = pointer − baseCorner`, sync the PIN sliders (set value + readout), `saveSetting`. Touch equivalents (`touchstart/move/end`, `preventDefault`).
- PIN sliders (`tlx…bly`, range −400…400, `0px`) bind to `warp.off` and are kept in sync by drags.

Pin offsets persist as the individual slider values (existing `vp_settings`), so calibration survives reload.

### 3. Resizable canvas (WIDTH/HEIGHT)

`setCanvasSize(w,h)` in app.js: set `glCanvas.width/height`, `pinCanvas.width/height`, `bg.resize(w,h)`, `warp.resize(w,h)`, `gl.viewport(0,0,w,h)`. WIDTH/HEIGHT sliders (`canvasW`/`canvasH`) call it via `bindControl`, persisted. WaterGL's sim runs at its fixed internal resolution and is sampled as a texture, so it is **not** reallocated on resize (deviation from v11, which resizes sim buffers — negligible visual difference, far simpler).

### 4. UI restyle + readouts

`index.html`: rewrite the control bar with v11 CSS — `.section{border-top:.5px solid #222}`, `.row{flex,wrap,gap}`, `.slabel{font-size:9px;letter-spacing:3px;color:#555}`, `.ctrl{flex,gap:5px}`, `.ctrl label{font-size:10px;color:#666}`, `.val{font-size:10px;color:#555;min-width:42px}`, `input[type=range]{width:80px;accent-color:#555}`. **English** labels: `CANVAS WIDTH/HEIGHT`, `SOURCE`, `IMAGE LOAD / SCALE X / SCALE Y / ROT`, `WATER INTENSITY/RADIUS/VISCOSITY`, `PIN TL…BL X/Y`, `LEAP IR …` (existing calibration controls restyled, same ids).

`js/persist.js`: extend `bindControl(id, apply, fmt?)` — if an element `id+"v"` exists, set its text to `fmt(value)` on load and change (e.g. `v=>v+"px"`, `v=>(+v).toFixed(1)+"x"`). Existing two-arg calls keep working.

## Files

- `js/background.js` — new (`BackgroundCanvas`).
- `js/warp-gl.js` — offset pins, `resize`, `cornerPositions`, `setPinOffset`.
- `js/app.js` — pin overlay draw + drag, IMAGE/CANVAS/PIN wiring, `setCanvasSize`, loop updates `bg.draw()`+`setBackground`.
- `index.html` — v11 restyle, `#pinCanvas` overlay, CANVAS/IMAGE/PIN controls, value readouts, English labels.
- `js/persist.js` — `bindControl` optional `fmt` readout.

## Testing

- **Unit (pure):** extract the offset math into a module-level exported pure function `cornerPositions(w, h, off) -> {tl,tr,br,bl}` (the `WarpGL.cornerPositions()` method delegates to it). `WarpGL` can't be instantiated in Node (its constructor needs a WebGL context), so the test imports the pure function. Add `js/warp-gl.test.js` covering zero-offset (base corners) and per-corner offsets at a given w,h. Existing `npm test` (17) + `pytest` (3) stay green.
- **Manual (visual, via the live app + playwright):**
  - Default canvas shows grid + corner brackets + title; ripples distort it.
  - Drag a `+` handle → that corner keystones; PIN slider updates; reload → persists.
  - LOAD an image → it fills the canvas, SCALE X/Y/ROT transform it, `+` handles hide; LOAD a video → it plays as the background.
  - WIDTH/HEIGHT sliders resize the canvas + overlay; warp + handles track the new size.
  - All sliders show value readouts (`800px`, `1.0x`) and persist across reload.

## Out of scope

- Persisting the loaded media file across reloads (transient, matches v11).
- Reallocating the water sim to canvas resolution on resize (fixed sim res kept for simplicity).
- v11's obsolete sensing controls (ALTURA TOQUE / ZOOM / INVERTIR Z) — superseded by the LEAP IR pipeline.
