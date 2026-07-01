// Pure geometry on the corner-pin quad (ordered tl, tr, br, bl).
import { clamp } from "../util/math.ts";
import type { Pt } from "./homography.ts";
import type { PinKey } from "../types/index.ts";

export type Corners = Record<PinKey, { x: number; y: number }>;

export function centroid(c: Corners): { x: number; y: number } {
  return {
    x: (c.tl.x + c.tr.x + c.br.x + c.bl.x) / 4,
    y: (c.tl.y + c.tr.y + c.br.y + c.bl.y) / 4,
  };
}

// Scale every corner about the centroid by `factor`.
export function scaleCorners(c: Corners, factor: number): Corners {
  const ctr = centroid(c);
  const f = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: ctr.x + (p.x - ctr.x) * factor,
    y: ctr.y + (p.y - ctr.y) * factor,
  });
  return { tl: f(c.tl), tr: f(c.tr), br: f(c.br), bl: f(c.bl) };
}

// Linear interpolation between two points.
export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// The 4 corners plus the two mid-edge seam points (top-center, bottom-center).
export type Mesh = Corners & { tc: Pt; bc: Pt };

// Add the seam points at parameter tTop/tBottom along the top (tl→tr) and bottom (bl→br) edges.
export function meshPoints(c: Corners, tTop: number, tBottom: number): Mesh {
  return { ...c, tc: lerpPt(c.tl, c.tr, tTop), bc: lerpPt(c.bl, c.br, tBottom) };
}

export interface Quad { src: Pt[]; dst: Pt[] }

// Split the mesh into two perspective columns at the SOURCE midline x=w/2.
// Corners are ordered [TL, TR, BR, BL] of each column (matching computeH's src/dst order).
export function columnQuads(m: Mesh, w: number, h: number): { left: Quad; right: Quad } {
  const hw = w / 2;
  return {
    left: {
      src: [{ x: 0, y: 0 }, { x: hw, y: 0 }, { x: hw, y: h }, { x: 0, y: h }],
      dst: [m.tl, m.tc, m.bc, m.bl],
    },
    right: {
      src: [{ x: hw, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: hw, y: h }],
      dst: [m.tc, m.tr, m.br, m.bc],
    },
  };
}

// Parameter t of the pointer projected onto segment a→b, clamped to avoid a degenerate column.
export function paramOnEdge(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0.5;
  const t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  return clamp(t, 0.02, 0.98);
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
