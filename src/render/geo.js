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

export function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

export function scaleColor(c, k) {
  const A = rgb(c);
  return [A[0] * k, A[1] * k, A[2] * k];
}

// Primitive constructors (raw three geometries; finalize with part()).
export const P = {
  box: (w, h, d, ws = 1, hs = 1, ds = 1) => new THREE.BoxGeometry(w, h, d, ws, hs, ds),
  cyl: (rt, rb, h, seg = 10, hs = 1, open = false, start = 0, len = Math.PI * 2) =>
    new THREE.CylinderGeometry(rt, rb, h, seg, hs, open, start, len),
  cone: (r, h, seg = 10) => new THREE.ConeGeometry(r, h, seg),
  sphere: (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs),
  ico: (r, detail = 0) => new THREE.IcosahedronGeometry(r, detail),
  dodeca: (r) => new THREE.DodecahedronGeometry(r, 0),
  lathe: (pts, seg = 10) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg),
  capsule: (r, len, cap = 3, radial = 8) => new THREE.CapsuleGeometry(r, len, cap, radial),
  torus: (R, r, rs = 6, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc),
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
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  }
  g.clearGroups();
  const count = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
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
    const A = rgb(c0);
    const B = rgb(c1);
    for (let i = 0; i < count; i++) {
      let t = (pos[i * 3 + 1] - y0) / (y1 - y0);
      t = Math.min(1, Math.max(0, t));
      col[i * 3] = A[0] + (B[0] - A[0]) * t;
      col[i * 3 + 1] = A[1] + (B[1] - A[1]) * t;
      col[i * 3 + 2] = A[2] + (B[2] - A[2]) * t;
    }
  } else {
    const c = rgb(color ?? '#ffffff');
    for (let i = 0; i < count; i++) {
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

  const fx = new Float32Array(count * 3);
  const mark = o.mark || 0;
  const emit = o.emit || 0;
  const tint = o.tint || 0;
  for (let i = 0; i < count; i++) {
    fx[i * 3] = mark;
    fx[i * 3 + 1] = emit;
    fx[i * 3 + 2] = tint;
  }
  g.setAttribute('fx', new THREE.Float32BufferAttribute(fx, 3));
  g.setAttribute('onrm', outlineNormals(g, o.outline ?? 1));
  return g;
}

// Average the distinct face normals that meet at each position so the
// extruded hull has no cracks at corners.
function outlineNormals(g, weight) {
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const n = pos.length / 3;
  const out = new Float32Array(n * 3);
  if (weight <= 0) return new THREE.Float32BufferAttribute(out, 3);
  const map = new Map();
  const keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 500)},${Math.round(pos[i * 3 + 1] * 500)},${Math.round(pos[i * 3 + 2] * 500)}`;
    keys[i] = k;
    let entry = map.get(k);
    if (!entry) {
      entry = { list: [], sum: [0, 0, 0] };
      map.set(k, entry);
    }
    const nx = nor[i * 3];
    const ny = nor[i * 3 + 1];
    const nz = nor[i * 3 + 2];
    let dup = false;
    for (const m of entry.list) {
      if (m[0] * nx + m[1] * ny + m[2] * nz > 0.999) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      entry.list.push([nx, ny, nz]);
      entry.sum[0] += nx;
      entry.sum[1] += ny;
      entry.sum[2] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const s = map.get(keys[i]).sum;
    let len = Math.hypot(s[0], s[1], s[2]);
    if (len < 1e-5) {
      s[0] = nor[i * 3];
      s[1] = nor[i * 3 + 1];
      s[2] = nor[i * 3 + 2];
      len = 1;
    }
    out[i * 3] = (s[0] / len) * weight;
    out[i * 3 + 1] = (s[1] / len) * weight;
    out[i * 3 + 2] = (s[2] / len) * weight;
  }
  return new THREE.Float32BufferAttribute(out, 3);
}

const ATTRS = [
  ['position', 3],
  ['normal', 3],
  ['uv', 2],
  ['color', 3],
  ['fx', 3],
  ['onrm', 3],
];

export function merge(parts) {
  const list = parts.flat().filter(Boolean);
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of ATTRS) {
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of list) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
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
