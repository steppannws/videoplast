// src/effects/registry.ts
// Registry of selectable touch effects. Order defines both the dropdown order and
// the number-key index (key "1" → EFFECTS[0], etc.). Factories are lazy: the app
// constructs an effect on first selection and caches the instance.
import type { EffectEntry } from "../types/index.ts";
import { WaterGL } from "./water-gl.ts";
import { InkGL } from "./ink-gl.ts";
import { RevealGL } from "./reveal-gl.ts";
import { ThermalGL } from "./thermal-gl.ts";
import { ShatterGL } from "./shatter-gl.ts";
import { ChromeGL } from "./chrome-gl.ts";
import { KaleidoscopeGL } from "./kaleidoscope-gl.ts";
import { GelGL } from "./gel-gl.ts";
import { SmearGL } from "./smear-gl.ts";
import { PrismGL } from "./prism-gl.ts";

export const EFFECTS: EffectEntry[] = [
  { id: "water", label: "WATER", make: (gl) => new WaterGL(gl) },
  { id: "ink", label: "INK BLOOM", make: (gl) => new InkGL(gl) },
  { id: "reveal", label: "EROSION REVEAL", make: (gl) => new RevealGL(gl) },
  { id: "thermal", label: "THERMAL HEAT", make: (gl) => new ThermalGL(gl) },
  { id: "shatter", label: "SHATTER GLASS", make: (gl) => new ShatterGL(gl) },
  { id: "chrome", label: "LIQUID CHROME", make: (gl) => new ChromeGL(gl) },
  { id: "kaleidoscope", label: "KALEIDOSCOPE", make: (gl) => new KaleidoscopeGL(gl) },
  { id: "gel", label: "LIQUID GEL", make: (gl) => new GelGL(gl) },
  { id: "smear", label: "PAINT SMEAR", make: (gl) => new SmearGL(gl) },
  { id: "prism", label: "CRYSTAL PRISM", make: (gl) => new PrismGL(gl) },
];

export const DEFAULT_EFFECT = "water";

export function effectById(id: string): EffectEntry | undefined {
  return EFFECTS.find((e) => e.id === id);
}
