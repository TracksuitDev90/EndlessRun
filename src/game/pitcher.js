import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials, makeEnvUniforms } from '../render/shaders.js';
import { palette, bodyGeometry } from './kit.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { CastShadow } from '../render/caster.js';
import { Dust } from './dust.js';

// Nep, the pitcher plant who runs with you: the body and how it moves.
// Sculpted offline (tools/runner/pitcher.py): a squat pear of a pitcher with
// a scalloped coral rim round its mouth and a dark hollow inside where his
// eyes are, water standing in it; a big floppy leaf over the mouth on a
// hooked stem; tendril arms, a sprig of little leaves, root feet. Drawn with
// the runners' illustrated shader (PITCHER in CHAR_DETAIL).
//
// Nothing here decides where he goes - that's his mind (sprout.js, built on
// the runners' companion.js), which hands him a place in the world, how fast
// he's moving over the ground, what he's doing each frame and his flourishes
// (act: totter, shake, bask, flail, sway). This module turns that into a
// plant doing his best to keep up, drawn half as big again as he's sculpted:
//   - a waddle: unhurried steps on short root feet, his round body bobbing
//     up on every step and rocking from root to root - top-heavy, so the
//     rocking is a loose spring and he wobbles on after it; leaning into his
//     run and into his turns; tottering, shaking himself off, basking with
//     his face to the sun, flailing as he hurries, swaying as he dances;
//   - his leaf on springs: flopping with every step, lifted by the headwind
//     and on a jump, slapped down on a landing, swinging out through a turn
//     and lagging behind his twirls - and now and then lifted on purpose,
//     when he's curious, to peek out from under it;
//   - his tendril arms bouncing as chains of springs, flung up when he
//     jumps or he's pleased;
//   - the water in him sloshing as a damped pendulum (tipped by every push,
//     turn and stop, heaved by every step and jolt), spilling over the rim
//     where it rises too high: drops and splashes on the run, more on a
//     sharp turn, a burst on a jump or a landing, flung out in a ring when he
//     twirls or shakes, and whenever a wobble dips his rim;
//   - chunky crumbs of soil shaken loose from his roots on every footfall,
//     trailing behind him; a scatter of them when he lands.

export const COL = {
  1: '#a9c93a', // the pitcher: lime
  2: '#e88470', // the rim: coral pink
  3: '#1a110d', // the hollow
  4: '#79a63a', // a leaf
  5: '#7d9f2c', // the vines
  6: '#8a5a33', // the roots
  7: '#1f3a37', // the water, dark in the hollow
  13: '#e9e55c', // yellow: his middle, a leaf's heart
  14: '#f2ef8a', // the growth lines
  15: '#8f8a28', // freckles
  16: '#c65a5e', // the rim's deep
  17: '#f7ae98', // the rim's light
  18: '#c9df7c', // veins
  19: '#a8c768', // a leaf, beneath
  20: '#a65629', // rust
  21: '#c47b2c', // the tendrils' tips
  22: '#4f311c', // bark, dark
  23: '#b88a5c', // bark, light
  24: '#f6d75a', // eyes
  25: '#fff4bd', // eyes, their hearts
  26: '#5d8a26', // deep green
  27: '#a9e3d6', // glints on the water
  28: '#d6a43a', // the eyes' glow in the dark
  30: '#f6f7c4', // sheen
};

// He's sculpted small and drawn half as big again: big enough to read his
// water and his soil from behind the runner.
export const SCALE = 1.5;

const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _ax = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

// A spring with a force on it (a damped oscillator, semi-implicit: steady at
// any frame time): x is pulled to its target and pushed by f.
class Sway {
  constructor() {
    this.x = 0;
    this.v = 0;
  }
  step(target, freq, zeta, f, dt) {
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

export class Pitcher {
  constructor(env, asset) {
    this.asset = asset;
    this.rig = asset.meta.rig;
    this.u = makeEnvUniforms(env);
    this.root = new THREE.Group();
    this.root.name = 'pitcher';
    this.buildSkeleton();
    this.buildLook();
    this.buildShadow();
    this.dust = new Dust(this.u, 240);
    this.S = {};
    for (const k of ['lift', 'leafRoll', 'leafYaw', 'tip', 'stem', 'sprigX', 'sprigZ', 'heave', 'slX', 'slZ', 'squash', 'yaw', 'lean', 'side', 'wobR', 'wobP']) this.S[k] = new Sway();
    this.arms = [0, 1].map(() => Array.from({ length: 3 }, () => ({ up: new Sway(), fwd: new Sway() })));
    this.wS = { run: new Spring(), stand: new Spring(1), sit: new Spring(), air: new Spring() };
    this.w = { run: 0, stand: 1, sit: 0, air: 0 };
    this.low = new Spring();
    this.faceU.value.set(1, 0, 0, 0);
    // his flourishes, set by his mind (sprout.js): totter, shake, bask,
    // flail, sway (0..1) and swayDir, idle
    this.act = {};
    this.reset();
  }

  // --- skeleton -------------------------------------------------------------------
  buildSkeleton() {
    const bones = [];
    this.b = {};
    for (const d of this.asset.meta.bones) {
      const b = new THREE.Bone();
      b.name = d.name;
      b.position.fromArray(d.p);
      b.quaternion.fromArray(d.q);
      if (d.parent) this.b[d.parent].add(b);
      bones.push(b);
      this.b[d.name] = b;
    }
    this.bones = bones;
    this.body = this.b.body;
    this.root.add(this.body);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.bind = {};
    for (const b of bones) this.bind[b.name] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    this.rest = {};
    for (const b of bones) this.rest[b.name] = b.position.clone();
    const B = this.bind;
    // each hip, where it sits on the pot (pot space), and the leg's rest
    // offset to the ankle
    this.legs = ['L', 'R'].map((L, i) => ({
      L,
      s: i === 0 ? -1 : 1,
      hip: B['leg' + L].clone().sub(B.pot),
      leg: B['foot' + L].clone().sub(B['leg' + L]),
      len: B['foot' + L].distanceTo(B['leg' + L]),
      ankle: B['foot' + L].clone(),
      plant: new THREE.Vector3(),
      lift: 0,
    }));
    const M = this.rig.mouth;
    this.mouthC = new THREE.Vector3().fromArray(M.c).sub(B.pot);
    this.mouthN = new THREE.Vector3().fromArray(M.n);
    this.mouthR = M.r;
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    this.faceU = { value: new THREE.Vector4(1, 0, 0, 0) };
    const mats = makeCharacterMaterials(this.u, palette(COL), [], 0.0075, null, { style: 'pitcher', uniforms: { uFace: this.faceU } });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    const geo = bodyGeometry(this.asset);
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.inkMesh = new THREE.SkinnedMesh(geo, this.inkMat);
    for (const m of [this.mesh, this.inkMesh]) {
      m.frustumCulled = false;
      m.renderOrder = -20;
      this.root.add(m);
    }
    this.root.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.inkMesh.bind(this.skeleton, this.mesh.bindMatrix);
  }

  // His shadow: the shape of him this frame, leaf and all, thrown along the
  // world's light (render/caster.js).
  buildShadow() {
    this.cast = new CastShadow(this.u, { res: 160 });
    this.shadow = this.cast.mesh;
  }

  renderShadow(renderer) {
    if (this.cast.casters.length === 0) this.cast.setCasters([this.root]);
    this.cast.render(renderer);
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points];
  }

  reset() {
    this.time = 0;
    this.phase = 0;
    this.speed = 0;
    this.mode = 'sit';
    this.airT = 0;
    this.airDur = 1;
    this.airKind = 'leap';
    this.landClock = 9;
    this.landHit = 0;
    this.happy = 0;
    this.wag = 0;
    this.earBias = 0;
    this.lowTarget = 0;
    this.jawOpen = 0;
    this.snapT = 9;
    this.blinkT = 2;
    this.blink = 0;
    this.lookAt = null;
    this.lookW = 0;
    this.spin = 0;
    this.wet = 0;
    this.lat = 0;
    this.curl = 0;
    this.crouch = 0;
    this.crouchKind = 'leap';
    this.peekT = 3;
    this.peek = 0;
    this.twitch = [9, 9];
    this.vel = new THREE.Vector3();
    this.velS = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.accL = new THREE.Vector3();
    this.ready = false;
    this.prevYaw = null;
    this.yawRate = 0;
    this.spillAcc = 0;
    this.crumbAcc = 0;
    this.lastDt = 0;
    this.lastStep = [0, 0];
    for (const k in this.wS) this.wS[k].reset(k === 'sit' ? 1 : 0);
    for (const s of Object.values(this.S)) s.reset();
    for (const a of this.arms) for (const j of a) j.up.reset(), j.fwd.reset();
    this.low.reset();
    this.dust?.clear();
    this.root.visible = true;
  }

  // --- the frame ----------------------------------------------------------------------
  // ctx (as the fox's): { speed: m/s over the ground, vel: world velocity,
  // mode: 'run' | 'air' | 'sit' | 'stand' | 'ride', airT / airDur / airKind
  // while in the air, fall: his gravity while he's falling free, lat:
  // sideways speed, crouch: 0..1 winding up for a jump (crouchKind), curl:
  // how far into a twirl }
  update(dt, ctx) {
    this.time += dt;
    this.lastDt += dt;
    const t = this.time;
    this.speed = ctx.speed;
    this.mode = ctx.mode === 'ride' ? 'stand' : ctx.mode;
    this.lat = ctx.lat || 0;
    this.curl = ctx.curl || 0;
    this.crouch = ctx.crouch || 0;
    this.crouchKind = ctx.crouchKind || 'leap';
    if (ctx.vel) {
      if (!this.ready) this.velS.copy(ctx.vel);
      _v.copy(this.velS);
      this.velS.lerp(ctx.vel, 1 - Math.exp(-dt * 30));
      if (dt > 0) this.acc.subVectors(this.velS, _v).divideScalar(dt).clampLength(0, 80);
      // (in free fall nothing pushes on him but his own weight)
      this.acc.y += ctx.fall || 0;
      this.vel.copy(ctx.vel);
      this.ready = true;
    }
    if (this.mode === 'air') {
      this.airT = ctx.airT;
      this.airDur = ctx.airDur;
      this.airKind = ctx.airKind;
    }
    this.landClock += dt;
    this.snapT += dt;
    // how he turns (a twirl flings the water out)
    const yaw = this.rootYaw();
    if (this.prevYaw !== null && dt > 0) {
      let d = yaw - this.prevYaw;
      d -= TAU * Math.round(d / TAU);
      this.yawRate += (d / dt - this.yawRate) * (1 - Math.exp(-dt * 20));
    }
    this.prevYaw = yaw;
    // the waddle: unhurried steps, a little quicker the faster he goes (and
    // in a flap when he's hurrying to catch up)
    const run = this.mode === 'run';
    this.freq = clamp(1.5 + 0.11 * this.speed, 1.7, 3.9) * (1 + 0.45 * (this.act.flail || 0));
    const ph0 = this.phase;
    this.phase = (this.phase + dt * (run ? this.freq : 0)) % 1;
    this.stepped = run ? [crossed(ph0, this.phase, 0), crossed(ph0, this.phase, 0.5)] : [false, false];

    // blinks; a happy squint
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.14;
      this.blinkT = 1.6 + Math.random() * 4 + (Math.random() < 0.2 ? -1.2 : 0);
    }
    this.blink = Math.max(0, this.blink - dt);
    const bl = this.blink > 0 ? Math.sin((this.blink / 0.14) * Math.PI) : 0;
    // (startled, his eyes go narrow; looking at something, they look at it)
    const lx = this.lookAt ? clamp(-this.lookAt.x / Math.max(0.3, Math.hypot(this.lookAt.x, this.lookAt.z)), -1, 1) * this.lookW : 0;
    const ly = this.lookAt ? clamp(this.lookAt.y / Math.max(0.5, Math.hypot(this.lookAt.x, this.lookAt.z)), -1, 1) * this.lookW : 0;
    this.faceU.value.set(clamp(1 - bl * 1.2, 0, 1) * (1 - 0.35 * clamp(this.earBias, 0, 1)), clamp(Math.max(this.happy, (this.act.bask || 0) * 1.2), 0, 1), -lx, ly);

    // now and then he lifts his leaf to peek out from under it
    this.peekT -= dt;
    if (this.peekT <= 0) {
      this.peekT = 2.5 + Math.random() * 5;
      this.peekDur = 0.5 + Math.random() * 0.6;
      this.peekAt = t;
    }
    this.peek = this.peekAt !== undefined && t - this.peekAt < this.peekDur ? Math.sin(((t - this.peekAt) / this.peekDur) * Math.PI) : 0;

    this.animate(dt, t);
  }

  rootYaw() {
    _v.set(0, 0, -1).applyQuaternion(this.root.quaternion);
    return Math.atan2(-_v.x, -_v.z);
  }

  // A landing of strength k (1 a plain leap).
  land(k = 1) {
    this.landClock = 0;
    this.landHit = k;
    this.landed = true;
  }

  // Shut his leaf on a gem (caught in his mouth).
  snap() {
    this.snapT = 0;
    this.snapped = true;
  }

  // A twitch (of the leaf, or an arm).
  flick(i) {
    this.twitch[i] = 0;
  }

  animate(dt, t) {
    const m = this.mode;
    const W = this.wS;
    let tr = 0, ts = 0, tsit = 0, ta = 0;
    if (m === 'run') {
      const k = smooth(0.3, 1.6, this.speed);
      tr = k;
      ts = 1 - k;
    } else if (m === 'air') ta = 1;
    else if (m === 'sit') tsit = 1;
    else ts = 1;
    const w = this.w;
    w.run = Math.max(0, W.run.step(tr, 5, 0.9, dt));
    w.stand = Math.max(0, W.stand.step(ts, 4, 0.9, dt));
    w.sit = Math.max(0, W.sit.step(tsit, 2.5, 0.95, dt));
    w.air = Math.max(0, W.air.step(ta, 8, 0.85, dt));
    const tot = w.run + w.stand + w.sit + w.air || 1;
    const run = w.run / tot, sit = w.sit / tot, air = w.air / tot;
    const low = this.low.step(this.lowTarget || 0, 3.5, 0.9, dt);
    const S = this.S;
    const b = this.b;
    const ph = this.phase * TAU;
    const sp = clamp(this.speed / 20, 0, 1.3);

    // --- the pot: bobbing up on every step, rocking from foot to foot ---
    // (into the root's frame: his own acceleration, for everything that
    // swings, sloshes and flops)
    _qi.copy(this.root.quaternion).invert();
    const acc = this.accL.copy(this.acc).applyQuaternion(_qi);
    const A = this.act;
    const tot_ = A.totter || 0, shk = A.shake || 0, bask = A.bask || 0, sway = A.sway || 0, idle = A.idle || 0;
    const bob = run * (0.016 + 0.012 * Math.min(sp, 1)) * Math.abs(Math.sin(ph));
    // he rocks from root to root - and it doesn't stop when the step does:
    // he's top-heavy, full of water, and wobbles on (a loosely damped
    // spring, so every step and every push sets him swaying)
    const rockT = run * (0.17 + 0.06 * Math.min(sp, 1)) * Math.sin(ph) + 0.06 * this.wag * Math.sin(t * 9)
      + tot_ * 0.34 * Math.sin(t * 5.4) + sway * 0.3 * (A.swayDir || 0) + idle * 0.13 * Math.sin(t * 2.3)
      + shk * 0.12 * Math.sin(t * TAU * 6.5 + 1);
    const rock = clamp(S.wobR.step(rockT, 2.1, 0.16, -acc.x * 0.05, dt), -0.5, 0.5);
    const waddle = run * 0.12 * Math.sin(ph + 0.4) + 0.05 * this.wag * Math.sin(t * 9 + 1) + shk * 0.6 * Math.sin(t * TAU * 6.5)
      + sway * 0.25 * (A.swayDir || 0) + idle * 0.12 * Math.sin(t * 1.15 + 0.5);
    // leaning into his run (and into a turn, against its pull), and back
    // when he pulls up; back to turn his face to the sun; nodding about
    // when he totters
    const leanT = run * (0.1 + 0.08 * Math.min(sp, 1)) + clamp(-acc.z * 0.012, -0.2, 0.2) - 0.08 * sit - 0.28 * bask + tot_ * 0.13 * Math.sin(t * 3.7) + idle * 0.05 * Math.sin(t * 4.6);
    const lean = clamp(S.lean.step(leanT, 1.9, 0.22, 0, dt), -0.45, 0.45);
    const side = S.side.step(clamp(acc.x * 0.01, -0.22, 0.22), 2.6, 0.55, 0, dt);
    // squash and stretch: down into the wind-up and a landing, up on the
    // way up, low when he's slinking (and every step a little)
    const cr = this.crouch;
    const ce = cr * cr * (3 - 2 * cr);
    let sq = -0.14 * ce - 0.2 * low - 0.04 * sit;
    if (m === 'air') {
      const p = clamp(this.airT / Math.max(0.05, this.airDur), 0, 1);
      sq += 0.1 * (1 - p) - 0.04 * p;
    }
    if (this.landHit > 0 && this.landClock < 1.2) sq -= 0.16 * this.landHit * impulse(this.landClock, 4.5, 0.32, 0);
    sq += run * 0.03 * Math.cos(ph * 2);
    const squash = S.squash.step(sq, 5.5, 0.35, 0, dt);
    const sy = 1 + squash, sxz = 1 / Math.sqrt(Math.max(0.5, sy));
    b.pot.scale.set(sxz, sy, sxz);
    // where he's looking: his whole body turns a little toward it
    const lk = this.lookAt ? clamp(Math.atan2(-this.lookAt.x, -this.lookAt.z), -0.7, 0.7) * this.lookW : 0;
    const yaw = S.yaw.step(waddle + lk * 0.6, 3.5, 0.6, 0, dt);
    _e.set(lean, yaw, -rock - side, 'YXZ');
    b.pot.quaternion.setFromEuler(_e);
    b.pot.position.copy(this.rest.pot);
    b.pot.position.y += bob - 0.02 * sit - 0.035 * ce;
    this.root.matrixWorld.identity();
    this.body.updateWorldMatrix(false, true);

    // --- the legs ---
    this.legsStep(dt, t, run, air, sit, low);

    // --- the leaf ---
    // lifted by the headwind as he runs, flung up on a jump, slapped down on
    // a landing, flopping with every step; lifted to peek out, to catch a
    // gem, when he's curious or pleased; pressed down when he's startled
    const wind = Math.min(sp, 1.2);
    let lift = 0.03 + 0.07 * wind * run + 0.75 * bask + 0.15 * (A.flail || 0) * Math.sin(t * 15) + 0.26 * this.peek * (1 - air) + 0.14 * this.lookW + 0.1 * this.happy - 0.28 * clamp(this.earBias, 0, 1.2) - 0.18 * low;
    if (m === 'air') {
      const p = clamp(this.airT / Math.max(0.05, this.airDur), 0, 1);
      lift += 0.12 + 0.14 * (1 - p);
    }
    lift += 0.5 * clamp(this.jawOpen, 0, 1);
    if (this.snapT < 0.5) lift -= 0.5 * impulse(this.snapT, 3, 0.4, 0);
    lift += 0.2 * Math.abs(this.curl);
    const tw = this.twitch[0] < 0.3 ? Math.sin((this.twitch[0] / 0.3) * TAU) * 0.12 : 0;
    this.twitch[0] += dt;
    this.twitch[1] += dt;
    // (his own acceleration up or down throws it: up a step, it lags down;
    // down into a landing, it flops on down)
    const fl = S.lift.step(lift + tw, 2.4, 0.24, -acc.y * 0.9 + acc.z * 0.4, dt);
    const fr = S.leafRoll.step(0.06 * Math.sin(t * 1.3), 2.0, 0.2, acc.x * 0.8 - this.yawRate * 0.6 - S.wobR.v * 9, dt);
    const fy = S.leafYaw.step(0, 1.8, 0.25, -this.yawRate * 2.2 + acc.x * 0.4 - S.yaw.v * 12, dt);
    const tip = S.tip.step(fl * 0.35, 3.2, 0.25, -acc.y * 0.9, dt);
    const L = this.rig.leaf;
    _ax.fromArray(L.across);
    _q.setFromAxisAngle(_ax, clamp(fl, -0.45, 0.85));
    _ax.fromArray(L.along);
    _q2.setFromAxisAngle(_ax, clamp(fr, -0.6, 0.6));
    _q.multiply(_q2);
    _q2.setFromAxisAngle(_UP, clamp(fy, -0.7, 0.7));
    b.lid.quaternion.copy(_q2).multiply(_q);
    _ax.fromArray(L.across);
    b.lidTip.quaternion.setFromAxisAngle(_ax, clamp(tip, -0.5, 0.6));
    const st = S.stem.step(fl * 0.22, 3, 0.4, 0, dt);
    _e.set(-st * 0.6, fy * 0.2, fr * 0.2);
    b.stem.quaternion.setFromEuler(_e);

    // --- the arms: tendrils on springs ---
    this.armsStep(dt, t, run, air, sit, acc, ce);

    // --- the sprig ---
    const sx = S.sprigX.step(0, 4.5, 0.18, acc.x * 1.2 - this.yawRate * 0.5, dt);
    const sz = S.sprigZ.step(0, 4.5, 0.18, -acc.y * 1.0 + acc.z * 0.6, dt);
    b.sprig.rotation.set(clamp(sz * 0.25, -0.5, 0.5), 0, clamp(-sx * 0.25, -0.5, 0.5));

    this.body.updateWorldMatrix(false, true);

    // --- the water ---
    this.waterStep(dt, t, acc, run, air);
    // --- crumbs of soil ---
    this.crumbs(dt, run, sp);
    this.landed = false;
    this.snapped = false;
  }

  // His root feet: each planted while it carries him, then lifted and
  // swung through - short quick steps (whatever his pace, the stride is
  // short: his feet patter). Dangling in the air, splayed when he sits.
  legsStep(dt, t, run, air, sit, low) {
    const b = this.b;
    const pot = b.pot;
    const amp = clamp(0.012 + 0.0032 * this.speed, 0.02, 0.07) * run;
    const p = this.airT / Math.max(0.05, this.airDur);
    for (let i = 0; i < 2; i++) {
      const g = this.legs[i];
      const s = g.s;
      const ph = (this.phase + (i === 0 ? 0 : 0.5)) % 1;
      // the hip: on the pot's base, wherever it is
      const hip = _p.copy(g.hip).applyMatrix4(pot.matrix);
      // the ankle: under the hip, swinging back and forth; lifted on the
      // way forward
      const a = TAU * ph;
      const swing = Math.cos(a);
      const up = Math.max(0, -Math.sin(a));
      const ank = _v.copy(g.ankle);
      ank.z += amp * swing;
      ank.y += (0.032 + 0.08 * amp) * up * up * run;
      ank.x += s * 0.008 * sit;
      // (in the air his feet hang, toes down, kicked back as he takes off,
      // reaching for the ground as he comes down)
      if (air > 0.01) {
        _v2.set(g.ankle.x * 0.9, hip.y - g.len * 0.95, g.ankle.z + 0.02 * (1 - p) - 0.02 * p + (i ? 0.012 : -0.012) * Math.sin(t * 20));
        ank.lerp(_v2, air);
      }
      ank.y = Math.max(ank.y, g.ankle.y - 0.002);
      // the leg aimed at it (and drawn out or squashed to reach it: it's a
      // root, it gives)
      const leg = b['leg' + g.L];
      leg.position.copy(hip);
      _v2.subVectors(ank, hip);
      const d = _v2.length();
      const k = clamp(d / g.len, 0.7, 1.35);
      aim(leg, g.leg, _v2);
      leg.scale.setScalar(k);
      // the foot: flat on the road, turned with him; rolled up off its heel
      // as it leaves the ground, toes down in the air
      const foot = b['foot' + g.L];
      const toe = run * (0.55 * Math.max(0, Math.sin(a + 0.6)) - 0.2 * Math.max(0, Math.sin(a - 1.6))) + air * 0.55 + 0.12 * low;
      _e.set(-toe, 0, 0);
      _q.setFromEuler(_e);
      // (its parent's turn undone, so it lies as it should)
      _q2.copy(leg.quaternion).invert();
      foot.quaternion.copy(_q2).multiply(_q);
      foot.scale.setScalar(1 / k);
      g.lift = ank.y - g.ankle.y;
      g.plant.copy(ank);
    }
  }

  // The tendrils: three joints each on springs, the outer ones looser, swung
  // against the steps and thrown by every jolt; up when he jumps or he's
  // pleased, down and back as he runs, curled in when he's startled.
  armsStep(dt, t, run, air, sit, acc, ce) {
    const b = this.b;
    const ph = this.phase * TAU;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const J = this.arms[i];
      // swinging opposite the foot on its side
      const swing = run * 0.45 * Math.sin(ph + (i === 0 ? Math.PI : 0));
      const A = this.act;
      let up = -0.15 + 0.85 * air + 0.55 * this.happy * (0.6 + 0.4 * Math.sin(t * 11 + i * 2)) - 0.35 * ce + 0.1 * sit - 0.25 * clamp(this.earBias, 0, 1);
      // (up to the sun when he basks; flailing when he hurries; flung out
      // as he totters and shakes; waving about as he sways)
      up += 0.9 * (A.bask || 0) + (A.flail || 0) * 0.7 * Math.sin(t * 17 + i * Math.PI) + (A.totter || 0) * 0.5 * Math.sin(t * 5.4 + i * Math.PI) + (A.shake || 0) * 0.6;
      up += (A.idle || 0) * 0.25 * Math.sin(t * 2.3 + i * Math.PI) + (A.sway || 0) * 0.4 * (A.swayDir || 0) * s;
      up += 0.3 * clamp(this.jawOpen, 0, 1);
      if (this.twitch[1] < 0.3 && i === 1) up += Math.sin((this.twitch[1] / 0.3) * Math.PI) * 0.5;
      const back = -0.35 * run + (this.act.flail || 0) * 0.9 * Math.sin(t * 13 + i * 2);
      for (let j = 0; j < 3; j++) {
        const loose = 1 + j * 0.6;
        const freq = 3.4 - j * 0.7;
        // (thrown: up when he drops, down when he's driven up; back as he
        // speeds up, out in a turn)
        const fu = (-acc.y * 0.9 + s * acc.x * 0.5) * loose;
        const ff = (acc.z * 0.6 - this.yawRate * s * 0.4) * loose;
        const u = J[j].up.step(j === 0 ? up : up * 0.3, freq, 0.22, fu, dt);
        const f = J[j].fwd.step(j === 0 ? swing + back : (swing + back) * 0.35, freq, 0.25, ff, dt);
        const bone = b['arm' + (i === 0 ? 'L' : 'R') + j];
        bone.rotation.set(0, s * clamp(f, -1.2, 1.2), s * clamp(u, -1.2, 1.5), 'YZX');
      }
    }
  }

  // The water: its surface tips against every push, turn and stop (a
  // damped pendulum: it sloshes), and heaves with every step and jolt.
  // Where it rises too high it spills over the rim there.
  waterStep(dt, t, acc, run, air) {
    const S = this.S;
    const b = this.b;
    const G = 9.8;
    // (tipped to lie level whatever the pot does, then by the slosh)
    const sx = S.slX.step(clamp(-acc.x / G, -0.8, 0.8), 1.9, 0.12, 0, dt);
    const sz = S.slZ.step(clamp(-acc.z / G, -0.8, 0.8), 1.9, 0.12, 0, dt);
    const hv = S.heave.step(0, 2.6, 0.18, -acc.y * 0.06 + (this.landed ? -0.35 * this.landHit : 0), dt);
    _qi.copy(b.pot.quaternion).invert();
    _e.set(clamp(-sz, -0.5, 0.5), 0, clamp(sx, -0.5, 0.5));
    _q.setFromEuler(_e);
    b.water.quaternion.copy(_qi).multiply(_q);
    b.water.position.copy(this.rest.water);
    b.water.position.y += clamp(hv * 0.08, -0.03, 0.04);
    b.water.updateMatrixWorld(true);
    if (this.wet || dt <= 0) return;
    // how high it climbs the wall (m above where it lies), and where
    const R = this.rig.water.r;
    // (the water lies level: when he leans, his rim dips toward it on that
    // side - so every wobble slops some out)
    _v.set(0, 1, 0).applyQuaternion(b.pot.quaternion);
    const ex = sx + _v.x * 1.3, ez = sz + _v.z * 1.3;
    const tilt = Math.hypot(ex, ez);
    const rise = tilt * R + Math.abs(hv) * 0.06;
    // (and a twirl or a shake flings it out all round)
    const fling = Math.max(0, Math.abs(this.yawRate) - 5) * 0.012 + (this.act.shake || 0) * 0.12;
    // spills: more the higher it climbs; a few on any step
    let rate = Math.max(0, rise - 0.026) * 700 + fling * 420;
    // (every step jolts it: a drop or two slopped over now and then, more
    // the faster he goes)
    if (this.stepped[0] || this.stepped[1]) {
      const k = run * clamp(this.speed / 12, 0.3, 1.3);
      if (Math.random() < 0.8 * k) rate += (1 + (Math.random() < 0.5 * k ? 1 : 0) + (Math.random() < 0.25 * k ? 1 : 0)) / dt;
    }
    if (this.landed) rate += (10 + 14 * this.landHit) / dt;
    if (this.snapped) rate += 6 / dt;
    this.spillAcc += rate * dt;
    let n = 0;
    while (this.spillAcc >= 1 && n < 18) {
      this.spillAcc -= 1;
      n++;
      // where on the rim: the high side of the slosh, or anywhere (a jolt,
      // a twirl)
      let ang;
      if (tilt > 0.04 && Math.random() < 0.8) ang = Math.atan2(ex, -ez) + (Math.random() - 0.5) * 1.3;
      else ang = Math.random() * TAU;
      this.spill(ang, fling, hv);
    }
    if (this.spillAcc > 3) this.spillAcc = 3;
  }

  // A drop over the rim at angle ang (0 the front, + toward his right).
  spill(ang, fling, hv) {
    const b = this.b;
    const r = this.mouthR;
    // the rim point, in the pot's space, onto the root's
    _p.set(Math.sin(ang) * r, 0, -Math.cos(ang) * r * 1.05);
    // (on the tipped mouth)
    _p.y = _p.z * Math.tan(Math.atan2(-this.mouthN.z, this.mouthN.y)) + 0.012;
    _p.add(this.mouthC).applyMatrix4(b.pot.matrixWorld);
    // out over the rim and up; carried along with him (in his own frame)
    _v.set(Math.sin(ang), 0, -Math.cos(ang)).applyQuaternion(b.pot.quaternion);
    const out = 0.7 + Math.random() * 1.1 + fling * 40;
    _v.multiplyScalar(out);
    _v.y = 1.0 + Math.random() * 1.6 + Math.max(0, -hv) * 3;
    _qi.copy(this.root.quaternion).invert();
    _v2.copy(this.vel).applyQuaternion(_qi).multiplyScalar(0.9);
    _v.add(_v2);
    const big = Math.random() < 0.3;
    this.emit(_p, _v, big ? 0.085 + Math.random() * 0.035 : 0.05 + Math.random() * 0.025, 6);
    // (and a puff of spray off the bigger splashes)
    if (big && Math.random() < 0.4) this.emit(_p, _v.multiplyScalar(0.5), 0.12, 3, 0.4, 0.6, 0.8);
  }

  // Crumbs of soil shaken loose from his roots: a few on every footfall,
  // left on the road behind him; a scatter when he lands.
  crumbs(dt, run, sp) {
    if (dt <= 0) return;
    _qi.copy(this.root.quaternion).invert();
    for (let i = 0; i < 2; i++) {
      const g = this.legs[i];
      let n = 0;
      if (this.stepped[i]) {
        n = 2 + Math.floor(Math.random() * (1.5 + 2 * Math.min(sp, 1)));
        // (each footfall thumps up a little puff off the road too)
        _p.copy(g.plant);
        _p.y = 0.03;
        _v.set(g.s * 0.3, 0.4, 0.5);
        this.emit(_p, _v, 0.24 + 0.1 * Math.random(), 0, 0.5, 0.75, 0.9);
      }
      if (this.landed) {
        n += 6 + Math.round(this.landHit * 5);
        _p.copy(g.plant);
        _p.y = 0.04;
        _v.set(g.s * 0.8, 0.5, 0);
        this.emit(_p, _v, 0.32 + 0.1 * this.landHit, 0, 0.55, 0.9, 1.1);
      }
      // (a shake rattles it off his roots)
      if ((this.act.shake || 0) > 0.3 && Math.random() < dt * 22) n++;
      for (let k = 0; k < n; k++) {
        _p.copy(g.plant);
        _p.x += g.s * (Math.random() * 0.05 - 0.01);
        _p.z += (Math.random() - 0.5) * 0.08;
        _p.y = 0.02 + Math.random() * 0.02;
        // kicked up and back off the planted foot (it's still on the road:
        // nothing of his speed goes with them)
        _v.set(g.s * (Math.random() * 0.8), 0.8 + Math.random() * 1.5, 0.5 + Math.random() * 1.0);
        if (this.landed) _v.set(g.s * (0.4 + Math.random() * 1.3), 0.9 + Math.random() * 1.6, (Math.random() - 0.5) * 1.8);
        this.emit(_p, _v, 0.045 + Math.random() * 0.04, 5);
      }
      // (and now and then one drops off a foot as it swings through)
      if (g.lift > 0.01 && Math.random() < dt * 3 * run) {
        _p.copy(g.plant);
        _p.y = Math.max(0.02, _p.y - 0.01);
        _v.copy(this.vel).applyQuaternion(_qi).multiplyScalar(0.7);
        _v.y = 0.2;
        this.emit(_p, _v, 0.04, 5);
      }
    }
  }

  // A drop, a crumb or a puff at p (his own sculpted space: drawn half as
  // big again), moving at v (m/s, in his frame).
  emit(p, v, size, kind, alpha = -1, life = 1, grow = 1) {
    this.dust.emit(p.multiplyScalar(SCALE), v, size, kind, alpha, life, grow);
  }

  // After the frame: his drops and crumbs, left in the world (track
  // coordinates: z the runner's scene z, dist how far they've run).
  after(z, dist, lowG = false) {
    this.dust.g = lowG ? 6 : 16;
    this.dust.update(this.lastDt, this.root, z, dist);
    this.lastDt = 0;
  }

  // --- placing him in the world ---------------------------------------------------------
  place(pos, q, ground = 0, shadow = 1) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    this.root.scale.setScalar(SCALE);
    if (this.spin) {
      _q.setFromAxisAngle(_UP, this.spin);
      this.root.quaternion.multiply(_q);
    }
    const h = Math.max(0, pos.y - ground);
    const r = 0.6 * SCALE;
    this.cast.aim(pos.x - r, pos.x + r, pos.y - 0.05, pos.y + 0.75 * SCALE, pos.z - r, pos.z + r, ground, pos.x, pos.z, {
      alpha: 0.95 * clamp(1 - h * 0.2, 0.5, 1) * shadow,
      contact: 0.34 * clamp(1 - h * 3, 0, 1) * shadow,
      reach: 0.18,
    });
  }

  forCompile(on) {
    this.root.visible = true;
    this.shadow.visible = on;
    this.dust.forCompile(on);
  }
}

// Did the phase pass `at` going from a to b (wrapping at 1)?
function crossed(a, b, at) {
  if (b >= a) return a < at && b >= at;
  return a < at || b >= at;
}

// The impulse response of a damped spring (frequency Hz, damping ratio),
// scaled to peak at about 1: a jolt that rings out.
function impulse(t, freq, zeta, delay) {
  t -= delay;
  if (t <= 0) return 0;
  const w = TAU * freq, r = Math.sqrt(1 - zeta * zeta);
  if (t * zeta * w > 8) return 0;
  const peak = r * Math.exp((-zeta / r) * Math.atan(r / zeta));
  return (Math.exp(-zeta * w * t) * Math.sin(w * r * t)) / peak;
}

// Aim a bone so its rest offset to the next joint (rest, bind space) points
// along dir (in its parent's frame's space: here the body's, which is the
// root's).
function aim(bone, rest, dir) {
  bone.parent.matrixWorld.decompose(_p, _q, _s);
  _v3.copy(rest).normalize().applyQuaternion(_q);
  _qd.setFromUnitVectors(_v3, _s.copy(dir).normalize());
  _q2.copy(_q).invert();
  bone.quaternion.copy(_q2).multiply(_qd).multiply(_q);
}
