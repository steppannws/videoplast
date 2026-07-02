// Declarative description of the control panel. The single place that lists every
// control's id / label / range / default — mirrored 1:1 from the original hand-written
// markup in index.html, with slider defaults sourced from config/defaults.ts so a
// value is never duplicated between TS state and HTML.
import type { SectionCfg, Item } from "../ui/control-factory.ts";
import type { TouchMap } from "../types/index.ts";
import { DET_DEFAULTS, UNDIST_DEFAULTS, CANVAS_DEFAULTS, TOUCHMAP_DEFAULTS } from "./defaults.ts";

// Max magnitude of a warp control-point offset (px). Wide enough to move the content
// across the frame and scale it up ~3×.
export const PIN_LIMIT = 2000;

// The numeric DetOpt fields (everything except the boolean `invert`).
export type NumericDetKey = "threshold" | "minArea" | "maxArea" | "blurAmt" | "erosionAmt" | "brightness" | "contrast" | "motionRate";

// Slider id -> DetOpt key + integer flag. Drives both the IR-detect sliders below
// and the typed wiring in the source controller (no stringly-typed `as any`).
export const DET_SLIDERS: ReadonlyArray<{ id: string; key: NumericDetKey; int: boolean }> = [
  { id: "threshold", key: "threshold", int: false },
  { id: "minArea", key: "minArea", int: false },
  { id: "maxArea", key: "maxArea", int: false },
  { id: "blur", key: "blurAmt", int: true },
  { id: "erosion", key: "erosionAmt", int: true },
  { id: "brightness", key: "brightness", int: true },
  { id: "contrast", key: "contrast", int: false },
  { id: "motionRate", key: "motionRate", int: false },
];

// Touch-UV affine sliders: slider id -> TouchMap key. Wired in the source controller.
export const TOUCHMAP_SLIDERS: ReadonlyArray<{ id: string; key: keyof TouchMap }> = [
  { id: "touchOffX", key: "offX" },
  { id: "touchOffY", key: "offY" },
  { id: "touchScaleX", key: "scaleX" },
  { id: "touchScaleY", key: "scaleY" },
];

const slider = (
  id: string, label: string, min: number, max: number, step: number, value: number, unit = "",
): Item => ({ kind: "slider", id, label, min, max, step, value, unit });

export const PANEL: SectionCfg[] = [
  // Projection
  { rows: [
    { items: [
      { kind: "slabel", text: "Projection" },
      { kind: "checkbox", id: "fitScreen", label: "FIT SCREEN", checked: true },
      { kind: "checkbox", id: "testPattern", label: "TEST PATTERN" },
      { kind: "checkbox", id: "showTouches", label: "SHOW TOUCHES" },
      { kind: "checkbox", id: "warpEdit", label: "WARP GRID", checked: true },
      { kind: "button", id: "modeCorners", label: "CORNERS" },
      { kind: "button", id: "modeMesh", label: "MESH" },
      { kind: "button", id: "removeCol", label: "−COL" },
      { kind: "button", id: "removeRow", label: "−ROW" },
      { kind: "button", id: "resetPins", label: "RESET WARP" },
      { kind: "button", id: "zoomOut", label: "ZOOM OUT" },
      { kind: "button", id: "zoomIn", label: "ZOOM IN" },
    ] },
    { items: [{ kind: "valtext", text: "H hide · F fullscreen · Tab corners/mesh · dbl-click line = split · Ctrl+Z undo · arrows nudge · drag inside to move · ZOOM scale" }] },
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
        { value: "ir-camera", label: "CAMERA" },
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

  // IR DETECT
  { rows: [
    { items: [
      { kind: "slabel", text: "IR DETECT" },
      { kind: "button", id: "captureBg", label: "CAPTURE BG" },
      { kind: "button", id: "resetZone", label: "RESET ZONE" },
      { kind: "button", id: "restartIr", label: "RESTART IR" },
      { kind: "checkbox", id: "invert", label: "INVERT" },
      { kind: "checkbox", id: "diffMode", label: "DIFF MODE" },
      { kind: "checkbox", id: "motion", label: "MOTION" },
      { kind: "checkbox", id: "mirrorX", label: "MIRROR X" },
      { kind: "checkbox", id: "mirrorY", label: "MIRROR Y" },
      slider("brightness", "BRIGHTNESS", -128, 128, 1, DET_DEFAULTS.brightness),
      slider("contrast", "CONTRAST", 0, 3, 0.05, DET_DEFAULTS.contrast),
      slider("threshold", "THRESHOLD", 0, 255, 1, DET_DEFAULTS.threshold),
      slider("minArea", "MIN AREA", 0, 500, 1, DET_DEFAULTS.minArea),
      slider("maxArea", "MAX AREA", 100, 20000, 100, DET_DEFAULTS.maxArea),
      slider("blur", "BLUR", 0, 6, 1, DET_DEFAULTS.blurAmt),
      slider("erosion", "EROSION", 0, 6, 1, DET_DEFAULTS.erosionAmt),
      slider("motionRate", "MOTION RATE", 0.01, 0.5, 0.01, DET_DEFAULTS.motionRate),
      { kind: "checkbox", id: "undistort", label: "FISHEYE" },
      slider("undistK1", "K1", -1, 1, 0.01, UNDIST_DEFAULTS.k1),
      slider("undistK2", "K2", -0.5, 0.5, 0.01, UNDIST_DEFAULTS.k2),
    ] },
    { items: [
      { kind: "canvas", id: "irPreview", width: 320, height: 240 },
      { kind: "canvas", id: "irMaskPreview", width: 320, height: 240 },
    ] },
  ] },

  // TOUCH MAP: fine-tune touch alignment with the projected canvas (post-ROI UV nudge).
  { rows: [{ items: [
    { kind: "slabel", text: "TOUCH MAP" },
    slider("touchOffX", "OFF X", -0.5, 0.5, 0.005, TOUCHMAP_DEFAULTS.offX),
    slider("touchOffY", "OFF Y", -0.5, 0.5, 0.005, TOUCHMAP_DEFAULTS.offY),
    slider("touchScaleX", "SCALE X", 0.5, 2, 0.01, TOUCHMAP_DEFAULTS.scaleX),
    slider("touchScaleY", "SCALE Y", 0.5, 2, 0.01, TOUCHMAP_DEFAULTS.scaleY),
  ] }] },

  // Config: export / import / hand-edit the whole settings JSON blob.
  { rows: [{ items: [
    { kind: "slabel", text: "Config" },
    { kind: "button", id: "cfgExport", label: "EXPORT" },
    { kind: "file", id: "cfgImport", label: "IMPORT", accept: "application/json,.json" },
    { kind: "button", id: "cfgEdit", label: "EDIT JSON" },
  ] }] },

  // Status
  { rows: [{ items: [{ kind: "valtext", text: "ready", id: "status" }] }] },
];
