# videoplaster/bridge/leap-bridge.py
"""Receives TouchEvent JSON from the browser over WS :7681 and emits TUIO 1.1 to UDP :3333.
Phase 2 adds the IR image push on the same WS server."""
import asyncio, json, argparse
import websockets
from tuio import build_2dcur_bundle

import struct, threading
try:
    import leap
    from leap.enums import PolicyFlag      # NOTE: PolicyFlag lives in leap.enums, not leap.*
    HAVE_LEAP = True
except ImportError:
    HAVE_LEAP = False

LATEST_IMAGE = {"buf": None}

def _pack(w, h, buf):
    return struct.pack("<II", w, h) + bytes(buf)[: w * h]

def _extract_left(event):
    # The LeapC Image wrapper exposes only matrix_version; the pixels live in the raw
    # cffi LEAP_IMAGE struct: properties{width,height,bpp} + void* data + uint32 offset.
    d = event.image[0]._data
    p = d.properties
    w, h, bpp = int(p.width), int(p.height), int(p.bpp)
    ptr = leap.ffi.cast("uint8_t*", d.data)
    return w, h, bytes(leap.ffi.buffer(ptr + d.offset, w * h * bpp))

class _ImageListener(leap.Listener if HAVE_LEAP else object):
    def on_device_event(self, event):
        print("Leap device connected")
    def on_image_event(self, event):
        try:
            w, h, buf = _extract_left(event)
        except Exception as ex:
            print("image extract failed:", repr(ex)); return
        LATEST_IMAGE["buf"] = _pack(w, h, buf)

def start_leap():
    if not HAVE_LEAP:
        print("WARNING: `leap` not importable — image stream disabled (MOUSE/TUIO still work)"); return
    def run():
        conn = leap.Connection(); conn.add_listener(_ImageListener())
        with conn.open():
            try: conn.set_policy_flags([PolicyFlag.Images])
            except Exception as e: print("image policy failed:", repr(e))
            import time
            while True: time.sleep(0.01)
    threading.Thread(target=run, daemon=True).start()

class TuioOut:
    def __init__(self, ip, port):
        import socket
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._addr = (ip, port)
        self.cursors = {}   # id -> (x, y)
        self.fseq = 0
    def handle(self, ev):
        i = int(ev["id"])
        if ev["state"] == "up":
            self.cursors.pop(i, None)
        else:
            self.cursors[i] = (float(ev["x"]), float(ev["y"]))
    def flush(self):
        self.fseq += 1
        self._sock.sendto(build_2dcur_bundle(self.cursors, self.fseq), self._addr)

async def push_images(ws):
    while True:
        if LATEST_IMAGE["buf"] is not None:
            try: await ws.send(LATEST_IMAGE["buf"])
            except Exception: return
            LATEST_IMAGE["buf"] = None
        await asyncio.sleep(1/30)

async def handler(ws, tuio):
    sender = asyncio.create_task(push_images(ws))
    try:
        async for raw in ws:
            if isinstance(raw, bytes): continue
            try: ev = json.loads(raw)
            except Exception: continue
            tuio.handle(ev); tuio.flush()
    finally:
        sender.cancel()

async def main(args):
    tuio = TuioOut(args.tuio_ip, args.tuio_port)
    start_leap()
    async with websockets.serve(lambda ws: handler(ws, tuio), "localhost", args.ws_port):
        print(f"WS :{args.ws_port}  TUIO → {args.tuio_ip}:{args.tuio_port}")
        await asyncio.Future()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--ws-port", type=int, default=7681)
    p.add_argument("--tuio-ip", default="127.0.0.1")
    p.add_argument("--tuio-port", type=int, default=3333)
    asyncio.run(main(p.parse_args()))
