import {
  P, part, merge, mix, scaleColor,
  roundTreeParts, lanternPostParts, gateFrameParts, gateLeafParts, gateTop,
} from './shapes.js';
import { skyLanternParts, balloonParts, lampConeParts } from './whimsy.js';
import { crystal, topazPrism, nugget, cube, point } from './gems.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';

// III · The Night Rooftops — a slate walkway across the roofs of a sleeping
// city: navy houses with warm windows, chimney pots, a crescent moon, stars
// and strings of little lights. High-contrast night: hard moonlight from
// ahead rims every silhouette, lamps pour warm cones onto the slates, and fog
// pools in the streets below. Returns bring sky lanterns, a huge moon, and a
// purple night of drifting balloons.

const C = {
  roofLo: '#2a3f70',
  roof: '#3d5794',
  parapet: '#33467c',
  coping: '#6076b0',
  brick: '#6a3f58',
  brickHi: '#8a5470',
  pot: '#c86a3c',
  lit: ['#ffcf6b', '#ffb347', '#ffe39a', '#ffd88a'],
  unlit: '#15204a',
  frame: '#1a2550',
  pole: '#121a38',
  glassLamp: '#ffd27a',
  cream: '#d8cfa8',
  wood: '#5a4a6a',
};
const BODY_TINTS = ['#26386c', '#2d4279', '#1f2f5f', '#35487f', '#3b4f8a', '#2a3d74', '#40548f'];
const CLOTHES = ['#f4efe2', '#f2a7a0', '#9fd3e6', '#f7d36b', '#b8e0a6', '#e9b8f0', '#ffffff'];

// The golds — honey, brass and amber, the warm colours that sing against the
// night blue. Topaz above all: like the best one in a mineral drawer, a long
// lozenge prism under a wedge-and-pyramid tip, broken off at its foot where
// it grew from the rock, leaning. Mixed in: rough topaz nuggets, brassy
// pyrite cubes grown through each other, citrine points smoky at the foot,
// and smooth amber with dark specks caught inside. A great topaz with a
// second grown from its foot for the prize spots. They twinkle a little
// quicker than the other worlds' gems.
const TOPAZ = { bands: 0.25, bandFreq: 10, second: '#fff0a0', mottle: 0.35, rough: 0.35, speckle: 0.08 };
const GEM = {
  name: 'topaz',
  color: '#ffb52e',
  stones: [
    {
      name: 'topaz',
      weight: 3,
      tints: ['#ffb52e', '#ffc94a', '#ffa02a'],
      parts: () => [crystal(topazPrism({ w: 0.12, top: 0.3, foot: 0.28, seed: 2 }), { rz: 0.35 })],
      texture: TOPAZ,
    },
    {
      name: 'topaz nugget',
      weight: 1.2,
      tints: ['#ffb52e', '#ffc04a', '#f6a024'],
      parts: () => [crystal(nugget({ r: [0.23, 0.2, 0.19], faces: 12, spread: 0.22, chips: 3, seed: 7 }))],
      texture: { veins: 0.4, mottle: 0.45, second: '#ffe08a', rough: 0.4, speckle: 0.1 },
    },
    {
      // fool's gold: brassy cubes grown through each other, striated
      name: 'pyrite',
      weight: 1.2,
      tints: ['#d6b044', '#e2c056', '#c8a03a'],
      parts: () => [
        crystal(cube({ s: 0.15, seed: 2 }), { ry: 0.4, rx: 0.25 }),
        crystal(cube({ s: 0.11, seed: 3 }), { x: 0.16, y: 0.09, z: 0.05, ry: 1.0, rz: 0.4 }),
        crystal(cube({ s: 0.09, seed: 4 }), { x: -0.15, y: -0.08, z: 0.07, ry: -0.3, rx: 0.6 }),
      ],
      texture: { opaque: 0.85, metal: 0.8, bands: 0.3, bandFreq: 70, second: '#7a5a1c', speckle: 0.15, rough: 0.4, glints: 1.6 },
    },
    {
      // a quartz point, smoky orange at its foot clearing to gold at the tip
      name: 'citrine',
      weight: 1,
      tints: ['#ffc43a', '#ffb02a'],
      parts: () => [crystal(point({ r: 0.1, len: 0.2, tip: 0.17, foot: 0.24, seed: 5 }), { rz: 0.25 })],
      texture: { bands: 0.45, bandFreq: 4, second: '#b8560c', mottle: 0.3, rough: 0.2 },
    },
    {
      // a smooth honey pebble with dark specks caught inside
      name: 'amber',
      weight: 0.9,
      tints: ['#ff9418', '#ffa62c', '#f08410'],
      parts: () => [crystal(nugget({ r: [0.22, 0.17, 0.19], faces: 36, spread: 0.05, chips: 1, seed: 17 }))],
      texture: { speckle: 0.35, second: '#6a2c06', mottle: 0.5, rough: 0.1, glints: 0.8 },
    },
  ],
  crown: {
    name: 'topaz',
    tints: ['#ffb52e', '#ffc94a', '#ffa02a'],
    parts: () => [
      crystal(topazPrism({ w: 0.15, top: 0.36, foot: 0.32, seed: 4 }), { rz: 0.3 }),
      crystal(topazPrism({ w: 0.08, top: 0.2, foot: 0.17, seed: 5 }), { rz: -0.55, x: 0.12, y: -0.14 }),
    ],
    texture: TOPAZ,
  },
  motion: [1.5, 2.0, 0.06, 0.18],
  look: [0.8, 1.15, 0.25, 0.4],
  glow: 0.6,
  pool: 0.5,
};

const OPENING = { halfW: 4.6, rectH: 11.4, arch: false };
const GATE_DEPTH = 1.6;

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// Tall building whose roofline sits at local y = 0 (body hangs down 40m),
// so instances can be raised/lowered without stretching the windows.
function buildingGeo({ w, d, roof, seed, litChance = 0.45, chimney = true, tank = false }) {
  const rnd = seeded(seed);
  const parts = [part(P.box(w, 40, d), '#ffffff', { y: -20, tint: 1 })];
  parts.push(part(P.box(w + 0.2, 0.3, d + 0.2), scaleColor(C.coping, 0.8), { y: -0.15 }));
  if (roof === 'gable') {
    parts.push(part(P.prism(w + 0.5, w * 0.5, d + 0.4), null, { y: 0, grad: [C.roofLo, C.roof, 0, w * 0.5] }));
  } else if (roof === 'mansard') {
    parts.push(part(P.box(w - 0.6, 2.2, d - 0.6), C.roof, { y: 1.1 }));
    parts.push(part(P.prism(w + 0.3, 1.2, d + 0.3), C.roofLo, { y: 2.2 }));
    for (const x of [-w / 4, w / 4]) {
      parts.push(part(P.box(0.9, 1.0, 0.5), C.roofLo, { x, y: 1.3, z: d / 2 - 0.15 }));
      const lit = rnd() < litChance;
      parts.push(part(P.box(0.55, 0.65, 0.12), lit ? C.lit[0] : C.unlit, { x, y: 1.3, z: d / 2 + 0.12, emit: lit ? 1 : 0, outline: 0.4 }));
    }
  } else {
    parts.push(part(P.box(w, 0.6, d), C.parapet, { y: 0.3 }));
    if (tank) {
      parts.push(part(P.cyl(0.8, 0.8, 1.5, 10), C.wood, { x: w * 0.2, y: 1.6, z: -d * 0.1 }));
      parts.push(part(P.cone(0.95, 0.6, 10), C.roofLo, { x: w * 0.2, y: 2.65, z: -d * 0.1 }));
      for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        parts.push(part(P.box(0.08, 0.9, 0.08), C.pole, { x: w * 0.2 + lx, y: 0.45, z: -d * 0.1 + lz }));
      }
    }
  }
  if (chimney) {
    const cx = (rnd() - 0.5) * w * 0.5;
    parts.push(part(P.box(0.7, 2.6, 0.7), C.brick, { x: cx, y: 1.3, z: -d * 0.2 }));
    parts.push(part(P.box(0.82, 0.18, 0.82), C.brickHi, { x: cx, y: 2.6, z: -d * 0.2 }));
    parts.push(part(P.cyl(0.13, 0.15, 0.4, 8), C.pot, { x: cx - 0.15, y: 2.9, z: -d * 0.2 }));
    parts.push(part(P.cyl(0.13, 0.15, 0.32, 8), C.pot, { x: cx + 0.17, y: 2.86, z: -d * 0.2 }));
  }
  // window grid on the three faces you can see
  const floors = 4;
  const cols = Math.max(2, Math.round(w / 1.6));
  const colsSide = Math.max(2, Math.round(d / 1.7));
  for (let f = 0; f < floors; f++) {
    const y = -1.6 - f * 2.6;
    const fade = f >= 3 ? 0.5 : 1;
    const win = (x, z, ry) => {
      const lit = rnd() < litChance * fade;
      const col = lit ? C.lit[Math.floor(rnd() * C.lit.length)] : C.unlit;
      parts.push(part(P.box(0.7, 1.15, 0.12), col, { x, y, z, ry, emit: lit ? 1 : 0, outline: 0.45 }));
    };
    for (let c = 0; c < cols; c++) win((c - (cols - 1) / 2) * (w / cols), d / 2 + 0.03, 0);
    for (let c = 0; c < colsSide; c++) {
      const z = (c - (colsSide - 1) / 2) * (d / colsSide);
      win(w / 2 + 0.03, z, Math.PI / 2);
      win(-w / 2 - 0.03, z, Math.PI / 2);
    }
  }
  return merge(parts);
}

function skylineGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  let x = -14;
  while (x < 14) {
    const w = 3 + rnd() * 4;
    const h = 6 + rnd() * 12;
    parts.push(part(P.box(w, h + 30, 4), '#ffffff', { x: x + w / 2, y: (h - 30) / 2, tint: 1 }));
    if (rnd() < 0.6) parts.push(part(P.prism(w + 0.3, w * 0.45, 4.2), '#ffffff', { x: x + w / 2, y: h, tint: 1 }));
    for (let i = 0; i < 4; i++) {
      if (rnd() < 0.55) {
        parts.push(part(P.box(0.7, 1.0, 0.1), C.lit[Math.floor(rnd() * 4)], { x: x + 0.8 + rnd() * (w - 1.6), y: h - 2 - rnd() * (h - 2), z: 2.05, emit: 1, outline: 0 }));
      }
    }
    x += w + rnd() * 1.5;
  }
  return merge(parts);
}

function domeGeo() {
  const parts = [
    part(P.box(20, 40, 20), '#2d4279', { y: -6 }),
    part(P.cyl(7.5, 7.5, 6, 20), '#3b4f8a', { y: 17 }),
    part(P.sphere(8, 20, 12, 0), null, { y: 20, grad: ['#2a3f70', '#5a72b0', 20, 28] }),
    part(P.cyl(1.2, 1.4, 3, 10), '#3b4f8a', { y: 28.8 }),
    part(P.cone(1.3, 2.2, 10), '#5a72b0', { y: 31.4 }),
  ];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(part(P.box(0.9, 2.2, 0.2), C.lit[i % 4], { x: Math.sin(a) * 7.55, y: 17, z: Math.cos(a) * 7.55, ry: a, emit: 1, outline: 0.4 }));
  }
  return merge(parts);
}

function walkwayWallsGeo() {
  // The walkway sits on a long building: side walls drop into the dark,
  // a low parapet with coping runs along the edge.
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.5, 30, 16, 1, 1, 8), '#24366a', { x: s * 4.65, y: -15, z: -8 }));
    parts.push(part(P.box(0.45, 0.62, 16, 1, 1, 8), C.parapet, { x: s * 4.62, y: 0.31, z: -8 }));
    parts.push(part(P.box(0.6, 0.14, 16, 1, 1, 8), C.coping, { x: s * 4.62, y: 0.68, z: -8 }));
  }
  return merge(parts);
}

function lightsGeo() {
  const parts = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = -4.7 + 9.4 * t;
    const y = 5.6 - Math.sin(t * Math.PI) * 0.9;
    parts.push(part(P.sphere(0.09, 6, 4), C.lit[i % 4], { x, y, emit: 1, outline: 0 }));
    if (i < n - 1) {
      const x2 = -4.7 + 9.4 * ((i + 1) / (n - 1));
      const y2 = 5.6 - Math.sin(((i + 1) / (n - 1)) * Math.PI) * 0.9;
      const len = Math.hypot(x2 - x, y2 - y);
      parts.push(part(P.box(len, 0.025, 0.025), '#0b1030', { x: (x + x2) / 2, y: (y + y2) / 2 + 0.08, rz: Math.atan2(y2 - y, x2 - x), outline: 0 }));
    }
  }
  for (const s of [-1, 1]) parts.push(part(P.box(0.1, 5.8, 0.1), C.pole, { x: s * 4.75, y: 2.9 }));
  return merge(parts);
}

// --- obstacles --------------------------------------------------------------
function skylightGeo() {
  return merge([
    part(P.box(1.9, 0.5, 1.3), C.parapet, { y: 0.25 }),
    part(P.box(1.98, 0.1, 1.38), C.coping, { y: 0.52 }),
    part(P.prism(1.7, 0.36, 1.1), '#9fc2ff', { y: 0.57, emit: 0.6, outline: 0.6 }),
  ]).translate(0, 0, -0.65);
}

function chimneyPotsGeo() {
  const parts = [
    part(P.box(1.9, 0.52, 0.7), C.brick, { y: 0.26 }),
    part(P.box(2.0, 0.1, 0.8), C.brickHi, { y: 0.55 }),
  ];
  for (const x of [-0.6, 0, 0.6]) parts.push(part(P.cyl(0.15, 0.18, 0.36, 8), C.pot, { x, y: 0.78 }));
  return merge(parts).translate(0, 0, -0.35);
}

// the washing line's height, and the breeze in the washing: [how far a hem
// sways, how fast, the line's height, how far the washing hangs below it]
const LINE = 2.35;
const BREEZE = [0.13, 1.25, LINE, LINE - CONFIG.duckLine];

// Mark a finished part as washing (uv: its own beat in x, 1 in y) for the
// breeze in the shader (toon option `cloth`), or as something that stays put.
function hung(g, beat) {
  const uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = beat;
    uv[i + 1] = beat < 0 ? 0 : 1;
  }
  return g;
}
const still = (g) => hung(g, -1);

// Drape a garment pegged at x = cx between top and bottom: soft folds running
// down it, deeper toward the hem; its top sagging between the pegs and its
// corners drooping beyond them; the hem a little uneven (only ever lifted, so
// it never hangs below the duck line) and flaring out a touch.
function drape(g, { cx, top, bottom, w, seed }) {
  const pos = g.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    const u = (pos[i] - cx) / (w / 2);
    const k = Math.min(1, Math.max(0, (top - pos[i + 1]) / (top - bottom)));
    const near = (1 - k) * (1 - k);
    pos[i + 2] += 0.032 * Math.sin(u * Math.PI * 1.6 + seed * 6.28) * (0.3 + 0.7 * k);
    pos[i + 1] -= 0.05 * Math.max(0, 1 - (u / 0.6) ** 2) * near * near + 0.05 * Math.max(0, Math.abs(u) - 0.6) * near;
    pos[i + 1] += 0.025 * (0.5 + 0.5 * Math.sin(u * 4.7 + seed * 11)) * k ** 6;
    pos[i] += (pos[i] - cx) * 0.07 * k * k;
  }
  g.computeVertexNormals();
  return g;
}

function laundryGeo(half, count, seed) {
  // Washing line between two poles. Every garment hangs to the duck line so the
  // laundry reads as one band to slide under, with the slates showing beneath.
  // The washing is soft cloth: draped in folds, and stirring in the breeze
  // (see `cloth` in build).
  const rnd = seeded(seed);
  const D = CONFIG.duckLine;
  const line = LINE;
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(still(part(P.box(0.12, line + 0.3, 0.12), C.pole, { x: s * half, y: (line + 0.3) / 2 })));
    parts.push(still(part(P.box(0.4, 0.08, 0.08), C.pole, { x: s * (half - 0.12), y: line + 0.15 })));
  }
  parts.push(still(part(P.box(half * 2, 0.03, 0.03), '#e8e2d0', { y: line, outline: 0 })));
  const span = half * 2 - 0.4;
  const slot = span / count;
  for (let i = 0; i < count; i++) {
    const x = -span / 2 + slot * (i + 0.5);
    const col = CLOTHES[Math.floor(rnd() * CLOTHES.length)];
    const kind = rnd();
    const w = Math.min(0.8, slot * 0.92);
    const bottom = D + 0.02 + rnd() * 0.05;
    const top = line - 0.04;
    const beat = rnd();
    const fold = { cx: x, top, bottom, w, seed: rnd() };
    const cloth = (geo, c, o) => parts.push(hung(drape(part(geo, c, o), fold), beat));
    if (kind < 0.4) {
      // long nightshirt with sleeves
      cloth(P.box(w * 0.72, top - 0.08 - bottom, 0.04, 5, 7), col, { x, y: (top - 0.08 + bottom) / 2 });
      cloth(P.box(w, 0.22, 0.05, 7, 2), col, { x, y: top - 0.12 });
    } else if (kind < 0.8) {
      // sheet, with a darker hem stripe
      cloth(P.box(w, top - bottom, 0.035, 7, 8), col, { x, y: (top + bottom) / 2 });
      cloth(P.box(w + 0.01, 0.07, 0.045, 7, 1), scaleColor(col, 0.78), { x, y: bottom + 0.09, outline: 0 });
    } else {
      // long johns
      const lw = w * 0.36;
      cloth(P.box(w * 0.8, 0.26, 0.05, 6, 2), col, { x, y: top - 0.13 });
      cloth(P.box(lw, top - 0.2 - bottom, 0.045, 2, 6), col, { x: x - w * 0.2, y: (top - 0.2 + bottom) / 2 });
      cloth(P.box(lw, top - 0.2 - bottom, 0.045, 2, 6), col, { x: x + w * 0.2, y: (top - 0.2 + bottom) / 2 });
    }
    parts.push(still(part(P.box(0.05, 0.1, 0.07), '#c8a070', { x: x - w * 0.3, y: line - 0.02, outline: 0 })));
    parts.push(still(part(P.box(0.05, 0.1, 0.07), '#c8a070', { x: x + w * 0.3, y: line - 0.02, outline: 0 })));
  }
  return merge(parts).translate(0, 0, -0.1);
}
function parapetWallGeo() {
  const parts = [
    part(P.box(7.8, 0.72, 0.6), C.brick, { y: 0.36 }),
    part(P.box(7.95, 0.14, 0.72), C.brickHi, { y: 0.79 }),
  ];
  for (let i = 0; i < 6; i++) parts.push(part(P.cyl(0.13, 0.15, 0.22, 8), C.pot, { x: -3.3 + i * 1.32, y: 0.97 }));
  return merge(parts).translate(0, 0, -0.3);
}

function chimneyStackGeo() {
  const parts = [
    part(P.box(1.5, 3.0, 1.2), C.brick, { y: 1.5 }),
    part(P.box(1.66, 0.2, 1.36), C.brickHi, { y: 3.1 }),
    part(P.box(1.56, 0.12, 1.26), C.brickHi, { y: 1.2 }),
  ];
  for (const x of [-0.42, 0.05, 0.48]) parts.push(part(P.cyl(0.17, 0.2, 0.5 + Math.abs(x) * 0.3, 8), C.pot, { x, y: 3.45 }));
  return merge(parts).translate(0, 0, -0.6);
}

function waterTankGeo() {
  const parts = [part(P.cyl(0.88, 0.88, 1.9, 12), C.wood, { y: 1.5 })];
  for (const y of [0.85, 1.5, 2.15]) parts.push(part(P.cyl(0.92, 0.92, 0.07, 12), C.pole, { y }));
  parts.push(part(P.cone(1.02, 0.7, 12), C.roofLo, { y: 2.8 }));
  for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) parts.push(part(P.box(0.1, 0.6, 0.1), C.pole, { x, y: 0.3, z }));
  parts.push(part(P.box(1.6, 0.1, 1.6), C.pole, { y: 0.56 }));
  return merge(parts).translate(0, 0, -0.9);
}

function shedGeo() {
  const parts = [
    part(P.box(1.9, 2.3, 2.6), '#33467f', { y: 1.15 }),
    part(P.prism(2.3, 0.7, 2.9), C.roof, { y: 2.3 }),
    part(P.box(0.7, 0.6, 0.1), C.lit[1], { x: 0.4, y: 1.5, z: 1.32, emit: 1, outline: 0.4 }),
    part(P.box(0.78, 0.7, 0.08), C.frame, { x: 0.4, y: 1.5, z: 1.3 }),
    part(P.box(0.6, 1.5, 0.08), C.wood, { x: -0.45, y: 0.75, z: 1.32 }),
  ];
  return merge(parts).translate(0, 0, -1.3);
}

function gateGeo() {
  const rnd = seeded(77);
  const parts = [...gateFrameParts(OPENING, { thick: 1.1, depth: GATE_DEPTH, color: C.cream })];
  const top = gateTop(OPENING);
  parts.push(part(P.box(OPENING.halfW * 2 + 3.6, 0.6, GATE_DEPTH + 0.6), '#bdb38c', { y: top + 1.4 }));
  parts.push(part(P.prism(OPENING.halfW * 2 + 3.2, 2.4, GATE_DEPTH + 0.4), C.cream, { y: top + 1.7 }));
  parts.push(part(P.cyl(0.7, 0.7, 0.3, 16), C.lit[0], { y: top + 2.6, z: GATE_DEPTH / 2 + 0.25, rx: Math.PI / 2, emit: 1 }));
  // grand facade either side
  for (const s of [-1, 1]) {
    const w = 60;
    const x = s * (OPENING.halfW + 1.1 + w / 2 - 0.1);
    parts.push(part(P.box(w, 56, 2.2), '#22346a', { x, y: -2 }));
    parts.push(part(P.box(w, 0.8, 2.8), C.coping, { x, y: 26.2 }));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 11; c++) {
        const wx = s * (OPENING.halfW + 3.4 + c * 2.7);
        const wy = 1.8 + r * 3.0;
        const lit = rnd() < 0.42;
        parts.push(part(P.box(1.0, 1.6, 0.16), lit ? C.lit[Math.floor(rnd() * 4)] : C.unlit, { x: wx, y: wy, z: 1.15, emit: lit ? 1 : 0, outline: 0.4 }));
      }
    }
    parts.push(...lanternPostParts({ h: 3.6, pole: C.pole, glass: C.glassLamp, cap: C.pole }).map((g) => g.translate(s * (OPENING.halfW + 1.9), 0, GATE_DEPTH / 2 + 0.6)));
  }
  return merge(parts);
}

export default {
  id: 'rooftops',
  name: 'The Night Rooftops',
  doorColor: '#3a5cc0',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  continuation: false, // the facade hides everything behind the door
  env: {
    sky: ['#060e2a', '#26407a', '#0a1430'],
    bloom: ['#4a6ae8', '#ffc45a', '#ff7a6a'], // the colours its doorway bloom is made of
    sun: { dir: [0.5, 0.42, -1], glow: '#3c4c94' },
    moon: { dir: [0.5, 0.42, -1], color: '#fbe9b0', size: 0.05 },
    stars: 1,
    skyFx: { clouds: 0.16 },
    // harsh moonlight from ahead: faces toward you fall into deep blue
    light: { dir: [0.45, 0.62, -0.65], shadow: [0.44, 0.5, 0.82], hi: [1.2, 1.2, 1.35], soft: 0.01, wrap: 0, hiAmt: 0.75, lift: 0.8 },
    rim: [0.55, 0.68, 1.0, 0.34],
    mist: { color: '#16285a', amount: 0.8, top: -1.5, fade: 9, near: 14, far: 70 },
    grade: { sat: 1.12, contrast: 1.1, vignette: 0.5, exposure: 1.04, tint: '#030820' },
    beam: { color: '#ffc870', amount: 0.34 },
    pool: '#ffa040',
    ink: '#060b22',
    fog: [36, 185],
    ground: ['#2e3c68', '#27345c', '#151d3c'],
    shadowDecal: [0.46, 0.5, 0.72],
    cast: [-0.7, 1.0],
    glowGain: 1.0,
    particles: { color: '#cfd9ff', size: 1.8, drift: [0.15, -0.35, 0], opacity: 0.7 },
  },

  visits: [
    { env: { skyFx: { aurora: 0.22 }, glowGain: 1.15 } },
    {
      env: {
        sky: ['#0a1838', '#3a5a9a', '#0e1a3a'],
        moon: { dir: [0.35, 0.3, -1], color: '#ffe6b0', size: 0.15 },
        sun: { dir: [0.35, 0.3, -1], glow: '#8a8ad0' },
        rim: [0.8, 0.85, 1.0, 0.36],
        skyFx: { aurora: 0.5, clouds: 0.22 },
        particles: { color: '#ffe6a8', size: 2.2, drift: [0.1, 0.4, 0], opacity: 0.85 },
      },
    },
    {
      env: {
        sky: ['#170830', '#7a3aa0', '#120624'],
        sun: { glow: '#c060c0' },
        moon: { color: '#ffd0f0' },
        light: { shadow: [0.5, 0.4, 0.82], hi: [1.25, 1.15, 1.35] },
        rim: [0.95, 0.6, 1.0, 0.36],
        mist: { color: '#3a1a5a' },
        grade: { tint: '#14042a' },
        skyFx: { aurora: 0.6 },
        trip: [0.06, 0.3, 0.12],
      },
    },
  ],

  build(b) {
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 2);
    b.toon('void', groundStrip(420, 16, '#0c1636', 8, { y: -28 }), { ink: 0, cap: 40 });
    b.toon('walls', walkwayWallsGeo(), { cap: 40, ink: 0.035, anim: 'rise' });
    b.toon('bldgGable', buildingGeo({ w: 5, d: 6, roof: 'gable', seed: 3 }), { cap: 120, anim: 'lift' });
    b.toon('bldgMansard', buildingGeo({ w: 7.5, d: 7, roof: 'mansard', seed: 9 }), { cap: 120, anim: 'lift' });
    b.toon('bldgFlat', buildingGeo({ w: 6.2, d: 6.5, roof: 'flat', seed: 17, tank: true, chimney: false }), { cap: 120, anim: 'lift' });
    b.toon('skyline', skylineGeo(5), { cap: 120, anim: 'liftFar', ink: 0 });
    b.toon('dome', domeGeo(), { cap: 12, anim: 'liftFar', ink: 0.08 });
    b.toon('tree', merge(roundTreeParts({ r: 1.6, trunkH: 1.4, lo: '#173c52', hi: '#3c7a8a', trunk: '#1a2440' })), { cap: 80, anim: 'lift', marks: [2.2, 2], wobble: [0.004, 0, 1.1, 0] });
    b.toon('lamp', merge(lanternPostParts({ h: 3.4, pole: C.pole, glass: C.glassLamp, cap: C.pole })), { cap: 40, anim: 'pop' });
    b.toon('lights', lightsGeo(), { cap: 24, anim: 'popLate', ink: 0.02 });
    b.glow('glow', { cap: 120, anim: 'pop' });
    b.shadow('shadow', { cap: 200, anim: 'pop' });
    b.beam('lampCone', merge(lampConeParts({ top: 4.2, r0: 0.16, r1: 1.9 })), { cap: 40, anim: 'pop' });
    b.pool('pool', { cap: 40, anim: 'pop' });
    b.toon('skyLantern', merge(skyLanternParts()), { cap: 200, anim: 'lift', fly: [0, 0, 1.4, 0.22], ink: 0.03 });
    b.toon('balloon', merge(balloonParts()), { cap: 30, anim: 'liftFar', fly: [0, 0, 2.5, 0.12] });

    b.toon('skylight', skylightGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('chimneyPots', chimneyPotsGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('laundry', laundryGeo(0.98, 2, 4), { cap: 24, anim: 'popEarly', cloth: BREEZE });
    b.toon('laundryWide', laundryGeo(3.95, 9, 8), { cap: 10, anim: 'popEarly', cloth: BREEZE });
    b.toon('parapetWall', parapetWallGeo(), { cap: 10, anim: 'popEarly' });
    b.toon('chimneyStack', chimneyStackGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('waterTank', waterTankGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('shed', shedGeo(), { cap: 24, anim: 'popEarly' });

    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'skylight', len: 1.3 }, { name: 'chimneyPots', len: 0.7 }],
    H: [{ name: 'laundry', len: 0.25 }],
    W: [{ name: 'chimneyStack', len: 1.2 }, { name: 'waterTank', len: 1.8 }, { name: 'shed', len: 2.6 }],
    LW: { name: 'parapetWall', len: 0.6 },
    HW: { name: 'laundryWide', len: 0.25 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0);
    ctx.put('void', 0, 0, 0);
    ctx.put('walls', 0, 0, 0);
    if (ctx.index % 3 === 1) {
      ctx.put('lights', 0, 0, 6);
      ctx.put('glow', -4.75, 5.8, 6, { s: 1.4, c: [1, 0.75, 0.4] });
      ctx.put('glow', 4.75, 5.8, 6, { s: 1.4, c: [1, 0.75, 0.4] });
    }
    for (const s of [-1, 1]) {
      if ((ctx.index + (s > 0 ? 1 : 0)) % 2 === 0) {
        ctx.put('lamp', s * 4.62, 0.75, 12);
        ctx.put('glow', s * 4.62, 4.4, 12, { s: 3.2, c: [1, 0.72, 0.38] });
        ctx.put('lampCone', s * 4.62, 0.05, 12, { c: [0.9, 0.9, 0.9] });
        ctx.put('pool', s * 3.5, 0.03, 12, { sx: 5.0, sz: 6.0, c: [0.85, 1, 1] });
      }
      // later laps: paper lanterns drift up over the city, then balloons
      if (ctx.visit >= 1) {
        const n = rng.int(1, ctx.visit >= 2 ? 4 : 3);
        for (let i = 0; i < n; i++) {
          ctx.put('skyLantern', s * rng.float(7, 40), rng.float(1, 16), rng.float(0, 16), { s: rng.float(0.8, 1.5), p0: rng.float(0, 6.28) });
        }
      }
      if (ctx.visit >= 3 && rng.chance(0.25)) {
        ctx.put('balloon', s * rng.float(24, 60), rng.float(4, 18), rng.float(0, 16), { c: rng.pick(['#f2a7a0', '#9fd3e6', '#f7d36b', '#b8e0a6', '#e9b8f0']), s: rng.float(1.2, 2.2) });
      }
      // near row of houses
      let dz = rng.float(0, 3);
      while (dz < 16) {
        const kind = rng.weighted([['bldgGable', 3], ['bldgMansard', 2], ['bldgFlat', 2]]);
        const depth = kind === 'bldgMansard' ? 7 : kind === 'bldgFlat' ? 6.5 : 6;
        const width = kind === 'bldgMansard' ? 7.5 : kind === 'bldgFlat' ? 6.2 : 5;
        const top = rng.float(-5.5, 4.5);
        const x = s * (5.2 + width / 2 + rng.float(0.2, 2.2));
        ctx.put(kind, x, top, dz + depth / 2, { c: mix(rng.pick(BODY_TINTS), '#ffffff', rng.float(0, 0.08)) });
        if (kind === 'bldgFlat' && rng.chance(0.6)) ctx.put('tree', x - 1.4, top + 0.3, dz + depth / 2 + 1.2, { s: rng.float(0.6, 0.85) });
        dz += depth + rng.float(0.4, 2.6);
      }
      // second row, taller
      dz = rng.float(0, 4);
      while (dz < 16) {
        const kind = rng.weighted([['bldgGable', 2], ['bldgMansard', 3], ['bldgFlat', 1]]);
        const x = s * rng.float(17, 26);
        ctx.put(kind, x, rng.float(0, 9), dz + 3, { c: scaleColor(rng.pick(BODY_TINTS), rng.float(0.8, 0.95)), s: rng.float(1, 1.25) });
        dz += rng.float(6.5, 10);
      }
      // far skyline (no ink)
      ctx.put('skyline', s * rng.float(42, 60), rng.float(-6, 2), rng.float(0, 16), { c: scaleColor(rng.pick(BODY_TINTS), 0.75), ry: rng.float(-0.3, 0.3) });
      if (rng.chance(0.4)) ctx.put('skyline', s * rng.float(70, 100), rng.float(-2, 8), rng.float(0, 16), { c: scaleColor(rng.pick(BODY_TINTS), 0.6), s: 1.4 });
    }
    if (ctx.index % 7 === 3) {
      const s = rng.sign();
      ctx.put('dome', s * rng.float(70, 110), rng.float(-8, -2), 8, {});
    }
  },
};
