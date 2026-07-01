// Small shared numeric helpers.

// Clamp v into the inclusive range [min, max].
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
