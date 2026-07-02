// src/effects/smear-gl.ts
// Paint Smear effect: a velocity vector field that advects both itself and a
// persistent color buffer, creating a wet paint / datamoshing visual feedback loop.
import { program, bindQuad, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

const VEL_DROP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_vel; uniform vec2 u_pt, u_swipe; uniform float u_rad; uniform vec2 u_aspect;
void main(){
  vec2 vel = texture2D(u_vel, v_uv).rg;
  float d = length((v_uv - u_pt) * u_aspect);
  float mask = smoothstep(1.0, 0.0, d / u_rad);
  gl_FragColor = vec4(vel + u_swipe * mask, 0.0, 1.0);
}`;

const VEL_UPDATE_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_vel; uniform vec2 u_texel; uniform float u_damp;
void main(){
  // Self Advection: look upstream according to our own velocity
  vec2 vel = texture2D(u_vel, v_uv).rg;
  vec2 src_uv = v_uv - vel * 0.5;
  vec2 adv_vel = texture2D(u_vel, clamp(src_uv, 0.0, 1.0)).rg;
  
  // Diffusion
  vec2 l = texture2D(u_vel, v_uv - vec2(u_texel.x, 0.0)).rg;
  vec2 r = texture2D(u_vel, v_uv + vec2(u_texel.x, 0.0)).rg;
  vec2 t = texture2D(u_vel, v_uv - vec2(0.0, u_texel.y)).rg;
  vec2 b = texture2D(u_vel, v_uv + vec2(0.0, u_texel.y)).rg;
  
  vec2 blur = (adv_vel * 4.0 + l + r + t + b) * 0.125;
  gl_FragColor = vec4(blur * u_damp, 0.0, 1.0);
}`;

const COLOR_UPDATE_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_color, u_vel, u_bg; 
uniform float u_persistence;
void main(){
  vec2 vel = texture2D(u_vel, v_uv).rg;
  // Advect color heavily by velocity
  vec2 src_uv = v_uv - vel * 2.0; 
  
  vec3 smearColor = texture2D(u_color, clamp(src_uv, 0.0, 1.0)).rgb;
  vec3 liveColor = texture2D(u_bg, v_uv).rgb;
  
  // Blend back to live video to "heal" the paint
  gl_FragColor = vec4(mix(liveColor, smearColor, u_persistence), 1.0);
}`;

const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_color, u_vel;
uniform float u_emboss;
void main(){
  vec3 col = texture2D(u_color, v_uv).rgb;
  vec2 v = texture2D(u_vel, v_uv).rg;
  // Fake specular highlight based on velocity gradient for a wet look
  float wetness = length(v) * u_emboss;
  gl_FragColor = vec4(col + vec3(wetness), 1.0);
}`;

export const SMEAR_PARAMS: readonly EffectParam[] = [
  { key: "radius", label: "BRUSH SIZE", min: 0.01, max: 0.3, step: 0.01, default: 0.1 },
  { key: "viscosity", label: "VISCOSITY", min: 0.8, max: 0.999, step: 0.001, default: 0.97 },
  { key: "persistence", label: "PERSISTENCE", min: 0.8, max: 0.999, step: 0.001, default: 0.97 },
  { key: "emboss", label: "WETNESS", min: 0.0, max: 5.0, step: 0.1, default: 2.0 },
];

export class SmearGL extends BaseEffect {
  radius = 0.1;
  viscosity = 0.97;
  persistence = 0.97;
  emboss = 2.0;
  
  readonly params = SMEAR_PARAMS;
  
  progVelDrop: WebGLProgram;
  progVelUpdate: WebGLProgram;
  progColorUpdate: WebGLProgram;
  progRender: WebGLProgram;
  
  texVelCur: WebGLTexture;
  texVelTmp: WebGLTexture;
  texColorCur: WebGLTexture;
  texColorTmp: WebGLTexture;
  
  prevTouches = new Map<number, {x: number, y: number}>();
  
  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    super(gl, simW, simH);
    this.progVelDrop = program(gl, VEL_DROP_FS);
    this.progVelUpdate = program(gl, VEL_UPDATE_FS);
    this.progColorUpdate = program(gl, COLOR_UPDATE_FS);
    this.progRender = program(gl, RENDER_FS);
    
    this.texVelCur = this.simTex();
    this.texVelTmp = this.simTex();
    this.texColorCur = this.simTex();
    this.texColorTmp = this.simTex();
  }
  
  setParam(key: string, value: number): void {
    if (key === "radius") this.radius = value;
    else if (key === "viscosity") this.viscosity = value;
    else if (key === "persistence") this.persistence = value;
    else if (key === "emboss") this.emboss = value;
  }
  
  addTouch(ev: TouchEv): void {
    if (ev.state === "up") {
      this.prevTouches.delete(ev.id);
      return;
    }
    const prev = this.prevTouches.get(ev.id);
    if (prev) {
      const dx = ev.x - prev.x;
      const dy = ev.y - prev.y;
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
        this.addDrop(ev.x, ev.y, dx, -dy, ev.strength); 
      }
    }
    this.prevTouches.set(ev.id, { x: ev.x, y: ev.y });
  }
  
  addDrop(x: number, y: number, vx: number, vy: number, strength: number): void {
    const gl = this.gl; bindQuad(gl, this.progVelDrop, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texVelCur);
    gl.uniform1i(gl.getUniformLocation(this.progVelDrop, "u_vel"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progVelDrop, "u_pt"), x, 1.0 - y);
    // Multiply by a factor to make velocity significant
    gl.uniform2f(gl.getUniformLocation(this.progVelDrop, "u_swipe"), vx * 3.0, vy * 3.0);
    gl.uniform1f(gl.getUniformLocation(this.progVelDrop, "u_rad"), this.radius * (0.5 + 0.5 * strength));
    gl.uniform2f(gl.getUniformLocation(this.progVelDrop, "u_aspect"), 1.0, this.h / this.w);
    drawTo(gl, this.fbo, this.texVelTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texVelCur, this.texVelTmp] = [this.texVelTmp, this.texVelCur];
  }
  
  step(): void {
    const gl = this.gl; 
    
    // 1. Velocity Update
    bindQuad(gl, this.progVelUpdate, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texVelCur);
    gl.uniform1i(gl.getUniformLocation(this.progVelUpdate, "u_vel"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progVelUpdate, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progVelUpdate, "u_damp"), this.viscosity);
    drawTo(gl, this.fbo, this.texVelTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texVelCur, this.texVelTmp] = [this.texVelTmp, this.texVelCur];
    
    // 2. Color Update
    bindQuad(gl, this.progColorUpdate, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texColorCur);
    gl.uniform1i(gl.getUniformLocation(this.progColorUpdate, "u_color"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texVelCur);
    gl.uniform1i(gl.getUniformLocation(this.progColorUpdate, "u_vel"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progColorUpdate, "u_bg"), 2);
    gl.uniform1f(gl.getUniformLocation(this.progColorUpdate, "u_persistence"), this.persistence);
    drawTo(gl, this.fbo, this.texColorTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texColorCur, this.texColorTmp] = [this.texColorTmp, this.texColorCur];
  }
  
  renderToTexture(): WebGLTexture {
    const gl = this.gl; drawTo(gl, this.fbo, this.sceneTex, this.w, this.h); bindQuad(gl, this.progRender, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texColorCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_color"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texVelCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_vel"), 1);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_emboss"), this.emboss);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.sceneTex;
  }
}
