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
  onSelectEffect?: (index: number) => void;
  persist: (key: string, value: unknown) => void;
  initialHidden: boolean;
  idleMs?: number;
}

// Wire global projection keys. App hooks are injected so this stays DOM-light.
// Warp-editing keys (Tab, Ctrl+Z) live in the PinController, not here.
export function installOverlay(opts: InstallOverlayOpts): void {
  const { panel, body, isEditing, onNudge, onSelectEffect, persist, initialHidden, idleMs = 15000 } = opts;
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
    else if (ARROW[e.key]) { e.preventDefault(); const [axis, dir] = ARROW[e.key]; onNudge(axis, dir, e.shiftKey); }
  });
}
