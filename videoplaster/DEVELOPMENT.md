# VIDEOPLASTER 02 – Development Guide

A web-based touch detection and water effect application powered by **Leap Motion Controller 2** (or mouse fallback). Uses IR image processing, blob detection, and TUIO output over UDP.

## Quick Start

### 1. Install Dependencies
```bash
cd videoplaster
npm install
./setup.sh  # Python venv + LeapC bindings (one-time)
```

### 2. Development Server
```bash
npm run dev
# Opens http://localhost:8000/
```

### 3. Production Build
```bash
npm run build
npm run preview  # Serve dist/ locally on port 8000
```

### 4. Tests
```bash
npm test        # 22 JavaScript/TypeScript tests
```

---

## Requirements

### Hardware
- **Leap Motion Controller 2** (optional; fallback to mouse)
  - Mount 15–30 cm behind an acrylic surface
  - Mounted to detect IR reflections from finger touches on the acrylic
  - Rear-projection ready

### Software
- **macOS** (Apple Silicon or Intel supported)
- **Node.js** 18+ & **npm**
- **Python 3.12** (for LeapC bindings; system default may be older)
- **Ultraleap Tracking Software v6.2.0+**
  - Install from: https://leap2.ultraleap.com/
  - Select **Leap Motion Controller 2**
  - Provides LeapC library the Python bindings build against

---

## Installation

### Step 1: Install Ultraleap Tracking Software
1. Go to https://leap2.ultraleap.com/
2. Select **Leap Motion Controller 2** for your OS
3. Install and launch the tracking service
4. Verify the service is running (macOS: check System Settings)

### Step 2: Install Python 3.12
If your system default is older (e.g., 3.7):
```bash
brew install python@3.12
```
The Ultraleap SDK ships a prebuilt `leapc_cffi` for Python 3.12, avoiding compilation.

### Step 3: Clone & Setup
```bash
git clone <repo-url>
cd videoplaster
npm install                 # Install Node dependencies
./setup.sh                  # Create .venv (Python 3.12) + install LeapC bindings
./check-leap.sh            # Verify device is connected
```

---

## Application Structure

### Directory Layout
```
videoplaster/
├── index.html              # Main HTML entry point
├── src/                        # TypeScript source code
│   ├── app.ts              # Main app logic, UI controls, event wiring
│   ├── touch-source.ts     # Abstract TouchSource base class
│   ├── leap-image-source.ts  # IR blob detection pipeline
│   ├── leap-z-source.ts    # Leap hand tracking + Z-axis touch
│   ├── water-gl.ts         # GPU water simulation shader
│   ├── warp-gl.ts          # Perspective projection (4-pin keystone)
│   ├── background.ts       # Image/video background renderer
│   ├── output.ts           # TUIO emitter (UDP :3333)
│   ├── blobs.ts            # Blob finding algorithm
│   ├── tracking.ts         # Temporal blob→touch ID mapper
│   ├── homography.ts       # Camera→surface coordinate mapping
│   ├── ir-preprocess.ts    # Background subtraction, blur, erosion
│   ├── undistort.ts        # Fisheye lens correction
│   ├── ui-overlay.ts       # Keyboard shortcuts & calibration grid
│   ├── persist.ts          # localStorage control state
│   ├── types.ts            # Shared TypeScript interfaces
│   └── *.test.ts           # Unit tests
├── bridge/                 # Python backend
│   ├── leap-bridge.py      # WebSocket server (7681), IR→browser, touches→TUIO
│   ├── tuio.py             # TUIO 1.1 encoder
│   └── test_tuio.py        # TUIO encoding tests (3 tests)
├── spike/                  # Phase 0 gate: raw IR proof-of-concept
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite bundler config
└── README.md               # Original project notes
```

### Data Flow

1. **IR Capture** (leap-image-source.ts)
   - Python bridge reads IR frames from LeapC
   - Sends raw frame data (w, h, pixels) over WebSocket :7681

2. **Image Processing**
   - Background subtraction (ir-preprocess.ts)
   - Blob detection (blobs.ts)
   - Undistortion (fisheye correction, optional)

3. **Tracking** (tracking.ts)
   - Temporal blob tracking by proximity
   - Generates touch events: `down`, `move`, `up`

4. **Mapping** (homography.ts)
   - Camera coordinates → normalized surface UV [0,1]
   - Supports 4-pin keystone correction (warp.ts)

5. **Output**
   - Water effect (water-gl.ts, GPU simulation)
   - TUIO broadcast over UDP :3333 (output.ts)
   - Touch feeds water ripples in real-time

---

## Running the Application

### Phase 0: Verify IR Stream
Before deploying, confirm the Leap Controller 2 exposes raw IR images:

```bash
./spike.sh
# Open http://localhost:8000/spike/spike.html in a browser
```

- **PASS**: Live IR image visible (hand = bright regions)
- **FAIL**: No image or policy error → Controller doesn't expose IR; switch to LEAP Z or rethink sensing

### Daily Operation

#### 1. Start the Bridge
```bash
./run.sh
# Runs: Python bridge (IR+touches→TUIO) + Vite dev server
# Opens http://localhost:8000/
```

#### 2. Select Touch Source
In the web UI, pick from the dropdown:
- **MOUSE** – Develop without hardware
- **LEAP IR** – IR image → detection → TUIO (primary)
- **LEAP Z** – Hand tracking + height threshold (backup; requires legacy WS :6437)

#### 3. Calibration (LEAP IR only)

**Capture Background**
- Click "CAPTURE BG" with nothing touching the acrylic
- Stores empty IR frame for subtraction

**Calibrate Corners**
- Click "TEST GRID" to show alignment grid
- Drag the 4 corner handles on the IR preview to match the acrylic bounds

**Tune Detection**
- Adjust threshold / area / erosion so hovering does NOT trigger, but touching does
- Enable undistort + adjust K1/K2 if edges are fisheye-warped
- Check MIRROR X/Y if the image is flipped

**Point TUIO Client**
- Direct your TUIO consumer (e.g., TUIO Mouse) to `127.0.0.1:3333`

### Production Deployment

```bash
npm run build
# Output: dist/ directory
npm run preview --port 8000
# Or serve dist/ with any static HTTP server
```

The app is a single-page Vite bundle; the Python bridge runs separately.

---

## Development Workflow

### Compile & Type Check
```bash
npm run typecheck    # TypeScript strict mode
npm run build        # Production bundle
npm test             # Unit tests (22 tests, ~92ms)
```

### Live Development
```bash
npm run dev
# Changes auto-reload in the browser (HMR)
```

### Testing
- **Unit tests**: Pure logic (blob detection, tracking, homography, water)
- **Integration**: Manual browser testing with TUIO client
- **Hardware**: Phase 0 gate confirms IR stream availability

```bash
npm test
# Output: TAP format, all 22 tests should pass

.venv/bin/python -m pytest bridge/test_tuio.py -q
# Output: 3 TUIO encoding tests
```

---

## Configuration

### Local Storage
Control values (sliders, checkboxes) and calibration ROI are saved to `localStorage` under key `vp_settings`. Clear the browser's site data to reset.

### Keyboard Shortcuts (Projection Mode)
- **H** – Hide/show UI panel
- **F** – Toggle fullscreen
- **Esc** – Exit fullscreen + show UI
- **Arrow keys** + **Shift** – Nudge selected corner ±1px (±10px with Shift)

### UDP TUIO Output
- **Port**: 3333
- **Protocol**: TUIO 1.1
- **Messages**: `/tuio/2Dcur`, `/tuio/fseq`
- **Format**: Binary bundle (OSC)

---

## Troubleshooting

### Phase 0: No IR Image
1. Verify Ultraleap service is running
2. Check `./check-leap.sh` output (should say "DEVICE(S) CONNECTED")
3. Confirm Controller 2 USB is plugged in
4. Restart the Leap tracking service in System Preferences

### Bridge Connection Failed
- Ensure Python 3.12 + LeapC bindings are installed: `./setup.sh`
- Check Python environment: `.venv/bin/python --version`
- Watch bridge output for LeapC errors

### TUIO Not Arriving at Client
- Verify client is listening on 127.0.0.1:3333 (or network IP if remote)
- Check firewall isn't blocking UDP port 3333
- Test with `nc -u -l 3333` on another terminal while bridge runs

### Touches Not Detected
1. **LEAP IR**:
   - Click "CAPTURE BG" first
   - Increase threshold / decrease minArea if too few blobs
   - Check MIRROR X/Y if image is upside-down
2. **LEAP Z**:
   - Ensure hand is in the interaction box (default ~30 cm in front)
   - Adjust `thresh` in code if Z-plane too far

---

## Technology Stack

- **Frontend**: TypeScript, Vite, WebGL (water + warp shaders)
- **Backend**: Python 3.12, LeapC bindings, websockets, python-osc
- **Testing**: Node test runner (--experimental-strip-types)
- **Build**: Vite 6, ES2022 modules
- **Communication**: WebSocket (IR frames), UDP/OSC (TUIO touches)

---

## Performance

- **Water GPU simulation**: Real-time on macOS Apple Silicon / Intel
- **Blob detection**: ~100ms per frame (512×512 IR image)
- **Tracking overhead**: <5ms per frame
- **Browser frame rate**: 60 FPS (requestAnimationFrame capped)
- **TUIO broadcast**: Negligible (<1ms per frame)

---

## License & Credits

Originally developed for a rear-projection touch-responsive installation using Leap Motion Controller 2 as an IR-based finger detection sensor. The water effect and keystone correction enable flexible on-site calibration without hardware tweaking.

---

## Further Reading

- [Leap Motion Controller 2 Docs](https://leap2.ultraleap.com/)
- [Leap C API Reference](https://github.com/ultraleap/leapc-python-bindings)
- [TUIO 1.1 Protocol](http://www.tuio.org/)
- [WebGL Water Simulation](https://tympanus.net/codrops/2013/08/13/webgl-water-simulation/)
