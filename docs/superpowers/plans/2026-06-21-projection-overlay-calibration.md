# Fullscreen Projection Overlay + Easy Calibration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the projection canvas clean and slider-sized while a floating control toolbar hides/shows on a key combo, with click-to-select + arrow-key corner nudging and a calibration test grid.

**Architecture:** Pure overlay helpers (nudge math, grid geometry) live in a new `js/ui-overlay.js` next to the existing pure `warp-gl.js` helpers. A thin `installOverlay()` wires global keys (H/F/Esc/G + arrows) using callbacks injected from `app.js`, so the WebGL pipeline, sources, and bridge are untouched. `index.html` moves `#ui` into a fixed floating panel; corner selection + grid drawing hook into the existing `drawPins` overlay.

**Tech Stack:** Vanilla ES modules, WebGL (unchanged), Canvas 2D overlay, `node:test` + `node:assert/strict` for unit tests, localStorage via `js/persist.js`.

## Global Constraints

- Tests run with `node --test 'js/*.test.js'` from `videoplaster/`. Use `node:test` + `node:assert/strict`. NOT Vitest, NOT jsdom.
- ES modules only (`package.json` has `"type": "module"`).
- No changes to the WebGL pipeline, water/warp shaders, touch sources, or the Python bridge.
- Pin offsets stay clamped to `[-400, 400]` (matches existing `clampOff`).
- All persistence goes through `js/persist.js` `saveSetting(key, value)` / `getSetting(key)` (single `vp_settings` localStorage object).
- Match existing UI style: terse monospace, lowercase status text, `.section`/`.row`/`.ctrl` classes.

---

## File Structure

- **Create `videoplaster/js/ui-overlay.js`** — pure helpers `nudgeAxis`, `gridLines`, the `drawGrid` canvas helper, and the `installOverlay` keyboard/panel wiring. One responsibility: projection-mode overlay + keyboard.
- **Create `videoplaster/js/ui-overlay.test.js`** — `node:test` coverage for `nudgeAxis` and `gridLines`.
- **Modify `videoplaster/index.html`** — CSS for full-viewport black body, centered `#wrap`, fixed floating `#ui` panel + `.hidden` class; new "Projection" section with the test-grid checkbox and a key-hint line.
- **Modify `videoplaster/js/app.js`** — import overlay module; add `selectedPin` + `gridOn` state; set selection on pin mousedown; bind grid checkbox; nudge bridge; call `installOverlay`; extend `drawPins` (grid, bigger handles, selected highlight, drop media guard).

---

## Task 1: Pure overlay helpers + tests

**Files:**
- Create: `videoplaster/js/ui-overlay.js`
- Test: `videoplaster/js/ui-overlay.test.js`

**Interfaces:**
- Produces:
  - `nudgeAxis(value: number, dir: -1|1, shift: boolean) => number` — clamped offset after one arrow nudge (1px, or 10px when `shift`).
  - `gridLines(w: number, h: number, spacing: number) => { verticals: number[], horizontals: number[], cx: number, cy: number, corners: [number,number][] }`.
  - `drawGrid(ctx: CanvasRenderingContext2D, w, h, spacing) => void`.
  - `clampPin(v: number) => number`.

- [ ] **Step 1: Write the failing test**

Create `videoplaster/js/ui-overlay.test.js`:

```js
// videoplaster/js/ui-overlay.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { nudgeAxis, gridLines } from "./ui-overlay.js";

test("nudgeAxis 1px and 10px steps", () => {
  assert.equal(nudgeAxis(0, 1, false), 1);
  assert.equal(nudgeAxis(0, -1, false), -1);
  assert.equal(nudgeAxis(0, 1, true), 10);
  assert.equal(nudgeAxis(5, -1, true), -5);
});

test("nudgeAxis clamps to [-400,400]", () => {
  assert.equal(nudgeAxis(400, 1, false), 400);
  assert.equal(nudgeAxis(-400, -1, true), -400);
  assert.equal(nudgeAxis(395, 1, true), 400);
});

test("gridLines spacing, center, corners", () => {
  const g = gridLines(100, 80, 50);
  assert.deepEqual(g.verticals, [0, 50, 100]);
  assert.deepEqual(g.horizontals, [0, 50]);
  assert.equal(g.cx, 50);
  assert.equal(g.cy, 40);
  assert.deepEqual(g.corners, [[0, 0], [100, 0], [100, 80], [0, 80]]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd videoplaster && node --test js/ui-overlay.test.js`
Expected: FAIL — `Cannot find module './ui-overlay.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `videoplaster/js/ui-overlay.js`:

```js
// videoplaster/js/ui-overlay.js
// Projection-mode overlay + keyboard layer. Pure helpers are exported for tests;
// installOverlay() is DOM-light and takes its app hooks as callbacks.

const PIN_MIN = -400, PIN_MAX = 400;
export const clampPin = (v) => Math.max(PIN_MIN, Math.min(PIN_MAX, v));

// Pure: new offset for one axis after an arrow nudge.
// dir: -1 or +1. shift: true => 10px step, else 1px. Result clamped to [-400,400].
export function nudgeAxis(value, dir, shift) {
  return clampPin(value + dir * (shift ? 10 : 1));
}

// Pure: grid geometry for a canvas of size w×h with the given line spacing.
export function gridLines(w, h, spacing) {
  const verticals = [], horizontals = [];
  for (let x = 0; x <= w; x += spacing) verticals.push(x);
  for (let y = 0; y <= h; y += spacing) horizontals.push(y);
  return { verticals, horizontals, cx: w / 2, cy: h / 2,
           corners: [[0, 0], [w, 0], [w, h], [0, h]] };
}

// Draw the calibration grid (faint lines + center cross + corner squares) onto a 2D ctx.
export function drawGrid(ctx, w, h, spacing) {
  const g = gridLines(w, h, spacing);
  ctx.save();
  ctx.strokeStyle = "rgba(0,200,255,0.25)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of g.verticals) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (const y of g.horizontals) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,200,255,0.7)"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(g.cx, 0); ctx.lineTo(g.cx, h);
  ctx.moveTo(0, g.cy); ctx.lineTo(w, g.cy);
  ctx.stroke();
  ctx.fillStyle = "rgba(0,200,255,0.9)";
  for (const [x, y] of g.corners) ctx.fillRect(x - 4, y - 4, 8, 8);
  ctx.restore();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd videoplaster && node --test js/ui-overlay.test.js`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/ui-overlay.js videoplaster/js/ui-overlay.test.js
git commit -m "feat: pure overlay helpers (nudgeAxis, gridLines, drawGrid)"
```

---

## Task 2: Floating panel layout + Projection section

**Files:**
- Modify: `videoplaster/index.html`

**Interfaces:**
- Produces: a `#ui` panel that toggles via the `hidden` CSS class; an `#grid` checkbox; a centered `#wrap`.
- Consumes: nothing (CSS/HTML only).

- [ ] **Step 1: Replace the body/wrap CSS and add panel rules**

In `videoplaster/index.html`, find:

```css
body{background:#000;font-family:monospace;color:#888;padding:16px}
#wrap{position:relative;display:inline-block}
#glCanvas{display:block;touch-action:none}
#pinCanvas{position:absolute;left:0;top:0;pointer-events:none}
#ui{margin-top:12px;display:flex;flex-direction:column}
```

Replace with:

```css
html,body{height:100%}
body{background:#000;font-family:monospace;color:#888;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
#wrap{position:relative}
#glCanvas{display:block;touch-action:none}
#pinCanvas{position:absolute;left:0;top:0;pointer-events:none}
#ui{position:fixed;left:0;top:0;width:300px;max-height:100vh;overflow-y:auto;background:rgba(0,0,0,0.78);padding:8px 12px;border-right:.5px solid #222;z-index:10;display:flex;flex-direction:column}
#ui.hidden{display:none}
```

- [ ] **Step 2: Add the Projection section**

In `videoplaster/index.html`, find the opening of the controls panel:

```html
<div id="ui">
  <div class="section"><div class="row">
    <span class="slabel">Canvas</span>
```

Insert a new section immediately after `<div id="ui">` and before the `Canvas` section:

```html
<div id="ui">
  <div class="section"><div class="row">
    <span class="slabel">Projection</span>
    <label class="ctrl"><input type="checkbox" id="grid"> TEST GRID</label>
  </div>
  <div class="row"><span class="val" style="min-width:auto">H hide · F fullscreen · Esc show · click pin + ←↑→↓ nudge (Shift ×10)</span></div></div>

  <div class="section"><div class="row">
    <span class="slabel">Canvas</span>
```

- [ ] **Step 3: Verify layout manually**

Serve the app: `cd videoplaster && ./run.sh` (or any static server), open the page.
Expected:
- Canvas centered on a black full-window background (no 16px body padding gutter).
- `#ui` panel floats fixed at the left edge, semi-transparent, scrolls if taller than the window.
- A "Projection" section with a `TEST GRID` checkbox and the key-hint line appears at the top of the panel.

- [ ] **Step 4: Commit**

```bash
git add videoplaster/index.html
git commit -m "feat: floating control panel layout + projection section"
```

---

## Task 3: Keyboard layer + app wiring (toggle, fullscreen, nudge, grid)

**Files:**
- Modify: `videoplaster/js/ui-overlay.js` (add `installOverlay`)
- Modify: `videoplaster/js/app.js`

**Interfaces:**
- Consumes: `nudgeAxis` (Task 1), `syncPinSlider(k, axis, val)` and `saveSetting`/`getSetting` (existing in `app.js`/`persist.js`).
- Produces:
  - `installOverlay({ panel, body, isEditing, onNudge, onToggleGrid, persist, initialHidden }) => void`.
  - `app.js` state: `let selectedPin` (string|null), `let gridOn` (boolean).

- [ ] **Step 1: Add `installOverlay` to `ui-overlay.js`**

Append to `videoplaster/js/ui-overlay.js`:

```js
const ARROW = { ArrowLeft: ["x", -1], ArrowRight: ["x", 1], ArrowUp: ["y", -1], ArrowDown: ["y", 1] };

// Wire global projection keys. App hooks are injected so this stays DOM-light.
// opts: { panel, body, isEditing(), onNudge(axis,dir,shift), onToggleGrid(),
//         persist(key,val), initialHidden }
export function installOverlay(opts) {
  const { panel, body, isEditing, onNudge, onToggleGrid, persist, initialHidden } = opts;
  let hidden = !!initialHidden;
  const applyHidden = () => {
    panel.classList.toggle("hidden", hidden);
    body.style.cursor = hidden ? "none" : "";
  };
  applyHidden();

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hidden = false; applyHidden(); persist("uiHidden", false); return; }
    if (isEditing()) return;
    const k = e.key.toLowerCase();
    if (k === "h") { hidden = !hidden; applyHidden(); persist("uiHidden", hidden); }
    else if (k === "f") { toggleFullscreen(); }
    else if (k === "g") { onToggleGrid(); }
    else if (ARROW[e.key]) { e.preventDefault(); const [axis, dir] = ARROW[e.key]; onNudge(axis, dir, e.shiftKey); }
  });
}
```

- [ ] **Step 2: Import the overlay module in `app.js`**

In `videoplaster/js/app.js`, find:

```js
import { bindControl, getSetting, saveSetting } from "./persist.js";
```

Add immediately below it:

```js
import { installOverlay, nudgeAxis, drawGrid } from "./ui-overlay.js";
```

- [ ] **Step 3: Add overlay state next to the existing pin-drag state**

In `videoplaster/js/app.js`, find:

```js
let pinDrag = null;
```

Add immediately below it:

```js
let selectedPin = null;   // corner selected for arrow-key nudging ("tl"|"tr"|"br"|"bl")
let gridOn = false;       // calibration test grid visible
```

- [ ] **Step 4: Select a corner on pin mousedown (and drop the media guard)**

In `videoplaster/js/app.js`, find:

```js
function startPinDrag(e){
  if (bg.hasMedia) return;
  const p = canvasPos(e), k = nearPin(p.x, p.y);
  if (k){ pinDrag = k; e.stopImmediatePropagation(); e.preventDefault(); }  // beat MouseTouchSource on glCanvas
}
```

Replace with:

```js
function startPinDrag(e){
  const p = canvasPos(e), k = nearPin(p.x, p.y);
  if (k){ selectedPin = k; pinDrag = k; e.stopImmediatePropagation(); e.preventDefault(); }  // beat MouseTouchSource on glCanvas
}
```

- [ ] **Step 5: Bind the grid checkbox and install the overlay**

In `videoplaster/js/app.js`, find:

```js
// source last so setSource sees everything ready; restores last source or defaults to mouse
bindControl("sourceSel", (v) => setSource(v));
```

Insert immediately ABOVE that block:

```js
// ---- projection overlay (grid + keyboard) ----------------------------------
bindControl("grid", (v) => { gridOn = v; });

function nudgeSelected(axis, dir, shift){
  if (!selectedPin) return;
  const id = selectedPin + axis;                 // "tl" + "x" => "tlx"
  const el = document.getElementById(id);
  const cur = el ? (parseFloat(el.value) || 0) : 0;
  syncPinSlider(selectedPin, axis, nudgeAxis(cur, dir, shift));
}

installOverlay({
  panel: document.getElementById("ui"),
  body: document.body,
  isEditing: () => { const a = document.activeElement; return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT"); },
  onNudge: nudgeSelected,
  onToggleGrid: () => { const c = document.getElementById("grid"); if (c) c.click(); },
  persist: saveSetting,
  initialHidden: getSetting("uiHidden") === true,
});
```

- [ ] **Step 6: Run the existing unit suite (no regressions)**

Run: `cd videoplaster && node --test 'js/*.test.js'`
Expected: PASS — all existing tests plus `ui-overlay.test.js` pass.

- [ ] **Step 7: Verify behavior manually**

Serve the app and open the page (mouse source is fine).
Expected:
- Press `H` → panel hides and the cursor disappears; press `H` again → both return.
- Press `Esc` while hidden → panel reappears.
- Press `F` → page enters browser fullscreen; `F` again → exits.
- Toggle the `TEST GRID` checkbox (or press `G`) → faint grid + center cross + corner squares appear/disappear on the canvas.
- Click one of the `TL/TR/BR/BL` handles, then press arrows → that corner's slider value changes by 1px (10px with Shift); the warp follows.
- While a slider/select is focused, arrows adjust the control (not the pin) — overlay keys are suppressed.

- [ ] **Step 8: Commit**

```bash
git add videoplaster/js/ui-overlay.js videoplaster/js/app.js
git commit -m "feat: projection keyboard layer (H/F/Esc/G + arrow nudge) wired into app"
```

---

## Task 4: Bigger handles, selected highlight, grid render

**Files:**
- Modify: `videoplaster/js/app.js`

**Interfaces:**
- Consumes: `selectedPin`, `gridOn`, `drawGrid` (Task 3 / Task 1).
- Produces: updated `drawPins()` rendering; `PIN_HIT = 26`.

- [ ] **Step 1: Widen the pin hit radius**

In `videoplaster/js/app.js`, find:

```js
const PIN_HIT = 18;
```

Replace with:

```js
const PIN_HIT = 26;
```

- [ ] **Step 2: Rewrite `drawPins` to draw the grid, bigger handles, and the selected highlight**

In `videoplaster/js/app.js`, find:

```js
function drawPins(){
  if (!pinCtx) return;
  pinCtx.clearRect(0, 0, pinCanvas.width, pinCanvas.height);
  if (bg.hasMedia) return;                       // v11: hide handles over media
  const pp = warp.cornerPositions();
  const labels = { tl:"TL", tr:"TR", br:"BR", bl:"BL" };
  for (const k of ["tl","tr","br","bl"]){
    const p = pp[k];
    pinCtx.save();
    pinCtx.strokeStyle = "rgba(255,255,255,0.65)"; pinCtx.fillStyle = "rgba(0,0,0,0.55)"; pinCtx.lineWidth = 1.5;
    pinCtx.beginPath(); pinCtx.arc(p.x, p.y, 11, 0, Math.PI*2); pinCtx.fill(); pinCtx.stroke();
    pinCtx.beginPath(); pinCtx.moveTo(p.x-7, p.y); pinCtx.lineTo(p.x+7, p.y); pinCtx.moveTo(p.x, p.y-7); pinCtx.lineTo(p.x, p.y+7); pinCtx.stroke();
    pinCtx.fillStyle = "rgba(255,255,255,0.5)"; pinCtx.font = "8px monospace"; pinCtx.textAlign = "center";
    pinCtx.fillText(labels[k], p.x, p.y-16);
    pinCtx.restore();
  }
}
```

Replace with:

```js
function drawPins(){
  if (!pinCtx) return;
  pinCtx.clearRect(0, 0, pinCanvas.width, pinCanvas.height);
  if (gridOn) drawGrid(pinCtx, pinCanvas.width, pinCanvas.height, 50);
  const pp = warp.cornerPositions();
  const labels = { tl:"TL", tr:"TR", br:"BR", bl:"BL" };
  for (const k of ["tl","tr","br","bl"]){
    const p = pp[k];
    const sel = (k === selectedPin);
    pinCtx.save();
    pinCtx.strokeStyle = sel ? "rgba(0,255,140,0.95)" : "rgba(255,255,255,0.65)";
    pinCtx.fillStyle = "rgba(0,0,0,0.55)"; pinCtx.lineWidth = sel ? 2.5 : 1.5;
    pinCtx.beginPath(); pinCtx.arc(p.x, p.y, 16, 0, Math.PI*2); pinCtx.fill(); pinCtx.stroke();
    pinCtx.beginPath(); pinCtx.moveTo(p.x-10, p.y); pinCtx.lineTo(p.x+10, p.y); pinCtx.moveTo(p.x, p.y-10); pinCtx.lineTo(p.x, p.y+10); pinCtx.stroke();
    pinCtx.fillStyle = sel ? "rgba(0,255,140,0.9)" : "rgba(255,255,255,0.6)"; pinCtx.font = "10px monospace"; pinCtx.textAlign = "center";
    pinCtx.fillText(labels[k], p.x, p.y-22);
    pinCtx.restore();
  }
}
```

- [ ] **Step 3: Verify rendering manually**

Serve the app and open the page.
Expected:
- The four corner handles are noticeably larger with always-visible labels.
- Load an image/video (Image → LOAD): handles remain visible and draggable over the media.
- The clicked/selected corner draws in green; others stay white.
- With `TEST GRID` on, the grid renders behind the handles and tracks canvas size changes (move the `WIDTH`/`HEIGHT` sliders).

- [ ] **Step 4: Run the full unit suite**

Run: `cd videoplaster && node --test 'js/*.test.js'`
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/app.js
git commit -m "feat: bigger always-visible pins, selected highlight, grid render"
```

---

## Self-Review

**Spec coverage:**
- Floating hideable toolbar → Task 2 (layout) + Task 3 (`H`/`Esc` toggle, persist).
- `F` fullscreen → Task 3 `toggleFullscreen`.
- Cursor hide on toolbar-hide → Task 3 `applyHidden`.
- Key guard while typing → Task 3 `isEditing`.
- Arrow-key nudge (1px / Shift 10px, clamped, persisted) → Task 1 `nudgeAxis` + Task 3 `nudgeSelected` (routes through `syncPinSlider`, which persists).
- Bigger handles + always visible over media → Task 4.
- Selected-corner highlight → Task 3 (selection) + Task 4 (draw).
- Test grid (checkbox + `G`, drawn on pinCanvas) → Task 1 `drawGrid` + Task 2 checkbox + Task 3 bind/key + Task 4 render.
- Grid + panel-hidden state persist → Task 3 (`grid` via `bindControl`, `uiHidden` via `persist`).
- No pipeline/shader/source/bridge changes → honored across all tasks.

**Placeholder scan:** none — every step has concrete code or exact commands.

**Type consistency:** `nudgeAxis(value, dir, shift)`, `gridLines(w,h,spacing)`, `drawGrid(ctx,w,h,spacing)`, `installOverlay({panel,body,isEditing,onNudge,onToggleGrid,persist,initialHidden})`, `selectedPin`, `gridOn`, `syncPinSlider(k,axis,val)` — names and signatures used consistently across Tasks 1, 3, 4.
