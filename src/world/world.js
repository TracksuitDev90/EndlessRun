import * as THREE from '../../vendor/three/three.module.min.js';
import { Batch, makeItem } from '../render/batch.js';
import {
  makeEnvUniforms,
  makeToonMaterial,
  makeInkMaterial,
  makeGlassMaterial,
  makeGlowMaterial,
  makeShadowMaterial,
  makeSkyMaterial,
} from '../render/shaders.js';
import { P, part, merge, rgb } from '../render/geo.js';

// A World owns its palette/lighting uniforms, its sky dome and every prop
// batch it can place. World *definitions* (village.js etc.) describe the art;
// this class is the runtime container the streaming systems talk to.

const quadGeo = () => {
  const g = new THREE.PlaneGeometry(1, 1);
  return g;
};

export class World {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.root = new THREE.Group();
    this.root.name = `world:${def.id}`;
    this.u = makeEnvUniforms(def.env);
    this.batches = new Map();
    this.allMaterials = [];
    this.stencilMaterials = [];

    const skyMat = makeSkyMaterial(this.u);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat);
    this.sky.renderOrder = -5;
    this.sky.frustumCulled = false;
    this.root.add(this.sky);
    this.track(skyMat, true);

    def.build(new WorldBuilder(this));
  }

  track(mat, stencil = true) {
    this.allMaterials.push(mat);
    if (stencil) this.stencilMaterials.push(mat);
  }

  addBatch(name, batch, stencil = true) {
    if (this.batches.has(name)) throw new Error(`duplicate batch ${this.id}.${name}`);
    this.batches.set(name, batch);
    this.root.add(batch.mesh);
    if (batch.ink) this.root.add(batch.ink);
    for (const m of batch.materials) this.track(m, stencil);
    return batch;
  }

  batch(name) {
    const b = this.batches.get(name);
    if (!b) throw new Error(`unknown batch ${this.id}.${name}`);
    return b;
  }

  has(name) {
    return this.batches.has(name);
  }

  // Place one instance. o: { ry, s, sx, sy, sz, c:[r,g,b], p0, p1 }
  put(owner, name, x, y, d, o) {
    const it = makeItem();
    it.owner = owner;
    it.x = x;
    it.y = y;
    it.d = d;
    if (o) {
      const s = o.s ?? 1;
      it.ry = o.ry ?? 0;
      it.sx = o.sx ?? s;
      it.sy = o.sy ?? s;
      it.sz = o.sz ?? s;
      const c = typeof o.c === 'string' ? rgb(o.c) : o.c;
      it.r = c ? c[0] : 1;
      it.g = c ? c[1] : 1;
      it.b = c ? c[2] : 1;
      it.p0 = o.p0 ?? Math.random() * 6.283;
      it.p1 = o.p1 ?? 1;
    } else {
      it.ry = 0;
      it.sx = it.sy = it.sz = 1;
      it.r = it.g = it.b = 1;
      it.p0 = Math.random() * 6.283;
      it.p1 = 1;
    }
    this.batch(name).add(it);
    return it;
  }

  removeOwner(owner) {
    for (const b of this.batches.values()) b.removeOwner(owner);
  }

  clearAll() {
    for (const b of this.batches.values()) b.clear();
  }

  markAllDirty() {
    for (const b of this.batches.values()) b.dirty = true;
  }

  flush(origin) {
    for (const b of this.batches.values()) if (b.dirty) b.flush(origin);
  }

  // While this world is seen through a doorway it only draws where the
  // doorway wrote stencil = 1.
  setStencil(on) {
    for (const m of this.stencilMaterials) {
      m.stencilWrite = on;
      m.stencilRef = 1;
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilFail = THREE.KeepStencilOp;
      m.stencilZFail = THREE.KeepStencilOp;
      m.stencilZPass = THREE.KeepStencilOp;
    }
  }

  setAllVisibleForCompile(on) {
    for (const b of this.batches.values()) {
      if (on) {
        b._wasVisible = b.mesh.visible;
        b.mesh.visible = true;
        if (b.ink) b.ink.visible = true;
      } else {
        b.mesh.visible = b._wasVisible;
        if (b.ink) b.ink.visible = b._wasVisible;
      }
    }
  }
}

// Fluent helper handed to world definitions.
class WorldBuilder {
  constructor(world) {
    this.world = world;
    this.u = world.u;
  }

  // Opaque toon prop with optional ink outline.
  // o: { cap, ink (width, 0 = none), anim, wobble, marks, side, order, stencil }
  toon(name, geometry, o = {}) {
    const mat = makeToonMaterial(this.u, o);
    const ink = o.ink === 0 ? null : makeInkMaterial(mat, o.ink ?? 0.045);
    const b = new Batch(name, geometry, mat, ink, o.cap ?? 64);
    if (o.order) b.renderOrder = o.order;
    return this.world.addBatch(name, b, o.stencil ?? true);
  }

  ground(name, geometry, pattern, o = {}) {
    return this.toon(name, geometry, { ...o, ground: pattern, ink: 0, cap: o.cap ?? 40 });
  }

  glass(name, geometry, o = {}) {
    const mat = makeGlassMaterial(this.u, o);
    const b = new Batch(name, geometry, mat, null, o.cap ?? 64);
    return this.world.addBatch(name, b);
  }

  glow(name, o = {}) {
    const g = part(quadGeo(), '#ffffff', { outline: 0 });
    const mat = makeGlowMaterial(this.u, o);
    const b = new Batch(name, g, mat, null, o.cap ?? 64);
    return this.world.addBatch(name, b);
  }

  shadow(name, o = {}) {
    const g = part(P.plane(1, 1), '#ffffff', { rx: -Math.PI / 2, outline: 0 });
    const mat = makeShadowMaterial(this.u, o);
    const b = new Batch(name, g, mat, null, o.cap ?? 256);
    return this.world.addBatch(name, b);
  }

  merge(parts) {
    return merge(parts);
  }
}
