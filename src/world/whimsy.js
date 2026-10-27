import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, scaleColor } from './shapes.js';

// Props for the stranger, later laps of each world, plus light volumes.
// Anything that flies is built with its wings / covers spreading along local
// ±x from a hinge on the z axis, so the shader's flap mode (toon option `fly`)
// can beat them. Each builder returns an array of parts.

// A book flapping its covers like wings; covers take the instance tint.
export function flyingBookParts({ w = 0.3, d = 0.42, pages = '#f6ecd4' } = {}) {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(w, 0.026, d), '#ffffff', { x: (s * w) / 2, tint: 1 }));
    parts.push(part(P.box(w * 0.88, 0.05, d * 0.9), pages, { x: (s * w * 0.88) / 2, y: 0.035, outline: 0.5 }));
    parts.push(part(P.box(w * 0.82, 0.012, 0.05), [0.8, 0.8, 0.8], { x: (s * w) / 2, y: -0.015, z: d * 0.3, tint: 1, outline: 0 }));
  }
  parts.push(part(P.cyl(0.03, 0.03, d, 8), [0.75, 0.75, 0.75], { rx: Math.PI / 2, tint: 1 }));
  return parts;
}

// Gull-winged bird silhouette (wings flap via the shader).
export function birdParts({ color = '#3a1a14', size = 1 } = {}) {
  const s = size;
  return [
    part(P.sphere(0.16 * s, 8, 6), color, { sz: 2.0, sx: 0.8 }),
    part(P.sphere(0.09 * s, 8, 6), color, { z: -0.3 * s, y: 0.05 * s }),
    part(P.cone(0.04 * s, 0.12 * s, 6), '#e8a040', { z: -0.42 * s, y: 0.04 * s, rx: -Math.PI / 2 }),
    part(P.box(0.18 * s, 0.03 * s, 0.22 * s), color, { z: 0.36 * s, outline: 0.6 }),
    part(P.box(0.55 * s, 0.03 * s, 0.24 * s), color, { x: -0.36 * s, y: 0.02 * s, rz: -0.08 }),
    part(P.box(0.55 * s, 0.03 * s, 0.24 * s), color, { x: 0.36 * s, y: 0.02 * s, rz: 0.08 }),
    part(P.box(0.32 * s, 0.025 * s, 0.16 * s), color, { x: -0.74 * s, y: 0.05 * s, z: 0.04 * s, rz: -0.15 }),
    part(P.box(0.32 * s, 0.025 * s, 0.16 * s), color, { x: 0.74 * s, y: 0.05 * s, z: 0.04 * s, rz: 0.15 }),
  ];
}

// Butterfly: two pairs of wings that take the instance tint.
export function butterflyParts() {
  const parts = [part(P.capsule(0.02, 0.16, 3, 6), '#2a1d14', { rx: Math.PI / 2 })];
  for (const s of [-1, 1]) {
    parts.push(part(P.sphere(0.13, 8, 6), '#ffffff', { x: s * 0.13, z: -0.04, sy: 0.08, sz: 0.85, tint: 1, outline: 0.6 }));
    parts.push(part(P.sphere(0.09, 8, 6), [0.8, 0.8, 0.8], { x: s * 0.1, z: 0.1, sy: 0.08, sz: 0.9, tint: 1, outline: 0.6 }));
    parts.push(part(P.sphere(0.035, 6, 4), '#2a1d14', { x: s * 0.16, y: 0.012, z: -0.06, sy: 0.3, outline: 0 }));
  }
  return parts;
}

// Paper sky lantern, glowing from inside.
export function skyLanternParts({ glow = '#ffcf6b', rim = '#d9822b' } = {}) {
  return [
    part(P.lathe([[0.18, 0], [0.24, 0.25], [0.27, 0.55], [0.22, 0.75], [0, 0.78]], 10), null, { grad: [glow, '#fff2c0', 0, 0.78], emit: 1 }),
    part(P.torus(0.18, 0.025, 4, 12), rim, { rx: Math.PI / 2, emit: 0.6, outline: 0.5 }),
  ];
}

// Hot air balloon with a striped envelope (stripes take the instance tint).
export function balloonParts() {
  const parts = [];
  const n = 8;
  // a tinted envelope with cream gores laid over every other segment
  parts.push(part(new THREE.SphereGeometry(1.6, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.8), '#ffffff', { y: 3.2, sy: 1.15, tint: 1 }));
  for (let i = 0; i < n; i += 2) {
    parts.push(part(new THREE.SphereGeometry(1.62, 4, 12, (i / n) * Math.PI * 2, Math.PI / n, 0, Math.PI * 0.8), '#f6ecd4', { y: 3.2, sy: 1.15, outline: 0 }));
  }
  parts.push(part(P.cyl(0.55, 0.4, 0.5, 10), '#8a5a2c', { y: 0.25 }));
  parts.push(part(P.cyl(0.6, 0.6, 0.08, 10), '#6b3f1f', { y: 0.5 }));
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
    parts.push(part(P.cyl(0.015, 0.015, 1.7, 3), '#3a2a1a', { x: x * 1.1, y: 1.4, z: z * 1.1, outline: 0 }));
  }
  return parts;
}

// Giant flower on a tall stem. kind: 'daisy' (petal ring) or 'tulip' (cup).
export function giantFlowerParts({ h = 4.5, kind = 'daisy', stem = '#3f8f2c', center = '#f2a03a' } = {}) {
  const parts = [part(P.cyl(0.09, 0.13, h, 8), stem, { y: h / 2 })];
  for (const s of [-1, 1]) {
    parts.push(part(P.sphere(0.5, 8, 6), null, { x: s * 0.42, y: h * 0.35 + (s > 0 ? 0.4 : 0), sx: 1.0, sy: 0.12, sz: 0.4, rz: s * 0.5, grad: ['#2f7a2a', '#8fd04a', h * 0.3, h * 0.45] }));
  }
  if (kind === 'tulip') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push(part(P.sphere(0.5, 10, 8), '#ffffff', { x: Math.cos(a) * 0.22, y: h + 0.45, z: Math.sin(a) * 0.22, sx: 0.55, sy: 1.0, sz: 0.3, ry: -a + Math.PI / 2, rz: 0, tint: 1 }));
    }
  } else {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      parts.push(part(P.sphere(0.5, 8, 6), '#ffffff', { x: Math.cos(a) * 0.62, y: h + Math.sin(a) * 0.62, z: 0.02, sx: 0.55, sy: 0.24, sz: 0.1, rz: a, tint: 1, outline: 0.6 }));
    }
    parts.push(part(P.cyl(0.42, 0.42, 0.2, 14), center, { y: h, rx: Math.PI / 2, mark: 0.5 }));
  }
  return parts;
}

// Teacup on a saucer, and a teapot, for the drifting tea party.
export function teacupParts({ color = '#ffffff', trim = '#e8b84a' } = {}) {
  return [
    part(P.lathe([[0, 0.02], [0.18, 0.02], [0.26, 0.14], [0.3, 0.32], [0.28, 0.33]], 14), color, { tint: 1 }),
    part(P.cyl(0.26, 0.26, 0.02, 14), '#6a3a20', { y: 0.3, outline: 0 }),
    part(P.torus(0.29, 0.018, 4, 18), trim, { y: 0.325, rx: Math.PI / 2, outline: 0.5 }),
    part(P.torus(0.09, 0.025, 6, 12, Math.PI * 1.3), color, { x: 0.31, y: 0.18, rz: -Math.PI * 0.65, tint: 1 }),
    part(P.cyl(0.42, 0.32, 0.04, 16), color, { tint: 1 }),
  ];
}

export function teapotParts({ color = '#ffffff', trim = '#e8b84a' } = {}) {
  return [
    part(P.sphere(0.5, 14, 10), color, { y: 0.45, sy: 0.82, tint: 1 }),
    part(P.cyl(0.3, 0.34, 0.08, 14), trim, { y: 0.06 }),
    part(P.cyl(0.24, 0.28, 0.1, 12), color, { y: 0.84, tint: 1 }),
    part(P.sphere(0.07, 8, 6), trim, { y: 0.94 }),
    part(P.cyl(0.05, 0.1, 0.55, 8), color, { x: -0.6, y: 0.62, rz: 0.8, tint: 1 }),
    part(P.torus(0.2, 0.045, 6, 12, Math.PI * 1.2), color, { x: 0.52, y: 0.48, rz: -Math.PI * 0.6, tint: 1 }),
  ];
}

// A floating clock face.
export function clockParts() {
  return [
    part(P.cyl(0.8, 0.8, 0.14, 24), '#fff8e6', { rx: Math.PI / 2 }),
    part(P.torus(0.8, 0.09, 6, 24), '#e8b84a', {}),
    part(P.box(0.06, 0.55, 0.05), '#2a1d14', { y: 0.22, z: 0.1, rz: 0.4, outline: 0 }),
    part(P.box(0.05, 0.38, 0.05), '#2a1d14', { y: 0.12, x: 0.1, z: 0.11, rz: -1.1, outline: 0 }),
    part(P.sphere(0.06, 8, 6), '#e8b84a', { z: 0.12, outline: 0 }),
    ...[0, 1, 2, 3].map((i) => part(P.box(0.05, 0.14, 0.04), '#2a1d14', { x: Math.sin((i * Math.PI) / 2) * 0.62, y: Math.cos((i * Math.PI) / 2) * 0.62, z: 0.09, rz: (-i * Math.PI) / 2, outline: 0 })),
    part(P.box(0.12, 0.4, 0.12), '#e8b84a', { y: 0.95 }),
  ];
}

// A whale drifting through the clouds.
export function whaleParts({ body = '#5a4aa0', belly = '#f2d6c8' } = {}) {
  return [
    part(P.sphere(2.2, 16, 12), null, { sx: 1.0, sy: 0.82, sz: 2.4, grad: [scaleColor(body, 0.7), body, -1.8, 1.8] }),
    part(P.sphere(2.0, 14, 10), belly, { y: -0.5, sx: 0.85, sy: 0.6, sz: 2.2 }),
    part(P.sphere(1.1, 10, 8), body, { z: 5.6, y: 0.3, sx: 0.55, sy: 0.4, sz: 1.2 }),
    part(P.sphere(1.0, 10, 8), body, { z: 6.6, y: 0.5, x: -0.9, sx: 1.1, sy: 0.12, sz: 0.55, ry: 0.5 }),
    part(P.sphere(1.0, 10, 8), body, { z: 6.6, y: 0.5, x: 0.9, sx: 1.1, sy: 0.12, sz: 0.55, ry: -0.5 }),
    part(P.sphere(0.9, 10, 8), body, { x: -2.3, y: -0.6, z: -1.0, sx: 1.4, sy: 0.12, sz: 0.5, rz: -0.3 }),
    part(P.sphere(0.9, 10, 8), body, { x: 2.3, y: -0.6, z: -1.0, sx: 1.4, sy: 0.12, sz: 0.5, rz: 0.3 }),
    part(P.sphere(0.16, 8, 6), '#1a1030', { x: -1.75, y: 0.15, z: -3.2, outline: 0 }),
    part(P.sphere(0.16, 8, 6), '#1a1030', { x: 1.75, y: 0.15, z: -3.2, outline: 0 }),
  ];
}

// --- light volumes ------------------------------------------------------------
// A soft shaft of light along direction `dir` (pointing toward the light),
// centered on the origin. uv.y runs along it.
export function shaftParts({ len = 14, r0 = 0.5, r1 = 1.1, dir = [0, 1, 0] } = {}) {
  const g = new THREE.CylinderGeometry(r0, r1, len, 14, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
  g.applyQuaternion(q);
  return [part(g, '#ffffff', { tint: 1, outline: 0 })];
}

// Cone of lamplight from a lamp head (apex at y = top) down to the ground.
export function lampConeParts({ top = 4, r0 = 0.18, r1 = 1.7 } = {}) {
  const g = new THREE.CylinderGeometry(r0, r1, top, 16, 1, true);
  g.translate(0, top / 2, 0);
  return [part(g, '#ffffff', { tint: 1, outline: 0 })];
}
