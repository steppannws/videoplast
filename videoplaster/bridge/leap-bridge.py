# videoplaster/bridge/leap-bridge.py
"""Receives TouchEvent JSON from the browser over WS :7681 and emits TUIO 1.1 to UDP :3333.
Phase 2 adds the IR image push on the same WS server."""
import asyncio, json, argparse
import websockets
from pythonosc.udp_client import UDPClient
from tuio import build_2dcur_bundle

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

async def handler(ws, tuio):
    async for raw in ws:
        if isinstance(raw, bytes):
            continue  # image frames flow the other way (Phase 2)
        try:
            ev = json.loads(raw)
        except Exception:
            continue
        tuio.handle(ev)
        tuio.flush()

async def main(args):
    tuio = TuioOut(args.tuio_ip, args.tuio_port)
    async with websockets.serve(lambda ws: handler(ws, tuio), "localhost", args.ws_port):
        print(f"WS :{args.ws_port}  TUIO → {args.tuio_ip}:{args.tuio_port}")
        await asyncio.Future()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--ws-port", type=int, default=7681)
    p.add_argument("--tuio-ip", default="127.0.0.1")
    p.add_argument("--tuio-port", type=int, default=3333)
    asyncio.run(main(p.parse_args()))
