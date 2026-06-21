# Fullscreen Projection Overlay + Easy Calibration — Design

Date: 2026-06-21
Project: videoplaster (Leap-as-IR-camera touch installation)
Status: approved (brainstorm)

## Goal

Run the projection canvas clean and full-screen with a floating control toolbar
that hides/shows on a key combo, and make corner calibration easy to do while
standing at the projection surface.

## Constraints / decisions

- **Canvas stays slider-sized.** No auto-resize to viewport. Operator sizes the
  canvas to the projector once via the existing `canvasW`/`canvasH` sliders.
- **`F` toggles true browser fullscreen** (Fullscreen API on the page) to drop
  browser chrome. The slider-sized canvas centers on a black background.
- **Floating, hideable toolbar** instead of the stacked panel below the canvas.
- Pure UI / overlay / keyboard layer. No change to the WebGL pipeline, water/warp
  shaders, touch sources, or TUIO bridge.
- Persistence reuses the existing `persist.js` localStorage store.
- YAGNI: no named calibration presets (explicitly deferred).

## Layout

- `body`: full-viewport black, no padding.
- `#wrap` (`glCanvas` + `pinCanvas`): centered in the viewport, kept at the
  slider-controlled width/height.
- `#ui`: detached from normal flow into a **floating overlay panel** —
  `position: fixed`, anchored to the left edge, semi-transparent dark background,
  `max-height: 100vh`, `overflow-y: auto`. The projection shows through/behind it.
- The status readout stays inside the panel.

## Toggle + fullscreen behavior

| Key | Action |
|-----|--------|
| `H` | Hide/show the `#ui` panel. |
| `F` | Toggle `document.fullscreenElement` for the whole page. |
| `Esc` | Force-show the panel (panic key). Browser also natively exits fullscreen on `Esc`; the two pair naturally. |

- The keyboard handler is **ignored when focus is in an `input` or `select`** so
  that arrow-key nudging (below) and typing in controls do not clash with the
  global keys.
- Panel-hidden and grid-on states persist via `persist.js`. Selected-corner is
  transient (not persisted).
- **Cursor auto-hide:** the mouse cursor is always visible while moving and
  auto-hides after 15s of no `mousemove`, reappearing on the next move. This is
  independent of the `H` panel toggle (`idleMs` default 15000 in `installOverlay`).

## Calibration aids

### Arrow-key corner nudge
- Click near a warp corner handle → selects that corner (drawn highlighted).
- `←↑→↓` nudge the selected corner offset by 1px; `Shift+arrow` by 10px.
- Nudging routes through the existing `syncPinSlider(k, axis, val)` so the slider
  readout, `warp.setPinOffset`, and persisted value all stay in sync.
- Offsets stay clamped to the existing `[-400, 400]` range (`clampOff`).

### Bigger on-screen pin handles
- Increase `PIN_HIT` and the drawn handle radius for easy grabbing from a distance.
- Keep corner labels always visible.
- **Drop the `if (bg.hasMedia) return` guards** in `drawPins`/`startPinDrag` so
  handles remain visible and draggable even when media is loaded.

### Calibration test grid
- A checkbox in a new "Projection" section of the panel toggles a grid overlay.
- Optional key `G` mirrors the checkbox.
- Drawn on `pinCanvas` in canvas space: regular grid lines + center crosshair +
  corner markers. Used to align the projector to the physical surface before
  warping.

## Components / files

- `index.html` — CSS for full-viewport black body, centered `#wrap`, floating
  `#ui` overlay; new "Projection" section with the grid checkbox.
- `js/ui-overlay.js` (new) — keyboard layer (H/F/Esc/G + arrow nudge),
  panel hide/show, cursor hide, fullscreen toggle, selected-corner state. Pure
  functions for the testable bits exported separately.
- `js/app.js` — wire `ui-overlay.js`; expose corner selection + nudge into the
  existing pin drag code; call grid draw from the render loop / `drawPins`.
- Grid drawing lives next to `drawPins` (same `pinCanvas` 2D context).

## Data flow

1. Keydown → `ui-overlay` handler (guarded against input focus).
2. H → toggle panel `display` + `body` cursor + persist; F → Fullscreen API;
   Esc → show panel; G → toggle grid + persist; arrows → nudge selected corner
   via `syncPinSlider`.
3. Render loop unchanged; `drawPins` additionally draws the grid when enabled and
   highlights the selected corner.

## Error / edge handling

- Fullscreen API rejection (e.g. not user-gesture) → caught, no-op, status note.
- No corner selected + arrow press → ignored.
- Key handler no-ops while typing in a control.
- Grid + handles both draw on `pinCanvas`; cleared each frame as today.

## Testing

- **Unit (Vitest, matching existing `*.test.js`):**
  - Nudge math: 1px vs `Shift` 10px step, clamp to `[-400, 400]`, correct axis.
  - Grid line generation: line coordinates for a given canvas size + spacing.
- **Manual / Playwright smoke:**
  - `H` hides the panel and cursor; `Esc` reveals it.
  - `F` enters/exits fullscreen.
  - Click a corner + arrow keys change that pin's slider value.
  - Grid checkbox toggles the overlay.

## Out of scope

- Named/multi calibration presets.
- Canvas auto-resize to viewport.
- Any change to detection, water/warp shaders, sources, or the bridge.
