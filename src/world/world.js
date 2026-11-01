import * as THREE from '../../vendor/three/three.module.min.js';
import { Batch, KindBatch, makeItem } from '../render/batch.js';
import {
  makeEnvUniforms,
  writeEnvUniforms,
  makeToonMaterial,
  makeInkMaterial,
  makeGlassMaterial,
  makeGlowMaterial,
  makeShadowMaterial,
  makeBeamMaterial,
  makePoolMaterial,
  makeSkyMaterial,
  makeGemMaterial,
  makeGemGlowMaterial,
} from '../render/shaders.js';
import { P, part, merge, rgb } from '../render/geo.js';
import { CONFIG } from '../config.js';

// A World owns its palette/lighting uniforms, its sky dome and every prop
// batch it can place. World *definitions* (village.js etc.) describe the art;
// this class is the runtime container the streaming systems talk to.
//
// Worlds come back around as you keep running. Each return ("visit") can
// re-light the world: def.visits[i].env is merged over the base env for the
// (i+1)-th return, and once the list runs out the last look keeps getting a
// little stranger (hue drift, the far world breathing).

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(a[k]) ? deepMerge(a[k], v) : v;
  return out;
}

export function envForVisit(def, visit) {
  const list = def.visits || [];
  if (!visit || !list.length) return def.env;
  const i = Math.min(visit, list.length) - 1;
  let env = def.env;
  for (let k = 0; k <= i; k++) env = deepMerge(env, list[k].env);
  const extra = visit - list.length;
  if (extra > 0) {
    const t = env.trip || [0, 0, 0];
    env = { ...env, trip: [t[0] + 0.18 * extra, Math.min(0.9, t[1] + 0.15 * extra), Math.min(0.6, t[2] + 0.12 * extra)] };
  }
  return env;
}

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
    this.env = def.env;
    this.visit = 0;
    this.u = makeEnvUniforms(def.env);
    this.batches = new Map();
    this.allMaterials = [];
    this.stencilMaterials = [];

    const skyMat = makeSkyMaterial(this.u);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat);
    this.sky.renderOrder = 50; // last of the opaque things (see VS_SKY)
    this.sky.frustumCulled = false;
    this.root.add(this.sky);
    this.track(skyMat, true);

    const b = new WorldBuilder(this);
    def.build(b);
    if (def.gem) b.gems(def.gem);
    this.markObstacles();
    this.markHidden();
  }

  // Props that rise up out of the ground (anim mode 2) are flattened to
  // nothing until the camera nears them, and those that lift up out of the
  // depths (mode 4) are sunk out of sight below the ground: those far
  // instances are left out of the draw (see Batch.cull). (Except that when
  // the dream twists the far road about its axis, it can swing what lies
  // sunk beside it up into view, so then the lifted ones are all drawn.)
  markHidden() {
    this.cullRise = [];
    this.cullLift = [];
    for (const b of this.batches.values()) {
      const anim = b.materials[0].uniforms.uAnim?.value;
      if (!anim || !(b instanceof Batch)) continue;
      const mode = Math.round(anim.x);
      if (mode === 2 || mode === 4) {
        b.hideUntilNear(anim.z, mode === 2);
        (mode === 2 ? this.cullRise : this.cullLift).push(b);
      }
    }
  }

  cull(camDist, twisting) {
    for (const b of this.cullRise) b.cull(camDist);
    for (const b of this.cullLift) b.cull(twisting ? Infinity : camDist);
  }

  // Index every batch's geometry (see weld in geo.js), a batch at a time;
  // yields between batches so loading stays responsive.
  *weldAll() {
    for (const b of this.batches.values()) {
      b.weld();
      yield;
    }
  }

  // What you play against is kept readable however deep the dream goes: an
  // obstacle never breathes (a hurdle swelling into a wall, or a wall
  // squashing into a hurdle, would lie about what it is) and it cuts through
  // the mist and fog more than the scenery round it (uClear).
  markObstacles() {
    const o = this.def.obstacles || {};
    const names = new Set();
    for (const spec of [...(o.L || []), ...(o.H || []), ...(o.W || []), o.LW, o.HW, o.SW]) {
      if (!spec) continue;
      names.add(spec.name);
      if (spec.frame) names.add(spec.frame);
      for (const n of spec.with || []) names.add(n);
    }
    for (const name of names) {
      if (!this.batches.has(name)) continue;
      for (const m of this.batches.get(name).materials) {
        if (m.uniforms.uDreamK) m.uniforms.uDreamK.value = 0;
        if (m.uniforms.uClear) m.uniforms.uClear.value = 1;
      }
    }
  }

  // Re-light for the n-th return to this world (0 = first time).
  applyVisit(visit) {
    if (visit === this.visit) return;
    this.visit = visit;
    this.env = envForVisit(this.def, visit);
    writeEnvUniforms(this.u, this.env);
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
  // (p2 and p3 are left for the gems: the moment one was collected, and how
  // far ahead of the runner it was)
  put(owner, name, x, y, d, o) {
    const it = makeItem();
    it.owner = owner;
    it.x = x;
    it.y = y;
    it.d = d;
    it.p2 = 0;
    it.p3 = 0;
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
    for (const b of this.batches.values()) b.setCompileVisible(on);
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
    const b = o.kinds ? new KindBatch(name, geometry, mat, ink, o.cap ?? 64) : new Batch(name, geometry, mat, ink, o.cap ?? 64);
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

  // Ground shadow decal (multiply). o.hard: crisp rectangle instead of a blob.
  // o.plane: { w, d, x, y, z } bakes its size and offset into the decal (for
  // one put alongside an obstacle with `with`); o.cross: it glides with
  // something swimming across the run (see CROSS).
  shadow(name, o = {}) {
    const pl = o.plane;
    const g = pl ? part(P.plane(pl.w, pl.d), '#ffffff', { rx: -Math.PI / 2, x: pl.x || 0, y: pl.y ?? 0.04, z: pl.z || 0, outline: 0 }) : part(P.plane(1, 1), '#ffffff', { rx: -Math.PI / 2, outline: 0 });
    const mat = makeShadowMaterial(this.u, o);
    const b = new Batch(name, g, mat, null, o.cap ?? 256);
    if (o.order) b.renderOrder = o.order;
    return this.world.addBatch(name, b);
  }

  // Additive light volume (sun shaft, lamp cone). Geometry uv.y runs 0..1
  // along the beam; give parts tint: 1 so instance color scales brightness.
  beam(name, geometry, o = {}) {
    const mat = makeBeamMaterial(this.u, o);
    const b = new Batch(name, geometry, mat, null, o.cap ?? 64);
    b.renderOrder = o.order ?? 6;
    return this.world.addBatch(name, b);
  }

  // Additive pool of light on the ground (instance color .r = brightness).
  pool(name, o = {}) {
    const g = part(P.plane(1, 1), '#ffffff', { rx: -Math.PI / 2, outline: 0 });
    const mat = makePoolMaterial(this.u, o);
    const b = new Batch(name, g, mat, null, o.cap ?? 64);
    b.renderOrder = 1;
    return this.world.addBatch(name, b);
  }

  // The world's collectible stones (def.gem, see world/gems.js): every kind
  // it has — its everyday stones, then its crown — built into one geometry,
  // each kind's triangles marked with its index in uv.x, so a single instanced
  // batch ('gems', and its ink) draws them all, each instance showing only its
  // own kind (p1). Plus the halo round every gem and the light it spills on
  // the road.
  gems(spec) {
    const kinds = [...spec.stones, spec.crown];
    const size = CONFIG.gems.size;
    const geo = merge(
      kinds.map((kind, i) => {
        const g = merge(kind.parts());
        const uv = g.attributes.uv.array;
        for (let j = 0; j < uv.length; j += 2) {
          uv[j] = i;
          uv[j + 1] = 0;
        }
        return g;
      })
    ).scale(size, size, size);
    const o = { spin: spec.motion, look: spec.look };
    const mat = makeGemMaterial(this.u, { ...o, polish: spec.polish, kinds: kinds.map((k) => k.texture || {}) });
    this.world.addBatch('gems', new KindBatch('gems', geo, mat, makeInkMaterial(mat, spec.ink ?? 0.026), 220));
    for (const [name, gain, pool] of [['gemGlow', spec.glow, false], ['gemPool', spec.pool, true]]) {
      const g = part(quadGeo(), '#ffffff', { outline: 0 });
      const b = new Batch(name, g, makeGemGlowMaterial(this.u, { ...o, gain, pool }), null, 220);
      b.renderOrder = pool ? 1 : 7;
      this.world.addBatch(name, b);
    }
  }

  merge(parts) {
    return merge(parts);
  }
}
