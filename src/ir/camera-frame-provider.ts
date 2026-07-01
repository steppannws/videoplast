// Generic IR webcam via getUserMedia: video -> offscreen canvas -> luma -> pipeline.
import type { IrFrameProvider } from "./provider.ts";
import { rgbaToLuma } from "./provider.ts";

export class CameraFrameProvider implements IrFrameProvider {
  deviceId?: string;
  _stopped = false;
  _stream: MediaStream | null = null;
  _video: HTMLVideoElement;
  _canvas: HTMLCanvasElement;
  _ctx: CanvasRenderingContext2D | null;
  _gray: Uint8Array | null = null;
  _raf = 0;
  _frameCb: (w: number, h: number, gray: Uint8Array) => void = () => {};
  _statusCb: (s: string) => void = () => {};
  constructor(deviceId?: string) {
    this.deviceId = deviceId;
    this._video = document.createElement("video");
    this._video.muted = true; this._video.playsInline = true;
    this._canvas = document.createElement("canvas");
    this._ctx = this._canvas.getContext("2d", { willReadFrequently: true });
  }
  onFrame(cb: (w: number, h: number, gray: Uint8Array) => void): void { this._frameCb = cb; }
  onStatus(cb: (s: string) => void): void { this._statusCb = cb; }
  static async listCameras(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "videoinput");
  }
  start(): void {
    this._stopped = false;
    this._statusCb("connecting");
    const constraints: MediaStreamConstraints = {
      video: this.deviceId ? { deviceId: { exact: this.deviceId } } : true,
      audio: false,
    };
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (this._stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      this._stream = stream;
      this._video.srcObject = stream;
      this._video.play().then(() => { this._statusCb("streaming"); this._loop(); }).catch(() => this._statusCb("error"));
    }).catch(() => this._statusCb("denied"));
  }
  _loop(): void {
    if (this._stopped) return;
    const vw = this._video.videoWidth, vh = this._video.videoHeight;
    if (vw && vh && this._ctx) {
      if (this._canvas.width !== vw || this._canvas.height !== vh) {
        this._canvas.width = vw; this._canvas.height = vh; this._gray = new Uint8Array(vw * vh);
      }
      this._ctx.drawImage(this._video, 0, 0, vw, vh);
      const rgba = this._ctx.getImageData(0, 0, vw, vh).data;
      rgbaToLuma(rgba, this._gray!);
      this._frameCb(vw, vh, this._gray!);
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }
  stop(): void {
    this._stopped = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._stream) { this._stream.getTracks().forEach((t) => t.stop()); this._stream = null; }
  }
  restart(): void { this.stop(); this.start(); }
}
