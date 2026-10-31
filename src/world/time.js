import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, cloudParts, gateFrameParts, gateLeafParts, gateTop } from './shapes.js';
import { crystal, metal, crystalPoint, nugget, octahedron, blade, FACE } from './gems.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';

// VIII · The Gallery of Hours — a gallery of clocks open to the sky: a walk
// of ivory stone inlaid with brass ticks between colonnades of ivory columns
// and arches, aged brass everywhere, oversized clock faces up on the arches
// with their hands turning, great gears half sunk behind the balustrades,
// pendulums swinging slowly in the bays, grandfather clocks standing between
// the columns — and beyond it all a pale, heavenly sky of cloud with more
// dials and gears adrift in it.
//
// All the turning and swinging is decoration, and kept off the walk: the
// obstacles stand still (their pendulum bobs only sway along the run, rising
// as they swing, never dipping below the duck line), so timing a jump or a
// slide is never in doubt.
//
// Obstacles: a fallen clock hand or a broken section of dial to jump (a
// fallen minute hand across the whole walk), a brass crossbar hung with
// pendulums to slide under (a long one across the walk), and grandfather
// clocks, great hourglasses and clock weights to go around.

const C = {
  ivory: '#efe5cf',
  ivoryHi: '#fbf5e6',
  ivoryLo: '#cdbd9a',
  stone: '#d9c9a6',
  brass: '#c8953c',
  brassHi: '#ecc56a',
  brassLo: '#8a5f22',
  dial: '#f8f2e2',
  ink: '#3a2a1c',
  wood: '#6e4326',
  woodHi: '#9a6438',
  glass: '#dfeaf2',
  sand: '#e8c98a',
  sky: '#dfe9f6',
};

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// --- gems -------------------------------------------------------------------------
// Pale stones for a pale world, kept cool against the warm ivory and brass:
// moonstone above all, its milky body lit by a blue sheen; white opal
// flecked with fire; clear quartz points; satin selenite blades; natural
// diamond octahedra; and pearls. The crown: a great diamond held in a brass
// ring like a watch glass.
const MOON = { mottle: 0.7, second: '#8fb8ff', opaque: 0.35, rough: 0.08, glints: 1.1 };
const GEM = {
  name: 'moonstone',
  color: '#cfe0ff',
  light: '#b8d4ff',
  stones: [
    {
      name: 'moonstone',
      weight: 3,
      tints: ['#d8e6ff', '#cddcff', '#e4ecff'],
      parts: () => [crystal(nugget({ r: [0.21, 0.16, 0.19], faces: 34, spread: 0.05, chips: 0, seed: 15 }))],
      texture: MOON,
    },
    {
      name: 'white opal',
      weight: 1.4,
      tints: ['#f2f4ff', '#eef6f6', '#f6f0ff'],
      parts: () => [crystal(nugget({ r: [0.2, 0.14, 0.18], faces: 26, spread: 0.07, chips: 1, seed: 22 }))],
      texture: { speckle: 0.5, second: '#5ae8c0', mottle: 0.6, opaque: 0.3, glints: 1.2, scale: 9 },
    },
    {
      name: 'clear quartz',
      weight: 1.4,
      tints: ['#eef8ff', '#e6f2ff', '#f4fbff'],
      parts: () => [crystal(crystalPoint({ r: 0.1, len: 0.38, tip: 0.15, double: true, seed: 8 }), { rz: 0.3, rx: 0.1 })],
      texture: { veins: 0.25, mottle: 0.2, rough: 0.1, glints: 1.4 },
    },
    {
      // satin spar: a striated blade with a silky sheen
      name: 'selenite',
      weight: 1,
      tints: ['#f4f2ff', '#eeeaf8', '#f8f6ff'],
      parts: () => [crystal(blade({ len: 0.46, w: 0.08, t: 0.03, seed: 4 }), { rz: 0.5 })],
      texture: { bands: 0.45, bandFreq: 70, wander: 0.4, second: '#c4c8e8', opaque: 0.4, glints: 1.3 },
    },
    {
      name: 'diamond',
      weight: 1,
      tints: ['#f4fbff', '#eaf4ff', '#fafcff'],
      parts: () => [crystal(octahedron({ r: 0.19, blunt: 0.9, seed: 3 }), { rx: 0.4, rz: 0.2 })],
      texture: { rough: 0.05, glints: 1.8 },
    },
    {
      // lustrous, so lit as polished (not faceted)
      name: 'pearl',
      weight: 0.8,
      tints: ['#f6f2ff', '#f4f0f4'],
      parts: () => [metal(P.sphere(0.15, 12, 9), '#f2eef6'), metal(P.sphere(0.1, 10, 7), '#ece6f2', { x: 0.17, y: -0.05, z: 0.04 })],
      texture: {},
    },
  ],
  crown: {
    name: 'diamond in a brass ring',
    tints: ['#f4fbff', '#eaf4ff'],
    parts: () => [
      crystal(octahedron({ r: 0.25, blunt: 0.88, seed: 6 }), { rx: 0.5 }),
      metal(P.torus(0.29, 0.035, 8, 28), C.brass, { rx: 0 }),
      metal(P.torus(0.29, 0.02, 6, 28), C.brassHi, { rx: FACE, ry: 0.4 }),
    ],
    texture: { rough: 0.05, glints: 1.8 },
  },
  motion: [0.7, 1.2, 0.08, 0.1],
  look: [0.8, 1.4, 0.5, 0.45],
  glow: 0.6,
  pool: 0.22,
};

// --- clockwork kit ------------------------------------------------------------------
// A gear lying in the x/y plane (facing +z), teeth round its rim, spokes.
function gearParts({ r = 1, teeth = 16, t = 0.2, color = C.brass, hi = C.brassHi, spokes = 5, hole = 0.18 } = {}) {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % 4;
    const rr = k === 1 || k === 2 ? r : r * 0.86;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const inner = new THREE.Path();
  inner.absarc(0, 0, r * 0.68, 0, Math.PI * 2, true);
  s.holes.push(inner);
  const parts = [part(P.extrude(s, t, 4), color)];
  parts.push(part(P.cyl(r * hole + 0.06, r * hole + 0.06, t * 1.6, 14), hi, { rx: Math.PI / 2 }));
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    parts.push(part(P.box(r * 0.62, r * 0.09, t * 0.8), color, { x: Math.cos(a) * r * 0.38, y: Math.sin(a) * r * 0.38, rz: a }));
  }
  return parts;
}

// A clock face facing +z, centred on the origin: dial, brass rim, hour marks
// (long at twelve, three, six and nine), a centre boss. Its hands are their
// own (turning) batches.
function dialParts({ r = 2, depth = 0.25, rim = C.brass, dial = C.dial, seg = 28 } = {}) {
  const parts = [
    part(P.cyl(r, r, depth, seg), dial, { rx: Math.PI / 2 }),
    part(P.torus(r, r * 0.07, 5, seg), rim, { z: depth / 2 }),
    part(P.torus(r * 0.84, r * 0.012, 3, seg), C.ink, { z: depth / 2 + 0.01, outline: 0 }),
    part(P.cyl(r * 0.07, r * 0.07, depth + 0.1, 14), rim, { rx: Math.PI / 2 }),
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const big = i % 3 === 0;
    const len = r * (big ? 0.2 : 0.11);
    parts.push(part(P.box(r * (big ? 0.05 : 0.03), len, 0.03), C.ink, { x: Math.sin(a) * (r * 0.9 - len / 2), y: Math.cos(a) * (r * 0.9 - len / 2), z: depth / 2 + 0.015, rz: -a, outline: 0 }));
  }
  return parts;
}

// A clock hand pointing up (+y) from the origin, facing +z: an ornate spade.
function handParts({ len = 1.6, w = 0.12, color = C.ink, z = 0.18 } = {}) {
  return [
    part(P.box(w, len * 0.78, 0.05), color, { y: len * 0.39, z, outline: 0.5 }),
    part(P.cone(w * 1.6, len * 0.24, 4), color, { y: len * 0.88, z, ry: Math.PI / 4, sz: 0.3, outline: 0.5 }),
    part(P.torus(w * 1.3, w * 0.35, 6, 14), color, { y: len * 0.55, z, outline: 0.5 }),
    part(P.box(w * 0.8, len * 0.22, 0.05), color, { y: -len * 0.1, z, outline: 0.5 }),
  ];
}

// --- the gallery ---------------------------------------------------------------------
// One bay of the colonnade (placed every 8 m, its arch reaching back to the
// next column): a column on a plinth with a brass capital, an arch, the
// cornice above it, and a balustrade between the columns.
const WALL_X = 6.4;
function bayGeo() {
  const parts = [];
  const H = 7.2;
  parts.push(part(P.box(1.3, 0.7, 1.3), C.ivoryLo, { y: 0.35 }));
  parts.push(part(P.cyl(0.42, 0.48, H - 1.2, 10), null, { y: 0.7 + (H - 1.2) / 2, grad: [C.ivoryLo, C.ivoryHi, 0.5, H] }));
  parts.push(part(P.cyl(0.62, 0.46, 0.4, 10), C.brass, { y: H - 0.3 }));
  parts.push(part(P.box(1.3, 0.34, 1.3), C.ivory, { y: H + 0.07 }));
  // the arch spans back to the next column (8 m), in the y/z plane
  parts.push(part(P.torus(4, 0.36, 5, 16, Math.PI), C.ivory, { y: H + 0.2, z: -4, ry: Math.PI / 2, sx: 1, sz: 1 }));
  parts.push(part(P.torus(4, 0.08, 3, 16, Math.PI), C.brass, { x: -0.4, y: H + 0.2, z: -4, ry: Math.PI / 2, outline: 0.5 }));
  parts.push(part(P.box(1.1, 0.7, 8.2), C.ivory, { y: H + 4.6, z: -4 }));
  parts.push(part(P.box(1.4, 0.22, 8.2), C.ivoryHi, { y: H + 5.05, z: -4 }));
  parts.push(part(P.box(1.2, 0.12, 8.2), C.brass, { y: H + 4.2, z: -4, outline: 0.5 }));
  // balustrade (low, so the sky shows through the bays)
  parts.push(part(P.box(0.5, 0.18, 7.0), C.ivoryHi, { x: 0.3, y: 1.15, z: -4 }));
  parts.push(part(P.box(0.6, 0.2, 7.0), C.ivoryLo, { x: 0.3, y: 0.1, z: -4 }));
  for (let i = 0; i < 7; i++) {
    const z = -1.0 - i * 1.0;
    parts.push(part(P.lathe([[0, 0], [0.12, 0], [0.16, 0.28], [0.08, 0.58], [0.12, 0.95], [0, 0.95]], 6), C.ivory, { x: 0.3, y: 0.2, z }));
  }
  return merge(parts);
}

function grandfatherParts(pendulum = false) {
  const parts = [];
  // plinth, waist (with its glass window on the pendulum), hood with the dial, crest
  parts.push(part(P.box(1.0, 0.5, 0.62), C.wood, { y: 0.25 }));
  parts.push(part(P.box(1.06, 0.1, 0.68), C.brass, { y: 0.52, outline: 0.5 }));
  parts.push(part(P.box(0.76, 1.6, 0.52), null, { y: 1.37, grad: [C.wood, C.woodHi, 0.5, 2.2] }));
  parts.push(part(P.box(0.46, 1.2, 0.04), C.glass, { y: 1.42, z: 0.27, outline: 0.4 }));
  parts.push(part(P.box(0.96, 1.0, 0.62), C.woodHi, { y: 2.68 }));
  parts.push(...dialParts({ r: 0.36, depth: 0.08, seg: 16 }).map((g) => g.translate(0, 2.7, 0.33)));
  parts.push(part(P.box(1.04, 0.12, 0.7), C.brass, { y: 3.22, outline: 0.5 }));
  parts.push(part(P.cyl(0.42, 0.42, 0.62, 18, 1, false, 0, Math.PI), C.wood, { y: 3.28, rx: Math.PI / 2, rz: Math.PI / 2, ry: Math.PI / 2 }));
  parts.push(part(P.sphere(0.1, 10, 8), C.brassHi, { y: 3.78 }));
  for (const s of [-1, 1]) parts.push(part(P.sphere(0.07, 8, 6), C.brassHi, { x: s * 0.42, y: 3.32 }));
  if (pendulum) {
    // still behind its glass: a rod and bob
    parts.push(part(P.box(0.03, 0.8, 0.02), C.brassHi, { y: 1.62, z: 0.24, outline: 0 }));
    parts.push(part(P.cyl(0.13, 0.13, 0.03, 16), C.brassHi, { y: 1.15, z: 0.24, rx: Math.PI / 2, outline: 0.4 }));
  }
  return parts;
}

// A great pendulum hung from its pivot (the origin), swinging along the run.
function bigPendulumParts(len = 6.5) {
  return [
    part(P.box(0.08, len, 0.08), C.brassLo, { y: -len / 2 }),
    part(P.cyl(0.75, 0.75, 0.16, 28), C.brass, { y: -len, rz: Math.PI / 2, ry: 0 }),
    part(P.torus(0.75, 0.06, 6, 28), C.brassHi, { y: -len, ry: Math.PI / 2 }),
    part(P.sphere(0.14, 10, 8), C.brassHi, {}),
  ];
}

// Gears and dials adrift in the sky.
function floatDialParts() {
  return [...dialParts({ r: 3.2, depth: 0.4 }), ...handParts({ len: 2.3, w: 0.16, z: 0.3 }), ...handParts({ len: 1.6, w: 0.2, z: 0.36 }).map((g) => g.rotateZ(-2.1))];
}

// --- obstacles ------------------------------------------------------------------------
// L · A great clock hand fallen across one lane (or, the minute hand, across
// the whole walk), lying on its side so it stands low and solid.
function fallenHandGeo(len, w, seed) {
  const rnd = seeded(seed);
  const parts = [];
  const h = 0.75;
  // the blade, lying across x, standing on edge
  parts.push(part(P.box(len * 0.72, h * 0.62, 0.26), null, { x: -len * 0.1, y: h * 0.31, grad: [C.brassLo, C.brassHi, 0, h * 0.62] }));
  parts.push(part(P.cone(w * 2.2, len * 0.22, 4), C.brass, { x: len * 0.36, y: h * 0.38, rz: -Math.PI / 2, ry: Math.PI / 4, sx: 0.5 }));
  parts.push(part(P.torus(w * 1.8, w * 0.5, 8, 18), C.brass, { x: -len * 0.12, y: h * 0.5, ry: 0 }));
  parts.push(part(P.cyl(w * 1.8, w * 1.8, 0.14, 18), C.brassHi, { x: -len * 0.46, y: h * 0.55, rx: Math.PI / 2 }));
  parts.push(part(P.box(len * 0.75, 0.05, 0.2), C.brassHi, { x: -len * 0.1, y: h * 0.63, outline: 0.4 }));
  return merge(parts).translate(0, 0, -0.3 - rnd() * 0.01);
}

// L · A broken section of a clock dial, fallen on its edge: low, curved, its
// numerals' ticks facing you.
function dialSectionGeo() {
  const parts = [];
  const R = 1.12;
  const arc = Math.PI * 0.8;
  const s = new THREE.Shape();
  s.absarc(0, 0, R, Math.PI / 2 - arc / 2, Math.PI / 2 + arc / 2, false);
  s.absarc(0, 0, R * 0.55, Math.PI / 2 + arc / 2, Math.PI / 2 - arc / 2, true);
  s.closePath();
  const g = P.extrude(s, 0.28, 14);
  parts.push(part(g, C.dial, { y: -R * 0.55 + 0.02 }));
  parts.push(part(P.torus(R, 0.07, 6, 20, arc), C.brass, { y: -R * 0.55 + 0.02, rz: Math.PI / 2 - arc / 2, z: 0.15 }));
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 - arc / 2 + (arc * (i + 0.5)) / 5;
    parts.push(part(P.box(0.06, 0.22, 0.03), C.ink, { x: Math.cos(a) * R * 0.86, y: -R * 0.55 + 0.02 + Math.sin(a) * R * 0.86, z: 0.15, rz: a - Math.PI / 2, outline: 0 }));
  }
  return merge(parts).translate(0, 0, -0.15);
}

// H · A brass crossbar on two ivory posts, hung with pendulums whose bobs end
// on the duck line. (The pendulums are their own batch: they sway along the
// run, which only ever lifts them.)
function crossbarGeo(half) {
  const D = CONFIG.duckLine;
  const top = D + 1.35;
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.5, 0.3, 0.5), C.ivoryLo, { x: s * half, y: 0.15 }));
    parts.push(part(P.cyl(0.18, 0.2, top, 12), null, { x: s * half, y: top / 2, grad: [C.ivoryLo, C.ivoryHi, 0, top] }));
    parts.push(part(P.sphere(0.24, 12, 8), C.brassHi, { x: s * half, y: top + 0.16 }));
  }
  parts.push(part(P.cyl(0.13, 0.13, half * 2 + 0.2, 12), C.brass, { y: top, rz: Math.PI / 2 }));
  parts.push(part(P.box(half * 2, 0.08, 0.06), C.brassLo, { y: top - 0.2, outline: 0.4 }));
  return merge(parts);
}
function crossbarBobs(half) {
  const D = CONFIG.duckLine;
  const top = D + 1.35;
  const n = Math.max(2, Math.round(half * 1.4));
  const parts = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -half + 0.45 + ((half * 2 - 0.9) * i) / (n - 1);
    parts.push(part(P.box(0.04, top - D - 0.38, 0.04), C.brassLo, { x, y: -(top - D - 0.38) / 2, outline: 0.4 }));
    parts.push(part(P.cyl(0.3, 0.3, 0.07, 22), C.brass, { x, y: -(top - D - 0.3), rx: Math.PI / 2 }));
    parts.push(part(P.torus(0.3, 0.035, 6, 22), C.brassHi, { x, y: -(top - D - 0.3), z: 0.04, outline: 0.4 }));
  }
  return merge(parts);
}

// W · An hourglass taller than you, sand running.
function hourglassGeo() {
  const parts = [];
  const H = 3.0;
  for (const y of [0.12, H - 0.12]) parts.push(part(P.cyl(0.95, 0.95, 0.24, 6), null, { y, grad: [C.wood, C.woodHi, y - 0.12, y + 0.12] }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    parts.push(part(P.cyl(0.06, 0.06, H - 0.24, 8), C.brass, { x: Math.cos(a) * 0.8, y: H / 2, z: Math.sin(a) * 0.8 }));
  }
  const bulb = [[0.06, 0], [0.55, 0.25], [0.66, 0.6], [0.4, 1.0], [0.07, 1.28]];
  parts.push(part(P.lathe(bulb.map(([r, y]) => [r, y]), 14), C.glass, { y: 0.24 }));
  parts.push(part(P.lathe(bulb.map(([r, y]) => [r, y]), 14), C.glass, { y: H - 0.24, rx: Math.PI }));
  parts.push(part(P.lathe([[0, 0], [0.5, 0], [0.55, 0.25], [0.3, 0.5], [0, 0.55]], 14), C.sand, { y: 0.26 }));
  parts.push(part(P.lathe([[0, 0], [0.3, 0.1], [0.45, 0.32], [0, 0.32]], 14), C.sand, { y: H - 0.9 }));
  parts.push(part(P.cyl(0.02, 0.02, 0.9, 6), C.sand, { y: 1.3, outline: 0 }));
  return merge(parts).translate(0, 0, -0.8);
}

// W · A great clock weight standing on the floor, its chain running up out of sight.
function weightGeo() {
  const parts = [];
  parts.push(part(P.cyl(0.62, 0.62, 2.4, 18), null, { y: 1.2, grad: [C.brassLo, C.brassHi, 0, 2.6] }));
  parts.push(part(P.cone(0.62, 0.6, 18), C.brass, { y: 2.7 }));
  parts.push(part(P.torus(0.64, 0.06, 6, 18), C.brassHi, { y: 0.4, rx: Math.PI / 2 }));
  parts.push(part(P.torus(0.64, 0.06, 6, 18), C.brassHi, { y: 2.2, rx: Math.PI / 2 }));
  parts.push(part(P.torus(0.14, 0.04, 6, 12), C.brassLo, { y: 3.1 }));
  for (let i = 0; i < 9; i++) parts.push(part(P.torus(0.09, 0.025, 4, 10), C.brassLo, { y: 3.3 + i * 0.17, ry: (i % 2) * Math.PI / 2, outline: 0.4 }));
  return merge(parts).translate(0, 0, -0.65);
}

function gateGeo(opening, depth) {
  const parts = [...gateFrameParts(opening, { thick: 1.4, depth, color: C.ivory })];
  const top = gateTop(opening);
  // a great clock face crowning the doorway, and brass bands round the arch
  parts.push(...dialParts({ r: 3.0, depth: 0.5 }).map((g) => g.translate(0, top + 3.3, depth / 2)));
  parts.push(part(P.torus(opening.halfW + 0.7, 0.12, 6, 30, Math.PI), C.brass, { y: opening.rectH, z: depth / 2 + 0.02, outline: 0.5 }));
  for (const s of [-1, 1]) {
    parts.push(part(P.box(2.2, opening.rectH + 0.8, depth + 0.4), C.ivoryLo, { x: s * (opening.halfW + 1.9), y: (opening.rectH + 0.8) / 2 }));
    parts.push(part(P.cyl(0.9, 0.9, 0.4, 16), C.brass, { x: s * (opening.halfW + 1.9), y: opening.rectH + 1.0 }));
  }
  return merge(parts);
}

const OPENING = { halfW: 4.5, rectH: 7.2, arch: true };
const GATE_DEPTH = 1.6;

export default {
  id: 'time',
  name: 'The Gallery of Hours',
  doorColor: '#e8c674',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    sky: ['#9ec2ec', '#fff4dc', '#f0e2c8'],
    bloom: ['#ffe2a0', '#cfe0ff', '#ffffff'],
    sun: { dir: [0.2, 0.55, -1], glow: '#fff0c8', disc: '#ffffff', size: 0.05 },
    stars: 0,
    skyFx: { rays: 0.45, clouds: 0.55 },
    // soft heavenly light from high in front: gentle shadows, warm highlights
    light: { dir: [0.35, 0.8, -0.45], shadow: [0.78, 0.78, 0.9], hi: [1.06, 1.02, 0.94], soft: 0.14, wrap: 0.25, hiAmt: 0.5, lift: 1 },
    rim: [1.0, 0.95, 0.8, 0.28],
    mist: { color: '#f4ecdc', amount: 0.45, top: -0.5, fade: 5, near: 25, far: 120 },
    grade: { sat: 1.0, contrast: 1.04, vignette: 0.22, exposure: 1.02, tint: '#5a4a6a' },
    ink: '#4a3420',
    fog: [55, 210],
    ground: ['#efe4cc', '#e2d4b6', '#b8a27a'],
    shadowDecal: [0.78, 0.74, 0.8],
    cast: [-0.25, 0.4],
    glowGain: 0.6,
    pool: '#fff0c0',
    particles: { color: '#fff6d8', size: 2.0, drift: [0.06, 0.18, 0], opacity: 0.8 },
  },

  visits: [
    // golden hour: the gallery turned to amber, long shadows
    {
      env: {
        sky: ['#6a7ab8', '#ffc88a', '#f2b07a'],
        sun: { dir: [-0.4, 0.18, -1], glow: '#ffb060', disc: '#fff0d0' },
        light: { dir: [-0.6, 0.35, -0.7], shadow: [0.7, 0.6, 0.78], hi: [1.12, 1.0, 0.82] },
        rim: [1.0, 0.75, 0.45, 0.35],
        mist: { color: '#ffd8a8' },
        cast: [0.7, 0.8],
        particles: { color: '#ffd890', size: 2.3, drift: [0.1, 0.2, 0], opacity: 0.9 },
      },
    },
    // midnight: a star-sown sky, the dials glowing
    {
      env: {
        sky: ['#0a1030', '#2a3a72', '#141c3a'],
        sun: { dir: [0, 0.5, -1], glow: '#9ab0ff', disc: '#e8f0ff', size: 0.03 },
        moon: { dir: [-0.3, 0.42, -1], color: '#f2f4ff', size: 0.07 },
        stars: 1,
        skyFx: { rays: 0.1, clouds: 0.3, aurora: 0.25 },
        light: { dir: [-0.3, 0.6, -0.7], shadow: [0.5, 0.55, 0.78], hi: [0.9, 0.95, 1.1], soft: 0.08 },
        rim: [0.6, 0.75, 1.0, 0.4],
        mist: { color: '#3a4a8a', amount: 0.5 },
        grade: { exposure: 0.92, vignette: 0.4, tint: '#0a0a2a' },
        ground: ['#c8c4d4', '#b4b0c4', '#7a7690'],
        particles: { color: '#dfe8ff', size: 2.4, drift: [0.04, 0.1, 0], opacity: 1 },
      },
    },
    { env: { trip: [0.1, 0.3, 0.12] } },
  ],

  build(b) {
    b.ground('ground', groundStrip(14, 16, '#ffffff', 8), 8);
    b.toon('bay', bayGeo(), { cap: 72, anim: 'rise', ink: 0.05 });
    b.toon('bracket', merge([part(P.box(0.9, 0.9, 1.6), C.ivoryLo, { y: 0.45 }), part(P.cyl(0.6, 0.7, 0.3, 12), C.brass, { y: 1.0 })]), { cap: 24, anim: 'pop', ink: 0.04 });
    b.toon('wallClock', merge(dialParts({ r: 2.6, depth: 0.4 })), { cap: 24, anim: 'pop', ink: 0.05 });
    // hands: the minute hand sweeps round, the hour hand creeps
    b.toon('handM', merge(handParts({ len: 2.1, w: 0.14, z: 0.32 })), { cap: 24, anim: 'pop', ink: 0.03, turn: [-0.35, 0, 0, 0] });
    b.toon('handH', merge(handParts({ len: 1.4, w: 0.19, z: 0.4 })), { cap: 24, anim: 'pop', ink: 0.03, turn: [-0.03, 0, 0, 0] });
    b.toon('gear', merge(gearParts({ r: 3.2, teeth: 22, t: 0.4 })), { cap: 24, anim: 'lift', ink: 0.05, turn: [0.12, 0, 0, 0] });
    b.toon('gearB', merge(gearParts({ r: 2.0, teeth: 14, t: 0.36, color: C.brassLo, hi: C.brass })), { cap: 24, anim: 'lift', ink: 0.05, turn: [-0.2, 0, 0, 0] });
    b.toon('grandfather', merge(grandfatherParts(true)), { cap: 40, anim: 'pop', ink: 0.045 });
    b.toon('pendulum', merge(bigPendulumParts(6.2)), { cap: 20, anim: 'pop', ink: 0.04, turn: [0, 0.28, 1.4, 0] });
    b.toon('cloud', merge(cloudParts({ r: 3, lo: '#e2e8f4', hi: '#ffffff' })), { cap: 120, anim: 'lift', wobble: [0, 0.5, 0.3, 0], ink: 0.04 });
    b.toon('skyDial', merge(floatDialParts()), { cap: 24, anim: 'liftFar', wobble: [0, 0.8, 0.25, 0], ink: 0.05 });
    b.toon('skyGear', merge(gearParts({ r: 5, teeth: 28, t: 0.5 })), { cap: 24, anim: 'liftFar', ink: 0.05, turn: [0.06, 0, 0, 0] });
    b.glow('glow', { cap: 40, anim: 'pop' });
    b.shadow('shadow', { cap: 120, anim: 'pop' });

    b.toon('fallenHand', fallenHandGeo(2.1, 0.12, 1), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('dialSection', dialSectionGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('fallenMinute', fallenHandGeo(8.8, 0.18, 2), { cap: 10, anim: 'popEarly', ink: 0.045 });
    b.toon('crossbar', crossbarGeo(0.95), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('crossbarBobs', crossbarBobs(0.95).translate(0, CONFIG.duckLine + 1.35, 0), { cap: 24, anim: 'popEarly', ink: 0.035 });
    b.toon('crossbarWide', crossbarGeo(4.15), { cap: 10, anim: 'popEarly', ink: 0.04 });
    b.toon('crossbarWideBobs', crossbarBobs(4.15).translate(0, CONFIG.duckLine + 1.35, 0), { cap: 10, anim: 'popEarly', ink: 0.035 });
    b.toon('clockW', merge(grandfatherParts(true)).translate(0, 0, -0.35), { cap: 24, anim: 'popEarly', ink: 0.045 });
    b.toon('hourglass', hourglassGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('weight', weightGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });

    b.toon('gateFrame', gateGeo(OPENING, GATE_DEPTH), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateHandM', merge(handParts({ len: 2.4, w: 0.16, z: 0 })).translate(0, gateTop(OPENING) + 3.3, GATE_DEPTH / 2 + 0.36), { cap: 2, stencil: false, ink: 0.03 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff', knob: C.brassHi })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  gateExtras: ['gateHandM'],

  obstacles: {
    L: [{ name: 'fallenHand', len: 0.6 }, { name: 'dialSection', len: 0.45 }],
    H: [{ name: 'crossbar', with: ['crossbarBobs'], len: 0.5 }],
    W: [{ name: 'clockW', len: 1.0 }, { name: 'hourglass', len: 1.6 }, { name: 'weight', len: 1.3 }],
    LW: { name: 'fallenMinute', len: 0.6 },
    HW: { name: 'crossbarWide', with: ['crossbarWideBobs'], len: 0.5 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    for (const s of [-1, 1]) {
      const ry = s < 0 ? 0 : Math.PI;
      // the colonnade: a bay every 8 m (each arch reaching back to the next column)
      for (const z of [4, 12]) ctx.put('bay', s * WALL_X, 0, z, { ry });
      // in the bays: a grandfather clock, or a great pendulum swinging along the run
      const bay = (ctx.index * 2 + (s > 0 ? 1 : 0)) % 5;
      if (bay === 1 || bay === 3) ctx.put('grandfather', s * (WALL_X - 1.1), 0, 8 + rng.float(-1.5, 1.5), { ry: s < 0 ? Math.PI / 2 : -Math.PI / 2 });
      else if (bay === 0) ctx.put('pendulum', s * (WALL_X + 0.2), 11.2, 8, { ry: 0, p0: rng.float(0, 1) });
      // a great clock up on the cornice, every other chunk on alternating sides
      if ((ctx.index + (s > 0 ? 1 : 0)) % 2 === 0) {
        const y = 15.6;
        // (turned toward the runner, so they read face-on down the walk)
        const o = { ry: s < 0 ? Math.PI / 2 - 0.75 : -Math.PI / 2 + 0.75, p0: rng.float(0, 1) };
        ctx.put('wallClock', s * WALL_X, y, 8, o);
        ctx.put('bracket', s * WALL_X, 12.3, 8, {});
        ctx.put('handM', s * WALL_X, y, 8, { ...o, p0: rng.float(0, 1) });
        ctx.put('handH', s * WALL_X, y, 8, { ...o, p0: rng.float(0, 1) });
      }
      // great gears half sunk behind the balustrade
      if (rng.chance(0.4)) ctx.put(rng.chance(0.5) ? 'gear' : 'gearB', s * rng.float(9, 12), rng.float(0.5, 2.5), rng.float(0, 16), { ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, p0: rng.float(0, 1), s: rng.float(0.8, 1.3) });
      // the heavenly sky beyond: clouds, and dials and gears adrift
      if (rng.chance(0.7)) {
        ctx.put('cloud', s * rng.float(16, 70), rng.float(-6, 10), rng.float(0, 16), { s: rng.float(0.8, 2.2), ry: rng.float(0, 6.28) });
      }
      if (rng.chance(0.14)) ctx.put('skyDial', s * rng.float(22, 60), rng.float(8, 26), rng.float(0, 16), { s: rng.float(1, 2.2), ry: s * rng.float(-1.2, -0.4) });
      if (rng.chance(0.14)) ctx.put('skyGear', s * rng.float(24, 70), rng.float(6, 30), rng.float(0, 16), { s: rng.float(0.8, 2), ry: s * rng.float(-1.3, -0.3), p0: rng.float(0, 1) });
      // later laps: the midnight dials glow
      if (ctx.visit >= 2 && (ctx.index + (s > 0 ? 1 : 0)) % 2 === 0) ctx.put('glow', s * (WALL_X - 0.5), 15.6, 8, { s: 7, c: [0.6, 0.7, 1] });
    }
  },
};
