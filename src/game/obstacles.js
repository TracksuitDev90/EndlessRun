import { CONFIG } from '../config.js';
import { rgb } from '../render/geo.js';
import { planRiver, planRiverSteps } from '../world/river.js';

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

// (a climb's pieces span the whole road: every lane, and between them)
const CLIMB_HW = 3.7;

const smoothK = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
    // rows a gust is carrying off the road (Windbreak, see blow)
    this.blowing = [];
  }

  reset(rng, startD, tutorial) {
    this.clear();
    this.rng = rng;
    const o = CONFIG.obstacles;
    this.nextD = startD + (tutorial ? o.firstAtTutorial : o.firstAt);
    this.tutorial = tutorial ? TUTORIAL.slice() : [];
    this.wideTurn = undefined;
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

  // The breather settings (CONFIG.obstacles.calm, or the world's own laid
  // over them: def.calm as an object) if the world at d is one.
  calmAt(d) {
    const def = this.game.course.segAt(d).world.def;
    if (!def.calm) return null;
    if (def.calm === true) return CONFIG.obstacles.calm;
    return def.calmSet || (def.calmSet = { ...CONFIG.obstacles.calm, ...def.calm });
  }

  clear() {
    for (const g of this.groups) {
      g.world.removeOwner(g);
      if (g.crossing) g.crossing.laid = false;
    }
    for (const b of this.blowing) b.g.world.removeOwner(b.g);
    this.blowing.length = 0;
    this.groups.length = 0;
    this.records.length = 0;
    this.rows.length = 0;
  }

  dropWorld(world) {
    this.removeWhere((g) => g.world === world);
    this.blowing = this.blowing.filter((b) => {
      if (b.g.world !== world) return true;
      world.removeOwner(b.g);
      return false;
    });
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
        // (a river's crossing taken off the road is laid again if it's
        // come back to before it's passed)
        if (g.crossing) g.crossing.laid = false;
      } else this.groups[w++] = g;
    }
    this.groups.length = w;
    w = 0;
    for (const r of this.records) if (!r.group.dead) this.records[w++] = r;
    this.records.length = w;
    w = 0;
    for (const row of this.rows) if (row.high ? !row.high.a.group.dead : row.lanes.some((r) => r && !r.group.dead)) this.rows[w++] = row;
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
    if (this.blowing.length) this.blowStep();
  }

  // --- Windbreak ---------------------------------------------------------------
  // (powers.js) The first row of obstacles between d0 and d1 that has
  // anything in it, or null.
  rowBetween(d0, d1) {
    for (const row of this.rows) {
      if (row.d < d0 || row.d > d1) continue;
      // (a gust doesn't carry off the road itself, or a river)
      if (row.climb || row.high || row.river) continue;
      if (row.lanes.some((r) => r && !r.group.dead && !r.group.blown)) return row;
    }
    return null;
  }

  // A gust takes a row off the road. From this moment nothing of it can be
  // hit, stood on or stepped round (its records are gone), and it earns no
  // clear bonus; what you see of it is carried off to the side of the road
  // over `dur` seconds - away from the runner, off the near edge - lifting a
  // little, and tumbling if it's a thing; anything alive (spec.call: the
  // whales) just swims aside, unhurried, level and whole. Then it's let go.
  // side: which way (-1 / +1) a full-width one goes.
  blow(row, time, side, dur) {
    const groups = new Set();
    for (const r of row.lanes) if (r && !r.group.dead && !r.group.blown) groups.add(r.group);
    if (!groups.size) return 0;
    for (const g of groups) {
      g.blown = true;
      g.scored = true;
      const items = [];
      for (const b of g.world.batches.values()) for (const it of b.items) if (it.owner === g) items.push({ it, b, x: it.x, y: it.y, ry: it.ry });
      const rec = row.lanes.find((r) => r && r.group === g);
      const wide = row.lanes.every((r) => r && r.group === g);
      const dir = wide || rec.lane === 1 ? side : rec.lane === 0 ? -1 : 1;
      const alive = !!g.spec?.call;
      this.blowing.push({ g, items, t0: time, dur: dur * (alive ? 1.5 : 1), dir, alive, spin: (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.8) });
    }
    let w = 0;
    for (const r of this.records) if (!r.group.blown) this.records[w++] = r;
    this.records.length = w;
    for (let i = 0; i < 3; i++) if (row.lanes[i]?.group.blown) row.lanes[i] = null;
    this.groups = this.groups.filter((g) => !g.blown);
    return groups.size;
  }

  // --- Living Bulldozer ----------------------------------------------------------
  // (powers.js) The crab's claw takes a row off the road. As a gust does
  // (blow): from this moment nothing of it can be hit, and it earns no clear
  // bonus. What you see of it is smashed: each thing in it flung outward,
  // away from the middle of the road (dir: which way the claw swings, for
  // what's in the middle), up in an arc and tumbling as it goes, a bar
  // overhead swept up and aside, and all of it crumbling away to nothing
  // over `dur` seconds; anything alive just swims aside. Returns where it
  // was struck: [{ x, kind }] for each piece of it, for the wreckage flying.
  smash(row, time, dur, dir) {
    const groups = new Set();
    const hit = [];
    for (const r of row.lanes) {
      if (!r || r.group.dead || r.group.blown) continue;
      groups.add(r.group);
      hit.push({ x: r.x, kind: r.kind });
    }
    for (const g of groups) {
      g.blown = true;
      g.scored = true;
      const alive = !!g.spec?.call;
      const items = [];
      for (const b of g.world.batches.values()) {
        for (const it of b.items) {
          if (it.owner !== g) continue;
          // (each piece outward from the middle of the road, whatever group
          // it's in; the middle one the way the claw swings)
          const out = Math.abs(it.x) < 0.6 ? dir : Math.sign(it.x);
          // (thrown clear of the road - it's 7 m across - in a high arc,
          // spinning as it goes)
          items.push({ it, b, x: it.x, y: it.y, ry: it.ry, sx: it.sx, sy: it.sy, sz: it.sz, out, far: 7 + Math.random() * 4 + Math.max(0, 2.4 - Math.abs(it.x)), up: 2.2 + Math.random() * 1.8, spin: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 5) });
        }
      }
      const rec = row.lanes.find((r) => r && r.group === g);
      this.blowing.push({ g, items, t0: time, dur: alive ? 1.6 : dur, dir: rec.lane === 0 ? -1 : rec.lane === 2 ? 1 : dir, alive, smash: !alive, high: rec.kind === 'H', spin: 0 });
    }
    let w = 0;
    for (const r of this.records) if (!r.group.blown) this.records[w++] = r;
    this.records.length = w;
    for (let i = 0; i < 3; i++) if (row.lanes[i]?.group.blown) row.lanes[i] = null;
    this.groups = this.groups.filter((g) => !g.blown);
    return hit;
  }

  blowStep() {
    const time = this.game.time;
    let w = 0;
    for (const B of this.blowing) {
      const k = Math.min(1, (time - B.t0) / B.dur);
      if (B.smash) {
        // smashed: knocked clean off the road - out in a high arc, spinning
        // as it goes, coming down at the roadside - a bar swept up and
        // aside; and only once it's there, crumbling away
        const e = 1 - Math.pow(1 - Math.min(1, k / 0.75), 2);
        const gone = 1 - smoothK(0.72, 1, k);
        // (a jolt of it as the claw lands: knocked over a little before it flies)
        const jolt = Math.sin(Math.min(1, k / 0.12) * Math.PI) * (1 - Math.min(1, k / 0.12));
        for (const I of B.items) {
          const it = I.it;
          if (it.owner !== B.g) continue;
          it.x = I.x + I.out * (e * I.far * (B.high ? 1.25 : 1) + 0.3 * jolt);
          it.y = I.y + (B.high ? 2.6 * e : I.up * 4 * e * (1 - e) + 0.15 * jolt);
          it.ry = I.ry + I.spin * e;
          // (squashed by the blow, then whole as it flies, then crumbling)
          const hitK = 1 - 0.25 * Math.sin(Math.min(1, k / 0.1) * Math.PI);
          it.sx = I.sx * gone * (2 - hitK);
          it.sy = I.sy * gone * hitK;
          it.sz = I.sz * gone;
          I.b.dirty = true;
        }
        if (k >= 1) {
          B.g.world.removeOwner(B.g);
          B.g.dead = true;
        } else this.blowing[w++] = B;
        continue;
      }
      // (the gust shoves hard and lets go; a whale eases away)
      const e = B.alive ? k * k * (3 - 2 * k) : 1 - Math.pow(1 - k, 2.4);
      for (const I of B.items) {
        const it = I.it;
        if (it.owner !== B.g) continue;
        it.x = I.x + B.dir * e * (B.alive ? 9 : 10.5);
        it.y = I.y + (B.alive ? 1.6 * e : 2.2 * Math.sin(Math.min(1, e * 1.25) * Math.PI * 0.85));
        if (!B.alive) it.ry = I.ry + B.spin * e * 2.4;
        I.b.dirty = true;
      }
      if (k >= 1) {
        B.g.world.removeOwner(B.g);
        B.g.dead = true;
      } else this.blowing[w++] = B;
    }
    this.blowing.length = w;
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
    // a world can ask for more open road after its doorway than usual
    // (def.clearAfter, in seconds of running at the pace you'll be at: the
    // Red Drift's, for the jump to light speed; the Kelp Deep's, for the
    // splash)
    const here = course.segAt(d);
    const after = here.world.def.clearAfter ? Math.max(CONFIG.doorClearAfter, v * here.world.def.clearAfter) : 0;
    if (after && here.ordinal > 1 && d < here.start + after) {
      this.nextD = here.start + after;
      return;
    }
    // and keep a stretch of its road clear (def.holdAt(seg, d): where the
    // stretch ends, if d is in it - the Blue Hour's, as you come out of the
    // long grass onto the causeway)
    const hold = here.world.def.holdAt?.(here, d) || 0;
    if (hold > d) {
      this.nextD = hold;
      return;
    }
    // A river (Candy World's): where it runs across the road it's laid as a
    // row of its own - the chocolate's span in each lane, a jump - and every
    // pattern before it is kept far enough short of it to land and take off
    // again. (limit: where the last row before it must end.)
    const X = this.nextCrossing();
    let limit = Infinity;
    if (X) {
      // (in a world of bouncy things, room for the longer flight off one)
      const room = Math.max(11, v * (X.world.def.bouncy ? CONFIG.bounce.after : o.minAfterVertical));
      if (X.d0 < d + room + 3.5) {
        this.placeCrossing(X);
        this.nextD = Math.max(d, X.d1 + Math.max(12, v * lerp(o.gapEasy, o.gapHard, this.difficultyFor(X.d0, eta)) * 0.8, v * o.minAfterVertical));
        return;
      }
      limit = X.d0 - room;
    }
    const calm = this.calmAt(d);
    const diff = this.difficultyFor(d, eta);
    const tutorial = this.tutorial.length > 0;
    // (a world with def.climb, from its second time round: now and then a
    // stretch of decks to run up onto and jump between, in place of a
    // pattern - see placeClimb)
    // (and a world with def.high: now and then a high route, one lane of the
    // road raised into a walkway over the rest - see placeHigh)
    if (!tutorial && this.highAt(here, d, v, b)) {
      const len = this.placeHigh(here.world, d, v, diff);
      const rest = lerp(o.gapEasy, o.gapHard, diff) * r.float(o.gapJitter[0], o.gapJitter[1]);
      this.nextD = d + len + Math.max(14, v * Math.max(rest, o.minAfterVertical * 1.4));
      return;
    }
    const climb = tutorial ? null : this.climbAt(here, d, v, b);
    if (climb) {
      const len = this.placeClimb(here.world, d, climb, v);
      const rest = lerp(o.gapEasy, o.gapHard, diff) * r.float(o.gapJitter[0], o.gapJitter[1]);
      this.nextD = d + len + Math.max(14, v * Math.max(rest, o.minAfterVertical * 1.4));
      return;
    }
    const rows = tutorial ? [this.tutorial.shift()] : this.pick(diff, calm);
    // (low gravity: a jump hangs longer, so the rows come further apart,
    // and never as close after one you jump or duck - see CONFIG.drift.pace)
    const low = here.world.def.lowGravity ? CONFIG.drift.pace : null;
    const space = (calm ? calm.space : 1) * (low ? low.space : 1);
    const airMul = low ? low.air : 1;
    const rowGap = lerp(o.rowGapEasy, o.rowGapHard, diff) * space;
    let last = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (b && d > b.d - CONFIG.doorClearBefore) {
        d = b.d + CONFIG.doorClearAfter;
        last = null;
        break;
      }
      // (no room before a river's crossing: the rest of the pattern waits)
      if (d + 3.5 > limit) break;
      const seg = course.segAt(d);
      const world = seg.world;
      if ((world.def.holdAt?.(seg, d) || 0) > d) break;
      const len = this.placeRow(world, d, row);
      d += len;
      last = row;
      // (something bouncy in it: room for the longer flight off it)
      const bounced = this.rows[this.rows.length - 1].bounce;
      if (bounced) last = { ...row, bounced };
      if (i < rows.length - 1) {
        const min = bounced ? CONFIG.bounce.after : needsVertical(row) ? o.minAfterVertical * airMul : o.minAfterLane;
        d += Math.max(11, v * Math.max(min, rowGap * (rows[i + 1].gap ?? 1)));
      }
    }
    // rest before the next pattern: long at first, tightening with the run
    // (and after the last lesson, a longer breath before the road proper)
    let gap = tutorial ? o.tutorialGap * (this.tutorial.length ? 1 : 1.5) : lerp(o.gapEasy, o.gapHard, diff) * space * r.float(o.gapJitter[0], o.gapJitter[1]);
    if (!tutorial && --this.untilBreather <= 0) {
      gap *= o.breatherMul;
      this.untilBreather = r.int(o.breatherEvery[0], o.breatherEvery[1]);
    }
    if (last) gap = Math.max(gap, last.bounced ? CONFIG.bounce.after : needsVertical(last) ? o.minAfterVertical * airMul : o.minAfterLane);
    this.nextD = d + Math.max(12, v * gap);
    // (and never past a river's crossing without laying it)
    if (X) this.nextD = Math.min(this.nextD, Math.max(d, X.d0));
  }

  // --- rivers --------------------------------------------------------------------
  // A world with a river (def.river) has it planned once each time through
  // (see world/river.js), and kept with its stretch of the course: planned
  // a try at a time between frames as soon as the stretch is laid down
  // (planAhead), long before anything needs it - or, if something does
  // first, there and then.
  riverKey(seg) {
    return `river:${this.game.seed ?? 1}:${seg.start}:${seg.visit || 0}`;
  }

  riverOf(seg) {
    if (seg.river) return seg.river;
    const prep = this.game.prep;
    if (prep?.pending(this.riverKey(seg))) prep.finish(this.riverKey(seg));
    return seg.river || (seg.river = planRiver(seg, this.game.seed ?? 1));
  }

  planAhead() {
    const prep = this.game.prep;
    if (!prep) return;
    for (const seg of this.game.course.segments) {
      if (seg.river || seg.riverAsked || !seg.world.def?.river) continue;
      seg.riverAsked = true;
      prep.add(this.riverKey(seg), () => planRiverSteps(seg, this.game.seed ?? 1, (p) => (seg.river ||= p)));
    }
  }

  // The next crossing of a river not yet laid that the runner hasn't passed
  // (in a stretch of the course near enough to matter).
  nextCrossing() {
    const dist = this.game.dist;
    this.planAhead();
    for (const seg of this.game.course.segments) {
      if (!seg.world.def?.river || seg.end < dist || seg.start > dist + CONFIG.viewAhead + 60) continue;
      for (const X of this.riverOf(seg).crossings) {
        if (!X.laid && X.d1 > dist + 2) {
          X.world = seg.world;
          return X;
        }
      }
    }
    return null;
  }

  // A crossing: a row of its own, the chocolate's span in each lane a hurdle
  // you can't land in (wade). Nothing of it is drawn here - the river is the
  // scenery's (see the world's chunk).
  placeCrossing(X) {
    const world = X.world;
    const group = this.group(world, X.d0, X.d1 - X.d0, null, CONFIG.score.wide);
    group.crossing = X;
    group.spec = world.def.river;
    X.laid = true;
    const lanes = [null, null, null];
    for (let lane = 0; lane < 3; lane++) {
      const L = X.lanes[lane];
      const rec = { group, lane, x: CONFIG.laneX[lane], hw: CONFIG.obstacleHalfWidth, d: L.d0, len: L.d1 - L.d0, y0: 0, y1: X.top, kind: 'L', wade: true, hit: false };
      this.records.push(rec);
      lanes[lane] = rec;
    }
    this.rows.push({ d: X.d0, end: X.d1, lanes, hint: null, river: true });
  }

  // --- climbs -------------------------------------------------------------------
  // A world can lay, now and then from its second time round (def.climb), a
  // stretch of road you get up off: a ramp (steps, a stair) running up onto
  // a deck, decks you jump up onto or across gaps between, and off the end
  // of the last one back down onto the road. Each piece is the whole width
  // of the road. def.climb: { from: the first visit (0 the first time
  // through) it comes on, every: [min, max] patterns between two, most(visit):
  // how many a visit, plan(visit, rng, n): the pieces of the n-th - each {
  // kind: 'ramp' | 'deck' | 'gap', h: the height it ends at (m), t: how long
  // it is in seconds of running, min: in metres at least } - and put(put,
  // piece, info): what's drawn for one, info { d, len, h, h0 (the height
  // before it), next (a gap's far deck), visit, rng, i, n } }.
  //
  // Running up a ramp is just running. A deck's front is a ledge: jump up
  // onto it (or come down on it); run into its face and you stumble and
  // scramble up onto it. A gap is a drop: come down into it and you stumble,
  // and scramble up onto the deck beyond (see Game.scramble) - one hit,
  // never two at once, and never left running through the inside of a deck.
  climbAt(seg, d, v, b) {
    const C = seg.world.def.climb;
    const visit = seg.visit || 0;
    if (!C || visit < C.from || seg.world.def.lowGravity) return null;
    // (not straight through the doorway in, and never into the doorway out)
    if (d < seg.start + Math.max(CONFIG.doorClearAfter, v * 3)) return null;
    const r = this.rng;
    if (seg.climbWait === undefined) {
      seg.climbN = 0;
      seg.climbWait = r.int(0, 1);
    }
    if (seg.climbN >= C.most(visit)) return null;
    if (seg.climbWait-- > 0) return null;
    const pieces = C.plan(visit, r, seg.climbN);
    let total = 0;
    for (const P of pieces) total += this.climbLen(P, v);
    if (b && d + total > b.d - CONFIG.doorClearBefore) return null;
    seg.climbN++;
    seg.climbWait = r.int(C.every[0], C.every[1]);
    return pieces;
  }

  climbLen(P, v) {
    return Math.max(P.min ?? 3, v * P.t);
  }

  placeClimb(world, d, pieces, v) {
    const def = world.def.climb;
    const seg = this.game.course.segAt(d);
    const visit = seg.world === world ? seg.visit || 0 : 0;
    const group = this.group(world, d, 0, null, pieces.filter((P) => P.kind !== 'ramp').length);
    group.climb = true;
    const laid = { d, end: d, lanes: [null, null, null], hint: null, climb: [] };
    this.rows.push(laid);
    let h = 0;
    let at = d;
    for (let i = 0; i < pieces.length; i++) {
      const P = pieces[i];
      const len = this.climbLen(P, v);
      let next = 0;
      for (let k = i + 1; k < pieces.length; k++) {
        if (pieces[k].kind !== 'gap') {
          next = pieces[k].h;
          break;
        }
      }
      const gap = P.kind === 'gap';
      const top = gap ? h : P.h;
      const rec = {
        group, lane: 1, x: 0, hw: CLIMB_HW, d: at, len,
        // (a gap: a drop you're in once you're down near the road in it)
        y0: gap ? -1 : 0, y1: gap ? 0.3 : top,
        kind: 'L', wade: false, hit: false,
        climb: P.kind, h0: h, next, pit: gap, ramp: P.kind === 'ramp',
      };
      this.records.push(rec);
      laid.climb.push(rec);
      if (!laid.lanes[1] && !gap) laid.lanes[0] = laid.lanes[1] = laid.lanes[2] = rec;
      def.put((name, px, py, pd, po) => world.put(group, name, px, py, pd, po), P, { d: at, len, h: top, h0: h, next, visit, rng: this.rng, i, n: pieces.length });
      if (!gap) h = P.h;
      at += len;
    }
    group.len = at - d;
    laid.end = at;
    return at - d;
  }

  // --- high routes ------------------------------------------------------------
  // A world can raise, now and then (def.high), one of the outer lanes into
  // a walkway over the rest of the road - two routes at once, and you choose:
  //
  //   up      a stair in lane P from the road up to the walk (H m up)
  //   deck A  the walk along lane P, a hurdle or a bar or two along its top
  //   bridge  a span right across the road at the same height, ground
  //           runners passing under it (its underside clear of the highest
  //           jump's head), where the walk crosses over to lane Q
  //   deck B  the walk along lane Q, perhaps another hurdle or bar
  //   down    a stair in lane Q back down to the road
  //
  // Up top you run on (stay in P across the bridge and you drop off its far
  // edge back to the road). Below, the structure walls off lane P beside
  // deck A and lane Q beside deck B, so the low route crosses the other way
  // under the bridge; and sand pours off the walk through chutes over the
  // middle lane - a curtain that knocks you stumbling (soft: never a crash)
  // - with the odd hurdle or bar in the open outer lane between them. Run
  // into the side of the walk or the front of deck B and you scramble up
  // onto it, one hit, as on a climb. The walk is lane-wide (its own lane
  // only), so stepping sideways off it drops you to the road the moment
  // you're clear of it.
  //
  // def.high: { from: the first visit it comes on, every: [min, max]
  // patterns between two, most(visit), H: the walk's height, put(put,
  // piece, info): what's drawn for each piece - { kind: 'up' | 'deck' |
  // 'bridge' | 'down' | 'chute', lane, d, len, h } - and curtain: what a
  // chute pours (a spec, drawn by put as 'chute') }. Lengths are in seconds
  // of running, so the timing holds as the pace climbs.
  highAt(seg, d, v, b) {
    const C = seg.world.def.high;
    const visit = seg.visit || 0;
    if (!C || visit < C.from || seg.world.def.lowGravity) return false;
    if (d < seg.start + Math.max(CONFIG.doorClearAfter, v * 3)) return false;
    const r = this.rng;
    if (seg.highWait === undefined) {
      seg.highN = 0;
      seg.highWait = r.int(1, 2);
    }
    if (seg.highN >= C.most(visit)) return false;
    if (seg.highWait-- > 0) return false;
    const L = this.highLens(v);
    if (b && d + L.total > b.d - CONFIG.doorClearBefore) return false;
    seg.highN++;
    seg.highWait = r.int(C.every[0], C.every[1]);
    return true;
  }

  highLens(v) {
    const L = { up: Math.max(15, v * 1.15), a: Math.max(32, v * 2.7), bridge: Math.max(16, v * 1.15), b: Math.max(22, v * 1.7), down: Math.max(13, v * 0.95) };
    L.total = L.up + L.a + L.bridge + L.b + L.down;
    return L;
  }

  placeHigh(world, d, v, diff) {
    const def = world.def.high;
    const defs = world.def.obstacles;
    const r = this.rng;
    const H = def.H;
    const X = CONFIG.laneX;
    const L = this.highLens(v);
    const P = r.chance(0.5) ? 0 : 2;
    const Q = 2 - P;
    const a0 = d + L.up, b0 = a0 + L.a, c0 = b0 + L.bridge, e0 = c0 + L.b, end = e0 + L.down;
    const hw = CONFIG.obstacleHalfWidth;
    const seg = this.game.course.segAt(d);
    const visit = seg.world === world ? seg.visit || 0 : 0;
    const group = this.group(world, d, end - d, null, 2);
    group.climb = true;
    const laid = { d, end, lanes: [null, null, null], hint: null, high: { P, Q, H, top: [], under: [] } };
    this.rows.push(laid);
    const drawn = (P0, o) => def.put((name, px, py, pd, po) => world.put(group, name, px, py, pd, po), P0, { ...o, visit, rng: r, H });
    const piece = (o) => {
      const rec = { group, hit: false, wade: false, kind: 'L', high: true, h0: 0, next: 0, ...o };
      this.records.push(rec);
      return rec;
    };
    const S = laid.high;
    S.up = piece({ lane: P, x: X[P], hw, d, len: L.up, y0: 0, y1: H, climb: 'ramp', ramp: true });
    S.a = piece({ lane: P, x: X[P], hw, d: a0, len: L.a, y0: 0, y1: H, climb: 'deck' });
    // (the bridge: only its slab, so the road under it stays open)
    S.bridge = piece({ lane: 1, x: 0, hw: CLIMB_HW, d: b0, len: L.bridge, y0: H - 0.42, y1: H, climb: 'deck', over: true });
    S.b = piece({ lane: Q, x: X[Q], hw, d: c0, len: L.b, y0: 0, y1: H, climb: 'deck' });
    S.down = piece({ lane: Q, x: X[Q], hw, d: e0, len: L.down, y0: 0, y1: 0, h0: H, climb: 'ramp', ramp: true });
    drawn({ kind: 'up', lane: P }, { d, len: L.up, h: H });
    drawn({ kind: 'deck', lane: P }, { d: a0, len: L.a, h: H, joins: 'bridge' });
    drawn({ kind: 'bridge', lane: 1, from: P, to: Q }, { d: b0, len: L.bridge, h: H });
    drawn({ kind: 'deck', lane: Q }, { d: c0, len: L.b, h: H, joins: 'down' });
    drawn({ kind: 'down', lane: Q }, { d: e0, len: L.down, h: H });

    // Up top: a hurdle or a bar along each deck, a second jump apart.
    const top = (lane, at, kind) => {
      const spec = r.pick(defs[kind]);
      const g = this.group(world, at, spec.len, null);
      const o = { c: spec.tints ? rgb(r.pick(spec.tints)) : null, p0: r.float(0, 6.28) };
      g.spec = spec;
      g.p0 = o.p0;
      world.put(g, spec.name, X[lane], H, at, o);
      if (spec.with) for (const name of spec.with) world.put(g, name, X[lane], H, at, o);
      const rec = this.record(g, lane, at, spec.len, kind, spec);
      rec.y0 += H;
      rec.y1 += H;
      rec.top = true;
      S.top.push(rec);
      return rec;
    };
    const pickTop = () => r.weighted([['L', 1.2], ['H', 1]]);
    const minV = Math.max(10, v * CONFIG.obstacles.minAfterVertical * 1.15);
    {
      let at = a0 + Math.max(10, v * 0.75);
      const n = diff < 0.2 ? 1 : 2;
      for (let i = 0; i < n && at < b0 - v * 0.55; i++) {
        const rec = top(P, at, pickTop());
        at = rec.d + rec.len + minV;
      }
      if (diff >= 0.12) top(Q, c0 + Math.max(8, v * 0.6), pickTop());
    }

    // Below: chutes off the walk pour sand over the middle lane, and between
    // them the odd hurdle or bar in the open outer lane. (Every moment
    // leaves a lane you can just run along: the curtains and the outer
    // lane's obstacles never stand side by side.)
    const curtain = (from, at) => {
      const len = def.curtain.len;
      const g = this.group(world, at, len, null);
      g.spec = def.curtain;
      drawn({ kind: 'chute', lane: 1, from }, { d: at, len, h: H, group: g });
      const rec = this.record(g, 1, at, len, 'W', def.curtain);
      rec.soft = true;
      // (it pours from the chute's lip, under the walk: up over that - off
      // the side of the walk, or scrambling up onto it - it's below you)
      rec.y1 = H - 0.4;
      S.under.push(rec);
      return rec;
    };
    const low = (lane, at) => {
      const kind = r.weighted([['L', 1], ['H', 1]]);
      const spec = r.pick(defs[kind]);
      const g = this.group(world, at, spec.len, null);
      this.putSpec(world, g, spec, X[lane], at, { c: spec.tints ? rgb(r.pick(spec.tints)) : null, p0: r.float(0, 6.28) });
      this.shadow(world, g, X[lane], at, spec.len, 2.4, kind === 'L' ? 0.9 : 2.2);
      const rec = this.record(g, lane, at, spec.len, kind, spec);
      S.under.push(rec);
      return rec;
    };
    curtain(P, a0 + v * 0.45);
    if (diff >= 0.08) low(Q, a0 + v * 1.35);
    if (diff >= 0.22) curtain(P, a0 + v * 2.15);
    curtain(Q, c0 + v * 0.5);
    if (diff >= 0.3) low(P, c0 + v * 1.15);
    return end - d;
  }

  // The height of the top of the climbs under a companion at (x, d) - a
  // deck's top, a ramp's slope, and across a gap a leap from the one deck
  // to the next - or 0. (A span overhead - a high route's bridge - only
  // counts for one already up at its height: y, how high she is now.)
  surfaceAt(x, d, y = Infinity) {
    let h = 0;
    for (const o of this.records) {
      if (!o.climb || d < o.d || d > o.d + o.len || Math.abs(x - o.x) > o.hw) continue;
      if (o.over && y < o.y0) continue;
      const t = (d - o.d) / o.len;
      const s = o.pit ? o.h0 + (o.next - o.h0) * t + 0.9 * Math.sin(Math.PI * t) : o.ramp ? o.h0 + (o.y1 - o.h0) * t : o.y1;
      if (s > h) h = s;
    }
    return h;
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

  // The obstacles a world lays at d. A world whose road changes along its
  // length (def.obstaclesAt(seg, d): the Blue Hour's grass headland, its
  // causeway and its fishing landing) deals each stretch its own; every
  // spec it can ever deal is still listed in def.obstacles (see
  // World.markObstacles).
  defsAt(world, d) {
    const at = world.def.obstaclesAt;
    if (!at) return world.def.obstacles;
    const seg = this.game.course.segAt(d);
    return at(seg.world === world ? seg : null, d) || world.def.obstacles;
  }

  // One of a kind's specs for a lane. A spec can be kept to some lanes
  // (spec.lanes: a wreck's spar only reaches in from the verge) and weighted (spec.w); a
  // list that does neither is dealt from exactly as it always was.
  specFor(list, lane) {
    const r = this.rng;
    if (!list.some((s) => s.lanes || s.w)) return r.pick(list);
    const ok = list.filter((s) => !s.lanes || s.lanes.includes(lane));
    return r.weighted((ok.length ? ok : list).map((s) => [s, s.w ?? 1]));
  }

  // Something drawn once across two neighbouring lanes (defs.twin[kind]: a
  // storm-thrown trunk over two lanes, a dinghy lying slantwise across
  // them), standing for both their obstacles: a record in each lane, one
  // thing to see. Returns the lanes it took.
  placeTwin(world, defs, d, row, lanes, laid) {
    const r = this.rng;
    const took = [false, false, false];
    if (!defs.twin) return took;
    for (const [a, b] of [[0, 1], [1, 2]]) {
      const k = row.lanes[a];
      if (!k || k !== row.lanes[b] || took[a] || !defs.twin[k]?.length) continue;
      if (!r.chance(defs.twinChance ?? 0.5)) continue;
      const spec = r.pick(defs.twin[k]);
      const x = (CONFIG.laneX[a] + CONFIG.laneX[b]) / 2;
      const group = this.group(world, d, spec.len, row.hint, 2);
      this.putSpec(world, group, spec, x, d, { c: spec.tints ? rgb(r.pick(spec.tints)) : null, p0: r.float(0, 6.28) });
      if (!spec.flat) this.shadow(world, group, x, d, spec.len, 4.8, k === 'L' ? 0.9 : k === 'H' ? 2.2 : 3);
      lanes[a] = this.record(group, a, d, spec.len, k, spec);
      lanes[b] = this.record(group, b, d, spec.len, k, spec);
      laid.end = Math.max(laid.end, d + spec.len);
      took[a] = took[b] = true;
    }
    return took;
  }

  placeRow(world, d, row) {
    const defs = this.defsAt(world, d);
    const r = this.rng;
    const lanes = [null, null, null];
    const laid = { d, end: d, lanes, hint: row.hint || null };
    this.rows.push(laid);
    if (row.wide) {
      const spec = this.wideSpec(row.wide === 'L' ? defs.LW : defs.HW, d);
      const group = this.group(world, d, spec.len, row.hint, CONFIG.score.wide);
      this.putSpec(world, group, spec, 0, d, { c: spec.tints ? rgb(r.pick(spec.tints)) : null, p0: r.float(0, 6.28) });
      if (!spec.flat) this.shadow(world, group, 0, d, spec.len, 8.6, row.wide === 'L' ? 0.9 : 2.2);
      for (let lane = 0; lane < 3; lane++) lanes[lane] = this.record(group, lane, d, spec.len, row.wide, spec);
      laid.end = d + spec.len;
      if (spec.bounce) laid.bounce = true;
      return spec.len;
    }
    let maxLen = 0;
    const twinned = this.placeTwin(world, defs, d, row, lanes, laid);
    for (const k of [0, 1, 2]) if (twinned[k]) maxLen = Math.max(maxLen, lanes[k].len);
    for (let lane = 0; lane < 3; lane++) {
      const kind = row.lanes[lane];
      if (!kind || twinned[lane]) continue;
      const x = CONFIG.laneX[lane];
      if (kind === 'W' && defs.SW && lane !== 1 && r.chance(0.4)) {
        lanes[lane] = this.placeSwing(world, defs.SW, lane, d, row.hint);
        laid.d = Math.min(laid.d, lanes[lane].d);
        laid.end = Math.max(laid.end, lanes[lane].d + lanes[lane].len);
        maxLen = Math.max(maxLen, defs.SW.len);
        continue;
      }
      const spec = this.specFor(defs[kind], lane);
      const group = this.group(world, d, spec.len, row.hint);
      // (spec.left: in the left-hand lane, the same thing built the other
      // way round - a wave breaking in off the sea on that side, a spar
      // reaching in from the wreck on that verge)
      this.putSpec(world, group, lane === 0 && spec.left ? { ...spec, name: spec.left, with: spec.withLeft || spec.with } : spec, x, d, {
        c: spec.tints ? rgb(r.pick(spec.tints)) : null,
        ry: spec.flip && r.chance(0.5) ? Math.PI : 0,
        p0: r.float(0, 6.28),
      });
      if (!spec.flat) this.shadow(world, group, x, d, spec.len, 2.4, kind === 'L' ? 0.9 : kind === 'H' ? 2.2 : 3);
      lanes[lane] = this.record(group, lane, d, spec.len, kind, spec);
      laid.end = Math.max(laid.end, d + spec.len);
      if (spec.bounce) laid.bounce = true;
      maxLen = Math.max(maxLen, spec.len);
    }
    return maxLen;
  }

  // A full-width obstacle's spec. A world may give a few (the Kelp Deep's
  // whales): then it's never the same one twice running - stepping on one or
  // two by a hash of where it lies, not by the layout's own dice, so the same
  // seed still lays out the same road.
  wideSpec(spec, d) {
    if (!Array.isArray(spec)) return spec;
    const n = spec.length;
    let h = Math.sin(d * 12.9898 + 78.233) * 43758.5453;
    h -= Math.floor(h);
    if (this.wideTurn === undefined) this.wideTurn = Math.floor(h * n);
    else this.wideTurn = (this.wideTurn + (n > 2 && h < 0.5 ? 2 : 1)) % n;
    return spec[this.wideTurn];
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
    // (its phase: a chest's lid keeps its own time by it, see lidPop in game.js)
    group.p0 = o.p0 ?? 0;
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
  // you can't stand on (water): landing in it trips you like running into it;
  // spec.bounce something that bounces you (Candy World's gumdrops).
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
      // (something bouncy: come down on it, or catch it in the air, and it
      // throws you up - see CONFIG.bounce and Game.boinged)
      bounce: !!spec?.bounce,
      hit: false,
    };
    this.records.push(rec);
    return rec;
  }

  // Highest LOW-obstacle top the player could be standing on: wherever their
  // body is over it at all - the same box the hits are tested in, so they can
  // never be standing on it one moment and stumbling into it the next (running
  // off its end, or stepping sideways off it).
  //
  // (y: how high the runner is now. A span overhead - a high route's bridge
  // - is only ground for someone up at it, not for someone running under
  // it. rampUnder: whether the ground found is a stair's slope, which the
  // runner is carried up and down as they run, rather than stepping off.)
  groundAt(x, dist, y = Infinity) {
    let h = 0;
    let ramp = false;
    let bounce = null;
    const pw = CONFIG.player.halfWidth;
    const pd = CONFIG.player.halfDepth;
    for (const o of this.records) {
      if (o.kind !== 'L' || o.hit || o.wade || o.pit) continue;
      if (dist < o.d - pd || dist > o.d + o.len + pd) continue;
      if (Math.abs(x - o.x) >= o.hw + pw) continue;
      if (o.over && y < o.y0) continue;
      // (a ramp: its slope, under the front of the body)
      const top = o.ramp ? o.h0 + (o.y1 - o.h0) * Math.min(1, Math.max(0, (dist + pd - o.d) / o.len)) : o.y1;
      if (top > h || (top === h && o.ramp)) {
        h = top;
        ramp = !!o.ramp;
        bounce = o.bounce ? o : null;
      }
    }
    this.rampUnder = ramp;
    // (and whether it's something bouncy: see CONFIG.bounce)
    this.bounceUnder = bounce;
    return h;
  }

  // The underside of a span overhead - a high route's bridge - anywhere over
  // x between track distances d0 and d1, for someone under it at height y;
  // Infinity if there's none. (Never a hit from below - see Game.collide -
  // but a jump taken under one only rises as high as keeps their head
  // under it: see Player.takeOff.)
  ceilingAt(x, d0, d1, y) {
    let c = Infinity;
    const pw = CONFIG.player.halfWidth;
    for (const o of this.records) {
      if (!o.over || o.d > d1 || o.d + o.len < d0 || y >= o.y0) continue;
      if (Math.abs(x - o.x) >= o.hw + pw) continue;
      if (o.y0 < c) c = o.y0;
    }
    return c;
  }

  // Whether the runner's feet are over water (a wade obstacle): no dust there.
  wetAt(x, dist) {
    for (const o of this.records) {
      if (!o.wade) continue;
      if (dist < o.d - 0.1 || dist > o.d + o.len + 0.1) continue;
      if (Math.abs(x - o.x) > o.hw) continue;
      return true;
    }
    return false;
  }

  nextHint(dist, range) {
    for (const g of this.groups) {
      if (g.hint && !g.hinted && g.d > dist && g.d - dist < range) return g;
    }
    return null;
  }
}
