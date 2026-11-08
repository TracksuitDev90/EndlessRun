import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials, makeEnvUniforms } from '../render/shaders.js';
import { palette, bodyGeometry } from './kit.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { CastShadow } from '../render/caster.js';

// Iris, the wind dragon who flies with you: the body and how it moves.
// Sculpted offline (tools/runner/dragon.py) laid out straight, nose to tail,
// with her spine a chain of bones each free to go anywhere; drawn with the
// runners' illustrated shader (DRAGON in CHAR_DETAIL: fish scales shot with
// blue, teal, green and violet that shift as she turns in the light, a gold
// belly ridged in chevrons, pale hands and feet, dark claws, cream antlers,
// feathered frills and plume) and a short pile of feathery fur on her mane
// (SHELL).
//
// Nothing here decides where she goes - that's her mind's job (flyer.js),
// which hands her each frame where her head is and how it's moving, and
// whether she's flying, standing up on her hind legs or down on all fours.
// This module turns that into a dragon:
//   - flying, her body flows after her head like a ribbon in the wind: her
//     head's path is kept in the runner's frame, blown back by a wind of
//     its own, and her spine laid along it - so every swerve, climb and
//     dive runs down her body, and her tail passes exactly where her head
//     has been. Each point of that path keeps how her head was turned there,
//     so a bank or a corkscrew runs down her as a twist. On top of it she
//     swims: a wave travels down her from neck to plume, small at her head
//     and growing toward her tail, rising and falling more than side to
//     side, as a dragon swims through cloud;
//   - standing, her spine is drawn up into an S (hips over her feet, chest
//     up, neck back and head forward) and her tail laid round on the ground;
//     on all fours, her back level and her neck raised. Both are drawn by
//     bending along her length (so she's never a centimetre longer or
//     shorter), and she glides between them and flight;
//   - her legs placed by IK: tucked up as she flies (hands under her chest,
//     hind legs trailing back along her tail), planted as she stands;
//   - her whiskers simulated as chains streaming in the wind, her frills on
//     springs, her mane's fur combed by the air, the plume at her tail
//     fluttering; she blinks, squints when she's pleased, opens her mouth.

export const COL = {
  1: '#2f86c8', // scales
  2: '#33369a', // mane
  3: '#f1dd9c', // antlers
  4: '#2f86c8', // jaw
  5: '#5b2142', // inside the mouth
  6: '#1c2050', // claws
  7: '#28a9bf', // frills
  8: '#1d5a86', // whiskers
  9: '#3557c9', // plume
  13: '#1f3f9e', // deep blue: her back
  14: '#23b9c1', // teal: her flanks
  15: '#7ed46c', // green: low on her flanks
  16: '#6a45c6', // violet
  17: '#f4c776', // her belly, gold
  18: '#c88b4d', // the ridges across it
  19: '#ece6f6', // pale: hands and feet
  20: '#b4abd8', // pale in its own shade
  21: '#e04fc4', // magenta: the frills' and feathers' tips
  22: '#8a4fe0', // purple
  23: '#f79a1c', // iris
  24: '#14143a', // ink: rims, pupils, nostrils
  25: '#bdf2f2', // the light on her muzzle
  26: '#163a7a', // her brows
  27: '#ffd56a', // the iris round the pupil
  28: '#6a3fc4', // the mane's violet
  29: '#33c6c8', // the mane's teal sheen
  30: '#c8fbff', // the shine on her scales
};

const SHELLS = 3;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;

// the profile of a pose along her: [s, value] keys, eased between
function prof(keys, s) {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) {
      const k = (s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return lerp(keys[i - 1][1], keys[i][1], k * k * (3 - 2 * k));
    }
  }
  return keys[keys.length - 1][1];
}

// Standing up on her hind legs (from her hips toward her head: how far
// each part of her leans forward from upright, radians), and her tail from
// her hips round on the ground ([pitch, heading]: pitch below level,
// heading turning round to her right).
const STAND_UP = [[0.8, 0.1], [0.55, 0.0], [0.32, -0.12], [0.2, -0.24], [0.1, -0.02], [0.04, 0.32], [0.0, 0.7]];
const STAND_TAIL = [[0.8, [-1.42, 0]], [0.94, [-1.0, 0.0]], [1.12, [-0.5, 0.15]], [1.34, [-0.06, 0.55]], [1.6, [0.0, 1.45]], [1.88, [0.02, 2.35]], [2.15, [0.38, 2.95]]];
// Down on all fours: her back level, her neck raised (pitch above level, from
// her hips toward her head), her tail along the ground behind her.
const CROUCH_UP = [[0.8, 0.0], [0.56, 0.05], [0.32, 0.14], [0.22, 0.72], [0.1, 0.85], [0.0, 0.3]];
const CROUCH_TAIL = [[0.8, [0.0, 0]], [1.0, [-0.3, 0.0]], [1.25, [-0.38, 0.18]], [1.5, [-0.04, 0.4]], [1.8, [0.04, 0.1]], [2.15, [0.3, -0.3]]];
const STAND_HIPS = [0, 0.485, 0.02];
const CROUCH_HIPS = [0, 0.465, 0.25];

export class Dragon {
  constructor(env, asset) {
    this.asset = asset;
    const R = (this.rig = asset.meta.rig);
    this.Y0 = R.y0;
    this.N = R.spine.bones;
    this.LEN = R.spine.length;
    this.seg = this.LEN / (this.N - 1);
    this.sOf = (i) => this.seg * i;
    this.radius = R.spine.radius;
    this.u = makeEnvUniforms(env);
    this.root = new THREE.Group();
    this.root.name = 'dragon';
    this.buildSkeleton();
    this.buildLook();
    this.buildShadow();
    // the spine: where each bone is and how it's turned, for each way she can
    // be (flying, standing, on all fours), and blended
    const arr = () => Array.from({ length: this.N }, () => new THREE.Vector3());
    const qarr = () => Array.from({ length: this.N }, () => new THREE.Quaternion());
    this.fly = { p: arr(), q: qarr(), head: new THREE.Quaternion() };
    this.stand = { p: arr(), q: qarr(), head: new THREE.Quaternion() };
    this.crouch = { p: arr(), q: qarr(), head: new THREE.Quaternion() };
    this.P = arr();
    this.Q = qarr();
    this.headQ = new THREE.Quaternion();
    // the path her head has flown: in the runner's frame, x, y, z when it
    // was there, the wind blown by then, and how her head was turned
    this.CAP = 600;
    this.hp = new Float32Array(this.CAP * 3);
    this.hw = new Float64Array(this.CAP);
    this.hq = new Float32Array(this.CAP * 4);
    this.wS = { fly: new Spring(), stand: new Spring(1), crouch: new Spring() };
    this.w = { fly: 0, stand: 1, crouch: 0 };
    this.springs = {};
    for (const k of ['frillL', 'frillR', 'frillLo', 'frillRo', 'jaw', 'land', 'lookY', 'lookP', 'roll', 'swim']) this.springs[k] = new Spring();
    this.whiskers = [this.buildWhisker(-1), this.buildWhisker(1)];
    this.faceU.value.set(1, 0, 0, 0);
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
    this.sp = Array.from({ length: this.N }, (_, i) => this.b['sp' + i]);
    const R = this.rig;
    const v = (a, s) => new THREE.Vector3(s * a[0], a[1], a[2]);
    this.shoulderI = Math.round((R.spine.shoulder / this.LEN) * (this.N - 1));
    this.hipI = Math.round((R.spine.hip / this.LEN) * (this.N - 1));
    this.legs = [];
    for (const [s, L] of [[-1, 'L'], [1, 'R']]) {
      const F = {};
      for (const k in R.front) F[k] = v(R.front[k], s);
      this.legs.push({
        front: true, s, L,
        bones: ['arm' + L, 'fore' + L, 'hand' + L],
        a: F.shoulder.distanceTo(F.elbow),
        b: F.elbow.distanceTo(F.wrist),
        hand: F.toe.clone().sub(F.wrist),
        rest: [F.elbow.clone().sub(F.shoulder), F.wrist.clone().sub(F.elbow), F.toe.clone().sub(F.wrist)],
        at: this.shoulderI,
      });
    }
    for (const [s, L] of [[-1, 'L'], [1, 'R']]) {
      const H = {};
      for (const k in R.hind) H[k] = v(R.hind[k], s);
      this.legs.push({
        front: false, s, L,
        bones: ['thigh' + L, 'shin' + L, 'meta' + L, 'foot' + L],
        thigh: H.hip.distanceTo(H.stifle),
        shin: H.stifle.distanceTo(H.hock),
        meta: H.hock.distanceTo(H.foot),
        hand: H.toe.clone().sub(H.foot),
        rest: [H.stifle.clone().sub(H.hip), H.hock.clone().sub(H.stifle), H.foot.clone().sub(H.hock), H.toe.clone().sub(H.foot)],
        at: this.hipI,
      });
    }
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    this.furWind = new THREE.Vector4(0, -0.2, 0.4, 1);
    this.faceU = { value: new THREE.Vector4(1, 0, 0, 0) };
    const mats = makeCharacterMaterials(this.u, palette(COL), [], 0.0075, null, { style: 'dragon', uniforms: { uFace: this.faceU }, shell: this.furWind });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.shellMat = mats.shell;
    const geo = bodyGeometry(this.asset);
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.inkMesh = new THREE.SkinnedMesh(geo, this.inkMat);
    this.furMesh = new THREE.SkinnedMesh(shellGeometry(geo, SHELLS), this.shellMat);
    for (const m of [this.mesh, this.inkMesh, this.furMesh]) {
      m.frustumCulled = false;
      m.renderOrder = -20;
      this.root.add(m);
    }
    this.furMesh.renderOrder = -19;
    this.root.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.inkMesh.bind(this.skeleton, this.mesh.bindMatrix);
    this.furMesh.bind(this.skeleton, this.mesh.bindMatrix);
  }

  // Her shadow: the shape of her as she is this frame - the ribbon of her
  // body, her legs, antlers and mane - thrown along the world's light
  // (render/caster.js), fainter and softer the higher she flies.
  buildShadow() {
    this.cast = new CastShadow(this.u, { res: 224 });
    this.shadow = this.cast.mesh;
  }

  renderShadow(renderer) {
    if (this.cast.casters.length === 0) this.cast.setCasters([this.root]);
    this.cast.render(renderer);
  }

  get objects() {
    return [this.root, this.shadow];
  }

  buildWhisker(s) {
    const R = this.rig.whisker;
    const n = R.bones + 1;
    return {
      s,
      L: s < 0 ? 'L' : 'R',
      n,
      seg: R.length / R.bones,
      p: Array.from({ length: n }, () => new THREE.Vector3()),
      o: Array.from({ length: n }, () => new THREE.Vector3()),
      root: new THREE.Vector3(s * R.root[0], R.root[1], R.root[2]),
      ready: false,
    };
  }

  reset() {
    this.time = 0;
    this.n = 0;
    this.head0 = 0;
    this.Wind = 0;
    this.mode = 'stand';
    this.happy = 0;
    this.alarm = 0;
    this.jawOpen = 0;
    this.snapT = 9;
    this.blinkT = 2;
    this.blink = 0;
    this.landT = 9;
    this.landK = 0;
    this.wet = 0;
    this.lookAt = null;
    this.lookW = 0;
    this.headDir = new THREE.Quaternion();
    this.rolledHead = new THREE.Quaternion();
    this.headReady = false;
    this.rollA = 0;
    this.rollV = 0;
    this.rollDir = 1;
    this.rollBase = 0;
    this.rollLive = false;
    this.screwW = 0;
    this.velRel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.prevVel = null;
    this.bank = 0;
    this.swimPhase = 0;
    this.spot = new THREE.Vector3();
    this.yaw = 0;
    this.flutter = 0;
    for (const k in this.wS) this.wS[k].reset(k === 'stand' ? 1 : 0);
    for (const s of Object.values(this.springs)) s.reset();
    for (const W of this.whiskers) W.ready = false;
    this.root.visible = true;
  }

  // A landing of strength k (1 a hard one).
  land(k = 1) {
    this.landT = 0;
    this.landK = k;
  }

  snap() {
    this.snapT = 0;
  }

  // Up off the ground: she springs up into the air quicker than she settles
  // into a pose.
  takeOff() {
    this.quick = 0.45;
  }

  // Where her head is when she stands at spot facing yaw (the mind flies it
  // there before she sets down).
  standHead(spot, yaw, mode, out) {
    const pose = mode === 'crouch' ? this.crouch : this.stand;
    this.groundPose(pose, mode === 'crouch' ? CROUCH_UP : STAND_UP, mode === 'crouch' ? CROUCH_TAIL : STAND_TAIL, mode === 'crouch' ? CROUCH_HIPS : STAND_HIPS, spot, yaw, 0);
    return out.copy(pose.p[0]);
  }

  // --- the frame ----------------------------------------------------------------------
  // ctx: { mode: 'fly' | 'stand' | 'crouch', head: where her head is (world),
  // vel: how it's moving (world, m/s), frameZ: the runner's z (her path is kept
  // in their frame), wind: the wind her body streams back in (m/s, in that
  // frame), spot / yaw: where she stands and which way she faces (on the
  // ground), swim: how hard she swims (0..1.5), roll: how far round her own
  // length she's rolled in a corkscrew (radians; null when she isn't in
  // one), upright: how firmly she rights herself (0 in a loop), speed: the
  // runner's pace }
  update(dt, ctx) {
    this.time += dt;
    const t = this.time;
    this.mode = ctx.mode;
    if (ctx.spot) this.spot.copy(ctx.spot);
    if (ctx.yaw !== undefined) this.yaw = ctx.yaw;
    const W = this.wS;
    this.quick = Math.max(0, (this.quick || 0) - dt);
    const fq = this.quick > 0 ? 3.2 : 1.6;
    this.w.fly = clamp(W.fly.step(this.mode === 'fly' ? 1 : 0, fq, 1, dt), 0, 1);
    this.w.stand = clamp(W.stand.step(this.mode === 'stand' ? 1 : 0, fq, 1, dt), 0, 1);
    this.w.crouch = clamp(W.crouch.step(this.mode === 'crouch' ? 1 : 0, fq, 1, dt), 0, 1);
    this.snapT += dt;
    this.landT += dt;
    // her head's velocity through the air, and how it's changing
    // (the acceleration smoothed over a tenth of a second or so - the same
    // at any frame rate: taken against a lagging velocity and divided by the
    // frame's time instead, it came out three times as strong at 60 Hz as
    // at 20, five at 120, and she over-banked and twitched)
    _v.copy(ctx.vel);
    this.velRel.set(_v.x, _v.y, _v.z + ctx.speed - (ctx.wind || 0));
    if (!this.prevVel) this.prevVel = this.velRel.clone();
    if (dt > 0) {
      _v2.subVectors(this.velRel, this.prevVel).divideScalar(dt).clampLength(0, 60);
      this.acc.lerp(_v2, 1 - Math.exp(-dt * 11));
    }
    this.prevVel.copy(this.velRel);
    // blinks, now and then; a happy squint
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.14;
      this.blinkT = 2 + Math.random() * 4 + (Math.random() < 0.2 ? -1.6 : 0);
    }
    this.blink = Math.max(0, this.blink - dt);
    const bl = this.blink > 0 ? Math.sin((this.blink / 0.14) * Math.PI) : 0;
    this.faceU.value.x = clamp(1 - bl * 1.2, 0, 1) * (1 - 0.25 * this.alarm);
    this.faceU.value.y = clamp(this.happy, 0, 1);

    this.flight(dt, t, ctx);
    if (this.w.stand > 0.001 || this.mode === 'stand') this.groundPose(this.stand, STAND_UP, STAND_TAIL, STAND_HIPS, this.spot, this.yaw, t);
    if (this.w.crouch > 0.001 || this.mode === 'crouch') this.groundPose(this.crouch, CROUCH_UP, CROUCH_TAIL, CROUCH_HIPS, this.spot, this.yaw, t);
    this.blend(dt, t);
    this.applySpine(dt, t, ctx);
    this.solveLegs(dt, t);
    this.whiskerSim(dt, t, ctx);
    this.frillsSim(dt, t);
    this.placeShadow();
    // the mane's fur combed back by the air streaming past, and down by its
    // weight
    const sp = this.velRel.length() * this.w.fly;
    _v.copy(this.velRel).multiplyScalar(-Math.min(1, sp / 14) * 0.8 / Math.max(sp, 1e-3));
    this.furWind.set(_v.x, _v.y - 0.3, _v.z, 1);
  }

  // --- flying: her body laid along her head's path --------------------------------------
  flight(dt, t, ctx) {
    const F = this.fly;
    const CAP = this.CAP;
    // the wind her body streams back in: never slower than her head is
    // dropping back through it (else she'd fold back over herself) - but in
    // a loop she means to
    const wind = Math.max(ctx.wind || 4, (this.velRel.z + (ctx.wind || 4) + 1.5) * (1 - (ctx.loop || 0)));
    this.Wind += wind * dt;
    // which way her head faces: along its path through the air; rolled by
    // how it banks (the lift tipped into a turn, as a bird's is), by any
    // corkscrew, and righted again
    const f = _v.copy(this.velRel);
    f.z += (ctx.wind || 4) - wind;
    if (f.lengthSq() < 0.04) f.set(0, 0, -1);
    f.normalize();
    if (!this.headReady) {
      // (lookAt turns -z toward the target: her nose)
      _m.lookAt(_p.set(0, 0, 0), f, _Y);
      this.headDir.setFromRotationMatrix(_m);
      this.headReady = true;
    }
    const cur = _v2.set(0, 0, -1).applyQuaternion(this.headDir);
    this.headDir.premultiply(_q.setFromUnitVectors(cur, f));
    // the corkscrew: how far round her own length she's rolled (see rollStep)
    // - a turn of its own laid on top, so righting herself never fights it
    const screw = this.rollStep(dt, ctx.roll);
    // the bank: where her lift would point - up, tipped toward the way she's
    // turning, by how hard she's turning across her line of flight (never by
    // climbing or diving: pulling out of a climb - over a wall, say - is a
    // hard push downward, and taken for a turn it tipped her lift right
    // over, so she rolled half over toward her back and back again); hardly
    // at all while she corkscrews (her head swings round a little helix, and
    // that's no turn to bank into); never further over than about fifty
    // degrees
    const bk = 0.19 * (1 - 0.85 * screw);
    const side = _p.crossVectors(f, _Y);
    // (climbing or diving steeply there's hardly any 'up' left across her
    // line of flight to right herself toward - and what there is swings
    // about wildly: she lets it be)
    const lift = side.length();
    const upr = clamp(ctx.upright ?? 1, 0, 1) * (1 - Math.abs(f.y) * 0.6) * smooth(0.06, 0.35, lift);
    if (lift > 1e-4 && upr > 0) {
      side.divideScalar(lift);
      const tip = clamp(bk * this.acc.dot(side), -1.25, 1.25);
      _v3.copy(_Y).addScaledVector(f, -f.y).divideScalar(lift).addScaledVector(side, tip).normalize();
      const up = _v2.set(0, 1, 0).applyQuaternion(this.headDir);
      let a = Math.atan2(_s.crossVectors(up, _v3).dot(f), up.dot(_v3));
      a = clamp(a, -2.5, 2.5) * (1 - Math.exp(-dt * 3.2 * upr));
      this.headDir.premultiply(_q.setFromAxisAngle(f, a));
    }
    this.headDir.normalize();
    // her head as it is: as it faces and banks, rolled round by the corkscrew
    const head = this.rolledHead.copy(this.headDir);
    if (this.rollA !== 0) head.premultiply(_q.setFromAxisAngle(f, this.rollA));
    // record where her head is, in the runner's frame
    const k = (this.head0 = (this.head0 + 1) % CAP);
    this.n = Math.min(CAP, this.n + 1);
    this.hp[k * 3] = ctx.head.x;
    this.hp[k * 3 + 1] = ctx.head.y;
    this.hp[k * 3 + 2] = ctx.head.z - ctx.frameZ;
    this.hw[k] = this.Wind;
    this.hq[k * 4] = head.x;
    this.hq[k * 4 + 1] = head.y;
    this.hq[k * 4 + 2] = head.z;
    this.hq[k * 4 + 3] = head.w;
    // the path, newest first, as it lies now (blown back since)
    const pts = this._pts || (this._pts = []);
    const qs = this._qs || (this._qs = []);
    const cum = this._cum || (this._cum = []);
    let m = 0, len = 0, used = this.n;
    for (let j = 0; j < this.n; j++) {
      const i = (k - j + CAP) % CAP;
      const P = pts[m] || (pts[m] = new THREE.Vector3());
      P.set(this.hp[i * 3], this.hp[i * 3 + 1], this.hp[i * 3 + 2] + (this.Wind - this.hw[i]) + ctx.frameZ);
      if (m > 0) {
        const d = P.distanceTo(pts[m - 1]);
        if (d < 0.004) continue;
        len += d;
      }
      const Q = qs[m] || (qs[m] = new THREE.Quaternion());
      Q.set(this.hq[i * 4], this.hq[i * 4 + 1], this.hq[i * 4 + 2], this.hq[i * 4 + 3]);
      cum[m] = len;
      m++;
      if (len > this.LEN + 0.3) {
        used = j + 1;
        break;
      }
    }
    // (the rest of the path is forgotten)
    this.n = Math.min(this.n, used + 8);
    // too short yet (just took off): it carries straight on back
    if (len < this.LEN + 0.3) {
      const last = pts[m - 1];
      const P = pts[m] || (pts[m] = new THREE.Vector3());
      const prev = m > 1 ? _v.subVectors(last, pts[m - 2]).normalize() : _v.set(0, 0, 1);
      if (prev.z < 0.3) prev.set(0, 0, 1);
      P.copy(last).addScaledVector(prev, this.LEN + 0.4 - len);
      const Q = qs[m] || (qs[m] = new THREE.Quaternion());
      Q.copy(qs[m - 1]);
      cum[m] = this.LEN + 0.4;
      m++;
    }
    // the spine along it (Catmull-Rom through the path), each bone turned
    // as her head was there
    const base = this._base || (this._base = Array.from({ length: this.N }, () => new THREE.Vector3()));
    let j = 0;
    for (let i = 0; i < this.N; i++) {
      const s = this.sOf(i);
      while (j < m - 2 && cum[j + 1] < s) j++;
      const h = cum[j + 1] - cum[j] || 1;
      const u = clamp((s - cum[j]) / h, 0, 1);
      catmull(pts[Math.max(0, j - 1)], pts[j], pts[j + 1], pts[Math.min(m - 1, j + 2)], u, base[i]);
      F.q[i].copy(qs[j]).slerp(qs[j + 1], u);
    }
    // she swims: a wave running down her from neck to plume, growing toward
    // her tail - rising and falling, and a little side to side
    const sw = this.springs.swim.step(ctx.swim ?? 1, 1.2, 1, dt);
    const rate = 0.55 + 0.25 * sw;
    this.swimPhase += TAU * rate * dt;
    const P = F.p;
    for (let i = 0; i < this.N; i++) {
      const s = this.sOf(i);
      this.frameAt(base, i, F.q[i]);
      const env = smooth(0.05, 0.75, s) * (0.8 + 0.5 * smooth(0.9, 2.1, s));
      const ph = (TAU * s) / 1.55 - this.swimPhase;
      const av = 0.085 * sw * env, al = 0.06 * sw * env;
      _v.set(0, 1, 0).applyQuaternion(F.q[i]);
      _v2.set(1, 0, 0).applyQuaternion(F.q[i]);
      P[i].copy(base[i]).addScaledVector(_v, av * Math.sin(ph)).addScaledVector(_v2, al * Math.sin(ph * 0.5 + 1.1 + 0.4 * Math.sin(t * 0.37)));
    }
    // laid back to her true length along it
    respace(P, this.seg, 0, this._tmp || (this._tmp = Array.from({ length: this.N }, () => new THREE.Vector3())));
    for (let i = 0; i < this.N; i++) this.frameAt(P, i, F.q[i]);
    F.head.copy(head);
  }

  // The corkscrew's roll. While her mind has her in one (want: how far
  // round she should be, radians), exactly that; when it's over - or cut
  // short - she carries on round the way she was going to the next whole
  // turn, easing into it (never unrolling back the short way, which reads
  // as a roll given up half way). Returns how much she's in one (0..1).
  rollStep(dt, want) {
    const live = typeof want === 'number';
    if (live) {
      if (!this.rollLive) this.rollBase = this.rollA - want;
      const a = this.rollBase + want;
      if (dt > 0) this.rollV = (a - this.rollA) / dt;
      if (Math.abs(this.rollV) > 0.5) this.rollDir = Math.sign(this.rollV);
      this.rollA = a;
    } else if (this.rollA !== 0) {
      // (the whole turn ahead of her, the way she was rolling)
      const n = this.rollA / TAU;
      const end = TAU * (this.rollDir > 0 ? Math.ceil(n - 0.02) : Math.floor(n + 0.02));
      const w = 6.5, e = Math.exp(-w * dt);
      const d = this.rollA - end;
      const j = (this.rollV + w * d) * dt;
      this.rollA = end + (d + j) * e;
      this.rollV = (this.rollV - w * j) * e;
      if (Math.abs(this.rollA - end) < 0.004 && Math.abs(this.rollV) < 0.05) this.rollA = this.rollV = 0;
    }
    this.rollLive = live;
    this.screwW += ((live || this.rollA !== 0 ? 1 : 0) - this.screwW) * (1 - Math.exp(-dt * 6));
    return this.screwW;
  }

  // Turn q so the bone's +z (toward her tail) lies along the spine at i.
  frameAt(P, i, q) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(this.N - 1, i + 1)];
    _v3.subVectors(b, a);
    if (_v3.lengthSq() < 1e-10) return q;
    _v3.normalize();
    _qd.setFromUnitVectors(_v2.set(0, 0, 1).applyQuaternion(q), _v3);
    return q.premultiply(_qd);
  }

  // --- on the ground: standing, or on all fours ---------------------------------------
  // Drawn by bending along her length from her hips: toward her head by
  // `up` (each part's lean), toward her tail by `tail` ([pitch, heading]);
  // she breathes, and her tail stirs on the ground.
  groundPose(pose, up, tail, hips, spot, yaw, t) {
    const stand = up === STAND_UP;
    const N = this.N, hi = this.hipI, ds = this.seg;
    const br = Math.sin(t * 2.0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const toW = (x, y, z, out) => out.set(spot.x + x * cy + z * sy, spot.y + y, spot.z - x * sy + z * cy);
    const P = pose.p;
    // from the hips toward her head
    const H = toW(hips[0], hips[1] + 0.004 * br, hips[2], P[hi]);
    let x = hips[0], y = hips[1] + 0.004 * br, z = hips[2];
    for (let i = hi - 1; i >= 0; i--) {
      const s = this.sOf(i) + ds * 0.5;
      const sway = stand ? 0.03 * Math.sin(t * 0.7 + s * 3) + 0.02 * br * smooth(0.5, 0.0, s) : 0.02 * Math.sin(t * 0.8 + s * 4);
      const a = prof(up, s) + sway;
      if (stand) {
        y += Math.cos(a) * ds;
        z -= Math.sin(a) * ds;
      } else {
        y += Math.sin(a) * ds;
        z -= Math.cos(a) * ds;
      }
      x += 0.015 * Math.sin(t * 0.5 + s * 2) * ds;
      toW(x, y, z, P[i]);
    }
    // from the hips toward her tail
    x = hips[0];
    y = hips[1] + 0.004 * br;
    z = hips[2];
    for (let i = hi + 1; i < N; i++) {
      const s = this.sOf(i) - ds * 0.5;
      const [pi, he0] = prof2(tail, s);
      // (her tail stirs: slow sweeps of its heading, the tip curling)
      const k = smooth(1.3, 2.2, s);
      const he = he0 + k * (0.18 * Math.sin(t * 0.6 + s * 1.5) + 0.06 * Math.sin(t * 1.7 + s * 4));
      const p = pi + k * 0.12 * Math.max(0, Math.sin(t * 0.9 + 1 + s * 2)) * smooth(1.9, 2.2, s);
      x += Math.sin(he) * Math.cos(p) * ds;
      y += Math.sin(p) * ds;
      z += Math.cos(he) * Math.cos(p) * ds;
      // (lying on the ground, not through it)
      const r = radiusAt(this.radius, this.sOf(i)) * 1.05;
      if (y < r) y = r;
      toW(x, y, z, P[i]);
    }
    // the bones' turn: along the spine, her back to the sky as she lies,
    // and to behind her as she stands up (carried smoothly from her hips)
    const Q = pose.q;
    const back = _v.set(sy, 0, cy); // behind her
    for (let i = 0; i < N; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)];
      const zt = _v2.subVectors(b, a).normalize();
      // her back faces: up where she lies along the ground, behind her
      // where she rises up out of it
      const up = _v3.set(0, 1, 0);
      const rise = Math.abs(zt.y);
      if (rise > 0.35) up.lerp(back, smooth(0.35, 0.8, rise) * (zt.y < 0 ? 1 : -1)).normalize();
      up.addScaledVector(zt, -up.dot(zt)).normalize();
      const xs = _s.crossVectors(up, zt);
      _m.makeBasis(xs, up, zt);
      Q[i].setFromRotationMatrix(_m);
    }
    // her head level, looking ahead
    pose.head.setFromAxisAngle(_Y, yaw);
  }

  // --- blending the ways she can be --------------------------------------------------
  blend(dt, t) {
    const w = this.w;
    const tot = w.fly + w.stand + w.crouch || 1;
    const a = w.fly / tot, b = w.stand / tot, c = w.crouch / tot;
    const F = this.fly, S = this.stand, K = this.crouch;
    for (let i = 0; i < this.N; i++) {
      this.P[i].set(0, 0, 0).addScaledVector(F.p[i], a).addScaledVector(S.p[i], b).addScaledVector(K.p[i], c);
      nlerp3(this.Q[i], F.q[i], a, S.q[i], b, K.q[i], c);
    }
    nlerp3(this.headQ, F.head, a, S.head, b, K.head, c);
    // (blended, she might come up short or long between two shapes: laid
    // back out to her length from her hips)
    if (a < 0.999 && a > 0.001) respace(this.P, this.seg, this.hipI, this._tmp);
  }

  // --- the pose onto the bones ---------------------------------------------------------
  applySpine(dt, t, ctx) {
    const N = this.N;
    const S = this.springs;
    // her plume flutters in the wind
    const fl = smooth(2, 10, this.velRel.length()) * this.w.fly + 0.25;
    for (let i = 0; i < N; i++) {
      const bn = this.sp[i];
      bn.position.copy(this.P[i]);
      bn.quaternion.copy(this.Q[i]);
      if (i > N - 5) {
        const k = (i - (N - 5)) / 4;
        _q.setFromAxisAngle(_Z, 0.22 * fl * k * Math.sin(t * 9 + i * 0.9));
        bn.quaternion.multiply(_q);
      }
    }
    // a landing: her neck dips and her tail whips
    const lk = this.landK * impulse(this.landT, 3.5, 0.45, 0);
    // her head: as it's turned, looking at something (a share of the turn
    // taken by her neck)
    const H = this.b.head;
    H.position.copy(this.P[0]);
    H.quaternion.copy(this.headQ);
    let ly = 0, lp = 0;
    if (this.lookAt && this.lookW > 0) {
      _v.copy(this.lookAt).sub(this.P[0]).applyQuaternion(_q.copy(this.headQ).invert());
      ly = clamp(Math.atan2(-_v.x, -_v.z), -1.1, 1.1) * this.lookW;
      lp = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6) * this.lookW;
    }
    ly = S.lookY.step(ly, 2.2, 0.8, dt);
    lp = S.lookP.step(lp - lk * 0.25, 2.6, 0.75, dt);
    _e.set(lp, ly, 0, 'YXZ');
    H.quaternion.multiply(_q.setFromEuler(_e));
    // (and the neck turns a share of it)
    for (let i = 0; i < 4; i++) {
      const k = [0.45, 0.3, 0.16, 0.06][i];
      _e.set(lp * k * 0.6, ly * k, 0, 'YXZ');
      this.sp[i].quaternion.multiply(_q.setFromEuler(_e));
    }
    this.root.matrixWorld.identity();
    this.body.updateWorldMatrix(false, true);
    // her jaw: snapping, or open as she pants or grins
    const snap = this.snapT < 0.24 ? Math.sin((this.snapT / 0.24) * Math.PI) * (this.snapT < 0.09 ? 1 : 0.4) : 0;
    const jaw = S.jaw.step(clamp(Math.max(this.jawOpen, snap, this.happy * 0.25), 0, 1), 8, 0.7, dt);
    this.b.jaw.rotation.set(-0.5 * jaw, 0, 0);
    this.b.jaw.updateWorldMatrix(false, true);
  }

  // --- the legs ------------------------------------------------------------------------
  // Each wrist (or the ball of each hind foot) goes to a place: tucked up in
  // her own frame as she flies, planted on the ground as she stands; the
  // hand (foot) points along its own way, and the elbow (knee) bends toward
  // its pole.
  solveLegs(dt, t) {
    const w = this.w;
    const tot = w.fly + w.stand + w.crouch || 1;
    const a = w.fly / tot, b = w.stand / tot, c = w.crouch / tot;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwd = _fwd.set(-sy, 0, -cy);
    const sw = Math.sin(t * 1.3);
    for (let i = 0; i < 4; i++) {
      const L = this.legs[i];
      const at = this.sp[L.at];
      at.matrixWorld.decompose(_p, _q, _s);
      const s = L.s;
      // flying: hands curled in under her chest, hind legs trailing back
      const tf = _tf, df = _df, pf = _pf;
      if (L.front) {
        tf.set(s * 0.05, -0.1 + 0.01 * sw, -0.065).applyQuaternion(_q).add(_p);
        df.set(0, -0.55, 0.85).applyQuaternion(_q);
        pf.set(s * 0.4, -0.1, 1).applyQuaternion(_q);
      } else {
        tf.set(s * 0.07, -0.09, 0.42 + 0.015 * sw).applyQuaternion(_q).add(_p);
        df.set(s * 0.1, -0.2, 1).applyQuaternion(_q);
        pf.set(s * 0.3, -1, -0.2).applyQuaternion(_q);
      }
      // standing: hind feet planted under her hips, her hands held before
      // her belly; on all fours, all four planted
      const tg = _tg.set(0, 0, 0), dg = _dg.set(0, 0, 0), pg = _pg.set(0, 0, 0);
      if (b > 0) {
        if (L.front) {
          _v.set(s * 0.055, -0.11 + 0.005 * sw, 0.15).applyQuaternion(_q).add(_p);
          tg.addScaledVector(_v, b);
          dg.addScaledVector(_v.set(0, -0.8, 0.6).applyQuaternion(_q), b);
          pg.addScaledVector(_v.set(s * 0.6, 0.4, 0.5).applyQuaternion(_q), b);
        } else {
          const lx = s * 0.085, lz = STAND_HIPS[2] - 0.03;
          tg.addScaledVector(_v.set(this.spot.x + lx * cy + lz * sy, this.spot.y + 0.028, this.spot.z - lx * sy + lz * cy), b);
          dg.addScaledVector(_v.copy(fwd).setY(-0.35), b);
          pg.addScaledVector(_v.copy(fwd).addScaledVector(_v2.set(cy, 0, -sy), s * 0.25), b);
        }
      }
      if (c > 0) {
        const lx = s * (L.front ? 0.072 : 0.08);
        const lz = L.front ? this.crouchShoulderZ() : CROUCH_HIPS[2] + 0.03;
        tg.addScaledVector(_v.set(this.spot.x + lx * cy + lz * sy, this.spot.y + (L.front ? 0.07 : 0.028), this.spot.z - lx * sy + lz * cy), c);
        dg.addScaledVector(_v.copy(fwd).setY(L.front ? -0.6 : -0.35), c);
        if (L.front) pg.addScaledVector(_v.copy(fwd).negate().addScaledVector(_v2.set(cy, 0, -sy), s * 0.3), c);
        else pg.addScaledVector(_v.copy(fwd).addScaledVector(_v2.set(cy, 0, -sy), s * 0.25), c);
      }
      const T = _t.copy(tf).multiplyScalar(a).add(tg);
      const D = _d.copy(df).multiplyScalar(a).add(dg).normalize();
      const Po = _po.copy(pf).multiplyScalar(a).add(pg).normalize();
      // a landing folds the legs a little
      this.solveLeg(L, T, D, Po);
    }
  }

  crouchShoulderZ() {
    // where her shoulders come to, on all fours (along her back from the
    // hips by its lean)
    if (this._csz === undefined) {
      let z = CROUCH_HIPS[2];
      for (let i = this.hipI - 1; i >= this.shoulderI; i--) z -= Math.cos(prof(CROUCH_UP, this.sOf(i) + this.seg * 0.5)) * this.seg;
      this._csz = z;
    }
    return this._csz;
  }

  // Aim a bone so its rest offset to the next joint points along dir (world).
  aim(bone, rest, dir) {
    bone.parent.matrixWorld.decompose(_p, _q, _s);
    _v3.copy(rest).normalize().applyQuaternion(_q);
    _qd.setFromUnitVectors(_v3, _v2.copy(dir).normalize());
    _q2.copy(_q).invert();
    bone.quaternion.copy(_q2).multiply(_qd).multiply(_q);
    bone.updateWorldMatrix(false, true);
  }

  solveLeg(L, target, dir, pole) {
    const b = this.b;
    const hand = _hand.copy(dir).multiplyScalar(L.hand.length());
    const root = _root.setFromMatrixPosition(b[L.bones[0]].matrixWorld);
    const end = _end.copy(target);
    if (L.front) {
      const elbow = ik(root, end, L.a, L.b, pole, _mid);
      fitEnd(elbow, end, L.b);
      this.aim(b[L.bones[0]], L.rest[0], _dd.subVectors(elbow, root));
      this.aim(b[L.bones[1]], L.rest[1], _dd.subVectors(end, elbow));
      this.aim(b[L.bones[2]], L.rest[2], hand);
    } else {
      // hip -> stifle (forward) -> hock (back) -> foot: the cannon kept
      // parallel to the thigh, a two-bone solve of (thigh + cannon, shin)
      const knee = ik(root, end, L.thigh + L.meta, L.shin, pole, _mid);
      fitEnd(knee, end, L.shin);
      const u1 = _u1.subVectors(knee, root).normalize();
      const stifle = _st.copy(root).addScaledVector(u1, L.thigh);
      const hock = _hk.subVectors(end, knee).normalize().multiplyScalar(L.shin).add(stifle);
      this.aim(b[L.bones[0]], L.rest[0], _dd.subVectors(stifle, root));
      this.aim(b[L.bones[1]], L.rest[1], _dd.subVectors(hock, stifle));
      this.aim(b[L.bones[2]], L.rest[2], u1);
      this.aim(b[L.bones[3]], L.rest[3], hand);
    }
  }

  // --- her whiskers ---------------------------------------------------------------------
  // Each a chain of particles from her snout, in the runner's frame:
  // flung by every turn of her head, blown back by the wind, drooping in
  // long curves when she's still; held loosely to that shape, stiff at the
  // root and soft at the tip.
  whiskerSim(dt, t, ctx) {
    const head = this.b.head;
    head.matrixWorld.decompose(_p, _q, _s);
    const fz = ctx.frameZ;
    // the air: the wind she streams in, less how her head moves through it
    const air = _air.set(-this.velRel.x, -this.velRel.y, -this.velRel.z);
    const wz = ctx.wind || 0;
    const as = air.length();
    // (standing still, nothing blows them about)
    const stream = smooth(0.8, 9, as) * (0.15 + 0.85 * this.w.fly);
    if (as > 1e-3) air.divideScalar(as);
    const steps = Math.min(4, Math.max(1, Math.round(dt * 120)));
    const h = dt / steps;
    for (const Wk of this.whiskers) {
      const n = Wk.n, L = Wk.seg, s = Wk.s;
      const root = _r0.copy(Wk.root).sub(this.bind.head).applyQuaternion(_q).add(_p);
      root.z -= fz;
      if (!Wk.ready || dt <= 0) {
        Wk.p[0].copy(root);
        for (let i = 1; i < n; i++) {
          this.whiskerRest(Wk, i, _q, _v2);
          Wk.p[i].copy(Wk.p[i - 1]).addScaledVector(_v2, L);
        }
        for (let i = 0; i < n; i++) Wk.o[i].copy(Wk.p[i]);
        Wk.ready = true;
      } else {
        const r0 = _r1.copy(Wk.p[0]);
        for (let st = 0; st < steps; st++) {
          Wk.p[0].lerpVectors(r0, root, (st + 1) / steps);
          Wk.o[0].copy(Wk.p[0]);
          for (let i = 1; i < n; i++) {
            const p = Wk.p[i], o = Wk.o[i];
            const k = i / (n - 1);
            // carried on, dragged toward the air's own motion (the wind,
            // in this frame), weighed down
            _v.subVectors(p, o);
            const c = (2.2 + 1.5 * this.wet) * h;
            _v.x -= _v.x * c;
            _v.y -= _v.y * c;
            _v.z += (wz * h - _v.z) * c;
            o.copy(p);
            p.add(_v);
            p.y -= (1.2 - 0.8 * this.wet) * h * h;
            // toward the shape: the rest curve from her snout, streamed back
            this.whiskerRest(Wk, i, _q, _v2);
            _v2.lerp(air, stream * (0.45 + 0.45 * k)).normalize();
            _v3.copy(Wk.p[i - 1]).addScaledVector(_v2, L);
            const stiff = lerp(0.42, 0.06, Math.pow(k, 0.7)) * Math.min(1, h * 60);
            p.lerp(_v3, stiff);
            // a little flutter in the wind, running down it
            const fl = stream * k * 0.0035;
            p.x += fl * Math.sin(t * 13 + k * 5 + s);
            p.y += fl * Math.sin(t * 11 + k * 4 + 1);
          }
          // kept to their length, from the root
          for (let i = 1; i < n; i++) {
            const p = Wk.p[i];
            _v.subVectors(p, Wk.p[i - 1]);
            const d = _v.length() || 1;
            p.copy(Wk.p[i - 1]).addScaledVector(_v, L / d);
            if (p.y < 0.012) p.y = 0.012;
          }
        }
      }
      // onto the bones (each turned from straight back, +z)
      for (let i = 0; i < n - 1; i++) {
        const bn = this.b['wh' + Wk.L + i];
        bn.position.copy(Wk.p[i]);
        bn.position.z += fz;
        _v.subVectors(Wk.p[i + 1], Wk.p[i]).normalize();
        bn.quaternion.setFromUnitVectors(_Z, _v);
        bn.updateMatrixWorld();
      }
    }
  }

  // The way whisker segment i lies at rest, out from her snout and drooping
  // down in a long curve (world, given her head's turn q).
  whiskerRest(Wk, i, q, out) {
    const k = i / (Wk.n - 1);
    out.set(Wk.s * lerp(0.55, 0.12, k), lerp(-0.25, -0.9, Math.pow(k, 0.8)), lerp(0.8, 0.42, k));
    return out.normalize().applyQuaternion(q);
  }

  // --- her frills -------------------------------------------------------------------------
  // On springs: laid back by the wind and the pace, flattened when she's
  // startled, flaring when she's pleased, flicking with every jolt.
  frillsSim(dt, t) {
    const S = this.springs;
    const wind = smooth(1, 12, this.velRel.length()) * this.w.fly;
    const jolt = clamp(-this.acc.y * 0.028, -0.35, 0.35);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const fr = this.b['frill' + (i ? 'R' : 'L')];
      const breathe = 0.06 * Math.sin(t * 1.7 + i);
      const back = (i ? S.frillR : S.frillL).step(0.35 * wind + 0.5 * this.alarm - 0.25 * this.happy + breathe, 4.5, 0.35, dt) + jolt;
      const out = (i ? S.frillRo : S.frillLo).step(0.15 * this.happy - 0.2 * this.alarm + 0.04 * Math.sin(t * 2.3 + i * 2), 4, 0.4, dt);
      fr.rotation.set(0, -s * back * 0.9, s * out);
      fr.updateMatrixWorld(true);
    }
  }

  placeShadow() {
    // the frame round her whole body (the spine's points are in the scene)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
    for (let i = 0; i < this.N; i++) {
      const p = this.P[i];
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
      if (p.z < z0) z0 = p.z;
      if (p.z > z1) z1 = p.z;
      y += p.y;
    }
    y /= this.N;
    const m = 0.5; // (her legs, antlers and mane round the spine)
    const k = 1 - 0.6 * smooth(0.6, 4.5, y);
    const near = clamp(1 - (y0 - 0.25) * 2.2, 0, 1);
    this.cast.aim(x0 - m, x1 + m, Math.max(0, y0 - m), y1 + m, z0 - m, z1 + m, 0, this.P[Math.round(this.N * 0.35)].x, this.P[Math.round(this.N * 0.35)].z, {
      alpha: 0.9 * k,
      contact: 0.25 * near,
      reach: 0.5,
      blur: 0.02 * y,
    });
  }

  forCompile(on) {
    this.root.visible = true;
    this.shadow.visible = on;
  }
}

// --- helpers ------------------------------------------------------------------------------

function prof2(keys, s) {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][0]) {
      const k = (s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      const e = k * k * (3 - 2 * k);
      return [lerp(keys[i - 1][1][0], keys[i][1][0], e), lerp(keys[i - 1][1][1], keys[i][1][1], e)];
    }
  }
  return keys[keys.length - 1][1];
}

function radiusAt(keys, s) {
  if (s <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (s <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], (s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  return keys[keys.length - 1][1];
}

// Catmull-Rom through p1..p2 (u 0..1), p0 and p3 the neighbours.
function catmull(p0, p1, p2, p3, u, out) {
  const u2 = u * u, u3 = u2 * u;
  const a = -0.5 * u3 + u2 - 0.5 * u, b = 1.5 * u3 - 2.5 * u2 + 1, c = -1.5 * u3 + 2 * u2 + 0.5 * u, d = 0.5 * u3 - 0.5 * u2;
  return out.set(p0.x * a + p1.x * b + p2.x * c + p3.x * d, p0.y * a + p1.y * b + p2.y * c + p3.y * d, p0.z * a + p1.z * b + p2.z * c + p3.z * d);
}

// Lay a chain of points back out so each is seg from the next, keeping their
// directions, outward from point `from`.
function respace(P, seg, from, tmp) {
  for (let i = 0; i < P.length; i++) tmp[i].copy(P[i]);
  for (let i = from + 1; i < P.length; i++) {
    _v.subVectors(tmp[i], tmp[i - 1]);
    const l = _v.length();
    if (l > 1e-8) P[i].copy(P[i - 1]).addScaledVector(_v, seg / l);
  }
  for (let i = from - 1; i >= 0; i--) {
    _v.subVectors(tmp[i], tmp[i + 1]);
    const l = _v.length();
    if (l > 1e-8) P[i].copy(P[i + 1]).addScaledVector(_v, seg / l);
  }
}

// Weighted blend of three quaternions (each aligned to the first).
function nlerp3(out, a, wa, b, wb, c, wc) {
  const sb = a.dot(b) < 0 ? -1 : 1, sc = a.dot(c) < 0 ? -1 : 1;
  out.set(a.x * wa + b.x * wb * sb + c.x * wc * sc, a.y * wa + b.y * wb * sb + c.y * wc * sc, a.z * wa + b.z * wb * sb + c.z * wc * sc, a.w * wa + b.w * wb * sb + c.w * wc * sc);
  return out.normalize();
}

// The impulse response of a damped spring, peaking at about 1.
function impulse(t, freq, zeta, delay) {
  t -= delay;
  if (t <= 0) return 0;
  const w = TAU * freq, r = Math.sqrt(1 - zeta * zeta);
  if (t * zeta * w > 8) return 0;
  const peak = r * Math.exp((-zeta / r) * Math.atan(r / zeta));
  return (Math.exp(-zeta * w * t) * Math.sin(w * r * t)) / peak;
}

const _e = new THREE.Euler();
const _fwd = new THREE.Vector3();
const _tf = new THREE.Vector3();
const _df = new THREE.Vector3();
const _pf = new THREE.Vector3();
const _tg = new THREE.Vector3();
const _dg = new THREE.Vector3();
const _pg = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _po = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _root = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dd = new THREE.Vector3();
const _u1 = new THREE.Vector3();
const _st = new THREE.Vector3();
const _hk = new THREE.Vector3();
const _air = new THREE.Vector3();
const _r0 = new THREE.Vector3();
const _r1 = new THREE.Vector3();
const _dn = new THREE.Vector3();
const _bn = new THREE.Vector3();

// Two-bone IK: the middle joint for a chain from root toward target
// (lengths a, b), bending toward pole.
function ik(root, target, a, b, pole, out) {
  _dn.subVectors(target, root);
  let L = _dn.length();
  _dn.divideScalar(L || 1);
  L = clamp(L, Math.abs(a - b) + 0.002, a + b - 0.002);
  _bn.copy(pole).addScaledVector(_dn, -pole.dot(_dn)).normalize();
  const cosA = clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  return out.copy(root).addScaledVector(_dn, a * cosA).addScaledVector(_bn, a * sinA);
}

function fitEnd(mid, end, b) {
  _v.subVectors(end, mid);
  const l = _v.length() || 1;
  end.copy(mid).addScaledVector(_v, b / l);
  return end;
}

// Her mane again, SHELLS times over, for the layers of its fur (only the
// mane grows them).
function shellGeometry(geo, layers) {
  const src = geo.attributes;
  const count = src.position.count;
  const idx = geo.index.array;
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i];
    if (src.aMat.getX(a) === 2 && src.aMat.getX(idx[i + 1]) === 2 && src.aMat.getX(idx[i + 2]) === 2) keep.push(a, idx[i + 1], idx[i + 2]);
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aD', 'aMat', 'skinIndex', 'skinWeight']) {
    const a = src[name];
    const arr = new a.array.constructor(a.array.length * layers);
    for (let l = 0; l < layers; l++) arr.set(a.array, l * a.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  const shell = new Float32Array(count * layers);
  for (let l = 0; l < layers; l++) shell.fill((l + 1) / layers, l * count, (l + 1) * count);
  out.setAttribute('aShell', new THREE.BufferAttribute(shell, 1));
  const total = count * layers;
  const ix = total < 65536 ? new Uint16Array(keep.length * layers) : new Uint32Array(keep.length * layers);
  for (let l = 0; l < layers; l++) for (let i = 0; i < keep.length; i++) ix[l * keep.length + i] = keep[i] + l * count;
  out.setIndex(new THREE.BufferAttribute(ix, 1));
  return out;
}
