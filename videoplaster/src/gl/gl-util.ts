// videoplaster/src/gl-util.ts
// Shared WebGL boilerplate for the effect modules: shader/program compile, the
// fullscreen quad, float-texture capability negotiation, texture alloc, and FBO
// render-target binding. Extracted from the original water-gl so every effect
// builds on the same primitives.

// Fullscreen triangle-strip quad; v_uv is 0..1 across the screen.
export const QUAD_VS = `attribute vec2 a_pos; varying vec2 v_uv;
void main(){ v_uv=(a_pos+1.0)*0.5; gl_Position=vec4(a_pos,0.0,1.0); }`;

export function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("gl: createShader failed");
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  return s;
}

// Link a program from a fragment shader (and vertex shader, defaulting to the quad VS).
export function program(gl: WebGLRenderingContext, fs: string, vs: string = QUAD_VS): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("gl: createProgram failed");
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program link failed");
  return p;
}

export function quadBuffer(gl: WebGLRenderingContext): WebGLBuffer {
  const b = gl.createBuffer();
  if (!b) throw new Error("gl: createBuffer failed");
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return b;
}

// useProgram + bind the quad buffer to the program's a_pos attribute.
export function bindQuad(gl: WebGLRenderingContext, prog: WebGLProgram, buf: WebGLBuffer): void {
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

export interface FloatCaps {
  type: number;        // gl.FLOAT when renderable float textures are available, else gl.UNSIGNED_BYTE
  floatLinear: boolean; // whether float textures support LINEAR filtering
}

// Minimal shape of a GL context for capability negotiation (keeps this unit testable).
export interface GLCaps {
  FLOAT: number;
  UNSIGNED_BYTE: number;
  getExtension(name: string): unknown;
}

// Decide the texture type for simulation state. Float needs the float texture
// extension AND a renderable-float color buffer; otherwise fall back to 8-bit.
export function negotiateFloat(gl: GLCaps): FloatCaps {
  const extFloat = gl.getExtension("OES_texture_float");
  const extLinear = extFloat && gl.getExtension("OES_texture_float_linear");
  const extColorBuf = extFloat && (gl.getExtension("WEBGL_color_buffer_float") || gl.getExtension("EXT_color_buffer_float"));
  const type = (extFloat && extColorBuf) ? gl.FLOAT : gl.UNSIGNED_BYTE;
  if (extFloat && !extColorBuf) console.warn("WEBGL_color_buffer_float missing — effect uses 8-bit fallback");
  if (type === gl.FLOAT && !extLinear) console.warn("OES_texture_float_linear missing — float textures use NEAREST");
  return { type, floatLinear: !!extLinear };
}

export interface TexOpts {
  fmt?: number;          // default gl.RGBA
  type?: number;         // default gl.UNSIGNED_BYTE
  filter?: number;       // default gl.LINEAR
  data?: ArrayBufferView | null; // optional initial pixels
}

// Allocate a w×h texture, CLAMP_TO_EDGE, with the given format/type/filter.
export function makeTex(gl: WebGLRenderingContext, w: number, h: number, opts: TexOpts = {}): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error("gl: createTexture failed");
  const fmt = opts.fmt ?? gl.RGBA;
  const type = opts.type ?? gl.UNSIGNED_BYTE;
  const filter = opts.filter ?? gl.LINEAR;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt, type, opts.data ?? null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return t;
}

// Bind fbo, attach tex as COLOR_ATTACHMENT0, set the viewport to w×h.
export function drawTo(gl: WebGLRenderingContext, fbo: WebGLFramebuffer | null, tex: WebGLTexture, w: number, h: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
}

// Filter to use for a sim state texture given the negotiated caps: float without
// linear support must use NEAREST.
export function simFilter(gl: WebGLRenderingContext, caps: FloatCaps): number {
  return (caps.type === gl.FLOAT && !caps.floatLinear) ? gl.NEAREST : gl.LINEAR;
}
