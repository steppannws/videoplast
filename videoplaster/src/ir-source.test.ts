import { test } from "node:test";
import assert from "node:assert/strict";
import { IrSource } from "./ir-source.ts";
import type { IrFrameProvider } from "./ir-provider.ts";

class FakeProvider implements IrFrameProvider {
  frameCb: (w: number, h: number, g: Uint8Array) => void = () => {};
  started = false;
  start() { this.started = true; }
  stop() { this.started = false; }
  restart() { this.stop(); this.start(); }
  onFrame(cb: (w: number, h: number, g: Uint8Array) => void) { this.frameCb = cb; }
  onStatus() {}
}

test("IrSource emits TouchEv when its provider delivers a bright frame", () => {
  const fake = new FakeProvider();
  const src = new IrSource(fake, "ir-test");
  src.opt.threshold = 40; src.opt.minArea = 2; src.opt.erosionAmt = 0; src.opt.blurAmt = 0;
  const events: any[] = [];
  src.onTouch((ev) => events.push(ev));
  src.start();
  assert.equal(fake.started, true);
  const w = 32, h = 32, gray = new Uint8Array(w * h);
  for (let y = 14; y < 18; y++) for (let x = 14; x < 18; x++) gray[y * w + x] = 255;
  fake.frameCb(w, h, gray);
  assert.ok(events.length >= 1, "expected emitted event");
});
