// Grid-warp overlay: draws the 4×4 control-point mesh + handles on the 2D pin canvas,
// drives point drag / body-move / scale / arrow-nudge (mouse + touch), persists the grid,
// and toggles handle visibility for a clean calibration view.
import { bindBool, saveSetting, getSetting } from "./persist.ts";
import { drawGrid, nudgeAxis } from "./overlay.ts";
import {
  baseGrid, evalGrid, nearestPoint, centroidOf, scalePoints, pointInQuad, gridIdx,
  type Grid, type Corners,
} from "../gl/quad.ts";
import { PIN_LIMIT } from "../config/controls.ts";
import { clamp } from "../util/math.ts";
import type { WarpGL } from "../gl/warp-gl.ts";
import type { Pt } from "../gl/homography.ts";
import type { Axis } from "../types/index.ts";

const PIN_HIT = 26;
const clampOff = (v: number): number => clamp(v, -PIN_LIMIT, PIN_LIMIT);

export class PinController {
  private readonly pinCtx: CanvasRenderingContext2D | null;
  private selected: number | null = null;
  private pointDrag: number | null = null;
  private bodyDrag = false;
  private lastBody: Pt | null = null;
  private gridOn = false;
  private showGrid = true;

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
  setShowGrid(on: boolean): void { this.showGrid = on; }

  draw(): void {
    const ctx = this.pinCtx, canvas = this.pinCanvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.gridOn) drawGrid(ctx, canvas.width, canvas.height, 50);
    if (!this.showGrid) return;
    const g = this.warp.points();
    this.drawMesh(ctx, g);
    for (let k = 0; k < 16; k++) this.drawHandle(ctx, g[k], k === this.selected);
  }

  nudge(axis: Axis, dir: -1 | 1, shift: boolean): void {
    if (this.selected === null) return;
    const cur = this.warp.off[this.selected];
    const next = { x: cur.x, y: cur.y };
    next[axis] = nudgeAxis(cur[axis], dir, shift);
    this.syncPoint(this.selected, next.x, next.y);
  }

  // Scale the whole grid about its centroid, rewriting every point's offset.
  scaleBy(factor: number): void {
    const g = this.warp.points();
    const next = scalePoints(g, factor, centroidOf(g));
    const b = this.base();
    for (let k = 0; k < 16; k++) this.syncPoint(k, next[k].x - b[k].x, next[k].y - b[k].y);
    this.setStatus(factor > 1 ? "warp scaled up" : "warp scaled down");
  }

  wire(): void {
    this.loadGrid();
    const reset = document.getElementById("resetPins") as HTMLElement | null;
    if (reset) reset.onclick = () => {
      this.warp.reset(); this.saveGrid(); this.selected = null;
      this.setStatus("warp reset");
    };
    const zoomIn = document.getElementById("zoomIn") as HTMLElement | null;
    if (zoomIn) zoomIn.onclick = () => this.scaleBy(1.1);
    const zoomOut = document.getElementById("zoomOut") as HTMLElement | null;
    if (zoomOut) zoomOut.onclick = () => this.scaleBy(1 / 1.1);
    bindBool("grid", (b) => this.setGrid(b));
    bindBool("warpEdit", (b) => this.setShowGrid(b));
  }

  // --- internals -----------------------------------------------------------
  private base(): Grid { return baseGrid(this.warp.w, this.warp.h); }

  private corners(g: Grid): Corners {
    return { tl: g[gridIdx(0, 0)], tr: g[gridIdx(3, 0)], br: g[gridIdx(3, 3)], bl: g[gridIdx(0, 3)] };
  }

  private syncPoint(idx: number, x: number, y: number): void {
    this.warp.setPointOffset(idx, clampOff(x), clampOff(y));
    this.saveGrid();
  }

  private saveGrid(): void { saveSetting("warpGrid", this.warp.off); }

  private loadGrid(): void {
    const g = getSetting<Pt[]>("warpGrid");
    if (Array.isArray(g) && g.length === 16) {
      for (let k = 0; k < 16; k++) this.warp.setPointOffset(k, clampOff(g[k]?.x ?? 0), clampOff(g[k]?.y ?? 0));
    }
  }

  private drawMesh(ctx: CanvasRenderingContext2D, g: Grid): void {
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,140,0.35)"; ctx.lineWidth = 1;
    const S = 24;
    for (let j = 0; j < 4; j++) {
      ctx.beginPath();
      for (let s = 0; s <= S; s++) { const p = evalGrid(g, s / S, j / 3); s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
      ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      for (let s = 0; s <= S; s++) { const p = evalGrid(g, i / 3, s / S); s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHandle(ctx: CanvasRenderingContext2D, p: Pt, sel: boolean): void {
    ctx.save();
    ctx.strokeStyle = sel ? "rgba(0,255,140,0.95)" : "rgba(255,255,255,0.75)";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y);
    ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7);
    ctx.stroke();
    ctx.restore();
  }

  private canvasPos(e: MouseEvent | TouchEvent): Pt {
    const r = this.glCanvas.getBoundingClientRect();
    const sx = this.glCanvas.width / r.width, sy = this.glCanvas.height / r.height;
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
  }

  private startPinDrag = (e: MouseEvent | TouchEvent): void => {
    if (!this.showGrid) return;
    const p = this.canvasPos(e);
    const g = this.warp.points();
    const k = nearestPoint(p.x, p.y, g);
    if (Math.hypot(p.x - g[k].x, p.y - g[k].y) < PIN_HIT) {
      this.selected = k;
      this.pointDrag = k;
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    // Not on a handle: grabbing inside the corner quad moves all points together.
    if (pointInQuad(p.x, p.y, this.corners(g))) {
      this.bodyDrag = true;
      this.lastBody = p;
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };

  private movePinDrag = (e: MouseEvent | TouchEvent): void => {
    if (this.bodyDrag) { this.moveBodyDrag(e); return; }
    if (this.pointDrag === null) return;
    const p = this.canvasPos(e);
    const b = this.base()[this.pointDrag];
    this.syncPoint(this.pointDrag, p.x - b.x, p.y - b.y);
  };

  private moveBodyDrag(e: MouseEvent | TouchEvent): void {
    if (!this.lastBody) return;
    const p = this.canvasPos(e);
    const dx = p.x - this.lastBody.x, dy = p.y - this.lastBody.y;
    for (let k = 0; k < 16; k++) this.syncPoint(k, this.warp.off[k].x + dx, this.warp.off[k].y + dy);
    this.lastBody = p;
  }

  private endDrag = (): void => { this.pointDrag = null; this.bodyDrag = false; this.lastBody = null; };

  private attachDrag(): void {
    this.glCanvas.addEventListener("mousedown", this.startPinDrag as EventListener, true);
    window.addEventListener("mousemove", this.movePinDrag as EventListener);
    window.addEventListener("mouseup", this.endDrag);
    this.glCanvas.addEventListener("touchstart", this.startPinDrag as EventListener, { capture: true, passive: false });
    window.addEventListener("touchmove", (e) => {
      if (this.pointDrag !== null || this.bodyDrag) { this.movePinDrag(e); e.preventDefault(); }
    }, { passive: false });
    window.addEventListener("touchend", this.endDrag);
  }
}
