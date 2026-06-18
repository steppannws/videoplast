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
