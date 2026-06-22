// videoplaster/js/types.ts — shared data shapes for the touch pipeline.
// Names avoid lib.dom clashes: TouchEv (not TouchEvent), DetBlob (not Blob).
export type PinKey = "tl" | "tr" | "br" | "bl";
export type Axis = "x" | "y";
export type TouchState = "down" | "move" | "up";

export interface Roi { x: number; y: number; w: number; h: number; }

export interface DetOpt {
  threshold: number; minArea: number; maxArea: number;
  blurAmt: number; erosionAmt: number; invert: boolean;
}

export interface UndistOpt { on: boolean; k1: number; k2: number; map: Int16Array | null; }
export interface MirrorOpt { x: boolean; y: boolean; }

export interface DetBlob { cx: number; cy: number; area: number; bright: number; }

export interface TouchEv {
  id: number; x: number; y: number; z: number;
  strength: number; state: TouchState;
}

// --- Effect system ---------------------------------------------------------
// One touch-reactive fullscreen GL effect. Sits between the background media and
// the corner-pin warp: takes touch events + a background texture, advances its
// own simulation, and renders a scene texture the warp consumes.

// Static metadata for one tunable parameter; drives the dynamically-built UI.
export interface EffectParam {
  key: string;        // param id; persisted as fx.<effectId>.<key>
  label: string;      // short uppercase UI label
  min: number; max: number; step: number;
  default: number;
}

export interface Effect {
  addTouch(ev: TouchEv): void;            // full event (id/x/y/strength/state)
  step(): void;                           // advance the simulation one frame
  setBackground(src: TexImageSource): void;
  renderToTexture(): WebGLTexture;        // scene texture for the warp
  setParam(key: string, value: number): void;
  readonly params: readonly EffectParam[];
}
