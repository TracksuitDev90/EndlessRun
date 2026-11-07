import * as THREE from '../../vendor/three/three.module.min.js';
import { makeSeedMaterial } from '../render/shaders.js';

// Dandelion seeds blown off the bunny's giant clock: a few streaming off it
// as he floats down on it, the rest in a puff when he lands. Each is a tuft
// of fine white hairs on a stalk with the seed at its foot, turning as it
// drifts. Like the sparks and the dust they're thrown from the runner's own
// space and left behind in the world (track coordinates), so they hang in
// the air as he runs on out from under them, drifting down slowly, rocking
// and turning in the air. One draw call while any are aloft, none otherwise.

const MAX = 72;

export class Seeds {
  constructor(env) {
    this.pos = new Float32Array(MAX * 3);
    this.seed = new Float32Array(MAX * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = makeSeedMaterial(env);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    this.p = Array.from({ length: MAX }, () => ({ live: false, x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, age: 0, life: 1, size: 0.05, turn: 0, rate: 0, ph: 0 }));
    this.queue = Array.from({ length: MAX }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), size: 0 }));
    this.queued = 0;
    this.next = 0;
  }

  // A seed at p moving at v (both in the runner's space), size m across.
  emit(p, v, size) {
    if (this.queued >= MAX) return;
    const q = this.queue[this.queued++];
    q.p.copy(p);
    q.v.copy(v);
    q.size = size;
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
      it.life = 1.8 + 1.4 * Math.random();
      it.size = q.size * (0.8 + 0.4 * Math.random());
      it.turn = Math.random() * 6.28;
      it.rate = (Math.random() - 0.5) * 5;
      it.ph = Math.random() * 6.28;
    }
    this.queued = 0;
    let n = 0;
    for (const it of this.p) {
      if (!it.live) continue;
      it.age += dt;
      // the air takes them at once: they slow, then sink slowly, rocking
      const k = Math.exp(-4.5 * dt);
      it.vx *= k;
      it.vd *= k;
      it.vy += (-0.35 - it.vy) * (1 - Math.exp(-3 * dt));
      it.x += (it.vx + 0.18 * Math.sin(it.age * 2.1 + it.ph)) * dt;
      it.y = Math.max(0.05, it.y + it.vy * dt);
      it.d += it.vd * dt;
      it.turn += it.rate * dt;
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 16) {
        it.live = false;
        continue;
      }
      this.pos[n * 3] = it.x;
      this.pos[n * 3 + 1] = it.y;
      this.pos[n * 3 + 2] = z - (it.d - dist);
      this.seed[n * 4] = it.size;
      this.seed[n * 4 + 1] = Math.min(1, u * 10) * (1 - Math.pow(u, 3));
      this.seed[n * 4 + 2] = it.turn + 0.4 * Math.sin(it.age * 3 + it.ph);
      this.seed[n * 4 + 3] = it.ph;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSeed.needsUpdate = true;
    }
  }

  clear() {
    this.queued = 0;
    for (const it of this.p) it.live = false;
    this.points.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }

  forCompile(on) {
    this.points.visible = on;
    this.points.geometry.setDrawRange(0, on ? 1 : 0);
  }
}
