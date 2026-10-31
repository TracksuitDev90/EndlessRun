import { CONFIG } from '../config.js';
import { RNG, hashSeed } from '../core/rng.js';
import { rgb } from '../render/geo.js';

// Streams scenery in fixed-length chunks ahead of the runner and recycles
// them behind. Each world definition decides what a chunk contains.

export class ChunkStreamer {
  constructor(game) {
    this.game = game;
    this.live = [];
    this.nextD = 0;
    this.seed = 1;
    const self = this;
    this.ctx = {
      rng: null,
      d0: 0,
      L: CONFIG.chunkLength,
      index: 0,
      toEnd: 0,
      visit: 0, // how many times this world has been run through before
      continuation: false,
      chunk: null,
      world: null,
      put(name, x, y, dz, o) {
        self.ctx.world.put(self.ctx.chunk, name, x, y, self.ctx.d0 + dz, o);
      },
    };
  }

  reset(seed, startD) {
    this.clear();
    this.seed = seed;
    const L = CONFIG.chunkLength;
    this.nextD = Math.floor((startD - 48) / L) * L;
  }

  clear() {
    for (const c of this.live) c.world.removeOwner(c);
    this.live.length = 0;
  }

  // Drop everything belonging to one world (after running through its door).
  dropWorld(world) {
    let w = 0;
    for (const c of this.live) {
      if (c.world === world) world.removeOwner(c);
      else this.live[w++] = c;
    }
    this.live.length = w;
  }

  update(dist) {
    const L = CONFIG.chunkLength;
    while (this.nextD < dist + CONFIG.viewAhead) {
      this.spawn(this.nextD);
      this.nextD += L;
    }
    const limit = dist - CONFIG.despawnBehind;
    let w = 0;
    for (const c of this.live) {
      if (c.d0 + L < limit) c.world.removeOwner(c);
      else this.live[w++] = c;
    }
    this.live.length = w;
  }

  spawn(d0) {
    const course = this.game.course;
    const L = CONFIG.chunkLength;
    const seg = course.segAt(d0 + 0.5);
    const chunk = this.make(seg, d0, false);

    // The world you're leaving carries on around the doorway for a while.
    const prev = course.prevOf(seg);
    if (prev && prev.world.def.continuation !== false && d0 < seg.start + CONFIG.continuationLength && this.game.worldVisible(prev.world)) {
      this.make(prev, d0, true);
    }

    if (Math.abs(d0 + L - seg.end) < 0.01) {
      const next = course.nextOf(seg);
      if (next) this.placeGate(seg.world, next.world, seg.end, chunk);
    }
  }

  make(seg, d0, continuation) {
    const L = CONFIG.chunkLength;
    const world = seg.world;
    const chunk = { world, d0, continuation };
    const ctx = this.ctx;
    ctx.rng = new RNG(hashSeed(this.seed, d0 / L, continuation ? 7 : 3, world.id.length));
    ctx.d0 = d0;
    ctx.index = Math.round((d0 - seg.start) / L);
    ctx.toEnd = seg.end - d0;
    ctx.visit = seg.visit || 0;
    ctx.continuation = continuation;
    ctx.chunk = chunk;
    ctx.world = world;
    world.def.chunk(ctx);
    this.live.push(chunk);
    return chunk;
  }

  placeGate(from, to, doorD, owner) {
    const g = from.def.gate;
    const quadD = doorD + g.depth / 2;
    const leafD = quadD - 0.28;
    const tint = rgb(to.def.doorColor);
    from.put(owner, 'gateFrame', 0, 0, doorD);
    from.put(owner, 'gateLeaf', -g.opening.halfW, 0, leafD, { ry: 0, c: tint, p1: 1, p0: 0 });
    from.put(owner, 'gateLeaf', g.opening.halfW, 0, leafD, { ry: Math.PI, c: tint, p1: -1, p0: 0 });
    // (each extra a batch name, or [name, x, y, dz] to stand it somewhere on the gate)
    for (const extra of from.def.gateExtras || []) {
      const [name, x = 0, y = 0, dz = 0] = Array.isArray(extra) ? extra : [extra];
      from.put(owner, name, x, y, doorD + dz, { p0: 0.37 });
    }
  }
}
