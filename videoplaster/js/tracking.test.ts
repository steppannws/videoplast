// videoplaster/js/tracking.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { BlobTracker } from "./tracking.ts";

test("new blob -> down, moved blob -> move with same id, gone -> up", () => {
  const tr = new BlobTracker({ maxDist: 0.1 });
  let evs = tr.update([{ x:0.2, y:0.2, strength:0.9 }]);
  assert.equal(evs.length, 1); assert.equal(evs[0].state, "down");
  const id = evs[0].id;
  evs = tr.update([{ x:0.22, y:0.21, strength:0.9 }]);
  assert.equal(evs[0].state, "move"); assert.equal(evs[0].id, id);
  evs = tr.update([]);
  assert.equal(evs[0].state, "up"); assert.equal(evs[0].id, id);
});

test("two simultaneous blobs keep distinct ids", () => {
  const tr = new BlobTracker({ maxDist: 0.1 });
  const evs = tr.update([{ x:0.1,y:0.1,strength:1 }, { x:0.8,y:0.8,strength:1 }]);
  const ids = evs.map(e => e.id);
  assert.equal(new Set(ids).size, 2);
});

test("a far jump starts a new id rather than teleporting", () => {
  const tr = new BlobTracker({ maxDist: 0.1 });
  const a = tr.update([{ x:0.1,y:0.1,strength:1 }])[0].id;
  const evs = tr.update([{ x:0.9,y:0.9,strength:1 }]);
  // old id goes up, new id goes down
  assert.ok(evs.some(e => e.state === "up" && e.id === a));
  assert.ok(evs.some(e => e.state === "down" && e.id !== a));
});
