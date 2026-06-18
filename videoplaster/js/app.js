// videoplaster/js/app.js
import { WaterGL } from "./water-gl.js";
import { WarpGL } from "./warp-gl.js";
import { MouseTouchSource } from "./touch-source.js";
import { TouchEmitter } from "./output.js";
import { LeapImageSource } from "./leap-image-source.js";
import { LeapZSource } from "./leap-z-source.js";
import { bindControl, getSetting, saveSetting } from "./persist.js";

const glCanvas = document.getElementById("glCanvas");
const status = document.getElementById("status");
console.log("app boot");

const gl = glCanvas.getContext("webgl");
const water = new WaterGL(gl);
const bg = document.createElement("canvas"); bg.width = bg.height = 2;
const bx = bg.getContext("2d"); bx.fillStyle = "#1b3a5a"; bx.fillRect(0,0,2,2);
water.setBackground(bg);

const warp = new WarpGL(gl, glCanvas.width, glCanvas.height);
const emitter = new TouchEmitter();
const mouse = new MouseTouchSource(glCanvas);

// holders so persisted detection/undistort settings survive even when no leap source is active yet
const detOpt = { threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false };
const undistOpt = { on: false, k1: -0.3, k2: 0 };

let current = null;
let leapSrc = null;

function wire(src){ src.onTouch(ev => { if (ev.state !== "up") water.addDrop(ev.x, ev.y, ev.strength); emitter.send(ev); }); }

// ---- IR preview + capture-zone overlay -------------------------------------
const irPreview = document.getElementById("irPreview");
const irCtx = irPreview ? irPreview.getContext("2d") : null;

function drawRoi(roi, w, h){
  const rx = roi.x*w, ry = roi.y*h, rw = roi.w*w, rh = roi.h*h;
  irCtx.save();
  irCtx.fillStyle = "rgba(0,0,0,0.45)";            // dim outside the zone
  irCtx.beginPath(); irCtx.rect(0,0,w,h); irCtx.rect(rx,ry,rw,rh); irCtx.fill("evenodd");
  irCtx.restore();
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 2; irCtx.strokeRect(rx, ry, rw, rh);
  const hs = 10; irCtx.fillStyle = "#0f0";
  for (const [hx,hy] of [[rx,ry],[rx+rw,ry],[rx+rw,ry+rh],[rx,ry+rh]])
    irCtx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
}

function drawPreview(rgba, w, h, blobs, roi){
  if (!irCtx) return;
  if (irPreview.width !== w || irPreview.height !== h) { irPreview.width = w; irPreview.height = h; }
  const img = irCtx.createImageData(w, h); img.data.set(rgba); irCtx.putImageData(img, 0, 0);
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 1;
  for (const b of blobs) irCtx.strokeRect(b.cx-3, b.cy-3, 6, 6);
  if (roi) drawRoi(roi, w, h);
}

function attachLeapCalib(src){
  src.previewCb = (rgba, w, h, blobs) => drawPreview(rgba, w, h, blobs, src.roi);
}

// corner drag (normalized 0..1 coords; opposite corner stays fixed; axis-aligned)
let dragCorner = null;
function roiCorners(roi){
  return { tl:[roi.x,roi.y], tr:[roi.x+roi.w,roi.y], br:[roi.x+roi.w,roi.y+roi.h], bl:[roi.x,roi.y+roi.h] };
}
function previewNorm(e){
  const r = irPreview.getBoundingClientRect();
  return [ (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height ];
}
if (irPreview) {
  irPreview.addEventListener("mousedown", (e) => {
    if (!leapSrc) return;
    const [nx, ny] = previewNorm(e);
    const hit = Object.entries(roiCorners(leapSrc.roi))
      .find(([,[cx,cy]]) => Math.abs(cx-nx) < 0.04 && Math.abs(cy-ny) < 0.04);
    if (hit) dragCorner = hit[0];
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragCorner || !leapSrc) return;
    let [nx, ny] = previewNorm(e);
    nx = Math.max(0, Math.min(1, nx)); ny = Math.max(0, Math.min(1, ny));
    const roi = leapSrc.roi;
    let x0 = roi.x, y0 = roi.y, x1 = roi.x+roi.w, y1 = roi.y+roi.h;
    if (dragCorner === "tl") { x0 = nx; y0 = ny; }
    else if (dragCorner === "tr") { x1 = nx; y0 = ny; }
    else if (dragCorner === "br") { x1 = nx; y1 = ny; }
    else if (dragCorner === "bl") { x0 = nx; y1 = ny; }
    const MIN = 0.05;
    if (x1 - x0 < MIN || y1 - y0 < MIN) return;       // block inversion / too-small
    leapSrc.setRoi({ x:x0, y:y0, w:x1-x0, h:y1-y0 });
  });
  window.addEventListener("mouseup", () => {
    if (dragCorner && leapSrc) saveSetting("roi", leapSrc.roi);
    dragCorner = null;
  });
}

const captureBgBtn = document.getElementById("captureBg");
if (captureBgBtn) captureBgBtn.onclick = () => { if (leapSrc) { leapSrc.captureBackground(); status.textContent = "background captured"; } };
const resetZoneBtn = document.getElementById("resetZone");
if (resetZoneBtn) resetZoneBtn.onclick = () => { if (leapSrc) { leapSrc.setRoi({x:0,y:0,w:1,h:1}); saveSetting("roi", leapSrc.roi); status.textContent = "zone reset"; } };

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
    const savedRoi = getSetting("roi"); if (savedRoi) leapSrc.setRoi(savedRoi);
    attachLeapCalib(current);
  }
  else if (name === "leap-z") { current = new LeapZSource(); }
  if (!current) return;
  wire(current); current.start();
  status.textContent = `source: ${name}`;
}

// ---- persisted controls -----------------------------------------------------
const PIN_IDS = [["tl","x","tlx"],["tl","y","tly"],["tr","x","trx"],["tr","y","try"],
                 ["br","x","brx"],["br","y","bry"],["bl","x","blx"],["bl","y","bly"]];
for (const [k, axis, id] of PIN_IDS) bindControl(id, (v) => { warp.pins[k][axis] = parseFloat(v); });

bindControl("waterIntensity", (v) => { water.intensity = parseFloat(v); });
bindControl("waterDamp",      (v) => { water.damp = parseFloat(v); });
bindControl("waterRadius",    (v) => { water.radius = parseFloat(v); });

const DET = [["threshold","threshold",(v)=>parseFloat(v)],["minArea","minArea",(v)=>parseFloat(v)],
             ["maxArea","maxArea",(v)=>parseFloat(v)],["blur","blurAmt",(v)=>parseInt(v,10)],
             ["erosion","erosionAmt",(v)=>parseInt(v,10)]];
for (const [id, key, parse] of DET)
  bindControl(id, (v) => { detOpt[key] = parse(v); if (leapSrc) leapSrc.opt[key] = detOpt[key]; });

bindControl("invert", (v) => { detOpt.invert = v; if (leapSrc) leapSrc.opt.invert = v; });

bindControl("undistort", (v) => { undistOpt.on = v; if (leapSrc) { leapSrc.undist.on = v; leapSrc.undist.map = null; } });
bindControl("undistK1", (v) => { undistOpt.k1 = parseFloat(v); if (leapSrc) { leapSrc.undist.k1 = undistOpt.k1; leapSrc.undist.map = null; } });
bindControl("undistK2", (v) => { undistOpt.k2 = parseFloat(v); if (leapSrc) { leapSrc.undist.k2 = undistOpt.k2; leapSrc.undist.map = null; } });

// source last so setSource sees water/warp/holders ready; restores last source or defaults to mouse
bindControl("sourceSel", (v) => setSource(v));

status.textContent = `canvas ${glCanvas.width}×${glCanvas.height} — modules OK`;

(function loop(){ water.step(); const tex = water.renderToTexture(); warp.draw(tex); requestAnimationFrame(loop); })();
