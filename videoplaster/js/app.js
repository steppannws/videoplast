// videoplaster/js/app.js
import { WaterGL } from "./water-gl.js";
import { WarpGL } from "./warp-gl.js";
import { MouseTouchSource } from "./touch-source.js";
import { TouchEmitter } from "./output.js";
import { LeapImageSource } from "./leap-image-source.js";
import { LeapZSource } from "./leap-z-source.js";

const glCanvas = document.getElementById("glCanvas");
const status = document.getElementById("status");
status.textContent = `canvas ${glCanvas.width}×${glCanvas.height} — modules OK`;
console.log("app boot");

const gl = glCanvas.getContext("webgl");
const water = new WaterGL(gl);
const bg = document.createElement("canvas"); bg.width = bg.height = 2;
const bx = bg.getContext("2d"); bx.fillStyle = "#1b3a5a"; bx.fillRect(0,0,2,2);
water.setBackground(bg);

const warp = new WarpGL(gl, glCanvas.width, glCanvas.height);
// load/persist pins from localStorage:
const savedPins = JSON.parse(localStorage.getItem("vp_pins") || "null");
if (savedPins) warp.pins = savedPins;
["tl","tr","br","bl"].forEach((k) => ["x","y"].forEach((axis) => {
  const el = document.getElementById(k+axis); if (!el) return;
  el.value = warp.pins[k][axis];
  el.oninput = () => { warp.pins[k][axis] = parseFloat(el.value); localStorage.setItem("vp_pins", JSON.stringify(warp.pins)); };
}));

// water tuning sliders → live water instance
const waterIntensityEl = document.getElementById("waterIntensity");
if (waterIntensityEl) waterIntensityEl.oninput = () => { water.intensity = parseFloat(waterIntensityEl.value); };
const waterDampEl = document.getElementById("waterDamp");
if (waterDampEl) waterDampEl.oninput = () => { water.damp = parseFloat(waterDampEl.value); };
const waterRadiusEl = document.getElementById("waterRadius");
if (waterRadiusEl) waterRadiusEl.oninput = () => { water.radius = parseFloat(waterRadiusEl.value); };

const emitter = new TouchEmitter();
const mouse = new MouseTouchSource(glCanvas);

// ---- source selection -------------------------------------------------------
let current = null;
let leapSrc = null;            // the active LeapImageSource (if leap-ir), for calib UI
let cornerMode = false;        // collecting 4 corner clicks on the preview
let cornerPts = [];

function wire(src){ src.onTouch(ev => { if (ev.state !== "up") water.addDrop(ev.x, ev.y, ev.strength); emitter.send(ev); }); }

// --- LeapImageSource calibration preview ------------------------------------
const irPreview = document.getElementById("irPreview");
const irCtx = irPreview ? irPreview.getContext("2d") : null;
function drawPreview(rgba, w, h, blobs){
  if (!irCtx) return;
  irPreview.width = w; irPreview.height = h;
  const img = irCtx.createImageData(w, h);
  img.data.set(rgba);
  irCtx.putImageData(img, 0, 0);
  irCtx.strokeStyle = "#0f0"; irCtx.lineWidth = 1;
  for (const b of blobs) irCtx.strokeRect(b.cx-3, b.cy-3, 6, 6);
}

function attachLeapCalib(src){
  src.previewCb = (rgba, w, h, blobs) => drawPreview(rgba, w, h, blobs);
  if (irPreview) {
    irPreview.onclick = (e) => {
      if (!cornerMode) return;
      const r = irPreview.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * irPreview.width;
      const y = (e.clientY - r.top) / r.height * irPreview.height;
      cornerPts.push({ x, y });
      if (cornerPts.length === 4) {
        src.setCorners(cornerPts);
        localStorage.setItem("vp_corners", JSON.stringify(cornerPts));
        cornerMode = false; cornerPts = []; status.textContent = "corners calibrated";
      } else {
        status.textContent = `corner ${cornerPts.length}/4`;
      }
    };
  }
}

// calibration buttons (act on the active leap source)
const captureBgBtn = document.getElementById("captureBg");
if (captureBgBtn) captureBgBtn.onclick = () => { if (leapSrc) { leapSrc.captureBackground(); status.textContent = "background captured"; } };
const calibCornersBtn = document.getElementById("calibCorners");
if (calibCornersBtn) calibCornersBtn.onclick = () => { if (leapSrc) { cornerMode = true; cornerPts = []; status.textContent = "click 4 corners in preview"; } };

// blob/detection sliders → leapSrc.opt.* (only effective while leap-ir is active)
const sliderMap = [
  ["threshold", "threshold", parseFloat],
  ["minArea", "minArea", parseFloat],
  ["maxArea", "maxArea", parseFloat],
  ["blur", "blurAmt", parseInt],
  ["erosion", "erosionAmt", parseInt],
];
for (const [id, key, parse] of sliderMap) {
  const el = document.getElementById(id); if (!el) continue;
  el.oninput = () => { if (leapSrc) leapSrc.opt[key] = parse(el.value, 10); };
}
const invertEl = document.getElementById("invert");
if (invertEl) invertEl.onchange = () => { if (leapSrc) leapSrc.opt.invert = invertEl.checked; };
const ud = document.getElementById("undistort");
if (ud) ud.onchange = () => { if (leapSrc) { leapSrc.undist.on = ud.checked; leapSrc.undist.map = null; } };
const k1 = document.getElementById("undistK1");
if (k1) k1.oninput = () => { if (leapSrc) { leapSrc.undist.k1 = parseFloat(k1.value); leapSrc.undist.map = null; } };
const k2 = document.getElementById("undistK2");
if (k2) k2.oninput = () => { if (leapSrc) { leapSrc.undist.k2 = parseFloat(k2.value); leapSrc.undist.map = null; } };

function setSource(name){
  if (current) current.stop();
  leapSrc = null;
  if (name === "mouse") { current = mouse; }
  else if (name === "leap-ir") {
    current = new LeapImageSource();
    leapSrc = current;
    const saved = JSON.parse(localStorage.getItem("vp_corners") || "null"); if (saved) current.setCorners(saved);
    attachLeapCalib(current);
  }
  else if (name === "leap-z") { current = new LeapZSource(); }
  if (!current) return;
  wire(current); current.start();
  status.textContent = `source: ${name}`;
}

document.getElementById("sourceSel").onchange = (e) => setSource(e.target.value);
setSource("mouse");

(function loop(){ water.step(); const tex = water.renderToTexture(); warp.draw(tex); requestAnimationFrame(loop); })();
