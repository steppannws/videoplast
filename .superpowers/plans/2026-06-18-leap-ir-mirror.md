# Leap IR Mirror (X/Y) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the Leap IR camera image horizontally and/or vertically so touches map correctly for a sensor mounted behind the acrylic.

**Architecture:** `LeapImageSource` gains a `mirror = {x,y}` flag and applies a pure `flipImage` to the RGBA frame right after gray→RGBA and before undistort, so the whole detection/preview/mapping chain stays consistent. Two checkboxes in the LEAP IR controls drive it via the existing `bindControl` persistence.

**Tech Stack:** Vanilla ES-module JS, `node --test`.

## Global Constraints

- No build step; commits plain (no attribution footer).
- Branch `feature/leap-ir-mirror` (already checked out).
- Existing suites stay green: `npm test` (22) + `pytest bridge/test_tuio.py` (3).
- Two axes: `MIRROR X` (id `mirrorX`, left-right), `MIRROR Y` (id `mirrorY`, up-down). Persist via `vp_settings`.

---

### Task 1: `flipImage` helper + `LeapImageSource.mirror` (TDD)

**Files:**
- Modify: `videoplaster/js/leap-image-source.js`
- Test: `videoplaster/js/leap-image-source.test.js` (append)

**Interfaces:**
- Produces: `flipImage(rgba, w, h, flipX, flipY) -> Uint8ClampedArray` (RGBA; returns the input unchanged when both flags false); `LeapImageSource.mirror = {x, y}`.

- [ ] **Step 1: Append the failing test**

Add to `videoplaster/js/leap-image-source.test.js`:

```js
import { flipImage } from "./leap-image-source.js";

// 2x2 RGBA, identified by the R channel: (0,0)=10 (1,0)=20 (0,1)=30 (1,1)=40
function img2x2() {
  const d = new Uint8ClampedArray(2 * 2 * 4);
  const set = (x, y, r) => { const i = (y*2 + x)*4; d[i]=r; d[i+1]=0; d[i+2]=0; d[i+3]=255; };
  set(0,0,10); set(1,0,20); set(0,1,30); set(1,1,40);
  return d;
}
const R = (d, x, y) => d[(y*2 + x)*4];

test("flipImage no-op returns pixels unchanged", () => {
  const d = img2x2();
  const o = flipImage(d, 2, 2, false, false);
  assert.deepEqual([R(o,0,0),R(o,1,0),R(o,0,1),R(o,1,1)], [10,20,30,40]);
});
test("flipImage X swaps columns", () => {
  const o = flipImage(img2x2(), 2, 2, true, false);
  assert.deepEqual([R(o,0,0),R(o,1,0),R(o,0,1),R(o,1,1)], [20,10,40,30]);
});
test("flipImage Y swaps rows", () => {
  const o = flipImage(img2x2(), 2, 2, false, true);
  assert.deepEqual([R(o,0,0),R(o,1,0),R(o,0,1),R(o,1,1)], [30,40,10,20]);
});
test("flipImage X+Y mirrors diagonally", () => {
  const o = flipImage(img2x2(), 2, 2, true, true);
  assert.deepEqual([R(o,0,0),R(o,1,0),R(o,0,1),R(o,1,1)], [40,30,20,10]);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd videoplaster && node --test js/leap-image-source.test.js`
Expected: FAIL — `flipImage` is not exported.

- [ ] **Step 3: Implement in `leap-image-source.js`**

Add the pure helper after `roiMap` (after line 14):

```js
// Pure: RGBA copy mirrored horizontally (flipX) and/or vertically (flipY).
export function flipImage(rgba, w, h, flipX, flipY) {
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
```

In the constructor, add the `mirror` field after the `roi` line:

```js
    this.roi = { x: 0, y: 0, w: 1, h: 1 }; // normalized capture rectangle; default full frame
    this.mirror = { x: false, y: false };  // flip IR image (sensor views from behind the acrylic)
```

Import the helper into the class body usage — it is in the same module, so no import needed. In `_onFrame`, apply the flip right after the gray→RGBA loop and **before** the undistort block:

```js
    for (let i = 0; i < this.w * this.h; i++) { rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=gray[i]; rgba[i*4+3]=255; }
    if (this.mirror.x || this.mirror.y) rgba = flipImage(rgba, this.w, this.h, this.mirror.x, this.mirror.y);
    if (this.undist.on) {
```

- [ ] **Step 4: Run, expect pass**

Run: `cd videoplaster && node --test js/leap-image-source.test.js` → PASS (7: 3 roiMap + 4 flipImage).
Run: `npm test` → PASS (26 total).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/js/leap-image-source.js videoplaster/js/leap-image-source.test.js
git commit -m "feat: LeapImageSource mirror X/Y (flipImage) with tests"
```

---

### Task 2: MIRROR X/Y checkboxes + wiring

**Files:**
- Modify: `videoplaster/index.html`
- Modify: `videoplaster/js/app.js`

**Interfaces:**
- Consumes: `LeapImageSource.mirror` (Task 1); `bindControl` (existing).

- [ ] **Step 1: Add the two checkboxes in `index.html`**

In the LEAP IR section, after the INVERT label:

```html
      <label class="ctrl"><input type="checkbox" id="invert"> INVERT</label>
```

insert:

```html
      <label class="ctrl"><input type="checkbox" id="mirrorX"> MIRROR X</label>
      <label class="ctrl"><input type="checkbox" id="mirrorY"> MIRROR Y</label>
```

- [ ] **Step 2: Wire in `app.js`**

Add a holder next to `detOpt`/`undistOpt`:

```js
const undistOpt = { on: false, k1: -0.3, k2: 0 };
const mirrorOpt = { x: false, y: false };
```

In `setSource`, in the `leap-ir` branch after `Object.assign(leapSrc.undist, undistOpt); leapSrc.undist.map = null;`:

```js
    Object.assign(leapSrc.mirror, mirrorOpt);
```

Add the bindings near the `invert` binding:

```js
bindControl("mirrorX", (v) => { mirrorOpt.x = v; if (leapSrc) leapSrc.mirror.x = v; });
bindControl("mirrorY", (v) => { mirrorOpt.y = v; if (leapSrc) leapSrc.mirror.y = v; });
```

- [ ] **Step 3: Regression + manual verify**

Run: `cd videoplaster && npm test` → PASS (26).
Manual (live app, cache-cleared reload), SOURCE = LEAP IR with a device streaming:
- Wave a hand near the LEFT edge; in the IR preview the bright region is on the left. Toggle MIRROR X → it appears on the RIGHT; the resulting water drop / TUIO cursor lands mirrored too.
- MIRROR Y flips top/bottom.
- Reload (cache cleared) → MIRROR X/Y stay checked (persisted).

- [ ] **Step 4: Commit**

```bash
git add videoplaster/index.html videoplaster/js/app.js
git commit -m "feat: MIRROR X/Y checkboxes for the Leap IR camera"
```

---

## Self-review notes

- **Spec coverage:** `flipImage` + `mirror` applied before undistort (Task 1); MIRROR X/Y checkboxes + holder + apply-on-source-creation + persistence (Task 2). Covered.
- **Type consistency:** `mirror` shape `{x,y}` (booleans) in constructor, `_onFrame`, `setSource` Object.assign, and the two bindings. `flipImage(rgba,w,h,flipX,flipY)` signature consistent between definition and the `_onFrame` call site. Checkbox `bindControl` calls are 2-arg (no readout), matching the existing `invert` pattern.
- **Note (kept):** capturing the IR background after toggling mirror is required (orientation changes) — documented in the spec, no code needed.
