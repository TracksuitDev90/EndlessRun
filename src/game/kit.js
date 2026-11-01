import * as THREE from '../../vendor/three/three.module.min.js';
import { runnerArrays } from './runner-asset.js';

// What every runner is made of, whoever they are: their palette as the
// character shader reads it, their sculpted body as one skinned geometry, and
// the kit for a simulated sheet hung off the body (the wayfarer's cape, the
// explorer's long hair): its colliders in simulation space, the smooth
// surface the GPU draws through its particles, and the fold shading handed to
// the shader with them.

export function palette(table) {
  return Array.from({ length: 32 }, (_, i) => new THREE.Color(table[i] || '#ff00ff'));
}

// The sculpted body as one indexed skinned geometry.
export function bodyGeometry(asset) {
  const a = runnerArrays(asset);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  geo.setAttribute('onrm', new THREE.BufferAttribute(a.onrm, 3));
  geo.setAttribute('aD', new THREE.BufferAttribute(a.detail, 4));
  geo.setAttribute('aMat', new THREE.BufferAttribute(a.material, 1));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(a.skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(a.skinWeight, 4, true));
  geo.setIndex(new THREE.BufferAttribute(a.index, 1));
  return geo;
}

// Write colliders into the cloth's space. M(bone) gives the bone's skinning
// matrix (current pose * inverse bind) or null for the bind pose; Q rotates
// root space into simulation space (or null). margin: how far the sheet is
// kept off every surface.
const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _id = new THREE.Matrix4();
export function setColliders(cloth, defs, M, Q, margin) {
  cloth.setColliderCount(defs.length);
  const m = margin;
  for (let k = 0; k < defs.length; k++) {
    const d = defs[k];
    const c = cloth.colliders[k];
    const T = M ? M(d.bone) : _id;
    if (d.kind === 'ell') {
      _ca.fromArray(d.c).applyMatrix4(T);
      if (Q) _ca.applyQuaternion(Q);
      c.ell = true;
      c.cx = _ca.x;
      c.cy = _ca.y;
      c.cz = _ca.z;
      for (let e = 0; e < 3; e++) {
        _ax.setFromMatrixColumn(T, e).normalize();
        if (Q) _ax.applyQuaternion(Q);
        _ax.toArray(e === 0 ? c.ax : e === 1 ? c.ay : c.az);
        c.r2[e] = 1 / ((d.r[e] + m) * (d.r[e] + m));
      }
      const R = Math.max(d.r[0], d.r[1], d.r[2]) + m;
      c.R2 = R * R;
    } else {
      _ca.fromArray(d.a).applyMatrix4(T);
      _cb.fromArray(d.b).applyMatrix4(T);
      if (Q) {
        _ca.applyQuaternion(Q);
        _cb.applyQuaternion(Q);
      }
      c.ell = false;
      _ca.toArray(c.a);
      _cb.toArray(c.b);
      c.ra = d.ra + m;
      c.rb = d.rb + m;
      c.cx = (_ca.x + _cb.x) / 2;
      c.cy = (_ca.y + _cb.y) / 2;
      c.cz = (_ca.z + _cb.z) / 2;
      const R = _ca.distanceTo(_cb) / 2 + Math.max(c.ra, c.rb);
      c.R2 = R * R;
    }
  }
}

// Catmull-Rom through the particle grid (the GPU draws the same surface).
const crW = (t, o) => {
  const t2 = t * t, t3 = t2 * t;
  o[0] = 0.5 * (-t3 + 2 * t2 - t);
  o[1] = 0.5 * (3 * t3 - 5 * t2 + 2);
  o[2] = 0.5 * (-3 * t3 + 4 * t2 + t);
  o[3] = 0.5 * (t3 - t2);
  return o;
};
function gridPoint(arr, cols, rows, i, j, out) {
  const ci = Math.min(cols - 1, Math.max(0, i));
  const cj = Math.min(rows - 1, Math.max(0, j));
  const at = (a, b) => _g.fromArray(arr, (b * cols + a) * 3);
  // past the border: continue the last segment straight on
  const ri = i < 0 ? 1 : i >= cols ? cols - 2 : ci;
  const rj = j < 0 ? 1 : j >= rows ? rows - 2 : cj;
  out.copy(at(ci, cj));
  if (ri !== ci) out.multiplyScalar(2).sub(at(ri, cj));
  if (rj !== cj) {
    const e = _g2.copy(at(ci, rj));
    if (ri !== ci) e.multiplyScalar(2).sub(at(ri, rj));
    out.multiplyScalar(2).sub(e);
  }
  return out;
}
const _g = new THREE.Vector3();
const _g2 = new THREE.Vector3();
const _gp = new THREE.Vector3();
const _wu = [0, 0, 0, 0];
const _wv = [0, 0, 0, 0];
export function sheetSurfacePoint(sheet, arr, gu, gv, out) {
  const { cols, rows } = sheet;
  const i0 = Math.min(cols - 2, Math.max(0, Math.floor(gu)));
  const j0 = Math.min(rows - 2, Math.max(0, Math.floor(gv)));
  crW(gu - i0, _wu);
  crW(gv - j0, _wv);
  out.set(0, 0, 0);
  for (let b = 0; b < 4; b++) {
    for (let a = 0; a < 4; a++) out.addScaledVector(gridPoint(arr, cols, rows, i0 - 1 + a, j0 - 1 + b, _gp), _wu[a] * _wv[b]);
  }
  return out;
}

// The sheet's outward normal at a grid point (down x across).
function sheetNormal(sheet, arr, gu, gv, out) {
  const e = 0.01;
  const a = sheetSurfacePoint(sheet, arr, Math.max(0, gu - e), gv, new THREE.Vector3());
  const b = sheetSurfacePoint(sheet, arr, Math.min(sheet.cols - 1, gu + e), gv, new THREE.Vector3());
  const c = sheetSurfacePoint(sheet, arr, gu, Math.max(0, gv - e), new THREE.Vector3());
  const d = sheetSurfacePoint(sheet, arr, gu, Math.min(sheet.rows - 1, gv + e), new THREE.Vector3());
  return out.crossVectors(d.sub(c), b.sub(a)).normalize();
}

// A sheet's render mesh: a thin closed slab (the outside, the inside and the
// edges between them) on a grid finer than the particles. Each vertex only
// carries where it lies on the grid; the vertex shader rebuilds the surface
// through the particles every frame (smooth, with exact normals), so nothing
// but the particle positions is uploaded. mat: the material id it is drawn
// with.
export function sheetGeometry(sheet, rest, mat) {
  const { cols, rows, subU, subV } = sheet;
  const nu = (cols - 1) * subU + 1;
  const nv = (rows - 1) * subV + 1;
  const ns = nu * nv;
  const pos = [];
  const cape = [];
  const edge = [];
  const det = [];
  const idx = [];
  const P = [];
  const p = new THREE.Vector3();
  for (let jv = 0; jv < nv; jv++) {
    for (let iu = 0; iu < nu; iu++) P.push(sheetSurfacePoint(sheet, rest, iu / subU, jv / subV, p).clone());
  }
  const at = (iu, jv) => jv * nu + iu;
  const eu = (iu) => (iu === 0 ? -1 : iu === nu - 1 ? 1 : 0);
  const ev = (jv) => (jv === 0 ? -1 : jv === nv - 1 ? 1 : 0);
  // kind: 0 inside a sheet, 1 on a sheet's border, 2 on an edge strip
  const vert = (iu, jv, side, kind) => {
    const k = at(iu, jv);
    pos.push(P[k].x, P[k].y, P[k].z);
    cape.push(iu / subU, jv / subV, side, kind);
    edge.push(eu(iu), ev(jv));
    det.push(iu / (nu - 1), jv / (nv - 1), 0, side < 0 ? 1 : 0);
    return pos.length / 3 - 1;
  };
  for (const side of [1, -1]) {
    for (let jv = 0; jv < nv; jv++) {
      for (let iu = 0; iu < nu; iu++) vert(iu, jv, side, eu(iu) || ev(jv) ? 1 : 0);
    }
  }
  for (let jv = 0; jv < nv - 1; jv++) {
    for (let iu = 0; iu < nu - 1; iu++) {
      const A = at(iu, jv), B = at(iu + 1, jv), Cc = at(iu, jv + 1), D = at(iu + 1, jv + 1);
      idx.push(A, Cc, B, B, Cc, D);
      idx.push(ns + A, ns + B, ns + Cc, ns + B, ns + D, ns + Cc);
    }
  }
  // the edges round the slab, wound to face outward (checked on the rest shape)
  const nrm = new THREE.Vector3();
  const outDir = new THREE.Vector3();
  const along = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const strip = (cells) => {
    for (let s = 0; s < cells.length - 1; s++) {
      const [i0, j0] = cells[s];
      const [i1, j1] = cells[s + 1];
      const o0 = vert(i0, j0, 1, 2), l0 = vert(i0, j0, -1, 2);
      const o1 = vert(i1, j1, 1, 2), l1 = vert(i1, j1, -1, 2);
      // outward: away from the sheet's interior, in its plane; the quad's
      // face normal is (inside - outside) x along = -normal x along
      const k0 = at(i0, j0);
      outDir.subVectors(P[k0], P[at(i0 - eu(i0), j0 - ev(j0))]);
      along.subVectors(P[at(i1, j1)], P[k0]);
      sheetNormal(sheet, rest, i0 / subU, j0 / subV, nrm);
      fn.crossVectors(nrm.negate(), along);
      if (fn.dot(outDir) >= 0) idx.push(o0, l0, o1, o1, l0, l1);
      else idx.push(o0, o1, l0, o1, l1, l0);
    }
  };
  strip(Array.from({ length: nv }, (_, j) => [0, j]));
  strip(Array.from({ length: nv }, (_, j) => [nu - 1, j]));
  strip(Array.from({ length: nu }, (_, i) => [i, nv - 1]));
  strip(Array.from({ length: nu }, (_, i) => [i, 0]));
  const geo = new THREE.BufferGeometry();
  const count = pos.length / 3;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aCape', new THREE.BufferAttribute(new Float32Array(cape), 4));
  geo.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(edge), 2));
  geo.setAttribute('aD', new THREE.BufferAttribute(new Float32Array(det), 4));
  geo.setAttribute('aMat', new THREE.BufferAttribute(new Uint8Array(count).fill(mat), 1));
  geo.setIndex(new THREE.BufferAttribute(count < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), 1));
  return geo;
}

// Curvature of the cloth through particle o between its neighbours a and b,
// along the normal there (1/m; > 0 bending toward the outside).
function curve(P, N, o, a, b) {
  const lx = P[a] + P[b] - 2 * P[o], ly = P[a + 1] + P[b + 1] - 2 * P[o + 1], lz = P[a + 2] + P[b + 2] - 2 * P[o + 2];
  const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
  return (4 * (lx * N[o] + ly * N[o + 1] + lz * N[o + 2])) / Math.max(1e-6, dx * dx + dy * dy + dz * dz);
}

// Hand the particles to the shader (data: cols x rows RGBA floats), in the
// runner's own space (invQ undoes the simulation space's turn), with how
// deeply the cloth curves at each (1/m, toward its outside; across plus a
// share along, softened over the neighbours so only real folds and waves
// count). K: scratch, one float per particle.
const _wp = new THREE.Vector3();
export function writeSheet(cloth, data, K, invQ) {
  const { cols, rows } = cloth;
  const D = data;
  const P = cloth.p, Nn = cloth.nrm;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const o = k * 3;
      let c = 0;
      if (i > 0 && i < cols - 1) c += curve(P, Nn, o, o - 3, o + 3);
      if (j > 0 && j < rows - 1) c += 0.6 * curve(P, Nn, o, o - cols * 3, o + cols * 3);
      K[k] = c;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        let sum = K[k] * 2, w = 2;
        if (i > 0) (sum += K[k - 1]), w++;
        if (i < cols - 1) (sum += K[k + 1]), w++;
        if (j > 0) (sum += K[k - cols]), w++;
        if (j < rows - 1) (sum += K[k + cols]), w++;
        D[k * 4 + 3] = sum / w;
      }
    }
    for (let k = 0; k < cols * rows; k++) K[k] = D[k * 4 + 3];
  }
  for (let k = 0; k < cols * rows; k++) {
    _wp.fromArray(P, k * 3).applyQuaternion(invQ);
    D[k * 4] = _wp.x;
    D[k * 4 + 1] = _wp.y;
    D[k * 4 + 2] = _wp.z;
  }
}
