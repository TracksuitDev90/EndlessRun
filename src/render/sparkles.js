import * as THREE from '../../vendor/three/three.module.min.js';
import { makeSparkleMaterial } from './shaders.js';
import { mulberry32 } from '../core/rng.js';

// The spray of glints a gem throws off as you take it. A fixed set of burst
// slots in one draw call: emitting writes a slot's uniforms, the vertex
// shader does the rest — no per-frame CPU work.

export class Sparkles {
  constructor(slots = 8, per = 16) {
    const rnd = mulberry32(7);
    const n = slots * per;
    const spark = new Float32Array(n * 4);
    const slot = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // round the sphere, thrown more up and out than down
      const a = rnd() * Math.PI * 2;
      const y = rnd() * 1.6 - 0.6;
      const r = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y)));
      spark.set([Math.cos(a) * r, y, Math.sin(a) * r * 0.6, rnd()], i * 4);
      slot[i] = Math.floor(i / per);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSpark', new THREE.BufferAttribute(spark, 4));
    geo.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
    this.material = makeSparkleMaterial(slots);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.slots = slots;
    this.next = 0;
  }

  // dx, dy: where the gem was relative to the runner's chest; size scales the spray
  emit(dx, dy, color, time, size = 1) {
    const u = this.material.uniforms;
    const i = this.next;
    this.next = (i + 1) % this.slots;
    u.uBurst.value[i].set(dx, dy, size, time);
    u.uBurstCol.value[i].setRGB(color[0], color[1], color[2]);
  }

  reset() {
    for (const b of this.material.uniforms.uBurst.value) b.w = 0;
  }
}
