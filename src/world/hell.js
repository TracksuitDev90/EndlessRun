import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, rockParts, gateFrameParts, gateLeafParts, gateTop } from './shapes.js';
import { crystal, stone, crystalPoint, nugget, lumps, point, hexPrism, rough } from './gems.js';
import { CONFIG } from '../config.js';

// VII · Hell — fire and brimstone, and above all emptiness: an ash plain that
// runs out to the edge of the world under a smoking sky, split by glowing
// fissures, broken only now and then by black basalt columns, jagged spires,
// pools and rivers of lava and, far off, volcanoes trailing smoke. Embers
// rise and ash falls all the time.
//
// Seen through its doorway it burns in reds and oranges; come through and
// the colour drains out of it (env.drain, see game.js), spreading from the
// centre of the screen, until only what burns — the lava, the fissures, the
// embers, and the runner's orange cape — keeps any colour: the rest is black,
// grey and white. The ash is kept pale and the rock dark, with pale edges, so
// the dark stones and the obstacles still read against it. Leave, and the
// colour floods back through the next doorway.
//
// Obstacles: low basalt ridges and lava fissures to jump (you can't land in
// the lava), charred beams on basalt posts to slide under, basalt columns and
// obsidian shards to go around; a fissure across the whole road and a long
// charred beam are the wide ones.

const C = {
  ashA: '#a8826c',
  ashB: '#c8a48a',
  cinder: '#40241c',
  basalt: '#2c201e',
  basaltHi: '#6e4c42',
  basaltTop: '#9a7868',
  char: '#231917',
  charHi: '#4c3229',
  obsidian: '#181216',
  obsidianHi: '#6a5266',
  ember: '#ff6a1a',
  emberHot: '#ffb347',
  lava: '#ff5a14',
  smokeLo: '#2e2422',
  smokeHi: '#7a625c',
};

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// --- gems -------------------------------------------------------------------------
// Dark stones for a dark world: banded black-and-white onyx above all (its
// pale bands are what make it read against the ash), with glassy obsidian,
// steel-bright hematite, striated black tourmaline, smoky quartz and
// mahogany obsidian, its black clouded with rust. They give off a pale,
// smoky light of their own (spec.light), so their halos and the motes they
// leave still show. The crown: three obsidian blades fanned from a lump of
// basalt.
const ONYX = { bands: 0.85, bandFreq: 22, wander: 3, second: '#ece6e0', mottle: 0.2, rough: 0.15, opaque: 0.6, speckle: 0.04, glints: 1.1 };
const OBSIDIAN = { mottle: 0.25, rough: 0.08, opaque: 0.2, speckle: 0.03, glints: 1.6, second: '#5a5060' };
function obsidianFan() {
  const blades = [
    [0.46, 0.1, 0, 0],
    [0.34, 0.085, 0.5, -0.07],
    [0.36, 0.085, -0.48, 0.07],
  ].map(([len, r, rz, x], i) => {
    const g = crystalPoint({ r, len, tip: r * 2.2, sides: 5, seed: 31 + i, jitter: 0.14 });
    g.translate(0, -0.1, 0);
    return crystal(g, { rz, x, rx: (i - 1) * 0.2, y: -0.16 });
  });
  return [...blades, stone(rough({ r: 0.16, seed: 4 }), C.basaltHi, { y: -0.24, sy: 0.6 })];
}
const GEM = {
  name: 'onyx',
  color: '#56505a',
  light: '#d8d0cc',
  stones: [
    {
      name: 'onyx',
      weight: 3,
      tints: ['#26222a', '#1e1a20', '#302a30'],
      parts: () => [crystal(nugget({ r: [0.21, 0.17, 0.19], faces: 30, spread: 0.06, chips: 1, seed: 12 }))],
      texture: ONYX,
    },
    {
      name: 'obsidian',
      weight: 2,
      tints: ['#141016', '#1c161c', '#100c10'],
      parts: () => [crystal(nugget({ r: [0.24, 0.15, 0.2], faces: 9, spread: 0.24, chips: 3, seed: 27 }), { rz: 0.4 })],
      texture: OBSIDIAN,
    },
    {
      // kidney ore: rounded steel-grey lumps with a metallic shine
      name: 'hematite',
      weight: 1.2,
      tints: ['#4a4a52', '#3e3e46', '#56565e'],
      parts: () => lumps({ n: 5, r: 0.11, spread: 0.1, seed: 9 }).map((g) => crystal(g)),
      texture: { metal: 0.85, opaque: 0.6, mottle: 0.2, rough: 0.25, glints: 1.4 },
    },
    {
      // schorl: a long striated prism
      name: 'black tourmaline',
      weight: 1.2,
      tints: ['#1a181e', '#222026', '#141218'],
      parts: () => [crystal(hexPrism({ r: 0.1, top: 0.3, foot: 0.26, seed: 14 }), { rz: 0.35, rx: 0.15 })],
      texture: { bands: 0.35, bandFreq: 60, wander: 0.3, second: '#56525e', rough: 0.2, glints: 1.3 },
    },
    {
      name: 'smoky quartz',
      weight: 1,
      tints: ['#6a5a52', '#5a4c46', '#76665c'],
      parts: () => [crystal(point({ r: 0.1, len: 0.24, tip: 0.17, foot: 0.22, seed: 19 }), { rz: -0.25 })],
      texture: { mottle: 0.4, second: '#2a201c', rough: 0.15, speckle: 0.05, glints: 1.2 },
    },
    {
      // black clouded with rust
      name: 'mahogany obsidian',
      weight: 1,
      tints: ['#2a1814', '#22140f', '#301c16'],
      parts: () => [crystal(nugget({ r: [0.2, 0.16, 0.18], faces: 12, spread: 0.18, chips: 2, seed: 33 }))],
      texture: { mottle: 0.9, second: '#7a3420', rough: 0.15, opaque: 0.3, glints: 1.3, scale: 5 },
    },
  ],
  crown: {
    name: 'obsidian fan',
    tints: ['#141016', '#1c161c'],
    parts: () => obsidianFan(),
    texture: OBSIDIAN,
  },
  motion: [0.8, 1.1, 0.07, 0.15],
  look: [0.5, 1.5, 0.12, 0.2],
  glow: 0.55,
  pool: 0.2,
};

// --- scenery ------------------------------------------------------------------------
function basaltRock(o) {
  return rockParts({ lo: C.basalt, hi: C.basaltHi, ...o });
}

// A cluster of hexagonal basalt columns, light catching their flat tops.
function columnsGeo({ n = 6, r = 0.4, hMin = 2, hMax = 4, spread = 0.9, seed = 1, glow = true } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const d = i === 0 ? 0 : spread * (0.55 + rnd() * 0.45);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d * 0.8;
    const h = hMin + rnd() * (hMax - hMin);
    const rr = r * (0.8 + rnd() * 0.35);
    parts.push(part(P.cyl(rr, rr * 1.05, h, 6), null, { x, y: h / 2, z, ry: rnd(), grad: [C.basalt, C.basaltHi, 0, h * 1.1] }));
    parts.push(part(P.cyl(rr * 0.96, rr, 0.08, 6), C.basaltTop, { x, y: h + 0.04, z, ry: rnd(), outline: 0.6 }));
  }
  if (glow) {
    // embers glowing in the seams at the foot
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      parts.push(part(P.box(0.5, 0.06, 0.06), C.ember, { x: Math.cos(a) * spread * 0.7, y: 0.05, z: Math.sin(a) * spread * 0.6, ry: a, emit: 1, outline: 0 }));
    }
  }
  return merge(parts);
}

function spireGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  let y = 0;
  let r = 3.2;
  for (let i = 0; i < 6; i++) {
    const h = r * (1.6 + rnd() * 0.8);
    parts.push(part(P.cyl(r * 0.72, r, h, 5), null, { x: (rnd() - 0.5) * r * 0.5, y: y + h / 2, ry: rnd() * 6, rz: (rnd() - 0.5) * 0.12, grad: [C.basalt, C.basaltHi, y, y + h] }));
    y += h * 0.92;
    r *= 0.7;
  }
  parts.push(part(P.cone(r * 1.1, r * 3, 5), C.basaltHi, { y: y + r * 1.4 }));
  return merge(parts);
}

function volcanoGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const prof = [[26, 0], [22, 6], [15, 15], [8.5, 23], [6.6, 26], [5.4, 25.4], [0, 24]];
  parts.push(part(P.lathe(prof.map(([r, y]) => [r, y]), 14), null, { grad: [C.basalt, C.basaltHi, 0, 26] }));
  // the crater's glow and lava running down its flank
  parts.push(part(P.cyl(5.2, 5.2, 0.4, 14), C.lava, { y: 25.3, emit: 1, outline: 0 }));
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.6;
    parts.push(part(P.box(0.9, 0.3, 16), C.ember, { x: Math.cos(a) * 13, y: 15, z: Math.sin(a) * 13, ry: -a + Math.PI / 2, rx: 0.65, emit: 1, outline: 0 }));
  }
  return merge(parts);
}

function smokeGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const r = 3 + i * 1.3;
    parts.push(part(P.sphere(r, 9, 7), null, { x: Math.sin(i * 1.3) * 2 + rnd() * 2, y: i * 4.2, z: rnd() * 2, sy: 0.75, grad: [C.smokeLo, C.smokeHi, i * 4.2 - r, i * 4.2 + r] }));
  }
  return merge(parts);
}

function rubbleGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    parts.push(...basaltRock({ r: 0.25 + rnd() * 0.35, sy: 0.6 + rnd() * 0.3, seed: seed * 7 + i }).map((g) => g.translate((rnd() - 0.5) * 2.4, 0, (rnd() - 0.5) * 1.6)));
  }
  return merge(parts);
}

function deadTreeGeo(seed) {
  const rnd = seeded(seed);
  const parts = [part(P.cyl(0.12, 0.26, 3.4, 6), null, { y: 1.7, rz: 0.08, grad: [C.char, C.charHi, 0, 3.4] })];
  for (let i = 0; i < 4; i++) {
    const y = 1.6 + i * 0.5;
    const a = rnd() * Math.PI * 2;
    const len = 1.4 - i * 0.2;
    parts.push(part(P.cyl(0.03, 0.08, len, 5), C.char, { x: Math.cos(a) * len * 0.4, y: y + len * 0.3, z: Math.sin(a) * len * 0.4, ry: -a, rz: 0.9 + rnd() * 0.4 }));
  }
  return merge(parts);
}

// Pond of lava with a crust of rocks round its rim. The lava itself is its
// own batch (the lava material).
function blobShape(rx, rz, seed, grow = 0) {
  const rnd = seeded(seed);
  const s = new THREE.Shape();
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.16 * Math.sin(a * 3 + seed) + 0.08 * (rnd() - 0.5);
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

function lavaPoolGeo(seed) {
  return merge([part(blobShape(4, 2.6, seed), C.lava, { y: 0.05, emit: 1, outline: 0 })]);
}

function crustRimGeo(seed) {
  const rnd = seeded(seed + 5);
  const parts = [part(blobShape(4, 2.6, seed, 0.6), C.cinder, { y: 0.025, outline: 0 })];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.4;
    parts.push(...basaltRock({ r: 0.25 + rnd() * 0.3, sy: 0.5, seed: seed + i }).map((g) => g.translate(Math.cos(a) * 4.5, -0.1, Math.sin(a) * 3.0)));
  }
  return merge(parts);
}

// A stretch of lava river running alongside the road (16 m, its banks
// wandering in whole waves so the stretches join up).
function riverGeo(w, seed) {
  const n = 16;
  const s = new THREE.Shape();
  const edge = (z, side) => side * (w + 0.5 * Math.sin((z / 16) * Math.PI * 2 + seed) + 0.3 * Math.sin((z / 16) * Math.PI * 4 + side));
  s.moveTo(edge(0, -1), 0);
  for (let i = 1; i <= n; i++) s.lineTo(edge(i, -1), i);
  for (let i = n; i >= 0; i--) s.lineTo(edge(i, 1), i);
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 1);
  g.rotateX(-Math.PI / 2);
  return merge([part(g, C.lava, { y: 0.06, emit: 1, outline: 0 })]);
}

function riverBankGeo(w, seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (const side of [-1, 1]) {
    for (let z = 0.5; z < 16; z += 1.4 + rnd()) {
      const x = side * (w + 0.5 * Math.sin((z / 16) * Math.PI * 2 + seed) + 0.6);
      parts.push(...basaltRock({ r: 0.3 + rnd() * 0.35, sy: 0.55, seed: seed + z * 3 }).map((g) => g.translate(x, -0.1, -z)));
    }
  }
  return merge(parts);
}

// --- obstacles ---------------------------------------------------------------------
// L · A low ridge of black basalt across one lane, glowing seams at its foot.
function ridgeGeo(half, seed) {
  const rnd = seeded(seed);
  const parts = [];
  const n = Math.max(3, Math.round(half * 2.2));
  for (let i = 0; i < n; i++) {
    const x = -half + 0.25 + ((half * 2 - 0.5) * i) / (n - 1);
    const r = 0.42 + rnd() * 0.12;
    parts.push(...basaltRock({ r, sx: 1.25, sy: 0.82 + rnd() * 0.12, sz: 0.95, seed: seed + i }).map((g) => g.translate(x + (rnd() - 0.5) * 0.1, -0.06, (rnd() - 0.5) * 0.12)));
  }
  // a pale crest so its top edge reads against the ash
  parts.push(part(P.box(half * 2 - 0.2, 0.05, 0.16), C.basaltTop, { y: 0.72, outline: 0.4 }));
  parts.push(part(P.box(half * 2, 0.05, 0.05), C.ember, { y: 0.04, z: 0.5, emit: 1, outline: 0 }));
  return merge(parts).translate(0, 0, -0.45);
}

// L · A lava fissure across one lane (or the whole road): crusted lips of
// basalt either side of a trench of lava. Its lava is a batch of its own.
const FISSURE_W = 1.9;
function fissureShape(x0, x1, seed, wobble = 0.14) {
  const rnd = seeded(seed);
  const n = Math.max(6, Math.round((x1 - x0) / 0.4));
  const s = new THREE.Shape();
  const near = [];
  const far = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const k = Math.sin(i * 1.1 + seed) * 0.5 + 0.5;
    near.push([x, 0.14 + k * wobble + rnd() * 0.05]);
    far.push([x, FISSURE_W - 0.14 - (1 - k) * wobble - rnd() * 0.05]);
  }
  s.moveTo(near[0][0], near[0][1]);
  for (const [x, y] of near.slice(1)) s.lineTo(x, y);
  for (const [x, y] of far.reverse()) s.lineTo(x, y);
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}
function fissureLavaGeo(half, seed) {
  return merge([part(fissureShape(-half, half, seed), C.lava, { y: 0.07, emit: 1, outline: 0 })]);
}
function fissureLipsGeo(half, seed) {
  const rnd = seeded(seed);
  const parts = [part(fissureShape(-half - 0.15, half + 0.15, seed, 0.02).scale(1, 1, 1), C.cinder, { y: 0.012, outline: 0 })];
  for (const z of [0.08, FISSURE_W - 0.08]) {
    for (let x = -half; x < half; x += 0.36 * (0.75 + rnd() * 0.5)) {
      const r = 0.13 + rnd() * 0.1;
      parts.push(...basaltRock({ r, sx: 1.3, sy: 0.6, seed: seed + x * 9 + z }).map((g) => g.translate(x, -r * 0.3, -z + (rnd() - 0.5) * 0.1)));
    }
  }
  return merge(parts);
}

// H · A charred beam on two basalt posts, its underside on the duck line,
// embers glowing in its cracks.
function beamGeo(half) {
  const D = CONFIG.duckLine;
  const bh = 0.46;
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.cyl(0.24, 0.3, D + bh + 0.3, 6), null, { x: s * half, y: (D + bh + 0.3) / 2, grad: [C.basalt, C.basaltHi, 0, D + bh + 0.3] }));
    parts.push(part(P.cyl(0.25, 0.25, 0.06, 6), C.basaltTop, { x: s * half, y: D + bh + 0.33, outline: 0.5 }));
  }
  parts.push(part(P.box(half * 2 + 0.5, bh, 0.46), null, { y: D + bh / 2, grad: [C.char, C.charHi, D, D + bh] }));
  // charred grain and the embers in its cracks
  const n = Math.max(2, Math.round(half * 2.4));
  for (let i = 0; i < n; i++) {
    const x = -half + ((half * 2) * (i + 0.5)) / n;
    parts.push(part(P.box(0.32 + (i % 2) * 0.2, 0.04, 0.02), i % 2 ? C.emberHot : C.ember, { x, y: D + 0.12 + (i % 3) * 0.1, z: 0.235, emit: 1, outline: 0 }));
  }
  parts.push(part(P.box(half * 2 + 0.4, 0.035, 0.4), C.ember, { y: D + 0.018, emit: 1, outline: 0 }));
  return merge(parts).translate(0, 0, -0.25);
}

// W · Basalt columns, and obsidian shards: tall, dark and sharp.
function obsidianGeo(seed) {
  const rnd = seeded(seed);
  const parts = [...basaltRock({ r: 0.7, sy: 0.5, seed })];
  const shards = [[0, 3.4, 0.48, 0], [-0.5, 2.4, 0.36, 0.25], [0.5, 2.7, 0.38, -0.22], [0.15, 1.8, 0.3, -0.4]];
  for (const [x, h, r, lean] of shards) {
    parts.push(part(P.cone(r, h, 5), null, { x, y: h / 2 + 0.1, z: (rnd() - 0.5) * 0.3, rz: lean, ry: rnd() * 6, grad: [C.obsidian, C.obsidianHi, 0, h * 1.2] }));
  }
  return merge(parts).translate(0, 0, -0.6);
}

function gateGeo(opening, depth) {
  const parts = [...gateFrameParts(opening, { thick: 1.5, depth, color: C.basalt })];
  const top = gateTop(opening);
  // obsidian horns and glowing runes round the arch
  for (const s of [-1, 1]) {
    parts.push(part(P.cone(0.7, 4.2, 5), C.obsidian, { x: s * (opening.halfW + 0.9), y: top + 0.6, rz: -s * 0.45 }));
    parts.push(...columnsGeoParts(s * (opening.halfW + 2.6)));
  }
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.1 + (0.8 * i) / 8);
    const R = opening.halfW + 0.75;
    parts.push(part(P.box(0.5, 0.14, 0.1), C.ember, { x: Math.cos(a) * R, y: opening.rectH + Math.sin(a) * R, z: depth / 2 + 0.03, rz: a + Math.PI / 2, emit: 1, outline: 0 }));
  }
  return merge(parts);
}
function columnsGeoParts(x) {
  const g = columnsGeo({ n: 4, r: 0.55, hMin: 3, hMax: 6.5, spread: 0.9, seed: 3, glow: false });
  g.translate(x, 0, 0);
  return [g];
}

const OPENING = { halfW: 4.6, rectH: 7.6, arch: true };
const GATE_DEPTH = 1.8;

export default {
  id: 'hell',
  name: 'Hell',
  doorColor: '#c8361a',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    drain: true,
    sky: ['#1c0606', '#b0361c', '#2a0a06'],
    // its bloom is ash and smoke: coming in, the colour drains rather than blooms
    bloom: ['#f2eeea', '#8a8682', '#1e1c1c'],
    sun: { dir: [0, 0.05, -1], glow: '#ff5a20', disc: '#e88a5a', size: 0.032 },
    stars: 0,
    skyFx: { rays: 0.12, clouds: 0.6 },
    // lit from ahead and below by the burning horizon: hard shadows, hot rims
    light: { dir: [0.12, 0.33, -1], shadow: [0.5, 0.36, 0.38], hi: [1.1, 0.92, 0.78], soft: 0.035, wrap: 0.1, hiAmt: 0.35, lift: 0.55 },
    rim: [1.0, 0.5, 0.2, 0.42],
    mist: { color: '#7a3424', amount: 0.55, top: 1.4, fade: 4, near: 22, far: 110 },
    grade: { sat: 1.1, contrast: 1.12, vignette: 0.5, exposure: 1.0, tint: '#1a0402' },
    ink: '#140a08',
    fog: [48, 200],
    ground: [C.ashA, C.ashB, C.cinder],
    shadowDecal: [0.56, 0.52, 0.52],
    cast: [-0.1, 1.2],
    glowGain: 1.0,
    pool: '#ff5a1a',
    // embers rising on the heat, ash falling through them
    particles: { color: '#ff7a2a', size: 2.9, drift: [0.15, 1.1, 0], opacity: 1 },
    particles2: { color: '#e2dcd6', size: 2.2, drift: [0.45, -0.6, 0], opacity: 0.85 },
  },

  visits: [
    // an ember storm: more fire on the wind, the sky aflame
    {
      env: {
        sky: ['#240804', '#d0481c', '#3a0e06'],
        skyFx: { rays: 0.5, clouds: 0.7 },
        particles: { color: '#ffa040', size: 3.0, drift: [0.6, 1.4, 0], opacity: 1 },
      },
    },
    // the eclipse: a black sun ringed in fire
    {
      env: {
        sky: ['#0c0204', '#7a1c18', '#1a0406'],
        sun: { dir: [0, 0.14, -1], glow: '#ff3a20', disc: '#120808', size: 0.07 },
        skyFx: { rays: 0.9, clouds: 0.4 },
        rim: [1.0, 0.3, 0.15, 0.5],
        particles2: { color: '#eeeae6', size: 2.0, drift: [0.2, -0.4, 0], opacity: 0.85 },
      },
    },
    { env: { trip: [0.05, 0.3, 0.1] } },
  ],

  build(b) {
    b.ground('ground', groundStripWide(), 7);
    b.toon('rubble', rubbleGeo(3), { cap: 60, anim: 'pop', ink: 0.04 });
    b.toon('rubbleB', rubbleGeo(9), { cap: 60, anim: 'pop', ink: 0.04 });
    b.toon('columns', columnsGeo({ n: 7, r: 0.9, hMin: 4, hMax: 11, spread: 2.4, seed: 5 }), { cap: 40, anim: 'lift', ink: 0.05 });
    b.toon('columnsB', columnsGeo({ n: 5, r: 0.7, hMin: 2.5, hMax: 6, spread: 1.6, seed: 11 }), { cap: 40, anim: 'lift', ink: 0.05 });
    b.toon('spire', spireGeo(4), { cap: 24, anim: 'liftFar', ink: 0.06 });
    b.toon('spireB', spireGeo(17), { cap: 24, anim: 'liftFar', ink: 0.06 });
    b.toon('volcano', volcanoGeo(2), { cap: 8, anim: 'liftFar', ink: 0 });
    b.toon('smoke', smokeGeo(6), { cap: 16, anim: 'liftFar', ink: 0, wobble: [0.004, 0.6, 0.25, 0] });
    b.toon('deadTree', deadTreeGeo(7), { cap: 24, anim: 'pop', ink: 0.03 });
    b.toon('lavaPool', lavaPoolGeo(4), { cap: 16, lava: true, ink: 0, anim: 'pop' });
    b.toon('crustRim', crustRimGeo(4), { cap: 16, anim: 'pop', ink: 0.03 });
    b.toon('river', riverGeo(2.2, 1), { cap: 24, lava: true, ink: 0 });
    b.toon('riverBank', riverBankGeo(2.2, 1), { cap: 24, ink: 0.03 });
    b.glow('glow', { cap: 80, anim: 'pop' });
    b.pool('pool', { cap: 60, anim: 'pop' });
    b.shadow('shadow', { cap: 120, anim: 'pop' });

    b.toon('ridge', ridgeGeo(0.95, 1), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('ridgeB', ridgeGeo(0.95, 7), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('fissureLava', fissureLavaGeo(1.05, 3), { cap: 24, lava: true, ink: 0, anim: 'popEarly' });
    b.toon('fissureLips', fissureLipsGeo(1.05, 3), { cap: 24, anim: 'popEarly', ink: 0.03 });
    b.toon('fissureWideLava', fissureLavaGeo(4.4, 5), { cap: 10, lava: true, ink: 0, anim: 'popEarly' });
    b.toon('fissureWideLips', fissureLipsGeo(4.4, 5), { cap: 10, anim: 'popEarly', ink: 0.03 });
    b.toon('beam', beamGeo(0.95), { cap: 24, anim: 'popEarly', ink: 0.045 });
    b.toon('beamWide', beamGeo(4.1), { cap: 10, anim: 'popEarly', ink: 0.045 });
    b.toon('basalt', columnsGeo({ n: 5, r: 0.36, hMin: 2.2, hMax: 3.8, spread: 0.55, seed: 2 }).translate(0, 0, -0.75), { cap: 24, anim: 'popEarly', ink: 0.045 });
    b.toon('obsidian', obsidianGeo(5), { cap: 24, anim: 'popEarly', ink: 0.04 });

    b.toon('gateFrame', gateGeo(OPENING, GATE_DEPTH), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff', knob: '#c8361a' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [
      { name: 'ridge', len: 0.95 },
      { name: 'ridgeB', len: 0.95 },
      { name: 'fissureLips', with: ['fissureLava'], len: FISSURE_W, top: 0.45, wade: true, flat: true },
    ],
    H: [{ name: 'beam', len: 0.72 }],
    W: [{ name: 'basalt', len: 1.5 }, { name: 'obsidian', len: 1.3 }],
    LW: { name: 'fissureWideLips', with: ['fissureWideLava'], len: FISSURE_W, top: 0.45, wade: true, flat: true },
    HW: { name: 'beamWide', len: 0.72 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    // the plain stays empty near the road: only now and then a little rubble
    // or a dead tree, and the big shapes stand far off
    const river = Math.sin(ctx.d0 * 0.004 + 1.3);
    for (const s of [-1, 1]) {
      if (rng.chance(0.35)) ctx.put(rng.chance(0.5) ? 'rubble' : 'rubbleB', s * rng.float(5.4, 13), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.7, 1.2) });
      if (rng.chance(0.1)) ctx.put('deadTree', s * rng.float(7, 16), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.3) });
      if (rng.chance(0.22)) ctx.put(rng.chance(0.5) ? 'columns' : 'columnsB', s * rng.float(18, 55), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.5) });
      if (rng.chance(0.12)) ctx.put(rng.chance(0.5) ? 'spire' : 'spireB', s * rng.float(45, 120), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.6) });
      if (rng.chance(0.18)) {
        const x = s * rng.float(10, 24);
        const z = rng.float(2, 14);
        const ry = rng.float(0, 6.28);
        const k = rng.float(0.7, 1.3);
        ctx.put('lavaPool', x, 0, z, { ry, s: k });
        ctx.put('crustRim', x, 0, z, { ry, s: k });
        ctx.put('pool', x, 0.06, z, { sx: 13 * k, sz: 10 * k, c: [0.9, 1, 1] });
        ctx.put('glow', x, 1.2, z, { s: 7 * k, c: [1, 0.42, 0.12] });
      }
      // a lava river winds alongside for long stretches on one side
      if ((s > 0) === (river > 0) && Math.abs(river) > 0.35) {
        const x = s * (24 + 6 * Math.abs(river));
        ctx.put('river', x, 0, 16, {});
        ctx.put('riverBank', x, 0, 16, {});
        if (ctx.index % 2 === 0) ctx.put('glow', x, 1.4, 8, { s: 9, c: [1, 0.4, 0.1] });
      }
    }
    if (ctx.index % 9 === 4 && rng.chance(0.7)) {
      const s = rng.chance(0.5) ? -1 : 1;
      const x = s * rng.float(100, 170);
      const z = rng.float(0, 16);
      ctx.put('volcano', x, -2, z, { ry: rng.float(0, 6.28), s: rng.float(1, 1.6) });
      ctx.put('smoke', x, 30, z, { ry: rng.float(0, 6.28), s: rng.float(1.2, 1.8) });
      ctx.put('glow', x, 30, z, { s: 40, c: [1, 0.35, 0.1] });
    }
    // later laps: more fire on the plain
    if (ctx.visit >= 1 && rng.chance(0.3)) {
      const s = rng.chance(0.5) ? -1 : 1;
      ctx.put('glow', s * rng.float(8, 30), rng.float(0.5, 3), rng.float(0, 16), { s: rng.float(2, 4), c: [1, 0.5, 0.15] });
    }
  },
};

// The ash: one strip out to the horizon (the road is packed darker by the
// ground pattern itself, the fissures only open beyond it).
function groundStripWide() {
  const g = new THREE.PlaneGeometry(320, 16, 1, 8);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -8);
  const pos = g.attributes.position.array;
  const uv = g.attributes.uv.array;
  for (let i = 0; i < pos.length / 3; i++) {
    uv[i * 2] = pos[i * 3];
    uv[i * 2 + 1] = -pos[i * 3 + 2];
  }
  return part(g, '#ffffff', { outline: 0 });
}
