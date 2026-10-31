import * as THREE from '../../vendor/three/three.module.min.js';
import { weld } from './geo.js';

// One prop type = one InstancedMesh (+ an ink-outline InstancedMesh sharing the
// same instance buffers). Placements are kept as plain records in track
// "distance" space and only re-written to the GPU when the set changes or the
// floating origin moves, so steady-state frames cost nothing on the CPU.
//
// Placements stream in in order of distance, so the far end of a batch is the
// end of its list: a prop that rises or lifts into view (anim modes 2 and 4)
// is invisible — flattened to nothing, or sunk out of sight — until the
// camera nears it, and those instances are simply left off the end of the
// draw (cull), saving their vertices without touching the buffers.

const itemPool = [];

export function makeItem() {
  return itemPool.pop() || {};
}

export class Batch {
  constructor(name, geometry, material, inkMaterial, capacity) {
    this.name = name;
    this.capacity = capacity;
    this.items = [];
    this.dirty = false;
    this.materials = [material];

    const aux = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    aux.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aInst', aux);
    this.aux = aux;
    this.shown = 0; // instances written by the last flush
    this.hideBeyond = Infinity; // see hideUntilNear
    this.hideReach = 0;
    this.maxScale = 1;

    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh = this.prep(mesh);

    if (inkMaterial) {
      const ink = new THREE.InstancedMesh(geometry, inkMaterial, capacity);
      ink.instanceMatrix = mesh.instanceMatrix;
      ink.instanceColor = mesh.instanceColor;
      this.ink = this.prep(ink);
      this.materials.push(inkMaterial);
    }
  }

  // Index the geometry (see weld in geo.js) before it is first drawn.
  weld() {
    const geo = this.mesh.geometry;
    if (geo.index) return;
    geo.deleteAttribute('aInst');
    const w = weld(geo);
    w.setAttribute('aInst', this.aux);
    if (w === geo) return;
    this.mesh.geometry = w;
    if (this.ink) this.ink.geometry = w;
    geo.dispose();
  }

  // An instance is invisible while it is more than `beyond` metres ahead of
  // the camera (its anim hasn't begun). per vertex: the test is made at each
  // vertex rather than at the instance's origin, so an instance is only
  // fully hidden once its nearest vertex is past it.
  hideUntilNear(beyond, perVertex) {
    this.hideBeyond = beyond;
    if (perVertex) {
      const g = this.mesh.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      this.hideReach = g.boundingSphere.center.length() + g.boundingSphere.radius;
    }
  }

  // Leave the hidden far end of the batch out of the draw (camDist: the
  // camera's distance along the track).
  // (camDist Infinity: draw them all)
  cull(camDist) {
    const n = this.shown;
    if (this.hideBeyond === Infinity || n === 0) return;
    const cut = camDist + this.hideBeyond + this.hideReach * this.maxScale + 0.5;
    const items = this.items;
    let k = n;
    while (k > 0 && items[k - 1].d > cut) k--;
    if (k === this.mesh.count) return;
    this.mesh.count = k;
    this.mesh.visible = k > 0;
    if (this.ink) {
      this.ink.count = k;
      this.ink.visible = k > 0;
    }
  }

  setCompileVisible(on) {
    if (on) this._wasVisible = this.mesh.visible;
    const v = on ? true : this._wasVisible;
    this.mesh.visible = v;
    if (this.ink) this.ink.visible = v;
  }

  prep(mesh) {
    mesh.frustumCulled = false; // the vertex shader bends the world; CPU bounds would lie
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    mesh.visible = false;
    mesh.name = this.name;
    return mesh;
  }

  set renderOrder(v) {
    this.mesh.renderOrder = v;
    if (this.ink) this.ink.renderOrder = v;
  }

  add(it) {
    this.items.push(it);
    this.dirty = true;
  }

  removeOwner(owner) {
    const items = this.items;
    let w = 0;
    for (let r = 0; r < items.length; r++) {
      const it = items[r];
      if (it.owner === owner) {
        it.owner = null;
        itemPool.push(it);
      } else {
        items[w++] = it;
      }
    }
    if (w !== items.length) {
      items.length = w;
      this.dirty = true;
    }
  }

  clear() {
    for (const it of this.items) {
      it.owner = null;
      itemPool.push(it);
    }
    this.items.length = 0;
    this.dirty = true;
  }

  flush(origin) {
    const n = Math.min(this.items.length, this.capacity);
    if (this.items.length > this.capacity && !this.warned) {
      this.warned = true;
      console.warn(`[batch] ${this.name} over capacity (${this.items.length}/${this.capacity})`);
    }
    const m = this.mesh.instanceMatrix.array;
    const c = this.mesh.instanceColor.array;
    const a = this.aux.array;
    let ms = 0;
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      const sc = it.sx > it.sy ? (it.sx > it.sz ? it.sx : it.sz) : it.sy > it.sz ? it.sy : it.sz;
      if (sc > ms) ms = sc;
      const cs = Math.cos(it.ry);
      const sn = Math.sin(it.ry);
      const o = i * 16;
      m[o] = cs * it.sx;
      m[o + 1] = 0;
      m[o + 2] = -sn * it.sx;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = it.sy;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = sn * it.sz;
      m[o + 9] = 0;
      m[o + 10] = cs * it.sz;
      m[o + 11] = 0;
      m[o + 12] = it.x;
      m[o + 13] = it.y;
      m[o + 14] = -(it.d - origin);
      m[o + 15] = 1;
      c[i * 3] = it.r;
      c[i * 3 + 1] = it.g;
      c[i * 3 + 2] = it.b;
      a[i * 4] = it.p0;
      a[i * 4 + 1] = it.p1;
      a[i * 4 + 2] = it.p2;
      a[i * 4 + 3] = it.p3;
    }
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, Math.max(n, 1) * 16);
    im.needsUpdate = true;
    const ic = this.mesh.instanceColor;
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, Math.max(n, 1) * 3);
    ic.needsUpdate = true;
    this.aux.clearUpdateRanges();
    this.aux.addUpdateRange(0, Math.max(n, 1) * 4);
    this.aux.needsUpdate = true;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (this.ink) {
      this.ink.count = n;
      this.ink.visible = n > 0;
    }
    this.shown = n;
    this.maxScale = ms;
    this.dirty = false;
  }
}

// One batch whose geometry holds several designs (a world's kinds of gem, a
// hall's paintings), each vertex marked with its design in uv.x and each
// placement showing only its own (p1). Rather than one draw that runs every
// design's vertices for every instance (and folds away all but one), each
// design gets its own instanced draw over just its range of the shared
// buffers: a draw call per design present, and a fraction of the vertices.
export class KindBatch {
  constructor(name, geometry, material, inkMaterial, capacity) {
    this.name = name;
    this.capacity = capacity;
    this.items = [];
    this.dirty = false;
    this.base = geometry;
    this.mesh = new THREE.Group();
    this.mesh.name = name;
    this.mesh.matrixAutoUpdate = false;
    this.ink = null;
    const uv = geometry.attributes.uv.array;
    let kinds = 1;
    for (let i = 0; i < uv.length; i += 2) kinds = Math.max(kinds, Math.round(uv[i]) + 1);
    this.parts = [];
    for (let k = 0; k < kinds; k++) {
      const b = new Batch(name, new THREE.BufferGeometry(), material, inkMaterial, capacity);
      this.parts.push(b);
      this.mesh.add(b.mesh);
      if (b.ink) this.mesh.add(b.ink);
    }
    this.materials = this.parts[0].materials;
    this.share();
  }

  // Point every design's draw at the shared buffers and its own range of them.
  share() {
    const g = this.base;
    const ranges = kindRanges(g, this.parts.length);
    this.parts.forEach((b, k) => {
      const geo = b.mesh.geometry;
      for (const [name, attr] of Object.entries(g.attributes)) if (name !== 'aInst') geo.setAttribute(name, attr);
      geo.setIndex(g.index);
      const r = ranges ? ranges[k] : null;
      geo.setDrawRange(r ? r[0] : 0, r ? r[1] : Infinity);
    });
  }

  weld() {
    const w = weld(this.base);
    if (w === this.base) return;
    this.base.dispose();
    this.base = w;
    this.share();
  }

  hideUntilNear() {}
  cull() {}

  set renderOrder(v) {
    for (const b of this.parts) b.renderOrder = v;
  }

  setCompileVisible(on) {
    for (const b of this.parts) b.setCompileVisible(on);
  }

  add(it) {
    this.items.push(it);
    this.dirty = true;
  }

  removeOwner(owner) {
    const items = this.items;
    let w = 0;
    for (let r = 0; r < items.length; r++) {
      const it = items[r];
      if (it.owner === owner) {
        it.owner = null;
        itemPool.push(it);
      } else {
        items[w++] = it;
      }
    }
    if (w !== items.length) {
      items.length = w;
      this.dirty = true;
    }
  }

  clear() {
    for (const it of this.items) {
      it.owner = null;
      itemPool.push(it);
    }
    this.items.length = 0;
    this.dirty = true;
  }

  flush(origin) {
    const parts = this.parts;
    for (const b of parts) b.items.length = 0;
    for (const it of this.items) {
      const k = Math.round(it.p1);
      (parts[k] || parts[0]).items.push(it);
    }
    for (const b of parts) b.flush(origin);
    this.dirty = false;
  }
}

// Each design's [first index, count] in a geometry whose vertices carry their
// design in uv.x, or null if any design's triangles aren't contiguous.
function kindRanges(g, kinds) {
  const uv = g.attributes.uv.array;
  const index = g.index ? g.index.array : null;
  const count = index ? index.length : g.attributes.position.count;
  const first = new Array(kinds).fill(-1);
  const last = new Array(kinds).fill(-1);
  const tris = new Array(kinds).fill(0);
  for (let t = 0; t < count; t += 3) {
    const v = index ? index[t] : t;
    const k = Math.round(uv[v * 2]);
    if (k < 0 || k >= kinds) return null;
    if (first[k] < 0) first[k] = t;
    last[k] = t;
    tris[k]++;
  }
  const out = [];
  for (let k = 0; k < kinds; k++) {
    if (first[k] < 0) {
      out.push([0, 0]);
      continue;
    }
    if ((last[k] - first[k]) / 3 + 1 !== tris[k]) return null;
    out.push([first[k], tris[k] * 3]);
  }
  return out;
}
