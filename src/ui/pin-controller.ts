// Two-layer warp editor on the 2D pin canvas.
// CORNERS mode: drag the 4 corner handles (perspective fit via homography).
// MESH mode: drag detail-mesh control points (unit-space offsets); double-click a mesh
// line to insert a row/column at that spot; −COL/−ROW remove the selected point's line.
// Both modes: drag inside the quad moves everything, ZOOM buttons scale, Ctrl+Z undoes.
// Also draws the SHOW TOUCHES verification crosshairs at warped touch positions.
import { bindBool, saveSetting, getSetting } from "./persist.ts";
import { nudgeAxis } from "./overlay.ts";
import {
  defaultMesh, evalMesh, insertKnot, removeKnot, cloneMesh, pointInQuad,
  MESH_MIN, MESH_MAX, type MeshState, type Corners,
} from "../gl/quad.ts";
import { applyH, inv3 } from "../gl/homography.ts";
import { PIN_LIMIT } from "../config/controls.ts";
import { clamp } from "../util/math.ts";
import type { WarpGL } from "../gl/warp-gl.ts";
import type { Pt } from "../gl/homography.ts";
import type { Axis, TouchEv } from "../types/index.ts";

const CORNER_HIT = 26, MESH_HIT = 20, LINE_HIT = 12, LINE_SAMPLES = 24;
const UNDO_CAP = 50, TOUCH_FADE_MS = 600;
const clampOff = (v: number): number => clamp(v, -PIN_LIMIT, PIN_LIMIT);

type Mode = "corners" | "mesh";
interface Snap { corners: Pt[]; mesh: MeshState }

export class PinController {
  private readonly glCanvas: HTMLCanvasElement;
  private readonly pinCanvas: HTMLCanvasElement | null;
  private readonly warp: WarpGL;
  private readonly setStatus: (s: string) => void;
  private readonly isEditing: () => boolean;
  private readonly pinCtx: CanvasRenderingContext2D | null;

  private mode: Mode = "corners";
  private selCorner: number | null = null;
  private selMesh: { i: number; j: number } | null = null;
  private dragCorner: number | null = null;
  private dragMesh: { i: number; j: number } | null = null;
  private bodyDrag = false;
  private lastBody: Pt | null = null;
  private showGrid = true;
  private showTouches = false;
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  private touches = new Map<number, { x: number; y: number; upAt: number | null }>();

  constructor(
    glCanvas: HTMLCanvasElement,
    pinCanvas: HTMLCanvasElement | null,
    warp: WarpGL,
    setStatus: (s: string) => void,
    isEditing: () => boolean,
  ) {
    this.glCanvas = glCanvas;
    this.pinCanvas = pinCanvas;
    this.warp = warp;
    this.setStatus = setStatus;
    this.isEditing = isEditing;
    this.pinCtx = pinCanvas ? pinCanvas.getContext("2d") : null;
    this.attach();
  }

  // --- public API ------------------------------------------------------------
  setShowTouches(on: boolean): void { this.showTouches = on; }

  addTouch(ev: TouchEv): void {
    if (!this.showTouches) return;
    if (ev.state === "up") {
      const t = this.touches.get(ev.id);
      if (t) t.upAt = performance.now();
    } else {
      this.touches.set(ev.id, { x: ev.x, y: ev.y, upAt: null });
    }
  }

  nudge(axis: Axis, dir: -1 | 1, shift: boolean): void {
    if (this.mode === "corners" && this.selCorner !== null) {
      this.pushUndo();
      const c = this.warp.corners[this.selCorner];
      const next = { ...c };
      next[axis] = nudgeAxis(c[axis], dir, shift);
      this.warp.setCorner(this.selCorner, next.x, next.y);
      this.saveCorners();
    } else if (this.mode === "mesh" && this.selMesh) {
      this.pushUndo();
      const { i, j } = this.selMesh;
      const m = cloneMesh(this.warp.mesh);
      const unit = { x: m.ku[i] + m.off[j][i].x, y: m.kv[j] + m.off[j][i].y };
      const s = this.toScreen(unit);
      s[axis] += dir * (shift ? 10 : 1);
      const nu = this.toUnit(s);
      m.off[j][i] = { x: clamp(nu.x - m.ku[i], -1, 1), y: clamp(nu.y - m.kv[j], -1, 1) };
      this.warp.setMesh(m);
      this.saveMesh();
    }
  }

  draw(): void {
    const ctx = this.pinCtx, canvas = this.pinCanvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.showGrid) {
      this.drawMeshLines(ctx);
      if (this.mode === "corners") this.drawCorners(ctx, false);
      else { this.drawMeshPoints(ctx); this.drawCorners(ctx, true); }
    }
    if (this.showTouches) this.drawTouches(ctx);
  }

  scaleBy(factor: number): void {
    this.pushUndo();
    const sc = this.warp.cornerScreen();
    const cx = (sc[0].x + sc[1].x + sc[2].x + sc[3].x) / 4;
    const cy = (sc[0].y + sc[1].y + sc[2].y + sc[3].y) / 4;
    const base = [{ x: 0, y: 0 }, { x: this.warp.w, y: 0 }, { x: this.warp.w, y: this.warp.h }, { x: 0, y: this.warp.h }];
    for (let i = 0; i < 4; i++) {
      const nx = cx + (sc[i].x - cx) * factor, ny = cy + (sc[i].y - cy) * factor;
      this.warp.setCorner(i, clampOff(nx - base[i].x), clampOff(ny - base[i].y));
    }
    this.saveCorners();
    this.setStatus(factor > 1 ? "scaled up" : "scaled down");
  }

  wire(): void {
    this.loadState();
    const btn = (id: string, fn: () => void): void => {
      const el = document.getElementById(id) as HTMLElement | null;
      if (el) el.onclick = fn;
    };
    btn("modeCorners", () => this.setMode("corners"));
    btn("modeMesh", () => this.setMode("mesh"));
    btn("removeCol", () => this.removeLine("u"));
    btn("removeRow", () => this.removeLine("v"));
    btn("resetPins", () => {
      this.pushUndo();
      if (this.mode === "corners") { this.warp.resetCorners(); this.saveCorners(); this.setStatus("corners reset"); }
      else { this.warp.resetMesh(); this.selMesh = null; this.saveMesh(); this.setStatus("mesh reset"); }
    });
    btn("zoomIn", () => this.scaleBy(1.1));
    btn("zoomOut", () => this.scaleBy(1 / 1.1));
    bindBool("warpEdit", (b) => { this.showGrid = b; });
    bindBool("testPattern", (b) => this.warp.setTestPattern(b));
    bindBool("showTouches", (b) => this.setShowTouches(b));
    this.syncModeButtons();
  }

  // --- mapping ----------------------------------------------------------------
  private toScreen(p: Pt): Pt { return applyH(this.warp.H(), p.x, p.y); }
  private toUnit(p: Pt): Pt { return applyH(inv3(this.warp.H()), p.x, p.y); }

  private canvasPos(e: MouseEvent | TouchEvent): Pt {
    const r = this.glCanvas.getBoundingClientRect();
    const sx = this.glCanvas.width / r.width, sy = this.glCanvas.height / r.height;
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
  }

  private meshPointScreen(i: number, j: number): Pt {
    const m = this.warp.mesh;
    return this.toScreen({ x: m.ku[i] + m.off[j][i].x, y: m.kv[j] + m.off[j][i].y });
  }

  private cornersRecord(): Corners {
    const c = this.warp.cornerScreen();
    return { tl: c[0], tr: c[1], br: c[2], bl: c[3] };
  }

  // --- state / undo -----------------------------------------------------------
  private snap(): Snap {
    return { corners: this.warp.corners.map((p) => ({ ...p })), mesh: cloneMesh(this.warp.mesh) };
  }

  private applySnap(s: Snap): void {
    this.warp.setCorners(s.corners);
    this.warp.setMesh(s.mesh);
    this.selMesh = null;
    this.saveCorners(); this.saveMesh();
  }

  private pushUndo(): void {
    this.undoStack.push(this.snap());
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    const s = this.undoStack.pop();
    if (!s) { this.setStatus("nothing to undo"); return; }
    this.redoStack.push(this.snap());
    this.applySnap(s);
    this.setStatus("undo");
  }

  private redo(): void {
    const s = this.redoStack.pop();
    if (!s) { this.setStatus("nothing to redo"); return; }
    this.undoStack.push(this.snap());
    this.applySnap(s);
    this.setStatus("redo");
  }

  private saveCorners(): void { saveSetting("warpCorners", this.warp.corners); }
  private saveMesh(): void { saveSetting("warpMesh", this.warp.mesh); }

  private loadState(): void {
    const c = getSetting<Pt[]>("warpCorners");
    if (Array.isArray(c) && c.length === 4 && c.every((p) => p && typeof p.x === "number" && typeof p.y === "number")) {
      this.warp.setCorners(c.map((p) => ({ x: clampOff(p.x), y: clampOff(p.y) })));
    }
    const m = getSetting<MeshState>("warpMesh");
    if (m && this.validMesh(m)) this.warp.setMesh(m);
  }

  private validMesh(m: MeshState): boolean {
    const knotsOk = (k: number[]): boolean =>
      Array.isArray(k) && k.length >= MESH_MIN && k.length <= MESH_MAX &&
      k[0] === 0 && k[k.length - 1] === 1 && k.every((v, i) => i === 0 || v > k[i - 1]);
    return knotsOk(m.ku) && knotsOk(m.kv) && Array.isArray(m.off) &&
      m.off.length === m.kv.length && m.off.every((r) =>
        Array.isArray(r) && r.length === m.ku.length &&
        r.every((p) => p && typeof p.x === "number" && typeof p.y === "number"));
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.syncModeButtons();
    this.setStatus(mode === "corners" ? "corners: drag to fit perspective" : "mesh: drag points, dbl-click line to split");
  }

  private syncModeButtons(): void {
    const c = document.getElementById("modeCorners"), m = document.getElementById("modeMesh");
    if (c) c.classList.toggle("active", this.mode === "corners");
    if (m) m.classList.toggle("active", this.mode === "mesh");
  }

  private removeLine(axis: "u" | "v"): void {
    if (!this.selMesh) { this.setStatus("select a mesh point first"); return; }
    const idx = axis === "u" ? this.selMesh.i : this.selMesh.j;
    const next = removeKnot(this.warp.mesh, axis, idx);
    if (!next) { this.setStatus(axis === "u" ? "cannot remove that column" : "cannot remove that row"); return; }
    this.pushUndo();
    this.warp.setMesh(next);
    this.selMesh = null;
    this.saveMesh();
    this.setStatus(axis === "u" ? "column removed" : "row removed");
  }

  // --- drawing ----------------------------------------------------------------
  private drawMeshLines(ctx: CanvasRenderingContext2D): void {
    const m = this.warp.mesh;
    ctx.save();
    ctx.strokeStyle = this.mode === "mesh" ? "rgba(0,255,140,0.45)" : "rgba(0,255,140,0.15)";
    ctx.lineWidth = 1;
    const line = (fixed: number, along: "u" | "v"): void => {
      ctx.beginPath();
      for (let s = 0; s <= LINE_SAMPLES; s++) {
        const t = s / LINE_SAMPLES;
        const e = along === "u" ? evalMesh(m, t, fixed) : evalMesh(m, fixed, t);
        const p = this.toScreen(e.pos);
        s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    };
    for (const kv of m.kv) line(kv, "u");
    for (const ku of m.ku) line(ku, "v");
    ctx.restore();
  }

  private drawHandle(ctx: CanvasRenderingContext2D, p: Pt, r: number, sel: boolean, faint: boolean): void {
    ctx.save();
    const a = faint ? 0.3 : 1;
    ctx.strokeStyle = sel ? `rgba(0,255,140,${0.95 * a})` : `rgba(255,255,255,${0.75 * a})`;
    ctx.fillStyle = `rgba(0,0,0,${0.55 * a})`;
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - r * 0.6, p.y); ctx.lineTo(p.x + r * 0.6, p.y);
    ctx.moveTo(p.x, p.y - r * 0.6); ctx.lineTo(p.x, p.y + r * 0.6);
    ctx.stroke();
    ctx.restore();
  }

  private drawCorners(ctx: CanvasRenderingContext2D, faint: boolean): void {
    const sc = this.warp.cornerScreen();
    for (let i = 0; i < 4; i++) {
      this.drawHandle(ctx, sc[i], faint ? 9 : 14, !faint && i === this.selCorner, faint);
    }
  }

  private drawMeshPoints(ctx: CanvasRenderingContext2D): void {
    const m = this.warp.mesh;
    for (let j = 0; j < m.kv.length; j++) for (let i = 0; i < m.ku.length; i++) {
      const sel = !!this.selMesh && this.selMesh.i === i && this.selMesh.j === j;
      this.drawHandle(ctx, this.meshPointScreen(i, j), 8, sel, false);
    }
  }

  private drawTouches(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    for (const [id, t] of this.touches) {
      let alpha = 0.9;
      if (t.upAt !== null) {
        const dt = now - t.upAt;
        if (dt > TOUCH_FADE_MS) { this.touches.delete(id); continue; }
        alpha = 0.9 * (1 - dt / TOUCH_FADE_MS);
      }
      const p = this.toScreen(evalMesh(this.warp.mesh, t.x, t.y).pos);
      ctx.save();
      ctx.strokeStyle = `rgba(255,80,80,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.moveTo(p.x - 18, p.y); ctx.lineTo(p.x + 18, p.y);
      ctx.moveTo(p.x, p.y - 18); ctx.lineTo(p.x, p.y + 18);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- input ------------------------------------------------------------------
  private startDrag = (e: MouseEvent | TouchEvent): void => {
    if (!this.showGrid) return;
    const p = this.canvasPos(e);
    if (this.mode === "corners") {
      const sc = this.warp.cornerScreen();
      for (let i = 0; i < 4; i++) {
        if (Math.hypot(p.x - sc[i].x, p.y - sc[i].y) < CORNER_HIT) {
          this.pushUndo();
          this.selCorner = i; this.dragCorner = i;
          e.stopImmediatePropagation(); e.preventDefault();
          return;
        }
      }
    } else {
      const m = this.warp.mesh;
      for (let j = 0; j < m.kv.length; j++) for (let i = 0; i < m.ku.length; i++) {
        const s = this.meshPointScreen(i, j);
        if (Math.hypot(p.x - s.x, p.y - s.y) < MESH_HIT) {
          this.pushUndo();
          this.selMesh = { i, j }; this.dragMesh = { i, j };
          e.stopImmediatePropagation(); e.preventDefault();
          return;
        }
      }
    }
    if (pointInQuad(p.x, p.y, this.cornersRecord())) {
      this.pushUndo();
      this.bodyDrag = true; this.lastBody = p;
      e.stopImmediatePropagation(); e.preventDefault();
    }
  };

  private moveDrag = (e: MouseEvent | TouchEvent): void => {
    if (this.bodyDrag) { this.moveBody(e); return; }
    if (this.dragCorner !== null) {
      const p = this.canvasPos(e);
      const base = [{ x: 0, y: 0 }, { x: this.warp.w, y: 0 }, { x: this.warp.w, y: this.warp.h }, { x: 0, y: this.warp.h }][this.dragCorner];
      this.warp.setCorner(this.dragCorner, clampOff(p.x - base.x), clampOff(p.y - base.y));
      this.saveCorners();
      return;
    }
    if (this.dragMesh) {
      const p = this.canvasPos(e);
      const { i, j } = this.dragMesh;
      const m = cloneMesh(this.warp.mesh);
      const u = this.toUnit(p);
      m.off[j][i] = { x: clamp(u.x - m.ku[i], -1, 1), y: clamp(u.y - m.kv[j], -1, 1) };
      this.warp.setMesh(m);
      this.saveMesh();
    }
  };

  private moveBody(e: MouseEvent | TouchEvent): void {
    if (!this.lastBody) return;
    const p = this.canvasPos(e);
    const dx = p.x - this.lastBody.x, dy = p.y - this.lastBody.y;
    for (let i = 0; i < 4; i++) {
      const c = this.warp.corners[i];
      this.warp.setCorner(i, clampOff(c.x + dx), clampOff(c.y + dy));
    }
    this.saveCorners();
    this.lastBody = p;
  }

  private endDrag = (): void => {
    this.dragCorner = null; this.dragMesh = null; this.bodyDrag = false; this.lastBody = null;
  };

  // Distance from p to the polyline sampled by pts (params in ts), with the line
  // parameter interpolated along the nearest segment.
  private nearestOnPolyline(p: Pt, pts: Pt[], ts: number[]): { t: number; d: number } {
    let best = { t: ts[0], d: Infinity };
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const f = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
      const qx = a.x + f * dx, qy = a.y + f * dy;
      const d = Math.hypot(p.x - qx, p.y - qy);
      if (d < best.d) best = { t: ts[s] + f * (ts[s + 1] - ts[s]), d };
    }
    return best;
  }

  private onDblClick = (e: MouseEvent): void => {
    if (!this.showGrid) return;
    const p = this.canvasPos(e);
    const m = this.warp.mesh;
    const ts = Array.from({ length: LINE_SAMPLES + 1 }, (_, s) => s / LINE_SAMPLES);
    let best: { axis: "u" | "v"; t: number; d: number } | null = null;
    // Rows (horizontal lines, v fixed): the nearest point's u is where a COLUMN goes.
    for (const kv of m.kv) {
      const pts = ts.map((t) => this.toScreen(evalMesh(m, t, kv).pos));
      const r = this.nearestOnPolyline(p, pts, ts);
      if (r.d < LINE_HIT && (!best || r.d < best.d)) best = { axis: "u", t: r.t, d: r.d };
    }
    // Columns (vertical lines, u fixed): the nearest point's v is where a ROW goes.
    for (const ku of m.ku) {
      const pts = ts.map((t) => this.toScreen(evalMesh(m, ku, t).pos));
      const r = this.nearestOnPolyline(p, pts, ts);
      if (r.d < LINE_HIT && (!best || r.d < best.d)) best = { axis: "v", t: r.t, d: r.d };
    }
    if (!best) return;
    const next = insertKnot(m, best.axis, best.t);
    if (!next) { this.setStatus("cannot split there"); return; }
    this.pushUndo();
    this.warp.setMesh(next);
    this.saveMesh();
    if (this.mode !== "mesh") this.setMode("mesh");
    this.setStatus(best.axis === "u" ? "column added" : "row added");
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isEditing()) return;
    if (e.key === "Tab") {
      e.preventDefault();
      this.setMode(this.mode === "corners" ? "mesh" : "corners");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
    }
  };

  private attach(): void {
    this.glCanvas.addEventListener("mousedown", this.startDrag as EventListener, true);
    this.glCanvas.addEventListener("dblclick", this.onDblClick as EventListener, true);
    window.addEventListener("mousemove", this.moveDrag as EventListener);
    window.addEventListener("mouseup", this.endDrag);
    window.addEventListener("keydown", this.onKeyDown);
    this.glCanvas.addEventListener("touchstart", this.startDrag as EventListener, { capture: true, passive: false });
    window.addEventListener("touchmove", (e) => {
      if (this.dragCorner !== null || this.dragMesh || this.bodyDrag) { this.moveDrag(e); e.preventDefault(); }
    }, { passive: false });
    window.addEventListener("touchend", this.endDrag);
  }
}
