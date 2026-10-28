import * as THREE from '../../vendor/three/three.module.min.js';
import { runner, runnerArrays } from './runner-asset.js';
import { Cloth } from './cloth.js';

// The runner's look: a young wayfarer in a quilted puffer, cargo shorts and
// hiking boots under a crimson hooded cape. The body and clothes are sculpted
// offline (tools/runner/build.py) — of the cape, only what sits still at the
// neck: the gathered collar roll and the hood lying on the upper back. This
// module holds the palette those surfaces are coloured with, the rig
// constants that came with them, and the cape itself: one continuous piece of
// cloth sewn under the collar, draped over the shoulders, open round the arms
// and hanging to the upper calf behind — simulated as a particle grid
// (cloth.js) and drawn as a smooth surface through those particles.

// Palette slots: 1-12 are the garment ids baked into the mesh, the rest are
// colours the character shader draws details with.
export const COL = {
  1: '#cc8a6c', // face (skin)
  2: '#4a2e22', // hair
  3: '#e9b374', // puffer
  4: '#8e7c80', // tee
  5: '#695863', // shorts
  6: '#cc8a6c', // legs (skin)
  7: '#b5835a', // boots
  8: '#cc8a6c', // hands (skin)
  9: '#c4383c', // hood and collar
  10: '#c4383c', // cape
  11: '#8a5d3b', // pouch
  12: '#e0b54c', // brass
  13: '#c48a54', // quilting seams
  14: '#d19a5c', // ribbed cuffs
  15: '#4f372e', // socks
  16: '#8b5f45', // boot toe cap, heel, collar
  17: '#6b3f2e', // outsole
  18: '#d6b48c', // midsole
  19: '#2f1f18', // laces
  21: '#8a2733', // lining
  22: '#f4ece4', // eye whites
  23: '#4b2a1d', // irises
  24: '#24140e', // lash line, brows, pupils
  25: '#7a3428', // mouth
  26: '#de7b66', // blush
  27: '#6e4628', // pouch flap
  28: '#56474f', // shorts hem fold
  29: '#8a6040', // zip
  30: '#6a4331', // hair highlight
};

export function palette() {
  return Array.from({ length: 32 }, (_, i) => new THREE.Color(COL[i] || '#ff00ff'));
}

// Rig constants generated with the mesh (hip height, limb lengths, collar...).
export const RIG = {};

// The cape. cols x rows particles; u runs across (0 at the left front edge,
// round the back, 1 at the right), v down from the collar to the hem.
export const CAPE = {
  cols: 19,
  rows: 19,
  gap: 0.5, // opening at the throat (radians round the neck)
  hang: 1.45, // where the front edges fall from (radians from the back)
  hemBack: 0.38, // hem height at the middle of the back (upper calf)...
  hemRise: 0.09, // ...rising this much toward the front edges
  flare: 0.03, // how far the hem stands out from the shoulders' line
  tuck: 0.2, // how far the sides swing in behind the arms as they hang
  folds: 3.5, // soft folds round the back at rest
  pleat: 0.04,
  thick: 0.008,
  subU: 3, // render vertices per particle cell, across and down
  subV: 2,
  margin: 0.014, // how far it is kept off every surface (half its thickness and an ink line)
};

export function configureRig() {
  if (RIG.ready) return RIG;
  Object.assign(RIG, runner().meta.rig, { ready: true });
  return RIG;
}

const smooth01 = (t) => t * t * (3 - 2 * t);

// The line the cloth leaves the body along, as an ellipse round the shoulders
// (half-width, depth behind and in front of the body's middle).
const HULL = { w: 0.265, back: 0.15, front: 0.13, z: 0.012 };
function hull(th, scale, y, out) {
  const s = Math.sin(th), c = Math.cos(th);
  return out.set(s * HULL.w * scale, y, HULL.z + c * (c > 0 ? HULL.back : HULL.front) * scale);
}

// A point on the line the cloth is sewn along, just under the collar roll
// (th = 0 at the back, +pi/2 toward the right shoulder).
function neckline(th, out) {
  const C = RIG.collar;
  const z = Math.cos(th) * C.R * C.sz;
  return out.set(Math.sin(th) * C.R, C.c[1] - 0.006 + C.slope * z, C.c[2] + z);
}

// The rest drape, built the way the cape would fall onto the body as bound:
// each column leaves the collar outward and curves down over the shoulder,
// then hangs — its sides swinging in behind the arms, flaring a little toward
// a hem that is nearly level (a touch higher at the front edges), with soft
// folds round the back. That first guess is then let fall under gravity onto
// the body's own volumes, so it rests on the shoulders and settles into a
// natural drape.
export function capeBind(colliders) {
  const { cols, rows } = CAPE;
  const pts = new Float32Array(cols * rows * 3);
  const N = new THREE.Vector3();
  const S = new THREE.Vector3();
  const K = new THREE.Vector3();
  const a = new THREE.Vector3();
  const path = [];
  for (let i = 0; i < cols; i++) {
    const c = (i / (cols - 1)) * 2 - 1;
    const thN = c * (Math.PI - CAPE.gap / 2);
    const thH = c * CAPE.hang;
    neckline(thN, N);
    // where it leaves the body: the shoulder's edge at the sides, the upper
    // back behind, the front of the shoulder at the front edges
    const s2 = Math.sin(thH) ** 2;
    hull(thH, 1, 1.14 + 0.05 * s2, S);
    K.set(S.x * 0.92 + N.x * 0.08, N.y - 0.004 - 0.02 * (1 - s2), S.z * 0.92 + N.z * 0.08);
    // dense polyline of the column: over the shoulder (a quadratic curve,
    // leaving the collar level and arriving at the edge heading down)...
    path.length = 0;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      path.push(new THREE.Vector3().copy(N).multiplyScalar((1 - t) * (1 - t)).addScaledVector(K, 2 * (1 - t) * t).addScaledVector(S, t * t));
    }
    // ...then hanging: the sides swing in behind the arms as they fall (the
    // cloth gathers into folds rather than spreading over them), standing
    // out a little toward the hem
    const hem = CAPE.hemBack + CAPE.hemRise * c * c;
    const drop = S.y - hem + 0.25;
    for (let k = 1; k <= 60; k++) {
      const f = k / 60;
      const th = thH * (1 - CAPE.tuck * smooth01(Math.min(1, f * 1.6)));
      const fl = CAPE.flare * Math.pow(Math.min(1, f * 1.2), 1.3);
      const pl = CAPE.pleat * Math.pow(f, 0.8) * Math.cos(c * Math.PI * CAPE.folds) * (1 - 0.5 * Math.abs(c));
      // (flare and folds as a share of the hull's ~0.2 m radius)
      path.push(hull(th, 1 + (fl + pl) / 0.2, S.y - drop * f, new THREE.Vector3()));
    }
    // the length of cloth from the collar to the hem
    let total = 0;
    const acc = [0];
    for (let k = 1; k < path.length; k++) acc.push((total += path[k].distanceTo(path[k - 1])));
    const Lc = acc[41 - 1] + (S.y - hem);
    for (let j = 0; j < rows; j++) {
      const s = (j / (rows - 1)) * Lc;
      let k = 1;
      while (k < acc.length - 1 && acc[k] < s) k++;
      const f = (s - acc[k - 1]) / Math.max(1e-6, acc[k] - acc[k - 1]);
      a.copy(path[k - 1]).lerp(path[k], Math.min(1, f)).toArray(pts, (j * cols + i) * 3);
    }
  }
  if (!colliders) return pts;
  // let it fall into place on the body
  const cloth = new Cloth(cols, rows, pts);
  setColliders(cloth, colliders, null, null);
  cloth.place((v) => v);
  for (let i = 0; i < cols * 3; i++) cloth.pinA[i] = cloth.pinB[i] = pts[i];
  const f = { gx: 0, gy: -9.8, gz: 0, ax: 0, ay: 0, az: 0, wake: 0, draw: 0, gust: 0, gustSpeed: 1, gustLen: 1, curl: 0, kn: 0.2, kt: 0.05, damp: 6, floor: -10, lift: 0.2, t: 0 };
  for (let k = 0; k < 150; k++) {
    f.t += 1 / 60;
    cloth.step(1 / 60, f);
  }
  return Float32Array.from(cloth.p);
}

// What the cloth is kept out of, each with the bone that carries it, in bind
// space: the jacket's own volumes and the shorts' seat (from the sculpt), the
// head and neck, legs, boots and pouch. Limbs come first, the body's
// ellipsoids last (the cloth resolves them in this order).
export function capeColliders(bindPos) {
  const out = RIG.cloth.filter((c) => c.kind !== 'ell');
  const body = RIG.cloth.filter((c) => c.kind === 'ell');
  const at = (bone, dx, dy, dz) => [bindPos[bone].x + dx, bindPos[bone].y + dy, bindPos[bone].z + dz];
  out.push({ bone: 'head', kind: 'cap', a: at('head', 0, 0.06, 0.01), b: at('head', 0, 0.12, 0.01), ra: 0.115, rb: 0.115 });
  out.push({ bone: 'neck', kind: 'cap', a: at('neck', 0, -0.01, 0.006), b: at('neck', 0, 0.09, 0.003), ra: 0.05, rb: 0.048 });
  out.push({ bone: 'pouch', kind: 'cap', a: at('pouch', -0.012, -0.04, 0), b: at('pouch', -0.012, -0.09, 0), ra: 0.045, rb: 0.045 });
  for (const L of ['L', 'R']) {
    const th = RIG.thigh, sh = RIG.shin;
    out.push({ bone: 'thigh' + L, kind: 'cap', a: at('thigh' + L, 0, 0, 0.004), b: at('thigh' + L, 0, -th, 0), ra: 0.085, rb: 0.055 });
    out.push({ bone: 'shin' + L, kind: 'cap', a: at('shin' + L, 0, 0, 0.004), b: at('shin' + L, 0, -sh + 0.09, 0.012), ra: 0.05, rb: 0.052 });
    out.push({ bone: 'foot' + L, kind: 'cap', a: at('foot' + L, 0, 0.13, 0.006), b: at('foot' + L, 0, -0.03, 0.04), ra: 0.058, rb: 0.062 });
    out.push({ bone: 'foot' + L, kind: 'cap', a: at('foot' + L, 0, -0.035, 0.04), b: at('foot' + L, 0, -0.045, -0.12), ra: 0.06, rb: 0.055 });
  }
  return out.concat(body).map((c) => ({ ...c }));
}

// Write colliders into the cloth's space. M(bone) gives the bone's skinning
// matrix (current pose * inverse bind) or null for the bind pose; Q rotates
// root space into simulation space (or null).
const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _id = new THREE.Matrix4();
export function setColliders(cloth, defs, M, Q) {
  cloth.setColliderCount(defs.length);
  const m = CAPE.margin;
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
      const axes = [c.ax, c.ay, c.az];
      for (let e = 0; e < 3; e++) {
        _ax.setFromMatrixColumn(T, e).normalize();
        if (Q) _ax.applyQuaternion(Q);
        _ax.toArray(axes[e]);
        c.r2[e] = 1 / ((d.r[e] + m) * (d.r[e] + m));
      }
      const R = Math.max(...d.r) + m;
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
function capeSurfacePoint(arr, gu, gv, out) {
  const { cols, rows } = CAPE;
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

// The cape's render mesh: a thin closed slab (the outside, the lining and the
// edges between them) on a grid finer than the particles. Each vertex only
// carries where it lies on the grid; the vertex shader rebuilds the surface
// through the particles every frame (smooth, with exact normals), so nothing
// but the particle positions is uploaded.
export function capeGeometry(rest) {
  const { cols, rows, subU, subV } = CAPE;
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
    for (let iu = 0; iu < nu; iu++) P.push(capeSurfacePoint(rest, iu / subU, jv / subV, p).clone());
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
      // face normal is (lining - outside) x along = -normal x along
      const k0 = at(i0, j0);
      outDir.subVectors(P[k0], P[at(i0 - eu(i0), j0 - ev(j0))]);
      along.subVectors(P[at(i1, j1)], P[k0]);
      capeNormal(rest, i0 / subU, j0 / subV, nrm);
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
  geo.setAttribute('aMat', new THREE.BufferAttribute(new Uint8Array(count).fill(runner().meta.materials.cape), 1));
  geo.setIndex(new THREE.BufferAttribute(count < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), 1));
  return geo;
}

// The sheet's outward normal at a grid point (down x across).
function capeNormal(arr, gu, gv, out) {
  const e = 0.01;
  const a = capeSurfacePoint(arr, Math.max(0, gu - e), gv, new THREE.Vector3());
  const b = capeSurfacePoint(arr, Math.min(CAPE.cols - 1, gu + e), gv, new THREE.Vector3());
  const c = capeSurfacePoint(arr, gu, Math.max(0, gv - e), new THREE.Vector3());
  const d = capeSurfacePoint(arr, gu, Math.min(CAPE.rows - 1, gv + e), new THREE.Vector3());
  return out.crossVectors(d.sub(c), b.sub(a)).normalize();
}

// The sculpted body as one indexed skinned geometry.
export function bodyGeometry() {
  const a = runnerArrays();
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
