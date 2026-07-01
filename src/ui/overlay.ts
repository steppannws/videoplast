// src/ui/overlay.ts
// Projection-mode overlay + keyboard layer. Pure helpers are exported for unit tests;
// installOverlay() keyboard/DOM wiring takes its app hooks as callbacks.
import { clamp } from "../util/math.ts";
import { PIN_LIMIT } from "../config/controls.ts";
import type { Axis } from "../types/index.ts";

export const clampPin = (v: number): number => clamp(v, -PIN_LIMIT, PIN_LIMIT);

// Pure: new offset for one axis after an arrow nudge.
// dir: -1 or +1. shift: true => 10px step, else 1px. Result clamped to ±PIN_LIMIT.
export function nudgeAxis(value: number, dir: -1 | 1, shift: boolean): number {
  return clampPin(value + dir * (shift ? 10 : 1));
}

// Pure: grid geometry for a canvas of size w×h with the given line spacing.
export function gridLines(w: number, h: number, spacing: number): {
  verticals: number[]; horizontals: number[]; cx: number; cy: number; corners: [number, number][];
} {
  const verticals: number[] = [], horizontals: number[] = [];
  for (let x = 0; x <= w; x += spacing) verticals.push(x);
  for (let y = 0; y <= h; y += spacing) horizontals.push(y);
  return { verticals, horizontals, cx: w / 2, cy: h / 2,
           corners: [[0, 0], [w, 0], [w, h], [0, h]] as [number, number][] };
}

// Draw the calibration grid (faint lines + center cross + corner squares) onto a 2D ctx.
export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, spacing: number): void {
  const g = gridLines(w, h, spacing);
  ctx.save();
  ctx.strokeStyle = "rgba(0,200,255,0.25)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of g.verticals) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (const y of g.horizontals) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,200,255,0.7)"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(g.cx, 0); ctx.lineTo(g.cx, h);
  ctx.moveTo(0, g.cy); ctx.lineTo(w, g.cy);
  ctx.stroke();
  ctx.fillStyle = "rgba(0,200,255,0.9)";
  for (const [x, y] of g.corners) ctx.fillRect(x - 4, y - 4, 8, 8);
  ctx.restore();
}

const ARROW: Record<string, [Axis, -1 | 1]> = {
  ArrowLeft: ["x", -1], ArrowRight: ["x", 1], ArrowUp: ["y", -1], ArrowDown: ["y", 1],
};

// Pure: map a keydown key to a zero-based effect index for keys "1".."9", else null.
export function effectKeyIndex(key: string): number | null {
  if (key.length === 1 && key >= "1" && key <= "9") return key.charCodeAt(0) - 49;
  return null;
}

export interface InstallOverlayOpts {
  panel: HTMLElement;
  body: HTMLElement;
  isEditing: () => boolean;
  onNudge: (axis: Axis, dir: -1 | 1, shift: boolean) => void;
  onToggleGrid: () => void;
  onToggleWarp?: () => void;
  onSelectEffect?: (index: number) => void;
  persist: (key: string, value: unknown) => void;
  initialHidden: boolean;
  idleMs?: number;
}

// Wire global projection keys. App hooks are injected so this stays DOM-light.
export function installOverlay(opts: InstallOverlayOpts): void {
  const { panel, body, isEditing, onNudge, onToggleGrid, onToggleWarp, onSelectEffect, persist, initialHidden, idleMs = 15000 } = opts;
  let hidden = !!initialHidden;
  const applyHidden = () => { panel.classList.toggle("hidden", hidden); };  // cursor handled by idle timer below
  applyHidden();

  // Cursor: always visible while the mouse moves; auto-hide after idleMs of stillness, wake on the next move.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const hideCursor = () => { body.style.cursor = "none"; };
  const wakeCursor = () => {
    body.style.cursor = "";
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(hideCursor, idleMs);
  };
  window.addEventListener("mousemove", wakeCursor);
  wakeCursor();  // start visible, arm the idle countdown

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") { hidden = false; applyHidden(); persist("uiHidden", false); return; }
    if (isEditing()) return;
    const fxIdx = effectKeyIndex(e.key);
    if (fxIdx !== null) { if (onSelectEffect) onSelectEffect(fxIdx); return; }
    const k = e.key.toLowerCase();
    if (k === "h") { hidden = !hidden; applyHidden(); persist("uiHidden", hidden); }
    else if (k === "f") { toggleFullscreen(); }
    else if (k === "g") { onToggleGrid(); }
    else if (k === "w") { if (onToggleWarp) onToggleWarp(); }
    else if (ARROW[e.key]) { e.preventDefault(); const [axis, dir] = ARROW[e.key]; onNudge(axis, dir, e.shiftKey); }
  });
}
