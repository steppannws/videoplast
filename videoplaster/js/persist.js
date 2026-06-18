// videoplaster/js/persist.js
// One localStorage object holds every control value + the capture roi.
const KEY = "vp_settings";

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

let _cache = loadSettings();

export function getSetting(key) { return key in _cache ? _cache[key] : undefined; }

export function saveSetting(key, value) {
  _cache[key] = value;
  localStorage.setItem(KEY, JSON.stringify(_cache));
}

// Restore a control's saved value (if any), apply(value) to sync live state,
// save+apply on change, and (if fmt given + an `id+"v"` element exists) update its readout.
export function bindControl(id, apply, fmt) {
  const el = document.getElementById(id);
  if (!el) return;
  const isCheck = el.type === "checkbox";
  const isSelect = el.tagName === "SELECT";
  const read = () => (isCheck ? el.checked : el.value);
  const write = (v) => { if (isCheck) el.checked = v; else el.value = v; };
  const readout = document.getElementById(id + "v");
  const showVal = (v) => { if (readout && fmt) readout.textContent = fmt(v); };

  const saved = getSetting(id);
  if (saved !== undefined) write(saved);
  apply(read()); showVal(read());

  const evt = (!isCheck && !isSelect) ? "input" : "change";
  el.addEventListener(evt, () => { const v = read(); saveSetting(id, v); apply(v); showVal(v); });
}
