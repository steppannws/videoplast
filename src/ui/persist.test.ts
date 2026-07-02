// src/ui/persist.test.ts
// parseSettings validation + replaceSettings/exportSettings roundtrip. persist.ts
// touches localStorage at import time, so stub it before the dynamic import.
import { test } from "node:test";
import assert from "node:assert/strict";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

const persist = await import("./persist.ts");

test("parseSettings accepts an object", () => {
  assert.deepEqual(persist.parseSettings('{"a":1,"b":"x"}'), { a: 1, b: "x" });
});

test("parseSettings rejects arrays, primitives, null, and malformed JSON", () => {
  assert.throws(() => persist.parseSettings("[1,2]"));
  assert.throws(() => persist.parseSettings("42"));
  assert.throws(() => persist.parseSettings("null"));
  assert.throws(() => persist.parseSettings("{not json}"));
});

test("replaceSettings + exportSettings roundtrip through localStorage", () => {
  persist.replaceSettings({ threshold: 55, "fx.active": "water" });
  assert.equal(persist.getSetting("threshold"), 55);
  assert.equal(persist.getSetting("fx.active"), "water");
  assert.deepEqual(JSON.parse(persist.exportSettings()), { threshold: 55, "fx.active": "water" });
});

test("replaceSettings drops keys not present in the new object", () => {
  persist.replaceSettings({ a: 1 });
  persist.replaceSettings({ b: 2 });
  assert.equal(persist.getSetting("a"), undefined);
  assert.equal(persist.getSetting("b"), 2);
});
