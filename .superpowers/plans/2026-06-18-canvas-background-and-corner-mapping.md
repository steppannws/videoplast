# Canvas Background + Projection Corner Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load an image/video as the canvas background and keystone-map the canvas to a projector via draggable corner pins, in the v11 monospace style with English labels.

**Architecture:** A new `BackgroundCanvas` draws the loaded media (or a default grid/title) onto a 2D canvas fed each frame into the existing WaterGL→WarpGL pipeline as the background. `WarpGL` pins become offsets from the base corners; a transparent overlay canvas draws v11 `+` handles that drag to update those offsets. WIDTH/HEIGHT sliders resize the canvas. `bindControl` gains a value-readout formatter.

**Tech Stack:** Vanilla ES-module JS + WebGL (browser, no build), `node --test` for pure helpers.

## Global Constraints

- No build step. Browser loads `<script type="module">`; Node runs the same `.js` as ESM for tests.
- Commits: plain messages, no attribution footer.
- Branch `feature/canvas-background-and-corner-mapping` (already checked out).
- Existing suites stay green: `npm test` (17) + `pytest bridge/test_tuio.py` (3).
- Pins are OFFSETS (range −400…400, `0px` = no warp). `+` handles hidden when media loaded (v11).
- English labels in UI; default canvas title `VIDEOPLASTER 02` / `armandofrezzedurand.com`.

---

### Task 1: `bindControl` value readouts

**Files:**
- Modify: `videoplaster/js/persist.js`

**Interfaces:**
- Produces: `bindControl(id, apply, fmt?)` — if an element `id+"v"` exists and `fmt` is given, its text is set to `fmt(value)` on load and on every change. Two-arg calls unchanged.

- [ ] **Step 1: Replace `bindControl`**

In `videoplaster/js/persist.js` replace the `bindControl` function with:

```js
// Restore a control's saved value (if any), apply(value) to sync live state,
// save+apply on change, and (if fmt given + an `id+"v"` element exists) update its readout.
export function bindControl(id, apply, fmt) {
  const el = document.getElementById(id);
  if (!el) return;
  const isCheck = el.type === "checkbox";
  const isSelect = el.tagName === "SELECT";
  const read = () => (isCheck ? el.checked : el.value);
  const write = (v) => { if (isCheck) el.checked = v; else el.value = v; };
  const readout = document.getElementById(id + "v");
  const showVal = (v) => { if (readout && fmt) readout.textContent = fmt(v); };

  const saved = getSetting(id);
  if (saved !== undefined) write(saved);
  apply(read()); showVal(read());

  const evt = (!isCheck && !isSelect) ? "input" : "change";
  el.addEventListener(evt, () => { const v = read(); saveSetting(id, v); apply(v); showVal(v); });
}
```

- [ ] **Step 2: Smoke-check ESM parse**

Run: `cd videoplaster && node --input-type=module -e "import('./js/persist.js').then(m=>console.log(Object.keys(m)))"`
Expected: `[ 'loadSettings', 'getSetting', 'saveSetting', 'bindControl' ]`

- [ ] **Step 3: Commit**

```bash
git add videoplaster/js/persist.js
git commit -m "feat: bindControl optional value-readout formatter"
```

---

### Task 2: `WarpGL` offset pins + resize + `cornerPositions` (TDD)

**Files:**
- Modify: `videoplaster/js/warp-gl.js`
- Test: `videoplaster/js/warp-gl.test.js` (create)

**Interfaces:**
- Produces: pure `cornerPositions(w, h, off) -> {tl,tr,br,bl}` (each `{x,y}`); `WarpGL.off`, `WarpGL.setPinOffset(k, axis, v)`, `WarpGL.resize(w, h)`, `WarpGL.cornerPositions()`.

- [ ] **Step 1: Write the failing test**

```js
// videoplaster/js/warp-gl.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cornerPositions } from "./warp-gl.js";

const zero = { tl:{x:0,y:0}, tr:{x:0,y:0}, br:{x:0,y:0}, bl:{x:0,y:0} };

test("zero offsets give the base corners", () => {
  const c = cornerPositions(800, 500, zero);
  assert.deepEqual(c, { tl:{x:0,y:0}, tr:{x:800,y:0}, br:{x:800,y:500}, bl:{x:0,y:500} });
});

test("offsets shift each corner from its base", () => {
  const off = { tl:{x:10,y:5}, tr:{x:-20,y:0}, br:{x:0,y:-30}, bl:{x:7,y:8} };
  const c = cornerPositions(800, 500, off);
  assert.deepEqual(c.tl, { x:10, y:5 });
  assert.deepEqual(c.tr, { x:780, y:0 });
  assert.deepEqual(c.br, { x:800, y:470 });
  assert.deepEqual(c.bl, { x:7, y:508 });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd videoplaster && node --test js/warp-gl.test.js`
Expected: FAIL — `cornerPositions` is not exported.

- [ ] **Step 3: Implement in `warp-gl.js`**

Add the pure export near the top (after the imports) and rewrite the class members. Full file:

```js
// videoplaster/js/warp-gl.js
import { computeH, inv3 } from "./homography.js";
const VS = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv=(a_pos+1.0)*0.5; gl_Position=vec4(a_pos,0.,1.); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; uniform mat3 u_Hinv; uniform vec2 u_res; varying vec2 v_uv;
void main(){ vec2 fp=vec2(v_uv.x*u_res.x,(1.0-v_uv.y)*u_res.y); vec3 h=u_Hinv*vec3(fp,1.0); vec2 sp=h.xy/h.z;
  vec2 uv=vec2(sp.x/u_res.x,1.0-sp.y/u_res.y);
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) gl_FragColor=vec4(0,0,0,1); else gl_FragColor=texture2D(u_tex,uv); }`;

// Pure: destination corner positions = base corners + per-corner pixel offsets.
export function cornerPositions(w, h, off) {
  return {
    tl: { x: 0 + off.tl.x, y: 0 + off.tl.y },
    tr: { x: w + off.tr.x, y: 0 + off.tr.y },
    br: { x: w + off.br.x, y: h + off.br.y },
    bl: { x: 0 + off.bl.x, y: h + off.bl.y },
  };
}

function mk(gl, t, s) {
  const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("warp shader: " + gl.getShaderInfoLog(sh));
  return sh;
}

export class WarpGL {
  constructor(gl, w, h){ this.gl=gl; this.w=w; this.h=h;
    this.prog=gl.createProgram(); gl.attachShader(this.prog,mk(gl,gl.VERTEX_SHADER,VS));
    gl.attachShader(this.prog,mk(gl,gl.FRAGMENT_SHADER,FS)); gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error("warp link: " + gl.getProgramInfoLog(this.prog));
    this.quad=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    this.uHinv=gl.getUniformLocation(this.prog,"u_Hinv"); this.uRes=gl.getUniformLocation(this.prog,"u_res");
    // per-corner pixel offsets from the base corners; all zero = identity (no keystone)
    this.off={ tl:{x:0,y:0}, tr:{x:0,y:0}, br:{x:0,y:0}, bl:{x:0,y:0} }; }
  setPinOffset(k, axis, v){ this.off[k][axis]=v; }
  resize(w, h){ this.w=w; this.h=h; }
  cornerPositions(){ return cornerPositions(this.w, this.h, this.off); }
  draw(srcTex){ const gl=this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,this.w,this.h);
    gl.useProgram(this.prog); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    const loc=gl.getAttribLocation(this.prog,"a_pos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const src=[{x:0,y:0},{x:this.w,y:0},{x:this.w,y:this.h},{x:0,y:this.h}];
    const c=this.cornerPositions();
    const dst=[c.tl,c.tr,c.br,c.bl];
    const H=computeH(src,dst), Hi=inv3(H);
    gl.uniformMatrix3fv(this.uHinv,false,[Hi[0],Hi[3],Hi[6],Hi[1],Hi[4],Hi[7],Hi[2],Hi[5],Hi[8]]);
    gl.uniform2f(this.uRes,this.w,this.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,srcTex);
    gl.uniform1i(gl.getUniformLocation(this.prog,"u_tex"),0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4); }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd videoplaster && node --test js/warp-gl.test.js` → PASS (2).
Run: `npm test` → PASS (19 total).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/warp-gl.js videoplaster/js/warp-gl.test.js
git commit -m "feat: WarpGL offset pins + resize + cornerPositions (with tests)"
```

---

### Task 3: `BackgroundCanvas` module (image/video/default grid) + `fitDims` (TDD)

**Files:**
- Create: `videoplaster/js/background.js`
- Test: `videoplaster/js/background.test.js` (create)

**Interfaces:**
- Produces: pure `fitDims(sw, sh, W, H) -> {dw, dh}` (aspect-fill); `BackgroundCanvas` with `.canvas`, `.hasMedia`, `loadFile(file)`, `clear()`, `setTransform({scaleX,scaleY,rot})`, `resize(w,h)`, `draw() -> canvas`.

- [ ] **Step 1: Write the failing test (pure `fitDims`)**

```js
// videoplaster/js/background.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitDims } from "./background.js";

test("square source covers a wide canvas (fills height-overflow)", () => {
  assert.deepEqual(fitDims(100, 100, 800, 500), { dw: 800, dh: 800 });
});
test("wide source covers a less-wide canvas (fills width-overflow)", () => {
  assert.deepEqual(fitDims(400, 100, 800, 500), { dw: 2000, dh: 500 });
});
test("matching aspect maps exactly to canvas", () => {
  assert.deepEqual(fitDims(1600, 1000, 800, 500), { dw: 800, dh: 500 });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd videoplaster && node --test js/background.test.js`
Expected: FAIL — `fitDims` not exported.

- [ ] **Step 3: Implement `background.js`**

```js
// videoplaster/js/background.js
const TITLE = "VIDEOPLASTER 02";
const SUBTITLE = "armandofrezzedurand.com";

// aspect-fill (cover): preserve source aspect while covering W x H. (v11 drawSource math)
export function fitDims(sw, sh, W, H) {
  const ar = sw / sh, cAr = W / H;
  return ar > cAr ? { dw: H * ar, dh: H } : { dw: W, dh: W / ar };
}

export class BackgroundCanvas {
  constructor(w, h) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d");
    this.img = null; this.video = null; this.hasMedia = false;
    this.scaleX = 1; this.scaleY = 1; this.rot = 0;
  }
  resize(w, h) { this.canvas.width = w; this.canvas.height = h; }
  loadFile(file) {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
      if (this.video) { this.video.pause(); this.video.src = ""; }
      const v = document.createElement("video");
      v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.play();
      this.video = v; this.img = null; this.hasMedia = true;
    } else {
      const i = new Image();
      i.onload = () => { this.img = i; this.video = null; this.hasMedia = true; };
      i.src = url;
    }
  }
  clear() { this.img = null; if (this.video) { this.video.pause(); } this.video = null; this.hasMedia = false; }
  setTransform({ scaleX, scaleY, rot }) {
    if (scaleX !== undefined) this.scaleX = scaleX;
    if (scaleY !== undefined) this.scaleY = scaleY;
    if (rot !== undefined) this.rot = rot;
  }
  draw() {
    const W = this.canvas.width, H = this.canvas.height, ctx = this.ctx;
    const media = this.video || this.img;
    const ready = media && (this.video ? this.video.readyState >= 2 : true);
    if (this.hasMedia && ready) {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(this.rot * Math.PI / 180);
      ctx.scale(this.scaleX, this.scaleY);
      const sw = media.videoWidth || media.naturalWidth || W;
      const sh = media.videoHeight || media.naturalHeight || H;
      const { dw, dh } = fitDims(sw, sh, W, H);
      ctx.drawImage(media, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    } else {
      this._drawDefault(W, H);
    }
    return this.canvas;
  }
  _drawDefault(W, H) {
    const ctx = this.ctx;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // L-shaped registration brackets in the 4 corners
    const b = 22; ctx.lineWidth = 1.5;
    const bracket = (cx, cy, dx, dy) => { ctx.beginPath(); ctx.moveTo(cx + dx * b, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * b); ctx.stroke(); };
    bracket(0, 0, 1, 1); bracket(W, 0, -1, 1); bracket(W, H, -1, -1); bracket(0, H, 1, -1);
    // center title
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "bold 15px monospace";
    ctx.fillText(TITLE, W / 2, H / 2 - 8);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "10px monospace";
    ctx.fillText(SUBTITLE, W / 2, H / 2 + 12);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd videoplaster && node --test js/background.test.js` → PASS (3).
Run: `npm test` → PASS (22 total).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/background.js videoplaster/js/background.test.js
git commit -m "feat: BackgroundCanvas (image/video + default grid) with fitDims tests"
```

---

### Task 4: `index.html` — v11 restyle, `#pinCanvas`, CANVAS/IMAGE/PIN controls, readouts

**Files:**
- Modify: `videoplaster/index.html` (full rewrite of body + style)

**Interfaces:**
- Produces (DOM ids consumed by app.js): `pinCanvas`; `canvasW/canvasH` (+`v`); `bgFile`, `bgClear`, `imgScaleX/imgScaleY/imgRot` (+`v`); pin sliders `tlx/tly/trx/try/brx/bry/blx/bly` (range −400…400) (+`v`); water `waterIntensity/waterRadius/waterDamp` (+`v`); existing LEAP IR ids unchanged (+`v` readouts added).

- [ ] **Step 1: Replace `videoplaster/index.html` entirely**

```html
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VIDEOPLASTER 02</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#000;font-family:monospace;color:#888;padding:16px}
#wrap{position:relative;display:inline-block}
#glCanvas{display:block;touch-action:none}
#pinCanvas{position:absolute;left:0;top:0;pointer-events:none}
#ui{margin-top:12px;display:flex;flex-direction:column}
.section{border-top:.5px solid #222;padding:10px 0;display:flex;flex-direction:column;gap:8px}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.slabel{font-size:9px;letter-spacing:3px;color:#555;min-width:84px;text-transform:uppercase}
.ctrl{display:flex;align-items:center;gap:5px}
.ctrl label{font-size:10px;color:#666;letter-spacing:1px}
.val{font-size:10px;color:#555;min-width:42px}
input[type=range]{width:80px;accent-color:#555;cursor:pointer}
select,button,.fbtn{font-family:monospace;font-size:10px;background:#111;color:#999;border:.5px solid #333;padding:3px 8px;cursor:pointer}
.fbtn input{display:none}
#irPreview{border:.5px solid #222;margin-top:6px}
</style></head>
<body>
<div id="wrap">
  <canvas id="glCanvas" width="800" height="500"></canvas>
  <canvas id="pinCanvas" width="800" height="500"></canvas>
</div>
<div id="ui">
  <div class="section"><div class="row">
    <span class="slabel">Canvas</span>
    <div class="ctrl"><label>WIDTH</label><input type="range" id="canvasW" min="200" max="1400" step="10" value="800"><span class="val" id="canvasWv">800px</span></div>
    <div class="ctrl"><label>HEIGHT</label><input type="range" id="canvasH" min="150" max="900" step="10" value="500"><span class="val" id="canvasHv">500px</span></div>
  </div></div>

  <div class="section"><div class="row">
    <span class="slabel">Source</span>
    <select id="sourceSel"><option value="mouse">MOUSE</option><option value="leap-ir">LEAP IR</option><option value="leap-z">LEAP Z</option></select>
  </div></div>

  <div class="section"><div class="row">
    <span class="slabel">Image</span>
    <label class="fbtn">LOAD<input type="file" accept="image/*,video/*" id="bgFile"></label>
    <button id="bgClear">CLEAR</button>
    <div class="ctrl"><label>SCALE X</label><input type="range" id="imgScaleX" min="0.1" max="3" step="0.05" value="1"><span class="val" id="imgScaleXv">1.0x</span></div>
    <div class="ctrl"><label>SCALE Y</label><input type="range" id="imgScaleY" min="0.1" max="3" step="0.05" value="1"><span class="val" id="imgScaleYv">1.0x</span></div>
    <div class="ctrl"><label>ROT</label><input type="range" id="imgRot" min="-180" max="180" step="1" value="0"><span class="val" id="imgRotv">0</span></div>
  </div></div>

  <div class="section"><div class="row">
    <span class="slabel">Water</span>
    <div class="ctrl"><label>INTENSITY</label><input type="range" id="waterIntensity" min="0" max="2" step="0.01" value="0.5"><span class="val" id="waterIntensityv">0.50</span></div>
    <div class="ctrl"><label>RADIUS</label><input type="range" id="waterRadius" min="0.005" max="0.15" step="0.005" value="0.03"><span class="val" id="waterRadiusv">0.030</span></div>
    <div class="ctrl"><label>VISCOSITY</label><input type="range" id="waterDamp" min="0.9" max="0.999" step="0.001" value="0.985"><span class="val" id="waterDampv">0.985</span></div>
  </div></div>

  <div class="section">
    <div class="row"><span class="slabel">Pin TL</span>
      <div class="ctrl"><label>X</label><input type="range" id="tlx" min="-400" max="400" step="1" value="0"><span class="val" id="tlxv">0px</span></div>
      <div class="ctrl"><label>Y</label><input type="range" id="tly" min="-400" max="400" step="1" value="0"><span class="val" id="tlyv">0px</span></div></div>
    <div class="row"><span class="slabel">Pin TR</span>
      <div class="ctrl"><label>X</label><input type="range" id="trx" min="-400" max="400" step="1" value="0"><span class="val" id="trxv">0px</span></div>
      <div class="ctrl"><label>Y</label><input type="range" id="try" min="-400" max="400" step="1" value="0"><span class="val" id="tryv">0px</span></div></div>
    <div class="row"><span class="slabel">Pin BR</span>
      <div class="ctrl"><label>X</label><input type="range" id="brx" min="-400" max="400" step="1" value="0"><span class="val" id="brxv">0px</span></div>
      <div class="ctrl"><label>Y</label><input type="range" id="bry" min="-400" max="400" step="1" value="0"><span class="val" id="bryv">0px</span></div></div>
    <div class="row"><span class="slabel">Pin BL</span>
      <div class="ctrl"><label>X</label><input type="range" id="blx" min="-400" max="400" step="1" value="0"><span class="val" id="blxv">0px</span></div>
      <div class="ctrl"><label>Y</label><input type="range" id="bly" min="-400" max="400" step="1" value="0"><span class="val" id="blyv">0px</span></div></div>
  </div>

  <div class="section">
    <div class="row">
      <span class="slabel">Leap IR</span>
      <button id="captureBg">CAPTURE BG</button>
      <button id="resetZone">RESET ZONE</button>
      <button id="restartIr">RESTART IR</button>
      <label class="ctrl"><input type="checkbox" id="invert"> INVERT</label>
      <div class="ctrl"><label>THRESHOLD</label><input type="range" id="threshold" min="0" max="255" step="1" value="40"><span class="val" id="thresholdv">40</span></div>
      <div class="ctrl"><label>MIN AREA</label><input type="range" id="minArea" min="0" max="500" step="1" value="20"><span class="val" id="minAreav">20</span></div>
      <div class="ctrl"><label>MAX AREA</label><input type="range" id="maxArea" min="100" max="20000" step="100" value="8000"><span class="val" id="maxAreav">8000</span></div>
      <div class="ctrl"><label>BLUR</label><input type="range" id="blur" min="0" max="6" step="1" value="1"><span class="val" id="blurv">1</span></div>
      <div class="ctrl"><label>EROSION</label><input type="range" id="erosion" min="0" max="6" step="1" value="2"><span class="val" id="erosionv">2</span></div>
      <label class="ctrl"><input type="checkbox" id="undistort"> FISHEYE</label>
      <div class="ctrl"><label>K1</label><input type="range" id="undistK1" min="-1" max="1" step="0.01" value="-0.3"><span class="val" id="undistK1v">-0.30</span></div>
      <div class="ctrl"><label>K2</label><input type="range" id="undistK2" min="-0.5" max="0.5" step="0.01" value="0"><span class="val" id="undistK2v">0.00</span></div>
    </div>
    <div class="row"><canvas id="irPreview" width="320" height="240"></canvas></div>
  </div>

  <div class="section"><span class="val" id="status" style="min-width:auto">ready</span></div>
</div>
<script type="module" src="js/app.js"></script>
</body></html>
```

- [ ] **Step 2: Commit**

```bash
git add videoplaster/index.html
git commit -m "feat: v11-style monospace control bar (English) + pinCanvas + canvas/image/pin controls"
```

---

### Task 5: `app.js` — wire background, pin overlay/drag, canvas resize, readouts, loop

**Files:**
- Modify: `videoplaster/js/app.js` (full rewrite)

**Interfaces:**
- Consumes: `BackgroundCanvas` (Task 3); `WarpGL.off/setPinOffset/resize/cornerPositions` (Task 2); `bindControl(id, apply, fmt?)` (Task 1); the DOM ids from Task 4.

- [ ] **Step 1: Replace `videoplaster/js/app.js` entirely**

```js
// videoplaster/js/app.js
import { WaterGL } from "./water-gl.js";
import { WarpGL } from "./warp-gl.js";
import { MouseTouchSource } from "./touch-source.js";
import { TouchEmitter } from "./output.js";
import { LeapImageSource } from "./leap-image-source.js";
import { LeapZSource } from "./leap-z-source.js";
import { BackgroundCanvas } from "./background.js";
import { bindControl, getSetting, saveSetting } from "./persist.js";

const glCanvas = document.getElementById("glCanvas");
const pinCanvas = document.getElementById("pinCanvas");
const pinCtx = pinCanvas ? pinCanvas.getContext("2d") : null;
const status = document.getElementById("status");
console.log("app boot");

const gl = glCanvas.getContext("webgl");
const water = new WaterGL(gl);
const bg = new BackgroundCanvas(glCanvas.width, glCanvas.height);
const warp = new WarpGL(gl, glCanvas.width, glCanvas.height);
const emitter = new TouchEmitter();
const mouse = new MouseTouchSource(glCanvas);

const detOpt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
const undistOpt = { on: false, k1: -0.3, k2: 0 };

let current = null;
let leapSrc = null;

function wire(src){ src.onTouch(ev => { if (ev.state !== "up") water.addDrop(ev.x, ev.y, ev.strength); emitter.send(ev); }); }

// ---- canvas size ------------------------------------------------------------
function setCanvasSize(w, h){
  glCanvas.width = w; glCanvas.height = h;
  if (pinCanvas) { pinCanvas.width = w; pinCanvas.height = h; }
  bg.resize(w, h);
  warp.resize(w, h);
  gl.viewport(0, 0, w, h);
}
let cw = glCanvas.width, ch = glCanvas.height;

// ---- projection pin handles (overlay) + drag --------------------------------
const PIN_HIT = 18;
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
let pinDrag = null;
function canvasPos(e){
  const r = glCanvas.getBoundingClientRect();
  const sx = glCanvas.width / r.width, sy = glCanvas.height / r.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
}
function nearPin(px, py){
  const pp = warp.cornerPositions();
  for (const k of ["tl","tr","br","bl"]) if (Math.hypot(px - pp[k].x, py - pp[k].y) < PIN_HIT) return k;
  return null;
}
function baseCorner(k){ return ({ tl:{x:0,y:0}, tr:{x:warp.w,y:0}, br:{x:warp.w,y:warp.h}, bl:{x:0,y:warp.h} })[k]; }
const clampOff = (v) => Math.max(-400, Math.min(400, v));
function syncPinSlider(k, axis, val){
  const id = k + axis;                            // tl + x => "tlx"
  const el = document.getElementById(id);
  if (el){ el.value = val; const r = document.getElementById(id + "v"); if (r) r.textContent = Math.round(val) + "px"; }
  warp.setPinOffset(k, axis, val);
  saveSetting(id, String(val));
}
function startPinDrag(e){
  if (bg.hasMedia) return;
  const p = canvasPos(e), k = nearPin(p.x, p.y);
  if (k){ pinDrag = k; e.stopImmediatePropagation(); e.preventDefault(); }  // beat MouseTouchSource on glCanvas
}
function movePinDrag(e){
  if (!pinDrag) return;
  const p = canvasPos(e), b = baseCorner(pinDrag);
  syncPinSlider(pinDrag, "x", clampOff(p.x - b.x));
  syncPinSlider(pinDrag, "y", clampOff(p.y - b.y));
}
// capture phase so this runs before MouseTouchSource's (later-registered) bubble listener
glCanvas.addEventListener("mousedown", startPinDrag, true);
window.addEventListener("mousemove", movePinDrag);
window.addEventListener("mouseup", () => { pinDrag = null; });
glCanvas.addEventListener("touchstart", startPinDrag, { capture: true, passive: false });
window.addEventListener("touchmove", (e) => { if (pinDrag){ movePinDrag(e); e.preventDefault(); } }, { passive: false });
window.addEventListener("touchend", () => { pinDrag = null; });

// ---- IR preview + capture-zone overlay --------------------------------------
const irPreview = document.getElementById("irPreview");
const irCtx = irPreview ? irPreview.getContext("2d") : null;
function drawRoi(roi, w, h){
  const rx = roi.x*w, ry = roi.y*h, rw = roi.w*w, rh = roi.h*h;
  irCtx.save();
  irCtx.fillStyle = "rgba(0,0,0,0.45)";
  irCtx.beginPath(); irCtx.rect(0,0,w,h); irCtx.rect(rx,ry,rw,rh); irCtx.fill("evenodd");
  irCtx.restore();
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 2; irCtx.strokeRect(rx, ry, rw, rh);
  const hs = 10; irCtx.fillStyle = "#0f0";
  for (const [hx,hy] of [[rx,ry],[rx+rw,ry],[rx+rw,ry+rh],[rx,ry+rh]]) irCtx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
}
function drawPreview(rgba, w, h, blobs, roi){
  if (!irCtx) return;
  if (irPreview.width !== w || irPreview.height !== h) { irPreview.width = w; irPreview.height = h; }
  const img = irCtx.createImageData(w, h); img.data.set(rgba); irCtx.putImageData(img, 0, 0);
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 1;
  for (const b of blobs) irCtx.strokeRect(b.cx-3, b.cy-3, 6, 6);
  if (roi) drawRoi(roi, w, h);
}
function attachLeapCalib(src){ src.previewCb = (rgba, w, h, blobs) => drawPreview(rgba, w, h, blobs, src.roi); }
let dragCorner = null;
function roiCorners(roi){ return { tl:[roi.x,roi.y], tr:[roi.x+roi.w,roi.y], br:[roi.x+roi.w,roi.y+roi.h], bl:[roi.x,roi.y+roi.h] }; }
function previewNorm(e){ const r = irPreview.getBoundingClientRect(); return [ (e.clientX-r.left)/r.width, (e.clientY-r.top)/r.height ]; }
if (irPreview) {
  irPreview.addEventListener("mousedown", (e) => {
    if (!leapSrc) return;
    const [nx, ny] = previewNorm(e);
    const hit = Object.entries(roiCorners(leapSrc.roi)).find(([,[cx,cy]]) => Math.abs(cx-nx) < 0.04 && Math.abs(cy-ny) < 0.04);
    if (hit) dragCorner = hit[0];
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragCorner || !leapSrc) return;
    let [nx, ny] = previewNorm(e);
    nx = Math.max(0, Math.min(1, nx)); ny = Math.max(0, Math.min(1, ny));
    const roi = leapSrc.roi;
    let x0 = roi.x, y0 = roi.y, x1 = roi.x+roi.w, y1 = roi.y+roi.h;
    if (dragCorner === "tl") { x0 = nx; y0 = ny; } else if (dragCorner === "tr") { x1 = nx; y0 = ny; }
    else if (dragCorner === "br") { x1 = nx; y1 = ny; } else if (dragCorner === "bl") { x0 = nx; y1 = ny; }
    const MIN = 0.05; if (x1 - x0 < MIN || y1 - y0 < MIN) return;
    leapSrc.setRoi({ x:x0, y:y0, w:x1-x0, h:y1-y0 });
  });
  window.addEventListener("mouseup", () => { if (dragCorner && leapSrc) saveSetting("roi", leapSrc.roi); dragCorner = null; });
}
const captureBgBtn = document.getElementById("captureBg");
if (captureBgBtn) captureBgBtn.onclick = () => { if (leapSrc) { leapSrc.captureBackground(); status.textContent = "background captured"; } };
const resetZoneBtn = document.getElementById("resetZone");
if (resetZoneBtn) resetZoneBtn.onclick = () => { if (leapSrc) { leapSrc.setRoi({x:0,y:0,w:1,h:1}); saveSetting("roi", leapSrc.roi); status.textContent = "zone reset"; } };
const restartIrBtn = document.getElementById("restartIr");
if (restartIrBtn) restartIrBtn.onclick = () => { if (leapSrc) { leapSrc.restart(); status.textContent = "IR restarting"; } };

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
    leapSrc.statusCb = (s) => { status.textContent = "IR: " + s; };
    attachLeapCalib(current);
  }
  else if (name === "leap-z") { current = new LeapZSource(); }
  if (!current) return;
  wire(current); current.start();
  status.textContent = `source: ${name}`;
}

// ---- background (image/video) controls --------------------------------------
const bgFile = document.getElementById("bgFile");
if (bgFile) bgFile.addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) bg.loadFile(f); });
const bgClear = document.getElementById("bgClear");
if (bgClear) bgClear.onclick = () => bg.clear();
bindControl("imgScaleX", v => bg.setTransform({ scaleX: parseFloat(v) }), v => (+v).toFixed(1) + "x");
bindControl("imgScaleY", v => bg.setTransform({ scaleY: parseFloat(v) }), v => (+v).toFixed(1) + "x");
bindControl("imgRot",    v => bg.setTransform({ rot: parseFloat(v) }),    v => String(Math.round(v)));

// ---- canvas size controls ---------------------------------------------------
bindControl("canvasW", v => { cw = parseInt(v,10); setCanvasSize(cw, ch); }, v => Math.round(v) + "px");
bindControl("canvasH", v => { ch = parseInt(v,10); setCanvasSize(cw, ch); }, v => Math.round(v) + "px");

// ---- projection pins (sliders, two-way with drag) ---------------------------
const PIN_IDS = [["tl","x","tlx"],["tl","y","tly"],["tr","x","trx"],["tr","y","try"],
                 ["br","x","brx"],["br","y","bry"],["bl","x","blx"],["bl","y","bly"]];
for (const [k, axis, id] of PIN_IDS) bindControl(id, (v) => { warp.setPinOffset(k, axis, parseFloat(v)); }, v => Math.round(v) + "px");

// ---- water controls ---------------------------------------------------------
bindControl("waterIntensity", v => { water.intensity = parseFloat(v); }, v => (+v).toFixed(2));
bindControl("waterDamp",      v => { water.damp = parseFloat(v); },      v => (+v).toFixed(3));
bindControl("waterRadius",    v => { water.radius = parseFloat(v); },    v => (+v).toFixed(3));

// ---- detection controls -----------------------------------------------------
const DET = [["threshold","threshold",(v)=>parseFloat(v)],["minArea","minArea",(v)=>parseFloat(v)],
             ["maxArea","maxArea",(v)=>parseFloat(v)],["blur","blurAmt",(v)=>parseInt(v,10)],
             ["erosion","erosionAmt",(v)=>parseInt(v,10)]];
for (const [id, key, parse] of DET)
  bindControl(id, (v) => { detOpt[key] = parse(v); if (leapSrc) leapSrc.opt[key] = detOpt[key]; }, v => String(Math.round(v)));

bindControl("invert", (v) => { detOpt.invert = v; if (leapSrc) leapSrc.opt.invert = v; });
bindControl("undistort", (v) => { undistOpt.on = v; if (leapSrc) { leapSrc.undist.on = v; leapSrc.undist.map = null; } });
bindControl("undistK1", (v) => { undistOpt.k1 = parseFloat(v); if (leapSrc) { leapSrc.undist.k1 = undistOpt.k1; leapSrc.undist.map = null; } }, v => (+v).toFixed(2));
bindControl("undistK2", (v) => { undistOpt.k2 = parseFloat(v); if (leapSrc) { leapSrc.undist.k2 = undistOpt.k2; leapSrc.undist.map = null; } }, v => (+v).toFixed(2));

// source last so setSource sees everything ready; restores last source or defaults to mouse
bindControl("sourceSel", (v) => setSource(v));

status.textContent = `canvas ${glCanvas.width}x${glCanvas.height} ready`;

(function loop(){
  bg.draw();
  water.setBackground(bg.canvas);
  water.step();
  const tex = water.renderToTexture();
  warp.draw(tex);
  drawPins();
  requestAnimationFrame(loop);
})();
```

- [ ] **Step 2: Unit suites (regression)**

Run: `cd videoplaster && npm test` → PASS (22). app.js/index.html are not imported by tests; this confirms nothing else broke.

- [ ] **Step 3: Manual end-to-end verification (live app)**

Ensure a bridge + static server are running (`./run.sh`, or reuse the running ones). Hard-reload `http://localhost:8000/` (clear cache — ES modules cache aggressively).
1. Default canvas shows grid + 4 corner brackets + `VIDEOPLASTER 02` title; ripples (mouse drag) distort it; `+` handles labelled TL/TR/BR/BL sit at the corners.
2. Drag a `+` handle → that corner keystones (grid warps); the matching PIN slider + `0px` readout update; no extra ripple spawns from the drag. Reload (cache-cleared) → keystone persists.
3. PIN slider → same corner moves; readout updates.
4. IMAGE LOAD an image → it fills the canvas (SCALE X/Y/ROT transform it), `+` handles hide. CLEAR → grid returns, handles back. LOAD a video → it plays as the background.
5. WIDTH/HEIGHT sliders resize the canvas; `#pinCanvas` + warp + handles track the new size; readouts show `…px`.
6. All sliders show readouts (`800px`, `1.0x`, `0.50`) and persist across reload.

- [ ] **Step 4: Commit**

```bash
git add videoplaster/js/app.js
git commit -m "feat: image/video background, draggable corner pins, canvas resize, value readouts"
```

---

## Self-review notes

- **Spec coverage:** background image/video + default grid/brackets/title (Task 3 + loop in Task 5); SCALE X/Y/ROT (Task 5 image controls + BackgroundCanvas.setTransform); offset pins + drag handles hidden over media + sliders synced (Task 2 + Task 5); resizable canvas (Task 5 setCanvasSize + Task 4 sliders); v11 restyle + English labels + readouts (Task 4 + Task 1 fmt); persistence via existing `vp_settings` (slider ids). All covered.
- **Type consistency:** `off` shape `{tl,tr,br,bl}` each `{x,y}` used in `cornerPositions`, `setPinOffset`, drag, `draw`. `bindControl(id, apply, fmt?)` signature consistent across all call sites (2-arg for checkboxes/select, 3-arg for sliders). Pin slider ids `tlx…bly` map to `k+axis`. `bg.hasMedia`/`bg.canvas`/`bg.resize`/`bg.setTransform`/`bg.loadFile`/`bg.clear`/`bg.draw` consistent between Task 3 and Task 5.
- **Pin-vs-ripple priority:** capture-phase `mousedown` + `stopImmediatePropagation()` on `glCanvas` prevents `MouseTouchSource` from emitting a drop when grabbing a pin (verify in Task 5 step 3.2).
- **Note (kept):** WaterGL sim is not reallocated on canvas resize (fixed internal res, sampled as texture) — intentional simplification vs v11.
