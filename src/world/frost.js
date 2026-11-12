import * as THREE from '../../vendor/three/three.module.min.js';
import { P, part, merge, rgb, gateFrameParts, gateTop, leafParts } from './shapes.js';
import { crystal, stone, nugget, tabular, dodecahedron, cube, crystalPoint, FACE } from './gems.js';
import { CONFIG } from '../config.js';

// X · The Frostbound Pass — a route of packed snow and bare blue ice through
// a glacier: towering cliffs of turquoise ice either side, banded and
// cracked, deepening to cobalt in their crevices and capped with snow; frozen
// waterfalls down their faces, icicles, and now and then an enormous natural
// arch of ice right over the route. In places the canyon opens out — first on
// one side, then both, then the other — onto a field of pack ice, plates of
// it up-ended along the pressure ridges, icebergs frozen in, and jagged
// mountains far off under a pale sky with a little peach low in it. Firs
// stand by the route, bowed under snow; here and there a small timber cabin,
// its windows lit amber. Wilderness, and nobody in it.
//
// And it is snowing, and the snow stays. Every time the run comes back round
// to the pass more of it has settled (see snowAt, and Game.updateSnow, which
// hands it to the shaders): the first time through there's a light cover on
// the route with the blue ice scoured bare between the patches, low banks
// either side, every rock and the cabins' steps plain to see, and a few
// flakes in the air; the second time the caps are thicker, the banks deeper,
// rocks and fences half under, less ice showing; from the third the drifts
// are great heaps, the cabins are going under to their sills, the firs'
// boughs sag with the weight and it's snowing hard. It builds a little
// during each visit too. None of it is simulated: the route's cover is the
// ground pattern's (15), the banks are heaped by the vertex shader, and every
// cap, bough and drift is a mesh whose vertices carry how far they move as
// the snow builds up (settle(), below; toon option snow).
//
// The snow never plays against the runner. The route's own surface stays
// flat and as fast as any other (no sliding about, no slowing down); nothing
// drifts into the lanes; and the obstacles take no part in it at all — each
// wears a fixed cap of snow, modelled on, so what you see is what you can
// hit however deep the rest lies, a bar's underside stays on the duck line,
// and dark timber, slate and deep-blue ice still stand off the white.
//
// The first time through, it's simply the pass, however far the run has
// already sunk into the dream (def.dream holds the dream back: see holdBack).
// The second, something is very slightly off: a few flakes hang where they
// are. From the third the dream comes in by degrees over the top of the
// snowfall, which goes on falling and settling beneath it: flakes hanging
// still all through the air, then streaming upward, and far off across the
// ice field the great drifts coming apart in slabs that lift off one another
// and hang there (they settle again long before you reach them).
//
// Obstacles: a fallen trunk under snow and a low ridge of ice shards to jump
// (a glacial fissure across the whole route); a snow-laden bough between two
// snags and a ledge of ice on two piers to slide under (a low arch of ice
// across the whole route); and ice pillars, great snowy boulders and
// abandoned supply sleds to go around.

const TAU = Math.PI * 2;
const D = CONFIG.duckLine;

const C = {
  snow: '#f7faff',
  snowLo: '#c6c9f0',
  snowBlue: '#dfe8fb',
  ice: '#6fd6e6',
  iceHi: '#c9f4f6',
  icePale: '#e6fbff',
  iceLo: '#2b8fd0',
  iceDeep: '#1b55b2',
  iceDark: '#123a86',
  rock: '#5c6382',
  rockLo: '#3a4062',
  rockHi: '#8d95b0',
  peak: '#8389c4',
  peakLo: '#666cae',
  bark: '#5e4030',
  barkLo: '#3a2820',
  barkHi: '#8c6548',
  wood: '#7c5436',
  woodHi: '#a67a4f',
  woodLo: '#48301f',
  sawn: '#dcbd8e',
  shingle: '#4a4152',
  fir: '#2f6660',
  firLo: '#1c403f',
  firHi: '#4f8c7c',
  amber: '#ffc56b',
  crate: '#9a7448',
  canvas: '#b28c50',
  rope: '#e2d1a8',
  iron: '#3a4052',
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// a triangle wave, 0..1: sharp crests
const ridge = (t) => 1 - Math.abs(2 * (t - Math.floor(t)) - 1);

function seeded(seed) {
  let k = seed;
  return () => {
    k = (k * 16807) % 2147483647;
    return k / 2147483647;
  };
}
// (a number in 0..1 from two, the same every time)
const hash2 = (a, b) => {
  const k = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return k - Math.floor(k);
};

// --- how the snow settles ---------------------------------------------------------
// How deep it lies (0 a dusting, 1 as deep as it gets) on the visit-th time
// through the pass this run (0 the first), t of the way along it: what it
// has come to by the time you arrive, and what settles while you're there —
// a little during each visit, a lot between one and the next, and no more
// once it's full.
const SNOW_AT = [0, 0.42, 0.74, 0.9];
const SNOW_GROWS = [0.12, 0.12, 0.1, 0.1];
export function snowAt(visit, t) {
  const v = Math.min(Math.max(0, visit | 0), SNOW_AT.length - 1);
  return Math.min(1, SNOW_AT[v] + SNOW_GROWS[v] * clamp01(t));
}

// Where the canyon opens out on this side of the route (as openAt in the
// shaders, which lays the pack ice by it): the cliffs stand wherever it's
// under a half.
const openAt = (d, s) => sstep(0.56, 0.74, 0.5 + 0.5 * Math.sin(d * 0.01227185 + (s < 0 ? 0.4 : 2.4)));
const walled = (d0, s) => openAt(d0 + 8, s) < 0.5;

// Give a finished part its share of the settling snow: fn(x, y, z) says how
// far each vertex has moved, in the prop's own space, by the time the snow
// lies as deep as it gets (see SNOW in the shaders; nothing, if left out);
// slab: which slab of a far drift it is (0: it stays put when they lift
// apart in the dream).
const STILL = [0, 0, 0];
function settle(g, fn, slab = 0) {
  const pos = g.attributes.position.array;
  const n = pos.length / 3;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const d = fn ? fn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) : STILL;
    a[i * 4] = d[0];
    a[i * 4 + 1] = d[1];
    a[i * 4 + 2] = d[2];
    a[i * 4 + 3] = slab;
  }
  g.setAttribute('snow', new THREE.BufferAttribute(a, 4));
  return g;
}
// (swelling about a point on the ground: so much taller, so much wider)
const swell = (cx, cz, up, out, y0 = 0) => (x, y, z) => [(x - cx) * out, Math.max(0, y - y0) * up, (z - cz) * out];

// Recolour a finished part vertex by vertex, from where each vertex is and
// which way it faces.
function paint(g, fn) {
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const col = g.attributes.color.array;
  for (let i = 0; i < pos.length / 3; i++) {
    const c = fn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nor[i * 3 + 1]);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  return g;
}

// Faceted: every triangle its own flat face (ice and rock are cut, not
// turned).
function flat(g) {
  const f = g.index ? g.toNonIndexed() : g;
  f.deleteAttribute('normal');
  f.computeVertexNormals();
  return f;
}

// Bark (toon option bark: parts marked 0.4, their uv laid round the trunk).
function asBark(g, along = (x, y) => y, plate = 0.5) {
  const uv = g.attributes.uv.array;
  const pos = g.attributes.position.array;
  const fx = g.attributes.fx.array;
  for (let i = 0; i < uv.length / 2; i++) {
    uv[i * 2] *= 16;
    uv[i * 2 + 1] = along(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) / plate;
    fx[i * 3] = 0.4;
  }
  return g;
}

// Glacier ice's colour up a face (t: 0 its foot, 1 its top; deep: how far
// back in a crevice): cobalt at the foot and in the crevices, turquoise up
// the face, paling toward the top.
const ICE_RAMP = [rgb(C.iceDark), rgb(C.iceDeep), rgb(C.iceLo), rgb(C.ice), rgb(C.iceHi)];
function iceAt(t, deep = 0) {
  const k = clamp01(t * 0.9 + 0.12 - deep * 0.4) * (ICE_RAMP.length - 1);
  const i = Math.min(ICE_RAMP.length - 2, Math.floor(k));
  return lerp3(ICE_RAMP[i], ICE_RAMP[i + 1], k - i);
}
const SNOW = rgb(C.snow);
const SNOW_LO = rgb(C.snowLo);

// A lump of something: a polyhedron jittered by position (so its faces stay
// joined), faceted.
function lump({ r = 1, sx = 1, sy = 1, sz = 1, seed = 1, detail = 0, jitter = 0.3 } = {}) {
  const g = detail ? P.ico(r, detail) : P.dodeca(r);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const k = Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719 + seed * 4.13) * 43758.5453;
    const f = 1 + (k - Math.floor(k) - 0.5) * jitter;
    pos.setXYZ(i, px * f * sx, py * f * sy, pz * f * sz);
  }
  g.computeVertexNormals();
  return g;
}
// A slate boulder, its foot a little in the ground.
function boulder({ r = 1, sx = 1, sy = 0.85, sz = 1, seed = 1, x = 0, y = 0, z = 0, ry = 0, detail = 0, lo = C.rockLo, hi = C.rockHi } = {}) {
  return part(lump({ r, sx, sy, sz, seed, detail }), null, { x, y: y + r * sy * 0.62, z, ry, grad: [lo, hi, y - r * sy * 0.2, y + r * sy * 1.5], mark: 0.35 });
}
// Snow lying on top of something: a low dome, white, lavender round its foot.
function snowCap({ r = 1, h = 0.3, x = 0, y = 0, z = 0, sx = 1, sz = 1, seg = 10 } = {}) {
  return part(new THREE.SphereGeometry(1, seg, 4, 0, TAU, 0, Math.PI / 2), null, { x, y, z, sx: r * sx, sy: h, sz: r * sz, grad: [C.snowLo, C.snow, y - h * 0.2, y + h * 0.7] });
}
// An icicle hanging from (x, y, z).
function icicle(parts, x, y, z, len, r = 0.09) {
  parts.push(part(P.cone(r, len, 5), null, { x, y: y - len / 2, z, rx: Math.PI, grad: [C.icePale, C.ice, y - len, y], mark: 0.2, outline: 0.5 }));
}

// --- the ground -------------------------------------------------------------------
// One strip right across the pass and out over the field: coarse down the
// flat of the route, fine where the banks heap up along it (4 to 8 m out),
// coarser and coarser beyond; uv in metres (x across, y along the run) like
// groundStrip's. The vertex shader heaps it (toon option banks).
function snowStrip() {
  const half = [0, 1, 2, 3, 3.6];
  for (let x = 4.1; x < 7.7; x += 0.25) half.push(x);
  half.push(8.5, 9.5, 10.5, 12, 14, 17, 21, 27, 36, 50, 70, 100, 150);
  const xs = [...half.slice(1).reverse().map((x) => -x), ...half];
  const rows = 16;
  const L = CONFIG.chunkLength;
  const pos = [];
  const nrm = [];
  const uv = [];
  for (let j = 0; j <= rows; j++) {
    const d = (L * j) / rows;
    for (const x of xs) {
      pos.push(x, 0, -d);
      nrm.push(0, 1, 0);
      uv.push(x, d);
    }
  }
  const idx = [];
  const W = xs.length;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i;
      const b = a + W;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return part(g, '#ffffff', { outline: 0 });
}

// --- the glacier --------------------------------------------------------------------
// One chunk's length of the canyon wall, facing +x, centred on the origin
// along the run (so it stands either way round): a face of ice leaning back
// as it climbs, stepping back in two ledges (where the snow lies), buttressed
// in sharp prows, its skyline rising to a crest somewhere along it. Every
// piece has the same profile at its two ends, so any stands next to any.
const WALL_X = 12.5;
const CLIFF_H = 28;
const CLIFF_L = CONFIG.chunkLength;
function cliffFace(seed, peak) {
  const rnd = seeded(seed);
  const ph = [rnd() * TAU, rnd() * TAU, rnd() * 3, rnd() * 3];
  // u: 0..1 along it, v: 0..1 up it -> where the face is, and how far back
  // in a crevice
  return (u, v) => {
    const win = Math.sin(Math.PI * u);
    const top = CLIFF_H * (1 + win * (peak + 0.14 * Math.sin(u * 9 + ph[0])));
    const y = v * top;
    const prow = ridge(u * 3 + ph[2] + v * 0.3) * 0.65 + ridge(u * 7 + ph[3]) * 0.35;
    const back = 0.1 * y + 1.7 * sstep(0.3, 0.38, v + 0.05 * Math.sin(u * 7 + ph[1]) * win) + 1.9 * sstep(0.62, 0.7, v + 0.04 * Math.sin(u * 5 + ph[0]) * win);
    const x = -back + 2.6 * prow * win * (1 - 0.45 * v);
    return { x, y, top, deep: 1 - prow * win };
  };
}
function cliffGeo(seed, peak = 0.12) {
  const face = cliffFace(seed, peak);
  const NZ = 12;
  const NY = 11;
  const g = new THREE.PlaneGeometry(CLIFF_L, 1, NZ, NY);
  const pos = g.attributes.position;
  const shade = [];
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / CLIFF_L + 0.5;
    const v = pos.getY(i) + 0.5;
    const win = Math.sin(Math.PI * u);
    const f = face(u, v);
    // (jostled, but for its foot, its skyline and its two ends)
    const jit = v > 0.02 && v < 0.98 ? win : 0;
    const jx = (hash2(i, seed) - 0.5) * 0.9 * jit;
    const jy = (hash2(i, seed + 3) - 0.5) * 1.1 * jit;
    pos.setXYZ(i, f.x + jx, f.y + jy, -(u - 0.5) * CLIFF_L);
    shade.push(f.deep);
  }
  const body = part(flat(g), '#ffffff', { mark: 0.2 });
  // (painted from where each vertex stands: the same face, asked again)
  paint(body, (x, y, z) => {
    const u = 0.5 - z / CLIFF_L;
    const f = face(u, 0.5);
    const v = clamp01(y / f.top);
    return iceAt(v, face(u, v).deep * 0.9 + 0.12 * (hash2(x * 3.1, y * 1.7) - 0.5));
  });
  // The snow along its top: a cornice following the skyline, leaning out over
  // the face; it thickens and leans further as the snow builds up.
  const prof = [[1.0, -0.7, 0], [1.5, 0.15, 0.35], [0.6, 0.95, 1], [-1.8, 1.25, 1], [-5, 0.9, 0.7]];
  const cp = [];
  const cuv = [];
  const grow = [];
  for (let i = 0; i <= NZ; i++) {
    const u = i / NZ;
    const f = face(u, 1);
    for (const [dx, dy, k] of prof) {
      cp.push(f.x + dx, f.y + dy, -(u - 0.5) * CLIFF_L);
      cuv.push(u, k);
      grow.push(k);
    }
  }
  const idx = [];
  const PN = prof.length;
  for (let i = 0; i < NZ; i++) {
    for (let k = 0; k < PN - 1; k++) {
      const a = i * PN + k;
      const b = a + PN;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  cg.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
  cg.setIndex(idx);
  cg.computeVertexNormals();
  const cap = part(cg, '#ffffff', {});
  // (its lip in the lavender of its own shade; how much each vertex grows is
  // how far up the cornice it is, kept in uv.y)
  const cu = cap.attributes.uv.array;
  const cc = cap.attributes.color.array;
  const sn = new Float32Array((cu.length / 2) * 4);
  for (let i = 0; i < cu.length / 2; i++) {
    const k = cu[i * 2 + 1];
    const c = lerp3(SNOW_LO, SNOW, sstep(0, 0.5, k));
    cc.set(c, i * 3);
    sn.set([0.9 * (k > 0.2 && k < 0.5 ? 1 : 0.3 * k), 1.6 * k, 0, 0], i * 4);
  }
  cap.setAttribute('snow', new THREE.BufferAttribute(sn, 4));
  return merge([settle(body), cap]);
}

// Where a run of wall ends (and where the canyon's shut behind the doorway):
// a headland of ice, closed all the way round, for the wall to come out of.
// Smaller, it's an iceberg frozen into the field.
function headlandGeo(seed, h = CLIFF_H * 1.05, r = 9) {
  const rnd = seeded(seed);
  const ph = [rnd() * 3, rnd() * 3, rnd() * TAU];
  const g = P.cyl(r * 0.36, r, h, 10, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + h / 2;
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const v = y / h;
    const rr = Math.hypot(x, z);
    if (rr < 1e-3) continue;
    const k = 1 + 0.26 * (ridge(a / TAU * 4 + ph[0] + v * 0.4) - 0.5) + 0.14 * (ridge(a / TAU * 9 + ph[1]) - 0.5) - 0.12 * sstep(0.3, 0.36, v) - 0.14 * sstep(0.62, 0.68, v);
    pos.setXYZ(i, x * k, y + (v > 0.02 && v < 0.98 ? (hash2(i, seed) - 0.5) * 1.2 : 0), z * k);
  }
  const body = part(flat(g), '#ffffff', { mark: 0.2 });
  paint(body, (x, y, z) => iceAt(clamp01(y / h), 0.5 + 0.5 * Math.sin(Math.atan2(z, x) * 4 + ph[2]) * 0.6));
  // (its cap no wider than its top, so it never overhangs like a toadstool's;
  // it builds upward)
  const cap = settle(snowCap({ r: r * 0.34, h: 1.1, y: h - 0.5, seg: 10 }), (x, y, z) => [x * 0.04, 1.3 * sstep(h - 0.5, h + 0.6, y), z * 0.04]);
  return merge([settle(body), cap]);
}

// A frozen waterfall down the wall's face: three falls of it, one to each
// ledge, every one a curtain of fluted columns swelling to a boss of ice at
// its foot. Facing +x like the wall it stands against.
function fallGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const curtain = (x, y0, y1, w) => {
    const n = Math.max(4, Math.round(w / 0.8));
    for (let i = 0; i < n; i++) {
      const z = -w / 2 + (w * (i + 0.5)) / n + (rnd() - 0.5) * 0.3;
      const r = 0.42 + rnd() * 0.4;
      const h = (y1 - y0) * (0.82 + rnd() * 0.22);
      parts.push(part(P.cyl(r * 0.55, r, h, 5, 2), null, { x: x + rnd() * 0.5, y: y1 - h / 2, z, ry: rnd() * TAU, grad: [C.icePale, C.ice, y0, y1 + 2] }));
      // and a fringe of icicles let down from the lip, part way
      if (rnd() < 0.6) icicle(parts, x + 0.6 + rnd() * 0.4, y1 - 0.4, z + (rnd() - 0.5) * 0.4, 1.2 + rnd() * 2.2, 0.16 + rnd() * 0.1);
    }
    parts.push(part(lump({ r: w * 0.42, sy: 0.55, sx: 0.8, seed: seed + y0, detail: 1, jitter: 0.2 }), null, { x: x + 0.7, y: y0 + w * 0.1, grad: [C.ice, C.icePale, y0 - 0.5, y0 + w * 0.4] }));
  };
  curtain(0.4, 0, CLIFF_H * 0.36, 5.4);
  curtain(-1.6, CLIFF_H * 0.36, CLIFF_H * 0.68, 4.4);
  curtain(-3.6, CLIFF_H * 0.68, CLIFF_H * 1.02, 3.6);
  parts.push(settle(snowCap({ r: 2.6, h: 0.6, x: 1.4, y: 0.1, sz: 1.3 }), swell(1.4, 0, 2.2, 0.35, 0.1)));
  return merge(parts.map((g) => (g.attributes.snow ? g : settle(g))));
}

// An enormous arch of ice right over the route, sprung from a pier either
// side: scenery, far too high and wide to be in anyone's way (its underside
// is fifteen metres up, its piers ten metres out from the middle lane).
const ARCH_R = 13.2;
const ARCH_T = 2.7;
const ARCH_SPRING = 5;
function archGeo() {
  const parts = [];
  const g = new THREE.TorusGeometry(ARCH_R, ARCH_T, 6, 18, Math.PI);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(y, x);
    // (hollowed and swollen along it, but never inward of its true underside)
    const rr = Math.hypot(x, y);
    const k = rr > ARCH_R ? 1 + 0.1 * Math.sin(a * 5) + 0.06 * Math.sin(a * 11 + 1) : 1;
    pos.setXYZ(i, x * k, y * k, z * (1.5 + 0.3 * Math.sin(a * 3 + 0.5)));
  }
  const span = part(flat(g), '#ffffff', { y: ARCH_SPRING, mark: 0.2 });
  paint(span, (x, y, z, ny) => iceAt(clamp01(0.25 + (y - ARCH_SPRING) / (ARCH_R * 1.6) + ny * 0.25), ny < -0.2 ? 0.9 : 0.2));
  parts.push(span);
  for (const s of [-1, 1]) {
    const pier = part(flat(P.cyl(ARCH_T * 1.15, ARCH_T * 1.7, ARCH_SPRING + 1.5, 8, 2)), '#ffffff', { x: s * ARCH_R, y: (ARCH_SPRING + 1.5) / 2, sz: 1.5, ry: s * 0.4, mark: 0.2 });
    paint(pier, (x, y) => iceAt(clamp01(y / 14), 0.45));
    parts.push(pier);
    parts.push(settle(snowCap({ r: 4.2, h: 0.9, x: s * (ARCH_R + 1), y: 0.1, sz: 1.3 }), swell(s * (ARCH_R + 1), 0, 2.0, 0.3, 0.1)));
  }
  // the snow along its back: a long cushion over its crown, thickening
  // outward as the snow builds up
  {
    const g = new THREE.TorusGeometry(ARCH_R + ARCH_T * 0.82, ARCH_T * 0.42, 5, 16, Math.PI * 0.64);
    g.rotateZ(Math.PI * 0.18);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * 3.2);
    g.computeVertexNormals();
    const cush = part(g, null, { y: ARCH_SPRING, grad: [C.snowLo, C.snow, ARCH_SPRING + ARCH_R * 0.6, ARCH_SPRING + ARCH_R + ARCH_T * 1.3] });
    parts.push(settle(cush, (x, y) => {
      const dx = x;
      const dy = y - ARCH_SPRING;
      const l = Math.hypot(dx, dy) || 1;
      return [(dx / l) * 0.9, (dy / l) * 0.9, 0];
    }));
  }
  // icicles under its haunches (well clear of the route, well overhead)
  const rnd = seeded(8);
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const a = Math.PI / 2 - side * (0.5 + rnd() * 0.75);
    const R = ARCH_R - ARCH_T * 0.96;
    icicle(parts, Math.cos(a) * R, ARCH_SPRING + Math.sin(a) * R + 0.2, (rnd() - 0.5) * 5, 0.9 + rnd() * 2.2, 0.16 + rnd() * 0.12);
  }
  return merge(parts.map((p) => (p.attributes.snow ? p : settle(p))));
}

// A jagged mountain far off: a horn with shoulders, snow on everything but
// its steepest faces and its foot.
function peakGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const horn = (r, h, x, z) => {
    const g = P.cone(r, h, 9, 5);
    const pos = g.attributes.position;
    const ph = rnd() * 9;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i) + h / 2;
      const pz = pos.getZ(i);
      if (Math.hypot(px, pz) < 1e-3) continue;
      const a = Math.atan2(pz, px);
      const k = 1 + 0.42 * (ridge(a / TAU * 5 + ph + (py / h) * 0.6) - 0.5) + 0.2 * (hash2(Math.round(a * 20), Math.round(py)) - 0.5);
      pos.setXYZ(i, px * k, py * (1 + 0.08 * (hash2(Math.round(a * 20) + 7, Math.round(py)) - 0.5)), pz * k);
    }
    const p = part(flat(g), '#ffffff', { x, z });
    const line = h * (0.22 + rnd() * 0.1);
    paint(p, (px, py, pz, ny) => {
      const snowy = sstep(line - 6, line + 10, py + (hash2(px * 0.11, pz * 0.13) - 0.5) * 16) * sstep(0.12, 0.4, ny + 0.25);
      return lerp3(lerp3(rgb(C.peakLo), rgb(C.peak), clamp01(py / h)), SNOW, snowy);
    });
    parts.push(p);
  };
  const h = 92 + rnd() * 30;
  horn(52, h, 0, 0);
  horn(38, h * 0.66, 34 + rnd() * 12, 14 * (rnd() - 0.5));
  horn(34, h * 0.56, -30 - rnd() * 14, 18 * (rnd() - 0.5));
  horn(26, h * 0.4, 8 * (rnd() - 0.5), 30 + rnd() * 10);
  return merge(parts);
}

// --- trees, rocks, drifts ---------------------------------------------------------
// A fir under snow: a dark trunk, tiers of boughs in skirts, each with a
// pillow of snow lying on it. As the snow builds up the pillows thicken and
// the boughs sag under them, the lowest furthest.
function firParts({ h = 9, tiers = 5, r = 2.3, seed = 1, seg = 8 } = {}) {
  const rnd = seeded(seed);
  const parts = [];
  const foot = h * 0.16;
  parts.push(settle(asBark(part(P.cyl(0.09, 0.24, h * 0.62, 6), null, { y: h * 0.31, grad: [C.barkLo, C.bark, 0, h * 0.6] }))));
  const step = (h - foot) / tiers;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const R = r * (1 - 0.74 * k);
    const y0 = foot + step * i * 0.94;
    const hc = step * 1.85;
    const sag = (x, y, z) => {
      const q = Math.hypot(x, z) / R;
      return [-x * 0.06 * q, -0.42 * R * q * q * (1 - 0.5 * k), -z * 0.06 * q];
    };
    // the boughs: a skirt, every other point of its hem hanging a little lower
    const g = P.cone(R, hc, seg, 1, true);
    const pos = g.attributes.position;
    for (let j = 0; j < pos.count; j++) {
      if (pos.getY(j) > -hc / 2 + 1e-3) continue;
      const a = Math.round((Math.atan2(pos.getZ(j), pos.getX(j)) / TAU) * seg);
      if (((a % 2) + 2) % 2) pos.setXYZ(j, pos.getX(j) * 0.86, pos.getY(j) - R * 0.1, pos.getZ(j) * 0.86);
    }
    g.computeVertexNormals();
    const ry = rnd() * TAU;
    parts.push(settle(part(g, null, { y: y0 + hc / 2, ry, grad: [C.firLo, C.fir, y0 - 0.2, y0 + hc * 0.7], mark: 0.7 }), sag));
    // the snow lying on them
    const at = (f) => y0 + hc * (1 - f);
    const th = 0.14 + 0.1 * (1 - k);
    const prof = [[R * 0.9, at(0.9) - 0.03], [R * 0.93, at(0.9) + th * 0.6], [R * 0.78, at(0.78) + th * 1.25], [R * 0.3, at(0.3) + th * 0.8]];
    const sg = part(P.lathe(prof, seg), null, { ry, grad: [C.snowLo, C.snow, at(0.9) - 0.05, at(0.9) + th * 1.4] });
    parts.push(settle(sg, (x, y, z) => {
      const d = sag(x, y, z);
      const q = Math.hypot(x, z) / R;
      return [d[0] + x * 0.08, d[1] + 0.4 * (0.4 + 0.6 * q) * (1 - 0.4 * k), d[2] + z * 0.08];
    }));
  }
  parts.push(settle(snowCap({ r: 0.2, h: 0.3, y: h - 0.12, seg: 6 }), () => [0, 0.14, 0]));
  return parts;
}

// A slate boulder or two, snow on their heads; the caps thicken.
function rockGeo(seed, k = 1) {
  const rnd = seeded(seed);
  const parts = [];
  const n = 1 + Math.floor(rnd() * 2.4);
  for (let i = 0; i < n; i++) {
    const r = (0.55 + rnd() * 0.5) * k * (i ? 0.7 : 1);
    const sy = 0.7 + rnd() * 0.3;
    const x = i ? (rnd() - 0.5) * 2.2 * k : 0;
    const z = i ? (rnd() - 0.5) * 1.6 * k : 0;
    parts.push(settle(boulder({ r, sy, seed: seed * 7 + i, x, z, ry: rnd() * TAU })));
    const top = r * sy * 1.45;
    parts.push(settle(snowCap({ r: r * 0.78, h: r * 0.3, x, y: top - r * 0.22, z, seg: 8 }), (px, py, pz) => [(px - x) * 0.3, 0.45 * r * sstep(top - r * 0.22, top + r * 0.1, py) + 0.1, (pz - z) * 0.3]));
  }
  return merge(parts);
}

// A drift: snow the wind has heaped — a long easy back and a steeper lee —
// small at first, swelling with every fall.
function driftGeo({ rx = 2.4, h = 0.5, rz = 1.7, seed = 1, up = 2.0, out = 0.5 } = {}) {
  const g = new THREE.SphereGeometry(1, 12, 5, 0, TAU, 0, Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.12 * Math.sin(a * 3 + seed) + 0.07 * Math.sin(a * 5 + seed * 2.3);
    pos.setXYZ(i, (x * k + y * 0.45) * rx, y * h, z * k * rz);
  }
  g.computeVertexNormals();
  return settle(part(g, null, { grad: [C.snowLo, C.snow, -h * 0.1, h * 0.7] }), swell(0, 0, up, out));
}

// A great drift out on the field, laid down in three slabs (they lie as one
// until the dream lifts them apart: see the lift in the vertex shader), each
// white above and the lavender of its own shade beneath.
function farDriftGeo(seed) {
  const R = 6.5;
  const H = 2.4;
  const rad = (y) => R * Math.sqrt(Math.max(0, 1 - Math.pow(y / H, 1.5)));
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const y0 = (H * k) / 3;
    const y1 = (H * (k + 1)) / 3;
    const ym = (y0 + y1) / 2;
    const prof = [[0.001, y0], [rad(y0), y0], [rad(ym) * 1.02, ym], [Math.max(rad(y1), 0.001), y1], [0.001, y1]];
    const g = P.lathe(prof, 12);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const w = 1 + 0.14 * Math.sin(a * 3 + seed) + 0.08 * Math.sin(a * 5 + seed * 1.7);
      pos.setXYZ(i, pos.getX(i) * w * 1.25, pos.getY(i), pos.getZ(i) * w);
    }
    g.computeVertexNormals();
    const p = part(g, '#ffffff', {});
    paint(p, (x, y, z, ny) => lerp3(SNOW_LO, SNOW, sstep(-0.3, 0.35, ny)));
    parts.push(settle(p, swell(0, 0, 0.9, 0.3), k));
  }
  return merge(parts);
}

// A plate of ice: thick, six-sided and none of them alike, snow lying on it.
// Level, a floe at the edge of the route; up-ended, one of the plates the
// pack has shoved up along a pressure ridge.
function floeParts({ r = 1.2, t = 0.55, seed = 1 } = {}) {
  const g = P.cyl(r, r * 1.08, t, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = Math.hypot(pos.getX(i), pos.getZ(i)) < 1e-3 ? 1 : 0.82 + 0.36 * hash2(Math.round(a * 3), seed);
    pos.setXYZ(i, pos.getX(i) * k * 1.25, pos.getY(i), pos.getZ(i) * k);
  }
  const body = part(flat(g), null, { y: t / 2, grad: [C.iceDeep, C.ice, 0, t], mark: 0.2 });
  const lid = settle(snowCap({ r: r * 0.9, h: 0.14, y: t - 0.02, seg: 6, sx: 1.2 }), (x, y) => [x * 0.06, 0.3 * sstep(t - 0.02, t + 0.1, y) + 0.04, 0]);
  return [settle(body), lid];
}
function slabGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const r = 2.2 + rnd() * 1.6;
    const tilt = 0.45 + rnd() * 0.7;
    const g = merge(floeParts({ r, t: 0.6 + rnd() * 0.3, seed: seed + i }));
    g.rotateZ(tilt * (i % 2 ? 1 : -1));
    g.rotateY(rnd() * TAU);
    g.translate((i - 1) * 2.6 + rnd(), r * Math.sin(tilt) * 0.55, (rnd() - 0.5) * 2.4);
    // (turned with it: the way its snow builds up)
    parts.push(settle(g));
  }
  parts.push(driftGeo({ rx: 3.6, h: 0.5, rz: 2.4, seed, up: 1.6, out: 0.3 }));
  return merge(parts);
}

// A stretch of post-and-rail fence along the route, weathered grey, a dab of
// snow on every post (the bank swallows it by and by).
function fenceGeo() {
  const parts = [];
  const post = '#6b5648';
  for (let i = 0; i < 3; i++) {
    const z = (i - 1) * 2.1;
    const lean = [0.05, -0.04, 0.07][i];
    parts.push(part(P.box(0.14, 1.25, 0.14), null, { y: 0.6, z, rz: lean, grad: [C.woodLo, post, 0, 1.2] }));
    parts.push(settle(snowCap({ r: 0.15, h: 0.12, x: -lean * 1.2, y: 1.2, z, seg: 6 }), () => [0, 0.16, 0]));
  }
  for (const y of [0.5, 0.98]) parts.push(part(P.box(0.07, 0.11, 4.5), post, { x: 0.02, y, rx: y > 0.7 ? 0.012 : -0.01 }));
  parts.push(settle(part(P.box(0.11, 0.07, 4.3), C.snow, { x: 0.02, y: 1.07, outline: 0.5 }), () => [0, 0.14, 0]));
  return merge(parts.map((p) => (p.attributes.snow ? p : settle(p))));
}

// --- the cabin ----------------------------------------------------------------------
// A small timber cabin, its door and a window toward the route (+z), a
// window in each gable; a stone footing with two steps up to the door, a
// stone chimney, a roof of dark shingle under a slab of snow. The glass is
// lit amber from inside. The snow on the roof thickens and bulges over the
// eaves; the drifts against its walls climb, over the steps first, then up
// to the sills.
const CABIN = { W: 4.2, D: 3.4, F: 0.42, H: 2.3, ROOF: 1.55 };
function cabinGeo() {
  const { W, D, F, H, ROOF } = CABIN;
  const parts = [];
  const eave = F + H;
  parts.push(part(P.box(W + 0.3, F, D + 0.3), null, { y: F / 2, grad: [C.rockLo, C.rock, 0, F], mark: 0.3 }));
  parts.push(part(P.box(W, H, D), null, { y: F + H / 2, grad: [C.woodLo, C.wood, F - 0.4, eave] }));
  // the logs: a dark line between one and the next, their ends crossing at
  // the corners
  const logs = 6;
  for (let i = 1; i < logs; i++) parts.push(part(P.box(W + 0.03, 0.04, D + 0.03), C.woodLo, { y: F + (i * H) / logs, outline: 0 }));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < logs; i++) {
        const y = F + ((i + 0.5) * H) / logs;
        if (i % 2) parts.push(part(P.cyl(0.15, 0.15, 0.34, 7), C.woodHi, { x: sx * (W / 2 - 0.16), y, z: sz * (D / 2 + 0.1), rx: Math.PI / 2, outline: 0.6 }));
        else parts.push(part(P.cyl(0.15, 0.15, 0.34, 7), C.woodHi, { x: sx * (W / 2 + 0.1), y, z: sz * (D / 2 - 0.16), rz: Math.PI / 2, outline: 0.6 }));
      }
    }
  }
  // the roof, its ridge along x; the gables under it
  parts.push(part(P.prism(D + 0.9, ROOF, W + 0.7), C.shingle, { y: eave - 0.02, ry: Math.PI / 2 }));
  for (const sx of [-1, 1]) parts.push(part(P.prism(D, ROOF - 0.2, 0.06), C.wood, { x: sx * (W / 2 - 0.01), y: eave - 0.02, ry: Math.PI / 2, outline: 0.5 }));
  // the door, its steps
  parts.push(part(P.box(0.95, 1.85, 0.1), C.woodLo, { x: -0.95, y: F + 0.925, z: D / 2 + 0.02 }));
  parts.push(part(P.box(0.8, 1.7, 0.06), '#5a3b26', { x: -0.95, y: F + 0.9, z: D / 2 + 0.06, outline: 0.5 }));
  parts.push(part(P.sphere(0.05, 6, 5), C.iron, { x: -0.68, y: F + 0.9, z: D / 2 + 0.12, outline: 0 }));
  parts.push(part(P.box(1.4, F, 0.5), C.rockHi, { x: -0.95, y: F / 2, z: D / 2 + 0.38, mark: 0.3 }));
  parts.push(part(P.box(1.4, F * 0.5, 0.45), C.rockHi, { x: -0.95, y: F * 0.25, z: D / 2 + 0.82, mark: 0.3 }));
  // windows: lit glass, a dark frame and glazing bars, a sill
  const win = (x, y, z, alongX) => {
    const w = 0.95;
    const hh = 0.85;
    const o = alongX ? { sx: 1, sz: 1 } : null;
    const box = (bw, bh, bd, dx, dy, c, e = 0) => parts.push(part(alongX ? P.box(bw, bh, bd) : P.box(bd, bh, bw), c, { x: x + (alongX ? dx : 0), y: y + dy, z: z + (alongX ? 0 : dx), emit: e, outline: e ? 0 : 0.5, ...o }));
    box(w + 0.16, hh + 0.16, 0.08, 0, 0, C.woodLo);
    box(w, hh, 0.12, 0, 0, C.amber, 1);
    box(0.05, hh, 0.15, 0, 0, C.woodLo);
    box(w, 0.05, 0.15, 0, 0, C.woodLo);
    box(w + 0.3, 0.07, 0.24, 0, -hh / 2 - 0.1, C.woodHi);
  };
  win(0.95, F + 1.38, D / 2 + 0.01, true);
  for (const sx of [-1, 1]) win(sx * (W / 2 + 0.01), F + 1.38, 0.1, false);
  // the chimney
  parts.push(part(P.box(0.62, 1.9, 0.62), null, { x: 1.15, y: eave + 0.85, z: -0.55, grad: [C.rockLo, C.rockHi, eave, eave + 1.9], mark: 0.3 }));
  const still = parts.map((p) => settle(p));
  // the snow on the roof: a slab over both pitches, rounded at the ridge,
  // a lip at each eave
  const s = (D + 0.9) / 2;
  const sh = new THREE.Shape();
  const pts = [[-s - 0.06, 0.0], [-s - 0.14, 0.2], [-s * 0.5, ROOF * 0.5 + 0.26], [-0.3, ROOF + 0.2], [0.3, ROOF + 0.2], [s * 0.5, ROOF * 0.5 + 0.26], [s + 0.14, 0.2], [s + 0.06, 0.0]];
  sh.moveTo(pts[0][0], pts[0][1]);
  for (const [px, py] of pts.slice(1)) sh.lineTo(px, py);
  sh.closePath();
  const roofSnow = part(P.extrude(sh, W + 0.9, 1), null, { y: eave - 0.02, ry: Math.PI / 2, grad: [C.snowLo, C.snow, eave, eave + 0.5] });
  still.push(settle(roofSnow, (x, y, z) => {
    const up = sstep(eave, eave + ROOF, y);
    return [x * 0.03, 0.34 + 0.5 * up, z * 0.1 * (1 - up)];
  }));
  still.push(settle(snowCap({ r: 0.4, h: 0.2, x: 1.15, y: eave + 1.78, z: -0.55, seg: 6 }), () => [0, 0.22, 0]));
  // icicles along the eave toward the route
  const rnd = seeded(3);
  const ice = [];
  for (let i = 0; i < 7; i++) icicle(ice, -W / 2 + 0.3 + i * 0.6 + rnd() * 0.2, eave + 0.02, s + 0.04, 0.25 + rnd() * 0.4, 0.05);
  still.push(...ice.map((g) => settle(g, () => [0, 0.34, 0.03])));
  // the drifts against it: low at first (the steps stand clear), then over
  // the steps and up the walls
  const heap = (x, z, rx, rz, h, up) => still.push(settle(snowCap({ r: 1, h, x, y: 0, z, sx: rx, sz: rz, seg: 10 }), swell(x, z, up, 0.28)));
  heap(1.0, D / 2 + 0.5, 1.9, 1.0, 0.34, 3.6);
  heap(-1.1, D / 2 + 1.0, 1.5, 0.9, 0.14, 7.5);
  heap(-W / 2 - 0.5, 0.2, 1.0, 2.0, 0.4, 3.4);
  heap(W / 2 + 0.6, -0.2, 1.1, 2.1, 0.45, 3.2);
  heap(0, -D / 2 - 0.5, 2.4, 1.0, 0.5, 3.0);
  return merge(still);
}

// --- obstacles ----------------------------------------------------------------------
// (None of these takes any snow as it settles: what you see is what's there.)
//
// L · A fallen trunk across the lane, snow lying thick along it: dark bark,
// pale sawn ends, a stub of a branch.
function trunkGeo() {
  const r = 0.36;
  const half = 1.02;
  const parts = [
    asBark(part(P.cyl(r, r * 1.08, half * 2, 12), null, { y: r, rz: Math.PI / 2, grad: [C.barkLo, C.barkHi, -0.1, r * 2] }), (x) => x, 0.45),
    part(P.sphere(1, 12, 6), null, { y: r * 1.74, sx: half * 0.94, sy: 0.19, sz: r * 0.92, grad: [C.snowLo, C.snow, r * 1.55, r * 1.95] }),
    asBark(part(P.cyl(0.07, 0.1, 0.5, 6), C.bark, { x: 0.35, y: r * 1.5, z: 0.22, rx: 0.9 })),
  ];
  for (const s of [-1, 1]) {
    const rr = s < 0 ? r : r * 1.08;
    parts.push(part(P.cyl(rr * 0.9, rr * 0.9, 0.02, 14), C.sawn, { x: s * (half + 0.006), y: r, rz: Math.PI / 2, mark: 0.3, outline: 0 }));
    parts.push(snowCap({ r: 0.42, h: 0.18, x: s * (half - 0.1), z: 0.36, seg: 7 }));
  }
  return merge(parts).translate(0, 0, -0.45);
}

// L · A low ridge of ice the pack has thrown up: shards of it standing on
// edge, deep blue, a little snow drifted against their feet.
function shardsGeo(half, seed, n) {
  const rnd = seeded(seed);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const x = -half + ((half * 2) * (i + 0.5)) / n + (rnd() - 0.5) * 0.12;
    const h = 0.68 + rnd() * 0.26;
    const g = flat(P.cone(0.34 + rnd() * 0.1, h, 4));
    // (deep cobalt, only their tips pale: dark against the snow and the ice)
    const p = part(g, null, { x, y: h / 2 - 0.02, z: (rnd() - 0.5) * 0.3, sx: 0.85, sz: 0.55 + rnd() * 0.3, ry: rnd() * 1.2, rz: (rnd() - 0.5) * 0.4, grad: [C.iceDark, C.iceLo, 0.05, 0.95], mark: 0.2 });
    parts.push(p);
  }
  // a dark spine of ice along their feet, binding them into one ridge
  parts.push(part(flat(P.box(half * 2 + 0.2, 0.3, 0.55, 6, 1, 1)), null, { y: 0.13, grad: [C.iceDark, C.iceDeep, 0, 0.3], mark: 0.2 }));
  for (let i = 0; i < Math.ceil(n / 2); i++) parts.push(snowCap({ r: 0.5, h: 0.13, x: -half + ((half * 2) * (i + 0.5)) / Math.ceil(n / 2), z: 0.34, sx: 1.3, seg: 7 }));
  return merge(parts);
}
const ridgeGeo = () => shardsGeo(0.95, 7, 6).translate(0, 0, -0.45);

// LW · A glacial fissure right across the route (jump it). Its mouth is a
// flat band the shader looks down into (toon option crevasse: the far wall
// falling away from pale ice at the lip to blue-black far down); along both
// lips, broken blocks of deep-blue ice — low on the near side so the eye
// goes over them into the crack, higher on the far side, a dark edge for it
// to show against — and a thin line of snow.
const FISSURE_W = 2.0;
function fissureMouth(x0, x1, seed) {
  const rnd = seeded(seed);
  const n = Math.round((x1 - x0) / 0.5);
  const near = [];
  const far = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const k = Math.sin(i * 1.3 + seed) * 0.5 + 0.5;
    near.push([x, 0.1 + k * 0.16 + rnd() * 0.06]);
    far.push([x, FISSURE_W - 0.1 - (1 - k) * 0.16 - rnd() * 0.06]);
  }
  const s = new THREE.Shape();
  s.moveTo(near[0][0], near[0][1]);
  for (const [x, y] of near.slice(1)) s.lineTo(x, y);
  for (const [x, y] of far.reverse()) s.lineTo(x, y);
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 1);
  g.rotateX(-Math.PI / 2);
  return merge([part(g, '#ffffff', { y: 0.02, mark: 0.9, outline: 0 })]);
}
function fissureLipsGeo(seed) {
  const rnd = seeded(seed);
  const parts = [];
  const half = 6.4;
  for (const [z, lo, hi] of [[0.02, 0.1, 0.2], [FISSURE_W + 0.02, 0.26, 0.44]]) {
    for (let x = -half; x < half; x += 0.5 + rnd() * 0.35) {
      const h = lo + rnd() * (hi - lo);
      const w = 0.4 + rnd() * 0.3;
      const g = flat(P.box(w, h, 0.3 + rnd() * 0.16));
      parts.push(part(g, null, { x, y: h / 2 - 0.02, z: -z, ry: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.3, grad: [C.iceDark, C.iceLo, 0, 0.5], mark: 0.2 }));
      if (rnd() < 0.55) parts.push(part(P.sphere(1, 7, 4), C.snow, { x, y: h - 0.01, z: -z, sx: w * 0.55, sy: 0.05, sz: 0.2, outline: 0.5 }));
    }
  }
  return merge(parts);
}

// H · A bough under snow, come down across two broken snags: the limb and
// its sprays of needles all above the duck line, clear floor beneath.
function boughGeo() {
  const parts = [];
  const y = D + 0.3;
  for (const s of [-1, 1]) {
    const h = y + 0.75 + (s > 0 ? 0.5 : 0);
    parts.push(asBark(part(P.cyl(0.12, 0.2, h, 7), null, { x: s * 0.98, y: h / 2, rz: -s * 0.05, grad: [C.barkLo, C.barkHi, 0, h] })));
    parts.push(part(P.cone(0.12, 0.3, 5), C.sawn, { x: s * 0.98 - s * 0.05 * h * 0.5, y: h + 0.12, rz: s * 0.3, outline: 0.6 }));
    parts.push(snowCap({ r: 0.4, h: 0.16, x: s * 1.0, z: 0.1, seg: 7 }));
  }
  parts.push(asBark(part(P.cyl(0.1, 0.13, 2.3, 8), null, { y: y + 0.02, rz: Math.PI / 2, grad: [C.barkLo, C.bark, y - 0.15, y + 0.2] }), (x) => x, 0.4));
  // sprays of needles lying along it (nothing of them below the limb)
  for (let i = 0; i < 5; i++) {
    const x = -0.8 + i * 0.4;
    parts.push(part(P.sphere(1, 7, 4), null, { x, y: y + 0.2, z: i % 2 ? 0.16 : -0.14, sx: 0.34, sy: 0.14, sz: 0.5, ry: (i % 2 ? 0.5 : -0.5), grad: [C.firLo, C.firHi, y, y + 0.4], mark: 0.6 }));
  }
  // and the snow on top of it all
  parts.push(part(P.sphere(1, 12, 5), null, { y: y + 0.42, sx: 1.02, sy: 0.2, sz: 0.5, grad: [C.snowLo, C.snow, y + 0.26, y + 0.6] }));
  return merge(parts).translate(0, 0, -0.3);
}

// H · A ledge of ice across two piers, its flat underside on the duck line,
// snow on top.
function ledgeGeo(half, piers) {
  const parts = [];
  const u = D + 0.05;
  for (const x of piers) {
    const p = part(flat(P.cyl(0.2, 0.3, u + 0.1, 6, 2)), null, { x, y: (u + 0.1) / 2, ry: x, grad: [C.iceDark, C.iceLo, 0, u], mark: 0.2 });
    parts.push(p);
    parts.push(snowCap({ r: 0.42, h: 0.14, x, z: 0.08, seg: 7 }));
  }
  // the slab: level beneath, broken along the top
  const g = P.box(half * 2 + 0.7, 0.55, 0.95, Math.max(3, Math.round(half * 2.2)), 1, 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + 0.22 * hash2(Math.round(pos.getX(i) * 4), Math.round(pos.getZ(i) * 4)));
  }
  parts.push(part(flat(g), null, { y: u + 0.275, grad: [C.iceDeep, C.ice, u, u + 0.8], mark: 0.2 }));
  // (a dark line along its underside, so the gap beneath it reads)
  parts.push(part(P.box(half * 2 + 0.72, 0.06, 0.97), C.iceDark, { y: u + 0.03, outline: 0 }));
  parts.push(part(P.sphere(1, 12, 5), null, { y: u + 0.72, sx: half + 0.3, sy: 0.17, sz: 0.5, grad: [C.snowLo, C.snow, u + 0.6, u + 0.9] }));
  return merge(parts).translate(0, 0, -0.45);
}

// HW · A low arch of ice across the whole route, a pier out past either
// edge of it: level along its underside, on the duck line, so the opening
// is a clean slot from one edge to the other; humped on top, under snow.
function lowArchGeo() {
  const half = 4.2;
  const u = D + 0.06;
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(flat(P.cyl(0.42, 0.62, u + 0.5, 7, 2)), null, { x: s * (half + 0.25), y: (u + 0.5) / 2, ry: s, grad: [C.iceDark, C.iceLo, 0, u + 0.5], mark: 0.2 }));
    parts.push(snowCap({ r: 0.8, h: 0.2, x: s * (half + 0.4), z: 0.1, seg: 8 }));
  }
  const w = half + 0.75;
  const crown = (x) => u + 0.5 + 0.85 * Math.cos((Math.PI * x) / (2 * w));
  const N = 14;
  const sh = new THREE.Shape();
  sh.moveTo(-w, u);
  sh.lineTo(w, u);
  for (let i = N; i >= 0; i--) {
    const x = -w + (2 * w * i) / N;
    sh.lineTo(x, crown(x) + 0.12 * (hash2(i, 3) - 0.5));
  }
  sh.closePath();
  const body = part(flat(P.extrude(sh, 1.0, 1)), '#ffffff', { mark: 0.2 });
  paint(body, (x, y) => iceAt(clamp01((y - u) / 1.5) * 0.75 + 0.1, 0.3));
  parts.push(body);
  parts.push(part(P.box(w * 2 + 0.02, 0.07, 1.02), C.iceDark, { y: u + 0.035, outline: 0 }));
  // the snow along its back
  const sn = new THREE.Shape();
  sn.moveTo(-w + 0.3, crown(-w + 0.3) - 0.05);
  for (let i = 0; i <= N; i++) {
    const x = -w + 0.3 + ((2 * w - 0.6) * i) / N;
    sn.lineTo(x, crown(x) + 0.2 + 0.05 * Math.sin(i * 1.7));
  }
  sn.lineTo(w - 0.3, crown(w - 0.3) - 0.05);
  sn.closePath();
  parts.push(part(P.extrude(sn, 0.9, 1), null, { grad: [C.snowLo, C.snow, u + 0.5, u + 1.5] }));
  return merge(parts).translate(0, 0, -0.5);
}

// W · A pillar of ice taller than you, snow on its head.
function pillarGeo(seed) {
  const h = 4.3;
  const g = P.cyl(0.52, 0.84, h, 7, 4);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + h / 2;
    if (Math.hypot(pos.getX(i), pos.getZ(i)) < 1e-3) continue;
    const a = Math.round((Math.atan2(pos.getZ(i), pos.getX(i)) / TAU) * 7);
    const k = 0.86 + 0.3 * hash2(a + seed, Math.round(y * 2));
    pos.setXYZ(i, pos.getX(i) * k, y - h / 2, pos.getZ(i) * k);
  }
  const body = part(flat(g), '#ffffff', { y: h / 2, mark: 0.2 });
  paint(body, (x, y) => iceAt(clamp01(y / h) * 0.7, 0.35));
  return merge([body, snowCap({ r: 0.62, h: 0.42, y: h - 0.08, seg: 8 }), snowCap({ r: 1.0, h: 0.2, z: 0.1, seg: 8 })]).translate(0, 0, -0.75);
}

// W · A great boulder of dark slate, snow on its shoulders.
function boulderWallGeo() {
  return merge([
    boulder({ r: 1.02, sx: 0.98, sy: 1.25, sz: 0.85, seed: 11, detail: 1 }),
    boulder({ r: 0.55, sy: 0.9, seed: 4, x: -0.5, z: 0.5 }),
    snowCap({ r: 0.74, h: 0.34, x: 0.05, y: 2.2, sz: 0.9, seg: 9 }),
    snowCap({ r: 0.36, h: 0.16, x: -0.5, y: 0.82, z: 0.5, seg: 7 }),
    snowCap({ r: 1.15, h: 0.2, z: 0.3, sz: 0.7, seg: 9 }),
  ]).translate(0, 0, -0.85);
}

// W · A supply sled left where it stopped: long runners turned up at the
// nose, a deck, and a load lashed on high — crates, a barrel, a bedroll
// under a canvas sheet — skis and poles standing in the back of it, a cold
// lantern on its stanchion; snow on all of it.
function sledGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(P.box(0.08, 0.09, 2.0), C.woodLo, { x: s * 0.6, y: 0.05 }));
    parts.push(part(P.box(0.08, 0.09, 0.5), C.woodLo, { x: s * 0.6, y: 0.2, z: -1.16, rx: -0.75 }));
    for (const z of [-0.6, 0.1, 0.75]) parts.push(part(P.box(0.07, 0.3, 0.07), C.wood, { x: s * 0.6, y: 0.24, z }));
  }
  parts.push(part(P.box(1.34, 0.08, 1.9), C.wood, { y: 0.42 }));
  parts.push(part(P.box(1.34, 0.07, 0.07), C.woodLo, { y: 0.4, z: -1.3 }));
  // the load
  parts.push(part(P.box(1.12, 0.62, 0.86), null, { y: 0.77, z: 0.38, grad: [C.woodLo, C.crate, 0.46, 1.1] }));
  parts.push(part(P.box(1.16, 0.05, 0.9), C.woodLo, { y: 0.78, z: 0.38, outline: 0 }));
  parts.push(part(P.box(0.8, 0.5, 0.64), null, { x: -0.1, y: 1.33, z: 0.32, ry: 0.12, grad: [C.woodLo, C.crate, 1.08, 1.6] }));
  parts.push(part(P.cyl(0.32, 0.3, 0.78, 10), null, { x: 0.24, y: 0.85, z: -0.5, grad: [C.woodLo, C.wood, 0.46, 1.24] }));
  for (const y of [0.62, 1.08]) parts.push(part(P.torus(0.325, 0.025, 4, 12), C.iron, { x: 0.24, y, z: -0.5, rx: Math.PI / 2, outline: 0.4 }));
  parts.push(part(P.cyl(0.17, 0.17, 0.9, 8), '#7a6a8a', { x: -0.3, y: 0.63, z: -0.5, rz: Math.PI / 2 }));
  // the sheet over it, and the ropes
  parts.push(part(P.sphere(1, 10, 6), null, { x: -0.06, y: 1.52, z: 0.3, sx: 0.6, sy: 0.34, sz: 0.52, grad: [C.woodLo, C.canvas, 1.2, 1.8] }));
  for (const z of [0.1, 0.62]) parts.push(part(P.box(1.2, 1.24, 0.03), C.rope, { y: 1.06, z, outline: 0 }));
  // skis and poles standing in the back, the lantern
  for (const [x, h, c] of [[-0.5, 2.5, '#8a5a3a'], [-0.4, 2.42, '#8a5a3a'], [0.5, 2.1, C.iron]]) parts.push(part(P.box(0.08, h, 0.03), c, { x, y: 0.46 + h / 2, z: -0.9, rz: x * 0.06 }));
  parts.push(part(P.box(0.05, 1.5, 0.05), C.woodLo, { x: 0.62, y: 1.2, z: 0.9 }));
  parts.push(part(P.box(0.2, 0.26, 0.2), C.iron, { x: 0.62, y: 1.9, z: 0.9 }));
  parts.push(part(P.box(0.13, 0.15, 0.13), '#8ea0b4', { x: 0.62, y: 1.9, z: 0.9, outline: 0 }));
  // the snow on it, and drifted against it
  parts.push(snowCap({ r: 0.62, h: 0.2, x: -0.06, y: 1.8, z: 0.3, sz: 0.85, seg: 8 }));
  parts.push(snowCap({ r: 0.34, h: 0.12, x: 0.24, y: 1.23, z: -0.5, seg: 7 }));
  parts.push(snowCap({ r: 0.2, h: 0.1, x: 0.62, y: 2.02, z: 0.9, seg: 6 }));
  parts.push(snowCap({ r: 1.0, h: 0.3, x: -0.5, z: 0.1, sz: 1.5, seg: 9 }));
  return merge(parts).translate(0, 0, -1.3);
}

// --- the doorway in ------------------------------------------------------------------
// An arch of glacier ice, snow heaped along its back and icicles let down
// over its face (never into the opening), shoulders of ice either side that
// hide what lies beyond.
const OPENING = { halfW: 4.5, rectH: 6.8, arch: true };
const GATE_DEPTH = 1.8;
function gateGeo() {
  const parts = [...gateFrameParts(OPENING, { thick: 1.5, depth: GATE_DEPTH, color: C.ice, mark: 0.2 })];
  paint(parts[0], (x, y) => iceAt(clamp01(y / 13) * 0.8 + 0.1, 0.25));
  const top = gateTop(OPENING);
  const R = OPENING.halfW + 1.5;
  const rnd = seeded(5);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.08 + (0.84 * i) / 8);
    parts.push(snowCap({ r: 1.5 + rnd() * 0.4, h: 0.7 + 0.4 * Math.sin(a), x: Math.cos(a) * (R - 0.1), y: OPENING.rectH + Math.sin(a) * (R - 0.1) - 0.25, sz: 1.0, seg: 8 }));
  }
  for (let i = 0; i < 15; i++) {
    const a = Math.PI * (0.12 + (0.76 * i) / 14);
    icicle(parts, Math.cos(a) * (R - 0.15), OPENING.rectH + Math.sin(a) * (R - 0.15) + 0.1, GATE_DEPTH / 2 + 0.05, 0.4 + rnd() * 0.8, 0.09 + rnd() * 0.05);
  }
  for (const s of [-1, 1]) {
    // the shoulders: great blocks of the glacier, stepping down away from it
    for (let i = 0; i < 4; i++) {
      const w = 9 + rnd() * 3;
      const h = top + 2 - i * 1.6 + rnd() * 2;
      const x = s * (OPENING.halfW + 1.3 + w / 2 + i * 8.5);
      const g = P.box(w, h, 5, 3, 3, 1);
      const pos = g.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        const jx = hash2(j + i * 31, 5 + (s > 0 ? 9 : 0));
        if (pos.getZ(j) > 0) pos.setZ(j, pos.getZ(j) + (jx - 0.5) * 1.6 - (pos.getY(j) + h / 2) * 0.1);
        if (pos.getY(j) > h * 0.4) pos.setY(j, pos.getY(j) + (jx - 0.5) * 1.8);
      }
      const b = part(flat(g), '#ffffff', { x, y: h / 2, z: -1.5, mark: 0.2 });
      paint(b, (px, py) => iceAt(clamp01(py / (top + 3)) * 0.85, 0.3 + 0.3 * hash2(Math.round(px), i)));
      parts.push(b);
      parts.push(snowCap({ r: w * 0.5, h: 1.0, x, y: h - 0.5, z: -1.6, sz: 0.55, seg: 8 }));
    }
    parts.push(snowCap({ r: 2.4, h: 0.6, x: s * (OPENING.halfW + 3), z: 1.0, seg: 9 }));
  }
  return merge(parts);
}

// The door into the Frostbound Pass: frosted planks banded in dark iron, and
// across the two leaves (half on each) a range of jagged peaks in pale ice,
// snow on their heads, a low sun the colour of a peach behind them; hoar
// frost creeping up from the sill.
function frostLeaf({ W, H, z, f }) {
  const out = [];
  const at = (t) => z + (f * t) / 2;
  for (let y = 0.9; y < H + 1; y += 0.9) out.push(part(P.box(W - 0.2, 0.05, 0.04), '#8a9aa8', { x: W / 2, y, z: at(0.04), tint: 1, outline: 0 }));
  for (const y of [1.3, H - 0.4]) out.push(part(P.box(W - 0.15, 0.3, 0.07), C.iron, { x: W / 2, y, z: at(0.07), outline: 0.4 }));
  // the low sun, half of it on each leaf
  out.push(part(P.cyl(1.25, 1.25, 0.05, 20, 1, false, Math.PI, Math.PI), '#ffd9c0', { x: W, y: 4.5, z: at(0.05), rx: Math.PI / 2, emit: 0.6, outline: 0 }));
  // the peaks, rising toward the meeting edge
  const peaks = [[W, 5.6, 1.5], [W - 1.25, 4.5, 1.2], [W - 2.45, 3.7, 1.15], [W - 3.5, 3.0, 0.9]];
  for (const [x, top, hw] of peaks) {
    const base = 1.5;
    const tri = (w, y0, y1, c, t) => {
      const s = new THREE.Shape();
      s.moveTo(x - w, y0);
      s.lineTo(Math.min(W, x + w), y0);
      if (x + w > W) s.lineTo(W, y0 + (y1 - y0) * (1 - (W - x) / w));
      s.lineTo(x, y1);
      s.closePath();
      out.push(part(P.extrude(s, 0.08, 1), c, { z: at(t), outline: 0.4 }));
    };
    tri(hw, base, top, '#7fb6dc', 0.1);
    tri(hw * 0.42, top - (top - base) * 0.42, top, '#f4f9ff', 0.14);
  }
  // hoar frost up from the sill
  for (let i = 0; i < 9; i++) {
    const x = 0.3 + ((W - 0.6) * i) / 8;
    out.push(part(P.cone(0.2, 0.5 + 0.5 * hash2(i, 2), 4), '#f0f8ff', { x, y: 0.25 + 0.25 * hash2(i, 2), z: at(0.06), sz: 0.2, outline: 0 }));
  }
  out.push(part(P.torus(0.3, 0.06, 6, 14), C.iron, { x: W - 0.5, y: 2.6, z: at(0.2) }));
  return out;
}

// --- gems -------------------------------------------------------------------------
// Fire in the ice: the one warm colour in the pass, and it carries from one
// end of a white canyon to the other. Fire opal above all, rough, lit from
// inside and flecked with gold; sunstone, its plates glittering with copper;
// spessartine, a garnet's ball of rhombs in mandarin orange; wulfenite, thin
// square tablets grown through each other; and honey calcite, a cleaved
// rhomb. The crown: a great fire opal in a ring of ice crystals.
const OPAL = { mottle: 0.6, second: '#ffe36a', speckle: 0.3, rough: 0.12, glints: 1.5, scale: 8 };
function emberInIce() {
  const out = [crystal(nugget({ r: [0.25, 0.2, 0.22], faces: 20, spread: 0.1, chips: 2, seed: 23 }), { y: 0.04 })];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    out.push(stone(crystalPoint({ r: 0.05, len: 0.26 + 0.07 * (i % 2), tip: 0.1, sides: 6, seed: 31 + i }), '#d8f6ff', { x: Math.cos(a) * 0.27, y: -0.27, z: Math.sin(a) * 0.27, rz: -Math.cos(a) * 0.5, rx: Math.sin(a) * 0.5 }));
  }
  return out;
}
const GEM = {
  name: 'fire opal',
  color: '#ff7a1f',
  stones: [
    {
      name: 'fire opal',
      weight: 3,
      tints: ['#ff6a14', '#ff8424', '#f25a10'],
      parts: () => [crystal(nugget({ r: [0.23, 0.17, 0.2], faces: 22, spread: 0.1, chips: 2, seed: 11 }), { rz: 0.25 })],
      texture: OPAL,
    },
    {
      // aventurescent: flecks of copper glittering inside it
      name: 'sunstone',
      weight: 1.5,
      tints: ['#ff9a4a', '#f58a3c', '#ffab5e'],
      parts: () => [crystal(tabular({ r: 0.21, t: 0.1, seed: 5 }), { rx: FACE, rz: 0.3 })],
      texture: { speckle: 0.65, second: '#ffe0b0', opaque: 0.3, glints: 1.7, scale: 11 },
    },
    {
      name: 'spessartine',
      weight: 1.4,
      tints: ['#f4621a', '#e8500e', '#ff7426'],
      parts: () => [crystal(dodecahedron({ r: 0.19, seed: 7 }))],
      texture: { rough: 0.08, glints: 1.5 },
    },
    {
      name: 'wulfenite',
      weight: 1,
      tints: ['#ff8a1c', '#f77c10', '#ff9a30'],
      parts: () => [
        crystal(cube({ s: 0.17, seed: 3 }), { sz: 0.2, rz: 0.5, rx: 0.2 }),
        crystal(cube({ s: 0.13, seed: 9 }), { sx: 0.22, x: 0.05, y: 0.03, rz: -0.3, ry: 0.4 }),
      ],
      texture: { rough: 0.06, glints: 1.6, bands: 0.2, bandFreq: 30, second: '#ffd27a' },
    },
    {
      name: 'honey calcite',
      weight: 1,
      tints: ['#ffb45a', '#f7a548', '#ffc070'],
      parts: () => [crystal(cube({ s: 0.15, jitter: 0.12, chips: 2, seed: 14 }), { sx: 1.2, rz: 0.55, rx: 0.4 })],
      texture: { mottle: 0.35, bands: 0.25, bandFreq: 18, opaque: 0.35, second: '#ffe6bc', glints: 1.1 },
    },
  ],
  crown: {
    name: 'fire opal in a ring of ice',
    tints: ['#ff6a14', '#ff8424'],
    parts: () => emberInIce(),
    texture: OPAL,
  },
  motion: [0.9, 1.3, 0.09, 0.14],
  look: [0.86, 1.3, 0.35, 0.45],
  glow: 0.7,
  pool: 0.3,
};

const FIR_TINTS = [[1, 1, 1], [0.9, 1.02, 1.06], [1.06, 1.04, 0.92]];

// Nothing beside the route ever reaches into it: everything is stood so far
// out that, at the size it grows to once the snow lies deepest (its boughs
// spread, its drift swollen), its nearest edge is still beyond EDGE, out on
// the bank. reach: how far each one spreads from where it stands, at scale 1.
const EDGE = 4.5;
// (measured from the geometry, turned every way it's stood, with the snow
// at its deepest)
const REACH = { fir: 2.25, firB: 2.8, firYoung: 1.5, rock: 1.05, rockB: 1.45, floe: 1.8, drift: 3.05, driftLong: 3.3 };
const standOff = (name, sc, more = 0) => EDGE + REACH[name] * sc + more;

export default {
  id: 'frost',
  name: 'The Frostbound Pass',
  doorColor: '#63cfe6',
  gate: { opening: OPENING, depth: GATE_DEPTH },
  gem: GEM,
  // how deep the snow lies, by visit and by how far through it you are (see
  // Game.updateSnow)
  snowAt,
  // The dream is held back here (see holdBack in game/dream.js), by visit:
  // [how much of its shape warps come through, how much of its colour]. The
  // first time, none of it; the second, the faintest stir far off; then by
  // degrees.
  dream: [[0, 0], [0.22, 0], [0.55, 0.4], [0.8, 0.75], [1, 1]],
  env: {
    // the snow (ground pattern 15, toon options banks and snow): the share
    // of the flakes in the air under a dusting and at its deepest; how far
    // the dream lifts far drifts apart
    // (a share of the usual count of motes: snowing harder than anything
    // floats in any other world)
    snow: { fall: [1.7, 3.0], lift: 0 },
    sky: ['#55b4de', '#ffe6d4', '#c2dcf0'],
    bloom: ['#7fe3f2', '#ffffff', '#ffd9c2'],
    // a low sun ahead and a little to the right, pale peach
    sun: { dir: [0.3, 0.2, -1], glow: '#ffdcc4', disc: '#fff7ee', size: 0.034 },
    stars: 0,
    // (range: jagged mountains along the horizon, far beyond everything)
    skyFx: { rays: 0.22, clouds: 0.45, range: 0.07 },
    // cold clear light from ahead and above: lavender shade, the faintest
    // peach on what faces the sun
    light: { dir: [0.42, 0.62, -0.5], shadow: [0.69, 0.72, 0.96], hi: [1.06, 1.01, 0.96], soft: 0.09, wrap: 0.2, hiAmt: 0.5, lift: 1 },
    rim: [0.72, 0.92, 1.0, 0.3],
    // spindrift blowing low over the snow
    mist: { color: '#edf4ff', amount: 0.36, top: 1.4, fade: 3.5, near: 30, far: 130 },
    grade: { sat: 1.07, contrast: 1.03, vignette: 0.24, exposure: 0.99, tint: '#27377a' },
    ink: '#21407c',
    fog: [75, 250],
    ground: [C.snow, '#a8e3ee', '#2d83cc'],
    shadowDecal: [0.68, 0.72, 0.95],
    cast: [-0.28, 0.42],
    glowGain: 0.75,
    pool: '#ffbe76',
    // (what's kicked up off this ground is powder)
    dustPale: 0.92,
    // flurries, falling aslant: flakes laid over the picture, not light
    particles: { color: '#ffffff', size: 4.4, drift: [0.45, -1.15, 0.15], opacity: 0.95, flake: 1 },
  },

  visits: [
    // a snow sky: the light gone soft and flat, the fall thicker — and here
    // and there a flake that hangs where it is
    {
      env: {
        snow: { lift: 0.07 },
        sky: ['#84b6d8', '#f8e2d8', '#c8d8ea'],
        sun: { glow: '#ffd6c0' },
        skyFx: { rays: 0.1, clouds: 0.75 },
        light: { shadow: [0.71, 0.73, 0.95], soft: 0.13, hiAmt: 0.4 },
        mist: { amount: 0.44 },
        particles: { size: 4.7, drift: [0.5, -1.25, 0.15] },
        particles2: { color: '#f4f8ff', size: 3.0, drift: [0, 0, 0], opacity: 0.4, still: 1, flake: 1 },
      },
    },
    // the blue hour, snowing hard: the windows bright, flakes hanging still
    // all through the air, and far off the drifts beginning to come apart
    {
      env: {
        snow: { lift: 0.5 },
        sky: ['#3d62aa', '#f2c6b8', '#93a8d2'],
        sun: { dir: [0.34, 0.11, -1], glow: '#ffc4a4', disc: '#ffeede' },
        skyFx: { rays: 0.16, clouds: 0.6 },
        light: { shadow: [0.58, 0.63, 0.93], hi: [1.05, 0.98, 0.94], soft: 0.1, hiAmt: 0.45 },
        rim: [0.7, 0.86, 1.0, 0.34],
        mist: { color: '#dfe6fb', amount: 0.48 },
        grade: { exposure: 0.95, vignette: 0.32, tint: '#1a2462' },
        ground: ['#eef3ff', '#9ad6e8', '#2a76c4'],
        glowGain: 1.15,
        particles: { size: 5.0, drift: [0.55, -1.3, 0.15] },
        particles2: { color: '#ffffff', size: 4.2, drift: [0, 0, 0], opacity: 0.8, still: 1, flake: 1 },
      },
    },
    // ...and then the hanging flakes begin to rise: snow falling up through
    // the snow that's falling down; the drifts lift well clear
    {
      env: {
        snow: { lift: 0.85 },
        sky: ['#2c4a96', '#e8b4b6', '#8496cc'],
        skyFx: { clouds: 0.5, aurora: 0.12 },
        glowGain: 1.3,
        particles2: { color: '#ffffff', size: 3.6, drift: [-0.2, 0.95, 0.1], opacity: 0.85, still: 0 },
      },
    },
    { env: { snow: { lift: 1 }, trip: [0.08, 0.3, 0.12], particles2: { drift: [-0.3, 1.5, 0.1] } } },
  ],

  build(b) {
    const ICE = [1, 0.9, 0.9];
    b.ground('ground', snowStrip(), 15, { banks: true, cap: 24 });
    // the glacier: three stretches of wall that stand in any order, the
    // headlands their runs end in (and, smaller, icebergs out on the field),
    // frozen falls, the great arch
    const CLIFF = { cap: 44, anim: [2, 70, 140, 0], ink: 0.06, ice: ICE, snow: [0.72, 0.22, 0.22, 1] };
    b.toon('cliffA', cliffGeo(3, 0.1), CLIFF);
    b.toon('cliffB', cliffGeo(11, 0.3), CLIFF);
    b.toon('cliffC', cliffGeo(29, -0.06), CLIFF);
    b.toon('headland', headlandGeo(5), { cap: 24, anim: [4, 80, 150, 40], dream: 0, ink: 0.06, ice: ICE, snow: [0.72, 0.22, 0.22, 1] });
    b.toon('berg', headlandGeo(17, 16, 6.5), { cap: 40, anim: 'liftFar', ink: 0.05, ice: ICE, snow: [0.7, 0.2, 0.22, 1] });
    b.toon('fall', fallGeo(7), { cap: 24, anim: [2, 70, 140, 0], ink: 0.05, ice: [0.25, 1, 1], snow: [0.85, 0.5, 0.15, 0.8] });
    b.toon('arch', archGeo(), { cap: 6, anim: 'popLate', ink: 0.07, ice: ICE, snow: [0.74, 0.3, 0.22, 1] });
    b.toon('peak', peakGeo(4), { cap: 30, anim: 'liftFar', ink: 0 });
    b.toon('peakB', peakGeo(19), { cap: 30, anim: 'liftFar', ink: 0 });
    // by the route
    const SOFT = [0.86, 0.5, 0.2, 1];
    b.toon('fir', merge(firParts({ h: 9, tiers: 5, r: 2.3, seed: 3 })), { cap: 150, anim: 'pop', ink: 0.045, marks: [2.4, 2], bark: true, snow: SOFT });
    b.toon('firB', merge(firParts({ h: 12.5, tiers: 6, r: 2.9, seed: 8 })), { cap: 110, anim: 'pop', ink: 0.045, marks: [2.4, 2], bark: true, snow: SOFT });
    b.toon('firYoung', merge(firParts({ h: 4.6, tiers: 4, r: 1.5, seed: 14, seg: 7 })), { cap: 110, anim: 'pop', ink: 0.04, marks: [2, 2], bark: true, snow: SOFT });
    b.toon('rock', rockGeo(5), { cap: 90, anim: 'pop', ink: 0.045, snow: SOFT });
    b.toon('rockB', rockGeo(12, 1.5), { cap: 60, anim: 'pop', ink: 0.045, snow: SOFT });
    b.toon('drift', driftGeo({ seed: 1 }), { cap: 220, anim: 'pop', ink: 0.035, snow: [0, 0, 1, 0] });
    b.toon('driftLong', driftGeo({ rx: 2.0, h: 0.6, rz: 4.6, seed: 4, up: 2.2, out: 0.3 }), { cap: 160, anim: 'pop', ink: 0.035, snow: [0, 0, 1, 0] });
    b.toon('driftFar', farDriftGeo(2), { cap: 90, anim: 'pop', dream: 0, ink: 0, snow: [0, 0, 1, 0] });
    b.toon('floe', merge(floeParts({ seed: 2 })), { cap: 120, anim: 'pop', ink: 0.045, ice: ICE, snow: [0, 0, 1, 0] });
    b.toon('slab', slabGeo(6), { cap: 70, anim: 'pop', ink: 0.05, ice: ICE, snow: [0.6, 0.2, 0.25, 1] });
    b.toon('fence', fenceGeo(), { cap: 40, anim: 'pop', ink: 0.04, snow: [0, 0, 1, 0] });
    b.toon('cabin', cabinGeo(), { cap: 14, anim: 'pop', ink: 0.045, ice: [0, 1, 1], snow: [0, 0, 1, 0] });
    // later laps: plates of ice adrift over the field, turning
    b.toon('floeAloft', merge(floeParts({ r: 1.6, seed: 9 })), { cap: 40, anim: 'lift', ink: 0.045, ice: ICE, tumble: [0.05, 0.035, 0.3], fly: [0, 0, 1.6, 0.1] });
    b.glow('glow', { cap: 60, anim: 'pop' });
    b.pool('pool', { cap: 30, anim: 'pop' });
    b.shadow('shadow', { cap: 160, anim: 'pop' });

    // obstacles (none of them takes the settling snow)
    b.toon('trunk', trunkGeo(), { cap: 24, anim: 'popEarly', ink: 0.045, marks: [1.6, 1.6], bark: true });
    // (what you play against holds less light than the glacier does: it
    // stays dark enough to stand off the ice and the snow)
    const HAZARD = [1, 0.8, 0.35];
    b.toon('ridge', ridgeGeo(), { cap: 24, anim: 'popEarly', ink: 0.05, ice: HAZARD });
    b.toon('fissureDeep', fissureMouth(-15, 15, 5), { cap: 10, anim: 'popEarly', ink: 0, crevasse: [FISSURE_W, 0.95, 0.18] });
    b.toon('fissureLips', fissureLipsGeo(9), { cap: 10, anim: 'popEarly', ink: 0.04, ice: HAZARD });
    b.toon('bough', boughGeo(), { cap: 24, anim: 'popEarly', ink: 0.045, marks: [2, 2], bark: true });
    b.toon('ledge', ledgeGeo(0.95, [-0.98, 0.98]), { cap: 24, anim: 'popEarly', ink: 0.045, ice: HAZARD });
    b.toon('lowArch', lowArchGeo(), { cap: 10, anim: 'popEarly', ink: 0.05, ice: HAZARD });
    b.toon('pillar', pillarGeo(3), { cap: 24, anim: 'popEarly', ink: 0.05, ice: HAZARD });
    b.toon('pillarB', pillarGeo(8), { cap: 24, anim: 'popEarly', ink: 0.05, ice: HAZARD });
    b.toon('boulderW', boulderWallGeo(), { cap: 24, anim: 'popEarly', ink: 0.05 });
    b.toon('sled', sledGeo(), { cap: 24, anim: 'popEarly', ink: 0.04 });
  },

  // The door INTO this world, in its own style (built into the shared
  // doors, see world.js: it stands in the world before it).
  door(b) {
    b.toon('gateFrame', gateGeo(), { cap: 2, stencil: false, ink: 0.06, ice: [1, 0.7, 0.8] });
    b.toon('gateLeaf', merge(leafParts(OPENING, { color: '#ffffff', deco: frostLeaf })), { cap: 4, stencil: false, anim: [3, 44, 96, 1.95], order: -20, ink: 0.05 });
  },

  obstacles: {
    L: [{ name: 'trunk', len: 0.9 }, { name: 'ridge', len: 0.9 }],
    H: [{ name: 'bough', len: 0.6 }, { name: 'ledge', len: 0.9 }],
    W: [{ name: 'pillar', len: 1.5 }, { name: 'pillarB', len: 1.5 }, { name: 'boulderW', len: 1.7 }, { name: 'sled', len: 2.6 }],
    // (you can't land in it: come down short and it trips you, as water does)
    LW: { name: 'fissureLips', with: ['fissureDeep'], len: FISSURE_W, top: 0.5, wade: true, flat: true },
    HW: { name: 'lowArch', len: 1.0 },
  },

  chunk(ctx) {
    const { rng } = ctx;
    const v = ctx.visit;
    const d = ctx.d0;
    ctx.put('ground', 0, 0, 0, { p0: d % 4096 });
    // how deep the snow will lie by the time the runner gets here (for what's
    // laid out by hand: how many drifts, how much is still showing)
    const run = ctx.index * ctx.L;
    const lv = snowAt(v, run / Math.max(1, run + ctx.toEnd));
    const z = () => rng.float(0, 16);
    const turn = () => rng.float(0, TAU);
    const both = walled(d, -1) && walled(d, 1);
    // a great arch over the route, now and then (never by a doorway)
    if (!ctx.continuation && ctx.index % 9 === 4 && ctx.toEnd > 64) ctx.put('arch', 0, 0, 8, { ry: rng.float(-0.06, 0.06), s: both ? 1 : 0.94 });
    for (const s of [-1, 1]) {
      const wall = walled(d, s);
      if (wall) {
        // the canyon wall, a second rank of it standing higher behind, and a
        // headland wherever a run of it begins or ends
        const ry = s < 0 ? 0 : Math.PI;
        ctx.put(rng.weighted([['cliffA', 1.2], ['cliffB', 1], ['cliffC', 1]]), s * WALL_X, 0, 8, { ry });
        ctx.put(rng.pick(['cliffA', 'cliffB', 'cliffC']), s * (WALL_X + 15), 0, 8, { ry, sx: 1.5, sy: 1.75, sz: 1.06 });
        // (both ranks: neither is ever seen end-on)
        for (const [dz, dd] of [[0, -16], [16, 16]]) {
          if (walled(d + dd, s)) continue;
          ctx.put('headland', s * (WALL_X + 5.5), 0, dz, { ry: turn() });
          ctx.put('headland', s * (WALL_X + 21), 0, dz, { ry: turn(), s: 1.75 });
        }
        if (ctx.index % 4 === (s > 0 ? 1 : 3) && rng.chance(0.55)) ctx.put('fall', s * (WALL_X - 0.6), 0, 8, { ry });
        // drifts banked against its foot
        const n = Math.round(lv * 2 + rng.float(0, 0.9));
        for (let i = 0; i < n; i++) {
          const sc = rng.float(0.9, 1.4);
          ctx.put('driftLong', s * Math.max(standOff('driftLong', sc), rng.float(WALL_X - 3, WALL_X - 1.6)), 0, z(), { ry: rng.float(-0.2, 0.2), s: sc });
        }
      } else {
        // open: the ice field, plates shoved up along its ridges, bergs
        // frozen into it, great drifts, and the mountains beyond
        if (rng.chance(0.55)) ctx.put('slab', s * rng.float(12, 34), 0, z(), { ry: turn(), s: rng.float(0.8, 1.5) });
        if (rng.chance(0.3)) ctx.put('berg', s * rng.float(24, 70), -1, z(), { ry: turn(), s: rng.float(0.6, 1.5) });
        if (rng.chance(0.6)) ctx.put('driftFar', s * rng.float(13, 48), 0, z(), { ry: turn(), s: rng.float(0.7, 1.4), p0: rng.float(0, 6.28) });
        if (rng.chance(0.3)) ctx.put(rng.chance(0.5) ? 'peak' : 'peakB', s * rng.float(120, 200), -4, z(), { ry: turn(), s: rng.float(0.8, 1.35) });
        // later laps: plates of ice adrift over the field
        if (v >= 3 && rng.chance(0.3)) ctx.put('floeAloft', s * rng.float(10, 36), rng.float(4, 13), z(), { ry: turn(), s: rng.float(0.7, 1.4), p0: rng.float(0, 6.28) });
      }
      const inner = wall ? WALL_X - 3.4 : 12;
      // firs by the route, a few of them young
      const firs = wall ? rng.int(1, 2) : rng.chance(0.55) ? 1 : 0;
      for (let i = 0; i < firs; i++) {
        const name = rng.weighted([['fir', 3], ['firB', wall ? 1.6 : 0.8], ['firYoung', 1.6]]);
        const sc = rng.float(0.85, 1.2);
        const x0 = standOff(name, sc);
        ctx.put(name, s * (x0 + rng.float(0, Math.max(0.3, inner - x0))), 0, z(), { ry: turn(), s: sc, c: rng.pick(FIR_TINTS) });
      }
      // rocks at the edge of it (the banks take them by and by)
      if (rng.chance(0.42)) {
        const name = rng.chance(0.7) ? 'rock' : 'rockB';
        const sc = rng.float(0.8, 1.2);
        ctx.put(name, s * standOff(name, sc, rng.float(0, 2.2)), 0, z(), { ry: turn(), s: sc });
      }
      // floes along the route's edge, where the ice still shows
      if (rng.chance(0.5 * (1 - lv))) {
        const sc = rng.float(0.7, 1.1);
        ctx.put('floe', s * standOff('floe', sc, rng.float(0, 1)), -0.12, z(), { ry: turn(), s: sc });
      }
      // drifts: a few at first, heaps of them later, laid along the run
      const drifts = Math.round(lv * 3.2 + rng.float(0, 1.1));
      for (let i = 0; i < drifts; i++) {
        const sc = rng.float(0.8, 1.4);
        const x0 = standOff('drift', sc);
        ctx.put('drift', s * (x0 + rng.float(0, Math.max(0.3, inner + 1.5 - x0))), 0, z(), { ry: rng.float(-0.35, 0.35) + Math.PI / 2 * (s > 0 ? 1 : -1), s: sc });
      }
      // a cabin now and then, its windows lit, a fence along the route by it
      if (ctx.index % 6 === (s > 0 ? 2 : 5) && rng.chance(0.6) && ctx.toEnd > 32) {
        const x = s * (wall ? 8.3 : 9);
        const cz = 8;
        const ry = s < 0 ? Math.PI / 2 : -Math.PI / 2;
        ctx.put('cabin', x, 0, cz, { ry });
        const k = v >= 2 ? 1 : 0.6;
        // (the glass toward the route, and the gable toward the runner)
        ctx.put('glow', x - s * (CABIN.D / 2 + 0.2), 1.8, cz + s * 0.95, { s: 3.2, c: [1.0 * k, 0.72 * k, 0.34 * k] });
        ctx.put('glow', x - s * 0.1, 1.8, cz - CABIN.W / 2 - 0.2, { s: 3.2, c: [1.0 * k, 0.72 * k, 0.34 * k] });
        ctx.put('pool', x - s * (CABIN.D / 2 + 1.6), 0.5, cz + s * 0.95, { sx: 4.4, sz: 3.6, c: [0.5 * k, 0.5 * k, 0.5 * k] });
        ctx.put('fence', s * 5.5, 0, cz, { ry: s * 0.02 });
        ctx.put('fence', s * 5.5, 0, cz + (rng.chance(0.5) ? 4.3 : -4.3), { ry: -s * 0.03 });
      }
    }
  },
};
