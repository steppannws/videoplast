# bridge/tuio-bridge.py
"""WS :7681 -> TUIO relay. Receives TouchEvent JSON from the browser (any source:
mouse or camera) and emits TUIO 1.1 /tuio/2Dcur to UDP :3333."""
import asyncio, json, argparse, os, threading, time
import websockets
from tuio import build_2dcur_bundle


def watch_app(pid):
    """Exit when the host app dies. Covers force-quit (SIGKILL), where the app
    never gets a chance to terminate us. os._exit so a hung main loop can't
    keep the process alive."""
    while True:
        time.sleep(1)
        try:
            os.kill(pid, 0)
        except OSError:
            os._exit(0)


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


async def handler(ws, tuio):
    async for raw in ws:
        if isinstance(raw, bytes):
            continue
        try:
            msg = json.loads(raw)
        except Exception:
            continue
        if not isinstance(msg, dict) or "id" not in msg or "state" not in msg:
            continue  # not a touch event
        try:
            tuio.handle(msg)
            tuio.flush()
        except (KeyError, TypeError, ValueError):
            continue


async def main(args):
    tuio = TuioOut(args.tuio_ip, args.tuio_port)
    async with websockets.serve(lambda ws: handler(ws, tuio), "localhost", args.ws_port):
        print(f"WS :{args.ws_port}  TUIO -> {args.tuio_ip}:{args.tuio_port}")
        await asyncio.Future()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--ws-port", type=int, default=7681)
    p.add_argument("--tuio-ip", default="127.0.0.1")
    p.add_argument("--tuio-port", type=int, default=3333)
    p.add_argument("--app-pid", type=int, default=0,
                   help="exit when this process dies (0 = disabled)")
    args = p.parse_args()
    if args.app_pid:
        threading.Thread(target=watch_app, args=(args.app_pid,), daemon=True).start()
    asyncio.run(main(args))
