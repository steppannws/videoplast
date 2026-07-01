// IR detection calibration UI: renders the preview canvas (frame + detected blobs
// + ROI mask), drives ROI-corner drag, and wires the capture/reset/restart buttons.
// Reads the live IrSource through a getter since the active source changes at runtime.
import { saveSetting } from "./persist.ts";
import { clamp } from "../util/math.ts";
import type { IrSource } from "../sources/ir-source.ts";
import type { Roi, DetBlob, DetOpt, PinKey } from "../types/index.ts";

const HIT = 0.04;   // ROI handle hit radius (normalized)
const MIN = 0.05;   // minimum ROI extent (normalized)

export class IrCalibrator {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly maskCtx: CanvasRenderingContext2D | null;
  private dragCorner: PinKey | null = null;

  constructor(
    private readonly preview: HTMLCanvasElement | null,
    private readonly mask: HTMLCanvasElement | null,
    private readonly getIrSrc: () => IrSource | null,
    private readonly setStatus: (s: string) => void,
  ) {
    this.ctx = preview ? preview.getContext("2d") : null;
    this.maskCtx = mask ? mask.getContext("2d") : null;
  }

  // Route the active IR source's preview frames into this calibrator.
  attach(src: IrSource): void {
    src.previewCb = (rgba, bin, w, h, blobs) =>
      this.drawPreview(rgba, bin, w, h, blobs, src.roi, src.opt);
  }

  wire(): void {
    const pv = this.preview;
    if (pv) {
      pv.addEventListener("mousedown", (e) => {
        const src = this.getIrSrc();
        if (!src) return;
        const [nx, ny] = this.previewNorm(e);
        const hit = Object.entries(this.roiCorners(src.roi)).find(
          ([, [cx, cy]]) => Math.abs(cx - nx) < HIT && Math.abs(cy - ny) < HIT);
        if (hit) this.dragCorner = hit[0] as PinKey;
      });
      window.addEventListener("mousemove", (e) => {
        const src = this.getIrSrc();
        if (!this.dragCorner || !src) return;
        const [px, py] = this.previewNorm(e);
        const nx = clamp(px, 0, 1);
        const ny = clamp(py, 0, 1);
        const roi = src.roi;
        let x0 = roi.x, y0 = roi.y, x1 = roi.x + roi.w, y1 = roi.y + roi.h;
        if (this.dragCorner === "tl") { x0 = nx; y0 = ny; }
        else if (this.dragCorner === "tr") { x1 = nx; y0 = ny; }
        else if (this.dragCorner === "br") { x1 = nx; y1 = ny; }
        else if (this.dragCorner === "bl") { x0 = nx; y1 = ny; }
        if (x1 - x0 < MIN || y1 - y0 < MIN) return;
        src.setRoi({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      });
      window.addEventListener("mouseup", () => {
        const src = this.getIrSrc();
        if (this.dragCorner && src) saveSetting("roi", src.roi);
        this.dragCorner = null;
      });
    }

    this.button("captureBg", (src) => { src.captureBackground(); this.setStatus("background captured"); });
    this.button("resetZone", (src) => { src.setRoi({ x: 0, y: 0, w: 1, h: 1 }); saveSetting("roi", src.roi); this.setStatus("zone reset"); });
    this.button("restartIr", (src) => { src.restart(); this.setStatus("IR restarting"); });
  }

  // --- internals -----------------------------------------------------------
  private button(id: string, fn: (src: IrSource) => void): void {
    const el = document.getElementById(id) as HTMLElement | null;
    if (el) el.onclick = () => { const src = this.getIrSrc(); if (src) fn(src); };
  }

  private previewNorm(e: MouseEvent): [number, number] {
    const r = this.preview!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  private roiCorners(roi: Roi): Record<PinKey, [number, number]> {
    return {
      tl: [roi.x, roi.y],
      tr: [roi.x + roi.w, roi.y],
      br: [roi.x + roi.w, roi.y + roi.h],
      bl: [roi.x, roi.y + roi.h],
    };
  }

  private drawRoi(roi: Roi, w: number, h: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const rx = roi.x * w, ry = roi.y * h, rw = roi.w * w, rh = roi.h * h;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(rx, ry, rw, rh);
    ctx.fill("evenodd");
    ctx.restore();
    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);
    const hs = 10;
    ctx.fillStyle = "#0f0";
    for (const [hx, hy] of [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
  }

  private drawPreview(rgba: Uint8ClampedArray, bin: Uint8Array, w: number, h: number, blobs: DetBlob[], roi?: Roi, opt?: DetOpt): void {
    const ctx = this.ctx, pv = this.preview;
    if (ctx && pv) {
      if (pv.width !== w || pv.height !== h) { pv.width = w; pv.height = h; }
      const img = ctx.createImageData(w, h);
      img.data.set(rgba);
      ctx.putImageData(img, 0, 0);
      ctx.strokeStyle = "#0f0";
      ctx.lineWidth = 1;
      for (const b of blobs) ctx.strokeRect(b.cx - 3, b.cy - 3, 6, 6);
      if (roi) this.drawRoi(roi, w, h);
    }
    this.drawMask(bin, w, h, blobs, roi, opt);
  }

  // Right canvas: the binary threshold+morphology mask the blob detector runs on,
  // with blob boxes, an ROI border, and a live parameter HUD. Read-only.
  private drawMask(bin: Uint8Array, w: number, h: number, blobs: DetBlob[], roi?: Roi, opt?: DetOpt): void {
    const ctx = this.maskCtx, mv = this.mask;
    if (!ctx || !mv) return;
    if (mv.width !== w || mv.height !== h) { mv.width = w; mv.height = h; }
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < w * h; i++) { const v = bin[i] ? 255 : 0; d[i*4] = d[i*4+1] = d[i*4+2] = v; d[i*4+3] = 255; }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = 1;
    for (const b of blobs) ctx.strokeRect(b.cx - 3, b.cy - 3, 6, 6);
    if (roi) {
      ctx.strokeStyle = "#0f0";
      ctx.lineWidth = 2;
      ctx.strokeRect(roi.x * w, roi.y * h, roi.w * w, roi.h * h);
    }
    if (opt) this.drawHud(opt, blobs.length);
  }

  // One-line parameter readout, top-left, legible over black or white pixels.
  private drawHud(opt: DetOpt, blobCount: number): void {
    const ctx = this.maskCtx;
    if (!ctx) return;
    const lines = [
      `BRI ${opt.brightness} · CON ${opt.contrast.toFixed(2)} · THR ${opt.threshold} · BLUR ${opt.blurAmt} · ERO ${opt.erosionAmt}`,
      `MIN ${opt.minArea} · MAX ${opt.maxArea} · INV ${opt.invert ? "on" : "off"} · ${blobCount} blobs`,
    ];
    ctx.save();
    ctx.font = "11px monospace";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    lines.forEach((line, i) => {
      const y = 4 + i * 14;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(line, 4, y);
      ctx.fillStyle = "#0f0";
      ctx.fillText(line, 4, y);
    });
    ctx.restore();
  }
}
