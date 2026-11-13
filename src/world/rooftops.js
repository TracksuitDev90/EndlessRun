import * as THREE from '../../vendor/three/three.module.min.js';
import {
  P, part, merge, mix, scaleColor,
  roundTreeParts, lanternPostParts, gateFrameParts, gateTop, leafParts,
} from './shapes.js';
import { skyLanternParts, balloonParts, lampConeParts } from './whimsy.js';
import { crystal, topazPrism, nugget, cube, point } from './gems.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';

// IV · The Night Rooftops — New York, over the roofs at night: a tar-paper
// roof walkway behind a brick parapet with stone coping, string lights over
// it and gooseneck lamps along it; either side the roofs of tenements and
// lofts at every height, brick and limestone, cornices, windows lit warm
// (and the odd one blue with a television), air conditioners in them, iron
// fire escapes zigzagging down their fronts; water towers on stilts, stair
// bulkheads, antennas, vents, rooftop gardens, now and then a lit sign; and
// out past them, the towers of the city, every window a light, and far off
// a great art-deco spire lit up at its crown. High-contrast night: hard
// moonlight from ahead rims every silhouette, lamps pour warm cones and
// pools onto the tar, fog pools in the streets below and a warm glow of
// city light hangs along the horizon. Returns bring sky lanterns, a huge
// moon, and a purple night of drifting balloons.

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
// New York: brick and limestone, iron and tar (the buildings take their
// brick or stone as a tint)
const NY = {
  stone: '#b8ab92',
  cornice: '#7c7266',
  iron: '#15161d',
  escape: '#2c2e3a',
  tar: '#25272f',
  frame: '#1d1b22',
  tank: '#7a5e44',
  tankDark: '#4c3a2c',
  tankRoof: '#3a3036',
  ac: '#a9afb8',
  acDark: '#5e646e',
  door: '#2a2228',
  parapet: '#7a4436',
};
const BRICKS = ['#8c4a3a', '#7c3e32', '#985440', '#6e382e', '#8a5242', '#7e4a3e', '#a0604a'];
const STONES = ['#aa9c86', '#9c907e', '#b6a88e', '#8e8678'];
const TOWER_TINTS = ['#5a6078', '#4a5068', '#6a6a78', '#585a6e', '#707488'];
// lit signs on the roofs (no words, just light)
const SIGNS = [[1, 0.42, 0.5], [0.45, 0.85, 1], [1, 0.78, 0.35], [0.7, 1, 0.6]];
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

// A bar of iron from a to b (thickness t), no ink.
const _q = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
function bar(a, b, t, color) {
  const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = v.length();
  const g = part(P.box(t, len, t), color, { y: len / 2, outline: 0 });
  _q.setFromUnitVectors(_UP, v.normalize());
  g.applyQuaternion(_q);
  g.translate(a[0], a[1], a[2]);
  return g;
}

// An iron fire escape on a facade (built on a facade facing +z at z = 0,
// centred on x = 0): a landing under each floor's windows, railed, with a
// ladder slanting down from each to the one below.
function fireEscape(floors, floorH, y0, width = 2.6) {
  const parts = [];
  const dep = 0.8;
  for (let f = 0; f < floors; f++) {
    const y = y0 - f * floorH;
    parts.push(part(P.box(width, 0.06, dep), NY.escape, { y, z: dep / 2, outline: 0 }));
    // the rail round its open sides, and its balusters
    parts.push(bar([-width / 2, y + 0.95, dep], [width / 2, y + 0.95, dep], 0.05, NY.escape));
    for (const sx of [-1, 1]) parts.push(bar([sx * width / 2, y, dep], [sx * width / 2, y + 0.95, dep], 0.04, NY.escape));
    for (let k = 1; k <= 2; k++) parts.push(bar([-width / 2 + (k / 3) * width, y, dep], [-width / 2 + (k / 3) * width, y + 0.95, dep], 0.03, NY.escape));
    // the ladder down to the next landing
    if (f < floors - 1) {
      const z = dep * 0.55;
      const a = [-width / 2 + 0.25, y, z], b = [width / 2 - 0.35, y - floorH, z];
      for (const off of [-0.2, 0.2]) parts.push(bar([a[0], a[1], z + off], [b[0], b[1], z + off], 0.04, NY.escape));
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        parts.push(part(P.box(0.03, 0.03, 0.44), NY.escape, { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z, outline: 0 }));
      }
    }
  }
  return merge(parts);
}

// A New York building whose roofline sits at local y = 0 (its body hangs
// down 40 m, so instances can be raised or lowered without stretching the
// windows): brick (a tenement, a walk-up) or limestone (a loft), its brick
// or stone the instance's tint; a tar roof inside a parapet with stone
// coping; a cornice; windows floor by floor on the faces you can see - its
// front (+z) and its side toward the path (path: -1 the path is off to its
// -x, +1 its +x) - a share lit, lintels over the front ones and air
// conditioners in some (near); and iron fire escapes down its front and that
// side (near brick ones).
function nyBuildingGeo({ w, d, seed, style = 'brick', path = -1, near = true, litChance = 0.42 }) {
  const rnd = seeded(seed);
  const brick = style === 'brick';
  const mk = brick ? 0.55 : 0.25;
  const floorH = brick ? 2.9 : 3.4;
  const parts = [part(P.box(w, 40, d), '#ffffff', { y: -20, tint: 1, mark: mk })];
  parts.push(part(P.box(w - 0.3, 0.06, d - 0.3), NY.tar, { y: 0.03, outline: 0 }));
  for (const [x, z, pw, pd] of [[0, d / 2 - 0.12, w, 0.24], [0, -d / 2 + 0.12, w, 0.24], [w / 2 - 0.12, 0, 0.24, d], [-w / 2 + 0.12, 0, 0.24, d]]) {
    parts.push(part(P.box(pw, 0.8, pd), '#ffffff', { x, y: 0.4, z, tint: 1, mark: mk }));
    parts.push(part(P.box(pw + 0.14, 0.1, pd + 0.14), NY.stone, { x, y: 0.85, z, outline: 0.4 }));
  }
  const cornice = brick ? NY.cornice : NY.stone;
  parts.push(part(P.box(w + 0.6, 0.34, d + 0.6), cornice, { y: -0.4 }));
  if (near) parts.push(part(P.box(w + 0.3, 0.2, d + 0.3), cornice, { y: -0.68, outline: 0.4 }));
  const ww = brick ? 0.78 : 1.2;
  const wh = brick ? 1.4 : 1.9;
  const pitch = brick ? 1.6 : 2.2;
  const floors = near ? 4 : 3;
  const faces = [
    { n: [0, 1], len: w, at: d / 2 },
    { n: [path, 0], len: d, at: w / 2 },
  ];
  for (const F of faces) {
    const cols = Math.max(2, Math.round(F.len / pitch));
    const ry = F.n[0] !== 0 ? Math.PI / 2 : 0;
    for (let f = 0; f < floors; f++) {
      const y = -2.0 - f * floorH;
      const fade = f >= 3 ? 0.6 : 1;
      for (let c = 0; c < cols; c++) {
        const u = (c - (cols - 1) / 2) * (F.len / cols);
        const px = F.n[0] !== 0 ? F.n[0] * (F.at + 0.03) : u;
        const pz = F.n[0] !== 0 ? u : F.at + 0.03;
        const on = rnd() < litChance * fade;
        const tv = on && rnd() < 0.12;
        const col = tv ? '#9cc4ff' : on ? C.lit[Math.floor(rnd() * C.lit.length)] : C.unlit;
        parts.push(part(P.box(ww, wh, 0.12), col, { x: px, y, z: pz, ry, emit: on ? 1 : 0, outline: 0.5 }));
        if (!near) continue;
        if (F.n[1] !== 0) parts.push(part(P.box(ww + 0.26, 0.15, 0.2), NY.stone, { x: px, y: y + wh / 2 + 0.13, z: pz, outline: 0 }));
        // an air conditioner in the window, sticking out over the street
        if (rnd() < 0.16) {
          const ox = F.n[0] * 0.26, oz = F.n[1] * 0.26;
          parts.push(part(P.box(ww * 0.78, 0.42, 0.5), NY.ac, { x: px + ox, y: y - wh / 2 + 0.24, z: pz + oz, ry, outline: 0.4 }));
        }
      }
    }
  }
  if (near && brick) {
    const y0 = -2.0 - wh / 2 - 0.08;
    // down the front, and down the side toward the path
    parts.push(fireEscape(3, floorH, y0, Math.min(2.8, w * 0.42)).translate(w * 0.18, 0, d / 2));
    const g = fireEscape(3, floorH, y0, Math.min(2.8, d * 0.4));
    g.rotateY(path > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(path * w / 2, 0, -d * 0.12);
    parts.push(g);
  }
  return merge(parts);
}

// A water tower on its steel stand: a tank of cedar staves bound with iron
// hoops under a conical roof, a ladder up its side.
function waterTowerGeo() {
  const parts = [];
  const legH = 2.3;
  const r = 1.25;
  for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) parts.push(part(P.box(0.14, legH, 0.14), NY.iron, { x, y: legH / 2, z, outline: 0.4 }));
  for (const [a, b] of [[[-0.85, 0, 0.85], [0.85, legH, 0.85]], [[0.85, 0, 0.85], [-0.85, legH, 0.85]], [[-0.85, 0, -0.85], [-0.85, legH, 0.85]], [[0.85, 0, -0.85], [0.85, legH, 0.85]]]) parts.push(bar(a, b, 0.06, NY.iron));
  parts.push(part(P.box(2.3, 0.12, 2.3), NY.iron, { y: legH }));
  const tankH = 2.8;
  parts.push(part(P.cyl(r, r * 1.04, tankH, 12, 1, true), null, { y: legH + tankH / 2 + 0.06, grad: [NY.tankDark, NY.tank, legH, legH + tankH], mark: 0.9, uvScale: [6, 1] }));
  for (const t of [0.15, 0.5, 0.85]) parts.push(part(P.cyl(r * 1.05, r * 1.05, 0.06, 12, 1, true), NY.iron, { y: legH + 0.06 + tankH * t, outline: 0 }));
  parts.push(part(P.cone(r + 0.18, 1.1, 12), NY.tankRoof, { y: legH + tankH + 0.6 }));
  parts.push(part(P.sphere(0.1, 5, 3), NY.iron, { y: legH + tankH + 1.2, outline: 0 }));
  for (const off of [-0.18, 0.18]) parts.push(bar([off, 0, r + 0.12], [off, legH + tankH, r + 0.12], 0.04, NY.iron));
  return merge(parts);
}

// A stair bulkhead: a little brick house on the roof, its door toward +z, a
// lamp lit over it.
function bulkheadGeo() {
  return merge([
    part(P.box(2.2, 2.6, 2.4), '#ffffff', { y: 1.3, tint: 1, mark: 0.55 }),
    part(P.box(2.4, 0.14, 2.6), NY.stone, { y: 2.66 }),
    part(P.box(0.85, 1.9, 0.08), NY.door, { x: 0.35, y: 0.95, z: 1.22, outline: 0.4 }),
    part(P.sphere(0.07, 6, 4), C.lit[2], { x: 0.35, y: 2.15, z: 1.28, emit: 1, outline: 0 }),
  ]);
}

// A TV antenna on its mast.
function antennaGeo() {
  const parts = [bar([0, 0, 0], [0, 3.4, 0], 0.05, NY.iron)];
  for (const [y, l] of [[2.4, 1.4], [2.85, 1.1], [3.25, 0.8]]) parts.push(bar([-l / 2, y, 0], [l / 2, y, 0], 0.03, NY.iron));
  for (let k = -2; k <= 2; k++) parts.push(bar([k * 0.14, 2.4, 0], [k * 0.14, 2.4, 0.4], 0.02, NY.iron));
  return merge(parts);
}

// Roof kit: air-conditioning condensers with their fans, mushroom vents, a
// satellite dish.
function roofKitGeo() {
  const parts = [];
  for (const [x, z] of [[0, 0], [1.25, 0.1]]) {
    parts.push(part(P.box(1.1, 0.9, 1.0), NY.ac, { x, y: 0.45, z }));
    parts.push(part(P.cyl(0.38, 0.38, 0.04, 14), NY.acDark, { x, y: 0.92, z, outline: 0 }));
    parts.push(part(P.box(0.06, 0.05, 0.7), NY.iron, { x, y: 0.95, z, ry: 0.6, outline: 0 }));
  }
  for (const [x, z] of [[-1.0, -0.6], [-1.3, 0.4]]) {
    parts.push(part(P.cyl(0.08, 0.08, 0.7, 8), NY.acDark, { x, y: 0.35, z }));
    parts.push(part(P.sphere(0.18, 8, 4), NY.acDark, { x, y: 0.72, z, sy: 0.5 }));
  }
  parts.push(part(P.cyl(0.05, 0.05, 0.6, 6), NY.iron, { x: 0.6, y: 0.3, z: -0.9 }));
  parts.push(part(P.sphere(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#d8dce2', { x: 0.6, y: 0.75, z: -0.9, sy: 0.4, rx: -1.0 }));
  return merge(parts);
}

// A lit sign up on a roof: a steel frame on legs and a glowing face, the
// instance's colour, in bands (no words, just light), facing +z.
function signGeo() {
  const parts = [];
  const W = 5, H = 2.2, y0 = 1.4;
  for (const x of [-2, 2]) parts.push(part(P.box(0.12, y0 + H, 0.12), NY.iron, { x, y: (y0 + H) / 2, z: -0.3, outline: 0.3 }));
  parts.push(bar([-2, 0, -1.2], [-2, y0, -0.3], 0.08, NY.iron));
  parts.push(bar([2, 0, -1.2], [2, y0, -0.3], 0.08, NY.iron));
  parts.push(part(P.box(W + 0.2, H + 0.2, 0.15), NY.iron, { y: y0 + H / 2, z: -0.1 }));
  parts.push(part(P.box(W, H, 0.06), '#ffffff', { y: y0 + H / 2, z: 0.0, emit: 1, tint: 1, outline: 0 }));
  for (let k = 0; k < 3; k++) parts.push(part(P.box(W * (0.8 - k * 0.18), 0.22, 0.04), '#1a1620', { x: -W * 0.06 * k, y: y0 + H * (0.28 + k * 0.24), z: 0.05, outline: 0 }));
  return merge(parts);
}

// A gooseneck lamp on a pipe post at the parapet, its arm reaching in over
// the walkway (to -x), a caged bulb under its shade.
function roofLampGeo() {
  const h = 2.7;
  return merge([
    part(P.cyl(0.05, 0.065, h, 6), NY.iron, { y: h / 2 }),
    part(P.torus(0.3, 0.035, 4, 10, Math.PI), NY.iron, { x: -0.3, y: h }),
    part(P.cone(0.24, 0.2, 12), NY.iron, { x: -0.6, y: h - 0.12 }),
    part(P.sphere(0.1, 8, 6), C.glassLamp, { x: -0.6, y: h - 0.26, emit: 1, outline: 0 }),
    part(P.torus(0.12, 0.012, 3, 10), NY.iron, { x: -0.6, y: h - 0.28, rx: Math.PI / 2, outline: 0 }),
  ]);
}

// The towers of the city out past the roofs: setbacks, flat tops with their
// machinery, the odd mast with a red light, every wall a grid of windows a
// share of them lit (parts marked 0.45: see towerWindows). Tinted per
// instance.
function towersGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  let x = -16;
  while (x < 16) {
    const w = 4 + rnd() * 5;
    const d = 4 + rnd() * 4;
    let h = 14 + rnd() * 34;
    let y = -30;
    let tw = w, td = d;
    const tiers = 1 + Math.floor(rnd() * 3);
    for (let t = 0; t < tiers; t++) {
      const th = (h + 30) * (t === 0 ? 0.7 : 0.3 / (tiers - 1 || 1));
      parts.push(part(P.box(tw, th, td), '#ffffff', { x: x + w / 2, y: y + th / 2, tint: 1, mark: 0.45 }));
      y += th;
      tw *= 0.72;
      td *= 0.72;
    }
    parts.push(part(P.box(tw * 0.5, 1.6, td * 0.5), '#3a3c48', { x: x + w / 2, y: y + 0.8 }));
    if (rnd() < 0.4) {
      parts.push(part(P.cyl(0.08, 0.2, 7, 5), '#3a3c48', { x: x + w / 2, y: y + 1.6 + 3.5, outline: 0 }));
      parts.push(part(P.sphere(0.3, 6, 4), '#ff3a2a', { x: x + w / 2, y: y + 1.6 + 7, emit: 1, outline: 0 }));
    }
    x += w + 0.5 + rnd() * 2.5;
  }
  return merge(parts);
}

// The spire: an art-deco tower climbing in setbacks, ribbed up its shaft,
// its crown stepped and lit warm, a lantern and a long mast over it with a
// red light at the top.
function spireGeo() {
  const parts = [];
  let y = -40;
  for (const [w, h] of [[22, 46], [16, 20], [12, 18], [9, 26]]) {
    parts.push(part(P.box(w, h, w), '#ffffff', { y: y + h / 2, tint: 1, mark: 0.45 }));
    parts.push(part(P.box(w + 0.6, 0.6, w + 0.6), '#b0a898', { y: y + h, outline: 0.4 }));
    y += h;
  }
  // ribs up the shaft
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    for (const o of [-2.2, 0, 2.2]) {
      const px = Math.cos(a) * 4.6 - Math.sin(a) * o, pz = Math.sin(a) * 4.6 + Math.cos(a) * o;
      parts.push(part(P.box(0.4, 26, 0.4), '#c8c0b0', { x: px, y: y - 13, z: pz, outline: 0 }));
    }
  }
  // the crown: stepped, banded with light
  for (const [w, h, lit] of [[7, 3, '#ffd8a0'], [5.6, 3, '#ffb878'], [4.4, 3, '#ff9a68']]) {
    parts.push(part(P.box(w, h, w), '#d8d0c0', { y: y + h / 2 }));
    parts.push(part(P.box(w + 0.1, 0.5, w + 0.1), lit, { y: y + h - 0.6, emit: 1, outline: 0 }));
    y += h;
  }
  parts.push(part(P.cyl(1.6, 1.9, 4.5, 12), '#ffe2b8', { y: y + 2.25, emit: 0.85 }));
  y += 4.5;
  parts.push(part(P.cyl(0.25, 0.9, 3, 10), '#c8c0b0', { y: y + 1.5 }));
  parts.push(part(P.cyl(0.08, 0.25, 14, 6), '#c8c0b0', { y: y + 10, outline: 0 }));
  parts.push(part(P.sphere(0.45, 8, 6), '#ff3a2a', { y: y + 17.2, emit: 1, outline: 0 }));
  return merge(parts);
}

function walkwayWallsGeo() {
  // The walkway sits on a long building: brick side walls dropping into the
  // dark, a brick parapet with limestone coping along the edge.
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.5, 30, 16, 1, 1, 8), NY.parapet, { x: s * 4.65, y: -15, z: -8, mark: 0.55 }));
    parts.push(part(P.box(0.45, 0.62, 16, 1, 1, 8), NY.parapet, { x: s * 4.62, y: 0.31, z: -8, mark: 0.55 }));
    parts.push(part(P.box(0.6, 0.14, 16, 1, 1, 8), NY.stone, { x: s * 4.62, y: 0.68, z: -8 }));
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

// --- the climbs ------------------------------------------------------------
// From the second time round, the walkway runs into the roofs around it and
// you go up and over: up a metal maintenance ramp onto a raised section of
// roof, up onto a fire-escape landing, up again onto the next roof, across
// a footbridge strung between two buildings - broken off over the alley
// in places - and back down the far side. (See def.climb, and
// ObstacleField.placeClimb.) Every deck is a body a metre long stretched
// along the run (sz) and a face at each end; what stands along it - vents,
// air conditioners, posts, truss panels - is put along it a few metres
// apart.
const ROOF_W = 9.0;
const ROOFS = [1.0, 1.8, 2.6];
// A maintenance ramp: a steel deck ribbed for grip on trestle legs, a
// handrail each side; a metre long and a metre high (stretched: sz, sy).
function maintRampGeo() {
  const parts = [];
  const L = Math.SQRT2;
  parts.push(part(P.box(ROOF_W - 0.6, 0.08, L), '#5e6472', { y: 0.5 - 0.04, z: -0.5, rx: Math.PI / 4 }));
  for (let i = 0; i < 12; i++) {
    const t = (i + 0.5) / 12;
    parts.push(part(P.box(ROOF_W - 0.8, 0.02, 0.012), '#8a92a2', { y: t + 0.006, z: -t, outline: 0 }));
  }
  for (const s of [-1, 1]) {
    const x = s * (ROOF_W / 2 - 0.4);
    parts.push(part(P.box(0.08, 0.2, L), '#c8a832', { x, y: 0.5 + 0.06, z: -0.5, rx: Math.PI / 4, outline: 0.4 }));
    parts.push(part(P.box(0.06, 0.06, L), '#e8c84a', { x, y: 0.5 + 1.0, z: -0.5, rx: Math.PI / 4, outline: 0.4 }));
    for (let k = 0; k <= 3; k++) parts.push(part(P.box(0.05, 1.0, 0.05), '#c8a832', { x, y: k / 3 + 0.5, z: -k / 3, outline: 0.3 }));
    // trestle legs under it
    for (const t of [0.35, 0.7, 0.98]) parts.push(part(P.box(0.1, t, 0.1), NY.iron, { x: s * (ROOF_W / 2 - 0.9), y: t / 2, z: -t, outline: 0.3 }));
  }
  return merge(parts);
}
// A raised section of roof, h up: brick walls, its tar top, stone coping
// along its sides.
function climbRoofGeo(h) {
  const parts = [];
  parts.push(part(P.box(ROOF_W - 0.2, h - 0.1, 1), '#ffffff', { y: (h - 0.1) / 2, z: -0.5, tint: 1, mark: 0.55 }));
  parts.push(part(P.box(ROOF_W - 0.3, 0.1, 1), NY.tar, { y: h - 0.05, z: -0.5 }));
  for (const s of [-1, 1]) parts.push(part(P.box(0.32, 0.16, 1), NY.stone, { x: s * (ROOF_W / 2 - 0.1), y: h + 0.02, z: -0.5 }));
  return merge(parts);
}
// Its front: a band of coping along the edge, a lit window or two below it
// (or a vent grille on a low one).
function climbRoofFaceGeo(h, seed) {
  const rnd = seeded(seed);
  const parts = [];
  parts.push(part(P.box(ROOF_W, 0.16, 0.36), NY.stone, { y: h + 0.02, z: -0.1 }));
  parts.push(part(P.box(ROOF_W - 0.2, 0.08, 0.06), NY.cornice, { y: h - 0.16, z: 0.03, outline: 0.4 }));
  if (h > 1.5) {
    const n = h > 2.2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const x = -ROOF_W / 2 + (ROOF_W * (i + 0.5)) / n + (rnd() - 0.5) * 0.6;
      const lit = rnd() < 0.7;
      parts.push(part(P.box(0.9, 0.9, 0.06), NY.frame, { x, y: h - 0.85, z: 0.03, outline: 0.4 }));
      parts.push(part(P.box(0.74, 0.74, 0.04), lit ? C.lit[i % 4] : C.unlit, { x, y: h - 0.85, z: 0.05, emit: lit ? 1 : 0, outline: 0 }));
      parts.push(part(P.box(1.02, 0.1, 0.12), NY.stone, { x, y: h - 0.34, z: 0.06 }));
    }
  } else {
    for (const x of [-2.6, 2.4]) parts.push(part(P.box(0.7, 0.36, 0.05), NY.iron, { x, y: h * 0.5, z: 0.03, outline: 0.4 }));
  }
  return merge(parts);
}
// Clutter on a roof's edge: an air conditioner, a mushroom vent.
function roofACGeo() {
  return merge([
    part(P.box(1.1, 0.75, 0.9), NY.ac, { y: 0.4 }),
    part(P.cyl(0.32, 0.32, 0.05, 14), NY.acDark, { y: 0.8 }),
    part(P.box(0.06, 0.5, 0.7), NY.acDark, { x: 0.56, y: 0.4, outline: 0.3 }),
  ]);
}
function roofVentGeo() {
  return merge([
    part(P.cyl(0.16, 0.16, 0.7, 10), NY.acDark, { y: 0.35 }),
    part(P.cyl(0.38, 0.2, 0.22, 12), NY.ac, { y: 0.8 }),
  ]);
}
// A fire-escape landing: an iron grating on cross-bearers, rails down its
// sides (its posts are put along it), open beneath.
function landingGeo(h) {
  const parts = [];
  parts.push(part(P.box(ROOF_W - 0.4, 0.08, 1), NY.escape, { y: h - 0.04, z: -0.5 }));
  for (let i = 0; i < 9; i++) parts.push(part(P.box(0.03, 0.02, 1), '#4a4e5e', { x: -ROOF_W / 2 + 0.6 + i * ((ROOF_W - 1.2) / 8), y: h + 0.005, z: -0.5, outline: 0 }));
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.14, 0.24, 1), NY.iron, { x: s * (ROOF_W / 2 - 0.25), y: h - 0.16, z: -0.5 }));
    parts.push(part(P.box(0.06, 0.06, 1), NY.escape, { x: s * (ROOF_W / 2 - 0.25), y: h + 1.0, z: -0.5, outline: 0.4 }));
    parts.push(part(P.box(0.04, 0.04, 1), NY.escape, { x: s * (ROOF_W / 2 - 0.25), y: h + 0.5, z: -0.5, outline: 0.3 }));
  }
  return merge(parts);
}
// Its face: the grating's edge and a drop ladder hung down from it.
function landingFaceGeo(h) {
  const parts = [part(P.box(ROOF_W - 0.3, 0.12, 0.08), NY.iron, { y: h - 0.06, z: 0.0 })];
  for (const s of [-1, 1]) parts.push(part(P.box(0.05, h - 0.35, 0.05), NY.escape, { x: 2.6 + s * 0.24, y: (h - 0.35) / 2 + 0.3, z: 0.08, outline: 0.3 }));
  for (let y = 0.5; y < h - 0.1; y += 0.3) parts.push(part(P.box(0.48, 0.03, 0.03), NY.escape, { x: 2.6, y, z: 0.08, outline: 0 }));
  for (const s of [-1, 1]) parts.push(part(P.box(0.06, 1.05, 0.06), NY.escape, { x: s * (ROOF_W / 2 - 0.25), y: h + 0.5, z: 0, outline: 0.3 }));
  return merge(parts);
}
// A post holding a landing up, a metre tall (stretched to its height: sy),
// with a rail post on top of it.
function landingPostGeo() {
  return merge([part(P.box(0.1, 1, 0.1), NY.iron, { y: 0.5 })]);
}
// A footbridge between two buildings: planks laid along it between two
// steel girders (truss panels are put along it).
function footbridgeGeo(h) {
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const x = -ROOF_W / 2 + 0.5 + i * ((ROOF_W - 1) / 13);
    parts.push(part(P.box((ROOF_W - 1) / 13 - 0.04, 0.08, 1), i % 3 === 0 ? '#6a5a4a' : i % 3 === 1 ? '#7a6652' : '#5e5044', { x, y: h - 0.04, z: -0.5, outline: 0 }));
  }
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.18, 0.5, 1), '#3a4258', { x: s * (ROOF_W / 2 - 0.2), y: h - 0.2, z: -0.5 }));
    parts.push(part(P.box(0.08, 0.08, 1), '#4a5470', { x: s * (ROOF_W / 2 - 0.2), y: h + 1.05, z: -0.5, outline: 0.4 }));
  }
  return merge(parts);
}
// Its end: the girders' end plates, riveted, and the ragged end of the
// planks where the span broke off.
function footbridgeFaceGeo(h) {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.3, 0.6, 0.06), '#4a5470', { x: s * (ROOF_W / 2 - 0.2), y: h - 0.2, z: 0.03, outline: 0.4 }));
    for (const dy of [-0.35, -0.05]) parts.push(part(P.sphere(0.035, 5, 4), '#8a92a8', { x: s * (ROOF_W / 2 - 0.2), y: h + dy, z: 0.07, outline: 0 }));
    parts.push(part(P.box(0.08, 1.1, 0.08), '#4a5470', { x: s * (ROOF_W / 2 - 0.2), y: h + 0.55, z: 0, outline: 0.4 }));
  }
  const rnd = seeded(Math.round(h * 9));
  for (let i = 0; i < 13; i++) parts.push(part(P.box(0.6, 0.08, 0.1 + rnd() * 0.35), '#6a5a4a', { x: -ROOF_W / 2 + 0.8 + i * 0.6, y: h - 0.04, z: 0.05 + rnd() * 0.12, ry: (rnd() - 0.5) * 0.2, outline: 0.3 }));
  return merge(parts);
}
// A truss panel of the footbridge's side: a post and a diagonal brace,
// 2.5 m along the run.
function trussGeo() {
  const parts = [part(P.box(0.08, 1.05, 0.08), '#4a5470', { y: 0.52, outline: 0.3 })];
  const L = Math.hypot(1.0, 2.5);
  parts.push(part(P.box(0.05, L, 0.05), '#4a5470', { y: 0.5, z: -1.25, rx: -Math.atan2(2.5, 1.0), outline: 0.3 }));
  return merge(parts);
}
// An alley between two roofs, looked down into: the near edge's coping
// catching the light, black, the far building's wall coming up out of the
// dark lit by the street far below. A metre long (stretched, sz).
function climbAlleyGeo() {
  const parts = [];
  const bands = [
    [0, 0.05, '#8a8aa8', '#5a5a78'],
    [0.05, 0.3, '#0a0c1a', '#05060e'],
    [0.3, 0.55, '#05060e', '#3a2420'],
    [0.55, 0.7, '#ffb85a', '#6a3428'],
    [0.7, 1.0, '#5a3028', '#7a4436'],
  ];
  for (const [a, b, c0, c1] of bands) {
    const g = new THREE.PlaneGeometry(ROOF_W + 0.4, b - a, 1, 1);
    parts.push(part(g, null, { y: (a + b) / 2, grad: [c0, c1, a, b], outline: 0, emit: a > 0.5 && a < 0.6 ? 0.8 : 0 }));
  }
  return merge(parts.map((g) => g.rotateX(-Math.PI / 2))).translate(0, 0.03, 0);
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
    parts.push(part(P.box(w, 56, 2.2), NY.parapet, { x, y: -2, mark: 0.55 }));
    parts.push(part(P.box(w, 0.8, 2.8), NY.stone, { x, y: 26.2 }));
    parts.push(part(P.box(w, 0.5, 2.6), NY.cornice, { x, y: 25.6 }));
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

// The door into the Night Rooftops: the night sky on it - a crescent moon
// glowing gold high up, stars strewn round it, and a row of little lit
// windows, as if the city were already showing through.
function nightLeaf({ W, H, z, f }) {
  const out = [];
  const at = (t) => z + (f * t) / 2;
  const mx = W * 0.55;
  const my = H - 1.6;
  out.push(part(P.cyl(0.95, 0.95, 0.06, 24), '#ffe08a', { x: mx, y: my, z: at(0.06), rx: Math.PI / 2, emit: 1, outline: 0.4 }));
  out.push(part(P.cyl(0.82, 0.82, 0.06, 24), '#bdbdbd', { x: mx + 0.42, y: my + 0.24, z: at(0.12), rx: Math.PI / 2, tint: 1, outline: 0 }));
  const stars = [[0.25, 0.92], [0.78, 0.86], [0.2, 0.7], [0.62, 0.74], [0.85, 0.62], [0.35, 0.56], [0.7, 0.5]];
  for (const [sx, sy] of stars) {
    const s = 0.22 + 0.12 * ((sx * 7) % 1);
    for (const r of [Math.PI / 4, -Math.PI / 4]) out.push(part(P.box(s * 1.6, 0.07, 0.05), '#fff2b0', { x: W * sx, y: H * sy, z: at(0.05), rz: r, emit: 1, outline: 0 }));
  }
  const lit = ['#ffd27a', '#ffb860', '#ffe9a8', '#ffc870'];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const wx = W * (0.24 + 0.27 * c);
      const wy = 1.7 + r * 1.3;
      out.push(part(P.box(0.62, 0.86, 0.06), '#20283a', { x: wx, y: wy, z: at(0.06), outline: 0.4 }));
      out.push(part(P.box(0.48, 0.72, 0.08), lit[(r * 3 + c) % 4], { x: wx, y: wy, z: at(0.08), emit: (r + c) % 3 ? 1 : 0, outline: 0 }));
    }
  }
  out.push(part(P.sphere(0.15, 10, 8), '#e8c35a', { x: W - 0.5, y: 4.6, z: at(0.22) }));
  return out;
}

export default {
  id: 'rooftops',
  name: 'The Night Rooftops',
  doorColor: '#3a5cc0',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  // From the second time round: up and over the roofs (see the climbs,
  // above). Up a maintenance ramp onto a raised section of roof, up onto a
  // fire-escape landing, up onto the roof above, and back down the far
  // side; the second climb of a visit (and every one, from the third time
  // through) crosses a footbridge between two buildings at the top, broken
  // off over the alley; from the fourth, now and then an alley on the way
  // up and the way down too.
  climb: {
    from: 1,
    every: [2, 4],
    most: (visit) => (visit <= 1 ? 2 : 3),
    names: [
      'climbRamp', 'climbAlley', 'climbAC', 'climbVent', 'climbPost', 'climbTruss',
      ...ROOFS.flatMap((h, i) => [`climbRoof${i}`, `climbRoofFace${i}`, `landing${i}`, `landingFace${i}`, `footbridge${i}`, `footbridgeFace${i}`]),
    ],
    plan(visit, r, n) {
      const [a, b, c] = ROOFS;
      const t = () => r.float(0.9, 1.05);
      const deck = (style, h) => ({ kind: 'deck', style, h, t: t(), min: 10 });
      const alley = () => ({ kind: 'gap', t: r.float(0.3, 0.36), min: 5.5 });
      const P = [{ kind: 'ramp', h: a, t: 0.55, min: 8 }, deck('roof', a)];
      if (visit >= 3 && r.chance(0.5)) P.push(alley());
      P.push(deck('landing', b), deck('roof', c));
      if (visit >= 2 || n > 0) {
        P.push(alley(), deck('bridge', c));
        if (visit >= 2) P.push(alley(), deck('roof', c));
      }
      if (visit >= 3 && r.chance(0.5)) P.push(alley());
      P.push(deck('landing', b), deck('roof', a));
      return P;
    },
    put(put, P, { d, len, h, rng }) {
      if (P.kind === 'ramp') return put('climbRamp', 0, 0, d, { sz: len, sy: h });
      if (P.kind === 'gap') return put('climbAlley', 0, 0, d, { sz: len });
      const i = Math.max(0, ROOFS.indexOf(h));
      const st = P.style || 'roof';
      if (st === 'roof') {
        const tint = BRICKS[Math.floor(d * 7.13) % BRICKS.length];
        put(`climbRoof${i}`, 0, 0, d, { sz: len, c: tint });
        put(`climbRoofFace${i}`, 0, 0, d, { c: tint });
        put(`climbRoofFace${i}`, 0, 0, d + len, { ry: Math.PI, c: tint });
        // air conditioners and vents along its edges
        for (const s of [-1, 1]) {
          for (let z = d + rng.float(1, 3); z < d + len - 1; z += rng.float(2.5, 5)) {
            if (rng.chance(0.55)) put(rng.chance(0.5) ? 'climbAC' : 'climbVent', s * rng.float(3.85, 4.15), h, z, { ry: rng.pick([0, Math.PI / 2, Math.PI]) });
          }
        }
        return;
      }
      const body = st === 'bridge' ? 'footbridge' : 'landing';
      put(`${body}${i}`, 0, 0, d, { sz: len });
      put(`${body}Face${i}`, 0, 0, d);
      put(`${body}Face${i}`, 0, 0, d + len, { ry: Math.PI });
      for (const s of [-1, 1]) {
        if (st === 'landing') {
          for (let z = d + 1.2; z < d + len - 0.5; z += rng.float(2.4, 3.2)) put('climbPost', s * (ROOF_W / 2 - 0.25), 0, z, { sy: h - 0.2 });
        } else {
          for (let z = d + 0.2; z < d + len - 2.4; z += 2.5) put('climbTruss', s * (ROOF_W / 2 - 0.2), h, z);
        }
      }
    },
  },

  gem: GEM,
  continuation: false, // the facade hides everything behind the door
  env: {
    // (a warm glow of city light along the horizon)
    sky: ['#070c28', '#4a3e6c', '#0c1230'],
    bloom: ['#4a6ae8', '#ffc45a', '#ff7a6a'], // the colours its doorway bloom is made of
    sun: { dir: [0.5, 0.42, -1], glow: '#3c4c94' },
    moon: { dir: [0.5, 0.42, -1], color: '#fbe9b0', size: 0.05 },
    stars: 1,
    skyFx: { clouds: 0.16 },
    // harsh moonlight from ahead: faces toward you fall into deep blue
    light: { dir: [0.45, 0.62, -0.65], shadow: [0.44, 0.5, 0.82], hi: [1.2, 1.2, 1.35], soft: 0.01, wrap: 0, hiAmt: 0.75, lift: 0.8 },
    rim: [0.55, 0.68, 1.0, 0.34],
    mist: { color: '#221f46', amount: 0.8, top: -1.5, fade: 9, near: 14, far: 70 },
    grade: { sat: 1.12, contrast: 1.1, vignette: 0.5, exposure: 1.04, tint: '#030820' },
    beam: { color: '#ffc870', amount: 0.34 },
    pool: '#ffa040',
    ink: '#060b22',
    fog: [44, 230],
    // tar paper (ground pattern 14)
    ground: ['#2e313e', '#393c4a', '#17181f'],
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
    // the roof underfoot: tar paper, its seams, its patches, its puddles
    // (ground pattern 14)
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 14);
    b.toon('void', groundStrip(420, 16, '#0c1636', 8, { y: -28 }), { ink: 0, cap: 40 });
    b.toon('walls', walkwayWallsGeo(), { cap: 40, ink: 0.035, anim: 'rise', brick: true });
    // the roofs either side: tenements, walk-ups and lofts, near ones with a
    // fire escape down the side toward the path too (L: on the right of the
    // path, its escape on its -x side; R: on the left), the far row plainer
    // (only the faces you can see are drawn: the front, and the side toward
    // the path - L is on the right of the path, its path side at -x; R on
    // the left)
    const KINDS = { tenement: { w: 6.2, d: 7, style: 'brick', seed: 3 }, walkup: { w: 5, d: 6, style: 'brick', seed: 9, litChance: 0.5 }, loft: { w: 7.6, d: 7.4, style: 'stone', seed: 17 } };
    for (const [k, o] of Object.entries(KINDS)) {
      b.toon(k + 'L', nyBuildingGeo({ ...o, path: -1 }), { cap: 60, anim: 'lift', brick: true });
      b.toon(k + 'R', nyBuildingGeo({ ...o, path: 1 }), { cap: 60, anim: 'lift', brick: true });
      b.toon(k + 'FarL', nyBuildingGeo({ ...o, path: -1, near: false, seed: o.seed + 20 }), { cap: 60, anim: 'lift', brick: true, ink: 0 });
      b.toon(k + 'FarR', nyBuildingGeo({ ...o, path: 1, near: false, seed: o.seed + 20 }), { cap: 60, anim: 'lift', brick: true, ink: 0 });
    }
    b.toon('waterTower', waterTowerGeo(), { cap: 90, anim: 'lift', marks: [1, 1] });
    b.toon('bulkhead', bulkheadGeo(), { cap: 60, anim: 'lift', brick: true });
    b.toon('antenna', antennaGeo(), { cap: 60, anim: 'lift', ink: 0 });
    b.toon('roofKit', roofKitGeo(), { cap: 60, anim: 'lift' });
    b.toon('sign', signGeo(), { cap: 12, anim: 'lift' });
    b.toon('towers', towersGeo(5), { cap: 60, anim: 'liftFar', ink: 0, brick: true });
    b.toon('towersB', towersGeo(12), { cap: 60, anim: 'liftFar', ink: 0, brick: true });
    b.toon('spire', spireGeo(), { cap: 4, anim: 'liftFar', ink: 0.08, brick: true });
    b.toon('tree', merge(roundTreeParts({ r: 1.6, trunkH: 1.4, lo: '#1a3a2c', hi: '#3e6e4a', trunk: '#2a2226' })), { cap: 80, anim: 'lift', marks: [2.2, 2], wobble: [0.004, 0, 1.1, 0] });
    b.toon('lamp', roofLampGeo(), { cap: 40, anim: 'pop' });
    b.toon('lights', lightsGeo(), { cap: 24, anim: 'popLate', ink: 0.02 });
    b.glow('glow', { cap: 120, anim: 'pop' });
    b.shadow('shadow', { cap: 200, anim: 'pop' });
    b.beam('lampCone', merge(lampConeParts({ top: 3.3, r0: 0.16, r1: 1.7 })), { cap: 40, anim: 'pop' });
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
    // the climbs (from the second time round: see climb, above)
    b.toon('climbRamp', maintRampGeo(), { cap: 8, anim: 'popEarly', ink: 0.03 });
    b.toon('climbAlley', climbAlleyGeo(), { cap: 12, anim: 'popEarly', ink: 0 });
    b.toon('climbAC', roofACGeo(), { cap: 60, anim: 'popEarly', ink: 0.03 });
    b.toon('climbVent', roofVentGeo(), { cap: 60, anim: 'popEarly', ink: 0.03 });
    b.toon('climbPost', landingPostGeo(), { cap: 80, anim: 'popEarly', ink: 0.025 });
    b.toon('climbTruss', trussGeo(), { cap: 80, anim: 'popEarly', ink: 0.025 });
    ROOFS.forEach((h, i) => {
      b.toon(`climbRoof${i}`, climbRoofGeo(h), { cap: 12, anim: 'popEarly', ink: 0.035, brick: true });
      b.toon(`climbRoofFace${i}`, climbRoofFaceGeo(h, 5 + i), { cap: 24, anim: 'popEarly', ink: 0.03 });
      b.toon(`landing${i}`, landingGeo(h), { cap: 10, anim: 'popEarly', ink: 0.03 });
      b.toon(`landingFace${i}`, landingFaceGeo(h), { cap: 20, anim: 'popEarly', ink: 0.03 });
      b.toon(`footbridge${i}`, footbridgeGeo(h), { cap: 10, anim: 'popEarly', ink: 0.03 });
      b.toon(`footbridgeFace${i}`, footbridgeFaceGeo(h), { cap: 20, anim: 'popEarly', ink: 0.03 });
    });

  },

  // The door INTO this world, in its own style (built into the shared
  // doors, see world.js: it stands in the world before it).
  door(b) {
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06, brick: true });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', deco: nightLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
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
    const DIM = { tenement: [6.2, 7], walkup: [5, 6], loft: [7.6, 7.4] };
    for (const s of [-1, 1]) {
      // gooseneck lamps on the parapet, their arms reaching in over the roof
      if ((ctx.index + (s > 0 ? 1 : 0)) % 2 === 0) {
        ctx.put('lamp', s * 4.62, 0.75, 12, { ry: s > 0 ? 0 : Math.PI });
        ctx.put('glow', s * 4.02, 3.2, 12, { s: 2.6, c: [1, 0.72, 0.38] });
        ctx.put('lampCone', s * 4.02, 0.05, 12, { c: [0.9, 0.9, 0.9] });
        ctx.put('pool', s * 3.4, 0.03, 12, { sx: 4.6, sz: 5.4, c: [0.85, 1, 1] });
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
      // the near roofs, every one its own height: some down below you, their
      // roofs and water towers in view, some rising over you, their fronts
      // and fire escapes
      let dz = rng.float(0, 3);
      while (dz < 16) {
        const kind = rng.weighted([['tenement', 3], ['walkup', 2], ['loft', 2]]);
        const [w, d] = DIM[kind];
        // (some rising well over you, their windows and fire escapes beside
        // the path; the rest down around you, their roofs in view)
        const top = rng.chance(0.4) ? rng.float(4.5, 11) : rng.float(-5.5, 3);
        const x = s * (5.2 + w / 2 + rng.float(0.2, 2.2));
        const zc = dz + d / 2;
        ctx.put(kind + (s > 0 ? 'L' : 'R'), x, top, zc, { c: mix(rng.pick(kind === 'loft' ? STONES : BRICKS), '#ffffff', rng.float(0, 0.06)) });
        roof(ctx, rng, s, x, top, zc, w, d);
        dz += d + rng.float(0.4, 2.6);
      }
      // a second row, taller, further off
      dz = rng.float(0, 4);
      while (dz < 16) {
        const kind = rng.weighted([['tenement', 2], ['walkup', 1], ['loft', 3]]);
        const [w, d] = DIM[kind];
        const x = s * rng.float(17, 26);
        const top = rng.float(0, 9);
        const k = rng.float(1, 1.25);
        ctx.put(kind + (s > 0 ? 'FarL' : 'FarR'), x, top, dz + 3, { c: scaleColor(rng.pick(kind === 'loft' ? STONES : BRICKS), rng.float(0.8, 0.95)), s: k });
        if (rng.chance(0.35)) ctx.put('waterTower', x + rng.float(-1, 1) * w * 0.2 * k, top + 0.06, dz + 3 + rng.float(-1, 1), { ry: rng.float(0, 6.28), s: k });
        dz += rng.float(6.5, 10);
      }
      // out past them, the towers of the city
      ctx.put(rng.chance(0.5) ? 'towers' : 'towersB', s * rng.float(40, 58), rng.float(-6, 4), rng.float(0, 16), { c: scaleColor(rng.pick(TOWER_TINTS), rng.float(0.75, 0.95)), ry: rng.float(-0.25, 0.25) });
      if (rng.chance(0.45)) ctx.put(rng.chance(0.5) ? 'towers' : 'towersB', s * rng.float(68, 100), rng.float(0, 14), rng.float(0, 16), { c: scaleColor(rng.pick(TOWER_TINTS), 0.65), s: rng.float(1.2, 1.6) });
    }
    // and now and then, far off over the roofs ahead, the spire
    if (ctx.index % 9 === 4) {
      const s = rng.sign();
      ctx.put('spire', s * rng.float(34, 48), rng.float(-14, -8), 8, { c: '#b8b0a2' });
    }
  },
};

// What's on a roof (one whose top is at height top, centred at x, zc, w
// across and d along; s which side of the path it's on): a water tower on
// its stand or a stair bulkhead, air conditioners and vents, an antenna, a
// little garden, and now and then a sign lit up toward the path.
function roof(ctx, rng, s, x, top, zc, w, d) {
  const y = top + 0.06;
  const r = rng.float(0, 1);
  if (r < 0.5) ctx.put('waterTower', x + s * rng.float(0, w * 0.22), y, zc + rng.float(-d, d) * 0.18, { ry: rng.float(0, 6.28), s: rng.float(0.85, 1.1) });
  else if (r < 0.8) ctx.put('bulkhead', x + s * w * 0.18, y, zc - d * 0.2, { c: mix(rng.pick(BRICKS), '#ffffff', 0.05) });
  if (rng.chance(0.5)) ctx.put('roofKit', x - s * w * 0.2, y, zc + d * 0.22, { ry: rng.float(0, 6.28) });
  if (rng.chance(0.35)) ctx.put('antenna', x + s * w * 0.32, y, zc + rng.float(-d, d) * 0.3, { ry: rng.float(0, 6.28) });
  if (rng.chance(0.25)) ctx.put('tree', x - s * w * 0.25, y + 0.3, zc - d * 0.25, { s: rng.float(0.55, 0.8) });
  if (top < 1 && rng.chance(0.09)) ctx.put('sign', x - s * w * 0.1, y, zc, { ry: s > 0 ? -1.1 : 1.1, c: rng.pick(SIGNS) });
}

