import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials } from '../render/shaders.js';
import { TAU, damp, clamp, smooth, Spring } from './rig.js';
import { palette } from './kit.js';
import { Player, C, mirror, hermite } from './player.js';
import { CONFIG } from '../config.js';
import { Dust } from './dust.js';

// The skater: Hazel, a young woman in an oversized neon-lime tee, baggy black
// skate shorts, white crew socks and chunky platform skate shoes, her long box
// braids up in a high ponytail (sculpted in tools/runner/skater.py) - and she
// doesn't run: she rides. On top of the shared runner (player.js), everything
// stands on her board, which is a body of its own (its bone is posed here,
// and her legs are solved down onto it every frame):
//   - she rides side-on to the road, regular (left foot forward), and between
//     rides she turns her front foot down the board and kicks: two or three
//     pushes off the road with her back foot, then she sets it back on the
//     tail and cruises - carving gently from heel to toe, pumping, bobbing,
//     in one of three ways (MOODS: carving wide with her arms out, chilling
//     upright and nodding along, crouched low and fast);
//   - three jumps, dealt so the same one never comes twice running: an ollie
//     (she pops the tail, slides her front foot up and tucks her knees right
//     up to her chest, the board stuck to her feet), a kickflip and a heelflip
//     (her front foot flicks off the board's edge - off the heel side for the
//     kickflip, off the toes for the heelflip - and the board flips a whole
//     turn under her as her feet lift out of its way; she catches it and rides
//     it down). Her jump goes higher than the runners' (but takes as long);
//   - she ducks right down on the board, a hand on its rail;
//   - every lane change is a carve, the board leaning hard into it;
//   - her braids are simulated one by one (twelve in the ponytail, four
//     framing her face - each a chain of bones swung by a little rope of
//     particles), her tee's hem flaps on springs and ripples in the wind (the
//     shader), her hoops swing.

// Palette slots: 1-13 are the garment ids baked into the mesh, the rest are
// colours the character shader draws her details with.
export const COL = {
  1: '#8a5334', // face (warm deep brown)
  2: '#21140e', // the cap of braids
  3: '#c6ef3a', // tee (neon lime)
  4: '#1e1e23', // shorts
  5: '#8a5334', // legs
  6: '#f3f1ec', // socks
  7: '#f2f0ea', // shoes
  8: '#8a5334', // arms, hands
  9: '#e2ab40', // gold
  10: '#2a2a2f', // deck (grip)
  11: '#b5b9c1', // trucks
  12: '#f3e8cf', // wheels
  13: '#1d120c', // braids
  14: '#4b2d1c', // braids, the warmer ones
  15: '#5b311f', // skin, deep
  16: '#a5704b', // skin, light
  17: '#5e2d24', // lips
  18: '#8a4a3c', // lips, light
  19: '#8fbf1c', // tee, deep
  20: '#e7ff86', // tee, light
  21: '#f6f6f2', // piping
  22: '#f6eee4', // eye whites
  23: '#3b2015', // irises
  24: '#140b07', // ink
  25: '#2f63c4', // sock stripe (blue)
  26: '#d4483b', // sock stripe (red)
  27: '#c9c8c4', // shoe panels (light grey)
  28: '#b6b1a7', // the sole's tread
  29: '#e3c18e', // maple (the deck's edge)
  30: '#5a3a28', // braid highlight
  31: '#7b4fd0', // the deck's graphic (purple)
};

// (no strides: her legs stand on the board)
const GAIT = { cadence: [0, 0] };

// How she handles: a carve between the lanes, leaning hard; a jump higher
// than the runners' (her board has to clear things too) in the same airtime,
// so every gap is as fair; she lands deep into her knees.
const FEEL = {
  laneSpring: 30,
  lean: [0.042, 0.48],
  turn: [0.034, 0.46],
  blend: [5, 7, 6.5],
  jump: { height: 1.9, time: CONFIG.jump.time },
  land: { freq: 3.4, zeta: 0.3, thud: 0.018 },
};

// Where her feet go on the board (its own space: z along it, -z the nose),
// and how far each is turned from the nose toward her toes (rad): riding,
// the front foot over the front bolts angled a little up the board, the back
// foot across the tail's bolts; popping a trick, the back foot on the tail.
const SPOT = { front: -0.17, back: 0.21, tail: 0.3, slide: -0.29 };
const ANGLE = { front: 1.12, back: 1.5, push: 0.28 };
// how far the middle of her shoe is ahead of her ankle
const SHOE_MID = 0.03;

// Riding, her stance: side-on (the hips turned to face her toes, +x), the
// shoulders open a little down the road, her head turned to see where she's
// going. In one of three moods, and every few seconds she drifts into
// another:
//   - flow: carving wide and slow, knees soft, arms out like wings;
//   - chill: tall and loose, arms down, nodding along to something;
//   - low: crouched down low and fast, the front arm reaching down the board.
const MOODS = {
  flow: { hipY: 0.965, hipPitch: 0.12, spLean: 0.24, chLean: 0.08, spTwist: 0.22, chTwist: 0.16, hdPitch: 0.1, shLx: 0.3, shRx: 0.12, shLz: 0.95, shRz: 0.8, shLy: 0.25, shRy: 0.1, elL: 0.45, elR: 0.6, wrL: 0.15, wrR: 0.2, carve: 1.3, pump: 0.7 },
  chill: { hipY: 0.995, hipPitch: 0.06, spLean: 0.1, chLean: -0.02, spTwist: 0.16, chTwist: 0.1, hdPitch: 0.06, shLx: 0.12, shRx: 0.02, shLz: 0.28, shRz: 0.24, shLy: 0.1, shRy: 0.1, elL: 0.35, elR: 0.42, wrL: 0.1, wrR: 0.1, carve: 0.6, pump: 0.35 },
  low: { hipY: 0.88, hipPitch: 0.2, spLean: 0.48, chLean: 0.14, spTwist: 0.3, chTwist: 0.2, hdPitch: -0.14, shLx: 0.75, shRx: -0.35, shLz: 1.15, shRz: 0.55, shLy: 0.15, shRy: -0.1, elL: 0.2, elR: 0.5, wrL: 0.0, wrR: 0.25, carve: 0.8, pump: 0.25 },
};
const MOOD_NAMES = Object.keys(MOODS);
const MOOD_HOLD = [3.2, 3.5];
const MOOD_EASE = 0.8;
const STANCE_YAW = -1.25;
// (standing about on the title screen she's turned to face more your way,
// her board turned with her)
const IDLE_YAW = -2.0;
const IDLE_BOARD = IDLE_YAW + 1.3;
const PUSH_YAW = -0.42;

// Pushing (body space; the road at y 0): the back foot steps off the tail
// down beside the board (G0), drives back along the road (to G1) and swings
// forward again - for the next push, or back up onto the tail.
const PUSH = { entry: 0.17, each: 0.46, drive: 0.19, G0: [0.2, -0.04], G1: [0.15, 0.4], n: [2, 3], gap: [2.6, 3.4] };

// Her jumps, dealt from a shuffled deck so the same one never comes twice
// running.
const TRICKS = ['ollie', 'kickflip', 'heelflip', 'ollie', 'kickflip', 'heelflip'];
// how high the board comes up toward her as she tucks (m over the road, at
// the top), and how far her feet lift off it while it flips
const TUCK = 0.33;
const FLIP_LIFT = 0.25;

// The crouch under a bar (by how far through the slide she is): down onto
// her heels, folded right over her knees, her front hand on the board's toe
// rail between her feet, the back arm up behind for balance, chin up to see.
const DUCK = { hipY: 0.5, hipX: 0.06, hipPitch: 0.32, hipYaw: -1.32, spLean: 1.02, chLean: 0.32, spTwist: 0.18, chTwist: 0.1, hdPitch: -0.62, hdYaw: 0.72, shLx: 1.35, shLz: 0.22, shLy: 0.1, elL: 0.35, wrL: 0.45, shRx: -0.4, shRz: 1.05, shRy: -0.2, elR: 0.45, wrR: 0.2 };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _hips = new THREE.Matrix4();
const _hipsInv = new THREE.Matrix4();
const _eul = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const mix = (a, b, k) => a + (b - a) * k;
const bump = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));
const ease = (x) => x * x * (3 - 2 * x);

export class Skater extends Player {
  constructor(envDef, asset) {
    super(envDef, asset, { gait: GAIT, feel: FEEL });
    // (the fox can ride on her shoulder, but there's a board between her feet)
    this.onBoard = true;
    // (her braids stream out a long way behind her; the board goes up with her)
    this.castR = 1.15;
    this.castTop = 2.1;
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    this.flutter = new THREE.Vector4();
    // (what the shader draws her details by: [0] x the socks' tops, y the
    // shoes' x, w the shorts' hem; [1] x the shoes' collars, z their soles'
    // height; [2] x how far down the arm the sleeves reach)
    const R0 = this.rig;
    const rig = [new THREE.Vector4(R0.sockTop, R0.shoeX, 0, R0.shortsHem), new THREE.Vector4(R0.shoeCollar, 0, R0.soleH, 0), new THREE.Vector4(R0.tee.end, 0, 0, 0)];
    const mats = makeCharacterMaterials(this.u, palette(COL), rig, 0.0072, null, { style: 'skater', uniforms: { uFlutter: { value: this.flutter } } });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.buildBody();
    this.dust = new Dust(this.u);
    const R = this.rig.board;
    this.BOARD_Y = R.y;
    this.ANKLE_H = this.HIP_JOINT.y - this.THIGH - this.SHIN;
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points];
  }

  forCompile(on) {
    this.dust.forCompile(on);
  }

  // --- state -----------------------------------------------------------------------
  buildSim() {
    super.buildSim();
    // the board: where it is in her body's space this frame (bPos: the middle
    // of its deck's top; bQ), and in the root's
    this.bPos = new THREE.Vector3();
    this.bQ = new THREE.Quaternion();
    this.bPosR = new THREE.Vector3();
    this.bQR = new THREE.Quaternion();
    this.free = { on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), back: 0 };
    // her feet this frame: ankle targets, the way they point (yaw), their
    // pitch, and how far each is to be laid flat on what it stands on
    this.feet = [0, 1].map(() => ({ at: new THREE.Vector3(), yaw: 0, pitch: 0, flat: 1, n: new THREE.Vector3(0, 1, 0) }));
    this.flip = { value: 0, from: 0, to: 0, t: 0, dur: 1, axis: 'z' };
    this.carveS = { roll: new Spring(), yaw: new Spring() };
    this.hemS = { F: new Spring(), B: new Spring(), L: new Spring(), R: new Spring() };
    this.buildBraids();
  }

  resetSim() {
    super.resetSim();
    this.deck = this.deck || [];
    this.trick = this.trick || 'ollie';
    this.lastDt = 0;
    this.moodK = this.moodK || { flow: 1, chill: 0, low: 0 };
    this.mood = 'flow';
    this.moodNext = MOOD_HOLD[0] + MOOD_HOLD[1] * Math.random();
    for (const k of MOOD_NAMES) this.moodK[k] = k === this.mood ? 1 : 0;
    this.push = { on: false, t: 0, n: 0, w: 0, foot: 0, next: 0.25, wantFirst: true, planted: -1 };
    this.pushPlant = false;
    this.greetT = 9;
    this.dodgeT = 9;
    this.dodgeDir = 1;
    this.flip.value = this.flip.from = this.flip.to = 0;
    this.free.on = false;
    this.free.back = 0;
    this.rolls = true;
    this.landT = 9;
    if (this.carveS) for (const s of Object.values(this.carveS)) s.reset();
    if (this.hemS) for (const s of Object.values(this.hemS)) s.reset();
    this.braidsReady = false;
    this.dust?.clear();
  }

  update(dt, speed, groundAt) {
    this.lastDt = dt;
    this.moodStep(dt);
    this.pushStep(dt, speed);
    this.greetT += dt;
    this.dodgeT += dt;
    this.landT += dt;
    super.update(dt, speed, groundAt);
    // (on the board, she rolls: tracks in the sand, not footprints)
    this.rolls = !this.crashed && this.mode === 'run';
  }

  place(z, dist = 0) {
    super.place(z);
    this.dust.update(this.lastDt, this.root, z, dist);
  }

  // --- moods and pushes ----------------------------------------------------------------
  // Every few seconds of riding she drifts into another mood (MOODS), easing
  // from one to the other; now and then, as she does, she pushes again.
  moodStep(dt) {
    if (this.mode === 'run' && !this.crashed) {
      this.moodNext -= dt;
      if (this.moodNext <= 0 && this.grounded && !this.sliding) {
        let m;
        do m = MOOD_NAMES[Math.floor(Math.random() * MOOD_NAMES.length)];
        while (m === this.mood);
        this.mood = m;
        this.moodNext = MOOD_HOLD[0] + MOOD_HOLD[1] * Math.random();
      }
    }
    for (const k of MOOD_NAMES) this.moodK[k] = clamp(this.moodK[k] + (k === this.mood ? 1 : -1) * (dt / MOOD_EASE), 0, 1);
  }

  // Keep to one mood (the viewer: &mood=).
  holdStyle(name) {
    if (!MOODS[name]) return;
    this.mood = name;
    this.moodNext = Infinity;
    for (const k of MOOD_NAMES) this.moodK[k] = k === name ? 1 : 0;
  }

  // Two or three pushes off the road at the start of a run, and again every
  // few seconds - only with her wheels on the road and nothing else going on
  // (anything that needs her back foot on the board puts it back at once).
  pushStep(dt, speed) {
    const P = this.push;
    const free = this.mode === 'run' && !this.crashed && this.grounded && !this.sliding && speed > 2 && this.w.jump < 0.3 && this.w.slide < 0.2;
    if (P.on) {
      P.t += dt;
      const end = PUSH.entry + P.n * PUSH.each;
      if (!free || P.t >= end) {
        P.on = false;
        P.next = PUSH.gap[0] + PUSH.gap[1] * Math.random();
      } else {
        // a foot planted: a scuff of dust, a print in the sand
        const i = Math.floor((P.t - PUSH.entry) / PUSH.each);
        if (P.t > PUSH.entry && i !== P.planted && i < P.n) {
          P.planted = i;
          this.pushPlant = true;
          this.scuff();
        }
      }
    } else if (free) {
      P.next -= dt;
      if (P.next <= 0 || P.wantFirst) this.startPush(P.wantFirst ? 3 : PUSH.n[0] + Math.floor(Math.random() * (PUSH.n[1] - PUSH.n[0] + 1)));
    }
    if (this.mode !== 'run') P.wantFirst = true;
    // (the stance turns with it: in quickly, out a little slower)
    const want = P.on ? this.pushStance(P.t, P.n) : 0;
    P.w = damp(P.w, want, want > P.w ? 18 : 12, dt);
  }

  startPush(n) {
    const P = this.push;
    P.on = true;
    P.t = 0;
    P.n = n;
    P.planted = -1;
    P.wantFirst = false;
  }

  // how far she's turned into her pushing stance, t into a run of n pushes
  pushStance(t, n) {
    const end = PUSH.entry + n * PUSH.each;
    return smooth(0, PUSH.entry, t) * (1 - smooth(end - 0.24, end - 0.02, t));
  }

  // The back foot through a run of pushes (body space ankle target, its
  // yaw and pitch, whether it's on the road): off the tail, down beside the
  // board, driven back, swung forward again.
  pushFoot(out) {
    const P = this.push;
    const t = P.t;
    const { ANKLE_H } = this;
    const g0 = PUSH.G0, g1 = PUSH.G1;
    const tail = this.feet[1].board;
    const end = PUSH.entry + P.n * PUSH.each;
    let x, y, z, yaw = -0.18, pitch = 0, ground = 0;
    if (t < PUSH.entry) {
      const e = ease(t / PUSH.entry);
      x = mix(tail.x, g0[0], e);
      z = mix(tail.z, g0[1], e);
      y = mix(tail.y, ANKLE_H, e) + 0.11 * Math.sin(Math.PI * e);
      yaw = mix(tail.yaw, -0.18, smooth(0, 0.6, e));
      pitch = -0.25 * Math.sin(Math.PI * e);
      ground = smooth(0.85, 1, e);
    } else {
      const i = Math.min(P.n - 1, Math.floor((t - PUSH.entry) / PUSH.each));
      const u = (t - PUSH.entry - i * PUSH.each) / PUSH.each;
      const dr = PUSH.drive / PUSH.each;
      if (u < dr) {
        // driving back along the road, the heel peeling up at the end
        const e = u / dr;
        const k = e * e * (3 - 2 * e) * 0.7 + e * 0.3;
        x = mix(g0[0], g1[0], k);
        z = mix(g0[1], g1[1], k);
        y = ANKLE_H + 0.03 * smooth(0.7, 1, e);
        pitch = -0.55 * smooth(0.55, 1, e);
        ground = 1 - smooth(0.85, 1, e);
      } else {
        // swinging forward: the heel kicks up behind, the knee drives
        // through; back onto the tail after the last
        const e = (u - dr) / (1 - dr);
        const last = i === P.n - 1;
        const to = last ? [tail.x, tail.z, tail.y] : [g0[0], g0[1], ANKLE_H];
        const k = ease(e);
        x = mix(g1[0], to[0], k);
        z = mix(g1[1], to[1], k) + 0.08 * Math.sin(Math.PI * e) * (1 - e);
        y = mix(ANKLE_H + 0.03, to[2], k) + (last ? 0.16 : 0.13) * Math.sin(Math.PI * Math.pow(e, 0.8));
        pitch = -0.55 * (1 - smooth(0, 0.5, e)) + 0.1 * Math.sin(Math.PI * e);
        if (last) yaw = mix(-0.18, tail.yaw, smooth(0.4, 0.9, e));
        ground = last ? 0 : smooth(0.88, 1, e);
      }
    }
    out.x = x;
    out.y = y;
    out.z = z;
    out.yaw = yaw;
    out.pitch = pitch;
    out.ground = ground;
    out.done = t >= end;
  }

  // A scuff of dust off the road where her foot comes down to push.
  scuff() {
    if (this.wet) return;
    const r = Math.random;
    const run = _dv.set(this.vx, 0, -this.speed);
    for (let k = 0; k < 2; k++) {
      _p.copy(run).multiplyScalar(0.3 + 0.1 * r());
      _p.x += 0.6 + 0.8 * r();
      _p.y += 0.3 + 0.4 * r();
      _p.z += 0.5 * r();
      this.dust.emit(_v.set(PUSH.G0[0] + 0.05, 0.04, PUSH.G0[1] + 0.1 * k), _p, 0.16 + 0.06 * r());
    }
  }

  // --- moves ------------------------------------------------------------------------
  jump() {
    const want = this.nextTrick;
    this.nextTrick = null;
    if (want) this.trick = want;
    else {
      if (!this.deck.length) {
        const d = TRICKS.slice();
        for (let i = d.length - 1; i > 0; i--) {
          const k = Math.floor(Math.random() * (i + 1));
          [d[i], d[k]] = [d[k], d[i]];
        }
        if (d[d.length - 1] === this.trick) d.reverse();
        this.deck = d;
      }
      this.trick = this.deck.pop();
    }
    super.jump();
    this.push.on = false;
    // (a flip still turning finishes quickly)
    this.flip.value = wrapAngle(this.flip.value);
    this.flip.from = this.flip.to = this.flip.value;
  }

  onFastFall() {}

  onLand(hit) {
    this.landT = 0;
    if (this.crashed || this.mode !== 'run') return;
    if (!this.wet) this.landDust(hit);
  }

  onDodge(dir) {
    this.dodgeT = 0;
    this.dodgeDir = dir;
    this.push.on = false;
  }

  startSlide() {
    super.startSlide();
    this.push.on = false;
  }

  crash() {
    super.crash();
    // the board shoots off on its own, tumbling down the road
    const F = this.free;
    F.on = true;
    F.p.copy(this.bPosR);
    F.q.copy(this.bQR);
    F.v.set(this.vx * 0.5 + (Math.random() - 0.5) * 1.5, 3.2, -6.5);
    F.w.set(9 + 4 * Math.random(), (Math.random() - 0.5) * 8, 7 * (Math.random() < 0.5 ? -1 : 1));
    F.back = 0;
  }

  revive() {
    super.revive();
    // and it comes back under her feet
    this.free.back = 0.9;
  }

  // Picked on the title screen: a pop shove-it - a little hop, the board
  // spinning a whole turn under her - and back down on it.
  greet() {
    this.greetT = 0;
  }

  // --- poses ------------------------------------------------------------------------
  // Riding (r: the pose; f: the stride's phase, which doesn't run; sp: the
  // pace): her stance in the moods she's in, carving and pumping, turned
  // toward pushing as far as she is.
  poseRun(r, f, sp) {
    const t = this.time;
    r.fill(0);
    r[C.sq] = 1;
    // the moods, blended
    let tot = 0;
    for (const k of MOOD_NAMES) tot += this.moodK[k];
    tot = tot || 1;
    let carve = 0, pump = 0;
    for (const k of MOOD_NAMES) {
      const w = this.moodK[k] / tot;
      if (w <= 0) continue;
      const M = MOODS[k];
      for (const ch in M) if (C[ch] !== undefined) r[C[ch]] += M[ch] * w;
      carve += M.carve * w;
      pump += M.pump * w;
    }
    const chill = this.moodK.chill / tot;
    // the carve, heel to toe and back, and a pump of the knees with it
    const ph = t * 2.05 + 0.6 * Math.sin(t * 0.37);
    const cv = Math.sin(ph);
    this.carveAmt = carve;
    r[C.hipX] = 0.03 * carve * Math.sin(ph - 0.35);
    r[C.hipRoll] = 0.03 * carve * cv;
    r[C.hipY] += -0.028 * pump * (0.5 + 0.5 * Math.sin(ph * 2 - 0.5)) - 0.01 * sp;
    r[C.spLean] += 0.06 * carve * Math.sin(ph - 0.3) + 0.06 * sp;
    r[C.spSide] = -0.05 * carve * cv;
    // (chilling, she nods along)
    const nod = Math.pow(Math.abs(Math.sin(t * 4.4)), 3);
    r[C.hdPitch] += 0.08 * chill * nod;
    r[C.hipY] -= 0.012 * chill * nod;
    // arms balance against the carve
    r[C.shLz] += 0.12 * carve * cv;
    r[C.shRz] -= 0.12 * carve * cv;
    r[C.shLx] += 0.06 * Math.sin(t * 1.3 + 1);
    r[C.shRx] += 0.06 * Math.sin(t * 1.1 + 2);
    r[C.elL] += 0.08 * Math.sin(t * 1.7);
    r[C.elR] += 0.08 * Math.sin(t * 1.5 + 1);
    // side-on, her head turned down the road
    r[C.hipYaw] = STANCE_YAW;
    r[C.hdYaw] = -0.94 * (STANCE_YAW + r[C.spTwist] + r[C.chTwist]) + 0.08 * Math.sin(t * 0.43);
    r[C.hdRoll] = 0.06 + 0.04 * Math.sin(t * 0.31);
    this.posePush(r, sp);
    // (with the fox riding on her shoulder, the arm under her stays down)
    if (this.rider) {
      const left = this.rider < 0;
      r[left ? C.shLz : C.shRz] = Math.min(r[left ? C.shLz : C.shRz], 0.3);
      r[left ? C.shLx : C.shRx] = Math.min(r[left ? C.shLx : C.shRx], 0.2);
    }
  }

  // Turned toward pushing as far as she is: hips and shoulders square to the
  // road, leaning into it, sinking on her front knee as the back foot drives,
  // her arms swinging with it.
  posePush(r, sp) {
    const P = this.push;
    const w = P.w;
    if (w <= 0.001) return;
    const t = P.t;
    let drive = 0, swing = 0;
    if (P.on && t > PUSH.entry) {
      const i = Math.min(P.n - 1, Math.floor((t - PUSH.entry) / PUSH.each));
      const u = (t - PUSH.entry - i * PUSH.each) / PUSH.each;
      const dr = PUSH.drive / PUSH.each;
      drive = bump(0, 0.15, 0.7, 1.15, u / dr);
      swing = Math.sin(TAU * (u - 0.08));
    }
    const k = (a, v) => (r[C[a]] += (v - r[C[a]]) * w);
    k('hipYaw', PUSH_YAW);
    k('hipPitch', 0.16);
    k('hipX', 0.05);
    k('hipRoll', -0.04);
    k('spLean', 0.34 + 0.12 * drive + 0.05 * sp);
    k('chLean', 0.08);
    k('spTwist', 0.12);
    k('chTwist', 0.04 + 0.08 * swing);
    k('spSide', 0.04);
    k('hipY', 0.93 - 0.1 * drive);
    k('hdPitch', 0.05);
    k('hdYaw', -0.9 * (PUSH_YAW + 0.16) - 0.06 * swing);
    k('shLx', 0.25 - 0.55 * swing);
    k('shRx', 0.15 + 0.6 * swing);
    k('shLz', 0.32);
    k('shRz', 0.36);
    k('shLy', 0.1);
    k('shRy', 0.1);
    k('elL', 0.55 + 0.15 * Math.max(0, -swing));
    k('elR', 0.55 + 0.15 * Math.max(0, swing));
  }

  // Standing on her board on the title screen: hands in her pockets, her
  // weight drifting from heel to toe, looking about, not much impressed -
  // and when she's picked, the pop shove-it.
  poseIdle(id, t) {
    id.fill(0);
    id[C.sq] = 1;
    const br = Math.sin(t * 1.9);
    const ws = Math.sin(t * 0.47 + 0.6 * Math.sin(t * 0.19));
    id[C.hipY] = 0.99 + 0.004 * br;
    id[C.hipX] = 0.03 * ws;
    id[C.hipYaw] = IDLE_YAW + 0.04 * Math.sin(t * 0.3);
    id[C.hipRoll] = 0.035 * ws;
    id[C.hipPitch] = 0.02;
    id[C.spLean] = 0.02 + 0.01 * br;
    id[C.spTwist] = 0.08 + 0.04 * Math.sin(t * 0.41);
    id[C.spSide] = -0.04 * ws;
    id[C.chLean] = -0.05;
    id[C.chTwist] = 0.05;
    // looking about: down the road, over her shoulder at you, away
    const look = Math.sin(t * 0.36) + 0.5 * Math.sin(t * 0.83 + 1);
    id[C.hdYaw] = -0.35 + 0.55 * look;
    id[C.hdPitch] = 0.02 + 0.04 * Math.sin(t * 0.6);
    id[C.hdRoll] = 0.1 + 0.05 * Math.sin(t * 0.27);
    // hands in her pockets
    for (const [sh, sy, sz, el, wr, wz] of [[C.shLx, C.shLy, C.shLz, C.elL, C.wrL, C.wrLz], [C.shRx, C.shRy, C.shRz, C.elR, C.wrR, C.wrRz]]) {
      id[sh] = -0.1 + 0.015 * br;
      id[sy] = 0.38;
      id[sz] = 0.16;
      id[el] = 0.5;
      id[wr] = -0.12;
      id[wz] = 0.05;
    }
    // the shove-it's hop: out of her pockets, arms out
    const g = this.greetHop();
    id[C.hipY] += 0.2 * g.up - 0.06 * g.crouch;
    id[C.spLean] += 0.2 * g.up + 0.15 * g.crouch;
    id[C.hdPitch] += 0.35 * g.up;
    id[C.hdYaw] += (0.45 - id[C.hdYaw]) * g.any;
    id[C.shLx] += 0.6 * g.up;
    id[C.shRx] += 0.3 * g.up;
    id[C.shLz] += 0.9 * g.up;
    id[C.shRz] += 0.8 * g.up;
    id[C.shLy] -= 0.3 * g.any;
    id[C.shRy] -= 0.3 * g.any;
    id[C.elL] -= 0.15 * g.up;
    id[C.elR] -= 0.15 * g.up;
    return ws;
  }

  // the pop shove-it, by time since she was picked
  greetHop() {
    const T = 0.62;
    const u = this.greetT / T;
    if (u >= 1) return { u: 1, up: 0, crouch: 0, any: 0, spin: 0, off: 0 };
    return {
      u,
      up: bump(0.1, 0.42, 0.55, 0.9, u),
      crouch: bump(0, 0.08, 0.1, 0.18, u) + bump(0.86, 0.93, 0.95, 1, u),
      any: bump(0, 0.1, 0.85, 1, u),
      spin: ease(smooth(0.18, 0.78, u)),
      off: bump(0.18, 0.3, 0.66, 0.8, u),
    };
  }

  // In the air (j: the pose), keyed on how far through the jump she is (0
  // take-off, 0.5 the top, 1 landing): popped up off the tail, knees tucked
  // right up, arms up and out, her eyes on the board.
  poseJump(j) {
    const u = this.jumpU();
    const top = Math.sin(Math.PI * u);
    const flipping = this.trick !== 'ollie';
    const kick = this.trick === 'heelflip' ? -1 : 1;
    j.fill(0);
    j[C.sq] = 1;
    j[C.hipY] = 0.99 + 0.04 * top;
    j[C.hipYaw] = -1.3;
    j[C.hipPitch] = 0.15 + 0.1 * top;
    j[C.spLean] = 0.22 + 0.22 * top;
    j[C.chLean] = 0.08 + 0.06 * top;
    j[C.spTwist] = 0.16;
    j[C.chTwist] = 0.08;
    j[C.hdPitch] = 0.22 + 0.25 * top * (flipping ? 1.3 : 1);
    j[C.hdYaw] = 0.78 - 0.18 * top;
    j[C.hdRoll] = 0.05;
    // arms flung up and out for balance (the flick throws them a little
    // the other way)
    j[C.shLz] = 1.0 + 0.35 * top;
    j[C.shRz] = 0.9 + 0.3 * top;
    j[C.shLx] = 0.4 + 0.25 * top - (flipping ? 0.2 * kick * top : 0);
    j[C.shRx] = 0.15 + 0.15 * top + (flipping ? 0.2 * kick * top : 0);
    j[C.shLy] = 0.1;
    j[C.shRy] = -0.1;
    j[C.elL] = 0.45 - 0.15 * top;
    j[C.elR] = 0.5 - 0.15 * top;
    j[C.wrL] = 0.1;
    j[C.wrR] = 0.1;
  }

  // how far through the jump she is (0 take-off .. 1 landing), from the
  // climb and fall
  jumpU() {
    return clamp(0.5 - (0.5 * this.vyPose) / this.V0, 0, 1);
  }

  // The duck: down onto her heels, folded over her knees, a hand on the
  // rail; and back up as it ends.
  poseSlide(s) {
    if (this.slideT > 0) this.slideU = 1 - clamp(this.slideT / CONFIG.slide.time, 0, 1);
    const u = this.slideU ?? 1;
    const k = smooth(0.0, 0.18, u) * (1 - smooth(0.82, 1.0, u));
    const base = this.pRun;
    s.set(base);
    for (const ch in DUCK) {
      const i = C[ch];
      s[i] = base[i] + (DUCK[ch] - base[i]) * k;
    }
    // (a rattle over the road, crouched so low)
    s[C.spLean] += 0.015 * Math.sin(this.time * 41) * k;
    this.duckK = k;
  }

  // She lands deep into her knees, folding over them, arms swung down - and
  // springs back up out of it.
  landOverlay(Pz, land) {
    const d = Math.max(0, land), p = Math.max(0, -land);
    Pz[C.hipY] += -0.13 * d + 0.03 * p;
    Pz[C.spLean] += 0.34 * d - 0.05 * p;
    Pz[C.chLean] += 0.1 * d;
    Pz[C.hdPitch] += 0.12 * d;
    Pz[C.shLz] += 0.3 * d + 0.2 * p;
    Pz[C.shRz] += 0.3 * d + 0.2 * p;
    Pz[C.shLx] += 0.35 * d;
    Pz[C.shRx] += 0.2 * d;
    Pz[C.elL] -= 0.2 * d;
    Pz[C.elR] -= 0.2 * d;
  }

  // A lane change: a carve, crouching into it - side-on as she is, a turn to
  // her right is on her toes (leaning out over them) and one to her left on
  // her heels (sitting back, arms reaching forward).
  laneOverlay(Pz, lc, dt) {
    const e = this.dodgeT < 0.36 ? Math.sin((this.dodgeT / 0.36) * Math.PI) : 0;
    const w = this.w.run;
    const toe = Math.max(0, lc), heel = Math.max(0, -lc);
    Pz[C.hipY] -= 0.05 * e * w;
    Pz[C.hipX] += 0.07 * lc * w;
    Pz[C.spLean] += (0.24 * toe - 0.12 * heel) * w;
    Pz[C.chLean] += 0.06 * toe * w;
    Pz[C.hdYaw] -= 0.22 * lc;
    Pz[C.hdRoll] += 0.1 * lc;
    Pz[C.shLz] += 0.25 * e + 0.2 * heel;
    Pz[C.shRz] += 0.25 * e + 0.2 * heel;
    Pz[C.shLx] += 0.3 * heel - 0.1 * toe;
    Pz[C.shRx] += 0.3 * heel - 0.1 * toe;
    this.laneC = lc;
  }

  // Flying in low gravity: not tipped over like the runners - she surfs the
  // air on her board, crouched, arms out wide (the spinning styles turn her
  // and her board together).
  flyOverlay(Pz, w, t) {
    const k = w * 0.85;
    const bob = Math.sin(t * 2.3);
    const f = (ch, v) => (Pz[C[ch]] += (v - Pz[C[ch]]) * k);
    f('hipY', 0.93 + 0.02 * bob);
    f('hipYaw', -1.3);
    f('hipPitch', 0.18);
    f('spLean', 0.36 + 0.03 * bob);
    f('chLean', 0.1);
    f('hdPitch', 0.0);
    f('shLz', 1.3 + 0.08 * bob);
    f('shRz', 1.2 - 0.08 * bob);
    f('shLx', 0.4);
    f('shRx', 0.1);
    f('elL', 0.3);
    f('elR', 0.3);
  }

  // --- the board and her feet ------------------------------------------------------------
  // Where the board is this frame in her body's space, and where her feet go:
  // on it (in their spots) or off it (pushing; out of its way while it flips;
  // tucked up over it in the shove-it).
  skatePlan(Pz) {
    const t = this.time;
    const { BOARD_Y, ANKLE_H } = this;
    const W = this.w;
    const tot = W.run + W.jump + W.slide + W.idle || 1;
    const wr = W.run / tot, wj = W.jump / tot, ws = W.slide / tot, wi = W.idle / tot;
    // --- the board ---
    // carving (riding): rolled from heel to toe and back, swung with it; hard
    // into a lane change
    const ph = t * 2.05 + 0.6 * Math.sin(t * 0.37);
    const carve = (this.carveAmt ?? 1) * wr * (1 - this.push.w);
    const lc = this.laneC || 0;
    const roll = this.carveS.roll.step(0.075 * carve * Math.sin(ph) - 0.2 * lc * (wr + ws), 3.5, 0.6, this.lastDt || 1 / 60);
    const yaw = this.carveS.yaw.step(0.045 * carve * Math.sin(ph - 0.7) + 0.12 * lc * (wr + ws), 3, 0.6, this.lastDt || 1 / 60);
    // the jump: popped off its tail, up toward her as she tucks, flipping
    const u = this.jumpU();
    const trick = this.trick;
    const flipping = trick !== 'ollie' && this.mode === 'run';
    const pop = wj * bump(0, 0.05, 0.08, 0.3, u);
    const lift = wj * TUCK * Math.pow(Math.sin(Math.PI * u), 0.75);
    // (the flip itself, keyed on how far through the jump she is: so a
    // fast-fall, or landing early, just hurries it round)
    // (only while she's up, or the jump's pose is still fading: before any
    // jump, how far through one she is means nothing)
    const air = !this.grounded || this.w.jump > 0.01;
    const fp = flipping && air ? ease(smooth(0.13, 0.62, u)) : 0;
    const flip = fp * TAU * (trick === 'heelflip' ? -1 : 1);
    // the shove-it on the title screen
    const g = this.greetHop();
    const hop = wi * (0.22 * g.up);
    const spin = wi * g.spin * TAU;
    // the stumble wobbles it
    const wob = this.stumbleT > 0 ? 0.12 * Math.sin(t * 24) * (this.stumbleT / 0.6) : 0;

    const q = this.bQ.identity();
    q.multiply(_q.setFromAxisAngle(AY, yaw + IDLE_BOARD * wi));
    q.multiply(_q.setFromAxisAngle(AZ, roll + wob));
    const P = this.bPos.set(0.012 * carve * Math.sin(ph - 0.35), BOARD_Y + lift + hop, 0);
    // (the pop turns it nose up about its tail on the road)
    if (pop > 0) {
      const pv = _v.set(0, -BOARD_Y, 0.36);
      _q2.setFromAxisAngle(AX, 0.48 * pop);
      P.add(_v2.copy(pv).applyQuaternion(q)).sub(_v3.copy(pv).applyQuaternion(_q3.copy(q).multiply(_q2)));
      q.multiply(_q2);
    }
    // --- the feet ---
    // the spots they stand in: popping, the back foot goes to the tail and
    // the front slides up toward the nose; ducking, the front foot goes up
    // by the front bolts
    const popK = wj * bump(0, 0.04, 0.35, 0.6, u);
    const slideUp = wj * bump(0.04, 0.2, 0.3, 0.55, u);
    const zF = mix(SPOT.front, -0.3, slideUp) + (SPOT.slide - SPOT.front) * 0.3 * ws;
    const zB = mix(SPOT.back, SPOT.tail, popK);
    const aF = mix(ANGLE.front, ANGLE.push, this.push.w);
    const fronts = [this.footOnBoard(this.feet[0], zF, aF), this.footOnBoard(this.feet[1], zB, ANGLE.back)];
    // off the board while it flips: the front foot flicked out (off the heel
    // side for a kickflip, the toes for a heelflip) and up, the back one
    // lifted up over it; caught, and ridden down
    const off = flipping ? wj * bump(0.1, 0.2, 0.58, 0.7, u) : 0;
    const off2 = wi * g.off;
    if (off > 0 || off2 > 0) {
      const side = trick === 'heelflip' ? 1 : -1;
      for (let i = 0; i < 2; i++) {
        const F = this.feet[i];
        if (off > 0) {
          _v.set(i === 0 ? side * 0.17 : side * 0.04, FLIP_LIFT + (i === 0 ? 0.05 : 0), i === 0 ? -0.08 : 0.04);
          F.at.lerp(_v.add(this.restFoot(i)), off);
          F.pitch += (i === 0 ? -0.35 : -0.15) * off;
          F.flat *= 1 - off;
        }
        if (off2 > 0) {
          F.at.y += 0.16 * off2;
          F.flat *= 1 - off2;
        }
      }
    }
    // pushing: the back foot through its push
    const pw = this.push.w;
    if (pw > 0.001) {
      const pf = this.pushPath || (this.pushPath = {});
      if (this.push.on) this.pushFoot(pf);
      else if (pf.x === undefined) pf.x = fronts[1].x;
      const F = this.feet[1];
      _v.set(pf.x, pf.y, pf.z);
      F.at.lerp(_v, pw);
      F.yaw = mix(F.yaw, pf.yaw, pw);
      F.pitch = mix(F.pitch, pf.pitch, pw);
      // (flat on the road while it's down; on the tail as it comes back)
      F.n.lerp(UP, pw * pf.ground);
      F.flat = mix(F.flat, pf.ground, pw);
    }
    // (the feet placed, the board's own turns go on: the flip about its long
    // axis, through its middle; the shove-it about the upright)
    if (flip !== 0) this.turnBoard(AZ, flip, -0.04);
    if (spin !== 0) this.turnBoard(AY, spin, 0);
    this.boardFlip = flip;
  }

  // Turn the board about one of its own axes through a point h up from the
  // middle of its deck's top.
  turnBoard(axis, angle, h) {
    const q = this.bQ;
    const pv = _v.set(0, h, 0);
    _q2.setFromAxisAngle(axis, angle);
    this.bPos.add(_v2.copy(pv).applyQuaternion(q)).sub(_v3.copy(pv).applyQuaternion(_q3.copy(q).multiply(_q2)));
    q.multiply(_q2);
  }

  // Where a foot would be standing in its spot on the board (its ankle,
  // the way it points, laid flat on the deck): the spot z along the board,
  // turned angle from its nose toward her toes. Returns that spot as the
  // push sees it (body space x, y, z, yaw).
  footOnBoard(F, z, angle) {
    const q = this.bQ;
    const D = this.rig.board;
    // (the deck rises into its kicks)
    const t = Math.max(0, Math.abs(z) - D.kickFrom);
    const rise = D.kick * Math.pow(t / (D.halfLen - D.kickFrom), 2);
    _p.set(0, rise, z).applyQuaternion(q).add(this.bPos);
    _n.set(0, 1, 0).applyQuaternion(q);
    // (on the kick, the deck slopes)
    if (t > 0) {
      const slope = (2 * D.kick * t) / Math.pow(D.halfLen - D.kickFrom, 2) * Math.sign(z);
      _n.set(0, 1, -slope).normalize().applyQuaternion(q);
    }
    const dir = _a.set(Math.sin(angle), 0, -Math.cos(angle)).applyQuaternion(q);
    F.at.copy(_p).addScaledVector(_n, this.ANKLE_H).addScaledVector(dir, -SHOE_MID);
    F.n.copy(_n);
    F.yaw = Math.atan2(-dir.x, -dir.z);
    F.pitch = 0;
    F.flat = 1;
    F.board = F.board || {};
    F.board.x = F.at.x;
    F.board.y = F.at.y;
    F.board.z = F.at.z;
    F.board.yaw = F.yaw;
    return F.board;
  }

  // (a foot's spot as it sits riding, before anything moves it: for the
  // flips, which lift the feet from there)
  restFoot(i) {
    return _b.set(this.feet[i].board.x, this.feet[i].board.y, this.feet[i].board.z);
  }

  // Both legs solved onto their targets (body space) for this pose's hips.
  legsOnBoard(Pz) {
    _eul.set(-Pz[C.hipPitch], Pz[C.hipYaw], Pz[C.hipRoll]);
    _hips.compose(_v3.set(Pz[C.hipX], Pz[C.hipY], 0), _q.setFromEuler(_eul), _one);
    _hipsInv.copy(_hips).invert();
    const cw = this.crashW || 0;
    const keep = this.legKeep || (this.legKeep = new Float32Array(12));
    const LEG = [C.thLx, C.thLy, C.thLz, C.knL, C.anL, C.toL, C.thRx, C.thRy, C.thRz, C.knR, C.anR, C.toR];
    if (cw > 0) for (let i = 0; i < 12; i++) keep[i] = Pz[LEG[i]];
    for (let side = 0; side < 2; side++) {
      const F = this.feet[side];
      this.legTo(Pz, side, F.at, F.yaw, F.pitch);
    }
    if (cw > 0) for (let i = 0; i < 12; i++) Pz[LEG[i]] += (keep[i] - Pz[LEG[i]]) * cw;
  }

  // Two-bone solve of one leg for an ankle target (body space) and the way
  // its foot is to point (yaw, about the vertical; and its pitch): as the
  // shared runner's solve (player.js: solveLeg), but the foot turned where
  // it's told, not down the road.
  legTo(r, side, at, footYaw, pitch) {
    const { HIP_JOINT, HIP_Y, THIGH, SHIN } = this;
    const sx = side === 0 ? -1 : 1;
    const d = _v.copy(at).applyMatrix4(_hipsInv);
    d.x -= sx * HIP_JOINT.x;
    d.y -= HIP_JOINT.y - HIP_Y;
    const yaw = wrapAngle(footYaw - r[C.hipYaw]);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    d.set(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
    let L = d.length();
    L = clamp(L, Math.abs(THIGH - SHIN) + 0.02, THIGH + SHIN - 0.003);
    const kn = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - L * L) / (2 * THIGH * SHIN), -1, 1));
    const ly = -THIGH - SHIN * Math.cos(kn);
    const lz = SHIN * Math.sin(kn);
    const ll = Math.hypot(ly, lz);
    const tz = Math.asin(clamp(-d.x / (Math.hypot(d.y, d.z, d.x) * Math.min(ly / ll, -0.8)), -0.95, 0.95));
    const tx = Math.atan2(d.z, d.y) - Math.atan2(lz / ll, (Math.cos(tz) * ly) / ll);
    const thx = wrapAngle(tx);
    const shin = -r[C.hipPitch] + thx - kn;
    if (side === 0) {
      r[C.thLx] = thx;
      r[C.thLy] = yaw;
      r[C.thLz] = -tz;
      r[C.knL] = kn;
      r[C.anL] = pitch - shin;
      r[C.toL] = 0;
    } else {
      r[C.thRx] = thx;
      r[C.thRy] = -yaw;
      r[C.thRz] = tz;
      r[C.knR] = kn;
      r[C.anR] = pitch - shin;
      r[C.toR] = 0;
    }
  }

  applyPose(Pz, roll) {
    this.skatePlan(Pz);
    this.legsOnBoard(Pz);
    const b = this.b;
    for (const k of ['footL', 'footR', 'toeL', 'toeR']) b[k].rotation.set(0, 0, 0);
    super.applyPose(Pz, roll);
  }

  // The board onto its bone (from her body's space into the root's - or
  // tumbling on its own, after a crash), and each foot laid flat on whatever
  // it stands on.
  afterPose(dt, cw) {
    const b = this.b;
    const body = b.body;
    body.updateMatrix();
    // her body's space -> the root's
    this.bPosR.copy(this.bPos).applyMatrix4(body.matrix);
    _q.setFromRotationMatrix(_m.extractRotation(body.matrix));
    this.bQR.copy(_q).multiply(this.bQ);
    const F = this.free;
    if (F.on) {
      this.tumble(dt);
      if (F.back > 0) {
        F.back = Math.max(0, F.back - dt);
        const k = ease(1 - F.back / 0.9);
        F.p.lerp(this.bPosR, k);
        F.q.slerp(this.bQR, k);
        if (F.back === 0 && !this.crashed) F.on = false;
      }
      if (F.on) {
        b.board.position.copy(F.p);
        b.board.quaternion.copy(F.q);
      }
    }
    if (!F.on) {
      b.board.position.copy(this.bPosR);
      b.board.quaternion.copy(this.bQR);
    }
    b.board.updateMatrix();
    // the soles laid flat (a leg's solve leaves its foot rolled with the
    // thigh's splay)
    this.root.matrixWorld.identity();
    body.updateWorldMatrix(false, true);
    const live = 1 - cw;
    for (let side = 0; side < 2; side++) {
      const Ft = this.feet[side];
      const w = Ft.flat * live;
      if (w <= 0.001) continue;
      const foot = b[side ? 'footR' : 'footL'];
      foot.matrixWorld.decompose(_v, _q, _v2);
      _n.set(0, 1, 0).applyQuaternion(_q);
      _v3.copy(Ft.n).applyQuaternion(_q2.setFromRotationMatrix(_m.extractRotation(body.matrix)));
      _q3.setFromUnitVectors(_n, _v3);
      _q3.slerp(_q2.identity(), 1 - w);
      _q.premultiply(_q3);
      foot.parent.matrixWorld.decompose(_v, _q2, _v2);
      foot.quaternion.copy(_q2.invert().multiply(_q));
    }
    this.handsStep(live);
  }

  // Her hands, where they have somewhere to be: ducking, the front one on
  // the board's toe rail between her feet; standing about, both in her
  // pockets (under the tee's hem).
  handsStep(live) {
    const b = this.b;
    const W = this.w;
    const tot = W.run + W.jump + W.slide + W.idle || 1;
    const grab = (W.slide / tot) * (this.duckK || 0) * live;
    if (grab > 0.01) {
      // (the rail: the deck's toe-side edge, just behind its middle)
      const R = this.rig.board;
      _p.set(R.halfW * 0.92, -0.004, 0.02).applyQuaternion(this.bQR).add(this.bPosR);
      b.chest.matrixWorld.decompose(_v, _q, _v2);
      _n.set(-0.2, 0.3, 1).applyQuaternion(_q);
      this.reachArm(0, _p, _n, grab);
    }
    const pockets = (W.idle / tot) * (1 - this.greetHop().any) * live;
    if (pockets > 0.01) {
      b.hips.matrixWorld.decompose(_v, _q, _v2);
      for (let side = 0; side < 2; side++) {
        const sx = side ? 1 : -1;
        _p.set(sx * 0.15, -0.13, -0.022).applyQuaternion(_q).add(_v);
        _n.set(sx * 1, 0.1, 0.8).applyQuaternion(_q);
        this.reachArm(side, _p, _n, pockets);
        b.hips.matrixWorld.decompose(_v, _q, _v2);
      }
    }
  }

  // Two-bone solve of one arm, its wrist to T (root space), its elbow bent
  // toward pole, laid over the pose by w (the hand keeps its own turn).
  reachArm(side, T, pole, w) {
    const b = this.b;
    const L = side ? 'R' : 'L';
    const arm = b['arm' + L], fore = b['fore' + L], clav = b['clav' + L];
    const ua = this.UPPER_ARM, fa = this.FOREARM;
    const S = _a.setFromMatrixPosition(arm.matrixWorld);
    const d0 = T.distanceTo(S);
    const d = clamp(d0, Math.abs(ua - fa) + 0.01, ua + fa - 0.002);
    const n = _b.subVectors(T, S).divideScalar(d0 || 1);
    const pl = _v3.copy(pole).addScaledVector(n, -pole.dot(n)).normalize();
    const a = (ua * ua - fa * fa + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, ua * ua - a * a));
    const E = _v2.copy(S).addScaledVector(n, a).addScaledVector(pl, h);
    const Y = E.sub(S).negate().normalize();
    const Z = _v.copy(n).addScaledVector(Y, -n.dot(Y));
    if (Z.lengthSq() < 1e-8) Z.copy(pl);
    Z.normalize().negate();
    const X = _p.crossVectors(Y, Z);
    _m.makeBasis(X, Y, Z);
    _q.setFromRotationMatrix(_m);
    clav.matrixWorld.decompose(_v, _q2, _v2);
    _q2.invert().multiply(_q);
    arm.quaternion.slerp(_q2, w);
    const cosE = clamp((ua * ua + fa * fa - d * d) / (2 * ua * fa), -1, 1);
    fore.rotation.x += (Math.PI - Math.acos(cosE) - fore.rotation.x) * w;
    arm.updateMatrixWorld(true);
  }

  // The board on its own: thrown, tumbling, bouncing on the road and
  // skidding to a stop (the root's space).
  tumble(dt) {
    const F = this.free;
    if (dt <= 0) return;
    F.v.y -= 16 * dt;
    F.p.addScaledVector(F.v, dt);
    const len = _v.set(F.w.x, F.w.y, F.w.z);
    const ang = len.length() * dt;
    if (ang > 1e-6) F.q.premultiply(_q.setFromAxisAngle(len.normalize(), ang));
    if (F.p.y < 0.06) {
      F.p.y = 0.06;
      if (F.v.y < 0) F.v.y = -F.v.y * 0.35;
      F.v.x *= 0.8;
      F.v.z *= 0.86;
      F.w.multiplyScalar(0.7);
      // (settling wheels-down)
      _v.set(0, 1, 0).applyQuaternion(F.q);
      if (Math.abs(F.v.y) < 0.6) F.q.slerp(_q.setFromUnitVectors(_v, UP).multiply(F.q), 0.2);
    }
  }

  // --- secondary motion ---------------------------------------------------------------
  simulate(dt, steps) {
    this.braidStep(dt, steps);
    this.hemStep(dt);
    // the tee ripples in the wind (the shader: how far, and the wave's clock)
    const air = this.air.length();
    this.flutter.x = 0.0022 + 0.00034 * Math.min(air, 30);
    this.flutter.y += dt * (5 + 0.45 * Math.min(air, 30));
    this.flutter.z = clamp(air / 25, 0, 1);
  }

  // The tee's hem hangs from four bones round her waist (front, back, her
  // left, her right), each swung out by the wind on its side of her, lifted
  // by the air coming up past her as she falls, dropped as she lands, and
  // fluttering.
  hemStep(dt) {
    const b = this.b;
    const S = this.hemS;
    b.hips.matrixWorld.decompose(_v, _q, _v2);
    const air = _a.copy(this.air).applyQuaternion(_q.invert());
    const dv = this.pelvisD, dp = this.pelvisDP;
    const live = 1 - (this.crashW || 0);
    const kick = (dv.y * 0.7 + dp.y) * 1.6 * live;
    const t = this.time;
    const fl = clamp(this.air.length() / 25, 0, 1);
    const up = Math.max(0, air.y) * 0.02;
    const go = (s, out, ph) => {
      s.v -= kick;
      const wind = clamp(out * 0.017, -0.04, 0.42);
      const flap = 0.07 * fl * (Math.sin(t * 9.3 + ph) + 0.6 * Math.sin(t * 14.7 + ph * 2.1)) * (0.4 + wind * 2);
      return clamp(s.step(wind + up + flap, 3.2, 0.28, dt), -0.12, 0.7);
    };
    const fF = go(S.F, -air.z, 0);
    const fB = go(S.B, air.z, 1.3);
    const fL = go(S.L, -air.x, 2.1);
    const fR = go(S.R, air.x, 3.7);
    b.hemF.rotation.set(fF, 0, 0);
    b.hemB.rotation.set(-fB, 0, 0);
    b.hemL.rotation.set(0, 0, -fL);
    b.hemR.rotation.set(0, 0, fR);
  }

  // --- the braids ---------------------------------------------------------------------
  // Each braid is a rope of particles (one at each of its joints and its
  // tip), its root pinned to her head where it grows, swung by gravity, the
  // headwind (each a little differently, and fluttering), her own
  // accelerations, kept off her head, shoulders, back and legs and the road -
  // the ponytail's held in its arc out of the cuff by its first few joints,
  // and kept together as a tail - and its bones turned to follow it.
  // Simulated in a space with the world's axes and its origin at the runner
  // (so a lean or a turn swings them instead of carrying them round).
  buildBraids() {
    const R = this.rig;
    const head = this.bindPos.head;
    this.braids = R.braids.map((d) => {
      const n = d.pts.length;
      const rest = d.pts.map((p) => new THREE.Vector3(...p));
      const len = [];
      const dir0 = [];
      for (let k = 0; k < n - 1; k++) {
        len.push(rest[k].distanceTo(rest[k + 1]));
        dir0.push(rest[k + 1].clone().sub(rest[k]).normalize());
      }
      const tail = d.group === 'tail';
      // how hard each joint is held to where it sits on her head: the
      // ponytail's arc out of the cuff, the face-framing ones at their roots
      const hold = tail ? [1, 0.55, 0.28, 0.1, 0.03] : [1, 0.25, 0.06];
      return {
        d,
        n,
        tail,
        rest,
        len,
        dir0,
        inHead: rest.map((p) => p.clone().sub(head)),
        bones: d.bones.map((nm) => this.b[nm]),
        p: Array.from({ length: n }, () => new THREE.Vector3()),
        q: Array.from({ length: n }, () => new THREE.Vector3()),
        tgt: Array.from({ length: n }, () => new THREE.Vector3()),
        tgt0: Array.from({ length: n }, () => new THREE.Vector3()),
        hold: Array.from({ length: n }, (_, k) => hold[k] ?? 0),
        drag: (tail ? 0.64 : 0.56) * (0.85 + 0.3 * d.seed),
        seed: d.seed,
      };
    });
    this.tailBraids = this.braids.filter((B) => B.tail);
    // where each tail braid lies in the fan across her back, joint by joint
    // (from the middle of the tail; bind space)
    const T = this.tailBraids;
    for (const B of T) B.fan = B.rest.map(() => new THREE.Vector3());
    for (let k = 0; k < T[0].n; k++) {
      _p.set(0, 0, 0);
      for (const B of T) _p.add(B.rest[k]);
      _p.multiplyScalar(1 / T.length);
      for (const B of T) B.fan[k].subVectors(B.rest[k], _p).multiplyScalar(1.25);
    }
    this.headQs = new THREE.Quaternion();
    this.braidCols = R.colliders.map((c) => ({ ...c, a: c.a && new THREE.Vector3(...c.a), b: c.b && new THREE.Vector3(...c.b), c: c.c && new THREE.Vector3(...c.c), r: c.r && new THREE.Vector3(...c.r) }));
    // (this frame's, in simulation space)
    this.cols = this.braidCols.map((c) => ({ kind: c.kind, c: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), ax: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], r: [0, 0, 0], ra: c.ra || 0, rb: c.rb || 0 }));
    this.braidH = 1 / 120;
  }

  braidStep(dt, steps) {
    if (dt <= 0) return;
    const Q = this.root.quaternion;
    const b = this.b;
    // the head's skinning matrix (root space), and its turn
    const Mh = _m.copy(this.boneM('head'));
    // colliders into simulation space
    for (let i = 0; i < this.braidCols.length; i++) {
      const d = this.braidCols[i];
      const c = this.cols[i];
      const T = this.boneM(d.bone);
      if (d.kind === 'ell') {
        c.c.copy(d.c).applyMatrix4(T).applyQuaternion(Q);
        for (let e = 0; e < 3; e++) {
          c.ax[e].setFromMatrixColumn(T, e).normalize().applyQuaternion(Q);
          c.r[e] = d.r.getComponent(e) + 0.009;
        }
      } else {
        c.a.copy(d.a).applyMatrix4(T).applyQuaternion(Q);
        c.b.copy(d.b).applyMatrix4(T).applyQuaternion(Q);
        c.ra = d.ra + 0.009;
        c.rb = d.rb + 0.009;
      }
    }
    // where each braid's joints sit on her head (the pins, and what the
    // held joints are drawn toward): last frame's and this frame's
    const first = !this.braidsReady;
    for (const B of this.braids) {
      for (let k = 0; k < B.n; k++) {
        B.tgt0[k].copy(B.tgt[k]);
        B.tgt[k].copy(B.rest[k]).applyMatrix4(Mh).applyQuaternion(Q);
        if (first) {
          B.p[k].copy(B.tgt[k]);
          B.q[k].copy(B.tgt[k]);
          B.tgt0[k].copy(B.tgt[k]);
        }
      }
    }
    this.braidsReady = true;
    // (her head's turn, in simulation space: the tail's fan turns with it)
    b.head.matrixWorld.decompose(_v, this.headQs, _v2);
    this.headQs.premultiply(Q);
    // the air through them and the push of her own motion (world axes)
    const vel = _dv.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
    const airX = -vel.x + this.breeze.x, airY = -vel.y + this.breeze.y, airZ = -vel.z + this.breeze.z;
    const airS = Math.hypot(airX, airY, airZ);
    const gx = -this.frameAcc.x, gy = -9.8 * this.gk - this.frameAcc.y, gz = -this.frameAcc.z;
    const groundY = (this.groundY || 0) - this.y + 0.012;
    const h = dt / steps;
    const scale = h / this.braidH;
    this.braidH = h;
    const t0 = this.time - dt;
    for (let s = 0; s < steps; s++) {
      const u = (s + 1) / steps;
      const ts = t0 + h * (s + 1);
      for (const B of this.braids) {
        const n = B.n;
        const kd = B.drag;
        for (let k = 1; k < n; k++) {
          const p = B.p[k], q = B.q[k];
          const vx = ((p.x - q.x) * scale) / h, vy = ((p.y - q.y) * scale) / h, vz = ((p.z - q.z) * scale) / h;
          // fluttering in the wind, more toward the tip
          const fk = (k / n) * airS * 0.36;
          const n1 = Math.sin(ts * 7.1 + B.seed * 23 + k * 0.9) + 0.5 * Math.sin(ts * 12.7 + B.seed * 9 + k * 1.7);
          const n2 = Math.sin(ts * 6.3 + B.seed * 31 + k * 1.3) + 0.5 * Math.sin(ts * 11.3 + B.seed * 5 - k * 0.7);
          const ax = gx + kd * (airX - vx) + fk * n1;
          const ay = gy + kd * (airY - vy) + fk * n2 * 0.6;
          const az = gz + kd * (airZ - vz);
          const nx = p.x + (p.x - q.x) * scale * 0.992 + ax * h * h;
          const ny = p.y + (p.y - q.y) * scale * 0.992 + ay * h * h;
          const nz = p.z + (p.z - q.z) * scale * 0.992 + az * h * h;
          q.copy(p);
          p.set(nx, ny, nz);
        }
        // the root pinned; the held joints drawn to where they sit
        B.p[0].lerpVectors(B.tgt0[0], B.tgt[0], u);
        B.q[0].copy(B.p[0]);
        for (let k = 1; k < n; k++) {
          const hk = B.hold[k];
          if (hk > 0) B.p[k].lerp(_v.lerpVectors(B.tgt0[k], B.tgt[k], u), hk * 0.5);
        }
      }
      // keep the tail together, but not in one line
      this.tailCohesion();
      for (let it = 0; it < 3; it++) {
        for (const B of this.braids) {
          // lengths, from the root out (the root doesn't give)
          for (let k = 0; k < B.n - 1; k++) {
            const a = B.p[k], c = B.p[k + 1];
            _v.subVectors(c, a);
            const L = _v.length() || 1e-6;
            const e = (L - B.len[k]) / L;
            if (k === 0) c.addScaledVector(_v, -e);
            else {
              a.addScaledVector(_v, 0.5 * e);
              c.addScaledVector(_v, -0.5 * e);
            }
          }
          // a little stiffness against folding back on itself
          for (let k = 0; k < B.n - 2; k++) {
            const a = B.p[k], c = B.p[k + 2];
            const want = 0.82 * (B.len[k] + B.len[k + 1]);
            _v.subVectors(c, a);
            const L = _v.length() || 1e-6;
            if (L < want) {
              const e = ((want - L) / L) * 0.5;
              if (k > 0) a.addScaledVector(_v, -e * 0.5);
              c.addScaledVector(_v, e);
            }
          }
        }
        // kept off her, and off the road
        for (const B of this.braids) for (let k = 1; k < B.n; k++) this.pushOut(B.p[k], groundY);
      }
    }
    // the bones follow
    b.head.matrixWorld.decompose(_v, _q, _v2);
    const Qi = _q3.copy(Q).invert();
    for (const B of this.braids) {
      let Rp = _q2.copy(_q);
      for (let k = 0; k < B.n - 1; k++) {
        _a.subVectors(B.p[k + 1], B.p[k]).applyQuaternion(Qi).normalize();
        // (into the parent's frame)
        _a.applyQuaternion(this.qInv(Rp));
        const bone = B.bones[k];
        bone.quaternion.setFromUnitVectors(B.dir0[k], _a);
        Rp = Rp.multiply(bone.quaternion);
      }
    }
  }

  qInv(q) {
    return (this._qi || (this._qi = new THREE.Quaternion())).copy(q).invert();
  }

  // The ponytail's braids drawn a little toward each other, joint by joint
  // (not the ones near the cuff: they're held), and pushed apart where
  // they'd run into one another.
  tailCohesion() {
    const T = this.tailBraids;
    const n = T[0].n;
    const Qh = this.headQs;
    for (let k = 3; k < n; k++) {
      _p.set(0, 0, 0);
      let m = 0;
      for (const B of T) if (k < B.n) _p.add(B.p[k]), m++;
      _p.multiplyScalar(1 / m);
      // (each toward where it lies in the fan, turned as her head is: the
      // tail keeps its spread across her back as it swings)
      for (const B of T) if (k < B.n) B.p[k].lerp(_v.copy(B.fan[k]).applyQuaternion(Qh).add(_p), 0.035);
      for (let i = 0; i < T.length - 1; i++) {
        const a = T[i].p[k], c = T[i + 1].p[k];
        if (!a || !c) continue;
        _v.subVectors(c, a);
        const L = _v.length();
        const want = 0.016;
        if (L < want && L > 1e-6) {
          const e = ((want - L) / L) * 0.5;
          a.addScaledVector(_v, -e);
          c.addScaledVector(_v, e);
        }
      }
    }
  }

  // A particle pushed out of whatever of her it's inside, and up off the road.
  pushOut(p, groundY) {
    for (const c of this.cols) {
      if (c.kind === 'ell') {
        _v.subVectors(p, c.c);
        const x = _v.dot(c.ax[0]) / c.r[0], y = _v.dot(c.ax[1]) / c.r[1], z = _v.dot(c.ax[2]) / c.r[2];
        const k = Math.hypot(x, y, z);
        if (k < 1 && k > 1e-6) {
          const f = 1 / k - 1;
          p.addScaledVector(c.ax[0], x * f * c.r[0]).addScaledVector(c.ax[1], y * f * c.r[1]).addScaledVector(c.ax[2], z * f * c.r[2]);
        }
      } else {
        _v.subVectors(c.b, c.a);
        const L2 = _v.lengthSq() || 1e-9;
        const tt = clamp(_v2.subVectors(p, c.a).dot(_v) / L2, 0, 1);
        _v3.copy(c.a).addScaledVector(_v, tt);
        _v2.subVectors(p, _v3);
        const d = _v2.length();
        const r = c.ra + (c.rb - c.ra) * tt;
        if (d < r && d > 1e-6) p.addScaledVector(_v2, (r - d) / d);
      }
    }
    if (p.y < groundY) p.y = groundY;
  }

  // --- dust --------------------------------------------------------------------------
  // A puff off the wheels as she lands.
  landDust(hit) {
    const r = Math.random;
    const run = _dv.set(this.vx, 0, -this.speed);
    const n = hit > 1.1 ? 4 : 3;
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1;
      _p.copy(run).multiplyScalar(0.3 + 0.1 * r());
      _p.x += side * (0.8 + 1.0 * r());
      _p.y += 0.3 + 0.5 * r();
      this.dust.emit(_v.set(side * 0.14, 0.03, (k < 2 ? -0.18 : 0.18) + 0.04 * r()), _p, 0.2 + 0.08 * r() * hit);
    }
  }
}
