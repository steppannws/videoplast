import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIrFrame, rgbaToLuma } from "./provider.ts";

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
