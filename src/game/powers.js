import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';

// The companions' abilities. Each companion has three, one unlocked with
// each level bought with banked gems (progress.js), every level keeping the
// ones before it. Using one costs nothing: each has a cooldown of its own
// (counted from when its effect is over, in seconds of running - not while
// paused, down or picking yourself up), the bigger ones recharging slower,
// and only one companion effect is ever active at a time. A companion's
// everyday ways (her ideas, fetching a gem now and then) carry on around
// them; while an ability needs her she's steered by it (her mind asks
// `power.drive` first: see companion.js and flyer.js) and goes back to
// herself after.
//
// Sorrel, the fox:
//   1 Fox's Haul      for ~7 s she darts from lane to lane snapping up the
//                     gems near you that you aren't about to take, keeps
//                     them, and brings the haul back to you
//   2 Buried Treasure she digs up a trail of bonus gems through the road
//                     ahead, along a route checked to be runnable (gems.js:
//                     trail) - jumps, slides and dodges included
//   3 Lucky Find      she unearths a special gem up the road; take it and
//                     the gems you take yourself count double for ~10 s
//                     (not hers or anyone else's, and never more than double)
// Iris, the dragon:
//   1 Dragon's Gift   for ~6 s the wind off her mane draws the gems near you
//                     in to you
//   2 Windbreak       she winds up, then a gust blows one approaching row of
//                     obstacles off the road (a whale swims aside)
//   3 World Fold      once a run (continues and all): she opens a portal
//                     onto the start of the next world. What's skipped earns
//                     nothing, and the run's clock - which the difficulty and
//                     the dream go by, world by world - doesn't jump
// Nep, the pitcher plant:
//   1 Freshen Up      only after a stumble: he splashes it away - the
//                     second-hit danger gone, back up to pace (a crash is a
//                     crash: nothing undoes one)
//   2 Root Reach      he plants his feet and his roots fetch one cluster of
//                     gems ahead, across the lanes near you
//   3 Pitcher Protection  he drenches you: ~5 s that nothing can hurt you
// Teasel, the storm thistle:
//   1 Electric Bolt   a shock from its crown into you: for ~8 s you run
//                     nearly half as fast again, crackling (a way to get
//                     through the worlds quicker, early on)
//   2 Static Attraction  for ~10 s you're charged: every gem near you is
//                     drawn to you, zooming in along a spark
//   3 Ride the Spark  you and Teasel become a current of lightning racing
//                     on through the world (stopping short of its
//                     doorway): every gem on the way is yours and nothing
//                     can stop you - you pass straight through it all
// Shoal, the giant opal crab (two abilities, for now):
//   1 Crystal Resonance  he hums, and every crystal on the road hums with
//                     him: for ~10 s every gem collected (yours, or one a
//                     companion brings you) counts double
//   2 Living Bulldozer   he charges out ahead, grows larger, and for ~15 s
//                     smashes every breakable row of obstacles off the road
//                     with his great claw as it reaches him - barriers
//                     tumbling outward, bars swept aside, the wreckage
//                     dissolving - always far enough ahead that you can see
//                     the road he's cleared (a climb, a river, isn't his to
//                     break: he wades through and clambers over)

const P = CONFIG.powers;
const LANES = CONFIG.laneX;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rand = (a, b) => a + Math.random() * (b - a);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export const POWERS = {
  fox: [
    { id: 'haul', name: 'Fox’s Haul', icon: 'paw', tip: 'Sorrel snaps up the gems around you', blurb: `Sorrel darts between lanes snapping up nearby gems for ${P.fox.haul.dur} s, then brings you her haul.` },
    { id: 'treasure', name: 'Buried Treasure', icon: 'dig', tip: 'Sorrel digs up a trail of gems - follow it', blurb: 'Sorrel digs up a bonus gem trail along a safe route ahead - follow it: jumps, slides, dodges and all.' },
    { id: 'lucky', name: 'Lucky Find', icon: 'clover', tip: 'Grab the gem she finds: your gems count double', blurb: `Sorrel unearths a special gem. Take it and gems you collect yourself count double for ${P.fox.lucky.dur} s.` },
  ],
  dragon: [
    { id: 'gift', name: 'Dragon’s Gift', icon: 'wind', tip: 'Iris draws the gems around you in', blurb: `Iris’s flowing mane draws nearby gems to you for ${P.dragon.gift.dur} s.` },
    { id: 'windbreak', name: 'Windbreak', icon: 'gust', tip: 'A gust clears the next row of obstacles', blurb: 'Iris winds up and a gust clears one approaching row of obstacles off the road.' },
    { id: 'fold', name: 'World Fold', icon: 'portal', tip: 'Skip ahead to the next world - once a run', blurb: 'Once a run: Iris opens a portal to the start of the next world. What you skip earns nothing.' },
  ],
  pitcher: [
    { id: 'freshen', name: 'Freshen Up', icon: 'drop', tip: 'Shake off that stumble before the next hit', blurb: 'After a stumble: Pip splashes it away - the second-hit danger gone, back up to pace.' },
    { id: 'roots', name: 'Root Reach', icon: 'roots', tip: 'Pip’s roots fetch the gems up ahead', blurb: 'Pip plants his feet and his roots fetch one cluster of gems ahead, across nearby lanes.' },
    { id: 'shield', name: 'Pitcher Protection', icon: 'shield', tip: `${P.pitcher.shield.dur} s where nothing can hurt you`, blurb: `Pip drenches you: ${P.pitcher.shield.dur} s that nothing can hurt you.` },
  ],
  thistle: [
    { id: 'bolt', name: 'Electric Bolt', icon: 'bolt', tip: 'Wick shocks you: run faster for a while', blurb: `Wick shocks you with a bolt from its crown: you run ${Math.round((P.thistle.bolt.mul - 1) * 100)}% faster for ${P.thistle.bolt.dur} s.` },
    { id: 'attract', name: 'Static Attraction', icon: 'magnet', tip: 'Every gem near you zooms to you', blurb: `For ${P.thistle.attract.dur} s you're charged with static: every gem nearby is drawn to you and zooms in.` },
    { id: 'ride', name: 'Ride the Spark', icon: 'spark', tip: 'Become lightning: every gem is yours, nothing stops you', blurb: 'You and Wick become a current of lightning racing through the world: every gem on the way is yours, and you pass straight through every obstacle.' },
  ],
  crab: [
    { id: 'resonance', name: 'Crystal Resonance', icon: 'crystal', tip: `Every gem counts double for ${P.crab.resonance.dur} s`, blurb: `Otto hums and every gem hums with him: gems collected are worth double for ${P.crab.resonance.dur} s.` },
    { id: 'dozer', name: 'Living Bulldozer', icon: 'claw', tip: 'Otto smashes a clear road ahead of you', blurb: `Otto charges ahead, grows, and spends ${P.crab.dozer.dur} s smashing every breakable obstacle out of your way with his huge claw.` },
  ],
};

// Each ability's cooldown (s); World Fold has none: it's once a run.
export function cooldownOf(id) {
  for (const [pal, list] of Object.entries(POWERS)) if (list.some((d) => d.id === id)) return P[pal][id].cd || 0;
  return 0;
}

export class Powers {
  constructor(game) {
    this.game = game;
    this.cd = {};
    this.active = null;
    this.folded = false;
    this.doubleT = 0;
    this.resT = 0;
  }

  // A new run: everything ready, World Fold too.
  reset() {
    this.stop(true);
    this.cd = {};
    this.folded = false;
    this.doubleT = 0;
    this.resT = 0;
  }

  get pal() {
    const g = this.game;
    return g.companion ? g.companionId : null;
  }

  // The abilities the companion running with you has unlocked, in order.
  list() {
    const id = this.pal;
    if (!id || !POWERS[id]) return [];
    return POWERS[id].slice(0, this.game.progress.level(id));
  }

  // How one stands, for its button: ready (it can be used this moment),
  // cd/cdMax (cooling), on (its effect is the one running: k how much of it
  // is left, 0..1), used (World Fold, spent this run), why (not now: 'busy'
  // another effect is running, 'idle' nothing for it to do yet).
  status(def, out = {}) {
    const g = this.game;
    const A = this.active;
    out.on = !!A && A.def === def;
    out.k = out.on ? A.left() : 0;
    out.cd = this.cd[def.id] || 0;
    out.cdMax = cooldownOf(def.id);
    out.used = def.id === 'fold' && this.folded;
    out.why = '';
    if (out.on || out.cd > 0 || out.used) out.ready = false;
    else if (A) {
      out.ready = false;
      out.why = 'busy';
    } else if (g.state !== 'running') {
      out.ready = false;
      out.why = 'idle';
    } else {
      out.ready = !!H[def.id].ok(this);
      if (!out.ready) out.why = 'idle';
    }
    return out;
  }

  // Use the i-th unlocked ability (its button, or the key 1-3).
  use(i) {
    const def = this.list()[i];
    if (!def) return false;
    const st = this.status(def);
    if (!st.ready) return false;
    const A = { def, t: 0, left: () => 0 };
    if (H[def.id].start(this, A) === false) return false;
    this.active = A;
    const c = this.game.companion;
    if (c && A.drive) {
      c.power = A;
      c.powerBegin?.();
    }
    this.game.ui.powerUsed(i);
    this.game.audio.power?.();
    return true;
  }

  update(dt) {
    const g = this.game;
    const running = g.state === 'running';
    if (running) {
      for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
      this.doubleT = Math.max(0, this.doubleT - dt);
    }
    const A = this.active;
    if (!A || g.state === 'paused') return;
    A.t += dt;
    if (H[A.def.id].step(this, A, dt) === false) this.stop(false);
  }

  // The effect's over (abort: cut short - the run ended, or a new one
  // began): its cooldown starts now.
  stop(abort) {
    const A = this.active;
    if (!A) return;
    this.active = null;
    H[A.def.id].end?.(this, A, abort);
    const c = this.game.companion;
    if (c && c.power === A) c.power = null;
    const cd = cooldownOf(A.def.id);
    if (cd) this.cd[A.def.id] = cd;
  }

  // The runner's gone down: whatever's running ends (and anything owed -
  // Sorrel's haul - is handed over before the card comes up).
  crashed() {
    this.doubleT = 0;
    this.resT = 0;
    this.stop(true);
  }

  // Lucky Find: the gems you take yourself count this many times over.
  get gemMul() {
    return this.doubleT > 0 ? P.fox.lucky.mul : 1;
  }

  // Crystal Resonance: every gem collected counts this many times over,
  // however it comes to you.
  get resMul() {
    return this.resT > 0 ? P.crab.resonance.mul : 1;
  }

  // How much faster than their pace the runner goes (Electric Bolt, Ride the
  // Spark), and the most they may go (m/s) - see Game.update.
  get speedBoost() {
    const A = this.active;
    return A && A.boost ? A.boost : 1;
  }

  get speedCap() {
    const A = this.active;
    return A && A.cap ? A.cap : Infinity;
  }

  // Riding the spark: nothing can hurt the runner, they're not there to be
  // seen - only the current is.
  get riding() {
    const A = this.active;
    return !!A && A.def.id === 'ride' && A.phase !== 'done';
  }

  // Seconds left of a doubling (whichever is running), for the gem counter.
  get doubleLeft() {
    return Math.max(this.doubleT, this.resT);
  }

  // The special gem's been taken by the runner.
  luckyTaken(g) {
    const A = this.active;
    if (!A || A.def.id !== 'lucky' || A.gem !== g) return;
    A.phase = 'double';
    A.t = 0;
    this.doubleT = P.fox.lucky.dur;
    this.game.ui.powerNote('×2 gems!', 'lucky');
    this.game.companion?.cheer?.(2);
  }

  // --- shared bits ------------------------------------------------------------
  get v() {
    return Math.max(this.game.speed, CONFIG.speed.start);
  }

  // The runner's scene position (their feet).
  runnerAt(out) {
    const g = this.game;
    return out.set(g.player.x, g.player.y, -(g.dist - g.origin));
  }

  // A gem's scene position.
  gemAt(gem, out) {
    return out.set(gem.x, gem.y, -(gem.d - this.game.origin));
  }

  // Did a doorway come before d?
  doorBefore(d) {
    const b = this.game.course.boundaryAfter(this.game.dist);
    return !!b && b.d < d;
  }

  // Sorrel goes ahead to (x, d) and digs there: the soil flies.
  digAt(c, x, d) {
    const g = this.game;
    const fx = g.powerFx;
    const z = -(d - g.origin);
    fx.dirt(x, z, 10, 0);
    c.body.snap?.();
  }
}

// --- each ability ----------------------------------------------------------------
// ok(P): can it be used right now (is there anything for it to do)?
// start(P, A): set it going (false: it couldn't, after all); A.drive(c, dt),
// if set, steers the companion while it runs (returning true when it has
// her this frame); A.left() how much of it is left, 0..1, for its button.
// step(P, A, dt): each frame; false when it's over. end(P, A, abort).
const H = {
  // --- Sorrel ---------------------------------------------------------------
  haul: {
    ok: (Pw) => !!Pw.game.companion,
    start(Pw, A) {
      const c = Pw.game.companion;
      const C = P.fox.haul;
      A.haul = [];
      A.target = null;
      A.phase = 'hunt';
      A.back = 0;
      A.left = () => (A.phase === 'hunt' ? 1 - A.t / C.dur : 0.02);
      if (c.ride) c.dismount();
      A.drive = (c, dt) => haulDrive(Pw, A, c, dt);
      c.cheer?.(1.2);
      c.lookFor?.(0.6, 'camera');
    },
    step(Pw, A) {
      if (A.phase === 'hunt' && A.t >= P.fox.haul.dur) {
        A.phase = 'return';
        A.back = 0;
      }
      return A.phase !== 'done';
    },
    end(Pw, A) {
      haulDeliver(Pw, A);
    },
  },

  treasure: {
    ok: (Pw) => {
      const g = Pw.game;
      const C = P.fox.treasure;
      return !Pw.doorBefore(g.dist + Pw.v * (C.ahead[0] + 1.6));
    },
    start(Pw, A) {
      const g = Pw.game;
      const C = P.fox.treasure;
      const v = Pw.v;
      const gems = g.gems.trail(g.dist + v * C.ahead[0], g.dist + v * C.ahead[1], g.player.lane);
      if (gems.length < 3) {
        g.gems.retract(gems);
        g.ui.powerNote('Nothing to dig here', 'nope');
        return false;
      }
      A.gems = gems;
      A.until = gems[gems.length - 1].d;
      A.from = g.dist;
      A.phase = 'dig';
      A.dug = false;
      A.left = () => clamp(1 - (g.dist - A.from) / Math.max(1, A.until - A.from), 0, 1);
      const first = gems[0];
      A.spot = { x: first.x, d: first.d - 1.6 };
      A.drive = (c, dt) => digDrive(Pw, A, c, dt, () => {
        // (each gem pops up out of the soil she throws)
        for (let i = 0; i < Math.min(6, A.gems.length); i++) {
          const gem = A.gems[i];
          g.powerFx.dirt(gem.x, -(gem.d - g.origin), 3, 0);
        }
      });
    },
    step(Pw, A) {
      const g = Pw.game;
      return g.dist < A.until + 1 && A.gems.some((gem) => !gem.taken && gem.d > g.dist - 1);
    },
  },

  lucky: {
    ok: (Pw) => !Pw.doorBefore(Pw.game.dist + Pw.v * (P.fox.lucky.ahead + 0.8)),
    start(Pw, A) {
      const g = Pw.game;
      const C = P.fox.lucky;
      const v = Pw.v;
      const lane = g.player.lane;
      const lanes = [lane, lane === 1 ? 0 : 1, lane === 1 ? 2 : lane === 0 ? 2 : 0];
      let gem = null;
      for (let k = 0; k < 30 && !gem; k++) {
        const d = g.dist + v * C.ahead + k * 1.5;
        if (Pw.doorBefore(d + 3)) break;
        for (const l of lanes) {
          // (somewhere the runner can be standing in that lane: no hurdle
          // or bar right there either)
          if (g.obstacles.records.some((o) => o.lane === l && d > o.d - 2.5 && d < o.d + o.len + 2.5)) continue;
          gem = g.gems.bonus(d, LANES[l], CONFIG.gems.ground, { crown: true, big: 1.75 });
          if (gem) break;
        }
      }
      if (!gem) {
        g.ui.powerNote('Nothing to dig here', 'nope');
        return false;
      }
      gem.lucky = true;
      A.gem = gem;
      A.phase = 'wait';
      A.left = () => (A.phase === 'double' ? Pw.doubleT / C.dur : 1);
      A.spot = { x: gem.x, d: gem.d - 1.2 };
      A.drive = (c, dt) => digDrive(Pw, A, c, dt, () => g.powerFx.dirt(gem.x, -(gem.d - g.origin), 14, 0));
    },
    step(Pw, A) {
      const g = Pw.game;
      if (A.phase === 'double') return Pw.doubleT > 0;
      // missed it (or anyone but the runner took it): that's that
      return !A.gem.taken && A.gem.d > g.dist - 2;
    },
    end(Pw, A, abort) {
      if (abort) Pw.doubleT = 0;
    },
  },

  // --- Iris -----------------------------------------------------------------
  gift: {
    ok: (Pw) => !!Pw.game.companion,
    start(Pw, A) {
      const C = P.dragon.gift;
      A.next = 0;
      A.wisp = 0;
      A.got = 0;
      A.left = () => 1 - A.t / C.dur;
      A.side = Pw.game.companion.x >= Pw.game.player.x ? 1 : -1;
      A.drive = (c) => {
        const g = Pw.game;
        const p = g.player;
        const G = c.goal;
        // close beside you, her mane streaming over you
        const x = clamp(p.x + A.side * 1.55, -3.3, 3.3);
        if (Math.abs(x - p.x) < 1.2) A.side = -A.side;
        G.x = x;
        G.y = 2.15;
        G.dz = 0.9;
        G.wx = 2.6;
        G.wy = 2.4;
        G.wz = 1.8;
        c.swim = 0.75;
        c.cheer(0.3);
        return true;
      };
    },
    step(Pw, A, dt) {
      const g = Pw.game;
      const C = P.dragon.gift;
      const p = g.player;
      const fx = g.powerFx;
      const pz = -(g.dist - g.origin);
      // the gems near you, drawn in one after another (a ripple, not a
      // swallow), each with a breath of wind behind it
      A.next -= dt;
      if (A.next <= 0) {
        let best = null;
        for (const gem of g.gems.gems) {
          if (gem.taken || gem.lucky) continue;
          const a = gem.d - g.dist;
          if (a < -0.4) continue;
          if (a > C.reach) continue;
          if (Math.abs(gem.x - p.x) > C.side || gem.y > 3.4) continue;
          if (!best || gem.d < best.d) best = gem;
        }
        if (best) {
          A.next = 0.045;
          A.got++;
          const gz = -(best.d - g.origin);
          const vx = (p.x - best.x) * 2.2, vy = (p.y + 0.9 - best.y) * 2, vz = (pz - gz) * 1.4 - g.speed;
          fx.emit(best.x, best.y, gz, vx, vy, vz, 0.32, 4, 0.22, 0.55, 0.8);
          g.creditGem(best, 'pulled');
        }
      }
      // and the wind itself, restrained: now and then a wisp streaming back
      // past you off her mane
      A.wisp -= dt;
      if (A.wisp <= 0) {
        A.wisp = 0.11;
        const c = g.companion;
        const s = Math.random() < 0.5 ? -1 : 1;
        const hx = c ? c.x : p.x + s;
        fx.emit(hx + rand(-0.4, 0.4), (c ? c.y : 2) + rand(-0.5, 0.2), pz - rand(0.5, 2.5), (p.x - hx) * 0.8 + s * 0.4, -0.3, g.speed * 0.25 - g.speed, 0.26, 4, 0.16, 0.7, 1.4);
      }
      return A.t < C.dur;
    },
  },

  windbreak: {
    ok: (Pw) => !!windRow(Pw),
    start(Pw, A) {
      const g = Pw.game;
      const C = P.dragon.windbreak;
      const row = windRow(Pw);
      if (!row) return false;
      A.row = row;
      A.phase = 'windup';
      A.left = () => (A.phase === 'windup' ? 1 : clamp(1 - (A.t - C.windup) / 0.5, 0, 1));
      const p = g.player;
      A.side = p.x > 0.4 ? -1 : p.x < -0.4 ? 1 : Math.random() < 0.5 ? -1 : 1;
      A.drive = (c) => {
        const G = c.goal;
        // up ahead of you over the middle of the road, rearing back to draw
        // breath, her eyes on the row
        const ahead = A.row.d - g.dist;
        G.x = clamp(-A.side * 0.9, -2.4, 2.4);
        G.y = A.phase === 'windup' ? 2.9 : 2.4;
        G.dz = clamp(ahead - 7, 1.8, 7.5);
        G.wx = 3;
        G.wy = 3;
        G.wz = 2.6;
        c.swim = A.phase === 'windup' ? 0.45 : 1.2;
        c.lookFor(0.3, { x: 0, y: 1, dz: ahead });
        return true;
      };
      g.companion?.cheer(1);
      g.audio.gust?.(0);
    },
    step(Pw, A, dt) {
      const g = Pw.game;
      const C = P.dragon.windbreak;
      const fx = g.powerFx;
      const c = g.companion;
      const pz = -(g.dist - g.origin);
      const rz = -(A.row.d - g.origin);
      if (A.phase === 'windup') {
        // drawing breath: the air round her head gathers in
        if (c && Math.random() < dt * 30) {
          const hz = pz - c.dz;
          const a = Math.random() * Math.PI * 2;
          fx.emit(c.x + Math.cos(a) * 1.4, c.y + Math.sin(a) * 1.0, hz + rand(-0.6, 0.6), -Math.cos(a) * 2.6, -Math.sin(a) * 2.2, -g.speed, 0.22, 4, 0.3, 0.45, 0.6);
        }
        if (A.t >= C.windup) {
          A.phase = 'gust';
          g.obstacles.blow(A.row, g.time, A.side, C.blow);
          c?.body.snap?.();
          g.audio.gust?.(1);
          // the gust: from her, down the road and out over the row, and the
          // air tearing off it sideways
          const hx = c ? c.x : 0, hy = c ? c.y : 2.5, hz = c ? pz - c.dz : pz - 3;
          for (let i = 0; i < 16; i++) {
            const k = i / 15;
            fx.emit(hx, hy, hz, (k - 0.5) * 7, -0.8 - Math.random(), -(Math.abs(rz - hz) / 0.35) * 0.5 - g.speed * 0.2, 0.4, 4, 0.34, 0.7, 1.6);
          }
          for (const x of LANES) {
            for (let i = 0; i < 3; i++) fx.emit(x, 0.6 + i * 0.8, rz, A.side * rand(5, 9), rand(0.5, 1.6), rand(-1, 1), 0.5, 4, 0.32, 0.9, 1.8);
          }
        }
        return true;
      }
      return A.t < C.windup + 0.5;
    },
  },

  fold: {
    ok: (Pw) => {
      const g = Pw.game;
      if (Pw.folded || g.portal.active || g.warp.active || g.splash.active) return false;
      const b = g.course.boundaryAfter(g.dist + 1);
      if (!b || b.d - g.dist <= P.dragon.fold.minDoor) return false;
      // (only into a world that's ready to be seen: if it's still being
      // prepared - a moment into a world, at most - it's hurried along,
      // and the portal opens once it is)
      if (!b.to.world.ready) {
        g.prepareWorld(b.to.world, 3);
        return false;
      }
      return true;
    },
    start(Pw, A) {
      const g = Pw.game;
      const b = g.course.boundaryAfter(g.dist + 1);
      if (!b) return false;
      Pw.folded = true;
      A.to = b;
      A.phase = 'open';
      A.left = () => (A.phase === 'open' ? 1 : clamp(1 - (A.t - P.dragon.fold.windup) / 0.7, 0, 1));
      g.folding = true;
      g.ui.fold('in', b.to.world.def.doorColor);
      g.audio.gust?.(2);
      A.drive = (c) => {
        const G = c.goal;
        // out ahead and up, where she opens the way
        G.x = 0;
        G.y = 2.7;
        G.dz = A.phase === 'open' ? 6.5 : 2.5;
        G.wx = G.wy = 3;
        G.wz = 2.5;
        c.swim = 1.3;
        c.cheer(1);
        return true;
      };
    },
    step(Pw, A) {
      const g = Pw.game;
      const C = P.dragon.fold;
      if (A.phase === 'open' && A.t >= C.windup) {
        A.phase = 'through';
        g.foldTo(A.to);
        g.folding = false;
        g.ui.fold('out', A.to.to.world.def.doorColor);
      }
      return A.phase === 'open' || A.t < C.windup + 0.7;
    },
    end(Pw, A) {
      const g = Pw.game;
      if (A.phase === 'open') {
        // (cut short before she got there: the screen's given back as it was)
        g.folding = false;
        g.ui.fold('off');
      }
    },
  },

  // --- Nep -------------------------------------------------------------------
  freshen: {
    ok: (Pw) => Pw.game.state === 'running' && Pw.game.stumbleWindow > 0,
    start(Pw, A) {
      const g = Pw.game;
      g.freshen();
      A.left = () => clamp(1 - A.t / 0.5, 0, 1);
      const c = g.companion;
      if (c?.fxT) c.fxT.shake = 0.9;
      c?.cheer?.(1.4);
      c?.lookFor?.(0.9, 'runner');
      // the water, flung over the runner from his side
      const fx = g.powerFx;
      const p = g.player;
      const pz = -(g.dist - g.origin);
      const s = c ? Math.sign(c.x - p.x) || 1 : 1;
      for (let i = 0; i < 26; i++) {
        fx.emit(p.x + s * rand(0.3, 0.9), p.y + rand(1.2, 2.1), pz + rand(-0.4, 0.4), -s * rand(1, 3.5), rand(0.5, 2.5), -g.speed * 0.95 + rand(-1, 1), rand(0.06, 0.12), 6);
      }
      for (let i = 0; i < 4; i++) fx.emit(p.x + rand(-0.4, 0.4), p.y + rand(0.6, 1.5), pz, -s * 0.8, 0.2, -g.speed * 0.9, 0.42, 3, 0.5, 0.7, 1.2);
      g.audio.splash();
    },
    step: (Pw, A) => A.t < 0.5,
  },

  roots: {
    ok: (Pw) => rootCluster(Pw).length > 0,
    start(Pw, A) {
      const g = Pw.game;
      const gems = rootCluster(Pw);
      if (!gems.length) return false;
      A.gems = gems;
      A.phase = 'plant';
      A.pt = 0;
      A.left = () => clamp(1 - A.t / 1.7, 0, 1);
      const c = g.companion;
      A.drive = (c, dt) => {
        const G = c.goal;
        const p = g.player;
        if (A.phase === 'plant' || A.phase === 'reach' || A.phase === 'pull') {
          // feet planted: he lets the road carry him back a little
          G.x = c.x;
          G.dz = Math.max(c.C.behind + 0.4, c.dz - 0.5);
          G.w = 2;
          G.wz = 0.9;
          G.low = 1;
          c.lookT = Math.max(c.lookT, 0.2);
          const gem = A.gems[0];
          c.lookAt = { x: gem.x, y: gem.y, dz: gem.d - g.dist };
        } else {
          // and scrambles back up to you, flailing, soil flying off him
          const side = c.x >= p.x ? 1 : -1;
          G.x = clamp(p.x + side * 1.4, -3, 3);
          G.dz = 1.2;
          G.w = 6;
          G.wz = 4;
          G.low = 0;
          G.urgent = true;
          if (c.fxT) c.fxT.flail = 0.3;
          if (Math.random() < dt * 14) g.powerFx.dirt(c.x, -(g.dist - g.origin) - c.dz, 2, g.speed);
        }
        return true;
      };
      if (c) {
        c.cheer?.(1);
        g.powerFx.dirt(c.x, -(g.dist - g.origin) - c.dz, 8, g.speed);
      }
    },
    step(Pw, A, dt) {
      const g = Pw.game;
      const fx = g.powerFx;
      const c = g.companion;
      A.pt += dt;
      const T = { plant: 0.22, reach: 0.34, pull: 0.3, scramble: 0.7 };
      if (A.pt >= T[A.phase]) {
        A.pt = 0;
        if (A.phase === 'plant') A.phase = 'reach';
        else if (A.phase === 'reach') {
          A.phase = 'pull';
          // got them: each torn up out of the ground and sent to you
          for (const gem of A.gems) {
            if (gem.taken) continue;
            fx.dirt(gem.x, -(gem.d - g.origin), 4, 0);
            g.creditGem(gem, true);
          }
          g.audio.gemRun();
        } else if (A.phase === 'pull') {
          A.phase = 'scramble';
          fx.hideRoots();
        } else return false;
      }
      // the roots: out of the ground under him, each after its gem
      if (c && (A.phase === 'reach' || A.phase === 'pull')) {
        const k = A.phase === 'reach' ? A.pt / T.reach : 1 - A.pt / T.pull;
        const ez = k * k * (3 - 2 * k);
        _a.set(c.x, 0.06, -(g.dist - g.origin) - c.dz);
        A.gems.forEach((gem, i) => {
          if (A.phase === 'reach' && gem.taken) return fx.root(i, _a, _a, 0, false);
          // (pulling back, they come home to him)
          Pw.gemAt(gem, _b);
          if (A.phase === 'pull') _b.lerp(_a, 1 - ez);
          fx.root(i, _a, _b, A.phase === 'reach' ? ez : 1, A.phase === 'pull');
        });
      }
      return true;
    },
    end(Pw) {
      Pw.game.powerFx.hideRoots();
    },
  },

  shield: {
    ok: (Pw) => Pw.game.state === 'running',
    start(Pw, A) {
      const g = Pw.game;
      const C = P.pitcher.shield;
      g.shieldT = C.dur;
      A.drop = 0;
      A.splash = 0;
      A.left = () => g.shieldT / C.dur;
      const c = g.companion;
      if (c?.fxT) c.fxT.shake = 0.9;
      c?.cheer?.(C.dur);
      c?.lookFor?.(1, 'runner');
      g.audio.splash();
      // drenched: a wave of it over them
      const fx = g.powerFx;
      const p = g.player;
      const pz = -(g.dist - g.origin);
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2;
        fx.emit(p.x + Math.cos(a) * 0.3, p.y + rand(1.6, 2.3), pz + Math.sin(a) * 0.3, Math.cos(a) * rand(0.8, 2.2), rand(0.4, 2), -g.speed * 0.95 + Math.sin(a), rand(0.06, 0.12), 6);
      }
    },
    step(Pw, A, dt) {
      const g = Pw.game;
      const C = P.pitcher.shield;
      const fx = g.powerFx;
      const p = g.player;
      g.shieldT = Math.max(0, g.shieldT - dt);
      const left = g.shieldT;
      // the coat: full while it holds, thinning out (and the water running
      // off it slower) over its last stretch, gone as the protection goes
      const fade = clamp(left / C.fade, 0, 1);
      const shimmer = fade < 1 ? 0.85 + 0.15 * Math.sin(g.time * 18) : 1;
      const a = Math.min(1, A.t / 0.2) * fade * shimmer;
      const h = p.height;
      const pz = -(g.dist - g.origin);
      fx.coat(p.x, p.y + h * 0.5, pz, 0.62, h * 0.62 + 0.14, a, 0.5 + 0.5 * fade);
      // drops running down it and off them...
      A.drop -= dt * (8 + 26 * fade);
      while (A.drop <= 0) {
        A.drop += 1;
        const ang = Math.random() * Math.PI * 2;
        const up = Math.random();
        fx.emit(p.x + Math.cos(ang) * 0.5 * (1 - up * 0.4), p.y + h * (0.35 + 0.6 * up), pz + Math.sin(ang) * 0.4, Math.cos(ang) * rand(0.1, 0.6), rand(-0.6, 0.4), -g.speed * 0.97 + Math.sin(ang) * 0.4, rand(0.04, 0.075), 6);
      }
      // ...and little splashes where they run, kicked up off their feet
      A.splash -= dt;
      if (A.splash <= 0 && p.grounded) {
        A.splash = 0.2 + Math.random() * 0.08;
        const s = Math.random() < 0.5 ? -1 : 1;
        fx.emit(p.x + s * 0.18, 0.06, pz + 0.1, s * 0.6, 0.6, -g.speed * 0.6, 0.3 * (0.5 + 0.5 * fade), 3, 0.45 * fade, 0.55, 1.1);
        for (let i = 0; i < 3; i++) fx.emit(p.x + s * 0.18, 0.08, pz, s * rand(0.4, 1.8), rand(1.2, 2.6), -g.speed * 0.7 + rand(-0.6, 0.6), rand(0.035, 0.06), 2);
      }
      return left > 0;
    },
    end(Pw) {
      const g = Pw.game;
      g.powerFx.coat(0, 0, 0, 1, 1, 0);
      g.endShield();
    },
  },

  // --- Teasel ----------------------------------------------------------------
  bolt: {
    ok: (Pw) => Pw.game.state === 'running' && !!Pw.game.companion,
    start(Pw, A) {
      const g = Pw.game;
      const C = P.thistle.bolt;
      const c = g.companion;
      A.boost = 1;
      A.strike = 0;
      A.crawl = 0;
      A.left = () => clamp(1 - A.t / C.dur, 0, 1);
      // the strike: from its crown into you
      A.from = new THREE.Vector3();
      if (c?.body?.crown) c.body.crown.point(0, 0, c.body.crownM || c.body.root.matrixWorld, A.from);
      else Pw.runnerAt(A.from).add(_a.set(1.5, 0.6, -1));
      c?.cheer(2);
      c?.lookFor(0.8, 'runner');
      if (c?.body) c.body.spike = 1;
      g.audio.zap?.(clamp((c?.x ?? 0) / 3, -1, 1), true);
      g.cam.kick(0.3);
      g.ui.strike?.();
      g.ui.powerNote('Electric Bolt!', 'thistle');
      const tr = { x: g.player.x, y: 0, d: g.dist };
      c?.body?.impact?.(tr, 0.9);
      sparkBurst(Pw, 18);
      A.overlay = (Ar, Gl, z, dist, dt, b) => {
        const p = g.player;
        _b.set(p.x, p.y + p.height * 0.6, z);
        // the strike itself, a moment, flickering
        if (A.t < 0.3) {
          const br = A.t < 0.08 ? 1.4 : (1 - A.t / 0.3) * (0.4 + 0.8 * Math.random());
          if (c) b.crown?.point(0, 0, b.crownM || b.root.matrixWorld, A.from);
          const pts = jag(A.from, _b, 12, 0.07, 0.25, tmpPts(12));
          Ar.add(pts, 12, 0.07, br);
          const pts2 = jag(A.from, _b, 9, 0.12, 0.35, tmpPts(9, 1));
          Ar.add(pts2, 9, 0.03, br * 0.7);
          Gl.add(_b, 0.6, br * 0.5, false, 0.8);
        }
        // and the charge crawling over you as you go, a glow round you
        crawl(Ar, Gl, g, z, A.boost > 1.05 ? 1 : 0.4, A.boost > 1.05 ? 4 : 2);
        if (A.boost > 1.05) Gl.add(_b, 0.85, 0.14 + 0.06 * Math.random(), false, 0.2);
      };
      if (c?.body) c.body.overlay = A.overlay;
    },
    step(Pw, A, dt) {
      const C = P.thistle.bolt;
      const k = Math.min(1, A.t / 0.35) * clamp((C.dur - A.t) / C.fade, 0, 1);
      A.boost = 1 + (C.mul - 1) * k;
      // sparks flicking off your feet as you run
      A.crawl -= dt;
      if (A.crawl <= 0) {
        A.crawl = 0.09;
        sparkBurst(Pw, 2);
      }
      return A.t < C.dur;
    },
    end(Pw, A) {
      A.boost = 1;
      clearOverlay(Pw, A);
    },
  },

  attract: {
    ok: (Pw) => Pw.game.state === 'running',
    start(Pw, A) {
      const g = Pw.game;
      const C = P.thistle.attract;
      A.next = 0;
      A.arcs = [];
      A.left = () => clamp(1 - A.t / C.dur, 0, 1);
      const c = g.companion;
      c?.cheer(C.dur);
      if (c?.body) c.body.spike = 1;
      g.ui.powerNote('Static Attraction', 'thistle');
      g.audio.zap?.(0);
      sparkBurst(Pw, 14);
      A.overlay = (Ar, Gl, z, dist, dt) => {
        const p = g.player;
        // each gem's spark, from it to you, flickering out
        for (let i = A.arcs.length - 1; i >= 0; i--) {
          const s = A.arcs[i];
          s.t += dt;
          if (s.t > 0.22) {
            A.arcs.splice(i, 1);
            continue;
          }
          _a.set(s.x, s.y, -(s.d - g.origin));
          _b.set(p.x, p.y + p.height * 0.55, z);
          const pts = jag(_a, _b, 9, 0.08, 0.1, tmpPts(9));
          Ar.add(pts, 9, 0.05, (1.3 - s.t * 4) * (0.6 + 0.5 * Math.random()), clamp(s.t / 0.16, 0, 1), 0.12);
          if (s.t < 0.06) Gl.add(_a, 0.35, 0.6, false, 0.7);
        }
        // charged: a halo of it round you, crackling
        crawl(Ar, Gl, g, z, 0.7, 2);
        _b.set(p.x, p.y + p.height * 0.55, z);
        Gl.add(_b, 0.9, 0.12 + 0.05 * Math.sin(g.time * 23), false, 0);
      };
      if (c?.body) c.body.overlay = A.overlay;
    },
    step(Pw, A, dt) {
      const g = Pw.game;
      const C = P.thistle.attract;
      const p = g.player;
      A.next -= dt;
      // the nearest gem in reach, one after another (quicker when there are
      // many), each with its spark
      while (A.next <= 0) {
        let best = null;
        for (const gem of g.gems.gems) {
          if (gem.taken || gem.lucky) continue;
          const a = gem.d - g.dist;
          if (a < -1.5 || a > C.reach || Math.abs(gem.x - p.x) > C.side || gem.y > C.high) continue;
          if (!best || gem.d < best.d) best = gem;
        }
        if (!best) {
          A.next = 0.05;
          break;
        }
        A.next += C.every;
        A.arcs.push({ x: best.x, y: best.y, d: best.d, t: 0 });
        if (A.arcs.length > 14) A.arcs.shift();
        g.creditGem(best, 'pulled');
      }
      return A.t < C.dur;
    },
    end(Pw, A) {
      clearOverlay(Pw, A);
    },
  },

  ride: {
    ok: (Pw) => {
      const g = Pw.game;
      if (g.state !== 'running' || !g.companion || g.portal.active || g.warp.active || g.splash.active) return false;
      const b = g.course.boundaryAfter(g.dist + 1);
      return !b || b.d - g.dist > P.thistle.ride.door + 40;
    },
    start(Pw, A) {
      const g = Pw.game;
      const C = P.thistle.ride;
      const c = g.companion;
      A.phase = 'ride';
      A.boost = 1;
      A.cap = C.max;
      A.got = 0;
      A.left = () => (A.phase === 'ride' ? clamp(1 - A.t / C.dur, 0, 1) : 0.02);
      A.trail = [];
      A.door = g.course.boundaryAfter(g.dist + 1);
      // (the world beyond is hurried along: you'll be at its door sooner)
      if (A.door && !A.door.to.world.ready) g.prepareWorld(A.door.to.world, 3);
      g.ui.powerNote('Ride the Spark!', 'thistle');
      g.ui.strike?.();
      g.cam.kick(0.45);
      g.audio.zap?.(0, true);
      c?.body?.impact?.({ x: g.player.x, y: 0, d: g.dist }, 1.3);
      if (c?.body) c.body.impact({ x: c.x, y: 0, d: g.dist + c.dz }, 1);
      sparkBurst(Pw, 30);
      // (it goes into the current with you: at your side, out of sight)
      A.drive = (c) => {
        const G = c.goal;
        G.x = g.player.x;
        G.dz = 0;
        G.w = 30;
        G.wz = 8;
        G.low = 0;
        if (A.phase !== 'ride') {
          // coming out: beside you again
          const side = g.player.x > 0 ? -1 : 1;
          G.x = clamp(g.player.x + side * 2.4, -2.4, 2.4);
          G.dz = 1.5;
        }
        return true;
      };
      if (c?.body) {
        c.body.hide = true;
        c.body.charge = 1;
      }
      A.overlay = (Ar, Gl, z, dist, dt, b) => rideOverlay(Pw, A, Ar, Gl, z, dt, b);
      if (c?.body) c.body.overlay = A.overlay;
    },
    step(Pw, A, dt) {
      const g = Pw.game;
      const C = P.thistle.ride;
      const c = g.companion;
      const p = g.player;
      if (A.phase === 'ride') {
        A.boost = 1 + (C.mul - 1) * Math.min(1, A.t / 0.3);
        // every gem on the way is yours, whatever lane it's in
        for (const gem of g.gems.gems) {
          if (gem.taken || gem.lucky) continue;
          if (gem.d < g.prevDist - 2 || gem.d > g.dist + 3) continue;
          g.creditGem(gem, 'pulled');
          A.got++;
        }
        // (and now and then it strikes the road as it goes)
        if (c?.body && Math.random() < dt * 9) c.body.impact({ x: p.x + rand(-0.6, 0.6), y: 0, d: g.dist + rand(-1, 2) }, 0.55);
        const door = A.door && A.door.d - g.dist < C.door;
        if (A.t >= C.dur || door) {
          A.phase = 'out';
          A.outT = 0;
          g.ui.powerNote(`Rode the spark · ${A.got} ${A.got === 1 ? 'gem' : 'gems'}`, 'thistle');
        }
      } else if (A.phase === 'out') {
        A.outT += dt;
        A.boost = 1 + (C.mul - 1) * (1 - smoothK(A.outT / C.out));
        // gems still under you as you slow
        for (const gem of g.gems.gems) {
          if (!gem.taken && !gem.lucky && gem.d > g.prevDist - 2 && gem.d < g.dist + 2) g.creditGem(gem, 'pulled');
        }
        if (A.outT >= C.out * 0.4 && !A.back) {
          // you again - and it, beside you, arriving as it does through a
          // spark - and a moment's grace to find your feet
          A.back = true;
          p.invulnT = Math.max(p.invulnT || 0, C.guard);
          g.cam.kick(0.3);
          g.audio.zap?.(0, true);
          if (c?.body) {
            c.body.hide = false;
            c.x = clamp(p.x + (p.x > 0 ? -2.4 : 2.4), -2.4, 2.4);
            c.dz = 1.5;
            c.vdz = 0;
            c.vx = 0;
            c.body.flash = 1;
            c.body.brace = 1;
            c.body.impact({ x: c.x, y: 0, d: g.dist + c.dz }, 1.2);
            c.body.impact({ x: p.x, y: 0, d: g.dist }, 1);
            c.cheer(2);
            c.lookFor(1, 'runner');
          }
          sparkBurst(Pw, 26);
        }
        if (A.outT >= C.out) {
          A.phase = 'done';
          return false;
        }
      }
      return true;
    },
    end(Pw, A) {
      const g = Pw.game;
      const c = g.companion;
      A.boost = 1;
      A.phase = 'done';
      if (c?.body) c.body.hide = false;
      g.player.root.visible = true;
      clearOverlay(Pw, A);
    },
  },

  // --- Shoal -----------------------------------------------------------------
  resonance: {
    ok: (Pw) => Pw.game.state === 'running',
    start(Pw, A) {
      const g = Pw.game;
      const C = P.crab.resonance;
      Pw.resT = C.dur;
      A.pulse = 0.25;
      A.shim = 0;
      A.left = () => Pw.resT / C.dur;
      g.ui.powerNote(`×${C.mul} gems · Crystal Resonance`, 'crab');
      g.audio.resonance?.();
      const c = g.companion;
      if (c) {
        c.cheer(C.dur);
        c.lookFor(1.2, 'runner');
        c.body.wave?.();
        c.body.tiltNow?.(c.x > g.player.x ? -1 : 1, 1);
      }
      // (close beside you, level with you, humming)
      A.drive = (c) => {
        const p = g.player;
        const G = c.goal;
        const lane = c.laneOf(p.x);
        const mine = c.laneOf(c.x);
        const l = mine !== lane ? mine : lane === 1 ? (c.x > p.x ? 2 : 0) : 1;
        G.x = CONFIG.laneX[l];
        G.dz = 0.9;
        G.w = 3;
        G.wz = 1.4;
        G.low = 0;
        if (Math.random() < 0.01) c.lookFor(0.9, Math.random() < 0.5 ? 'runner' : 'camera');
        return true;
      };
    },
    step(Pw, A, dt) {
      const g = Pw.game;
      const fx = g.powerFx;
      const c = g.companion;
      if (g.state === 'running') Pw.resT = Math.max(0, Pw.resT - dt);
      const fade = Math.min(1, A.t / 0.4) * Math.min(1, Pw.resT / 0.8);
      if (c) c.body.resonate = fade;
      // a pulse of it off him every so often: a ring of opal glints
      A.pulse -= dt;
      const pz = -(g.dist - g.origin);
      if (A.pulse <= 0 && c) {
        A.pulse = 0.85;
        const cz = pz - c.dz;
        const sc = c.body.scale || 1;
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
          fx.emit(c.x + Math.cos(a) * 0.5 * sc, 0.5 * sc + Math.random() * 0.3, cz + Math.sin(a) * 0.5 * sc, Math.cos(a) * 3.2, 1.6 + Math.random() * 1.2, -g.speed + Math.sin(a) * 3.2, 0.05 + Math.random() * 0.03, 7);
        }
        g.audio.hum?.();
      }
      // and every gem ahead of you ringing with him: glints rising off them
      A.shim -= dt;
      while (A.shim <= 0) {
        A.shim += 0.03;
        let n = 0, pickG = null;
        for (const gem of g.gems.gems) {
          if (gem.taken) continue;
          const a = gem.d - g.dist;
          if (a < 0 || a > 30) continue;
          n++;
          if (Math.random() * n < 1) pickG = gem;
        }
        if (pickG) fx.emit(pickG.x + rand(-0.15, 0.15), pickG.y + rand(-0.1, 0.25), -(pickG.d - g.origin), rand(-0.4, 0.4), rand(0.8, 1.6), rand(-0.3, 0.3), rand(0.04, 0.07), 7);
      }
      return Pw.resT > 0;
    },
    end(Pw, A, abort) {
      if (abort) Pw.resT = 0;
      const c = Pw.game.companion;
      if (c) c.body.resonate = 0;
    },
  },

  dozer: {
    ok: (Pw) => Pw.game.state === 'running' && !!Pw.game.companion,
    start(Pw, A) {
      const g = Pw.game;
      const C = P.crab.dozer;
      A.phase = 'charge';
      A.struck = new Set();
      A.pending = [];
      A.swing = 1;
      A.smashed = 0;
      A.left = () => (A.phase === 'back' ? 0.02 : clamp(1 - A.t / C.dur, 0, 1));
      A.drive = (c, dt) => dozerDrive(Pw, A, c, dt);
      const c = g.companion;
      c.cheer(2);
      c.lookFor(0.8, 'camera');
      g.ui.powerNote('Living Bulldozer!', 'crab');
      g.audio.smash?.(0, true);
    },
    step(Pw, A, dt) {
      const g = Pw.game;
      const C = P.crab.dozer;
      const c = g.companion;
      if (!c) return false;
      const b = c.body;
      if (A.phase === 'charge' && A.t > 0.7) A.phase = 'doze';
      if (A.phase === 'doze' && A.t >= C.dur) {
        A.phase = 'back';
        A.back = 0;
        g.ui.powerNote(`Otto cleared ${A.smashed} ${A.smashed === 1 ? 'row' : 'rows'}`, 'crab');
        c.cheer(2);
      }
      // he grows into it, and back down after
      b.dozer = A.phase === 'back' ? 0 : Math.min(1, A.t / 0.6);
      if (A.phase !== 'back') {
        // every breakable row reaching his claw, struck as it does (the claw
        // swung through a beat before it lands)
        const sc = b.scale || 1;
        const front = g.dist + c.dz + C.reach * sc + g.speed * 0.16;
        for (const row of g.obstacles.rows) {
          if (row.d > front) break;
          if (row.d + 0.5 < g.dist || A.struck.has(row)) continue;
          if (row.climb || row.high || row.river) continue;
          if (!row.lanes.some((r) => r && !r.group.dead && !r.group.blown)) continue;
          A.struck.add(row);
          A.pending.push({ row, at: A.t + 0.16, dir: A.swing });
          b.smash(A.swing);
          A.swing = -A.swing;
        }
      }
      for (let i = A.pending.length - 1; i >= 0; i--) {
        const S = A.pending[i];
        if (A.t < S.at) continue;
        A.pending.splice(i, 1);
        smashRow(Pw, A, S.row, S.dir);
      }
      if (A.phase === 'back') {
        A.back += dt;
        return A.back < 1.2 || A.pending.length > 0;
      }
      return true;
    },
    end(Pw, A) {
      for (const S of A.pending) smashRow(Pw, A, S.row, S.dir);
      A.pending.length = 0;
      const c = Pw.game.companion;
      if (c) c.body.dozer = 0;
    },
  },
};

// --- Teasel's lightning ---------------------------------------------------------------
// (drawn with Teasel's own arcs and glows: its body calls the ability's
// overlay each frame - see thistle.js - and lights it as it lights its own)
const VIOLET = [0.72, 0.5, 1.0];
const WHITE = [1.0, 0.95, 1.0];
const _UP = new THREE.Vector3(0, 1, 0);
const _j1 = new THREE.Vector3();
const _j2 = new THREE.Vector3();
const _jd = new THREE.Vector3();
const _ja = new THREE.Vector3();
const _jb = new THREE.Vector3();
// A crooked line from a to b: n points, each step knocked aside (most in the
// middle), arched up by arch (m), into out.
function jag(a0, b0, n, rough, arch, out) {
  const a = _ja.copy(a0), b = _jb.copy(b0);
  _jd.subVectors(b, a);
  const L = _jd.length() || 1e-3;
  _j1.crossVectors(_jd, _UP);
  if (_j1.lengthSq() < 1e-8) _j1.set(1, 0, 0);
  _j1.normalize();
  _j2.crossVectors(_j1, _jd).normalize();
  let ox = 0, oy = 0;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const env = Math.sin(Math.PI * t);
    ox = ox * 0.4 + (Math.random() - 0.5) * 2 * rough * L;
    oy = oy * 0.4 + (Math.random() - 0.5) * 2 * rough * L;
    out[k].copy(a).lerp(b, t).addScaledVector(_j1, ox * env).addScaledVector(_j2, oy * env).addScaledVector(_UP, arch * env);
  }
  return out;
}
const _pts = [[], []];
function tmpPts(n, which = 0) {
  const a = _pts[which];
  while (a.length < n) a.push(new THREE.Vector3());
  return a;
}
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const smoothK = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

// Little arcs crawling over the runner (k: how many, how bright).
function crawl(Ar, Gl, g, z, k, n) {
  const p = g.player;
  for (let i = 0; i < n; i++) {
    if (Math.random() > k) continue;
    const h = p.height * (0.15 + 0.8 * Math.random());
    const a0 = Math.random() * Math.PI * 2;
    const a1 = a0 + (Math.random() - 0.5) * 2.2;
    const r = 0.28;
    _c.set(p.x + Math.cos(a0) * r, p.y + h, z + Math.sin(a0) * r);
    _d.set(p.x + Math.cos(a1) * r, p.y + h + (Math.random() - 0.5) * 0.6, z + Math.sin(a1) * r);
    const pts = jag(_c, _d, 6, 0.3, 0.02, tmpPts(6, 1));
    Ar.add(pts, 6, 0.026, 1.1 + 0.5 * Math.random());
  }
}

// Sparks flung off the runner (Teasel's own violet and white).
function sparkBurst(Pw, n) {
  const g = Pw.game;
  const b = g.companion?.body;
  if (!b?.sparkW) return;
  const p = g.player;
  const z = -(g.dist - g.origin);
  for (let i = 0; i < n; i++) {
    _c.set(p.x + rand(-0.25, 0.25), p.y + rand(0.05, p.height), z + rand(-0.2, 0.2));
    _d.set(rand(-2.5, 2.5), rand(1, 3.5), rand(-1, 2) + g.speed * 0.2);
    b.sparkW(_c, _d, rand(0.04, 0.08), i % 3 ? VIOLET : WHITE);
  }
}

function clearOverlay(Pw, A) {
  const b = Pw.game.companion?.body;
  if (b && b.overlay === A.overlay) b.overlay = null;
}

// The current you ride as: a thick crooked channel of lightning running
// along the road where you are, its head bright at your chest, its tail
// streaming back behind you; two more strands wandering round it, forks
// lashing out to the air and down to the road; a ball of light at its head
// and a glow all along it. Coming out of it, it shrinks into you.
function rideOverlay(Pw, A, Ar, Gl, z, dt, b) {
  const g = Pw.game;
  const p = g.player;
  const C = P.thistle.ride;
  if (A.phase === 'done' || A.back) {
    if (A.back && A.outT < C.out) crawl(Ar, Gl, g, z, 1, 3);
    return;
  }
  const out = A.phase === 'out' ? smoothK(A.outT / (C.out * 0.4)) : 0;
  // (short: its tail stays well in front of the camera)
  const len = (1.6 + Math.min(2.6, g.speed * 0.05)) * (1 - out);
  const y = p.y + 0.85;
  _c.set(p.x, y, z - 0.5);
  _d.set(p.x - p.vx * 0.05, y - 0.15, z + len);
  const n = 14;
  const pts = jag(_c, _d, n, 0.04, 0.08, tmpPts(n));
  const br = 1.3 * (0.8 + 0.4 * Math.random());
  Ar.add(pts, n, 0.15, br, (g.time * 3) % 1, 0.1);
  for (let s = 0; s < 2; s++) {
    const p2 = jag(_c, _d, 10, 0.08, 0.18 * (s ? -1 : 1), tmpPts(10, 1));
    Ar.add(p2, 10, 0.05, br * 0.7);
  }
  // where you were: a figure of crackling light, road to head height
  for (let s = 0; s < 3; s++) {
    _a.set(p.x + rand(-0.18, 0.18), p.y + 0.02, z + rand(-0.15, 0.15));
    _b.set(p.x + rand(-0.12, 0.12), p.y + (1.45 + rand(-0.1, 0.15)) * (1 - out * 0.7), z + rand(-0.15, 0.15));
    const p4 = jag(_a, _b, 8, 0.14, 0, tmpPts(8, 1));
    Ar.add(p4, 8, 0.045, br * (0.7 + 0.3 * Math.random()));
  }
  // forks to the road and the air
  for (let f = 0; f < 4; f++) {
    const k = 2 + Math.floor(Math.random() * (n - 4));
    const q = pts[k];
    const down = Math.random() < 0.55;
    _a.set(q.x + rand(-0.8, 0.8), down ? 0.02 : q.y + rand(0, 0.7), q.z + rand(-0.4, 0.4));
    const p3 = jag(q, _a, 6, 0.3, 0, tmpPts(6, 1));
    Ar.add(p3, 6, 0.04, br * 0.8);
    if (down) Gl.add(_a, 0.3, 0.5, true, 0.5);
  }
  // its head, and the light it throws
  _a.set(p.x, y, z);
  Gl.add(_a, 0.8, 1.2, false, 0.95);
  _a.copy(_c).lerp(_d, 0.5);
  Gl.add(_a, 1.5, 0.25, false, 0);
  Gl.add(_b.set(p.x, 0.02, z), 1.3, 0.5, true, 0.3);
  // sparks streaming off it
  if (b?.sparkW && Math.random() < 0.8) {
    _a.copy(_c).lerp(_d, Math.random() * 0.6);
    b.sparkW(_a, _b.set(rand(-2, 2), rand(0.5, 2.5), rand(1, 4)), rand(0.04, 0.07), Math.random() < 0.6 ? VIOLET : WHITE);
  }
}

// --- Shoal: the bulldozer -------------------------------------------------------------
// Out ahead of you in the middle of the road - far enough that the road he's
// cleared lies open between you, further the faster you go - grown, his claw
// up and ready; then, when it's over, back to your side.
function dozerDrive(Pw, A, c, dt) {
  const g = Pw.game;
  const C = P.crab.dozer;
  const G = c.goal;
  const p = g.player;
  if (A.phase === 'back') {
    const side = c.x >= p.x ? 1 : -1;
    G.x = clamp(p.x + side * 2.4, -2.4, 2.4);
    G.dz = 2;
    G.w = 3;
    G.wz = 1.2;
    G.low = 0;
    return true;
  }
  G.x = 0;
  G.dz = clamp(C.ahead + g.speed * C.lead, C.ahead, C.max);
  G.w = 3;
  G.wz = A.phase === 'charge' ? 3 : 1.6;
  G.low = 0;
  G.urgent = false;
  c.lookFor(0.2, { x: 0, y: 0.4, dz: c.dz + 6 });
  return true;
}

// A row struck: off the road (obstacles.smash), and the wreck of it flying.
function smashRow(Pw, A, row, dir) {
  const g = Pw.game;
  const fx = g.powerFx;
  const C = P.crab.dozer;
  const hit = g.obstacles.smash(row, g.time, C.clear, dir);
  if (!hit.length) return;
  A.smashed++;
  const z = -(row.d - g.origin);
  for (const h of hit) {
    const out = h.x === 0 ? dir : Math.sign(h.x);
    const y0 = h.kind === 'H' ? 1.6 : 0.3, y1 = h.kind === 'H' ? 2.6 : h.kind === 'W' ? 2.2 : 0.9;
    // chunks of it flung out and up, glints of his claw's crystal, a puff
    for (let i = 0; i < 16; i++) fx.emit(h.x + rand(-0.8, 0.8), rand(y0, y1), z + rand(-0.4, 0.4), out * rand(3, 9), rand(3, 7), rand(-2, 2), rand(0.08, 0.2), 8);
    for (let i = 0; i < 6; i++) fx.emit(h.x + rand(-0.6, 0.6), rand(y0, y1), z, out * rand(1, 5), rand(2, 6), rand(-1, 1), rand(0.05, 0.08), 7);
    fx.emit(h.x, (y0 + y1) * 0.4, z, out * 1.5, 0.6, 0, 1.1, 0, 0.65, 1, 1.8);
    fx.emit(h.x + out * 0.8, 0.3, z, out * 3, 0.4, 0, 0.8, 0, 0.5, 0.8, 1.4);
  }
  g.cam.kick(0.22);
  g.audio.smash?.(clamp(hit[0].x / 3, -1, 1));
}

// --- Sorrel's ways ------------------------------------------------------------------
// The haul: off after each gem near you in turn - nearest first, and none
// you're about to take yourself - snapping it up (hopping for a high one);
// when the time's up, back to your side to hand it all over.
function haulDrive(Pw, A, c, dt) {
  const g = Pw.game;
  const p = g.player;
  const G = c.goal;
  const C = P.fox.haul;
  const v = Pw.v;
  if (A.phase === 'return' || A.phase === 'done') {
    A.back += dt;
    const side = c.x >= p.x ? 1 : -1;
    G.x = clamp(p.x + side * 1.1, -3, 3);
    G.dz = 0.5;
    G.w = 9;
    G.wz = 3.2;
    G.low = 0;
    c.lookFor(0.3, 'runner');
    if (A.phase === 'return' && ((Math.abs(c.x - G.x) < 0.6 && Math.abs(c.dz - G.dz) < 1.1) || A.back > 1.8)) {
      haulDeliver(Pw, A);
      A.phase = 'done';
    }
    return true;
  }
  const df = g.dist + c.dz;
  const mouthD = df + c.mouth[0];
  let T = A.target;
  if (T) {
    if (T.taken) T = null;
    // it's past her: she has it if she's on it; otherwise, let it go
    else if (T.d < mouthD - 0.3) {
      if (Math.abs(T.x - c.x) < 1.1) haulSnap(Pw, A, c, T);
      T = null;
    }
  }
  if (!T) {
    let best = null, cost = 1e9;
    for (const gem of g.gems.gems) {
      if (gem.taken || gem.lucky) continue;
      const a = gem.d - g.dist;
      if (a < C.reach[0]) continue;
      if (a > C.reach[1]) continue;
      if (gem.y > 2.4 || gem.d < mouthD - 1.5) continue;
      // (yours: in your lane and coming up on you)
      if (Math.abs(gem.x - p.x) < 0.95 && a < v * 0.9) continue;
      const k = a + Math.abs(gem.x - c.x) * 2.5;
      if (k < cost) {
        cost = k;
        best = gem;
      }
    }
    T = best;
  }
  A.target = T;
  if (!T) {
    // nothing near: lope along a lane over, nose up, looking
    G.x = clamp(p.x + (c.x >= p.x ? 1.6 : -1.6), -2.6, 2.6);
    G.dz = 4;
    G.w = 6;
    G.wz = 2;
    G.low = 0;
    return true;
  }
  // into its lane and on to meet it, quick
  G.x = T.x;
  G.dz = clamp(T.d - g.dist - c.mouth[0] + 0.25, c.C.behind, c.C.ahead);
  G.w = 16;
  G.wz = 4.2;
  G.low = 0;
  G.urgent = true;
  c.lookT = Math.max(c.lookT, 0.2);
  c.lookAt = { x: T.x, y: T.y, dz: T.d - g.dist };
  const vf = Math.max(g.speed + c.vdz, 1);
  const gap = T.d - mouthD;
  c.body.jawOpen = gap < vf * 0.2 && gap > -0.4 ? 0.8 : 0;
  // a high one: spring for it
  const need = T.y - c.mouth[1] - 0.06;
  if (c.grounded && !c.windup && need > 0.15 && Math.abs(c.x - T.x) < 0.6 && gap > 0 && gap < vf * 0.3 + 0.4 && c.canLeapAt(c.x, 0.7)) c.jump(Math.min(need + 0.08, 1.7), 'hop');
  if (Math.abs(gap) < 0.85 + vf * dt && Math.abs(T.x - c.x) < 0.85) {
    haulSnap(Pw, A, c, T);
    A.target = null;
  }
  return true;
}

function haulSnap(Pw, A, c, gem) {
  const g = Pw.game;
  g.gems.stash(gem, g.time);
  A.haul.push(gem);
  c.body.jawOpen = 0;
  c.body.snap?.();
  c.cheer(0.8);
  g.audio.gem(Math.min(A.haul.length, 9), gem.crown);
}

// Her haul, handed over: every gem she's carrying is yours, in a burst at
// your chest, and she's very pleased with herself.
function haulDeliver(Pw, A) {
  const g = Pw.game;
  const c = g.companion;
  if (!A.haul.length || A.delivered) return;
  A.delivered = true;
  let pts = 0;
  for (const gem of A.haul) pts += g.creditGem(gem, 'carried', true);
  const last = A.haul[A.haul.length - 1];
  g.sparkles.emit(0, 0.1, last.light, g.time, 1.4);
  g.ui.scorePop(pts);
  g.ui.powerNote(`Sorrel’s haul · ${A.haul.length} ${A.haul.length === 1 ? 'gem' : 'gems'}`, 'fox');
  g.audio.gemRun();
  if (c && g.state === 'running') {
    if (c.grounded && !c.windup) c.jump(0.55, 'hop');
    c.cheer(2.2);
    c.lookFor(1.2, 'camera');
  }
}

// Off ahead to the spot, a pounce and a dig - the soil flying - then she's
// herself again (the effect runs on without her).
function digDrive(Pw, A, c, dt, dug) {
  const g = Pw.game;
  if (A.dug) return false;
  const G = c.goal;
  const ahead = A.spot.d - g.dist;
  G.x = A.spot.x;
  G.dz = clamp(ahead, 1, c.C.ahead);
  G.w = 14;
  G.wz = 4;
  G.low = 0;
  G.urgent = true;
  c.lookFor(0.3, { x: A.spot.x, y: 0, dz: ahead + 1 });
  A.digT = (A.digT || 0) + dt;
  const there = Math.abs(c.dz - ahead) < 1.6 && Math.abs(c.x - A.spot.x) < 0.7;
  if (there || A.digT > 1.1 || ahead < 2) {
    A.dug = true;
    if (c.grounded && !c.windup && c.canLeapAt(c.x, 0.6)) c.jump(0.45, 'pounce');
    Pw.digAt(c, c.x, g.dist + c.dz + 0.5);
    dug();
    c.cheer(1.5);
    g.audio.chest?.(0.6, 6);
    return false;
  }
  return true;
}

// --- Iris: the row the gust is for -------------------------------------------------
// The first row coming up that she can reach in time (far enough off that it
// won't be on you before her breath's drawn) and not so far you can't see why.
function windRow(Pw) {
  const g = Pw.game;
  if (g.state !== 'running') return null;
  const C = P.dragon.windbreak;
  const v = Pw.v;
  const row = g.obstacles.rowBetween(g.dist + v * Math.max(C.range[0], C.windup + 0.35), g.dist + v * C.range[1]);
  return row;
}

// --- Nep: the gems his roots go after ---------------------------------------------------
// The nearest gem ahead within a lane of you, and those around it: the rest
// of its run and anything else close by across the nearby lanes.
function rootCluster(Pw) {
  const g = Pw.game;
  const C = P.pitcher.roots;
  const p = g.player;
  if (g.state !== 'running') return [];
  let first = null;
  for (const gem of g.gems.gems) {
    if (gem.taken || gem.lucky) continue;
    const a = gem.d - g.dist;
    if (a < C.reach[0]) continue;
    if (a > C.reach[1] || Math.abs(gem.x - p.x) > 2.6 || gem.y > 3) continue;
    if (!first || gem.d < first.d) first = gem;
  }
  if (!first) return [];
  const out = [];
  for (const gem of g.gems.gems) {
    if (gem.taken || gem.lucky || gem.y > 3) continue;
    if (gem.d < first.d - 0.5) continue;
    if (gem.d > first.d + 11) continue;
    if (gem.run !== first.run && Math.abs(gem.x - p.x) > 2.6) continue;
    out.push(gem);
    if (out.length >= C.most) break;
  }
  return out;
}
