import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials } from '../render/shaders.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { Cloth } from './cloth.js';
import { palette, setColliders, sheetGeometry, writeSheet } from './kit.js';
import { Player, C, hermite } from './player.js';
import { CONFIG } from '../config.js';
import { Dust } from './dust.js';

// The elder: an incredibly old man, the tallest of the runners, bent at the
// waist and hobbling along on his long twisted walking stick - and every bit
// as fast as the young ones (sculpted in tools/runner/elder.py). On top of
// the shared runner (player.js):
//   - the stick is planted in the world, not carried through it: each
//     stride it strikes the road beside him and stays put while he hobbles
//     past it, then swings through for the next; his right arm reaches for
//     it (a two-bone solve of the arm, the hand gripping the stick where it
//     is - see staffStep). He pushes himself from lane to lane with it,
//     planting it on the far side and shoving off, vaults over it to jump,
//     plants it to land, and drags it behind him like a skid in a slide;
//   - his incredibly long white beard is simulated like Wren's hair
//     (cloth.js): hanging from his chin, it streams in the headwind, slides
//     off his pot belly to one side and round him, swings out across a lane
//     change, flies up through a vault and slaps down on landing;
//   - the skirt of his robe is simulated too, hung from his waist under the
//     sash and open down the front; the bell sleeves hang and swing on
//     springs; his wispy hair and bushy brows bounce.

// Palette slots: 1-13 are the garment ids baked into the mesh, the rest are
// colours the character shader draws his details with (see CHAR_DETAIL).
export const COL = {
  1: '#c4865c', // face (weathered, tanned skin)
  2: '#eeebe4', // hair, brows, moustache
  3: '#2c6475', // robe (deep teal)
  4: '#729d90', // under-robe (sea green)
  5: '#5b4436', // leggings
  6: '#7b4a2b', // sash
  7: '#6e5444', // boots
  8: '#c4865c', // hands (skin)
  9: '#2c6475', // hood
  10: '#2c6475', // skirt
  11: '#7a5234', // walking stick
  12: '#ee7a28', // spectacles (orange)
  13: '#eeebe4', // the long beard
  14: '#1c4757', // robe, deep
  15: '#557f73', // under-robe and lining, deep
  16: '#8e5236', // skin creases
  17: '#d69a6e', // skin, warm
  18: '#45342a', // boots, dark
  19: '#4a2f1e', // wood, dark grain
  20: '#a77a4f', // wood, worn pale
  21: '#bdb7ad', // hair, shade
  22: '#f2ece2', // eye whites
  23: '#6b8ea3', // irises (pale blue-grey)
  24: '#22140f', // lid lines, pupils
  25: '#8a4a3a', // mouth
  26: '#d27258', // flush (nose, cheeks, ears)
  27: '#c4561c', // spectacles, deep
  28: '#fff6e0', // glint
  29: '#5a3420', // sash, dark
  30: '#ffffff', // hair highlight
  31: '#3f2e25', // leggings, dark
};

// The long beard: cols x rows particles; u runs across (0 at his right jaw,
// round under the chin, 1 at his left), v down from the roots to the tip.
export const BEARD = {
  cols: 9,
  rows: 14,
  length: 0.76, // from under the chin to the tip, hanging
  tipW: 0.05, // how wide it narrows to at the tip (each side)
  thick: 0.013, // half its depth, before the taper (see VS_CHAR)
  subU: 3,
  subV: 2,
  margin: 0.007,
};

// The skirt of the robe: u runs from the left front edge round the back to
// the right front edge, v down from the waist to the hem.
export const SKIRT = {
  cols: 19,
  rows: 11,
  gap: 0.46, // open down the front (radians round the waist)
  hem: 0.13, // hem height, hanging (mid-shin)
  flare: 0.075, // how far the hem stands out round him
  folds: 5,
  pleat: 0.012,
  thick: 0.0065,
  subU: 3,
  subV: 2,
  margin: 0.012,
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _G = new THREE.Vector3();
const _T = new THREE.Vector3();
const _D = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _dv = new THREE.Vector3();

// Settle a sheet's first guess onto the body as bound (pins held).
function settle(cols, rows, pts, colliders, margin, lift) {
  const cloth = new Cloth(cols, rows, pts);
  setColliders(cloth, colliders, null, null, margin);
  cloth.frontOff = 0.6;
  cloth.place((v) => v);
  for (let i = 0; i < cols * 3; i++) cloth.pinA[i] = cloth.pinB[i] = pts[i];
  const f = { gx: 0, gy: -9.8, gz: 0, ax: 0, ay: 0, az: 0, wake: 0, draw: 0, gust: 0, gustSpeed: 1, gustLen: 1, curl: 0, kn: 0.2, kt: 0.05, damp: 6, floor: -10, lift, t: 0 };
  for (let k = 0; k < 150; k++) {
    f.t += 1 / 60;
    cloth.step(1 / 60, f);
  }
  return Float32Array.from(cloth.p);
}

// Resample a polyline into n points evenly along its length.
function resample(path, n, out, col, cols) {
  let total = 0;
  const acc = [0];
  for (let k = 1; k < path.length; k++) acc.push((total += path[k].distanceTo(path[k - 1])));
  for (let j = 0; j < n; j++) {
    const s = (j / (n - 1)) * total;
    let k = 1;
    while (k < acc.length - 1 && acc[k] < s) k++;
    const f = (s - acc[k - 1]) / Math.max(1e-6, acc[k] - acc[k - 1]);
    _v.copy(path[k - 1]).lerp(path[k], Math.min(1, f)).toArray(out, (j * cols + col) * 3);
  }
}

// The rest fall of the beard: each column from its root under the jaw,
// curving down under the chin and hanging, the columns drawing together
// toward a point; it drapes over the front of his chest and the round of his
// belly - then is let fall onto them.
function beardBind(rig) {
  const { cols, rows } = BEARD;
  const pts = new Float32Array(cols * rows * 3);
  const roots = rig.beardRoots;
  const tipY = roots[cols >> 1][1] - BEARD.length;
  // the front of his body, by height (the chest, then the belly's round)
  const front = (y) => {
    const by = (y - 1.16) / 0.155;
    const belly = by * by < 1 ? -0.05 - 0.162 * Math.sqrt(1 - by * by) : -0.05;
    return Math.min(-0.085, belly - 0.022);
  };
  for (let i = 0; i < cols; i++) {
    const u = (i / (cols - 1)) * 2 - 1;
    const R = new THREE.Vector3(...roots[i]);
    const path = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const y = R.y + (tipY - R.y) * t;
      const close = smooth(0.05, 1.0, t);
      const x = R.x + (u * BEARD.tipW - R.x) * close;
      // (it leaves the chin heading forward and down, then hangs)
      const z = Math.min(R.z - 0.015 * Math.sin(Math.PI * Math.min(1, t * 4)), front(y));
      path.push(new THREE.Vector3(x, y, z));
    }
    resample(path, rows, pts, i, cols);
  }
  return settle(cols, rows, pts, rig.beard, BEARD.margin, 0.05);
}

// The rest drape of the skirt: from round his waist (just under the sash),
// hanging to mid-shin and flaring a little, in soft folds round the back.
function skirtBind(rig) {
  const { cols, rows } = SKIRT;
  const K = rig.skirt;
  const pts = new Float32Array(cols * rows * 3);
  for (let i = 0; i < cols; i++) {
    const c = (i / (cols - 1)) * 2 - 1;
    const th = c * (Math.PI - SKIRT.gap / 2);
    const s = Math.sin(th), co = Math.cos(th);
    const path = [];
    for (let k = 0; k <= 30; k++) {
      const f = k / 30;
      const fl = 1 + (SKIRT.flare / 0.13) * Math.pow(f, 1.2) + (SKIRT.pleat / 0.13) * Math.pow(f, 0.8) * Math.cos(c * Math.PI * SKIRT.folds);
      const y = K.y + (SKIRT.hem - K.y) * f;
      path.push(new THREE.Vector3(s * K.w * fl, y, K.z + co * (co > 0 ? K.back : K.front) * fl));
    }
    resample(path, rows, pts, i, cols);
  }
  return settle(cols, rows, pts, K.colliders, SKIRT.margin, 0.1);
}

// How he runs: a quick, short-stepping hobble - knees bent, feet shuffling
// low over the road, toes out, bent well over at the waist with his neck
// craned forward and his head up to see where he's going; his free hand
// tucked into the small of his back. The stick does the rest (see staffRun).
const GAIT = {
  cadence: [2.1, 0.06],
  stride: { reach: 0.48, hipY: 0.96, bob: 0.016, trackX: 0.075, swingX: 0.1, toeOut: 0.15, heelLift: 0.45, ballZ: -0.05, maxDuty: 0.4 },
  swing: [
    [0.16, 0.2, 0.13, 0.02, 0.015],
    [0.4, 0.07, 0.18, 0.0, 0.03],
    [0.65, -0.12, 0.16, -0.025, 0.015],
    [0.84, -0.22, 0.11, -0.015, 0.0],
  ],
  arm: {
    swing: [0.1, 0.3, 0.36, 0.22, -0.06, -0.26, -0.32, -0.2],
    abd: [0.3, 0.28, 0.27, 0.29, 0.31, 0.33, 0.34, 0.32],
    elbow: [0.9, 1.1, 1.2, 1.05, 0.85, 0.7, 0.68, 0.78],
    amp: [0.7, 0.2],
  },
  lean: [0.14, 0.1],
  hipYaw: 0.13,
  hipRoll: 0.06,
  spTwist: 0.1,
  chTwist: 0.08,
};

// How he handles: much as the others do (every gap is as fair), with a
// little more lean into a lane change - he throws himself off his stick - and
// a frail, wobbly landing that sinks deep and comes up in a couple of bounces.
const FEEL = {
  laneSpring: 34,
  lean: [0.04, 0.45],
  turn: [0.026, 0.36],
  land: { freq: 3.6, zeta: 0.3, thud: 0.02 },
};

// The bend at the waist he never straightens out of (added to every pose but
// the crash): the lower back, the upper back rounded over, the neck craning.
const STOOP = { sp: 0.32, ch: 0.26, head: 0.5 };

// The stick in the run: where it strikes the road (beside his right foot,
// ahead of him), how much road it can stay planted for, how high it swings.
const STICK = { x: 0.3, z: -0.22, reach: 0.85, lift: 0.17, minContact: 0.05 };

export class Elder extends Player {
  constructor(envDef, asset) {
    super(envDef, asset, { gait: GAIT, feel: FEEL });
  }

  buildLook() {
    const R = this.rig;
    const rig = [new THREE.Vector4(R.bootX, R.bootCuff, R.soleH, R.sashY)];
    const sheet = (S, w) => {
      const data = new Float32Array(S.cols * S.rows * 4);
      const tex = new THREE.DataTexture(data, S.cols, S.rows, THREE.RGBAFormat, THREE.FloatType);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      return { data, tex, grid: new THREE.Vector4(S.cols, S.rows, S.thick, w) };
    };
    this.beardS = sheet(BEARD, 1);
    this.skirtS = sheet(SKIRT, 0);
    const mats = makeCharacterMaterials(
      this.u,
      palette(COL),
      rig,
      0.0098,
      [
        { texture: this.beardS.tex, grid: this.beardS.grid },
        { texture: this.skirtS.tex, grid: this.skirtS.grid },
      ],
      { style: 'elder' },
    );
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.buildBody();
    // the stick and his hand on it, as bound (root space)
    const b = this.b;
    this.staffBind = b.staff.matrixWorld.clone();
    this.handBind = b.handR.matrixWorld.clone();
    this.staffToHand = new THREE.Matrix4().copy(this.staffBind).invert().multiply(this.handBind);
    const relP = new THREE.Vector3().setFromMatrixPosition(this.staffToHand);
    this.handOff = new THREE.Vector3(relP.x, 0, relP.z).normalize(); // which way the wrist sits off the shaft
    this.staffToHandQ = new THREE.Quaternion().setFromRotationMatrix(this.staffToHand);
    // where the grip is, in the hand's own space (for the arm's own pose)
    this.gripInHand = new THREE.Vector3(0, R.staff.grip, 0).applyMatrix4(this.staffBind).applyMatrix4(new THREE.Matrix4().copy(this.handBind).invert());
    this.handToStaffQ = this.staffToHandQ.clone().invert();
    this.reach = R.upperArm + R.forearm;
    // the beard and the skirt
    this.beardRest = beardBind(R);
    this.skirtRest = skirtBind(R);
    const mk = (S, rest, mat, pair) => {
      const geo = sheetGeometry(S, rest, mat);
      for (const [mm, k] of [[pair[0], 0], [pair[1], 1]]) {
        const mesh = new THREE.Mesh(geo, mm);
        mesh.frustumCulled = false;
        mesh.renderOrder = -20;
        this.root.add(mesh);
      }
    };
    mk(BEARD, this.beardRest, this.asset.meta.materials.beard, mats.sheets[0]);
    mk(SKIRT, this.skirtRest, this.asset.meta.materials.skirt, mats.sheets[1]);
    this.dust = new Dust(this.u);
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points];
  }

  forCompile(on) {
    this.dust.forCompile(on);
  }

  buildSim() {
    super.buildSim();
    // the beard: the roots sewn under the jaw; the rows under the chin
    // leashed to where the head carries them; free from there down
    const leash = (cl, rest, cols, rows, until, k) => {
      let s = 0;
      for (let j = 1; j < rows; j++) {
        const a = ((j - 1) * cols + (cols >> 1)) * 3, b = (j * cols + (cols >> 1)) * 3;
        s += Math.hypot(rest[a] - rest[b], rest[a + 1] - rest[b + 1], rest[a + 2] - rest[b + 2]);
        cl.leash[j] = s < until ? 0.002 + k * Math.max(0, s - 0.03) ** 2 : Infinity;
      }
    };
    this.beard = new Cloth(BEARD.cols, BEARD.rows, this.beardRest);
    leash(this.beard, this.beardRest, BEARD.cols, BEARD.rows, 0.14, 4);
    this.beard.frontOff = 0.45;
    this.beard.backOff = 0.04;
    this.beardDefs = this.rig.beard.map((c) => ({ ...c }));
    this.beard.setColliderCount(this.beardDefs.length);
    this.beardFold = new Float32Array(BEARD.cols * BEARD.rows);
    this.beardWind = { gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0, wake: 0.3, draw: 0.3, gust: 0, gustSpeed: 1, gustLen: 1, curl: 0, kn: 0, kt: 0, damp: 0.6, floor: 0, lift: 0.06, spread: 0, t: 0 };
    // the skirt: sewn round the waist, the top rows leashed to the hips,
    // free from the thighs down
    this.skirt = new Cloth(SKIRT.cols, SKIRT.rows, this.skirtRest);
    leash(this.skirt, this.skirtRest, SKIRT.cols, SKIRT.rows, 0.22, 3);
    this.skirt.frontOff = 0.5;
    this.skirt.backOff = 0.08;
    this.skirtDefs = this.rig.skirt.colliders.map((c) => ({ ...c }));
    this.skirt.setColliderCount(this.skirtDefs.length);
    this.skirtFold = new Float32Array(SKIRT.cols * SKIRT.rows);
    this.skirtWind = { gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0, wake: 0.25, draw: 0.6, gust: 0, gustSpeed: 1, gustLen: 1, curl: 0, kn: 0, kt: 0, damp: 0.5, floor: 0, lift: 0.22, t: 0 };
    this.headM = new THREE.Matrix4();
    this.hipsM = new THREE.Matrix4();
    this.headPrev = new THREE.Vector3();
    this.hipsPrev = new THREE.Vector3();
    // the bell sleeves on springs
    this.cuffS = [0, 1].map(() => ({ x: new Spring(), z: new Spring() }));
    // the stick: where it was planted in the world (relative to him, world
    // axes), the frame it's drawn at
    this.plant = { on: false, t: 0, dur: 0, tip: new THREE.Vector3(), slip: 9, ground: 0 };
    // where the stick has struck the road since the game last looked (his
    // own space: the sands take a hole from each)
    this.strikes = { n: 0, at: [0, 1, 2, 3].map(() => new THREE.Vector3()) };
    this.staffM = new THREE.Matrix4();
  }

  resetSim() {
    super.resetSim();
    this.beard.collidersMoved = false;
    this.skirt.collidersMoved = false;
    for (const c of this.cuffS || []) {
      c.x.reset();
      c.z.reset();
    }
    if (this.plant) this.plant.on = false;
    if (this.strikes) this.strikes.n = 0;
    this.dodgeT = 9;
    this.dodgeDir = 1;
    this.gustT = 0;
    this.greetT = 9;
    this.lastDt = 0;
    this.stickK = NaN;
    this.toeOffK = null;
    this.dust?.clear();
  }

  update(dt, speed, groundAt) {
    this.lastDt = dt;
    super.update(dt, speed, groundAt);
    // a stick planted in the world stays where it is as he goes past it
    // (sliding back no faster than slip m/s: at full tilt it would be gone
    // in a frame - this way the push still shows)
    const P = this.plant;
    if (P.on) {
      P.t += dt;
      P.tip.x -= this.vx * dt;
      P.tip.z += Math.min(this.speed, P.slip) * dt;
      P.tip.y = P.ground - this.y;
      if (P.t > P.dur) P.on = false;
    }
  }

  place(z, dist = 0) {
    super.place(z);
    this.dust.update(this.lastDt, this.root, z, dist);
    this.lastDt = 0;
  }

  // Plant the stick at tip (his own space) for dur seconds; a puff of dust
  // where it strikes.
  startPlant(tip, dur, slip = 9, puffs = 2) {
    const P = this.plant;
    P.on = true;
    P.t = 0;
    P.dur = dur;
    P.slip = slip;
    P.ground = (this.groundY || 0);
    P.tip.copy(tip).applyQuaternion(this.root.quaternion);
    P.tip.y = P.ground - this.y;
    if (puffs > 0 && !this.wet) this.stickPuff(tip, puffs);
    this.strike(tip);
  }

  strike(at) {
    const S = this.strikes;
    if (S.n < S.at.length) S.at[S.n++].set(at.x, 0, at.z);
  }

  // dust off the stick's tip (his own space)
  stickPuff(at, n, big = 1) {
    const r = Math.random;
    const run = _dv.set(this.vx, 0, -this.speed).applyQuaternion(this.invQ);
    for (let k = 0; k < n; k++) {
      _v.copy(run).multiplyScalar(0.45 + 0.15 * r());
      _v.x += (r() - 0.5) * 1.6;
      _v.y += 0.4 + 0.5 * r();
      _v.z += 0.2 + 0.4 * r();
      _p.set(at.x + (r() - 0.5) * 0.06, 0.05, at.z + (r() - 0.5) * 0.06);
      this.dust.emit(_p, _v, (0.14 + 0.06 * r()) * big, false, 0.7 + 0.15 * r(), 0.75, 0.85);
    }
  }

  // --- moves -------------------------------------------------------------------
  // A lane change: he plants the stick on the far side and shoves himself
  // off it (moving right, he swings it across in front of him to plant it on
  // his left).
  onDodge(dir) {
    this.dodgeT = 0;
    this.dodgeDir = dir;
    if (this.mode === 'run' && this.grounded && !this.sliding && !this.crashed) {
      _p.set(dir < 0 ? 0.55 : -0.42, 0, -0.62);
      this.startPlant(_p, 0.2, 7, 2);
    }
  }

  // The jump: he plants the stick ahead and vaults up over it.
  jump() {
    const fromRun = this.grounded && !this.sliding;
    super.jump();
    if (fromRun && !this.crashed) {
      _p.set(0.2, 0, -0.62);
      this.startPlant(_p, 0.16, 8, 3);
    }
  }

  onLand(hit) {
    if (this.crashed || this.mode !== 'run') return;
    // the stick comes down first, just ahead of him, and takes his weight
    _p.set(0.26, 0, -0.42);
    this.startPlant(_p, 0.16, 6, hit > 0.5 ? 3 : 1);
  }

  // Picked on the title screen: a gust in his beard and robe, and he lifts
  // his stick and thumps it down.
  greet() {
    this.gustT = 1;
    this.greetT = 0;
  }

  // --- poses -------------------------------------------------------------------
  // The stoop, laid on a pose: bent at the waist, the back rounded, the neck
  // craned forward and the head tipped back up to look ahead (k: how much).
  stoop(p, k = 1) {
    p[C.spLean] += STOOP.sp * k;
    p[C.chLean] += STOOP.ch * k;
    p[C.hdPitch] += STOOP.head * k;
  }

  // His free hand tucked into the small of his back.
  handBehind(p, k = 1) {
    const m = (i, v) => (p[i] += (v - p[i]) * k);
    // (the upper arm back a little and turned in on itself, so the elbow
    // bends the forearm in across the small of his back)
    m(C.shLx, -0.42);
    m(C.shLz, 0.08);
    m(C.shLy, 1.57);
    m(C.elL, 1.15);
    m(C.wrL, 0.25);
    m(C.wrLz, 0.0);
    m(C.clL, 0.02);
    m(C.clLy, -0.1);
  }

  poseRun(r, f, sp) {
    super.poseRun(r, f, sp);
    this.stoop(r);
    // the head up, looking ahead over the stoop
    r[C.hdPitch] -= 0.08;
    // a hobble: a lurch onto the stick each stride (it strikes as the left
    // foot lands), the hips dipping and rolling toward it
    const lurch = Math.max(0, Math.cos(f - Math.PI));
    r[C.hipY] -= 0.012 * lurch;
    r[C.hipRoll] += 0.04 * Math.sin(f);
    r[C.spSide] -= 0.05 * Math.sin(f);
    r[C.chLean] += 0.05 * lurch;
    this.handBehind(r);
    // the stick hand swings with the stick: forward as it swings through,
    // back as he goes past it
    r[C.shRx] = 0.55 + 0.32 * Math.cos(f);
    r[C.shRz] = 0.3;
    r[C.shRy] = -0.2;
    r[C.elR] = 0.75 - 0.15 * Math.cos(f);
  }

  // Standing: leaning on his stick, bent over it, the other hand in the
  // small of his back; he breathes, looks about, now and then gives a little
  // nod and a sniff.
  poseIdle(id, t) {
    const ws = super.poseIdle(id, t);
    this.stoop(id, 0.95);
    id[C.hipY] -= 0.03;
    id[C.knL] += 0.12;
    id[C.knR] += 0.12;
    id[C.hdPitch] += 0.03 * Math.sin(t * 1.3) - 0.06;
    this.handBehind(id);
    id[C.shRx] = 0.45;
    id[C.shRz] = 0.28;
    id[C.shRy] = -0.15;
    id[C.elR] = 0.8;
    return ws;
  }

  // The vault (keyed on how far through the jump he is: the climb and the
  // fall): he pushes off the stick bent over it, one leg kicking back; tucks
  // both knees up high and to the side as he goes over, his free arm flung
  // out, beard flying; and reaches down with both feet and the stick to land.
  poseJump(j) {
    const u = clamp(0.5 - 0.5 * this.vyPose / this.V0, 0, 1);
    const k = (a, b, c) => hermite(VAULT_T, [a, b, c, c], 0, 0, u);
    j.fill(0);
    j[C.hipY] = this.HIP_Y + k(-0.02, -0.06, -0.04);
    j[C.hipPitch] = k(0.15, 0.25, 0.05);
    j[C.hipYaw] = k(-0.1, 0.12, 0);
    j[C.hipRoll] = k(0.0, -0.12, 0);
    j[C.spLean] = k(0.55, 0.2, 0.3);
    j[C.chLean] = k(0.15, 0.12, 0.22);
    j[C.spSide] = k(0.0, 0.12, 0);
    j[C.hdPitch] = k(0.45, 0.3, 0.42);
    // legs: the left drives up, the right kicks back - then both tuck up
    // high, swung out to his left - then reach for the road
    j[C.thLx] = k(1.15, 1.75, 0.6);
    j[C.knL] = k(1.5, 2.25, 0.75);
    j[C.anL] = k(0.2, 0.55, 0.15);
    j[C.thRx] = k(-0.55, 1.6, 0.5);
    j[C.knR] = k(1.3, 2.3, 0.85);
    j[C.anR] = k(-0.4, 0.5, 0.2);
    j[C.thLz] = k(0.12, 0.42, 0.14);
    j[C.thRz] = k(0.06, -0.05, 0.14);
    j[C.toL] = k(0, 0, 0);
    j[C.toR] = k(0.3, 0, 0);
    // the free arm flung out and up for balance, coming down to land
    j[C.shLx] = k(-0.3, 0.6, 0.35);
    j[C.shLz] = k(1.0, 1.4, 0.9);
    j[C.elL] = k(0.5, 0.35, 0.5);
    j[C.wrL] = 0.1;
    j[C.clL] = k(0.12, 0.2, 0.1);
    // the stick arm: down onto the stick, then holding it
    j[C.shRx] = k(0.9, 0.7, 0.75);
    j[C.shRz] = k(0.35, 0.45, 0.35);
    j[C.elR] = k(0.25, 0.9, 0.5);
    j[C.clR] = k(0.1, 0.12, 0.08);
    j[C.sq] = 1;
  }

  // Ducking under: he drops into a squat right down on his heels, folded
  // over his knees, robe pooling round him, his free arm out for balance,
  // dragging his stick along the road behind him like a skid (a trail of
  // dust off its tip) - then hauls himself back up.
  poseSlide(s, t) {
    if (this.slideT > 0) this.slideU = 1 - clamp(this.slideT / CONFIG.slide.time, 0, 1);
    const u = this.slideU ?? 1;
    const pop = smooth(0.72, 1, u);
    const sink = smooth(0, 0.12, u);
    const rattle = (Math.sin(t * 41) * 0.6 + Math.sin(t * 27 + 1.1) * 0.4) * (1 - pop) * sink;
    s.fill(0);
    s[C.hipY] = this.HIP_Y + (0.42 - this.HIP_Y) * sink * (1 - pop) + (0.9 - this.HIP_Y) * pop + 0.006 * rattle;
    s[C.hipPitch] = 0.35 * (1 - pop);
    s[C.spLean] = 0.55 * (1 - pop) + 0.1 * pop + 0.02 * rattle;
    s[C.chLean] = 0.18;
    s[C.hdPitch] = 0.5 * (1 - pop) + 0.15;
    s[C.hdRoll] = 0.04 * rattle;
    s[C.thLx] = 1.85 * (1 - pop) + 0.5 * pop;
    s[C.knL] = 2.35 * (1 - pop) + 0.8 * pop;
    s[C.anL] = 0.7 * (1 - pop) + 0.25 * pop;
    s[C.thRx] = 1.7 * (1 - pop) + 0.35 * pop;
    s[C.knR] = 2.25 * (1 - pop) + 0.6 * pop;
    s[C.anR] = 0.65 * (1 - pop) + 0.2 * pop;
    s[C.thLz] = 0.3;
    s[C.thRz] = 0.26;
    s[C.thLy] = 0.25;
    s[C.thRy] = 0.25;
    s[C.shLx] = 0.6;
    s[C.shLz] = 1.1 - 0.4 * pop;
    s[C.elL] = 0.4;
    s[C.wrL] = 0.2;
    s[C.shRx] = -0.1;
    s[C.shRz] = 0.45;
    s[C.elR] = 0.3;
    s[C.sq] = 1;
  }

  // He lands frail: his knees buckle deep and he folds over his stick, his
  // head bobbing, the free arm flapping out - then he wobbles back up.
  landOverlay(Pz, land) {
    const d = Math.max(0, land), p = Math.max(0, -land);
    Pz[C.hipY] += -0.12 * d + 0.02 * p;
    Pz[C.knL] += 0.62 * d;
    Pz[C.knR] += 0.62 * d;
    Pz[C.thLx] += 0.3 * d;
    Pz[C.thRx] += 0.3 * d;
    Pz[C.anL] += 0.3 * d;
    Pz[C.anR] += 0.3 * d;
    Pz[C.thLz] += 0.08 * d;
    Pz[C.thRz] += 0.08 * d;
    Pz[C.spLean] += 0.32 * d - 0.06 * p;
    Pz[C.chLean] += 0.12 * d;
    Pz[C.hdPitch] += 0.12 * d - 0.14 * p;
    Pz[C.shLz] += 0.5 * d;
    Pz[C.shLx] += 0.3 * d;
    Pz[C.elL] -= 0.4 * d;
    Pz[C.sq] += -0.07 * d + 0.03 * p;
  }

  // A lane change: thrown off the stick - a little hop, leaning hard into
  // it, the free hand out of the small of his back and flung out for balance.
  laneOverlay(Pz, lc, dt) {
    super.laneOverlay(Pz, lc, dt);
    this.dodgeT += dt;
    const e = this.dodgeT < 0.3 ? Math.sin((this.dodgeT / 0.3) * Math.PI) : 0;
    const d = this.dodgeDir;
    Pz[C.hipY] += 0.04 * e * this.w.run;
    Pz[C.spSide] -= 0.12 * lc;
    Pz[C.hdRoll] += 0.12 * lc;
    Pz[C.shLx] += (0.6 - Pz[C.shLx]) * e;
    Pz[C.shLz] += (1.15 - Pz[C.shLz]) * e;
    Pz[C.shLy] += (0 - Pz[C.shLy]) * e;
    Pz[C.elL] += (0.4 - Pz[C.elL]) * e;
    Pz[d > 0 ? C.thRz : C.thLz] += 0.18 * e * this.w.run;
  }

  // --- the stick ---------------------------------------------------------------
  afterPose(dt, cw) {
    this.staffStep(dt, cw);
  }

  // Where the stick is this frame - planted in the road or carried - and his
  // hand on it: the stick decides where the hand must be, and the arm
  // reaches it (a two-bone solve, the elbow out and back).
  staffStep(dt, cw) {
    const b = this.b;
    const R = this.rig;
    const L = R.staff.grip;
    this.root.matrixWorld.identity();
    this.body.updateWorldMatrix(false, true);
    // where his hand would be by the pose alone, and the grip in it
    const Gfk = _G.copy(this.gripInHand).applyMatrix4(b.handR.matrixWorld);
    // each mode's stick: a tip on the road (planted) or a direction from
    // the hand (carried), blended by the poses' weights
    const W = this.w;
    const tot = W.run + W.jump + W.slide + W.idle || 1;
    const T = _T.set(0, 0, 0);
    const D = _D.set(0, 0, 0);
    const add = (tip, w) => {
      if (w <= 0) return;
      T.addScaledVector(tip, w);
      _v3.subVectors(Gfk, tip).normalize();
      D.addScaledVector(_v3, w);
    };
    // running: it strikes the road as the left foot lands and stays there
    // as he hobbles past it, then swings through for the next
    if (W.run > 0) add(this.stickRun(_v), W.run / tot);
    // standing: planted beside his right foot (lifted and thumped down
    // when he's picked)
    if (W.idle > 0) {
      this.greetT += dt;
      const g = this.greetT < 0.55 ? Math.sin((this.greetT / 0.55) * Math.PI) : 0;
      if (this.greetT >= 0.55 && this.greetT - dt < 0.55) this.stickPuff(_v.set(0.3, 0, -0.18), 3);
      add(_v.set(0.3 - 0.04 * g, 0.16 * g * g, -0.18 - 0.06 * g), W.idle / tot);
    }
    // sliding: dragged along the road behind him
    if (W.slide > 0) add(_v.set(0.42, 0, 0.55), W.slide / tot);
    // jumping: carried, swinging under him like a pendulum - planted ahead
    // as he goes up (see jump), swept back under him as he goes over, and
    // swung forward again to meet the road
    if (W.jump > 0) {
      const u = clamp(0.5 - 0.5 * this.vyPose / this.V0, 0, 1);
      const phi = hermite(VAULT_STICK_T, VAULT_STICK, 0, 0, u);
      _v2.set(0.06, Math.cos(phi), Math.sin(phi));
      _v.copy(Gfk).addScaledVector(_v2, -L);
      add(_v, W.jump / tot);
    }
    // planted in the world: a push off it, the vault's take-off, a landing
    const P = this.plant;
    if (P.on) {
      const pw = smooth(0, 0.035, P.t) * (1 - smooth(P.dur * 0.6, P.dur, P.t));
      _v.copy(P.tip).applyQuaternion(this.invQ.copy(this.root.quaternion).invert());
      T.lerp(_v, pw);
      _v3.subVectors(Gfk, _v).normalize();
      D.lerp(_v3, pw);
    }
    D.normalize();
    // knocked flat, it goes where his hand goes
    if (cw > 0) {
      _v2.set(0, 1, 0).applyQuaternion(_q.setFromRotationMatrix(_m.extractRotation(b.handR.matrixWorld)).multiply(this.handToStaffQ));
      _v.copy(Gfk).addScaledVector(_v2, -L);
      T.lerp(_v, cw);
      D.lerp(_v2, cw).normalize();
    }
    // the top of the stick, where he grips it, and its turn about its own
    // length: the wrist on the side toward the shoulder
    const G = _v.copy(T).addScaledVector(D, L);
    const S = _S.setFromMatrixPosition(b.armR.matrixWorld);
    _X.subVectors(S, G);
    _X.addScaledVector(D, -_X.dot(D));
    if (_X.lengthSq() < 1e-8) _X.set(-1, 0, 0);
    _X.normalize();
    _Z.crossVectors(_X, D);
    // (staff local: handOff -> X, +y -> D)
    const ho = this.handOff;
    const hz = _v2.crossVectors(ho, _Y.set(0, 1, 0));
    _m.makeBasis(ho, _Y, hz);
    _m2.makeBasis(_X, D, _Z);
    _m2.multiply(_m.transpose());
    _q.setFromRotationMatrix(_m2);
    // place the stick: its grip at G
    _p.set(0, L, 0).applyQuaternion(_q);
    _T.subVectors(G, _p);
    this.staffM.compose(_T, _q, _one);
    // the hand on it, and whether the arm can reach it (if not, the stick
    // comes with the hand: it lifts off the road)
    _m3.multiplyMatrices(this.staffM, this.staffToHand);
    const Wp = _W.setFromMatrixPosition(_m3);
    const dS = Wp.distanceTo(S);
    const maxR = this.reach * 0.995;
    if (dS > maxR) {
      _p.subVectors(S, Wp).multiplyScalar((dS - maxR) / dS);
      Wp.add(_p);
      _T.add(_p);
      this.staffM.setPosition(_T);
      _m3.multiplyMatrices(this.staffM, this.staffToHand);
    }
    b.staff.quaternion.copy(_q);
    this.solveArm(S, Wp, _m3);
    b.staff.position.copy(_T);
    b.staff.updateMatrixWorld(true);
    this.staffTip = this.staffTip || new THREE.Vector3();
    this.staffTip.copy(_T);
  }

  // The stick's tip in the run (his own space), by the stride's phase: it
  // strikes the road at mid-stance of the left foot (phase pi), stays put
  // for as much road as it can (never less than minContact), then swings
  // through in an arc to strike ahead again.
  stickRun(out) {
    const v = Math.max(this.speed, 0);
    const freq = this.stride;
    const duty = freq > 0 ? clamp((STICK.reach * freq) / Math.max(v, 1e-3), STICK.minContact * freq, 0.4) : 0.4;
    const span = freq > 0 ? Math.min(STICK.reach, (v * duty) / freq) : 0;
    const zTD = STICK.z - span / 2;
    let u = (this.phase - Math.PI + Math.PI * duty) / TAU;
    const n = Math.floor(u);
    u -= n;
    // (a strike: a little puff of dust off the tip, most strides)
    if (n > this.stickK && this.mode === 'run' && this.grounded && !this.sliding && !this.crashed && freq > 0) {
      _p.set(STICK.x, 0, zTD);
      this.strike(_p);
      if (!this.wet && Math.random() < 0.7) this.stickPuff(_p, 1, 0.8 + 0.4 * Math.random());
    }
    if (!(n <= this.stickK)) this.stickK = n;
    if (u < duty) {
      const c = u / duty;
      return out.set(STICK.x, 0, zTD + span * c);
    }
    const c = (u - duty) / (1 - duty);
    const e = c * c * (3 - 2 * c);
    const zr = zTD + span;
    return out.set(STICK.x + 0.03 * Math.sin(Math.PI * c), STICK.lift * Math.pow(Math.sin(Math.PI * c), 0.8), zr + (zTD - zr) * e);
  }

  // Two-bone solve of the right arm: shoulder S to wrist W, the elbow out
  // and back; the hand turned as the stick holds it (Mh: the hand's frame).
  solveArm(S, Wp, Mh) {
    const b = this.b;
    const ua = this.rig.upperArm, fa = this.rig.forearm;
    const d0 = Wp.distanceTo(S);
    const d = clamp(d0, Math.abs(ua - fa) + 0.01, ua + fa - 0.002);
    const n = _v2.subVectors(Wp, S).divideScalar(d0 || 1);
    // the pole: out to his right, back and a little down (by the chest)
    const cm = b.chest.matrixWorld.elements;
    _p.set(cm[0] * 0.4 + cm[8] * 0.7 - cm[4] * 0.6, cm[1] * 0.4 + cm[9] * 0.7 - cm[5] * 0.6, cm[2] * 0.4 + cm[10] * 0.7 - cm[6] * 0.6);
    _p.addScaledVector(n, -_p.dot(n)).normalize();
    const a = (ua * ua - fa * fa + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, ua * ua - a * a));
    const E = _E.copy(S).addScaledVector(n, a).addScaledVector(_p, h);
    // the upper arm's frame: -y down it, -z toward where the forearm bends
    _Y.subVectors(S, E).normalize();
    _Z.copy(n).addScaledVector(_Y, -n.dot(_Y));
    if (_Z.lengthSq() < 1e-8) _Z.copy(_p);
    _Z.normalize().negate();
    _X.crossVectors(_Y, _Z);
    _m.makeBasis(_X, _Y, _Z);
    _q.setFromRotationMatrix(_m);
    // into the collarbone's space
    _q2.setFromRotationMatrix(_m2.extractRotation(b.clavR.matrixWorld)).invert();
    b.armR.quaternion.copy(_q2).multiply(_q);
    // the elbow
    const cosE = clamp((ua * ua + fa * fa - d * d) / (2 * ua * fa), -1, 1);
    const elbow = Math.PI - Math.acos(cosE);
    b.foreR.rotation.set(elbow, 0, 0);
    b.armR.updateMatrixWorld(true);
    // the hand, as the stick holds it
    _q.setFromRotationMatrix(_m.extractRotation(Mh));
    _q2.setFromRotationMatrix(_m2.extractRotation(b.foreR.matrixWorld)).invert();
    b.handR.quaternion.copy(_q2).multiply(_q);
    b.handR.updateMatrixWorld(true);
  }

  // --- secondary motion: sleeves, beard, skirt -----------------------------------
  simulate(dt) {
    this.cuffStep(dt);
    this.beardStep(dt);
    this.skirtStep(dt);
    this.slideDust(dt);
  }

  // The bell sleeves hang toward the ground from the forearm, lagging its
  // swing.
  cuffStep(dt) {
    const b = this.b;
    for (let s = 0; s < 2; s++) {
      const fore = b[s ? 'foreR' : 'foreL'];
      const cuff = b[s ? 'cuffR' : 'cuffL'];
      _q.setFromRotationMatrix(_m.extractRotation(fore.matrixWorld)).invert();
      const g = _v.copy(this.gravity).normalize().applyQuaternion(_q);
      const S = this.cuffS[s];
      const tx = clamp(Math.atan2(-g.z, -g.y), -1.2, 1.2) * 0.45;
      const tz = clamp(Math.atan2(g.x, -g.y), -1.2, 1.2) * 0.45;
      S.x.v -= this.pelvisD.y * 0.3 + this.pelvisDP.y * 0.8;
      S.z.v += (s ? 1 : -1) * this.pelvisD.x * 0.15;
      const rx = clamp(S.x.step(tx, 2.6, 0.25, dt), -0.5, 0.5);
      const rz = clamp(S.z.step(tz, 2.6, 0.25, dt), -0.5, 0.5);
      cuff.rotation.set(rx, 0, rz);
      cuff.updateMatrixWorld(true);
    }
  }

  // Dust off the stick dragged along the road in a slide.
  slideDust(dt) {
    if (!this.sliding || this.crashed || !this.grounded || this.wet || !this.staffTip) return;
    this.slideDustT = (this.slideDustT || 0) - dt;
    if (this.slideDustT > 0) return;
    this.slideDustT = 0.045 + 0.04 * Math.random();
    this.stickPuff(this.staffTip, 1, 1.1);
  }

  // The long beard. Simulation space has world axes and its origin at the
  // runner. Hair is light in the air and quick to answer every push: it
  // streams back in the headwind, slides off his belly to one side and round
  // him, whips across with a lane change, flies up through a vault.
  beardStep(dt) {
    const cl = this.beard;
    const Q = this.root.quaternion;
    const W = this.speed;
    const { cols, rows } = BEARD;
    const Mh = this.headM.copy(this.boneM('head'));
    const rest = this.beardRest;
    for (let k = 0; k < cols * rows; k++) _v.fromArray(rest, k * 3).applyMatrix4(Mh).applyQuaternion(Q).toArray(cl.skin, k * 3);
    cl.pinB.set(cl.skin.subarray(0, cols * 3));
    setColliders(cl, this.beardDefs, this.boneM, Q, BEARD.margin);
    const f = this.beardWind;
    f.gx = -this.frameAcc.x * 0.3;
    f.gy = Math.min(-3.5, -8.4 - this.frameAcc.y * 0.24);
    f.gz = -this.frameAcc.z * 0.35;
    const B = this.breeze;
    const still = 1 + 1.2 * (1 - Math.min(1, W / 6));
    f.ax = clamp(-this.vx * 0.42, -6, 6) + B.x * (1.1 + 0.03 * W) * still;
    f.ay = clamp(-(this.grounded ? 0 : this.vy) * 0.45, -4, 3) + B.y * still;
    f.az = (W > 0 ? 0.85 * W + 1 : 0) + B.z * still;
    // (only at a run does the headwind part round him strongly enough to
    // push the beard off to one side)
    f.spread = 0.9 * smooth(5, 12, W);
    f.gust = 0.45 * still + 0.12 * W;
    f.gustSpeed = 1.4 + 0.3 * W;
    f.gustLen = 0.45 + 0.01 * W;
    f.curl = 0.5 * still + 0.1 * W;
    this.gusty(f, dt);
    f.kn = 0.5;
    f.kt = 0.16;
    f.damp = 0.6;
    f.floor = Math.min(this.groundY || 0, this.y) - this.y + BEARD.margin;
    f.groundV = W;
    f.t = this.time;
    // carried with a third of the head's own bob: the rest bounces on
    _v.setFromMatrixPosition(this.b.head.matrixWorld).applyQuaternion(Q);
    if (this.simReady) cl.shift((_v.x - this.headPrev.x) * 0.35, (_v.y - this.headPrev.y) * 0.35, (_v.z - this.headPrev.z) * 0.35);
    this.headPrev.copy(_v);
    this.stepSheet(cl, f, (v) => v.applyMatrix4(Mh).applyQuaternion(Q));
    writeSheet(cl, this.beardS.data, this.beardFold, this.invQ);
    this.beardS.tex.needsUpdate = true;
  }

  // The skirt: heavier than the beard - it streams back less and swings
  // more, kicked about by his legs.
  skirtStep(dt) {
    const cl = this.skirt;
    const Q = this.root.quaternion;
    const W = this.speed;
    const { cols, rows } = SKIRT;
    const Mh = this.hipsM.copy(this.boneM('hips'));
    const rest = this.skirtRest;
    for (let k = 0; k < cols * rows; k++) _v.fromArray(rest, k * 3).applyMatrix4(Mh).applyQuaternion(Q).toArray(cl.skin, k * 3);
    cl.pinB.set(cl.skin.subarray(0, cols * 3));
    setColliders(cl, this.skirtDefs, this.boneM, Q, SKIRT.margin);
    const f = this.skirtWind;
    f.gx = -this.frameAcc.x * 0.22;
    f.gy = Math.min(-5, -8.6 - this.frameAcc.y * 0.16);
    f.gz = -this.frameAcc.z * 0.3;
    const B = this.breeze;
    const still = 1 + 1.4 * (1 - Math.min(1, W / 6));
    f.ax = clamp(-this.vx * 0.3, -4.5, 4.5) + B.x * (1.1 + 0.03 * W) * still;
    f.ay = clamp(-(this.grounded ? 0 : this.vy) * 0.38, -3.5, 2.8) + B.y * still;
    f.az = (W > 0 ? 0.72 * W + 1 : 0) + B.z * still;
    f.gust = 0.5 * still + 0.14 * W;
    f.gustSpeed = 1.2 + 0.3 * W;
    f.gustLen = 0.6 + 0.01 * W;
    f.curl = 0.7 * still + 0.16 * W;
    this.gusty(f, 0);
    f.kn = 0.45;
    f.kt = 0.1;
    f.damp = 0.5;
    f.floor = Math.min(this.groundY || 0, this.y) - this.y + SKIRT.margin;
    f.groundV = W;
    f.t = this.time;
    _v.setFromMatrixPosition(this.b.hips.matrixWorld).applyQuaternion(Q);
    if (this.simReady) cl.shift((_v.x - this.hipsPrev.x) * 0.6, (_v.y - this.hipsPrev.y) * 0.6, (_v.z - this.hipsPrev.z) * 0.6);
    this.hipsPrev.copy(_v);
    this.stepSheet(cl, f, (v) => v.applyMatrix4(Mh).applyQuaternion(Q));
    writeSheet(cl, this.skirtS.data, this.skirtFold, this.invQ);
    this.skirtS.tex.needsUpdate = true;
  }

  // picked on the title screen: a gust swells up and sweeps through him
  gusty(f, dt) {
    if (dt > 0 && this.gustT > 0) this.gustT = Math.max(0, this.gustT - dt * 0.7);
    if (this.gustT <= 0) return;
    const g = 4 * this.gustT * (1 - this.gustT);
    f.ax += 3.0 * g;
    f.ay += 1.6 * g;
    f.az += 3.0 * g;
    f.gust += 1.4 * g;
  }

  stepSheet(cl, f, place) {
    if (!this.simReady) {
      cl.place(place);
      cl.pinA.set(cl.pinB);
      cl.skinPrev.set(cl.skin);
      const t = f.t;
      f.t = t - 0.75;
      for (let i = 0; i < 45; i++) {
        f.t += 1 / 60;
        cl.step(1 / 60, f);
      }
      f.t = t;
    } else {
      cl.step(this.lastStep || 1 / 60, f);
    }
  }

  secondary(dt, sp) {
    this.lastStep = dt;
    super.secondary(dt, sp);
  }
}

// The vault's keys (how far through the jump: 0 take-off, 0.5 the top, 1
// landing) for the body (take-off, over, landing)...
const VAULT_T = [0, 0.45, 0.92, 1];
// ...and the stick's lean (rad; > 0 its tip ahead of his hand): planted
// ahead, upright as he goes over it, swept back under him, swung forward to
// meet the road.
const VAULT_STICK_T = [0, 0.18, 0.42, 0.7, 1];
const VAULT_STICK = [0.55, 0.05, -0.85, -0.3, 0.45];

