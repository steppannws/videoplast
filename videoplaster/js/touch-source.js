// videoplaster/js/touch-source.js
export function clientToSurface(rect, clientX, clientY) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  return { x: cl((clientX - rect.left) / rect.width), y: cl((clientY - rect.top) / rect.height) };
}

export class TouchSource {
  constructor() { this._cb = () => {}; this.name = "base"; }
  onTouch(cb) { this._cb = cb; }
  emit(ev) { this._cb(ev); }
  start() {} stop() {}
}

// Mouse: press = down, drag = move, release = up. Single pointer → id 0.
export class MouseTouchSource extends TouchSource {
  constructor(canvas) { super(); this.name = "mouse"; this.canvas = canvas; this.down = false; }
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return clientToSurface(r, cx, cy);
  }
  start() {
    this._md = (e) => { this.down = true; const p = this._pos(e); this.emit({ id:0, ...p, z:0, strength:1, state:"down" }); };
    this._mm = (e) => { if (!this.down) return; const p = this._pos(e); this.emit({ id:0, ...p, z:0, strength:0.6, state:"move" }); };
    this._mu = () => { if (!this.down) return; this.down = false; this.emit({ id:0, x:0, y:0, z:0, strength:0, state:"up" }); };
    this.canvas.addEventListener("mousedown", this._md);
    window.addEventListener("mousemove", this._mm);
    window.addEventListener("mouseup", this._mu);
  }
  stop() {
    this.canvas.removeEventListener("mousedown", this._md);
    window.removeEventListener("mousemove", this._mm);
    window.removeEventListener("mouseup", this._mu);
  }
}
