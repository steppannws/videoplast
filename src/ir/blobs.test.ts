// src/ir/blobs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findBlobs } from "./blobs.ts";

// helper: build a grayscale "frame" (RGBA) with bright squares on a dark field
function frame(w: number, h: number, squares: { x: number; y: number; s: number; v: number }[]) {
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
