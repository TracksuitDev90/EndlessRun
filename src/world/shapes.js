import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, rgb, mix, scaleColor, doorTop } from '../render/geo.js';

// Reusable prop builders shared by several worlds. Each returns an array of
// parts (so callers can add details) unless named *Geo, which returns a
// merged geometry.

// Tall rounded cypress like the reference illustration: bullet-shaped canopy,
// thin dark trunk, scribble marks, lit lime on top fading to deep green.
export function cypressParts({ h = 9.6, r = 1.5, lo = '#3f8f2c', hi = '#c4e33a', trunk = '#4b5b22', seg = 10, mark = 0.9, trunkH = 1.6 } = {}) {
  const base = trunkH;
  const prof = [
    [0, 0],
    [0.55, 0.03],
    [0.86, 0.11],
    [0.99, 0.28],
    [0.97, 0.48],
    [0.84, 0.68],
    [0.6, 0.84],
    [0.3, 0.95],
    [0, 1],
  ].map(([a, b]) => [a * r, base + b * (h - base)]);
  return [
    part(P.cyl(0.1, 0.15, base + 0.4, 6), trunk, { y: (base + 0.4) / 2 }),
    part(P.lathe(prof, seg), null, { grad: [lo, hi, base, h], mark, tint: 1 }),
  ];
}

export function roundTreeParts({ r = 2, trunkH = 2.2, lo = '#2f7a3a', hi = '#8fd04a', trunk = '#4a3a22', mark = 0.8 } = {}) {
  return [
    part(P.cyl(0.14, 0.2, trunkH + 0.5, 6), trunk, { y: (trunkH + 0.5) / 2 }),
    part(P.sphere(r, 12, 9), null, { y: trunkH + r * 0.8, sy: 0.9, grad: [lo, hi, trunkH, trunkH + r * 1.7], mark, tint: 1 }),
  ];
}

export function bushParts({ r = 0.9, lo = '#5fae2f', hi = '#c2e64a', mark = 0.8 } = {}) {
  return [
    part(P.sphere(r, 9, 7), null, { y: r * 0.7, sy: 0.85, grad: [lo, hi, 0, r * 1.5], mark, tint: 1 }),
    part(P.sphere(r * 0.72, 7, 5), null, { x: r * 0.85, y: r * 0.5, sy: 0.85, grad: [lo, hi, 0, r * 1.2], mark, tint: 1 }),
    part(P.sphere(r * 0.66, 7, 5), null, { x: -r * 0.8, y: r * 0.45, z: 0.15, sy: 0.85, grad: [lo, hi, 0, r * 1.1], mark, tint: 1 }),
  ];
}

export function cloudParts({ r = 3, lo = '#c9def0', hi = '#ffffff' } = {}) {
  const puffs = [
    [0, 0, 0, 1],
    [1.1, -0.25, 0.2, 0.75],
    [-1.15, -0.3, -0.1, 0.7],
    [0.45, 0.45, -0.3, 0.7],
    [-0.5, 0.35, 0.35, 0.62],
    [1.9, -0.45, -0.2, 0.5],
  ];
  return puffs.map(([x, y, z, s]) =>
    part(P.sphere(r * s, 10, 7), null, { x: x * r, y: y * r, z: z * r, sy: 0.82, grad: [lo, hi, -r, r * 0.9] })
  );
}

export function rockParts({ r = 1, lo = '#9a4a2c', hi = '#e07a46', sx = 1, sy = 0.8, sz = 1, seed = 0 } = {}) {
  const g = P.dodeca(r);
  // gently perturb so rocks aren't perfect solids
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    const f = 1 + ((k - Math.floor(k)) - 0.5) * 0.18;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  return [part(g, null, { sx, sy, sz, y: r * sy * 0.7, grad: [lo, hi, -r * sy * 0.3, r * sy * 1.5] })];
}

export function potParts({ r = 0.45, h = 0.7, color = '#c8693a', rim = '#a9532a', x = 0, z = 0, y = 0 } = {}) {
  const prof = [
    [0, 0],
    [r * 0.72, 0],
    [r * 0.8, h * 0.15],
    [r * 0.95, h * 0.85],
    [r * 0.95, h * 0.86],
  ];
  return [
    part(P.lathe(prof, 10), color, { x, y, z }),
    part(P.cyl(r * 1.06, r * 1.0, h * 0.16, 10), rim, { x, y: y + h * 0.9, z }),
    part(P.cyl(r * 0.88, r * 0.88, 0.04, 10), '#5a3a22', { x, y: y + h * 0.95, z, outline: 0 }),
  ];
}

// A door sitting in a wall: frame + leaf (tinted per instance) + knob.
// Faces +z, bottom-center at origin.
export function wallDoorParts({ w = 1.3, h = 2.5, frame = '#f4ead2', leaf = '#ffffff', knob = '#e8b84a', depth = 0.18, panels = true, frameW = 0.16 } = {}) {
  const parts = [
    part(P.box(frameW, h + frameW, depth + 0.06), frame, { x: -w / 2 - frameW / 2, y: (h + frameW) / 2 }),
    part(P.box(frameW, h + frameW, depth + 0.06), frame, { x: w / 2 + frameW / 2, y: (h + frameW) / 2 }),
    part(P.box(w + frameW * 2, frameW, depth + 0.06), frame, { y: h + frameW / 2 }),
    part(P.box(w, h, depth), leaf, { y: h / 2, tint: 1 }),
    part(P.sphere(0.06, 8, 6), knob, { x: w * 0.36, y: h * 0.47, z: depth / 2 + 0.04 }),
  ];
  if (panels) {
    const pw = w * 0.32;
    const ph = h * 0.3;
    for (const px of [-w * 0.22, w * 0.22]) {
      for (const py of [h * 0.27, h * 0.68]) {
        parts.push(part(P.box(pw, ph, 0.04), scaleColor(leaf, 0.82), { x: px, y: py, z: depth / 2 + 0.01, tint: 1, outline: 0.6 }));
      }
    }
  }
  return parts;
}

// --- Threshold gate ---------------------------------------------------------
// opening: { halfW, rectH, arch }
export function gateFrameParts(opening, { thick = 1.2, depth = 1.6, color = '#d9d3ae', mark = 0 } = {}) {
  // One continuous inverted-U outline (no sill across the threshold).
  const W = opening.halfW;
  const T = W + thick;
  const H = opening.rectH;
  const s = new THREE.Shape();
  s.moveTo(-T, 0);
  s.lineTo(-W, 0);
  if (opening.arch) {
    s.lineTo(-W, H);
    s.absarc(0, H, W, Math.PI, 0, true);
    s.lineTo(W, 0);
    s.lineTo(T, 0);
    s.lineTo(T, H);
    s.absarc(0, H, T, 0, Math.PI, false);
  } else {
    s.lineTo(-W, H);
    s.lineTo(W, H);
    s.lineTo(W, 0);
    s.lineTo(T, 0);
    s.lineTo(T, H + thick);
    s.lineTo(-T, H + thick);
  }
  s.closePath();
  return [part(P.extrude(s, depth, 24), color, { mark })];
}

// Left leaf: hinge at local x = 0, spans to x = halfW, z centered.
export function gateLeafParts(opening, { depth = 0.34, color = '#ffffff', panel = 0.8, knob = '#e8c35a' } = {}) {
  const W = opening.halfW - 0.03;
  const H = opening.rectH;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(W, 0);
  if (opening.arch) {
    s.lineTo(W, H + W);
    s.absarc(W, H, W, Math.PI / 2, Math.PI, false);
  } else {
    s.lineTo(W, H);
    s.lineTo(0, H);
  }
  s.closePath();
  const parts = [part(P.extrude(s, depth, 20), color, { tint: 1 })];
  const pc = scaleColor(color, panel);
  const top = opening.arch ? H : H - 0.8;
  const rows = 3;
  const rowH = (top - 1.4) / rows;
  for (let i = 0; i < rows; i++) {
    const y = 0.9 + rowH * (i + 0.5);
    parts.push(part(P.box(W * 0.62, rowH * 0.78, depth + 0.08), pc, { x: W * 0.5, y, tint: 1, outline: 0.5 }));
  }
  // round window / medallion in the arch
  if (opening.arch) {
    parts.push(part(P.cyl(W * 0.28, W * 0.28, depth + 0.1, 16), pc, { x: W * 0.62, y: H + W * 0.42, rx: Math.PI / 2, tint: 1, outline: 0.5 }));
  }
  // ring knocker near the meeting edge
  parts.push(part(P.torus(0.32, 0.07, 6, 14), knob, { x: W - 0.55, y: Math.min(5.2, H * 0.55), z: depth / 2 + 0.08 }));
  parts.push(part(P.sphere(0.14, 8, 6), knob, { x: W - 0.55, y: Math.min(5.2, H * 0.55) + 0.34, z: depth / 2 + 0.06 }));
  return parts;
}

export function gateTop(opening) {
  return doorTop(opening.halfW, opening.rectH, opening.arch);
}

// Lantern on a post with warm emissive glass (pair with a glow billboard).
export function lanternPostParts({ h = 3.2, pole = '#1f3a2c', glass = '#ffd27a', cap = '#1f3a2c' } = {}) {
  return [
    part(P.cyl(0.16, 0.2, 0.3, 8), pole, { y: 0.15 }),
    part(P.cyl(0.06, 0.07, h, 6), pole, { y: h / 2 }),
    part(P.box(0.34, 0.42, 0.34), glass, { y: h + 0.2, emit: 1 }),
    part(P.cone(0.32, 0.26, 4), cap, { y: h + 0.54, ry: Math.PI / 4 }),
    part(P.box(0.42, 0.06, 0.42), cap, { y: h - 0.02 }),
  ];
}

export { P, part, merge, rgb, mix, scaleColor };
