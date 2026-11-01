import { CONFIG } from '../config.js';
import { rgb } from '../render/geo.js';

// Obstacle director: lays out fair, readable patterns of themed obstacles
// ahead of the player and answers collision queries.
//
// Kinds: L = low (jump), H = high (slide), W = wall (change lane).
// Every world draws them with the same visual grammar: L is low and solid to
// the ground, H is a frame or overhang with clear floor showing beneath it
// (nothing lower than CONFIG.duckLine), W is tall and solid.

const KIND_Y = { L: [0, 0.95], H: [1.1, 3.4], W: [0, 6] };

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

// min: difficulty (0..1) at which a pattern unlocks. Early runs only see
// single obstacles and full-width hop/duck bars; combinations arrive later.
const PATTERNS = [
  { min: 0, w: 4, make: (r) => [single(r)] },
  { min: 0.02, w: 1.4, make: () => [{ wide: 'L' }] },
  { min: 0.05, w: 1.4, make: () => [{ wide: 'H' }] },
  { min: 0.09, w: 2.6, make: (r) => [twoWalls(r)] },
  {
    min: 0.16, w: 1.6,
    make: (r) => {
      // two single obstacles in different lanes, a beat apart
      const a = r.int(0, 2);
      const b = (a + r.int(1, 2)) % 3;
      const row = (lane) => {
        const lanes = [null, null, null];
        lanes[lane] = r.weighted([['L', 1], ['H', 1], ['W', 1.4]]);
        return lanes;
      };
      return [{ lanes: row(a) }, { lanes: row(b), gap: 1.1 }];
    },
  },
  { min: 0.22, w: 1.8, make: (r) => [twoWalls(r, 'L')] },
  { min: 0.22, w: 1.8, make: (r) => [twoWalls(r, 'H')] },
  {
    min: 0.3, w: 2.2,
    make: (r) => {
      // every lane busy with something, at least one passable
      const pool = ['L', 'H', 'W', null];
      const lanes = [r.pick(pool), r.pick(pool), r.pick(pool)];
      if (lanes.every((k) => k === 'W')) lanes[r.int(0, 2)] = r.pick(['L', 'H']);
      return [{ lanes }];
    },
  },
  {
    min: 0.36, w: 1.8,
    make: (r) => {
      // zigzag: the open lane steps one lane per row
      let free = r.int(0, 2);
      const rows = [];
      const n = r.int(3, 4);
      for (let i = 0; i < n; i++) {
        const lanes = ['W', 'W', 'W'];
        lanes[free] = null;
        rows.push({ lanes, gap: 0.85 });
        free = free === 0 ? 1 : free === 2 ? 1 : r.pick([0, 2]);
      }
      return rows;
    },
  },
  { min: 0.42, w: 1.3, make: () => [{ wide: 'L' }, { wide: 'H', gap: 1 }] },
  { min: 0.42, w: 1.3, make: () => [{ wide: 'H' }, { wide: 'L', gap: 1 }] },
  {
    min: 0.5, w: 1.4,
    make: (r) => {
      // tunnel: one open lane between walls, with a hop or duck inside
      const free = r.int(0, 2);
      const rows = [];
      for (let i = 0; i < 3; i++) {
        const lanes = ['W', 'W', 'W'];
        lanes[free] = i === 1 ? r.pick(['L', 'H']) : null;
        rows.push({ lanes, gap: 0.6 });
      }
      return rows;
    },
  },
  {
    min: 0.58, w: 1.2,
    make: (r) => {
      // staggered single walls sweeping across
      const order = r.chance(0.5) ? [0, 1, 2] : [2, 1, 0];
      return order.map((lane) => {
        const lanes = [null, null, null];
        lanes[lane] = 'W';
        return { lanes, gap: 0.62 };
      });
    },
  },
];

const TUTORIAL = [
  { wide: 'L', hint: 'up' },
  { wide: 'H', hint: 'down' },
  { lanes: [null, 'W', null], hint: 'side' },
];

const needsVertical = (row) => !!row.wide || row.lanes.some((k) => k === 'L' || k === 'H');
const lerp = (a, b, t) => a + (b - a) * t;

export class ObstacleField {
  constructor(game) {
    this.game = game;
    this.records = [];
    this.groups = [];
    // every row laid, in order: { d, end, lanes: [record | null] x3, hint },
    // read by the gem director to plan its route through them
    this.rows = [];
    this.nextD = 0;
  }

  reset(rng, startD, tutorial) {
    this.clear();
    this.rng = rng;
    const o = CONFIG.obstacles;
    this.nextD = startD + (tutorial ? o.firstAtTutorial : o.firstAt);
    this.tutorial = tutorial ? TUTORIAL.slice() : [];
    this.untilBreather = rng.int(o.breatherEvery[0], o.breatherEvery[1]);
  }

  // 0 at the start of a run, easing toward 1 over several minutes.
  difficultyAt(t) {
    return 1 - Math.exp(-Math.max(0, t) / CONFIG.obstacles.ramp);
  }

  // The difficulty a stretch of road at d is laid at. A breather world
  // (def.calm, the Cypress Lane) takes only a share of it on every lap, so its
  // obstacles stay further apart and its combinations simpler than anywhere
  // else, while still tightening a little as the run goes on.
  difficultyFor(d, t) {
    const calm = this.calmAt(d);
    return this.difficultyAt(t) * (calm ? calm.diff : 1);
  }

  // The breather settings (CONFIG.obstacles.calm) if the world at d is one.
  calmAt(d) {
    return this.game.course.segAt(d).world.def.calm ? CONFIG.obstacles.calm : null;
  }

  clear() {
    for (const g of this.groups) g.world.removeOwner(g);
    this.groups.length = 0;
    this.records.length = 0;
    this.rows.length = 0;
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
    w = 0;
    for (const row of this.rows) if (row.lanes.some((r) => r && !r.group.dead)) this.rows[w++] = row;
    this.rows.length = w;
  }

  // The first row at or after d the gem director hasn't planned yet.
  rowAfter(d) {
    for (const row of this.rows) if (!row.gemmed && row.d >= d - 0.01) return row;
    return null;
  }

  update(dist, runTime) {
    let guard = 0;
    while (this.nextD < dist + CONFIG.viewAhead && guard++ < 20) this.spawnNext(dist, runTime);
    const limit = dist - 14;
    if (this.groups.length && this.groups[0].d + this.groups[0].len < limit) {
      this.removeWhere((g) => g.d + g.len < limit);
    }
    while (this.rows.length && this.rows[0].end < limit) this.rows.shift();
  }

  spawnNext(dist, runTime) {
    const game = this.game;
    const course = game.course;
    const o = CONFIG.obstacles;
    const r = this.rng;
    let d = this.nextD;
    const b = course.boundaryAfter(d - CONFIG.doorClearAfter);
    if (b && d > b.d - CONFIG.doorClearBefore) {
      this.nextD = b.d + CONFIG.doorClearAfter;
      return;
    }
    const eta = runTime + (d - dist) / Math.max(game.speed, 6);
    const v = game.speedAt(eta);
    const calm = this.calmAt(d);
    const diff = this.difficultyFor(d, eta);
    const tutorial = this.tutorial.length > 0;
    const rows = tutorial ? [this.tutorial.shift()] : this.pick(diff, calm);
    const space = calm ? calm.space : 1;
    const rowGap = lerp(o.rowGapEasy, o.rowGapHard, diff) * space;
    let last = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (b && d > b.d - CONFIG.doorClearBefore) {
        d = b.d + CONFIG.doorClearAfter;
        last = null;
        break;
      }
      const world = course.segAt(d).world;
      const len = this.placeRow(world, d, row);
      d += len;
      last = row;
      if (i < rows.length - 1) {
        const min = needsVertical(row) ? o.minAfterVertical : o.minAfterLane;
        d += Math.max(11, v * Math.max(min, rowGap * (rows[i + 1].gap ?? 1)));
      }
    }
    // rest before the next pattern: long at first, tightening with the run
    let gap = tutorial ? o.tutorialGap : lerp(o.gapEasy, o.gapHard, diff) * space * r.float(o.gapJitter[0], o.gapJitter[1]);
    if (!tutorial && --this.untilBreather <= 0) {
      gap *= o.breatherMul;
      this.untilBreather = r.int(o.breatherEvery[0], o.breatherEvery[1]);
    }
    if (last) gap = Math.max(gap, needsVertical(last) ? o.minAfterVertical : o.minAfterLane);
    this.nextD = d + Math.max(12, v * gap);
  }

  // calm (a breather world): only the gentler patterns, however far the run
  // has got (calm.most: the hardest pattern's unlock it still deals), with
  // lone obstacles dealt more often.
  pick(diff, calm) {
    const r = this.rng;
    const avail = PATTERNS.filter((p) => diff >= p.min && (!calm || p.min <= calm.most));
    const p = r.weighted(avail.map((p) => [p, p.w * (calm && p.min === 0 ? calm.lone : 1)]));
    return p.make(r);
  }

  placeRow(world, d, row) {
    const defs = world.def.obstacles;
    const r = this.rng;
    const lanes = [null, null, null];
    const laid = { d, end: d, lanes, hint: row.hint || null };
    this.rows.push(laid);
    if (row.wide) {
      const spec = row.wide === 'L' ? defs.LW : defs.HW;
      const group = this.group(world, d, spec.len, row.hint, CONFIG.score.wide);
      this.putSpec(world, group, spec, 0, d, { c: spec.tints ? rgb(r.pick(spec.tints)) : null, p0: r.float(0, 6.28) });
      if (!spec.flat) this.shadow(world, group, 0, d, spec.len, 8.6, row.wide === 'L' ? 0.9 : 2.2);
      for (let lane = 0; lane < 3; lane++) lanes[lane] = this.record(group, lane, d, spec.len, row.wide, spec);
      laid.end = d + spec.len;
      return spec.len;
    }
    let maxLen = 0;
    for (let lane = 0; lane < 3; lane++) {
      const kind = row.lanes[lane];
      if (!kind) continue;
      const x = CONFIG.laneX[lane];
      if (kind === 'W' && defs.SW && lane !== 1 && r.chance(0.4)) {
        lanes[lane] = this.placeSwing(world, defs.SW, lane, d, row.hint);
        laid.d = Math.min(laid.d, lanes[lane].d);
        laid.end = Math.max(laid.end, lanes[lane].d + lanes[lane].len);
        maxLen = Math.max(maxLen, defs.SW.len);
        continue;
      }
      const spec = r.pick(defs[kind]);
      const group = this.group(world, d, spec.len, row.hint);
      this.putSpec(world, group, spec, x, d, {
        c: spec.tints ? rgb(r.pick(spec.tints)) : null,
        ry: spec.flip && r.chance(0.5) ? Math.PI : 0,
        p0: r.float(0, 6.28),
      });
      if (!spec.flat) this.shadow(world, group, x, d, spec.len, 2.4, kind === 'L' ? 0.9 : kind === 'H' ? 2.2 : 3);
      lanes[lane] = this.record(group, lane, d, spec.len, kind, spec);
      laid.end = Math.max(laid.end, d + spec.len);
      maxLen = Math.max(maxLen, spec.len);
    }
    return maxLen;
  }

  // Total points of the groups that have fallen behind the player since the
  // last call, counting only those passed without a hit.
  collectCleared(dist) {
    let pts = 0;
    for (const g of this.groups) {
      if (g.scored || g.d + g.len > dist) continue;
      g.scored = true;
      if (!g.hit) pts += g.points;
    }
    return pts;
  }

  // An obstacle's prop plus any companion batches drawn with another
  // material (spec.with), e.g. a creek's water beside its stones.
  // spec.extras(put, rng, info) can add purely visual companions owned by the
  // obstacle (the Hall of Doors' books fluttering off a shelf): put(name, x, y,
  // d, o) places one; info carries the lane x, the distance and the world's
  // visit (how many times it has come round before).
  putSpec(world, group, spec, x, d, o) {
    group.spec = spec;
    world.put(group, spec.name, x, 0, d, o);
    if (spec.with) for (const name of spec.with) world.put(group, name, x, 0, d, o);
    if (spec.extras) {
      const seg = this.game.course.segAt(d);
      spec.extras((name, px, py, pd, po) => world.put(group, name, px, py, pd, po), this.rng, { x, d, visit: seg.world === world ? seg.visit || 0 : 0 });
    }
  }

  placeSwing(world, spec, lane, d, hint) {
    const s = lane === 0 ? -1 : 1;
    const group = this.group(world, d - spec.len / 2, spec.len, hint);
    const tint = spec.tints ? rgb(this.rng.pick(spec.tints)) : null;
    const o = { ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, p1: -1, c: tint, p0: 0 };
    world.put(group, spec.name, s * spec.wallX, 0, d, o);
    world.put(group, spec.frame, s * spec.wallX, 0, d, o);
    return this.record(group, lane, d - spec.len / 2, spec.len, 'W');
  }

  // points: what getting past it cleanly is worth (see CONFIG.score); hit is
  // set by the game when the player touches any part of it.
  group(world, d, len, hint, points = 1) {
    const g = { world, d, len, hint: hint || null, hinted: false, dead: false, points, hit: false, scored: false };
    this.groups.push(g);
    return g;
  }

  // Contact shadow, thrown along the world's light (env.cast: meters of
  // shadow per meter of height, [sideways, toward the camera]).
  shadow(world, group, x, d, len, width, h) {
    if (!world.has('shadow')) return;
    const cast = world.env.cast || [0, 0];
    const cx = cast[0] * h;
    const cz = cast[1] * h;
    world.put(group, 'shadow', x + cx * 0.5, 0.035, d + len / 2 - cz * 0.5, { sx: width + Math.abs(cx), sz: len + 1.4 + Math.abs(cz), c: [0.9, 1, 1] });
  }

  // spec.top overrides the kind's collision top; spec.wade marks something
  // you can't stand on (water): landing in it trips you like running into it.
  record(group, lane, d, len, kind, spec) {
    const y = KIND_Y[kind];
    const rec = {
      group,
      lane,
      x: CONFIG.laneX[lane],
      hw: CONFIG.obstacleHalfWidth,
      d,
      len,
      y0: y[0],
      y1: spec?.top ?? y[1],
      kind,
      wade: !!spec?.wade,
      hit: false,
    };
    this.records.push(rec);
    return rec;
  }

  // Highest LOW-obstacle top the player could be standing on.
  groundAt(x, dist) {
    let h = 0;
    const pw = CONFIG.player.halfWidth;
    for (const o of this.records) {
      if (o.kind !== 'L' || o.hit || o.wade) continue;
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
