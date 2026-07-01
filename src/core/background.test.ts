// src/core/background.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitDims } from "./background.ts";

test("square source covers a wide canvas (fills height-overflow)", () => {
  assert.deepEqual(fitDims(100, 100, 800, 500), { dw: 800, dh: 800 });
});
test("wide source covers a less-wide canvas (fills width-overflow)", () => {
  assert.deepEqual(fitDims(400, 100, 800, 500), { dw: 2000, dh: 500 });
});
test("matching aspect maps exactly to canvas", () => {
  assert.deepEqual(fitDims(1600, 1000, 800, 500), { dw: 800, dh: 500 });
});
