# VIDEOPLASTER 02 – Credits & Attribution

## Project Leadership

**Armado Frezze** – Concept, Design, Full-Stack Development
- Leap Motion Controller 2 IR pipeline
- TypeScript/JavaScript frontend (touch detection, water simulation)
- Python backend (LeapC bindings, TUIO broadcast)
- GPU water effect implementation
- Perspective correction (keystone adjustment)
- Complete TypeScript migration (2026-06-21)

**Doopler Studio** – Production & Studio Support
- Interactive installation integration
- Real-world deployment & testing
- Concept refinement & feedback

---

## Technology & Framework Credits

### Core Libraries
- **Leap Motion Controller 2 API** – Ultraleap
- **Vite** – Fast ES module bundler
- **TypeScript** – JavaScript with static types
- **WebGL** – GPU graphics rendering
- **python-osc** – TUIO/OSC protocol support

### Algorithms & References
- **Water Simulation** – GPU-accelerated 2D wave equation
- **Blob Detection** – Connected component analysis
- **Homography** – 4-point perspective transform
- **Undistortion** – Fisheye lens correction (Brown-Conrady model)
- **Tracking** – Temporal ID assignment by proximity

### Open Source
- [Leap C Python Bindings](https://github.com/ultraleap/leapc-python-bindings)
- [TUIO Protocol Reference](http://www.tuio.org/)
- [Vite Documentation](https://vitejs.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/)

---

## Development Timeline

- **2026-06-16** – Project initialization
- **2026-06-17** – LeapC Python bindings setup (Python 3.12)
- **2026-06-18** – Phase 0 IR viability gate PASSED ✅
- **2026-06-21** – Complete TypeScript migration (all `.js` → `.ts`)

---

## Deployment & Support

For installation, calibration, and troubleshooting, see **README.md**.

For development guide, see **DEVELOPMENT.md**.

For technical questions or contributions:
- Contact: **Armado Frezze**
- Studio: **Doopler Studio**
