// Pure geometry for the media warp: a 4×4 control-point grid evaluated as a bicubic
// Catmull-Rom surface, plus small helpers used by the overlay (hit-test, move, scale).
import { clamp } from "../util/math.ts";
import type { Pt } from "./homography.ts";
import type { PinKey } from "../types/index.ts";

export type Corners = Record<PinKey, { x: number; y: number }>;

// 16 control points, indexed idx(i,j) = j*4 + i  (i = column/x 0..3, j = row/y 0..3).
export type Grid = Pt[];
export const gridIdx = (i: number, j: number): number => j * 4 + i;

// One-dimensional Catmull-Rom on the segment p1→p2 (p0,p3 are the neighbours).
function cr1(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  return { x: cr1(p0.x, p1.x, p2.x, p3.x, t), y: cr1(p0.y, p1.y, p2.y, p3.y, t) };
}

// Evaluate the bicubic Catmull-Rom surface at (u,v) ∈ [0,1]². Passes through the control
// points; column/row neighbours are clamped to [0,3] at the boundaries.
export function evalGrid(g: Grid, u: number, v: number): Pt {
  const fu = u * 3, ci = clamp(Math.floor(fu), 0, 2), tu = fu - ci;
  const fv = v * 3, rj = clamp(Math.floor(fv), 0, 2), tv = fv - rj;
  const cols = [clamp(ci - 1, 0, 3), ci, ci + 1, clamp(ci + 2, 0, 3)];
  const rows = [clamp(rj - 1, 0, 3), rj, rj + 1, clamp(rj + 2, 0, 3)];
  const rowPts: Pt[] = [];
  for (let r = 0; r < 4; r++) {
    const j = rows[r];
    rowPts.push(catmullRom(g[gridIdx(cols[0], j)], g[gridIdx(cols[1], j)], g[gridIdx(cols[2], j)], g[gridIdx(cols[3], j)], tu));
  }
  return catmullRom(rowPts[0], rowPts[1], rowPts[2], rowPts[3], tv);
}

// Regular 4×4 grid over a w×h rectangle (identity warp).
export function baseGrid(w: number, h: number): Grid {
  const g: Grid = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) g.push({ x: (i / 3) * w, y: (j / 3) * h });
  return g;
}

// Apply 16 per-point offsets to the base grid.
export function gridFromOffsets(off: Pt[], w: number, h: number): Grid {
  return baseGrid(w, h).map((p, k) => ({ x: p.x + off[k].x, y: p.y + off[k].y }));
}

// Index of the control point nearest to (px,py).
export function nearestPoint(px: number, py: number, g: Grid): number {
  let best = 0, bd = Infinity;
  for (let k = 0; k < g.length; k++) {
    const d = (g[k].x - px) ** 2 + (g[k].y - py) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

export function centroidOf(g: Grid): Pt {
  let sx = 0, sy = 0;
  for (const p of g) { sx += p.x; sy += p.y; }
  return { x: sx / g.length, y: sy / g.length };
}

// Scale every point about a centre by `factor`.
export function scalePoints(g: Grid, factor: number, ctr: Pt): Grid {
  return g.map((p) => ({ x: ctr.x + (p.x - ctr.x) * factor, y: ctr.y + (p.y - ctr.y) * factor }));
}

// Convex point-in-polygon over the ordered corners; boundary counts as inside.
export function pointInQuad(px: number, py: number, c: Corners): boolean {
  const pts = [c.tl, c.tr, c.br, c.bl];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
