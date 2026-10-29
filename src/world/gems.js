import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part } from '../render/geo.js';

// The gem kit. Every world has its own collectible stone (def.gem, built by
// WorldBuilder.gems and laid by game/gems.js): its own colour, chosen to stand
// off the world's palette, and its own forms in the world's character. A
// world gives a family of stones in its colour — its namesake gem in a couple
// of forms and three or four cousins found alongside it (garnet with the
// ruby, olivine with the emerald...), each run led by one and mixed with the
// rest so a line of gems never looks stamped out — and a larger crown stone
// for the prize spots: the top of a jump, the way out from under a bar, the
// first step into a new world.
//
// Two ways of making them, both flat-shaded so every facet catches the light
// on its own. Most stones grow the way real ones do (cleave()): cut out of a
// block by planes — the faces of a crystal's habit (a sapphire's hexagonal
// barrel, a ruby's six-sided plate, a topaz's wedge-tipped prism), or the
// fracture surfaces of a rough nugget or a water-worn pebble — each plane a
// little off true and a few corners chipped, so no two read as machined. The
// rest are lofts of polygon rings (crystal points, the emerald's step cut).
// Built at the size they're seen in the world: an everyday stone is about
// half a meter across, a third of the runner's height.
//
// A world's stones are listed in def.gem: `stones` (its everyday stones, each
// { name, weight, tints, parts(), texture }) and a `crown`; texture is the
// stone's surface (see makeGemMaterial: mottle, speckle, bands, veins, rough,
// opaque...). Parts carry flags for the gem shader (fx = shine, crystal,
// tint): crystal parts take the instance colour and the stone's surface;
// anything else (a gold bezel, the rock a cluster grows from) is lit like any
// prop, the shine flag marking polished metal.

export const crystal = (geo, o = {}) => facetEdges(part(geo, '#ffffff', { ...o, emit: 1, tint: 1 }));
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

// --- crystal points and cuts ---------------------------------------------------
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

// --- natural stones ---------------------------------------------------------------
// A stone cleaved out of a block by planes, the way crystal faces and fracture
// surfaces bound a real one. A plane is [nx, ny, nz, d] with n a unit normal:
// the stone keeps the side where n·p <= d. jitter tips every plane a little
// off true (and moves it in or out by as much, relatively); then `chips`
// random corners and edges are broken off, each `deep` (a fraction of how far
// the stone reaches that way). Every face stays flat, as on a real crystal.
export function cleave(planes, { box = [1, 1, 1], jitter = 0, chips = 0, deep = [0.05, 0.12], seed = 1 } = {}) {
  const rnd = seeded(seed * 7919 + 17);
  const wobble = () => (rnd() - 0.5) * 2 * jitter;
  let faces = boxFaces(box);
  for (const [x, y, z, d] of planes) {
    const n = unit([x + wobble(), y + wobble(), z + wobble()]);
    faces = clip(faces, n, d * (1 + wobble()));
  }
  for (let i = 0; i < chips; i++) {
    const n = randomUnit(rnd);
    const h = reach(faces, n);
    faces = clip(faces, n, h * (1 - deep[0] - rnd() * (deep[1] - deep[0])));
  }
  const pos = [];
  for (const { n, pts } of faces) {
    for (let i = 1; i < pts.length - 1; i++) {
      const [a, b, c] = [pts[0], pts[i], pts[i + 1]];
      const cr = cross(sub(b, a), sub(c, a));
      if (dot(cr, cr) < 1e-14) continue;
      if (dot(cr, n) < 0) pos.push(...a, ...c, ...b);
      else pos.push(...a, ...b, ...c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// k planes evenly round the vertical, each facing `tilt` radians up from the
// horizontal (down if negative), at distance d; turned by rot.
export function around(k, tilt, d, rot = 0) {
  const planes = [];
  for (let i = 0; i < k; i++) {
    const a = rot + (i / k) * Math.PI * 2;
    planes.push([Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt), d]);
  }
  return planes;
}

// A rough stone: an ellipsoid of radii r broken by `faces` fracture planes,
// each cut somewhere up to `spread` of the way in. Few planes and a wide
// spread make an angular nugget; many and a narrow one, a rounded pebble.
export function nugget({ r = [0.22, 0.18, 0.2], faces = 14, spread = 0.18, chips = 3, seed = 1 } = {}) {
  const rnd = seeded(seed * 104729 + 3);
  const planes = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const turn = rnd() * 6.28;
  for (let i = 0; i < faces; i++) {
    // spread round the sphere evenly, then nudged so it doesn't look it
    const y = 1 - (2 * (i + 0.5)) / faces;
    const k = Math.sqrt(1 - y * y);
    const a = turn + i * golden;
    const n = unit([Math.cos(a) * k + (rnd() - 0.5) * 0.5, y + (rnd() - 0.5) * 0.5, Math.sin(a) * k + (rnd() - 0.5) * 0.5]);
    const h = Math.hypot(r[0] * n[0], r[1] * n[1], r[2] * n[2]);
    planes.push([...n, h * (1 - rnd() * spread)]);
  }
  return cleave(planes, { box: r.map((v) => v * 1.05), chips, deep: [0.04, 0.1], seed });
}

// Corundum's barrel (a sapphire's habit): a steep hexagonal dipyramid, its
// waist trimmed by a second prism, cut off flat at both ends.
export function barrel({ r = 0.15, h = 0.3, taper = 0.24, jitter = 0.05, chips = 2, seed = 1 } = {}) {
  const planes = [
    ...around(6, taper, r * Math.cos(taper)),
    ...around(6, -taper, r * Math.cos(taper)),
    ...around(6, 0, r * 0.95, Math.PI / 6),
    [0, 1, 0, h],
    [0, -1, 0, h],
  ];
  return cleave(planes, { box: [r * 1.5, h * 1.2, r * 1.5], jitter, chips, seed });
}

// Corundum's other habit (a ruby's): a six-sided plate, its alternate edges
// bevelled by rhombohedral faces — three on top, three turned between them
// underneath — lying flat (stand it up to show its face).
export function tabular({ r = 0.2, t = 0.08, bevel = 0.85, jitter = 0.05, chips = 2, seed = 1 } = {}) {
  const d = (r * Math.cos(bevel) + t * Math.sin(bevel)) * 0.9;
  const planes = [
    ...around(6, 0, r),
    [0, 1, 0, t],
    [0, -1, 0, t],
    ...around(3, bevel, d),
    ...around(3, -bevel, d, Math.PI / 3),
  ];
  return cleave(planes, { box: [r * 1.3, t * 1.5, r * 1.3], jitter, chips, seed });
}

// Topaz: a long lozenge prism (two pairs of prism faces and a pinacoid at
// the sharp ends) under a wedge-and-pyramid tip with a small flat top, and
// broken off at an angle at the foot where it grew from the rock.
export function topazPrism({ w = 0.12, top = 0.3, foot = 0.28, jitter = 0.05, chips = 2, seed = 1 } = {}) {
  const rnd = seeded(seed * 31 + 7);
  const planes = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const a = 0.5; // {110}: the main prism faces
      planes.push([sx * Math.cos(a), 0, sz * Math.sin(a), w]);
      const b = 1.0; // {120}: narrower faces between them
      planes.push([sx * Math.cos(b), 0, sz * Math.sin(b), w * 1.12]);
      const g = 0.55; // {111}: the pyramid round the tip
      planes.push([sx * Math.cos(a) * Math.cos(g), Math.sin(g), sz * Math.sin(a) * Math.cos(g), w * Math.cos(g) + (top - w * 1.6) * Math.sin(g)]);
    }
    planes.push([0, 0, sx, w * 1.35]); // {010}
    const e = 0.75; // {021}: the wedge
    planes.push([0, Math.sin(e), sx * Math.cos(e), w * 1.25 * Math.cos(e) + (top - w * 1.4) * Math.sin(e)]);
  }
  planes.push([0, 1, 0, top]); // {001}: a small flat top
  planes.push([...unit([(rnd() - 0.5) * 0.7, -1, (rnd() - 0.5) * 0.7]), foot]); // where it broke off
  return cleave(planes, { box: [w * 2, Math.max(top, foot) * 1.3, w * 2], jitter, chips, seed });
}

// A quartz-type point (citrine): a six-sided prism under a six-sided pyramid,
// broken off at the foot.
export function point({ r = 0.1, len = 0.24, tip = 0.16, foot = 0.22, jitter = 0.06, chips = 2, seed = 1 } = {}) {
  const rnd = seeded(seed * 37 + 11);
  const g = Math.atan2(r, tip);
  return cleave([
    ...around(6, 0, r),
    ...around(6, g, r * Math.cos(g) + len * Math.sin(g)),
    [...unit([(rnd() - 0.5) * 0.8, -1, (rnd() - 0.5) * 0.8]), foot],
  ], { box: [r * 1.4, (len + tip) * 1.2, r * 1.4], jitter, chips, seed });
}

// Beryl (a natural emerald): a six-sided prism with a flat top, its top edges
// just bevelled, broken off at the foot.
export function hexPrism({ r = 0.1, top = 0.26, foot = 0.24, jitter = 0.05, chips = 2, seed = 1 } = {}) {
  const rnd = seeded(seed * 41 + 3);
  return cleave([
    ...around(6, 0, r),
    [0, 1, 0, top],
    ...around(6, 0.8, (r * Math.cos(0.8) + top * Math.sin(0.8)) * 0.975),
    [...unit([(rnd() - 0.5) * 0.6, -1, (rnd() - 0.5) * 0.6]), foot],
  ], { box: [r * 1.4, Math.max(top, foot) * 1.3, r * 1.4], jitter, chips, seed });
}

// Zircon: a four-sided prism under a four-sided pyramid at each end.
export function tetragonal({ w = 0.1, len = 0.12, tip = 0.15, jitter = 0.05, chips = 2, seed = 1 } = {}) {
  const g = Math.atan2(w, tip);
  const d = w * Math.cos(g) + len * Math.sin(g);
  return cleave([...around(4, 0, w), ...around(4, g, d), ...around(4, -g, d)], { box: [w * 1.5, (len + tip) * 1.2, w * 1.5], jitter, chips, seed });
}

// Garnet: a rhombic dodecahedron, the edges worn round by the faces of a
// trapezohedron — the ball of twelve rhombs a garnet grows as.
export function dodecahedron({ r = 0.2, round = 0.93, jitter = 0.04, chips = 2, seed = 1 } = {}) {
  const planes = [];
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    for (const sa of [-1, 1]) {
      for (const sb of [-1, 1]) {
        const n = [0, 0, 0];
        n[a] = sa;
        n[b] = sb;
        planes.push([...unit(n), r]);
      }
    }
  }
  for (let big = 0; big < 3; big++) {
    for (const s0 of [-1, 1]) {
      for (const s1 of [-1, 1]) {
        for (const s2 of [-1, 1]) {
          const n = [s0, s1, s2];
          n[big] *= 2;
          planes.push([...unit(n), r * 1.1547 * round]);
        }
      }
    }
  }
  return cleave(planes, { box: [r * 1.5, r * 1.5, r * 1.5], jitter, chips, seed });
}

// Fluorite: the octahedron it cleaves into, its points blunted.
export function octahedron({ r = 0.2, blunt = 0.82, jitter = 0.05, chips = 3, seed = 1 } = {}) {
  const planes = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) planes.push([...unit([sx, sy, sz]), r]);
  for (let a = 0; a < 3; a++) {
    for (const s of [-1, 1]) {
      const n = [0, 0, 0];
      n[a] = s;
      planes.push([...n, r * Math.sqrt(3) * blunt]);
    }
  }
  return cleave(planes, { box: [r * 2, r * 2, r * 2], jitter, chips, seed });
}

// A cube, not quite square (pyrite).
export function cube({ s = 0.1, jitter = 0.04, chips = 1, seed = 1 } = {}) {
  return cleave([[1, 0, 0, s], [-1, 0, 0, s], [0, 1, 0, s], [0, -1, 0, s], [0, 0, 1, s], [0, 0, -1, s]], { box: [s * 1.5, s * 1.5, s * 1.5], jitter, chips, deep: [0.03, 0.08], seed });
}

// A blade of kyanite: long, flat and thin, its end broken at a slant.
export function blade({ len = 0.5, w = 0.07, t = 0.022, jitter = 0.04, chips = 2, seed = 1 } = {}) {
  const rnd = seeded(seed * 43 + 1);
  return cleave([
    [1, 0, 0, w],
    [-1, 0, 0, w],
    [0, 0, 1, t],
    [0, 0, -1, t],
    ...around(4, 0, (w + t) * Math.SQRT1_2 * 0.88, Math.PI / 4),
    [...unit([(rnd() - 0.5) * 1.2, 1, 0]), len / 2],
    [0, -1, 0, len / 2],
  ], { box: [w * 1.5, len, t * 2], jitter, chips, deep: [0.03, 0.08], seed });
}

// Rounded lumps grown together (azurite, botryoidal): n little pebbles
// heaped round the middle; returns the geometries, already in place.
export function lumps({ n = 5, r = 0.11, spread = 0.11, seed = 1 } = {}) {
  const rnd = seeded(seed * 53 + 9);
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = 0.75 + rnd() * 0.5;
    const g = nugget({ r: [r * k, r * k * 0.9, r * k], faces: 18, spread: 0.08, chips: 1, seed: seed * 10 + i });
    const a = (i / n) * Math.PI * 2 + rnd();
    const rr = i === 0 ? 0 : spread * (0.6 + rnd() * 0.5);
    g.translate(Math.cos(a) * rr, (rnd() - 0.4) * spread * 0.9, Math.sin(a) * rr * 0.8);
    out.push(g);
  }
  return out;
}

// Mark where a stone's facet edges are, so the shader can draw them as fine
// lines the way a painting of a stone does: each triangle carries an edge
// coordinate per corner — (1,0,0), (0,1,0), (0,0,1), so the smallest
// component is 0 along its edges — and an edge that only splits a flat facet
// in two (a diagonal across a quad, a spoke of a fan) is hidden by holding its
// component at 1.
function facetEdges(g) {
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const tris = pos.length / 9;
  const key = (i) => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
  const edgeKey = (a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const owners = new Map();
  for (let t = 0; t < tris; t++) {
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(t * 3 + e, t * 3 + ((e + 1) % 3));
      if (!owners.has(k)) owners.set(k, []);
      owners.get(k).push(t);
    }
  }
  const same = (a, b) => nor[a * 9] * nor[b * 9] + nor[a * 9 + 1] * nor[b * 9 + 1] + nor[a * 9 + 2] * nor[b * 9 + 2] > 0.999;
  const edge = new Float32Array(pos.length);
  for (let t = 0; t < tris; t++) {
    for (let v = 0; v < 3; v++) edge[(t * 3 + v) * 3 + v] = 1;
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(t * 3 + e, t * 3 + ((e + 1) % 3));
      if (owners.get(k).some((o) => o !== t && same(o, t))) {
        const opp = (e + 2) % 3;
        for (let v = 0; v < 3; v++) edge[(t * 3 + v) * 3 + opp] = 1;
      }
    }
  }
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 3));
  return g;
}

// --- plane geometry for cleave() -----------------------------------------------------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const randomUnit = (rnd) => {
  const y = rnd() * 2 - 1;
  const a = rnd() * Math.PI * 2;
  const k = Math.sqrt(1 - y * y);
  return [Math.cos(a) * k, y, Math.sin(a) * k];
};
const reach = (faces, n) => {
  let h = -Infinity;
  for (const f of faces) for (const p of f.pts) h = Math.max(h, dot(n, p));
  return h;
};

// Points of a flat convex polygon, ordered anticlockwise seen from the side n
// faces.
function around3(pts, n) {
  const c = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  const u = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(n, u);
  return pts
    .map((p) => [p, Math.atan2(dot(sub(p, c), v), dot(sub(p, c), u))])
    .sort((a, b) => a[1] - b[1])
    .map(([p]) => p);
}

function boxFaces([x, y, z]) {
  const faces = [];
  for (const [n, pts] of [
    [[1, 0, 0], [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]]],
    [[-1, 0, 0], [[-x, -y, -z], [-x, y, -z], [-x, y, z], [-x, -y, z]]],
    [[0, 1, 0], [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]]],
    [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
    [[0, 0, -1], [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z]]],
  ]) faces.push({ n, pts: around3(pts, n) });
  return faces;
}

// Cut a convex solid (its faces, each a polygon anticlockwise about its
// outward normal) by a plane, keeping the side n·p <= d and capping the cut.
function clip(faces, n, d) {
  const eps = 1e-7;
  const out = [];
  const cut = [];
  for (const f of faces) {
    const pts = [];
    const m = f.pts.length;
    for (let i = 0; i < m; i++) {
      const a = f.pts[i];
      const b = f.pts[(i + 1) % m];
      const da = dot(n, a) - d;
      const db = dot(n, b) - d;
      if (da <= eps) pts.push(a);
      if (Math.abs(da) <= eps) cut.push(a);
      if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
        const t = da / (da - db);
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        pts.push(p);
        cut.push(p);
      }
    }
    if (pts.length >= 3) out.push({ n: f.n, pts });
  }
  const cap = [];
  for (const p of cut) if (!cap.some((q) => dot(sub(p, q), sub(p, q)) < 1e-12)) cap.push(p);
  if (cap.length >= 3) out.push({ n, pts: around3(cap, n) });
  return out;
}
