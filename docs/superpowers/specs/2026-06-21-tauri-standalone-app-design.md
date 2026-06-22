# Videoplaster as a Standalone macOS App (Tauri) — Design

Date: 2026-06-21
Project: videoplaster (Leap-as-IR-camera touch installation)
Status: approved (brainstorm)

## Goal

Ship videoplaster as a double-clickable macOS `.app`: a Tauri shell that bundles
the Leap bridge and runs the existing WebGL frontend in WKWebView, fullscreen, for
projection — with a path to a signed + notarized `.dmg` for handoff to other people
on other Mac rigs. The artist never opens a terminal.

## Constraints / decisions

- **Tauri (not Electron).** Small bundle, native macOS webview. Chosen over
  Electron after the user opted for the lean wrapper.
- **Frontend code is unchanged.** The Vite/TS/WebGL app keeps talking to the bridge
  over `ws://localhost:7681` exactly as it does today. The wrapper adds a window +
  a managed bridge process around it — nothing inside `src/` changes.
- **Bridge ships as a PyInstaller sidecar.** The existing Python bridge is frozen to
  a single binary and registered as a Tauri sidecar the Rust backend spawns/kills.
  (Rejected: Rust rewrite of the capture layer — too much work for now; bundled venv
  — fragile to sign/relocate.)
- **macOS only.** No Windows build in scope.
- **Handoff-grade.** Developer ID signing + notarization so Gatekeeper allows the app
  on machines that never saw the dev cert.
- **WKWebView WebGL risk is low and already mitigated.** `negotiateFloat` (in
  `gl-util.ts`) falls back to 8-bit `UNSIGNED_BYTE` sim textures, which WebKit fully
  supports. Worst case in WKWebView: effects run 8-bit (particles lose precision),
  not broken. A WebKit render-check is the first build step (Phase 0).

## Runtime architecture

Unchanged data path; Tauri only owns the window and the bridge process lifecycle.

```
WKWebView (vite build, all effects + UI)
   │   ws://localhost:7681  (IR frames in, touch JSON out)
   ▼
videoplaster-bridge (PyInstaller sidecar)
   ├── LeapC  → IR image capture (left camera, 8-bit, packed w,h,buf)
   └── TUIO 1.1 → UDP 127.0.0.1:3333 (external consumers, kept as-is)
```

- The Rust backend (`src-tauri/src/main.rs`):
  - On `setup`/app-ready: spawn the bridge sidecar with args
    (`--ws-port 7681 --tuio-ip 127.0.0.1 --tuio-port 3333`).
  - On window close / app exit: kill the sidecar (no orphan process).
  - **Single-instance lock** (tauri-plugin-single-instance) so a second launch does
    not double-bind `:7681`.
- The frontend connects to the WS as today; the existing reconnect loop covers the
  brief window where the bridge is still starting.

## Window / kiosk

- One window, loads the Vite build (`dist/` in prod, dev server in `tauri dev`).
- Launch **fullscreen**, decorations off, for projection. Existing keyboard layer
  (`ui-overlay.ts`: H panel, F fullscreen toggle, Esc, grid, number-key effects)
  keeps working unchanged.

## Bridge packaging

- `scripts/build-bridge.sh`:
  - PyInstaller freezes `bridge/leap-bridge.py` (entry) + `bridge/tuio.py` +
    `websockets` + the `leap` bindings into `videoplaster-bridge`.
  - Output named with the Tauri target triple suffix
    (`videoplaster-bridge-aarch64-apple-darwin`) in `src-tauri/binaries/`, as Tauri
    sidecars require.
  - `libLeapC.dylib` bundled next to the binary; rpath/loader path points at the
    Ultraleap runtime install location, with a bundled copy as fallback.
- `tauri.conf.json` registers the sidecar under `bundle.externalBin` and grants the
  `shell`/`process` capability to spawn it.

## Build & signing

- **Dev:** `npm run tauri:dev` → starts vite + opens the webview; bridge spawned by
  the Rust backend (or run manually from a venv during frontend-only work).
- **Prod:** `vite build` → `dist/`, then `npm run tauri:build` → `.app` + `.dmg`.
- **Arch:** build targets the host architecture (dev rig is Apple Silicon →
  `aarch64-apple-darwin`). Handing off to an Intel Mac needs a separate
  `x86_64-apple-darwin` build (and a matching PyInstaller bridge built on/for that
  arch) or a universal binary — treated as a follow-up, not part of the first build.
- **Signing/notarization:** `tauri.conf.json` macOS block sets the Developer ID
  Application identity, hardened runtime, and an `entitlements.plist`. The sidecar
  binary and `libLeapC.dylib` are signed too (nested code). Notarization via
  `notarytool`, driven by `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` env that
  Tauri's bundler reads. Without a cert: dev/personal build runs locally; handoff
  requires the cert.

## External prerequisite

- Ultraleap tracking runtime must be installed on each rig (system-level; cannot be
  bundled). Documented in the README. The app and the **mouse** source + all effects
  run without it; only the **Leap-IR** source needs it. (Note: macOS Ultraleap
  support is legacy/limited — the target Macs must run a compatible tracking service;
  the current dev rig already does per Phase 0 of the parent project.)

## Components / files (new)

- `videoplaster/src-tauri/` — `Cargo.toml`, `tauri.conf.json`, `build.rs`,
  `src/main.rs` (spawn/kill sidecar, window config, single-instance), `icons/`,
  `entitlements.plist`.
- `videoplaster/src-tauri/binaries/videoplaster-bridge-<triple>` — frozen bridge
  (produced by the build script; git-ignored, built in CI/locally).
- `videoplaster/scripts/build-bridge.sh` — PyInstaller build of the bridge.
- `videoplaster/package.json` — `@tauri-apps/cli` dev dep + `tauri:dev` /
  `tauri:build` scripts.
- Docs — Ultraleap prereq, build/sign/notarize steps, dev workflow.

No changes under `videoplaster/src/` or to `index.html`.

## Phase 0 spike (gating, runs first)

Run all 6 effects in WebKit (Safari = same engine as WKWebView) against the dev
server. Confirm each renders and record whether it takes the float or 8-bit texture
path. Outcome only sets expectations (the 8-bit fallback is already implemented), so
it does not block — but it must be done before investing in the bundle.

## Error / edge handling

- Bridge fails to start / no Leap device / `:7681` busy → frontend WS reconnect loop
  + mouse source keep the app usable; surface bridge state in the status line.
- Two launches → single-instance lock prevents a second bridge spawn.
- WKWebView lacks renderable float textures → 8-bit fallback (already coded).
- Unsigned app on another Mac → Gatekeeper blocks; resolved by notarization.
- App quit / crash → sidecar is killed in the exit handler; verify no orphan
  `videoplaster-bridge` process remains.

## Testing

- Existing vitest/`node --test` suite stays green (frontend untouched).
- **WebKit render check** (Phase 0): all 6 effects render in WebKit; note texture path.
- **Sidecar smoke:** launch app → `:7681` reachable → mouse drag produces ripples →
  quit → no orphan bridge process.
- **Build verification:** `tauri build` produces a launchable `.app`; a signed +
  notarized build opens cleanly on a second Mac (handoff check).

## Out of scope

- Auto-update.
- Windows / Linux builds.
- In-app bridge settings UI (ports stay fixed / config-file driven).
- Any rewrite of the frontend, effects, or the bridge logic itself (only packaging).
- Rust-native bridge (possible future cleanup; not now).
