import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catmullRom, evalGrid, baseGrid, gridFromOffsets, nearestPoint, centroidOf, scalePoints,
  pointInQuad, gridIdx, type Corners, type Grid,
} from "./quad.ts";

const sq: Corners = { tl: { x: 0, y: 0 }, tr: { x: 10, y: 0 }, br: { x: 10, y: 10 }, bl: { x: 0, y: 10 } };

test("pointInQuad inside / outside / boundary", () => {
  assert.equal(pointInQuad(5, 5, sq), true);
  assert.equal(pointInQuad(-1, 5, sq), false);
  assert.equal(pointInQuad(0, 5, sq), true); // boundary
});

test("catmullRom hits p1 at t=0, p2 at t=1, midpoint of colinear pts", () => {
  const p = (x: number) => ({ x, y: 0 });
  assert.deepEqual(catmullRom(p(0), p(10), p(20), p(30), 0), { x: 10, y: 0 });
  assert.deepEqual(catmullRom(p(0), p(10), p(20), p(30), 1), { x: 20, y: 0 });
  assert.deepEqual(catmullRom(p(0), p(10), p(20), p(30), 0.5), { x: 15, y: 0 });
});

test("evalGrid passes through control points and is linear for the base grid", () => {
  const b = baseGrid(30, 30);
  // pass-through at each (i/3, j/3)
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    assert.deepEqual(evalGrid(b, i / 3, j / 3), b[gridIdx(i, j)]);
  }
  // interior of a moved grid still interpolates smoothly through points
  const g: Grid = b.map((p) => ({ ...p }));
  g[gridIdx(1, 1)] = { x: 15, y: 15 };
  assert.deepEqual(evalGrid(g, 1 / 3, 1 / 3), { x: 15, y: 15 });
  // base grid is linear
  assert.deepEqual(evalGrid(b, 0.5, 0.5), { x: 15, y: 15 });
});

test("baseGrid / gridFromOffsets", () => {
  const b = baseGrid(30, 30);
  assert.equal(b.length, 16);
  assert.deepEqual(b[gridIdx(0, 0)], { x: 0, y: 0 });
  assert.deepEqual(b[gridIdx(3, 3)], { x: 30, y: 30 });
  const off = b.map(() => ({ x: 0, y: 0 }));
  off[gridIdx(3, 3)] = { x: 5, y: -5 };
  assert.deepEqual(gridFromOffsets(off, 30, 30)[gridIdx(3, 3)], { x: 35, y: 25 });
});

test("nearestPoint picks the closest control point", () => {
  const b = baseGrid(30, 30);
  assert.equal(nearestPoint(1, 1, b), gridIdx(0, 0));
  assert.equal(nearestPoint(29, 29, b), gridIdx(3, 3));
});

test("centroidOf and scalePoints about a centre", () => {
  const b = baseGrid(30, 30);
  assert.deepEqual(centroidOf(b), { x: 15, y: 15 });
  const s = scalePoints(b, 2, { x: 15, y: 15 });
  assert.deepEqual(s[gridIdx(0, 0)], { x: -15, y: -15 });
  assert.deepEqual(centroidOf(s), { x: 15, y: 15 }); // centroid preserved
});
