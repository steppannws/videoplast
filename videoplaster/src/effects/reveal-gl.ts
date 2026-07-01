// videoplaster/src/reveal-gl.ts
// Erosion reveal effect: a cover layer hides the background. Touch erodes the
// cover within a radial brush, revealing the bg; the cover heals back toward
// fully-covered over time. The cover-amount is a single-channel field (R) in a
// ping-ponged texture: 1.0 = fully covered, 0.0 = fully revealed.
import { program, bindQuad, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

// One-time fill: write a constant value into the R channel of the target.
const FILL_FS = `precision highp float; varying vec2 v_uv;
uniform float u_val;
void main(){ gl_FragColor=vec4(u_val,0.,0.,1.); }`;

// Heal: move cover back toward 1.0 (fully covered) by the heal rate each frame.
const HEAL_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform float u_heal;
void main(){
  float c=texture2D(u_cur,v_uv).r;
  gl_FragColor=vec4(min(1.0, c+u_heal),0.,0.,1.);
}`;

// Paint: subtract cover within a radial brush at the touch point, eroding it.
const PAINT_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad, u_amp; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  float falloff=max(0., 1.-d/u_rad);
  falloff=falloff*falloff;            // softer brush edge
  float c=texture2D(u_cur,v_uv).r;
  gl_FragColor=vec4(max(0.0, c-u_amp*falloff),0.,0.,1.);
}`;

// Render: composite cover layer over the bg by the cover amount. The cover style
// is selected by u_cover (0 black / 1 noise / 2 frost). A slight darkening +
// edge highlight at the cover boundary makes the reveal feel tactile.
const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cover, u_bg; uniform vec2 u_texel; uniform float u_cover_style, u_time;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
void main(){
  float cover=texture2D(u_cover,v_uv).r;
  vec3 bg=texture2D(u_bg,v_uv).rgb;
  vec3 coverCol;
  if (u_cover_style < 0.5) {
    // 0: near-black
    coverCol=vec3(0.02,0.02,0.03);
  } else if (u_cover_style < 1.5) {
    // 1: procedural hash noise, lightly animated
    float n=hash(floor(v_uv/ max(u_texel.x,0.0001) *0.25) + floor(u_time*1.5));
    coverCol=vec3(n*0.8+0.1);
  } else {
    // 2: frost — darkened, desaturated version of the bg
    float g=dot(bg,vec3(0.299,0.587,0.114));
    coverCol=mix(vec3(g), bg, 0.25)*0.45+vec3(0.05,0.06,0.08);
  }
  // Edge of the reveal: where the cover gradient is steep, add a subtle highlight.
  float cl=texture2D(u_cover,v_uv-vec2(u_texel.x,0.)).r;
  float cr=texture2D(u_cover,v_uv+vec2(u_texel.x,0.)).r;
  float ct=texture2D(u_cover,v_uv-vec2(0.,u_texel.y)).r;
  float cb=texture2D(u_cover,v_uv+vec2(0.,u_texel.y)).r;
  float edge=length(vec2(cr-cl, cb-ct));
  vec3 col=mix(bg, coverCol, cover);
  col*=1.0 - edge*0.6;                 // slight darkening at the boundary
  col+=edge*0.5;                       // edge highlight
  gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
}`;

export const REVEAL_PARAMS: readonly EffectParam[] = [
  { key: "brush", label: "BRUSH", min: 0.01, max: 0.2, step: 0.005, default: 0.06 },
  { key: "heal", label: "HEAL", min: 0, max: 0.05, step: 0.001, default: 0.005 },
  { key: "cover", label: "COVER", min: 0, max: 2, step: 1, default: 0 },
];

export class RevealGL extends BaseEffect {
  brush = 0.06;
  heal = 0.005;
  cover = 0;
  time = 0;
  readonly params = REVEAL_PARAMS;
  progFill: WebGLProgram;
  progHeal: WebGLProgram;
  progPaint: WebGLProgram;
  progRender: WebGLProgram;
  texCur: WebGLTexture;
  texTmp: WebGLTexture;
  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    super(gl, simW, simH);
    this.progFill = program(gl, FILL_FS);
    this.progHeal = program(gl, HEAL_FS);
    this.progPaint = program(gl, PAINT_FS);
    this.progRender = program(gl, RENDER_FS);
    this.texCur = this.simTex(); this.texTmp = this.simTex();
    // Initialize both ping-pong buffers to fully-covered (cover = 1.0).
    this.fill(this.texCur, 1.0);
    this.fill(this.texTmp, 1.0);
  }
  setParam(key: string, value: number): void {
    if (key === "brush") this.brush = value;
    else if (key === "heal") this.heal = value;
    else if (key === "cover") this.cover = Math.round(value);
  }
  // One-time constant fill of a target texture's R channel.
  fill(target: WebGLTexture, val: number): void {
    const gl = this.gl; bindQuad(gl, this.progFill, this.quad);
    gl.uniform1f(gl.getUniformLocation(this.progFill, "u_val"), val);
    drawTo(gl, this.fbo, target, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  addTouch(ev: TouchEv): void {
    if (ev.state !== "up") this.paint(ev.x, ev.y, ev.strength);
  }
  // Erode the cover within a radial brush at (x, y) in touch space.
  paint(x: number, y: number, strength: number): void {
    const gl = this.gl; bindQuad(gl, this.progPaint, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progPaint, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progPaint, "u_pt"), x, 1.0 - y);
    gl.uniform1f(gl.getUniformLocation(this.progPaint, "u_rad"), this.brush);
    gl.uniform1f(gl.getUniformLocation(this.progPaint, "u_amp"), 0.5 * strength);
    gl.uniform2f(gl.getUniformLocation(this.progPaint, "u_aspect"), 1.0, this.h / this.w);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  // Heal the cover back toward fully-covered.
  step(): void {
    this.time += 1 / 60;
    const gl = this.gl; bindQuad(gl, this.progHeal, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progHeal, "u_cur"), 0);
    gl.uniform1f(gl.getUniformLocation(this.progHeal, "u_heal"), this.heal);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  renderToTexture(): WebGLTexture {
    const gl = this.gl; drawTo(gl, this.fbo, this.sceneTex, this.w, this.h); bindQuad(gl, this.progRender, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_cover"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_cover_style"), this.cover);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_time"), this.time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.sceneTex;
  }
}
