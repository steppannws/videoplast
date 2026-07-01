// The per-frame render loop: background -> active effect simulation -> corner-pin
// warp -> 2D overlay. Dependencies are injected so this stays a pure pipeline.
import type { BackgroundCanvas } from "./background.ts";
import type { WarpGL } from "../gl/warp-gl.ts";
import type { Effect } from "../types/index.ts";

export interface RenderDeps {
  bg: BackgroundCanvas;
  warp: WarpGL;
  getActive: () => Effect;
  drawOverlay: () => void;
}

export function startRenderLoop(d: RenderDeps): void {
  (function loop() {
    d.bg.draw();
    const active = d.getActive();
    active.setBackground(d.bg.canvas);
    active.step();
    const tex = active.renderToTexture();
    d.warp.draw(tex);
    d.drawOverlay();
    requestAnimationFrame(loop);
  })();
}
