// src/ui/persist.ts
// One localStorage object holds every control value + the capture roi.
const KEY = "vp_settings";

export function loadSettings(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null") || {}; }
  catch { return {}; }
}

let _cache: Record<string, unknown> = loadSettings();

export function getSetting<T = unknown>(key: string): T | undefined {
  return key in _cache ? (_cache[key] as T) : undefined;
}

export function saveSetting(key: string, value: unknown): void {
  _cache[key] = value;
  localStorage.setItem(KEY, JSON.stringify(_cache));
}

// Restore a control's saved value (if any), apply(value) to sync live state,
// save+apply on change, and (if fmt given + an `id+"v"` element exists) update its readout.
export function bindControl(
  id: string,
  apply: (v: string | boolean) => void,
  fmt?: (v: string | boolean) => string,
): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!el) return;
  const isCheck = el instanceof HTMLInputElement && el.type === "checkbox";
  const isSelect = el.tagName === "SELECT";
  const read = (): string | boolean => (isCheck ? (el as HTMLInputElement).checked : el.value);
  const write = (v: string | boolean): void => { if (isCheck) (el as HTMLInputElement).checked = Boolean(v); else el.value = String(v); };
  const readout = document.getElementById(id + "v");
  const showVal = (v: string | boolean): void => { if (readout && fmt) readout.textContent = fmt(v); };

  const saved = getSetting(id);
  if (saved !== undefined) write(saved as string | boolean);
  apply(read()); showVal(read());

  const evt = (!isCheck && !isSelect) ? "input" : "change";
  el.addEventListener(evt, () => { const v = read(); saveSetting(id, v); apply(v); showVal(v); });
}

// Typed wrappers over bindControl that remove the parseFloat(String(v)) / Boolean(v)
// coercion noise at call sites. `parse` defaults to parseFloat; pass `(s) => parseInt(s, 10)`
// for integer sliders.
export function bindNumber(
  id: string,
  apply: (n: number) => void,
  fmt?: (n: number) => string,
  parse: (s: string) => number = parseFloat,
): void {
  bindControl(id, (v) => apply(parse(String(v))), fmt ? (v) => fmt(parse(String(v))) : undefined);
}

export function bindBool(id: string, apply: (b: boolean) => void): void {
  bindControl(id, (v) => apply(Boolean(v)));
}

export function bindSelect(id: string, apply: (s: string) => void): void {
  bindControl(id, (v) => apply(String(v)));
}
