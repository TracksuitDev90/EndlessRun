import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, moved, rod, gateFrameParts, gateTop, leafParts } from './shapes.js';
import { crystal, stone, nugget, barrel, seaGlass, glassRidge } from './gems.js';
import { CONFIG } from '../config.js';

// XI · Blue Hour — a lonely, windswept coast held for ever at blue hour.
// An enormous restless sea; swells rolling in on dark rocks and bursting
// into spray; fields of long grass bending in broad waves, gusts running
// silver through them; and far off, on a rocky headland a little to the
// right of the road, a lighthouse, its amber lantern turning two slow
// beams over the water. The road is a weathered coastal path, and it runs
// through three stretches every time through:
//
//   the grass headland   an open path through the long grass between low
//                        dry-stone walls, driftwood thrown up on it, the sea
//                        over the brow to the right - room to breathe. Its
//                        last stretch runs through grass grown tall and dense
//                        either side, and then -
//   the causeway         - out of the grass onto an exposed stone causeway,
//                        the sea on both sides, black rock below; just as you
//                        come out onto it the lighthouse's beam swings round
//                        across the road and a great wave breaks beside you,
//                        its spray lit warm for a moment. Here the sea is part
//                        of the road: great swells rear up against its walls
//                        and pitch over the coping as you come alongside
//                        (scenery - they never come into a lane), now and then
//                        a low wash of white water runs right across it (jump
//                        it), and tidal cuts break through it (jump those).
//   the fishing landing  worn boards and old setts by a quay, half abandoned:
//                        net-drying frames, a wreck's spar, torn sails still
//                        stretched between posts, lobster pots, a stranded
//                        dinghy - and boats moored off it, lights lit.
//   ...and the grass again, out to the doorway.
//
// Nothing here is ever daylight: deep denim, slate, muted teal and charcoal,
// the sea's white foam, and only a few warm lights - the lantern, the boats,
// their reflections in the wet stone.
//
// The waves keep time with the runner (see frame, below, and
// render/coast.js): a wash builds and runs across the road as you come up
// to it, so it always gives the same warning, however fast you're running;
// a great swell beside the causeway pitches over as you come alongside.

const C = {
  denim: '#2e4a6e',
  slate: '#56687a',
  teal: '#3f6f74',
  charcoal: '#23272e',
  foam: '#eef4f6',
  amber: '#ffb347',
  amberHi: '#ffd890',
  grassLo: '#1f3335',
  grassMid: '#46625c',
  grassHi: '#8ea596',
  seed: '#a7a48c',
  rockLo: '#161a21',
  rock: '#323b46',
  rockHi: '#6e7d8a',
  teethHi: '#7a8eab',
  drift: '#bdb9ab',
  driftLo: '#7d786c',
  kelp: '#33402a',
  kelpHi: '#5a6738',
  wood: '#7c786f',
  woodLo: '#4a4741',
  woodHi: '#a39d91',
  stone: '#76808b',
  stoneLo: '#454c56',
  stoneHi: '#a0a9b2',
  net: '#26343a',
  rope: '#a0977f',
  sail: '#b3a991',
  sailRed: '#86564a',
  sailBlue: '#5a6e84',
  boatRed: '#743a33',
  boatBlue: '#33506a',
  boatGreen: '#3b584b',
  boatWhite: '#c4c8c6',
  floatO: '#bf7650',
  floatY: '#b9a050',
  tower: '#d6dade',
  band: '#6a3532',
};

// mark flags the coast's shaders read (see render/coast.js)
const FOAM = 0.13;
const WAVE = 0.23;
const WET = 0.33;
const CUT = 0.43;

const TAU = Math.PI * 2;

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

const withRole = (g, k) => {
  g.setAttribute('role', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1));
  return g;
};

// A grid surface: fn(u, v) -> [x, y, z] over u, v in 0..1, smooth-shaded;
// uv: (u, v), or uvOf(u, v) -> [s, t].
function surface(nu, nv, fn, uvOf) {
  const pos = [];
  const uv = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      pos.push(...fn(u, v));
      uv.push(...(uvOf ? uvOf(u, v) : [u, v]));
    }
  }
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A rough rock: an icosahedron pushed in and out, faceted.
function rockGeo({ r = 1, sx = 1, sy = 1, sz = 1, seed = 1, detail = 1, rough = 0.22 } = {}) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const rnd = seeded(seed);
  const k = [rnd() * 9, rnd() * 9, rnd() * 9, rnd() * 9];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / r;
    const y = p.getY(i) / r;
    const z = p.getZ(i) / r;
    const n = Math.sin(x * 3.1 + k[0]) * Math.sin(y * 2.7 + k[1]) * Math.sin(z * 3.3 + k[2]) + 0.5 * Math.sin((x + y - z) * 5.3 + k[3]);
    const f = 1 + n * rough;
    p.setXYZ(i, x * r * f * sx, y * r * f * sy, z * r * f * sz);
  }
  g.computeVertexNormals();
  return g;
}
const rock = (o, color = C.rock, at = {}) => part(rockGeo(o), null, { ...at, grad: [C.rockLo, color === C.rock ? C.rockHi : color, -(o.r || 1) * (o.sy || 1), (o.r || 1) * (o.sy || 1) * 1.2], mark: WET });

// A twisted, storm-worn log along points (a CatmullRom curve), its radius
// easing from r0 to r1, gnarled.
function logGeo(points, r0, r1, { seg = 14, rad = 8, gnarl = 0.14, seed = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(seg, false);
  const rnd = seeded(seed);
  const ph = rnd() * 6;
  const pos = [];
  const uv = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const c = curve.getPointAt(u);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * TAU;
      const g = 1 + gnarl * Math.sin(a * 3 + u * 9 + ph) + gnarl * 0.5 * Math.sin(a * 5 - u * 13);
      const cx = Math.cos(a) * r * g;
      const cy = Math.sin(a) * r * g;
      pos.push(c.x + N.x * cx + B.x * cy, c.y + N.y * cx + B.y * cy, c.z + N.z * cx + B.z * cy);
      uv.push(j / rad, u);
    }
  }
  const idx = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j;
      const b = a + rad + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const log = (points, r0, r1, color = C.drift, o = {}) => part(logGeo(points, r0, r1, o), null, { grad: [C.driftLo, color, -0.2, 0.6], mark: 0.5 });

// Mirror a finished geometry across x (left for right), keeping its faces
// facing out.
function mirrorX(g) {
  const flipX = (name) => {
    const a = g.attributes[name];
    if (!a) return;
    for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i));
  };
  flipX('position');
  flipX('normal');
  flipX('onrm');
  for (const a of Object.values(g.attributes)) {
    const s = a.itemSize;
    const arr = a.array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < s; k++) {
        const i1 = (t + 1) * s + k;
        const i2 = (t + 2) * s + k;
        const v = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = v;
      }
    }
  }
  return g;
}

// A hull, bow to +x: half-beam along its length, rounded sections, the
// inside a little in from the outside, a gunwale rail between, a transom
// across the stern.
function hullParts({ len = 3, beam = 1.2, depth = 0.6, color = C.boatBlue, inside = C.woodLo, seg = 12, sides = 7, rail = C.woodHi }) {
  const half = (u) => {
    // u: -1 stern .. 1 bow
    const bow = Math.max(0, 1 - Math.pow(Math.max(u, 0), 2.2));
    const stern = 0.78 + 0.22 * (1 - u * u);
    return (beam / 2) * (u > 0 ? bow * stern : stern);
  };
  const shell = (k, off) =>
    surface(seg, sides, (u, v) => {
      const x = -len / 2 + u * len;
      const uu = u * 2 - 1;
      const b = half(uu) * k;
      const phi = v * Math.PI;
      const sheer = depth + 0.18 * Math.pow(Math.abs(uu), 2) * (uu > 0 ? 1.4 : 0.6);
      return [x, sheer - (sheer - off) * Math.sin(phi) * 0.98, -Math.cos(phi) * b];
    });
  const out = shell(1, 0);
  const inn = shell(0.9, 0.08);
  // (the inside faces in)
  const ii = inn.index.array;
  for (let i = 0; i < ii.length; i += 3) {
    const t = ii[i + 1];
    ii[i + 1] = ii[i + 2];
    ii[i + 2] = t;
  }
  inn.computeVertexNormals();
  const parts = [part(out, color, { mark: 0.45, tint: 1 }), part(inn, inside, { mark: 0.5, outline: 0 })];
  // the rail along each gunwale
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const uu = u * 2 - 1;
      const sheer = depth + 0.18 * Math.pow(Math.abs(uu), 2) * (uu > 0 ? 1.4 : 0.6);
      pts.push([-len / 2 + u * len, sheer, s * half(uu) * 0.96]);
    }
    parts.push(part(logGeo(pts, 0.045, 0.04, { seg: 10, rad: 5, gnarl: 0 }), rail, { outline: 0.4 }));
  }
  // transom
  const tb = half(-1);
  parts.push(part(P.box(0.06, depth * 0.95, tb * 1.9), color, { x: -len / 2 + 0.02, y: depth * 0.52, mark: 0.4, tint: 1 }));
  return parts;
}

// --- gems -------------------------------------------------------------------------
// Sea glass, washed up on the shore: broken glass the tide has tumbled for
// years till every break is worn soft and its faces are frosted. Three
// shards, each its own shape so a line of them reads as fragments picked up
// one by one: a pale seafoam chip, a piece of old milk glass and a thick
// wedge of bottle green. Flat as they are, they rock rather than turn, their
// broad faces to you and the light sliding over them. The crown: a drop of
// amber with a ring of sea glass round it - the one warm thing on this shore.
const AMBER = { opaque: 0.35, mottle: 0.4, second: '#ffd27a', rough: 0.3, speckle: 0.08, glints: 0.6, scale: 5 };
// frosted faces, cloudy in the middle, with a little grit in the frost
const GLASS = { opaque: 0.6, mottle: 0.45, rough: 0.55, speckle: 0.03, glints: 0.5, scale: 4, rock: 0.7 };

// Seafoam glass: a flattened, lopsided triangle, one corner worn blunt and
// the side opposite its longest edge hollowed by a chip worn smooth; a
// narrow rim of clearer aqua round its cloudy middle, catching the light all
// along the long straight edge.
function seafoamShard() {
  const g = seaGlass({
    corners: [[-0.28, -0.12, 0.16], [0.25, -0.17, 0.42], [-0.03, 0.2, 0.2]],
    sag: [0, 0, 0.09],
    thick: (x) => 0.052 + x * 0.02,
    bevel: 0.15,
  });
  return [crystal(g.face, { rz: 0.12, soft: true }), crystal(g.rim, { color: '#78d6ee', rz: 0.12 })];
}

// Milk glass: an uneven fan of warm ivory, narrow at its foot and wide across
// the broken edge, a shallow scallop bitten out of that edge off to one side;
// two soft ridges run slantwise across its face and break off at the edge,
// a cool pearly sheen along them.
function milkShard() {
  const thick = (x, y) => 0.05 + y * 0.012;
  const g = seaGlass({
    corners: [[-0.06, -0.23, 0.3], [0.23, -0.03, 0.22], [0.07, 0.21, 0.12], [-0.22, 0.15, 0.26]],
    sag: [0.02, -0.12, 0.13, 0.03],
    thick,
    bevel: 0.15,
  });
  const z = (x, y) => thick(x, y);
  const ridges = [
    glassRidge({ from: [-0.07, -0.07], dir: [0.4, 1], inside: g.inside, z, w: 0.034, h: 0.014 }),
    glassRidge({ from: [0.03, -0.09], dir: [0.8, 1], inside: g.inside, z, w: 0.028, h: 0.012 }),
  ];
  // (the ridges cooler than the body: a pearly sheen along them)
  return [crystal(g.face, { soft: true }), crystal(g.rim), ...ridges.map((r) => crystal(r, { color: '#eef2ff', soft: true }))];
}

// Deep-green glass: a thick, sea-worn wedge, its top sloping off and one
// corner clipped away; forest green through the thick foot, the thin end
// catching a brighter lime, and a broad shallow trough worn into its face for a
// curved highlight to travel across as it rocks.
function greenShard() {
  const g = seaGlass({
    corners: [[-0.17, -0.2, 0.22], [0.18, -0.2, 0.22], [0.19, 0.03, 0.12], [0.1, 0.13, 0.16], [-0.17, 0.22, 0.22]],
    sag: [0, 0, 0, 0.02, 0],
    thick: (x, y) => 0.072 - y * 0.1,
    bevel: 0.14,
    scoop: 0.026,
    rings: 9,
  });
  // (the shade runs up it: dark where it's thick, the tint itself, lime, at the thin end)
  const grad = ['#163a22', '#ffffff', -0.17, 0.15];
  return [crystal(g.face, { grad, rz: -0.08, soft: true }), crystal(g.rim, { grad: ['#163a22', '#f4ffe2', -0.17, 0.15], rz: -0.08 })];
}

const GEM = {
  name: 'sea glass',
  color: '#a8e6d2',
  stones: [
    {
      name: 'seafoam glass',
      weight: 1.4,
      tints: ['#b8ecbe', '#b0e8b6', '#c0f0c6'],
      parts: seafoamShard,
      texture: { ...GLASS, mottle: 0.6, second: '#eef8f1' },
    },
    {
      name: 'milk glass',
      weight: 1.0,
      tints: ['#ead5ab', '#e5cea2'],
      parts: milkShard,
      texture: { ...GLASS, opaque: 0.85, mottle: 0.25, second: '#f4ecdc', rough: 0.45, glints: 0.35 },
    },
    {
      name: 'deep-green glass',
      weight: 1.1,
      tints: ['#a4dc50', '#9ad84a'],
      parts: greenShard,
      texture: { ...GLASS, opaque: 0.35, mottle: 0.2, second: '#d0f27e', rough: 0.4, speckle: 0.02, glints: 0.65 },
    },
  ],
  crown: {
    name: 'amber drop in a ring of sea glass',
    tints: ['#f6a83c', '#ffb84a'],
    parts: () => {
      const out = [crystal(barrel({ r: 0.2, h: 0.36, taper: 0.45, seed: 4 }), { rz: 0.2 })];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        out.push(stone(nugget({ r: [0.075, 0.06, 0.07], faces: 12, spread: 0.08, chips: 1, seed: 40 + i }), i % 3 === 2 ? '#3f66b4' : '#8fd6c8', { x: Math.cos(a) * 0.3, y: Math.sin(a) * 0.3 }));
      }
      return out;
    },
    texture: { ...AMBER, glints: 1.4 },
  },
  motion: [1.0, 1.6, 0.08, 0.14],
  look: [0.8, 1.2, 0.3, 0.35],
  glow: 0.65,
  pool: 0.35,
  // (the halo hung just behind the shards, clear of their faces as they rock)
  haloBack: 0.32,
};

// --- the stretches ---------------------------------------------------------------
// Where the causeway starts, the landing, and the grass again, in this
// stretch of the course (snapped to chunks: each stretch is its own ground).
function stretches(seg) {
  if (seg.coast) return seg.coast;
  const L = seg.end - seg.start;
  const at = (f) => seg.start + CONFIG.chunkLength * Math.round((f * L) / CONFIG.chunkLength);
  return (seg.coast = { mouth: at(0.3), landing: at(0.65), grass: at(0.86) });
}
function zoneAt(S, d) {
  if (d < S.mouth) return 'headland';
  if (d < S.landing) return 'causeway';
  if (d < S.grass) return 'landing';
  return 'grass';
}
// the dense grass you come out of onto the causeway
const THICKET = 72;
// the stretch either side of the causeway's mouth kept clear of obstacles
const HOLD = [-40, 44];
// how far out along the causeway the great wave breaks (in sight, as you
// come out onto it)
const BIG_AHEAD = 22;

const SEA_Y = -2.4;
// how far past a great swell beside the causeway you are when it pitches
// over (it breaks a little ahead of you, in full view)
const SWELL_AT = -14;
// how long before you reach a wash it starts to build (s)
const WASH_LEAD = 3.6;
// where the land meets the sea (m out from the middle of the road), for
// the sea's foam: the headland's shore, the causeway's walls, the quay
const SHORE = { headland: 15.5, grass: 15.5, causeway: 5.6, landing: 6.9 };

// The land's height across the headland: the path flat, the field rising
// gently inland (left) in long swells, and on the seaward side (right) a
// brow, then down over rock to the sea.
function landY(x) {
  if (x > 0) {
    if (x < 8) return 0.03 * Math.max(0, x - 5);
    const t = Math.min(1, (x - 8) / 8);
    return 0.09 - 3.3 * t * t * (3 - 2 * t);
  }
  const ax = -x;
  if (ax < 6) return 0;
  return 0.06 * (ax - 6) * Math.min(1, (ax - 6) / 20) + 1.1 * Math.sin((ax - 6) * 0.06) * Math.min(1, (ax - 6) / 25);
}
const HEADLAND_XS = (() => {
  const xs = [];
  for (let x = -150; x < -40; x += 10) xs.push(x);
  for (let x = -40; x < -12; x += 2.5) xs.push(x);
  for (let x = -12; x < 12; x += 1) xs.push(x);
  for (let x = 12; x <= 22; x += 0.8) xs.push(x);
  return xs;
})();
// (the landing's: the left side only, past the boards)
const LANDING_XS = (() => {
  const xs = [];
  for (let x = -150; x < -40; x += 10) xs.push(x);
  for (let x = -40; x < -12; x += 2.5) xs.push(x);
  for (let x = -12; x <= -5.6; x += 0.8) xs.push(x);
  return xs;
})();
const landingY = (x) => (x > -6.4 ? 0.02 : Math.min(0.9, (-6.4 - x) * 0.25) + landY(x) * 0.6);

function landStrip(xs, yOf) {
  const L = CONFIG.chunkLength;
  const g = surface(
    xs.length - 1,
    4,
    (u, v) => {
      const x = xs[Math.round(u * (xs.length - 1))];
      return [x, yOf(x), -v * L];
    },
    (u, v) => [xs[Math.round(u * (xs.length - 1))], v * L]
  );
  return part(g, '#ffffff', { outline: 0 });
}

// The sea: one wide strip, fine near the road (where its swell shows) and
// coarser out to the horizon.
function seaStrip() {
  const xs = [0];
  let x = 0;
  let step = 0.9;
  while (x < 240) {
    x += step;
    xs.push(x);
    step *= x < 30 ? 1.03 : 1.09;
  }
  const all = [...xs.slice(1).map((v) => -v).reverse(), ...xs];
  const L = CONFIG.chunkLength;
  const g = surface(
    all.length - 1,
    8,
    (u, v) => [all[Math.round(u * (all.length - 1))], 0, -v * L],
    (u, v) => [all[Math.round(u * (all.length - 1))], v * L]
  );
  return part(g, '#ffffff', { outline: 0 });
}

// --- the grass ---------------------------------------------------------------------
// A clump of long grass: thin tapering blades, each bending along its
// height, sage and slate-green, bleaching pale toward the tip; some gone to
// seed, a nodding head on top (they bend with the wind: see WIND).
function grassParts({ n = 14, h = [0.9, 1.5], spread = 0.45, w = 0.05, seed = 1, seeds = 0.25, lo = C.grassLo, hi = C.grassHi } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const bh = h[0] + rnd() * (h[1] - h[0]);
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * spread;
    const g = P.cyl(0, w * (0.7 + rnd() * 0.6), bh, 3, 2, true);
    g.translate(0, bh / 2, 0);
    const r3 = rnd();
    const tip = r3 < 0.25 ? C.seed : r3 < 0.5 ? C.grassMid : hi;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const rz = (rnd() - 0.5) * 0.5;
    parts.push(part(g, null, { x, z, sz: 0.35, ry: (rnd() - 0.5) * 1.4, rx: (rnd() - 0.5) * 0.35, rz, grad: [lo, tip, 0, h[1] * 0.95], outline: 0 }));
    if (rnd() < seeds) parts.push(part(P.ico(0.035, 0), C.seed, { x: x - Math.sin(rz) * bh, y: bh * Math.cos(rz) + 0.03, z, sy: 2.6, rz: rz * 1.3, outline: 0 }));
  }
  return parts;
}

// --- the shore ---------------------------------------------------------------------
// The causeway's flank: a battered wall of big dressed blocks dropping to the
// sea, a coping of rough stones along the deck's edge (broken here and
// there), and black rock heaped against its foot where the swell breaks.
function causewaySideGeo(seed) {
  const rnd = seeded(seed);
  const L = CONFIG.chunkLength;
  const parts = [];
  for (const s of [-1, 1]) {
    for (let row = 0; row < 4; row++) {
      const y = -0.4 - row * 0.78;
      const xo = 4.95 + row * 0.18;
      let z = -rnd() * 1.2;
      while (z > -L) {
        const bl = 1.1 + rnd() * 1.1;
        const len = Math.min(bl, z + L);
        parts.push(part(P.box(0.7, 0.74, len - 0.06), null, { x: s * (xo + 0.25), y, z: z - len / 2, grad: [C.rockLo, C.stoneLo, y - 0.4, y + 0.6], mark: WET, rz: s * 0.05 }));
        z -= len;
      }
    }
    // the coping, broken in places
    let z = -rnd() * 0.6;
    while (z > -L + 0.5) {
      const bl = 0.7 + rnd() * 0.8;
      if (rnd() > 0.16) parts.push(part(rockGeo({ r: 0.32, sx: 1.3, sy: 0.6, sz: bl * 1.4, seed: Math.floor(rnd() * 999), detail: 0, rough: 0.15 }), null, { x: s * (4.95 + rnd() * 0.12), y: 0.12, z: z - bl / 2, grad: [C.stoneLo, C.stone, -0.1, 0.35], mark: WET }));
      z -= bl + 0.05;
    }
  }
  return merge(parts);
}

// Black rocks heaped below the causeway (and the headland), where the swell
// strikes: a long pile along one side.
function rockPileGeo(seed, len = CONFIG.chunkLength) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const r = 0.8 + rnd() * 1.1;
    parts.push(rock({ r, sx: 1.3, sy: 0.7 + rnd() * 0.5, sz: 1.2, seed: Math.floor(rnd() * 999) }, C.rock, { x: rnd() * 2.2, y: SEA_Y + 0.4 + rnd() * 0.9, z: -(i / 9) * len - rnd() }));
  }
  return merge(parts);
}

// The quay along the landing's seaward side: a wall of blocks to the sea,
// a ladder down it, bollards along its edge.
function quayGeo(seed) {
  const rnd = seeded(seed);
  const L = CONFIG.chunkLength;
  const parts = [];
  for (let row = 0; row < 4; row++) {
    const y = -0.38 - row * 0.74;
    let z = -rnd();
    while (z > -L) {
      const len = Math.min(0.9 + rnd() * 0.9, z + L);
      parts.push(part(P.box(0.6, 0.7, len - 0.05), null, { x: 6.55 + row * 0.06, y, z: z - len / 2, grad: [C.rockLo, C.stoneLo, y - 0.4, y + 0.5], mark: WET }));
      z -= len;
    }
  }
  return merge(parts);
}

function bollardGeo() {
  return merge([
    part(P.cyl(0.17, 0.2, 0.55, 10), C.charcoal, { y: 0.27, mark: 0.4 }),
    part(P.sphere(0.2, 10, 6), C.charcoal, { y: 0.55, sy: 0.6 }),
    part(P.torus(0.21, 0.05, 5, 12), C.rope, { y: 0.32, rx: Math.PI / 2 }),
  ]);
}

// The lip of a wave: a sheet of white water curling landward (-x) off its
// crest and over, thinning and tapering to nothing toward its ends, its
// leading edge ragged; `depth` long along z (centred). (Two-sided: the
// waves draw both faces.)
function lipShape(depth, seed = 1) {
  const rnd = seeded(seed);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  const bez = (t, a, b, c, d) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
  return surface(10, 16, (u, v) => {
    const z = (v - 0.5) * depth;
    const e = Math.min(v, 1 - v) * 2;
    const taper = Math.pow(e, 0.55) * (0.82 + 0.18 * Math.sin(v * 11 + ph[0]));
    // how far over it's thrown here: further in the middle
    const reach = 0.55 + 0.45 * Math.pow(e, 0.4) + 0.12 * Math.sin(v * 7 + ph[1]);
    const t = u * reach;
    let x = bez(t, 0.3, 0.55, -0.9, -1.75);
    let y = bez(t, 0, 1.45, 2.05, 1.0);
    // a ragged leading edge
    const rag = u > 0.75 ? (u - 0.75) * 4 * 0.25 * Math.sin(v * 37 + ph[2]) : 0;
    x += rag * 0.6;
    y -= Math.abs(rag) * 0.5;
    return [x * taper, y * taper, z];
  });
}

// --- a breaker: a swell striking the rocks ------------------------------------------
// (built for the sea on the right; see BREAKER in render/coast.js for how it
// moves: role 0 the swell, 1 the spray, 2 the foam thrown over the rocks,
// 4 the lip)
function breakerGeo({ len = 7, seed = 1, spray = 34, up = [6, 11], wide = 1 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  // the swell: a long ridge, its land face steep
  const sw = surface(14, 14, (u, v) => {
    const x = (-2.4 + u * 4.8) * wide;
    const t = x < 0 ? 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, -x / (1.7 * wide))) : 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, x / (2.4 * wide)));
    const z = len - v * len * 2;
    const e = Math.min(1, Math.min(v, 1 - v) * 3.5);
    const taper = e * e * (3 - 2 * e) * (0.85 + 0.15 * Math.sin(v * 9 + seed));
    return [x, t * taper, z];
  });
  parts.push(withRole(part(sw, null, { grad: ['#000000', '#ffffff', 0, 1], mark: WAVE, outline: 0 }), 0));
  // its lip (role 4): a crescent of white water along the crest
  for (const [dz, k] of [[0, 1], [len * 0.35, 0.75], [-len * 0.4, 0.8]]) {
    const lip = lipShape(len * 0.75, seed * 3 + Math.round(k * 10));
    lip.scale(k, k, 1).translate(0.2 * (1 - k), 0, dz);
    parts.push(withRole(part(lip, C.foam, { mark: FOAM, outline: 0 }), 4));
  }
  // spray: thrown up out of the impact, out to sea
  for (let i = 0; i < spray; i++) {
    const g = part(P.ico(0.05 + rnd() * rnd() * 0.12, 0), C.foam, { mark: FOAM, outline: 0 });
    const n = g.attributes.position.count;
    const A = new Float32Array(n * 4);
    const B = new Float32Array(n * 4);
    const launch = [0.3 + rnd() * 1.2, -0.9 + rnd() * 0.8, (rnd() - 0.5) * len * 0.8, 0.43 + rnd() * 0.07];
    const vel = [0.2 + rnd() * 3.4, up[0] + rnd() * (up[1] - up[0]), (rnd() - 0.5) * 2.2, 0];
    for (let k = 0; k < n; k++) {
      A.set(launch, k * 4);
      B.set(vel, k * 4);
    }
    g.setAttribute('spA', new THREE.BufferAttribute(A, 4));
    g.setAttribute('spB', new THREE.BufferAttribute(B, 4));
    parts.push(withRole(g, 1));
  }
  // the foam over the rocks
  for (let i = 0; i < 9; i++) parts.push(withRole(part(P.sphere(0.5 + rnd() * 0.5, 8, 5), C.foam, { x: 0.4 + rnd() * 1.6, y: -0.6 + rnd() * 0.4, z: (rnd() - 0.5) * len * 0.85, sy: 0.35, mark: FOAM, outline: 0 }), 2));
  // (no rivulets: upright white streaks beside the road read as posts - as
  // something in the way)
  return merge(parts);
}

// --- the obstacles -------------------------------------------------------------------
// Every one is built at the lane's middle, its front at z 0, running back to
// -len; nothing an obstacle you slide under has hangs below the duck line.

// A great swell rearing up beside the causeway (scenery: see SURGE). It
// rolls in from well out, rears against the causeway's wall as you come
// alongside, its lip pitching over the coping and its spray thrown up into
// the wind - but the water never comes into a lane: the road stays the road.
// Its roles: 0 the swell, 1 the lip, 4 spray. (Its curtain and flood, roles
// 2 and 3, are built only for a wave that pours into a lane.)
const SURGE_LEN = 2.6;
function surgeGeo({ lane = false } = {}) {
  const rnd = seeded(77);
  const L = SURGE_LEN;
  const parts = [];
  const sw = surface(16, 14, (u, v) => {
    const x = -3 + u * 6;
    const t = x < 0 ? Math.pow(0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, -x / 1.9)), 0.8) : 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, x / 3));
    const z = 4.5 - v * 11.5;
    const taper = Math.pow(Math.sin(v * Math.PI), 0.45);
    return [x, t * taper, z];
  });
  parts.push(withRole(part(sw, null, { grad: ['#000000', '#ffffff', 0, 1], mark: WAVE, outline: 0 }), 0));
  // the lip: a crescent of white water along the crest, curling landward
  const lip = lipShape(8.5, 5);
  lip.translate(0, 0, -1.3);
  parts.push(withRole(part(lip, C.foam, { mark: FOAM, outline: 0 }), 1));
  // the curtain: a ragged sheet of white water, bulging and torn along its
  // edges, a second thinner one behind it
  if (lane) for (const [off, k] of [[0, 1], [0.35, 0.7]]) {
    const sheet = surface(10, 8, (u, v) => {
      const z = 0.5 - u * (L + 1.0);
      const rag = 0.18 * Math.sin(u * 17 + v * 5 + off * 9) + 0.12 * Math.sin(u * 31 - v * 11);
      return [off + 0.25 * Math.sin(v * Math.PI) * k + rag * (1 - v) * 0.8, v, z + rag * 0.4 * (u < 0.1 || u > 0.9 ? 1 : 0)];
    });
    parts.push(withRole(part(sheet, C.foam, { mark: FOAM, outline: 0 }), 2));
  }
  if (lane) for (let i = 0; i < 10; i++) parts.push(withRole(part(P.sphere(0.22 + rnd() * 0.18, 7, 5), C.foam, { x: 0.15 + rnd() * 0.3, y: rnd(), z: 0.4 - rnd() * (L + 0.8), sy: 0.14, sx: 0.7, mark: FOAM, outline: 0 }), 2));
  // the flood: foam heaped in the lane, over a sheet of water
  if (lane) parts.push(withRole(part(P.box(2.8, 0.12, L + 1.2), '#8a8a8a', { x: 0.25, y: 0.06, z: -L / 2, mark: WAVE, outline: 0 }), 3));
  if (lane) for (let i = 0; i < 24; i++) {
    const r = 0.25 + rnd() * 0.32;
    parts.push(withRole(part(P.sphere(r, 9, 6), C.foam, { x: -0.95 + rnd() * 2.5, y: 0.12 + r * 0.4, z: 0.3 - rnd() * (L + 0.6), sy: 0.75, mark: FOAM, outline: 0 }), 3));
  }
  // spray: feathering off the crest (the warning), and up out of the lane
  const drop = (launch, vel, r) => {
    const g = part(P.ico(r, 0), C.foam, { mark: FOAM, outline: 0 });
    const n = g.attributes.position.count;
    const A = new Float32Array(n * 4);
    const B = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      A.set(launch, k * 4);
      B.set(vel, k * 4);
    }
    g.setAttribute('spA', new THREE.BufferAttribute(A, 4));
    g.setAttribute('spB', new THREE.BufferAttribute(B, 4));
    parts.push(withRole(g, 4));
  };
  for (let i = 0; i < 40; i++) drop([2.4 + rnd() * 0.8, 3.0 + rnd() * 0.8, 1.5 - rnd() * 6, 0.32 + rnd() * 0.22], [0.5 - rnd() * 1.8, 2 + rnd() * 3, (rnd() - 0.5) * 1.5, 0], 0.05 + rnd() * rnd() * 0.12);
  // (and, as it strikes the wall, a burst thrown high up off it)
  if (!lane) for (let i = 0; i < 36; i++) drop([1.6 + rnd() * 1.2, 1.5 + rnd() * 1.5, 1.5 - rnd() * 7, 0.6 + rnd() * 0.12], [0.3 + rnd() * 1.6, 5 + rnd() * 5, (rnd() - 0.5) * 2, 0], 0.06 + rnd() * rnd() * 0.14);
  if (lane) for (let i = 0; i < 40; i++) drop([-0.6 + rnd() * 1.8, 0.3, 0.3 - rnd() * (L + 0.6), 0.64 + rnd() * 0.1], [-0.7 + rnd() * 2.6, 4 + rnd() * 4.5, (rnd() - 0.5) * 1.6, 0], 0.06 + rnd() * rnd() * 0.14);
  return merge(parts);
}

// A wash (LW, the causeway; see WASH): role 0 the ridge of foam across the
// road, 1 the swell that breaks beside it, 2 spray.
const WASH_LEN = 1.1;
function washGeo() {
  const rnd = seeded(31);
  const parts = [];
  const ridge = surface(40, 8, (u, v) => {
    const x = -7.2 + u * 13.6;
    const t = Math.pow(Math.sin(v * Math.PI), 0.75);
    const lump = 0.86 + 0.14 * Math.sin(x * 2.3 + 1.1) * Math.sin(x * 0.9);
    return [x, 0.95 * t * lump, -v * WASH_LEN];
  });
  parts.push(withRole(part(ridge, C.foam, { mark: FOAM, outline: 0 }), 0));
  // a skin of foam spreading in front of it
  parts.push(withRole(part(surface(40, 2, (u, v) => [-7.2 + u * 13.6, 0.03, 0.35 - v * 0.4]), C.foam, { mark: FOAM, outline: 0 }), 0));
  const sw = surface(10, 8, (u, v) => {
    const x = -1.6 + u * 3.2;
    const t = Math.pow(Math.max(0, 1 - Math.abs(x) / 1.6), 1.2);
    const z = 2.5 - v * 6;
    return [x + 7.6, t * Math.pow(Math.sin(v * Math.PI), 0.6), z];
  });
  parts.push(withRole(part(sw, null, { grad: ['#000000', '#ffffff', 0, 1], mark: WAVE, outline: 0 }), 1));
  for (let i = 0; i < 18; i++) {
    const g = part(P.ico(0.09 + rnd() * 0.1, 0), C.foam, { mark: FOAM, outline: 0 });
    const n = g.attributes.position.count;
    const A = new Float32Array(n * 4);
    const B = new Float32Array(n * 4);
    const launch = [5.2 + rnd() * 1.5, 0.2, 1.5 - rnd() * 4, 0.17 + rnd() * 0.12];
    const vel = [-1 + rnd() * 2.5, 3 + rnd() * 3, (rnd() - 0.5) * 1.5, 0];
    for (let k = 0; k < n; k++) {
      A.set(launch, k * 4);
      B.set(vel, k * 4);
    }
    g.setAttribute('spA', new THREE.BufferAttribute(A, 4));
    g.setAttribute('spB', new THREE.BufferAttribute(B, 4));
    parts.push(withRole(g, 2));
  }
  return merge(parts);
}

// A tidal cut (L, wade): the opening (its inside drawn by the shader: the
// far wall, the sea rushing through below), its broken lips of wet stone.
const CUT_LEN = 2.4;
function cutGeo(half, seed) {
  const rnd = seeded(seed);
  const parts = [];
  const g = surface(4, 4, (u, v) => [-half + u * half * 2, 0.012, -v * CUT_LEN], (u, v) => [-half + u * half * 2, v * CUT_LEN]);
  parts.push(part(g, '#ffffff', { mark: CUT, outline: 0 }));
  for (const [z0, sgn] of [[0.1, 1], [-CUT_LEN - 0.1, -1]]) {
    let x = -half - 0.1;
    while (x < half + 0.1) {
      const w = 0.3 + rnd() * 0.4;
      parts.push(part(rockGeo({ r: 0.2, sx: w * 2.2, sy: 0.35 + rnd() * 0.3, sz: 1.1, seed: Math.floor(rnd() * 999), detail: 0, rough: 0.2 }), null, { x: x + w / 2, y: 0.02, z: z0 + sgn * 0.05, grad: [C.stoneLo, C.stoneHi, -0.1, 0.12], mark: WET }));
      x += w + 0.05;
    }
  }
  return merge(parts);
}
// spray bursting up through it, often and high (SPLASH, on its own clock):
// seen from far off, the white plumes say where the road's cut
function cutSprayGeo(half, seed) {
  const rnd = seeded(seed);
  const parts = [];
  const bursts = half > 2 ? 5 : 2;
  for (let b = 0; b < bursts; b++) {
    const launch = [(b + 0.5) / bursts * half * 1.8 - half * 0.9 + (rnd() - 0.5) * 0.4, -0.6, -CUT_LEN / 2 + (rnd() - 0.5) * 0.8, rnd()];
    const per = 1.4 + rnd() * 0.9;
    for (let i = 0; i < 9; i++) {
      const g = part(P.ico(0.09 + rnd() * 0.1, 0), C.foam, { mark: FOAM, outline: 0 });
      const n = g.attributes.position.count;
      const A = new Float32Array(n * 4);
      const B = new Float32Array(n * 4);
      const a = rnd() * TAU;
      const vel = [Math.cos(a) * 0.8, 4.2 + rnd() * 2.4, Math.sin(a) * 0.35, per];
      for (let k = 0; k < n; k++) {
        A.set(launch, k * 4);
        B.set(vel, k * 4);
      }
      g.setAttribute('spA', new THREE.BufferAttribute(A, 4));
      g.setAttribute('spB', new THREE.BufferAttribute(B, 4));
      parts.push(g);
    }
  }
  return merge(parts);
}

// A collapsed run of dry-stone wall (L): two or three courses of rounded
// stones, gapped and fallen, stones scattered either side.
function wallParts(half, seed, { courses = 3, h = 0.66 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (let c = 0; c < courses; c++) {
    let x = -half;
    const y = 0.16 + c * (h - 0.16) / courses;
    while (x < half) {
      const w = 0.32 + rnd() * 0.3;
      const fallen = c > 0 && rnd() < 0.18 + c * 0.1;
      if (!fallen) parts.push(part(rockGeo({ r: 0.2, sx: w * 2.3, sy: 0.85 + rnd() * 0.4, sz: 1.7, seed: Math.floor(rnd() * 999), detail: 0, rough: 0.18 }), null, { x: x + w / 2, y, z: -0.45 + (rnd() - 0.5) * 0.12, grad: [C.stoneLo, C.stoneHi, -0.1, h + 0.1], mark: 0.6, ry: (rnd() - 0.5) * 0.3 }));
      x += w + 0.03;
    }
  }
  // fallen stones on the ground before and behind it
  for (let i = 0; i < Math.round(half * 3); i++) {
    const z = rnd() < 0.5 ? 0.2 + rnd() * 0.4 : -1.1 - rnd() * 0.4;
    parts.push(part(rockGeo({ r: 0.16 + rnd() * 0.08, sx: 1.4, sy: 0.75, sz: 1.2, seed: Math.floor(rnd() * 999), detail: 0, rough: 0.2 }), null, { x: (rnd() - 0.5) * half * 2, y: 0.08, z, grad: [C.stoneLo, C.stone, -0.1, 0.2], mark: 0.6 }));
  }
  return parts;
}
// (the grass growing up between its stones: a batch of its own, in the wind)
function wallGrassParts(half, seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < Math.round(half * 2.2); i++) {
    parts.push(...moved(grassParts({ n: 6, h: [0.2, 0.4], spread: 0.16, w: 0.035, seed: 50 + i }), { x: (rnd() - 0.5) * half * 2, y: 0.15 + rnd() * 0.3, z: -0.45 + (rnd() - 0.5) * 0.5 }));
  }
  for (let i = 0; i < Math.round(half * 1.5); i++) {
    parts.push(...moved(grassParts({ n: 7, h: [0.25, 0.55], spread: 0.25, w: 0.04, seed: 90 + i }), { x: (rnd() - 0.5) * half * 2.2, z: rnd() < 0.5 ? 0.3 : -1.2 }));
  }
  return parts;
}

// Storm-thrown driftwood (L): a bleached, twisted trunk across the lane, a
// branch or two crooked up off it, its root end splayed.
function driftParts(half, seed) {
  const rnd = seeded(seed);
  const parts = [];
  const r = Math.min(0.36, 0.27 + 0.03 * half);
  parts.push(log([[-half, r * 1.1, -0.42 + rnd() * 0.1], [-half * 0.55, r * 0.95, -0.22], [-half * 0.1, r * 1.05, -0.62], [half * 0.4, r * 0.92, -0.3], [half, r * 0.85, -0.55]], r * 1.2, r * 0.72, C.drift, { seed, seg: 22, rad: 9, gnarl: 0.22 }));
  // knots and burrs
  for (let i = 0; i < Math.round(half * 2.5); i++) parts.push(part(P.sphere(r * (0.3 + rnd() * 0.25), 7, 5), null, { x: -half * 0.85 + rnd() * half * 1.7, y: r * (0.9 + rnd() * 0.5), z: -0.45 + (rnd() - 0.5) * 0.3, sx: 1.4, grad: [C.driftLo, C.drift, 0, r * 2], mark: 0.5 }));
  // branches
  for (let i = 0; i < Math.max(2, Math.round(half * 1.2)); i++) {
    const x = -half * 0.6 + rnd() * half * 1.5;
    const len = 0.18 + rnd() * 0.14;
    const y0 = r * 1.5;
    parts.push(log([[x, y0, -0.45], [x + 0.18, y0 + len * 0.55, -0.4 + (rnd() - 0.5) * 0.4], [x + 0.4, y0 + len, -0.4 + (rnd() - 0.5) * 0.5]], 0.07, 0.03, C.drift, { seed: seed + i, seg: 5, rad: 5 }));
  }
  // the root end
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + rnd();
    parts.push(log([[-half, r, -0.45], [-half - 0.25, r + Math.sin(a) * 0.35, -0.45 + Math.cos(a) * 0.35], [-half - 0.35, r + Math.sin(a) * 0.55, -0.45 + Math.cos(a) * 0.6]], 0.08, 0.025, C.driftLo, { seed: seed + 10 + i, seg: 5, rad: 4 }));
  }
  return parts;
}
// (kelp hung over it, in the wind)
function kelpParts(half, seed, y0) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < Math.round(half * 3); i++) {
    const len = 0.25 + rnd() * 0.3;
    const x = (rnd() - 0.5) * half * 1.8;
    parts.push(part(P.box(0.07 + rnd() * 0.05, len, 0.015, 1, 3, 1), null, { x, y: y0 - len / 2, z: -0.45 + (rnd() - 0.5) * 0.5, rz: (rnd() - 0.5) * 0.4, grad: [C.kelp, C.kelpHi, y0 - len, y0], outline: 0 }));
  }
  return parts;
}

// A net-drying frame (H): weathered posts, a low crossbar at the slide's
// height and a top bar, the net draped between them; its loose edges hang
// from the top bar (a batch of its own, in the wind), well above the gap.
function netFrameParts(half, { posts = true } = {}) {
  const parts = [];
  const px = half + 0.12;
  if (posts) {
    for (const s of [-1, 1]) {
      parts.push(part(P.box(0.18, 2.7, 0.18), null, { x: s * px, y: 1.35, z: -0.2, grad: [C.woodLo, C.wood, 0, 2.7], mark: 0.5 }));
      parts.push(part(P.box(0.06, 0.5, 0.5), C.woodLo, { x: s * px, y: 2.1, z: -0.2, rx: 0.6, outline: 0.4 }));
    }
  }
  rod(parts, [-px - 0.15, 1.32, -0.2], [px + 0.15, 1.32, -0.2], 0.08, C.wood);
  rod(parts, [-px - 0.15, 2.55, -0.2], [px + 0.15, 2.55, -0.2], 0.08, C.wood);
  // the net between them, sagging, its mesh lines
  const net = surface(12, 6, (u, v) => {
    const x = -px + u * px * 2;
    const y = 1.42 + v * 1.08;
    return [x, y, -0.2 - Math.sin(u * Math.PI) * 0.1 * (1 - v)];
  });
  parts.push(part(net, C.net, { mark: 0.5, outline: 0 }));
  const lines = Math.round(px * 4);
  for (let i = 0; i <= lines; i++) {
    const x = -px + (i / lines) * px * 2;
    parts.push(part(P.box(0.02, 1.12, 0.03), '#3c4c50', { x, y: 1.96, z: -0.14, rz: 0.12 * Math.sin(i), outline: 0 }));
  }
  for (let j = 0; j < 5; j++) parts.push(part(P.box(px * 2, 0.02, 0.03), '#3c4c50', { y: 1.48 + j * 0.22, z: -0.14, outline: 0 }));
  // floats on the top bar
  for (let i = 0; i < 4; i++) parts.push(part(P.sphere(0.09, 8, 6), i % 2 ? C.floatO : C.floatY, { x: -px * 0.7 + i * px * 0.48, y: 2.62, z: -0.12 }));
  return parts;
}
function netEdgeParts(half, seed) {
  const rnd = seeded(seed);
  const parts = [];
  const px = half + 0.12;
  for (let i = 0; i < Math.round(px * 5); i++) {
    const len = 0.25 + rnd() * 0.45;
    parts.push(part(P.box(0.16 + rnd() * 0.1, len, 0.02, 1, 3, 1), C.net, { x: -px + rnd() * px * 2, y: 2.5 - len / 2, z: -0.05, outline: 0 }));
  }
  return parts;
}

// A wreck beside the road (H, outer lanes): a fishing boat lying broken on
// the rocks off the edge, a snapped spar reaching from it out over the lane
// at the slide's height, rope and faded cloth hung from it (in the wind).
function sparParts() {
  const parts = [];
  const hull = hullParts({ len: 5.4, beam: 2.1, depth: 1.0, color: C.boatRed, inside: C.woodLo, sides: 8, seg: 12 });
  parts.push(...moved(hull, { x: 4.6, y: -0.5, z: -0.9, rz: 0.65, ry: 1.25 }));
  // its ribs, bared where the planking's gone
  for (let i = 0; i < 4; i++) parts.push(...moved([part(P.torus(0.95, 0.06, 4, 10, Math.PI), C.driftLo, { outline: 0.5 })], { x: 3.9 + i * 0.5, y: 0.1, z: -0.4 - i * 0.55, ry: 1.25, rz: 0.4 }));
  parts.push(rock({ r: 1.1, sx: 1.4, sy: 0.8, sz: 1.3, seed: 12 }, C.rock, { x: 3.4, y: -0.6, z: -1.4 }));
  parts.push(rock({ r: 0.9, sx: 1.2, sy: 0.9, sz: 1, seed: 19 }, C.rock, { x: 5.5, y: -1.2, z: 0.6 }));
  // the spar
  parts.push(log([[3.6, 2.4, -0.5], [1.6, 1.7, -0.45], [-1.15, 1.48, -0.42]], 0.13, 0.11, C.woodHi, { seed: 3, seg: 10, rad: 7, gnarl: 0.05 }));
  // the snapped end
  parts.push(part(P.cone(0.12, 0.3, 6), C.woodHi, { x: -1.27, y: 1.47, z: -0.42, rz: Math.PI / 2 + 0.1 }));
  // lashings
  for (const x of [0.8, -0.4]) parts.push(part(P.torus(0.14, 0.035, 4, 10), C.rope, { x, y: 1.6 - (0.8 - x) * 0.1, z: -0.44, ry: Math.PI / 2 }));
  return parts;
}
function sparClothParts() {
  const parts = [];
  // faded cloth hung over the spar, torn, and a rope's end
  parts.push(part(P.box(0.7, 0.32, 0.02, 4, 3, 1), C.sailBlue, { x: 0.3, y: 1.48, z: -0.36, rz: 0.08, mark: 0.4, outline: 0 }));
  parts.push(part(P.box(0.4, 0.22, 0.02, 3, 2, 1), C.sail, { x: -0.6, y: 1.4, z: -0.48, mark: 0.4, outline: 0 }));
  parts.push(part(P.box(0.04, 0.24, 0.04, 1, 3, 1), C.rope, { x: -0.95, y: 1.33, z: -0.42, outline: 0 }));
  return parts;
}

// Driftwood arch (H): a storm-worn tree wedged between rocks across the lane,
// the gap beneath it clear, its roots reared up beside the road.
function driftArchParts(half, seed, { roots = 1 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  const px = half + 0.48;
  for (const s of [-1, 1]) {
    parts.push(rock({ r: 0.45, sx: 0.85, sy: 1.75, sz: 1.0, seed: seed + (s > 0 ? 3 : 7) }, C.rock, { x: s * px, y: 0.68, z: -0.35 }));
    parts.push(rock({ r: 0.35, sx: 1.1, sy: 0.8, sz: 1.1, seed: seed + (s > 0 ? 13 : 17) }, C.rock, { x: s * (px + 0.35), y: 0.2, z: -0.1 }));
  }
  const y = 1.55;
  parts.push(log([[-px - 0.5, y + 0.25, -0.4], [-px * 0.3, y + 0.05, -0.3], [px * 0.4, y, -0.5], [px + 0.6, y + 0.15, -0.35]], 0.3, 0.22, C.drift, { seed, seg: 16 }));
  // a branch cocked up off it
  parts.push(log([[0.2, y + 0.2, -0.4], [0.45, y + 0.8, -0.5], [0.9, y + 1.2, -0.55]], 0.09, 0.04, C.drift, { seed: seed + 2, seg: 6, rad: 6 }));
  // the root plate, reared up at one end
  const rx = roots * (px + 0.65);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 1.2 - 0.1 + rnd() * 0.2;
    const R = 1.0 + rnd() * 0.8;
    parts.push(log([[rx, y + 0.2, -0.38], [rx + roots * 0.15, y + 0.2 + Math.sin(a) * R * 0.5, -0.38 + Math.cos(a) * R * 0.5], [rx + roots * 0.1, y + 0.2 + Math.sin(a) * R, -0.38 + Math.cos(a) * R * 0.9]], 0.11, 0.03, C.driftLo, { seed: seed + 20 + i, seg: 6, rad: 5, gnarl: 0.2 }));
  }
  return parts;
}

// Torn sail canopy (H): a faded sail stretched taut between four old posts,
// low over the lane; its torn edges (a batch of its own) snap in the wind.
function sailParts(half, color) {
  const parts = [];
  const px = half + 0.15;
  // (taut, raked: its front edge high on the front posts, its back edge
  // low on the back ones - so it faces you as you come, and its front edge
  // is a clear line at the height you slide under; nothing below 1.4 m)
  const FRONT = 1.95;
  const BACK = 1.45;
  for (const sx of [-1, 1]) {
    for (const [z, h] of [[0.05, FRONT + 0.25], [-1.15, BACK + 0.25]]) {
      parts.push(part(P.cyl(0.08, 0.1, h, 7), null, { x: sx * px, y: h / 2, z, grad: [C.woodLo, C.wood, 0, h], mark: 0.5 }));
      parts.push(part(P.torus(0.1, 0.03, 4, 8), C.rope, { x: sx * px, y: h - 0.28, z, rx: Math.PI / 2 }));
    }
  }
  const sheet = (k) => surface(10, 5, (u, v) => {
    const y = FRONT + (BACK - FRONT) * v - Math.sin(u * Math.PI) * 0.06 * Math.sin(v * Math.PI);
    return [-px + u * px * 2, y + k, 0.05 - v * 1.2];
  });
  // (both faces: it's seen from above as you come and from below as you
  // slide under it)
  parts.push(part(sheet(0), color, { mark: 0.45, tint: 1 }));
  parts.push(mirrorWinding(part(sheet(-0.025), color, { mark: 0.45, tint: 1, outline: 0 })));
  // a valance hung along its front: a band of cloth at the height you
  // slide under (its foot well above the duck line)
  const val = surface(10, 2, (u, v) => [-px + u * px * 2, FRONT - 0.32 + v * 0.32, 0.07 + 0.03 * Math.sin(u * 13)]);
  parts.push(part(val, color, { mark: 0.45, tint: 1 }));
  parts.push(mirrorWinding(part(val.clone().translate(0, 0, -0.02), color, { mark: 0.45, tint: 1, outline: 0 })));
  // a bound hem along its front edge, a patch, its seams
  rod(parts, [-px, FRONT + 0.01, 0.06], [px, FRONT + 0.01, 0.06], 0.035, C.rope, 0.3);
  rod(parts, [-px, BACK + 0.01, -1.15], [px, BACK + 0.01, -1.15], 0.03, C.rope, 0.3);
  parts.push(part(P.box(0.55, 0.02, 0.4), C.sail, { x: px * 0.35, y: (FRONT + BACK) / 2 + 0.02, z: -0.6, rx: Math.atan2(FRONT - BACK, 1.2), outline: 0 }));
  for (let i = 1; i < 4; i++) {
    const v = i / 4;
    parts.push(part(P.box(px * 2, 0.025, 0.025), '#7d7462', { y: FRONT + (BACK - FRONT) * v + 0.015, z: 0.05 - v * 1.2, outline: 0 }));
  }
  return parts;
}
function mirrorWinding(g) {
  for (const a of Object.values(g.attributes)) {
    const s = a.itemSize;
    const arr = a.array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < s; k++) {
        const i1 = (t + 1) * s + k;
        const i2 = (t + 2) * s + k;
        const v = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = v;
      }
    }
  }
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
function sailEdgeParts(half, seed, color) {
  const rnd = seeded(seed);
  const parts = [];
  const px = half + 0.15;
  for (let i = 0; i < Math.round(px * 4); i++) {
    const front = rnd() < 0.65;
    const len = front ? 0.12 + rnd() * 0.18 : 0.08 + rnd() * 0.1;
    const top = front ? 1.63 : 1.45;
    parts.push(part(P.box(0.2 + rnd() * 0.25, len, 0.02, 2, 3, 1), color, { x: -px + rnd() * px * 2, y: top - len / 2, z: front ? 0.09 : -1.17, mark: 0.45, tint: 1, outline: 0 }));
  }
  return parts;
}

// Lobster pots (W): rounded creels of lath over hoops on a weighted base,
// stacked, tangled in rope, a few faded floats.
function potParts({ x = 0, y = 0, z = 0, ry = 0, s = 1 } = {}) {
  const out = [];
  out.push(part(P.box(0.9, 0.07, 0.62), C.woodLo, { y: 0.035 }));
  for (const zz of [-0.25, 0, 0.25]) out.push(part(P.torus(0.31, 0.022, 4, 12, Math.PI), C.driftLo, { x: zz * 1.4, y: 0.06, ry: Math.PI / 2, outline: 0.3 }));
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI;
    out.push(part(P.box(0.88, 0.025, 0.035), C.wood, { y: 0.06 + Math.sin(a) * 0.31, z: Math.cos(a) * 0.31, rx: a, outline: 0.3 }));
  }
  // its netting, dark between the laths, and the eye of the funnel
  out.push(part(P.cyl(0.29, 0.29, 0.84, 10, 1, true, 0, Math.PI), C.net, { y: 0.06, rz: Math.PI / 2, outline: 0 }));
  out.push(part(P.torus(0.12, 0.025, 4, 10), C.rope, { x: 0.44, y: 0.2, ry: Math.PI / 2 }));
  return moved(
    out.map((g) => g.scale(s, s, s)),
    { x, y, z, ry }
  );
}
function potsParts(seed) {
  const rnd = seeded(seed);
  const parts = [];
  parts.push(...potParts({ x: -0.45, z: -0.35, ry: 0.1 }));
  parts.push(...potParts({ x: 0.5, z: -0.5, ry: -0.15 }));
  parts.push(...potParts({ x: 0.05, z: -1.1, ry: 0.05 }));
  parts.push(...potParts({ x: -0.15, y: 0.4, z: -0.6, ry: 0.3 }));
  parts.push(...potParts({ x: 0.35, y: 0.4, z: -0.9, ry: -0.35 }));
  parts.push(...potParts({ x: 0.05, y: 0.8, z: -0.75, ry: 0.15, s: 0.95 }));
  parts.push(...potParts({ x: -0.2, y: 1.18, z: -0.7, ry: -0.6, s: 0.85 }));
  // rope over the stack, coils at its foot
  for (let i = 0; i < 3; i++) {
    const pts = [[-0.9, 0.05, 0.1 - i * 0.5], [-0.4, 0.9 + rnd() * 0.4, -0.3 - i * 0.3], [0.3, 1.2 + rnd() * 0.4, -0.7], [0.85, 0.3, -0.2 - i * 0.4]];
    parts.push(part(logGeo(pts, 0.025, 0.025, { seg: 14, rad: 4, gnarl: 0 }), C.rope, { outline: 0.3 }));
  }
  parts.push(part(P.torus(0.24, 0.05, 5, 14), C.rope, { x: 0.75, y: 0.05, z: 0.15, rx: Math.PI / 2 }));
  // floats
  for (let i = 0; i < 4; i++) parts.push(part(P.sphere(0.11 + rnd() * 0.05, 8, 6), i % 2 ? C.floatO : C.floatY, { x: -0.7 + rnd() * 1.4, y: 0.1 + rnd() * 1.4, z: 0.05 - rnd() * 1.3 }));
  return parts;
}

// A stranded dinghy (W): heeled over on a rock slantwise across the lane,
// its bow reared up, rainwater lying in it, weed caught round its hull.
function dinghyParts(len, seed, color) {
  const rnd = seeded(seed);
  const parts = [];
  const hull = hullParts({ len, beam: len * 0.4, depth: len * 0.2, color, sides: 7, seg: 12 });
  // rainwater in its bilge
  hull.push(part(surface(6, 3, (u, v) => [-len * 0.38 + u * len * 0.7, len * 0.06, (0.5 - v) * len * 0.22]), '#1a2a38', { mark: WET, outline: 0 }));
  // thwarts
  for (const x of [-len * 0.15, len * 0.18]) hull.push(part(P.box(0.14, 0.04, len * 0.34), C.woodHi, { x, y: len * 0.15 }));
  // weed round its hull
  for (let i = 0; i < 6; i++) hull.push(part(P.box(0.08, 0.3 + rnd() * 0.25, 0.02, 1, 2, 1), null, { x: -len * 0.4 + rnd() * len * 0.8, y: 0.12, z: (rnd() < 0.5 ? -1 : 1) * len * 0.2, rx: (rnd() - 0.5) * 0.8, grad: [C.kelp, C.kelpHi, 0, 0.4], outline: 0 }));
  // (thrown up bow-first onto a heap of rock, heeled toward you so the
  // rain's lying in it: its bow reared well over head height)
  parts.push(...moved(hull, { x: -len * 0.05, y: 0.55 + len * 0.12, z: -len * 0.3, ry: 0.5, rz: 0.62, rx: 0.42 }));
  parts.push(rock({ r: 0.55, sx: 1.4, sy: 0.9, sz: 1.2, seed: seed + 5 }, C.rock, { x: len * 0.22, y: 0.35, z: -len * 0.42 }));
  parts.push(rock({ r: 0.45, sx: 1.2, sy: 0.7, sz: 1.1, seed: seed + 6 }, C.rock, { x: -len * 0.25, y: 0.2, z: -len * 0.2 }));
  // an oar left standing in it
  rod(parts, [-len * 0.1, 0.4, -len * 0.25], [len * 0.05, 2.2 + len * 0.15, -len * 0.35], 0.04, C.woodHi);
  parts.push(part(P.box(0.14, 0.5, 0.03), C.woodHi, { x: len * 0.06, y: 2.15 + len * 0.15, z: -len * 0.35, rz: -0.1 }));
  return parts;
}

// Rock teeth (W): tall black stacks thrust up through the road, their edges
// wet and catching the light; foam gathered round their feet (a batch of its
// own, washing in and out).
function teethParts(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const n = 3;
  for (let i = 0; i < n; i++) {
    const h = 1.7 + rnd() * 1.6 + (i === 1 ? 0.8 : 0);
    // (black at the foot, their wet tops and edges catching the last of the
    // sky - pale enough to stand out against the causeway's dark stone)
    parts.push(part(rockGeo({ r: 0.5, sx: 0.85 + rnd() * 0.4, sy: h / 0.5 / 2, sz: 0.8, seed: seed * 7 + i, detail: 2, rough: 0.24 }), null, { x: -0.55 + i * 0.55 + (rnd() - 0.5) * 0.2, y: h * 0.48, z: -0.5 - (i % 2) * 0.35, rz: (rnd() - 0.5) * 0.3, rx: (rnd() - 0.5) * 0.2, grad: [C.rockLo, C.teethHi, h * 0.15, h * 1.15], mark: WET }));
  }
  parts.push(rock({ r: 0.55, sx: 1.6, sy: 0.6, sz: 1.3, seed: seed + 3 }, C.rock, { y: 0.2, z: -0.6 }));
  return parts;
}
function teethFoamParts(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    parts.push(part(P.sphere(0.22 + rnd() * 0.15, 7, 5), C.foam, { x: Math.cos(a) * 0.95, y: 0.05, z: -0.6 + Math.sin(a) * 0.75, sy: 0.4, mark: FOAM, outline: 0 }));
  }
  return parts;
}

// --- scenery ---------------------------------------------------------------------------
// A fishing boat at anchor offshore (bow to +x): its hull, wheelhouse with a
// lit window, mast and a riding light. It rocks on the swell (TURN).
function fishingBoatParts(color) {
  const parts = hullParts({ len: 8, beam: 2.8, depth: 1.4, color, inside: C.woodLo, sides: 6, seg: 10 });
  parts.push(part(P.box(1.8, 1.4, 1.7), C.boatWhite, { x: -0.8, y: 2.0 }));
  parts.push(part(P.box(2.0, 0.12, 1.9), C.charcoal, { x: -0.8, y: 2.75 }));
  parts.push(part(P.box(0.06, 0.45, 1.1), C.amberHi, { x: 0.12, y: 2.15, emit: 1, outline: 0 }));
  parts.push(part(P.box(0.9, 0.42, 0.06), C.amberHi, { x: -0.8, y: 2.15, z: 0.86, emit: 0.9, outline: 0 }));
  parts.push(part(P.cyl(0.07, 0.09, 5.2, 6), C.woodLo, { x: 1.4, y: 3.9 }));
  parts.push(part(P.cyl(0.05, 0.05, 2.4, 5), C.woodLo, { x: 1.0, y: 3.4, rz: 1.2 }));
  parts.push(part(P.sphere(0.12, 8, 6), C.amberHi, { x: 1.4, y: 6.5, emit: 1, outline: 0 }));
  return parts;
}
// A boat's light laid on the water toward you: a broken column of warm
// glints, widening and fading as it comes.
function streakParts(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const w = 0.25 + t * 0.9 * (0.6 + rnd() * 0.6);
    parts.push(part(P.plane(w, 0.22 + rnd() * 0.25), C.amberHi, { x: (rnd() - 0.5) * 0.5 * t, y: 0.02, z: 0.6 + t * 9, rx: -Math.PI / 2, emit: 0.85 * (1 - t * 0.7), outline: 0 }));
  }
  return parts;
}

// a little rowing boat moored off the quay
function skiffParts(color) {
  return hullParts({ len: 3.2, beam: 1.2, depth: 0.5, color, sides: 6, seg: 10 });
}

// A gull, wings bent at the wrist.
function gullParts() {
  const w = '#d5dade';
  const d = '#6f7a84';
  return [
    part(P.sphere(0.13, 8, 6), w, { sz: 2.2, sx: 0.85 }),
    part(P.sphere(0.08, 8, 6), w, { z: -0.28, y: 0.05 }),
    part(P.cone(0.025, 0.1, 5), '#c8a040', { z: -0.38, y: 0.04, rx: -Math.PI / 2 }),
    part(P.box(0.5, 0.025, 0.2), w, { x: -0.3, y: 0.05, rz: -0.18 }),
    part(P.box(0.5, 0.025, 0.2), w, { x: 0.3, y: 0.05, rz: 0.18 }),
    part(P.box(0.45, 0.02, 0.15), d, { x: -0.74, y: 0.0, z: 0.03, rz: 0.22 }),
    part(P.box(0.45, 0.02, 0.15), d, { x: 0.74, y: 0.0, z: 0.03, rz: -0.22 }),
    part(P.box(0.16, 0.02, 0.18), w, { z: 0.32 }),
  ];
}

// A sea stack standing off the shore.
function stackParts(seed, h = 12) {
  const rnd = seeded(seed);
  const parts = [];
  parts.push(part(rockGeo({ r: 3, sx: 1.2, sy: h / 6, sz: 1, seed, detail: 1, rough: 0.25 }), null, { y: h * 0.4, grad: [C.rockLo, C.rockHi, 0, h], mark: WET }));
  parts.push(part(rockGeo({ r: 2.2, sx: 1.1, sy: 0.9, sz: 1.2, seed: seed + 1 }), null, { x: 2.6, y: 0.4, z: 1, grad: [C.rockLo, C.rock, -1, 2], mark: WET }));
  // a cap of grass
  parts.push(part(P.sphere(2.6, 10, 5, 0, TAU, 0, Math.PI / 2), null, { y: h * 0.4 + h / 2 * 0.95, sy: 0.25, grad: [C.grassLo, C.grassMid, h * 0.88, h * 0.98] }));
  rnd();
  return parts;
}

// A derelict hut at the landing: stone walls, the roof fallen in to its
// rafters, a door hanging, a dark window.
function hutParts(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const w = 4.2;
  const d = 3.2;
  const h = 2.4;
  for (const [x, z, sx, sz] of [[0, d / 2, w, 0.4], [0, -d / 2, w, 0.4], [w / 2, 0, 0.4, d], [-w / 2, 0, 0.4, d]]) {
    parts.push(part(P.box(sx, h, sz, 3, 2, 1), null, { x, y: h / 2, z, grad: [C.stoneLo, C.stone, 0, h], mark: 0.75 }));
  }
  // gables
  for (const s of [-1, 1]) parts.push(part(P.prism(d + 0.4, 1.3, 0.4), C.stone, { x: s * w / 2, y: h, ry: Math.PI / 2, mark: 0.75 }));
  // what's left of the roof: a few slates on one side, rafters bared
  parts.push(part(P.box(w + 0.3, 0.08, 1.4), C.charcoal, { y: h + 0.55, z: d / 4 + 0.3, rx: -0.68, mark: 0.6 }));
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 0.4 + i * (w - 0.8) / 4;
    if (rnd() < 0.8) parts.push(part(P.box(0.1, 0.1, 2.1), C.woodLo, { x, y: h + 0.62, z: -d / 4, rx: 0.68 }));
  }
  parts.push(part(P.box(0.9, 1.8, 0.08), C.woodLo, { x: 0.8, y: 0.95, z: d / 2 + 0.22, ry: 0.5 }));
  parts.push(part(P.box(0.7, 0.6, 0.06), '#0f1418', { x: -1.0, y: 1.5, z: d / 2 + 0.2, outline: 0 }));
  return parts;
}

// A dry-stone wall across the fields (scenery; runs along x).
function fieldWallParts(len, seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let c = 0; c < 3; c++) {
    let x = -len / 2;
    while (x < len / 2) {
      const w = 0.35 + rnd() * 0.3;
      if (c === 0 || rnd() > 0.12 + c * 0.1) parts.push(part(rockGeo({ r: 0.2, sx: w * 2.2, sy: 0.85, sz: 1.6, seed: Math.floor(rnd() * 999), detail: 0, rough: 0.2 }), null, { x: x + w / 2, y: 0.15 + c * 0.24, grad: [C.stoneLo, C.stone, -0.1, 0.8], mark: 0.6 }));
      x += w + 0.04;
    }
  }
  return parts;
}

// An old post (a fence's, a mooring's) with a rope's end tied round it.
function postParts() {
  return [part(P.cyl(0.08, 0.11, 1.4, 6), null, { y: 0.7, grad: [C.woodLo, C.wood, 0, 1.4], mark: 0.5 }), part(P.torus(0.11, 0.03, 4, 8), C.rope, { y: 1.15, rx: Math.PI / 2 })];
}
function ropeEndParts() {
  return [part(P.box(0.035, 0.6, 0.035, 1, 4, 1), C.rope, { x: 0.11, y: 0.85, outline: 0 }), part(P.box(0.03, 0.4, 0.03, 1, 3, 1), C.rope, { x: 0.1, y: 0.95, z: 0.05, rz: 0.2, outline: 0 })];
}

// --- the lighthouse ------------------------------------------------------------------
// On its rocky headland: the headland's crags with grass on top running
// off along the coast, a keeper's cottage, the tower - pale, banded, its
// gallery and the lantern room glowing amber. (Its foot at the sea: y 0 is
// the sea's level.)
const LANTERN_Y = 31.2;
function lighthouseGeo() {
  const parts = [];
  const rnd = seeded(5);
  // the headland
  for (let i = 0; i < 9; i++) {
    const x = -24 + i * 6 + (rnd() - 0.5) * 3;
    const h = 7 + Math.sin(i * 0.9) * 2 + (Math.abs(x) < 8 ? 3 : 0) - Math.max(0, x - 14) * 0.25;
    parts.push(part(rockGeo({ r: 5, sx: 1.2, sy: (h + 4) / 10, sz: 1.2, seed: 60 + i, detail: 1, rough: 0.25 }), null, { x, y: h * 0.4 - 2, z: (rnd() - 0.5) * 6, grad: [C.rockLo, C.rockHi, 0, h], mark: WET }));
  }
  for (let i = 0; i < 6; i++) parts.push(part(rockGeo({ r: 5, sx: 1.4, sy: 0.32, sz: 1.3, seed: 70 + i, detail: 1, rough: 0.15 }), null, { x: -16 + i * 6.2, y: 9.2 + Math.sin(i * 1.3) * 0.5 - Math.max(0, i - 3) * 1.2, z: (i % 2) * 2 - 1, grad: [C.rock, C.grassMid, 8, 11], mark: 0.5 }));
  // the tower: tapering, pale, a dark band about its middle
  const base = 10.6;
  parts.push(part(P.cyl(1.55, 2.05, 15, 18, 3), C.tower, { y: base + 7.5 }));
  parts.push(part(P.cyl(1.82, 1.9, 2.4, 18), C.band, { y: base + 6.5 }));
  parts.push(part(P.cyl(2.3, 2.3, 0.3, 18), C.charcoal, { y: base + 15.1 }));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    parts.push(part(P.box(0.06, 0.7, 0.06), C.charcoal, { x: Math.cos(a) * 2.2, y: base + 15.6, z: Math.sin(a) * 2.2, outline: 0 }));
  }
  parts.push(part(P.torus(2.2, 0.05, 4, 24), C.charcoal, { y: base + 15.95, rx: Math.PI / 2, outline: 0 }));
  parts.push(part(P.cyl(1.25, 1.25, 1.1, 16), C.charcoal, { y: base + 15.8 }));
  parts.push(part(P.cyl(1.15, 1.15, 2.0, 16), C.amberHi, { y: base + 17.4, emit: 1, outline: 0 }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    parts.push(part(P.box(0.08, 2.0, 0.08), C.charcoal, { x: Math.cos(a) * 1.17, y: base + 17.4, z: Math.sin(a) * 1.17, outline: 0 }));
  }
  parts.push(part(P.cone(1.45, 1.3, 16), C.charcoal, { y: base + 19.05 }));
  parts.push(part(P.sphere(0.22, 8, 6), C.charcoal, { y: base + 19.8 }));
  // windows up the tower
  for (let i = 0; i < 3; i++) parts.push(part(P.box(0.4, 0.6, 0.1), '#2a3542', { x: 0.2, y: base + 3 + i * 4, z: 1.95 - i * 0.12, outline: 0 }));
  // the keeper's cottage, a window lit
  parts.push(part(P.box(6, 3, 4), C.tower, { x: -6.5, y: base + 1.5, z: 1 }));
  parts.push(part(P.prism(6.6, 2, 4.4), C.charcoal, { x: -6.5, y: base + 3, z: 1 }));
  parts.push(part(P.box(0.9, 0.9, 0.1), C.amberHi, { x: -5.4, y: base + 1.6, z: 3.03, emit: 0.85, outline: 0 }));
  parts.push(part(P.box(0.9, 0.9, 0.1), '#2a3542', { x: -7.8, y: base + 1.6, z: 3.03, outline: 0 }));
  // the coast running on from it, lower and lower
  for (let i = 0; i < 6; i++) parts.push(part(rockGeo({ r: 7, sx: 1.6, sy: 0.5 - i * 0.05, sz: 1.2, seed: 80 + i, detail: 1 }), null, { x: 30 + i * 16, y: 1.2 - i * 0.2, z: -6 - i * 6, grad: [C.rockLo, C.grassLo, 0, 4], mark: 0.5 }));
  return merge(parts);
}
// The beams: two, back to back, reaching from the lantern (along +x and
// -x, dipping a little); uv.y runs from 0.4 at the lantern to 1 at the end
// (see FS_BEAM).
function beamGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    const len = 175;
    const g = P.cyl(0.6, 13, len, 14, 6, true);
    const uv = g.attributes.uv;
    const p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.4 + 0.6 * (1 - (p.getY(i) + len / 2) / len));
    g.translate(0, -len / 2, 0);
    g.rotateZ(s * Math.PI / 2 - s * 0.045);
    parts.push(part(g, '#ffffff', { outline: 0, tint: 1 }));
  }
  return merge(parts);
}

// --- the doorway into Blue Hour ---------------------------------------------------
const OPENING = { halfW: 4.5, rectH: 6.8, arch: false };
const GATE_DEPTH = 1.6;
function gateGeo() {
  const parts = [...gateFrameParts(OPENING, { thick: 1.3, depth: GATE_DEPTH, color: C.stone, mark: 0.7 })];
  const top = gateTop(OPENING);
  // a driftwood lintel over it, a ship's lantern hung from it
  parts.push(log([[-OPENING.halfW - 2.2, top + 0.4, GATE_DEPTH / 2 + 0.3], [0, top + 0.6, GATE_DEPTH / 2 + 0.45], [OPENING.halfW + 2.4, top + 0.3, GATE_DEPTH / 2 + 0.25]], 0.42, 0.32, C.drift, { seed: 9, seg: 18 }));
  parts.push(part(P.cyl(0.03, 0.03, 0.8, 4), C.charcoal, { y: top - 0.1, z: GATE_DEPTH / 2 + 0.45 }));
  parts.push(part(P.cyl(0.32, 0.36, 0.7, 8), C.amberHi, { y: top - 0.8, z: GATE_DEPTH / 2 + 0.45, emit: 1, outline: 0.4 }));
  parts.push(part(P.cone(0.42, 0.3, 8), C.charcoal, { y: top - 0.32, z: GATE_DEPTH / 2 + 0.45 }));
  // ropes coiled at its feet, floats strung across
  for (const s of [-1, 1]) {
    parts.push(part(P.torus(0.45, 0.1, 5, 14), C.rope, { x: s * (OPENING.halfW + 0.65), y: 0.12, z: GATE_DEPTH / 2 + 0.7, rx: Math.PI / 2 }));
    parts.push(part(P.torus(0.35, 0.09, 5, 14), C.rope, { x: s * (OPENING.halfW + 0.7), y: 0.3, z: GATE_DEPTH / 2 + 0.7, rx: Math.PI / 2 }));
    parts.push(...potParts({ x: s * (OPENING.halfW + 2.0), z: GATE_DEPTH / 2 + 0.6, ry: s * 0.3 }));
    parts.push(rock({ r: 1.4, sx: 1.3, sy: 1.0, sz: 1.2, seed: s > 0 ? 3 : 4 }, C.rock, { x: s * (OPENING.halfW + 3.4), y: 0.6, z: 0 }));
  }
  for (let i = 0; i < 7; i++) parts.push(part(P.sphere(0.2, 8, 6), i % 2 ? C.floatO : C.floatY, { x: -3 + i, y: top + 0.05 - Math.sin((i / 6) * Math.PI) * 0.4, z: GATE_DEPTH / 2 + 0.6 }));
  return merge(parts);
}
// Its leaves: planks, painted (the door's faded denim), iron straps, a
// porthole glowing warm across the two leaves.
function coastLeaf({ W, H, z, f }) {
  const out = [];
  const at = (t) => z + (f * t) / 2;
  for (let x = 0.62; x < W - 0.15; x += 0.62) out.push(part(P.box(0.06, H - 0.2, 0.04), '#9a9a9a', { x, y: H / 2, z: at(0.04), tint: 1, outline: 0 }));
  for (const y of [1.2, H - 1.1]) {
    out.push(part(P.box(W * 0.8, 0.2, 0.06), C.charcoal, { x: W * 0.4, y, z: at(0.06), outline: 0.5 }));
    for (let i = 0; i < 4; i++) out.push(part(P.sphere(0.05, 6, 4), '#6a6a6a', { x: 0.4 + i * W * 0.22, y, z: at(0.12), outline: 0 }));
  }
  const wy = H * 0.66;
  const R = 0.95;
  out.push(part(P.torus(R + 0.04, 0.12, 6, 20, Math.PI), '#b08a4a', { x: W, y: wy, z: at(0.16), rz: Math.PI / 2 }));
  out.push(part(P.cyl(R, R, 0.05, 18, 1, false, Math.PI, Math.PI), C.amberHi, { x: W, y: wy, z: at(0.05), rx: Math.PI / 2, emit: 0.9, outline: 0 }));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 2 + (i / 3) * Math.PI;
    out.push(part(P.sphere(0.06, 6, 4), '#b08a4a', { x: W + Math.cos(a) * (R + 0.2), y: wy + Math.sin(a) * (R + 0.2), z: at(0.2), outline: 0 }));
  }
  out.push(part(P.torus(0.22, 0.05, 6, 14), '#b08a4a', { x: W - 0.55, y: 3.2, z: at(0.12) }));
  return out;
}

// --- the obstacle lists, by stretch -----------------------------------------------
const S_WALL = { name: 'wallL', with: ['wallLGrass'], len: 1.1 };
const S_DRIFT = { name: 'driftL', with: ['driftLKelp'], len: 0.95 };
const S_CUT = { name: 'cutL', with: ['cutLSpray'], len: CUT_LEN, top: 0.5, wade: true, flat: true };
const S_ARCH = { name: 'driftArch', len: 0.8 };
const S_NET = { name: 'netFrame', with: ['netFrameEdge'], len: 0.5 };
const S_SPAR = { name: 'spar', left: 'sparL', with: ['sparCloth'], withLeft: ['sparClothL'], len: 0.7, lanes: [0, 2] };
const S_SAIL = { name: 'sail', with: ['sailEdge'], len: 1.2, tints: [C.sail, C.sailRed, C.sailBlue] };
const S_POTS = { name: 'pots', len: 1.5 };
const S_DINGHY = { name: 'dinghy', len: 1.9, tints: [C.boatBlue, C.boatRed, C.boatGreen, C.boatWhite] };
const S_TEETH = { name: 'teeth', with: ['teethFoam'], len: 1.3 };
const S_WASH = { name: 'wash', len: WASH_LEN, flat: true };
const S_CUTW = { name: 'cutW', with: ['cutWSpray'], len: CUT_LEN, top: 0.5, wade: true, flat: true };
const S_WALLW = { name: 'wallW', with: ['wallWGrass'], len: 1.2 };
const S_DRIFTW = { name: 'driftW', with: ['driftWKelp'], len: 1.0 };
const S_ARCHW = { name: 'driftArchW', len: 0.9 };
const S_NETW = { name: 'netFrameW', with: ['netFrameWEdge'], len: 0.5 };
const S_SAILW = { name: 'sailW', with: ['sailWEdge'], len: 1.2, tints: [C.sail, C.sailRed, C.sailBlue] };
const S_DRIFT2 = { name: 'driftTwin', with: ['driftTwinKelp'], len: 1.0 };
const S_DINGHY2 = { name: 'dinghyTwin', len: 2.6, tints: [C.boatBlue, C.boatRed, C.boatGreen] };

const ZONES = {
  // the grass headland (and the grass again, after the landing): walls,
  // driftwood, the odd tree wedged in the rocks, rock teeth; now and then a
  // boat the sea's thrown right up into the grass
  headland: {
    L: [{ ...S_WALL, w: 1.3 }, S_DRIFT],
    H: [S_ARCH],
    W: [{ ...S_TEETH, w: 1.4 }, { ...S_DINGHY, w: 0.45 }],
    LW: [S_WALLW, S_DRIFTW],
    HW: S_ARCHW,
    twin: { L: [S_DRIFT2] },
    twinChance: 0.4,
  },
  // the causeway: the sea washes across it and cuts it (the great swells
  // rearing up beside it are scenery: see swellChunk); driftwood, rocks and
  // wrecks thrown up on it
  causeway: {
    L: [{ ...S_CUT, w: 1.6 }, S_DRIFT],
    H: [S_ARCH, S_SPAR],
    W: [S_TEETH, { ...S_DINGHY, w: 0.6 }],
    LW: [S_WASH, S_CUTW, S_WASH],
    HW: S_ARCHW,
    twin: { L: [S_DRIFT2], W: [S_DINGHY2] },
    twinChance: 0.3,
  },
  // the old fishing landing
  landing: {
    L: [S_WALL, { ...S_DRIFT, w: 0.6 }],
    H: [S_NET, S_SPAR, { ...S_SAIL, w: 1.2 }],
    W: [{ ...S_POTS, w: 1.3 }, S_DINGHY],
    LW: [S_WALLW],
    HW: [S_NETW, S_SAILW],
    twin: { W: [S_DINGHY2] },
    twinChance: 0.45,
  },
};
ZONES.grass = ZONES.headland;

// --- keeping time with the runner -----------------------------------------------
// The lighthouse stands this far ahead of the camera and out to the right,
// on its headland - never nearer, never further, like any far landmark.
const LH_AHEAD = 178;
const LH_X = 40;
const LH_SCALE = 1.45;
// a beam's turn (rad/s): two beams, a sweep every five and a half seconds
const SPIN = TAU / 11;
const LIGHTHOUSE = { coast: 'lighthouse' };
const progress = new WeakMap();

// A wave's progress, given how long until the runner reaches it (T, s):
// 0 until `lead` seconds out, 1 the moment they get there, then on toward
// 2 as it drains away behind them; never going back.
function advance(owner, T, lead, after) {
  const u = T >= 0 ? Math.max(0, 1 - T / lead) : Math.min(2, 1 - T / after);
  const was = progress.get(owner) ?? 0;
  const now = Math.max(was, u);
  progress.set(owner, now);
  return now;
}

function ensure(world, name, o) {
  const b = world.batch(name);
  for (const it of b.items) if (it.owner === LIGHTHOUSE) return it;
  return world.put(LIGHTHOUSE, name, 0, 0, 0, o);
}

function frame(world, game, seg, dt) {
  const st = (world.coastState ||= { theta: 1.2, flare: 0 });
  const u = world.u;
  const camD = game.camDist();
  const origin = game.origin;
  const v = Math.max(game.speed, 9);

  // The lighthouse, its glow and its beams, kept far off on the headland.
  // (In this curved world the sea's own horizon is only a hundred metres
  // or so off: the lighthouse is stood with its foot on that line - the
  // highest the sea reaches in the camera's eye - raised by however much
  // the world's bend will sink it where it is, so it stands on the horizon
  // rather than hanging over it or sunk behind it.)
  const lhD = camD + LH_AHEAD;
  const bend = (a) => CONFIG.bend * Math.max(0, a - CONFIG.bendStart) ** 2;
  const camY = game.cam.camera.position.y;
  let slope = -Infinity;
  for (let a = 30; a <= 260; a += 5) slope = Math.max(slope, (SEA_Y - bend(a) - camY) / a);
  const foot = camY + slope * LH_AHEAD + bend(LH_AHEAD) - 0.6;
  const lh = ensure(world, 'lighthouse', { p0: 0, p1: 0, s: LH_SCALE });
  lh.x = LH_X;
  lh.y = foot;
  lh.d = lhD;
  const ly = foot + LANTERN_Y * LH_SCALE;
  const glow = ensure(world, 'lanternGlow', { s: 16, c: [1, 0.72, 0.42], p0: 0 });
  glow.x = LH_X;
  glow.y = ly;
  glow.d = lhD;
  const beams = ensure(world, 'beams', { c: [1, 1, 1], p0: 0 });
  beams.x = LH_X;
  beams.y = ly;
  beams.d = lhD;
  world.batch('lighthouse').dirty = true;
  world.batch('lanternGlow').dirty = true;

  // The beams turn steadily - except that as the runner comes up to the
  // causeway's mouth they're brought round (never faster than twice their
  // pace, never slower than a third) so one of them swings right across the
  // road just as they come out of the long grass, and slows there a moment,
  // lighting up the great wave's spray, before going on.
  let w = SPIN;
  let flare = 0;
  if (seg && game.state === 'running') {
    const S = stretches(seg);
    const ahead = S.mouth - game.dist;
    if (ahead > -v * 1.4 && ahead < 340) {
      const T = ahead / v;
      // (from the lantern to the runner as they reach the mouth: the camera
      // is camera.back behind them, the lighthouse LH_AHEAD ahead of that)
      const dz = LH_AHEAD - CONFIG.camera.back;
      const target = Math.atan2(-dz, -LH_X);
      if (T > 0.7) {
        let e = (target - (st.theta + SPIN * T)) % Math.PI;
        if (e > Math.PI / 2) e -= Math.PI;
        if (e < -Math.PI / 2) e += Math.PI;
        w = Math.min(SPIN * 2.1, Math.max(SPIN * 0.35, SPIN + e / Math.max(T - 0.5, 0.4)));
      } else {
        w = SPIN * 0.22;
      }
      flare = Math.max(0, 1 - Math.abs(T) / 1.3);
    }
  }
  st.theta = (st.theta + w * dt) % TAU;
  st.flare += (flare - st.flare) * Math.min(1, dt * 4);
  beams.ry = st.theta;
  world.batch('beams').dirty = true;
  u.uBeacon.value.set(LH_X, ly, -(lhD - origin), st.theta);
  u.uBeacon2.value.set(1.0 + 0.6 * st.flare, 0.075 + 0.03 * st.flare, 240, st.flare);

  // the waves that keep time with the runner
  const step = (name, lead, after, at = 0) => {
    if (!world.has(name)) return;
    const b = world.batch(name);
    for (const it of b.items) {
      if (!it.owner) continue;
      const T = (it.d + at - game.dist) / v;
      const p = advance(it.owner, T, lead, after);
      if (p !== it.p1) {
        it.p1 = p;
        b.dirty = true;
      }
    }
  };
  step('wash', WASH_LEAD, 1.4);
  // the great swells beside the causeway, rearing up and pitching over its
  // wall as you come alongside (scenery: their progress is kept on the
  // instance itself - put at 0 - and never goes back)
  if (world.has('swell')) {
    const b = world.batch('swell');
    for (const it of b.items) {
      const T = (it.d - SWELL_AT - game.dist) / v;
      const p = Math.max(it.p1, T >= 0 ? Math.max(0, 1 - T / 3.4) : Math.min(2, 1 - T / 1.6));
      if (p !== it.p1) {
        it.p1 = p;
        b.dirty = true;
      }
    }
  }
  // (the great wave: breaking the moment the runner is out onto the
  // causeway, f 0.44 - see BREAKER)
  const big = world.batch('bigBreaker');
  for (const it of big.items) {
    if (!it.owner) continue;
    const T = (it.d - BIG_AHEAD - game.dist) / v;
    const f = T > 0.1 ? 0.44 * Math.max(0, Math.min(1, (3.3 - T) / 3.2)) : 0.44 + (0.1 - T) * 0.2;
    const was = progress.get(it.owner) ?? 0;
    const now = Math.min(1, Math.max(was, f));
    progress.set(it.owner, now);
    if (now !== it.p1) {
      it.p1 = now;
      big.dirty = true;
    }
  }
}

// --- the world --------------------------------------------------------------------
export default {
  id: 'coast',
  name: 'Blue Hour',
  doorColor: '#40698a',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  frame,

  env: {
    // held for ever at blue hour: deep denim overhead, a pale slate glow low
    // on the horizon where the sun's gone, the first stars
    // (the deep, saturated cobalt of real blue hour - not a grey dusk: the
    // light's all from the sky, no warmth left in it but the lamps')
    sky: ['#0c1a4c', '#4067b8', '#112452'],
    bloom: ['#3a64b0', '#ffb347', '#dfe9f0'],
    sun: { dir: [-0.55, -0.03, -1], glow: '#7d9de0' },
    stars: 0.32,
    skyFx: { rays: 0, clouds: 0.24 },
    // cool, soft light off the whole sky, bright enough to read by
    // (everything lit blue, the shadows bluer still; edges caught by the
    // bright sky behind them, so the dark shapes keep their outlines)
    light: { dir: [-0.35, 0.65, -0.65], shadow: [0.36, 0.45, 0.76], hi: [0.78, 0.9, 1.2], soft: 0.3, wrap: 0.4, hiAmt: 0.3, lift: 1 },
    rim: [0.52, 0.7, 1.0, 0.42],
    // sea mist lying low over the water, never up over the road near you
    mist: { color: '#4466a8', amount: 0.24, top: -1.2, fade: 2.6, near: 55, far: 220 },
    grade: { sat: 1.2, contrast: 1.08, vignette: 0.34, exposure: 1.1, tint: '#05113a' },
    ink: '#0a1024',
    fog: [65, 320],
    ground: ['#566279', '#434e67', '#1b2236'],
    shadowDecal: [0.48, 0.55, 0.76],
    // (the dust a footfall kicks up off wet earth and stone: dark, little)
    dustPale: 0.18,
    cast: [0.3, 0.45],
    glowGain: 1.2,
    pool: '#ffb36a',
    // (the lighthouse's beams)
    beam: { color: '#ffd9a0', amount: 0.55 },
    // spray and seed blown inland on the wind
    particles: { color: '#d2def6', size: 1.7, drift: [-1.3, 0.05, 1.0], opacity: 0.6 },
  },

  // Every time it comes round it's blue hour still - only a little deeper
  // into it, the stars out further, the mist thicker on the water - and
  // then, deep in the run, a stranger blue.
  visits: [
    {
      env: {
        sky: ['#0a1746', '#3a5fb0', '#0f214c'],
        stars: 0.5,
        mist: { amount: 0.55 },
        grade: { exposure: 1.06 },
        glowGain: 1.35,
      },
    },
    {
      env: {
        sky: ['#091442', '#3558a8', '#0d1e48'],
        stars: 0.7,
        skyFx: { clouds: 0.3, aurora: 0.12 },
        mist: { amount: 0.6, color: '#4c6db0' },
        glowGain: 1.5,
      },
    },
    { env: { trip: [0.06, 0.25, 0.1] } },
  ],

  // the causeway's mouth: kept clear from the last of the long grass until
  // you're well out onto it
  holdAt(seg, d) {
    const S = stretches(seg);
    return d > S.mouth + HOLD[0] && d < S.mouth + HOLD[1] ? S.mouth + HOLD[1] : 0;
  },

  obstaclesAt(seg, d) {
    if (!seg) return null;
    return ZONES[zoneAt(stretches(seg), d)];
  },

  *build(b) {
    // (the lighthouse, the wind: written every frame - see frame)
    b.u.uBeacon = { value: new THREE.Vector4(LH_X, 30, -180, 0) };
    b.u.uBeacon2 = { value: new THREE.Vector4(1, 0.075, 240, 0) };
    // from the sea toward the land and back past the runner
    b.u.uWind = { value: new THREE.Vector4(-0.73, 0.68, 0.85, 0.55) };
    const COAST = { coast: true };
    const GRASS = [0.2, 0.12, 0.04];

    b.toon('sea', seaStrip(), { cap: 40, ink: 0, sea: true });
    yield;
    b.ground('field', landStrip(HEADLAND_XS, landY), 18, { ...COAST });
    yield;
    b.ground('fieldL', landStrip(LANDING_XS, landingY), 18, { ...COAST });
    yield;
    b.ground('deck', merge([part(new THREE.PlaneGeometry(9.9, 16, 1, 4).rotateX(-Math.PI / 2).translate(0, 0, -8), '#ffffff', { outline: 0 })].map(uvMetres)), 19, { ...COAST });
    yield;
    b.ground('boards', merge([part(new THREE.PlaneGeometry(12.6, 16, 1, 4).rotateX(-Math.PI / 2).translate(0.3, 0, -8), '#ffffff', { outline: 0 })].map(uvMetres)), 20, { ...COAST });
    yield;
    b.toon('side', causewaySideGeo(3), { ...COAST, cap: 30, ink: 0.03, marks: [2, 2] });
    yield;
    b.toon('sideB', causewaySideGeo(11), { ...COAST, cap: 30, ink: 0.03, marks: [2, 2] });
    yield;
    // (no pop-up for these: each lies a whole chunk long beside the road,
    // and folded up like a page it stood on end - a tower of rock rearing
    // up on the horizon and swinging down. They're just there, coming up
    // out of the dusk like the causeway's sides.)
    b.toon('rockPile', rockPileGeo(5), { ...COAST, cap: 70, ink: 0.04 });
    yield;
    b.toon('rockPileB', rockPileGeo(17), { ...COAST, cap: 70, ink: 0.04 });
    yield;
    b.toon('quay', quayGeo(4), { ...COAST, cap: 24, ink: 0.03 });
    yield;
    b.toon('bollard', bollardGeo(), { ...COAST, cap: 40, anim: 'pop' });
    yield;
    // (a cliff face where the land stops short of the causeway, and where
    // it starts again after it)
    const landEnd = (xs, yOf) => merge([part(surface(xs.length - 1, 1, (uu, vv) => {
      const x = xs[Math.round(uu * (xs.length - 1))];
      return [x, vv < 0.5 ? SEA_Y - 0.8 : yOf(x), 0];
    }), null, { grad: [C.rockLo, C.rock, SEA_Y, 1], mark: WET, outline: 0 })]);
    b.toon('landEnd', landEnd(HEADLAND_XS, landY), { ...COAST, cap: 8, ink: 0, side: THREE.DoubleSide });
    yield;
    b.toon('landEndL', landEnd(LANDING_XS, landingY), { ...COAST, cap: 8, ink: 0, side: THREE.DoubleSide });
    yield;

    // the grass, in the wind
    b.toon('grass', merge(grassParts({ n: 14, h: [0.8, 1.45], spread: 0.5, seed: 3 })), { cap: 900, ink: 0, anim: 'pop', wind: GRASS });
    yield;
    b.toon('grassTall', merge(grassParts({ n: 18, h: [1.3, 2.2], spread: 0.6, w: 0.06, seed: 19, seeds: 0.35 })), { cap: 520, ink: 0, anim: 'pop', wind: [0.15, 0.1, 0.05] });
    yield;
    b.toon('grassLow', merge(grassParts({ n: 9, h: [0.3, 0.65], spread: 0.3, w: 0.04, seed: 8, seeds: 0.1 })), { cap: 520, ink: 0, anim: 'popLate', wind: [0.6, 0.15, 0.0] });
    yield;
    b.toon('grassFar', merge(grassParts({ n: 8, h: [0.8, 1.4], spread: 0.7, w: 0.08, seed: 41, seeds: 0 })), { cap: 520, ink: 0, anim: 'pop', wind: GRASS });
    yield;

    // the shore, the rocks, the stacks out at sea
    b.toon('rockA', merge([rock({ r: 1.1, sx: 1.3, sy: 0.8, sz: 1.1, seed: 2 })]), { ...COAST, cap: 160, anim: 'pop', ink: 0.04 });
    yield;
    b.toon('rockB', merge([rock({ r: 0.8, sx: 1, sy: 1.1, sz: 0.9, seed: 9 })]), { ...COAST, cap: 160, anim: 'pop', ink: 0.04 });
    yield;
    // (far out on the water, they loom up out of the mist as you come - no
    // springing up out of the sea forty metres and bouncing)
    b.toon('stack', merge(stackParts(4, 14)), { ...COAST, cap: 16, ink: 0.05 });
    yield;
    b.toon('stackB', merge(stackParts(13, 9)), { ...COAST, cap: 16, ink: 0.05 });
    yield;
    b.toon('breaker', breakerGeo({ seed: 3, spray: 32 }), { cap: 50, ink: 0, side: THREE.DoubleSide, breaker: [7.5, 3.6] });
    yield;
    b.toon('breakerB', breakerGeo({ seed: 8, len: 9, spray: 40, up: [7, 12] }), { cap: 30, ink: 0, side: THREE.DoubleSide, breaker: [9.5, 4.4] });
    yield;
    // (the great wave beside you as you come out onto the causeway)
    b.toon('bigBreaker', breakerGeo({ seed: 21, len: 12, spray: 120, up: [9, 14], wide: 1.5 }), { cap: 4, ink: 0, side: THREE.DoubleSide, breaker: [8, 5.2, 1] });
    yield;

    // the headland's walls, driftwood, old posts
    b.toon('fieldWall', merge(fieldWallParts(12, 5)), { ...COAST, cap: 40, anim: 'pop', ink: 0.03, marks: [2, 2] });
    yield;
    b.toon('driftSmall', merge(driftParts(0.9, 44)), { ...COAST, cap: 30, anim: 'pop', ink: 0.035 });
    yield;
    b.toon('post', merge(postParts()), { ...COAST, cap: 60, anim: 'pop', ink: 0.03 });
    yield;
    b.toon('ropeEnd', merge(ropeEndParts()), { cap: 60, anim: 'pop', ink: 0, wind: [0.5, 0.35, 1.2, 1] });
    yield;
    // the landing's scenery
    b.toon('hut', merge(hutParts(3)), { ...COAST, cap: 8, anim: 'pop', ink: 0.04, marks: [1.5, 1.5] });
    yield;
    b.toon('potStack', merge(potsParts(9)), { ...COAST, cap: 16, anim: 'pop', ink: 0.03 });
    yield;
    b.toon('upturned', merge(moved(skiffParts(C.boatGreen), { rx: Math.PI, y: 0.55 })), { ...COAST, cap: 8, anim: 'pop', ink: 0.035 });
    yield;
    b.toon('netRack', merge(netFrameParts(1.6)), { ...COAST, cap: 10, anim: 'pop', ink: 0.03 });
    yield;
    b.toon('netRackEdge', merge(netEdgeParts(1.6, 3)), { cap: 10, anim: 'pop', ink: 0, wind: [0.9, 0.5, 2.5, 1] });
    yield;
    // boats: moored off the quay, and fishing offshore, rocking, lights lit
    b.toon('skiff', merge(skiffParts('#ffffff')), { ...COAST, cap: 16, anim: 'pop', ink: 0.03, turn: [0, 0.07, 1.3, 0], wobble: [0, 0.06, 1.1, 0] });
    yield;
    b.toon('boat', merge(fishingBoatParts('#ffffff')), { ...COAST, cap: 24, ink: 0.035, turn: [0, 0.09, 0.9, 0], wobble: [0, 0.12, 0.8, 0] });
    yield;
    b.toon('streak', merge(streakParts(5)), { cap: 30, anim: 'pop', ink: 0, wobble: [0, 0.08, 1.1, 0] });
    yield;
    b.glow('glow', { cap: 80, anim: 'pop' });
    yield;
    b.glow('lanternGlow', { cap: 2, anim: [0, 9000, 9001, 0] });
    yield;
    b.toon('gull', merge(gullParts()), { cap: 40, anim: 'lift', ink: 0.02, fly: [0.45, 4.5, 4.5, 0.18] });
    yield;
    // the lighthouse on its headland, and its beams
    b.toon('lighthouse', lighthouseGeo(), { ...COAST, cap: 2, ink: 0.05, clear: 1 });
    yield;
    b.beam('beams', beamGeo(), { cap: 2, unbend: true, order: 8 });
    yield;
    b.shadow('shadow', { cap: 200, anim: 'pop' });
    yield;

    // obstacles
    // (whatever's in your way stands clear of the sea mist and the dusk's
    // haze - not all the way, it's still in the world - so it reads from
    // well off against the dark stone)
    const OB = { ...COAST, anim: 'popEarly', clear: 0.7 };
    b.toon('wallL', merge(wallParts(1.05, 3)), { ...OB, cap: 16, ink: 0.035, marks: [2, 2] });
    yield;
    b.toon('wallLGrass', merge(wallGrassParts(1.05, 3)), { cap: 16, ink: 0, anim: 'popEarly', wind: [0.5, 0.15, 0.25] });
    yield;
    b.toon('wallW', merge(wallParts(4.9, 7)), { ...OB, cap: 6, ink: 0.035, marks: [2, 2] });
    yield;
    b.toon('wallWGrass', merge(wallGrassParts(4.9, 7)), { cap: 6, ink: 0, anim: 'popEarly', wind: [0.5, 0.15, 0.25] });
    yield;
    b.toon('driftL', merge(driftParts(1.05, 5)), { ...OB, cap: 16, ink: 0.04 });
    yield;
    b.toon('driftLKelp', merge(kelpParts(1.05, 5, 0.5)), { cap: 16, ink: 0, anim: 'popEarly', wind: [1.4, 0.4, 0.5, 1] });
    yield;
    b.toon('driftTwin', merge(driftParts(2.3, 15)), { ...OB, cap: 8, ink: 0.04 });
    yield;
    b.toon('driftTwinKelp', merge(kelpParts(2.3, 15, 0.55)), { cap: 8, ink: 0, anim: 'popEarly', wind: [1.4, 0.4, 0.55, 1] });
    yield;
    b.toon('driftW', merge(driftParts(4.6, 25)), { ...OB, cap: 6, ink: 0.04 });
    yield;
    b.toon('driftWKelp', merge(kelpParts(4.6, 25, 0.6)), { cap: 6, ink: 0, anim: 'popEarly', wind: [1.4, 0.4, 0.6, 1] });
    yield;
    b.toon('cutL', cutGeo(1.1, 3), { ...OB, cap: 12, ink: 0.03, cut: [CUT_LEN, 0.5] });
    yield;
    b.toon('cutLSpray', cutSprayGeo(1.1, 5), { cap: 12, ink: 0, anim: 'popEarly', splash: true, coast: true });
    yield;
    b.toon('cutW', cutGeo(4.85, 9), { ...OB, cap: 6, ink: 0.03, cut: [CUT_LEN, 0.5] });
    yield;
    b.toon('cutWSpray', cutSprayGeo(4.85, 13), { cap: 6, ink: 0, anim: 'popEarly', splash: true, coast: true });
    yield;
    b.toon('wash', washGeo(), { cap: 6, ink: 0, side: THREE.DoubleSide, wash: true, clear: 1 });
    yield;
    b.toon('driftArch', merge(driftArchParts(1.05, 7, { roots: 1 })), { ...OB, cap: 12, ink: 0.04 });
    yield;
    b.toon('driftArchW', merge(driftArchParts(4.75, 27, { roots: -1 })), { ...OB, cap: 6, ink: 0.04 });
    yield;
    b.toon('netFrame', merge(netFrameParts(1.05)), { ...OB, cap: 12, ink: 0.03 });
    yield;
    b.toon('netFrameEdge', merge(netEdgeParts(1.05, 7)), { cap: 12, ink: 0, anim: 'popEarly', wind: [0.9, 0.5, 2.5, 1] });
    yield;
    b.toon('netFrameW', merge(netFrameParts(4.7)), { ...OB, cap: 6, ink: 0.03 });
    yield;
    b.toon('netFrameWEdge', merge(netEdgeParts(4.7, 11)), { cap: 6, ink: 0, anim: 'popEarly', wind: [0.9, 0.5, 2.5, 1] });
    yield;
    b.toon('spar', merge(sparParts()), { ...OB, cap: 8, ink: 0.035 });
    yield;
    b.toon('sparL', mirrorX(merge(sparParts())), { ...OB, cap: 8, ink: 0.035 });
    yield;
    b.toon('sparCloth', merge(sparClothParts()), { cap: 8, ink: 0, anim: 'popEarly', side: THREE.DoubleSide, wind: [1.6, 0.6, 1.62, 1] });
    yield;
    b.toon('sparClothL', mirrorX(merge(sparClothParts())), { cap: 8, ink: 0, anim: 'popEarly', side: THREE.DoubleSide, wind: [1.6, 0.6, 1.62, 1] });
    yield;
    b.toon('sail', merge(sailParts(1.05, '#ffffff')), { ...OB, cap: 10, ink: 0.03 });
    yield;
    b.toon('sailEdge', merge(sailEdgeParts(1.05, 3, '#ffffff')), { cap: 10, ink: 0, anim: 'popEarly', side: THREE.DoubleSide, wind: [2.6, 0.9, 1.63, 1] });
    yield;
    b.toon('sailW', merge(sailParts(4.7, '#ffffff')), { ...OB, cap: 6, ink: 0.03 });
    yield;
    b.toon('sailWEdge', merge(sailEdgeParts(4.7, 9, '#ffffff')), { cap: 6, ink: 0, anim: 'popEarly', side: THREE.DoubleSide, wind: [2.6, 0.9, 1.63, 1] });
    yield;
    b.toon('pots', merge(potsParts(4)), { ...OB, cap: 12, ink: 0.03 });
    yield;
    b.toon('dinghy', merge(dinghyParts(3.0, 3, '#ffffff')), { ...OB, cap: 10, ink: 0.035 });
    yield;
    b.toon('dinghyTwin', merge(dinghyParts(4.8, 9, '#ffffff')), { ...OB, cap: 6, ink: 0.035 });
    yield;
    b.toon('teeth', merge(teethParts(3)), { ...OB, cap: 12, ink: 0.04 });
    yield;
    b.toon('teethFoam', merge(teethFoamParts(3)), { ...COAST, cap: 12, ink: 0, anim: 'popEarly', wobble: [0, 0.05, 2.2, 0] });
    yield;
    // (the great swells beside the causeway: scenery)
    b.toon('swell', surgeGeo(), { cap: 8, ink: 0, side: THREE.DoubleSide, surge: true, clear: 1 });
    yield;
  },

  // The door INTO this world (built into the shared doors, see world.js).
  door(b) {
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06, marks: [1, 1] });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', deco: coastLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  // (every spec it can deal, for World.markObstacles; obstaclesAt deals
  // them a stretch at a time)
  obstacles: {
    L: [S_WALL, S_DRIFT, S_CUT],
    H: [S_ARCH, S_NET, S_SPAR, S_SAIL],
    W: [S_POTS, S_DINGHY, S_TEETH],
    LW: [S_WASH, S_CUTW, S_WALLW, S_DRIFTW],
    HW: [S_ARCHW, S_NETW, S_SAILW],
    twin: { L: [S_DRIFT2], W: [S_DINGHY2] },
  },

  chunk(ctx) {
    const { rng } = ctx;
    const seg = ctx.seg;
    const S = stretches(seg);
    const d0 = ctx.d0;
    const L = CONFIG.chunkLength;
    const zone = zoneAt(S, d0 + 0.5);
    const p0 = d0 % 4096;
    const z = () => rng.float(0, L);
    ctx.put('sea', 0, SEA_Y, 0, { p0, p1: SHORE[zone] });
    if (zone === 'causeway') causewayChunk(ctx, S, rng, z, p0);
    else if (zone === 'landing') landingChunk(ctx, S, rng, z, p0);
    else grassChunk(ctx, S, rng, z, p0, zone);
    if (ctx.continuation) return;

    // out at sea: stacks, boats fishing with their lights lit, gulls
    // (well out, and no taller than a headland: dark shapes on the water,
    // not spires over the road)
    if (rng.chance(0.16)) ctx.put(rng.chance(0.5) ? 'stack' : 'stackB', (70 + rng.float(40, 120) * 0.6) * (zone === 'causeway' && rng.chance(0.4) ? -1 : 1), SEA_Y, z(), { ry: rng.float(0, TAU), s: rng.float(0.8, 1.5) * 0.65 });
    if (rng.chance(0.13)) {
      const side = zone === 'causeway' && rng.chance(0.45) ? -1 : 1;
      const x = side * rng.float(34, 95);
      const zz = z();
      const sc = rng.float(0.9, 1.2);
      ctx.put('boat', x, SEA_Y + 0.3, zz, { s: sc, c: rng.pick([C.boatBlue, C.boatRed, C.boatGreen, C.boatWhite]), p0: rng.float(0, TAU) });
      ctx.put('glow', x, SEA_Y + 2.6 * sc, zz, { s: 4.5, c: [1, 0.7, 0.4] });
      ctx.put('streak', x, SEA_Y + 0.05, zz, { sx: sc * 1.6, sz: sc * 1.4 });
      ctx.put('glow', x, SEA_Y + 6.6 * sc, zz, { s: 2.6, c: [1, 0.8, 0.5] });
    }
    if (rng.chance(0.14)) {
      const x = rng.float(10, 40) * (rng.chance(0.75) ? 1 : -1);
      const y = rng.float(7, 15);
      const zz = z();
      for (let i = rng.int(1, 3); i > 0; i--) ctx.put('gull', x + rng.float(-3, 3), y + rng.float(-1.5, 1.5), zz + rng.float(-3, 3), { ry: rng.float(0, TAU), s: rng.float(0.9, 1.2), p0: rng.float(0, TAU) });
    }
  },
};

// (a ground plane's uv in metres: x across, y along the run)
function uvMetres(g) {
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
  return g;
}

// --- the grass headland -------------------------------------------------------------
function grassChunk(ctx, S, rng, z, p0, zone) {
  const d0 = ctx.d0;
  const L = CONFIG.chunkLength;
  ctx.put('field', 0, 0, 0, { p0 });
  // where the land stops for the causeway, and where it starts again
  if (d0 + L === S.mouth) ctx.put('landEnd', 0, 0, L);
  if (d0 === S.grass) ctx.put('landEnd', 0, 0, 0, { ry: Math.PI });
  if (ctx.continuation) {
    for (let i = 0; i < 10; i++) ctx.put('grass', -rng.float(6, 30), landY(-15), z(), { s: rng.float(0.9, 1.3), ry: rng.float(-0.5, 0.5) });
    return;
  }
  // how dense and tall the grass grows: closing in either side over the
  // last stretch before the causeway
  const toMouth = S.mouth - d0;
  const thicket = zone === 'headland' && toMouth <= THICKET && toMouth > 0;
  for (const s of [-1, 1]) {
    // right along the path's edge
    for (let i = 0; i < 6; i++) ctx.put('grassLow', s * rng.float(3.9, 5.2), 0, z(), { s: rng.float(0.8, 1.3), ry: rng.float(0, TAU) });
    if (thicket) {
      // (fewer clumps, a little broader: as dense to the eye, lighter to draw)
      for (let i = 0; i < 22; i++) {
        const x = s * rng.float(4.5, s > 0 ? 10.5 : 14);
        ctx.put('grassTall', x, landY(x), z(), { s: rng.float(1.0, 1.35), sy: rng.float(1.0, 1.35), ry: rng.float(0, TAU) });
      }
      for (let i = 0; i < 8; i++) ctx.put('grass', s * rng.float(4.3, 5.4), 0, z(), { s: rng.float(0.9, 1.2), ry: rng.float(0, TAU) });
    } else {
      // the long grass: tufts near the path, the field running off
      for (let i = 0; i < (s > 0 ? 6 : 9); i++) {
        const x = s * rng.float(4.6, s > 0 ? 8.2 : 13);
        ctx.put('grass', x, landY(x), z(), { s: rng.float(0.85, 1.3), ry: rng.float(0, TAU) });
      }
      for (let i = 0; i < 6; i++) {
        const x = s * rng.float(s > 0 ? 7.5 : 12, s > 0 ? 10 : 32);
        ctx.put('grassFar', x, landY(x), z(), { s: rng.float(1, 1.5), ry: rng.float(0, TAU) });
      }
      if (rng.chance(0.3)) {
        const x = s * rng.float(5.6, 9);
        ctx.put('grassTall', x, landY(x), z(), { s: rng.float(0.9, 1.2), ry: rng.float(0, TAU) });
      }
    }
  }
  // inland (left): dry-stone walls across the fields, the odd old post
  if (rng.chance(0.38)) {
    const x = -rng.float(12, 26);
    ctx.put('fieldWall', x, landY(x), z(), { ry: rng.float(-0.4, 0.4), s: rng.float(0.9, 1.2) });
  }
  if (!thicket && rng.chance(0.22)) {
    const x = -rng.float(5.4, 7.5);
    const zz = z();
    ctx.put('post', x, 0, zz, { ry: rng.float(0, TAU) });
    ctx.put('ropeEnd', x, 0, zz, { ry: rng.float(0, TAU) });
  }
  if (!thicket && rng.chance(0.2)) {
    const x = rng.chance(0.5) ? -rng.float(5.5, 9) : rng.float(5.5, 9.5);
    ctx.put('driftSmall', x, landY(x), z(), { ry: rng.float(0, TAU), s: rng.float(0.8, 1.1) });
  }
  // the seaward side: over the brow, rocks down to the sea, the swell
  // breaking on them
  for (let i = 0; i < 3; i++) {
    const x = rng.float(11.5, 17);
    ctx.put(rng.chance(0.5) ? 'rockA' : 'rockB', x, landY(x) - 0.3, z(), { ry: rng.float(0, TAU), s: rng.float(0.9, 1.8) });
  }
  if (ctx.index % 2 === 0) ctx.put(rng.chance(0.6) ? 'breaker' : 'breakerB', 15.6, 0, z(), { p0: rng.float(0, TAU), s: rng.float(1.0, 1.25) });
}

// --- the causeway -------------------------------------------------------------------
function causewayChunk(ctx, S, rng, z, p0) {
  const d0 = ctx.d0;
  ctx.put('deck', 0, 0, 0, { p0 });
  ctx.put(rng.chance(0.5) ? 'side' : 'sideB', 0, 0, 0);
  if (ctx.continuation) return;
  // black rocks heaped against its walls both sides
  for (const s of [-1, 1]) {
    ctx.put(rng.chance(0.5) ? 'rockPile' : 'rockPileB', s * rng.float(5.7, 6.3), 0, 0, { ry: s < 0 ? Math.PI : 0 });
    if (s < 0) ctx.put('rockPileB', -6.0, 0, 0);
    // the swell striking them, bursting into spray, draining back (one at a
    // time along each wall, out at sea beyond it)
    if (rng.chance(0.6)) ctx.put(rng.chance(0.55) ? 'breaker' : 'breakerB', s * rng.float(6.3, 6.9), 0, z(), { p0: rng.float(0, TAU), s: rng.float(0.95, 1.2) });
    if (rng.chance(0.35)) {
      const x = s * rng.float(8, 14);
      ctx.put(rng.chance(0.5) ? 'rockA' : 'rockB', x, SEA_Y + 0.4, z(), { ry: rng.float(0, TAU), s: rng.float(1.2, 2.2) });
    }
  }
  // the great wave, alongside you as you come out of the grass
  if (d0 === S.mouth + CONFIG.chunkLength) ctx.put('bigBreaker', -7.6, 0, BIG_AHEAD - CONFIG.chunkLength, { p0: 0, p1: 0, s: 1.3 });
  // and further out, now and then, a great swell rearing up beside the
  // causeway as you come alongside it and pitching over its wall (scenery:
  // it never comes into a lane)
  else if (d0 > S.mouth + CONFIG.chunkLength * 3 && d0 < S.landing - CONFIG.chunkLength * 2 && rng.chance(0.3)) {
    const s = rng.chance(0.5) ? -1 : 1;
    ctx.put('swell', s * 4.5, 0, z(), { p0: 0, p1: 0 });
  }
}

// --- the fishing landing ---------------------------------------------------------
function landingChunk(ctx, S, rng, z, p0) {
  const d0 = ctx.d0;
  ctx.put('boards', 0, 0, 0, { p0 });
  ctx.put('fieldL', 0, 0, 0, { p0 });
  ctx.put('quay', 0, 0, 0);
  if (ctx.continuation) return;
  // bollards along the quay's edge, a boat or two moored off it
  if (ctx.index % 2 === 0) ctx.put('bollard', 5.75, 0, rng.float(2, 14));
  if (rng.chance(0.4)) {
    const zz = z();
    ctx.put('skiff', rng.float(8.5, 11), SEA_Y + 0.25, zz, { ry: rng.float(-0.4, 0.4) + Math.PI / 2, c: rng.pick([C.boatBlue, C.boatRed, C.boatGreen]), p0: rng.float(0, TAU) });
  }
  if (rng.chance(0.25)) {
    const x = rng.float(16, 26);
    const zz = z();
    ctx.put('boat', x, SEA_Y + 0.3, zz, { s: 0.85, ry: rng.float(0, TAU), c: rng.pick([C.boatBlue, C.boatRed, C.boatWhite]), p0: rng.float(0, TAU) });
    ctx.put('glow', x, SEA_Y + 2.3, zz, { s: 4, c: [1, 0.7, 0.4] });
    ctx.put('streak', x, SEA_Y + 0.05, zz, { sx: 1.3, sz: 1.1 });
  }
  if (rng.chance(0.4)) ctx.put('breaker', 7.2, 0, z(), { p0: rng.float(0, TAU), s: 0.8 });
  // the landward side, sparingly: a derelict hut, a stack of pots, an
  // upturned boat, a rack of nets drying, old posts, the grass growing
  // back over it all
  const pick = rng.weighted([[null, 2.4], ['hut', 1], ['potStack', 1], ['upturned', 0.8], ['netRack', 0.9]]);
  if (pick === 'hut') ctx.put('hut', -rng.float(11, 14), 0.6, rng.float(3, 13), { ry: rng.float(-0.3, 0.3) + Math.PI / 2 });
  else if (pick === 'potStack') ctx.put('potStack', -rng.float(6.8, 8.5), 0.2, z(), { ry: rng.float(0, TAU) });
  else if (pick === 'upturned') ctx.put('upturned', -rng.float(7.5, 10), 0.4, z(), { ry: rng.float(0, TAU) });
  else if (pick === 'netRack') {
    const x = -rng.float(7.5, 9.5);
    const zz = z();
    const ry = Math.PI / 2 + rng.float(-0.3, 0.3);
    ctx.put('netRack', x, 0.3, zz, { ry });
    ctx.put('netRackEdge', x, 0.3, zz, { ry });
  }
  if (rng.chance(0.3)) {
    const x = -rng.float(6.4, 7.2);
    const zz = z();
    ctx.put('post', x, 0.1, zz);
    ctx.put('ropeEnd', x, 0.1, zz, { ry: rng.float(0, TAU) });
  }
  for (let i = 0; i < 6; i++) {
    const x = -rng.float(6.2, 16);
    ctx.put(i < 3 ? 'grassLow' : 'grass', x, landingY(x), z(), { s: rng.float(0.8, 1.2), ry: rng.float(0, TAU) });
  }
  for (let i = 0; i < 4; i++) {
    const x = -rng.float(16, 34);
    ctx.put('grassFar', x, landingY(x), z(), { s: rng.float(1, 1.5), ry: rng.float(0, TAU) });
  }
  if (d0 === S.landing) {
    ctx.put('landEndL', 0, 0, 0);
    // where the causeway comes ashore, rocks piled at the corner
    for (const s of [-1, 1]) ctx.put('rockA', s * 6.6, -1.2, 0.5, { s: 1.6, ry: rng.float(0, TAU) });
  }
}
