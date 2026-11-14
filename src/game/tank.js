import * as THREE from '../../vendor/three/three.module.min.js';
import { makeTankMaterials } from '../render/shaders.js';
import { TAU, clamp, Spring } from './rig.js';

// The aquarium on the fisherman's back (the cap, the base and the straps
// are sculpted: tools/runner/fisher.py; this is what's inside them). Drawn
// on the tank's bone, in its own space (its middle at the origin):
//   - the water: the far side of it seen through the glass (the inside of a
//     cylinder, drawn from the inside), aqua, deeper toward the bottom,
//     ripples of light wandering over it; its surface a disc near the top
//     that tips against his every push, stop and turn and settles again,
//     rocking a little as it does;
//   - the glass: a clear skin over all of it, a sheen toward its edges and a
//     couple of bright streaks down it where it catches the light;
//   - bubbles now and then, wobbling up from the bottom and gone at the
//     surface;
//   - the goldfish (sculpted, on bones of its own: this only moves them):
//     swimming round and round the tank - its speed, its height and how far
//     out it swims all wandering, now and then turning round to swim the
//     other way - turning along its path, banking into its turns, its tail
//     beating faster when it hurries, its body flexing with it.

const BUBBLES = 10;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const FWD = new THREE.Vector3(0, 0, -1);

export class Tank {
  // T: the tank's dimensions from the rig (r: the glass's radius, half: half
  // its height); bones: the runner's bones (tank, goldfish, goldTail).
  constructor(env, T, bones) {
    this.T = T;
    this.b = bones;
    const r = T.r, h = T.half;
    // (the water's surface, below the top of the glass)
    this.level = h - 0.02;
    const mats = makeTankMaterials(env, new THREE.Vector4(r, h, this.level, 0));
    this.mats = mats;
    this.group = new THREE.Group();
    this.group.name = 'tank';
    // the far side of the water, seen from inside
    const wall = new THREE.CylinderGeometry(r - 0.002, r - 0.002, 2 * h, 28, 1, true);
    this.wall = new THREE.Mesh(wall, mats.water);
    this.wall.renderOrder = -19;
    // its surface
    const disc = new THREE.CircleGeometry(r - 0.003, 28);
    disc.rotateX(-Math.PI / 2);
    this.surface = new THREE.Mesh(disc, mats.surface);
    this.surface.renderOrder = -19;
    this.surface.position.y = this.level;
    this.surface.userData.noCast = true;
    // the glass
    const glass = new THREE.CylinderGeometry(r + 0.0015, r + 0.0015, 2 * h + 0.004, 32, 1, true);
    this.glass = new THREE.Mesh(glass, mats.glass);
    this.glass.renderOrder = 7;
    this.glass.userData.noCast = true;
    // bubbles
    this.bpos = new Float32Array(BUBBLES * 3);
    this.bsize = new Float32Array(BUBBLES);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.bpos, 3).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('aSize', new THREE.BufferAttribute(this.bsize, 1).setUsage(THREE.DynamicDrawUsage));
    bg.setDrawRange(0, 0);
    this.bubbles = new THREE.Points(bg, mats.bubble);
    this.bubbles.renderOrder = 6;
    this.bubbles.frustumCulled = false;
    this.bubbles.visible = false;
    this.bub = Array.from({ length: BUBBLES }, () => ({ live: false, x: 0, y: 0, z: 0, vy: 0, r: 0.002, ph: 0, age: 0 }));
    for (const m of [this.wall, this.surface, this.glass]) m.frustumCulled = false;
    this.group.add(this.wall, this.surface, this.bubbles, this.glass);
    bones.tank.add(this.group);
    // the water's tip (slopes across x and z), and how it rocks
    this.tipX = new Spring();
    this.tipZ = new Spring();
    this.tank = new THREE.Matrix4();
    this.goldBind = new THREE.Vector3(); // (set on first step: the goldfish's bind relative to the tank)
    this.reset();
  }

  reset() {
    this.tipX.reset();
    this.tipZ.reset();
    // the goldfish: where it is round the tank (angle), which way it's
    // going, how fast, how high and how far out
    this.ang = Math.random() * TAU;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.turnT = 4 + 6 * Math.random();
    this.turning = 0;
    this.speed = 1;
    this.beat = 0;
    this.heading = null;
    this.bank = 0;
    this.bubbleT = 0.5 + Math.random();
    for (const B of this.bub || []) B.live = false;
    this.slosh = 0;
  }

  // drawn once at warm-up so their shaders are compiled before the run
  forCompile(on) {
    this.bubbles.visible = on;
    this.bubbles.geometry.setDrawRange(0, on ? 1 : 0);
  }

  // t: the runner's clock; acc: their acceleration (runner space);
  // run: how fast they're running (0 stood about).
  step(dt, t, acc, run) {
    if (dt <= 0) return;
    // --- the water tips against his accelerations (a slope, held toward
    // what they push it to) and rocks back level
    const ax = clamp(acc.x, -40, 40), az = clamp(acc.z, -40, 40), ay = clamp(acc.y, -40, 40);
    const g = 9.8 + Math.max(-6, ay * 0.3);
    const sx = this.tipX.step(clamp(-ax / g, -0.6, 0.6) * 0.5, 1.6, 0.18, dt);
    const sz = this.tipZ.step(clamp(-az / g, -0.6, 0.6) * 0.5 + 0.04 * Math.sin(t * 2.2) * Math.min(1, run / 10), 1.4, 0.18, dt);
    this.slosh = Math.min(1, Math.abs(this.tipX.v) * 0.6 + Math.abs(this.tipZ.v) * 0.6 + 0.15);
    const W = this.mats.water.uniforms.uWater.value;
    W.set(clamp(sx, -0.3, 0.3), clamp(sz, -0.3, 0.3), this.level, this.slosh);
    this.mats.surface.uniforms.uWater.value.copy(W);
    this.surface.rotation.set(Math.atan(W.y), 0, -Math.atan(W.x));
    this.surface.position.y = this.level;
    this.swim(dt, t);
    this.bubbleStep(dt, t);
  }

  // The goldfish swims round the tank.
  swim(dt, t) {
    const T = this.T;
    // now and then it turns round and swims back the other way (easing
    // its speed through the turn rather than reversing on the spot)
    this.turnT -= dt;
    if (this.turnT <= 0 && this.turning === 0) {
      this.turning = 1;
      this.turnT = 5 + 8 * Math.random();
    }
    if (this.turning > 0) {
      this.turning = Math.max(0, this.turning - dt / 1.1);
      if (this.turning < 0.5 && this.turnFlip !== true) {
        this.dir = -this.dir;
        this.turnFlip = true;
      }
      if (this.turning === 0) this.turnFlip = false;
    }
    // (its pace wanders: a lazy glide, then a little burst)
    const burst = Math.pow(0.5 + 0.5 * Math.sin(t * 0.53 + 1.7 * Math.sin(t * 0.23)), 3);
    const slow = this.turning > 0 ? Math.abs(1 - 2 * this.turning) : 1;
    const v = (0.075 + 0.11 * burst) * (0.35 + 0.65 * slow);
    this.speed = v;
    const rad = T.r * (0.42 + 0.14 * Math.sin(t * 0.31 + 0.6) + 0.08 * Math.sin(t * 0.83));
    this.ang += (this.dir * v * dt) / Math.max(0.02, rad);
    const y = T.half * (0.42 * Math.sin(t * 0.37) + 0.18 * Math.sin(t * 0.91 + 1.3)) - 0.012;
    // where it is (tank space), and where it's going
    const P = _v.set(Math.cos(this.ang) * rad, y, Math.sin(this.ang) * rad);
    // (through a turn it swings its nose round across the middle)
    const tang = _v2.set(-Math.sin(this.ang) * this.dir, 0, Math.cos(this.ang) * this.dir);
    if (this.turning > 0) {
      const k = Math.sin(Math.PI * this.turning);
      tang.addScaledVector(_s.set(-Math.cos(this.ang), 0, -Math.sin(this.ang)), 1.6 * k);
    }
    // (rising and sinking, it tips up and down)
    tang.y = (T.half * (0.42 * 0.37 * Math.cos(t * 0.37) + 0.18 * 0.91 * Math.cos(t * 0.91 + 1.3))) / Math.max(0.03, v);
    tang.y = clamp(tang.y * 0.35, -0.5, 0.5);
    tang.normalize();
    _q.setFromUnitVectors(FWD, tang);
    // banking into its turn, its body flexing with its tail
    const lean = clamp(this.dir * 0.25 * (1 - this.turning), -0.35, 0.35);
    this.bank += (lean - this.bank) * Math.min(1, dt * 3);
    _q.multiply(_q2.setFromAxisAngle(FWD, -this.bank));
    if (!this.heading) this.heading = _q.clone();
    // (it turns along its path smoothly, never snapping)
    this.heading.slerp(_q, Math.min(1, dt * 6));
    this.beat += dt * TAU * (2.2 + 9 * v);
    const wag = Math.sin(this.beat);
    _q2.setFromAxisAngle(_s.set(0, 1, 0), wag * 0.12);
    _q.copy(this.heading).multiply(_q2);
    // onto its bone (runner space): the tank's frame, then where it swims
    const b = this.b;
    _m.compose(P, _q, _s.set(1, 1, 1));
    _m2.multiplyMatrices(b.tank.matrixWorld, _m);
    _m2.decompose(b.goldfish.position, b.goldfish.quaternion, _s);
    b.goldfish.updateMatrix();
    b.goldfish.matrixWorld.copy(b.goldfish.matrix);
    // its tail beats (the more it hurries, the harder)
    b.goldTail.rotation.set(0, -wag * (0.45 + 1.4 * v), 0);
    b.goldTail.updateMatrix();
    b.goldTail.matrixWorld.multiplyMatrices(b.goldfish.matrixWorld, b.goldTail.matrix);
    this.fishAt = P;
  }

  // A bubble now and then (sometimes two or three in a string), wobbling up
  // from near the bottom - or off the goldfish - and gone at the surface.
  bubbleStep(dt, t) {
    const T = this.T;
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      const n = Math.random() < 0.3 ? 3 : 1;
      const fromFish = Math.random() < 0.35 && this.fishAt;
      for (let k = 0; k < n; k++) {
        const B = this.bub.find((q) => !q.live);
        if (!B) break;
        B.live = true;
        const a = Math.random() * TAU, rr = T.r * 0.65 * Math.sqrt(Math.random());
        if (fromFish) B.x = this.fishAt.x, B.z = this.fishAt.z, B.y = this.fishAt.y + 0.01 - k * 0.012;
        else (B.x = Math.cos(a) * rr), (B.z = Math.sin(a) * rr), (B.y = -T.half + 0.01 - k * 0.014);
        B.r = 0.0028 + 0.0028 * Math.random();
        B.vy = 0.07 + 0.05 * Math.random();
        B.ph = Math.random() * TAU;
        B.age = 0;
      }
      this.bubbleT = 0.8 + 2.4 * Math.random();
    }
    let n = 0;
    for (const B of this.bub) {
      if (!B.live) continue;
      B.age += dt;
      B.vy = Math.min(0.2, B.vy + dt * 0.08);
      B.y += B.vy * dt;
      const wob = 0.004 * Math.sin(B.age * 14 + B.ph);
      if (B.y > this.level - 0.004) {
        B.live = false;
        continue;
      }
      this.bpos[n * 3] = B.x + wob;
      this.bpos[n * 3 + 1] = Math.max(-T.half + 0.004, B.y);
      this.bpos[n * 3 + 2] = B.z + wob * 0.6;
      this.bsize[n] = B.r * 2 * Math.min(1, B.age * 8);
      n++;
    }
    const geo = this.bubbles.geometry;
    geo.setDrawRange(0, n);
    this.bubbles.visible = n > 0;
    if (n > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    }
  }
}
