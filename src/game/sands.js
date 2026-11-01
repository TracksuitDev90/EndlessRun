import * as THREE from '../../vendor/three/three.module.min.js';
import { PRINTS } from '../render/shaders.js';
import { mulberry32 } from '../core/rng.js';

// The Gallery's sands (a world whose env has `sands`: see time.js, and ground
// pattern 10 in shaders.js) — what the CPU does for them.
//
// Footprints. Each time one of the runner's feet is planted (mid-stance, from
// the stride's phase: the ball of a planted foot is pinned to the ground, so
// wherever it is now is where it came down), a print is pressed into the
// sand under it — a hiking boot's lugs for the wayfarer, a trainer's wavy
// tread for the explorer, the ball and toes dug in deepest. A landing presses
// both feet in at once, deeper; a slide ploughs a furrow, heaping the sand
// up at its end. They're kept in a ring of PRINTS and handed to the ground
// shader as uniforms, which presses them in and lights their walls; they
// fade once they're well behind.
//
// The surf. When the doorway out leads into the sea (its world has env.sea),
// the sea pours in through it as its doors swing open and laps up the beach
// in front of it: wave after wave rolls up the sand, fast and then slowing as
// it runs out of push, and draws back, each reaching its own way up the
// beach, its front rolling along in lobes. It's worked out here (so the
// runner knows when they're in it) and handed to the shader: where the front
// is, how far this wave reached, the wet line it leaves (drying back), how
// far its foam has been carried and how much lace it still carries. It
// washes footprints away, and the runner splashes through it.

const TAU = Math.PI * 2;
// which print each runner leaves (see footprint in the shaders)
const SOLE = { wayfarer: 0, explorer: 1 };
// how deep each presses a running footprint in (m)
const DEPTH = { wayfarer: 0.03, explorer: 0.024 };
// prints are let go this far behind the runner (m)
const KEEP = 24;
// the share of a wave's cycle it spends rolling up the beach
const UP = 0.4;

const smooth01 = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mod4096 = (d) => ((d % 4096) + 4096) % 4096;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Sands {
  constructor() {
    this.prints = Array.from({ length: PRINTS }, () => ({ live: false, x: 0, d: 0, yaw: 0, kind: 0, len: 0, w: 0, depth: 0, flip: 1, sx: 0, sd: 0 }));
    this.world = null;
    this.reset();
  }

  // Forget everything (a new run, a teleport): the next update starts afresh
  // (its waves dealt from the run's seed).
  reset(seed = 1) {
    this.leave();
    this.world = null;
    this.rnd = mulberry32((seed ^ 0x51ed27) >>> 0);
  }

  // Hand the sands of the world we're leaving back clean (when it's next
  // seen, through a doorway, it has no prints and no sea).
  leave() {
    const u = this.world?.u;
    if (u) {
      u.uShore.value.set(0, 0, 0, 0);
      u.uSurf.value.set(0, 0, 0, 0);
      u.uPrintZone.value.set(0, 0, 0, 0);
    }
    for (const p of this.prints) p.live = false;
    this.next = 0;
    this.stepK = [NaN, NaN];
    this.wasGrounded = true;
    this.furrow = null;
    // the surf
    this.sea = 0;
    this.doorD = 0;
    this.R = 0;
    this.from = 0;
    this.peak = 0;
    this.ebb = 0;
    this.waveT = 0;
    this.period = 0;
    this.front = -2;
    this.reach = 0;
    this.wet = -2;
    this.foam = 0;
    this.lace = 1;
    this.back = 0;
    this.lobe = 0;
    this.t = 0;
    this.wade = 0;
  }

  enter(world) {
    this.leave();
    this.world = world;
  }

  // --- the surf ----------------------------------------------------------------
  // Before the runner moves (so they know if they're in the water).
  surf(dt, game) {
    const world = game.current;
    if (world !== this.world) this.enter(world);
    const S = world.env.sands;
    if (!S) return;
    const u = world.u;
    const door = game.door;
    const surf = S.surf;
    if (!surf || !game.portal.active || !door || !game.next?.def.env.sea) {
      this.sea = 0;
      u.uShore.value.set(0, 0, 0, 0);
      return;
    }
    this.doorD = door.d;
    // it pours in through the doors as they swing open
    this.sea = smooth01(surf.from, surf.to, door.d - game.dist);
    this.t += dt;
    this.waveT += dt;
    if (this.waveT >= this.period) this.nextWave(surf);
    const f = this.waveT / this.period;
    let R;
    if (f < UP) {
      // rolling up the beach, slowing as it runs out of push
      const k = 1 - Math.pow(1 - f / UP, 3);
      R = this.from + (this.peak - this.from) * k;
      this.lace = 1 - 0.25 * k;
      this.back = 0;
    } else {
      // drawing back
      const k = smooth01(0, 1, (f - UP) / (1 - UP));
      R = this.peak + (this.ebb - this.peak) * k;
      this.lace = 0.75 - 0.5 * k;
      this.back = smooth01(UP, UP + 0.12, f) * (1 - smooth01(0.88, 1, f));
    }
    // the foam is carried with the water (a little behind its front, so the
    // lace stretches as it runs up)
    this.foam += (R - this.R) * 0.85;
    this.R = R;
    // (until the sea is in full, it reaches only part of the way)
    const k = this.sea;
    this.front = -1.5 + (R + 1.5) * k;
    this.reach = -1.5 + (this.peak + 1.5) * k;
    // the sand it wets dries back slowly behind it
    this.wet = Math.max(this.front, this.wet - 0.45 * dt);
    this.lobe = (0.5 + 0.035 * R) * k;
    const t = this.t;
    this.ph = [0.9 + t * 0.15, 2.3 + t * 0.45, 4.1 - t * 1.0];
    u.uShore.value.set(mod4096(door.d), 1, k, surf.reach);
    u.uSurf.value.set(this.front, this.reach, this.wet, this.back);
    u.uSurf2.value.set(this.foam, this.ph[0], this.ph[1], this.ph[2]);
    u.uSurf3.value.set(this.lace, this.lobe, 0, 0);
  }

  nextWave(surf) {
    const r = this.rnd;
    this.from = this.R;
    this.peak = surf.reach * (0.5 + 0.5 * r());
    this.ebb = surf.reach * (0.06 + 0.1 * r());
    this.period = surf.period[0] + (surf.period[1] - surf.period[0]) * r();
    this.waveT = 0;
  }

  // the front's lobes (as surfLobes in the shaders)
  lobes(x) {
    if (!this.ph) return 0;
    const p = this.ph;
    return this.lobe * (0.7 * Math.sin(0.42 * x + p[0]) + 0.45 * Math.sin(1.07 * x + p[1]) + 0.2 * Math.sin(2.3 * x + p[2]));
  }

  // whether (x, d) is under the water (or just a step from it)
  wetAt(x, d) {
    if (this.sea <= 0) return false;
    return this.doorD - d < this.front + this.lobes(x) - 0.1;
  }

  // --- footprints -------------------------------------------------------------------
  // After the runner has moved and been posed.
  update(dt, game) {
    const world = game.current;
    if (world !== this.world) this.enter(world);
    if (!world.env.sands) return;
    const p = game.player;
    const running = game.state === 'running' && p.mode === 'run' && !p.crashed && game.speed > 2;
    const onSand = p.grounded && (p.groundY || 0) < 0.05;
    const wet = this.wetAt(p.x, game.dist);
    // a foot planted (mid-stance)
    for (let side = 0; side < 2; side++) {
      const n = Math.floor((p.phase + side * Math.PI - Math.PI) / TAU);
      if (n > this.stepK[side] && running && onSand && !p.sliding) this.step(game, side, 1, wet);
      // (a contact share growing as the pace drops can tick the count back
      // one: keep the higher, so no foot comes down twice)
      if (n > this.stepK[side] || !(n >= this.stepK[side] - 1)) this.stepK[side] = n;
    }
    // a landing: both feet at once, deeper
    if (running && onSand && !this.wasGrounded) {
      this.step(game, 0, 1.6, wet);
      this.step(game, 1, 1.6, wet);
    }
    this.wasGrounded = p.grounded;
    // a slide ploughs a furrow (a new straight stretch of it each time it
    // swerves off the line it's on)
    if (running && onSand && p.sliding) this.plough(game, wet);
    else this.furrow = null;
    // the water churned round their legs as they wade (see the shader)
    this.wade += ((wet && p.grounded && running ? 1 : 0) - this.wade) * (1 - Math.exp(-dt * 10));
    world.u.uSurf3.value.z = p.x;
    world.u.uSurf3.value.w = this.wade < 0.01 ? 0 : this.wade;
    this.upload(dt, game);
  }

  add() {
    const pr = this.prints[this.next];
    this.next = (this.next + 1) % PRINTS;
    pr.live = true;
    return pr;
  }

  step(game, side, deep, wet) {
    const p = game.player;
    const b = p.b?.[side ? 'toeR' : 'toeL'];
    if (!b) return;
    // (the bones are posed in the runner's own space)
    const ball = _q.setFromMatrixPosition(b.matrixWorld);
    if (wet) {
      this.splash(game, ball, deep > 1 ? 12 : 7, deep > 1 ? 1.3 : 1);
      return;
    }
    _v.copy(ball).applyQuaternion(p.root.quaternion).add(p.root.position);
    const yaw = Math.atan2(p.vx, Math.max(game.speed, 2)) + (side ? 0.07 : -0.07);
    const pr = this.add();
    // (the print's middle is a little behind the ball of the foot)
    pr.x = _v.x - Math.sin(yaw) * 0.075;
    pr.d = game.dist - (_v.z - p.root.position.z) - Math.cos(yaw) * 0.075;
    pr.yaw = yaw;
    pr.kind = SOLE[game.runnerId] ?? 0;
    pr.len = 0;
    pr.w = 0;
    pr.depth = (DEPTH[game.runnerId] ?? 0.03) * deep;
    pr.flip = side ? 1 : -1;
  }

  plough(game, wet) {
    const p = game.player;
    if (wet) {
      // spray off the slide instead
      if (Math.random() < 0.5) this.splash(game, _q.set(0, 0, 0.2), 2, 1.1);
      this.furrow = null;
      return;
    }
    // its front end just ahead of the hips, where the legs ride
    const x = p.x;
    const d = game.dist + 0.3;
    let f = this.furrow;
    if (f) {
      // off the line it's on (a lane change): a fresh stretch from here
      const dd = d - f.sd;
      const drift = x - (f.sx + Math.tan(f.yaw) * dd);
      if (Math.abs(drift) > 0.1 && dd > 0.3) f = null;
    }
    if (!f) {
      f = this.add();
      f.sx = this.furrow ? this.furrow.x : x;
      f.sd = this.furrow ? this.furrow.d : d - 0.05;
      f.kind = 2;
      f.w = 0.42;
      f.depth = 0.045;
      f.flip = 1;
      this.furrow = f;
    }
    f.x = x;
    f.d = d;
    f.len = Math.hypot(x - f.sx, d - f.sd);
    f.yaw = Math.atan2(x - f.sx, Math.max(d - f.sd, 1e-3));
  }

  // Water kicked up at `at` (in the runner's own space): n drops flung up and
  // back, and a burst of spray.
  splash(game, at, n, power) {
    const p = game.player;
    if (!p.dust || !p.invQ) return;
    const r = Math.random;
    const run = _w.set(p.vx, 0, -game.speed).applyQuaternion(p.invQ);
    for (let i = 0; i < n; i++) {
      _v.copy(run).multiplyScalar(0.3 + 0.25 * r());
      _v.x += (r() - 0.5) * 2.6 * power;
      _v.y += (1.6 + r() * 2.2) * power;
      _v.z += (0.3 + r()) * power;
      p.dust.emit(_p.set(at.x + (r() - 0.5) * 0.15, 0.04, at.z + (r() - 0.5) * 0.15), _v, 0.05 + 0.05 * r(), 2);
    }
    _v.copy(run).multiplyScalar(0.3);
    _v.y += 0.5;
    p.dust.emit(_p.set(at.x, 0.08, at.z), _v, 0.2 + 0.12 * power, 3, 0.6, 0.7, 1);
  }

  // Hand the prints to the shader: the live ones first; those well behind,
  // or washed away, are let go.
  upload(dt, game) {
    const u = this.world.u;
    const A = u.uPrintA.value;
    const B = u.uPrintB.value;
    let n = 0;
    let back = 0;
    for (const pr of this.prints) {
      if (!pr.live) continue;
      // the sea smooths away what it runs over
      if (this.sea > 0 && this.doorD - pr.d < this.front + this.lobes(pr.x)) pr.depth *= Math.exp(-dt * 5);
      if (game.dist - pr.d > KEEP || pr.depth < 0.002) {
        pr.live = false;
        if (pr === this.furrow) this.furrow = null;
        continue;
      }
      A[n].set(pr.x, mod4096(pr.d), pr.yaw, pr.kind);
      B[n].set(pr.len, pr.w, pr.depth, pr.flip);
      back = Math.max(back, game.dist - pr.d + pr.len);
      n++;
    }
    u.uPrintZone.value.set(mod4096(game.dist), back + 0.6, n, 0);
  }
}
