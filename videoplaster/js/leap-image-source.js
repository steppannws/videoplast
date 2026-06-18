// videoplaster/js/leap-image-source.js
import { TouchSource } from "./touch-source.js";
import { findBlobs } from "./blobs.js";
import { BlobTracker } from "./tracking.js";
import { subtractBackground } from "./ir-preprocess.js";
import { buildUndistMap, applyUndist } from "./undistort.js";

// Pure: blob center (image px) -> surface UV via an axis-aligned normalized rectangle.
// roi = {x,y,w,h} in 0..1 of the image. Outside the rect -> u or v outside [0,1].
export function roiMap(cx, cy, w, h, roi) {
  const u = (cx / w - roi.x) / roi.w;
  const v = (cy / h - roi.y) / roi.h;
  return { u, v };
}

export class LeapImageSource extends TouchSource {
  constructor(url = "ws://localhost:7681") {
    super(); this.name = "leap-ir"; this.url = url;
    this.w = 0; this.h = 0; this.frame = null; this.bg = null;
    this.opt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
    this.undist = { on: false, k1: -0.3, k2: 0, map: null };
    this.roi = { x: 0, y: 0, w: 1, h: 1 }; // normalized capture rectangle; default full frame
    this.tracker = new BlobTracker({ maxDist: 0.08 });
    this.previewCb = null; // optional: (rgba,w,h,blobs)=>void for the calibration preview
  }
  start() {
    this.ws = new WebSocket(this.url); this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (e) => this._onFrame(e.data);
  }
  stop() { if (this.ws) this.ws.close(); }
  captureBackground() { if (this.frame) this.bg = this.frame.slice(); }
  setRoi(roi) { this.roi = roi; }
  _onFrame(buf) {
    const dv = new DataView(buf); this.w = dv.getUint32(0, true); this.h = dv.getUint32(4, true);
    const gray = new Uint8Array(buf, 8, this.w * this.h);
    let rgba = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) { rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=gray[i]; rgba[i*4+3]=255; }
    if (this.undist.on) {
      if (!this.undist.map) this.undist.map = buildUndistMap(this.w, this.h, this.undist.k1, this.undist.k2);
      rgba = applyUndist(rgba, this.w, this.h, this.undist.map);
    }
    this.frame = rgba;
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
