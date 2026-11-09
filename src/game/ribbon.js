import * as THREE from '../../vendor/three/three.module.min.js';
import { makeRibbonMaterial } from '../render/shaders.js';

// Ribbons of water whipping off the samurai as he moves - a water bender's
// trails: off his hands as he sweeps them through a dash or a leap, off the
// point of his blade as it cuts. Each is a trail of points left behind
// whatever it follows (a point on him, in the runner's space, read every
// frame), carried on with a share of his own speed (so a cut's arc keeps its
// shape and only slowly streams back) and thinning away from its head; the
// GPU turns each stretch of it to face you and draws it as flowing water.
// Points are kept in track coordinates (x, y and how far along the run), as
// the dust is, so they're left behind in the world. One draw call, and none
// at all while nothing's flowing.

const MAX = 6; // ribbons at once
const PTS = 24; // points kept down each
const SUB = 3; // drawn between each two (a smooth curve through them)
const RPTS = (PTS - 1) * SUB + 1; // drawn down each

const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Ribbons {
  constructor(env) {
    const n = MAX * RPTS * 2;
    this.pos = new Float32Array(n * 3);
    this.tan = new Float32Array(n * 3);
    this.info = new Float32Array(n * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aTan', new THREE.BufferAttribute(this.tan, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRib', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < MAX; r++) {
      for (let i = 0; i < RPTS - 1; i++) {
        const a = (r * RPTS + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.material = makeRibbonMaterial(env);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.userData.noCast = true;
    this.ribbons = Array.from({ length: MAX }, () => ({
      live: false,
      on: false,
      src: null,
      at: new THREE.Vector3(),
      width: 0.05,
      life: 0.4,
      carry: 0.9,
      t: 0,
      dur: 0,
      seed: 0,
      n: 0,
      // points, newest first: x, y, d, vx, vy, vd, age
      p: Array.from({ length: PTS }, () => ({ x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, age: 0 })),
    }));
    this.next = 0;
    this._w = new THREE.Vector3();
    this._c = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._o = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  // A point down a ribbon (k: 0 its head .. n - 1 its tail, fractional),
  // on a Catmull-Rom curve through its points, in scene space; and the
  // way it runs there.
  curve(R, k, z, dist, out, tan) {
    const n = R.n;
    const i = Math.min(n - 2, Math.floor(k));
    const f = k - i;
    const c = this._c;
    for (let j = 0; j < 4; j++) {
      const P = R.p[clampI(i - 1 + j, 0, n - 1)];
      c[j].set(P.x, P.y, z - (P.d - dist));
    }
    // (past either end the curve runs on straight)
    if (i === 0) c[0].copy(c[1]).multiplyScalar(2).sub(c[2]);
    if (i + 2 >= n) c[3].copy(c[2]).multiplyScalar(2).sub(c[1]);
    const f2 = f * f, f3 = f2 * f;
    const w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1, w2 = -1.5 * f3 + 2 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
    out.set(0, 0, 0).addScaledVector(c[0], w0).addScaledVector(c[1], w1).addScaledVector(c[2], w2).addScaledVector(c[3], w3);
    const d0 = -1.5 * f2 + 2 * f - 0.5, d1 = 4.5 * f2 - 5 * f, d2 = -4.5 * f2 + 4 * f + 0.5, d3 = 1.5 * f2 - f;
    tan.set(0, 0, 0).addScaledVector(c[0], d0).addScaledVector(c[1], d1).addScaledVector(c[2], d2).addScaledVector(c[3], d3);
    const l = tan.length();
    if (l > 1e-6) tan.multiplyScalar(-1 / l);
    else tan.set(0, 1, 0);
    return out;
  }

  // Start a ribbon following src (a function writing the point it flows
  // from into a vector, in the runner's space; null when it's gone) for dur
  // seconds: how wide it is at its head (m), how long each stretch of it
  // lasts (s), and how much of the runner's speed it keeps (0..1).
  start(src, dur, width = 0.05, life = 0.36, carry = 0.9) {
    const R = this.ribbons[this.next];
    this.next = (this.next + 1) % MAX;
    R.live = true;
    R.on = true;
    R.src = src;
    R.dur = dur;
    R.t = 0;
    R.width = width;
    R.life = life;
    R.carry = carry;
    R.n = 0;
    R.seed = Math.random();
    return R;
  }

  // root: the runner's root (where they are, which way they face); z: where
  // they stand along the scene's z; dist: how far they have run; vel: their
  // velocity (x, y, -speed).
  update(dt, root, z, dist, vel) {
    let any = false;
    let n = 0;
    for (const R of this.ribbons) {
      if (!R.live) continue;
      R.t += dt;
      if (R.on && R.t >= R.dur) R.on = false;
      // age and carry on what's there
      let alive = 0;
      for (let i = 0; i < R.n; i++) {
        const P = R.p[i];
        P.age += dt;
        P.x += P.vx * dt;
        P.y += P.vy * dt;
        P.d += P.vd * dt;
        if (P.age < R.life) alive = i + 1;
      }
      R.n = alive;
      // a fresh point at the head (the oldest drops off the end)
      if (R.on && R.src && R.src(R.at)) {
        const w = this._w.copy(R.at).applyQuaternion(root.quaternion).add(root.position);
        const last = R.p[PTS - 1];
        for (let i = PTS - 1; i > 0; i--) R.p[i] = R.p[i - 1];
        R.p[0] = last;
        last.x = w.x;
        last.y = w.y;
        last.d = dist - (w.z - z);
        last.vx = vel.x * R.carry;
        last.vy = vel.y * R.carry * 0.5;
        last.vd = -vel.z * R.carry;
        last.age = 0;
        R.n = Math.min(PTS, R.n + 1);
      }
      if (!R.on && R.n === 0) {
        R.live = false;
        continue;
      }
      if (R.n < 2) continue;
      any = true;
      // (a ribbon only just started is only a short one: it grows to its
      // full width as it gets its length, rather than flashing out as a blob)
      let len = 0;
      for (let i = 1; i < R.n; i++) len += Math.hypot(R.p[i].x - R.p[i - 1].x, R.p[i].y - R.p[i - 1].y, R.p[i].d - R.p[i - 1].d);
      const grow = Math.min(1, len / 0.45);
      // write it out: a smooth curve through its points (the unused end
      // collapsed onto its tail, invisible)
      const base = n * RPTS * 2;
      const last = (R.n - 1) * SUB;
      for (let i = 0; i < RPTS; i++) {
        const live = i <= last;
        const k = Math.min(i, last) / SUB;
        this.curve(R, k, z, dist, this._o, this._t);
        const k0 = Math.floor(k), kf = k - k0;
        const age = R.p[k0].age + (R.p[Math.min(R.n - 1, k0 + 1)].age - R.p[k0].age) * kf;
        const u = last > 0 ? Math.min(i, last) / last : 0;
        const fade = Math.max(0, 1 - age / R.life);
        // (a crescent: fine at its head, fullest a third of the way down,
        // thinning away to its tail)
        const prof = Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.95)), 0.7) * (1 - 0.35 * u);
        for (let s = 0; s < 2; s++) {
          const v = base + i * 2 + s;
          this.pos[v * 3] = this._o.x;
          this.pos[v * 3 + 1] = this._o.y;
          this.pos[v * 3 + 2] = this._o.z;
          this.tan[v * 3] = this._t.x;
          this.tan[v * 3 + 1] = this._t.y;
          this.tan[v * 3 + 2] = this._t.z;
          // x side, y how far down it (0 its head .. 1 its tail), z how much
          // of it is left, w its width here (m)
          this.info[v * 4] = s ? 1 : -1;
          this.info[v * 4 + 1] = u + R.seed * 7;
          this.info[v * 4 + 2] = live ? fade : 0;
          this.info[v * 4 + 3] = R.width * prof * grow * (0.4 + 0.6 * Math.min(1, fade * 1.5));
        }
      }
      n++;
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, n * (RPTS - 1) * 6);
    this.mesh.visible = any;
    if (any) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aTan.needsUpdate = true;
      geo.attributes.aRib.needsUpdate = true;
    }
  }

  // stop them all following (they fade out where they are)
  release() {
    for (const R of this.ribbons) R.on = false;
  }

  clear() {
    for (const R of this.ribbons) {
      R.live = false;
      R.on = false;
      R.n = 0;
    }
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  // drawn once at warm-up so its shader is compiled before the run
  forCompile(on) {
    this.mesh.visible = on;
    this.mesh.geometry.setDrawRange(0, on ? 6 : 0);
  }
}
