import { EFFECTS, DEFAULT_EFFECT, effectById } from "./effects.ts";
import { WarpGL } from "./warp-gl.ts";
import { MouseTouchSource } from "./touch-source.ts";
import { TouchEmitter } from "./output.ts";
import { LeapImageSource } from "./leap-image-source.ts";
import { LeapZSource } from "./leap-z-source.ts";
import { BackgroundCanvas } from "./background.ts";
import { bindControl, getSetting, saveSetting } from "./persist.ts";
import { installOverlay, nudgeAxis, drawGrid } from "./ui-overlay.ts";
import type { TouchEv, Effect } from "./types.ts";

const glCanvas = document.getElementById("glCanvas") as HTMLCanvasElement;
const pinCanvas = document.getElementById("pinCanvas") as HTMLCanvasElement | null;
const pinCtx = pinCanvas ? pinCanvas.getContext("2d") : null;
const status = document.getElementById("status") as HTMLElement;
console.log("app boot");

const gl = glCanvas.getContext("webgl") as WebGLRenderingContext;
const bg = new BackgroundCanvas(glCanvas.width, glCanvas.height);

// --- Effect selection ------------------------------------------------------
const fxCache = new Map<string, Effect>();
let active!: Effect;

function getEffect(id: string): Effect {
  let fx = fxCache.get(id);
  if (!fx) {
    const entry = effectById(id);
    if (!entry) throw new Error("unknown effect: " + id);
    fx = entry.make(gl);
    fxCache.set(id, fx);
  }
  return fx;
}

const fxDecimals = (step: number): number => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);

// Build the dynamic param sliders for the active effect. Element ids are
// `fx.<id>.<key>` so bindControl persists each under that key automatically.
function buildEffectParams(fx: Effect, id: string): void {
  const host = document.getElementById("effectParams");
  if (!host) return;
  host.innerHTML = "";
  for (const p of fx.params) {
    const elemId = `fx.${id}.${p.key}`;
    const ctrl = document.createElement("div");
    ctrl.className = "ctrl";
    const label = document.createElement("label");
    label.textContent = p.label;
    const input = document.createElement("input");
    input.type = "range"; input.id = elemId;
    input.min = String(p.min); input.max = String(p.max); input.step = String(p.step);
    input.value = String(p.default);
    const val = document.createElement("span");
    val.className = "val"; val.id = elemId + "v";
    ctrl.append(label, input, val);
    host.appendChild(ctrl);
    const d = fxDecimals(p.step);
    bindControl(elemId, (v) => fx.setParam(p.key, parseFloat(String(v))), (v) => (+parseFloat(String(v))).toFixed(d));
  }
}

function setEffect(id: string): void {
  const entry = effectById(id);
  if (!entry) return;
  try { active = getEffect(id); }
  catch (e) { status.textContent = "effect failed: " + (e as Error).message; return; }
  saveSetting("fx.active", id);
  const sel = document.getElementById("effectSel") as HTMLSelectElement | null;
  if (sel && sel.value !== id) sel.value = id;
  buildEffectParams(active, id);
  status.textContent = "effect: " + entry.label;
}
const warp = new WarpGL(gl, glCanvas.width, glCanvas.height);
const emitter = new TouchEmitter();
const mouse = new MouseTouchSource(glCanvas);

const detOpt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
const undistOpt = { on: false, k1: -0.3, k2: 0 };
const mirrorOpt = { x: false, y: false };

let current: MouseTouchSource | LeapImageSource | LeapZSource | null = null;
let leapSrc: LeapImageSource | null = null;

function wire(src: MouseTouchSource | LeapImageSource | LeapZSource) {
  src.onTouch((ev: TouchEv) => {
    active.addTouch(ev);
    emitter.send(ev);
  });
}

function setCanvasSize(w: number, h: number) {
  glCanvas.width = w;
  glCanvas.height = h;
  if (pinCanvas) {
    pinCanvas.width = w;
    pinCanvas.height = h;
  }
  bg.resize(w, h);
  warp.resize(w, h);
  gl.viewport(0, 0, w, h);
}

let cw = glCanvas.width, ch = glCanvas.height;

let fitScreen = true;

function fitToViewport() {
  if (!fitScreen) return;
  cw = window.innerWidth;
  ch = window.innerHeight;
  setCanvasSize(cw, ch);
}

window.addEventListener("resize", fitToViewport);
document.addEventListener("fullscreenchange", fitToViewport);

const PIN_HIT = 26;

function drawPins() {
  if (!pinCtx) return;
  pinCtx.clearRect(0, 0, pinCanvas!.width, pinCanvas!.height);
  if (gridOn) drawGrid(pinCtx, pinCanvas!.width, pinCanvas!.height, 50);
  const pp = warp.cornerPositions();
  const labels: Record<string, string> = { tl: "TL", tr: "TR", br: "BR", bl: "BL" };
  for (const k of ["tl", "tr", "br", "bl"]) {
    const p = pp[k as keyof typeof pp];
    const sel = k === selectedPin;
    pinCtx.save();
    pinCtx.strokeStyle = sel ? "rgba(0,255,140,0.95)" : "rgba(255,255,255,0.65)";
    pinCtx.fillStyle = "rgba(0,0,0,0.55)";
    pinCtx.lineWidth = sel ? 2.5 : 1.5;
    pinCtx.beginPath();
    pinCtx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    pinCtx.fill();
    pinCtx.stroke();
    pinCtx.beginPath();
    pinCtx.moveTo(p.x - 10, p.y);
    pinCtx.lineTo(p.x + 10, p.y);
    pinCtx.moveTo(p.x, p.y - 10);
    pinCtx.lineTo(p.x, p.y + 10);
    pinCtx.stroke();
    pinCtx.fillStyle = sel ? "rgba(0,255,140,0.9)" : "rgba(255,255,255,0.6)";
    pinCtx.font = "10px monospace";
    pinCtx.textAlign = "center";
    pinCtx.fillText(labels[k], p.x, p.y - 22);
    pinCtx.restore();
  }
}

let pinDrag: string | null = null;
let selectedPin: string | null = null;
let gridOn = false;

function canvasPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
  const r = glCanvas.getBoundingClientRect();
  const sx = glCanvas.width / r.width,
    sy = glCanvas.height / r.height;
  const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
  const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
  return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
}

function nearPin(px: number, py: number): string | null {
  const pp = warp.cornerPositions();
  for (const k of ["tl", "tr", "br", "bl"]) {
    const key = k as keyof typeof pp;
    if (Math.hypot(px - pp[key].x, py - pp[key].y) < PIN_HIT) return k;
  }
  return null;
}

function baseCorner(k: string): { x: number; y: number } {
  const corners: Record<string, { x: number; y: number }> = {
    tl: { x: 0, y: 0 },
    tr: { x: warp.w, y: 0 },
    br: { x: warp.w, y: warp.h },
    bl: { x: 0, y: warp.h },
  };
  return corners[k];
}

const clampOff = (v: number) => Math.max(-400, Math.min(400, v));

function syncPinSlider(k: string, axis: string, val: number) {
  const id = k + axis;
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) {
    el.value = String(val);
    const r = document.getElementById(id + "v");
    if (r) r.textContent = Math.round(val) + "px";
  }
  warp.setPinOffset(k as "tl" | "tr" | "br" | "bl", axis as "x" | "y", val);
  saveSetting(id, String(val));
}

function startPinDrag(e: MouseEvent | TouchEvent) {
  const p = canvasPos(e);
  const k = nearPin(p.x, p.y);
  if (k) {
    selectedPin = k;
    pinDrag = k;
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}

function movePinDrag(e: MouseEvent | TouchEvent) {
  if (!pinDrag) return;
  const p = canvasPos(e);
  const b = baseCorner(pinDrag);
  syncPinSlider(pinDrag, "x", clampOff(p.x - b.x));
  syncPinSlider(pinDrag, "y", clampOff(p.y - b.y));
}

glCanvas.addEventListener("mousedown", startPinDrag as EventListener, true);
window.addEventListener("mousemove", movePinDrag as EventListener);
window.addEventListener("mouseup", () => {
  pinDrag = null;
});
glCanvas.addEventListener("touchstart", startPinDrag as EventListener, { capture: true, passive: false });
window.addEventListener(
  "touchmove",
  (e) => {
    if (pinDrag) {
      movePinDrag(e);
      e.preventDefault();
    }
  },
  { passive: false }
);
window.addEventListener("touchend", () => {
  pinDrag = null;
});

const irPreview = document.getElementById("irPreview") as HTMLCanvasElement | null;
const irCtx = irPreview ? irPreview.getContext("2d") : null;

function drawRoi(roi: { x: number; y: number; w: number; h: number }, w: number, h: number) {
  if (!irCtx) return;
  const rx = roi.x * w,
    ry = roi.y * h,
    rw = roi.w * w,
    rh = roi.h * h;
  irCtx.save();
  irCtx.fillStyle = "rgba(0,0,0,0.45)";
  irCtx.beginPath();
  irCtx.rect(0, 0, w, h);
  irCtx.rect(rx, ry, rw, rh);
  irCtx.fill("evenodd");
  irCtx.restore();
  irCtx.strokeStyle = "#0f0";
  irCtx.lineWidth = 2;
  irCtx.strokeRect(rx, ry, rw, rh);
  const hs = 10;
  irCtx.fillStyle = "#0f0";
  for (const [hx, hy] of [
    [rx, ry],
    [rx + rw, ry],
    [rx + rw, ry + rh],
    [rx, ry + rh],
  ]) {
    irCtx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
  }
}

function drawPreview(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  blobs: Array<{ cx: number; cy: number }>,
  roi?: { x: number; y: number; w: number; h: number }
) {
  if (!irCtx) return;
  if (irPreview!.width !== w || irPreview!.height !== h) {
    irPreview!.width = w;
    irPreview!.height = h;
  }
  const img = irCtx.createImageData(w, h);
  img.data.set(rgba);
  irCtx.putImageData(img, 0, 0);
  irCtx.strokeStyle = "#0f0";
  irCtx.lineWidth = 1;
  for (const b of blobs) irCtx.strokeRect(b.cx - 3, b.cy - 3, 6, 6);
  if (roi) drawRoi(roi, w, h);
}

function attachLeapCalib(src: LeapImageSource) {
  src.previewCb = (rgba: Uint8ClampedArray, w: number, h: number, blobs) => drawPreview(rgba, w, h, blobs, src.roi);
}

let dragCorner: string | null = null;

function roiCorners(roi: { x: number; y: number; w: number; h: number }) {
  return {
    tl: [roi.x, roi.y],
    tr: [roi.x + roi.w, roi.y],
    br: [roi.x + roi.w, roi.y + roi.h],
    bl: [roi.x, roi.y + roi.h],
  };
}

function previewNorm(e: MouseEvent): [number, number] {
  const r = irPreview!.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}

if (irPreview) {
  irPreview.addEventListener("mousedown", (e) => {
    if (!leapSrc) return;
    const [nx, ny] = previewNorm(e as MouseEvent);
    const hit = Object.entries(roiCorners(leapSrc.roi)).find(
      ([, [cx, cy]]) => Math.abs(cx - nx) < 0.04 && Math.abs(cy - ny) < 0.04
    );
    if (hit) dragCorner = hit[0];
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragCorner || !leapSrc) return;
    let [nx, ny] = previewNorm(e as MouseEvent);
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));
    const roi = leapSrc.roi;
    let x0 = roi.x,
      y0 = roi.y,
      x1 = roi.x + roi.w,
      y1 = roi.y + roi.h;
    if (dragCorner === "tl") {
      x0 = nx;
      y0 = ny;
    } else if (dragCorner === "tr") {
      x1 = nx;
      y0 = ny;
    } else if (dragCorner === "br") {
      x1 = nx;
      y1 = ny;
    } else if (dragCorner === "bl") {
      x0 = nx;
      y1 = ny;
    }
    const MIN = 0.05;
    if (x1 - x0 < MIN || y1 - y0 < MIN) return;
    leapSrc.setRoi({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  });

  window.addEventListener("mouseup", () => {
    if (dragCorner && leapSrc) saveSetting("roi", leapSrc.roi);
    dragCorner = null;
  });
}

const captureBgBtn = document.getElementById("captureBg") as HTMLElement | null;
if (captureBgBtn)
  captureBgBtn.onclick = () => {
    if (leapSrc) {
      leapSrc.captureBackground();
      status.textContent = "background captured";
    }
  };

const resetZoneBtn = document.getElementById("resetZone") as HTMLElement | null;
if (resetZoneBtn)
  resetZoneBtn.onclick = () => {
    if (leapSrc) {
      leapSrc.setRoi({ x: 0, y: 0, w: 1, h: 1 });
      saveSetting("roi", leapSrc.roi);
      status.textContent = "zone reset";
    }
  };

const restartIrBtn = document.getElementById("restartIr") as HTMLElement | null;
if (restartIrBtn)
  restartIrBtn.onclick = () => {
    if (leapSrc) {
      leapSrc.restart();
      status.textContent = "IR restarting";
    }
  };

function setSource(name: string) {
  if (current) current.stop();
  leapSrc = null;
  if (name === "mouse") {
    current = mouse;
  } else if (name === "leap-ir") {
    current = new LeapImageSource();
    leapSrc = current;
    Object.assign(leapSrc.opt, detOpt);
    Object.assign(leapSrc.undist, undistOpt);
    leapSrc.undist.map = null;
    Object.assign(leapSrc.mirror, mirrorOpt);
    const savedRoi = getSetting("roi") as { x: number; y: number; w: number; h: number } | null;
    if (savedRoi) leapSrc.setRoi(savedRoi);
    leapSrc.statusCb = (s) => {
      status.textContent = "IR: " + s;
    };
    attachLeapCalib(current);
  } else if (name === "leap-z") {
    current = new LeapZSource();
  }
  if (!current) return;
  wire(current);
  current.start();
  status.textContent = `source: ${name}`;
}

const bgFile = document.getElementById("bgFile") as HTMLInputElement | null;
if (bgFile)
  bgFile.addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) bg.loadFile(f);
  });

const bgClear = document.getElementById("bgClear") as HTMLElement | null;
if (bgClear) bgClear.onclick = () => bg.clear();

bindControl("imgScaleX", (v) => bg.setTransform({ scaleX: parseFloat(String(v)) }), (v) => (+parseFloat(String(v))).toFixed(1) + "x");
bindControl("imgScaleY", (v) => bg.setTransform({ scaleY: parseFloat(String(v)) }), (v) => (+parseFloat(String(v))).toFixed(1) + "x");
bindControl("imgRot", (v) => bg.setTransform({ rot: parseFloat(String(v)) }), (v) => String(Math.round(parseFloat(String(v)))));

bindControl(
  "canvasW",
  (v) => {
    if (fitScreen) return;
    cw = parseInt(String(v), 10);
    setCanvasSize(cw, ch);
  },
  (v) => Math.round(parseInt(String(v), 10)) + "px"
);
bindControl(
  "canvasH",
  (v) => {
    if (fitScreen) return;
    ch = parseInt(String(v), 10);
    setCanvasSize(cw, ch);
  },
  (v) => Math.round(parseInt(String(v), 10)) + "px"
);

const PIN_IDS: Array<[string, string, string]> = [
  ["tl", "x", "tlx"],
  ["tl", "y", "tly"],
  ["tr", "x", "trx"],
  ["tr", "y", "try"],
  ["br", "x", "brx"],
  ["br", "y", "bry"],
  ["bl", "x", "blx"],
  ["bl", "y", "bly"],
];

if (getSetting("pinSchema") !== "offset") {
  for (const [, , id] of PIN_IDS) saveSetting(id, "0");
  saveSetting("pinSchema", "offset");
}

for (const [k, axis, id] of PIN_IDS)
  bindControl(
    id,
    (v) => {
      warp.setPinOffset(k as "tl" | "tr" | "br" | "bl", axis as "x" | "y", parseFloat(String(v)));
    },
    (v) => Math.round(parseFloat(String(v))) + "px"
  );

const resetPinsBtn = document.getElementById("resetPins") as HTMLElement | null;
if (resetPinsBtn)
  resetPinsBtn.onclick = () => {
    for (const [k, axis] of PIN_IDS) syncPinSlider(k, axis, 0);
    status.textContent = "anchors reset";
  };

const DET: Array<[string, string, (v: string) => number]> = [
  ["threshold", "threshold", (v) => parseFloat(v)],
  ["minArea", "minArea", (v) => parseFloat(v)],
  ["maxArea", "maxArea", (v) => parseFloat(v)],
  ["blur", "blurAmt", (v) => parseInt(v, 10)],
  ["erosion", "erosionAmt", (v) => parseInt(v, 10)],
];

for (const [id, key, parse] of DET)
  bindControl(
    id,
    (v) => {
      const numVal = parse(String(v));
      if (key === "threshold" || key === "minArea" || key === "maxArea") {
        (detOpt as any)[key] = numVal;
        if (leapSrc) (leapSrc.opt as any)[key] = numVal;
      } else if (key === "blurAmt" || key === "erosionAmt") {
        (detOpt as any)[key] = numVal;
        if (leapSrc) (leapSrc.opt as any)[key] = numVal;
      }
    },
    (v) => String(Math.round(parse(String(v))))
  );

bindControl("invert", (v) => {
  detOpt.invert = Boolean(v);
  if (leapSrc) leapSrc.opt.invert = Boolean(v);
});
bindControl("mirrorX", (v) => {
  mirrorOpt.x = Boolean(v);
  if (leapSrc) leapSrc.mirror.x = Boolean(v);
});
bindControl("mirrorY", (v) => {
  mirrorOpt.y = Boolean(v);
  if (leapSrc) leapSrc.mirror.y = Boolean(v);
});
bindControl("undistort", (v) => {
  undistOpt.on = Boolean(v);
  if (leapSrc) {
    leapSrc.undist.on = Boolean(v);
    leapSrc.undist.map = null;
  }
});
bindControl(
  "undistK1",
  (v) => {
    undistOpt.k1 = parseFloat(String(v));
    if (leapSrc) {
      leapSrc.undist.k1 = undistOpt.k1;
      leapSrc.undist.map = null;
    }
  },
  (v) => (+parseFloat(String(v))).toFixed(2)
);
bindControl(
  "undistK2",
  (v) => {
    undistOpt.k2 = parseFloat(String(v));
    if (leapSrc) {
      leapSrc.undist.k2 = undistOpt.k2;
      leapSrc.undist.map = null;
    }
  },
  (v) => (+parseFloat(String(v))).toFixed(2)
);

bindControl("grid", (v) => {
  gridOn = Boolean(v);
});
bindControl("fitScreen", (v) => {
  fitScreen = Boolean(v);
  if (fitScreen) {
    fitToViewport();
  } else {
    cw = parseInt((document.getElementById("canvasW") as HTMLInputElement).value, 10);
    ch = parseInt((document.getElementById("canvasH") as HTMLInputElement).value, 10);
    setCanvasSize(cw, ch);
  }
});

function nudgeSelected(axis: string, dir: -1 | 1, shift: boolean) {
  if (!selectedPin) return;
  const id = selectedPin + axis;
  const el = document.getElementById(id) as HTMLInputElement | null;
  const cur = el ? parseFloat(el.value) || 0 : 0;
  syncPinSlider(selectedPin, axis, nudgeAxis(cur, dir, shift));
}

installOverlay({
  panel: document.getElementById("ui") as HTMLElement,
  body: document.body,
  isEditing: () => {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT");
  },
  onNudge: nudgeSelected,
  onToggleGrid: () => {
    const c = document.getElementById("grid") as HTMLInputElement | null;
    if (c) c.click();
  },
  onSelectEffect: (index) => {
    const e = EFFECTS[index];
    if (e) setEffect(e.id);
  },
  persist: saveSetting,
  initialHidden: getSetting("uiHidden") === true,
});

// Effect dropdown + boot to the saved (or default) effect. Must run before the
// render loop and before a source can emit touches, so `active` is assigned.
const effectSel = document.getElementById("effectSel") as HTMLSelectElement | null;
if (effectSel) {
  effectSel.innerHTML = EFFECTS.map((e) => `<option value="${e.id}">${e.label}</option>`).join("");
  effectSel.addEventListener("change", () => setEffect(effectSel.value));
}
const savedFx = getSetting("fx.active");
setEffect(typeof savedFx === "string" && effectById(savedFx) ? savedFx : DEFAULT_EFFECT);

bindControl("sourceSel", (v) => setSource(String(v)));

status.textContent = `canvas ${glCanvas.width}x${glCanvas.height} ready`;

(function loop() {
  bg.draw();
  active.setBackground(bg.canvas);
  active.step();
  const tex = active.renderToTexture();
  warp.draw(tex);
  drawPins();
  requestAnimationFrame(loop);
})();
