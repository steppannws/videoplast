# Multi-Effect System + Live Selection — Design

Date: 2026-06-21
Project: videoplaster (Leap-as-IR-camera touch installation)
Status: approved (brainstorm)

## Goal

Generalize the single hard-wired water effect into a pluggable set of
touch-reactive fullscreen GL effects, selectable live via a dropdown and number
keys. Ship 5 new effects alongside the existing water, each visually distinct and
driven by the same touch pipeline and background media, each rendering into a
texture the corner-pin warp consumes — exactly where water sits today.

## Effects

| Key | id        | Label          | Idea |
|-----|-----------|----------------|------|
| 1   | `water`   | WATER          | (existing) wave-equation height field distorts bg; brightness from \|height\|. |
| 2   | `ink`     | INK BLOOM      | Fluid dye advection (Navier-Stokes-lite). Touch injects colored dye + velocity (from finger momentum); dye swirls over bg and dissipates. |
| 3   | `reveal`  | EROSION REVEAL | A cover layer hides the bg; touch erodes the cover to reveal bg underneath; cover heals back over seconds. |
| 4   | `thermal` | THERMAL HEAT   | Touch deposits heat into a field that diffuses + cools; render distorts bg and tints it with a thermal palette by heat. |
| 5   | `shatter` | SHATTER GLASS  | Touch accumulates cracks; render refracts bg along voronoi cell gradients; cracks decay. |
| 6   | `particles` | PARTICLE CHAOS | GPU particle field; per-particle pos+vel in a float texture, advanced by curl-noise + touch repel/attract, additive colored points with cycling hue over bg. (User request: shifting colors + directions creating chaos.) |

Hard-cut switching (no crossfade — explicitly chosen).

## Architecture (Approach A: Effect interface + registry)

Rejected alternatives: (B) concrete classes + per-effect `if/else` in app loop —
`app.ts` bloats, every new effect touches many places; (C) one mega-shader with a
mode uniform — fluid/particles/reveal need different state textures and multi-pass
ping-pong that cannot be unified into one program.

### Effect interface (`types.ts`)

```ts
export interface EffectParam {
  key: string;          // param id, persisted as fx.<effectId>.<key>
  label: string;        // UI label (uppercase short)
  min: number; max: number; step: number;
  default: number;
}

export interface Effect {
  addTouch(ev: TouchEv): void;          // full event (id/x/y/strength/state)
  step(): void;
  setBackground(src: TexImageSource): void;
  renderToTexture(): WebGLTexture;
  setParam(key: string, value: number): void;
  readonly params: readonly EffectParam[];
}
```

- `addTouch(ev)` replaces the loop's `water.addDrop(...)` call. Each effect derives
  what it needs from the event. Effects that want velocity/direction (ink,
  particles) track the **last point per touch `id`** internally and compute a
  delta on `move`; on `up` they drop the id. Effects that only need a splat
  (water, reveal, thermal, shatter) use `x/y/strength` on `down`/`move` and ignore
  `up`, matching today's `if (ev.state !== "up")` behavior.
- `params` is static metadata per effect → app generates the slider UI and wires
  `setParam`. No `renderToScreen` in the interface — the warp always consumes the
  returned texture (the existing `renderToScreen` on water is unused by the loop
  and is dropped).

### Shared GL helpers (`gl-util.ts`, extracted from `water-gl.ts`)

Pull the duplicated boilerplate out so every effect builds on it:

- `compile(gl, type, src)`, `program(gl, vs, fs)` — shader/program with error throw.
- `QUAD_VS`, `quadBuffer(gl)`, `bindQuad(gl, prog, buf)` — fullscreen triangle-strip.
- `negotiateFloat(gl)` → `{ type, floatLinear }` — OES_texture_float +
  OES_texture_float_linear + (WEBGL_color_buffer_float | EXT_color_buffer_float),
  with the existing 8-bit `UNSIGNED_BYTE` fallback and the same console warnings.
- `makeTex(gl, w, h, {fmt, type, filter})` — texture alloc with CLAMP_TO_EDGE and
  LINEAR/NEAREST selection (NEAREST when float + no float-linear).
- `drawTo(gl, fbo, tex, w, h)` — bind FBO + attach color target + set viewport.

`water-gl.ts` is refactored to use these and to implement `Effect` (its internals
stay; `addDrop` becomes the body of `addTouch`, and `params` lists
intensity/radius/viscosity).

### Effect files (one per effect, all in `src/`)

Each constructs its own programs + state textures from `gl-util`, sized to an
internal sim resolution independent of the canvas (water's 512×320 is the
reference), uploads the bg each frame via `setBackground`, and returns its scene
texture from `renderToTexture`.

- `ink-gl.ts` — double-buffered velocity + dye textures. Passes per `step`:
  inject (touch point + momentum into velocity, dye color into dye) → advect
  (semi-Lagrangian) → fade/diffuse. Render: sample dye, composite over bg with a
  little refraction from velocity. Params: `dye`, `swirl`, `fade`.
- `reveal-gl.ts` — single cover-amount texture (1 = covered, 0 = revealed). Passes:
  paint (touch subtracts cover in a brush radius) → heal (add back toward 1 by
  `heal`). Render: `mix(coverColor, bg, 1 - cover)` where cover color is a dark/
  noise layer. Params: `brush`, `heal`, `cover` (cover style 0..n as a stepped param).
- `thermal-gl.ts` — heat texture. Passes: deposit (touch adds heat) → diffuse +
  cool (blur toward neighbors, multiply by `cool`). Render: distort bg by heat
  gradient + blend a thermal gradient palette weighted by heat. Params: `heat`,
  `spread`, `cool`, `distort`.
- `shatter-gl.ts` — crack-accumulation texture seeded at touch points (feature
  points for a voronoi/cellular distance field). Passes: add seed → decay. Render:
  refract bg along the cell-gradient (offset uv by distance-field gradient) + bright
  crack lines at cell borders. Params: `density`, `refract`, `decay`.
- `particles-gl.ts` — particle state packed in a float texture (RG = pos, BA = vel),
  N = `count`² particles. Passes: update (curl-noise field advance + touch
  repel/attract force using nearest touch points + wrap/respawn). Render: a static
  index buffer drives a vertex shader that fetches each particle's pos from the
  state texture (WebGL1 vertex texture fetch), draws additive `gl.POINTS` with a
  hue that cycles per particle, composited over bg. Params: `count`, `chaos`,
  `force`, `fade`. Float-texture dependent; on the 8-bit fallback the field still
  runs at reduced precision (documented degradation, not a hard failure).

### Registry (`effects.ts`)

```ts
type EffectFactory = (gl: WebGLRenderingContext) => Effect;
export interface EffectEntry { id: string; label: string; make: EffectFactory; }
export const EFFECTS: EffectEntry[];          // order = key order 1..6
```

- Lazy construction: instances built on first selection, cached in a `Map<id,
  Effect>` so switching back preserves state. Modest GPU memory (sim textures are
  small); no disposal.
- Ids unique; order in `EFFECTS` defines both dropdown order and number-key index.

### App wiring (`app.ts`)

- Replace the `water` singleton with `let active: Effect` + a `setEffect(id)` that:
  looks up / lazily builds the instance, sets `active`, rebuilds the param UI for
  that effect, persists `fx.active`, updates the dropdown + status.
- `wire()` calls `active.addTouch(ev)` (always — effects decide what to do with
  each state) instead of the water-specific `addDrop` guard.
- Render loop unchanged in shape:
  `bg.draw → active.setBackground(bg.canvas) → active.step() → tex =
  active.renderToTexture() → warp.draw(tex)`.
- On boot: read `fx.active` (default `water`), call `setEffect`.

### UI (`index.html` + dynamic build in `app.ts`)

- Remove the static **Water** section. Add an **EFFECT** section:
  `<select id="effectSel">` (options from `EFFECTS`) + an empty
  `<div id="effectParams">` container.
- `setEffect` clears `#effectParams` and generates one `.ctrl` slider per
  `EffectParam` (same markup the existing controls use: range input + `.val`
  readout). `bindControl(id, apply, fmt)` keys persistence by the element's DOM
  `id` and reads the readout from `id + "v"`, so each generated slider's element
  id is literally `fx.<id>.<key>` and its readout `fx.<id>.<key>v`. `apply` calls
  `active.setParam(key, +value)`. The `EffectParam.default` is set as the input's
  `value` before binding, so `bindControl` uses it when no saved value exists.
- Number keys `1`..`6` switch effects, handled in `ui-overlay.ts` alongside the
  existing H/F/Esc/G keys and **guarded by the same `isEditing()` input-focus
  check**. `installOverlay` gains an `onSelectEffect(index)` callback; `app.ts`
  passes one that maps index → `EFFECTS[index].id` → `setEffect`.

## Data flow

1. Touch (mouse / leap) → `wire` → `active.addTouch(ev)` + `emitter.send(ev)`.
2. Loop steps the active effect and warps its output texture (unchanged shape).
3. Dropdown change or number key → `setEffect(id)` → swap active, rebuild params,
   persist.
4. Param slider → `bindControl` → `active.setParam(key, value)` → persisted under
   `fx.<id>.<key>`.

## Error / edge handling

- Float-texture unavailable → effects fall back to 8-bit (shared
  `negotiateFloat`), same as water today; particles degrade in precision.
- Unknown / missing `fx.active` in storage → default to `water`.
- Number key with focus in an input/select → ignored (existing `isEditing` guard).
- Switching effect mid-touch: old per-id tracking is on the old instance; new
  instance starts clean. Acceptable (hard-cut).
- Shader compile/link failure throws at construction (as water does now); caught
  at `setEffect` → status message, keep previous active effect.

## Components / files

- `src/types.ts` — add `Effect`, `EffectParam`.
- `src/gl-util.ts` (new) — extracted shared GL helpers.
- `src/water-gl.ts` — refactor onto `gl-util` + implement `Effect`.
- `src/ink-gl.ts`, `src/reveal-gl.ts`, `src/thermal-gl.ts`, `src/shatter-gl.ts`,
  `src/particles-gl.ts` (new) — the 5 new effects.
- `src/effects.ts` (new) — registry + lazy cache.
- `src/ui-overlay.ts` — number-key handling + `onSelectEffect` callback.
- `src/app.ts` — `active`/`setEffect`, dynamic param UI, loop swap, boot restore.
- `index.html` — replace Water section with EFFECT section (dropdown + params container).

## Testing

- **Unit (Vitest, matching existing `*.test.ts`):**
  - `effects.ts`: ids unique, order = key order, every factory listed, labels present.
  - Each effect: `params` well-formed (min<max, default in range, unique keys),
    `setParam` updates the targeted field (test via a stubbed/no-GL path where the
    field is plain state, e.g. param→property mapping).
  - `gl-util`: `negotiateFloat` selects FLOAT when extensions present, falls back
    to UNSIGNED_BYTE otherwise (mock `getExtension`).
  - `ui-overlay`: number key fires `onSelectEffect` with the right index and is
    suppressed while `isEditing()` is true.
- **Manual / Playwright smoke:** each effect renders and reacts to mouse touch;
  dropdown + keys 1–6 switch live; params persist across reload; switch back
  preserves a running sim where applicable.

## Out of scope

- Crossfade / transition animation between effects (hard-cut chosen).
- Per-effect background presets, effect chaining/stacking, audio reactivity.
- Saving/loading named effect+param presets.
- Any change to detection, sources, warp/corner-pin, or the TUIO bridge.
- New effects beyond the six listed (the registry makes adding more a 1-file step
  later).
