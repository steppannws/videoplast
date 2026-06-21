// videoplaster/js/leap-image-source.ts
import { TouchSource } from "./touch-source.ts";
import { findBlobs } from "./blobs.ts";
import { BlobTracker } from "./tracking.ts";
import { subtractBackground } from "./ir-preprocess.ts";
import { buildUndistMap, applyUndist } from "./undistort.ts";
import type { DetOpt, UndistOpt, Roi, MirrorOpt, DetBlob } from "./types.ts";

// Pure: blob center (image px) -> surface UV via an axis-aligned normalized rectangle.
// roi = {x,y,w,h} in 0..1 of the image. Outside the rect -> u or v outside [0,1].
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

export class LeapImageSource extends TouchSource {
  url: string;
  w: number;
  h: number;
  frame: Uint8ClampedArray | null;
  bg: Uint8ClampedArray | null;
  opt: DetOpt;
  undist: UndistOpt;
  roi: Roi;
  mirror: MirrorOpt;
  tracker: BlobTracker;
  previewCb: ((rgba: Uint8ClampedArray, w: number, h: number, blobs: DetBlob[]) => void) | null;
  statusCb: ((state: string) => void) | null;
  _stopped: boolean;
  _gotFrame: boolean;
  ws?: WebSocket;
  constructor(url = "ws://localhost:7681") {
    super(); this.name = "leap-ir"; this.url = url;
    this.w = 0; this.h = 0; this.frame = null; this.bg = null;
    this.opt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
    this.undist = { on: false, k1: -0.3, k2: 0, map: null };
    this.roi = { x: 0, y: 0, w: 1, h: 1 }; // normalized capture rectangle; default full frame
    this.mirror = { x: false, y: false };  // flip IR image (sensor views from behind the acrylic)
    this.tracker = new BlobTracker({ maxDist: 0.08 });
    this.previewCb = null; // optional: (rgba,w,h,blobs)=>void for the calibration preview
    this.statusCb = null;  // optional: (state)=>void — "connecting"|"connected"|"streaming"|"reconnecting"
    this._stopped = false; this._gotFrame = false;
  }
  start(): void { this._stopped = false; this._gotFrame = false; this._connect(); }
  _connect(): void {
    if (this._stopped) return;
    if (this.statusCb) this.statusCb("connecting");
    this.ws = new WebSocket(this.url); this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => { if (this.statusCb) this.statusCb("connected"); };
    this.ws.onmessage = (e: MessageEvent) => this._onFrame(e.data);
    this.ws.onclose = () => {
      if (this._stopped) return;
      if (this.statusCb) this.statusCb("reconnecting");
      setTimeout(() => this._connect(), 1000);   // bridge down / restarted → keep retrying
    };
    this.ws.onerror = () => { try { this.ws?.close(); } catch {} };  // onclose then handles retry
  }
  stop(): void { this._stopped = true; if (this.ws) { try { this.ws.close(); } catch {} } }
  restart(): void { this.stop(); this._stopped = false; this._gotFrame = false; this._connect(); }
  captureBackground(): void { if (this.frame) this.bg = this.frame.slice(); }
  setRoi(roi: Roi): void { this.roi = roi; }
  _onFrame(buf: ArrayBuffer): void {
    const dv = new DataView(buf); this.w = dv.getUint32(0, true); this.h = dv.getUint32(4, true);
    const gray = new Uint8Array(buf, 8, this.w * this.h);
    let rgba: Uint8ClampedArray = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) { rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=gray[i]; rgba[i*4+3]=255; }
    if (this.mirror.x || this.mirror.y) rgba = flipImage(rgba, this.w, this.h, this.mirror.x, this.mirror.y);
    if (this.undist.on) {
      if (!this.undist.map) this.undist.map = buildUndistMap(this.w, this.h, this.undist.k1, this.undist.k2);
      rgba = applyUndist(rgba, this.w, this.h, this.undist.map);
    }
    this.frame = rgba;
    if (!this._gotFrame) { this._gotFrame = true; if (this.statusCb) this.statusCb("streaming"); }
    if (this.bg && this.bg.length !== rgba.length) this.bg = null;
    const detIn = this.bg ? subtractBackground(rgba, this.bg, this.w * this.h) : rgba;
    const { blobs } = findBlobs({ data: detIn, width: this.w, height: this.h }, this.opt);
    const mapped = blobs
      .map((b) => { const { u, v } = roiMap(b.cx, b.cy, this.w, this.h, this.roi); return { x: u, y: v, strength: Math.min(1, b.bright/255) }; })
      .filter((p) => p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1);
    for (const ev of this.tracker.update(mapped)) this.emit(ev);
    if (this.previewCb) this.previewCb(detIn, this.w, this.h, blobs);
  }
}
