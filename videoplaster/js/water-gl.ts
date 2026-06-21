// videoplaster/js/water-gl.ts
const QUAD_VS = `attribute vec2 a_pos; varying vec2 v_uv;
void main(){ v_uv=(a_pos+1.0)*0.5; gl_Position=vec4(a_pos,0.0,1.0); }`;

// Wave equation: next = (sum of 4 neighbours)/2 - prev, damped.
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

// Additive splat at a point.
const DROP_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_cur; uniform vec2 u_pt; uniform float u_rad, u_amp; uniform vec2 u_aspect;
void main(){
  float d=length((v_uv-u_pt)*u_aspect);
  float add=u_amp*max(0., 1.-d/u_rad);
  gl_FragColor=vec4(texture2D(u_cur,v_uv).r+add,0.,0.,1.);
}`;

// Render: gradient of height distorts the background media; brightness from |height|.
const RENDER_FS = `precision highp float; varying vec2 v_uv;
uniform sampler2D u_height, u_bg; uniform vec2 u_texel; uniform float u_intensity;
void main(){
  float hl=texture2D(u_height,v_uv-vec2(u_texel.x,0.)).r;
  float hr=texture2D(u_height,v_uv+vec2(u_texel.x,0.)).r;
  float ht=texture2D(u_height,v_uv-vec2(0.,u_texel.y)).r;
  float hb=texture2D(u_height,v_uv+vec2(0.,u_texel.y)).r;
  vec2 grad=vec2(hr-hl, hb-ht)*u_intensity;
  vec3 col=texture2D(u_bg, v_uv+grad).rgb;
  col += clamp(abs(texture2D(u_height,v_uv).r)*0.4, 0.0, 0.25);
  gl_FragColor=vec4(col,1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("water: createShader failed");
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  return s;
}
function program(gl: WebGLRenderingContext, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("water: createProgram failed");
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, QUAD_VS)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program link failed");
  return p;
}

export class WaterGL {
  gl: WebGLRenderingContext;
  w: number;
  h: number;
  damp: number;
  intensity: number;
  radius: number;
  type: number;
  _floatLinear: boolean;
  progUpdate: WebGLProgram;
  progDrop: WebGLProgram;
  progRender: WebGLProgram;
  quad: WebGLBuffer;
  texPrev: WebGLTexture;
  texCur: WebGLTexture;
  texTmp: WebGLTexture;
  fbo: WebGLFramebuffer | null;
  bgTex: WebGLTexture;
  sceneTex: WebGLTexture;
  constructor(gl: WebGLRenderingContext, simW = 512, simH = 320) {
    this.gl = gl; this.w = simW; this.h = simH; this.damp = 0.985; this.intensity = 0.5; this.radius = 0.03;
    const extFloat = gl.getExtension("OES_texture_float");
    const extLinear = extFloat && gl.getExtension("OES_texture_float_linear");
    const extColorBuf = extFloat && (gl.getExtension("WEBGL_color_buffer_float") || gl.getExtension("EXT_color_buffer_float"));
    this.type = (extFloat && extColorBuf) ? gl.FLOAT : gl.UNSIGNED_BYTE;
    this._floatLinear = !!extLinear;
    if (extFloat && !extColorBuf) console.warn("WEBGL_color_buffer_float missing — water uses 8-bit fallback");
    if (this.type === gl.FLOAT && !extLinear) console.warn("OES_texture_float_linear missing — float textures use NEAREST");
    this.progUpdate = program(gl, UPDATE_FS); this.progDrop = program(gl, DROP_FS); this.progRender = program(gl, RENDER_FS);
    const quad = gl.createBuffer();
    if (!quad) throw new Error("water: createBuffer failed");
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    this.texPrev = this._tex(); this.texCur = this._tex(); this.texTmp = this._tex();
    this.fbo = gl.createFramebuffer();
    this.bgTex = this._tex(gl.RGBA, gl.UNSIGNED_BYTE);
    this.sceneTex = this._tex(gl.RGBA, gl.UNSIGNED_BYTE);
  }
  _tex(fmt?: number, type?: number): WebGLTexture {
    const gl = this.gl, t = gl.createTexture();
    if (!t) throw new Error("water: createTexture failed");
    gl.bindTexture(gl.TEXTURE_2D, t);
    const effType = type || this.type;
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt || gl.RGBA, this.w, this.h, 0, fmt || gl.RGBA, effType, null);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
    const filter = (effType === gl.FLOAT && !this._floatLinear) ? gl.NEAREST : gl.LINEAR;
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, filter));
    return t;
  }
  _drawTo(target: WebGLTexture): void {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, this.w, this.h);
  }
  _bindQuad(prog: WebGLProgram): void {
    const gl = this.gl; gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(prog, "a_pos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
  addDrop(x: number, y: number, strength: number): void {
    const gl = this.gl; this._bindQuad(this.progDrop);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progDrop, "u_cur"), 0);
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_pt"), x, 1.0 - y);
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_rad"), this.radius);
    gl.uniform1f(gl.getUniformLocation(this.progDrop, "u_amp"), 0.6 * strength);
    gl.uniform2f(gl.getUniformLocation(this.progDrop, "u_aspect"), 1.0, this.h / this.w);
    this._drawTo(this.texTmp); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texCur, this.texTmp] = [this.texTmp, this.texCur];
  }
  step(): void {
    const gl = this.gl; this._bindQuad(this.progUpdate);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texPrev);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate, "u_prev"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progUpdate, "u_cur"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progUpdate, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progUpdate, "u_damp"), this.damp);
    this._drawTo(this.texTmp); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    [this.texPrev, this.texCur, this.texTmp] = [this.texCur, this.texTmp, this.texPrev];
  }
  setBackground(source: TexImageSource): void {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  // Renders the watered scene into the currently-bound framebuffer/viewport.
  renderToScreen(viewW: number, viewH: number): void {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewW, viewH); this._bindQuad(this.progRender);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_height"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_intensity"), this.intensity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  renderToTexture(): WebGLTexture {
    const gl = this.gl; this._drawTo(this.sceneTex); this._bindQuad(this.progRender);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texCur);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_height"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(gl.getUniformLocation(this.progRender, "u_bg"), 1);
    gl.uniform2f(gl.getUniformLocation(this.progRender, "u_texel"), 1 / this.w, 1 / this.h);
    gl.uniform1f(gl.getUniformLocation(this.progRender, "u_intensity"), this.intensity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.sceneTex;
  }
}
