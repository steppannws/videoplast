// videoplaster/js/ui-overlay.js
// Projection-mode overlay + keyboard layer. Pure helpers are exported for tests;
// installOverlay() is DOM-light and takes its app hooks as callbacks.

const PIN_MIN = -400, PIN_MAX = 400;
export const clampPin = (v) => Math.max(PIN_MIN, Math.min(PIN_MAX, v));

// Pure: new offset for one axis after an arrow nudge.
// dir: -1 or +1. shift: true => 10px step, else 1px. Result clamped to [-400,400].
export function nudgeAxis(value, dir, shift) {
  return clampPin(value + dir * (shift ? 10 : 1));
}

// Pure: grid geometry for a canvas of size w×h with the given line spacing.
export function gridLines(w, h, spacing) {
  const verticals = [], horizontals = [];
  for (let x = 0; x <= w; x += spacing) verticals.push(x);
  for (let y = 0; y <= h; y += spacing) horizontals.push(y);
  return { verticals, horizontals, cx: w / 2, cy: h / 2,
           corners: [[0, 0], [w, 0], [w, h], [0, h]] };
}

// Draw the calibration grid (faint lines + center cross + corner squares) onto a 2D ctx.
export function drawGrid(ctx, w, h, spacing) {
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

const ARROW = { ArrowLeft: ["x", -1], ArrowRight: ["x", 1], ArrowUp: ["y", -1], ArrowDown: ["y", 1] };

// Wire global projection keys. App hooks are injected so this stays DOM-light.
// opts: { panel, body, isEditing(), onNudge(axis,dir,shift), onToggleGrid(),
//         persist(key,val), initialHidden, idleMs }
export function installOverlay(opts) {
  const { panel, body, isEditing, onNudge, onToggleGrid, persist, initialHidden, idleMs = 15000 } = opts;
  let hidden = !!initialHidden;
  const applyHidden = () => { panel.classList.toggle("hidden", hidden); };  // cursor handled by idle timer below
  applyHidden();

  // Cursor: always visible while the mouse moves; auto-hide after idleMs of stillness, wake on the next move.
  let idleTimer = null;
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

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hidden = false; applyHidden(); persist("uiHidden", false); return; }
    if (isEditing()) return;
    const k = e.key.toLowerCase();
    if (k === "h") { hidden = !hidden; applyHidden(); persist("uiHidden", hidden); }
    else if (k === "f") { toggleFullscreen(); }
    else if (k === "g") { onToggleGrid(); }
    else if (ARROW[e.key]) { e.preventDefault(); const [axis, dir] = ARROW[e.key]; onNudge(axis, dir, e.shiftKey); }
  });
}
