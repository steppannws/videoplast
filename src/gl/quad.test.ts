import { test } from "node:test";
import assert from "node:assert/strict";
import { centroid, scaleCorners, pointInQuad, lerpPt, meshPoints, columnQuads, paramOnEdge, type Corners } from "./quad.ts";

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

test("lerpPt endpoints and midpoint", () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 20 };
  assert.deepEqual(lerpPt(a, b, 0), a);
  assert.deepEqual(lerpPt(a, b, 1), b);
  assert.deepEqual(lerpPt(a, b, 0.5), { x: 5, y: 10 });
});

test("meshPoints places tc/bc along the edges", () => {
  assert.deepEqual(meshPoints(sq, 0.5, 0.5).tc, { x: 5, y: 0 });
  assert.deepEqual(meshPoints(sq, 0.5, 0.5).bc, { x: 5, y: 10 });
  assert.deepEqual(meshPoints(sq, 0.2, 0.8).tc, { x: 2, y: 0 });
  assert.deepEqual(meshPoints(sq, 0.2, 0.8).bc, { x: 8, y: 10 });
});

test("columnQuads splits source at the midline and assigns dst corners", () => {
  const m = meshPoints(sq, 0.5, 0.5);
  const { left, right } = columnQuads(m, 10, 10);
  assert.deepEqual(left.src, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 10 }]);
  assert.deepEqual(left.dst, [m.tl, m.tc, m.bc, m.bl]);
  assert.deepEqual(right.src, [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 10 }]);
  assert.deepEqual(right.dst, [m.tc, m.tr, m.br, m.bc]);
});

test("paramOnEdge projects and clamps to [0.02, 0.98]", () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
  assert.equal(paramOnEdge(5, 0, a, b), 0.5);
  assert.equal(paramOnEdge(2.5, 0, a, b), 0.25);
  assert.equal(paramOnEdge(5, 3, a, b), 0.5); // perpendicular offset ignored
  assert.equal(paramOnEdge(-5, 0, a, b), 0.02); // clamped low
  assert.equal(paramOnEdge(100, 0, a, b), 0.98); // clamped high
});
