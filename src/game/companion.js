import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { clamp } from './rig.js';

// A companion: an animal that runs with you (the first, Sorrel the red fox -
// see companions.js). You don't steer her; this is her mind. It is almost
// all for show, except that now and then she fetches a gem you'd have
// missed and tosses it back to you (and one day, power-ups).
//
// She's faster than you, and she knows it. Most of the time she lopes along
// a lane or two over, drifting ahead and dropping back; and every few
// seconds she gets an idea (a "beat"):
//   - scout: tears off ahead, then glances back over her shoulder at you,
//     with a sly look;
//   - trail: drops back almost under the camera, then dashes past you;
//   - under: comes up behind you in your lane, flattens herself and shoots
//     out between your legs;
//   - ride: springs up onto your shoulder and rides there a while, ears
//     streaming, before leaping off ahead;
//   - pounce: the mousing leap - up in an arch and down nose first (a
//     treat: rare);
//   - whirl: pulls up in a lane of her own and chases her tail round once,
//     for the joy of it (rarer still; sometimes when you take a whole run of
//     gems);
//   - fetch: spots a gem in a lane you're not in, races over to it, springs
//     up and snaps it out of the air, and tosses it back to you.
// However she goes, she goes like a fox: nose first along the road, crossing
// it on a slant (never crabwise, never broadside to you) and leaning into it.
// Under all of it she's careful: she reads the obstacles ahead and leaps the
// low ones, ducks under the bars (she fits), swerves round the walls, and
// keeps out from under your feet. When you stumble she flattens her ears and
// looks back; when you go down she circles back and sits by you; on the
// title screen she sits beside you, looking about, and hops up to say hello
// when you're picked.
//
// Positions are kept on the track: x across it, y her feet's height, dz how
// far ahead of the runner (- behind), all in metres.

const LANES = CONFIG.laneX;
const HW = 0.17; // her half-width, for the obstacles
const MOUTH = [0.6, 0.56]; // her jaws: ahead of and above her feet
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _vel = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _scale = new THREE.Vector3();

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ease = (t) => t * t * (3 - 2 * t);

// A critically damped spring toward target, solved exactly (the same path
// at any frame rate); returns [x, v] through out.
function follow(x, v, target, w, dt, out) {
  const e = Math.exp(-w * dt);
  const d = x - target;
  const j = (v + w * d) * dt;
  out[0] = target + (d + j) * e;
  out[1] = (v - w * j) * e;
  return out;
}
const _f = [0, 0];

export class Companion {
  constructor(game, def, body) {
    this.game = game;
    this.def = def;
    this.body = body;
    // (a companion other than the fox can bring its own tunables over hers,
    // its own size and where its mouth is, and how keen it is on each of
    // her ideas: see companions.js)
    this.C = def.tune ? { ...CONFIG.companion, ...def.tune } : CONFIG.companion;
    this.hw = def.hw ?? HW;
    this.mouth = def.mouth ?? MOUTH;
    this.keen = def.beats || {};
    this.later = [];
    this.reset(true);
  }

  get objects() {
    return this.body.objects;
  }

  reset(title) {
    const p = this.game.player;
    this.x = p.x + 0.85;
    this.vx = 0;
    this.dz = 0.35;
    this.vdz = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.yaw = Math.PI - 0.5;
    this.yawV = 0;
    this.spin = 0;
    this.whirl = null;
    this.whirledAt = -99;
    this.pouncedAt = -99;
    this.hurdle = null;
    this.curl = 0;
    this.goal = { x: this.x, dz: this.dz, w: 6, wz: 2.5, low: 0, urgent: false };
    this.air = null;
    this.windup = null;
    this.beat = null;
    this.beatT = 0;
    this.restT = rand(1.5, 3);
    this.fetchT = rand(4, 7);
    this.fetching = null;
    if (this.ride && this.game.player) this.game.player.rider = 0;
    this.ride = null;
    this.power = null;
    this.mood = { happy: 0, wag: 0, earsBack: 0, look: 0 };
    this.happyT = 0;
    this.lookT = 0;
    this.lookAt = null;
    this.flickT = rand(1, 3);
    this.titleT = 0;
    this.sitting = title;
    this.crashSeen = false;
    this.later.length = 0;
    this.body.reset();
    this.body.mode = title ? 'sit' : 'run';
    if (Number.isFinite(this.game.dist)) this.place(0);
  }

  // --- what happens to the runner -------------------------------------------------
  start() {
    this.sitting = false;
    this.beat = null;
    this.restT = rand(1.2, 2.2);
    this.cheer(0.6);
  }

  greet() {
    if (!this.grounded) return;
    this.jump(0.42, 'hop');
    this.cheer(1.2);
    this.body.flick(0);
    this.body.flick(1);
  }

  stumbled() {
    this.mood.earsBack = 1.2;
    this.lookFor(0.9, 'runner');
    if (this.ride) this.dismount();
  }

  crashed() {
    if (this.ride) this.dismount();
    this.stopWhirl();
    this.endBeat();
    this.fetching = null;
    this.mood.earsBack = 1.4;
  }

  revived() {
    this.mood.earsBack = 0;
    this.sitting = false;
    if (this.grounded) this.jump(0.5, 'hop');
    this.cheer(1.4);
  }

  // A whole run of gems taken: she's delighted (and once in a while it's
  // too much for her, and she has to chase her tail about it).
  wholeRun() {
    this.cheer(1.2);
    if (Math.random() < 0.25 && !this.beat && !this.fetching && !this.ride && this.canWhirl()) this.startBeat('whirl');
  }

  cheer(t) {
    this.happyT = Math.max(this.happyT, t);
  }

  // One of her abilities is starting (powers.js): whatever she was up to,
  // she drops it.
  powerBegin() {
    if (this.ride) this.dismount();
    this.stopWhirl();
    if (this.beat) this.endBeat();
    this.fetching = null;
    this.body.jawOpen = 0;
  }

  lookFor(t, at) {
    this.lookT = t;
    this.lookAt = at;
  }

  // --- the frame -------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const st = g.state;
    const p = g.player;
    this.goal.urgent = false;
    if (st === 'title') this.title(dt);
    else if (this.ride) this.riding(dt);
    else {
      if (st === 'crashed' || (st === 'reviving' && g.speed < 0.5)) this.down(dt);
      else if (st === 'running') {
        this.think(dt);
        this.safety();
      }
      this.move(dt);
    }
    // mood: happy squints fade, ears come back up
    this.happyT = Math.max(0, this.happyT - dt);
    this.mood.happy += ((this.happyT > 0 ? 1 : 0) - this.mood.happy) * (1 - Math.exp(-dt * 8));
    this.mood.wag += ((this.happyT > 0 ? 1 : 0.0) - this.mood.wag) * (1 - Math.exp(-dt * 3));
    this.mood.earsBack = Math.max(0, this.mood.earsBack - dt * 0.8);
    this.lookT = Math.max(0, this.lookT - dt);
    this.flickT -= dt;
    if (this.flickT <= 0) {
      this.body.flick(Math.random() < 0.5 ? 0 : 1);
      this.flickT = st === 'title' ? rand(0.8, 3) : rand(2, 6);
    }
    this.sparkLater();
    this.place(dt);
    const b = this.body;
    b.happy = this.mood.happy;
    b.wag = this.mood.wag * (this.ride ? 0.3 : 1);
    b.lowTarget = this.goal.low;
    b.wet = g.current?.def.env.bubbles ? 1 : 0;
    b.earBias = this.mood.earsBack;
    b.update(dt, this.ctx);
    // (whatever he's shed this frame - drops, crumbs - left in the world)
    b.after?.(this.pz, g.dist, !!g.player?.lowG);
  }

  // --- placing her ---------------------------------------------------------------
  // The runner's scene z, and hers.
  get pz() {
    return -(this.game.dist - this.game.origin);
  }

  place(dt) {
    const g = this.game;
    const b = this.body;
    const ctx = this.ctx || (this.ctx = { speed: 0, vel: new THREE.Vector3(), mode: 'sit', airT: 0, airDur: 1, airKind: 'leap', lat: 0 });
    if (this.ride) {
      this.perch(_p, _q);
      // (mounting: flying up to it)
      const r = this.ride;
      if (r.t < r.up) {
        const k = ease(r.t / r.up);
        _v.copy(r.from).lerp(_p, k);
        _v.y += Math.sin(Math.PI * k) * 0.45;
        _q2.copy(r.fromQ).slerp(_q, k);
        b.place(_v, _q2, 0, 1 - k);
        ctx.mode = 'air';
        ctx.airT = r.t;
        ctx.airDur = r.up;
        ctx.airKind = 'leap';
      } else {
        b.place(_p, _q, 0, 0);
        ctx.mode = 'ride';
      }
      ctx.crouch = 0;
      ctx.fall = 0;
      ctx.speed = g.speed;
      _vel.set(g.player.vx, 0, -g.speed);
      ctx.vel.copy(_vel);
      ctx.lat = 0;
      return;
    }
    const vf = g.speed + this.vdz;
    // (up a climb's ramp and along its decks, leaping its gaps: see
    // ObstacleField.surfaceAt)
    const sf = Number.isFinite(g.dist) ? g.obstacles.surfaceAt(this.x, g.dist + this.dz, (this.lift || 0) + 0.6) : 0;
    this.lift = (this.lift || 0) + (sf - (this.lift || 0)) * (sf > (this.lift || 0) ? 1 - Math.exp(-dt * 16) : 1 - Math.exp(-dt * 7));
    _p.set(this.x, this.y + this.lift, this.pz - this.dz);
    // facing where she's going, banked into turns
    _e.set(0, this.yaw + this.spin, 0, 'YXZ');
    _q.setFromEuler(_e);
    b.place(_p, _q, 0, 1);
    ctx.speed = Math.hypot(vf, this.vx * 0.5);
    // (whirling, her feet patter round quick and short whatever her pace)
    if (this.whirl) ctx.speed = Math.max(ctx.speed, 6);
    ctx.vel.set(this.vx, this.vy, -vf);
    ctx.lat = this.vx;
    ctx.curl = this.curl;
    ctx.fall = this.grounded ? 0 : this.C.gravity;
    if (!this.grounded) {
      ctx.mode = 'air';
      ctx.airT = this.air.t;
      ctx.airDur = this.air.T;
      ctx.airKind = this.air.kind;
    } else if (this.sitting) ctx.mode = 'sit';
    else ctx.mode = Math.abs(vf) > 0.3 || g.state === 'running' ? 'run' : 'stand';
    ctx.crouch = this.windup ? this.windup.t / this.windup.dur : 0;
    ctx.crouchKind = this.windup ? this.windup.kind : 'leap';
    b.spin = 0;
    // where she's looking, in her own space
    let at = null;
    if (this.lookT > 0 && this.lookAt) {
      if (this.lookAt === 'runner' || this.lookAt === 'camera') {
        const pl = g.player;
        if (this.lookAt === 'runner') _look.set(pl.x, pl.y + 1.45, this.pz);
        else _look.copy(g.cam.camera.position);
      } else _look.set(this.lookAt.x, this.lookAt.y, this.pz - this.lookAt.dz);
      at = _look.sub(_p).applyQuaternion(_q2.copy(_q).invert());
    }
    b.lookAt = at;
    b.lookW += ((at ? 1 : 0) - b.lookW) * (1 - Math.exp(-(dt || 0) * 7));
  }

  // A point on the runner's shoulder to ride on, and how to sit there.
  perch(out, q) {
    const pl = this.game.player;
    const R = pl.rig;
    const s = this.ride.side;
    const chest = pl.b.chest;
    // (the chest's matrix is in the runner's own space while they animate)
    _m.compose(pl.root.position, pl.root.quaternion, pl.root.scale);
    _m2.multiplyMatrices(_m, chest.matrixWorld);
    const sx = (R.shoulder?.[0] ?? 0.15) * 0.95 + 0.04;
    const sy = (R.shoulder?.[1] ?? 1.2) - (R.chestY ?? 1.0) + 0.1;
    out.set(s * sx, sy, 0.03).applyMatrix4(_m2);
    _m2.decompose(_v, q, _scale);
    _q2.setFromAxisAngle(_up, -s * 0.12);
    q.multiply(_q2);
    return out;
  }

  // --- the title screen ----------------------------------------------------------
  // She sits beside the runner, turned toward you, looking about; hops when
  // they're picked.
  title(dt) {
    const g = this.game;
    const tall = (g.cam.aspect || 1) < 1.25;
    this.titleT += dt;
    this.goal.x = g.player.x + (tall ? 1.0 : -0.85);
    this.goal.dz = tall ? 0.85 : -0.3;
    this.goal.low = 0;
    this.x = this.goal.x;
    this.dz = this.goal.dz;
    this.vx = this.vdz = 0;
    if (this.grounded && !this.windup) {
      this.sitting = true;
      // turned toward the camera, a little toward the runner
      const cam = g.cam.camera.position;
      const want = Math.atan2(-(cam.x - this.x), -(cam.z - (this.pz - this.dz))) + (tall ? 0.55 : -0.7);
      this.turnTo(want, 6, dt);
    } else if (!this.grounded) this.fall(dt);
    this.windupStep(dt);
    // glances: up at the runner, at you, about
    if (this.lookT <= 0 && Math.random() < dt * 0.35) this.lookFor(rand(1.2, 2.6), Math.random() < 0.45 ? 'camera' : 'runner');
  }

  // --- down: the runner's gone over ------------------------------------------------
  down(dt) {
    const g = this.game;
    const p = g.player;
    // circle back and sit by them
    this.goal.x = clamp(p.x + (this.x >= p.x ? 0.9 : -0.9), -3, 3);
    this.goal.dz = 0.9;
    this.goal.low = 0;
    this.goal.w = 4;
    this.goal.wz = 3;
    if (g.speed < 1.5 && Math.abs(this.dz - this.goal.dz) < 0.4 && Math.abs(this.vdz) < 0.6) this.sitting = true;
    if (this.sitting) {
      const want = Math.atan2(-(p.x - this.x), -(this.pz - (this.pz - this.dz))) ;
      this.turnTo(want, 5, dt);
      this.lookFor(0.5, 'runner');
    }
  }

  // --- her ideas ---------------------------------------------------------------------
  think(dt) {
    const g = this.game;
    if (this.sitting) {
      this.sitting = false;
    }
    this.fetchT -= dt;
    // (one of her abilities has her: see powers.js)
    if (this.power?.drive?.(this, dt)) return;
    if (this.fetching) this.fetchStep(dt);
    else if (this.beat) this.beatStep(dt);
    else {
      this.escort(dt);
      this.restT -= dt;
      if (this.fetchT <= 0 && this.tryFetch()) return;
      if (this.restT <= 0) this.chooseBeat();
    }
  }

  // Loping along beside you: a slot a lane over (or ahead in yours), shifted
  // now and then.
  escort(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    if (!this.slot || (this.slotT -= dt) <= 0) {
      const lane = Math.round((p.x - LANES[0]) / 2.4);
      const others = [0, 1, 2].filter((l) => l !== lane);
      const ahead = Math.random() < 0.3;
      this.slot = { lane: ahead ? lane : pick(others), dz: ahead ? rand(2.8, 4.5) : rand(-0.5, 3), off: ahead ? 0 : rand(-0.4, 0.4) };
      this.slotT = rand(2, 4.5);
      if (Math.random() < 0.35) this.lookFor(rand(0.6, 1.1), Math.random() < 0.6 ? 'runner' : 'camera');
    }
    G.x = LANES[this.slot.lane] + this.slot.off;
    G.dz = this.slot.dz;
    G.w = 5;
    G.wz = 1.6;
    G.low = 0;
  }

  chooseBeat() {
    const g = this.game;
    const p = g.player;
    // (the showy ones - the mousing pounce, chasing her tail - are treats:
    // rare, and never twice running)
    const opts = [
      ['scout', 1.8],
      ['trail', 2],
      ['pounce', this.canLeap(1.0) && g.time - this.pouncedAt > this.C.pounceEvery ? 0.5 : 0],
      ['whirl', this.canWhirl() ? 0.25 : 0],
      // (a runner as small as she is - the bunny - has no room between his
      // legs to shoot through, nor a shoulder to ride on)
      ['under', this.openRoad(p.x, 2.2) && p.grounded && !p.sliding && g.speed > 8 && !p.small && !p.onBoard ? 2.4 : 0],
      ['ride', this.openRoad(p.x, 3.2) && p.grounded && !p.sliding && !g.stumbleWindow && !p.small ? 2.6 : 0],
    ];
    for (const o of opts) if (this.keen[o[0]] !== undefined) o[1] *= this.keen[o[0]];
    if (this.lastBeat) for (const o of opts) if (o[0] === this.lastBeat) o[1] *= 0.25;
    let total = 0;
    for (const o of opts) total += o[1];
    let r = Math.random() * total;
    for (const [name, w] of opts) {
      r -= w;
      if (w > 0 && r <= 0) {
        this.startBeat(name);
        return;
      }
    }
    this.restT = 1;
  }

  startBeat(name) {
    this.beat = name;
    this.lastBeat = name;
    this.beatT = 0;
    this.stage = 0;
    const p = this.game.player;
    const lane = Math.round((p.x - LANES[0]) / 2.4);
    const others = [0, 1, 2].filter((l) => l !== lane);
    this.beatLane = name === 'whirl' ? this.playLane(others) : pick(others);
    if (name === 'pounce') {
      this.pouncedAt = this.game.time;
      this.jump(this.C.pounce, 'pounce');
    }
    if (name === 'whirl') this.whirledAt = this.game.time;
  }

  endBeat() {
    this.beat = null;
    this.rideSide = 0;
    this.goal.low = 0;
    this.restT = rand(this.C.rest[0], this.C.rest[1]);
    this.slot = null;
  }

  beatStep(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    this.beatT += dt;
    const t = this.beatT;
    switch (this.beat) {
      case 'scout': {
        // tear off ahead, then a look back over the shoulder
        G.x = LANES[this.beatLane];
        G.dz = 6.2;
        G.w = 4;
        G.wz = 1.8;
        if (this.stage === 0 && this.dz > 5) {
          this.stage = 1;
          this.lookFor(1.1, 'camera');
          this.cheer(1.1);
        }
        if (t > 3) this.endBeat();
        break;
      }
      case 'trail': {
        // drop right back, then dash past
        G.x = LANES[this.beatLane];
        if (this.stage === 0) {
          G.dz = this.C.behind;
          G.wz = 2.2;
          if (t > 1.6) this.stage = 1;
        } else {
          G.dz = 5;
          G.wz = 3.2;
          if (this.dz > 3.5) this.endBeat();
        }
        if (t > 5) this.endBeat();
        break;
      }
      case 'whirl': {
        // out ahead into a lane of her own, where she pulls up and chases
        // her tail round once, then bounds off after you
        G.x = LANES[this.beatLane];
        G.w = 4;
        if (this.stage === 0) {
          G.dz = clamp(5.6 + g.speed * 0.14, 6.5, 8.6);
          G.wz = 2;
          const set = this.dz > G.dz - 1.2 && Math.abs(this.x - G.x) < 0.3 && Math.abs(this.vx) < 1.2;
          if (set && this.grounded && !this.windup && this.openRoad(this.x, 1.6) && this.laneOf(p.x) !== this.beatLane) {
            this.stage = 1;
            this.startWhirl(this.x >= p.x ? -1 : 1);
          } else if (t > 4.5) this.endBeat();
        } else if (this.stage === 1) {
          G.dz = this.dz;
          if (!this.whirl) this.stage = 2;
        } else {
          G.dz = 2.5;
          G.wz = 3.5;
          if (this.dz > 0.6 || t > 7) this.endBeat();
        }
        break;
      }
      case 'under': {
        // up behind you in your lane, then out between your legs
        if (!p.grounded || p.sliding || !this.openRoad(p.x, 1.6)) {
          this.endBeat();
          break;
        }
        if (this.stage === 0) {
          // come round behind, out of the way
          G.x = this.dz > -1.6 ? p.x + (this.x > p.x ? 1.1 : -1.1) : p.x;
          G.dz = -2.3;
          G.wz = 3;
          G.w = 6;
          if (this.dz < -1.9 && Math.abs(this.x - p.x) < 0.15) this.stage = 1;
          if (t > 4) this.endBeat();
        } else {
          G.x = p.x;
          G.w = 14;
          G.dz = 4;
          G.wz = 5.5;
          G.low = this.dz > -1.4 && this.dz < 1.0 ? 1 : 0.4;
          if (this.dz > 2.6) {
            this.endBeat();
            this.lookFor(0.8, 'camera');
            this.cheer(0.9);
          }
        }
        break;
      }
      case 'ride': {
        // up behind you, then a spring onto your shoulder
        if (!p.grounded || p.sliding || !this.openRoad(p.x, 2.5)) {
          this.endBeat();
          break;
        }
        if (!this.rideSide) this.rideSide = this.x >= p.x ? 1 : -1;
        G.x = p.x + this.rideSide * (this.dz > -0.9 ? 1.1 : 0.55);
        G.dz = -1.35;
        G.wz = 3;
        G.w = 7;
        if (this.dz < -1.05 && Math.abs(this.x - p.x) < 0.8 && this.grounded) this.mount(this.x >= p.x ? 1 : -1);
        if (t > 4.5) this.endBeat();
        break;
      }
      case 'pounce': {
        G.dz = Math.max(1.5, this.dz);
        if (this.grounded && !this.windup && t > 0.3) this.endBeat();
        break;
      }
      default:
        this.endBeat();
    }
  }

  // --- riding on your shoulder -----------------------------------------------------------
  mount(side) {
    this.beat = null;
    this.rideSide = 0;
    _p.set(this.x, this.y, this.pz - this.dz);
    _e.set(0, this.yaw, 0, 'YXZ');
    this.ride = { side, t: 0, up: 0.42, stay: rand(this.C.ride[0], this.C.ride[1]), from: _p.clone(), fromQ: new THREE.Quaternion().setFromEuler(_e) };
    // (the runner knows which shoulder she's on, to keep that arm clear of
    // her: see Wayfarer.poseRun)
    this.game.player.rider = side;
    this.body.land(0.2);
    this.cheer(this.ride.stay);
  }

  riding(dt) {
    const g = this.game;
    const p = g.player;
    const r = this.ride;
    r.t += dt;
    if (r.t > r.up && !r.landed) {
      r.landed = true;
      this.body.land(0.6);
    }
    // looks about, at you, back at the camera
    if (this.lookT <= 0 && Math.random() < dt * 0.5) this.lookFor(rand(0.6, 1.4), Math.random() < 0.5 ? 'camera' : { x: p.x + rand(-3, 3), y: 1, dz: 12 });
    const soon = !this.openRoad(p.x, 1.0);
    if (g.state !== 'running' || p.sliding || p.stumbleT > 0 || (r.t > r.up && (r.t > r.up + r.stay || soon))) this.dismount();
  }

  // Off the shoulder in a leap, ahead and into a clear lane.
  dismount() {
    const g = this.game;
    const p = g.player;
    if (!this.ride) return;
    this.perch(_p, _q);
    const lane = this.freeLane(p.x, 1.2);
    this.x = _p.x;
    this.y = Math.max(0, _p.y);
    this.dz = this.pz - _p.z;
    this.vdz = g.state === 'running' ? 4.5 : 0;
    const tx = LANES[lane];
    this.vy = 3.2;
    this.grounded = false;
    // time to the ground, and sideways speed to get there
    const G = this.C.gravity;
    const T = (this.vy + Math.sqrt(this.vy * this.vy + 2 * G * this.y)) / G;
    this.vx = (tx - this.x) / T;
    this.air = { t: 0, T, kind: 'leap' };
    this.yaw = 0;
    this.ride = null;
    p.rider = 0;
    this.goal.x = tx;
    this.goal.dz = 2.5;
    this.endBeat();
  }

  // --- fetching a gem ------------------------------------------------------------------
  // A gem in a lane you're not in, far enough ahead to reach and with the
  // way to it clear; now and then (mischief) one right in front of you.
  tryFetch() {
    const g = this.game;
    const p = g.player;
    const C = this.C.fetch;
    this.fetchT = rand(C.every[0], C.every[1]) * 0.35;
    if (Math.random() > C.chance) return false;
    const df = g.dist + this.dz;
    const mischief = Math.random() < C.mischief;
    let best = null;
    for (const gem of g.gems.gems) {
      // (the gems an ability laid are left for you)
      if (gem.taken || gem.bonus) continue;
      const ahead = gem.d - g.dist;
      if (ahead < C.reach[0] || ahead > C.reach[1] || gem.d - df < 2) continue;
      if (gem.y > 1.9) continue;
      const theirs = Math.abs(gem.x - p.x) < 1.3;
      if (theirs && !(mischief && ahead > 6)) continue;
      if (!this.clearPath(gem.x, df, gem.d + 1)) continue;
      if (!best || gem.d < best.d) best = gem;
    }
    if (!best) return false;
    this.fetching = { gem: best, t: 0, hopped: false, cheeky: Math.abs(best.x - p.x) < 1.3 };
    this.fetchT = rand(C.every[0], C.every[1]);
    this.lookFor(0.8, { x: best.x, y: best.y, dz: best.d - g.dist });
    return true;
  }

  fetchStep(dt) {
    const g = this.game;
    const F = this.fetching;
    const gem = F.gem;
    F.t += dt;
    const G = this.goal;
    const df = g.dist + this.dz;
    if (gem.taken || gem.d < df - 1.5 || F.t > 6) {
      this.fetching = null;
      this.restT = rand(0.6, 1.5);
      return;
    }
    // into its lane, and up to it
    G.x = gem.x;
    G.w = 10;
    G.dz = gem.d - g.dist + 0.4;
    G.wz = 3.2;
    G.low = 0;
    this.lookT = Math.max(this.lookT, 0.2);
    this.lookAt = { x: gem.x, y: gem.y, dz: gem.d - g.dist };
    // spring to meet it at the top of the hop (a low gem she just snaps up)
    const vf = Math.max(g.speed + this.vdz, 1);
    const need = gem.y - this.mouth[1] - 0.06;
    if (this.grounded && !F.hopped && need > 0.12 && Math.abs(this.x - gem.x) < 0.5) {
      const H = need + 0.08;
      const v0 = Math.sqrt(2 * this.C.gravity * H);
      const tUp = v0 / this.C.gravity;
      const gap = gem.d - (df + this.mouth[0]);
      if (gap > 0 && gap < vf * (tUp + this.C.windup.hop) + 0.3 && this.canLeapAt(this.x, tUp * 2.1 + this.C.windup.hop)) {
        F.hopped = true;
        this.jump(H, 'hop');
      }
    }
    // jaws open as she closes in
    const near = gem.d - (df + this.mouth[0]);
    this.body.jawOpen = near < vf * 0.18 && near > -0.4 ? 0.8 : 0;
    // caught?
    const mx = this.x, my = this.y + this.mouth[1] + (this.grounded ? 0 : 0.06), md = df + this.mouth[0];
    const prev = md - vf * dt - 0.05;
    if (gem.d >= prev - 0.35 && gem.d <= md + 0.4 && Math.abs(gem.x - mx) < 0.5 && Math.abs(gem.y - my) < 0.45) {
      this.body.jawOpen = 0;
      this.body.snap();
      g.creditGem(gem, true);
      this.later.push({ at: g.time + 0.48, gem });
      this.cheer(F.cheeky ? 1.6 : 1.1);
      this.lookFor(F.cheeky ? 1.2 : 0.8, 'runner');
      this.fetching = null;
      this.restT = rand(1, 2);
    }
  }

  // The motes of a tossed gem burst as it reaches you.
  sparkLater() {
    const g = this.game;
    for (let i = this.later.length - 1; i >= 0; i--) {
      const L = this.later[i];
      if (g.time < L.at) continue;
      g.sparkles.emit(0, 0.1, L.gem.light, g.time, L.gem.crown ? 1.1 : 0.85);
      this.later.splice(i, 1);
    }
  }

  // --- keeping safe ------------------------------------------------------------------------
  // The first obstacle in her way at x between d0 and d1 (track distance).
  threat(x, d0, d1, kinds = 'LWH') {
    let best = null;
    for (const o of this.game.obstacles.records) {
      if (o.climb || o.d + o.len < d0 || o.d > d1 || kinds.indexOf(o.kind) < 0) continue;
      if (Math.abs(x - o.x) > o.hw + this.hw) continue;
      if (!best || o.d < best.d) best = o;
    }
    return best;
  }

  // Nothing at all in the way at x for the next `secs` of running.
  openRoad(x, secs) {
    const g = this.game;
    const v = Math.max(g.speed, CONFIG.speed.start);
    const d0 = g.dist + Math.min(this.dz, 0) - 2;
    return !this.threat(x, d0, g.dist + Math.max(this.dz, 0) + v * secs + 2) && !this.threat(x + 0.6, d0, g.dist + v * secs, 'W') && !this.threat(x - 0.6, d0, g.dist + v * secs, 'W');
  }

  // Can she leap here for a moment (nothing overhead or walled in her lane)?
  canLeap(secs) {
    return this.canLeapAt(this.x, secs);
  }

  canLeapAt(x, secs) {
    const g = this.game;
    const df = g.dist + this.dz;
    const v = Math.max(g.speed + this.vdz, 1);
    return !this.threat(x, df - 0.5, df + v * secs + 1.5, 'LHW');
  }

  // A clear way along x from here to d1 (no walls or bars; hurdles she can
  // leap).
  clearPath(x, d0, d1) {
    return !this.threat(x, d0, d1, 'W') && !this.threat(this.x + (x - this.x) * 0.5, d0, d0 + Math.max(this.game.speed, 8) * 0.5, 'W');
  }

  laneOf(x) {
    return clamp(Math.round((x - LANES[0]) / 2.4), 0, 2);
  }

  // The lane with the most room ahead (from x's lane, the nearest first).
  freeLane(x, secs) {
    const g = this.game;
    const v = Math.max(g.speed, CONFIG.speed.start);
    const df = g.dist + this.dz;
    let best = 1, room = -1;
    const order = [0, 1, 2].sort((a, b) => Math.abs(LANES[a] - x) - Math.abs(LANES[b] - x));
    for (const l of order) {
      const o = this.threat(LANES[l], df - 1, df + v * secs * 3, 'W');
      const r = o ? o.d - df : 1e9;
      if (r > room + 0.5) {
        room = r;
        best = l;
      }
    }
    return best;
  }

  // Read the road: swerve round walls, leap hurdles and water, and keep out
  // from under the runner's feet.
  safety() {
    const g = this.game;
    const G = this.goal;
    const p = g.player;
    const vf = Math.max(g.speed + this.vdz, 2);
    const df = g.dist + this.dz;
    const look = Math.max(4, vf * 0.85);
    // a wall where she is, or where she's going: to the lane with the most
    // room, fast
    // walls: how much room each lane has before its next wall; she keeps to
    // a lane with room, moves early when hers is running out (to the
    // roomiest lane she can reach - never across a lane walled before she'd
    // be through it), and won't wander across a walled lane on a whim
    // (in the air, a bar is as good as a wall)
    const room = this.room || (this.room = [0, 0, 0]);
    const kinds = this.grounded ? 'W' : 'WH';
    for (let l = 0; l < 3; l++) {
      const o = this.threat(LANES[l], df - 0.7, df + vf * 3, kinds);
      room[l] = o ? o.d - (df + 0.6) : 1e9;
    }
    const here = this.laneOf(this.x);
    const need = vf * 1.15 + 2.5;
    const cross = vf * 0.42 + 1.6;
    // (between two lanes, both count)
    let tight = room[here];
    for (let l = 0; l < 3; l++) if (Math.abs(this.x - LANES[l]) < CONFIG.obstacleHalfWidth + this.hw + 0.05) tight = Math.min(tight, room[l]);
    const reach = (l) => {
      const a = Math.min(here, l), b = Math.max(here, l);
      for (let k = a + 1; k < b; k++) if (room[k] < cross * (k === a + 1 || k === b - 1 ? 1 : 1.5)) return false;
      return room[l] > cross;
    };
    const gl = this.laneOf(G.x);
    if (tight < need || room[gl] < need || !reach(gl)) {
      let best = here, score = -1e9;
      for (let l = 0; l < 3; l++) {
        if (l !== here && !reach(l)) continue;
        const sc = Math.min(room[l], vf * 3) - Math.abs(LANES[l] - this.x) * 1.5 + (l === gl ? 1 : 0);
        if (sc > score) {
          score = sc;
          best = l;
        }
      }
      if (best !== gl || tight < need) {
        G.x = LANES[best] + clamp(G.x - LANES[best], -0.3, 0.3);
        if (Math.abs(G.x - this.x) > 0.3) {
          G.w = Math.max(G.w, 18);
          G.urgent = true;
        }
      }
      if (this.fetching && Math.abs(this.fetching.gem.x - G.x) > 1) this.fetching = null;
    }
    // and no stepping sideways into a hurdle (or under a bar) too close to
    // time a leap over it: she holds her line until it's by
    if (tight >= need && this.grounded && Math.abs(G.x - this.x) > 0.05) {
      const near = df + vf * 0.65 + 1.5;
      if (this.threat(G.x, df - 0.6, near, 'LH') && !this.threat(this.x, df - 0.6, near, 'LH')) {
        // (and pulls up hard: no drifting on into it)
        G.x = this.x;
        G.urgent = true;
      }
    }
    // a hurdle (or water) ahead in her lane: leap it, the top of the leap
    // over its middle
    if (this.grounded) {
      const o = this.threat(this.x, df - 0.2, df + vf * 0.7 + 3, 'L');
      if (o) {
        // (caught late - swung into its lane by a wall - she springs harder,
        // so she's over its top by the time she reaches it)
        // (she winds up first: the spring comes that beat later)
        const G = this.C.gravity;
        // (now and then, over something low, the mousing pounce - a treat)
        if (this.hurdle !== o) {
          this.hurdle = o;
          this.hurdleKind = Math.random() < 0.12 && o.y1 < 0.8 && g.time - this.pouncedAt > this.C.pounceEvery ? 'pounce' : 'leap';
        }
        const kind = this.hurdleKind;
        const wind = this.C.windup[kind];
        let H = Math.max(this.C.leap, o.y1 + 0.42);
        const tr = (o.d - df - 0.5) / vf - wind;
        const late = tr < Math.sqrt((2 * H) / G) * 0.8;
        if (late) {
          const t = Math.max(0.04, tr + wind);
          const v = (o.y1 + 0.12) / t + (G * t) / 2;
          H = clamp(Math.max(H, (v * v) / (2 * G)), 0, 2.4);
        }
        const v0 = Math.sqrt(2 * this.C.gravity * H);
        const T = (2 * v0) / this.C.gravity;
        const mid = o.d + o.len / 2;
        const at = mid - df - vf * (T * 0.5 + wind) + 0.25;
        if (at <= 0.05 && !this.threat(this.x, df, df + vf * (T + wind) + 1, 'H')) {
          const k = late ? 'leap' : kind;
          if (k === 'pounce') this.pouncedAt = g.time;
          this.jump(H, k, late && tr < 0.02);
        }
      }
    }
    // out from under the runner's feet (unless she means to be there)
    const under = (this.beat === 'under' && this.stage === 1) || (this.beat === 'ride' && this.dz < -0.9);
    if (!under && Math.abs(this.dz) < 1.7 && (Math.abs(this.x - p.x) < 0.75 || Math.abs(G.x - p.x) < 0.75) && this.grounded) {
      const side = this.x >= p.x ? 1 : -1;
      const nx = p.x + side * 1.2;
      if (Math.abs(nx) < 3.0 && !this.threat(nx + side * 0.2, df - 0.8, df + look, 'LWH')) G.x = nx;
      else G.dz = this.dz > -0.2 ? Math.max(G.dz, 2.2) : Math.min(G.dz, -1.9);
      G.w = Math.max(G.w, 10);
    }
    G.x = clamp(G.x, -3, 3);
    G.dz = clamp(G.dz, this.C.behind, this.C.ahead);
  }

  // --- moving ------------------------------------------------------------------------------
  // A jump starts with a wind-up: she sinks into her legs (for the pounce,
  // rears up on her haunches) for a beat, then springs (now: no wind-up, if
  // she's caught late).
  jump(H, kind, now = false) {
    if (!this.grounded || this.windup) return;
    this.stopWhirl();
    this.sitting = false;
    const dur = now ? 0 : this.C.windup[kind] ?? 0.1;
    if (dur <= 0) this.launch(H, kind);
    else this.windup = { t: 0, dur, H, kind };
  }

  windupStep(dt) {
    const W = this.windup;
    if (W && (W.t += dt) >= W.dur) this.launch(W.H, W.kind);
  }

  launch(H, kind) {
    const G = this.C.gravity;
    this.windup = null;
    // (she springs along her line: no more speed across than she can shed
    // in the air before she's over it)
    const a = this.C.lateral.accAir, d = this.goal.x - this.x;
    this.vx = clamp(this.vx, d < 0 ? -this.stopV(-d, a) - 0.3 : -1.2, d > 0 ? this.stopV(d, a) + 0.3 : 1.2);
    this.vy = Math.sqrt(2 * G * H);
    this.grounded = false;
    this.air = { t: 0, T: (2 * this.vy) / G, kind };
  }

  fall(dt) {
    const G = this.C.gravity;
    this.y += this.vy * dt - 0.5 * G * dt * dt;
    this.vy -= G * dt;
    this.air.t += dt;
    if (this.y <= 0 && this.vy < 0) {
      this.y = 0;
      const hit = clamp(-this.vy / 8, 0.3, 1.4);
      this.vy = 0;
      this.grounded = true;
      this.body.land(hit);
    }
  }

  move(dt) {
    const g = this.game;
    const G = this.goal;
    // along: she can outrun you, and drop back (and pulls up hard to play)
    const S = this.C.surge;
    if (this.whirl && this.whirl.brake) {
      // (not right to a stop: you'd run past her, and off the screen she'd
      // go - she lets you gain on her, and plays out in front of you)
      const want = -Math.min(g.speed * 0.55, 6.5);
      this.vdz += clamp(want - this.vdz, -26 * dt, 26 * dt);
      this.dz += this.vdz * dt;
    } else {
      follow(this.dz, this.vdz, G.dz, G.wz, dt, _f);
      this.dz = _f[0];
      this.vdz = clamp(_f[1], S[0], S[1]);
    }
    // (while you run she never runs backwards over the ground; when you're
    // down she turns and trots back to you)
    if (g.state === 'running' && g.speed + this.vdz < 0) this.vdz = -g.speed;
    // across: a fox runs where she's facing, so she crosses the road on a
    // slant, never crabwise - how fast she can go across is a share of how
    // fast she's covering the ground (a steeper slant only to dodge), and
    // she leans into it and out of it rather than jolting sideways. In the
    // air she's carried across by her spring, steering only a little.
    const vf = Math.abs(g.speed + this.vdz);
    const L = this.C.lateral;
    const urgent = G.urgent;
    const a = this.grounded ? (urgent ? L.accDodge : L.acc) : L.accAir;
    follow(this.x, this.vx, G.x, this.grounded ? G.w : G.w * 0.6, dt, _f);
    let want = _f[1];
    if (this.grounded) {
      const cap = (urgent ? L.dodge : L.slant) * vf + L.base;
      want = clamp(want, -cap, cap);
    }
    // (and never faster at her line than she can pull up from by the time
    // she's on it: no sailing past it)
    want = clamp(want, -this.stopV(this.x - G.x, a), this.stopV(G.x - this.x, a));
    this.vx += clamp(want - this.vx, -a * dt, a * dt);
    this.x += this.vx * dt;
    this.windupStep(dt);
    if (!this.grounded) this.fall(dt);
    if (this.whirl) this.whirlStep(dt);
    else if (!this.sitting) this.yawFromMotion(dt);
  }

  // --- chasing her tail -----------------------------------------------------------------
  // The rarest thing she does, and only for the joy of it: she pulls up
  // short, and whirls once round on her own feet after her brush - her back
  // curled into a C, her head round to her tail, the tail flung out round
  // her - then she's off after you. Seldom (CONFIG.companion.whirl.every
  // seconds apart at the least), and only with a clear lane of her own to
  // do it in, well ahead of you.
  canWhirl() {
    const g = this.game;
    const p = g.player;
    if (g.time - this.whirledAt < this.C.whirl.every || !this.grounded || this.windup || this.ride) return false;
    const lane = this.laneOf(p.x);
    return [0, 1, 2].some((l) => l !== lane && this.openRoad(LANES[l], 3.2));
  }

  // The clear lane (not yours) nearest her, to play in.
  playLane(lanes) {
    const open = lanes.filter((l) => this.openRoad(LANES[l], 3.2));
    const from = open.length ? open : lanes;
    return from.reduce((a, b) => (Math.abs(LANES[b] - this.x) < Math.abs(LANES[a] - this.x) ? b : a));
  }

  // dir: which way round (+1 turning to her left, -1 to her right).
  startWhirl(dir) {
    this.whirl = { t: 0, dir, dur: this.C.whirl.dur, brake: true };
    this.whirledAt = this.game.time;
    this.cheer(this.C.whirl.dur + 1);
  }

  whirlStep(dt) {
    const W = this.whirl;
    W.t += dt;
    // a beat to pull up and gather, then once round, quick in the middle
    const lead = 0.14;
    const k = clamp((W.t - lead) / W.dur, 0, 1);
    const e = k * k * k * (k * (k * 6 - 15) + 10);
    this.spin = W.dir * Math.PI * 2 * e;
    // her back curls round toward her tail as she goes, and straightens out
    const c = clamp(W.t / (lead + 0.12), 0, 1) * (1 - clamp((k - 0.78) / 0.22, 0, 1));
    this.curl = W.dir * c * c * (3 - 2 * c);
    W.brake = k < 0.85;
    if (k >= 1) this.stopWhirl();
  }

  // Done (or cut short - she has a hurdle to see to): whatever's left of the
  // turn she makes up as she runs on.
  stopWhirl() {
    if (!this.whirl) return;
    this.yaw += this.spin;
    this.yaw -= Math.PI * 2 * Math.round(this.yaw / (Math.PI * 2));
    this.spin = 0;
    this.curl = 0;
    this.whirl = null;
  }

  // The fastest she can be crossing toward a line d away (d > 0 when it's
  // on that side) and still pull up on it, braking at a.
  stopV(d, a) {
    return d > 0 ? Math.sqrt(2 * a * 0.85 * d) : 1e9;
  }

  // Facing where she's going: along the road, angled across it only as far
  // as she's actually crossing it.
  yawFromMotion(dt) {
    const vf = this.game.speed + this.vdz;
    if (Math.hypot(vf, this.vx) < 0.4) return;
    if (vf > 0) this.turnTo(Math.atan2(-this.vx, Math.max(vf, 3)) * 0.9, 8, dt);
    else this.turnTo(Math.atan2(-this.vx, vf), 5, dt);
  }

  turnTo(want, k, dt) {
    let d = want - this.yaw;
    d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
    follow(0, this.yawV, d, k, dt, _f);
    this.yaw += _f[0];
    this.yawV = _f[1];
  }

  // drawn once at warm-up so her shaders are compiled before the run
  forCompile(on) {
    this.body.forCompile(on);
  }
}
