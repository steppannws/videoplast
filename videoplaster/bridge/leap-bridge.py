# videoplaster/bridge/leap-bridge.py
"""Receives TouchEvent JSON from the browser over WS :7681 and emits TUIO 1.1 to UDP :3333.
Phase 2 adds the IR image push on the same WS server."""
import asyncio, json, argparse
import websockets
from pythonosc.udp_client import UDPClient
from tuio import build_2dcur_bundle

import struct, threading
try:
    import leap
    HAVE_LEAP = True
except ImportError:
    HAVE_LEAP = False

LATEST_IMAGE = {"buf": None}

def _pack(w, h, buf):
    return struct.pack("<II", w, h) + bytes(buf)[: w * h]

class _ImageListener(leap.Listener if HAVE_LEAP else object):
    def on_image_event(self, event):
        left = event.image[0]
        w = getattr(left, "width", None); h = getattr(left, "height", None)
        data = getattr(left, "data", None)
        if w and h and data is not None:
            LATEST_IMAGE["buf"] = _pack(w, h, data)

def start_leap():
    if not HAVE_LEAP:
        print("WARNING: `leap` not importable — image stream disabled (mouse/Z still work)"); return
    def run():
        conn = leap.Connection(); conn.add_listener(_ImageListener())
        with conn.open():
            try: conn.set_policy_flags([leap.PolicyFlag.Images])
            except Exception as e: print("image policy failed:", e)
            import time
            while True: time.sleep(0.01)
    threading.Thread(target=run, daemon=True).start()

class TuioOut:
    def __init__(self, ip, port):
        self.client = UDPClient(ip, port)
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
        # UDPClient.send expects an OscMessage/Bundle; send raw dgram via its transport:
        self.client._sock.sendto(build_2dcur_bundle(self.cursors, self.fseq), (self.client._address, self.client._port))

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
