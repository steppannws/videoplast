// Single source of truth for control defaults. Consumed by the IR pipeline, the
// source manager, and the declarative control config — so a default lives in one
// place instead of being copied across TS state and HTML `value=` attributes.
import type { DetOpt, MirrorOpt, TouchMap } from "../types/index.ts";

export const DET_DEFAULTS: DetOpt = {
  threshold: 40, minArea: 20, maxArea: 8000, blurAmt: 1, erosionAmt: 2, invert: false,
  brightness: 0, contrast: 1, absDiff: false,
  motion: false, motionRate: 0.05,
};

// Without `map`: callers that need the runtime field add `map: null` themselves.
export const UNDIST_DEFAULTS: { on: boolean; k1: number; k2: number } = {
  on: false, k1: -0.3, k2: 0,
};

export const MIRROR_DEFAULTS: MirrorOpt = { x: false, y: false };

export const TOUCHMAP_DEFAULTS: TouchMap = { offX: 0, offY: 0, scaleX: 1, scaleY: 1 };

export const CANVAS_DEFAULTS = { w: 800, h: 500 };
