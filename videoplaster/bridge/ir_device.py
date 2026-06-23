"""Pluggable IR capture devices for the videoplaster bridge.

The entry script (leap-bridge.py) wires these into the WS server. Pure helpers and
the device facade live here so they stay importable + unit-testable without hardware.
"""
import struct
from typing import Callable, Dict, Optional


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
