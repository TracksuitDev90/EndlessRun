import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials } from '../render/shaders.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { palette } from './kit.js';
import { Player, C, mirror, merge } from './player.js';
import { CONFIG } from '../config.js';
import { Dust } from './dust.js';
import { Splashes } from './splashes.js';
import { Tank } from './tank.js';

// The fisherman: Reed, a sturdy boy of about thirteen in an open yellow rain
// jacket, a teal tee and orange waterproof bib trousers, black rubber boots
// (sculpted in tools/runner/fisher.py) - with a little aquarium on his back
// and his rod over his right shoulder, a giant purple alien fish hanging off
// it. On top of the shared runner (player.js):
//   - he runs two ways, and every few seconds changes from one to the other
//     (as the bunny does): upright and quick, his free fist pumping tight at
//     his chest; or leaning into a hard sprint, head down, his free arm flung
//     out wide - his right hand never leaves the rod;
//   - the rod rides on his shoulder (carried by his chest, bouncing a little
//     on it) and his right arm is solved to grip it wherever it is (armTo);
//   - the fish on its line is a weighty pendulum off the rod's tip -
//     damped, kept clear of him and of the tank - its tail and fins
//     following its swings a moment late (catchStep);
//   - the tank bounces on his back on its straps; inside it the water tips
//     and the goldfish swims round and round, turning as it goes, a bubble
//     now and then (tank.js);
//   - and his boots splash: water springs up from under them as he takes off
//     and splashes out where they come down (splashes.js) - only on land, and
//     only ever for show: none of it touches the run.

// Palette slots: 1-16 are the garment ids baked into the mesh, the rest are
// colours the character shader draws his details with.
export const COL = {
  1: '#f7c8a8', // face (fair, warm)
  2: '#dfa64c', // hair (honey blonde)
  3: '#2f8c80', // tee (teal)
  4: '#f2b225', // jacket (rain-jacket yellow)
  5: '#e2561d', // trousers, the bib (orange)
  6: '#2b2829', // boots (black rubber)
  7: '#f7c8a8', // hands
  8: '#2a2b2f', // straps, buckles (charcoal)
  9: '#33363b', // the tank's cap and base (charcoal)
  10: '#5b3c29', // the rod's blank
  11: '#2d3034', // the reel, the guides
  12: '#bf9064', // cork
  13: '#5f49c4', // the alien fish (blue-violet)
  14: '#8a66d8', // its fins
  15: '#ff861c', // the goldfish
  16: '#e9eef0', // the line
  17: '#e5a383', // skin, deep
  18: '#ffe2cc', // skin, light
  19: '#f0907c', // cheeks
  20: '#c07a50', // freckles
  21: '#7e6a55', // dirt
  22: '#fcf8f3', // eye whites
  23: '#7b4d22', // irises (warm brown)
  24: '#26170f', // ink
  25: '#9b4537', // mouth
  26: '#cf8b14', // jacket, deep
  27: '#b33f10', // trousers, deep
  28: '#38dce4', // cyan accents
  29: '#ccb4f5', // the fish's belly (lavender)
  30: '#ffd889', // hair, light
  31: '#52f5df', // the fish's glow (turquoise)
};

// His two runs (the shared gait laid under each; see the bunny for how the
// one he's in is blended from them):
//   - 'pump': upright and quick on light feet, the heel kicked up high
//     behind, his free (left) fist pumping tight in front of his chest, the
//     elbow bent hard;
//   - 'reach': leaning hard into a sprint, his head down and forward, the
//     stride longer and lower, his free arm flung out wide to the side and
//     swinging big.
const STYLES = [
  {
    name: 'pump',
    cadence: [1.66, 0.056],
    stride: { reach: 0.64, hipY: 0.85, bob: 0.042, trackX: 0.072, swingX: 0.105, toeOut: 0.05, heelLift: 0.88, ballZ: -0.03 },
    swing: [
      [0.16, 0.4, 0.34, 0.03, 0.035],
      [0.4, 0.22, 0.54, 0.0, 0.08],
      [0.65, -0.17, 0.43, -0.04, 0.03],
      [0.84, -0.31, 0.28, -0.02, 0.0],
    ],
    arm: {
      swing: [0.25, 0.68, 0.8, 0.5, -0.1, -0.5, -0.6, -0.35],
      abd: [0.2, 0.18, 0.18, 0.2, 0.24, 0.27, 0.27, 0.24],
      elbow: [1.95, 2.12, 2.2, 2.02, 1.7, 1.48, 1.45, 1.62],
      amp: [0.82, 0.22],
    },
    lean: [0.13, 0.1],
    hipYaw: 0.17,
    hipRoll: 0.06,
    spTwist: 0.17,
    chTwist: 0.13,
  },
  {
    name: 'reach',
    cadence: [1.52, 0.054],
    stride: { reach: 0.74, hipY: 0.815, bob: 0.052, trackX: 0.082, swingX: 0.125, toeOut: 0.06, heelLift: 0.82, ballZ: -0.05 },
    swing: [
      [0.16, 0.42, 0.33, 0.04, 0.035],
      [0.4, 0.2, 0.52, 0.0, 0.09],
      [0.65, -0.24, 0.46, -0.05, 0.035],
      [0.84, -0.4, 0.29, -0.03, 0.0],
    ],
    arm: {
      swing: [0.4, 0.95, 1.08, 0.7, -0.3, -0.85, -0.95, -0.6],
      abd: [0.8, 0.9, 1.0, 0.9, 0.72, 0.82, 0.92, 0.84],
      elbow: [0.65, 0.5, 0.45, 0.6, 0.8, 0.6, 0.5, 0.62],
      amp: [0.9, 0.25],
    },
    lean: [0.3, 0.14],
    hipYaw: 0.2,
    hipRoll: 0.065,
    spTwist: 0.22,
    chTwist: 0.2,
  },
];
// how long he keeps to a run (s: at least, plus up to), and how long he
// takes to change from one into the other
const STYLE_HOLD = [3.5, 4];
const STYLE_EASE = 0.55;

function blendGait(out, a, b, k) {
  for (const key in out) {
    if (typeof out[key] === 'number') out[key] = a[key] + (b[key] - a[key]) * k;
    else if (out[key] && typeof out[key] === 'object') blendGait(out[key], a[key], b[key], k);
  }
}

// How he handles: a sturdy boy - a steady spring between the lanes, the
// plain jump, and he lands with a stomp, both boots down at once, as you
// would in a puddle.
const FEEL = {
  laneSpring: 36,
  lean: [0.036, 0.42],
  turn: [0.026, 0.36],
  blend: [5, 6.5, 7],
  land: { freq: 4.4, zeta: 0.3, thud: 0.025 },
};

// His jumps, dealt so the same one never comes twice running: a tuck (both
// boots pulled up together under him, as if he's jumping into a puddle), a
// stride leap (his free arm thrown up), and a star (arms and legs flung
// wide and snapped back in to land).
const TRICKS = ['puddle', 'stride', 'puddle', 'star', 'stride', 'puddle'];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _o1 = new THREE.Vector3();
const _o2 = new THREE.Vector3();
const _before = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);

const mix = (a, b, k) => a + (b - a) * k;
// (how much of his chest's swing through each stride his arm takes out of
// the rod's: it'd lever the fish about at the end of it)
const ROD_STEADY = 0.85;
const bump = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));

export class Fisher extends Player {
  constructor(envDef, asset) {
    super(envDef, asset, { gait: STYLES[0], feel: FEEL });
    // (his rod and the fish reach up and out behind him)
    this.castR = 1.0;
    this.castTop = 2.0;
  }

  configure() {
    super.configure();
    // his two runs, whole, and the one he's running in: a copy of its own
    // (the blend between them is written into it)
    this.gaits = STYLES.map(({ name, ...over }) => merge(this.gait, over));
    this.gait = JSON.parse(JSON.stringify(this.gaits[0]));
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    const R = this.rig;
    const rig = [
      new THREE.Vector4(R.eye[0], R.eye[1], -0.088, R.mouth[0]),
      new THREE.Vector4(R.bib.top, R.bib.half, R.bootX, R.soleH),
      new THREE.Vector4(R.jacket.hem, R.jacket.cuff, R.tank.half, 0),
    ];
    const mats = makeCharacterMaterials(this.u, palette(COL), rig, 0.0062, null, { style: 'fisher' });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.buildBody();
    this.dust = new Dust(this.u);
    this.splashes = new Splashes(this.u);
    this.tank = new Tank(this.u, R.tank, this.b);
    this.buildRod();
  }

  // The frames the rod and the fish are posed by: the rod as it rides on
  // his shoulder (from his chest), where his right fist holds it, the fish
  // hanging from its tip.
  buildRod() {
    const R = this.rig;
    const bindOf = (n) => new THREE.Matrix4().copy(this.boneInv[n]).invert();
    this.rodBind = bindOf('rod');
    // (the rod's rest on his shoulder, from the chest's frame)
    this.relRod = bindOf('chest').invert().multiply(this.rodBind);
    // his right fist round the grip (bind space): +y toward the thumb, up
    // the rod; +z down the hanging arm, toward the knuckles
    const ar = R.armRest;
    const y = new THREE.Vector3(0, 0, -1);
    const z = new THREE.Vector3(Math.sin(ar), -Math.cos(ar), 0);
    const x = new THREE.Vector3().crossVectors(y, z);
    const M = new THREE.Matrix4().makeBasis(x, y, z).setPosition(...R.grip.R);
    this.relHeld = bindOf('handR').invert().multiply(M);
    this.relHeldInv = this.relHeld.clone().invert();
    // (the grip in the rod's own frame: at its origin, turned so the fist's
    // knuckles face out and forward, the thumb up the rod)
    this.gripRoll = new THREE.Matrix4().makeRotationY(-0.35);
    this.tipLocal = new THREE.Vector3(...R.rod.tip);
    this.rodF = new THREE.Matrix4();
    this.rodPivot = new THREE.Vector3(0, 0.27, 0); // (where it rests on his shoulder, along it)
    this.lineLen = R.rod.line;
    // the fish's centre of mass, below the hook (m)
    this.catchL = R.rod.line + 0.2;
    this.fishCols = R.colliders.map((c) => ({ ...c, a: c.a && new THREE.Vector3(...c.a), b: c.b && new THREE.Vector3(...c.b), c: c.c && new THREE.Vector3(...c.c), r: c.r && new THREE.Vector3(...c.r) }));
    this.cols = this.fishCols.map((c) => ({ kind: c.kind, c: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), ax: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], r: [0, 0, 0], ra: c.ra || 0, rb: c.rb || 0 }));
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points, this.splashes.mesh];
  }

  forCompile(on) {
    this.dust.forCompile(on);
    this.splashes.forCompile(on);
    this.tank.forCompile(on);
  }

  // --- state ------------------------------------------------------------------------
  buildSim() {
    super.buildSim();
    // the fish: a point mass swinging off the rod's tip (runner space, the
    // world's axes), its twist about the line, its tail and fins
    this.fish = { p: new THREE.Vector3(), q: new THREE.Vector3(), tip: new THREE.Vector3(), tipV: new THREE.Vector3(), ready: false };
    this.twist = new Spring();
    this.tailS = new Spring();
    this.finS = new Spring();
    this.rodBob = new Spring();
    this.rodSway = new Spring();
    this.packS = { y: new Spring(), x: new Spring(), z: new Spring() };
  }

  resetSim() {
    super.resetSim();
    this.deck = this.deck || [];
    this.trick = this.trick || 'puddle';
    this.lastDt = 0;
    this.greetT = 9;
    this.tilt = 0;
    this.spin = 0;
    this.dodgeT = 9;
    this.dodgeDir = 1;
    this.takeoffT = 9;
    if (this.fish) this.fish.ready = false;
    for (const s of [this.twist, this.tailS, this.finS, this.rodBob, this.rodSway]) s?.reset();
    for (const s of Object.values(this.packS || {})) s.reset();
    this.prevAng = null;
    this.tank?.reset();
    this.dust?.clear();
    this.splashes?.clear();
    // (a fresh run starts in either)
    if (this.gaits) {
      this.runStyle = Math.random() < 0.5 ? 0 : 1;
      this.styleX = this.styleK = this.runStyle;
      this.styleNext = STYLE_HOLD[0] + STYLE_HOLD[1] * Math.random();
      blendGait(this.gait, this.gaits[0], this.gaits[1], this.styleK);
    }
  }

  update(dt, speed, groundAt) {
    this.lastDt = dt;
    this.styleStep(dt);
    this.greetT += dt;
    this.dodgeT += dt;
    this.takeoffT += dt;
    super.update(dt, speed, groundAt);
  }

  place(z, dist = 0) {
    super.place(z);
    this.dust.update(this.lastDt, this.root, z, dist);
    this.splashes.update(this.lastDt, this.root, z, dist);
    this.lastDt = 0;
  }

  // Every few seconds of the run he changes how he runs (STYLES), with his
  // feet on the road, easing from one into the other over a couple of
  // strides.
  styleStep(dt) {
    if (this.mode === 'run' && !this.crashed) {
      this.styleNext -= dt;
      const free = this.grounded && !this.sliding && this.w.run > 0.9 && this.speed > 4;
      if (free && this.styleNext <= 0) {
        this.runStyle = 1 - this.runStyle;
        this.styleNext = STYLE_HOLD[0] + STYLE_HOLD[1] * Math.random();
      }
    }
    const x = this.styleX + clamp(this.runStyle - this.styleX, -dt / STYLE_EASE, dt / STYLE_EASE);
    if (x === this.styleX) return;
    this.styleX = x;
    this.styleK = x * x * (3 - 2 * x);
    blendGait(this.gait, this.gaits[0], this.gaits[1], this.styleK);
  }

  // Keep to one run (by name) from now on (the viewer: &style=).
  holdStyle(name) {
    const i = STYLES.findIndex((S) => S.name === name);
    if (i < 0) return;
    this.runStyle = i;
    this.styleX = this.styleK = i;
    this.styleNext = Infinity;
    blendGait(this.gait, this.gaits[0], this.gaits[1], i);
  }

  // --- moves ------------------------------------------------------------------------
  jump() {
    // (taking off from the ground - not from just past the end of something,
    // already falling - his boots splash)
    const fromGround = this.grounded || this.bounding;
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
    this.jumpSide = Math.random() < 0.5 ? -1 : 1;
    this.takeoffT = 0;
    if (fromGround && this.mode === 'run' && !this.crashed) this.bootSplash(false, 1);
  }

  onLand(hit) {
    if (this.crashed || this.mode !== 'run') return;
    // the fish swings on down a moment after he's stopped
    this.tailS.v += 3 * hit;
    this.bootSplash(true, hit);
  }

  onDodge(dir) {
    this.dodgeT = 0;
    this.dodgeDir = dir;
  }

  // Water springs up from under his boots: where each one leaves the road
  // as he takes off (a small, quick spray, drops trailing off the soles),
  // or where it comes down as he lands (a bigger splash, flung outward) -
  // at the road under him, wherever that is (a rooftop, a walk up on a
  // wall). Only on land (none underwater), and only to look at.
  bootSplash(land, hit) {
    if (this.submerged || !this.toeAt) return;
    const g = this.groundY || 0;
    const run = _dv.set(this.vx, 0, -this.speed).applyQuaternion(this.invQ);
    for (let side = 0; side < 2; side++) {
      // (the sole's middle, a little behind the ball of the boot - where it
      // was last frame, a moment before it touched - on the road under him)
      _p.copy(this.toeAt[side]);
      _p.y = g - this.y + 0.004;
      _p.z += 0.045;
      this.splashes.burst(_p, run, land, hit * (side ? 1 : 0.85 + 0.15 * Math.random()), side);
    }
  }

  // Just after take-off, drops shake off his soles and fall away behind
  // them.
  shedDrops() {
    if (this.submerged || this.grounded || this.takeoffT > 0.16 || this.crashed || Math.random() > 0.55) return;
    const run = _dv.set(this.vx * 0.6, this.vy * 0.35, -this.speed * 0.72).applyQuaternion(this.invQ);
    for (let side = 0; side < 2; side++) {
      if (Math.random() < 0.4) continue;
      _p.copy(this.toeAt[side]);
      _p.y -= 0.06;
      _p.z += 0.04 + 0.04 * Math.random();
      _p.x += (Math.random() - 0.5) * 0.06;
      this.splashes.shed(_p, run, 0.012 + 0.01 * Math.random());
    }
  }

  // Picked on the title screen: he hoists the fish up proudly - a shake of
  // the rod that sets it swinging - and a splash at his boots.
  greet() {
    this.greetT = 0;
    this.twist.v += 5;
    this.tailS.v += 8;
  }

  // --- poses --------------------------------------------------------------------------
  // His runs (STYLES): the shared run under them; the right arm's whatever
  // it is - it's solved onto the rod in afterPose.
  poseRun(r, f, sp) {
    super.poseRun(r, f, sp);
    const k = this.styleK;
    const p = 1 - k;
    // pump: upright, chin up, eyes ahead; the fist tight, the wrist firm
    // reach: head down and forward, driving
    r[C.hdPitch] += -0.08 * p + 0.16 * k;
    r[C.chLean] += 0.08 * k;
    r[C.wrL] = 0.1 * p + 0.25 * k;
    r[C.wrLz] = 0.3 * k;
    // (the right arm's held at the rod: only the shoulder rolls with the
    // stride)
    r[C.clRy] *= 0.3;
    r[C.clR] = 0.02;
  }

  // Standing: easy and pleased with himself, his weight on one foot and
  // then the other, the rod on his shoulder, his free arm loose, looking
  // about - and when he's picked, up on his toes with a wave.
  poseIdle(id, t) {
    const ws = super.poseIdle(id, t);
    const br = Math.sin(t * 1.8);
    id[C.hdPitch] = -0.02 + 0.03 * Math.sin(t * 0.6);
    // (stood up straight on straight legs, his free arm hanging close)
    id[C.hipY] = this.HIP_Y - 0.004 + 0.003 * br;
    id[C.hipPitch] = 0;
    id[C.spLean] = 0.035 + 0.01 * br;
    id[C.chLean] = 0.0;
    id[C.shLz] = 0.2 + 0.02 * ws;
    id[C.elL] = 0.3 + 0.03 * br;
    // a sturdy stance: his boots planted wider than most, under his hips,
    // the heel of the free one lifting a little as his weight leaves it
    for (let side = 0; side < 2; side++) {
      const sx = side ? 1 : -1;
      const lift = 0.2 * smooth(0.3, 1, -sx * ws);
      const ay = this.ANKLE_H - this.TOE_D + this.TOE_D * Math.cos(lift) + this.TOE_F * Math.sin(lift);
      this.plantFoot(id, side, sx * 0.13 + id[C.hipX] * 0.3, ay, side ? 0.02 : -0.01, -lift);
      id[side ? C.toR : C.toL] = lift;
    }
    // the greeting: his free hand up in a wave, his chin up
    const g = bump(0.0, 0.2, 1.1, 1.5, this.greetT);
    id[C.spLean] -= 0.06 * g;
    id[C.hdPitch] -= 0.1 * g;
    id[C.shLx] = mix(id[C.shLx], 0.35, g);
    id[C.shLz] = mix(id[C.shLz], 2.4, g);
    id[C.elL] = mix(id[C.elL], 0.9 + 0.35 * Math.sin(this.greetT * 14), g);
    id[C.wrLz] = mix(0, 0.3 * Math.sin(this.greetT * 14), g);
    return ws;
  }

  // How far through the jump he is (0 take-off .. 1 landing), from the plain
  // arc's speed: a fast-fall hurries it round.
  jumpU() {
    return clamp((this.V0 - this.vyPose) / (2 * this.V0), 0, 1);
  }

  poseJump(j) {
    this.tilt = 0;
    this.spin = 0;
    const u = this.jumpU();
    j.fill(0);
    j[C.hipY] = this.HIP_Y;
    j[C.sq] = 1;
    // off the road: a crouch exploding up
    const k = 1 - smooth(0.0, 0.14, u);
    j[C.thLx] += 0.45 * k;
    j[C.thRx] += 0.15 * k;
    j[C.knL] += 0.5 * k;
    j[C.knR] += 0.25 * k;
    j[C.spLean] += 0.2 * k;
    if (this.trick === 'puddle') this.posePuddle(j, u);
    else if (this.trick === 'star') this.poseStar(j, u);
    else this.poseStride(j, u);
    if (this.jumpSide < 0 && this.trick === 'stride') mirror(j);
  }

  // The puddle jump: both boots pulled up together under him, knees high,
  // his free arm up for balance, eyes down on where he'll land - and down
  // feet first, together, into the stomp.
  posePuddle(j, u) {
    const tuck = bump(0.06, 0.26, 0.6, 0.86, u);
    const land = smooth(0.7, 1.0, u);
    j[C.thLx] += 1.35 * tuck + 0.55 * land;
    j[C.thRx] += 1.3 * tuck + 0.5 * land;
    j[C.knL] += 2.0 * tuck + 0.55 * land;
    j[C.knR] += 1.95 * tuck + 0.5 * land;
    j[C.anL] = -0.45 * tuck + 0.1 * land;
    j[C.anR] = -0.45 * tuck + 0.1 * land;
    j[C.thLz] = 0.05;
    j[C.thRz] = 0.05;
    j[C.spLean] += 0.22 * tuck + 0.18 * land;
    j[C.hdPitch] = 0.2 * tuck + 0.12;
    j[C.shLx] = 0.5 * tuck + 0.3;
    j[C.shLz] = 0.9 * tuck + 0.5 * land + 0.3;
    j[C.elL] = 0.8 + 0.3 * tuck;
    j[C.wrL] = 0.2;
    this.tilt = -0.1 * tuck;
  }

  // The stride leap: a big step through the air, the front knee up and the
  // back leg trailing; his free arm thrown up high.
  poseStride(j, u) {
    const fly = bump(0.06, 0.22, 0.7, 0.9, u);
    const land = smooth(0.72, 1.0, u);
    j[C.thLx] += 1.35 * fly + 0.8 * land;
    j[C.knL] += 1.3 * fly + 0.7 * land;
    j[C.anL] = -0.25 * fly;
    j[C.thRx] += -0.6 * fly + 0.2 * land;
    j[C.knR] += 0.5 * fly + 0.8 * land;
    j[C.anR] = -0.5 * fly;
    j[C.thLz] = 0.07;
    j[C.thRz] = 0.07;
    j[C.spLean] += 0.1 * fly + 0.2 * land;
    j[C.hdPitch] = 0.05;
    j[C.shLx] = 2.6 * fly + 0.5 * land;
    j[C.shLz] = 0.35 + 0.3 * land;
    j[C.elL] = 0.35 * fly + 0.5 * land;
    j[C.wrL] = -0.2 * fly;
    j[C.chTwist] = 0.1 * fly;
  }

  // The star: arms and legs flung out wide at the top - the rod held up
  // out to the side - then snapped back in to land.
  poseStar(j, u) {
    const star = bump(0.1, 0.3, 0.55, 0.78, u);
    const land = smooth(0.7, 1.0, u);
    j[C.thLx] += 0.15 * star + 0.6 * land;
    j[C.thRx] += 0.15 * star + 0.55 * land;
    j[C.knL] += 0.2 * star + 0.6 * land;
    j[C.knR] += 0.2 * star + 0.55 * land;
    j[C.thLz] = 0.55 * star + 0.05;
    j[C.thRz] = 0.55 * star + 0.05;
    j[C.anL] = -0.3 * star;
    j[C.anR] = -0.3 * star;
    j[C.spLean] += -0.1 * star + 0.2 * land;
    j[C.hdPitch] = -0.15 * star + 0.1;
    j[C.shLx] = 0.3 * star + 0.4 * land;
    j[C.shLz] = 1.9 * star + 0.4 * land + 0.2;
    j[C.elL] = 0.15 + 0.4 * land;
  }

  // The duck: a skid on his boots, crouched right down on his heels as if
  // on a wet slipway, his free arm out behind for balance, the rod held up
  // on his shoulder out of the way, leaning back a little.
  poseSlide(s, t) {
    if (this.slideT > 0) this.slideU = 1 - clamp(this.slideT / CONFIG.slide.time, 0, 1);
    const u = this.slideU ?? 1;
    const k = smooth(0.0, 0.12, u) * (1 - smooth(0.78, 1.0, u));
    s.fill(0);
    s[C.sq] = 1;
    s[C.hipY] = mix(this.HIP_Y - 0.08, 0.36, k);
    s[C.hipPitch] = -0.12 * k;
    s[C.hipYaw] = 0.18 * k;
    s[C.spLean] = 0.55 * k + 0.05;
    s[C.chLean] = 0.12 * k;
    s[C.hdPitch] = 0.35 * k - 0.05;
    s[C.hdYaw] = -0.15 * k;
    const A = this.ANKLE_H;
    // (wobbling a little on the skid)
    const wob = 0.012 * Math.sin(t * 23) * k;
    this.plantFoot(s, 0, -0.13, A, mix(-0.1, -0.24, k) + wob, 0.1 * k);
    this.plantFoot(s, 1, 0.14, A, mix(0.04, 0.02, k) - wob, 0.05 * k);
    // the free arm out behind and down for balance
    s[C.shLx] = -0.75 * k;
    s[C.shLz] = 0.75 * k + 0.25;
    s[C.elL] = 0.3;
    s[C.wrL] = -0.3 * k;
    this.tilt = 0;
  }

  // He lands with a stomp: both boots down at once, deep into his knees,
  // his free arm swung down, and back up.
  landOverlay(Pz, land) {
    const d = Math.max(0, land), p = Math.max(0, -land);
    Pz[C.hipY] += -0.12 * d + 0.025 * p;
    Pz[C.knL] += 0.68 * d;
    Pz[C.knR] += 0.68 * d;
    Pz[C.thLx] += 0.38 * d;
    Pz[C.thRx] += 0.38 * d;
    Pz[C.anL] += 0.3 * d;
    Pz[C.anR] += 0.3 * d;
    Pz[C.thLz] += 0.06 * d;
    Pz[C.thRz] += 0.06 * d;
    Pz[C.spLean] += 0.3 * d - 0.08 * p;
    Pz[C.hdPitch] += 0.1 * d - 0.06 * p;
    Pz[C.shLx] += -0.35 * d + 0.25 * p;
    Pz[C.shLz] += 0.4 * d;
    Pz[C.elL] -= 0.3 * d;
    Pz[C.sq] += -0.08 * d + 0.03 * p;
  }

  // A lane change: a skip across, leaning in, the free arm out for balance.
  laneOverlay(Pz, lc, dt) {
    super.laneOverlay(Pz, lc, dt);
    const x = this.dodgeT / 0.32;
    const e = x < 1 ? smooth(0, 0.25, x) * (1 - smooth(0.5, 1, x)) : 0;
    const w = this.w.run * (1 - (this.crashW || 0));
    Pz[C.hipY] += 0.03 * Math.sin(Math.PI * Math.min(1, x)) * w * (x < 1 ? 1 : 0);
    Pz[C.shLz] += 0.5 * e * w;
    Pz[C.elL] -= 0.3 * e * w;
  }

  // (an elbow never bends backward)
  applyPose(Pz, roll) {
    Pz[C.elL] = Math.max(0, Pz[C.elL]);
    Pz[C.elR] = Math.max(0, Pz[C.elR]);
    super.applyPose(Pz, roll);
  }

  // The tips of the jumps (about his middle); then the rod onto its bone
  // and his hand onto it; the fish, the tank.
  afterPose(dt, cw) {
    const live = 1 - cw;
    const b = this.body;
    const wj = this.w.jump * live;
    if (this.tilt !== 0) {
      _q.setFromAxisAngle(AX, this.tilt * wj);
      b.quaternion.premultiply(_q);
      _p.set(0, 0.9, 0);
      _v.copy(_p).applyQuaternion(_q);
      b.position.applyQuaternion(_q).add(_p).sub(_v);
    }
    this.root.matrixWorld.identity();
    b.updateWorldMatrix(false, true);
    this.placeRod(dt, live);
    this.handOnRod(live);
    // (where his boots are, for the splashes: runner space)
    if (!this.toeAt) this.toeAt = [new THREE.Vector3(), new THREE.Vector3()];
    this.toeAt[0].setFromMatrixPosition(this.b.toeL.matrixWorld);
    this.toeAt[1].setFromMatrixPosition(this.b.toeR.matrixWorld);
    this.shedDrops();
  }

  // The rod on his shoulder: carried by his chest, bouncing a little on it
  // with each stride and landing (a spring about where it rests on his
  // shoulder), swayed a touch by a lane change; hoisted when he's picked.
  placeRod(dt, live) {
    // (his arm steadies it: it rides with his chest, but only a part of the
    // chest's twist, roll and lean through each stride reaches it)
    // (half his lean it keeps - he holds it up as he leans into a run -
    // and his twist and roll hardly at all)
    this.b.chest.matrixWorld.decompose(_a, _q, _s);
    _v.set(0, 1, 0).applyQuaternion(_q);
    _q2.setFromAxisAngle(AX, 0.45 * Math.atan2(_v.z, _v.y));
    _q.slerp(_q2, ROD_STEADY * live);
    _m.compose(_a, _q, _s.set(1, 1, 1));
    this.rodF.multiplyMatrices(_m, this.relRod);
    const kick = this.pelvisD ? -this.pelvisD.y - 0.6 * (this.pelvisDP?.y || 0) : 0;
    this.rodBob.v += clamp(kick, -3, 3) * 0.9 * live;
    const bob = clamp(this.rodBob.step(0, 3.4, 0.32, dt), -0.2, 0.2);
    const sway = this.rodSway.step(clamp(-this.vx * 0.012, -0.12, 0.12), 2.5, 0.45, dt);
    const g = bump(0.0, 0.2, 0.5, 0.9, this.greetT);
    // (turned about where it rests on his shoulder)
    _m.makeTranslation(this.rodPivot.x, this.rodPivot.y, this.rodPivot.z);
    _m2.makeRotationFromEuler(new THREE.Euler(bob - 0.3 * g, 0, sway + 0.1 * g));
    _m3.makeTranslation(-this.rodPivot.x, -this.rodPivot.y, -this.rodPivot.z);
    this.rodF.multiply(_m).multiply(_m2).multiply(_m3);
    const rod = this.b.rod;
    this.rodF.decompose(rod.position, rod.quaternion, _s);
    rod.updateMatrix();
    rod.matrixWorld.copy(this.rodF);
  }

  // His right fist round the rod's grip (a two-bone solve of the arm).
  handOnRod(live) {
    _m.copy(this.rodF).multiply(this.gripRoll).multiply(this.relHeldInv);
    this.armTo('R', _m, _v3.set(0.6, -1, 0.5), 1);
  }

  // Two-bone solve of one arm, its hand to the frame H (runner space) - the
  // wrist where H puts it, the hand turned as H turns it - its elbow bent
  // toward pole, laid over the pose by w. (As the samurai's.)
  armTo(L, H, pole, w) {
    const b = this.b;
    const arm = b['arm' + L], fore = b['fore' + L], clav = b['clav' + L], hand = b['hand' + L];
    const ua = this.UPPER_ARM, fa = this.FOREARM;
    const T = _p.setFromMatrixPosition(H);
    const S = _a.setFromMatrixPosition(arm.matrixWorld);
    const d0 = T.distanceTo(S);
    const d = clamp(d0, Math.abs(ua - fa) + 0.01, ua + fa - 0.002);
    const n = _b.subVectors(T, S).divideScalar(d0 || 1);
    const pl = _v.copy(pole).addScaledVector(n, -pole.dot(n)).normalize();
    const a = (ua * ua - fa * fa + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, ua * ua - a * a));
    const E = _v2.copy(S).addScaledVector(n, a).addScaledVector(pl, h);
    const Y = E.sub(S).negate().normalize();
    const Z = _s.copy(n).addScaledVector(Y, -n.dot(Y));
    if (Z.lengthSq() < 1e-8) Z.copy(pl);
    Z.normalize().negate();
    const X = _dv.crossVectors(Y, Z);
    _m3.makeBasis(X, Y, Z);
    _q.setFromRotationMatrix(_m3);
    clav.matrixWorld.decompose(_v, _q2, _v2);
    _q2.invert().multiply(_q);
    arm.quaternion.slerp(_q2, w);
    const cosE = clamp((ua * ua + fa * fa - d * d) / (2 * ua * fa), -1, 1);
    fore.rotation.x += (Math.PI - Math.acos(cosE) - fore.rotation.x) * w;
    arm.updateMatrixWorld(true);
    H.decompose(_v, _q, _v2);
    fore.matrixWorld.decompose(_v, _q2, _v2);
    _q2.invert().multiply(_q);
    hand.quaternion.slerp(_q2, w);
    hand.updateMatrixWorld(true);
  }

  // --- secondary motion ---------------------------------------------------------------
  simulate(dt, steps) {
    this.packStep(dt);
    this.catchStep(dt, steps);
    this.tank.step(dt, this.time, this.accLocal, this.mode === 'run' ? this.speed : 0);
  }

  // The tank bounces on his back on its straps: a spring on each axis,
  // kicked by his own motion, about where it hangs.
  packStep(dt) {
    const S = this.packS;
    const live = 1 - (this.crashW || 0);
    const dv = this.pelvisD, dp = this.pelvisDP;
    if (dv) {
      S.y.v += (-dv.y * 0.012 - dp.y * 0.03) * live;
      S.x.v += (-dv.x * 0.004 - dp.x * 0.015) * live;
      S.z.v += -dv.z * 0.002 * live;
    }
    const y = clamp(S.y.step(0, 5.5, 0.28, dt), -0.025, 0.025);
    const x = clamp(S.x.step(0, 4.5, 0.3, dt), -0.02, 0.02);
    const z = clamp(S.z.step(0, 4.5, 0.3, dt), -0.02, 0.02);
    const t = this.b.tank;
    t.position.copy(this.bindPos.tank).sub(this.bindPos.chest);
    t.position.y += y;
    t.position.x += x;
    t.position.z += Math.abs(y) * 0.3 + z;
    t.rotation.set(-y * 2.2, 0, x * 2.5);
    t.updateMatrixWorld(true);
  }

  // The fish on its line: a point mass (its centre) swinging off the rod's
  // tip - pulled by gravity and pushed by his own accelerations, dragged a
  // little by the air, damped heavily (it's big and it's heavy: it sways,
  // it doesn't flap), kept within a cone under the tip and clear of his
  // head, his back, his arm and the tank. The line and the fish turn to
  // hang along it; the fish twists slowly about the line; its tail and its
  // fins follow its swings a moment late.
  catchStep(dt, steps) {
    if (dt <= 0) return;
    const F = this.fish;
    const Q = this.root.quaternion;
    const tip = _a.copy(this.tipLocal).applyMatrix4(this.rodF).applyQuaternion(Q);
    const L = this.catchL;
    // colliders into simulation space
    for (let i = 0; i < this.fishCols.length; i++) {
      const d = this.fishCols[i];
      const c = this.cols[i];
      const T = this.boneM(d.bone);
      if (d.kind === 'ell') {
        c.c.copy(d.c).applyMatrix4(T).applyQuaternion(Q);
        for (let e = 0; e < 3; e++) {
          c.ax[e].setFromMatrixColumn(T, e).normalize().applyQuaternion(Q);
          c.r[e] = d.r.getComponent(e);
        }
      } else {
        c.a.copy(d.a).applyMatrix4(T).applyQuaternion(Q);
        c.b.copy(d.b).applyMatrix4(T).applyQuaternion(Q);
        c.ra = d.ra;
        c.rb = d.rb;
      }
    }
    if (!F.ready) {
      F.p.copy(tip).addScaledVector(DOWN, L);
      F.q.copy(F.p);
      F.tip.copy(tip);
      F.ready = true;
    }
    const vel = _dv.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
    const airX = -vel.x + this.breeze.x * 0.3, airZ = -vel.z + this.breeze.z * 0.3;
    // (the game's gravity is ~3x real for the runner's jump: only part of
    // his own acceleration reaches the fish - it lifts a little and swings,
    // it doesn't fly up)
    const gx = -this.frameAcc.x * 0.22, gy = -9.8 * this.gk - this.frameAcc.y * 0.15, gz = -this.frameAcc.z * 0.15;
    const h = dt / steps;
    const t0 = F.tip;
    for (let s = 0; s < steps; s++) {
      // the tip moves through the step
      const k = (s + 1) / steps;
      _p.copy(t0).lerp(tip, k);
      const p = F.p, q = F.q;
      const vx = (p.x - q.x) / h, vy = (p.y - q.y) / h, vz = (p.z - q.z) / h;
      // (a little drag: the headwind leans it back only a touch)
      const ax = gx + 0.12 * (airX * 0.08 - vx);
      const ay = gy - 0.12 * vy;
      const az = gz + 0.12 * (airZ * 0.04 - vz);
      const damp = 0.94;
      const nx = p.x + (p.x - q.x) * damp + ax * h * h;
      const ny = p.y + (p.y - q.y) * damp + ay * h * h;
      const nz = p.z + (p.z - q.z) * damp + az * h * h;
      q.copy(p);
      p.set(nx, ny, nz);
      // on its line
      _v.subVectors(p, _p);
      let len = _v.length() || 1e-6;
      _v.divideScalar(len);
      // (held within a cone under the tip: it never swings up level)
      const cosMax = Math.cos(0.52);
      if (-_v.y < cosMax) {
        const hz = Math.hypot(_v.x, _v.z) || 1e-6;
        const sinMax = Math.sqrt(1 - cosMax * cosMax);
        _v.set((_v.x / hz) * sinMax, -cosMax, (_v.z / hz) * sinMax);
      }
      p.copy(_p).addScaledVector(_v, L);
      // kept off him (its middle, and its head nearer the tip)
      this.pushOut(p, 0.1);
      _v2.copy(_p).addScaledVector(_v, L * 0.45);
      const before = _before.copy(_v2);
      this.pushOut(_v2, 0.085);
      if (_v2.distanceToSquared(before) > 0) p.add(_v2.sub(before).multiplyScalar(1.6));
      // (and back on its line)
      _v.subVectors(p, _p).normalize();
      p.copy(_p).addScaledVector(_v, L);
    }
    F.tip.copy(tip);
    // the line and the fish along it, turned back into runner space
    const Qi = _q2.copy(Q).invert();
    const dir = _v.subVectors(F.p, tip).normalize().applyQuaternion(Qi);
    _q.setFromUnitVectors(DOWN, dir);
    // how fast it's swinging (for its tail and fins), and its slow twist
    // about the line, nudged by its swings
    const ang = Math.atan2(dir.x, -dir.y) + Math.atan2(dir.z, -dir.y);
    const angV = this.prevAng === null ? 0 : (ang - this.prevAng) / dt;
    this.prevAng = ang;
    this.twist.v += clamp(angV, -6, 6) * 0.05;
    const tw = clamp(this.twist.step(0.08 * Math.sin(this.time * 0.6), 0.55, 0.22, dt), -0.7, 0.7);
    _q.multiply(_q2.setFromAxisAngle(AY, tw));
    const tipR = _b.copy(this.tipLocal).applyMatrix4(this.rodF);
    const c = this.b.catch;
    c.position.copy(tipR);
    c.quaternion.copy(_q);
    c.updateMatrix();
    c.matrixWorld.copy(c.matrix);
    // its tail sweeps after its swings, and on its own a little, slowly;
    // its fins fan
    this.tailS.v += clamp(angV, -8, 8) * 0.35;
    const tail = clamp(this.tailS.step(0, 1.6, 0.18, dt), -0.6, 0.6);
    const lazy = 0.12 * Math.sin(this.time * 2.1) + 0.06 * Math.sin(this.time * 3.3 + 1);
    this.b.catchTail.rotation.set(tail + lazy, 0, 0);
    this.finS.v += clamp(angV, -8, 8) * 0.2;
    const fin = clamp(this.finS.step(0, 2.2, 0.2, dt), -0.5, 0.5);
    const fan = 0.15 * Math.sin(this.time * 2.6);
    this.b.catchFinL.rotation.set(0, -(fin + fan), 0);
    this.b.catchFinR.rotation.set(0, fin + fan, 0);
    for (const k of ['catchTail', 'catchFinL', 'catchFinR']) {
      const o = this.b[k];
      o.updateMatrix();
      o.matrixWorld.multiplyMatrices(c.matrixWorld, o.matrix);
    }
  }

  // A point pushed out of whatever of him it's inside (r: its own size).
  pushOut(p, r) {
    for (const c of this.cols) {
      if (c.kind === 'ell') {
        _o1.subVectors(p, c.c);
        const x = _o1.dot(c.ax[0]) / (c.r[0] + r), y = _o1.dot(c.ax[1]) / (c.r[1] + r), z = _o1.dot(c.ax[2]) / (c.r[2] + r);
        const k = Math.hypot(x, y, z);
        if (k < 1 && k > 1e-6) {
          const f = 1 / k - 1;
          p.addScaledVector(c.ax[0], x * f * (c.r[0] + r)).addScaledVector(c.ax[1], y * f * (c.r[1] + r)).addScaledVector(c.ax[2], z * f * (c.r[2] + r));
        }
      } else {
        _o2.subVectors(c.b, c.a);
        const L2 = _o2.lengthSq() || 1e-9;
        const tt = clamp(_o1.subVectors(p, c.a).dot(_o2) / L2, 0, 1);
        const cx = c.a.x + _o2.x * tt, cy = c.a.y + _o2.y * tt, cz = c.a.z + _o2.z * tt;
        _o1.set(p.x - cx, p.y - cy, p.z - cz);
        const d = _o1.length();
        const rr = c.ra + (c.rb - c.ra) * tt + r;
        if (d < rr && d > 1e-6) p.addScaledVector(_o1, (rr - d) / d);
      }
    }
  }
}
