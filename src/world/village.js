import {
  P, part, merge, mix,
  cypressParts, bushParts, lanternPostParts, potParts, gateFrameParts, gateLeafParts, gateTop,
} from './shapes.js';
import { groundStrip } from '../render/geo.js';

// I · The Cypress Lane — tall bullet-shaped cypresses in lime and deep green,
// little mossy-roofed houses in mustard, mint and teal, round hedges, a
// cobbled lane. Art direction straight from the green forest reference.

const C = {
  leafLo: '#3a8a2c',
  leafHi: '#c6e43c',
  bushLo: '#5aa82e',
  bushHi: '#c4e84a',
  trunk: '#46561f',
  stone: '#e2dbb4',
  stoneDark: '#a8a27c',
  mossLo: '#5d9f2a',
  moss: '#a6d63c',
  frame: '#1f4a2c',
  glass: '#29483a',
  lit: '#ffd77a',
  door: '#7a4e26',
  wood: '#b07a40',
  woodDark: '#6e4a26',
  terracotta: '#c8693a',
  canopy: '#f2c84b',
  cream: '#fff3d0',
  orange: '#f28a2a',
  grass: '#5ea83a',
};
const HOUSE_TINTS = ['#f2c64b', '#8fe0b8', '#45b89a', '#e9b43a', '#bfe7a0', '#6fcfa8', '#f6d873', '#9ad86a'];

const OPENING = { halfW: 4.6, rectH: 8.2, arch: true };
const GATE_DEPTH = 1.8;

function houseGeo({ w, h, d, roofH, floors, cols, lit, chimney, seed }) {
  const parts = [];
  parts.push(part(P.box(w, h, d), '#ffffff', { y: h / 2, tint: 1 }));
  parts.push(part(P.box(w + 0.14, 0.4, d + 0.14), C.stoneDark, { y: 0.2 }));
  // mossy gable roof with a soft overhang
  parts.push(part(P.prism(w + 0.7, roofH, d + 0.6), null, { y: h, grad: [C.mossLo, C.moss, h, h + roofH], mark: 0.7, uvScale: [0.6, 0.6] }));
  parts.push(part(P.box(w + 0.75, 0.22, d + 0.65), C.mossLo, { y: h + 0.05, mark: 0.5 }));
  if (chimney) parts.push(part(P.box(0.5, 1.4, 0.5), C.stoneDark, { x: w * 0.25, y: h + roofH * 0.6, z: -d * 0.15 }));
  let k = seed;
  const rnd = () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
  const floorH = (h - 0.6) / floors;
  const win = (x, y, z, ry) => {
    const isLit = rnd() < lit;
    parts.push(part(P.box(0.86, 1.08, 0.12), C.frame, { x, y, z, ry }));
    parts.push(part(P.box(0.62, 0.84, 0.16), isLit ? C.lit : C.glass, { x, y, z, ry, emit: isLit ? 1 : 0, outline: 0.4 }));
  };
  for (let f = 0; f < floors; f++) {
    const y = 0.6 + floorH * (f + 0.55);
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * (w / cols);
      if (f === 0 && c === Math.floor(cols / 2) && cols % 2 === 1) continue;
      win(x, y, d / 2 + 0.02, 0);
    }
    win(w / 2 + 0.02, y, 0, Math.PI / 2);
    win(-w / 2 - 0.02, y, 0, Math.PI / 2);
  }
  // front door with a little awning
  const dx = cols % 2 === 1 ? 0 : w * 0.25;
  parts.push(part(P.box(0.95, 1.75, 0.14), C.frame, { x: dx, y: 0.95, z: d / 2 + 0.02 }));
  parts.push(part(P.box(0.75, 1.6, 0.18), C.door, { x: dx, y: 0.88, z: d / 2 + 0.02 }));
  parts.push(part(P.box(1.25, 0.12, 0.6), C.mossLo, { x: dx, y: 1.95, z: d / 2 + 0.3, mark: 0.4 }));
  return merge(parts);
}

function hedgeGeo(width) {
  const r = 0.42;
  const parts = [
    part(P.box(width, 0.62, 0.9), null, { y: 0.31, grad: [C.bushLo, C.bushHi, 0, 1], mark: 0.85, tint: 1, uvScale: [width / 1.6, 0.4] }),
    part(P.cyl(r, r, width, 12), null, { y: 0.55, rz: Math.PI / 2, grad: [C.bushLo, C.bushHi, 0.2, 1.0], mark: 0.85, tint: 1, uvScale: [1.2, width / 1.6] }),
  ];
  const n = Math.round(width * 2.2);
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + 0.2 + ((width - 0.4) * (i + 0.5)) / n;
    const z = Math.sin(i * 7.1) * 0.25;
    parts.push(part(P.sphere(0.07, 6, 4), i % 3 === 0 ? '#ffe36a' : '#ffffff', { x, y: 0.94 + Math.sin(i * 3.3) * 0.03, z, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.45);
}

function cratesGeo() {
  const parts = [];
  const crate = (x, w, h, d, ry) => {
    parts.push(part(P.box(w, h, d), C.wood, { x, y: h / 2, ry }));
    for (const yy of [0.18, h - 0.18]) parts.push(part(P.box(w + 0.04, 0.1, d + 0.04), C.woodDark, { x, y: yy, ry, outline: 0.5 }));
  };
  crate(-0.48, 0.9, 0.78, 0.86, 0.1);
  crate(0.5, 0.82, 0.62, 0.8, -0.12);
  for (let i = 0; i < 7; i++) {
    parts.push(part(P.sphere(0.12, 8, 6), C.orange, { x: 0.38 + (i % 3) * 0.2 - 0.1, y: 0.7 + Math.floor(i / 3) * 0.06, z: (i % 2) * 0.2 - 0.12, outline: 0.6 }));
  }
  return merge(parts).translate(0, 0, -0.45);
}

function signGeo() {
  const parts = [
    part(P.box(0.16, 2.55, 0.16), C.woodDark, { x: -0.98, y: 1.27 }),
    part(P.box(0.16, 2.55, 0.16), C.woodDark, { x: 0.98, y: 1.27 }),
    part(P.box(2.3, 0.18, 0.2), C.wood, { y: 2.42 }),
    part(P.box(1.56, 0.74, 0.1), C.woodDark, { y: 1.62 }),
    part(P.box(1.4, 0.6, 0.14), C.canopy, { y: 1.62 }),
    part(P.sphere(0.2, 10, 8), C.leafLo, { y: 1.62, z: 0.06, sz: 0.3 }),
    part(P.box(0.03, 0.42, 0.03), '#333', { x: -0.55, y: 2.12, outline: 0 }),
    part(P.box(0.03, 0.42, 0.03), '#333', { x: 0.55, y: 2.12, outline: 0 }),
  ];
  return merge(parts).translate(0, 0, -0.15);
}

function pergolaGeo() {
  const parts = [];
  for (const x of [-3.95, 3.95]) parts.push(part(P.box(0.24, 2.9, 0.24), C.woodDark, { x, y: 1.45 }));
  parts.push(part(P.box(8.4, 0.22, 0.3), C.wood, { y: 2.8 }));
  parts.push(part(P.box(8.4, 0.16, 0.24), C.wood, { y: 2.45, z: 0.25 }));
  const n = 13;
  for (let i = 0; i < n; i++) {
    const x = -3.6 + (7.2 * i) / (n - 1);
    parts.push(part(P.sphere(0.46, 9, 7), null, { x, y: 1.76 + Math.sin(i * 1.7) * 0.06, sy: 0.95, grad: [C.bushLo, C.bushHi, 1.3, 2.3], mark: 0.85, tint: 1 }));
    if (i % 2 === 0) parts.push(part(P.sphere(0.09, 6, 4), i % 4 === 0 ? '#ffffff' : '#ffb3c8', { x: x + 0.15, y: 1.5, z: 0.35, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.2);
}

function cartGeo() {
  const parts = [];
  const L = 3.0;
  parts.push(part(P.box(1.7, 0.8, L), C.wood, { y: 0.95 }));
  parts.push(part(P.box(1.76, 0.12, L + 0.06), C.woodDark, { y: 1.38 }));
  for (const z of [-L * 0.3, L * 0.3]) {
    for (const x of [-0.92, 0.92]) parts.push(part(P.cyl(0.46, 0.46, 0.12, 12), C.woodDark, { x, y: 0.46, z, rz: Math.PI / 2 }));
  }
  for (const x of [-0.78, 0.78]) {
    for (const z of [-L / 2 + 0.1, L / 2 - 0.1]) parts.push(part(P.box(0.08, 1.4, 0.08), C.woodDark, { x, y: 2.05, z }));
  }
  // striped canopy
  parts.push(part(P.prism(2.1, 0.6, L + 0.4), C.canopy, { y: 2.72 }));
  for (let i = 0; i < 5; i++) {
    parts.push(part(P.box(2.14, 0.08, 0.32), C.cream, { y: 2.74, z: -L / 2 + 0.1 + i * 0.7, outline: 0 }));
  }
  // produce
  for (let i = 0; i < 12; i++) {
    const z = -L / 2 + 0.35 + (i % 6) * 0.45;
    const x = i < 6 ? -0.35 : 0.35;
    parts.push(part(P.sphere(0.17, 8, 6), i % 3 === 0 ? C.canopy : C.orange, { x, y: 1.55, z, outline: 0.6 }));
  }
  return merge(parts).translate(0, 0, -L / 2);
}

function topiaryGeo() {
  const parts = [
    part(P.box(1.5, 0.9, 1.5), C.terracotta, { y: 0.45 }),
    part(P.box(1.62, 0.16, 1.62), '#a9532a', { y: 0.92 }),
    ...cypressParts({ h: 4.2, r: 0.78, lo: C.leafLo, hi: C.leafHi, trunkH: 1.05 }),
  ];
  return merge(parts).translate(0, 0, -0.75);
}

function gateGeo() {
  const top = gateTop(OPENING);
  const parts = [...gateFrameParts(OPENING, { thick: 1.35, depth: GATE_DEPTH, color: C.stone })];
  // keystone + cap
  parts.push(part(P.box(1.2, 1.5, GATE_DEPTH + 0.2), C.stoneDark, { y: top + 0.9 }));
  // ivy draped over the arch
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.12 + 0.76 * (i / 8));
    const R = OPENING.halfW + 0.7;
    parts.push(part(P.sphere(0.7 + (i % 3) * 0.12, 9, 7), null, { x: Math.cos(a) * R, y: OPENING.rectH + Math.sin(a) * R, z: 0.55, grad: [C.leafLo, C.leafHi, OPENING.rectH, top + 1.5], mark: 0.85, sz: 0.6 }));
  }
  // tall hedge walls running off to either side
  for (const s of [-1, 1]) {
    const w = 64;
    const x = s * (OPENING.halfW + 1.35 + w / 2 - 0.2);
    parts.push(part(P.box(w, 8.0, 2.6), null, { x, y: 4.0, grad: ['#2f7a2a', '#7fc236', 0, 9], mark: 0.85, uvScale: [w / 3.4, 8 / 3.4] }));
    parts.push(part(P.cyl(1.3, 1.3, w, 14), null, { x, y: 8.0, rz: Math.PI / 2, grad: ['#4f9a2e', '#a8d83a', 6.7, 9.3], mark: 0.85, uvScale: [2.4, w / 3.4] }));
    // lanterns on the gate pillars
    parts.push(...lanternPostParts({ h: 2.2 }).map((g) => g.translate(s * (OPENING.halfW + 0.65), 0, GATE_DEPTH / 2 + 0.5)));
  }
  return merge(parts);
}

export default {
  id: 'village',
  name: 'The Cypress Lane',
  doorColor: '#f2b93b',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  env: {
    sky: ['#7cbf46', '#e6f5a2', '#3d8a36'],
    sun: { dir: [-0.25, 0.3, -1], glow: '#fff3b0' },
    stars: 0,
    light: { dir: [-0.55, 0.78, 0.38], shadow: [0.56, 0.7, 0.66], hi: [1.1, 1.1, 0.9] },
    ink: '#163a1d',
    fog: [40, 190],
    ground: ['#cdc99a', '#b4b482', '#7d8452'],
    shadowDecal: [0.58, 0.7, 0.55],
    glowGain: 0.55,
    particles: { color: '#f2ff9a', size: 2.4, drift: [0, 0.22, 0], opacity: 0.85 },
  },

  build(b) {
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 1);
    b.toon('grass', groundStrip(420, 16, C.grass, 8, { y: -0.03, mark: 0.45 }), { ink: 0, cap: 40, marks: [0.3, 0.3] });
    b.toon('curb', merge([part(P.box(0.42, 0.32, 16, 1, 1, 8), C.stone, { y: 0.16, z: -8 })]), { cap: 80, ink: 0.03, anim: 'rise' });
    b.toon('bush', merge(bushParts({ r: 0.85, lo: C.bushLo, hi: C.bushHi })), { cap: 300, anim: 'pop', marks: [2.2, 1.6], wobble: [0.006, 0, 1.4, 0] });
    b.toon('houseA', houseGeo({ w: 2.9, h: 5.0, d: 3.0, roofH: 1.9, floors: 2, cols: 2, lit: 0.25, chimney: true, seed: 11 }), { cap: 80, anim: 'pop', marks: [1, 1] });
    b.toon('houseB', houseGeo({ w: 3.8, h: 4.1, d: 3.3, roofH: 2.0, floors: 2, cols: 3, lit: 0.3, chimney: false, seed: 23 }), { cap: 80, anim: 'pop', marks: [1, 1] });
    b.toon('cypress', merge(cypressParts({ h: 9.6, r: 1.5, lo: C.leafLo, hi: C.leafHi, trunk: C.trunk, seg: 9 })), { cap: 420, anim: 'pop', marks: [3, 2.6], wobble: [0.0007, 0, 1.2, 0], ink: 0.05 });
    b.toon('cypressFar', merge(cypressParts({ h: 9.6, r: 1.5, lo: C.leafLo, hi: C.leafHi, trunk: C.trunk, seg: 7, mark: 0.6 })), { cap: 260, anim: 'pop', marks: [3, 2.6], ink: 0 });
    b.toon('lamp', merge(lanternPostParts({ h: 3.1, pole: C.frame })), { cap: 40, anim: 'pop' });
    b.glow('glow', { cap: 60, anim: 'pop' });
    b.toon('flowers', merge([
      part(P.sphere(0.32, 8, 6), C.bushLo, { y: 0.2, sy: 0.6, mark: 0.6 }),
      part(P.sphere(0.09, 6, 4), '#ffffff', { x: 0.15, y: 0.42, outline: 0.5 }),
      part(P.sphere(0.09, 6, 4), '#ffe36a', { x: -0.12, y: 0.4, z: 0.1, outline: 0.5 }),
      part(P.sphere(0.09, 6, 4), '#ffb3c8', { x: 0.02, y: 0.44, z: -0.14, outline: 0.5 }),
    ]), { cap: 220, anim: 'pop', marks: [2, 2] });
    b.toon('pot', merge(potParts({ r: 0.4, h: 0.62 }).concat(bushParts({ r: 0.38 }).map((g) => g.translate(0, 0.5, 0)))), { cap: 80, anim: 'pop', marks: [2, 2] });
    b.shadow('shadow', { cap: 520, anim: 'pop' });

    // obstacles
    b.toon('hedge', hedgeGeo(1.9), { cap: 24, anim: 'popEarly', marks: [1, 1] });
    b.toon('hedgeWide', hedgeGeo(7.6), { cap: 10, anim: 'popEarly', marks: [1, 1] });
    b.toon('crates', cratesGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('sign', signGeo(), { cap: 24, anim: 'popEarly', marks: [2, 2] });
    b.toon('pergola', pergolaGeo(), { cap: 10, anim: 'popEarly', marks: [2.2, 1.6] });
    b.toon('cart', cartGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('topiary', topiaryGeo(), { cap: 24, anim: 'popEarly', marks: [3, 2.6] });

    // threshold
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, marks: [1, 1], ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'hedge', len: 0.9 }, { name: 'crates', len: 0.9 }],
    H: [{ name: 'sign', len: 0.35 }],
    W: [{ name: 'cart', len: 3.0 }, { name: 'topiary', len: 1.5 }],
    LW: { name: 'hedgeWide', len: 0.9 },
    HW: { name: 'pergola', len: 0.4 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    ctx.put('ground', 0, 0, 0);
    ctx.put('grass', 0, 0, 0);
    if (ctx.continuation) {
      // behind the gate only the treetops show above the hedge
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const sc = rng.float(1.4, 2.4);
          ctx.put('cypressFar', s * rng.float(8, 40), 0, rng.float(0, 16), { s: sc, sy: sc * rng.float(1.05, 1.3), c: [rng.float(0.7, 0.85), rng.float(0.84, 0.92), rng.float(0.76, 0.86)] });
        }
      }
      return;
    }
    for (const s of [-1, 1]) {
      ctx.put('curb', s * 4.62, 0, 0);
      const lampHere = (ctx.index + (s > 0 ? 1 : 0)) % 3 === 0;
      // hedge balls along the lane
      for (let i = 0; i < 4; i++) {
        const dz = 1.5 + i * 3.8 + rng.float(-0.6, 0.6);
        if (lampHere && Math.abs(dz - 8) < 1.6) continue;
        const sc = rng.float(0.75, 1.2);
        const tone = rng.float(0.88, 1.08);
        ctx.put('bush', s * rng.float(5.35, 5.9), 0, dz, { s: sc, ry: rng.float(0, 6.28), c: [tone, 1, tone * 0.95] });
      }
      if (lampHere) {
        ctx.put('lamp', s * 5.05, 0, 8, { ry: rng.float(0, 1) });
        ctx.put('glow', s * 5.05, 3.3, 8, { s: 2.2, c: [1, 0.78, 0.4] });
      }
      // houses facing the lane
      {
        let dz = rng.float(0.5, 3);
        while (dz < 15) {
          const wide = rng.chance(0.4);
          const tint = mix(rng.pick(HOUSE_TINTS), '#ffffff', rng.float(0, 0.12));
          const x = s * (wide ? rng.float(10.2, 11.4) : rng.float(9.6, 10.8));
          ctx.put(wide ? 'houseB' : 'houseA', x, 0, dz + (wide ? 1.8 : 1.6), { ry: rng.float(-0.16, 0.16), c: tint, s: rng.float(0.92, 1.06) });
          ctx.put('shadow', x + s * 0.6, 0.03, dz + 1.8, { sx: wide ? 5.6 : 4.6, sz: 4.8 });
          if (rng.chance(0.5)) ctx.put('pot', s * (x * s - (wide ? 2.3 : 1.8)), 0, dz + 3.1 + rng.float(0, 0.8), { s: rng.float(0.8, 1.1) });
          const gap = wide ? rng.float(5.8, 7.6) : rng.float(4.8, 6.6);
          // a cypress standing in the gap between houses, taller than the roofs
          if (rng.chance(0.65)) {
            const sc = rng.float(1.0, 1.35);
            ctx.put('cypress', s * rng.float(8.6, 9.6), 0, dz + gap - 0.6, { s: sc * 0.8, sy: sc, c: [rng.float(0.98, 1.1), 1, rng.float(0.9, 1)] });
            ctx.put('shadow', s * 9.1, 0.03, dz + gap - 0.6, { sx: 2.6, sz: 2.6 });
          }
          dz += gap;
        }
      }
      // flowers in the verge
      for (let i = 0; i < 2; i++) {
        ctx.put('flowers', s * rng.float(6.4, 7.6), 0, rng.float(0, 16), { s: rng.float(0.8, 1.3), ry: rng.float(0, 6.28) });
      }
      // cypress layers rising behind the houses: near / mid (inked), far (no ink)
      for (let i = 0; i < 2; i++) {
        const x = s * rng.float(12.8, 15.5);
        const sc = rng.float(1.15, 1.55);
        ctx.put('cypress', x, 0, rng.float(0, 16), { s: sc, sy: sc * rng.float(1, 1.2), c: [rng.float(0.92, 1.06), 1, rng.float(0.86, 0.98)] });
      }
      for (let i = 0; i < 2; i++) {
        const x = s * rng.float(17, 26);
        const sc = rng.float(1.4, 2.0);
        ctx.put('cypress', x, 0, rng.float(0, 16), { s: sc, sy: sc * rng.float(1.05, 1.3), c: [rng.float(0.74, 0.86), rng.float(0.86, 0.94), rng.float(0.78, 0.9)] });
      }
      for (let i = 0; i < 2; i++) {
        const x = s * rng.float(29, 70);
        const sc = rng.float(1.9, 2.8);
        ctx.put('cypressFar', x, 0, rng.float(0, 16), { s: sc, sy: sc * rng.float(1.05, 1.35), c: [rng.float(0.56, 0.7), rng.float(0.74, 0.82), rng.float(0.7, 0.8)] });
      }
    }
  },
};
