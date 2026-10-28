import { CONFIG } from '../config.js';
import { shared } from '../render/shaders.js';

// Dream depth. Every doorway takes you one world deeper, and the deeper you
// are the less the worlds hold their shape. Each stretch of the course is
// dealt its own seeded recipe — a few distortions picked from the list below,
// more of them and stronger the deeper it lies — so no two passes through the
// same world look alike, and a recipe blends into the next one as you run up
// to a doorway. Every so often a world comes up "lucid": calmer, a breather
// before it gets strange again.
//
// All the shape distortions grow with distance from the camera (see bendPos
// and the breathing in the object vertex shader), so the stretch of road the
// player is actually reading — and every obstacle on it — is always true.
//
// Modes (amount at full depth; recipes scale them by the level):
//   twist    the road ahead corkscrews about its own axis (radians, signed)
//   waves    slow swells roll through the far world
//   melt     the far world wobbles like jelly
//   breathe  props in the distance swell and settle
//   rings    rings of hue roll toward you through the world
//   swirl    the sky stirs like paint
//   neon     ink lines burn in cycling neon
//   palette  the whole palette turns to new hues (+ a saturation push)

const MODES = [
  // [name, weight, amount at level 1, cap]
  ['twist', 1.0, 0.55, 0.7],
  ['waves', 1.0, 0.6, 0.9],
  ['melt', 0.9, 1.0, 1.35],
  ['breathe', 0.9, 1.0, 1.35],
  ['rings', 1.0, 0.6, 0.85],
  ['swirl', 1.0, 1.0, 1.4],
  ['neon', 0.7, 0.85, 1.0],
  ['palette', 1.1, 1.0, 1.0],
];

const KEYS = ['twist', 'waves', 'melt', 'breathe', 'rings', 'swirl', 'neon', 'hue', 'sat'];

function blank(level = 0) {
  const r = { level };
  for (const k of KEYS) r[k] = 0;
  return r;
}

// Depth level for the n-th world of a run (1 = the first): nothing at all in
// the first world, then a steady climb to the cap.
export function dreamLevel(ordinal) {
  const D = CONFIG.dream;
  return Math.min(D.max, Math.max(0, (ordinal - D.start) * D.perWorld));
}

export function makeDream(rng, ordinal, forced) {
  const D = CONFIG.dream;
  let level = forced ?? dreamLevel(ordinal);
  if (forced === undefined && level > 0) {
    level *= ordinal > D.start + 2 && rng.chance(D.lucidChance) ? 0.4 : rng.float(0.85, 1.1);
  }
  const r = blank(level);
  if (level <= 0) return r;
  // the gentlest effects creep in everywhere...
  r.waves = 0.1 * level;
  r.breathe = 0.3 * level;
  // ...then a seeded handful of stronger ones, more of them the deeper you go
  const n = Math.min(5, 1 + Math.floor(level * 3));
  const pool = MODES.slice();
  for (let i = 0; i < n && pool.length; i++) {
    const m = rng.weighted(pool.map((e) => [e, e[1]]));
    pool.splice(pool.indexOf(m), 1);
    const [name, , amount, cap] = m;
    const k = amount * level * rng.float(0.75, 1.2);
    if (name === 'palette') {
      r.hue = rng.sign() * rng.float(0.7, 2.6) * Math.min(1, level);
      r.sat = 0.18 * Math.min(1, level);
    } else if (name === 'twist') {
      r.twist = rng.sign() * Math.min(cap, k);
    } else {
      r[name] = Math.min(cap, r[name] + k);
    }
  }
  return r;
}

// The blended state that drives the shared uniforms.
export class Dream {
  constructor() {
    this.now = blank();
    this.rush = 0;
    this.rushAmt = 0;
    this.motion = 1;
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const apply = () => (this.motion = mq.matches ? CONFIG.dream.reducedMotion : 1);
      apply();
      mq.addEventListener?.('change', apply);
    } catch {
      /* no matchMedia */
    }
  }

  reset(recipe) {
    this.set(recipe, recipe, 0);
    this.rush = 0;
  }

  // Blend two recipes (t = 0..1 on the run up to a doorway).
  set(a, b, t) {
    for (const k of KEYS) this.now[k] = a[k] + (b[k] - a[k]) * t;
    this.now.level = a.level + (b.level - a.level) * t;
  }

  // Coming through a doorway: a bloom of colour and a swell racing ahead.
  doorway() {
    this.rush = 1;
    this.rushAmt = CONFIG.dream.rushBase + (1 - CONFIG.dream.rushBase) * Math.min(1, this.now.level);
  }

  update(dt) {
    this.rush = Math.max(0, this.rush - dt / CONFIG.dream.rushTime);
    const n = this.now;
    const m = this.motion;
    const rush = this.rush * this.rush * (3 - 2 * this.rush) * this.rushAmt;
    shared.uDream.value.set(n.twist * m, n.waves * m, n.melt * m, n.breathe * m);
    shared.uDream2.value.set(n.rings, n.swirl, n.neon, rush * Math.max(m, 0.5));
    shared.uDream3.value.set(n.hue, n.sat, 1 - this.rush, rush * m);
  }

  // How hard the camera should sway (0 = steady).
  get sway() {
    return Math.max(0, this.now.level - 0.35) * this.motion;
  }
}
