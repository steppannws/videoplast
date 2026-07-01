// Corner-pin overlay: draws the pin handles + optional calibration grid on the 2D
// pin canvas, drives pin drag (mouse + touch) and arrow-key nudge, and keeps the
// pin sliders / persisted offsets in sync with the warp.
import { bindNumber, bindBool, saveSetting, getSetting } from "./persist.ts";
import { drawGrid, nudgeAxis } from "./overlay.ts";
import { scaleCorners, pointInQuad, paramOnEdge } from "../gl/quad.ts";
import { PIN_KEYS, AXES, PIN_LIMIT } from "../config/controls.ts";
import { clamp } from "../util/math.ts";
import type { WarpGL } from "../gl/warp-gl.ts";
import type { PinKey, Axis, SeamKey } from "../types/index.ts";

const PIN_HIT = 26;
const clampOff = (v: number): number => clamp(v, -PIN_LIMIT, PIN_LIMIT);
// Seam edge -> its slider id and the two corners it slides between.
const SEAM_SLIDER: Record<SeamKey, string> = { top: "seamTop", bottom: "seamBottom" };
const SEAM_EDGE: Record<SeamKey, [PinKey, PinKey]> = { top: ["tl", "tr"], bottom: ["bl", "br"] };

export class PinController {
  private readonly pinCtx: CanvasRenderingContext2D | null;
  private selectedPin: PinKey | null = null;
  private pinDrag: PinKey | null = null;
  private midDrag: SeamKey | null = null;
  private bodyDrag = false;
  private lastBody: { x: number; y: number } | null = null;
  private gridOn = false;

  constructor(
    private readonly glCanvas: HTMLCanvasElement,
    private readonly pinCanvas: HTMLCanvasElement | null,
    private readonly warp: WarpGL,
    private readonly setStatus: (s: string) => void,
  ) {
    this.pinCtx = pinCanvas ? pinCanvas.getContext("2d") : null;
    this.attachDrag();
  }

  setGrid(on: boolean): void { this.gridOn = on; }

  draw(): void {
    const ctx = this.pinCtx, canvas = this.pinCanvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.gridOn) drawGrid(ctx, canvas.width, canvas.height, 50);
    const m = this.warp.meshPoints();
    for (const k of PIN_KEYS) this.drawHandle(ctx, m[k], k === this.selectedPin, k.toUpperCase());
    this.drawHandle(ctx, m.tc, this.midDrag === "top", "TC");
    this.drawHandle(ctx, m.bc, this.midDrag === "bottom", "BC");
  }

  private drawHandle(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, sel: boolean, label: string): void {
    ctx.save();
    ctx.strokeStyle = sel ? "rgba(0,255,140,0.95)" : "rgba(255,255,255,0.65)";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 10, p.y); ctx.lineTo(p.x + 10, p.y);
    ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x, p.y + 10);
    ctx.stroke();
    ctx.fillStyle = sel ? "rgba(0,255,140,0.9)" : "rgba(255,255,255,0.6)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, p.x, p.y - 22);
    ctx.restore();
  }

  nudge(axis: Axis, dir: -1 | 1, shift: boolean): void {
    if (!this.selectedPin) return;
    const el = document.getElementById(this.selectedPin + axis) as HTMLInputElement | null;
    const cur = el ? parseFloat(el.value) || 0 : 0;
    this.syncPinSlider(this.selectedPin, axis, nudgeAxis(cur, dir, shift));
  }

  // Scale the whole content quad about its centroid, rewriting each corner's offset.
  scaleBy(factor: number): void {
    const next = scaleCorners(this.warp.cornerPositions(), factor);
    for (const k of PIN_KEYS) {
      const b = this.baseCorner(k);
      this.syncPinSlider(k, "x", clampOff(next[k].x - b.x));
      this.syncPinSlider(k, "y", clampOff(next[k].y - b.y));
    }
    this.setStatus(factor > 1 ? "content scaled up" : "content scaled down");
  }

  wire(): void {
    // One-time migration of legacy absolute pin values to the offset schema.
    if (getSetting("pinSchema") !== "offset") {
      for (const k of PIN_KEYS) for (const a of AXES) saveSetting(k + a, "0");
      saveSetting("pinSchema", "offset");
    }
    for (const k of PIN_KEYS) for (const a of AXES) {
      bindNumber(k + a, (n) => this.warp.setPinOffset(k, a, n), (n) => Math.round(n) + "px");
    }
    bindNumber("seamTop", (n) => this.warp.setSeam("top", n), (n) => n.toFixed(2));
    bindNumber("seamBottom", (n) => this.warp.setSeam("bottom", n), (n) => n.toFixed(2));
    const reset = document.getElementById("resetPins") as HTMLElement | null;
    if (reset) reset.onclick = () => {
      for (const k of PIN_KEYS) for (const a of AXES) this.syncPinSlider(k, a, 0);
      this.syncSeam("top", 0.5); this.syncSeam("bottom", 0.5);
      this.setStatus("anchors reset");
    };
    const zoomIn = document.getElementById("zoomIn") as HTMLElement | null;
    if (zoomIn) zoomIn.onclick = () => this.scaleBy(1.1);
    const zoomOut = document.getElementById("zoomOut") as HTMLElement | null;
    if (zoomOut) zoomOut.onclick = () => this.scaleBy(1 / 1.1);
    bindBool("grid", (b) => this.setGrid(b));
  }

  // --- internals -----------------------------------------------------------
  private syncPinSlider(k: PinKey, axis: Axis, val: number): void {
    const id = k + axis;
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.value = String(val);
      const r = document.getElementById(id + "v");
      if (r) r.textContent = Math.round(val) + "px";
    }
    this.warp.setPinOffset(k, axis, val);
    saveSetting(id, String(val));
  }

  private syncSeam(edge: SeamKey, t: number): void {
    const id = SEAM_SLIDER[edge];
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.value = String(t);
      const r = document.getElementById(id + "v");
      if (r) r.textContent = t.toFixed(2);
    }
    this.warp.setSeam(edge, t);
    saveSetting(id, String(t));
  }

  private nearMid(px: number, py: number): SeamKey | null {
    const m = this.warp.meshPoints();
    if (Math.hypot(px - m.tc.x, py - m.tc.y) < PIN_HIT) return "top";
    if (Math.hypot(px - m.bc.x, py - m.bc.y) < PIN_HIT) return "bottom";
    return null;
  }

  private canvasPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    const r = this.glCanvas.getBoundingClientRect();
    const sx = this.glCanvas.width / r.width, sy = this.glCanvas.height / r.height;
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
  }

  private nearPin(px: number, py: number): PinKey | null {
    const pp = this.warp.cornerPositions();
    for (const k of PIN_KEYS) {
      if (Math.hypot(px - pp[k].x, py - pp[k].y) < PIN_HIT) return k;
    }
    return null;
  }

  private baseCorner(k: PinKey): { x: number; y: number } {
    const corners: Record<PinKey, { x: number; y: number }> = {
      tl: { x: 0, y: 0 },
      tr: { x: this.warp.w, y: 0 },
      br: { x: this.warp.w, y: this.warp.h },
      bl: { x: 0, y: this.warp.h },
    };
    return corners[k];
  }

  private startPinDrag = (e: MouseEvent | TouchEvent): void => {
    const p = this.canvasPos(e);
    const k = this.nearPin(p.x, p.y);
    if (k) {
      this.selectedPin = k;
      this.pinDrag = k;
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    // Then the mid-edge seam handles (slide along their edge).
    const mid = this.nearMid(p.x, p.y);
    if (mid) {
      this.midDrag = mid;
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    // Not on a handle: grabbing inside the quad body moves all 4 anchors together.
    if (pointInQuad(p.x, p.y, this.warp.cornerPositions())) {
      this.bodyDrag = true;
      this.lastBody = p;
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };

  private movePinDrag = (e: MouseEvent | TouchEvent): void => {
    if (this.bodyDrag) { this.moveBodyDrag(e); return; }
    if (this.midDrag) { this.moveMidDrag(e); return; }
    if (!this.pinDrag) return;
    const p = this.canvasPos(e);
    const b = this.baseCorner(this.pinDrag);
    this.syncPinSlider(this.pinDrag, "x", clampOff(p.x - b.x));
    this.syncPinSlider(this.pinDrag, "y", clampOff(p.y - b.y));
  };

  private moveMidDrag(e: MouseEvent | TouchEvent): void {
    if (!this.midDrag) return;
    const p = this.canvasPos(e);
    const cp = this.warp.cornerPositions();
    const [a, b] = SEAM_EDGE[this.midDrag];
    this.syncSeam(this.midDrag, paramOnEdge(p.x, p.y, cp[a], cp[b]));
  }

  private moveBodyDrag(e: MouseEvent | TouchEvent): void {
    if (!this.lastBody) return;
    const p = this.canvasPos(e);
    const dx = p.x - this.lastBody.x, dy = p.y - this.lastBody.y;
    for (const k of PIN_KEYS) {
      this.syncPinSlider(k, "x", clampOff(this.warp.off[k].x + dx));
      this.syncPinSlider(k, "y", clampOff(this.warp.off[k].y + dy));
    }
    this.lastBody = p;
  }

  private endDrag = (): void => { this.pinDrag = null; this.midDrag = null; this.bodyDrag = false; this.lastBody = null; };

  private attachDrag(): void {
    this.glCanvas.addEventListener("mousedown", this.startPinDrag as EventListener, true);
    window.addEventListener("mousemove", this.movePinDrag as EventListener);
    window.addEventListener("mouseup", this.endDrag);
    this.glCanvas.addEventListener("touchstart", this.startPinDrag as EventListener, { capture: true, passive: false });
    window.addEventListener("touchmove", (e) => {
      if (this.pinDrag || this.midDrag || this.bodyDrag) { this.movePinDrag(e); e.preventDefault(); }
    }, { passive: false });
    window.addEventListener("touchend", this.endDrag);
  }
}
