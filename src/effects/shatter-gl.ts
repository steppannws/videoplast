// src/effects/shatter-gl.ts
// Shatter-glass effect: touch deposits sharp impacts into a single-channel field
// that decays over time; the render pass turns a procedural voronoi cell pattern
// into glass shards whose cracks/refraction are gated by the local impact, so the
// surface only looks shattered where it was touched and heals as impacts fade.
import { program, bindQuad, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

// Additive sharp radial impact splat at a point (single-channel R field).
const DROP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad, u_amp; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  float add=u_amp*pow(max(0., 1.-d/u_rad), 3.0);
  gl_FragColor=vec4(texture2D(u_cur,v_uv).r+add,0.,0.,1.);
}`;

// Decay pass: retain a fraction of the impact each frame and lightly blur so
// cracks soften and fade out instead of vanishing abruptly.
const STEP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_texel; uniform float u_decay;
void main(){
  float c=texture2D(u_cur,v_uv).r;
  float l=texture2D(u_cur,v_uv-vec2(u_texel.x,0.)).r;
  float r=texture2D(u_cur,v_uv+vec2(u_texel.x,0.)).r;
  float t=texture2D(u_cur,v_uv-vec2(0.,u_texel.y)).r;
  float b=texture2D(u_cur,v_uv+vec2(0.,u_texel.y)).r;
  float blur=mix(c, (l+r+t+b)*0.25, 0.15);
  gl_FragColor=vec4(blur*u_decay,0.,0.,1.);
}`;

// Render: procedural voronoi shards refract the background, gated by impact.
const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_impact, u_bg; uniform float u_density, u_refract;

vec2 hash2(vec2 p){
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p)*43758.5453);
}

// Returns F1, F2 (nearest two feature distances) plus the gradient toward the
// nearest cell centre, packed as (F1, F2, gradX, gradY).
vec4 voronoi(vec2 uv){
  vec2 g=floor(uv); vec2 f=fract(uv);
  float f1=8.0, f2=8.0; vec2 near=vec2(0.0);
  for(int j=-1;j<=1;j++){
    for(int i=-1;i<=1;i++){
      vec2 o=vec2(float(i),float(j));
      vec2 c=o+hash2(g+o);
      vec2 d=c-f;
      float dist=dot(d,d);
      if(dist<f1){ f2=f1; f1=dist; near=d; }
      else if(dist<f2){ f2=dist; }
    }
  }
  return vec4(sqrt(f1), sqrt(f2), near);
}

void main(){
  float impact=clamp(texture2D(u_impact,v_uv).r, 0.0, 1.0);
  vec4 vor=voronoi(v_uv*u_density);
  float f1=vor.x, f2=vor.y;
  // Gradient toward nearest cell centre (cellGradient) drives refraction.
  vec2 cellGradient=normalize(vor.zw + 1e-5);
  // Cell edges: where (F2 - F1) is small -> thin bright crack line.
  float edge=1.0 - smoothstep(0.0, 0.06, f2 - f1);

  // Gate refraction + crack brightness by local impact: untouched bg stays clean.
  float gate=clamp(impact, 0.0, 1.0);
  vec2 offset=cellGradient * u_refract * gate;
  vec3 col=texture2D(u_bg, v_uv + offset).rgb;

  // Dark crack seams + specular-ish white highlights along edges, gated by impact.
  float crack=edge*gate;
  col=mix(col, col*0.25, crack);
  float spec=pow(edge, 8.0)*gate;
  col += spec*0.9;
  // Faint shard facet shading so touched glass reads as broken planes.
  col += (f1-0.4)*0.12*gate;

  gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
}`;

export const SHATTER_PARAMS: readonly EffectParam[] = [
  { key: "density", label: "DENSITY", min: 3, max: 40, step: 1, default: 12 },
  { key: "refract", label: "REFRACT", min: 0, max: 0.1, step: 0.001, default: 0.03 },
  { key: "decay", label: "DECAY", min: 0.9, max: 0.999, step: 0.001, default: 0.97 },
];

export class ShatterGL extends BaseEffect {
  density = 12;
  refract = 0.03;
  decay = 0.97;
  readonly params = SHATTER_PARAMS;
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
    if (key === "density") this.density = value;
    else if (key === "refract") this.refract = value;
    else if (key === "decay") this.decay = value;
  }
  addTouch(ev: TouchEv): void {
    if (ev.state !== "up") this.addImpact(ev.x, ev.y, ev.strength);
  }
  addImpact(x: number, y: number, strength: number): void {
    const gl = this.gl; bindQuad(gl, this.progDrop, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progDrop, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_pt"), x, 1.0 - y);
    // Influence scales with density (more shards -> tighter splat) and strength.
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_rad"), 0.6 / this.density);
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_amp"), 0.9 * strength);
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_aspect"), 1.0, this.h / this.w);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  step(): void {
    const gl = this.gl; bindQuad(gl, this.progStep, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progStep, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progStep, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progStep, "u_decay"), this.decay);
    drawTo(gl, this.fbo, this.texTmp, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  renderToTexture(): WebGLTexture {
    const gl = this.gl; drawTo(gl, this.fbo, this.sceneTex, this.w, this.h); bindQuad(gl, this.progRender, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_impact"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 1);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_density"), this.density);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_refract"), this.refract);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.sceneTex;
  }
}
