// videoplaster/js/leap-image-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { roiMap, flipImage } from "./leap-image-source.js";

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
