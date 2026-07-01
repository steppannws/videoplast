// src/sources/touch-source.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToSurface } from "./touch-source.ts";

test("maps client coords inside the canvas rect to [0,1]", () => {
  const rect = { left: 10, top: 20, width: 800, height: 500 };
  assert.deepEqual(clientToSurface(rect, 10, 20), { x: 0, y: 0 });
  assert.deepEqual(clientToSurface(rect, 810, 520), { x: 1, y: 1 });
  const mid = clientToSurface(rect, 410, 270);
  assert.ok(Math.abs(mid.x-0.5) < 1e-9 && Math.abs(mid.y-0.5) < 1e-9);
});

test("clamps outside the rect to [0,1]", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assert.deepEqual(clientToSurface(rect, -50, 200), { x: 0, y: 1 });
});
