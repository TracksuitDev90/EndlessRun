import * as THREE from '../../vendor/three/three.module.min.js';
import { makeEnvUniforms, copyEnvUniforms, makeSheenMaterial, makeRootMaterial } from '../render/shaders.js';
import { WORLD_DEFS } from '../world/index.js';
import { Dust } from './dust.js';

// What the companions' abilities (powers.js) leave in the world to be seen,
// all of it lit by the world the runner's in, as they are:
//   - one more set of Dust (dust.js) for everything flung or blown about -
//     the soil Sorrel digs up and Nep's roots tear loose (kind 5), the water
//     Nep splashes and drenches you in (6, the big clear drops; 3, spray;
//     2, small drops), Iris's wind (4, wisps of it) - one draw call, and
//     none while the air's clear;
//   - the water's sheen round the runner (Pitcher Protection);
//   - Nep's roots (Root Reach): a few tapering cylinders, drawn only while
//     they reach.
// Positions here are the scene's (x, y, z), as the runner's are.

const ROOTS = 10;
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

export class PowerFx {
  constructor(game) {
    this.game = game;
    this.u = makeEnvUniforms(WORLD_DEFS[0].env);
    this.dust = new Dust(this.u, 200);
    this.anchor = new THREE.Object3D();
    this.sheen = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 18), makeSheenMaterial(this.u));
    this.sheen.frustumCulled = false;
    this.sheen.renderOrder = 9;
    this.sheen.visible = false;
    const rg = new THREE.CylinderGeometry(0.018, 0.075, 1, 6, 12, true).translate(0, 0.5, 0);
    this.roots = [];
    for (let i = 0; i < ROOTS; i++) {
      const m = new THREE.Mesh(rg, makeRootMaterial(this.u));
      m.frustumCulled = false;
      m.visible = false;
      m.material.uniforms.uRoot.value.x = Math.random();
      this.roots.push(m);
    }
    this.objects = [this.dust.points, this.sheen, ...this.roots];
    this.live = 0; // frames since anything of ours was last showing
  }

  reset() {
    this.dust.clear();
    this.sheen.visible = false;
    for (const r of this.roots) r.visible = false;
  }

  // Something flung at scene position (x, y, z) with velocity (vx, vy, vz),
  // m/s in the scene; kind as for Dust (0 a puff, 2 a drop, 3 spray, 4
  // vapour, 5 soil, 6 a big drop).
  emit(x, y, z, vx, vy, vz, size, kind, alpha = -1, life = 1, grow = 1) {
    this.dust.emit(_p.set(x, y, z), _v.set(vx, vy, vz), size, kind, alpha, life, grow);
    this.live = 0;
  }

  // A burst of soil at (x, z) on the road: crumbs kicked up and a puff.
  dirt(x, z, n = 8, carry = 0) {
    for (let i = 0; i < n; i++) {
      this.emit(x + (Math.random() - 0.5) * 0.4, 0.05, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 2.4, 1.4 + Math.random() * 2.2, -carry + (Math.random() - 0.5) * 1.6, 0.05 + Math.random() * 0.05, 5);
    }
    this.emit(x, 0.08, z, 0, 0.3, -carry * 0.8, 0.34, 0, 0.55, 0.8, 1.1);
  }

  // Root i reaching from `from` toward `to` (scene positions), grown k of
  // the way (0..1); hold: it's caught what it went for.
  root(i, from, to, k, hold) {
    const m = this.roots[i];
    if (!m) return;
    _v.subVectors(to, from);
    const len = _v.length();
    if (k <= 0.01 || len < 0.05) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.position.copy(from);
    _q.setFromUnitVectors(_UP, _v.multiplyScalar(1 / len));
    m.quaternion.copy(_q);
    const thick = 0.8 + 0.5 * Math.min(1, len / 12);
    m.scale.set(thick, len * k, thick);
    const u = m.material.uniforms.uRoot.value;
    u.y = hold ? 1 : 0;
    u.z = len * k;
    this.live = 0;
  }

  hideRoots() {
    for (const r of this.roots) r.visible = false;
  }

  // The water's coat round the runner: centred on (x, y, z), w across, h
  // tall; a its strength (0 gone); flow how hard it runs.
  coat(x, y, z, w, h, a, flow = 1) {
    const s = this.sheen;
    s.visible = a > 0.005;
    if (!s.visible) return;
    s.position.set(x, y, z);
    s.scale.set(w, h, w * 0.82);
    s.material.uniforms.uAlpha.value = a;
    s.material.uniforms.uFlow.value = flow;
    this.live = 0;
  }

  update(dt) {
    const g = this.game;
    // (lit as the runner is - but only worth copying while there's
    // something of ours to see)
    if (this.live < 2) copyEnvUniforms(this.u, g.player.u);
    this.live++;
    this.dust.update(dt, this.anchor, -(g.dist - g.origin), g.dist);
  }

  // The floating origin moved on: nothing of ours is kept in the scene's z
  // but for a frame, so there's nothing to carry over.

  forCompile(on) {
    this.dust.forCompile(on);
    this.sheen.visible = on;
    for (const r of this.roots) r.visible = on;
    if (on) {
      this.sheen.material.uniforms.uAlpha.value = 0.01;
      this.sheen.scale.setScalar(0.01);
    }
  }
}
