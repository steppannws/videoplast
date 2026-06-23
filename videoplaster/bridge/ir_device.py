"""Pluggable IR capture devices for the videoplaster bridge.

The entry script (leap-bridge.py) wires these into the WS server. Pure helpers and
the device facade live here so they stay importable + unit-testable without hardware.
"""
import struct
import threading
from typing import Callable, Dict, Optional

try:
    import leap
    from leap.enums import PolicyFlag
    _HAVE_LEAP = True
except ImportError:
    _HAVE_LEAP = False


def pack_frame(w: int, h: int, buf: bytes) -> bytes:
    """Pack a grayscale frame into the WS wire format: u32 w, u32 h, then w*h bytes."""
    return struct.pack("<II", w, h) + bytes(buf)[: w * h]


def classify_message(msg: dict) -> str:
    """Inbound WS JSON: a `type` field marks a control message; otherwise it's a touch."""
    return "device" if "type" in msg else "touch"


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
        if self._thread is not None:
            self._thread.join(timeout=0.5)
            self._thread = None
