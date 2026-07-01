import { test } from "node:test";
import assert from "node:assert/strict";
import { IrTouchPipeline, roiMap, flipImage, applyTouchMap } from "./pipeline.ts";

test("roiMap maps image px to surface uv inside a sub-rect", () => {
  const { u, v } = roiMap(50, 25, 100, 100, { x: 0, y: 0, w: 0.5, h: 0.5 });
  assert.ok(Math.abs(u - 1.0) < 1e-9);
  assert.ok(Math.abs(v - 0.5) < 1e-9);
});

test("applyTouchMap: identity, offset, and centre-anchored scale", () => {
  const id = applyTouchMap(0.5, 0.5, { offX: 0, offY: 0, scaleX: 1, scaleY: 1 });
  assert.ok(Math.abs(id.u - 0.5) < 1e-9 && Math.abs(id.v - 0.5) < 1e-9);
  const off = applyTouchMap(0.5, 0.5, { offX: 0.1, offY: -0.2, scaleX: 1, scaleY: 1 });
  assert.ok(Math.abs(off.u - 0.6) < 1e-9 && Math.abs(off.v - 0.3) < 1e-9);
  // scale pivots at centre: 0.5 stays, edges move
  const sc = applyTouchMap(1.0, 0.5, { offX: 0, offY: 0, scaleX: 2, scaleY: 1 });
  assert.ok(Math.abs(sc.u - 1.5) < 1e-9 && Math.abs(sc.v - 0.5) < 1e-9);
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

test("motion mode ignores a static bright region but fires on a new one", () => {
  const w = 32, h = 32;
  const stat = new Uint8Array(w * h);
  for (let y = 4; y < 9; y++) for (let x = 4; x < 9; x++) stat[y * w + x] = 255; // static bright square
  const p = new IrTouchPipeline();
  p.opt.motion = true; p.opt.motionRate = 0.05;
  p.opt.threshold = 40; p.opt.minArea = 2; p.opt.maxArea = 8000; p.opt.erosionAmt = 0; p.opt.blurAmt = 0;
  const events: any[] = [];
  p.onEvent = (ev) => events.push(ev);
  // Let avg settle on the static scene over several identical frames.
  for (let i = 0; i < 40; i++) p.process(stat, w, h);
  assert.equal(events.length, 0, "static region should not produce motion events");
  // A brand-new bright region elsewhere is motion → should fire.
  const moved = stat.slice();
  for (let y = 20; y < 25; y++) for (let x = 20; x < 25; x++) moved[y * w + x] = 255;
  p.process(moved, w, h);
  assert.ok(events.length >= 1, "a newly appearing region should fire a motion event");
  assert.ok(events[0].x > 0.55 && events[0].y > 0.55, `event at the moved region, got ${events[0].x},${events[0].y}`);
});
