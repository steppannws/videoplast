// videoplaster/js/warp-gl.ts
import { computeH, inv3 } from "./homography.ts";
import type { Pt } from "./homography.ts";
import type { PinKey, Axis } from "../types/index.ts";

type Corners = Record<PinKey, { x: number; y: number }>;

const VS = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv=(a_pos+1.0)*0.5; gl_Position=vec4(a_pos,0.,1.); }`;
const FS = `precision mediump float; uniform sampler2D u_tex; uniform mat3 u_Hinv; uniform vec2 u_res; varying vec2 v_uv;
void main(){ vec2 fp=vec2(v_uv.x*u_res.x,(1.0-v_uv.y)*u_res.y); vec3 h=u_Hinv*vec3(fp,1.0); vec2 sp=h.xy/h.z;
  vec2 uv=vec2(sp.x/u_res.x,1.0-sp.y/u_res.y);
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
  uHinv: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
  off: Corners;
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
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    this.uHinv = gl.getUniformLocation(prog, "u_Hinv"); this.uRes = gl.getUniformLocation(prog, "u_res");
    // per-corner pixel offsets from the base corners; all zero = identity (no keystone)
    this.off = { tl:{x:0,y:0}, tr:{x:0,y:0}, br:{x:0,y:0}, bl:{x:0,y:0} };
  }
  setPinOffset(k: PinKey, axis: Axis, v: number): void { this.off[k][axis] = v; }
  resize(w: number, h: number): void { this.w = w; this.h = h; }
  cornerPositions(): Corners { return cornerPositions(this.w, this.h, this.off); }
  draw(srcTex: WebGLTexture): void {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.prog); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(this.prog, "a_pos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const src: Pt[] = [{x:0,y:0},{x:this.w,y:0},{x:this.w,y:this.h},{x:0,y:this.h}];
    const c = this.cornerPositions();
    const dst: Pt[] = [c.tl, c.tr, c.br, c.bl];
    const H = computeH(src, dst), Hi = inv3(H);
    gl.uniformMatrix3fv(this.uHinv, false, [Hi[0],Hi[3],Hi[6],Hi[1],Hi[4],Hi[7],Hi[2],Hi[5],Hi[8]]);
    gl.uniform2f(this.uRes, this.w, this.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(gl.getUniformLocation(this.prog, "u_tex"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
