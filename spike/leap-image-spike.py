# spike/leap-image-spike.py
"""Phase 0 gate: does this Gemini expose raw IR images via LeapC?
Run with the Ultraleap service running and the device pointed at a scene.
Success = it prints image dimensions and writes spike_frame.pgm."""
import time
import leap                       # leapc-python-bindings
from leap.enums import PolicyFlag

import asyncio, struct, threading, websockets
LATEST = {"buf": None}

def pack(w, h, buf):
    return struct.pack("<II", w, h) + bytes(buf)[: w * h]

# LeapC Image wrapper only exposes matrix_version; pixels live in the raw cffi
# LEAP_IMAGE struct: properties{width,height,bpp} + void* data + uint32 offset.
def extract_left(event):
    left = event.image[0]
    d = left._data
    p = d.properties
    w, h, bpp = int(p.width), int(p.height), int(p.bpp)
    n = w * h * bpp
    ptr = leap.ffi.cast("uint8_t*", d.data)
    buf = bytes(leap.ffi.buffer(ptr + d.offset, n))
    return w, h, bpp, buf

async def ws_handler(ws):
    while True:
        if LATEST["buf"] is not None:
            await ws.send(LATEST["buf"]); LATEST["buf"] = None
        await asyncio.sleep(1 / 60)

async def ws_main():
    async with websockets.serve(ws_handler, "localhost", 7681):
        await asyncio.Future()

def start_ws():
    threading.Thread(target=lambda: asyncio.run(ws_main()), daemon=True).start()

class ImageProbe(leap.Listener):
    def __init__(self):
        self.got = False
    def on_device_event(self, event):
        print("device connected")
    def on_image_event(self, event):
        try:
            w, h, bpp, buf = extract_left(event)
        except Exception as ex:
            print("image extract failed:", repr(ex)); return
        if not self.got:
            print(f"IMAGE EVENT  w={w} h={h} bpp={bpp} bytes={len(buf)}")
            with open("spike_frame.pgm", "wb") as f:
                f.write(f"P5\n{w} {h}\n255\n".encode()); f.write(buf[: w * h])
            print("  wrote spike_frame.pgm")
        LATEST["buf"] = pack(w, h, buf)
        self.got = True

def main():
    start_ws()
    listener = ImageProbe()
    conn = leap.Connection()
    conn.add_listener(listener)
    with conn.open():
        try:
            conn.set_policy_flags([PolicyFlag.Images])
            print("set_policy_flags([PolicyFlag.Images]) OK")
        except Exception as e:
            print("PolicyFlag.Images failed:", repr(e))
            print("available PolicyFlag:", [a for a in dir(PolicyFlag) if not a.startswith("_")])
        t0 = time.time()
        while not listener.got and time.time() - t0 < 20:
            time.sleep(0.1)
    print("RESULT:", "IMAGES AVAILABLE" if listener.got else "NO IMAGES — IR path not viable")

if __name__ == "__main__":
    main()
