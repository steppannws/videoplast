// src/ir/preprocess.ts
// Subtract a background frame (both RGBA, grayscale-equal channels). Returns new RGBA
// per pixel, replicated across RGB. Directional by default — max(0, cur-bg) — keeps only
// pixels brighter than background. With abs=true uses |cur-bg|, so a region that goes
// darker than background (e.g. a hand's shadow/reflection) also becomes a bright blob.
export function subtractBackground(cur: Uint8ClampedArray, bg: Uint8ClampedArray, n: number, abs = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const d = cur[i*4] - bg[i*4];
    const v = abs ? Math.abs(d) : Math.max(0, d);
    out[i*4] = out[i*4+1] = out[i*4+2] = v; out[i*4+3] = 255;
  }
  return out;
}

// Per-pixel brightness/contrast on a grayscale-RGBA image. Contrast pivots at mid-gray
// so raising it suppresses the dark IR noise floor while boosting bright touches:
//   out = (v - 128) * contrast + 128 + brightness   (Uint8ClampedArray clamps to 0..255).
// Identity (returns the input unchanged) at brightness=0, contrast=1.
export function applyBrightnessContrast(img: Uint8ClampedArray, n: number, brightness: number, contrast: number): Uint8ClampedArray {
  if (brightness === 0 && contrast === 1) return img;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = (img[i*4] - 128) * contrast + 128 + brightness;
    out[i*4] = out[i*4+1] = out[i*4+2] = v; out[i*4+3] = 255;
  }
  return out;
}
