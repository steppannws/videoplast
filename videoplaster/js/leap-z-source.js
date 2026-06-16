// videoplaster/js/leap-z-source.js
import { TouchSource } from "./touch-source.js";

export function extractFingerTips(frame) {
  const tips = [];
  for (const hand of frame.hands || []) {
    for (const finger of hand.fingers || []) {
      if (finger.extended === false) continue;
      let tip = finger.stabilizedTipPosition || finger.tipPosition;
      if (!tip && finger.bones && finger.bones.length) {
        const d = finger.bones.find((b) => b.type === 3) || finger.bones[finger.bones.length - 1];
        if (d) tip = d.nextJoint;
      }
      if (tip) tips.push(tip);
    }
  }
  return tips;
}

// Maps a Leap tip [x,y,z] (mm) to surface UV using the interaction box, plus touch height logic.
export function fingerToTouch(tip, box, { thresh, zoomX, zoomZ, invertZ }) {
  let nx = (tip[0] - box.center[0]) / box.size[0] * zoomX + 0.5;
  let nz = (tip[2] - box.center[2]) / box.size[2] * zoomZ + 0.5;
  if (invertZ) nz = 1 - nz;
  nx = Math.max(0, Math.min(1, nx)); nz = Math.max(0, Math.min(1, nz));
  const heightAbovePlane = tip[1] - (box.center[1] - box.size[1] / 2);
  const touch = heightAbovePlane < thresh;
  return { x: nx, y: nz, z: heightAbovePlane, touch, strength: Math.max(0.2, 1 - heightAbovePlane / thresh) };
}

const URLS = ["ws://localhost:6437/v6.json","ws://localhost:6437/v3.json","ws://localhost:6437"];
const DEFAULT_BOX = { center:[0,200,0], size:[300,300,300] };

export class LeapZSource extends TouchSource {
  constructor() { super(); this.name = "leap-z"; this.cfg = { thresh:40, zoomX:1, zoomZ:1, invertZ:false }; this.active = new Map(); this.nextId = 1; }
  start() { this._tryNext(0); }
  stop() { if (this.ws) this.ws.close(); }
  _tryNext(i) {
    if (i >= URLS.length) return;
    const ws = new WebSocket(URLS[i]);
    const to = setTimeout(() => { try { ws.close(); } catch {} this._tryNext(i + 1); }, 2000);
    ws.onopen = () => { clearTimeout(to); this.ws = ws; ws.send(JSON.stringify({ focused:true })); ws.send(JSON.stringify({ background:true }));
      ws.onmessage = (e) => { try { this._frame(JSON.parse(e.data)); } catch {} }; };
    ws.onerror = () => { clearTimeout(to); this._tryNext(i + 1); };
  }
  _frame(frame) {
    const box = frame.interactionBox || DEFAULT_BOX;
    const tips = extractFingerTips(frame);
    const touches = tips.map((t) => fingerToTouch(t, box, this.cfg)).filter((t) => t.touch);
    // simple single-pass id reuse by index (Leap already smooths); good enough for backup
    const seen = new Set();
    touches.forEach((t, i) => { const id = i + 1; seen.add(id);
      const state = this.active.has(id) ? "move" : "down"; this.active.set(id, true);
      this.emit({ id, x: t.x, y: t.y, z: t.z, strength: t.strength, state }); });
    for (const id of [...this.active.keys()]) if (!seen.has(id)) { this.active.delete(id); this.emit({ id, x:0,y:0,z:0,strength:0, state:"up" }); }
  }
}
