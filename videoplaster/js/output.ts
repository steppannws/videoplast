// videoplaster/js/output.ts
import type { TouchEv } from "./types.ts";

export class TouchEmitter {
  url: string;
  ws: WebSocket | null;
  constructor(url = "ws://localhost:7681") { this.url = url; this.ws = null; this._connect(); }
  _connect(): void {
    try { this.ws = new WebSocket(this.url); } catch { this._retry(); return; }
    this.ws.onclose = () => this._retry();
    this.ws.onerror = () => {};
  }
  _retry(): void { this.ws = null; setTimeout(() => this._connect(), 1500); }   // backoff, not tight loop
  send(ev: TouchEv): void { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(ev)); }
}
