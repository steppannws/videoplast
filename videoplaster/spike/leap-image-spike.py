# videoplaster/spike/leap-image-spike.py
"""Phase 0 gate: does this Gemini expose raw IR images via LeapC?
Run with the Ultraleap service running and a hand/object over the device.
Success = it prints image dimensions and writes spike_frame.pgm."""
import time
import leap  # leapc-python-bindings

import asyncio, struct, threading, websockets
LATEST = {"buf": None}

def pack(w, h, buf):
    return struct.pack("<II", w, h) + bytes(buf)[: w * h]

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
        imgs = event.image  # sequence of leap.Image (left, right)
        print("IMAGE EVENT — discovering attributes:")
        print("  len(event.image) =", len(imgs))
        left = imgs[0]
        # attribute names vary by binding version — print what's there:
        print("  dir(image[0]) =", [a for a in dir(left) if not a.startswith("__")])
        w = getattr(left, "width", None)
        h = getattr(left, "height", None)
        print(f"  width={w} height={h}")
        data = getattr(left, "data", None)
        if data is not None and w and h:
            buf = bytes(data)[: w * h]
            with open("spike_frame.pgm", "wb") as f:
                f.write(f"P5\n{w} {h}\n255\n".encode()); f.write(buf)
            print("  wrote spike_frame.pgm")
            LATEST["buf"] = pack(w, h, data)
        self.got = True

def main():
    start_ws()
    listener = ImageProbe()
    conn = leap.Connection()
    conn.add_listener(listener)
    with conn.open():
        # Enable images. Exact flag name is what Phase 0 must confirm:
        try:
            conn.set_policy_flags([leap.PolicyFlag.Images])
            print("set_policy_flags([PolicyFlag.Images]) OK")
        except Exception as e:
            print("PolicyFlag.Images failed:", e)
            print("available PolicyFlag:", [a for a in dir(leap.PolicyFlag) if not a.startswith("__")])
        t0 = time.time()
        while not listener.got and time.time() - t0 < 20:
            time.sleep(0.1)
    print("RESULT:", "IMAGES AVAILABLE" if listener.got else "NO IMAGES — IR path not viable")

if __name__ == "__main__":
    main()
