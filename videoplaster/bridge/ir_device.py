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
