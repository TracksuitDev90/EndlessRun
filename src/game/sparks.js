import * as THREE from '../../vendor/three/three.module.min.js';
import { makeSparkMaterial } from '../render/shaders.js';

// Sparks off the elder's walking stick: now and then a little poof of them
// from its knob, in the colours of the gems he's been picking up - each a
// twinkling four-pointed glint with a white-hot heart, flung out, drifting
// down and winking out. Like the dust, they're thrown from the runner's own
// space and left behind in the world (track coordinates), so a poof trails
// back off him as he runs. One draw call while any are alight, none
// otherwise.

const MAX = 48;

export class Sparks {
  constructor(env) {
    this.pos = new Float32Array(MAX * 3);
    this.spark = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSpark', new THREE.BufferAttribute(this.spark, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = makeSparkMaterial(env);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
    this.p = Array.from({ length: MAX }, () => ({ live: false, x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, age: 0, life: 1, size: 0.05, seed: 0, r: 1, g: 1, b: 1 }));
    // (what's been thrown since the last update, in preallocated slots)
    this.queue = Array.from({ length: MAX }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), size: 0, r: 1, g: 1, b: 1 }));
    this.queued = 0;
    this.next = 0;
  }

  // A spark at p moving at v (both in the runner's space), size m across,
  // colour c ([r, g, b], 0..1).
  emit(p, v, size, c) {
    if (this.queued >= MAX) return;
    const q = this.queue[this.queued++];
    q.p.copy(p);
    q.v.copy(v);
    q.size = size;
    q.r = c[0];
    q.g = c[1];
    q.b = c[2];
  }

  update(dt, root, z, dist) {
    for (let i = 0; i < this.queued; i++) {
      const q = this.queue[i];
      const it = this.p[this.next];
      this.next = (this.next + 1) % MAX;
      const w = q.p.applyQuaternion(root.quaternion).add(root.position);
      const v = q.v.applyQuaternion(root.quaternion);
      it.live = true;
      it.x = w.x;
      it.y = w.y;
      it.d = dist - (w.z - z);
      it.vx = v.x;
      it.vy = v.y;
      it.vd = -v.z;
      it.age = 0;
      it.seed = Math.random();
      it.life = 0.45 + 0.4 * it.seed;
      it.size = q.size * (0.75 + 0.5 * Math.random());
      it.r = q.r;
      it.g = q.g;
      it.b = q.b;
    }
    this.queued = 0;
    let n = 0;
    for (const it of this.p) {
      if (!it.live) continue;
      it.age += dt;
      // the still air stops them quickly; they drift down as they fade
      const k = Math.exp(-3.2 * dt);
      it.vx *= k;
      it.vd *= k;
      it.vy = it.vy * k - 1.6 * dt;
      it.x += it.vx * dt;
      it.y = Math.max(0.03, it.y + it.vy * dt);
      it.d += it.vd * dt;
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 14) {
        it.live = false;
        continue;
      }
      this.pos[n * 3] = it.x;
      this.pos[n * 3 + 1] = it.y;
      this.pos[n * 3 + 2] = z - (it.d - dist);
      // (a flash as it's flung out, then winking down to nothing)
      this.spark[n * 3] = it.size * (1 - 0.55 * u);
      this.spark[n * 3 + 1] = Math.min(1, u * 14) * Math.pow(1 - u, 1.4);
      this.spark[n * 3 + 2] = it.seed;
      this.col[n * 3] = it.r;
      this.col[n * 3 + 1] = it.g;
      this.col[n * 3 + 2] = it.b;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSpark.needsUpdate = true;
      geo.attributes.aCol.needsUpdate = true;
    }
  }

  clear() {
    this.queued = 0;
    for (const it of this.p) it.live = false;
    this.points.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }

  // drawn once at warm-up so its shader is compiled before the run
  forCompile(on) {
    this.points.visible = on;
    this.points.geometry.setDrawRange(0, on ? 1 : 0);
  }
}
