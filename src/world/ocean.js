import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, rgb, gateFrameParts, gateLeafParts, gateTop, moved, rod } from './shapes.js';
import { crystal, metal, nugget, dodecahedron, lumps, FACE } from './gems.js';
import { shaftParts } from './whimsy.js';
import { CONFIG } from '../config.js';

// IX · The Kelp Deep — the last world, under the sea. A path of pale sand
// rippled by the current runs over the ocean floor between banks of coral
// (brain coral, staghorn, table coral, lacy sea fans, tube sponges and
// anemones waving in the current), forests of kelp towering up toward the
// light on either side, and far off, great stacks and arches of rock furred
// with weed, fading into the teal. Overhead, the underside of the surface
// ripples with light; shafts of it slant down through the water and a net
// of caustics wavers over everything, the runner included. Schools of
// silver fish stream past, dark shoals turn in the distance, bait balls
// mill, jellyfish pulse and drift trailing their arms, turtles and manta
// rays glide by — and now and then a whale.
//
// The water is a look, not a drag: the runner runs as fast as anywhere, but
// bubbles stream off them, sand puffs up where they land and the water
// swirls round them (see game/bubbles.js); the deeper the screen goes, the
// darker and bluer the water (env.deep); and coming in through the doorway
// the screen is splashed with water that sheets off and streaks away in
// drops (env.splash, see game/splash.js).
//
// Obstacles: a dome of brain coral, a giant clam gaping on the sand and a
// sunken treasure chest to jump (a reef ridge across the whole path); an arch
// of rock crusted with coral to slide under — and the whale: a humpback
// swimming across the path, gliding in from one side as you come and right
// over the road the moment you reach it, its belly on the duck line (slide);
// and a clump of kelp, a tower of coral and a great sea fan to go around.

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

const C = {
  sandA: '#efe0ae',
  sandB: '#d6c491',
  bed: '#5f8a58',
  rock: '#3a7570',
  rockHi: '#6aa48c',
  rockLo: '#1d4a52',
  moss: '#4f9a40',
  mossHi: '#a8d860',
  kelpLo: '#3f6e1c',
  kelpHi: '#cde04e',
  stalk: '#7a8a2a',
  coralO: '#f58a4e',
  coralP: '#f2789a',
  coralR: '#e2563f',
  coralY: '#f2c64e',
  coralV: '#a466d6',
  coralTip: '#ffe6dc',
  sponge: '#8a52c0',
  anemone: '#d8645a',
  anemoneTip: '#ffe2c8',
  whale: '#1d4460',
  whaleHi: '#3a7290',
  whaleBelly: '#d8e8e4',
  jelly: '#ffb27a',
  jellyRim: '#ff6f8f',
  jellyArm: '#a476e0',
  jellyArmLo: '#6a3cb8',
  jellyTent: '#fbd2e6',
  fishSilver: '#e6f6f2',
  fishBack: '#3f8290',
  fishDark: '#123c46',
  shell: '#fde8d2',
  shellLo: '#f0a890',
  wood: '#6a4a2e',
  woodLo: '#3e2a1a',
  iron: '#3a3a38',
  gold: '#ffcf4a',
  barnacle: '#ece6d6',
};

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

function role(g, k) {
  g.setAttribute('role', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1));
  return g;
}

// Recolour a finished part vertex by vertex from where each vertex is.
function paint(g, fn) {
  const pos = g.attributes.position.array;
  const col = g.attributes.color.array;
  for (let i = 0; i < pos.length / 3; i++) {
    const c = fn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  return g;
}
// ...or from which way it faces (dark on top, pale beneath, like a whale's
// flippers and flukes)
function twoTone(g, top, under) {
  const nor = g.attributes.normal.array;
  const col = g.attributes.color.array;
  const A = rgb(top);
  const B = rgb(under);
  for (let i = 0; i < nor.length / 3; i++) {
    const k = sstep(-0.25, 0.25, nor[i * 3 + 1]);
    for (let j = 0; j < 3; j++) col[i * 3 + j] = B[j] + (A[j] - B[j]) * k;
  }
  return g;
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// A lumpy boulder: a polyhedron jittered by position (so its faces stay
// joined), faceted, furred with weed on top (the scribble marks).
function boulder({ r = 1, sx = 1, sy = 0.8, sz = 1, lo = C.rockLo, hi = C.rockHi, seed = 1, x = 0, y = 0, z = 0, ry = 0, detail = 0, mark = 0.6, jitter = 0.32 } = {}) {
  const g = detail ? P.ico(r, detail) : P.dodeca(r);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const k = Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719 + seed * 4.13) * 43758.5453;
    const f = 1 + (k - Math.floor(k) - 0.5) * jitter;
    pos.setXYZ(i, px * f, py * f, pz * f);
  }
  g.computeVertexNormals();
  return part(g, null, { x, y: y + r * sy * 0.55, z, ry, sx, sy, sz, grad: [lo, hi, y - r * sy * 0.3, y + r * sy * 1.4], mark });
}

// A tapered tube from a along unit dir.
function tube(parts, a, dir, len, r0, r1, color, o = {}) {
  const g = P.cyl(r1, r0, len, o.seg ?? 5, o.hs ?? 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  g.translate(a.x, a.y, a.z);
  parts.push(part(g, o.grad ? null : color, { grad: o.grad, tint: o.tint || 0, outline: o.outline ?? 1, mark: o.mark || 0 }));
}

// --- coral and the reef -------------------------------------------------------------
// A dome of brain coral, its meandering grooves the scribble marks.
function brainParts({ r = 0.9, color = C.coralO, sy = 0.82, tint = 0, x = 0, y = 0, z = 0, seg = [14, 6] } = {}) {
  return [part(new THREE.SphereGeometry(r, seg[0], seg[1], 0, TAU, 0, Math.PI / 2), color, { x, y, z, sy, mark: 0.95, tint, uvScale: [5, 2.5] })];
}

// Staghorn coral: tubes branching and branching again, paling to the tips.
function staghornParts({ h = 1.3, color = C.coralP, tip = C.coralTip, trunks = 4, depth = 2, seed = 1, tint = 0 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  const grad = [color, tip, 0, h * 1.1];
  const grow = (p, dir, len, r, d) => {
    tube(parts, p, dir, len, r, r * 0.62, color, { grad, tint, outline: 0.7 });
    if (d <= 0) return;
    const end = p.clone().addScaledVector(dir, len);
    const n = 2;
    for (let i = 0; i < n; i++) {
      const side = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize();
      const nd = dir.clone().addScaledVector(side, 0.55 + rnd() * 0.4).normalize();
      nd.y = Math.max(nd.y, 0.35);
      nd.normalize();
      grow(end, nd, len * (0.62 + rnd() * 0.2), r * 0.66, d - 1);
    }
  };
  for (let i = 0; i < trunks; i++) {
    const a = (i / trunks) * TAU + rnd();
    const dir = new THREE.Vector3(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45).normalize();
    grow(new THREE.Vector3(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12), dir, h * 0.48, 0.09, depth);
  }
  return parts;
}

// Table coral: a broad plate on a short stem, paler on top.
function tableParts({ r = 1.1, h = 0.75, color = C.coralY, seed = 1, tint = 0 } = {}) {
  const rnd = seeded(seed);
  const g = P.cyl(r, r * 0.86, 0.16, 14);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 + 0.1 * Math.sin(a * 5 + seed) + 0.05 * Math.sin(a * 11 + seed * 2);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return [
    part(P.cyl(0.12, 0.2, h, 6), color, { y: h / 2, tint }),
    part(g, null, { y: h + 0.04, rz: (rnd() - 0.5) * 0.12, grad: [color, C.coralTip, h - 0.1, h + 0.25], tint, mark: 0.5 }),
  ];
}

// Tube sponges: a clutch of tubes, dark in their mouths.
function spongeParts({ n = 4, h = 1.1, color = C.sponge, seed = 1, tint = 0 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd();
    const rr = i === 0 ? 0 : 0.22 + rnd() * 0.12;
    const hh = h * (0.55 + rnd() * 0.5);
    const r = 0.11 + rnd() * 0.06;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    parts.push(part(P.cyl(r, r * 0.8, hh, 7), color, { x, y: hh / 2, z, rz: (rnd() - 0.5) * 0.3, tint, mark: 0.3 }));
    parts.push(part(P.cyl(r * 0.72, r * 0.72, 0.02, 7), '#2a1440', { x, y: hh + 0.005, z, outline: 0 }));
  }
  return parts;
}

// A sea anemone: a squat column, a crown of tentacles waving in the current
// (tint: its colour).
function anemoneParts({ r = 0.32, n = 16, len = 0.5, color = C.anemone, tip = C.anemoneTip, tint = 1, seed = 1 } = {}) {
  const rnd = seeded(seed);
  const parts = [part(P.cyl(r * 0.9, r * 1.05, 0.34, 10), color, { y: 0.17, tint, mark: 0.2 })];
  parts.push(part(P.cyl(r * 0.92, r * 0.92, 0.04, 10), tip, { y: 0.35, outline: 0 }));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd() * 0.3;
    const ring = i % 2 ? 0.9 : 0.6;
    const dir = new THREE.Vector3(Math.cos(a) * (0.5 + ring * 0.5), 1, Math.sin(a) * (0.5 + ring * 0.5)).normalize();
    const g = P.cone(0.035, len * (0.75 + rnd() * 0.5), 4, 1);
    g.translate(0, (len * (0.75 + 0.25)) / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
    g.translate(Math.cos(a) * r * ring, 0.34, Math.sin(a) * r * ring);
    parts.push(part(g, null, { grad: [color, tip, 0.35, 0.35 + len], tint, outline: 0.5 }));
  }
  return parts;
}

// A sea fan (gorgonian): a lacy fan standing up to face the run, its
// branches drawn over it. holes: how lacy.
function fanParts({ w = 1.6, h = 1.8, color = C.coralV, seed = 1, holes = 16, t = 0.05, tint = 0 } = {}) {
  const rnd = seeded(seed);
  const s = new THREE.Shape();
  const n = 18;
  s.moveTo(0.12, 0);
  for (let i = 0; i <= n; i++) {
    const a = -0.15 + (i / n) * (Math.PI + 0.3);
    const k = 1 + (rnd() - 0.5) * 0.12;
    s.lineTo(Math.cos(a) * (w / 2) * k, h * 0.18 + Math.sin(a) * h * 0.82 * k);
  }
  s.lineTo(-0.12, 0);
  s.closePath();
  const placed = [];
  for (let tries = 0; tries < 400 && placed.length < holes; tries++) {
    const a = rnd() * Math.PI;
    const rr = 0.25 + rnd() * 0.62;
    const x = Math.cos(a) * (w / 2) * rr;
    const y = h * 0.18 + Math.sin(a) * h * 0.82 * rr;
    const hr = 0.05 + rnd() * 0.07;
    if (y < 0.3) continue;
    if (placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < p[2] + hr + 0.07)) continue;
    placed.push([x, y, hr]);
    const hole = new THREE.Path();
    hole.absellipse(x, y, hr * 1.2, hr, 0, TAU, true);
    s.holes.push(hole);
  }
  const parts = [part(P.extrude(s, t, 6), null, { grad: [color, C.coralTip, 0, h * 1.4], tint, mark: 0.25 })];
  // the branches, standing a little proud of the fan on both faces
  for (let i = 0; i < 7; i++) {
    const a = 0.25 + (i / 6) * (Math.PI - 0.5);
    const dir = new THREE.Vector3(Math.cos(a) * 0.9, Math.sin(a), 0).normalize();
    tube(parts, new THREE.Vector3(0, 0, 0), dir, h * (0.72 + rnd() * 0.15), 0.05, 0.02, color, { outline: 0.5, tint });
  }
  parts.push(part(P.cyl(0.08, 0.12, 0.3, 6), color, { y: 0.15, tint }));
  return parts;
}

// Seagrass: a tuft of long blades, swaying (they're built in segments so the
// current can bend them).
function seagrassParts({ n = 9, h = 1.0, seed = 1 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const rr = rnd() * 0.3;
    const hh = h * (0.6 + rnd() * 0.6);
    parts.push(part(P.box(0.07, hh, 0.012, 1, 4, 1), null, { x: Math.cos(a) * rr, y: hh / 2, z: Math.sin(a) * rr, ry: rnd() * TAU, rz: (rnd() - 0.5) * 0.35, grad: ['#1f5a32', '#7ab84a', 0, h * 1.1], outline: 0 }));
  }
  return parts;
}

// A flat kelp blade pointing up +y from the origin, len long: a diamond
// folded along its midrib (uv.x 0 on the midrib, 1 at its edges; uv.y how
// far along it), to be shaded light down the middle and dark at the edges.
function flatBlade(len, w) {
  const v = [
    [0, 0, 0, 0, 0], [w, len * 0.38, 0, 1, 0.38], [0, len * 0.38, w * 0.25, 0, 0.38],
    [0, len * 0.38, w * 0.25, 0, 0.38], [w, len * 0.38, 0, 1, 0.38], [0, len, 0, 0, 1],
    [0, 0, 0, 0, 0], [0, len * 0.38, w * 0.25, 0, 0.38], [-w, len * 0.38, 0, 1, 0.38],
    [0, len * 0.38, w * 0.25, 0, 0.38], [0, len, 0, 0, 1], [-w, len * 0.38, 0, 1, 0.38],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.flatMap((p) => p.slice(0, 3)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(v.flatMap((p) => p.slice(3)), 2));
  g.computeVertexNormals();
  return g;
}

// Giant kelp: a holdfast, a few stalks reaching for the light and broad
// blades all the way up them, a spray of blades at each top. Built in
// segments so the current can sway it, a wave running up it. flat: the
// blades are flat leaves shaded down their midribs (light enough for a
// forest of it, drawn without ink); otherwise rounded, for the ink.
function kelpParts({ h = 12, stalks = 3, blades = 11, seed = 1, spread = 0.7, blade = 1, flat = false } = {}) {
  const rnd = seeded(seed);
  const parts = [boulder({ r: 0.55, sy: 0.55, seed, lo: C.rockLo, hi: C.rock, mark: 0.4 })];
  for (let s = 0; s < stalks; s++) {
    const a = (s / stalks) * TAU + rnd();
    const x = Math.cos(a) * spread * rnd();
    const z = Math.sin(a) * spread * rnd();
    const hh = h * (0.7 + rnd() * 0.4);
    parts.push(part(P.cyl(0.045, 0.08, hh, flat ? 4 : 5, 8), C.stalk, { x, y: hh / 2, z, outline: flat ? 0 : 0.5 }));
    for (let b = 0; b < blades; b++) {
      const top = b >= blades - 3;
      const y = top ? hh - 0.3 + (b - blades + 3) * 0.25 : 0.8 + (b / (blades - 3)) * (hh - 1.6);
      const side = b % 2 ? 1 : -1;
      const ry = rnd() * TAU;
      const len = (top ? 1.3 : 0.85 + rnd() * 0.5) * blade;
      const tilt = top ? 0.25 + rnd() * 0.3 : 0.55 + rnd() * 0.35;
      // a blade: a long leaf leaning out and up from the stalk
      const wide = 0.3 + rnd() * 0.1;
      let g;
      if (flat) {
        g = flatBlade(len * 2, wide);
      } else {
        g = P.sphere(1, 5, 3);
        g.scale(0.035, len, wide);
        g.translate(0, len, 0);
      }
      g.rotateZ(side * tilt);
      g.rotateY(ry);
      g.translate(x, y, z);
      const leaf = part(g, null, { grad: [C.kelpLo, C.kelpHi, y - 0.4, y + len * 1.6], outline: flat ? 0 : 0.5, mark: flat ? 0 : 0.15 });
      if (flat) {
        // light down the midrib, dark at the edges, darker toward the stalk
        const uv = leaf.attributes.uv.array;
        const col = leaf.attributes.color.array;
        for (let i = 0; i < uv.length / 2; i++) {
          const k = (1 - 0.38 * uv[i * 2]) * (0.82 + 0.18 * uv[i * 2 + 1]);
          col[i * 3] *= k;
          col[i * 3 + 1] *= k;
          col[i * 3 + 2] *= k;
        }
      }
      parts.push(leaf);
    }
  }
  return parts;
}

// A stack of rock furred with weed, the kind that looms out of the murk
// (built 1 m to the unit; scaled up where it's placed).
function stackParts({ seed = 1, h = 14 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  let y = 0;
  let r = 3.2;
  let x = 0;
  while (y < h - 1 && r > 0.7) {
    const sy = 0.7 + rnd() * 0.5;
    parts.push(boulder({ r, sx: 1 + rnd() * 0.3, sy, sz: 1 + rnd() * 0.3, x, y, seed: seed * 7 + y, detail: 1, mark: 0.7, jitter: 0.38 }));
    // a cap of weed on its shoulders
    parts.push(part(P.sphere(r * 0.75, 10, 5, 0, TAU, 0, Math.PI / 2), null, { x: x + (rnd() - 0.5) * r * 0.4, y: y + r * sy * 1.05, sy: 0.35, grad: [C.moss, C.mossHi, y + r * sy, y + r * sy * 1.4], mark: 0.9 }));
    y += r * sy * 1.25;
    x += (rnd() - 0.5) * r * 0.5;
    r *= 0.72 + rnd() * 0.12;
  }
  return parts;
}

// A natural arch of rock, weed hanging from it.
function rockArchParts({ seed = 3 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  for (const s of [-1, 1]) {
    let y = 0;
    for (let i = 0; i < 3; i++) {
      const r = 2.6 - i * 0.4;
      parts.push(boulder({ r, sy: 0.9, x: s * (7 + rnd()), y, seed: seed + i * 3 + (s > 0 ? 9 : 0), detail: 1, mark: 0.7 }));
      y += r * 1.3;
    }
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (i / 8);
    parts.push(boulder({ r: 1.9 + rnd() * 0.5, sy: 0.8, x: Math.cos(a) * 7.5, y: 8 + Math.sin(a) * 4.5, seed: seed * 3 + i, mark: 0.7 }));
  }
  return parts;
}

// A mound of the reef: a low rock crowded with coral.
function reefParts(seed = 1) {
  const rnd = seeded(seed);
  const parts = [boulder({ r: 2.2, sx: 1.2, sy: 0.42, seed, detail: 1, mark: 0.5 })];
  const top = 0.75;
  const tints = [C.coralO, C.coralY, C.coralP, C.coralR];
  parts.push(...moved(brainParts({ r: 0.7, color: tints[seed % 4], seg: [10, 5] }), { x: -0.9, y: top - 0.1, z: 0.5 }));
  parts.push(...moved(brainParts({ r: 0.5, color: tints[(seed + 1) % 4], seg: [10, 5] }), { x: 1.1, y: top - 0.2, z: 0.8 }));
  parts.push(...moved(staghornParts({ h: 1.4, color: tints[(seed + 2) % 4], seed: seed + 3, depth: 1, trunks: 5 }), { x: 0.4, y: top, z: -0.4 }));
  parts.push(...moved(fanParts({ w: 1.4, h: 1.6, seed: seed + 5, holes: 7, color: rnd() < 0.5 ? C.coralV : C.coralR }), { x: -0.2, y: top - 0.1, z: -1.1, ry: (rnd() - 0.5) * 0.8 }));
  parts.push(...moved(tableParts({ r: 0.8, h: 0.5, seed: seed + 7, color: tints[(seed + 3) % 4] }), { x: 1.6, y: top - 0.3, z: -0.6 }));
  parts.push(...moved(spongeParts({ n: 3, h: 0.9, seed: seed + 9 }), { x: -1.8, y: top - 0.35, z: -0.5 }));
  return parts;
}

// --- creatures --------------------------------------------------------------------
// A fish, nose to +x, about len long: a body darker along the back, a tail.
function fishParts({ len = 0.4, back = C.fishBack, belly = C.fishSilver, deep = 0.36 } = {}) {
  return [
    part(P.sphere(0.5, 6, 4), null, { sx: len, sy: len * deep, sz: len * 0.17, grad: [belly, back, -len * 0.12, len * 0.14], outline: 0.6 }),
    part(P.cone(len * 0.2, len * 0.34, 4), back, { x: -len * 0.62, rz: -Math.PI / 2, sz: 0.22, outline: 0.6 }),
  ];
}

// A whole school as one geometry (see SCHOOL): every fish its own vertices,
// carrying where it swims in the school. mode 0 a stream L metres long, 1 a
// ball milling at radius up to R, 2 a column of bubbles L metres high.
function schoolGeo({ n = 60, mode = 0, L = 36, H = 1.6, W = 2.4, R = 3, make, seed = 1 }) {
  const rnd = seeded(seed);
  const all = [];
  for (let i = 0; i < n; i++) {
    const g = merge(make(rnd));
    let fx, fy, fz;
    if (mode === 0) {
      fx = rnd() * L;
      const a = rnd() * TAU;
      const r = Math.sqrt(rnd());
      fy = Math.sin(a) * r * H;
      fz = Math.cos(a) * r * W;
    } else if (mode === 1) {
      fx = rnd() * L;
      fy = (rnd() - 0.5) * 2 * H;
      fz = R * (0.4 + 0.6 * Math.sqrt(rnd()));
    } else {
      fx = rnd() * L;
      fy = (rnd() - 0.5) * W;
      fz = (rnd() - 0.5) * W;
    }
    const w = rnd();
    const cnt = g.attributes.position.count;
    const arr = new Float32Array(cnt * 4);
    for (let k = 0; k < cnt; k++) arr.set([fx, fy, fz, w], k * 4);
    g.setAttribute('fish', new THREE.BufferAttribute(arr, 4));
    all.push(g);
  }
  return merge(all);
}

// A jellyfish (see JELLY): a glowing bell, peach crowned and rose at its
// scalloped rim with pale spots, ruffled violet arms trailing below it and
// long fine tentacles. role 0 the bell, 1 everything that trails.
function jellyParts({ r = 0.9, seed = 1 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  const prof = [[r, 0], [r * 1.02, 0.12 * r], [r * 0.94, 0.38 * r], [r * 0.74, 0.62 * r], [r * 0.42, 0.8 * r], [0, 0.86 * r]].map(([a, b]) => [a, b]);
  parts.push(role(part(P.lathe(prof, 18), null, { grad: [C.jellyRim, C.jelly, 0, r * 0.55], emit: 0.55, tint: 1, mark: 0.15 }), 0));
  // the scallops round the rim, and pale spots on the bell
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    parts.push(role(part(P.sphere(r * 0.12, 5, 3), C.jellyRim, { x: Math.cos(a) * r * 0.98, y: -0.02, z: Math.sin(a) * r * 0.98, sy: 0.55, emit: 0.6, outline: 0.4 }), 0));
    if (i % 2 === 0) parts.push(role(part(P.sphere(r * 0.09, 4, 3), '#fff2d8', { x: Math.cos(a + 0.17) * r * 0.86, y: r * 0.32, z: Math.sin(a + 0.17) * r * 0.86, sy: 0.5, emit: 0.9, outline: 0 }), 0));
  }
  // the oral arms: ruffled ribbons twisting down
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const len = r * (2.6 + rnd() * 1.2);
    const g = P.plane(r * 0.42, len, 2, 14);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const px = pos.getX(k);
      const py = pos.getY(k) - len / 2;
      const d = -py / len;
      const tw = d * 5.5 + i;
      const wv = Math.sin(d * 18 + px * 9) * 0.07 * r;
      const w = px * (1 - d * 0.55);
      pos.setXYZ(k, Math.cos(tw) * w + Math.sin(d * 4 + i) * 0.25 * r * d, py, Math.sin(tw) * w + wv);
    }
    g.computeVertexNormals();
    parts.push(role(part(g, null, { x: Math.cos(a) * r * 0.22, y: r * 0.1, z: Math.sin(a) * r * 0.22, grad: [C.jellyArmLo, C.jellyArm, -len, 0], emit: 0.35, outline: 0.35 }), 1));
  }
  // the tentacles: long fine threads from the rim
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.13;
    const len = r * (3.2 + rnd() * 2.4);
    const g = P.cyl(0.006, 0.016, len, 3, 10, true);
    g.translate(0, -len / 2, 0);
    parts.push(role(part(g, C.jellyTent, { x: Math.cos(a) * r * 0.9, z: Math.sin(a) * r * 0.9, emit: 0.7, outline: 0 }), 1));
  }
  return parts;
}

// A manta ray gliding overhead, its wings beating (fly), nose to -z: dark
// above, white beneath (which is what you see of it from below).
function mantaParts() {
  const droop = 0.42;
  const parts = [part(P.sphere(1, 12, 6), null, { sx: 0.9, sy: 0.22, sz: 1.3, grad: ['#bcd4d0', '#1c3644', -0.1, 0.12] })];
  for (const s of [-1, 1]) {
    const g = P.sphere(1, 10, 5);
    g.scale(1.9, 0.12, 0.9);
    g.translate(s * 1.75, 0, 0.25);
    // swept back at the tip
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + Math.pow(Math.abs(pos.getX(i)) / 3.6, 2) * 1.4);
    g.computeVertexNormals();
    g.rotateZ(-s * droop);
    parts.push(part(g, null, { grad: ['#bcd4d0', '#1c3644', -0.15, 0.1] }));
    parts.push(part(P.box(0.14, 0.06, 0.55), '#1c3644', { x: s * 0.42, z: -1.35, ry: -s * 0.3 }));
  }
  parts.push(part(P.cyl(0.015, 0.05, 2.4, 4), '#1c3644', { z: 2.4, rx: Math.PI / 2, outline: 0.4 }));
  return parts;
}

// A sea turtle, nose to -z, its flippers beating (fly).
function turtleParts() {
  const parts = [
    part(new THREE.SphereGeometry(0.75, 12, 6, 0, TAU, 0, Math.PI / 2), null, { sz: 1.25, sy: 0.55, grad: ['#5a4a2a', '#9a8a4a', 0, 0.42], mark: 0.85, uvScale: [3, 2] }),
    part(P.sphere(0.72, 10, 4), '#e6d8a8', { sz: 1.2, sy: 0.18, y: 0.02 }),
    part(P.sphere(0.24, 8, 6), '#7a8a5a', { z: -1.05, y: 0.1, sz: 1.25 }),
    part(P.sphere(0.04, 6, 4), '#141414', { x: 0.15, y: 0.18, z: -1.18, outline: 0 }),
    part(P.sphere(0.04, 6, 4), '#141414', { x: -0.15, y: 0.18, z: -1.18, outline: 0 }),
  ];
  for (const s of [-1, 1]) {
    parts.push(part(P.sphere(1, 8, 4), '#7a8a5a', { x: s * 0.95, z: -0.45, sx: 0.65, sy: 0.05, sz: 0.2, ry: s * 0.45, rz: -s * 0.3 }));
    parts.push(part(P.sphere(1, 6, 4), '#7a8a5a', { x: s * 0.55, z: 0.75, sx: 0.32, sy: 0.05, sz: 0.14, ry: -s * 0.6, rz: -s * 0.2 }));
  }
  return parts;
}

// The whale: a humpback built tail to snout along +x (see CROSS) — its
// belly kept level on the duck line across the whole road (it only rises
// toward the flukes and the snout), its back below the camera's eye; long
// pale flippers out past the road on the head's side, the flukes out past it
// on the tail's, knobbly tubercles on its head, a little dorsal hump, pleats
// down its throat (see PLEATS) and countershading, dark above, pale beneath.
const WHALE_X0 = -9.6;
const WHALE_X1 = 6.6;
const WHALE_BELLY = CONFIG.duckLine + 0.09;
function key(table, s) {
  for (let i = 1; i < table.length; i++) {
    if (s <= table[i][0]) {
      const [s0, v0] = table[i - 1];
      const [s1, v1] = table[i];
      return v0 + (v1 - v0) * sstep(0, 1, (s - s0) / (s1 - s0));
    }
  }
  return table[table.length - 1][1];
}
const W_H = [[0, 0.12], [0.1, 0.3], [0.3, 0.72], [0.48, 1.0], [0.62, 1.04], [0.8, 0.95], [0.92, 0.66], [1, 0.22]];
const W_W = [[0, 0.1], [0.1, 0.28], [0.3, 1.02], [0.48, 1.62], [0.62, 1.74], [0.8, 1.64], [0.92, 1.26], [1, 0.46]];
const W_B = [[0, 2.15], [0.12, 1.75], [0.3, WHALE_BELLY], [0.9, WHALE_BELLY], [1, WHALE_BELLY + 0.32]];
function whaleProfile(x) {
  const s = Math.min(1, Math.max(0, (x - WHALE_X0) / (WHALE_X1 - WHALE_X0)));
  const h = key(W_H, s);
  return { s, h, w: key(W_W, s), yc: key(W_B, s) + h };
}
function whaleParts() {
  const NX = 46;
  const NA = 28;
  const pos = [];
  const uvs = [];
  for (let i = 0; i <= NX; i++) {
    const t = i / NX;
    const x = WHALE_X0 + (WHALE_X1 - WHALE_X0) * t;
    const { s, h, w, yc } = whaleProfile(x);
    for (let j = 0; j <= NA; j++) {
      const th = (j / NA) * TAU;
      const cy = Math.cos(th);
      // a fuller, flatter belly; a flatter crown on the head
      const yy = cy >= 0 ? Math.pow(cy, s > 0.78 ? 1.35 : 1) : -Math.pow(-cy, 0.72);
      pos.push(x, yc + yy * h, Math.sin(th) * w);
      uvs.push(s, j / NA);
    }
  }
  const idx = [];
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * (NA + 1) + j;
      const b = a + NA + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // (the seam along the spine: both copies share one normal)
  const nrm = g.attributes.normal;
  for (let i = 0; i <= NX; i++) {
    const a = i * (NA + 1);
    const b = a + NA;
    const nx = nrm.getX(a) + nrm.getX(b);
    const ny = nrm.getY(a) + nrm.getY(b);
    const nz = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / l, ny / l, nz / l);
    nrm.setXYZ(b, nx / l, ny / l, nz / l);
  }
  // its throat and belly pleated, and above that countershaded
  const body = paint(part(g, '#ffffff', { mark: 0.6 }), (x, y) => {
    const { h, yc } = whaleProfile(x);
    const k = (y - yc) / Math.max(h, 0.05);
    return lerp3(rgb(C.whaleBelly), lerp3(rgb(C.whale), rgb(C.whaleHi), sstep(0.5, 1, k) * 0.35), sstep(-0.5, 0.05, k));
  });
  const parts = [body];
  // the flippers, long and narrow, dark above and pale beneath, reaching
  // out past the road on the head's side (never over a lane)
  for (const side of [-1, 1]) {
    const fin = P.sphere(1, 14, 6);
    fin.scale(2.2, 0.09, 0.36);
    // tapering to the tip, the knobbled leading edge toward the head
    const fp = fin.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const u = (fp.getX(i) + 2.2) / 4.4;
      let z = fp.getZ(i) * (1.15 - 0.6 * u * u);
      if (z * side < -0.12) z *= 1 + 0.14 * Math.sin(fp.getX(i) * 8);
      fp.setZ(i, z);
    }
    fin.computeVertexNormals();
    const root = new THREE.Vector3(5.0, WHALE_BELLY + 0.5, side * 1.35);
    const ry = side > 0 ? -1.78 : 1.78;
    const dir = new THREE.Vector3(Math.cos(-0.14), Math.sin(-0.14), 0).applyAxisAngle(UP, ry);
    parts.push(twoTone(part(fin, null, { x: root.x + dir.x * 2.1, y: root.y + dir.y * 2.1, z: root.z + dir.z * 2.1, ry, rz: -0.14 }), C.whale, '#e6eeea'));
  }
  // the line of its mouth, from the snout back under the eye
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const x = 6.45 - i * 0.36;
      const { yc, h, w } = whaleProfile(x);
      const k = -0.05 - 0.28 * (i / 8);
      pts.push([x, yc + h * k, side * w * Math.sqrt(1 - k * k) * 1.01]);
    }
    for (let i = 0; i < pts.length - 1; i++) rod(parts, pts[i], pts[i + 1], 0.028, '#0e2232', 0);
  }
  // the flukes, out past the road on the tail's side
  {
    const s = new THREE.Shape();
    s.moveTo(0.2, 0);
    s.bezierCurveTo(0.1, 1.0, -0.6, 2.1, -1.45, 2.45);
    s.bezierCurveTo(-1.0, 1.6, -0.75, 0.6, -0.95, 0.12);
    s.lineTo(-0.85, 0);
    s.lineTo(-0.95, -0.12);
    s.bezierCurveTo(-0.75, -0.6, -1.0, -1.6, -1.45, -2.45);
    s.bezierCurveTo(-0.6, -2.1, 0.1, -1.0, 0.2, 0);
    const g2 = P.extrude(s, 0.16, 10);
    g2.rotateX(-Math.PI / 2);
    g2.scale(1.25, 1, 1.3);
    const fy = key(W_B, 0) + key(W_H, 0);
    parts.push(twoTone(part(g2, null, { x: WHALE_X0 + 0.25, y: fy }), C.whale, '#e6eeea'));
  }
  // the dorsal hump
  {
    const { yc, h } = whaleProfile(-4.6);
    parts.push(part(P.cone(0.5, 0.55, 6), C.whale, { x: -4.6, y: yc + h * 0.98, sz: 0.3, rz: 0.55 }));
  }
  // tubercles over the head and chin, the eyes, barnacles on the chin
  const rnd = seeded(41);
  for (let i = 0; i < 14; i++) {
    const x = 4.0 + rnd() * 2.3;
    const { yc, h, w } = whaleProfile(x);
    const z = (rnd() - 0.5) * w * 0.9;
    const top = yc + h * Math.pow(Math.max(0, 1 - (z / w) * (z / w)), 0.5) * 0.98;
    parts.push(part(P.sphere(0.09, 6, 4), C.whaleHi, { x, y: top, z, sy: 0.7, outline: 0.4 }));
  }
  for (const side of [-1, 1]) {
    const x = 4.65;
    const { yc, h, w } = whaleProfile(x);
    const y = yc - h * 0.32;
    const z = side * w * Math.sqrt(1 - 0.32 * 0.32) * 0.97;
    parts.push(part(P.sphere(0.13, 8, 6), '#e8eee8', { x, y, z, sz: 0.5, outline: 0 }));
    parts.push(part(P.sphere(0.08, 8, 6), '#0a141a', { x: x + 0.01, y, z: z + side * 0.04, sz: 0.5, outline: 0 }));
    for (let i = 0; i < 5; i++) {
      const bx = 5.4 + rnd() * 1.0;
      const p = whaleProfile(bx);
      parts.push(part(P.sphere(0.07 + rnd() * 0.05, 6, 4), C.barnacle, { x: bx, y: p.yc - p.h * (0.4 + rnd() * 0.3), z: side * p.w * 0.88, outline: 0.3 }));
    }
  }
  return parts;
}

// --- obstacles --------------------------------------------------------------------
// L · A dome of brain coral (tinted).
function brainGeo() {
  return merge([
    boulder({ r: 0.75, sx: 1.25, sy: 0.3, sz: 1.2, seed: 5, mark: 0.4 }),
    ...brainParts({ r: 0.88, sy: 0.92, color: '#ffffff', tint: 1, y: 0.06 }),
  ]).translate(0, 0, -0.9);
}

// L · A giant clam gaping on the sand: its fluted, scalloped valves standing
// open, the mantle between them in iridescent blue-green, spotted.
function clamGeo() {
  const parts = [];
  const valve = (back) => {
    const s = new THREE.Shape();
    const n = 7;
    s.moveTo(-0.95, 0);
    for (let i = 0; i <= n * 2; i++) {
      const a = Math.PI - (i / (n * 2)) * Math.PI;
      const r = i % 2 ? 0.86 : 0.95;
      s.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.82);
    }
    s.closePath();
    const g = P.extrude(s, 0.14, 4);
    return part(g, null, { y: 0.05, z: back ? -0.25 : 0.25, rx: back ? -0.3 : 0.78, sy: back ? 1 : 0.8, grad: [C.shellLo, C.shell, 0, 0.8] });
  };
  parts.push(valve(true), valve(false));
  // fluting on the front valve
  for (let i = 0; i < 6; i++) {
    const a = 0.35 + (i / 5) * (Math.PI - 0.7);
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.82, 0).normalize();
    const p = [];
    tube(p, new THREE.Vector3(0, 0, 0), dir, 0.82, 0.05, 0.04, C.shell, { outline: 0.4 });
    parts.push(...moved(p.map((g) => g.scale(1, 0.8, 1)), { y: 0.05, z: 0.36, rx: 0.78 }));
  }
  // the mantle
  parts.push(part(P.sphere(0.82, 14, 6), null, { y: 0.34, sy: 0.36, sz: 0.38, grad: ['#2a5ab8', '#4af0e0', 0.2, 0.55], emit: 0.25 }));
  const rnd = seeded(12);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI;
    parts.push(part(P.sphere(0.04, 5, 4), '#d8fff8', { x: Math.cos(a) * 0.6, y: 0.5 + rnd() * 0.12, z: (rnd() - 0.5) * 0.3, emit: 0.7, outline: 0 }));
  }
  // a pearl, glinting in its lip
  parts.push(part(P.sphere(0.1, 10, 8), '#fff4ee', { x: 0.25, y: 0.62, z: 0.08, emit: 0.4, outline: 0.4 }));
  return merge(parts).translate(0, 0, -0.55);
}

// L · A sunken treasure chest: iron-bound, its lid sprung a crack and gold
// glowing through it, a few coins spilled in the sand, barnacles and weed.
function chestGeo() {
  const parts = [];
  const W = 1.5;
  const D = 0.82;
  const H = 0.5;
  parts.push(part(P.box(W, H, D), null, { y: H / 2, grad: [C.woodLo, C.wood, 0, H] }));
  // the domed lid, sprung open a little on its hinge at the back
  const lid = [
    part(P.cyl(D / 2, D / 2, W, 12, 1, false, 0, Math.PI), C.wood, { rz: Math.PI / 2, ry: 0 }),
    part(P.box(0.07, 0.02, D + 0.02), C.iron, { x: -W * 0.3 }),
  ];
  for (const bx of [-W * 0.32, W * 0.32]) lid.push(part(P.torus(D / 2 + 0.015, 0.03, 4, 12, Math.PI), C.iron, { x: bx, ry: Math.PI / 2 }));
  moved(lid, { z: D / 2 });
  moved(lid, { rx: -0.14 });
  parts.push(...moved(lid, { y: H, z: -D / 2 }));
  // the bands and the lock
  for (const bx of [-W * 0.32, W * 0.32]) parts.push(part(P.box(0.08, H + 0.02, D + 0.03), C.iron, { x: bx, y: H / 2, outline: 0.5 }));
  parts.push(part(P.box(0.2, 0.22, 0.05), '#c89a3a', { y: H - 0.08, z: D / 2 + 0.02, outline: 0.5 }));
  // gold glowing in the crack
  parts.push(part(P.box(W * 0.9, 0.08, D * 0.7), C.gold, { y: H + 0.04, emit: 1, outline: 0 }));
  const rnd = seeded(7);
  for (let i = 0; i < 9; i++) parts.push(part(P.cyl(0.07, 0.07, 0.02, 10), C.gold, { x: (rnd() - 0.5) * 1.6, y: 0.012, z: D / 2 + 0.15 + rnd() * 0.4, rx: (rnd() - 0.5) * 0.4, emit: 0.5, outline: 0.4 }));
  for (let i = 0; i < 14; i++) parts.push(part(P.sphere(0.035 + rnd() * 0.03, 5, 4), C.barnacle, { x: (rnd() - 0.5) * W, y: rnd() * H * 0.9, z: D / 2 + 0.01, outline: 0.3 }));
  parts.push(...moved(seagrassParts({ n: 5, h: 0.6, seed: 3 }), { x: W / 2 + 0.05, z: 0.2 }));
  return merge(parts).translate(0, 0, -0.5);
}

// L (wide) · A ridge of reef right across the path: rock crowded with low
// coral, nothing on it higher than a jump.
function ridgeGeo() {
  const parts = [];
  const rnd = seeded(23);
  for (let i = 0; i < 9; i++) {
    const x = -4.2 + i * 1.05;
    parts.push(boulder({ r: 0.72 + rnd() * 0.15, sx: 1.2, sy: 0.55, sz: 1.0, x, seed: 30 + i, mark: 0.45 }));
  }
  const tints = [C.coralO, C.coralY, C.coralP, C.coralR];
  for (let i = 0; i < 6; i++) parts.push(...brainParts({ r: 0.32 + rnd() * 0.12, color: tints[i % 4], x: -3.7 + i * 1.5 + rnd() * 0.3, y: 0.42, z: (rnd() - 0.5) * 0.4, sy: 0.75 }));
  for (let i = 0; i < 4; i++) parts.push(...moved(anemoneParts({ r: 0.2, len: 0.22, n: 10, seed: 50 + i, tint: 0, color: i % 2 ? C.anemone : '#5ac8b8', tip: i % 2 ? C.anemoneTip : '#e8fff4' }), { x: -3 + i * 2.1, y: 0.4, z: 0.2 }));
  return merge(parts).translate(0, 0, -0.65);
}

// H · An arch of rock crusted with coral, its underside on the duck line:
// two posts and a lintel, brain coral, staghorn and a little fan on top.
function archGeo(half) {
  const D = CONFIG.duckLine;
  const parts = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) parts.push(boulder({ r: 0.36 - i * 0.03, sx: 1, sy: 0.9, sz: 1, x: s * half, y: i * 0.62, seed: 70 + i + (s > 0 ? 5 : 0), mark: 0.5 }));
  }
  // the lintel: a slab of rock, nothing of it below the duck line
  const slab = P.box(half * 2 + 0.7, 0.6, 0.9, 6, 2, 2);
  const sp = slab.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const k = Math.sin(sp.getX(i) * 7.1 + sp.getZ(i) * 3.3) * 0.5 + 0.5;
    if (sp.getY(i) > 0) sp.setY(i, sp.getY(i) + k * 0.18);
  }
  slab.computeVertexNormals();
  parts.push(part(slab, null, { y: D + 0.3, grad: [C.rock, C.mossHi, D, D + 0.85], mark: 0.6 }));
  // a fringe of coral along its face, so the gap beneath it shows
  for (let i = 0; i < 7; i++) parts.push(...moved(brainParts({ r: 0.13 + (i % 3) * 0.03, color: [C.coralO, C.coralP, C.coralY][i % 3], sy: 0.9 }), { x: -half - 0.2 + i * ((half * 2 + 0.4) / 6), y: D + 0.3, z: 0.42, rx: Math.PI / 2 }));
  parts.push(...brainParts({ r: 0.42, color: C.coralY, x: -half * 0.5, y: D + 0.62, sy: 0.8 }));
  parts.push(...moved(staghornParts({ h: 0.9, color: C.coralP, seed: 9, trunks: 3 }), { x: half * 0.45, y: D + 0.62 }));
  parts.push(...moved(fanParts({ w: 0.9, h: 1.0, seed: 4, holes: 6 }), { x: 0.05, y: D + 0.6, z: -0.25 }));
  return merge(parts).translate(0, 0, -0.45);
}

// W · A clump of kelp too thick to run through, rising from its holdfast.
function kelpWallGeo() {
  return merge([
    boulder({ r: 0.85, sx: 1.1, sy: 0.75, seed: 19, mark: 0.5 }),
    ...moved(kelpParts({ h: 8.5, stalks: 9, blades: 13, seed: 17, spread: 0.55, blade: 0.5 }), { y: 0.35 }),
    ...moved(seagrassParts({ n: 12, h: 1.4, seed: 8 }), { z: 0.3 }),
  ]).translate(0, 0, -0.6);
}

// W · A tower of rock crowded with coral.
function towerGeo() {
  const parts = [];
  parts.push(boulder({ r: 0.85, sx: 1.05, sy: 0.9, seed: 81, mark: 0.5 }));
  parts.push(boulder({ r: 0.72, sy: 1.0, y: 1.25, seed: 82, mark: 0.5 }));
  parts.push(boulder({ r: 0.55, sy: 1.0, y: 2.25, seed: 83, mark: 0.5 }));
  parts.push(...moved(tableParts({ r: 0.95, h: 0.4, seed: 4, color: C.coralY }), { y: 3.0 }));
  parts.push(...moved(staghornParts({ h: 1.0, color: C.coralP, seed: 12, trunks: 3 }), { x: 0.5, y: 1.9, z: 0.4 }));
  parts.push(...brainParts({ r: 0.4, color: C.coralO, x: -0.55, y: 1.0, z: 0.5, sy: 0.85 }));
  parts.push(...moved(anemoneParts({ r: 0.22, len: 0.3, n: 12, seed: 3, tint: 0 }), { x: 0.35, y: 0.95, z: 0.62 }));
  return merge(parts).translate(0, 0, -0.75);
}

// W · A great sea fan, a wall of violet lace on a rock.
function fanWallGeo() {
  return merge([
    boulder({ r: 0.6, sx: 1.4, sy: 0.6, seed: 91, mark: 0.4 }),
    ...moved(fanParts({ w: 2.0, h: 3.0, seed: 21, holes: 22, t: 0.08 }), { y: 0.45 }),
  ]).translate(0, 0, -0.4);
}

// --- the doorway out ----------------------------------------------------------------
// A great arch of rock, crusted with coral and furred with weed, a giant
// scallop shell at its crown, sea fans and anemones at its feet, and cliffs
// of rock either side that hide what lies beyond.
function scallopParts(r = 1.8) {
  const parts = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = 0.12 + (i / (n - 1)) * (Math.PI - 0.24);
    const g = P.cone(r * 0.17, r, 4, 1);
    g.translate(0, r / 2, 0);
    g.scale(1, 1, 0.35);
    g.rotateZ(a - Math.PI / 2);
    parts.push(part(g, null, { grad: [C.shellLo, C.shell, 0, r], outline: 0.6 }));
  }
  parts.push(part(P.box(r * 0.5, r * 0.3, 0.3), C.shellLo, { y: r * 0.05 }));
  return parts;
}
function gateGeo(opening, depth) {
  const parts = [...gateFrameParts(opening, { thick: 1.5, depth, color: C.rock, mark: 0.6 })];
  const top = gateTop(opening);
  parts.push(...moved(scallopParts(2.2), { y: top + 0.4, z: depth / 2 + 0.1 }));
  const rnd = seeded(5);
  // coral crusting the arch
  for (let i = 0; i < 12; i++) {
    const a = 0.1 + (i / 11) * (Math.PI - 0.2);
    const R = opening.halfW + 0.75;
    const x = Math.cos(a) * R;
    const y = opening.rectH + Math.sin(a) * R;
    if (Math.abs(x) < 1.6 && y > top - 0.5) continue;
    parts.push(...brainParts({ r: 0.35 + rnd() * 0.25, color: [C.coralO, C.coralY, C.coralP, C.coralR][i % 4], x, y: y - 0.1, z: depth / 2 - 0.1, sy: 0.9 }));
  }
  for (const s of [-1, 1]) {
    const fx = s * (opening.halfW + 0.75);
    parts.push(...moved(fanParts({ w: 1.6, h: 2.2, seed: s > 0 ? 3 : 8, color: s > 0 ? C.coralV : C.coralR }), { x: fx + s * 0.6, z: depth / 2 + 0.3 }));
    parts.push(...moved(anemoneParts({ r: 0.32, seed: s > 0 ? 2 : 6, tint: 0 }), { x: fx - s * 0.2, z: depth / 2 + 0.6 }));
    parts.push(...moved(staghornParts({ h: 1.6, seed: s > 0 ? 4 : 9, color: C.coralO }), { x: fx, y: opening.rectH * 0.55, z: depth / 2 + 0.15 }));
    parts.push(...moved(spongeParts({ n: 4, h: 1.4, seed: s > 0 ? 3 : 5 }), { x: fx + s * 1.4, z: depth / 2 + 0.2 }));
    // the cliffs either side, and boulders heaped at their feet
    const w = 60;
    parts.push(part(P.box(w, 16, 4, 6, 3, 1), null, { x: s * (opening.halfW + 1.45 + w / 2), y: 8, z: -1.6, grad: [C.rockLo, C.rock, 0, 16], mark: 0.6, uvScale: [w / 4, 4] }));
    for (let i = 0; i < 6; i++) parts.push(boulder({ r: 1.6 + rnd() * 1.4, sy: 0.8, x: s * (opening.halfW + 3 + i * 4.5 + rnd() * 2), y: 0, z: 0.5 + rnd(), seed: 100 + i + (s > 0 ? 20 : 0), detail: 1 }));
    // (boulders heaped up the cliff face, breaking it up)
    for (let i = 0; i < 7; i++) parts.push(boulder({ r: 1.3 + rnd() * 1.3, sx: 1.3, sy: 0.9, x: s * (opening.halfW + 2.6 + rnd() * 18), y: 2.5 + rnd() * 10, z: -0.2 + rnd() * 0.6, seed: 140 + i + (s > 0 ? 20 : 0), detail: 1 }));
    for (let i = 0; i < 4; i++) parts.push(part(P.sphere(3.4, 10, 5, 0, TAU, 0, Math.PI / 2), null, { x: s * (opening.halfW + 4 + i * 8), y: 15.6, z: -1.4, sy: 0.4, grad: [C.moss, C.mossHi, 15.6, 17], mark: 0.9 }));
  }
  return merge(parts);
}

const OPENING = { halfW: 4.5, rectH: 6.6, arch: true };
const GATE_DEPTH = 1.8;

// --- gems -------------------------------------------------------------------------
// Coral-pink stones against all that teal: the conch pearl above all — the
// sea's own gem, porcelain pink, polished smooth — whole and baroque, with
// the sea's other warm stones found alongside it: branches of red precious
// coral, fire opal flecked with gold, spessartine garnet, and rhodochrosite
// banded rose and pink. The crown: a great conch pearl in a scallop shell.
const OPAL = { speckle: 0.65, second: '#ffe680', mottle: 0.35, glints: 1.5, scale: 9 };
const GEM = {
  name: 'conch pearl',
  color: '#ff8f80',
  light: '#ffb2a2',
  stones: [
    {
      name: 'conch pearl',
      weight: 3,
      tints: ['#ff9a8a'],
      parts: () => [metal(P.sphere(0.18, 16, 12), '#ff8a78', { sx: 1.0, sy: 0.84, sz: 0.9 })],
      texture: {},
    },
    {
      name: 'baroque conch pearl',
      weight: 1.2,
      tints: ['#ffa898'],
      parts: () => lumps({ n: 3, r: 0.14, spread: 0.12, seed: 6 }).map((g) => metal(g, '#ff9484')),
      texture: {},
    },
    {
      // precious coral: polished red branches
      name: 'red coral',
      weight: 1.2,
      tints: ['#ff5a48'],
      parts: () => [
        metal(P.capsule(0.055, 0.32, 3, 8), '#f2503e', { rz: 0.2 }),
        metal(P.capsule(0.045, 0.18, 3, 8), '#f2503e', { x: 0.1, y: 0.08, rz: -0.7 }),
        metal(P.capsule(0.04, 0.14, 3, 8), '#f4604a', { x: -0.1, y: 0.04, rz: 0.9 }),
      ],
      texture: {},
    },
    {
      name: 'fire opal',
      weight: 1.2,
      tints: ['#ff7a3c', '#ff8a4a', '#ff6a34'],
      parts: () => [crystal(nugget({ r: [0.2, 0.15, 0.17], faces: 22, spread: 0.08, chips: 1, seed: 33 }))],
      texture: OPAL,
    },
    {
      name: 'spessartine',
      weight: 1,
      tints: ['#ff6a30', '#ff7a3a'],
      parts: () => [crystal(dodecahedron({ r: 0.17, seed: 5 }), { rx: 0.4, rz: 0.3 })],
      texture: { rough: 0.06, glints: 1.5 },
    },
    {
      name: 'rhodochrosite',
      weight: 1,
      tints: ['#ff7f9a', '#ff8aa4'],
      parts: () => [crystal(nugget({ r: [0.2, 0.14, 0.18], faces: 18, spread: 0.1, chips: 2, seed: 61 }))],
      texture: { bands: 0.6, bandFreq: 16, rings: 'round', second: '#ffe0ea', opaque: 0.55, glints: 0.9 },
    },
  ],
  crown: {
    name: 'conch pearl in a scallop shell',
    tints: ['#ffa898'],
    parts: () => [
      ...moved(scallopParts(0.36), { rx: FACE * 0.55, y: -0.2, z: -0.05 }),
      metal(P.sphere(0.17, 16, 12), '#ff8a78', { y: -0.04, z: 0.08, sx: 1.0, sy: 0.88, sz: 0.92 }),
    ],
    texture: {},
  },
  // (bobbing slowly in the water)
  motion: [0.7, 1.0, 0.1, 0.14],
  look: [0.78, 1.15, 0.25, 0.3],
  // (the pearls and the coral keep their pink under the teal water)
  polish: 0.7,
  glow: 0.7,
  pool: 0.26,
};

const RAY = [-0.16, 1, 0.24];
const WHALE_CROSS = [0.14, 1.6, 0.85, 0.6];
const JELLY_TINTS = [[1, 1, 1], [1, 0.82, 0.92], [0.9, 1, 1]];

export default {
  id: 'ocean',
  name: 'The Kelp Deep',
  doorColor: '#2fc4b2',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  env: {
    // the screen is splashed coming in (see game/splash.js), and bubbles and
    // swirling water follow the runner (see game/bubbles.js)
    splash: true,
    bubbles: 1,
    sky: ['#93ead6', '#1c9488', '#0a3a46'],
    bloom: ['#3fe0c8', '#b0f8e0', '#ffffff'],
    // the sun, high overhead, a bright blur through the surface
    sun: { dir: [0.12, 0.92, -0.38], glow: '#c8fff0', disc: '#f4fffa' },
    stars: 0,
    skyFx: { rays: 0, clouds: 0 },
    sea: { surface: 1, rays: 0.9, caustics: 0.48, scale: 0.25 },
    // light from far overhead, softened and scattered by the water: gentle
    // shade tinted teal, a cool green rim
    light: { dir: [0.18, 0.93, -0.3], shadow: [0.4, 0.6, 0.64], hi: [1.04, 1.1, 1.0], soft: 0.14, wrap: 0.4, hiAmt: 0.35, lift: 1 },
    rim: [0.55, 1.0, 0.88, 0.32],
    mist: { color: '#1a8a80', amount: 0.42, top: 3, fade: 4, near: 20, far: 100 },
    grade: { sat: 1.1, contrast: 1.04, vignette: 0.45, edge: [0.35, 1.0], exposure: 1.02, tint: '#032a33' },
    // darker and bluer the further down the screen
    deep: { amount: 0.62, from: 0.3, to: 1.05, tint: '#24546e' },
    ink: '#0d3a44',
    fog: [26, 165],
    ground: [C.sandA, C.sandB, C.bed],
    shadowDecal: [0.5, 0.7, 0.72],
    cast: [0.06, 0.2],
    glowGain: 1.0,
    pool: '#9af0dc',
    beam: { color: '#d4fff0', amount: 0.3 },
    // marine snow drifting, bubbles rising through it
    particles: { color: '#eafff6', size: 1.5, drift: [0.06, 0.12, 0], opacity: 0.5 },
    particles2: { color: '#f0fffc', size: 3.4, drift: [0.1, 1.6, 0], opacity: 0.8, ring: 1 },
  },

  visits: [
    // the twilight reef: blue dusk, the light from above fading, jellyfish
    // glowing everywhere and plankton lit up in the water
    {
      env: {
        sky: ['#3a6aa8', '#123a6a', '#030c22'],
        sun: { dir: [-0.2, 0.9, -0.4], glow: '#9ad0ff', disc: '#e8f4ff' },
        sea: { surface: 0.6, rays: 0.45, caustics: 0.3 },
        light: { shadow: [0.3, 0.38, 0.62], hi: [0.9, 0.98, 1.15] },
        rim: [0.5, 0.72, 1.0, 0.4],
        mist: { color: '#14306a', amount: 0.5 },
        grade: { exposure: 0.9, vignette: 0.6, tint: '#020818' },
        deep: { amount: 0.6, tint: '#1a2a60' },
        ground: ['#c8d0d0', '#aeb8c0', '#1a3a5a'],
        glowGain: 1.4,
        pool: '#7ab0ff',
        particles: { color: '#7affe0', size: 2.2, drift: [0.04, 0.1, 0], opacity: 0.9 },
      },
    },
    // the deep at midnight: almost no light from above, everything alive
    // glowing — anemones, jellyfish, plankton
    {
      env: {
        sky: ['#08183a', '#04122a', '#000208'],
        sea: { surface: 0.25, rays: 0.15, caustics: 0 },
        light: { shadow: [0.22, 0.28, 0.46], hi: [0.75, 0.9, 1.15], soft: 0.08 },
        rim: [0.3, 0.9, 1.0, 0.5],
        mist: { color: '#04122a', amount: 0.6 },
        grade: { exposure: 0.82, vignette: 0.75, tint: '#000000' },
        ground: ['#8a96a4', '#748296', '#0c1e34'],
        glowGain: 1.8,
        particles: { color: '#5affd0', size: 2.6, drift: [0.04, 0.1, 0], opacity: 1 },
        particles2: { color: '#9affff', size: 3.0, drift: [0.1, 1.4, 0], opacity: 0.5, ring: 1 },
      },
    },
    { env: { trip: [0.08, 0.3, 0.12] } },
  ],

  build(b) {
    const SWAY = { anim: 'pop', ink: 0.03 };
    b.ground('ground', seabedStrip(), 9);
    b.toon('seagrass', merge(seagrassParts({ seed: 2 })), { cap: 90, anim: 'pop', ink: 0, side: THREE.DoubleSide, current: [5, 1.4, 1.2, 3] });
    b.toon('anemone', merge(anemoneParts({ seed: 4 })), { ...SWAY, cap: 60, current: [3, 1.6, 2.0, 2] });
    b.toon('coralHead', merge(brainParts({ r: 0.6, color: '#ffffff', tint: 1 })), { cap: 60, anim: 'pop', ink: 0.035 });
    b.toon('staghorn', merge(staghornParts({ seed: 5, color: '#ffffff', tip: '#ffffff', tint: 1 })), { cap: 50, anim: 'pop', ink: 0.03 });
    b.toon('table', merge(tableParts({ seed: 2, color: '#ffffff', tint: 1 })), { cap: 40, anim: 'pop', ink: 0.035 });
    b.toon('sponge', merge(spongeParts({ seed: 3, color: '#ffffff', tint: 1 })), { cap: 40, anim: 'pop', ink: 0.03 });
    b.toon('fanSmall', merge(fanParts({ seed: 7, color: '#ffffff', tint: 1 })), { cap: 40, anim: 'pop', ink: 0.03 });
    b.toon('rockSmall', merge([boulder({ r: 0.8, sy: 0.6, seed: 3 })]), { cap: 50, anim: 'pop', ink: 0.04 });
    b.toon('reef', merge(reefParts(1)), { cap: 30, anim: 'pop', ink: 0.035 });
    b.toon('reefB', merge(reefParts(6)), { cap: 30, anim: 'pop', ink: 0.035 });
    b.toon('kelp', merge(kelpParts({ h: 13, seed: 3, flat: true })), { cap: 70, anim: 'rise', ink: 0, side: THREE.DoubleSide, current: [0.9, 0.55, 0.32, 0.5] });
    b.toon('kelpB', merge(kelpParts({ h: 17, stalks: 4, blades: 13, seed: 8, flat: true })), { cap: 50, anim: 'rise', ink: 0, side: THREE.DoubleSide, current: [1.1, 0.48, 0.28, 0.6] });
    b.toon('stack', merge(stackParts({ seed: 2 })), { cap: 30, anim: 'liftFar', ink: 0.05 });
    b.toon('stackB', merge(stackParts({ seed: 9, h: 10 })), { cap: 30, anim: 'liftFar', ink: 0.05 });
    b.toon('rockArch', merge(rockArchParts()), { cap: 6, anim: 'liftFar', ink: 0.05 });
    // schools: silver fish streaming by, dark shoals in the distance, bait
    // balls milling, and columns of bubbles from vents in the reef
    const silver = () => fishParts({ len: 0.42 });
    const dark = () => fishParts({ len: 0.6, back: C.fishDark, belly: '#2a5a62', deep: 0.42 });
    b.toon('school', schoolGeo({ n: 70, mode: 0, L: 36, H: 1.4, W: 2.2, make: silver, seed: 3 }), { cap: 30, ink: 0, school: [3.2, 36, 1.8, 0] });
    b.toon('schoolDark', schoolGeo({ n: 46, mode: 0, L: 44, H: 2.4, W: 3.4, make: dark, seed: 7 }), { cap: 24, ink: 0, school: [2.4, 44, 3, 0] });
    b.toon('baitball', schoolGeo({ n: 110, mode: 1, L: 40, H: 1.6, R: 3, make: () => fishParts({ len: 0.26 }), seed: 11 }), { cap: 10, ink: 0, school: [3.6, 40, 0, 1] });
    b.toon('bubbles', schoolGeo({ n: 26, mode: 2, L: 14, W: 0.5, make: (r) => [part(P.sphere(0.05 + r() * 0.07, 6, 4), '#e8fffa', { emit: 0.7, outline: 0 })], seed: 5 }), { cap: 16, ink: 0, school: [1.8, 14, 0, 2] });
    b.toon('jelly', merge(jellyParts()), { cap: 50, anim: 'lift', ink: 0.018, side: THREE.DoubleSide, jelly: [0.5, 0.16, 1.0, 0.35], fly: [0, 0, 1.0, 0.1] });
    b.toon('manta', merge(mantaParts()), { cap: 6, anim: 'liftFar', ink: 0.035, fly: [0.75, 1.3, 2.0, 0.07] });
    b.toon('turtle', merge(turtleParts()), { cap: 8, anim: 'lift', ink: 0.035, fly: [0.5, 1.6, 1.4, 0.1] });
    b.toon('whaleFar', merge(whaleParts()), { cap: 4, anim: 'liftFar', ink: 0.04, pleats: true, cross: [0, 1.3, 0.9, 0], fly: [0, 0, 3, 0.04] });
    b.beam('ray', merge(shaftParts({ len: 44, r0: 0.5, r1: 2.4, dir: RAY })), { cap: 60, anim: 'pop', wobble: [0.0011, 0, 0.3, 0] });
    b.glow('glow', { cap: 90, anim: 'pop' });
    b.pool('pool', { cap: 40, anim: 'pop' });
    b.shadow('shadow', { cap: 120, anim: 'pop' });

    b.toon('brain', brainGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('clam', clamGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('chest', chestGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });
    b.toon('ridge', ridgeGeo(), { cap: 10, anim: 'popEarly', ink: 0.04 });
    b.toon('arch', archGeo(0.95), { cap: 24, anim: 'popEarly', ink: 0.045 });
    // (the whale swims in from far off rather than unfolding)
    b.toon('whale', merge(whaleParts()).translate(0, 0, -1.75), { cap: 10, ink: 0.05, pleats: true, cross: WHALE_CROSS });
    b.shadow('whaleShadow', { cap: 10, plane: { w: 15.5, d: 4.8, x: -1.4, z: -1.75 }, cross: WHALE_CROSS });
    b.toon('kelpW', kelpWallGeo(), { cap: 24, anim: 'popEarly', ink: 0.03, current: [0.7, 0.6, 0.35, 0.4] });
    b.toon('tower', towerGeo(), { cap: 24, anim: 'popEarly', ink: 0.045 });
    b.toon('fanW', fanWallGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });

    b.toon('gateFrame', gateGeo(OPENING, GATE_DEPTH), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff', knob: '#f2a24b' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [
      { name: 'brain', len: 1.8, tints: [C.coralO, C.coralY, C.coralP, '#b07ad8'] },
      { name: 'clam', len: 1.1 },
      { name: 'chest', len: 1.0 },
    ],
    H: [{ name: 'arch', len: 0.9 }],
    W: [{ name: 'kelpW', len: 1.2 }, { name: 'tower', len: 1.5 }, { name: 'fanW', len: 0.8 }],
    LW: { name: 'ridge', len: 1.3 },
    // (it casts its own shadow, gliding with it)
    // (it sings as it comes)
    HW: { name: 'whale', with: ['whaleShadow'], len: 3.5, flat: true, call: 'whale' },
  },

  chunk(ctx) {
    const { rng } = ctx;
    const v = ctx.visit;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    const CORAL = [[0.96, 0.54, 0.31], [0.95, 0.78, 0.31], [0.95, 0.47, 0.6], [0.89, 0.34, 0.25], [0.64, 0.42, 0.84]];
    const tint = () => rng.pick(CORAL);
    // the kelp closes in thick on one side or the other for long stretches
    const forest = Math.sin(ctx.d0 * 0.0045 + 0.7);
    for (const s of [-1, 1]) {
      const z = () => rng.float(0, 16);
      // the reef's edge, right beside the sand
      for (let i = 0; i < 3; i++) {
        if (!rng.chance(0.7)) continue;
        const name = rng.weighted([['coralHead', 3], ['staghorn', 2], ['anemone', 2], ['sponge', 1.2], ['fanSmall', 1.2], ['table', 1], ['rockSmall', 1.2]]);
        const x = s * rng.float(5.3, 9);
        const zz = z();
        ctx.put(name, x, 0, zz, { ry: rng.float(0, 6.28), s: rng.float(0.7, 1.25), c: name === 'anemone' ? rng.pick([[1, 0.62, 0.55], [0.4, 0.85, 0.78], [1, 0.8, 0.45]]) : tint(), p0: rng.float(0, 1) });
        // in the deep at midnight, the anemones glow
        if (v >= 2 && name === 'anemone') ctx.put('glow', x, 0.6, zz, { s: 2.2, c: [0.3, 0.9, 0.8] });
      }
      if (rng.chance(0.85)) ctx.put('seagrass', s * rng.float(4.9, 9), 0, z(), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.4), p0: rng.float(0, 1) });
      if (rng.chance(0.5)) ctx.put('seagrass', s * rng.float(7, 13), 0, z(), { ry: rng.float(0, 6.28), s: rng.float(1, 1.6), p0: rng.float(0, 1) });
      // mounds of reef a little way off
      if (rng.chance(0.55)) ctx.put(rng.chance(0.5) ? 'reef' : 'reefB', s * rng.float(10, 17), 0, z(), { ry: rng.float(0, 6.28), s: rng.float(0.8, 1.3) });
      // kelp: here and there, and in places a forest of it
      const dense = (s > 0) === (forest > 0) && Math.abs(forest) > 0.3;
      const nk = dense ? 3 : rng.chance(0.55) ? 1 : 0;
      for (let i = 0; i < nk; i++) {
        ctx.put(rng.chance(0.55) ? 'kelp' : 'kelpB', s * rng.float(dense ? 9.5 : 12, dense ? 28 : 36), 0, z(), { ry: rng.float(0, 6.28), s: rng.float(0.85, 1.3), p0: rng.float(0, 1) });
      }
      // stacks and arches of rock looming out of the murk
      if (rng.chance(0.3)) ctx.put(rng.chance(0.5) ? 'stack' : 'stackB', s * rng.float(26, 75), 0, z(), { ry: rng.float(0, 6.28), s: rng.float(0.9, 1.7) });
      if (rng.chance(0.035)) ctx.put('rockArch', s * rng.float(45, 85), 0, z(), { ry: rng.float(-0.5, 0.5) + Math.PI / 2, s: rng.float(1.2, 1.8) });
      // schools streaming alongside (with you or toward you), dark shoals
      // further off, now and then a bait ball turning
      const along = () => (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) + rng.float(-0.45, 0.45);
      if (rng.chance(0.22)) ctx.put('school', s * rng.float(6.5, 15), rng.float(2.5, 7), z(), { ry: along(), p0: rng.float(0, 100) });
      if (rng.chance(0.16)) ctx.put('schoolDark', s * rng.float(20, 42), rng.float(5, 15), z(), { ry: along(), p0: rng.float(0, 100), s: rng.float(1, 1.4) });
      if (rng.chance(0.045)) ctx.put('baitball', s * rng.float(15, 28), rng.float(5, 10), z(), { p0: rng.float(0, 100), s: rng.float(0.9, 1.3) });
      // jellyfish drifting, glowing (many more at twilight and midnight)
      if (rng.chance(v >= 1 ? 0.38 : 0.13)) {
        const x = s * rng.float(5.5, 22);
        const y = rng.float(4.5, 13);
        const zz = z();
        const k = rng.float(0.7, 1.35);
        ctx.put('jelly', x, y, zz, { s: k, c: rng.pick(JELLY_TINTS), p0: rng.float(0, 6.28) });
        ctx.put('glow', x, y + 0.3 * k, zz, { s: 4.2 * k, c: v >= 1 ? [1, 0.55, 0.65] : [0.55, 0.4, 0.42] });
      }
      // a column of bubbles rising from a vent in the reef
      if (rng.chance(0.07)) ctx.put('bubbles', s * rng.float(6, 14), 0, z(), { p0: rng.float(0, 100) });
      // shafts of light slanting down out of the surface, pooling on the sand
      if (rng.chance(0.38)) {
        const x = s * rng.float(3, 16);
        const zz = z();
        const k = rng.float(0.55, 1);
        ctx.put('ray', x, 19, zz, { c: [k, k, k], s: rng.float(0.8, 1.3), p0: rng.float(0, 6.28) });
        ctx.put('pool', x + 3.0, 0.06, zz + 4.5, { sx: 7, sz: 7, c: [k * 0.35, k * 0.35, k * 0.35] });
      }
      if (rng.chance(0.03)) ctx.put('turtle', s * rng.float(7, 16), rng.float(3.5, 8), z(), { ry: along() + Math.PI / 2, s: rng.float(1, 1.4), p0: rng.float(0, 6.28) });
    }
    // over the road: a shaft of light, a manta gliding overhead, and far off,
    // a whale
    if (rng.chance(0.22)) {
      const k = rng.float(0.5, 0.85);
      ctx.put('ray', rng.float(-3, 3), 19, rng.float(0, 16), { c: [k, k, k], s: rng.float(0.8, 1.2), p0: rng.float(0, 6.28) });
    }
    if (rng.chance(0.045)) ctx.put('manta', rng.float(-9, 9), rng.float(9, 13), rng.float(0, 16), { ry: rng.float(-0.7, 0.7) + (rng.chance(0.5) ? 0 : Math.PI), s: rng.float(1, 1.5), p0: rng.float(0, 6.28) });
    if (ctx.index % 11 === 6 && rng.chance(0.5)) {
      const s = rng.chance(0.5) ? -1 : 1;
      ctx.put('whaleFar', s * rng.float(45, 90), rng.float(12, 28), rng.float(0, 16), { ry: rng.float(-0.6, 0.6) + (rng.chance(0.5) ? 0 : Math.PI), s: rng.float(1.1, 1.6), p0: rng.float(0, 6.28) });
    }
  },
};

// The ocean floor: one strip out to the murk (the sand path is laid through
// it by the ground pattern itself).
function seabedStrip() {
  const g = new THREE.PlaneGeometry(260, 16, 1, 8);
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
