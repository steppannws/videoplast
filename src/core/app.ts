// Bootstrap: build the panel, construct the GL/render objects and the controllers,
// wire the background + canvas-sizing controls, then start the render loop. Each
// concern (effects, pins, IR calibration, sources) lives in its own controller.
import "../../styles/tokens.css";
import "../../styles/base.css";
import "../../styles/ui.css";
import { EFFECTS } from "../effects/registry.ts";
import { WarpGL } from "../gl/warp-gl.ts";
import { TouchEmitter } from "../sources/output.ts";
import { BackgroundCanvas } from "./background.ts";
import { bindNumber, bindBool, getSetting, saveSetting } from "../ui/persist.ts";
import { installOverlay } from "../ui/overlay.ts";
import { mountControls } from "../ui/controls-panel.ts";
import { EffectController } from "../ui/effect-controller.ts";
import { PinController } from "../ui/pin-controller.ts";
import { IrCalibrator } from "../ui/ir-calibrator.ts";
import { SourceManager } from "../sources/source-manager.ts";
import { startRenderLoop } from "./render-loop.ts";
import type { TouchEv } from "../types/index.ts";

// Build the control panel from config before any element lookups below.
mountControls(document.getElementById("ui") as HTMLElement);

const glCanvas = document.getElementById("glCanvas") as HTMLCanvasElement;
const pinCanvas = document.getElementById("pinCanvas") as HTMLCanvasElement | null;
const status = document.getElementById("status") as HTMLElement;
const setStatus = (s: string): void => { status.textContent = s; };
console.log("app boot");

const gl = glCanvas.getContext("webgl") as WebGLRenderingContext;
const bg = new BackgroundCanvas(glCanvas.width, glCanvas.height);
const warp = new WarpGL(gl, glCanvas.width, glCanvas.height);
const emitter = new TouchEmitter();

// --- canvas sizing ---------------------------------------------------------
let cw = glCanvas.width, ch = glCanvas.height;
let fitScreen = true;
function setCanvasSize(w: number, h: number): void {
  glCanvas.width = w; glCanvas.height = h;
  if (pinCanvas) { pinCanvas.width = w; pinCanvas.height = h; }
  bg.resize(w, h); warp.resize(w, h); gl.viewport(0, 0, w, h);
}
function fitToViewport(): void {
  if (!fitScreen) return;
  cw = window.innerWidth; ch = window.innerHeight;
  setCanvasSize(cw, ch);
}
window.addEventListener("resize", fitToViewport);
document.addEventListener("fullscreenchange", fitToViewport);

// --- controllers -----------------------------------------------------------
const effect = new EffectController(
  gl,
  document.getElementById("effectParams") as HTMLElement,
  document.getElementById("effectSel") as HTMLSelectElement | null,
  setStatus,
);
const pins = new PinController(glCanvas, pinCanvas, warp, setStatus);
const calibrator = new IrCalibrator(
  document.getElementById("irPreview") as HTMLCanvasElement | null,
  document.getElementById("irMaskPreview") as HTMLCanvasElement | null,
  () => sources.getIrSrc(),
  setStatus,
);
const emitTouch = (ev: TouchEv): void => { effect.active.addTouch(ev); emitter.send(ev); };
const sources = new SourceManager({ glCanvas, emitTouch, setStatus, calibrate: (src) => calibrator.attach(src) });

// --- background + canvas controls -----------------------------------------
const bgFile = document.getElementById("bgFile") as HTMLInputElement | null;
if (bgFile) bgFile.addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) bg.loadFile(f);
});
const bgClear = document.getElementById("bgClear") as HTMLElement | null;
if (bgClear) bgClear.onclick = () => bg.clear();

bindNumber("imgScaleX", (n) => bg.setTransform({ scaleX: n }), (n) => n.toFixed(1) + "x");
bindNumber("imgScaleY", (n) => bg.setTransform({ scaleY: n }), (n) => n.toFixed(1) + "x");
bindNumber("imgRot", (n) => bg.setTransform({ rot: n }), (n) => String(Math.round(n)));
bindNumber("canvasW", (n) => { if (fitScreen) return; cw = n; setCanvasSize(cw, ch); }, (n) => Math.round(n) + "px", (s) => parseInt(s, 10));
bindNumber("canvasH", (n) => { if (fitScreen) return; ch = n; setCanvasSize(cw, ch); }, (n) => Math.round(n) + "px", (s) => parseInt(s, 10));
bindBool("fitScreen", (b) => {
  fitScreen = b;
  if (fitScreen) { fitToViewport(); return; }
  cw = parseInt((document.getElementById("canvasW") as HTMLInputElement).value, 10);
  ch = parseInt((document.getElementById("canvasH") as HTMLInputElement).value, 10);
  setCanvasSize(cw, ch);
});

// --- wiring ----------------------------------------------------------------
pins.wire();
calibrator.wire();

installOverlay({
  panel: document.getElementById("ui") as HTMLElement,
  body: document.body,
  isEditing: () => { const a = document.activeElement; return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT"); },
  onNudge: (axis, dir, shift) => pins.nudge(axis, dir, shift),
  onToggleGrid: () => { const c = document.getElementById("grid") as HTMLInputElement | null; if (c) c.click(); },
  onSelectEffect: (index) => { const e = EFFECTS[index]; if (e) effect.set(e.id); },
  persist: saveSetting,
  initialHidden: getSetting("uiHidden") === true,
});

// Effect must boot (assign `active`) before a source can emit touches.
effect.init();
sources.wire();

setStatus(`canvas ${glCanvas.width}x${glCanvas.height} ready`);
startRenderLoop({ bg, warp, getActive: () => effect.active, drawOverlay: () => pins.draw() });
