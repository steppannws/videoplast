import { test } from "node:test";
import assert from "node:assert/strict";
import { centroid, scaleCorners, pointInQuad, type Corners } from "./quad.ts";

const sq: Corners = { tl: { x: 0, y: 0 }, tr: { x: 10, y: 0 }, br: { x: 10, y: 10 }, bl: { x: 0, y: 10 } };

test("centroid is the mean corner", () => {
  assert.deepEqual(centroid(sq), { x: 5, y: 5 });
});

test("scaleCorners factor 1 is identity; factor 2 doubles about centroid", () => {
  assert.deepEqual(scaleCorners(sq, 1), sq);
  assert.deepEqual(scaleCorners(sq, 2), { tl: { x: -5, y: -5 }, tr: { x: 15, y: -5 }, br: { x: 15, y: 15 }, bl: { x: -5, y: 15 } });
  assert.deepEqual(centroid(scaleCorners(sq, 2)), { x: 5, y: 5 }); // centroid preserved
});

test("pointInQuad inside / outside / boundary", () => {
  assert.equal(pointInQuad(5, 5, sq), true);
  assert.equal(pointInQuad(-1, 5, sq), false);
  assert.equal(pointInQuad(0, 5, sq), true); // boundary
});
