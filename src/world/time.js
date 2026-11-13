import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, cloudParts, gateFrameParts, gateTop, leafParts } from './shapes.js';
import { crystal, metal, crystalPoint, nugget, octahedron, blade, FACE } from './gems.js';
import { CONFIG } from '../config.js';

// VIII · The Gallery of Hours — a gallery of clocks open to the sky: a walk
// of ivory stone inlaid with brass ticks between colonnades of ivory columns
// and arches, aged brass everywhere, oversized clock faces up on the arches
// with their hands turning, great gears half sunk behind the balustrades,
// pendulums swinging slowly in the bays, grandfather clocks standing between
// the columns — and beyond it all a pale, heavenly sky of cloud with more
// dials and gears adrift in it.
//
// And time has come unstuck here. Every clock hand — on the great clocks up
// on the arches, the dials adrift in the sky, the grandfather clocks, the
// pocket watches dangling on their chains, the clock over the doorway out —
// turns at its own pace, either way round; and the further you run, the
// wonkier they get (env.wonk, see game.js): lurching back and forth, racing,
// stalling, ticking in jerks — on purpose, to set you off balance. The
// hourglasses work: their sand runs from the top bulb into the bottom one,
// and when it has run through, the whole glass turns over on its waist and
// starts again. Pocket watches dangle out of the sky, hourglasses drift and
// turn over among the clouds, armillary spheres turn on pedestals in the
// bays, and little cogs drift by high over the walk.
//
// And the sands of time are running out over it all: the walk is sand. It
// drifts in off both sides, banked high against the balustrades and
// spilling in across the walk in tongues — far in here, hardly at all
// there — and every few arches a thread of sand falls from the cornice and
// heaps up a pile against the balustrade, until it runs out and the pile
// slumps out across the floor (the drifts and piles are shaped in the vertex
// shader, see sandHeight; the sand itself is ground pattern 10). Wind ripples
// creep across it, wisps of sand blow over it, and the runner leaves
// footprints in it (game/sands.js). When the doorway out leads into the sea,
// the sea laps in through it: waves of white foam roll up the beach in front
// of it and draw back, wetting the sand.
//
// All the turning and swinging is decoration, and kept off the walk: the
// obstacles stay where they stand (their pendulum bobs only sway along the
// run, rising as they swing, never dipping below the duck line; an
// hourglass in your way turns over within its own footprint), so timing a
// jump or a slide is never in doubt.
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
  sand: '#d49a48',
  sandHi: '#e6b664',
  sandFall: '#ecc888',
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

// A pocket watch dangling out of the sky on a long chain: its case, dial,
// crown and bow (its hands are their own turning batches).
function watchParts() {
  const parts = [
    part(P.cyl(1.15, 1.15, 0.36, 28), null, { rx: Math.PI / 2, grad: [C.brassLo, C.brassHi, -1.1, 1.1] }),
    part(P.torus(1.12, 0.09, 6, 28), C.brassHi, { z: 0.16 }),
    ...dialParts({ r: 0.98, depth: 0.1, seg: 24 }).map((g) => g.translate(0, 0, 0.16)),
    part(P.cyl(0.16, 0.16, 0.3, 12), C.brass, { y: 1.28 }),
    part(P.torus(0.3, 0.06, 6, 16), C.brassHi, { y: 1.62 }),
  ];
  for (let i = 0; i < 26; i++) parts.push(part(P.torus(0.1, 0.03, 4, 8), C.brassLo, { y: 1.98 + i * 0.26, ry: (i % 2) * Math.PI / 2, outline: 0.4 }));
  parts.push(part(P.box(0.05, 30, 0.05), C.brassLo, { y: 8.6 + 15, outline: 0 }));
  return parts;
}

// An armillary sphere on an ivory pedestal: the pedestal, its stand and the
// fixed meridian ring; the rings inside (their own batch) turn and tumble.
function pedestalParts(top = 1.1) {
  return [
    part(P.box(0.9, 0.2, 0.9), C.ivoryLo, { y: 0.1 }),
    part(P.lathe([[0.3, 0], [0.26, 0.15], [0.18, 0.3], [0.2, top - 0.25], [0.32, top - 0.1], [0.36, top]], 10), null, { y: 0.2, grad: [C.ivoryLo, C.ivoryHi, 0.2, top] }),
    part(P.cyl(0.42, 0.42, 0.08, 12), C.brass, { y: top + 0.24 }),
  ];
}
function armillaryStandParts() {
  return [
    ...pedestalParts(),
    part(P.cyl(0.04, 0.06, 0.5, 6), C.brassLo, { y: 1.55 }),
    part(P.torus(0.62, 0.035, 5, 28), C.brass, { y: 2.3, ry: Math.PI / 2 }),
  ];
}
function armillaryRingParts() {
  return [
    part(P.torus(0.54, 0.03, 5, 26), C.brassHi, { rx: Math.PI / 2 }),
    part(P.torus(0.5, 0.028, 5, 26), C.brass, { rx: Math.PI / 2 - 0.41, ry: 0.3 }),
    part(P.torus(0.46, 0.028, 5, 24), C.brassHi, {}),
    part(P.cyl(0.012, 0.012, 1.3, 4), C.brassLo, { outline: 0 }),
    part(P.sphere(0.13, 12, 9), '#e8d0a0', {}),
  ];
}

// --- hourglasses that work (see SAND in the shaders) ----------------------------------
// A wooden plate top and bottom on four brass rods, the glass (its own batch:
// the glass material), and the sand: a pile resting in the top bulb, a
// stream, a mound in the bottom one. Everything but the sand is the same
// turned upside down, so when it turns over it's back where it began.
const HG_H = 3.0;
const HG_WAIST = HG_H / 2;
const HG_FLOOR = 0.26;
const BULB = [[0.06, 0], [0.55, 0.25], [0.66, 0.6], [0.4, 1.0], [0.07, 1.26]];
function role(g, k) {
  g.setAttribute('role', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1));
  return g;
}
function hourglassParts() {
  const parts = [];
  for (const y of [0.12, HG_H - 0.12]) parts.push(part(P.cyl(0.95, 0.95, 0.24, 6), null, { y, grad: [C.wood, C.woodHi, y - 0.12, y + 0.12] }));
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    parts.push(part(P.cyl(0.055, 0.055, HG_H - 0.24, 8), C.brass, { x: x * 0.57, y: HG_H / 2, z: z * 0.57 }));
    for (const y of [0.3, HG_H - 0.3]) parts.push(part(P.sphere(0.09, 8, 6), C.brassHi, { x: x * 0.57, y, z: z * 0.57 }));
  }
  // the sand above, resting in the funnel of the top bulb down to the neck
  parts.push(role(part(P.lathe([[0, HG_WAIST], [0.06, HG_WAIST], [0.36, 1.76], [0.56, 2.08], [0.32, 2.05], [0, 2.02]], 14), C.sand, { outline: 0.6 }), 1));
  // the mound below, on the floor of the bottom bulb
  parts.push(role(part(P.lathe([[0, HG_FLOOR], [0.05, HG_FLOOR], [0.47, 0.5], [0.57, 0.76], [0.38, 0.9], [0, 0.98]], 14), C.sand, { outline: 0.6 }), 2));
  // the stream (0..1 along y, laid between the two in the shader)
  parts.push(role(part(P.cyl(0.028, 0.028, 1, 5, 1, true), C.sandHi, { y: 0.5, outline: 0 }), 3));
  return parts;
}
function hourglassGlassParts() {
  return [
    part(P.lathe(BULB, 16), '#ffffff', { y: 0.24, outline: 0 }),
    part(P.lathe(BULB, 16), '#ffffff', { y: HG_H - 0.24, rx: Math.PI, outline: 0 }),
  ];
}

// The hands of a grandfather clock standing at (x, d) turned by ry, put at the
// centre of its dial (2.7 m up, 0.37 m out from its centre, plus dz).
function gfHands(ry, dz) {
  return (put, rng, { x, d }) => {
    const o = { ry, p0: rng.float(0, 1) };
    const hx = x + Math.sin(ry) * 0.37;
    const hd = d + dz - Math.cos(ry) * 0.37;
    put('gfHands', hx, 2.7, hd, o);
  };
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

// W · An hourglass taller than you, sand running (and turning over in its
// own footprint when it has run through; the glass is a batch of its own).
const hourglassGeo = () => merge(hourglassParts()).translate(0, 0, -0.8);
const hourglassGlassGeo = () => merge(hourglassGlassParts()).translate(0, 0, -0.8);

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

// --- the sands -------------------------------------------------------------------------
// The floor: one strip across the walk and out under the balustrades, fine
// where the drifts and piles heap up (|x| > 3) and coarse down the flat
// middle, where only the pattern changes; uv in metres (x across, y along
// the run) like groundStrip's.
function sandStrip() {
  const xs = [];
  for (let i = 0; i <= 16; i++) xs.push(-7 + i * 0.25);
  for (let x = -2; x <= 2; x++) xs.push(x);
  for (let i = 0; i <= 16; i++) xs.push(3 + i * 0.25);
  const rows = 32;
  const L = CONFIG.chunkLength;
  const pos = [];
  const nrm = [];
  const uv = [];
  for (let j = 0; j <= rows; j++) {
    const d = (L * j) / rows;
    for (const x of xs) {
      pos.push(x, 0, -d);
      nrm.push(0, 1, 0);
      uv.push(x, d);
    }
  }
  const idx = [];
  const W = xs.length;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i;
      const b = a + W;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return part(g, '#ffffff', { outline: 0 });
}

// A thread of sand falling from the cornice onto its pile (see THREAD in the
// shaders): the stream, 0..1 up y (role 0), and the grains bouncing off the
// pile where it lands (role 1).
function threadGeo() {
  const parts = [role(part(P.cyl(1, 1, 1, 6, 12, true), C.sandFall, { y: 0.5, emit: 0.25, outline: 0 }), 0)];
  const rnd = seeded(5);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd();
    const r = 0.1 + rnd() * 0.14;
    parts.push(role(part(P.ico(0.025 + rnd() * 0.02), C.sandFall, { x: Math.cos(a) * r, y: 0.04 + rnd() * 0.22, z: Math.sin(a) * r, emit: 0.25, outline: 0 }), 1));
  }
  return merge(parts);
}

// --- the sands pouring in ----------------------------------------------------------------
// A curtain of sand pouring down (SANDFALL in the shaders streaks it): a
// thin ribbon 1 m tall from its lip (y 1) to where it lands (y 0), a little
// bowed out as it falls, frayed at its edges, and the heap it splashes up at
// its foot. Stretched to the height it falls (sy) and the width (sx).
function sandfallGeo() {
  const parts = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const y0 = i / n, y1 = (i + 1) / n;
    const bow = (y) => 0.1 * Math.sin(y * Math.PI) + 0.06 * (1 - y);
    const w = (y) => 1 - 0.18 * (1 - y);
    const g = new THREE.BufferGeometry();
    const za = bow(y0), zb = bow(y1);
    const pos = [
      -w(y0) / 2, y0, za, w(y0) / 2, y0, za, w(y1) / 2, y1, zb,
      -w(y0) / 2, y0, za, w(y1) / 2, y1, zb, -w(y1) / 2, y1, zb,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(6).fill([0, 0, 1]).flat(), 3));
    parts.push(part(g, null, { grad: [C.sand, C.sandFall, 0, 1], emit: 0.18, outline: 0 }));
  }
  return merge(parts);
}
function sandHeapGeo() {
  const parts = [part(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), null, { sy: 0.32, grad: [C.sand, C.sandHi, 0, 0.32] })];
  const rnd = seeded(9);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * 6.28;
    parts.push(part(P.ico(0.06 + rnd() * 0.05), C.sandFall, { x: Math.cos(a) * 0.5, y: 0.3 + rnd() * 0.3, z: Math.sin(a) * 0.5, emit: 0.2, outline: 0 }));
  }
  return merge(parts);
}

// A dune out past the colonnade: a long whaleback of sand, its windward
// side a gentle swell and its lee a steeper face falling off a crisp crest,
// ripples combed across it by the wind.
function duneGeo(seed) {
  const rnd = seeded(seed);
  const g = new THREE.PlaneGeometry(1, 1, 24, 14);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const ph = rnd() * 6.28;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // across: a skewed hump (crest off-centre toward +x, the lee)
    const u = x + 0.5;
    const cx = 0.62 + 0.08 * Math.sin(z * 5 + ph);
    const k = u < cx ? Math.pow(u / cx, 1.6) : Math.pow(Math.max(0, (1 - u) / (1 - cx)), 0.7);
    const along = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z) * 2, 2.2)), 0.6);
    const y = Math.max(0, k * along) * (0.85 + 0.15 * Math.sin(z * 9 + ph)) + 0.012 * Math.sin(u * 60 + z * 8) * along;
    pos.setY(i, y - 0.02);
  }
  g.computeVertexNormals();
  return merge([part(g, null, { grad: [C.sand, '#f2d39a', 0.0, 0.9], outline: 0.3 })]);
}

// A wheel and the pinion it drives (radii at the teeth's tips, teeth: the
// same pitch, so they mesh), how fast the wheel turns (rad/s), and where the
// pinion sits off the wheel (the angle of the line between their centres).
const MESH = { r: [1.5, 0.6875], t: [24, 11], w: 0.32, at: -0.55 };
// The phases (0..1 of a turn, at time 0) that set a tooth of the wheel
// into a gap of the pinion along the line between them (a tooth of a
// gearParts wheel is centred 0.375 of a pitch round from its x axis).
function meshPhases(at) {
  const wheel = at / (Math.PI * 2) - 0.375 / MESH.t[0];
  const pinion = (at + Math.PI) / (Math.PI * 2) - 0.875 / MESH.t[1];
  return [wheel, pinion];
}

// --- clockwork laid bare -----------------------------------------------------------------
// A movement standing open in a bay, as if the wall had fallen away from the
// works of a great clock: two brass plates on pillars, and between them the
// train (its wheels are their own turning batches, meshed: see the chunk).
function movementFrameGeo() {
  const parts = [];
  const W = 4.2, H = 5.6;
  for (const z of [-0.45, 0.45]) {
    for (const x of [-W / 2, W / 2]) parts.push(part(P.box(0.16, H, 0.12), C.brassLo, { x, y: H / 2, z }));
    parts.push(part(P.box(W + 0.16, 0.16, 0.12), C.brass, { y: H, z }));
    parts.push(part(P.box(W + 0.16, 0.16, 0.12), C.brass, { y: 0.4, z }));
    parts.push(part(P.box(W, 0.1, 0.1), C.brassLo, { y: H * 0.55, z, rz: 0.5, outline: 0.4 }));
  }
  for (const x of [-W / 2, W / 2]) for (const y of [0.4, H]) parts.push(part(P.cyl(0.07, 0.07, 1.0, 8), C.brassHi, { x, y, rx: Math.PI / 2, outline: 0.4 }));
  parts.push(part(P.box(W + 0.6, 0.4, 1.4), C.ivoryLo, { y: 0.2 }));
  return merge(parts);
}
// The escapement: an anchor rocking over its scape wheel (TURN swing).
function anchorGeo() {
  const parts = [part(P.box(0.08, 1.3, 0.06), C.brassLo, { y: -0.65, outline: 0.4 })];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.9, 0.09, 0.07), C.brass, { x: s * 0.42, y: -1.3, rz: s * 0.35, outline: 0.4 }));
    parts.push(part(P.cone(0.07, 0.24, 4), C.brassHi, { x: s * 0.82, y: -1.52, rz: Math.PI, outline: 0.4 }));
  }
  parts.push(part(P.sphere(0.1, 8, 6), C.brassHi, {}));
  return merge(parts);
}
// A scape wheel: slanted, hooked teeth.
function scapeGeo(r = 0.7, n = 15) {
  const parts = [part(P.torus(r * 0.86, 0.05, 5, 30), C.brassHi, {}), part(P.cyl(0.09, 0.09, 0.14, 10), C.brass, { rx: Math.PI / 2 })];
  for (let i = 0; i < 4; i++) parts.push(part(P.box(r * 1.7, 0.05, 0.04), C.brass, { rz: (i / 4) * Math.PI, outline: 0.4 }));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(part(P.cone(0.07, 0.24, 3), C.brassHi, { x: Math.cos(a) * r * 0.98, y: Math.sin(a) * r * 0.98, rz: a - 0.5, sz: 0.4, outline: 0.3 }));
  }
  return merge(parts);
}

// --- the climbs ---------------------------------------------------------------------------
// From its second time round, the walk has drifted over and fallen away in
// places, and you go over the top of it: up a ramp of sand banked against
// what's left of the old gallery - a terrace half buried in the drift, a
// balcony jutting from a clock tower, a stone bridge broken off over the
// sand running out below - and across the gaps between, while the sand
// pours away down into them. (See def.climb, and ObstacleField.placeClimb.)
// Every deck is a body a metre long stretched along the run (sz) and a face
// at each end (unstretched); what stands along it - balusters, posts, heaps
// of sand, the tower - is put along it a few metres apart, so no two are
// alike.
const DECK_W = 9.0;
const DECK_LO = 1.1;
const DECK_HI = 1.9;
const DECKS = [DECK_LO, DECK_HI];

// A ramp of sand drifted up against the first deck: a metre long and a
// metre high (stretched: sz, sy), the slope smooth down the lanes and
// heaped and lumpy where it spills out past them, a soft lip at its foot.
function sandRampGeo() {
  const nx = 28, nz = 16;
  const W = 6.2;
  const g = new THREE.PlaneGeometry(W * 2, 1.03, nx, nz);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.515);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, -z));
    const ax = Math.abs(x);
    // past the lanes it falls away to the floor, in lumps
    const e = 1 - Math.min(1, Math.max(0, (ax - 4.3) / (W - 4.3)));
    const k = e * e * (3 - 2 * e);
    const lump = ax > 4.2 ? 0.12 * Math.sin(z * 19 + x * 3.1) * Math.sin(z * 7 + x) * (1 - k) : 0;
    pos.setY(i, Math.max(0, t * (0.35 + 0.65 * k) * (ax < 4.3 ? 1 : 1) + lump * t) + (ax < 4.3 ? 0 : -0.01));
  }
  g.computeVertexNormals();
  return merge([part(g, null, { grad: [C.sand, C.sandHi, 0, 1], outline: 0.2 })]);
}

// Buried terrace: a slab of the old floor and the wall under it, the sand
// banked up its sides nearly to the top.
function terraceBodyGeo(h) {
  const parts = [];
  const body = h - 0.26;
  parts.push(part(P.box(DECK_W - 0.4, body, 1), null, { y: body / 2, z: -0.5, grad: [C.ivoryLo, C.ivory, 0, body] }));
  parts.push(part(P.box(DECK_W - 0.1, 0.26, 1), C.stone, { y: h - 0.13, z: -0.5 }));
  parts.push(part(P.box(DECK_W - 2.6, 0.02, 1), C.ivory, { y: h + 0.005, z: -0.5, outline: 0 }));
  for (const x of [-1.2, 1.2]) parts.push(part(P.box(0.07, 0.02, 1), C.brass, { x, y: h + 0.01, z: -0.5, outline: 0 }));
  for (const s of [-1, 1]) {
    // (a long round bank, its lower half under the floor)
    const bank = P.cyl(1, 1, 1, 16);
    bank.rotateX(Math.PI / 2);
    bank.scale(1.5, h * 0.95, 1);
    bank.translate(s * (DECK_W / 2 + 0.2), 0, -0.5);
    parts.push(part(bank, null, { grad: [C.sand, C.sandHi, 0, h], outline: 0.3 }));
  }
  return merge(parts);
}
// Its face: the slab's broken edge, a run of dentils under it, sand
// spilling round the corners.
function terraceFaceGeo(h) {
  const rnd = seeded(Math.round(h * 13));
  const parts = [];
  parts.push(part(P.box(DECK_W - 1.0, 0.1, 0.16), C.ivoryLo, { y: h - 0.32, z: 0.06 }));
  for (let i = 0; i < 18; i++) parts.push(part(P.box(0.18, 0.14, 0.12), C.ivoryHi, { x: -DECK_W / 2 + 0.9 + (i * (DECK_W - 1.8)) / 17, y: h - 0.44, z: 0.06, outline: 0.3 }));
  for (let i = 0; i < 6; i++) {
    const x = -DECK_W / 2 + 1.2 + rnd() * (DECK_W - 2.4);
    parts.push(part(P.box(0.4 + rnd() * 0.6, 0.18, 0.26), C.stone, { x, y: h - 0.07 - rnd() * 0.05, z: 0.08, ry: (rnd() - 0.5) * 0.4, rz: (rnd() - 0.5) * 0.25 }));
  }
  for (const s of [-1, 1]) {
    parts.push(part(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), null, { x: s * (DECK_W / 2 - 0.1), y: 0, z: 0.1, sx: 1.3, sy: h * 0.9, sz: 1.1, grad: [C.sand, C.sandHi, 0, h] }));
  }
  return merge(parts);
}
// A stretch of the terrace's balustrade, a little broken: rail, balusters,
// a pier at one end (stands on the deck's edge, along the run).
function terraceRailGeo() {
  const parts = [part(P.box(0.5, 1.0, 0.5), C.ivory, { y: 0.5 }), part(P.box(0.6, 0.12, 0.6), C.ivoryHi, { y: 1.06 })];
  parts.push(part(P.box(0.34, 0.12, 2.0), C.ivoryHi, { y: 0.86, z: -1.2, rx: 0.06 }));
  for (let i = 0; i < 4; i++) parts.push(part(P.lathe([[0, 0], [0.1, 0], [0.13, 0.22], [0.06, 0.46], [0.1, 0.78], [0, 0.78]], 6), C.ivory, { y: 0, z: -0.55 - i * 0.45 }));
  return merge(parts);
}

// A clock-tower balcony: a slab jutting out, thin, with open air under it,
// a brass rail down each side (its posts are put along it).
function balconyBodyGeo(h) {
  const parts = [];
  parts.push(part(P.box(DECK_W - 0.2, 0.34, 1), C.ivoryHi, { y: h - 0.17, z: -0.5 }));
  parts.push(part(P.box(DECK_W - 0.6, 0.16, 1), C.ivoryLo, { y: h - 0.42, z: -0.5 }));
  parts.push(part(P.box(DECK_W, 0.07, 1), C.brass, { y: h - 0.33, z: -0.5, outline: 0.5 }));
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.09, 0.09, 1), C.brassHi, { x: s * (DECK_W / 2 - 0.2), y: h + 0.95, z: -0.5, outline: 0.5 }));
    parts.push(part(P.box(0.05, 0.05, 1), C.brass, { x: s * (DECK_W / 2 - 0.2), y: h + 0.45, z: -0.5, outline: 0.4 }));
  }
  return merge(parts);
}
// Its face: a bowed lip with dentils, and a little clock hung under it.
function balconyFaceGeo(h) {
  const parts = [];
  parts.push(part(P.cyl(DECK_W / 2, DECK_W / 2, 0.36, 24, 1, false, -Math.PI / 2, Math.PI), C.ivoryHi, { y: h - 0.18, sz: 0.14 }));
  parts.push(part(P.torus(DECK_W / 2, 0.05, 4, 24, Math.PI), C.brass, { y: h - 0.36, rx: Math.PI / 2, sy: 0.14, outline: 0.4 }));
  parts.push(...dialParts({ r: 0.5, depth: 0.1, seg: 18 }).map((g) => g.translate(0, h - 0.95, 0.12)));
  parts.push(part(P.box(0.08, 0.4, 0.06), C.brass, { y: h - 0.55, z: 0.08, outline: 0.4 }));
  for (const s of [-1, 1]) parts.push(part(P.cyl(0.08, 0.08, 1.0, 8), C.brassHi, { x: s * (DECK_W / 2 - 0.2), y: h + 0.5, z: 0.0 }));
  return merge(parts);
}
// A slender post holding the balcony up (stretched to its height, sy), and
// a baluster of its rail.
function balconyPostGeo() {
  return merge([
    part(P.cyl(0.14, 0.18, 1, 8), null, { y: 0.5, grad: [C.ivoryLo, C.ivory, 0, 1] }),
    part(P.box(0.4, 0.06, 0.4), C.brass, { y: 0.97, outline: 0.4 }),
  ]);
}
// A clock tower standing off to the side of the walk, the balcony jutting
// from it: a tall shaft of ivory, brass bands, an arched window, a dome.
function clockTowerGeo() {
  const parts = [];
  const H = 15;
  parts.push(part(P.box(3.2, H, 3.2), null, { y: H / 2, grad: [C.ivoryLo, C.ivoryHi, 0, H] }));
  for (const y of [4, 9.6, H - 0.2]) parts.push(part(P.box(3.5, 0.3, 3.5), C.brass, { y, outline: 0.5 }));
  parts.push(part(P.box(3.6, 0.5, 3.6), C.ivory, { y: H + 0.25 }));
  parts.push(part(P.sphere(1.6, 16, 10), C.brass, { y: H + 0.5, sy: 0.9 }));
  parts.push(part(P.cone(0.3, 1.6, 8), C.brassHi, { y: H + 2.6 }));
  for (const s of [-1, 1]) parts.push(part(P.box(0.08, 2.2, 0.9), C.ink, { x: s * 1.62, y: 6.6, outline: 0 }));
  return merge(parts);
}

// A stone bridge: its deck and a parapet down each side, open beneath.
function bridgeBodyGeo(h) {
  const parts = [];
  parts.push(part(P.box(DECK_W - 0.2, 0.5, 1), C.ivory, { y: h - 0.25, z: -0.5 }));
  parts.push(part(P.box(DECK_W - 1.2, 0.02, 1), C.stone, { y: h + 0.005, z: -0.5, outline: 0 }));
  // (a kerb each side; its balustrade is put along it)
  for (const s of [-1, 1]) parts.push(part(P.box(0.5, 0.18, 1), C.ivoryLo, { x: s * (DECK_W / 2 - 0.25), y: h + 0.09, z: -0.5 }));
  return merge(parts);
}
// Its face: an arch, keystoned in brass, its stones broken off ragged at
// the top where the span fell.
function bridgeFaceGeo(h) {
  const rnd = seeded(Math.round(h * 7) + 2);
  const parts = [];
  const s = new THREE.Shape();
  const W = DECK_W / 2;
  s.moveTo(-W, 0);
  s.lineTo(-W, h);
  s.lineTo(W, h);
  s.lineTo(W, 0);
  s.lineTo(W - 0.7, 0);
  // the arch's soffit: a flattened half-ellipse up to just under the deck
  const rise = Math.max(0.3, h - 0.55);
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI;
    s.lineTo(Math.cos(a) * (W - 0.7), Math.sin(a) * rise);
  }
  s.lineTo(-W, 0);
  parts.push(part(P.extrude(s, 0.6, 2), null, { z: -0.3, grad: [C.ivoryLo, C.ivory, 0, h] }));
  parts.push(part(P.box(0.5, 0.5, 0.66), C.brass, { y: h - 0.3, z: -0.3, outline: 0.5 }));
  for (let i = 0; i < 9; i++) {
    const x = -W + 0.4 + rnd() * (2 * W - 0.8);
    parts.push(part(P.box(0.3 + rnd() * 0.4, 0.14, 0.3), C.stone, { x, y: h + 0.02, z: 0.05, rz: (rnd() - 0.5) * 0.4, ry: rnd() }));
  }
  return merge(parts);
}

// Rubble at the lip of a gap: chunks of the floor that fell, half sunk.
function rubbleGeo() {
  const rnd = seeded(17);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const s = 0.2 + rnd() * 0.35;
    parts.push(part(P.box(s * 1.6, s, s * 1.2), rnd() < 0.5 ? C.ivory : C.stone, { x: (rnd() - 0.5) * 2.2, y: s * 0.3, z: (rnd() - 0.5) * 0.8, rx: rnd(), ry: rnd() * 3, rz: rnd() }));
  }
  return merge(parts);
}
// The gap: the slot the floor fell into, looked down into from behind - its
// near lip a bright edge of sand, then shadow, then its far wall coming up
// out of the dark into the light (the deck beyond's face carries on above
// it). A metre long, stretched to the gap (sz).
function gapGeo() {
  const parts = [];
  const bands = [
    [0, 0.05, '#f2d6a0', '#e0b46c'],
    [0.05, 0.14, '#b07a3a', '#3a2412'],
    [0.14, 0.6, '#2a170a', '#140a04'],
    [0.6, 0.84, '#140a04', '#5a3c22'],
    [0.84, 1.0, '#6a4a2c', '#b89a6c'],
  ];
  for (const [a, b, c0, c1] of bands) {
    const g = new THREE.PlaneGeometry(DECK_W + 1.6, b - a, 1, 1);
    parts.push(part(g, null, { y: (a + b) / 2, grad: [c0, c1, a, b], outline: 0 }));
  }
  return merge(parts.map((g) => g.rotateX(-Math.PI / 2))).translate(0, 0.03, 0);
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

// The door into the Gallery of Hours: half of a great clock face on each
// leaf, meeting in the middle - ivory, ringed in brass, its hours marked -
// and a brass gear turning below it.
function clockLeaf({ W, H, z, f }) {
  const out = [];
  const at = (t) => z + (f * t) / 2;
  const cy = H * 0.62;
  const R = 2.1;
  out.push(part(P.cyl(R, R, 0.08, 24, 1, false, Math.PI, Math.PI), '#fff8e6', { x: W, y: cy, z: at(0.08), rx: Math.PI / 2, outline: 0.4 }));
  out.push(part(P.torus(R + 0.08, 0.1, 6, 24, Math.PI), '#d8a24a', { x: W, y: cy, z: at(0.18), rz: Math.PI / 2 }));
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 + (i / 6) * Math.PI;
    const big = i % 3 === 0;
    const len = big ? 0.5 : 0.28;
    out.push(part(P.box(big ? 0.14 : 0.08, len, 0.06), '#3a2a1c', { x: W + Math.cos(a) * (R - 0.3 - len / 2), y: cy + Math.sin(a) * (R - 0.3 - len / 2), z: at(0.14), rz: a - Math.PI / 2, outline: 0 }));
  }
  const gx = W * 0.36;
  const gy = 1.5;
  out.push(part(P.torus(0.62, 0.14, 6, 20), '#d8a24a', { x: gx, y: gy, z: at(0.18) }));
  out.push(part(P.cyl(0.18, 0.18, 0.16, 10), '#d8a24a', { x: gx, y: gy, z: at(0.16), rx: Math.PI / 2 }));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    out.push(part(P.box(0.2, 0.26, 0.16), '#d8a24a', { x: gx + Math.cos(a) * 0.82, y: gy + Math.sin(a) * 0.82, z: at(0.16), rz: a - Math.PI / 2, outline: 0.4 }));
  }
  return out;
}

// A batch of a clock's two hands (the minute hand, then the hour hand,
// marked role 1), turning - wonky as time comes unstuck.
function handsBatch(b) {
  return (name, [len, w, z], [hLen, hW, hZ], o) => {
    const hour = merge(handParts({ len: hLen, w: hW, z: hZ }));
    hour.setAttribute('role', new THREE.BufferAttribute(new Float32Array(hour.attributes.position.count).fill(1), 1));
    b.toon(name, merge([...handParts({ len, w, z }), hour]), { ink: 0.03, wonky: true, ...o, turn: [-0.6, 0, 0, 0] });
  };
}

export default {
  id: 'time',
  name: 'The Gallery of Hours',
  doorColor: '#e8c674',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  // From the second time round: up a ramp of sand onto what's left of the
  // gallery - buried terraces, clock-tower balconies, stone bridges broken
  // off over the sand running out below - and across the gaps between (see
  // the climbs, above, and ObstacleField.placeClimb). One gap the first
  // climb of a visit, two after; two or three the third time through; from
  // the fourth, now and then the far side of a gap a step higher.
  climb: {
    from: 1,
    every: [2, 4],
    most: (visit) => (visit <= 1 ? 2 : 3),
    names: [
      'climbRamp', 'climbGap', 'climbRubble', 'climbRail', 'climbPost', 'climbTower',
      ...DECKS.flatMap((h, i) => [`terrace${i}`, `terraceFace${i}`, `balcony${i}`, `balconyFace${i}`, `bridge${i}`, `bridgeFace${i}`]),
    ],
    plan(visit, r, n) {
      const gaps = visit <= 1 ? (n === 0 ? 1 : 2) : visit === 2 ? r.int(2, 3) : 3;
      const P = [{ kind: 'ramp', h: DECK_LO, t: 0.55, min: 8 }, { kind: 'deck', style: 'terrace', h: DECK_LO, t: r.float(0.9, 1.05), min: 10 }];
      let h = DECK_LO;
      for (let i = 0; i < gaps; i++) {
        const up = visit >= 3 && h === DECK_LO && r.chance(0.4);
        if (up) h = DECK_HI;
        P.push({ kind: 'gap', t: r.float(0.3, 0.36), min: 5.5 });
        // (a higher deck is a balcony on its tower; otherwise a bridge, or
        // now and then a balcony or another terrace)
        const style = up ? 'balcony' : i === gaps - 1 && gaps > 1 ? r.pick(['balcony', 'terrace']) : r.weighted([['bridge', 3], ['balcony', 1.4], ['terrace', 1]]);
        P.push({ kind: 'deck', style, h, t: r.float(0.9, 1.05), min: 10 });
      }
      return P;
    },
    put(put, P, { d, len, h, rng }) {
      if (P.kind === 'ramp') return put('climbRamp', 0, 0, d, { sz: len * 1.02, sy: h });
      if (P.kind === 'gap') {
        put('climbGap', 0, 0, d, { sz: len });
        // the floor's rubble at both its lips
        for (const [x, z] of [[rng.float(-3.5, -1.5), d + 0.4], [rng.float(1.5, 3.5), d + len - 0.4]]) put('climbRubble', x, 0, z, { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.2) });
        return;
      }
      const i = DECKS.indexOf(h) < 0 ? 0 : DECKS.indexOf(h);
      const st = P.style || 'terrace';
      const face = `${st}Face${i}`;
      put(`${st}${i}`, 0, 0, d, { sz: len });
      put(face, 0, 0, d);
      put(face, 0, 0, d + len, { ry: Math.PI });
      // sand pouring down over its lip
      for (const x of [rng.float(-3.6, -0.8), rng.float(0.8, 3.6)]) {
        if (rng.chance(0.75)) put('sandfall', x, 0, d - (st === 'balcony' ? 0.7 : st === 'bridge' ? 0.05 : 0.12), { sx: rng.float(0.6, 1.3), sy: h - 0.05, sz: 0.5, p0: rng.float(0, 6.28) });
      }
      // and along it, a few metres apart, never two the same
      for (const s of [-1, 1]) {
        for (let z = d + rng.float(1.2, 2.6); z < d + len - 1; z += rng.float(2.2, 3.6)) {
          if (st === 'terrace') {
            if (rng.chance(0.45)) put('climbRail', s * (DECK_W / 2 - 0.35), h, z, { ry: rng.float(-0.06, 0.06) });
            else if (rng.chance(0.6)) put('sandHeap', s * rng.float(4.1, 4.5), h - 0.05, z, { s: rng.float(0.55, 0.85), ry: rng.float(0, 6.28) });
          } else if (st === 'bridge') {
            if (rng.chance(0.85)) put('climbRail', s * (DECK_W / 2 - 0.3), h + 0.1, z, { ry: rng.float(-0.04, 0.04) });
          } else if (st === 'balcony') {
            put('climbPost', s * rng.float(3.2, 3.9), 0, z, { sy: h - 0.5 });
          }
        }
      }
      // a balcony juts from its clock tower, standing off to one side
      if (st === 'balcony') {
        const s = rng.sign();
        const x = s * (DECK_W / 2 + 2.4);
        const z = d + Math.min(len * 0.5, 5);
        put('climbTower', x, 0, z, {});
        const o = { ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, p0: rng.float(0, 1) };
        put('wallClock', x - s * 1.62, 12.2, z, { ...o, s: 0.55 });
        put('hands', x - s * 1.62, 12.2, z, { ...o, s: 0.55 });
      }
    },
  },
  env: {
    // how unstuck time is as you come in, and by the doorway out (see game.js)
    wonk: [0.15, 1.6],
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
    ground: ['#f5e9cd', '#e9d5ad', '#bfa578'],
    // the sands (see the sand ground): [how high the drifts bank against
    // the balustrades (m), how high a pile heaps up (m), how long one takes
    // to build and slump (s), the share of the arches sand falls from]; and
    // the sea where it laps up the beach before a doorway into it [shallow,
    // deep, foam], how far up it reaches (m), how long a wave takes to roll
    // in and draw back (s), and how far from the doorway the runner is as it
    // starts to pour in and when it's in full (m)
    sands: {
      dunes: [1.0, 1.55, 9, 0.85],
      sea: ['#8fdcd6', '#45b2c4', '#fbfdfa'],
      surf: { reach: 26, period: [2.6, 3.6], from: 80, to: 46 },
    },
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
        sands: { sea: ['#86d0c4', '#3f98a8', '#fff4e2'] },
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
        ground: ['#cbc3c8', '#b5abb6', '#7a7088'],
        sands: { sea: ['#3d7f9a', '#1b4a6e', '#d4e2f2'] },
        particles: { color: '#dfe8ff', size: 2.4, drift: [0.04, 0.1, 0], opacity: 1 },
      },
    },
    { env: { trip: [0.1, 0.3, 0.12] } },
  ],

  build(b) {
    // every hand turns at its own pace, either way round, and wonkier the
    // further you run (wonky: see WONKY in the shaders)
    // (a clock's two hands are one batch: the minute hand, then the hour hand
    // marked with role 1, which turns at its own, slower pace)
    const hands = handsBatch(b);
    const SKY = { anim: 'liftFar', wobble: [0, 0.8, 0.25, 0] };
    const WATCH = { anim: 'liftFar', wobble: [0, 0.6, 0.4, 0] };
    const HG = (z, period) => [period, HG_WAIST, z, HG_WAIST - HG_FLOOR];

    b.ground('ground', sandStrip(), 10, { dunes: true });
    b.toon('sandThread', threadGeo(), { cap: 64, ink: 0, thread: [11.3, 0.07] });
    b.toon('bay', bayGeo(), { cap: 72, anim: 'rise', ink: 0.05 });
    b.toon('bracket', merge([part(P.box(0.9, 0.9, 1.6), C.ivoryLo, { y: 0.45 }), part(P.cyl(0.6, 0.7, 0.3, 12), C.brass, { y: 1.0 })]), { cap: 24, anim: 'pop', ink: 0.04 });
    b.toon('wallClock', merge(dialParts({ r: 2.6, depth: 0.4 })), { cap: 24, anim: 'pop', ink: 0.05 });
    hands('hands', [2.1, 0.14, 0.32], [1.4, 0.19, 0.4], { cap: 24, anim: 'pop' });
    b.toon('gear', merge(gearParts({ r: 3.2, teeth: 22, t: 0.4 })), { cap: 24, anim: 'lift', ink: 0.05, turn: [0.12, 0, 0, 0] });
    b.toon('gearB', merge(gearParts({ r: 2.0, teeth: 14, t: 0.36, color: C.brassLo, hi: C.brass })), { cap: 24, anim: 'lift', ink: 0.05, turn: [-0.2, 0, 0, 0] });
    b.toon('grandfather', merge(grandfatherParts(true)), { cap: 40, anim: 'pop', ink: 0.045 });
    hands('gfHands', [0.3, 0.03, 0.03], [0.2, 0.04, 0.05], { cap: 64, anim: 'pop', ink: 0.015 });
    b.toon('pendulum', merge(bigPendulumParts(6.2)), { cap: 20, anim: 'pop', ink: 0.04, turn: [0, 0.28, 1.4, 0] });
    b.toon('armillary', merge(armillaryStandParts()), { cap: 24, anim: 'pop', ink: 0.04 });
    b.toon('armillaryRings', merge(armillaryRingParts()), { cap: 24, anim: 'pop', ink: 0.025, turn: [0.35, 0, 0, 0.22] });
    b.toon('pedestal', merge(pedestalParts()), { cap: 24, anim: 'pop', ink: 0.04 });
    b.toon('hourglassSmall', merge(hourglassParts()), { cap: 24, anim: 'pop', ink: 0.03, sand: HG(0, 7) });
    b.glass('hourglassSmallGlass', merge(hourglassGlassParts()), { cap: 24, anim: 'pop', sand: HG(0, 7) });
    b.toon('cloud', merge(cloudParts({ r: 3, lo: '#e2e8f4', hi: '#ffffff' })), { cap: 140, anim: 'lift', wobble: [0, 0.5, 0.3, 0], ink: 0.04 });
    b.toon('skyDial', merge(dialParts({ r: 3.2, depth: 0.4 })), { cap: 40, ink: 0.05, ...SKY });
    hands('skyHands', [2.3, 0.16, 0.3], [1.6, 0.2, 0.36], { cap: 40, ...SKY });
    b.toon('skyGear', merge(gearParts({ r: 5, teeth: 28, t: 0.5 })), { cap: 32, anim: 'liftFar', ink: 0.05, turn: [0.06, 0, 0, 0] });
    b.toon('skyHourglass', merge(hourglassParts()), { cap: 16, ink: 0.04, sand: HG(0, 9), ...SKY });
    b.glass('skyHourglassGlass', merge(hourglassGlassParts()), { cap: 16, sand: HG(0, 9), ...SKY });
    b.toon('watch', merge(watchParts()), { cap: 24, ink: 0.04, ...WATCH });
    hands('watchHands', [0.8, 0.07, 0.27], [0.55, 0.09, 0.31], { cap: 24, ...WATCH });
    // little cogs drifting high over the walk
    b.toon('cog', merge(gearParts({ r: 0.7, teeth: 10, t: 0.18, spokes: 4 })), { cap: 40, anim: 'liftFar', ink: 0.03, turn: [0.5, 0.3, 0.4, 0.15], fly: [0, 0, 0.9, 0.22] });
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
    b.toon('hourglass', hourglassGeo(), { cap: 24, anim: 'popEarly', ink: 0.04, sand: HG(-0.8, 6) });
    b.glass('hourglassGlass', hourglassGlassGeo(), { cap: 24, anim: 'popEarly', sand: HG(-0.8, 6) });
    b.toon('weight', weightGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });

    // the sand pouring in off the architecture, and the dunes it has
    // drifted into out past the colonnade
    b.toon('sandfall', sandfallGeo(), { cap: 140, anim: 'pop', ink: 0, sandfall: true });
    b.toon('sandHeap', sandHeapGeo(), { cap: 90, anim: 'pop', ink: 0.02 });
    b.toon('dune', duneGeo(3), { cap: 60, anim: 'liftFar', ink: 0.02 });
    b.toon('duneB', duneGeo(11), { cap: 60, anim: 'liftFar', ink: 0.02 });
    // clockwork laid bare: an open movement in the bays, its train of
    // wheels meshing (each wheel its own batch, turning at the ratio of its
    // teeth: see MESH), its anchor rocking over the scape wheel; and the
    // great wheels standing in the dunes
    b.toon('movement', movementFrameGeo(), { cap: 16, anim: 'pop', ink: 0.04 });
    b.toon('trainWheel', merge(gearParts({ r: MESH.r[0], teeth: MESH.t[0], t: 0.22 })), { cap: 16, anim: 'pop', ink: 0.035, turn: [MESH.w, 0, 0, 0] });
    b.toon('trainPinion', merge(gearParts({ r: MESH.r[1], teeth: MESH.t[1], t: 0.26, spokes: 3, color: C.brassLo, hi: C.brass })), { cap: 16, anim: 'pop', ink: 0.035, turn: [(-MESH.w * MESH.t[0]) / MESH.t[1], 0, 0, 0] });
    b.toon('scape', scapeGeo(), { cap: 16, anim: 'pop', ink: 0.03, turn: [0.5, 0, 0, 0] });
    b.toon('anchor', anchorGeo(), { cap: 16, anim: 'pop', ink: 0.03, turn: [0, 0.22, 2.6, 0] });
    b.toon('gearGiant', merge(gearParts({ r: 6, teeth: 36, t: 0.7, spokes: 6 })), { cap: 16, anim: 'lift', ink: 0.05, turn: [0.05, 0, 0, 0] });

    // the climbs (from the second time round: see climb, above)
    b.toon('climbRamp', sandRampGeo(), { cap: 8, anim: 'popEarly', ink: 0.02 });
    b.toon('climbGap', gapGeo(), { cap: 16, anim: 'popEarly', ink: 0 });
    b.toon('climbRubble', rubbleGeo(), { cap: 32, anim: 'popEarly', ink: 0.03 });
    b.toon('climbRail', terraceRailGeo(), { cap: 60, anim: 'popEarly', ink: 0.03 });
    b.toon('climbPost', balconyPostGeo(), { cap: 60, anim: 'popEarly', ink: 0.03 });
    b.toon('climbTower', clockTowerGeo(), { cap: 8, anim: 'popEarly', ink: 0.05 });
    DECKS.forEach((h, i) => {
      b.toon(`terrace${i}`, terraceBodyGeo(h), { cap: 10, anim: 'popEarly', ink: 0.035 });
      b.toon(`terraceFace${i}`, terraceFaceGeo(h), { cap: 20, anim: 'popEarly', ink: 0.03 });
      b.toon(`balcony${i}`, balconyBodyGeo(h), { cap: 10, anim: 'popEarly', ink: 0.035 });
      b.toon(`balconyFace${i}`, balconyFaceGeo(h), { cap: 20, anim: 'popEarly', ink: 0.03 });
      b.toon(`bridge${i}`, bridgeBodyGeo(h), { cap: 10, anim: 'popEarly', ink: 0.035 });
      b.toon(`bridgeFace${i}`, bridgeFaceGeo(h), { cap: 20, anim: 'popEarly', ink: 0.035 });
    });
  },

  // (the hands of the clock over the doorway out, at its centre)
  gateExtras: [['gateHands', 0, gateTop(OPENING) + 3.3, -(GATE_DEPTH / 2 + 0.25)]],

  // The door INTO this world, in its own style (built into the shared
  // doors, see world.js: it stands in the world before it).
  door(b) {
    b.toon('gateFrame', gateGeo(OPENING, GATE_DEPTH), { cap: 2, stencil: false, ink: 0.06 });
    handsBatch(b)('gateHands', [2.4, 0.16, 0.08], [1.6, 0.22, 0.16], { cap: 2, stencil: false });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', deco: clockLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'fallenHand', len: 0.6 }, { name: 'dialSection', len: 0.45 }],
    H: [{ name: 'crossbar', with: ['crossbarBobs'], len: 0.5 }],
    W: [
      // (its dial's hands turning, like every other clock's)
      { name: 'clockW', len: 1.0, extras: gfHands(0, 0.35) },
      { name: 'hourglass', with: ['hourglassGlass'], len: 1.6 },
      { name: 'weight', len: 1.3 },
    ],
    LW: { name: 'fallenMinute', len: 0.6 },
    HW: { name: 'crossbarWide', with: ['crossbarWideBobs'], len: 0.5 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    const put = (name, x, y, z, o) => ctx.put(name, x, y, z, o);
    for (const s of [-1, 1]) {
      const ry = s < 0 ? 0 : Math.PI;
      // under the arch at the chunk's seam, perhaps a thread of sand falling
      // onto a pile (the shaders decide which, and when: see pileCycle)
      ctx.put('sandThread', s * 5.85, 0, 0, { p0: ctx.d0 % 4096, p1: s });
      // the colonnade: a bay every 8 m (each arch reaching back to the next column)
      for (const z of [4, 12]) ctx.put('bay', s * WALL_X, 0, z, { ry });
      // in the bays: a grandfather clock, a great pendulum swinging along the
      // run, or a pedestal with an hourglass or an armillary sphere on it
      const bay = (ctx.index * 2 + (s > 0 ? 1 : 0)) % 5;
      const face = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      if (bay === 1 || bay === 3) {
        const gx = s * (WALL_X - 1.1);
        const gz = 8 + rng.float(-1.5, 1.5);
        ctx.put('grandfather', gx, 0, gz, { ry: face });
        gfHands(face, 0)(put, rng, { x: gx, d: gz });
      } else if (bay === 0) ctx.put('pendulum', s * (WALL_X + 0.2), 11.2, 8, { ry: 0, p0: rng.float(0, 1) });
      else if (bay === 4 && rng.chance(0.6)) {
        // an open movement: its wheel driving a pinion, the scape wheel and
        // its anchor rocking over it, all turning in the bay
        const mx = s * (WALL_X - 1.0);
        const mz = 8 + rng.float(-0.6, 0.6);
        const at = (lx) => [mx + lx * Math.cos(face), mz + lx * Math.sin(face)];
        ctx.put('movement', mx, 0, mz, { ry: face });
        const [pw, pp] = meshPhases(MESH.at);
        const wx = -0.7, wy = 2.4;
        const reach = 0.93 * (MESH.r[0] + MESH.r[1]);
        const [ax, az] = at(wx);
        ctx.put('trainWheel', ax, wy, az, { ry: face, p0: pw });
        const [bx, bz] = at(wx + Math.cos(MESH.at) * reach);
        ctx.put('trainPinion', bx, wy + Math.sin(MESH.at) * reach, bz, { ry: face, p0: pp });
        const [cx, cz] = at(1.05);
        ctx.put('scape', cx, 4.1, cz, { ry: face, p0: rng.float(0, 1) });
        ctx.put('anchor', cx, 5.45, cz, { ry: face, p0: rng.float(0, 1) });
      } else {
        const px = s * (WALL_X - 1.0);
        const pz = 8 + rng.float(-1, 1);
        if (rng.chance(0.5)) {
          const o = { ry: rng.float(0, 6.28), p0: rng.float(0, 1) };
          ctx.put('armillary', px, 0, pz, o);
          ctx.put('armillaryRings', px, 2.3, pz, o);
        } else {
          const o = { ry: face, p0: rng.float(0, 6.28), s: 0.42 };
          ctx.put('pedestal', px, 0, pz, { ry: face });
          ctx.put('hourglassSmall', px, 1.4, pz, o);
          ctx.put('hourglassSmallGlass', px, 1.4, pz, o);
        }
      }
      // a great clock up on the cornice, every other chunk on alternating sides
      if ((ctx.index + (s > 0 ? 1 : 0)) % 2 === 0) {
        const y = 15.6;
        // (turned toward the runner, so they read face-on down the walk)
        const o = { ry: s < 0 ? Math.PI / 2 - 0.75 : -Math.PI / 2 + 0.75, p0: rng.float(0, 1) };
        ctx.put('wallClock', s * WALL_X, y, 8, o);
        ctx.put('bracket', s * WALL_X, 12.3, 8, {});
        ctx.put('hands', s * WALL_X, y, 8, { ...o, p0: rng.float(0, 1) });
      }
      // sand pouring in off the cornice through an arch, heaping up on the
      // drift where it lands
      if (rng.chance(0.45)) {
        const z = 8 + rng.float(-1.6, 1.6);
        ctx.put('sandfall', s * (WALL_X - 0.15), 0.9, z, { sx: rng.float(0.8, 2.0), sy: 10.5, p0: rng.float(0, 6.28) });
        ctx.put('sandHeap', s * (WALL_X - 0.6), 0.55, z, { s: rng.float(0.9, 1.5), ry: rng.float(0, 6.28) });
      }
      // the dunes the gallery stands in, rolling away to the horizon
      if (rng.chance(0.6)) {
        ctx.put(rng.chance(0.5) ? 'dune' : 'duneB', s * rng.float(15, 75), -0.4, rng.float(0, 16), { sx: rng.float(18, 42), sz: rng.float(16, 34), sy: rng.float(2.5, 8), ry: rng.float(-0.5, 0.5) + (rng.chance(0.5) ? Math.PI : 0) });
      }
      // now and then a great wheel standing in them, turning slowly, the sand
      // it has carried up pouring off its rim
      if (rng.chance(0.14)) {
        const gx = s * rng.float(13, 17);
        const gy = rng.float(0.5, 2.2);
        const gz = rng.float(2, 14);
        ctx.put('gearGiant', gx, gy, gz, { ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, p0: rng.float(0, 1) });
        ctx.put('sandfall', gx - s * 0.6, 0, gz - 1.6, { sx: rng.float(1.2, 2.2), sy: gy + 5.4, p0: rng.float(0, 6.28) });
        ctx.put('sandHeap', gx - s * 0.6, 0, gz - 1.6, { s: rng.float(1.6, 2.4) });
      }
      // great gears half sunk behind the balustrade
      if (rng.chance(0.45)) ctx.put(rng.chance(0.5) ? 'gear' : 'gearB', s * rng.float(9, 12), rng.float(0.5, 2.5), rng.float(0, 16), { ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, p0: rng.float(0, 1), s: rng.float(0.8, 1.3) });
      // the heavenly sky beyond: clouds, and dials, gears and hourglasses adrift
      if (rng.chance(0.75)) {
        ctx.put('cloud', s * rng.float(16, 70), rng.float(-6, 10), rng.float(0, 16), { s: rng.float(0.8, 2.2), ry: rng.float(0, 6.28) });
      }
      if (rng.chance(0.28)) {
        const o = { s: rng.float(0.9, 2), ry: s * rng.float(-1.2, -0.4), p0: rng.float(0, 1) };
        const x = s * rng.float(16, 55);
        const y = rng.float(7, 24);
        const z = rng.float(0, 16);
        ctx.put('skyDial', x, y, z, o);
        ctx.put('skyHands', x, y, z, o);
      }
      if (rng.chance(0.2)) ctx.put('skyGear', s * rng.float(20, 70), rng.float(6, 30), rng.float(0, 16), { s: rng.float(0.8, 2), ry: s * rng.float(-1.3, -0.3), p0: rng.float(0, 1) });
      if (rng.chance(0.1)) {
        const o = { s: rng.float(1.4, 2.6), ry: rng.float(0, 6.28), p0: rng.float(0, 6.28) };
        const x = s * rng.float(15, 45);
        const y = rng.float(5, 18);
        const z = rng.float(0, 16);
        ctx.put('skyHourglass', x, y, z, o);
        ctx.put('skyHourglassGlass', x, y, z, o);
      }
      // a pocket watch dangling out of the sky on its chain
      if (rng.chance(0.16)) {
        const o = { s: rng.float(0.9, 1.5), ry: s < 0 ? rng.float(0.3, 1.1) : -rng.float(0.3, 1.1), p0: rng.float(0, 1) };
        const x = s * rng.float(9, 22);
        const y = rng.float(9, 15);
        const z = rng.float(0, 16);
        ctx.put('watch', x, y, z, o);
        ctx.put('watchHands', x, y, z, o);
      }
      // later laps: the midnight dials glow
      if (ctx.visit >= 2 && (ctx.index + (s > 0 ? 1 : 0)) % 2 === 0) ctx.put('glow', s * (WALL_X - 0.5), 15.6, 8, { s: 7, c: [0.6, 0.7, 1] });
    }
    if (rng.chance(0.3)) ctx.put('cog', rng.float(-4, 4), rng.float(9.5, 13), rng.float(0, 16), { s: rng.float(0.7, 1.4), p0: rng.float(0, 6.28) });
  },
};
