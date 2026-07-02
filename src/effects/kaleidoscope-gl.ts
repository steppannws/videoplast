// src/effects/kaleidoscope-gl.ts
import { program, bindQuad, drawTo } from "../gl/gl-util.ts";
import { BaseEffect } from "../gl/base-effect.ts";
import type { EffectParam, TouchEv } from "../types/index.ts";

const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_bg;
uniform vec2 u_center;
uniform float u_segments;
uniform float u_zoom;
uniform float u_rotation;
uniform vec2 u_aspect;

const float PI = 3.14159265359;

void main(){
  // Adjust UVs based on center and aspect ratio
  vec2 uv = v_uv - u_center;
  uv *= u_aspect;

  // Convert to polar coordinates
  float radius = length(uv) * u_zoom;
  float angle = atan(uv.y, uv.x);

  // Kaleidoscope logic: fold angle
  float angleStep = PI * 2.0 / max(1.0, u_segments);
  angle = mod(angle, angleStep);
  angle = abs(angle - angleStep / 2.0);
  
  // Add rotation
  angle += u_rotation;

  // Convert back to cartesian
  vec2 kal_uv = vec2(cos(angle), sin(angle)) * radius;
  
  // Revert aspect ratio and center
  kal_uv /= u_aspect;
  kal_uv += u_center;
  
  // Sample background with clamping to avoid edge artifacts if zoom > 1
  if (kal_uv.x < 0.0 || kal_uv.x > 1.0 || kal_uv.y < 0.0 || kal_uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
      vec3 col = texture2D(u_bg, kal_uv).rgb;
      gl_FragColor = vec4(col, 1.0);
  }
}`;

export const KAL_PARAMS: readonly EffectParam[] = [
  { key: "segments", label: "SEGMENTS", min: 2, max: 24, step: 1, default: 6 },
  { key: "zoom", label: "ZOOM", min: 0.1, max: 3.0, step: 0.05, default: 1.0 },
  { key: "rotation", label: "ROTATION", min: 0, max: 6.28, step: 0.01, default: 0.0 },
];

export class KaleidoscopeGL extends BaseEffect {
  segments = 6;
  zoom = 1.0;
  rotation = 0.0;
  centerX = 0.5;
  centerY = 0.5;
  targetCenterX = 0.5;
  targetCenterY = 0.5;
  
  readonly params = KAL_PARAMS;
  progRender: WebGLProgram;

  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    super(gl, simW, simH);
    this.progRender = program(gl, RENDER_FS);
  }

  setParam(key: string, value: number): void {
    if (key === "segments") this.segments = value;
    else if (key === "zoom") this.zoom = value;
    else if (key === "rotation") this.rotation = value;
  }

  addTouch(ev: TouchEv): void {
    if (ev.state !== "up") {
      this.targetCenterX = ev.x;
      this.targetCenterY = 1.0 - ev.y;
    }
  }

  step(): void {
    // Smoothly interpolate center towards touch
    this.centerX = this.centerX + (this.targetCenterX - this.centerX) * 0.1;
    this.centerY = this.centerY + (this.targetCenterY - this.centerY) * 0.1;
    
    // Auto-rotate slowly
    this.rotation += 0.005;
    if (this.rotation > 6.28) this.rotation = 0;
  }

  renderToTexture(): WebGLTexture {
    const gl = this.gl; 
    drawTo(gl, this.fbo, this.sceneTex, this.w, this.h); 
    bindQuad(gl, this.progRender, this.quad);
    
    gl.activeTexture(gl.TEXTURE0); 
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 0);
    
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_center"), this.centerX, this.centerY);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_segments"), this.segments);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_zoom"), this.zoom);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_rotation"), this.rotation);
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_aspect"), 1.0, this.h / this.w);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); 
    return this.sceneTex;
  }
}
