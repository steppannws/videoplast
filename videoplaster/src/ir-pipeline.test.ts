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
