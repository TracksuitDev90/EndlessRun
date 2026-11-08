import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, moved, cloudParts, rockParts, gateFrameParts, gateTop, leafParts, rgb } from './shapes.js';
import { crystal, metal, stone, crystalPoint, nugget, tabular } from './gems.js';
import { groundStrip } from '../render/geo.js';
import { CONFIG } from '../config.js';

// VI · The Sky Road — the processional way of the sun, high over a sea of
// golden cloud: a road of painted limestone with a band of lapis down its
// middle strewn with gold stars, like the ceiling of a tomb, between
// colonnades of painted papyrus columns - their shafts banded in red, gold,
// lapis and green, figures striding round them, their capitals opening like
// papyrus heads under a painted architrave and a cornice striped like a
// temple's - that give way now and then to an avenue of sphinxes on their
// plinths, bronze braziers burning between them. Great temple pylons span
// the road, painted with figures, flags flying from their masts and a winged
// sun over the gate, obelisks before them. Off in the sky, golden pyramids
// stand on floating islands of rock with palms round them, and far off the
// three great pyramids on a plateau of their own; and straight ahead, low
// over the end of the road, Ra's disc with its wings spread wide across the
// sky (skyFx.wings), lapis overhead fading to gold. Returns bring ibises
// wheeling over the clouds, the starry night of Nut, then the boats of the
// sun sailing through the clouds.

const E = {
  lime: '#f0e2c0',
  limeLo: '#d8c49c',
  limeDark: '#b09670',
  lapis: '#2a4aa8',
  lapisDeep: '#1a2c6a',
  turq: '#2fb8b0',
  red: '#b8402a',
  ochre: '#e0a030',
  gold: '#f2c040',
  goldHi: '#ffe08a',
  green: '#3a8a5a',
  black: '#1e1a18',
  white: '#f6f0e0',
  granite: '#8a4a3a',
  graniteHi: '#c07a5a',
  skin: '#c0703a',
  bronze: '#9a6a30',
  rockLo: '#7a4a2a',
  rockHi: '#d8a06a',
  cloudLo: '#f0a050',
  cloudHi: '#ffe0a8',
  palm: '#3a7a3a',
  palmHi: '#7ab84a',
  trunk: '#7a5030',
};

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// Colour a finished part in painted bands (by height, along an axis, or
// round it by angle), a whole triangle at a time so the stripes stay crisp.
function banded(g, colors, { axis = 'y', freq = 4, offset = 0 } = {}) {
  const pos = g.attributes.position.array;
  const col = g.attributes.color.array;
  const cs = colors.map((c) => rgb(c));
  for (let t = 0; t < pos.length / 9; t++) {
    const o = t * 9;
    const x = (pos[o] + pos[o + 3] + pos[o + 6]) / 3;
    const y = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3;
    const z = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    let v;
    if (axis === 'angle') v = (Math.atan2(z, x) / (Math.PI * 2) + 0.5) * freq;
    else v = (axis === 'x' ? x : axis === 'z' ? z : y) * freq + offset;
    const c = cs[((Math.floor(v) % cs.length) + cs.length) % cs.length];
    for (let k = 0; k < 3; k++) {
      col[o + k * 3] = c[0];
      col[o + k * 3 + 1] = c[1];
      col[o + k * 3 + 2] = c[2];
    }
  }
  return g;
}

// --- gems -------------------------------------------------------------------------
// The stones of the pharaohs: turquoise above all, sky blue in its web of
// dark matrix; lapis lazuli, the deep blue of the night of Nut flecked with
// gold; carnelian, the red of the sun; and long shards of aquamarine, the
// clear sky over the clouds. The crown: a scarab carved in turquoise, legs of
// gold, pushing the red disc of the sun up before it.
const TURQUOISE = { opaque: 0.85, veins: 0.9, veinColor: '#3a2a1c', mottle: 0.5, second: '#a2f2ea', rough: 0.35, speckle: 0.1, scale: 7, glints: 0.5 };
function scarab() {
  const legs = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      legs.push(metal(P.box(0.2, 0.025, 0.03), '#f2c040', { x: s * 0.15, y: -0.03, z: -0.08 + i * 0.09, ry: s * (0.5 - i * 0.45), rz: s * -0.4 }));
    }
  }
  return [
    crystal(nugget({ r: [0.15, 0.08, 0.19], faces: 20, spread: 0.06, chips: 1, seed: 8 }), { z: 0.03 }),
    crystal(nugget({ r: [0.09, 0.06, 0.06], faces: 12, spread: 0.08, chips: 1, seed: 3 }), { z: -0.2, y: -0.01 }),
    metal(P.box(0.012, 0.012, 0.36), '#f2c040', { y: 0.075, z: 0.03 }),
    ...legs,
    stone(P.cyl(0.13, 0.13, 0.04, 18), '#d8401a', { z: -0.36, y: 0.08, rx: Math.PI / 2 }),
    metal(P.torus(0.13, 0.018, 4, 18), '#f2c040', { z: -0.36, y: 0.08 }),
  ];
}
const GEM = {
  name: 'turquoise',
  color: '#2ee6d6',
  stones: [
    {
      name: 'turquoise',
      weight: 3,
      tints: ['#3ec8d0', '#4ad6da', '#58c2c4'],
      parts: () => [crystal(nugget({ r: [0.22, 0.18, 0.2], faces: 22, spread: 0.1, chips: 2, seed: 41 }))],
      texture: TURQUOISE,
    },
    {
      // the deep blue of the night of Nut, flecked with gold
      name: 'lapis lazuli',
      weight: 1.5,
      tints: ['#2a48b8', '#2440a8', '#3254c4'],
      parts: () => [crystal(tabular({ r: 0.21, t: 0.1, seed: 12 }), { rx: Math.PI / 2 - 0.3 })],
      texture: { opaque: 0.9, mottle: 0.45, second: '#5a7ae0', speckle: 0.55, veins: 0.25, veinColor: '#e8e4dc', rough: 0.3, scale: 8, glints: 1.2 },
    },
    {
      // the red of the sun
      name: 'carnelian',
      weight: 1.3,
      tints: ['#e05a2a', '#d84a20', '#f06a30'],
      parts: () => [crystal(nugget({ r: [0.2, 0.15, 0.18], faces: 26, spread: 0.06, chips: 1, seed: 19 }))],
      texture: { mottle: 0.55, second: '#ffb070', rough: 0.15, opaque: 0.25, speckle: 0.05, glints: 1.1 },
    },
    {
      name: 'aquamarine',
      weight: 1,
      tints: ['#2ee6d6', '#4af0e8', '#22d0e4'],
      parts: () => [crystal(crystalPoint({ r: 0.11, len: 0.42, tip: 0.16, double: true, seed: 5 }), { rz: 0.32, rx: 0.12 })],
      texture: { bands: 0.25, bandFreq: 12, second: '#c8fff8', mottle: 0.35, rough: 0.3, speckle: 0.08 },
    },
  ],
  crown: {
    name: 'turquoise scarab',
    tints: ['#3ec8d0', '#4ad6da', '#2ee6d6'],
    parts: () => scarab(),
    texture: TURQUOISE,
  },
  motion: [1.0, 1.4, 0.1, 0.2],
  look: [0.75, 1.1, 0.3, 0.32],
  glow: 0.6,
  pool: 0.25,
};

// --- painted reliefs ----------------------------------------------------------------
// Flat figures in painted relief, standing out of a face toward +z (t thick),
// in the flat colour and outline of a temple wall. Each returns parts.

// A figure striding in profile toward +x (s: its height in metres): a striped
// headdress, a broad collar, a kilt, one foot forward, a staff in hand.
function figureParts({ s = 1.8, x = 0, y = 0, z = 0, t = 0.08, kilt = E.white, cloth = E.lapis, flip = false }) {
  const k = s / 1.8;
  const f = flip ? -1 : 1;
  const b = (w, h, cx, cy, color, o = {}) => part(P.box(w * k, h * k, t), color, { x: x + f * cx * k, y: y + cy * k, z, outline: 0.5, ...o });
  const out = [
    b(0.3, 0.3, 0.02, 1.62, E.skin), // head
    b(0.12, 0.08, 0.17, 1.6, E.skin), // nose
    b(0.34, 0.36, -0.04, 1.62, cloth, { z: z - 0.01 }), // headdress
    b(0.1, 0.42, -0.14, 1.42, cloth), // its lappet
    b(0.46, 0.14, 0.0, 1.38, E.gold), // collar
    b(0.36, 0.5, 0.0, 1.06, E.skin), // torso
    b(0.5, 0.42, 0.04, 0.62, kilt), // kilt
    b(0.12, 0.62, 0.2, 0.22, E.skin, { rz: f * -0.25 }), // front leg
    b(0.12, 0.62, -0.14, 0.22, E.skin, { rz: f * 0.22 }), // back leg
    b(0.42, 0.06, 0.06, 0.82, E.red), // belt
    b(0.1, 0.5, 0.26, 1.08, E.skin, { rz: f * -0.5 }), // arm
  ];
  out.push(part(P.box(0.05 * k, 1.9 * k, t), cloth, { x: x + f * 0.42 * k, y: y + 0.95 * k, z: z + 0.01, outline: 0.4 })); // staff
  out.push(part(P.box(0.16 * k, 0.1 * k, t), E.gold, { x: x + f * 0.42 * k, y: y + 1.92 * k, z, outline: 0 }));
  return out;
}

// The eye of Horus.
function wedjatParts({ s = 1, x = 0, y = 0, z = 0, t = 0.08, color = E.lapis }) {
  const out = [];
  const eye = new THREE.Shape();
  eye.moveTo(-0.5, 0);
  eye.quadraticCurveTo(0, 0.32, 0.5, 0);
  eye.quadraticCurveTo(0, -0.22, -0.5, 0);
  const almond = P.extrude(eye, t, 10);
  out.push(part(almond, E.white, { x, y, z, s, sz: 1, outline: 0.5 }));
  out.push(part(P.cyl(0.12 * s, 0.12 * s, t * 1.4, 12), E.black, { x: x + 0.02 * s, y: y + 0.02 * s, z: z + 0.02, rx: Math.PI / 2, outline: 0 }));
  out.push(part(P.torus(0.55 * s, 0.05 * s, 4, 14, Math.PI * 0.62), color, { x, y: y - 0.2 * s, z, rz: Math.PI * 0.19, sx: 1, sy: 0.75, outline: 0.4 }));
  out.push(part(P.box(0.08 * s, 0.4 * s, t), color, { x: x + 0.05 * s, y: y - 0.28 * s, z, outline: 0.4 }));
  out.push(part(P.torus(0.16 * s, 0.045 * s, 4, 12, Math.PI * 1.3), color, { x: x - 0.32 * s, y: y - 0.38 * s, z, rz: Math.PI * 0.6, outline: 0.4 }));
  out.push(part(P.box(0.75 * s, 0.06 * s, t), color, { x: x + 0.05 * s, y: y + 0.36 * s, z, rz: -0.08, outline: 0.4 }));
  return out;
}

// The ankh.
function ankhParts({ s = 1, x = 0, y = 0, z = 0, t = 0.08, color = E.gold }) {
  return [
    part(P.torus(0.17 * s, 0.05 * s, 5, 16), color, { x, y: y + 0.72 * s, z, sy: 1.3, outline: 0.4 }),
    part(P.box(0.56 * s, 0.1 * s, t), color, { x, y: y + 0.48 * s, z, outline: 0.4 }),
    part(P.box(0.1 * s, 0.5 * s, t), color, { x, y: y + 0.2 * s, z, outline: 0.4 }),
  ];
}

// The winged disc: a red sun between feathered wings (span either side),
// rows of feathers - little lapis and red coverts, a green band, long flight
// feathers in lapis and gold. half: only the wing to -x (a door's leaf).
function wingedDiscParts({ span = 2.4, r = 0.36, x = 0, y = 0, z = 0, t = 0.08, half = false }) {
  const out = [];
  if (half) out.push(part(P.cyl(r, r, t * 1.6, 14, 1, false, Math.PI, Math.PI), E.red, { x, y, z, rx: Math.PI / 2, outline: 0.5 }));
  else out.push(part(P.cyl(r, r, t * 1.6, 16), E.red, { x, y, z, rx: Math.PI / 2, outline: 0.5 }));
  for (const s of half ? [-1] : [-1, 1]) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const fx = x + s * (r + 0.05 + u * (span - r));
      const droop = -u * u * 0.22 * span;
      const fl = (0.55 - 0.3 * u) * span * 0.32;
      out.push(part(P.box(((span - r) / n) * 0.92, 0.1 * span * 0.3, t), i % 2 ? E.red : E.lapis, { x: fx, y: y + 0.16 * span * 0.3 + droop, z, outline: 0.3 }));
      out.push(part(P.box(((span - r) / n) * 0.92, 0.09 * span * 0.3, t), E.green, { x: fx, y: y + 0.04 + droop, z, outline: 0.3 }));
      out.push(part(P.box(((span - r) / n) * 0.8, fl, t), i % 2 ? E.gold : E.lapis, { x: fx, y: y - fl / 2 + droop, z, rz: s * u * 0.12, outline: 0.4 }));
    }
  }
  return out;
}

// --- the architecture ------------------------------------------------------------
const COL_X = 5.7; // the colonnades, either side of the road
const STYLO_Y = 0.5; // the stylobate they stand on
const COL_H = 7.0;

// A papyrus column: a base, the shaft (its foot sheathed in painted leaves,
// a band of figures striding round it, painted bands under the capital), the
// capital opening like a papyrus head, striped, and the abacus on top.
function papyrusColumn(variant, x = 0, z = 0) {
  const parts = [];
  const y0 = STYLO_Y;
  const r = 0.6;
  parts.push(part(P.cyl(0.95, 1.0, 0.3, 12), E.limeLo, { x, y: y0 + 0.15, z }));
  const shaftH = 5.0;
  parts.push(part(P.cyl(r * 0.88, r, shaftH, 14), E.lime, { x, y: y0 + 0.3 + shaftH / 2, z }));
  // the foot sheathed in pointed leaves, green and lapis
  const sheath = part(P.cyl(r * 0.96, r * 1.04, 0.8, 12), '#ffffff', { x: 0, y: 0, z: 0 });
  banded(sheath, [E.green, E.gold, E.lapis, E.gold], { axis: 'angle', freq: 12 });
  parts.push(moved([sheath], { x, y: y0 + 0.7, z })[0]);
  // a figure striding round it, on the face toward the road
  const fy = y0 + 1.4;
  parts.push(...moved(figureParts({ s: 1.3, x: -0.2, y: 0, z: r * 0.97, t: 0.06, cloth: variant ? E.red : E.lapis }), { x, y: fy, z, ry: x > 0 ? -Math.PI / 2 : Math.PI / 2 }));
  // painted bands under the capital (one ring, banded)
  const bands = part(P.cyl(r * 0.93, r * 0.93, 0.91, 10, 7, true), '#ffffff', { outline: 0 });
  banded(bands, [E.red, E.gold, E.lapis, E.gold, E.green, E.gold, E.red], { axis: 'y', freq: 7 / 0.91, offset: 3.5 });
  parts.push(moved([bands], { x, y: y0 + 4.38, z })[0]);
  // the capital: an open papyrus head, striped
  const cap = part(P.lathe([[r * 0.85, 0], [r * 1.05, 0.25], [r * 1.5, 0.75], [r * 1.85, 1.15], [r * 1.85, 1.25], [0.01, 1.25]], 16), '#ffffff', { outline: 0.6 });
  banded(cap, variant ? [E.green, E.lime, E.lapis, E.lime] : [E.lapis, E.gold, E.green, E.gold], { axis: 'angle', freq: 16 });
  parts.push(moved([cap], { x, y: y0 + 0.3 + shaftH, z })[0]);
  parts.push(part(P.box(1.3, 0.35, 1.3), E.limeLo, { x, y: y0 + COL_H - 0.18, z }));
  return parts;
}

// The road's deck: the causeway itself under the road, and the stylobates
// either side of it.
function deckGeo() {
  return merge([
    part(P.box(15.2, 5, 16, 1, 1, 8), null, { y: -2.52, z: -8, grad: [E.rockLo, E.limeDark, -5, 0], outline: 0 }),
    part(P.box(9.6, 8, 16, 1, 1, 8), E.rockLo, { y: -9, z: -8, outline: 0 }),
    ...[-1, 1].flatMap((s) => [
      part(P.box(2.9, STYLO_Y, 16), E.limeLo, { x: s * 5.9, y: STYLO_Y / 2, z: -8 }),
      part(P.box(0.14, 0.14, 16), E.lapis, { x: s * 4.47, y: STYLO_Y - 0.12, z: -8, outline: 0 }),
      part(P.box(0.14, 0.12, 16), E.red, { x: s * 4.47, y: STYLO_Y - 0.28, z: -8, outline: 0 }),
    ]),
  ]);
}

// A colonnade along each side: four columns to a chunk, the architrave on
// them painted in bands, the torus moulding along it and the cavetto
// cornice over it striped like a temple's.
function colonnadeGeo(variant) {
  const parts = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) parts.push(...papyrusColumn(variant, s * COL_X, -2 - i * 4));
    const y = STYLO_Y + COL_H;
    parts.push(part(P.box(1.5, 0.95, 16), E.lime, { x: s * COL_X, y: y + 0.47, z: -8 }));
    [E.lapis, E.gold, E.red].forEach((c, k) => parts.push(part(P.box(0.06, 0.18, 16), c, { x: s * (COL_X - 0.76), y: y + 0.2 + k * 0.26, z: -8, outline: 0 })));
    parts.push(part(P.cyl(0.1, 0.1, 16, 8), E.limeLo, { x: s * (COL_X - 0.76), y: y + 0.98, z: -8, rx: Math.PI / 2, outline: 0.4 }));
    const cornice = part(P.box(0.4, 0.8, 16, 1, 1, 40), '#ffffff', { x: s * (COL_X - 0.7), y: y + 1.4, z: -8, rz: s * 0.35 });
    banded(cornice, [E.lapis, E.lime, E.red, E.lime, E.green, E.lime], { axis: 'z', freq: 2.5 });
    parts.push(cornice);
    parts.push(part(P.box(1.9, 0.25, 16), E.lime, { x: s * COL_X, y: y + 1.9, z: -8 }));
  }
  return merge(parts);
}

// A sphinx on its plinth, facing +x (turned to face the road): a lion's
// body lying with its paws out before it, a king's face in the striped
// headdress, the false beard; the plinth painted with a band of cartouches.
function sphinxParts() {
  const out = [];
  const L = E.limeLo;
  out.push(part(P.box(3.2, 0.9, 1.6), E.lime, { x: 0, y: 0.45 }));
  [E.red, E.gold, E.lapis].forEach((c, k) => out.push(part(P.box(0.06, 0.12, 1.4), c, { x: 1.63, y: 0.25 + k * 0.18, outline: 0 })));
  out.push(part(P.box(0.06, 0.32, 0.6), E.gold, { x: 1.64, y: 0.5, outline: 0.4 }));
  const by = 0.9;
  out.push(part(P.capsule(0.42, 1.5, 4, 10), L, { x: -0.25, y: by + 0.42, rz: Math.PI / 2 }));
  out.push(part(P.sphere(0.55, 10, 8), L, { x: -0.95, y: by + 0.5, sx: 1.0, sy: 0.85 }));
  out.push(part(P.sphere(0.5, 10, 8), L, { x: 0.55, y: by + 0.65, sx: 0.9, sy: 1.1, sz: 0.85 }));
  for (const zz of [-0.28, 0.28]) {
    out.push(part(P.box(1.1, 0.24, 0.26), L, { x: 1.0, y: by + 0.12, z: zz }));
    out.push(part(P.sphere(0.15, 8, 6), L, { x: 1.55, y: by + 0.12, z: zz, sy: 0.7 }));
  }
  // the head in its striped headdress
  const hx = 0.85;
  const hy = by + 1.45;
  out.push(part(P.sphere(0.3, 10, 8), E.lime, { x: hx + 0.05, y: hy, sz: 0.85 }));
  const nemes = part(new THREE.SphereGeometry(0.38, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), '#ffffff', { x: hx - 0.04, y: hy + 0.02 });
  banded(nemes, [E.gold, E.lapis], { axis: 'y', freq: 14 });
  out.push(nemes);
  for (const zz of [-0.3, 0.3]) {
    const lap = part(P.box(0.22, 0.62, 0.1), '#ffffff', { x: hx + 0.02, y: hy - 0.32, z: zz });
    banded(lap, [E.gold, E.lapis], { axis: 'y', freq: 14 });
    out.push(lap);
  }
  out.push(part(P.box(0.1, 0.1, 0.12), E.lime, { x: hx + 0.33, y: hy - 0.02 }));
  out.push(part(P.cyl(0.05, 0.05, 0.28, 6), E.lapis, { x: hx + 0.24, y: hy - 0.34, outline: 0.4 }));
  out.push(part(P.cone(0.06, 0.18, 6), E.gold, { x: hx + 0.1, y: hy + 0.4 }));
  return out;
}
function sphinxesGeo(zs) {
  const parts = [];
  for (const s of [-1, 1]) {
    for (const z of zs) parts.push(...moved(sphinxParts(), { x: s * 5.95, y: STYLO_Y, z: -z, ry: s < 0 ? 0 : Math.PI }));
  }
  return merge(parts);
}

// A bronze brazier on a tall stand, burning.
function brazierGeo() {
  return merge([
    part(P.cyl(0.32, 0.4, 0.12, 10), E.bronze, { y: 0.06 }),
    part(P.cyl(0.06, 0.08, 1.8, 6), E.bronze, { y: 0.96 }),
    part(P.cyl(0.42, 0.18, 0.32, 12), E.bronze, { y: 1.95 }),
    part(P.cone(0.3, 0.5, 7), '#ffb040', { y: 2.3, emit: 1, outline: 0 }),
    part(P.cone(0.16, 0.38, 6), '#fff0a0', { y: 2.32, emit: 1, outline: 0 }),
  ]);
}

// An obelisk: rose granite, a column of glyphs down its face, a gilded
// pyramidion.
function obeliskParts(h = 9, x = 0, z = 0) {
  const out = [
    part(P.box(1.6, 0.6, 1.6), E.limeLo, { x, y: 0.3, z }),
    part(P.cyl(0.4, 0.62, h, 4), null, { x, y: 0.6 + h / 2, z, ry: Math.PI / 4, grad: [E.granite, E.graniteHi, 0, h] }),
    part(P.cone(0.57, 1.0, 4), E.gold, { x, y: 0.6 + h + 0.5, z, ry: Math.PI / 4, emit: 0.5 }),
  ];
  const glyphs = [E.lapis, E.gold, E.black, E.red];
  for (const f of [1, -1]) {
    for (let i = 0; i < Math.floor(h / 0.7) - 1; i++) {
      const gy = 1.2 + i * 0.7;
      const w = 0.62 - (0.22 * gy) / h;
      out.push(part(P.box(0.2, 0.3, 0.05), glyphs[i % 4], { x, y: gy, z: z + f * (w * 0.72 + 0.02), outline: 0 }));
    }
  }
  return out;
}

// A temple pylon over the road: two great sloping towers painted with
// figures, the cavetto cornice striped along their tops, masts with
// pennants before them; between them the gate, its lintel crowned with the
// winged disc.
function pylonTowerParts(cx, w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) pos.setX(i, pos.getX(i) * 0.84);
  }
  g.computeVertexNormals();
  const out = [part(g, null, { x: cx, y: h / 2, grad: [E.limeLo, E.lime, 0, h] })];
  const cornice = part(P.box(w * 0.88, 1.1, d + 0.6, 24, 1, 1), '#ffffff', { x: cx, y: h + 0.4 });
  banded(cornice, [E.lapis, E.lime, E.red, E.lime, E.green, E.lime], { axis: 'x', freq: 1.6 });
  out.push(cornice);
  out.push(part(P.box(w * 0.86, 0.22, d + 0.3), E.lime, { x: cx, y: h - 0.15 }));
  return out;
}
function pylonGeo() {
  const parts = [];
  const h = 15;
  const d = 3.2;
  const w = 8.4;
  for (const s of [-1, 1]) {
    const cx = s * (5.4 + w / 2);
    parts.push(...pylonTowerParts(cx, w, h, d));
    // a king striding toward the gate on each tower, a god facing him
    parts.push(...figureParts({ s: 6.2, x: cx - s * 1.8, y: 2.6, z: d / 2 + 0.02, t: 0.12, flip: s > 0, cloth: E.lapis }));
    parts.push(...figureParts({ s: 5.4, x: cx + s * 1.9, y: 2.6, z: d / 2 + 0.02, t: 0.12, flip: s < 0, cloth: E.green, kilt: E.gold }));
    parts.push(...wedjatParts({ s: 1.2, x: cx, y: 11.2, z: d / 2 + 0.04, t: 0.12 }));
    // the masts
    for (const mx of [cx - s * 2.6, cx - s * 0.8]) {
      parts.push(part(P.cyl(0.13, 0.17, 21, 6), E.trunk, { x: mx, y: 10.5, z: d / 2 + 0.5 }));
      parts.push(part(P.box(0.04, 1.6, 0.9), mx === cx - s * 2.6 ? E.red : E.lapis, { x: mx, y: 19.8, z: d / 2 + 0.95, outline: 0.4 }));
    }
  }
  // the gate between them
  parts.push(part(P.box(10.8, 1.6, d + 0.4), E.lime, { y: 11.0 }));
  const lintelC = part(P.box(11.2, 0.9, d + 0.9, 24, 1, 1), '#ffffff', { y: 12.25 });
  banded(lintelC, [E.lapis, E.lime, E.red, E.lime, E.green, E.lime], { axis: 'x', freq: 1.6 });
  parts.push(lintelC);
  parts.push(...wingedDiscParts({ span: 4.4, r: 0.55, y: 11.0, z: d / 2 + 0.24, t: 0.12 }));
  for (const s of [-1, 1]) parts.push(part(P.box(0.6, 10.2, d + 0.3), E.limeLo, { x: s * 5.4, y: 5.1 }));
  return merge(parts);
}

// A floating island: a crag of rock under a paved top, a golden pyramid (or
// two) on it, palms round its edge.
function palmParts(x, z, h, seed) {
  const rnd = seeded(seed);
  const out = [];
  let px = x, py = 0;
  const lean = (rnd() - 0.5) * 0.5;
  for (let i = 0; i < 4; i++) {
    out.push(part(P.cyl(0.13, 0.17, h / 4, 6), E.trunk, { x: px, y: py + h / 8, z, rz: -lean }));
    px += Math.sin(lean) * (h / 4);
    py += Math.cos(lean) * (h / 4);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    out.push(part(P.box(1.6, 0.05, 0.34), null, { x: px + Math.cos(a) * 0.75, y: py - 0.15, z: z + Math.sin(a) * 0.75, ry: -a, rz: -0.35, grad: [E.palm, E.palmHi, py - 0.6, py], outline: 0.4 }));
  }
  return out;
}
function pyramidParts(r, h, x = 0, y = 0, z = 0) {
  return [
    part(P.cone(r, h, 4), null, { x, y: y + h / 2, z, ry: Math.PI / 4, grad: [E.limeDark, E.lime, y, y + h], mark: 0.35 }),
    part(P.cone(r * 0.12, h * 0.12, 4), E.gold, { x, y: y + h * 0.94, z, ry: Math.PI / 4, emit: 0.6 }),
  ];
}
function islandGeo(seed, kind) {
  const rnd = seeded(seed);
  const parts = [...rockParts({ r: 4, lo: E.rockLo, hi: E.rockHi, sx: 1.5, sy: 1.1, sz: 1.3, seed })].map((g) => g.translate(0, -4.8, 0));
  parts.push(part(P.cyl(5.2, 4.8, 0.6, 14), null, { y: 0, grad: [E.limeDark, E.lime, -0.3, 0.3] }));
  if (kind === 0) {
    parts.push(...pyramidParts(3.4, 5.2, 0, 0.3, 0));
  } else if (kind === 1) {
    parts.push(...pyramidParts(2.6, 4.0, -1.4, 0.3, 0.6), ...pyramidParts(1.6, 2.5, 2.2, 0.3, -1.2));
  } else {
    parts.push(...obeliskParts(5, -1.2, 0), ...obeliskParts(4, 1.4, 0.8));
  }
  for (let i = 0; i < 3; i++) {
    const a = rnd() * 6.28;
    parts.push(...palmParts(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 3 + rnd() * 1.5, seed * 7 + i).map((g) => g.translate(0, 0.3, 0)));
  }
  return merge(parts);
}
// The three great pyramids, far off on a plateau of their own.
function plateauGeo() {
  const parts = [...rockParts({ r: 14, lo: E.rockLo, hi: E.rockHi, sx: 2.4, sy: 1.0, sz: 1.6, seed: 9 })].map((g) => g.translate(0, -14, 0));
  parts.push(part(P.cyl(26, 22, 1.2, 18), null, { y: 0, grad: [E.limeDark, E.limeLo, -0.6, 0.6] }));
  parts.push(...pyramidParts(13, 18, -14, 0.6, 4), ...pyramidParts(14, 20, 4, 0.6, -2), ...pyramidParts(8, 11, 18, 0.6, 6));
  return merge(parts);
}

// --- the sky's creatures -------------------------------------------------------------
// An ibis: white, black head and wingtips, the long curved beak, legs
// trailing (its wings flap in the shader).
function ibisParts() {
  const W = '#f6f2ea';
  const B = '#1a1614';
  return [
    part(P.sphere(0.18, 8, 6), W, { sz: 2.0, sx: 0.85 }),
    part(P.cyl(0.05, 0.06, 0.4, 6), B, { z: -0.42, y: 0.08, rx: Math.PI / 2 - 0.3 }),
    part(P.sphere(0.08, 8, 6), B, { z: -0.62, y: 0.15 }),
    part(P.cyl(0.015, 0.025, 0.42, 5), B, { z: -0.84, y: 0.07, rx: Math.PI / 2 + 0.55, outline: 0.4 }),
    part(P.box(0.03, 0.03, 0.5), B, { z: 0.55, y: -0.05, outline: 0.3 }),
    part(P.box(0.6, 0.03, 0.26), W, { x: -0.38, y: 0.02, rz: -0.08 }),
    part(P.box(0.6, 0.03, 0.26), W, { x: 0.38, y: 0.02, rz: 0.08 }),
    part(P.box(0.36, 0.025, 0.18), B, { x: -0.8, y: 0.05, z: 0.04, rz: -0.15 }),
    part(P.box(0.36, 0.025, 0.18), B, { x: 0.8, y: 0.05, z: 0.04, rz: 0.15 }),
  ];
}

// A boat of the sun: a papyrus hull curling up at both ends into papyrus
// heads, a gilded shrine amidships with the red disc of the sun over it, a
// canopy, and the great steering oars at the stern.
function barqueGeo() {
  const parts = [];
  const hullC = '#d8b878';
  for (let i = 0; i < 9; i++) {
    const u = i / 8 - 0.5;
    const y = 0.6 * Math.pow(Math.abs(u) * 2, 2.4);
    parts.push(part(P.cyl(0.42 - 0.25 * Math.abs(u) * 2, 0.42 - 0.25 * Math.abs(u) * 2, 1.3, 8), hullC, { z: u * 10, y, rx: Math.PI / 2 - u * 0.9 }));
  }
  for (const s of [-1, 1]) {
    parts.push(part(P.cone(0.5, 1.1, 10), E.green, { z: s * 5.4, y: 1.7, rx: s * 0.6 }));
    parts.push(part(P.cyl(0.12, 0.16, 1.4, 6), hullC, { z: s * 5.2, y: 1.0, rx: s * 0.4 }));
  }
  [E.red, E.gold, E.lapis].forEach((c, k) => parts.push(part(P.box(0.86, 0.08, 7), c, { y: 0.15 + k * 0.1, outline: 0 })));
  parts.push(part(P.box(1.2, 1.2, 1.6), E.gold, { y: 1.0, z: 0.4, emit: 0.2 }));
  parts.push(part(P.box(0.9, 0.5, 1.3), E.lapis, { y: 1.85, z: 0.4 }));
  parts.push(part(P.cyl(0.5, 0.5, 0.12, 18), E.red, { y: 2.7, z: 0.4, rx: Math.PI / 2, emit: 0.6 }));
  parts.push(part(P.box(1.6, 0.08, 3.2), E.white, { y: 2.1, z: -1.8 }));
  for (const [x, z] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, -3.2], [0.7, -3.2]]) parts.push(part(P.cyl(0.04, 0.04, 1.9, 5), E.trunk, { x, y: 1.1, z }));
  for (const s of [-1, 1]) parts.push(part(P.box(0.1, 0.1, 3.4), E.trunk, { x: s * 0.6, y: 0.6, z: 4.6, rx: 0.5, outline: 0.4 }));
  return merge(parts);
}

// --- obstacles ------------------------------------------------------------------
// L · A sarcophagus lying across the lane: gilded, banded in lapis, the pair
// of eyes on its side to look out at you.
function sarcophagusGeo() {
  const parts = [
    part(P.box(1.9, 0.62, 0.72), E.gold, { y: 0.31 }),
    part(P.cyl(0.36, 0.36, 1.9, 12, 1, false, 0, Math.PI), E.gold, { y: 0.62, rz: Math.PI / 2, sx: 0.85, emit: 0.1 }),
    part(P.box(2.0, 0.08, 0.8), E.lapis, { y: 0.04 }),
  ];
  for (const x of [-0.7, 0, 0.7]) parts.push(part(P.box(0.08, 0.6, 0.74), E.lapis, { x, y: 0.33, outline: 0 }));
  for (const s of [-1, 1]) parts.push(...wedjatParts({ s: 0.36, x: s * 0.36, y: 0.38, z: 0.37, t: 0.03 }));
  return merge(parts).translate(0, 0, -0.36);
}

// L · An offering table: a stone altar laden with canopic jars, loaves and
// lotus.
function offeringGeo() {
  const parts = [
    part(P.box(1.9, 0.42, 0.8), E.lime, { y: 0.21 }),
    part(P.box(2.0, 0.08, 0.9), E.limeLo, { y: 0.44 }),
  ];
  [E.red, E.lapis, E.gold].forEach((c, k) => parts.push(part(P.box(1.7, 0.06, 0.02), c, { y: 0.12 + k * 0.09, z: 0.41, outline: 0 })));
  const lids = [E.gold, E.lapis, E.green];
  [-0.55, 0, 0.55].forEach((x, i) => {
    parts.push(part(P.lathe([[0, 0], [0.13, 0.02], [0.17, 0.18], [0.12, 0.34], [0.08, 0.36], [0, 0.36]], 10), E.white, { x, y: 0.48 }));
    parts.push(part(P.sphere(0.085, 8, 6), lids[i], { x, y: 0.86 }));
    parts.push(part(P.cone(0.035, 0.08, 5), lids[i], { x: x + 0.05, y: 0.9, rz: -0.6 }));
  });
  for (const x of [-0.82, 0.28]) parts.push(part(P.sphere(0.12, 8, 6), '#d89a4a', { x, y: 0.55, z: 0.18, sy: 0.6 }));
  parts.push(part(P.cone(0.12, 0.3, 6), E.green, { x: 0.82, y: 0.62, z: 0.1 }));
  return merge(parts).translate(0, 0, -0.4);
}

// H · A painted gateway: papyrus posts and a lintel at the duck line,
// crowned with the winged disc.
function lintelGeo(half) {
  const D = CONFIG.duckLine;
  const beamH = 0.7;
  const top = D + beamH;
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.cyl(0.24, 0.28, top, 10), E.lime, { x: s * half, y: top / 2 }));
    [E.red, E.gold, E.lapis].forEach((c, k) => parts.push(part(P.cyl(0.25, 0.25, 0.08, 10), c, { x: s * half, y: top - 0.45 - k * 0.09, outline: 0 })));
    parts.push(part(P.cyl(0.38, 0.25, 0.3, 10), E.green, { x: s * half, y: top - 0.15 }));
  }
  parts.push(part(P.box(half * 2 + 0.8, beamH, 0.6), E.lime, { y: D + beamH / 2 }));
  const cornice = part(P.box(half * 2 + 1.1, 0.34, 0.75, Math.max(6, Math.round(half * 5)), 1, 1), '#ffffff', { y: top + 0.17 });
  banded(cornice, [E.lapis, E.lime, E.red, E.lime, E.green, E.lime], { axis: 'x', freq: 2.4 });
  parts.push(cornice);
  parts.push(part(P.box(half * 2 + 0.7, 0.08, 0.62), E.red, { y: D + 0.04, outline: 0.5 }));
  parts.push(...wingedDiscParts({ span: Math.min(half + 0.3, 2.2), r: 0.2, y: D + beamH / 2 + 0.04, z: 0.31, t: 0.04 }));
  return merge(parts).translate(0, 0, -0.3);
}

// W · A seated colossus of the king: the throne, the striped headdress, the
// false beard, hands on his knees.
function colossusGeo() {
  const G = E.granite;
  const parts = [
    part(P.box(1.9, 0.5, 1.9), E.limeLo, { y: 0.25 }),
    part(P.box(1.5, 1.5, 1.2), G, { y: 1.25, z: -0.3 }),
    part(P.box(1.4, 0.4, 1.3), G, { y: 2.1, z: 0.2 }),
    part(P.box(0.5, 1.4, 0.45), G, { x: -0.36, y: 1.2, z: 0.62 }),
    part(P.box(0.5, 1.4, 0.45), G, { x: 0.36, y: 1.2, z: 0.62 }),
    part(P.box(1.2, 1.5, 0.8), G, { y: 3.0, z: -0.25 }),
    part(P.box(1.4, 0.3, 0.9), E.gold, { y: 3.6, z: -0.2 }),
  ];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.32, 0.95, 0.36), G, { x: s * 0.72, y: 2.95, z: -0.15 }));
    parts.push(part(P.box(0.3, 0.3, 0.8), G, { x: s * 0.5, y: 2.45, z: 0.35 }));
    const lap = part(P.box(0.32, 1.0, 0.18), '#ffffff', { x: s * 0.48, y: 3.65, z: 0.02 });
    banded(lap, [E.gold, E.lapis], { axis: 'y', freq: 9 });
    parts.push(lap);
  }
  parts.push(part(P.sphere(0.42, 10, 8), G, { y: 4.15, z: -0.15, sz: 0.9 }));
  const nemes = part(new THREE.SphereGeometry(0.56, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), '#ffffff', { y: 4.25, z: -0.25 });
  banded(nemes, [E.gold, E.lapis], { axis: 'y', freq: 9 });
  parts.push(nemes);
  parts.push(part(P.cyl(0.08, 0.06, 0.45, 6), E.lapis, { y: 3.7, z: 0.15 }));
  parts.push(part(P.cone(0.09, 0.28, 6), E.gold, { y: 4.75, z: 0.05 }));
  [E.red, E.gold, E.lapis].forEach((c, k) => parts.push(part(P.box(1.52, 0.08, 0.02), c, { y: 0.9 + k * 0.12, z: 0.31, outline: 0 })));
  return merge(parts).translate(0, 0, -0.8);
}

// LW · A low screen wall across the road: painted bands, a row of gilded
// cartouches, a striped cornice.
function screenWallGeo() {
  const parts = [part(P.box(8.6, 0.72, 0.5), E.lime, { y: 0.36 })];
  [E.red, E.gold, E.lapis].forEach((c, k) => parts.push(part(P.box(8.6, 0.06, 0.02), c, { y: 0.12 + k * 0.08, z: 0.26, outline: 0 })));
  for (let i = 0; i < 8; i++) {
    const x = -3.75 + i * 1.07;
    parts.push(part(P.capsule(0.11, 0.22, 3, 8), E.gold, { x, y: 0.52, z: 0.26, sz: 0.3, outline: 0.4 }));
    parts.push(part(P.box(0.02, 0.32, 0.02), E.lapis, { x, y: 0.52, z: 0.3, outline: 0 }));
  }
  const cornice = part(P.box(8.9, 0.22, 0.66, 30, 1, 1), '#ffffff', { y: 0.83 });
  banded(cornice, [E.lapis, E.lime, E.red, E.lime, E.green, E.lime], { axis: 'x', freq: 3.4 });
  parts.push(cornice);
  return merge(parts).translate(0, 0, -0.25);
}

// --- the door into the Sky Road --------------------------------------------------
// A temple pylon: two sloping towers painted with figures either side of the
// door, masts and pennants before them, the cornice striped along their
// tops, the winged disc over the door, obelisks before it.
const OPENING = { halfW: 4.6, rectH: 9.6, arch: false };
const GATE_DEPTH = 1.8;
function gateGeo() {
  const parts = [...gateFrameParts(OPENING, { thick: 1.3, depth: GATE_DEPTH, color: E.lime })];
  const top = gateTop(OPENING);
  const lintel = part(P.box(OPENING.halfW * 2 + 2.8, 1.0, GATE_DEPTH + 0.6, 24, 1, 1), '#ffffff', { y: top + 1.7 });
  banded(lintel, [E.lapis, E.lime, E.red, E.lime, E.green, E.lime], { axis: 'x', freq: 1.6 });
  parts.push(lintel);
  parts.push(part(P.box(OPENING.halfW * 2 + 2.4, 1.3, GATE_DEPTH + 0.2), E.lime, { y: top + 0.65 }));
  parts.push(...wingedDiscParts({ span: 4.2, r: 0.55, y: top + 0.62, z: GATE_DEPTH / 2 + 0.15, t: 0.12 }));
  const w = 9.6;
  for (const s of [-1, 1]) {
    const cx = s * (OPENING.halfW + 1.3 + w / 2);
    parts.push(...moved(pylonTowerParts(0, w, 17, 3.4), { x: cx, z: -0.5 }));
    parts.push(...figureParts({ s: 7.2, x: cx - s * 2.0, y: 2.4, z: 1.24, t: 0.12, flip: s > 0, cloth: E.lapis }));
    parts.push(...figureParts({ s: 6.2, x: cx + s * 2.2, y: 2.4, z: 1.24, t: 0.12, flip: s < 0, cloth: E.green, kilt: E.gold }));
    parts.push(...ankhParts({ s: 2.0, x: cx, y: 11.8, z: 1.26, t: 0.12 }));
    for (const mx of [cx - s * 3.0, cx - s * 0.6]) {
      parts.push(part(P.cyl(0.14, 0.18, 24, 6), E.trunk, { x: mx, y: 12, z: 1.9 }));
      parts.push(part(P.box(0.04, 1.8, 1.0), mx === cx - s * 3.0 ? E.red : E.lapis, { x: mx, y: 22.6, z: 2.4, outline: 0.4 }));
    }
    parts.push(...obeliskParts(10, s * (OPENING.halfW + 2.2), 3.4));
  }
  return merge(parts);
}

// Its leaves: gilded temple doors - the winged disc spread across their top
// (half on each), a tall lapis panel with a gold ankh, a band of coloured
// panels and a dado striped below.
function templeLeaf({ W, H, z, f }) {
  const out = [];
  const at = (t) => z + (f * t) / 2;
  out.push(...wingedDiscParts({ span: W * 0.92, r: 0.6, x: W, y: H - 1.25, z: at(0.1), t: 0.1, half: true }));
  out.push(part(P.box(W * 0.6, 3.8, 0.08), E.lapis, { x: W * 0.48, y: 4.9, z: at(0.08), outline: 0.5 }));
  out.push(part(P.box(W * 0.66, 4.1, 0.05), E.gold, { x: W * 0.48, y: 4.9, z: at(0.05), outline: 0 }));
  out.push(...ankhParts({ s: 2.6, x: W * 0.48, y: 3.6, z: at(0.14), t: 0.1 }));
  const blocks = [E.red, E.lapis, E.green, E.gold, E.turq];
  for (let i = 0; i < 5; i++) out.push(part(P.box((W - 0.6) / 5 - 0.06, 0.55, 0.08), blocks[i], { x: 0.3 + ((W - 0.6) / 5) * (i + 0.5), y: 2.0, z: at(0.08), outline: 0.4 }));
  for (let i = 0; i < 9; i++) out.push(part(P.box(0.18, 1.2, 0.06), i % 2 ? E.lapis : E.red, { x: 0.35 + i * ((W - 0.7) / 8), y: 0.85, z: at(0.06), outline: 0 }));
  return out;
}

export default {
  id: 'causeway',
  name: 'The Sky Road',
  doorColor: '#e0a832',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    // lapis overhead, gold at the horizon; Ra's disc low over the end of the
    // road, its wings spread across the sky
    sky: ['#1a3a8c', '#ffc46a', '#f39a40'],
    bloom: ['#2a5ad8', '#ffd060', '#d0402a'], // the colours its doorway bloom is made of
    sun: { dir: [0, 0.34, -1], glow: '#ffb050', disc: '#ffe6a0', size: 0.06 },
    stars: 0.15,
    skyFx: { rays: 0.32, clouds: 0.25, wings: 1, wingSpan: 6.2 },
    // low sun ahead and to the right: warm light on the painted faces,
    // shade still showing their colours, golden rims
    light: { dir: [0.5, 0.5, -0.72], shadow: [0.8, 0.62, 0.62], hi: [1.12, 1.02, 0.86], soft: 0.02, wrap: 0.05, hiAmt: 0.25, lift: 0.75 },
    rim: [1.0, 0.75, 0.35, 0.4],
    mist: { color: '#ffc070', amount: 0.5, top: -1, fade: 10, near: 18, far: 90 },
    grade: { sat: 1.18, contrast: 1.08, vignette: 0.38, exposure: 1.03, tint: '#3a1a40' },
    ink: '#3a1a0a',
    fog: [60, 210],
    ground: ['#e8d2a4', '#f6e6c4', '#c0a070'],
    shadowDecal: [0.72, 0.52, 0.5],
    cast: [-0.7, 1.0],
    glowGain: 0.7,
    particles: { color: '#ffe0a0', size: 1.8, drift: [0.05, 0.3, 0], opacity: 0.75 },
  },

  visits: [
    // ibises wheeling over the clouds
    { env: { sun: { glow: '#ffb060' }, skyFx: { rays: 0.9 } } },
    // the night of Nut: lapis deepened to night, the stars out, a crescent
    // moon, the winged sun sunk low and red
    {
      env: {
        sky: ['#0a1440', '#e09060', '#3a2a5a'],
        sun: { dir: [0, 0.3, -1], glow: '#ff9a70', disc: '#ffd0a0' },
        stars: 1,
        moon: { dir: [-0.35, 0.4, -1], color: '#f6e6c8', size: 0.06 },
        rim: [1.0, 0.6, 0.5, 0.42],
        light: { shadow: [0.6, 0.48, 0.66] },
        mist: { color: '#c08070' },
        grade: { tint: '#1a1040' },
        particles: { color: '#ffd8a0', size: 2.2, drift: [0.1, 0.3, 0], opacity: 0.85 },
      },
    },
    // the boats of the sun sailing through the clouds
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
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 12);
    b.toon('cloudSea', groundStrip(420, 16, '#f2a04a', 8, { y: -15 }), { ink: 0, cap: 40 });
    b.toon('deck', deckGeo(), { cap: 40, ink: 0.04 });
    b.toon('colonnadeA', colonnadeGeo(0), { cap: 40, anim: 'rise', ink: 0.045 });
    b.toon('colonnadeB', colonnadeGeo(1), { cap: 40, anim: 'rise', ink: 0.045 });
    b.toon('sphinxes', sphinxesGeo([4, 12]), { cap: 30, anim: 'pop', ink: 0.045 });
    b.toon('sphinxesLate', sphinxesGeo([13]), { cap: 10, anim: 'pop', ink: 0.045 });
    b.toon('brazier', brazierGeo(), { cap: 40, anim: 'pop', ink: 0.03, flame: true });
    b.toon('obelisk', merge(obeliskParts(9)), { cap: 30, anim: 'pop', ink: 0.045 });
    b.toon('pylon', pylonGeo(), { cap: 6, anim: 'popLate', ink: 0.05 });
    b.toon('cloud', merge(cloudParts({ r: 3, lo: E.cloudLo, hi: E.cloudHi })), { cap: 240, anim: 'lift', wobble: [0, 0.5, 0.4, 0], ink: 0.05 });
    b.toon('island', islandGeo(4, 0), { cap: 40, anim: 'liftFar', wobble: [0, 0.7, 0.35, 0], marks: [2, 2] });
    b.toon('islandB', islandGeo(12, 1), { cap: 40, anim: 'liftFar', wobble: [0, 0.6, 0.3, 0], marks: [2, 2] });
    b.toon('islandC', islandGeo(7, 2), { cap: 30, anim: 'liftFar', wobble: [0, 0.65, 0.32, 0], marks: [2, 2] });
    b.toon('plateau', plateauGeo(), { cap: 8, anim: 'liftFar', ink: 0.04, wobble: [0, 0.4, 0.2, 0] });
    b.glow('glow', { cap: 80, anim: 'pop' });
    b.shadow('shadow', { cap: 120, anim: 'pop' });
    b.toon('ibis', merge(ibisParts()), { cap: 160, anim: 'lift', fly: [0.85, 6.5, 1.2, 0.5], ink: 0.02 });
    b.toon('barque', barqueGeo(), { cap: 16, anim: 'liftFar', fly: [0, 0, 4, 0.06], wobble: [0, 0.8, 0.25, 0], ink: 0.04 });

    b.toon('sarcophagus', sarcophagusGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('offering', offeringGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('screenWall', screenWallGeo(), { cap: 10, anim: 'popEarly' });
    b.toon('lintel', lintelGeo(0.95), { cap: 24, anim: 'popEarly' });
    b.toon('gateway', lintelGeo(4.0), { cap: 10, anim: 'popEarly' });
    b.toon('obeliskW', merge(obeliskParts(7.5)).translate(0, 0, -0.65), { cap: 24, anim: 'popEarly' });
    b.toon('colossus', colossusGeo(), { cap: 24, anim: 'popEarly' });
  },

  // The door INTO this world, in its own style (built into the shared
  // doors, see world.js: it stands in the world before it).
  door(b) {
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', deco: templeLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'sarcophagus', len: 0.72 }, { name: 'offering', len: 0.8 }],
    H: [{ name: 'lintel', len: 0.6 }],
    W: [{ name: 'obeliskW', len: 1.3 }, { name: 'colossus', len: 1.6 }],
    LW: { name: 'screenWall', len: 0.5 },
    HW: { name: 'gateway', len: 0.6 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    ctx.put('cloudSea', 0, 0, 0);
    ctx.put('deck', 0, 0, 0);
    if (!ctx.continuation) {
      // colonnades, giving way every so often to an avenue of sphinxes -
      // and now and then a pylon spanning the road, obelisks before it
      const k = ctx.index % 5;
      const avenue = k === 3 || k === 4;
      const pylon = avenue && k === 3 && ctx.index % 10 === 3 && ctx.toEnd > 40;
      if (!avenue) ctx.put(rng.chance(0.5) ? 'colonnadeA' : 'colonnadeB', 0, 0, 0);
      else if (pylon) {
        ctx.put('pylon', 0, 0, 8);
        ctx.put('sphinxesLate', 0, 0, 0);
        for (const s of [-1, 1]) ctx.put('obelisk', s * 6.3, STYLO_Y, 3.5);
      } else {
        ctx.put('sphinxes', 0, 0, 0);
        for (const s of [-1, 1]) {
          ctx.put('brazier', s * 5.5, STYLO_Y, 8);
          ctx.put('glow', s * 5.5, STYLO_Y + 2.4, 8, { s: 2.2, c: [1, 0.7, 0.35] });
        }
      }
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const below = rng.chance(0.6);
        ctx.put('cloud', s * rng.float(14, 80), below ? rng.float(-13, -6) : rng.float(-2, 14), rng.float(0, 16), {
          s: rng.float(0.8, 2.0), ry: rng.float(0, 6.28), c: below ? [1, 1, 1] : [1.05, 1.02, 1],
        });
      }
      // golden pyramids on floating islands, palms round them
      if (rng.chance(0.32)) {
        const kind = rng.pick(['island', 'islandB', 'islandC']);
        ctx.put(kind, s * rng.float(20, 62), rng.float(-6, 10), rng.float(0, 16), { s: rng.float(0.7, 1.3), ry: rng.float(0, 6.28) });
      }
      // and far off, the three great pyramids on their plateau
      if (rng.chance(0.05)) ctx.put('plateau', s * rng.float(100, 160), rng.float(-14, -4), rng.float(0, 16), { s: rng.float(0.8, 1.2), ry: rng.float(-0.4, 0.4) });
      // later laps: ibises wheeling over the clouds, then the boats of the sun
      if (ctx.visit >= 1 && rng.chance(0.55)) {
        const fx = s * rng.float(10, 40);
        const fy = rng.float(5, 16);
        const fz = rng.float(0, 16);
        const heading = rng.chance(0.5) ? 0 : Math.PI;
        for (let i = 0; i < rng.int(3, 6); i++) {
          ctx.put('ibis', fx + rng.float(-3, 3), fy + rng.float(-1.2, 1.2), fz + rng.float(-3, 3), { ry: heading + rng.float(-0.3, 0.3), s: rng.float(1.0, 1.5), p0: rng.float(0, 6.28) });
        }
      }
      if (ctx.visit >= 3 && ctx.index % 4 === (s > 0 ? 1 : 3)) {
        ctx.put('barque', s * rng.float(24, 56), rng.float(-2, 12), rng.float(0, 16), { s: rng.float(1.2, 1.8), ry: rng.chance(0.5) ? 0.2 : Math.PI - 0.2 });
      }
    }
  },
};
