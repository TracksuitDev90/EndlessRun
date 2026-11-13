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

const P = CONFIG.powers;
const LANES = CONFIG.laneX;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rand = (a, b) => a + Math.random() * (b - a);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export const POWERS = {
  fox: [
    { id: 'haul', name: 'Fox’s Haul', icon: 'paw', blurb: `Sorrel darts between lanes snapping up nearby gems for ${P.fox.haul.dur} s, then brings you her haul.` },
    { id: 'treasure', name: 'Buried Treasure', icon: 'dig', blurb: 'Sorrel digs up a bonus gem trail along a safe route ahead - follow it: jumps, slides, dodges and all.' },
    { id: 'lucky', name: 'Lucky Find', icon: 'clover', blurb: `Sorrel unearths a special gem. Take it and gems you collect yourself count double for ${P.fox.lucky.dur} s.` },
  ],
  dragon: [
    { id: 'gift', name: 'Dragon’s Gift', icon: 'wind', blurb: `Iris’s flowing mane draws nearby gems to you for ${P.dragon.gift.dur} s.` },
    { id: 'windbreak', name: 'Windbreak', icon: 'gust', blurb: 'Iris winds up and a gust clears one approaching row of obstacles off the road.' },
    { id: 'fold', name: 'World Fold', icon: 'portal', blurb: 'Once a run: Iris opens a portal to the start of the next world. What you skip earns nothing.' },
  ],
  pitcher: [
    { id: 'freshen', name: 'Freshen Up', icon: 'drop', blurb: 'After a stumble: Nep splashes it away - the second-hit danger gone, back up to pace.' },
    { id: 'roots', name: 'Root Reach', icon: 'roots', blurb: 'Nep plants his feet and his roots fetch one cluster of gems ahead, across nearby lanes.' },
    { id: 'shield', name: 'Pitcher Protection', icon: 'shield', blurb: `Nep drenches you: ${P.pitcher.shield.dur} s that nothing can hurt you.` },
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
  }

  // A new run: everything ready, World Fold too.
  reset() {
    this.stop(true);
    this.cd = {};
    this.folded = false;
    this.doubleT = 0;
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
    this.stop(true);
  }

  // Lucky Find: the gems you take yourself count this many times over.
  get gemMul() {
    return this.doubleT > 0 ? P.fox.lucky.mul : 1;
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
      return !!b && b.d - g.dist > P.dragon.fold.minDoor;
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
};

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
