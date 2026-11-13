import * as THREE from '../../vendor/three/three.module.min.js';
import {
  P, part, merge, mix, moved,
  wallDoorParts, gateFrameParts, gateTop, leafParts,
} from './shapes.js';
import { flyingBookParts, teacupParts, teapotParts, clockParts, shaftParts } from './whimsy.js';
import { crystal, stepCut, octagon, bezelParts, nugget, hexPrism, FACE } from './gems.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';
import { paintingsGeo, Deck, PAINTING_COUNT } from './hall-art.js';

// V · The Hall of Doors — a mustard-yellow corridor floored wall to wall in dark old boards, lined
// with doors of every color, running through the heart of a library that
// goes on for ever: over its walls a gallery of books rises on either side,
// railed and lamplit, rolling ladders on its shelves; behind those, rows and
// rows and rows of book stacks stand off into a warm haze, as far as you can
// see; great timber arches span the hall overhead under a beamed roof, lamps
// hanging from them, and slanting shafts of sunlight from high windows fall
// across it. Nested door frames recede ahead; doors and armchairs drift in
// the dark above the stacks; now and then a ladder leans on the hall's wall
// up to the gallery. Lit like a de Chirico piazza: hard, low, raking sun and
// razor-edged shadows. Each return gets stranger — books take flight, a tea
// party drifts past at dusk, then clocks float through a violet night.
//
// Nine different paintings hang between the doors, dealt from a shuffled
// deck so no two neighbours match and no run of them repeats. Now and then a
// door stands ajar on nothing but light — each in its own colour, a hint of
// some other world beyond (sea teal, forest green, night blue, ember red,
// sunlit gold, rose, violet, ice) that you never see and never reach — the
// light pouring over the threshold and pooling on the floor. And books
// flutter up off the shelves and stacks in the way: rarely at first, more
// each time the hall comes round (they're only decoration: nothing to hit,
// nothing in the lanes).

const C = {
  // mustard walls, a deeper ochre below the dado rail, cream mouldings
  wall: '#c6a64e',
  wainscot: '#a47e34',
  cream: '#f6ecd4',
  creamDark: '#e2d3b0',
  wood: '#8a5232',
  woodDark: '#5e3420',
  gold: '#e8b84a',
  velvet: '#b5302a',
  velvetDark: '#8a2020',
  coral: '#e2694a',
  lit: '#ffdf8a',
};
// (no yellows: they'd vanish into the walls)
const DOOR_TINTS = ['#2fa59a', '#7a2a36', '#3456b8', '#8fd6b6', '#8a4a8a', '#c8402e', '#7fb8e0', '#f08a5d', '#4a8a5a', '#f4ecd8'];
const BOOKS = ['#c8402e', '#3456b8', '#e8b13a', '#2fa59a', '#f6ecd4', '#8a4a8a', '#4a8a5a', '#f08a5d'];
// the light spilling from a door left ajar: a colour for each world it
// might open on — sea teal, forest green, night blue, ember red, sunlit gold,
// rose, violet, ice — dealt like the paintings, so neighbours never match
const GLOWS = [
  [0.22, 0.9, 0.88], [0.42, 1, 0.42], [0.4, 0.5, 1], [1, 0.36, 0.18],
  [1, 0.8, 0.3], [1, 0.48, 0.72], [0.74, 0.42, 1], [0.72, 0.94, 1],
];
const paintings = new Deck(PAINTING_COUNT);
const glows = new Deck(GLOWS.length);

// Books flying up off a shelf or a stack (obstacle spec extras): purely for
// show, above head height, a little past the obstacle so its own outline
// stays clean. Rare the first time through the hall, more each time round.
function bookFlight(lo, hi) {
  return (put, rng, { x, d, visit }) => {
    if (!rng.chance(Math.min(0.75, 0.22 + 0.18 * visit))) return;
    const n = 1 + (rng.chance(0.25 + 0.2 * visit) ? 1 : 0) + (visit >= 2 && rng.chance(0.4) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      put(rng.chance(0.5) ? 'shelfBook' : 'shelfBookB', x + rng.float(-0.9, 0.9), rng.float(lo, hi), d + rng.float(0.3, 1.6), {
        ry: rng.float(-0.9, 0.9) + (rng.chance(0.3) ? Math.PI : 0), c: rng.pick(BOOKS), s: rng.float(1.35, 1.8), p0: rng.float(0, 6.28),
      });
    }
  };
}

// The greens, as if a cabinet of curiosities had spilled down the hall — the
// foil to the mustard walls. Heirloom pendants: emerald-cut stones (with
// the little inclusions real emeralds have) in gold bezels, the same brass as
// the hall's doorknobs and teacup rims, hung from little loops; square
// asscher cuts. And the specimens beside them: rough olivine, bright and
// granular; beryl, emerald's own six-sided crystal; and malachite banded in
// rings of light and dark green. A larger pendant in a double rim of gold for
// the prize spots. They turn slowly and barely bob, like things in a still,
// sunlit room.
function pendant({ w, h, c, bail = 0, double = false }) {
  const o = octagon(w, h, c);
  const corner = (sx, sy) => [sx * (w - c / 2) * 1.04, sy * (h - c / 2) * 1.04];
  const parts = [
    crystal(stepCut({ w, h, chamfer: c }), { rx: FACE }),
    ...bezelParts(o, { claws: [corner(1, 1), corner(-1, 1), corner(1, -1), corner(-1, -1)], bail: double ? 0 : bail }),
  ];
  // the loop hangs from whichever rim is outermost
  if (double) parts.push(...bezelParts(o, { k: 1.26, inner: 1.15, depth: 0.05, color: '#f2d27a', bail }));
  return parts;
}
const EMERALD = { mottle: 0.3, speckle: 0.15, second: '#0b7a40', rough: 0.15 };
const GEM = {
  name: 'emerald',
  color: '#18c46a',
  stones: [
    {
      name: 'emerald pendant',
      weight: 1.6,
      tints: ['#18c46a', '#2fd88a', '#12b060'],
      parts: () => pendant({ w: 0.19, h: 0.26, c: 0.065, bail: 0.05 }),
      texture: EMERALD,
    },
    {
      name: 'asscher pendant',
      weight: 0.8,
      tints: ['#18c46a', '#2fd88a', '#12b060'],
      parts: () => pendant({ w: 0.22, h: 0.22, c: 0.075 }),
      texture: EMERALD,
    },
    {
      // peridot as it's found: bright yellow-green, granular, rough
      name: 'olivine',
      weight: 2,
      tints: ['#8cd43a', '#a2e04c', '#78c632'],
      parts: () => [crystal(nugget({ r: [0.22, 0.2, 0.19], faces: 17, spread: 0.16, chips: 3, seed: 31 }))],
      texture: { mottle: 0.55, speckle: 0.35, second: '#e4ff8a', rough: 0.5, veins: 0.2, glints: 1.1 },
    },
    {
      // emerald's own crystal, a six-sided prism, striated along its length
      name: 'beryl',
      weight: 1.2,
      tints: ['#26b064', '#34c274', '#1ea458'],
      parts: () => [crystal(hexPrism({ r: 0.135, top: 0.25, foot: 0.23, seed: 6 }), { rz: 0.25, rx: 0.1 })],
      texture: { bands: 0.25, bandFreq: 30, second: '#9cf0bc', mottle: 0.4, rough: 0.35, speckle: 0.1 },
    },
    {
      // a rounded lump banded in rings of light and dark green
      name: 'malachite',
      weight: 1,
      tints: ['#1c9a58', '#20a862', '#168a4c'],
      parts: () => [crystal(nugget({ r: [0.23, 0.18, 0.18], faces: 26, spread: 0.07, chips: 2, seed: 33 }))],
      texture: { opaque: 0.8, bands: 0.85, rings: 'round', bandFreq: 34, wander: 14, second: '#0a4426', mottle: 0.2, rough: 0.3, glints: 0.6 },
    },
  ],
  crown: {
    name: 'emerald pendant',
    tints: ['#18c46a', '#2fd88a', '#12b060'],
    parts: () => pendant({ w: 0.24, h: 0.32, c: 0.08, bail: 0.06, double: true }),
    texture: EMERALD,
  },
  motion: [1.0, 1.7, 0.045, 0.1],
  look: [0.72, 1, 0.22, 0.35],
  glow: 0.7,
  pool: 0.22,
};

const OPENING = { halfW: 4.6, rectH: 11.0, arch: false };
const GATE_DEPTH = 1.6;
const WALL_X = 5.5;
const WALL_H = 6.5;

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// --- the endless library -------------------------------------------------------
// Every shelf's books are drawn in the shader (toon option shelves: see
// bookSpines), so the library can go on for ever for the price of a few
// planes: the faces marked 0.7 run along the hall (their pattern runs on from
// chunk to chunk), those marked 0.75 stand across it.
const LIB = {
  wood: '#5e3820',
  woodHi: '#8e5c34',
  woodDark: '#3a2014',
  brass: '#d8a24a',
  lamp: '#ffdf9a',
  shade: '#2f6a4a',
  plaster: '#e6d6b8',
};
const TIER_X = 7.0; // the gallery's wall of books, behind each wall of the hall
const TIER_H = 12.2;
const GALLERY_Y = 6.85; // its walkway, just over the top of the hall's walls
const GALLERY_IN = 5.8; // how far it juts out toward the hall
const STACK_X = [19.8, 60]; // the stacks behind, standing across the run
const ROOF_Y = 19.6;
const STACK_LAMP_Y = 36.4; // the lamps on the stacks' ends, above the top tier
const ARCH_R = 6.9;

// A face of books (w along, h up), turned to face the hall or the run.
function bookFace(w, h, { x = 0, y = 0, z = 0, ry = 0, flipU = false, across = false, tiltUp = 0 }) {
  const g = new THREE.PlaneGeometry(w, h);
  if (flipU) {
    const uv = g.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) uv[i] = 1 - uv[i];
  }
  if (tiltUp) {
    // (the faces turned toward you lean their light up a little, so they
    // catch the sun rather than standing in their own shade)
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      n[i + 1] = tiltUp;
      n[i + 2] = Math.sqrt(1 - tiltUp * tiltUp);
    }
  }
  return part(g, '#ffffff', { x, y, z, ry, uvScale: [w, h], mark: across ? 0.75 : 0.7, outline: 0 });
}

// The library rises in tiers on either side of the hall, each set further
// back and higher than the one before it: the first a gallery over the
// hall's own walls, then three more stepping up and away - each a wall of
// books (from its walkway up), timber pilasters dividing it into bays, its
// walkway jutting out on a carved fascia, a balustrade along it, a brass
// rail for the ladders, a cornice crowning it.
const TIERS = [
  { x: TIER_X, y0: GALLERY_Y, top: TIER_H, posts: 0.64 },
  { x: 10.2, y0: TIER_H + 0.62, top: 19.6, posts: 2 },
  { x: 13.4, y0: 20.22, top: 27.2, posts: 2 },
  { x: 16.6, y0: 27.82, top: 34.6, posts: 2 },
];
function tiersGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    TIERS.forEach((T, n) => {
      const x = s * T.x;
      const inner = n === 0 ? GALLERY_IN : TIERS[n - 1].x;
      const bh = T.top - T.y0;
      parts.push(bookFace(16, bh, { x: x - s * 0.02, y: T.y0 + bh / 2, z: -8, ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, flipU: s > 0 }));
      parts.push(part(P.box(0.4, bh + 0.6, 16), LIB.woodDark, { x: x + s * 0.2, y: T.y0 + bh / 2, z: -8, outline: 0 }));
      for (let i = 0; i < 4; i++) {
        parts.push(part(P.box(0.46, bh, 0.5), null, { x: x - s * 0.12, y: T.y0 + bh / 2, z: -2 - i * 4, grad: [LIB.woodDark, LIB.woodHi, T.y0, T.top] }));
      }
      const w = T.x - inner;
      parts.push(part(P.box(w + 0.3, 0.2, 16), LIB.wood, { x: s * (inner + w / 2 - 0.15), y: T.y0, z: -8 }));
      parts.push(part(P.box(0.14, 0.5, 16), LIB.woodDark, { x: s * inner, y: T.y0 - 0.15, z: -8 }));
      parts.push(part(P.box(0.1, 0.1, 16), LIB.woodHi, { x: s * (inner + 0.05), y: T.y0 + 1.02, z: -8, outline: 0.5 }));
      parts.push(part(P.box(0.08, 0.06, 16), LIB.woodHi, { x: s * (inner + 0.05), y: T.y0 + 0.22, z: -8, outline: 0 }));
      const nb = Math.round(16 / T.posts);
      for (let i = 0; i < nb; i++) {
        parts.push(part(P.box(0.07, 0.78, 0.07), LIB.wood, { x: s * (inner + 0.05), y: T.y0 + 0.6, z: -T.posts / 2 - i * T.posts, outline: 0.4 }));
      }
      parts.push(part(P.cyl(0.035, 0.035, 16, 6), LIB.brass, { x: x - s * 0.32, y: T.top - 0.7, z: -8, rx: Math.PI / 2, outline: 0.4 }));
      parts.push(part(P.box(1.0, 0.55, 16), LIB.woodDark, { x: x - s * 0.15, y: T.top + 0.27, z: -8 }));
      parts.push(part(P.box(1.2, 0.16, 16), LIB.woodHi, { x: x - s * 0.2, y: T.top + 0.62, z: -8, outline: 0.5 }));
    });
  }
  return merge(parts);
}

// Behind the top tier, the stacks: standing across the run four to a chunk
// on either side and running off sideways for forty metres - rows and rows
// of them, every one a different height, books on both faces, a carved end
// toward the hall with a brass label and a lamp, a cornice on top.
function stacksGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const len = STACK_X[1] - STACK_X[0];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -2 - i * 4;
      const h = 38 + rnd() * 12;
      const t = 1.25;
      const cx = s * (STACK_X[0] + len / 2);
      parts.push(part(P.box(len, h, t), LIB.woodDark, { x: cx, y: h / 2, z, outline: 0 }));
      parts.push(bookFace(len - 0.6, h - 0.8, { x: cx, y: (h - 0.8) / 2 + 0.2, z: z + t / 2 + 0.01, across: true, tiltUp: 0.5 }));
      parts.push(bookFace(len - 0.6, h - 0.8, { x: cx, y: (h - 0.8) / 2 + 0.2, z: z - t / 2 - 0.01, ry: Math.PI, across: true }));
      const ex = s * (STACK_X[0] - 0.15);
      parts.push(part(P.box(0.4, h + 0.3, t + 0.4), null, { x: ex, y: (h + 0.3) / 2, z, grad: [LIB.woodDark, LIB.woodHi, 0, h] }));
      // a lamp on its end, lighting the aisle's way, and its label
      parts.push(part(P.box(0.08, 0.5, 0.8), '#f2e4c0', { x: ex - s * 0.22, y: STACK_LAMP_Y - 1.2, z, outline: 0.5 }));
      parts.push(part(P.cyl(0.1, 0.24, 0.22, 10), LIB.shade, { x: ex - s * 0.4, y: STACK_LAMP_Y + 0.12, z }));
      parts.push(part(P.sphere(0.1, 8, 6), LIB.lamp, { x: ex - s * 0.4, y: STACK_LAMP_Y, z, emit: 1, outline: 0 }));
      parts.push(part(P.box(0.24, 0.04, 0.04), LIB.brass, { x: ex - s * 0.28, y: STACK_LAMP_Y + 0.28, z, outline: 0 }));
      parts.push(part(P.box(len + 0.4, 0.45, t + 0.5), LIB.woodDark, { x: cx, y: h + 0.2, z }));
    }
  }
  return merge(parts);
}

// The roof over the hall: a great timber arch springing from the gallery
// cornices, a collar beam and a king post, braces at its feet; the ridge and
// purlins running on along the hall, and the boards of the roof above.
function roofGeo(withArch) {
  const parts = [];
  const top = ROOF_Y;
  // (pale plaster between the timbers, as in an old reading room)
  parts.push(part(P.box(TIER_X * 2 + 1, 0.22, 16), LIB.plaster, { y: top, z: -8, emit: 0.45, outline: 0 }));
  for (let k = -3; k <= 3; k++) {
    if (k === 0) continue;
    parts.push(part(P.box(0.3, 0.3, 16), LIB.wood, { x: k * 2.2, y: top - 0.25, z: -8, outline: 0.5 }));
  }
  parts.push(part(P.box(0.5, 0.55, 16), LIB.wood, { y: top - 0.35, z: -8 }));
  if (withArch) {
    const z = -8;
    parts.push(part(P.torus(ARCH_R, 0.32, 6, 24, Math.PI), null, { y: TIER_H + 0.6, z, sz: 1.7, grad: [LIB.woodDark, LIB.woodHi, TIER_H, top] }));
    const cy = TIER_H + 0.6 + ARCH_R * 0.62;
    const cw = 2 * Math.sqrt(ARCH_R * ARCH_R - (ARCH_R * 0.62) ** 2);
    parts.push(part(P.box(cw, 0.42, 0.5), LIB.wood, { y: cy, z }));
    parts.push(part(P.box(0.4, top - cy, 0.5), LIB.wood, { y: (top + cy) / 2, z }));
    for (const s of [-1, 1]) {
      parts.push(part(P.box(0.3, 2.6, 0.45), LIB.wood, { x: s * 2.6, y: cy + 1.3, z, rz: s * 0.55 }));
      parts.push(part(P.box(1.6, 0.4, 0.55), LIB.woodDark, { x: s * (TIER_X - 0.4), y: TIER_H + 0.75, z }));
      // carved pendant bosses where the arch meets the collar
      parts.push(part(P.cone(0.22, 0.6, 6), LIB.woodHi, { x: s * cw * 0.5, y: cy - 0.45, z, rx: Math.PI }));
    }
  }
  return merge(parts);
}

// A lamp hanging from the arch on a chain: a green glass shade over a warm
// bulb.
function hangingLampGeo(drop) {
  return merge([
    part(P.cyl(0.02, 0.02, drop, 4), '#2a1a10', { y: -drop / 2, outline: 0 }),
    part(P.cone(0.42, 0.38, 12), LIB.shade, { y: -drop - 0.1 }),
    part(P.sphere(0.16, 8, 6), LIB.lamp, { y: -drop - 0.28, emit: 1 }),
    part(P.cyl(0.08, 0.08, 0.12, 8), LIB.brass, { y: -drop + 0.12 }),
  ]);
}

// A reading lamp on the gallery's balustrade.
function railLampGeo() {
  return merge([
    part(P.cyl(0.03, 0.03, 0.5, 5), LIB.brass, { y: 0.25, outline: 0.4 }),
    part(P.cyl(0.08, 0.26, 0.2, 10), LIB.shade, { y: 0.55 }),
    part(P.sphere(0.09, 8, 6), LIB.lamp, { y: 0.47, emit: 1, outline: 0 }),
  ]);
}

// A library ladder, h tall, leaning in toward -z by lean (turn it so -z
// faces the shelves): two rails, rungs, hooks over a rail at the top and a
// pair of wheels at its foot.
function ladderGeo(h, lean) {
  const parts = [];
  const a = Math.atan2(lean, h);
  const L = Math.hypot(h, lean);
  const rail = (x) => part(P.box(0.07, L, 0.07), LIB.woodHi, { x, y: h / 2, z: lean / 2, rx: -a, outline: 0.5 });
  parts.push(rail(-0.28), rail(0.28));
  for (let y = 0.3; y < h - 0.2; y += 0.32) {
    const z = lean * (1 - y / h);
    parts.push(part(P.box(0.56, 0.045, 0.06), LIB.wood, { y, z, outline: 0.4 }));
  }
  for (const x of [-0.28, 0.28]) {
    parts.push(part(P.torus(0.07, 0.02, 4, 8, Math.PI), LIB.brass, { x, y: h - 0.02, z: 0.02, ry: Math.PI / 2, outline: 0 }));
    parts.push(part(P.cyl(0.07, 0.07, 0.05, 10), LIB.brass, { x, y: 0.07, z: lean + 0.04, rz: Math.PI / 2, outline: 0.4 }));
  }
  return merge(parts);
}

function hallWallsGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    const x = s * (WALL_X + 0.25);
    parts.push(part(P.box(0.5, WALL_H, 16, 1, 1, 8), C.wall, { x, y: WALL_H / 2, z: -8 }));
    parts.push(part(P.box(0.56, 1.35, 16, 1, 1, 8), C.wainscot, { x: x - s * 0.03, y: 0.68, z: -8 }));
    parts.push(part(P.box(0.62, 0.26, 16, 1, 1, 8), C.cream, { x: x - s * 0.05, y: 0.13, z: -8 }));
    parts.push(part(P.box(0.62, 0.1, 16, 1, 1, 8), C.cream, { x: x - s * 0.05, y: 1.38, z: -8, outline: 0.5 }));
    parts.push(part(P.box(0.7, 0.34, 16, 1, 1, 8), C.cream, { x: x - s * 0.05, y: WALL_H - 0.12, z: -8 }));
  }
  return merge(parts);
}

// A door standing open on light: its frame, deep enough to stand proud of
// the wall's wainscot and rails (so none of them run across the opening),
// and the door itself — panelled, in its own colour (tinted per door) — swung
// out into the hall on the jamb further down it (hinge: which side that is,
// +1 on the left wall, -1 on the right), so it never hides the light from
// down the hall. The light is its own batch (doorLightGeo).
const DOOR_W = 1.5;
const DOOR_H = 3.1;
function openDoorGeo(hinge) {
  const w = DOOR_W;
  const h = DOOR_H;
  const parts = [
    part(P.box(0.2, h + 0.2, 0.42), C.cream, { x: -w / 2 - 0.1, y: (h + 0.2) / 2, z: 0.06 }),
    part(P.box(0.2, h + 0.2, 0.42), C.cream, { x: w / 2 + 0.1, y: (h + 0.2) / 2, z: 0.06 }),
    part(P.box(w + 0.4, 0.2, 0.42), C.cream, { y: h + 0.1, z: 0.06 }),
    part(P.box(w + 0.2, 0.05, 0.44), C.creamDark, { y: 0.025, z: 0.08 }),
  ];
  // the leaf, built hinged at the origin (reaching across to -hinge), then
  // swung open about its hinge
  const t = 0.09;
  const k = -hinge;
  const leaf = [part(P.box(w, h - 0.04, t), '#ffffff', { x: k * w / 2, y: (h - 0.04) / 2, tint: 1 })];
  const pw = w * 0.32;
  const ph = h * 0.3;
  for (const face of [-1, 1]) {
    for (const px of [w * 0.28, w * 0.72]) {
      for (const py of [h * 0.27, h * 0.68]) {
        leaf.push(part(P.box(pw, ph, 0.03), '#d0d0d0', { x: k * px, y: py, z: face * (t / 2 + 0.01), tint: 1, outline: 0.6 }));
      }
    }
    leaf.push(part(P.sphere(0.06, 8, 6), C.gold, { x: k * w * 0.88, y: h * 0.47, z: face * (t / 2 + 0.05) }));
  }
  // the edge that faced the light picks it up
  leaf.push(part(P.box(0.02, h - 0.1, t + 0.01), '#fff6dc', { x: k * (w - 0.005), y: h / 2, emit: 0.6, outline: 0 }));
  parts.push(...moved(leaf, { x: hinge * (w / 2), z: 0.24, ry: hinge * 0.98 }));
  return merge(parts);
}

// The light in an open door (tinted per door): the doorway brimming with it,
// brightest low down where it pours over the threshold. It stands in front of
// the wall's trim and fills the opening edge to edge, so nothing of the wall
// shows through: there's nothing beyond the door but light.
function doorLightGeo() {
  return merge([
    part(P.box(DOOR_W + 0.06, DOOR_H + 0.04, 0.05, 1, 4, 1), null, { y: (DOOR_H + 0.04) / 2, z: 0.08, emit: 1, tint: 1, outline: 0, grad: ['#ffffff', '#cfc8dc', 0.2, DOOR_H] }),
  ]);
}

// The light pouring out of an open door into the hall: a soft volume (an
// additive beam, tinted per door) the shape of the doorway where it leaves
// it, spreading as it comes out.
function doorShaftGeo() {
  const len = 2.5;
  const g = new THREE.CylinderGeometry(0.66, 1.05, len, 16, 1, true);
  g.scale(1, 1, 2.1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 1.5, len / 2 - 0.05);
  return merge([part(g, '#ffffff', { tint: 1, outline: 0 })]);
}

function sconceGeo() {
  return merge([
    part(P.box(0.18, 0.4, 0.1), C.gold, { y: 0 }),
    part(P.cyl(0.04, 0.04, 0.3, 6), C.gold, { y: 0.05, z: 0.15, rx: Math.PI / 2 }),
    part(P.cyl(0.12, 0.2, 0.28, 10), C.lit, { y: 0.24, z: 0.3, emit: 1 }),
  ]);
}

function hallFrameGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.7, 7.4, 0.9), '#ffffff', { x: s * 5.15, y: 3.7, tint: 1 }));
    parts.push(part(P.box(0.86, 0.3, 1.0), C.creamDark, { x: s * 5.15, y: 0.15 }));
  }
  parts.push(part(P.box(11.0, 0.9, 0.9), '#ffffff', { y: 7.6, tint: 1 }));
  parts.push(part(P.box(11.4, 0.22, 1.1), C.creamDark, { y: 8.13 }));
  return merge(parts);
}

function floatingDoorGeo() {
  return merge([
    ...wallDoorParts({ w: 1.5, h: 3.0, depth: 0.22, frameW: 0.22 }),
    part(P.box(2.3, 0.18, 0.8), C.creamDark, { y: -0.09 }),
  ]);
}

// --- obstacles --------------------------------------------------------------
function armchairGeo(width) {
  const parts = [
    part(P.box(width, 0.42, 0.95), C.coral, { y: 0.36 }),
    part(P.box(width - 0.5, 0.18, 0.78), '#f4e2c4', { y: 0.64, z: 0.05 }),
    part(P.box(width, 0.62, 0.26), C.coral, { y: 0.66, z: -0.38 }),
    part(P.cyl(0.14, 0.14, width, 10), mix(C.coral, '#ffffff', 0.1), { y: 0.98, z: -0.38, rz: Math.PI / 2 }),
  ];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.24, 0.7, 0.95), C.coral, { x: s * (width / 2 - 0.12), y: 0.5 }));
    parts.push(part(P.cyl(0.13, 0.13, 0.95, 10), mix(C.coral, '#ffffff', 0.1), { x: s * (width / 2 - 0.12), y: 0.85, rx: Math.PI / 2 }));
    for (const z of [-0.35, 0.35]) parts.push(part(P.cyl(0.05, 0.04, 0.15, 6), C.woodDark, { x: s * (width / 2 - 0.15), y: 0.075, z }));
  }
  return merge(parts).translate(0, 0, -0.5);
}

// L · Stacks of books across the lane: bright cloth bindings, their spines
// turned to you with gilt bands, now and then one turned to show its cream
// page edges, a fat volume lying open on top of a stack.
const BINDINGS = ['#e8402e', '#2f6ae0', '#f2c230', '#1fb8a6', '#b04ac8', '#3fae4a', '#ff8a3d', '#e84a8a'];
function bookParts(parts, x, y, z, w, h, d, color, ry, pagesOut) {
  const l = [
    part(P.box(w, h, d), color, { outline: 0.7 }),
    // the pages, set in from the cover on three sides
    part(P.box(w - 0.05, h * 0.7, d - 0.03), '#fbf4e2', { z: pagesOut ? 0.016 : -0.016, outline: 0 }),
  ];
  if (!pagesOut) {
    // the spine toward you: gilt bands and a label
    for (const bx of [-w * 0.36, w * 0.36]) l.push(part(P.box(0.022, h * 0.86, 0.012), '#f6d46a', { x: bx, z: d / 2 + 0.005, outline: 0 }));
    l.push(part(P.box(w * 0.34, h * 0.46, 0.012), '#fbf0d0', { z: d / 2 + 0.005, outline: 0 }));
  }
  parts.push(...moved(l, { x, y: y + h / 2, z, ry }));
}
function booksGeo() {
  const rnd = seeded(31);
  const parts = [];
  const xs = [-0.7, -0.23, 0.23, 0.7];
  xs.forEach((sx, k) => {
    let y = 0;
    const top = 0.78 + rnd() * 0.12;
    for (let i = 0; y < top - 0.08; i++) {
      const h = Math.min(0.09 + rnd() * 0.07, top - y);
      const w = 0.4 + rnd() * 0.08;
      const d = 0.3 + rnd() * 0.08;
      bookParts(parts, sx + (rnd() - 0.5) * 0.06, y, 0, w, h, d, BINDINGS[Math.floor(rnd() * BINDINGS.length)], (rnd() - 0.5) * 0.35, rnd() < 0.2);
      y += h;
    }
    if (k === 1) {
      // a big volume lying open on top
      const oy = y;
      for (const s of [-1, 1]) {
        parts.push(part(P.box(0.3, 0.035, 0.36), '#8a2a2a', { x: sx + s * 0.15, y: oy + 0.04, rz: -s * 0.12, outline: 0.6 }));
        parts.push(part(P.box(0.27, 0.03, 0.33), '#fffaf0', { x: sx + s * 0.14, y: oy + 0.07, rz: -s * 0.12, outline: 0.4 }));
      }
    }
  });
  return merge(parts).translate(0, 0, -0.3);
}

// Velvet valance on a frame: pleats run from the rod down to a scalloped,
// tasselled hem that sits exactly on the duck line, open floor below.
function valanceGeo(half, framed) {
  const D = CONFIG.duckLine;
  const rod = 2.72;
  const parts = [];
  const postC = framed ? C.cream : C.gold;
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.28, rod + 0.3, 0.32), postC, { x: s * half, y: (rod + 0.3) / 2 }));
    parts.push(part(P.box(0.4, 0.24, 0.42), C.creamDark, { x: s * half, y: 0.12 }));
  }
  if (framed) {
    parts.push(part(P.box(half * 2 + 0.6, 0.3, 0.44), C.cream, { y: rod + 0.3 }));
    parts.push(part(P.box(half * 2 + 0.8, 0.12, 0.52), C.creamDark, { y: rod + 0.48 }));
  }
  parts.push(part(P.cyl(0.07, 0.07, half * 2 + 0.2, 8), C.gold, { y: rod, z: 0.05, rz: Math.PI / 2 }));
  const inner = half * 2 - 0.24;
  const n = Math.max(4, Math.round(inner * 1.85));
  const step = inner / n;
  const r = step * 0.56;
  const bot = D + r * 0.55 + 0.04;
  for (let i = 0; i < n; i++) {
    const x = -inner / 2 + step * (i + 0.5);
    parts.push(part(P.cyl(r, r * 0.92, rod - bot, 8), i % 2 ? C.velvet : C.velvetDark, { x, y: (rod + bot) / 2 }));
    parts.push(part(P.sphere(r * 0.98, 8, 6), C.velvet, { x, y: bot, sy: 0.5 }));
    parts.push(part(P.sphere(0.055, 6, 4), C.gold, { x, y: D + 0.055, outline: 0.5 }));
  }
  // gold braid across the hem
  parts.push(part(P.box(inner, 0.06, r * 2.1), C.gold, { y: bot + 0.1, outline: 0.5 }));
  return merge(parts).translate(0, 0, -0.2);
}

// A tall painted wardrobe: unmistakably solid, door-covered and in the way.
function wardrobeGeo() {
  const W = 1.95;
  const H = 3.0;
  const Dp = 0.8;
  const parts = [
    part(P.box(W, H - 0.3, Dp), C.wood, { y: 0.16 + (H - 0.3) / 2 }),
    part(P.box(W + 0.22, 0.24, Dp + 0.18), C.woodDark, { y: H - 0.02 }),
    part(P.box(W + 0.1, 0.1, Dp + 0.1), C.wood, { y: H - 0.19 }),
    part(P.prism(W * 0.5, 0.36, 0.2), C.woodDark, { y: H + 0.1, z: Dp / 2 - 0.05 }),
    part(P.box(W - 0.16, 0.34, 0.06), C.woodDark, { y: 0.4, z: Dp / 2 + 0.02 }),
    part(P.sphere(0.05, 6, 4), C.gold, { y: 0.4, z: Dp / 2 + 0.07 }),
  ];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push(part(P.cyl(0.08, 0.05, 0.16, 8), C.woodDark, { x: x * (W / 2 - 0.12), y: 0.08, z: z * (Dp / 2 - 0.1) }));
  }
  const dh = H - 0.95;
  const dy = 0.62 + dh / 2;
  for (const s of [-1, 1]) {
    parts.push(part(P.box(W / 2 - 0.1, dh, 0.06), '#ffffff', { x: s * (W / 4), y: dy, z: Dp / 2 + 0.02, tint: 1 }));
    parts.push(part(P.box(W / 2 - 0.36, dh * 0.36, 0.08), [0.82, 0.82, 0.82], { x: s * (W / 4), y: dy + dh * 0.22, z: Dp / 2 + 0.03, tint: 1, outline: 0.5 }));
    parts.push(part(P.box(W / 2 - 0.36, dh * 0.3, 0.08), [0.82, 0.82, 0.82], { x: s * (W / 4), y: dy - dh * 0.26, z: Dp / 2 + 0.03, tint: 1, outline: 0.5 }));
    parts.push(part(P.sphere(0.06, 8, 6), C.gold, { x: s * 0.12, y: dy, z: Dp / 2 + 0.09 }));
  }
  return merge(parts).translate(0, 0, -Dp / 2);
}

function bookshelfGeo() {
  const rnd = seeded(5);
  const parts = [
    part(P.box(1.9, 3.1, 0.75), C.wood, { y: 1.55 }),
    part(P.box(2.0, 0.16, 0.85), C.woodDark, { y: 3.12 }),
    part(P.box(1.7, 2.8, 0.1), C.woodDark, { y: 1.55, z: -0.2, outline: 0 }),
  ];
  for (let sh = 0; sh < 4; sh++) {
    const y0 = 0.22 + sh * 0.72;
    parts.push(part(P.box(1.75, 0.07, 0.62), C.woodDark, { y: y0, z: 0.1, outline: 0.5 }));
    let x = -0.8;
    while (x < 0.75) {
      const bw = 0.08 + rnd() * 0.08;
      const bh = 0.4 + rnd() * 0.2;
      parts.push(part(P.box(bw, bh, 0.42), BOOKS[Math.floor(rnd() * BOOKS.length)], { x: x + bw / 2, y: y0 + 0.04 + bh / 2, z: 0.18, outline: 0.35 }));
      x += bw + 0.01;
    }
  }
  return merge(parts).translate(0, 0, -0.38);
}

function swingDoorGeo() {
  // Hinge at local x = 0; leaf runs along +x. Thickness toward +z.
  const w = 4.1;
  const h = 3.8;
  const parts = [
    part(P.box(w, h, 0.24), '#ffffff', { x: w / 2, y: h / 2, z: 0.14, tint: 1 }),
    part(P.sphere(0.12, 8, 6), C.gold, { x: w - 0.4, y: 1.7, z: 0.34 }),
  ];
  for (let i = 0; i < 3; i++) {
    parts.push(part(P.box(w * 0.26, h * 0.68, 0.32), [0.85, 0.85, 0.85], { x: w * (0.2 + i * 0.3), y: h * 0.5, z: 0.14, tint: 1, outline: 0.5 }));
  }
  return merge(parts);
}

function doorwayGeo() {
  // The bright opening left in the wall by a swinging door.
  return merge([
    part(P.box(4.1, 3.8, 0.06), C.lit, { x: 2.05, y: 1.9, emit: 1, outline: 0 }),
    part(P.box(4.5, 0.25, 0.3), C.cream, { x: 2.05, y: 3.92 }),
  ]);
}

function gateGeo() {
  const parts = [...gateFrameParts(OPENING, { thick: 1.0, depth: GATE_DEPTH, color: C.cream })];
  const top = gateTop(OPENING);
  parts.push(part(P.box(OPENING.halfW * 2 + 3.4, 0.5, GATE_DEPTH + 0.5), C.creamDark, { y: top + 1.2 }));
  parts.push(part(P.box(OPENING.halfW * 2 + 2.6, 1.5, GATE_DEPTH + 0.3), C.cream, { y: top + 2.2 }));
  // clock above the door
  parts.push(part(P.cyl(1.25, 1.25, 0.3, 24), '#fff8e6', { y: top + 4.5, z: GATE_DEPTH / 2, rx: Math.PI / 2 }));
  parts.push(part(P.torus(1.25, 0.14, 6, 24), C.gold, { y: top + 4.5, z: GATE_DEPTH / 2 + 0.12 }));
  parts.push(part(P.box(0.08, 0.9, 0.06), '#2a1d14', { y: top + 4.8, z: GATE_DEPTH / 2 + 0.2, outline: 0 }));
  parts.push(part(P.box(0.6, 0.08, 0.06), '#2a1d14', { x: 0.28, y: top + 4.5, z: GATE_DEPTH / 2 + 0.2, outline: 0 }));
  for (const s of [-1, 1]) {
    const w = 40;
    const x = s * (OPENING.halfW + 1.0 + w / 2 - 0.1);
    parts.push(part(P.box(w, 20, 1.2), C.wall, { x, y: 10 }));
    parts.push(part(P.box(w, 2.2, 1.3), C.wainscot, { x, y: 1.1 }));
    parts.push(part(P.box(w, 0.6, 1.6), C.cream, { x, y: 20.1 }));
    // columns flanking the door
    parts.push(part(P.cyl(0.55, 0.6, 14, 14), C.cream, { x: s * (OPENING.halfW + 2.1), y: 7, z: GATE_DEPTH / 2 + 0.2 }));
    parts.push(part(P.box(1.5, 0.5, 1.5), C.creamDark, { x: s * (OPENING.halfW + 2.1), y: 14.2, z: GATE_DEPTH / 2 + 0.2 }));
    parts.push(part(P.box(1.5, 0.5, 1.5), C.creamDark, { x: s * (OPENING.halfW + 2.1), y: 0.25, z: GATE_DEPTH / 2 + 0.2 }));
    // decorative doors on the end wall
    for (let i = 0; i < 4; i++) {
      const dx = s * (OPENING.halfW + 4.2 + i * 3.4);
      parts.push(...wallDoorParts({ w: 1.5, h: 3.1, leaf: DOOR_TINTS[(i * 3 + (s > 0 ? 1 : 0)) % DOOR_TINTS.length] }).map((g) => g.translate(dx, 0, 0.66)));
    }
  }
  return merge(parts);
}

// The door into the Hall of Doors: doors within doors - each leaf framed
// with a smaller door, and a smaller one in that, each its own colour with
// its own knob, down to a little one you could hardly get a hand through.
function nestedLeaf({ W, H, z, f }) {
  const out = [];
  const at = (t) => z + (f * t) / 2;
  const tints = ['#5ab0c8', '#f2c94c', '#7ac46a', '#e8e0f4'];
  let x0 = 0.45, x1 = W - 0.45, y0 = 0.45, y1 = H - 0.6;
  for (let i = 0; i < 4; i++) {
    const w = x1 - x0, h = y1 - y0;
    const t = 0.05 + i * 0.05;
    out.push(part(P.box(w, h, t), tints[i], { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: at(t), outline: 0.5 }));
    for (const [bx, by, bw, bh] of [[x0, (y0 + y1) / 2, 0.12, h], [x1, (y0 + y1) / 2, 0.12, h], [(x0 + x1) / 2, y1, w + 0.12, 0.12], [(x0 + x1) / 2, y0, w + 0.12, 0.12]]) {
      out.push(part(P.box(bw, bh, t + 0.04), '#f4ead2', { x: bx, y: by, z: at(t + 0.04), outline: 0.4 }));
    }
    out.push(part(P.sphere(0.07 + 0.03 * (3 - i), 8, 6), '#e8b84a', { x: x1 - 0.22, y: y0 + h * 0.48, z: at(t + 0.14) }));
    const inset = Math.min(w, h) * 0.17;
    x0 += inset;
    x1 -= inset * 0.6;
    y0 += inset * 0.4;
    y1 -= inset * 1.4;
  }
  return out;
}

export default {
  id: 'corridor',
  name: 'The Hall of Doors',
  doorColor: '#d8553a',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    // no sky: the dark of the roof and the stacks, and a warm haze of dust
    // and lamplight where the library runs on out of sight
    sky: ['#140c08', '#a06a40', '#2a1a10'],
    bloom: ['#ff6a4a', '#ffd23a', '#3ab0e0'], // the colours its doorway bloom is made of
    sun: { dir: [0.45, 0.55, -0.7], glow: '#ffd9a0' },
    stars: 0,
    skyFx: {},
    // harsh: razor terminator, no wrap, deep cool shadows
    light: { dir: [0.5, 0.8, -0.3], shadow: [0.5, 0.44, 0.66], hi: [1.06, 1.04, 1.0], soft: 0.006, wrap: 0, hiAmt: 0.5, lift: 0.3 },
    // the sunlit wall's shadow falls across the right of the hall
    wallShadow: [WALL_X, WALL_H, 0.5 / 0.8, 1],
    ink: '#3a1410',
    fog: [46, 200],
    grade: { sat: 1.12, contrast: 1.14, vignette: 0.3, exposure: 1.04, tint: '#6a3a70' },
    // dark old floorboards (see GROUND 16): honey-brown, deep brown, the
    // near-black of the grooves between them
    ground: ['#6a4228', '#3c2215', '#140805'],
    shadowDecal: [0.5, 0.43, 0.58],
    cast: [-0.62, 0.37],
    glowGain: 0.7,
    // (the light pouring out of the open doors)
    beam: { color: '#ffffff', amount: 0.28 },
    particles: { color: '#fff1d0', size: 1.7, drift: [0.05, 0.08, 0], opacity: 0.7 },
  },

  // Each return to the hall, layered on the last.
  visits: [
    { env: { particles: { color: '#fff6dc', size: 2.0, drift: [0.4, 0.3, 0], opacity: 0.8 } } },
    {
      env: {
        // dusk: the haze gone rose and amber
        sky: ['#1e0e18', '#d0886a', '#3a1c24'],
        sun: { dir: [0.45, 0.32, -0.8], glow: '#ffb070' },
        light: { shadow: [0.56, 0.4, 0.62], hi: [1.12, 1.0, 0.9] },
        ground: ['#7a4232', '#47231e', '#140708'],
        grade: { sat: 1.18, exposure: 1.02, tint: '#5a2a60' },
        glowGain: 1.0,
        trip: [0.12, 0, 0.05],
      },
    },
    {
      env: {
        // night: only the lamps, the stacks gone violet
        sky: ['#0a0618', '#4a3a7a', '#140c26'],
        sun: { dir: [-0.4, 0.5, -1], glow: '#6a5ac0' },
        light: { dir: [-0.5, 0.8, -0.3], shadow: [0.36, 0.34, 0.62], hi: [1.15, 1.15, 1.3] },
        wallShadow: [-WALL_X, WALL_H, 0.5 / 0.8, 1],
        rim: [0.5, 0.55, 1.0, 0.3],
        ground: ['#4e3e5a', '#2a2036', '#0a0612'],
        shadowDecal: [0.42, 0.38, 0.6],
        cast: [0.62, 0.37],
        grade: { sat: 1.1, contrast: 1.1, exposure: 1.05, tint: '#1a0a40', vignette: 0.45 },
        glowGain: 1.6,
        particles: { color: '#ffe6a0', size: 2.4, drift: [0.05, 0.3, 0], opacity: 0.9 },
        trip: [0, 0.25, 0.12],
      },
    },
  ],

  build(b) {
    b.ground('ground', groundStrip(11.2, 16, '#ffffff', 8), 16);
    // the library: its floor running out under the stacks, the galleries,
    // the stacks, the roof, lamps, ladders and shafts of sunlight
    // (the same boards, a shade darker, on out under the stacks)
    b.ground('libFloor', groundStrip(110, 16, '#a89488', 8, { y: -0.02 }), 16);
    b.toon('gallery', tiersGeo(), { cap: 40, ink: 0.035, anim: 'rise', shelves: true });
    b.toon('stacksA', stacksGeo(3), { cap: 40, ink: 0.04, anim: 'rise', shelves: true });
    b.toon('stacksB', stacksGeo(11), { cap: 40, ink: 0.04, anim: 'rise', shelves: true });
    b.toon('roof', roofGeo(false), { cap: 40, ink: 0.03 });
    b.toon('roofArch', roofGeo(true), { cap: 40, ink: 0.04 });
    b.toon('hangLamp', hangingLampGeo(2.2), { cap: 60, anim: 'pop', ink: 0.03, wobble: [0.006, 0, 0.8, 0] });
    b.toon('railLamp', railLampGeo(), { cap: 220, anim: 'pop', ink: 0.025 });
    b.toon('wallLadder', ladderGeo(GALLERY_Y + 0.3, 1.25), { cap: 20, anim: 'pop', ink: 0.03 });
    b.toon('shelfLadder', ladderGeo(TIER_H - GALLERY_Y - 0.6, 0.8), { cap: 30, anim: 'pop', ink: 0.03 });
    b.toon('tierLadder', ladderGeo(6.0, 0.9), { cap: 90, anim: 'pop', ink: 0.035 });
    b.beam('sunShaft', merge(shaftParts({ len: 26, r0: 0.7, r1: 1.7, dir: [0.5, 0.8, -0.3] })), { cap: 24, anim: 'pop', wobble: [0, 0, 0.6, 0] });
    b.toon('walls', hallWallsGeo(), { cap: 40, ink: 0.04, anim: 'rise' });
    b.toon('door', merge(wallDoorParts({ w: 1.5, h: 3.1, depth: 0.2 })), { cap: 200, anim: 'pop' });
    b.toon('openDoor', openDoorGeo(1), { cap: 40, anim: 'pop' });
    b.toon('openDoorR', openDoorGeo(-1), { cap: 40, anim: 'pop' });
    b.toon('painting', paintingsGeo(), { cap: 120, anim: 'pop', kinds: true, ink: 0 });
    b.toon('doorPane', doorLightGeo(), { cap: 48, anim: 'pop', ink: 0 });
    b.beam('doorShaft', doorShaftGeo(), { cap: 48, anim: 'pop' });
    // books off the shelves: some flutter fast and close, some glide in wide loops
    b.toon('shelfBook', merge(flyingBookParts()), { cap: 40, anim: 'popEarly', fly: [1.1, 11, 0.45, 0.95], ink: 0.035 });
    b.toon('shelfBookB', merge(flyingBookParts()), { cap: 40, anim: 'popEarly', fly: [0.65, 5.5, 1.1, 0.42], ink: 0.035 });
    b.toon('sconce', sconceGeo(), { cap: 120, anim: 'pop', ink: 0.025 });
    b.glow('glow', { cap: 560, anim: 'pop' });
    b.toon('hallFrame', hallFrameGeo(), { cap: 24, anim: 'popLate' });
    b.toon('floatDoor', floatingDoorGeo(), { cap: 60, anim: 'liftFar', wobble: [0, 0.4, 0.6, 0] });
    b.toon('floatChair', armchairGeo(1.6), { cap: 30, anim: 'liftFar', wobble: [0, 0.5, 0.45, 0] });
    b.shadow('shadow', { cap: 120, anim: 'pop' });
    b.shadow('hardShadow', { cap: 80, anim: [0, 64, 122, 0], hard: true, order: 1 });
    b.toon('book', merge(flyingBookParts()), { cap: 160, anim: 'lift', fly: [0.95, 8.5, 0.9, 0.55], ink: 0.035 });
    b.toon('teacup', merge(teacupParts()), { cap: 60, anim: 'liftFar', wobble: [0, 0.35, 0.7, 0], fly: [0, 0, 1.6, 0.25] });
    b.toon('teapot', merge(teapotParts()), { cap: 30, anim: 'liftFar', wobble: [0, 0.35, 0.6, 0], fly: [0, 0, 1.8, 0.2] });
    b.toon('clock', merge(clockParts()), { cap: 40, anim: 'liftFar', wobble: [0, 0.4, 0.5, 0], fly: [0, 0, 1.4, 0.18] });

    b.toon('armchair', armchairGeo(1.8), { cap: 24, anim: 'popEarly' });
    b.toon('books', booksGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('settee', armchairGeo(7.6), { cap: 10, anim: 'popEarly' });
    b.toon('lowDoorway', valanceGeo(0.98, true), { cap: 24, anim: 'popEarly' });
    b.toon('curtain', valanceGeo(3.95, false), { cap: 10, anim: 'popEarly' });
    b.toon('wardrobe', wardrobeGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('bookshelf', bookshelfGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('swingDoor', swingDoorGeo(), { cap: 16, anim: [3, 42, 88, Math.PI / 2] });
    b.toon('doorway', doorwayGeo(), { cap: 16, anim: 'none', ink: 0.03 });

  },

  // The door INTO this world, in its own style (built into the shared
  // doors, see world.js: it stands in the world before it).
  door(b) {
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', deco: nestedLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'armchair', len: 1.0 }, { name: 'books', len: 0.6, extras: bookFlight(2.9, 3.9) }],
    H: [{ name: 'lowDoorway', len: 0.4 }],
    W: [{ name: 'wardrobe', len: 0.8, tints: DOOR_TINTS }, { name: 'bookshelf', len: 0.8, extras: bookFlight(3.5, 4.8) }],
    LW: { name: 'settee', len: 1.0 },
    HW: { name: 'curtain', len: 0.4 },
    // Side doors that swing out across an outer lane as you approach.
    SW: { name: 'swingDoor', frame: 'doorway', wallX: WALL_X - 0.02, len: 0.5 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    // (a spot in one of the aisles between the stacks, either side: where
    // things can drift without passing through the shelves)
    const aisle = () => rng.pick([4, 8, 12]) + rng.float(-0.7, 0.7);
    // the library goes on all round, the hall or not
    ctx.put('libFloor', 0, 0, 0, { p0: ctx.d0 % 4096 });
    ctx.put(rng.chance(0.5) ? 'stacksA' : 'stacksB', 0, 0, 0);
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) ctx.put('glow', s * (STACK_X[0] - 0.6), STACK_LAMP_Y - 0.05, 2 + i * 4, { s: 2.4, c: [1, 0.76, 0.42] });
    if (!ctx.continuation) {
      ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
      ctx.put('walls', 0, 0, 0);
      ctx.put('gallery', 0, 0, 0, { p0: ctx.d0 % 4096 });
      const nearGate = ctx.toEnd <= 16;
      // the roof (not over the doorway out: the next world's door stands
      // there), a great arch every other chunk with lamps hung from it
      if (!nearGate) {
        const arch = ctx.index % 2 === 0;
        ctx.put(arch ? 'roofArch' : 'roof', 0, 0, 0);
        if (arch) {
          const cy = TIER_H + 0.6 + ARCH_R * 0.62 - 0.2;
          for (const s of [-1, 1]) {
            ctx.put('hangLamp', s * 2.6, cy, 8, { p0: rng.float(0, 6.28) });
            ctx.put('glow', s * 2.6, cy - 2.6, 8, { s: 2.6, c: [1, 0.78, 0.45] });
          }
        }
      }
      if (ctx.index % 2 === 0 && !nearGate && ctx.index > 0) {
        ctx.put('hallFrame', 0, 0, 1, { c: rng.chance(0.3) ? mix(rng.pick(DOOR_TINTS), '#ffffff', 0.25) : [0.97, 0.93, 0.83] });
      }
      for (const s of [-1, 1]) {
        const ry = s < 0 ? Math.PI / 2 : -Math.PI / 2;
        // reading lamps along the gallery's rail, ladders on its shelves
        const lz = s < 0 ? 4 : 12;
        ctx.put('railLamp', s * (GALLERY_IN + 0.05), GALLERY_Y + 1.07, lz);
        ctx.put('glow', s * (GALLERY_IN + 0.05), GALLERY_Y + 1.55, lz, { s: 1.5, c: [1, 0.85, 0.55] });
        if (rng.chance(0.4)) ctx.put('shelfLadder', s * (TIER_X - 0.34), GALLERY_Y + 0.1, rng.pick([2, 6, 10, 14]) + rng.float(-0.8, 0.8), { ry });
        // and up the tiers above: a ladder here and there, a lamp on each rail
        for (let n = 1; n < TIERS.length; n++) {
          const T = TIERS[n];
          if (rng.chance(0.3)) ctx.put('tierLadder', s * (T.x - 0.34), T.y0 + 0.1, rng.pick([2, 6, 10, 14]) + rng.float(-0.8, 0.8), { ry });
          const tz = (n % 2 ? 8 : 0) + (s < 0 ? 4 : 0) + 2;
          ctx.put('railLamp', s * (TIERS[n - 1].x + 0.05), T.y0 + 1.07, tz);
          ctx.put('glow', s * (TIERS[n - 1].x + 0.05), T.y0 + 1.55, tz, { s: 1.8, c: [1, 0.85, 0.55] });
        }
        for (let i = 0; i < 4; i++) {
          const dz = 2 + i * 4 + (s > 0 ? 2 : 0);
          if (dz > 15.5) continue;
          const x = s * (WALL_X - 0.08);
          const tint = rng.pick(DOOR_TINTS);
          if (rng.chance(0.24)) {
            // a door ajar on nothing but coloured light, a hint of some other
            // world beyond it: the light in the doorway, a glow round it and
            // more of it pooled on the floor in front
            const g = GLOWS[glows.deal(rng)];
            ctx.put(s < 0 ? 'openDoor' : 'openDoorR', x, 0, dz, { ry, c: tint });
            ctx.put('doorPane', x, 0, dz, { ry, c: g });
            ctx.put('doorShaft', x, 0, dz, { ry, c: g });
            ctx.put('glow', s * (WALL_X - 0.9), 1.7, dz, { s: 3.0, c: [g[0] * 0.75, g[1] * 0.75, g[2] * 0.75] });
            ctx.put('glow', s * (WALL_X - 1.3), 0.25, dz, { s: 2.6, c: [g[0] * 0.5, g[1] * 0.5, g[2] * 0.5] });
          } else {
            ctx.put('door', x, 0, dz, { ry, c: tint });
          }
          // between doors: a picture or a sconce - or, now and then, a ladder
          // leaning on the wall up to the gallery
          const mid = dz + 2;
          if (mid < 16) {
            if (rng.chance(0.09)) {
              ctx.put('wallLadder', s * (GALLERY_IN - 0.18), 0, mid, { ry });
            } else if (rng.chance(0.5)) {
              ctx.put('sconce', s * (WALL_X - 0.04), 3.4, mid, { ry });
              ctx.put('glow', s * (WALL_X - 0.4), 3.7, mid, { s: 1.6, c: [1, 0.8, 0.5] });
            } else {
              ctx.put('painting', s * (WALL_X - 0.04), 3.9, mid, { ry, s: rng.float(0.85, 1.15), p1: paintings.deal(rng) });
            }
          }
        }
      }
      // shafts of sunlight slanting down from the high windows
      if (!nearGate && rng.chance(0.32)) {
        const fx = rng.float(-3.2, 0.5);
        const fz = rng.float(3, 13);
        ctx.put('sunShaft', fx + 5.6, 9, fz + 3.4, { c: [1, 0.84, 0.58], s: rng.float(0.8, 1.1) });
      }
      // raking sun: the wall shadow itself is analytic (env.wallShadow); each
      // frame's lintel throws a crisp bar across the sunlit part of the floor
      const L = ctx.world.env.light.dir;
      const k = Math.abs(L[0]) / L[1];
      const side = L[0] > 0 ? 1 : -1;
      const band = WALL_H * k;
      if (ctx.index % 2 === 0 && !nearGate && ctx.index > 0) {
        const off = (7.6 * Math.abs(L[2])) / L[1];
        const w = WALL_X * 2 - band;
        ctx.put('hardShadow', -side * band / 2, 0.041, 1 - off, { sx: w, sz: 1.25 });
      }
    } else {
      ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    }
    // later laps: books take wing, then a tea party, then clocks adrift
    if (ctx.visit >= 1) {
      const n = rng.int(2, 5);
      for (let i = 0; i < n; i++) {
        const out = rng.chance(0.55);
        const x = out ? rng.sign() * rng.float(10, 26) : rng.float(-4, 4);
        const y = out ? rng.float(4, 16) : rng.float(9, 13);
        ctx.put('book', x, y, out ? aisle() : rng.float(0, 16), { ry: rng.float(-0.6, 0.6) + (rng.chance(0.3) ? Math.PI : 0), c: rng.pick(BOOKS), s: rng.float(1.0, 1.7), p0: rng.float(0, 6.28) });
      }
    }
    if (ctx.visit >= 2) {
      for (const s of [-1, 1]) {
        if (rng.chance(0.5)) ctx.put('teacup', s * rng.float(10, 26), rng.float(4, 14), aisle(), { c: rng.pick(['#ffffff', '#f6d0e0', '#bfe7e0', '#f6e6a8']), s: rng.float(1.6, 2.4), ry: rng.float(0, 6.28) });
        if (rng.chance(0.15)) ctx.put('teapot', s * rng.float(12, 30), rng.float(5, 15), aisle(), { c: rng.pick(['#ffffff', '#f6d0e0', '#bfe7e0']), s: rng.float(1.6, 2.4), ry: rng.float(0, 6.28) });
      }
    }
    if (ctx.visit >= 3 && rng.chance(0.6)) {
      ctx.put('clock', rng.sign() * rng.float(10, 28), rng.float(5, 15), aisle(), { s: rng.float(1.2, 1.8), ry: rng.float(-0.8, 0.8) });
    }
    // Down the aisles between the stacks: doors adrift, and the odd armchair.
    for (const s of [-1, 1]) {
      if (rng.chance(0.4)) {
        ctx.put('floatDoor', s * rng.float(13, 40), rng.float(5, 20), aisle(), { ry: s * Math.PI / 2 + rng.float(-0.5, 0.5), c: rng.pick(DOOR_TINTS), s: rng.float(0.8, 1.3) });
      }
      if (rng.chance(0.08)) {
        ctx.put('floatChair', s * rng.float(14, 34), rng.float(5, 16), aisle(), { ry: rng.float(0, 6.28), s: 1.1 });
      }
    }
  },
};
