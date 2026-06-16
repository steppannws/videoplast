// videoplaster/js/ir-preprocess.js
// Subtract a background frame (both RGBA, grayscale-equal channels). Returns new RGBA with
// max(0, cur-bg) per pixel, replicated across RGB.
export function subtractBackground(cur, bg, n) {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, cur[i*4] - bg[i*4]);
    out[i*4] = out[i*4+1] = out[i*4+2] = v; out[i*4+3] = 255;
  }
  return out;
}
