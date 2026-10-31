import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, moved, rod } from './shapes.js';
import { CONFIG } from '../config.js';

// The Cypress Lane's market and street: storybook fruit (a little larger than
// life, so it reads at a run, each piece with the one detail that makes it
// that fruit at a glance), the market's crates, baskets, raspberry beds and
// carts that stand in the road (the obstacles), the bus stop's timetable sign
// hung over a lane, and the shops, stalls and street furniture along the
// verge that make the lane a neighbourhood.
//
// Every obstacle keeps to its kind's grammar: the low ones (crates, baskets,
// a raspberry bed) stay under a metre and solid to the ground; the carts are
// tall and solid; the timetable hangs with its bottom edge on the duck line
// and open road beneath. Each sits inside its lane (|x| <= 1) and its length.

export const F = {
  orange: '#f68a22',
  orangeLo: '#e0661a',
  apple: '#86c23a',
  appleHi: '#c6e65a',
  appleRed: '#d8402e',
  grapefruit: '#f8cf5a',
  blush: '#f2875a',
  flesh: '#ff6670',
  pith: '#ffe6cf',
  rasp: '#c81e44',
  raspHi: '#ff4a6a',
  lemon: '#f8e03a',
  pear: '#b8cc3e',
  pearHi: '#e8e070',
  plum: '#5a2266',
  plumHi: '#9a4aa8',
  banana: '#f6d443',
  leaf: '#3f8a2a',
  leafHi: '#8cc83a',
  stem: '#5a3a1a',
  cane: '#7a3a2a',
  wood: '#c08446',
  woodDark: '#6e4a26',
  woodPale: '#e0b070',
  wicker: '#cf9e52',
  wickerDark: '#8a6430',
  soil: '#4a3220',
  cream: '#fff3d0',
  slate: '#2e3a36',
};

const seeded = (seed) => {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
};

// --- fruit ----------------------------------------------------------------------
// Each sits on the surface at y. The obstacles, seen close, get the full
// detail; scenery is built in low detail (lowDetail), the same fruit in a
// fraction of the triangles.
let detail = 1;
function lowDetail(build) {
  const was = detail;
  detail = 0;
  try {
    return build();
  } finally {
    detail = was;
  }
}
const ball = (r) => P.sphere(r, detail ? 8 : 6, detail ? 6 : 4);

function leaf(parts, x, y, z, ry, s = 1) {
  parts.push(part(P.sphere(0.06 * s, 6, 4), null, {
    x: x + Math.cos(ry) * 0.05 * s, y, z: z - Math.sin(ry) * 0.05 * s, sy: 0.22, sz: 0.48, ry, rz: 0.35,
    grad: [F.leaf, F.leafHi, y - 0.02, y + 0.03], outline: 0.4,
  }));
}

export function orange(parts, x, y, z, { r = 0.11, leafy = false, ry = 0 } = {}) {
  parts.push(part(ball(r), null, { x, y: y + r * 0.94, z, sy: 0.94, grad: [F.orangeLo, F.orange, y, y + r * 1.6], outline: 0.6 }));
  if (!detail) return;
  parts.push(part(P.cyl(0.016, 0.016, 0.03, 5), '#4a6a1a', { x, y: y + r * 1.88, z, outline: 0 }));
  if (leafy) leaf(parts, x, y + r * 1.9, z, ry);
}

// A green apple: the dimpled top and bottom, a stem, now and then a leaf.
const APPLE = [[0, 0.014], [0.04, 0], [0.085, 0.024], [0.106, 0.072], [0.1, 0.122], [0.076, 0.158], [0.036, 0.168], [0.012, 0.15], [0, 0.146]];
export function apple(parts, x, y, z, { color = F.apple, hi = F.appleHi, s = 1, leafy = false, ry = 0 } = {}) {
  parts.push(part(P.lathe(APPLE, detail ? 9 : 6), null, { x, y, z, s, ry, grad: [color, hi, y + 0.02 * s, y + 0.17 * s], outline: 0.6 }));
  parts.push(part(P.cyl(0.008, 0.011, 0.07, 4), F.stem, { x: x + 0.012, y: y + 0.175 * s, z, rz: -0.35, outline: 0 }));
  if (leafy && detail) leaf(parts, x + 0.02, y + 0.19 * s, z, ry, 0.9);
}

// A ruby grapefruit: big, yellow with a red-pink blush.
export function grapefruit(parts, x, y, z, { r = 0.145 } = {}) {
  parts.push(part(ball(r), null, { x, y: y + r * 0.93, z, sy: 0.93, grad: [F.blush, F.grapefruit, y + r * 0.2, y + r * 1.5], outline: 0.6 }));
  if (detail) parts.push(part(P.cyl(0.02, 0.02, 0.02, 5), '#7a8a2a', { x, y: y + r * 1.86, z, outline: 0 }));
}

// A grapefruit cut in half, its pink flesh turned up (rx tips it toward the
// camera): a yellow rind cup, a pale pith ring and the segments radiating
// from the middle.
export function grapefruitHalf(parts, x, y, z, { r = 0.145, rx = 0.6, ry = 0 } = {}) {
  const l = [
    part(new THREE.SphereGeometry(r, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), null, { grad: [F.blush, F.grapefruit, -r, 0], outline: 0.6 }),
    part(P.cyl(r, r, 0.012, 14), F.pith, { y: 0.004, outline: 0 }),
    part(P.cyl(r * 0.86, r * 0.86, 0.012, 14), F.flesh, { y: 0.01, outline: 0 }),
    part(P.cyl(0.018, 0.018, 0.012, 6), F.pith, { y: 0.017, outline: 0 }),
  ];
  const spokes = detail ? 8 : 4;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * (detail ? 2 : 1);
    l.push(part(P.box(0.009, 0.006, r * (detail ? 0.84 : 1.7)), F.pith, { x: detail ? Math.sin(a) * r * 0.43 : 0, y: 0.018, z: detail ? Math.cos(a) * r * 0.43 : 0, ry: a, outline: 0 }));
  }
  parts.push(...moved(l, { x, y: y + r * 0.62, z, rx, ry }));
}

export function lemon(parts, x, y, z, { ry = 0 } = {}) {
  parts.push(part(ball(0.075), null, { x, y: y + 0.068, z, sx: 1.32, sy: 0.92, ry, grad: ['#e8c42a', F.lemon, y, y + 0.12], outline: 0.6 }));
  if (detail) for (const s of [-1, 1]) parts.push(part(P.cone(0.022, 0.04, 5), '#e8c42a', { x: x + Math.cos(ry) * s * 0.1, y: y + 0.068, z: z - Math.sin(ry) * s * 0.1, ry, rz: -s * Math.PI / 2, outline: 0 }));
}

const PEAR = [[0, 0], [0.05, 0.006], [0.082, 0.04], [0.086, 0.088], [0.064, 0.14], [0.044, 0.18], [0.036, 0.21], [0.02, 0.236], [0, 0.24]];
export function pear(parts, x, y, z, { rz = 0 } = {}) {
  parts.push(part(P.lathe(PEAR, detail ? 9 : 6), null, { x, y, z, rz, grad: [F.pear, F.pearHi, y + 0.02, y + 0.2], outline: 0.6 }));
  parts.push(part(P.cyl(0.008, 0.01, 0.07, 4), F.stem, { x: x - Math.sin(rz) * 0.25, y: y + Math.cos(rz) * 0.25, z, rz: rz - 0.25, outline: 0 }));
}

export function plum(parts, x, y, z) {
  parts.push(part(ball(0.066), null, { x, y: y + 0.07, z, sy: 1.08, grad: [F.plum, F.plumHi, y, y + 0.14], outline: 0.6 }));
}

// A hand of bananas: curved fingers fanned out from one crown, each with a
// dark tip (the crown at x, y, z; ry turns the hand).
export function bananas(parts, x, y, z, { ry = 0, n = 5 } = {}) {
  const R = 0.36;
  const arc = 1.0;
  const t = 0.046;
  const half = R * Math.sin(arc / 2);
  const l = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    const f = [
      part(P.torus(R, t, 5, 10, arc), null, { rz: -Math.PI / 2 - arc / 2, grad: ['#d8a822', F.banana, -R, -R + 0.06], outline: 0.6 }),
      part(P.sphere(t * 0.85, 5, 4), '#5a4a1a', { x: half, y: -R * Math.cos(arc / 2), outline: 0 }),
    ];
    moved(f, { x: half, y: R * Math.cos(arc / 2) + t });
    l.push(...moved(f, { ry: k * 0.26, y: Math.abs(k) * 0.012, rz: Math.abs(k) * 0.05 }));
  }
  l.push(part(P.cyl(0.03, 0.036, 0.1, 5), '#7a7a2a', { x: -0.03, y: t + 0.02, rz: 1.1, outline: 0.4 }));
  parts.push(...moved(l, { x, y, z, ry }));
}

// A raspberry, hanging from its stalk: a rounded thimble of little drupelets
// round a dark core (ring by ring, smaller toward its foot), deep pink-red.
const DRUPES = [[0.6, 6, 0.35], [0.05, 7, 0], [-0.55, 6, 0.4], [-0.95, 1, 0]];
export function raspberry(parts, x, y, z, { s = 1, tilt = 0 } = {}) {
  const r = 0.062 * s;
  const cy = -r * 1.05;
  const l = [part(P.sphere(r * 0.86, detail ? 7 : 6, detail ? 5 : 4), '#8e1434', { y: cy, sy: 1.12, outline: 0.7 })];
  // (in low detail, just a few drupelets on the side that faces the road)
  for (const [h, n, off] of detail ? DRUPES : DRUPES.slice(0, 2)) {
    const ring = Math.sqrt(1 - h * h) * r * 0.9;
    const rd = r * (0.36 - Math.max(0, -h) * 0.1);
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      if (!detail && Math.sin(a) < 0.3) continue;
      l.push(part(P.sphere(rd, detail ? 5 : 4, 3), null, { x: Math.cos(a) * ring, y: cy + h * r * 1.05, z: Math.sin(a) * ring, grad: [F.rasp, F.raspHi, cy - r, cy + r], outline: 0 }));
    }
  }
  l.push(part(P.cyl(0.007, 0.007, 0.05, 4), '#6a8a3a', { y: 0.02, outline: 0 }));
  l.push(part(P.cyl(r * 0.5, r * 0.3, 0.012, 6), '#9ab84a', { y: cy + r * 1.05, outline: 0 }));
  parts.push(...moved(l, { x, y, z, rz: tilt }));
}

// --- containers -------------------------------------------------------------------

// A slatted market crate (base at y, centred on x/z), with a fruit label on
// its front; fill(list, w, h, d) heaps produce on top in its own frame.
function crate(parts, { x = 0, y = 0, z = 0, w = 0.8, h = 0.5, d = 0.7, ry = 0, label = null, wood = F.wood }, fill) {
  const l = [part(P.box(w - 0.05, h - 0.03, d - 0.05), F.woodDark, { y: h / 2 })];
  const n = h > 0.5 ? 3 : 2;
  const band = (h - 0.02) / n;
  for (let i = 0; i < n; i++) l.push(part(P.box(w, band - 0.045, d), wood, { y: 0.02 + band * (i + 0.5) }));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) l.push(part(P.box(0.07, h, 0.07), F.woodDark, { x: sx * (w / 2 - 0.02), y: h / 2, z: sz * (d / 2 - 0.02), outline: 0.5 }));
  }
  if (label) {
    l.push(part(P.box(Math.min(0.34, w * 0.42), 0.16, 0.012), F.cream, { y: h * 0.55, z: d / 2 + 0.006, outline: 0 }));
    l.push(part(P.cyl(0.05, 0.05, 0.012, 10), label, { y: h * 0.55, z: d / 2 + 0.014, rx: Math.PI / 2, outline: 0 }));
  }
  if (fill) fill(l, w, h, d);
  parts.push(...moved(l, { x, y, z, ry }));
}

// Lay fruit over a w x d top at height y, domed toward the middle.
function heap(l, put, w, d, y, step, dome, seed) {
  const rnd = seeded(seed);
  const nx = Math.max(1, Math.floor(w / step));
  const nz = Math.max(1, Math.floor(d / step));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const fx = ((i + 0.5) / nx - 0.5) * 2;
      const fz = ((j + 0.5) / nz - 0.5) * 2;
      const lift = dome * Math.max(0, 1 - 0.55 * (fx * fx + fz * fz));
      put(l, (fx * (w - step)) / 2 + (rnd() - 0.5) * 0.03, y + lift, (fz * (d - step)) / 2 + (rnd() - 0.5) * 0.03, rnd, i, j);
    }
  }
}

// A round wicker basket (base at y) with a handle arching over it.
function basket(parts, { x = 0, y = 0, z = 0, r = 0.3, h = 0.32, handle = 0.62, ry = 0 }, fill) {
  const l = [
    part(P.lathe([[0, 0], [r * 0.72, 0], [r * 0.86, h * 0.3], [r, h * 0.92], [r * 1.04, h]], 12), null, { grad: [F.wickerDark, F.wicker, 0, h], mark: 0.35 }),
    part(P.torus(r * 1.02, 0.03, 5, 16), F.wickerDark, { y: h, rx: Math.PI / 2, outline: 0.5 }),
    part(P.torus(r * 0.86, 0.018, 4, 16), F.wickerDark, { y: h * 0.45, rx: Math.PI / 2, outline: 0 }),
  ];
  if (handle) l.push(part(P.torus(r * 0.98, 0.026, 5, 12, Math.PI), F.wickerDark, { y: h, sy: handle / (r * 0.98), outline: 0.5 }));
  if (fill) fill(l, r, h);
  parts.push(...moved(l, { x, y, z, ry }));
}

// --- the obstacles: low (jump) ----------------------------------------------------

// Two stepped crates heaped with oranges, one fallen in the road.
export function orangeCratesGeo() {
  const parts = [];
  const oranges = (step, dome, seed) => (l, w, h, d) =>
    heap(l, (l2, x, y, z, rnd) => orange(l2, x, y, z, { leafy: rnd() < 0.18, ry: rnd() * 6 }), w, d, h - 0.06, step, dome, seed);
  crate(parts, { x: -0.47, w: 0.9, h: 0.6, d: 0.8, ry: 0.06, label: F.orange }, oranges(0.225, 0.07, 3));
  crate(parts, { x: 0.5, z: 0.04, w: 0.82, h: 0.42, d: 0.74, ry: -0.1, label: F.orange }, oranges(0.21, 0.08, 9));
  orange(parts, 0.15, 0, 0.42);
  orange(parts, -0.12, 0, 0.5, { leafy: true, ry: 2 });
  return merge(parts).translate(0, 0, -0.48);
}

// A raised wooden bed of raspberry canes, tied to a wire between two stakes,
// hung with ripe raspberries, a punnet of picked ones on its edge.
export function raspberryBedGeo() {
  const parts = [];
  const W = 1.86;
  const H = 0.4;
  const D = 0.66;
  const rnd = seeded(17);
  parts.push(part(P.box(W - 0.06, H - 0.04, D - 0.06), F.woodDark, { y: H / 2 }));
  for (let i = 0; i < 3; i++) parts.push(part(P.box(W, 0.1, D), F.woodPale, { y: 0.06 + i * 0.13, mark: 0.2 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(P.box(0.08, H + 0.04, 0.08), F.woodDark, { x: sx * (W / 2 - 0.02), y: (H + 0.04) / 2, z: sz * (D / 2 - 0.02), outline: 0.5 }));
  parts.push(part(P.box(W - 0.12, 0.05, D - 0.12), F.soil, { y: H - 0.01, outline: 0 }));
  // stakes and the training wire
  for (const s of [-1, 1]) parts.push(part(P.box(0.05, 0.62, 0.05), F.woodDark, { x: s * 0.86, y: H + 0.26, z: -0.05, outline: 0.5 }));
  parts.push(part(P.cyl(0.008, 0.008, 1.72, 3), '#5a5a5a', { y: H + 0.44, z: -0.05, rz: Math.PI / 2, outline: 0 }));
  // three clumps of canes: leafy masses, arching canes, berries hanging off
  // the front and the top
  for (const cx of [-0.56, 0, 0.56]) {
    const cy = H + 0.24 + rnd() * 0.03;
    for (const [dx, dy, dz, r] of [[0, 0.04, 0, 0.27], [-0.18, -0.03, 0.08, 0.2], [0.17, -0.02, 0.06, 0.21], [0.02, -0.05, -0.12, 0.2]]) {
      parts.push(part(P.sphere(r, 9, 7), null, { x: cx + dx, y: cy + dy, z: dz, sy: 0.82, grad: ['#2e6e24', '#7cbc3a', cy - r, cy + r], mark: 0.9, tint: 1 }));
    }
    for (let k = 0; k < 3; k++) {
      const a = (k - 1) * 0.5 + (rnd() - 0.5) * 0.3;
      parts.push(part(P.cyl(0.012, 0.018, 0.56, 4), F.cane, { x: cx + Math.sin(a) * 0.2, y: H + 0.25, z: 0.12, rz: -a, outline: 0 }));
    }
    for (let k = 0; k < 8; k++) {
      // spread over the front face and the crown of the clump
      const u = rnd();
      const ax = (rnd() - 0.5) * 0.62;
      const front = k < 6;
      const bx = cx + ax;
      const by = front ? cy - 0.1 + u * 0.2 : cy + 0.12 + u * 0.06;
      const bz = front ? 0.2 + Math.cos(ax * 2.2) * 0.08 : (rnd() - 0.5) * 0.24;
      const o = { s: 0.9 + rnd() * 0.25, tilt: (rnd() - 0.5) * 0.5 };
      if (front) raspberry(parts, bx, by, bz, o);
      else lowDetail(() => raspberry(parts, bx, by, bz, o));
    }
  }
  // a punnet of picked berries on the front corner
  const pl = [
    part(P.box(0.26, 0.09, 0.18), '#3f9a5a', { y: 0.045 }),
    part(P.box(0.22, 0.03, 0.14), F.rasp, { y: 0.09, outline: 0 }),
  ];
  lowDetail(() => {
    for (let i = 0; i < 6; i++) raspberry(pl, ((i % 3) - 1) * 0.075, 0.2, (Math.floor(i / 3) - 0.5) * 0.07, { s: 0.75 });
  });
  parts.push(...moved(pl, { x: -0.62, y: H + 0.01, z: 0.24, ry: 0.2 }));
  return merge(parts).translate(0, 0, -0.42);
}

// Wicker baskets of pears, lemons and plums on a low pallet, a hand of
// bananas propped in front.
export function fruitBasketsGeo() {
  const parts = [];
  parts.push(part(P.box(1.84, 0.1, 0.8), F.woodPale, { y: 0.09, mark: 0.2 }));
  for (const z of [-0.32, 0, 0.32]) parts.push(part(P.box(1.84, 0.05, 0.12), F.woodDark, { y: 0.025, z, outline: 0.4 }));
  const ring = (put, n, rr, y) => (l) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      put(l, Math.cos(a) * rr, y, Math.sin(a) * rr, a);
    }
  };
  basket(parts, { x: -0.5, y: 0.14, r: 0.33, h: 0.3, handle: 0.42, ry: 0.4 }, (l, r, h) => {
    ring((l2, x, y, z, a) => pear(l2, x, y, z, { rz: Math.cos(a) * 0.25 }), 6, 0.17, h - 0.1)(l);
    pear(l, 0, h - 0.04, 0, { rz: 0.1 });
  });
  basket(parts, { x: 0.42, y: 0.14, z: -0.08, r: 0.3, h: 0.28, handle: 0.4, ry: -0.3 }, (l, r, h) => {
    ring((l2, x, y, z, a) => lemon(l2, x, y, z, { ry: a }), 6, 0.17, h - 0.06)(l);
    lemon(l, 0, h, 0, { ry: 1 });
  });
  basket(parts, { x: 0.02, y: 0.14, z: 0.24, r: 0.2, h: 0.2, handle: 0 }, (l, r, h) => {
    ring((l2, x, y, z) => plum(l2, x, y, z), 5, 0.1, h - 0.06)(l);
    plum(l, 0, h, 0);
  });
  bananas(parts, 0.42, 0.14, 0.3, { ry: 0.3, n: 4 });
  return merge(parts).translate(0, 0, -0.42);
}

// --- the obstacles: tall (go around) -------------------------------------------------

// Two cart wheels and an axle at depth z (spoked, iron-rimmed).
function wheels(parts, z, r, x, color = F.woodDark) {
  for (const s of [-1, 1]) {
    parts.push(part(P.torus(r - 0.035, 0.045, 5, 18), color, { x: s * x, y: r, z, ry: Math.PI / 2, outline: 0.6 }));
    parts.push(part(P.cyl(0.08, 0.08, 0.14, 8), color, { x: s * x, y: r, z, rz: Math.PI / 2 }));
    for (let i = 0; i < 3; i++) parts.push(part(P.box(0.035, (r - 0.04) * 2, 0.035), color, { x: s * x, y: r, z, rx: (i / 3) * Math.PI, outline: 0 }));
  }
  parts.push(part(P.cyl(0.035, 0.035, x * 2, 5), '#3a3a3a', { y: r, z, rz: Math.PI / 2, outline: 0 }));
}

// A painted board facing the road with a fruit's emblem on it.
function emblemBoard(parts, { x = 0, y, z, w = 0.6, h = 0.42, board = F.slate, emblem }) {
  parts.push(part(P.box(w + 0.06, h + 0.06, 0.04), F.woodDark, { x, y, z }));
  parts.push(part(P.box(w, h, 0.05), board, { x, y, z: z + 0.005, outline: 0 }));
  emblem(parts, x, y, z + 0.035);
}

// The grapefruit cart: a long market cart under a coral-striped canopy, its
// bed heaped with ruby grapefruit, cut halves turned up to show their pink, a
// basket of lemons at the back and the cut fruit painted on its board.
export function grapefruitCartGeo() {
  const parts = [];
  const L = 3.0;
  parts.push(part(P.box(1.7, 0.78, L), F.wood, { y: 0.96, mark: 0.2 }));
  for (const y of [0.66, 1.3]) parts.push(part(P.box(1.76, 0.1, L + 0.06), F.woodDark, { y, outline: 0.5 }));
  for (const z of [-L * 0.3, L * 0.3]) {
    for (const x of [-0.92, 0.92]) {
      parts.push(part(P.cyl(0.46, 0.46, 0.12, 14), F.woodDark, { x, y: 0.46, z, rz: Math.PI / 2 }));
      parts.push(part(P.cyl(0.12, 0.12, 0.16, 8), '#3a2a1a', { x, y: 0.46, z, rz: Math.PI / 2, outline: 0.4 }));
    }
  }
  for (const x of [-0.78, 0.78]) {
    for (const z of [-L / 2 + 0.1, L / 2 - 0.1]) parts.push(part(P.box(0.08, 1.4, 0.08), F.woodDark, { x, y: 2.05, z }));
  }
  // coral and cream striped canopy
  parts.push(part(P.prism(2.1, 0.6, L + 0.4), '#f2786a', { y: 2.72 }));
  for (let i = 0; i < 5; i++) parts.push(part(P.box(2.14, 0.08, 0.32), F.cream, { y: 2.74, z: -L / 2 + 0.1 + i * 0.7, outline: 0 }));
  // a mound of grapefruit filling the bed
  parts.push(part(P.sphere(1, 12, 6), null, { y: 1.34, sx: 0.8, sy: 0.24, sz: L * 0.47, grad: [F.blush, F.grapefruit, 1.34, 1.6], outline: 0 }));
  const rnd = seeded(5);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.36 + (j % 2) * 0.09 - 0.045;
      const z = -L / 2 + 0.3 + j * 0.34;
      if (j >= 6 && i > 0 && i < 3) continue; // the halves go here
      const fx = x / 0.8;
      const fz = z / (L * 0.47);
      const y = 1.34 + 0.24 * Math.sqrt(Math.max(0, 1 - fx * fx - fz * fz)) - 0.11;
      grapefruit(parts, x + (rnd() - 0.5) * 0.04, y, z, { r: 0.14 + rnd() * 0.02 });
    }
  }
  for (const [x, z, ry] of [[-0.2, 0.68, 0.2], [0.2, 0.74, -0.25], [-0.1, 1.08, 0.1], [0.24, 1.1, -0.1]]) {
    grapefruitHalf(parts, x, 1.42, z, { rx: 0.75, ry });
  }
  basket(parts, { x: 0.45, y: 1.3, z: -1.15, r: 0.24, h: 0.2, handle: 0.5, ry: 0.4 }, (l, r, h) => {
    for (let i = 0; i < 5; i++) lemon(l, Math.cos(i * 1.26) * 0.11, h - 0.05, Math.sin(i * 1.26) * 0.11, { ry: i });
  });
  // the board on its front: a cut grapefruit
  emblemBoard(parts, {
    y: 0.98, z: L / 2 + 0.02, w: 0.84, h: 0.5, board: F.cream,
    emblem: (p, x, y, z) => {
      p.push(part(P.cyl(0.2, 0.2, 0.01, 18), F.grapefruit, { x, y, z, rx: Math.PI / 2, outline: 0 }));
      p.push(part(P.cyl(0.18, 0.18, 0.012, 18), F.pith, { x, y, z: z + 0.004, rx: Math.PI / 2, outline: 0 }));
      p.push(part(P.cyl(0.155, 0.155, 0.012, 18), F.flesh, { x, y, z: z + 0.008, rx: Math.PI / 2, outline: 0 }));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        p.push(part(P.box(0.012, 0.15, 0.01), F.pith, { x: x + Math.sin(a) * 0.075, y: y + Math.cos(a) * 0.075, z: z + 0.014, rz: -a, outline: 0 }));
      }
    },
  });
  return merge(parts).translate(0, 0, -L / 2);
}

// The apple barrow: a two-wheeled barrow under a green-and-cream parasol, its
// bed stepped up in tiers of green apples (a few red ones in a basket at the
// front), a slate with an apple chalked on it.
export function appleCartGeo() {
  const parts = [];
  const L = 2.2;
  // the bed on its wheels and front legs
  parts.push(part(P.box(1.6, 0.48, L), F.wood, { y: 0.84, mark: 0.2 }));
  parts.push(part(P.box(1.66, 0.08, L + 0.06), F.woodDark, { y: 1.08, outline: 0.5 }));
  wheels(parts, -0.35, 0.56, 0.9);
  for (const x of [-0.7, 0.7]) parts.push(part(P.box(0.08, 0.62, 0.08), F.woodDark, { x, y: 0.31, z: 0.95 }));
  // three tiers rising away from the road, rows of green apples on each
  const tiers = [[1.12, 0.62], [1.34, 0.0], [1.56, -0.62]];
  for (const [ty, tz] of tiers) {
    parts.push(part(P.box(1.56, ty - 1.04, 0.62), F.woodPale, { y: (ty + 1.04) / 2, z: tz, mark: 0.2 }));
    parts.push(part(P.box(1.58, 0.05, 0.05), F.woodDark, { y: ty, z: tz + 0.31, outline: 0.4 }));
  }
  const rnd = seeded(23);
  tiers.forEach(([ty, tz]) => {
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * 0.205 + (j % 2) * 0.06;
        const z = tz + 0.15 - j * 0.24;
        apple(parts, x, ty - 0.01 + j * 0.012, z, { s: 1 + rnd() * 0.12, leafy: rnd() < 0.15, ry: rnd() * 6 });
      }
    }
  });
  basket(parts, { x: 0.5, y: 1.12, z: 0.86, r: 0.2, h: 0.17, handle: 0.42, ry: -0.3 }, (l, r, h) => {
    for (let i = 0; i < 4; i++) apple(l, Math.cos(i * 1.57 + 0.4) * 0.08, h - 0.08, Math.sin(i * 1.57 + 0.4) * 0.08, { color: F.appleRed, hi: '#ff8a5a', s: 0.9 });
  });
  // the parasol: eight panels, green and cream, a finial on top
  parts.push(part(P.cyl(0.035, 0.035, 2.0, 6), F.woodDark, { y: 2.0, z: -0.25 }));
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    parts.push(part(P.cyl(0.04, 1.12, 0.46, 1, 1, true, a0, Math.PI / 4), i % 2 ? F.cream : '#3f9a52', { y: 2.98, z: -0.25, outline: 1 }));
  }
  parts.push(part(P.cone(1.1, 0.45, 8), '#2a6a3a', { y: 2.975, z: -0.25, outline: 0 }));
  parts.push(part(P.sphere(0.07, 8, 6), F.woodPale, { y: 3.24, z: -0.25 }));
  // a slate on the front with a green apple chalked on it
  emblemBoard(parts, {
    y: 0.82, z: L / 2 + 0.02, w: 0.56, h: 0.4,
    emblem: (p, x, y, z) => {
      p.push(part(P.cyl(0.12, 0.12, 0.01, 16), F.apple, { x, y: y - 0.02, z, rx: Math.PI / 2, sx: 1.08, outline: 0 }));
      p.push(part(P.box(0.016, 0.08, 0.01), F.cream, { x: x + 0.01, y: y + 0.12, z, rz: -0.3, outline: 0 }));
      p.push(part(P.sphere(0.05, 6, 4), '#5ab040', { x: x + 0.06, y: y + 0.13, z, sy: 0.45, sz: 0.2, rz: 0.4, outline: 0 }));
    },
  });
  return merge(parts).translate(0, 0, -L / 2);
}

// The fruit stand: a tall stepped stand on castors under a mustard roof with
// a scalloped valance and a painted sign — bananas on the bottom shelf,
// pears on the next, lemons and plums on the top.
export function fruitStandGeo() {
  const parts = [];
  const L = 1.4;
  const W = 1.8;
  parts.push(part(P.box(W, 0.34, L), F.wood, { y: 0.3, mark: 0.2 }));
  for (const x of [-0.75, 0.75]) for (const z of [-0.55, 0.55]) parts.push(part(P.sphere(0.07, 6, 4), '#3a3a3a', { x, y: 0.07, z }));
  // back board and stepped sides
  parts.push(part(P.box(W, 2.3, 0.1), '#f6d873', { y: 1.6, z: -L / 2 + 0.05, tint: 1 }));
  const side = new THREE.Shape();
  side.moveTo(-L / 2, 0.47);
  side.lineTo(L / 2, 0.47);
  side.lineTo(L / 2, 0.82);
  side.lineTo(0.2, 0.82);
  side.lineTo(0.2, 1.26);
  side.lineTo(-0.22, 1.26);
  side.lineTo(-0.22, 1.7);
  side.lineTo(-L / 2, 1.7);
  side.closePath();
  for (const s of [-1, 1]) parts.push(part(P.extrude(side, 0.07, 1), F.woodDark, { x: s * (W / 2 - 0.035), ry: -Math.PI / 2 }));
  const shelves = [[0.82, 0.45], [1.26, 0.0], [1.7, -0.45]];
  for (const [y, z] of shelves) parts.push(part(P.box(W - 0.14, 0.06, 0.48), F.woodPale, { y: y - 0.03, z }));
  for (const [y0, y1, z] of [[0.47, 0.82, 0.68], [0.82, 1.26, 0.21], [1.26, 1.7, -0.21]]) {
    parts.push(part(P.box(W - 0.14, y1 - y0, 0.04), F.wood, { y: (y0 + y1) / 2, z, mark: 0.2 }));
  }
  // bananas on the bottom shelf
  for (const [x, ry] of [[-0.78, 0.25], [-0.22, -0.1], [0.34, 0.2]]) bananas(parts, x, 0.8, 0.42, { ry, n: 4 });
  // pears in a row
  for (let i = 0; i < 7; i++) pear(parts, -0.66 + i * 0.22, 1.23, (i % 2) * 0.1 - 0.05, { rz: (i % 3 - 1) * 0.12 });
  // lemons and plums on the top shelf
  for (let i = 0; i < 6; i++) lemon(parts, -0.72 + i * 0.13, 1.67, -0.42 + (i % 2) * 0.08, { ry: i * 0.7 });
  for (let i = 0; i < 5; i++) plum(parts, 0.14 + i * 0.13, 1.67, -0.42 + (i % 2) * 0.08);
  // the roof, its scalloped valance and the sign
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) parts.push(part(P.box(0.07, 1.1, 0.07), F.woodDark, { x, y: 2.25, z: L / 2 - 0.15 }));
  parts.push(part(P.box(W + 0.24, 0.1, L + 0.1), F.woodDark, { y: 2.82, z: 0.04 }));
  for (let i = 0; i < 9; i++) {
    const x = -W / 2 - 0.02 + (i + 0.5) * ((W + 0.04) / 9);
    parts.push(part(P.cyl(0.11, 0.11, 0.03, 10, 1, false, -Math.PI / 2, Math.PI), i % 2 ? F.cream : '#e8a83a', { x, y: 2.77, z: L / 2 + 0.1, rx: Math.PI / 2, outline: 0.4 }));
  }
  parts.push(part(P.box(W + 0.24, 0.06, 0.06), '#e8a83a', { y: 2.79, z: L / 2 + 0.1, outline: 0.4 }));
  parts.push(part(P.box(1.5, 0.46, 0.08), F.cream, { y: 3.12, z: 0.1 }));
  parts.push(part(P.box(1.58, 0.54, 0.06), F.woodDark, { y: 3.12, z: 0.07 }));
  for (const [x, c] of [[-0.45, F.orange], [0, F.apple], [0.45, F.rasp]]) {
    parts.push(part(P.cyl(0.13, 0.13, 0.02, 14), c, { x, y: 3.12, z: 0.15, rx: Math.PI / 2, outline: 0 }));
  }
  return merge(parts).translate(0, 0, -L / 2);
}

// --- the obstacle: high (slide under) --------------------------------------------------

// The bus stop's timetable, hung over a lane: two green steel posts on bolted
// base plates, braced to a crossbeam, the timetable board hung from it on two
// rods with a live "next bus" display above it — the route's colour and a bus
// across its head, a strip map of the stops, columns of departure times — and
// the bus stop's roundel flag on top of one post. The board's yellow kick rail
// sits on the duck line; there's nothing below it but the open road.
export function busTimetableGeo() {
  const D = CONFIG.duckLine;
  const parts = [];
  const green = '#2b6a4c';
  const steel = '#3a4642';
  const red = '#d8463a';
  const H = 3.0;
  for (const s of [-1, 1]) {
    const x = s * 1.0;
    parts.push(part(P.box(0.13, s < 0 ? H + 0.55 : H + 0.08, 0.13), green, { x, y: (s < 0 ? H + 0.55 : H + 0.08) / 2 }));
    parts.push(part(P.box(0.32, 0.04, 0.3), steel, { x, y: 0.02, outline: 0.5 }));
    for (const bx of [-1, 1]) for (const bz of [-1, 1]) parts.push(part(P.cyl(0.022, 0.022, 0.04, 6), '#9aa49e', { x: x + bx * 0.11, y: 0.05, z: bz * 0.1, outline: 0 }));
    parts.push(part(P.box(0.06, 0.62, 0.06), green, { x: s * 0.8, y: H - 0.25, rz: s * 0.675 }));
  }
  parts.push(part(P.box(2.3, 0.14, 0.16), green, { y: H + 0.04 }));
  // the stop's sign on the left post: a bus in a green-rimmed disc
  const fy = H + 0.38;
  parts.push(part(P.torus(0.25, 0.05, 6, 22), green, { x: -1.0, y: fy, z: 0.08, outline: 0.6 }));
  parts.push(part(P.cyl(0.22, 0.22, 0.03, 20), '#fffbe8', { x: -1.0, y: fy, z: 0.08, rx: Math.PI / 2, outline: 0 }));
  parts.push(part(P.box(0.27, 0.15, 0.02), green, { x: -1.0, y: fy + 0.01, z: 0.1, outline: 0 }));
  for (let i = 0; i < 3; i++) parts.push(part(P.box(0.06, 0.05, 0.01), '#fffbe8', { x: -1.08 + i * 0.075, y: fy + 0.04, z: 0.112, outline: 0 }));
  for (const wx of [-1.08, -0.92]) parts.push(part(P.cyl(0.03, 0.03, 0.02, 8), '#1c2422', { x: wx, y: fy - 0.07, z: 0.112, rx: Math.PI / 2, outline: 0 }));
  // the board
  const pw = 1.76;
  const ph = 1.0;
  const y0 = D + 0.01;
  const cy = y0 + ph / 2;
  const fz = 0.07; // its face
  for (const s of [-1, 1]) {
    const top = H - 0.03;
    const bot = y0 + ph;
    parts.push(part(P.cyl(0.022, 0.022, top - bot, 6), steel, { x: s * 0.6, y: (top + bot) / 2, outline: 0.5 }));
    parts.push(part(P.box(0.12, 0.1, 0.22), steel, { x: s * 0.6, y: H - 0.03 }));
    parts.push(part(P.box(0.12, 0.07, 0.16), steel, { x: s * 0.6, y: bot + 0.035 }));
  }
  // the live display hung between the rods
  parts.push(part(P.box(1.06, 0.24, 0.12), '#1c2422', { y: H - 0.42 }));
  for (let i = 0; i < 4; i++) parts.push(part(P.box(i === 0 ? 0.14 : 0.18, 0.06, 0.01), '#ffb43a', { x: -0.36 + i * 0.24, y: H - 0.42, z: 0.062, emit: 1, outline: 0 }));
  parts.push(part(P.box(pw + 0.1, ph + 0.06, 0.1), green, { y: y0 + (ph + 0.06) / 2 }));
  parts.push(part(P.box(pw - 0.04, ph - 0.06, 0.02), '#f7f3e4', { y: cy + 0.01, z: 0.05, outline: 0 }));
  // its head: the route's colour, a bus on it, the route number in a yellow disc
  const hy = y0 + ph - 0.16;
  parts.push(part(P.box(pw - 0.04, 0.24, 0.02), red, { y: hy, z: 0.06, outline: 0 }));
  parts.push(part(P.box(0.36, 0.13, 0.01), '#ffffff', { x: -0.6, y: hy + 0.01, z: fz, outline: 0 }));
  for (let i = 0; i < 4; i++) parts.push(part(P.box(0.055, 0.045, 0.01), red, { x: -0.72 + i * 0.08, y: hy + 0.03, z: fz + 0.004, outline: 0 }));
  for (const wx of [-0.7, -0.5]) parts.push(part(P.cyl(0.032, 0.032, 0.012, 8), '#222222', { x: wx, y: hy - 0.06, z: fz + 0.004, rx: Math.PI / 2, outline: 0 }));
  parts.push(part(P.cyl(0.085, 0.085, 0.012, 14), '#ffd23a', { x: 0.7, y: hy, z: fz, rx: Math.PI / 2, outline: 0 }));
  for (const nx of [-0.025, 0.025]) parts.push(part(P.box(0.02, 0.08, 0.01), '#222222', { x: 0.7 + nx, y: hy, z: fz + 0.006, outline: 0 }));
  for (let i = 0; i < 3; i++) parts.push(part(P.box(0.22 - i * 0.04, 0.03, 0.01), '#ffffff', { x: -0.05 + i * 0.02, y: hy + 0.05 - i * 0.05, z: fz, outline: 0 }));
  // a strip map of the stops
  const my = hy - 0.21;
  parts.push(part(P.box(1.5, 0.026, 0.01), red, { y: my, z: fz, outline: 0 }));
  for (let i = 0; i < 7; i++) {
    const x = -0.72 + i * 0.24;
    parts.push(part(P.cyl(i === 2 ? 0.04 : 0.026, i === 2 ? 0.04 : 0.026, 0.012, 10), i === 2 ? red : '#ffffff', { x, y: my, z: fz + 0.003, rx: Math.PI / 2, outline: 0 }));
    parts.push(part(P.torus(i === 2 ? 0.04 : 0.026, 0.008, 3, 10), '#333333', { x, y: my, z: fz + 0.006, outline: 0 }));
  }
  // columns of departure times
  for (let c = 0; c < 4; c++) {
    const x = -0.62 + c * 0.42;
    parts.push(part(P.box(0.3, 0.04, 0.01), '#2b6a4c', { x, y: my - 0.1, z: fz, outline: 0 }));
    for (let r = 0; r < 5; r++) {
      parts.push(part(P.box(0.11, 0.026, 0.01), '#3a3a3a', { x: x - 0.07, y: my - 0.17 - r * 0.07, z: fz, outline: 0 }));
      parts.push(part(P.box(0.11, 0.026, 0.01), '#3a3a3a', { x: x + 0.08, y: my - 0.17 - r * 0.07, z: fz, outline: 0 }));
    }
    if (c > 0) parts.push(part(P.box(0.008, 0.4, 0.01), '#b8b2a0', { x: x - 0.21, y: my - 0.28, z: fz, outline: 0 }));
  }
  // the kick rail along its bottom edge, on the duck line
  parts.push(part(P.box(pw + 0.12, 0.07, 0.12), '#f2c43a', { y: y0 + 0.035 }));
  return merge(parts).translate(0, 0, -0.17);
}

// --- the street ----------------------------------------------------------------------
// Scenery for the verge and the house fronts, all facing +z (the road behind
// the camera) unless placed turned toward the lane. None of it stands in the
// road.

// A striped awning w wide sloping out `out` from a wall at height y (its
// front edge lower), a scalloped valance hanging off its edge.
function awning(parts, { w, y, z, out = 1.1, drop = 0.38, colors, n = 7 }) {
  const slope = Math.atan2(drop, out);
  const len = Math.hypot(out, drop);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n;
    parts.push(part(P.box(w / n + 0.002, 0.05, len), colors[i % 2], { x, y: y - drop / 2, z: z + out / 2, rx: slope, outline: i === 0 || i === n - 1 ? 1 : 0.3 }));
    parts.push(part(P.cyl(w / n / 2, w / n / 2, 0.03, 8, 1, false, -Math.PI / 2, Math.PI), colors[i % 2], { x, y: y - drop, z: z + out + 0.01, rx: Math.PI / 2, outline: 0.4 }));
  }
}

// A loaf of bread with the slashes across its crust.
function loaf(parts, x, y, z, { ry = 0, s = 1 } = {}) {
  parts.push(part(ball(0.16 * s), null, { x, y: y + 0.07 * s, z, sx: 1.5, sy: 0.62, ry, grad: ['#a8622a', '#e2a85a', y, y + 0.16 * s], outline: 0.6 }));
  for (let i = -1; i <= 1; i++) parts.push(part(P.box(0.03, 0.012, 0.13 * s), '#f2d8a0', { x: x + Math.cos(ry) * i * 0.08 * s, y: y + 0.165 * s, z: z - Math.sin(ry) * i * 0.08 * s, ry: ry + 0.5, outline: 0 }));
}

// The ground floor of a house turned shop (front face at z = d/2, ground at
// y = 0): a fascia with the shop's sign, a display window and a glazed door,
// a striped awning, and its goods out on the pavement — the greengrocer's
// crates of fruit, or the bakery's café table and chalk board.
export const shopfrontParts = (...a) => lowDetail(() => shopfrontPartsFull(...a));
function shopfrontPartsFull({ w, d, kind }) {
  const parts = [];
  const fz = d / 2;
  const grocer = kind === 'grocer';
  const frame = grocer ? '#1f5a3a' : '#7a2a24';
  // fascia and its sign
  parts.push(part(P.box(w - 0.2, 0.46, 0.12), frame, { y: 2.62, z: fz + 0.05 }));
  parts.push(part(P.box(w - 0.5, 0.32, 0.13), F.cream, { y: 2.62, z: fz + 0.055, outline: 0 }));
  if (grocer) {
    for (const [x, c] of [[-0.42, F.orange], [0, F.apple], [0.42, F.rasp]]) parts.push(part(P.cyl(0.11, 0.11, 0.02, 12), c, { x, y: 2.62, z: fz + 0.13, rx: Math.PI / 2, outline: 0 }));
  } else {
    parts.push(part(P.sphere(0.16, 8, 6), '#d8964a', { x: -0.3, y: 2.62, z: fz + 0.12, sx: 1.6, sy: 0.55, sz: 0.2, outline: 0 }));
    parts.push(part(P.cyl(0.1, 0.08, 0.14, 10), '#ffffff', { x: 0.32, y: 2.6, z: fz + 0.12, outline: 0 }));
    parts.push(part(P.torus(0.045, 0.014, 4, 10), '#ffffff', { x: 0.43, y: 2.61, z: fz + 0.12, outline: 0 }));
  }
  // display window and door
  const wx = -w * 0.17;
  const ww = w * 0.56;
  parts.push(part(P.box(ww + 0.16, 1.62, 0.12), frame, { x: wx, y: 1.31, z: fz + 0.02 }));
  parts.push(part(P.box(ww, 1.4, 0.14), '#cfe6dc', { x: wx, y: 1.36, z: fz + 0.02, outline: 0 }));
  parts.push(part(P.box(ww + 0.2, 0.08, 0.3), frame, { x: wx, y: 0.6, z: fz + 0.1 }));
  const dx = w * 0.32;
  parts.push(part(P.box(0.9, 2.06, 0.12), frame, { x: dx, y: 1.03, z: fz + 0.02 }));
  parts.push(part(P.box(0.5, 0.9, 0.14), '#cfe6dc', { x: dx, y: 1.4, z: fz + 0.03, outline: 0 }));
  parts.push(part(P.sphere(0.04, 5, 4), '#e8b84a', { x: dx - 0.3, y: 1.0, z: fz + 0.11, outline: 0 }));
  awning(parts, { w: w - 0.1, y: 2.36, z: fz + 0.1, colors: grocer ? ['#3f9a52', F.cream] : ['#d8463a', F.cream], n: 9 });
  if (grocer) {
    // in the window: a pyramid of oranges; out front: a bench of crates
    for (let i = 0; i < 5; i++) orange(parts, wx - 0.5 + i * 0.25, 0.64, fz + 0.12);
    for (let i = 0; i < 3; i++) orange(parts, wx - 0.38 + i * 0.25, 0.83, fz + 0.12);
    parts.push(part(P.box(ww + 0.3, 0.06, 0.62), F.woodDark, { x: wx, y: 0.5, z: fz + 0.62 }));
    for (const lx of [-1, 1]) parts.push(part(P.box(0.06, 0.5, 0.5), F.woodDark, { x: wx + lx * (ww / 2), y: 0.25, z: fz + 0.62 }));
    const goods = [
      (l, w2, h, d2) => heap(l, (l2, x, y, z) => apple(l2, x, y, z), w2, d2, h - 0.04, 0.2, 0.04, 2),
      (l, w2, h, d2) => heap(l, (l2, x, y, z) => grapefruit(l2, x, y, z, { r: 0.12 }), w2, d2, h - 0.08, 0.24, 0.03, 4),
      (l, w2, h, d2) => heap(l, (l2, x, y, z) => lemon(l2, x, y, z), w2, d2, h - 0.04, 0.18, 0.03, 6),
    ];
    goods.forEach((fill, i) => crate(parts, { x: wx + (i - 1) * (ww / 3), y: 0.53, z: fz + 0.62, w: ww / 3 - 0.06, h: 0.24, d: 0.5, ry: (i - 1) * 0.05 }, fill));
    for (let i = 0; i < 3; i++) raspberry(parts, dx - 0.05 + i * 0.1, 0.12, fz + 0.75, { s: 0.8 });
    parts.push(part(P.box(0.4, 0.08, 0.2), '#3f9a5a', { x: dx + 0.05, y: 0.04, z: fz + 0.75 }));
  } else {
    // bread in the window; a café table, two chairs and a chalk board out front
    parts.push(part(P.box(ww - 0.1, 0.05, 0.3), F.woodPale, { x: wx, y: 1.15, z: fz + 0.08, outline: 0 }));
    for (let i = 0; i < 3; i++) loaf(parts, wx - 0.45 + i * 0.45, 0.64, fz + 0.14, { ry: 0.2 });
    for (let i = 0; i < 3; i++) loaf(parts, wx - 0.4 + i * 0.42, 1.18, fz + 0.1, { ry: -0.2, s: 0.8 });
    const tx = wx;
    const tz = fz + 1.0;
    parts.push(part(P.cyl(0.36, 0.36, 0.04, 14), '#f4f0e4', { x: tx, y: 0.74, z: tz }));
    parts.push(part(P.cyl(0.03, 0.03, 0.72, 5), '#2a2a2a', { x: tx, y: 0.37, z: tz }));
    parts.push(part(P.cyl(0.2, 0.22, 0.03, 10), '#2a2a2a', { x: tx, y: 0.015, z: tz }));
    parts.push(part(P.cyl(0.06, 0.05, 0.09, 8), '#ffffff', { x: tx + 0.12, y: 0.81, z: tz + 0.05, outline: 0.4 }));
    for (const sx of [-1, 1]) {
      const cx = tx + sx * 0.6;
      const l = [
        part(P.box(0.4, 0.04, 0.38), '#d8463a', { y: 0.46 }),
        part(P.box(0.4, 0.42, 0.04), '#d8463a', { y: 0.7, z: -0.18 }),
      ];
      for (const [lx, lz] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) l.push(part(P.box(0.03, 0.46, 0.03), '#2a2a2a', { x: lx, y: 0.23, z: lz, outline: 0.3 }));
      parts.push(...moved(l, { x: cx, z: tz, ry: sx * -Math.PI / 2 }));
    }
    const bl = [
      part(P.box(0.5, 0.8, 0.04), F.woodDark, { y: 0.42, z: 0.12, rx: -0.2 }),
      part(P.box(0.42, 0.68, 0.05), F.slate, { y: 0.44, z: 0.135, rx: -0.2, outline: 0 }),
      part(P.box(0.5, 0.8, 0.04), F.woodDark, { y: 0.42, z: -0.12, rx: 0.2 }),
    ];
    for (let i = 0; i < 4; i++) bl.push(part(P.box(0.26 - (i % 2) * 0.08, 0.025, 0.01), F.cream, { y: 0.66 - i * 0.12, z: 0.18 - i * 0.024, rx: -0.2, outline: 0 }));
    parts.push(...moved(bl, { x: dx, z: fz + 0.95 }));
  }
  return parts;
}

// A market stall for the verge: a trestle table skirted in cloth under a
// sloping striped awning, crates of green apples, grapefruit and oranges on
// it, a punnet of raspberries, and a chalk board on a stick.
export const marketStallGeo = (...a) => lowDetail(() => marketStallGeoFull(...a));
function marketStallGeoFull() {
  const parts = [];
  const W = 2.2;
  const D = 0.9;
  parts.push(part(P.box(W, 0.06, D), F.woodPale, { y: 0.84 }));
  parts.push(part(P.box(W - 0.04, 0.62, 0.02), '#f6ecd0', { y: 0.52, z: D / 2 - 0.01, outline: 0.5 }));
  for (let i = 0; i < 6; i++) parts.push(part(P.box(W / 12, 0.6, 0.025), '#7ac0a8', { x: -W / 2 + (W / 6) * (i + 0.25), y: 0.52, z: D / 2, outline: 0 }));
  for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) for (const z of [-D / 2 + 0.08, D / 2 - 0.08]) parts.push(part(P.box(0.06, 0.82, 0.06), F.woodDark, { x, y: 0.41, z }));
  for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) {
    parts.push(part(P.box(0.07, 2.36, 0.07), F.woodDark, { x, y: 1.18, z: D / 2 + 0.25 }));
    parts.push(part(P.box(0.07, 2.7, 0.07), F.woodDark, { x, y: 1.35, z: -D / 2 }));
  }
  awning(parts, { w: W + 0.2, y: 2.72, z: -D / 2 - 0.05, out: D + 0.45, drop: 0.36, colors: ['#e8a83a', F.cream], n: 8 });
  const goods = [
    (l, w2, h, d2) => heap(l, (l2, x, y, z, rnd) => apple(l2, x, y, z, { leafy: rnd() < 0.2, ry: rnd() * 6 }), w2, d2, h - 0.04, 0.2, 0.05, 3),
    (l, w2, h, d2) => {
      heap(l, (l2, x, y, z) => grapefruit(l2, x, y, z, { r: 0.13 }), w2, d2, h - 0.1, 0.25, 0.04, 5);
      grapefruitHalf(l, 0, h + 0.1, d2 / 2 - 0.05, { r: 0.13, rx: 0.9 });
    },
    (l, w2, h, d2) => heap(l, (l2, x, y, z, rnd) => orange(l2, x, y, z, { leafy: rnd() < 0.2, ry: rnd() * 6 }), w2, d2, h - 0.05, 0.21, 0.05, 7),
  ];
  goods.forEach((fill, i) => crate(parts, { x: (i - 1) * 0.68, y: 0.87, z: -0.08, w: 0.6, h: 0.26, d: 0.55, ry: (i - 1) * 0.08, label: [F.apple, F.grapefruit, F.orange][i] }, fill));
  const pl = [part(P.box(0.3, 0.08, 0.2), '#3f9a5a', { y: 0.04 })];
  for (let i = 0; i < 6; i++) raspberry(pl, ((i % 3) - 1) * 0.085, 0.19, (Math.floor(i / 3) - 0.5) * 0.08, { s: 0.85 });
  parts.push(...moved(pl, { x: 0.35, y: 0.87, z: 0.3, ry: -0.2 }));
  // chalk board on a stick
  parts.push(part(P.box(0.04, 1.3, 0.04), F.woodDark, { x: -W / 2 - 0.3, y: 0.65, z: D / 2 }));
  parts.push(part(P.box(0.5, 0.36, 0.04), F.woodDark, { x: -W / 2 - 0.3, y: 1.32, z: D / 2 + 0.03 }));
  parts.push(part(P.box(0.42, 0.28, 0.05), F.slate, { x: -W / 2 - 0.3, y: 1.32, z: D / 2 + 0.035, outline: 0 }));
  for (let i = 0; i < 3; i++) parts.push(part(P.box(0.24, 0.02, 0.01), F.cream, { x: -W / 2 - 0.3, y: 1.4 - i * 0.08, z: D / 2 + 0.065, outline: 0 }));
  return merge(parts);
}

// The bus stop's shelter: a green steel frame glazed at the back and one end,
// a bench, a roof edged in the route's red, the timetable under glass on its
// end, a poster for the market on the other, and the stop's sign on a pole.
export function busShelterGeo() {
  const parts = [];
  const green = '#2b6a4c';
  const red = '#d8463a';
  const L = 3.0;
  const D = 1.3;
  const H = 2.45;
  const glass = '#cfe6ea';
  for (const x of [-L / 2, L / 2]) for (const z of [-D / 2, D / 2 - 0.1]) parts.push(part(P.box(0.09, H, 0.09), green, { x, y: H / 2, z }));
  parts.push(part(P.box(L + 0.36, 0.1, D + 0.4), green, { y: H + 0.05, z: 0.05, rx: -0.05 }));
  parts.push(part(P.box(L + 0.38, 0.16, 0.06), red, { y: H + 0.04, z: D / 2 + 0.26, outline: 0.6 }));
  // the glazing: the back wall and the left end
  parts.push(part(P.box(L, 1.85, 0.03), glass, { y: 1.2, z: -D / 2, outline: 0.4 }));
  parts.push(part(P.box(0.03, 1.85, D - 0.1), glass, { x: -L / 2, y: 1.2, z: -0.05, outline: 0.4 }));
  for (const y of [0.27, 2.13]) {
    parts.push(part(P.box(L, 0.06, 0.06), green, { y, z: -D / 2 }));
    parts.push(part(P.box(0.06, 0.06, D - 0.1), green, { x: -L / 2, y, z: -0.05 }));
  }
  // the timetable under glass on the left end, facing in
  parts.push(part(P.box(0.02, 0.6, 0.5), F.cream, { x: -L / 2 + 0.03, y: 1.45, z: 0.0, outline: 0 }));
  parts.push(part(P.box(0.022, 0.12, 0.5), red, { x: -L / 2 + 0.035, y: 1.69, z: 0.0, outline: 0 }));
  for (let r = 0; r < 4; r++) for (const z of [-0.12, 0.12]) parts.push(part(P.box(0.024, 0.025, 0.16), '#3a3a3a', { x: -L / 2 + 0.04, y: 1.52 - r * 0.09, z, outline: 0 }));
  // a poster for the market on the back wall: fruit in a row under a banner
  const px = L / 2 - 0.62;
  parts.push(part(P.box(0.9, 1.2, 0.03), '#f6d873', { x: px, y: 1.3, z: -D / 2 + 0.03, outline: 0 }));
  parts.push(part(P.box(0.8, 0.18, 0.035), '#3f9a52', { x: px, y: 1.72, z: -D / 2 + 0.035, outline: 0 }));
  for (const [i, c] of [[0, F.orange], [1, F.apple], [2, F.rasp]]) parts.push(part(P.cyl(0.11, 0.11, 0.02, 12), c, { x: px - 0.26 + i * 0.26, y: 1.3, z: -D / 2 + 0.05, rx: Math.PI / 2, outline: 0 }));
  parts.push(part(P.cyl(0.13, 0.13, 0.02, 12), F.flesh, { x: px, y: 0.98, z: -D / 2 + 0.05, rx: Math.PI / 2, outline: 0 }));
  // the bench
  parts.push(part(P.box(L - 1.2, 0.06, 0.36), F.wood, { x: -0.5, y: 0.48, z: -D / 2 + 0.26 }));
  for (const x of [-1.3, 0.3]) parts.push(part(P.box(0.06, 0.46, 0.3), green, { x, y: 0.23, z: -D / 2 + 0.24 }));
  // the stop's sign on its pole at the front corner
  const sx = L / 2 + 0.3;
  const sz = D / 2 + 0.1;
  parts.push(part(P.cyl(0.045, 0.05, 2.9, 6), green, { x: sx, y: 1.45, z: sz }));
  parts.push(part(P.torus(0.24, 0.045, 6, 20), green, { x: sx, y: 2.95, z: sz + 0.05, outline: 0.6 }));
  parts.push(part(P.cyl(0.21, 0.21, 0.03, 18), '#fffbe8', { x: sx, y: 2.95, z: sz + 0.05, rx: Math.PI / 2, outline: 0 }));
  parts.push(part(P.box(0.25, 0.14, 0.02), green, { x: sx, y: 2.96, z: sz + 0.07, outline: 0 }));
  for (let i = 0; i < 3; i++) parts.push(part(P.box(0.055, 0.045, 0.01), '#fffbe8', { x: sx - 0.075 + i * 0.07, y: 2.99, z: sz + 0.082, outline: 0 }));
  return merge(parts);
}

// A slatted wooden bench on iron ends.
export function benchGeo() {
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push(part(P.box(1.6, 0.04, 0.12), F.wood, { y: 0.46, z: 0.15 - i * 0.14, outline: i === 0 ? 1 : 0.3 }));
  for (let i = 0; i < 2; i++) parts.push(part(P.box(1.6, 0.12, 0.04), F.wood, { y: 0.66 + i * 0.17, z: -0.2 - i * 0.03, rx: -0.15 }));
  for (const x of [-0.7, 0.7]) {
    parts.push(part(P.box(0.06, 0.46, 0.06), '#2a2e2c', { x, y: 0.23, z: 0.14 }));
    parts.push(part(P.box(0.06, 0.92, 0.06), '#2a2e2c', { x, y: 0.46, z: -0.2, rx: -0.12 }));
    parts.push(part(P.box(0.06, 0.05, 0.44), '#2a2e2c', { x, y: 0.62, z: -0.02 }));
  }
  return merge(parts);
}

// A pillar post box.
export function postboxGeo() {
  const red = '#c8342a';
  return merge([
    part(P.cyl(0.27, 0.29, 0.1, 12), '#2a2a2a', { y: 0.05 }),
    part(P.cyl(0.25, 0.25, 1.05, 12), red, { y: 0.6 }),
    part(new THREE.SphereGeometry(0.27, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), red, { y: 1.12 }),
    part(P.cyl(0.275, 0.275, 0.06, 12), red, { y: 1.12 }),
    part(P.box(0.24, 0.04, 0.06), '#1a1a1a', { y: 0.98, z: 0.23, outline: 0 }),
    part(P.box(0.18, 0.14, 0.03), '#f6f0e0', { y: 0.72, z: 0.24, outline: 0 }),
  ]);
}

// A bicycle on its stand, a wicker basket of green apples on the front.
export const bikeGeo = (...a) => lowDetail(() => bikeGeoFull(...a));
function bikeGeoFull() {
  const parts = [];
  const r = 0.34;
  const steel = '#2f7aa0';
  for (const x of [-0.52, 0.52]) {
    parts.push(part(P.torus(r, 0.028, 4, 16), '#262626', { x, y: r, outline: 0.6 }));
    for (let i = 0; i < 3; i++) parts.push(part(P.box(0.008, (r - 0.03) * 2, 0.008), '#b8b8b8', { x, y: r, rz: (i / 3) * Math.PI, outline: 0 }));
    parts.push(part(P.cyl(0.04, 0.04, 0.1, 6), '#b8b8b8', { x, y: r, rx: Math.PI / 2, outline: 0 }));
  }
  const crank = [0.0, 0.3, 0];
  const seat = [-0.18, 0.78, 0];
  const head = [0.36, 0.82, 0];
  rod(parts, [-0.52, r, 0], crank, 0.022, steel);
  rod(parts, crank, seat, 0.024, steel);
  rod(parts, seat, head, 0.024, steel);
  rod(parts, crank, head, 0.026, steel);
  rod(parts, [-0.52, r, 0], seat, 0.018, steel);
  rod(parts, head, [0.52, r, 0], 0.022, steel);
  rod(parts, head, [0.32, 0.98, 0], 0.02, '#3a3a3a');
  parts.push(part(P.cyl(0.016, 0.016, 0.5, 5), '#3a3a3a', { x: 0.32, y: 0.98, rx: Math.PI / 2 }));
  parts.push(part(P.sphere(0.07, 6, 4), '#3a2a1a', { x: seat[0], y: seat[1] + 0.04, sx: 1.8, sy: 0.5 }));
  parts.push(part(P.cyl(0.05, 0.05, 0.04, 8), '#3a3a3a', { y: 0.3, rx: Math.PI / 2 }));
  basket(parts, { x: 0.58, y: 0.82, r: 0.17, h: 0.18, handle: 0 }, (l, rr, h) => {
    for (let i = 0; i < 4; i++) apple(l, Math.cos(i * 1.57) * 0.07, h - 0.1, Math.sin(i * 1.57) * 0.07, { s: 0.85 });
    apple(l, 0, h - 0.04, 0, { s: 0.85, leafy: true });
  });
  return merge(parts);
}

// A white picket fence along a front garden, raspberry canes grown up behind
// it hung with berries (built along x, the garden at -z).
export const gardenFenceGeo = (...a) => lowDetail(() => gardenFenceGeoFull(...a));
function gardenFenceGeoFull() {
  const parts = [];
  const L = 3.6;
  const rnd = seeded(41);
  for (const y of [0.25, 0.6]) parts.push(part(P.box(L, 0.07, 0.04), '#f6f2e6', { y, z: 0.02 }));
  for (let i = 0; i <= 14; i++) {
    const x = -L / 2 + (L * i) / 14;
    parts.push(part(P.box(0.09, 0.8, 0.03), '#ffffff', { x, y: 0.4, z: 0.05, outline: 0.6 }));
    parts.push(part(P.cone(0.065, 0.1, 4), '#ffffff', { x, y: 0.85, z: 0.05, ry: Math.PI / 4, sz: 0.4, outline: 0.6 }));
  }
  for (let k = 0; k < 4; k++) {
    const cx = -L / 2 + 0.5 + k * 0.88;
    const cy = 0.9 + rnd() * 0.15;
    for (const [dx, dy, r] of [[0, 0, 0.36], [-0.25, -0.18, 0.28], [0.24, -0.15, 0.3]]) {
      parts.push(part(P.sphere(r, 7, 5), null, { x: cx + dx, y: cy + dy, z: -0.35, sy: 0.9, grad: ['#2e6e24', '#7cbc3a', cy - r - 0.3, cy + r], mark: 0.9, tint: 1 }));
    }
    for (let i = 0; i < 3; i++) raspberry(parts, cx + (rnd() - 0.5) * 0.6, cy - 0.1 + rnd() * 0.3, -0.04 - rnd() * 0.08, { s: 1.05, tilt: (rnd() - 0.5) * 0.4 });
  }
  return merge(parts);
}
