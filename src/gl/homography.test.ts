// src/gl/homography.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeH, inv3, applyH } from "./homography.ts";

test("identity-ish: unit square maps to itself", () => {
  const sq = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const H = computeH(sq, sq);
  const p = applyH(H, 0.3, 0.7);
  assert.ok(Math.abs(p.x - 0.3) < 1e-6 && Math.abs(p.y - 0.7) < 1e-6);
});

test("maps camera corners to surface [0,1] square", () => {
  const cam = [{x:100,y:50},{x:540,y:60},{x:520,y:300},{x:120,y:290}];
  const dst = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const H = computeH(cam, dst);
  const c0 = applyH(H, 100, 50), c2 = applyH(H, 520, 300);
  assert.ok(Math.hypot(c0.x-0, c0.y-0) < 1e-6);
  assert.ok(Math.hypot(c2.x-1, c2.y-1) < 1e-6);
});

test("inv3 of H composed with H is identity at a point", () => {
  const cam = [{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}];
  const dst = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const H = computeH(cam, dst); const Hi = inv3(H);
  const fwd = applyH(H, 2, 1.5);
  const back = applyH(Hi, fwd.x, fwd.y);
  assert.ok(Math.hypot(back.x-2, back.y-1.5) < 1e-6);
});
