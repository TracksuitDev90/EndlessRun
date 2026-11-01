import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials } from '../render/shaders.js';
import { clamp, smooth, Spring } from './rig.js';
import { Cloth } from './cloth.js';
import { palette, setColliders, sheetGeometry, writeSheet } from './kit.js';
import { Player, C, mirror } from './player.js';
import { CONFIG } from '../config.js';
import { Spill } from './spill.js';
import { Dust } from './dust.js';

// The explorer: a slight girl with a shock of vermilion hair, her sweater's
// sleeves shoved up, a backpack full of odds and ends and her sketchbook in
// her hand (sculpted in tools/runner/explorer.py). On top of the shared
// runner (player.js):
//   - her long hair is simulated like the wayfarer's cape (cloth.js): a sheet
//     growing from under her bun round the back of her head, lying on her
//     scalp and falling past her shoulders; it streams in the headwind,
//     swings and lags with every lane change, flies up through a jump, slaps
//     down on landing and bounces with every stride. The bun, the fringe and
//     the locks framing her face bounce on springs;
//   - her backpack bounces on her back, and now and then its lid pops and
//     something flies out of it (see spill.js);
//   - she moves lighter than he does: a quicker spring between the lanes and
//     a side-skip into them, tricks in the air, and a baseball slide that
//     often kicks up dust (see dust.js).

// Palette slots: 1-12 are the garment ids baked into the mesh, the rest are
// colours the character shader draws her details with (see CHAR_DETAIL).
export const COL = {
  1: '#f7cba9', // face (skin)
  2: '#f0642c', // hair
  3: '#d6687a', // sweater
  4: '#f5a57f', // tee
  5: '#403e49', // shorts
  6: '#f7cba9', // legs (skin)
  7: '#efe7da', // trainers
  8: '#f7cba9', // hands (skin)
  9: '#706e72', // backpack
  10: '#f0642c', // long hair
  11: '#93b08d', // sketchbook
  12: '#3d3c42', // straps, spiral
  13: '#f4a585', // the band across the chest
  14: '#c2566a', // ribbing
  15: '#e88aa0', // socks
  16: '#8b8a91', // trainers' grey panels
  17: '#f4eee2', // soles
  18: '#9a958f', // soles' grey stripe
  19: '#7a7980', // laces
  20: '#c9461d', // hair, deep
  21: '#b13e1a', // hair, inside
  22: '#fcf8f3', // eye whites, pages
  23: '#2aa46c', // irises (green)
  24: '#221516', // lashes, brows, pupils
  25: '#b0564c', // mouth
  26: '#f39a8e', // blush
  27: '#d9c640', // irises (gold ring)
  28: '#2c2b33', // shorts' seams
  29: '#4b494e', // zips, the pack's inside
  30: '#ff9d5c', // hair highlight
  31: '#e9bb8e', // plaster
};

// The long hair: cols x rows particles; u runs across (0 at her left front,
// round the back, 1 at her right), v down from the roots to the tips.
export const HAIR = {
  cols: 15,
  rows: 12,
  reach: 1.82, // how far round the head the hair grows (radians each way from the back)
  rootBack: 0.98, // the roots' elevation on the head behind (just under the bun)...
  rootSide: 0.42, // ...and at the temples
  leaveBack: -0.55, // where it leaves the head behind (the nape)...
  leaveSide: -0.05, // ...and at the sides (by the ears)
  tipBack: 0.985, // the tips' height behind (the shoulder blades)...
  tipSide: 1.03, // ...and in front of the shoulders
  thick: 0.0085, // half its depth, before the taper (see VS_CHAR)
  subU: 3,
  subV: 2,
  margin: 0.007, // how far it is kept off every surface
};

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _hd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _dh = new THREE.Vector3();
const _dp = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _dq = new THREE.Vector3();

// The rest fall of the hair, built the way it would lie: each column from its
// roots under the bun down over the back of the head along the scalp, then
// hanging past the neck and flaring a little over the shoulders to its tips -
// then let fall under gravity onto the body's own volumes.
function hairBind(rig, colliders) {
  const { cols, rows } = HAIR;
  const [c, r] = rig.cran;
  const t = rig.hairThick;
  const pts = new Float32Array(cols * rows * 3);
  const dir = (th, e, out) => out.set(Math.sin(th) * Math.cos(e), Math.sin(e), Math.cos(th) * Math.cos(e));
  const path = [];
  for (let i = 0; i < cols; i++) {
    const u = (i / (cols - 1)) * 2 - 1;
    const th = u * HAIR.reach;
    const side = Math.abs(u);
    const s14 = Math.pow(side, 1.4);
    const e0 = HAIR.rootBack + (HAIR.rootSide - HAIR.rootBack) * s14;
    const e1 = HAIR.leaveBack + (HAIR.leaveSide - HAIR.leaveBack) * side;
    path.length = 0;
    for (let k = 0; k <= 24; k++) {
      const e = e0 + ((e1 - e0) * k) / 24;
      // (the roots tucked just under the sculpted cap)
      const lift = t + (k === 0 ? -0.006 : 0.001);
      dir(th, e, _hd);
      path.push(new THREE.Vector3(c[0] + (r[0] + lift) * _hd.x, c[1] + (r[1] + lift) * _hd.y, c[2] + (r[2] + lift) * _hd.z));
    }
    const last = path[path.length - 1];
    const tip = HAIR.tipBack + (HAIR.tipSide - HAIR.tipBack) * side;
    const drop = last.y - tip;
    const hx = Math.sin(th), hz = Math.cos(th);
    for (let k = 1; k <= 30; k++) {
      const f = k / 30;
      const fl = (0.045 - 0.03 * (1 - side)) * smooth(0, 0.6, f);
      path.push(new THREE.Vector3(last.x + hx * fl, last.y - drop * f, last.z + hz * fl));
    }
    let total = 0;
    const acc = [0];
    for (let k = 1; k < path.length; k++) acc.push((total += path[k].distanceTo(path[k - 1])));
    for (let j = 0; j < rows; j++) {
      const s = (j / (rows - 1)) * total;
      let k = 1;
      while (k < acc.length - 1 && acc[k] < s) k++;
      const f = (s - acc[k - 1]) / Math.max(1e-6, acc[k] - acc[k - 1]);
      _v.copy(path[k - 1]).lerp(path[k], Math.min(1, f)).toArray(pts, (j * cols + i) * 3);
    }
  }
  // let it fall into place on her head and shoulders
  const cloth = new Cloth(cols, rows, pts);
  setColliders(cloth, colliders, null, null, HAIR.margin);
  cloth.place((v) => v);
  for (let i = 0; i < cols * 3; i++) cloth.pinA[i] = cloth.pinB[i] = pts[i];
  const f = { gx: 0, gy: -9.8, gz: 0, ax: 0, ay: 0, az: 0, wake: 0, draw: 0, gust: 0, gustSpeed: 1, gustLen: 1, curl: 0, kn: 0.2, kt: 0.05, damp: 6, floor: -10, lift: 0.3, t: 0 };
  for (let k = 0; k < 150; k++) {
    f.t += 1 / 60;
    cloth.step(1 / 60, f);
  }
  return Float32Array.from(cloth.p);
}

// How she runs: a quicker, lighter cadence on a narrower track, less bounce
// and more lean - she skims the road where he strides it - her free arm
// swinging lightly, the one with the sketchbook held closer.
const GAIT = {
  cadence: [1.68, 0.058],
  stride: { reach: 0.55, hipY: 0.662, bob: 0.02, trackX: 0.05, swingX: 0.07, toeOut: 0.03, heelLift: 0.82, ballZ: -0.03 },
  swing: [
    [0.16, 0.34, 0.31, 0.03, 0.04],
    [0.4, 0.17, 0.47, 0.0, 0.09],
    [0.65, -0.16, 0.37, -0.04, 0.03],
    [0.84, -0.27, 0.24, -0.02, 0.0],
  ],
  arm: {
    swing: [0.14, 0.46, 0.54, 0.34, -0.1, -0.42, -0.5, -0.3],
    abd: [0.3, 0.26, 0.25, 0.28, 0.31, 0.34, 0.35, 0.33],
    elbow: [1.25, 1.55, 1.7, 1.5, 1.15, 0.95, 0.9, 1.05],
    amp: [0.8, 0.2],
  },
  lean: [0.22, 0.12],
  hipYaw: 0.16,
  hipRoll: 0.055,
  spTwist: 0.14,
  chTwist: 0.1,
};

// How she handles: a quicker spring between the lanes and a deeper lean into
// them; the same jump as his - the same apex and airtime, so every gap is as
// fair - but shaped differently (see fall): she pops up, hangs at the top and
// drops.
const FEEL = {
  laneSpring: 40,
  lean: [0.045, 0.5],
  turn: [0.03, 0.42],
  blend: [5, 6, 7],
};
// The jump's arc: gravity eases off to HANG of itself while she's within
// APEX m/s of the top. G and V0 are solved so the apex and airtime match the
// plain arc's (CONFIG.jump).
const HANG = 0.42;
const APEX = 3.2;
function solveArc(H, T) {
  // rise: (V0 - APEX) / G + APEX / (HANG G) = T / 2;
  // (V0^2 - APEX^2) / 2G + APEX^2 / (2 HANG G) = H
  const a = APEX, k = a / HANG, h = a * a / HANG;
  // V0 = G T/2 - k + a  ->  2 H G = V0^2 - a^2 + h
  const c1 = T / 2, c0 = a - k;
  const A = c1 * c1, Bq = 2 * c1 * c0 - 2 * H, Cq = c0 * c0 - a * a + h;
  const G = (-Bq + Math.sqrt(Bq * Bq - 4 * A * Cq)) / (2 * A);
  return { G, V0: G * c1 + c0 };
}

// Her tricks in the air, dealt so the same one never comes twice running:
// a split leap, a tucked front flip, a corkscrew twist.
const TRICKS = ['leap', 'flip', 'leap', 'twist', 'flip', 'twist'];

export class Explorer extends Player {
  constructor(envDef, asset) {
    super(envDef, asset, { gait: GAIT, feel: FEEL });
  }

  configure() {
    super.configure();
    const J = this.feel.jump;
    const arc = solveArc(J.height, J.time);
    this.G = arc.G;
    this.V0 = arc.V0;
    this.GH = arc.G * HANG;
  }

  // In the air: gravity eases off near the top - solved exactly piece by
  // piece, so the arc is the same at any frame rate.
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

  buildLook() {
    const R = this.rig;
    const rig = [
      new THREE.Vector4(R.sockTop, R.shoeX, R.bunchU, R.shortsHem),
      new THREE.Vector4(R.shoeCollar[0], R.shoeCollar[1], R.soleH, R.kneeY),
      new THREE.Vector4(R.stripe[0], R.stripe[1], R.hem, 0),
    ];
    // the hair's particles, as the shader reads them (runner space)
    this.hairData = new Float32Array(HAIR.cols * HAIR.rows * 4);
    this.hairTex = new THREE.DataTexture(this.hairData, HAIR.cols, HAIR.rows, THREE.RGBAFormat, THREE.FloatType);
    this.hairTex.magFilter = this.hairTex.minFilter = THREE.NearestFilter;
    this.hairTex.needsUpdate = true;
    const grid = new THREE.Vector4(HAIR.cols, HAIR.rows, HAIR.thick, 0);
    const mats = makeCharacterMaterials(this.u, palette(COL), rig, 0.0095, { texture: this.hairTex, grid }, { style: 'explorer' });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.hairMat = mats.capeMat;
    this.hairInkMat = mats.capeInk;
    this.buildBody();
    this.buildHair();
    this.spill = new Spill(this.u);
    this.dust = new Dust(this.u);
  }

  get objects() {
    return [this.root, this.shadow, this.spill.group, this.dust.points];
  }

  forCompile(on) {
    this.spill.forCompile(on);
    this.dust.forCompile(on);
  }

  buildHair() {
    this.hairDefs = this.rig.cloth.map((c) => ({ ...c }));
    this.hairRest = hairBind(this.rig, this.hairDefs);
    const geo = sheetGeometry(HAIR, this.hairRest, this.asset.meta.materials.hairSheet);
    this.hairMesh = new THREE.Mesh(geo, this.hairMat);
    this.hairInk = new THREE.Mesh(geo, this.hairInkMat);
    for (const m of [this.hairMesh, this.hairInk]) {
      m.frustumCulled = false;
      m.renderOrder = -20;
      this.root.add(m);
    }
  }

  buildSim() {
    super.buildSim();
    // the long hair: the roots sewn to the head; the rows lying over the
    // scalp leashed to where the head carries them, tightly at the crown and
    // looser toward the nape; free from there down
    const { cols, rows } = HAIR;
    const cl = (this.sheet = new Cloth(cols, rows, this.hairRest));
    let s = 0;
    for (let j = 1; j < rows; j++) {
      const a = ((j - 1) * cols + (cols >> 1)) * 3, b = (j * cols + (cols >> 1)) * 3;
      s += Math.hypot(this.hairRest[a] - this.hairRest[b], this.hairRest[a + 1] - this.hairRest[b + 1], this.hairRest[a + 2] - this.hairRest[b + 2]);
      cl.leash[j] = s < 0.2 ? 0.002 + 3.5 * Math.max(0, s - 0.07) ** 2 : Infinity;
    }
    cl.frontOff = 0.2;
    cl.setColliderCount(this.hairDefs.length);
    this.hairFold = new Float32Array(cols * rows);
    this.wind = { gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0, wake: 0.3, draw: 0.5, gust: 0, gustSpeed: 1, gustLen: 1, curl: 0, kn: 0, kt: 0, damp: 0.6, floor: 0, lift: 0.25, t: 0 };
    this.headM = new THREE.Matrix4();
    this.headPrev = new THREE.Vector3();
    // the backpack riding on her back: a bounce, a nod and a sway on springs
    const P = this.rig.pack;
    this.packBind = new THREE.Vector3().copy(this.b.pack.position);
    this.packY = new Spring();
    this.packPitch = new Spring();
    this.packRoll = new Spring();
    this.lidS = new Spring();
    this.packTop = new THREE.Vector3(P.c[0], P.c[1] + P.half[1] - 0.01, P.c[2]);
  }

  resetSim() {
    super.resetSim();
    this.sheet.collidersMoved = false;
    this.packY.reset();
    this.packPitch.reset();
    this.packRoll.reset();
    this.lidS.reset();
    this.lidKick = 0;
    this.spins = {
      pitch: { value: 0, from: 0, to: 0, t: 0, delay: 0, dur: 1, pivot: 0.78, pivotTo: 0.78 },
      yaw: { value: 0, from: 0, to: 0, t: 0, delay: 0, dur: 1, pivot: 0, pivotTo: 0 },
    };
    this.deck = this.deck || [];
    this.trick = this.trick || '';
    this.dodgeT = 9;
    this.dodgeDir = 1;
    // the backpack's spills: how many are waiting to fly, how gently, and
    // the timers between them
    this.spillWant = 0;
    this.spillSoft = 0;
    this.spillT = 4 + Math.random() * 5;
    this.spillCool = 0;
    this.lastDt = 0;
    this.spill?.clear();
    this.dust?.clear();
    this.dustPlan = null;
    this.landedAt = -9;
  }

  // --- the backpack spilling -------------------------------------------------------
  // n things fly out (soft: gently, as when she's standing about).
  spillOut(n = 1, soft = false) {
    this.spillWant = Math.min(6, this.spillWant + n);
    this.spillSoft = soft ? 1 : 0;
    this.lidKick += soft ? 6 : 10;
    this.spillCool = 1.2;
  }

  // Throw one of them: from the pack's mouth, at her own speed plus a toss
  // up and back (in her own space).
  throwOne() {
    _v.copy(this.packTop).applyMatrix4(this.boneM('pack'));
    const soft = this.spillSoft;
    const r = Math.random;
    _p.set(this.vx, this.grounded ? 0 : this.vy, -this.speed).applyQuaternion(this.invQ);
    _p.x += (r() - 0.5) * (soft ? 1.2 : 2.6);
    _p.y += soft ? 2.6 + r() * 1.2 : 3.6 + r() * 2.2;
    _p.z += soft ? 0.6 + r() * 0.6 : 1.2 + r() * 2.2;
    this.spill.throw(_v, _p);
  }

  stumble() {
    super.stumble();
    this.spillOut(2);
  }

  crash() {
    super.crash();
    this.spillOut(4);
  }

  greet() {
    this.spillOut(1, true);
  }

  update(dt, speed, groundAt) {
    this.lastDt = dt;
    super.update(dt, speed, groundAt);
    // now and then the lid works loose by itself
    this.spillCool -= dt;
    this.spillT -= dt;
    if (this.spillT <= 0) {
      const running = this.mode === 'run' && !this.crashed && speed > 1;
      if (running) this.spillOut(1);
      else if (this.mode !== 'run') this.spillOut(1, true);
      this.spillT = running ? 6 + Math.random() * 7 : 8 + Math.random() * 7;
    }
  }

  place(z, dist = 0) {
    super.place(z);
    this.spill.update(this.lastDt, this.root, z, dist);
    this.dust.update(this.lastDt, this.root, z, dist);
    this.lastDt = 0;
  }

  // --- moves -------------------------------------------------------------------
  // A spin of the whole body (pitch: a flip, about pivot m up; yaw: a twist
  // about her own axis): eased from one angle to the next over dur seconds
  // after a delay; cut short, it whips round to finish quickly.
  spinTo(axis, turns, delay, dur, pivot) {
    const S = this.spins[axis];
    const TAU = Math.PI * 2;
    S.from = S.value;
    // (always at least half a turn still to go: a spin taken up again
    // part-way round carries on instead of snapping back)
    S.to = Math.ceil((S.value + Math.PI) / TAU) * TAU + (Math.abs(turns) - 1) * TAU;
    if (turns < 0) S.to = Math.floor((S.value - Math.PI) / TAU) * TAU - (Math.abs(turns) - 1) * TAU;
    S.t = 0;
    S.delay = delay;
    S.dur = dur;
    if (pivot !== undefined) S.pivotTo = pivot;
  }

  hurry(axis, dur = 0.14) {
    const S = this.spins[axis];
    if (S.value === S.to) return;
    S.from = S.value;
    S.t = 0;
    S.delay = 0;
    S.dur = dur;
  }

  jump() {
    super.jump();
    // deal the next trick from a shuffled deck: never the same twice running
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
    const T = this.feel.jump.time;
    if (this.trick === 'flip') this.spinTo('pitch', 1, 0.07, T * 0.68, 0.78);
    else this.hurry('pitch', 0.18); // (a flip still going round: finish it on the way up)
    if (this.trick === 'twist') this.spinTo('yaw', this.jumpSide, 0.05, T * 0.72);
    this.onJump();
  }

  // A baseball slide, leading with the other leg each time (base: slideSide
  // flips with every fresh slide). Now and then it kicks up dust - always
  // when she drops straight out of the air into it.
  startSlide() {
    const fresh = this.slideT <= 0;
    super.startSlide();
    this.hurry('pitch', 0.1);
    this.hurry('yaw', 0.1);
    if (!fresh) return;
    const fromAir = this.time - this.landedAt < 0.05;
    const r = Math.random();
    if (!fromAir && r < 0.35) this.dustPlan = null;
    else this.dustPlan = { t: 0, hit: false, next: 0, burst: fromAir || r > 0.75 ? 4 : 2, grit: fromAir ? 8 : 5, trail: fromAir || r > 0.75 ? 1 : 0.55 };
  }

  onDodge(dir) {
    this.dodgeT = 0;
    this.dodgeDir = dir;
  }

  onFastFall() {
    this.hurry('pitch');
    this.hurry('yaw');
  }

  onLand() {
    this.landedAt = this.time;
    this.hurry('pitch', 0.1);
    this.hurry('yaw', 0.1);
    // a hard landing jolts the lid open now and then
    if (!this.crashed && this.spillCool <= 0 && Math.random() < 0.22) this.spillOut(1);
  }

  onJump() {}

  // --- poses -------------------------------------------------------------------
  poseJump(j, t) {
    if (this.trick === 'flip') return this.poseTuck(j, 0.8);
    if (this.trick === 'twist') return this.poseTwist(j);
    return this.poseLeap(j);
  }

  // A split leap: the lead leg reaching out straight in front, the other
  // stretched out behind, arms flung up and out, chest lifted - folding back
  // together to land.
  poseLeap(j) {
    const fall = clamp(-this.vy / this.V0 + 0.3, 0, 1);
    const fs = fall * fall * (3 - 2 * fall);
    const m = (a, b) => a + (b - a) * fs;
    j[C.hipY] = this.HIP_Y;
    j[C.hipX] = 0;
    j[C.hipYaw] = m(-0.12, 0);
    j[C.hipRoll] = 0;
    j[C.hipPitch] = m(0.0, 0.06);
    j[C.spLean] = m(-0.05, 0.14);
    j[C.spTwist] = m(0.1, 0);
    j[C.spSide] = 0;
    j[C.chLean] = m(-0.18, 0.0);
    j[C.chTwist] = m(0.06, 0);
    j[C.chSide] = 0;
    j[C.hdPitch] = m(-0.1, 0.12);
    j[C.hdYaw] = 0;
    j[C.hdRoll] = 0;
    j[C.thLx] = m(1.45, 0.75);
    j[C.knL] = m(0.12, 0.7);
    j[C.anL] = m(-0.35, 0.2);
    j[C.toL] = 0;
    j[C.thRx] = m(-0.85, 0.35);
    j[C.knR] = m(0.25, 0.95);
    j[C.anR] = m(-0.5, 0.12);
    j[C.toR] = m(0.25, 0);
    j[C.thLz] = m(0.02, 0.08);
    j[C.thRz] = m(0.02, 0.1);
    j[C.shLx] = m(1.1, 0.4);
    j[C.shLz] = m(1.25, 0.95);
    j[C.shLy] = 0;
    j[C.elL] = m(0.2, 0.4);
    j[C.shRx] = m(0.9, 0.3);
    j[C.shRz] = m(1.05, 0.9);
    j[C.shRy] = 0;
    j[C.elR] = m(0.5, 0.6);
    j[C.clL] = m(0.18, 0.08);
    j[C.clR] = m(0.15, 0.08);
    j[C.wrL] = -0.2;
    j[C.wrR] = 0.1;
    j[C.wrLz] = 0.1;
    j[C.wrRz] = 0;
    j[C.bodyPitch] = 0;
    j[C.bodyZ] = 0;
    j[C.bodyRoll] = 0;
    j[C.sq] = 1;
    if (this.jumpSide < 0) mirror(j);
  }

  // Tucked into a ball: knees to her chest, arms wrapped round her shins,
  // chin down (k: how tight). A flip turns about it.
  poseTuck(j, k) {
    j[C.hipY] = this.HIP_Y - 0.12 * k;
    j[C.hipX] = 0;
    j[C.hipYaw] = 0;
    j[C.hipRoll] = 0;
    j[C.hipPitch] = 0.1 * k;
    j[C.spLean] = 0.75 * k;
    j[C.spTwist] = 0;
    j[C.spSide] = 0;
    j[C.chLean] = 0.35 * k;
    j[C.chTwist] = 0;
    j[C.chSide] = 0;
    j[C.hdPitch] = 0.45 * k;
    j[C.hdYaw] = 0;
    j[C.hdRoll] = 0;
    j[C.thLx] = 2.05 * k;
    j[C.thRx] = 1.95 * k;
    j[C.knL] = 2.35 * k;
    j[C.knR] = 2.3 * k;
    j[C.anL] = 0.45 * k;
    j[C.anR] = 0.4 * k;
    j[C.toL] = 0;
    j[C.toR] = 0;
    j[C.thLz] = 0.14;
    j[C.thRz] = 0.14;
    j[C.thLy] = 0;
    j[C.thRy] = 0;
    j[C.shLx] = 0.95 * k;
    j[C.shRx] = 0.85 * k;
    j[C.shLz] = 0.3;
    j[C.shRz] = 0.34;
    j[C.shLy] = 0.25;
    j[C.shRy] = 0.25;
    j[C.elL] = 1.5 * k;
    j[C.elR] = 1.6 * k;
    j[C.clL] = 0.05;
    j[C.clR] = 0.05;
    j[C.clLy] = 0.12;
    j[C.clRy] = 0.12;
    j[C.wrL] = 0.3;
    j[C.wrR] = 0.3;
    j[C.wrLz] = 0;
    j[C.wrRz] = 0;
    j[C.bodyPitch] = 0;
    j[C.bodyZ] = 0;
    j[C.bodyRoll] = 0;
    j[C.sq] = 1;
  }

  // A corkscrew: drawn up straight and narrow - legs together, toes
  // pointed, arms pulled in to her chest - opening out again to land.
  poseTwist(j) {
    const fall = clamp(-this.vy / this.V0 + 0.15, 0, 1);
    const fs = fall * fall * (3 - 2 * fall);
    const m = (a, b) => a + (b - a) * fs;
    j[C.hipY] = this.HIP_Y;
    j[C.hipX] = 0;
    j[C.hipYaw] = 0;
    j[C.hipRoll] = 0;
    j[C.hipPitch] = 0;
    j[C.spLean] = m(-0.05, 0.12);
    j[C.spTwist] = 0;
    j[C.spSide] = 0;
    j[C.chLean] = m(-0.08, 0.02);
    j[C.chTwist] = 0;
    j[C.chSide] = 0;
    j[C.hdPitch] = m(-0.05, 0.1);
    j[C.hdYaw] = 0;
    j[C.hdRoll] = 0;
    j[C.thLx] = m(0.12, 0.6);
    j[C.thRx] = m(0.2, 0.45);
    j[C.knL] = m(0.15, 0.9);
    j[C.knR] = m(0.35, 0.8);
    j[C.anL] = m(-0.55, 0.15);
    j[C.anR] = m(-0.5, 0.1);
    j[C.toL] = 0;
    j[C.toR] = 0;
    j[C.thLz] = m(-0.04, 0.1);
    j[C.thRz] = m(-0.04, 0.1);
    j[C.shLx] = m(0.75, 0.3);
    j[C.shRx] = m(0.8, 0.3);
    j[C.shLz] = m(0.12, 0.9);
    j[C.shRz] = m(0.12, 0.85);
    j[C.shLy] = 0;
    j[C.shRy] = 0;
    j[C.elL] = m(2.0, 0.4);
    j[C.elR] = m(1.9, 0.5);
    j[C.clL] = 0;
    j[C.clR] = 0;
    j[C.wrL] = 0.2;
    j[C.wrR] = 0.2;
    j[C.wrLz] = 0;
    j[C.wrRz] = 0;
    j[C.bodyPitch] = 0;
    j[C.bodyZ] = 0;
    j[C.bodyRoll] = 0;
    j[C.sq] = 1;
  }

  // The baseball slide: down on her hip, the lead leg out straight with its
  // heel to the road and toe up, the other folded under its knee; leaning
  // back, chin up, her free hand trailing on the road and the sketchbook held
  // up high out of the dirt - rattling over the road, then popping back up
  // onto her feet. (Posed leading with the left leg; mirrored for the right,
  // all but the arms: the book stays up.)
  poseSlide(s, t) {
    const u = 1 - clamp(this.slideT / CONFIG.slide.time, 0, 1);
    const pop = smooth(0.68, 1, u);
    const rattle = (Math.sin(t * 47) * 0.6 + Math.sin(t * 29 + 1.3) * 0.4) * (1 - pop);
    s[C.hipY] = 0.19 + 0.006 * rattle + 0.24 * pop;
    s[C.hipX] = 0;
    s[C.hipYaw] = 0.2 * (1 - pop);
    s[C.hipRoll] = 0.26 * (1 - pop);
    s[C.hipPitch] = -0.32 + 0.38 * pop;
    s[C.spLean] = -0.8 + 1.15 * pop + 0.02 * rattle;
    s[C.spTwist] = -0.2 * (1 - pop);
    s[C.spSide] = -0.14 * (1 - pop);
    s[C.chLean] = -0.16 + 0.18 * pop;
    s[C.chTwist] = -0.1 * (1 - pop);
    s[C.chSide] = 0;
    s[C.hdPitch] = -0.95 + 0.85 * pop;
    s[C.hdYaw] = -0.12 * (1 - pop);
    s[C.hdRoll] = 0.06;
    // legs: the lead one out straight, the other tucked under it
    s[C.thLx] = 1.42 - 0.75 * pop;
    s[C.knL] = 0.06 + 0.9 * pop;
    s[C.anL] = 0.5 - 0.3 * pop;
    s[C.toL] = 0;
    s[C.thLz] = 0.05;
    s[C.thLy] = 0;
    s[C.thRx] = 0.62 + 0.3 * pop;
    s[C.knR] = 2.25 - 0.9 * pop;
    s[C.anR] = 0.35;
    s[C.toR] = 0.2;
    s[C.thRz] = -0.1 + 0.15 * pop;
    s[C.thRy] = 0;
    s[C.bodyPitch] = 0;
    s[C.bodyZ] = 0;
    s[C.bodyRoll] = 0;
    s[C.sq] = 1;
    if (this.slideSide < 0) mirror(s);
    // arms: the free hand trailing on the road, the book held up high;
    // both come forward for balance as she pops up
    s[C.shLx] = -0.5 + 1.0 * pop;
    s[C.shLz] = 0.95 - 0.5 * pop;
    s[C.shLy] = 0;
    s[C.elL] = 0.15 + 0.6 * pop;
    s[C.wrL] = -0.6;
    s[C.wrLz] = 0.1;
    s[C.clL] = 0;
    s[C.clLy] = -0.1;
    s[C.shRx] = 2.45 - 1.9 * pop;
    s[C.shRz] = 0.32;
    s[C.shRy] = 0;
    s[C.elR] = 0.4 + 0.7 * pop;
    s[C.wrR] = 0.3;
    s[C.wrRz] = 0;
    s[C.clR] = 0.22 * (1 - pop);
    s[C.clRy] = 0.15 * (1 - pop);
  }

  // Standing: the shared idle, a little lighter on her feet.
  poseIdle(id, t) {
    const ws = super.poseIdle(id, t);
    id[C.hipY] += 0.008;
    id[C.shLz] -= 0.1;
    id[C.shRz] -= 0.06;
    id[C.elR] += 0.12;
    return ws;
  }

  // Running, the sketchbook arm swings less and stays bent.
  poseRun(r, f, sp) {
    super.poseRun(r, f, sp);
    r[C.shRx] = 0.45 * r[C.shRx] + 0.12;
    r[C.elR] = 0.6 * r[C.elR] + 0.55;
    r[C.shRz] += 0.04;
    r[C.wrR] = -0.1;
  }

  // Lighter landings: a quick soft crouch, arms out to balance.
  landOverlay(Pz, land) {
    Pz[C.hipY] -= 0.07 * land;
    Pz[C.knL] += 0.38 * land;
    Pz[C.knR] += 0.38 * land;
    Pz[C.thLx] += 0.2 * land;
    Pz[C.thRx] += 0.2 * land;
    Pz[C.anL] += 0.2 * land;
    Pz[C.anR] += 0.2 * land;
    Pz[C.spLean] += 0.18 * land;
    Pz[C.shLz] += 0.45 * land;
    Pz[C.shRz] += 0.45 * land;
    Pz[C.elL] -= 0.3 * land;
    Pz[C.elR] -= 0.3 * land;
    Pz[C.sq] -= 0.04 * land;
  }

  // A side-skip: a hop off the outside foot, leaning hard into it, arms
  // flung out for balance, the head whipping round to look where she goes.
  laneOverlay(Pz, lc, dt) {
    super.laneOverlay(Pz, lc, dt);
    this.dodgeT += dt;
    const e = this.dodgeT < 0.3 ? Math.sin((this.dodgeT / 0.3) * Math.PI) : 0;
    const d = this.dodgeDir;
    Pz[C.hipY] += 0.05 * e * this.w.run;
    Pz[C.spSide] -= 0.14 * lc;
    Pz[C.chSide] -= 0.08 * lc;
    Pz[C.hdRoll] += 0.18 * lc;
    Pz[C.shLz] += 0.35 * e;
    Pz[C.shRz] += 0.35 * e;
    Pz[C.elL] -= 0.3 * e;
    Pz[C.elR] -= 0.2 * e;
    // the legs spread toward the move, then draw together
    Pz[d > 0 ? C.thRz : C.thLz] += 0.22 * e * this.w.run;
    Pz[d > 0 ? C.thLz : C.thRz] -= 0.08 * e * this.w.run;
  }

  // The spins go on after the pose: about her hips for a flip, about her own
  // axis for a twist.
  afterPose(dt, cw) {
    const P = this.spins.pitch, Y = this.spins.yaw;
    P.pivot += (P.pivotTo - P.pivot) * (1 - Math.exp(-14 * dt));
    for (const S of [P, Y]) {
      if (S.value === S.to) continue;
      S.t += dt;
      const u = clamp((S.t - S.delay) / S.dur, 0, 1);
      const e = u * u * (3 - 2 * u);
      S.value = u >= 1 ? S.to : S.from + (S.to - S.from) * e;
    }
    // (a crash takes over: let the spins go)
    const live = 1 - cw;
    const pitch = (P.value % (Math.PI * 2)) * live;
    const yaw = (Y.value % (Math.PI * 2)) * live;
    if (pitch === 0 && yaw === 0) return;
    const b = this.body;
    _e.set(pitch, yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    b.quaternion.premultiply(_q);
    _p.set(0, P.pivot, 0);
    _v.copy(_p).applyQuaternion(_q);
    b.position.applyQuaternion(_q).add(_p).sub(_v);
  }

  // --- secondary motion: backpack, long hair ---------------------------------------
  simulate(dt) {
    this.packStep(dt);
    // (one a frame, so a burst comes out in a stream)
    if (this.spillWant > 0 && this.b.packLid.rotation.x > 0.25) {
      this.throwOne();
      this.spillWant--;
    }
    this.dustStep(dt);
    this.hairStep(dt);
  }

  // Dust off the slide: a burst as she hits the road - puffs at her heel and
  // her hip, grit flung up off the heel - then a trail of puffs from her hip
  // as she skids. Thrown with a share of her own speed: the still air stops
  // them and she slides on out of the cloud.
  dustStep(dt) {
    const P = this.dustPlan;
    if (!P) return;
    if (!this.sliding || this.crashed || !this.grounded) {
      this.dustPlan = null;
      return;
    }
    P.t += dt;
    const u = 1 - this.slideT / CONFIG.slide.time;
    const r = Math.random;
    const heel = _dh.setFromMatrixPosition(this.b[this.slideSide > 0 ? 'footL' : 'footR'].matrixWorld);
    heel.y = 0.06;
    heel.z -= 0.08;
    const hip = _dp.setFromMatrixPosition(this.b.hips.matrixWorld);
    hip.y = 0.08;
    hip.z += 0.05;
    const run = _dv.set(this.vx, 0, -this.speed).applyQuaternion(this.invQ);
    if (!P.hit && P.t > 0.06) {
      P.hit = true;
      for (let k = 0; k < P.burst; k++) {
        // (out to either side of her, so the cloud shows round her)
        const at = k % 2 ? hip : heel;
        const side = k % 2 ? 1 : -1;
        _p.copy(run).multiplyScalar(0.3 + 0.15 * r());
        _p.x += side * (0.6 + r() * 1.2);
        _p.y += 0.5 + r() * 0.9;
        this.dust.emit(_v.copy(at).add(_dq.set(side * (0.12 + 0.12 * r()), 0, (r() - 0.5) * 0.15)), _p, 0.32 + 0.14 * r());
      }
      for (let k = 0; k < P.grit; k++) {
        _p.copy(run).multiplyScalar(0.55 + 0.2 * r());
        _p.x += (r() - 0.5) * 3.2;
        _p.y += 1.8 + r() * 2.2;
        this.dust.emit(_v.copy(heel), _p, 0.05 + 0.03 * r(), true);
      }
    }
    if (P.hit && u < 0.68) {
      P.next -= dt;
      if (P.next <= 0) {
        P.next = (0.055 + 0.05 * r()) / P.trail;
        _p.copy(run).multiplyScalar(0.25);
        _p.x += (r() - 0.5) * 2.0;
        _p.y += 0.3 + r() * 0.6;
        this.dust.emit(_v.copy(r() < 0.6 ? hip : heel).add(_dq.set((r() - 0.5) * 0.4, 0, 0)), _p, 0.25 + 0.1 * r());
      }
    }
  }

  // The backpack bounces on her back with every stride (a drop and a nod as
  // each foot lands), swings with her lane changes, and its lid pops open
  // when something is about to fly out.
  packStep(dt) {
    const b = this.b;
    const dv = this.pelvisD, dp = this.pelvisDP;
    const live = 1 - (this.crashW || 0);
    const up = (dv.y * 0.6 + dp.y) * live;
    this.packY.v -= up * 0.35;
    this.packPitch.v += up * 2.2 - dv.z * 0.2 * live;
    this.packRoll.v -= (dv.x * 0.35 + dp.x) * 2.4 * live;
    const y = clamp(this.packY.step(0, 6.5, 0.2, dt), -0.025, 0.025);
    const pitch = clamp(this.packPitch.step(0, 4.5, 0.18, dt), -0.28, 0.28);
    const roll = clamp(this.packRoll.step(0, 3.6, 0.22, dt), -0.25, 0.25);
    b.pack.position.set(this.packBind.x, this.packBind.y + y, this.packBind.z);
    b.pack.rotation.set(pitch, 0, roll);
    this.lidS.v += this.lidKick;
    this.lidKick = 0;
    const lid = clamp(this.lidS.step(0, 3.2, 0.3, dt), 0, 1.1);
    b.packLid.rotation.x = lid + 0.08 * Math.max(0, -pitch);
    b.pack.updateMatrix();
    b.pack.matrixWorld.multiplyMatrices(b.chest.matrixWorld, b.pack.matrix);
    b.packLid.updateMatrix();
    b.packLid.matrixWorld.multiplyMatrices(b.pack.matrixWorld, b.packLid.matrix);
  }

  // The long hair. Simulation space has world axes and its origin at the
  // runner. Hair is lighter in the air than wool and quicker to answer every
  // push: it streams back in the headwind (further as the pace rises), flies
  // up as she leaps and falls, whips across with a lane change and bounces
  // with every stride.
  hairStep(dt) {
    const cl = this.sheet;
    const Q = this.root.quaternion;
    const t = this.time;
    const W = this.speed;
    const { cols, rows } = HAIR;
    const Mh = this.headM.copy(this.boneM('head'));
    const rest = this.hairRest;
    for (let k = 0; k < cols * rows; k++) {
      _v.fromArray(rest, k * 3).applyMatrix4(Mh).applyQuaternion(Q).toArray(cl.skin, k * 3);
    }
    cl.pinB.set(cl.skin.subarray(0, cols * 3));
    setColliders(cl, this.hairDefs, this.boneM, Q, HAIR.margin);
    const f = this.wind;
    f.gx = -this.frameAcc.x * 0.3;
    f.gy = Math.min(-3.5, -8.2 - this.frameAcc.y * 0.24);
    f.gz = -this.frameAcc.z * 0.35;
    const B = this.breeze;
    const still = 1 + 1.2 * (1 - Math.min(1, W / 6));
    f.ax = clamp(-this.vx * 0.38, -5.5, 5.5) + B.x * (1.1 + 0.03 * W) * still;
    f.ay = clamp(-(this.grounded ? 0 : this.vy) * 0.42, -4, 3) + B.y * still;
    f.az = (W > 0 ? 0.92 * W + 1 : 0) + B.z * still;
    f.gust = 0.45 * still + 0.12 * W;
    f.gustSpeed = 1.4 + 0.3 * W;
    f.gustLen = 0.5 + 0.01 * W;
    f.curl = 0.7 * still + 0.16 * W;
    f.kn = 0.5;
    f.kt = 0.18;
    f.damp = 0.65;
    f.floor = Math.min(this.groundY || 0, this.y) - this.y + HAIR.margin;
    f.groundV = W;
    f.lift = 0.25;
    f.t = t;
    // carry the hair with a third of the head's own bob: the rest bounces on
    _v.setFromMatrixPosition(this.b.head.matrixWorld).applyQuaternion(Q);
    if (this.simReady) cl.shift((_v.x - this.headPrev.x) * 0.35, (_v.y - this.headPrev.y) * 0.35, (_v.z - this.headPrev.z) * 0.35);
    this.headPrev.copy(_v);
    if (!this.simReady) {
      cl.place((v) => v.applyMatrix4(Mh).applyQuaternion(Q));
      cl.pinA.set(cl.pinB);
      cl.skinPrev.set(cl.skin);
      f.t = t - 0.75;
      for (let i = 0; i < 45; i++) {
        f.t += 1 / 60;
        cl.step(1 / 60, f);
      }
    } else {
      cl.step(dt, f);
    }
    writeSheet(cl, this.hairData, this.hairFold, this.invQ);
    this.hairTex.needsUpdate = true;
  }
}
