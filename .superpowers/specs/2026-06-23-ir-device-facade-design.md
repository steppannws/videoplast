# IR Device Facade — Leap, PS Eye, Generic IR Camera — Design

Date: 2026-06-23
Project: videoplaster (Leap-as-IR-camera touch installation)
Status: approved (brainstorm)

## Goal

Decouple the IR touch detection from any single sensor so the installation can run
on different IR devices: the Leap Motion (current), a PlayStation Eye (IR-modded),
and any generic UVC IR webcam — selectable from the source dropdown. Introduce a
facade on each side of the existing seam: a **frontend frame-provider facade** and a
**bridge device facade**, joined by the unchanged WS frame protocol.

## Background — the seam today

`LeapImageSource` mixes two concerns:
1. **Transport** — WebSocket `:7681`, receives packed IR frames (`u32 w, u32 h`,
   then `w*h` bytes of 8-bit gray).
2. **IR pipeline** — gray → RGBA, mirror, undistort, background-subtract, blob
   detect, ROI map, track → emit `TouchEv`.

The pipeline is already device-agnostic (it operates on a grayscale frame). Only the
transport is Leap-specific. The bridge (Python) hardcodes LeapC capture. The facade
work splits both sides along this existing seam.

## Decisions

- **Three IR devices, all selectable, plus mouse:** MOUSE · LEAP IR · PS EYE ·
  IR CAMERA · LEAP Z.
- **PS Eye via `pseyepy`** (libusb, no OS driver, 640×480@60) inside the bridge,
  pushing the existing WS frame protocol. Robust on macOS.
- **Generic IR camera via `getUserMedia`** in the browser/WKWebView — no bridge, no
  native deps, any OS. Covers any UVC IR webcam (incl. a PS Eye if a UVC driver
  exposes it).
- **No OpenCV generic-camera bridge** — getUserMedia covers generic cameras (YAGNI).
- **Keep Leap.** The Leap path stays as a WS-provider device.
- **Live device switch** for the WS devices via a WS control message (no sidecar
  relaunch).

## Frontend — frame-provider facade

### `IrTouchPipeline` (extracted from `LeapImageSource`)
- Owns: `opt: DetOpt`, `undist: UndistOpt`, `roi: Roi`, `mirror: MirrorOpt`,
  `tracker: BlobTracker`, `bg`, `frame`, `previewCb`, `captureBackground()`,
  `setRoi()`.
- `process(gray: Uint8Array | Uint8ClampedArray, w: number, h: number): void` — the
  current `_onFrame` body minus the WS parsing: gray→RGBA, mirror, undistort,
  bg-subtract, `findBlobs`, `roiMap`, `tracker.update`, then call an injected
  `emit(ev)` for each event and `previewCb`.
- Device-agnostic and unit-testable without any transport.

### `IrFrameProvider` interface
```
interface IrFrameProvider {
  start(): void;
  stop(): void;
  onFrame(cb: (w: number, h: number, gray: Uint8Array) => void): void;
  onStatus(cb: (state: string) => void): void;
}
```

- `WsFrameProvider(url, device)` — the current WS transport. On open it sends a
  control message `{type:"device", name:device}` then forwards each binary frame as
  `(w,h,gray)`. Reconnect loop preserved. `device` ∈ `"leap" | "pseye"`.
- `CameraFrameProvider(deviceId?)` — `getUserMedia({video:{deviceId}})` → hidden
  `<video>` → draw to an offscreen `<canvas>` each rAF → `getImageData` → luma
  (`0.299R+0.587G+0.114B`, or just R for IR) into a reused `Uint8Array` → `onFrame`.
  Exposes a static `listCameras()` (`enumerateDevices`, kind `videoinput`) for the
  picker. Stops tracks on `stop()`.

### `IrSource` (a `TouchSource`)
- Composes a pipeline + a provider: `provider.onFrame((w,h,g) => pipeline.process(g,w,h))`,
  pipeline emits via `this.emit`. `start/stop` delegate to the provider. Exposes the
  pipeline's calibration surface (`opt`, `undist`, `roi`, `mirror`, `captureBackground`,
  `setRoi`, `previewCb`, `statusCb`) so the existing calibration UI binds unchanged,
  plus `restart()` (delegates to the provider: WS reconnect / camera stop-start) for
  the existing RESTART IR button.
- Replaces `LeapImageSource`. The three IR devices are `IrSource` instances:
  - LEAP IR → `new IrSource(new WsFrameProvider(url, "leap"))`
  - PS EYE → `new IrSource(new WsFrameProvider(url, "pseye"))`
  - IR CAMERA → `new IrSource(new CameraFrameProvider(deviceId))`

### UI (`index.html` + `app.ts`)
- Source dropdown gains `pseye` and `ir-camera` options.
- A camera picker `<select id="camDevice">` (hidden unless IR CAMERA is selected),
  populated from `CameraFrameProvider.listCameras()`; selecting one restarts the
  source with that `deviceId`. Persist the chosen `deviceId` and the device.
- `setSource` builds the right `IrSource`; the calibration handlers (today keyed on
  `leapSrc`) bind to the active `IrSource` (rename `leapSrc` → `irSrc`).
- Relabel the "Leap IR" controls section to device-neutral **"IR DETECT"**. The
  CAPTURE BG / RESET ZONE / RESTART / threshold / mirror / undistort controls are
  device-agnostic and serve all three IR devices.

## Bridge — device facade (Python)

### `IrDevice` interface
- `start(on_frame: Callable[[int,int,bytes], None]) -> None`
- `stop() -> None`

### Implementations
- `LeapDevice` — the current LeapC capture (`_extract_left`, `leap.Connection`,
  `PolicyFlag.Images`) refactored behind the interface; calls `on_frame(w,h,gray)`.
- `PsEyeDevice` — `pseyepy.Camera(fps=60, resolution=RES_LARGE)`; a capture thread
  reads frames, converts to grayscale (luma or channel 0) as `bytes`, calls
  `on_frame(w,h,gray)`. Exposure/gain left at sensible defaults (config later).

### `DeviceManager`
- Holds the active `IrDevice`. `select(name)` stops the current device and starts the
  named one (`"leap" | "pseye" | "none"`); idempotent if already active. Default from
  the `--device` flag.
- The captured frame feeds the existing `LATEST_IMAGE` buffer + `seq` so `push_images`
  broadcast is unchanged.

### WS protocol
- `handler` now discriminates inbound JSON: a `"type"` field → control message
  (`{"type":"device","name":...}` → `DeviceManager.select`); otherwise the existing
  touch event → `tuio.handle`. Binary frames out, TUIO UDP out — both unchanged.
- New CLI flag `--device leap|pseye|none` (default `leap` for back-compat).

## Tauri

- The bridge sidecar build (`scripts/build-bridge.sh`) adds `pseyepy` + `numpy`;
  PyInstaller must bundle the libusb native lib (the fiddly bit — documented;
  `--collect-all pseyepy`, copy `libusb` if not embedded).
- Device chosen at launch via `--device`; the frontend switches live via the WS
  control message, so no sidecar relaunch is needed.
- getUserMedia in WKWebView requires camera access: add
  `com.apple.security.device.camera` to `entitlements.plist`, and an
  `NSCameraUsageDescription` Info.plist key (via the Tauri macOS bundle config). The
  user grants camera permission on first IR-CAMERA use.
- Ultraleap runtime is now only needed for the LEAP device; PS EYE and IR CAMERA are
  Ultraleap-free.

## Data flow

```
LEAP IR / PS EYE:  device(LeapC|pseyepy) → on_frame → WS binary → WsFrameProvider
GENERIC CAMERA:    getUserMedia → canvas → luma → CameraFrameProvider
   → IrTouchPipeline.process(gray,w,h) → blobs → tracker → TouchEv → effects + TUIO
```

## Error / edge handling

- Provider start failure (no camera permission, camera in use, bridge down) →
  surfaced via `onStatus`; the app stays usable (mouse source) and the WS provider
  keeps its reconnect loop.
- `getUserMedia` rejected/denied → status message; IR CAMERA inert until granted.
- Switching device mid-stream: old provider `stop()` releases the camera / sends no
  more frames before the new one starts.
- Bridge `select` to a device that fails to open (no PS Eye attached) → logs, falls
  back to `none`; frontend still connected (no frames) + mouse works.
- Frame size change between devices → existing guard (`bg` length mismatch resets bg)
  applies; pipeline re-derives `w,h` per frame.

## Testing

- **Pure units (`node --test`):**
  - `IrTouchPipeline.process`: synthetic gray frame with a bright blob → expected
    mapped `TouchEv` (down/move/up via the tracker); bg-subtract path.
  - `CameraFrameProvider` luma conversion: RGBA → gray byte correctness.
  - `WsFrameProvider`: parses a packed `(w,h,gray)` buffer into `onFrame` args; emits
    the device control message on open (mock WS).
  - Bridge: `DeviceManager.select` swaps active device (with a `FakeDevice`);
    control-vs-touch JSON discrimination; PS Eye frame→gray packing (`FakeDevice`
    feeds a synthetic array — no hardware).
  - Existing `blobs`/`tracking`/`homography` tests stay green.
- **Manual / Playwright smoke:** IR CAMERA picks a webcam and produces ripples on
  mouse-substitute motion; LEAP IR + PS EYE select and stream from a running bridge;
  calibration controls affect all three.

## Build phases (independent, shippable)

1. **Frontend provider facade + generic IR camera.** `IrTouchPipeline`,
   `IrFrameProvider`, `WsFrameProvider`, `CameraFrameProvider`, `IrSource`; dropdown +
   camera picker; Tauri camera entitlement/plist. Keeps Leap via the WS provider.
   No bridge changes.
2. **Bridge device facade + PS Eye.** `IrDevice`, `LeapDevice`, `PsEyeDevice`,
   `DeviceManager`, `--device` flag, WS control message; sidecar bundling of
   `pseyepy`.

## Out of scope

- OpenCV server-side generic camera (getUserMedia covers it).
- Per-device calibration presets / saved profiles.
- Camera exposure/gain UI (sensible defaults; config later).
- Any change to blob detection, tracking, homography, effects, or warp.
- Windows/Linux Tauri builds.
