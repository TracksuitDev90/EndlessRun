import { CONFIG } from '../config.js';

// Low gravity (a world with def.lowGravity: the Red Drift). Two arcs, both
// solved exactly piece by piece so they're the same at any frame rate:
//
//   - the boost (the jump, there): a burst off the thruster flings the
//     runner up hard - gravity at `up` while they're still climbing faster
//     than `hover` m/s - then the burst is spent and they hang, low gravity
//     barely tugging (`hang`) while they drift over the top, and once they're
//     sinking faster than `hover` they come down at `down`: up quick, a long
//     float over the top, and a drop that isn't a crawl. Not the slow-motion
//     float low gravity usually is - they're hurled;
//   - the bound: on the ground they take a few steps (`steps`) and bounce off
//     in a long low lope, the stride stretched out over it (see Player), then
//     land, a few more steps, and off again.
//
// The gem director hangs its arcs on the same curve (see GemField), so a
// boost taken at the right moment takes every gem in the air.

// One step of the boost's arc for a body o ({ y, vy }, moved in place).
export function boostStep(o, dt) {
  const B = CONFIG.drift.boost;
  let y = o.y;
  let vy = o.vy;
  let left = dt;
  for (let i = 0; i < 4 && left > 0; i++) {
    let g, tb;
    if (vy > B.hover) (g = B.up), (tb = (vy - B.hover) / g);
    else if (vy > -B.hover) (g = B.hang), (tb = (vy + B.hover) / g);
    else (g = B.down), (tb = Infinity);
    const h = Math.min(left, tb + 1e-6);
    y += vy * h - 0.5 * g * h * h;
    vy -= g * h;
    left -= h;
  }
  o.y = y;
  o.vy = vy;
}

// The boost's arc as a function of time since take-off (from the ground):
// { T: airtime, mid: when it's best to be over whatever's being cleared,
// feet(t): the height of the runner's feet, apex }.
let cached = null;
let cachedKey = '';
export function boostArc() {
  const B = CONFIG.drift.boost;
  const key = `${B.v0}:${B.up}:${B.hover}:${B.hang}:${B.down}`;
  if (cached && key === cachedKey) return cached;
  const t1 = (B.v0 - B.hover) / B.up;
  const h1 = B.v0 * t1 - 0.5 * B.up * t1 * t1;
  const t2 = (2 * B.hover) / B.hang;
  const t3 = (-B.hover + Math.sqrt(B.hover * B.hover + 2 * B.down * h1)) / B.down;
  const feet = (t) => {
    if (t <= 0) return 0;
    if (t < t1) return B.v0 * t - 0.5 * B.up * t * t;
    if (t < t1 + t2) {
      const u = t - t1;
      return h1 + B.hover * u - 0.5 * B.hang * u * u;
    }
    const u = Math.min(t - t1 - t2, t3);
    return Math.max(0, h1 - B.hover * u - 0.5 * B.down * u * u);
  };
  // over the top: the middle of the stretch the feet are above the hurdles
  // (CONFIG says 0.95 m) with a little to spare
  const clear = 1.2;
  let a = 0;
  let b = t1 + t2 + t3;
  for (let t = 0; t < b; t += 0.005) if (feet(t) >= clear) { a = t; break; }
  for (let t = b; t > a; t -= 0.005) if (feet(t) >= clear) { b = t; break; }
  cached = { T: t1 + t2 + t3, mid: (a + b) / 2, feet, apex: h1 + (B.hover * B.hover) / (2 * B.hang) };
  cachedKey = key;
  return cached;
}

// The ordinary jump, in the same terms.
export function plainArc() {
  const J = CONFIG.jump;
  const T = J.time;
  const V0 = (4 * J.height) / T;
  const G = (8 * J.height) / (T * T);
  return { T, mid: T / 2, feet: (t) => Math.max(0, V0 * t - 0.5 * G * t * t), apex: J.height };
}
