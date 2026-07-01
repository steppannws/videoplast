// src/gl/gl-util.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { negotiateFloat } from "./gl-util.ts";
import type { GLCaps } from "./gl-util.ts";

function mockGL(present: Set<string>): GLCaps {
  return {
    FLOAT: 0x1406,
    UNSIGNED_BYTE: 0x1401,
    getExtension: (name: string) => (present.has(name) ? {} : null),
  };
}

test("float selected when float + renderable color buffer present", () => {
  const gl = mockGL(new Set(["OES_texture_float", "OES_texture_float_linear", "WEBGL_color_buffer_float"]));
  const caps = negotiateFloat(gl);
  assert.equal(caps.type, gl.FLOAT);
  assert.equal(caps.floatLinear, true);
});

test("falls back to 8-bit when color buffer float missing", () => {
  const gl = mockGL(new Set(["OES_texture_float", "OES_texture_float_linear"]));
  const caps = negotiateFloat(gl);
  assert.equal(caps.type, gl.UNSIGNED_BYTE);
});

test("falls back to 8-bit when no float extension at all", () => {
  const gl = mockGL(new Set());
  const caps = negotiateFloat(gl);
  assert.equal(caps.type, gl.UNSIGNED_BYTE);
  assert.equal(caps.floatLinear, false);
});

test("EXT_color_buffer_float also enables float", () => {
  const gl = mockGL(new Set(["OES_texture_float", "EXT_color_buffer_float"]));
  const caps = negotiateFloat(gl);
  assert.equal(caps.type, gl.FLOAT);
  assert.equal(caps.floatLinear, false);
});
