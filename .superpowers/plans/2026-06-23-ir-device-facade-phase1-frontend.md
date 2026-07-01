# IR Device Facade — Phase 1 (Frontend Provider Facade + Generic IR Camera) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `LeapImageSource` into a device-agnostic IR pipeline + a pluggable frame-provider facade, and add a generic IR webcam source via `getUserMedia` — without changing the bridge or breaking the Leap path.

**Architecture:** `IrTouchPipeline` runs the gray→blob→track→`TouchEv` pipeline. An `IrFrameProvider` feeds it grayscale frames; `WsFrameProvider` is the existing WebSocket transport (Leap/PS Eye), `CameraFrameProvider` is a `getUserMedia` webcam. `IrSource` (a `TouchSource`) composes a pipeline + a provider and is selectable from the source dropdown.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, `allowImportingTsExtensions`), Vite, WebGL, `node:test` runner (`--experimental-strip-types`), Tauri v2 (macOS).

## Global Constraints

- TypeScript strict; import types with `import type`; import local modules with explicit `.ts` extension.
- Tests use `node:test` + `node:assert/strict`; no DOM/WebGL/WebSocket in unit tests (pure logic only).
- Run `npx tsc --noEmit` clean and `node --test --experimental-strip-types 'src/*.test.ts'` green before each commit.
- No Claude attribution in commits.
- Frontend WS frame protocol unchanged: `u32 w` (LE), `u32 h` (LE), then `w*h` bytes of 8-bit gray.
- Touch coordinates: normalized `0..1`, origin top-left.

---

### Task 1: Extract `IrTouchPipeline` + pure helpers

**Files:**
- Create: `videoplaster/src/ir-pipeline.ts`
- Create: `videoplaster/src/ir-pipeline.test.ts`
- (Task 8 deletes `videoplaster/src/leap-image-source.ts`; this task copies its pure helpers + `_onFrame` body here.)

**Interfaces:**
- Produces: `class IrTouchPipeline { w; h; frame; bg; opt: DetOpt; undist: UndistOpt; roi: Roi; mirror: MirrorOpt; tracker: BlobTracker; previewCb; onEvent: (ev: TouchEv)=>void; captureBackground(): void; setRoi(roi: Roi): void; process(gray: Uint8Array, w: number, h: number): void }`, plus `roiMap(cx,cy,w,h,roi): {u,v}` and `flipImage(rgba,w,h,flipX,flipY): Uint8ClampedArray`.

- [ ] **Step 1: Write the failing test**

```ts
// videoplaster/src/ir-pipeline.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { IrTouchPipeline, roiMap, flipImage } from "./ir-pipeline.ts";

test("roiMap maps image px to surface uv inside a sub-rect", () => {
  const { u, v } = roiMap(50, 25, 100, 100, { x: 0, y: 0, w: 0.5, h: 0.5 });
  assert.ok(Math.abs(u - 1.0) < 1e-9);
  assert.ok(Math.abs(v - 0.5) < 1e-9);
});

test("flipImage with no flips returns the same array ref", () => {
  const a = new Uint8ClampedArray(16);
  assert.equal(flipImage(a, 2, 2, false, false), a);
});

test("process emits a tracked TouchEv for a bright blob", () => {
  const w = 32, h = 32;
  const gray = new Uint8Array(w * h); // dark background
  for (let y = 14; y < 18; y++) for (let x = 14; x < 18; x++) gray[y * w + x] = 255; // bright 4x4 blob
  const p = new IrTouchPipeline();
  p.opt.threshold = 40; p.opt.minArea = 2; p.opt.maxArea = 8000; p.opt.erosionAmt = 0; p.opt.blurAmt = 0;
  const events: any[] = [];
  p.onEvent = (ev) => events.push(ev);
  p.process(gray, w, h);
  assert.ok(events.length >= 1, "expected at least one event");
  const e = events[0];
  assert.ok(e.x > 0.3 && e.x < 0.7 && e.y > 0.3 && e.y < 0.7, `blob near center, got ${e.x},${e.y}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd videoplaster && node --test --experimental-strip-types 'src/ir-pipeline.test.ts'`
Expected: FAIL (Cannot find module `./ir-pipeline.ts`).

- [ ] **Step 3: Write the implementation**

```ts
// videoplaster/src/ir-pipeline.ts
// Device-agnostic IR touch pipeline: a grayscale frame in, tracked TouchEvs out.
// Extracted from the former LeapImageSource so any frame provider can feed it.
import { findBlobs } from "./blobs.ts";
import { BlobTracker } from "./tracking.ts";
import { subtractBackground } from "./ir-preprocess.ts";
import { buildUndistMap, applyUndist } from "./undistort.ts";
import type { DetOpt, UndistOpt, Roi, MirrorOpt, DetBlob, TouchEv } from "./types.ts";

// Pure: blob center (image px) -> surface UV via an axis-aligned normalized rectangle.
export function roiMap(cx: number, cy: number, w: number, h: number, roi: Roi): { u: number; v: number } {
  const u = (cx / w - roi.x) / roi.w;
  const v = (cy / h - roi.y) / roi.h;
  return { u, v };
}

// Pure: RGBA copy mirrored horizontally (flipX) and/or vertically (flipY).
export function flipImage(rgba: Uint8ClampedArray, w: number, h: number, flipX: boolean, flipY: boolean): Uint8ClampedArray {
  if (!flipX && !flipY) return rgba;
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < h; y++) {
    const sy = flipY ? (h - 1 - y) : y;
    for (let x = 0; x < w; x++) {
      const sx = flipX ? (w - 1 - x) : x;
      const di = (y * w + x) * 4, si = (sy * w + sx) * 4;
      out[di] = rgba[si]; out[di+1] = rgba[si+1]; out[di+2] = rgba[si+2]; out[di+3] = rgba[si+3];
    }
  }
  return out;
}

export class IrTouchPipeline {
  w = 0;
  h = 0;
  frame: Uint8ClampedArray | null = null;
  bg: Uint8ClampedArray | null = null;
  opt: DetOpt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
  undist: UndistOpt = { on: false, k1: -0.3, k2: 0, map: null };
  roi: Roi = { x: 0, y: 0, w: 1, h: 1 };
  mirror: MirrorOpt = { x: false, y: false };
  tracker = new BlobTracker({ maxDist: 0.08 });
  previewCb: ((rgba: Uint8ClampedArray, w: number, h: number, blobs: DetBlob[]) => void) | null = null;
  onEvent: (ev: TouchEv) => void = () => {};
  captureBackground(): void { if (this.frame) this.bg = this.frame.slice(); }
  setRoi(roi: Roi): void { this.roi = roi; }
  // Gray frame -> RGBA -> mirror -> undistort -> bg-subtract -> blobs -> roi -> track -> emit.
  process(gray: Uint8Array, w: number, h: number): void {
    this.w = w; this.h = h;
    let rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=gray[i]; rgba[i*4+3]=255; }
    if (this.mirror.x || this.mirror.y) rgba = flipImage(rgba, w, h, this.mirror.x, this.mirror.y);
    if (this.undist.on) {
      if (!this.undist.map) this.undist.map = buildUndistMap(w, h, this.undist.k1, this.undist.k2);
      rgba = applyUndist(rgba, w, h, this.undist.map);
    }
    this.frame = rgba;
    if (this.bg && this.bg.length !== rgba.length) this.bg = null;
    const detIn = this.bg ? subtractBackground(rgba, this.bg, w * h) : rgba;
    const { blobs } = findBlobs({ data: detIn, width: w, height: h }, this.opt);
    const mapped = blobs
      .map((b) => { const { u, v } = roiMap(b.cx, b.cy, w, h, this.roi); return { x: u, y: v, strength: Math.min(1, b.bright/255) }; })
      .filter((pt) => pt.x>=0 && pt.x<=1 && pt.y>=0 && pt.y<=1);
    for (const ev of this.tracker.update(mapped)) this.onEvent(ev);
    if (this.previewCb) this.previewCb(detIn, w, h, blobs);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd videoplaster && npx tsc --noEmit && node --test --experimental-strip-types 'src/ir-pipeline.test.ts'`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/src/ir-pipeline.ts videoplaster/src/ir-pipeline.test.ts
git commit -m "feat: extract device-agnostic IrTouchPipeline from LeapImageSource"
```

---

### Task 2: `IrFrameProvider` interface + pure frame helpers

**Files:**
- Create: `videoplaster/src/ir-provider.ts`
- Create: `videoplaster/src/ir-provider.test.ts`

**Interfaces:**
- Produces: `interface IrFrameProvider { start(): void; stop(): void; restart(): void; onFrame(cb: (w: number, h: number, gray: Uint8Array)=>void): void; onStatus(cb: (s: string)=>void): void }`; `parseIrFrame(buf: ArrayBuffer): { w: number; h: number; gray: Uint8Array }`; `rgbaToLuma(rgba: Uint8Array|Uint8ClampedArray, out: Uint8Array): void`.

- [ ] **Step 1: Write the failing test**

```ts
// videoplaster/src/ir-provider.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIrFrame, rgbaToLuma } from "./ir-provider.ts";

test("parseIrFrame reads LE w,h header then gray bytes", () => {
  const w = 3, h = 2;
  const buf = new ArrayBuffer(8 + w * h);
  const dv = new DataView(buf);
  dv.setUint32(0, w, true); dv.setUint32(4, h, true);
  new Uint8Array(buf, 8).set([10, 20, 30, 40, 50, 60]);
  const f = parseIrFrame(buf);
  assert.equal(f.w, 3); assert.equal(f.h, 2);
  assert.deepEqual(Array.from(f.gray), [10, 20, 30, 40, 50, 60]);
});

test("rgbaToLuma writes BT.601 luma per pixel", () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]); // red, green
  const out = new Uint8Array(2);
  rgbaToLuma(rgba, out);
  assert.equal(out[0], 76);  // 255*0.299 = 76.2 -> 76
  assert.equal(out[1], 149); // 255*0.587 = 149.7 -> 149
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd videoplaster && node --test --experimental-strip-types 'src/ir-provider.test.ts'`
Expected: FAIL (Cannot find module `./ir-provider.ts`).

- [ ] **Step 3: Write the implementation**

```ts
// videoplaster/src/ir-provider.ts
// Frame-provider facade: anything that can yield grayscale IR frames to the pipeline.

export interface IrFrameProvider {
  start(): void;
  stop(): void;
  restart(): void;
  onFrame(cb: (w: number, h: number, gray: Uint8Array) => void): void;
  onStatus(cb: (state: string) => void): void;
}

// Pure: parse the packed WS frame (u32 w LE, u32 h LE, then w*h gray bytes).
export function parseIrFrame(buf: ArrayBuffer): { w: number; h: number; gray: Uint8Array } {
  const dv = new DataView(buf);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
  return { w, h, gray: new Uint8Array(buf, 8, w * h) };
}

// Pure: BT.601 luma from RGBA into a preallocated gray buffer (out.length == pixel count).
export function rgbaToLuma(rgba: Uint8Array | Uint8ClampedArray, out: Uint8Array): void {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd videoplaster && npx tsc --noEmit && node --test --experimental-strip-types 'src/ir-provider.test.ts'`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/src/ir-provider.ts videoplaster/src/ir-provider.test.ts
git commit -m "feat: add IrFrameProvider interface + parseIrFrame/rgbaToLuma helpers"
```

---

### Task 3: `WsFrameProvider` (bridge transport)

**Files:**
- Create: `videoplaster/src/ws-frame-provider.ts`

**Interfaces:**
- Consumes: `IrFrameProvider`, `parseIrFrame` from `ir-provider.ts`.
- Produces: `class WsFrameProvider implements IrFrameProvider { constructor(url?: string, device?: "leap"|"pseye") }`.

This task is transport (WebSocket) — not unit-tested (the parse is covered by Task 2). Verified in Task 8's smoke run.

- [ ] **Step 1: Write the implementation**

```ts
// videoplaster/src/ws-frame-provider.ts
// WebSocket transport to the Python bridge. On open it tells the bridge which device
// to capture, then forwards each binary IR frame to the pipeline.
import type { IrFrameProvider } from "./ir-provider.ts";
import { parseIrFrame } from "./ir-provider.ts";

export class WsFrameProvider implements IrFrameProvider {
  url: string;
  device: string;
  ws?: WebSocket;
  _stopped = false;
  _frameCb: (w: number, h: number, gray: Uint8Array) => void = () => {};
  _statusCb: (s: string) => void = () => {};
  constructor(url = "ws://localhost:7681", device: "leap" | "pseye" = "leap") {
    this.url = url; this.device = device;
  }
  onFrame(cb: (w: number, h: number, gray: Uint8Array) => void): void { this._frameCb = cb; }
  onStatus(cb: (s: string) => void): void { this._statusCb = cb; }
  start(): void { this._stopped = false; this._connect(); }
  _connect(): void {
    if (this._stopped) return;
    this._statusCb("connecting");
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this._statusCb("connected");
      try { this.ws?.send(JSON.stringify({ type: "device", name: this.device })); } catch {}
    };
    this.ws.onmessage = (e: MessageEvent) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const { w, h, gray } = parseIrFrame(e.data);
      this._frameCb(w, h, gray);
    };
    this.ws.onclose = () => {
      if (this._stopped) return;
      this._statusCb("reconnecting");
      setTimeout(() => this._connect(), 1000);
    };
    this.ws.onerror = () => { try { this.ws?.close(); } catch {} };
  }
  stop(): void { this._stopped = true; if (this.ws) { try { this.ws.close(); } catch {} } }
  restart(): void { this.stop(); this._stopped = false; this._connect(); }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd videoplaster && npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add videoplaster/src/ws-frame-provider.ts
git commit -m "feat: add WsFrameProvider (bridge transport + device control message)"
```

---

### Task 4: `CameraFrameProvider` (getUserMedia generic IR webcam)

**Files:**
- Create: `videoplaster/src/camera-frame-provider.ts`

**Interfaces:**
- Consumes: `IrFrameProvider`, `rgbaToLuma` from `ir-provider.ts`.
- Produces: `class CameraFrameProvider implements IrFrameProvider { constructor(deviceId?: string) }` and `static listCameras(): Promise<MediaDeviceInfo[]>`.

DOM/media-bound — not unit-tested (luma covered by Task 2). Verified manually in Task 8.

- [ ] **Step 1: Write the implementation**

```ts
// videoplaster/src/camera-frame-provider.ts
// Generic IR webcam via getUserMedia: video -> offscreen canvas -> luma -> pipeline.
import type { IrFrameProvider } from "./ir-provider.ts";
import { rgbaToLuma } from "./ir-provider.ts";

export class CameraFrameProvider implements IrFrameProvider {
  deviceId?: string;
  _stopped = false;
  _stream: MediaStream | null = null;
  _video: HTMLVideoElement;
  _canvas: HTMLCanvasElement;
  _ctx: CanvasRenderingContext2D | null;
  _gray: Uint8Array | null = null;
  _raf = 0;
  _frameCb: (w: number, h: number, gray: Uint8Array) => void = () => {};
  _statusCb: (s: string) => void = () => {};
  constructor(deviceId?: string) {
    this.deviceId = deviceId;
    this._video = document.createElement("video");
    this._video.muted = true; this._video.playsInline = true;
    this._canvas = document.createElement("canvas");
    this._ctx = this._canvas.getContext("2d", { willReadFrequently: true });
  }
  onFrame(cb: (w: number, h: number, gray: Uint8Array) => void): void { this._frameCb = cb; }
  onStatus(cb: (s: string) => void): void { this._statusCb = cb; }
  static async listCameras(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "videoinput");
  }
  start(): void {
    this._stopped = false;
    this._statusCb("connecting");
    const constraints: MediaStreamConstraints = {
      video: this.deviceId ? { deviceId: { exact: this.deviceId } } : true,
      audio: false,
    };
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (this._stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      this._stream = stream;
      this._video.srcObject = stream;
      this._video.play().then(() => { this._statusCb("streaming"); this._loop(); }).catch(() => this._statusCb("error"));
    }).catch(() => this._statusCb("denied"));
  }
  _loop(): void {
    if (this._stopped) return;
    const vw = this._video.videoWidth, vh = this._video.videoHeight;
    if (vw && vh && this._ctx) {
      if (this._canvas.width !== vw || this._canvas.height !== vh) {
        this._canvas.width = vw; this._canvas.height = vh; this._gray = new Uint8Array(vw * vh);
      }
      this._ctx.drawImage(this._video, 0, 0, vw, vh);
      const rgba = this._ctx.getImageData(0, 0, vw, vh).data;
      rgbaToLuma(rgba, this._gray!);
      this._frameCb(vw, vh, this._gray!);
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }
  stop(): void {
    this._stopped = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._stream) { this._stream.getTracks().forEach((t) => t.stop()); this._stream = null; }
  }
  restart(): void { this.stop(); this.start(); }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd videoplaster && npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add videoplaster/src/camera-frame-provider.ts
git commit -m "feat: add CameraFrameProvider (getUserMedia generic IR webcam)"
```

---

### Task 5: `IrSource` (TouchSource composing pipeline + provider)

**Files:**
- Create: `videoplaster/src/ir-source.ts`
- Create: `videoplaster/src/ir-source.test.ts`

**Interfaces:**
- Consumes: `TouchSource` from `touch-source.ts`; `IrTouchPipeline` from `ir-pipeline.ts`; `IrFrameProvider` from `ir-provider.ts`.
- Produces: `class IrSource extends TouchSource { constructor(provider: IrFrameProvider, name?: string); pipeline: IrTouchPipeline; get opt; get undist; get mirror; get roi; setRoi(r); captureBackground(); set previewCb(cb); set statusCb(cb); start(); stop(); restart() }`.

- [ ] **Step 1: Write the failing test**

```ts
// videoplaster/src/ir-source.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { IrSource } from "./ir-source.ts";
import type { IrFrameProvider } from "./ir-provider.ts";

class FakeProvider implements IrFrameProvider {
  frameCb: (w: number, h: number, g: Uint8Array) => void = () => {};
  started = false;
  start() { this.started = true; }
  stop() { this.started = false; }
  restart() { this.stop(); this.start(); }
  onFrame(cb: (w: number, h: number, g: Uint8Array) => void) { this.frameCb = cb; }
  onStatus() {}
}

test("IrSource emits TouchEv when its provider delivers a bright frame", () => {
  const fake = new FakeProvider();
  const src = new IrSource(fake, "ir-test");
  src.opt.threshold = 40; src.opt.minArea = 2; src.opt.erosionAmt = 0; src.opt.blurAmt = 0;
  const events: any[] = [];
  src.onTouch((ev) => events.push(ev));
  src.start();
  assert.equal(fake.started, true);
  const w = 32, h = 32, gray = new Uint8Array(w * h);
  for (let y = 14; y < 18; y++) for (let x = 14; x < 18; x++) gray[y * w + x] = 255;
  fake.frameCb(w, h, gray);
  assert.ok(events.length >= 1, "expected emitted event");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd videoplaster && node --test --experimental-strip-types 'src/ir-source.test.ts'`
Expected: FAIL (Cannot find module `./ir-source.ts`).

- [ ] **Step 3: Write the implementation**

```ts
// videoplaster/src/ir-source.ts
// A TouchSource that wires a frame provider into the IR pipeline. The three IR
// devices (Leap, PS Eye, generic camera) are IrSource instances with different providers.
import { TouchSource } from "./touch-source.ts";
import { IrTouchPipeline } from "./ir-pipeline.ts";
import type { IrFrameProvider } from "./ir-provider.ts";
import type { DetOpt, UndistOpt, MirrorOpt, Roi, DetBlob } from "./types.ts";

export class IrSource extends TouchSource {
  pipeline = new IrTouchPipeline();
  provider: IrFrameProvider;
  constructor(provider: IrFrameProvider, name = "ir") {
    super();
    this.name = name;
    this.provider = provider;
    this.pipeline.onEvent = (ev) => this.emit(ev);
    this.provider.onFrame((w, h, gray) => this.pipeline.process(gray, w, h));
  }
  // Calibration surface — delegates to the pipeline so the existing UI binds unchanged.
  get opt(): DetOpt { return this.pipeline.opt; }
  get undist(): UndistOpt { return this.pipeline.undist; }
  get mirror(): MirrorOpt { return this.pipeline.mirror; }
  get roi(): Roi { return this.pipeline.roi; }
  setRoi(r: Roi): void { this.pipeline.setRoi(r); }
  captureBackground(): void { this.pipeline.captureBackground(); }
  set previewCb(cb: ((rgba: Uint8ClampedArray, w: number, h: number, blobs: DetBlob[]) => void) | null) { this.pipeline.previewCb = cb; }
  set statusCb(cb: (s: string) => void) { this.provider.onStatus(cb); }
  start(): void { this.provider.start(); }
  stop(): void { this.provider.stop(); }
  restart(): void { this.provider.restart(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd videoplaster && npx tsc --noEmit && node --test --experimental-strip-types 'src/ir-source.test.ts'`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/src/ir-source.ts videoplaster/src/ir-source.test.ts
git commit -m "feat: add IrSource composing pipeline + frame provider"
```

---

### Task 6: Wire `app.ts` + `index.html` (dropdown, camera picker, rename)

**Files:**
- Modify: `videoplaster/src/app.ts` (source selection + calibration binding)
- Modify: `videoplaster/index.html` (dropdown options, camera picker, section relabel)

**Interfaces:**
- Consumes: `IrSource` (Task 5), `WsFrameProvider` (Task 3), `CameraFrameProvider` (Task 4).

This is DOM wiring — verified by typecheck + Task 8's Playwright smoke. Reference: `app.ts` currently imports `LeapImageSource`, builds `current = new LeapImageSource()` in `setSource`, and stores it as `leapSrc`; all calibration handlers key on `leapSrc`.

- [ ] **Step 1: Replace the Leap import + source construction in `app.ts`**

In `videoplaster/src/app.ts`, change the import:

```ts
import { IrSource } from "./ir-source.ts";
import { WsFrameProvider } from "./ws-frame-provider.ts";
import { CameraFrameProvider } from "./camera-frame-provider.ts";
```
(remove `import { LeapImageSource } from "./leap-image-source.ts";`)

Rename the module-level `let leapSrc: LeapImageSource | null = null;` to `let irSrc: IrSource | null = null;` and update the `current` union type from `MouseTouchSource | LeapImageSource | LeapZSource` to `MouseTouchSource | IrSource | LeapZSource`. Replace the body of `setSource`'s IR branch:

```ts
function setSource(name: string) {
  if (current) current.stop();
  irSrc = null;
  if (name === "mouse") {
    current = mouse;
  } else if (name === "leap-ir" || name === "pseye") {
    const device = name === "pseye" ? "pseye" : "leap";
    current = new IrSource(new WsFrameProvider("ws://localhost:7681", device), name);
    irSrc = current;
    Object.assign(irSrc.opt, detOpt);
    Object.assign(irSrc.undist, undistOpt);
    irSrc.undist.map = null;
    Object.assign(irSrc.mirror, mirrorOpt);
    const savedRoi = getSetting("roi") as Roi | null;
    if (savedRoi) irSrc.setRoi(savedRoi);
    irSrc.statusCb = (s) => { status.textContent = name.toUpperCase() + ": " + s; };
    attachLeapCalib(current);
  } else if (name === "ir-camera") {
    const camId = (getSetting("camDevice") as string) || undefined;
    current = new IrSource(new CameraFrameProvider(camId), "ir-camera");
    irSrc = current;
    Object.assign(irSrc.opt, detOpt);
    Object.assign(irSrc.undist, undistOpt);
    irSrc.undist.map = null;
    Object.assign(irSrc.mirror, mirrorOpt);
    irSrc.statusCb = (s) => { status.textContent = "CAMERA: " + s; };
    attachLeapCalib(current);
  } else if (name === "leap-z") {
    current = new LeapZSource();
  }
  if (!current) return;
  wire(current);
  current.start();
  status.textContent = `source: ${name}`;
}
```

Update every other reference to `leapSrc` in `app.ts` to `irSrc` (the IR-preview drag handlers, `captureBg`/`resetZone`/`restartIr` buttons, and the detection-control `bindControl` callbacks that do `if (leapSrc) leapSrc.opt.x = ...`). The method/property names (`opt`, `undist`, `mirror`, `roi`, `setRoi`, `captureBackground`, `restart`, `previewCb`) are unchanged — only the variable name changes. `attachLeapCalib(src)` keeps its name; it sets `src.previewCb`.

- [ ] **Step 2: Add the camera picker + persist hook in `app.ts`**

After the existing `bindControl("sourceSel", (v) => setSource(String(v)));` line, add:

```ts
const camSel = document.getElementById("camDevice") as HTMLSelectElement | null;
const camRow = document.getElementById("camDeviceRow") as HTMLElement | null;
async function refreshCameras() {
  if (!camSel) return;
  try {
    const cams = await CameraFrameProvider.listCameras();
    camSel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || "Camera " + (i + 1)}</option>`).join("");
    const saved = getSetting("camDevice") as string | null;
    if (saved) camSel.value = saved;
  } catch { /* enumerate may reject before permission */ }
}
if (camSel) {
  camSel.addEventListener("change", () => {
    saveSetting("camDevice", camSel.value);
    if ((document.getElementById("sourceSel") as HTMLSelectElement).value === "ir-camera") setSource("ir-camera");
  });
}
// show the camera picker only for the IR CAMERA source
const sourceSelEl = document.getElementById("sourceSel") as HTMLSelectElement | null;
function syncCamRow() { if (camRow) camRow.style.display = sourceSelEl?.value === "ir-camera" ? "" : "none"; }
if (sourceSelEl) { sourceSelEl.addEventListener("change", syncCamRow); }
syncCamRow();
refreshCameras();
```

- [ ] **Step 3: Update `index.html` — dropdown, camera picker, section label**

Replace the Source `<select>` options and add a camera-picker row:

```html
  <div class="section"><div class="row">
    <span class="slabel">Source</span>
    <select id="sourceSel"><option value="mouse">MOUSE</option><option value="leap-ir">LEAP IR</option><option value="pseye">PS EYE</option><option value="ir-camera">IR CAMERA</option><option value="leap-z">LEAP Z</option></select>
  </div>
  <div class="row" id="camDeviceRow" style="display:none"><span class="slabel">Camera</span><select id="camDevice"></select></div></div>
```

Change the IR detection section label from `Leap IR` to `IR DETECT` (the `<span class="slabel">Leap IR</span>` inside the detection controls section).

- [ ] **Step 4: Verify typecheck**

Run: `cd videoplaster && npx tsc --noEmit`
Expected: clean (exit 0). If `Roi` is not imported in `app.ts`, add it to the `import type { ... } from "./types.ts";` line.

- [ ] **Step 5: Commit**

```bash
git add videoplaster/src/app.ts videoplaster/index.html
git commit -m "feat: add PS EYE + IR CAMERA sources, camera picker; bind calibration to IrSource"
```

---

### Task 7: Tauri camera permission (entitlement + Info.plist)

**Files:**
- Modify: `videoplaster/src-tauri/entitlements.plist`
- Modify: `videoplaster/src-tauri/tauri.conf.json`

**Interfaces:** none (build config).

- [ ] **Step 1: Add the camera entitlement**

In `videoplaster/src-tauri/entitlements.plist`, add inside `<dict>`:

```xml
  <key>com.apple.security.device.camera</key>
  <true/>
```

- [ ] **Step 2: Add NSCameraUsageDescription via the Tauri macOS bundle config**

In `videoplaster/src-tauri/tauri.conf.json`, set `bundle.macOS` to include an Info.plist key. Tauri v2 merges an `Info.plist` file placed at `src-tauri/Info.plist`; create it:

```xml
<!-- videoplaster/src-tauri/Info.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSCameraUsageDescription</key>
  <string>Videoplaster uses an IR camera for touch detection.</string>
</dict>
</plist>
```

- [ ] **Step 3: Verify the Tauri config still parses**

Run: `cd videoplaster && npx tauri build --bundles app 2>&1 | tail -5`
Expected: builds `Videoplaster.app` (the merged Info.plist contains `NSCameraUsageDescription` — verify with `/usr/libexec/PlistBuddy -c "Print :NSCameraUsageDescription" src-tauri/target/release/bundle/macos/Videoplaster.app/Contents/Info.plist`).

- [ ] **Step 4: Commit**

```bash
git add videoplaster/src-tauri/entitlements.plist videoplaster/src-tauri/Info.plist videoplaster/src-tauri/tauri.conf.json
git commit -m "feat: grant camera access for the IR camera source in the Tauri app"
```

---

### Task 8: Remove `leap-image-source.ts`, integrate, verify end-to-end

**Files:**
- Delete: `videoplaster/src/leap-image-source.ts`
- Verify: full suite + build + Playwright smoke

**Interfaces:** none (cleanup + verification).

- [ ] **Step 1: Confirm nothing imports the old module**

Run: `cd videoplaster && grep -rn "leap-image-source" src/ index.html` 
Expected: no matches (Task 6 removed the import). If any remain, update them to `ir-source.ts`.

- [ ] **Step 2: Delete the file**

```bash
git rm videoplaster/src/leap-image-source.ts
```

- [ ] **Step 3: Full typecheck + tests**

Run: `cd videoplaster && npx tsc --noEmit && node --test --experimental-strip-types 'src/*.test.ts'`
Expected: tsc clean; all tests pass (existing + the 3 new files).

- [ ] **Step 4: Vite build**

Run: `cd videoplaster && npx vite build`
Expected: `✓ built`.

- [ ] **Step 5: Playwright smoke (IR CAMERA renders from a webcam)**

Start `npx vite --port 8000`; in a Chromium Playwright session navigate to `http://localhost:8000/`, select `ir-camera` in `#sourceSel` (grant camera permission), pick a camera in `#camDevice`, and confirm `gl.getError()` is 0 and the status line shows `CAMERA: streaming`. Move a bright object in front of the camera and confirm ripples appear (water effect). Document the result. (LEAP IR / PS EYE selection is smoke-tested against a running bridge in Phase 2.)

- [ ] **Step 6: Commit**

```bash
git add -A videoplaster/src
git commit -m "refactor: remove LeapImageSource (superseded by IrSource + providers)"
```

---

## Self-Review notes

- Spec coverage: `IrTouchPipeline` (T1), `IrFrameProvider`+helpers (T2), `WsFrameProvider` (T3), `CameraFrameProvider`+`listCameras` (T4), `IrSource` (T5), dropdown+camera picker+rename+persist (T6), Tauri camera perms (T7), cleanup+verify (T8). Bridge facade + PS Eye device are Phase 2.
- Type consistency: calibration surface names (`opt`/`undist`/`mirror`/`roi`/`setRoi`/`captureBackground`/`previewCb`/`statusCb`/`restart`) identical across pipeline, IrSource, and app.ts usage.
- Note: `pseye` source in T6 uses `WsFrameProvider(..., "pseye")` and will only stream once Phase 2's bridge supports `--device pseye`; until then it connects but receives no frames (acceptable — mouse + camera + leap work).
