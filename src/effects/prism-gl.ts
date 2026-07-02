// src/effects/prism-gl.ts
// Crystal Prism effect: similar to Water, but the wave gradient refracts the 
// background with heavy chromatic aberration, separating the RGB channels like a prism.
import { program, bindQuad, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

const DROP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad, u_amp; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  float add = u_amp * max(0., 1.0 - d/u_rad);
  gl_FragColor=vec4(texture2D(u_cur,v_uv).r+add,0.,0.,1.);
}`;

// Wave equation, heavily damped so it doesn't ripple forever, 
// acting more like thick jelly or solid glass being warped.
const UPDATE_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_prev, u_cur; uniform vec2 u_texel; uniform float u_damp;
void main(){
  float l=texture2D(u_cur,v_uv-vec2(u_texel.x,0.)).r;
  float r=texture2D(u_cur,v_uv+vec2(u_texel.x,0.)).r;
  float t=texture2D(u_cur,v_uv-vec2(0.,u_texel.y)).r;
  float b=texture2D(u_cur,v_uv+vec2(0.,u_texel.y)).r;
  float p=texture2D(u_prev,v_uv).r;
  float n=((l+r+t+b)*0.5 - p)*u_damp;
  gl_FragColor=vec4(n,0.,0.,1.);
}`;

const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_height, u_bg; 
uniform vec2 u_texel; 
uniform float u_intensity;
uniform float u_aberration;
void main(){
  float hl=texture2D(u_height,v_uv-vec2(u_texel.x,0.)).r;
  float hr=texture2D(u_height,v_uv+vec2(u_texel.x,0.)).r;
  float ht=texture2D(u_height,v_uv-vec2(0.,u_texel.y)).r;
  float hb=texture2D(u_height,v_uv+vec2(0.,u_texel.y)).r;
  
  vec2 grad = vec2(hr-hl, hb-ht) * u_intensity;
  
  // Chromatic Aberration: R, G, B channels sampled at different gradient offsets
  float r = texture2D(u_bg, v_uv + grad * (1.0 + u_aberration)).r;
  float g = texture2D(u_bg, v_uv + grad).g;
  float b = texture2D(u_bg, v_uv + grad * (1.0 - u_aberration)).b;
  
  // Add a bright crystal highlight on the edges of the distortion
  float h = texture2D(u_height, v_uv).r;
  float highlight = clamp(abs(h) * 0.5, 0.0, 0.2);
  
  gl_FragColor = vec4(r + highlight, g + highlight, b + highlight, 1.0);
}`;

export const PRISM_PARAMS: readonly EffectParam[] = [
  { key: "intensity", label: "REFRACTION", min: 0.1, max: 5.0, step: 0.1, default: 2.0 },
  { key: "aberration", label: "RGB SPLIT", min: 0.0, max: 2.0, step: 0.05, default: 0.5 },
  { key: "radius", label: "IMPACT SIZE", min: 0.01, max: 0.2, step: 0.01, default: 0.05 },
];

export class PrismGL extends BaseEffect {
  damp = 0.94; // Heavier damping than water
  intensity = 2.0;
  aberration = 0.5;
  radius = 0.05;
  readonly params = PRISM_PARAMS;
  progUpdate: WebGLProgram;
  progDrop: WebGLProgram;
  progRender: WebGLProgram;
  texPrev: WebGLTexture;
  texCur: WebGLTexture;
  texTmp: WebGLTexture;
  
  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    super(gl, simW, simH);
    this.progUpdate = program(gl, UPDATE_FS); 
    this.progDrop = program(gl, DROP_FS); 
    this.progRender = program(gl, RENDER_FS);
    this.texPrev = this.simTex(); 
    this.texCur = this.simTex(); 
    this.texTmp = this.simTex();
  }
  
  setParam(key: string, value: number): void {
    if (key === "intensity") this.intensity = value;
    else if (key === "aberration") this.aberration = value;
    else if (key === "radius") this.radius = value;
  }
  
  addTouch(ev: TouchEv): void {
    if (ev.state !== "up") this.addDrop(ev.x, ev.y, ev.strength);
  }
  
  addDrop(x: number, y: number, strength: number): void {
    const gl = this.gl; bindQuad(gl, this.progDrop, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progDrop, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_pt"), x, 1.0 - y);
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_rad"), this.radius);
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_amp"), 1.0 * (0.5 + 0.5 * strength));
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_aspect"), 1.0, this.h / this.w);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  
  step(): void {
    const gl = this.gl; bindQuad(gl, this.progUpdate, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texPrev);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate, "u_prev"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate, "u_cur"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progUpdate, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate, "u_damp"), this.damp);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texPrev, this.texCur, this.texTmp] = [this.texCur, this.texTmp, this.texPrev];
  }
  
  renderToTexture(): WebGLTexture {
    const gl = this.gl; drawTo(gl, this.fbo, this.sceneTex, this.w, this.h); bindQuad(gl, this.progRender, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_height"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_intensity"), this.intensity);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_aberration"), this.aberration);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.sceneTex;
  }
}
