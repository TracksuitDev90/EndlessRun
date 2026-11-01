import * as THREE from '../../vendor/three/three.module.min.js';
import { makeDustMaterial } from '../render/shaders.js';

// Dust kicked up off the road - by Wren's slides, and by Rowan's boots as he
// pounds along and lands: puffs that bloom out, drift and thin away, and
// specks of grit flung up that fall back. Like the backpack's spill they're
// thrown from the runner's own space and left behind in the world (track
// coordinates: x, y and how far along the run), so a slide leaves a trail of
// them streaming back past the camera. One draw call, and none at all while
// the air is clear. (The same points can be water instead: drops flung up
// and spray, splashing through the surf in the Gallery's sands.)

const MAX = 40;

export class Dust {
  constructor(env) {
    this.pos = new Float32Array(MAX * 3);
    this.dust = new Float32Array(MAX * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aDust', new THREE.BufferAttribute(this.dust, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = makeDustMaterial(env);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.visible = false;
    this.p = Array.from({ length: MAX }, () => ({ live: false, kind: 0, falls: false, x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, age: 0, life: 1, size: 0.3, grow: 1, alpha: 1, seed: 0 }));
    // (what's been thrown since the last update, in preallocated slots: no
    // garbage however much dust flies)
    this.queue = Array.from({ length: MAX }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), size: 0, kind: 0, alpha: -1, life: 1, grow: 1 }));
    this.queued = 0;
    this.next = 0;
  }

  // A puff (grit: false) or a speck of grit (true) at p, moving at v, both
  // in the runner's space; size in metres as it starts. grit 2 is a drop of
  // water instead (flung up and falling like grit), 3 a burst of spray (a
  // puff of it). Optionally, for a puff: alpha (how thick it is; < 0 the
  // default), and scales on how long it lasts (life) and how far it blooms
  // (grow).
  emit(p, v, size, grit = false, alpha = -1, life = 1, grow = 1) {
    if (this.queued >= MAX) return;
    const q = this.queue[this.queued++];
    q.p.copy(p);
    q.v.copy(v);
    q.size = size;
    q.kind = grit === true ? 1 : grit === false ? 0 : grit;
    q.alpha = alpha;
    q.life = life;
    q.grow = grow;
  }

  update(dt, root, z, dist) {
    for (let i = 0; i < this.queued; i++) {
      const q = this.queue[i];
      const it = this.p[this.next];
      this.next = (this.next + 1) % MAX;
      const w = q.p.applyQuaternion(root.quaternion).add(root.position);
      const v = q.v.applyQuaternion(root.quaternion);
      it.live = true;
      it.kind = q.kind;
      it.falls = q.kind === 1 || q.kind === 2;
      it.x = w.x;
      it.y = w.y;
      it.d = dist - (w.z - z);
      it.vx = v.x;
      it.vy = v.y;
      it.vd = -v.z;
      it.age = 0;
      it.seed = Math.random();
      it.size = q.size * (0.8 + 0.4 * it.seed);
      it.life = (it.falls ? 0.45 + 0.3 * it.seed : 0.55 + 0.45 * it.seed) * q.life;
      it.grow = it.falls ? 1 : 1 + (1.6 + 1.2 * it.seed) * q.grow;
      it.alpha = it.falls ? 1 : q.alpha >= 0 ? q.alpha : 0.75 + 0.2 * it.seed;
    }
    this.queued = 0;
    let n = 0;
    for (const it of this.p) {
      if (!it.live) continue;
      it.age += dt;
      if (it.falls) {
        // grit (or a drop): flung up, falls back under gravity, gone when it lands
        it.vy -= 16 * dt;
        const k = Math.exp(-1.2 * dt);
        it.vx *= k;
        it.vd *= k;
        if (it.y < 0.02 && it.vy < 0) it.age = it.life;
      } else {
        // a puff: the still air stops it fast; it rises a little as it spreads
        const k = Math.exp(-4.5 * dt);
        it.vx *= k;
        it.vd *= k;
        it.vy = it.vy * k + 0.25 * dt;
      }
      it.x += it.vx * dt;
      it.y = Math.max(0.02, it.y + it.vy * dt);
      it.d += it.vd * dt;
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 12) {
        it.live = false;
        continue;
      }
      // (written packed: the live ones first)
      this.pos[n * 3] = it.x;
      this.pos[n * 3 + 1] = it.y;
      this.pos[n * 3 + 2] = z - (it.d - dist);
      const e = 1 - (1 - u) * (1 - u);
      this.dust[n * 4] = it.falls ? it.size : it.size * (1 + (it.grow - 1) * e);
      this.dust[n * 4 + 1] = it.falls ? it.alpha * (1 - u * u) : it.alpha * Math.min(1, u * 8) * (1 - u) * (1 - u * 0.4);
      this.dust[n * 4 + 2] = it.kind;
      this.dust[n * 4 + 3] = it.seed;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aDust.needsUpdate = true;
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
