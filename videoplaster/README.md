# VIDEOPLASTER 02

A web-based touch detection and water effect application powered by **Leap Motion Controller 2**. Uses IR image processing, GPU-accelerated water simulation, perspective correction, and TUIO output over UDP.

**Developed by**: [Armado Frezze](https://github.com/armadofrezze) at **Doopler Studio**

**Key**: Leap Motion Controller 2 (Gemini) mounted behind white acrylic → IR camera (no depth) → touch detection → GPU water effect + TUIO broadcast over UDP :3333. Rear projection compatible.

---

## Quick Start

### 1. Install Dependencies
```bash
cd videoplaster
npm install
./setup.sh  # Python venv (3.12) + LeapC bindings (one-time)
```

### 2. Run Development Server
```bash
npm run dev
# Opens http://localhost:8000/
```

### 3. Run the Full App (Bridge + Server)
```bash
./run.sh
# Starts Python bridge + Vite dev server
# Bridge: IR frames (WS :7681) + TUIO output (UDP :3333)
```

---

## System Requirements

### Hardware
- **Leap Motion Controller 2** (optional; MOUSE fallback available)
  - Mount 15–30 cm behind acrylic surface
  - IR reflections from fingers trigger detection
  - Rear-projection compatible (IR-pass filter blocks visible light)

### Software
- **macOS** (Apple Silicon or Intel)
- **Node.js** 18+ and **npm**
- **Python 3.12** *(system default may be older; install if missing)*
  ```bash
  brew install python@3.12
  ```
  Ultraleap SDK ships a prebuilt `leapc_cffi` for Python 3.12, avoiding compilation.
  
- **Ultraleap Tracking Software v6.2.0+**
  1. Download from: https://leap2.ultraleap.com/
  2. Select **Leap Motion Controller 2**
  3. Install and run the tracking service
  4. Provides the LeapC library + service the Python bindings connect to

---

## Installation

### Step 1: Install Ultraleap Tracking Software
```bash
# Download from https://leap2.ultraleap.com/
# Install .dmg / .pkg
# Launch the Ultraleap control panel (verify service is running)
```

### Step 2: Verify Python 3.12
```bash
python3.12 --version
# Output: Python 3.12.x
# If missing, brew install python@3.12
```

### Step 3: Clone & Setup
```bash
git clone <repo-url> videoplaster
cd videoplaster

# Install Node dependencies
npm install

# Create Python venv + install LeapC bindings
./setup.sh
# This creates .venv and installs:
#   - websockets (bridge ↔ browser)
#   - python-osc (TUIO broadcast)
#   - leapc-python-bindings (into .venv as editable)

# Verify Leap device is connected
./check-leap.sh
# Output: DEVICE(S) CONNECTED
# If "NO DEVICE", check USB cable and Ultraleap service
```

---

## Application Structure

### Directory Layout
```
src/                    # TypeScript source
├── app.ts              # Main app: UI, event wiring, canvas setup
├── touch-source.ts     # TouchSource base class + MouseTouchSource
├── leap-image-source.ts  # IR pipeline: WebSocket → blobs → touches
├── leap-z-source.ts    # Leap hand tracking (Z-axis touch detection)
├── water-gl.ts         # GPU water simulation shader
├── warp-gl.ts          # 4-pin keystone perspective correction
├── background.ts       # Image/video background layer
├── output.ts           # TouchEmitter: TUIO broadcast
├── blobs.ts            # Blob detection algorithm
├── tracking.ts         # Temporal blob tracking → touch IDs
├── homography.ts       # Camera ↔ surface coordinate mapping
├── ir-preprocess.ts    # Background subtract, blur, erosion
├── undistort.ts        # Fisheye lens correction (optional)
├── ui-overlay.ts       # Keyboard overlay + calibration grid
├── persist.ts          # localStorage control state
├── types.ts            # Shared TypeScript types
└── *.test.ts           # 22 unit tests

bridge/                 # Python backend
├── leap-bridge.py      # WebSocket server + LeapC reader + TUIO sender
├── tuio.py             # TUIO 1.1 protocol encoder
└── test_tuio.py        # 3 TUIO encoding tests

spike/                  # Phase 0 gate: raw IR proof-of-concept
index.html              # Entry point
tsconfig.json           # TypeScript strict config
vite.config.ts          # Vite bundler
```

### Data Flow

1. **IR Capture** (leap-image-source.ts)
   - Python `leap-bridge.py` reads raw IR frames from LeapC
   - Sends (width, height, grayscale pixels) via WebSocket :7681

2. **Image Processing**
   - Background subtraction (ir-preprocess.ts)
   - Gaussian blur + erosion (morphological filtering)
   - Blob detection (blobs.ts)
   - Optional fisheye undistortion (undistort.ts)

3. **Tracking** (tracking.ts)
   - Temporal tracking by proximity (maxDist = 0.08)
   - Emits: `down` (new), `move` (existing), `up` (lost)

4. **Coordinate Mapping** (homography.ts)
   - Camera pixel → normalized surface UV [0,1]
   - ROI support (capture zone in 0..1 frame rectangle)

5. **Rendering & Output**
   - Water simulation (GPU, water-gl.ts)
   - Keystone correction (4-pin warp-gl.ts)
   - TUIO broadcast to UDP :3333 (output.ts)
   - Touch events feed water ripples in real-time

---

## Running the Application

### Phase 0: Verify IR Stream (First Time)
Before calibration, confirm raw IR images are available:

```bash
./spike.sh
# Opens http://localhost:8000/spike/spike.html
```

**Result**:
- ✅ **Live IR image visible** (hand = bright regions) → IR path viable
- ❌ **Nothing / policy error** → Switch to LEAP Z or redesign sensing

If PASS, note: `IMAGE EVENT w=512 h=512 bpp=1 bytes=262144` and `spike_frame.pgm` written.

### Daily Start (On-Rig Testing)

**Built by Doopler Studio & Armado Frezze** for interactive installations that require precise touch detection and visual feedback.

#### 1. Plug in Leap Controller 2 (USB)
```bash
./check-leap.sh
# Must print: DEVICE(S) CONNECTED
# If "NO DEVICE": fix USB cable, then re-run
```

#### 2. Start the Full Application
```bash
./run.sh
# Starts bridge (IR + TUIO) + Vite dev server
# Opens http://localhost:8000/
# Bridge auto-stops when you Ctrl+C the server
```

#### 3. Select Source & Calibrate
In the web UI:

**Source Selection** (dropdown):
- `MOUSE` – Develop without hardware
- `LEAP IR` – IR blob detection (primary)
- `LEAP Z` – Leap hand tracking + Z threshold (backup; requires WS :6437)

**LEAP IR Calibration**:
1. **Capture Background** → Click "CAPTURE BG" with no fingers touching
   - Stores empty IR frame for background subtraction
2. **Calibrate Corners** → Click "TEST GRID", then drag the 4 corner pins on the IR preview
   - Match the acrylic bounds
3. **Tune Detection**:
   - **Threshold**: How bright a blob must be (0–255; higher = stricter)
   - **Min/Max Area**: Filter by pixel count
   - **Blur / Erosion**: Morphological filtering to reduce noise
   - **Mirror X/Y**: Flip if image is reversed
   - **Undistort** + **K1/K2**: Fisheye lens correction (if edges are warped)

#### 4. Point TUIO Client
Direct your TUIO consumer (e.g., TUIO Mouse) to `127.0.0.1:3333`.

### Development Server
```bash
npm run dev
# Hot Module Replacement (HMR) enabled
# Changes auto-reload in browser
```

### Production Build
```bash
npm run build
npm run preview --port 8000
# Serves dist/ locally for testing
# Or deploy dist/ to any static HTTP server
```

---

## Development Commands

### Build & Test
```bash
npm run typecheck      # TypeScript strict mode
npm run build          # Production bundle
npm test               # 22 unit tests
npm run dev            # Development server with HMR
npm run preview        # Preview production build locally
```

### Tests (22 Total)
```bash
npm test
# Runs: TypeScript type-check + Node test runner with --experimental-strip-types

# Unit tests cover:
# - Background (scaling, aspect ratios)
# - Blobs (detection, area filtering)
# - Homography (camera ↔ surface mapping)
# - IR preprocessing (background subtraction)
# - Leap Z (finger extraction, height mapping)
# - Touch source (mouse input, coordinate normalization)
# - Tracking (temporal ID reuse, state transitions)
# - UI overlay (grid, keyboard nudge)
# - Warp GL (corner offsets, perspective)
```

### Python Tests
```bash
.venv/bin/python -m pytest bridge/test_tuio.py -q
# 3 TUIO encoding tests
```

---

## Controls & Keyboard

### UI Panel
- **FIT SCREEN** – Canvas fills viewport (checked: override manual width/height)
- **TEST GRID** – Overlay calibration grid + corner anchors
- **RESET ANCHORS** – Set all 4 pins to identity (0 offset)
- **Canvas SIZE** – Manual width/height sliders
- **SOURCE** – Toggle MOUSE / LEAP IR / LEAP Z
- **IMAGE** – Load background image/video, scale, rotate
- **WATER** – Intensity, viscosity, radius
- **PINS** – Per-corner X/Y offsets (→ keystone correction)
- **LEAP IR** – Threshold, area, blur, erosion, undistort K1/K2, mirror

### Keyboard (Projection Mode)
- **H** – Hide/show UI panel
- **F** – Toggle fullscreen
- **Esc** – Exit fullscreen + show UI
- **Arrow keys** → Nudge selected corner ±1px
- **Shift + Arrow** → Nudge ±10px
- **Click corner pin** → Select for nudging

---

## Configuration

### Local Storage
Control values (sliders, checkboxes, ROI) saved to `localStorage` under key `vp_settings`.
```javascript
localStorage.getItem('vp_settings')  // View all settings as JSON
localStorage.removeItem('vp_settings')  // Reset to defaults
```

### TUIO Output
- **Protocol**: TUIO 1.1 (binary OSC bundles)
- **Port**: UDP 3333
- **Messages**: `/tuio/2Dcur` (touch), `/tuio/fseq` (frame sequence)
- **Client**: e.g., TUIO Mouse, MaxMSP, Processing, Custom OSC listener

### Mounting Notes
- Mount Leap ~15–30 cm behind acrylic so fingers are in focus
- IR-pass filter on Leap blocks visible projector light → no pollution
- Ensure stable USB power (avoid brownouts)

---

## Troubleshooting

### Phase 0: No IR Image
1. ✅ Ultraleap service running? (macOS: System Settings → Leap Motion)
2. ✅ Controller 2 plugged in? (check `./check-leap.sh`)
3. ✅ Policy flags set? (leap-bridge.py should log: "set_policy_flags success")
4. ✅ Python 3.12 + LeapC bindings? (run `./setup.sh` again)

### Bridge Connection Timeout
```bash
.venv/bin/python bridge/leap-bridge.py
# Watch stderr for LeapC errors
# If "NO DEVICE", reconnect USB + restart Ultraleap service
```

### TUIO Not Arriving
1. Verify client listening on `127.0.0.1:3333`
2. Check firewall: `sudo lsof -i :3333`
3. Test with: `nc -u -l 3333` (should see binary data)
4. Ensure bridge is running: check terminal for "TUIO sender ready"

### Touches Not Detected
**LEAP IR**:
- Click "CAPTURE BG" first (saves empty frame)
- Increase threshold if too few blobs
- Decrease minArea if missing small touches
- Check MIRROR X/Y if image is flipped

**LEAP Z**:
- Hand must be in interaction box (~25 cm in front)
- Adjust thresh (depth) + zoomX/Z in code

### High CPU / Low FPS
- Check water intensity (high = more iterations)
- Reduce blob detection parameters (blur, minArea)
- Profile with Chrome DevTools (Performance tab)

---

## Technology Stack

- **Frontend**: TypeScript 5.7, Vite 6, WebGL (water + warp)
- **Backend**: Python 3.12, LeapC FFI, websockets, python-osc
- **Testing**: Node native test runner (--experimental-strip-types)
- **Build**: Vite (ES2022, tree-shake, minify)
- **Target**: ES2022 + DOM APIs
- **Communication**: WebSocket (IR), UDP/OSC (TUIO)

---

## Performance

- **Water GPU**: Real-time on Apple Silicon + Intel (60 FPS)
- **Blob detection**: ~100ms per 512×512 frame (CPU)
- **Tracking overhead**: <5ms per frame
- **Browser refresh**: 60 FPS (requestAnimationFrame)
- **TUIO broadcast**: <1ms per frame

---

## Project History & Phase 0 Result

**2026-06-18 – Phase 0 GATE PASSED ✅**
- Controller 2 (`LE510000200000A8DB…`) connected
- `./spike.sh` delivered raw IR images via LeapC
- Output: `IMAGE EVENT w=512 h=512 bpp=1 bytes=262144`
- Result: IR image viability confirmed (`spike_frame.pgm` captured)
- Conclusion: IR path is viable; build on LeapImageSource

**TypeScript Migration – 2026-06-21 ✅**
- Migrated all `.js` files to TypeScript
- 22 unit tests passing
- Vite build succeeds
- Zero type errors

---

## Credits & Attribution

**VIDEOPLASTER 02** is a project by **Armado Frezze** and **Doopler Studio**, developed for interactive rear-projection installations combining Leap Motion Controller 2 IR sensing with GPU-accelerated graphics and TUIO output.

- **Concept & Design**: Armado Frezze
- **Development**: Full-stack TypeScript/Python implementation by Armado Frezze
- **Studio**: Doopler Studio – Digital arts & interactive installations

**Links**:
- [Doopler Studio](https://www.doopler.studio)
- [Armado Frezze](https://github.com/armadofrezze)
- See **[CREDITS.md](./CREDITS.md)** for detailed attribution and development timeline

---

## Links & References

- [Leap Motion Controller 2 Docs](https://leap2.ultraleap.com/)
- [Leap C API Bindings](https://github.com/ultraleap/leapc-python-bindings)
- [TUIO 1.1 Protocol](http://www.tuio.org/)
- [WebGL Water Simulation](https://tympanus.net/codrops/2013/08/13/webgl-water-simulation/)
- [Vite Documentation](https://vitejs.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)


