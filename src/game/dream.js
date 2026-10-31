import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { shared } from '../render/shaders.js';

// Dream depth. Every doorway takes you one world deeper, and the deeper you
// are the less the worlds hold their shape — but it comes on slowly, in three
// movements:
//   1. the real worlds: the first few are exactly as painted;
//   2. the morph: then the far distance starts, quietly, to misbehave — props
//      far off breathe, slow swells roll through the far road, tall things
//      far away go soft like jelly. Easy to miss at first;
//   3. the trip: only after that does the dream start to colour things — the
//      sky stirs, rings of hue roll toward you, the palette turns, the ink
//      burns neon, the road corkscrews — each effect joining at its own depth
//      and growing for several worlds after.
// Each stretch of the course is dealt its own seeded recipe from whatever has
// joined by then, so no two passes through the same world look alike, and a
// recipe blends into the next as you run up to a doorway. Every so often a
// deeper world comes up "lucid": calmer, a breather before it gets strange
// again.
//
// All the shape distortions grow with distance from the camera (see bendPos
// and the breathing in the object vertex shader), so the stretch of road the
// player is actually reading — and every obstacle on it — is always true.
//
// Coming through a doorway sends a burst of the new world's own colours out
// from the centre of the screen and off its edges in a fraction of a second
// (and a swell racing down the road); as the trip takes over, the burst turns
// to rainbow.

// [name, amount at full strength, cap, weight when picking, part of the
// colour trip]; when each one joins and how long it takes to grow is
// CONFIG.dream.schedule.
//   breathe  props in the distance swell and settle like living things
//   waves    slow swells roll through the far world
//   melt     the far world wobbles like jelly, the tall things most
//   swirl    the sky stirs like paint
//   rings    rings of hue roll toward you through the world
//   palette  the whole palette turns to new hues (+ a saturation push)
//   neon     ink lines burn in cycling neon
//   twist    the road ahead corkscrews about its own axis (radians, signed)
const MODES = [
  ['breathe', 1.1, 1.35, 1.0, false],
  ['waves', 0.65, 0.9, 1.0, false],
  ['melt', 1.1, 1.35, 0.9, false],
  ['swirl', 1.1, 1.4, 1.0, true],
  ['rings', 0.7, 0.85, 1.0, true],
  ['palette', 1.0, 1.0, 1.1, true],
  ['neon', 0.9, 1.0, 0.7, true],
  ['twist', 0.6, 0.7, 1.0, true],
];
const when = (name) => CONFIG.dream.schedule[name];

const KEYS = ['twist', 'waves', 'melt', 'breathe', 'rings', 'swirl', 'neon', 'hue', 'sat', 'trip'];

function blank(level = 0) {
  const r = { level };
  for (const k of KEYS) r[k] = 0;
  return r;
}

// How far along a mode's ramp the n-th world is (0 before it joins, 1 at full
// strength), eased so each one creeps in.
function ramp(ordinal, from, full) {
  const t = Math.min(1, Math.max(0, (ordinal - from + 1) / (full - from + 1)));
  return Math.pow(t, 1.35);
}

// Overall depth of the n-th world (1 = the first): 0 through the real worlds,
// 1 once everything has come in.
export function dreamLevel(ordinal) {
  return ramp(ordinal, CONFIG.dream.morphFrom, CONFIG.dream.full);
}

// How far the colour trip has got (drives the doorway bloom's rainbow and the
// camera's sway).
function tripLevel(ordinal) {
  return ramp(ordinal, CONFIG.dream.tripFrom, CONFIG.dream.full);
}

// forced (?dream=n): deal every world the dream of the n-th world.
export function makeDream(rng, ordinal, forced) {
  let o = forced ?? ordinal;
  if (forced === undefined && o > CONFIG.dream.tripFrom + 1 && rng.chance(CONFIG.dream.lucidChance)) {
    // lucid: as calm as a world several doors shallower
    o = Math.max(CONFIG.dream.morphFrom, o - rng.int(4, 6));
  }
  const r = blank(dreamLevel(o));
  r.trip = tripLevel(o);
  if (r.level <= 0) return r;
  const grown = (name) => ramp(o, ...when(name));
  const open = MODES.filter((m) => grown(m[0]) > 0);
  // the gentlest of the morph is everywhere once it has joined...
  for (const [name, amount] of open) {
    if (name === 'breathe' || name === 'waves') r[name] = 0.3 * amount * grown(name);
  }
  // ...then a seeded handful features strongly, more of them the deeper it is
  // (once the trip has begun, always at least one of its colours)
  const n = Math.min(5, open.length, 1 + Math.floor(r.level * 4));
  const pool = open.slice();
  for (let i = 0; i < n && pool.length; i++) {
    const trips = i === 0 ? pool.filter((e) => e[4]) : [];
    const from = trips.length ? trips : pool;
    const m = rng.weighted(from.map((e) => [e, e[3]]));
    pool.splice(pool.indexOf(m), 1);
    const [name, amount, cap] = m;
    const k = amount * grown(name) * rng.float(0.75, 1.2);
    if (name === 'palette') {
      r.hue = rng.sign() * rng.float(0.7, 2.6) * Math.min(1, k);
      r.sat = 0.18 * Math.min(1, k);
    } else if (name === 'twist') {
      r.twist = rng.sign() * Math.min(cap, k);
    } else {
      r[name] = Math.min(cap, Math.max(r[name], k));
    }
  }
  return r;
}

// The colours a world's doorway bloom is made of (env.bloom, or its door, its
// sky and its light), each pushed a little more vivid so the bloom reads as
// colour, not as a dimming of the picture.
function bloomColors(def, env, out) {
  const pick = env.bloom || [def.doorColor, env.sky[1], env.particles?.color || env.sun.glow];
  for (let i = 0; i < 3; i++) {
    const c = out[i].set(pick[i]);
    c.getHSL(_hsl);
    c.setHSL(_hsl.h, Math.min(1, _hsl.s * 1.1 + 0.08), Math.min(0.74, Math.max(0.5, _hsl.l)));
  }
  return out;
}
const _hsl = { h: 0, s: 0, l: 0 };

// The blended state that drives the shared uniforms.
export class Dream {
  constructor() {
    this.now = blank();
    this.rush = 0;
    this.rushAmt = 0;
    this.swellAmt = 0;
    this.rushTrip = 0;
    this.motion = 1;
    this.bloom = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
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

  // Coming through a doorway into world def (lit as env): a burst of its
  // colours and a swell racing ahead. Into a world that drains (Hell) there's
  // no colour to burst — its colour is sapped away instead (see game.js), and
  // only the swell runs; out of one (fromDrain), the colour has just welled
  // back, and a lighter burst rides out over it.
  doorway(def, env, fromDrain = false) {
    this.rush = 1;
    const R = CONFIG.dream;
    const amt = R.rushBase + (1 - R.rushBase) * Math.min(1, this.now.level);
    this.rushAmt = env.drain ? 0 : fromDrain ? amt * 0.7 : amt;
    this.swellAmt = Math.max(amt, 0.8);
    this.rushTrip = env.drain ? 0 : this.now.trip;
    bloomColors(def, env, this.bloom);
  }

  update(dt) {
    this.rush = Math.max(0, this.rush - dt / CONFIG.dream.rushTime);
    const n = this.now;
    const m = this.motion;
    const ease = this.rush * this.rush * (3 - 2 * this.rush);
    shared.uDream.value.set(n.twist * m, n.waves * m, n.melt * m, n.breathe * m);
    shared.uDream2.value.set(n.rings, n.swirl, n.neon, ease * this.rushAmt * Math.max(m, 0.5));
    shared.uDream3.value.set(n.hue, n.sat, 1 - this.rush, ease * this.swellAmt * m);
    // the bloom: the new world's colours, turning to rainbow as the trip deepens
    shared.uBloom.value.set(1 - 0.75 * this.rushTrip, this.rushTrip, 0, 0);
    for (let i = 0; i < 3; i++) shared.uBloomCol.value[i].copy(this.bloom[i]);
  }

  // How hard the camera should sway (0 = steady).
  get sway() {
    return Math.max(0, this.now.trip - 0.3) * 1.4 * this.motion;
  }
}
