import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge } from './shapes.js';

// The Hall of Doors' art: nine paintings for its walls, and six worlds you
// can glimpse through its open doors (but never reach). Each set is built as
// ONE geometry — every design's triangles marked with its index in uv.x — so a
// single instanced batch (toon option `kinds`) draws them all, each instance
// showing only its own design (p1). Flat painted shapes, a few hundred
// triangles a design.

// --- flat shapes on a canvas (facing +z) -----------------------------------------
// (flat: every design's vertices are run for every instance, so they're kept
// to a couple of hundred triangles each)
const rect = (x, y, w, h, c, z = 0) => part(new THREE.PlaneGeometry(w, h), c, { x, y, z, outline: 0 });
const disc = (x, y, r, c, z = 0, sx = 1, sy = 1) => part(new THREE.CircleGeometry(r, 14), c, { x, y, z, sx, sy, outline: 0 });
function poly(pts, c, z = 0) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  return part(new THREE.ShapeGeometry(s, 1), c, { z, outline: 0 });
}
const tri = (x, y, w, h, c, z = 0) => poly([[x - w / 2, y], [x + w / 2, y], [x, y + h]], c, z);

// A frame round a w x h canvas (the canvas at z = 0.05, a backing behind).
function frame(w, h, color, t = 0.09) {
  return [
    part(P.box(w + t * 2, t, 0.1), color, { y: h / 2 + t / 2 }),
    part(P.box(w + t * 2, t, 0.1), color, { y: -h / 2 - t / 2 }),
    part(P.box(t, h, 0.1), color, { x: -w / 2 - t / 2 }),
    part(P.box(t, h, 0.1), color, { x: w / 2 + t / 2 }),
    // (a dark backing a little larger than the frame draws its outline, so
    // the paintings need no ink pass)
    part(new THREE.PlaneGeometry(w + t * 2 + 0.05, h + t * 2 + 0.05), '#2a1a12', { z: -0.05, outline: 0 }),
  ];
}

// Stamp every vertex of each design with its index, merge them all.
function byKind(designs) {
  return merge(
    designs.map((parts, i) => {
      const g = merge(parts);
      const uv = g.attributes.uv.array;
      for (let j = 0; j < uv.length; j += 2) {
        uv[j] = i;
        uv[j + 1] = 0;
      }
      return g;
    })
  );
}

const GOLD = '#e0ae48';
const WOOD = '#6a3a22';
const SILVER = '#c8ccd2';
const BLACK = '#22201e';
const Z = 0.05; // canvas front
const L1 = Z + 0.004;
const L2 = Z + 0.008;
const L3 = Z + 0.012;

// --- nine paintings ------------------------------------------------------------------
const PAINTINGS = [
  // a sunset over the sea, a sail on the horizon
  () => [
    ...frame(1.4, 0.9, GOLD),
    rect(0, 0.225, 1.4, 0.45, '#ff9a5a', Z), rect(0, 0.05, 1.4, 0.12, '#ffc27a', L1),
    disc(0.32, 0.06, 0.13, '#fff0b0', L2),
    rect(0, -0.22, 1.4, 0.46, '#2a5a8a', L3), rect(0.32, -0.12, 0.05, 0.2, '#ffcf8a', L3 + 0.004),
    tri(-0.35, -0.05, 0.16, 0.24, '#fbf6ea', L3 + 0.004), rect(-0.35, -0.06, 0.24, 0.04, '#3a2418', L3 + 0.004),
  ],
  // a portrait in a dark green room
  () => [
    ...frame(0.8, 1.1, WOOD),
    rect(0, 0, 0.8, 1.1, '#2f4a3a', Z),
    disc(0, -0.45, 0.34, '#b0302a', L1, 1, 0.75),
    disc(0, 0.08, 0.17, '#e8b894', L2, 1, 1.15),
    disc(0, 0.18, 0.18, '#3a2418', L1, 1.05, 0.85),
    rect(0, -0.16, 0.08, 0.1, '#e8b894', L1),
  ],
  // a still life: a blue vase of flowers on a table
  () => [
    ...frame(0.9, 1.0, GOLD),
    rect(0, 0.1, 0.9, 0.8, '#c89a54', Z), rect(0, -0.38, 0.9, 0.24, '#7a4a2a', L1),
    disc(0, -0.17, 0.15, '#3a6ab0', L2), rect(0, -0.02, 0.1, 0.16, '#3a6ab0', L2),
    rect(-0.06, 0.12, 0.02, 0.2, '#3f7a3a', L1), rect(0.07, 0.14, 0.02, 0.22, '#3f7a3a', L1),
    disc(-0.1, 0.26, 0.08, '#d83a3a', L2), disc(0.1, 0.28, 0.08, '#f6d04a', L2), disc(0.0, 0.36, 0.07, '#fbf6ea', L3),
    disc(0.3, -0.24, 0.07, '#e8742a', L2),
  ],
  // blue mountains under snow, a green meadow
  () => [
    ...frame(1.4, 0.8, SILVER),
    rect(0, 0, 1.4, 0.8, '#bfe0f4', Z),
    tri(-0.35, -0.25, 0.9, 0.58, '#6a8ac0', L1), tri(0.3, -0.25, 1.0, 0.5, '#7a9ad0', L1),
    tri(-0.35, 0.2, 0.22, 0.13, '#ffffff', L2), tri(0.3, 0.13, 0.26, 0.12, '#ffffff', L2),
    tri(-0.05, -0.3, 1.0, 0.32, '#3a5a8a', L2),
    rect(0, -0.32, 1.4, 0.16, '#6fb35a', L3),
  ],
  // a night village under a crescent moon
  () => [
    ...frame(1.0, 1.0, BLACK),
    rect(0, 0, 1.0, 1.0, '#14204a', Z),
    disc(0.22, 0.26, 0.13, '#f4ecc0', L1), disc(0.28, 0.3, 0.12, '#14204a', L2),
    ...[[-0.35, 0.36], [-0.12, 0.2], [0.02, 0.4], [-0.3, 0.1], [0.4, 0.05]].map(([x, y]) => disc(x, y, 0.015, '#ffffff', L1)),
    disc(0, -0.62, 0.6, '#1e3a2a', L2, 1.2, 0.5),
    rect(-0.12, -0.26, 0.24, 0.2, '#e8d8b0', L3), tri(-0.12, -0.16, 0.3, 0.14, '#8a3a2a', L3),
    rect(-0.12, -0.27, 0.07, 0.08, '#ffd24a', L3 + 0.004),
  ],
  // a geometric study in black lines and three primaries
  () => [
    ...frame(0.9, 0.9, BLACK),
    rect(0, 0, 0.9, 0.9, '#f4f0e6', Z),
    rect(-0.27, 0.23, 0.36, 0.44, '#d8302a', L1), rect(0.3, -0.3, 0.3, 0.3, '#2a4aa8', L1), rect(0.3, 0.32, 0.3, 0.26, '#f2c82a', L1),
    rect(-0.08, 0, 0.03, 0.9, BLACK, L2), rect(0.14, 0, 0.03, 0.9, BLACK, L2),
    rect(0, 0.0, 0.9, 0.03, BLACK, L2), rect(0.1, -0.15, 0.7, 0.03, BLACK, L2),
  ],
  // a dark forest against a yellow sky
  () => [
    ...frame(1.2, 0.9, GOLD),
    rect(0, 0, 1.2, 0.9, '#f2e6a8', Z), rect(0, -0.36, 1.2, 0.18, '#8a6a3a', L1),
    ...[[-0.45, 0.62], [-0.2, 0.74], [0.05, 0.56], [0.3, 0.7], [0.5, 0.5]].map(([x, h]) => tri(x, -0.3, 0.26, h, '#24502e', L2)),
    ...[-0.45, -0.2, 0.05, 0.3, 0.5].map((x) => rect(x, -0.33, 0.04, 0.08, '#4a2a18', L2)),
    disc(-0.4, 0.3, 0.08, '#fff6d0', L1),
  ],
  // one big lemon on a pink ground
  () => [
    ...frame(0.8, 0.8, GOLD),
    rect(0, 0, 0.8, 0.8, '#f4b8c8', Z),
    disc(0.02, -0.2, 0.24, '#d890a0', L1, 1.3, 0.35),
    disc(0, 0, 0.22, '#f4d23a', L2, 1.25, 1),
    disc(0.07, 0.07, 0.06, '#fff2a0', L3),
    poly([[0.12, 0.2], [0.3, 0.3], [0.18, 0.14]], '#3f8a3a', L3),
  ],
  // a lighthouse on its rock in a storm
  () => [
    ...frame(0.9, 1.2, WOOD),
    rect(0, 0.15, 0.9, 0.9, '#7a8a9a', Z), rect(0, -0.42, 0.9, 0.36, '#3a5a6a', L1),
    poly([[0.06, 0.32], [0.45, 0.44], [0.45, 0.2]], '#fff2b0', L1),
    disc(-0.12, -0.36, 0.2, '#4a4a4a', L2, 1.3, 0.6),
    rect(-0.12, -0.05, 0.14, 0.5, '#f6f2ea', L2),
    ...[-0.18, 0.0, 0.16].map((y) => rect(-0.12, y, 0.14, 0.07, '#c8302a', L3)),
    rect(-0.12, 0.25, 0.18, 0.1, '#ffe27a', L3),
    ...[-0.32, 0.08, 0.3].map((x) => disc(x, -0.3, 0.06, '#e8f0f4', L3, 1.6, 0.4)),
  ],
];

// --- six worlds glimpsed through open doors -------------------------------------------
// Laid in the doorway (1.5 x 3.1, its foot at y = 0), lit by their own light.
const W = 1.5;
const H = 3.1;
const GZ = -0.05;
const g1 = GZ + 0.004;
const g2 = GZ + 0.008;
const g3 = GZ + 0.012;
const bg = (top, bottom, split = 0.55) => [rect(0, H * (1 + split) / 2, W, H * (1 - split), top, GZ), rect(0, (H * split) / 2, W, H * split, bottom, GZ)];
const GLIMPSES = [
  // under the sea: light rays, fish, swaying weed
  () => [
    ...bg('#2a8aa8', '#0e4a6a'),
    poly([[-0.4, H], [-0.2, H], [0.1, 0.6], [-0.05, 0.6]], '#5ab8c8', g1), poly([[0.2, H], [0.38, H], [0.5, 1.0], [0.38, 1.0]], '#5ab8c8', g1),
    rect(0, 0.18, W, 0.36, '#d8c48a', g2),
    ...[[-0.25, 1.9, '#ff8a3a'], [0.3, 1.4, '#ffd24a'], [-0.1, 1.05, '#ff6a5a']].flatMap(([x, y, c]) => [disc(x, y, 0.13, c, g2, 1.4, 0.8), tri(x - 0.24, y - 0.09, 0.14, 0.18, c, g2)]),
    ...[-0.55, -0.4, 0.45, 0.6].map((x, i) => rect(x, 0.6 + i * 0.05, 0.06, 0.9 + i * 0.1, '#2f8a4a', g3)),
  ],
  // a snowy night: moon, stars, a pine
  () => [
    ...bg('#1a2a5a', '#2a3a72'),
    disc(0.32, 2.45, 0.2, '#f4f4ff', g1),
    ...[[-0.5, 2.7], [-0.2, 2.3], [0.05, 2.85], [-0.4, 1.9], [0.55, 1.95]].map(([x, y]) => disc(x, y, 0.025, '#ffffff', g1)),
    disc(0, 0.25, 1.0, '#f4f8ff', g2, 1.0, 0.45),
    tri(-0.2, 0.55, 0.7, 0.7, '#1e4a3a', g3), tri(-0.2, 0.95, 0.56, 0.6, '#1e4a3a', g3), tri(-0.2, 1.3, 0.4, 0.5, '#1e4a3a', g3),
  ],
  // the desert: a great sun, dunes, a pyramid
  () => [
    ...bg('#ffb060', '#ffe0a0', 0.5),
    disc(-0.2, 2.2, 0.32, '#fff2c0', g1),
    tri(0.25, 0.9, 0.9, 0.62, '#c8783a', g1),
    disc(-0.3, 0.55, 0.8, '#e89a50', g2, 1, 0.5), disc(0.45, 0.35, 0.7, '#d0803a', g3, 1, 0.45),
  ],
  // deep space: a ringed planet, a little moon, stars
  () => [
    ...bg('#140a2a', '#24124a'),
    ...[[-0.5, 2.8], [-0.3, 1.2], [0.1, 2.6], [0.55, 2.2], [-0.55, 0.6], [0.4, 0.5], [0.0, 0.9]].map(([x, y]) => disc(x, y, 0.022, '#ffffff', g1)),
    disc(0, 1.8, 0.4, '#e07a5a', g2), disc(-0.08, 1.88, 0.25, '#f09a6a', g2 + 0.002),
    disc(0, 1.8, 0.62, '#f4d0a0', g1, 1, 0.16), rect(0, 1.62, 0.9, 0.12, '#e07a5a', g2 + 0.003),
    disc(0.48, 2.7, 0.1, '#c8c8e0', g2),
  ],
  // an autumn wood, a path winding in
  () => [
    ...bg('#f4c27a', '#d8a050', 0.4),
    poly([[-0.2, 0], [0.2, 0], [0.05, 1.2], [-0.02, 1.2]], '#c89a6a', g1),
    ...[[-0.5, 1.6, '#d8502a'], [0.45, 1.8, '#e8822a'], [-0.25, 2.2, '#c83a2a'], [0.2, 2.5, '#f0a83a']].flatMap(([x, y, c]) => [rect(x, y - 0.6, 0.08, 1.2, '#5a3220', g2), disc(x, y, 0.32, c, g3)]),
  ],
  // islands adrift in a pink sky, a waterfall pouring off one
  () => [
    ...bg('#ffb8d0', '#ffe8f0', 0.45),
    disc(-0.3, 1.5, 0.22, '#ffffff', g1, 1.6, 0.6), disc(0.4, 2.6, 0.18, '#ffffff', g1, 1.8, 0.6),
    disc(0.1, 2.0, 0.42, '#6fb35a', g2, 1, 0.35), tri(0.1, 1.95, 0.8, -0.6, '#8a5a3a', g2),
    rect(0.4, 1.3, 0.08, 1.2, '#e8f8ff', g3),
    disc(-0.4, 0.8, 0.26, '#6fb35a', g2, 1, 0.35), tri(-0.4, 0.75, 0.5, -0.4, '#8a5a3a', g2),
  ],
];

export const PAINTING_COUNT = PAINTINGS.length;
export const GLIMPSE_COUNT = GLIMPSES.length;
export const paintingsGeo = () => byKind(PAINTINGS.map((f) => f()));
// (self-lit, like bright worlds seen from a dimmer hall)
export const glimpsesGeo = () => {
  const g = byKind(GLIMPSES.map((f) => f()));
  const fx = g.attributes.fx.array;
  for (let i = 1; i < fx.length; i += 3) fx[i] = 0.85;
  return g;
};

// Deal designs from a shuffled deck, so every one shows before any repeats
// and no design hangs next to itself (a fresh deck never starts with the
// last one dealt).
export class Deck {
  constructor(n) {
    this.n = n;
    this.cards = [];
    this.last = -1;
  }

  deal(rng) {
    if (!this.cards.length) {
      this.cards = rng.shuffle(Array.from({ length: this.n }, (_, i) => i));
      if (this.cards[0] === this.last && this.n > 1) this.cards.push(this.cards.shift());
    }
    this.last = this.cards.shift();
    return this.last;
  }
}
