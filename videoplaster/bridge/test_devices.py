import struct
from ir_device import pack_frame, classify_message

def test_pack_frame_header_and_truncation():
    out = pack_frame(2, 2, bytes([1, 2, 3, 4, 5, 6]))
    assert out[:8] == struct.pack("<II", 2, 2)
    assert out[8:] == bytes([1, 2, 3, 4])  # truncated to w*h

def test_classify_device_vs_touch():
    assert classify_message({"type": "device", "name": "pseye"}) == "device"
    assert classify_message({"id": 0, "x": 0.5, "y": 0.5, "state": "down"}) == "touch"
