// src/gl/warp-gl.ts
import { computeH, inv3 } from "./homography.ts";
import { columnQuads, meshPoints as buildMesh } from "./quad.ts";
import type { Pt } from "./homography.ts";
import type { Mesh } from "./quad.ts";
import type { PinKey, Axis, SeamKey } from "../types/index.ts";

type Corners = Record<PinKey, { x: number; y: number }>;

// Per-vertex: clip-space position + the destination pixel position (for perspective-correct
// inverse-homography sampling in the fragment shader).
const VS = `attribute vec2 a_clip; attribute vec2 a_dst; varying vec2 v_dst;
void main(){ v_dst=a_dst; gl_Position=vec4(a_clip,0.0,1.0); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; uniform mat3 u_Hinv; uniform vec2 u_res; varying vec2 v_dst;
void main(){ vec3 h=u_Hinv*vec3(v_dst,1.0); vec2 sp=h.xy/h.z;
  vec2 uv=vec2(sp.x/u_res.x, 1.0 - sp.y/u_res.y);
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) gl_FragColor=vec4(0,0,0,1); else gl_FragColor=texture2D(u_tex,uv); }`;

// Pure: destination corner positions = base corners + per-corner pixel offsets.
export function cornerPositions(w: number, h: number, off: Corners): Corners {
  return {
    tl: { x: 0 + off.tl.x, y: 0 + off.tl.y },
    tr: { x: w + off.tr.x, y: 0 + off.tr.y },
    br: { x: w + off.br.x, y: h + off.br.y },
    bl: { x: 0 + off.bl.x, y: h + off.bl.y },
  };
}

function mk(gl: WebGLRenderingContext, t: number, s: string): WebGLShader {
  const sh = gl.createShader(t);
  if (!sh) throw new Error("warp: createShader failed");
  gl.shaderSource(sh, s); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("warp shader: " + gl.getShaderInfoLog(sh));
  return sh;
}

export class WarpGL {
  gl: WebGLRenderingContext;
  w: number;
  h: number;
  prog: WebGLProgram;
  quad: WebGLBuffer;
  aClip: number;
  aDst: number;
  uHinv: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
  uTex: WebGLUniformLocation | null;
  off: Corners;
  // Seam position (0..1) of the top-center / bottom-center handles along their edges.
  seam: { top: number; bottom: number };
  constructor(gl: WebGLRenderingContext, w: number, h: number) {
    this.gl = gl; this.w = w; this.h = h;
    const prog = gl.createProgram();
    if (!prog) throw new Error("warp: createProgram failed");
    this.prog = prog;
    gl.attachShader(prog, mk(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, mk(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("warp link: " + gl.getProgramInfoLog(prog));
    const quad = gl.createBuffer();
    if (!quad) throw new Error("warp: createBuffer failed");
    this.quad = quad;
    this.aClip = gl.getAttribLocation(prog, "a_clip");
    this.aDst = gl.getAttribLocation(prog, "a_dst");
    this.uHinv = gl.getUniformLocation(prog, "u_Hinv");
    this.uRes = gl.getUniformLocation(prog, "u_res");
    this.uTex = gl.getUniformLocation(prog, "u_tex");
    // per-corner pixel offsets from the base corners; all zero = identity (no keystone)
    this.off = { tl:{x:0,y:0}, tr:{x:0,y:0}, br:{x:0,y:0}, bl:{x:0,y:0} };
    this.seam = { top: 0.5, bottom: 0.5 };
  }
  setPinOffset(k: PinKey, axis: Axis, v: number): void { this.off[k][axis] = v; }
  setSeam(edge: SeamKey, t: number): void { this.seam[edge] = t; }
  resize(w: number, h: number): void { this.w = w; this.h = h; }
  cornerPositions(): Corners { return cornerPositions(this.w, this.h, this.off); }
  meshPoints(): Mesh { return buildMesh(this.cornerPositions(), this.seam.top, this.seam.bottom); }
  draw(srcTex: WebGLTexture): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(this.uTex, 0);
    gl.uniform2f(this.uRes, this.w, this.h);
    const cols = columnQuads(this.meshPoints(), this.w, this.h);
    for (const col of [cols.left, cols.right]) {
      const Hi = inv3(computeH(col.src, col.dst));
      gl.uniformMatrix3fv(this.uHinv, false, [Hi[0],Hi[3],Hi[6],Hi[1],Hi[4],Hi[7],Hi[2],Hi[5],Hi[8]]);
      this.drawColumn(col.dst);
    }
  }
  // Render one column's dst quad (dst ordered [TL,TR,BR,BL]) as a triangle strip; each
  // vertex carries its clip-space position and its dst pixel position.
  private drawColumn(dst: Pt[]): void {
    const gl = this.gl, w = this.w, h = this.h;
    const strip = [dst[0], dst[1], dst[3], dst[2]]; // TL, TR, BL, BR
    const verts = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const p = strip[i];
      verts[i*4+0] = 2 * p.x / w - 1;
      verts[i*4+1] = 1 - 2 * p.y / h;
      verts[i*4+2] = p.x;
      verts[i*4+3] = p.y;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aClip); gl.vertexAttribPointer(this.aClip, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.aDst); gl.vertexAttribPointer(this.aDst, 2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
