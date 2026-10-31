import * as THREE from '../../vendor/three/three.module.min.js';
import { makeParticleMaterial } from './shaders.js';
import { mulberry32 } from '../core/rng.js';

// Ambient motes around the camera (fireflies, dust, petals, embers). A fixed
// buffer wrapped in the vertex shader — no per-frame CPU work.

const parsed = new WeakMap();
function colorOf(s) {
  let c = parsed.get(s);
  if (!c) parsed.set(s, (c = new THREE.Color(s.color)));
  return c;
}

export class Particles {
  constructor(count = 240, seed = 99) {
    const rnd = mulberry32(seed);
    const pos = new Float32Array(count * 3);
    const rand = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd() * 30 - 15;
      pos[i * 3 + 1] = rnd() * 13;
      pos[i * 3 + 2] = rnd() * 98 - 92;
      rand[i] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    this.material = makeParticleMaterial();
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.color = new THREE.Color();
    this.from = null;
  }

  // Blend appearance between two worlds' particle settings (every frame
  // while a doorway is in view: each colour is parsed once, not per frame).
  set(a, b, t) {
    const u = this.material.uniforms;
    u.uColor.value.copy(colorOf(a)).lerp(colorOf(b), t);
    u.uSize.value = a.size + (b.size - a.size) * t;
    u.uOpacity.value = a.opacity + (b.opacity - a.opacity) * t;
    u.uDrift.value.set(
      a.drift[0] + (b.drift[0] - a.drift[0]) * t,
      a.drift[1] + (b.drift[1] - a.drift[1]) * t,
      a.drift[2] + (b.drift[2] - a.drift[2]) * t
    );
  }

  update(dist) {
    this.material.uniforms.uDistMod.value = dist % 98;
  }
}
