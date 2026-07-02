import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultMesh, evalMesh, insertKnot, removeKnot, pointInQuad, type Corners } from "./quad.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

const sq: Corners = { tl: { x: 0, y: 0 }, tr: { x: 10, y: 0 }, br: { x: 10, y: 10 }, bl: { x: 0, y: 10 } };

test("pointInQuad inside / outside / boundary", () => {
  assert.equal(pointInQuad(5, 5, sq), true);
  assert.equal(pointInQuad(-1, 5, sq), false);
  assert.equal(pointInQuad(0, 5, sq), true); // boundary
});

test("evalMesh identity: pos === uv === (u,v) at knots and between", () => {
  const m = defaultMesh();
  for (const [u, v] of [[0, 0], [1 / 3, 2 / 3], [0.5, 0.5], [1, 1], [0.17, 0.9]]) {
    const r = evalMesh(m, u, v);
    near(r.pos.x, u); near(r.pos.y, v); near(r.uv.x, u); near(r.uv.y, v);
  }
});

test("evalMesh identity stays linear with non-uniform knots", () => {
  const m = insertKnot(defaultMesh(), "u", 1 / 6);
  assert.ok(m);
  const r = evalMesh(m, 0.25, 0.4);
  near(r.pos.x, 0.25); near(r.uv.x, 0.25); near(r.pos.y, 0.4);
});

test("evalMesh passes through a displaced control point", () => {
  const m = defaultMesh();
  m.off[1][1] = { x: 0.05, y: -0.03 };
  const r = evalMesh(m, m.ku[1], m.kv[1]);
  near(r.pos.x, 1 / 3 + 0.05); near(r.pos.y, 1 / 3 - 0.03);
  near(r.uv.x, 1 / 3); near(r.uv.y, 1 / 3); // uv unaffected by offsets
});

test("insertKnot preserves the surface at sampled points and rejects dups/cap", () => {
  const m0 = defaultMesh();
  m0.off[2][1] = { x: 0.04, y: 0.02 };
  const m1 = insertKnot(m0, "u", 1 / 6);
  assert.ok(m1);
  assert.equal(m1.ku.length, 5);
  for (const v of [0, 1 / 3, 2 / 3, 1]) {
    const a = evalMesh(m0, 1 / 6, v), b = evalMesh(m1, 1 / 6, v);
    near(b.pos.x, a.pos.x, 1e-6); near(b.pos.y, a.pos.y, 1e-6);
  }
  assert.equal(insertKnot(m1, "u", 1 / 6 + 0.01), null); // too close
  let m = m1;
  while (m.ku.length < 8) {
    // split the widest gap so we never collide with KNOT_EPS
    let gi = 0;
    for (let i = 0; i < m.ku.length - 1; i++) if (m.ku[i + 1] - m.ku[i] > m.ku[gi + 1] - m.ku[gi]) gi = i;
    const next = insertKnot(m, "u", (m.ku[gi] + m.ku[gi + 1]) / 2);
    assert.ok(next, `insert failed at ${m.ku.length} knots`);
    m = next;
  }
  assert.equal(insertKnot(m, "u", 0.9), null); // cap 8
});

test("removeKnot interior only, floor 4", () => {
  const m1 = insertKnot(defaultMesh(), "v", 0.5);
  assert.ok(m1);
  const m2 = removeKnot(m1, "v", 2);
  assert.ok(m2);
  assert.equal(m2.kv.length, 4);
  assert.equal(removeKnot(m2, "v", 1), null); // floor
  assert.equal(removeKnot(m1, "v", 0), null); // end pinned
});
