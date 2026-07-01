// src/effects/registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFECTS, DEFAULT_EFFECT, effectById } from "./registry.ts";
import { effectKeyIndex } from "../ui/overlay.ts";
import type { EffectParam } from "../types/index.ts";
import { WATER_PARAMS } from "./water-gl.ts";
import { INK_PARAMS } from "./ink-gl.ts";
import { REVEAL_PARAMS } from "./reveal-gl.ts";
import { THERMAL_PARAMS } from "./thermal-gl.ts";
import { SHATTER_PARAMS } from "./shatter-gl.ts";
import { PARTICLES_PARAMS } from "./particles-gl.ts";

test("registry has the six effects in key order", () => {
  assert.deepEqual(EFFECTS.map((e) => e.id), ["water", "ink", "reveal", "thermal", "shatter", "particles"]);
});

test("effect ids are unique", () => {
  const ids = EFFECTS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every effect has a label and a factory", () => {
  for (const e of EFFECTS) {
    assert.ok(e.label.length > 0, `${e.id} missing label`);
    assert.equal(typeof e.make, "function", `${e.id} missing make`);
  }
});

test("default effect exists in the registry", () => {
  assert.ok(effectById(DEFAULT_EFFECT), "default effect not registered");
});

test("effectById returns undefined for unknown ids", () => {
  assert.equal(effectById("nope"), undefined);
});

const PARAM_SETS: Array<[string, readonly EffectParam[]]> = [
  ["water", WATER_PARAMS],
  ["ink", INK_PARAMS],
  ["reveal", REVEAL_PARAMS],
  ["thermal", THERMAL_PARAMS],
  ["shatter", SHATTER_PARAMS],
  ["particles", PARTICLES_PARAMS],
];

for (const [id, params] of PARAM_SETS) {
  test(`${id} params are well-formed`, () => {
    assert.ok(params.length > 0, `${id} has no params`);
    const keys = new Set<string>();
    for (const p of params) {
      assert.ok(p.key.length > 0, `${id} param missing key`);
      assert.ok(p.label.length > 0, `${id}.${p.key} missing label`);
      assert.ok(!keys.has(p.key), `${id} duplicate key ${p.key}`);
      keys.add(p.key);
      assert.ok(p.min < p.max, `${id}.${p.key} min<max`);
      assert.ok(p.step > 0, `${id}.${p.key} step>0`);
      assert.ok(p.default >= p.min && p.default <= p.max, `${id}.${p.key} default in range`);
    }
  });
}

test("effectKeyIndex maps digit keys 1..9 to zero-based index", () => {
  assert.equal(effectKeyIndex("1"), 0);
  assert.equal(effectKeyIndex("6"), 5);
  assert.equal(effectKeyIndex("9"), 8);
});

test("effectKeyIndex ignores non-digit and 0 keys", () => {
  assert.equal(effectKeyIndex("0"), null);
  assert.equal(effectKeyIndex("h"), null);
  assert.equal(effectKeyIndex("ArrowLeft"), null);
  assert.equal(effectKeyIndex(""), null);
});
