// Registry of selectable touch sources — mirrors the EFFECTS registry. The dropdown
// order in controls.ts must match these ids. The camera source funnels through
// ctx.makeIr so detection opts, ROI restore, status, and calibration are wired in one
// place.
import { CameraFrameProvider } from "../ir/camera-frame-provider.ts";
import type { IrSource } from "./ir-source.ts";
import type { MouseTouchSource } from "./touch-source.ts";
import type { IrFrameProvider } from "../ir/provider.ts";

export type SourceInstance = MouseTouchSource | IrSource;

export interface SourceCtx {
  mouse: MouseTouchSource;
  camId: () => string | undefined;
  makeIr: (provider: IrFrameProvider, name: string, statusPrefix: string, restoreRoi: boolean) => IrSource;
}

export interface SourceEntry { id: string; make: (ctx: SourceCtx) => SourceInstance; }

export const SOURCES: SourceEntry[] = [
  { id: "mouse", make: (c) => c.mouse },
  { id: "ir-camera", make: (c) => c.makeIr(new CameraFrameProvider(c.camId()), "ir-camera", "CAMERA", true) },
];
