// src/ui/overlay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nudgeAxis, gridLines } from "./overlay.ts";

test("nudgeAxis 1px and 10px steps", () => {
  assert.equal(nudgeAxis(0, 1, false), 1);
  assert.equal(nudgeAxis(0, -1, false), -1);
  assert.equal(nudgeAxis(0, 1, true), 10);
  assert.equal(nudgeAxis(5, -1, true), -5);
});

test("nudgeAxis clamps to [-400,400]", () => {
  assert.equal(nudgeAxis(400, 1, false), 400);
  assert.equal(nudgeAxis(-400, -1, true), -400);
  assert.equal(nudgeAxis(395, 1, true), 400);
});

test("gridLines spacing, center, corners", () => {
  const g = gridLines(100, 80, 50);
  assert.deepEqual(g.verticals, [0, 50, 100]);
  assert.deepEqual(g.horizontals, [0, 50]);
  assert.equal(g.cx, 50);
  assert.equal(g.cy, 40);
  assert.deepEqual(g.corners, [[0, 0], [100, 0], [100, 80], [0, 80]]);
});
