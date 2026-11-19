import * as THREE from '../../vendor/three/three.module.min.js';
import { makeEnvUniforms, makeKnotMaterials, shared } from '../render/shaders.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { CastShadow } from '../render/caster.js';
import { Dust } from './dust.js';
import { buildKnot, RHO } from './knotshape.js';

// Knotling, the living knot who runs with you: the body and how it moves.
// One continuous length of thick marigold rope, a single indigo strand wound
// through it, tied over and under itself into a loose, roughly round knot
// (knotshape.js), with two eyes looking out from the dark inside him.
// Nothing here decides where he goes - that's his mind (roller.js, built on
// the runners' companion.js), which hands him a place in the world, how fast
// he's going, what he's doing, and the ring he swings by.
//
// There's no sculpted model: the rope's tube is laid out here every frame,
// from where each bit of rope is along it (its material, which carries the
// plies, the indigo strand, the worn patches and the flyaways with it):
//   - the knot's shape at rest, a loop of it now and then slipping open or
//     drawn tight (each on a spring of its own: it overshoots, and settles)
//     while the others hold;
//   - rolled: turned about the axis across the way he's going by exactly as
//     far as he's rolled over the ground (his centre's height, as he's
//     squashed or not, is the radius it rolls on);
//   - reshaped, in the world's own up: squashed by his weight, his lower
//     loops first and the upper ones settling a beat later; the contact
//     patch flattened where he meets the ground; bunched low before a jump
//     and stretched as he pushes off; slid low and wide under a bar, his top
//     loops slipping out over his sides. And every change of size takes rope
//     from one part of him to another: as he bunches, squashes or flattens,
//     rope is drawn along itself toward the part of him that's growing
//     (you see the plies and the indigo strand slide along);
//   - the ring he swings by: part of him fed out (the rest of the knot drawn
//     smaller by just as much rope), an open hoop reaching ahead and up,
//     pulled taut into a long narrow loop when it catches, let go and drawn
//     back into him.
// Then each vertex is shaded by how shut in it is (rope pressed against rope,
// the hollow inside him) and whether a loop over it lies between it and the
// light (Knotling.shade), and the shader does the rest: the three plies, the
// yarns twisted in them, the fibres, the indigo strand, the worn patches.
//
// His flyaways are real strands - short, uneven golden fibres standing off
// his exposed bends and his worn patches (none where the rope's pressed
// against itself) - each on a quick spring of its own, so when a loop pulls
// taut they tremble on after the rope has settled. His eyes don't roll with
// him: they sit inside the knot, looking out through whatever opening the
// rope leaves them toward you, and when a strand rolls across them they wait
// a moment, then look out through another.
//
// At a run he really does spin fast (the rope covers the ground as he
// rolls); a little of each frame's turn is smeared behind him, as a camera's
// shutter would (the ghosts: see blur), so he reads as rolling, not
// flickering, at 30 frames a second as at 60.

// His size: the knot's outer radius (m), and the rope's
export const RADIUS = 0.36;
export const ROPE = RHO * RADIUS;
const NR = 288; // rings round the rope's length
const SIDES = 12;
const NF = 170; // flyaways
const EYE_R = 0.041;
const EYE_SEP = 0.047;
const SHAPE = buildKnot();
const M = SHAPE.p.length / 3;
export const LENGTH = SHAPE.length * RADIUS;
// the plies' lay and the indigo strand's, each a whole number of turns
// round the rope's length (so the pattern meets itself)
const LAY = LENGTH / Math.round(LENGTH / 0.29);
const BLUE_LAY = LENGTH / Math.round(LENGTH / 0.85);
// marigold, the grooves, fibre-light, indigo, indigo deep, worn, the dark inside
const COLS = ['#f5a91f', '#c9700f', '#ffd77e', '#3a4bd0', '#1a2378', '#f7d185', '#1d0c04'];
// his eyes: the white, the iris, its rim, the pupil
const EYES = ['#f8edd3', '#7c461a', '#3a1c09', '#1e0d06'];
// how much of a frame's turn the shutter smears, and in how many ghosts
const SHUTTER = 0.55;
const GHOSTS = 3;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);
const _w = new THREE.Vector3();
const _w2 = new THREE.Vector3();

// A spring with a force on it (semi-implicit, steady at any frame time).
class Sway {
  constructor() {
    this.x = 0;
    this.v = 0;
  }
  step(target, freq, zeta, dt, f = 0) {
    const w = TAU * freq;
    const n = Math.min(6, Math.max(1, Math.ceil(dt * 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v = (this.v + h * (w * w * (target - this.x) + f)) / (1 + 2 * zeta * w * h + w * w * h * h);
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
  }
}

// a seeded random, for where his fibres and worn patches are (the same every
// time he's made)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const frac = (x) => x - Math.floor(x);

// The knot's rest shape at k (0..1 round it, closed), in knot units: a
// Catmull-Rom through the samples.
function shapeAt(k, out) {
  const x = frac(k) * M;
  const i = Math.floor(x);
  const t = x - i;
  const P = SHAPE.p;
  const a = ((i + M - 1) % M) * 3, b = (i % M) * 3, c = ((i + 1) % M) * 3, d = ((i + 2) % M) * 3;
  const t2 = t * t, t3 = t2 * t;
  const w0 = -0.5 * t3 + t2 - 0.5 * t, w1 = 1.5 * t3 - 2.5 * t2 + 1, w2 = -1.5 * t3 + 2 * t2 + 0.5 * t, w3 = 0.5 * t3 - 0.5 * t2;
  out.set(P[a] * w0 + P[b] * w1 + P[c] * w2 + P[d] * w3, P[a + 1] * w0 + P[b + 1] * w1 + P[c + 1] * w2 + P[d + 1] * w3, P[a + 2] * w0 + P[b + 2] * w1 + P[c + 2] * w2 + P[d + 2] * w3);
  return out;
}

// how sharply the rest shape bends at k (1/knot units), and which way it
// bends out (for where the flyaways stand)
function bendAt(k) {
  const h = 1 / M;
  shapeAt(k - h, _v);
  shapeAt(k, _v2);
  shapeAt(k + h, _v3);
  const l = (_v.distanceTo(_v2) + _v2.distanceTo(_v3)) / 2;
  return _v.add(_v3).addScaledVector(_v2, -2).length() / (l * l);
}

// Directions spread evenly round a ball (where his eyes might look out).
const LOOKOUTS = [];
for (let i = 0, n = 40; i < n; i++) {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.39996323;
  LOOKOUTS.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
}

export class Knotling {
  constructor(env) {
    this.u = makeEnvUniforms(env);
    this.root = new THREE.Group();
    this.root.name = 'knotling';
    this.mats = makeKnotMaterials(this.u, { cols: COLS, eyes: EYES, radius: ROPE, lay: LAY, blueLay: BLUE_LAY, outline: 0.0065 });
    this.buildRope();
    this.buildFibres();
    this.buildEyes();
    this.cast = new CastShadow(this.u, { res: 192 });
    this.shadow = this.cast.mesh;
    this.dust = new Dust(this.u, 90);
    this.Q = new THREE.Quaternion();
    this.omega = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.velS = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    // set by his mind each frame: where his eyes look (a point in the
    // world, or null), whether that's a glance (looking right at it), the
    // ring (out: 0..1 how far it's fed out toward at, taut: 0..1), and while
    // he swings, how he turns (rad/s about the world axis; null: he rolls)
    this.gazeAt = null;
    this.glance = 0;
    this.ringOut = 0;
    this.ringTaut = 0;
    this.ringAt = new THREE.Vector3();
    this.turn = null;
    this.reset();
  }

  // --- the rope's tube -------------------------------------------------------------
  buildRope() {
    const RV = SIDES + 1;
    const n = (NR + 1) * RV;
    this.C = new Float32Array((NR + 1) * 3); // ring centres (root space)
    this.T = new Float32Array((NR + 1) * 3); // tangents
    this.N = new Float32Array((NR + 1) * 3); // frame
    this.B = new Float32Array((NR + 1) * 3);
    this.ringShade = new Float32Array(NR + 1);
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.tan = new Float32Array(n * 3);
    this.rope = new Float32Array(n * 4);
    this.wear = new Float32Array(n);
    const idx = [];
    for (let i = 0; i < NR; i++) {
      for (let s = 0; s < SIDES; s++) {
        const a = i * RV + s, b = (i + 1) * RV + s;
        // (wound so they face out: round the rope, then along it)
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    const dyn = (arr, k) => new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.pos, 3));
    geo.setAttribute('normal', dyn(this.nrm, 3));
    geo.setAttribute('aTan', dyn(this.tan, 3));
    geo.setAttribute('aRope', dyn(this.rope, 4));
    geo.setAttribute('aWear', new THREE.BufferAttribute(this.wear, 1));
    geo.setIndex(idx);
    this.geo = geo;
    // worn patches: a few stretches of rope rubbed pale and fuzzy
    const R = rng(31);
    this.patches = [0, 1, 2, 3].map(() => ({ u: R(), w: 0.012 + R() * 0.016, a: 0.6 + R() * 0.4 }));
    for (let i = 0; i <= NR; i++) {
      const u = i / NR;
      let w = 0;
      for (const p of this.patches) {
        let d = Math.abs(u - p.u);
        d = Math.min(d, 1 - d);
        w = Math.max(w, p.a * Math.exp(-(d * d) / (p.w * p.w)));
      }
      for (let s = 0; s <= SIDES; s++) this.wear[i * RV + s] = w;
    }
    this.mesh = new THREE.Mesh(geo, this.mats.rope);
    this.inkMesh = new THREE.Mesh(geo, this.mats.ink);
    this.ghosts = [];
    for (let k = 0; k < GHOSTS; k++) {
      const g = new THREE.Mesh(geo, this.mats.ghost());
      g.userData.noCast = true;
      g.renderOrder = 2;
      g.visible = false;
      this.ghosts.push(g);
    }
    for (const m of [this.mesh, this.inkMesh, ...this.ghosts]) {
      m.frustumCulled = false;
      this.root.add(m);
    }
    this.mesh.renderOrder = -20;
    this.inkMesh.renderOrder = -20;
  }

  // --- the flyaways ----------------------------------------------------------------------
  // Each is anchored to a point of the rope (its material: it goes where the
  // rope goes) and an angle off the side of it facing out of the knot; most
  // on the sharpest bends and the worn patches.
  buildFibres() {
    const R = rng(77);
    this.fib = [];
    const bends = [];
    for (let i = 0; i < 400; i++) bends.push(bendAt(i / 400));
    const maxB = Math.max(...bends);
    while (this.fib.length < NF) {
      const u = R();
      let wear = 0;
      for (const p of this.patches) {
        let d = Math.abs(u - p.u);
        d = Math.min(d, 1 - d);
        wear = Math.max(wear, p.a * Math.exp(-(d * d) / (p.w * p.w)));
      }
      const bend = bends[Math.floor(u * 400) % 400] / maxB;
      if (R() > 0.12 + 0.55 * bend + 0.9 * wear) continue;
      this.fib.push({
        u,
        ang: (R() - 0.5) * 2.6,
        len: (0.014 + R() * R() * 0.03) * (1 + wear * 0.5),
        lean: (R() - 0.5) * 1.4,
        curl: (R() - 0.5) * 1.6,
        tone: R(),
        freq: 9 + R() * 7,
        // (its tremble: two ways off its line)
        a: new Sway(),
        b: new Sway(),
        show: 0,
      });
    }
    const n = NF * 6;
    this.fpos = new Float32Array(n * 3);
    this.fdir = new Float32Array(n * 3);
    this.ffib = new Float32Array(n * 4);
    for (let f = 0; f < NF; f++) {
      for (let k = 0; k < 3; k++) {
        for (let e = 0; e < 2; e++) {
          const j = f * 6 + k * 2 + e;
          this.ffib[j * 4] = k / 2;
          this.ffib[j * 4 + 1] = e ? 1 : -1;
          this.ffib[j * 4 + 2] = 0.0018;
          this.ffib[j * 4 + 3] = this.fib[f].tone;
        }
      }
    }
    const idx = [];
    for (let f = 0; f < NF; f++) {
      for (let k = 0; k < 2; k++) {
        const a = f * 6 + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.fpos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aDir', new THREE.BufferAttribute(this.fdir, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFib', new THREE.BufferAttribute(this.ffib, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.fibres = new THREE.Mesh(geo, this.mats.fibre);
    this.fibres.frustumCulled = false;
    this.fibres.renderOrder = 3;
    this.fibres.userData.noCast = true;
    this.root.add(this.fibres);
  }

  // --- his eyes ------------------------------------------------------------------------------
  buildEyes() {
    const geo = new THREE.SphereGeometry(1, 18, 14);
    this.eyeMeshes = [0, 1].map(() => {
      const m = new THREE.Mesh(geo, this.mats.eye());
      m.frustumCulled = false;
      m.userData.noCast = true;
      m.renderOrder = -19;
      this.root.add(m);
      return m;
    });
    // the same eyes, seen through the blur of his rope when he spins fast
    // (a cage of rope turning five or ten times a second is no more solid to
    // the eye than a fan's blades: you see what's inside through it)
    this.eyeThrough = this.eyeMeshes.map((e) => {
      const m = new THREE.Mesh(geo, this.mats.eye(true, e.material.uniforms.uGaze));
      m.frustumCulled = false;
      m.userData.noCast = true;
      m.renderOrder = 5;
      m.visible = false;
      this.root.add(m);
      return m;
    });
    const plane = new THREE.PlaneGeometry(2, 2);
    this.hollow = new THREE.Mesh(plane, this.mats.hollow);
    this.hollow.frustumCulled = false;
    this.hollow.userData.noCast = true;
    this.hollow.renderOrder = 1;
    this.root.add(this.hollow);
    // where they look out from: a way out from his middle (in the world's
    // own frame: they don't roll with him) and how deep in him
    this.eyeDir = new THREE.Vector3(0, 0.4, 1).normalize();
    this.eyeDirTo = this.eyeDir.clone();
    this.eyeDepth = 0.5;
    this.eyeDepthTo = 0.5;
    this.eyeAt = [new THREE.Vector3(), new THREE.Vector3()];
    this.eyeMid = new THREE.Vector3();
    this.eyeSide = new THREE.Vector3(1, 0, 0);
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points];
  }

  reset() {
    this.time = 0;
    this.mode = 'sit';
    this.airT = 0;
    this.airDur = 1;
    this.happy = 0;
    this.wag = 0;
    this.earBias = 0;
    this.lowTarget = 0;
    this.jawOpen = 0;
    this.lookAt = null;
    this.lookW = 0;
    this.spin = 0;
    this.wet = 0;
    this.Q.identity();
    // (turned so the opening at one pole of the knot faces you, the first
    // time you see him)
    this.Q.setFromAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 1.1);
    this.omega.set(0, 0, 0);
    this.ready = false;
    this.velS.set(0, 0, 0);
    this.acc.set(0, 0, 0);
    this.sqLow = new Sway();
    this.sqHigh = new Sway();
    this.crouchS = new Spring();
    this.lowS = new Spring();
    this.lowNow = 0;
    this.drift = new Sway();
    this.pushT = 9;
    this.landHit = 0;
    this.slips = [0, 1, 2].map(() => ({ k: 0, sign: 1, amp: new Sway(), hold: 0, on: false }));
    // his moods in his shape (see wave, shake, stretchUp; wobble and the
    // lean are set as he goes)
    this.leanX = new Sway();
    this.leanZ = new Sway();
    this.loose = new Sway();
    this.looseT = 0;
    this.looseNow = 0;
    this.tall = new Sway();
    this.tallT = 0;
    this.tallNow = 0;
    this.arm = new Sway();
    this.armT = 0;
    this.armNow = 0;
    this.armDir = new THREE.Vector3(1, 0, 0);
    this.armUp = new THREE.Vector3(0, 1, 0);
    this.wobble = 0;
    this.ready2 = false;
    this.orbit = { az: Math.PI, el: 0.35, azTo: Math.PI, elTo: 0.35, hold: 1.5, forced: 0, circle: 0, circleDir: 1 };
    this.runnerSide = -1;
    this.slipT = 2;
    this.fed = 0;
    this.feedK = 0;
    this.feedU = 0;
    this.kOff = 0;
    this.ringOn = false;
    this.wasTaut = 0;
    this.ringOut = 0;
    this.ringTaut = 0;
    this.turn = null;
    this.blinkT = 2.5;
    this.blink = 0;
    this.blocked = 0;
    this.moveT = 1;
    this.peekT = 1.5;
    this.covered = 0;
    this.lastDt = 0;
    this.spun = 0;
    if (this.fib) for (const f of this.fib) {
      f.a.reset();
      f.b.reset();
      f.show = 0;
    }
    this.dust?.clear();
    this.root.visible = true;
  }

  // --- what his mind tells him ---------------------------------------------------------------
  // Down on the ground with weight k (1: an ordinary landing).
  land(k = 1) {
    this.sqLow.v += 5.2 * clamp(k, 0.2, 1.6);
    this.landHit = k;
    // (a loop jolted loose, drawn back tight; the fibres shiver)
    if (k > 0.35) this.slipNow(Math.random() < 0.5 ? 1 : -1, 0.6 + 0.4 * Math.min(k, 1));
    this.kick(-1, 0, 0.7 * Math.min(k, 1.2));
    this.puffs(k);
  }

  // A lobe of him drawn out toward dir (world, level) and waved, for dur s.
  wave(dir, dur = 1.4) {
    this.armDir.copy(dir).setY(0).normalize().setY(0.35).normalize();
    this.armUp.copy(_UP).addScaledVector(this.armDir, -this.armDir.y).normalize();
    this.armT = dur;
    this.slipNow(1, 0.5);
  }

  // Let loose - every loop sagging open, shivering - then cinched tight
  // again with a snap (and the flyaways all shaken).
  shake(dur = 0.5) {
    this.looseT = dur;
  }

  // Drawn up tall a moment, as if stretching, then settled back down.
  stretchUp(dur = 0.55) {
    this.tallT = dur;
  }

  // His eyes sent round to look out from az (0 the way he's going, pi
  // back toward you; + to his right) and el (up), for dur s.
  peek(az, el = 0.35, dur = 1.6) {
    const O = this.orbit;
    O.azTo = az;
    O.elTo = el;
    O.hold = dur;
    O.forced = dur;
  }

  // His eyes sent right round him, for dur s (dir: which way round).
  circleEyes(dur = 2, dir = 1) {
    const O = this.orbit;
    O.circle = dur;
    O.circleDir = dir;
    O.hold = dur + 0.4;
  }

  // His moods in his shape, frame by frame.
  moodStep(dt) {
    // (each a spring that overshoots: rope gives, and comes back)
    this.armT -= dt;
    this.armNow = Math.max(0, this.arm.step(this.armT > 0 ? 1 : 0, 2.6, 0.45, dt));
    const wasLoose = this.looseT > 0;
    this.looseT -= dt;
    this.looseNow = this.loose.step(this.looseT > 0 ? 1 : 0, this.looseT > 0 ? 3 : 4.2, this.looseT > 0 ? 0.7 : 0.22, dt);
    if (wasLoose && this.looseT <= 0) {
      // cinched: everything pulls taut at once
      this.kick(-1, 0, 1.4);
      this.sqLow.v -= 1.5;
    }
    this.tallT -= dt;
    this.tallNow = this.tall.step(this.tallT > 0 ? 1 : 0, 2.2, 0.33, dt);
    // the lean: his top lags his bottom (against his acceleration across
    // and along), and in a wobble he rocks side to side as he rolls
    const wob = this.wobble * 0.5 * Math.sin(this.time * 7.5);
    const air = this.mode === 'air' ? 0.4 : 1;
    this.leanX.step(clamp(-this.acc.x * 0.011 * air, -0.22, 0.22) + wob, 2.2, 0.3, dt);
    this.leanZ.step(clamp(-this.acc.z * 0.008 * air, -0.16, 0.16), 2.1, 0.32, dt);
  }

  // A happy little loop-flick (his mind: a greeting, a fetch).
  flick() {
    this.slipNow(1, 0.8);
  }

  snap() {
    this.slipNow(-1, 0.7);
  }

  // A loop slipping open (sign 1) or drawn tighter (-1), k strong.
  slipNow(sign, k = 1) {
    const s = this.slips.find((x) => !x.on) || this.slips[0];
    // (a loop out on his top or his side, where you'll see it)
    let best = 0, bestY = -9;
    for (let t = 0; t < 8; t++) {
      const kk = Math.random();
      shapeAt(kk, _v).applyQuaternion(this.Q);
      const y = _v.y * 0.6 + _v.z * 0.4 + Math.random() * 0.4;
      if (y > bestY) {
        bestY = y;
        best = kk;
      }
    }
    s.k = best;
    s.sign = sign;
    s.hold = 0.22 + Math.random() * 0.2;
    s.str = k;
    s.on = true;
  }

  // Shake the flyaways near material u (within w; u < 0: all of them).
  kick(u, w, k) {
    for (const f of this.fib) {
      if (u >= 0) {
        let d = Math.abs(f.u - u);
        d = Math.min(d, 1 - d);
        if (d > w) continue;
      }
      f.a.v += (Math.random() - 0.5) * 9 * k;
      f.b.v += (Math.random() - 0.5) * 9 * k;
    }
  }

  puffs(k) {
    if (k < 0.3 || !this.root.parent) return;
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU;
      _v.set(Math.cos(a) * RADIUS * 0.6, 0.03, Math.sin(a) * RADIUS * 0.6);
      _v2.set(Math.cos(a) * (0.6 + Math.random()), 0.3 + Math.random() * 0.4, Math.sin(a) * (0.6 + Math.random()));
      this.dust.emit(_v, _v2, 0.09 + 0.05 * Math.random() * k, false, 0.35 * Math.min(1, k), 0.8);
    }
  }

  // --- the frame -----------------------------------------------------------------------------
  // ctx (as the fox's): speed, vel (world), mode ('run' | 'air' | 'sit' |
  // 'stand'), airT / airDur, crouch (0..1 winding up for a jump)
  update(dt, ctx) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.lastDt += dt;
    this.dtNow = dt;
    this.mode = ctx.mode === 'ride' ? 'stand' : ctx.mode;
    const air = this.mode === 'air';
    if (ctx.vel) {
      if (!this.ready) this.velS.copy(ctx.vel);
      _v.copy(this.velS);
      this.velS.lerp(ctx.vel, 1 - Math.exp(-dt * 30));
      if (dt > 0) this.acc.subVectors(this.velS, _v).divideScalar(dt).clampLength(0, 60);
      this.vel.copy(ctx.vel);
      this.ready = true;
    }
    if (air) {
      if (this.airT > ctx.airT || !this.wasAir) this.pushT = 0;
      this.airT = ctx.airT;
      this.airDur = ctx.airDur;
    }
    this.wasAir = air;
    this.pushT += dt;
    // his weight: squashed on landing (the lower loops first, the upper ones
    // following a beat later); breathing a little when he sits
    const breathe = this.mode === 'sit' || this.mode === 'stand' ? Math.sin(this.time * 2.2) * 0.025 : 0;
    this.sqLow.step(breathe, 4.6, 0.32, dt);
    this.sqHigh.step(this.sqLow.x, 2.6, 0.42, dt);
    this.crouchS.step(ctx.crouch || 0, 7, 0.8, dt);
    this.lowS.step(this.lowTarget ? 1 : 0, 2.4, 0.9, dt);
    this.lowNow = clamp(this.lowS.x, 0, 1);
    // rope drawn toward the part of him that's growing - the bunched lower
    // loops, the flattened knot under a bar, the squashed bottom
    this.drift.step(this.crouchS.x * 0.05 + Math.max(0, this.sqLow.x) * 0.12 + this.lowNow * 0.035 + this.tallNow * 0.03, 3.5, 0.7, dt);
    this.moodStep(dt);
    this.roll(dt, air);
    this.slipStep(dt);
    this.build();
    this.shade();
    this.fibreStep(dt);
    this.eyeStep(dt);
    this.blur(dt);
    // the taut sheen
    this.mats.uniforms.uRopeK.value.w = this.ringTaut;
  }

  // Rolling: turned by exactly how far he's gone over the ground, about the
  // axis across his way (while he swings or flies, as his mind turns him).
  roll(dt, air) {
    if (this.turn) this.omega.lerp(this.turn, 1 - Math.exp(-dt * 30));
    else if (!air && this.mode !== 'sit') {
      const r = Math.max(0.1, this.cy || RADIUS);
      // ω = up × v / r
      _v.set(this.vel.z, 0, -this.vel.x).divideScalar(r);
      this.omega.lerp(_v, 1 - Math.exp(-dt * 40));
    } else if (this.mode === 'sit') this.omega.multiplyScalar(Math.exp(-dt * 6));
    else this.omega.multiplyScalar(Math.exp(-dt * 0.4));
    const w = this.omega.length();
    this.spun = w * dt;
    if (w > 1e-5) {
      _q.setFromAxisAngle(_v.copy(this.omega).divideScalar(w), w * dt);
      this.Q.premultiply(_q).normalize();
    }
  }

  // A loop now and then slips open or is drawn tighter, and springs back.
  slipStep(dt) {
    const moving = this.mode !== 'sit' || Math.random() < 0.3;
    this.slipT -= dt * (moving ? 1 : 0.5);
    if (this.slipT <= 0) {
      this.slipT = 1.6 + Math.random() * 3;
      this.slipNow(Math.random() < 0.6 ? 1 : -1, 0.6 + Math.random() * 0.5);
    }
    for (const s of this.slips) {
      if (!s.on) continue;
      s.hold -= dt;
      const want = s.hold > 0 ? s.sign * s.str : 0;
      const was = s.amp.v;
      s.amp.step(want, 2.8, 0.38, dt);
      // (let go: it snaps back, pulls taut - and the fibres on it shiver)
      if (s.hold <= 0 && s.hold + dt > 0) s.pulled = true;
      if (s.pulled && Math.sign(was) !== Math.sign(s.amp.v)) {
        s.pulled = false;
        this.kick(frac(s.k - this.kOff), 0.06, 0.7 * s.str);
      }
      if (s.hold < -1.5 && Math.abs(s.amp.x) < 0.01) s.on = false;
    }
  }

  // --- laying the rope out ------------------------------------------------------------------
  // The knot point at shape position k, rolled and reshaped, into out (root
  // space). sc: the knot's size now.
  knotPoint(k, out) {
    shapeAt(k, out);
    // loops slipping
    let dr = 0;
    for (const s of this.slips) {
      if (!s.on) continue;
      let d = Math.abs(k - s.k);
      d = Math.min(d, 1 - d);
      dr += s.amp.x * Math.exp(-(d * d) / 0.0011);
    }
    if (dr) out.multiplyScalar(1 + dr * (dr > 0 ? 0.13 : 0.07));
    out.multiplyScalar(this.sc).applyQuaternion(this.Q);
    // never quite still: slow waves run along the rope, loops breathing in
    // and out (much more so with the knot let loose), and a shiver through
    // it as it's loosened
    const t = this.time, lo = this.looseNow;
    const r = out.length() || 1;
    let wr = (0.024 * Math.sin(TAU * 3 * k - t * 2.3) + 0.017 * Math.sin(TAU * 5 * k + t * 1.7 + 1.3)) * (1 + 2.2 * lo);
    wr += lo * (0.2 + 0.08 * Math.sin(TAU * 7 * k + t * 15) + 0.05 * Math.sin(TAU * 11 * k - t * 9));
    out.multiplyScalar(1 + wr);
    // a lobe of him reaching out (to wave at you): whatever rope is on that
    // side of him is drawn out into it - as he rolls, the rope runs through
    // the lobe and the lobe stays put - wagging, a wave running out along it
    const A = this.armNow;
    if (A > 0.002) {
      const a = (out.x * this.armDir.x + out.y * this.armDir.y + out.z * this.armDir.z) / (r * (1 + wr));
      const w = smooth(0.55, 0.97, a);
      if (w > 0) {
        const along = (a - 0.55) / 0.45;
        out.addScaledVector(this.armDir, this.sc * A * w * w * 0.8);
        out.addScaledVector(this.armUp, this.sc * A * w * 0.34 * Math.sin(t * 12 - along * 4.5));
      }
    }
    return this.deform(out);
  }

  // His shape, in the world's up (p: from his middle, m; out: root space).
  deform(p) {
    const Rs = this.sc;
    const y = clamp(p.y / Rs, -1.3, 1.3);
    const t = clamp((y + 1) / 2, 0, 1);
    const sq = this.sqLow.x + (this.sqHigh.x - this.sqLow.x) * t * t;
    const c = this.crouchS.x;
    const lo = this.lowNow;
    const pu = this.push;
    let ys = y - sq * (y + 1) - c * 0.3 * (y + 1);
    let hs = 1 + sq * 0.5 * (1 - 0.3 * y * y) + c * 0.22 * smooth(0.3, -1, y);
    // pushing off: the lower loops thrust down against the ground
    ys -= pu * 0.3 * smooth(0.2, -1, y);
    hs *= 1 - pu * 0.08 * smooth(0.2, -1, y);
    // under a bar: low and wide, the top loops slipping out over his sides
    ys = ys * (1 - 0.46 * lo) - lo * 0.1 * smooth(0, 1, y);
    hs *= 1 + lo * (0.16 + 0.34 * smooth(-0.4, 0.9, y));
    // flying: drawn out a little along the way he's going up or down
    ys *= 1 + this.stretch;
    hs *= 1 - this.stretch * 0.5;
    // drawn up tall (a stretch), or let loose
    const tl = this.tallNow;
    ys = ys * (1 + 0.3 * tl) + 0.3 * tl;
    hs *= 1 - 0.15 * tl;
    p.x *= hs;
    p.z *= hs;
    // soft and heavy: his top lags behind his bottom as he speeds up, slows
    // down and turns, and wobbles back
    const lag = t * t * Rs;
    p.x += this.leanX.x * lag;
    p.z += this.leanZ.x * lag;
    p.y = ys * Rs + this.cy;
    if (this.grounded && p.y < 0.006) {
      // the contact patch: flattened against the ground, spread a little
      const e = 0.006 - p.y;
      p.y = 0.006 - e * 0.08;
      const k = 1 + (e / Rs) * 0.9;
      p.x *= k;
      p.z *= k;
    }
    return p;
  }

  build() {
    const air = this.mode === 'air';
    this.grounded = !air;
    this.sc = RADIUS * (1 - 0.55 * this.fed);
    this.push = this.pushT < 0.18 && air ? Math.sin((this.pushT / 0.18) * Math.PI) * 0.9 : 0;
    this.stretch = air && this.pushT > 0.12 ? clamp(this.vel.y * 0.012, -0.06, 0.08) : 0;
    // his middle's height: his bottom just on the ground (sunk a little
    // under his weight)
    // (and he's a knot, not a ball: whatever loop is lowest just now is what
    // he stands on, so he bumps along a little as he rolls)
    this.cy = 0;
    const save = this.grounded;
    this.grounded = false;
    let bot = 9;
    for (let i = 0; i < 64; i++) {
      this.knotPoint(i / 64, _v2);
      if (_v2.y < bot) bot = _v2.y;
    }
    this.grounded = save;
    const want = -(bot - ROPE) - (this.grounded ? 0.012 + Math.max(0, this.sqLow.x) * 0.03 : 0);
    this.cyS = this.cyS === undefined || !this.ready2 ? want : this.cyS + (want - this.cyS) * (1 - Math.exp(-(this.dtNow || 0.016) * 28));
    this.ready2 = true;
    this.cy = this.cyS;
    // where the rope runs: the material u along it to the knot's shape k
    // (the rope drawn toward the lowest part of him by drift)
    let low = 0, lowY = 9;
    for (let i = 0; i < 24; i++) {
      shapeAt(i / 24, _v).applyQuaternion(this.Q);
      if (_v.y < lowY) {
        lowY = _v.y;
        low = i / 24;
      }
    }
    const A = this.drift.x;
    const warp = (k) => k - (A * Math.sin(TAU * (k - low))) / TAU;
    this.ringStep();
    const w = this.fed;
    const C = this.C;
    for (let i = 0; i <= NR; i++) {
      const u = (i % NR) / NR;
      const m = frac(u - this.feedU + 0.5) - 0.5;
      if (w > 1e-4 && Math.abs(m) < w / 2) {
        this.ringPoint((m + w / 2) / w, _v);
      } else {
        const mm = w > 1e-4 ? m - Math.sign(m) * (w / 2) : m;
        const k = warp(this.feedK + mm / (1 - w));
        this.knotPoint(k, _v);
      }
      C[i * 3] = _v.x;
      C[i * 3 + 1] = _v.y;
      C[i * 3 + 2] = _v.z;
    }
    // (the ring's two ends leave him smoothly: eased where they join)
    if (w > 1e-4) {
      const j0 = Math.round(frac(this.feedU - w / 2) * NR), j1 = Math.round(frac(this.feedU + w / 2) * NR);
      for (let pass = 0; pass < 3; pass++) for (const j of [j0, j1]) for (let o = -5; o <= 5; o++) {
        const i = (j + o + NR) % NR, a = (i + NR - 1) % NR, b = (i + 1) % NR;
        for (let c = 0; c < 3; c++) C[i * 3 + c] += 0.4 * ((C[a * 3 + c] + C[b * 3 + c]) / 2 - C[i * 3 + c]);
      }
    }
    C[NR * 3] = C[0];
    C[NR * 3 + 1] = C[1];
    C[NR * 3 + 2] = C[2];
    this.frames();
    // his middle (root space), for his eyes and the hollow inside him
    this.mid = this.mid || new THREE.Vector3();
    this.mid.set(0, this.cy, 0);
  }

  // Tangents, and frames carried along the rope without twisting (the
  // little twist left over round the whole loop shared out along it).
  frames() {
    const C = this.C, T = this.T, N = this.N, B = this.B;
    for (let i = 0; i < NR; i++) {
      const a = (i + NR - 1) % NR, b = (i + 1) % NR;
      _v.set(C[b * 3] - C[a * 3], C[b * 3 + 1] - C[a * 3 + 1], C[b * 3 + 2] - C[a * 3 + 2]).normalize();
      T[i * 3] = _v.x;
      T[i * 3 + 1] = _v.y;
      T[i * 3 + 2] = _v.z;
    }
    // (the first frame tied to how he's turned, so the plies roll with him)
    _v.set(T[0], T[1], T[2]);
    _v2.set(0.3, 1, 0.2).applyQuaternion(this.Q);
    _v2.addScaledVector(_v, -_v2.dot(_v)).normalize();
    let nx = _v2.x, ny = _v2.y, nz = _v2.z;
    for (let i = 0; i <= NR; i++) {
      const j = i % NR;
      const tx = T[j * 3], ty = T[j * 3 + 1], tz = T[j * 3 + 2];
      const d = nx * tx + ny * ty + nz * tz;
      nx -= d * tx;
      ny -= d * ty;
      nz -= d * tz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      N[i * 3] = nx;
      N[i * 3 + 1] = ny;
      N[i * 3 + 2] = nz;
    }
    // the twist left over (ring NR came back round to ring 0)
    const n0 = _v.set(N[0], N[1], N[2]);
    const nE = _v2.set(N[NR * 3], N[NR * 3 + 1], N[NR * 3 + 2]);
    const t0 = _v3.set(T[0], T[1], T[2]);
    const cx = nE.y * n0.z - nE.z * n0.y, cy = nE.z * n0.x - nE.x * n0.z, cz = nE.x * n0.y - nE.y * n0.x;
    // (the frames stay as they are; the leftover twist is folded into the
    // angle round, so the pattern meets itself - see shade)
    this.twist = Math.atan2(cx * t0.x + cy * t0.y + cz * t0.z, nE.dot(n0));
    for (let i = 0; i <= NR; i++) {
      const j = i % NR;
      const tx = T[j * 3], ty = T[j * 3 + 1], tz = T[j * 3 + 2];
      const nx2 = N[i * 3], ny2 = N[i * 3 + 1], nz2 = N[i * 3 + 2];
      B[i * 3] = ty * nz2 - tz * ny2;
      B[i * 3 + 1] = tz * nx2 - tx * nz2;
      B[i * 3 + 2] = tx * ny2 - ty * nx2;
    }
  }

  // --- the ring he swings by ----------------------------------------------------------------
  // Fed out of the side of him facing where it's going; its length taken
  // from the knot (fed), which is drawn smaller to match.
  ringStep() {
    const out = clamp(this.ringOut, 0, 1);
    if (out <= 0.002) {
      // (all of it back in him: his mind draws it in by easing out to 0)
      this.ringOn = false;
      this.fed = 0;
      this.ringLen = 0;
      return;
    }
    const at = _v3.copy(this.ringAt).sub(this.root.position);
    if (!this.ringOn) {
      // where on him it comes from: the rope on his outside, facing it
      this.ringOn = true;
      _v2.copy(at).sub(_v.set(0, this.cy, 0)).normalize();
      let best = 0, score = -9;
      for (let i = 0; i < 96; i++) {
        const k = i / 96;
        shapeAt(k, _v).applyQuaternion(this.Q);
        const sc = _v.dot(_v2) + _v.length() * 0.6;
        if (sc > score) {
          score = sc;
          best = k;
        }
      }
      this.feedK = best;
      this.feedU = frac(best - this.kOff);
      this.wasTaut = 0;
    }
    // the point it leaves him from, and which way it goes
    this.knotPoint(this.feedK, this.E || (this.E = new THREE.Vector3()));
    const E = this.E;
    const dir = (this.ringDir ||= new THREE.Vector3());
    dir.copy(at).sub(E);
    const full = Math.max(0.05, dir.length());
    dir.divideScalar(full);
    // across: the hoop opens in the plane of his way and the world's x (so
    // from behind you see it face on), turned out away from the runner
    const side = (this.ringSide ||= new THREE.Vector3());
    side.set(1, 0, 0).addScaledVector(dir, -dir.x).normalize();
    const up = (this.ringUp ||= new THREE.Vector3());
    up.crossVectors(side, dir).normalize();
    const taut = clamp(this.ringTaut, 0, 1);
    if (taut > 0.5 && this.wasTaut <= 0.5) this.kick(this.feedU, Math.max(0.08, this.fed / 2 + 0.04), 1.3);
    this.wasTaut = taut;
    const X1 = Math.max(0.02, out * full);
    const tip = 0.075;
    const slack = (1 - taut) * smooth(0.1, 0.6, out);
    const W = 0.2 * slack;
    // the centreline: one leg out, round the far end, the other leg back
    const pts = (this.ringPts ||= new Float32Array(66 * 3));
    const L = (this.ringL ||= new Float32Array(66));
    const t = this.time;
    let n = 0;
    const put = (x, w, s) => {
      const k = x / X1;
      // (slack, it sags and wavers; taut, it's straight)
      const sag = slack * (0.05 * Math.sin(Math.PI * k) + 0.012 * Math.sin(t * 13 + k * 5) * Math.sin(Math.PI * k));
      pts[n * 3] = E.x + dir.x * x + side.x * w * s - up.x * sag;
      pts[n * 3 + 1] = E.y + dir.y * x + side.y * w * s - up.y * sag;
      pts[n * 3 + 2] = E.z + dir.z * x + side.z * w * s - up.z * sag;
      n++;
    };
    const legW = (x) => {
      const k = x / X1;
      return ROPE * 1.05 + (tip - ROPE * 1.05) * Math.min(1, k) + W * Math.pow(Math.sin(Math.PI * Math.min(k, 1)), 0.8);
    };
    for (let i = 0; i < 24; i++) put((i / 24) * X1, legW((i / 24) * X1), 1);
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      // round the far end: out over the point it's hooked on
      pts[n * 3] = E.x + dir.x * (X1 + sa * tip) + side.x * ca * tip;
      pts[n * 3 + 1] = E.y + dir.y * (X1 + sa * tip) + side.y * ca * tip;
      pts[n * 3 + 2] = E.z + dir.z * (X1 + sa * tip) + side.z * ca * tip;
      n++;
    }
    for (let i = 23; i >= 0; i--) put((i / 24) * X1, legW((i / 24) * X1), -1);
    this.ringN = n;
    L[0] = 0;
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
    this.ringLen = L[n - 1];
    // how much of him that is (the knot is drawn smaller by as much)
    this.fed = clamp(this.ringLen / LENGTH, 0, 0.34);
  }

  // The ring's centreline at v (0..1 along it, by length).
  ringPoint(v, out) {
    const pts = this.ringPts, L = this.ringL, n = this.ringN;
    const s = v * L[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L[mid] < s) lo = mid;
      else hi = mid;
    }
    const t = (s - L[lo]) / Math.max(1e-6, L[hi] - L[lo]);
    return out.set(pts[lo * 3] + (pts[hi * 3] - pts[lo * 3]) * t, pts[lo * 3 + 1] + (pts[hi * 3 + 1] - pts[lo * 3 + 1]) * t, pts[lo * 3 + 2] + (pts[hi * 3 + 2] - pts[lo * 3 + 2]) * t);
  }

  // --- light and shade --------------------------------------------------------------------------
  // The tube's vertices from the rings, and how each is shaded: shut in by
  // the rope round it (and the hollow inside him), and whether a loop over
  // it lies between it and the light. Cheap enough for every frame on a
  // phone: the rings sorted into a coarse grid, so each looks only at the
  // rope near it; and the shadows from a little depth map of him seen from
  // the light (each ring laid on it as a disc), as a shadow map would be.
  shade() {
    const C = this.C, T = this.T, N = this.N, B = this.B;
    const RV = SIDES + 1;
    const L = this.u.uLightDir.value;
    const r = ROPE;
    const skip = 5;
    const near = (j, k) => {
      const d = Math.abs(j - k);
      return Math.min(d, NR - d) < skip;
    };
    // the grid: cells as wide as rope reaches round itself to shut it in
    const reach = r * 3.8;
    const h = reach;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < NR; i++) {
      const x = C[i * 3], y = C[i * 3 + 1], z = C[i * 3 + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const gx = Math.min(24, Math.floor((x1 - x0) / h) + 1), gy = Math.min(24, Math.floor((y1 - y0) / h) + 1), gz = Math.min(24, Math.floor((z1 - z0) / h) + 1);
    const head = (this.gHead ||= new Int16Array(24 * 24 * 24));
    const next = (this.gNext ||= new Int16Array(NR));
    const cellOf = (this.gCell ||= new Int32Array(NR * 3));
    head.fill(-1, 0, gx * gy * gz);
    // (every other ring: the ones between take the mean of their two)
    for (let i = 0; i < NR; i += 2) {
      const cx = Math.min(gx - 1, Math.floor((C[i * 3] - x0) / h)), cy = Math.min(gy - 1, Math.floor((C[i * 3 + 1] - y0) / h)), cz = Math.min(gz - 1, Math.floor((C[i * 3 + 2] - z0) / h));
      cellOf[i * 3] = cx;
      cellOf[i * 3 + 1] = cy;
      cellOf[i * 3 + 2] = cz;
      const c = (cx * gy + cy) * gz + cz;
      next[i] = head[c];
      head[c] = i;
    }
    // each ring: which way the rope round it presses in, and how much (each
    // pair of rings looked at once, for both)
    const O = (this.ringO ||= new Float32Array((NR + 1) * 4));
    O.fill(0);
    const r2 = 2 * r, fall = reach - r2, R2 = reach * reach;
    for (let i = 0; i < NR; i += 2) {
      const px = C[i * 3], py = C[i * 3 + 1], pz = C[i * 3 + 2];
      const ci = cellOf[i * 3], cj = cellOf[i * 3 + 1], ck = cellOf[i * 3 + 2];
      const a1 = Math.min(gx - 1, ci + 1), b1 = Math.min(gy - 1, cj + 1), c1 = Math.min(gz - 1, ck + 1);
      for (let a = ci > 0 ? ci - 1 : 0; a <= a1; a++) {
        for (let b = cj > 0 ? cj - 1 : 0; b <= b1; b++) {
          for (let c = ck > 0 ? ck - 1 : 0; c <= c1; c++) {
            for (let j = head[(a * gy + b) * gz + c]; j >= 0; j = next[j]) {
              if (j <= i) continue;
              const di = j - i;
              if (di < skip || NR - di < skip) continue;
              const dx = C[j * 3] - px, dy = C[j * 3 + 1] - py, dz = C[j * 3 + 2] - pz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > R2) continue;
              const d = Math.sqrt(d2) || 1e-4;
              // (touching: full; a rope's width off: a little)
              let f = 1 - (d - r2) / fall;
              if (f > 1) f = 1;
              const k = f / d;
              O[i * 4] += dx * k;
              O[i * 4 + 1] += dy * k;
              O[i * 4 + 2] += dz * k;
              O[i * 4 + 3] += f;
              O[j * 4] -= dx * k;
              O[j * 4 + 1] -= dy * k;
              O[j * 4 + 2] -= dz * k;
              O[j * 4 + 3] += f;
            }
          }
        }
      }
    }
    for (let i = 1; i < NR; i += 2) {
      const a = i - 1, b = (i + 1) % NR;
      for (let c = 0; c < 4; c++) O[i * 4 + c] = (O[a * 4 + c] + O[b * 4 + c]) * 0.5;
    }
    for (let i = 0; i < NR; i++) {
      const ox = O[i * 4], oy = O[i * 4 + 1], oz = O[i * 4 + 2];
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      O[i * 4] = ox / ol;
      O[i * 4 + 1] = oy / ol;
      O[i * 4 + 2] = oz / ol;
    }
    // the shadows: him seen from the light, each ring a disc on a depth
    // map keeping the rope nearest the light (and which ring it is)
    let ex = 0, ey = 0, ez = 0;
    if (Math.abs(L.y) < 0.9) {
      ex = L.z;
      ez = -L.x;
    } else {
      ey = -L.z;
      ez = L.y;
    }
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el;
    ey /= el;
    ez /= el;
    const fx = L.y * ez - L.z * ey, fy = L.z * ex - L.x * ez, fz = L.x * ey - L.y * ex;
    const SM = 72;
    const cs = r * 0.7;
    const top = (this.smTop ||= new Float32Array(SM * SM));
    const who = (this.smWho ||= new Int16Array(SM * SM));
    top.fill(-1e9);
    const U = (this.smU ||= new Float32Array(NR * 3));
    let u0 = 1e9, v0 = 1e9;
    for (let i = 0; i < NR; i++) {
      const x = C[i * 3], y = C[i * 3 + 1], z = C[i * 3 + 2];
      U[i * 3] = x * ex + y * ey + z * ez;
      U[i * 3 + 1] = x * fx + y * fy + z * fz;
      U[i * 3 + 2] = x * L.x + y * L.y + z * L.z;
      if (U[i * 3] < u0) u0 = U[i * 3];
      if (U[i * 3 + 1] < v0) v0 = U[i * 3 + 1];
    }
    u0 -= r * 1.5;
    v0 -= r * 1.5;
    const span = Math.ceil(r / cs);
    for (let i = 0; i < NR; i++) {
      const cu = (U[i * 3] - u0) / cs, cv = (U[i * 3 + 1] - v0) / cs, d = U[i * 3 + 2];
      const iu = Math.round(cu), iv = Math.round(cv);
      for (let a = iu - span; a <= iu + span; a++) {
        if (a < 0 || a >= SM) continue;
        for (let b = iv - span; b <= iv + span; b++) {
          if (b < 0 || b >= SM) continue;
          const du = (a - cu) * cs, dv = (b - cv) * cs;
          const q = r * r - du * du - dv * dv;
          if (q <= 0) continue;
          const t = d + Math.sqrt(q);
          const k = a * SM + b;
          if (t > top[k]) {
            top[k] = t;
            who[k] = i;
          }
        }
      }
    }
    const S = this.ringShade;
    for (let i = 0; i < NR; i++) {
      // from the side of the ring facing the light
      const tx = T[i * 3], ty = T[i * 3 + 1], tz = T[i * 3 + 2];
      let lx = L.x, ly = L.y, lz = L.z;
      const dd = lx * tx + ly * ty + lz * tz;
      lx -= dd * tx;
      ly -= dd * ty;
      lz -= dd * tz;
      const ll = Math.hypot(lx, ly, lz) || 1;
      const px = C[i * 3] + (lx / ll) * r * 0.9, py = C[i * 3 + 1] + (ly / ll) * r * 0.9, pz = C[i * 3 + 2] + (lz / ll) * r * 0.9;
      const a = Math.round((px * ex + py * ey + pz * ez - u0) / cs), b = Math.round((px * fx + py * fy + pz * fz - v0) / cs);
      let sh = 0;
      if (a >= 0 && a < SM && b >= 0 && b < SM) {
        const k = a * SM + b;
        // (its own rope, or the rope just along from it, doesn't count)
        if (top[k] > -1e8 && !near(i, who[k])) sh = smooth(r * 0.25, r * 0.9, top[k] - (px * L.x + py * L.y + pz * L.z));
      }
      S[i] = sh;
    }
    S[NR] = S[0];
    O[NR * 4] = O[0];
    O[NR * 4 + 1] = O[1];
    O[NR * 4 + 2] = O[2];
    O[NR * 4 + 3] = O[3];
    // the vertices: round each ring
    const cyM = this.cy;
    const P = this.pos, Nr = this.nrm, Tn = this.tan, R4 = this.rope;
    const len = LENGTH;
    const tw = this.twist || 0;
    const cosA = (this.cosA ||= Float32Array.from({ length: RV }, (_, s) => Math.cos((s / SIDES) * TAU)));
    const sinA = (this.sinA ||= Float32Array.from({ length: RV }, (_, s) => Math.sin((s / SIDES) * TAU)));
    for (let i = 0; i <= NR; i++) {
      const j = i % NR;
      const cx = C[i * 3], cy = C[i * 3 + 1], cz = C[i * 3 + 2];
      // how deep inside him this ring lies (the inside of the knot is dark)
      const ox = cx, oy = cy - cyM, oz = cz;
      const od = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      const deep = smooth(this.sc * 0.95, this.sc * 0.55, od);
      const iod = 1 / od;
      const inK = 0.25 + 0.5 * deep;
      const ang0 = (i / NR) * -tw;
      const qx = O[i * 4], qy = O[i * 4 + 1], qz = O[i * 4 + 2], qa = O[i * 4 + 3];
      const lit = S[i];
      for (let s = 0; s <= SIDES; s++) {
        const ca = cosA[s], sa = sinA[s];
        const nx = N[i * 3] * ca + B[i * 3] * sa, ny = N[i * 3 + 1] * ca + B[i * 3 + 1] * sa, nz = N[i * 3 + 2] * ca + B[i * 3 + 2] * sa;
        const px = cx + nx * r, py = cy + ny * r, pz = cz + nz * r;
        const v = i * RV + s;
        P[v * 3] = px;
        P[v * 3 + 1] = py;
        P[v * 3 + 2] = pz;
        Nr[v * 3] = nx;
        Nr[v * 3 + 1] = ny;
        Nr[v * 3 + 2] = nz;
        Tn[v * 3] = T[j * 3];
        Tn[v * 3 + 1] = T[j * 3 + 1];
        Tn[v * 3 + 2] = T[j * 3 + 2];
        // shut in on the side the rope round it presses from
        let f = (nx * qx + ny * qy + nz * qz) * 0.85 + 0.25;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const ao = qa * f * 1.1;
        let occ = ao / (1 + ao);
        // facing in toward his middle, deep in him
        let inward = -(nx * ox + ny * oy + nz * oz) * iod;
        inward = inward < 0 ? 0 : inward * inK;
        if (inward > occ) occ = inward;
        // (and right down by the ground, the rope underneath)
        if (py < 0.05 && ny < 0) occ = Math.max(occ, 0.5 * (1 - py / 0.05) * -ny);
        R4[v * 4] = (i / NR) * len;
        R4[v * 4 + 1] = (s / SIDES) * TAU + ang0;
        R4[v * 4 + 2] = occ;
        let lf = (nx * L.x + ny * L.y + nz * L.z) * 2 + 1;
        lf = lf < 0 ? 0 : lf > 1 ? 1 : lf;
        R4[v * 4 + 3] = lit * lf;
      }
    }
    const g = this.geo.attributes;
    g.position.needsUpdate = true;
    g.normal.needsUpdate = true;
    g.aTan.needsUpdate = true;
    g.aRope.needsUpdate = true;
  }

  // --- the flyaways, frame by frame ------------------------------------------------------
  fibreStep(dt) {
    const C = this.C, T = this.T, N = this.N, B = this.B;
    const RV = SIDES + 1;
    const R4 = this.rope;
    const fp = this.fpos, fd = this.fdir, ff = this.ffib;
    // (how he's being thrown about, in his own frame: it swings them)
    const ax = -this.acc.x * 0.002, ay = -(this.acc.y + 0) * 0.002, az = -this.acc.z * 0.002;
    const midY = this.cy;
    for (let f = 0; f < NF; f++) {
      const F = this.fib[f];
      const x = F.u * NR;
      const i = Math.round(x) % NR;
      const cx = C[i * 3], cy = C[i * 3 + 1], cz = C[i * 3 + 2];
      const tx = T[i * 3], ty = T[i * 3 + 1], tz = T[i * 3 + 2];
      // out of the knot (or for the ring, up off it)
      let ox = cx, oy = cy - midY, oz = cz;
      if (this.fed > 0) {
        const m = frac(F.u - this.feedU + 0.5) - 0.5;
        if (Math.abs(m) < this.fed / 2) {
          ox = this.ringUp.x;
          oy = this.ringUp.y;
          oz = this.ringUp.z;
        }
      }
      const d = ox * tx + oy * ty + oz * tz;
      ox -= d * tx;
      oy -= d * ty;
      oz -= d * tz;
      const ol = Math.hypot(ox, oy, oz) || 1;
      ox /= ol;
      oy /= ol;
      oz /= ol;
      // turned round the rope by its angle
      const bx = ty * oz - tz * oy, by = tz * ox - tx * oz, bz = tx * oy - ty * ox;
      const ca = Math.cos(F.ang), sa = Math.sin(F.ang);
      const nx = ox * ca + bx * sa, ny = oy * ca + by * sa, nz = oz * ca + bz * sa;
      // which side of the tube that is, for how shut in it is there
      const na = Math.atan2(nx * B[i * 3] + ny * B[i * 3 + 1] + nz * B[i * 3 + 2], nx * N[i * 3] + ny * N[i * 3 + 1] + nz * N[i * 3 + 2]);
      const s = Math.round((((na % TAU) + TAU) % TAU / TAU) * SIDES) % SIDES;
      const occ = R4[(i * RV + s) * 4 + 2];
      // shown where it's out in the open (none pressed against rope)
      const show = clamp(1.25 - occ * 2.2, 0, 1);
      F.show += (show - F.show) * (1 - Math.exp(-dt * 10));
      // its tremble
      const fa = ax * bx + ay * by + az * bz, fb = ax * tx + ay * ty + az * tz;
      F.a.step(0, F.freq, 0.09, dt, fa * 400);
      F.b.step(0, F.freq * 1.13, 0.09, dt, fb * 400);
      const len = F.len * F.show;
      let px = cx + nx * ROPE * 0.9, py = cy + ny * ROPE * 0.9, pz = cz + nz * ROPE * 0.9;
      let dx = nx + tx * F.lean * 0.5, dy = ny + ty * F.lean * 0.5, dz = nz + tz * F.lean * 0.5;
      for (let k = 0; k < 3; k++) {
        const e = k / 2;
        // bending, and trembling more toward its tip
        let ex = dx + (bx * F.curl + bx * F.a.x + tx * F.b.x) * e * 0.6, ey = dy + (by * F.curl + by * F.a.x + ty * F.b.x) * e * 0.6, ez = dz + (bz * F.curl + bz * F.a.x + tz * F.b.x) * e * 0.6;
        // (a little droop under its own weight)
        ey -= 0.25 * e;
        const el = Math.hypot(ex, ey, ez) || 1;
        ex /= el;
        ey /= el;
        ez /= el;
        if (k > 0) {
          px += ex * len * 0.5;
          py += ey * len * 0.5;
          pz += ez * len * 0.5;
        }
        for (let e2 = 0; e2 < 2; e2++) {
          const j = f * 6 + k * 2 + e2;
          fp[j * 3] = px;
          fp[j * 3 + 1] = py;
          fp[j * 3 + 2] = pz;
          fd[j * 3] = ex;
          fd[j * 3 + 1] = ey;
          fd[j * 3 + 2] = ez;
          ff[j * 4 + 2] = 0.0022 * (0.2 + 0.8 * F.show);
        }
      }
    }
    const g = this.fibres.geometry.attributes;
    g.position.needsUpdate = true;
    g.aDir.needsUpdate = true;
    g.aFib.needsUpdate = true;
  }

  // --- his eyes, frame by frame ----------------------------------------------------------
  // How clear the view is from his eyes at a spot to the camera: the least
  // room between any rope and the line from each eye to it (m; < 0: the rope
  // is in the way), and that neither eye is in the rope.
  clearAt(mid, side, cam) {
    const C = this.C;
    let worst = 9;
    for (let e = -1; e <= 1; e += 2) {
      const ex = mid.x + side.x * e * EYE_SEP, ey = mid.y + side.y * e * EYE_SEP, ez = mid.z + side.z * e * EYE_SEP;
      let vx = cam.x - ex, vy = cam.y - ey, vz = cam.z - ez;
      const vl = Math.hypot(vx, vy, vz) || 1;
      vx /= vl;
      vy /= vl;
      vz /= vl;
      for (let i = 0; i < NR; i += 1) {
        const wx = C[i * 3] - ex, wy = C[i * 3 + 1] - ey, wz = C[i * 3 + 2] - ez;
        const t = wx * vx + wy * vy + wz * vz;
        const w2 = wx * wx + wy * wy + wz * wz;
        // in the eye itself
        if (w2 < (ROPE + EYE_R) * (ROPE + EYE_R)) return -1;
        if (t <= 0) continue;
        const d = Math.sqrt(Math.max(0, w2 - t * t)) - ROPE - EYE_R * 0.55;
        if (d < worst) worst = d;
      }
    }
    return worst;
  }

  eyeStep(dt) {
    const cam = _v3.copy(shared.uCamPos.value).sub(this.root.position);
    const mid = this.mid;
    // which way is toward you, and his eyes side by side as you see them
    const toCam = (this.toCam ||= new THREE.Vector3()).copy(cam).sub(mid).normalize();
    // where he'd like to be looking out from: wherever his eyes have got to
    // on their way round him (see orbitStep)
    const pref = this.orbitStep(dt, toCam);
    // (side by side across the way they look out: as they go round him,
    // you see them turn)
    this.eyeSide.crossVectors(_UP, this.eyeDir);
    if (this.eyeSide.lengthSq() < 0.04) this.eyeSide.crossVectors(_UP, toCam);
    this.eyeSide.normalize();
    // where his eyes are now (they ease from spot to spot, quick)
    const k = 1 - Math.exp(-dt * 16);
    this.eyeDir.lerp(this.eyeDirTo, k).normalize();
    this.eyeDepth += (this.eyeDepthTo - this.eyeDepth) * k;
    this.moveT += dt;
    const spot = (dir, depth, out) => this.deform(out.copy(dir).multiplyScalar(depth * this.sc));
    spot(this.eyeDir, this.eyeDepth, this.eyeMid);
    const clear = this.clearAt(this.eyeMid, this.eyeSide, cam);
    this.covered = clear < 0 ? Math.min(1, this.covered + dt * 8) : Math.max(0, this.covered - dt * 8);
    if (clear < 0) this.blocked += dt;
    else this.blocked = 0;
    this.peekT -= dt;
    // covered a moment: out through another opening; and now and then,
    // somewhere better (nearer toward you), or anywhere he can see you from
    // (spinning fast, the rope's a blur they show through - see blur - and
    // no opening holds still long enough to look out of: they stay put, a
    // little in from his surface, toward you)
    const fast = this.omega.length() > 7;
    if (fast) {
      this.eyeDirTo.copy(pref);
      this.eyeDepthTo = 0.5;
      this.blocked = 0;
    }
    const look = !fast && (this.blocked > 0.16 + Math.random() * 0.1 || this.peekT <= 0);
    if (look && this.moveT > 0.2) {
      const anywhere = false;
      this.peekT = 0.9 + Math.random() * 1.8;
      let best = null, bestS = this.blocked > 0 ? -9 : clear * 4 + this.eyeDir.dot(pref) * 0.8 + 0.15;
      for (const d of LOOKOUTS) {
        const al = d.dot(pref);
        // (an opening near where they're headed round him)
        if (al < 0.5) continue;
        for (const depth of [0.66, 0.56, 0.46, 0.34]) {
          spot(d, depth, _v2);
          const c = this.clearAt(_v2, this.eyeSide, cam);
          if (c < 0.004) continue;
          const sc = Math.min(c, 0.05) * 4 + al * (anywhere ? 0.1 : 0.8) + (anywhere ? Math.random() * 0.5 : 0) + depth * 0.5;
          if (sc > bestS) {
            bestS = sc;
            best = d;
            this.bestDepth = depth;
          }
        }
      }
      if (best && best.dot(this.eyeDirTo) < 0.995) {
        this.eyeDirTo.copy(best);
        this.eyeDepthTo = this.bestDepth;
        this.moveT = 0;
        this.blocked = 0;
      }
    }
    // blinks (and a squint as they move from one spot to the next)
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.15;
      this.blinkT = 2 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt);
    let open = this.blink > 0 ? 1 - Math.sin((this.blink / 0.15) * Math.PI) : 1;
    open = Math.min(open, 0.45 + 0.55 * smooth(0.04, 0.16, this.moveT));
    open *= 1 - 0.25 * clamp(this.earBias, 0, 1);
    // happy: a softer, rounder look (a little squint from beneath is drawn
    // by the lids closing a touch)
    open = Math.min(open, 1 - 0.12 * this.happy);
    // where they look: at the runner (and a share of the way toward you, so
    // you see his pupils), or right at it when he glances
    const at = this.gazeAt;
    for (let e = 0; e < 2; e++) {
      const m = this.eyeMeshes[e];
      const s = e ? 1 : -1;
      this.eyeAt[e].copy(this.eyeMid).addScaledVector(this.eyeSide, s * EYE_SEP);
      m.position.copy(this.eyeAt[e]);
      m.scale.setScalar(EYE_R);
      this.eyeThrough[e].position.copy(m.position);
      this.eyeThrough[e].scale.setScalar(EYE_R);
      const g = m.material.uniforms.uGaze.value;
      if (at) {
        _v.copy(at).sub(this.root.position).sub(this.eyeAt[e]).normalize();
        // (never so far round that you'd see only the whites from behind)
        const share = 0.62 - 0.32 * this.glance;
        _v.multiplyScalar(1 - share).addScaledVector(toCam, share).normalize();
      } else _v.copy(toCam).add(_v2.set(0, 0.1, 0)).normalize();
      // (eyes ease toward where they look: a glance is quick, not a snap)
      const gv = (m.userData.g ||= new THREE.Vector3().copy(_v));
      gv.lerp(_v, 1 - Math.exp(-dt * 14)).normalize();
      g.set(gv.x, gv.y, gv.z, open);
    }
    // the dark he's looking out of, just behind them
    _v.copy(this.eyeMid).addScaledVector(toCam, -EYE_R * 1.3).add(this.root.position);
    this.mats.hollow.uniforms.uHollowAt.value.set(_v.x, _v.y, _v.z, EYE_R * 2.5);
  }

  // Where his eyes are headed round him: a spot on a ball about him that
  // wanders - back toward you, round to your side, over his top, now and
  // then away on his far side (where you can't see them) - and that they
  // travel to, round him, rather than jump to. Returns the way out to it.
  orbitStep(dt, toCam) {
    const O = this.orbit;
    O.hold -= dt;
    O.forced -= dt;
    if (O.hold <= 0) {
      const r = Math.random(), s = this.runnerSide;
      if (r < 0.36) {
        O.azTo = Math.PI + (Math.random() - 0.5) * 1.3;
        O.elTo = 0.15 + Math.random() * 0.5;
      } else if (r < 0.64) {
        O.azTo = s * (Math.PI / 2 + (Math.random() - 0.3) * 0.9);
        O.elTo = 0.1 + Math.random() * 0.45;
      } else if (r < 0.78) {
        O.azTo = (Math.random() - 0.5) * 1.1;
        O.elTo = 0.2 + Math.random() * 0.3;
      } else if (r < 0.9) {
        O.azTo = O.az + (Math.random() - 0.5);
        O.elTo = 1.1 + Math.random() * 0.3;
      } else {
        O.azTo = -s * Math.PI / 2;
        O.elTo = 0.3;
      }
      O.hold = 1 + Math.random() * 2.4;
    }
    if (O.circle > 0) {
      // (right round him: on, at a steady pace)
      O.circle -= dt;
      O.az += O.circleDir * 3.3 * dt;
      O.azTo = O.az;
    }
    let d = O.azTo - O.az;
    d -= TAU * Math.round(d / TAU);
    O.az += clamp(d * 5 * dt, -3.4 * dt, 3.4 * dt);
    O.el += clamp((O.elTo - O.el) * 5 * dt, -2.4 * dt, 2.4 * dt);
    // the way he's going (sitting still: facing you)
    const fwd = (this.fwd ||= new THREE.Vector3(0, 0, -1));
    _w.set(this.vel.x, 0, this.vel.z);
    if (_w.lengthSq() > 1) fwd.lerp(_w.normalize(), 1 - Math.exp(-dt * 6)).normalize();
    else if (this.mode === 'sit') fwd.lerp(_w.set(-toCam.x, 0, -toCam.z).normalize(), 1 - Math.exp(-dt * 4)).normalize();
    _w2.crossVectors(fwd, _UP);
    const ce = Math.cos(O.el);
    return (this.prefV ||= new THREE.Vector3())
      .copy(fwd)
      .multiplyScalar(ce * Math.cos(O.az))
      .addScaledVector(_w2, ce * Math.sin(O.az))
      .addScaledVector(_UP, Math.sin(O.el))
      .normalize();
  }

  // The shutter's smear of his spin: the rope a moment back, turned about
  // his middle by a share of this frame's turn, see-through.
  blur() {
    const turn = this.spun * SHUTTER;
    const k = smooth(0.12, 0.6, turn);
    // how much of his eyes shows through the spinning rope: by how fast it
    // turns (not by the frame rate: the same at 30 frames a second as at 60)
    // (only from the side of him they're on: round the back of him, they're
    // hidden)
    const see = smooth(5, 16, this.omega.length()) * 0.72 * smooth(-0.15, 0.45, this.eyeDir.dot(this.toCam || _UP));
    for (const m of this.eyeThrough) {
      m.visible = see > 0.01;
      m.material.uniforms.uEyeA.value = see;
    }
    // (and the dark inside him with them)
    this.hollow.renderOrder = see > 0.01 ? 4 : 1;
    this.mats.hollow.depthTest = see < 0.3;
    this.mats.uniforms.uBlur.value = smooth(0.06, 0.4, turn);
    const w = this.omega.length();
    for (let i = 0; i < GHOSTS; i++) {
      const g = this.ghosts[i];
      g.visible = k > 0.01;
      if (!g.visible) continue;
      const a = -turn * ((i + 1) / GHOSTS);
      _q.setFromAxisAngle(_v.copy(this.omega).divideScalar(w || 1), a);
      _m.makeTranslation(0, -this.cy, 0);
      _m2.makeRotationFromQuaternion(_q).multiply(_m);
      _m.makeTranslation(0, this.cy, 0).multiply(_m2);
      g.material.uniforms.uGhost.value.copy(_m);
      g.material.uniforms.uGhostA.value = k * 0.34 * (1 - i / (GHOSTS + 0.5));
    }
  }

  after(z, dist, lowG = false) {
    this.dust.g = lowG ? 6 : 16;
    this.dust.update(this.lastDt, this.root, z, dist);
    this.lastDt = 0;
  }

  // --- placing him in the world ---------------------------------------------------------
  // pos: the bottom of him (where he meets the ground); q is his mind's
  // heading - he's a ball, he doesn't face anywhere (his eyes look at you).
  place(pos, q, ground = 0, shadow = 1) {
    this.root.position.copy(pos);
    this.root.quaternion.identity();
    this.root.scale.setScalar(1);
    const h = Math.max(0, pos.y - ground);
    const r = RADIUS * 1.35;
    let x0 = pos.x - r, x1 = pos.x + r, z0 = pos.z - r, z1 = pos.z + r, y1 = pos.y + RADIUS * 2.2;
    if (this.fed > 0) {
      // (the ring reaching out ahead casts its shadow too)
      const a = this.ringAt;
      x0 = Math.min(x0, a.x - 0.3);
      x1 = Math.max(x1, a.x + 0.3);
      z0 = Math.min(z0, a.z - 0.3);
      z1 = Math.max(z1, a.z + 0.3);
      y1 = Math.max(y1, a.y + 0.2);
    }
    this.cast.aim(x0, x1, pos.y - 0.05, y1, z0, z1, ground, pos.x, pos.z, {
      alpha: 0.95 * clamp(1 - h * 0.25, 0.45, 1) * shadow,
      contact: 0.45 * clamp(1 - h * 3, 0, 1) * shadow,
      reach: 0.24,
    });
  }

  renderShadow(renderer) {
    if (this.cast.casters.length === 0) this.cast.setCasters([this.root]);
    this.cast.render(renderer);
  }

  forCompile(on) {
    this.root.visible = true;
    this.shadow.visible = on;
    for (const g of this.ghosts) g.visible = on;
    this.dust.forCompile(on);
  }
}
