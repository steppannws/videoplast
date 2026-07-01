# IR Capture Zone + Settings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist all UI controls across reloads, and make the LEAP IR motion-capture zone a green axis-aligned rectangle drawn on the IR preview with draggable corner handles.

**Architecture:** A small `persist.js` stores every control's value in one `vp_settings` localStorage object via a `bindControl(id, apply)` helper that restores-on-load and saves-on-change. `LeapImageSource` replaces its 4-point perspective homography with a normalized rectangle `roi` and a pure `roiMap()` linear transform. `app.js` routes all controls through `bindControl`, draws the ROI overlay on `irPreview`, and handles corner-drag.

**Tech Stack:** Vanilla ES-module JS (browser, no build), `node --test` for the one pure helper.

## Global Constraints

- No build step. Browser loads `<script type="module">`; Node runs the same `.js` as ESM for tests.
- Commits: plain messages, no attribution footer.
- Branch: `feature/ir-capture-zone-settings-persist` (already checked out).
- Existing suites must stay green: `npm test` (14) + `pytest bridge/test_tuio.py` (3).
- ROI is stored normalized (0..1 of image dims) so it is resolution-independent.

---

### Task 1: `roiMap` helper + LeapImageSource rectangle ROI

**Files:**
- Modify: `videoplaster/js/leap-image-source.js`
- Test: `videoplaster/js/leap-image-source.test.js` (create)

**Interfaces:**
- Produces: `roiMap(cx, cy, w, h, roi) -> {u, v}` where `roi = {x,y,w,h}` normalized; `LeapImageSource.roi` (default `{x:0,y:0,w:1,h:1}`); `LeapImageSource.setRoi(roi)`.

- [ ] **Step 1: Write the failing test**

```js
// videoplaster/js/leap-image-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { roiMap } from "./leap-image-source.js";

test("full-frame roi maps image center to surface center", () => {
  const { u, v } = roiMap(256, 256, 512, 512, { x:0, y:0, w:1, h:1 });
  assert.ok(Math.abs(u-0.5) < 1e-9 && Math.abs(v-0.5) < 1e-9);
});

test("sub-rect maps its own center to (0.5,0.5) and its TL to (0,0)", () => {
  const roi = { x:0.25, y:0.25, w:0.5, h:0.5 };
  const c = roiMap(256, 256, 512, 512, roi);          // image center == roi center
  assert.ok(Math.abs(c.u-0.5) < 1e-9 && Math.abs(c.v-0.5) < 1e-9);
  const tl = roiMap(128, 128, 512, 512, roi);         // image (0.25,0.25) == roi TL
  assert.ok(Math.abs(tl.u-0) < 1e-9 && Math.abs(tl.v-0) < 1e-9);
});

test("blob outside the roi yields u or v outside [0,1]", () => {
  const roi = { x:0.25, y:0.25, w:0.5, h:0.5 };
  const p = roiMap(0, 0, 512, 512, roi);              // top-left image corner, left of roi
  assert.ok(p.u < 0 && p.v < 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd videoplaster && node --test js/leap-image-source.test.js`
Expected: FAIL — `roiMap` is not exported / `Cannot find module` side-effects (it imports browser-only deps). NOTE: `leap-image-source.js` imports other pure modules only at top; `roiMap` itself must be importable in Node. It is a pure function with no DOM/WebSocket use, so importing the module in Node works as long as the module body does not touch `window`/`WebSocket` at import time (it doesn't — those are inside methods).

- [ ] **Step 3: Implement — replace homography with rectangle ROI**

Rewrite `videoplaster/js/leap-image-source.js` to:

```js
// videoplaster/js/leap-image-source.js
import { TouchSource } from "./touch-source.js";
import { findBlobs } from "./blobs.js";
import { BlobTracker } from "./tracking.js";
import { subtractBackground } from "./ir-preprocess.js";
import { buildUndistMap, applyUndist } from "./undistort.js";

// Pure: blob center (image px) -> surface UV via an axis-aligned normalized rectangle.
// roi = {x,y,w,h} in 0..1 of the image. Outside the rect -> u or v outside [0,1].
export function roiMap(cx, cy, w, h, roi) {
  const u = (cx / w - roi.x) / roi.w;
  const v = (cy / h - roi.y) / roi.h;
  return { u, v };
}

export class LeapImageSource extends TouchSource {
  constructor(url = "ws://localhost:7681") {
    super(); this.name = "leap-ir"; this.url = url;
    this.w = 0; this.h = 0; this.frame = null; this.bg = null;
    this.opt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
    this.undist = { on: false, k1: -0.3, k2: 0, map: null };
    this.roi = { x: 0, y: 0, w: 1, h: 1 }; // normalized capture rectangle; default full frame
    this.tracker = new BlobTracker({ maxDist: 0.08 });
    this.previewCb = null; // optional: (rgba,w,h,blobs)=>void for the calibration preview
  }
  start() {
    this.ws = new WebSocket(this.url); this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (e) => this._onFrame(e.data);
  }
  stop() { if (this.ws) this.ws.close(); }
  captureBackground() { if (this.frame) this.bg = this.frame.slice(); }
  setRoi(roi) { this.roi = roi; }
  _onFrame(buf) {
    const dv = new DataView(buf); this.w = dv.getUint32(0, true); this.h = dv.getUint32(4, true);
    const gray = new Uint8Array(buf, 8, this.w * this.h);
    let rgba = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) { rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=gray[i]; rgba[i*4+3]=255; }
    if (this.undist.on) {
      if (!this.undist.map) this.undist.map = buildUndistMap(this.w, this.h, this.undist.k1, this.undist.k2);
      rgba = applyUndist(rgba, this.w, this.h, this.undist.map);
    }
    this.frame = rgba;
    if (this.bg && this.bg.length !== rgba.length) this.bg = null;
    const detIn = this.bg ? subtractBackground(rgba, this.bg, this.w * this.h) : rgba;
    const { blobs } = findBlobs({ data: detIn, width: this.w, height: this.h }, this.opt);
    const mapped = blobs
      .map((b) => { const { u, v } = roiMap(b.cx, b.cy, this.w, this.h, this.roi); return { x: u, y: v, strength: Math.min(1, b.bright/255) }; })
      .filter((p) => p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1);
    for (const ev of this.tracker.update(mapped)) this.emit(ev);
    if (this.previewCb) this.previewCb(detIn, this.w, this.h, blobs);
  }
}
```

(Removed the `computeH`/`applyH` import and the `corners`/`H`/`setCorners` members.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd videoplaster && node --test js/leap-image-source.test.js` → PASS (3).
Run: `npm test` → PASS (now 17 total; homography/blobs/tracking unaffected).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/leap-image-source.js videoplaster/js/leap-image-source.test.js
git commit -m "feat: LeapImageSource rectangle ROI (roiMap) replaces corner homography"
```

---

### Task 2: Settings persistence module

**Files:**
- Create: `videoplaster/js/persist.js`

**Interfaces:**
- Produces: `loadSettings()`, `getSetting(key)`, `saveSetting(key, value)`, `bindControl(id, apply)`.

- [ ] **Step 1: Implement `persist.js`**

```js
// videoplaster/js/persist.js
// One localStorage object holds every control value + the capture roi.
const KEY = "vp_settings";

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

let _cache = loadSettings();

export function getSetting(key) { return key in _cache ? _cache[key] : undefined; }

export function saveSetting(key, value) {
  _cache[key] = value;
  localStorage.setItem(KEY, JSON.stringify(_cache));
}

// Restore a control's saved value (if any), apply(value) to sync live state,
// and save+apply on every change. Handles range, checkbox, and select.
export function bindControl(id, apply) {
  const el = document.getElementById(id);
  if (!el) return;
  const isCheck = el.type === "checkbox";
  const isSelect = el.tagName === "SELECT";
  const read = () => (isCheck ? el.checked : el.value);
  const write = (v) => { if (isCheck) el.checked = v; else el.value = v; };

  const saved = getSetting(id);
  if (saved !== undefined) write(saved);
  apply(read());

  const evt = (!isCheck && !isSelect) ? "input" : "change";
  el.addEventListener(evt, () => { const v = read(); saveSetting(id, v); apply(v); });
}
```

- [ ] **Step 2: Smoke-check it parses as ESM**

Run: `cd videoplaster && node --input-type=module -e "import('./js/persist.js').then(m=>console.log(Object.keys(m)))"`
Expected: prints `[ 'loadSettings', 'getSetting', 'saveSetting', 'bindControl' ]` (no `localStorage` at import time, so it loads in Node — `loadSettings()` is only called at module top via `_cache = loadSettings()`; guard handles missing `localStorage`).

> NOTE: `_cache = loadSettings()` runs at import. In Node there is no `localStorage`, so `localStorage.getItem` throws → the `try/catch` returns `{}`. Confirmed safe.

- [ ] **Step 3: Commit**

```bash
git add videoplaster/js/persist.js
git commit -m "feat: persist.js — unified localStorage settings + bindControl helper"
```

---

### Task 3: Wire all controls + ROI overlay & drag (end-to-end)

**Files:**
- Modify: `videoplaster/index.html` (one button)
- Modify: `videoplaster/js/app.js` (full rewire)

**Interfaces:**
- Consumes: `bindControl`, `getSetting`, `saveSetting` (Task 2); `LeapImageSource.roi`/`setRoi`/`roiMap` (Task 1); existing `WaterGL`, `WarpGL`, `MouseTouchSource`, `TouchEmitter`, `LeapZSource`.

- [ ] **Step 1: Relabel the calibration button in `index.html`**

Change line 30:

```html
<button id="calibCorners">CALIBRATE CORNERS</button>
```

to:

```html
<button id="resetZone">RESET ZONE</button>
```

- [ ] **Step 2: Rewrite `videoplaster/js/app.js`**

```js
// videoplaster/js/app.js
import { WaterGL } from "./water-gl.js";
import { WarpGL } from "./warp-gl.js";
import { MouseTouchSource } from "./touch-source.js";
import { TouchEmitter } from "./output.js";
import { LeapImageSource } from "./leap-image-source.js";
import { LeapZSource } from "./leap-z-source.js";
import { bindControl, getSetting, saveSetting } from "./persist.js";

const glCanvas = document.getElementById("glCanvas");
const status = document.getElementById("status");
console.log("app boot");

const gl = glCanvas.getContext("webgl");
const water = new WaterGL(gl);
const bg = document.createElement("canvas"); bg.width = bg.height = 2;
const bx = bg.getContext("2d"); bx.fillStyle = "#1b3a5a"; bx.fillRect(0,0,2,2);
water.setBackground(bg);

const warp = new WarpGL(gl, glCanvas.width, glCanvas.height);
const emitter = new TouchEmitter();
const mouse = new MouseTouchSource(glCanvas);

// holders so persisted detection/undistort settings survive even when no leap source is active yet
const detOpt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
const undistOpt = { on: false, k1: -0.3, k2: 0 };

let current = null;
let leapSrc = null;

function wire(src){ src.onTouch(ev => { if (ev.state !== "up") water.addDrop(ev.x, ev.y, ev.strength); emitter.send(ev); }); }

// ---- IR preview + capture-zone overlay -------------------------------------
const irPreview = document.getElementById("irPreview");
const irCtx = irPreview ? irPreview.getContext("2d") : null;

function drawRoi(roi, w, h){
  const rx = roi.x*w, ry = roi.y*h, rw = roi.w*w, rh = roi.h*h;
  irCtx.save();
  irCtx.fillStyle = "rgba(0,0,0,0.45)";            // dim outside the zone
  irCtx.beginPath(); irCtx.rect(0,0,w,h); irCtx.rect(rx,ry,rw,rh); irCtx.fill("evenodd");
  irCtx.restore();
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 2; irCtx.strokeRect(rx, ry, rw, rh);
  const hs = 10; irCtx.fillStyle = "#0f0";
  for (const [hx,hy] of [[rx,ry],[rx+rw,ry],[rx+rw,ry+rh],[rx,ry+rh]])
    irCtx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
}

function drawPreview(rgba, w, h, blobs, roi){
  if (!irCtx) return;
  irPreview.width = w; irPreview.height = h;
  const img = irCtx.createImageData(w, h); img.data.set(rgba); irCtx.putImageData(img, 0, 0);
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 1;
  for (const b of blobs) irCtx.strokeRect(b.cx-3, b.cy-3, 6, 6);
  if (roi) drawRoi(roi, w, h);
}

function attachLeapCalib(src){
  src.previewCb = (rgba, w, h, blobs) => drawPreview(rgba, w, h, blobs, src.roi);
}

// corner drag (normalized 0..1 coords; opposite corner stays fixed; axis-aligned)
let dragCorner = null;
function roiCorners(roi){
  return { tl:[roi.x,roi.y], tr:[roi.x+roi.w,roi.y], br:[roi.x+roi.w,roi.y+roi.h], bl:[roi.x,roi.y+roi.h] };
}
function previewNorm(e){
  const r = irPreview.getBoundingClientRect();
  return [ (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height ];
}
if (irPreview) {
  irPreview.addEventListener("mousedown", (e) => {
    if (!leapSrc) return;
    const [nx, ny] = previewNorm(e);
    const hit = Object.entries(roiCorners(leapSrc.roi))
      .find(([,[cx,cy]]) => Math.abs(cx-nx) < 0.04 && Math.abs(cy-ny) < 0.04);
    if (hit) dragCorner = hit[0];
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragCorner || !leapSrc) return;
    let [nx, ny] = previewNorm(e);
    nx = Math.max(0, Math.min(1, nx)); ny = Math.max(0, Math.min(1, ny));
    const roi = leapSrc.roi;
    let x0 = roi.x, y0 = roi.y, x1 = roi.x+roi.w, y1 = roi.y+roi.h;
    if (dragCorner === "tl") { x0 = nx; y0 = ny; }
    else if (dragCorner === "tr") { x1 = nx; y0 = ny; }
    else if (dragCorner === "br") { x1 = nx; y1 = ny; }
    else if (dragCorner === "bl") { x0 = nx; y1 = ny; }
    const MIN = 0.05;
    if (x1 - x0 < MIN || y1 - y0 < MIN) return;       // block inversion / too-small
    leapSrc.setRoi({ x:x0, y:y0, w:x1-x0, h:y1-y0 });
  });
  window.addEventListener("mouseup", () => {
    if (dragCorner && leapSrc) saveSetting("roi", leapSrc.roi);
    dragCorner = null;
  });
}

const captureBgBtn = document.getElementById("captureBg");
if (captureBgBtn) captureBgBtn.onclick = () => { if (leapSrc) { leapSrc.captureBackground(); status.textContent = "background captured"; } };
const resetZoneBtn = document.getElementById("resetZone");
if (resetZoneBtn) resetZoneBtn.onclick = () => { if (leapSrc) { leapSrc.setRoi({x:0,y:0,w:1,h:1}); saveSetting("roi", leapSrc.roi); status.textContent = "zone reset"; } };

// ---- source selection -------------------------------------------------------
function setSource(name){
  if (current) current.stop();
  leapSrc = null;
  if (name === "mouse") { current = mouse; }
  else if (name === "leap-ir") {
    current = new LeapImageSource();
    leapSrc = current;
    Object.assign(leapSrc.opt, detOpt);
    Object.assign(leapSrc.undist, undistOpt); leapSrc.undist.map = null;
    const savedRoi = getSetting("roi"); if (savedRoi) leapSrc.setRoi(savedRoi);
    attachLeapCalib(current);
  }
  else if (name === "leap-z") { current = new LeapZSource(); }
  if (!current) return;
  wire(current); current.start();
  status.textContent = `source: ${name}`;
}

// ---- persisted controls -----------------------------------------------------
const PIN_IDS = [["tl","x","tlx"],["tl","y","tly"],["tr","x","trx"],["tr","y","try"],
                 ["br","x","brx"],["br","y","bry"],["bl","x","blx"],["bl","y","bly"]];
for (const [k, axis, id] of PIN_IDS) bindControl(id, (v) => { warp.pins[k][axis] = parseFloat(v); });

bindControl("waterIntensity", (v) => { water.intensity = parseFloat(v); });
bindControl("waterDamp",      (v) => { water.damp = parseFloat(v); });
bindControl("waterRadius",    (v) => { water.radius = parseFloat(v); });

const DET = [["threshold","threshold",(v)=>parseFloat(v)],["minArea","minArea",(v)=>parseFloat(v)],
             ["maxArea","maxArea",(v)=>parseFloat(v)],["blur","blurAmt",(v)=>parseInt(v,10)],
             ["erosion","erosionAmt",(v)=>parseInt(v,10)]];
for (const [id, key, parse] of DET)
  bindControl(id, (v) => { detOpt[key] = parse(v); if (leapSrc) leapSrc.opt[key] = detOpt[key]; });

bindControl("invert", (v) => { detOpt.invert = v; if (leapSrc) leapSrc.opt.invert = v; });

bindControl("undistort", (v) => { undistOpt.on = v; if (leapSrc) { leapSrc.undist.on = v; leapSrc.undist.map = null; } });
bindControl("undistK1", (v) => { undistOpt.k1 = parseFloat(v); if (leapSrc) { leapSrc.undist.k1 = undistOpt.k1; leapSrc.undist.map = null; } });
bindControl("undistK2", (v) => { undistOpt.k2 = parseFloat(v); if (leapSrc) { leapSrc.undist.k2 = undistOpt.k2; leapSrc.undist.map = null; } });

// source last so setSource sees water/warp/holders ready; restores last source or defaults to mouse
bindControl("sourceSel", (v) => setSource(v));

status.textContent = `canvas ${glCanvas.width}×${glCanvas.height} — modules OK`;

(function loop(){ water.step(); const tex = water.renderToTexture(); warp.draw(tex); requestAnimationFrame(loop); })();
```

- [ ] **Step 3: Run unit suites (regression)**

Run: `cd videoplaster && npm test` → PASS (17). `app.js`/`index.html` are not imported by tests; this just confirms nothing else broke.

- [ ] **Step 4: Manual end-to-end verification**

Stack is already running (bridge :7681 + http :8000). Hard-reload `http://localhost:8000/`.
1. Move several sliders (water intensity, threshold, etc.), toggle INVERT, change SOURCE to LEAP IR. Reload → every control keeps its last value and SOURCE reopens on LEAP IR.
2. In LEAP IR: the IR feed shows a green rectangle with 4 corner handles; area outside is dimmed. Drag a handle → rectangle resizes axis-aligned, opposite corner fixed. Reload → zone persists.
3. RESET ZONE → rectangle returns to full frame (and persists).
4. Confirm only blobs whose centers fall inside the rectangle produce water drops / TUIO cursors (blobs outside are ignored).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/index.html videoplaster/js/app.js
git commit -m "feat: persist all controls + draggable green capture-zone rectangle on IR preview"
```

---

## Self-review notes

- **Spec coverage:** persistence of all controls + source (Task 3 `bindControl` calls incl. `sourceSel`); rectangle ROI + linear map (Task 1); green overlay + dim-outside + drag + RESET ZONE (Task 3); `roiMap` unit test (Task 1). All covered.
- **Type consistency:** `roi` shape `{x,y,w,h}` normalized everywhere (`LeapImageSource`, `roiMap`, `drawRoi`, drag, `saveSetting("roi", ...)`). `bindControl(id, apply)` signature consistent across all call sites. `getSetting`/`saveSetting` keys: control ids + `"roi"`.
- **Removed:** `vp_pins`/`vp_corners` keys, `cornerMode`/`cornerPts` click flow, `computeH`/`applyH` use in `leap-image-source.js`.
- **Note (pre-existing, out of scope):** `WaterGL.addDrop` hardcodes drop radius `0.03`; the RADIUS slider sets `water.radius` which `WaterGL` ignores. Left as-is.
