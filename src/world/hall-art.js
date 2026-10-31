import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge } from './shapes.js';

// The Hall of Doors' art: nine paintings for its walls, built as ONE
// geometry — every design's triangles marked with its index in uv.x — so a
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

export const PAINTING_COUNT = PAINTINGS.length;
export const paintingsGeo = () => byKind(PAINTINGS.map((f) => f()));

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
