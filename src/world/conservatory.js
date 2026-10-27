import * as THREE from '../../vendor/three/three.module.min.js';
import {
  P, part, merge,
  cypressParts, roundTreeParts, bushParts, potParts, lanternPostParts, gateFrameParts, gateLeafParts,
} from './shapes.js';
import { groundStrip, doorShape } from '../render/geo.js';

// IV · The Glasshouse — a white-ribbed greenhouse tunnel full of monstera,
// ferns, potted cypress, hanging vines with white blossom and orange trees,
// glowing in warm late light.

const C = {
  iron: '#eef6f0',
  ironShade: '#cfe0d8',
  leafDeep: '#1d6a48',
  leaf: '#3f9a63',
  leafHi: '#8fd27a',
  fern: '#2f8a52',
  fernHi: '#9ad66a',
  terracotta: '#c8693a',
  rim: '#a9532a',
  soil: '#4a3426',
  planter: '#e9efe6',
  orange: '#f28a2a',
  blossom: '#ffffff',
  blossomCore: '#ffd36a',
  wood: '#b98552',
  woodDark: '#7a5432',
  lawn: '#3f7a52',
  lantern: '#ffd27a',
};

const OPENING = { halfW: 4.4, rectH: 5.6, arch: true };
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
      grad: [C.leafDeep, C.leaf, h - 0.3, h + 0.2],
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

// --- obstacles --------------------------------------------------------------
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
    parts.push(part(P.sphere(0.2, 8, 6), null, { x, y: 0.7, z: Math.sin(i * 2.1) * 0.15, sy: 0.7, grad: [C.fern, C.fernHi, 0.55, 0.85] }));
    if (i % 2 === 0) parts.push(part(P.sphere(0.07, 6, 4), i % 4 === 0 ? C.blossom : '#ffb3c8', { x: x + 0.08, y: 0.86, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.4);
}

function hangingBasketGeo(half, baskets) {
  const parts = [];
  for (const s of [-1, 1]) parts.push(part(P.box(0.1, 2.8, 0.1), C.iron, { x: s * half, y: 1.4 }));
  parts.push(part(P.box(half * 2 + 0.2, 0.1, 0.1), C.iron, { y: 2.75 }));
  for (let i = 0; i < baskets; i++) {
    const x = -half + (half * 2 * (i + 0.5)) / baskets;
    parts.push(part(P.cyl(0.01, 0.01, 0.6, 3), '#2a3a34', { x, y: 2.45, outline: 0 }));
    parts.push(part(P.sphere(0.3, 10, 6, 0), C.terracotta, { x, y: 2.05, sy: 0.6 }));
    parts.push(...vineGeo(0.75, 3 + i).map((g) => g.translate(x - 0.15, 2.05, 0.05)));
    parts.push(...vineGeo(0.65, 11 + i).map((g) => g.translate(x + 0.17, 2.05, -0.05)));
    parts.push(part(P.sphere(0.32, 8, 6), null, { x, y: 2.2, sy: 0.6, grad: [C.leafDeep, C.leafHi, 2.0, 2.4] }));
  }
  return merge(parts).translate(0, 0, -0.2);
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

export default {
  id: 'conservatory',
  name: 'The Glasshouse',
  doorColor: '#2fa39a',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  env: {
    sky: ['#2f7f88', '#f6dfa0', '#4f8f74'],
    sun: { dir: [0.25, 0.22, -1], glow: '#ffe2a0', disc: '#fff6d8', size: 0.045 },
    stars: 0,
    light: { dir: [0.35, 0.78, 0.45], shadow: [0.55, 0.74, 0.72], hi: [1.1, 1.08, 0.94] },
    ink: '#0d3532',
    fog: [40, 185],
    ground: ['#dde8dc', '#c2dccf', '#86ad9c'],
    shadowDecal: [0.55, 0.7, 0.64],
    glass: ['#a8eadf', 0.12],
    glowGain: 0.7,
    particles: { color: '#ffffff', size: 2.0, drift: [0.12, -0.15, 0], opacity: 0.75 },
  },

  build(b) {
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 4);
    b.toon('lawn', groundStrip(420, 16, C.lawn, 8, { y: -0.04, mark: 0.4 }), { ink: 0, cap: 40, marks: [0.3, 0.3] });
    b.toon('rib', ribGeo(), { cap: 120, anim: 'rise', ink: 0.035 });
    b.toon('frameLong', frameLongGeo(), { cap: 40, anim: 'rise', ink: 0.035 });
    b.glass('glass', glassGeo(), { cap: 40, anim: 'rise' });
    b.toon('fern', merge(bushParts({ r: 0.62, lo: C.fern, hi: C.fernHi }).slice(0, 2)), { cap: 300, anim: 'pop', marks: [2, 1.6], wobble: [0.01, 0, 1.6, 0] });
    b.toon('monstera', merge(monsteraParts({ size: 1.2, leaves: 7, seed: 5 })), { cap: 160, anim: 'pop', wobble: [0.012, 0, 1.3, 0] });
    b.toon('potCypress', merge([...potParts({ r: 0.5, h: 0.75 }), ...cypressParts({ h: 4.4, r: 0.75, lo: C.leafDeep, hi: C.leafHi, trunkH: 1.2, seg: 8 }).map((g) => g.translate(0, 0.7, 0))]), { cap: 80, anim: 'pop', marks: [3, 2.4], wobble: [0.0015, 0, 1.1, 0] });
    b.toon('orangeTree', merge(orangeTreeParts()), { cap: 40, anim: 'pop', marks: [2.2, 2] });
    b.toon('vineLong', merge(vineGeo(2.6, 1)), { cap: 200, anim: 'popLate', wobble: [0.03, 0, 1.0, 0] });
    b.toon('vineShort', merge(vineGeo(1.5, 7)), { cap: 200, anim: 'popLate', wobble: [0.04, 0, 1.2, 0] });
    b.toon('gardenTree', merge(roundTreeParts({ r: 2.4, trunkH: 2.6, lo: '#1f5a3a', hi: '#5fae5a' })), { cap: 160, anim: 'pop', marks: [2.4, 2] });
    b.toon('cypress', merge(cypressParts({ h: 10, r: 1.4, lo: '#1f5a3a', hi: '#7fc25a', seg: 8 })), { cap: 200, anim: 'pop', marks: [3, 2.6], ink: 0 });
    b.toon('lantern', merge(lanternPostParts({ h: 2.6, pole: '#24453c', glass: C.lantern, cap: '#24453c' })), { cap: 40, anim: 'pop' });
    b.glow('glow', { cap: 80, anim: 'pop' });
    b.shadow('shadow', { cap: 220, anim: 'pop' });

    b.toon('potRow', potRowGeo(), { cap: 24, anim: 'popEarly', marks: [2, 1.6] });
    b.toon('planterBox', planterBoxGeo(1.9), { cap: 24, anim: 'popEarly' });
    b.toon('planterLong', planterBoxGeo(7.6), { cap: 10, anim: 'popEarly' });
    b.toon('hangingBasket', hangingBasketGeo(0.98, 2), { cap: 24, anim: 'popEarly', wobble: [0.01, 0, 1.3, 0] });
    b.toon('vineCurtain', hangingBasketGeo(3.95, 7), { cap: 10, anim: 'popEarly', wobble: [0.01, 0, 1.3, 0] });
    b.toon('bigMonstera', bigMonsteraGeo(), { cap: 24, anim: 'popEarly', wobble: [0.006, 0, 1.2, 0] });
    b.toon('bigOrange', merge(orangeTreeParts({ potR: 0.72, canopy: 1.2, trunk: 1.3 })).translate(0, 0, -0.75), { cap: 24, anim: 'popEarly', marks: [2.2, 2] });
    b.toon('pottingBench', pottingBenchGeo(), { cap: 24, anim: 'popEarly' });

    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.05, marks: [2.2, 2] });
    b.glass('gateGlass', gateGlassGeo(), { cap: 2 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff', depth: 0.28 })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  gateExtras: ['gateGlass'],

  obstacles: {
    L: [{ name: 'potRow', len: 0.7 }, { name: 'planterBox', len: 0.8 }],
    H: [{ name: 'hangingBasket', len: 0.4 }],
    W: [{ name: 'bigMonstera', len: 1.5 }, { name: 'bigOrange', len: 1.4 }, { name: 'pottingBench', len: 1.0 }],
    LW: { name: 'planterLong', len: 0.8 },
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
        // planter beds: ferns and monstera, the odd potted cypress
        for (let i = 0; i < 3; i++) {
          ctx.put('fern', s * rng.float(4.9, 5.9), 0.65, rng.float(0, 16), { s: rng.float(0.7, 1.15), ry: rng.float(0, 6.28), c: [rng.float(0.9, 1.1), 1, 1] });
        }
        if (rng.chance(0.75)) ctx.put('monstera', s * rng.float(5.2, 5.8), 0.7, rng.float(1, 15), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.15) });
        if (rng.chance(0.5)) ctx.put('potCypress', s * 5.4, 0.72, rng.float(2, 14), { s: rng.float(0.85, 1.1) });
        if ((ctx.index + (s > 0 ? 2 : 0)) % 4 === 1) {
          ctx.put('orangeTree', s * 5.4, 0.72, 8, { s: 0.9 });
        }
        // vines hang from the arches
        for (let i = 0; i < 3; i++) {
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
