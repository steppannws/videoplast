// Declarative description of the control panel. The single place that lists every
// control's id / label / range / default — mirrored 1:1 from the original hand-written
// markup in index.html, with slider defaults sourced from config/defaults.ts so a
// value is never duplicated between TS state and HTML.
import type { SectionCfg, Item } from "../ui/control-factory.ts";
import type { PinKey, Axis } from "../types/index.ts";
import { DET_DEFAULTS, UNDIST_DEFAULTS, CANVAS_DEFAULTS } from "./defaults.ts";

export const PIN_KEYS: readonly PinKey[] = ["tl", "tr", "br", "bl"];
export const AXES: readonly Axis[] = ["x", "y"];

// The numeric DetOpt fields (everything except the boolean `invert`).
export type NumericDetKey = "threshold" | "minArea" | "maxArea" | "blurAmt" | "erosionAmt";

// Slider id -> DetOpt key + integer flag. Drives both the IR-detect sliders below
// and the typed wiring in the source controller (no stringly-typed `as any`).
export const DET_SLIDERS: ReadonlyArray<{ id: string; key: NumericDetKey; int: boolean }> = [
  { id: "threshold", key: "threshold", int: false },
  { id: "minArea", key: "minArea", int: false },
  { id: "maxArea", key: "maxArea", int: false },
  { id: "blur", key: "blurAmt", int: true },
  { id: "erosion", key: "erosionAmt", int: true },
];

const slider = (
  id: string, label: string, min: number, max: number, step: number, value: number, unit = "",
): Item => ({ kind: "slider", id, label, min, max, step, value, unit });

// One Pin row per corner: a label + X/Y offset sliders.
const pinRow = (k: PinKey) => ({
  items: [
    { kind: "slabel", text: `Pin ${k.toUpperCase()}` } as Item,
    slider(`${k}x`, "X", -400, 400, 1, 0, "px"),
    slider(`${k}y`, "Y", -400, 400, 1, 0, "px"),
  ],
});

export const PANEL: SectionCfg[] = [
  // Projection
  { rows: [
    { items: [
      { kind: "slabel", text: "Projection" },
      { kind: "checkbox", id: "fitScreen", label: "FIT SCREEN", checked: true },
      { kind: "checkbox", id: "grid", label: "TEST GRID" },
      { kind: "button", id: "resetPins", label: "RESET ANCHORS" },
    ] },
    { items: [{ kind: "valtext", text: "H hide · F fullscreen · Esc show · click pin + ←↑→↓ nudge (Shift ×10)" }] },
  ] },

  // Canvas
  { rows: [{ items: [
    { kind: "slabel", text: "Canvas" },
    slider("canvasW", "WIDTH", 200, 1400, 10, CANVAS_DEFAULTS.w, "px"),
    slider("canvasH", "HEIGHT", 150, 900, 10, CANVAS_DEFAULTS.h, "px"),
  ] }] },

  // Source
  { rows: [
    { items: [
      { kind: "slabel", text: "Source" },
      { kind: "select", id: "sourceSel", options: [
        { value: "mouse", label: "MOUSE" },
        { value: "leap-ir", label: "LEAP IR" },
        { value: "pseye", label: "PS EYE" },
        { value: "ir-camera", label: "IR CAMERA" },
        { value: "leap-z", label: "LEAP Z" },
      ] },
    ] },
    { id: "camDeviceRow", cls: "hidden", items: [
      { kind: "slabel", text: "Camera" },
      { kind: "select", id: "camDevice" },
    ] },
  ] },

  // Image
  { rows: [{ items: [
    { kind: "slabel", text: "Image" },
    { kind: "file", id: "bgFile", label: "LOAD", accept: "image/*,video/*" },
    { kind: "button", id: "bgClear", label: "CLEAR" },
    slider("imgScaleX", "SCALE X", 0.1, 3, 0.05, 1, "x"),
    slider("imgScaleY", "SCALE Y", 0.1, 3, 0.05, 1, "x"),
    slider("imgRot", "ROT", -180, 180, 1, 0),
  ] }] },

  // Effect (effectSel filled by the app; #effectParams populated per active effect)
  { rows: [
    { items: [
      { kind: "slabel", text: "Effect" },
      { kind: "select", id: "effectSel" },
      { kind: "valtext", text: "keys 1-6" },
    ] },
    { id: "effectParams", items: [] },
  ] },

  // Pins
  { rows: PIN_KEYS.map(pinRow) },

  // IR DETECT
  { rows: [
    { items: [
      { kind: "slabel", text: "IR DETECT" },
      { kind: "button", id: "captureBg", label: "CAPTURE BG" },
      { kind: "button", id: "resetZone", label: "RESET ZONE" },
      { kind: "button", id: "restartIr", label: "RESTART IR" },
      { kind: "checkbox", id: "invert", label: "INVERT" },
      { kind: "checkbox", id: "mirrorX", label: "MIRROR X" },
      { kind: "checkbox", id: "mirrorY", label: "MIRROR Y" },
      slider("threshold", "THRESHOLD", 0, 255, 1, DET_DEFAULTS.threshold),
      slider("minArea", "MIN AREA", 0, 500, 1, DET_DEFAULTS.minArea),
      slider("maxArea", "MAX AREA", 100, 20000, 100, DET_DEFAULTS.maxArea),
      slider("blur", "BLUR", 0, 6, 1, DET_DEFAULTS.blurAmt),
      slider("erosion", "EROSION", 0, 6, 1, DET_DEFAULTS.erosionAmt),
      { kind: "checkbox", id: "undistort", label: "FISHEYE" },
      slider("undistK1", "K1", -1, 1, 0.01, UNDIST_DEFAULTS.k1),
      slider("undistK2", "K2", -0.5, 0.5, 0.01, UNDIST_DEFAULTS.k2),
    ] },
    { items: [{ kind: "canvas", id: "irPreview", width: 320, height: 240 }] },
  ] },

  // Status
  { rows: [{ items: [{ kind: "valtext", text: "ready", id: "status" }] }] },
];
