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
//   - leaps (stretched out over a hurdle), the mousing pounce (up in an
//     arch and down nose first), little hops to snap at a gem; chasing her
//     tail (curled into a C, head round after it); sitting with her tail
//     curled round her paws; crouched riding on a runner's shoulder;
//     slinking low;
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
    for (const k of ['headP', 'headY', 'neckY', 'roll', 'bend', 'earL', 'earR', 'earLo', 'earRo', 'earLs', 'earRs', 'jaw', 'land', 'low', 'wag', 'lift', 'curl']) this.springs[k] = new Spring();
    this.tail = this.buildTail();
    this.tailHold = new Spring();
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
    this.curlTarget = 0;
    for (const k in this.wS) this.wS[k].reset(k === 'sit' ? 1 : 0);
    for (const s of Object.values(this.springs)) s.reset();
    this.tail.ready = false;
    this.headRef = { y: 0, p: 0, ready: false, pReady: false };
    this.crouch = 0;
    this.crouchKind = 'leap';
    this.freq = 2;
    this.root.visible = true;
  }

  // --- the frame ----------------------------------------------------------------------
  // ctx: { speed: m/s over the ground, vel: world velocity, mode: 'run' |
  // 'air' | 'sit' | 'stand' | 'ride', airT / airDur / airKind while in the
  // air, fall: her gravity while she's falling free (m/s²), low: 0..1
  // slinking, lat: sideways speed (m/s, + to her right), curl: -1..1 how far
  // she's curled round chasing her tail (+ toward her left) }
  update(dt, ctx) {
    this.time += dt;
    const t = this.time;
    this.speed = ctx.speed;
    this.mode = ctx.mode;
    this.lat = ctx.lat || 0;
    this.curlTarget = ctx.curl || 0;
    if (ctx.vel) {
      if (!this.tail.ready) this.velS.copy(ctx.vel);
      _v.copy(this.velS);
      this.velS.lerp(ctx.vel, 1 - Math.exp(-dt * 30));
      if (dt > 0) this.acc.subVectors(this.velS, _v).divideScalar(dt).clampLength(0, 80);
      // (in free fall nothing pulls on her tail but its own weight: falling
      // with her, it floats - it isn't thrown up off her)
      this.acc.y += ctx.fall || 0;
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
    // (a long, loping stride: she floats between footfalls, more of the
    // stride in the air the faster she goes)
    const run = this.mode === 'run';
    this.freq = clamp(1.55 + 0.058 * this.speed, 1.9, 3.15);
    this.phase = (this.phase + dt * (run ? this.freq : 0)) % 1;
    this.crouch = ctx.crouch || 0;
    this.crouchKind = ctx.crouchKind || 'leap';
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

    // winding up for a jump: she sinks into her legs, coiled, all four feet
    // planted under her, eyes on where she's going (for the pounce she rears
    // up on her haunches, forepaws drawn up to her chest)
    const cr = this.crouch;
    if (cr > 0) {
      const e = cr * cr * (3 - 2 * cr);
      const pounce = this.crouchKind === 'pounce';
      P[C.y] -= (pounce ? 0.06 : this.crouchKind === 'hop' ? 0.06 : 0.1) * e;
      P[C.flex] += (pounce ? 0.05 : 0.22) * e;
      P[C.pitch] += (pounce ? 0.32 : 0.05) * e;
      for (let i = 0; i < 4; i++) {
        const f = FEET[i], toe = this.legs[i].toe;
        let x = toe.x * (i < 2 ? 0.92 : 1), y = toe.y, z = toe.z + (i < 2 ? -0.03 : -0.05);
        if (pounce && i < 2) {
          bodyFoot(_crouchP, FEET[0], toe.x * 0.7, 0.14, -0.26, P[C.pitch]);
          x = _crouchP[0];
          y = _crouchP[1];
          z = _crouchP[2];
        }
        P[f[0]] += (x - P[f[0]]) * e;
        P[f[1]] += (y - P[f[1]]) * e;
        P[f[2]] += (z - P[f[2]]) * e;
      }
      P[C.neckP] += (pounce ? 0.1 : -0.18) * e;
      P[C.headP] += (pounce ? -0.45 : 0.12) * e;
      P[C.earBack] -= 0.35 * e;
      P[C.tailLift] += 0.2 * e;
    }
    // landing: forefeet first - the front dips as they take it - then her
    // weight comes down into all four legs, folding them and gathering her
    // back, and she springs back up out of it; the harder she came down, the
    // deeper
    const lk = this.landHit;
    if (lk > 0 && this.landClock < 1.5) {
      const a = impulse(this.landClock, 6.5, 0.5, 0);
      const c = impulse(this.landClock, 4.2, 0.42, 0.035);
      P[C.pitch] -= 0.15 * lk * a;
      P[C.y] -= 0.085 * lk * c;
      P[C.flex] += 0.26 * lk * c;
      P[C.neckP] -= 0.28 * lk * c;
      P[C.tailLift] += 0.25 * lk * a;
    }
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
    // (bend + curls her toward her left, -x)
    const S = this.springs;
    const lat = this.mode === 'ride' ? 0 : this.lat;
    P[C.roll] += S.roll.step(clamp(-this.acc.x * 0.012, -0.25, 0.25), 2.2, 0.75, dt);
    P[C.bend] += S.bend.step(clamp(-lat * 0.03, -0.22, 0.22), 2.4, 0.8, dt);
    // chasing her tail: her back curled into a C toward it, her head right
    // round after it, the brush swept round to meet her; ears up, mouth open
    // in a grin
    const cu = S.curl.step(this.curlTarget, 3.2, 0.85, dt);
    const ca = Math.abs(cu);
    if (ca > 1e-3) {
      P[C.bend] += 0.62 * cu;
      P[C.neckY] += 0.5 * cu;
      P[C.headY] += 0.55 * cu;
      P[C.headP] += 0.18 * ca;
      P[C.tailSide] -= 0.55 * cu;
      P[C.tailLift] += 0.15 * ca;
      P[C.y] -= 0.03 * ca;
      P[C.pitch] += 0.06 * ca;
      P[C.earBack] -= 0.3 * ca;
      P[C.jaw] = Math.max(P[C.jaw], 0.45 * ca);
      P[C.headR] += 0.2 * cu;
    }
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
  // left hind; mirrored with a left). Each foot is planted - pinned to the
  // road, carried back at exactly the ground's speed - for as long as its
  // leg can reach (never less than about four frames), and the rest of the
  // stride she flies. Between the footfalls her body rides real flight arcs
  // (gravity, not a wave): it drops into each pair of footfalls, is driven
  // back up off them and floats. After the forefeet, her back gathers into a
  // ball - the hind legs swinging right through under her chest, the
  // forelegs folded up and back; after the hind drive she flies stretched
  // out flat, forelegs reaching straight ahead and hind legs straight back.
  // (u for each leg: 0 at touchdown, planted until its duty, then the swing.)
  poseGallop(P, ph, t) {
    const v = Math.max(this.speed, 0.3);
    const f = this.freq || 2;
    const sp = clamp((v - 4) / 24, 0, 1);
    const s = 0.3 + 0.7 * smooth(0.5, 13, v);
    const lx = this.leadX;
    const reachF = 0.24 + 0.12 * s, reachH = 0.28 + 0.14 * s;
    const minDown = 0.068 * f;
    const dF = clamp(Math.max((reachF * f) / v, minDown), 0.1, 0.5);
    const dH = clamp(Math.max((reachH * f) / v, minDown), 0.1, 0.5);
    const lag = 0.07;
    const offs = [lag / 2 - (lag / 2) * lx, lag / 2 + (lag / 2) * lx, 0.5 + lag / 2 + (lag / 2) * lx, 0.5 + lag / 2 - (lag / 2) * lx];
    for (let i = 0; i < 4; i++) {
      const leg = this.legs[i];
      const front = i < 2;
      const duty = front ? dF : dH;
      const u = (ph - offs[i] + 1) % 1;
      const toe = leg.toe;
      // the ground covered while it's down (as much as the leg can reach)
      const span = Math.min(front ? reachF : reachH, (v * duty) / f);
      let z, y, curl;
      if (front) {
        const zTD = -0.08 - 0.12 * s - 0.02 * sp, zLO = zTD + span;
        if (u < duty) {
          const c = u / duty;
          z = zTD + span * c;
          y = 0;
          curl = -0.75 * smooth(0.45, 1, c);
        } else {
          const keys = this.frontSwing || (this.frontSwing = []);
          keys.length = 0;
          keys.push([0, zLO, 0], [0.12, zLO + 0.06 * s, 0.06 + 0.05 * s], [0.38, 0.02, 0.13 + 0.07 * s], [0.74, zTD - 0.22 * s, 0.13 + 0.09 * s], [0.92, zTD - 0.06 * s, 0.04], [1, zTD, 0]);
          const c = (u - duty) / (1 - duty);
          pathLine(keys, c, _key);
          z = _key[0];
          y = Math.max(0, _key[1]);
          curl = -0.75 - 1.0 * smooth(0, 0.22, c) + 2.15 * smooth(0.42, 0.78, c) - 0.4 * smooth(0.82, 1, c);
        }
      } else {
        const zTD = -0.12 - 0.1 * s, zLO = zTD + span;
        if (u < duty) {
          const c = u / duty;
          z = zTD + span * c;
          y = 0;
          curl = 0.55 * smooth(0.4, 1, c);
        } else {
          const keys = this.hindSwing || (this.hindSwing = []);
          keys.length = 0;
          keys.push([0, zLO, 0], [0.16, zLO + 0.16 * s, 0.06 + 0.04 * s], [0.36, zLO + 0.06 * s, 0.1 + 0.03 * s], [0.62, 0.0, 0.14 + 0.03 * s], [0.86, zTD - 0.06 * s, 0.06], [1, zTD, 0]);
          const c = (u - duty) / (1 - duty);
          pathLine(keys, c, _key);
          z = _key[0];
          y = Math.max(0, _key[1]);
          curl = 0.55 + 0.45 * smooth(0, 0.2, c) - 1.3 * smooth(0.3, 0.68, c) + 0.3 * smooth(0.8, 1, c);
        }
      }
      this.setFoot(P, i, toe.x * (front ? 0.92 : 0.95), toe.y + y, toe.z + z);
      P[front ? (i === 0 ? C.pawL : C.pawR) : i === 2 ? C.toeL : C.toeR] = curl;
    }
    // the body's flight: two flights a stride, each a parabola, and a dip
    // into each pair of footfalls that turns the fall into the next rise
    const k = 0.2 + 0.8 * smooth(1.5, 10, v);
    const cw = lag + 0.5 * (dF + dH);
    P[C.y] = this.bounce(ph, f, cw, 20) * k - 0.015 - 0.02 * sp;
    // the back gathers (+) in the flight after the forefeet, stretches out
    // (-) in the flight after the hind drive
    P[C.flex] = (0.12 + 0.5 * Math.cos(TAU * (ph - 0.36))) * k;
    // rocking over the forefeet (nose down), then up off the hind drive
    P[C.pitch] = -0.085 * Math.cos(TAU * (ph - 0.3)) * k;
    P[C.z] = 0.025 * Math.sin(TAU * (ph - 0.25)) * k;
    P[C.roll] = 0.025 * Math.sin(TAU * ph) * lx * k;
    P[C.bend] = 0;
    // the head low and forward, eyes on the road (held steady: see steadyHead)
    P[C.neckP] = -0.3 - 0.14 * sp;
    P[C.neckY] = 0;
    P[C.headP] = 0.24 + 0.12 * sp;
    P[C.headY] = 0;
    P[C.headR] = 0;
    // the tail held out behind, a touch above level
    P[C.tailLift] = 0.08 + 0.06 * sp;
    P[C.tailEnd] = P[C.tailLift] + 0.1;
    P[C.tailSide] = 0;
    P[C.tailWag] = 0;
    P[C.earBack] = 0.3 + 0.45 * sp;
    P[C.earOut] = 0.05;
    P[C.jaw] = 0.1 * sp * (0.5 + 0.5 * Math.sin(TAU * ph));
  }

  // The body's height through a stride (x: phase): two identical halves,
  // each a support (both feet of a pair down, cw of a stride all told,
  // the body decelerating its fall and driven back up: a dip) and then a
  // flight (a parabola under gravity g). Returns the height about its mean.
  bounce(x, f, cw, g) {
    const c = clamp(cw, 0.06, 0.45);
    const T = (0.5 - c) / f, Tc = c / f;
    const v0 = (g * T) / 2, A = (2 * v0) / Tc;
    const apex = (g * T * T) / 8, dip = (v0 * Tc) / 4;
    const mean = ((2 / 3) * apex * T - (2 / 3) * dip * Tc) / (T + Tc);
    let u = x - Math.floor(x * 2) / 2;
    if (u < c) {
      const tau = u / f;
      return -v0 * tau + (A * tau * tau) / 2 - mean;
    }
    const tau = (u - c) / f;
    return v0 * tau - (g * tau * tau) / 2 - mean;
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
    // (swept slowly to and fro round her paws, its tip flicking now and then)
    P[C.tailSide] = 0.82 + 0.2 * Math.sin(t * 0.55) + 0.1 * Math.sin(t * 1.3 + 1) + 0.12 * Math.pow(Math.max(0, Math.sin(t * 0.9 + 2)), 8);
    P[C.tailWag] = 0;
    P[C.earBack] = -0.12;
    P[C.earOut] = 0.08;
    P[C.jaw] = 0;
  }

  // In the air (p: 0..1 through the flight; feet placed in her body's own
  // frame, turned with it). leap: she drives off with her hind legs
  // stretched out behind and her forelegs folding up, tucks her hind legs
  // up under her over the top with her forelegs reaching ahead, and comes
  // down forefeet first, reaching for the road, nose dipping. pounce (the
  // mousing leap, from a run): gathered up a little, forepaws drawn in, she
  // springs up at about the angle she climbs, arches her back over the top
  // and comes down nose first at about the angle she falls, forepaws
  // together reaching down, hind legs trailing, her brush streaming out
  // behind. hop: a little spring, head up, snapping at something.
  poseAir(P, p, kind) {
    const F = this.legs;
    const pounce = kind === 'pounce', hop = kind === 'hop';
    let pitch, flex, fz, fy, hz, hy, fx = 0.9;
    if (pounce) {
      pitch = kf(PITCH_POUNCE, p);
      flex = kf(FLEX_POUNCE, p);
      fz = kf([-0.12, -0.16, -0.3, -0.36, -0.36], p);
      fy = kf([0.24, 0.2, 0.1, 0.08, 0.06], p);
      hz = kf([0.32, 0.3, 0.3, 0.28, 0.24], p);
      hy = kf([0.0, 0.04, 0.1, 0.16, 0.14], p);
      fx = 0.55;
    } else if (hop) {
      pitch = 0.3 * Math.sin(Math.PI * p) + 0.05;
      flex = 0.05;
      fz = kf([-0.1, -0.12, -0.14, -0.2, -0.24], p);
      fy = kf([0.14, 0.2, 0.2, 0.12, 0.03], p);
      hz = kf([0.3, 0.24, 0.16, 0.1, 0.06], p);
      hy = kf([0.0, 0.06, 0.1, 0.08, 0.02], p);
    } else {
      pitch = kf(PITCH_LEAP, p);
      flex = kf(FLEX_LEAP, p);
      fz = kf([-0.08, -0.26, -0.36, -0.3, -0.26], p);
      fy = kf([0.18, 0.16, 0.13, 0.06, 0.0], p);
      hz = kf([0.36, 0.2, 0.02, 0.06, 0.12], p);
      hy = kf([0.02, 0.12, 0.17, 0.14, 0.08], p);
    }
    P[C.y] = 0;
    P[C.z] = 0;
    P[C.pitch] = pitch;
    P[C.roll] = 0;
    P[C.flex] = flex;
    P[C.bend] = 0;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const toe = F[i].toe;
      const side = i % 2 === 0 ? 1 : -1;
      bodyFoot(P, FEET[i], toe.x * (front ? fx : 0.95), front ? fy : hy, (front ? fz - 0.2 : hz + 0.2) + side * 0.015, pitch);
    }
    P[C.pawL] = P[C.pawR] = pounce ? kf([-1.2, -1.0, 0.2, 0.4, 0.3], p) : hop ? -1.0 : kf([-1.3, -0.6, 0.2, 0.4, 0.3], p);
    P[C.toeL] = P[C.toeR] = pounce ? kf([0.8, 0.5, 0.3, 0.5, 0.6], p) : kf([0.9, 0.4, -0.3, 0.0, 0.2], p);
    P[C.neckP] = pounce ? kf([0.25, 0.15, -0.15, -0.35, -0.4], p) : hop ? 0.3 : kf([-0.2, -0.3, -0.32, -0.25, -0.15], p);
    P[C.neckY] = 0;
    P[C.headP] = pounce ? kf([-0.5, -0.4, -0.2, -0.15, -0.1], p) : hop ? -0.15 * Math.sin(Math.PI * p) : 0.22 - pitch * 0.5;
    P[C.headY] = 0;
    P[C.headR] = 0;
    // (diving, her hips are tipped up: the brush is held down from them, so
    // it streams out behind her along her flight, its tip curling up)
    P[C.tailLift] = pounce ? kf([-0.15, -0.1, -0.22, -0.5, -0.62], p) : kf([0.25, 0.2, 0.1, 0.05, 0.1], p);
    P[C.tailEnd] = P[C.tailLift] + (pounce ? 0.35 : 0.1);
    P[C.tailSide] = 0;
    P[C.tailWag] = 0;
    P[C.earBack] = pounce ? -0.3 : hop ? -0.15 : 0.6;
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
    this.steadyHead(dt);

    // the legs
    for (let i = 0; i < 4; i++) this.solveLeg(this.legs[i], P, i);

    // the ears
    this.earsSim(P, dt, t);
    // the tail
    this.tailSim(P, dt, t);
  }

  // Her head stays steady while everything under it works, as a running
  // fox's does: whatever the stride's bounce, rocking and gathering do to
  // her neck, the head is held at a height and an angle that change only
  // slowly (a landing still nods it, the stride a little).
  steadyHead(dt) {
    const b = this.b;
    const w = this.w;
    const tot = w.gallop + w.stand + w.sit + w.air + w.ride || 1;
    const landing = this.landHit > 0 ? impulse(this.landClock, 4.2, 0.42, 0.035) * this.landHit : 0;
    const stab = clamp((w.gallop * 0.85 + w.air * 0.3 + w.ride * 0.5) / tot, 0, 0.9) * (1 - clamp(Math.abs(landing), 0, 0.7));
    const H = this.headRef;
    _hp.setFromMatrixPosition(b.head.matrixWorld);
    _np.setFromMatrixPosition(b.neck.matrixWorld);
    if (!H.ready || dt <= 0) {
      H.y = _hp.y;
      H.ready = true;
    }
    H.y += (_hp.y - H.y) * (1 - Math.exp(-dt * 3));
    const lever = Math.max(0.08, Math.hypot(_hp.z - _np.z, _hp.x - _np.x));
    b.neck.rotation.x += clamp(((H.y - _hp.y) / lever) * stab, -0.45, 0.45);
    b.neck.updateWorldMatrix(false, true);
    // and level: the head's pitch in her own space, held to a slow average
    b.head.matrixWorld.decompose(_hp, _hq, _s);
    _np.set(0, 0, -1).applyQuaternion(_hq);
    const pitch = Math.atan2(_np.y, Math.hypot(_np.x, _np.z));
    if (!H.pReady || dt <= 0) {
      H.p = pitch;
      H.pReady = true;
    }
    H.p += (pitch - H.p) * (1 - Math.exp(-dt * 3));
    b.head.rotation.x -= (pitch - H.p) * stab;
    b.head.updateWorldMatrix(false, true);
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

  // The tail: a chain of particles from root to tip (see buildTail), in a
  // frame that moves with her but doesn't turn with her - so every turn of
  // her hips swings it and it lags behind. Its shape comes from her mood
  // (the pose's tailLift / tailEnd / tailSide / tailWag) bent by the air
  // streaming past her: at a gallop it streams out behind, level, as a real
  // fox's does. On top of that shape it's a damped chain: each part is held
  // to the shape relative to the part before it (not to her body), so a
  // swing at the root runs down it as a wave; her own acceleration throws
  // it (it hangs back on a take-off, whips down on a landing, swings out
  // wide in a turn), gravity weighs it, and the air damps it. The steady
  // headwind is in the shape rather than a force (as a force it fought the
  // chain's length every step and set the tip thrashing).
  tailSim(P, dt, t) {
    const T = this.tail;
    const n = T.n;
    const L = this.tailSeg;
    const b = this.b;
    const rootQ = this.root.quaternion;
    const root = _tr.setFromMatrixPosition(b.tail0.matrixWorld).applyQuaternion(rootQ);
    b.hips.matrixWorld.decompose(_v2, _hipsQ, _s);
    const hipsQ = _hipsQ.premultiply(rootQ);
    const lift = P[C.tailLift], end = P[C.tailEnd], side = P[C.tailSide], wag = P[C.tailWag];
    // the air streaming past her: how hard, and which way
    const air = _air.copy(this.vel).negate();
    const as = air.length();
    if (as > 1e-3) air.divideScalar(as);
    const stream = smooth(1.5, 17, as) * (this.mode === 'sit' ? 0 : 1);
    const still = this.tailHold.step(this.mode === 'sit' || this.mode === 'stand' ? 0 : 1, 2, 1, dt);
    // a slow wag sweeping side to side, its beat running down the tail
    const wagP = TAU * (1.4 + 0.5 * wag) * t;
    for (let i = 1; i < n; i++) {
      const k = i / (n - 1);
      const ax = lift + (end - lift) * Math.pow(k, 0.8);
      const ay = side * 3.3 * Math.pow(k, 0.85) + Math.sin(wagP - k * 1.6) * (0.08 + 0.55 * wag) * (0.4 + 0.6 * k);
      _e.set(-ax, ay, 0, 'YXZ');
      // (sitting or standing, its root comes out of the rump wherever the
      // pelvis tips it; on the move she holds it steady, so only a little of
      // the pelvis's rocking reaches it)
      _q2.copy(hipsQ).slerp(rootQ, lerp(smooth(0.1, 0.55, k), 0.65 + 0.15 * k, still));
      const d = T.dir[i].set(0, 0, 1).applyEuler(_e).applyQuaternion(_q2);
      // streamed back by the air, more toward the tip
      if (stream > 0) d.lerp(air, stream * (0.25 + 0.5 * k)).normalize();
    }
    if (!T.ready || dt <= 0) {
      T.p[0].copy(root);
      for (let i = 1; i < n; i++) T.p[i].copy(T.p[i - 1]).addScaledVector(T.dir[i], L);
      for (const v of T.v) v.set(0, 0, 0);
      T.ready = true;
    } else {
      const steps = Math.min(8, Math.max(1, Math.round(dt * 120)));
      const h = dt / steps;
      // underwater it's thick and she floats
      const wet = this.wet || 0;
      const airDamp = lerp(1.6, 5, wet);
      // (its shape already droops as it should: gravity here only weighs
      // what moves away from it)
      const grav = lerp(-4, -1, wet);
      const sp = clamp(as / 20, 0, 1);
      const r0 = T.o[0].copy(T.p[0]);
      T.v[0].subVectors(root, r0).divideScalar(dt);
      for (let s = 0; s < steps; s++) {
        const tt = t - dt + (s + 1) * h;
        T.p[0].lerpVectors(r0, root, (s + 1) / steps);
        for (let i = 1; i < n; i++) {
          const p = T.p[i], v = T.v[i], pv = T.v[i - 1];
          const k = i / (n - 1);
          // the shape's bend at this joint, carried on from where the part
          // before it actually is
          let d = T.dir[i];
          if (i > 1) {
            const pd = _pd.subVectors(T.p[i - 1], T.p[i - 2]).normalize();
            _qb.setFromUnitVectors(T.dir[i - 1], pd);
            d = _dt.copy(T.dir[i]).applyQuaternion(_qb).lerp(T.dir[i], 0.25).normalize();
          }
          _v.copy(T.p[i - 1]).addScaledVector(d, L);
          // a damped spring toward it (stiff at the root, soft at the tip,
          // damped against the part before it), the air's drag, gravity,
          // her own acceleration thrown back at it, and in a strong headwind
          // a little flutter running down it
          const w = lerp(42, 15, Math.pow(k, 0.8)) * (1 - 0.35 * wet);
          const c = 2 * lerp(0.8, 0.6, k) * w;
          const fl = sp * k * k;
          const ax = w * w * (_v.x - p.x) - c * (v.x - pv.x) - airDamp * v.x - this.acc.x + 1.1 * fl * Math.sin(tt * 8.3 - k * 4);
          const ay = w * w * (_v.y - p.y) - c * (v.y - pv.y) - airDamp * v.y + grav - this.acc.y + 0.7 * fl * Math.sin(tt * 6.1 - k * 3 + 1);
          const az = w * w * (_v.z - p.z) - c * (v.z - pv.z) - airDamp * v.z - this.acc.z;
          v.x += ax * h;
          v.y += ay * h;
          v.z += az * h;
          p.addScaledVector(v, h);
          // kept to its length (and the stretch taken out of its motion)
          _v.subVectors(p, T.p[i - 1]);
          const len = _v.length() || 1;
          _v.divideScalar(len);
          p.copy(T.p[i - 1]).addScaledVector(_v, L);
          const rel = (v.x - pv.x) * _v.x + (v.y - pv.y) * _v.y + (v.z - pv.z) * _v.z;
          v.addScaledVector(_v, -rel);
          if (p.y + this.root.position.y < 0.04) {
            p.y = 0.04 - this.root.position.y;
            if (v.y < 0) v.y = 0;
          }
        }
      }
    }
    // onto the bones (each turned from the one before it, so none flips)
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

// The impulse response of a damped spring (frequency Hz, damping ratio),
// starting `delay` seconds after t = 0, scaled to peak at about 1: a jolt
// that rings out.
function impulse(t, freq, zeta, delay) {
  t -= delay;
  if (t <= 0) return 0;
  const w = TAU * freq, r = Math.sqrt(1 - zeta * zeta);
  if (t * zeta * w > 8) return 0;
  const peak = r * Math.exp((-zeta / r) * Math.atan(r / zeta));
  return (Math.exp(-zeta * w * t) * Math.sin(w * r * t)) / peak;
}

// Evenly spaced keys over 0..1, eased through (Catmull-Rom).
function kf(keys, p) {
  const n = keys.length - 1;
  const x = clamp(p, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const t = x - i;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * k1 + (k2 - k0) * t + (2 * k0 - 5 * k1 + 4 * k2 - k3) * t2 + (3 * k1 - k0 - 3 * k2 + k3) * t3);
}
// in the air: the body's pitch and the spine's flex through the flight
const PITCH_LEAP = [0.3, 0.12, -0.02, -0.16, -0.24];
const FLEX_LEAP = [-0.3, 0.05, 0.18, 0.02, -0.1];
// (the pounce's pitch follows its flight - up at about the angle she climbs
// at a run, arched over the top, down at about the angle she falls - never
// stood on end)
const PITCH_POUNCE = [0.55, 0.32, -0.04, -0.42, -0.62];
const FLEX_POUNCE = [0.0, 0.22, 0.4, 0.26, 0.12];

// A foot placed in the body's own frame (pitched by `pitch` about its
// middle), written in her root space.
function bodyFoot(P, f, x, y, z, pitch) {
  const piv = 0.4;
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const yy = y - piv;
  P[f[0]] = x;
  P[f[1]] = piv + yy * c - z * s;
  P[f[2]] = yy * s + z * c;
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
const _hp = new THREE.Vector3();
const _np = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _crouchP = new Float32Array(N);
const _air = new THREE.Vector3();
const _pd = new THREE.Vector3();
const _dt = new THREE.Vector3();
const _qb = new THREE.Quaternion();
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
