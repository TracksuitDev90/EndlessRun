import { RNG, hashSeed } from '../core/rng.js';
import { CONFIG } from '../config.js';

// Candy World's chocolate river: one river for each time through the world,
// winding through the scenery beside the road and now and then right across
// it. It's planned whole the moment anything asks about it (the scenery
// streaming in, or the obstacle director looking ahead), from the run's seed
// and where the world starts, so both always agree on where it runs.
//
// The plan: a few crossings, spaced out along the world; between them the
// river runs alongside the road for a while - close beside it, or winding
// off into the hills and back - and turns in across the road at a slant, its
// banks bowed and wandering, to carry on up the other side. Sometimes it
// comes down toward you on the far side of the hills and swings across in a
// hairpin. A smooth line is drawn through the waypoints, and the river
// follows it the way a stream finds its bed: as a chain of short arcs (each
// PIECE m long), steered after a point a little way along the line ahead,
// never bending tighter than a few metres. Every piece's arc and banks are
// exact (the shader bends it the same way, see render/candy.js), so the
// scenery is kept off the water and the banks, and each crossing's
// footprint in each lane - where the chocolate starts and ends along the
// road, measured from the banks themselves - is what the game tests against:
// a jump you can always make, from a bank you can see.
//
// A crossing that comes out too long to jump in any lane is narrowed; one
// that runs too steeply along the road, or a river that wanders into the
// road anywhere but at a crossing, has the plan drawn again (and after a few
// tries, the river keeps to one side of the road).

export const PIECE = 2.4;
// the most the chocolate may stretch along the road in any lane (m)
const MAX_SPAN = 2.9;
// the top of a crossing for hits: as high as a jump must clear it
export const RIVER_TOP = 0.45;
// leniency: how far inside each bank a lane's hit box starts and ends
const INSET = 0.1;
// how far the bank (its crumbs, its sweets) reaches out past the chocolate
export const BANK = 0.85;
const RMIN = 6.5;

// The banks wander in and out along the river (the same as riverWob in
// render/candy.js).
export function riverWob(u, side) {
  return 0.17 * Math.sin(u * 0.83 + side * 1.7 + 0.3) + 0.1 * Math.sin(u * 2.17 + side * 0.6 + 1.1) + 0.05 * Math.sin(u * 4.9 + side * 2.3);
}

// The river's half-width: narrow where it crosses, broad off in the hills.
const halfWidthAt = (x) => {
  const t = Math.min(1, Math.max(0, (Math.abs(x) - 7) / 13));
  return 1.12 + 0.8 * t * t * (3 - 2 * t);
};

// A point on a piece: s m along it, n m across it (+ to its right). out: [x, d].
export function pieceAt(P, s, n, out = [0, 0]) {
  const th = P.th + P.k * s;
  let x, d;
  if (Math.abs(P.k) > 1e-6) {
    x = P.x + (Math.sin(th) - Math.sin(P.th)) / P.k;
    d = P.d + (Math.cos(P.th) - Math.cos(th)) / P.k;
  } else {
    x = P.x + Math.cos(P.th) * s;
    d = P.d + Math.sin(P.th) * s;
  }
  out[0] = x + n * Math.sin(th);
  out[1] = d - n * Math.cos(th);
  return out;
}

// How far from the middle of the river its edge is, s m along a piece, on
// one side (+1 its right).
export function edgeAt(P, s, side) {
  let t = Math.min(1, Math.max(0, s / P.len));
  t = t * t * (3 - 2 * t);
  return P.w0 + (P.w1 - P.w0) * t + riverWob(P.u + s, side);
}

// --- planning --------------------------------------------------------------------
function catmull(W, step) {
  const pts = [W[0], ...W, W[W.length - 1]];
  const out = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, e) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(W[W.length - 1]);
  return out;
}

// The waypoints: where the river comes in, each crossing (a slanting line
// through the road, bowed a little), and between them where it wanders.
function waypoints(seg, rng, crossings) {
  const D0 = seg.start, D1 = seg.end;
  let side = rng.sign();
  const W = [[side * 105, D0 + 4], [side * 62, D0 + 24], [side * rng.float(26, 34), D0 + 52]];
  let at = D0 + 52;
  // between here and `to` on this side: close alongside or off in the hills
  const wander = (to, near) => {
    let d = at + rng.float(30, 45);
    while (d < to - 26) {
      const close = near && rng.chance(0.55);
      W.push([side * (close ? rng.float(9.6, 12.5) : rng.float(20, 42)), d]);
      d += rng.float(32, 52);
    }
  };
  const plan = [];
  for (let k = 0; k < crossings.length; k++) {
    const c = crossings[k];
    const phi = rng.float(0.16, 0.48) * rng.sign();
    const bow = rng.float(0.6, 1.4) * rng.sign();
    const hairpin = c - at > 150 && rng.chance(0.4);
    if (hairpin) {
      // out wide past the crossing, round, and back down toward it, close in
      wander(c - 50, false);
      W.push([side * rng.float(36, 42), c + 18]);
      W.push([side * rng.float(40, 46), c + 50]);
      W.push([side * rng.float(30, 34), c + 70]);
      W.push([side * 25, c + 58]);
      W.push([side * 21, c + 34]);
    } else {
      wander(c - 52, true);
      W.push([side * 21.5, c - 48]);
      W.push([side * 21, c - 28]);
    }
    // across, from this side to the other, at a slant (phi), a little bowed
    // (a long straight run in and out, so the river has finished turning
    // before it reaches the road)
    const dx = -side * Math.cos(phi), dd = Math.sin(phi);
    for (const t of [-14, -9, -4.5, 0, 4.5, 9, 14]) {
      const b = bow * (1 - (t / 14) ** 2);
      W.push([dx * t - dd * b, c + dd * t + dx * b]);
    }
    side = -side;
    W.push([side * 21, c + 28]);
    W.push([side * 21.5, c + 48]);
    at = c + 48;
    plan.push({ c, phi });
  }
  // and away into the hills before the doorway out
  wander(D1 - 120, true);
  W.push([side * rng.float(34, 42), D1 - 84]);
  W.push([side * 70, D1 - 44]);
  W.push([side * 115, D1 - 14]);
  return W;
}

// Follow the line through the waypoints with a chain of arcs.
function follow(ref) {
  const pieces = [];
  let x = ref[0][0], d = ref[0][1];
  let th = Math.atan2(ref[1][1] - d, ref[1][0] - x);
  let idx = 0;
  let u = 0;
  const LA = 11; // samples ahead (half a metre each)
  const last = ref.length - 1;
  for (let guard = 0; guard < 4000; guard++) {
    let best = idx, bd = Infinity;
    for (let j = idx; j < Math.min(last + 1, idx + 50); j++) {
      const e = (ref[j][0] - x) ** 2 + (ref[j][1] - d) ** 2;
      if (e < bd) {
        bd = e;
        best = j;
      }
    }
    idx = best;
    if (idx >= last - 3) break;
    const L = ref[Math.min(last, idx + LA)];
    const lx = L[0] - x, ld = L[1] - d;
    const Ld = Math.max(1, Math.hypot(lx, ld));
    let al = Math.atan2(ld, lx) - th;
    while (al > Math.PI) al -= Math.PI * 2;
    while (al < -Math.PI) al += Math.PI * 2;
    let k = (2 * Math.sin(al)) / Ld;
    k = Math.max(-1 / RMIN, Math.min(1 / RMIN, k));
    const P = { x, d, th, k, len: PIECE, u, w0: 1, w1: 1 };
    pieces.push(P);
    const e = pieceAt(P, PIECE, 0);
    x = e[0];
    d = e[1];
    th += k * PIECE;
    u += PIECE;
  }
  for (const P of pieces) {
    P.w0 = halfWidthAt(P.x);
    P.w1 = halfWidthAt(pieceAt(P, PIECE, 0)[0]);
  }
  for (let i = 1; i < pieces.length; i++) pieces[i].w0 = pieces[i - 1].w1;
  return pieces;
}

const _p = [0, 0];
// Where the chocolate lies along the road in each lane of a crossing (the
// run of pieces near the road): [{ d0, d1 }] x 3, or null.
function laneSpans(run) {
  const X = CONFIG.laneX;
  const out = X.map(() => ({ d0: Infinity, d1: -Infinity }));
  for (const P of run) {
    for (let s = 0; s <= P.len + 1e-6; s += 0.06) {
      for (const side of [-1, 1]) {
        pieceAt(P, s, side * edgeAt(P, s, side), _p);
        for (let l = 0; l < 3; l++) {
          if (Math.abs(_p[0] - X[l]) > 0.45) continue;
          const o = out[l];
          if (_p[1] < o.d0) o.d0 = _p[1];
          if (_p[1] > o.d1) o.d1 = _p[1];
        }
      }
    }
  }
  return out.every((o) => o.d1 > o.d0) ? out : null;
}

// Does any of a piece's water or bank come onto the road?
function onRoad(P) {
  for (let s = 0; s <= P.len + 1e-6; s += 0.4) {
    for (const side of [-1, 1]) {
      pieceAt(P, s, side * (edgeAt(P, s, side) + BANK), _p);
      if (Math.abs(_p[0]) < CONFIG.trackHalfWidth + 0.05) return true;
    }
    pieceAt(P, s, 0, _p);
    if (Math.abs(_p[0]) < CONFIG.trackHalfWidth + 0.05) return true;
  }
  return false;
}

// (crossings: 2 as many as fit, 1 just the one, 0 none)
function attempt(seg, rng, crossings0) {
  const D0 = seg.start, D1 = seg.end;
  const cs = [];
  if (crossings0 === 2) {
    let c = D0 + rng.float(140, 185);
    while (c < D1 - 160) {
      cs.push(c);
      c += rng.float(175, 260);
    }
  } else if (crossings0 === 1) cs.push(D0 + rng.float(0.35, 0.65) * (D1 - D0));
  const pieces = follow(catmull(waypoints(seg, rng, cs), 0.5));
  // every run of pieces on the road must be one crossing, right across it
  const crossings = [];
  const onIt = pieces.map(onRoad);
  for (let i = 0; i < pieces.length; i++) {
    if (!onIt[i]) continue;
    let j = i;
    while (j + 1 < pieces.length && onIt[j + 1]) j++;
    const run = pieces.slice(Math.max(0, i - 1), Math.min(pieces.length, j + 2));
    const a = run[0], b = run[run.length - 1];
    const xb = pieceAt(b, b.len, 0)[0];
    // (in on one side and out the other, never too steeply along the road)
    if (Math.sign(a.x) === Math.sign(xb) || Math.abs(a.x) < 4.4 || Math.abs(xb) < 4.4) return null;
    for (let k = i; k <= j; k++) {
      const P = pieces[k];
      if (Math.abs(P.x) < 3.8 && Math.abs(Math.cos(P.th)) < 0.77) return null;
    }
    let spans = null;
    for (let tries = 0; tries < 6; tries++) {
      spans = laneSpans(run);
      if (spans && spans.every((o) => o.d1 - o.d0 <= MAX_SPAN)) break;
      // too far to jump somewhere: narrow it here
      for (let k = i; k <= j; k++) {
        pieces[k].w0 *= 0.9;
        pieces[k].w1 *= 0.9;
      }
      spans = null;
    }
    if (!spans) return null;
    // (the pieces either side ease back out to the river's own width)
    if (i > 0) pieces[i - 1].w1 = pieces[i].w0;
    if (j + 1 < pieces.length) pieces[j + 1].w0 = pieces[j].w1;
    const lanes = spans.map((o) => ({ d0: o.d0 + INSET, d1: o.d1 - INSET }));
    const d0 = Math.min(...lanes.map((o) => o.d0));
    const d1 = Math.max(...lanes.map((o) => o.d1));
    if (d0 < D0 + 100 || d1 > D1 - 110) return null;
    crossings.push({ d0, d1, lanes, top: RIVER_TOP, first: i, last: j, laid: false });
    i = j;
  }
  if (crossings.length !== cs.length) return null;
  for (let k = 1; k < crossings.length; k++) if (crossings[k].d0 - crossings[k - 1].d1 < 60) return null;
  return { pieces, crossings };
}

// The river for one time through the world (seg: its stretch of the
// course), a try at a time (a generator, so the game can plan it between
// frames, well before it's needed: see ObstacleField.planAhead); done(plan)
// is handed the plan at the end.
export function* planRiverSteps(seg, seed, done) {
  let plan = null;
  for (let n = 0; n < 12 && !plan; n++) {
    plan = attempt(seg, new RNG(hashSeed(seed, seg.start, n, 0x7c)), n < 7 ? 2 : n < 11 ? 1 : 0);
    yield;
  }
  if (!plan) plan = { pieces: [], crossings: [] };
  const rng = new RNG(hashSeed(seed, seg.start, 0x51));
  plan.flow = rng.sign();
  // the pieces each chunk puts out, and the points the scenery keeps clear of
  const L = CONFIG.chunkLength;
  plan.byChunk = new Map();
  plan.clear = new Map();
  const add = (map, d, v) => {
    const k = Math.floor(d / L);
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(v);
  };
  plan.pieces.forEach((P, i) => {
    P.i = i;
    P.crossing = plan.crossings.some((c) => i >= c.first - 1 && i <= c.last + 1);
    if (Math.abs(P.x) < 80) add(plan.byChunk, P.d, P);
    for (let s = 0; s <= P.len; s += 0.8) {
      const q = pieceAt(P, s, 0);
      add(plan.clear, q[1], [q[0], q[1], Math.max(P.w0, P.w1) + 0.36 + BANK]);
    }
  });
  done(plan);
}

// ... or all at once.
export function planRiver(seg, seed) {
  let plan = null;
  for (const _ of planRiverSteps(seg, seed, (p) => (plan = p)));
  return plan;
}

// Whether a prop of radius r at (x, d) stands clear of the river and its banks.
export function clearOfRiver(plan, x, d, r) {
  if (!plan) return true;
  const k = Math.floor(d / CONFIG.chunkLength);
  for (let i = k - 1; i <= k + 1; i++) {
    const list = plan.clear.get(i);
    if (!list) continue;
    for (const q of list) {
      const rr = r + q[2];
      const dx = q[0] - x, dd = q[1] - d;
      if (dx * dx + dd * dd < rr * rr) return false;
    }
  }
  return true;
}
