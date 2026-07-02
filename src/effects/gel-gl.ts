// src/effects/gel-gl.ts
// Liquid Gel effect: A highly viscous height field (diffusion equation) combined with 
// normal mapping to create refraction and specular highlights (like thick glass or slime).
import { program, bindQuad, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

// Droplets add mass/height to the field.
const DROP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad, u_amp; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  // Smooth bell curve for a blobby gel look
  float add = u_amp * smoothstep(1.0, 0.0, d/u_rad);
  gl_FragColor=vec4(texture2D(u_cur,v_uv).r+add,0.,0.,1.);
}`;

// Update step: Viscous diffusion (blur) and slow decay. No bouncy wave physics.
const UPDATE_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_texel; uniform float u_damp;
void main(){
  float l=texture2D(u_cur,v_uv-vec2(u_texel.x,0.)).r;
  float r=texture2D(u_cur,v_uv+vec2(u_texel.x,0.)).r;
  float t=texture2D(u_cur,v_uv-vec2(0.,u_texel.y)).r;
  float b=texture2D(u_cur,v_uv+vec2(0.,u_texel.y)).r;
  float c=texture2D(u_cur,v_uv).r;
  // Box blur + center weight
  float blurred = (l + r + t + b + c * 4.0) * 0.125;
  gl_FragColor=vec4(blurred * u_damp, 0.,0.,1.);
}`;

// Render: Normal mapping, refraction, and specular lighting.
const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_height, u_bg; 
uniform vec2 u_texel; 
uniform float u_refraction;
uniform float u_shine;
void main(){
  float hl=texture2D(u_height,v_uv-vec2(u_texel.x,0.)).r;
  float hr=texture2D(u_height,v_uv+vec2(u_texel.x,0.)).r;
  float ht=texture2D(u_height,v_uv-vec2(0.,u_texel.y)).r;
  float hb=texture2D(u_height,v_uv+vec2(0.,u_texel.y)).r;
  
  // Fake 3D normal from the height gradient
  vec3 n = normalize(vec3(hl-hr, ht-hb, 0.04));
  
  // Refraction: offset the background sample
  vec2 offset = n.xy * u_refraction;
  vec3 bg = texture2D(u_bg, clamp(v_uv + offset, 0.0, 1.0)).rgb;
  
  // Lighting setup
  vec3 V = vec3(0.0, 0.0, 1.0); // Viewer
  vec3 L = normalize(vec3(-0.5, 0.6, 0.8)); // Key light
  
  // Specular highlight
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 64.0);
  
  // Fresnel rim lighting
  float fres = pow(1.0 - max(n.z, 0.0), 3.0);
  
  vec3 color = bg + spec * u_shine + fres * (u_shine * 0.3);
  
  gl_FragColor = vec4(color, 1.0);
}`;

export const GEL_PARAMS: readonly EffectParam[] = [
  { key: "radius", label: "THICKNESS", min: 0.01, max: 0.2, step: 0.01, default: 0.08 },
  { key: "viscosity", label: "VISCOSITY", min: 0.9, max: 0.999, step: 0.001, default: 0.985 },
  { key: "refraction", label: "REFRACTION", min: 0.0, max: 2.0, step: 0.05, default: 0.5 },
  { key: "shine", label: "SHINE", min: 0.0, max: 2.0, step: 0.05, default: 1.2 },
];

export class GelGL extends BaseEffect {
  radius = 0.08;
  damp = 0.985;
  refraction = 0.5;
  shine = 1.2;
  
  readonly params = GEL_PARAMS;
  progUpdate: WebGLProgram;
  progDrop: WebGLProgram;
  progRender: WebGLProgram;
  texCur: WebGLTexture;
  texTmp: WebGLTexture;
  
  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    super(gl, simW, simH);
    this.progUpdate = program(gl, UPDATE_FS); 
    this.progDrop = program(gl, DROP_FS); 
    this.progRender = program(gl, RENDER_FS);
    // Gel doesn't need previous-frame wave physics, just cur and tmp for diffusion ping-pong
    this.texCur = this.simTex(); 
    this.texTmp = this.simTex();
  }
  
  setParam(key: string, value: number): void {
    if (key === "radius") this.radius = value;
    else if (key === "viscosity") this.damp = value;
    else if (key === "refraction") this.refraction = value;
    else if (key === "shine") this.shine = value;
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
    // Add height proportional to pressure/strength
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_amp"), 0.4 * (0.5 + 0.5 * strength));
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_aspect"), 1.0, this.h / this.w);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  
  step(): void {
    const gl = this.gl; bindQuad(gl, this.progUpdate, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progUpdate, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate, "u_damp"), this.damp);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  
  renderToTexture(): WebGLTexture {
    const gl = this.gl; drawTo(gl, this.fbo, this.sceneTex, this.w, this.h); bindQuad(gl, this.progRender, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_height"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_refraction"), this.refraction);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_shine"), this.shine);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.sceneTex;
  }
}
