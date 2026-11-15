import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, moved, rgb, gateFrameParts, gateTop, leafParts } from './shapes.js';
import { crystal, stone, crystalPoint, hexPrism, nugget, barrel, tabular, lumps, octahedron } from './gems.js';
import { groundStrip, lod } from '../render/geo.js';
import { CONFIG } from '../config.js';
import { clearOfRiver } from './river.js';

// IV · Candy World — out of the Deepwood's shade into a country made of
// sweets. The road is biscuit and wafer, dead flat and straight on through
// rolling hills of frosting, gingerbread villages iced like wedding cakes,
// layered cake mesas and ice-cream towers with cherries on top, under a
// sugar-pastel sky full of marshmallow clouds. A river of melted chocolate
// winds through it all, alongside the road for a while and then right across
// it (jump it: see world/river.js); low chocolate bars and heaps of sweets
// lie in the lanes (jump), wafer beams sit on striped candy pillars (slide),
// and giant cookies, gummy bears and ice-cream cones stand in the way (go
// round). Every kind of sweet there is grows along the verges, and the mix
// changes as you go - a gingerbread village, a lollipop orchard, a
// patisserie's window, a chocolate quarry, a gummy meadow, an ice-cream
// parlour - so it never looks stamped out.
//
// Returns: a sunset of spun sugar; a sugar-lantern night, the windows lit and
// the gummies glowing; and a dream where the sweets float off into the sky.
//
// Every surface is made of something (toon option candy, render/candy.js):
// each part's mark flag says what - sugar-coated gumdrops glitter, cookies
// are crumbly, chocolate is glossy, gummies let the light through, hard
// candy shines like glass, frosting is satin and soft in its shade.

const K = {
  SUGAR: 0.1, COOKIE: 0.12, CHOC: 0.14, GUMMY: 0.16, HARD: 0.18, CREAM: 0.2, WAFER: 0.22, GLAZE: 0.24,
  ROCK: 0.26, CARAMEL: 0.28, MALLOW: 0.3, GINGER: 0.32, SPONGE: 0.34, STRIPE: 0.36, SWIRL: 0.38, BEAN: 0.4,
  MACARON: 0.42, BRITTLE: 0.44, FIELD: 0.46, SOUR: 0.48, LICORICE: 0.5, WRAP: 0.52, MINT: 0.54,
};

const C = {
  pink: '#ffb3d1', bubble: '#ff8cc0', hot: '#ff5c9d', rose: '#ffd2e4',
  mint: '#a8f0d0', mintDeep: '#62d6aa', lav: '#cdb6ff', lilac: '#b49af2',
  blue: '#acdcff', sky: '#7cc6ff', butter: '#ffe79a', lemon: '#fff2a6', peach: '#ffc9a6', apricot: '#ffac82',
  cream: '#fff6e8', vanilla: '#fff0d4', white: '#ffffff',
  choc: '#5a2c16', chocDark: '#3a1a0c', milk: '#8a5230', cocoa: '#6b3a1f',
  biscuit: '#e4b36c', toast: '#c98a48', ginger: '#c07a3e', gingerDk: '#94552a',
  wafer: '#f0c27a', caramel: '#d88a2a', cherry: '#e3192f', red: '#ff3550', gold: '#f0c050', foil: '#d8dde6',
};
const PASTELS = [C.pink, C.mint, C.lav, C.blue, C.butter, C.peach];
const PASTEL_TINTS = ['#ffb3d1', '#a8f0d0', '#cdb6ff', '#acdcff', '#ffe79a', '#ffc9a6', '#ffd2e4', '#c8f5e4'];
const BRIGHT = ['#ff4d8d', '#ffa62e', '#ffe14d', '#4fd67a', '#4fb6ff', '#a66cff', '#ff6a3d', '#ff8fd0'];
const GUMMY_TINTS = ['#ff3b4e', '#ff8a1f', '#ffd21f', '#4fd64a', '#ff5fae', '#ffffff', '#b061ff'];
const STRIPES = ['#ff2d4a', '#ff2d4a', '#3fc46a', '#ff6fb0', '#4f9cff', '#a660ff'];

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}

// a part made of something (one of K)
const mat = (geo, color, kind, o = {}) => part(geo, color, { ...o, mark: kind });

// uv for the stripes and twists drawn in the shader: x round it (0..1), y
// along it in metres. A torus's or a tube's own uv run the other way round.
function roundAlong(g, { swap = false, along = 1, offset = 0 } = {}) {
  const uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i += 2) {
    let a = uv[i];
    let b = uv[i + 1];
    if (swap) [a, b] = [b, a];
    uv[i] = a;
    uv[i + 1] = b * along + offset;
  }
  return g;
}

// A box with rounded edges (caramels, chocolate squares, wafer bars).
function roundBox(w, h, d, r = 0.3, n = 3) {
  const g = new THREE.BoxGeometry(2, 2, 2, n, n, n);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    c.set(Math.max(-1 + r, Math.min(1 - r, v.x)), Math.max(-1 + r, Math.min(1 - r, v.y)), Math.max(-1 + r, Math.min(1 - r, v.z)));
    const o = v.clone().sub(c);
    if (o.lengthSq() > 1e-8) {
      o.normalize();
      v.copy(c).addScaledVector(o, r);
      nor.setXYZ(i, o.x, o.y, o.z);
    }
    pos.setXYZ(i, (v.x * w) / 2, (v.y * h) / 2, (v.z * d) / 2);
  }
  return g;
}

// How finely tubes are built (see coarse): 1 as asked.
let TUBE = 1;
// Build a prop's parts coarser (k of the detail: tubes and every round
// primitive), for the sweets seen by the dozen.
function coarse(k, fn) {
  const was = TUBE;
  TUBE = k;
  try {
    return lod(k, fn);
  } finally {
    TUBE = was;
  }
}

// A tube along points (each [x, y, z]), radius r (or r(t)), uv round/along.
function tube(points, r, { seg = 24, radial = 8, closed = false, ridges = 0, ridgeK = 0.18 } = {}) {
  seg = Math.max(6, Math.round(seg * TUBE));
  radial = Math.max(ridges ? Math.min(radial, ridges * 2) : 5, Math.round(radial * TUBE));
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, closed);
  const pos = g.attributes.position;
  const len = curve.getLength();
  // (TubeGeometry lays out rings of radial+1 vertices along the curve)
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const rr = typeof r === 'function' ? r(t) : r;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const ridge = ridges ? 1 + ridgeK * Math.cos((j / radial) * Math.PI * 2 * ridges) : 1;
      pos.setXYZ(k, c.x + (pos.getX(k) - c.x) * rr * ridge, c.y + (pos.getY(k) - c.y) * rr * ridge, c.z + (pos.getZ(k) - c.z) * rr * ridge);
    }
  }
  g.computeVertexNormals();
  return roundAlong(g, { swap: true, along: len });
}

// A flat face whose uv is centred (a lollipop's swirl, a peppermint's pinwheel).
const disc = (r, n = 24) => new THREE.CircleGeometry(r, n);

// --- little sweets ----------------------------------------------------------------
function gumdrop(r, h, color, o = {}) {
  const prof = [[0, 0], [r * 0.98, 0], [r * 1.03, h * 0.12], [r * 0.97, h * 0.4], [r * 0.78, h * 0.72], [r * 0.45, h * 0.94], [0, h]];
  return mat(P.lathe(prof, 12), color, K.SUGAR, o);
}

// a jelly bean: a capsule, bent a little
function bean(len, r, color, o = {}) {
  const g = P.capsule(r, len, 3, 8);
  g.rotateZ(Math.PI / 2);
  const pos = g.attributes.position;
  const half = len / 2 + r;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / half;
    pos.setY(i, pos.getY(i) - 0.35 * r * (1 - x * x));
  }
  g.computeVertexNormals();
  return mat(g, color, K.BEAN, o);
}

// a lollipop: a swirled face each side, a glossy rim, a paper stick (built
// with its middle at the origin, facing +z; the stick below)
function lollipopParts(r, t, color, stick, o = {}) {
  const f = (z, ry) => mat(disc(r, 28), color, K.SWIRL, { z, ry, ...o, outline: 0 });
  return [
    f(t / 2, 0),
    f(-t / 2, Math.PI),
    mat(P.cyl(r, r, t, 28, 1, true), color, K.HARD, { rx: Math.PI / 2, ...o }),
    mat(P.torus(r, t * 0.5, 6, 28), color, K.HARD, { ...o, outline: 0.4 }),
    mat(P.cyl(r * 0.07, r * 0.07, stick, 6), C.cream, K.CREAM, { y: -stick / 2 - r * 0.9, outline: 0.5 }),
  ];
}

// a peppermint: a red pinwheel on white each side (built lying flat)
function peppermint(r, t, color, o = {}) {
  return [
    mat(disc(r, 22), color, K.MINT, { y: t / 2, rx: -Math.PI / 2, ...o, outline: 0 }),
    mat(disc(r, 22), color, K.MINT, { y: -t / 2, rx: Math.PI / 2, ...o, outline: 0 }),
    mat(P.cyl(r, r, t, 22, 1, true), C.white, K.HARD, { ...o }),
  ];
}

// a sweet twisted up in cellophane (lying along x)
function wrapped(r, color, o = {}) {
  const parts = [mat(P.sphere(r, 12, 8), color, K.WRAP, { sx: 1.35, sy: 0.9, ...o })];
  for (const s of [-1, 1]) {
    parts.push(mat(P.cone(r * 0.75, r * 1.0, 8), color, K.WRAP, { x: s * r * 1.85, rz: s * Math.PI / 2, sx: 1, sz: 0.55, ...o, outline: 0.4 }));
    parts.push(mat(P.cyl(r * 0.18, r * 0.18, r * 0.5, 6), color, K.WRAP, { x: s * r * 1.35, rz: Math.PI / 2, ...o, outline: 0 }));
  }
  return parts;
}

// a cookie: a rounded disc of dough lying flat (radius r, thick t), with
// chocolate chips pressed into both faces
function cookieParts(r, t, { color = C.biscuit, chips = 14, seed = 1, chipColor = C.chocDark, faces = 2 } = {}) {
  const rnd = seeded(seed);
  const prof = [[0, 0], [r * 0.9, 0], [r * 0.99, t * 0.2], [r, t * 0.55], [r * 0.95, t * 0.88], [r * 0.82, t], [0, t * 1.04]];
  const parts = [mat(P.lathe(prof, 22), null, K.COOKIE, { grad: [C.toast, color, 0, t * 0.6] })];
  for (let f = 0; f < faces; f++) {
    for (let i = 0; i < chips; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * r * 0.8;
      const cr = r * (0.06 + rnd() * 0.05);
      parts.push(mat(P.dodeca(cr), chipColor, K.CHOC, { x: Math.cos(a) * rr, y: f ? 0.01 : t * 1.0, z: Math.sin(a) * rr, sy: 0.55, ry: rnd() * 6, outline: 0.3 }));
    }
  }
  return parts;
}

// a sandwich cookie: two dark discs pressed with a pattern, white cream
// between (lying flat)
function sandwichParts(r, t, { cream = C.white, seed = 2 } = {}) {
  const dark = '#4a2a1c';
  const parts = [];
  for (const [y0, flip] of [[0, false], [t * 1.25, true]]) {
    const prof = [[0, 0], [r * 0.95, 0], [r, t * 0.3], [r, t * 0.7], [r * 0.95, t], [0, t]];
    parts.push(mat(P.lathe(prof, 26), dark, K.COOKIE, { y: y0 }));
    const fy = flip ? y0 + t + 0.004 : y0 - 0.004;
    parts.push(mat(P.torus(r * 0.72, t * 0.1, 4, 26), dark, K.COOKIE, { y: fy, rx: Math.PI / 2, outline: 0.3 }));
    parts.push(mat(P.torus(r * 0.36, t * 0.1, 4, 20), dark, K.COOKIE, { y: fy, rx: Math.PI / 2, outline: 0.3 }));
    // a flower pressed in the middle, a ring of studs round the edge
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(mat(P.sphere(r * 0.09, 6, 4), dark, K.COOKIE, { x: Math.cos(a) * r * 0.18, y: fy, z: Math.sin(a) * r * 0.18, sy: 0.4, outline: 0.3 }));
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      parts.push(mat(P.sphere(t * 0.16, 5, 3), dark, K.COOKIE, { x: Math.cos(a) * r * 0.86, y: fy, z: Math.sin(a) * r * 0.86, sy: 0.5, outline: 0.3 }));
    }
  }
  parts.push(mat(P.cyl(r * 0.94, r * 0.94, t * 0.3, 26), cream, K.CREAM, { y: t * 1.12 }));
  return parts;
}

// a gummy bear standing (about 1.6 tall), see-through, tinted
function gummyBearParts(o = {}) {
  const g = { tint: 1, ...o };
  const W = '#ffffff';
  const parts = [
    mat(P.sphere(0.42, 14, 10), W, K.GUMMY, { y: 0.66, sy: 1.12, sz: 0.82, ...g }),
    mat(P.sphere(0.34, 14, 10), W, K.GUMMY, { y: 1.33, sx: 1.06, sy: 0.94, sz: 0.86, ...g }),
    mat(P.sphere(0.15, 10, 7), W, K.GUMMY, { y: 1.25, z: 0.27, sx: 1.25, sy: 0.85, sz: 0.8, ...g, outline: 0.4 }),
  ];
  for (const s of [-1, 1]) {
    parts.push(mat(P.sphere(0.12, 8, 6), W, K.GUMMY, { x: s * 0.25, y: 1.6, z: -0.02, sz: 0.7, ...g, outline: 0.5 }));
    parts.push(mat(P.capsule(0.12, 0.18, 3, 8), W, K.GUMMY, { x: s * 0.42, y: 0.86, z: 0.12, rz: s * 0.7, rx: -0.4, ...g }));
    parts.push(mat(P.sphere(0.2, 10, 7), W, K.GUMMY, { x: s * 0.23, y: 0.2, z: 0.1, sy: 0.85, sz: 1.15, ...g }));
    // its eyes, moulded in
    parts.push(mat(P.sphere(0.035, 6, 4), '#7a7a7a', K.GUMMY, { x: s * 0.11, y: 1.4, z: 0.28, ...g, outline: 0 }));
  }
  parts.push(mat(P.sphere(0.03, 6, 4), '#6a6a6a', K.GUMMY, { y: 1.29, z: 0.39, ...g, outline: 0 }));
  return parts;
}

// a waffle cone (point down at the origin, rim at h)
function coneParts(r, h, o = {}) {
  return [
    mat(P.lathe([[0.02, 0], [r * 0.15, h * 0.08], [r, h]], 16), null, K.WAFER, { grad: [C.toast, C.wafer, 0, h], ...o }),
    mat(P.torus(r * 1.0, r * 0.11, 5, 18), C.wafer, K.WAFER, { y: h, rx: Math.PI / 2, ...o }),
  ];
}

// a scoop of ice cream (sitting on y = 0), a drippy rim where it was
// scooped; tinted, sprinkled or plain
function scoopParts(r, { color = C.white, tint = 1, sprinkles = false, drips = 7, seed = 3, chips = 0 } = {}) {
  const rnd = seeded(seed);
  const parts = [mat(P.sphere(r, 16, 12), color, sprinkles ? K.GLAZE : K.CREAM, { y: r * 0.82, sy: 0.92, tint })];
  // the ragged rim
  const rim = P.torus(r * 0.92, r * 0.2, 6, 24);
  const pos = rim.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    const k = 1 + 0.12 * Math.sin(a * 9 + seed) + 0.06 * Math.sin(a * 17);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i));
  }
  rim.computeVertexNormals();
  parts.push(mat(rim, color, K.CREAM, { y: r * 0.3, rx: Math.PI / 2, tint }));
  for (let i = 0; i < drips; i++) {
    const a = rnd() * Math.PI * 2;
    const L = r * (0.2 + rnd() * 0.45);
    parts.push(mat(P.capsule(r * 0.09, L, 2, 6), color, K.CREAM, { x: Math.cos(a) * r * 0.95, y: r * 0.25 - L * 0.4, z: Math.sin(a) * r * 0.95, tint, outline: 0.4 }));
  }
  for (let i = 0; i < chips; i++) {
    const a = rnd() * Math.PI * 2;
    const e = rnd() * 1.2;
    parts.push(mat(P.dodeca(r * 0.07), C.chocDark, K.CHOC, { x: Math.cos(a) * Math.cos(e) * r * 0.98, y: r * 0.82 + Math.sin(e) * r * 0.9, z: Math.sin(a) * Math.cos(e) * r * 0.98, outline: 0 }));
  }
  return parts;
}

// a swirl piped from a star nozzle, winding up to a peak (soft serve, a
// cupcake's frosting, a meringue)
function swirlParts(r, h, color, { turns = 2.6, tube: tr = 0.32, kind = K.CREAM, tint = 1, ridges = 6, seg = 48 } = {}) {
  const pts = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const rr = r * (1 - t) * 0.82;
    pts.push([Math.cos(a) * rr, h * t * 0.85 + r * tr * 0.6, Math.sin(a) * rr]);
  }
  const g = tube(pts, (t) => r * tr * (1 - 0.65 * t), { seg, radial: 10, ridges, ridgeK: 0.14 });
  return [
    mat(g, color, kind, { tint }),
    mat(P.cone(r * tr * 0.4, h * 0.2, 8), color, kind, { y: h * 0.85 + r * tr * 0.6 + h * 0.06, tint, outline: 0.4 }),
  ];
}

function cherry(r, o = {}) {
  return [
    mat(P.sphere(r, 12, 9), C.cherry, K.HARD, { sy: 0.92, ...o, y: (o.y || 0) + r * 0.9 }),
    mat(P.cyl(r * 0.07, r * 0.09, r * 1.6, 4), '#5a7a28', 0, { x: (o.x || 0) + r * 0.2, y: (o.y || 0) + r * 2.3, z: o.z || 0, rz: -0.35, outline: 0.4 }),
  ];
}

// a cupcake: a pleated paper case, the sponge risen over it, a swirl of
// frosting (or a dome glazed with sprinkles) and a cherry
function cupcakeParts(s, { caseColor = C.pink, frost = C.white, glazed = false, seed = 4 } = {}) {
  const r = 0.5 * s, h = 0.55 * s;
  const cs = P.cyl(r * 1.05, r * 0.82, h, 28, 1, true);
  const pos = cs.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 + 0.045 * Math.cos(a * 22);
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  cs.computeVertexNormals();
  const parts = [
    mat(cs, caseColor, 0, { y: h / 2 }),
    mat(P.cyl(r * 0.82, r * 0.82, 0.02, 20), caseColor, 0, { y: 0.01, outline: 0 }),
    mat(P.sphere(r * 1.02, 16, 8), '#e8b066', K.SPONGE, { y: h, sy: 0.55 }),
  ];
  if (glazed) {
    parts.push(mat(P.sphere(r * 1.0, 18, 10), frost, K.GLAZE, { y: h + r * 0.1, sy: 0.62, tint: 1 }));
    parts.push(...cherry(r * 0.22, { y: h + r * 0.62 }));
  } else {
    parts.push(...moved(swirlParts(r * 1.05, r * 1.25, frost, { turns: 2.3, tube: 0.34, seg: 40 }), { y: h + r * 0.18 }));
    parts.push(...cherry(r * 0.2, { y: h + r * 1.42 }));
  }
  return parts;
}

// a donut: dough, a glaze running over its top half and dripping, sprinkled
// (lying flat, or tipped up with rx)
function donutParts(R, r, { glaze = C.pink, sprinkled = true, seed = 5, o = {} } = {}) {
  const dough = P.torus(R, r, 12, 28);
  const gl = P.torus(R, r * 1.06, 12, 28);
  const pos = gl.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(y, x);
    const cx = Math.cos(a) * R, cy = Math.sin(a) * R;
    // (the glaze covers the top - +z here, before it's laid down - down to a
    // wavy line round each side)
    const edge = -0.18 * r - 0.3 * r * (0.5 + 0.5 * Math.sin(a * 7 + seed)) - 0.2 * r * Math.sin(a * 13 + seed) ** 2;
    if (z < edge) {
      const k = 0.85;
      pos.setXYZ(i, cx + (x - cx) * k, cy + (y - cy) * k, z * k);
    }
  }
  gl.computeVertexNormals();
  return [
    mat(dough, null, K.COOKIE, { grad: ['#c98846', '#f0b86a', -r, r], rx: -Math.PI / 2, y: r, ...o }),
    mat(gl, glaze, sprinkled ? K.GLAZE : K.CHOC, { rx: -Math.PI / 2, y: r, tint: 1, ...o }),
  ];
}

// a macaron: two shells on their ruffled feet, a filling between
const dome = (r, ws = 16, hs = 8) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2);
function macaronParts(r, { color = C.pink, fill = C.white, o = {} } = {}) {
  const parts = [
    // the bottom shell (upside down), its foot, the filling, the top's foot and the top
    mat(dome(r), color, K.MACARON, { y: r * 0.42, rx: Math.PI, sy: 0.42, tint: 1, ...o }),
    mat(dome(r), color, K.MACARON, { y: r * 0.8, sy: 0.42, tint: 1, ...o }),
    mat(P.cyl(r * 0.86, r * 0.86, r * 0.24, 20), fill, K.CREAM, { y: r * 0.61, ...o }),
  ];
  for (const y of [0.45, 0.77]) {
    const foot = P.torus(r * 0.93, r * 0.07, 4, 24);
    const fp = foot.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setZ(i, fp.getZ(i) * (1 + 0.6 * Math.sin(i * 1.7)));
    foot.computeVertexNormals();
    parts.push(mat(foot, color, K.SPONGE, { y: r * y, rx: Math.PI / 2, tint: 1, ...o, outline: 0 }));
  }
  return parts;
}

// a meringue kiss, piped with ridges that twist to its peak
function meringue(r, h, color, o = {}) {
  const g = P.lathe([[0, 0], [r, 0], [r * 0.97, h * 0.18], [r * 0.7, h * 0.45], [r * 0.32, h * 0.75], [r * 0.08, h * 0.95], [0, h]], 24);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x) + (y / h) * 1.6;
    const k = 1 + 0.12 * Math.cos(a * 8);
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return mat(g, color, K.CREAM, o);
}

// a candy cane: a striped stick with its crook at the top (crook toward +x)
function caneParts(h, r, color, o = {}) {
  const R = r * 3.2;
  const stick = roundAlong(P.cyl(r, r, h, 14, 6), { along: h });
  const crook = roundAlong(P.torus(R, r, 10, 18, Math.PI), { swap: true, along: -Math.PI * R, offset: h + Math.PI * R });
  return [
    mat(stick, color, K.STRIPE, { y: h / 2, tint: 1, ...o }),
    mat(crook, color, K.STRIPE, { x: R, y: h, tint: 1, ...o }),
    mat(P.sphere(r, 10, 6), color, K.HARD, { x: R * 2, y: h, tint: 1, sy: 0.5, outline: 0 }),
  ];
}

// a licorice twist along points, red or black
const licorice = (pts, r, color, o = {}) => mat(tube(pts, r, { seg: 28, radial: 8, ridges: 5, ridgeK: 0.12 }), color, K.LICORICE, o);

// a strip along a path in the x/y plane (ribbon candy, a sour belt): w wide
// in z; uv.x across it, uv.y along it (0 for ribbon candy: its stripes run
// along it)
function strip(path, w, { n = 60, along = true } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  let len = 0;
  let prev = path(0);
  for (let i = 0; i <= n; i++) {
    const p = path(i / n);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    for (let j = 0; j <= 2; j++) {
      pos.push(p[0], p[1], (j / 2 - 0.5) * w);
      uv.push(j / 2, along ? len : 0);
    }
  }
  // (the back its own vertices, so each face keeps its own normal)
  const half = pos.length / 3;
  pos.push(...pos);
  uv.push(...uv);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j, b = a + 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      idx.push(half + a, half + a + 1, half + b, half + a + 1, half + b + 1, half + b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ribbon candy: a glossy striped ribbon folded back and forth in loops
function ribbonCandy(L, h, w, color, o = {}) {
  const loops = 4;
  const g = strip((t) => [t * L - (L / loops) * 0.5 * Math.sin(t * Math.PI * 2 * loops), h * 0.5 * (1 - Math.cos(t * Math.PI * 2 * loops)) + 0.02], w, { n: 90, along: false });
  return mat(g, color, K.STRIPE, { tint: 1, ...o, outline: 0 });
}

// a sour belt, coated in sour sugar, its bands of colour along it
const sourBelt = (path, w, o = {}) => mat(strip(path, w, { n: 40 }), C.white, K.SOUR, { ...o, outline: 0 });

// a caramel: a soft square, rounded
const caramel = (s, o = {}) => mat(roundBox(s, s * 0.8, s, 0.35, 3), C.caramel, K.CARAMEL, o);

// a shard of brittle: amber sugar glass round peanuts, broken off
function brittle(r, t, seed, o = {}) {
  const rnd = seeded(seed);
  const s = new THREE.Shape();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.65 + rnd() * 0.45);
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return mat(P.extrude(s, t, 1), '#e0952e', K.BRITTLE, { rx: Math.PI / 2, ...o });
}

// a jelly fruit slice: a half-moon of sugared jelly with its rind
function jellySlice(r, t, color, rind, o = {}) {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI, false);
  s.closePath();
  const ring = new THREE.Shape();
  ring.absarc(0, 0, r * 1.08, 0, Math.PI, false);
  ring.lineTo(-r, 0);
  ring.absarc(0, 0, r, Math.PI, 0, true);
  ring.closePath();
  return [
    mat(P.extrude(s, t, 14), color, K.SUGAR, { ...o }),
    mat(P.extrude(ring, t * 1.02, 14), rind, K.SUGAR, { ...o, outline: 0.4 }),
  ];
}

// rock candy: sugar crystals grown thick on a stick
function rockCandy(h, color, seed, o = {}) {
  const rnd = seeded(seed);
  const parts = [mat(P.cyl(0.025, 0.025, h, 5), '#f4e4c8', 0, { y: h / 2, ...o, outline: 0.4 })];
  for (let i = 0; i < 22; i++) {
    const y = h * (0.45 + rnd() * 0.5);
    const a = rnd() * Math.PI * 2;
    const r = 0.05 + rnd() * 0.05;
    parts.push(mat(new THREE.OctahedronGeometry(r, 0), color, K.ROCK, { x: Math.cos(a) * 0.07, y, z: Math.sin(a) * 0.07, sy: 1.5, rx: rnd(), rz: rnd(), tint: 1, ...o, outline: 0.3 }));
  }
  return parts;
}

// a wafer bar: crisp wafer layered with cream (lying along x), or dipped in chocolate
function waferBar(L, w, h, { cream = C.pink, dipped = false, o = {} } = {}) {
  const parts = [];
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const wafer = i % 2 === 0;
    const lh = wafer ? h * 0.26 : h * 0.11;
    const y = (i / layers) * h;
    parts.push(mat(roundBox(L, lh, w, wafer ? 0.12 : 0.02, 2), wafer ? C.wafer : cream, wafer ? K.WAFER : K.CREAM, { y: y + lh / 2, ...o, outline: wafer ? 1 : 0 }));
  }
  if (dipped) parts.push(mat(roundBox(L * 0.55, h * 1.06, w * 1.08, 0.2, 2), C.choc, K.CHOC, { x: L * 0.23, y: h * 0.45, ...o }));
  return parts;
}

// a marshmallow: a soft pillow of a cylinder, dusted
function mallow(r, h, color, o = {}) {
  const g = P.lathe([[0, 0], [r * 0.85, 0], [r, h * 0.15], [r * 1.02, h * 0.5], [r, h * 0.85], [r * 0.85, h], [0, h]], 16);
  return mat(g, color, K.MALLOW, o);
}

// a chocolate truffle: dusted in cocoa, rolled in nuts, or glossy and drizzled
function truffle(r, kind, o = {}) {
  const parts = [mat(P.sphere(r, 14, 10), kind === 1 ? C.cocoa : C.choc, kind === 0 ? K.MALLOW : kind === 1 ? K.COOKIE : K.CHOC, { y: r * 0.9, ...o })];
  if (kind === 2) {
    for (let i = 0; i < 4; i++) {
      parts.push(mat(P.torus(r * (0.98 - i * 0.05), r * 0.05, 4, 20, Math.PI * 0.9), C.cream, K.CREAM, { y: r * 0.9, rx: Math.PI / 2 + 0.6 - i * 0.35, ry: i * 0.9, ...o, outline: 0 }));
    }
  }
  return parts;
}

// a bonbon in its pleated foil cup
function bonbon(r, foil, o = {}) {
  const cup = P.lathe([[0, 0], [r * 0.8, 0], [r * 1.05, r * 0.55], [r * 1.12, r * 0.6]], 24);
  const pos = cup.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 + 0.06 * Math.cos(a * 18);
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  cup.computeVertexNormals();
  return [
    mat(cup, foil, K.WRAP, { ...o }),
    mat(dome(r, 14, 9), C.choc, K.CHOC, { y: r * 0.45, sy: 0.85, ...o }),
    ...swirlParts(r * 0.45, r * 0.4, C.chocDark, { kind: K.CHOC, tint: 0, turns: 1.6, seg: 24 }).map((g) => g.translate((o.x || 0), r * 1.15 + (o.y || 0), (o.z || 0))),
  ];
}

// a chocolate bar: a slab of squares, half out of its foil and paper
function chocoBarParts(nx, nz, sq, t, { wrapper = C.red, foil = true, milk = false } = {}) {
  const parts = [];
  const w = nx * sq, d = nz * sq;
  const col = milk ? C.milk : C.choc;
  parts.push(mat(roundBox(w, t * 0.5, d, 0.1, 2), col, K.CHOC, { y: t * 0.25 }));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      parts.push(mat(roundBox(sq * 0.86, t * 0.55, sq * 0.86, 0.32, 2), col, K.CHOC, { x: (i + 0.5) * sq - w / 2, y: t * 0.6, z: (j + 0.5) * sq - d / 2, outline: 0.5 }));
    }
  }
  if (foil) {
    const fw = w * 0.42;
    parts.push(mat(roundBox(fw, t * 1.08, d * 1.04, 0.15, 2), C.foil, K.WRAP, { x: w / 2 - fw / 2 + 0.01, y: t * 0.52 }));
    parts.push(mat(roundBox(fw * 0.7, t * 1.16, d * 1.08, 0.12, 2), wrapper, 0, { x: w / 2 - fw * 0.35 + 0.02, y: t * 0.55, tint: 1 }));
  }
  return parts;
}

// candy buttons: a paper strip dotted with little sugar buttons
function candyButtons(L, o = {}) {
  const parts = [mat(P.box(L, 0.01, 0.22), C.white, 0, { y: 0.005, ...o, outline: 0.4 })];
  const cols = [C.hot, C.sky, C.butter];
  for (let i = 0; i < Math.floor(L / 0.09); i++) {
    for (let j = 0; j < 3; j++) {
      parts.push(mat(P.sphere(0.03, 6, 4), cols[j], K.MACARON, { x: -L / 2 + 0.05 + i * 0.09, y: 0.012, z: (j - 1) * 0.065, sy: 0.6, ...o, outline: 0 }));
    }
  }
  return parts;
}

// --- trees and plants ---------------------------------------------------------------
// a lollipop as tall as a tree, a satin bow tied under it
function lollipopTreeParts(h, r, { ball = false, bow = C.pink } = {}) {
  const parts = [mat(P.cyl(0.09, 0.12, h, 8), C.cream, K.CREAM, { y: h / 2 })];
  if (ball) {
    parts.push(mat(P.sphere(r, 20, 14), C.white, K.HARD, { y: h + r * 0.85, tint: 1 }));
    // a twist of cellophane caught round its neck
    parts.push(mat(P.cone(r * 0.45, r * 0.6, 10), C.white, K.WRAP, { y: h + r * 0.05, rx: Math.PI, outline: 0.4 }));
  } else {
    parts.push(...moved(lollipopParts(r, r * 0.22, C.white, 0.01, { tint: 1 }).slice(0, 4), { y: h + r * 0.9 }));
  }
  // the bow
  const by = h - 0.05 + (ball ? 0 : r * 0.05);
  for (const s of [-1, 1]) {
    parts.push(mat(P.torus(0.24, 0.07, 6, 14), bow, K.CREAM, { x: s * 0.24, y: by, sx: 1.2, rz: s * 0.25, ry: 0.2, outline: 0.5 }));
    parts.push(mat(P.box(0.1, 0.42, 0.03), bow, K.CREAM, { x: s * 0.12, y: by - 0.28, rz: s * 0.35, outline: 0.4 }));
  }
  parts.push(mat(P.sphere(0.09, 8, 6), bow, K.CREAM, { y: by, outline: 0.4 }));
  return parts;
}

// a cotton-candy tree: clouds of spun sugar on a twisted licorice trunk
function cottonTreeParts(seed, { trunk = '#c8283a' } = {}) {
  const rnd = seeded(seed);
  const h = 3.6 + rnd() * 1.2;
  const parts = [licorice([[0, 0, 0], [0.1, h * 0.35, 0.05], [-0.08, h * 0.7, -0.05], [0.05, h, 0]], 0.16, trunk)];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd();
    const rr = i === 0 ? 0 : 0.9 + rnd() * 0.6;
    const r = i === 0 ? 1.4 : 0.8 + rnd() * 0.5;
    const y = h + 0.4 + (i === 0 ? 0.6 : rnd() * 1.0 - 0.3);
    parts.push(mat(P.ico(r, TUBE < 0.9 ? 1 : 2), C.white, K.MALLOW, { x: Math.cos(a) * rr, y, z: Math.sin(a) * rr, sy: 0.82, tint: 1 }));
  }
  return parts;
}

// a gummy succulent: a rosette of fat jelly leaves curling out of the frosting
function gummyPlantParts(seed, n = 8) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const L = 0.55 + rnd() * 0.4;
    const g = P.cone(0.12, L, 6);
    g.translate(0, L / 2, 0);
    // curl it out and over
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) / L;
      pos.setZ(k, pos.getZ(k) * 0.45 + y * y * L * 0.45);
    }
    g.computeVertexNormals();
    parts.push(mat(g, C.white, K.GUMMY, { ry: -a + Math.PI / 2, rx: 0.35 + rnd() * 0.3, tint: 1, outline: 0.4 }));
  }
  parts.push(mat(P.sphere(0.14, 8, 6), C.white, K.GUMMY, { y: 0.12, tint: 1, outline: 0 }));
  return parts;
}

// sour-straw grass: thin glossy blades in lime, green and lemon
function candyGrassParts(seed, n = 11) {
  const rnd = seeded(seed);
  const cols = ['#9be34a', '#5ccf54', '#d8f05a', '#7fe08a'];
  const parts = [];
  for (let i = 0; i < n; i++) {
    const h = 0.28 + rnd() * 0.42;
    const a = rnd() * 6.28;
    const rr = Math.sqrt(rnd()) * 0.3;
    const g = P.cyl(0.004, 0.028, h, 4);
    g.translate(0, h / 2, 0);
    parts.push(mat(g, cols[i % 4], K.HARD, { x: Math.cos(a) * rr, z: Math.sin(a) * rr, rz: (rnd() - 0.5) * 0.7, rx: (rnd() - 0.5) * 0.5, outline: 0 }));
  }
  return parts;
}

// frosting flowers: piped rosettes, each with a sugar pearl
function rosetteParts(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const x = (rnd() - 0.5) * 0.7, z = (rnd() - 0.5) * 0.5;
    const r = 0.11 + rnd() * 0.06;
    parts.push(...moved(swirlParts(r, r * 0.5, C.white, { turns: 1.6, tube: 0.4, seg: 20 }), { x, z }));
    parts.push(mat(P.sphere(r * 0.22, 6, 4), C.white, K.HARD, { x, y: r * 0.72, z, outline: 0 }));
    for (let k = 0; k < 2; k++) {
      const a = rnd() * 6.28;
      parts.push(mat(P.sphere(0.08, 6, 3), C.mintDeep, K.CREAM, { x: x + Math.cos(a) * r * 1.3, y: 0.02, z: z + Math.sin(a) * r * 1.3, sx: 1.4, sy: 0.25, sz: 0.6, ry: -a, outline: 0 }));
    }
  }
  return parts;
}

// --- buildings ----------------------------------------------------------------------
// A gingerbread house, iced: walls of spiced gingerbread, a roof of frosting
// (or chocolate tiles, or wafer), icing piped along every edge and dripping
// off the eaves, boiled-sweet windows lit from inside, a chocolate door with
// a gumdrop knob, gumdrops along the ridge, candy canes either side of the
// door, a chimney puffing a marshmallow. Faces +z.
function gingerHouseParts(kind, seed) {
  const rnd = seeded(seed);
  const w = kind === 2 ? 3.4 : 4.6 + rnd() * 0.8;
  const d = kind === 2 ? 3.0 : 3.8;
  const h = kind === 2 ? 2.6 : 3.3 + rnd() * 0.5;
  const rh = w * 0.55;
  const parts = [mat(P.box(w, h, d), C.ginger, K.GINGER, { y: h / 2, tint: 1 })];
  // the roof: two slabs meeting at the ridge, a little overhang
  const sl = Math.hypot(w / 2 + 0.35, rh);
  const ang = Math.atan2(rh, w / 2 + 0.35);
  const roofKind = kind === 0 ? K.CREAM : kind === 1 ? K.CHOC : K.WAFER;
  const roofCol = kind === 0 ? C.white : kind === 1 ? C.choc : C.wafer;
  for (const s of [-1, 1]) {
    parts.push(mat(P.box(sl, 0.28, d + 0.7), roofCol, roofKind, { x: (s * (w / 2 + 0.35)) / 2, y: h + rh / 2, rz: -s * ang }));
    if (kind === 1) {
      // rows of chocolate tiles
      for (let r = 0; r < 4; r++) {
        const t = (r + 0.5) / 4;
        parts.push(mat(P.box(0.06, 0.08, d + 0.7), C.chocDark, K.CHOC, { x: s * (w / 2 + 0.35) * (1 - t) * 1.0, y: h + rh * t + 0.16, rz: -s * ang, outline: 0 }));
      }
    }
    // icing dripping off the eaves
    for (let i = 0; i < 9; i++) {
      const z = -d / 2 - 0.3 + ((i + 0.5) / 9) * (d + 0.6);
      const L = 0.15 + rnd() * 0.25;
      parts.push(mat(P.capsule(0.07, L, 2, 6), C.white, K.CREAM, { x: s * (w / 2 + 0.38), y: h - L * 0.3, z, outline: 0.3 }));
    }
  }
  // the gables, filled in
  const gable = new THREE.Shape();
  gable.moveTo(-w / 2, 0);
  gable.lineTo(w / 2, 0);
  gable.lineTo(0, rh * 0.96);
  gable.closePath();
  parts.push(mat(P.extrude(gable, d, 1), C.ginger, K.GINGER, { y: h, tint: 1 }));
  // piped icing along the gable's edges and the ridge, in dots
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      parts.push(mat(P.sphere(0.09, 6, 4), C.white, K.CREAM, { x: s * (w / 2 + 0.38) * (1 - t), y: h + rh * t + 0.18, z: d / 2 + 0.36, outline: 0 }));
    }
  }
  for (let i = 0; i < 5; i++) {
    const z = -d / 2 - 0.1 + (i / 4) * (d + 0.2);
    parts.push(gumdrop(0.2, 0.26, BRIGHT[(i + seed) % BRIGHT.length], { y: h + rh + 0.05, z }));
  }
  // the door, the windows
  const dw = 0.95, dh = 1.75;
  parts.push(mat(roundBox(dw, dh, 0.16, 0.2, 2), C.choc, K.CHOC, { y: dh / 2, z: d / 2 + 0.02 }));
  parts.push(mat(P.cyl(dw / 2, dw / 2, 0.16, 14, 1, false, 0, Math.PI), C.choc, K.CHOC, { y: dh, z: d / 2 + 0.02, rx: Math.PI / 2, rz: Math.PI / 2 }));
  parts.push(gumdrop(0.07, 0.09, C.hot, { x: dw * 0.3, y: dh * 0.48, z: d / 2 + 0.1, rx: Math.PI / 2 }));
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * Math.PI;
    parts.push(mat(P.sphere(0.06, 6, 4), C.white, K.CREAM, { x: Math.cos(a) * (dw / 2 + 0.08), y: dh + Math.sin(a) * (dw / 2 + 0.08), z: d / 2 + 0.1, outline: 0 }));
  }
  const winCol = ['#ffd34a', '#ff8fb8', '#8fe0ff'][seed % 3];
  const win = (x, y, z, ry) => {
    parts.push(mat(P.box(0.72, 0.72, 0.06), winCol, K.HARD, { x, y, z, ry, emit: 0.55 }));
    parts.push(mat(P.box(0.86, 0.08, 0.1), C.white, K.CREAM, { x, y: y + 0.4, z, ry, outline: 0.3 }));
    parts.push(mat(P.box(0.86, 0.08, 0.1), C.white, K.CREAM, { x, y: y - 0.4, z, ry, outline: 0.3 }));
    parts.push(mat(P.box(0.06, 0.72, 0.08), C.white, K.CREAM, { x, y, z, ry, outline: 0 }));
    parts.push(mat(P.box(0.72, 0.06, 0.08), C.white, K.CREAM, { x, y, z, ry, outline: 0 }));
  };
  for (const s of [-1, 1]) win(s * w * 0.3, h * 0.6, d / 2 + 0.03, 0);
  if (kind !== 2) for (const s of [-1, 1]) win(s * (w / 2 + 0.03), h * 0.55, 0, Math.PI / 2);
  // candy canes by the door, a chimney with a marshmallow puffing out of it
  for (const s of [-1, 1]) parts.push(...moved(caneParts(1.5, 0.07, C.red), { x: s * (dw / 2 + 0.35), z: d / 2 + 0.35, ry: s > 0 ? Math.PI : 0 }));
  parts.push(mat(P.box(0.6, 1.4, 0.6), C.gingerDk, K.GINGER, { x: w * 0.25, y: h + rh * 0.65 + 0.4, z: -d * 0.2 }));
  parts.push(mallow(0.32, 0.5, C.white, { x: w * 0.25, y: h + rh * 0.65 + 1.15, z: -d * 0.2, rz: 0.3 }));
  // a gumdrop path up to the door
  for (let i = 0; i < 4; i++) parts.push(gumdrop(0.13, 0.12, BRIGHT[(i * 3 + seed) % BRIGHT.length], { x: (i % 2 ? 0.45 : -0.45), z: d / 2 + 0.7 + i * 0.5 }));
  return parts;
}

// An ice-cream tower: a waffle cone as tall as a house, windows let into it
// and a balcony of chocolate round it, standing in a puddle of melt, and on
// top scoops as big as rooms, a whipped swirl and a cherry. Tinted scoops.
function iceTowerParts(seed) {
  const rnd = seeded(seed);
  const H = 9 + rnd() * 3;
  const R = 2.4;
  const parts = [
    mat(P.lathe([[0.9, 0], [1.05, 0.5], [R, H]], 20), null, K.WAFER, { grad: [C.toast, C.wafer, 0, H] }),
    mat(P.torus(R, 0.22, 6, 24), C.wafer, K.WAFER, { y: H, rx: Math.PI / 2 }),
    mat(P.cyl(2.6, 3.0, 0.2, 20), C.white, K.CREAM, { y: 0.1, tint: 1 }),
  ];
  // windows round it, lit
  for (let i = 0; i < 7; i++) {
    const y = 2 + i * 1.1;
    const a = i * 2.1 + rnd();
    const rr = 0.9 + ((R - 0.9) * y) / H + 0.03;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    parts.push(mat(P.cyl(0.32, 0.32, 0.08, 12), '#ffd85a', K.HARD, { x, y, z, rx: Math.PI / 2, ry: -a + Math.PI / 2, emit: 0.6 }));
    parts.push(mat(P.torus(0.34, 0.06, 4, 14), C.white, K.CREAM, { x, y, z, ry: -a + Math.PI / 2, outline: 0.3 }));
  }
  const by = H * 0.62;
  parts.push(mat(P.torus(0.9 + ((R - 0.9) * by) / H + 0.25, 0.14, 6, 26), C.choc, K.CHOC, { y: by, rx: Math.PI / 2 }));
  // the scoops
  let y = H - 0.2;
  const sizes = [R * 1.15, R * 0.95];
  sizes.forEach((r, i) => {
    parts.push(...moved(scoopParts(r, { tint: 1, sprinkles: i === 1, drips: 9, seed: seed + i, chips: i === 0 ? 10 : 0 }), { y }));
    y += r * 1.5;
  });
  parts.push(...moved(swirlParts(1.4, 1.8, C.white, { tint: 0, turns: 2.5, seg: 40 }), { y: y - 0.3 }));
  parts.push(...cherry(0.5, { y: y + 1.45 }));
  return parts;
}

// a soft-serve tower: a swirl of ice cream as tall as a church, in its cone
function softServeTowerParts(seed) {
  const H = 6;
  const parts = [...coneParts(2.1, H)];
  parts.push(...moved(swirlParts(2.6, 9, C.white, { tint: 1, turns: 3.4, tube: 0.36, seg: 70 }), { y: H - 0.5 }));
  parts.push(mat(P.cyl(2.4, 2.9, 0.18, 20), C.white, K.CREAM, { y: 0.09, tint: 1 }));
  return parts;
}

// --- the land ------------------------------------------------------------------------
// A rolling hill of frosting, sprinkled; now and then drizzled with
// chocolate, or crowned with a cherry. (Tinted.)
function frostHillParts(kind, seed) {
  const rnd = seeded(seed);
  const parts = [];
  if (kind === 0) {
    parts.push(mat(P.sphere(10, 26, 12), C.white, K.FIELD, { y: -4, sy: 0.9, tint: 1 }));
    for (let i = 0; i < 3; i++) {
      const R = 6.5 - i * 1.9;
      parts.push(mat(P.torus(R, 0.26, 5, 30, Math.PI * (0.7 + rnd() * 0.5)), C.choc, K.CHOC, { y: -4 + 9 * Math.sqrt(1 - (R / 10.2) ** 2), rx: Math.PI / 2, ry: rnd() * 6, outline: 0 }));
    }
  } else if (kind === 1) {
    // a big soft swirl of a hill
    parts.push(...swirlParts(9, 7, C.white, { tint: 1, turns: 2.2, tube: 0.42, seg: 50, ridges: 7, kind: K.FIELD }));
  } else {
    // two soft humps, a cherry on the higher
    parts.push(mat(P.sphere(8, 22, 10), C.white, K.FIELD, { y: -2, sy: 1.0, tint: 1 }));
    parts.push(mat(P.sphere(6, 20, 9), C.white, K.FIELD, { x: 7, y: -1.5, z: 2, sy: 0.85, tint: 1 }));
    parts.push(...cherry(1.3, { y: 5.8 }));
  }
  return parts;
}

// a spill of frosting in another colour over the land, its edge soft and
// lumpy where it ran (tinted)
function frostPatchGeo(seed) {
  const rnd = seeded(seed);
  const s = new THREE.Shape();
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + 0.18 * Math.sin(a * 3 + seed) + 0.1 * (rnd() - 0.5);
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.12, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  return merge([mat(g, C.white, K.FIELD, { tint: 1, outline: 0 })]);
}

// A layered cake standing up out of the land like a mesa: tiers of sponge
// and cream and jam, frosting poured over each and running down its sides,
// fruit and chocolate shards on top. Faces every way.
function cakeMesaParts(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const sponge = [C.butter, '#c9875a', '#ffc2cf'][seed % 3];
  const frost = [C.white, C.pink, C.mint, C.lav][seed % 4];
  let y = 0;
  let r = 9;
  for (let tier = 0; tier < 3; tier++) {
    const th = 2.6 - tier * 0.35;
    for (let l = 0; l < 3; l++) {
      const lh = th / 3;
      parts.push(mat(P.cyl(r, r, lh * 0.78, 30, 1, true), sponge, K.SPONGE, { y: y + lh * l + lh * 0.39 }));
      parts.push(mat(P.cyl(r * 1.005, r * 1.005, lh * 0.22, 30, 1, true), l === 1 ? '#e8364e' : C.cream, K.CREAM, { y: y + lh * l + lh * 0.89 }));
    }
    y += th;
    parts.push(mat(P.cyl(r * 1.03, r * 1.03, 0.4, 30), frost, K.CREAM, { y: y }));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
      const L = 0.4 + rnd() * 1.1;
      parts.push(mat(P.capsule(0.22, L, 2, 6), frost, K.CREAM, { x: Math.cos(a) * r * 1.03, y: y - L * 0.5, z: Math.sin(a) * r * 1.03, outline: 0.4 }));
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      parts.push(...moved(swirlParts(0.5, 0.5, frost, { tint: 0, turns: 1.6, seg: 18 }), { x: Math.cos(a) * r * 0.88, y: y + 0.2, z: Math.sin(a) * r * 0.88 }));
    }
    r *= 0.68;
  }
  for (let i = 0; i < 5; i++) {
    const a = rnd() * 6.28;
    parts.push(...cherry(0.7, { x: Math.cos(a) * r * 0.6, y: y + 0.2, z: Math.sin(a) * r * 0.6 }));
  }
  return parts;
}

// a giant slice of layer cake on its side
function cakeSliceParts(seed) {
  const sponge = [C.butter, '#c9875a', '#ffc2cf'][seed % 3];
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(2.6, -1.0);
  s.absarc(0, 0, 2.8, -0.37, 0.37, false);
  s.closePath();
  const parts = [];
  const layers = [[0.5, sponge, K.SPONGE], [0.14, C.cream, K.CREAM], [0.5, sponge, K.SPONGE], [0.14, '#e8364e', K.CREAM], [0.5, sponge, K.SPONGE], [0.22, C.white, K.CREAM]];
  let y = 0;
  for (const [h, c, k] of layers) {
    parts.push(mat(P.extrude(s, h, 10), c, k, { y: y + h / 2, rx: Math.PI / 2, tint: k === K.CREAM && c === C.white ? 1 : 0 }));
    y += h;
  }
  parts.push(...moved(swirlParts(0.45, 0.5, C.white, { tint: 1, turns: 1.8, seg: 20 }), { x: 2.2, y }));
  parts.push(...cherry(0.32, { x: 2.2, y: y + 0.45 }));
  return parts;
}

// a marshmallow cloud: soft pillows of marshmallow piled up, pink in their
// shade and vanilla where the sun's on them
function cloudParts(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const n = 6 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = i === 0 ? 0 : 2.2 + rnd() * 1.8;
    const r = i === 0 ? 2.8 : 1.6 + rnd() * 1.1;
    const h = r * (1.1 + rnd() * 0.4);
    const g = P.lathe([[0, 0], [r * 0.82, 0], [r, h * 0.15], [r * 1.04, h * 0.5], [r, h * 0.85], [r * 0.82, h], [0, h]], 18);
    const x = Math.cos(a) * rr * 1.5, z = Math.sin(a) * rr * 0.7;
    const y = (i === 0 ? 0.6 : rnd() * 1.4) - h / 2;
    parts.push(mat(g, null, K.MALLOW, { x, y, z, rx: Math.PI / 2 + (rnd() - 0.5) * 0.9, rz: (rnd() - 0.5) * 1.2, ry: rnd() * 6, grad: ['#ffc6dc', '#fff8ee', -2.5, 2.5] }));
  }
  return parts;
}

// --- the road's edge, and the river ---------------------------------------------------
// frosting piped along the edge of the road: a shell border, swelling and
// pinching as it was squeezed out, ridged from the star nozzle (tinted)
function pipingParts(L) {
  const pts = [];
  for (let i = 0; i <= 16; i++) pts.push([0, 0.1, -(i / 16) * L]);
  const shells = Math.round(L / 0.36);
  const g = tube(pts, (t) => 0.1 + 0.07 * Math.abs(Math.sin(t * Math.PI * shells)), { seg: shells * 4, radial: 6, ridges: 3, ridgeK: 0.12 });
  return [mat(g, C.white, K.CREAM, { tint: 1 })];
}

// A stretch of the river's surface (see world/river.js): x 0..1 along it, z
// -1..1 bank to bank, bowed up a little in the middle - all the rest is
// done on the GPU.
function riverWaterGeo() {
  const g = new THREE.PlaneGeometry(1, 2, 6, 12);
  g.rotateX(-Math.PI / 2);
  g.translate(0.5, 0, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setY(i, 0.035 + 0.035 * (1 - z * z));
  }
  g.computeVertexNormals();
  return merge([part(g, C.choc, { outline: 0 })]);
}

// A stretch of the river's banks, both sides: built in metres (x 0..PIECE
// along, each bank at z = ±(10 + how far out from the edge of the
// chocolate)), then squeezed to 0..1 along (the shader stretches it back).
// kind 0: crumbled cookie, a lip of chocolate where it's soaked, candy
// pebbles; kind 1: the same with other sweets; kind 2: where the river
// crosses the road - a clean biscuit edge with a bead of white icing along
// it, chocolate dripping over it, so you see the edge to jump from.
function riverBankGeo(kind, seed, len) {
  const rnd = seeded(seed);
  const parts = [];
  const ribbon = (side, e0, e1, prof, color, k, o = {}) => {
    const nx = 8, ne = 4;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ne; j++) {
        const x = (i / nx) * len;
        const e = e0 + ((e1 - e0) * j) / ne;
        const bump = o.bump ? (Math.sin(x * 7.1 + e * 9 + seed) * 0.5 + Math.sin(x * 13.3 - e * 5 + seed * 2) * 0.5) * o.bump : 0;
        pos.push(x, prof(e) + bump, side * (10 + e));
      }
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ne; j++) {
        const a = i * (ne + 1) + j, b = a + ne + 1;
        if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(mat(g, color, k, { outline: 0, ...o.part }));
  };
  for (const side of [-1, 1]) {
    if (kind < 2) {
      // chocolate soaked into the foot of the bank, then cookie crumb
      ribbon(side, -0.14, 0.16, (e) => 0.02 + 0.13 * Math.sin(((e + 0.14) / 0.3) * Math.PI * 0.5), C.chocDark, K.CHOC);
      ribbon(side, 0.14, BANK_OUT, (e) => 0.15 * Math.cos(((e - 0.14) / (BANK_OUT - 0.14)) * Math.PI * 0.5) ** 1.5 + 0.005, null, K.COOKIE, { bump: 0.025, part: { grad: ['#c98a48', '#e8b874', 0, 0.15] } });
      // crumbs and sweets along it
      const n = 7;
      for (let i = 0; i < n; i++) {
        const x = rnd() * len;
        const e = 0.2 + rnd() * 0.5;
        const z = side * (10 + e);
        const y = 0.15 * Math.cos(((e - 0.14) / (BANK_OUT - 0.14)) * Math.PI * 0.5) ** 1.5;
        const r = rnd();
        if (r < 0.35) parts.push(mat(P.dodeca(0.05 + rnd() * 0.05), '#d89a52', K.COOKIE, { x, y, z, sy: 0.6, ry: rnd() * 6, outline: 0.3 }));
        else if (kind === 0 && r < 0.6) parts.push(bean(0.07, 0.035, BRIGHT[Math.floor(rnd() * BRIGHT.length)], { x, y: y + 0.02, z, ry: rnd() * 6, outline: 0.3 }));
        else if (kind === 0 && r < 0.8) parts.push(gumdrop(0.06, 0.07, BRIGHT[Math.floor(rnd() * BRIGHT.length)], { x, y: y - 0.01, z, outline: 0.3 }));
        else if (kind === 1 && r < 0.65) parts.push(mat(P.sphere(0.05, 6, 4), PASTELS[Math.floor(rnd() * PASTELS.length)], K.MACARON, { x, y, z, sy: 0.55, outline: 0.3 }));
        else if (kind === 1 && r < 0.85) parts.push(...moved(peppermint(0.07, 0.03, C.red), { x, y: y + 0.02, z, rz: (rnd() - 0.5) * 0.4 }));
        else parts.push(mat(P.sphere(0.035, 5, 3), C.choc, K.CHOC, { x, y: y + 0.01, z, outline: 0 }));
      }
    } else {
      // the road's biscuit, broken off clean, its edge iced
      ribbon(side, -0.1, 0.0, (e) => 0.075 * ((e + 0.1) / 0.1), C.toast, K.COOKIE);
      ribbon(side, 0.0, 0.55, (e) => 0.075 * Math.cos((e / 0.55) * Math.PI * 0.5) ** 0.6 + 0.003, '#e9bb7a', K.COOKIE);
      const icing = new THREE.CylinderGeometry(0.038, 0.038, len, 6, 8, true);
      icing.rotateZ(Math.PI / 2);
      icing.translate(len / 2, 0, 0);
      parts.push(mat(icing, C.white, K.CREAM, { y: 0.085, z: side * (10 + 0.01), outline: 0 }));
      for (let i = 0; i < 3; i++) {
        const L = 0.05 + rnd() * 0.06;
        parts.push(mat(P.capsule(0.03, L, 2, 5), C.chocDark, K.CHOC, { x: rnd() * len, y: 0.04, z: side * (10 - 0.06), rx: side * 0.5, outline: 0 }));
      }
    }
  }
  const g = merge(parts);
  // squeeze it to 0..1 along (the normals stay as built: the shader
  // stretches it back to its length)
  const pos = g.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) pos[i] /= len;
  return g;
}
const BANK_OUT = 0.85;

// --- assortments: little heaps of sweets for the verges -------------------------------
// Each its own mix, so a verge is never one sweet over and over; turned
// every which way where they're put.
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
function assortParts(kind, seed) {
  const rnd = seeded(seed);
  const parts = [];
  const at = (spread = 0.7) => [(rnd() - 0.5) * spread * 2, (rnd() - 0.5) * spread * 1.4];
  if (kind === 'gumdrops') {
    // gumdrops big and small, and jelly beans spilled round them
    for (let i = 0; i < 6; i++) {
      const [x, z] = at(0.55);
      const r = 0.12 + rnd() * 0.14;
      parts.push(gumdrop(r, r * 1.25, BRIGHT[(i * 3 + seed) % BRIGHT.length], { x, z }));
    }
    for (let i = 0; i < 12; i++) {
      const [x, z] = at(0.9);
      parts.push(bean(0.07, 0.04, BRIGHT[Math.floor(rnd() * BRIGHT.length)], { x, y: 0.035, z, ry: rnd() * 6, outline: 0.4 }));
    }
  } else if (kind === 'mints') {
    // peppermints and wrapped sweets, a candy cane fallen over them
    for (let i = 0; i < 4; i++) {
      const [x, z] = at(0.6);
      const up = rnd() < 0.5;
      parts.push(...moved(peppermint(0.16, 0.06, i % 2 ? C.red : '#2fb86a'), up ? { x, y: 0.16, z, rx: Math.PI / 2, ry: rnd() * 3 } : { x, y: 0.03, z }));
    }
    for (let i = 0; i < 3; i++) {
      const [x, z] = at(0.7);
      parts.push(...moved(wrapped(0.09, pick(rnd, BRIGHT)), { x, y: 0.08, z, ry: rnd() * 6 }));
    }
    parts.push(...moved(caneParts(0.9, 0.045, pick(rnd, STRIPES)), { x: -0.2, y: 0.05, z: 0.15, rz: -Math.PI / 2 + 0.05, ry: rnd() }));
  } else if (kind === 'patisserie') {
    // a stack of macarons, meringue kisses round it
    const cols = [C.pink, C.mint, C.lav, C.butter, C.peach, C.blue];
    let y = 0;
    for (let i = 0; i < 3; i++) {
      parts.push(...moved(macaronParts(0.17, { color: cols[(i + seed) % 6], fill: i === 1 ? '#ffe0a0' : C.white }), { y, ry: rnd() }));
      y += 0.17 * 1.15;
    }
    for (let i = 0; i < 5; i++) {
      const [x, z] = at(0.65);
      parts.push(meringue(0.1 + rnd() * 0.05, 0.16 + rnd() * 0.06, cols[(i * 2 + seed) % 6], { x: x + (x > 0 ? 0.2 : -0.2), z }));
    }
  } else if (kind === 'chocolates') {
    // truffles, bonbons in their foil cups, squares broken off a bar
    for (let i = 0; i < 3; i++) {
      const [x, z] = at(0.55);
      parts.push(...moved(truffle(0.12 + rnd() * 0.04, i % 3), { x, z }));
    }
    for (let i = 0; i < 2; i++) {
      const [x, z] = at(0.6);
      parts.push(...moved(bonbon(0.13, i ? C.gold : '#e85a8a'), { x, z }));
    }
    for (let i = 0; i < 3; i++) {
      const [x, z] = at(0.75);
      parts.push(mat(roundBox(0.16, 0.08, 0.16, 0.3, 2), i % 2 ? C.milk : C.choc, K.CHOC, { x, y: 0.04, z, ry: rnd() * 6, rz: (rnd() - 0.5) * 0.4 }));
    }
  } else if (kind === 'caramels') {
    // caramels, some still in their cellophane, and shards of brittle
    for (let i = 0; i < 6; i++) {
      const [x, z] = at(0.55);
      parts.push(caramel(0.16 + rnd() * 0.05, { x, y: 0.07, z, ry: rnd() * 6 }));
    }
    for (let i = 0; i < 2; i++) {
      const [x, z] = at(0.6);
      parts.push(...moved(wrapped(0.08, '#ffd27a'), { x, y: 0.07, z, ry: rnd() * 6 }));
    }
    parts.push(brittle(0.32, 0.05, seed + 3, { x: 0.35, y: 0.16, z: -0.25, rz: 0.5, ry: 0.4 }));
    parts.push(brittle(0.26, 0.05, seed + 9, { x: -0.4, y: 0.03, z: 0.2 }));
  } else if (kind === 'fruity') {
    // sugared jelly slices, a sour belt curled up, licorice twists
    const fr = [['#ff9a1f', '#ffd27a'], ['#ffe02e', '#fff2a0'], ['#7fe04a', '#d8ff9a'], ['#ff4a6a', '#ffb0c0']];
    for (let i = 0; i < 5; i++) {
      const [x, z] = at(0.6);
      const [c0, c1] = fr[(i + seed) % 4];
      parts.push(...moved(jellySlice(0.14, 0.06, c0, c1), { x, y: 0.0, z, ry: rnd() * 6, rx: rnd() < 0.5 ? 0 : -Math.PI / 2 }));
    }
    parts.push(sourBelt((t) => [Math.cos(t * 4.5) * 0.25 * (1 - t * 0.5), 0.04 + t * 0.12], 0.07, { ry: rnd(), x: 0.2, z: -0.2 }));
    for (let i = 0; i < 2; i++) {
      const [x, z] = at(0.5);
      const L = 0.7;
      parts.push(licorice([[x - L / 2, 0.05, z], [x - L / 6, 0.08, z + 0.08], [x + L / 6, 0.05, z - 0.05], [x + L / 2, 0.07, z]], 0.035, i ? '#2a1a20' : '#d8263a'));
    }
  } else if (kind === 'bakery') {
    // cookies, a wafer bar or two, marshmallows
    for (let i = 0; i < 3; i++) {
      const [x, z] = at(0.5);
      parts.push(...moved(cookieParts(0.2, 0.05, { seed: seed + i, chips: 6, faces: 1 }), { x, y: i * 0.02, z, rx: (rnd() - 0.5) * 0.3 }));
    }
    parts.push(...moved(waferBar(0.5, 0.12, 0.1, { cream: pick(rnd, [C.pink, C.white, '#ffd27a']) }), { x: 0.3, z: 0.25, ry: rnd() }));
    parts.push(...moved(waferBar(0.5, 0.12, 0.1, { dipped: true, cream: C.white }), { x: -0.25, y: 0, z: -0.3, ry: rnd() }));
    for (let i = 0; i < 4; i++) {
      const [x, z] = at(0.7);
      parts.push(mallow(0.09, 0.15, pick(rnd, [C.white, C.pink, '#fff3b0', C.mint]), { x, z, rx: rnd() < 0.4 ? Math.PI / 2 : 0, y: rnd() < 0.4 ? 0.09 : 0, ry: rnd() * 6 }));
    }
  } else if (kind === 'parlour') {
    // scoops of ice cream fallen in the frosting, a cone stuck in, wafers
    const cols = [C.pink, C.mint, '#fff0c8', '#8a5230', C.lav];
    for (let i = 0; i < 2; i++) {
      const [x, z] = at(0.55);
      parts.push(...moved(scoopParts(0.18, { color: cols[(i + seed) % 5], tint: 0, drips: 3, seed: seed + i, sprinkles: i === 1 }), { x, y: -0.05, z }));
    }
    parts.push(...moved([...coneParts(0.14, 0.5), ...moved(scoopParts(0.16, { color: cols[seed % 5], tint: 0, drips: 3 }), { y: 0.46 })], { x: 0.35, y: 0.45, z: -0.3, rx: Math.PI * 0.85 }));
    parts.push(...moved(waferBar(0.35, 0.08, 0.07, { cream: C.white }), { x: -0.3, z: 0.3, ry: rnd() }));
  } else if (kind === 'buttons') {
    // strips of candy buttons and a few candy hearts
    for (let i = 0; i < 2; i++) parts.push(...moved(candyButtons(0.7), { x: (rnd() - 0.5) * 0.4, z: i * 0.35 - 0.15, ry: rnd() * 0.6 }));
    for (let i = 0; i < 5; i++) {
      const [x, z] = at(0.6);
      const h = new THREE.Shape();
      h.moveTo(0, -0.06);
      h.bezierCurveTo(0.09, 0.0, 0.08, 0.07, 0.0, 0.035);
      h.bezierCurveTo(-0.08, 0.07, -0.09, 0.0, 0, -0.06);
      parts.push(mat(P.extrude(h, 0.03, 6), pick(rnd, PASTELS), K.MACARON, { x, y: 0.015, z, rx: -Math.PI / 2, rz: rnd() * 6 }));
    }
  }
  return parts;
}

// --- obstacles ------------------------------------------------------------------------
// L · a chocolate bar lying across the lane, half out of its foil and paper
// (the paper tinted)
function chocoBarLowGeo(milk) {
  const parts = chocoBarParts(4, 2, 0.44, 0.5, { milk });
  if (milk) {
    // a corner broken off, lying in front
    parts.push(mat(roundBox(0.38, 0.24, 0.38, 0.3, 2), C.milk, K.CHOC, { x: -1.08, y: 0.12, z: 0.22, ry: 0.5, rz: 0.2 }));
  }
  return merge(parts).translate(0, 0, -0.44);
}

// L · a heap of sweets, poured out on a mound of sugar
function sweetPileGeo(seed) {
  const rnd = seeded(seed);
  const parts = [mat(P.sphere(1, 18, 9), C.white, K.SUGAR, { y: -0.22, sx: 0.98, sy: 0.72, sz: 0.6 })];
  const surf = (x, z) => -0.22 + 0.72 * Math.sqrt(Math.max(0, 1 - (x / 0.98) ** 2 - (z / 0.6) ** 2));
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 0.85;
    const x = Math.cos(a) * rr * 0.98, z = Math.sin(a) * rr * 0.6;
    const y = surf(x, z) - 0.02;
    const k = i % 6;
    if (k === 0 || k === 3) {
      const r = 0.1 + rnd() * 0.06;
      parts.push(gumdrop(r, r * 1.2, BRIGHT[i % BRIGHT.length], { x, y, z, rz: x * 0.4, rx: -z * 0.4 }));
    } else if (k === 1) parts.push(...moved(wrapped(0.08, BRIGHT[(i + 3) % BRIGHT.length]), { x, y: y + 0.07, z, ry: rnd() * 6 }));
    else if (k === 2) parts.push(...moved(peppermint(0.12, 0.05, i % 4 ? C.red : '#2fb86a'), { x, y: y + 0.04, z, rx: -z * 0.6, rz: x * 0.5 }));
    else parts.push(bean(0.08, 0.045, BRIGHT[(i * 5) % BRIGHT.length], { x, y: y + 0.04, z, ry: rnd() * 6 }));
  }
  return merge(parts).translate(0, 0, -0.62);
}

// L · a stack of cookies: chocolate chip, a sandwich cookie, a jam ring
function cookieStackGeo() {
  const parts = [...cookieParts(0.84, 0.17, { seed: 3, chips: 16 })];
  parts.push(...moved(sandwichParts(0.76, 0.13), { y: 0.18, x: 0.08, z: 0.04, ry: 0.4 }));
  const jam = cookieParts(0.66, 0.14, { seed: 7, chips: 0, color: '#f4cf90' });
  jam.push(mat(P.sphere(0.24, 14, 6), '#d8203a', K.HARD, { y: 0.12, sy: 0.35 }));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    jam.push(mat(P.sphere(0.07, 6, 4), '#f8e0b0', K.COOKIE, { x: Math.cos(a) * 0.5, y: 0.14, z: Math.sin(a) * 0.5, sy: 0.5, outline: 0 }));
  }
  parts.push(...moved(jam, { y: 0.48, x: -0.05, z: -0.05 }));
  return merge(parts).translate(0, 0, -0.84);
}

// L · caramels heaped up, brittle propped against them
function caramelHeapGeo() {
  const rnd = seeded(17);
  const parts = [];
  for (let i = 0; i < 5; i++) parts.push(caramel(0.36, { x: -0.8 + i * 0.4, y: 0.15, z: (rnd() - 0.5) * 0.1, ry: (rnd() - 0.5) * 0.3 }));
  for (let i = 0; i < 3; i++) parts.push(caramel(0.34, { x: -0.4 + i * 0.4, y: 0.44, z: (rnd() - 0.5) * 0.1, ry: (rnd() - 0.5) * 0.4 }));
  parts.push(brittle(0.38, 0.06, 4, { x: 0.25, y: 0.36, z: 0.24, rx: 0.9 + Math.PI / 2, ry: 0.2 }));
  parts.push(brittle(0.34, 0.06, 8, { x: -0.6, y: 0.32, z: 0.22, rx: 1.0 + Math.PI / 2, ry: -0.4 }));
  for (let i = 0; i < 3; i++) parts.push(...moved(wrapped(0.1, '#ffd27a'), { x: -0.7 + i * 0.7, y: 0.08, z: 0.4, ry: rnd() }));
  return merge(parts).translate(0, 0, -0.56);
}

// W · a giant chocolate-chip cookie standing on its edge in its own crumbs
function cookieWallGeo(seed) {
  const rnd = seeded(seed);
  const r = 1.18, t = 0.34;
  const parts = moved(cookieParts(r, t, { seed, chips: 24 }), { rx: Math.PI / 2, y: r - 0.05, z: -t / 2 });
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2;
    parts.push(mat(P.dodeca(0.06 + rnd() * 0.08), '#d89a52', K.COOKIE, { x: Math.cos(a) * 0.9, y: 0.03, z: Math.sin(a) * 0.4, sy: 0.6, ry: rnd() * 6, outline: 0.3 }));
  }
  return merge(parts).translate(0, 0, -0.5);
}

// W · a giant sandwich cookie standing on its edge
function sandwichWallGeo() {
  const r = 1.12, t = 0.16;
  // (turned a little, so the cream shows)
  const parts = moved(moved(sandwichParts(r, t), { rx: Math.PI / 2, y: r - 0.04, z: -t * 1.12 }), { ry: 0.5 });
  return merge(parts).translate(0, 0, -0.66);
}

// W · a gummy bear as big as a person (tinted)
const gummyBearWallGeo = () => merge(gummyBearParts()).scale(1.5, 1.5, 1.5).translate(0, 0, -0.62);

// W · an ice-cream cone planted point-down, two scoops on it and a cherry,
// melting into a puddle round its foot (the scoops tinted)
function coneWallGeo() {
  const parts = [mat(P.cyl(0.9, 1.05, 0.06, 20), C.white, K.CREAM, { y: 0.03, tint: 1 })];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    parts.push(mat(P.sphere(0.32, 10, 5), C.white, K.CREAM, { x: Math.cos(a) * 0.8, y: 0.02, z: Math.sin(a) * 0.8, sy: 0.15, tint: 1, outline: 0 }));
  }
  parts.push(...coneParts(0.74, 2.0));
  parts.push(...moved(scoopParts(0.82, { tint: 1, drips: 8, seed: 5, chips: 8 }), { y: 1.92 }));
  parts.push(...moved(scoopParts(0.66, { color: '#ffd8e6', tint: 0, drips: 6, seed: 9, sprinkles: true }), { y: 3.05 }));
  parts.push(...cherry(0.2, { y: 3.95 }));
  return merge(parts).translate(0, 0, -0.85);
}

// W · a giant lollipop planted in a heap of sugar, its swirl to the runner
function lollipopWallGeo() {
  const parts = moved(lollipopParts(1.05, 0.26, C.white, 2.1, { tint: 1 }), { y: 2.1 + 1.05 * 0.9 - 0.15 });
  parts.push(mat(P.sphere(0.6, 12, 6), C.white, K.SUGAR, { y: -0.15, sy: 0.55, sz: 0.7 }));
  return merge(parts).translate(0, 0, -0.42);
}

// H · a beam of wafer laid across two striped candy pillars (the pillars
// tinted). kind 0: pink cream wafer, ball tops, icing dripping off it; 1:
// dipped in chocolate and sprinkled, gumdrop tops; 2: a sour belt draped
// over it, peppermint tops
function waferBeamGeo(kind) {
  const D = CONFIG.duckLine;
  const y0 = D + 0.12;
  const H = 0.44;
  const parts = [];
  for (const s of [-1, 1]) {
    const ph = y0 + H + 0.1;
    parts.push(mat(roundAlong(P.cyl(0.16, 0.19, ph, 14, 6), { along: ph }), C.white, K.STRIPE, { x: s * 1.0, y: ph / 2, tint: 1 }));
    parts.push(mat(P.cyl(0.26, 0.3, 0.12, 14), C.white, K.HARD, { x: s * 1.0, y: 0.06, tint: 1 }));
    const top = ph;
    if (kind === 0) parts.push(mat(P.sphere(0.22, 14, 10), C.white, K.HARD, { x: s * 1.0, y: top + 0.17 }));
    else if (kind === 1) parts.push(gumdrop(0.22, 0.28, s > 0 ? '#ffe14d' : '#4fd67a', { x: s * 1.0, y: top - 0.02 }));
    else parts.push(...moved(peppermint(0.24, 0.08, C.red), { x: s * 1.0, y: top + 0.22, rx: Math.PI / 2 }));
  }
  parts.push(...moved(waferBar(2.4, 0.5, H, { cream: kind === 2 ? '#ffe9a8' : C.pink, dipped: false }), { y: y0 }));
  if (kind === 0) {
    for (let i = 0; i < 9; i++) {
      const x = -1.05 + i * 0.26;
      const L = 0.04 + ((i * 7) % 5) * 0.012;
      parts.push(mat(P.capsule(0.035, L, 2, 5), C.white, K.CREAM, { x, y: y0 - L * 0.5 + 0.02, z: 0.255, outline: 0 }));
    }
    parts.push(mat(roundBox(2.46, 0.06, 0.54, 0.4, 2), C.white, K.CREAM, { y: y0 + H + 0.02 }));
  } else if (kind === 1) {
    parts.push(mat(roundBox(2.44, 0.2, 0.54, 0.3, 2), C.choc, K.CHOC, { y: y0 + H - 0.04 }));
    parts.push(mat(roundBox(2.3, 0.04, 0.46, 0.5, 2), '#ff9ac8', K.GLAZE, { y: y0 + H + 0.07 }));
    for (let i = 0; i < 6; i++) {
      const x = -1.0 + i * 0.4;
      parts.push(mat(P.capsule(0.03, 0.06, 2, 5), C.choc, K.CHOC, { x, y: y0 + H - 0.16, z: 0.27, outline: 0 }));
    }
  } else {
    parts.push(sourBelt((t) => [-1.25 + t * 2.5, y0 + H + 0.03 + 0.05 * Math.sin(t * Math.PI * 3)], 0.16, { z: 0.08 }));
    parts.push(sourBelt((t) => [-1.25 + t * 2.5, y0 + H + 0.03 + 0.05 * Math.cos(t * Math.PI * 3)], 0.12, { z: -0.12 }));
  }
  return merge(parts).translate(0, 0, -0.26);
}

// LW · a giant chocolate bar fallen right across the road
function chocoBarWideGeo() {
  const parts = chocoBarParts(20, 2, 0.5, 0.52, { wrapper: '#8a3cff' });
  // the other end's paper, torn open
  parts.push(mat(roundBox(1.4, 0.58, 1.06, 0.12, 2), '#8a3cff', 0, { x: -4.65, y: 0.29, tint: 1 }));
  parts.push(mat(roundBox(0.5, 0.56, 1.08, 0.15, 2), C.foil, K.WRAP, { x: -3.75, y: 0.28 }));
  return merge(parts).translate(0, 0, -0.5);
}

// LW · a long heap of sweets right across the road
function sweetsWideGeo() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const g = sweetPileGeo(31 + i * 7).translate(-4.2 + i * 2.1, 0, 0.62);
    parts.push(g);
  }
  return merge(parts).translate(0, 0, -0.62);
}

// HW · a long wafer beam right across the road, hung on two giant candy
// canes standing past its edges, gumdrops along its top
function waferBridgeGeo() {
  const D = CONFIG.duckLine;
  const y0 = D + 0.12;
  const H = 0.5;
  const parts = [...moved(waferBar(12.6, 0.6, H, { cream: C.mint }), { y: y0 })];
  for (const s of [-1, 1]) {
    parts.push(...moved(caneParts(y0 + H + 0.6, 0.28, '#ff2d4a'), { x: s * 6.0, ry: s > 0 ? Math.PI : 0 }));
  }
  for (let i = 0; i < 14; i++) parts.push(gumdrop(0.15, 0.2, BRIGHT[i % BRIGHT.length], { x: -5.2 + i * 0.8, y: y0 + H }));
  for (let i = 0; i < 24; i++) {
    const x = -5.8 + i * 0.5;
    const L = 0.03 + ((i * 7) % 5) * 0.012;
    parts.push(mat(P.capsule(0.04, L, 2, 5), C.white, K.CREAM, { x, y: y0 - L * 0.5 + 0.02, z: 0.305, outline: 0 }));
  }
  return merge(parts).translate(0, 0, -0.3);
}

// --- the gem ---------------------------------------------------------------------------
// Watermelon tourmaline above all: pink at the heart and green at the rind,
// the candiest stone there is; then rubellite in deep pink points,
// rhodochrosite banded like a boiled sweet, and lilac kunzite. A slice of
// watermelon tourmaline for the prize spots.
const GEM = {
  name: 'watermelon tourmaline',
  color: '#ff3f9a',
  stones: [
    {
      name: 'watermelon tourmaline',
      weight: 3,
      tints: ['#ff3f9a', '#ff55a8', '#f03a8c'],
      parts: () => [crystal(hexPrism({ r: 0.11, top: 0.3, foot: 0.26, seed: 4 }), { rz: 0.2 })],
      texture: { bands: 0.6, rings: 'nested', bandFreq: 4, wander: 1, second: '#57d98a', mottle: 0.2, rough: 0.25 },
    },
    {
      name: 'rubellite',
      weight: 1.3,
      tints: ['#ff2f7a', '#e82a6c', '#ff4a8a'],
      parts: () => [crystal(crystalPoint({ r: 0.09, len: 0.34, tip: 0.13, seed: 7 }), { rz: -0.3 })],
      texture: { bands: 0.25, bandFreq: 8, second: '#ffc0dc', mottle: 0.35, rough: 0.3, speckle: 0.06 },
    },
    {
      name: 'rhodochrosite',
      weight: 1.2,
      tints: ['#ff6f9f', '#ff86b0', '#f0608f'],
      parts: () => [crystal(nugget({ r: [0.26, 0.16, 0.15], faces: 36, spread: 0.04, chips: 1, seed: 33 }), { rz: 0.4 })],
      texture: { opaque: 0.6, bands: 0.8, bandFreq: 22, wander: 10, second: '#fff0f4', mottle: 0.2, rough: 0.15, glints: 0.5 },
    },
    {
      name: 'kunzite',
      weight: 1,
      tints: ['#e09cff', '#eeb0ff', '#d68cf5'],
      parts: () => [crystal(barrel({ r: 0.13, h: 0.3, seed: 21 }), { rz: 0.5, rx: 0.2 })],
      texture: { bands: 0.3, bandFreq: 12, second: '#ffffff', mottle: 0.3, rough: 0.2, speckle: 0.05 },
    },
  ],
  crown: {
    name: 'watermelon tourmaline slice',
    tints: ['#ff3f9a', '#ff55a8'],
    parts: () => [crystal(tabular({ r: 0.3, t: 0.11, bevel: 0.9, seed: 5 }), { rx: Math.PI / 2 - 0.25 })],
    texture: { bands: 0.85, rings: 'nested', bandFreq: 3, wander: 0.6, second: '#3fd47a', mottle: 0.15, rough: 0.15 },
  },
  motion: [1.0, 1.8, 0.1, 0.18],
  look: [0.78, 1, 0.3, 0.45],
  glow: 0.45,
  pool: 0.5,
};

// --- the doorway ------------------------------------------------------------------------
// An arch of gingerbread, iced along both its edges in dots, gumdrops set
// round its face, a giant candy cane standing either side of it with a
// lollipop on top, and walls of layer cake running off either side, so
// nothing of the world beyond shows till you're through.
const OPENING = { halfW: 4.4, rectH: 6.6, arch: true };
const GATE_DEPTH = 2.4;
function gateGeo() {
  const W = OPENING.halfW, H = OPENING.rectH, T = 1.5;
  const parts = [...gateFrameParts(OPENING, { thick: T, depth: GATE_DEPTH, color: C.ginger, mark: K.GINGER })];
  const zf = GATE_DEPTH / 2 + 0.06;
  for (const z of [zf, -zf]) {
    for (const R of [W + 0.08, W + T - 0.08]) {
      for (let i = 0; i <= 22; i++) {
        const a = (i / 22) * Math.PI;
        parts.push(mat(P.sphere(0.15, 7, 5), C.white, K.CREAM, { x: Math.cos(a) * R, y: H + Math.sin(a) * R, z, outline: 0.4 }));
      }
      for (let i = 0; i < 14; i++) {
        const y = (i / 14) * H;
        for (const s of [-1, 1]) parts.push(mat(P.sphere(0.15, 7, 5), C.white, K.CREAM, { x: s * R, y, z, outline: 0.4 }));
      }
    }
    for (let i = 0; i < 9; i++) {
      const a = ((i + 0.5) / 9) * Math.PI;
      const R = W + T / 2;
      parts.push(gumdrop(0.32, 0.4, BRIGHT[i % BRIGHT.length], { x: Math.cos(a) * R, y: H + Math.sin(a) * R, z, rx: (z > 0 ? 1 : -1) * Math.PI / 2 }));
    }
  }
  for (const s of [-1, 1]) {
    parts.push(...moved(caneParts(9.5, 0.42, '#ff2d4a'), { x: s * (W + T + 0.9), z: GATE_DEPTH / 2 + 0.5, ry: s > 0 ? Math.PI : 0 }));
    // walls of layer cake either side
    const w = 64;
    const x = s * (W + T + 0.4 + w / 2);
    const layers = [[0, 2.6, C.butter, K.SPONGE], [2.6, 0.45, '#ff8fb8', K.CREAM], [3.05, 2.6, C.butter, K.SPONGE], [5.65, 0.45, C.cream, K.CREAM], [6.1, 2.4, '#c9875a', K.SPONGE], [8.5, 0.6, C.white, K.CREAM]];
    for (const [y, h, c, k] of layers) parts.push(mat(P.box(w, h, 3), c, k, { x, y: y + h / 2, z: -1.2 }));
    for (let i = 0; i < 40; i++) {
      const L = 0.4 + ((i * 7) % 5) * 0.22;
      parts.push(mat(P.capsule(0.18, L, 2, 6), C.white, K.CREAM, { x: s * (W + T + 1.0 + i * 1.6), y: 8.5 - L * 0.4, z: 0.32, outline: 0.4 }));
      if (i % 3 === 0) parts.push(...moved(swirlParts(0.42, 0.5, i % 2 ? C.pink : C.white, { tint: 0, turns: 1.8, seg: 18 }), { x: s * (W + T + 1.6 + i * 1.6), y: 9.05, z: -0.2 }));
    }
    for (let i = 0; i < 6; i++) {
      const cx = s * (W + T + 4 + i * 6.5);
      if (i % 2) parts.push(...moved(lollipopTreeParts(3.5, 1.4, {}), { x: cx, y: 9.1, z: -1.5 }));
      else parts.push(...moved(cottonTreeParts(40 + i), { x: cx, y: 9.1, z: -1.6 }));
    }
  }
  // a lollipop crowning the arch
  parts.push(...moved(lollipopParts(1.3, 0.3, C.white, 1.2, {}), { y: H + W + T + 2.2, z: 0.2 }));
  return merge(parts);
}

// The door into Candy World: each leaf a slab of chocolate bar in its
// squares, piped round with icing, a lollipop medallion up in the arch.
function candyLeaf({ W, H, z, f, top }) {
  const out = [];
  const zz = z + f * 0.06;
  const cols = 3, rows = 6;
  const m = 0.28;
  const cw = (W - m * 2) / cols, rh = (H - m * 2) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = m + (i + 0.5) * cw;
      const y = m + (j + 0.5) * rh;
      out.push(mat(roundBox(cw * 0.88, rh * 0.88, 0.14, 0.3, 2), C.choc, K.CHOC, { x, y, z: zz }));
    }
  }
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    out.push(mat(P.sphere(0.09, 6, 4), C.white, K.CREAM, { x: 0.14 + t * (W - 0.28), y: 0.14, z: zz + f * 0.05, outline: 0 }));
    out.push(mat(P.sphere(0.09, 6, 4), C.white, K.CREAM, { x: 0.14, y: 0.14 + t * (H - 0.28), z: zz + f * 0.05, outline: 0 }));
  }
  const mx = W * 0.55, my = Math.min(top(mx) - 1.2, H + 1.3);
  out.push(...moved(lollipopParts(0.75, 0.16, C.white, 0.01, {}).slice(0, 4), { x: mx, y: my, z: zz + f * 0.1, ry: f > 0 ? 0 : Math.PI }));
  return out;
}

// --- light -------------------------------------------------------------------------------
// The sun high and ahead to the left: soft, sugar-bright light, its shade
// lavender rather than grey, so even the shadows look sweet.
const SUN = [-0.45, 0.85, -0.3];
const CLOUDS = 4;

export default {
  id: 'candy',
  name: 'Candy World',
  doorColor: '#ff7eb6',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  // (a world with a river: see world/river.js and ObstacleField.placeCrossing)
  river: { name: 'chocolate river' },
  env: {
    sky: ['#6cc0ff', '#ffcfe5', '#ffd8ea'],
    bloom: ['#ff8cc0', '#9ff0cf', '#ffe48a'],
    sun: { dir: [-0.5, 0.78, -1], glow: '#ffe4ee' },
    stars: 0,
    skyFx: { rays: 0.12, clouds: 0.08 },
    light: { dir: SUN, shadow: [0.8, 0.7, 0.88], hi: [1.06, 1.03, 0.98], soft: 0.3, wrap: 0.42, hiAmt: 0.42, lift: 1 },
    rim: [1.0, 0.86, 0.95, 0.3],
    mist: { color: '#ffd8ea', amount: 0.18, top: 3, fade: 5, near: 40, far: 170 },
    dapple: [0, 0.05, 0],
    grade: { sat: 1.06, contrast: 1.04, vignette: 0.26, exposure: 1.0, tint: '#6a2448' },
    beam: { color: '#fff0f6', amount: 0.1 },
    pool: '#ffd6a8',
    ink: '#5c2a2e',
    fog: [80, 260],
    ground: ['#efc27e', '#d0904c', '#7a4426'],
    shadowDecal: [0.84, 0.64, 0.76],
    cast: [0.53, 0.35],
    glowGain: 0.8,
    particles: { color: '#ffffff', size: 2.0, drift: [0.03, -0.12, 0], opacity: 0.75 },
  },

  visits: [
    {
      // a sunset of spun sugar: peach and rose, the light gone to honey
      env: {
        sky: ['#ff9f86', '#ffd0d8', '#ffe0c4'],
        bloom: ['#ffa07a', '#ffd38a', '#ff8cc0'],
        sun: { dir: [-0.6, 0.16, -1], glow: '#ffb27a' },
        skyFx: { rays: 0.5, clouds: 0.2 },
        light: { dir: [-0.6, 0.55, -0.35], shadow: [0.78, 0.6, 0.82], hi: [1.14, 1.0, 0.86] },
        rim: [1.0, 0.75, 0.6, 0.34],
        mist: { color: '#ffd0bc', amount: 0.36 },
        grade: { tint: '#5a1a30', exposure: 1.0 },
        cast: [0.9, 0.5],
        particles: { color: '#ffe6c8', size: 2.4, drift: [0.06, -0.1, 0], opacity: 0.85 },
      },
    },
    {
      // the sugar-lantern night: lavender dark, every window lit, the
      // gummies and the rock candy glowing, sugar sparks drifting
      env: {
        sky: ['#1c1446', '#7a52b8', '#2c1e5a'],
        bloom: ['#b88aff', '#ff9ad8', '#8affe0'],
        sun: { dir: [0.4, 0.45, -1], glow: '#c8b0ff' },
        moon: { dir: [0.4, 0.45, -1], color: '#fff2fa', size: 0.05 },
        stars: 0.8,
        skyFx: { rays: 0.1, clouds: 0 },
        light: { dir: [0.4, 0.8, -0.35], shadow: [0.3, 0.26, 0.5], hi: [0.7, 0.68, 0.92], soft: 0.32, lift: 0.7 },
        rim: [0.75, 0.6, 1.0, 0.4],
        mist: { color: '#3a2468', amount: 0.5, top: 4 },
        grade: { tint: '#0c0420', vignette: 0.5, exposure: 0.9, sat: 1.1 },
        ground: ['#b08a68', '#8a6448', '#3a2230'],
        pool: '#6a3a9a',
        glowGain: 1.6,
        cast: [-0.45, 0.4],
        particles: { color: '#ffd8f8', size: 3.0, drift: [0.05, 0.12, 0], opacity: 1 },
      },
    },
    {
      // the dream: a rainbow sky, the sweets floating off into it
      env: {
        sky: ['#58c8ff', '#ffb2e6', '#ffe6b8'],
        bloom: ['#ff6ad5', '#7affd6', '#ffe14d'],
        sun: { dir: [0.0, 0.7, -1], glow: '#ffd6f4' },
        skyFx: { rays: 0.12, aurora: 0.35, clouds: 0.1 },
        light: { dir: [0.2, 0.85, -0.3], shadow: [0.74, 0.66, 0.92], hi: [1.06, 1.06, 1.12] },
        rim: [0.9, 0.8, 1.0, 0.36],
        mist: { color: '#ffd0f8', amount: 0.32 },
        grade: { sat: 1.12, tint: '#3a1a5a', vignette: 0.3, exposure: 0.96 },
        glowGain: 1.2,
        cast: [-0.24, 0.35],
        particles: { color: '#ffffff', size: 2.8, drift: [0.1, 0.25, 0], opacity: 1 },
        trip: [0.06, 0.25, 0.16],
      },
    },
  ],

  *build(b) {
    const sweet = { candy: true };
    b.ground('ground', groundStrip(8.8, 16, '#ffffff', 8), 17);
    yield;
    b.toon('floor', groundStrip(440, 16, '#ffc2dc', 8, { y: -0.03, mark: K.FIELD }), { ...sweet, ink: 0, cap: 40 });
    yield;
    b.toon('piping', merge(pipingParts(4)), { ...sweet, cap: 200, anim: 'popLate', ink: 0.03 });
    yield;
    // the chocolate river (see world/river.js): its surface, its banks
    // (two mixes of sweets along them), and its clean biscuit edges where
    // it crosses the road
    b.toon('river', riverWaterGeo(), { bend: true, choco: true, ink: 0, cap: 460, clear: 0.6 });
    yield;
    b.toon('riverBank', riverBankGeo(0, 5, 2.4), { bend: true, ...sweet, ink: 0, cap: 260 });
    yield;
    b.toon('riverBankB', riverBankGeo(1, 9, 2.4), { bend: true, ...sweet, ink: 0, cap: 260 });
    yield;
    b.toon('riverEdge', riverBankGeo(2, 13, 2.4), { bend: true, ...sweet, ink: 0, cap: 60, clear: 1 });
    yield;
    b.shadow('shadow', { cap: 400, anim: 'pop' });
    yield;

    // the verges: little heaps of sweets, each its own mix
    for (const [name, kind, seed] of [
      ['assortGumdrops', 'gumdrops', 3], ['assortMints', 'mints', 5], ['assortPatisserie', 'patisserie', 7],
      ['assortChocolates', 'chocolates', 11], ['assortCaramels', 'caramels', 13], ['assortFruity', 'fruity', 17],
      ['assortBakery', 'bakery', 19], ['assortParlour', 'parlour', 23], ['assortButtons', 'buttons', 29],
    ]) {
      b.toon(name, merge(coarse(0.55, () => assortParts(kind, seed))), { ...sweet, cap: 150, anim: 'pop', ink: 0.025 });
      yield;
    }
    b.toon('candyGrass', merge(lod(0.6, () => candyGrassParts(7))), { ...sweet, cap: 900, anim: 'popLate', ink: 0, wobble: [0.08, 0, 1.6, 0] });
    yield;
    b.toon('rosettes', merge(coarse(0.5, () => rosetteParts(9))), { ...sweet, cap: 200, anim: 'popLate', ink: 0.02 });
    yield;
    b.toon('gummyPlant', merge(coarse(0.6, () => gummyPlantParts(3))), { ...sweet, cap: 220, anim: 'pop', ink: 0.025, wobble: [0.03, 0, 1.2, 0] });
    yield;
    b.toon('lollipop', merge(coarse(0.6, () => moved(lollipopParts(0.34, 0.08, C.white, 0.9, { tint: 1 }), { y: 1.2 }))), { ...sweet, cap: 160, anim: 'pop', wobble: [0.012, 0, 1.4, 0] });
    yield;
    b.toon('cane', merge(coarse(0.6, () => caneParts(1.3, 0.06, C.white))), { ...sweet, cap: 160, anim: 'pop' });
    yield;
    b.toon('rockCandy', merge(coarse(0.6, () => [...rockCandy(0.9, C.white, 3), ...moved(rockCandy(0.7, C.white, 8), { x: 0.2, z: 0.12, rz: -0.2 }), ...moved(rockCandy(0.8, C.white, 13), { x: -0.18, z: -0.1, rz: 0.25 })])), { ...sweet, cap: 120, anim: 'pop' });
    yield;
    b.toon('cupcake', merge(coarse(0.55, () => cupcakeParts(1.0, { caseColor: '#ffb3d1', frost: C.white }))), { ...sweet, cap: 120, anim: 'pop' });
    yield;
    b.toon('cupcakeB', merge(coarse(0.55, () => cupcakeParts(1.0, { caseColor: '#9fdcff', frost: C.white, glazed: true }))), { ...sweet, cap: 120, anim: 'pop' });
    yield;
    b.toon('donut', merge(coarse(0.55, () => [...donutParts(0.32, 0.15, { glaze: C.white }), ...moved(donutParts(0.3, 0.14, { glaze: C.white, sprinkled: false, seed: 9 }), { y: 0.3, x: 0.06, rz: 0.08 })])), { ...sweet, cap: 120, anim: 'pop' });
    yield;
    b.toon('softServe', merge(coarse(0.55, () => [...coneParts(0.2, 0.62), ...moved(swirlParts(0.26, 0.5, C.white, { turns: 2.6, seg: 36 }), { y: 0.58 })])), { ...sweet, cap: 100, anim: 'pop' });
    yield;
    b.toon('ribbon', merge([ribbonCandy(0.9, 0.32, 0.12, C.white), ...moved([ribbonCandy(0.7, 0.24, 0.1, C.white)], { z: 0.3, x: 0.1, ry: 0.4 })]), { ...sweet, cap: 100, anim: 'pop', side: THREE.DoubleSide, ink: 0 });
    yield;

    // trees, and things the size of a house
    b.toon('lollipopTree', merge(coarse(0.75, () => lollipopTreeParts(5.4, 1.75, {}))), { ...sweet, cap: 90, anim: 'popEarly', wobble: [0.003, 0, 0.8, 0] });
    yield;
    b.toon('lollipopBall', merge(coarse(0.75, () => lollipopTreeParts(4.6, 1.3, { ball: true, bow: C.mint }))), { ...sweet, cap: 70, anim: 'popEarly', wobble: [0.003, 0, 0.8, 0] });
    yield;
    b.toon('caneTall', merge(coarse(0.75, () => caneParts(6.5, 0.3, C.white))), { ...sweet, cap: 70, anim: 'popEarly' });
    yield;
    b.toon('cottonTree', merge(coarse(0.7, () => cottonTreeParts(11))), { ...sweet, cap: 80, anim: 'popEarly', wobble: [0.004, 0, 0.7, 0] });
    yield;
    b.toon('cottonTreeB', merge(coarse(0.7, () => cottonTreeParts(23, { trunk: '#2a1a20' }))), { ...sweet, cap: 80, anim: 'popEarly', wobble: [0.004, 0, 0.7, 0] });
    yield;
    b.toon('gummyBear', merge(coarse(0.7, () => gummyBearParts())), { ...sweet, cap: 80, anim: 'pop' });
    yield;
    b.toon('cookieGiant', merge(coarse(0.7, () => moved(cookieParts(1.6, 0.4, { seed: 31, chips: 26 }), { rx: Math.PI / 2 - 0.35, y: 1.45 }))), { ...sweet, cap: 50, anim: 'popEarly' });
    yield;
    b.toon('donutArch', merge(coarse(0.7, () => moved(donutParts(1.6, 0.75, { glaze: C.white, seed: 3 }), { rx: Math.PI / 2, y: 1.9 }))), { ...sweet, cap: 50, anim: 'popEarly' });
    yield;
    b.toon('macaronGiant', merge(coarse(0.7, () => macaronParts(1.3, { color: C.white, fill: C.cream }))), { ...sweet, cap: 50, anim: 'popEarly' });
    yield;
    b.toon('truffleRocks', merge(coarse(0.6, () => [...truffle(1.0, 0), ...moved(truffle(0.75, 2), { x: 1.5, z: 0.4 }), ...moved(truffle(0.6, 1), { x: -1.2, z: 0.7 })])), { ...sweet, cap: 50, anim: 'popEarly' });
    yield;
    {
      // a quarry of chocolate: slabs stacked and tumbled, a broken bar
      const rnd = seeded(41);
      const parts = [];
      for (let i = 0; i < 5; i++) parts.push(mat(roundBox(1.6 + rnd(), 0.5, 1.2 + rnd() * 0.6, 0.12, 2), i % 2 ? C.milk : C.choc, K.CHOC, { x: (rnd() - 0.5) * 1.2, y: 0.25 + i * 0.42, z: (rnd() - 0.5) * 0.6, ry: rnd() * 0.8, rz: (rnd() - 0.5) * 0.15 }));
      parts.push(...moved(chocoBarParts(4, 2, 0.5, 0.5, { wrapper: '#3f8cff' }), { x: 1.9, y: 0.6, z: 0.8, rz: 0.5, ry: -0.4 }));
      parts.push(mat(roundBox(1.0, 0.8, 0.9, 0.2, 2), C.chocDark, K.CHOC, { x: -1.6, y: 0.4, z: 0.6, ry: 0.6 }));
      b.toon('chocoBlocks', merge(parts), { ...sweet, cap: 50, anim: 'popEarly' });
    }
    yield;
    {
      const rnd = seeded(43);
      const parts = [mat(P.sphere(0.9, 10, 6), C.white, K.SUGAR, { y: -0.2, sy: 0.6 })];
      for (let i = 0; i < 12; i++) {
        const a = rnd() * Math.PI * 2;
        const L = 0.9 + rnd() * 1.4;
        const g = new THREE.CylinderGeometry(0, 0.24 + rnd() * 0.12, L, 6);
        g.translate(0, L / 2, 0);
        parts.push(mat(g, C.white, K.ROCK, { x: Math.cos(a) * 0.3, y: 0.1, z: Math.sin(a) * 0.3, rz: Math.cos(a) * (0.2 + rnd() * 0.5), rx: -Math.sin(a) * (0.2 + rnd() * 0.5), tint: 1 }));
      }
      b.toon('rockCandyGiant', merge(parts), { ...sweet, cap: 50, anim: 'popEarly' });
    }
    yield;
    b.toon('cakeSlice', merge(coarse(0.7, () => cakeSliceParts(1))), { ...sweet, cap: 50, anim: 'popEarly' });
    yield;
    b.toon('coneGiant', coarse(0.6, () => coneWallGeo()).scale(1.5, 1.5, 1.5), { ...sweet, cap: 50, anim: 'popEarly' });
    yield;
    for (const [name, kind, seed] of [['gingerHouseA', 0, 3], ['gingerHouseB', 1, 7], ['gingerCottage', 2, 11]]) {
      b.toon(name, merge(coarse(0.7, () => gingerHouseParts(kind, seed))), { ...sweet, cap: 40, anim: 'lift' });
      yield;
    }

    // the far country: frosting hills, cake mesas, towers, clouds
    b.toon('frostPatch', frostPatchGeo(3), { ...sweet, cap: 120, ink: 0 });
    yield;
    b.toon('hillA', merge(coarse(0.8, () => frostHillParts(0, 3))), { ...sweet, cap: 70, anim: 'liftFar', ink: 0.04 });
    yield;
    b.toon('hillB', merge(coarse(0.6, () => frostHillParts(1, 5))), { ...sweet, cap: 50, anim: 'liftFar', ink: 0.04 });
    yield;
    b.toon('hillC', merge(coarse(0.8, () => frostHillParts(2, 7))), { ...sweet, cap: 50, anim: 'liftFar', ink: 0.04 });
    yield;
    b.toon('cakeMesa', merge(coarse(0.45, () => cakeMesaParts(5))), { ...sweet, cap: 30, anim: 'liftFar', ink: 0.04 });
    yield;
    b.toon('cakeMesaB', merge(coarse(0.45, () => cakeMesaParts(10))), { ...sweet, cap: 30, anim: 'liftFar', ink: 0.04 });
    yield;
    b.toon('iceTower', merge(coarse(0.65, () => iceTowerParts(3))), { ...sweet, cap: 30, anim: 'lift' });
    yield;
    b.toon('softServeTower', merge(coarse(0.6, () => softServeTowerParts(4))), { ...sweet, cap: 30, anim: 'lift' });
    yield;
    for (let i = 0; i < CLOUDS; i++) {
      b.toon(`cloud${i}`, merge(cloudParts(7 + i * 11)), { ...sweet, cap: 24, ink: 0.05, fly: [0, 0, 3.5 + i, 0.035 + i * 0.01] });
      yield;
    }
    // night: sugar sparks drifting over the verges; the dream: sweets
    // floating up into the sky
    b.glow('spark', { cap: 700, anim: 'pop', firefly: [0.8, 0.3, 0.25, 0.1] });
    yield;
    b.toon('floatDonut', merge(moved(donutParts(0.9, 0.42, { glaze: C.white }), { rx: 1.0 })), { ...sweet, cap: 40, anim: 'lift', fly: [0, 0, 1.8, 0.2], wobble: [0, 0.6, 0.7, 0] });
    yield;
    b.toon('floatBear', merge(gummyBearParts()), { ...sweet, cap: 40, anim: 'lift', fly: [0, 0, 1.6, 0.24], wobble: [0, 0.5, 0.8, 0] });
    yield;

    // obstacles
    b.toon('chocoBarA', chocoBarLowGeo(false), { ...sweet, cap: 12, anim: 'popEarly' });
    yield;
    b.toon('chocoBarB', chocoBarLowGeo(true), { ...sweet, cap: 12, anim: 'popEarly' });
    yield;
    b.toon('sweetPile', sweetPileGeo(5), { ...sweet, cap: 12, anim: 'popEarly' });
    yield;
    b.toon('cookieStack', cookieStackGeo(), { ...sweet, cap: 12, anim: 'popEarly' });
    yield;
    b.toon('caramelHeap', caramelHeapGeo(), { ...sweet, cap: 12, anim: 'popEarly' });
    yield;
    b.toon('cookieWall', cookieWallGeo(9), { ...sweet, cap: 16, anim: 'popEarly' });
    yield;
    b.toon('sandwichWall', sandwichWallGeo(), { ...sweet, cap: 16, anim: 'popEarly' });
    yield;
    b.toon('gummyBearWall', gummyBearWallGeo(), { ...sweet, cap: 16, anim: 'popEarly' });
    yield;
    b.toon('coneWall', coneWallGeo(), { ...sweet, cap: 16, anim: 'popEarly' });
    yield;
    b.toon('lollipopWall', lollipopWallGeo(), { ...sweet, cap: 16, anim: 'popEarly' });
    yield;
    for (let k = 0; k < 3; k++) {
      b.toon(`waferBeam${'ABC'[k]}`, waferBeamGeo(k), { ...sweet, cap: 12, anim: 'popEarly', side: k === 2 ? THREE.DoubleSide : THREE.FrontSide });
      yield;
    }
    b.toon('chocoBarWide', chocoBarWideGeo(), { ...sweet, cap: 6, anim: 'popEarly' });
    yield;
    b.toon('sweetsWide', sweetsWideGeo(), { ...sweet, cap: 6, anim: 'popEarly' });
    yield;
    b.toon('waferBridge', waferBridgeGeo(), { ...sweet, cap: 6, anim: 'popEarly' });
    yield;
  },

  // The door INTO this world, in its own style (built into the shared
  // doors, see world.js: it stands in the world before it).
  door(b) {
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, candy: true, ink: 0.05 });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', deco: candyLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05, candy: true });
  },

  obstacles: {
    L: [
      { name: 'chocoBarA', len: 0.9, top: 0.6, tints: ['#ff3550', '#3f8cff', '#ffb02e', '#8a3cff', '#2fb86a'] },
      { name: 'chocoBarB', len: 0.9, top: 0.6, tints: ['#ff6fb0', '#ffd23a', '#4fc8ff'] },
      { name: 'sweetPile', len: 1.24, top: 0.62 },
      { name: 'cookieStack', len: 1.7, top: 0.68, flip: true },
      { name: 'caramelHeap', len: 0.9, top: 0.72 },
    ],
    H: [
      { name: 'waferBeamA', len: 0.56, tints: STRIPES },
      { name: 'waferBeamB', len: 0.56, tints: STRIPES },
      { name: 'waferBeamC', len: 0.56, tints: STRIPES },
    ],
    W: [
      { name: 'cookieWall', len: 1.0 },
      { name: 'sandwichWall', len: 1.32 },
      { name: 'gummyBearWall', len: 1.24, tints: GUMMY_TINTS },
      { name: 'coneWall', len: 1.7, tints: ['#ffb3d1', '#a8f0d0', '#fff0c8', '#a8693a', '#cdb6ff'] },
      { name: 'lollipopWall', len: 0.84, tints: ['#ffffff', '#ffffff', '#ff4d8d', '#4fb6ff', '#a66cff', '#ffa62e'] },
    ],
    LW: [
      { name: 'chocoBarWide', len: 1.0, top: 0.62, tints: ['#8a3cff', '#ff3550', '#2fb86a'] },
      { name: 'sweetsWide', len: 1.24, top: 0.62 },
    ],
    HW: { name: 'waferBridge', len: 0.6 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    const v = ctx.visit;
    const L = ctx.L;
    ctx.put('ground', 0, 0, 0, { p0: ctx.d0 % 4096 });
    ctx.put('floor', 0, 0, 0);
    const R = ctx.river();
    const free = (x, dz, r) => clearOfRiver(R, x, ctx.d0 + dz, r);
    // the big things are kept apart, chunk to chunk
    const seg = ctx.seg;
    const occ = seg.candyOcc || (seg.candyOcc = new Map());
    const ci = Math.round(ctx.d0 / L);
    if (!occ.has(ci)) occ.set(ci, []);
    const mine = occ.get(ci);
    const roomFor = (x, dz, r) => {
      const d = ctx.d0 + dz;
      for (let k = ci - 1; k <= ci + 1; k++) {
        for (const [ox, od, or] of occ.get(k) || []) if ((ox - x) ** 2 + (od - d) ** 2 < (or + r) ** 2) return false;
      }
      return true;
    };
    const claim = (x, dz, r) => mine.push([x, ctx.d0 + dz, r]);

    // the river, piece by piece (see world/river.js)
    for (const Pc of R.byChunk.get(ci) || []) {
      const o = { ry: Pc.th, c: [Pc.w0, Pc.w1, R.flow], p0: Pc.u, p1: Pc.k };
      const dz = Pc.d - ctx.d0;
      ctx.put('river', Pc.x, 0, dz, o).p2 = Pc.len;
      const ex = Pc.x + Math.cos(Pc.th + Pc.k * Pc.len * 0.5) * Pc.len;
      const road = Math.min(Math.abs(Pc.x), Math.abs(ex)) < 6.4;
      ctx.put(road ? 'riverEdge' : Pc.i % 3 === 1 ? 'riverBankB' : 'riverBank', Pc.x, 0, dz, o).p2 = Pc.len;
    }

    // the far country: rolling frosting hills, cake mesas, towers
    for (const s of [-1, 1]) {
      // (and a far ring of them closing the horizon)
      if (rng.chance(0.7)) {
        const x = s * rng.float(85, 160);
        ctx.put(rng.chance(0.6) ? 'hillA' : 'hillC', x, 0, rng.float(0, L), { s: rng.float(3, 5), sy: rng.float(1.0, 1.8), ry: rng.float(0, 6.28), c: rng.pick(PASTEL_TINTS) });
      }
      if (rng.chance(0.85)) {
        const x = s * rng.float(36, 95);
        const dz = rng.float(0, L);
        if (free(x, dz, 8)) {
          const k = rng.weighted([['hillA', 2], ['hillB', 1], ['hillC', 1.2]]);
          ctx.put(k, x, 0, dz, { s: rng.float(1.6, 3.2), sy: rng.float(1.2, 2.2), ry: rng.float(0, 6.28), c: rng.pick(PASTEL_TINTS) });
        }
      }
      if (rng.chance(0.42)) {
        const x = s * rng.float(28, 62);
        const dz = rng.float(0, L);
        const name = rng.weighted([['iceTower', 1.4], ['softServeTower', 0.9], ['cakeMesa', 1], ['cakeMesaB', 1], ['gingerHouseA', 0.6], ['gingerHouseB', 0.5]]);
        const r = name.startsWith('cake') ? 11 : name.startsWith('ginger') ? 5 : 4;
        if (free(x, dz, r) && roomFor(x, dz, r)) {
          claim(x, dz, r);
          const big = name.startsWith('cake') ? rng.float(0.8, 1.2) : rng.float(0.9, 1.25);
          ctx.put(name, x, 0, dz, { s: big, ry: name.startsWith('ginger') ? -s * 1.1 + rng.float(-0.3, 0.3) : rng.float(0, 6.28), c: name.startsWith('ginger') ? [rng.float(0.92, 1.08), rng.float(0.92, 1.04), 1] : rng.pick(PASTEL_TINTS) });
        }
      }
    }
    // spills of frosting in other colours over the land
    for (let i = 0; i < 2; i++) {
      const x = rng.float(-60, 60);
      const dz = rng.float(0, L);
      const sc = rng.float(2.5, 7);
      if (Math.abs(x) > 4.8 + sc * 1.3 && free(x, dz, sc * 1.2)) ctx.put('frostPatch', x, 0.0, dz, { sx: sc, sz: sc * rng.float(0.6, 1), sy: 1, ry: rng.float(0, 6.28), c: rng.pick(PATCH) });
    }
    // marshmallow clouds drifting overhead
    if (rng.chance(0.55)) {
      const x = rng.float(-75, 75);
      ctx.put(`cloud${rng.int(0, CLOUDS - 1)}`, x, rng.float(24, 42), rng.float(0, L), { s: rng.float(1.0, 1.8), ry: rng.float(0, 6.28) });
    }
    if (ctx.continuation) return;

    // frosting piped along the edges of the road (broken where the river crosses)
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const dz = k * 4 + 4;
        if (free(s * 4.62, dz - 2, 1.2)) ctx.put('piping', s * 4.62, 0, dz, { c: k % 2 ? PIPING[0] : PIPING[(Math.floor(ctx.d0 / 64) + (s > 0 ? 1 : 0)) % PIPING.length] });
      }
    }

    // What grows along each side changes as you go: a gingerbread village,
    // a lollipop orchard, a patisserie, a chocolate quarry, a gummy meadow,
    // an ice-cream parlour, every few chunks a new one (by a hash of where
    // it is, so both sides change in their own time)
    for (const s of [-1, 1]) {
      const zone = Math.floor((ctx.d0 - seg.start) / (L * 3) + (s > 0 ? 0.5 : 0));
      let h = Math.sin(zone * 12.9898 + seg.start * 0.0131 + s * 4.1 + v * 1.7) * 43758.5453;
      h -= Math.floor(h);
      const theme = THEMES[Math.floor(h * THEMES.length)];
      const T = THEME[theme];
      // sour-straw grass and gummy plants all along the verge
      for (let i = 0; i < 7; i++) {
        const x = s * rng.float(5.0, 11);
        const dz = rng.float(0, L);
        if (free(x, dz, 0.4)) ctx.put('candyGrass', x, 0, dz, { s: rng.float(0.8, 1.4), ry: rng.float(0, 6.28) });
      }
      // the verge's sweets
      const n = rng.int(6, 8);
      for (let i = 0; i < n; i++) {
        const name = rng.weighted(T.near);
        const x = s * rng.float(5.3, 10.5);
        const dz = rng.float(0, L);
        if (!free(x, dz, 0.8)) continue;
        const tint = TINT[name];
        ctx.put(name, x, 0, dz, { s: rng.float(0.85, 1.35) * (SIZE[name] || 1), ry: rng.float(0, 6.28), c: tint ? rng.pick(tint) : undefined });
      }
      // things the size of a tree, or a house
      const m = rng.int(3, 4);
      for (let i = 0; i < m; i++) {
        const name = rng.weighted(T.mid);
        const r = RADIUS[name] || 2;
        const x = s * (rng.float(9.5, 24) + r * 0.5);
        const dz = rng.float(0, L);
        if (!free(x, dz, r) || !roomFor(x, dz, r)) continue;
        claim(x, dz, r);
        const tint = TINT[name];
        const faces = name.startsWith('ginger') || name === 'cakeSlice' || name === 'coneGiant';
        const sc = rng.float(0.85, 1.2) * (SIZE[name] || 1);
        ctx.put(name, x, 0, dz, {
          s: sc,
          ry: faces ? -s * 1.1 + rng.float(-0.35, 0.35) : rng.float(0, 6.28),
          c: name.startsWith('ginger') ? [rng.float(0.9, 1.08), rng.float(0.9, 1.04), rng.float(0.92, 1.0)] : tint ? rng.pick(tint) : undefined,
        });
        ctx.put('shadow', x, 0.03, dz, { sx: r * 2.4 * sc, sz: r * 2.4 * sc });
      }
      // and further back, more of the same, bigger
      for (let i = 0; i < 2; i++) {
        const name = rng.weighted(T.mid);
        const r = (RADIUS[name] || 2) * 1.5;
        const x = s * rng.float(24, 44);
        const dz = rng.float(0, L);
        if (!free(x, dz, r) || !roomFor(x, dz, r)) continue;
        claim(x, dz, r);
        const tint = TINT[name];
        const faces = name.startsWith('ginger') || name === 'cakeSlice' || name === 'coneGiant';
        ctx.put(name, x, 0, dz, {
          s: rng.float(1.2, 1.7) * (SIZE[name] || 1),
          ry: faces ? -s * 1.2 + rng.float(-0.4, 0.4) : rng.float(0, 6.28),
          c: name.startsWith('ginger') ? [rng.float(0.9, 1.08), rng.float(0.9, 1.04), rng.float(0.92, 1.0)] : tint ? rng.pick(tint) : undefined,
        });
      }
      // night: sugar sparks drifting over the verge
      if (v === 2) {
        for (let i = 0; i < 9; i++) {
          const x = s * rng.float(4.6, 16);
          const y = rng.float(0.4, 4.5);
          const dz = rng.float(0, L);
          const p0 = rng.float(0, 6.28);
          const c = rng.pick([[1.6, 1.2, 1.5], [1.2, 1.5, 1.6], [1.6, 1.5, 1.0]]);
          ctx.put('spark', x, y, dz, { s: 0.3, c, p0 });
          ctx.put('spark', x, y, dz, { s: 1.4, c: [c[0] * 0.45, c[1] * 0.4, c[2] * 0.45], p0 });
        }
      }
      // the dream: donuts and gummy bears floating off into the sky
      if (v >= 3 && rng.chance(0.6)) {
        ctx.put(rng.chance(0.5) ? 'floatDonut' : 'floatBear', s * rng.float(6, 22), rng.float(4, 12), rng.float(0, L), { s: rng.float(0.8, 1.6), ry: rng.float(0, 6.28), c: rng.pick(GUMMY_TINTS) });
      }
    }
  },
};

// The mixes along the verges, theme by theme (near: the verge's sweets; mid:
// what stands behind them), how big each is put out, how far it reaches
// (for keeping clear of the river and of each other) and what it's tinted.
const PATCH = ['#bff2dc', '#d9c8ff', '#fff0b0', '#c8e8ff', '#ffd8c0', '#ffffff'];
const PIPING = ['#ffffff', '#ffc4dc', '#bff2dc', '#d9c8ff', '#fff0b0'];
const THEMES = ['village', 'orchard', 'patisserie', 'chocolate', 'gummy', 'parlour'];
const THEME = {
  village: {
    near: [['assortGumdrops', 2], ['rosettes', 2], ['cane', 1.2], ['lollipop', 1], ['assortButtons', 1], ['assortMints', 1]],
    mid: [['gingerHouseA', 1.6], ['gingerHouseB', 1.4], ['gingerCottage', 1.6], ['lollipopTree', 0.8], ['caneTall', 0.8]],
  },
  orchard: {
    near: [['assortGumdrops', 2], ['assortMints', 1.5], ['lollipop', 1.5], ['gummyPlant', 1.6], ['rockCandy', 0.6], ['rosettes', 0.8]],
    mid: [['lollipopTree', 2], ['lollipopBall', 1.5], ['cottonTree', 1.6], ['cottonTreeB', 1], ['caneTall', 1.2]],
  },
  patisserie: {
    near: [['assortPatisserie', 2], ['cupcake', 1.6], ['cupcakeB', 1.2], ['donut', 1.5], ['assortBakery', 1.2], ['rosettes', 0.8]],
    mid: [['donutArch', 1.5], ['macaronGiant', 1.5], ['cakeSlice', 1.5], ['cottonTree', 0.7], ['lollipopTree', 0.5]],
  },
  chocolate: {
    near: [['assortChocolates', 2.2], ['assortCaramels', 1.6], ['assortBakery', 1.2], ['donut', 0.6], ['assortMints', 0.5]],
    mid: [['chocoBlocks', 2], ['truffleRocks', 2], ['cookieGiant', 1.5], ['caneTall', 0.6], ['cottonTreeB', 0.5]],
  },
  gummy: {
    near: [['assortFruity', 2], ['gummyPlant', 2], ['rockCandy', 1.2], ['ribbon', 1], ['assortGumdrops', 1]],
    mid: [['gummyBear', 2.5], ['rockCandyGiant', 1.5], ['lollipopBall', 1], ['cottonTree', 0.8]],
  },
  parlour: {
    near: [['assortParlour', 2.2], ['softServe', 1.5], ['cupcake', 0.8], ['assortBakery', 1], ['cane', 0.6]],
    mid: [['coneGiant', 2], ['lollipopTree', 0.8], ['cottonTree', 1], ['macaronGiant', 0.6]],
  },
};
const SIZE = {
  gummyBear: 1.25, rockCandyGiant: 1.2,
  assortGumdrops: 1.7, assortMints: 1.6, assortPatisserie: 1.6, assortChocolates: 1.7, assortCaramels: 1.6, assortFruity: 1.7,
  assortBakery: 1.6, assortParlour: 1.7, assortButtons: 1.5, cupcake: 1.6, cupcakeB: 1.6, donut: 1.8, softServe: 2.0,
  lollipop: 1.5, cane: 1.4, rockCandy: 1.5, gummyPlant: 1.6, rosettes: 1.6, ribbon: 1.8,
};
const RADIUS = {
  gingerHouseA: 4.6, gingerHouseB: 4.6, gingerCottage: 3.4, lollipopTree: 2.2, lollipopBall: 1.8, caneTall: 1.6,
  cottonTree: 2.6, cottonTreeB: 2.6, gummyBear: 1.4, cookieGiant: 2.0, donutArch: 2.6, macaronGiant: 1.8,
  truffleRocks: 2.6, chocoBlocks: 2.8, rockCandyGiant: 1.8, cakeSlice: 3.0, coneGiant: 2.0,
};
const TINT = {
  lollipop: ['#ffffff', '#ffffff', '#ff4d8d', '#4fb6ff', '#a66cff', '#ffa62e', '#4fd67a'],
  lollipopTree: ['#ffffff', '#ffffff', '#ff7eb6', '#7cc6ff', '#b18cff', '#ffc24d'],
  lollipopBall: ['#ff4d8d', '#a66cff', '#4fb6ff', '#ffa62e', '#ff6a3d', '#4fd67a'],
  cane: STRIPES,
  caneTall: STRIPES,
  rockCandy: ['#ff8cc0', '#8fd8ff', '#c4a4ff', '#ffe27a', '#9ff0c0'],
  rockCandyGiant: ['#ff8cc0', '#8fd8ff', '#c4a4ff', '#ffe27a'],
  gummyPlant: ['#5fd64a', '#8fe03a', '#3fc47a', '#ffd21f', '#ff8a1f', '#4fd6c0'],
  gummyBear: GUMMY_TINTS,
  rosettes: PASTEL_TINTS,
  cupcake: PASTEL_TINTS,
  cupcakeB: ['#ff8cc0', '#ffffff', '#c9b0ff', '#ffe27a', '#9ff0d0'],
  donut: ['#ff8cc0', '#ffffff', '#8a4a28', '#c9b0ff', '#ffe27a', '#9ff0d0'],
  donutArch: ['#ff8cc0', '#ffffff', '#8a4a28', '#c9b0ff', '#9ff0d0'],
  softServe: ['#ffffff', '#ffb3d1', '#a8f0d0', '#8a5230', '#ffe79a'],
  ribbon: ['#ff4d8d', '#4fb6ff', '#4fd67a', '#a66cff', '#ffa62e'],
  cottonTree: ['#ffb3d1', '#acdcff', '#cdb6ff', '#ffd2e4'],
  cottonTreeB: ['#a8f0d0', '#ffe79a', '#ffb3d1', '#acdcff'],
  macaronGiant: PASTEL_TINTS,
  cakeSlice: PASTEL_TINTS,
  coneGiant: ['#ffb3d1', '#a8f0d0', '#fff0c8', '#a8693a', '#cdb6ff'],
};
