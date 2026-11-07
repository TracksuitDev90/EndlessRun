import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials, makeWhiskerMaterial } from '../render/shaders.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { palette } from './kit.js';
import { Player, C, mirror, hermite } from './player.js';
import { CONFIG } from '../config.js';
import { Dust } from './dust.js';
import { Props, KINDS } from './props.js';
import { Seeds } from './seeds.js';

// The bunny: Bramble, a short, bipedal rabbit in a yellow bucket hat and
// round glasses, an olive satchel on his hip - the smallest of the runners
// by far, and the one who jumps highest (sculpted in tools/runner/bunny.py).
// He's a tumbler: quick and springy, parkour in every move. On top of the
// shared runner (player.js):
//   - a sprinter's run, quick little legs turning over under a forward
//     lean, arms pumping, ears streaming back;
//   - three jumps, dealt so the same one never comes twice running: a
//     rabbit's bound, stretched out long through the air; a float - he
//     pulls something out of his satchel at take-off (an umbrella, a
//     balloon, a giant dandelion: props.js) and drifts down hanging from it;
//     and a webster side flip, off one foot, the other leg kicking up and
//     over as he turns a whole sideways somersault. All have the same
//     airtime as everyone else's jump, so every gap is as fair - but the
//     highest apex in the game;
//   - a dive roll under the bars, a springy precision landing, a hop into
//     every lane change;
//   - his fluffy tail wags, in quick little flicks; his ears flop and
//     stream and twitch on springs (one bent over); his satchel bounces on
//     his hip and its flap lifts when he reaches into it; his hat's brim
//     flaps; his whiskers.

// Palette slots: 1-15 are the garment ids baked into the mesh, the rest are
// colours the character shader draws his details with (see CHAR_DETAIL).
export const COL = {
  1: '#8f5236', // face fur (warm brown)
  2: '#8f5236', // ears (outside)
  3: '#f3d5b1', // shirt (cream)
  4: '#d6602e', // trousers (rust)
  5: '#5a3424', // suspenders
  6: '#8f5236', // arms, shins
  7: '#ecbf96', // feet (tan)
  8: '#8f5236', // paws
  9: '#77733f', // satchel (olive)
  10: '#f6b43c', // hat (yellow)
  11: '#f2dcc0', // tail (cream)
  12: '#3b2416', // glasses
  13: '#fbf4e6', // buck teeth
  14: '#c8862f', // brass
  15: '#e2786a', // nose (pink)
  16: '#6a3a22', // fur, deep
  17: '#ad7350', // fur, light
  18: '#efc9a2', // cream muzzle
  19: '#f2968a', // inside the ears (pink)
  20: '#cfa47c', // shirt lines, buttons
  21: '#a9431f', // rust, deep
  22: '#fdf6ea', // eye whites
  23: '#4a2716', // irises (dark brown)
  24: '#1e120c', // ink: lids, pupils
  25: '#5b2c1e', // mouth
  26: '#e98a7a', // blush
  27: '#c98418', // hat, deep (seams, stitching)
  28: '#525028', // olive, deep
  29: '#f2c768', // brass, bright
  30: '#ffe08a', // hat highlight
  31: '#e9a58c', // foot pads
};

// How he runs: a sprinter on little legs - a quick cadence, the knees
// driving high, a strong forward lean, his arms pumping hard with the
// elbows bent; his big feet turned out a little.
const GAIT = {
  cadence: [2.3, 0.065],
  stride: { reach: 0.36, hipY: 0.4, bob: 0.024, trackX: 0.06, swingX: 0.078, toeOut: 0.16, heelLift: 0.82, ballZ: -0.02, maxDuty: 0.34, minContact: 0.035 },
  swing: [
    [0.16, 0.2, 0.18, 0.02, 0.02],
    [0.4, 0.1, 0.285, 0.0, 0.05],
    [0.65, -0.09, 0.22, -0.025, 0.02],
    [0.84, -0.16, 0.15, -0.012, 0.0],
  ],
  arm: {
    swing: [0.2, 0.62, 0.72, 0.45, -0.12, -0.55, -0.66, -0.4],
    abd: [0.32, 0.28, 0.27, 0.3, 0.33, 0.36, 0.37, 0.35],
    elbow: [1.5, 1.8, 1.95, 1.75, 1.4, 1.15, 1.1, 1.25],
    amp: [0.95, 0.25],
  },
  lean: [0.24, 0.14],
  hipYaw: 0.2,
  hipRoll: 0.06,
  spTwist: 0.2,
  chTwist: 0.15,
};

// How he handles: snappy between the lanes, and the highest jump in the
// game - the same airtime as everyone's (CONFIG.jump.time), so every gap is
// as fair, but well over half as high again; he lands on springs.
const FEEL = {
  laneSpring: 38,
  lean: [0.045, 0.5],
  turn: [0.03, 0.4],
  blend: [5, 6.5, 7],
  jump: { height: 2.3, time: CONFIG.jump.time },
  land: { freq: 5.0, zeta: 0.24, thud: 0 },
};

// The float's arc: a pop straight up to its apex in RISE s, then a drift
// down - gravity FALL_G until he's sinking at a steady speed, then that
// speed to the road - in exactly the rest of the airtime.
const FLOAT = { height: 2.15, rise: 0.24, fallG: 32 };
function solveFloat(H, T) {
  const t1 = FLOAT.rise;
  const Td = T - t1;
  const g2 = Math.max(FLOAT.fallG, (2 * H) / (Td * Td) + 0.5);
  return { G1: (2 * H) / (t1 * t1), V0: (2 * H) / t1, G2: g2, VT: g2 * (Td - Math.sqrt(Td * Td - (2 * H) / g2)) };
}

// His jumps, dealt from a shuffled deck so the same one never comes twice
// running (the bound a little more often than the others).
const TRICKS = ['leap', 'float', 'webster', 'leap', 'webster', 'float', 'leap'];

// The bound, keyed on how far through the jump he is (0 take-off, 0.5 the
// top, 1 landing): he springs off both feet, stretches right out through the
// air - arms reaching ahead, legs trailing long behind, toes pointed, ears
// laid back - and swings his legs through under him to land. (L the leg he
// leads with; lateral channels are per-side magnitudes, as everywhere.)
const LEAP_T = [0, 0.18, 0.45, 0.72, 1];
const LEAP = {
  hipPitch: [0.05, 0.0, -0.05, 0.05, 0.1],
  spLean: [0.25, -0.05, -0.15, 0.1, 0.3],
  chLean: [0.05, -0.08, -0.12, 0.0, 0.08],
  hdPitch: [0.05, 0.55, 0.95, 0.6, 0.1],
  thLx: [-0.35, -0.55, -0.72, 0.45, 0.95],
  knL: [0.35, 0.25, 0.3, 1.25, 0.9],
  anL: [-0.5, -0.65, -0.72, -0.2, 0.15],
  thRx: [0.15, -0.38, -0.58, 0.6, 0.85],
  knR: [0.9, 0.35, 0.35, 1.35, 0.85],
  anR: [-0.3, -0.6, -0.72, -0.2, 0.15],
  thLz: [0.06, 0.05, 0.05, 0.1, 0.12],
  thRz: [0.06, 0.05, 0.05, 0.1, 0.12],
  shLx: [1.4, 2.4, 2.55, 1.6, 0.5],
  shRx: [0.9, 2.1, 2.35, 1.4, 0.4],
  shLz: [0.25, 0.25, 0.3, 0.6, 0.85],
  shRz: [0.3, 0.3, 0.35, 0.6, 0.8],
  elL: [0.7, 0.25, 0.15, 0.5, 0.8],
  elR: [0.9, 0.35, 0.2, 0.55, 0.8],
  clL: [0.05, 0.18, 0.22, 0.1, 0.05],
  clR: [0.05, 0.18, 0.22, 0.1, 0.05],
  wrL: [0.1, -0.2, -0.3, 0.0, 0.1],
  wrR: [0.1, -0.2, -0.3, 0.0, 0.1],
};
// ...and the whole of him tipped forward about his middle, flying flat out
const LEAP_TILT = [0.0, -0.45, -0.95, -0.45, 0.05];

// The webster side flip, keyed on how far round he has turned (0 upright at
// take-off, 0.5 upside down, 1 upright again): off one foot (L), the other
// (R) kicking up and out to the side to throw him over, arms flung up; tucked
// tight over the top, knees to his chest, arms hugging them; opening out,
// arms wide, to land on the leg he kicked with.
const WEB_T = [0, 0.12, 0.3, 0.5, 0.7, 0.86, 1];
const WEB = {
  hipPitch: [0.05, 0.0, 0.1, 0.15, 0.1, 0.05, 0.05],
  spLean: [0.2, 0.05, 0.4, 0.55, 0.35, 0.1, 0.2],
  chLean: [0.05, 0.0, 0.2, 0.3, 0.15, 0.0, 0.05],
  hdPitch: [0.05, 0.12, 0.25, 0.3, 0.2, 0.08, 0.05],
  thLx: [-0.25, -0.1, 1.2, 1.9, 1.3, 0.5, 0.45],
  knL: [0.3, 0.15, 1.6, 2.2, 1.5, 0.6, 0.8],
  anL: [-0.5, -0.5, 0.0, 0.3, 0.1, 0.0, 0.1],
  thRx: [0.9, 1.5, 1.6, 1.8, 1.2, 0.6, 0.6],
  knR: [0.2, 0.15, 1.2, 2.1, 1.3, 0.5, 0.7],
  anR: [-0.3, -0.4, 0.0, 0.3, 0.1, 0.0, 0.1],
  thLz: [0.05, 0.05, 0.15, 0.2, 0.15, 0.12, 0.1],
  thRz: [0.35, 0.7, 0.4, 0.2, 0.25, 0.2, 0.12],
  shLx: [2.0, 2.6, 1.4, 0.9, 1.0, 0.8, 0.5],
  shRx: [1.6, 2.3, 1.3, 0.85, 1.0, 0.8, 0.5],
  shLz: [0.5, 0.9, 0.4, 0.3, 0.6, 1.2, 0.8],
  shRz: [0.5, 0.8, 0.4, 0.3, 0.6, 1.2, 0.8],
  elL: [0.4, 0.2, 1.2, 1.6, 1.0, 0.4, 0.6],
  elR: [0.4, 0.2, 1.2, 1.6, 1.0, 0.4, 0.6],
  clL: [0.15, 0.2, 0.05, 0.05, 0.05, 0.1, 0.05],
  clR: [0.15, 0.2, 0.05, 0.05, 0.05, 0.1, 0.05],
};
const keys = (T, K) => [Float64Array.from(T), Object.entries(K).map(([k, v]) => [C[k], Float64Array.from(v)])];
const [LEAP_TS, LEAP_KEYS] = keys(LEAP_T, LEAP);
const [WEB_TS, WEB_KEYS] = keys(WEB_T, WEB);
const LEAP_TILT_V = Float64Array.from(LEAP_TILT);

// The dive roll under a bar, by how far through the slide he is: a dive,
// arms reaching for the road; tucked into a ball rolling once over forward;
// up into a crouch on his big feet and away. (Channel values; the roll
// itself turns the whole of him about ROLL_PIVOT, see afterPose.)
const DIVE = { hipY: 0.33, hipPitch: 0.1, spLean: 0.9, chLean: 0.2, hdPitch: 0.65, thLx: 0.5, thRx: 0.35, knL: 0.8, knR: 0.6, anL: 0.2, anR: 0.1, thLz: 0.08, thRz: 0.08, shLx: 1.75, shRx: 1.7, shLz: 0.3, shRz: 0.3, elL: 0.25, elR: 0.25, clL: 0.15, clR: 0.15 };
const TUCK = { hipY: 0.3, hipPitch: 0.15, spLean: 1.05, chLean: 0.5, hdPitch: -0.5, thLx: 2.15, thRx: 2.1, knL: 2.4, knR: 2.35, anL: 0.45, anR: 0.45, thLz: 0.18, thRz: 0.18, shLx: 1.05, shRx: 1.0, shLz: 0.3, shRz: 0.32, shLy: 0.3, shRy: 0.3, elL: 1.75, elR: 1.75, clL: 0.08, clR: 0.08 };
const CROUCH = { hipY: 0.29, hipPitch: 0.15, spLean: 0.55, chLean: 0.15, hdPitch: 0.5, thLx: 1.45, thRx: 1.3, knL: 2.05, knR: 1.95, anL: 0.6, anR: 0.55, thLz: 0.12, thRz: 0.12, shLx: 1.2, shRx: 1.1, shLz: 0.45, shRz: 0.45, elL: 0.6, elR: 0.6, clL: 0.05, clR: 0.05 };
const STAND = { hipY: 0.4, hipPitch: 0.06, spLean: 0.3, chLean: 0.05, hdPitch: 0.15, thLx: 0.55, thRx: 0.35, knL: 0.85, knR: 0.6, anL: 0.2, anR: 0.15, thLz: 0.06, thRz: 0.06, shLx: 0.6, shRx: -0.2, shLz: 0.3, shRz: 0.3, elL: 1.3, elR: 1.2, clL: 0, clR: 0 };
// (the middle of the ball he's tucked into: up, and forward of his feet)
const ROLL_PIVOT = 0.3;
const ROLL_FWD = -0.1;
// Points on him that mustn't go under the road as he rolls (bone, where on
// it): his hat's crown and brim, his hands, heels and toes, knees, back, seat.
const CLEAR = [
  ['head', 0, 0.3, 0.03], ['head', 0, 0.1, 0.24], ['head', 0, 0.2, -0.17], ['head', -0.2, 0.08, 0.03], ['head', 0.2, 0.08, 0.03],
  ['handL', 0, -0.05, 0], ['handR', 0, -0.05, 0], ['toeL', 0, 0, -0.07], ['toeR', 0, 0, -0.07], ['footL', 0, -0.05, 0.05], ['footR', 0, -0.05, 0.05],
  ['shinL', 0, 0, -0.03], ['shinR', 0, 0, -0.03], ['chest', 0, 0.06, 0.09], ['hips', 0, -0.04, 0.13],
];
const TILT_PIVOT = 0.5;
const FLIP_PIVOT = 0.5;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _dv = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);

// Rotate the body about a point pivot m up it (and fwd m along it).
function turnAbout(b, q, pivot, fwd = 0) {
  b.quaternion.premultiply(q);
  _p.set(0, pivot, fwd);
  _v.copy(_p).applyQuaternion(q);
  b.position.applyQuaternion(q).add(_p).sub(_v);
}

export class Bunny extends Player {
  constructor(envDef, asset) {
    super(envDef, asset, { gait: GAIT, feel: FEEL });
    // (too small for the fox to ride on, or to shoot through his legs)
    this.small = true;
  }

  configure() {
    super.configure();
    const F = solveFloat(FLOAT.height, this.feel.jump.time);
    this.FG1 = F.G1;
    this.FV0 = F.V0;
    this.FG2 = F.G2;
    this.FVT = F.VT;
  }

  // In the air: the plain arc for the bound and the flip; for the float,
  // the pop up and the drift down (solved exactly piece by piece, the same
  // at any frame rate). A fast-fall drops him out of it on plain gravity.
  fall(dt) {
    if (!this.floating || this.floatFast) return super.fall(dt);
    let left = dt;
    for (let i = 0; i < 4 && left > 0; i++) {
      const vy = this.vy;
      let g, tb;
      if (vy > 0) (g = this.FG1), (tb = vy / g);
      else if (vy > -this.FVT) (g = this.FG2), (tb = (vy + this.FVT) / g);
      else (g = 0), (tb = Infinity);
      const h = Math.min(left, tb + 1e-6);
      this.y += vy * h - 0.5 * g * h * h;
      this.vy -= g * h;
      left -= h;
    }
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    const mats = makeCharacterMaterials(this.u, palette(COL), [], 0.0078, null, { style: 'bunny' });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.buildBody();
    this.buildWhiskers();
    this.props = new Props(this.u);
    this.props.attach(this.root);
    this.dust = new Dust(this.u);
    this.seeds = new Seeds(this.u);
    // the satchel, its flap's hinge (bind space) and the way it swings
    const R = this.rig.bag;
    this.bagSide = new THREE.Vector3(...R.side);
    this.bagMouth = new THREE.Vector3(...R.mouth);
    // the fold in his left ear (the axis it's bent over about)
    const L = this.rig.ears.L;
    const u1 = new THREE.Vector3(...L.u1), u2 = new THREE.Vector3(...L.u2);
    this.foldAxis = new THREE.Vector3().crossVectors(u1, u2).normalize();
  }

  // Six fine whiskers, three either side of his muzzle, sweeping out and a
  // little back, drooping toward their tips: ribbons on the head bone,
  // drawn in ink (see VS_WHISKER).
  buildWhiskers() {
    const head = this.bindPos.head;
    const pos = [], aw = [], idx = [];
    const n = 10;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const root = new THREE.Vector3(s * 0.046, 0.879 - k * 0.0075, -0.108 + k * 0.003);
        const e = 0.2 - 0.19 * k;
        const dir = new THREE.Vector3(s * Math.cos(e), Math.sin(e), 0.18 + 0.08 * k).normalize();
        const L = 0.12 - 0.008 * Math.abs(k - 1);
        const base = pos.length / 3;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const p = root.clone().addScaledVector(dir, L * t);
          p.y -= 0.018 * t * t;
          const tan = dir.clone().multiplyScalar(L).add(new THREE.Vector3(0, -0.036 * t, 0)).normalize();
          const hw = 0.0011 * (1 - 0.7 * t);
          for (const side of [-1, 1]) {
            pos.push(p.x - head.x, p.y - head.y, p.z - head.z);
            aw.push(tan.x, tan.y, tan.z, side * hw);
          }
          if (i < n) {
            const a = base + i * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 4));
    geo.setIndex(idx);
    this.whiskers = new THREE.Mesh(geo, makeWhiskerMaterial(this.u, COL[24]));
    this.whiskers.frustumCulled = false;
    this.whiskers.renderOrder = -18;
    this.b.head.add(this.whiskers);
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points, this.seeds.points, this.props.free];
  }

  forCompile(on) {
    this.dust.forCompile(on);
    this.seeds.forCompile(on);
    this.props.forCompile(on);
  }

  buildSim() {
    super.buildSim();
    this.bagBind = this.b.bag.position.clone();
    this.bagS = { y: new Spring(), pitch: new Spring(), roll: new Spring(), flap: new Spring() };
    this.tailS = { side: new Spring(), lift: new Spring() };
    this.earS = { twR: new Spring(), twL: new Spring(), perk: new Spring(), flop: new Spring() };
    this.spins = {
      pitch: { value: 0, from: 0, to: 0, start: 0, t: 0, delay: 0, dur: 1, pivot: ROLL_PIVOT, ease: null },
      roll: { value: 0, from: 0, to: 0, start: 0, t: 0, delay: 0, dur: 1, pivot: FLIP_PIVOT, ease: null },
    };
    this.prop = { kind: null, t: 0, state: 'none', open: 0, size: 0, end: 0, seedT: 0 };
    this.gripM = new THREE.Matrix4();
  }

  resetSim() {
    super.resetSim();
    for (const g of [this.bagS, this.tailS, this.earS]) for (const s of Object.values(g || {})) s.reset();
    for (const S of Object.values(this.spins || {})) {
      S.value = S.from = S.to = S.start = 0;
      S.ease = null;
    }
    this.deck = this.deck || [];
    this.trick = this.trick || 'leap';
    this.floating = false;
    this.floatFast = false;
    this.tilt = 0;
    this.hopLift = 0;
    this.flapKick = 0;
    this.flapOpen = 0;
    this.dodgeT = 9;
    this.dodgeDir = 1;
    this.greetT = 9;
    this.wag = 0;
    this.wagT = 1 + 2 * Math.random();
    this.wagPh = 0;
    this.twitchT = 2 + 3 * Math.random();
    this.lastDt = 0;
    this.lastItem = this.lastItem || null;
    this.letGoPending = false;
    this.rollPlan = null;
    if (this.prop) {
      this.prop.kind = null;
      this.prop.state = 'none';
    }
    this.props?.clear();
    this.dust?.clear();
    this.seeds?.clear();
  }

  update(dt, speed, groundAt) {
    this.lastDt = dt;
    super.update(dt, speed, groundAt);
    // now and then a little burst of wagging; more often while he stands
    this.wagT -= dt;
    if (this.wagT <= 0) {
      this.wag = Math.min(1.3, this.wag + 1);
      this.wagT = this.mode === 'run' ? 2.5 + 4 * Math.random() : 1.4 + 2.4 * Math.random();
    }
    this.wag = Math.max(0, this.wag - dt * 1.1);
    // standing about, an ear twitches now and then
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      const S = Math.random() < 0.5 ? this.earS.twR : this.earS.twL;
      S.v += (this.mode === 'run' ? 3 : 6) * (Math.random() < 0.5 ? -1 : 1);
      this.twitchT = this.mode === 'run' ? 3 + 5 * Math.random() : 1.5 + 3 * Math.random();
    }
    this.greetT += dt;
  }

  place(z, dist = 0) {
    super.place(z);
    if (this.letGoPending) {
      this.letGoPending = false;
      _dv.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
      this.props.letGo(this.root, z, dist, _dv);
      if (this.prop.state === 'gone') {
        this.prop.kind = null;
        this.prop.state = 'none';
      }
    }
    this.props.update(this.lastDt, z, dist);
    this.dust.update(this.lastDt, this.root, z, dist);
    this.seeds.update(this.lastDt, this.root, z, dist);
    this.lastDt = 0;
  }

  // --- spins ------------------------------------------------------------------------
  // A turn of the whole body (pitch: about x, negative going over forward -
  // the dive roll; roll: about the line he's running along - the side flip),
  // eased from one angle to the next over dur seconds after a delay; cut
  // short, it whips round to finish quickly.
  spinTo(axis, turns, delay, dur, ease = null) {
    const S = this.spins[axis];
    S.from = S.start = S.value;
    S.ease = ease;
    // (always at least half a turn still to go)
    S.to = turns > 0 ? Math.ceil((S.value + Math.PI) / TAU) * TAU + (turns - 1) * TAU : Math.floor((S.value - Math.PI) / TAU) * TAU - (-turns - 1) * TAU;
    S.t = 0;
    S.delay = delay;
    S.dur = dur;
  }

  hurry(axis, dur = 0.14) {
    const S = this.spins?.[axis];
    if (!S || S.value === S.to) return;
    S.from = S.value;
    S.t = 0;
    S.delay = 0;
    S.dur = dur;
    S.ease = null;
  }

  turnedOf(axis) {
    const S = this.spins[axis];
    const span = S.to - S.start;
    return span ? clamp((S.value - S.start) / span, 0, 1) : 1;
  }

  // --- moves ------------------------------------------------------------------------
  jump() {
    // (nextTrick: asked for by the viewer - see tools/runner/view.html)
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
    this.floatFast = false;
    this.floating = this.trick === 'float';
    this.hurry('pitch', 0.16);
    if (this.floating) {
      this.vy = this.FV0;
      this.vyPose = this.FV0;
      this.startFloat();
    } else if (this.prop.state === 'hold' || this.prop.state === 'out') {
      this.endFloat();
    }
    if (this.trick === 'webster') this.spinTo('roll', this.jumpSide, 0.05, this.feel.jump.time * 0.8, WEB_EASE);
    else this.hurry('roll', 0.16);
    // the tail flicks up as he springs, the ears are thrown back
    this.tailS.lift.v += 6;
    this.earS.flop.v -= 3;
  }

  // Into the satchel: something to float down on (never the same thing
  // twice running).
  startFloat() {
    let k = this.nextItem;
    this.nextItem = null;
    if (!KINDS.includes(k)) {
      do k = KINDS[Math.floor(Math.random() * KINDS.length)];
      while (k === this.lastItem);
    }
    this.lastItem = k;
    const P = this.prop;
    // (one still being put away goes straight back in)
    this.props.hide();
    P.kind = k;
    P.t = 0;
    P.state = 'out';
    P.seedT = 0;
    if (k === 'balloon') this.props.pickColour();
    this.flapKick += 17;
  }

  // Done with it: the umbrella's furled and put away, the balloon let go,
  // the dandelion's seeds blown off in a puff.
  endFloat() {
    const P = this.prop;
    if (!P.kind || P.state === 'away' || P.state === 'gone') return;
    P.state = 'away';
    P.end = P.t;
    if (P.kind === 'balloon') {
      // (let go of in place, once he's where he is this frame)
      this.letGoPending = true;
      P.state = 'gone';
    } else if (P.kind === 'dandelion') this.seedBurst(20);
    else this.flapKick += 12;
  }

  onFastFall() {
    this.hurry('pitch');
    this.hurry('roll');
    if (this.floating) {
      this.floatFast = true;
      this.endFloat();
    }
  }

  onLand(hit) {
    this.hurry('pitch', 0.1);
    this.hurry('roll', 0.1);
    if (this.floating) this.endFloat();
    this.floating = false;
    this.floatFast = false;
    if (this.crashed || this.mode !== 'run') return;
    this.earS.flop.v += 4 * Math.min(1.4, hit);
    this.tailS.lift.v -= 4 * hit;
    if (hit > 0.75 && !this.wet) this.landDust(hit);
  }

  // Dive roll: down, over once, and up.
  startSlide() {
    const fresh = this.slideT <= 0;
    super.startSlide();
    this.hurry('roll', 0.1);
    if (!fresh) return;
    this.spinTo('pitch', -1, 0.08, 0.4, ROLL_EASE);
    this.spins.pitch.pivot = ROLL_PIVOT;
    this.rollPlan = { t: 0, hit: false, next: 0, up: false };
  }

  onDodge(dir) {
    this.dodgeT = 0;
    this.dodgeDir = dir;
    this.tailS.side.v -= dir * 4;
  }

  stumble() {
    super.stumble();
    this.earS.flop.v += 5;
    this.wag = 0;
  }

  crash() {
    super.crash();
    this.endFloat();
    this.floating = false;
  }

  // Picked on the title screen: a happy little hop, ears springing up, tail
  // going like anything.
  greet() {
    this.greetT = 0;
    this.wag = 1.4;
    this.earS.perk.v += 7;
  }

  // --- poses ------------------------------------------------------------------------
  poseRun(r, f, sp) {
    super.poseRun(r, f, sp);
    // (hands flat as blades, the wrists straight)
    r[C.wrL] = 0.04;
    r[C.wrR] = 0.04;
    r[C.hdPitch] += 0.04;
  }

  // Standing: his hands in his pockets, rocking up onto his toes and back,
  // looking about with his head cocked, curious - and when he's picked, a
  // little hop.
  poseIdle(id, t) {
    const ws = super.poseIdle(id, t);
    const rock = Math.sin(t * 1.7);
    id[C.hipY] += 0.004 * rock;
    id[C.hdRoll] += 0.14 * Math.sin(t * 0.31 + 1.2) + 0.06 * Math.sin(t * 0.9);
    id[C.hdPitch] += 0.08 + 0.05 * Math.sin(t * 0.53);
    id[C.spLean] += 0.02;
    // hands in his pockets
    for (const [sh, sy, sz, el, wr, wz] of [[C.shLx, C.shLy, C.shLz, C.elL, C.wrL, C.wrLz], [C.shRx, C.shRy, C.shRz, C.elR, C.wrR, C.wrRz]]) {
      id[sh] = -0.06 + 0.02 * rock;
      id[sy] = 0.4;
      id[sz] = 0.2;
      id[el] = 0.62;
      id[wr] = 0.3;
      id[wz] = 0.15;
    }
    // the hop
    const g = this.greetT < 0.55 ? this.greetT / 0.55 : 1;
    const up = g < 1 ? Math.sin(g * Math.PI) : 0;
    const crouch = g < 1 ? Math.max(0, Math.sin(Math.min(1, g * 4) * Math.PI)) * (g < 0.25 ? 1 : 0) : 0;
    this.hopLift = 0.16 * up * up;
    id[C.knL] += 0.9 * up + 0.5 * crouch;
    id[C.knR] += 0.9 * up + 0.5 * crouch;
    id[C.thLx] += 0.5 * up + 0.25 * crouch;
    id[C.thRx] += 0.5 * up + 0.25 * crouch;
    id[C.anL] -= 0.5 * up;
    id[C.anR] -= 0.5 * up;
    id[C.hipY] -= 0.05 * crouch;
    // (out of his pockets and flung up for it)
    id[C.shLx] += 1.2 * up;
    id[C.shRx] += 1.2 * up;
    id[C.shLz] += 0.8 * up;
    id[C.shRz] += 0.8 * up;
    id[C.shLy] -= 0.55 * up;
    id[C.shRy] -= 0.55 * up;
    id[C.elL] -= 0.5 * up;
    id[C.elR] -= 0.5 * up;
    return ws;
  }

  poseJump(j) {
    this.tilt = 0;
    if (this.trick === 'webster') return this.poseWebster(j);
    if (this.trick === 'float') return this.poseFloat(j);
    return this.poseLeap(j);
  }

  poseLeap(j) {
    const u = clamp(0.5 - (0.5 * this.vyPose) / this.V0, 0, 1);
    j.fill(0);
    j[C.hipY] = this.HIP_Y;
    j[C.sq] = 1;
    for (const [i, v] of LEAP_KEYS) j[i] = hermite(LEAP_TS, v, 0, 0, u);
    this.tilt = hermite(LEAP_TS, LEAP_TILT_V, 0, 0, u);
    if (this.jumpSide < 0) mirror(j);
  }

  poseWebster(j) {
    const u = this.turnedOf('roll');
    j.fill(0);
    j[C.hipY] = this.HIP_Y - 0.06 * Math.sin(Math.PI * u);
    j[C.sq] = 1;
    for (const [i, v] of WEB_KEYS) j[i] = hermite(WEB_TS, v, 0, 0, u);
    j[C.elL] = Math.max(0, j[C.elL]);
    j[C.elR] = Math.max(0, j[C.elR]);
    if (this.jumpSide < 0) mirror(j);
  }

  // The float, by time since take-off: he springs up with his knees tucked,
  // his left hand diving into the satchel on his hip, pulls out whatever's
  // in there and thrusts it up overhead as it opens (both hands on the
  // umbrella), then hangs from it as he drifts down, his legs dangling and
  // pedalling gently, swinging a little under it.
  poseFloat(j) {
    const t = this.jumpT;
    const T = this.time;
    const reach = smooth(0.0, 0.05, t) * (1 - smooth(0.09, 0.17, t));
    const lift = smooth(0.08, 0.22, t);
    const hang = smooth(0.16, 0.32, t);
    const tuck = 1 - hang;
    const both = this.prop.kind === 'umbrella' ? 1 : 0;
    const pedal = Math.sin(T * 6.5);
    j.fill(0);
    j[C.hipY] = this.HIP_Y;
    j[C.sq] = 1 + 0.03 * hang;
    j[C.spLean] = 0.25 * tuck - 0.04 * hang;
    j[C.chLean] = 0.05 * tuck - 0.06 * hang;
    j[C.hdPitch] = 0.1 * tuck + 0.32 * hang;
    j[C.hdYaw] = 0.12 * hang * Math.sin(T * 1.3);
    j[C.thLx] = 1.15 * tuck + (0.25 + 0.3 * pedal) * hang;
    j[C.knL] = 1.7 * tuck + (0.35 + 0.3 * Math.max(0, pedal)) * hang;
    j[C.thRx] = 1.0 * tuck + (0.2 - 0.3 * pedal) * hang;
    j[C.knR] = 1.55 * tuck + (0.35 + 0.3 * Math.max(0, -pedal)) * hang;
    j[C.anL] = 0.1 * tuck - 0.55 * hang;
    j[C.anR] = 0.1 * tuck - 0.55 * hang;
    j[C.thLz] = 0.08;
    j[C.thRz] = 0.08;
    // the left arm: down into the satchel, then up overhead holding it
    const m = (a, b, k) => a + (b - a) * k;
    j[C.shLx] = m(m(0.6, -0.15, reach), 2.95, lift);
    j[C.shLz] = m(m(0.4, 0.5, reach), 0.14, lift);
    j[C.shLy] = 0;
    j[C.elL] = m(m(0.8, 0.35, reach), 0.12, lift);
    j[C.wrL] = m(0.2, -0.1, lift);
    j[C.clL] = 0.22 * lift;
    // the right: up beside it on the umbrella, else out for balance
    const wave = 0.18 * Math.sin(T * 5.5) * hang;
    j[C.shRx] = m(m(0.9, 0.6 + wave * 0.5, lift), 2.85, lift * both);
    j[C.shRz] = m(m(0.5, 1.2 + wave, lift), 0.02, lift * both);
    j[C.elR] = m(m(0.8, 0.45, lift), 0.22, lift * both);
    j[C.clR] = 0.2 * lift * both;
    // swinging a little under it
    j[C.bodyRoll] = 0.07 * Math.sin(T * 3.1) * hang;
  }

  // The dive roll (see DIVE, TUCK, CROUCH, STAND): the shape follows how far
  // through the slide he is; the roll over turns him (startSlide).
  poseSlide(s, t) {
    if (this.slideT > 0) this.slideU = 1 - clamp(this.slideT / CONFIG.slide.time, 0, 1);
    const u = this.slideU ?? 1;
    const k1 = smooth(0.04, 0.16, u);
    const k2 = smooth(0.58, 0.72, u);
    const k3 = smooth(0.74, 1.0, u);
    s.fill(0);
    s[C.sq] = 1;
    for (const k in TUCK) {
      const i = C[k];
      let v = (DIVE[k] ?? 0) + ((TUCK[k] ?? 0) - (DIVE[k] ?? 0)) * k1;
      v += ((CROUCH[k] ?? 0) - v) * k2;
      v += ((STAND[k] ?? 0) - v) * k3;
      s[i] = v;
    }
    // (a little rattle over the road as he rolls)
    s[C.spLean] += 0.02 * Math.sin(t * 43) * k1 * (1 - k2);
    if (this.slideSide < 0) mirror(s);
  }

  // He lands on springs, a precision landing: down deep onto the balls of
  // his big feet, folding over his knees, arms swung forward for balance -
  // and straight back up out of it onto his toes, arms flicking out, ears
  // bouncing, and a smaller bounce after.
  landOverlay(Pz, land) {
    const d = Math.max(0, land), p = Math.max(0, -land);
    Pz[C.hipY] += -0.085 * d + 0.04 * p;
    Pz[C.knL] += 0.7 * d - 0.12 * p;
    Pz[C.knR] += 0.7 * d - 0.12 * p;
    Pz[C.thLx] += 0.45 * d;
    Pz[C.thRx] += 0.45 * d;
    Pz[C.anL] += 0.3 * d - 0.45 * p;
    Pz[C.anR] += 0.3 * d - 0.45 * p;
    Pz[C.spLean] += 0.35 * d - 0.06 * p;
    Pz[C.hdPitch] += 0.22 * d - 0.1 * p;
    Pz[C.shLx] += 0.9 * d + 0.3 * p;
    Pz[C.shRx] += 0.9 * d + 0.3 * p;
    Pz[C.shLz] += 0.15 * d + 0.45 * p;
    Pz[C.shRz] += 0.15 * d + 0.45 * p;
    Pz[C.elL] -= 0.3 * d;
    Pz[C.elR] -= 0.3 * d;
    Pz[C.sq] += -0.06 * d + 0.06 * p;
  }

  // A lane change: a quick sideways hop, knees tucked, leaning hard into
  // it, arms out, ears and tail swinging.
  laneOverlay(Pz, lc, dt) {
    super.laneOverlay(Pz, lc, dt);
    this.dodgeT += dt;
    const e = this.dodgeT < 0.28 ? Math.sin((this.dodgeT / 0.28) * Math.PI) : 0;
    const w = this.w.run;
    const d = this.dodgeDir;
    Pz[C.hipY] += 0.06 * e * w;
    Pz[C.knL] += 0.5 * e * w;
    Pz[C.knR] += 0.5 * e * w;
    Pz[C.thLx] += 0.3 * e * w;
    Pz[C.thRx] += 0.3 * e * w;
    Pz[C.spSide] -= 0.16 * lc;
    Pz[C.chSide] -= 0.08 * lc;
    Pz[C.hdRoll] += 0.2 * lc;
    Pz[C.shLz] += 0.45 * e;
    Pz[C.shRz] += 0.45 * e;
    Pz[C.elL] -= 0.3 * e;
    Pz[C.elR] -= 0.3 * e;
    Pz[d > 0 ? C.thRz : C.thLz] += 0.25 * e * w;
  }

  // The spins (and the bound's lean into the air, and the greeting's hop)
  // go on after the pose: about his middle for the flip and the bound, about
  // the middle of the ball he's tucked into for the roll.
  afterPose(dt, cw) {
    for (const S of Object.values(this.spins)) {
      if (S.value === S.to) continue;
      S.t += dt;
      const u = clamp((S.t - S.delay) / S.dur, 0, 1);
      const e = S.ease ? S.ease(u) : u * u * (3 - 2 * u);
      S.value = u >= 1 ? S.to : S.from + (S.to - S.from) * e;
    }
    const live = 1 - cw;
    const b = this.body;
    b.position.y += this.hopLift * this.w.idle * live;
    const tilt = this.tilt * this.w.jump * live;
    if (tilt !== 0) turnAbout(b, _q.setFromAxisAngle(AX, tilt), TILT_PIVOT);
    const pitch = (this.spins.pitch.value % TAU) * live;
    if (pitch !== 0) turnAbout(b, _q.setFromAxisAngle(AX, pitch), this.spins.pitch.pivot, ROLL_FWD);
    const roll = (this.spins.roll.value % TAU) * live;
    if (roll !== 0) turnAbout(b, _q.setFromAxisAngle(AZ, roll), FLIP_PIVOT);
    // rolling on the road: nothing of him goes under it (his ball isn't
    // round - he's lifted off it as his big head and hat come round)
    this.rollAmt = 0;
    if (pitch !== 0 && this.grounded) {
      this.root.matrixWorld.identity();
      b.updateWorldMatrix(false, true);
      let lo = Infinity;
      for (const [bn, x, y, z] of CLEAR) lo = Math.min(lo, _v2.set(x, y, z).applyMatrix4(this.b[bn].matrixWorld).y);
      if (lo < 0.03) b.position.y += 0.03 - lo;
      this.rollAmt = Math.min(1, Math.abs(Math.sin(pitch * 0.5)) * 1.6) * this.w.slide;
    }
  }

  // --- secondary motion ---------------------------------------------------------------
  simulate(dt) {
    this.bagStep(dt);
    this.tailStep(dt);
    this.earStep(dt);
    this.propStep(dt);
    this.rollDust(dt);
  }

  // The satchel hangs from its strap on his hip: it bounces with every
  // stride, swings out with a lane change and flies up through a jump, and
  // its flap lifts when he reaches in.
  bagStep(dt) {
    const b = this.b;
    const S = this.bagS;
    const dv = this.pelvisD, dp = this.pelvisDP;
    const live = 1 - (this.crashW || 0);
    const up = (dv.y * 0.6 + dp.y) * live;
    S.y.v -= up * 0.4;
    S.pitch.v += up * 1.6 - dv.z * 0.15 * live;
    S.roll.v -= (dv.x * 0.4 + dp.x) * 2.6 * live;
    const y = clamp(S.y.step(0, 5.5, 0.2, dt), -0.03, 0.03);
    const pitch = clamp(S.pitch.step(0, 3.8, 0.18, dt), -0.4, 0.4);
    // (the strap holds it in against his hip: it swings out, not in)
    const roll = clamp(S.roll.step(-0.05 * this.w.jump, 3.2, 0.2, dt), -0.45, 0.12);
    b.bag.position.set(this.bagBind.x, this.bagBind.y + y, this.bagBind.z);
    b.bag.rotation.set(pitch, 0, roll);
    S.flap.v += this.flapKick;
    this.flapKick = 0;
    const flap = clamp(S.flap.step(0, 3.4, 0.3, dt), 0, 1.7);
    b.flap.quaternion.setFromAxisAngle(this.bagSide, -flap - 0.1 * Math.max(0, -pitch));
    b.bag.updateMatrix();
    b.bag.matrixWorld.multiplyMatrices(b.hips.matrixWorld, b.bag.matrix);
    b.flap.updateMatrix();
    b.flap.matrixWorld.multiplyMatrices(b.bag.matrixWorld, b.flap.matrix);
  }

  // His fluffy little tail: wagging in quick flicks side to side, in bursts
  // (and always a little while he runs), bobbing with every stride and
  // flicking up as he springs.
  tailStep(dt) {
    const S = this.tailS;
    const running = this.mode === 'run' && this.speed > 1;
    const amp = Math.min(1, this.wag) * 0.5 + (running ? 0.12 : 0.04);
    this.wagPh += dt * TAU * (running ? 8.5 : 7);
    const flick = Math.sin(this.wagPh) * (0.7 + 0.3 * Math.sin(this.wagPh * 0.5));
    S.side.v -= this.pelvisDP.x * 4;
    const side = S.side.step(flick * amp, 9, 0.35, dt);
    S.lift.v -= this.pelvisDP.y * 6 + this.pelvisD.y * 1.5;
    const lift = S.lift.step(0.2 * this.w.jump + 0.08 * (running ? 1 : 0), 4.5, 0.25, dt);
    this.b.tail.rotation.set(-clamp(lift, -0.6, 0.9), clamp(side, -0.7, 0.7), 0.3 * side);
  }

  // The ears are swung by the shared springs (hairSim: the headwind lays
  // them back, every footfall bounces them); on top of that the bent one
  // flops - bouncing at its fold, unfolding a little when he's excited -
  // and now and then one twitches.
  earStep(dt) {
    const b = this.b;
    const E = this.earS;
    const twR = E.twR.step(0, 5, 0.25, dt);
    const twL = E.twL.step(0, 5, 0.25, dt);
    const perk = clamp(E.perk.step(0, 2.2, 0.35, dt), -0.4, 1);
    E.flop.v -= this.pelvisDP.y * 5;
    const flop = clamp(E.flop.step(0.2 * this.w.jump, 3.4, 0.2, dt), -0.5, 0.6);
    // (rolling, they're swept flat back along him)
    const sweep = 1.35 * (this.rollAmt || 0);
    b.earR.rotation.z += 0.25 * twR - 0.1 * perk;
    b.earR.rotation.x += -0.25 * perk + sweep;
    b.earL.rotation.z -= 0.25 * twL;
    b.earL.rotation.x += sweep;
    b.earLtip.quaternion.multiply(_q.setFromAxisAngle(this.foldAxis, -0.5 * perk + 0.35 * flop - 0.25 * this.floatLift()));
    for (const k of ['earR', 'earRtip', 'earL', 'earLtip']) b[k].updateMatrixWorld(true);
  }

  // (hanging under the float, the air coming up past him lifts his ears)
  floatLift() {
    return this.floating && !this.floatFast ? smooth(0.2, 0.35, this.jumpT) * this.w.jump : 0;
  }

  // What he's floating on: pulled out of the satchel at his left hand,
  // grown or opened as he lifts it, held overhead while he drifts down, and
  // put away (or let go of, or blown away) when he lands.
  propStep(dt) {
    const P = this.prop;
    if (!P.kind) {
      this.props.hide();
      return;
    }
    P.t += dt;
    // (a balloon just let go of stays where it is until it's handed over)
    if (P.state === 'gone') return;
    let size, open;
    if (P.state === 'away') {
      const a = P.t - P.end;
      if (P.kind === 'umbrella') {
        open = 1 - smooth(0, 0.1, a);
        size = 1 - smooth(0.12, 0.3, a);
      } else {
        open = 1 - smooth(0, 0.22, a);
        size = 1 - smooth(0.2, 0.4, a);
      }
      if (size <= 0.001) {
        P.kind = null;
        P.state = 'none';
        this.props.hide();
        return;
      }
    } else {
      size = smooth(0.05, 0.14, P.t);
      open = smooth(P.kind === 'umbrella' ? 0.15 : 0.1, P.kind === 'umbrella' ? 0.24 : 0.28, P.t);
      if (P.t > 0.14) P.state = 'hold';
    }
    // the grip: in his left fist, the thing standing up out of it, mostly
    // upright and leaning back a little in the headwind
    const b = this.b;
    b.handL.updateMatrixWorld(true);
    const M = b.handL.matrixWorld;
    _Y.set(-M.elements[4], -M.elements[5], -M.elements[6]).normalize();
    const grip = _p.setFromMatrixPosition(M).addScaledVector(_Y, 0.045);
    const lean = 0.18 + 0.012 * this.speed;
    _v.set(0, 1, lean).normalize();
    _Y.lerp(_v, P.state === 'away' ? 0.3 : 0.7).normalize();
    _Z.set(0, 0, 1);
    _X.crossVectors(_Y, _Z).normalize();
    _Z.crossVectors(_X, _Y);
    this.gripM.makeBasis(_X, _Y, _Z).setPosition(grip);
    this.props.hold(P.kind, this.gripM, open, size);
    // a dandelion sheds a few seeds as he floats on it
    if (P.kind === 'dandelion' && P.state === 'hold' && !this.crashed) {
      P.seedT -= dt;
      if (P.seedT <= 0) {
        P.seedT = 0.045 + 0.05 * Math.random();
        this.seedBurst(1, 0.5);
      }
    }
  }

  // Seeds off the dandelion's clock: n of them, blown back off it (gentle:
  // a share of the puff's strength).
  seedBurst(n, gentle = 1) {
    if (this.wet) return;
    this.props.growPoint(_v3);
    const r = Math.random;
    const run = _dv.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
    for (let k = 0; k < n; k++) {
      _v2.set(r() - 0.5, r() - 0.3, r() - 0.5).normalize();
      _v.copy(_v3).addScaledVector(_v2, 0.15);
      _p.copy(_v2).multiplyScalar((0.8 + 1.4 * r()) * gentle);
      _p.y += 0.6 * r();
      _p.z += 1.5 + 2 * r();
      _p.addScaledVector(run, 0.3 + 0.15 * r());
      this.seeds.emit(_v, _p, 0.07 + 0.03 * r());
    }
  }

  // A puff of dust at his feet off a hard landing.
  landDust(hit) {
    const r = Math.random;
    const run = _dv.set(this.vx, 0, -this.speed);
    const n = hit > 1.2 ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1;
      _p.copy(run).multiplyScalar(0.3 + 0.1 * r());
      _p.x += side * (0.8 + 1.0 * r());
      _p.y += 0.4 + 0.5 * r();
      this.dust.emit(_v.set(side * 0.12, 0.04, -0.04), _p, 0.22 + 0.1 * r() * hit);
    }
  }

  // Dust off the dive roll: a puff as his shoulders meet the road, a few
  // more as he rolls over it, and one off his feet as he comes up.
  rollDust(dt) {
    const P = this.rollPlan;
    if (!P) return;
    if (!this.sliding || this.crashed || !this.grounded || this.wet) {
      this.rollPlan = null;
      return;
    }
    P.t += dt;
    const u = this.slideU ?? 0;
    const r = Math.random;
    const run = _dv.set(this.vx, 0, -this.speed);
    const puff = (x, z, size, up) => {
      _p.copy(run).multiplyScalar(0.3 + 0.12 * r());
      _p.x += (r() - 0.5) * 2.2;
      _p.y += up * (0.4 + 0.6 * r());
      this.dust.emit(_v.set(x, 0.05, z), _p, size);
    };
    if (!P.hit && u > 0.14) {
      P.hit = true;
      puff(-0.14, -0.05, 0.3, 1);
      puff(0.14, 0.0, 0.3, 1);
      puff(0, 0.1, 0.22, 0.6);
    }
    if (P.hit && u < 0.6) {
      P.next -= dt;
      if (P.next <= 0) {
        P.next = 0.06 + 0.05 * r();
        puff((r() - 0.5) * 0.3, 0.1, 0.18 + 0.08 * r(), 0.5);
      }
    }
    if (!P.up && u > 0.7) {
      P.up = true;
      puff(-0.1, 0.05, 0.24, 0.8);
      puff(0.1, 0.05, 0.24, 0.8);
    }
  }
}

// How the side flip turns: quick off the foot, quickest through the tuck at
// the top, slowing as he opens out to land.
const WEB_EASE = (() => {
  const n = 160;
  const a = new Float64Array(n + 1);
  const v = (u) => Math.pow(Math.sin(Math.PI * u), 0.9) * (1 + 0.45 * Math.exp(-(((u - 0.5) / 0.14) ** 2))) + 0.04;
  for (let i = 1; i <= n; i++) a[i] = a[i - 1] + (v((i - 1) / n) + v(i / n)) / 2;
  for (let i = 1; i <= n; i++) a[i] /= a[n];
  return (u) => {
    const x = clamp(u, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(x));
    return a[i] + (a[i + 1] - a[i]) * (x - i);
  };
})();
// The roll: over quickly once he's tucked, easing as he comes up.
const ROLL_EASE = (u) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x) * 0.4 + (1 - Math.pow(1 - x, 2.2)) * 0.6;
};
