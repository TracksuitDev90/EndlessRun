import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials, makeWhiskerMaterial } from '../render/shaders.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { palette } from './kit.js';
import { Player, C, mirror } from './player.js';
import { CONFIG } from '../config.js';
import { Dust } from './dust.js';
import { Ribbons } from './ribbon.js';

// The samurai: Birch, a tall, heavily muscled white tiger with a cheetah's
// long build, in a near-black training kimono, a reddish-brown obi and loose
// charcoal hakama, his forearms bound, barefoot on big clawed paws, a katana
// at his left hip (sculpted in tools/runner/samurai.py). Decades of practice
// in every move: he is very fast and very heavy, and nothing he does is
// wasted. On top of the shared runner (player.js):
//   - he sprints like a big cat runs down its prey: low and driving, his head
//     level and still however hard his body works under it, his right arm
//     pumping hard, his left hand on his scabbard (solved there: armTo),
//     holding the sword steady at his hip;
//   - and now and then he runs with it drawn (SWORD): an iai draw on the run -
//     the right hand snaps across to the hilt, the blade slides out along the
//     scabbard's curve and whips out into a cut - then he runs with it
//     trailing low behind him, edge up, his left arm pumping; and in a while
//     he flicks it clean and slides it home. He may draw it rising out of a
//     duck, too;
//   - every move is a water bender's - flowing, then brutally fast: a lane
//     change is a flash step (a low, wide lunge across, the leading arm
//     sweeping through in a whip of water - or, drawn, a cut); four jumps, a
//     whirl (a spin about himself, arms whipping out - drawn, a full circle
//     of the blade), a tucked front flip coming down in an overhead cut, a
//     flying lunge (front knee high, the back leg trailing long, one palm
//     pushing the water ahead of him - drawn, the sword raised in both hands
//     and brought down as he lands), and a butterfly twist, laid out flat and
//     spinning; his duck an iai crouch, low on one knee, his hand on the hilt;
//   - the water itself (ribbon.js): ribbons of it whipping off his hands and
//     the point of his blade, drops flung off them;
//   - his long tail and the obi's hanging ends swing on chains of particles
//     (ropeStep), the tail held in a hunting cat's curve, streaming out and
//     lashing as he dashes; his ears twitch; his whiskers.

// Palette slots: 1-16 are the garment ids baked into the mesh, the rest are
// colours the character shader draws his details with.
export const COL = {
  1: '#f3ead8', // face fur (warm ivory)
  2: '#cf918a', // nose (dusty rose)
  3: '#f3ead8', // ears
  4: '#2a2628', // kimono (near black)
  5: '#f3ead8', // fur: chest, forearms, lower legs
  6: '#3a383c', // hakama (charcoal)
  7: '#7f2b22', // obi (deep reddish brown), the scabbard's cord
  8: '#8c3326', // wraps
  9: '#f3ead8', // hands
  10: '#f3ead8', // paws
  11: '#f3ead8', // tail
  12: '#2c221f', // claws
  13: '#1c191b', // scabbard (black lacquer)
  14: '#c9a24a', // gold
  15: '#262021', // the hilt's braid
  16: '#c7ced6', // blade (steel)
  17: '#3a2b27', // stripes (charcoal brown)
  18: '#fdf9f1', // fur, light
  19: '#e0cfb2', // fur, shade (warm)
  20: '#4a4446', // kimono, light (collar band, stitching)
  21: '#18151a', // kimono, deep
  22: '#f6c95a', // iris, light
  23: '#c98314', // iris (amber gold)
  24: '#1a1210', // ink
  25: '#3e2a28', // mouth, nostrils
  26: '#e7c3b8', // inside the ears
  27: '#55180f', // obi, deep
  28: '#262529', // hakama, deep
  29: '#f4f7fa', // steel, light (the frosted edge)
  30: '#9c8582', // paw pads
  31: '#ece6d6', // ray skin under the hilt's braid
};

// How he runs: a big cat's sprint on two legs - long, driving strides, the
// heel kicked right up under his seat and the knee driven high, low over
// his hips with a deep lean; the arm (his right: the left is on the
// scabbard) pumping hard and tight.
const GAIT = {
  cadence: [1.46, 0.052],
  stride: { reach: 0.84, hipY: 0.925, bob: 0.05, trackX: 0.088, swingX: 0.13, toeOut: 0.07, heelLift: 0.92, ballZ: -0.05, maxDuty: 0.33, minContact: 0.04 },
  swing: [
    [0.16, 0.52, 0.4, 0.04, 0.035],
    [0.4, 0.24, 0.67, 0.0, 0.09],
    [0.65, -0.27, 0.57, -0.05, 0.035],
    [0.84, -0.45, 0.34, -0.03, 0.0],
  ],
  arm: {
    swing: [0.3, 0.9, 1.05, 0.62, -0.22, -0.8, -0.95, -0.58],
    abd: [0.24, 0.2, 0.2, 0.22, 0.28, 0.32, 0.33, 0.3],
    elbow: [1.45, 1.72, 1.82, 1.6, 1.3, 1.1, 1.05, 1.2],
    amp: [0.82, 0.3],
  },
  lean: [0.27, 0.2],
  hipYaw: 0.17,
  hipRoll: 0.05,
  spTwist: 0.2,
  chTwist: 0.2,
};

// How he handles: the quickest between the lanes of anyone (a flash step,
// leaning hard into it), quick to change from one move to the next; his jump
// has everyone's apex and airtime, but he's up it fast, hangs at the top and
// comes down hard (see solveArc); he lands heavy.
const FEEL = {
  laneSpring: 46,
  lean: [0.038, 0.42],
  turn: [0.022, 0.32],
  blend: [5.5, 8, 8.5],
  land: { freq: 4.4, zeta: 0.42, thud: 0.045 },
};

// The jump's arc: gravity eases off to HANG of itself while he's within
// APEX m/s of the top (G and V0 solved so the apex and airtime match the
// plain arc's).
const HANG = 0.3;
const APEX = 3.6;
function solveArc(H, T) {
  const a = APEX, k = a / HANG, h = (a * a) / HANG;
  const c1 = T / 2, c0 = a - k;
  const A = c1 * c1, Bq = 2 * c1 * c0 - 2 * H, Cq = c0 * c0 - a * a + h;
  const G = (-Bq + Math.sqrt(Bq * Bq - 4 * A * Cq)) / (2 * A);
  return { G, V0: G * c1 + c0 };
}

// His jumps, dealt from a shuffled deck so the same one never comes twice
// running.
const TRICKS = ['whirl', 'flip', 'leap', 'butterfly', 'whirl', 'leap', 'flip', 'butterfly'];

// The sword (s): how long a draw takes, how long it's kept out, how long it's
// kept in between, and how long sheathing it takes; how likely he is to draw
// rising out of a duck.
const SWORD = { draw: 0.4, sheathe: 0.62, out: [4.5, 4.0], in: [7, 6], fromDuck: 0.4, first: [3, 3] };
// (how far the blade slides out of the scabbard before its point is clear)
const SLIDE = 0.735;
// (running with it out, how far the blade's turned off the line of his
// thumb toward his knuckles: trailing behind, along the line of his arm)
const DEV_RUN = 2.0;

// Where his middle is (up from the road), to spin and tip about.
const MID = 1.0;

// Channel lists the moves pick between (made once, not every frame): the
// flying lunge's lead and trailing legs and its arms (leading with the left
// leg, or the right), both arms on the hilt, and a flash step's leading and
// trailing arms (to the right, or the left).
const LEAP_LEGS = [
  [C.thLx, C.knL, C.anL, C.thRx, C.knR, C.anR],
  [C.thRx, C.knR, C.anR, C.thLx, C.knL, C.anL],
];
const LEAP_ARMS = [
  [C.shRx, C.shRz, C.elR, C.wrR, C.shLx, C.shLz, C.elL],
  [C.shLx, C.shLz, C.elL, C.wrL, C.shRx, C.shRz, C.elR],
];
const BOTH_ARMS = [
  [C.shRx, C.shRz, C.elR],
  [C.shLx, C.shLz, C.elL],
];
const DASH_ARMS = [
  [C.shRx, C.shRy, C.shRz, C.elR, C.shLx, C.shLz],
  [C.shLx, C.shLy, C.shLz, C.elL, C.shRx, C.shRz],
];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _s = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

const mix = (a, b, k) => a + (b - a) * k;
const ease = (x) => x * x * (3 - 2 * x);
const bump = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));
// (a fast snap: most of the way there early, the rest eased in)
const snap = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return 1 - Math.pow(1 - t, 3);
};

// Rotate the body about a point pivot m up it (and fwd m along it).
function turnAbout(b, q, pivot, fwd = 0) {
  b.quaternion.premultiply(q);
  _p.set(0, pivot, fwd);
  _v.copy(_p).applyQuaternion(q);
  b.position.applyQuaternion(q).add(_p).sub(_v);
}

// A spin's progress (0..1 over u in [a, b]): quick off the mark, quickest
// in the middle, settling at the end.
function spinEase(u, a, b) {
  const t = clamp((u - a) / (b - a), 0, 1);
  return t < 0.5 ? 0.5 * Math.pow(2 * t, 1.6) : 1 - 0.5 * Math.pow(2 - 2 * t, 1.6);
}

export class Samurai extends Player {
  constructor(envDef, asset) {
    super(envDef, asset, { gait: GAIT, feel: FEEL });
    // (his sword and his tail reach well out round him; his blade goes up
    // high over his head)
    this.castR = 1.3;
    this.castTop = 2.6;
  }

  configure() {
    super.configure();
    const J = this.feel.jump;
    const arc = solveArc(J.height, J.time);
    this.G = arc.G;
    this.V0 = arc.V0;
    this.GH = arc.G * HANG;
    // the arc's times: up to where it eases off, the hang, the whole of it
    this.T1 = (this.V0 - APEX) / this.G;
    this.TH = (2 * APEX) / this.GH;
    this.TT = 2 * this.T1 + this.TH;
  }

  fall(dt) {
    let left = dt;
    for (let i = 0; i < 4 && left > 0; i++) {
      const vy = this.vy;
      let g, tb;
      if (vy > APEX) (g = this.G), (tb = (vy - APEX) / g);
      else if (vy > -APEX) (g = this.GH), (tb = (vy + APEX) / g);
      else (g = this.G), (tb = Infinity);
      const h = Math.min(left, tb + 1e-6);
      this.y += vy * h - 0.5 * g * h * h;
      this.vy -= g * h;
      left -= h;
    }
  }

  // How far through the jump he is (0 take-off .. 1 landing), from the arc's
  // speed: a fast-fall hurries it round.
  jumpU() {
    const vy = this.vyPose;
    let t;
    if (vy > APEX) t = (this.V0 - vy) / this.G;
    else if (vy > -APEX) t = this.T1 + (APEX - vy) / this.GH;
    else t = this.T1 + this.TH + (-APEX - vy) / this.G;
    return clamp(t / this.TT, 0, 1);
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    const R = this.rig;
    const rig = [new THREE.Vector4(R.shoulder[0], R.shoulder[1], R.armRest, R.footX)];
    const mats = makeCharacterMaterials(this.u, palette(COL), rig, 0.0074, null, { style: 'samurai' });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.buildBody();
    this.buildWhiskers();
    this.dust = new Dust(this.u);
    this.ribbons = new Ribbons(this.u);
    this.buildSword();
  }

  // Long pale whiskers, four either side, sweeping out and back from his
  // whisker pads and drooping toward their tips: ribbons on the head bone.
  buildWhiskers() {
    const head = this.bindPos.head;
    const pos = [], aw = [], idx = [];
    const n = 10;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const root = new THREE.Vector3(s * (0.052 + 0.004 * k), 1.756 - k * 0.0065, -0.142 + k * 0.006);
        const e = 0.16 - 0.1 * k;
        const dir = new THREE.Vector3(s * Math.cos(e), Math.sin(e), 0.42 + 0.06 * k).normalize();
        const L = 0.15 - 0.012 * Math.abs(k - 1.5);
        const base = pos.length / 3;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const p = root.clone().addScaledVector(dir, L * t);
          p.y -= 0.03 * t * t;
          const tan = dir.clone().multiplyScalar(L).add(new THREE.Vector3(0, -0.06 * t, 0)).normalize();
          const hw = 0.0012 * (1 - 0.7 * t);
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
    this.whiskers = new THREE.Mesh(geo, makeWhiskerMaterial(this.u, '#ebe5da'));
    this.whiskers.frustumCulled = false;
    this.whiskers.renderOrder = -18;
    this.whiskers.userData.noCast = true;
    this.b.head.add(this.whiskers);
  }

  // The frames the sword is posed by (bind space): in the scabbard, in his
  // right fist (the blade out of the thumb side, the edge toward the
  // knuckles), and where each fist holds a handle - the left on the
  // scabbard by its mouth, or on the hilt below the right.
  buildSword() {
    const R = this.rig;
    const bindOf = (n) => new THREE.Matrix4().copy(this.boneInv[n]).invert();
    this.sayaBind = bindOf('saya');
    this.swordBind = bindOf('sword');
    this.handBind = { L: bindOf('handL'), R: bindOf('handR') };
    // the sheathed sword, from the scabbard's frame
    this.relSheath = new THREE.Matrix4().copy(this.sayaBind).invert().multiply(this.swordBind);
    // a handle in each fist (bind space): +y toward the thumb, +z the
    // knuckles' way (down the hanging arm)
    const ar = R.armRest;
    const held = (L) => {
      const sx = L === 'L' ? -1 : 1;
      const y = new THREE.Vector3(0, 0, -1);
      const z = new THREE.Vector3(sx * Math.sin(ar), -Math.cos(ar), 0);
      const x = new THREE.Vector3().crossVectors(y, z);
      const M = new THREE.Matrix4().makeBasis(x, y, z).setPosition(...R.grip[L]);
      // (hand bind -> that frame)
      return new THREE.Matrix4().copy(this.handBind[L]).invert().multiply(M);
    };
    this.relHeld = { L: held('L'), R: held('R') };
    this.relHeldInv = { L: this.relHeld.L.clone().invert(), R: this.relHeld.R.clone().invert() };
    // the left fist round the scabbard by its mouth (scabbard space): the
    // thumb up toward the guard, the knuckles down
    this.sayaGrip = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1)).setPosition(0, 0.13, 0);
    // the blade's curve as an arc it slides along (scabbard space: about x
    // through a point under the mouth)
    const K = R.katana;
    const Lb = K.tip - 0.05;
    this.ARC_R = (Lb * Lb) / (2 * 0.022);
    this.swordF = new THREE.Matrix4();
    this.sheathF = new THREE.Matrix4();
    this.heldF = new THREE.Matrix4();
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points, this.ribbons.mesh];
  }

  forCompile(on) {
    this.dust.forCompile(on);
    this.ribbons.forCompile(on);
  }

  // --- state ------------------------------------------------------------------------
  buildSim() {
    super.buildSim();
    this.earS = { L: new Spring(), R: new Spring() };
    this.ropes = [];
    // the tail: a chain of particles down it, held toward a hunting cat's
    // curve (stiffer toward its root), and the obi's two hanging ends, loose
    const R = this.rig;
    this.ropes.push(this.makeRope(R.tail.bones, R.tail.pts, 'tail'));
    for (const o of R.obi) this.ropes.push(this.makeRope(o.bones, o.pts, 'obi'));
    // (and the kimono's skirt, over the top of the hakama)
    const cols = R.colliders.concat([{ kind: 'ell', bone: 'hips', c: [0, 1.08, 0.004], r: [0.25, 0.17, 0.21] }]);
    this.ropeCols = cols.map((c) => ({ ...c, a: c.a && new THREE.Vector3(...c.a), b: c.b && new THREE.Vector3(...c.b), c: c.c && new THREE.Vector3(...c.c), r: c.r && new THREE.Vector3(...c.r) }));
    this.cols = this.ropeCols.map((c) => ({ kind: c.kind, c: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), ax: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], r: [0, 0, 0], ra: c.ra || 0, rb: c.rb || 0 }));
    this.ropeH = 1 / 120;
    this.tailWave = 0;
    this.lash = new Spring();
  }

  makeRope(names, pts, kind) {
    const rest = pts.map((p) => new THREE.Vector3(...p));
    const n = rest.length;
    const len = [];
    const dir0 = [];
    for (let k = 0; k < n - 1; k++) {
      len.push(rest[k].distanceTo(rest[k + 1]));
      dir0.push(rest[k + 1].clone().sub(rest[k]).normalize());
    }
    return {
      kind,
      n,
      rest,
      len,
      dir0,
      bones: names.map((nm) => this.b[nm]),
      parent: this.b[names[0]].parent,
      p: rest.map(() => new THREE.Vector3()),
      q: rest.map(() => new THREE.Vector3()),
      tgt: rest.map(() => new THREE.Vector3()),
      ready: false,
    };
  }

  resetSim() {
    super.resetSim();
    this.deck = this.deck || [];
    this.trick = this.trick || 'whirl';
    this.lastDt = 0;
    this.dodgeT = 9;
    this.dodgeDir = 1;
    this.greetT = 9;
    this.tilt = 0;
    this.yawSpin = 0;
    this.rollSpin = 0;
    this.pitchSpin = 0;
    this.landStyle = 0;
    this.twitchT = 1 + 3 * Math.random();
    this.stepDust = 0;
    // the sword: in its scabbard ('in'), drawing, out, sheathing
    this.sword = { state: 'in', t: 0, next: SWORD.first[0] + SWORD.first[1] * Math.random(), drawnK: 0, slide: 0, hold: 0, rib: null };
    if (this.earS) for (const s of Object.values(this.earS)) s.reset();
    if (this.lash) this.lash.reset();
    for (const r of this.ropes || []) r.ready = false;
    this.ribbons?.clear();
    this.dust?.clear();
    this.slidePlan = null;
  }

  update(dt, speed, groundAt) {
    this.lastDt = dt;
    this.swordStep(dt);
    this.dodgeT += dt;
    this.greetT += dt;
    super.update(dt, speed, groundAt);
    // rising out of a duck, now and then, he draws
    const P = this.slidePlan;
    if (P && !P.decided && this.sliding && (this.slideU ?? 0) > 0.6) {
      P.decided = true;
      if (this.sword.state === 'in' && !this.crashed && Math.random() < SWORD.fromDuck) this.draw();
    }
    // now and then an ear flicks
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      const S = Math.random() < 0.5 ? this.earS.L : this.earS.R;
      S.v += (this.mode === 'run' ? 5 : 8) * (Math.random() < 0.5 ? -1 : 1);
      this.twitchT = this.mode === 'run' ? 2.5 + 4 * Math.random() : 1.2 + 2.5 * Math.random();
    }
  }

  place(z, dist = 0) {
    super.place(z);
    const vel = _dv.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
    this.dust.update(this.lastDt, this.root, z, dist);
    this.ribbons.update(this.lastDt, this.root, z, dist, vel);
    this.lastDt = 0;
  }

  // --- the sword ----------------------------------------------------------------------
  // In or out, and in between: he draws it now and then as he runs (and may
  // rising out of a duck), keeps it out a while, then sheathes it - only with
  // his feet on the road and nothing else going on, so a draw or a sheathe
  // is never cut short by a jump (a jump or a duck that comes while he's at
  // it takes the sword as it is: drawn, it's out; sheathing, it goes home).
  swordStep(dt) {
    const S = this.sword;
    const running = this.mode === 'run' && !this.crashed;
    const free = running && this.grounded && !this.sliding && this.w.run > 0.85 && this.speed > 4 && this.dodgeT > 0.3;
    S.t += dt;
    if (S.state === 'in') {
      if (running) S.next -= dt;
      if (free && S.next <= 0) this.draw();
    } else if (S.state === 'drawing') {
      if (S.t >= SWORD.draw) {
        S.state = 'out';
        S.t = 0;
        S.next = SWORD.out[0] + SWORD.out[1] * Math.random();
      }
    } else if (S.state === 'out') {
      if (running) S.next -= dt;
      if (free && S.next <= 0) this.sheathe();
    } else if (S.state === 'sheathing') {
      if (S.t >= SWORD.sheathe) {
        S.state = 'in';
        S.t = 0;
        S.next = SWORD.in[0] + SWORD.in[1] * Math.random();
      }
    }
    // how far it's out (drawn: the trailing carry, his left arm free)
    const out = S.state === 'out' ? 1 : S.state === 'drawing' ? smooth(0.55, 1, S.t / SWORD.draw) : S.state === 'sheathing' ? 1 - smooth(0.0, 0.5, S.t / SWORD.sheathe) : 0;
    S.drawnK = out;
  }

  draw() {
    const S = this.sword;
    S.state = 'drawing';
    S.t = 0;
    // (the point of the blade whips out in a ribbon of water)
    S.rib = this.ribbons.start((o) => this.tipOf(o), SWORD.draw * 1.2, 0.11, 0.3, 0.93);
  }

  sheathe() {
    const S = this.sword;
    S.state = 'sheathing';
    S.t = 0;
    this.ribbons.start((o) => (this.sword.t < SWORD.sheathe * 0.32 ? this.tipOf(o) : false), SWORD.sheathe * 0.32, 0.08, 0.24, 0.93);
  }

  // Keep the sword drawn ('out') or sheathed ('in') from now on (the viewer:
  // &sword=).
  holdSword(state) {
    const S = this.sword;
    S.state = state === 'out' ? 'out' : 'in';
    S.t = 0;
    S.next = Infinity;
    S.drawnK = S.state === 'out' ? 1 : 0;
  }

  // Where the point of the blade is (runner space), if it's out to see.
  tipOf(out) {
    const S = this.sword;
    if (S.state === 'in') return false;
    // (not while the point's still in the scabbard)
    if ((S.state === 'drawing' || S.state === 'sheathing' || S.state === 'greet') && S.slide > 0.02 && S.slide < SLIDE - 0.02) return false;
    // (the sword's frame is in his own space already)
    out.set(0, this.rig.katana.tip, 0).applyMatrix4(this.swordF);
    return true;
  }

  // Where a point on a bone is (runner space), for a ribbon to flow from.
  pointOn(bone, x, y, z) {
    // (between update and place, the bones' matrices are still in his own
    // space: see secondary)
    return (out) => {
      out.set(x, y, z).applyMatrix4(this.b[bone].matrixWorld);
      return true;
    };
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
    this.jumpSide = this.nextSide || (Math.random() < 0.5 ? -1 : 1);
    this.nextSide = 0;
    this.lash.v += 6;
    this.jumpRibbons();
  }

  // The water off him through a jump: off his hands (or the point of his
  // blade, out) as he whirls, flips, leaps or twists.
  jumpRibbons() {
    const T = CONFIG.jump.time;
    const drawn = this.sword.state === 'out' || this.sword.state === 'drawing';
    const tip = (o) => this.tipOf(o);
    const handL = this.pointOn('handL', 0, -0.08, 0);
    const handR = this.pointOn('handR', 0, -0.08, 0);
    const tr = this.trick;
    if (drawn) {
      this.ribbons.start(tip, T * 0.85, 0.12, 0.34, 0.95);
      if (tr === 'leap' || tr === 'flip') this.ribbons.start(handL, T * 0.6, 0.06, 0.24, 0.8);
    } else {
      const w = tr === 'leap' ? 0.1 : 0.085;
      this.ribbons.start(handR, T * 0.85, w, 0.32, 0.9);
      this.ribbons.start(handL, T * 0.85, w * 0.85, 0.3, 0.9);
    }
  }

  onLand(hit) {
    this.landStyle = this.trick === 'leap' || this.trick === 'flip' ? 1 : 0;
    this.lash.v -= 4 * hit;
    if (this.crashed || this.mode !== 'run') return;
    if (hit > 0.7 && !this.wet) this.landDust(hit);
  }

  onFastFall() {
    this.lash.v += 5;
  }

  startSlide() {
    const fresh = this.slideT <= 0;
    super.startSlide();
    if (!fresh) return;
    this.slidePlan = { decided: false };
    const drawn = this.sword.state === 'out';
    // (a low cut forward as he goes down, drawn; else his palm skims the
    // road, a ribbon of water off it)
    if (drawn) this.ribbons.start((o) => this.tipOf(o), CONFIG.slide.time * 0.55, 0.1, 0.3, 0.9);
    else this.ribbons.start(this.pointOn('handR', 0, -0.08, 0), CONFIG.slide.time * 0.4, 0.07, 0.26, 0.75);
  }

  onDodge(dir) {
    this.dodgeT = 0;
    this.dodgeDir = dir;
    this.lash.v += 3;
    // the flash step's water: a whip off the leading hand - or, drawn, the
    // blade cutting across
    if (this.mode !== 'run' || this.crashed) return;
    if (this.sword.state === 'out') this.ribbons.start((o) => this.tipOf(o), 0.2, 0.11, 0.28, 0.9);
    else this.ribbons.start(this.pointOn(dir > 0 ? 'handR' : 'handL', 0, -0.08, 0), 0.22, 0.085, 0.26, 0.8);
    if (this.grounded && !this.wet) this.dashDust(dir);
  }

  crash() {
    super.crash();
    this.ribbons.release();
  }

  revive() {
    super.revive();
    // (the sword's back in its scabbard)
    const S = this.sword;
    S.state = 'in';
    S.t = 0;
    S.drawnK = 0;
    S.next = SWORD.in[0] + SWORD.in[1] * Math.random();
  }

  // Picked on the title screen: an iai flash - he draws, the blade whips
  // out in a cut, a flick, and it slides home again with a click.
  greet() {
    this.greetT = 0;
    const S = this.sword;
    S.state = 'greet';
    S.t = 0;
    this.ribbons.start((o) => (this.greetT < 0.7 ? this.tipOf(o) : false), 0.7, 0.11, 0.34, 0);
  }

  // --- poses --------------------------------------------------------------------------
  // His run: the head held level and still (a predator's) whatever the body
  // does under it, the shoulders driving; drawn, his right arm trails the
  // sword low behind him and his left takes over the pumping.
  poseRun(r, f, sp) {
    super.poseRun(r, f, sp);
    // the head steadied against the stride
    r[C.hdYaw] *= 0.35;
    r[C.hdRoll] *= 0.4;
    r[C.hdPitch] -= 0.06;
    r[C.chLean] += 0.06;
    // (fists: the wrists straight and strong)
    r[C.wrL] = 0.05;
    r[C.wrR] = 0.05;
    // drawn: the right arm trailing the blade, the left pumping a little
    // wider for balance
    const k = this.sword.drawnK;
    if (k > 0) {
      const bounce = Math.sin(f) * 0.06;
      r[C.shRx] = mix(r[C.shRx], -0.95 + bounce, k);
      r[C.shRz] = mix(r[C.shRz], 0.4, k);
      r[C.shRy] = mix(r[C.shRy], 0.25, k);
      r[C.elR] = mix(r[C.elR], 0.15, k);
      r[C.wrR] = mix(r[C.wrR], 0.2, k);
      r[C.clRy] = mix(r[C.clRy], -0.12, k);
      r[C.chTwist] += 0.06 * k;
    }
    // (with the fox riding on his shoulder, the arm under her stays down -
    // unless it's trailing the sword, low behind him anyway)
    if (this.rider) {
      const left = this.rider < 0;
      const free = left || k < 0.5;
      if (free) {
        r[left ? C.shLz : C.shRz] = Math.min(r[left ? C.shLz : C.shRz], 0.3);
        r[left ? C.shLx : C.shRx] = Math.min(r[left ? C.shLx : C.shRx], 0.25);
      }
    }
  }

  // Standing: tall and still, his weight even on both feet set apart, his
  // left hand on the scabbard by its mouth (solved there, in afterPose), his
  // right arm hanging easy; breathing slow; his head turning slowly, his
  // eyes on you most of the time.
  poseIdle(id, t) {
    const ws = super.poseIdle(id, t);
    const br = Math.sin(t * 1.3);
    // (planted squarer, less drifting from foot to foot)
    id[C.hipX] *= 0.4;
    id[C.hipRoll] *= 0.4;
    id[C.spSide] *= 0.4;
    id[C.spLean] = 0.02 + 0.01 * br;
    id[C.chLean] = -0.01 - 0.012 * br;
    // (chin a little down: he looks at you from under his brow)
    id[C.hdPitch] = -0.1 + 0.02 * Math.sin(t * 0.5);
    id[C.hdYaw] = 0.22 * Math.sin(t * 0.31) * Math.abs(Math.sin(t * 0.17));
    id[C.shRx] = 0.02 + 0.015 * br;
    id[C.shRz] = 0.22;
    id[C.elR] = 0.2;
    id[C.wrR] = 0.05;
    return ws;
  }

  poseJump(j) {
    this.tilt = 0;
    this.yawSpin = 0;
    this.rollSpin = 0;
    this.pitchSpin = 0;
    const u = this.jumpU();
    const drawn = this.sword.state === 'out' || this.sword.state === 'drawing';
    j.fill(0);
    j[C.hipY] = this.HIP_Y;
    j[C.sq] = 1;
    if (this.trick === 'whirl') this.poseWhirl(j, u, drawn);
    else if (this.trick === 'flip') this.poseFlip(j, u, drawn);
    else if (this.trick === 'butterfly') this.poseButterfly(j, u, drawn);
    else this.poseLeap(j, u, drawn);
    // (the other way round, sometimes - but the sword's always in his right
    // hand)
    if (this.jumpSide < 0 && this.trick !== 'leap' && !drawn) mirror(j);
    // (the spins turn the way he's dealt)
    this.yawSpin *= this.trick === 'whirl' ? this.jumpSide : 1;
    this.rollSpin *= this.jumpSide;
  }

  // Off the road: a crouch exploding up - the legs driving straight, the
  // arms flung up (k: how much of it there still is).
  takeoff(j, u) {
    const k = 1 - smooth(0.0, 0.14, u);
    j[C.thLx] += 0.5 * k;
    j[C.thRx] += 0.1 * k;
    j[C.knL] += 0.5 * k;
    j[C.knR] += 0.2 * k;
    j[C.spLean] += 0.25 * k;
    return k;
  }

  // The whirl: up off both feet and round about himself, once - tucked tight
  // as he winds into it (his knees up, his arms wrapped across his chest),
  // then flung open at the quickest of it, the arms whipping out flat like
  // ropes of water; open, reaching for the road, to land. Drawn: his right
  // arm straight out holding the blade flat - a full circle of steel.
  poseWhirl(j, u, drawn) {
    this.takeoff(j, u);
    const tuck = bump(0.06, 0.24, 0.62, 0.84, u);
    const open = bump(0.3, 0.45, 0.68, 0.86, u);
    const land = smooth(0.74, 1.0, u);
    j[C.spLean] += 0.12 * tuck - 0.05 * open + 0.15 * land;
    j[C.spSide] = 0.12 * open;
    j[C.hdPitch] = 0.12 + 0.1 * tuck;
    j[C.thLx] += 1.45 * tuck + 0.55 * land;
    j[C.knL] += 2.0 * tuck + 0.7 * land;
    j[C.thRx] += 0.55 * tuck + 0.4 * land;
    j[C.knR] += 1.6 * tuck + 0.6 * land;
    j[C.anL] = -0.5 * tuck;
    j[C.anR] = -0.5 * tuck;
    j[C.thLz] = 0.1;
    j[C.thRz] = 0.18 * tuck + 0.1;
    // arms: wrapped in, then flung out
    const wrap = tuck * (1 - open);
    j[C.shLx] = 1.15 * wrap + 0.25 * open + 0.5 * land;
    j[C.shLy] = -0.9 * wrap;
    j[C.shLz] = 0.15 * wrap + 1.45 * open + 0.6 * land;
    j[C.elL] = 2.0 * wrap + 0.12 * open + 0.4 * land;
    j[C.shRx] = 1.1 * wrap + 0.25 * open + 0.5 * land;
    j[C.shRy] = -0.9 * wrap;
    j[C.shRz] = 0.15 * wrap + 1.45 * open + 0.6 * land;
    j[C.elR] = 2.0 * wrap + 0.12 * open + 0.4 * land;
    if (drawn) {
      // the blade held out flat at arm's length all the way round
      const out = smooth(0.08, 0.26, u) * (1 - smooth(0.8, 1.0, u));
      j[C.shRx] = mix(j[C.shRx], 0.3, out);
      j[C.shRy] = mix(j[C.shRy], 0.2, out);
      j[C.shRz] = mix(j[C.shRz], 1.45, out);
      j[C.elR] = mix(j[C.elR], 0.06, out);
    }
    this.yawSpin = TAU * spinEase(u, 0.08, 0.8);
    this.devJump = drawn ? 1.5 : 0;
  }

  // The flip: a front somersault, tucked tight and fast - knees to his
  // chest, arms round his shins - opening out at the bottom, legs reaching
  // for the road, his arms sweeping round and down like a wave breaking.
  // Drawn: the sword held in close through the turn, then up over his head
  // and brought down in a cut as he lands.
  poseFlip(j, u, drawn) {
    this.takeoff(j, u);
    const tuck = bump(0.08, 0.24, 0.62, 0.8, u);
    const land = smooth(0.72, 1.0, u);
    j[C.spLean] += 0.75 * tuck + 0.2 * land;
    j[C.chLean] = 0.3 * tuck;
    j[C.hdPitch] = 0.45 * tuck + 0.1;
    j[C.thLx] += 2.2 * tuck + 0.6 * land;
    j[C.thRx] += 2.15 * tuck + 0.4 * land;
    j[C.knL] += 2.35 * tuck + 0.6 * land;
    j[C.knR] += 2.3 * tuck + 0.5 * land;
    j[C.anL] = -0.4 * tuck;
    j[C.anR] = -0.4 * tuck;
    j[C.thLz] = 0.12;
    j[C.thRz] = 0.12;
    // arms: up as he springs, round the shins in the tuck, sweeping round
    // and down as he opens
    const up = bump(0.0, 0.08, 0.12, 0.22, u);
    j[C.shLx] = 2.6 * up + 1.0 * tuck + 0.9 * land;
    j[C.shRx] = 2.6 * up + 1.0 * tuck + 0.9 * land;
    j[C.shLz] = 0.25 + 0.5 * land;
    j[C.shRz] = 0.25 + 0.5 * land;
    j[C.elL] = 0.3 * up + 1.5 * tuck + 0.3 * land;
    j[C.elR] = 0.3 * up + 1.5 * tuck + 0.3 * land;
    if (drawn) {
      // over his head as he opens, and cut down to land
      const raise = bump(0.55, 0.7, 0.8, 0.94, u);
      const cut = smooth(0.8, 0.94, u);
      j[C.shRx] = mix(j[C.shRx], 2.9, raise);
      j[C.shRx] = mix(j[C.shRx], 0.9, cut);
      j[C.shRz] = mix(j[C.shRz], 0.2, raise + cut);
      j[C.elR] = mix(j[C.elR], 0.5, raise);
      j[C.elR] = mix(j[C.elR], 0.15, cut);
      this.devJump = 0.25 * raise;
    } else this.devJump = 0;
    this.pitchSpin = -TAU * spinEase(u, 0.1, 0.78);
  }

  // The flying lunge: a huge stride through the air - his front knee driven
  // up high, the back leg trailing long and straight - one palm pushing out
  // ahead of him, the other arm flowing out behind, as if he rides the water
  // he's thrown; coming down into a deep lunge. Drawn: the sword up over his
  // head in both hands, cut down as he lands.
  poseLeap(j, u, drawn) {
    this.takeoff(j, u);
    const fly = bump(0.06, 0.22, 0.7, 0.88, u);
    const land = smooth(0.72, 1.0, u);
    const L = this.jumpSide > 0;
    // lead leg (knee up) and trailing leg
    const [thA, knA, anA, thB, knB, anB] = L ? LEAP_LEGS[0] : LEAP_LEGS[1];
    j[thA] += 1.55 * fly + 0.9 * land;
    j[knA] += 1.5 * fly + 0.8 * land;
    j[anA] = -0.3 * fly;
    j[thB] += -0.75 * fly + 0.15 * land;
    j[knB] += 0.25 * fly + 0.9 * land;
    j[anB] = -0.6 * fly;
    j[C.thLz] = 0.08;
    j[C.thRz] = 0.08;
    j[C.spLean] += 0.12 * fly + 0.25 * land;
    j[C.hipPitch] = -0.05 * fly;
    j[C.hdPitch] = 0.18;
    // arms: one palm out ahead, the other flowing behind
    const [shF, szF, elF, wrF, shB, szB, elB] = L ? LEAP_ARMS[0] : LEAP_ARMS[1];
    j[shF] = 1.55 * fly + 0.6 * land;
    j[szF] = 0.15 + 0.3 * land;
    j[elF] = 0.1 * fly + 0.5 * land;
    j[wrF] = -0.7 * fly;
    j[shB] = -0.85 * fly + 0.2 * land;
    j[szB] = 0.45 * fly + 0.5 * land;
    j[elB] = 0.15 * fly + 0.4 * land;
    j[C.chTwist] = (L ? -0.18 : 0.18) * fly;
    if (drawn) {
      // both hands up on the hilt over his head (the left solved onto it),
      // then the cut
      const raise = smooth(0.04, 0.2, u) * (1 - smooth(0.8, 0.92, u));
      const cut = smooth(0.8, 0.95, u);
      for (const [sh, sz, el] of BOTH_ARMS) {
        j[sh] = mix(mix(j[sh], 2.75, raise), 1.0, cut);
        j[sz] = mix(j[sz], 0.12, raise + cut);
        j[el] = mix(mix(j[el], 0.55, raise), 0.2, cut);
      }
      this.devJump = 0.6 * raise;
      this.twoHands = raise + cut * (1 - smooth(0.95, 1.0, u));
    } else this.devJump = 0;
    this.tilt = -0.22 * fly;
  }

  // The butterfly twist: thrown out flat, face down, and spun once round
  // about the line he's travelling along, his legs scissored wide and his
  // arms flung out - a propeller - then right side up to land. Drawn: the
  // blade held out at arm's length, a circle of it standing across the road.
  poseButterfly(j, u, drawn) {
    this.takeoff(j, u);
    const flat = bump(0.08, 0.24, 0.7, 0.88, u);
    const land = smooth(0.74, 1.0, u);
    j[C.thLx] += 0.35 * flat + 0.5 * land;
    j[C.thRx] += -0.6 * flat + 0.35 * land;
    j[C.knL] += 0.15 * flat + 0.6 * land;
    j[C.knR] += 0.2 * flat + 0.5 * land;
    j[C.thLz] = 0.5 * flat + 0.1;
    j[C.thRz] = 0.55 * flat + 0.1;
    j[C.anL] = -0.5 * flat;
    j[C.anR] = -0.5 * flat;
    j[C.hdPitch] = 0.6 * flat + 0.1;
    j[C.shLx] = 0.2 * flat + 0.5 * land;
    j[C.shRx] = 0.2 * flat + 0.5 * land;
    j[C.shLz] = 1.4 * flat + 0.5 * land;
    j[C.shRz] = 1.4 * flat + 0.5 * land;
    j[C.elL] = 0.1 + 0.3 * land;
    j[C.elR] = 0.1 + 0.3 * land;
    j[C.spLean] += 0.2 * land;
    this.devJump = drawn ? 1.5 * flat : 0;
    this.tilt = -1.35 * flat;
    this.rollSpin = TAU * spinEase(u, 0.16, 0.78);
  }

  // The duck: an iai crouch - down low on his back knee, his front knee
  // deep and forward, folded over it, his chin up, his right hand on the
  // hilt and his left on the scabbard (sheathed: solved onto them), and up
  // out of it at the end - drawing as he rises, sometimes. Drawn: a low cut
  // forward as he goes down, the blade held low and level after it.
  poseSlide(s, t) {
    if (this.slideT > 0) this.slideU = 1 - clamp(this.slideT / CONFIG.slide.time, 0, 1);
    const u = this.slideU ?? 1;
    const k = snap(0.0, 0.14, u) * (1 - smooth(0.74, 0.98, u));
    s.fill(0);
    s[C.sq] = 1;
    s[C.hipY] = mix(this.HIP_Y - 0.08, 0.5, k);
    s[C.hipPitch] = 0.2 * k;
    s[C.hipYaw] = -0.12 * k;
    s[C.spLean] = 0.62 * k + 0.08;
    s[C.chLean] = 0.12 * k;
    s[C.spTwist] = 0.1 * k;
    // (his chin up, his eyes on what's ahead)
    s[C.hdPitch] = 0.62 * k;
    // his feet: the front (left) planted well forward, the back (right) up
    // on its toes behind, its knee all but on the road
    const A = this.ANKLE_H;
    this.plantFoot(s, 0, mix(-0.1, -0.13, k), A, mix(-0.12, -0.5, k), 0);
    this.plantFoot(s, 1, mix(0.1, 0.13, k), mix(A, 0.16, k), mix(0.05, 0.5, k), -1.1 * k);
    s[C.toR] = 1.0 * k;
    // the arms: at the sword (sheathed: solved onto the hilt and scabbard)
    s[C.shLx] = 0.35;
    s[C.shLz] = 0.3;
    s[C.elL] = 0.8;
    s[C.shRx] = 0.9;
    s[C.shRy] = -0.5;
    s[C.shRz] = 0.2;
    s[C.elR] = 1.4;
    if (this.sword.state === 'out') {
      // a low cut forward at the start, then the blade level and low
      const cut = snap(0.04, 0.2, u);
      s[C.shRx] = mix(-0.4, 1.25, cut);
      s[C.shRy] = mix(0.0, -0.35, cut);
      s[C.shRz] = mix(0.5, 0.35, cut);
      s[C.elR] = 0.12;
      s[C.shLx] = 0.4;
      s[C.shLz] = 0.7;
      s[C.elL] = 0.5;
    }
  }

  // He lands heavy: deep into his knees and back up - after the flip or the
  // leap, deeper still, one hand down to the road.
  landOverlay(Pz, land) {
    const d = Math.max(0, land), p = Math.max(0, -land);
    const deep = 1 + 0.6 * this.landStyle;
    Pz[C.hipY] += (-0.13 * d + 0.03 * p) * deep;
    Pz[C.knL] += 0.75 * d * deep;
    Pz[C.knR] += 0.65 * d * deep;
    Pz[C.thLx] += 0.45 * d * deep;
    Pz[C.thRx] += 0.35 * d * deep;
    Pz[C.anL] += 0.3 * d;
    Pz[C.anR] += 0.3 * d;
    Pz[C.spLean] += 0.32 * d * deep;
    Pz[C.hdPitch] -= 0.2 * d;
    Pz[C.shLz] += 0.5 * d;
    Pz[C.shRz] += 0.5 * d;
    Pz[C.shLx] += 0.35 * d * this.landStyle;
    Pz[C.elL] -= 0.3 * d;
    Pz[C.sq] += -0.05 * d + 0.03 * p;
  }

  // A lane change: a flash step - down into a low, wide lunge across, the
  // leg behind stretched out long, leaning hard into it; the leading arm
  // sweeps through flat across in front of him like a whip of water and the
  // other's flung back (drawn: the blade cuts across instead).
  laneOverlay(Pz, lc, dt) {
    super.laneOverlay(Pz, lc, dt);
    const T = 0.34;
    const x = this.dodgeT / T;
    const e = x < 1 ? snap(0, 0.18, x) * (1 - smooth(0.45, 1, x)) : 0;
    const w = this.w.run * (1 - (this.crashW || 0));
    const d = this.dodgeDir;
    Pz[C.hipY] -= 0.16 * e * w;
    Pz[C.spSide] -= 0.1 * lc;
    Pz[C.chSide] -= 0.05 * lc;
    Pz[C.spLean] += 0.22 * e * w;
    Pz[C.hdRoll] += 0.3 * lc;
    // the leg behind (the side he's moving away from) stretched out long
    Pz[d > 0 ? C.thLz : C.thRz] += 0.42 * e * w;
    Pz[d > 0 ? C.knL : C.knR] -= 0.4 * e * w;
    Pz[d > 0 ? C.knR : C.knL] += 0.35 * e * w;
    // the leading arm sweeps across, the other flung back
    const sweep = smooth(0.0, 0.55, x) * e;
    const [shA, syA, szA, elA, shB, szB] = d > 0 ? DASH_ARMS[0] : DASH_ARMS[1];
    if (!(this.sword.state === 'out' && d < 0)) {
      Pz[shA] = mix(Pz[shA], 1.3, e);
      Pz[syA] = mix(Pz[syA], mix(-0.9, 0.5, sweep), e);
      Pz[szA] = mix(Pz[szA], mix(0.4, 1.3, sweep), e);
      Pz[elA] = mix(Pz[elA], 0.15, e);
    }
    Pz[shB] = mix(Pz[shB], -0.7, e * 0.8);
    Pz[szB] = mix(Pz[szB], 0.8, e * 0.8);
    if (this.sword.state === 'out' && d < 0) {
      // drawn, going left: a forehand cut across from his right to his left
      Pz[C.shRx] = mix(Pz[C.shRx], 1.35, e);
      Pz[C.shRy] = mix(Pz[C.shRy], mix(0.6, -1.0, sweep), e);
      Pz[C.shRz] = mix(Pz[C.shRz], mix(1.2, 0.3, sweep), e);
      Pz[C.elR] = mix(Pz[C.elR], 0.1, e);
    }
    Pz[C.chTwist] -= 0.25 * e * d;
    this.dashK = e;
  }

  // (however a landing or a cut swings his arms, an elbow never bends
  // backward)
  applyPose(Pz, roll) {
    Pz[C.elL] = Math.max(0, Pz[C.elL]);
    Pz[C.elR] = Math.max(0, Pz[C.elR]);
    this.swordArm(Pz);
    super.applyPose(Pz, roll);
  }

  // The sword arm's own poses, laid over everything else without the
  // follow-through springs (a cut is crisp): the cut out of a draw, the
  // flick and the reach across of a sheathe, and the greeting's flourish.
  swordArm(Pz) {
    const S = this.sword;
    const live = 1 - (this.crashW || 0);
    if (S.state === 'drawing') {
      // a cut sweeping out wide to his right, level, as the point comes clear
      const u = S.t / SWORD.draw;
      const k = bump(0.55, 0.7, 0.85, 1.0, u) * live;
      const sw = smooth(0.55, 0.85, u);
      Pz[C.shRx] = mix(Pz[C.shRx], 1.35, k);
      Pz[C.shRy] = mix(Pz[C.shRy], mix(-0.9, 0.5, sw), k);
      Pz[C.shRz] = mix(Pz[C.shRz], mix(0.3, 1.3, sw), k);
      Pz[C.elR] = mix(Pz[C.elR], 0.1, k);
      Pz[C.chTwist] += 0.25 * k * (1 - sw);
    } else if (S.state === 'sheathing') {
      // the flick: the blade out to his right, snapped down
      const u = S.t / SWORD.sheathe;
      const k = bump(0.0, 0.08, 0.28, 0.38, u) * live;
      const fl = snap(0.12, 0.26, u);
      Pz[C.shRx] = mix(Pz[C.shRx], mix(1.25, 0.6, fl), k);
      Pz[C.shRz] = mix(Pz[C.shRz], mix(1.2, 0.85, fl), k);
      Pz[C.elR] = mix(Pz[C.elR], mix(0.7, 0.05, fl), k);
      Pz[C.shRy] = mix(Pz[C.shRy], 0.1, k);
    } else if (S.state === 'greet') {
      // the iai flourish standing: drawn and cut out wide, held, flicked
      const g = this.greetT;
      const k = bump(0.18, 0.28, 0.75, 0.95, g) * live;
      const sw = smooth(0.2, 0.36, g);
      const fl = snap(0.55, 0.66, g);
      Pz[C.shRx] = mix(Pz[C.shRx], mix(1.4, 0.55, fl), k);
      Pz[C.shRy] = mix(Pz[C.shRy], mix(-0.9, 0.4, sw), k);
      Pz[C.shRz] = mix(Pz[C.shRz], mix(mix(0.3, 1.35, sw), 0.9, fl), k);
      Pz[C.elR] = mix(Pz[C.elR], 0.08, k);
      Pz[C.chTwist] += 0.2 * k * (1 - sw);
      Pz[C.spLean] += 0.08 * k;
      Pz[C.hipY] -= 0.05 * k;
      Pz[C.knL] += 0.2 * k;
      Pz[C.knR] += 0.2 * k;
    }
  }

  // The spins and tips (after the pose, about his middle); the sword onto
  // its bone; his hands, where they have somewhere to be.
  afterPose(dt, cw) {
    const live = 1 - cw;
    const b = this.body;
    const wj = this.w.jump * live;
    if (this.tilt !== 0) turnAbout(b, _q.setFromAxisAngle(AX, this.tilt * wj), MID);
    if (this.pitchSpin !== 0) turnAbout(b, _q.setFromAxisAngle(AX, this.pitchSpin * wj), MID);
    if (this.rollSpin !== 0) turnAbout(b, _q.setFromAxisAngle(AZ, this.rollSpin * wj), MID);
    if (this.yawSpin !== 0) turnAbout(b, _q.setFromAxisAngle(AY, this.yawSpin * wj), MID);
    // (rising off the road for the butterfly: his middle up where he's laid
    // out flat, so his head and feet clear it)
    this.root.matrixWorld.identity();
    b.updateWorldMatrix(false, true);
    this.placeSword(dt, live);
    this.handsStep(live);
    this.footDust(dt);
  }

  // The sword's frame this frame (runner space), onto its bone: in the
  // scabbard (slid out along its curve by slide), in his right fist (its
  // blade turned dev off the line of his thumb toward his knuckles), or
  // between.
  placeSword(dt, live) {
    const S = this.sword;
    const b = this.b;
    // in the scabbard, slid out by s
    const sheathAt = (s, out) => {
      const th = s / this.ARC_R;
      // (about x through the arc's centre, under the mouth)
      _m2.makeTranslation(0, 0, -this.ARC_R).multiply(_m3.makeRotationX(th)).multiply(_m.makeTranslation(0, 0, this.ARC_R));
      return out.copy(b.saya.matrixWorld).multiply(_m2).multiply(this.relSheath);
    };
    // in the fist, the blade turned off the line of his thumb: trailing
    // along the line of his arm as he runs, as each jump has it, straight
    // out of his fist to cut
    const W = this.w;
    const tot = W.run + W.jump + W.slide + W.idle || 1;
    let dev = (W.run * DEV_RUN + W.jump * (this.devJump || 0) + W.slide * 0.05) / tot;
    if (S.state === 'drawing') dev *= smooth(0.85, 1.0, S.t / SWORD.draw);
    if (S.state === 'sheathing') dev *= 1 - smooth(0.0, 0.1, S.t / SWORD.sheathe);
    dev *= 1 - 0.85 * (this.dashK || 0);
    const heldAt = (out) => out.copy(b.handR.matrixWorld).multiply(this.relHeld.R).multiply(_m3.makeRotationX(dev));
    let slide = 0, held = 0;
    S.hold = 0;
    if (S.state === 'in') {
      sheathAt(0, this.swordF);
    } else if (S.state === 'out') {
      heldAt(this.swordF);
    } else {
      // drawing or sheathing (or the greeting's draw and sheathe): how far
      // out it's slid, how much it's in his fist, how much his fist is on it
      let u;
      if (S.state === 'drawing') u = S.t / SWORD.draw;
      else if (S.state === 'sheathing') u = 1 - S.t / SWORD.sheathe;
      else {
        const g = this.greetT;
        u = g < 0.6 ? clamp(g / 0.36, 0, 1) : 1 - clamp((g - 0.95) / 0.5, 0, 1);
        if (g > 1.6) {
          S.state = 'in';
          u = 0;
        }
      }
      // (drawing: reach 0-0.3, slide 0.3-0.62, clear 0.62-1; sheathing runs
      // it back, the flick first)
      slide = SLIDE * ease(clamp((u - 0.28) / 0.34, 0, 1));
      held = smooth(0.62, 0.9, u);
      S.hold = smooth(0.0, 0.26, u) * (1 - smooth(0.66, 0.95, u));
      sheathAt(slide, this.sheathF);
      if (held <= 0) this.swordF.copy(this.sheathF);
      else {
        heldAt(this.heldF);
        // (blended: positions lerped, turns slerped)
        this.sheathF.decompose(_a, _q, _s);
        this.heldF.decompose(_b, _q2, _s);
        _a.lerp(_b, held);
        _q.slerp(_q2, held);
        this.swordF.compose(_a, _q, _s.set(1, 1, 1));
      }
      if (S.state === 'in') sheathAt(0, this.swordF);
    }
    this.swordF.decompose(b.sword.position, b.sword.quaternion, _s);
    b.sword.updateMatrix();
    b.sword.matrixWorld.copy(this.swordF);
    S.slide = slide;
  }

  // His hands on the sword: the left on the scabbard by its mouth whenever
  // the sword's in it (or going in or out) and his arm's not wanted for
  // anything else; the right on the hilt while he draws or sheathes it; the
  // left on the hilt below the right when he holds it in both.
  handsStep(live) {
    const S = this.sword;
    const W = this.w;
    const tot = W.run + W.jump + W.slide + W.idle || 1;
    const air = W.jump / tot;
    // left on the scabbard
    const onSaya = (S.state === 'out' ? 0 : S.state === 'drawing' ? 1 - smooth(0.6, 1, S.t / SWORD.draw) : S.state === 'sheathing' ? smooth(0.3, 0.6, S.t / SWORD.sheathe) : 1) * (1 - air) * live * (1 - (this.dashK || 0) * 0.85);
    if (onSaya > 0.01) {
      _m.copy(this.b.saya.matrixWorld).multiply(this.sayaGrip).multiply(this.relHeldInv.L);
      this.armTo('L', _m, _v3.set(-0.45, -0.25, 1), onSaya);
    }
    // right on the hilt
    let onHilt = S.hold * live;
    // (crouched in the duck, sheathed: his hand on the hilt, ready)
    if (S.state === 'in') onHilt = Math.max(onHilt, (W.slide / tot) * smooth(0.05, 0.2, this.slideU ?? 1) * (1 - smooth(0.72, 0.9, this.slideU ?? 1)) * live);
    if (onHilt > 0.01) {
      _m.copy(this.b.sword.matrixWorld).multiply(this.relHeldInv.R);
      this.armTo('R', _m, _v3.set(1, -0.5, 0.2), onHilt);
    }
    // left on the hilt, below the right
    const two = (this.twoHands || 0) * (W.jump / tot) * live;
    this.twoHands = 0;
    if (two > 0.01 && S.state === 'out') {
      _m.copy(this.b.sword.matrixWorld).multiply(_m2.makeTranslation(0, this.rig.katana.grip2, 0)).multiply(this.relHeldInv.L);
      this.armTo('L', _m, _v3.set(-1, -0.4, 0.2), two);
    }
  }

  // Two-bone solve of one arm, its hand to the frame H (runner space) - the
  // wrist where H puts it, the hand turned as H turns it - its elbow bent
  // toward pole, laid over the pose by w.
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
    // the hand turned as the frame turns it
    H.decompose(_v, _q, _v2);
    fore.matrixWorld.decompose(_v, _q2, _v2);
    _q2.invert().multiply(_q);
    hand.quaternion.slerp(_q2, w);
    hand.updateMatrixWorld(true);
  }

  // --- secondary motion ---------------------------------------------------------------
  simulate(dt, steps) {
    this.ropeStep(dt, steps);
    this.earStep(dt);
  }

  earStep(dt) {
    const b = this.b;
    const L = this.earS.L.step(0, 6, 0.22, dt);
    const R = this.earS.R.step(0, 6, 0.22, dt);
    b.earL.rotation.z -= 0.3 * L;
    b.earL.rotation.x += 0.15 * Math.abs(L);
    b.earR.rotation.z += 0.3 * R;
    b.earR.rotation.x += 0.15 * Math.abs(R);
    // (laid back flat in a dash, a jump, a cut)
    const back = Math.max(this.dashK || 0, this.w.jump * 0.6);
    b.earL.rotation.x += 0.35 * back;
    b.earR.rotation.x += 0.35 * back;
    b.earL.updateMatrixWorld(true);
    b.earR.updateMatrixWorld(true);
  }

  // Where the tail's held toward, joint by joint (runner space, from the
  // hips): a hunting cat's curve - out behind and a little down, rising
  // again toward its end - streaming out straighter the faster he goes,
  // swaying slowly side to side in a wave running down it, and lashing:
  // thrown across with a dash, flicked up by a spring, down on landing.
  // Stood about, it hangs in a long curve and its end swishes.
  tailTargets(R, out) {
    const t = this.time;
    const run = this.mode === 'run' ? clamp(this.speed / 18, 0, 1) : 0;
    const lash = this.lash.step(0, 2.6, 0.3, this.lastSimDt || 0.016);
    const dash = (this.dashK || 0) * this.dodgeDir;
    // the root, where his hips have it; and turned as they are
    out[0].copy(R.rest[0]).applyMatrix4(this.boneM('hips'));
    _q.setFromRotationMatrix(_m.extractRotation(this.b.hips.matrixWorld));
    // (leaving him back and down - more down stood about)
    let pitch = mix(-0.95, -0.28 + 0.35 * lash, run);
    for (let k = 1; k < R.n; k++) {
      const s = k / (R.n - 1);
      const wave = Math.sin(t * mix(1.6, 5.5, run) - s * 3.2) * (0.12 + 0.35 * s) * mix(1, 0.55, run);
      // (curving: running, out behind and rising gently toward its end;
      // stood about, hanging, its end curling up off the road)
      pitch += mix(mix(-0.25, 0.42, s), mix(0.0, 0.12, s), run);
      const yaw = wave + 0.9 * dash * (0.4 + s);
      const cp = Math.cos(pitch);
      _v.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).applyQuaternion(_q);
      out[k].copy(out[k - 1]).addScaledVector(_v, R.len[k - 1]);
    }
  }

  // The tail and the obi's ends: ropes of particles (simulated in the
  // runner's space turned to the world's axes, in fixed substeps), each
  // joint drawn toward where it's held - firmly near the tail's root, less
  // toward its end, the obi's not at all - swung by gravity, his own
  // accelerations and the air, and kept off his legs, his seat, the
  // scabbard and the road; the bones follow.
  ropeStep(dt, steps) {
    if (dt <= 0) return;
    this.lastSimDt = dt;
    const Q = this.root.quaternion;
    // colliders into simulation space
    for (let i = 0; i < this.ropeCols.length; i++) {
      const d = this.ropeCols[i];
      const c = this.cols[i];
      const T = this.boneM(d.bone);
      const m = 0.03;
      if (d.kind === 'ell') {
        c.c.copy(d.c).applyMatrix4(T).applyQuaternion(Q);
        for (let e = 0; e < 3; e++) {
          c.ax[e].setFromMatrixColumn(T, e).normalize().applyQuaternion(Q);
          c.r[e] = d.r.getComponent(e) + m;
        }
      } else {
        c.a.copy(d.a).applyMatrix4(T).applyQuaternion(Q);
        c.b.copy(d.b).applyMatrix4(T).applyQuaternion(Q);
        c.ra = d.ra + m;
        c.rb = d.rb + m;
      }
    }
    const tail = this.ropes[0];
    this.tailTargets(tail, tail.tgt);
    for (const R of this.ropes) {
      if (R.kind === 'obi') {
        const T = this.boneM(R.bones[0].name);
        for (let k = 0; k < R.n; k++) R.tgt[k].copy(R.rest[k]).applyMatrix4(T);
      }
      for (let k = 0; k < R.n; k++) R.tgt[k].applyQuaternion(Q);
      if (!R.ready) {
        for (let k = 0; k < R.n; k++) {
          R.p[k].copy(R.tgt[k]);
          R.q[k].copy(R.tgt[k]);
        }
        R.ready = true;
      }
    }
    const vel = _dv.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
    const airX = -vel.x + this.breeze.x, airY = -vel.y + this.breeze.y, airZ = -vel.z + this.breeze.z;
    const gx = -this.frameAcc.x, gy = -9.8 * this.gk - this.frameAcc.y, gz = -this.frameAcc.z;
    const groundY = (this.groundY || 0) - this.y + 0.03;
    const h = dt / steps;
    const scale = h / this.ropeH;
    this.ropeH = h;
    for (let s = 0; s < steps; s++) {
      for (const R of this.ropes) {
        const obi = R.kind === 'obi';
        const kd = obi ? 0.9 : 0.55;
        for (let k = 1; k < R.n; k++) {
          const p = R.p[k], q = R.q[k];
          const vx = ((p.x - q.x) * scale) / h, vy = ((p.y - q.y) * scale) / h, vz = ((p.z - q.z) * scale) / h;
          const fl = obi ? Math.sin(this.time * 17 + k * 1.3 + R.n) * Math.hypot(airX, airZ) * 0.25 : 0;
          const ax = gx + kd * (airX - vx) + fl;
          const ay = gy * (obi ? 1 : 0.6) + kd * (airY - vy);
          const az = gz + kd * (airZ - vz);
          const damp = obi ? 0.985 : 0.97;
          const nx = p.x + (p.x - q.x) * scale * damp + ax * h * h;
          const ny = p.y + (p.y - q.y) * scale * damp + ay * h * h;
          const nz = p.z + (p.z - q.z) * scale * damp + az * h * h;
          q.copy(p);
          p.set(nx, ny, nz);
        }
        R.p[0].copy(R.tgt[0]);
        R.q[0].copy(R.p[0]);
        if (!obi) {
          // held toward its curve: firmly at the root, loosely at the end
          for (let k = 1; k < R.n; k++) {
            const hk = 0.3 * Math.pow(1 - k / R.n, 1.4) + 0.025;
            R.p[k].lerp(R.tgt[k], hk);
          }
        }
        for (let it = 0; it < 3; it++) {
          for (let k = 0; k < R.n - 1; k++) {
            const a = R.p[k], c = R.p[k + 1];
            _v.subVectors(c, a);
            const L = _v.length() || 1e-6;
            const e = (L - R.len[k]) / L;
            if (k === 0) c.addScaledVector(_v, -e);
            else {
              a.addScaledVector(_v, 0.5 * e);
              c.addScaledVector(_v, -0.5 * e);
            }
          }
          for (let k = 1; k < R.n; k++) this.pushOut(R.p[k], groundY, obi ? 0.012 : R === tail ? 0.045 : 0.02);
        }
      }
    }
    // the bones follow
    const Qi = _q3.copy(Q).invert();
    for (const R of this.ropes) {
      R.parent.matrixWorld.decompose(_v, _q, _v2);
      let Rp = _q2.copy(_q);
      for (let k = 0; k < R.n - 1; k++) {
        _a.subVectors(R.p[k + 1], R.p[k]).applyQuaternion(Qi).normalize();
        _a.applyQuaternion(_q.copy(Rp).invert());
        const bone = R.bones[k];
        bone.quaternion.setFromUnitVectors(R.dir0[k], _a);
        Rp = Rp.multiply(bone.quaternion);
      }
    }
  }

  // A particle pushed out of whatever of him it's inside (r: its own
  // thickness), and up off the road.
  pushOut(p, groundY, r) {
    for (const c of this.cols) {
      if (c.kind === 'ell') {
        _v.subVectors(p, c.c);
        const x = _v.dot(c.ax[0]) / (c.r[0] + r), y = _v.dot(c.ax[1]) / (c.r[1] + r), z = _v.dot(c.ax[2]) / (c.r[2] + r);
        const k = Math.hypot(x, y, z);
        if (k < 1 && k > 1e-6) {
          const f = 1 / k - 1;
          p.addScaledVector(c.ax[0], x * f * (c.r[0] + r)).addScaledVector(c.ax[1], y * f * (c.r[1] + r)).addScaledVector(c.ax[2], z * f * (c.r[2] + r));
        }
      } else {
        _v.subVectors(c.b, c.a);
        const L2 = _v.lengthSq() || 1e-9;
        const tt = clamp(_v2.subVectors(p, c.a).dot(_v) / L2, 0, 1);
        _v3.copy(c.a).addScaledVector(_v, tt);
        _v2.subVectors(p, _v3);
        const d = _v2.length();
        const rr = c.ra + (c.rb - c.ra) * tt + r;
        if (d < rr && d > 1e-6) p.addScaledVector(_v2, (rr - d) / d);
      }
    }
    if (p.y < groundY) p.y = groundY;
  }

  // --- dust -----------------------------------------------------------------------
  // Off his feet as he drives off the road at a sprint, now and then.
  footDust(dt) {
    if (this.wet || this.crashed || this.mode !== 'run' || !this.grounded || this.sliding) return;
    const sp = clamp((this.speed - CONFIG.speed.start) / (CONFIG.speed.max - CONFIG.speed.start), 0, 1);
    const off = this.footfalls();
    if (!off) return;
    const r = Math.random;
    for (let side = 0; side < 2; side++) {
      if (!(off & (1 << side)) || r() > 0.3 + 0.4 * sp) continue;
      const sx = side ? 1 : -1;
      // (thrown with a share of his speed, so it's left behind)
      _p.set(sx * (0.3 + 0.5 * r()), 0.4 + 0.5 * r(), -this.speed * (0.4 + 0.15 * r()));
      this.dust.emit(_v.set(sx * 0.1, 0.04, 0.05), _p, 0.16 + 0.08 * r(), false, 0.55);
    }
  }

  // A burst off his feet as he lands, a ring of it if he lands hard.
  landDust(hit) {
    const r = Math.random;
    const run = _dv.set(this.vx, 0, -this.speed);
    const n = hit > 1.1 ? 6 : 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + r() * 0.5;
      _p.copy(run).multiplyScalar(0.3 + 0.1 * r());
      _p.x += Math.sin(a) * (1.4 + 1.0 * r());
      _p.z += Math.cos(a) * (1.0 + 0.8 * r());
      _p.y += 0.25 + 0.4 * r();
      this.dust.emit(_v.set(Math.sin(a) * 0.18, 0.04, Math.cos(a) * 0.14), _p, 0.24 + 0.1 * r() * hit);
    }
  }

  // A spray off the foot he pushes away from as he flash steps.
  dashDust(dir) {
    const r = Math.random;
    for (let k = 0; k < 3; k++) {
      _p.set(-dir * (2.2 + 1.2 * r()), 0.4 + 0.5 * r(), -this.speed * (0.4 + 0.1 * r()));
      this.dust.emit(_v.set(-dir * 0.16, 0.04, 0.0), _p, 0.2 + 0.08 * r());
    }
  }
}
