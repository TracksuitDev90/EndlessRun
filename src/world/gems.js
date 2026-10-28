import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part } from '../render/geo.js';

// The gem kit. Every world has its own collectible stone (def.gem, built by
// WorldBuilder.gems and laid by game/gems.js): its own colour, chosen to stand
// off the world's palette, and its own cuts in the world's character. A world
// gives three: the everyday stone, a variant mixed into its runs so a line of
// gems never looks stamped out, and a larger crown stone for the prize spots —
// the top of a jump, the gem under a bar, the first step into a new world.
//
// The cuts are lofts of polygon rings, flat-shaded so every facet catches the
// light on its own; turning a ring half a step against its neighbour makes
// the triangular facets of a brilliant. Built at the size they're seen in the
// world: an everyday stone is about half a meter across, a third of the
// runner's height.
//
// Parts carry flags for the gem shader (fx = shine, crystal, tint): crystal
// parts take the instance colour and the cut-stone shading; anything else (a
// gold bezel, the rock a cluster grows from) is lit like any prop.

export const crystal = (geo, o = {}) => part(geo, '#ffffff', { ...o, emit: 1, tint: 1 });
export const metal = (geo, color, o = {}) => part(geo, color, { ...o, mark: 1 });
export const stone = (geo, color, o = {}) => part(geo, color, o);

// A face-on cut stands up facing the runner (its table, built up +y, turned to +z).
export const FACE = Math.PI / 2;

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// n points round a circle in the x/z plane, turned by `off` of a step (half
// a step for alternate rings of facets) and by `rot` radians. A point at
// rot = -PI/2 ends up on top once a face-on cut is stood up.
export function polygon(n, r, { off = 0, sx = 1, sz = 1, rot = 0, jitter = 0, seed = 1 } = {}) {
  const rnd = seeded(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + off) / n) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 2 * jitter;
    pts.push([Math.cos(a) * r * sx * k, Math.sin(a) * r * sz * k]);
  }
  return pts;
}

const ring = (pts, y, off = 0) => ({ pts, y, off });
const apex = (y, x = 0, z = 0) => ({ pts: [[x, z]], y, off: 0 });
const scaled = (pts, k) => pts.map(([x, z]) => [x * k, z * k]);

// Stitch rings (bottom to top) into a closed, flat-shaded solid. A ring of
// one point is an apex; a ring at the same height as the apex after it is a
// flat table. Rings with the same point count are zig-zagged together, so a
// ring turned half a step makes triangular facets and an aligned one makes
// quads. centre: move the solid so its height is centred on y = 0.
export function loft(rings, { centre = true } = {}) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    y0 = Math.min(y0, r.y);
    y1 = Math.max(y1, r.y);
  }
  const at = (r, i) => {
    const n = r.pts.length;
    const p = r.pts[((i % n) + n) % n];
    return [p[0], r.y, p[1]];
  };
  const tris = [];
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k];
    const B = rings[k + 1];
    const na = A.pts.length;
    const nb = B.pts.length;
    if (na === 1) {
      for (let i = 0; i < nb; i++) tris.push([at(A, 0), at(B, i), at(B, i + 1)]);
    } else if (nb === 1) {
      for (let i = 0; i < na; i++) tris.push([at(A, i), at(A, i + 1), at(B, 0)]);
    } else {
      const s = B.off < A.off ? 1 : 0;
      for (let i = 0; i < na; i++) {
        tris.push([at(A, i), at(A, i + 1), at(B, i + s)]);
        tris.push([at(A, i + 1), at(B, i + 1 + s), at(B, i + s)]);
      }
    }
  }
  const g = solid(tris, (y0 + y1) / 2);
  if (centre) g.translate(0, -(y0 + y1) / 2, 0);
  return g;
}

// Triangles -> geometry, each wound to face away from the solid's middle
// (every cut here is convex, or star-shaped about its axis), one flat normal
// per facet.
function solid(tris, cy) {
  const pos = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-12) continue;
    const out = n.x * (a[0] + b[0] + c[0]) + n.y * (a[1] + b[1] + c[1] - 3 * cy) + n.z * (a[2] + b[2] + c[2]);
    if (out < 0) pos.push(...a, ...c, ...b);
    else pos.push(...a, ...b, ...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// --- cuts ----------------------------------------------------------------------
// The round brilliant everyone draws when they draw a gem: a flat table, a
// crown of star and bezel facets, a thin girdle, a deep pavilion to a point.
// sides 5 or 3 (stood face-on) make pentagon and trillion cuts; sx/sz stretch
// it to an oval.
export function brilliant({ r = 0.29, sides = 8, sx = 1, sz = 1, rot = 0, crown = 0.42, pavilion = 0.95, table = 0.56 } = {}) {
  const p = (k, off) => polygon(sides, r * k, { off, sx, sz, rot });
  return loft([
    apex(-pavilion * r),
    ring(p(0.5, 0.5), -pavilion * r * 0.48, 0.5),
    ring(p(1, 0), -0.035 * r),
    ring(p(1, 0), 0.035 * r),
    ring(p(0.8, 0.5), crown * r * 0.55, 0.5),
    ring(p(table, 0), crown * r),
    apex(crown * r),
  ]);
}

// A briolette: a teardrop covered all over in triangular facets, point up.
export function briolette({ r = 0.21, h = 0.62, sides = 7 } = {}) {
  const prof = [[0.55, 0.05], [0.92, 0.18], [1, 0.36], [0.86, 0.54], [0.6, 0.72], [0.3, 0.88]];
  const rings = [apex(0)];
  prof.forEach(([k, f], i) => {
    const off = (i % 2) * 0.5;
    rings.push(ring(polygon(sides, r * k, { off }), h * f, off));
  });
  rings.push(apex(h));
  return loft(rings);
}

// A natural crystal: a six-sided prism with a pyramid tip, a little
// irregular, standing on y = 0 — or, double, terminated at both ends and
// centred.
export function crystalPoint({ r = 0.08, len = 0.3, tip = 0.12, sides = 6, double = false, seed = 1, jitter = 0.09 } = {}) {
  const p = (k, s) => polygon(sides, r * k, { jitter, seed: seed * 7 + s });
  const rnd = seeded(seed * 13 + 5);
  const lean = () => (rnd() - 0.5) * r * 0.5;
  return loft([
    double ? apex(-tip, lean(), lean()) : apex(0),
    ring(p(double ? 0.96 : 0.86, 1), 0),
    ring(p(1, 2), len * 0.22),
    ring(p(0.96, 3), len),
    apex(len + tip, lean(), lean()),
  ], { centre: double });
}

// Two hexagonal pyramids base to base, with a band of facets either side of
// the girdle.
export function bipyramid({ r = 0.19, h = 0.3, sides = 6 } = {}) {
  const p = (k, off) => polygon(sides, r * k, { off });
  return loft([
    apex(-h),
    ring(p(0.6, 0.5), -h * 0.45, 0.5),
    ring(p(1, 0), -0.03),
    ring(p(1, 0), 0.03),
    ring(p(0.6, 0.5), h * 0.45, 0.5),
    apex(h),
  ]);
}

// A faceted star (stand it face-on): every arm ridged, so each side of an arm
// is two facets.
export function star({ points = 5, R = 0.36, inner = 0.47, depth = 0.15 } = {}) {
  const o = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? R * inner : R;
    o.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return loft([
    apex(-depth),
    ring(scaled(o, 0.5), -depth * 0.55),
    ring(o, -0.03),
    ring(o, 0.03),
    ring(scaled(o, 0.5), depth * 0.55),
    apex(depth),
  ]);
}

// Rectangle with its corners cut off (an emerald cut's outline), w x h
// half-sizes, in the order the loft wants.
export function octagon(w, h, c) {
  return [[w, -h + c], [w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c], [-w + c, -h], [w - c, -h]];
}

// A step cut (stand it face-on): a broad table, a stepped crown and a
// pavilion of long parallel facets, girdle at y = 0.
export function stepCut({ w = 0.19, h = 0.26, chamfer = 0.065, depth = 0.1, back = 0.19 } = {}) {
  const o = octagon(w, h, chamfer);
  return loft([
    apex(-back),
    ring(scaled(o, 0.3), -back * 0.88),
    ring(scaled(o, 0.6), -back * 0.58),
    ring(scaled(o, 0.86), -back * 0.26),
    ring(o, -0.018),
    ring(o, 0.018),
    ring(scaled(o, 0.9), depth * 0.6),
    ring(scaled(o, 0.74), depth),
    apex(depth),
  ], { centre: false });
}

// Brilliant-style cut of any outline (stand it face-on): table, crown,
// girdle, pavilion, girdle at y = 0.
export function outlineCut(o, { depth = 0.09, back = 0.18 } = {}) {
  return loft([
    apex(-back),
    ring(scaled(o, 0.45), -back * 0.55),
    ring(o, -0.016),
    ring(o, 0.016),
    ring(scaled(o, 0.8), depth * 0.6),
    ring(scaled(o, 0.6), depth),
    apex(depth),
  ], { centre: false });
}

// A teardrop outline, point up once stood face-on.
export function pearOutline(w = 0.24, h = 0.3, n = 18) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([Math.sin(t) * Math.sin(t / 2) * w, -Math.cos(t) * h]);
  }
  return pts;
}

// A heart outline, notch up once stood face-on; size is its half-height.
export function heartOutline(size = 0.3, n = 24) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([(x * size) / 15, (-(y + 2.5) * size) / 15]);
  }
  return pts;
}

// A rough lump of rock for crystals to grow from.
export function rough({ r = 0.15, seed = 1 } = {}) {
  const g = P.dodeca(r);
  const pos = g.attributes.position;
  const rnd = seeded(seed * 31 + 3);
  const bumps = [rnd(), rnd(), rnd()].map((v) => v * 6.28);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const f = 1 + 0.16 * Math.sin(x * 19 + bumps[0]) * Math.sin(z * 17 + bumps[1]) + 0.1 * Math.sin(y * 23 + bumps[2]);
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}

// A gold setting round a face-on stone of outline o (as from octagon()): a
// bezel rim, a claw at each corner and, with bail, a loop at the top to hang
// it from.
export function bezelParts(o, { color = '#e8b84a', k = 1.14, inner = 0.985, depth = 0.085, claws = [], bail = 0 } = {}) {
  const v2 = (pts, s) => pts.map(([x, z]) => new THREE.Vector2(x * s, -z * s));
  const shape = new THREE.Shape(v2(o, k));
  shape.holes.push(new THREE.Path(v2(o, inner)));
  const parts = [metal(P.extrude(shape, depth, 1), color)];
  for (const [x, y] of claws) parts.push(metal(P.sphere(0.024, 7, 5), color, { x, y, z: depth * 0.45 }));
  if (bail) {
    let top = 0;
    for (const [, z] of o) top = Math.max(top, -z * k);
    parts.push(metal(P.torus(bail, bail * 0.32, 6, 14), color, { y: top + bail * 0.95 }));
  }
  return parts;
}
