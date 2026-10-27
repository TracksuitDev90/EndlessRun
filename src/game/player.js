import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { P, part } from '../render/geo.js';
import { makeEnvUniforms, makeToonMaterial, makeInkMaterial } from '../render/shaders.js';

// The runner: a boy in a bright orange coat. He is one continuous skinned
// mesh (plus its ink hull) on a ~60-bone skeleton, so sleeves and trouser legs
// bend smoothly at elbows, wrists, knees and ankles. On top of the keyframed
// run / jump / slide / idle poses sits a layer of secondary motion:
//   - springs give the head, torso, wrists and hair lag and overshoot;
//   - the coat skirt is eight hinged panels that flare in the wind, lift when
//     falling and get pushed aside by the legs;
//   - the scarf tails are verlet chains streaming in the air flow;
//   - the satchel is a pendulum that bumps against his hip, lid flapping.
// Also owns lane / jump / slide movement.

const COL = {
  coat: '#ff7a1c',
  coatDark: '#d9531a',
  coatLight: '#ff9a3c',
  lining: '#f2b93b',
  belt: '#4a2a18',
  brass: '#f2c84b',
  skin: '#f3c4a0',
  blush: '#f0a088',
  hair: '#3b2417',
  pants: '#2b3558',
  pantsDark: '#202846',
  sock: '#f2e8d4',
  shoe: '#7a3a22',
  shoeDark: '#5a2814',
  sole: '#f2e8d4',
  scarf: '#1d7090',
  scarfDark: '#145a76',
  stripe: '#5fb6c8',
  stripe2: '#f6ecd4',
  strap: '#6b3f1f',
  bag: '#9a6232',
  bagDark: '#6b3f1f',
};

// --- bind-pose proportions (meters, root space; the boy faces -z) ------------
const HIP_Y = 0.79;
const SHOULDER = { x: 0.165, y: 1.15 };
const UPPER_ARM = 0.23;
const FOREARM = 0.2;
const HIP_JOINT = { x: 0.092, y: 0.755 };
const THIGH = 0.35;
const SHIN = 0.33;
const SKIRT_TOP = 0.878;
const SKIRT_PANELS = 8;
const SKIRT_HINGE_R = 0.156;
const SKIRT_EZ = 0.84; // the coat is an ellipse, narrower front to back
const SCARF_A = { anchor: [-0.062, 1.19, 0.118], n: 10, seg: 0.064, w: 0.1, drift: -2.6 };
const SCARF_B = { anchor: [-0.022, 1.19, 0.122], n: 7, seg: 0.058, w: 0.084, drift: -1.2 };
const BAG_PIVOT = [0.15, 0.905, 0.128];

// --- pose channels -----------------------------------------------------------
// Lateral channels (z / twist) for limbs are stored as per-side magnitudes
// (positive = outward) and get the side's sign when applied.
const NAMES = [
  'hipY', 'hipX', 'hipYaw', 'hipRoll', 'hipPitch',
  'spLean', 'spTwist', 'spSide', 'chLean', 'chTwist', 'chSide',
  'hdPitch', 'hdYaw', 'hdRoll',
  'clL', 'clR', 'shLx', 'shRx', 'shLy', 'shRy', 'shLz', 'shRz', 'elL', 'elR', 'wrL', 'wrR', 'wrLz', 'wrRz',
  'thLx', 'thRx', 'thLz', 'thRz', 'knL', 'knR', 'anL', 'anR', 'toL', 'toR',
  'bodyPitch', 'bodyZ', 'bodyRoll', 'sq',
];
const C = {};
NAMES.forEach((n, i) => (C[n] = i));
const N = NAMES.length;
const PAIRS = [
  ['clL', 'clR'], ['shLx', 'shRx'], ['shLy', 'shRy'], ['shLz', 'shRz'], ['elL', 'elR'], ['wrL', 'wrR'], ['wrLz', 'wrRz'],
  ['thLx', 'thRx'], ['thLz', 'thRz'], ['knL', 'knR'], ['anL', 'anR'], ['toL', 'toR'],
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

// Run cycle keys, 8 per stride (phase 0 = thigh passing vertical going forward,
// pi/2 = thigh fully forward, pi = mid-stance, 3pi/2 = toe-off).
const LEG = {
  thigh: [0.38, 0.86, 0.92, 0.55, 0.08, -0.36, -0.66, -0.3],
  knee: [1.95, 1.25, 0.42, 0.3, 0.48, 0.4, 0.3, 1.25],
  ankle: [0.36, 0.3, 0.12, 0.0, 0.12, -0.1, -0.55, -0.16],
  toe: [0.0, 0.0, 0.0, 0.0, 0.04, 0.3, 0.55, 0.15],
};
// Arms swing with the opposite leg's phase.
const ARM = {
  swing: [0.24, 0.72, 0.84, 0.5, -0.12, -0.6, -0.72, -0.42],
  abd: [0.2, 0.13, 0.12, 0.16, 0.22, 0.28, 0.3, 0.26],
  elbow: [1.25, 1.5, 1.62, 1.45, 1.15, 0.92, 0.88, 1.0],
};

const G = (8 * CONFIG.jump.height) / (CONFIG.jump.time * CONFIG.jump.time);
const V0 = (4 * CONFIG.jump.height) / CONFIG.jump.time;
const TAU = Math.PI * 2;

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

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

// Damped spring follower (implicit Euler, stable at any frame time). Low zeta
// = bouncy overshoot; it is what makes limbs feel loose rather than driven.
class Spring {
  constructor(x = 0) {
    this.x = x;
    this.v = 0;
  }
  step(target, freq, zeta, dt) {
    const w = TAU * freq;
    this.v = (this.v + dt * w * w * (target - this.x)) / (1 + 2 * zeta * w * dt + w * w * dt * dt);
    this.x += this.v * dt;
    return this.x;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
  }
}

// --- skinned geometry helpers --------------------------------------------------
const SKIN_ATTRS = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['fx', 3], ['onrm', 3], ['skinIndex', 4], ['skinWeight', 4]];

// Attach bone weights to a finished part. fn(x, y, z, out) pushes
// [bone, weight] pairs (up to four) for a bind-pose vertex position.
function skin(geo, fn) {
  const pos = geo.attributes.position.array;
  const n = pos.length / 3;
  const si = new Float32Array(n * 4);
  const sw = new Float32Array(n * 4);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.length = 0;
    fn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], out);
    let total = 0;
    for (let k = 1; k < out.length && k < 8; k += 2) total += out[k];
    for (let k = 0, j = 0; k < out.length && j < 4; k += 2, j++) {
      si[i * 4 + j] = out[k];
      sw[i * 4 + j] = out[k + 1] / (total || 1);
    }
  }
  geo.setAttribute('skinIndex', new THREE.Float32BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

function mergeSkinned(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of SKIN_ATTRS) {
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of list) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of list) g.dispose();
  return out;
}

// Turn a part inside out (for coat linings): reverse winding, flip normals.
function insideOut(g) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    const s = a.itemSize;
    const arr = a.array;
    for (let t = 0; t < arr.length; t += s * 3) {
      for (let k = 0; k < s; k++) {
        const tmp = arr[t + s + k];
        arr[t + s + k] = arr[t + s * 2 + k];
        arr[t + s * 2 + k] = tmp;
      }
    }
  }
  const nrm = g.attributes.normal.array;
  for (let i = 0; i < nrm.length; i++) nrm[i] = -nrm[i];
  return g;
}

const rigid = (b) => (x, y, z, out) => out.push(b, 1);
const mix2 = (a, wa, b) => (x, y, z, out) => out.push(a, wa, b, 1 - wa);
// Blend between bones along one coordinate through sorted control points.
function along(coord, ctrl) {
  return (x, y, z, out) => {
    const t = coord(x, y, z);
    if (t <= ctrl[0][0]) return out.push(ctrl[0][1], 1);
    for (let i = 0; i < ctrl.length - 1; i++) {
      const [t0, b0] = ctrl[i];
      const [t1, b1] = ctrl[i + 1];
      if (t <= t1) {
        if (b0 === b1) return out.push(b0, 1);
        const u = smooth(t0, t1, t);
        return out.push(b0, 1 - u, b1, u);
      }
    }
    return out.push(ctrl[ctrl.length - 1][1], 1);
  };
}
const Y = (x, y) => y;
const Z = (x, y, z) => z;

// A flat strap following a path of points over a surface. outward(p) gives
// the surface normal direction at a point.
function strapParts(pts, width, thick, color, outward) {
  const parts = [];
  const m = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  for (let i = 0; i < pts.length - 1; i++) {
    a.fromArray(pts[i]);
    b.fromArray(pts[i + 1]);
    yAxis.subVectors(b, a);
    const len = yAxis.length();
    yAxis.normalize();
    zAxis.fromArray(outward(a.clone().add(b).multiplyScalar(0.5)));
    zAxis.addScaledVector(yAxis, -zAxis.dot(yAxis)).normalize();
    xAxis.crossVectors(yAxis, zAxis);
    const g = P.box(width, len + 0.012, thick);
    m.makeBasis(xAxis, yAxis, zAxis);
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    parts.push(part(g, color, { outline: 0.7 }));
  }
  return parts;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(envDef) {
    this.u = makeEnvUniforms(envDef);
    this.mat = makeToonMaterial(this.u, { skinned: true });
    this.inkMat = makeInkMaterial(this.mat, 0.028);
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
    this.springs = {};
    for (const k of ['hdPitch', 'hdYaw', 'hdRoll', 'spLean', 'chTwist', 'elL', 'elR', 'swL', 'swR', 'abL', 'abR', 'lane', 'land']) {
      this.springs[k] = new Spring();
    }
    this.hair = [0, 1, 2].map(() => ({ x: new Spring(), z: new Spring() }));
    this.skirt = Array.from({ length: SKIRT_PANELS }, () => new Spring(0.06));
    this.lid = new Spring();
    this.reset();
  }

  // --- skeleton -----------------------------------------------------------------
  buildSkeleton() {
    const bones = [];
    const ids = {};
    this.b = {};
    const bone = (name, parent, x, y, z) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      if (parent) parent.add(b);
      ids[name] = bones.length;
      bones.push(b);
      this.b[name] = b;
      return b;
    };
    const body = bone('body', null, 0, 0, 0);
    const hips = bone('hips', body, 0, HIP_Y, 0);
    const spine = bone('spine', hips, 0, 0.07, 0);
    const chest = bone('chest', spine, 0, 0.17, 0);
    const neck = bone('neck', chest, 0, 0.17, 0);
    const head = bone('head', neck, 0, 0.06, 0);
    bone('hair0', head, 0, 0.285, 0.04);
    bone('hair1', head, -0.075, 0.21, 0.12);
    bone('hair2', head, 0.08, 0.23, 0.115);
    for (const [s, L] of [[-1, 'L'], [1, 'R']]) {
      const clav = bone('clav' + L, chest, s * 0.05, 0.12, 0);
      const arm = bone('arm' + L, clav, s * (SHOULDER.x - 0.05), 0, 0);
      const fore = bone('fore' + L, arm, 0, -UPPER_ARM, 0);
      bone('hand' + L, fore, 0, -FOREARM, 0);
      const thigh = bone('thigh' + L, hips, s * HIP_JOINT.x, HIP_JOINT.y - HIP_Y, 0);
      const shin = bone('shin' + L, thigh, 0, -THIGH, 0);
      const foot = bone('foot' + L, shin, 0, -SHIN, 0);
      bone('toe' + L, foot, 0, -0.05, -0.085);
    }
    this.panelAngle = [];
    for (let k = 0; k < SKIRT_PANELS; k++) {
      const th = (k / SKIRT_PANELS) * TAU;
      this.panelAngle.push(th);
      const u = bone('skU' + k, hips, Math.sin(th) * SKIRT_HINGE_R, SKIRT_TOP - HIP_Y, Math.cos(th) * SKIRT_HINGE_R * SKIRT_EZ);
      u.rotation.order = 'YXZ';
      u.rotation.y = th;
      bone('skL' + k, u, 0, -0.17, 0.03);
    }
    // Simulated bones live directly in root space.
    const sim = bone('sim', null, 0, 0, 0);
    for (const [tag, spec] of [['scA', SCARF_A], ['scB', SCARF_B]]) {
      for (let i = 0; i < spec.n; i++) bone(tag + i, sim, spec.anchor[0], spec.anchor[1] - i * spec.seg, spec.anchor[2]);
    }
    const bag = bone('bag', sim, BAG_PIVOT[0], BAG_PIVOT[1], BAG_PIVOT[2]);
    bone('bagLid', bag, 0.02, -0.055, 0.044);

    this.ids = ids;
    this.bones = bones;
    this.body = body;
    this.root.add(body, sim);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.bindPos = {};
    for (const b of bones) this.bindPos[b.name] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  }

  // --- the model ------------------------------------------------------------------
  buildBody() {
    const I = this.ids;
    const g = [];
    const add = (geo, fn) => g.push(skin(geo, fn));

    // coat body
    add(part(P.lathe([[0.148, 0.8], [0.15, 0.86], [0.158, 0.94], [0.168, 1.02], [0.166, 1.09], [0.15, 1.145], [0.12, 1.18], [0.075, 1.205], [0, 1.212]], 18), null, {
      sz: 0.8, grad: [COL.coatDark, COL.coatLight, 0.82, 1.2],
    }), along(Y, [[0.84, I.hips], [0.9, I.spine], [0.98, I.spine], [1.08, I.chest]]));
    // back seam and folded hood
    add(part(P.box(0.014, 0.25, 0.012), COL.coatDark, { y: 1.0, z: 0.13, outline: 0 }), along(Y, [[0.9, I.spine], [1.06, I.chest]]));
    add(part(P.sphere(0.1, 12, 8), null, { y: 1.16, z: 0.095, sx: 1.25, sy: 0.5, sz: 0.55, grad: [COL.coatDark, COL.coat, 1.12, 1.2] }), rigid(I.chest));
    // belt with a back tab and brass buttons
    add(part(P.cyl(0.158, 0.158, 0.05, 18), COL.belt, { y: 0.868, sz: 0.83, outline: 0.6 }), mix2(I.hips, 0.5, I.spine));
    add(part(P.box(0.11, 0.042, 0.02), COL.coat, { y: 0.868, z: 0.133 }), mix2(I.hips, 0.5, I.spine));
    for (const x of [-0.034, 0.034]) add(part(P.sphere(0.013, 6, 4), COL.brass, { x, y: 0.868, z: 0.146, outline: 0.5 }), mix2(I.hips, 0.5, I.spine));

    // coat skirt: hinged panels, mustard lining inside, darker hem
    const skirtW = (x, y, z, out) => {
      let th = Math.atan2(x, z / SKIRT_EZ);
      if (th < 0) th += TAU;
      const u = (th / TAU) * SKIRT_PANELS;
      const k = Math.floor(u) % SKIRT_PANELS;
      const f = u - Math.floor(u);
      const k1 = (k + 1) % SKIRT_PANELS;
      const gl = smooth(0.13, 0.21, SKIRT_TOP - y);
      out.push(I['skU' + k], (1 - f) * (1 - gl), I['skU' + k1], f * (1 - gl), I['skL' + k], (1 - f) * gl, I['skL' + k1], f * gl);
    };
    add(part(P.lathe([[0.222, 0.535], [0.205, 0.6], [0.183, 0.7], [0.164, 0.8], [0.156, SKIRT_TOP]], 24), null, {
      sz: SKIRT_EZ, grad: [COL.coatDark, COL.coat, 0.54, 0.86],
    }), skirtW);
    add(part(P.lathe([[0.226, 0.533], [0.222, 0.565]], 24), COL.coatDark, { sz: SKIRT_EZ, outline: 0.5 }), skirtW);
    add(insideOut(part(P.lathe([[0.214, 0.54], [0.198, 0.6], [0.177, 0.7], [0.158, 0.8], [0.15, SKIRT_TOP]], 24), COL.lining, { sz: SKIRT_EZ, outline: 0 })), skirtW);

    // scarf: the wrap, the knot, and two tails on simulated chains
    add(part(P.torus(0.088, 0.037, 8, 18), COL.scarf, { y: 1.213, rx: Math.PI / 2, sz: 0.92 }), mix2(I.neck, 0.45, I.chest));
    add(part(P.sphere(0.044, 8, 6), COL.scarfDark, { x: -0.05, y: 1.2, z: 0.102 }), rigid(I.chest));
    for (const [tag, spec] of [['scA', SCARF_A], ['scB', SCARF_B]]) {
      const [ax, ay, az] = spec.anchor;
      const L = spec.n * spec.seg;
      const ids = Array.from({ length: spec.n }, (_, i) => I[tag + i]);
      const chain = (x, y, z, out) => {
        const s = clamp((ay - y) / spec.seg, 0, spec.n - 1e-4);
        const i = Math.floor(s);
        const f = s - i;
        if (f < 0.5 && i > 0) out.push(ids[i], 0.5 + f, ids[i - 1], 0.5 - f);
        else if (f >= 0.5 && i < spec.n - 1) out.push(ids[i], 1.5 - f, ids[i + 1], f - 0.5);
        else out.push(ids[i], 1);
      };
      add(part(P.box(spec.w, L, 0.022, 1, spec.n * 3, 1), null, { x: ax, y: ay - L / 2, z: az, grad: [COL.scarf, COL.scarfDark, ay - L, ay] }), chain);
      for (const [f, c] of [[0.6, COL.stripe], [0.7, COL.stripe2], [0.8, COL.stripe]]) {
        add(part(P.box(spec.w + 0.006, L * 0.055, 0.027), c, { x: ax, y: ay - L * f, z: az, outline: 0 }), chain);
      }
      for (let k = 0; k < 5; k++) {
        const fx = ax - spec.w * 0.4 + (spec.w * 0.8 * k) / 4;
        add(part(P.box(0.008, 0.045 + (k % 2) * 0.012, 0.01), k % 2 ? COL.stripe : COL.scarf, { x: fx, y: ay - L - 0.02, z: az, outline: 0 }), chain);
      }
    }

    // head
    add(part(P.cyl(0.046, 0.05, 0.11, 10), COL.skin, { y: 1.235 }), rigid(I.neck));
    add(part(P.sphere(0.145, 16, 12), COL.skin, { y: 1.405, z: -0.008 }), rigid(I.head));
    for (const s of [-1, 1]) {
      add(part(P.sphere(0.034, 8, 6), COL.skin, { x: s * 0.143, y: 1.39, z: 0.005, sx: 0.55 }), rigid(I.head));
      add(part(P.sphere(0.03, 8, 6), COL.blush, { x: s * 0.085, y: 1.37, z: -0.122, sz: 0.4, outline: 0 }), rigid(I.head));
    }
    add(part(P.sphere(0.022, 8, 6), COL.skin, { y: 1.39, z: -0.152 }), rigid(I.head));
    add(part(P.sphere(0.153, 16, 12), COL.hair, { y: 1.428, z: 0.02, sy: 0.96 }), rigid(I.head));
    for (const [x, y, z] of [[-0.06, 1.5, -0.1], [0.015, 1.515, -0.112], [0.075, 1.49, -0.092]]) {
      add(part(P.sphere(0.052, 8, 6), COL.hair, { x, y, z }), rigid(I.head));
    }
    // hair tufts on springs
    const tuft = (name, r, h, rx, rz) => {
      const geo = P.cone(r, h, 7);
      geo.translate(0, h / 2, 0);
      const p = this.bindPos[name];
      add(part(geo, COL.hair, { x: p.x, y: p.y, z: p.z, rx, rz }), rigid(I[name]));
    };
    tuft('hair0', 0.05, 0.14, 0.95, 0);
    tuft('hair1', 0.042, 0.12, 1.1, 0.55);
    tuft('hair2', 0.044, 0.12, 1.15, -0.5);

    // arms: one continuous sleeve from shoulder to cuff, bending at the elbow
    for (const [s, L] of [[-1, 'L'], [1, 'R']]) {
      const sx = s * SHOULDER.x;
      const sy = SHOULDER.y;
      const arm = I['arm' + L];
      const fore = I['fore' + L];
      const hand = I['hand' + L];
      add(part(P.lathe([[0, -0.425], [0.054, -0.425], [0.058, -0.405], [0.051, -0.37], [0.049, -0.3], [0.051, -0.24], [0.054, -0.17], [0.058, -0.09], [0.06, -0.02], [0.052, 0.03], [0.034, 0.056], [0, 0.064]], 12), null, {
        x: sx, y: sy, grad: [COL.coatDark, COL.coat, sy - 0.43, sy],
      }), along(Y, [[sy - 0.29, fore], [sy - 0.17, arm]]));
      add(part(P.cyl(0.061, 0.061, 0.045, 12), COL.coatDark, { x: sx, y: sy - 0.405 }), rigid(fore));
      add(part(P.sphere(0.047, 10, 8), COL.skin, { x: sx + s * 0.004, y: sy - 0.475, sx: 0.8, sy: 1.12 }), rigid(hand));
      add(part(P.sphere(0.021, 8, 6), COL.skin, { x: sx - s * 0.022, y: sy - 0.46, z: -0.03 }), rigid(hand));
    }

    // legs: trousers bend at the knee; chunky sneakers with a hinged toe
    for (const [s, L] of [[-1, 'L'], [1, 'R']]) {
      const hx = s * HIP_JOINT.x;
      const hy = HIP_JOINT.y;
      const thigh = I['thigh' + L];
      const shin = I['shin' + L];
      const foot = I['foot' + L];
      const toe = I['toe' + L];
      add(part(P.lathe([[0, -0.668], [0.054, -0.668], [0.058, -0.645], [0.052, -0.6], [0.049, -0.5], [0.055, -0.42], [0.062, -0.35], [0.069, -0.26], [0.076, -0.14], [0.079, -0.04], [0.072, 0.02], [0.045, 0.055], [0, 0.062]], 12), null, {
        x: hx, y: hy, grad: [COL.pantsDark, COL.pants, hy - 0.68, hy],
      }), along(Y, [[hy - 0.43, shin], [hy - 0.27, thigh]]));
      add(part(P.cyl(0.059, 0.059, 0.03, 12), COL.pantsDark, { x: hx, y: hy - 0.652, outline: 0.6 }), rigid(shin));
      add(part(P.cyl(0.044, 0.046, 0.07, 10), COL.sock, { x: hx, y: 0.105 }), mix2(foot, 0.6, shin));
      add(part(P.sphere(1, 12, 8), COL.shoe, { x: hx, y: 0.058, z: -0.03, sx: 0.068, sy: 0.056, sz: 0.118 }), rigid(foot));
      add(part(P.sphere(1, 10, 6), COL.shoeDark, { x: hx, y: 0.062, z: 0.052, sx: 0.06, sy: 0.05, sz: 0.045 }), rigid(foot));
      add(part(P.cyl(1, 1, 0.026, 16), COL.sole, { x: hx, y: 0.013, z: -0.035, sx: 0.073, sz: 0.128 }), along(Z, [[-0.11, toe], [-0.05, foot]]));
      add(part(P.sphere(1, 10, 8), COL.shoe, { x: hx, y: 0.042, z: -0.11, sx: 0.062, sy: 0.045, sz: 0.06 }), rigid(toe));
      add(part(P.box(0.05, 0.012, 0.016), COL.sole, { x: hx, y: 0.107, z: -0.035, outline: 0 }), rigid(foot));
      add(part(P.box(0.046, 0.012, 0.016), COL.sole, { x: hx, y: 0.098, z: -0.065, outline: 0 }), rigid(foot));
    }

    // satchel strap across the back, and the swinging satchel itself
    const strapPts = [[-0.12, 1.2, -0.03], [-0.115, 1.19, 0.06], [-0.085, 1.14, 0.12], [-0.03, 1.07, 0.138], [0.03, 1.0, 0.14], [0.09, 0.945, 0.137], [BAG_PIVOT[0], BAG_PIVOT[1], BAG_PIVOT[2]]];
    for (const geo of strapParts(strapPts, 0.036, 0.012, COL.strap, (p) => [p.x, 0.15, p.z / 0.64])) {
      add(geo, along(Y, [[0.93, I.hips], [0.99, I.spine], [1.06, I.chest]]));
    }
    const [px, py, pz] = BAG_PIVOT;
    add(part(P.box(0.03, 0.065, 0.012), COL.strap, { x: px + 0.01, y: py - 0.03, z: pz + 0.004 }), rigid(I.bag));
    add(part(P.box(0.2, 0.13, 0.075), COL.bag, { x: px + 0.02, y: py - 0.12, z: pz }), rigid(I.bag));
    add(part(P.cyl(0.0375, 0.0375, 0.2, 10), COL.bag, { x: px + 0.02, y: py - 0.185, z: pz, rz: Math.PI / 2 }), rigid(I.bag));
    const lid = this.bindPos.bagLid;
    add(part(P.box(0.208, 0.092, 0.014), COL.bagDark, { x: lid.x, y: lid.y - 0.044, z: lid.z }), rigid(I.bagLid));
    add(part(P.box(0.04, 0.03, 0.012), COL.brass, { x: lid.x, y: lid.y - 0.08, z: lid.z + 0.01, outline: 0.5 }), rigid(I.bagLid));

    const geo = mergeSkinned(g);
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
    const chest = this.bindPos.chest;
    this.tails = [SCARF_A, SCARF_B].map((spec, t) => ({
      spec,
      bones: Array.from({ length: spec.n }, (_, i) => this.b[(t ? 'scB' : 'scA') + i]),
      local: new THREE.Vector3(spec.anchor[0], spec.anchor[1], spec.anchor[2]).sub(chest),
      pts: new Float32Array((spec.n + 1) * 3),
      prv: new Float32Array((spec.n + 1) * 3),
      phase: t * 2.1,
    }));
    this.bagSim = {
      local: new THREE.Vector3(...BAG_PIVOT).sub(this.bindPos.hips),
      len: 0.12,
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
    this.spheres = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
    this.hipsInv = new THREE.Matrix4();
  }

  resetSim() {
    for (const t of this.tails) {
      const { anchor, n, seg } = t.spec;
      for (let i = 0; i <= n; i++) {
        t.pts[i * 3] = t.prv[i * 3] = anchor[0];
        t.pts[i * 3 + 1] = t.prv[i * 3 + 1] = anchor[1] - i * seg;
        t.pts[i * 3 + 2] = t.prv[i * 3 + 2] = anchor[2] + i * 0.01;
      }
    }
    const bs = this.bagSim;
    bs.p.set(BAG_PIVOT[0] + 0.02, BAG_PIVOT[1] - bs.len, BAG_PIVOT[2]);
    bs.q.copy(bs.p);
    bs.vy = 0;
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
    for (const h of this.hair) {
      h.x.reset();
      h.z.reset();
    }
    for (const s of this.skirt) s.reset(0.06);
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
    this.phase += dt * TAU * freq;
    const f = this.phase;
    const t = this.time;

    // target weights
    let tRun = 0, tJump = 0, tSlide = 0, tIdle = 0;
    if (this.mode !== 'run') tIdle = 1;
    else if (!this.grounded) tJump = 1;
    else if (this.sliding) tSlide = 1;
    else tRun = 1;
    const k = 14;
    this.w.run = damp(this.w.run, tRun, k, dt);
    this.w.jump = damp(this.w.jump, tJump, k * 1.1, dt);
    this.w.slide = damp(this.w.slide, tSlide, k * 1.3, dt);
    this.w.idle = damp(this.w.idle, tIdle, 4, dt);

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
    const land = this.springs.land.step(this.landT * this.landT, 7, 0.45, dt);
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

    // --- follow-through springs ---------------------------------------------------
    const S = this.springs;
    Pz[C.spLean] = S.spLean.step(Pz[C.spLean], 6, 0.5, dt);
    Pz[C.chTwist] = S.chTwist.step(Pz[C.chTwist], 5, 0.45, dt);
    Pz[C.hdPitch] = S.hdPitch.step(Pz[C.hdPitch], 4.5, 0.42, dt);
    Pz[C.hdYaw] = S.hdYaw.step(Pz[C.hdYaw], 4, 0.5, dt);
    Pz[C.hdRoll] = S.hdRoll.step(Pz[C.hdRoll], 4, 0.4, dt);
    // elbows trail the shoulders a touch; wrists flop behind the whole arm
    Pz[C.elL] = S.elL.step(Pz[C.elL], 7, 0.5, dt);
    Pz[C.elR] = S.elR.step(Pz[C.elR], 7, 0.5, dt);
    const armL = Pz[C.shLx] + Pz[C.elL];
    const armR = Pz[C.shRx] + Pz[C.elR];
    Pz[C.wrL] += 0.45 * (S.swL.step(armL, 3.2, 0.5, dt) - armL);
    Pz[C.wrR] += 0.45 * (S.swR.step(armR, 3.2, 0.5, dt) - armR);
    Pz[C.wrLz] += 0.6 * (S.abL.step(Pz[C.shLz], 3, 0.45, dt) - Pz[C.shLz]);
    Pz[C.wrRz] += 0.6 * (S.abR.step(Pz[C.shRz], 3, 0.45, dt) - Pz[C.shRz]);

    this.applyPose(Pz, roll);

    // lean into lane changes
    const lean = clamp(-this.vx * 0.035, -0.4, 0.4);
    this.root.rotation.z = damp(this.root.rotation.z, this.crashed ? 0 : lean, 12, dt);
    this.root.rotation.y = damp(this.root.rotation.y, this.crashed ? 0 : clamp(-this.vx * 0.025, -0.35, 0.35), 12, dt);

    this.secondary(dt, sp);

    // invulnerability blink
    this.root.visible = this.invulnT > 0 && !this.crashed ? Math.floor(this.invulnT * 12) % 2 === 0 : true;
  }

  poseRun(r, f, sp) {
    const s = Math.sin(f);
    // slow wander so no two strides are quite the same
    const wander = 0.5 * Math.sin(f * 0.31 + 1.3) + 0.5 * Math.sin(f * 0.19);
    const legAmp = 0.86 + 0.22 * sp;
    const armAmp = (0.88 + 0.22 * sp) * (1 + 0.08 * wander);
    const bob = 0.5 - 0.5 * Math.cos(2 * f - 0.55);
    r[C.hipY] = HIP_Y - 0.05 + 0.06 * bob * (0.85 + 0.3 * sp);
    r[C.hipX] = 0.012 * Math.sin(f - 1.2);
    r[C.hipYaw] = -0.2 * s;
    r[C.hipRoll] = 0.055 * Math.cos(f + 0.3);
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
    for (const [ph, th, kn, an, to, sh, sy, sz, el, cl, wr, wz, tz] of [
      [f, C.thLx, C.knL, C.anL, C.toL, C.shLx, C.shLy, C.shLz, C.elL, C.clL, C.wrL, C.wrLz, C.thLz],
      [f + Math.PI, C.thRx, C.knR, C.anR, C.toR, C.shRx, C.shRy, C.shRz, C.elR, C.clR, C.wrR, C.wrRz, C.thRz],
    ]) {
      r[th] = cyc(LEG.thigh, ph) * legAmp + 0.04;
      r[kn] = cyc(LEG.knee, ph) * (0.9 + 0.15 * sp);
      r[an] = cyc(LEG.ankle, ph);
      r[to] = cyc(LEG.toe, ph);
      r[tz] = 0.035;
      const q = ph + Math.PI; // arm follows the opposite leg
      r[sh] = cyc(ARM.swing, q) * armAmp + 0.06;
      r[sz] = cyc(ARM.abd, q) + 0.04;
      r[sy] = 0.1 * Math.sin(q);
      r[el] = cyc(ARM.elbow, q - 0.25);
      r[cl] = 0.05 * Math.max(0, r[sh]);
      r[wr] = 0.18;
      r[wz] = 0.05;
    }
    r[C.bodyPitch] = 0;
    r[C.bodyZ] = 0;
    r[C.bodyRoll] = 0;
    r[C.sq] = 1 + 0.025 * (bob - 0.5);
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
    j[C.shLz] = m(0.6, 1.05);
    j[C.shLy] = 0;
    j[C.elL] = m(0.55, 0.45);
    j[C.shRx] = m(1.55, 0.25);
    j[C.shRz] = m(0.28, 1.1);
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

  // Title screen: breathing, shifting weight, looking around.
  poseIdle(id, t) {
    const br = Math.sin(t * 2.0);
    const ws = Math.sin(t * 0.6);
    id[C.hipY] = HIP_Y - 0.012 + br * 0.004 - Math.abs(ws) * 0.006;
    id[C.hipX] = ws * 0.02;
    id[C.hipYaw] = 0.06 * Math.sin(t * 0.37);
    id[C.hipRoll] = ws * 0.045;
    id[C.hipPitch] = 0.02;
    id[C.spLean] = 0.03 + br * 0.012;
    id[C.spTwist] = Math.sin(t * 0.5) * 0.05;
    id[C.spSide] = -ws * 0.035;
    id[C.chLean] = 0.0;
    id[C.chTwist] = Math.sin(t * 0.43 + 1) * 0.04;
    id[C.chSide] = 0;
    id[C.hdPitch] = 0.04 + Math.sin(t * 0.7) * 0.05;
    id[C.hdYaw] = Math.sin(t * 0.43) * 0.4;
    id[C.hdRoll] = -ws * 0.04;
    id[C.thLx] = 0.03;
    id[C.thRx] = -0.02;
    id[C.thLz] = 0.04 + ws * 0.03;
    id[C.thRz] = 0.04 - ws * 0.03;
    id[C.knL] = 0.06 + Math.max(0, -ws) * 0.14;
    id[C.knR] = 0.06 + Math.max(0, ws) * 0.14;
    id[C.anL] = id[C.knL] - id[C.thLx];
    id[C.anR] = id[C.knR] - id[C.thRx];
    id[C.toL] = 0;
    id[C.toR] = 0;
    id[C.shLx] = 0.06;
    id[C.shRx] = 0.02;
    id[C.shLy] = 0;
    id[C.shRy] = 0;
    id[C.shLz] = 0.14;
    id[C.shRz] = 0.14;
    id[C.elL] = 0.3 + br * 0.03;
    id[C.elR] = 0.24;
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
    b.thighL.rotation.set(Pz[C.thLx], 0, -Pz[C.thLz]);
    b.thighR.rotation.set(Pz[C.thRx], 0, Pz[C.thRz]);
    b.shinL.rotation.x = -Pz[C.knL];
    b.shinR.rotation.x = -Pz[C.knR];
    b.footL.rotation.x = Pz[C.anL];
    b.footR.rotation.x = Pz[C.anR];
    b.toeL.rotation.x = Pz[C.toL];
    b.toeR.rotation.x = Pz[C.toR];
  }

  // --- secondary motion: scarf, coat, satchel, hair ------------------------------
  secondary(dt, sp) {
    if (dt <= 0) return;
    const b = this.b;
    const t = this.time;
    // Bone transforms in root space (the renderer recomputes true world
    // matrices later in the frame).
    this.root.matrixWorld.identity();
    this.body.updateWorldMatrix(false, true);

    // Motion of the root through the world -> inertial acceleration, and the
    // air streaming past (plus a gusty breeze so he's never quite still).
    const vel = _v.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
    const acc = _v2.subVectors(vel, this.frameVel).divideScalar(Math.max(dt, 1 / 240));
    this.frameVel.copy(vel);
    acc.clampLength(0, 60);
    this.frameAcc.lerp(acc, 1 - Math.exp(-dt * 30));
    this.invQ.copy(this.root.quaternion).invert();
    this.gravity.set(0, -9.8, 0).applyQuaternion(this.invQ);
    const gust = 0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 1.9 + 1);
    this.air.set(-vel.x + 0.5 * Math.sin(t * 0.37) * gust, -vel.y + 0.15 * gust, -vel.z + 0.7 * gust).applyQuaternion(this.invQ);
    this.accLocal.copy(this.frameAcc).applyQuaternion(this.invQ);
    const airSpeed = this.air.length();

    // collision spheres: chest, hips (coat skirt), head
    const [sc, sh, sd] = this.spheres;
    _v.set(0, 0.03, 0.0).applyMatrix4(b.chest.matrixWorld);
    sc.set(_v.x, _v.y, _v.z, 0.165);
    _v.set(0, -0.06, 0.0).applyMatrix4(b.hips.matrixWorld);
    sh.set(_v.x, _v.y, _v.z, 0.215);
    _v.set(0, 0.15, 0.0).applyMatrix4(b.head.matrixWorld);
    sd.set(_v.x, _v.y, _v.z, 0.165);
    const floor = (this.groundY || 0) - this.y + 0.015;

    // fixed sub-steps keep the chains stable at any frame rate
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120))));
    const h = dt / steps;
    for (const tail of this.tails) {
      this.anchor.copy(tail.local).applyMatrix4(b.chest.matrixWorld);
      const { n, seg } = tail.spec;
      const pts = tail.pts;
      const prv = tail.prv;
      if (!this.simReady) {
        for (let i = 0; i <= n; i++) {
          pts[i * 3] = prv[i * 3] = this.anchor.x;
          pts[i * 3 + 1] = prv[i * 3 + 1] = this.anchor.y - i * seg;
          pts[i * 3 + 2] = prv[i * 3 + 2] = this.anchor.z + i * 0.02;
        }
      }
      for (let st = 0; st < steps; st++) {
        pts[0] = prv[0] = this.anchor.x;
        pts[1] = prv[1] = this.anchor.y;
        pts[2] = prv[2] = this.anchor.z;
        for (let i = 1; i <= n; i++) {
          const o = i * 3;
          const px = pts[o], py = pts[o + 1], pz = pts[o + 2];
          const vx = (px - prv[o]) / h, vy = (py - prv[o + 1]) / h, vz = (pz - prv[o + 2]) / h;
          const tip = i / n;
          const drag = 0.85;
          const flap = Math.min(airSpeed, 26) * 0.8 * tip;
          const drift = tail.spec.drift * Math.min(1, airSpeed / 10);
          let ax = this.gravity.x + drag * (this.air.x + drift - vx) - this.accLocal.x * 0.55;
          // (the game's gravity is ~3x real, so only part of the jump's
          // vertical acceleration reaches the cloth: it floats, not flags)
          let ay = this.gravity.y + drag * (this.air.y - vy) - this.accLocal.y * 0.3;
          let az = this.gravity.z + drag * (this.air.z - vz) - this.accLocal.z * 0.55;
          // a travelling wave from knot to tip
          ax += Math.sin(t * 12 - i * 1.1 + tail.phase) * flap;
          ay += Math.cos(t * 9.5 - i * 0.9 + tail.phase) * flap * 0.7;
          prv[o] = px;
          prv[o + 1] = py;
          prv[o + 2] = pz;
          pts[o] = px + vx * h * 0.995 + ax * h * h;
          pts[o + 1] = py + vy * h * 0.995 + ay * h * h;
          pts[o + 2] = pz + vz * h * 0.995 + az * h * h;
        }
        for (let it = 0; it < 3; it++) {
          for (let i = 0; i < n; i++) {
            const a = i * 3;
            const c2 = a + 3;
            const dx = pts[c2] - pts[a], dy = pts[c2 + 1] - pts[a + 1], dz = pts[c2 + 2] - pts[a + 2];
            const d = Math.hypot(dx, dy, dz) || 1e-6;
            const diff = (d - seg) / d;
            if (i === 0) {
              pts[c2] -= dx * diff;
              pts[c2 + 1] -= dy * diff;
              pts[c2 + 2] -= dz * diff;
            } else {
              pts[a] += dx * diff * 0.5;
              pts[a + 1] += dy * diff * 0.5;
              pts[a + 2] += dz * diff * 0.5;
              pts[c2] -= dx * diff * 0.5;
              pts[c2 + 1] -= dy * diff * 0.5;
              pts[c2 + 2] -= dz * diff * 0.5;
            }
          }
          for (let i = 1; i <= n; i++) {
            const o = i * 3;
            for (const s of this.spheres) {
              const dx = pts[o] - s.x, dy = pts[o + 1] - s.y, dz = pts[o + 2] - s.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < s.w * s.w) {
                const d = Math.sqrt(d2) || 1e-6;
                const k2 = s.w / d;
                pts[o] = s.x + dx * k2;
                pts[o + 1] = s.y + dy * k2;
                pts[o + 2] = s.z + dz * k2;
              }
            }
            if (pts[o + 1] < floor) pts[o + 1] = floor;
          }
        }
      }
      // pose the chain bones along the particles
      for (let i = 0; i < n; i++) {
        const bone = tail.bones[i];
        const o = i * 3;
        bone.position.set(pts[o], pts[o + 1], pts[o + 2]);
        _v.set(pts[o + 3] - pts[o], pts[o + 4] - pts[o + 1], pts[o + 5] - pts[o + 2]).normalize();
        bone.quaternion.setFromUnitVectors(DOWN, _v);
      }
    }

    // satchel: a pendulum hung from the hip, kept outside the coat
    {
      const bs = this.bagSim;
      const pivot = this.anchor.copy(bs.local).applyMatrix4(b.hips.matrixWorld);
      if (!this.simReady) {
        bs.p.set(pivot.x + 0.02, pivot.y - bs.len, pivot.z + 0.01);
        bs.q.copy(bs.p);
      }
      this.hipsInv.copy(b.hips.matrixWorld).invert();
      const vyPrev = bs.vy;
      for (let st = 0; st < steps; st++) {
        const vx = (bs.p.x - bs.q.x) / h, vy = (bs.p.y - bs.q.y) / h, vz = (bs.p.z - bs.q.z) / h;
        const ax = this.gravity.x + 0.6 * (this.air.x - vx) * 0.15 - this.accLocal.x;
        const ay = this.gravity.y + 0.6 * (this.air.y - vy) * 0.15 - this.accLocal.y;
        const az = this.gravity.z + 0.6 * (this.air.z - vz) * 0.15 - this.accLocal.z;
        bs.q.copy(bs.p);
        bs.p.x += vx * h * 0.985 + ax * h * h;
        bs.p.y += vy * h * 0.985 + ay * h * h;
        bs.p.z += vz * h * 0.985 + az * h * h;
        // rope length
        _v.subVectors(bs.p, pivot);
        const d = _v.length() || 1e-6;
        bs.p.copy(pivot).addScaledVector(_v, bs.len / d);
        // stay outside the coat (ellipse around the hips)
        _v2.copy(bs.p).applyMatrix4(this.hipsInv);
        const ex = _v2.x / 0.25, ez = _v2.z / 0.215;
        const e = Math.hypot(ex, ez);
        if (e < 1 && _v2.y < 0.15) {
          _v2.x /= e;
          _v2.z /= e;
          bs.p.copy(_v2.applyMatrix4(b.hips.matrixWorld));
        }
      }
      bs.vy = (bs.p.y - bs.q.y) / h;
      const bag = b.bag;
      bag.position.copy(pivot);
      _v.subVectors(bs.p, pivot).normalize();
      _q.setFromUnitVectors(DOWN, _v);
      _v2.set(0, 0, 1).transformDirection(b.hips.matrixWorld);
      _q2.setFromAxisAngle(UP, Math.atan2(_v2.x, _v2.z));
      bag.quaternion.copy(_q).multiply(_q2);
      // lid flaps up when the bag is jolted
      const jolt = (bs.vy - vyPrev) / dt;
      this.lid.v += Math.abs(clamp(jolt, -80, 80)) * 0.0015;
      const lid = this.lid.step(0, 4.5, 0.25, dt);
      b.bagLid.rotation.x = -clamp(Math.abs(lid) + 0.15 * sp * Math.max(0, Math.sin(t * 17)) * this.w.run, 0, 0.9);
    }

    // hair tufts bounce with the head
    {
      _v.set(0, 0.15, 0).applyMatrix4(b.head.matrixWorld);
      if (!this.simReady) this.headPos.copy(_v);
      _v2.subVectors(_v, this.headPos).divideScalar(dt);
      this.headPos.copy(_v);
      const accY = (_v2.y - this.headVel.y) / dt + this.accLocal.y;
      const accX = (_v2.x - this.headVel.x) / dt + this.accLocal.x;
      this.headVel.copy(_v2);
      this.headAcc.x = damp(this.headAcc.x, clamp(accX, -60, 60), 25, dt);
      this.headAcc.y = damp(this.headAcc.y, clamp(accY, -60, 60), 25, dt);
      for (let i = 0; i < 3; i++) {
        const hs = this.hair[i];
        const wind = 0.25 * clamp(airSpeed / 25, 0, 1);
        const rx = hs.x.step(wind + this.headAcc.y * 0.006, 3.4 + i * 0.4, 0.22, dt);
        const rz = hs.z.step(-this.headAcc.x * 0.004, 3 + i * 0.3, 0.25, dt);
        const bone = b['hair' + i];
        bone.rotation.x = clamp(rx, -0.6, 0.7);
        bone.rotation.z = clamp(rz, -0.5, 0.5);
      }
    }

    // coat skirt: wind flare at the back, lift when falling, puff on landing,
    // swing with sideways moves — and never let a leg poke through
    {
      const spd = clamp(airSpeed / 24, 0, 1.2);
      const fall = clamp(-(this.grounded ? 0 : this.vy) * 0.06, -0.15, 0.5);
      const puff = this.springs.land.x * 0.35;
      const lat = this.accLocal.x;
      const legs = this.legOffsets();
      for (let k = 0; k < SKIRT_PANELS; k++) {
        const th = this.panelAngle[k];
        const sn = Math.sin(th);
        const cs = Math.cos(th);
        let target = 0.06;
        target += (0.12 + 0.32 * spd) * Math.pow(Math.max(0, cs), 1.5) * (0.6 + 0.4 * this.w.run);
        target -= 0.07 * spd * Math.max(0, -cs);
        target += fall + puff;
        target += clamp(-lat * sn * 0.012, -0.2, 0.3);
        const flare = this.skirt[k].step(target, 3.6, 0.32, dt);
        // leg clearance
        let req = -1;
        for (const L of legs) {
          const close = Math.cos(th - L.th);
          if (close < 0.55) continue;
          const need = L.r + 0.085;
          const fr = Math.asin(clamp((need - SKIRT_HINGE_R) / 0.33, -1, 1)) - 0.17;
          req = Math.max(req, fr * smooth(0.55, 0.92, close));
        }
        const up = Math.max(flare, req);
        const flutter = 0.07 * spd * Math.max(0, cs) * Math.sin(t * 15 + k * 1.9) + 0.03 * Math.sin(t * 2.3 + k);
        b['skU' + k].rotation.x = -up;
        b['skU' + k].rotation.z = 0;
        b['skL' + k].rotation.x = -(0.35 * (flare - 0.06) + flutter);
      }
    }

    this.simReady = true;
  }

  // Where each thigh crosses the coat's hem height, in hips space: angle around
  // the body and elliptical radius.
  legOffsets() {
    const b = this.b;
    this.hipsInv.copy(b.hips.matrixWorld).invert();
    const res = this._legs || (this._legs = [{ th: 0, r: 0 }, { th: 0, r: 0 }]);
    const hemY = 0.545 - HIP_Y;
    let i = 0;
    for (const side of ['L', 'R']) {
      const H = _v.setFromMatrixPosition(b['thigh' + side].matrixWorld).applyMatrix4(this.hipsInv);
      const K = _v2.setFromMatrixPosition(b['shin' + side].matrixWorld).applyMatrix4(this.hipsInv);
      const dy = K.y - H.y;
      const tt = dy < -0.02 ? clamp((hemY - H.y) / dy, 0, 1.25) : 1;
      const x = H.x + (K.x - H.x) * tt;
      const z = (H.z + (K.z - H.z) * tt) / SKIRT_EZ;
      res[i].th = Math.atan2(x, z);
      res[i].r = Math.hypot(x, z);
      i++;
    }
    return res;
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
