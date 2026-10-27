import * as THREE from '../../vendor/three/three.module.min.js';
import { runner, runnerArrays } from './runner-asset.js';
import { smooth } from './rig.js';
import { Cloth } from './cloth.js';

// The runner's look: a young wayfarer in a quilted puffer, cargo shorts and
// hiking boots under a crimson hooded cape. The body and clothes are sculpted
// offline (tools/runner/build.py); this module holds the palette those
// surfaces are coloured with, the rig constants that came with them, the
// mantle's shape (the cape hangs from its hem and the arms push its panels),
// and the cape itself — built here because it is a simulated cloth grid.

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
  9: '#c4383c', // mantle
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
  20: '#e2b04e', // gold trim
  21: '#7a2230', // lining
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

// Rig constants generated with the mesh (hip height, limb lengths, mantle...).
export const RIG = {};
export const MANTLE = {};
export const CAPE = {
  cols: 13, rows: 13, sub: 2, spanTop: 1.1, spanBot: 1.26, rBot: 0.34, lenMid: 0.56, lenSide: 0.47,
  folds: 3.5, pleat: 0.03, thick: 0.008,
};

export function configureRig() {
  if (RIG.ready) return RIG;
  Object.assign(RIG, runner().meta.rig, { ready: true });
  Object.assign(MANTLE, RIG.mantle);
  MANTLE.hingeR = mantleR(MANTLE.hinge);
  MANTLE.len = Math.hypot(MANTLE.profile[0][0] - MANTLE.hingeR, MANTLE.hinge - MANTLE.hem);
  MANTLE.rest = Math.atan2(MANTLE.profile[0][0] - MANTLE.hingeR, MANTLE.hinge - MANTLE.hem);
  CAPE.pinY = MANTLE.hem + 0.012;
  CAPE.rTop = mantleR(CAPE.pinY) - 0.008;
  return RIG;
}

// --- the mantle: an elliptical bell over the shoulders ------------------------------
export function mantleEZ(y) {
  const [a, b, y0, y1] = MANTLE.ez;
  return a + (b - a) * smooth(y0, y1, y);
}

export function mantleR(y) {
  const tab = MANTLE.profile;
  if (y <= tab[0][1]) return tab[0][0];
  for (let i = 1; i < tab.length; i++) {
    if (y <= tab[i][1]) {
      const [r0, y0] = tab[i - 1];
      const [r1, y1] = tab[i];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
  }
  return tab[tab.length - 1][0];
}

// Bone weights over the mantle (as the generator gives its vertices): rigid on
// the chest above the hinge line, then blended between neighbouring panels and
// down each panel's two hinges.
export function mantleWeights(I) {
  const NP = MANTLE.panels;
  return (x, y, z, out) => {
    let th = Math.atan2(x, z / mantleEZ(y));
    if (th < 0) th += Math.PI * 2;
    const u = (th / (Math.PI * 2)) * NP;
    const k = Math.floor(u) % NP;
    const f = u - Math.floor(u);
    const k1 = (k + 1) % NP;
    const below = MANTLE.hinge - y;
    const gu = smooth(-0.025, 0.02, below);
    const gl = smooth(0.045, 0.105, below);
    const push = (b, w) => {
      if (w > 1e-4) out.push(b, w);
    };
    push(I.chest, 1 - gu);
    push(I['mtU' + k], (1 - f) * (1 - gl) * gu);
    push(I['mtU' + k1], f * (1 - gl) * gu);
    push(I['mtL' + k], (1 - f) * gl * gu);
    push(I['mtL' + k1], f * gl * gu);
  };
}

// --- the cape: hung inside the mantle's hem, a grid of simulated particles ----------
// Rest shape: u 0..1 across (left to right seen from behind), v 0..1 from the
// shoulders to the hem — a flared bell, longer at the middle of the back,
// with drape folds deepening toward the hem (the bend constraints remember
// them, so it hangs in folds and the wind opens them out).
export function capePoint(u, v, out) {
  const c = u * 2 - 1;
  const len = CAPE.lenMid + (CAPE.lenSide - CAPE.lenMid) * c * c;
  const flare = Math.pow(v, 0.85);
  const th = c * (CAPE.spanTop + (CAPE.spanBot - CAPE.spanTop) * flare);
  const r = CAPE.rTop + (CAPE.rBot - CAPE.rTop) * flare + CAPE.pleat * Math.pow(v, 0.8) * Math.cos(c * Math.PI * CAPE.folds);
  const ez = 0.72 + 0.12 * flare;
  const drop = Math.sqrt(len * len - (CAPE.rBot - CAPE.rTop) ** 2) * v;
  return out.set(Math.sin(th) * r, CAPE.pinY - drop, Math.cos(th) * r * ez);
}

export function capeBind() {
  const { cols, rows } = CAPE;
  const arr = new Float32Array(cols * rows * 3);
  const v = new THREE.Vector3();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) capePoint(i / (cols - 1), j / (rows - 1), v).toArray(arr, (j * cols + i) * 3);
  }
  return arr;
}

export function capeFrame(bind, i, j, out) {
  return Cloth.frame(bind, CAPE.cols, CAPE.rows, i, j, out);
}

// The cape as a thin closed slab (outside, lining, edges) on a vertex grid
// twice as fine as the particles; each vertex follows the four particle bones
// around it. Same attribute layout as the sculpted mesh.
function capeArrays(firstBone, mat) {
  const { cols, rows, sub, thick } = CAPE;
  const nu = (cols - 1) * sub + 1;
  const nv = (rows - 1) * sub + 1;
  const ns = nu * nv;
  const P = [];
  const N = [];
  const U = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let jv = 0; jv < nv; jv++) {
    for (let iu = 0; iu < nu; iu++) {
      const u = iu / (nu - 1);
      const v = jv / (nv - 1);
      capePoint(u, v, a);
      const du = capePoint(u + 1e-3, v, b).sub(a);
      const dv = capePoint(u, v + 1e-3, c).sub(a);
      P.push(a.clone());
      N.push(new THREE.Vector3().crossVectors(dv, du).normalize());
      U.push(du.normalize().clone());
    }
  }
  const at = (iu, jv) => jv * nu + iu;
  // outward direction of the slab's edge at a border sample
  const edgeDir = (k) => {
    const iu = k % nu;
    const jv = Math.floor(k / nu);
    const e = new THREE.Vector3();
    if (iu === 0) e.sub(U[k]);
    if (iu === nu - 1) e.add(U[k]);
    const up = new THREE.Vector3().crossVectors(N[k], U[k]);
    if (jv === 0) e.add(up);
    if (jv === nv - 1) e.sub(up);
    return e.normalize();
  };
  const pos = [];
  const nrm = [];
  const onrm = [];
  const det = [];
  const skinI = [];
  const skinW = [];
  const idx = [];
  const h = thick / 2;
  const weights = (k) => {
    const gu = ((k % nu) / (nu - 1)) * (cols - 1);
    const gv = (Math.floor(k / nu) / (nv - 1)) * (rows - 1);
    const i0 = Math.min(cols - 2, Math.floor(gu));
    const j0 = Math.min(rows - 2, Math.floor(gv));
    const fu = gu - i0;
    const fv = gv - j0;
    const w = [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv].map((x) => Math.floor(x * 255));
    const big = w.indexOf(Math.max(...w));
    w[big] += 255 - (w[0] + w[1] + w[2] + w[3]);
    const id = (i, j) => firstBone + j * cols + i;
    skinI.push(id(i0, j0), id(i0 + 1, j0), id(i0, j0 + 1), id(i0 + 1, j0 + 1));
    skinW.push(...w);
  };
  const vert = (k, side, n, o) => {
    const s = side ? -h : h;
    pos.push(P[k].x + N[k].x * s, P[k].y + N[k].y * s, P[k].z + N[k].z * s);
    nrm.push(n.x, n.y, n.z);
    onrm.push(o.x * 0.6, o.y * 0.6, o.z * 0.6);
    det.push((k % nu) / (nu - 1), Math.floor(k / nu) / (nv - 1), 0, side ? 1 : 0);
    weights(k);
    return pos.length / 3 - 1;
  };
  const border = (k) => k % nu === 0 || k % nu === nu - 1 || k < nu || k >= ns - nu;
  const outline = (k, side) => {
    const n = side ? N[k].clone().negate() : N[k].clone();
    return border(k) ? n.add(edgeDir(k)).normalize() : n;
  };
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < ns; k++) vert(k, side, side ? N[k].clone().negate() : N[k], outline(k, side));
  }
  for (let jv = 0; jv < nv - 1; jv++) {
    for (let iu = 0; iu < nu - 1; iu++) {
      const A = at(iu, jv);
      const B = at(iu + 1, jv);
      const Cc = at(iu, jv + 1);
      const D = at(iu + 1, jv + 1);
      idx.push(A, Cc, B, B, Cc, D);
      idx.push(ns + A, ns + B, ns + Cc, ns + B, ns + D, ns + Cc);
    }
  }
  // closed edges round the slab
  const strip = (ks) => {
    for (let i = 0; i < ks.length - 1; i++) {
      const k0 = ks[i];
      const k1 = ks[i + 1];
      const e0 = edgeDir(k0);
      const e1 = edgeDir(k1);
      const o0 = vert(k0, 0, e0, outline(k0, 0));
      const i0 = vert(k0, 1, e0, outline(k0, 1));
      const o1 = vert(k1, 0, e1, outline(k1, 0));
      const i1 = vert(k1, 1, e1, outline(k1, 1));
      const pa = new THREE.Vector3().fromArray(pos, o0 * 3);
      const fn = new THREE.Vector3().fromArray(pos, i0 * 3).sub(pa).cross(new THREE.Vector3().fromArray(pos, o1 * 3).sub(pa));
      if (fn.dot(e0) >= 0) idx.push(o0, i0, o1, o1, i0, i1);
      else idx.push(o0, o1, i0, o1, i1, i0);
    }
  };
  strip(Array.from({ length: nv }, (_, j) => at(0, j)));
  strip(Array.from({ length: nv }, (_, j) => at(nu - 1, j)));
  strip(Array.from({ length: nu }, (_, i) => at(i, nv - 1)));
  strip(Array.from({ length: nu }, (_, i) => at(i, 0)));
  const count = pos.length / 3;
  return {
    count,
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    onrm: new Float32Array(onrm),
    detail: new Float32Array(det),
    material: new Uint8Array(count).fill(mat),
    skinIndex: new Uint8Array(skinI),
    skinWeight: new Uint8Array(skinW),
    index: idx,
  };
}

// The whole runner as one indexed skinned geometry: the sculpted surfaces plus
// the cape (whose particle bones start at capeBone).
export function buildRunnerGeometry(capeBone) {
  const body = runnerArrays();
  const cape = capeArrays(capeBone, runner().meta.materials.cape);
  const count = body.count + cape.count;
  const cat = (Type, k, size) => {
    const out = new Type(count * size);
    out.set(body[k]);
    out.set(cape[k], body.count * size);
    return out;
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(cat(Float32Array, 'position', 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(cat(Float32Array, 'normal', 3), 3));
  geo.setAttribute('onrm', new THREE.BufferAttribute(cat(Float32Array, 'onrm', 3), 3));
  geo.setAttribute('aD', new THREE.BufferAttribute(cat(Float32Array, 'detail', 4), 4));
  geo.setAttribute('aMat', new THREE.BufferAttribute(cat(Uint8Array, 'material', 1), 1));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(cat(Uint8Array, 'skinIndex', 4), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(cat(Uint8Array, 'skinWeight', 4), 4, true));
  const Index = count < 65536 ? Uint16Array : Uint32Array;
  const index = new Index(body.index.length + cape.index.length);
  index.set(body.index);
  for (let i = 0; i < cape.index.length; i++) index[body.index.length + i] = cape.index[i] + body.count;
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}
