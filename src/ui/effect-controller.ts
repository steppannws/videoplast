// Owns effect selection: the lazy-built effect cache, the dropdown, the number-key
// boot, and rebuilding the param panel. `active` is the current effect the render
// loop and source touches feed into.
import { EFFECTS, DEFAULT_EFFECT, effectById } from "../effects/registry.ts";
import { buildEffectParams } from "./effect-param-panel.ts";
import { getSetting, saveSetting } from "./persist.ts";
import type { Effect } from "../types/index.ts";

export class EffectController {
  private readonly cache = new Map<string, Effect>();
  active!: Effect;

  constructor(
    private readonly gl: WebGLRenderingContext,
    private readonly host: HTMLElement,
    private readonly sel: HTMLSelectElement | null,
    private readonly setStatus: (s: string) => void,
  ) {}

  private get(id: string): Effect {
    let fx = this.cache.get(id);
    if (!fx) {
      const entry = effectById(id);
      if (!entry) throw new Error("unknown effect: " + id);
      fx = entry.make(this.gl);
      this.cache.set(id, fx);
    }
    return fx;
  }

  set(id: string): void {
    const entry = effectById(id);
    if (!entry) return;
    try { this.active = this.get(id); }
    catch (e) { this.setStatus("effect failed: " + (e as Error).message); return; }
    saveSetting("fx.active", id);
    if (this.sel && this.sel.value !== id) this.sel.value = id;
    buildEffectParams(this.host, this.active, id);
    this.setStatus("effect: " + entry.label);
  }

  // Populate the dropdown and boot to the saved (or default) effect. Must run
  // before the render loop and before a source can emit touches (assigns `active`).
  init(): void {
    if (this.sel) {
      this.sel.innerHTML = EFFECTS.map((e) => `<option value="${e.id}">${e.label}</option>`).join("");
      this.sel.addEventListener("change", () => this.set(this.sel!.value));
    }
    const saved = getSetting<string>("fx.active");
    this.set(typeof saved === "string" && effectById(saved) ? saved : DEFAULT_EFFECT);
  }
}
