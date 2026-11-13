import { CONFIG } from '../config.js';
import { rgb } from '../render/geo.js';
import { boostArc, plainArc } from './drift.js';
import { RNG } from '../core/rng.js';

// Gem director. Gems are laid in runs along a "ghost" route: the line a good
// runner would take through the obstacles ahead, planned row by row as the
// obstacle director lays them. So every run can be collected, reads at a
// glance, and plays with the obstacles instead of ignoring them — it swerves
// out of a lane before the wall in it, arcs over a hurdle at the exact height
// of a jump taken at the right moment, drops under a duck bar, threads the gap
// between walls, and leads you through a doorway (changing colour as it
// crosses into the next world).
//
// Early on the route is lazy and kind: it keeps to free lanes, swerves long
// before anything, and the runs are short with plenty of empty road between
// them. As the run goes on it swerves later and later, takes the hurdles and
// bars instead of going round them, wanders across lanes on open road, hangs
// gems in the air for jumps you don't strictly need, and the runs come longer
// and closer together. Missing gems costs nothing.
//
// Within a run the gems ripple — each turns and bobs a beat behind the one
// before. A world has several stones in its colour family (garnet and
// rhodonite among the rubies, olivine and malachite with the emeralds...):
// each run has a lead stone, weighted toward the world's own, with the others
// mixed in, every gem in its own shade of its stone. The prize spots (the top
// of a jump, the way out from under a bar, the first step into a new world)
// get the world's crown stone, worth more.

const X = CONFIG.laneX;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const R = 0.4; // room a gem takes up round its centre

export class GemField {
  constructor(game) {
    this.game = game;
    this.gems = []; // live gems, in order along the road
    this.moves = []; // the route's lane changes: { d, from, to, len }
    this.got = [];
  }

  reset(rng, startD) {
    this.clear();
    this.rng = rng;
    this.lane = 1; // the route's lane at the cursor
    this.moves.length = 0;
    this.cursor = startD + CONFIG.gems.firstAt; // the route is planned up to here
    this.restUntil = this.cursor; // no new run starts before here
    this.restT = CONFIG.gems.rest[0];
    // (the companions' gems have dice of their own, so the road's own come
    // out the same for a seed whatever they do: see bonus)
    this.bonusRng = new RNG((Math.random() * 1e9) | 0);
  }

  clear() {
    for (const g of this.gems) this.unput(g);
    this.gems.length = 0;
    this.run = null;
  }

  dropWorld(world) {
    let w = 0;
    for (const g of this.gems) {
      if (g.world === world) this.unput(g);
      else this.gems[w++] = g;
    }
    this.gems.length = w;
  }

  unput(g) {
    g.world.batch('gems').removeOwner(g);
    g.world.batch('gemGlow').removeOwner(g);
    g.world.batch('gemPool').removeOwner(g);
  }

  update(dist, runTime) {
    for (let guard = 0; guard < 12 && this.cursor < dist + CONFIG.viewAhead; guard++) {
      if (!this.step(dist, runTime)) break;
    }
    // let go of gems left behind, and of collected ones once they've flown
    const time = this.game.time;
    const limit = dist - 12;
    let w = 0;
    for (const g of this.gems) {
      if (g.taken ? time - g.taken > (g.tossed ? 0.62 : 0.3) : g.d < limit) this.unput(g);
      else this.gems[w++] = g;
    }
    this.gems.length = w;
  }

  // Plan the route past the next obstacle row (or doorway), once the road
  // around it is final.
  step(dist, runTime) {
    const obs = this.game.obstacles;
    const row = obs.rowAfter(this.cursor);
    const door = this.game.course.boundaryAfter(this.cursor);
    if (door && (!row || door.d < row.d)) {
      if (obs.nextD <= door.d) return false;
      this.doorway(door, dist, runTime);
      return true;
    }
    // wait until whatever follows the row is laid too (a gem just past it must
    // not end up in front of a wall nobody has placed yet)
    if (!row || obs.nextD < row.end + 30) return false;
    this.pass(row, dist, runTime);
    return true;
  }

  // Speed and difficulty when the runner gets to d.
  at(d, dist, runTime) {
    const game = this.game;
    const eta = runTime + Math.max(0, d - dist) / Math.max(game.speed, 6);
    return [game.speedAt(eta), game.obstacles.difficultyFor(d, eta)];
  }

  // The jump at d: its airtime, when it's best over a hurdle, and the height
  // of the feet through it (in low gravity, the boost's arc: see drift.js) -
  // the runner's own jump, so a run of gems laid over one follows their arc.
  arcAt(d) {
    return this.game.course.segAt(d).world.def.lowGravity ? boostArc() : plainArc(this.game.player?.feel?.jump);
  }

  spacing(v) {
    return Math.min(3.9, Math.max(2.3, v * CONFIG.gems.spacing));
  }

  // --- the route ------------------------------------------------------------
  pass(row, dist, runTime) {
    row.gemmed = true;
    const C = CONFIG.gems;
    const r = this.rng;
    const [v, diff] = this.at(row.d, dist, runTime);
    const sp = this.spacing(v);
    this.restT = lerp(C.rest[0], C.rest[1], diff) * r.float(0.8, 1.3);
    const to = this.chooseLane(row, this.lane, diff);
    const rec = row.lanes[to];
    const kind = rec ? rec.kind : null;
    const A = this.arcAt(row.d);
    const T = A.T;
    const takeoff = rec ? rec.d + rec.len / 2 - v * A.mid : row.d;

    // what the run does at the row — only if the route is settled in its lane
    // by then (a row hard on the heels of the last can leave the swerve late)
    const arrive = this.route(this.lane, to, kind === 'L' ? takeoff : row.d, v, diff);
    let act = null;
    let first = row.d - v * 0.3;
    if (kind === 'L' && (row.hint || diff >= C.unlock.arc) && arrive <= takeoff && r.chance(0.85)) {
      act = 'arc';
      first = takeoff + (v * T) / 10;
    } else if (kind === 'H' && (row.hint || diff >= C.unlock.slide) && arrive <= row.d - v * 0.1 && r.chance(0.8)) {
      act = 'slide';
      first = row.d - v * 0.2;
    } else if (!kind && row.lanes.some((o) => o && o.kind === 'W') && arrive <= row.d - v * 0.05 && r.chance(lerp(0.55, 0.8, diff))) {
      act = 'thread';
    }

    // a run along the road on the way in (flowing into the move), then the move
    this.cruise(this.cursor, act ? first - sp : row.d - v * 0.35, v, diff, sp, !!act);
    if (act && (first >= this.restUntil || this.joins(first, sp))) {
      if (act === 'arc') this.arc(takeoff, v, diff, sp, true);
      else if (act === 'slide') this.under(row, v, diff, sp);
      else this.thread(row, v, diff, sp);
    }
    this.lane = to;
    this.cursor = Math.max(row.end, kind === 'L' ? takeoff + v * T : 0) + v * 0.12;
  }

  // The lane the route takes past a row: never a wall; at first the nearest
  // free lane, later more willing to cross the road and drawn to the hurdles
  // and bars it used to steer round.
  chooseLane(row, from, diff) {
    const r = this.rng;
    let best = from;
    let cost = Infinity;
    for (let i = 0; i < 3; i++) {
      const o = row.lanes[i];
      if (o && o.kind === 'W') continue;
      const c = Math.abs(i - from) * lerp(0.9, 0.45, diff) + (o ? lerp(1.2, -1.0, diff) : 0) + r.float(0, 1.3);
      if (c < cost) {
        cost = c;
        best = i;
      }
    }
    return best;
  }

  // Lane changes on the way to `commit` (where the route must be in lane
  // `to`): maybe a wander across the road on a long open stretch first, then
  // the swerve itself — long before at first, later and later as the run
  // goes on. Returns where the route is settled in `to`.
  route(from, to, commit, v, diff) {
    const C = CONFIG.gems;
    const r = this.rng;
    const lead = lerp(C.lead[0], C.lead[1], diff) * r.float(0.9, 1.2);
    let lane = from;
    if (diff >= C.unlock.wander && commit - this.cursor > v * 2.6 && r.chance(0.3 + 0.35 * diff)) {
      const mid = from !== 1 ? (diff > 0.4 && r.chance(0.3) ? 2 - from : 1) : r.pick([0, 2]);
      const d = this.cursor + v * r.float(0.35, 0.8);
      const len = v * C.swerve * Math.abs(mid - from);
      if (d + len + v * 0.9 < commit - v * lead) {
        this.moves.push({ d, from, to: mid, len });
        lane = mid;
      }
    }
    let arrive = this.cursor;
    if (lane !== to) {
      const len = v * C.swerve * Math.abs(to - lane);
      const d = Math.max(this.cursor + v * 0.1, commit - v * lead - len * 0.5);
      this.moves.push({ d, from: lane, to, len });
      arrive = d + len;
    }
    while (this.moves.length > 1 && this.moves[1].d < this.cursor - 40) this.moves.shift();
    return arrive;
  }

  // Where the route is across the road at d.
  xAt(d) {
    let m = null;
    for (const mv of this.moves) {
      if (mv.d > d) break;
      m = mv;
    }
    if (!m) return X[this.moves.length ? this.moves[0].from : this.lane];
    return lerp(X[m.from], X[m.to], ease((d - m.d) / m.len));
  }

  // True if the route holds its lane all the way from a to b.
  steady(a, b) {
    for (const m of this.moves) if (m.d < b && m.d + m.len > a) return false;
    return true;
  }

  // --- runs -----------------------------------------------------------------
  // Open road between g0 and g1: often a run of gems along the route (ending
  // right where the next move starts when it flows into one), now and then —
  // later on — a jump for gems hung in the air.
  cruise(g0, g1, v, diff, sp, flow) {
    const C = CONFIG.gems;
    const r = this.rng;
    const start = Math.max(g0, this.restUntil);
    const room = g1 - start;
    if (room < sp * 2 || !r.chance(lerp(C.often[0], C.often[1], diff))) return;
    const T = this.arcAt(start).T;
    if (diff >= C.unlock.hop && room > v * T + sp * 4 && r.chance(0.28)) {
      const takeoff = start + sp * 2 + r.float(0, room - v * T - sp * 4);
      if (this.steady(takeoff - sp * 2, takeoff + v * T + sp)) {
        this.line(takeoff - sp * 2, 2, sp, v, diff);
        this.arc(takeoff, v, diff, sp, true);
        return;
      }
    }
    const n = Math.min(r.int(C.run[0], C.run[1] + Math.round(diff * 3)), Math.floor(room / sp) + 1);
    const span = (n - 1) * sp;
    this.line(flow && r.chance(0.7) ? g1 - span : start + r.float(0, room - span), n, sp, v, diff);
  }

  line(d0, n, sp, v, diff) {
    for (let i = 0; i < n; i++) {
      const d = d0 + i * sp;
      this.gem(d, this.xAt(d), CONFIG.gems.ground, v, diff);
    }
  }

  // Gems on the arc of a jump taken at `takeoff` — at the height the runner's
  // middle passes through, so a jump at the right moment takes every one — and
  // one on the road where you land. The top of the arc is a crown stone.
  arc(takeoff, v, diff, sp, crown) {
    const n = diff > 0.4 && this.rng.chance(0.6) ? 7 : 5;
    const x = this.xAt(takeoff);
    const A = this.arcAt(takeoff);
    for (let i = 0; i < n; i++) {
      const t = (A.T * (i + 0.5)) / n;
      this.gem(takeoff + v * t, x, A.feet(t) + CONFIG.gems.ground, v, diff, crown && i === (n - 1) >> 1);
    }
    const land = takeoff + v * A.T + sp * 0.6;
    this.gem(land, this.xAt(land), CONFIG.gems.ground, v, diff);
  }

  // Low gems ducking under a bar: take them in a slide (the one waiting on
  // the far side is a crown stone).
  under(row, v, diff, sp) {
    const d0 = row.d - v * 0.2;
    const d1 = row.end + v * 0.2;
    const n = Math.max(3, Math.round((d1 - d0) / sp) + 1);
    for (let i = 0; i < n; i++) {
      const d = lerp(d0, d1, i / (n - 1));
      this.gem(d, this.xAt(d), CONFIG.gems.low, v, diff, i === n - 1);
    }
  }

  // Through the open lane of a row with walls in it.
  thread(row, v, diff, sp) {
    const d0 = row.d - v * 0.3;
    const d1 = row.end + v * 0.3;
    const n = Math.max(2, Math.round((d1 - d0) / sp) + 1);
    for (let i = 0; i < n; i++) {
      const d = lerp(d0, d1, i / (n - 1));
      this.gem(d, this.xAt(d), CONFIG.gems.ground, v, diff);
    }
  }

  // A doorway: drift to the middle of the road and, usually, a line of gems
  // through it — the last few in this world's stone, then (as one run) the
  // first few in the next world's, the first of them a crown.
  doorway(door, dist, runTime) {
    const C = CONFIG.gems;
    const r = this.rng;
    const [v, diff] = this.at(door.d, dist, runTime);
    const sp = this.spacing(v);
    this.restT = lerp(C.rest[0], C.rest[1], diff);
    const trail = r.chance(C.doorTrail);
    const n = 4;
    const first = door.d - 2.4 - (n - 1) * sp;
    const far = door.d + door.to.world.def.gate.depth + 2.4;
    this.route(this.lane, 1, first, v, diff);
    this.cruise(this.cursor, trail ? first - sp : door.d - v * 1.2, v, diff, sp, trail);
    if (trail) {
      for (let i = 0; i < n; i++) this.gem(first + i * sp, this.xAt(first + i * sp), C.ground, v, diff, false, true);
      for (let i = 0; i < 3; i++) this.gem(far + i * sp, X[1], C.ground, v, diff, i === 0, true);
    }
    this.lane = 1;
    this.cursor = door.d + CONFIG.doorClearAfter - 6;
  }

  // Would a gem's first position d continue the run being laid?
  joins(d, sp) {
    return !!this.run && !this.run.closed && d - this.run.last <= Math.max(sp * 1.7, 4.6);
  }

  // Never touching an obstacle, never in a doorway's frame, and never so close
  // before a wall in its lane that taking it leaves no time to swerve out, or
  // so soon after one that you'd have to cut in round its corner — a margin
  // that shrinks as the run goes on. A gem between lanes counts for the wall's
  // lane in proportion to how far into it it lies.
  safe(d, x, y, v, diff) {
    const C = CONFIG.gems;
    const react = v * lerp(C.react[0], C.react[1], diff);
    for (const o of this.game.obstacles.records) {
      const dx = Math.abs(x - o.x);
      if (dx > 2.2) continue;
      if (dx < o.hw + R && d > o.d - 0.7 && d < o.d + o.len + 0.7 && y + R > o.y0 && y - R < o.y1) return false;
      if (o.kind === 'W') {
        const k = 1 - Math.min(1, dx / (o.hw + CONFIG.player.halfWidth));
        if (k > 0 && d > o.d - react * k && d < o.d + o.len + react * k) return false;
      }
    }
    const b = this.game.course.boundaryAfter(d - 4);
    return !(b && d > b.d - 1.4 && d < b.d + b.to.world.def.gate.depth + 1.4);
  }

  // Lay one gem, continuing the current run if it's close enough (or join).
  gem(d, x, y, v, diff, crown = false, join = false) {
    if (!this.safe(d, x, y, v, diff)) return false;
    const C = CONFIG.gems;
    const r = this.rng;
    const world = this.game.course.segAt(d).world;
    const spec = world.def.gem;
    if (!spec) return false;
    let run = this.run;
    if (!run || run.size >= C.maxRun || (!join && !this.joins(d, this.spacing(v)))) {
      if (run) run.closed = true;
      run = this.run = { size: 0, taken: 0, closed: false, last: d, phase: r.float(0, 6.28), lead: new Map() };
    }
    const index = run.size++;
    run.last = d;
    // the run's lead stone for this world (a run through a doorway has one in
    // each), now and then another of the world's stones, the crown at the
    // prize spots
    let kind = spec.stones.length;
    if (!crown) {
      if (!run.lead.has(world)) run.lead.set(world, this.pickStone(spec));
      kind = r.chance(C.mix) ? this.pickStone(spec) : run.lead.get(world);
    }
    const stone = crown ? spec.crown : spec.stones[kind];
    const tints = stone.rgb || (stone.rgb = stone.tints.map((t) => rgb(t)));
    const a = r.pick(tints);
    const b = r.pick(tints);
    const t = r.float(0, 1);
    const k = r.float(0.93, 1.05);
    const tint = [lerp(a[0], b[0], t) * k, lerp(a[1], b[1], t) * k, lerp(a[2], b[2], t) * k];
    // (a world of dark stones gives them a pale light of their own, or their
    // halos and motes would vanish)
    const light = spec.light ? (spec.lightRgb || (spec.lightRgb = rgb(spec.light))) : tint;
    const g = { d, x, y, world, run, index, kind, crown, tint, light, taken: 0, items: null };
    // each gem turns and bobs a beat behind the one before: the run ripples
    const p0 = run.phase - index * 0.6;
    const pool = Math.max(0.15, 1 - (y - C.ground) / 2.4);
    const s = C.size * (crown ? 1.3 : 1);
    // gems ducking under a bar duck a little themselves, to keep clear of it
    const duck = y < C.ground - 0.1 ? 0.85 : 1;
    g.items = [
      world.put(g, 'gems', x, y, d, { s: (crown ? 1 : r.float(0.92, 1.08)) * duck, c: tint, p0, p1: kind }),
      world.put(g, 'gemGlow', x, y, d, { s: (spec.halo ?? 1.5) * s, c: light, p0 }),
      world.put(g, 'gemPool', x, 0.04, d, { s: 1.7 * s, c: [light[0] * pool, light[1] * pool, light[2] * pool], p0 }),
    ];
    this.gems.push(g);
    this.restUntil = Math.max(this.restUntil, d + v * this.restT);
    return true;
  }

  // One of the world's everyday stones, by weight.
  pickStone(spec, rng = this.rng) {
    return rng.weighted(spec.stones.map((s, i) => [i, s.weight ?? 1]));
  }

  // --- the companions' gems -------------------------------------------------
  // (see powers.js) Laid with dice of their own, so the road's own gems -
  // and everything else a seed lays - come out the same with or without.
  // A gem outside the director's runs: crown, the world's crown stone; big,
  // drawn bigger (Lucky Find's); run, a run of the companion's own to count
  // toward (null: a run of one). Never where a gem already is, nor anywhere
  // safe() wouldn't lay one. Returns it, or null.
  bonus(d, x, y, { crown = false, big = 1, run = null, rng } = {}) {
    rng = rng || this.bonusRng;
    const game = this.game;
    const v = Math.max(game.speed, CONFIG.speed.start);
    const diff = game.obstacles.difficultyFor(d, game.runTime);
    if (!this.safe(d, x, y, v, diff)) return null;
    for (const g of this.gems) if (!g.taken && Math.abs(g.d - d) < 1.4 && Math.abs(g.x - x) < 0.9 && Math.abs(g.y - y) < 0.7) return null;
    const world = game.course.segAt(d).world;
    const spec = world.def.gem;
    if (!spec) return null;
    run = run || { size: 0, taken: 0, closed: true, last: d, phase: rng.float(0, 6.28), lead: new Map(), bonus: true };
    const index = run.size++;
    run.last = d;
    if (!run.lead.has(world)) run.lead.set(world, this.pickStone(spec, rng));
    const kind = crown ? spec.stones.length : run.lead.get(world);
    const stone = crown ? spec.crown : spec.stones[kind];
    const tints = stone.rgb || (stone.rgb = stone.tints.map((t) => rgb(t)));
    const a = rng.pick(tints);
    const tint = [a[0], a[1], a[2]];
    const light = spec.light ? (spec.lightRgb || (spec.lightRgb = rgb(spec.light))) : tint;
    const g = { d, x, y, world, run, index, kind, crown, tint, light, taken: 0, items: null, bonus: true, big };
    const C = CONFIG.gems;
    const p0 = run.phase - index * 0.6;
    const s = C.size * (crown ? 1.3 : 1) * big;
    const duck = y < C.ground - 0.1 ? 0.85 : 1;
    g.items = [
      world.put(g, 'gems', x, y, d, { s: big * duck, c: tint, p0, p1: kind }),
      world.put(g, 'gemGlow', x, y, d, { s: (spec.halo ?? 1.5) * s * (big > 1 ? 1.35 : 1), c: light, p0 }),
      world.put(g, 'gemPool', x, 0.04, d, { s: 1.7 * s, c: light, p0 }),
    ];
    // (kept in order along the road: the companions look through them so)
    let i = this.gems.length;
    while (i > 0 && this.gems[i - 1].d > d) i--;
    this.gems.splice(i, 0, g);
    return g;
  }

  // Bonus gems taken back up unlaid (a trail too short to be worth it).
  retract(list) {
    const gone = new Set(list);
    for (const g of list) this.unput(g);
    this.gems = this.gems.filter((g) => !gone.has(g));
  }

  // Sorrel caught it and keeps it (Fox's Haul): it's taken - counting toward
  // its run, as any gem taken - and gone into her jaws at once, to be handed
  // over when she brings her haul back.
  stash(g, time) {
    g.taken = time;
    g.tossed = false;
    this.unput(g);
    g.items = [];
    const run = g.run;
    run.taken++;
    g.whole = run.taken === run.size && run.size >= 3 && (run.closed || this.cursor - run.last > 8);
    return g;
  }

  // Buried Treasure: a trail of bonus gems from `from` to `to` along a route
  // that can be run - taking every row on the way in a lane with no wall in
  // it, over the hurdles on the arc of a jump and under the bars low, and
  // only changing lanes in the open road between rows, with time to - and
  // never through a doorway. lane: where the runner is now. Returns the gems
  // laid (none if no route could be found).
  trail(from, to, lane) {
    const game = this.game;
    const C = CONFIG.gems;
    const rng = this.bonusRng;
    const v = Math.max(game.speed, CONFIG.speed.start);
    const door = game.course.boundaryAfter(game.dist);
    if (door) to = Math.min(to, door.d - 3);
    if (to - from < v) return [];
    const rows = game.obstacles.rows.filter((r) => r.d > from && r.end < to && r.lanes.some(Boolean));
    // the lane past each row: never a wall; reachable from the last in the
    // road between them; and leaving a way on past the next. Hurdles and
    // bars are taken gladly - that's the treasure's price.
    const swerve = v * C.swerve; // m to cross one lane
    const react = v * 0.4;
    const pass = (rec) => !rec || (rec.kind !== 'W' && !(rec.kind === 'L' && rec.y1 > 1.2));
    const can = (row, l) => pass(row.lanes[l]);
    const plan = [];
    let cur = lane;
    let at = from;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const room = row.d - react - at;
      const reach = (l) => Math.abs(l - cur) * swerve <= room;
      const next = rows[i + 1];
      let best = -1, score = -1e9;
      for (let l = 0; l < 3; l++) {
        if (!can(row, l) || !reach(l)) continue;
        // (a way on from here past the next row)
        if (next) {
          const room2 = next.d - react - (row.end + v * 0.1);
          if (![0, 1, 2].some((m) => can(next, m) && Math.abs(m - l) * swerve <= room2)) continue;
        }
        const act = row.lanes[l] ? 1.2 : 0;
        const sc = act - Math.abs(l - cur) * 0.7 + rng.float(0, 0.6);
        if (sc > score) {
          score = sc;
          best = l;
        }
      }
      if (best < 0) {
        // (a row too close to swerve for, before the trail's begun: it
        // starts past it instead, in whichever lane leads on best)
        if (!plan.length && i + 1 < rows.length) {
          const open = [0, 1, 2].filter((l) => can(row, l));
          if (open.length) {
            cur = open.reduce((a, b) => (Math.abs(b - lane) < Math.abs(a - lane) ? b : a));
            lane = cur;
            from = at = row.end + v * 0.3;
            continue;
          }
        }
        to = Math.min(to, row.d - react);
        break;
      }
      plan.push({ row, lane: best, from: cur, at: Math.max(at, row.d - react - Math.abs(best - cur) * swerve) });
      cur = best;
      at = row.end + v * 0.12;
    }
    // where the route is across the road at d
    const xAt = (d) => {
      let x = CONFIG.laneX[lane];
      for (const p of plan) {
        if (d < p.at) break;
        const len = Math.max(1e-3, Math.abs(p.lane - p.from) * swerve);
        x = lerp(CONFIG.laneX[p.from], CONFIG.laneX[p.lane], ease((d - p.at) / len));
      }
      return x;
    };
    const run = { size: 0, taken: 0, closed: true, last: from, phase: rng.float(0, 6.28), lead: new Map(), bonus: true };
    const out = [];
    const put = (d, x, y, crown = false) => {
      if (d < from || d > to) return;
      const g = this.bonus(d, x, y, { crown, run, rng });
      if (g) out.push(g);
    };
    const sp = this.spacing(v);
    // the open road, one gem every step...
    const busy = []; // [d0, d1] stretches the rows' own gems take
    for (const p of plan) {
      const rec = p.row.lanes[p.lane];
      if (rec && rec.kind === 'L') {
        const A = this.arcAt(rec.d);
        const takeoff = rec.d + rec.len / 2 - v * A.mid;
        busy.push([takeoff - sp * 0.5, takeoff + v * A.T + sp * 0.5]);
        const n = 5;
        for (let k = 0; k < n; k++) {
          const t = (A.T * (k + 0.5)) / n;
          put(takeoff + v * t, CONFIG.laneX[p.lane], A.feet(t) + C.ground, k === (n - 1) >> 1);
        }
      } else if (rec && rec.kind === 'H') {
        const d0 = p.row.d - v * 0.2, d1 = p.row.end + v * 0.2;
        busy.push([d0 - sp * 0.5, d1 + sp * 0.5]);
        const n = Math.max(3, Math.round((d1 - d0) / sp) + 1);
        for (let k = 0; k < n; k++) put(lerp(d0, d1, k / (n - 1)), CONFIG.laneX[p.lane], C.low, k === n - 1);
      } else {
        busy.push([p.row.d - 0.6, p.row.end + 0.6]);
      }
    }
    for (let d = from; d <= to; d += sp) {
      if (busy.some(([a, b]) => d > a && d < b)) continue;
      put(d, xAt(d), C.ground);
    }
    out.sort((a, b) => a.d - b.d);
    run.size = out.length;
    return out;
  }

  // --- pick-up --------------------------------------------------------------
  // Gems the runner's body (plus a little reach) passed through this frame,
  // swept along the distance covered so a slow frame can't skip one. Each is
  // marked taken (its gem, halo and pool start being sucked into the runner,
  // from as far ahead of them as the gem was) and gets `whole` if it
  // completed its run.
  collect(p, prevDist, dist, time) {
    const out = this.got;
    out.length = 0;
    const reach = CONFIG.gems.reach;
    const hw = CONFIG.player.halfWidth + reach;
    const z0 = Math.min(prevDist, dist) - CONFIG.player.halfDepth - reach;
    const z1 = dist + CONFIG.player.halfDepth + reach;
    const y0 = p.y - reach;
    const y1 = p.y + p.height + reach;
    for (const g of this.gems) {
      if (g.taken || g.d < z0 || g.d > z1 || Math.abs(g.x - p.x) > hw || g.y < y0 || g.y > y1) continue;
      out.push(this.take(g, time, dist));
    }
    return out;
  }

  // Mark a gem taken: it starts being drawn into the runner from as far
  // ahead of them as it was (tossed: a companion caught it, and throws it
  // back to them in an arc - see gemCollect). It counts toward its run
  // whoever took it; `whole` if it completed it.
  take(g, time, dist, tossed = false) {
    g.taken = time;
    g.tossed = tossed;
    for (const it of g.items) {
      it.p2 = time;
      it.p3 = dist - g.d + (tossed ? 1000 : 0);
    }
    g.world.batch('gems').dirty = true;
    g.world.batch('gemGlow').dirty = true;
    g.world.batch('gemPool').dirty = true;
    const run = g.run;
    run.taken++;
    g.whole = run.taken === run.size && run.size >= 3 && (run.closed || this.cursor - run.last > 8);
    return g;
  }
}
