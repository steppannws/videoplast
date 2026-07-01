// videoplaster/src/particles-gl.ts
// Particle chaos: thousands of GPU particles whose state (position + velocity)
// lives in a P×P float texture, ping-ponged each frame. A curl-noise field
// swirls them ("chaos") and touch points push them ("force"); they render as
// additive, hue-shifting points over the background media.
import { program, bindQuad, makeTex, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

// Particle texture side; P*P ≈ 40000 max particles.
const P = 200;
const MAX_TOUCH = 8;

// UPDATE pass: read pos (RG) + vel (BA) from the current state texture, apply
// curl-noise + touch forces, integrate, wrap toroidally, write new state.
const UPDATE_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_state;
uniform float u_time, u_chaos, u_force, u_fade, u_dt;
uniform int u_nTouch;
uniform vec3 u_touch[${MAX_TOUCH}]; // xy = pos (v_uv space), z = strength

// 2D value-noise + curl, divergence-free swirling field.
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Scalar potential -> curl gives a divergence-free 2D field.
float potential(vec2 p){ return noise(p) + 0.5 * noise(p * 2.0 + 17.3); }
vec2 curl(vec2 p){
  float e = 0.01;
  float n1 = potential(p + vec2(0.0, e));
  float n2 = potential(p - vec2(0.0, e));
  float n3 = potential(p + vec2(e, 0.0));
  float n4 = potential(p - vec2(e, 0.0));
  // perpendicular to gradient
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}

void main(){
  vec4 st = texture2D(u_state, v_uv);
  vec2 pos = st.xy;
  vec2 vel = st.zw;

  // curl-noise force; sample drifts over time -> shifting directions / chaos.
  vec2 cf = curl(pos * 3.0 + vec2(u_time * 0.15, u_time * 0.1)) * u_chaos;

  // touch forces: repel away from each active point, falls off with distance.
  vec2 tf = vec2(0.0);
  for (int i = 0; i < ${MAX_TOUCH}; i++){
    if (i >= u_nTouch) break;
    vec3 tp = u_touch[i];
    vec2 d = pos - tp.xy;
    float dist = length(d) + 1e-4;
    float fall = exp(-dist * 14.0);
    tf += normalize(d) * fall * tp.z;
  }
  tf *= u_force * 4.0;

  vel = vel * u_fade + (cf + tf) * u_dt;
  pos += vel * u_dt;
  pos = fract(pos); // toroidal wrap -> particles never disappear

  gl_FragColor = vec4(pos, vel);
}`;

// COPY pass: blit the background into the scene texture so particles draw over media.
const COPY_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_bg;
void main(){ gl_FragColor = vec4(texture2D(u_bg, v_uv).rgb, 1.0); }`;

// POINT vertex shader: vertex texture fetch of each particle's position.
const POINT_VS = `precision highp float;
attribute float a_index;
uniform sampler2D u_state;
uniform float u_p, u_time, u_size;
varying vec3 v_col;

vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main(){
  float i = a_index;
  vec2 uv = vec2(mod(i, u_p) + 0.5, floor(i / u_p) + 0.5) / u_p;
  vec2 pos = texture2D(u_state, uv).xy;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = u_size;
  // hue shifts per-particle and over time -> shifting colors.
  float hue = fract(i / (u_p * u_p) + u_time * 0.07);
  v_col = hsv2rgb(vec3(hue, 0.85, 1.0));
}`;

// POINT fragment shader: soft round additive point.
const POINT_FS = `precision highp float;
varying vec3 v_col;
void main(){
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(v_col * a, 1.0);
}`;

export const PARTICLES_PARAMS: readonly EffectParam[] = [
  { key: "count", label: "COUNT", min: 256, max: 40000, step: 256, default: 8000 },
  { key: "chaos", label: "CHAOS", min: 0, max: 2, step: 0.01, default: 1.0 },
  { key: "force", label: "FORCE", min: 0, max: 2, step: 0.01, default: 1.0 },
  { key: "fade", label: "FADE", min: 0.8, max: 0.999, step: 0.001, default: 0.96 },
];

export class ParticlesGL extends BaseEffect {
  readonly params = PARTICLES_PARAMS;
  chaos = 1.0;
  force = 1.0;
  fade = 0.96;
  drawCount = 8000;
  t = 0;
  progUpdate: WebGLProgram;
  progCopy: WebGLProgram;
  progPoints: WebGLProgram;
  indexBuf: WebGLBuffer;
  stateA: WebGLTexture;
  stateB: WebGLTexture;
  touches = new Map<number, { x: number; y: number; strength: number }>();

  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    super(gl, simW, simH);
    this.progUpdate = program(gl, UPDATE_FS);
    this.progCopy = program(gl, COPY_FS);
    this.progPoints = program(gl, POINT_FS, POINT_VS);

    // Static a_index buffer: [0 .. P*P-1].
    const idx = new Float32Array(P * P);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    const ib = gl.createBuffer();
    if (!ib) throw new Error("gl: createBuffer (index) failed");
    this.indexBuf = ib;
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // Seed particle state: random positions across 0..1, small random velocities.
    const seed = new Float32Array(P * P * 4);
    for (let i = 0; i < P * P; i++) {
      const o = i * 4;
      seed[o] = Math.random();              // pos.x
      seed[o + 1] = Math.random();          // pos.y
      seed[o + 2] = (Math.random() - 0.5) * 0.02; // vel.x
      seed[o + 3] = (Math.random() - 0.5) * 0.02; // vel.y
    }
    // For 8-bit fallback the data array must be a Uint8Array; quantize.
    let data: ArrayBufferView;
    if (this.simType === gl.FLOAT) {
      data = seed;
    } else {
      const bytes = new Uint8Array(P * P * 4);
      for (let i = 0; i < bytes.length; i++) {
        // map vel from ~[-0.01,0.01]+0.5 region into 0..255; pos already 0..1.
        const v = i % 4 < 2 ? seed[i] : seed[i] * 0.5 + 0.5;
        bytes[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
      data = bytes;
    }
    const st = () => makeTex(gl, P, P, { type: this.simType, filter: gl.NEAREST, data });
    this.stateA = st();
    this.stateB = st();
  }

  setParam(key: string, value: number): void {
    if (key === "count") this.drawCount = Math.max(0, Math.min(P * P, Math.round(value)));
    else if (key === "chaos") this.chaos = value;
    else if (key === "force") this.force = value;
    else if (key === "fade") this.fade = value;
  }

  addTouch(ev: TouchEv): void {
    if (ev.state === "up") this.touches.delete(ev.id);
    else this.touches.set(ev.id, { x: ev.x, y: 1.0 - ev.y, strength: ev.strength });
  }

  step(): void {
    const gl = this.gl;
    const dt = 1.0;
    this.t += dt;

    // Gather active touches (cap MAX_TOUCH) into a flat vec3 array.
    const flat = new Float32Array(MAX_TOUCH * 3);
    let n = 0;
    for (const tp of this.touches.values()) {
      if (n >= MAX_TOUCH) break;
      flat[n * 3] = tp.x;
      flat[n * 3 + 1] = tp.y;
      flat[n * 3 + 2] = tp.strength;
      n++;
    }

    bindQuad(gl, this.progUpdate, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stateA);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate, "u_state"), 0);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate, "u_time"), this.t * 0.016);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate, "u_chaos"), this.chaos);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate, "u_force"), this.force);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate, "u_fade"), this.fade);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate, "u_dt"), dt * 0.016);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate, "u_nTouch"), n);
    gl.uniform3fv(gl.getUniformLocation(this.progUpdate, "u_touch"), flat);

    drawTo(gl, this.fbo, this.stateB, P, P);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.stateA, this.stateB] = [this.stateB, this.stateA];
  }

  renderToTexture(): WebGLTexture {
    const gl = this.gl;

    // 1) Blit background into the scene texture.
    drawTo(gl, this.fbo, this.sceneTex, this.w, this.h);
    bindQuad(gl, this.progCopy, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progCopy, "u_bg"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2) Draw particles as additive points over the background.
    gl.useProgram(this.progPoints);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuf);
    const locIdx = gl.getAttribLocation(this.progPoints, "a_index");
    gl.enableVertexAttribArray(locIdx);
    gl.vertexAttribPointer(locIdx, 1, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stateA);
    gl.uniform1i(gl.getUniformLocation(this.progPoints, "u_state"), 0);
    gl.uniform1f(gl.getUniformLocation(this.progPoints, "u_p"), P);
    gl.uniform1f(gl.getUniformLocation(this.progPoints, "u_time"), this.t * 0.016);
    gl.uniform1f(gl.getUniformLocation(this.progPoints, "u_size"), 3.0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, Math.min(this.drawCount, P * P));
    gl.disable(gl.BLEND);

    return this.sceneTex;
  }
}
