import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, gateFrameParts, gateLeafParts, gateTop } from './shapes.js';
import { shaftParts } from './whimsy.js';
import { crystal, stone, crystalPoint, rough } from './gems.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';

// II · The Deepwood — an old forest of colossal trunks under a canopy so thick
// that only shafts of light get through. The path is a trodden line through
// long grass; creeks cut across it (jump them), fallen trees lie over it on
// rocks and stumps (slide under), and giant mossy boulders, one of them
// roped like a shrine, sit in the lanes (go around). Deep shade: cool,
// dark shadows, warm pools of light where the shafts land, fog that swallows
// the far trunks, fireflies. Returns bring a firefly night with little white
// forest spirits watching from the roots, then a dusk of giant glowing
// toadstools, then a dreaming wood of rainbow bark and drifting jellyfish.

const C = {
  bark: '#33261d',
  barkHi: '#6a523c',
  moss: '#3c6522',
  mossHi: '#8cba3c',
  leafLo: '#0a1a12',
  leafHi: '#2a5626',
  grassLo: '#1c4520',
  grassHi: '#a6d24e',
  fern: '#245a24',
  fernHi: '#7cb63e',
  rockLo: '#3f443e',
  rockHi: '#8e977e',
  water: '#123a3a',
  mud: '#2a2418',
  wood: '#c9a46c',
  woodRing: '#8a6a3e',
  floor: '#183a1a',
  stem: '#efe7d2',
  straw: '#d6c287',
  paper: '#fbf6e8',
  lantern: '#ffd88a',
};
const SHROOMS = ['#9affe0', '#ffe08a', '#b8a8ff', '#8ae0ff'];
const TOADSTOOLS = ['#ff5a8a', '#b86aff', '#ff8a3a', '#4ad0c0', '#ffd24a'];
const JELLIES = ['#ff9ad8', '#9adfff', '#c8a8ff', '#a8ffd0'];
const RAINBOW = [[3.0, 1.1, 2.4], [3.0, 2.3, 0.9], [1.3, 2.8, 1.5], [1.0, 2.4, 3.2], [2.2, 1.2, 3.4]];

// The Amethyst: raw violet crystal points growing out of a lump of dark
// stone, as if prised from a geode under the roots — the one thing in the
// Deepwood that is purple, glowing like a spirit-lamp in the shade. A lone
// double-terminated point mixed into the runs; a great geode cluster for the
// prize spots. They drift slowly, like the fireflies.
function amethystCluster(points, rock, seed, lift) {
  const parts = [stone(rough({ r: rock, seed }), null, { sy: 0.62, y: -lift, grad: ['#211b2a', '#584866', -lift - rock * 0.5, -lift + rock * 0.6] })];
  points.forEach(([len, r, rx, rz, x, z], i) => {
    parts.push(crystal(crystalPoint({ r, len, tip: r * 1.5, seed: seed + i }), { rx, rz, x, y: rock * 0.2 - lift, z }));
  });
  return parts;
}
const GEM = {
  name: 'amethyst',
  tints: ['#a24dff', '#bd5cff', '#8a4dff'],
  cuts: () => [
    amethystCluster([[0.3, 0.085, 0.08, -0.05, 0, 0], [0.2, 0.065, -0.15, 0.55, -0.07, 0.02], [0.22, 0.07, 0.2, -0.5, 0.07, -0.02], [0.15, 0.055, -0.6, 0.12, 0, -0.06]], 0.15, 3, 0.2),
    [crystal(crystalPoint({ r: 0.09, len: 0.34, tip: 0.14, double: true, seed: 9 }), { rz: 0.3, rx: 0.1 })],
    amethystCluster([[0.38, 0.1, 0.05, 0.04, 0, 0], [0.27, 0.08, -0.2, 0.6, -0.1, 0.03], [0.29, 0.085, 0.15, -0.55, 0.1, 0], [0.2, 0.065, -0.65, -0.2, 0.03, -0.08], [0.18, 0.06, 0.6, 0.3, -0.04, 0.09]], 0.2, 17, 0.24),
  ],
  motion: [0.9, 1.6, 0.09, 0.16],
  look: [0.82, 1, 0.35, 0.4],
  glow: 0.5,
  pool: 0.55,
};

const OPENING = { halfW: 4.4, rectH: 6.6, arch: true };
const GATE_DEPTH = 2.4;
const SUN = [0.28, 0.9, 0.3]; // object light: high overhead through the canopy
const SHAFT = [-0.22, 1, -0.3]; // the shafts lean away down the path
const SHAFT_LEN = 24;

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// --- plants -------------------------------------------------------------------
// A clump of grass blades: thin open cones, flattened to face the camera.
function grassParts({ n = 14, h = [0.9, 1.6], spread = 0.4, w = 0.05, seed = 1, lo = C.grassLo, hi = C.grassHi } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const bh = h[0] + rnd() * (h[1] - h[0]);
    const a = rnd() * 6.283;
    const rr = Math.sqrt(rnd()) * spread;
    const g = P.cyl(0, w * (0.7 + rnd() * 0.6), bh, 3, 1, true);
    g.translate(0, bh / 2, 0);
    parts.push(part(g, null, {
      x: Math.cos(a) * rr, z: Math.sin(a) * rr, sz: 0.35,
      ry: (rnd() - 0.5) * 1.2, rx: (rnd() - 0.5) * 0.5, rz: (rnd() - 0.5) * 0.8,
      grad: [lo, hi, 0, h[1]], outline: 0,
    }));
  }
  return parts;
}

// A fern: long narrow fronds arching out of a crown.
function fernParts({ n = 8, len = 1.0, seed = 2 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rnd() * 0.4;
    const L = len * (0.75 + rnd() * 0.5);
    parts.push(part(P.sphere(0.5, 6, 3), null, {
      x: Math.cos(a) * L * 0.42, y: 0.1 + L * 0.22, z: Math.sin(a) * L * 0.42,
      sx: 0.17, sy: 0.035, sz: L, ry: Math.PI / 2 - a, rx: -(0.35 + rnd() * 0.35),
      grad: [C.fern, C.fernHi, 0, L * 0.55], outline: 0.6,
    }));
  }
  return parts;
}

function flowerPatchParts({ seed = 4 } = {}) {
  const rnd = seeded(seed);
  const parts = [part(P.sphere(1, 8, 4), null, { y: 0.02, sx: 0.8, sy: 0.2, sz: 0.6, grad: [C.grassLo, C.fern, 0, 0.2], mark: 0.6 })];
  const cols = ['#c8b0ff', '#b49cf0', '#ffffff', '#e0d0ff'];
  for (let i = 0; i < 16; i++) {
    const a = rnd() * 6.283;
    const r = Math.sqrt(rnd());
    const x = Math.cos(a) * r * 0.75;
    const z = Math.sin(a) * r * 0.55;
    const h = 0.14 + rnd() * 0.2;
    parts.push(part(P.ico(0.05 + rnd() * 0.025, 0), cols[i % cols.length], { x, y: h, z, sy: 1.3, outline: 0.5 }));
  }
  return parts;
}

// A little cluster of mushrooms; the caps take the instance tint and glow.
function mushroomParts({ n = 4, seed = 5, glow = 1 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const h = 0.12 + rnd() * 0.24;
    const r = 0.06 + rnd() * 0.08;
    const x = (rnd() - 0.5) * 0.55;
    const z = (rnd() - 0.5) * 0.4;
    parts.push(part(P.cyl(r * 0.3, r * 0.42, h, 6), C.stem, { x, y: h / 2, z, outline: 0.5 }));
    parts.push(part(new THREE.SphereGeometry(r, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', { x, y: h - 0.01, z, sy: 0.7, emit: glow, tint: 1, outline: 0.6 }));
  }
  return parts;
}

// --- trees --------------------------------------------------------------------
// A colossal trunk rising out of view: a flared, mossy foot on buttress roots.
function trunkParts({ r = 1, h = 30, seg = 10, roots = 5, seed = 1, mark = 0.55 } = {}) {
  const rnd = seeded(seed);
  const prof = [[1.5, 0], [1.2, 0.55], [1.06, 1.4], [1.0, 2.6], [0.97, 6], [0.9, 14], [0.82, 22], [0.76, h]];
  const lower = prof.filter(([, y]) => y <= 2.6).map(([a, y]) => [a * r, y]);
  const upper = prof.filter(([, y]) => y >= 2.6).map(([a, y]) => [a * r, y]);
  const parts = [
    part(P.lathe(lower, seg), null, { grad: [C.moss, C.bark, 0.2, 2.8], mark, tint: 1, uvScale: [3, 2] }),
    part(P.lathe(upper, seg), null, { grad: [C.bark, C.barkHi, 2.6, h * 0.55], mark, tint: 1, uvScale: [3, 12] }),
  ];
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * 6.283 + rnd() * 0.6;
    const len = r * (1.0 + rnd() * 0.6);
    parts.push(part(P.sphere(1, 6, 4), null, {
      x: Math.cos(a) * r * 1.05, y: 0.25 * r, z: Math.sin(a) * r * 1.05,
      sx: 0.34 * r, sy: 0.8 * r, sz: len, ry: Math.PI / 2 - a, rx: 0.42,
      grad: [C.moss, C.bark, -0.2, 1.6 * r], mark, tint: 1,
    }));
  }
  // a broken-off branch or two
  for (let i = 0; i < 2; i++) {
    const a = rnd() * 6.283;
    const y = 6 + rnd() * 7;
    parts.push(part(P.cyl(0.08 * r, 0.2 * r, 1.6 * r, 6), C.bark, { x: Math.cos(a) * r * 1.05, y, z: Math.sin(a) * r * 1.05, ry: Math.PI / 2 - a, rx: 1.0, tint: 1 }));
  }
  return parts;
}

// Dark leafy masses closing overhead.
function canopyGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const r = 1.8 + rnd() * 1.4;
    const x = (rnd() - 0.5) * 7;
    const y = (rnd() - 0.5) * 1.4;
    const z = (rnd() - 0.5) * 6;
    parts.push(part(P.sphere(r, 8, 5), null, { x, y, z, sy: 0.62, grad: [C.leafLo, C.leafHi, y - r * 0.6, y + r * 0.62], mark: 0.85 }));
  }
  return merge(parts);
}

// --- rocks --------------------------------------------------------------------
// A rounded boulder: a lumpy icosphere whose normals are mostly smooth with a
// hint of the facets, so it reads as weathered stone rather than a gem.
function boulderGeo(r, seed, detail = 1) {
  const g = P.ico(r, detail);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i) / r;
    const uy = pos.getY(i) / r;
    const uz = pos.getZ(i) / r;
    let f = 1 + 0.13 * Math.sin(ux * 3.1 + seed) * Math.sin(uy * 2.3 + seed * 1.7) + 0.08 * Math.sin(uz * 4.7 + seed * 2.3);
    if (uy < -0.25) f *= 1 + (uy + 0.25) * 0.5; // a flatter underside to sit on
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize().multiplyScalar(0.7);
    v.x += n.getX(i) * 0.3;
    v.y += n.getY(i) * 0.3;
    v.z += n.getZ(i) * 0.3;
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

// A boulder sitting on the ground (bottom near y = 0), mossy on top.
function rockPart({ r, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seed = 1, detail = 1, moss = true, ry = 0 }) {
  const cy = y + r * sy * 0.78;
  return part(boulderGeo(r, seed, detail), null, {
    x, y: cy, z, sx, sy, sz, ry,
    grad: moss ? [C.rockLo, C.mossHi, cy - r * sy * 0.2, cy + r * sy * 1.05] : [C.rockLo, C.rockHi, cy - r * sy, cy + r * sy],
    mark: moss ? 0.55 : 0.2,
  });
}

// --- water ----------------------------------------------------------------------
// A band of water across x from x0 to x1, from z = 0 back to z = -w, with
// wobbling banks. uv is in meters with u running downstream (the shader's
// ripples drift along it).
function creekShapeGeo(x0, x1, w, seed, wobble = 0.12, inset = 0) {
  const rnd = seeded(seed);
  const n = Math.max(6, Math.round((x1 - x0) / 0.45));
  const s = new THREE.Shape();
  const near = [];
  const far = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const k = Math.sin(i * 0.9 + seed) * 0.5 + 0.5;
    near.push([x, inset + 0.06 + k * wobble + rnd() * 0.04]);
    far.push([x, w - inset - 0.06 - (1 - k) * wobble - rnd() * 0.04]);
  }
  s.moveTo(near[0][0], near[0][1]);
  for (const [x, y] of near.slice(1)) s.lineTo(x, y);
  for (const [x, y] of far.reverse()) s.lineTo(x, y);
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

function pondShapeGeo(rx, rz, seed, grow = 0) {
  const rnd = seeded(seed);
  const s = new THREE.Shape();
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.12 * Math.sin(a * 3 + seed) + 0.06 * (rnd() - 0.5);
    const x = Math.cos(a) * (rx * k + grow);
    const y = Math.sin(a) * (rz * k + grow);
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

// A water surface ready for a batch (tinted per instance, no ink).
function waterGeo(shape, y = 0) {
  return merge([part(shape, C.water, { y, tint: 1, outline: 0 })]);
}

// Stones strung along a bank from x0 to x1 at depth z.
function bankStones(parts, rnd, x0, x1, z, { big = 0.26, step = 0.42, seed = 0 } = {}) {
  for (let x = x0; x < x1; x += step * (0.75 + rnd() * 0.5)) {
    const r = big * (0.45 + rnd() * 0.6);
    parts.push(rockPart({ r, x, y: -r * 0.3, z: z + (rnd() - 0.5) * 0.14, sx: 1.2, sy: 0.75, seed: seed + x * 7.3, detail: 0, moss: rnd() < 0.5, ry: rnd() * 6 }));
  }
}

// --- obstacles ------------------------------------------------------------------
// L · A little creek across one lane, banked with stones (jump it). The water
// itself is its own batch (creekWater), drawn with the water material.
const CREEK_W = 2.1;
function creekStonesGeo(half, seed) {
  const rnd = seeded(seed);
  const parts = [];
  // wet earth framing the water
  parts.push(part(creekShapeGeo(-half - 0.1, half + 0.1, CREEK_W, seed, 0.1, -0.12), C.mud, { y: 0.012, outline: 0 }));
  bankStones(parts, rnd, -half + 0.05, half, -0.06, { seed });
  bankStones(parts, rnd, -half + 0.05, half, -CREEK_W + 0.06, { seed: seed + 3 });
  // the stream runs in under a big stone at either end
  for (const s of [-1, 1]) {
    parts.push(rockPart({ r: 0.42, x: s * (half + 0.12), y: -0.1, z: -CREEK_W / 2 + s * 0.1, sx: 1.1, sy: 0.9, sz: 1.3, seed: seed + s * 11 }));
    for (let i = 0; i < 3; i++) {
      const h = 0.45 + rnd() * 0.3;
      const rx = s * (half + 0.2 + rnd() * 0.35);
      const rz = -0.25 - rnd() * (CREEK_W - 0.5);
      parts.push(part(P.cyl(0.012, 0.016, h, 3), C.fern, { x: rx, y: h / 2, z: rz, rz: (rnd() - 0.5) * 0.3, outline: 0 }));
      parts.push(part(P.capsule(0.035, 0.12, 2, 5), '#5a3a22', { x: rx, y: h - 0.05, z: rz, outline: 0.5 }));
    }
  }
  return merge(parts);
}

function creekWideStonesGeo(seed) {
  const rnd = seeded(seed);
  const half = 14;
  const parts = [part(creekShapeGeo(-half, half, CREEK_W, seed, 0.14, -0.14), C.mud, { y: 0.012, outline: 0 })];
  bankStones(parts, rnd, -half + 0.2, half, -0.06, { seed, step: 0.5 });
  bankStones(parts, rnd, -half + 0.2, half, -CREEK_W + 0.06, { seed: seed + 5, step: 0.5 });
  // bigger rocks where the stream leaves the path, reeds and ferns beyond
  for (const s of [-1, 1]) {
    parts.push(rockPart({ r: 0.55, x: s * 4.9, y: -0.15, z: -0.15, sx: 1.2, sy: 0.85, seed: seed + s * 3 }));
    parts.push(rockPart({ r: 0.45, x: s * 5.7, y: -0.12, z: -CREEK_W + 0.1, sx: 1.1, sy: 0.85, seed: seed + s * 5 }));
    for (let i = 0; i < 9; i++) {
      const h = 0.6 + rnd() * 0.5;
      const rx = s * (5 + rnd() * 8);
      const rz = rnd() < 0.5 ? 0.1 + rnd() * 0.3 : -CREEK_W - 0.1 - rnd() * 0.3;
      parts.push(part(P.cyl(0.012, 0.016, h, 3), C.fern, { x: rx, y: h / 2, z: rz, rz: (rnd() - 0.5) * 0.3, outline: 0 }));
      parts.push(part(P.capsule(0.035, 0.12, 2, 5), '#5a3a22', { x: rx, y: h - 0.05, z: rz, outline: 0.5 }));
    }
    for (let i = 0; i < 3; i++) parts.push(...fernParts({ n: 7, len: 0.8, seed: seed + i * 13 + (s > 0 ? 50 : 0) }).map((g) => g.translate(s * (6.5 + i * 2.6), 0, i % 2 ? 0.4 : -CREEK_W - 0.4)));
  }
  return merge(parts);
}

// Moss hanging off the underside of a log, the longest strands ending on the
// duck line so the clear space below always reads the same.
function hangingMoss(parts, rnd, x0, x1, top, step = 0.32, zr = 0.18) {
  const D = CONFIG.duckLine;
  let i = 0;
  for (let x = x0; x <= x1; x += step * (0.7 + rnd() * 0.6), i++) {
    const tip = D + 0.02 + (i % 3 === 1 ? 0.1 + rnd() * 0.08 : 0);
    const g = P.cyl(0.04, 0.004, top - tip, 4, 1, true);
    parts.push(part(g, null, { x, y: (top + tip) / 2, z: (rnd() - 0.5) * 2 * zr, grad: ['#6f8f46', '#3f5f2a', tip, top], outline: 0 }));
  }
}

// H · A fallen log over one lane, resting on a mossy boulder and a stump.
function fallenLogGeo() {
  const D = CONFIG.duckLine;
  const rnd = seeded(31);
  const r = 0.38;
  const under = D + 0.24;
  const cy = under + r;
  const half = 1.45;
  const parts = [
    part(P.cyl(r, r * 1.06, half * 2, 12), null, { y: cy, rz: Math.PI / 2, grad: ['#2a1f17', C.barkHi, under, cy + r], mark: 0.55, uvScale: [2, 3] }),
    part(P.sphere(1, 12, 6), null, { y: cy + r * 0.74, sx: half * 0.82, sy: 0.15, sz: r * 0.72, grad: [C.moss, C.mossHi, cy + r * 0.5, cy + r * 0.95], mark: 0.7 }),
  ];
  // sawn ends showing pale wood and a ring
  for (const s of [-1, 1]) {
    const rr = s < 0 ? r : r * 1.06;
    parts.push(part(P.cyl(rr * 0.86, rr * 0.86, 0.05, 14), C.wood, { x: s * (half + 0.005), y: cy, rz: Math.PI / 2, outline: 0.4 }));
    parts.push(part(P.torus(rr * 0.5, 0.022, 3, 14), C.woodRing, { x: s * (half + 0.035), y: cy, ry: Math.PI / 2, outline: 0 }));
  }
  // bracket fungus on the side
  for (let i = 0; i < 3; i++) {
    parts.push(part(new THREE.SphereGeometry(0.12, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#e8c890', { x: -0.6 + i * 0.22, y: cy - 0.05 + i * 0.07, z: r * 0.92, sz: 0.6, outline: 0.5 }));
  }
  hangingMoss(parts, rnd, -half + 0.2, half - 0.2, under + 0.1);
  parts.push(rockPart({ r: 0.55, x: -1.02, y: -0.1, sx: 0.85, sy: (under + 0.12) / (0.55 * 1.78), sz: 0.9, seed: 7 }));
  parts.push(part(P.cyl(0.3, 0.38, under + 0.02, 9), null, { x: 1.04, y: (under + 0.02) / 2, grad: ['#2a1f17', C.barkHi, 0, under], mark: 0.5 }));
  parts.push(part(P.cyl(0.3, 0.3, 0.04, 9), C.moss, { x: 1.04, y: under + 0.03, outline: 0.4 }));
  return merge(parts).translate(0, 0, -r);
}

// H · A huge fallen tree right across the path: root plate on one side, the
// broken crown off on the other, propped on boulders beyond the path edges.
function fallenTreeGeo() {
  const D = CONFIG.duckLine;
  const rnd = seeded(47);
  const under = D + 0.28;
  const x0 = -9.5;
  const x1 = 13;
  const r0 = 0.92;
  const r1 = 0.62;
  const rAt = (x) => r0 + ((r1 - r0) * (x - x0)) / (x1 - x0);
  const cy = under + rAt(-4.4);
  const parts = [
    part(P.cyl(r0, r1, x1 - x0, 14), null, { x: (x0 + x1) / 2, y: cy, rz: Math.PI / 2, grad: ['#2a1f17', C.barkHi, cy - r0, cy + r0], mark: 0.55, uvScale: [3, 10] }),
    part(P.sphere(1, 16, 6), null, { x: -0.5, y: cy + 0.7, sx: 8.5, sy: 0.2, sz: 0.62, grad: [C.moss, C.mossHi, cy + 0.45, cy + 0.9], mark: 0.7 }),
  ];
  // the root plate, torn up with the earth still on it
  parts.push(part(P.cyl(2.3, 2.1, 0.8, 14), null, { x: x0 - 0.3, y: cy, rz: Math.PI / 2, grad: ['#1f1812', '#4a3626', cy - 2.3, cy + 2.3], mark: 0.6 }));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * 6.283 + rnd() * 0.3;
    const len = 0.8 + rnd() * 1.1;
    const g = P.cyl(0.02, 0.12, len, 4);
    g.translate(0, len / 2, 0);
    parts.push(part(g, '#3a2a1c', { x: x0 - 0.5, y: cy + Math.sin(a) * 2.0, z: Math.cos(a) * 2.0, rx: -a + Math.PI / 2, outline: 0.6 }));
  }
  // the broken crown: bare limbs and a last few leafy clumps
  for (let i = 0; i < 4; i++) {
    const a = -0.9 + i * 0.6;
    const len = 2.5 + rnd() * 1.8;
    const g = P.cyl(0.1, 0.24, len, 6);
    g.translate(0, len / 2, 0);
    const bz = (rnd() - 0.5) * 1.2;
    parts.push(part(g, C.bark, { x: x1 - 0.2, y: cy, z: bz, rz: -Math.PI / 2 + a }));
    parts.push(part(P.sphere(1.0 + rnd() * 0.5, 9, 6), null, { x: x1 + Math.cos(a) * len, y: cy + Math.sin(a) * len, z: bz, sy: 0.7, grad: [C.leafLo, C.leafHi, cy - 1, cy + 2], mark: 0.85 }));
  }
  hangingMoss(parts, rnd, -4.3, 4.3, under + 0.12, 0.34, 0.3);
  // propped on boulders just past either edge of the path
  parts.push(rockPart({ r: 1.15, x: -5.75, y: -0.25, sx: 1.0, sy: (under + 0.35) / (1.15 * 1.78), sz: 1.0, seed: 19 }));
  parts.push(rockPart({ r: 1.0, x: 5.6, y: -0.2, sx: 1.05, sy: (under + rAt(4.4) - r1 + 0.3) / (1.0 * 1.78), sz: 0.95, seed: 23 }));
  return merge(parts).translate(0, 0, -rAt(-4.4));
}

// W · Giant mossy boulders.
function boulderObstacleGeo() {
  const rnd = seeded(61);
  const parts = [rockPart({ r: 1.18, y: -0.25, sx: 1.05, sy: 1.12, sz: 0.88, seed: 3 })];
  parts.push(rockPart({ r: 0.32, x: 1.05, y: -0.05, z: 0.55, seed: 4, detail: 0 }));
  parts.push(rockPart({ r: 0.24, x: -1.0, y: -0.05, z: 0.7, seed: 5, detail: 0, moss: false }));
  parts.push(...fernParts({ n: 7, len: 0.75, seed: 9 }).map((g) => g.translate(-0.85, 0, 0.55)));
  parts.push(...grassParts({ n: 9, h: [0.3, 0.6], spread: 0.3, seed: 12 }).map((g) => g.translate(0.7, 0, 0.75 + rnd() * 0.1)));
  return merge(parts).translate(0, 0, -1.0);
}

// W · A great stone on a smaller one, bound with a twisted straw rope hung with
// zigzag paper streamers, like a shrine rock deep in the woods.
function shrineRockGeo() {
  const parts = [
    rockPart({ r: 1.12, y: -0.2, sx: 1.02, sy: 0.92, sz: 0.9, seed: 13 }),
    rockPart({ r: 0.78, y: 1.45, sx: 1.05, sy: 0.95, sz: 0.85, seed: 17 }),
  ];
  // the base rock is widest a little above its centre (y ~ 0.6): bind it there
  const ropeY = 0.78;
  const R = 1.1;
  for (let k = 0; k < 2; k++) {
    parts.push(part(P.torus(1, 0.075, 5, 30), k ? '#a8925a' : C.straw, { y: ropeY + k * 0.07, rx: Math.PI / 2, rz: k * 0.2, sx: R + k * 0.01, sy: R * 0.88 + k * 0.01, outline: k ? 0 : 0.7 }));
  }
  // shide: paper streamers folded in a zigzag, hanging from the front of the rope
  for (const sx of [-0.7, 0, 0.7]) {
    const z = Math.sqrt(Math.max(0, 1 - (sx / R) ** 2)) * R * 0.88 + 0.05;
    for (let k = 0; k < 4; k++) {
      parts.push(part(P.box(0.17, 0.15, 0.02), C.paper, { x: sx + (k % 2 ? 0.06 : -0.06), y: ropeY - 0.14 - k * 0.14, z: z - k * 0.02, ry: -Math.atan2(sx, z) * 0.9, emit: 0.2, outline: 0.5 }));
    }
  }
  return merge(parts).translate(0, 0, -1.0);
}

// --- later laps -----------------------------------------------------------------
// A small white forest spirit with a round head (which rattles via wobble).
function spiritParts() {
  const W = '#f2f5ea';
  return [
    part(P.lathe([[0, 0], [0.085, 0.02], [0.1, 0.12], [0.072, 0.24], [0.045, 0.3], [0, 0.31]], 8), W, { emit: 0.25 }),
    part(P.sphere(0.135, 12, 9), W, { y: 0.43, sx: 1.12, sy: 0.94, emit: 0.25 }),
    part(P.sphere(0.022, 6, 4), '#101010', { x: -0.048, y: 0.45, z: 0.118, outline: 0 }),
    part(P.sphere(0.022, 6, 4), '#101010', { x: 0.048, y: 0.45, z: 0.118, outline: 0 }),
    part(P.sphere(0.017, 6, 4), '#101010', { y: 0.39, z: 0.124, sx: 1.4, outline: 0 }),
    part(P.capsule(0.022, 0.08, 2, 5), W, { x: -0.1, y: 0.18, rz: 0.55, emit: 0.25 }),
    part(P.capsule(0.022, 0.08, 2, 5), W, { x: 0.1, y: 0.18, rz: -0.55, emit: 0.25 }),
  ];
}

// A toadstool as tall as a house; the cap takes the instance tint and glows.
function giantToadstoolParts({ h = 7, capR = 3, seed = 3 } = {}) {
  const rnd = seeded(seed);
  const parts = [
    part(P.lathe([[0.8, 0], [0.58, 0.45], [0.44, 1.8], [0.37, h * 0.6], [0.42, h - 0.5], [0.55, h - 0.1]], 12), null, { grad: ['#c8bca0', C.stem, 0, h], mark: 0.3 }),
    part(P.torus(0.45, 0.07, 4, 14), C.stem, { y: h * 0.68, rx: Math.PI / 2, outline: 0.6 }),
    part(new THREE.SphereGeometry(capR, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', { y: h - 0.25, sy: 0.5, tint: 1, emit: 0.3, mark: 0.2 }),
    part(P.cyl(capR * 0.98, capR * 0.25, 0.35, 18), '#4a3048', { y: h - 0.42, outline: 0.5 }),
  ];
  for (let i = 0; i < 12; i++) {
    const a = rnd() * 6.283;
    const e = 0.3 + rnd() * 1.0;
    const rr = capR * 1.01;
    parts.push(part(P.sphere(0.16 + rnd() * 0.14, 8, 5), '#fffbe8', { x: Math.cos(a) * Math.cos(e) * rr, y: h - 0.25 + Math.sin(e) * rr * 0.5, z: Math.sin(a) * Math.cos(e) * rr, sy: 0.5, emit: 1, outline: 0.5 }));
  }
  return parts;
}

// A jellyfish drifting between the trees: a glowing bell and trailing threads.
function jellyParts() {
  const parts = [
    part(new THREE.SphereGeometry(0.8, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', { sy: 0.78, tint: 1, emit: 0.75 }),
    part(new THREE.SphereGeometry(0.5, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), [0.8, 0.8, 0.8], { y: -0.02, sy: 0.9, tint: 1, emit: 1, outline: 0 }),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = 1.4 + (i % 3) * 0.45;
    const g = P.cyl(0.035, 0.008, len, 3, 1, true);
    g.translate(0, -len / 2, 0);
    parts.push(part(g, '#ffffff', { x: Math.cos(a) * 0.62, z: Math.sin(a) * 0.62, tint: 1, emit: 0.6, outline: 0 }));
  }
  return parts;
}

// --- threshold --------------------------------------------------------------------
// Two ancient trees whose trunks lean together and fuse into an arch, hung with
// moss and paper lanterns, glowing mushrooms at their feet, and a thicket either
// side that hides the world beyond.
function gateGeo() {
  const top = gateTop(OPENING);
  const parts = [...gateFrameParts(OPENING, { thick: 1.5, depth: GATE_DEPTH, color: C.bark, mark: 0.45 })];
  for (const s of [-1, 1]) {
    parts.push(...trunkParts({ r: 2.2, h: 36, seg: 12, roots: 6, seed: s > 0 ? 7 : 9 }).map((g) => g.translate(s * (OPENING.halfW + 3.3), 0, -0.6)));
    parts.push(...mushroomParts({ n: 7, seed: s > 0 ? 3 : 8 }).map((g) => g.translate(s * (OPENING.halfW + 0.7), 0, GATE_DEPTH / 2 + 0.5)));
    const w = 64;
    const x = s * (OPENING.halfW + 1.4 + w / 2);
    parts.push(part(P.box(w, 9, 3), null, { x, y: 4.5, z: -1.4, grad: [C.leafLo, C.leafHi, 0, 10], mark: 0.85, uvScale: [w / 3.4, 9 / 3.4] }));
    for (let i = 0; i < 14; i++) {
      parts.push(part(P.sphere(2.2 + (i % 3) * 0.5, 10, 7), null, { x: s * (OPENING.halfW + 6.5 + i * 4.4), y: 9 + (i % 2) * 0.8, z: -1.4, sy: 0.75, grad: [C.leafLo, C.leafHi, 7, 11.5], mark: 0.85 }));
    }
    for (let i = 0; i < 3; i++) {
      parts.push(canopyGeo(70 + i + (s > 0 ? 9 : 0)).translate(s * (6 + i * 5), 22 + i * 2, -2));
    }
  }
  // moss over the arch
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.1 + 0.8 * (i / 8));
    const R = OPENING.halfW + 0.75;
    parts.push(part(P.sphere(0.75 + (i % 3) * 0.15, 9, 7), null, { x: Math.cos(a) * R, y: OPENING.rectH + Math.sin(a) * R, z: 0.75, sz: 0.55, grad: [C.moss, C.mossHi, OPENING.rectH, top + 1.5], mark: 0.85 }));
  }
  // paper lanterns hung from the arch on cords
  const lz = GATE_DEPTH / 2 + 0.35;
  for (const s of [-1, 1]) {
    const lx = s * 2.7;
    const archY = OPENING.rectH + Math.sqrt(OPENING.halfW ** 2 - lx * lx);
    const ly = 7.7;
    parts.push(part(P.cyl(0.015, 0.015, archY - ly + 0.3, 3), '#2a1d14', { x: lx, y: (archY + ly + 0.3) / 2, z: lz, outline: 0 }));
    parts.push(part(P.lathe([[0, -0.4], [0.2, -0.34], [0.29, -0.05], [0.24, 0.26], [0, 0.34]], 12), C.lantern, { x: lx, y: ly - 0.1, z: lz, emit: 1, outline: 0.6 }));
    parts.push(part(P.cyl(0.14, 0.17, 0.08, 10), '#2a1d14', { x: lx, y: ly + 0.25, z: lz }));
    parts.push(part(P.cyl(0.12, 0.12, 0.06, 10), '#2a1d14', { x: lx, y: ly - 0.52, z: lz }));
  }
  return merge(parts);
}

export default {
  id: 'forest',
  name: 'The Deepwood',
  doorColor: '#5a9a32',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    sky: ['#0a1d18', '#3a6446', '#0c2219'],
    bloom: ['#6ab83a', '#e2ff86', '#ffae4a'], // the colours its doorway bloom is made of
    sun: { dir: [0.2, 0.5, -1], glow: '#b8d888' },
    stars: 0,
    skyFx: { rays: 0.22, clouds: 0 },
    // deep shade under the canopy: cool, dark shadows, warm light where it lands
    light: { dir: SUN, shadow: [0.38, 0.48, 0.5], hi: [1.04, 1.0, 0.82], soft: 0.2, wrap: 0.3, hiAmt: 0.5, lift: 0.8 },
    rim: [0.95, 1.0, 0.7, 0.32],
    mist: { color: '#3d6c5a', amount: 0.5, top: 1.6, fade: 3, near: 14, far: 85 },
    dapple: [0.7, 0.06, 0.012],
    grade: { sat: 1.04, contrast: 1.06, vignette: 0.66, exposure: 0.92, tint: '#010c07' },
    beam: { color: '#fff0b0', amount: 0.3 },
    pool: '#8a7030',
    ink: '#0a1f14',
    fog: [30, 150],
    ground: ['#163a19', '#4c8a2e', '#3e2f1e'],
    shadowDecal: [0.5, 0.6, 0.55],
    cast: [-0.3, -0.3],
    glowGain: 0.9,
    particles: { color: '#e2ff86', size: 2.6, drift: [0, 0.12, 0], opacity: 1 },
  },

  visits: [
    {
      // firefly night: moonlight through the leaves, spirits on the roots
      env: {
        sky: ['#040a18', '#1a3656', '#050e18'],
        bloom: ['#5a8aff', '#c8ff7a', '#eef6ff'],
        sun: { dir: [-0.3, 0.5, -1], glow: '#9ac4ff' },
        moon: { dir: [-0.3, 0.5, -1], color: '#eef6ff', size: 0.05 },
        stars: 0.7,
        light: { shadow: [0.28, 0.34, 0.5], hi: [0.84, 0.94, 1.12] },
        rim: [0.6, 0.85, 1.0, 0.36],
        mist: { color: '#1f3e66', amount: 0.58 },
        grade: { tint: '#000818', vignette: 0.66, exposure: 0.96 },
        beam: { color: '#c4e0ff', amount: 0.15 },
        pool: '#2a4462',
        ground: ['#123428', '#376e56', '#2c2c28'],
        glowGain: 1.5,
        particles: { color: '#c8ff7a', size: 3.3, drift: [0.05, 0.2, 0], opacity: 1 },
      },
    },
    {
      // the toadstool dusk: violet haze, spores drifting up
      env: {
        sky: ['#1a0a2a', '#7a3a6a', '#1a0c1f'],
        bloom: ['#c060c0', '#ff8ac0', '#ffb0e8'],
        sun: { dir: [0.3, 0.2, -1], glow: '#ff8ac0' },
        moon: undefined,
        stars: 0.4,
        light: { shadow: [0.4, 0.32, 0.5], hi: [1.04, 0.94, 1.02] },
        rim: [1.0, 0.6, 0.9, 0.36],
        mist: { color: '#6a3a6a', amount: 0.55 },
        grade: { sat: 1.12, tint: '#1a0020', vignette: 0.62, exposure: 0.95 },
        beam: { color: '#ffc0e8', amount: 0.18 },
        pool: '#5a2a4a',
        ground: ['#1c3628', '#55804a', '#3a2634'],
        glowGain: 1.4,
        particles: { color: '#ffb0e8', size: 2.8, drift: [0.15, 0.3, 0], opacity: 0.95 },
        trip: [0, 0.12, 0.06],
      },
    },
    {
      // the dreaming wood: rainbow bark, jellyfish, aurora through the leaves
      env: {
        sky: ['#04121e', '#1a7a7a', '#06141a'],
        bloom: ['#2fe0c0', '#7affe0', '#ff9ae0'],
        sun: { dir: [0.0, 0.4, -1], glow: '#7affe0' },
        stars: 1,
        skyFx: { rays: 0.3, aurora: 0.45 },
        light: { shadow: [0.38, 0.5, 0.66], hi: [1.0, 1.15, 1.15] },
        rim: [0.4, 1.0, 0.9, 0.4],
        mist: { color: '#1a5a6a', amount: 0.55 },
        grade: { sat: 1.18, contrast: 1.06, exposure: 1.0, tint: '#00121a', vignette: 0.58 },
        beam: { color: '#9affe8', amount: 0.18 },
        pool: '#1a4a4a',
        ground: ['#123c34', '#3f9a78', '#2a2a3a'],
        glowGain: 1.7,
        particles: { color: '#ffffff', size: 3.0, drift: [0.1, 0.25, 0], opacity: 1 },
        trip: [0.08, 0.3, 0.18],
      },
    },
  ],

  build(b) {
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 6);
    b.toon('floor', groundStrip(420, 16, C.floor, 8, { y: -0.03, mark: 0.45 }), { ink: 0, cap: 40, marks: [0.3, 0.3] });
    b.toon('grassTall', merge(grassParts({ n: 16, h: [0.8, 1.7], spread: 0.5, seed: 3 })), { cap: 340, ink: 0, anim: 'pop', wobble: [0.05, 0, 1.5, 0] });
    b.toon('grassTuft', merge(grassParts({ n: 8, h: [0.2, 0.42], spread: 0.22, w: 0.035, seed: 8 })), { cap: 260, ink: 0, anim: 'popLate', wobble: [0.12, 0, 1.9, 0] });
    b.toon('fern', merge(fernParts({ n: 9, len: 1.1, seed: 5 })), { cap: 160, anim: 'pop', wobble: [0.04, 0, 1.3, 0], ink: 0 });
    b.toon('flowers', merge(flowerPatchParts({ seed: 6 })), { cap: 120, anim: 'pop', marks: [2, 2], wobble: [0.08, 0, 1.6, 0], ink: 0 });
    b.toon('trunk', merge(trunkParts({ r: 1, h: 32, seed: 2 })), { cap: 170, anim: 'pop', marks: [1, 1], ink: 0.06 });
    b.toon('trunkB', merge(trunkParts({ r: 1, h: 32, roots: 4, seed: 9 })), { cap: 120, anim: 'pop', marks: [1, 1], ink: 0.06 });
    b.toon('trunkFar', merge(trunkParts({ r: 1, h: 34, seg: 7, roots: 0, seed: 4, mark: 0.3 })), { cap: 200, anim: 'pop', marks: [1, 1], ink: 0 });
    b.toon('canopy', canopyGeo(11), { cap: 140, anim: 'popEarly', marks: [2.4, 2], wobble: [0, 0.15, 0.4, 0], ink: 0.05 });
    b.toon('canopyB', canopyGeo(23), { cap: 140, anim: 'popEarly', marks: [2.4, 2], wobble: [0, 0.15, 0.35, 0], ink: 0.05 });
    b.toon('mushrooms', merge(mushroomParts({ n: 5, seed: 2 })), { cap: 90, anim: 'pop', ink: 0.025 });
    b.glow('glow', { cap: 90, anim: 'pop' });
    b.toon('rock', merge([rockPart({ r: 0.7, sx: 1.2, sy: 0.8, seed: 41 })]), { cap: 60, anim: 'pop', marks: [1.6, 1.6] });
    b.toon('stump', merge([
      part(P.cyl(0.55, 0.7, 0.9, 10), null, { y: 0.45, grad: ['#2a1f17', C.barkHi, 0, 0.9], mark: 0.5 }),
      part(P.cyl(0.5, 0.5, 0.04, 12), C.wood, { y: 0.91, outline: 0.5 }),
      part(P.torus(0.3, 0.02, 3, 14), C.woodRing, { y: 0.935, rx: Math.PI / 2, outline: 0 }),
      ...mushroomParts({ n: 3, seed: 14, glow: 0 }).map((g) => g.translate(0.45, 0, 0.35)),
    ]), { cap: 40, anim: 'pop' });
    b.toon('log', merge([
      part(P.cyl(0.42, 0.46, 5.5, 12), null, { y: 0.4, rx: Math.PI / 2, grad: ['#2a1f17', C.barkHi, 0, 0.85], mark: 0.55, uvScale: [2, 4] }),
      part(P.sphere(1, 12, 6), null, { y: 0.74, sx: 0.32, sy: 0.12, sz: 2.2, grad: [C.moss, C.mossHi, 0.6, 0.9], mark: 0.7 }),
      ...fernParts({ n: 6, len: 0.7, seed: 21 }).map((g) => g.translate(0.5, 0, 1.4)),
    ]), { cap: 40, anim: 'pop' });
    b.toon('pond', waterGeo(pondShapeGeo(2.4, 1.6, 5)), { cap: 24, ink: 0, water: true, anim: 'pop' });
    {
      const rnd = seeded(77);
      const rim = [part(pondShapeGeo(2.4, 1.6, 5, 0.28), C.mud, { y: -0.012, outline: 0 })];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
        const k = 1 + 0.12 * Math.sin(a * 3 + 5);
        const r = 0.14 + rnd() * 0.22;
        rim.push(rockPart({ r, x: Math.cos(a) * (2.4 * k + 0.12), y: -r * 0.35, z: -Math.sin(a) * (1.6 * k + 0.12), sx: 1.2, sy: 0.7, seed: 90 + i, detail: 0, moss: rnd() < 0.6 }));
      }
      b.toon('pondRim', merge(rim), { cap: 24, anim: 'pop' });
    }
    b.shadow('shadow', { cap: 320, anim: 'pop' });
    b.beam('shaft', merge(shaftParts({ len: SHAFT_LEN, r0: 0.7, r1: 1.8, dir: SHAFT })), { cap: 40, anim: 'pop' });
    b.pool('sunspot', { cap: 40, anim: 'pop' });
    // later laps
    b.toon('spirit', merge(spiritParts()), { cap: 90, anim: 'pop', wobble: [0.55, 0, 2.4, 0], ink: 0.02 });
    b.toon('toadstool', merge(giantToadstoolParts({ h: 7, capR: 3 })), { cap: 50, anim: 'popEarly', wobble: [0.0015, 0, 0.8, 0], marks: [1.5, 1.5] });
    b.toon('jelly', merge(jellyParts()), { cap: 50, anim: 'lift', fly: [0, 0, 1.6, 0.22], wobble: [0.05, 0.4, 1.1, 0], ink: 0.02 });

    // obstacles
    b.toon('creekWater', waterGeo(creekShapeGeo(-1.12, 1.12, CREEK_W, 3), 0.035), { cap: 24, ink: 0, water: true, anim: 'popEarly' });
    b.toon('creekStones', creekStonesGeo(1.05, 3), { cap: 24, anim: 'popEarly', marks: [1.6, 1.6], ink: 0.03 });
    b.toon('creekWaterB', waterGeo(creekShapeGeo(-1.12, 1.12, CREEK_W, 8), 0.035), { cap: 24, ink: 0, water: true, anim: 'popEarly' });
    b.toon('creekStonesB', creekStonesGeo(1.05, 8), { cap: 24, anim: 'popEarly', marks: [1.6, 1.6], ink: 0.03 });
    b.toon('creekWideWater', waterGeo(creekShapeGeo(-14, 14, CREEK_W, 5, 0.14), 0.035), { cap: 10, ink: 0, water: true, anim: 'popEarly' });
    b.toon('creekWideStones', creekWideStonesGeo(5), { cap: 10, anim: 'popEarly', marks: [1.6, 1.6], ink: 0.03 });
    b.toon('fallenLog', fallenLogGeo(), { cap: 24, anim: 'popEarly', marks: [1.6, 1.6] });
    b.toon('fallenTree', fallenTreeGeo(), { cap: 10, anim: 'popEarly', marks: [1.6, 1.6] });
    b.toon('boulder', boulderObstacleGeo(), { cap: 24, anim: 'popEarly', marks: [1.4, 1.4] });
    b.toon('shrineRock', shrineRockGeo(), { cap: 24, anim: 'popEarly', marks: [1.4, 1.4] });

    // threshold
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, marks: [1, 1], ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [
      { name: 'creekStones', with: ['creekWater'], len: CREEK_W, top: 0.6, wade: true, flat: true },
      { name: 'creekStonesB', with: ['creekWaterB'], len: CREEK_W, top: 0.6, wade: true, flat: true },
    ],
    H: [{ name: 'fallenLog', len: 0.8 }],
    W: [{ name: 'boulder', len: 2.0 }, { name: 'shrineRock', len: 2.0 }],
    LW: { name: 'creekWideStones', with: ['creekWideWater'], len: CREEK_W, top: 0.6, wade: true, flat: true },
    HW: { name: 'fallenTree', len: 1.7 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    ctx.put('floor', 0, 0, 0);
    const v = ctx.visit;
    const barkTint = () => (v >= 3 && rng.chance(0.7) ? rng.pick(RAINBOW) : [rng.float(0.86, 1.08), rng.float(0.9, 1.04), rng.float(0.86, 1.0)]);
    // the canopy closing overhead, and far trunks fading into the dark
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        ctx.put(rng.chance(0.5) ? 'canopy' : 'canopyB', s * rng.float(3, 22), rng.float(13, 20), rng.float(0, 16), { s: rng.float(0.9, 1.5), ry: rng.float(0, 6.28), c: [rng.float(0.8, 1.1), 1, 1] });
      }
      for (let i = 0; i < 3; i++) {
        const sc = rng.float(1.1, 2.1);
        ctx.put('trunkFar', s * rng.float(23, 70), 0, rng.float(0, 16), { s: sc, sy: 1, ry: rng.float(0, 6.28), c: v >= 3 ? rng.pick(RAINBOW) : [0.85, 0.9, 0.9] });
      }
    }
    if (rng.chance(0.55)) ctx.put(rng.chance(0.5) ? 'canopy' : 'canopyB', rng.float(-5, 5), rng.float(16, 20), rng.float(0, 16), { s: rng.float(1, 1.4), ry: rng.float(0, 6.28) });
    if (ctx.continuation) {
      // behind the gate only the big trunks and the canopy show over the thicket
      for (const s of [-1, 1]) ctx.put('trunk', s * rng.float(10, 20), 0, rng.float(0, 16), { s: rng.float(1.1, 1.5), sy: 1, ry: rng.float(0, 6.28), c: barkTint() });
      return;
    }

    // a shaft of light through a gap in the leaves, pooling where it lands
    if (rng.chance(0.55)) {
      const x = rng.float(-6, 6);
      const dz = rng.float(2, 14);
      const y = 10.5;
      const sc = rng.float(0.8, 1.2);
      ctx.put('shaft', x, y, dz, { c: [rng.float(0.7, 1), 1, 1], s: sc });
      const n = Math.hypot(...SHAFT);
      const k = (y / (SHAFT[1] / n)) * 1;
      const gx = x - (SHAFT[0] / n) * k;
      const gz = dz + (SHAFT[2] / n) * k;
      if (gz > -2 && gz < 18) ctx.put('sunspot', gx, 0.05, gz, { sx: 3.6 * sc, sz: 4.4 * sc, c: [rng.float(0.7, 1), 1, 1] });
    }
    // grass growing up through the path
    for (let i = 0; i < 9; i++) {
      ctx.put('grassTuft', rng.float(-4.2, 4.2), 0, rng.float(0, 16), { s: rng.float(0.8, 1.3), ry: rng.float(-0.5, 0.5), c: [1, 1, 1] });
    }

    for (const s of [-1, 1]) {
      // long grass and ferns crowding the verge
      for (let i = 0; i < 9; i++) {
        ctx.put('grassTall', s * rng.float(4.45, 8.8), 0, rng.float(0, 16), { s: rng.float(0.8, 1.35), ry: rng.float(-0.6, 0.6), c: [1, 1, 1] });
      }
      for (let i = 0; i < 3; i++) {
        ctx.put('fern', s * rng.float(4.8, 9.5), 0, rng.float(0, 16), { s: rng.float(0.8, 1.3), ry: rng.float(0, 6.28) });
      }
      for (let i = 0; i < (v >= 1 ? 3 : 2); i++) {
        ctx.put('flowers', s * rng.float(4.6, 8.5), 0, rng.float(0, 16), { s: rng.float(0.8, 1.4), ry: rng.float(0, 6.28) });
      }
      // the great trunks: a near row lining the path, a second row behind
      let pond = false;
      if (rng.chance(0.22)) {
        pond = true;
        const px = s * rng.float(11.5, 15);
        const pz = rng.float(3, 13);
        const o = { ry: rng.float(-0.4, 0.4), s: rng.float(0.8, 1.2) };
        ctx.put('pond', px, 0.035, pz, o);
        ctx.put('pondRim', px, 0, pz, o);
      }
      {
        let dz = rng.float(0, 5);
        while (dz < 16) {
          const sc = rng.float(0.85, 1.4);
          const x = s * rng.float(6.4, 9.5) + s * (sc - 1) * 1.6;
          ctx.put(rng.chance(0.5) ? 'trunk' : 'trunkB', x, 0, dz, { s: sc, sy: 1, ry: rng.float(0, 6.28), c: barkTint() });
          ctx.put('shadow', x, 0.03, dz, { sx: 5.5 * sc, sz: 5.5 * sc });
          if (rng.chance(v >= 1 ? 0.8 : 0.5)) {
            const mx = x - s * (sc * 1.4 + 0.2);
            const mz = dz + rng.float(-1, 1);
            ctx.put('mushrooms', mx, 0, mz, { c: rng.pick(SHROOMS), ry: rng.float(0, 6.28), s: rng.float(0.9, 1.5) });
            ctx.put('glow', mx, 0.35, mz, { s: 1.3, c: [0.35, 0.75, 0.62] });
          }
          if (v >= 1 && rng.chance(0.55)) {
            // spirits watching from among the roots
            const n = rng.int(1, 3);
            for (let k = 0; k < n; k++) ctx.put('spirit', x - s * (sc * 1.5 + 0.3 + k * 0.35), 0, dz + rng.float(-1.5, 1.5), { s: rng.float(1.1, 1.6), ry: s * -0.5 + rng.float(-0.3, 0.3), p0: rng.float(0, 6.28) });
          }
          dz += rng.float(7, 11);
        }
      }
      for (let i = 0; i < 2; i++) {
        if (pond && i === 0) continue;
        const sc = rng.float(1.1, 1.8);
        ctx.put(rng.chance(0.5) ? 'trunk' : 'trunkB', s * rng.float(12.5, 22), 0, rng.float(0, 16), { s: sc, sy: 1, ry: rng.float(0, 6.28), c: barkTint() });
      }
      // rocks, stumps and fallen logs on the forest floor
      if (rng.chance(0.35)) ctx.put('rock', s * rng.float(5.4, 11), 0, rng.float(0, 16), { s: rng.float(0.6, 1.3), ry: rng.float(0, 6.28) });
      if (rng.chance(0.18)) ctx.put('stump', s * rng.float(5.6, 10), 0, rng.float(0, 16), { s: rng.float(0.8, 1.2), ry: rng.float(0, 6.28) });
      if (rng.chance(0.18)) ctx.put('log', s * rng.float(6.5, 12), 0, rng.float(2, 14), { ry: rng.float(-0.5, 0.5) + (rng.chance(0.5) ? Math.PI / 2 : 0) });
      // later laps: giant glowing toadstools, then jellyfish drifting through
      if (v >= 2 && rng.chance(0.45)) {
        ctx.put('toadstool', s * rng.float(8.5, 15), 0, rng.float(0, 16), { s: rng.float(0.7, 1.25), ry: rng.float(0, 6.28), c: rng.pick(TOADSTOOLS) });
      }
      if (v >= 3 && rng.chance(0.5)) {
        ctx.put('jelly', s * rng.float(5, 16), rng.float(4, 10), rng.float(0, 16), { s: rng.float(0.8, 1.4), c: rng.pick(JELLIES), p0: rng.float(0, 6.28) });
      }
    }
  },
};
