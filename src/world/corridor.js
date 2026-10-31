import * as THREE from '../../vendor/three/three.module.min.js';
import {
  P, part, merge, mix, moved,
  cloudParts, wallDoorParts, gateFrameParts, gateLeafParts, gateTop,
} from './shapes.js';
import { flyingBookParts, teacupParts, teapotParts, clockParts } from './whimsy.js';
import { crystal, stepCut, octagon, bezelParts, nugget, hexPrism, FACE } from './gems.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';
import { paintingsGeo, Deck, PAINTING_COUNT } from './hall-art.js';

// IV · The Hall of Doors — a coral corridor with a checkerboard floor,
// open to the sky, lined with doors of every color. Nested door frames
// recede ahead; doors and armchairs float among the clouds outside.
// Lit like a de Chirico piazza: hard, low, raking sun and razor-edged
// shadows. Each return gets stranger — books take flight, a tea party drifts
// past at dusk, then clocks float through a violet night.
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
  wall: '#e27b5e',
  wainscot: '#c95a40',
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
const DOOR_TINTS = ['#2fa59a', '#e8b13a', '#3456b8', '#8fd6b6', '#8a4a8a', '#c8402e', '#7fb8e0', '#f08a5d', '#4a8a5a', '#f2d06b'];
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
// complement of the coral walls. Heirloom pendants: emerald-cut stones (with
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

export default {
  id: 'corridor',
  name: 'The Hall of Doors',
  doorColor: '#d8553a',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    sky: ['#2e6cc4', '#f6e9c8', '#f4f8fb'],
    bloom: ['#ff6a4a', '#ffd23a', '#3ab0e0'], // the colours its doorway bloom is made of
    sun: { dir: [0.45, 0.55, -0.7], glow: '#fff1c8' },
    stars: 0,
    skyFx: { clouds: 0.45 },
    // harsh: razor terminator, no wrap, deep cool shadows
    light: { dir: [0.5, 0.8, -0.3], shadow: [0.5, 0.44, 0.66], hi: [1.06, 1.04, 1.0], soft: 0.006, wrap: 0, hiAmt: 0.5, lift: 0.3 },
    // the sunlit wall's shadow falls across the right of the hall
    wallShadow: [WALL_X, WALL_H, 0.5 / 0.8, 1],
    ink: '#3a1410',
    fog: [52, 210],
    grade: { sat: 1.12, contrast: 1.14, vignette: 0.3, exposure: 1.04, tint: '#6a3a70' },
    ground: ['#efe7d6', '#2a2530', '#7a2e22'],
    shadowDecal: [0.5, 0.43, 0.58],
    cast: [-0.62, 0.37],
    glowGain: 0.7,
    // (the light pouring out of the open doors)
    beam: { color: '#ffffff', amount: 0.28 },
    particles: { color: '#fff1d0', size: 1.7, drift: [0.05, 0.08, 0], opacity: 0.7 },
  },

  // Each return to the hall, layered on the last.
  visits: [
    { env: { skyFx: { clouds: 0.6 }, particles: { color: '#fff6dc', size: 2.0, drift: [0.4, 0.3, 0], opacity: 0.8 } } },
    {
      env: {
        sky: ['#6a4aa8', '#ffc49a', '#f6e0d6'],
        sun: { dir: [0.45, 0.32, -0.8], glow: '#ffb070' },
        light: { shadow: [0.56, 0.4, 0.62], hi: [1.12, 1.0, 0.9] },
        ground: ['#f4e6d2', '#1f6f78', '#7a2e22'],
        grade: { sat: 1.18, exposure: 1.02, tint: '#5a2a60' },
        glowGain: 1.0,
        skyFx: { clouds: 0.7, rays: 0.25 },
        trip: [0.12, 0, 0.05],
      },
    },
    {
      env: {
        sky: ['#160c3a', '#6a4aa0', '#2a1a4a'],
        sun: { dir: [-0.4, 0.5, -1], glow: '#6a5ac0' },
        moon: { dir: [-0.4, 0.5, -1], color: '#fff2c8', size: 0.07 },
        stars: 1,
        light: { dir: [-0.5, 0.8, -0.3], shadow: [0.36, 0.34, 0.62], hi: [1.15, 1.15, 1.3] },
        wallShadow: [-WALL_X, WALL_H, 0.5 / 0.8, 1],
        rim: [0.5, 0.55, 1.0, 0.3],
        ground: ['#d8d0e8', '#2a2040', '#4a2a5a'],
        shadowDecal: [0.42, 0.38, 0.6],
        cast: [0.62, 0.37],
        grade: { sat: 1.1, contrast: 1.1, exposure: 1.05, tint: '#1a0a40', vignette: 0.45 },
        glowGain: 1.6,
        skyFx: { clouds: 0.25, aurora: 0.35 },
        particles: { color: '#ffe6a0', size: 2.4, drift: [0.05, 0.3, 0], opacity: 0.9 },
        trip: [0, 0.25, 0.12],
      },
    },
  ],

  build(b) {
    b.ground('ground', groundStrip(11.2, 16, '#ffffff', 8), 3);
    b.toon('cloudSea', groundStrip(420, 16, '#f3f7fb', 8, { y: -16 }), { ink: 0, cap: 40 });
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
    b.glow('glow', { cap: 160, anim: 'pop' });
    b.toon('hallFrame', hallFrameGeo(), { cap: 24, anim: 'popLate' });
    b.toon('cloud', merge(cloudParts({ r: 3, lo: '#bcd6ee', hi: '#ffffff' })), { cap: 220, anim: 'lift', wobble: [0, 0.6, 0.5, 0], ink: 0.06 });
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

    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
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
    if (!ctx.continuation) {
      ctx.put('ground', 0, 0, 0);
      ctx.put('walls', 0, 0, 0);
      const nearGate = ctx.toEnd <= 16;
      if (ctx.index % 2 === 0 && !nearGate && ctx.index > 0) {
        ctx.put('hallFrame', 0, 0, 1, { c: rng.chance(0.3) ? mix(rng.pick(DOOR_TINTS), '#ffffff', 0.25) : [0.97, 0.93, 0.83] });
      }
      for (const s of [-1, 1]) {
        const ry = s < 0 ? Math.PI / 2 : -Math.PI / 2;
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
          // between doors: a picture or a sconce
          const mid = dz + 2;
          if (mid < 16) {
            if (rng.chance(0.5)) {
              ctx.put('sconce', s * (WALL_X - 0.04), 3.4, mid, { ry });
              ctx.put('glow', s * (WALL_X - 0.4), 3.7, mid, { s: 1.6, c: [1, 0.8, 0.5] });
            } else {
              ctx.put('painting', s * (WALL_X - 0.04), 3.9, mid, { ry, s: rng.float(0.85, 1.15), p1: paintings.deal(rng) });
            }
          }
        }
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
      ctx.put('ground', 0, 0, 0);
    }
    ctx.put('cloudSea', 0, 0, 0);
    // later laps: books take wing, then a tea party, then clocks adrift
    if (ctx.visit >= 1) {
      const n = rng.int(2, 5);
      for (let i = 0; i < n; i++) {
        const out = rng.chance(0.55);
        const x = out ? rng.sign() * rng.float(7, 22) : rng.float(-4, 4);
        const y = out ? rng.float(3, 14) : rng.float(9, 13);
        ctx.put('book', x, y, rng.float(0, 16), { ry: rng.float(-0.6, 0.6) + (rng.chance(0.3) ? Math.PI : 0), c: rng.pick(BOOKS), s: rng.float(1.0, 1.7), p0: rng.float(0, 6.28) });
      }
    }
    if (ctx.visit >= 2) {
      for (const s of [-1, 1]) {
        if (rng.chance(0.5)) ctx.put('teacup', s * rng.float(9, 26), rng.float(3, 12), rng.float(0, 16), { c: rng.pick(['#ffffff', '#f6d0e0', '#bfe7e0', '#f6e6a8']), s: rng.float(2.2, 3.6), ry: rng.float(0, 6.28) });
        if (rng.chance(0.15)) ctx.put('teapot', s * rng.float(12, 30), rng.float(5, 14), rng.float(0, 16), { c: rng.pick(['#ffffff', '#f6d0e0', '#bfe7e0']), s: rng.float(2.4, 3.6), ry: rng.float(0, 6.28) });
      }
    }
    if (ctx.visit >= 3 && rng.chance(0.6)) {
      ctx.put('clock', rng.sign() * rng.float(9, 28), rng.float(4, 14), rng.float(0, 16), { s: rng.float(1.4, 2.6), ry: rng.float(-0.8, 0.8) });
    }
    // Outside: clouds, floating doors and the odd floating armchair.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = s * rng.float(10, 70);
        const y = rng.chance(0.4) ? rng.float(-12, -4) : rng.float(-3, 16);
        ctx.put('cloud', x, y, rng.float(0, 16), { s: rng.float(0.7, 1.8), ry: rng.float(0, 6.28) });
      }
      if (rng.chance(0.45)) {
        ctx.put('floatDoor', s * rng.float(16, 60), rng.float(2, 22), rng.float(0, 16), { ry: rng.float(-1.2, 1.2), c: rng.pick(DOOR_TINTS), s: rng.float(1, 2.2) });
      }
      if (rng.chance(0.08)) {
        ctx.put('floatChair', s * rng.float(18, 40), rng.float(4, 14), rng.float(0, 16), { ry: rng.float(0, 6.28), s: 1.4 });
      }
    }
  },
};
