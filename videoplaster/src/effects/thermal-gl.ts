// videoplaster/src/thermal-gl.ts
// Thermal heat effect: touch deposits heat into a single-channel field that
// diffuses and cools over time; rendering uses the heat gradient to distort the
// background media and tints it with a cold→hot thermal palette.
import { program, bindQuad, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

// Additive radial heat splat at a point (heat += amount * falloff).
const DROP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad, u_amp; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  float falloff=max(0., 1.-d/u_rad);
  float add=u_amp*falloff*falloff;
  gl_FragColor=vec4(texture2D(u_cur,v_uv).r+add,0.,0.,1.);
}`;

// Diffuse + cool: blur heat toward 4/8 neighbours by u_spread, then retain u_cool.
const STEP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_texel; uniform float u_spread, u_cool;
void main(){
  float c =texture2D(u_cur,v_uv).r;
  float l =texture2D(u_cur,v_uv-vec2(u_texel.x,0.)).r;
  float r =texture2D(u_cur,v_uv+vec2(u_texel.x,0.)).r;
  float t =texture2D(u_cur,v_uv-vec2(0.,u_texel.y)).r;
  float b =texture2D(u_cur,v_uv+vec2(0.,u_texel.y)).r;
  float tl=texture2D(u_cur,v_uv+vec2(-u_texel.x,-u_texel.y)).r;
  float tr=texture2D(u_cur,v_uv+vec2( u_texel.x,-u_texel.y)).r;
  float bl=texture2D(u_cur,v_uv+vec2(-u_texel.x, u_texel.y)).r;
  float br=texture2D(u_cur,v_uv+vec2( u_texel.x, u_texel.y)).r;
  // Weighted neighbour average (cross weighted more than diagonals).
  float neigh=((l+r+t+b)*2.0 + (tl+tr+bl+br))/12.0;
  float blended=mix(c, neigh, clamp(u_spread*0.5, 0.0, 1.0));
  gl_FragColor=vec4(blended*u_cool, 0., 0., 1.);
}`;

// Render: heat gradient distorts bg UV (shimmer); heat maps to a thermal palette
// blended over the distorted bg, with a soft additive glow at high heat.
const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_heat, u_bg; uniform vec2 u_texel; uniform float u_distort;
// Smooth cold→hot ramp: black → deep red → orange → yellow → white.
vec3 palette(float h){
  h=clamp(h,0.0,1.0);
  vec3 black=vec3(0.0,0.0,0.0);
  vec3 red  =vec3(0.55,0.0,0.0);
  vec3 orange=vec3(1.0,0.45,0.0);
  vec3 yellow=vec3(1.0,0.92,0.25);
  vec3 white=vec3(1.0,1.0,1.0);
  vec3 col=mix(black,red, smoothstep(0.0,0.25,h));
  col=mix(col,orange, smoothstep(0.25,0.5,h));
  col=mix(col,yellow, smoothstep(0.5,0.78,h));
  col=mix(col,white, smoothstep(0.78,1.0,h));
  return col;
}
void main(){
  float hl=texture2D(u_heat,v_uv-vec2(u_texel.x,0.)).r;
  float hr=texture2D(u_heat,v_uv+vec2(u_texel.x,0.)).r;
  float ht=texture2D(u_heat,v_uv-vec2(0.,u_texel.y)).r;
  float hb=texture2D(u_heat,v_uv+vec2(0.,u_texel.y)).r;
  vec2 grad=vec2(hr-hl, hb-ht);
  vec3 bg=texture2D(u_bg, v_uv+grad*u_distort).rgb;
  float h=texture2D(u_heat,v_uv).r;
  float w=clamp(h,0.0,1.0);
  vec3 col=mix(bg, palette(w), w);
  // Soft additive glow at high heat.
  col += palette(w) * smoothstep(0.6, 1.2, h) * 0.6;
  gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
}`;

export const THERMAL_PARAMS: readonly EffectParam[] = [
  { key: "heat", label: "HEAT", min: 0, max: 3, step: 0.01, default: 1.2 },
  { key: "spread", label: "SPREAD", min: 0, max: 2, step: 0.01, default: 1.0 },
  { key: "cool", label: "COOL", min: 0.9, max: 0.999, step: 0.001, default: 0.97 },
  { key: "distort", label: "DISTORT", min: 0, max: 0.1, step: 0.001, default: 0.02 },
];

export class ThermalGL extends BaseEffect {
  heat = 1.2;
  spread = 1.0;
  cool = 0.97;
  distort = 0.02;
  readonly params = THERMAL_PARAMS;
  progDrop: WebGLProgram;
  progStep: WebGLProgram;
  progRender: WebGLProgram;
  texCur: WebGLTexture;
  texTmp: WebGLTexture;
  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    super(gl, simW, simH);
    this.progDrop = program(gl, DROP_FS); this.progStep = program(gl, STEP_FS); this.progRender = program(gl, RENDER_FS);
    this.texCur = this.simTex(); this.texTmp = this.simTex();
  }
  setParam(key: string, value: number): void {
    if (key === "heat") this.heat = value;
    else if (key === "spread") this.spread = value;
    else if (key === "cool") this.cool = value;
    else if (key === "distort") this.distort = value;
  }
  addTouch(ev: TouchEv): void {
    if (ev.state !== "up") this.addHeat(ev.x, ev.y, ev.strength);
  }
  addHeat(x: number, y: number, strength: number): void {
    const gl = this.gl; bindQuad(gl, this.progDrop, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progDrop, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_pt"), x, 1.0 - y);
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_rad"), 0.05);
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_amp"), this.heat * strength);
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_aspect"), 1.0, this.h / this.w);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  step(): void {
    const gl = this.gl; bindQuad(gl, this.progStep, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progStep, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progStep, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progStep, "u_spread"), this.spread);
    gl.uniform1f(gl.getUniformLocation(this.progStep, "u_cool"), this.cool);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  renderToTexture(): WebGLTexture {
    const gl = this.gl; drawTo(gl, this.fbo, this.sceneTex, this.w, this.h); bindQuad(gl, this.progRender, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_heat"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_distort"), this.distort);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.sceneTex;
  }
}
