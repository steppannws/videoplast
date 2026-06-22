// videoplaster/src/ink-gl.ts
// Ink bloom effect: a Navier-Stokes-lite fluid (semi-Lagrangian advection +
// dissipation, no pressure solve). Touches inject finger-momentum velocity and
// luminous dye that swirls and flows over the background media. Mirrors WaterGL.
import { program, quadBuffer, bindQuad, negotiateFloat, makeTex, drawTo, simFilter } from "./gl-util.ts";
import type { Effect, EffectParam, TouchEv } from "./types.ts";

// Additive radial splat into the velocity field (RG = vx,vy).
const SPLAT_VEL_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad; uniform vec2 u_vel; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  float fall=exp(-(d*d)/(u_rad*u_rad));
  vec2 v=texture2D(u_cur,v_uv).rg + u_vel*fall;
  gl_FragColor=vec4(v,0.,1.);
}`;

// Additive radial splat into the dye field (RGB color).
const SPLAT_DYE_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad; uniform vec3 u_col; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  float fall=exp(-(d*d)/(u_rad*u_rad));
  vec3 c=texture2D(u_cur,v_uv).rgb + u_col*fall;
  gl_FragColor=vec4(c,1.);
}`;

// Advect velocity: semi-Lagrangian backtrace, then dissipate (swirl persistence).
const ADV_VEL_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_vel; uniform vec2 u_texel; uniform float u_dt; uniform float u_diss;
void main(){
  vec2 vel=texture2D(u_vel,v_uv).rg;
  vec2 src=v_uv - u_dt*vel*u_texel;
  vec2 v=texture2D(u_vel,src).rg * u_diss;
  gl_FragColor=vec4(v,0.,1.);
}`;

// Advect dye along the velocity field, then fade.
const ADV_DYE_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_dye, u_vel; uniform vec2 u_texel; uniform float u_dt; uniform float u_fade;
void main(){
  vec2 vel=texture2D(u_vel,v_uv).rg;
  vec2 src=v_uv - u_dt*vel*u_texel;
  vec3 c=texture2D(u_dye,src).rgb * u_fade;
  gl_FragColor=vec4(c,1.);
}`;

// Render: refract the bg through the velocity field, add luminous dye on top.
const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_dye, u_vel, u_bg; uniform float u_dyeAmt; uniform float u_refract;
void main(){
  vec2 vel=texture2D(u_vel,v_uv).rg;
  vec3 dye=texture2D(u_dye,v_uv).rgb;
  vec3 bg=texture2D(u_bg, v_uv + vel*u_refract).rgb;
  vec3 ink=dye*u_dyeAmt;
  // screen blend the luminous ink over the (refracted) media.
  vec3 col=1.0 - (1.0-bg)*(1.0-clamp(ink,0.0,1.0));
  col += ink*0.25; // extra glow
  gl_FragColor=vec4(col,1.0);
}`;

export const INK_PARAMS: readonly EffectParam[] = [
  { key: "dye", label: "DYE", min: 0, max: 3, step: 0.01, default: 1.5 },
  { key: "swirl", label: "SWIRL", min: 0, max: 2, step: 0.01, default: 1.0 },
  { key: "fade", label: "FADE", min: 0.9, max: 0.999, step: 0.001, default: 0.98 },
];

// HSV->RGB for cycling injected dye hue.
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

export class InkGL implements Effect {
  gl: WebGLRenderingContext;
  w: number;
  h: number;
  dyeAmt = 1.5;
  swirl = 1.0;
  fade = 0.98;
  readonly params = INK_PARAMS;
  progSplatVel: WebGLProgram;
  progSplatDye: WebGLProgram;
  progAdvVel: WebGLProgram;
  progAdvDye: WebGLProgram;
  progRender: WebGLProgram;
  quad: WebGLBuffer;
  velA: WebGLTexture;
  velB: WebGLTexture;
  dyeA: WebGLTexture;
  dyeB: WebGLTexture;
  fbo: WebGLFramebuffer | null;
  bgTex: WebGLTexture;
  sceneTex: WebGLTexture;
  // last point per touch id, for finger-momentum velocity injection.
  last = new Map<number, { x: number; y: number }>();
  hue = 0; // cycles per injection so repeated touches paint new colors.
  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    this.gl = gl; this.w = simW; this.h = simH;
    const caps = negotiateFloat(gl);
    const filter = simFilter(gl, caps);
    this.progSplatVel = program(gl, SPLAT_VEL_FS);
    this.progSplatDye = program(gl, SPLAT_DYE_FS);
    this.progAdvVel = program(gl, ADV_VEL_FS);
    this.progAdvDye = program(gl, ADV_DYE_FS);
    this.progRender = program(gl, RENDER_FS);
    this.quad = quadBuffer(gl);
    const st = () => makeTex(gl, simW, simH, { type: caps.type, filter });
    this.velA = st(); this.velB = st();
    this.dyeA = st(); this.dyeB = st();
    this.fbo = gl.createFramebuffer();
    this.bgTex = makeTex(gl, simW, simH);
    this.sceneTex = makeTex(gl, simW, simH);
  }
  setParam(key: string, value: number): void {
    if (key === "dye") this.dyeAmt = value;
    else if (key === "swirl") this.swirl = value;
    else if (key === "fade") this.fade = value;
  }
  addTouch(ev: TouchEv): void {
    if (ev.state === "up") { this.last.delete(ev.id); return; }
    // sim space: bottom-left origin (same mapping as WaterGL's u_pt).
    const px = ev.x, py = 1.0 - ev.y;
    const prev = this.last.get(ev.id);
    // finger momentum: velocity = delta since last sample, scaled by swirl.
    let vx = 0, vy = 0;
    if (prev) { vx = px - prev.x; vy = py - prev.y; }
    this.last.set(ev.id, { x: px, y: py });
    // velocity magnitude in texel/step terms; swirl scales injection + persistence.
    const velScale = 600.0 * this.swirl * ev.strength;
    this.injectVel(px, py, vx * velScale, vy * velScale);
    // cycle hue per injection; dye color scaled by strength.
    this.hue = (this.hue + 0.07) % 1.0;
    const [r, g, b] = hsv2rgb(this.hue, 0.85, 1.0);
    const amt = 0.9 * ev.strength;
    this.injectDye(px, py, r * amt, g * amt, b * amt);
  }
  injectVel(x: number, y: number, vx: number, vy: number): void {
    const gl = this.gl; bindQuad(gl, this.progSplatVel, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velA);
    gl.uniform1i(gl.getUniformLocation(this.progSplatVel, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progSplatVel, "u_pt"), x, y);
    gl.uniform1f(gl.getUniformLocation(this.progSplatVel, "u_rad"), 0.05);
    gl.uniform2f(gl.getUniformLocation(this.progSplatVel, "u_vel"), vx, vy);
    gl.uniform2f(gl.getUniformLocation(this.progSplatVel, "u_aspect"), 1.0, this.h / this.w);
    drawTo(gl, this.fbo, this.velB, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.velA, this.velB] = [this.velB, this.velA];
  }
  injectDye(x: number, y: number, r: number, g: number, b: number): void {
    const gl = this.gl; bindQuad(gl, this.progSplatDye, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.dyeA);
    gl.uniform1i(gl.getUniformLocation(this.progSplatDye, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progSplatDye, "u_pt"), x, y);
    gl.uniform1f(gl.getUniformLocation(this.progSplatDye, "u_rad"), 0.04);
    gl.uniform3f(gl.getUniformLocation(this.progSplatDye, "u_col"), r, g, b);
    gl.uniform2f(gl.getUniformLocation(this.progSplatDye, "u_aspect"), 1.0, this.h / this.w);
    drawTo(gl, this.fbo, this.dyeB, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.dyeA, this.dyeB] = [this.dyeB, this.dyeA];
  }
  step(): void {
    const gl = this.gl;
    const dt = 1.0;
    // dissipation < 1, driven by swirl (more swirl -> longer-lived flow).
    const diss = 0.985 + 0.012 * Math.min(this.swirl, 1.0);
    // (1) advect velocity.
    bindQuad(gl, this.progAdvVel, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.velA);
    gl.uniform1i(gl.getUniformLocation(this.progAdvVel, "u_vel"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progAdvVel, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progAdvVel, "u_dt"), dt);
    gl.uniform1f(gl.getUniformLocation(this.progAdvVel, "u_diss"), diss);
    drawTo(gl, this.fbo, this.velB, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.velA, this.velB] = [this.velB, this.velA];
    // (2) advect dye along the (now-current) velocity field.
    bindQuad(gl, this.progAdvDye, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.dyeA);
    gl.uniform1i(gl.getUniformLocation(this.progAdvDye, "u_dye"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.velA);
    gl.uniform1i(gl.getUniformLocation(this.progAdvDye, "u_vel"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progAdvDye, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progAdvDye, "u_dt"), dt);
    gl.uniform1f(gl.getUniformLocation(this.progAdvDye, "u_fade"), this.fade);
    drawTo(gl, this.fbo, this.dyeB, this.w, this.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.dyeA, this.dyeB] = [this.dyeB, this.dyeA];
  }
  setBackground(source: TexImageSource): void {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  renderToTexture(): WebGLTexture {
    const gl = this.gl; drawTo(gl, this.fbo, this.sceneTex, this.w, this.h);
    bindQuad(gl, this.progRender, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.dyeA);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_dye"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.velA);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_vel"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 2);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_dyeAmt"), this.dyeAmt);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_refract"), 0.15);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.sceneTex;
  }
}
