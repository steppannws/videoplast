// src/gl/warp-gl.ts
// Media warp: a 4×4 control-point grid rendered as a fine Catmull-Rom mesh. The source
// texture is sampled with per-vertex UVs; the grid deforms the destination positions.
import { gridFromOffsets, evalGrid } from "./quad.ts";
import type { Pt } from "./homography.ts";
import type { Grid } from "./quad.ts";

const N = 24; // tessellation subdivisions per axis

const VS = `attribute vec2 a_clip; attribute vec2 a_uv; varying vec2 v_uv;
void main(){ v_uv=a_uv; gl_Position=vec4(a_clip,0.0,1.0); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; varying vec2 v_uv;
void main(){ gl_FragColor = texture2D(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)); }`;

function mk(gl: WebGLRenderingContext, t: number, s: string): WebGLShader {
  const sh = gl.createShader(t);
  if (!sh) throw new Error("warp: createShader failed");
  gl.shaderSource(sh, s); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("warp shader: " + gl.getShaderInfoLog(sh));
  return sh;
}

// Static triangle indices for an (N+1)×(N+1) vertex grid.
function buildIndices(): Uint16Array {
  const idx: number[] = [];
  const row = N + 1;
  for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
    const v00 = b * row + a, v10 = v00 + 1, v01 = v00 + row, v11 = v01 + 1;
    idx.push(v00, v10, v01, v10, v11, v01);
  }
  return new Uint16Array(idx);
}

const zeros = (): Pt[] => Array.from({ length: 16 }, () => ({ x: 0, y: 0 }));

export class WarpGL {
  gl: WebGLRenderingContext;
  w: number;
  h: number;
  prog: WebGLProgram;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  aClip: number;
  aUv: number;
  uTex: WebGLUniformLocation | null;
  indexCount: number;
  verts: Float32Array;
  // Per-control-point pixel offsets from the base grid; all zero = identity (flat rect).
  off: Pt[];
  constructor(gl: WebGLRenderingContext, w: number, h: number) {
    this.gl = gl; this.w = w; this.h = h;
    const prog = gl.createProgram();
    if (!prog) throw new Error("warp: createProgram failed");
    this.prog = prog;
    gl.attachShader(prog, mk(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, mk(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("warp link: " + gl.getProgramInfoLog(prog));
    const vbo = gl.createBuffer(), ibo = gl.createBuffer();
    if (!vbo || !ibo) throw new Error("warp: createBuffer failed");
    this.vbo = vbo; this.ibo = ibo;
    const indices = buildIndices();
    this.indexCount = indices.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.aClip = gl.getAttribLocation(prog, "a_clip");
    this.aUv = gl.getAttribLocation(prog, "a_uv");
    this.uTex = gl.getUniformLocation(prog, "u_tex");
    this.verts = new Float32Array((N + 1) * (N + 1) * 4);
    this.off = zeros();
  }
  setPointOffset(idx: number, x: number, y: number): void { this.off[idx] = { x, y }; }
  reset(): void { this.off = zeros(); }
  resize(w: number, h: number): void { this.w = w; this.h = h; }
  points(): Grid { return gridFromOffsets(this.off, this.w, this.h); }
  draw(srcTex: WebGLTexture): void {
    const gl = this.gl, w = this.w, h = this.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const grid = this.points();
    const v = this.verts;
    let o = 0;
    for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) {
      const u = a / N, vv = b / N;
      const p = evalGrid(grid, u, vv);
      v[o++] = 2 * p.x / w - 1;
      v[o++] = 1 - 2 * p.y / h;
      v[o++] = u;
      v[o++] = vv;
    }
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(this.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aClip); gl.vertexAttribPointer(this.aClip, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.aUv); gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }
}
