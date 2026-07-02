// src/ui/overlay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nudgeAxis } from "./overlay.ts";

test("nudgeAxis 1px and 10px steps", () => {
  assert.equal(nudgeAxis(0, 1, false), 1);
  assert.equal(nudgeAxis(0, -1, false), -1);
  assert.equal(nudgeAxis(0, 1, true), 10);
  assert.equal(nudgeAxis(5, -1, true), -5);
});

test("nudgeAxis clamps to ±PIN_LIMIT (2000)", () => {
  assert.equal(nudgeAxis(2000, 1, false), 2000);
  assert.equal(nudgeAxis(-2000, -1, true), -2000);
  assert.equal(nudgeAxis(1995, 1, true), 2000);
});

