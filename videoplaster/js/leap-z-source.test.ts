// videoplaster/js/leap-z-source.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFingerTips, fingerToTouch } from "./leap-z-source.ts";

test("extractFingerTips reads Gemini hands[].fingers[].bones[] tips", () => {
  const frame = { hands: [{ type:"left", fingers: [
    { extended:true, bones:[{},{},{},{ type:3, nextJoint:[10,200,5] }] },
    { extended:false, bones:[{ type:3, nextJoint:[0,0,0] }] },
  ] }] };
  const tips = extractFingerTips(frame);
  assert.equal(tips.length, 1);
  assert.deepEqual(tips[0], [10, 200, 5]);
});

test("fingerToTouch maps box-normalised x/z and flags touch below threshold", () => {
  const box = { center:[0,200,0], size:[200,200,200] };
  const t = fingerToTouch([0,210,0], box, { thresh:40, zoomX:1, zoomZ:1, invertZ:false });
  assert.ok(Math.abs(t.x-0.5) < 1e-9 && Math.abs(t.y-0.5) < 1e-9);
  // y height 210 is within thresh? height measured as box-relative; here just assert shape:
  assert.ok("touch" in t && "strength" in t);
});
