// Builds the dynamic parameter sliders for the active effect. Element ids are
// `fx.<effectId>.<key>` so bindControl persists each under that key automatically.
// Reuses the shared Slider builder instead of hand-rolling the markup.
import { Slider } from "./control-factory.ts";
import { bindNumber } from "./persist.ts";
import type { Effect } from "../types/index.ts";

const decimals = (step: number): number => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);

export function buildEffectParams(host: HTMLElement, fx: Effect, effectId: string): void {
  host.replaceChildren(
    ...fx.params.map((p) =>
      Slider({ kind: "slider", id: `fx.${effectId}.${p.key}`, label: p.label, min: p.min, max: p.max, step: p.step, value: p.default })),
  );
  for (const p of fx.params) {
    const id = `fx.${effectId}.${p.key}`;
    const d = decimals(p.step);
    bindNumber(id, (n) => fx.setParam(p.key, n), (n) => n.toFixed(d));
  }
}
