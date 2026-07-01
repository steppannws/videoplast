// Registry of selectable touch sources — mirrors the EFFECTS registry. The dropdown
// order in controls.ts must match these ids. The IR variants funnel through
// ctx.makeIr so detection opts, ROI restore, status, and calibration are wired in one
// place instead of being copy-pasted per device.
import { WsFrameProvider } from "../ir/ws-frame-provider.ts";
import { CameraFrameProvider } from "../ir/camera-frame-provider.ts";
import { LeapZSource } from "./leap-z-source.ts";
import type { IrSource } from "./ir-source.ts";
import type { MouseTouchSource } from "./touch-source.ts";
import type { IrFrameProvider } from "../ir/provider.ts";

export type SourceInstance = MouseTouchSource | IrSource | LeapZSource;

export interface SourceCtx {
  mouse: MouseTouchSource;
  camId: () => string | undefined;
  makeIr: (provider: IrFrameProvider, name: string, statusPrefix: string, restoreRoi: boolean) => IrSource;
}

export interface SourceEntry { id: string; make: (ctx: SourceCtx) => SourceInstance; }

const WS_URL = "ws://localhost:7681";

export const SOURCES: SourceEntry[] = [
  { id: "mouse", make: (c) => c.mouse },
  { id: "leap-ir", make: (c) => c.makeIr(new WsFrameProvider(WS_URL, "leap"), "leap-ir", "LEAP-IR", true) },
  { id: "pseye", make: (c) => c.makeIr(new WsFrameProvider(WS_URL, "pseye"), "pseye", "PSEYE", true) },
  { id: "ir-camera", make: (c) => c.makeIr(new CameraFrameProvider(c.camId()), "ir-camera", "CAMERA", false) },
  { id: "leap-z", make: () => new LeapZSource() },
];
