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
