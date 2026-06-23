import struct
from ir_device import pack_frame, classify_message, IrDevice, FakeDevice, DeviceManager

def test_pack_frame_header_and_truncation():
    out = pack_frame(2, 2, bytes([1, 2, 3, 4, 5, 6]))
    assert out[:8] == struct.pack("<II", 2, 2)
    assert out[8:] == bytes([1, 2, 3, 4])  # truncated to w*h

def test_classify_device_vs_touch():
    assert classify_message({"type": "device", "name": "pseye"}) == "device"
    assert classify_message({"id": 0, "x": 0.5, "y": 0.5, "state": "down"}) == "touch"

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
