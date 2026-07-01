// Shared data shapes for the touch pipeline.
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
