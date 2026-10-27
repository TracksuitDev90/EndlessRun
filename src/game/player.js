import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { makeEnvUniforms, makeCharacterMaterials } from '../render/shaders.js';
import { TAU, damp, clamp, smooth, Spring } from './rig.js';
import { Cloth } from './cloth.js';
import { runner } from './runner-asset.js';
import { RIG, MANTLE, CAPE, configureRig, mantleEZ, mantleWeights, capeBind, capeFrame, palette, buildRunnerGeometry } from './outfit.js';

// The runner: a young wayfarer in a hooded cape. The body and clothes are
// sculpted offline (tools/runner/build.py, loaded by runner-asset.js) as
// continuous surfaces skinned to this skeleton; the cape is built in
// outfit.js. One skinned mesh plus its ink hull: two draw calls. The run's
// legs are placed by IK, the jump / slide / idle poses are keyed (idle on
// planted feet), and on top sits a layer of weight and secondary motion:
//   - torso, head and arms ride on the pelvis like loose springs, kicked by
//     each footfall, lane change, take-off and landing, and trail their own
//     posed motion so they lag and overshoot;
//   - the mantle over the shoulders (and the hood lying on it) is twelve
//     hinged panels that flare in the wind and the breeze, bob behind each
//     footfall, lift when falling and get shouldered aside by the arms;
//   - the cape beneath it is a cloth simulation (cloth.js) — a particle grid
//     driving one bone each — hung from the mantle's hem, kept off the body by
//     capsules, streaming back in the headwind and swayed by a shifting breeze;
//   - curls bounce on springs; the hip pouch is a pendulum, its flap lifting.
// Also owns lane / jump / slide movement.
// --- pose channels -----------------------------------------------------------
// Lateral channels (z / twist) for limbs are stored as per-side magnitudes
// (positive = outward) and get the side's sign when applied.
const NAMES = [
  'hipY', 'hipX', 'hipYaw', 'hipRoll', 'hipPitch',
  'spLean', 'spTwist', 'spSide', 'chLean', 'chTwist', 'chSide',
  'hdPitch', 'hdYaw', 'hdRoll',
  'clL', 'clR', 'shLx', 'shRx', 'shLy', 'shRy', 'shLz', 'shRz', 'elL', 'elR', 'wrL', 'wrR', 'wrLz', 'wrRz',
  'thLx', 'thRx', 'thLz', 'thRz', 'thLy', 'thRy', 'knL', 'knR', 'anL', 'anR', 'toL', 'toR',
  'bodyPitch', 'bodyZ', 'bodyRoll', 'sq',
];
const C = {};
NAMES.forEach((n, i) => (C[n] = i));
const N = NAMES.length;
const PAIRS = [
  ['clL', 'clR'], ['shLx', 'shRx'], ['shLy', 'shRy'], ['shLz', 'shRz'], ['elL', 'elR'], ['wrL', 'wrR'], ['wrLz', 'wrRz'],
  ['thLx', 'thRx'], ['thLz', 'thRz'], ['thLy', 'thRy'], ['knL', 'knR'], ['anL', 'anR'], ['toL', 'toR'],
].map(([a, b]) => [C[a], C[b]]);
const NEGATE = ['hipX', 'hipYaw', 'hipRoll', 'spTwist', 'spSide', 'chTwist', 'chSide', 'hdYaw', 'hdRoll', 'bodyRoll'].map((n) => C[n]);

function mirror(p) {
  for (const [a, b] of PAIRS) {
    const t = p[a];
    p[a] = p[b];
    p[b] = t;
  }
  for (const i of NEGATE) p[i] = -p[i];
}

// Running legs are placed, not keyed (phase pi = the left foot's mid-stance,
// the right foot half a stride later). While a foot is down, the ball of the
// boot is pinned to the ground and carried back at exactly the ground speed as
// the heel peels up over it; in the air the ankle follows a designed path —
// the heel kicks up under the hips, the knee drives through, the foot reaches
// and paws back down — and a two-bone solve turns the ankle's position into
// thigh and knee angles, so the knee always bends forward and a planted foot
// never sinks, floats or skids sideways.
// A 0.6 m leg can only stay planted for about 0.58 m of ground; at the game's
// 12-28 m/s that is a few hundredths of a second, so contact is as long as the
// leg can reach (no slip at all at the start speed), but never shorter than
// minContact so the planted pose always reaches the screen — any slip that
// leaves at top speed is straight back along the run, inside those frames.
const STRIDE = {
  reach: 0.58, // m of ground the ball can cover while planted
  minContact: 0.04, // s
  maxDuty: 0.36, // of the cycle, at a jog
  ballZ: -0.02, // middle of the planted stretch (forward of the hips)
  heelLift: 0.75, // rad, the foot's pitch at toe-off
  hipY: 0.69, // pelvis height at mid-stance (the knee bends ~45 degrees)
  bob: 0.03, // pelvis rise in flight
  trackX: 0.074, // planted feet land a little inside the hips...
  swingX: 0.096, // ...and pass wide of each other
  toeOut: 0.06, // rad
};
// The ankle's path through the air (root space, s = 0 at toe-off .. 1 at
// touchdown): [s, z, y, z per unit speed, y per unit speed].
const SWING = [
  [0.16, 0.36, 0.29, 0.03, 0.03], // the heel rises behind
  [0.4, 0.2, 0.44, 0.0, 0.08], // tucked up under the hips
  [0.65, -0.15, 0.36, -0.04, 0.03], // the knee drives through, the foot following
  [0.84, -0.28, 0.24, -0.02, 0.0], // reach...
];
// Arms swing with the opposite leg's phase.
const ARM_SAMPLES = [0.35, 0.6, 0.85, 1.3]; // along the upper arm (1.3: past the elbow)
const ARM = {
  // a compact swing (the upper arm stays under the mantle; the bent elbow
  // carries the hand up and through)
  swing: [0.16, 0.5, 0.58, 0.36, -0.1, -0.44, -0.54, -0.32],
  abd: [0.44, 0.38, 0.37, 0.41, 0.45, 0.49, 0.5, 0.48], // held out clear of the puffer
  elbow: [1.35, 1.65, 1.78, 1.6, 1.25, 1.0, 0.95, 1.1],
};

// Proportions come with the generated rig (see configure()).
let HIP_Y, HIP_JOINT, THIGH, SHIN, CHEST_Y, UPPER_ARM, FOREARM;
let ANKLE_H, TOE_D, TOE_F; // ankle height over the ground; ball of the foot below and ahead of it

function configure() {
  configureRig();
  HIP_Y = RIG.hipY;
  HIP_JOINT = { x: RIG.hipJoint[0], y: RIG.hipJoint[1] };
  THIGH = RIG.thigh;
  SHIN = RIG.shin;
  CHEST_Y = RIG.chestY;
  UPPER_ARM = RIG.upperArm;
  FOREARM = RIG.forearm;
  ANKLE_H = HIP_JOINT.y - THIGH - SHIN;
  TOE_D = RIG.toe[0];
  TOE_F = RIG.toe[1];
}

const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

const G = (8 * CONFIG.jump.height) / (CONFIG.jump.time * CONFIG.jump.time);
const V0 = (4 * CONFIG.jump.height) / CONFIG.jump.time;

// Catmull-Rom through a cyclic list of keys, sampled at phase p (radians).
function cyc(keys, p) {
  const n = keys.length;
  let u = (p / TAU) * n;
  u = ((u % n) + n) % n;
  const i = Math.floor(u);
  const t = u - i;
  const p0 = keys[(i + n - 1) % n];
  const p1 = keys[i];
  const p2 = keys[(i + 1) % n];
  const p3 = keys[(i + 2) % n];
  const t2 = t * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t);
}

// Cubic Hermite through (t, value) keys with Catmull-Rom tangents (given end
// tangents), for the non-uniform swing path.
function hermite(ts, vs, m0, m1, t) {
  let i = 0;
  while (i < ts.length - 2 && t > ts[i + 1]) i++;
  const t0 = ts[i], t1 = ts[i + 1];
  const h = t1 - t0;
  const u = clamp((t - t0) / h, 0, 1);
  const tan = (k) => (k === 0 ? m0 : k === ts.length - 1 ? m1 : (vs[k + 1] - vs[k - 1]) / (ts[k + 1] - ts[k - 1]));
  const a = tan(i) * h, b = tan(i + 1) * h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * a + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * b;
}

const _st = new Float64Array(SWING.length + 2);
const _sz = new Float64Array(SWING.length + 2);
const _sy = new Float64Array(SWING.length + 2);
const _hips = new THREE.Matrix4();
const _hipsInv = new THREE.Matrix4();
const _eul = new THREE.Euler();
const _qh = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(envDef) {
    configure();
    this.u = makeEnvUniforms(envDef);
    const rig = [
      new THREE.Vector4(RIG.sockY, RIG.bootX, RIG.cuffU, RIG.shortsHem),
      new THREE.Vector4(RIG.bootCollar[0], RIG.bootCollar[1], RIG.soleH, 0),
    ];
    const { mat, ink } = makeCharacterMaterials(this.u, palette(), rig, 0.0105);
    this.mat = mat;
    this.inkMat = ink;
    this.root = new THREE.Group();
    this.root.name = 'player';
    this.buildSkeleton();
    this.buildBody();
    this.buildShadow();
    this.buildSim();

    this.pose = new Float32Array(N);
    this.pRun = new Float32Array(N);
    this.pJump = new Float32Array(N);
    this.pSlide = new Float32Array(N);
    this.pIdle = new Float32Array(N);
    this.pCrash = new Float32Array(N);
    this.w = { run: 0, jump: 0, slide: 0, idle: 1 };
    this.stride = 0;
    this.springs = {};
    for (const k of ['hdPitch', 'hdYaw', 'hdRoll', 'spLean', 'chTwist', 'spSide', 'chSide', 'shLx', 'shRx', 'shLz', 'shRz', 'elL', 'elR', 'swL', 'swR', 'abL', 'abR', 'lane', 'land']) {
      this.springs[k] = new Spring();
    }
    // the body riding on the pelvis (see animate): torso fold and sway, a
    // surge fore and aft, arms flopping and flung
    this.dyn = {};
    for (const k of ['flex', 'sway', 'surge', 'flap', 'fling', 'rootRoll', 'rootYaw']) this.dyn[k] = new Spring();
    this.wS = { run: new Spring(), jump: new Spring(), slide: new Spring(), idle: new Spring(1) };
    this.pelvisP = new THREE.Vector3();
    this.pelvisV = new THREE.Vector3();
    this.pelvisA = new THREE.Vector3();
    this.pelvisD = new THREE.Vector3();
    this.pelvisDP = new THREE.Vector3();
    this.poseP = new THREE.Vector3();
    this.poseV = new THREE.Vector3();
    this.breeze = new THREE.Vector3();
    this.hairBones = RIG.hair.map((h) => ({ name: h.name, dir: new THREE.Vector3(...h.dir) }));
    this.hair = this.hairBones.map(() => ({ x: new Spring(), y: new Spring(), z: new Spring() }));
    this.mantle = Array.from({ length: MANTLE.panels }, () => new Spring(0.02));
    this.lid = new Spring();
    this.mantleBob = new Spring();
    this.reset();
  }

  // --- skeleton -----------------------------------------------------------------
  buildSkeleton() {
    const bones = [];
    const ids = {};
    this.b = {};
    const add = (name, parent, b) => {
      b.name = name;
      if (parent) parent.add(b);
      ids[name] = bones.length;
      bones.push(b);
      this.b[name] = b;
      return b;
    };
    // the sculpted body's skeleton, bound as it was modelled (arms a little
    // out); the poses set absolute rotations, so the bind angles never show
    for (const d of runner().meta.bones) {
      const b = new THREE.Bone();
      // (yaw outermost: the mantle panels turn to face out; the thighs turn
      // against the pelvis so a planted foot keeps pointing down the track)
      if (d.name.startsWith('mtU') || d.name.startsWith('thigh')) b.rotation.order = 'YXZ';
      b.position.fromArray(d.p);
      b.quaternion.fromArray(d.q);
      add(d.name, d.parent ? this.b[d.parent] : null, b);
    }
    this.panelAngle = Array.from({ length: MANTLE.panels }, (_, k) => (k / MANTLE.panels) * TAU);
    // one bone per cape particle, in root space, bound in the cape's rest shape
    this.capeRest = capeBind();
    this.capeBones = [];
    this.capeFirst = bones.length;
    for (let j = 0; j < CAPE.rows; j++) {
      for (let i = 0; i < CAPE.cols; i++) {
        const k = j * CAPE.cols + i;
        const b = add('cp' + k, this.b.sim, new THREE.Bone());
        b.position.fromArray(this.capeRest, k * 3);
        capeFrame(this.capeRest, i, j, b.quaternion);
        this.capeBones.push(b);
      }
    }

    this.ids = ids;
    this.bones = bones;
    this.body = this.b.body;
    this.simRoot = this.b.sim;
    this.root.add(this.body, this.simRoot);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.bindPos = {};
    for (const b of bones) this.bindPos[b.name] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  }

  // --- the model ------------------------------------------------------------------
  buildBody() {
    const geo = buildRunnerGeometry(this.capeFirst);
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

  buildShadow() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0.35 } },
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

  // --- secondary-motion state ------------------------------------------------------
  buildSim() {
    // the cape, pinned along the inside of the mantle's hem: each pin follows
    // the mantle bones exactly as the hem's own vertices do
    this.cloth = new Cloth(CAPE.cols, CAPE.rows, this.capeRest);
    const mw = mantleWeights(this.ids);
    this.pins = [];
    for (let i = 0; i < CAPE.cols; i++) {
      const p = new THREE.Vector3().fromArray(this.capeRest, i * 3);
      const out = [];
      mw(p.x, p.y, p.z, out);
      let total = 0;
      for (let k = 1; k < out.length; k += 2) total += out[k];
      const w = [];
      for (let k = 0; k < out.length; k += 2) w.push([out[k], out[k + 1] / total]);
      this.pins.push({ p, w });
    }
    // what the cape can't pass through: torso and hips (elliptic), head,
    // limbs, boots and the pouch
    const col = (bone, a, b, r, rz = 0) => ({ bone: this.b[bone], a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), r, rz });
    this.colliders = [
      col('hips', [0, -0.12, 0.006], [0, 0.1, 0.006], 0.205, 0.168),
      col('chest', [0, -0.05, 0.01], [0, 0.14, 0.01], 0.19, 0.155),
      col('head', [0, 0.1, 0.01], [0, 0.145, 0.01], 0.125),
      col('pouch', [-0.012, -0.04, 0], [-0.012, -0.09, 0], 0.045),
    ];
    for (const L of ['L', 'R']) {
      this.colliders.push(
        col('arm' + L, [0, 0, 0], [0, -UPPER_ARM, 0], 0.085),
        col('fore' + L, [0, 0, 0], [0, -FOREARM - 0.07, 0], 0.075),
        col('thigh' + L, [0, 0, 0], [0, -THIGH, 0], 0.1),
        col('shin' + L, [0, 0, 0], [0, -SHIN + 0.05, 0], 0.058),
        col('foot' + L, [0, -0.04, 0.04], [0, -0.055, -0.13], 0.07),
      );
    }
    this.cloth.setColliderCount(this.colliders.length);
    this.wind = { gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0, turb: 0, freq: 1, wave: 1, kn: 0, kt: 0, floor: 0, t: 0 };

    this.pouchSim = {
      local: new THREE.Vector3(...RIG.pouch).sub(this.bindPos.hips),
      len: 0.05,
      p: new THREE.Vector3(),
      q: new THREE.Vector3(),
      vy: 0,
    };
    this.anchor = new THREE.Vector3();
    this.frameVel = new THREE.Vector3();
    this.frameAcc = new THREE.Vector3();
    this.gravity = new THREE.Vector3();
    this.air = new THREE.Vector3();
    this.accLocal = new THREE.Vector3();
    this.invQ = new THREE.Quaternion();
    this.headPos = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.headAcc = new THREE.Vector3();
    this.hipsInv = new THREE.Matrix4();
    this.chestInv = new THREE.Matrix4();
    this.chestPrev = new THREE.Vector3();
    // points along each upper arm, in the mantle's terms (see armOffsets)
    this._arms = Array.from({ length: 2 * ARM_SAMPLES.length }, () => ({ th: 0, r: 0, drop: 0 }));
  }

  resetSim() {
    const ps = this.pouchSim;
    ps.p.set(RIG.pouch[0] - 0.01, RIG.pouch[1] - ps.len, RIG.pouch[2]);
    ps.q.copy(ps.p);
    ps.vy = 0;
    this.frameVel.set(0, 0, 0);
    this.frameAcc.set(0, 0, 0);
    this.headVel.set(0, 0, 0);
    this.headAcc.set(0, 0, 0);
    this.simReady = false;
  }

  // --- state ------------------------------------------------------------------
  reset() {
    this.lane = 1;
    this.prevLane = 1;
    this.x = CONFIG.laneX[1];
    this.vx = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.slideT = 0;
    this.jumpBuffer = 0;
    this.slideQueued = false;
    this.stumbleT = 0;
    this.invulnT = 0;
    this.crashed = false;
    this.crashT = 0;
    this.reviveT = 0;
    this.landT = 0;
    this.jumpT = 9;
    this.jumpSide = 1;
    this.slideSide = 1;
    this.phase = 0;
    this.time = 0;
    this.speed = 0;
    this.mode = 'idle';
    this.w.run = 0;
    this.w.jump = 0;
    this.w.slide = 0;
    this.w.idle = 1;
    for (const s of Object.values(this.springs)) s.reset();
    for (const s of Object.values(this.dyn)) s.reset();
    for (const [k, s] of Object.entries(this.wS)) s.reset(k === 'idle' ? 1 : 0);
    this.pelvisReady = false;
    for (const h of this.hair) {
      h.x.reset();
      h.y.reset();
      h.z.reset();
    }
    for (const s of this.mantle) s.reset(0.02);
    this.mantleBob.reset();
    this.lid.reset();
    this.root.visible = true;
    this.resetSim();
  }

  get sliding() {
    return this.slideT > 0;
  }

  get height() {
    return this.sliding ? CONFIG.player.slideHeight : CONFIG.player.height;
  }

  action(a) {
    if (this.crashed || this.mode !== 'run') return;
    if (a === 'left' || a === 'right') {
      const next = Math.max(0, Math.min(2, this.lane + (a === 'left' ? -1 : 1)));
      if (next !== this.lane) {
        this.prevLane = this.lane;
        this.lane = next;
      }
    } else if (a === 'up') {
      if (this.grounded) this.jump();
      else this.jumpBuffer = CONFIG.inputBuffer;
    } else if (a === 'down') {
      if (this.grounded) {
        this.startSlide();
      } else {
        this.vy = Math.min(this.vy, -CONFIG.fastFall);
        this.slideQueued = true;
        this.jumpBuffer = 0;
      }
    }
  }

  jump() {
    this.vy = V0;
    this.grounded = false;
    this.slideT = 0;
    this.slideQueued = false;
    this.jumpBuffer = 0;
    this.jumpT = 0;
    this.jumpSide = -this.jumpSide;
  }

  startSlide() {
    if (this.slideT <= 0) this.slideSide = -this.slideSide;
    this.slideT = CONFIG.slide.time;
  }

  bounceBack() {
    const back = this.prevLane;
    this.prevLane = this.lane;
    this.lane = back;
  }

  // Push sideways out of an obstacle we clipped while changing lanes.
  nudgeAwayFrom(ox) {
    const dir = Math.sign(this.x - ox) || 1;
    const target = Math.max(0, Math.min(2, Math.round((ox + dir * 2.4 - CONFIG.laneX[0]) / 2.4)));
    this.prevLane = this.lane;
    this.lane = target;
  }

  stumble() {
    this.stumbleT = 0.6;
  }

  crash() {
    this.crashed = true;
    this.crashT = 0;
    this.slideT = 0;
    this.vy = Math.max(this.vy, 2.5);
    this.grounded = false;
  }

  revive() {
    this.crashed = false;
    this.reviveT = 0.9;
    this.invulnT = CONFIG.reviveInvulnerable;
    this.vy = 0;
    this.y = 0;
    this.grounded = true;
    this.slideT = 0;
    this.lane = Math.round((this.x - CONFIG.laneX[0]) / 2.4);
    this.prevLane = this.lane;
  }

  update(dt, speed, groundAt) {
    this.time += dt;
    this.speed = speed;
    // lanes
    const tx = CONFIG.laneX[this.lane];
    const nx = this.crashed ? this.x : damp(this.x, tx, CONFIG.laneRate, dt);
    this.vx = (nx - this.x) / Math.max(dt, 1e-4);
    this.x = nx;

    // vertical
    const ground = groundAt ? groundAt(this.x) : 0;
    this.groundY = ground;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (!this.grounded) {
      const prevY = this.y;
      this.vy -= G * dt;
      this.y += this.vy * dt;
      // land only when arriving from above; running into a ledge is a hit, not a mantle
      if (this.y <= ground && this.vy <= 0 && prevY >= ground - 0.3) {
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        this.landT = 1;
        if (this.crashed) {
          // stay down
        } else if (this.jumpBuffer > 0) {
          this.jump();
        } else if (this.slideQueued) {
          this.slideQueued = false;
          this.startSlide();
        }
      }
    } else if (this.y > ground + 0.02) {
      // walked off the top of something
      this.grounded = false;
      this.vy = 0;
    } else if (ground - this.y < 0.3) {
      this.y = ground;
    }
    if (!this.grounded && this.y < 0) {
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
    }
    if (this.slideT > 0) this.slideT -= dt;
    if (this.stumbleT > 0) this.stumbleT -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.reviveT > 0) this.reviveT -= dt;
    if (this.landT > 0) this.landT = Math.max(0, this.landT - dt * 4.2);
    this.jumpT += dt;
    if (this.crashed) this.crashT += dt;

    this.animate(dt, speed);
  }

  // --- animation ---------------------------------------------------------------
  animate(dt, speed) {
    const sp = clamp((speed - CONFIG.speed.start) / (CONFIG.speed.max - CONFIG.speed.start), 0, 1);
    const running = this.mode === 'run' && speed > 0.5;
    const freq = running ? 1.5 + speed * 0.055 : 0;
    this.stride = freq;
    this.phase += dt * TAU * freq;
    const f = this.phase;
    const t = this.time;

    // target weights
    let tRun = 0, tJump = 0, tSlide = 0, tIdle = 0;
    if (this.mode !== 'run') tIdle = 1;
    else if (!this.grounded) tJump = 1;
    else if (this.sliding) tSlide = 1;
    else tRun = 1;
    // weights ease in and out (second order, no overshoot) rather than
    // snapping toward their targets
    const W = this.wS;
    this.w.run = Math.max(0, W.run.step(tRun, 4.2, 0.9, dt));
    this.w.jump = Math.max(0, W.jump.step(tJump, 5, 0.85, dt));
    this.w.slide = Math.max(0, W.slide.step(tSlide, 5.5, 0.85, dt));
    this.w.idle = Math.max(0, W.idle.step(tIdle, 1.1, 1, dt));

    this.poseRun(this.pRun, f, sp);
    this.poseJump(this.pJump);
    this.poseSlide(this.pSlide, t);
    this.poseIdle(this.pIdle, t);

    const total = this.w.run + this.w.jump + this.w.slide + this.w.idle || 1;
    const Pz = this.pose;
    for (let i = 0; i < N; i++) {
      Pz[i] = (this.pRun[i] * this.w.run + this.pJump[i] * this.w.jump + this.pSlide[i] * this.w.slide + this.pIdle[i] * this.w.idle) / total;
    }

    // landing: fold, squash, arms drop
    const land = this.springs.land.step(this.landT * this.landT, 5.5, 0.32, dt);
    Pz[C.hipY] -= 0.1 * land;
    Pz[C.knL] += 0.5 * land;
    Pz[C.knR] += 0.5 * land;
    Pz[C.thLx] += 0.25 * land;
    Pz[C.thRx] += 0.25 * land;
    Pz[C.anL] += 0.25 * land;
    Pz[C.anR] += 0.25 * land;
    Pz[C.spLean] += 0.22 * land;
    Pz[C.elL] -= 0.4 * land;
    Pz[C.elR] -= 0.4 * land;
    Pz[C.shLz] += 0.25 * land;
    Pz[C.shRz] += 0.25 * land;
    Pz[C.sq] -= 0.07 * land;
    // take-off stretch
    if (this.jumpT < 0.25) Pz[C.sq] += 0.06 * Math.sin((this.jumpT / 0.25) * Math.PI);

    // lane changes: lean in, look where you're going, fling the outside arm
    const lc = this.springs.lane.step(clamp(this.vx / 9, -1, 1), 3.2, 0.55, dt);
    Pz[C.hdYaw] -= 0.4 * lc;
    Pz[C.spSide] -= 0.12 * lc;
    Pz[C.chTwist] -= 0.12 * lc;
    Pz[C.shLz] += 0.55 * Math.max(0, lc);
    Pz[C.shRz] += 0.55 * Math.max(0, -lc);
    Pz[C.elL] -= 0.4 * Math.max(0, lc);
    Pz[C.elR] -= 0.4 * Math.max(0, -lc);

    // stumble overlay: pitch forward, arms windmill
    let roll = 0;
    if (this.stumbleT > 0) {
      const a = this.stumbleT / 0.6;
      const e = Math.sin(a * Math.PI);
      Pz[C.spLean] += 0.5 * e;
      Pz[C.hdPitch] -= 0.35 * e;
      Pz[C.shLx] += Math.sin(t * 22) * 1.3 * e;
      Pz[C.shRx] += Math.cos(t * 22) * 1.3 * e;
      Pz[C.shLz] += 0.9 * e;
      Pz[C.shRz] += 0.9 * e;
      Pz[C.elL] -= 0.5 * e;
      Pz[C.elR] -= 0.5 * e;
      roll = Math.sin(t * 15) * 0.16 * e;
    }

    // crash: knocked onto your back, limbs flailing; revive gets you back up
    const c = this.pCrash;
    let cw = 0;
    if (this.crashed) cw = Math.min(1, this.crashT / 0.45);
    else if (this.reviveT > 0) cw = Math.min(1, this.reviveT / 0.9);
    if (cw > 0) {
      const e = cw * cw * (3 - 2 * cw);
      const fl = this.crashed ? Math.exp(-this.crashT * 3) : 0;
      c.set(Pz);
      c[C.bodyPitch] = 1.42;
      c[C.bodyZ] = 0.55;
      c[C.hipY] = HIP_Y;
      c[C.hipPitch] = 0;
      c[C.spLean] = -0.1;
      c[C.chLean] = 0;
      c[C.hdPitch] = -0.4;
      c[C.thLx] = 0.75 + Math.sin(t * 17) * 0.5 * fl;
      c[C.thRx] = 0.35 + Math.cos(t * 15) * 0.5 * fl;
      c[C.knL] = 0.6;
      c[C.knR] = 0.25;
      c[C.anL] = 0.3;
      c[C.anR] = 0.2;
      c[C.shLx] = 2.4 + Math.sin(t * 19) * 0.6 * fl;
      c[C.shRx] = 2.1 + Math.cos(t * 21) * 0.6 * fl;
      c[C.shLz] = 0.9;
      c[C.shRz] = 0.7;
      c[C.elL] = 0.3;
      c[C.elR] = 0.4;
      for (let i = 0; i < N; i++) Pz[i] += (c[i] - Pz[i]) * e;
    }

    // --- weight and inertia -------------------------------------------------------
    // The pose is not carried rigidly: torso, head and arms ride on the pelvis
    // like loose springs, pushed by its acceleration — the bounce and sway of
    // each stride, and the root's lane changes, jumps, landings and changes
    // of pace. A footfall ripples up the spine and drops the arms a touch; a
    // lane change whips the shoulders across and lets them swing back; a
    // landing folds the body and it springs up again.
    // (Each spring is kicked by the pelvis's change of velocity this frame —
    // an impulse, so a sudden lane change or a landing hits exactly as hard at
    // any frame rate — and then rings out; the outputs saturate softly.)
    // (The stride's own bounce kicks harder than the root's jumps and lane
    // changes, so every footfall shows without a jump folding him in half.)
    this.pelvisDV(dt, Pz);
    const dv = this.pelvisD, dp = this.pelvisDP;
    const D = this.dyn;
    const live = 1 - cw;
    const kick = (spr, c, d) => (spr.v += c * d * live);
    const soft = (x, m) => m * Math.tanh(x / m);
    kick(D.flex, 1.2, dv.y);
    kick(D.flex, 3.6, dp.y);
    kick(D.flap, -1.0, dv.y);
    kick(D.flap, -3.2, dp.y);
    kick(D.sway, 0.12, dv.x);
    kick(D.sway, 0.5, dp.x);
    kick(D.fling, 0.17, dv.x);
    kick(D.fling, 0.6, dp.x);
    kick(D.surge, 0.05, dv.z);
    const flex = soft(D.flex.step(0, 3.2, 0.32, dt), 0.3);
    const flap = soft(D.flap.step(0, 3, 0.26, dt), 0.35);
    const sway = soft(D.sway.step(0, 1.8, 0.36, dt), 0.22);
    const fling = soft(D.fling.step(0, 2.1, 0.3, dt), 0.35);
    const surge = soft(D.surge.step(0, 1.5, 0.4, dt), 0.25);
    Pz[C.spLean] += 0.55 * flex + surge;
    Pz[C.chLean] += 0.45 * flex;
    Pz[C.hdPitch] += 0.5 * flex + 0.6 * surge; // (the head keeps half its gaze)
    Pz[C.spSide] += 0.6 * sway;
    Pz[C.chSide] += 0.4 * sway;
    Pz[C.hdRoll] -= 0.55 * sway;
    Pz[C.shLz] += flap + fling;
    Pz[C.shRz] += flap - fling;
    Pz[C.elL] -= 0.5 * flap;
    Pz[C.elR] -= 0.5 * flap;
    Pz[C.shLx] += 0.8 * surge;
    Pz[C.shRx] += 0.8 * surge;

    // --- follow-through springs ---------------------------------------------------
    const S = this.springs;
    Pz[C.spLean] = S.spLean.step(Pz[C.spLean], 5, 0.45, dt);
    Pz[C.chTwist] = S.chTwist.step(Pz[C.chTwist], 4.2, 0.4, dt);
    Pz[C.spSide] = S.spSide.step(Pz[C.spSide], 4, 0.42, dt);
    Pz[C.chSide] = S.chSide.step(Pz[C.chSide], 3.4, 0.38, dt);
    // the arms trail the shoulders' swing and overshoot it at each reversal
    Pz[C.shLx] = S.shLx.step(Pz[C.shLx], 5.2, 0.48, dt);
    Pz[C.shRx] = S.shRx.step(Pz[C.shRx], 5.2, 0.48, dt);
    Pz[C.shLz] = S.shLz.step(Pz[C.shLz], 4.2, 0.4, dt);
    Pz[C.shRz] = S.shRz.step(Pz[C.shRz], 4.2, 0.4, dt);
    Pz[C.hdPitch] = S.hdPitch.step(Pz[C.hdPitch], 4.5, 0.42, dt);
    Pz[C.hdYaw] = S.hdYaw.step(Pz[C.hdYaw], 4, 0.5, dt);
    Pz[C.hdRoll] = S.hdRoll.step(Pz[C.hdRoll], 4, 0.4, dt);
    // elbows trail the shoulders a touch; wrists flop behind the whole arm
    Pz[C.elL] = S.elL.step(Pz[C.elL], 6, 0.42, dt);
    Pz[C.elR] = S.elR.step(Pz[C.elR], 6, 0.42, dt);
    const armL = Pz[C.shLx] + Pz[C.elL];
    const armR = Pz[C.shRx] + Pz[C.elR];
    Pz[C.wrL] += 0.45 * (S.swL.step(armL, 3.2, 0.5, dt) - armL);
    Pz[C.wrR] += 0.45 * (S.swR.step(armR, 3.2, 0.5, dt) - armR);
    Pz[C.wrLz] += 0.6 * (S.abL.step(Pz[C.shLz], 3, 0.45, dt) - Pz[C.shLz]);
    Pz[C.wrRz] += 0.6 * (S.abR.step(Pz[C.shRz], 3, 0.45, dt) - Pz[C.shRz]);

    this.applyPose(Pz, roll);

    // lean into lane changes
    const lean = clamp(-this.vx * 0.035, -0.4, 0.4);
    this.root.rotation.z = D.rootRoll.step(this.crashed ? 0 : lean, 2.4, 0.45, dt);
    this.root.rotation.y = D.rootYaw.step(this.crashed ? 0 : clamp(-this.vx * 0.025, -0.35, 0.35), 2.8, 0.5, dt);

    this.secondary(dt, sp);

    // invulnerability blink
    this.root.visible = this.invulnT > 0 && !this.crashed ? Math.floor(this.invulnT * 12) % 2 === 0 : true;
  }

  // The pelvis's change of velocity this frame in the runner's frame (x
  // right, y up, z back), split into the root's own motion (pelvisD) and the
  // pose's bounce and sway (pelvisDP); also a smoothed total acceleration
  // for the cloth.
  pelvisDV(dt, Pz) {
    const P = this.pelvisP, Vp = this.pelvisV, Ac = this.pelvisA, dv = this.pelvisD, dp = this.pelvisDP;
    const hx = Pz[C.hipX], hy = Pz[C.hipY];
    if (!this.pelvisReady || dt <= 0) {
      P.set(this.x, this.y, 0);
      this.poseP.set(hx, hy, 0);
      Vp.set(0, 0, -this.speed);
      this.poseV.set(0, 0, 0);
      Ac.set(0, 0, 0);
      dv.set(0, 0, 0);
      dp.set(0, 0, 0);
      this.pelvisReady = dt > 0;
      return;
    }
    const vx = (this.x - P.x) / dt, vy = (this.y - P.y) / dt, vz = -this.speed;
    const ux = (hx - this.poseP.x) / dt, uy = (hy - this.poseP.y) / dt;
    dv.set(vx - Vp.x, vy - Vp.y, vz - Vp.z);
    dp.set(ux - this.poseV.x, uy - this.poseV.y, 0);
    const k = 1 - Math.exp(-dt * 30);
    Ac.x += (clamp((dv.x + dp.x) / dt, -80, 80) - Ac.x) * k;
    Ac.y += (clamp((dv.y + dp.y) / dt, -80, 80) - Ac.y) * k;
    Ac.z += (clamp(dv.z / dt, -80, 80) - Ac.z) * k;
    P.set(this.x, this.y, 0);
    Vp.set(vx, vy, vz);
    this.poseP.set(hx, hy, 0);
    this.poseV.set(ux, uy, 0);
  }

  poseRun(r, f, sp) {
    const s = Math.sin(f);
    // slow wander so no two strides are quite the same
    const wander = 0.5 * Math.sin(f * 0.31 + 1.3) + 0.5 * Math.sin(f * 0.19);
    const armAmp = (0.88 + 0.22 * sp) * (1 + 0.08 * wander);
    // the pelvis bounces like a ball: a quick dip into each contact, a
    // rounded float through the flight; and it carries the weight across
    // onto each planted foot
    const bob = 0.4 * (0.5 - 0.5 * Math.cos(2 * f)) + 0.6 * Math.pow(Math.abs(Math.sin(f)), 0.8);
    r[C.hipY] = STRIDE.hipY + STRIDE.bob * (0.9 + 0.2 * sp) * bob;
    r[C.hipX] = 0.02 * Math.sin(f - 1.4);
    r[C.hipYaw] = -0.2 * Math.sin(f - 0.5);
    r[C.hipRoll] = 0.07 * Math.cos(f + 0.3);
    r[C.hipPitch] = 0.06;
    r[C.spLean] = 0.17 + 0.12 * sp + 0.035 * Math.cos(2 * f - 1.0);
    r[C.spTwist] = 0.17 * s;
    r[C.spSide] = -0.6 * r[C.hipRoll];
    r[C.chLean] = 0.05;
    r[C.chTwist] = 0.13 * s;
    r[C.chSide] = -0.2 * r[C.hipRoll];
    r[C.hdPitch] = r[C.hipPitch] + r[C.spLean] + r[C.chLean] - 0.22;
    r[C.hdYaw] = -0.7 * (r[C.hipYaw] + r[C.spTwist] + r[C.chTwist]);
    r[C.hdRoll] = -0.6 * (r[C.hipRoll] + r[C.spSide]);
    for (const [ph, sh, sy, sz, el, cl, wr, wz] of [
      [f, C.shLx, C.shLy, C.shLz, C.elL, C.clL, C.wrL, C.wrLz],
      [f + Math.PI, C.shRx, C.shRy, C.shRz, C.elR, C.clR, C.wrR, C.wrRz],
    ]) {
      const q = ph + Math.PI; // arm follows the opposite leg
      r[sh] = cyc(ARM.swing, q) * armAmp + 0.06;
      r[sz] = cyc(ARM.abd, q) + 0.04;
      r[sy] = 0.1 * Math.sin(q);
      r[el] = cyc(ARM.elbow, q - 0.25);
      r[cl] = 0;
      r[wr] = 0.18;
      r[wz] = 0.05;
    }
    r[C.bodyPitch] = 0;
    r[C.bodyZ] = 0;
    r[C.bodyRoll] = 0;
    r[C.sq] = 1;
    this.runLegs(r, f, sp);
  }

  // Idle feet: planted a little apart, the free foot's heel lifting as the
  // weight leaves it.
  plantIdle(r, ws) {
    _eul.set(-r[C.hipPitch], r[C.hipYaw], r[C.hipRoll]);
    _hips.compose(_v3.set(r[C.hipX], r[C.hipY], 0), _qh.setFromEuler(_eul), _one);
    _hipsInv.copy(_hips).invert();
    const ballH = ANKLE_H - TOE_D;
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? -1 : 1;
      const lift = 0.3 * smooth(0.2, 1, -sx * ws);
      const bz = side === 0 ? -0.13 : -0.08;
      const ay = ballH + TOE_D * Math.cos(lift) + TOE_F * Math.sin(lift);
      const az = bz + TOE_F * Math.cos(lift) - TOE_D * Math.sin(lift);
      this.solveLeg(r, side, sx, sx * 0.1, ay, az, -lift, -r[C.hipPitch], null);
      r[side === 0 ? C.toL : C.toR] = lift;
    }
  }

  // Place both feet for run phase f (see STRIDE) and solve the legs.
  runLegs(r, f, sp) {
    const v = Math.max(this.speed, 0);
    const freq = this.stride;
    const duty = freq > 0 ? clamp((STRIDE.reach * freq) / Math.max(v, 1e-3), STRIDE.minContact * freq, STRIDE.maxDuty) : STRIDE.maxDuty;
    const span = freq > 0 ? Math.min(STRIDE.reach, (v * duty) / freq) : 0;
    const zTD = STRIDE.ballZ - span / 2;
    const ballH = ANKLE_H - TOE_D;
    // this pose's hips, to bring the targets into hip space
    _eul.set(-r[C.hipPitch], r[C.hipYaw], r[C.hipRoll]);
    _hips.compose(_v3.set(r[C.hipX], r[C.hipY], 0), _qh.setFromEuler(_eul), _one);
    _hipsInv.copy(_hips).invert();
    const hipTilt = -r[C.hipPitch];
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? -1 : 1;
      const ph = f + side * Math.PI;
      // u: 0 at touchdown; the contact is centred on mid-stance (ph = pi)
      let u = (ph - Math.PI + Math.PI * duty) / TAU;
      u -= Math.floor(u);
      let ax, ay, az, pitch, toe;
      if (u < duty) {
        const c = u / duty;
        const lift = STRIDE.heelLift * Math.pow(smooth(0.3, 1, c), 1.3);
        const bz = zTD + span * c;
        // the ankle swings up over the planted ball as the heel lifts
        ay = ballH + TOE_D * Math.cos(lift) + TOE_F * Math.sin(lift);
        az = bz + TOE_F * Math.cos(lift) - TOE_D * Math.sin(lift);
        ax = sx * STRIDE.trackX;
        pitch = -lift;
        toe = lift;
        this.solveLeg(r, side, sx, ax, ay, az, pitch, hipTilt, null);
      } else {
        const c = (u - duty) / (1 - duty);
        const lift = STRIDE.heelLift;
        const toY = ballH + TOE_D * Math.cos(lift) + TOE_F * Math.sin(lift);
        const toZ = zTD + span + TOE_F * Math.cos(lift) - TOE_D * Math.sin(lift);
        const n = SWING.length;
        _st[0] = 0;
        _sz[0] = toZ;
        _sy[0] = toY;
        for (let k = 0; k < n; k++) {
          const K = SWING[k];
          _st[k + 1] = K[0];
          _sz[k + 1] = K[1] + K[3] * sp;
          _sy[k + 1] = K[2] + K[4] * sp;
        }
        _st[n + 1] = 1;
        _sz[n + 1] = zTD + TOE_F;
        _sy[n + 1] = ANKLE_H;
        // leaving the ground rising and still travelling back; arriving
        // steeply, pawing back toward the ground's own motion
        az = hermite(_st, _sz, 0.6, 1.2, c);
        ay = hermite(_st, _sy, 1.2, -1.4, c);
        ax = sx * (STRIDE.trackX + (STRIDE.swingX - STRIDE.trackX) * Math.sin(Math.PI * c));
        // the foot trails off the toe, hangs from the shin, then levels out,
        // toe up, to meet the ground
        toe = lift * (1 - smooth(0, 0.3, c));
        this.solveLeg(r, side, sx, ax, ay, az, 0, hipTilt, c);
      }
      r[side === 0 ? C.toL : C.toR] = toe;
    }
  }

  // Two-bone solve of one leg for an ankle target (root space). The thigh's
  // splay puts the knee's plane through the target; the knee bends forward.
  // c = null: planted, the foot held at pitch; else the swing's progress.
  solveLeg(r, side, sx, ax, ay, az, pitch, hipTilt, c) {
    const d = _v.set(ax, ay, az).applyMatrix4(_hipsInv);
    d.x -= sx * HIP_JOINT.x;
    d.y -= HIP_JOINT.y - HIP_Y;
    // turn the leg against the pelvis's swing (plus a touch of toe-out), then
    // solve in the leg's own frame
    const yaw = -r[C.hipYaw] - sx * STRIDE.toeOut;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    d.set(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
    const reach = THIGH + SHIN;
    let L = d.length();
    L = clamp(L, Math.abs(THIGH - SHIN) + 0.02, reach - 0.003);
    const kn = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - L * L) / (2 * THIGH * SHIN), -1, 1));
    // the ankle in the leg's own plane, before splay and pitch
    const ly = -THIGH - SHIN * Math.cos(kn);
    const lz = SHIN * Math.sin(kn);
    const ll = Math.hypot(ly, lz);
    const tz = Math.asin(clamp(-d.x / (Math.hypot(d.y, d.z, d.x) * (ly / ll)), -0.9, 0.9));
    const tx = Math.atan2(d.z, d.y) - Math.atan2(lz / ll, (Math.cos(tz) * ly) / ll);
    const thx = wrapAngle(tx);
    const shin = hipTilt + thx - kn;
    let pt = pitch;
    if (c !== null) {
      const hang = shin - 0.3;
      pt = -STRIDE.heelLift + (hang + STRIDE.heelLift) * smooth(0, 0.3, c);
      pt += (0.16 * (1 - smooth(0.9, 1, c)) - pt) * smooth(0.6, 0.94, c);
    }
    if (side === 0) {
      r[C.thLx] = thx;
      r[C.thLy] = yaw;
      r[C.thLz] = -tz;
      r[C.knL] = kn;
      r[C.anL] = pt - shin;
    } else {
      r[C.thRx] = thx;
      r[C.thRy] = -yaw;
      r[C.thRz] = tz;
      r[C.knR] = kn;
      r[C.anR] = pt - shin;
    }
  }

  // Leap on the way up (lead leg alternates), reaching for the ground on the
  // way down with arms out like wings.
  poseJump(j) {
    const fall = smooth(0, 1, -this.vy / V0 + 0.35);
    const m = (a, b) => a + (b - a) * fall;
    j[C.hipY] = HIP_Y;
    j[C.hipX] = 0;
    j[C.hipYaw] = m(-0.15, 0);
    j[C.hipRoll] = 0;
    j[C.hipPitch] = m(0.02, 0.06);
    j[C.spLean] = m(0.1, 0.16);
    j[C.spTwist] = m(0.16, 0);
    j[C.spSide] = 0;
    j[C.chLean] = m(-0.1, 0.02);
    j[C.chTwist] = m(0.1, 0);
    j[C.chSide] = 0;
    j[C.hdPitch] = m(0.12, 0.1);
    j[C.hdYaw] = m(-0.08, 0);
    j[C.hdRoll] = 0;
    j[C.thLx] = m(1.2, 0.78);
    j[C.knL] = m(1.45, 0.8);
    j[C.anL] = m(0.3, 0.25);
    j[C.toL] = 0;
    j[C.thRx] = m(-0.45, 0.4);
    j[C.knR] = m(1.15, 1.05);
    j[C.anR] = m(-0.6, 0.12);
    j[C.toR] = m(0.35, 0);
    j[C.thLz] = m(0.05, 0.1);
    j[C.thRz] = m(0.05, 0.12);
    j[C.shLx] = m(-0.55, 0.35);
    j[C.shLz] = m(0.6, 0.85);
    j[C.shLy] = 0;
    j[C.elL] = m(0.55, 0.45);
    j[C.shRx] = m(1.55, 0.25);
    j[C.shRz] = m(0.28, 0.9);
    j[C.shRy] = 0;
    j[C.elR] = m(0.75, 0.5);
    j[C.clL] = m(0, 0.1);
    j[C.clR] = m(0.12, 0.1);
    j[C.wrL] = 0.15;
    j[C.wrR] = 0.15;
    j[C.wrLz] = 0;
    j[C.wrRz] = 0;
    j[C.bodyPitch] = 0;
    j[C.bodyZ] = 0;
    j[C.bodyRoll] = 0;
    j[C.sq] = 1;
    if (this.jumpSide < 0) mirror(j);
  }

  // Feet-first slide, leaning back, one hand trailing on the floor.
  poseSlide(s, t) {
    s[C.hipY] = 0.3;
    s[C.hipX] = 0;
    s[C.hipYaw] = 0.14;
    s[C.hipRoll] = 0.08;
    s[C.hipPitch] = -0.2;
    s[C.spLean] = -0.72 + Math.sin(t * 9) * 0.02;
    s[C.spTwist] = -0.12;
    s[C.spSide] = -0.06;
    s[C.chLean] = -0.12;
    s[C.chTwist] = -0.06;
    s[C.chSide] = 0;
    s[C.hdPitch] = -0.85;
    s[C.hdYaw] = -0.05;
    s[C.hdRoll] = 0;
    s[C.thLx] = 1.3;
    s[C.knL] = 0.12;
    s[C.anL] = 0.45;
    s[C.toL] = 0;
    s[C.thRx] = 0.85;
    s[C.knR] = 1.75;
    s[C.anR] = 0.1;
    s[C.toR] = 0;
    s[C.thLz] = 0.06;
    s[C.thRz] = 0.38;
    s[C.shLx] = -0.7;
    s[C.shLz] = 0.62;
    s[C.shLy] = 0;
    s[C.elL] = 0.15;
    s[C.shRx] = 1.0;
    s[C.shRz] = 0.75;
    s[C.shRy] = 0;
    s[C.elR] = 0.8;
    s[C.clL] = 0;
    s[C.clR] = 0.12;
    s[C.wrL] = -0.4;
    s[C.wrR] = 0.2;
    s[C.wrLz] = 0;
    s[C.wrRz] = 0;
    s[C.bodyPitch] = 0;
    s[C.bodyZ] = 0;
    s[C.bodyRoll] = 0;
    s[C.sq] = 1;
    if (this.slideSide < 0) mirror(s);
  }

  // Title screen: breathing, settling onto one leg and then the other (the
  // weight eases across and rests a while; the free hip drops, its knee
  // softens and its heel peels up), looking around. The feet stay planted.
  poseIdle(id, t) {
    const br = Math.sin(t * 2.0);
    const raw = Math.sin(t * 0.42 + 0.6 * Math.sin(t * 0.17));
    const ws = Math.tanh(2.6 * raw) / Math.tanh(2.6); // -1 on the left leg .. 1 on the right
    id[C.hipY] = HIP_Y - 0.016 + br * 0.004 - Math.abs(ws) * 0.008;
    id[C.hipX] = ws * 0.045;
    id[C.hipYaw] = 0.06 * Math.sin(t * 0.37) - 0.04 * ws;
    id[C.hipRoll] = ws * 0.075;
    id[C.hipPitch] = 0.02;
    id[C.spLean] = 0.03 + br * 0.012;
    id[C.spTwist] = Math.sin(t * 0.5) * 0.05 + 0.04 * ws;
    id[C.spSide] = -ws * 0.065;
    id[C.chLean] = -0.01 * br;
    id[C.chTwist] = Math.sin(t * 0.43 + 1) * 0.04;
    id[C.chSide] = -ws * 0.02;
    id[C.hdPitch] = 0.04 + Math.sin(t * 0.7) * 0.05;
    id[C.hdYaw] = Math.sin(t * 0.43) * 0.4;
    id[C.hdRoll] = 0.02 * ws;
    this.plantIdle(id, ws);
    // the arms drift loosely with the weight and the breath
    id[C.shLx] = 0.06 + 0.04 * Math.sin(t * 0.42 + 0.8) + 0.015 * br;
    id[C.shRx] = 0.02 + 0.04 * Math.sin(t * 0.39 + 2.1) + 0.015 * br;
    id[C.shLy] = 0;
    id[C.shRy] = 0;
    id[C.shLz] = 0.42 - 0.03 * ws;
    id[C.shRz] = 0.42 + 0.03 * ws;
    id[C.elL] = 0.3 + br * 0.03;
    id[C.elR] = 0.24 + br * 0.02;
    id[C.clL] = br * 0.015;
    id[C.clR] = br * 0.015;
    id[C.wrL] = 0.15;
    id[C.wrR] = 0.12;
    id[C.wrLz] = 0;
    id[C.wrRz] = 0;
    id[C.bodyPitch] = 0;
    id[C.bodyZ] = 0;
    id[C.bodyRoll] = 0;
    id[C.sq] = 1;
  }

  applyPose(Pz, roll) {
    const b = this.b;
    const sq = Pz[C.sq];
    b.body.rotation.set(Pz[C.bodyPitch], 0, roll + Pz[C.bodyRoll]);
    b.body.position.z = Pz[C.bodyZ];
    const xs = 1 / Math.sqrt(Math.max(0.5, sq));
    b.body.scale.set(xs, sq, xs);
    b.hips.position.set(Pz[C.hipX], Pz[C.hipY], 0);
    b.hips.rotation.set(-Pz[C.hipPitch], Pz[C.hipYaw], Pz[C.hipRoll]);
    b.spine.rotation.set(-Pz[C.spLean], Pz[C.spTwist], Pz[C.spSide]);
    b.chest.rotation.set(-Pz[C.chLean], Pz[C.chTwist], Pz[C.chSide]);
    b.neck.rotation.set(Pz[C.hdPitch] * 0.3, Pz[C.hdYaw] * 0.35, Pz[C.hdRoll] * 0.4);
    b.head.rotation.set(Pz[C.hdPitch] * 0.7, Pz[C.hdYaw] * 0.65, Pz[C.hdRoll] * 0.6);
    b.clavL.rotation.z = -Pz[C.clL];
    b.clavR.rotation.z = Pz[C.clR];
    b.armL.rotation.set(Pz[C.shLx], -Pz[C.shLy], -Pz[C.shLz]);
    b.armR.rotation.set(Pz[C.shRx], Pz[C.shRy], Pz[C.shRz]);
    b.foreL.rotation.x = Pz[C.elL];
    b.foreR.rotation.x = Pz[C.elR];
    b.handL.rotation.set(Pz[C.wrL], 0, -Pz[C.wrLz]);
    b.handR.rotation.set(Pz[C.wrR], 0, Pz[C.wrRz]);
    b.thighL.rotation.set(Pz[C.thLx], Pz[C.thLy], -Pz[C.thLz]);
    b.thighR.rotation.set(Pz[C.thRx], -Pz[C.thRy], Pz[C.thRz]);
    b.shinL.rotation.x = -Pz[C.knL];
    b.shinR.rotation.x = -Pz[C.knR];
    b.footL.rotation.x = Pz[C.anL];
    b.footR.rotation.x = Pz[C.anR];
    b.toeL.rotation.x = Pz[C.toL];
    b.toeR.rotation.x = Pz[C.toR];
  }

  // --- secondary motion: curls, mantle, pouch, cape -------------------------------
  secondary(dt, sp) {
    if (dt <= 0) return;
    // Bone transforms in root space (the renderer recomputes true world
    // matrices later in the frame).
    this.root.matrixWorld.identity();
    this.body.updateWorldMatrix(false, true);

    // Motion of the root through the world -> inertial acceleration, and the
    // air streaming past (plus a gusty breeze so he's never quite still).
    const t = this.time;
    const vel = _v.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
    const acc = _v2.subVectors(vel, this.frameVel).divideScalar(Math.max(dt, 1 / 240));
    this.frameVel.copy(vel);
    acc.clampLength(0, 60);
    this.frameAcc.lerp(acc, 1 - Math.exp(-dt * 30));
    this.invQ.copy(this.root.quaternion).invert();
    this.gravity.set(0, -9.8, 0).applyQuaternion(this.invQ);
    // A soft breeze: slow swells from a wandering direction, now and then a
    // gust. It is what moves him when he stands still, and it keeps working
    // on the cloth on top of the headwind while he runs.
    const swell = 0.5 + 0.5 * Math.sin(t * 0.23 + 2 * Math.sin(t * 0.11));
    const gust = Math.pow(0.5 + 0.5 * Math.sin(t * 0.57 + 1.7 * Math.sin(t * 0.19)), 4);
    const dir = 1.1 * Math.sin(t * 0.07 + 0.5) + 0.5 * Math.sin(t * 0.21 + 1);
    const str = 0.7 + 1.3 * swell + 2.2 * gust;
    this.breeze.set(str * Math.sin(dir), 0.12 * str * Math.sin(t * 0.9), 0.4 + 0.6 * str * Math.abs(Math.cos(dir)));
    this.air.set(-vel.x + this.breeze.x, -vel.y + this.breeze.y, -vel.z + this.breeze.z).applyQuaternion(this.invQ);
    this.accLocal.copy(this.frameAcc).applyQuaternion(this.invQ);
    const airSpeed = this.air.length();
    const spd = clamp(airSpeed / 24, 0, 1.2);
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120))));

    this.hairSim(dt, airSpeed);
    this.mantleSim(dt, spd);
    this.pouchStep(dt, steps, sp);
    this.capeSim(dt);
    this.simReady = true;
  }

  // Curls: each clump swings toward the push of the air streaming back over
  // the head and away from the head's own acceleration — bouncing on every
  // footfall, floating up through a jump.
  hairSim(dt, airSpeed) {
    const b = this.b;
    _v.set(0, 0.12, 0).applyMatrix4(b.head.matrixWorld);
    if (!this.simReady) this.headPos.copy(_v);
    _v2.subVectors(_v, this.headPos).divideScalar(dt);
    this.headPos.copy(_v);
    _v3.subVectors(_v2, this.headVel).divideScalar(dt).add(this.accLocal);
    this.headVel.copy(_v2);
    if (!this.simReady) _v3.set(0, 0, 0);
    this.headAcc.x = damp(this.headAcc.x, clamp(_v3.x, -60, 60), 25, dt);
    this.headAcc.y = damp(this.headAcc.y, clamp(_v3.y, -60, 60), 25, dt);
    this.headAcc.z = damp(this.headAcc.z, clamp(_v3.z, -60, 60), 25, dt);
    // (decompose rather than getWorldQuaternion: that would pull the root's
    // world transform back into these root-space matrices)
    b.head.matrixWorld.decompose(_v3, _q, _v2);
    _q.invert();
    const wind = 0.05 + 0.3 * clamp(airSpeed / 25, 0, 1);
    const B = this.breeze;
    const push = _v
      .set(-this.headAcc.x * 0.0045 + B.x * 0.02, -this.headAcc.y * 0.0055, wind - this.headAcc.z * 0.0035 + B.z * 0.01)
      .applyQuaternion(_q);
    for (let i = 0; i < this.hairBones.length; i++) {
      const d = this.hairBones[i].dir;
      const s = this.hair[i];
      const f = 3.1 + i * 0.22;
      const rx = s.x.step(d.y * push.z - d.z * push.y, f, 0.18, dt);
      const ry = s.y.step(d.z * push.x - d.x * push.z, f, 0.18, dt);
      const rz = s.z.step(d.x * push.y - d.y * push.x, f, 0.18, dt);
      b[this.hairBones[i].name].rotation.set(clamp(rx, -0.45, 0.45), clamp(ry, -0.45, 0.45), clamp(rz, -0.45, 0.45));
    }
  }

  // Mantle panels: wind flare at the back, lift when falling, puff on landing,
  // swing with sideways moves — and shouldered out of the way by the arms.
  mantleSim(dt, spd) {
    const b = this.b;
    const t = this.time;
    const fall = clamp(-(this.grounded ? 0 : this.vy) * 0.05, -0.12, 0.45);
    const puff = this.springs.land.x * 0.3;
    const lat = this.accLocal.x + this.pelvisA.x;
    const bounce = this.mantleBob.step(clamp(-this.pelvisA.y * 0.006, -0.12, 0.12), 2.6, 0.22, dt);
    const bx = this.breeze.x, bz = this.breeze.z;
    const arms = this.armOffsets();
    for (let k = 0; k < MANTLE.panels; k++) {
      const th = this.panelAngle[k];
      const sn = Math.sin(th);
      const cs = Math.cos(th);
      // (the front stands a little off the jacket while running: the chest
      // twists over the belly beneath it)
      let target = 0.02 + 0.03 * Math.max(0, -cs) * this.w.run;
      // (gently at the back: the cape hangs from those panels, and a pumping
      // hem would fling it about)
      target += (0.04 + 0.1 * spd) * Math.pow(Math.max(0, cs), 1.5) * (0.6 + 0.4 * this.w.run);
      target -= 0.015 * spd * Math.max(0, -cs); // (pressed only lightly: the jacket is right beneath)
      target += fall + puff + bounce;
      target += clamp(-lat * sn * 0.012, -0.15, 0.25);
      // the breeze lifts the panels it blows under
      target += 0.025 * Math.max(0, -bx * sn + bz * cs * 0.3) * (1 - 0.6 * this.w.run);
      const flare = this.mantle[k].step(target, 2.6, 0.24, dt);
      let req = -1;
      for (const A of arms) {
        const close = Math.cos(th - A.th);
        if (close < 0.35) continue;
        // tip the panel out (or up and over, for an arm raised past the
        // hinge) until it clears the sleeve's padded surface plus the
        // mantle's own thickness
        const dr = A.r - MANTLE.hingeR;
        const fr = Math.atan2(dr, A.drop) + Math.asin(clamp(0.095 / Math.hypot(dr, A.drop), 0, 1)) - MANTLE.rest;
        req = Math.max(req, Math.min(fr, 1.85) * smooth(0.35, 0.88, close));
      }
      const up = Math.max(flare, req, 0.01);
      // the hem only ever flutters outward, off the jacket
      const flutter = 0.05 * spd * Math.max(0, -cs) * (0.5 + 0.5 * Math.sin(t * 16 + k * 1.9)) + 0.015 * (0.5 + 0.5 * Math.sin(t * 2.1 + k));
      b['mtU' + k].rotation.x = -up;
      b['mtL' + k].rotation.x = -(0.4 * (flare - 0.02) + flutter);
    }
    b.chest.updateWorldMatrix(false, true);
  }

  // Points along each upper arm under the mantle, in chest space: angle
  // around the body, elliptical radius and depth below the panels' hinge
  // (points below the hem count where the arm crosses the hem).
  armOffsets() {
    const b = this.b;
    this.chestInv.copy(b.chest.matrixWorld).invert();
    const hingeY = MANTLE.hinge - CHEST_Y;
    const hemY = MANTLE.hem + 0.012 - CHEST_Y;
    let i = 0;
    for (const side of ['L', 'R']) {
      const S = _v.setFromMatrixPosition(b['arm' + side].matrixWorld).applyMatrix4(this.chestInv);
      const E = _v2.setFromMatrixPosition(b['fore' + side].matrixWorld).applyMatrix4(this.chestInv);
      const dy = E.y - S.y;
      const tHem = dy < -0.02 ? clamp((hemY - S.y) / dy, 0, 1.3) : 1;
      for (const t of ARM_SAMPLES) {
        const tt = Math.min(t, tHem);
        const y = S.y + dy * tt;
        const ez = mantleEZ(clamp(y + CHEST_Y, MANTLE.hem, MANTLE.hinge));
        const x = S.x + (E.x - S.x) * tt;
        const z = (S.z + (E.z - S.z) * tt) / ez;
        const A = this._arms[i++];
        A.th = Math.atan2(x, z);
        A.r = Math.hypot(x, z);
        A.drop = hingeY - y;
      }
    }
    return this._arms;
  }

  // Hip pouch: a pendulum hung from the belt, kept outside the hips, its flap
  // jolting open.
  pouchStep(dt, steps, sp) {
    const b = this.b;
    const t = this.time;
    const h = dt / steps;
    const ps = this.pouchSim;
    const pivot = this.anchor.copy(ps.local).applyMatrix4(b.hips.matrixWorld);
    if (!this.simReady) {
      ps.p.set(pivot.x - 0.01, pivot.y - ps.len, pivot.z);
      ps.q.copy(ps.p);
    }
    this.hipsInv.copy(b.hips.matrixWorld).invert();
    const vyPrev = ps.vy;
    for (let st = 0; st < steps; st++) {
      const vx = (ps.p.x - ps.q.x) / h, vy = (ps.p.y - ps.q.y) / h, vz = (ps.p.z - ps.q.z) / h;
      const ax = this.gravity.x + 0.09 * (this.air.x - vx) - this.accLocal.x;
      const ay = this.gravity.y + 0.09 * (this.air.y - vy) - this.accLocal.y * 0.6;
      const az = this.gravity.z + 0.09 * (this.air.z - vz) - this.accLocal.z;
      ps.q.copy(ps.p);
      ps.p.x += vx * h * 0.985 + ax * h * h;
      ps.p.y += vy * h * 0.985 + ay * h * h;
      ps.p.z += vz * h * 0.985 + az * h * h;
      _v.subVectors(ps.p, pivot);
      ps.p.copy(pivot).addScaledVector(_v, ps.len / (_v.length() || 1e-6));
      _v2.copy(ps.p).applyMatrix4(this.hipsInv);
      const e = Math.hypot(_v2.x / 0.215, _v2.z / 0.18);
      if (e < 1 && _v2.y < 0.15) {
        _v2.x /= e;
        _v2.z /= e;
        ps.p.copy(_v2.applyMatrix4(b.hips.matrixWorld));
      }
    }
    ps.vy = (ps.p.y - ps.q.y) / h;
    const pouch = b.pouch;
    pouch.position.copy(pivot);
    _v.subVectors(ps.p, pivot).normalize();
    _q.setFromUnitVectors(DOWN, _v);
    _v2.set(0, 0, 1).transformDirection(b.hips.matrixWorld);
    _q2.setFromAxisAngle(UP, Math.atan2(_v2.x, _v2.z));
    pouch.quaternion.copy(_q).multiply(_q2);
    const jolt = (ps.vy - vyPrev) / dt;
    this.lid.v += Math.abs(clamp(jolt, -80, 80)) * 0.0012;
    const lid = this.lid.step(0, 5, 0.25, dt);
    b.pouchLid.rotation.z = -clamp(Math.abs(lid) + 0.12 * sp * Math.max(0, Math.sin(t * 17)) * this.w.run, 0, 0.8);
    pouch.updateMatrix();
    pouch.matrixWorld.copy(pouch.matrix);
    b.pouchLid.updateMatrix();
    b.pouchLid.matrixWorld.multiplyMatrices(pouch.matrixWorld, b.pouchLid.matrix);
  }

  // The cape. Simulation space has world axes and its origin at the runner:
  // turning and leaning swing the cape instead of carrying it. The air is the
  // runner's own speed (the cape's angle grows with it) plus a slow side-to-
  // side drift; the turbulence that sets it flapping strengthens and quickens
  // with speed.
  capeSim(dt) {
    const cl = this.cloth;
    const Q = this.root.quaternion;
    const t = this.time;
    const W = this.speed;
    // pins, skinned to the mantle like the hem they hang from
    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i];
      _v.set(0, 0, 0);
      for (const [id, w] of pin.w) {
        _m.multiplyMatrices(this.bones[id].matrixWorld, this.skeleton.boneInverses[id]);
        _v.addScaledVector(_v2.copy(pin.p).applyMatrix4(_m), w);
      }
      _v.applyQuaternion(Q).toArray(cl.pinB, i * 3);
    }
    // colliders into simulation space
    for (let k = 0; k < this.colliders.length; k++) {
      const d = this.colliders[k];
      const c = cl.colliders[k];
      const M = d.bone.matrixWorld;
      _v.copy(d.a).applyMatrix4(M).applyQuaternion(Q);
      _v2.copy(d.b).applyMatrix4(M).applyQuaternion(Q);
      c.ax = _v.x; c.ay = _v.y; c.az = _v.z;
      c.bx = _v2.x; c.by = _v2.y; c.bz = _v2.z;
      c.cx = (_v.x + _v2.x) / 2; c.cy = (_v.y + _v2.y) / 2; c.cz = (_v.z + _v2.z) / 2;
      const R = _v.distanceTo(_v2) / 2 + Math.max(d.r, d.rz) + 0.02;
      c.R2 = R * R;
      c.r = d.r;
      c.rz = d.rz;
      c.ell = d.rz > 0;
      if (c.ell) {
        _v3.setFromMatrixColumn(M, 0).normalize().applyQuaternion(Q);
        c.ex[0] = _v3.x; c.ex[1] = _v3.y; c.ex[2] = _v3.z;
        _v3.setFromMatrixColumn(M, 2).normalize().applyQuaternion(Q);
        c.ez[0] = _v3.x; c.ez[1] = _v3.y; c.ez[2] = _v3.z;
      }
    }
    // forces: gravity, a share of the runner's own acceleration (the game's
    // gravity is ~3x real, so only part of a jump's reaches the cloth: it
    // floats rather than flags), and the air
    const f = this.wind;
    // (A light, floaty wool: about half the pull of gravity, and soft on the
    // air, so it streams and rolls rather than flags. Never letting the fall
    // of a jump flip the pull upward: the cape floats higher on the way down,
    // but it still hangs.)
    f.gx = -this.frameAcc.x * 0.3;
    f.gy = Math.min(-1.6, -5 - this.frameAcc.y * 0.17);
    f.gz = -this.frameAcc.z * 0.35;
    // The headwind the cape feels grows slower than the run speed: it streams
    // back further as the pace rises, rolling in long, slow waves that start
    // at the shoulders and travel down to the hem; the breeze swings it side
    // to side, and very little damping lets every bounce, lane change and
    // landing carry on through the cloth. It never lifts over the shoulders.
    // (standing still, the breeze is all there is: it gets a stronger hand)
    const B = this.breeze;
    const still = 1 + 1.6 * (1 - Math.min(1, W / 6));
    f.ax = clamp(-this.vx * 0.5, -7, 7) + B.x * (1.4 + 0.03 * W) * still;
    f.ay = clamp(-(this.grounded ? 0 : this.vy) * 0.5, -4, 3) + B.y * still;
    f.az = (W > 0 ? 1.15 * W + 1 : 0) + B.z * still;
    f.turb = 0.7 * still + 0.07 * W;
    f.freq = 0.4 + 0.05 * W;
    f.wave = 0.95 + 0.025 * W;
    f.kn = 0.45;
    f.kt = 0.12;
    f.damp = 0.45;
    f.floor = (this.groundY || 0) - this.y + 0.012;
    f.lift = 0.12;
    f.t = t;
    // Carry the cloth along with most of the body's own bob and sway: the
    // stride bounces the shoulders at several g, which a real mantle's hem
    // would partly soak up — the rest rolls on down the cape as a ripple.
    _v.setFromMatrixPosition(this.b.chest.matrixWorld).applyQuaternion(Q);
    if (this.simReady) cl.shift((_v.x - this.chestPrev.x) * 0.72, (_v.y - this.chestPrev.y) * 0.72, (_v.z - this.chestPrev.z) * 0.72);
    this.chestPrev.copy(_v);
    if (!this.simReady) {
      // start from the rest shape and let it settle under gravity
      cl.place((v) => v.applyQuaternion(Q));
      cl.pinA.set(cl.pinB);
      f.t = t - 0.75;
      for (let i = 0; i < 45; i++) {
        f.t += 1 / 60;
        cl.step(1 / 60, f);
      }
    } else {
      cl.step(dt, f);
    }
    // one bone per particle, oriented to the cloth surface
    const { cols, rows } = CAPE;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const bone = this.capeBones[k];
        bone.position.fromArray(cl.p, k * 3).applyQuaternion(this.invQ);
        Cloth.frame(cl.p, cols, rows, i, j, bone.quaternion).premultiply(this.invQ);
      }
    }
  }
  place(z) {
    this.root.position.set(this.x, this.y, z);
    const h = Math.max(0, this.y - (this.groundY || 0));
    const s = Math.max(0.35, 1 - h * 0.25);
    this.shadow.position.set(this.x, 0.04 + (this.groundY || 0), z + 0.05);
    this.shadow.scale.set(0.95 * s * (this.sliding ? 1.3 : 1), 1, 1.25 * s * (this.sliding ? 1.6 : 1));
    this.shadow.material.uniforms.uAlpha.value = 0.38 * s;
  }
}
