// Device-agnostic IR touch pipeline: a grayscale frame in, tracked TouchEvs out.
// Extracted from the former LeapImageSource so any frame provider can feed it.
import { findBlobs } from "./blobs.ts";
import { BlobTracker } from "./tracking.ts";
import { subtractBackground } from "./preprocess.ts";
import { buildUndistMap, applyUndist } from "./undistort.ts";
import { DET_DEFAULTS, UNDIST_DEFAULTS, MIRROR_DEFAULTS } from "../config/defaults.ts";
import type { DetOpt, UndistOpt, Roi, MirrorOpt, DetBlob, TouchEv } from "../types/index.ts";

// Pure: blob center (image px) -> surface UV via an axis-aligned normalized rectangle.
export function roiMap(cx: number, cy: number, w: number, h: number, roi: Roi): { u: number; v: number } {
  const u = (cx / w - roi.x) / roi.w;
  const v = (cy / h - roi.y) / roi.h;
  return { u, v };
}

// Pure: RGBA copy mirrored horizontally (flipX) and/or vertically (flipY).
export function flipImage(rgba: Uint8ClampedArray, w: number, h: number, flipX: boolean, flipY: boolean): Uint8ClampedArray {
  if (!flipX && !flipY) return rgba;
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < h; y++) {
    const sy = flipY ? (h - 1 - y) : y;
    for (let x = 0; x < w; x++) {
      const sx = flipX ? (w - 1 - x) : x;
      const di = (y * w + x) * 4, si = (sy * w + sx) * 4;
      out[di] = rgba[si]; out[di+1] = rgba[si+1]; out[di+2] = rgba[si+2]; out[di+3] = rgba[si+3];
    }
  }
  return out;
}

export class IrTouchPipeline {
  w = 0;
  h = 0;
  frame: Uint8ClampedArray | null = null;
  bg: Uint8ClampedArray | null = null;
  opt: DetOpt = { ...DET_DEFAULTS };
  undist: UndistOpt = { ...UNDIST_DEFAULTS, map: null };
  roi: Roi = { x: 0, y: 0, w: 1, h: 1 };
  mirror: MirrorOpt = { ...MIRROR_DEFAULTS };
  tracker = new BlobTracker({ maxDist: 0.08 });
  previewCb: ((rgba: Uint8ClampedArray, bin: Uint8Array, w: number, h: number, blobs: DetBlob[]) => void) | null = null;
  onEvent: (ev: TouchEv) => void = () => {};
  captureBackground(): void { if (this.frame) this.bg = this.frame.slice(); }
  setRoi(roi: Roi): void { this.roi = roi; }
  // Gray frame -> RGBA -> mirror -> undistort -> bg-subtract -> blobs -> roi -> track -> emit.
  process(gray: Uint8Array, w: number, h: number): void {
    this.w = w; this.h = h;
    let rgba: Uint8ClampedArray = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=gray[i]; rgba[i*4+3]=255; }
    if (this.mirror.x || this.mirror.y) rgba = flipImage(rgba, w, h, this.mirror.x, this.mirror.y);
    if (this.undist.on) {
      if (!this.undist.map) this.undist.map = buildUndistMap(w, h, this.undist.k1, this.undist.k2);
      rgba = applyUndist(rgba, w, h, this.undist.map);
    }
    this.frame = rgba;
    if (this.bg && this.bg.length !== rgba.length) this.bg = null;
    const detIn = this.bg ? subtractBackground(rgba, this.bg, w * h) : rgba;
    const { blobs, bin } = findBlobs({ data: detIn, width: w, height: h }, this.opt);
    const mapped = blobs
      .map((b) => { const { u, v } = roiMap(b.cx, b.cy, w, h, this.roi); return { x: u, y: v, strength: Math.min(1, b.bright/255) }; })
      .filter((pt) => pt.x>=0 && pt.x<=1 && pt.y>=0 && pt.y<=1);
    for (const ev of this.tracker.update(mapped)) this.onEvent(ev);
    if (this.previewCb) this.previewCb(detIn, bin, w, h, blobs);
  }
}
