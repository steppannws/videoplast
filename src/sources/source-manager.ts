// Owns the active touch source and the live detection options. Switching sources
// goes through the SOURCES registry; control changes mutate the shared opts and
// propagate to the running IR source (typed by key — no `as any`).
import { IrSource } from "./ir-source.ts";
import { MouseTouchSource } from "./touch-source.ts";
import { SOURCES } from "./source-registry.ts";
import type { SourceInstance, SourceCtx } from "./source-registry.ts";
import { CameraFrameProvider } from "../ir/camera-frame-provider.ts";
import { bindSelect, bindNumber, bindBool, getSetting, saveSetting } from "../ui/persist.ts";
import { DET_DEFAULTS, UNDIST_DEFAULTS, MIRROR_DEFAULTS } from "../config/defaults.ts";
import { DET_SLIDERS } from "../config/controls.ts";
import type { NumericDetKey } from "../config/controls.ts";
import type { IrFrameProvider } from "../ir/provider.ts";
import type { TouchEv, Roi, DetOpt, Axis } from "../types/index.ts";

export interface SourceManagerDeps {
  glCanvas: HTMLCanvasElement;
  emitTouch: (ev: TouchEv) => void;
  setStatus: (s: string) => void;
  calibrate: (src: IrSource) => void;
}

export class SourceManager {
  private readonly mouse: MouseTouchSource;
  private current: SourceInstance | null = null;
  private irSrc: IrSource | null = null;
  private readonly detOpt: DetOpt = { ...DET_DEFAULTS };
  private readonly undistOpt = { ...UNDIST_DEFAULTS };
  private readonly mirrorOpt = { ...MIRROR_DEFAULTS };

  constructor(private readonly deps: SourceManagerDeps) {
    this.mouse = new MouseTouchSource(deps.glCanvas);
  }

  getIrSrc(): IrSource | null { return this.irSrc; }

  setSource(name: string): void {
    if (this.current) this.current.stop();
    this.irSrc = null;
    const entry = SOURCES.find((e) => e.id === name);
    if (!entry) return;
    const ctx: SourceCtx = {
      mouse: this.mouse,
      camId: () => getSetting<string>("camDevice") || undefined,
      makeIr: (p, n, pre, rr) => this.makeIr(p, n, pre, rr),
    };
    this.current = entry.make(ctx);
    this.current.onTouch((ev) => this.deps.emitTouch(ev));
    this.current.start();
    this.deps.setStatus(`source: ${name}`);
  }

  wire(): void {
    bindSelect("sourceSel", (v) => this.setSource(v));
    for (const d of DET_SLIDERS) {
      bindNumber(d.id, (n) => this.setDet(d.key, n), (n) => String(Math.round(n)),
        d.int ? (s) => parseInt(s, 10) : parseFloat);
    }
    bindBool("invert", (b) => { this.detOpt.invert = b; if (this.irSrc) this.irSrc.opt.invert = b; });
    bindBool("diffMode", (b) => { this.detOpt.absDiff = b; if (this.irSrc) this.irSrc.opt.absDiff = b; });
    bindBool("mirrorX", (b) => this.setMirror("x", b));
    bindBool("mirrorY", (b) => this.setMirror("y", b));
    bindBool("undistort", (b) => this.setUndistOn(b));
    bindNumber("undistK1", (n) => this.setUndistK("k1", n), (n) => n.toFixed(2));
    bindNumber("undistK2", (n) => this.setUndistK("k2", n), (n) => n.toFixed(2));
    this.wireCamera();
  }

  // --- internals -----------------------------------------------------------
  private makeIr(provider: IrFrameProvider, name: string, prefix: string, restoreRoi: boolean): IrSource {
    const src = new IrSource(provider, name);
    this.irSrc = src;
    Object.assign(src.opt, this.detOpt);
    Object.assign(src.undist, this.undistOpt);
    src.undist.map = null;
    Object.assign(src.mirror, this.mirrorOpt);
    if (restoreRoi) { const roi = getSetting<Roi>("roi"); if (roi) src.setRoi(roi); }
    src.statusCb = (s) => this.deps.setStatus(`${prefix}: ${s}`);
    this.deps.calibrate(src);
    return src;
  }

  private setDet(key: NumericDetKey, value: number): void {
    this.detOpt[key] = value;
    if (this.irSrc) this.irSrc.opt[key] = value;
  }

  private setMirror(axis: Axis, b: boolean): void {
    this.mirrorOpt[axis] = b;
    if (this.irSrc) this.irSrc.mirror[axis] = b;
  }

  private setUndistOn(b: boolean): void {
    this.undistOpt.on = b;
    if (this.irSrc) { this.irSrc.undist.on = b; this.irSrc.undist.map = null; }
  }

  private setUndistK(which: "k1" | "k2", v: number): void {
    this.undistOpt[which] = v;
    if (this.irSrc) { this.irSrc.undist[which] = v; this.irSrc.undist.map = null; }
  }

  private wireCamera(): void {
    const camSel = document.getElementById("camDevice") as HTMLSelectElement | null;
    const sourceSelEl = document.getElementById("sourceSel") as HTMLSelectElement | null;
    const syncCamRow = (): void => {
      const row = document.getElementById("camDeviceRow");
      if (row) row.classList.toggle("hidden", sourceSelEl?.value !== "ir-camera");
    };
    if (camSel) camSel.addEventListener("change", () => {
      saveSetting("camDevice", camSel.value);
      if (sourceSelEl?.value === "ir-camera") this.setSource("ir-camera");
    });
    if (sourceSelEl) sourceSelEl.addEventListener("change", syncCamRow);
    syncCamRow();
    void this.refreshCameras(camSel);
  }

  private async refreshCameras(camSel: HTMLSelectElement | null): Promise<void> {
    if (!camSel) return;
    try {
      const cams = await CameraFrameProvider.listCameras();
      camSel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || "Camera " + (i + 1)}</option>`).join("");
      const saved = getSetting<string>("camDevice");
      if (saved) camSel.value = saved;
    } catch { /* enumerate may reject before permission */ }
  }
}
