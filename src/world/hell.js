import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, rockParts, gateFrameParts, gateTop, leafParts } from './shapes.js';
import { crystal, stone, crystalPoint, nugget, lumps, point, hexPrism, rough } from './gems.js';
import { CONFIG } from '../config.js';

// VII · Hell — fire and brimstone, and above all emptiness: a plain of dark
// ash and cinders that runs out to the edge of the world under a ceiling of
// smoke, a pale road of bone-white ash through it, the crust split by glowing
// fissures beyond. Black basalt columns, jagged spires, pools and rivers of
// lava that seethe and splash, far-off volcanoes throwing up fountains of
// fire. And it is haunted: pale hooded souls drift over the plain, the ribs
// of colossal dead things arch up out of the ash, gibbet cages creak on
// crooked posts beside the road, dead trees claw at the smoke, people on fire
// stand and sit at the road's edge and turn to watch you pass, and dry
// lightning flickers in it, now and then forking down to the plain and
// lighting everything for an instant. Embers rise and ash falls all the time.
//
// Seen through its doorway it burns in reds and blacks; come through and its
// colour is sapped away (env.drain, see game.js) until only what burns — the
// lava, the fissures, the cracks glowing in the rock, the embers, the eyes of
// the souls, and the runner's orange cape — keeps any colour: the rest is
// black, grey and white. The road is kept pale and the rock dark, ashen on
// top and veined with fire, so the obstacles and the dark stones read at a
// glance. Leave, and the colour wells back up out of the next doorway.
//
// Every rock, beam and shard here is textured in the shader (toon option
// `crust`): basalt pitted and laid down in strata, charred timber split into
// glowing blocks, obsidian rippled like broken glass — each cracked with fire
// and dusted with ash on top.
//
// Obstacles: low basalt ridges and lava fissures to jump (you can't land in
// the lava), charred beams on basalt posts to slide under, basalt columns and
// obsidian shards to go around; a fissure across the whole road and a long
// charred beam are the wide ones.

const C = {
  ashA: '#1e1816',
  ashB: '#2c2421',
  cinder: '#0e0a09',
  basalt: '#1a1412',
  basaltHi: '#4a3c36',
  basaltTop: '#8a7e76',
  char: '#16100e',
  charHi: '#3c2a24',
  obsidian: '#0e0a0e',
  obsidianHi: '#4a3a48',
  ember: '#ff6a1a',
  emberHot: '#ffb347',
  lava: '#ff5a14',
  smokeLo: '#100a09',
  smokeHi: '#3a2c28',
  bone: '#c8beb0',
  boneLo: '#4a423c',
  soul: '#e8e4de',
  soulLo: '#8a8580',
  iron: '#24201e',
};
// the kinds of crust (the part's mark flag picks one, see CRUST in the shaders)
const CHAR = 0.5;
const GLASS = 1;

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

// A cluster of hexagonal basalt columns, ash settled on their flat tops.
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
    parts.push(part(P.cyl(rr, rr * 1.05, h, 6, 3), null, { x, y: h / 2, z, ry: rnd(), grad: [C.basalt, C.basaltHi, 0, h * 1.1] }));
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
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.8;
    parts.push(part(P.box(0.9 + rnd() * 0.6, 0.3, 16), i % 2 ? C.emberHot : C.ember, { x: Math.cos(a) * 13, y: 15, z: Math.sin(a) * 13, ry: -a + Math.PI / 2, rx: 0.65, emit: 1, outline: 0 }));
  }
  return merge(parts);
}

function smokeGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const r = 3 + i * 1.5;
    parts.push(part(P.sphere(r, 9, 7), null, { x: Math.sin(i * 1.3) * 2.5 + rnd() * 2, y: i * 4.4, z: rnd() * 2, sy: 0.75, grad: [C.smokeLo, C.smokeHi, i * 4.4 - r, i * 4.4 + r] }));
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

// A dead tree, charred black, its branches clawing up and out, each forking
// into twigs.
function deadTreeGeo(seed, h = 3.4, n = 5) {
  const rnd = seeded(seed);
  const lean = (rnd() - 0.5) * 0.2;
  const parts = [part(P.cyl(0.1, 0.28, h, 6, 3), null, { y: h / 2, rz: lean, grad: [C.char, C.charHi, 0, h], mark: CHAR })];
  for (let i = 0; i < n; i++) {
    const y = h * (0.42 + (0.55 * i) / n);
    const a = rnd() * Math.PI * 2;
    const len = (1.5 - i * 0.18) * (h / 3.4);
    const tilt = 0.7 + rnd() * 0.5;
    const bx = Math.cos(a) * Math.sin(tilt) * len * 0.5;
    const bz = Math.sin(a) * Math.sin(tilt) * len * 0.5;
    const by = y + Math.cos(tilt) * len * 0.5;
    parts.push(part(P.cyl(0.025, 0.08, len, 5), C.char, { x: bx - lean * y, y: by, z: bz, ry: -a, rz: tilt, mark: CHAR }));
    // a forked twig off the end, crooked back up
    const tx = Math.cos(a) * Math.sin(tilt) * len * 0.95;
    const tz = Math.sin(a) * Math.sin(tilt) * len * 0.95;
    const ty = y + Math.cos(tilt) * len * 0.95;
    parts.push(part(P.cyl(0.012, 0.03, len * 0.5, 4), C.char, { x: tx - lean * y, y: ty + len * 0.18, z: tz, ry: -a + 0.6, rz: tilt - 0.9, mark: CHAR, outline: 0.6 }));
  }
  return merge(parts);
}

// A lost soul: a pale hooded shroud hung from its head (the origin), the robe
// tapering away below into a wisp that trails and sways, its sleeves hanging
// empty, its face a dark hollow with two embers for eyes.
function wraithGeo() {
  const prof = [[0.0, -2.5], [0.07, -2.2], [0.18, -1.8], [0.3, -1.3], [0.4, -0.85], [0.36, -0.42], [0.27, -0.14], [0.31, 0.05], [0.25, 0.26], [0.12, 0.38], [0.0, 0.42]];
  const parts = [part(P.lathe(prof, 12), null, { grad: [C.soulLo, C.soul, -2.5, 0.4], emit: 0.45 })];
  // the hood's hollow
  parts.push(part(P.sphere(0.2, 10, 8), '#050404', { y: 0.05, z: 0.17, sx: 0.85, sy: 1.05, sz: 0.55, outline: 0 }));
  for (const s of [-1, 1]) {
    parts.push(part(P.sphere(0.028, 6, 4), C.emberHot, { x: s * 0.065, y: 0.08, z: 0.255, emit: 1, outline: 0 }));
    // empty sleeves, hanging
    parts.push(part(P.cone(0.13, 0.85, 7), null, { x: s * 0.36, y: -0.62, z: 0.08, rz: s * 0.28, rx: 0.25, grad: [C.soulLo, C.soul, -1.0, -0.2], emit: 0.4 }));
  }
  return merge(parts);
}

// The ribs of some colossal dead thing arching up out of the ash, a spine
// along the top, the bones' feet buried in cinders.
function ribcageGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const k = 1 - i * 0.09;
    const W = 4.6 * k + (rnd() - 0.5) * 0.3;
    const H = 7.2 * k;
    const z = -i * 1.9;
    for (const s of [-1, 1]) {
      const pts = [
        [s * W * 0.95, -0.8],
        [s * W * 1.04, H * 0.3],
        [s * W * 0.88, H * 0.66],
        [s * W * 0.5, H * 0.93],
        [s * 0.4, H],
      ].map(([x, y]) => new THREE.Vector3(x, y, z + (rnd() - 0.5) * 0.2));
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.26 * k + 0.06, 6);
      parts.push(part(g, null, { grad: [C.boneLo, C.bone, -0.8, H] }));
    }
    // a vertebra and its spine
    parts.push(part(P.box(0.9 * k + 0.3, 0.6, 1.1), null, { y: H + 0.1, z, grad: [C.boneLo, C.bone, H - 0.3, H + 0.4] }));
    parts.push(part(P.cone(0.2, 1.1 * k + 0.3, 4), C.bone, { y: H + 0.85, z: z + 0.2, rx: -0.5 }));
  }
  return merge(parts);
}

// A gibbet: a crooked post of charred timber with an arm out over the road
// and a chain hanging from it (the cage is its own swinging batch).
const GIBBET_ARM = 2.1;
const GIBBET_H = 6.2;
function gibbetPostGeo() {
  const parts = [
    part(P.box(0.3, GIBBET_H + 0.3, 0.3, 1, 4, 1), null, { y: (GIBBET_H + 0.3) / 2, rz: 0.04, grad: [C.char, C.charHi, 0, GIBBET_H], mark: CHAR }),
    part(P.box(GIBBET_ARM + 0.5, 0.26, 0.26), C.charHi, { x: GIBBET_ARM / 2, y: GIBBET_H, mark: CHAR }),
    part(P.box(0.16, 1.5, 0.16), C.char, { x: 0.5, y: GIBBET_H - 0.55, rz: -0.75, mark: CHAR }),
    ...basaltRock({ r: 0.45, sy: 0.5, seed: 3 }),
    ...basaltRock({ r: 0.3, sy: 0.5, seed: 8 }).map((g) => g.translate(0.4, 0, 0.3)),
  ];
  return merge(parts);
}
// The cage, hung from its pivot (the origin): a chain, a dome of iron straps
// and a ring of bars, and inside it what's left of someone.
function gibbetCageGeo() {
  const parts = [];
  for (let i = 0; i < 6; i++) parts.push(part(P.torus(0.07, 0.022, 4, 8), C.iron, { y: -0.1 - i * 0.17, ry: (i % 2) * Math.PI / 2, outline: 0.5 }));
  const top = -1.2;
  const bot = -3.0;
  const R = 0.55;
  parts.push(part(P.cone(R + 0.03, 0.45, 8, 1), C.iron, { y: top + 0.18 }));
  for (const y of [top - 0.05, bot + 0.05, (top + bot) / 2]) parts.push(part(P.torus(R, 0.035, 4, 16), C.iron, { y, rx: Math.PI / 2 }));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push(part(P.cyl(0.022, 0.022, top - bot, 4), C.iron, { x: Math.cos(a) * R, y: (top + bot) / 2, z: Math.sin(a) * R, outline: 0.5 }));
  }
  parts.push(part(P.cyl(R, R, 0.05, 12), C.iron, { y: bot }));
  // bones: a skull slumped on the floor of the cage, ribs, a long bone
  parts.push(part(P.sphere(0.15, 10, 8), C.bone, { x: 0.12, y: bot + 0.18, z: 0.1, sy: 1.1 }));
  parts.push(part(P.sphere(0.06, 6, 4), '#050404', { x: 0.17, y: bot + 0.2, z: 0.23, outline: 0 }));
  parts.push(part(P.sphere(0.06, 6, 4), '#050404', { x: 0.05, y: bot + 0.2, z: 0.24, outline: 0 }));
  parts.push(part(P.cyl(0.03, 0.03, 0.7, 5), C.bone, { x: -0.15, y: bot + 0.12, rz: 1.3, ry: 0.4 }));
  for (let i = 0; i < 3; i++) parts.push(part(P.torus(0.16, 0.02, 4, 8, Math.PI), C.bone, { x: -0.05, y: bot + 0.32 + i * 0.1, z: -0.12, rx: 0.3 }));
  return merge(parts);
}

// --- the burning ------------------------------------------------------------------
// People on fire beside the road: gaunt, hairless, sexless figures charred
// black, the fire showing through the cracks in their skin, two embers where
// their eyes were, flames streaming up off their backs and shoulders. Some
// stand, their arms hanging - one holds a hand out toward the road - and some
// sit in the ash with their arms round their knees. Each is built facing +z
// with its head hung forward; as you come it lifts its head and turns to
// watch you, and goes on watching as you pass (toon option `watch`: the head
// is role 1, and so is whatever burns on it).
const SKIN = ['#0c0807', '#3a2a24'];
const _up = new THREE.Vector3(0, 1, 0);
function asRole(g, k) {
  g.setAttribute('role', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1));
  return g;
}
// a length of limb from a to b (its radius at each), a joint at b
function limb(parts, a, b, ra, rb, top, joint = true) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const len = d.length();
  const g = P.cyl(rb, ra, len, 7, 2);
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()), new THREE.Vector3(1, 1, 1)));
  parts.push(part(g, null, { grad: [...SKIN, 0, top], mark: CHAR }));
  if (joint) parts.push(part(P.sphere(rb * 1.08, 7, 5), null, { x: b[0], y: b[1], z: b[2], grad: [...SKIN, 0, top], mark: CHAR }));
}
// a hand: a narrow palm and long thin fingers, hanging (or held out) along dir
function hand(parts, at, dir, top, spread = 0.12) {
  const D = new THREE.Vector3(...dir).normalize();
  const tip = (k) => [at[0] + D.x * k, at[1] + D.y * k, at[2] + D.z * k];
  limb(parts, at, tip(0.075), 0.03, 0.034, top, false);
  const side = new THREE.Vector3().crossVectors(D, Math.abs(D.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : _up).normalize();
  for (let i = -1; i <= 1; i++) {
    const a = tip(0.07);
    const b = tip(0.2 - Math.abs(i) * 0.02);
    for (let k = 0; k < 3; k++) {
      a[k] += side.getComponent(k) * i * 0.016;
      b[k] += side.getComponent(k) * i * spread * 0.35;
    }
    limb(parts, a, b, 0.012, 0.006, top, false);
  }
}
// the head, on its neck at [0, y, z]: a smooth skull, hollow sockets, an
// ember in each
function headParts(parts, y, z, top, tilt = 0) {
  const out = [];
  out.push(part(P.sphere(0.112, 12, 10), null, { y: y + 0.125, z: z + 0.012, sx: 0.9, sy: 1.2, sz: 1.02, rz: tilt, grad: [...SKIN, 0, top], mark: CHAR }));
  // the jaw, narrow and long
  out.push(part(P.sphere(0.075, 9, 7), null, { y: y + 0.05, z: z + 0.04, sx: 0.85, sy: 1.1, sz: 0.95, rz: tilt, grad: [...SKIN, 0, top], mark: CHAR }));
  for (const sd of [-1, 1]) {
    const ex = sd * 0.04 - tilt * 0.12;
    out.push(part(P.sphere(0.036, 8, 6), '#020101', { x: ex, y: y + 0.13, z: z + 0.094, sz: 0.5, outline: 0 }));
    // (not quite fully self-lit, so the flames' flicker leaves the eyes be)
    out.push(part(P.sphere(0.021, 7, 5), '#ffd070', { x: ex, y: y + 0.128, z: z + 0.108, emit: 0.94, outline: 0 }));
  }
  // a dark gape of a mouth
  out.push(part(P.sphere(0.024, 7, 5), '#020101', { x: -tilt * 0.06, y: y + 0.04, z: z + 0.105, sy: 1.5, sz: 0.4, outline: 0 }));
  for (const g of out) parts.push(asRole(g, 1));
}
// A tongue of fire rising from `at`, leaning (rx back, rz aside), its tip
// deep red (or white-hot yellow, a core). uv: x its own beat, y how far up
// it (the lathe's own v).
function fireTongue(parts, at, h, r, { rx = 0, rz = 0, seed = 0, hot = false, role = 0 } = {}) {
  const prof = [[0, 0], [r * 0.7, h * 0.07], [r, h * 0.2], [r * 0.9, h * 0.36], [r * 0.62, h * 0.55], [r * 0.34, h * 0.74], [r * 0.14, h * 0.9], [0, h]];
  const g = part(P.lathe(prof, 7), null, {
    x: at[0], y: at[1], z: at[2], rx, rz,
    grad: hot ? ['#fff6c0', '#ffa828', at[1], at[1] + h * 0.8] : ['#ffa024', '#f03c0c', at[1] + h * 0.1, at[1] + h * 0.9],
    emit: 1, outline: 0,
  });
  const uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i += 2) uv[i] = seed;
  parts.push(asRole(g, role));
}
// a lick of flame come loose above a tongue
function fireLick(parts, at, r, seed, role = 0) {
  const g = part(P.lathe([[0, 0], [r, r * 0.9], [r * 0.55, r * 2.2], [0, r * 3.6]], 6), '#ff7a1a', { x: at[0], y: at[1], z: at[2], emit: 1, outline: 0 });
  const uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = seed;
    uv[i + 1] = 0.75 + uv[i + 1] * 0.25;
  }
  parts.push(asRole(g, role));
}
// the fire on a figure: [x, y, z, height, radius, lean back, lean aside, hot,
// on the head], and a lick loose above each of the big ones
function fire(parts, list, seed) {
  const rnd = seeded(seed);
  for (const [x, y, z, h, r, rx = 0, rz = 0, hot = 0, role = 0] of list) {
    const beat = rnd();
    fireTongue(parts, [x, y, z], h, r, { rx: -rx, rz, seed: beat, hot: !!hot, role });
    if (h > 0.7 && !hot) {
      const k = 1.08 + rnd() * 0.12;
      fireLick(parts, [x - Math.sin(rz) * h * k + (rnd() - 0.5) * 0.1, y + Math.cos(rx) * Math.cos(rz) * h * k, z - Math.sin(rx) * h * k], r * 0.3, beat + 0.07, role);
    }
  }
}

const STAND_NECK = [1.56, 0];
// Standing: reach - one hand held out toward whoever it's looking at.
function burningStandGeo(reach, seed) {
  const H = 1.86;
  const parts = [];
  for (const s of [-1, 1]) {
    // legs, a little apart, and long narrow feet
    limb(parts, [s * 0.09, 0.93, 0], [s * 0.105, 0.5, 0.025], 0.074, 0.052, H);
    limb(parts, [s * 0.105, 0.5, 0.025], [s * 0.11, 0.07, -0.01], 0.05, 0.034, H);
    parts.push(part(P.sphere(0.05, 8, 6), null, { x: s * 0.115, y: 0.035, z: 0.06, sx: 0.85, sy: 0.6, sz: 2.3, grad: [...SKIN, 0, H], mark: CHAR }));
    // arms too long for the body, the shoulders rolled forward
    const sh = [s * 0.195, 1.43, 0.015];
    parts.push(part(P.sphere(0.06, 8, 6), null, { x: sh[0], y: sh[1], z: sh[2], grad: [...SKIN, 0, H], mark: CHAR }));
    if (reach && s > 0) {
      limb(parts, sh, [0.25, 1.24, 0.2], 0.045, 0.036, H);
      limb(parts, [0.25, 1.24, 0.2], [0.2, 1.3, 0.5], 0.034, 0.026, H);
      hand(parts, [0.2, 1.3, 0.5], [-0.1, 0.05, 1], H, 0.3);
    } else {
      limb(parts, sh, [s * 0.235, 1.1, -0.01], 0.045, 0.036, H);
      limb(parts, [s * 0.235, 1.1, -0.01], [s * 0.225, 0.8, 0.05], 0.034, 0.026, H);
      hand(parts, [s * 0.225, 0.8, 0.05], [0, -1, 0.12], H);
    }
  }
  // the trunk: narrow, straight, a little hollow under the ribs
  const trunk = [[0, 0.86], [0.1, 0.875], [0.132, 0.94], [0.128, 1.04], [0.11, 1.16], [0.128, 1.3], [0.15, 1.41], [0.13, 1.475], [0.06, 1.51], [0, 1.52]];
  parts.push(part(P.lathe(trunk, 10), null, { sz: 0.66, grad: [...SKIN, 0, H], mark: CHAR }));
  limb(parts, [0, 1.48, 0], [0, 1.6, 0.012], 0.046, 0.04, H, false);
  headParts(parts, STAND_NECK[0], STAND_NECK[1], H, reach ? -0.16 : 0.1);
  // prettier-ignore
  fire(parts, [
    [0, 1.2, -0.1, 1.5, 0.22, 0.32, 0.04],
    [-0.2, 1.36, -0.05, 1.05, 0.16, 0.22, 0.3],
    [0.2, 1.36, -0.05, 0.9, 0.15, 0.3, -0.26],
    [0.05, 0.9, -0.1, 0.95, 0.17, 0.5, -0.1],
    [-0.09, 1.3, -0.14, 0.8, 0.11, 0.26, 0.1, 1],
    [0.1, 1.36, -0.13, 0.6, 0.09, 0.36, -0.14, 1],
    [0, 1.74, -0.06, 0.6, 0.1, 0.34, 0, 0, 1],
    [0.02, 1.76, -0.09, 0.34, 0.06, 0.4, 0.1, 1, 1],
    [-0.24, 0.92, -0.02, 0.5, 0.085, 0.2, 0.22],
    ...(reach ? [[0.23, 1.28, 0.34, 0.42, 0.07, 0.25, -0.1], [0.22, 1.3, 0.42, 0.24, 0.045, 0.2, 0, 1]] : [[0.24, 0.95, -0.02, 0.44, 0.08, 0.24, -0.2]]),
    [-0.12, 0.3, -0.06, 0.5, 0.09, 0.3, 0.12],
    [0.13, 0.12, -0.08, 0.42, 0.1, 0.36, -0.1],
    [-0.02, 0.0, -0.2, 0.3, 0.1, 0.2, 0],
  ], seed);
  return merge(parts);
}

const SIT_NECK = [0.79, 0.02];
// Sitting in the ash, knees drawn up, arms wrapped round them, hunched.
function burningSitGeo(seed) {
  const H = 1.05;
  const parts = [];
  for (const s of [-1, 1]) {
    const hip = [s * 0.1, 0.11, -0.19];
    const knee = [s * 0.13, 0.53, 0.2];
    limb(parts, hip, knee, 0.076, 0.054, H);
    limb(parts, knee, [s * 0.12, 0.07, 0.41], 0.05, 0.034, H);
    parts.push(part(P.sphere(0.05, 8, 6), null, { x: s * 0.125, y: 0.035, z: 0.49, sx: 0.85, sy: 0.6, sz: 2.3, grad: [...SKIN, 0, H], mark: CHAR }));
    const sh = [s * 0.185, 0.67, -0.02];
    parts.push(part(P.sphere(0.06, 8, 6), null, { x: sh[0], y: sh[1], z: sh[2], grad: [...SKIN, 0, H], mark: CHAR }));
    // arms round the shins, the forearms crossed
    const elbow = [s * 0.225, 0.46, 0.21];
    const wrist = [-s * 0.05, 0.4 + s * 0.035, 0.36];
    limb(parts, sh, elbow, 0.045, 0.036, H);
    limb(parts, elbow, wrist, 0.034, 0.026, H);
    hand(parts, wrist, [-s, -0.5, -0.1], H);
  }
  parts.push(part(P.sphere(0.15, 9, 7), null, { y: 0.13, z: -0.2, sy: 0.75, grad: [...SKIN, 0, H], mark: CHAR }));
  // the trunk, bent forward over the knees
  const trunk = [[0, 0], [0.12, 0.02], [0.13, 0.12], [0.112, 0.27], [0.13, 0.42], [0.15, 0.53], [0.13, 0.6], [0.06, 0.635], [0, 0.645]];
  parts.push(part(P.lathe(trunk, 10), null, { y: 0.09, z: -0.21, rx: 0.3, sz: 0.7, grad: [...SKIN, 0, H], mark: CHAR }));
  limb(parts, [0, 0.7, -0.03], [0, 0.82, 0.03], 0.046, 0.04, H, false);
  headParts(parts, SIT_NECK[0], SIT_NECK[1], H, 0.08);
  // prettier-ignore
  fire(parts, [
    [0, 0.42, -0.26, 1.45, 0.23, 0.28, 0.06],
    [-0.19, 0.6, -0.12, 1.0, 0.16, 0.2, 0.3],
    [0.19, 0.6, -0.12, 0.85, 0.15, 0.3, -0.24],
    [0.04, 0.12, -0.34, 0.9, 0.18, 0.55, -0.1],
    [-0.08, 0.52, -0.24, 0.75, 0.11, 0.24, 0.1, 1],
    [0.1, 0.56, -0.22, 0.55, 0.09, 0.34, -0.14, 1],
    [0, 0.96, -0.04, 0.55, 0.1, 0.32, 0, 0, 1],
    [0.02, 0.98, -0.07, 0.32, 0.06, 0.4, 0.1, 1, 1],
    [-0.24, 0.4, 0.1, 0.42, 0.08, 0.2, 0.2],
    [0.25, 0.42, 0.08, 0.36, 0.075, 0.25, -0.2],
    [-0.2, 0.0, -0.3, 0.4, 0.11, 0.3, 0.2],
    [0.14, 0.5, 0.2, 0.3, 0.06, 0.1, 0],
  ], seed);
  return merge(parts);
}

// Where they are along a stretch of Hell: nine of them, spread from just
// inside the door in to just short of the door out, now one side of the road
// and now the other, right at its edge. Each chunk asks whether one of them
// is in it (index: the chunk's, count: how many chunks the stretch is long).
const BURNING = 9;
const BURNING_KINDS = ['burningStand', 'burningSit', 'burningReach', 'burningSit', 'burningStand', 'burningSit', 'burningReach', 'burningStand', 'burningSit'];
const BURNING_SIDES = [1, -1, -1, 1, -1, 1, 1, -1, 1];
function burningIn(index, count, start, visit) {
  const span = count - 7;
  if (span < BURNING) return null;
  const rnd = seeded(1 + (Math.abs(Math.round(start / 16)) * 131 + visit * 17) % 9973);
  rnd();
  const turn = Math.floor(rnd() * BURNING);
  const flip = rnd() < 0.5 ? -1 : 1;
  for (let k = 0; k < BURNING; k++) {
    const jitter = rnd();
    const u = [rnd(), rnd(), rnd(), rnd()];
    if (3 + Math.floor(((k + 0.2 + jitter * 0.6) * span) / BURNING) !== index) continue;
    const name = BURNING_KINDS[(k + turn) % BURNING];
    const sit = name === 'burningSit';
    const side = BURNING_SIDES[k] * flip;
    // nearer the road every time you come back
    const off = (sit ? 5.0 : 5.1) + u[0] * (visit ? 0.5 : 1.1);
    // turned toward the road, anywhere from facing you as you come to
    // facing well away down it
    const away = sit ? 0.35 + u[1] * 1.3 : 0.3 + u[1] * 2.1;
    return { name, sit, side, x: side * off, z: 3 + u[2] * 10, ry: -side * away, s: sit ? 1.2 + u[3] * 0.25 : 1.12 + u[3] * 0.25 };
  }
  return null;
}

// Lava splashing (see SPLASH in the shaders): every so often a spot in the
// lava bursts — a crown of droplets thrown up and out from it together, and
// a fat blob leaping up through the middle — then falls back in; each burst
// at its own spot (within an ellipse rx by rz, centred at cz) and its own
// pace, the droplets hot yellow, orange and deep red, stretched along their
// flight.
function splashGeo({ bursts = 3, n = 6, rx = 1, rz = 0.7, cz = 0, up = [3.5, 6], out = 1.4, size = [0.08, 0.18], period = [1.4, 2.6], seed = 1 } = {}) {
  const rnd = seeded(seed);
  const hot = ['#fff0a0', '#ffc04a', '#ff8a1a', '#ff5a14', '#e8320a'];
  const parts = [];
  const drop = (r, color, launch, vel) => {
    const g = part(P.ico(r, 1), color, { emit: 1, outline: 0 });
    const cnt = g.attributes.position.count;
    const A = new Float32Array(cnt * 4);
    const B = new Float32Array(cnt * 4);
    for (let k = 0; k < cnt; k++) {
      A.set(launch, k * 4);
      B.set(vel, k * 4);
    }
    g.setAttribute('spA', new THREE.BufferAttribute(A, 4));
    g.setAttribute('spB', new THREE.BufferAttribute(B, 4));
    parts.push(g);
  };
  for (let b = 0; b < bursts; b++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd());
    const launch = [Math.cos(a) * d * rx, 0.06, cz + Math.sin(a) * d * rz, rnd()];
    const per = period[0] + rnd() * (period[1] - period[0]);
    const vy = up[0] + rnd() * (up[1] - up[0]);
    const spin = rnd() * Math.PI * 2;
    // the crown
    for (let i = 0; i < n; i++) {
      const oa = spin + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const o = out * (0.6 + rnd() * 0.5);
      const r = size[0] + rnd() * (size[1] - size[0]) * 0.7;
      drop(r, hot[1 + Math.floor(rnd() * 4)], launch, [Math.cos(oa) * o, vy * (0.55 + rnd() * 0.3), Math.sin(oa) * o, per]);
    }
    // the blob through the middle, and a hot little one after it
    drop(size[1] * (1.1 + rnd() * 0.3), hot[Math.floor(rnd() * 2)], launch, [(rnd() - 0.5) * out * 0.3, vy * 1.2, (rnd() - 0.5) * out * 0.3, per]);
    drop(size[0] * 1.2, hot[0], launch, [(rnd() - 0.5) * out * 0.4, vy * 0.95, (rnd() - 0.5) * out * 0.4, per]);
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
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.4;
    parts.push(...basaltRock({ r: 0.25 + rnd() * 0.35, sy: 0.5, seed: seed + i }).map((g) => g.translate(Math.cos(a) * 4.5, -0.1, Math.sin(a) * 3.0)));
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
// L · A low ridge of black basalt across one lane, ash on its crest, fire in
// its cracks and glowing at its foot.
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
// the lava in a fissure spitting: low, so a jump over it is never in doubt
const fissureSplashGeo = (half, seed) => splashGeo({ bursts: Math.max(1, Math.round(half * 1.4)), n: 5, rx: half * 0.85, rz: 0.4, cz: -FISSURE_W / 2, up: [3, 4.2], out: 0.7, size: [0.06, 0.14], seed });

// H · A charred beam on two basalt posts, its underside on the duck line,
// split into glowing blocks along its grain, embers in its cracks.
function beamGeo(half) {
  const D = CONFIG.duckLine;
  const bh = 0.46;
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.cyl(0.24, 0.3, D + bh + 0.3, 6, 3), null, { x: s * half, y: (D + bh + 0.3) / 2, grad: [C.basalt, C.basaltHi, 0, D + bh + 0.3] }));
    parts.push(part(P.cyl(0.25, 0.25, 0.06, 6), C.basaltTop, { x: s * half, y: D + bh + 0.33, outline: 0.5 }));
  }
  parts.push(part(P.box(half * 2 + 0.5, bh, 0.46, Math.max(2, Math.round(half * 4)), 2, 2), null, { y: D + bh / 2, grad: [C.char, C.charHi, D, D + bh], mark: CHAR }));
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
    parts.push(part(P.cone(r, h, 5, 3), null, { x, y: h / 2 + 0.1, z: (rnd() - 0.5) * 0.3, rz: lean, ry: rnd() * 6, grad: [C.obsidian, C.obsidianHi, 0, h * 1.2], mark: GLASS }));
  }
  return merge(parts).translate(0, 0, -0.6);
}

function gateGeo(opening, depth) {
  const parts = [...gateFrameParts(opening, { thick: 1.5, depth, color: C.basalt })];
  const top = gateTop(opening);
  // obsidian horns and glowing runes round the arch
  for (const s of [-1, 1]) {
    parts.push(part(P.cone(0.7, 4.2, 5), C.obsidian, { x: s * (opening.halfW + 0.9), y: top + 0.6, rz: -s * 0.45, mark: GLASS }));
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

// crusts: [crack glow, ash on top, texture scale] (see CRUST in the shaders)
const ROCK = [0.75, 0.55, 0.5];
const FINE = [1, 0.65, 1];

// The door into Hell: charred black plates, the red showing through
// between them glowing like the seams of a lava crust, banded with iron
// and spiked.
function hellLeaf({ W, H, z, f }) {
  const out = [];
  const at = (t) => z + (f * t) / 2;
  const cols = [0.25, W / 2 + 0.06];
  const cw = W / 2 - 0.36;
  const rowsY = [0.3, H * 0.36, H * 0.7];
  const rh = H * 0.32;
  for (const x of cols) for (const y of rowsY) out.push(part(P.box(cw, rh, 0.08), '#221a18', { x: x + cw / 2, y: y + rh / 2, z: at(0.08), outline: 0.4 }));
  out.push(part(P.box(0.06, H - 0.4, 0.05), '#ff8a2a', { x: W / 2, y: H / 2, z: at(0.05), emit: 1, outline: 0 }));
  for (const y of [H * 0.35, H * 0.69]) out.push(part(P.box(W - 0.3, 0.06, 0.05), '#ff8a2a', { x: W / 2, y, z: at(0.05), emit: 1, outline: 0 }));
  for (const y of [1.2, H * 0.52, H - 0.3]) {
    out.push(part(P.box(W - 0.1, 0.34, 0.14), '#3a2e2a', { x: W / 2, y, z: at(0.14) }));
    for (let i = 0; i < 6; i++) {
      const x = 0.4 + (i * (W - 0.8)) / 5;
      out.push(part(P.cone(0.1, 0.36, 5), '#4a3c36', { x, y, z: at(0.14) + f * 0.2, rx: (f * Math.PI) / 2 }));
    }
  }
  return out;
}

export default {
  id: 'hell',
  name: 'Hell',
  doorColor: '#c8361a',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    drain: true,
    sky: ['#020102', '#6a1a0a', '#060202'],
    // no sun: a total eclipse hangs over the road ahead, a black disc in a
    // ring of fire (see FS_SKY)
    sun: { dir: [0, 0.2, -1], glow: '#8a2008', disc: '#000000', size: 0.045 },
    eclipse: [1, 1, 1],
    stars: 0,
    // a ceiling of smoke with dry lightning in it
    skyFx: { rays: 0.1, clouds: 0, smoke: 1 },
    // lit from ahead and below by the burning horizon: hard shadows, hot rims
    light: { dir: [0.12, 0.3, -1], shadow: [0.24, 0.18, 0.2], hi: [1.1, 0.9, 0.75], soft: 0.035, wrap: 0.1, hiAmt: 0.3, lift: 0.25 },
    rim: [1.0, 0.45, 0.15, 0.5],
    // low smoke over the ash, swallowing the road ahead
    mist: { color: '#1e0806', amount: 0.72, top: 1.8, fade: 3.5, near: 14, far: 80 },
    // dim, and darker still toward the edges of the screen, closing in on the
    // road (a lightning flash throws its light right out into them)
    grade: { sat: 1.1, contrast: 1.2, vignette: 1, edge: [0.12, 0.82], exposure: 0.78, tint: '#000000' },
    ink: '#0a0606',
    fog: [34, 175],
    ground: [C.ashA, C.ashB, C.cinder],
    shadowDecal: [0.35, 0.3, 0.3],
    cast: [-0.1, 1.2],
    glowGain: 1.2,
    pool: '#ff5a1a',
    // embers rising on the heat, ash falling through them
    particles: { color: '#ff6a1a', size: 3.0, drift: [0.15, 1.2, 0], opacity: 1 },
    particles2: { color: '#cfc8c2', size: 2.2, drift: [0.45, -0.6, 0], opacity: 0.8 },
  },

  visits: [
    // an ember storm: more fire on the wind, the horizon aflame
    {
      env: {
        sky: ['#040102', '#8a2410', '#0a0302'],
        skyFx: { rays: 0.4, smoke: 1.2 },
        particles: { color: '#ffa040', size: 3.2, drift: [0.6, 1.5, 0], opacity: 1 },
      },
    },
    // the eclipse swells: the black sun hangs bigger and lower, its ring of
    // fire burning hotter and its corona streaming further
    {
      env: {
        sky: ['#010001', '#5a1210', '#0a0204'],
        sun: { dir: [0, 0.17, -1], glow: '#a82814', disc: '#000000', size: 0.06 },
        eclipse: [1, 1.2, 1.3],
        skyFx: { rays: 0.9, smoke: 0.8 },
        rim: [1.0, 0.3, 0.15, 0.55],
        particles2: { color: '#e6e2de', size: 2.0, drift: [0.2, -0.4, 0], opacity: 0.9 },
      },
    },
    { env: { trip: [0.05, 0.3, 0.1] } },
  ],

  *build(b) {
    b.ground('ground', groundStripWide(), 7);
    yield;
    b.toon('rubble', rubbleGeo(3), { cap: 60, anim: 'pop', ink: 0.04, crust: ROCK });
    yield;
    b.toon('rubbleB', rubbleGeo(9), { cap: 60, anim: 'pop', ink: 0.04, crust: ROCK });
    yield;
    b.toon('columns', columnsGeo({ n: 7, r: 0.9, hMin: 4, hMax: 11, spread: 2.4, seed: 5 }), { cap: 40, anim: 'lift', ink: 0.05, crust: ROCK });
    yield;
    b.toon('columnsB', columnsGeo({ n: 5, r: 0.7, hMin: 2.5, hMax: 6, spread: 1.6, seed: 11 }), { cap: 40, anim: 'lift', ink: 0.05, crust: ROCK });
    yield;
    b.toon('spire', spireGeo(4), { cap: 24, anim: 'liftFar', ink: 0.06, crust: [0.6, 0.4, 0.25] });
    yield;
    b.toon('spireB', spireGeo(17), { cap: 24, anim: 'liftFar', ink: 0.06, crust: [0.6, 0.4, 0.25] });
    yield;
    b.toon('volcano', volcanoGeo(2), { cap: 8, anim: 'liftFar', ink: 0, crust: [0.8, 0.2, 0.125] });
    yield;
    b.toon('volcanoSplash', splashGeo({ bursts: 3, n: 7, rx: 3.5, rz: 3.5, up: [9, 15], out: 4, size: [0.35, 0.8], period: [1.6, 3], seed: 21 }), { cap: 8, anim: 'liftFar', ink: 0, splash: true });
    yield;
    b.toon('smoke', smokeGeo(6), { cap: 16, anim: 'liftFar', ink: 0, wobble: [0.004, 0.6, 0.25, 0] });
    yield;
    b.toon('deadTree', deadTreeGeo(7), { cap: 30, anim: 'pop', ink: 0.03, crust: [0.4, 0.3, 1] });
    yield;
    b.toon('deadTreeB', deadTreeGeo(13, 5.2, 7), { cap: 30, anim: 'pop', ink: 0.035, crust: [0.4, 0.3, 1] });
    yield;
    b.toon('wraith', wraithGeo(), { cap: 40, anim: 'lift', ink: 0.025, wobble: [0.045, 0.3, 0.7, 0], fly: [0, 0, 1.4, 0.16] });
    yield;
    b.toon('ribcage', ribcageGeo(5), { cap: 8, anim: 'lift', ink: 0.05 });
    yield;
    b.toon('gibbet', gibbetPostGeo(), { cap: 16, anim: 'pop', ink: 0.04, crust: [0.5, 0.3, 1] });
    yield;
    // the cage swings slowly along the road on its chain
    b.toon('cage', gibbetCageGeo(), { cap: 16, anim: 'pop', ink: 0.03, turn: [0, 0.12, 0.9, 0] });
    yield;
    // the burning: lit by nothing but themselves, standing clear of the smoke
    const burn = (neck, o) => ({ cap: 6, ink: 0.022, crust: [1.25, 0.16, 1], flame: [2.3, 0.07], clear: 0.6, watch: { neck, far: 78, near: 26, ...o } });
    b.toon('burningStand', burningStandGeo(false, 3), burn(STAND_NECK, { body: 0.8, bow: 0.6, head: 1.25 }));
    yield;
    b.toon('burningReach', burningStandGeo(true, 8), burn(STAND_NECK, { body: 1, bow: 0.5, head: 1.1 }));
    yield;
    b.toon('burningSit', burningSitGeo(5), burn(SIT_NECK, { body: 0.12, bow: 0.85, head: 1.75 }));
    yield;
    b.toon('lavaPool', lavaPoolGeo(4), { cap: 16, lava: true, ink: 0, anim: 'pop' });
    yield;
    b.toon('crustRim', crustRimGeo(4), { cap: 16, anim: 'pop', ink: 0.03, crust: FINE });
    yield;
    b.toon('poolSplash', splashGeo({ bursts: 3, n: 7, rx: 3.0, rz: 1.8, up: [4.5, 7], out: 1.8, size: [0.11, 0.26], period: [1.2, 2.2], seed: 7 }), { cap: 16, anim: 'pop', ink: 0, splash: true });
    yield;
    b.toon('river', riverGeo(2.2, 1), { cap: 24, lava: true, ink: 0 });
    yield;
    b.toon('riverBank', riverBankGeo(2.2, 1), { cap: 24, ink: 0.03, crust: FINE });
    yield;
    b.toon('riverSplash', splashGeo({ bursts: 2, n: 6, rx: 1.6, rz: 6, cz: -8, up: [4, 7], out: 1.6, size: [0.12, 0.26], seed: 11 }), { cap: 24, ink: 0, splash: true });
    yield;
    b.glow('glow', { cap: 100, anim: 'pop' });
    yield;
    b.pool('pool', { cap: 60, anim: 'pop' });
    yield;
    b.shadow('shadow', { cap: 120, anim: 'pop' });
    yield;

    b.toon('ridge', ridgeGeo(0.95, 1), { cap: 24, anim: 'popEarly', ink: 0.04, crust: FINE });
    yield;
    b.toon('ridgeB', ridgeGeo(0.95, 7), { cap: 24, anim: 'popEarly', ink: 0.04, crust: FINE });
    yield;
    b.toon('fissureLava', fissureLavaGeo(1.05, 3), { cap: 24, lava: true, ink: 0, anim: 'popEarly' });
    yield;
    b.toon('fissureLips', fissureLipsGeo(1.05, 3), { cap: 24, anim: 'popEarly', ink: 0.03, crust: FINE });
    yield;
    b.toon('fissureSplash', fissureSplashGeo(1.05, 5), { cap: 24, anim: 'popEarly', ink: 0, splash: true });
    yield;
    b.toon('fissureWideLava', fissureLavaGeo(4.4, 5), { cap: 10, lava: true, ink: 0, anim: 'popEarly' });
    yield;
    b.toon('fissureWideLips', fissureLipsGeo(4.4, 5), { cap: 10, anim: 'popEarly', ink: 0.03, crust: FINE });
    yield;
    b.toon('fissureWideSplash', fissureSplashGeo(4.4, 9), { cap: 10, anim: 'popEarly', ink: 0, splash: true });
    yield;
    b.toon('beam', beamGeo(0.95), { cap: 24, anim: 'popEarly', ink: 0.045, crust: FINE });
    yield;
    b.toon('beamWide', beamGeo(4.1), { cap: 10, anim: 'popEarly', ink: 0.045, crust: FINE });
    yield;
    b.toon('basalt', columnsGeo({ n: 5, r: 0.36, hMin: 2.2, hMax: 3.8, spread: 0.55, seed: 2 }).translate(0, 0, -0.75), { cap: 24, anim: 'popEarly', ink: 0.045, crust: FINE });
    yield;
    b.toon('obsidian', obsidianGeo(5), { cap: 24, anim: 'popEarly', ink: 0.04, crust: FINE });
    yield;

  },

  // The door INTO this world, in its own style (built into the shared
  // doors, see world.js: it stands in the world before it).
  door(b) {
    b.toon('gateFrame', gateGeo(OPENING, GATE_DEPTH), { cap: 2, stencil: false, ink: 0.06, crust: ROCK });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', deco: hellLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [
      { name: 'ridge', len: 0.95 },
      { name: 'ridgeB', len: 0.95 },
      { name: 'fissureLips', with: ['fissureLava', 'fissureSplash'], len: FISSURE_W, top: 0.45, wade: true, flat: true },
    ],
    H: [{ name: 'beam', len: 0.72 }],
    W: [{ name: 'basalt', len: 1.5 }, { name: 'obsidian', len: 1.3 }],
    LW: { name: 'fissureWideLips', with: ['fissureWideLava', 'fissureWideSplash'], len: FISSURE_W, top: 0.45, wade: true, flat: true },
    HW: { name: 'beamWide', len: 0.72 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    // the plain stays empty near the road: only now and then a little rubble,
    // a dead tree or a gibbet, and the big shapes stand far off
    const river = Math.sin(ctx.d0 * 0.004 + 1.3);
    // one of the burning, at the road's edge (never in what carries on round
    // the doorway out)
    const burning = ctx.continuation ? null : burningIn(ctx.index, ctx.index + Math.round(ctx.toEnd / ctx.L), ctx.seg.start, ctx.visit);
    if (burning) {
      const { name, sit, x, z, ry, s } = burning;
      ctx.put(name, x, 0, z, { ry, s });
      ctx.put('glow', x, (sit ? 1.1 : 1.6) * s, z, { s: (sit ? 5.5 : 6.5) * s, c: [1, 0.4, 0.1] });
      ctx.put('pool', x, 0.05, z, { sx: 7 * s, sz: 7 * s, c: [0.75, 0.75, 0.75] });
    }
    for (const s of [-1, 1]) {
      // (nothing else stands where one of them is)
      const clear = burning && burning.side === s;
      if (!clear && rng.chance(0.35)) ctx.put(rng.chance(0.5) ? 'rubble' : 'rubbleB', s * rng.float(5.4, 13), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.7, 1.2) });
      if (!clear && rng.chance(0.22)) ctx.put(rng.chance(0.6) ? 'deadTree' : 'deadTreeB', s * rng.float(6.5, 18), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.4) });
      if (rng.chance(0.22)) ctx.put(rng.chance(0.5) ? 'columns' : 'columnsB', s * rng.float(18, 55), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.5) });
      if (rng.chance(0.12)) ctx.put(rng.chance(0.5) ? 'spire' : 'spireB', s * rng.float(45, 120), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.6) });
      // a gibbet beside the road, its arm reaching out over it, the cage
      // creaking on its chain
      if (!clear && rng.chance(0.07)) {
        const x = s * rng.float(7.2, 10);
        const z = rng.float(2, 14);
        const ry = (s < 0 ? 0 : Math.PI) + rng.float(-0.35, 0.35);
        ctx.put('gibbet', x, 0, z, { ry });
        ctx.put('cage', x + Math.cos(ry) * GIBBET_ARM * 0.92, GIBBET_H - 0.1, z + Math.sin(ry) * GIBBET_ARM * 0.92, { ry, p0: rng.float(0, 1) });
      }
      // the ribs of something colossal, half sunk in the ash
      if (rng.chance(0.045)) ctx.put('ribcage', s * rng.float(16, 42), 0, rng.float(0, 16), { ry: rng.float(0, 6.28), s: rng.float(0.9, 1.5) });
      // lost souls drifting over the plain, alone or in a slow procession
      if (rng.chance(0.11)) {
        const n = rng.chance(0.35) ? rng.int(2, 4) : 1;
        const x0 = s * rng.float(11, 34);
        const z0 = rng.float(0, 16);
        const ry = rng.float(-0.8, 0.8) + (s < 0 ? 0.4 : -0.4);
        for (let i = 0; i < n; i++) {
          const x = x0 + s * i * rng.float(1.5, 3);
          const y = rng.float(2.4, 4.2);
          const z = z0 + i * rng.float(1.5, 3);
          const k = rng.float(0.9, 1.3);
          ctx.put('wraith', x, y, z, { ry, s: k });
          ctx.put('glow', x, y - 0.8 * k, z, { s: 4.5 * k, c: [0.42, 0.42, 0.46] });
        }
      }
      if (rng.chance(0.18)) {
        const x = s * rng.float(10, 24);
        const z = rng.float(2, 14);
        const ry = rng.float(0, 6.28);
        const k = rng.float(0.7, 1.3);
        ctx.put('lavaPool', x, 0, z, { ry, s: k });
        ctx.put('crustRim', x, 0, z, { ry, s: k });
        ctx.put('poolSplash', x, 0, z, { ry, s: k });
        ctx.put('pool', x, 0.06, z, { sx: 13 * k, sz: 10 * k, c: [1, 1, 1] });
        ctx.put('glow', x, 1.2, z, { s: 8 * k, c: [1, 0.42, 0.12] });
      }
      // a lava river winds alongside for long stretches on one side
      if ((s > 0) === (river > 0) && Math.abs(river) > 0.35) {
        const x = s * (24 + 6 * Math.abs(river));
        ctx.put('river', x, 0, 16, {});
        ctx.put('riverBank', x, 0, 16, {});
        ctx.put('riverSplash', x, 0, 16, { p0: rng.float(0, 6.28) });
        if (ctx.index % 2 === 0) ctx.put('glow', x, 1.4, 8, { s: 10, c: [1, 0.4, 0.1] });
      }
    }
    if (ctx.index % 9 === 4 && rng.chance(0.7)) {
      const s = rng.chance(0.5) ? -1 : 1;
      const x = s * rng.float(100, 170);
      const z = rng.float(0, 16);
      const k = rng.float(1, 1.6);
      ctx.put('volcano', x, -2, z, { ry: rng.float(0, 6.28), s: k });
      ctx.put('volcanoSplash', x, -2 + 25.3 * k, z, { s: k });
      ctx.put('smoke', x, 30, z, { ry: rng.float(0, 6.28), s: rng.float(1.2, 1.8) });
      ctx.put('glow', x, 30, z, { s: 44, c: [1, 0.35, 0.1] });
    }
    // later laps: more fire on the plain
    if (ctx.visit >= 1 && rng.chance(0.3)) {
      const s = rng.chance(0.5) ? -1 : 1;
      ctx.put('glow', s * rng.float(8, 30), rng.float(0.5, 3), rng.float(0, 16), { s: rng.float(2, 4), c: [1, 0.5, 0.15] });
    }
  },
};

// The ash: one strip out to the horizon (the road is laid pale through it by
// the ground pattern itself, the fissures only open beyond it).
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
