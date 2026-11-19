// Knotling's shape at rest: one closed length of rope wound into a loose,
// roughly round knot (see knotling.js for the rope itself, and roller.js for
// his mind). Pure arithmetic - no three.js - so it can be checked on its own
// (node: import it and call buildKnot()).
//
// The knot is a Turk's head laid over a ball: the rope runs three times round
// it while weaving up and down across its middle four times, so every lap
// crosses the others, alternately over and under, and a big opening is left
// at each pole (which the rope rolls round to show you, and which you can see
// through). Over that:
//   - at every crossing the strand going over is lifted off the ball and the
//     one going under pressed into it, so the crossings have real depth;
//   - a few slow, seeded wobbles make the loops uneven - one a little fuller,
//     one drawn a little tighter - so he reads as tied by hand, not turned;
//   - then a relaxation: neighbouring samples kept evenly spaced (rope doesn't
//     stretch), anything closer than the rope's thickness pushed apart (no
//     strand through another), all of it kept within a shell round the ball,
//     and a little smoothing.
//
// Everything is in units of the knot's outer radius (1: the outside of the
// outermost rope). The rope's radius is RHO.

export let RHO = 0.135; // the rope's radius
export const SAMPLES = 192;
let LEADS = 4;
let BIGHTS = 5;
// (for trying other knots: tools only)
export function knotParams(o) {
  if (o.rho) RHO = o.rho;
  if (o.leads) LEADS = o.leads;
  if (o.bights) BIGHTS = o.bights;
  if (o.amp) AMP = o.amp;
}
let AMP = 1.0;

// A small seeded random (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The knot: { p: Float32Array (SAMPLES x 3, closed: the last joins the
// first), length (of the centreline, in the same units), crossings: [{ i, j,
// over }] (sample indices of the strand on top and underneath) }.
export function buildKnot(seed = 7) {
  const N = SAMPLES;
  const R = rng(seed);
  const p = new Float64Array(N * 3);
  const amp = AMP; // how far the weave reaches toward the poles (rad)
  const r0 = 1 - RHO * 2.15; // the middle of the shell the rope lies in
  // slow wobbles along the rope (in turns of t) - loops of uneven size
  const wob = [];
  for (let k = 0; k < 4; k++) wob.push({ f: 1 + Math.floor(R() * 5), ph: R() * Math.PI * 2, a: 0.04 + R() * 0.05 });
  const dir = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2 * LEADS;
    let lat = amp * Math.sin((BIGHTS / LEADS) * t);
    let lon = t;
    for (const w of wob) {
      lat += w.a * Math.sin((w.f * t) / LEADS + w.ph);
      lon += w.a * 0.8 * Math.cos((w.f * t) / LEADS + w.ph * 1.7);
    }
    dir.push([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]);
  }
  // the crossings: two stretches of rope far apart along it, nearly the same
  // way out from the middle - each the closest pair of its cluster
  const near = [];
  const gap = N / 14;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const s = Math.min(j - i, N - (j - i));
      if (s < gap) continue;
      const d = 1 - (dir[i][0] * dir[j][0] + dir[i][1] * dir[j][1] + dir[i][2] * dir[j][2]);
      if (d < 0.02) near.push({ i, j, d });
    }
  }
  near.sort((a, b) => a.d - b.d);
  const crossings = [];
  for (const c of near) {
    const close = (x, y) => Math.min(Math.abs(x - y), N - Math.abs(x - y)) < N / 24;
    if (crossings.some((k) => (close(k.i, c.i) && close(k.j, c.j)) || (close(k.i, c.j) && close(k.j, c.i)))) continue;
    crossings.push({ i: c.i, j: c.j });
  }
  // over and under, alternately along the rope (a Turk's head is an
  // alternating knot: going along it, you pass over, then under, then over...)
  const events = [];
  for (const c of crossings) events.push({ at: c.i, c }, { at: c.j, c });
  events.sort((a, b) => a.at - b.at);
  let up = true;
  for (const e of events) {
    if (e.c.overAt === undefined) e.c.overAt = up ? e.at : e.at === e.c.i ? e.c.j : e.c.i;
    up = !up;
  }
  // how far each sample is lifted (+) or pressed in (-) at the crossings
  const lift = new Float64Array(N);
  const width = N / 34;
  for (const c of crossings) {
    const over = c.overAt, under = over === c.i ? c.j : c.i;
    for (let i = 0; i < N; i++) {
      for (const [at, s] of [[over, 1], [under, -1]]) {
        let d = Math.abs(i - at);
        d = Math.min(d, N - d);
        lift[i] += s * Math.exp(-(d * d) / (width * width));
      }
    }
  }
  for (let i = 0; i < N; i++) {
    const r = r0 + RHO * 1.12 * Math.max(-1, Math.min(1, lift[i]));
    p[i * 3] = dir[i][0] * r;
    p[i * 3 + 1] = dir[i][1] * r;
    p[i * 3 + 2] = dir[i][2] * r;
  }
  relax(p, N, r0);
  // centred, and scaled so the outermost rope just touches 1
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) {
    cx += p[i * 3];
    cy += p[i * 3 + 1];
    cz += p[i * 3 + 2];
  }
  cx /= N;
  cy /= N;
  cz /= N;
  let far = 0;
  for (let i = 0; i < N; i++) {
    p[i * 3] -= cx;
    p[i * 3 + 1] -= cy;
    p[i * 3 + 2] -= cz;
    far = Math.max(far, Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
  }
  const k = (1 - RHO) / far;
  for (let i = 0; i < N * 3; i++) p[i] *= k;
  let length = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    length += Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
  }
  return {
    p: Float32Array.from(p),
    length,
    crossings: crossings.map((c) => ({ i: c.overAt, j: c.overAt === c.i ? c.j : c.i })),
  };
}

// Even spacing, no strand through another, all within the shell, smooth.
function relax(p, N, r0) {
  let len = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    len += Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
  }
  const seg = len / N;
  const dmin = RHO * 2 * 1.1;
  const skip = Math.ceil((dmin * 1.6) / seg) + 1;
  const rIn = r0 - RHO * 1.6, rOut = r0 + RHO * 1.6;
  const q = new Float64Array(N * 3);
  for (let it = 0; it < 260; it++) {
    // apart
    for (let i = 0; i < N; i++) {
      for (let j = i + skip; j < N; j++) {
        if (N - (j - i) < skip) continue;
        const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= dmin * dmin) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const push = ((dmin - d) / d) * 0.5;
        p[i * 3] -= dx * push;
        p[i * 3 + 1] -= dy * push;
        p[i * 3 + 2] -= dz * push;
        p[j * 3] += dx * push;
        p[j * 3 + 1] += dy * push;
        p[j * 3 + 2] += dz * push;
      }
    }
    // even spacing
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const k = ((d - seg) / d) * 0.5;
      p[i * 3] += dx * k;
      p[i * 3 + 1] += dy * k;
      p[i * 3 + 2] += dz * k;
      p[j * 3] -= dx * k;
      p[j * 3 + 1] -= dy * k;
      p[j * 3 + 2] -= dz * k;
    }
    // within the shell
    for (let i = 0; i < N; i++) {
      const r = Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      const t = Math.max(rIn, Math.min(rOut, r));
      const k = 1 + ((t - r) / r) * 0.5;
      p[i * 3] *= k;
      p[i * 3 + 1] *= k;
      p[i * 3 + 2] *= k;
    }
    // a little smoothing (less toward the end)
    const s = it < 200 ? 0.12 : 0.04;
    for (let i = 0; i < N; i++) {
      const a = (i + N - 1) % N, b = (i + 1) % N;
      for (let c = 0; c < 3; c++) q[i * 3 + c] = p[i * 3 + c] + s * ((p[a * 3 + c] + p[b * 3 + c]) * 0.5 - p[i * 3 + c]);
    }
    p.set(q);
  }
}

// The nearest two stretches of rope come to each other (centre to centre),
// beside neighbours along it: should be at least 2 RHO.
export function clearance(p, N = p.length / 3) {
  let len = 0;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    len += Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
  }
  const skip = Math.ceil((RHO * 4) / (len / N)) + 1;
  let best = 1e9;
  for (let i = 0; i < N; i++) {
    for (let j = i + skip; j < N; j++) {
      if (N - (j - i) < skip) continue;
      best = Math.min(best, Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]));
    }
  }
  return best;
}
