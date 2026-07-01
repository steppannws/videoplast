// Pure geometry on the corner-pin quad (ordered tl, tr, br, bl).
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
