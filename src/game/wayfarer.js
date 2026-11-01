import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials } from '../render/shaders.js';
import { clamp, Spring } from './rig.js';
import { Cloth } from './cloth.js';
import { palette, setColliders, sheetGeometry, writeSheet } from './kit.js';
import { COL, CAPE, capeBind, capeColliders } from './outfit.js';
import { Player, C, mirror } from './player.js';

// The wayfarer: a young wayfarer in a hooded cape (outfit.js), steady and
// sure-footed. On top of the shared runner (player.js):
//   - the cape is a cloth simulation (cloth.js): sewn under the collar, held
//     to the shoulders by a leash that loosens down the back, kept off the
//     body by its own volumes, streaming back in the headwind, swayed by a
//     shifting breeze and lagging every lane change, take-off and landing;
//   - curls bounce on springs; the hip pouch is a pendulum, its flap lifting;
//   - he leaps with the lead leg alternating, arms out like wings coming down,
//     and slides feet first, leaning back, a hand trailing on the floor.

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

export class Wayfarer extends Player {
  constructor(envDef, asset) {
    super(envDef, asset, {});
  }

  buildLook() {
    const R = this.rig;
    const rig = [
      new THREE.Vector4(R.sockY, R.bootX, R.cuffU, R.shortsHem),
      new THREE.Vector4(R.bootCollar[0], R.bootCollar[1], R.soleH, 0),
    ];
    // the cape's particles, as the shader reads them (runner space)
    this.capeData = new Float32Array(CAPE.cols * CAPE.rows * 4);
    this.capeTex = new THREE.DataTexture(this.capeData, CAPE.cols, CAPE.rows, THREE.RGBAFormat, THREE.FloatType);
    this.capeTex.magFilter = this.capeTex.minFilter = THREE.NearestFilter;
    this.capeTex.needsUpdate = true;
    const grid = new THREE.Vector4(CAPE.cols, CAPE.rows, CAPE.thick / 2, 0);
    const mats = makeCharacterMaterials(this.u, palette(COL), rig, 0.0105, { texture: this.capeTex, grid });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.capeMat = mats.capeMat;
    this.capeInkMat = mats.capeInk;
    this.buildBody();
    this.buildCape();
  }

  // The cape: its rest drape settles onto the body as bound, then the render
  // mesh is laid out over that.
  buildCape() {
    this.capeDefs = capeColliders(this.rig, this.bindPos);
    this.capeRest = capeBind(this.rig, this.capeDefs);
    const geo = sheetGeometry(CAPE, this.capeRest, this.asset.meta.materials.cape);
    this.capeMesh = new THREE.Mesh(geo, this.capeMat);
    this.capeInk = new THREE.Mesh(geo, this.capeInkMat);
    for (const m of [this.capeMesh, this.capeInk]) {
      m.frustumCulled = false;
      m.renderOrder = -20;
      this.root.add(m);
    }
  }

  buildSim() {
    super.buildSim();
    // the cape: row 0 sewn under the collar; the rows over the shoulders and
    // under the hood leashed to where the chest would carry them, tightly at
    // first and looser by the shoulder blades; free from there down
    const { cols, rows } = CAPE;
    this.cloth = new Cloth(cols, rows, this.capeRest);
    let s = 0;
    for (let j = 1; j < rows; j++) {
      const a = ((j - 1) * cols + (cols >> 1)) * 3, b = (j * cols + (cols >> 1)) * 3;
      s += Math.hypot(this.capeRest[a] - this.capeRest[b], this.capeRest[a + 1] - this.capeRest[b + 1], this.capeRest[a + 2] - this.capeRest[b + 2]);
      this.cloth.leash[j] = s < 0.3 ? 0.003 + 3 * Math.max(0, s - 0.08) ** 2 : Infinity;
    }
    this.cloth.setColliderCount(this.capeDefs.length);
    this.capeFold = new Float32Array(cols * rows);
    this.wind = { gx: 0, gy: 0, gz: 0, ax: 0, ay: 0, az: 0, wake: 0.2, draw: 0.7, gust: 0, gustSpeed: 1, gustLen: 1, curl: 0, kn: 0, kt: 0, damp: 0.4, floor: 0, lift: 0.1, t: 0 };

    this.pouchSim = {
      local: new THREE.Vector3(...this.rig.pouch).sub(this.bindPos.hips),
      len: 0.05,
      p: new THREE.Vector3(),
      q: new THREE.Vector3(),
      vy: 0,
    };
    this.lid = new Spring();
    this.anchor = new THREE.Vector3();
    this.hipsInv = new THREE.Matrix4();
    this.chestM = new THREE.Matrix4();
    this.chestPrev = new THREE.Vector3();
  }

  resetSim() {
    super.resetSim();
    const ps = this.pouchSim;
    const P = this.rig.pouch;
    ps.p.set(P[0] - 0.01, P[1] - ps.len, P[2]);
    ps.q.copy(ps.p);
    ps.vy = 0;
    this.lid.reset();
    this.gustT = 0;
    this.cloth.collidersMoved = false;
  }

  // Leap on the way up (lead leg alternates), reaching for the ground on the
  // way down with arms out like wings.
  poseJump(j) {
    const fall = clamp(-this.vy / this.V0 + 0.35, 0, 1);
    const fs = fall * fall * (3 - 2 * fall);
    const m = (a, b) => a + (b - a) * fs;
    j[C.hipY] = this.HIP_Y;
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

  // --- secondary motion: pouch, cape ----------------------------------------------
  simulate(dt, steps, sp) {
    this.pouchStep(dt, steps, sp);
    this.capeSim(dt);
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
  // runner's own speed (the cape streams back further as it grows) plus the
  // breeze; the gusts that roll down it strengthen and quicken with speed.
  capeSim(dt) {
    const cl = this.cloth;
    const Q = this.root.quaternion;
    const t = this.time;
    const W = this.speed;
    const { cols, rows } = CAPE;
    // where the chest carries every particle (the collar seam exactly; the
    // rest is leashed to it), in simulation space
    const Mc = this.chestM.copy(this.boneM('chest'));
    const rest = this.capeRest;
    for (let k = 0; k < cols * rows; k++) {
      _v.fromArray(rest, k * 3).applyMatrix4(Mc).applyQuaternion(Q).toArray(cl.skin, k * 3);
    }
    cl.pinB.set(cl.skin.subarray(0, cols * 3));
    setColliders(cl, this.capeDefs, this.boneM, Q, CAPE.margin);
    // forces: gravity, a share of the runner's own acceleration (the game's
    // gravity is ~3x real, so only part of a jump's reaches the cloth: it
    // lifts and floats rather than flags), and the air
    const f = this.wind;
    // (Wool with some weight: most of gravity's pull, and never less than
    // half of it however a jump falls — the cape rises behind on the way
    // down, but it still hangs.)
    f.gx = -this.frameAcc.x * 0.22;
    f.gy = Math.min(-5, -8 - this.frameAcc.y * 0.14);
    f.gz = -this.frameAcc.z * 0.3;
    // The headwind the cape feels grows slower than the run speed: it streams
    // back further as the pace rises; gusts roll down it in broad, irregular
    // waves, and each free edge plays on its own. Standing still, the breeze
    // is all there is: it gets a stronger hand.
    const B = this.breeze;
    const still = 1 + 1.4 * (1 - Math.min(1, W / 6));
    f.ax = clamp(-this.vx * 0.32, -4.5, 4.5) + B.x * (1.2 + 0.03 * W) * still;
    f.ay = clamp(-(this.grounded ? 0 : this.vy) * 0.35, -3.5, 2.5) + B.y * still;
    f.az = (W > 0 ? 1.05 * W + 1 : 0) + B.z * still;
    f.gust = 0.6 * still + 0.18 * W;
    f.gustSpeed = 1.2 + 0.32 * W;
    f.gustLen = 0.75 + 0.012 * W;
    f.curl = 0.8 * still + 0.18 * W;
    // picked on the title screen: a gust swells up and sweeps the cape aside
    if (this.gustT > 0) {
      this.gustT = Math.max(0, this.gustT - dt * 0.7);
      const g = 4 * this.gustT * (1 - this.gustT);
      f.ax += 3.2 * g;
      f.ay += 2.2 * g;
      f.az += 3.5 * g;
      f.gust += 1.5 * g;
    }
    f.kn = 0.5;
    f.kt = 0.1;
    f.damp = 0.5;
    // (the ground under him, but never above his feet: brushing past the
    // top of something he isn't standing on must not lift the cloth)
    f.floor = Math.min(this.groundY || 0, this.y) - this.y + CAPE.margin;
    f.groundV = W;
    f.lift = 0.1;
    f.t = t;
    // Carry the cloth along with most of the body's own bob and sway: the
    // stride bounces the shoulders at several g, which real wool would partly
    // soak up — the rest rolls on down the cape as a ripple.
    _v.setFromMatrixPosition(this.b.chest.matrixWorld).applyQuaternion(Q);
    if (this.simReady) cl.shift((_v.x - this.chestPrev.x) * 0.65, (_v.y - this.chestPrev.y) * 0.65, (_v.z - this.chestPrev.z) * 0.65);
    this.chestPrev.copy(_v);
    if (!this.simReady) {
      // start from the rest drape, carried by the body, and let it settle
      cl.place((v) => v.applyMatrix4(Mc).applyQuaternion(Q));
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
    writeSheet(cl, this.capeData, this.capeFold, this.invQ);
    this.capeTex.needsUpdate = true;
  }

  // Picked on the title screen: a gust catches the cape.
  greet() {
    this.gustT = 1;
  }
}
