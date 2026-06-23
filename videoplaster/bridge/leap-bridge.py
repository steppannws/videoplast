# videoplaster/bridge/leap-bridge.py
"""WS :7681 — receives TouchEvent + device-control JSON from the browser, broadcasts
IR frames from the selected device, and emits TUIO 1.1 to UDP :3333."""
import asyncio, json, argparse
import websockets
from tuio import build_2dcur_bundle
from ir_device import DeviceManager, LeapDevice, PsEyeDevice, classify_message

LATEST_IMAGE = {"buf": None, "seq": 0}

def _registry():
    return {"leap": lambda: LeapDevice(), "pseye": lambda: PsEyeDevice()}

def _on_frame(w, h, gray):
    from ir_device import pack_frame
    LATEST_IMAGE["buf"] = pack_frame(w, h, gray)
    LATEST_IMAGE["seq"] += 1

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
    # Broadcast: send the newest frame to THIS client when it changes. Non-destructive —
    # never null the shared buffer, so multiple clients (LeapImageSource + TouchEmitter)
    # each receive every frame instead of stealing from one another.
    last = 0
    while True:
        seq = LATEST_IMAGE["seq"]
        if seq != last and LATEST_IMAGE["buf"] is not None:
            last = seq
            try: await ws.send(LATEST_IMAGE["buf"])
            except Exception: return
        await asyncio.sleep(1/30)

async def handler(ws, tuio, manager):
    sender = asyncio.create_task(push_images(ws))
    try:
        async for raw in ws:
            if isinstance(raw, bytes): continue
            try: msg = json.loads(raw)
            except Exception: continue
            if classify_message(msg) == "device":
                manager.select(msg.get("name", "none"))
            else:
                tuio.handle(msg); tuio.flush()
    finally:
        sender.cancel()

async def main(args):
    tuio = TuioOut(args.tuio_ip, args.tuio_port)
    manager = DeviceManager(_registry())
    manager.on_frame = _on_frame
    manager.select(args.device)
    async with websockets.serve(lambda ws: handler(ws, tuio, manager), "localhost", args.ws_port):
        print(f"WS :{args.ws_port}  device={args.device}  TUIO -> {args.tuio_ip}:{args.tuio_port}")
        await asyncio.Future()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--ws-port", type=int, default=7681)
    p.add_argument("--device", default="leap", choices=["leap", "pseye", "none"])
    p.add_argument("--tuio-ip", default="127.0.0.1")
    p.add_argument("--tuio-port", type=int, default=3333)
    asyncio.run(main(p.parse_args()))
