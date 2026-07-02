// src/gl/warp-gl.ts
// Two-layer media warp. Layer 1: 4 corner offsets -> homography H (unit square ->
// screen px). Layer 2: detail mesh in unit-square space (quad.ts). Rendered as a fine
// tessellated textured mesh: vertex position = H(evalMesh(u,v).pos), uv = evalMesh.uv.
// Also owns the generated TEST PATTERN texture (warped checkerboard for calibration).
import { computeH, applyH } from "./homography.ts";
import { defaultMesh, evalMesh, cloneMesh } from "./quad.ts";
import type { Pt } from "./homography.ts";
import type { MeshState } from "./quad.ts";

const N = 32; // tessellation subdivisions per axis
const DEGENERATE_PX = 8; // corner pairs closer than this: keep last valid H

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

// Static triangle indices for an (N+1)x(N+1) vertex grid.
function buildIndices(): Uint16Array {
  const idx: number[] = [];
  const row = N + 1;
  for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
    const v00 = b * row + a, v10 = v00 + 1, v01 = v00 + row, v11 = v01 + 1;
    idx.push(v00, v10, v01, v10, v11, v01);
  }
  return new Uint16Array(idx);
}

// 512x512 checkerboard with a bright border and center cross — drawn once, sampled
// instead of the effect texture while TEST PATTERN is on.
function buildPattern(gl: WebGLRenderingContext): WebGLTexture {
  const S = 512, cells = 8, c = document.createElement("canvas");
  c.width = S; c.height = S;
  const x = c.getContext("2d")!;
  const cell = S / cells;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    x.fillStyle = (i + j) % 2 ? "#dddddd" : "#666666";
    x.fillRect(i * cell, j * cell, cell, cell);
  }
  x.strokeStyle = "#00ff8c"; x.lineWidth = 4;
  x.strokeRect(2, 2, S - 4, S - 4);
  x.beginPath();
  x.moveTo(S / 2, 0); x.lineTo(S / 2, S);
  x.moveTo(0, S / 2); x.lineTo(S, S / 2);
  x.stroke();
  const tex = gl.createTexture();
  if (!tex) throw new Error("warp: pattern texture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

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
  // Layer 1: per-corner px offsets from the base rect corners (tl,tr,br,bl order).
  corners: Pt[];
  // Layer 2: detail mesh in unit-square space.
  mesh: MeshState;
  testPattern = false;
  private pattern: WebGLTexture | null = null;
  private _H: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private _Hdirty = true;

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
    this.corners = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    this.mesh = defaultMesh();
  }

  setCorner(i: number, x: number, y: number): void { this.corners[i] = { x, y }; this._Hdirty = true; }
  setCorners(c: Pt[]): void { this.corners = c.map((p) => ({ ...p })); this._Hdirty = true; }
  setMesh(m: MeshState): void { this.mesh = cloneMesh(m); }
  setTestPattern(on: boolean): void { this.testPattern = on; }
  resetCorners(): void { this.setCorners([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]); }
  resetMesh(): void { this.mesh = defaultMesh(); }
  resize(w: number, h: number): void { this.w = w; this.h = h; this._Hdirty = true; }

  // Screen positions of the 4 corners: base rect + offsets (tl,tr,br,bl).
  cornerScreen(): Pt[] {
    const b = [{ x: 0, y: 0 }, { x: this.w, y: 0 }, { x: this.w, y: this.h }, { x: 0, y: this.h }];
    return b.map((p, i) => ({ x: p.x + this.corners[i].x, y: p.y + this.corners[i].y }));
  }

  // Homography unit square -> screen px. Degenerate corner layouts keep the last valid H.
  H(): number[] {
    if (!this._Hdirty) return this._H;
    const c = this.cornerScreen();
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y) < DEGENERATE_PX) return this._H;
    }
    const src: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    this._H = computeH(src, c);
    this._Hdirty = false;
    return this._H;
  }

  draw(srcTex: WebGLTexture): void {
    const gl = this.gl, w = this.w, h = this.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const H = this.H();
    const v = this.verts;
    let o = 0;
    for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) {
      const e = evalMesh(this.mesh, a / N, b / N);
      const p = applyH(H, e.pos.x, e.pos.y);
      v[o++] = 2 * p.x / w - 1;
      v[o++] = 1 - 2 * p.y / h;
      v[o++] = e.uv.x;
      v[o++] = e.uv.y;
    }
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    if (this.testPattern) {
      if (!this.pattern) this.pattern = buildPattern(gl);
      gl.bindTexture(gl.TEXTURE_2D, this.pattern);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
    }
    gl.uniform1i(this.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aClip); gl.vertexAttribPointer(this.aClip, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.aUv); gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }
}
