import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials, makeEnvUniforms } from '../render/shaders.js';
import { palette, bodyGeometry } from './kit.js';
import { TAU, clamp, smooth, Spring } from './rig.js';

// Sorrel, the red fox who runs with you: the body and how it moves. Sculpted
// offline (tools/runner/fox.py) as one continuous coat with its jaw, ears and
// brush of a tail, skinned to a quadruped's skeleton; drawn with the runners'
// illustrated shader (FOX in CHAR_DETAIL: the coat brushed in strokes along
// the lie of the fur, the white torn into points where it meets the red, dark
// stockings, black-backed ears, a sly amber eye) and a short pile of fur grown
// over all of it (SHELL: the surface again a few times over, each layer
// lifted off it and thinned to strands, combed by the wind).
//
// Nothing here decides where she goes - that's the companion's job
// (companion.js), which hands her a place in the world, how fast she's
// moving over the ground and what she's doing each frame. This module turns
// that into a fox:
//   - a rotary gallop, the legs placed by IK along designed paths: the
//     forefeet land one after the other and vault the body over them, the
//     back gathers as the hind legs swing under, they drive off and she
//     flies stretched out flat - the spine flexing and extending through
//     every stride, the head held level through all of it;
//   - leaps (stretched out over a hurdle), the mousing pounce (up, over, and
//     down nose first), little hops to snap at a gem, a twirl for the joy of
//     it; sitting with her tail curled round her paws; crouched riding on a
//     runner's shoulder; slinking low;
//   - her tail simulated as a chain of particles: held by her mood (level
//     at a gallop, waving when she's pleased, curled round her when she
//     sits), swung by every turn, take-off and landing, streamed back by the
//     headwind and fluttering in it;
//   - ears on springs (pricked, swivelling, laid back by the wind, flattened
//     when she slinks), a jaw that snaps, blinks and a happy squint.

export const COL = {
  1: '#e0702a', // coat
  2: '#e0702a', // tail
  3: '#e0702a', // ears
  4: '#e0702a', // jaw (white all over: see fox.py)
  5: '#4a1c20', // inside the mouth
  13: '#f6a548', // light strokes
  14: '#b34a1c', // deep strokes, the back
  15: '#fbf4ea', // white
  16: '#e9d8c4', // white in its own shade
  17: '#3b2620', // stockings
  18: '#1f1513', // the backs of the ears, the darkest of the stockings
  19: '#1b1311', // nose
  20: '#5a2226', // mouth
  23: '#f2b23a', // iris
  24: '#1a1210', // ink: rims, pupils
  25: '#f3dfc8', // inside the ears
  27: '#ffd36a', // the iris round the pupil
  30: '#ffe0a8', // sunlit fur
};

// The layers of fur, and how they're combed.
const SHELLS = 4;

// --- pose channels ---------------------------------------------------------------
const NAMES = [
  'y', 'z', 'pitch', 'roll', 'flex', 'bend',
  'neckP', 'neckY', 'headP', 'headY', 'headR',
  'fLx', 'fLy', 'fLz', 'fRx', 'fRy', 'fRz', 'hLx', 'hLy', 'hLz', 'hRx', 'hRy', 'hRz',
  'pawL', 'pawR', 'toeL', 'toeR',
  'tailLift', 'tailEnd', 'tailSide', 'tailWag',
  'earBack', 'earOut', 'jaw',
];
const C = {};
NAMES.forEach((n, i) => (C[n] = i));
const N = NAMES.length;
const FEET = [
  [C.fLx, C.fLy, C.fLz],
  [C.fRx, C.fRy, C.fRz],
  [C.hLx, C.hLy, C.hLz],
  [C.hRx, C.hRy, C.hRz],
];

const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _key = [0, 0, 0];
const _e = new THREE.Euler();

export class Fox {
  constructor(env, asset) {
    this.asset = asset;
    this.rig = asset.meta.rig;
    this.u = makeEnvUniforms(env);
    this.root = new THREE.Group();
    this.root.name = 'fox';
    this.buildSkeleton();
    this.buildLook();
    this.buildShadow();
    this.pose = new Float32Array(N);
    this.pGallop = new Float32Array(N);
    this.pStand = new Float32Array(N);
    this.pSit = new Float32Array(N);
    this.pAir = new Float32Array(N);
    this.pRide = new Float32Array(N);
    this.wS = { gallop: new Spring(), stand: new Spring(1), sit: new Spring(), air: new Spring(), ride: new Spring() };
    this.w = { gallop: 0, stand: 1, sit: 0, air: 0, ride: 0 };
    this.springs = {};
    for (const k of ['headP', 'headY', 'neckY', 'roll', 'bend', 'earL', 'earR', 'earLo', 'earRo', 'earLs', 'earRs', 'jaw', 'land', 'low', 'wag', 'lift']) this.springs[k] = new Spring();
    this.tail = this.buildTail();
    this.face = new THREE.Vector4(1, 0, 0, 0);
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
    // where every joint sits as bound (root space), and each bone's rest
    // offset to the next joint along its limb
    this.bind = {};
    for (const b of bones) this.bind[b.name] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const R = this.rig;
    const v = (a) => new THREE.Vector3().fromArray(a);
    this.legs = [];
    for (const [s, L] of [[-1, 'L'], [1, 'R']]) {
      const F = {};
      for (const k in R.front) F[k] = v(R.front[k]).setX(s * R.front[k][0]);
      this.legs.push({
        front: true, L, s,
        bones: ['arm' + L, 'fore' + L, 'paw' + L],
        a: F.shoulder.distanceTo(F.elbow),
        b: F.elbow.distanceTo(F.wrist),
        paw: F.toe.clone().sub(F.wrist), // the paw, wrist to toes, as bound
        toe: F.toe,
        rest: [F.elbow.clone().sub(F.shoulder), F.wrist.clone().sub(F.elbow), F.toe.clone().sub(F.wrist)],
      });
    }
    for (const [s, L] of [[-1, 'L'], [1, 'R']]) {
      const H = {};
      for (const k in R.hind) H[k] = v(R.hind[k]).setX(s * R.hind[k][0]);
      this.legs.push({
        front: false, L, s,
        bones: ['thigh' + L, 'shin' + L, 'meta' + L, 'foot' + L],
        thigh: H.hip.distanceTo(H.stifle),
        shin: H.stifle.distanceTo(H.hock),
        meta: H.hock.distanceTo(H.foot),
        paw: H.toe.clone().sub(H.foot),
        toe: H.toe,
        rest: [H.stifle.clone().sub(H.hip), H.hock.clone().sub(H.stifle), H.foot.clone().sub(H.hock), H.toe.clone().sub(H.foot)],
      });
    }
    this.tailRest = this.bind.tail1.clone().sub(this.bind.tail0);
    this.tailSeg = this.tailRest.length();
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    this.furWind = new THREE.Vector4(0, -0.25, 0.5, 1);
    this.faceU = { value: new THREE.Vector4(1, 0, 0, 0) };
    const mats = makeCharacterMaterials(this.u, palette(COL), [], 0.0085, null, { style: 'fox', uniforms: { uFace: this.faceU }, shell: this.furWind });
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

  buildShadow() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0.3 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uAlpha; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.25, 1.0, r)) * uAlpha; gl_FragColor = vec4(0.06, 0.03, 0.1, a); }',
      transparent: true,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(geo, mat);
    this.shadow.renderOrder = -19;
    this.shadow.frustumCulled = false;
  }

  get objects() {
    return [this.root, this.shadow];
  }

  // --- the tail ---------------------------------------------------------------------
  // A chain of particles from the root of the tail to its tip, simulated in a
  // frame that moves with the fox but doesn't turn with her (so every turn of
  // her body swings it, and it lags), in world axes.
  buildTail() {
    const n = this.rig.tail.bones + 1;
    return {
      n,
      p: Array.from({ length: n }, () => new THREE.Vector3()),
      v: Array.from({ length: n }, () => new THREE.Vector3()),
      o: Array.from({ length: n }, () => new THREE.Vector3()),
      dir: Array.from({ length: n }, () => new THREE.Vector3()),
      ready: false,
    };
  }

  reset() {
    this.time = 0;
    this.phase = 0;
    this.lead = 1;
    this.leadX = 1;
    this.speed = 0;
    this.mode = 'sit';
    this.airT = 0;
    this.airDur = 1;
    this.airKind = 'leap';
    this.landClock = 9;
    this.landHit = 0;
    this.low = 0;
    this.happy = 0;
    this.wag = 0;
    this.earsBack = 0;
    this.jawOpen = 0;
    this.snapT = 9;
    this.blinkT = 2;
    this.blink = 0;
    this.lookAt = null;
    this.lookW = 0;
    this.earBias = 0;
    this.jawOpen = 0;
    this.lowTarget = 0;
    this.twitch = [9, 9];
    this.spin = 0;
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.velS = new THREE.Vector3();
    this.lat = 0;
    for (const k in this.wS) this.wS[k].reset(k === 'sit' ? 1 : 0);
    for (const s of Object.values(this.springs)) s.reset();
    this.tail.ready = false;
    this.root.visible = true;
  }

  // --- the frame ----------------------------------------------------------------------
  // ctx: { speed: m/s over the ground, vel: world velocity, mode: 'run' |
  // 'air' | 'sit' | 'stand' | 'ride', airT / airDur / airKind while in the
  // air, low: 0..1 slinking, lat: sideways speed (m/s, + to her right) }
  update(dt, ctx) {
    this.time += dt;
    const t = this.time;
    this.speed = ctx.speed;
    this.mode = ctx.mode;
    this.lat = ctx.lat || 0;
    if (ctx.vel) {
      if (!this.tail.ready) this.velS.copy(ctx.vel);
      _v.copy(this.velS);
      this.velS.lerp(ctx.vel, 1 - Math.exp(-dt * 30));
      if (dt > 0) this.acc.subVectors(this.velS, _v).divideScalar(dt).clampLength(0, 80);
      this.vel.copy(ctx.vel);
    }
    if (this.mode === 'air') {
      this.airT = ctx.airT;
      this.airDur = ctx.airDur;
      this.airKind = ctx.airKind;
    }
    this.landClock += dt;
    this.snapT += dt;
    // gallop: strides a second rise with the pace; the lead changes to the
    // inside of a turn
    const run = this.mode === 'run';
    const freq = run ? clamp(2.0 + 0.085 * this.speed, 2.2, 4.4) : 0;
    this.phase = (this.phase + dt * freq) % 1;
    if (Math.abs(this.lat) > 2.5) this.lead = this.lat > 0 ? 1 : -1;
    this.leadX += (this.lead - this.leadX) * (1 - Math.exp(-dt * 10));

    // blinks, now and then; a happy squint when she's pleased
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.13;
      this.blinkT = 1.8 + Math.random() * 4.2 + (Math.random() < 0.2 ? -1.5 : 0);
    }
    this.blink = Math.max(0, this.blink - dt);
    const bl = this.blink > 0 ? Math.sin((this.blink / 0.13) * Math.PI) : 0;
    this.faceU.value.set(clamp(1 - bl * 1.2, 0, 1) * (1 - 0.35 * this.low), clamp(this.happy, 0, 1), this.faceU.value.z, this.faceU.value.w);

    this.animate(dt, t);
  }

  // A landing of strength k (1 a plain leap).
  land(k = 1) {
    this.landClock = 0;
    this.landHit = k;
    this.phase = 0.0;
  }

  // Snap the jaws (at a gem).
  snap() {
    this.snapT = 0;
  }

  // An ear flicks (0 left, 1 right).
  flick(i) {
    this.twitch[i] = 0;
  }

  landCurve(t) {
    const f = 5, z = 0.4, r = Math.sqrt(1 - z * z);
    const w = TAU * f, wd = w * r;
    if (t * z * w > 7) return 0;
    return Math.exp(-z * w * t) * Math.sin(wd * t) * 1.4 * (1 - Math.exp(-t / 0.02));
  }

  animate(dt, t) {
    const m = this.mode;
    let tg = 0, ts = 0, tsit = 0, ta = 0, tr = 0;
    if (m === 'run') {
      const k = smooth(0.4, 2.2, this.speed);
      tg = k;
      ts = 1 - k;
    } else if (m === 'air') ta = 1;
    else if (m === 'sit') tsit = 1;
    else if (m === 'ride') tr = 1;
    else ts = 1;
    const W = this.wS;
    this.w.gallop = Math.max(0, W.gallop.step(tg, 4.5, 0.9, dt));
    this.w.stand = Math.max(0, W.stand.step(ts, 3.5, 0.9, dt));
    this.w.sit = Math.max(0, W.sit.step(tsit, 2.2, 0.95, dt));
    this.w.air = Math.max(0, W.air.step(ta, 7, 0.85, dt));
    this.w.ride = Math.max(0, W.ride.step(tr, 4, 0.9, dt));
    this.low = this.springs.low.step(this.lowTarget || 0, 3.5, 0.9, dt);

    this.poseGallop(this.pGallop, this.phase, t);
    this.poseStand(this.pStand, t);
    this.poseSit(this.pSit, t);
    this.poseAir(this.pAir, clamp(this.airT / Math.max(0.05, this.airDur), 0, 1), this.airKind);
    this.poseRide(this.pRide, t);
    const w = this.w;
    const total = w.gallop + w.stand + w.sit + w.air + w.ride || 1;
    const P = this.pose;
    for (let i = 0; i < N; i++) P[i] = (this.pGallop[i] * w.gallop + this.pStand[i] * w.stand + this.pSit[i] * w.sit + this.pAir[i] * w.air + this.pRide[i] * w.ride) / total;

    // landing: the body drops into her legs and springs back
    const land = this.landHit * this.landCurve(this.landClock);
    P[C.y] -= 0.07 * land;
    P[C.flex] += 0.14 * land;
    P[C.pitch] -= 0.05 * land;
    P[C.neckP] -= 0.12 * land;
    P[C.tailLift] += 0.25 * land;
    // slinking: low to the ground, head down and forward, ears flat, tail low
    const lo = this.low;
    if (lo > 0.001) {
      P[C.y] -= 0.12 * lo;
      P[C.neckP] -= 0.3 * lo;
      P[C.headP] += 0.25 * lo;
      P[C.earBack] = lerp(P[C.earBack], 1.25, lo);
      P[C.tailLift] -= 0.3 * lo;
      for (const [, iy] of FEET) P[iy] = Math.min(P[iy], 0.012 + (P[iy] - 0.012) * (1 - 0.5 * lo));
    }
    // turning: she banks into it, the spine bends toward it, the head leads
    const S = this.springs;
    const lat = this.mode === 'ride' ? 0 : this.lat;
    P[C.roll] += S.roll.step(clamp(-this.acc.x * 0.012, -0.35, 0.35), 2.6, 0.6, dt);
    P[C.bend] += S.bend.step(clamp(lat * 0.03, -0.3, 0.3), 3, 0.7, dt);
    P[C.headY] += 0.6 * P[C.bend];
    // pleased: the tail sweeps (wags) and lifts
    P[C.tailWag] += this.springs.wag.step(this.wag, 2, 0.9, dt);
    // the jaw: snapping at something, or open as she pants
    const snap = this.snapT < 0.22 ? Math.sin((this.snapT / 0.22) * Math.PI) * (this.snapT < 0.08 ? 1 : 0.4) : 0;
    P[C.jaw] = Math.max(P[C.jaw], this.jawOpen, snap);
    // looking at something: neck and head turn toward it (a share each), on
    // springs
    if (this.lookAt && this.lookW > 0) {
      _v.copy(this.lookAt).sub(this.bind.head);
      const yaw = clamp(Math.atan2(-_v.x, -_v.z), -1.6, 1.6);
      const pit = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.7);
      P[C.neckY] += yaw * 0.45 * this.lookW;
      P[C.headY] += yaw * 0.55 * this.lookW;
      P[C.headP] += pit * 0.6 * this.lookW;
    }
    P[C.headY] = S.headY.step(P[C.headY], 3.2, 0.7, dt);
    P[C.neckY] = S.neckY.step(P[C.neckY], 2.6, 0.75, dt);
    P[C.headP] = S.headP.step(P[C.headP], 4.5, 0.6, dt);

    this.applyPose(P, dt, t);
  }

  // --- poses -----------------------------------------------------------------------
  // Feet: where each paw's toes go, in her own space (y up from the road
  // under her, -z ahead).
  setFoot(P, i, x, y, z) {
    const f = FEET[i];
    P[f[0]] = x;
    P[f[1]] = y;
    P[f[2]] = z;
  }

  // The rotary gallop (with a right lead: left fore, right fore, right hind,
  // left hind; mirrored with a left). u for each leg: 0 at touchdown, its
  // stance until `duty`, then the swing - the forefoot flicked back and
  // folded up under the chest, then reaching far out ahead; the hind foot
  // kicked out behind, swung forward folded, and planted well forward under
  // the belly. The spine gathers between the fore and hind footfalls and
  // stretches out in the flight after the hind drive.
  poseGallop(P, ph, t) {
    const v = this.speed;
    const sp = clamp((v - 4) / 24, 0, 1);
    const s = 0.35 + 0.65 * smooth(1, 14, v);
    const duty = lerp(0.36, 0.2, sp);
    const lx = this.leadX;
    // touchdown times: the trailing fore, the leading fore, then the hinds
    const offs = [0.04 - 0.04 * lx, 0.04 + 0.04 * lx, 0.54 + 0.04 * lx, 0.54 - 0.04 * lx];
    for (let i = 0; i < 4; i++) {
      const leg = this.legs[i];
      const front = i < 2;
      const u = (ph - offs[i] + 1) % 1;
      const toe = leg.toe;
      let z, y, curl;
      if (front) {
        const zTD = -0.06 - 0.16 * s, zLO = 0.04 + 0.13 * s;
        if (u < duty) {
          const c = u / duty;
          z = lerp(zTD, zLO, c);
          y = 0;
          curl = -0.7 * smooth(0.55, 1, c);
        } else {
          const keys = this.frontSwing || (this.frontSwing = []);
          keys.length = 0;
          keys.push([0, zLO, 0], [0.14, zLO + 0.08, 0.075], [0.45, 0.02, 0.17], [0.78, zTD - 0.13 * s, 0.11], [0.999, zTD, 0.002]);
          const c = (u - duty) / (1 - duty);
          pathLine(keys, c, _key);
          z = _key[0];
          y = Math.max(0, _key[1]);
          curl = -0.7 - 1.0 * smooth(0, 0.25, c) + 1.95 * smooth(0.45, 0.85, c) - 0.25 * smooth(0.85, 1, c);
        }
      } else {
        const zTD = -0.05 - 0.13 * s, zLO = 0.06 + 0.2 * s;
        if (u < duty) {
          const c = u / duty;
          z = lerp(zTD, zLO, c);
          y = 0;
          curl = 0.5 * smooth(0.5, 1, c);
        } else {
          const keys = this.hindSwing || (this.hindSwing = []);
          keys.length = 0;
          keys.push([0, zLO, 0], [0.18, zLO + 0.15 * s, 0.09], [0.55, 0.0, 0.15], [0.82, zTD - 0.08 * s, 0.08], [0.999, zTD, 0.002]);
          const c = (u - duty) / (1 - duty);
          pathLine(keys, c, _key);
          z = _key[0];
          y = Math.max(0, _key[1]);
          curl = 0.5 + 0.5 * smooth(0, 0.2, c) - 1.2 * smooth(0.3, 0.7, c) + 0.2 * smooth(0.8, 1, c);
        }
      }
      this.setFoot(P, i, toe.x, toe.y + y, toe.z + z);
      P[front ? (i === 0 ? C.pawL : C.pawR) : i === 2 ? C.toeL : C.toeR] = curl;
    }
    // the body over the legs: the spine gathers (+) in the flight after the
    // forefeet and stretches out (-) in the flight after the hinds; it rides
    // highest in each flight, and pitches nose down over the forefeet, up
    // as the hinds drive
    const k = 0.25 + 0.75 * smooth(2, 10, v);
    const fl = Math.cos(TAU * (ph - 0.36));
    P[C.flex] = (0.12 + 0.12 * sp) * fl * k;
    P[C.y] = (0.028 * (0.5 + 0.5 * Math.cos(2 * TAU * (ph - 0.38))) - 0.018) * k;
    P[C.pitch] = -0.075 * Math.cos(TAU * (ph - 0.13)) * k;
    P[C.z] = 0.02 * Math.sin(TAU * (ph - 0.2)) * k;
    P[C.roll] = 0.02 * Math.sin(TAU * ph) * lx;
    P[C.bend] = 0;
    // the head held level, low and forward, eyes on the road
    P[C.neckP] = -0.35 - 0.12 * sp;
    P[C.neckY] = 0;
    P[C.headP] = 0.28 + 0.1 * sp - P[C.pitch] - 0.45 * P[C.flex] * 0.6;
    P[C.headY] = 0;
    P[C.headR] = 0;
    // the tail held out level behind, pumping with the stride
    // (it rides the pelvis, which tucks and tips with the spine; held half
    // against that, it undulates rather than flapping)
    P[C.tailLift] = 0.1 + 0.28 * P[C.flex] + 0.05 * sp;
    P[C.tailEnd] = P[C.tailLift] + 0.12;
    P[C.tailSide] = 0;
    P[C.tailWag] = 0;
    P[C.earBack] = 0.35 + 0.45 * sp;
    P[C.earOut] = 0.05;
    P[C.jaw] = 0.12 * sp * (0.5 + 0.5 * Math.sin(TAU * ph));
  }

  // Standing: square on her feet, breathing, the tail low and easy.
  poseStand(P, t) {
    const br = Math.sin(t * 2.4);
    for (let i = 0; i < 4; i++) {
      const toe = this.legs[i].toe;
      this.setFoot(P, i, toe.x, toe.y, toe.z);
    }
    P[C.pawL] = P[C.pawR] = P[C.toeL] = P[C.toeR] = 0;
    P[C.y] = 0.004 * br - 0.01;
    P[C.z] = 0;
    P[C.pitch] = 0.02;
    P[C.roll] = 0;
    P[C.flex] = 0.03;
    P[C.bend] = 0;
    P[C.neckP] = 0.1 + 0.02 * br;
    P[C.neckY] = 0.1 * Math.sin(t * 0.5);
    P[C.headP] = -0.12;
    P[C.headY] = 0.25 * Math.sin(t * 0.37);
    P[C.headR] = 0.05 * Math.sin(t * 0.6);
    P[C.tailLift] = -0.55;
    P[C.tailEnd] = -0.12;
    P[C.tailSide] = 0;
    P[C.tailWag] = 0;
    P[C.earBack] = -0.05;
    P[C.earOut] = 0.05;
    P[C.jaw] = 0;
  }

  // Sitting: haunches down, forelegs straight, chest up, head up and
  // looking about; her tail swept round in front of her paws.
  poseSit(P, t) {
    const br = Math.sin(t * 2.1);
    P[C.y] = -0.135 + 0.003 * br;
    P[C.z] = 0.03;
    P[C.pitch] = 0.56;
    P[C.roll] = 0;
    P[C.flex] = -0.02;
    P[C.bend] = 0;
    const F = this.legs;
    this.setFoot(P, 0, F[0].toe.x * 0.9, F[0].toe.y, -0.175);
    this.setFoot(P, 1, F[1].toe.x * 0.9, F[1].toe.y, -0.175);
    this.setFoot(P, 2, F[2].toe.x * 1.15, F[2].toe.y, -0.03);
    this.setFoot(P, 3, F[3].toe.x * 1.15, F[3].toe.y, -0.03);
    P[C.pawL] = P[C.pawR] = 0.05;
    P[C.toeL] = P[C.toeR] = 0;
    P[C.neckP] = 0.32 + 0.015 * br;
    P[C.neckY] = 0.12 * Math.sin(t * 0.31 + 1);
    P[C.headP] = -0.62;
    P[C.headY] = 0.35 * Math.sin(t * 0.29) + 0.15 * Math.sin(t * 0.83);
    P[C.headR] = 0.12 * Math.sin(t * 0.47 + 0.5);
    P[C.tailLift] = -0.55;
    P[C.tailEnd] = -0.05;
    P[C.tailSide] = 0.95;
    P[C.tailWag] = 0;
    P[C.earBack] = -0.12;
    P[C.earOut] = 0.08;
    P[C.jaw] = 0;
  }

  // In the air (p: 0..1 through the flight). leap: stretched out flat over
  // a hurdle, forelegs reaching, hinds trailing, then gathering to land
  // forefeet first. pounce: up steeply nose first, arching over the top and
  // diving down nose first, forepaws together. hop: a little spring with
  // the head up (snapping at a gem). twirl: a leap with a spin.
  poseAir(P, p, kind) {
    const F = this.legs;
    const pounce = kind === 'pounce' ? 1 : 0;
    const hop = kind === 'hop' ? 1 : 0;
    const rise = 1 - smooth(0.0, 0.45, p);
    const fall = smooth(0.5, 0.95, p);
    const mid = Math.sin(Math.PI * p);
    // leap
    let pitch = 0.32 * rise - 0.28 * fall;
    let flex = -0.18 * mid + 0.12 * fall;
    const reachF = -0.2 - 0.12 * mid + 0.08 * fall;
    const fy = 0.12 + 0.06 * mid - 0.1 * fall;
    const hz = 0.32 * (1 - fall) + 0.04 * fall;
    const hy = 0.1 + 0.06 * mid;
    if (pounce) {
      pitch = lerp(0.75, -1.25, smooth(0.15, 0.85, p));
      flex = 0.22 * mid - 0.1 * fall;
    }
    if (hop) {
      pitch = 0.3 * mid;
      flex = 0.06;
    }
    P[C.y] = 0;
    P[C.z] = 0;
    P[C.pitch] = pitch;
    P[C.roll] = 0;
    P[C.flex] = flex;
    P[C.bend] = 0;
    for (let i = 0; i < 2; i++) {
      const toe = F[i].toe;
      const x = toe.x * (pounce ? 0.55 : 0.9);
      if (pounce) this.setFoot(P, i, x, 0.12 + 0.05 * mid - 0.05 * fall, -0.24 - 0.08 * fall);
      else if (hop) this.setFoot(P, i, x, 0.1 + 0.05 * mid, -0.17);
      else this.setFoot(P, i, x, fy, toe.z + reachF + (i === 0 ? 0.02 : -0.02));
    }
    for (let i = 2; i < 4; i++) {
      const toe = F[i].toe;
      if (pounce) this.setFoot(P, i, toe.x, 0.13 + 0.05 * mid, toe.z + 0.22 * mid + 0.05);
      else if (hop) this.setFoot(P, i, toe.x, 0.05 + 0.05 * mid, toe.z + 0.06);
      else this.setFoot(P, i, toe.x, hy, toe.z + hz + (i === 2 ? 0.02 : -0.02));
    }
    P[C.pawL] = P[C.pawR] = pounce ? 0.3 : hop ? -0.9 : -0.3 - 0.9 * rise + 0.6 * fall;
    P[C.toeL] = P[C.toeR] = pounce ? 0.6 : 0.7 * (1 - fall);
    P[C.neckP] = pounce ? -0.1 - 0.3 * fall : hop ? 0.25 : -0.3;
    P[C.neckY] = 0;
    P[C.headP] = pounce ? -0.3 * fall : hop ? 0.35 * mid : 0.25 - pitch * 0.6;
    P[C.headY] = 0;
    P[C.headR] = 0;
    P[C.tailLift] = pounce ? 0.6 + 0.5 * fall : 0.15 + 0.25 * rise;
    P[C.tailEnd] = P[C.tailLift] + (pounce ? 0.5 : 0.1);
    P[C.tailSide] = 0;
    P[C.tailWag] = 0;
    P[C.earBack] = pounce ? -0.25 : hop ? -0.1 : 0.7;
    P[C.earOut] = 0.05;
    P[C.jaw] = 0;
  }

  // Riding: crouched low on a runner's shoulder, legs folded under her,
  // head up beside theirs, ears streaming back.
  poseRide(P, t) {
    const F = this.legs;
    P[C.y] = -0.25;
    P[C.z] = 0.02;
    P[C.pitch] = 0.06;
    P[C.roll] = 0;
    P[C.flex] = 0.1;
    P[C.bend] = 0;
    this.setFoot(P, 0, F[0].toe.x * 1.2, 0.0, -0.2);
    this.setFoot(P, 1, F[1].toe.x * 1.2, 0.0, -0.2);
    this.setFoot(P, 2, F[2].toe.x * 1.35, 0.0, 0.06);
    this.setFoot(P, 3, F[3].toe.x * 1.35, 0.0, 0.06);
    P[C.pawL] = P[C.pawR] = 0.6;
    P[C.toeL] = P[C.toeR] = 0.3;
    P[C.neckP] = 0.18;
    P[C.neckY] = 0.15 * Math.sin(t * 0.7);
    P[C.headP] = -0.2;
    P[C.headY] = 0.3 * Math.sin(t * 0.53);
    P[C.headR] = 0;
    P[C.tailLift] = -0.6;
    P[C.tailEnd] = -0.35;
    P[C.tailSide] = 0;
    P[C.tailWag] = 0;
    P[C.earBack] = 0.8;
    P[C.earOut] = 0.1;
    P[C.jaw] = 0;
  }

  // --- the pose onto the bones -----------------------------------------------------------
  applyPose(P, dt, t) {
    const b = this.b;
    // the body, turned about its middle
    const piv = 0.4;
    const pitch = P[C.pitch], roll = P[C.roll];
    b.body.rotation.set(pitch, 0, roll);
    _v.set(0, -piv, 0).applyEuler(b.body.rotation);
    b.body.position.set(_v.x, piv + _v.y + P[C.y], _v.z + P[C.z]);
    if (this.spin) b.body.rotation.y = this.spin;
    // the spine: gathered (+) or stretched (-), bent toward a turn
    const f = P[C.flex], bd = P[C.bend];
    b.hips.rotation.set(0.5 * f, -0.35 * bd, 0);
    b.spine.rotation.set(-0.45 * f, 0.4 * bd, 0);
    b.chest.rotation.set(-0.5 * f, 0.4 * bd, 0);
    b.neck.rotation.set(P[C.neckP], P[C.neckY], 0);
    b.head.rotation.set(P[C.headP], P[C.headY], P[C.headR]);
    b.jaw.rotation.set(-0.42 * this.springs.jaw.step(clamp(P[C.jaw], 0, 1), 9, 0.7, dt), 0, 0);
    this.root.matrixWorld.identity();
    this.body.updateWorldMatrix(false, true);

    // the legs
    for (let i = 0; i < 4; i++) this.solveLeg(this.legs[i], P, i);

    // the ears
    this.earsSim(P, dt, t);
    // the tail
    this.tailSim(P, dt, t);
  }

  // Aim a bone so its rest offset to the next joint (rest, bind space)
  // points along dir (root space).
  aim(bone, rest, dir) {
    bone.parent.matrixWorld.decompose(_p, _q, _s);
    _v3.copy(rest).normalize().applyQuaternion(_q);
    _qd.setFromUnitVectors(_v3, _v2.copy(dir).normalize());
    _q2.copy(_q).invert();
    bone.quaternion.copy(_q2).multiply(_qd).multiply(_q);
    bone.updateWorldMatrix(false, true);
  }

  solveLeg(leg, P, i) {
    const b = this.b;
    const f = FEET[i];
    const tx = P[f[0]], ty = Math.max(0.006, P[f[1]]), tz = P[f[2]];
    const curl = P[leg.front ? (i === 0 ? C.pawL : C.pawR) : i === 2 ? C.toeL : C.toeR];
    // the paw from the wrist (or the foot) to the toes, turned by its curl
    _e.set(curl, 0, 0);
    const paw = _paw.copy(leg.paw).applyEuler(_e);
    const end = _end.set(tx, ty, tz).sub(paw);
    const root = _root.setFromMatrixPosition(b[leg.bones[0]].matrixWorld);
    if (leg.front) {
      // shoulder -> elbow (bending back) -> wrist
      const elbow = ik(root, end, leg.a, leg.b, _pole.set(leg.s * 0.1, 0, 1), _mid);
      fitEnd(root, elbow, end, leg.b);
      this.aim(b[leg.bones[0]], leg.rest[0], _d.subVectors(elbow, root));
      this.aim(b[leg.bones[1]], leg.rest[1], _d.subVectors(end, elbow));
      this.aim(b[leg.bones[2]], leg.rest[2], paw);
    } else {
      // hip -> stifle (forward) -> hock (back) -> foot, the cannon kept
      // parallel to the thigh: a two-bone solve of (thigh + cannon, shin)
      const knee = ik(root, end, leg.thigh + leg.meta, leg.shin, _pole.set(leg.s * 0.1, 0, -1), _mid);
      fitEnd(root, knee, end, leg.shin);
      const u1 = _u1.subVectors(knee, root).normalize();
      const stifle = _st.copy(root).addScaledVector(u1, leg.thigh);
      const hock = _hk.subVectors(end, knee).normalize().multiplyScalar(leg.shin).add(stifle);
      this.aim(b[leg.bones[0]], leg.rest[0], _d.subVectors(stifle, root));
      this.aim(b[leg.bones[1]], leg.rest[1], _d.subVectors(hock, stifle));
      this.aim(b[leg.bones[2]], leg.rest[2], u1);
      this.aim(b[leg.bones[3]], leg.rest[3], paw);
    }
  }

  // Ears: pricked or laid back by her mood and the wind, swivelling, and
  // flopping with every jolt of the head.
  earsSim(P, dt, t) {
    const S = this.springs;
    const wind = clamp(this.speed / 28, 0, 1) * 0.25;
    const jolt = clamp(-this.acc.y * 0.006, -0.3, 0.3);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const tw = this.twitch[i] < 0.25 ? Math.sin((this.twitch[i] / 0.25) * TAU) * 0.35 : 0;
      this.twitch[i] += dt;
      const back = (i === 0 ? S.earL : S.earR).step(P[C.earBack] + wind + tw + (this.earBias || 0), 5.5, 0.35, dt) + jolt;
      const out = (i === 0 ? S.earLo : S.earRo).step(P[C.earOut] + 0.4 * Math.max(0, P[C.earBack] - 0.5), 4.5, 0.4, dt);
      const swivel = (i === 0 ? S.earLs : S.earRs).step(P[C.headY] * -0.3 + tw * 0.6, 4, 0.5, dt);
      const e = this.b['ear' + (i === 0 ? 'L' : 'R')];
      e.rotation.set(back, s * swivel, -s * out);
    }
  }

  // The tail: a chain of particles (see buildTail). Each step it's carried
  // by the air (the headwind streaming it back, gusts fluttering it), by
  // gravity and by her own acceleration (it lags every turn, take-off and
  // landing), and held toward the shape her mood gives it - stiffly at the
  // root, loosely at the tip - then kept to its length.
  tailSim(P, dt, t) {
    const T = this.tail;
    const n = T.n;
    const L = this.tailSeg;
    const b = this.b;
    // the root, and the hips' turn, in world axes (the frame moves with her)
    const rootQ = this.root.quaternion;
    const root = _tr.setFromMatrixPosition(b.tail0.matrixWorld).applyQuaternion(rootQ);
    b.hips.matrixWorld.decompose(_v2, _hipsQ, _s);
    const hipsQ = _hipsQ.premultiply(rootQ);
    // the shape it's held to: back from the root, lifted there (tailLift)
    // and toward the tip (tailEnd), swept round to the side (tailSide, at
    // the tip), and waved. The root rides the pelvis; the rest is held
    // level with her heading, so a sitting fox's tail lies along the ground
    // and sweeps round in front of her paws.
    const lift = P[C.tailLift], end = P[C.tailEnd], side = P[C.tailSide], wag = P[C.tailWag];
    const sp = clamp(this.speed / 20, 0, 1);
    for (let i = 1; i < n; i++) {
      const k = i / (n - 1);
      const wave = Math.sin(t * 6.5 - k * 3.2) * (0.05 + 0.05 * sp) + Math.sin(t * 9 * (0.6 + wag) - k * 2.4) * 0.5 * wag * k;
      const ax = lift + (end - lift) * Math.pow(k, 0.8);
      const ay = side * 3.3 * Math.pow(k, 0.85) + wave;
      _e.set(-ax, ay, 0, 'YXZ');
      _q2.copy(hipsQ).slerp(rootQ, smooth(0.1, 0.55, k));
      T.dir[i].set(0, 0, 1).applyEuler(_e).applyQuaternion(_q2);
    }
    if (!T.ready || dt <= 0) {
      T.p[0].copy(root);
      for (let i = 1; i < n; i++) T.p[i].copy(T.p[i - 1]).addScaledVector(T.dir[i], L);
      for (const v of T.v) v.set(0, 0, 0);
      T.ready = true;
    } else {
      const steps = Math.min(6, Math.max(1, Math.ceil(dt / (1 / 120))));
      const h = dt / steps;
      // the air, as it moves past her (her own speed and a breeze);
      // underwater it's thick and she floats
      const wet = this.wet || 0;
      const drag = lerp(3.2, 7, wet);
      const grav = lerp(-9.8, -1.2, wet);
      const vx = this.vel.x, vy = this.vel.y, vz = this.vel.z;
      const ground = 0.04 - this.root.position.y;
      const r0 = T.o[0].copy(T.p[0]);
      for (let s = 0; s < steps; s++) {
        const f = (s + 1) / steps;
        T.v[0].subVectors(root, r0).divideScalar(dt);
        T.p[0].lerpVectors(r0, root, f);
        for (let i = 1; i < n; i++) {
          const p = T.p[i], v = T.v[i];
          T.o[i].copy(p);
          const k = i / (n - 1);
          // gusts: a flutter running down the tail, stronger the faster
          const g = Math.sin(t * 13 + s * 0.4 - k * 5) * 1.8 * sp * k + Math.sin(t * 7.3 - k * 3) * 0.9 * sp * k;
          v.x += h * (-this.acc.x + drag * (-vx + g - v.x));
          v.y += h * (grav - this.acc.y + drag * (-vy + g * 0.5 - v.y));
          v.z += h * (-this.acc.z + drag * (-vz - v.z));
          // (the brush is stiff with itself: each part of it is drawn to
          // move with the part before it, so the stride ripples down it
          // rather than whipping it)
          v.lerp(T.v[i - 1], 1 - Math.exp(-11 * h));
          p.addScaledVector(v, h);
          // held toward its shape: stiff at the root, loose at the tip
          const stiff = lerp(45, 6, Math.pow(k, 0.6)) * (1 - 0.5 * wet);
          _v.copy(T.p[i - 1]).addScaledVector(T.dir[i], L);
          p.lerp(_v, 1 - Math.exp(-stiff * h));
          // kept to its length
          _v.subVectors(p, T.p[i - 1]);
          const len = _v.length() || 1;
          p.copy(T.p[i - 1]).addScaledVector(_v, L / len);
          if (p.y < ground) p.y = ground;
          v.subVectors(p, T.o[i]).divideScalar(h);
        }
      }
    }
    // onto the bones
    _qi.copy(rootQ).invert();
    for (let i = 0; i < n - 1; i++) {
      _d.subVectors(T.p[i + 1], T.p[i]).applyQuaternion(_qi);
      this.aim(b['tail' + i], this.tailRest, _d);
    }
  }

  // --- placing her in the world ---------------------------------------------------------
  // pos: where her feet are (the scene), q: which way she faces; ground: the
  // height of the ground under her (for her shadow), shadow 0..1 how much it
  // shows.
  place(pos, q, ground = 0, shadow = 1) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    const h = Math.max(0, pos.y - ground);
    const s = Math.max(0.3, 1 - h * 0.35);
    const fw = _v.set(0, 0, -1).applyQuaternion(q);
    this.shadow.position.set(pos.x, ground + 0.035, pos.z);
    this.shadow.rotation.set(0, Math.atan2(-fw.x, -fw.z), 0);
    this.shadow.scale.set(0.42 * s, 1, 1.05 * s);
    this.shadow.material.uniforms.uAlpha.value = 0.3 * s * shadow;
    this.shadow.visible = shadow > 0.01;
    // the fur combed back by the air streaming past, and down by its weight
    const sp = this.vel.length();
    _v.copy(this.vel).multiplyScalar(-Math.min(1, sp / 25) * 0.9 / Math.max(sp, 1e-3));
    this.furWind.set(_v.x, _v.y - 0.25, _v.z, 1);
  }

  forCompile(on) {
    this.root.visible = true;
    this.shadow.visible = on;
  }
}

// Through the keys [u, z, y] (u ascending, ending near 1): Catmull-Rom.
function pathLine(keys, u, out) {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && u > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
  const h = k2[0] - k1[0] || 1;
  const t = clamp((u - k1[0]) / h, 0, 1);
  const t2 = t * t, t3 = t2 * t;
  for (let c = 1; c < 3; c++) {
    const m1 = i === 0 ? k2[c] - k1[c] : ((k2[c] - k0[c]) / (k2[0] - k0[0])) * h;
    const m2 = i + 2 >= n ? k2[c] - k1[c] : ((k3[c] - k1[c]) / (k3[0] - k1[0])) * h;
    out[c - 1] = (2 * t3 - 3 * t2 + 1) * k1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[c] + (t3 - t2) * m2;
  }
  return out;
}

const _pole = new THREE.Vector3();
const _paw = new THREE.Vector3();
const _end = new THREE.Vector3();
const _root = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _u1 = new THREE.Vector3();
const _st = new THREE.Vector3();
const _hk = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _hipsQ = new THREE.Quaternion();
const _tr = new THREE.Vector3();
const _d = new THREE.Vector3();
const _dn = new THREE.Vector3();
const _bn = new THREE.Vector3();

// Two-bone IK: the middle joint for a chain from root toward target (lengths
// a, b), bending toward pole.
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

// Where the chain's end actually lands (the target, or as near as it reaches).
function fitEnd(root, mid, end, b) {
  _v.subVectors(end, mid);
  const l = _v.length() || 1;
  end.copy(mid).addScaledVector(_v, b / l);
  return end;
}

// The body again, SHELLS times over, for the layers of fur: each copy carries
// its layer (aShell, 1/SHELLS .. 1); triangles with no fur on them are left
// out.
function shellGeometry(geo, layers) {
  const src = geo.attributes;
  const count = src.position.count;
  const fur = src.aD;
  const idx = geo.index.array;
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (Math.max(fur.getW(a), fur.getW(b), fur.getW(c)) > 0.0045 && src.aMat.getX(a) !== 5) keep.push(a, b, c);
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
