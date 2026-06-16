// videoplaster/js/tracking.js
// Greedy nearest-neighbour matching of current blobs to active tracks.
export class BlobTracker {
  constructor({ maxDist = 0.08 } = {}) { this.maxDist = maxDist; this.tracks = new Map(); this.nextId = 1; }
  update(blobs) {
    const events = [];
    const unmatched = new Set(this.tracks.keys());
    const used = new Array(blobs.length).fill(false);
    // match each existing track to the closest unused blob within maxDist
    for (const [id, tk] of this.tracks) {
      let best = -1, bestD = this.maxDist;
      for (let i = 0; i < blobs.length; i++) {
        if (used[i]) continue;
        const d = Math.hypot(blobs[i].x - tk.x, blobs[i].y - tk.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        used[best] = true; unmatched.delete(id);
        const b = blobs[best]; this.tracks.set(id, { x: b.x, y: b.y });
        events.push({ id, x: b.x, y: b.y, z: 0, strength: b.strength, state: "move" });
      }
    }
    // leftover tracks → up
    for (const id of unmatched) {
      const tk = this.tracks.get(id); this.tracks.delete(id);
      events.push({ id, x: tk.x, y: tk.y, z: 0, strength: 0, state: "up" });
    }
    // leftover blobs → new down
    for (let i = 0; i < blobs.length; i++) {
      if (used[i]) continue;
      const id = this.nextId++; const b = blobs[i];
      this.tracks.set(id, { x: b.x, y: b.y });
      events.push({ id, x: b.x, y: b.y, z: 0, strength: b.strength, state: "down" });
    }
    return events;
  }
}
