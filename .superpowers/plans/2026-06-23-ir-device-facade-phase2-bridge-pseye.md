# IR Device Facade — Phase 2 (Bridge Device Facade + PS Eye) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Python bridge so the IR capture device is pluggable (`LeapDevice` | `PsEyeDevice`), selectable at launch via `--device` and live via a WS control message, and add PlayStation Eye capture via `pseyepy`.

**Architecture:** An `IrDevice` interface (`start(on_frame)` / `stop()`) is implemented by `LeapDevice` (LeapC) and `PsEyeDevice` (pseyepy/libusb). A `DeviceManager` holds the active device and swaps on `select(name)`. The WS server discriminates inbound JSON: `type` field → control (`device` select); otherwise it's a touch event → TUIO. The binary frame broadcast + TUIO UDP output are unchanged.

**Tech Stack:** Python 3 (asyncio, `websockets`), `pseyepy` (PS Eye over libusb) + `numpy`, the existing `leap` bindings, `pytest`, PyInstaller (sidecar), Tauri v2.

## Global Constraints

- Pure, importable logic lives in `bridge/ir_device.py` (the entry `bridge/leap-bridge.py` has a hyphen → not importable; keep only wiring there).
- Tests use `pytest`, run with the project venv: `cd videoplaster && .venv/bin/python -m pytest bridge/<file> -v`. Tests must not require hardware, `numpy`, `leap`, or `pseyepy` (guard optional imports).
- WS frame protocol unchanged: `struct.pack("<II", w, h)` then `w*h` gray bytes.
- Back-compat: default `--device leap` so existing launch behavior is unchanged.
- No Claude attribution in commits.

---

### Task 1: Pure bridge helpers — `pack_frame` + `classify_message`

**Files:**
- Create: `videoplaster/bridge/ir_device.py`
- Create: `videoplaster/bridge/test_devices.py`

**Interfaces:**
- Produces: `pack_frame(w: int, h: int, buf: bytes) -> bytes`; `classify_message(msg: dict) -> str` returning `"device"` or `"touch"`.

- [ ] **Step 1: Write the failing test**

```python
# videoplaster/bridge/test_devices.py
import struct
from ir_device import pack_frame, classify_message

def test_pack_frame_header_and_truncation():
    out = pack_frame(2, 2, bytes([1, 2, 3, 4, 5, 6]))
    assert out[:8] == struct.pack("<II", 2, 2)
    assert out[8:] == bytes([1, 2, 3, 4])  # truncated to w*h

def test_classify_device_vs_touch():
    assert classify_message({"type": "device", "name": "pseye"}) == "device"
    assert classify_message({"id": 0, "x": 0.5, "y": 0.5, "state": "down"}) == "touch"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd videoplaster && .venv/bin/python -m pytest bridge/test_devices.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'ir_device'`).

- [ ] **Step 3: Write the implementation**

```python
# videoplaster/bridge/ir_device.py
"""Pluggable IR capture devices for the videoplaster bridge.

The entry script (leap-bridge.py) wires these into the WS server. Pure helpers and
the device facade live here so they stay importable + unit-testable without hardware.
"""
import struct


def pack_frame(w: int, h: int, buf: bytes) -> bytes:
    """Pack a grayscale frame into the WS wire format: u32 w, u32 h, then w*h bytes."""
    return struct.pack("<II", w, h) + bytes(buf)[: w * h]


def classify_message(msg: dict) -> str:
    """Inbound WS JSON: a `type` field marks a control message; otherwise it's a touch."""
    return "device" if "type" in msg else "touch"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd videoplaster && .venv/bin/python -m pytest bridge/test_devices.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/bridge/ir_device.py videoplaster/bridge/test_devices.py
git commit -m "feat: bridge pure helpers pack_frame + classify_message"
```

---

### Task 2: `IrDevice` interface + `DeviceManager` + `FakeDevice`

**Files:**
- Modify: `videoplaster/bridge/ir_device.py`
- Modify: `videoplaster/bridge/test_devices.py`

**Interfaces:**
- Consumes: `pack_frame` (Task 1).
- Produces: `class IrDevice` (`start(on_frame)`, `stop()`); `class FakeDevice(IrDevice)` (test double, `feed(w,h,buf)` invokes the callback); `class DeviceManager(registry: dict)` with `select(name: str) -> None`, `active_name: str | None`, and a current device whose frames flow to a manager-level `on_frame`.

- [ ] **Step 1: Write the failing test**

```python
# append to videoplaster/bridge/test_devices.py
from ir_device import IrDevice, FakeDevice, DeviceManager

def test_device_manager_selects_and_swaps():
    frames = []
    fake_a = FakeDevice()
    fake_b = FakeDevice()
    mgr = DeviceManager({"a": lambda: fake_a, "b": lambda: fake_b})
    mgr.on_frame = lambda w, h, buf: frames.append((w, h, buf))

    mgr.select("a")
    assert mgr.active_name == "a"
    assert fake_a.started is True
    fake_a.feed(2, 2, bytes([9, 9, 9, 9]))
    assert frames == [(2, 2, bytes([9, 9, 9, 9]))]

    mgr.select("b")           # swap: a stops, b starts
    assert fake_a.started is False
    assert fake_b.started is True
    assert mgr.active_name == "b"

    mgr.select("none")        # stop all
    assert fake_b.started is False
    assert mgr.active_name == "none"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd videoplaster && .venv/bin/python -m pytest bridge/test_devices.py::test_device_manager_selects_and_swaps -v`
Expected: FAIL (`ImportError: cannot import name 'DeviceManager'`).

- [ ] **Step 3: Write the implementation**

Append to `videoplaster/bridge/ir_device.py`:

```python
from typing import Callable, Dict, Optional

OnFrame = Callable[[int, int, bytes], None]


class IrDevice:
    """Capture device interface. start() begins delivering frames to on_frame."""
    def start(self, on_frame: OnFrame) -> None:
        raise NotImplementedError
    def stop(self) -> None:
        raise NotImplementedError


class FakeDevice(IrDevice):
    """Test double: feed() pushes a synthetic frame to the registered callback."""
    def __init__(self) -> None:
        self.started = False
        self._on_frame: Optional[OnFrame] = None
    def start(self, on_frame: OnFrame) -> None:
        self.started = True
        self._on_frame = on_frame
    def stop(self) -> None:
        self.started = False
    def feed(self, w: int, h: int, buf: bytes) -> None:
        if self._on_frame:
            self._on_frame(w, h, buf)


class DeviceManager:
    """Holds the active IR device; select(name) stops the current and starts the named one."""
    def __init__(self, registry: Dict[str, Callable[[], IrDevice]]) -> None:
        self.registry = registry
        self.active_name: Optional[str] = None
        self._device: Optional[IrDevice] = None
        self.on_frame: OnFrame = lambda w, h, buf: None
    def select(self, name: str) -> None:
        if name == self.active_name:
            return
        if self._device is not None:
            self._device.stop()
            self._device = None
        if name not in self.registry:   # "none" or unknown -> no active device
            self.active_name = name
            return
        dev = self.registry[name]()
        dev.start(lambda w, h, buf: self.on_frame(w, h, buf))
        self._device = dev
        self.active_name = name
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd videoplaster && .venv/bin/python -m pytest bridge/test_devices.py -v`
Expected: PASS (3 tests total).

- [ ] **Step 5: Commit**

```bash
git add videoplaster/bridge/ir_device.py videoplaster/bridge/test_devices.py
git commit -m "feat: IrDevice interface + DeviceManager + FakeDevice"
```

---

### Task 3: `LeapDevice` (refactor existing LeapC capture behind the interface)

**Files:**
- Modify: `videoplaster/bridge/ir_device.py`

**Interfaces:**
- Consumes: `IrDevice`, `pack_frame`.
- Produces: `class LeapDevice(IrDevice)` calling `on_frame(w, h, gray_bytes)` per IR frame.

`leap` is an optional import (hardware/runtime); guard it so the module still imports in tests. Hardware-verified, not unit-tested.

- [ ] **Step 1: Add the implementation (guarded import)**

Append to `videoplaster/bridge/ir_device.py`:

```python
import threading

try:
    import leap
    from leap.enums import PolicyFlag
    _HAVE_LEAP = True
except ImportError:
    _HAVE_LEAP = False


def _extract_left(event):
    # Pixels live in the raw cffi LEAP_IMAGE struct (the wrapper exposes only matrix_version).
    d = event.image[0]._data
    p = d.properties
    w, h, bpp = int(p.width), int(p.height), int(p.bpp)
    ptr = leap.ffi.cast("uint8_t*", d.data)
    return w, h, bytes(leap.ffi.buffer(ptr + d.offset, w * h * bpp))


class LeapDevice(IrDevice):
    """LeapC IR capture (left camera)."""
    def __init__(self) -> None:
        self._on_frame: Optional[OnFrame] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
    def start(self, on_frame: OnFrame) -> None:
        if not _HAVE_LEAP:
            print("[leap] bindings not importable — no frames")
            return
        self._on_frame = on_frame
        self._running = True
        device = self

        class _Listener(leap.Listener):
            def on_image_event(self, event):
                try:
                    w, h, buf = _extract_left(event)
                except Exception as ex:
                    print("[leap] image extract failed:", repr(ex)); return
                if device._on_frame:
                    device._on_frame(w, h, buf)

        def run():
            conn = leap.Connection(); conn.add_listener(_Listener())
            with conn.open():
                try: conn.set_policy_flags([PolicyFlag.Images])
                except Exception as e: print("[leap] image policy failed:", repr(e))
                import time
                while device._running:
                    time.sleep(0.01)

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()
    def stop(self) -> None:
        self._running = False
```

- [ ] **Step 2: Verify the module still imports without the leap package**

Run: `cd videoplaster && .venv/bin/python -c "import sys; sys.path.insert(0,'bridge'); import ir_device; print('ok', ir_device._HAVE_LEAP)"`
Expected: prints `ok True` or `ok False` (no import error either way).

- [ ] **Step 3: Run the suite (still green)**

Run: `cd videoplaster && .venv/bin/python -m pytest bridge/test_devices.py -v`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add videoplaster/bridge/ir_device.py
git commit -m "feat: LeapDevice behind the IrDevice interface"
```

---

### Task 4: `PsEyeDevice` (PlayStation Eye via pseyepy)

**Files:**
- Modify: `videoplaster/bridge/ir_device.py`

**Interfaces:**
- Consumes: `IrDevice`.
- Produces: `class PsEyeDevice(IrDevice)` calling `on_frame(w, h, gray_bytes)` per frame; module-level `frame_to_gray(frame) -> tuple[int,int,bytes]` (pure, numpy).

`pseyepy`/`numpy` are optional imports (hardware). The grayscale conversion is factored into `frame_to_gray` but tested only when numpy is present (guarded skip), so the default test run stays dep-free. Hardware-verified.

- [ ] **Step 1: Add the implementation (guarded import)**

Append to `videoplaster/bridge/ir_device.py`:

```python
try:
    import numpy as _np
    import pseyepy as _pseyepy
    _HAVE_PSEYE = True
except ImportError:
    _HAVE_PSEYE = False


def frame_to_gray(frame):
    """An (H,W,3) or (H,W) array -> (w, h, gray_bytes). Requires numpy at runtime."""
    arr = _np.asarray(frame)
    if arr.ndim == 3:
        gray = (arr[:, :, 0].astype(_np.uint16) * 299 +
                arr[:, :, 1].astype(_np.uint16) * 587 +
                arr[:, :, 2].astype(_np.uint16) * 114) // 1000
        gray = gray.astype(_np.uint8)
    else:
        gray = arr.astype(_np.uint8)
    h, w = gray.shape[0], gray.shape[1]
    return w, h, gray.tobytes()


class PsEyeDevice(IrDevice):
    """PlayStation Eye (IR-modded) via pseyepy/libusb."""
    def __init__(self, fps: int = 60) -> None:
        self._fps = fps
        self._on_frame: Optional[OnFrame] = None
        self._cam = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
    def start(self, on_frame: OnFrame) -> None:
        if not _HAVE_PSEYE:
            print("[pseye] pseyepy/numpy not installed — no frames")
            return
        self._on_frame = on_frame
        self._running = True
        self._cam = _pseyepy.Camera(fps=self._fps, resolution=_pseyepy.Camera.RES_LARGE)
        device = self

        def run():
            while device._running:
                frame, _ts = device._cam.read()
                w, h, gray = frame_to_gray(frame)
                if device._on_frame:
                    device._on_frame(w, h, gray)

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()
    def stop(self) -> None:
        self._running = False
        if self._cam is not None:
            try: self._cam.end()
            except Exception: pass
            self._cam = None
```

- [ ] **Step 2: Add a guarded numpy test for `frame_to_gray`**

Append to `videoplaster/bridge/test_devices.py`:

```python
import pytest

def test_frame_to_gray_when_numpy_present():
    np = pytest.importorskip("numpy")
    from ir_device import frame_to_gray
    frame = np.zeros((2, 3, 3), dtype=np.uint8)
    frame[:, :, 1] = 255  # all green
    w, h, gray = frame_to_gray(frame)
    assert (w, h) == (3, 2)
    assert set(gray) == {149}  # 255*587//1000 = 149
```

- [ ] **Step 3: Run the suite**

Run: `cd videoplaster && .venv/bin/python -m pytest bridge/test_devices.py -v`
Expected: PASS; the numpy test runs if numpy is installed, otherwise SKIPPED.

- [ ] **Step 4: Commit**

```bash
git add videoplaster/bridge/ir_device.py videoplaster/bridge/test_devices.py
git commit -m "feat: PsEyeDevice (pseyepy) + frame_to_gray"
```

---

### Task 5: Rewire `leap-bridge.py` (DeviceManager + control message + `--device`)

**Files:**
- Modify: `videoplaster/bridge/leap-bridge.py`

**Interfaces:**
- Consumes: `DeviceManager`, `LeapDevice`, `PsEyeDevice`, `classify_message` from `ir_device.py`.

Wiring/integration — verified by Task 7's run with `--device none` (no hardware) + a manual `FakeDevice` path. Reference: the current file holds `LATEST_IMAGE`, `_pack`, `_extract_left`, `_ImageListener`, `start_leap`, `TuioOut`, `push_images`, `handler`, `main`. Replace the Leap-specific capture with the DeviceManager.

- [ ] **Step 1: Rewrite the capture + handler wiring**

Replace the top section of `videoplaster/bridge/leap-bridge.py` (imports through `start_leap`) so it uses the device facade:

```python
# videoplaster/bridge/leap-bridge.py
"""WS :7681 — receives TouchEvent + device-control JSON from the browser, broadcasts
IR frames from the selected device, and emits TUIO 1.1 to UDP :3333."""
import asyncio, json, argparse
import websockets
from tuio import build_2dcur_bundle
from ir_device import DeviceManager, LeapDevice, PsEyeDevice, classify_message

LATEST_IMAGE = {"buf": None, "seq": 0}

def _registry():
    return {"leap": lambda: LeapDevice(), "pseye": lambda: PsEyeDevice()}

def _on_frame(w, h, gray):
    from ir_device import pack_frame
    LATEST_IMAGE["buf"] = pack_frame(w, h, gray)
    LATEST_IMAGE["seq"] += 1
```

Keep `TuioOut` and `push_images` unchanged. Replace `handler` and `main`:

```python
async def handler(ws, tuio, manager):
    sender = asyncio.create_task(push_images(ws))
    try:
        async for raw in ws:
            if isinstance(raw, bytes): continue
            try: msg = json.loads(raw)
            except Exception: continue
            if classify_message(msg) == "device":
                manager.select(msg.get("name", "none"))
            else:
                tuio.handle(msg); tuio.flush()
    finally:
        sender.cancel()

async def main(args):
    tuio = TuioOut(args.tuio_ip, args.tuio_port)
    manager = DeviceManager(_registry())
    manager.on_frame = _on_frame
    manager.select(args.device)
    async with websockets.serve(lambda ws: handler(ws, tuio, manager), "localhost", args.ws_port):
        print(f"WS :{args.ws_port}  device={args.device}  TUIO -> {args.tuio_ip}:{args.tuio_port}")
        await asyncio.Future()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--ws-port", type=int, default=7681)
    p.add_argument("--device", default="leap", choices=["leap", "pseye", "none"])
    p.add_argument("--tuio-ip", default="127.0.0.1")
    p.add_argument("--tuio-port", type=int, default=3333)
    asyncio.run(main(p.parse_args()))
```

Delete the now-unused `_pack`, `_extract_left`, `_ImageListener`, `start_leap` from the file (moved into `ir_device.py`).

- [ ] **Step 2: Verify it starts with no hardware**

Run: `cd videoplaster && timeout 3 .venv/bin/python bridge/leap-bridge.py --device none ; echo "exit $?"`
Expected: prints `WS :7681  device=none  TUIO -> 127.0.0.1:3333`, runs until the 3s timeout (exit 124). No traceback.

- [ ] **Step 3: Commit**

```bash
git add videoplaster/bridge/leap-bridge.py
git commit -m "feat: bridge uses DeviceManager + device-control message + --device flag"
```

---

### Task 6: Sidecar packaging — pseyepy + numpy

**Files:**
- Modify: `videoplaster/scripts/build-bridge.sh`
- Modify: `videoplaster/bridge/requirements.txt`
- Modify: `videoplaster/DEVELOPMENT.md`

**Interfaces:** none (build config).

- [ ] **Step 1: Add the runtime deps**

Append to `videoplaster/bridge/requirements.txt`:

```
numpy
pseyepy
```

- [ ] **Step 2: Bundle them in the PyInstaller sidecar**

In `videoplaster/scripts/build-bridge.sh`, add to the `pyinstaller` invocation flags (before the entry script):

```bash
  --collect-all pseyepy \
  --collect-all numpy \
```

After the `mv` line, add a note for the native libusb that pseyepy links:

```bash
# pseyepy uses libusb via cffi. If PyInstaller does not embed libusb-1.0.dylib,
# copy it next to the binary:  cp "$(brew --prefix libusb)/lib/libusb-1.0.0.dylib" "$OUT/"
```

- [ ] **Step 3: Document the device flag + PS Eye prereqs**

In `videoplaster/DEVELOPMENT.md`, under the "Standalone macOS App (Tauri)" → "Freeze the bridge sidecar" section, add:

```markdown
The bridge supports `--device leap|pseye|none` (default `leap`); the frontend also
switches the device live via a WS control message. PS Eye needs `pseyepy` + libusb
(`brew install libusb`); the PS Eye is driver-free over libusb.
```

- [ ] **Step 4: Verify the script is still valid bash**

Run: `cd videoplaster && bash -n scripts/build-bridge.sh && echo "syntax ok"`
Expected: `syntax ok`.

- [ ] **Step 5: Commit**

```bash
git add videoplaster/scripts/build-bridge.sh videoplaster/bridge/requirements.txt videoplaster/DEVELOPMENT.md
git commit -m "build: bundle pseyepy + numpy in the bridge sidecar; document --device"
```

---

### Task 7: Integration smoke (FakeDevice path + live device switch)

**Files:**
- Create: `videoplaster/bridge/test_integration.py`

**Interfaces:** none (end-to-end verification, no hardware).

- [ ] **Step 1: Write an integration test driving the manager via a control message path**

```python
# videoplaster/bridge/test_integration.py
from ir_device import DeviceManager, FakeDevice, classify_message, pack_frame

def test_control_message_selects_device_and_frames_flow():
    fake = FakeDevice()
    out = []
    mgr = DeviceManager({"fake": lambda: fake})
    mgr.on_frame = lambda w, h, buf: out.append(pack_frame(w, h, buf))

    # simulate the bridge handler receiving a device-control message
    msg = {"type": "device", "name": "fake"}
    assert classify_message(msg) == "device"
    mgr.select(msg["name"])

    fake.feed(2, 1, bytes([5, 6]))
    assert out and out[0][:8] == pack_frame(2, 1, bytes([5, 6]))[:8]
    assert out[0][8:] == bytes([5, 6])
```

- [ ] **Step 2: Run the full bridge suite**

Run: `cd videoplaster && .venv/bin/python -m pytest bridge/ -v`
Expected: all pass (test_devices + test_integration + existing test_tuio).

- [ ] **Step 3: Manual — real PS Eye (hands-on, hardware required)**

With a PS Eye plugged in: `cd videoplaster && .venv/bin/python bridge/leap-bridge.py --device pseye`. In the browser/app select **PS EYE**; confirm the IR preview streams and touches produce ripples. Then switch the dropdown to **LEAP IR** and confirm the bridge swaps devices live (status updates, frames continue). Document the result.

- [ ] **Step 4: Commit**

```bash
git add videoplaster/bridge/test_integration.py
git commit -m "test: bridge integration — control message selects device, frames flow"
```

---

## Self-Review notes

- Spec coverage: `IrDevice`+`DeviceManager` (T2), `LeapDevice` (T3), `PsEyeDevice`+pseyepy (T4), WS control discrimination + `--device` (T5, T1), sidecar bundling (T6), integration (T7). Frontend `pseye` source ships in Phase 1; this phase makes it stream.
- Placeholder scan: all code steps contain full implementations; hardware-only paths (T3/T4 runtime, T7 step 3) are explicitly marked manual with exact commands.
- Type consistency: `on_frame(w,h,buf)` signature identical across `IrDevice`, `FakeDevice`, `DeviceManager`, `LeapDevice`, `PsEyeDevice`, and `_on_frame` in the bridge; `classify_message` returns `"device"`/`"touch"` used verbatim in T5's handler.
- Dependency safety: `leap`, `pseyepy`, `numpy` are guarded imports; the default `pytest` run needs none of them (numpy test uses `importorskip`).
