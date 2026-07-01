// src/sources/leap-z-source.ts
import { TouchSource } from "./touch-source.ts";
import { clamp } from "../util/math.ts";

type Vec3 = number[];
interface LeapBone { type?: number; nextJoint?: Vec3; }
interface LeapFinger { extended?: boolean; stabilizedTipPosition?: Vec3; tipPosition?: Vec3; bones?: LeapBone[]; }
interface LeapHand { fingers?: LeapFinger[]; }
interface LeapBox { center: Vec3; size: Vec3; }
interface LeapFrame { hands?: LeapHand[]; interactionBox?: LeapBox; }
interface ZCfg { thresh: number; zoomX: number; zoomZ: number; invertZ: boolean; }
interface ZTouch { x: number; y: number; z: number; touch: boolean; strength: number; }

export function extractFingerTips(frame: LeapFrame): Vec3[] {
  const tips: Vec3[] = [];
  for (const hand of frame.hands || []) {
    for (const finger of hand.fingers || []) {
      if (finger.extended === false) continue;
      let tip: Vec3 | undefined = finger.stabilizedTipPosition || finger.tipPosition;
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
export function fingerToTouch(tip: Vec3, box: LeapBox, { thresh, zoomX, zoomZ, invertZ }: ZCfg): ZTouch {
  let nx = (tip[0] - box.center[0]) / box.size[0] * zoomX + 0.5;
  let nz = (tip[2] - box.center[2]) / box.size[2] * zoomZ + 0.5;
  if (invertZ) nz = 1 - nz;
  nx = clamp(nx, 0, 1); nz = clamp(nz, 0, 1);
  const heightAbovePlane = tip[1] - (box.center[1] - box.size[1] / 2);
  const touch = heightAbovePlane < thresh;
  return { x: nx, y: nz, z: heightAbovePlane, touch, strength: Math.max(0.2, 1 - heightAbovePlane / thresh) };
}

const URLS = ["ws://localhost:6437/v6.json","ws://localhost:6437/v3.json","ws://localhost:6437"];
const DEFAULT_BOX: LeapBox = { center:[0,200,0], size:[300,300,300] };

export class LeapZSource extends TouchSource {
  cfg: ZCfg;
  active: Map<number, boolean>;
  nextId: number;
  _stopped: boolean;
  ws?: WebSocket;
  constructor() { super(); this.name = "leap-z"; this.cfg = { thresh:40, zoomX:1, zoomZ:1, invertZ:false }; this.active = new Map(); this.nextId = 1; this._stopped = false; }
  start(): void { this._tryNext(0); }
  stop(): void { this._stopped = true; if (this.ws) this.ws.close(); }
  _tryNext(i: number): void {
    if (this._stopped || i >= URLS.length) return;
    const ws = new WebSocket(URLS[i]);
    const to = setTimeout(() => { if (this._stopped) { try { ws.close(); } catch {} return; } try { ws.close(); } catch {} this._tryNext(i + 1); }, 2000);
    ws.onopen = () => { if (this._stopped) { ws.close(); return; } clearTimeout(to); this.ws = ws; ws.send(JSON.stringify({ focused:true })); ws.send(JSON.stringify({ background:true }));
      ws.onmessage = (e: MessageEvent) => { try { this._frame(JSON.parse(e.data)); } catch {} }; };
    ws.onerror = () => { clearTimeout(to); this._tryNext(i + 1); };
  }
  _frame(frame: LeapFrame): void {
    const box = frame.interactionBox || DEFAULT_BOX;
    const tips = extractFingerTips(frame);
    const touches = tips.map((t) => fingerToTouch(t, box, this.cfg)).filter((t) => t.touch);
    // simple single-pass id reuse by index (Leap already smooths); good enough for backup
    const seen = new Set<number>();
    touches.forEach((t, i) => { const id = i + 1; seen.add(id);
      const state = this.active.has(id) ? "move" : "down"; this.active.set(id, true);
      this.emit({ id, x: t.x, y: t.y, z: t.z, strength: t.strength, state }); });
    for (const id of [...this.active.keys()]) if (!seen.has(id)) { this.active.delete(id); this.emit({ id, x:0,y:0,z:0,strength:0, state:"up" }); }
  }
}
