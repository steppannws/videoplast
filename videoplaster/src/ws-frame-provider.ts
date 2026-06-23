// WebSocket transport to the Python bridge. On open it tells the bridge which device
// to capture, then forwards each binary IR frame to the pipeline.
import type { IrFrameProvider } from "./ir-provider.ts";
import { parseIrFrame } from "./ir-provider.ts";

export class WsFrameProvider implements IrFrameProvider {
  url: string;
  device: string;
  ws?: WebSocket;
  _stopped = false;
  _frameCb: (w: number, h: number, gray: Uint8Array) => void = () => {};
  _statusCb: (s: string) => void = () => {};
  constructor(url = "ws://localhost:7681", device: "leap" | "pseye" = "leap") {
    this.url = url; this.device = device;
  }
  onFrame(cb: (w: number, h: number, gray: Uint8Array) => void): void { this._frameCb = cb; }
  onStatus(cb: (s: string) => void): void { this._statusCb = cb; }
  start(): void { this._stopped = false; this._connect(); }
  _connect(): void {
    if (this._stopped) return;
    this._statusCb("connecting");
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this._statusCb("connected");
      try { this.ws?.send(JSON.stringify({ type: "device", name: this.device })); } catch {}
    };
    this.ws.onmessage = (e: MessageEvent) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const { w, h, gray } = parseIrFrame(e.data);
      this._frameCb(w, h, gray);
    };
    this.ws.onclose = () => {
      if (this._stopped) return;
      this._statusCb("reconnecting");
      setTimeout(() => this._connect(), 1000);
    };
    this.ws.onerror = () => { try { this.ws?.close(); } catch {} };
  }
  stop(): void { this._stopped = true; if (this.ws) { try { this.ws.close(); } catch {} } }
  restart(): void { this.stop(); this._stopped = false; this._connect(); }
}
