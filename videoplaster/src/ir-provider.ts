// Frame-provider facade: anything that can yield grayscale IR frames to the pipeline.

export interface IrFrameProvider {
  start(): void;
  stop(): void;
  restart(): void;
  onFrame(cb: (w: number, h: number, gray: Uint8Array) => void): void;
  onStatus(cb: (state: string) => void): void;
}

// Pure: parse the packed WS frame (u32 w LE, u32 h LE, then w*h gray bytes).
export function parseIrFrame(buf: ArrayBuffer): { w: number; h: number; gray: Uint8Array } {
  const dv = new DataView(buf);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
  return { w, h, gray: new Uint8Array(buf, 8, w * h) };
}

// Pure: BT.601 luma from RGBA into a preallocated gray buffer (out.length == pixel count).
export function rgbaToLuma(rgba: Uint8Array | Uint8ClampedArray, out: Uint8Array): void {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
  }
}
