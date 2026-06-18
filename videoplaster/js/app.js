// videoplaster/js/app.js
import { WaterGL } from "./water-gl.js";
import { WarpGL } from "./warp-gl.js";
import { MouseTouchSource } from "./touch-source.js";
import { TouchEmitter } from "./output.js";
import { LeapImageSource } from "./leap-image-source.js";
import { LeapZSource } from "./leap-z-source.js";
import { BackgroundCanvas } from "./background.js";
import { bindControl, getSetting, saveSetting } from "./persist.js";

const glCanvas = document.getElementById("glCanvas");
const pinCanvas = document.getElementById("pinCanvas");
const pinCtx = pinCanvas ? pinCanvas.getContext("2d") : null;
const status = document.getElementById("status");
console.log("app boot");

const gl = glCanvas.getContext("webgl");
const water = new WaterGL(gl);
const bg = new BackgroundCanvas(glCanvas.width, glCanvas.height);
const warp = new WarpGL(gl, glCanvas.width, glCanvas.height);
const emitter = new TouchEmitter();
const mouse = new MouseTouchSource(glCanvas);

const detOpt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
const undistOpt = { on: false, k1: -0.3, k2: 0 };
const mirrorOpt = { x: false, y: false };

let current = null;
let leapSrc = null;

function wire(src){ src.onTouch(ev => { if (ev.state !== "up") water.addDrop(ev.x, ev.y, ev.strength); emitter.send(ev); }); }

// ---- canvas size ------------------------------------------------------------
function setCanvasSize(w, h){
  glCanvas.width = w; glCanvas.height = h;
  if (pinCanvas) { pinCanvas.width = w; pinCanvas.height = h; }
  bg.resize(w, h);
  warp.resize(w, h);
  gl.viewport(0, 0, w, h);
}
let cw = glCanvas.width, ch = glCanvas.height;

// ---- projection pin handles (overlay) + drag --------------------------------
const PIN_HIT = 18;
function drawPins(){
  if (!pinCtx) return;
  pinCtx.clearRect(0, 0, pinCanvas.width, pinCanvas.height);
  if (bg.hasMedia) return;                       // v11: hide handles over media
  const pp = warp.cornerPositions();
  const labels = { tl:"TL", tr:"TR", br:"BR", bl:"BL" };
  for (const k of ["tl","tr","br","bl"]){
    const p = pp[k];
    pinCtx.save();
    pinCtx.strokeStyle = "rgba(255,255,255,0.65)"; pinCtx.fillStyle = "rgba(0,0,0,0.55)"; pinCtx.lineWidth = 1.5;
    pinCtx.beginPath(); pinCtx.arc(p.x, p.y, 11, 0, Math.PI*2); pinCtx.fill(); pinCtx.stroke();
    pinCtx.beginPath(); pinCtx.moveTo(p.x-7, p.y); pinCtx.lineTo(p.x+7, p.y); pinCtx.moveTo(p.x, p.y-7); pinCtx.lineTo(p.x, p.y+7); pinCtx.stroke();
    pinCtx.fillStyle = "rgba(255,255,255,0.5)"; pinCtx.font = "8px monospace"; pinCtx.textAlign = "center";
    pinCtx.fillText(labels[k], p.x, p.y-16);
    pinCtx.restore();
  }
}
let pinDrag = null;
function canvasPos(e){
  const r = glCanvas.getBoundingClientRect();
  const sx = glCanvas.width / r.width, sy = glCanvas.height / r.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
}
function nearPin(px, py){
  const pp = warp.cornerPositions();
  for (const k of ["tl","tr","br","bl"]) if (Math.hypot(px - pp[k].x, py - pp[k].y) < PIN_HIT) return k;
  return null;
}
function baseCorner(k){ return ({ tl:{x:0,y:0}, tr:{x:warp.w,y:0}, br:{x:warp.w,y:warp.h}, bl:{x:0,y:warp.h} })[k]; }
const clampOff = (v) => Math.max(-400, Math.min(400, v));
function syncPinSlider(k, axis, val){
  const id = k + axis;                            // tl + x => "tlx"
  const el = document.getElementById(id);
  if (el){ el.value = val; const r = document.getElementById(id + "v"); if (r) r.textContent = Math.round(val) + "px"; }
  warp.setPinOffset(k, axis, val);
  saveSetting(id, String(val));
}
function startPinDrag(e){
  if (bg.hasMedia) return;
  const p = canvasPos(e), k = nearPin(p.x, p.y);
  if (k){ pinDrag = k; e.stopImmediatePropagation(); e.preventDefault(); }  // beat MouseTouchSource on glCanvas
}
function movePinDrag(e){
  if (!pinDrag) return;
  const p = canvasPos(e), b = baseCorner(pinDrag);
  syncPinSlider(pinDrag, "x", clampOff(p.x - b.x));
  syncPinSlider(pinDrag, "y", clampOff(p.y - b.y));
}
// capture phase so this runs before MouseTouchSource's (later-registered) bubble listener
glCanvas.addEventListener("mousedown", startPinDrag, true);
window.addEventListener("mousemove", movePinDrag);
window.addEventListener("mouseup", () => { pinDrag = null; });
glCanvas.addEventListener("touchstart", startPinDrag, { capture: true, passive: false });
window.addEventListener("touchmove", (e) => { if (pinDrag){ movePinDrag(e); e.preventDefault(); } }, { passive: false });
window.addEventListener("touchend", () => { pinDrag = null; });

// ---- IR preview + capture-zone overlay --------------------------------------
const irPreview = document.getElementById("irPreview");
const irCtx = irPreview ? irPreview.getContext("2d") : null;
function drawRoi(roi, w, h){
  const rx = roi.x*w, ry = roi.y*h, rw = roi.w*w, rh = roi.h*h;
  irCtx.save();
  irCtx.fillStyle = "rgba(0,0,0,0.45)";
  irCtx.beginPath(); irCtx.rect(0,0,w,h); irCtx.rect(rx,ry,rw,rh); irCtx.fill("evenodd");
  irCtx.restore();
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 2; irCtx.strokeRect(rx, ry, rw, rh);
  const hs = 10; irCtx.fillStyle = "#0f0";
  for (const [hx,hy] of [[rx,ry],[rx+rw,ry],[rx+rw,ry+rh],[rx,ry+rh]]) irCtx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
}
function drawPreview(rgba, w, h, blobs, roi){
  if (!irCtx) return;
  if (irPreview.width !== w || irPreview.height !== h) { irPreview.width = w; irPreview.height = h; }
  const img = irCtx.createImageData(w, h); img.data.set(rgba); irCtx.putImageData(img, 0, 0);
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 1;
  for (const b of blobs) irCtx.strokeRect(b.cx-3, b.cy-3, 6, 6);
  if (roi) drawRoi(roi, w, h);
}
function attachLeapCalib(src){ src.previewCb = (rgba, w, h, blobs) => drawPreview(rgba, w, h, blobs, src.roi); }
let dragCorner = null;
function roiCorners(roi){ return { tl:[roi.x,roi.y], tr:[roi.x+roi.w,roi.y], br:[roi.x+roi.w,roi.y+roi.h], bl:[roi.x,roi.y+roi.h] }; }
function previewNorm(e){ const r = irPreview.getBoundingClientRect(); return [ (e.clientX-r.left)/r.width, (e.clientY-r.top)/r.height ]; }
if (irPreview) {
  irPreview.addEventListener("mousedown", (e) => {
    if (!leapSrc) return;
    const [nx, ny] = previewNorm(e);
    const hit = Object.entries(roiCorners(leapSrc.roi)).find(([,[cx,cy]]) => Math.abs(cx-nx) < 0.04 && Math.abs(cy-ny) < 0.04);
    if (hit) dragCorner = hit[0];
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragCorner || !leapSrc) return;
    let [nx, ny] = previewNorm(e);
    nx = Math.max(0, Math.min(1, nx)); ny = Math.max(0, Math.min(1, ny));
    const roi = leapSrc.roi;
    let x0 = roi.x, y0 = roi.y, x1 = roi.x+roi.w, y1 = roi.y+roi.h;
    if (dragCorner === "tl") { x0 = nx; y0 = ny; } else if (dragCorner === "tr") { x1 = nx; y0 = ny; }
    else if (dragCorner === "br") { x1 = nx; y1 = ny; } else if (dragCorner === "bl") { x0 = nx; y1 = ny; }
    const MIN = 0.05; if (x1 - x0 < MIN || y1 - y0 < MIN) return;
    leapSrc.setRoi({ x:x0, y:y0, w:x1-x0, h:y1-y0 });
  });
  window.addEventListener("mouseup", () => { if (dragCorner && leapSrc) saveSetting("roi", leapSrc.roi); dragCorner = null; });
}
const captureBgBtn = document.getElementById("captureBg");
if (captureBgBtn) captureBgBtn.onclick = () => { if (leapSrc) { leapSrc.captureBackground(); status.textContent = "background captured"; } };
const resetZoneBtn = document.getElementById("resetZone");
if (resetZoneBtn) resetZoneBtn.onclick = () => { if (leapSrc) { leapSrc.setRoi({x:0,y:0,w:1,h:1}); saveSetting("roi", leapSrc.roi); status.textContent = "zone reset"; } };
const restartIrBtn = document.getElementById("restartIr");
if (restartIrBtn) restartIrBtn.onclick = () => { if (leapSrc) { leapSrc.restart(); status.textContent = "IR restarting"; } };

// ---- source selection -------------------------------------------------------
function setSource(name){
  if (current) current.stop();
  leapSrc = null;
  if (name === "mouse") { current = mouse; }
  else if (name === "leap-ir") {
    current = new LeapImageSource();
    leapSrc = current;
    Object.assign(leapSrc.opt, detOpt);
    Object.assign(leapSrc.undist, undistOpt); leapSrc.undist.map = null;
    Object.assign(leapSrc.mirror, mirrorOpt);
    const savedRoi = getSetting("roi"); if (savedRoi) leapSrc.setRoi(savedRoi);
    leapSrc.statusCb = (s) => { status.textContent = "IR: " + s; };
    attachLeapCalib(current);
  }
  else if (name === "leap-z") { current = new LeapZSource(); }
  if (!current) return;
  wire(current); current.start();
  status.textContent = `source: ${name}`;
}

// ---- background (image/video) controls --------------------------------------
const bgFile = document.getElementById("bgFile");
if (bgFile) bgFile.addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) bg.loadFile(f); });
const bgClear = document.getElementById("bgClear");
if (bgClear) bgClear.onclick = () => bg.clear();
bindControl("imgScaleX", v => bg.setTransform({ scaleX: parseFloat(v) }), v => (+v).toFixed(1) + "x");
bindControl("imgScaleY", v => bg.setTransform({ scaleY: parseFloat(v) }), v => (+v).toFixed(1) + "x");
bindControl("imgRot",    v => bg.setTransform({ rot: parseFloat(v) }),    v => String(Math.round(v)));

// ---- canvas size controls ---------------------------------------------------
bindControl("canvasW", v => { cw = parseInt(v,10); setCanvasSize(cw, ch); }, v => Math.round(v) + "px");
bindControl("canvasH", v => { ch = parseInt(v,10); setCanvasSize(cw, ch); }, v => Math.round(v) + "px");

// ---- projection pins (sliders, two-way with drag) ---------------------------
// Migration: pins changed from absolute destination coords to per-corner offsets
// (0px = no warp). Reset legacy persisted pin values once so upgraders don't open warped.
const PIN_IDS = [["tl","x","tlx"],["tl","y","tly"],["tr","x","trx"],["tr","y","try"],
                 ["br","x","brx"],["br","y","bry"],["bl","x","blx"],["bl","y","bly"]];
if (getSetting("pinSchema") !== "offset") {
  for (const [,,id] of PIN_IDS) saveSetting(id, "0");
  saveSetting("pinSchema", "offset");
}
for (const [k, axis, id] of PIN_IDS) bindControl(id, (v) => { warp.setPinOffset(k, axis, parseFloat(v)); }, v => Math.round(v) + "px");

// ---- water controls ---------------------------------------------------------
bindControl("waterIntensity", v => { water.intensity = parseFloat(v); }, v => (+v).toFixed(2));
bindControl("waterDamp",      v => { water.damp = parseFloat(v); },      v => (+v).toFixed(3));
bindControl("waterRadius",    v => { water.radius = parseFloat(v); },    v => (+v).toFixed(3));

// ---- detection controls -----------------------------------------------------
const DET = [["threshold","threshold",(v)=>parseFloat(v)],["minArea","minArea",(v)=>parseFloat(v)],
             ["maxArea","maxArea",(v)=>parseFloat(v)],["blur","blurAmt",(v)=>parseInt(v,10)],
             ["erosion","erosionAmt",(v)=>parseInt(v,10)]];
for (const [id, key, parse] of DET)
  bindControl(id, (v) => { detOpt[key] = parse(v); if (leapSrc) leapSrc.opt[key] = detOpt[key]; }, v => String(Math.round(v)));

bindControl("invert", (v) => { detOpt.invert = v; if (leapSrc) leapSrc.opt.invert = v; });
bindControl("mirrorX", (v) => { mirrorOpt.x = v; if (leapSrc) leapSrc.mirror.x = v; });
bindControl("mirrorY", (v) => { mirrorOpt.y = v; if (leapSrc) leapSrc.mirror.y = v; });
bindControl("undistort", (v) => { undistOpt.on = v; if (leapSrc) { leapSrc.undist.on = v; leapSrc.undist.map = null; } });
bindControl("undistK1", (v) => { undistOpt.k1 = parseFloat(v); if (leapSrc) { leapSrc.undist.k1 = undistOpt.k1; leapSrc.undist.map = null; } }, v => (+v).toFixed(2));
bindControl("undistK2", (v) => { undistOpt.k2 = parseFloat(v); if (leapSrc) { leapSrc.undist.k2 = undistOpt.k2; leapSrc.undist.map = null; } }, v => (+v).toFixed(2));

// source last so setSource sees everything ready; restores last source or defaults to mouse
bindControl("sourceSel", (v) => setSource(v));

status.textContent = `canvas ${glCanvas.width}x${glCanvas.height} ready`;

(function loop(){
  bg.draw();
  water.setBackground(bg.canvas);
  water.step();
  const tex = water.renderToTexture();
  warp.draw(tex);
  drawPins();
  requestAnimationFrame(loop);
})();
