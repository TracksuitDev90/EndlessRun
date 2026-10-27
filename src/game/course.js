import { CONFIG } from '../config.js';

// The course is the sequence of worlds laid out along the track. Each
// segment is a stretch of one world; a doorway stands at every boundary.

export class Course {
  constructor(worlds) {
    this.worlds = worlds;
    this.byId = new Map(worlds.map((w) => [w.id, w]));
    this.segments = [];
  }

  reset(rng, startId) {
    this.rng = rng;
    this.segments.length = 0;
    const ids = this.worlds.map((w) => w.id);
    const startIdx = Math.max(0, ids.indexOf(startId || ids[0]));
    // First lap: the authored order, beginning at the start world.
    this.queue = ids.slice(startIdx).concat(ids.slice(0, startIdx)).slice(1);
    this.lastId = ids[startIdx];
    const L = CONFIG.chunkLength;
    this.segments.push({ world: this.byId.get(this.lastId), start: -L * 6, end: CONFIG.firstWorldLength, ordinal: 1 });
  }

  nextWorldId() {
    if (this.queue.length === 0) {
      const ids = this.worlds.map((w) => w.id).filter((id) => id !== this.lastId);
      this.queue = this.rng.shuffle(ids);
    }
    const id = this.queue.shift();
    this.lastId = id;
    return id;
  }

  ensure(d, speed) {
    const L = CONFIG.chunkLength;
    while (this.segments[this.segments.length - 1].end < d + 900) {
      const last = this.segments[this.segments.length - 1];
      let len = speed * CONFIG.worldSeconds;
      len = Math.min(CONFIG.worldMax, Math.max(CONFIG.worldMin, len));
      len = Math.round(len / L) * L;
      this.segments.push({ world: this.byId.get(this.nextWorldId()), start: last.end, end: last.end + len, ordinal: last.ordinal + 1 });
    }
    // forget segments far behind
    while (this.segments.length > 2 && this.segments[1].end < d - 600) this.segments.shift();
  }

  segAt(d) {
    const s = this.segments;
    for (let i = s.length - 1; i >= 0; i--) if (d >= s[i].start) return s[i];
    return s[0];
  }

  prevOf(seg) {
    const i = this.segments.indexOf(seg);
    return i > 0 ? this.segments[i - 1] : null;
  }

  nextOf(seg) {
    const i = this.segments.indexOf(seg);
    return i >= 0 && i < this.segments.length - 1 ? this.segments[i + 1] : null;
  }

  // First doorway whose position is greater than d.
  boundaryAfter(d) {
    const s = this.segments;
    for (let i = 1; i < s.length; i++) {
      if (s[i].start > d) return { d: s[i].start, from: s[i - 1], to: s[i] };
    }
    return null;
  }
}
