import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, rgb, rockParts, gateFrameParts, gateLeafParts, gateTop } from './shapes.js';
import { crystal, crystalPoint, nugget, lumps, bipyramid } from './gems.js';
import { CONFIG } from '../config.js';

// X · The Red Drift — out among the stars, on a little world of red dust:
// regolith half Mars and half moon, rust-red sand and grey basalt flats
// pocked with craters, under a sky that is the whole universe - stars all
// the way round, a nebula flowing across it in ribbons of pink, orange and
// blue, spiral galaxies turning, and planets: a ringed giant, an ice giant
// blazing magenta at its rim, a blue marble low on the horizon, moons - all
// of them ebbing in closer and drifting away again (see world/planets.js),
// while smaller moons sail by on either side. Red buttes stand on the
// curved horizon, hoodoos and boulders by the road, violet crystals glowing
// in the dust, little asteroids tumbling overhead.
//
// The gravity is low (def.lowGravity, see game/drift.js and Player): the
// jump is a boost - a burst of a thruster flings the runner up and on, they
// hang flying over the top and drift back down - and on the ground they
// take a few steps and bound off in a long low lope. Obstacles: asteroids
// tumbling low over the dust and boulders to boost over; UFOs and big
// asteroids hanging at head height to stay low under (skim under them, or
// drive yourself down out of the air in time); rock pillars and crystal
// spires to go round. A belt of asteroids across the whole road, and a
// mothership.
//
// Coming in through its doorway the runner jumps to light speed (env.warp,
// see game/warp.js) - and drops out of it onto the red dust.

const C = {
  rustLo: '#5a1c14',
  rust: '#9a3a24',
  rustHi: '#d86a42',
  sand: '#e08a5a',
  basalt: '#3a2630',
  basaltHi: '#7a5a62',
  strata: ['#7a2a1c', '#a8442a', '#c9603a', '#8a3420', '#e0804e', '#b04c2e'],
  rock: '#6e3a2e',
  rockHi: '#b8705a',
  rockDark: '#3a1e1a',
  astLo: '#3e2e30',
  astHi: '#9a8584',
  astDust: '#b0644a',
  violet: '#8a5cff',
  violetHi: '#e2d0ff',
  violetDeep: '#4a2a9a',
  cyan: '#58e8ff',
  hull: '#c3cbe0',
  hullHi: '#f2f5ff',
  hullDark: '#4a5272',
  dome: '#7df4ff',
  gold: '#ffcf5a',
  pink: '#ff6ac8',
};

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// --- gems ---------------------------------------------------------------------------
// Green from the sky: moldavite above all - glass flung up and fused when a
// meteorite struck, wrinkled and pitted, glowing bottle-green - with
// peridot (the gem that falls to earth in meteorites), pallasite (iron from
// the heart of a broken world, studded with olivine), and green tektite
// beads. The only green under all that red. The crown: a fallen star, five
// points of moldavite.
const MOLDAVITE = { mottle: 0.55, second: '#c8ff9a', rough: 0.45, speckle: 0.12, scale: 6, glints: 1.2 };
function fallenStar() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const g = crystalPoint({ r: 0.07, len: 0.26, tip: 0.1, sides: 5, seed: 41 + i, jitter: 0.12 });
    out.push(crystal(g, { rz: (i / 5) * Math.PI * 2, y: 0 }));
  }
  out.push(crystal(nugget({ r: [0.11, 0.11, 0.08], faces: 12, spread: 0.12, chips: 1, seed: 6 })));
  return out;
}
const GEM = {
  name: 'moldavite',
  color: '#7dff6a',
  stones: [
    {
      name: 'moldavite',
      weight: 3,
      tints: ['#4ed848', '#5ee85a', '#3cc63e'],
      parts: () => [crystal(nugget({ r: [0.23, 0.17, 0.18], faces: 26, spread: 0.14, chips: 3, seed: 17 }), { rz: 0.3 })],
      texture: MOLDAVITE,
    },
    {
      name: 'peridot',
      weight: 1.5,
      tints: ['#b0f040', '#a4e83a', '#c0f458'],
      parts: () => [crystal(bipyramid({ r: 0.17, h: 0.3, sides: 8 }), { rz: 0.2 })],
      texture: { mottle: 0.25, second: '#f0ffb0', rough: 0.2, speckle: 0.06, glints: 1.3 },
    },
    {
      // iron from a broken world's heart, studded with olivine
      name: 'pallasite',
      weight: 1.2,
      tints: ['#8a9a7a', '#7e9070', '#96a684'],
      parts: () => [crystal(nugget({ r: [0.22, 0.16, 0.2], faces: 10, spread: 0.22, chips: 2, seed: 29 }), { rz: -0.3 })],
      texture: { metal: 0.75, opaque: 0.55, mottle: 0.9, second: '#9cff5a', speckle: 0.35, rough: 0.3, glints: 1.5, scale: 9 },
    },
    {
      name: 'tektite',
      weight: 1,
      tints: ['#2ea84a', '#36b454', '#269a40'],
      parts: () => lumps({ n: 4, r: 0.11, spread: 0.1, seed: 13 }).map((g) => crystal(g)),
      texture: { mottle: 0.4, second: '#9af0a0', rough: 0.25, opaque: 0.3, glints: 1.1 },
    },
  ],
  crown: {
    name: 'fallen star',
    tints: ['#5ef05a', '#6ef86a', '#4ee04e'],
    parts: () => fallenStar(),
    texture: MOLDAVITE,
  },
  motion: [0.8, 1.1, 0.16, 0.25],
  look: [0.85, 1.2, 0.25, 0.3],
  glow: 0.75,
  pool: 0.35,
};

// --- shapes -------------------------------------------------------------------------
// A plain of regolith out to the edge of the little world.
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

// A lumpy, cratered body (an asteroid): an icosahedron pushed in and out
// into a potato, a few craters dished into it with raised rims, faceted;
// coloured from lo to hi up it, its craters darker, a dusting of red on
// what faces up. Never more than 5% past r, so it stays where it's put.
function asteroidPart(r, seed, { lo = C.astLo, hi = C.astHi, dust = C.astDust, detail = 1, y = 0, x = 0, z = 0, lump = 0.14 } = {}) {
  const rnd = seeded(seed * 7919 + 11);
  const g = new THREE.IcosahedronGeometry(r, detail);
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const fq = [1.4 + rnd() * 1.2, 1.6 + rnd() * 1.4, 2.2 + rnd() * 1.6];
  const craters = [];
  for (let i = 0; i < 4; i++) {
    const v = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    craters.push({ v, size: 0.3 + rnd() * 0.35 });
  }
  const pos = g.attributes.position;
  const shade = new Float32Array(pos.count);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    let d = 0.5 * Math.sin(fq[0] * n.x * 2.4 + ph[0]) * Math.sin(fq[1] * n.y * 2.2 + ph[1]) + 0.35 * Math.sin(fq[2] * n.z * 3 + ph[2]);
    let s = 1;
    for (const c of craters) {
      const a = Math.acos(Math.min(1, Math.max(-1, n.dot(c.v))));
      if (a < c.size) {
        const k = 1 - (a / c.size) ** 2;
        d -= 0.9 * k;
        s *= 1 - 0.35 * k;
      } else if (a < c.size * 1.35) d += 0.25 * (1 - (a - c.size) / (c.size * 0.35));
    }
    const disp = Math.min(1.05, Math.max(0.8, 1 + lump * d));
    pos.setXYZ(i, n.x * r * disp, n.y * r * disp, n.z * r * disp);
    shade[i] = s * (0.88 + 0.24 * rnd());
  }
  g.computeVertexNormals();
  const out = part(g, null, { grad: [lo, hi, -r, r * 0.8], x, y, z });
  const col = out.attributes.color.array;
  const nor = out.attributes.normal.array;
  const D = rgb(dust);
  for (let i = 0; i < shade.length; i++) {
    const up = Math.max(0, nor[i * 3 + 1]);
    for (let k = 0; k < 3; k++) {
      const c = col[i * 3 + k] * shade[i];
      col[i * 3 + k] = c + (D[k] - c) * up * up * 0.35;
    }
  }
  return out;
}

// Boulders: a heap of rust-red rock.
function boulderGeo(seed, k = 1) {
  const rnd = seeded(seed);
  const parts = [];
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = (0.35 + rnd() * 0.5) * k;
    parts.push(...rockParts({ r, lo: C.rockDark, hi: C.rockHi, sy: 0.7 + rnd() * 0.3, seed: seed * 10 + i }).map((g) => g.translate((rnd() - 0.5) * 1.6 * k, 0, (rnd() - 0.5) * 1.2 * k)));
  }
  return merge(parts);
}

// A hoodoo: a column of soft red rock eroded into bulges and waists, banded
// with strata, a harder cap rock balanced on top.
function hoodooParts(h, r, seed, { x = 0, z = 0 } = {}) {
  const rnd = seeded(seed);
  const prof = [[0, 0], [r * 1.25, 0]];
  const n = 7;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const waist = 0.72 + 0.28 * Math.sin(t * 9 + rnd() * 2) * (1 - t * 0.3);
    prof.push([r * waist * (1 - 0.25 * t), h * t]);
  }
  prof.push([0, h]);
  const parts = [part(P.lathe(prof, 9), null, { x, z, grad: [C.rustLo, C.rustHi, 0, h], mark: 0.6 })];
  for (let i = 0; i < 3; i++) {
    const y = h * (0.2 + 0.25 * i + rnd() * 0.08);
    parts.push(part(P.cyl(r * 0.95, r, 0.16, 9), C.strata[(seed + i) % C.strata.length], { x, y, z, outline: 0.4 }));
  }
  parts.push(part(P.cyl(r * 0.95, r * 1.15, r * 0.45, 7), C.basalt, { x, y: h + r * 0.15, z, ry: rnd() * 2 }));
  return parts;
}

// A butte on the curved horizon: layered red rock, a flat cap.
function butteGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  let y = -20;
  let r = 18 + rnd() * 6;
  const layers = 6;
  for (let i = 0; i < layers; i++) {
    const h = 4 + rnd() * 5;
    const r2 = r * (0.86 + rnd() * 0.08);
    parts.push(part(P.cyl(r2, r, h, 10), C.strata[(i + seed) % C.strata.length], { y: y + h / 2, ry: rnd() * 2, outline: 0.6 }));
    y += h;
    r = r2 * (i === layers - 2 ? 0.98 : 0.96);
  }
  parts.push(part(P.cyl(r * 0.98, r, 1.4, 10), C.basalt, { y: y + 0.7 }));
  return merge(parts);
}

// A natural arch of red rock, spanning the road high overhead.
function archGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(...hoodooParts(7.5, 1.6, s > 0 ? 3 : 8, { x: s * 7.2 }));
  }
  // the span: a thick curve of rock
  const span = new THREE.TorusGeometry(7.2, 1.25, 7, 18, Math.PI);
  parts.push(part(span, null, { y: 6.2, sz: 1.2, grad: [C.rust, C.rustHi, 6, 14] }));
  parts.push(part(P.torus(7.2, 1.3, 5, 18, Math.PI), C.strata[3], { y: 6.2, sz: 0.5, sy: 1.02, outline: 0.4 }));
  return merge(parts);
}

// A crater's rim: a low ring of ridged rock and dust.
function craterRimGeo(seed) {
  const rnd = seeded(seed);
  const g = new THREE.TorusGeometry(5, 1.1, 6, 26);
  g.rotateX(Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.18 * Math.sin(a * 5 + seed) + 0.1 * Math.sin(a * 11 + seed * 2);
    pos.setXYZ(i, x * (1 + 0.04 * Math.sin(a * 7)), Math.max(-0.3, y * 0.45 * k + 0.18), z);
  }
  g.computeVertexNormals();
  const parts = [part(g, null, { grad: [C.rust, C.sand, -0.2, 0.7], mark: 0.4 })];
  for (let i = 0; i < 4; i++) {
    const a = rnd() * 6.28;
    parts.push(...rockParts({ r: 0.35 + rnd() * 0.4, lo: C.rockDark, hi: C.rockHi, seed: seed + i }).map((q) => q.translate(Math.cos(a) * 5.4, 0.15, Math.sin(a) * 5.4)));
  }
  return merge(parts);
}

// Violet crystals growing out of the dust, lit from within.
function crystalsGeo(seed, k = 1) {
  const rnd = seeded(seed);
  const parts = [...rockParts({ r: 0.5 * k, lo: C.basalt, hi: C.basaltHi, sy: 0.5, seed })];
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const len = (0.7 + rnd() * 1.3) * k;
    const g = crystalPoint({ r: (0.12 + rnd() * 0.1) * k, len, tip: 0.25 * k, sides: 6, seed: seed * 3 + i });
    const a = rnd() * 6.28;
    parts.push(part(g, null, {
      x: Math.cos(a) * 0.25 * k, z: Math.sin(a) * 0.25 * k, y: 0.15 * k,
      rx: (rnd() - 0.5) * 0.9, rz: (rnd() - 0.5) * 0.9,
      grad: [C.violetDeep, C.violetHi, 0, len], emit: 0.55,
    }));
  }
  return merge(parts);
}

// A small moon sailing by: a banded globe (and now and then a ring).
function moonletGeo(variant) {
  const pal = [
    ['#f2c9a0', '#e07a5a', '#fbe8cc', '#c45a4a'],
    ['#9ad8e8', '#5a8ad0', '#e8f6ff', '#3a5aa0'],
    ['#e8b0d8', '#a070c8', '#ffe0f0', '#7a4aa0'],
  ][variant % 3];
  const g = new THREE.SphereGeometry(1, 22, 16);
  const parts = [part(g, '#ffffff')];
  const out = parts[0];
  const pos = out.attributes.position.array;
  const col = out.attributes.color.array;
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    const b = Math.floor((y + 1) * 3.2 + Math.sin(pos[i * 3] * 3 + variant) * 0.4);
    const c = rgb(pal[((b % 4) + 4) % 4]);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  if (variant % 3 !== 1) parts.push(part(P.torus(1.75, 0.22, 3, 40), pal[2], { rx: Math.PI / 2 + 0.35, rz: 0.2, sy: 0.12, outline: 0.4 }));
  return merge(parts);
}

// A ring of little moonlets turning round the top of the doorway.
function gateOrbitGeo(n, R) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(asteroidPart(0.3 + 0.12 * (i % 2), 30 + i, { x: Math.cos(a) * R, y: Math.sin(a) * R }));
  }
  return merge(parts);
}

// A little astronaut, adrift (later laps).
function astronautGeo() {
  const W = '#f4f2ee';
  const parts = [
    part(P.capsule(0.22, 0.32, 4, 10), W, { y: 0.55 }),
    part(P.box(0.34, 0.4, 0.18), '#d8d4ce', { y: 0.6, z: 0.2 }),
    part(P.sphere(0.21, 12, 10), W, { y: 0.98 }),
    part(P.sphere(0.15, 10, 8), C.gold, { y: 0.98, z: -0.1, sz: 0.6, emit: 0.35 }),
  ];
  for (const s of [-1, 1]) {
    parts.push(part(P.capsule(0.08, 0.3, 3, 8), W, { x: s * 0.3, y: 0.62, rz: s * 0.9 }));
    parts.push(part(P.capsule(0.09, 0.32, 3, 8), W, { x: s * 0.11, y: 0.18, rz: s * 0.2, rx: s * 0.3 }));
  }
  return merge(parts);
}

// --- obstacles ----------------------------------------------------------------------
const OB_Y = 0.08; // a low asteroid floats this far off the dust

// An asteroid tumbling low over the dust: boost over it.
function asteroidLowGeo(seed) {
  return merge([asteroidPart(0.43, seed, { y: OB_Y + 0.43 })]).translate(0, 0, -0.45);
}

// A belt of them across the whole road, hovering.
function asteroidBeltGeo() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const x = -3.6 + i * 1.2;
    const r = i % 2 ? 0.4 : 0.44;
    parts.push(asteroidPart(r, 50 + i, { x, y: OB_Y + r + (i % 3) * 0.02, z: (i % 2 ? 0.15 : -0.1) }));
  }
  return merge(parts).translate(0, 0, -0.5);
}

// A UFO hanging at head height: a silver saucer, its rim strung with
// lights, a glowing dome on top and its engine glowing under it. Keep low
// under it. It spins; it bobs a little (never lower than the duck line).
const UFO_Y = CONFIG.duckLine + 0.08;
function ufoParts(rad = 1.06) {
  const k = rad / 1.06;
  const prof = [
    [0, 0], [0.3, 0.015], [0.6, 0.09], [0.92, 0.22], [1.06, 0.31], [0.94, 0.4], [0.62, 0.5], [0.38, 0.54], [0, 0.56],
  ].map(([r, y]) => [r * k, y * k]);
  const parts = [
    part(P.lathe(prof, 28), null, { grad: [C.hullDark, C.hullHi, 0, 0.56 * k] }),
    part(P.torus(1.02 * k, 0.07 * k, 6, 32), C.hullDark, { y: 0.31 * k, rx: Math.PI / 2 }),
    part(P.cyl(0.32 * k, 0.36 * k, 0.04, 20), C.cyan, { y: 0.005, emit: 1, outline: 0 }),
    part(new THREE.SphereGeometry(0.44 * k, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), C.dome, { y: 0.5 * k, emit: 0.55 }),
    part(P.cyl(0.02, 0.02, 0.32 * k, 5), C.hullDark, { y: 1.08 * k }),
    part(P.sphere(0.06 * k, 8, 6), C.pink, { y: 1.25 * k, emit: 1 }),
  ];
  const lights = [C.cyan, C.gold, C.pink];
  const n = Math.round(10 * k);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts.push(part(P.sphere(0.07 * k, 8, 6), lights[i % 3], { x: Math.cos(a) * 1.0 * k, y: 0.31 * k, z: Math.sin(a) * 1.0 * k, emit: 1, outline: 0.4 }));
  }
  return parts;
}
function ufoGeo() {
  return merge(ufoParts()).translate(0, UFO_Y, -0.8);
}

// The mothership: a great flattened saucer right across the road, rows of
// lights, a long glowing dome, engines glowing under it.
function mothershipGeo() {
  const parts = [
    part(P.sphere(1, 36, 14), null, { sx: 4.9, sy: 0.4, sz: 1.2, y: UFO_Y + 0.4, grad: [C.hullDark, C.hullHi, UFO_Y, UFO_Y + 0.8] }),
    part(P.torus(1, 0.05, 6, 48), C.hullDark, { sx: 4.85, sz: 1.17, y: UFO_Y + 0.4, rx: Math.PI / 2, outline: 0.5 }),
    part(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), C.dome, { sx: 2.1, sy: 0.55, sz: 0.62, y: UFO_Y + 0.7, emit: 0.5 }),
  ];
  const lights = [C.cyan, C.gold, C.pink];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    parts.push(part(P.sphere(0.08, 8, 6), lights[i % 3], { x: Math.cos(a) * 4.85, y: UFO_Y + 0.4, z: Math.sin(a) * 1.17, emit: 1, outline: 0.4 }));
  }
  for (const x of [-2.8, 0, 2.8]) parts.push(part(P.cyl(0.42, 0.46, 0.04, 18), C.cyan, { x, y: UFO_Y + 0.02, emit: 1, outline: 0 }));
  return merge(parts).translate(0, 0, -0.9);
}

// A great asteroid hanging at head height: stay under it.
const BIG_R = 0.95;
const BIG_Y = UFO_Y + BIG_R * 1.06;
function asteroidHighGeo(seed) {
  return merge([asteroidPart(BIG_R, seed, { y: BIG_Y, detail: 1, lump: 0.16 })]).translate(0, 0, -0.8);
}

// A rock pillar (go round): a tall hoodoo of red rock.
function pillarGeo(seed) {
  return merge([
    ...rockParts({ r: 0.6, lo: C.rockDark, hi: C.rock, sy: 0.5, seed }).map((g) => g.translate(0.35, 0, 0.2)),
    ...hoodooParts(6.2, 0.82, seed),
  ]).translate(0, 0, -0.75);
}

// A spire of dark rock crowned with violet crystal (go round).
function spireGeo(seed) {
  const rnd = seeded(seed);
  const parts = [part(P.cyl(0.25, 0.85, 4.6, 7), null, { y: 2.3, grad: [C.basalt, C.basaltHi, 0, 4.6], ry: rnd() })];
  parts.push(part(P.cyl(0.95, 1.05, 0.4, 7), C.rockDark, { y: 0.2 }));
  for (let i = 0; i < 5; i++) {
    const len = 1.1 + rnd() * 1.4;
    const g = crystalPoint({ r: 0.14 + rnd() * 0.1, len, tip: 0.3, sides: 6, seed: seed * 5 + i });
    const a = (i / 5) * Math.PI * 2;
    parts.push(part(g, null, { x: Math.cos(a) * 0.22, y: 4.2 + rnd() * 0.3, z: Math.sin(a) * 0.22, rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5, grad: [C.violetDeep, C.violetHi, 0, len], emit: 0.6 }));
  }
  return merge(parts).translate(0, 0, -0.65);
}

// --- the gate -----------------------------------------------------------------------
const OPENING = { halfW: 4.6, rectH: 7.2, arch: true };
const GATE_DEPTH = 1.8;
function gateGeo() {
  const parts = [...gateFrameParts(OPENING, { thick: 1.4, depth: GATE_DEPTH, color: C.rust, mark: 0.5 })];
  const top = gateTop(OPENING);
  // strata banding the frame
  for (const y of [1.8, 4.2]) {
    for (const s of [-1, 1]) parts.push(part(P.box(1.5, 0.3, GATE_DEPTH + 0.1), C.strata[s > 0 ? 1 : 4], { x: s * (OPENING.halfW + 0.7), y, outline: 0.4 }));
  }
  // crystals bursting from the crown of the arch
  parts.push(crystalsGeo(5, 1.6).translate(0, top + 0.8, 0));
  for (const s of [-1, 1]) {
    parts.push(...rockParts({ r: 1.1, lo: C.rockDark, hi: C.rock, sy: 0.6, seed: s > 0 ? 3 : 9 }).map((g) => g.translate(s * (OPENING.halfW + 2.2), 0, 0.6)));
    parts.push(crystalsGeo(s > 0 ? 7 : 11, 1.1).translate(s * (OPENING.halfW + 3.2), 0, -0.4));
  }
  return merge(parts);
}

export default {
  id: 'space',
  name: 'The Red Drift',
  doorColor: '#7a5cff',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  // low gravity (see game/drift.js), and more open road after the doorway
  // in (the jump to light speed has the screen a second and more)
  lowGravity: true,
  clearAfter: 72,
  gateExtras: [['gateOrbit', 0, gateTop(OPENING) + 1.4, 0]],
  env: {
    // through its doorway: the jump to light speed (see game/warp.js)
    warp: true,
    sky: ['#03030c', '#4a1a30', '#12060c'],
    bloom: ['#7a5cff', '#ff6a8a', '#58e8ff'],
    // a far, white sun, high over the runner's right shoulder, lighting
    // everything hard - the planets ahead lit full on, a crescent of night
    // down one side of each
    sun: { dir: [0.62, 0.48, 0.62], glow: '#ffd9b8', disc: '#fffaf0', size: 0.022 },
    stars: 0,
    space: { nebula: 1, galaxies: 1, stars: 1, comets: 0, colors: ['#ff5aa0', '#ff9a4a', '#3a7ae0'] },
    // no air to soften it: a crisp terminator, deep violet shade, a cold
    // starlit rim
    light: { dir: [0.6, 0.55, 0.58], shadow: [0.36, 0.22, 0.46], hi: [1.12, 1.02, 0.94], soft: 0.022, wrap: 0.04, hiAmt: 0.45, lift: 0.3 },
    rim: [0.5, 0.62, 1.0, 0.42],
    // a thin red dust hanging over the plain
    mist: { color: '#6a2430', amount: 0.32, top: 1.4, fade: 2.6, near: 22, far: 120 },
    grade: { sat: 1.14, contrast: 1.1, vignette: 0.5, exposure: 1.02, tint: '#0a0420' },
    ink: '#1a0a14',
    fog: [90, 240],
    ground: ['#a8442a', '#d9805a', '#4a1e1e'],
    shadowDecal: [0.42, 0.28, 0.46],
    cast: [-0.45, -0.5],
    glowGain: 1.1,
    pool: '#9a7aff',
    // red dust hanging in the thin air, and specks of starlight
    particles: { color: '#ffb49c', size: 1.5, drift: [0.06, 0.16, 0], opacity: 0.5 },
    particles2: { color: '#d8e6ff', size: 1.1, drift: [0.02, 0.05, 0], opacity: 0.55 },
  },

  // the planets hung in the sky (see world/planets.js)
  planets: {
    shade: '#24123e',
    list: [
      // a ringed giant in peach and rose bands, looming in and falling back
      { style: 'gas', radius: 58, dist: 360, az: -15, el: 12, ebb: [0.32, 46, 0], wander: [5, 2, 90], spin: 0.03, bands: 3.4, tilt: [0.32, -0.22], colors: ['#f6d2a8', '#e08a6a', '#c8506a'], atmo: ['#ffb08a', 0.45], ring: { inner: 1.35, outer: 2.3, colors: ['#f2d8b8', '#b87aa8'], opacity: 0.8 } },
      // an ice giant, pale cyan, blazing magenta round its rim
      { style: 'ice', radius: 25, dist: 300, az: 17, el: 9, ebb: [0.36, 38, 2.1], wander: [4, 3, 70], spin: 0.05, colors: ['#5ad8f0', '#2a6ad8', '#1a3a8a'], atmo: ['#ff3a8a', 1.3] },
      // a blue marble low on the horizon
      { style: 'ocean', radius: 14, dist: 420, az: 4, el: 3.6, ebb: [0.22, 52, 4.0], wander: [3, 1, 110], spin: 0.04, colors: ['#1a4ab0', '#5aa04a', '#ffffff'], atmo: ['#6ab8ff', 1.1] },
      // a pale pink moon, cratered
      { style: 'moon', radius: 8, dist: 250, az: -4, el: 17, ebb: [0.4, 30, 1.0], wander: [6, 3, 60], spin: 0.06, colors: ['#e8c8d0', '#b898b0', '#7a6080'], atmo: ['#ffffff', 0] },
      // candy stripes, mint and cream, ringed - like an illustration
      { style: 'candy', radius: 13, dist: 240, az: 27, el: 16, ebb: [0.3, 42, 5.2], wander: [5, 3, 80], spin: 0.08, bands: 2.6, tilt: [0.5, 0.3], colors: ['#d8f4e8', '#8ac8c0', '#f0d8a8'], atmo: ['#d8fff4', 0.4], ring: { inner: 1.4, outer: 2.0, colors: ['#b8a0e8', '#e8c8f0'], opacity: 0.85 } },
      // a little rust-red world off to the left
      { style: 'rust', radius: 9, dist: 220, az: -31, el: 6, ebb: [0.35, 34, 3.3], wander: [4, 2, 75], spin: 0.05, colors: ['#d8603a', '#b04a2e', '#5a2a24'], atmo: ['#ff9a6a', 0.6] },
      // a violet storm-giant far off to the right
      { style: 'gas', radius: 30, dist: 380, az: 42, el: 20, ebb: [0.28, 56, 0.6], wander: [4, 3, 100], spin: 0.025, bands: 4.2, tilt: [0.1, 0.4], colors: ['#c8a8f0', '#8a5ad8', '#f0c8e8'], atmo: ['#c8a0ff', 0.6] },
    ],
  },

  visits: [
    // a comet shower: comets crossing the sky, the nebula hotter
    {
      env: {
        space: { comets: 1, colors: ['#ff4a8a', '#ffb04a', '#4a6ae8'] },
        sky: ['#04030e', '#5a1a2a', '#14060a'],
      },
    },
    // the violet night: the nebula gone to teal and violet, a dimmer sun,
    // the dust pinker
    {
      env: {
        sky: ['#04020e', '#3a1a5a', '#0c0618'],
        space: { comets: 0.6, colors: ['#b05aff', '#5ae8d8', '#ff7ac8'] },
        sun: { glow: '#c8b0ff', disc: '#f0e8ff' },
        light: { shadow: [0.3, 0.22, 0.52], hi: [1.0, 0.96, 1.08] },
        rim: [0.7, 0.5, 1.0, 0.45],
        ground: ['#a84a4a', '#e08a7a', '#3a1a2a'],
        mist: { color: '#5a2a5a' },
        particles: { color: '#ffc0e0', size: 1.6, drift: [0.06, 0.18, 0], opacity: 0.55 },
      },
    },
    { env: { trip: [0.06, 0.3, 0.12] } },
  ],

  build(b) {
    b.ground('ground', groundStripWide(), 11);
    b.planets(this.planets);
    b.toon('boulder', boulderGeo(3), { cap: 60, anim: 'pop', ink: 0.04 });
    b.toon('boulderB', boulderGeo(17, 1.3), { cap: 60, anim: 'pop', ink: 0.04 });
    b.toon('hoodoo', merge(hoodooParts(4.2, 0.7, 4)), { cap: 30, anim: 'pop', ink: 0.045, marks: [2, 2] });
    b.toon('hoodooB', merge(hoodooParts(6.5, 1.0, 9)), { cap: 30, anim: 'lift', ink: 0.05, marks: [2, 2] });
    b.toon('craterRim', craterRimGeo(6), { cap: 24, anim: 'pop', ink: 0.04, marks: [3, 3] });
    b.toon('butte', butteGeo(2), { cap: 24, anim: 'liftFar', ink: 0.05 });
    b.toon('butteB', butteGeo(7), { cap: 24, anim: 'liftFar', ink: 0.05 });
    b.toon('arch', archGeo(), { cap: 6, anim: 'popLate', ink: 0.06, marks: [3, 3] });
    b.toon('crystals', crystalsGeo(2), { cap: 40, anim: 'pop', ink: 0.035 });
    b.toon('crystalsB', crystalsGeo(13, 1.6), { cap: 30, anim: 'pop', ink: 0.04 });
    b.toon('floatRock', merge([asteroidPart(0.7, 3, { detail: 1 })]), { cap: 60, anim: 'lift', ink: 0.04, tumble: [0.35, 0.22, 0], fly: [0, 0, 1.2, 0.12] });
    b.toon('floatRockB', merge([asteroidPart(1.4, 8, { detail: 1 })]), { cap: 30, anim: 'lift', ink: 0.05, tumble: [0.2, 0.14, 0], fly: [0, 0, 2.0, 0.08] });
    for (let v = 0; v < 3; v++) b.toon(`moonlet${v}`, moonletGeo(v), { cap: 12, anim: 'liftFar', ink: 0.05, turn: [0, 0, 0, 0.06], fly: [0, 0, 7, 0.05] });
    b.toon('ufoFar', merge(ufoParts()), { cap: 16, anim: 'lift', ink: 0.03, turn: [0, 0, 0, 1.6], fly: [0, 0, 6, 0.32] });
    b.toon('astronaut', astronautGeo(), { cap: 16, anim: 'lift', ink: 0.03, tumble: [0.25, 0.4, 0.6], fly: [0, 0, 1.5, 0.15] });
    b.glow('glow', { cap: 120, anim: 'pop' });
    b.pool('pool', { cap: 60, anim: 'pop' });
    b.shadow('shadow', { cap: 140, anim: 'pop' });

    // obstacles
    b.toon('asteroid', asteroidLowGeo(21), { cap: 24, anim: 'popEarly', ink: 0.04, tumble: [0.9, 0.55, OB_Y + 0.43] });
    b.toon('asteroidB', asteroidLowGeo(37), { cap: 24, anim: 'popEarly', ink: 0.04, tumble: [0.7, 0.8, OB_Y + 0.43] });
    // (dark basalt, so it reads at a glance against the red dust)
    b.toon('boulderL', merge([
      ...rockParts({ r: 0.55, lo: C.basalt, hi: C.basaltHi, sy: 0.8, seed: 61 }).map((g) => g.translate(-0.45, 0, 0)),
      ...rockParts({ r: 0.45, lo: C.basalt, hi: C.basaltHi, sy: 0.85, seed: 62 }).map((g) => g.translate(0.45, 0, 0.1)),
      ...rockParts({ r: 0.3, lo: C.basalt, hi: '#9a7a80', sy: 0.9, seed: 63 }).map((g) => g.translate(0.05, 0.3, -0.15)),
    ]).translate(0, 0, -0.5), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('asteroidBelt', asteroidBeltGeo(), { cap: 10, anim: 'popEarly', ink: 0.04, wobble: [0, 0.035, 2.2, 0] });
    b.toon('ufo', ufoGeo(), { cap: 24, anim: 'popEarly', ink: 0.035, turn: [0, 0, 0, 1.4], wobble: [0, 0.05, 2.4, 0] });
    b.toon('mothership', mothershipGeo(), { cap: 10, anim: 'popEarly', ink: 0.04, wobble: [0, 0.04, 1.8, 0] });
    b.toon('asteroidHigh', asteroidHighGeo(44), { cap: 24, anim: 'popEarly', ink: 0.045, tumble: [0.45, 0.3, BIG_Y] });
    b.toon('pillar', pillarGeo(5), { cap: 24, anim: 'popEarly', ink: 0.045, marks: [2, 2] });
    b.toon('pillarB', pillarGeo(12), { cap: 24, anim: 'popEarly', ink: 0.045, marks: [2, 2] });
    b.toon('spire', spireGeo(7), { cap: 24, anim: 'popEarly', ink: 0.045 });

    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06, marks: [3, 3] });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff', knob: C.gold })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
    b.toon('gateOrbit', gateOrbitGeo(7, 2.2), { cap: 2, stencil: false, ink: 0.04, turn: [0.35, 0, 0, 0] });
  },

  obstacles: {
    L: [{ name: 'asteroid', len: 0.9 }, { name: 'asteroidB', len: 0.9 }, { name: 'boulderL', len: 1.0 }],
    H: [{ name: 'ufo', len: 1.6 }, { name: 'ufo', len: 1.6 }, { name: 'asteroidHigh', len: 1.6 }],
    W: [{ name: 'pillar', len: 1.5 }, { name: 'pillarB', len: 1.5 }, { name: 'spire', len: 1.3 }],
    LW: { name: 'asteroidBelt', len: 1.0 },
    HW: { name: 'mothership', len: 1.8 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    // a natural arch over the road now and then
    if (!ctx.continuation && ctx.index % 9 === 5 && ctx.toEnd > 48) ctx.put('arch', 0, 0, 8, { ry: rng.float(-0.08, 0.08) });
    for (const s of [-1, 1]) {
      if (rng.chance(0.45)) ctx.put(rng.chance(0.6) ? 'boulder' : 'boulderB', s * rng.float(5.8, 15), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.7, 1.3) });
      if (rng.chance(0.16)) ctx.put('hoodoo', s * rng.float(7, 16), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.3) });
      if (rng.chance(0.14)) ctx.put('hoodooB', s * rng.float(16, 34), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.9, 1.6) });
      if (rng.chance(0.12)) ctx.put('craterRim', s * rng.float(15, 32), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.6) });
      if (rng.chance(0.18)) {
        const big = rng.chance(0.35);
        const x = s * rng.float(6.5, 14);
        const z = rng.float(0, 16);
        ctx.put(big ? 'crystalsB' : 'crystals', x, 0, z, { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.2) });
        ctx.put('glow', x, big ? 1.6 : 0.9, z, { s: big ? 5 : 3.2, c: [0.55, 0.38, 1.0] });
        ctx.put('pool', x, 0.04, z, { s: big ? 6 : 4, c: [0.5, 0.5, 0.5] });
      }
      if (rng.chance(0.2)) ctx.put(rng.chance(0.5) ? 'butte' : 'butteB', s * rng.float(60, 150), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.7, 1.4) });
      // little asteroids tumbling overhead
      if (rng.chance(0.35)) ctx.put('floatRock', s * rng.float(6, 30), rng.float(5, 18), rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.5, 1.3) });
      if (rng.chance(0.1)) ctx.put('floatRockB', s * rng.float(16, 45), rng.float(10, 26), rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.7, 1.5) });
      // moons sailing by, drifting in and out
      if (rng.chance(0.06)) ctx.put(`moonlet${rng.int(0, 2)}`, s * rng.float(30, 70), rng.float(14, 34), rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(2.5, 5.5) });
      // later laps: UFOs zipping about far off, then astronauts adrift
      if (ctx.visit >= 1 && rng.chance(0.12)) ctx.put('ufoFar', s * rng.float(14, 50), rng.float(6, 20), rng.float(0, 16), { s: rng.float(0.8, 1.6) });
      if (ctx.visit >= 2 && rng.chance(0.08)) ctx.put('astronaut', s * rng.float(7, 24), rng.float(4, 12), rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.9, 1.3) });
    }
  },
};
