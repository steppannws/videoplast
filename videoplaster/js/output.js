// videoplaster/js/output.js
export class TouchEmitter {
  constructor(url = "ws://localhost:7681") { this.url = url; this.ws = null; this._connect(); }
  _connect() {
    try { this.ws = new WebSocket(this.url); } catch { this._retry(); return; }
    this.ws.onclose = () => this._retry();
    this.ws.onerror = () => {};
  }
  _retry() { this.ws = null; setTimeout(() => this._connect(), 1500); }   // backoff, not tight loop
  send(ev) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(ev)); }
}
