// Shared base for the GL effects. Owns the boilerplate every effect repeated
// verbatim: the fullscreen quad, the render FBO, the background + scene textures,
// the negotiated float-texture caps, and the (byte-identical) setBackground upload.
// Subclasses add their own programs + simulation textures and implement the
// touch/step/render/param hooks.
import { quadBuffer, makeTex, negotiateFloat, simFilter } from "./gl-util.ts";
import type { Effect, EffectParam, TouchEv } from "../types/index.ts";

export abstract class BaseEffect implements Effect {
  readonly gl: WebGLRenderingContext;
  w: number;
  h: number;
  protected readonly quad: WebGLBuffer;
  protected readonly fbo: WebGLFramebuffer | null;
  protected readonly bgTex: WebGLTexture;
  protected readonly sceneTex: WebGLTexture;
  // Texture type + filter for simulation-state textures (float when supported).
  protected readonly simType: number;
  protected readonly simFilterMode: number;

  abstract readonly params: readonly EffectParam[];

  constructor(gl: WebGLRenderingContext, simW: number, simH: number) {
    this.gl = gl;
    this.w = simW;
    this.h = simH;
    const caps = negotiateFloat(gl);
    this.simType = caps.type;
    this.simFilterMode = simFilter(gl, caps);
    this.quad = quadBuffer(gl);
    this.fbo = gl.createFramebuffer();
    this.bgTex = makeTex(gl, simW, simH);
    this.sceneTex = makeTex(gl, simW, simH);
  }

  // Allocate a w×h simulation-state texture using the negotiated type/filter.
  protected simTex(): WebGLTexture {
    return makeTex(this.gl, this.w, this.h, { type: this.simType, filter: this.simFilterMode });
  }

  setBackground(source: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  abstract addTouch(ev: TouchEv): void;
  abstract step(): void;
  abstract renderToTexture(): WebGLTexture;
  abstract setParam(key: string, value: number): void;
}
