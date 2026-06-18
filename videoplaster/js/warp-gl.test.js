// videoplaster/js/warp-gl.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cornerPositions } from "./warp-gl.js";

const zero = { tl:{x:0,y:0}, tr:{x:0,y:0}, br:{x:0,y:0}, bl:{x:0,y:0} };

test("zero offsets give the base corners", () => {
  const c = cornerPositions(800, 500, zero);
  assert.deepEqual(c, { tl:{x:0,y:0}, tr:{x:800,y:0}, br:{x:800,y:500}, bl:{x:0,y:500} });
});

test("offsets shift each corner from its base", () => {
  const off = { tl:{x:10,y:5}, tr:{x:-20,y:0}, br:{x:0,y:-30}, bl:{x:7,y:8} };
  const c = cornerPositions(800, 500, off);
  assert.deepEqual(c.tl, { x:10, y:5 });
  assert.deepEqual(c.tr, { x:780, y:0 });
  assert.deepEqual(c.br, { x:800, y:470 });
  assert.deepEqual(c.bl, { x:7, y:508 });
});
