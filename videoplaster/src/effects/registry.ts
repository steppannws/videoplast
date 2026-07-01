// videoplaster/src/effects.ts
// Registry of selectable touch effects. Order defines both the dropdown order and
// the number-key index (key "1" → EFFECTS[0], etc.). Factories are lazy: the app
// constructs an effect on first selection and caches the instance.
import type { EffectEntry } from "../types/index.ts";
import { WaterGL } from "./water-gl.ts";
import { InkGL } from "./ink-gl.ts";
import { RevealGL } from "./reveal-gl.ts";
import { ThermalGL } from "./thermal-gl.ts";
import { ShatterGL } from "./shatter-gl.ts";
import { ParticlesGL } from "./particles-gl.ts";

export const EFFECTS: EffectEntry[] = [
  { id: "water", label: "WATER", make: (gl) => new WaterGL(gl) },
  { id: "ink", label: "INK BLOOM", make: (gl) => new InkGL(gl) },
  { id: "reveal", label: "EROSION REVEAL", make: (gl) => new RevealGL(gl) },
  { id: "thermal", label: "THERMAL HEAT", make: (gl) => new ThermalGL(gl) },
  { id: "shatter", label: "SHATTER GLASS", make: (gl) => new ShatterGL(gl) },
  { id: "particles", label: "PARTICLE CHAOS", make: (gl) => new ParticlesGL(gl) },
];

export const DEFAULT_EFFECT = "water";

export function effectById(id: string): EffectEntry | undefined {
  return EFFECTS.find((e) => e.id === id);
}
