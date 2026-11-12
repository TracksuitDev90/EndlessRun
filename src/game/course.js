import { CONFIG } from '../config.js';
import { makeDream, holdBack } from './dream.js';

// The course is the sequence of worlds laid out along the track. Each
// segment is a stretch of one world; a doorway stands at every boundary.

export class Course {
  constructor(worlds) {
    this.worlds = worlds;
    this.byId = new Map(worlds.map((w) => [w.id, w]));
    this.segments = [];
  }

  // startVisit lets debug runs (?visit=n) begin on a later lap's look;
  // dream (?dream=x) pins every world to one dream level.
  reset(rng, startId, startVisit = 0, dream) {
    this.rng = rng;
    this.forcedDream = dream;
    this.segments.length = 0;
    this.startVisit = startVisit;
    this.visits = new Map();
    const ids = this.worlds.map((w) => w.id);
    const startIdx = Math.max(0, ids.indexOf(startId || ids[0]));
    this.lastId = ids[startIdx];
    const L = CONFIG.chunkLength;
    const world = this.byId.get(this.lastId);
    const visit = this.nextVisit(this.lastId);
    this.segments.push({ world, start: -L * 6, end: CONFIG.firstWorldLength, ordinal: 1, visit, dream: this.dreamFor(world, visit, 1) });
  }

  // The dream recipe for a stretch of `world`, the ordinal-th of the run and
  // the visit-th time through it: dealt by depth, then held back if the
  // world asks (def.dream, see holdBack). Pinned with ?dream=, it's left as
  // dealt.
  dreamFor(world, visit, ordinal) {
    const recipe = makeDream(this.rng, ordinal, this.forcedDream);
    return this.forcedDream === undefined ? holdBack(recipe, world.def.dream, visit) : recipe;
  }

  // How many times this world has already been run through this run.
  nextVisit(id) {
    const v = this.visits.has(id) ? this.visits.get(id) : this.startVisit;
    this.visits.set(id, v + 1);
    return v;
  }

  // The worlds always come in their authored order (world/index.js), lap
  // after lap: from the last one back round to the first.
  nextWorldId() {
    const i = this.worlds.findIndex((w) => w.id === this.lastId);
    const id = this.worlds[(i + 1) % this.worlds.length].id;
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
      const id = this.nextWorldId();
      const ordinal = last.ordinal + 1;
      const world = this.byId.get(id);
      const visit = this.nextVisit(id);
      this.segments.push({ world, start: last.end, end: last.end + len, ordinal, visit, dream: this.dreamFor(world, visit, ordinal) });
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
