import * as THREE from '../../vendor/three/three.module.min.js';

// One prop type = one InstancedMesh (+ an ink-outline InstancedMesh sharing the
// same instance buffers). Placements are kept as plain records in track
// "distance" space and only re-written to the GPU when the set changes or the
// floating origin moves, so steady-state frames cost nothing on the CPU.

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
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
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
      a[i * 4 + 2] = 0;
      a[i * 4 + 3] = 0;
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
    this.dirty = false;
  }
}
