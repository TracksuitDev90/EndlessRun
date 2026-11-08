import * as THREE from '../../vendor/three/three.module.min.js';
import {
  P, part, merge, mix, moved,
  cypressParts, roundTreeParts, bushParts, potParts, lanternPostParts, gateFrameParts, leafParts,
} from './shapes.js';
import { shaftParts, butterflyParts, giantFlowerParts } from './whimsy.js';
import { crystal, nugget, tabular, dodecahedron, tetragonal } from './gems.js';
import { groundStrip, doorShape } from '../render/geo.js';
import { CONFIG } from '../config.js';

// II · The Glasshouse — a white-ribbed greenhouse tunnel run wild: beds
// crowded with zinnias, ferns and monstera spilling over their edges, ivy
// climbing the ribs, baskets hung from brackets and from the roof on long
// chains trailing vines, shelves of potted plants against the glass, potted
// cypress and orange trees - and here and there a Venus flytrap that's been
// left to grow far too big - and gone to jungle: banana plants arching into
// the roof, elephant ears, calatheas, ferns, dark ficus, Spanish moss in
// curtains from the purlins, a path of mossy old stone pavers. Warm, humid
// and soft: sunlight through glass fogged with condensation, a gentle golden
// haze far down the tunnel, soft sunbeams over the beds, motes in them,
// leaf-dappled pavers, deep green shade at the edges. Returns bring
// butterflies, then giant blooms at dusk, then a bioluminescent night.

const C = {
  iron: '#e4efe2',
  ironShade: '#c2d6c6',
  leafDeep: '#1d6a48',
  leaf: '#3f9a63',
  leafHi: '#8fd27a',
  fern: '#2f8a52',
  fernHi: '#9ad66a',
  terracotta: '#c8693a',
  rim: '#a9532a',
  soil: '#4a3426',
  planter: '#bcc4aa',
  orange: '#f28a2a',
  blossom: '#ffffff',
  blossomCore: '#ffd36a',
  wood: '#b98552',
  woodDark: '#7a5432',
  lawn: '#3f7a52',
  lantern: '#ffd27a',
  frameDark: '#24453c',
  // the flytraps: green lobes blushing at the rim, a wine-dark mouth (dark
  // and dull beside the rubies), pale teeth
  trapLo: '#3f7f2a',
  trapHi: '#a8cf4a',
  trapIn: '#8a2a3c',
  trapTooth: '#e4eea0',
  stalk: '#4a8a32',
  stalkHi: '#9cc84e',
  chain: '#2a3a34',
  // the jungle: Spanish moss, grey-green and sunlit paler at its tips; the
  // banana's broad leaves; elephant ears, dark and glossy with pale veins;
  // the calathea's dark leaves barred pale; ferns; the ficus, darkest of all
  moss: '#5f7a62',
  mossTip: '#c4d4a8',
  banana: '#2a6a2e',
  bananaHi: '#93cc5c',
  bananaStem: '#5f7f34',
  ear: '#173f26',
  earHi: '#3f8a44',
  vein: '#c8e2a8',
  calathea: '#1d4429',
  calatheaHi: '#2f6a3a',
  calatheaBar: '#9cc77e',
  frond: '#245e30',
  frondHi: '#7cbf52',
  ficus: '#143a22',
  ficusHi: '#3d7c3c',
  bark: '#5a4a36',
};

// Zinnias (and the odd marigold): pinks, corals, peach, gold and cream - no
// true reds, which belong to the rubies.
const ZINNIAS = ['#f0609a', '#f47a6a', '#f6a07a', '#f9c08e', '#e04a86', '#f2b53e', '#f6e2c4', '#f78fae', '#c86ab0'];

// The reds, as if the beds had grown berries of red glass — the complement of
// all that green and mint, and nothing else in here is that colour. Rough
// rubies above all, chunky nuggets threaded with pale cracks, and garnets,
// deep wine red, each grown as a ball of twelve rhombs. Mixed in: water-worn
// ruby pebbles, opaque pink rhodonite seamed with black, and orange-red
// zircon pointed at both ends. For the prize spots a ruby crystal in
// corundum's six-sided plate, stood up to show its face.
const GEM = {
  name: 'ruby',
  color: '#ff2d55',
  stones: [
    {
      name: 'ruby',
      weight: 2,
      tints: ['#ff2d55', '#ff4a6e', '#e81e48'],
      parts: () => [crystal(nugget({ r: [0.24, 0.21, 0.21], faces: 13, spread: 0.2, chips: 3, seed: 2 }))],
      texture: { veins: 0.45, mottle: 0.4, second: '#ff8aa0', rough: 0.4, speckle: 0.08 },
    },
    {
      name: 'ruby pebble',
      weight: 1,
      tints: ['#ff2d55', '#ff4a6e', '#f03a60'],
      parts: () => [crystal(nugget({ r: [0.22, 0.18, 0.2], faces: 30, spread: 0.06, chips: 2, seed: 11 }))],
      texture: { veins: 0.2, mottle: 0.45, second: '#ffb0c0', rough: 0.25, speckle: 0.1 },
    },
    {
      // deep wine red, grown as a ball of twelve rhombs
      name: 'garnet',
      weight: 2,
      tints: ['#a00e28', '#b81634', '#8c0a22'],
      parts: () => [crystal(dodecahedron({ r: 0.2, round: 0.88, seed: 3 }), { rx: 0.4, rz: 0.3 })],
      texture: { mottle: 0.45, second: '#ff4a5a', rough: 0.35, speckle: 0.1, glints: 1.2 },
    },
    {
      // opaque pink, seamed with black
      name: 'rhodonite',
      weight: 1,
      tints: ['#e8687a', '#f07a8a', '#de5a6e'],
      parts: () => [crystal(nugget({ r: [0.23, 0.19, 0.19], faces: 14, spread: 0.18, chips: 3, seed: 23 }))],
      texture: { opaque: 0.75, veins: 0.85, veinColor: '#2a1a1e', mottle: 0.45, second: '#ffc8d0', rough: 0.4, scale: 7, glints: 0.6 },
    },
    {
      // orange-red, a four-sided prism pointed at both ends
      name: 'zircon',
      weight: 1,
      tints: ['#ff5a2a', '#ff6e3a', '#f04a22'],
      parts: () => [crystal(tetragonal({ w: 0.1, len: 0.12, tip: 0.15, seed: 4 }), { rz: 0.3, ry: 0.4 })],
      texture: { mottle: 0.3, second: '#ffb060', rough: 0.2, bands: 0.15, bandFreq: 8 },
    },
  ],
  crown: {
    name: 'ruby crystal',
    tints: ['#ff2d55', '#ff4a6e', '#e81e48'],
    parts: () => [crystal(tabular({ r: 0.3, t: 0.11, jitter: 0.08, chips: 4, seed: 6 }), { rx: 1.15 })],
    texture: { mottle: 0.4, second: '#ff8aa0', rough: 0.35, speckle: 0.1, veins: 0.2 },
  },
  motion: [1.2, 1.9, 0.08, 0.12],
  look: [0.74, 1, 0.28, 0.38],
  glow: 0.65,
  pool: 0.3,
};

const OPENING = { halfW: 4.4, rectH: 5.6, arch: true };
// leaf tints for the obstacles, and the flytraps' (some blushing red)
const LEAVES = ['#ffffff', '#e8ffd0', '#d8f0e8', '#fff4c8', '#cfe8c0'];
const TRAPS = ['#ffffff', '#ffe2c8', '#f0ffd0', '#ffd0c0'];
const SUN = [0.2, 0.75, -0.6];
const WINGS = ['#ffb347', '#8fd6ff', '#ffe36a', '#ff8ac0', '#b8a0ff', '#ffffff'];
const GATE_DEPTH = 0.9;
const R = 7; // tunnel radius
const POST_H = 4;

const archY = (x) => POST_H + Math.sqrt(Math.max(0, R * R - x * x));

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

function ribGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.22, POST_H, 0.22), C.iron, { x: s * R, y: POST_H / 2 }));
    parts.push(part(P.box(0.4, 0.3, 0.4), C.ironShade, { x: s * R, y: 0.15 }));
  }
  parts.push(part(P.torus(R, 0.12, 4, 22, Math.PI), C.iron, { y: POST_H }));
  // decorative inner spandrel scrolls
  for (const s of [-1, 1]) parts.push(part(P.torus(0.7, 0.06, 3, 8, Math.PI * 1.2), C.iron, { x: s * (R - 0.75), y: POST_H + 0.1, rz: s > 0 ? 0 : Math.PI * 0.8 }));
  return merge(parts);
}

function frameLongGeo() {
  // purlins + side mullions running the length of a 16m chunk
  const parts = [];
  for (const a of [0.2, 0.42, 0.62, 0.8, 0.9]) {
    for (const s of [-1, 1]) {
      const ang = Math.PI / 2 - a * (Math.PI / 2);
      const x = s * Math.cos(ang) * R;
      const y = POST_H + Math.sin(ang) * R;
      parts.push(part(P.box(0.1, 0.1, 16, 1, 1, 8), C.iron, { x, y, z: -8, outline: 0.6 }));
    }
  }
  parts.push(part(P.box(0.12, 0.12, 16, 1, 1, 8), C.iron, { y: POST_H + R, z: -8, outline: 0.6 }));
  for (const s of [-1, 1]) {
    for (const y of [POST_H, 2.1]) parts.push(part(P.box(0.12, 0.12, 16, 1, 1, 8), C.iron, { x: s * R, y, z: -8, outline: 0.6 }));
    // planter bed
    parts.push(part(P.box(1.7, 0.7, 16, 1, 1, 8), C.planter, { x: s * 5.35, y: 0.35, z: -8 }));
    parts.push(part(P.box(1.5, 0.08, 16, 1, 1, 8), C.soil, { x: s * 5.35, y: 0.72, z: -8, outline: 0 }));
  }
  return merge(parts);
}

function glassGeo() {
  const roof = new THREE.CylinderGeometry(R, R, 16, 18, 8, true, Math.PI / 2, Math.PI);
  roof.rotateX(Math.PI / 2);
  roof.translate(0, POST_H, -8);
  const parts = [part(roof, '#ffffff', { outline: 0 })];
  for (const s of [-1, 1]) parts.push(part(P.box(0.04, POST_H, 16, 1, 1, 8), '#ffffff', { x: s * R, y: POST_H / 2, z: -8, outline: 0 }));
  return merge(parts);
}

function monsteraParts({ size = 1, leaves = 7, seed = 3, y0 = 0 }) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rnd() * 0.5;
    const h = y0 + (0.5 + rnd() * 0.9) * size;
    const r = (0.55 + rnd() * 0.3) * size;
    const lean = 0.4 + rnd() * 0.5;
    parts.push(part(P.cyl(0.025 * size, 0.03 * size, h - y0, 4), C.leafDeep, { x: Math.sin(a) * r * 0.45, y: y0 + (h - y0) / 2, z: Math.cos(a) * r * 0.45, rz: Math.sin(a) * 0.35, rx: Math.cos(a) * 0.35, outline: 0 }));
    parts.push(part(P.sphere(0.5 * size, 8, 5), null, {
      x: Math.sin(a) * r, y: h, z: Math.cos(a) * r,
      sx: 0.9, sy: 0.07, sz: 1.15, ry: a, rx: lean,
      grad: [C.leafDeep, C.leaf, h - 0.3, h + 0.2], tint: 1,
    }));
  }
  return parts;
}

function vineGeo(len, seed) {
  const rnd = seeded(seed);
  const parts = [part(P.cyl(0.02, 0.02, len, 4), C.leafDeep, { y: -len / 2, outline: 0 })];
  const n = Math.floor(len * 3.6);
  for (let i = 0; i < n; i++) {
    const y = -0.15 - (i / n) * len;
    const a = rnd() * 6.28;
    parts.push(part(P.sphere(0.13, 5, 3), null, { x: Math.sin(a) * 0.08, y, z: Math.cos(a) * 0.08, sy: 0.5, ry: a, rx: 0.6, grad: [C.leafDeep, C.leafHi, y - 0.1, y + 0.1], outline: 0.5 }));
    if (rnd() < 0.3) parts.push(part(P.sphere(0.06, 6, 4), C.blossom, { x: Math.cos(a) * 0.12, y: y - 0.05, z: Math.sin(a) * 0.12, outline: 0.5 }));
  }
  return parts;
}

function orangeTreeParts({ potR = 0.7, canopy = 1.15, trunk = 1.4 } = {}) {
  const parts = [...potParts({ r: potR, h: potR * 1.3, color: C.terracotta, rim: C.rim })];
  const top = potR * 1.3;
  parts.push(part(P.cyl(0.08, 0.12, trunk, 6), '#6a4a2a', { y: top + trunk / 2 }));
  parts.push(part(P.sphere(canopy, 12, 9), null, { y: top + trunk + canopy * 0.7, grad: [C.leafDeep, C.leafHi, top + trunk, top + trunk + canopy * 1.6], mark: 0.8 }));
  const rnd = seeded(9);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * 6.28;
    const e = (rnd() - 0.3) * 1.2;
    const rr = canopy * 0.98;
    parts.push(part(P.sphere(0.12, 8, 6), C.orange, { x: Math.cos(a) * Math.cos(e) * rr, y: top + trunk + canopy * 0.7 + Math.sin(e) * rr * 0.9, z: Math.sin(a) * Math.cos(e) * rr, outline: 0.6 }));
  }
  return parts;
}

// --- the plants run wild -------------------------------------------------------
// (all of it light: there's a great deal of it, so every leaf and petal is
// a handful of triangles, and most of it grows up out of the beds as you
// come - see build - so only the nearer stretch is ever drawn)
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _p3 = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _ONE = new THREE.Vector3(1, 1, 1);

// A part built standing up +y from the origin, turned and set to run from a
// to b (its outline normals turned with it).
function aimed(g, a, b) {
  _v3.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  _q.setFromUnitVectors(_Y, _v3);
  _m4.compose(_p3.set(a[0], a[1], a[2]), _q, _ONE);
  g.applyMatrix4(_m4);
  const o = g.attributes.onrm;
  for (let i = 0; i < o.count; i++) {
    _v3.set(o.getX(i), o.getY(i), o.getZ(i)).applyQuaternion(_q);
    o.setXYZ(i, _v3.x, _v3.y, _v3.z);
  }
  return g;
}
const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
// a spike tapering to a point at b; a leaf blade from a to b; a stem
const spike = (a, b, r, color, outline = 0.3) => aimed(part(P.cone(r, dist3(a, b), 3), color, { y: dist3(a, b) / 2, outline }), a, b);
function blade(a, b, w, lo, hi, o = {}) {
  const len = dist3(a, b);
  return aimed(part(P.sphere(0.5, 5, 3), null, { y: len / 2, sx: w, sy: len, sz: w * 0.18, grad: [lo, hi, 0, len], ...o }), a, b);
}
const stem = (a, b, r, color) => aimed(part(P.cyl(r * 0.8, r, dist3(a, b), 3), color, { y: dist3(a, b) / 2, outline: 0.25 }), a, b);

// A zinnia: a flat pompom of petals, a second tier on it (and close up, a
// gold eye). tint: 1 to take its colour from the instance instead.
function zinnia(parts, x, y, z, r, color, tint = 0, eye = false) {
  parts.push(part(P.sphere(r, 8, 3), color, { x, y, z, sy: 0.55, outline: 0.45, tint }));
  parts.push(part(P.sphere(r * 0.62, 6, 2), tint ? '#ffffff' : mix(color, '#ffffff', 0.25), { x, y: y + r * 0.3, z, sy: 0.7, outline: 0, tint: tint ? 0.85 : 0 }));
  if (eye) parts.push(part(P.cone(r * 0.2, r * 0.16, 4), '#e8a62a', { x, y: y + r * 0.44, z, outline: 0 }));
}

// A plain pot (fewer sides than potParts': there are dozens of these).
function smallPot(parts, x, y, z, r, color, rim) {
  const h = r * 1.3;
  parts.push(part(P.cyl(r, r * 0.74, h, 6), color, { x, y: y + h / 2, z }));
  parts.push(part(P.cyl(r * 1.08, r * 1.04, h * 0.18, 6), rim, { x, y: y + h * 0.92, z }));
  return y + h;
}

// One trap of a Venus flytrap, open: two lobes hinged along a midrib that
// runs out along +z from the origin (L long), their wine-red insides facing
// up, a fringe of pale teeth round each rim; gape: how far each lobe is
// lifted from flat (about 1.3 and it's nearly shut).
function trapParts(L, gape, tint = 0) {
  const parts = [];
  const w = L * 0.4;
  const t = L * 0.055;
  for (const s of [-1, 1]) {
    const lobe = [
      part(P.sphere(0.5, 7, 4), null, { x: (s * w) / 2, z: L / 2, sx: w, sy: t * 2, sz: L, grad: [C.trapLo, C.trapHi, -t, t], tint }),
      part(P.sphere(0.5, 7, 3), C.trapIn, { x: s * w * 0.47, y: t * 0.5, z: L * 0.5, sx: w * 0.84, sy: t * 1.15, sz: L * 0.86, outline: 0 }),
    ];
    for (let k = 0; k < 6; k++) {
      const f = -1.2 + (2.4 * k) / 5;
      const rx = (s * w) / 2 + (s * w * Math.cos(f)) / 2;
      const rz = L / 2 + (L * Math.sin(f)) / 2;
      _v3.set((s * Math.cos(f)) / w, 0, Math.sin(f) / L).normalize();
      const tl = L * 0.17;
      lobe.push(spike([rx * 0.97, 0, rz], [rx + _v3.x * tl, tl * 0.55, rz + _v3.z * tl], L * 0.02, C.trapTooth));
    }
    parts.push(...moved(lobe, { rz: s * gape }));
  }
  return parts;
}

// An overgrown Venus flytrap: a rosette of traps on leafy stalks fanned out
// round its crown at y0, each tipped up and gaping (a few shut tight on
// something), and a couple of tall flower stalks with white blossom.
// face: the traps all stand up and gape toward +z (at you).
function flytrapParts({ traps = 7, size = 1, seed = 1, y0 = 0, closed = 0.2, flowers = 2, face = false, tint = 0 }) {
  const rnd = seeded(seed);
  const parts = [];
  // the crown: a low rosette of small leaves
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd();
    parts.push(blade([0, y0, 0], [Math.sin(a) * 0.22 * size, y0 + 0.06 * size, Math.cos(a) * 0.22 * size], 0.09 * size, C.stalk, C.stalkHi));
  }
  for (let i = 0; i < traps; i++) {
    const a = face ? (i / Math.max(1, traps - 1) - 0.5) * 2.4 + (rnd() - 0.5) * 0.3 : (i / traps) * Math.PI * 2 + rnd() * 0.7;
    const reach = (0.22 + rnd() * 0.28) * size;
    const h = (face ? 0.45 + rnd() * 0.75 : 0.18 + rnd() * 0.5) * size;
    const L = (0.3 + rnd() * 0.16) * size;
    const foot = [Math.sin(a) * reach, y0 + h, Math.cos(a) * reach];
    parts.push(blade([0, y0, 0], foot, 0.085 * size, C.stalk, C.stalkHi));
    const gape = rnd() < closed ? 1.32 : 0.32 + rnd() * 0.3;
    const tr = trapParts(L, gape, tint);
    if (face) parts.push(...moved(tr, { x: foot[0], y: foot[1], z: foot[2], rx: -(1.05 + rnd() * 0.3), ry: Math.PI + a * 0.45 }));
    else parts.push(...moved(tr, { x: foot[0], y: foot[1], z: foot[2], rx: -(0.35 + rnd() * 0.55), ry: a }));
  }
  for (let i = 0; i < flowers; i++) {
    const a = rnd() * Math.PI * 2;
    const top = [Math.sin(a) * 0.12 * size, y0 + (0.95 + rnd() * 0.4) * size, Math.cos(a) * 0.12 * size];
    parts.push(stem([0, y0, 0], top, 0.011 * size, C.stalk));
    for (let k = 0; k < 4; k++) {
      const b = (k / 4) * Math.PI * 2 + a;
      parts.push(part(P.sphere(0.035 * size, 5, 3), C.blossom, { x: top[0] + Math.cos(b) * 0.05 * size, y: top[1] + (k % 2) * 0.03 * size, z: top[2] + Math.sin(b) * 0.05 * size, sy: 0.55, outline: 0.45 }));
    }
  }
  return parts;
}

// A strip of bed (4 m along z, the width of the planter, its soil at y = 0)
// packed with zinnias over mounds of foliage, ferny sprays between, and
// trailing stems spilling down the planter's front (at -x: turn it round
// for the far side). Foliage takes the instance's tint.
function zinniaBedGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  // mounds of leaves, big and small, jostling
  for (let i = 0; i < 6; i++) {
    const z = -1.75 + i * 0.7 + (rnd() - 0.5) * 0.35;
    const x = (rnd() - 0.5) * 0.7;
    const r = 0.26 + rnd() * 0.22;
    parts.push(part(P.sphere(r, 9, 5), null, { x, y: r * 0.3, z, sx: 1.1 + rnd() * 0.2, sy: 0.65 + rnd() * 0.3, ry: rnd() * 6.28, grad: [C.leafDeep, C.leafHi, -0.05, r * 1.0], mark: 0.7, tint: 1 }));
  }
  for (let i = 0; i < 8; i++) {
    const z = -1.9 + rnd() * 3.8;
    const x = (rnd() - 0.5) * 1.2;
    const a = rnd() * 6.28;
    parts.push(part(P.sphere(0.13, 5, 2), null, { x, y: 0.3 + rnd() * 0.2, z, sy: 0.35, ry: a, rx: 0.5, grad: [C.fern, C.fernHi, 0.25, 0.5], outline: 0.4, tint: 1 }));
  }
  // the zinnias, big and bright, held up on their stems above the leaves
  for (let i = 0; i < 18; i++) {
    const z = -1.9 + rnd() * 3.8;
    const x = (rnd() - 0.5) * 1.25;
    const y = 0.5 + rnd() * 0.32;
    zinnia(parts, x, y, z, 0.11 + rnd() * 0.05, ZINNIAS[Math.floor(rnd() * ZINNIAS.length)]);
  }
  // leaves tumbling over the front edge and down the planter
  for (let i = 0; i < 3; i++) {
    const z0 = -1.35 + i * 1.35 + (rnd() - 0.5) * 0.5;
    const drop = 0.3 + rnd() * 0.3;
    for (let k = 0; k < 7; k++) {
      const f = k / 6;
      const y = 0.08 - f * drop;
      const z = z0 + (rnd() - 0.5) * (0.5 - f * 0.3);
      parts.push(part(P.sphere(0.12 - f * 0.03, 5, 2), null, { x: -0.86 - 0.04 * Math.sin(f * 3), y, z, sy: 0.5, ry: rnd() * 6.28, rx: 1.0, grad: [C.leafDeep, C.leafHi, y - 0.1, y + 0.1], outline: 0.45, tint: 1 }));
    }
  }
  return merge(parts);
}

// Ivy up a rib's post (here at x = 0, the house to -x) from the bed to the
// top, and on round the start of its arch.
function ivyRibGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    let x, y;
    if (k < 0.62) {
      y = 0.7 + (k / 0.62) * (POST_H - 0.7);
      x = 0;
    } else {
      const th = ((k - 0.62) / 0.38) * 0.62;
      x = R * Math.cos(th) - R;
      y = POST_H + R * Math.sin(th);
    }
    const a = rnd() * 6.28;
    const off = 0.1 + rnd() * 0.08;
    parts.push(part(P.sphere(0.12 + rnd() * 0.05, 5, 2), null, {
      x: x - 0.12 + Math.cos(a) * off * 0.6, y: y + (rnd() - 0.5) * 0.2, z: Math.sin(a) * off,
      sy: 0.45, ry: a, rx: 0.7, grad: [C.leafDeep, C.leafHi, y - 0.12, y + 0.12], outline: 0.45, tint: 1,
    }));
    // now and then a sprig hanging off it
    if (rnd() < 0.1 && y > 2) parts.push(...vineGeo(0.4 + rnd() * 0.5, seed * 13 + i).map((g) => g.translate(x - 0.25, y, 0)));
  }
  return merge(parts);
}

// A hanging basket on three chains from a hook at the origin (chain long),
// heaped with leaves and trailing stems, blossom of the instance's colour.
function hungBasketParts(chain, seed) {
  const rnd = seeded(seed);
  const parts = [];
  const r = 0.3;
  const rimY = -chain;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push(stem([Math.cos(a) * r, rimY, Math.sin(a) * r], [0, 0, 0], 0.01, C.chain));
  }
  parts.push(part(P.sphere(r, 8, 4), C.terracotta, { y: rimY - r * 0.1, sy: 0.6 }));
  parts.push(part(P.sphere(r * 1.05, 7, 4), null, { y: rimY + r * 0.3, sy: 0.6, grad: [C.leafDeep, C.leafHi, rimY, rimY + r * 0.8] }));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rnd();
    parts.push(...vineGeo(0.5 + rnd() * 0.7, seed * 3 + k).map((g) => g.translate(Math.cos(a) * r * 0.9, rimY + 0.05, Math.sin(a) * r * 0.9)));
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rnd();
    zinnia(parts, Math.cos(a) * r * 0.55, rimY + r * 0.52 + rnd() * 0.06, Math.sin(a) * r * 0.55, 0.07, '#ffffff', 1);
  }
  return parts;
}

// An iron bracket off a rib's post (its mount, at the origin, on the post;
// reaching to -x) with a basket hung from its end.
function bracketBasketGeo(seed) {
  const parts = [
    part(P.box(1.25, 0.06, 0.06), C.iron, { x: -0.62, outline: 0.6 }),
    part(P.torus(0.42, 0.035, 3, 8, Math.PI / 2), C.iron, { x: -0.42, y: -0.42, rz: Math.PI / 2, outline: 0.6 }),
  ];
  parts.push(...hungBasketParts(0.75, seed).map((g) => g.translate(-1.18, -0.06, 0)));
  return merge(parts);
}

// A slatted shelf of three tiers against the glass, crowded with small pots:
// ferns, trailing pothos, little flytraps, zinnias.
function plantShelfGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (const z of [-0.85, 0.85]) for (const x of [-0.2, 0.2]) parts.push(part(P.box(0.05, 2.2, 0.05), C.frameDark, { x, y: 1.1, z }));
  for (const y of [0.95, 1.5, 2.05]) {
    parts.push(part(P.box(0.48, 0.04, 1.8), C.wood, { y }));
    for (let i = 0; i < 4; i++) {
      const z = -0.66 + i * 0.44 + (rnd() - 0.5) * 0.08;
      const r = 0.09 + rnd() * 0.04;
      const white = rnd() < 0.4;
      const top = smallPot(parts, 0, y + 0.02, z, r, white ? '#f2f2ea' : C.terracotta, white ? '#d8dcd0' : C.rim);
      const kind = rnd();
      if (kind < 0.35) {
        parts.push(part(P.sphere(r * 1.5, 6, 4), null, { y: top + r * 0.7, z, sy: 0.85, grad: [C.fern, C.fernHi, top, top + r * 2], tint: 1 }));
      } else if (kind < 0.65) {
        parts.push(part(P.sphere(r * 1.3, 6, 3), null, { y: top + r * 0.4, z, sy: 0.6, grad: [C.leafDeep, C.leafHi, top, top + r], tint: 1 }));
        parts.push(...vineGeo(0.3 + rnd() * 0.3, seed * 5 + i).map((g) => g.translate(-0.18, top + 0.05, z)));
      } else if (kind < 0.8) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + rnd();
          const foot = [Math.sin(a) * 0.06, top + 0.06, z + Math.cos(a) * 0.06];
          parts.push(...moved(trapParts(0.1, 0.45), { x: foot[0], y: foot[1], z: foot[2], rx: -0.6, ry: a }));
        }
      } else {
        parts.push(part(P.sphere(r * 1.2, 6, 3), null, { y: top + r * 0.4, z, sy: 0.6, grad: [C.leafDeep, C.leafHi, top, top + r], tint: 1 }));
        for (let k = 0; k < 3; k++) zinnia(parts, (rnd() - 0.5) * r, top + r * 0.9 + rnd() * 0.06, z + (rnd() - 0.5) * r * 1.2, 0.05, ZINNIAS[Math.floor(rnd() * ZINNIAS.length)]);
      }
    }
  }
  return merge(parts);
}

// --- the jungle ---------------------------------------------------------------
// The Glasshouse grown lush: the beds overrun with big tropical leaves -
// banana plants arching up into the roof, elephant ears, calatheas barred
// pale, ferns spilling fronds over the path's edge, dark ficus trees against
// the glass - and Spanish moss hanging in long grey-green curtains from the
// purlins, glowing where the sun comes through it.

const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _mb = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();

// A part built along +y from the origin (its width along x, its face toward
// +z), set to run from a toward b lying as flat as it can: its width kept
// level, its face up (a leaf held out from its stalk).
function flatAlong(g, a, b) {
  _by.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  _bx.crossVectors(_by, _Y);
  if (_bx.lengthSq() < 1e-6) _bx.set(1, 0, 0);
  _bx.normalize();
  _bz.crossVectors(_bx, _by);
  _mb.makeBasis(_bx, _by, _bz).setPosition(a[0], a[1], a[2]);
  g.applyMatrix4(_mb);
  _m3.setFromMatrix4(_mb);
  const o = g.attributes.onrm;
  for (let i = 0; i < o.count; i++) {
    _v3.set(o.getX(i), o.getY(i), o.getZ(i)).applyMatrix3(_m3);
    o.setXYZ(i, _v3.x, _v3.y, _v3.z);
  }
  return g;
}

// A leaf along +y from its foot at the origin, len long and w wide, its face
// toward +z, shaded lo at the foot to hi at the tip. o: thin (its thickness,
// a share of its width), bend (how far its tip droops, a share of its
// length), heart (lobes at its foot), rib (a pale midrib and veins: their
// colour), bars (the calathea's herringbone of pale bars: their colour),
// tint (takes the instance's colour).
function leafGeo(len, w, lo, hi, o = {}) {
  const t = o.thin ?? 0.06;
  const tint = o.tint ?? 1;
  const parts = [part(P.sphere(0.5, 8, 6), null, { y: len / 2, sx: w, sy: len, sz: w * t, grad: [lo, hi, 0, len], outline: o.outline ?? 0.35, tint })];
  if (o.heart) {
    for (const s of [-1, 1]) parts.push(part(P.sphere(0.5, 6, 4), null, { x: s * w * 0.24, y: len * 0.06, sx: w * 0.52, sy: len * 0.34, sz: w * t * 0.9, rz: s * 0.55, grad: [lo, hi, -len * 0.1, len], outline: 0.3, tint }));
  }
  // half the leaf's width at y along it
  const half = (y) => (w / 2) * Math.sqrt(Math.max(0, 1 - ((2 * y - len) / len) ** 2));
  const bar = (y0, side, ang, frac, wide, color) => {
    const l = half(y0) * frac / Math.cos(ang);
    if (l < 0.01) return;
    parts.push(part(P.box(l, wide, w * t * 1.15), color, { x: side * Math.cos(ang) * l / 2, y: y0 + Math.sin(ang) * l / 2, rz: side * ang, outline: 0 }));
  };
  if (o.rib) {
    parts.push(part(P.box(0.012 + len * 0.012, len * 0.9, w * t * 1.2), o.rib, { y: len * 0.47, outline: 0 }));
    for (let k = 1; k <= 4; k++) for (const sd of [-1, 1]) bar(len * (0.1 + k * 0.16), sd, 0.6, 0.85, 0.008 + len * 0.004, o.rib);
  }
  if (o.bars) {
    parts.push(part(P.box(0.014, len * 0.86, w * t * 1.2), o.bars, { y: len * 0.47, outline: 0 }));
    for (let k = 0; k < 6; k++) {
      const y0 = len * (0.12 + k * 0.13);
      for (const sd of [-1, 1]) bar(y0, sd, 0.7, k % 2 ? 0.55 : 0.9, len * (k % 2 ? 0.022 : 0.036), o.bars);
    }
  }
  const g = merge(parts);
  if (o.bend) {
    // (drooping toward the tip, away from its face)
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const f = Math.max(0, pos.getY(i)) / len;
      pos.setZ(i, pos.getZ(i) - o.bend * len * f * f);
    }
  }
  return g;
}

// A leaf on the end of its stalk: the stalk from foot to at, the leaf from
// there out toward to.
function leafOn(parts, foot, at, to, len, w, lo, hi, o = {}) {
  if (foot) parts.push(stem(foot, at, o.stalk ?? 0.02, o.stalkColor ?? lo));
  parts.push(flatAlong(leafGeo(len, w, lo, hi, o), at, to));
}

// Spanish moss hung from a purlin (the origin): a tuft and long shaggy
// locks, each in two lengths with a kink between, down to about len below.
function mossGeo(len, seed) {
  const rnd = seeded(seed);
  const parts = [part(P.sphere(0.24, 7, 4), null, { y: -0.1, sy: 0.55, grad: [C.moss, C.mossTip, -0.4, 0.3], outline: 0.3, tint: 1 })];
  const locks = 14;
  for (let i = 0; i < locks; i++) {
    const a = rnd() * 6.28;
    const r = 0.04 + rnd() * 0.24;
    const L = len * (0.4 + rnd() * 0.6);
    const top = [Math.cos(a) * r, -0.05, Math.sin(a) * r];
    const kink = [top[0] + (rnd() - 0.5) * 0.18, -L * (0.45 + rnd() * 0.15), top[2] + (rnd() - 0.5) * 0.18];
    const tip = [kink[0] + (rnd() - 0.5) * 0.2, -L, kink[2] + (rnd() - 0.5) * 0.2];
    const thick = 0.04 + rnd() * 0.035;
    const l1 = dist3(top, kink);
    const l2 = dist3(kink, tip);
    // (paler toward the tips, where the light comes through it)
    const mid = rnd() < 0.5 ? C.moss : '#748f72';
    parts.push(aimed(part(P.cyl(thick * 0.75, thick, l1, 3), null, { y: l1 / 2, grad: [C.moss, mid, l1, 0], outline: 0.2, tint: 1 }), top, kink));
    parts.push(aimed(part(P.cone(thick * 0.78, l2, 3), null, { y: l2 / 2, grad: [mid, C.mossTip, 0, l2], outline: 0.2, tint: 1 }), kink, tip));
    // a wisp off the side
    if (rnd() < 0.45) {
      const w0 = [kink[0], kink[1] * 0.85, kink[2]];
      const w1 = [w0[0] + (rnd() - 0.5) * 0.3, w0[1] - L * 0.3, w0[2] + (rnd() - 0.5) * 0.3];
      parts.push(spike(w0, w1, thick * 0.5, C.mossTip, 0.15));
    }
  }
  return merge(parts);
}

// A banana plant (for the bed at +x; the path to -x): a stout pseudo-stem
// and a crown of great paddle leaves arching up and out and drooping at
// their tips - the ones that would reach out over the path held up high.
function bananaGeo(seed, h = 2.3) {
  const rnd = seeded(seed);
  const parts = [part(P.cyl(0.1, 0.17, h, 7), null, { y: h / 2, grad: [C.bananaStem, '#9ab85a', 0, h], mark: 0.6 })];
  parts.push(part(P.sphere(0.2, 6, 4), C.bananaStem, { y: 0.1, sy: 0.6 }));
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + rnd() * 0.5;
    const dx = Math.cos(a), dz = Math.sin(a);
    const toPath = Math.max(0, -dx);
    const len = 2.5 + rnd() * 0.9 - toPath * 0.6;
    const up = 0.55 + rnd() * 0.35 + toPath * 0.8;
    const foot = [dx * 0.06, h - 0.15 - rnd() * 0.3, dz * 0.06];
    const at = [dx * 0.25, foot[1] + 0.3, dz * 0.25];
    const to = [at[0] + dx, at[1] + up, at[2] + dz];
    leafOn(parts, foot, at, to, len, 0.7 + rnd() * 0.18, C.banana, C.bananaHi, { rib: '#d6ecb0', bend: 0.42 - toPath * 0.25, stalk: 0.035, stalkColor: C.bananaStem, thin: 0.05 });
  }
  // (one leaf still furled, a spike up the middle)
  parts.push(spike([0, h, 0], [0.05, h + 1.1, 0.02], 0.07, C.bananaHi));
  return merge(parts);
}

// Elephant ears (the bed's front at the origin, the path to -x): great
// heart-shaped leaves held out on long stalks, nodding at their tips.
function elephantEarGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    // (fanned out over the bed and toward the path, none of them reaching
    // over it)
    const a = Math.PI + (rnd() - 0.5) * 2.6;
    const dx = Math.cos(a), dz = Math.sin(a);
    const hgt = 0.9 + rnd() * 1.1;
    const out = 0.25 + rnd() * 0.3;
    const at = [dx * out * (dx < 0 ? 0.6 : 1), hgt, dz * out];
    const len = 0.95 + rnd() * 0.55;
    const to = [at[0] + dx * 0.9, at[1] - 0.25 - rnd() * 0.35, at[2] + dz * 0.9];
    leafOn(parts, [0, 0, 0], at, to, len, len * 0.78, C.ear, C.earHi, { heart: true, rib: C.vein, bend: 0.12, stalk: 0.022, stalkColor: '#3f6a34', thin: 0.045 });
  }
  return merge(parts);
}

// A calathea: a low clump of oval leaves held up and out on short stalks,
// dark green barred pale in a herringbone.
function calatheaGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + rnd() * 0.6;
    const dx = Math.cos(a), dz = Math.sin(a);
    const at = [dx * 0.1, 0.18 + rnd() * 0.22, dz * 0.1];
    const tilt = 0.7 + rnd() * 0.6;
    const to = [at[0] + dx, at[1] + tilt, at[2] + dz];
    const len = 0.42 + rnd() * 0.18;
    leafOn(parts, [dx * 0.02, 0, dz * 0.02], at, to, len, len * 0.46, C.calathea, C.calatheaHi, { bars: C.calatheaBar, bend: 0.1, stalk: 0.012, stalkColor: '#3a5a2a', thin: 0.05, tint: 0 });
  }
  return merge(parts);
}

// A fern of long arching fronds, their leaflets picked out in a lighter green,
// spilling every way (over the bed's edge onto the path's mossy border too).
function frondFernGeo(seed) {
  const rnd = seeded(seed);
  const parts = [part(P.sphere(0.22, 7, 4), null, { y: 0.08, sy: 0.5, grad: [C.frond, C.frondHi, 0, 0.2], tint: 1 })];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + rnd() * 0.4;
    const dx = Math.cos(a), dz = Math.sin(a);
    const rise = 0.35 + rnd() * 0.9;
    const at = [dx * 0.05, 0.12, dz * 0.05];
    const to = [at[0] + dx, at[1] + rise, at[2] + dz];
    const len = 0.75 + rnd() * 0.45;
    parts.push(flatAlong(leafGeo(len, 0.2, C.frond, C.frondHi, { bars: '#5fa244', bend: 0.75, thin: 0.08, tint: 1 }), at, to));
  }
  return merge(parts);
}

// A ficus grown up against the glass: a grey trunk forking into boughs, each
// ending in a cloud of dark glossy leaves.
function ficusGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const trunkH = 2.0;
  parts.push(part(P.cyl(0.1, 0.16, trunkH, 6), C.bark, { y: trunkH / 2 }));
  const boughs = 5;
  for (let b = 0; b < boughs; b++) {
    const a = (b / boughs) * 6.28 + rnd() * 0.7;
    // (leaning back toward the glass, at +x, more than over the path)
    const dx = Math.cos(a) * (Math.cos(a) < 0 ? 0.5 : 1), dz = Math.sin(a);
    const from = [0, trunkH * (0.7 + rnd() * 0.3), 0];
    const end = [dx * (0.9 + rnd() * 0.5), from[1] + 1.2 + rnd() * 1.4, dz * (0.9 + rnd() * 0.5)];
    parts.push(stem(from, end, 0.06, C.bark));
    parts.push(part(P.sphere(0.6, 8, 6), null, { x: end[0], y: end[1] + 0.2, z: end[2], sy: 0.75, grad: [C.ficus, C.ficusHi, end[1] - 0.4, end[1] + 0.8], mark: 0.75, tint: 1 }));
    for (let k = 0; k < 9; k++) {
      const u = rnd() * 6.28, e = (rnd() - 0.3) * 1.3;
      const at = [end[0] + Math.cos(u) * Math.cos(e) * 0.55, end[1] + 0.2 + Math.sin(e) * 0.45, end[2] + Math.sin(u) * Math.cos(e) * 0.55];
      const to = [at[0] + Math.cos(u), at[1] - 0.3 + rnd() * 0.5, at[2] + Math.sin(u)];
      leafOn(parts, null, at, to, 0.32 + rnd() * 0.12, 0.17, C.ficus, C.ficusHi, { bend: 0.15, thin: 0.08 });
    }
  }
  return merge(parts);
}

// --- obstacles --------------------------------------------------------------
// A small cluster of zinnias, their colour the instance's, set on top of an
// obstacle's plants (so no two pots or planters bloom quite alike).
function bloomGeo() {
  const parts = [part(P.sphere(0.13, 6, 4), null, { y: 0.02, sy: 0.5, grad: [C.leafDeep, C.leafHi, -0.04, 0.08], outline: 0.4 })];
  zinnia(parts, -0.06, 0.1, 0.02, 0.075, '#ffffff', 1, true);
  zinnia(parts, 0.07, 0.07, -0.04, 0.065, '#ffffff', 1, true);
  zinnia(parts, 0.0, 0.13, 0.07, 0.06, '#ffffff', 1, true);
  return merge(parts);
}
const blooms = (spots, dz) => (put, rng, { x, d }) => {
  for (const [bx, by, bz] of spots) {
    if (!rng.chance(0.55)) continue;
    put('bloom', x + bx + rng.float(-0.06, 0.06), by, d + dz - bz, { c: rng.pick(ZINNIAS), ry: rng.float(0, 6.28), s: rng.float(1.15, 1.45) });
  }
};

function potRowGeo() {
  const parts = [];
  for (const x of [-0.62, 0, 0.62]) {
    parts.push(...potParts({ r: 0.32, h: 0.55, x }));
    parts.push(...bushParts({ r: 0.3, lo: C.fern, hi: C.fernHi }).map((g) => g.translate(x, 0.48, 0)));
  }
  return merge(parts).translate(0, 0, -0.35);
}

function planterBoxGeo(width) {
  const parts = [
    part(P.box(width, 0.58, 0.8), C.planter, { y: 0.29 }),
    part(P.box(width + 0.08, 0.08, 0.88), C.ironShade, { y: 0.6 }),
  ];
  const n = Math.round(width * 2.4);
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + 0.25 + ((width - 0.5) * i) / Math.max(1, n - 1);
    parts.push(part(P.sphere(0.2, 8, 6), null, { x, y: 0.7, z: Math.sin(i * 2.1) * 0.15, sy: 0.7, grad: [C.fern, C.fernHi, 0.55, 0.85], tint: 1 }));
    if (i % 2 === 0) parts.push(part(P.sphere(0.07, 6, 4), i % 4 === 0 ? C.blossom : '#ffb3c8', { x: x + 0.08, y: 0.86, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.4);
}

function hangingBasketGeo(half, baskets) {
  // Big hanging baskets on an iron frame. Bowls and trailing leaves form one
  // band whose lowest leaves sit on the duck line, open floor beneath.
  const D = CONFIG.duckLine;
  const bar = 2.75;
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.16, bar + 0.1, 0.16), C.frameDark, { x: s * half, y: (bar + 0.1) / 2 }));
    parts.push(part(P.box(0.36, 0.22, 0.36), C.planter, { x: s * half, y: 0.11 }));
    parts.push(part(P.torus(0.26, 0.045, 3, 8, Math.PI / 2), C.frameDark, { x: s * (half - 0.26), y: bar - 0.26, rz: s > 0 ? 0 : Math.PI / 2 }));
  }
  parts.push(part(P.box(half * 2 + 0.24, 0.16, 0.16), C.frameDark, { y: bar }));
  // leafy garland along the bar
  for (let i = 0; i <= Math.round(half * 4); i++) {
    const x = -half + (half * 2 * i) / Math.round(half * 4);
    parts.push(part(P.sphere(0.13, 7, 5), null, { x, y: bar + 0.02, z: 0.05, sy: 0.7, grad: [C.leafDeep, C.leafHi, bar - 0.1, bar + 0.12] }));
  }
  const slot = (half * 2) / baskets;
  const r = Math.min(0.38, slot * 0.4);
  const rimY = D + 0.5;
  for (let i = 0; i < baskets; i++) {
    const x = -half + slot * (i + 0.5);
    parts.push(part(P.cyl(0.012, 0.012, bar - rimY, 3), '#2a3a34', { x, y: (bar + rimY) / 2, outline: 0 }));
    parts.push(part(P.sphere(r, 10, 6), C.terracotta, { x, y: rimY - r * 0.1, sy: 0.62 }));
    parts.push(part(P.torus(r * 0.98, 0.035, 4, 12), C.rim, { x, y: rimY + r * 0.05, rx: Math.PI / 2, outline: 0.5 }));
    parts.push(part(P.sphere(r * 1.02, 9, 6), null, { x, y: rimY + r * 0.3, sy: 0.55, grad: [C.leafDeep, C.leafHi, rimY, rimY + r * 0.8] }));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + i;
      const vx = x + Math.cos(a) * r * 0.85;
      const vz = Math.sin(a) * r * 0.85;
      const len = rimY - D - 0.08 - (k % 2) * 0.12;
      parts.push(...vineGeo(len, 3 + i * 5 + k).map((g) => g.translate(vx, rimY, vz)));
    }
    parts.push(part(P.sphere(0.07, 6, 4), C.blossom, { x: x - r * 0.3, y: rimY + r * 0.55, z: 0.1, outline: 0.5 }));
    parts.push(part(P.sphere(0.07, 6, 4), '#ffb3c8', { x: x + r * 0.35, y: rimY + r * 0.5, z: -0.05, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.2);
}

// A long low trough of young flytraps, the hurdle's height.
function flytrapTroughGeo() {
  const parts = [
    part(P.box(1.9, 0.4, 0.62), C.planter, { y: 0.2 }),
    part(P.box(1.98, 0.07, 0.7), C.ironShade, { y: 0.41 }),
    part(P.box(1.8, 0.04, 0.54), C.soil, { y: 0.44, outline: 0 }),
  ];
  for (let i = 0; i < 4; i++) parts.push(...flytrapParts({ traps: 5, size: 0.58, seed: 31 + i * 7, y0: 0.44, flowers: 0, closed: 0.25, tint: 1 }).map((g) => g.translate(-0.69 + i * 0.46, 0, (i % 2 ? 0.08 : -0.08))));
  return merge(parts).translate(0, 0, -0.4);
}

// A Venus flytrap left to grow in a great pot until it fills the lane,
// its traps up over your head, gaping at you.
function giantFlytrapGeo() {
  const parts = [...potParts({ r: 0.72, h: 0.92, color: C.terracotta, rim: C.rim })];
  parts.push(...flytrapParts({ traps: 6, size: 2.15, seed: 5, y0: 0.88, flowers: 2, face: true, closed: 0.15, tint: 1 }));
  // and young ones round its feet, spilling over the rim
  parts.push(...flytrapParts({ traps: 7, size: 0.8, seed: 9, y0: 0.88, flowers: 0, closed: 0.1, tint: 1 }));
  return merge(parts).translate(0, 0, -0.75);
}

function bigMonsteraGeo() {
  const parts = [...potParts({ r: 0.72, h: 0.95, color: C.terracotta, rim: C.rim })];
  parts.push(...monsteraParts({ size: 2.0, leaves: 9, seed: 21, y0: 0.9 }));
  return merge(parts).translate(0, 0, -0.75);
}

function pottingBenchGeo() {
  const parts = [];
  for (const x of [-0.9, 0.9]) for (const z of [-0.4, 0.4]) parts.push(part(P.box(0.08, 2.6, 0.08), C.woodDark, { x, y: 1.3, z }));
  for (const y of [0.5, 1.3, 2.1]) {
    parts.push(part(P.box(1.95, 0.08, 1.0), C.wood, { y }));
    for (const x of [-0.6, 0, 0.6]) {
      parts.push(...potParts({ r: 0.2, h: 0.3, x, y: y + 0.04 }));
      parts.push(part(P.sphere(0.2, 8, 6), null, { x, y: y + 0.42, sy: 0.8, grad: [C.fern, C.fernHi, y + 0.25, y + 0.6] }));
    }
  }
  parts.push(part(P.box(1.95, 0.6, 0.06), C.wood, { y: 2.55, z: -0.45 }));
  return merge(parts).translate(0, 0, -0.5);
}

function gateGeo() {
  const parts = [...gateFrameParts(OPENING, { thick: 0.55, depth: GATE_DEPTH, color: C.iron })];
  // iron tracery on the glass end wall
  for (const s of [-1, 1]) {
    for (const x of [5.5, 6.3]) parts.push(part(P.box(0.14, archY(x) - 0.2, 0.14), C.iron, { x: s * x, y: (archY(x) - 0.2) / 2 }));
    parts.push(part(P.box(2.6, 0.14, 0.14), C.iron, { x: s * 5.7, y: POST_H }));
    parts.push(...orangeTreeParts({ potR: 0.55, canopy: 0.9, trunk: 1.1 }).map((g) => g.translate(s * 5.9, 0, 1.4)));
  }
  parts.push(part(P.torus(R, 0.18, 5, 28, Math.PI), C.iron, { y: POST_H }));
  for (const s of [-1, 1]) parts.push(part(P.box(0.3, POST_H, 0.3), C.iron, { x: s * R, y: POST_H / 2 }));
  parts.push(part(P.cyl(0.9, 0.9, 0.2, 18), C.lantern, { y: OPENING.rectH + OPENING.halfW + 0.9, rx: Math.PI / 2, emit: 1 }));
  return merge(parts);
}

function gateGlassGeo() {
  const s = new THREE.Shape();
  s.moveTo(-R, 0);
  s.lineTo(R, 0);
  s.lineTo(R, POST_H);
  s.absarc(0, POST_H, R, 0, Math.PI, false);
  s.closePath();
  s.holes.push(doorShape(OPENING.halfW + 0.5, OPENING.rectH, true));
  return merge([part(P.extrude(s, 0.05, 24), '#ffffff', { outline: 0 })]);
}

// The door into the Glasshouse: glazed - panes of pale glass in a grid of
// iron glazing bars - and ivy climbing up it from the foot.
function glazedLeaf({ W, H, z, f, top }) {
  const out = [];
  const at = (t) => z + (f * t) / 2;
  const cols = 2;
  const rows = 4;
  const pw = (W - 0.6) / cols;
  const ph = (H - 0.9) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(part(P.box(pw - 0.16, ph - 0.16, 0.05), '#d8f4ea', { x: 0.3 + pw * (c + 0.5), y: 0.6 + ph * (r + 0.5), z: at(0.05), emit: 0.4, outline: 0 }));
    }
  }
  for (let c = 0; c <= cols; c++) out.push(part(P.box(0.12, H - 0.6, 0.1), '#2e3a36', { x: 0.3 + pw * c, y: 0.3 + (H - 0.6) / 2, z: at(0.1), outline: 0.4 }));
  for (let r = 0; r <= rows; r++) out.push(part(P.box(W - 0.48, 0.12, 0.1), '#2e3a36', { x: W / 2, y: 0.6 + ph * r, z: at(0.1), outline: 0.4 }));
  // a fan of glazing under the arch
  for (let k = 1; k < 4; k++) {
    const a = Math.PI / 2 + (k / 4) * (Math.PI / 2);
    const len = W - 0.3;
    out.push(part(P.box(0.08, len, 0.1), '#2e3a36', { x: W + Math.cos(a) * len * 0.5, y: H + Math.sin(a) * len * 0.5, z: at(0.1), rz: a - Math.PI / 2, outline: 0.4 }));
  }
  for (let i = 0; i < 16; i++) {
    const y = 0.2 + i * 0.32;
    const x = 0.45 + Math.sin(i * 0.9) * 0.3 + i * 0.03;
    out.push(part(P.sphere(0.2, 7, 5), i % 2 ? '#3f8f2c' : '#7fc236', { x, y, z: at(0.22), sz: 0.45, mark: 0.85 }));
  }
  return out;
}

export default {
  id: 'conservatory',
  name: 'The Glasshouse',
  doorColor: '#2fa39a',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    // warm and humid: soft sunlight through glass fogged with condensation,
    // a gentle haze that gathers only far down the tunnel (never over what's
    // coming at you), soft shafts of light slanting down over the beds, a few
    // motes drifting in them; the green deep and lush, dark in the shade of
    // the big leaves and glowing where the light comes through them
    sky: ['#86bf98', '#fbeec6', '#4f8458'],
    bloom: ['#2fc0a8', '#ff9ac8', '#ffa83a'], // the colours its doorway bloom is made of
    sun: { dir: [0.3, 0.5, -1], glow: '#f6dea4', disc: '#fff8e0', size: 0.04 },
    stars: 0,
    skyFx: { rays: 0.45, clouds: 0.1 },
    // soft, wrapped light; shade the deep green of being under the leaves;
    // everything back-lit, leaves glowing gold at their edges
    light: { dir: SUN, shadow: [0.54, 0.66, 0.54], hi: [1.12, 1.08, 0.88], soft: 0.4, wrap: 0.45, hiAmt: 0.4, lift: 1 },
    rim: [1.0, 0.9, 0.55, 0.58],
    mist: { color: '#f2e6bc', amount: 0.28, top: 3.4, fade: 3.5, near: 16, far: 90 },
    dapple: [0.38, 0.11, 0.015],
    grade: { sat: 1.06, contrast: 1.02, vignette: 0.5, exposure: 1.0, tint: '#0c2a16' },
    beam: { color: '#fff2cc', amount: 0.3 },
    ink: '#0b2a20',
    fog: [44, 180],
    // old stone pavers, moss in the joints (ground pattern 13)
    ground: ['#d9d2b6', '#b5b29a', '#4f7a3a'],
    shadowDecal: [0.5, 0.64, 0.5],
    cast: [-0.27, 0.8],
    // (fogged with condensation: milky, the garden outside a blur)
    glass: ['#d4eecb', 0.32],
    glowGain: 0.7,
    // motes and droplets hanging in the light, drifting slowly up
    particles: { color: '#fff2c4', size: 1.8, drift: [0.05, 0.12, 0], opacity: 0.55 },
  },

  visits: [
    { env: { particles: { color: '#ffd6e8', size: 2.4, drift: [0.4, -0.2, 0], opacity: 0.85 }, beam: { amount: 0.28 } } },
    {
      env: {
        sky: ['#4a5aa8', '#ffb890', '#2f5f5a'],
        sun: { dir: [0.35, 0.08, -1], glow: '#ff9a70', disc: '#ffe0c0' },
        light: { shadow: [0.74, 0.7, 0.84], hi: [1.12, 1.0, 0.9] },
        rim: [1.0, 0.7, 0.55, 0.44],
        mist: { color: '#ffd0c0' },
        glass: ['#ffb8d8', 0.14],
        grade: { tint: '#4a2a4a' },
        beam: { color: '#ffc8a0' },
        glowGain: 1.1,
        particles: { color: '#fff6a0', size: 2.8, drift: [0.1, 0.25, 0], opacity: 1 },
      },
    },
    {
      env: {
        sky: ['#04141f', '#0f5a60', '#06201f'],
        sun: { dir: [0.25, 0.3, -1], glow: '#2ad0c0', disc: '#c8fff0', size: 0.03 },
        stars: 1,
        skyFx: { rays: 0.2, aurora: 0.35 },
        light: { dir: [0.2, 0.75, -0.6], shadow: [0.36, 0.52, 0.6], hi: [0.9, 1.15, 1.15] },
        rim: [0.3, 1.0, 0.85, 0.46],
        mist: { color: '#0a6a6a', amount: 0.55 },
        dapple: [0.4, 0.09, 0.03],
        glass: ['#40ffd8', 0.1],
        grade: { sat: 1.15, contrast: 1.05, exposure: 1.1, tint: '#00141a', vignette: 0.45 },
        beam: { color: '#60ffe0', amount: 0.18 },
        glowGain: 1.6,
        particles: { color: '#7affe6', size: 2.8, drift: [0.05, 0.3, 0], opacity: 1 },
        trip: [0, 0.25, 0.1],
      },
    },
  ],

  build(b) {
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 13);
    b.toon('lawn', groundStrip(420, 16, C.lawn, 8, { y: -0.04, mark: 0.4 }), { ink: 0, cap: 40, marks: [0.3, 0.3] });
    b.toon('rib', ribGeo(), { cap: 120, anim: 'rise', ink: 0.035 });
    b.toon('frameLong', frameLongGeo(), { cap: 40, anim: 'rise', ink: 0.035 });
    b.glass('glass', glassGeo(), { cap: 40, anim: 'rise' });
    // (the beds' greenery grows up out of them as you come, and the vines let
    // down from the arches: the far stretch isn't drawn - see GROW below)
    const SPROUT = [2, 50, 96, 0];
    b.toon('fern', merge(bushParts({ r: 0.62, lo: C.fern, hi: C.fernHi }).slice(0, 2)), { cap: 300, anim: SPROUT, marks: [2, 1.6], wobble: [0.01, 0, 1.6, 0] });
    b.toon('monstera', merge(monsteraParts({ size: 1.2, leaves: 7, seed: 5 })), { cap: 160, anim: SPROUT, wobble: [0.012, 0, 1.3, 0] });
    b.toon('potCypress', merge([...potParts({ r: 0.5, h: 0.75 }), ...cypressParts({ h: 4.4, r: 0.75, lo: C.leafDeep, hi: C.leafHi, trunkH: 1.2, seg: 8 }).map((g) => g.translate(0, 0.7, 0))]), { cap: 80, anim: 'pop', marks: [3, 2.4], wobble: [0.0015, 0, 1.1, 0] });
    b.toon('orangeTree', merge(orangeTreeParts()), { cap: 40, anim: 'pop', marks: [2.2, 2] });
    b.toon('vineLong', merge(vineGeo(2.6, 1)), { cap: 200, anim: SPROUT, wobble: [0.03, 0, 1.0, 0] });
    b.toon('vineShort', merge(vineGeo(1.5, 7)), { cap: 200, anim: SPROUT, wobble: [0.04, 0, 1.2, 0] });
    b.toon('gardenTree', merge(roundTreeParts({ r: 2.4, trunkH: 2.6, lo: '#1f5a3a', hi: '#5fae5a' })), { cap: 160, anim: 'pop', marks: [2.4, 2] });
    b.toon('cypress', merge(cypressParts({ h: 10, r: 1.4, lo: '#1f5a3a', hi: '#7fc25a', seg: 8 })), { cap: 200, anim: 'pop', marks: [3, 2.6], ink: 0 });
    b.toon('lantern', merge(lanternPostParts({ h: 2.6, pole: '#24453c', glass: C.lantern, cap: '#24453c' })), { cap: 40, anim: 'pop' });
    b.glow('glow', { cap: 80, anim: 'pop' });
    b.shadow('shadow', { cap: 220, anim: 'pop' });
    b.beam('shaft', merge(shaftParts({ len: 13, r0: 0.5, r1: 1.2, dir: SUN })), { cap: 90, anim: 'pop' });
    b.toon('butterfly', merge(butterflyParts()), { cap: 120, anim: 'pop', fly: [1.1, 16, 0.7, 0.9], ink: 0.02 });
    b.toon('giantBloom', merge(giantFlowerParts({ h: 4.2, kind: 'daisy', stem: '#2f7a4a' })), { cap: 60, anim: 'popEarly', wobble: [0.003, 0, 0.9, 0] });
    b.toon('giantTulip', merge(giantFlowerParts({ h: 3.4, kind: 'tulip', stem: '#2f7a4a' })), { cap: 60, anim: 'popEarly', wobble: [0.004, 0, 1.0, 0] });
    // the beds run wild: zinnias, ivy, baskets, shelves of pots, flytraps -
    // all of it growing up out of the beds (and the baskets letting down from
    // their hooks) as you come, so the far stretch, lost in the haze anyway,
    // isn't drawn at all (rise mode: see World.markHidden)
    const GROW = [2, 36, 72, 0];
    b.toon('zinniaBedA', zinniaBedGeo(3), { cap: 96, anim: GROW, marks: [2, 1.4], wobble: [0.006, 0, 1.5, 0] });
    b.toon('zinniaBedB', zinniaBedGeo(8), { cap: 96, anim: GROW, marks: [2, 1.4], wobble: [0.006, 0, 1.3, 0] });
    b.toon('ivyRib', ivyRibGeo(4), { cap: 140, anim: GROW, ink: 0.03, wobble: [0.004, 0, 1.1, 0] });
    b.toon('bracketBasket', bracketBasketGeo(6), { cap: 60, anim: GROW, wobble: [0.01, 0, 0.9, 0] });
    b.toon('basketHigh', merge(hungBasketParts(3.2, 12)), { cap: 70, anim: [2, 50, 92, 0], wobble: [0.004, 0, 0.7, 0] });
    b.toon('plantShelf', plantShelfGeo(2), { cap: 40, anim: GROW });
    b.toon('flytrapBed', merge(flytrapParts({ traps: 8, size: 1.55, seed: 17, flowers: 2, closed: 0.2, tint: 1 })), { cap: 40, anim: [2, 46, 90, 0], wobble: [0.004, 0, 1.2, 0] });
    // the jungle (see bananaGeo and on): it grows up as you come too, and
    // the moss lets down from the purlins
    b.toon('banana', bananaGeo(5, 2.9), { cap: 40, anim: [2, 44, 86, 0], wobble: [0.008, 0, 0.8, 0] });
    b.toon('bananaB', bananaGeo(11, 2.5), { cap: 40, anim: [2, 44, 86, 0], wobble: [0.009, 0, 0.9, 0] });
    b.toon('elephantEar', elephantEarGeo(4), { cap: 60, anim: GROW, wobble: [0.012, 0, 1.0, 0] });
    b.toon('elephantEarB', elephantEarGeo(9), { cap: 60, anim: GROW, wobble: [0.012, 0, 1.1, 0] });
    b.toon('calathea', calatheaGeo(3), { cap: 90, anim: GROW, wobble: [0.01, 0, 1.4, 0] });
    b.toon('frondFern', frondFernGeo(6), { cap: 90, anim: GROW, wobble: [0.014, 0, 1.2, 0] });
    b.toon('ficus', ficusGeo(8), { cap: 30, anim: [2, 46, 90, 0], marks: [2.4, 2], wobble: [0.004, 0, 0.7, 0] });
    b.toon('mossLong', mossGeo(3.6, 3), { cap: 220, anim: [2, 50, 96, 0], ink: 0.02, wobble: [0.035, 0, 0.6, 0] });
    b.toon('mossShort', mossGeo(2.2, 8), { cap: 220, anim: [2, 50, 96, 0], ink: 0.02, wobble: [0.04, 0, 0.7, 0] });

    b.toon('potRow', potRowGeo(), { cap: 24, anim: 'popEarly', marks: [2, 1.6] });
    b.toon('planterBox', planterBoxGeo(1.9), { cap: 24, anim: 'popEarly' });
    b.toon('planterLong', planterBoxGeo(7.6), { cap: 10, anim: 'popEarly' });
    b.toon('hangingBasket', hangingBasketGeo(0.98, 2), { cap: 24, anim: 'popEarly' });
    b.toon('vineCurtain', hangingBasketGeo(3.95, 6), { cap: 10, anim: 'popEarly' });
    b.toon('bigMonstera', bigMonsteraGeo(), { cap: 24, anim: 'popEarly', wobble: [0.006, 0, 1.2, 0] });
    b.toon('bigOrange', merge(orangeTreeParts({ potR: 0.72, canopy: 1.2, trunk: 1.3 })).translate(0, 0, -0.75), { cap: 24, anim: 'popEarly', marks: [2.2, 2] });
    b.toon('pottingBench', pottingBenchGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('flytrapTrough', flytrapTroughGeo(), { cap: 24, anim: 'popEarly', wobble: [0.01, 0, 1.6, 0] });
    b.toon('giantFlytrap', giantFlytrapGeo(), { cap: 24, anim: 'popEarly', wobble: [0.003, 0, 1.1, 0] });
    b.toon('bloom', bloomGeo(), { cap: 120, anim: 'popEarly' });

  },

  gateExtras: ['gateGlass'],

  // (every obstacle's leaves take a tint - one a little yellower, one bluer
  // - and the pots, planters and baskets come into flower, each its own way)
  // The door INTO this world, in its own style (built into the shared
  // doors, see world.js: it stands in the world before it).
  door(b) {
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.05, marks: [2.2, 2] });
    b.glass('gateGlass', gateGlassGeo(), { cap: 2 });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', depth: 0.28, deco: glazedLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [
      { name: 'potRow', len: 0.7, tints: LEAVES, extras: blooms([[-0.62, 0.92, 0.35], [0, 0.92, 0.35], [0.62, 0.92, 0.35]], 0) },
      { name: 'planterBox', len: 0.8, tints: LEAVES, extras: blooms([[-0.6, 0.84, 0.4], [0, 0.84, 0.4], [0.6, 0.84, 0.4]], 0) },
      { name: 'flytrapTrough', len: 0.8, tints: TRAPS },
    ],
    H: [{ name: 'hangingBasket', len: 0.4, extras: blooms([[-0.49, 1.86, 0.2], [0.49, 1.86, 0.2]], 0) }],
    W: [
      { name: 'bigMonstera', len: 1.5, tints: LEAVES },
      { name: 'bigOrange', len: 1.4 },
      { name: 'pottingBench', len: 1.0 },
      { name: 'giantFlytrap', len: 1.5, tints: TRAPS },
    ],
    LW: { name: 'planterLong', len: 0.8, tints: LEAVES },
    HW: { name: 'vineCurtain', len: 0.4 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0);
    ctx.put('lawn', 0, 0, 0);
    if (!ctx.continuation) {
      ctx.put('frameLong', 0, 0, 0);
      ctx.put('glass', 0, 0, 0);
      for (let i = 0; i < 4; i++) ctx.put('rib', 0, 0, i * 4 + 0.5);
      for (const s of [-1, 1]) {
        const turn = s > 0 ? 0 : Math.PI; // (the beds' fronts face the path)
        // planter beds, crowded: zinnias end to end over mounds of leaves,
        // spilling over the edge; ferns and monstera standing up out of
        // them, the odd potted cypress
        for (let i = 0; i < 4; i++) {
          if (rng.chance(0.12)) continue;
          const z = 2 + i * 4 + rng.float(-0.5, 0.5);
          ctx.put(rng.chance(0.5) ? 'zinniaBedA' : 'zinniaBedB', s * 5.3, 0.72, z, { ry: turn, c: [rng.float(0.88, 1.06), rng.float(0.95, 1.05), rng.float(0.88, 1.04)] });
        }
        for (let i = 0; i < 3; i++) {
          ctx.put('fern', s * rng.float(4.9, 5.9), 0.65, rng.float(0, 16), { s: rng.float(0.7, 1.15), ry: rng.float(0, 6.28), c: [rng.float(0.9, 1.1), 1, 1] });
        }
        if (rng.chance(0.85)) ctx.put('monstera', s * rng.float(5.4, 5.9), 0.7, rng.float(1, 15), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.15), c: [rng.float(0.9, 1.05), 1, rng.float(0.9, 1.05)] });
        if (rng.chance(0.5)) ctx.put('potCypress', s * 5.4, 0.72, rng.float(2, 14), { s: rng.float(0.85, 1.1) });
        // now and then a Venus flytrap that's been let go, grown huge
        if (rng.chance(0.28)) ctx.put('flytrapBed', s * rng.float(5.2, 5.6), 0.72, rng.float(2, 14), { ry: rng.float(0, 6.28), s: rng.float(0.85, 1.15), c: rng.pick(TRAPS) });
        // a shelf of pots against the glass
        if (rng.chance(0.45)) ctx.put('plantShelf', s * 6.6, 0, rng.float(2, 14), { ry: turn });
        // the ribs: ivy up some, a basket on a bracket off others
        for (let i = 0; i < 4; i++) {
          const z = i * 4 + 0.5;
          const r = rng.float(0, 1);
          if (r < 0.65) ctx.put('ivyRib', s * R, 0, z, { ry: turn, c: [rng.float(0.88, 1.06), 1, rng.float(0.9, 1.05)] });
          else if (r < 0.88) ctx.put('bracketBasket', s * (R - 0.12), 3.7, z, { ry: turn, c: rng.pick(ZINNIAS) });
        }
        // and baskets hung from the purlins on long chains, high over the beds
        for (let i = 0; i < 2; i++) {
          if (rng.chance(0.25)) continue;
          const x = rng.chance(0.5) ? 4.5 : 5.79;
          ctx.put('basketHigh', s * x, archY(x) - 0.08, rng.float(0, 16), { ry: rng.float(0, 6.28), c: rng.pick(ZINNIAS) });
        }
        if ((ctx.index + (s > 0 ? 2 : 0)) % 4 === 1) {
          ctx.put('orangeTree', s * 5.4, 0.72, 8, { s: 0.9 });
        }
        // the jungle: banana plants arching up into the roof, a dark ficus
        // against the glass, elephant ears and calatheas along the bed's
        // front and ferns spilling over its edge
        if (rng.chance(0.85)) ctx.put(rng.chance(0.5) ? 'banana' : 'bananaB', s * rng.float(5.5, 5.95), 0.72, rng.float(1, 15), { ry: turn + rng.float(-0.3, 0.3), s: rng.float(0.95, 1.25), c: [rng.float(0.88, 1.05), 1, rng.float(0.85, 1.0)] });
        if (rng.chance(0.5)) ctx.put('ficus', s * 6.0, 0.72, rng.float(2, 14), { ry: turn, s: rng.float(1.1, 1.4), c: [rng.float(0.9, 1.05), 1, 1] });
        for (let i = 0; i < 3; i++) {
          if (rng.chance(0.2)) continue;
          ctx.put(rng.chance(0.5) ? 'elephantEar' : 'elephantEarB', s * rng.float(4.95, 5.35), 0.72, rng.float(0, 16), { ry: turn + rng.float(-0.35, 0.35), s: rng.float(0.85, 1.2), c: [rng.float(0.85, 1.05), 1, rng.float(0.85, 1.05)] });
        }
        for (let i = 0; i < 2; i++) ctx.put('calathea', s * rng.float(4.75, 4.95), 0.72, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.9, 1.25) });
        for (let i = 0; i < 2; i++) ctx.put('frondFern', s * rng.float(4.7, 5.0), 0.72, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.85, 1.2), c: [rng.float(0.9, 1.08), 1, rng.float(0.9, 1.05)] });
        // Spanish moss in long curtains from the purlins: lowest at the
        // sides, over the beds and the shelves; high over the path
        for (const [x, y, n, long] of [[6.66, 6.16, 3, 0.7], [5.8, 7.9, 3, 0.6], [4.3, 9.5, 2, 0.5], [2.16, 10.66, 1, 0.3]]) {
          for (let i = 0; i < n; i++) {
            if (rng.chance(0.25)) continue;
            ctx.put(rng.chance(long) ? 'mossLong' : 'mossShort', s * x, y - 0.05, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.85, 1.25), c: [rng.float(0.9, 1.08), rng.float(0.95, 1.05), rng.float(0.9, 1.05)] });
          }
        }
        // soft sunbeams through the glass, slanting down over the beds (laid
        // so the whole shaft stays out over them, never across the path)
        if (rng.chance(0.75)) ctx.put('shaft', s * rng.float(5.6, 6.1), 5.4, rng.float(1, 15), { c: [rng.float(0.6, 1), 1, 1], s: rng.float(0.9, 1.15) });
        // later laps: butterflies, then giant blooms in the beds
        if (ctx.visit >= 1) {
          for (let i = 0; i < rng.int(1, 3); i++) {
            // over the beds, never across the lanes where they'd read as obstacles
            ctx.put('butterfly', s * rng.float(4.2, 6.4), rng.float(1.4, 5), rng.float(0, 16), { c: rng.pick(WINGS), s: rng.float(1.1, 1.8), ry: rng.float(0, 6.28), p0: rng.float(0, 6.28) });
          }
        }
        if (ctx.visit >= 2 && rng.chance(0.55)) {
          ctx.put(rng.chance(0.5) ? 'giantBloom' : 'giantTulip', s * rng.float(5.1, 5.7), 0.7, rng.float(1, 15), { c: rng.pick(WINGS), s: rng.float(0.8, 1.15), ry: s > 0 ? -0.5 : 0.5 });
        }
        // vines hang from the arches
        for (let i = 0; i < 4; i++) {
          const x = s * rng.float(2.5, 6.2);
          const long = rng.chance(0.4);
          ctx.put(long ? 'vineLong' : 'vineShort', x, archY(x) - 0.12, Math.floor(rng.float(0, 4)) * 4 + 0.5, { ry: rng.float(0, 6.28) });
        }
      }
    }
    // the garden outside the glass
    for (const s of [-1, 1]) {
      ctx.put('gardenTree', s * rng.float(10, 16), 0, rng.float(0, 16), { s: rng.float(0.8, 1.2), c: [rng.float(0.85, 1.05), 1, 1] });
      ctx.put('gardenTree', s * rng.float(18, 34), 0, rng.float(0, 16), { s: rng.float(1, 1.5), c: [0.8, 0.9, 0.9] });
      ctx.put('cypress', s * rng.float(28, 70), 0, rng.float(0, 16), { s: rng.float(1.2, 2), c: [0.7, 0.82, 0.82] });
      if ((ctx.index + (s > 0 ? 1 : 0)) % 3 === 0) {
        ctx.put('lantern', s * 8.6, 0, 6);
        ctx.put('glow', s * 8.6, 2.8, 6, { s: 2.2, c: [1, 0.78, 0.42] });
      }
    }
  },
};
