// src/sources/touch-source.ts
import { clamp } from "../util/math.ts";
import type { TouchEv } from "../types/index.ts";

export interface RectLike { left: number; top: number; width: number; height: number; }

export function clientToSurface(rect: RectLike, clientX: number, clientY: number): { x: number; y: number } {
  return { x: clamp((clientX - rect.left) / rect.width, 0, 1), y: clamp((clientY - rect.top) / rect.height, 0, 1) };
}

export class TouchSource {
  _cb: (ev: TouchEv) => void;
  name: string;
  constructor() { this._cb = () => {}; this.name = "base"; }
  onTouch(cb: (ev: TouchEv) => void): void { this._cb = cb; }
  emit(ev: TouchEv): void { this._cb(ev); }
  start(): void {}
  stop(): void {}
}

// Mouse: press = down, drag = move, release = up. Single pointer → id 0.
export class MouseTouchSource extends TouchSource {
  canvas: HTMLCanvasElement;
  down: boolean;
  _active: boolean;
  _md?: (e: MouseEvent) => void;
  _mm?: (e: MouseEvent) => void;
  _mu?: () => void;
  constructor(canvas: HTMLCanvasElement) { super(); this.name = "mouse"; this.canvas = canvas; this.down = false; this._active = false; }
  _pos(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const touches = (e as MouseEvent & { touches?: TouchList }).touches;
    const cx = touches ? touches[0].clientX : e.clientX;
    const cy = touches ? touches[0].clientY : e.clientY;
    return clientToSurface(r, cx, cy);
  }
  start(): void {
    if (this._active) return;
    this._active = true;
    this._md = (e) => { this.down = true; const p = this._pos(e); this.emit({ id:0, ...p, z:0, strength:1, state:"down" }); };
    this._mm = (e) => { if (!this.down) return; const p = this._pos(e); this.emit({ id:0, ...p, z:0, strength:0.6, state:"move" }); };
    this._mu = () => { if (!this.down) return; this.down = false; this.emit({ id:0, x:0, y:0, z:0, strength:0, state:"up" }); };
    this.canvas.addEventListener("mousedown", this._md);
    window.addEventListener("mousemove", this._mm);
    window.addEventListener("mouseup", this._mu);
  }
  stop(): void {
    this._active = false;
    if (this._md) this.canvas.removeEventListener("mousedown", this._md);
    if (this._mm) window.removeEventListener("mousemove", this._mm);
    if (this._mu) window.removeEventListener("mouseup", this._mu);
  }
}
