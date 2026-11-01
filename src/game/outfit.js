import * as THREE from '../../vendor/three/three.module.min.js';
import { Cloth } from './cloth.js';
import { setColliders } from './kit.js';

// The wayfarer's look: a young wayfarer in a quilted puffer, cargo shorts and
// hiking boots under an orange hooded cape. The body and clothes are sculpted
// offline (tools/runner/build.py) — of the cape, only what sits still at the
// neck: the gathered collar roll and the hood lying on the upper back. This
// module holds the palette those surfaces are coloured with and the cape
// itself (its rest drape and colliders, from his rig): one continuous piece of
// cloth sewn under the collar, draped over the shoulders, open round the arms
// and hanging to the upper calf behind — simulated as a particle grid
// (cloth.js) and drawn as a smooth surface through those particles.

// Palette slots: 1-12 are the garment ids baked into the mesh, the rest are
// colours the character shader draws details with.
export const COL = {
  1: '#cc8a6c', // face (skin)
  2: '#563427', // hair
  3: '#e9b374', // puffer
  4: '#8e7c80', // tee
  5: '#695863', // shorts
  6: '#cc8a6c', // legs (skin)
  7: '#b5835a', // boots
  8: '#cc8a6c', // hands (skin)
  9: '#f59a3e', // hood and collar
  10: '#f7a043', // cape at the collar...
  11: '#8a5d3b', // pouch
  12: '#e0b54c', // brass
  13: '#c48a54', // quilting seams
  14: '#d19a5c', // ribbed cuffs
  15: '#4f372e', // socks
  16: '#8b5f45', // boot toe cap, heel, collar
  17: '#6b3f2e', // outsole
  18: '#d6b48c', // midsole
  19: '#2f1f18', // laces
  20: '#d4521a', // ...deepening to this at the hem
  21: '#b8501e', // lining
  22: '#f6efe8', // eye whites
  23: '#6a3a1e', // irises (warm brown)
  24: '#24140e', // lash line, brows, pupils
  25: '#7a3428', // mouth
  26: '#de7b66', // blush
  27: '#6e4628', // pouch flap
  28: '#56474f', // shorts hem fold
  29: '#8a6040', // zip
  30: '#7d5039', // hair highlight
};

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
function neckline(rig, th, out) {
  const C = rig.collar;
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
// (rig: the wayfarer's rig constants, from the generated asset)
export function capeBind(rig, colliders) {
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
    neckline(rig, thN, N);
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
  setColliders(cloth, colliders, null, null, CAPE.margin);
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
export function capeColliders(rig, bindPos) {
  const out = rig.cloth.filter((c) => c.kind !== 'ell');
  const body = rig.cloth.filter((c) => c.kind === 'ell');
  const at = (bone, dx, dy, dz) => [bindPos[bone].x + dx, bindPos[bone].y + dy, bindPos[bone].z + dz];
  out.push({ bone: 'head', kind: 'cap', a: at('head', 0, 0.095, 0.012), b: at('head', 0, 0.15, 0.012), ra: 0.115, rb: 0.115 });
  out.push({ bone: 'neck', kind: 'cap', a: at('neck', 0, -0.01, 0.006), b: at('neck', 0, 0.09, 0.003), ra: 0.05, rb: 0.048 });
  out.push({ bone: 'pouch', kind: 'cap', a: at('pouch', -0.012, -0.04, 0), b: at('pouch', -0.012, -0.09, 0), ra: 0.045, rb: 0.045 });
  for (const L of ['L', 'R']) {
    const th = rig.thigh, sh = rig.shin;
    out.push({ bone: 'thigh' + L, kind: 'cap', a: at('thigh' + L, 0, 0, 0.004), b: at('thigh' + L, 0, -th, 0), ra: 0.085, rb: 0.055 });
    out.push({ bone: 'shin' + L, kind: 'cap', a: at('shin' + L, 0, 0, 0.004), b: at('shin' + L, 0, -sh + 0.09, 0.012), ra: 0.05, rb: 0.052 });
    out.push({ bone: 'foot' + L, kind: 'cap', a: at('foot' + L, 0, 0.13, 0.006), b: at('foot' + L, 0, -0.03, 0.04), ra: 0.058, rb: 0.062 });
    out.push({ bone: 'foot' + L, kind: 'cap', a: at('foot' + L, 0, -0.035, 0.04), b: at('foot' + L, 0, -0.045, -0.12), ra: 0.06, rb: 0.055 });
  }
  return out.concat(body).map((c) => ({ ...c }));
}
