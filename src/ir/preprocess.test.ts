// src/ir/preprocess.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { subtractBackground } from "./preprocess.ts";

test("subtracts a static background, leaving only new bright pixels", () => {
  const w=4,h=1; const bg=new Uint8ClampedArray([100,100,100,255, 100,100,100,255, 100,100,100,255, 100,100,100,255]);
  const cur=new Uint8ClampedArray([100,100,100,255, 200,200,200,255, 100,100,100,255, 90,90,90,255]);
  const out = subtractBackground(cur, bg, w*h);
  // px0: 0, px1: ~100, px2: 0, px3: clamped to 0 (darker than bg)
  assert.equal(out[0*4], 0); assert.ok(out[1*4] >= 99 && out[1*4] <= 101);
  assert.equal(out[2*4], 0); assert.equal(out[3*4], 0);
});
