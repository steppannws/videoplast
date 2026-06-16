# VIDEOPLASTER 02

Leap Motion Gemini (behind a white acrylic) used as an IR camera → touch detection →
GPU water effect + TUIO output.

## Run
1. `cd bridge && pip install -r requirements.txt` and install `leap` per
   https://github.com/ultraleap/leapc-python-bindings
2. `python leap-bridge.py`   (IR images + TUIO on UDP :3333, WS :7681)
3. From the repo root: `python3 -m http.server 8000`
4. Open http://localhost:8000/ — pick a source, calibrate, touch.

## Sources
- **LEAP IR** (primary): IR image → background subtract → blobs → homography → touches.
- **LEAP Z** (backup): hand-tracking + Z threshold (open-air, ~25 cm zone).
- **MOUSE**: develop without hardware.

## Calibration (LEAP IR)
1. CAPTURAR FONDO with nothing on the acrylic.
2. CALIBRAR ESQUINAS, click the 4 acrylic corners in the preview.
3. Tune threshold/minArea/erosion so hover doesn't trigger but touch does.

## Mounting notes
- Leap ~15–30 cm behind the acrylic so the finger plane is in focus and IR spreads.
- The Leap's IR-pass filter rejects the projector's visible light.

## Phase 0 result
<!-- filled during the feasibility spike: images available? width×height? fps? -->
