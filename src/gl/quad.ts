// Pure geometry for the two-layer warp.
// Layer 2 lives here: a control mesh in unit-square space with non-uniform knots,
// evaluated as an index-space Catmull-Rom surface for position AND texture-uv (the
// same operator for both, so the identity mesh maps (u,v)->(u,v) exactly regardless
// of knot spacing). Layer 1 (the corner homography) lives in warp-gl.ts.
import { clamp } from "../util/math.ts";
import type { Pt } from "./homography.ts";
import type { PinKey } from "../types/index.ts";

export type Corners = Record<PinKey, { x: number; y: number }>;

export const MESH_MIN = 4, MESH_MAX = 8, KNOT_EPS = 0.04;

// off[j][i] = unit-space offset of the control point at column i (knot ku[i]) and
// row j (knot kv[j]). All-zero offsets = identity (flat unit square).
export interface MeshState { ku: number[]; kv: number[]; off: Pt[][] }

export function defaultMesh(): MeshState {
  const k = [0, 1 / 3, 2 / 3, 1];
  return { ku: [...k], kv: [...k], off: k.map(() => k.map(() => ({ x: 0, y: 0 }))) };
}

export const cloneMesh = (m: MeshState): MeshState =>
  ({ ku: [...m.ku], kv: [...m.kv], off: m.off.map((r) => r.map((p) => ({ ...p }))) });

// Segment index s such that knots[s] <= t < knots[s+1], clamped to a valid segment.
function seg(knots: number[], t: number): number {
  for (let i = 0; i < knots.length - 1; i++) if (t < knots[i + 1]) return i;
  return knots.length - 2;
}

// Non-uniform Catmull-Rom (Hermite form, finite-difference tangents parameterized by
// the knot values) across a full row/column of points, evaluated at global param t
// inside segment s. Exactly linear for identity data (pts[i] tracks knots[i]) at ANY
// knot spacing — the property that keeps the un-warped image undistorted.
function crAxis(pts: Pt[], knots: number[], s: number, t: number): Pt {
  const n = pts.length;
  const B = pts[s], C = pts[s + 1];
  const kb = knots[s], kc = knots[s + 1];
  const h = kc - kb;
  const lt = (t - kb) / h;
  const oneSided = { x: (C.x - B.x) / h, y: (C.y - B.y) / h };
  const tb = s > 0
    ? { x: (C.x - pts[s - 1].x) / (kc - knots[s - 1]), y: (C.y - pts[s - 1].y) / (kc - knots[s - 1]) }
    : oneSided;
  const tc = s + 2 < n
    ? { x: (pts[s + 2].x - B.x) / (knots[s + 2] - kb), y: (pts[s + 2].y - B.y) / (knots[s + 2] - kb) }
    : oneSided;
  const t2 = lt * lt, t3 = t2 * lt;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + lt, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return {
    x: h00 * B.x + h10 * h * tb.x + h01 * C.x + h11 * h * tc.x,
    y: h00 * B.y + h10 * h * tb.y + h01 * C.y + h11 * h * tc.y,
  };
}

// Evaluate surface position and texture-uv at (u,v) ∈ [0,1]².
export function evalMesh(m: MeshState, u: number, v: number): { pos: Pt; uv: Pt } {
  const si = seg(m.ku, u), sj = seg(m.kv, v);
  // Interpolate each involved row along u, then interpolate the results along v.
  // Row results are parameterized by kv (the row knots) for the second pass.
  const colPos: Pt[] = [], colUv: Pt[] = [];
  for (let j = 0; j < m.kv.length; j++) {
    const pos: Pt[] = m.ku.map((k, i) => ({ x: k + m.off[j][i].x, y: m.kv[j] + m.off[j][i].y }));
    const uv: Pt[] = m.ku.map((k) => ({ x: k, y: m.kv[j] }));
    colPos.push(crAxis(pos, m.ku, si, u));
    colUv.push(crAxis(uv, m.ku, si, u));
  }
  return { pos: crAxis(colPos, m.kv, sj, v), uv: crAxis(colUv, m.kv, sj, v) };
}

// Insert a knot at t; the new line's control points are sampled from the current
// surface so the shape is preserved at the sampled positions. Null when at the cap,
// out of range, or within KNOT_EPS of an existing knot.
export function insertKnot(m: MeshState, axis: "u" | "v", t: number): MeshState | null {
  const knots = axis === "u" ? m.ku : m.kv;
  if (knots.length >= MESH_MAX) return null;
  if (t <= 0 || t >= 1 || knots.some((k) => Math.abs(k - t) < KNOT_EPS)) return null;
  const pos = knots.findIndex((k) => k > t);
  const n = cloneMesh(m);
  if (axis === "u") {
    n.ku.splice(pos, 0, t);
    for (let j = 0; j < n.kv.length; j++) {
      const s = evalMesh(m, t, m.kv[j]).pos;
      n.off[j].splice(pos, 0, { x: s.x - t, y: s.y - m.kv[j] });
    }
  } else {
    n.kv.splice(pos, 0, t);
    const row = n.ku.map((k) => {
      const s = evalMesh(m, k, t).pos;
      return { x: s.x - k, y: s.y - t };
    });
    n.off.splice(pos, 0, row);
  }
  return n;
}

// Remove an interior knot (ends pinned, floor MESH_MIN). Null when not allowed.
export function removeKnot(m: MeshState, axis: "u" | "v", index: number): MeshState | null {
  const knots = axis === "u" ? m.ku : m.kv;
  if (knots.length <= MESH_MIN) return null;
  if (index <= 0 || index >= knots.length - 1) return null;
  const n = cloneMesh(m);
  if (axis === "u") { n.ku.splice(index, 1); for (const r of n.off) r.splice(index, 1); }
  else { n.kv.splice(index, 1); n.off.splice(index, 1); }
  return n;
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
