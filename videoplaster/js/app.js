// videoplaster/js/app.js
import { WaterGL } from "./water-gl.js";
import { WarpGL } from "./warp-gl.js";
import { MouseTouchSource } from "./touch-source.js";

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

const mouse = new MouseTouchSource(glCanvas);
mouse.onTouch((ev) => { if (ev.state !== "up") water.addDrop(ev.x, ev.y, ev.strength); });
mouse.start();

(function loop(){ water.step(); const tex = water.renderToTexture(); warp.draw(tex); requestAnimationFrame(loop); })();
