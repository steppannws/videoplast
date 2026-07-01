// The effect system: one touch-reactive fullscreen GL effect plus its registry types.
import type { TouchEv } from "./domain.ts";

// Static metadata for one tunable parameter; drives the dynamically-built UI.
export interface EffectParam {
  key: string;        // param id; persisted as fx.<effectId>.<key>
  label: string;      // short uppercase UI label
  min: number; max: number; step: number;
  default: number;
}

// One touch-reactive fullscreen GL effect. Sits between the background media and
// the corner-pin warp: takes touch events + a background texture, advances its own
// simulation, and renders a scene texture the warp consumes.
export interface Effect {
  addTouch(ev: TouchEv): void;            // full event (id/x/y/strength/state)
  step(): void;                           // advance the simulation one frame
  setBackground(src: TexImageSource): void;
  renderToTexture(): WebGLTexture;        // scene texture for the warp
  setParam(key: string, value: number): void;
  readonly params: readonly EffectParam[];
}

// Registry entry: a lazy factory + display metadata. List order drives both the
// dropdown order and the number-key index (key "1" -> EFFECTS[0]).
export type EffectFactory = (gl: WebGLRenderingContext) => Effect;
export interface EffectEntry { id: string; label: string; make: EffectFactory; }
