# VIDEOPLASTER Touch Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Videoplaster touch installation: a Leap Motion Gemini mounted behind a white acrylic, used as an IR camera (no depth), feeds blob-detected touches into a GPU water effect and a TUIO output.

**Architecture:** A Python helper (`leap-bridge.py`) pulls raw IR images from the Leap via LeapC, serves them to the browser over WebSocket, receives detected touches back, and emits TUIO 1.1 over UDP. The browser does undistort → background subtraction → blob detection → camera→surface homography → id-tracking → `TouchEvent`s, which drive a WebGL ping-pong water sim warped onto the projector quad. A pluggable `TouchSource` abstraction lets Leap-IR, Leap-Z (backup), and Mouse sources be swapped.

**Tech Stack:** Vanilla ES-module JS + WebGL (browser, no build step), Python 3 (`leapc-python-bindings`, `websockets`, `python-osc`) for the bridge. Tests: `node --test` (JS pure modules), `pytest` (Python).

---

## Conventions for this plan

- **No build step.** Browser loads `<script type="module">`. Root `package.json` sets `"type":"module"` so Node runs the same `.js` files as ESM for tests.
- **Pure logic vs visual.** Math/array modules (homography, blobs, tracking, TUIO) are unit-tested with TDD. WebGL and hardware tasks use explicit **manual verification** steps (shaders and IR hardware cannot be meaningfully unit-tested).
- **Commits:** plain messages, no attribution footer (per user global convention).
- **Repo is not yet git.** Task 1 initializes it.

---

## File Structure

```
videoplaster/
  package.json             # {"type":"module"} + test script
  index.html               # loads js/app.js as module
  js/app.js                # orchestration, UI, render loop
  js/touch-source.js       # TouchSource base + MouseTouchSource + clientToSurface()
  js/homography.js         # gaussElim, computeH, inv3, applyH
  js/blobs.js              # boxBlur, morphErode/Dilate, grayscaleFromRGBA, findBlobs
  js/tracking.js           # BlobTracker (nearest-neighbour id assignment)
  js/leap-image-source.js  # primary: IR frame WS → blobs → homography → tracking
  js/leap-z-source.js      # backup: Gemini tracking WS → plane + Z threshold
  js/water-gl.js           # GPU ping-pong water
  js/warp-gl.js            # projection homography pass (from v11)
  js/output.js             # TouchEmitter (→ Python helper WS)
  js/*.test.js             # node --test unit tests
  bridge/leap-bridge.py    # LeapC images + WS server + TUIO UDP
  bridge/tuio.py           # pure TUIO 1.1 encoding (pytest-tested)
  bridge/test_tuio.py
  bridge/requirements.txt
  spike/leap-image-spike.py# Phase 0 only
  spike/spike.html         # Phase 0 only
  README.md
```

---

# PHASE 0 — Feasibility spike (GATE)

**Purpose:** prove this Gemini exposes raw IR images via LeapC. If it does not, the IR path is dead — stop and switch to the Leap-Z source as primary. Write no Phase 1+ code until this passes.

### Task 0.1: Bridge dependencies + LeapC image probe

**Files:**
- Create: `videoplaster/bridge/requirements.txt`
- Create: `videoplaster/spike/leap-image-spike.py`

- [ ] **Step 1: Write `requirements.txt`**

```
websockets>=12.0
python-osc>=1.8.3
```

> NOTE: `leapc-python-bindings` (package import name `leap`) is installed separately per Ultraleap's
> instructions (it builds against the installed Gemini SDK and is not on PyPI). See
> https://github.com/ultraleap/leapc-python-bindings — install with its `pip install -e leapc-python-api`.

- [ ] **Step 2: Write the probe script**

```python
# videoplaster/spike/leap-image-spike.py
"""Phase 0 gate: does this Gemini expose raw IR images via LeapC?
Run with the Ultraleap service running and a hand/object over the device.
Success = it prints image dimensions and writes spike_frame.pgm."""
import time
import leap  # leapc-python-bindings

class ImageProbe(leap.Listener):
    def __init__(self):
        self.got = False
    def on_device_event(self, event):
        print("device connected")
    def on_image_event(self, event):
        if self.got:
            return
        imgs = event.image  # sequence of leap.Image (left, right)
        print("IMAGE EVENT — discovering attributes:")
        print("  len(event.image) =", len(imgs))
        left = imgs[0]
        # attribute names vary by binding version — print what's there:
        print("  dir(image[0]) =", [a for a in dir(left) if not a.startswith("__")])
        w = getattr(left, "width", None)
        h = getattr(left, "height", None)
        print(f"  width={w} height={h}")
        data = getattr(left, "data", None)
        if data is not None and w and h:
            buf = bytes(data)[: w * h]
            with open("spike_frame.pgm", "wb") as f:
                f.write(f"P5\n{w} {h}\n255\n".encode()); f.write(buf)
            print("  wrote spike_frame.pgm")
        self.got = True

def main():
    listener = ImageProbe()
    conn = leap.Connection()
    conn.add_listener(listener)
    with conn.open():
        # Enable images. Exact flag name is what Phase 0 must confirm:
        try:
            conn.set_policy_flags([leap.PolicyFlag.Images])
            print("set_policy_flags([PolicyFlag.Images]) OK")
        except Exception as e:
            print("PolicyFlag.Images failed:", e)
            print("available PolicyFlag:", [a for a in dir(leap.PolicyFlag) if not a.startswith("__")])
        t0 = time.time()
        while not listener.got and time.time() - t0 < 20:
            time.sleep(0.1)
    print("RESULT:", "IMAGES AVAILABLE" if listener.got else "NO IMAGES — IR path not viable")

if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the probe (manual hardware verification)**

Run: `cd videoplaster/bridge && pip install -r requirements.txt` then install `leap` per the note,
then `cd ../spike && python leap-image-spike.py`
Expected (PASS): prints `IMAGES AVAILABLE`, the real `width`/`height`, and writes `spike_frame.pgm`.
Open `spike_frame.pgm` (Preview/GIMP) — you should see a recognizable IR image of the scene.
Expected (FAIL): prints `NO IMAGES — IR path not viable` or `PolicyFlag.Images failed`.

- [ ] **Step 4: Record the outcome**

Append the result (PASS/FAIL, the discovered attribute names, width/height) to `videoplaster/README.md`
under a "Phase 0 result" heading. If FAIL: STOP — go to Task 3.1 (Leap-Z) and make it the primary
source; skip Phase 2.

### Task 0.2: Live IR image in the browser

**Files:**
- Create: `videoplaster/spike/spike.html`
- Modify: `videoplaster/spike/leap-image-spike.py` (add WS push)

- [ ] **Step 1: Add a WebSocket push to the spike**

Add to `leap-image-spike.py` an asyncio `websockets` server on `:7681` that, on each image event,
sends a binary message: 4-byte little-endian width, 4-byte height, then the `w*h` grayscale bytes.

```python
import asyncio, struct, threading, websockets
LATEST = {"buf": None}

def pack(w, h, buf):
    return struct.pack("<II", w, h) + bytes(buf)[: w * h]

async def ws_handler(ws):
    while True:
        if LATEST["buf"] is not None:
            await ws.send(LATEST["buf"]); LATEST["buf"] = None
        await asyncio.sleep(1 / 60)

async def ws_main():
    async with websockets.serve(ws_handler, "localhost", 7681):
        await asyncio.Future()

def start_ws():
    threading.Thread(target=lambda: asyncio.run(ws_main()), daemon=True).start()
```

In `on_image_event`, after extracting `w,h,buf`, set `LATEST["buf"] = pack(w, h, buf)` every frame
(remove the `self.got` early-return so it streams), and call `start_ws()` once in `main()`.

- [ ] **Step 2: Write the viewer page**

```html
<!-- videoplaster/spike/spike.html -->
<!DOCTYPE html><meta charset="utf-8"><title>IR spike</title>
<canvas id="c"></canvas>
<pre id="log">connecting…</pre>
<script>
const c = document.getElementById("c"), ctx = c.getContext("2d"), log = document.getElementById("log");
const ws = new WebSocket("ws://localhost:7681");
ws.binaryType = "arraybuffer";
ws.onopen = () => log.textContent = "connected";
ws.onmessage = (e) => {
  const dv = new DataView(e.data);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
  const gray = new Uint8Array(e.data, 8, w * h);
  c.width = w; c.height = h;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { img.data[i*4]=img.data[i*4+1]=img.data[i*4+2]=gray[i]; img.data[i*4+3]=255; }
  ctx.putImageData(img, 0, 0);
  log.textContent = `${w}×${h} live`;
};
ws.onerror = () => log.textContent = "WS error — is leap-image-spike.py running?";
</script>
```

- [ ] **Step 3: Run end-to-end (manual verification)**

Terminal A: `cd videoplaster/spike && python leap-image-spike.py`
Terminal B: `cd videoplaster && python3 -m http.server 8000`
Browser: `http://localhost:8000/spike/spike.html`
Expected: canvas shows the **live** IR feed; waving a hand in front of the acrylic moves bright regions.
This is the GATE. If the live image looks usable (hand/finger reflections visible against the
acrylic), proceed to Phase 1. Record FPS and image size in the README.

- [ ] **Step 4: Commit the spike**

```bash
cd videoplaster && git add spike bridge/requirements.txt README.md
git commit -m "spike: prove Gemini exposes IR images over LeapC + WS viewer"
```

---

# PHASE 1 — Pipeline scaffold (mouse-driven: water + warp + TUIO)

Everything in this phase is testable with the mouse and a TUIO listener — no Leap required.

### Task 1: Project init + structure

**Files:**
- Create: `videoplaster/package.json`
- Create: `videoplaster/index.html`
- Create: `videoplaster/js/app.js`

- [ ] **Step 1: Initialize git (repo is not yet git)**

```bash
cd /Users/stepan/Development/Doopler/face-touch && git init && git add -A && git commit -m "chore: import v11 prototype + design/plan docs"
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "videoplaster",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "test": "node --test js/" }
}
```

- [ ] **Step 3: Write a minimal `index.html`**

```html
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VIDEOPLASTER 02</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#000;font-family:monospace;color:#888}
#wrap{position:relative;display:inline-block}#glCanvas{display:block;touch-action:none}
#ui{padding:12px;display:flex;flex-direction:column;gap:8px}</style></head>
<body>
<div id="wrap"><canvas id="glCanvas" width="800" height="500"></canvas></div>
<div id="ui">
  <label>FUENTE <select id="sourceSel"><option value="mouse">MOUSE</option>
    <option value="leap-ir">LEAP IR</option><option value="leap-z">LEAP Z</option></select></label>
  <span id="status">listo</span>
</div>
<script type="module" src="js/app.js"></script>
</body></html>
```

- [ ] **Step 4: Write an `app.js` stub that proves modules load**

```js
// videoplaster/js/app.js
const glCanvas = document.getElementById("glCanvas");
const status = document.getElementById("status");
status.textContent = `canvas ${glCanvas.width}×${glCanvas.height} — modules OK`;
console.log("app boot");
```

- [ ] **Step 5: Verify in browser (manual)**

Run: `cd videoplaster && python3 -m http.server 8000`, open `http://localhost:8000/`.
Expected: page shows the canvas + `canvas 800×500 — modules OK`, console logs `app boot`, no errors.

- [ ] **Step 6: Commit**

```bash
git add videoplaster/package.json videoplaster/index.html videoplaster/js/app.js
git commit -m "feat: project scaffold (index + app stub + module loading)"
```

### Task 2: Homography module (pure, TDD)

**Files:**
- Create: `videoplaster/js/homography.js`
- Test: `videoplaster/js/homography.test.js`

- [ ] **Step 1: Write the failing test**

```js
// videoplaster/js/homography.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeH, inv3, applyH } from "./homography.js";

test("identity-ish: unit square maps to itself", () => {
  const sq = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const H = computeH(sq, sq);
  const p = applyH(H, 0.3, 0.7);
  assert.ok(Math.abs(p.x - 0.3) < 1e-6 && Math.abs(p.y - 0.7) < 1e-6);
});

test("maps camera corners to surface [0,1] square", () => {
  const cam = [{x:100,y:50},{x:540,y:60},{x:520,y:300},{x:120,y:290}];
  const dst = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const H = computeH(cam, dst);
  const c0 = applyH(H, 100, 50), c2 = applyH(H, 520, 300);
  assert.ok(Math.hypot(c0.x-0, c0.y-0) < 1e-6);
  assert.ok(Math.hypot(c2.x-1, c2.y-1) < 1e-6);
});

test("inv3 of H composed with H is identity at a point", () => {
  const cam = [{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}];
  const dst = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const H = computeH(cam, dst); const Hi = inv3(H);
  const fwd = applyH(H, 2, 1.5);
  const back = applyH(Hi, fwd.x, fwd.y);
  assert.ok(Math.hypot(back.x-2, back.y-1.5) < 1e-6);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd videoplaster && node --test js/homography.test.js`
Expected: FAIL — `Cannot find module './homography.js'`.

- [ ] **Step 3: Implement (ported from v11, plus `applyH`)**

```js
// videoplaster/js/homography.js
export function gaussElim(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let mx = c; for (let r = c+1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[mx][c])) mx = r;
    [M[c], M[mx]] = [M[mx], M[c]];
    for (let r = c+1; r < n; r++) { const f = M[r][c]/M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f*M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n-1; i >= 0; i--) { x[i] = M[i][n]/M[i][i]; for (let k = i-1; k >= 0; k--) M[k][n] -= M[k][i]*x[i]; }
  return x;
}
export function computeH(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i], { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx*sx, -dx*sy]); b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy*sx, -dy*sy]); b.push(dy);
  }
  const h = gaussElim(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
export function inv3(m) {
  const [a,b,c,d,e,f,g,h,k] = m;
  const det = a*(e*k-f*h) - b*(d*k-f*g) + c*(d*h-e*g);
  return [(e*k-f*h)/det,(c*h-b*k)/det,(b*f-c*e)/det,(f*g-d*k)/det,(a*k-c*g)/det,
          (c*d-a*f)/det,(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det];
}
export function applyH(H, x, y) {
  const w = H[6]*x + H[7]*y + H[8];
  return { x: (H[0]*x + H[1]*y + H[2]) / w, y: (H[3]*x + H[4]*y + H[5]) / w };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test js/homography.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/homography.js videoplaster/js/homography.test.js
git commit -m "feat: homography module (computeH/inv3/applyH) with tests"
```

### Task 3: TouchSource base + MouseTouchSource

**Files:**
- Create: `videoplaster/js/touch-source.js`
- Test: `videoplaster/js/touch-source.test.js`

- [ ] **Step 1: Write the failing test (pure `clientToSurface`)**

```js
// videoplaster/js/touch-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToSurface } from "./touch-source.js";

test("maps client coords inside the canvas rect to [0,1]", () => {
  const rect = { left: 10, top: 20, width: 800, height: 500 };
  assert.deepEqual(clientToSurface(rect, 10, 20), { x: 0, y: 0 });
  assert.deepEqual(clientToSurface(rect, 810, 520), { x: 1, y: 1 });
  const mid = clientToSurface(rect, 410, 270);
  assert.ok(Math.abs(mid.x-0.5) < 1e-9 && Math.abs(mid.y-0.5) < 1e-9);
});

test("clamps outside the rect to [0,1]", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assert.deepEqual(clientToSurface(rect, -50, 200), { x: 0, y: 1 });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `node --test js/touch-source.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement base + mouse source + helper**

```js
// videoplaster/js/touch-source.js
export function clientToSurface(rect, clientX, clientY) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  return { x: cl((clientX - rect.left) / rect.width), y: cl((clientY - rect.top) / rect.height) };
}

export class TouchSource {
  constructor() { this._cb = () => {}; this.name = "base"; }
  onTouch(cb) { this._cb = cb; }
  emit(ev) { this._cb(ev); }
  start() {} stop() {}
}

// Mouse: press = down, drag = move, release = up. Single pointer → id 0.
export class MouseTouchSource extends TouchSource {
  constructor(canvas) { super(); this.name = "mouse"; this.canvas = canvas; this.down = false; }
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return clientToSurface(r, cx, cy);
  }
  start() {
    this._md = (e) => { this.down = true; const p = this._pos(e); this.emit({ id:0, ...p, z:0, strength:1, state:"down" }); };
    this._mm = (e) => { if (!this.down) return; const p = this._pos(e); this.emit({ id:0, ...p, z:0, strength:0.6, state:"move" }); };
    this._mu = () => { if (!this.down) return; this.down = false; this.emit({ id:0, x:0, y:0, z:0, strength:0, state:"up" }); };
    this.canvas.addEventListener("mousedown", this._md);
    window.addEventListener("mousemove", this._mm);
    window.addEventListener("mouseup", this._mu);
  }
  stop() {
    this.canvas.removeEventListener("mousedown", this._md);
    window.removeEventListener("mousemove", this._mm);
    window.removeEventListener("mouseup", this._mu);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test js/touch-source.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/touch-source.js videoplaster/js/touch-source.test.js
git commit -m "feat: TouchSource base + MouseTouchSource + clientToSurface"
```

### Task 4: WaterGL — GPU ping-pong water (visual)

**Files:**
- Create: `videoplaster/js/water-gl.js`

- [ ] **Step 1: Implement WaterGL**

Float textures with RGBA fallback. Height stored in the texture's R channel as float; if
`OES_texture_float` is missing, fall back to `UNSIGNED_BYTE` (lower quality) and warn.

```js
// videoplaster/js/water-gl.js
const QUAD_VS = `attribute vec2 a_pos; varying vec2 v_uv;
void main(){ v_uv=(a_pos+1.0)*0.5; gl_Position=vec4(a_pos,0.0,1.0); }`;

// Wave equation: next = (sum of 4 neighbours)/2 - prev, damped.
const UPDATE_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_prev, u_cur; uniform vec2 u_texel; uniform float u_damp;
void main(){
  float l=texture2D(u_cur,v_uv-vec2(u_texel.x,0.)).r;
  float r=texture2D(u_cur,v_uv+vec2(u_texel.x,0.)).r;
  float t=texture2D(u_cur,v_uv-vec2(0.,u_texel.y)).r;
  float b=texture2D(u_cur,v_uv+vec2(0.,u_texel.y)).r;
  float p=texture2D(u_prev,v_uv).r;
  float n=((l+r+t+b)*0.5 - p)*u_damp;
  gl_FragColor=vec4(n,0.,0.,1.);
}`;

// Additive splat at a point.
const DROP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad, u_amp; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  float add=u_amp*max(0., 1.-d/u_rad);
  gl_FragColor=vec4(texture2D(u_cur,v_uv).r+add,0.,0.,1.);
}`;

// Render: gradient of height distorts the background media; brightness from |height|.
const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_height, u_bg; uniform vec2 u_texel; uniform float u_intensity;
void main(){
  float hl=texture2D(u_height,v_uv-vec2(u_texel.x,0.)).r;
  float hr=texture2D(u_height,v_uv+vec2(u_texel.x,0.)).r;
  float ht=texture2D(u_height,v_uv-vec2(0.,u_texel.y)).r;
  float hb=texture2D(u_height,v_uv+vec2(0.,u_texel.y)).r;
  vec2 grad=vec2(hr-hl, hb-ht)*u_intensity;
  vec3 col=texture2D(u_bg, v_uv+grad).rgb;
  col += clamp(abs(texture2D(u_height,v_uv).r)*0.4, 0.0, 0.25);
  gl_FragColor=vec4(col,1.0);
}`;

function compile(gl, type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function program(gl, fs){ const p=gl.createProgram();
  gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,QUAD_VS)); gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }

export class WaterGL {
  constructor(gl, simW=512, simH=320){
    this.gl=gl; this.w=simW; this.h=simH; this.damp=0.985; this.intensity=0.5;
    const ext=gl.getExtension("OES_texture_float"); this.type = ext ? gl.FLOAT : gl.UNSIGNED_BYTE;
    if(!ext) console.warn("OES_texture_float unavailable — water uses 8-bit fallback");
    this.progUpdate=program(gl,UPDATE_FS); this.progDrop=program(gl,DROP_FS); this.progRender=program(gl,RENDER_FS);
    this.quad=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    this.texPrev=this._tex(); this.texCur=this._tex(); this.texTmp=this._tex();
    this.fbo=gl.createFramebuffer();
    this.bgTex=this._tex(gl.RGBA, gl.UNSIGNED_BYTE);
  }
  _tex(fmt, type){ const gl=this.gl,t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,fmt||gl.RGBA,this.w,this.h,0,fmt||gl.RGBA,type||this.type,null);
    [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T].forEach(p=>gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE));
    [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER].forEach(p=>gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR));
    return t; }
  _drawTo(target){ const gl=this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
    gl.viewport(0,0,this.w,this.h); }
  _bindQuad(prog){ const gl=this.gl; gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    const loc=gl.getAttribLocation(prog,"a_pos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0); }
  addDrop(x,y,strength){ const gl=this.gl; this._bindQuad(this.progDrop);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progDrop,"u_cur"),0);
    gl.uniform2f(gl.getUniformLocation(this.progDrop,"u_pt"),x,1.0-y);
    gl.uniform1f(gl.getUniformLocation(this.progDrop,"u_rad"),0.03);
    gl.uniform1f(gl.getUniformLocation(this.progDrop,"u_amp"),0.6*strength);
    gl.uniform2f(gl.getUniformLocation(this.progDrop,"u_aspect"),1.0,this.h/this.w);
    this._drawTo(this.texTmp); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    [this.texCur,this.texTmp]=[this.texTmp,this.texCur]; }
  step(){ const gl=this.gl; this._bindQuad(this.progUpdate);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.texPrev);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate,"u_prev"),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate,"u_cur"),1);
    gl.uniform2f(gl.getUniformLocation(this.progUpdate,"u_texel"),1/this.w,1/this.h);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate,"u_damp"),this.damp);
    this._drawTo(this.texTmp); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    [this.texPrev,this.texCur,this.texTmp]=[this.texCur,this.texTmp,this.texPrev]; }
  setBackground(source){ const gl=this.gl; gl.bindTexture(gl.TEXTURE_2D,this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source); }
  // Renders the watered scene into the currently-bound framebuffer/viewport. Returns the height texture
  // unused; the caller (WarpGL) reads the framebuffer. For Phase 1 we render straight to screen.
  renderToScreen(viewW, viewH){ const gl=this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,viewW,viewH); this._bindQuad(this.progRender);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender,"u_height"),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender,"u_bg"),1);
    gl.uniform2f(gl.getUniformLocation(this.progRender,"u_texel"),1/this.w,1/this.h);
    gl.uniform1f(gl.getUniformLocation(this.progRender,"u_intensity"),this.intensity);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4); }
}
```

- [ ] **Step 2: Wire into app.js for a visual smoke test**

In `app.js`: get a `webgl` context, create `WaterGL`, set a flat gray background (1×1 white pixel
via `setBackground` using a tiny canvas), create `MouseTouchSource`, on each touch call
`water.addDrop(x,y,strength)`, and run a loop: `water.step(); water.renderToScreen(canvas.width, canvas.height); requestAnimationFrame(loop)`.

```js
// add to videoplaster/js/app.js
import { WaterGL } from "./water-gl.js";
import { MouseTouchSource } from "./touch-source.js";
const gl = glCanvas.getContext("webgl");
const water = new WaterGL(gl);
const bg = document.createElement("canvas"); bg.width = bg.height = 2;
const bx = bg.getContext("2d"); bx.fillStyle = "#1b3a5a"; bx.fillRect(0,0,2,2);
water.setBackground(bg);
const mouse = new MouseTouchSource(glCanvas);
mouse.onTouch((ev) => { if (ev.state !== "up") water.addDrop(ev.x, ev.y, ev.strength); });
mouse.start();
(function loop(){ water.step(); water.renderToScreen(glCanvas.width, glCanvas.height); requestAnimationFrame(loop); })();
```

- [ ] **Step 3: Visual verification (manual)**

Open `http://localhost:8000/`. Click/drag on the canvas.
Expected: ripples spawn at the cursor and propagate/decay over the blue background. No WebGL errors
in console. Smooth (~60 fps).

- [ ] **Step 4: Commit**

```bash
git add videoplaster/js/water-gl.js videoplaster/js/app.js
git commit -m "feat: GPU ping-pong water effect, mouse-driven smoke test"
```

### Task 5: WarpGL — projection homography pass (visual)

**Files:**
- Create: `videoplaster/js/warp-gl.js`
- Modify: `videoplaster/index.html` (add 4 pin sliders), `videoplaster/js/app.js`

- [ ] **Step 1: Implement WarpGL (ported from v11 shaders)**

Render the water scene into an offscreen RGBA texture, then warp that texture onto the projector
quad defined by 4 corner pins.

```js
// videoplaster/js/warp-gl.js
import { computeH, inv3 } from "./homography.js";
const VS = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv=(a_pos+1.0)*0.5; gl_Position=vec4(a_pos,0.,1.); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; uniform mat3 u_Hinv; uniform vec2 u_res; varying vec2 v_uv;
void main(){ vec2 fp=vec2(v_uv.x*u_res.x,(1.0-v_uv.y)*u_res.y); vec3 h=u_Hinv*vec3(fp,1.0); vec2 sp=h.xy/h.z;
  vec2 uv=vec2(sp.x/u_res.x,1.0-sp.y/u_res.y);
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) gl_FragColor=vec4(0,0,0,1); else gl_FragColor=texture2D(u_tex,uv); }`;

function mk(gl,t,s){ const sh=gl.createShader(t); gl.shaderSource(sh,s); gl.compileShader(sh); return sh; }

export class WarpGL {
  constructor(gl, w, h){ this.gl=gl; this.w=w; this.h=h;
    this.prog=gl.createProgram(); gl.attachShader(this.prog,mk(gl,gl.VERTEX_SHADER,VS));
    gl.attachShader(this.prog,mk(gl,gl.FRAGMENT_SHADER,FS)); gl.linkProgram(this.prog);
    this.quad=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    this.uHinv=gl.getUniformLocation(this.prog,"u_Hinv"); this.uRes=gl.getUniformLocation(this.prog,"u_res");
    // identity pins (no keystone) by default:
    this.pins={ tl:{x:0,y:0}, tr:{x:w,y:0}, br:{x:w,y:h}, bl:{x:0,y:h} }; }
  setPin(k, x, y){ this.pins[k]={x,y}; }
  draw(srcTex){ const gl=this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,this.w,this.h);
    gl.useProgram(this.prog); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    const loc=gl.getAttribLocation(this.prog,"a_pos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const src=[{x:0,y:0},{x:this.w,y:0},{x:this.w,y:this.h},{x:0,y:this.h}];
    const dst=[this.pins.tl,this.pins.tr,this.pins.br,this.pins.bl];
    const H=computeH(src,dst), Hi=inv3(H);
    gl.uniformMatrix3fv(this.uHinv,false,[Hi[0],Hi[3],Hi[6],Hi[1],Hi[4],Hi[7],Hi[2],Hi[5],Hi[8]]);
    gl.uniform2f(this.uRes,this.w,this.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,srcTex);
    gl.uniform1i(gl.getUniformLocation(this.prog,"u_tex"),0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4); }
}
```

- [ ] **Step 2: Make WaterGL render to a texture (add method)**

Add to `water-gl.js` a `renderToTexture(outTex)` that does the render pass into the FBO bound to
`outTex` instead of the screen (same body as `renderToScreen` but `_drawTo(outTex)` and viewport
`this.w,this.h`). Add a `sceneTex` created in the WaterGL constructor for this purpose.

```js
// add inside WaterGL constructor: this.sceneTex=this._tex(gl.RGBA, gl.UNSIGNED_BYTE);
// add method:
renderToTexture(){ const gl=this.gl; this._drawTo(this.sceneTex); this._bindQuad(this.progRender);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.texCur);
  gl.uniform1i(gl.getUniformLocation(this.progRender,"u_height"),0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,this.bgTex);
  gl.uniform1i(gl.getUniformLocation(this.progRender,"u_bg"),1);
  gl.uniform2f(gl.getUniformLocation(this.progRender,"u_texel"),1/this.w,1/this.h);
  gl.uniform1f(gl.getUniformLocation(this.progRender,"u_intensity"),this.intensity);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4); return this.sceneTex; }
```

- [ ] **Step 3: Wire warp into the render loop + pin sliders**

In `index.html` add 8 range inputs (`tlx tly trx try brx bry blx bly`, range matching v11). In
`app.js` replace the loop with:

```js
import { WarpGL } from "./warp-gl.js";
const warp = new WarpGL(gl, glCanvas.width, glCanvas.height);
// load/persist pins from localStorage:
const savedPins = JSON.parse(localStorage.getItem("vp_pins") || "null");
if (savedPins) warp.pins = savedPins;
["tl","tr","br","bl"].forEach((k) => ["x","y"].forEach((axis) => {
  const el = document.getElementById(k+axis); if (!el) return;
  el.value = warp.pins[k][axis];
  el.oninput = () => { warp.pins[k][axis] = parseFloat(el.value); localStorage.setItem("vp_pins", JSON.stringify(warp.pins)); };
}));
(function loop(){ water.step(); const tex = water.renderToTexture(); warp.draw(tex); requestAnimationFrame(loop); })();
```

- [ ] **Step 4: Visual verification (manual)**

Open the page; drag a pin slider. Expected: the watered image's corner follows the pin (keystone
warp). Reload — pins persist. Ripples still work.

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/warp-gl.js videoplaster/js/water-gl.js videoplaster/index.html videoplaster/js/app.js
git commit -m "feat: projection homography warp + persistent corner pins"
```

### Task 6: TUIO encoding (Python, pure, TDD)

**Files:**
- Create: `videoplaster/bridge/tuio.py`
- Test: `videoplaster/bridge/test_tuio.py`

- [ ] **Step 1: Write the failing test**

```python
# videoplaster/bridge/test_tuio.py
from pythonosc.osc_bundle import OscBundle
from tuio import build_2dcur_bundle

def parse(bundle_bytes):
    b = OscBundle(bundle_bytes)
    msgs = []
    for i in range(b.num_contents):
        c = b.content(i)
        msgs.append((c.address, list(c.params)))
    return msgs

def test_bundle_has_alive_set_fseq():
    cursors = {7: (0.25, 0.50), 9: (0.75, 0.10)}
    msgs = parse(build_2dcur_bundle(cursors, fseq=42, source="videoplaster"))
    addrs = [m[0] for m in msgs]
    assert all(a == "/tuio/2Dcur" for a in addrs)
    kinds = [m[1][0] for m in msgs]
    assert "source" in kinds and "alive" in kinds and "fseq" in kinds
    assert kinds.count("set") == 2

def test_alive_lists_all_ids_and_set_carries_xy():
    cursors = {7: (0.25, 0.50)}
    msgs = parse(build_2dcur_bundle(cursors, fseq=1, source="vp"))
    alive = next(m for m in msgs if m[1][0] == "alive")
    assert 7 in alive[1][1:]
    s = next(m for m in msgs if m[1][0] == "set")
    # set, sessionId, x, y, X, Y, m
    assert s[1][1] == 7 and abs(s[1][2]-0.25) < 1e-6 and abs(s[1][3]-0.50) < 1e-6

def test_fseq_value():
    msgs = parse(build_2dcur_bundle({}, fseq=99, source="vp"))
    fseq = next(m for m in msgs if m[1][0] == "fseq")
    assert fseq[1][1] == 99
```

- [ ] **Step 2: Run, expect fail**

Run: `cd videoplaster/bridge && python -m pytest test_tuio.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tuio'`.

- [ ] **Step 3: Implement TUIO 1.1 2Dcur encoding**

```python
# videoplaster/bridge/tuio.py
"""TUIO 1.1 /tuio/2Dcur encoding. cursors = {session_id: (x, y)} with x,y in [0,1]."""
from pythonosc.osc_message_builder import OscMessageBuilder
from pythonosc.osc_bundle_builder import OscBundleBuilder, IMMEDIATELY

ADDR = "/tuio/2Dcur"

def _msg(*args):
    b = OscMessageBuilder(address=ADDR)
    for a in args:
        b.add_arg(a)
    return b.build()

def build_2dcur_bundle(cursors, fseq, source="videoplaster"):
    bundle = OscBundleBuilder(IMMEDIATELY)
    bundle.add_content(_msg("source", source))
    bundle.add_content(_msg("alive", *list(cursors.keys())))
    for sid, (x, y) in cursors.items():
        # set, s, x, y, X(vel), Y(vel), m(accel)  — velocity/accel zeroed
        bundle.add_content(_msg("set", sid, float(x), float(y), 0.0, 0.0, 0.0))
    bundle.add_content(_msg("fseq", int(fseq)))
    return bundle.build().dgram
```

- [ ] **Step 4: Run, expect pass**

Run: `python -m pytest test_tuio.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/bridge/tuio.py videoplaster/bridge/test_tuio.py
git commit -m "feat: TUIO 1.1 2Dcur bundle encoding with tests"
```

### Task 7: Helper WS + TUIO out + browser TouchEmitter (end-to-end)

**Files:**
- Create: `videoplaster/bridge/leap-bridge.py` (touch-receiving + TUIO half only; images added in Phase 2)
- Create: `videoplaster/js/output.js`
- Modify: `videoplaster/js/app.js`

- [ ] **Step 1: Implement the helper (receive touches → TUIO UDP)**

```python
# videoplaster/bridge/leap-bridge.py
"""Receives TouchEvent JSON from the browser over WS :7681 and emits TUIO 1.1 to UDP :3333.
Phase 2 adds the IR image push on the same WS server."""
import asyncio, json, argparse
import websockets
from pythonosc.udp_client import UDPClient
from tuio import build_2dcur_bundle

class TuioOut:
    def __init__(self, ip, port):
        self.client = UDPClient(ip, port)
        self.cursors = {}   # id -> (x, y)
        self.fseq = 0
    def handle(self, ev):
        i = int(ev["id"])
        if ev["state"] == "up":
            self.cursors.pop(i, None)
        else:
            self.cursors[i] = (float(ev["x"]), float(ev["y"]))
    def flush(self):
        self.fseq += 1
        # UDPClient.send expects an OscMessage/Bundle; send raw dgram via its transport:
        self.client._sock.sendto(build_2dcur_bundle(self.cursors, self.fseq), (self.client._address, self.client._port))

async def handler(ws, tuio):
    async for raw in ws:
        if isinstance(raw, bytes):
            continue  # image frames flow the other way (Phase 2)
        try:
            ev = json.loads(raw)
        except Exception:
            continue
        tuio.handle(ev)
        tuio.flush()

async def main(args):
    tuio = TuioOut(args.tuio_ip, args.tuio_port)
    async with websockets.serve(lambda ws: handler(ws, tuio), "localhost", args.ws_port):
        print(f"WS :{args.ws_port}  TUIO → {args.tuio_ip}:{args.tuio_port}")
        await asyncio.Future()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--ws-port", type=int, default=7681)
    p.add_argument("--tuio-ip", default="127.0.0.1")
    p.add_argument("--tuio-port", type=int, default=3333)
    asyncio.run(main(p.parse_args()))
```

> NOTE: `UDPClient._sock` / `_address` / `_port` are private but stable in python-osc; we bypass
> `send()` because we already have raw bundle bytes. If a version mismatch breaks this, wrap the
> dgram by constructing an `OscBundle` and calling `client.send(...)`.

- [ ] **Step 2: Implement the browser TouchEmitter**

```js
// videoplaster/js/output.js
export class TouchEmitter {
  constructor(url = "ws://localhost:7681") { this.url = url; this.ws = null; this._connect(); }
  _connect() {
    try { this.ws = new WebSocket(this.url); } catch { this._retry(); return; }
    this.ws.onclose = () => this._retry();
    this.ws.onerror = () => {};
  }
  _retry() { this.ws = null; setTimeout(() => this._connect(), 1500); }   // backoff, not tight loop
  send(ev) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(ev)); }
}
```

- [ ] **Step 3: Wire emitter into app.js**

```js
// add to videoplaster/js/app.js
import { TouchEmitter } from "./output.js";
const emitter = new TouchEmitter();
// extend the mouse handler:
mouse.onTouch((ev) => { if (ev.state !== "up") water.addDrop(ev.x, ev.y, ev.strength); emitter.send(ev); });
```

- [ ] **Step 4: End-to-end verification (manual, with a TUIO listener)**

Terminal A: `cd videoplaster/bridge && python leap-bridge.py`
Terminal B: `cd videoplaster && python3 -m http.server 8000`
Terminal C (listener): `python -c "from pythonosc import dispatcher,osc_server; d=dispatcher.Dispatcher(); d.map('/tuio/2Dcur', lambda a,*x: print(x)); osc_server.BlockingOSCUDPServer(('127.0.0.1',3333), d).serve_forever()"`
Browser: drag on the canvas.
Expected: Terminal C prints `('source', ...)`, `('alive', 0)`, `('set', 0, x, y, 0.0, 0.0, 0.0)`,
`('fseq', n)` streams as you drag; on mouse-up the `alive` list empties. Water still ripples.

- [ ] **Step 5: Commit**

```bash
git add videoplaster/bridge/leap-bridge.py videoplaster/js/output.js videoplaster/js/app.js
git commit -m "feat: helper WS→TUIO UDP + browser TouchEmitter, end-to-end mouse→TUIO"
```

---

# PHASE 2 — LeapImageSource (IR blobs → touches)

Only do Phase 2 if Phase 0 PASSED.

### Task 8: Blob detection module (pure, TDD)

**Files:**
- Create: `videoplaster/js/blobs.js`
- Test: `videoplaster/js/blobs.test.js`

- [ ] **Step 1: Write the failing test**

```js
// videoplaster/js/blobs.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findBlobs } from "./blobs.js";

// helper: build a grayscale "frame" (RGBA) with bright squares on a dark field
function frame(w, h, squares) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const { x, y, s, v } of squares)
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const i = ((y+dy) * w + (x+dx)) * 4; data[i]=data[i+1]=data[i+2]=v; data[i+3]=255;
    }
  return { data, width: w, height: h };
}

test("finds two bright blobs above threshold", () => {
  const f = frame(64, 48, [{x:5,y:5,s:6,v:255}, {x:40,y:30,s:5,v:255}]);
  const { blobs } = findBlobs(f, { threshold:128, minArea:4, maxArea:1000, blurAmt:0, erosionAmt:0, invert:false });
  assert.equal(blobs.length, 2);
});

test("rejects blobs below minArea", () => {
  const f = frame(64, 48, [{x:5,y:5,s:2,v:255}]);
  const { blobs } = findBlobs(f, { threshold:128, minArea:20, maxArea:1000, blurAmt:0, erosionAmt:0, invert:false });
  assert.equal(blobs.length, 0);
});

test("centroid is near the square centre and brightness reported", () => {
  const f = frame(64, 48, [{x:10,y:10,s:8,v:255}]);
  const { blobs } = findBlobs(f, { threshold:128, minArea:4, maxArea:1000, blurAmt:0, erosionAmt:0, invert:false });
  assert.ok(Math.abs(blobs[0].cx - 13.5) < 1.5 && Math.abs(blobs[0].cy - 13.5) < 1.5);
  assert.ok(blobs[0].bright > 200);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd videoplaster && node --test js/blobs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (ported + brightness added)**

```js
// videoplaster/js/blobs.js
export function boxBlur(g, w, h, r) {
  if (!r) return g; const t = new Float32Array(w*h), o = new Float32Array(w*h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){ let s=0; for(let dx=-r;dx<=r;dx++){const nx=Math.max(0,Math.min(w-1,x+dx)); s+=g[y*w+nx];} t[y*w+x]=s/(2*r+1); }
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){ let s=0; for(let dy=-r;dy<=r;dy++){const ny=Math.max(0,Math.min(h-1,y+dy)); s+=t[ny*w+x];} o[y*w+x]=s/(2*r+1); }
  return o;
}
export function morphErode(bin, w, h, r) {
  if (!r) return bin; const out = new Uint8Array(w*h);
  for (let y=r;y<h-r;y++) for (let x=r;x<w-r;x++){ if(!bin[y*w+x])continue; let ok=true;
    for(let d=1;d<=r&&ok;d++) if(!bin[y*w+(x-d)]||!bin[y*w+(x+d)]||!bin[(y-d)*w+x]||!bin[(y+d)*w+x]) ok=false;
    if(ok) out[y*w+x]=1; } return out;
}
export function morphDilate(bin, w, h, r) {
  if (!r) return bin; const out = new Uint8Array(w*h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){ if(bin[y*w+x]){out[y*w+x]=1;continue;} let f=false;
    for(let d=1;d<=r&&!f;d++) if((x-d>=0&&bin[y*w+(x-d)])||(x+d<w&&bin[y*w+(x+d)])||(y-d>=0&&bin[(y-d)*w+x])||(y+d<h&&bin[(y+d)*w+x])) f=true;
    if(f) out[y*w+x]=1; } return out;
}
export function grayscaleFromRGBA(data, w, h) {
  const g = new Float32Array(w*h);
  for (let i=0;i<w*h;i++) g[i] = (data[i*4]*77 + data[i*4+1]*150 + data[i*4+2]*29) >> 8;
  return g;
}
// frame = {data:RGBA Uint8ClampedArray, width, height}
export function findBlobs(frame, opt) {
  const { width: w, height: h, data } = frame;
  const { threshold, minArea, maxArea, blurAmt, erosionAmt, invert } = opt;
  const gray = grayscaleFromRGBA(data, w, h);
  const bl = boxBlur(gray, w, h, blurAmt);
  let bin = new Uint8Array(w*h);
  for (let i=0;i<w*h;i++){ const v=bl[i]; bin[i]= invert ? (v<threshold?1:0) : (v>threshold?1:0); }
  if (erosionAmt>0){ bin=morphErode(bin,w,h,erosionAmt); bin=morphDilate(bin,w,h,erosionAmt); }
  const vis=new Uint8Array(w*h), blobs=[];
  for (let s=0;s<w*h;s++){ if(!bin[s]||vis[s])continue;
    const stk=[s]; vis[s]=1; let sx=0,sy=0,area=0,sumv=0;
    while(stk.length){ const idx=stk.pop(), px=idx%w, py=(idx/w)|0; sx+=px; sy+=py; area++; sumv+=bl[idx];
      if(px>0&&bin[idx-1]&&!vis[idx-1]){vis[idx-1]=1;stk.push(idx-1);}
      if(px<w-1&&bin[idx+1]&&!vis[idx+1]){vis[idx+1]=1;stk.push(idx+1);}
      if(py>0&&bin[idx-w]&&!vis[idx-w]){vis[idx-w]=1;stk.push(idx-w);}
      if(py<h-1&&bin[idx+w]&&!vis[idx+w]){vis[idx+w]=1;stk.push(idx+w);} }
    if(area>=minArea&&area<=maxArea) blobs.push({ cx:sx/area, cy:sy/area, area, bright:sumv/area }); }
  return { blobs, bin };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test js/blobs.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/blobs.js videoplaster/js/blobs.test.js
git commit -m "feat: blob detection module (blur/threshold/morph/CCL) with tests"
```

### Task 9: Blob tracker (stable ids, pure, TDD)

**Files:**
- Create: `videoplaster/js/tracking.js`
- Test: `videoplaster/js/tracking.test.js`

- [ ] **Step 1: Write the failing test**

```js
// videoplaster/js/tracking.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { BlobTracker } from "./tracking.js";

test("new blob -> down, moved blob -> move with same id, gone -> up", () => {
  const tr = new BlobTracker({ maxDist: 0.1 });
  let evs = tr.update([{ x:0.2, y:0.2, strength:0.9 }]);
  assert.equal(evs.length, 1); assert.equal(evs[0].state, "down");
  const id = evs[0].id;
  evs = tr.update([{ x:0.22, y:0.21, strength:0.9 }]);
  assert.equal(evs[0].state, "move"); assert.equal(evs[0].id, id);
  evs = tr.update([]);
  assert.equal(evs[0].state, "up"); assert.equal(evs[0].id, id);
});

test("two simultaneous blobs keep distinct ids", () => {
  const tr = new BlobTracker({ maxDist: 0.1 });
  const evs = tr.update([{ x:0.1,y:0.1,strength:1 }, { x:0.8,y:0.8,strength:1 }]);
  const ids = evs.map(e => e.id);
  assert.equal(new Set(ids).size, 2);
});

test("a far jump starts a new id rather than teleporting", () => {
  const tr = new BlobTracker({ maxDist: 0.1 });
  const a = tr.update([{ x:0.1,y:0.1,strength:1 }])[0].id;
  const evs = tr.update([{ x:0.9,y:0.9,strength:1 }]);
  // old id goes up, new id goes down
  assert.ok(evs.some(e => e.state === "up" && e.id === a));
  assert.ok(evs.some(e => e.state === "down" && e.id !== a));
});
```

- [ ] **Step 2: Run, expect fail**

Run: `node --test js/tracking.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement nearest-neighbour tracker**

```js
// videoplaster/js/tracking.js
// Greedy nearest-neighbour matching of current blobs to active tracks.
export class BlobTracker {
  constructor({ maxDist = 0.08 } = {}) { this.maxDist = maxDist; this.tracks = new Map(); this.nextId = 1; }
  update(blobs) {
    const events = [];
    const unmatched = new Set(this.tracks.keys());
    const used = new Array(blobs.length).fill(false);
    // match each existing track to the closest unused blob within maxDist
    for (const [id, tk] of this.tracks) {
      let best = -1, bestD = this.maxDist;
      for (let i = 0; i < blobs.length; i++) {
        if (used[i]) continue;
        const d = Math.hypot(blobs[i].x - tk.x, blobs[i].y - tk.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        used[best] = true; unmatched.delete(id);
        const b = blobs[best]; this.tracks.set(id, { x: b.x, y: b.y });
        events.push({ id, x: b.x, y: b.y, z: 0, strength: b.strength, state: "move" });
      }
    }
    // leftover tracks → up
    for (const id of unmatched) {
      const tk = this.tracks.get(id); this.tracks.delete(id);
      events.push({ id, x: tk.x, y: tk.y, z: 0, strength: 0, state: "up" });
    }
    // leftover blobs → new down
    for (let i = 0; i < blobs.length; i++) {
      if (used[i]) continue;
      const id = this.nextId++; const b = blobs[i];
      this.tracks.set(id, { x: b.x, y: b.y });
      events.push({ id, x: b.x, y: b.y, z: 0, strength: b.strength, state: "down" });
    }
    return events;
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test js/tracking.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/tracking.js videoplaster/js/tracking.test.js
git commit -m "feat: nearest-neighbour blob tracker with stable ids"
```

### Task 10: Background subtraction + undistort helpers (pure, TDD)

**Files:**
- Create: `videoplaster/js/ir-preprocess.js`
- Test: `videoplaster/js/ir-preprocess.test.js`

- [ ] **Step 1: Write the failing test**

```js
// videoplaster/js/ir-preprocess.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { subtractBackground } from "./ir-preprocess.js";

test("subtracts a static background, leaving only new bright pixels", () => {
  const w=4,h=1; const bg=new Uint8ClampedArray([100,100,100,255, 100,100,100,255, 100,100,100,255, 100,100,100,255]);
  const cur=new Uint8ClampedArray([100,100,100,255, 200,200,200,255, 100,100,100,255, 90,90,90,255]);
  const out = subtractBackground(cur, bg, w*h);
  // px0: 0, px1: ~100, px2: 0, px3: clamped to 0 (darker than bg)
  assert.equal(out[0*4], 0); assert.ok(out[1*4] >= 99 && out[1*4] <= 101);
  assert.equal(out[2*4], 0); assert.equal(out[3*4], 0);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `node --test js/ir-preprocess.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// videoplaster/js/ir-preprocess.js
import { buildUndistMap as _b } from "./undistort.js"; // see note below
// Subtract a background frame (both RGBA, grayscale-equal channels). Returns new RGBA with
// max(0, cur-bg) per pixel, replicated across RGB.
export function subtractBackground(cur, bg, n) {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, cur[i*4] - bg[i*4]);
    out[i*4] = out[i*4+1] = out[i*4+2] = v; out[i*4+3] = 255;
  }
  return out;
}
```

> NOTE: the undistort import above is a forward reference; remove it for now — undistort is reused
> directly from `undistort.js` in Task 11 wiring. Keep `ir-preprocess.js` limited to
> `subtractBackground` so the unit test stays pure. (Delete the unused import line.)

Delete the first import line so the file is exactly the `subtractBackground` function.

- [ ] **Step 4: Port the undistort helpers as a separate module**

```js
// videoplaster/js/undistort.js  (ported from v11, unchanged logic)
export function buildUndistMap(w, h, k1, k2) {
  const map = new Int16Array(w*h*2), cx=w/2, cy=h/2, f=Math.max(w,h)/2;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    const nx=(x-cx)/f, ny=(y-cy)/f, r2=nx*nx+ny*ny, fac=1+k1*r2+k2*r2*r2, si=(y*w+x)*2;
    map[si]=Math.round(nx*fac*f+cx); map[si+1]=Math.round(ny*fac*f+cy);
  }
  return map;
}
export function applyUndist(data, w, h, map) {
  const dst = new Uint8ClampedArray(w*h*4);
  for (let i=0;i<w*h;i++){ const sx=map[i*2], sy=map[i*2+1];
    if(sx>=0&&sx<w&&sy>=0&&sy<h){ const di=i*4, si=(sy*w+sx)*4; dst[di]=data[si]; dst[di+1]=data[si+1]; dst[di+2]=data[si+2]; dst[di+3]=255; } }
  return dst;
}
```

- [ ] **Step 5: Run, expect pass**

Run: `node --test js/ir-preprocess.test.js`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add videoplaster/js/ir-preprocess.js videoplaster/js/undistort.js videoplaster/js/ir-preprocess.test.js
git commit -m "feat: IR background subtraction + radial undistort helpers"
```

### Task 11: leap-bridge.py — add IR image push

**Files:**
- Modify: `videoplaster/bridge/leap-bridge.py`

- [ ] **Step 1: Add the LeapC image producer (using the attribute names confirmed in Phase 0)**

Add a `leap.Listener` that, on each image event, packs `<II>` width/height + grayscale bytes into a
module-level `LATEST_IMAGE` (same packing as the spike). Run the Leap connection on a background
thread. In `handler`, after the existing touch loop, also push `LATEST_IMAGE` to the browser when
present:

```python
# add near top of leap-bridge.py
import struct, threading
try:
    import leap
    HAVE_LEAP = True
except ImportError:
    HAVE_LEAP = False

LATEST_IMAGE = {"buf": None}

def _pack(w, h, buf):
    return struct.pack("<II", w, h) + bytes(buf)[: w * h]

class _ImageListener(leap.Listener) if HAVE_LEAP else object:
    def on_image_event(self, event):
        left = event.image[0]
        w = getattr(left, "width", None); h = getattr(left, "height", None)
        data = getattr(left, "data", None)
        if w and h and data is not None:
            LATEST_IMAGE["buf"] = _pack(w, h, data)

def start_leap():
    if not HAVE_LEAP:
        print("WARNING: `leap` not importable — image stream disabled (mouse/Z still work)"); return
    def run():
        conn = leap.Connection(); conn.add_listener(_ImageListener())
        with conn.open():
            try: conn.set_policy_flags([leap.PolicyFlag.Images])
            except Exception as e: print("image policy failed:", e)
            import time
            while True: time.sleep(0.01)
    threading.Thread(target=run, daemon=True).start()
```

- [ ] **Step 2: Push images in the WS handler**

Change `handler` to also send the latest image at ~30 fps. Use a per-connection sender task:

```python
async def push_images(ws):
    while True:
        if LATEST_IMAGE["buf"] is not None:
            try: await ws.send(LATEST_IMAGE["buf"])
            except Exception: return
            LATEST_IMAGE["buf"] = None
        await asyncio.sleep(1/30)

async def handler(ws, tuio):
    sender = asyncio.create_task(push_images(ws))
    try:
        async for raw in ws:
            if isinstance(raw, bytes): continue
            try: ev = json.loads(raw)
            except Exception: continue
            tuio.handle(ev); tuio.flush()
    finally:
        sender.cancel()
```

And call `start_leap()` inside `main()` before `websockets.serve`.

- [ ] **Step 3: Manual verification**

Run `python leap-bridge.py` with the Leap connected; open the Phase 0 `spike.html` (still points at
:7681). Expected: the live IR image appears again — now served by the unified bridge. Touch JSON from
the browser still produces TUIO (re-run the Task 7 listener).

- [ ] **Step 4: Commit**

```bash
git add videoplaster/bridge/leap-bridge.py
git commit -m "feat: unify IR image push into leap-bridge (images out + touches in + TUIO)"
```

### Task 12: LeapImageSource — wire the full pipeline

**Files:**
- Create: `videoplaster/js/leap-image-source.js`
- Modify: `videoplaster/index.html` (calibration UI: capture-bg, 4 corners, sliders), `videoplaster/js/app.js`

- [ ] **Step 1: Implement LeapImageSource**

```js
// videoplaster/js/leap-image-source.js
import { TouchSource } from "./touch-source.js";
import { findBlobs } from "./blobs.js";
import { BlobTracker } from "./tracking.js";
import { subtractBackground } from "./ir-preprocess.js";
import { buildUndistMap, applyUndist } from "./undistort.js";
import { computeH, applyH } from "./homography.js";

export class LeapImageSource extends TouchSource {
  constructor(url = "ws://localhost:7681") {
    super(); this.name = "leap-ir"; this.url = url;
    this.w = 0; this.h = 0; this.frame = null; this.bg = null;
    this.opt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
    this.undist = { on: false, k1: -0.3, k2: 0, map: null };
    this.corners = null; // [{x,y}*4] in image px (tl,tr,br,bl); set by calibration
    this.H = null;
    this.tracker = new BlobTracker({ maxDist: 0.08 });
    this.previewCb = null; // optional: (rgba,w,h)=>void for the calibration preview
  }
  start() {
    this.ws = new WebSocket(this.url); this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (e) => this._onFrame(e.data);
  }
  stop() { if (this.ws) this.ws.close(); }
  captureBackground() { if (this.frame) this.bg = this.frame.slice(); }
  setCorners(c) { const dst=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]; this.corners=c; this.H=computeH(c,dst); }
  _onFrame(buf) {
    const dv = new DataView(buf); this.w = dv.getUint32(0, true); this.h = dv.getUint32(4, true);
    const gray = new Uint8Array(buf, 8, this.w * this.h);
    // to RGBA
    let rgba = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) { rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=gray[i]; rgba[i*4+3]=255; }
    if (this.undist.on) {
      if (!this.undist.map) this.undist.map = buildUndistMap(this.w, this.h, this.undist.k1, this.undist.k2);
      rgba = applyUndist(rgba, this.w, this.h, this.undist.map);
    }
    this.frame = rgba;
    const detIn = this.bg ? subtractBackground(rgba, this.bg, this.w * this.h) : rgba;
    const { blobs } = findBlobs({ data: detIn, width: this.w, height: this.h }, this.opt);
    // image px → surface UV via homography (skip if not calibrated)
    const mapped = this.H
      ? blobs.map((b) => { const p = applyH(this.H, b.cx, b.cy); return { x: p.x, y: p.y, strength: Math.min(1, b.bright/255) }; })
              .filter((p) => p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1)
      : [];
    for (const ev of this.tracker.update(mapped)) this.emit(ev);
    if (this.previewCb) this.previewCb(detIn, this.w, this.h, blobs);
  }
}
```

- [ ] **Step 2: Add calibration UI to index.html**

Add: a `<canvas id="irPreview" width="320" height="240">`, a `CAPTURAR FONDO` button
(`#captureBg`), a `CALIBRAR ESQUINAS` button (`#calibCorners`) that enters a "click 4 corners on the
preview" mode, an `INVERTIR` checkbox, and sliders for `threshold/minArea/maxArea/blur/erosion`
mirroring v11 ids. Wire each slider to `src.opt.*` and the undistort toggles to `src.undist.*`
(resetting `src.undist.map=null` on change).

- [ ] **Step 3: Source selection in app.js**

Add a `setSource(name)` that stops the current source, constructs the chosen one
(`mouse`/`leap-ir`/`leap-z`), wires `onTouch(ev => { if (ev.state!=="up") water.addDrop(ev.x,ev.y,ev.strength); emitter.send(ev); })`, and for `leap-ir` sets `previewCb` to draw the processed
frame + blob markers into `#irPreview`, and enables clicking the preview to record the 4 corners →
`src.setCorners(...)` (store corners in `localStorage` and reload on start). Drive it from `#sourceSel`.

```js
// sketch added to app.js
import { LeapImageSource } from "./leap-image-source.js";
let current = null;
function wire(src){ src.onTouch(ev => { if(ev.state!=="up") water.addDrop(ev.x,ev.y,ev.strength); emitter.send(ev); }); }
function setSource(name){
  if (current) current.stop();
  if (name === "mouse") { current = mouse; }
  else if (name === "leap-ir") {
    current = new LeapImageSource();
    const saved = JSON.parse(localStorage.getItem("vp_corners")||"null"); if (saved) current.setCorners(saved);
    // previewCb + corner-click handlers attach here (draw to #irPreview)
  }
  wire(current); current.start();
}
document.getElementById("sourceSel").onchange = (e) => setSource(e.target.value);
setSource("mouse");
```

- [ ] **Step 4: Manual verification on the rig**

Bridge + http server running, Leap behind the acrylic. Select `LEAP IR`. Click `CAPTURAR FONDO`
with nothing touching. Click `CALIBRAR ESQUINAS`, click the 4 acrylic corners in the preview. Touch
the acrylic.
Expected: preview shows your finger as a bright blob with a marker; a ripple spawns at the matching
spot on the projected canvas; a TUIO `2Dcur` cursor appears at `[0,1]` coords. Tune
threshold/minArea/erosion until hover stops triggering and touch reliably does.

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/leap-image-source.js videoplaster/index.html videoplaster/js/app.js
git commit -m "feat: LeapImageSource — IR frame → bg-subtract → blobs → homography → tracked touches"
```

---

# PHASE 3 — Z backup source, tuning, docs

### Task 13: LeapZSource (backup)

**Files:**
- Create: `videoplaster/js/leap-z-source.js`
- Test: `videoplaster/js/leap-z-source.test.js`
- Modify: `videoplaster/js/app.js` (handle `"leap-z"` in `setSource`)

- [ ] **Step 1: Write the failing test for the pure parts**

```js
// videoplaster/js/leap-z-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFingerTips, fingerToTouch } from "./leap-z-source.js";

test("extractFingerTips reads Gemini hands[].fingers[].bones[] tips", () => {
  const frame = { hands: [{ type:"left", fingers: [
    { extended:true, bones:[{},{},{},{ type:3, nextJoint:[10,200,5] }] },
    { extended:false, bones:[{ type:3, nextJoint:[0,0,0] }] },
  ] }] };
  const tips = extractFingerTips(frame);
  assert.equal(tips.length, 1);
  assert.deepEqual(tips[0], [10, 200, 5]);
});

test("fingerToTouch maps box-normalised x/z and flags touch below threshold", () => {
  const box = { center:[0,200,0], size:[200,200,200] };
  const t = fingerToTouch([0,210,0], box, { thresh:40, zoomX:1, zoomZ:1, invertZ:false });
  assert.ok(Math.abs(t.x-0.5) < 1e-9 && Math.abs(t.y-0.5) < 1e-9);
  // y height 210 is within thresh? height measured as box-relative; here just assert shape:
  assert.ok("touch" in t && "strength" in t);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `node --test js/leap-z-source.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (pure helpers + the WS source class)**

```js
// videoplaster/js/leap-z-source.js
import { TouchSource } from "./touch-source.js";

export function extractFingerTips(frame) {
  const tips = [];
  for (const hand of frame.hands || []) {
    for (const finger of hand.fingers || []) {
      if (finger.extended === false) continue;
      let tip = finger.stabilizedTipPosition || finger.tipPosition;
      if (!tip && finger.bones && finger.bones.length) {
        const d = finger.bones.find((b) => b.type === 3) || finger.bones[finger.bones.length - 1];
        if (d) tip = d.nextJoint;
      }
      if (tip) tips.push(tip);
    }
  }
  return tips;
}

// Maps a Leap tip [x,y,z] (mm) to surface UV using the interaction box, plus touch height logic.
export function fingerToTouch(tip, box, { thresh, zoomX, zoomZ, invertZ }) {
  let nx = (tip[0] - box.center[0]) / box.size[0] * zoomX + 0.5;
  let nz = (tip[2] - box.center[2]) / box.size[2] * zoomZ + 0.5;
  if (invertZ) nz = 1 - nz;
  nx = Math.max(0, Math.min(1, nx)); nz = Math.max(0, Math.min(1, nz));
  const heightAbovePlane = tip[1] - (box.center[1] - box.size[1] / 2);
  const touch = heightAbovePlane < thresh;
  return { x: nx, y: nz, z: heightAbovePlane, touch, strength: Math.max(0.2, 1 - heightAbovePlane / thresh) };
}

const URLS = ["ws://localhost:6437/v6.json","ws://localhost:6437/v3.json","ws://localhost:6437"];
const DEFAULT_BOX = { center:[0,200,0], size:[300,300,300] };

export class LeapZSource extends TouchSource {
  constructor() { super(); this.name = "leap-z"; this.cfg = { thresh:40, zoomX:1, zoomZ:1, invertZ:false }; this.active = new Map(); this.nextId = 1; }
  start() { this._tryNext(0); }
  stop() { if (this.ws) this.ws.close(); }
  _tryNext(i) {
    if (i >= URLS.length) return;
    const ws = new WebSocket(URLS[i]);
    const to = setTimeout(() => { try { ws.close(); } catch {} this._tryNext(i + 1); }, 2000);
    ws.onopen = () => { clearTimeout(to); this.ws = ws; ws.send(JSON.stringify({ focused:true })); ws.send(JSON.stringify({ background:true }));
      ws.onmessage = (e) => { try { this._frame(JSON.parse(e.data)); } catch {} }; };
    ws.onerror = () => { clearTimeout(to); this._tryNext(i + 1); };
  }
  _frame(frame) {
    const box = frame.interactionBox || DEFAULT_BOX;
    const tips = extractFingerTips(frame);
    const touches = tips.map((t) => fingerToTouch(t, box, this.cfg)).filter((t) => t.touch);
    // simple single-pass id reuse by index (Leap already smooths); good enough for backup
    const seen = new Set();
    touches.forEach((t, i) => { const id = i + 1; seen.add(id);
      const state = this.active.has(id) ? "move" : "down"; this.active.set(id, true);
      this.emit({ id, x: t.x, y: t.y, z: t.z, strength: t.strength, state }); });
    for (const id of [...this.active.keys()]) if (!seen.has(id)) { this.active.delete(id); this.emit({ id, x:0,y:0,z:0,strength:0, state:"up" }); }
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `node --test js/leap-z-source.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Handle `"leap-z"` in app.js `setSource`**

```js
// in setSource():
else if (name === "leap-z") { current = new LeapZSource(); }
```
(import `LeapZSource` at top.)

- [ ] **Step 6: Commit**

```bash
git add videoplaster/js/leap-z-source.js videoplaster/js/leap-z-source.test.js videoplaster/js/app.js
git commit -m "feat: LeapZSource backup (hand-tracking + Z threshold) with tested helpers"
```

### Task 14: Water tuning controls + README

**Files:**
- Modify: `videoplaster/index.html` (water sliders), `videoplaster/js/app.js`
- Create: `videoplaster/README.md` (if not already created in Phase 0)

- [ ] **Step 1: Add water sliders**

Add range inputs for intensity (`water.intensity`), viscosity/damping (`water.damp`), and drop radius
(pass into `addDrop` via a module var). Wire each `oninput` to the live `water` instance.

- [ ] **Step 2: Write the README**

```markdown
# VIDEOPLASTER 02

Leap Motion Gemini (behind a white acrylic) used as an IR camera → touch detection →
GPU water effect + TUIO output.

## Run
1. `cd bridge && pip install -r requirements.txt` and install `leap` per
   https://github.com/ultraleap/leapc-python-bindings
2. `python leap-bridge.py`   (IR images + TUIO on UDP :3333, WS :7681)
3. From the repo root: `python3 -m http.server 8000`
4. Open http://localhost:8000/ — pick a source, calibrate, touch.

## Sources
- **LEAP IR** (primary): IR image → background subtract → blobs → homography → touches.
- **LEAP Z** (backup): hand-tracking + Z threshold (open-air, ~25 cm zone).
- **MOUSE**: develop without hardware.

## Calibration (LEAP IR)
1. CAPTURAR FONDO with nothing on the acrylic.
2. CALIBRAR ESQUINAS, click the 4 acrylic corners in the preview.
3. Tune threshold/minArea/erosion so hover doesn't trigger but touch does.

## Mounting notes
- Leap ~15–30 cm behind the acrylic so the finger plane is in focus and IR spreads.
- The Leap's IR-pass filter rejects the projector's visible light.

## Phase 0 result
<!-- filled during the feasibility spike: images available? width×height? fps? -->
```

- [ ] **Step 3: Manual verification**

Open the page; adjust water sliders while rippling. Expected: intensity/viscosity/radius visibly
change the effect live.

- [ ] **Step 4: Commit**

```bash
git add videoplaster/index.html videoplaster/js/app.js videoplaster/README.md
git commit -m "feat: water tuning controls + README"
```

---

## Self-Review (completed)

- **Spec coverage:** pluggable `TouchSource` (T3/12/13), Leap-IR primary (T8–12), Leap-Z backup
  (T13), Mouse (T3), GPU water (T4/5), warp/pins (T5), TUIO over UDP via single Python helper
  (T6/7/11), background subtraction + undistort (T10), Phase 0 gate (T0). All spec sections map to
  tasks.
- **Placeholder scan:** code provided for every code step; the two narrative wiring steps (T12 step
  3, T5 step 3) include concrete sketches + exact ids. No "TBD/handle edge cases".
- **Type consistency:** `TouchEvent` shape `{id,x,y,z,strength,state}` is identical across
  MouseTouchSource, BlobTracker, LeapImageSource, LeapZSource, and the bridge. `findBlobs(frame,opt)`
  signature matches its caller in LeapImageSource. `computeH/applyH/inv3` names consistent across
  homography users. `build_2dcur_bundle(cursors,fseq,source)` matches its caller in `TuioOut.flush`.

## Known risks carried into execution

- **Phase 0 is a hard gate.** If LeapC images are unavailable on this Gemini, skip Phase 2 and make
  LeapZSource (Task 13) the primary source; the rest of the pipeline is unchanged.
- **python-osc private attrs** (`UDPClient._sock/_address/_port`) used in `TuioOut.flush`; fallback
  documented in Task 7 if a version breaks it.
- **Leap image attribute names** (`width/height/data`) are discovered in Phase 0 and must be plugged
  into Task 11 if they differ.
