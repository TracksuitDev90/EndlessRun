import * as THREE from '../../vendor/three/three.module.min.js';

// Geometry kit: build props from primitives, bake vertex colors and per-vertex
// effect flags, and compute smoothed "outline normals" so the inverted-hull ink
// pass stays closed around hard edges. Everything is merged into one
// non-indexed BufferGeometry per prop type.
//
// Vertex attributes produced:
//   position, normal, uv, color (sRGB), fx (mark, emissive, tintMask), onrm

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

export function rgb(hex) {
  if (Array.isArray(hex)) return hex;
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
}

// The same, for a caller that only reads the answer: a colour given by name
// or hex is parsed once and the one array handed back every time after (so
// it must not be written to). Thousands of parts are painted from a few
// hundred colours at load, and every placement tinted by name comes through
// here while the game runs.
const _rgbSeen = new Map();
export function rgbOf(hex) {
  if (typeof hex !== 'string') return rgb(hex);
  let c = _rgbSeen.get(hex);
  if (c === undefined) {
    c = rgb(hex);
    _rgbSeen.set(hex, c);
  }
  return c;
}

export function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

export function scaleColor(c, k) {
  const A = rgb(c);
  return [A[0] * k, A[1] * k, A[2] * k];
}

// Level of detail for the round primitives while a prop is being built (see
// lod): their segment counts are scaled by it, never below `min` (nor above
// what was asked). A prop seen in the dozens at once - a glasshouse bed's
// ferns, a lane's fences - loses nothing you can see at a run's distance and
// pace by being built a little coarser, and the scene that's full of them
// draws in a good deal less time.
let DETAIL = 1;
const seg = (n, min) => (DETAIL === 1 ? n : Math.min(n, Math.max(min, Math.round(n * DETAIL))));

// Build a prop (fn returns its geometry or parts) at detail k (0..1).
export function lod(k, fn) {
  const was = DETAIL;
  DETAIL = k;
  try {
    return fn();
  } finally {
    DETAIL = was;
  }
}

// Primitive constructors (raw three geometries; finalize with part()).
export const P = {
  box: (w, h, d, ws = 1, hs = 1, ds = 1) => new THREE.BoxGeometry(w, h, d, ws, hs, ds),
  cyl: (rt, rb, h, n = 10, hs = 1, open = false, start = 0, len = Math.PI * 2) =>
    new THREE.CylinderGeometry(rt, rb, h, seg(n, 5), hs, open, start, len),
  cone: (r, h, n = 10) => new THREE.ConeGeometry(r, h, seg(n, 5)),
  sphere: (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, seg(ws, 6), seg(hs, 4)),
  ico: (r, detail = 0) => new THREE.IcosahedronGeometry(r, detail),
  dodeca: (r) => new THREE.DodecahedronGeometry(r, 0),
  lathe: (pts, n = 10) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg(n, 6)),
  capsule: (r, len, cap = 3, radial = 8) => new THREE.CapsuleGeometry(r, len, seg(cap, 2), seg(radial, 5)),
  torus: (R, r, rs = 6, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, seg(rs, 4), seg(ts, 8), arc),
  // A thin flat bar seen only face-on (a leaf's vein, a stripe): a box's
  // front and back without its four edges - a third of the triangles.
  slab: (w, h, d) => {
    const x = w / 2, y = h / 2, z = d / 2;
    const g = new THREE.BufferGeometry();
    // prettier-ignore
    g.setAttribute('position', new THREE.Float32BufferAttribute([-x, -y, z, x, -y, z, x, y, z, -x, y, z, x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z], 3));
    // prettier-ignore
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    return g;
  },
  plane: (w, h, ws = 1, hs = 1) => new THREE.PlaneGeometry(w, h, ws, hs),
  extrude: (shape, depth, curveSegments = 12) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
    g.translate(0, 0, -depth / 2);
    return g;
  },
  // Gable roof: triangle in x/y, extruded along z, base at y = 0.
  prism: (w, h, d) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    return P.extrude(s, d, 1);
  },
};

// Arched or rectangular doorway outline (bottom-center at origin).
export function doorShape(halfW, rectH, arch, margin = 0) {
  const s = new THREE.Shape();
  const w = halfW + margin;
  s.moveTo(-w, -margin);
  s.lineTo(w, -margin);
  if (arch) {
    s.lineTo(w, rectH);
    s.absarc(0, rectH, w, 0, Math.PI, false);
  } else {
    s.lineTo(w, rectH + margin);
    s.lineTo(-w, rectH + margin);
  }
  s.closePath();
  return s;
}

export function doorTop(halfW, rectH, arch) {
  return arch ? rectH + halfW : rectH;
}

// Finalize a primitive: transform, colorize, flag, outline normals.
// o: { x,y,z, rx,ry,rz, s, sx,sy,sz, grad:[c0,c1,y0,y1], mark, emit, tint, outline }
export function part(geo, color, o = {}) {
  const g = geo.index ? unindexed(geo) : geo;
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  }
  g.clearGroups();
  const count = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (o.uvScale) {
    const uv = g.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] *= o.uvScale[0];
      uv[i + 1] *= o.uvScale[1];
    }
  }

  const s = o.s ?? 1;
  _s.set(o.sx ?? s, o.sy ?? s, o.sz ?? s);
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(o.x || 0, o.y || 0, o.z || 0);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);

  const pos = g.attributes.position.array;
  const col = new Float32Array(count * 3);
  if (o.grad) {
    const [c0, c1, y0, y1] = o.grad;
    const A = rgbOf(c0);
    const B = rgbOf(c1);
    for (let i = 0; i < count; i++) {
      let t = (pos[i * 3 + 1] - y0) / (y1 - y0);
      t = Math.min(1, Math.max(0, t));
      col[i * 3] = A[0] + (B[0] - A[0]) * t;
      col[i * 3 + 1] = A[1] + (B[1] - A[1]) * t;
      col[i * 3 + 2] = A[2] + (B[2] - A[2]) * t;
    }
  } else {
    const c = rgbOf(color ?? '#ffffff');
    const r = c[0], gr = c[1], b = c[2];
    for (let i = 0, k = 0; i < count; i++, k += 3) {
      col[k] = r;
      col[k + 1] = gr;
      col[k + 2] = b;
    }
  }
  // (a BufferAttribute over the array itself: Float32BufferAttribute would
  // copy it first)
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const fx = new Float32Array(count * 3);
  const mark = o.mark || 0;
  const emit = o.emit || 0;
  const tint = o.tint || 0;
  if (mark !== 0 || emit !== 0 || tint !== 0) {
    for (let i = 0, k = 0; i < count; i++, k += 3) {
      fx[k] = mark;
      fx[k + 1] = emit;
      fx[k + 2] = tint;
    }
  }
  g.setAttribute('fx', new THREE.BufferAttribute(fx, 3));
  g.setAttribute('onrm', outlineNormals(g, o.outline ?? 1));
  return g;
}

// A primitive's triangles spelled out vertex by vertex (what toNonIndexed
// does), but only the three attributes a part keeps, each in one tight loop.
function unindexed(geo) {
  const A = geo.attributes;
  for (const k of ['position', 'normal', 'uv']) {
    if (A[k] && (A[k].isInterleavedBufferAttribute || !(A[k].array instanceof Float32Array))) return geo.toNonIndexed();
  }
  const index = geo.index.array;
  const n = index.length;
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) {
    const a = A[k];
    if (!a) continue;
    const s = a.itemSize;
    const src = a.array;
    const dst = new Float32Array(n * s);
    if (s === 3) {
      for (let i = 0, w = 0; i < n; i++, w += 3) {
        const r = index[i] * 3;
        dst[w] = src[r];
        dst[w + 1] = src[r + 1];
        dst[w + 2] = src[r + 2];
      }
    } else if (s === 2) {
      for (let i = 0, w = 0; i < n; i++, w += 2) {
        const r = index[i] * 2;
        dst[w] = src[r];
        dst[w + 1] = src[r + 1];
      }
    } else {
      for (let i = 0, w = 0; i < n; i++) {
        const r = index[i] * s;
        for (let j = 0; j < s; j++) dst[w++] = src[r + j];
      }
    }
    out.setAttribute(k, new THREE.BufferAttribute(dst, s, a.normalized));
  }
  return out;
}

// Average the distinct face normals that meet at each position so the
// extruded hull has no cracks at corners.
//
// (Every prop is built from dozens of primitives and every primitive comes
// through here, so at load this runs over a couple of million vertices. The
// positions are bucketed in an open-addressed hash of their quantised
// coordinates, each bucket's distinct normals kept as a linked list, all in
// typed scratch buffers that are reused from call to call: nothing is
// allocated per vertex, and the result is the same to the last bit as
// summing them per position in a Map keyed by strings, which is what this
// replaced and took a third of the load's geometry time.)
let _onCap = 0; // vertices the scratch buffers hold
let _onSlots = new Int32Array(0); // hash slot -> bucket (-1: empty)
let _onKey = new Int32Array(0); // bucket -> its quantised position (x, y, z)
let _onSum = new Float64Array(0); // bucket -> the sum of its distinct normals
let _onHead = new Int32Array(0); // bucket -> the first of its distinct normals
let _onNext = new Int32Array(0); // distinct normal -> the next in its bucket
let _onNor = new Float64Array(0); // distinct normal -> (x, y, z)
let _onOf = new Int32Array(0); // vertex -> its bucket
let _onDone = new Uint8Array(0); // bucket -> its outline normal is worked out
let _onOut = new Float64Array(0); // bucket -> that normal (unit length)

function outlineScratch(n) {
  if (n <= _onCap) return;
  let cap = 256;
  while (cap < n) cap <<= 1;
  _onCap = cap;
  _onSlots = new Int32Array(cap * 2);
  _onKey = new Int32Array(cap * 3);
  _onSum = new Float64Array(cap * 3);
  _onHead = new Int32Array(cap);
  _onNext = new Int32Array(cap);
  _onNor = new Float64Array(cap * 3);
  _onOf = new Int32Array(cap);
  _onDone = new Uint8Array(cap);
  _onOut = new Float64Array(cap * 3);
}

function outlineNormals(g, weight) {
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const n = pos.length / 3;
  const out = new Float32Array(n * 3);
  if (weight <= 0) return new THREE.BufferAttribute(out, 3);
  outlineScratch(n);
  let size = 16;
  while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const slots = _onSlots, key = _onKey, sum = _onSum, head = _onHead, next = _onNext, lnor = _onNor, of = _onOf;
  slots.fill(-1, 0, size);
  let buckets = 0;
  let listed = 0;
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    // (| 0: a rounded -0 keys as 0, as it did when the key was a string)
    const qx = Math.round(pos[i3] * 500) | 0;
    const qy = Math.round(pos[i3 + 1] * 500) | 0;
    const qz = Math.round(pos[i3 + 2] * 500) | 0;
    let p = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) & mask;
    let b;
    for (;;) {
      b = slots[p];
      if (b < 0) {
        b = buckets++;
        slots[p] = b;
        const b3 = b * 3;
        key[b3] = qx;
        key[b3 + 1] = qy;
        key[b3 + 2] = qz;
        sum[b3] = 0;
        sum[b3 + 1] = 0;
        sum[b3 + 2] = 0;
        head[b] = -1;
        break;
      }
      const b3 = b * 3;
      if (key[b3] === qx && key[b3 + 1] === qy && key[b3 + 2] === qz) break;
      p = (p + 1) & mask;
    }
    of[i] = b;
    const nx = nor[i3];
    const ny = nor[i3 + 1];
    const nz = nor[i3 + 2];
    let dup = false;
    for (let m = head[b]; m >= 0; m = next[m]) {
      const m3 = m * 3;
      if (lnor[m3] * nx + lnor[m3 + 1] * ny + lnor[m3 + 2] * nz > 0.999) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      const m = listed++;
      const m3 = m * 3;
      lnor[m3] = nx;
      lnor[m3 + 1] = ny;
      lnor[m3 + 2] = nz;
      next[m] = head[b];
      head[b] = m;
      const b3 = b * 3;
      sum[b3] += nx;
      sum[b3 + 1] += ny;
      sum[b3 + 2] += nz;
    }
  }
  const done = _onDone, unit = _onOut;
  done.fill(0, 0, buckets);
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    const b = of[i];
    const b3 = b * 3;
    if (!done[b]) {
      let len = Math.hypot(sum[b3], sum[b3 + 1], sum[b3 + 2]);
      if (len < 1e-5) {
        // normals that cancel out: the bucket takes this vertex's own (and
        // is looked at afresh for the next vertex that shares it)
        sum[b3] = nor[i3];
        sum[b3 + 1] = nor[i3 + 1];
        sum[b3 + 2] = nor[i3 + 2];
        len = 1;
      } else {
        done[b] = 1;
      }
      unit[b3] = sum[b3] / len;
      unit[b3 + 1] = sum[b3 + 1] / len;
      unit[b3 + 2] = sum[b3 + 2] / len;
    }
    out[i3] = unit[b3] * weight;
    out[i3 + 1] = unit[b3 + 1] * weight;
    out[i3 + 2] = unit[b3 + 2] * weight;
  }
  return new THREE.BufferAttribute(out, 3);
}

const ATTRS = [
  ['position', 3],
  ['normal', 3],
  ['uv', 2],
  ['color', 3],
  ['fx', 3],
  ['onrm', 3],
];
// Carried through a merge only if some part has them; the others get `fill`.
// edge: where a gem's facet edges are (see facetEdges in world/gems.js);
// spA / spB: a lava droplet's launch point and velocity (see SPLASH in the
// object shader); role: what a vertex is in a part that moves in pieces (an
// hourglass's sand, see SAND); fish: where a fish swims in its school and its
// own beat (see SCHOOL); snow: how far a vertex moves as the snow builds up
// on it, and which slab of a far drift it belongs to (see SNOW).
const OPTIONAL = [['edge', 3, 1], ['spA', 4, 0], ['spB', 4, 0], ['role', 1, 0], ['fish', 4, 0], ['snow', 4, 0]];

export function merge(parts) {
  const list = parts.flat().filter(Boolean);
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [name, size, fill] of [...ATTRS, ...OPTIONAL.filter(([n]) => list.some((g) => g.attributes[n]))]) {
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of list) {
      const n = g.attributes.position.count * size;
      if (g.attributes[name]) arr.set(g.attributes[name].array, off);
      else arr.fill(fill, off, off + n);
      off += n;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of list) g.dispose();
  return out;
}

// Flat ground strip: local x across, z from 0 back to -length; uv = meters.
export function groundStrip(width, length, color, segZ = 8, o = {}) {
  const g = new THREE.PlaneGeometry(width, length, 1, segZ);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -length / 2);
  const pos = g.attributes.position.array;
  const uv = g.attributes.uv.array;
  for (let i = 0; i < pos.length / 3; i++) {
    uv[i * 2] = pos[i * 3];
    uv[i * 2 + 1] = -pos[i * 3 + 2];
  }
  return part(g, color, { outline: 0, ...o });
}

// Index a non-indexed geometry by merging vertices whose every attribute is
// bit-for-bit the same (part() un-indexes each primitive to merge it, so a
// sphere's shared vertices come back as exact copies). The triangles and
// their order are unchanged, so it draws exactly the same picture — but the
// GPU can reuse a transformed vertex instead of running the (heavy) vertex
// shader again for each copy: about a third as many vertices to shade.
export function weld(geo) {
  if (geo.index) return geo;
  const names = Object.keys(geo.attributes);
  const attrs = names.map((nm) => geo.attributes[nm]);
  const n = geo.attributes.position.count;
  if (n < 6 || attrs.some((a) => a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array))) return geo;
  // every vertex's attributes side by side, as raw bits
  let S = 0;
  for (const a of attrs) S += a.itemSize;
  // (as signed words: half of all floats' bits don't fit a small integer
  // unsigned, and the engine boxes every one it reads until it has optimised
  // the loop — which, for code that runs once at load, is most of the time)
  const key = new Int32Array(n * S);
  let off = 0;
  for (const a of attrs) {
    const v = new Int32Array(a.array.buffer, a.array.byteOffset, a.array.length);
    const s = a.itemSize;
    // (the usual sizes spelled out: this copy is most of the work)
    if (s === 3) {
      for (let i = 0, k = off, r = 0; i < n; i++, k += S, r += 3) {
        key[k] = v[r];
        key[k + 1] = v[r + 1];
        key[k + 2] = v[r + 2];
      }
    } else if (s === 2) {
      for (let i = 0, k = off, r = 0; i < n; i++, k += S, r += 2) {
        key[k] = v[r];
        key[k + 1] = v[r + 1];
      }
    } else if (s === 4) {
      for (let i = 0, k = off, r = 0; i < n; i++, k += S, r += 4) {
        key[k] = v[r];
        key[k + 1] = v[r + 1];
        key[k + 2] = v[r + 2];
        key[k + 3] = v[r + 3];
      }
    } else {
      for (let i = 0; i < n; i++) for (let j = 0; j < s; j++) key[i * S + off + j] = v[i * s + j];
    }
    off += s;
  }
  // open-addressed hash of the distinct vertices. (Which hash only decides
  // how often two different vertices meet in a slot, never the result: a
  // vertex is merged only into one whose every bit matches, and the distinct
  // ones are numbered in the order they first appear. So it hashes just the
  // first eight words — the position, the normal and whatever comes next —
  // which tells nearly all of them apart for half the work.)
  const H = S < 8 ? S : 8;
  let size = 1;
  while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const slots = new Int32Array(size).fill(-1);
  const first = new Int32Array(n); // unique vertex -> its first source vertex
  const remap = new Uint32Array(n);
  let unique = 0;
  for (let i = 0; i < n; i++) {
    const b = i * S;
    let h = 2166136261;
    for (let j = 0; j < H; j++) h = Math.imul(h ^ key[b + j], 16777619);
    let p = (h ^ (h >>> 15)) & mask;
    for (;;) {
      const u = slots[p];
      if (u < 0) {
        slots[p] = unique;
        first[unique] = i;
        remap[i] = unique++;
        break;
      }
      const c = first[u] * S;
      let j = 0;
      while (j < S && key[c + j] === key[b + j]) j++;
      if (j === S) {
        remap[i] = u;
        break;
      }
      p = (p + 1) & mask;
    }
  }
  if (unique > n * 0.9) return geo; // nothing much to gain
  const out = new THREE.BufferGeometry();
  for (const [k, a] of attrs.entries()) {
    const s = a.itemSize;
    const src = a.array;
    const arr = new Float32Array(unique * s);
    if (s === 3) {
      for (let u = 0, w = 0; u < unique; u++, w += 3) {
        const r = first[u] * 3;
        arr[w] = src[r];
        arr[w + 1] = src[r + 1];
        arr[w + 2] = src[r + 2];
      }
    } else {
      for (let u = 0; u < unique; u++) {
        const r = first[u] * s;
        for (let j = 0; j < s; j++) arr[u * s + j] = src[r + j];
      }
    }
    out.setAttribute(names[k], new THREE.BufferAttribute(arr, s, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(unique < 65536 ? new Uint16Array(remap) : remap, 1));
  return out;
}
