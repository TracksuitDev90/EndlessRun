import {
  P, part, merge, mix,
  cloudParts, wallDoorParts, gateFrameParts, gateLeafParts, gateTop,
} from './shapes.js';
import { groundStrip } from '../render/geo.js';

// III · The Hall of Doors — a coral corridor with a checkerboard floor,
// open to the sky, lined with doors of every color. Nested door frames
// recede ahead; doors and armchairs float among the clouds outside.

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

function openDoorGeo() {
  // Ajar door spilling warm light from the room beyond.
  const w = 1.5;
  const h = 3.1;
  const parts = [
    part(P.box(0.18, h + 0.18, 0.26), C.cream, { x: -w / 2 - 0.09, y: (h + 0.18) / 2 }),
    part(P.box(0.18, h + 0.18, 0.26), C.cream, { x: w / 2 + 0.09, y: (h + 0.18) / 2 }),
    part(P.box(w + 0.36, 0.18, 0.26), C.cream, { y: h + 0.09 }),
    part(P.box(w, h, 0.05), C.lit, { y: h / 2, z: -0.06, emit: 1, outline: 0 }),
  ];
  // leaf hinged on the right jamb, swung ~63° out into the hall
  const a = 1.1;
  parts.push(part(P.box(w, h, 0.12), '#ffffff', { x: w / 2 - (w / 2) * Math.cos(a), y: h / 2, z: 0.06 + (w / 2) * Math.sin(a), ry: a, tint: 1 }));
  return merge(parts);
}

function pictureGeo(seed) {
  const rnd = seeded(seed);
  const parts = [
    part(P.box(1.3, 1.0, 0.1), C.gold, { y: 0 }),
    part(P.box(1.1, 0.8, 0.12), mix('#9fd3e6', '#ffffff', rnd() * 0.3), { y: 0, outline: 0 }),
    part(P.box(1.1, 0.34, 0.13), mix('#6fb35a', '#2f7a3a', rnd()), { y: -0.23, outline: 0 }),
    part(P.sphere(0.1, 8, 6), '#ffe08a', { x: 0.3, y: 0.18, z: 0.05, sz: 0.3, outline: 0 }),
  ];
  return merge(parts);
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

function booksGeo() {
  const rnd = seeded(31);
  const parts = [];
  for (const sx of [-0.62, 0, 0.62]) {
    let y = 0;
    const n = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < n && y < 0.8; i++) {
      const h = 0.1 + rnd() * 0.07;
      parts.push(part(P.box(0.5 + rnd() * 0.12, h, 0.38 + rnd() * 0.1), BOOKS[Math.floor(rnd() * BOOKS.length)], { x: sx + (rnd() - 0.5) * 0.08, y: y + h / 2, ry: (rnd() - 0.5) * 0.4, outline: 0.7 }));
      y += h;
    }
  }
  return merge(parts).translate(0, 0, -0.3);
}

function lowDoorwayGeo() {
  const parts = [];
  for (const s of [-1, 1]) parts.push(part(P.box(0.22, 3.3, 0.36), C.cream, { x: s * 0.98, y: 1.65 }));
  parts.push(part(P.box(2.2, 0.26, 0.42), C.cream, { y: 3.35 }));
  parts.push(part(P.box(1.74, 1.98, 0.16), '#ffffff', { y: 2.24, tint: 1 }));
  parts.push(part(P.box(1.9, 0.14, 0.3), C.creamDark, { y: 1.27 }));
  parts.push(part(P.cyl(0.3, 0.3, 0.2, 16), C.lit, { y: 2.3, rx: Math.PI / 2, emit: 1, outline: 0.5 }));
  parts.push(part(P.torus(0.3, 0.05, 6, 16), C.cream, { y: 2.3, z: 0.1 }));
  return merge(parts).translate(0, 0, -0.18);
}

function curtainGeo() {
  const parts = [];
  for (const s of [-1, 1]) parts.push(part(P.box(0.28, 3.4, 0.28), C.gold, { x: s * 3.95, y: 1.7 }));
  parts.push(part(P.cyl(0.08, 0.08, 8.2, 8), C.gold, { y: 3.0, rz: Math.PI / 2 }));
  const n = 14;
  for (let i = 0; i < n; i++) {
    const x = -3.6 + (7.2 * (i + 0.5)) / n;
    parts.push(part(P.cyl(0.29, 0.26, 1.45, 8), i % 2 ? C.velvet : C.velvetDark, { x, y: 2.25 }));
    parts.push(part(P.sphere(0.27, 8, 6), C.velvet, { x, y: 1.53, sy: 0.5 }));
    parts.push(part(P.sphere(0.06, 6, 4), C.gold, { x, y: 1.35, outline: 0.5 }));
  }
  return merge(parts).translate(0, 0, -0.2);
}

function standingDoorGeo() {
  return merge([
    ...wallDoorParts({ w: 1.6, h: 3.1, depth: 0.3, frameW: 0.22 }),
    part(P.box(2.3, 0.2, 0.7), C.creamDark, { y: 0.1 }),
  ]).translate(0, 0, -0.35);
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
  env: {
    sky: ['#4f93d6', '#d6eaf8', '#f4f8fb'],
    sun: { dir: [-0.3, 0.55, -1], glow: '#fff4d6' },
    stars: 0,
    light: { dir: [-0.4, 0.82, 0.42], shadow: [0.74, 0.62, 0.7], hi: [1.06, 1.04, 1.0] },
    ink: '#3a1410',
    fog: [46, 200],
    ground: ['#efe7d6', '#2a2530', '#7a2e22'],
    shadowDecal: [0.62, 0.5, 0.52],
    glowGain: 0.7,
    particles: { color: '#fff1d0', size: 1.7, drift: [0.05, 0.08, 0], opacity: 0.7 },
  },

  build(b) {
    b.ground('ground', groundStrip(11.2, 16, '#ffffff', 8), 3);
    b.toon('cloudSea', groundStrip(420, 16, '#f3f7fb', 8, { y: -16 }), { ink: 0, cap: 40 });
    b.toon('walls', hallWallsGeo(), { cap: 40, ink: 0.04, anim: 'rise' });
    b.toon('door', merge(wallDoorParts({ w: 1.5, h: 3.1, depth: 0.2 })), { cap: 200, anim: 'pop' });
    b.toon('openDoor', openDoorGeo(), { cap: 60, anim: 'pop' });
    b.toon('picture', pictureGeo(3), { cap: 120, anim: 'pop' });
    b.toon('sconce', sconceGeo(), { cap: 120, anim: 'pop', ink: 0.025 });
    b.glow('glow', { cap: 160, anim: 'pop' });
    b.toon('hallFrame', hallFrameGeo(), { cap: 24, anim: 'popLate' });
    b.toon('cloud', merge(cloudParts({ r: 3, lo: '#bcd6ee', hi: '#ffffff' })), { cap: 220, anim: 'lift', wobble: [0, 0.6, 0.5, 0], ink: 0.06 });
    b.toon('floatDoor', floatingDoorGeo(), { cap: 60, anim: 'liftFar', wobble: [0, 0.4, 0.6, 0] });
    b.toon('floatChair', armchairGeo(1.6), { cap: 30, anim: 'liftFar', wobble: [0, 0.5, 0.45, 0] });
    b.shadow('shadow', { cap: 120, anim: 'pop' });

    b.toon('armchair', armchairGeo(1.8), { cap: 24, anim: 'popEarly' });
    b.toon('books', booksGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('settee', armchairGeo(7.6), { cap: 10, anim: 'popEarly' });
    b.toon('lowDoorway', lowDoorwayGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('curtain', curtainGeo(), { cap: 10, anim: 'popEarly' });
    b.toon('standingDoor', standingDoorGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('bookshelf', bookshelfGeo(), { cap: 24, anim: 'popEarly' });
    b.toon('swingDoor', swingDoorGeo(), { cap: 16, anim: [3, 42, 88, Math.PI / 2] });
    b.toon('doorway', doorwayGeo(), { cap: 16, anim: 'none', ink: 0.03 });

    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06 });
    b.toon('gateLeaf', merge(gateLeafParts(OPENING, { color: '#ffffff' })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'armchair', len: 1.0 }, { name: 'books', len: 0.6 }],
    H: [{ name: 'lowDoorway', len: 0.4 }],
    W: [{ name: 'standingDoor', len: 0.7 }, { name: 'bookshelf', len: 0.8 }],
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
          if (rng.chance(0.18)) {
            ctx.put('openDoor', x, 0, dz, { ry, c: tint });
            ctx.put('glow', s * (WALL_X - 1.2), 1.6, dz, { s: 3.4, c: [1, 0.78, 0.45] });
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
              ctx.put('picture', s * (WALL_X - 0.04), 3.9, mid, { ry, s: rng.float(0.8, 1.2) });
            }
          }
        }
      }
    } else {
      ctx.put('ground', 0, 0, 0);
    }
    ctx.put('cloudSea', 0, 0, 0);
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
