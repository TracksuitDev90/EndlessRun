import { CONFIG } from '../config.js';
import { rgb } from '../render/geo.js';

// Obstacle director: lays out fair, readable patterns of themed obstacles
// ahead of the player and answers collision queries.
//
// Kinds: L = low (jump), H = high (slide), W = wall (change lane).

const KIND_Y = { L: [0, 0.95], H: [1.2, 3.4], W: [0, 6] };

const single = (r) => {
  const lanes = [null, null, null];
  lanes[r.int(0, 2)] = r.weighted([['L', 1], ['H', 1], ['W', 1.3]]);
  return { lanes };
};
const twoWalls = (r, freeKind = null) => {
  const free = r.int(0, 2);
  const lanes = ['W', 'W', 'W'];
  lanes[free] = freeKind;
  return { lanes };
};

const PATTERNS = [
  { min: 0, w: 4, make: (r) => [single(r)] },
  { min: 0, w: 3, make: (r) => [twoWalls(r)] },
  { min: 0.04, w: 1.6, make: () => [{ wide: 'L' }] },
  { min: 0.04, w: 1.6, make: () => [{ wide: 'H' }] },
  { min: 0.12, w: 2, make: (r) => [twoWalls(r, 'L')] },
  { min: 0.12, w: 2, make: (r) => [twoWalls(r, 'H')] },
  {
    min: 0.18, w: 2.4,
    make: (r) => {
      // every lane busy with something, at least one passable
      const pool = ['L', 'H', 'W', null];
      const lanes = [r.pick(pool), r.pick(pool), r.pick(pool)];
      if (lanes.every((k) => k === 'W')) lanes[r.int(0, 2)] = r.pick(['L', 'H']);
      return [{ lanes }];
    },
  },
  {
    min: 0.25, w: 2,
    make: (r) => {
      // zigzag: the open lane steps one lane per row
      let free = r.int(0, 2);
      const rows = [];
      const n = r.int(3, 4);
      for (let i = 0; i < n; i++) {
        const lanes = ['W', 'W', 'W'];
        lanes[free] = null;
        rows.push({ lanes, gap: 0.8 });
        free = free === 0 ? 1 : free === 2 ? 1 : r.pick([0, 2]);
      }
      return rows;
    },
  },
  { min: 0.3, w: 1.4, make: () => [{ wide: 'L' }, { wide: 'H', gap: 0.9 }] },
  { min: 0.3, w: 1.4, make: () => [{ wide: 'H' }, { wide: 'L', gap: 0.9 }] },
  {
    min: 0.35, w: 1.5,
    make: (r) => {
      // tunnel: one open lane between walls, with a hop or duck inside
      const free = r.int(0, 2);
      const rows = [];
      for (let i = 0; i < 3; i++) {
        const lanes = ['W', 'W', 'W'];
        lanes[free] = i === 1 ? r.pick(['L', 'H']) : null;
        rows.push({ lanes, gap: 0.55 });
      }
      return rows;
    },
  },
  {
    min: 0.45, w: 1.3,
    make: (r) => {
      // staggered single walls sweeping across
      const order = r.chance(0.5) ? [0, 1, 2] : [2, 1, 0];
      return order.map((lane) => {
        const lanes = [null, null, null];
        lanes[lane] = 'W';
        return { lanes, gap: 0.55 };
      });
    },
  },
];

const TUTORIAL = [
  { wide: 'L', hint: 'up', gap: 1.8 },
  { wide: 'H', hint: 'down', gap: 1.8 },
  { lanes: [null, 'W', null], hint: 'side', gap: 1.6 },
];

export class ObstacleField {
  constructor(game) {
    this.game = game;
    this.records = [];
    this.groups = [];
    this.nextD = 0;
  }

  reset(rng, startD, tutorial) {
    this.clear();
    this.rng = rng;
    this.nextD = startD + (tutorial ? 80 : 110);
    this.tutorial = tutorial ? TUTORIAL.slice() : [];
  }

  clear() {
    for (const g of this.groups) g.world.removeOwner(g);
    this.groups.length = 0;
    this.records.length = 0;
  }

  dropWorld(world) {
    this.removeWhere((g) => g.world === world);
  }

  clearRange(d0, d1) {
    this.removeWhere((g) => g.d < d1 && g.d + g.len > d0);
  }

  removeWhere(pred) {
    let w = 0;
    for (const g of this.groups) {
      if (pred(g)) {
        g.world.removeOwner(g);
        g.dead = true;
      } else this.groups[w++] = g;
    }
    this.groups.length = w;
    w = 0;
    for (const r of this.records) if (!r.group.dead) this.records[w++] = r;
    this.records.length = w;
  }

  update(dist, runTime) {
    let guard = 0;
    while (this.nextD < dist + CONFIG.viewAhead && guard++ < 20) this.spawnNext(dist, runTime);
    const limit = dist - 14;
    if (this.groups.length && this.groups[0].d + this.groups[0].len < limit) {
      this.removeWhere((g) => g.d + g.len < limit);
    }
  }

  spawnNext(dist, runTime) {
    const game = this.game;
    const course = game.course;
    let d = this.nextD;
    const b = course.boundaryAfter(d - CONFIG.doorClearAfter);
    if (b && d > b.d - CONFIG.doorClearBefore) {
      this.nextD = b.d + CONFIG.doorClearAfter;
      return;
    }
    const eta = runTime + (d - dist) / Math.max(game.speed, 6);
    const v = game.speedAt(eta);
    const diff = Math.min(1, Math.max(0, (v - CONFIG.speed.start) / (CONFIG.speed.max - CONFIG.speed.start)));
    const rows = this.tutorial.length ? [this.tutorial.shift()] : this.pick(diff);
    const gapT = 1.3 + (0.72 - 1.3) * diff;
    for (const row of rows) {
      if (b && d > b.d - CONFIG.doorClearBefore) {
        d = b.d + CONFIG.doorClearAfter;
        break;
      }
      const world = course.segAt(d).world;
      const len = this.placeRow(world, d, row);
      d += len + Math.max(11, v * gapT * (row.gap ?? 1));
    }
    this.nextD = d;
  }

  pick(diff) {
    const r = this.rng;
    const avail = PATTERNS.filter((p) => diff >= p.min);
    const p = r.weighted(avail.map((p) => [p, p.w]));
    return p.make(r);
  }

  placeRow(world, d, row) {
    const defs = world.def.obstacles;
    const r = this.rng;
    if (row.wide) {
      const spec = row.wide === 'L' ? defs.LW : defs.HW;
      const group = this.group(world, d, spec.len, row.hint);
      world.put(group, spec.name, 0, 0, d, { c: spec.tints ? rgb(r.pick(spec.tints)) : null, p0: r.float(0, 6.28) });
      this.shadow(world, group, 0, d, spec.len, 8.6);
      for (let lane = 0; lane < 3; lane++) this.record(group, lane, d, spec.len, row.wide);
      return spec.len;
    }
    let maxLen = 0;
    for (let lane = 0; lane < 3; lane++) {
      const kind = row.lanes[lane];
      if (!kind) continue;
      const x = CONFIG.laneX[lane];
      if (kind === 'W' && defs.SW && lane !== 1 && r.chance(0.4)) {
        this.placeSwing(world, defs.SW, lane, d, row.hint);
        maxLen = Math.max(maxLen, defs.SW.len);
        continue;
      }
      const spec = r.pick(defs[kind]);
      const group = this.group(world, d, spec.len, row.hint);
      world.put(group, spec.name, x, 0, d, {
        c: spec.tints ? rgb(r.pick(spec.tints)) : null,
        ry: spec.flip && r.chance(0.5) ? Math.PI : 0,
        p0: r.float(0, 6.28),
      });
      this.shadow(world, group, x, d, spec.len, 2.4);
      this.record(group, lane, d, spec.len, kind);
      maxLen = Math.max(maxLen, spec.len);
    }
    return maxLen;
  }

  placeSwing(world, spec, lane, d, hint) {
    const s = lane === 0 ? -1 : 1;
    const group = this.group(world, d - spec.len / 2, spec.len, hint);
    const tint = spec.tints ? rgb(this.rng.pick(spec.tints)) : null;
    const o = { ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, p1: -1, c: tint, p0: 0 };
    world.put(group, spec.name, s * spec.wallX, 0, d, o);
    world.put(group, spec.frame, s * spec.wallX, 0, d, o);
    this.record(group, lane, d - spec.len / 2, spec.len, 'W');
  }

  group(world, d, len, hint) {
    const g = { world, d, len, hint: hint || null, hinted: false, dead: false };
    this.groups.push(g);
    return g;
  }

  shadow(world, group, x, d, len, width) {
    if (world.has('shadow')) world.put(group, 'shadow', x, 0.035, d + len / 2, { sx: width, sz: len + 1.4, c: [0.9, 1, 1] });
  }

  record(group, lane, d, len, kind) {
    const y = KIND_Y[kind];
    this.records.push({
      group,
      lane,
      x: CONFIG.laneX[lane],
      hw: CONFIG.obstacleHalfWidth,
      d,
      len,
      y0: y[0],
      y1: y[1],
      kind,
      hit: false,
    });
  }

  // Highest LOW-obstacle top the player could be standing on.
  groundAt(x, dist) {
    let h = 0;
    const pw = CONFIG.player.halfWidth;
    for (const o of this.records) {
      if (o.kind !== 'L' || o.hit) continue;
      if (dist < o.d - 0.25 || dist > o.d + o.len + 0.25) continue;
      if (Math.abs(x - o.x) > o.hw + pw - 0.15) continue;
      if (o.y1 > h) h = o.y1;
    }
    return h;
  }

  nextHint(dist, range) {
    for (const g of this.groups) {
      if (g.hint && !g.hinted && g.d > dist && g.d - dist < range) return g;
    }
    return null;
  }
}
