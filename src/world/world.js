import * as THREE from '../../vendor/three/three.module.min.js';
import { Batch, KindBatch, makeItem } from '../render/batch.js';
import {
  makeEnvUniforms,
  writeEnvUniforms,
  makeToonMaterial,
  makeInkMaterial,
  makeGlassMaterial,
  makeGlowMaterial,
  makeFireMaterial,
  makeShadowMaterial,
  makeBeamMaterial,
  makePoolMaterial,
  makeSkyMaterial,
  makeGemMaterial,
  makeGemGlowMaterial,
} from '../render/shaders.js';
import { P, part, merge, rgbOf } from '../render/geo.js';
import { CONFIG } from '../config.js';
import { Planets } from './planets.js';

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

// Every world's sky is the same sphere, drawn with its own colours.
let skyGeo = null;

// A World starts as an empty shell - its name and an empty root, enough for
// the course to know it's coming - and is only filled in when it's wanted:
// its definition arrives with its module (attach), then its batches are
// built a step at a time between frames (build), and the game puts all of
// it on the GPU before it can be seen (see Game.prepareWorld). `built` and
// `ready` say how far it's got.
export class World {
  // entry: { id, load } from WORLD_ORDER (world/index.js) - or a definition
  // to attach at once
  // (o.sky false: no sky - the shared doors)
  constructor(entry, o = {}) {
    this.entry = entry;
    this.def = null;
    this.id = entry.id;
    this.name = entry.name || entry.id;
    this.root = new THREE.Group();
    this.root.name = `world:${entry.id}`;
    this.env = null;
    this.visit = 0;
    this.u = null;
    this.sky = null;
    this.batches = new Map();
    this.allMaterials = [];
    this.stencilMaterials = [];
    this.cullRise = [];
    this.cullLift = [];
    this.loading = null;
    this.built = false; // every batch made (build)
    this.ready = false; // and drawn once, out of sight (Game.prepareWorld)
    if (!entry.load) this.attach(entry, o);
  }

  // Fetch the world's module (once; one that failed is tried again when
  // asked again). Resolves to its definition.
  load() {
    if (this.def) return Promise.resolve(this.def);
    if (!this.loading) {
      this.loading = this.entry.load().then(
        (m) => {
          this.attach(m.default);
          return this.def;
        },
        (e) => {
          this.loading = null;
          throw e;
        }
      );
    }
    return this.loading;
  }

  // Its definition is here: its light, and its sky (o.sky false: none).
  attach(def, o = {}) {
    if (this.def) return;
    this.def = def;
    this.name = def.name;
    this.env = def.env;
    this.u = makeEnvUniforms(def.env);
    if (o.sky === false) return;
    const skyMat = makeSkyMaterial(this.u);
    skyGeo ??= new THREE.SphereGeometry(450, 32, 16);
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = 50; // last of the opaque things (see VS_SKY)
    this.sky.frustumCulled = false;
    this.root.add(this.sky);
    this.track(skyMat, true);
  }

  // Build every batch the world places (def.build: a generator, a batch at
  // a time, so the game can spread it over frames), then its gems.
  *build() {
    if (this.built) return;
    const b = new WorldBuilder(this);
    const steps = this.def.build(b);
    if (steps && typeof steps.next === 'function') yield* steps;
    if (this.def.gem) {
      b.gems(this.def.gem);
      yield;
    }
    this.markObstacles();
    this.markHidden();
    this.built = true;
  }

  // The door INTO `def`'s world (def.door), built into this shared set of
  // doors (see Game), its batches named `<id>.<name>`. Returns them.
  addDoor(def) {
    const before = new Set(this.batches.values());
    def.door(new WorldBuilder(this).prefixed(`${def.id}.`));
    const added = [...this.batches.values()].filter((b) => !before.has(b));
    this.markHidden(added);
    return added;
  }

  // Props that rise up out of the ground (anim mode 2) are flattened to
  // nothing until the camera nears them, and those that lift up out of the
  // depths (mode 4) are sunk out of sight below the ground: those far
  // instances are left out of the draw (see Batch.cull). (Except that when
  // the dream twists the far road about its axis, it can swing what lies
  // sunk beside it up into view, so then the lifted ones are all drawn.)
  markHidden(list = this.batches.values()) {
    for (const b of list) {
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

  // Index every batch's geometry (see weld in geo.js), a step at a time: a
  // batch, or a part of a big one.
  *weldAll() {
    for (const b of this.batches.values()) {
      yield* b.welding();
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
    // (a world that lays its obstacles a stretch at a time lists them all
    // here as well; and something laid across two lanes - o.twin - or built
    // the other way round for the left-hand lane - spec.left - is one too)
    const twins = o.twin ? Object.values(o.twin) : [];
    for (const spec of [...(o.L || []), ...(o.H || []), ...(o.W || []), o.LW, o.HW, o.SW, ...twins].flat()) {
      if (!spec) continue;
      names.add(spec.name);
      if (spec.frame) names.add(spec.frame);
      if (spec.left) names.add(spec.left);
      for (const n of [...(spec.with || []), ...(spec.withLeft || [])]) names.add(n);
    }
    // (and what a climb is built of: see ObstacleField.placeClimb)
    for (const name of this.def.climb?.names || []) names.add(name);
    for (const name of this.def.high?.names || []) names.add(name);
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
      const c = typeof o.c === 'string' ? rgbOf(o.c) : o.c;
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
    // (a prop the snow settles on needs every vertex's share of it, if only
    // nothing: an attribute left unbound reads w = 1, a slab that lifts)
    if (o.snow && !geometry.attributes.snow) {
      geometry.setAttribute('snow', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 4), 4));
    }
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

  // Fire: sheets of flame that stand up and face the camera (see VS_FIRE).
  // Put one with sx its width, sy its height, p0 its beat and p1 how far it
  // stands back behind its spot.
  fire(name, o = {}) {
    const g = part(P.plane(1, 1, 1, 6), '#ffffff', { y: 0.5, outline: 0 });
    const b = new Batch(name, g, makeFireMaterial(this.u), null, o.cap ?? 32);
    b.renderOrder = o.order ?? 7;
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

  // The same builder, every batch's name prefixed (the doorways: every
  // world's door built into the one shared set, see Game).
  prefixed(prefix) {
    const named = new Set(['toon', 'ground', 'glass', 'glow', 'fire', 'shadow', 'beam', 'pool']);
    return new Proxy(this, {
      get(t, k) {
        const v = t[k];
        if (named.has(k)) return (name, ...a) => v.call(t, prefix + name, ...a);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  // Whole planets hung in the sky round the camera, ebbing nearer and
  // further (see world/planets.js); the game moves them every frame.
  planets(spec) {
    this.world.planets = new Planets(this.world, spec);
  }

  merge(parts) {
    return merge(parts);
  }
}
