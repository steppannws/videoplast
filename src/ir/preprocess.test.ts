// src/ir/preprocess.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { subtractBackground, applyBrightnessContrast } from "./preprocess.ts";

test("subtracts a static background, leaving only new bright pixels", () => {
  const w=4,h=1; const bg=new Uint8ClampedArray([100,100,100,255, 100,100,100,255, 100,100,100,255, 100,100,100,255]);
  const cur=new Uint8ClampedArray([100,100,100,255, 200,200,200,255, 100,100,100,255, 90,90,90,255]);
  const out = subtractBackground(cur, bg, w*h);
  // px0: 0, px1: ~100, px2: 0, px3: clamped to 0 (darker than bg)
  assert.equal(out[0*4], 0); assert.ok(out[1*4] >= 99 && out[1*4] <= 101);
  assert.equal(out[2*4], 0); assert.equal(out[3*4], 0);
});

test("brightness/contrast: identity, gain, offset, and clamping", () => {
  const img = new Uint8ClampedArray([128,128,128,255, 200,200,200,255, 40,40,40,255]);
  // identity returns the same array unchanged
  assert.equal(applyBrightnessContrast(img, 3, 0, 1), img);
  // contrast=2 pivots at 128: 128->128, 200->272(clamp 255), 40->(40-128)*2+128=-48(clamp 0)
  const c = applyBrightnessContrast(img, 3, 0, 2);
  assert.equal(c[0], 128); assert.equal(c[1*4], 255); assert.equal(c[2*4], 0);
  // brightness=+30 additive: 128->158, 40->70
  const b = applyBrightnessContrast(img, 3, 30, 1);
  assert.equal(b[0], 158); assert.equal(b[2*4], 70);
});
