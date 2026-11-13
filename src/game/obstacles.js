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

// (a climb's pieces span the whole road: every lane, and between them)
const CLIMB_HW = 3.7;

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
    for (const g of this.groups) g.world.removeOwner(g);
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
    if (this.blowing.length) this.blowStep();
  }

  // --- Windbreak ---------------------------------------------------------------
  // (powers.js) The first row of obstacles between d0 and d1 that has
  // anything in it, or null.
  rowBetween(d0, d1) {
    for (const row of this.rows) {
      if (row.d < d0 || row.d > d1) continue;
      // (a gust doesn't carry off the road itself)
      if (row.climb) continue;
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

  blowStep() {
    const time = this.game.time;
    let w = 0;
    for (const B of this.blowing) {
      const k = Math.min(1, (time - B.t0) / B.dur);
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
    const calm = this.calmAt(d);
    const diff = this.difficultyFor(d, eta);
    const tutorial = this.tutorial.length > 0;
    // (a world with def.climb, from its second time round: now and then a
    // stretch of decks to run up onto and jump between, in place of a
    // pattern - see placeClimb)
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
      const world = course.segAt(d).world;
      const len = this.placeRow(world, d, row);
      d += len;
      last = row;
      if (i < rows.length - 1) {
        const min = needsVertical(row) ? o.minAfterVertical * airMul : o.minAfterLane;
        d += Math.max(11, v * Math.max(min, rowGap * (rows[i + 1].gap ?? 1)));
      }
    }
    // rest before the next pattern: long at first, tightening with the run
    let gap = tutorial ? o.tutorialGap : lerp(o.gapEasy, o.gapHard, diff) * space * r.float(o.gapJitter[0], o.gapJitter[1]);
    if (!tutorial && --this.untilBreather <= 0) {
      gap *= o.breatherMul;
      this.untilBreather = r.int(o.breatherEvery[0], o.breatherEvery[1]);
    }
    if (last) gap = Math.max(gap, needsVertical(last) ? o.minAfterVertical * airMul : o.minAfterLane);
    this.nextD = d + Math.max(12, v * gap);
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

  // The height of the top of the climbs under a companion at (x, d) - a
  // deck's top, a ramp's slope, and across a gap a leap from the one deck
  // to the next - or 0.
  surfaceAt(x, d) {
    let h = 0;
    for (const o of this.records) {
      if (!o.climb || d < o.d || d > o.d + o.len || Math.abs(x - o.x) > o.hw) continue;
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

  placeRow(world, d, row) {
    const defs = world.def.obstacles;
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

  // Highest LOW-obstacle top the player could be standing on: wherever their
  // body is over it at all - the same box the hits are tested in, so they can
  // never be standing on it one moment and stumbling into it the next (running
  // off its end, or stepping sideways off it).
  groundAt(x, dist) {
    let h = 0;
    const pw = CONFIG.player.halfWidth;
    const pd = CONFIG.player.halfDepth;
    for (const o of this.records) {
      if (o.kind !== 'L' || o.hit || o.wade || o.pit) continue;
      if (dist < o.d - pd || dist > o.d + o.len + pd) continue;
      if (Math.abs(x - o.x) >= o.hw + pw) continue;
      // (a ramp: its slope, under the front of the body)
      const top = o.ramp ? o.h0 + (o.y1 - o.h0) * Math.min(1, Math.max(0, (dist + pd - o.d) / o.len)) : o.y1;
      if (top > h) h = top;
    }
    return h;
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
