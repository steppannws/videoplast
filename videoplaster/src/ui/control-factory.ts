// Reusable DOM builders for the control panel. Generalizes the per-element
// markup that used to be hand-written ~20x in index.html. The `id + "v"` readout
// convention lives here, in one place. Pure DOM — no persistence/wiring (that is
// layered on top via bindControl in the controllers).

// --- declarative item model ------------------------------------------------
export type Item =
  | { kind: "slabel"; text: string }
  | { kind: "valtext"; text: string; id?: string }
  | { kind: "checkbox"; id: string; label: string; checked?: boolean }
  | { kind: "button"; id: string; label: string }
  | { kind: "select"; id: string; options?: { value: string; label: string }[] }
  | { kind: "file"; id: string; label: string; accept: string }
  | { kind: "slider"; id: string; label: string; min: number; max: number; step: number; value: number; unit?: string }
  | { kind: "canvas"; id: string; width: number; height: number };

export interface RowCfg { id?: string; cls?: string; items: Item[]; }
export interface SectionCfg { rows: RowCfg[]; }

// --- element helper --------------------------------------------------------
function h(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const kid of kids) e.append(kid);
  return e;
}

// --- primitive builders ----------------------------------------------------
export function SLabel(text: string): HTMLElement {
  return h("span", { class: "slabel" }, text);
}

export function ValText(text: string, id?: string): HTMLElement {
  return h("span", id ? { class: "val val--auto", id } : { class: "val val--auto" }, text);
}

// .ctrl > label + range input + .val readout (id+"v").
export function Slider(c: Extract<Item, { kind: "slider" }>): HTMLElement {
  const input = h("input", {
    type: "range", id: c.id,
    min: String(c.min), max: String(c.max), step: String(c.step), value: String(c.value),
  });
  const val = h("span", { class: "val", id: c.id + "v" }, String(c.value) + (c.unit ?? ""));
  return h("div", { class: "ctrl" }, h("label", {}, c.label), input, val);
}

export function Checkbox(c: { id: string; label: string; checked?: boolean }): HTMLElement {
  const input = h("input", { type: "checkbox", id: c.id });
  if (c.checked) input.setAttribute("checked", "");
  return h("label", { class: "ctrl" }, input, " " + c.label);
}

export function Button(c: { id: string; label: string }): HTMLElement {
  return h("button", { id: c.id }, c.label);
}

export function Select(c: { id: string; options?: { value: string; label: string }[] }): HTMLElement {
  const sel = h("select", { id: c.id });
  for (const o of c.options ?? []) sel.append(h("option", { value: o.value }, o.label));
  return sel;
}

export function FileButton(c: { id: string; label: string; accept: string }): HTMLElement {
  return h("label", { class: "fbtn" }, c.label, h("input", { type: "file", accept: c.accept, id: c.id }));
}

export function PreviewCanvas(c: { id: string; width: number; height: number }): HTMLElement {
  return h("canvas", { id: c.id, width: String(c.width), height: String(c.height) });
}

export function Row(items: HTMLElement[], opts: { id?: string; cls?: string } = {}): HTMLElement {
  const row = h("div", { class: ("row " + (opts.cls ?? "")).trim() }, ...items);
  if (opts.id) row.id = opts.id;
  return row;
}

export function Section(rows: HTMLElement[]): HTMLElement {
  return h("div", { class: "section" }, ...rows);
}

// --- model -> DOM ----------------------------------------------------------
export function renderItem(it: Item): HTMLElement {
  switch (it.kind) {
    case "slabel": return SLabel(it.text);
    case "valtext": return ValText(it.text, it.id);
    case "checkbox": return Checkbox(it);
    case "button": return Button(it);
    case "select": return Select(it);
    case "file": return FileButton(it);
    case "slider": return Slider(it);
    case "canvas": return PreviewCanvas(it);
  }
}

export function renderPanel(sections: SectionCfg[]): HTMLElement[] {
  return sections.map((s) =>
    Section(s.rows.map((r) => Row(r.items.map(renderItem), { id: r.id, cls: r.cls }))));
}
