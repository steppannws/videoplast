// src/effects/chrome-gl.ts
// Liquid Chrome Metaballs: touches spawn gooey metallic blobs that merge into a
// single organic surface (a classic metaball scalar field). The surface is shaded
// as iridescent liquid chrome — the background media is reflected off a fake 3D
// normal derived from the field gradient, with a fresnel oil-slick sheen and a
// crisp specular highlight. Released blobs linger, drift and shrink (FLOW), so a
// swipe leaves a trail of merging quicksilver drops over the media.
import { program, bindQuad, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

// Max simultaneous blobs (active touches + lingering released drops).
const MAX_BALLS = 16;

// Single fullscreen pass: evaluate the metaball field + its gradient analytically
// from the blob uniforms, then shade the iso-surface as reflective liquid chrome.
const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_bg;
uniform vec2 u_aspect;               // (1, h/w): keeps blobs round in uv space
uniform int u_n;
uniform vec3 u_ball[${MAX_BALLS}];   // xy = center (uv), z = radius
uniform float u_thresh, u_shine, u_time;

vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main(){
  vec2 uv = v_uv;
  vec3 bg = texture2D(u_bg, uv).rgb;

  // Metaball field f and its gradient, summed over all active blobs. f == 1 at a
  // lone blob's radius, so u_thresh ~ 1 places the surface near that radius.
  vec2 p = uv * u_aspect;
  float f = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < ${MAX_BALLS}; i++){
    if (i >= u_n) break;
    vec3 b = u_ball[i];
    vec2 d = p - b.xy * u_aspect;
    float d2 = dot(d, d) + 1e-4;
    float r2 = b.z * b.z;
    f += r2 / d2;
    grad += -2.0 * r2 * d / (d2 * d2);
  }

  // Fully outside the surface: show the plain media (cheap early-out).
  if (f < u_thresh * 0.45){ gl_FragColor = vec4(bg, 1.0); return; }

  // Fake 3D normal: tilts outward (−grad) at the rim, faces the viewer inside.
  float interior = smoothstep(u_thresh, u_thresh * 2.5, f);
  vec2 gdir = grad / (length(grad) + 1e-4);
  vec3 n = normalize(vec3(-gdir * (1.0 - interior), interior + 0.18));

  vec3 V = vec3(0.0, 0.0, 1.0);
  float fres = pow(1.0 - max(n.z, 0.0), 3.0);   // rim / grazing-angle boost

  // Chrome: reflect the media off the surface (offset the bg lookup by the
  // reflection vector), then tint with an iridescent oil-slick sheen.
  vec3 refl = reflect(-V, n);
  vec3 env = texture2D(u_bg, uv + refl.xy * 0.35).rgb;
  float hue = fract(n.z * 0.4 + dot(n.xy, vec2(0.5, 0.3)) + u_time * 0.05);
  vec3 irid = hsv2rgb(vec3(hue, 0.55, 1.0));

  vec3 chrome = mix(env, irid, clamp(u_shine, 0.0, 1.0) * (0.25 + 0.75 * fres));

  // Specular highlight from a fixed key light.
  vec3 L = normalize(vec3(-0.4, 0.6, 0.7));
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 48.0);
  chrome += spec * 1.2;
  chrome += fres * 0.35;                          // bright fresnel rim

  // Antialiased composite of the chrome surface over the media.
  float mask = smoothstep(u_thresh * 0.55, u_thresh * 0.95, f);
  gl_FragColor = vec4(mix(bg, chrome, mask), 1.0);
}`;

export const CHROME_PARAMS: readonly EffectParam[] = [
  { key: "size", label: "SIZE", min: 0.03, max: 0.3, step: 0.005, default: 0.11 },
  { key: "merge", label: "MERGE", min: 0.5, max: 3, step: 0.05, default: 1.0 },
  { key: "shine", label: "SHINE", min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: "flow", label: "FLOW", min: 0, max: 1, step: 0.01, default: 0.5 },
];

interface Ball { x: number; y: number; r: number; vx: number; vy: number; life: number; }

export class ChromeGL extends BaseEffect {
  readonly params = CHROME_PARAMS;
  size = 0.11;
  merge = 1.0;
  shine = 0.7;
  flow = 0.5;
  t = 0;
  progRender: WebGLProgram;
  // Active touch blobs (keyed by touch id) + lingering released drops.
  active = new Map<number, Ball>();
  released: Ball[] = [];

  constructor(gl: WebGLRenderingContext, simW = 1024, simH = 640) {
    super(gl, simW, simH);
    this.progRender = program(gl, RENDER_FS);
  }

  setParam(key: string, value: number): void {
    if (key === "size") this.size = value;
    else if (key === "merge") this.merge = value;
    else if (key === "shine") this.shine = value;
    else if (key === "flow") this.flow = value;
  }

  addTouch(ev: TouchEv): void {
    if (ev.state === "up") {
      const b = this.active.get(ev.id);
      if (b) { this.active.delete(ev.id); this.released.push(b); } // let it fling + fade
      return;
    }
    // uv space: bottom-left origin (matches the flipped bg upload).
    const x = ev.x, y = 1.0 - ev.y;
    const r = this.size * (0.6 + 0.8 * ev.strength);
    const prev = this.active.get(ev.id);
    if (prev) {
      prev.vx = prev.vx * 0.5 + (x - prev.x) * 0.5;
      prev.vy = prev.vy * 0.5 + (y - prev.y) * 0.5;
      prev.x = x; prev.y = y; prev.r = r; prev.life = 1;
    } else {
      this.active.set(ev.id, { x, y, r, vx: 0, vy: 0, life: 1 });
    }
  }

  step(): void {
    this.t += 1;
    // FLOW drives how long released drops persist: higher -> slower decay/shrink,
    // less velocity damping (more gliding), for a viscous-mercury feel.
    const decay = 0.02 + (1 - this.flow) * 0.06;
    const shrink = 0.97 + this.flow * 0.028;
    const damp = 0.9 + this.flow * 0.08;
    for (let i = this.released.length - 1; i >= 0; i--) {
      const b = this.released[i];
      b.x += b.vx; b.y += b.vy;
      b.vx *= damp; b.vy *= damp;
      b.r *= shrink; b.life -= decay;
      if (b.life <= 0 || b.r < 0.004) this.released.splice(i, 1);
    }
  }

  // Flatten active + released blobs into the vec3 uniform array (cap MAX_BALLS).
  private gather(): { flat: Float32Array; n: number } {
    const flat = new Float32Array(MAX_BALLS * 3);
    let n = 0;
    const push = (b: Ball): void => {
      if (n >= MAX_BALLS) return;
      flat[n * 3] = b.x; flat[n * 3 + 1] = b.y;
      flat[n * 3 + 2] = b.r * (b.life < 1 ? Math.max(b.life, 0) : 1);
      n++;
    };
    for (const b of this.active.values()) push(b);
    for (const b of this.released) push(b);
    return { flat, n };
  }

  renderToTexture(): WebGLTexture {
    const gl = this.gl;
    const { flat, n } = this.gather();
    drawTo(gl, this.fbo, this.sceneTex, this.w, this.h);
    bindQuad(gl, this.progRender, this.quad);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_aspect"), 1.0, this.h / this.w);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_n"), n);
    gl.uniform3fv(gl.getUniformLocation(this.progRender, "u_ball"), flat);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_thresh"), this.merge);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_shine"), this.shine);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_time"), this.t * 0.016);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.sceneTex;
  }
}
