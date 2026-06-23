// A TouchSource that wires a frame provider into the IR pipeline. The three IR
// devices (Leap, PS Eye, generic camera) are IrSource instances with different providers.
import { TouchSource } from "./touch-source.ts";
import { IrTouchPipeline } from "./ir-pipeline.ts";
import type { IrFrameProvider } from "./ir-provider.ts";
import type { DetOpt, UndistOpt, MirrorOpt, Roi, DetBlob } from "./types.ts";

export class IrSource extends TouchSource {
  pipeline = new IrTouchPipeline();
  provider: IrFrameProvider;
  constructor(provider: IrFrameProvider, name = "ir") {
    super();
    this.name = name;
    this.provider = provider;
    this.pipeline.onEvent = (ev) => this.emit(ev);
    this.provider.onFrame((w, h, gray) => this.pipeline.process(gray, w, h));
  }
  // Calibration surface — delegates to the pipeline so the existing UI binds unchanged.
  get opt(): DetOpt { return this.pipeline.opt; }
  get undist(): UndistOpt { return this.pipeline.undist; }
  get mirror(): MirrorOpt { return this.pipeline.mirror; }
  get roi(): Roi { return this.pipeline.roi; }
  setRoi(r: Roi): void { this.pipeline.setRoi(r); }
  captureBackground(): void { this.pipeline.captureBackground(); }
  set previewCb(cb: ((rgba: Uint8ClampedArray, w: number, h: number, blobs: DetBlob[]) => void) | null) { this.pipeline.previewCb = cb; }
  set statusCb(cb: (s: string) => void) { this.provider.onStatus(cb); }
  start(): void { this.provider.start(); }
  stop(): void { this.provider.stop(); }
  restart(): void { this.provider.restart(); }
}
