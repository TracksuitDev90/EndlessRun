import {
  P, part, merge, mix,
  cypressParts, roundTreeParts, bushParts, lanternPostParts, potParts, gateFrameParts, gateLeafParts, gateTop,
} from './shapes.js';
import { shaftParts, giantFlowerParts } from './whimsy.js';
import { crystal, stone, barrel, nugget, blade, lumps, rough } from './gems.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';

// I · The Cypress Lane — tall bullet-shaped cypresses in lime and deep green,
// little mossy-roofed houses in mustard, mint and teal, round hedges, a
// cobbled lane. Art direction straight from the green forest reference.
// Soft, glowing light: wrapped shading, a green-gold haze and sun shafts
// slanting between the trees. Returns bring a golden hour full of blossom,
// a lilac dusk of giant flowers, and finally a teal-and-pink dream.

const C = {
  leafLo: '#3a8a2c',
  leafHi: '#c6e43c',
  bushLo: '#5aa82e',
  bushHi: '#c4e84a',
  trunk: '#46561f',
  stone: '#e2dbb4',
  stoneDark: '#a8a27c',
  mossLo: '#5d9f2a',
  moss: '#a6d63c',
  frame: '#1f4a2c',
  glass: '#29483a',
  lit: '#ffd77a',
  door: '#7a4e26',
  wood: '#b07a40',
  woodDark: '#6e4a26',
  terracotta: '#c8693a',
  canopy: '#f2c84b',
  cream: '#fff3d0',
  orange: '#f28a2a',
  grass: '#5ea83a',
};
const HOUSE_TINTS = ['#f2c64b', '#8fe0b8', '#45b89a', '#e9b43a', '#bfe7a0', '#6fcfa8', '#f6d873', '#9ad86a'];

// The blues, as they come out of the ground — cornflower to midnight against
// the lane's greens and mustards. Sapphire above all: corundum's hexagonal
// barrel, tapering to flat ends and leaning a little, with darker bands of
// colour zoning across it. Mixed in: water-worn sapphire pebbles (the way
// they turn up, in river gravels), blades of kyanite fanning out of a scrap
// of pale rock, rounded lumps of deep azurite, and rough sky-blue hauyne. A
// great barrel with a smaller one grown into its side for the prize spots.
const GEM = {
  name: 'sapphire',
  color: '#2c6cff',
  stones: [
    {
      name: 'sapphire',
      weight: 3,
      tints: ['#2c6cff', '#3f8dff', '#2546e0'],
      parts: () => [crystal(barrel({ r: 0.15, h: 0.29, seed: 3 }), { rz: 0.14 })],
      texture: { bands: 0.25, bandFreq: 9, second: '#1a2a9a', mottle: 0.4, rough: 0.35, speckle: 0.1 },
    },
    {
      name: 'sapphire pebble',
      weight: 1.2,
      tints: ['#2c6cff', '#4a7cf0', '#3a5ae8'],
      parts: () => [crystal(nugget({ r: [0.25, 0.17, 0.2], faces: 30, spread: 0.06, chips: 2, seed: 5 }))],
      texture: { veins: 0.3, mottle: 0.5, second: '#9ac0ff', rough: 0.45, speckle: 0.15 },
    },
    {
      // bladed crystals fanning out of a scrap of pale rock, finely striated
      name: 'kyanite',
      weight: 1.3,
      tints: ['#3a6ee8', '#5a8af0', '#2f5cd4'],
      parts: () => [
        stone(rough({ r: 0.1, seed: 4 }), null, { y: -0.23, sy: 0.6, grad: ['#aeb6c4', '#eef0f4', -0.3, -0.16] }),
        ...[[-0.45, -0.08, 0.02, 0.44, 1, 0.3], [0.05, 0, 0, 0.54, 2, -0.2], [0.45, 0.08, -0.03, 0.42, 3, 0.5], [-0.1, -0.02, -0.07, 0.38, 4, 1.4]].map(([rz, x, z, len, seed, ry]) => {
          const g = blade({ len, w: 0.08, t: 0.022, seed });
          g.translate(0, len / 2 - 0.22, 0);
          return crystal(g, { rz, x, z, ry });
        }),
      ],
      texture: { bands: 0.4, bandFreq: 60, wander: 3, second: '#b8d0ff', mottle: 0.4, rough: 0.3, glints: 0.7 },
    },
    {
      // deep blue, in rounded lumps grown together
      name: 'azurite',
      weight: 1,
      tints: ['#1d3cb4', '#2448c8', '#1a34a0'],
      parts: () => lumps({ n: 6, r: 0.12, spread: 0.12, seed: 4 }).map((g) => crystal(g)),
      texture: { opaque: 0.7, mottle: 0.6, speckle: 0.45, second: '#6a9aff', rough: 0.55, scale: 8, glints: 0.6 },
    },
    {
      // pale sky blue, rough
      name: 'hauyne',
      weight: 0.9,
      tints: ['#5aa8ff', '#74b8ff'],
      parts: () => [crystal(nugget({ r: [0.21, 0.19, 0.18], faces: 15, spread: 0.18, chips: 3, seed: 13 }))],
      texture: { mottle: 0.35, speckle: 0.12, second: '#dceeff', rough: 0.35, veins: 0.25 },
    },
  ],
  crown: {
    name: 'sapphire',
    tints: ['#2c6cff', '#3f8dff', '#2546e0'],
    parts: () => [
      crystal(barrel({ r: 0.19, h: 0.35, seed: 8 }), { rz: 0.1 }),
      crystal(barrel({ r: 0.1, h: 0.19, seed: 9 }), { x: 0.19, y: -0.1, rz: -0.85, rx: 0.3 }),
    ],
    texture: { bands: 0.25, bandFreq: 8, second: '#1a2a9a', mottle: 0.3, rough: 0.2, speckle: 0.06 },
  },
  motion: [1.3, 2.2, 0.07, 0.14],
  look: [0.75, 1, 0.3, 0.35],
  glow: 0.55,
  pool: 0.3,
};

const OPENING = { halfW: 4.6, rectH: 8.2, arch: true };
const SUN = [-0.55, 0.78, 0.38];
const BLOSSOM = ['#ffb3c8', '#ffd0dc', '#ffffff', '#f6a8c8'];
const PETALS = ['#ffffff', '#ffe36a', '#ff9ab8', '#c8a0ff', '#ff8a5a', '#8fd0ff'];
const GATE_DEPTH = 1.8;

function houseGeo({ w, h, d, roofH, floors, cols, lit, chimney, seed }) {
  const parts = [];
  parts.push(part(P.box(w, h, d), '#ffffff', { y: h / 2, tint: 1 }));
  parts.push(part(P.box(w + 0.14, 0.4, d + 0.14), C.stoneDark, { y: 0.2 }));
  // mossy gable roof with a soft overhang
  parts.push(part(P.prism(w + 0.7, roofH, d + 0.6), null, { y: h, grad: [C.mossLo, C.moss, h, h + roofH], mark: 0.7, uvScale: [0.6, 0.6] }));
  parts.push(part(P.box(w + 0.75, 0.22, d + 0.65), C.mossLo, { y: h + 0.05, mark: 0.5 }));
  if (chimney) parts.push(part(P.box(0.5, 1.4, 0.5), C.stoneDark, { x: w * 0.25, y: h + roofH * 0.6, z: -d * 0.15 }));
  let k = seed;
  const rnd = () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
  const floorH = (h - 0.6) / floors;
  const win = (x, y, z, ry) => {
    const isLit = rnd() < lit;
    parts.push(part(P.box(0.86, 1.08, 0.12), C.frame, { x, y, z, ry }));
    parts.push(part(P.box(0.62, 0.84, 0.16), isLit ? C.lit : C.glass, { x, y, z, ry, emit: isLit ? 1 : 0, outline: 0.4 }));
  };
  for (let f = 0; f < floors; f++) {
    const y = 0.6 + floorH * (f + 0.55);
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * (w / cols);
      if (f === 0 && c === Math.floor(cols / 2) && cols % 2 === 1) continue;
      win(x, y, d / 2 + 0.02, 0);
    }
    win(w / 2 + 0.02, y, 0, Math.PI / 2);
    win(-w / 2 - 0.02, y, 0, Math.PI / 2);
  }
  // front door with a little awning
  const dx = cols % 2 === 1 ? 0 : w * 0.25;
  parts.push(part(P.box(0.95, 1.75, 0.14), C.frame, { x: dx, y: 0.95, z: d / 2 + 0.02 }));
  parts.push(part(P.box(0.75, 1.6, 0.18), C.door, { x: dx, y: 0.88, z: d / 2 + 0.02 }));
  parts.push(part(P.box(1.25, 0.12, 0.6), C.mossLo, { x: dx, y: 1.95, z: d / 2 + 0.3, mark: 0.4 }));
  return merge(parts);
}

function hedgeGeo(width) {
  const r = 0.42;
  const parts = [
    part(P.box(width, 0.62, 0.9), null, { y: 0.31, grad: [C.bushLo, C.bushHi, 0, 1], mark: 0.85, tint: 1, uvScale: [width / 1.6, 0.4] }),
    part(P.cyl(r, r, width, 12), null, { y: 0.55, rz: Math.PI / 2, grad: [C.bushLo, C.bushHi, 0.2, 1.0], mark: 0.85, tint: 1, uvScale: [1.2, width / 1.6] }),
  ];
  const n = Math.round(width * 2.2);
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + 0.2 + ((width - 0.4) * (i + 0.5)) / n;
    const z = Math.sin(i * 7.1) * 0.25;
    parts.push(part(P.sphere(0.07, 6, 4), i % 3 === 0 ? '#ffe36a' : '#ffffff', { x, y: 0.94 + Math.sin(i * 3.3) * 0.03, z, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.45);
}

function cratesGeo() {
  const parts = [];
  const crate = (x, w, h, d, ry) => {
    parts.push(part(P.box(w, h, d), C.wood, { x, y: h / 2, ry }));
    for (const yy of [0.18, h - 0.18]) parts.push(part(P.box(w + 0.04, 0.1, d + 0.04), C.woodDark, { x, y: yy, ry, outline: 0.5 }));
  };
  crate(-0.48, 0.9, 0.78, 0.86, 0.1);
  crate(0.5, 0.82, 0.62, 0.8, -0.12);
  for (let i = 0; i < 7; i++) {
    parts.push(part(P.sphere(0.12, 8, 6), C.orange, { x: 0.38 + (i % 3) * 0.2 - 0.1, y: 0.7 + Math.floor(i / 3) * 0.06, z: (i % 2) * 0.2 - 0.12, outline: 0.6 }));
  }
  return merge(parts).translate(0, 0, -0.45);
}

function signGeo() {
  // Painted shop sign slung between two posts. Its bottom edge (and the leafy
  // garland along it) sits on the duck line, with open road beneath.
  const D = CONFIG.duckLine;
  const top = 2.75;
  const boardH = 0.78;
  const by = D + 0.05 + boardH / 2;
  const parts = [
    part(P.box(0.16, top, 0.16), C.woodDark, { x: -0.98, y: top / 2 }),
    part(P.box(0.16, top, 0.16), C.woodDark, { x: 0.98, y: top / 2 }),
    part(P.box(2.3, 0.18, 0.2), C.wood, { y: top - 0.1 }),
    part(P.box(0.03, top - 0.1 - (by + boardH / 2), 0.03), '#333', { x: -0.6, y: (top - 0.1 + by + boardH / 2) / 2, outline: 0 }),
    part(P.box(0.03, top - 0.1 - (by + boardH / 2), 0.03), '#333', { x: 0.6, y: (top - 0.1 + by + boardH / 2) / 2, outline: 0 }),
    part(P.box(1.72, boardH + 0.1, 0.1), C.woodDark, { y: by }),
    part(P.box(1.56, boardH - 0.06, 0.14), C.canopy, { y: by }),
    part(P.sphere(0.22, 10, 8), C.leafLo, { x: -0.35, y: by, z: 0.07, sz: 0.3 }),
    part(P.sphere(0.12, 8, 6), C.orange, { x: 0.12, y: by + 0.06, z: 0.08, sz: 0.4 }),
    part(P.sphere(0.12, 8, 6), C.orange, { x: 0.42, y: by - 0.05, z: 0.08, sz: 0.4 }),
  ];
  // leafy trim hanging along the bottom edge marks the duck line
  for (let i = 0; i < 9; i++) {
    const x = -0.8 + (1.6 * i) / 8;
    parts.push(part(P.sphere(0.1, 7, 5), null, { x, y: D + 0.1, z: 0.02, sy: 0.85, grad: [C.bushLo, C.bushHi, D, D + 0.2], mark: 0.6 }));
    if (i % 2 === 1) parts.push(part(P.sphere(0.055, 6, 4), i % 4 === 1 ? '#ffffff' : '#ffb3c8', { x, y: D + 0.12, z: 0.11, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.15);
}

function pergolaGeo() {
  const parts = [];
  for (const x of [-3.95, 3.95]) parts.push(part(P.box(0.24, 2.6, 0.24), C.woodDark, { x, y: 1.3 }));
  parts.push(part(P.box(8.4, 0.22, 0.3), C.wood, { y: 2.5 }));
  parts.push(part(P.box(8.4, 0.16, 0.24), C.wood, { y: 2.2, z: 0.25 }));
  const n = 13;
  for (let i = 0; i < n; i++) {
    const x = -3.6 + (7.2 * i) / (n - 1);
    const fy = CONFIG.duckLine + 0.44 + Math.abs(Math.sin(i * 1.7)) * 0.05;
    parts.push(part(P.sphere(0.46, 9, 7), null, { x, y: fy, sy: 0.95, grad: [C.bushLo, C.bushHi, fy - 0.45, fy + 0.6], mark: 0.85, tint: 1 }));
    if (i % 2 === 0) parts.push(part(P.sphere(0.09, 6, 4), i % 4 === 0 ? '#ffffff' : '#ffb3c8', { x: x + 0.15, y: fy - 0.2, z: 0.35, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.2);
}

function cartGeo() {
  const parts = [];
  const L = 3.0;
  parts.push(part(P.box(1.7, 0.8, L), C.wood, { y: 0.95 }));
  parts.push(part(P.box(1.76, 0.12, L + 0.06), C.woodDark, { y: 1.38 }));
  for (const z of [-L * 0.3, L * 0.3]) {
    for (const x of [-0.92, 0.92]) parts.push(part(P.cyl(0.46, 0.46, 0.12, 12), C.woodDark, { x, y: 0.46, z, rz: Math.PI / 2 }));
  }
  for (const x of [-0.78, 0.78]) {
    for (const z of [-L / 2 + 0.1, L / 2 - 0.1]) parts.push(part(P.box(0.08, 1.4, 0.08), C.woodDark, { x, y: 2.05, z }));
  }
  // striped canopy
  parts.push(part(P.prism(2.1, 0.6, L + 0.4), C.canopy, { y: 2.72 }));
  for (let i = 0; i < 5; i++) {
    parts.push(part(P.box(2.14, 0.08, 0.32), C.cream, { y: 2.74, z: -L / 2 + 0.1 + i * 0.7, outline: 0 }));
  }
  // produce
  for (let i = 0; i < 12; i++) {
    const z = -L / 2 + 0.35 + (i % 6) * 0.45;
    const x = i < 6 ? -0.35 : 0.35;
    parts.push(part(P.sphere(0.17, 8, 6), i % 3 === 0 ? C.canopy : C.orange, { x, y: 1.55, z, outline: 0.6 }));
  }
  return merge(parts).translate(0, 0, -L / 2);
}

// A long low bed of mixed flowers for the verge on later laps.
function flowerBedGeo() {
  const parts = [part(P.sphere(1, 10, 6), null, { y: 0.02, sx: 0.75, sy: 0.28, sz: 2.4, grad: ['#4a8a2a', '#8fd04a', 0, 0.3], mark: 0.6 })];
  let k = 7;
  const rnd = () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
  for (let i = 0; i < 22; i++) {
    const z = (rnd() - 0.5) * 4.2;
    const x = (rnd() - 0.5) * 1.1 * Math.sqrt(1 - (z / 2.4) ** 2);
    const y = 0.2 + rnd() * 0.18;
    parts.push(part(P.sphere(0.085 + rnd() * 0.045, 5, 4), PETALS[Math.floor(rnd() * PETALS.length)], { x, y, z, outline: 0.5 }));
  }
  return merge(parts);
}

function topiaryGeo() {
  const parts = [
    part(P.box(1.5, 0.9, 1.5), C.terracotta, { y: 0.45 }),
    part(P.box(1.62, 0.16, 1.62), '#a9532a', { y: 0.92 }),
    ...cypressParts({ h: 4.2, r: 0.78, lo: C.leafLo, hi: C.leafHi, trunkH: 1.05 }),
  ];
  return merge(parts).translate(0, 0, -0.75);
}

function gateGeo() {
  const top = gateTop(OPENING);
  const parts = [...gateFrameParts(OPENING, { thick: 1.35, depth: GATE_DEPTH, color: C.stone })];
  // keystone + cap
  parts.push(part(P.box(1.2, 1.5, GATE_DEPTH + 0.2), C.stoneDark, { y: top + 0.9 }));
  // ivy draped over the arch
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.12 + 0.76 * (i / 8));
    const R = OPENING.halfW + 0.7;
    parts.push(part(P.sphere(0.7 + (i % 3) * 0.12, 9, 7), null, { x: Math.cos(a) * R, y: OPENING.rectH + Math.sin(a) * R, z: 0.55, grad: [C.leafLo, C.leafHi, OPENING.rectH, top + 1.5], mark: 0.85, sz: 0.6 }));
  }
  // tall hedge walls running off to either side
  for (const s of [-1, 1]) {
    const w = 64;
    const x = s * (OPENING.halfW + 1.35 + w / 2 - 0.2);
    parts.push(part(P.box(w, 8.0, 2.6), null, { x, y: 4.0, grad: ['#2f7a2a', '#7fc236', 0, 9], mark: 0.85, uvScale: [w / 3.4, 8 / 3.4] }));
    parts.push(part(P.cyl(1.3, 1.3, w, 14), null, { x, y: 8.0, rz: Math.PI / 2, grad: ['#4f9a2e', '#a8d83a', 6.7, 9.3], mark: 0.85, uvScale: [2.4, w / 3.4] }));
    // lanterns on the gate pillars
    parts.push(...lanternPostParts({ h: 2.2 }).map((g) => g.translate(s * (OPENING.halfW + 0.65), 0, GATE_DEPTH / 2 + 0.5)));
  }
  return merge(parts);
}

export default {
  id: 'village',
  name: 'The Cypress Lane',
  doorColor: '#f2b93b',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    sky: ['#7cbf46', '#eef8b4', '#3d8a36'],
    bloom: ['#f2b93b', '#a6e04a', '#3fb8b0'], // the colours its doorway bloom is made of
    sun: { dir: [-0.25, 0.3, -1], glow: '#fff3b0' },
    stars: 0,
    skyFx: { rays: 0.35, clouds: 0.28 },
    // soft: wide wrapped terminator, bright shadows, gentle back-light
    light: { dir: SUN, shadow: [0.64, 0.78, 0.68], hi: [1.08, 1.08, 0.92], soft: 0.32, wrap: 0.35, hiAmt: 0.55, lift: 1 },
    rim: [1.0, 0.95, 0.7, 0.26],
    mist: { color: '#f2f7c4', amount: 0.4, top: 5, fade: 6, near: 25, far: 120 },
    dapple: [0.2, 0.06, 0.012],
    grade: { sat: 1.04, contrast: 0.96, vignette: 0.28, exposure: 1.04, tint: '#3a6a20' },
    beam: { color: '#fff4c0', amount: 0.18 },
    ink: '#163a1d',
    fog: [40, 190],
    ground: ['#cdc99a', '#b4b482', '#7d8452'],
    shadowDecal: [0.58, 0.7, 0.55],
    cast: [0.7, -0.49],
    glowGain: 0.55,
    particles: { color: '#f2ff9a', size: 2.4, drift: [0, 0.22, 0], opacity: 0.85 },
  },

  visits: [
    {
      // golden hour, blossom drifting
      env: {
        sky: ['#f0b878', '#fff0b8', '#4f8a3a'],
        bloom: ['#ffa86a', '#ffd890', '#ff9ac0'],
        sun: { dir: [-0.4, 0.14, -1], glow: '#ffd890' },
        skyFx: { rays: 0.6, clouds: 0.4 },
        light: { shadow: [0.72, 0.66, 0.74], hi: [1.14, 1.05, 0.86] },
        rim: [1.0, 0.82, 0.55, 0.32],
        mist: { color: '#ffe8b8' },
        grade: { sat: 1.08, tint: '#6a3a20' },
        beam: { color: '#ffd8a0', amount: 0.2 },
        particles: { color: '#ffc4dc', size: 2.8, drift: [0.7, -0.35, 0], opacity: 0.9 },
      },
    },
    {
      // lilac dusk, lamps lit, fireflies, giant flowers in the fields
      env: {
        sky: ['#6a5ab8', '#ffc4b0', '#3a5a3a'],
        bloom: ['#9a7ae8', '#ffb0a0', '#fff2a0'],
        sun: { dir: [0.3, 0.06, -1], glow: '#ff9ab0' },
        moon: { dir: [-0.5, 0.45, -1], color: '#fff2d0', size: 0.06 },
        stars: 0.5,
        light: { shadow: [0.6, 0.58, 0.8], hi: [1.05, 1.0, 1.08] },
        rim: [0.9, 0.7, 1.0, 0.32],
        mist: { color: '#d8c0f0', amount: 0.45 },
        grade: { tint: '#2a1a5a', vignette: 0.36 },
        beam: { amount: 0.06 },
        glowGain: 1.1,
        particles: { color: '#fff6a0', size: 3.0, drift: [0.1, 0.25, 0], opacity: 1 },
      },
    },
    {
      // the dream: teal and pink, aurora, the far lane rolling like a sea
      env: {
        sky: ['#1f8a9a', '#ffd0e8', '#3a6a5a'],
        bloom: ['#2fc0c8', '#ff9ad0', '#fff4c0'],
        sun: { dir: [-0.2, 0.25, -1], glow: '#ffc0e0' },
        moon: undefined,
        stars: 0.3,
        skyFx: { rays: 0.4, clouds: 0.3, aurora: 0.3 },
        light: { shadow: [0.6, 0.72, 0.86], hi: [1.1, 1.0, 1.1] },
        mist: { color: '#ffd6ec', amount: 0.5 },
        grade: { sat: 1.12, tint: '#2a3a6a' },
        particles: { color: '#ffffff', size: 3.4, drift: [0.4, 0.15, 0], opacity: 0.9 },
        trip: [0.1, 0.3, 0.15],
      },
    },
  ],

  build(b) {
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 1);
    b.toon('grass', groundStrip(420, 16, C.grass, 8, { y: -0.03, mark: 0.45 }), { ink: 0, cap: 40, marks: [0.3, 0.3] });
    b.toon('curb', merge([part(P.box(0.42, 0.32, 16, 1, 1, 8), C.stone, { y: 0.16, z: -8 })]), { cap: 80, ink: 0.03, anim: 'rise' });
    b.toon('bush', merge(bushParts({ r: 0.85, lo: C.bushLo, hi: C.bushHi })), { cap: 300, anim: 'pop', marks: [2.2, 1.6], wobble: [0.006, 0, 1.4, 0] });
    b.toon('houseA', houseGeo({ w: 2.9, h: 5.0, d: 3.0, roofH: 1.9, floors: 2, cols: 2, lit: 0.25, chimney: true, seed: 11 }), { cap: 80, anim: 'pop', marks: [1, 1] });
    b.toon('houseB', houseGeo({ w: 3.8, h: 4.1, d: 3.3, roofH: 2.0, floors: 2, cols: 3, lit: 0.3, chimney: false, seed: 23 }), { cap: 80, anim: 'pop', marks: [1, 1] });
    b.toon('cypress', merge(cypressParts({ h: 9.6, r: 1.5, lo: C.leafLo, hi: C.leafHi, trunk: C.trunk, seg: 9 })), { cap: 420, anim: 'pop', marks: [3, 2.6], wobble: [0.0007, 0, 1.2, 0], ink: 0.05 });
    b.toon('cypressFar', merge(cypressParts({ h: 9.6, r: 1.5, lo: C.leafLo, hi: C.leafHi, trunk: C.trunk, seg: 7, mark: 0.6 })), { cap: 260, anim: 'pop', marks: [3, 2.6], ink: 0 });
    b.toon('lamp', merge(lanternPostParts({ h: 3.1, pole: C.frame })), { cap: 40, anim: 'pop' });
    b.glow('glow', { cap: 60, anim: 'pop' });
    b.toon('flowers', merge([
      part(P.sphere(0.32, 8, 6), C.bushLo, { y: 0.2, sy: 0.6, mark: 0.6 }),
      part(P.sphere(0.09, 6, 4), '#ffffff', { x: 0.15, y: 0.42, outline: 0.5 }),
      part(P.sphere(0.09, 6, 4), '#ffe36a', { x: -0.12, y: 0.4, z: 0.1, outline: 0.5 }),
      part(P.sphere(0.09, 6, 4), '#ffb3c8', { x: 0.02, y: 0.44, z: -0.14, outline: 0.5 }),
    ]), { cap: 440, anim: 'pop', marks: [2, 2] });
    b.toon('pot', merge(potParts({ r: 0.4, h: 0.62 }).concat(bushParts({ r: 0.38 }).map((g) => g.translate(0, 0.5, 0)))), { cap: 80, anim: 'pop', marks: [2, 2] });
    b.shadow('shadow', { cap: 520, anim: 'pop' });
    b.beam('shaft', merge(shaftParts({ len: 17, r0: 0.5, r1: 1.3, dir: SUN })), { cap: 90, anim: 'pop' });
    b.toon('blossomTree', merge(roundTreeParts({ r: 2.1, trunkH: 2.3, lo: '#e07aa0', hi: '#ffd6e4', trunk: '#5a3a2a' })), { cap: 160, anim: 'pop', marks: [2.4, 2], wobble: [0.003, 0, 1.1, 0] });
    b.toon('flowerBed', flowerBedGeo(), { cap: 120, anim: 'pop', marks: [2, 1] });
    b.toon('giantDaisy', merge(giantFlowerParts({ h: 6.5, kind: 'daisy' })), { cap: 120, anim: 'popEarly', wobble: [0.0025, 0, 0.9, 0] });
    b.toon('giantTulip', merge(giantFlowerParts({ h: 5.2, kind: 'tulip' })), { cap: 120, anim: 'popEarly', wobble: [0.003, 0, 1.0, 0] });

    // obstacles
    b.toon('hedge', hedgeGeo(1.9), { cap: 24, anim: 'popEarly', marks: [1, 1] });
    b.toon('hedgeWide', hedgeGeo(7.6), { cap: 10, anim: 'popEarly', marks: [1, 1] });
    b.toon('crates', cratesGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('sign', signGeo(), { cap: 24, anim: 'popEarly', marks: [2, 2] });
    b.toon('pergola', pergolaGeo(), { cap: 10, anim: 'popEarly', marks: [2.2, 1.6] });
    b.toon('cart', cartGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('topiary', topiaryGeo(), { cap: 24, anim: 'popEarly', marks: [3, 2.6] });

    // threshold
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, marks: [1, 1], ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'hedge', len: 0.9 }, { name: 'crates', len: 0.9 }],
    H: [{ name: 'sign', len: 0.35 }],
    W: [{ name: 'cart', len: 3.0 }, { name: 'topiary', len: 1.5 }],
    LW: { name: 'hedgeWide', len: 0.9 },
    HW: { name: 'pergola', len: 0.4 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0);
    ctx.put('grass', 0, 0, 0);
    if (ctx.continuation) {
      // behind the gate only the treetops show above the hedge
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const sc = rng.float(1.4, 2.4);
          ctx.put('cypressFar', s * rng.float(8, 40), 0, rng.float(0, 16), { s: sc, sy: sc * rng.float(1.05, 1.3), c: [rng.float(0.7, 0.85), rng.float(0.84, 0.92), rng.float(0.76, 0.86)] });
        }
      }
      return;
    }
    for (const s of [-1, 1]) {
      ctx.put('curb', s * 4.62, 0, 0);
      const lampHere = (ctx.index + (s > 0 ? 1 : 0)) % 3 === 0;
      // hedge balls along the lane
      for (let i = 0; i < 4; i++) {
        const dz = 1.5 + i * 3.8 + rng.float(-0.6, 0.6);
        if (lampHere && Math.abs(dz - 8) < 1.6) continue;
        const sc = rng.float(0.75, 1.2);
        const tone = rng.float(0.88, 1.08);
        ctx.put('bush', s * rng.float(5.35, 5.9), 0, dz, { s: sc, ry: rng.float(0, 6.28), c: [tone, 1, tone * 0.95] });
      }
      if (lampHere) {
        ctx.put('lamp', s * 5.05, 0, 8, { ry: rng.float(0, 1) });
        ctx.put('glow', s * 5.05, 3.3, 8, { s: 2.2, c: [1, 0.78, 0.4] });
      }
      // houses facing the lane
      {
        let dz = rng.float(0.5, 3);
        while (dz < 15) {
          const wide = rng.chance(0.4);
          const tint = mix(rng.pick(HOUSE_TINTS), '#ffffff', rng.float(0, 0.12));
          const x = s * (wide ? rng.float(10.2, 11.4) : rng.float(9.6, 10.8));
          ctx.put(wide ? 'houseB' : 'houseA', x, 0, dz + (wide ? 1.8 : 1.6), { ry: rng.float(-0.16, 0.16), c: tint, s: rng.float(0.92, 1.06) });
          ctx.put('shadow', x + s * 0.6, 0.03, dz + 1.8, { sx: wide ? 5.6 : 4.6, sz: 4.8 });
          if (rng.chance(0.5)) ctx.put('pot', s * (x * s - (wide ? 2.3 : 1.8)), 0, dz + 3.1 + rng.float(0, 0.8), { s: rng.float(0.8, 1.1) });
          const gap = wide ? rng.float(5.8, 7.6) : rng.float(4.8, 6.6);
          // a cypress (or, on later laps, a blossom tree) in the gap between houses
          if (ctx.visit >= 1 && rng.chance(0.35)) {
            ctx.put('blossomTree', s * rng.float(8.8, 9.6), 0, dz + gap - 0.6, { s: rng.float(0.8, 1.0), c: mix(rng.pick(BLOSSOM), '#ffffff', 0.35), ry: rng.float(0, 6.28) });
          } else if (rng.chance(0.65)) {
            const sc = rng.float(1.0, 1.35);
            ctx.put('cypress', s * rng.float(8.6, 9.6), 0, dz + gap - 0.6, { s: sc * 0.8, sy: sc, c: [rng.float(0.98, 1.1), 1, rng.float(0.9, 1)] });
            ctx.put('shadow', s * 9.1, 0.03, dz + gap - 0.6, { sx: 2.6, sz: 2.6 });
          }
          dz += gap;
        }
      }
      // flowers in the verge (a lot more of them on later laps)
      const blooms = ctx.visit >= 1 ? 6 : 2;
      for (let i = 0; i < blooms; i++) {
        ctx.put('flowers', s * rng.float(6.2, 7.8), 0, rng.float(0, 16), { s: rng.float(0.8, 1.4), ry: rng.float(0, 6.28) });
      }
      // sun shafts slanting down between the trees
      if (rng.chance(0.55)) ctx.put('shaft', s * rng.float(6.5, 12), 6.2, rng.float(2, 14), { c: [rng.float(0.6, 1), 1, 1], s: rng.float(0.8, 1.25) });
      if (ctx.visit >= 1) {
        // flower beds along the verge, blossom trees among the cypresses
        ctx.put('flowerBed', s * 7.05, 0, rng.float(4, 12), { ry: rng.float(-0.1, 0.1), s: rng.float(0.9, 1.15) });
        if (rng.chance(0.6)) ctx.put('blossomTree', s * rng.float(12.5, 16), 0, rng.float(0, 16), { s: rng.float(0.9, 1.3), c: mix(rng.pick(BLOSSOM), '#ffffff', 0.4), ry: rng.float(0, 6.28) });
      }
      if (ctx.visit >= 2 && rng.chance(0.75)) {
        // giant flowers towering over the lane from the verge
        const tulip = rng.chance(0.45);
        ctx.put(tulip ? 'giantTulip' : 'giantDaisy', s * rng.float(7.6, 8.8), 0, rng.float(0, 16), { s: rng.float(0.75, 1.15), c: rng.pick(PETALS), ry: (s > 0 ? -1 : 1) * rng.float(0.9, 1.3) });
      }
      // cypress layers rising behind the houses: near / mid (inked), far (no ink)
      for (let i = 0; i < 2; i++) {
        const x = s * rng.float(12.8, 15.5);
        const sc = rng.float(1.15, 1.55);
        const c = ctx.visit >= 3 && rng.chance(0.5) ? rng.pick([[0.7, 0.95, 1.25], [1.2, 0.85, 1.15], [1.15, 1.05, 0.7]]) : [rng.float(0.92, 1.06), 1, rng.float(0.86, 0.98)];
        ctx.put('cypress', x, 0, rng.float(0, 16), { s: sc, sy: sc * rng.float(1, 1.2), c });
      }
      for (let i = 0; i < 2; i++) {
        const x = s * rng.float(17, 26);
        const sc = rng.float(1.4, 2.0);
        ctx.put('cypress', x, 0, rng.float(0, 16), { s: sc, sy: sc * rng.float(1.05, 1.3), c: [rng.float(0.74, 0.86), rng.float(0.86, 0.94), rng.float(0.78, 0.9)] });
      }
      for (let i = 0; i < 2; i++) {
        const x = s * rng.float(29, 70);
        const sc = rng.float(1.9, 2.8);
        ctx.put('cypressFar', x, 0, rng.float(0, 16), { s: sc, sy: sc * rng.float(1.05, 1.35), c: [rng.float(0.56, 0.7), rng.float(0.74, 0.82), rng.float(0.7, 0.8)] });
      }
    }
  },
};
