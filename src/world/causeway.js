import {
  P, part, merge,
  cloudParts, rockParts, roundTreeParts, lanternPostParts, gateFrameParts, gateLeafParts, gateTop,
} from './shapes.js';
import { birdParts, whaleParts } from './whimsy.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';

// VI · The Sky Road — a sandstone causeway over a sea of amber cloud, low
// rolling ridges, floating islands and a huge low sun straight ahead.
// Harsh backlight: the sun sits dead ahead, so everything facing you falls
// into warm silhouette with a blazing golden rim, rays fan out of the sun and
// shadows stream back toward you. Returns bring flocks of birds, a ringed
// planet in a pink sky, then whales swimming through the clouds.

const C = {
  ridgeLo: '#c4602f',
  ridgeHi: '#f0955a',
  body: '#b9582e',
  bodyDark: '#7a3a1e',
  stone: '#f2c088',
  stoneDark: '#d39060',
  rockLo: '#6e3420',
  rockHi: '#d8784a',
  cloudLo: '#f08a4a',
  cloudHi: '#ffd59a',
  tree: '#7a2e1a',
  treeHi: '#c8603a',
  gold: '#ffd36a',
  lantern: '#ffe0a0',
};

const OPENING = { halfW: 4.6, rectH: 8.0, arch: true };
const GATE_DEPTH = 1.8;

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

function ridgeGeo(seed) {
  // Undulating rounded ridges along both road edges plus the causeway body.
  const rnd = seeded(seed);
  const parts = [];
  // causeway body under the road (no ink: its hull would peek through the road at seams)
  parts.push(part(P.box(9.2, 5, 16, 1, 1, 8), null, { y: -2.52, z: -8, grad: [C.bodyDark, C.body, -5, 0], outline: 0 }));
  parts.push(part(P.box(6.4, 8, 16, 1, 1, 8), C.bodyDark, { y: -9, z: -8, outline: 0 }));
  for (const s of [-1, 1]) {
    let z = 0;
    while (z < 16) {
      const len = 2.6 + rnd() * 3.2;
      const h = 0.6 + rnd() * 1.6;
      parts.push(part(P.sphere(1, 12, 8), null, {
        x: s * (5.0 + rnd() * 0.6), y: 0, z: -(z + len / 2),
        sx: 0.9 + rnd() * 0.5, sy: h, sz: len * 0.62,
        grad: [C.ridgeLo, C.ridgeHi, -0.2, h * 0.9],
      }));
      z += len * 0.78;
    }
  }
  return merge(parts);
}

function islandGeo(seed) {
  const rnd = seeded(seed);
  const parts = [...rockParts({ r: 3, lo: C.rockLo, hi: C.rockHi, sx: 1.4, sy: 1.1, sz: 1.2, seed })].map((g) => g.translate(0, -3.6, 0));
  parts.push(part(P.cyl(3.6, 3.2, 0.6, 12), null, { y: 0, grad: [C.rockHi, '#f6b070', -0.3, 0.3] }));
  for (let i = 0; i < 3; i++) {
    const a = rnd() * 6.28;
    const r = rnd() * 2.2;
    parts.push(...roundTreeParts({ r: 0.7 + rnd() * 0.4, trunkH: 0.8, lo: C.tree, hi: C.treeHi, trunk: '#4a1e10', mark: 0.5 }).map((g) => g.translate(Math.cos(a) * r, 0.3, Math.sin(a) * r)));
  }
  return merge(parts);
}

function mesaGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const h = 40;
  parts.push(part(P.cyl(6, 9, h, 9), null, { y: h / 2 - 30, grad: [C.bodyDark, C.ridgeLo, -30, h - 30] }));
  parts.push(part(P.cyl(6.4, 6, 1.2, 9), C.ridgeHi, { y: h - 30 }));
  for (let i = 0; i < 3; i++) parts.push(part(P.cyl(1.2 + rnd(), 2 + rnd(), 6, 7), C.ridgeLo, { x: (rnd() - 0.5) * 8, y: h - 30 + 2, z: (rnd() - 0.5) * 6 }));
  return merge(parts);
}

function archGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(1.0, 6.2, 1.2), C.stone, { x: s * 5.6, y: 3.1 }));
    parts.push(part(P.box(1.3, 0.4, 1.5), C.stoneDark, { x: s * 5.6, y: 0.2 }));
  }
  parts.push(part(P.torus(5.6, 0.55, 6, 24, Math.PI), C.stone, { y: 6.2, sz: 1.1 }));
  parts.push(part(P.box(1.1, 1.3, 1.3), C.stoneDark, { y: 11.9 }));
  parts.push(part(P.cyl(0.45, 0.45, 0.2, 14), C.gold, { y: 11.9, z: 0.7, rx: Math.PI / 2, emit: 1 }));
  return merge(parts);
}

// --- obstacles --------------------------------------------------------------
function rockPileGeo() {
  return merge([
    ...rockParts({ r: 0.5, lo: C.rockLo, hi: C.rockHi, sy: 0.85, seed: 1 }).map((g) => g.translate(-0.5, 0, 0)),
    ...rockParts({ r: 0.42, lo: C.rockLo, hi: C.rockHi, sy: 0.8, seed: 2 }).map((g) => g.translate(0.45, 0, 0.1)),
    ...rockParts({ r: 0.32, lo: C.rockLo, hi: C.rockHi, sy: 0.9, seed: 3 }).map((g) => g.translate(0.05, 0.25, -0.15)),
  ]).translate(0, 0, -0.5);
}

function stoneBlockGeo(width) {
  const parts = [
    part(P.box(width, 0.62, 0.6), C.stone, { y: 0.31 }),
    part(P.cyl(0.3, 0.3, width, 12), C.stoneDark, { y: 0.62, rz: Math.PI / 2, sy: 0.9 }),
    part(P.box(width + 0.12, 0.12, 0.7), C.stoneDark, { y: 0.06 }),
  ];
  const n = Math.max(1, Math.round(width / 2.2));
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + (width * (i + 0.5)) / n;
    parts.push(part(P.cyl(0.18, 0.18, 0.06, 14), C.gold, { x, y: 0.36, z: 0.31, rx: Math.PI / 2, emit: 0.6, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.3);
}

// Stone lintel on two posts: a heavy beam whose underside is the duck line,
// open road beneath. Used for both the one-lane and full-width versions.
function lintelGeo(half) {
  const D = CONFIG.duckLine;
  const beamH = 0.66;
  const top = D + beamH;
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.5, top, 0.7), C.stone, { x: s * half, y: top / 2 }));
    parts.push(part(P.box(0.66, 0.3, 0.86), C.stoneDark, { x: s * half, y: 0.15 }));
  }
  parts.push(part(P.box(half * 2 + 0.7, beamH, 0.72), C.stone, { y: D + beamH / 2 }));
  parts.push(part(P.box(half * 2 + 0.9, 0.16, 0.86), C.stoneDark, { y: top + 0.08 }));
  parts.push(part(P.box(half * 2 + 0.5, 0.08, 0.76), C.stoneDark, { y: D + 0.04, outline: 0.5 }));
  const n = Math.max(1, Math.round(half * 1.3));
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -half + 0.5 + ((half * 2 - 1) * i) / (n - 1);
    parts.push(part(P.cyl(0.19, 0.19, 0.08, 14), C.gold, { x, y: D + beamH / 2, z: 0.38, rx: Math.PI / 2, emit: 0.7, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.36);
}

function pillarGeo() {
  return merge([
    part(P.box(1.5, 0.4, 1.5), C.stoneDark, { y: 0.2 }),
    part(P.cyl(0.52, 0.66, 3.6, 4), C.stone, { y: 2.2, ry: Math.PI / 4 }),
    part(P.cone(0.55, 0.9, 4), C.stoneDark, { y: 4.45, ry: Math.PI / 4 }),
    part(P.cyl(0.24, 0.24, 0.08, 14), C.gold, { y: 2.9, z: 0.5, rx: Math.PI / 2, emit: 0.7, outline: 0.5 }),
  ]).translate(0, 0, -0.75);
}

function spireGeo() {
  const parts = [];
  let y = 0;
  const sizes = [0.95, 0.8, 0.68, 0.55, 0.42];
  sizes.forEach((r, i) => {
    parts.push(...rockParts({ r, lo: C.rockLo, hi: C.rockHi, sy: 1.1, seed: 20 + i }).map((g) => g.translate((i % 2 ? 0.12 : -0.1), y, 0)));
    y += r * 1.45;
  });
  return merge(parts).translate(0, 0, -0.9);
}

function gateGeo() {
  const parts = [...gateFrameParts(OPENING, { thick: 1.4, depth: GATE_DEPTH, color: C.stone })];
  const top = gateTop(OPENING);
  parts.push(part(P.box(1.4, 1.6, GATE_DEPTH + 0.3), C.stoneDark, { y: top + 0.9 }));
  parts.push(part(P.cyl(1.4, 1.4, 0.3, 24), C.gold, { y: top + 2.6, rx: Math.PI / 2, emit: 1 }));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push(part(P.box(0.18, 0.7, 0.2), C.gold, { x: Math.cos(a) * 1.85, y: top + 2.6 + Math.sin(a) * 1.85, rz: a - Math.PI / 2, emit: 1, outline: 0.5 }));
  }
  for (const s of [-1, 1]) {
    parts.push(part(P.box(2.0, 0.6, GATE_DEPTH + 0.6), C.stoneDark, { x: s * (OPENING.halfW + 0.7), y: 0.3 }));
    parts.push(...[pillarGeo()].map((g) => g.translate(s * (OPENING.halfW + 3.4), 0, 0.8)));
  }
  return merge(parts);
}

export default {
  id: 'causeway',
  name: 'The Sky Road',
  doorColor: '#f0843a',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  env: {
    sky: ['#4a1a10', '#ffb84a', '#f39a40'],
    sun: { dir: [0, 0.1, -1], glow: '#ffcf70', disc: '#fff4c8', size: 0.07 },
    stars: 0.35,
    skyFx: { rays: 0.9, clouds: 0.42 },
    // harsh: hard terminator, light straight at you, golden rims
    light: { dir: [0.05, 0.32, -1], shadow: [0.66, 0.42, 0.5], hi: [1.1, 1.0, 0.85], soft: 0.012, wrap: 0, hiAmt: 0, lift: 0.7 },
    rim: [1.0, 0.72, 0.3, 0.4],
    mist: { color: '#ffb060', amount: 0.6, top: -1, fade: 10, near: 18, far: 90 },
    grade: { sat: 1.15, contrast: 1.1, vignette: 0.42, exposure: 1.03, tint: '#4a1206' },
    ink: '#4a1a0a',
    fog: [55, 205],
    ground: ['#eaa96b', '#fbe0b4', '#c97f4c'],
    shadowDecal: [0.7, 0.46, 0.42],
    cast: [-0.1, 1.5],
    glowGain: 0.6,
    particles: { color: '#ffd890', size: 1.9, drift: [0.05, 0.4, 0], opacity: 0.8 },
  },

  visits: [
    { env: { sun: { glow: '#ffb060' }, skyFx: { rays: 1.0, clouds: 0.5 } } },
    {
      env: {
        sky: ['#2a1040', '#ff9a7a', '#c86a8a'],
        sun: { dir: [0.15, 0.08, -1], glow: '#ff9aa0', disc: '#ffe8e0' },
        stars: 0.7,
        moon: { dir: [-0.32, 0.36, -1], color: '#f6a8c8', size: 0.1 },
        skyFx: { ring: 1 },
        rim: [1.0, 0.6, 0.6, 0.42],
        light: { shadow: [0.6, 0.42, 0.62] },
        mist: { color: '#ff9ab0' },
        ground: ['#e8a08a', '#ffd8c8', '#b86a6a'],
        grade: { tint: '#3a0a30' },
        particles: { color: '#ffd0e0', size: 2.2, drift: [0.1, 0.3, 0], opacity: 0.85 },
      },
    },
    {
      env: {
        sky: ['#120a30', '#e87a6a', '#6a4a9a'],
        sun: { glow: '#ff7a9a' },
        stars: 1,
        skyFx: { rays: 0.7, clouds: 0.5, aurora: 0.2 },
        mist: { color: '#b07ad0' },
        trip: [0.08, 0.35, 0.12],
      },
    },
  ],

  build(b) {
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 5);
    b.toon('cloudSea', groundStrip(420, 16, '#f2a04a', 8, { y: -15 }), { ink: 0, cap: 40 });
    b.toon('ridgeA', ridgeGeo(3), { cap: 40, anim: 'rise', ink: 0.05 });
    b.toon('ridgeB', ridgeGeo(8), { cap: 40, anim: 'rise', ink: 0.05 });
    b.toon('cloud', merge(cloudParts({ r: 3, lo: C.cloudLo, hi: C.cloudHi })), { cap: 240, anim: 'lift', wobble: [0, 0.5, 0.4, 0], ink: 0.05 });
    b.toon('island', islandGeo(4), { cap: 60, anim: 'liftFar', wobble: [0, 0.7, 0.35, 0], marks: [2, 2] });
    b.toon('islandB', islandGeo(12), { cap: 60, anim: 'liftFar', wobble: [0, 0.6, 0.3, 0], marks: [2, 2] });
    b.toon('mesa', mesaGeo(2), { cap: 40, anim: 'liftFar', ink: 0 });
    b.toon('arch', archGeo(), { cap: 12, anim: 'popLate' });
    b.toon('lantern', merge(lanternPostParts({ h: 2.4, pole: '#5a2a16', glass: C.lantern, cap: '#5a2a16' })), { cap: 40, anim: 'pop' });
    b.glow('glow', { cap: 60, anim: 'pop' });
    b.shadow('shadow', { cap: 120, anim: 'pop' });
    b.toon('bird', merge(birdParts({ color: '#4a1a10' })), { cap: 160, anim: 'lift', fly: [0.85, 7.5, 1.2, 0.5], ink: 0.02 });
    b.toon('whale', merge(whaleParts()), { cap: 24, anim: 'liftFar', fly: [0, 0, 4, 0.06], wobble: [0, 0.8, 0.25, 0] });

    b.toon('rockPile', rockPileGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('stoneBlock', stoneBlockGeo(1.9), { cap: 24, anim: 'popEarly' });
    b.toon('stoneWall', stoneBlockGeo(7.6), { cap: 10, anim: 'popEarly' });
    b.toon('lintel', lintelGeo(0.95), { cap: 24, anim: 'popEarly' });
    b.toon('archWide', lintelGeo(4.0), { cap: 10, anim: 'popEarly' });
    b.toon('pillar', pillarGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('spire', spireGeo(), { cap: 24, anim: 'popEarly' });

    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'rockPile', len: 1.0 }, { name: 'stoneBlock', len: 0.6 }],
    H: [{ name: 'lintel', len: 0.72 }],
    W: [{ name: 'pillar', len: 1.5 }, { name: 'spire', len: 1.8 }],
    LW: { name: 'stoneWall', len: 0.6 },
    HW: { name: 'archWide', len: 0.72 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0);
    ctx.put('cloudSea', 0, 0, 0);
    if (rng.chance(0.5)) ctx.put('ridgeA', 0, 0, 0);
    else ctx.put('ridgeB', 0, 0, 16, { ry: Math.PI });
    if (!ctx.continuation && ctx.index % 6 === 3 && ctx.toEnd > 32) ctx.put('arch', 0, 0, 8);
    for (const s of [-1, 1]) {
      if ((ctx.index + (s > 0 ? 1 : 0)) % 2 === 0) {
        ctx.put('lantern', s * 4.7, 0, 9);
        ctx.put('glow', s * 4.7, 2.6, 9, { s: 2.0, c: [1, 0.8, 0.45] });
      }
      for (let i = 0; i < 2; i++) {
        const below = rng.chance(0.6);
        ctx.put('cloud', s * rng.float(12, 80), below ? rng.float(-13, -6) : rng.float(-2, 14), rng.float(0, 16), {
          s: rng.float(0.8, 2.0), ry: rng.float(0, 6.28), c: below ? [1, 1, 1] : [1.05, 1.02, 1],
        });
      }
      if (rng.chance(0.4)) {
        ctx.put(rng.chance(0.5) ? 'island' : 'islandB', s * rng.float(16, 60), rng.float(-4, 14), rng.float(0, 16), { s: rng.float(0.6, 1.4), ry: rng.float(0, 6.28) });
      }
      if (rng.chance(0.18)) ctx.put('mesa', s * rng.float(80, 140), rng.float(-10, 4), rng.float(0, 16), { s: rng.float(0.8, 1.6), ry: rng.float(0, 6.28) });
      // later laps: flocks wheeling over the clouds, then whales
      if (ctx.visit >= 1 && rng.chance(0.55)) {
        const fx = s * rng.float(9, 40);
        const fy = rng.float(4, 16);
        const fz = rng.float(0, 16);
        const heading = rng.chance(0.5) ? 0 : Math.PI;
        for (let i = 0; i < rng.int(3, 6); i++) {
          ctx.put('bird', fx + rng.float(-3, 3), fy + rng.float(-1.2, 1.2), fz + rng.float(-3, 3), { ry: heading + rng.float(-0.3, 0.3), s: rng.float(0.9, 1.4), p0: rng.float(0, 6.28) });
        }
      }
      if (ctx.visit >= 3 && ctx.index % 4 === (s > 0 ? 1 : 3)) {
        ctx.put('whale', s * rng.float(28, 60), rng.float(-4, 12), rng.float(0, 16), { s: rng.float(1.2, 2.0), ry: rng.chance(0.5) ? 0.3 : Math.PI - 0.3, c: [1, 1, 1] });
      }
    }

  },
};
