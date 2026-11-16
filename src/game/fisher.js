import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials } from '../render/shaders.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { palette } from './kit.js';
import { Player, C, mirror, merge } from './player.js';
import { CONFIG } from '../config.js';
import { Dust } from './dust.js';
import { Splashes } from './splashes.js';
import { Tank } from './tank.js';
import { CastLine } from './castline.js';

// The fisherman: Reed, a boy of about thirteen in an open yellow rain
// jacket, a teal tee and orange waterproof bib trousers, black rubber boots
// (sculpted in tools/runner/fisher.py) - with a little aquarium on his back
// and his rod over his right shoulder, a giant purple alien fish hanging off
// it. On top of the shared runner (player.js):
//   - he runs two ways, and every few seconds eases from one into the other
//     (as the bunny does): upright and light, his free arm swinging compact
//     at his side; or leaning into a longer stride, his arm swinging longer
//     - both easy and flowing, his hips riding each stride in a round wave -
//     and his right hand never leaves the rod;
//   - the rod rides on his shoulder (carried by his chest, bouncing a little
//     on it) and his right arm is solved to grip it wherever it is (armTo);
//   - the fish on its line is a weighty pendulum off the rod's tip -
//     damped, kept clear of him and of the tank - its tail and fins
//     following its swings a moment late (catchStep);
//   - the tank rides on his back on its straps, heaving and settling; inside it the water tips
//     and the goldfish swims round and round, turning as it goes, a bubble
//     now and then (tank.js);
//   - and his boots splash: a thin sheet of water thrown out from under them
//     where they come down, tearing into ligaments and fine spray, mist
//     hanging over it and ripples running out over the wet (a smaller kick
//     of it as he takes off; splashes.js) - only on land, and only ever for
//     show: none of it touches the run;
//   - and now and then the fish slips the hook: it drops off behind him,
//     bounces and flops on the road and is gone - and he casts straight out
//     again, ahead of him, off to one side or back over his shoulder (never
//     to quite the same place twice), and yanks a new catch up out of the
//     ground on the end of his line - one of five that bite anywhere, or the
//     world's own fish (CATCHES) - swinging in to hang off his rod (hookStep;
//     the line while it's out, castline.js). His whole body goes into it
//     (castPose): a jolt and his free arm flung after the lost one, then a
//     two-handed wind-up, twisting away and leaning back, the whip of the
//     flick, leaning out to watch it bite, hauled back on the strike, his
//     left hand winding the reel as it comes in (leftOnRod) - his eyes on
//     the fish, the cast, the catch all the way (lookWant);
//   - between casts, every few seconds he glances back at the fish, looks
//     out to the side of the road, jigs the rod or hefts it up to admire his
//     catch (GESTURES); and the fish fights, its tail lashing and its body
//     flexing, kicking out on its line (catchStep, wagOn).

// Palette slots: 1-16 are the garment ids baked into the mesh, the rest are
// colours the character shader draws his details with.
export const COL = {
  1: '#f7c8a8', // face (fair, warm)
  2: '#dfa64c', // hair (honey blonde)
  3: '#2f8c80', // tee (teal)
  4: '#f2b225', // jacket (rain-jacket yellow)
  5: '#e2561d', // trousers, the bib (orange)
  6: '#2b2829', // boots (black rubber)
  7: '#f7c8a8', // hands
  8: '#2a2b2f', // straps, buckles (charcoal)
  9: '#33363b', // the tank's cap and base (charcoal)
  10: '#5b3c29', // the rod's blank
  11: '#2d3034', // the reel, the guides
  12: '#bf9064', // cork
  13: '#5f49c4', // the alien fish (blue-violet)
  14: '#8a66d8', // its fins
  15: '#ff861c', // the goldfish
  16: '#e9eef0', // the line
  17: '#e5a383', // skin, deep
  18: '#ffe2cc', // skin, light
  19: '#f0907c', // cheeks
  20: '#c07a50', // freckles
  21: '#7e6a55', // dirt
  22: '#fcf8f3', // eye whites
  23: '#7b4d22', // irises (warm brown)
  24: '#26170f', // ink
  25: '#9b4537', // mouth
  26: '#cf8b14', // jacket, deep
  27: '#b33f10', // trousers, deep
  28: '#38dce4', // cyan accents
  29: '#ccb4f5', // the fish's belly (lavender)
  30: '#ffd889', // hair, light
  31: '#52f5df', // the fish's glow (turquoise)
};

// His two runs (the shared gait laid under each; see the bunny for how the
// one he's in is blended from them). Both are easy, flowing runs - an
// unhurried cadence with a long float between footfalls, the arm swinging
// loose from the shoulder with a soft elbow (nothing held rigid, nothing
// snapped) - and differ in how he carries himself:
//   - 'pump': upright and light on his feet, the heel kicked up behind, his
//     free (left) arm swinging compactly at his side, the elbow bent about
//     square and opening a little as it goes back;
//   - 'reach': leaning into a longer stride, his head a little down, the
//     stride lower and further, his free arm swinging longer and a little
//     wider for balance.
const STYLES = [
  {
    name: 'pump',
    cadence: [1.5, 0.047],
    stride: { reach: 0.66, hipY: 0.85, bob: 0.046, trackX: 0.066, swingX: 0.094, toeOut: 0.05, heelLift: 0.84, ballZ: -0.03 },
    swing: [
      [0.16, 0.4, 0.33, 0.03, 0.035],
      [0.4, 0.22, 0.52, 0.0, 0.08],
      [0.65, -0.17, 0.42, -0.04, 0.03],
      [0.84, -0.31, 0.27, -0.02, 0.0],
    ],
    arm: {
      swing: [0.2, 0.56, 0.68, 0.46, -0.06, -0.44, -0.56, -0.34],
      abd: [0.2, 0.18, 0.17, 0.19, 0.22, 0.25, 0.26, 0.23],
      elbow: [1.5, 1.68, 1.78, 1.66, 1.42, 1.26, 1.22, 1.32],
      amp: [0.84, 0.2],
    },
    lean: [0.13, 0.1],
    hipYaw: 0.15,
    hipRoll: 0.055,
    spTwist: 0.15,
    chTwist: 0.12,
  },
  {
    name: 'reach',
    cadence: [1.4, 0.045],
    stride: { reach: 0.74, hipY: 0.825, bob: 0.054, trackX: 0.074, swingX: 0.108, toeOut: 0.06, heelLift: 0.8, ballZ: -0.05 },
    swing: [
      [0.16, 0.42, 0.33, 0.04, 0.035],
      [0.4, 0.2, 0.51, 0.0, 0.09],
      [0.65, -0.23, 0.45, -0.05, 0.035],
      [0.84, -0.39, 0.28, -0.03, 0.0],
    ],
    arm: {
      swing: [0.3, 0.74, 0.88, 0.6, -0.16, -0.62, -0.76, -0.48],
      abd: [0.36, 0.4, 0.44, 0.4, 0.34, 0.38, 0.42, 0.39],
      elbow: [1.12, 1.26, 1.34, 1.24, 1.02, 0.86, 0.82, 0.92],
      amp: [0.88, 0.22],
    },
    lean: [0.24, 0.13],
    hipYaw: 0.18,
    hipRoll: 0.06,
    spTwist: 0.19,
    chTwist: 0.16,
  },
];
// how long he keeps to a run (s: at least, plus up to), and how long he
// takes to change from one into the other (a few strides: you shouldn't
// see it happen)
const STYLE_HOLD = [3.5, 4];
const STYLE_EASE = 0.95;

function blendGait(out, a, b, k) {
  for (const key in out) {
    if (typeof out[key] === 'number') out[key] = a[key] + (b[key] - a[key]) * k;
    else if (out[key] && typeof out[key] === 'object') blendGait(out[key], a[key], b[key], k);
  }
}

// How he handles: a steady spring between the lanes, the plain jump, and he
// lands with a stomp, both boots down at once, as you would in a puddle -
// one deep, soft give into his knees and up out of it, not a rattle of
// little bounces; his poses ease into each other without hurry.
const FEEL = {
  laneSpring: 36,
  lean: [0.036, 0.42],
  turn: [0.026, 0.36],
  blend: [4.4, 5.4, 5.8],
  land: { freq: 3.3, zeta: 0.52, thud: 0.025 },
};

// His jumps, dealt so the same one never comes twice running: a tuck (both
// boots pulled up together under him, as if he's jumping into a puddle), a
// stride leap (his free arm thrown up), and a star (arms and legs flung
// wide and snapped back in to land).
const TRICKS = ['puddle', 'stride', 'puddle', 'star', 'stride', 'puddle'];

// What can come up on his line - the same fish, sculpted once, dressed and
// reproportioned (the palette slots it's drawn with; its body scaled along
// [back to belly, length, flank to flank], from the rod's tip; its tail and
// pectoral fins scaled on their own; pat: how it's marked - the share of
// its scales spotted, how many bars cross it, a stripe down its flank, how
// much its markings glow: see uFish in the shaders). Five turn up anywhere:
//   - the alien: deep blue-violet, turquoise spots glowing down its flanks
//     (the one he starts every run with);
//   - the puffer: round as a ball, sunshine yellow, big fins, a pale belly
//     and brown freckles;
//   - the needlefish: long and slender, silver-blue, a cyan shine;
//   - the koi: white, big orange patches and a great flowing orange tail;
//   - the lanternfish: a deep-sea thing, midnight blue, chunky, golden
//     lights all down it.
// And every world has one of its own (world: its id), which only bites
// there - the first thing he pulls out of each new world, and after that
// as likely as the rest together:
//   - the Cypress Lane: a lane perch, olive and gold, dark bars across it,
//     orange fins;
//   - the Glasshouse: an orchid betta, magenta, its fins and tail great
//     pink veils;
//   - the Deepwood: a mossback trout, slender and olive, peppered dark,
//     a rosy flush down its belly;
//   - Candy World: a gummy fish, cherry-red and see-through;
//   - the Night Rooftops: a neon tetra, inky navy, an electric blue stripe
//     glowing down each flank over a red belly;
//   - the Hall of Doors: an inkblot carp, parchment-cream blotted with ink,
//     sepia fins;
//   - the Sky Road: a sunfish, round, gold, sun-white lights all over it;
//   - Hell: an ember gar, long and charcoal-black, lava glowing through it;
//   - the Gallery of Hours: an hourglass angelfish, tall and ivory, banded
//     in sand-gold, long trailing fins;
//   - the Kelp Deep: a clownfish, tangerine with three white bars;
//   - the Blue Hour: a mackerel, sea-green and slender, dark bars across
//     its back over a silver belly, a little lamp-glow to its markings;
//   - the Frostbound Pass: an alexandrite char, deep plum, teal fins, a
//     pink-violet belly, teal lights;
//   - the Red Drift: a comet ray, rust-red, starlight speckled over it.
const CATCHES = [
  { name: 'alien', body: '#5f49c4', fin: '#8a66d8', belly: '#ccb4f5', glow: '#52f5df', size: [1, 1, 1], tail: 1, fins: 1, pat: [0.55, 0, 0, 1] },
  { name: 'puffer', body: '#f5b000', fin: '#ffd23f', belly: '#ffe7a0', glow: '#6b3f17', size: [1.5, 0.68, 1.5], tail: 0.85, fins: 1.45, pat: [0.6, 0, 0, 0.15] },
  { name: 'needle', body: '#86aec0', fin: '#c4e6f0', belly: '#eef6f8', glow: '#2fd6ff', size: [0.62, 1.42, 0.62], tail: 1.05, fins: 0.7, pat: [0.4, 0, 0.012, 1] },
  { name: 'koi', body: '#f7f1e6', fin: '#ff7a2a', belly: '#fffaf1', glow: '#ff4a14', size: [1.02, 1.04, 0.95], tail: 1.4, fins: 1.3, pat: [0.55, 0, 0, 1] },
  { name: 'lantern', body: '#1e2650', fin: '#35458a', belly: '#6170b0', glow: '#ffe45c', size: [1.22, 0.9, 1.18], tail: 0.9, fins: 0.9, pat: [0.55, 0, 0, 1] },
  { name: 'perch', world: 'village', body: '#7a8f3a', fin: '#f0702c', belly: '#f5e4a2', glow: '#2e3a17', size: [1.08, 0.98, 0.96], tail: 1.05, fins: 1.1, pat: [0, 2.2, 0, 0] },
  { name: 'betta', world: 'conservatory', body: '#c42a7c', fin: '#ff78c4', belly: '#ffc6e6', glow: '#7cf0c0', size: [0.95, 0.92, 0.9], tail: 1.8, fins: 1.7, pat: [0.2, 0, 0, 1] },
  { name: 'gummy', world: 'candy', body: '#ff3a52', fin: '#ff7a8c', belly: '#ffb0bc', glow: '#fff0f4', size: [1.0, 1.08, 0.92], tail: 1.15, fins: 1.1, pat: [0.5, 0, 0, 1] },
  { name: 'trout', world: 'forest', body: '#5c7240', fin: '#93a06c', belly: '#f2b8a8', glow: '#1f2614', size: [0.82, 1.22, 0.8], tail: 1.0, fins: 0.9, pat: [0.8, 0, 0.022, 0] },
  { name: 'tetra', world: 'rooftops', body: '#1b2142', fin: '#5368b8', belly: '#e8374a', glow: '#3ce8ff', size: [0.9, 1.05, 0.85], tail: 1.0, fins: 0.95, pat: [0, 0, 0.026, 1] },
  { name: 'inkblot', world: 'corridor', body: '#ead9b0', fin: '#6e4a2a', belly: '#fff4d8', glow: '#22180f', size: [1.1, 1.0, 1.0], tail: 1.2, fins: 1.15, pat: [0.38, 0, 0, 0] },
  { name: 'sunfish', world: 'causeway', body: '#ffae1a', fin: '#ff6a18', belly: '#fff0b4', glow: '#fff8d0', size: [1.38, 0.8, 1.05], tail: 0.95, fins: 1.25, pat: [0.6, 0, 0, 1] },
  { name: 'gar', world: 'hell', body: '#2a1716', fin: '#5c1c12', belly: '#6e2a1a', glow: '#ff5a14', size: [0.68, 1.45, 0.68], tail: 1.0, fins: 0.75, pat: [0.75, 0, 0.016, 1] },
  { name: 'angel', world: 'time', body: '#f5ecd6', fin: '#e9c46a', belly: '#fffaf0', glow: '#c99633', size: [1.5, 0.84, 0.72], tail: 1.35, fins: 1.6, pat: [0, 1.6, 0, 0.25] },
  { name: 'clown', world: 'ocean', body: '#ff7414', fin: '#ff9640', belly: '#ffae6a', glow: '#ffffff', size: [1.1, 0.88, 1.0], tail: 0.95, fins: 1.15, pat: [0, 1.25, 0, 0.35] },
  { name: 'mackerel', world: 'coast', body: '#2f6a78', fin: '#4d6f7a', belly: '#e4ebee', glow: '#ffb347', size: [0.8, 1.2, 0.82], tail: 1.05, fins: 0.9, pat: [0, 2.6, 0, 0.25] },
  { name: 'char', world: 'frost', body: '#4b2152', fin: '#2ea597', belly: '#e58cba', glow: '#7ff2e2', size: [0.92, 1.12, 0.9], tail: 1.05, fins: 1.0, pat: [0.5, 0, 0, 1] },
  { name: 'comet', world: 'space', body: '#9a2e22', fin: '#d85a3a', belly: '#f2a684', glow: '#fff0c8', size: [1.05, 1.0, 1.1], tail: 1.3, fins: 1.4, pat: [0.3, 0, 0, 1] },
];
// (the five that turn up anywhere)
const ANYWHERE = CATCHES.map((K, i) => (K.world ? -1 : i)).filter((i) => i >= 0);
// (the palette slots a catch is drawn with: see COL)
const FISH_SLOTS = [
  [13, 'body'],
  [14, 'fin'],
  [29, 'belly'],
  [31, 'glow'],
];
// Where he casts, round him (yaw: 0 straight ahead, + to his left; dist: m
// out along it). Each cast's dealt one of these, never the one before, and
// lands somewhere new inside it.
const CASTS = [
  { name: 'ahead', yaw: [-0.5, 0.5], dist: [5, 8] },
  { name: 'left', yaw: [0.95, 1.75], dist: [3, 4.8] },
  { name: 'right', yaw: [-1.75, -0.95], dist: [3, 4.8] },
  { name: 'behind', yaw: [2.35, 3.93], dist: [2.4, 3.6] },
];
// The fish slipping the hook, and the cast for the next (s): how long he
// runs between drops (at least, plus up to; the first a little sooner); how
// long the dropped one is followed (at most); from the drop to the cast,
// the rod drawn back, the flick, the line flying out; the bite (at least,
// plus up to); the strike (the rod yanked up) and the reel in.
const HOOK = {
  every: [12, 10],
  first: [8, 7],
  // (into a new world, his first cast for its own fish comes soon)
  fresh: [2.5, 2],
  drop: 1.3,
  cast: 0.5,
  load: 0.3,
  flick: 0.14,
  fly: 0.46,
  bite: [0.36, 0.3],
  strike: 0.15,
  reel: 0.85,
};
// The little things he does as he runs with a fish on (dealt every few
// seconds, never the same twice running): a glance back over his shoulder
// at it; a look out to one side of the road, as if for water; the rod
// jigged twice, bouncing it; the rod hefted up to admire it.
const GESTURES = ['glance', 'scan', 'jig', 'heft', 'glance', 'scan'];
const GESTURE_EVERY = [2.2, 3.2];
const GESTURE_DUR = { glance: 1.0, scan: 1.25, jig: 0.7, heft: 1.15 };
// The fish fights on the line: every so often (at least, plus up to; s) a
// burst of thrashing (s), its tail lashing and its body flexing, kicking
// itself out on its line.
const FIGHT = { every: [0.9, 1.8], dur: [0.35, 0.4], rate: 21 };
// (a fish too small to see: how a dropped one is hidden)
const HIDDEN = 1e-3;

// Deal from a deck of 0..n-1, refilled and shuffled whenever it's empty -
// never the one just had (last).
function deal(deck, n, last) {
  if (!deck.length) {
    for (let i = 0; i < n; i++) if (i !== last) deck.push(i);
    for (let i = deck.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[k]] = [deck[k], deck[i]];
    }
  }
  let k = deck.pop();
  if (k === last && deck.length) {
    const j = deck.pop();
    deck.unshift(k);
    k = j;
  }
  return k;
}
const pick = (r) => r[0] + (r[1] - r[0]) * Math.random();
// The same from a pool of indices (a pool may hold one more than once).
function dealFrom(deck, pool, last) {
  if (!deck.length) {
    for (const i of pool) if (i !== last) deck.push(i);
    for (let i = deck.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[k]] = [deck[k], deck[i]];
    }
    if (!deck.length) deck.push(pool[0]);
  }
  return deck.pop();
}
// The world's own fish (an index into CATCHES; -1 if it has none).
const themed = (id) => CATCHES.findIndex((K) => K.world && K.world === id);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _o1 = new THREE.Vector3();
const _o2 = new THREE.Vector3();
const _before = new THREE.Vector3();
const _h0 = new THREE.Vector3();
const _h1 = new THREE.Vector3();
const _h2 = new THREE.Vector3();
const _h3 = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _hq2 = new THREE.Quaternion();
const _hm = new THREE.Matrix4();
const _rest = new THREE.Vector3();
const _da = new THREE.Vector3();
const _db = new THREE.Vector3();
const _lm = new THREE.Matrix4();
const _lm2 = new THREE.Matrix4();
const _lv = new THREE.Vector3();
const _wag = new THREE.Matrix4();
const _wag2 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);

const mix = (a, b, k) => a + (b - a) * k;
// (how much of his chest's swing through each stride his arm takes out of
// the rod's: it'd lever the fish about at the end of it)
const ROD_STEADY = 0.85;
const bump = (a, b, c, d, x) => smooth(a, b, x) * (1 - smooth(c, d, x));
// Keys [time, ...values] eased one into the next (smoothly), at t: into out.
function keyed(K, t, out) {
  let i = 0;
  while (i < K.length - 2 && t >= K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1];
  const u = smooth(a[0], b[0], t);
  for (let j = 1; j < a.length; j++) out[j - 1] = a[j] + (b[j] - a[j]) * u;
  return out;
}
const _key = [0, 0, 0, 0, 0];
// (a yaw put back into -pi..pi)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Fisher extends Player {
  constructor(envDef, asset) {
    super(envDef, asset, { gait: STYLES[0], feel: FEEL });
    // (his rod and the fish reach up and out behind him)
    this.castR = 1.0;
    this.castTop = 2.0;
  }

  configure() {
    super.configure();
    // his two runs, whole, and the one he's running in: a copy of its own
    // (the blend between them is written into it)
    this.gaits = STYLES.map(({ name, ...over }) => merge(this.gait, over));
    this.gait = JSON.parse(JSON.stringify(this.gaits[0]));
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    const R = this.rig;
    const rig = [
      new THREE.Vector4(R.eye[0], R.eye[1], -0.088, R.mouth[0]),
      new THREE.Vector4(R.bib.top, R.bib.half, R.bootX, R.soleH),
      new THREE.Vector4(R.jacket.hem, R.jacket.cuff, R.tank.half, R.trousers.hem),
    ];
    // (uFish: how the catch on his line is marked; see CATCHES)
    const mats = makeCharacterMaterials(this.u, palette(COL), rig, 0.0062, null, { style: 'fisher', uniforms: { uFish: { value: new THREE.Vector4(...CATCHES[0].pat) } } });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.buildBody();
    this.dust = new Dust(this.u);
    this.splashes = new Splashes(this.u);
    this.tank = new Tank(this.u, R.tank, this.b);
    this.buildRod();
    // the line while it's out (on runner space, so with the runner)
    this.line = new CastLine(COL[16], COL[24]);
    this.root.add(this.line.mesh);
    this.applyCatch(this.hook?.kind ?? 0);
  }

  // The frames the rod and the fish are posed by: the rod as it rides on
  // his shoulder (from his chest), where his right fist holds it, the fish
  // hanging from its tip.
  buildRod() {
    const R = this.rig;
    const bindOf = (n) => new THREE.Matrix4().copy(this.boneInv[n]).invert();
    this.rodBind = bindOf('rod');
    // (the rod's rest on his shoulder, from the chest's frame)
    this.relRod = bindOf('chest').invert().multiply(this.rodBind);
    // his right fist round the grip (bind space): +y toward the thumb, up
    // the rod; +z down the hanging arm, toward the knuckles
    const ar = R.armRest;
    const y = new THREE.Vector3(0, 0, -1);
    const z = new THREE.Vector3(Math.sin(ar), -Math.cos(ar), 0);
    const x = new THREE.Vector3().crossVectors(y, z);
    const M = new THREE.Matrix4().makeBasis(x, y, z).setPosition(...R.grip.R);
    this.relHeld = bindOf('handR').invert().multiply(M);
    this.relHeldInv = this.relHeld.clone().invert();
    // (the grip in the rod's own frame: at its origin, turned so the fist's
    // knuckles face out and forward, the thumb up the rod)
    this.gripRoll = new THREE.Matrix4().makeRotationY(-0.35);
    // his left fist the same (its hanging arm mirrored), for when he takes
    // the rod in both hands to cast and winds the reel
    const zl = new THREE.Vector3(-Math.sin(ar), -Math.cos(ar), 0);
    const xl = new THREE.Vector3().crossVectors(y, zl);
    const ML = new THREE.Matrix4().makeBasis(xl, y, zl).setPosition(...R.grip.L);
    this.relHeldLInv = bindOf('handL').invert().multiply(ML).invert();
    // (where on the rod it goes, in the rod's own frame: low on the butt
    // below his right fist; and the reel's crank - its axle, and how far
    // out the knob turns from it)
    this.buttGrip = new THREE.Vector3(0, -0.165, 0);
    this.crankAxle = new THREE.Vector3(-0.055, 0.072, 0.064);
    this.crankR = 0.036;
    this.tipLocal = new THREE.Vector3(...R.rod.tip);
    this.rodF = new THREE.Matrix4();
    this.rodPivot = new THREE.Vector3(0, 0.27, 0); // (where it rests on his shoulder, along it)
    this.lineLen = R.rod.line;
    // the fish's centre of mass, below the hook (m), and how big it is (as
    // dressed for whichever catch is on: applyCatch)
    this.catchSize = new THREE.Vector3(1, 1, 1);
    this.catchL = R.rod.line + 0.2;
    this.catchR = 0.1;
    this.fishCols = R.colliders.map((c) => ({ ...c, a: c.a && new THREE.Vector3(...c.a), b: c.b && new THREE.Vector3(...c.b), c: c.c && new THREE.Vector3(...c.c), r: c.r && new THREE.Vector3(...c.r) }));
    this.cols = this.fishCols.map((c) => ({ kind: c.kind, c: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), ax: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], r: [0, 0, 0], ra: c.ra || 0, rb: c.rb || 0 }));
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points, this.splashes.mesh];
  }

  forCompile(on) {
    this.dust.forCompile(on);
    this.splashes.forCompile(on);
    this.tank.forCompile(on);
    this.line.forCompile(on);
  }

  // --- state ------------------------------------------------------------------------
  buildSim() {
    super.buildSim();
    // the fish: a point mass swinging off the rod's tip (runner space, the
    // world's axes), its twist about the line, its tail and fins
    this.fish = { p: new THREE.Vector3(), q: new THREE.Vector3(), tip: new THREE.Vector3(), tipV: new THREE.Vector3(), ready: false };
    this.twist = new Spring();
    this.tailS = new Spring();
    this.finS = new Spring();
    this.rodBob = new Spring();
    this.rodSway = new Spring();
    this.packS = { y: new Spring(), x: new Spring(), z: new Spring() };
    // the fish slipping the hook and the cast for the next (hookStep)
    this.hook = {
      on: false,
      t: 0,
      next: 0,
      kind: 0,
      nextKind: 0,
      kinds: [],
      sides: [],
      side: -1,
      yaw: 0,
      dist: 0,
      R0: 0,
      lost: false,
      reeled: false,
      landed: false,
      grounded: false,
      flopT: 0,
      target: new THREE.Vector3(),
      tip: new THREE.Vector3(),
      dp: new THREE.Vector3(),
      dv: new THREE.Vector3(),
      dq: new THREE.Quaternion(),
      dw: new THREE.Vector3(),
      rp: new THREE.Vector3(),
      rv: new THREE.Vector3(),
    };
    this.lookS = new Spring();
    this.pitchS = new Spring();
    // the little things he does as he runs (GESTURES), and the fish's fight
    this.gest = { kind: null, t: 0, next: 2, side: 1, deck: [], last: null };
    this.fight = { t: 9, dur: 0, next: 1, side: 1 };
    this.crankA = 0;
    this.lift = 0;
    this.wag = 0;
    this.fishQ = new THREE.Quaternion();
    this.fishH = 1 / 120;
  }

  resetSim() {
    super.resetSim();
    this.deck = this.deck || [];
    this.trick = this.trick || 'puddle';
    this.lastDt = 0;
    this.greetT = 9;
    this.tilt = 0;
    this.spin = 0;
    this.dodgeT = 9;
    this.dodgeDir = 1;
    this.takeoffT = 9;
    if (this.fish) this.fish.ready = false;
    for (const s of [this.twist, this.tailS, this.finS, this.rodBob, this.rodSway]) s?.reset();
    for (const s of Object.values(this.packS || {})) s.reset();
    this.prevAng = null;
    // (every run starts with the alien on the line, the next drop a little
    // way off)
    if (this.hook) {
      const H = this.hook;
      H.on = false;
      H.next = pick(HOOK.first);
      H.kinds.length = 0;
      H.sides.length = 0;
      H.side = -1;
      H.world = null;
      H.fresh = false;
      this.lookS.reset();
      this.pitchS.reset();
      this.gest.kind = null;
      this.gest.next = pick(GESTURE_EVERY);
      this.fight.t = 9;
      this.fight.next = pick(FIGHT.every);
      this.applyCatch(0);
      this.line?.hide();
    }
    this.tank?.reset();
    this.dust?.clear();
    this.splashes?.clear();
    // (a fresh run starts in either)
    if (this.gaits) {
      this.runStyle = Math.random() < 0.5 ? 0 : 1;
      this.styleX = this.styleK = this.runStyle;
      this.styleNext = STYLE_HOLD[0] + STYLE_HOLD[1] * Math.random();
      blendGait(this.gait, this.gaits[0], this.gaits[1], this.styleK);
    }
  }

  update(dt, speed, groundAt) {
    this.lastDt = dt;
    this.prevX = this.x;
    this.prevY = this.y;
    this.hookClock(dt);
    this.gestureStep(dt);
    this.styleStep(dt);
    this.greetT += dt;
    this.dodgeT += dt;
    this.takeoffT += dt;
    super.update(dt, speed, groundAt);
  }

  place(z, dist = 0) {
    super.place(z);
    this.dust.update(this.lastDt, this.root, z, dist);
    this.splashes.update(this.lastDt, this.root, z, dist);
    this.lastDt = 0;
  }

  // Every few seconds of the run he changes how he runs (STYLES), with his
  // feet on the road, easing from one into the other over a couple of
  // strides.
  styleStep(dt) {
    if (this.mode === 'run' && !this.crashed) {
      this.styleNext -= dt;
      const free = this.grounded && !this.sliding && this.w.run > 0.9 && this.speed > 4;
      if (free && this.styleNext <= 0) {
        this.runStyle = 1 - this.runStyle;
        this.styleNext = STYLE_HOLD[0] + STYLE_HOLD[1] * Math.random();
      }
    }
    const x = this.styleX + clamp(this.runStyle - this.styleX, -dt / STYLE_EASE, dt / STYLE_EASE);
    if (x === this.styleX) return;
    this.styleX = x;
    this.styleK = x * x * (3 - 2 * x);
    blendGait(this.gait, this.gaits[0], this.gaits[1], this.styleK);
  }

  // Keep to one run (by name) from now on (the viewer: &style=).
  holdStyle(name) {
    const i = STYLES.findIndex((S) => S.name === name);
    if (i < 0) return;
    this.runStyle = i;
    this.styleX = this.styleK = i;
    this.styleNext = Infinity;
    blendGait(this.gait, this.gaits[0], this.gaits[1], i);
  }

  // --- moves ------------------------------------------------------------------------
  jump() {
    // (taking off from the ground - not from just past the end of something,
    // already falling - his boots splash)
    const fromGround = this.grounded || this.bounding;
    const want = this.nextTrick;
    this.nextTrick = null;
    if (want) this.trick = want;
    else {
      if (!this.deck.length) {
        const d = TRICKS.slice();
        for (let i = d.length - 1; i > 0; i--) {
          const k = Math.floor(Math.random() * (i + 1));
          [d[i], d[k]] = [d[k], d[i]];
        }
        if (d[d.length - 1] === this.trick) d.reverse();
        this.deck = d;
      }
      this.trick = this.deck.pop();
    }
    super.jump();
    this.jumpSide = Math.random() < 0.5 ? -1 : 1;
    this.takeoffT = 0;
    if (fromGround && this.mode === 'run' && !this.crashed) this.bootSplash(false, 1);
  }

  onLand(hit) {
    if (this.crashed || this.mode !== 'run') return;
    // the fish swings on down a moment after he's stopped
    this.tailS.v += 3 * hit;
    this.bootSplash(true, hit);
  }

  onDodge(dir) {
    this.dodgeT = 0;
    this.dodgeDir = dir;
  }

  // Water springs up from under his boots: where each one leaves the road
  // as he takes off (a small, quick spray, drops trailing off the soles),
  // or where it comes down as he lands (a bigger splash, flung outward) -
  // at the road under him, wherever that is (a rooftop, a walk up on a
  // wall). Only on land (none underwater), and only to look at.
  bootSplash(land, hit) {
    if (this.submerged || !this.toeAt) return;
    const g = this.groundY || 0;
    const run = _dv.set(this.vx, 0, -this.speed).applyQuaternion(this.invQ);
    for (let side = 0; side < 2; side++) {
      // (the sole's middle, a little behind the ball of the boot - where it
      // was last frame, a moment before it touched - on the road under him)
      _p.copy(this.toeAt[side]);
      _p.y = g - this.y + 0.004;
      _p.z += 0.045;
      this.splashes.burst(_p, run, land, hit * (side ? 1 : 0.85 + 0.15 * Math.random()), side);
    }
  }

  // Just after take-off, drops shake off his soles and fall away behind
  // them.
  shedDrops() {
    if (this.submerged || this.grounded || this.takeoffT > 0.16 || this.crashed || Math.random() > 0.55) return;
    const run = _dv.set(this.vx * 0.6, this.vy * 0.35, -this.speed * 0.72).applyQuaternion(this.invQ);
    for (let side = 0; side < 2; side++) {
      if (Math.random() < 0.4) continue;
      _p.copy(this.toeAt[side]);
      _p.y -= 0.06;
      _p.z += 0.04 + 0.04 * Math.random();
      _p.x += (Math.random() - 0.5) * 0.06;
      this.splashes.shed(_p, run, 0.012 + 0.01 * Math.random());
    }
  }

  // Picked on the title screen: he hoists the fish up proudly - a shake of
  // the rod that sets it swinging - and a splash at his boots.
  greet() {
    this.greetT = 0;
    this.twist.v += 5;
    this.tailS.v += 8;
  }

  // --- poses --------------------------------------------------------------------------
  // His runs (STYLES): the shared run under them; the right arm's whatever
  // it is - it's solved onto the rod in afterPose.
  poseRun(r, f, sp) {
    super.poseRun(r, f, sp);
    // his hips ride each stride in a rounder wave than the shared run's
    // (which drops into every footfall like a bounced ball): they sink into
    // the footfall and float up out of it with no corner at the bottom -
    // and the legs are placed again under them
    const ST = this.gait.stride;
    const round = 0.5 - 0.5 * Math.cos(2 * f);
    const ball = Math.pow(Math.abs(Math.sin(f)), 0.8);
    r[C.hipY] = ST.hipY + ST.bob * (0.9 + 0.2 * sp) * (0.8 * round + 0.2 * ball);
    this.runLegs(r, f, sp);
    const k = this.styleK;
    const p = 1 - k;
    // pump: upright, chin up, eyes ahead
    // reach: his head a little down and forward
    r[C.hdPitch] += -0.07 * p + 0.1 * k;
    r[C.chLean] += 0.06 * k;
    // (his free hand loose at the wrist, trailing the forearm's swing a
    // little)
    const lag = Math.sin(f + Math.PI - 0.9);
    r[C.wrL] = 0.14 + 0.1 * k + 0.1 * lag;
    r[C.wrLz] = 0.12 * k;
    // (the right arm's held at the rod: only the shoulder rolls with the
    // stride)
    r[C.clRy] *= 0.3;
    r[C.clR] = 0.02;
  }

  // Standing: easy and pleased with himself, his weight on one foot and
  // then the other, the rod on his shoulder, his free arm loose, looking
  // about - and when he's picked, up on his toes with a wave.
  poseIdle(id, t) {
    const ws = super.poseIdle(id, t);
    const br = Math.sin(t * 1.8);
    id[C.hdPitch] = -0.02 + 0.03 * Math.sin(t * 0.6);
    // (stood up straight on straight legs, his free arm hanging close)
    id[C.hipY] = this.HIP_Y - 0.004 + 0.003 * br;
    id[C.hipPitch] = 0;
    id[C.spLean] = 0.035 + 0.01 * br;
    id[C.chLean] = 0.0;
    id[C.shLz] = 0.2 + 0.02 * ws;
    id[C.elL] = 0.3 + 0.03 * br;
    // a sturdy stance: his boots planted wider than most, under his hips,
    // the heel of the free one lifting a little as his weight leaves it
    for (let side = 0; side < 2; side++) {
      const sx = side ? 1 : -1;
      const lift = 0.2 * smooth(0.3, 1, -sx * ws);
      const ay = this.ANKLE_H - this.TOE_D + this.TOE_D * Math.cos(lift) + this.TOE_F * Math.sin(lift);
      this.plantFoot(id, side, sx * 0.13 + id[C.hipX] * 0.3, ay, side ? 0.02 : -0.01, -lift);
      id[side ? C.toR : C.toL] = lift;
    }
    // the greeting: his free hand up in a wave, his chin up
    const g = bump(0.0, 0.2, 1.1, 1.5, this.greetT);
    id[C.spLean] -= 0.06 * g;
    id[C.hdPitch] -= 0.1 * g;
    id[C.shLx] = mix(id[C.shLx], 0.35, g);
    id[C.shLz] = mix(id[C.shLz], 2.4, g);
    id[C.elL] = mix(id[C.elL], 0.9 + 0.35 * Math.sin(this.greetT * 14), g);
    id[C.wrLz] = mix(0, 0.3 * Math.sin(this.greetT * 14), g);
    return ws;
  }

  // How far through the jump he is (0 take-off .. 1 landing), from the plain
  // arc's speed: a fast-fall hurries it round.
  jumpU() {
    return clamp((this.V0 - this.vyPose) / (2 * this.V0), 0, 1);
  }

  poseJump(j) {
    this.tilt = 0;
    this.spin = 0;
    const u = this.jumpU();
    j.fill(0);
    j[C.hipY] = this.HIP_Y;
    j[C.sq] = 1;
    // off the road: a crouch exploding up
    const k = 1 - smooth(0.0, 0.14, u);
    j[C.thLx] += 0.45 * k;
    j[C.thRx] += 0.15 * k;
    j[C.knL] += 0.5 * k;
    j[C.knR] += 0.25 * k;
    j[C.spLean] += 0.2 * k;
    if (this.trick === 'puddle') this.posePuddle(j, u);
    else if (this.trick === 'star') this.poseStar(j, u);
    else this.poseStride(j, u);
    if (this.jumpSide < 0 && this.trick === 'stride') mirror(j);
  }

  // The puddle jump: both boots pulled up together under him, knees high,
  // his free arm up for balance, eyes down on where he'll land - and down
  // feet first, together, into the stomp.
  posePuddle(j, u) {
    const tuck = bump(0.06, 0.26, 0.6, 0.86, u);
    const land = smooth(0.7, 1.0, u);
    j[C.thLx] += 1.35 * tuck + 0.55 * land;
    j[C.thRx] += 1.3 * tuck + 0.5 * land;
    j[C.knL] += 2.0 * tuck + 0.55 * land;
    j[C.knR] += 1.95 * tuck + 0.5 * land;
    j[C.anL] = -0.45 * tuck + 0.1 * land;
    j[C.anR] = -0.45 * tuck + 0.1 * land;
    j[C.thLz] = 0.05;
    j[C.thRz] = 0.05;
    j[C.spLean] += 0.22 * tuck + 0.18 * land;
    j[C.hdPitch] = 0.2 * tuck + 0.12;
    j[C.shLx] = 0.5 * tuck + 0.3;
    j[C.shLz] = 0.9 * tuck + 0.5 * land + 0.3;
    j[C.elL] = 0.8 + 0.3 * tuck;
    j[C.wrL] = 0.2;
    this.tilt = -0.1 * tuck;
  }

  // The stride leap: a big step through the air, the front knee up and the
  // back leg trailing; his free arm thrown up high.
  poseStride(j, u) {
    const fly = bump(0.06, 0.22, 0.7, 0.9, u);
    const land = smooth(0.72, 1.0, u);
    j[C.thLx] += 1.35 * fly + 0.8 * land;
    j[C.knL] += 1.3 * fly + 0.7 * land;
    j[C.anL] = -0.25 * fly;
    j[C.thRx] += -0.6 * fly + 0.2 * land;
    j[C.knR] += 0.5 * fly + 0.8 * land;
    j[C.anR] = -0.5 * fly;
    j[C.thLz] = 0.07;
    j[C.thRz] = 0.07;
    j[C.spLean] += 0.1 * fly + 0.2 * land;
    j[C.hdPitch] = 0.05;
    j[C.shLx] = 2.6 * fly + 0.5 * land;
    j[C.shLz] = 0.35 + 0.3 * land;
    j[C.elL] = 0.35 * fly + 0.5 * land;
    j[C.wrL] = -0.2 * fly;
    j[C.chTwist] = 0.1 * fly;
  }

  // The star: arms and legs flung out wide at the top - the rod held up
  // out to the side - then snapped back in to land.
  poseStar(j, u) {
    const star = bump(0.1, 0.3, 0.55, 0.78, u);
    const land = smooth(0.7, 1.0, u);
    j[C.thLx] += 0.15 * star + 0.6 * land;
    j[C.thRx] += 0.15 * star + 0.55 * land;
    j[C.knL] += 0.2 * star + 0.6 * land;
    j[C.knR] += 0.2 * star + 0.55 * land;
    j[C.thLz] = 0.55 * star + 0.05;
    j[C.thRz] = 0.55 * star + 0.05;
    j[C.anL] = -0.3 * star;
    j[C.anR] = -0.3 * star;
    j[C.spLean] += -0.1 * star + 0.2 * land;
    j[C.hdPitch] = -0.15 * star + 0.1;
    j[C.shLx] = 0.3 * star + 0.4 * land;
    j[C.shLz] = 1.9 * star + 0.4 * land + 0.2;
    j[C.elL] = 0.15 + 0.4 * land;
  }

  // The duck: a skid on his boots, crouched right down on his heels as if
  // on a wet slipway, his free arm out behind for balance, the rod held up
  // on his shoulder out of the way, leaning back a little.
  poseSlide(s, t) {
    if (this.slideT > 0) this.slideU = 1 - clamp(this.slideT / CONFIG.slide.time, 0, 1);
    const u = this.slideU ?? 1;
    const k = smooth(0.0, 0.12, u) * (1 - smooth(0.78, 1.0, u));
    s.fill(0);
    s[C.sq] = 1;
    s[C.hipY] = mix(this.HIP_Y - 0.08, 0.36, k);
    s[C.hipPitch] = -0.12 * k;
    s[C.hipYaw] = 0.18 * k;
    s[C.spLean] = 0.55 * k + 0.05;
    s[C.chLean] = 0.12 * k;
    s[C.hdPitch] = 0.35 * k - 0.05;
    s[C.hdYaw] = -0.15 * k;
    const A = this.ANKLE_H;
    // (wobbling a little on the skid)
    const wob = 0.012 * Math.sin(t * 23) * k;
    this.plantFoot(s, 0, -0.13, A, mix(-0.1, -0.24, k) + wob, 0.1 * k);
    this.plantFoot(s, 1, 0.14, A, mix(0.04, 0.02, k) - wob, 0.05 * k);
    // the free arm out behind and down for balance
    s[C.shLx] = -0.75 * k;
    s[C.shLz] = 0.75 * k + 0.25;
    s[C.elL] = 0.3;
    s[C.wrL] = -0.3 * k;
    this.tilt = 0;
  }

  // He lands with a stomp: both boots down at once, deep into his knees,
  // his free arm swung down, and back up.
  landOverlay(Pz, land) {
    const d = Math.max(0, land), p = Math.max(0, -land);
    Pz[C.hipY] += -0.12 * d + 0.025 * p;
    Pz[C.knL] += 0.68 * d;
    Pz[C.knR] += 0.68 * d;
    Pz[C.thLx] += 0.38 * d;
    Pz[C.thRx] += 0.38 * d;
    Pz[C.anL] += 0.3 * d;
    Pz[C.anR] += 0.3 * d;
    Pz[C.thLz] += 0.06 * d;
    Pz[C.thRz] += 0.06 * d;
    Pz[C.spLean] += 0.3 * d - 0.08 * p;
    Pz[C.hdPitch] += 0.1 * d - 0.06 * p;
    Pz[C.shLx] += -0.35 * d + 0.25 * p;
    Pz[C.shLz] += 0.4 * d;
    Pz[C.elL] -= 0.3 * d;
    Pz[C.sq] += -0.08 * d + 0.03 * p;
  }

  // A lane change: a skip across, leaning in, the free arm out for balance.
  laneOverlay(Pz, lc, dt) {
    super.laneOverlay(Pz, lc, dt);
    const x = this.dodgeT / 0.32;
    const e = x < 1 ? smooth(0, 0.25, x) * (1 - smooth(0.5, 1, x)) : 0;
    const w = this.w.run * (1 - (this.crashW || 0));
    Pz[C.hipY] += 0.03 * Math.sin(Math.PI * Math.min(1, x)) * w * (x < 1 ? 1 : 0);
    Pz[C.shLz] += 0.5 * e * w;
    Pz[C.elL] -= 0.3 * e * w;
  }

  // (an elbow never bends backward.) His whole body goes into a cast, and
  // into the little things he does between them; and his eyes are always
  // on something - the fish as it goes, where he's casting, the new one
  // coming in, the fish on his line, the side of the road.
  applyPose(Pz, roll) {
    const dt = this.lastDt || 0;
    const live = 1 - (this.crashW || 0);
    if (this.hook?.on) this.castPose(Pz, live);
    else if (this.gest?.kind) this.gesturePose(Pz, live);
    const want = this.lookWant();
    const look = this.lookS ? this.lookS.step(want[0], 6, 0.72, dt) : 0;
    const lp = this.pitchS ? this.pitchS.step(want[1], 6, 0.72, dt) : 0;
    Pz[C.hdYaw] += look * live;
    Pz[C.chTwist] += 0.3 * look * live;
    Pz[C.spTwist] += 0.12 * look * live;
    Pz[C.hdPitch] += lp * live;
    Pz[C.elL] = Math.max(0, Pz[C.elL]);
    Pz[C.elR] = Math.max(0, Pz[C.elR]);
    super.applyPose(Pz, roll);
  }

  // The phases of the cast (s from the drop): the cast begins, the rod's
  // loaded, flicked, the strike, and the new catch is in.
  castTimes() {
    const H = this.hook;
    const C0 = HOOK.cast, L1 = C0 + HOOK.load, F1 = L1 + HOOK.flick, S1 = H.R0 + HOOK.strike;
    return [C0, L1, F1, S1, H.R0 + HOOK.reel];
  }

  // His body through the cast: a jolt as the fish comes off, his free arm
  // flung out after it; then, winding up, twisted away from where he's
  // casting and leaning back, the rod loaded behind him; the whip of the
  // flick, his whole body turning into it and leaning on through; leaning
  // out toward it, watching, while it bites; hauled back, upright, on the
  // strike; and easing back into his run as he reels the new one in.
  castPose(Pz, live) {
    const H = this.hook, t = H.t;
    const [C0, L1, F1, S1, E] = this.castTimes();
    const yaw = wrap(H.yaw);
    const sgn = yaw >= 0 ? 1 : -1;
    const m = 0.45 + 0.55 * Math.min(1, Math.abs(yaw));
    // [t, twist toward the cast, lean (+ forward), head pitch (+ down)]
    const K = keyed([
      [0, 0, 0, 0],
      [0.14, 0, -0.12, -0.08],
      [C0, 0, 0.04, 0.02],
      [L1, -0.55, -0.2, -0.12],
      [F1, 0.62, 0.3, 0.06],
      [F1 + 0.2, 0.44, 0.18, 0.14],
      [H.R0 - 0.04, 0.34, 0.12, 0.16],
      [S1, 0.1, -0.32, -0.16],
      [S1 + 0.3, 0.06, -0.12, -0.02],
      [E, 0, 0, 0],
    ], t, _key);
    const w = live * this.w.run;
    const tw = K[0] * sgn * m;
    Pz[C.chTwist] += 0.62 * tw * w;
    Pz[C.spTwist] += 0.42 * tw * w;
    Pz[C.spLean] += K[1] * w;
    Pz[C.chLean] += 0.4 * K[1] * w;
    Pz[C.hdPitch] += K[2] * w;
    // (and as the rod's flicked, his shoulders roll into it)
    Pz[C.spSide] += -0.1 * sgn * bump(L1 - 0.05, F1, F1 + 0.1, F1 + 0.35, t) * w;
    // the fish comes off: his free arm flung out after it
    const r = bump(0.0, 0.1, 0.32, C0 + 0.15, t) * w;
    Pz[C.shLx] = mix(Pz[C.shLx], 0.75, r);
    Pz[C.shLz] = mix(Pz[C.shLz], 0.85, r);
    Pz[C.elL] = mix(Pz[C.elL], 0.25, r);
    Pz[C.wrL] = mix(Pz[C.wrL], -0.3, r);
  }

  // The little things between casts (GESTURES).
  gesturePose(Pz, live) {
    const G = this.gest, t = G.t, d = GESTURE_DUR[G.kind];
    const e = bump(0, 0.22, d - 0.3, d, t) * live * this.w.run;
    if (G.kind === 'heft') {
      // proud of it: chin up, chest out
      Pz[C.spLean] -= 0.09 * e;
      Pz[C.chLean] -= 0.08 * e;
      Pz[C.hdPitch] -= 0.06 * e;
    } else if (G.kind === 'jig') {
      Pz[C.spLean] += 0.05 * e;
      Pz[C.chTwist] -= 0.08 * e;
    } else if (G.kind === 'glance') {
      // a look back over his shoulder, his shoulders turning with it
      Pz[C.spLean] -= 0.04 * e;
    } else if (G.kind === 'scan') {
      Pz[C.hdRoll] += 0.06 * G.side * e;
    }
  }

  // Where he looks (head yaw, + to his left; pitch, + down), from what
  // he's looking at (simulation space).
  lookWant() {
    const H = this.hook;
    const out = this._look || (this._look = [0, 0]);
    out[0] = out[1] = 0;
    if (!H || this.mode !== 'run' || this.crashed) return out;
    let P = null, w = 1;
    if (H.on) {
      const t = H.t;
      const [C0, , , , E] = this.castTimes();
      if (t < C0 + 0.05) P = H.lost ? null : H.dp;
      else if (t < H.R0) P = H.target;
      else P = H.rp;
      w = 1 - smooth(E - 0.3, E, t);
    } else if (this.gest.kind) {
      const G = this.gest, d = GESTURE_DUR[G.kind];
      w = bump(0, 0.18, d - 0.3, d, G.t);
      if (G.kind === 'scan') {
        out[0] = 0.85 * G.side * w;
        out[1] = 0.1 * w;
        return out;
      }
      if (this.fish.ready) P = this.fish.p;
    } else {
      // (running, his eyes wander a little)
      out[0] = 0.12 * Math.sin(this.time * 0.53) + 0.06 * Math.sin(this.time * 1.7 + 1);
      out[1] = 0.04 * Math.sin(this.time * 0.41);
      return out;
    }
    if (!P) return out;
    const p = _lv.copy(P).applyQuaternion(_q.copy(this.root.quaternion).invert());
    const yaw = Math.atan2(-p.x, -p.z);
    const pitch = Math.atan2(1.45 - p.y, Math.hypot(p.x, p.z));
    out[0] = clamp(yaw, -1.4, 1.4) * w;
    out[1] = clamp(pitch * 0.75, -0.4, 0.5) * w;
    return out;
  }

  // Every few seconds, while he runs with a fish on, he does one of the
  // little things (GESTURES).
  gestureStep(dt) {
    const G = this.gest;
    if (!G || !this.hook) return;
    const free = this.mode === 'run' && !this.crashed && !this.hook.on && this.fish.ready;
    if (G.kind) {
      G.t += dt;
      // (the jig: a flick of the rod up, twice - the fish bounces)
      if (G.kind === 'jig' && free) {
        for (const at of [0.0, 0.3]) if (G.t - dt < at && G.t >= at) this.rodBob.v -= 2.4;
      }
      if (G.t >= GESTURE_DUR[G.kind] || !free) G.kind = null;
      return;
    }
    if (!free) return;
    G.next -= dt;
    if (G.next > 0 || this.sliding || this.w.run < 0.8) return;
    if (!G.deck.length) {
      G.deck = GESTURES.slice();
      for (let i = G.deck.length - 1; i > 0; i--) {
        const k = Math.floor(Math.random() * (i + 1));
        [G.deck[i], G.deck[k]] = [G.deck[k], G.deck[i]];
      }
    }
    let k = G.deck.pop();
    if (k === G.last && G.deck.length) k = G.deck.pop();
    G.kind = G.last = k;
    G.t = 0;
    G.side = Math.random() < 0.5 ? -1 : 1;
    G.next = pick(GESTURE_EVERY) + GESTURE_DUR[k];
  }

  // Do one of them now (the viewer: &gesture=).
  doGesture(kind) {
    if (!GESTURE_DUR[kind]) return;
    this.gest.kind = this.gest.last = kind;
    this.gest.t = 0;
    this.gest.side = 1;
    this.gest.next = 99;
  }

  // The tips of the jumps (about his middle); then the rod onto its bone
  // and his hand onto it; the fish, the tank.
  afterPose(dt, cw) {
    const live = 1 - cw;
    const b = this.body;
    const wj = this.w.jump * live;
    if (this.tilt !== 0) {
      _q.setFromAxisAngle(AX, this.tilt * wj);
      b.quaternion.premultiply(_q);
      _p.set(0, 0.9, 0);
      _v.copy(_p).applyQuaternion(_q);
      b.position.applyQuaternion(_q).add(_p).sub(_v);
    }
    this.root.matrixWorld.identity();
    b.updateWorldMatrix(false, true);
    this.placeRod(dt, live);
    this.handOnRod(live);
    this.leftOnRod(dt, live);
    // (where his boots are, for the splashes: runner space)
    if (!this.toeAt) this.toeAt = [new THREE.Vector3(), new THREE.Vector3()];
    this.toeAt[0].setFromMatrixPosition(this.b.toeL.matrixWorld);
    this.toeAt[1].setFromMatrixPosition(this.b.toeR.matrixWorld);
    this.shedDrops();
  }

  // The rod on his shoulder: carried by his chest, bouncing a little on it
  // with each stride and landing (a spring about where it rests on his
  // shoulder), swayed a touch by a lane change; hoisted when he's picked.
  placeRod(dt, live) {
    // (his arm steadies it: it rides with his chest, but only a part of the
    // chest's twist, roll and lean through each stride reaches it)
    // (half his lean it keeps - he holds it up as he leans into a run -
    // and his twist and roll hardly at all)
    this.b.chest.matrixWorld.decompose(_a, _q, _s);
    _v.set(0, 1, 0).applyQuaternion(_q);
    _q2.setFromAxisAngle(AX, 0.45 * Math.atan2(_v.z, _v.y));
    _q.slerp(_q2, ROD_STEADY * live);
    _m.compose(_a, _q, _s.set(1, 1, 1));
    this.rodF.multiplyMatrices(_m, this.relRod);
    const kick = this.pelvisD ? -this.pelvisD.y - 0.6 * (this.pelvisDP?.y || 0) : 0;
    // (a long, well-damped give: it settles in one swing, it doesn't chatter)
    this.rodBob.v += clamp(kick, -3, 3) * 0.6 * live;
    const bob = clamp(this.rodBob.step(0, 2.3, 0.55, dt), -0.16, 0.16);
    const sway = this.rodSway.step(clamp(-this.vx * 0.012, -0.12, 0.12), 2.1, 0.62, dt);
    const g = bump(0.0, 0.2, 0.5, 0.9, this.greetT);
    // (lifted for a jig, or hefted up to admire the fish)
    const G = this.gest;
    let lift = 0;
    if (G.kind === 'jig') lift = -0.34 * (bump(0, 0.06, 0.1, 0.22, G.t) + bump(0.3, 0.36, 0.4, 0.52, G.t));
    else if (G.kind === 'heft') lift = -0.4 * bump(0, 0.32, 0.75, 1.1, G.t);
    this.lift += (lift - this.lift) * Math.min(1, dt * 30);
    // (turned about where it rests on his shoulder)
    _m.makeTranslation(this.rodPivot.x, this.rodPivot.y, this.rodPivot.z);
    _m2.makeRotationFromEuler(new THREE.Euler(bob - 0.3 * g + this.lift * live, 0, sway + 0.1 * g));
    _m3.makeTranslation(-this.rodPivot.x, -this.rodPivot.y, -this.rodPivot.z);
    this.rodF.multiply(_m).multiply(_m2).multiply(_m3);
    if (this.hook.on) this.rodCast(live);
    const rod = this.b.rod;
    this.rodF.decompose(rod.position, rod.quaternion, _s);
    rod.updateMatrix();
    rod.matrixWorld.copy(this.rodF);
  }

  // His right fist round the rod's grip (a two-bone solve of the arm).
  handOnRod(live) {
    _m.copy(this.rodF).multiply(this.gripRoll).multiply(this.relHeldInv);
    this.armTo('R', _m, _v3.set(0.6, -1, 0.5), 1);
  }

  // His left hand on the rod through the cast: low on the butt below his
  // right, both hands driving the rod back and through; then down to the
  // reel's crank, winding it - slowly as the line lies out there, flat out
  // as the new catch comes in - and back to swinging free with his run.
  leftOnRod(dt, live) {
    const H = this.hook;
    if (!H.on) return;
    const t = H.t;
    const [C0, , F1, S1, E] = this.castTimes();
    const w = smooth(C0 + 0.02, C0 + 0.2, t) * (1 - smooth(E - 0.24, E - 0.04, t)) * live;
    if (w < 1e-3) return;
    this.crankA += (t < F1 + 0.3 ? 0 : t < H.R0 ? 6 : t < S1 ? 2 : 19) * dt;
    const b = smooth(F1 + 0.1, F1 + 0.34, t);
    const a = this.crankA;
    const A = this.crankAxle, r = this.crankR;
    _lv.set(A.x, A.y + r * Math.cos(a), A.z + r * Math.sin(a));
    _lv.lerpVectors(this.buttGrip, _lv, b);
    _lm.makeRotationY(-0.35).setPosition(_lv);
    _lm2.copy(this.rodF).multiply(_lm).multiply(this.relHeldLInv);
    this.armTo('L', _lm2, _v3.set(-0.7, -1, 0.4), w);
  }

  // Two-bone solve of one arm, its hand to the frame H (runner space) - the
  // wrist where H puts it, the hand turned as H turns it - its elbow bent
  // toward pole, laid over the pose by w. (As the samurai's.)
  armTo(L, H, pole, w) {
    const b = this.b;
    const arm = b['arm' + L], fore = b['fore' + L], clav = b['clav' + L], hand = b['hand' + L];
    const ua = this.UPPER_ARM, fa = this.FOREARM;
    const T = _p.setFromMatrixPosition(H);
    const S = _a.setFromMatrixPosition(arm.matrixWorld);
    const d0 = T.distanceTo(S);
    const d = clamp(d0, Math.abs(ua - fa) + 0.01, ua + fa - 0.002);
    const n = _b.subVectors(T, S).divideScalar(d0 || 1);
    const pl = _v.copy(pole).addScaledVector(n, -pole.dot(n)).normalize();
    const a = (ua * ua - fa * fa + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, ua * ua - a * a));
    const E = _v2.copy(S).addScaledVector(n, a).addScaledVector(pl, h);
    const Y = E.sub(S).negate().normalize();
    const Z = _s.copy(n).addScaledVector(Y, -n.dot(Y));
    if (Z.lengthSq() < 1e-8) Z.copy(pl);
    Z.normalize().negate();
    const X = _dv.crossVectors(Y, Z);
    _m3.makeBasis(X, Y, Z);
    _q.setFromRotationMatrix(_m3);
    clav.matrixWorld.decompose(_v, _q2, _v2);
    _q2.invert().multiply(_q);
    arm.quaternion.slerp(_q2, w);
    const cosE = clamp((ua * ua + fa * fa - d * d) / (2 * ua * fa), -1, 1);
    fore.rotation.x += (Math.PI - Math.acos(cosE) - fore.rotation.x) * w;
    arm.updateMatrixWorld(true);
    H.decompose(_v, _q, _v2);
    fore.matrixWorld.decompose(_v, _q2, _v2);
    _q2.invert().multiply(_q);
    hand.quaternion.slerp(_q2, w);
    hand.updateMatrixWorld(true);
  }

  // --- secondary motion ---------------------------------------------------------------
  simulate(dt, steps) {
    this.packStep(dt);
    if (this.hook.on) this.hookStep(dt);
    else this.catchStep(dt, steps);
    this.tank.step(dt, this.time, this.accLocal, this.mode === 'run' ? this.speed : 0);
  }

  // The tank rides on his back on its straps: a spring on each axis, kicked
  // by his own motion, about where it hangs - slower than his footfalls
  // and well damped (a full tank's heavy: it heaves and settles, it doesn't
  // rattle).
  packStep(dt) {
    const S = this.packS;
    const live = 1 - (this.crashW || 0);
    const dv = this.pelvisD, dp = this.pelvisDP;
    if (dv) {
      S.y.v += (-dv.y * 0.009 - dp.y * 0.02) * live;
      S.x.v += (-dv.x * 0.003 - dp.x * 0.011) * live;
      S.z.v += -dv.z * 0.0016 * live;
    }
    const y = clamp(S.y.step(0, 3.1, 0.55, dt), -0.022, 0.022);
    const x = clamp(S.x.step(0, 2.7, 0.58, dt), -0.018, 0.018);
    const z = clamp(S.z.step(0, 2.7, 0.58, dt), -0.018, 0.018);
    const t = this.b.tank;
    t.position.copy(this.bindPos.tank).sub(this.bindPos.chest);
    t.position.y += y;
    t.position.x += x;
    t.position.z += Math.abs(y) * 0.3 + z;
    t.rotation.set(-y * 2.2, 0, x * 2.5);
    t.updateMatrixWorld(true);
  }

  // The fish on its line: a point mass (its centre) swinging off the rod's
  // tip - pulled by gravity and pushed by his own accelerations, dragged a
  // little by the air, damped heavily (it's big and it's heavy: it sways,
  // it doesn't flap), kept within a cone under the tip and clear of his
  // head, his back, his arm and the tank. The line and the fish turn to
  // hang along it; the fish twists slowly about the line; its tail and its
  // fins follow its swings a moment late.
  catchStep(dt, steps) {
    if (dt <= 0) return;
    const F = this.fish;
    const Q = this.root.quaternion;
    const tip = _a.copy(this.tipLocal).applyMatrix4(this.rodF).applyQuaternion(Q);
    const L = this.catchL;
    // colliders into simulation space
    for (let i = 0; i < this.fishCols.length; i++) {
      const d = this.fishCols[i];
      const c = this.cols[i];
      const T = this.boneM(d.bone);
      if (d.kind === 'ell') {
        c.c.copy(d.c).applyMatrix4(T).applyQuaternion(Q);
        for (let e = 0; e < 3; e++) {
          c.ax[e].setFromMatrixColumn(T, e).normalize().applyQuaternion(Q);
          c.r[e] = d.r.getComponent(e);
        }
      } else {
        c.a.copy(d.a).applyMatrix4(T).applyQuaternion(Q);
        c.b.copy(d.b).applyMatrix4(T).applyQuaternion(Q);
        c.ra = d.ra;
        c.rb = d.rb;
      }
    }
    if (!F.ready) {
      F.p.copy(tip).addScaledVector(DOWN, L);
      F.q.copy(F.p);
      F.tip.copy(tip);
      F.ready = true;
    }
    // it fights: every so often a burst of thrashing, kicking itself out
    // sideways on its line
    const Fi = this.fight;
    Fi.t += dt;
    if (Fi.t > Fi.dur) {
      Fi.next -= dt;
      if (Fi.next <= 0) {
        Fi.t = 0;
        Fi.dur = pick(FIGHT.dur);
        Fi.next = pick(FIGHT.every);
        Fi.side = Math.random() < 0.5 ? -1 : 1;
        _v.subVectors(F.p, tip);
        _v2.set(-_v.z, 0, _v.x);
        if (_v2.lengthSq() < 1e-6) _v2.set(1, 0, 0);
        _v2.normalize().multiplyScalar(Fi.side * (1.0 + 0.6 * Math.random()));
        _v2.y = 0.5;
        F.q.addScaledVector(_v2, -this.fishH);
        this.twist.v += Fi.side * 3.5;
      }
    }
    const fe = Fi.t < Fi.dur ? bump(0, 0.05, Fi.dur * 0.55, Fi.dur, Fi.t) : 0;
    const vel = _dv.set(this.vx, this.grounded ? 0 : this.vy, -this.speed);
    const airX = -vel.x + this.breeze.x * 0.3, airZ = -vel.z + this.breeze.z * 0.3;
    // (the game's gravity is ~3x real for the runner's jump: only part of
    // his own acceleration reaches the fish - it lifts a little and swings,
    // it doesn't fly up)
    const gx = -this.frameAcc.x * 0.22, gy = -9.8 * this.gk - this.frameAcc.y * 0.15, gz = -this.frameAcc.z * 0.15;
    const h = dt / steps;
    const t0 = F.tip;
    for (let s = 0; s < steps; s++) {
      // the tip moves through the step
      const k = (s + 1) / steps;
      _p.copy(t0).lerp(tip, k);
      const p = F.p, q = F.q;
      const vx = (p.x - q.x) / h, vy = (p.y - q.y) / h, vz = (p.z - q.z) / h;
      // (a little drag: the headwind leans it back only a touch)
      const ax = gx + 0.12 * (airX * 0.08 - vx);
      const ay = gy - 0.12 * vy;
      const az = gz + 0.12 * (airZ * 0.04 - vz);
      const damp = 0.94;
      const nx = p.x + (p.x - q.x) * damp + ax * h * h;
      const ny = p.y + (p.y - q.y) * damp + ay * h * h;
      const nz = p.z + (p.z - q.z) * damp + az * h * h;
      q.copy(p);
      p.set(nx, ny, nz);
      // on its line
      _v.subVectors(p, _p);
      let len = _v.length() || 1e-6;
      _v.divideScalar(len);
      // (held within a cone under the tip: it never swings up level)
      const cosMax = Math.cos(0.52);
      if (-_v.y < cosMax) {
        const hz = Math.hypot(_v.x, _v.z) || 1e-6;
        const sinMax = Math.sqrt(1 - cosMax * cosMax);
        _v.set((_v.x / hz) * sinMax, -cosMax, (_v.z / hz) * sinMax);
      }
      p.copy(_p).addScaledVector(_v, L);
      // kept off him (its middle, and its head nearer the tip)
      this.pushOut(p, this.catchR);
      _v2.copy(_p).addScaledVector(_v, L * 0.45);
      const before = _before.copy(_v2);
      this.pushOut(_v2, 0.85 * this.catchR);
      if (_v2.distanceToSquared(before) > 0) p.add(_v2.sub(before).multiplyScalar(1.6));
      // (and back on its line)
      _v.subVectors(p, _p).normalize();
      p.copy(_p).addScaledVector(_v, L);
    }
    F.tip.copy(tip);
    this.fishH = h;
    // the line and the fish along it, turned back into runner space
    const Qi = _q2.copy(Q).invert();
    const dir = _v.subVectors(F.p, tip).normalize().applyQuaternion(Qi);
    _q.setFromUnitVectors(DOWN, dir);
    // how fast it's swinging (for its tail and fins), and its slow twist
    // about the line, nudged by its swings
    const ang = Math.atan2(dir.x, -dir.y) + Math.atan2(dir.z, -dir.y);
    const angV = this.prevAng === null ? 0 : (ang - this.prevAng) / dt;
    this.prevAng = ang;
    this.twist.v += clamp(angV, -6, 6) * 0.05;
    const tw = clamp(this.twist.step(0.08 * Math.sin(this.time * 0.6), 0.55, 0.22, dt), -0.7, 0.7);
    _q.multiply(_q2.setFromAxisAngle(AY, tw));
    const tipR = _b.copy(this.tipLocal).applyMatrix4(this.rodF);
    const c = this.b.catch;
    c.position.copy(tipR);
    c.quaternion.copy(_q);
    c.scale.copy(this.catchSize);
    c.updateMatrix();
    // (and how it hangs, in simulation space: if it slips the hook, it
    // falls from just as it was)
    this.fishQ.copy(Q).multiply(_q);
    // its tail sweeps after its swings, and on its own - never quite still
    // - its body flexing against it; in a fight, lashing; its fins fan
    const T = this.time;
    this.tailS.v += clamp(angV, -8, 8) * 0.35;
    const tail = clamp(this.tailS.step(0, 1.4, 0.36, dt), -0.6, 0.6);
    const lazy = 0.2 * Math.sin(T * 2.7) + 0.08 * Math.sin(T * 4.3 + 1);
    const lash = Math.sin(T * FIGHT.rate);
    this.b.catchTail.rotation.set(tail + lazy + 0.6 * fe * lash, 0, 0);
    this.wagOn(c, -0.35 * tail - 0.4 * lazy - 0.24 * fe * lash);
    this.finS.v += clamp(angV, -8, 8) * 0.2;
    const fin = clamp(this.finS.step(0, 1.9, 0.38, dt), -0.5, 0.5);
    const fan = 0.15 * Math.sin(T * 2.6) + 0.35 * fe * Math.sin(T * FIGHT.rate * 0.8);
    this.b.catchFinL.rotation.set(0, -(fin + fan), 0);
    this.b.catchFinR.rotation.set(0, fin + fan, 0);
    this.finsOn(c);
  }

  // The fish's bone into place (c.matrix already set), its body flexed by
  // a about its lip - a wiggle on the line.
  wagOn(c, a) {
    const L0 = this.lineLen;
    _wag.makeTranslation(0, -L0, 0);
    _wag.multiply(_wag2.makeRotationX(a));
    _wag.multiply(_wag2.makeTranslation(0, L0, 0));
    c.matrixWorld.copy(c.matrix).multiply(_wag);
  }

  // The tail and the fins onto the fish wherever it is (each scaled for the
  // catch that's on).
  finsOn(c) {
    for (const k of ['catchTail', 'catchFinL', 'catchFinR']) {
      const o = this.b[k];
      o.scale.setScalar(k === 'catchTail' ? this.catchTailS : this.catchFinS);
      o.updateMatrix();
      o.matrixWorld.multiplyMatrices(c.matrixWorld, o.matrix);
    }
  }

  // --- the one that got away ----------------------------------------------------------
  // Dress the fish on his line as one of CATCHES (its colours, its size).
  applyCatch(k) {
    const K = CATCHES[k];
    if (this.mat) {
      const P = this.mat.uniforms.uPal.value;
      for (const [slot, key] of FISH_SLOTS) P[slot].set(K[key]);
    }
    if (this.hook) this.hook.kind = k;
    if (!this.catchSize) return;
    this.mat?.uniforms.uFish.value.set(...K.pat);
    this.catchSize.set(...K.size);
    this.catchTailS = K.tail;
    this.catchFinS = K.fins;
    this.catchL = (this.lineLen + 0.2) * K.size[1];
    this.catchR = 0.1 * Math.max(K.size[0], K.size[2]);
  }

  // The clock of it: while he runs, every so often the fish slips the hook
  // (dropFish); from then on its own clock runs the drop, the cast and the
  // reel, and when the new one's in, back to waiting. (A crash, or leaving
  // the run, puts things straight: the new catch is simply on the line.)
  hookClock(dt) {
    const H = this.hook;
    if (!H) return;
    // (into a new world: the next fish he pulls out is its own, and soon)
    const wid = this.worldId || null;
    if (wid !== H.world) {
      const first = H.world === null;
      H.world = wid;
      H.kinds.length = 0;
      H.fresh = themed(wid) >= 0;
      if (!first && H.fresh && !H.on) H.next = Math.min(H.next, pick(HOOK.fresh));
    }
    if (this.mode !== 'run' || this.crashed) {
      if (H.on) this.endHook(false);
      return;
    }
    if (!H.on) {
      H.next -= dt;
      if (H.next <= 0 && this.speed > 4 && !this.sliding && this.fish.ready) this.dropFish();
      return;
    }
    H.t += dt;
    if (H.t >= H.R0 + HOOK.reel) this.endHook(true);
  }

  // The fish slips the hook: it falls from just as it was swinging, popped
  // up a little and off to one side as the hook tears out - and he deals
  // himself the next catch and where he'll cast for it (for the viewer,
  // side: a CASTS name, kind: a CATCHES name).
  dropFish(side, kind) {
    const H = this.hook, F = this.fish;
    if (!F.ready) return;
    H.on = true;
    H.t = 0;
    H.lost = H.reeled = H.landed = H.grounded = H.splashed0 = false;
    H.flopT = 0;
    // (the world's own fish first, then it or any of the five - it as
    // often as any three of them)
    const own = themed(H.world);
    let ki = CATCHES.findIndex((K) => K.name === kind);
    if (ki < 0 && H.fresh && own >= 0 && own !== H.kind) ki = own;
    if (ki < 0) ki = dealFrom(H.kinds, own >= 0 ? [...ANYWHERE, own, own, own] : ANYWHERE, H.kind);
    H.fresh = false;
    H.nextKind = ki;
    const si = CASTS.findIndex((S) => S.name === side);
    H.side = si >= 0 ? si : deal(H.sides, CASTS.length, H.side);
    const S = CASTS[H.side];
    H.yaw = pick(S.yaw);
    H.dist = pick(S.dist);
    H.R0 = HOOK.cast + HOOK.load + HOOK.flick * 0.5 + HOOK.fly + pick(HOOK.bite);
    // (the fish's own way through the air: its swing, his run, the pop)
    const rv = _h0.subVectors(F.p, F.q).divideScalar(this.fishH);
    H.dp.copy(F.p);
    H.dv.set(rv.x + this.vx, rv.y + (this.grounded ? 0 : this.vy) + 1.3, rv.z - this.speed);
    H.dv.x += (Math.random() - 0.5) * 1.6;
    H.dq.copy(this.fishQ);
    H.dw.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 7);
    // (he takes it in his stride: the rod jumps as the weight comes off it)
    this.rodBob.v -= 2.2;
  }

  // The new catch is in: it hangs off the rod and swings on from the way
  // it came in (or, cut short, is simply there); the line's back on it.
  endHook(caught) {
    const H = this.hook, F = this.fish;
    H.on = false;
    H.next = pick(HOOK.every);
    if (!H.reeled) this.applyCatch(H.nextKind);
    if (caught && H.reeled) {
      F.p.copy(H.rp);
      F.q.copy(H.rp).addScaledVector(H.rv.clampLength(0, 6), -this.fishH);
      F.tip.copy(H.tip);
    } else F.ready = false;
    this.prevAng = null;
    this.tailS.v += 4;
    this.line?.hide();
  }

  // The cast, on the rod (runner space): drawn back away from where he's
  // casting, flicked out toward it - and held there, its tip nodding as it
  // bites - then the strike, yanked up and back, and down onto his shoulder
  // again as the catch comes in. His fist comes up and forward off his
  // shoulder with it; the rod turns in his fist.
  rodCast(live) {
    const H = this.hook, t = H.t;
    const C0 = HOOK.cast, L1 = C0 + HOOK.load, F1 = L1 + HOOK.flick, S1 = H.R0 + HOOK.strike;
    if (t < C0) return;
    const hx = -Math.sin(H.yaw), hz = -Math.cos(H.yaw);
    // (forward of him a little whichever way, unless it's behind: clear of
    // his face as it crosses)
    const fwd = hz > 0.3 ? 0 : -0.25;
    const rest = _rest.setFromMatrixColumn(this.rodF, 1).normalize();
    const aim = _h1.set(hx * 0.8, 0.5, hz * 0.8 + fwd).normalize();
    const load = _h2.set(-hx * 0.45, 0.9, -hz * 0.45 + fwd * 0.5).normalize();
    const strike = _h3.set(-hx * 0.25, 0.95, -hz * 0.25 + fwd * 0.3).normalize();
    let A, B, k;
    if (t < L1) {
      k = smooth(0, 1, (t - C0) / HOOK.load);
      A = rest;
      B = load;
    } else if (t < F1) {
      k = 1 - Math.pow(1 - (t - L1) / HOOK.flick, 2.5);
      A = load;
      B = aim;
    } else if (t < H.R0) {
      // (held out at it, the tip dipping as the line goes out and as it
      // bites)
      A = aim;
      B = _db.copy(aim).addScaledVector(UP, -0.35).normalize();
      const land = F1 + HOOK.fly;
      k = 0.4 * smooth(F1, land, t) * (1 - smooth(land, land + 0.15, t)) + 0.55 * smooth(H.R0 - 0.1, H.R0 - 0.02, t);
    } else if (t < S1) {
      k = 1 - Math.pow(1 - (t - H.R0) / HOOK.strike, 2);
      A = aim;
      B = strike;
    } else {
      k = smooth(0, 1, (t - S1) / (HOOK.reel - HOOK.strike));
      A = strike;
      B = rest;
    }
    // (the way from one to the other, turned rather than cut across)
    _hq.setFromUnitVectors(A, B);
    _hq2.identity().slerp(_hq, k);
    const D = _da.copy(A).applyQuaternion(_hq2);
    _hq.setFromUnitVectors(rest, D);
    _hq2.identity().slerp(_hq, live);
    // (his fists carry it: up and back to load it, thrown out toward the
    // cast on the flick and held out there, hoisted high on the strike, in
    // front of his chest as he reels; m, toward the cast, up, forward)
    const O = keyed([
      [C0, 0, 0, 0],
      [L1, -0.07, 0.22, -0.02],
      [F1, 0.2, 0.06, -0.1],
      [F1 + 0.2, 0.18, 0.02, -0.08],
      [H.R0 - 0.04, 0.16, 0.0, -0.08],
      [S1, -0.02, 0.26, -0.04],
      [S1 + 0.3, 0.05, 0.12, -0.08],
      [H.R0 + HOOK.reel, 0, 0, 0],
    ], t, _key);
    const toward = O[0] * (hz > 0.3 ? 0.35 : 1) * live;
    const grip = _h0.setFromMatrixPosition(this.rodF);
    _hm.makeTranslation(grip.x + hx * toward, grip.y + O[1] * live, grip.z + hz * toward + O[2] * live);
    _m2.makeRotationFromQuaternion(_hq2);
    _m3.makeTranslation(-grip.x, -grip.y, -grip.z);
    this.rodF.premultiply(_m3).premultiply(_m2).premultiply(_hm);
  }

  // While the fish is off the hook (simulation space: the world's axes,
  // from the runner): the dropped one tumbling down and flopping on the
  // road as it's left behind; then nothing on the line while it flies out
  // and lies there; then the new one yanked up out of the ground and
  // reeled in over an arc, spinning, to hang off the tip.
  hookStep(dt) {
    if (dt <= 0) return;
    const H = this.hook;
    const Q = this.root.quaternion;
    const tip = H.tip.copy(this.tipLocal).applyMatrix4(this.rodF).applyQuaternion(Q);
    const g = (this.groundY || 0) - this.y;
    H.target.set(-Math.sin(H.yaw) * H.dist, g, -Math.cos(H.yaw) * H.dist);
    if (H.t >= H.R0) this.reelStep(tip, g);
    else if (H.t < HOOK.drop && !H.lost) this.dropStep(dt, g);
    else this.placeCatch(tip, _hq.identity(), false);
    this.lineStep(tip, g);
  }

  dropStep(dt, g) {
    const H = this.hook;
    const p = H.dp, v = H.dv;
    // (the runner's own way this frame: the fish keeps its own)
    const rvx = (this.x - this.prevX) / dt, rvy = (this.y - this.prevY) / dt;
    v.y -= 9.8 * this.gk * dt;
    p.x += (v.x - rvx) * dt;
    p.y += (v.y - rvy) * dt;
    p.z += (v.z + this.speed) * dt;
    const r = 0.07 * Math.max(this.catchSize.x, this.catchSize.z);
    H.grounded = false;
    if (p.y - r < g) {
      p.y = g + r;
      H.grounded = true;
      if (!H.landed && v.y < -0.5) {
        // (it slaps down: a splash, and it bounces, flipping)
        H.landed = true;
        this.hookSplash(p, 0.55);
        H.dw.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 12);
      }
      v.y = v.y < -1 ? -v.y * 0.3 : Math.max(v.y, 0);
      const f = Math.exp(-6 * dt);
      v.x *= f;
      v.z *= f;
      // it flops: a hop every so often, twisting as it goes
      H.flopT -= dt;
      if (H.flopT <= 0) {
        H.flopT = 0.22 + 0.16 * Math.random();
        v.y = 1.5 * Math.sqrt(this.gk);
        H.dw.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
      }
    }
    // tumbling (the spin dies away on the road), and when it's down, laid
    // flat on its side between the flops
    _hq.setFromAxisAngle(_h0.copy(H.dw).normalize(), H.dw.length() * dt);
    H.dq.premultiply(_hq).normalize();
    if (H.grounded) {
      H.dw.multiplyScalar(Math.exp(-5 * dt));
      const Y = _h1.set(0, 1, 0).applyQuaternion(H.dq);
      Y.y = 0;
      if (Y.lengthSq() < 1e-6) Y.set(0, 0, 1);
      Y.normalize();
      const X = _h2.crossVectors(Y, UP);
      _hm.makeBasis(X, Y, UP);
      _hq2.setFromRotationMatrix(_hm);
      H.dq.slerp(_hq2, 1 - Math.exp(-7 * dt));
    }
    // (gone once it's well behind, or fallen off the edge of things)
    if (p.z > 10 || p.y < g - 3) H.lost = true;
    const o = _h3.set(0, this.catchL, 0).applyQuaternion(H.dq).add(p);
    this.placeCatch(o, H.dq, !H.lost, H.grounded ? 0.6 : 0.3, 24);
  }

  reelStep(tip, g) {
    const H = this.hook;
    const u = clamp((H.t - H.R0) / HOOK.reel, 0, 1);
    if (!H.reeled) {
      // the strike: up it comes, out of the ground in a burst of water,
      // dressed as whatever it is
      H.reeled = true;
      this.applyCatch(H.nextKind);
      this.hookSplash(H.target, 1.1);
      H.rp.copy(H.target);
      H.rv.set(0, 0, 0);
    }
    // the way in: up out of the ground at the hook, high over an arc, to
    // hang under the tip - quick off the mark, easing in at the end
    const e = 1 - Math.pow(1 - u, 2.2);
    const P0 = _h0.copy(H.target);
    P0.y -= 0.25;
    const P2 = _h1.copy(tip);
    P2.y -= this.catchL;
    const P1 = _h2.addVectors(P0, P2).multiplyScalar(0.5);
    P1.y += 0.9 + 0.16 * H.dist;
    const w0 = (1 - e) * (1 - e), w1 = 2 * e * (1 - e), w2 = e * e;
    const P = _h3.set(P0.x * w0 + P1.x * w1 + P2.x * w2, P0.y * w0 + P1.y * w1 + P2.y * w2, P0.z * w0 + P1.z * w1 + P2.z * w2);
    const dt = this.lastDt || 1 / 60;
    H.rv.subVectors(P, H.rp).divideScalar(Math.max(dt, 1e-3));
    H.rp.copy(P);
    // hung by its lip off the line to the tip, spinning on it as it comes
    const d = _da.subVectors(tip, P);
    if (d.lengthSq() < 1e-6) d.set(0, 1, 0);
    d.normalize();
    _hq.setFromUnitVectors(DOWN, _db.copy(d).negate());
    _hq.multiply(_hq2.setFromAxisAngle(AY, 7 * (1 - e) * (1 - e) + 0.3 * Math.sin(H.t * 9) * (1 - u)));
    const o = _h1.copy(P).addScaledVector(d, Math.min(this.catchL, P.distanceTo(tip)));
    this.placeCatch(o, _hq, true, 0.55 * (1 - u) + 0.1, 30);
  }

  // The fish's bone at o, turned q (simulation space), shown or not; its
  // tail thrashing (amp, how fast) and its fins fanning.
  placeCatch(o, q, show, amp = 0, rate = 0) {
    const Qi = _q.copy(this.root.quaternion).invert();
    const c = this.b.catch;
    c.position.copy(o).applyQuaternion(Qi);
    c.quaternion.copy(Qi).multiply(q);
    if (show) c.scale.copy(this.catchSize);
    else c.scale.setScalar(HIDDEN);
    c.updateMatrix();
    const T = this.time;
    this.wagOn(c, -0.45 * amp * Math.sin(T * rate - 1.2));
    this.b.catchTail.rotation.set(amp * Math.sin(T * rate), 0, 0);
    const fan = 0.15 * Math.sin(T * 2.6) + 0.5 * amp * Math.sin(T * rate * 0.7 + 1);
    this.b.catchFinL.rotation.set(0, -fan, 0);
    this.b.catchFinR.rotation.set(0, fan, 0);
    this.finsOn(c);
  }

  // The line while there's no fish on it (and while the new one comes in):
  // flying out from the tip behind the hook over its arc; lying slack out
  // to where it landed, the hook bobbing, a twitch as it bites; then taut
  // to the fish coming in.
  lineStep(tip, g) {
    const H = this.hook, t = H.t;
    const rel = HOOK.cast + HOOK.load + HOOK.flick * 0.5;
    const land = rel + HOOK.fly;
    if (t < rel) {
      this.line.hide();
      return;
    }
    const a = _h0.copy(tip);
    const b = _h1;
    const c = _h2;
    const arc = 0.8 + 0.12 * H.dist;
    if (t < land) {
      const u = 1 - Math.pow(1 - (t - rel) / HOOK.fly, 1.5);
      b.lerpVectors(tip, H.target, u);
      b.y += arc * 4 * u * (1 - u);
      c.lerpVectors(a, b, 0.5);
      c.y += arc * 0.6 * (1 - u) - 0.15 * u;
    } else if (t < H.R0) {
      if (!H.splashed0) {
        H.splashed0 = true;
        this.hookSplash(H.target, 0.35);
      }
      const bite = smooth(H.R0 - 0.12, H.R0 - 0.03, t);
      b.copy(H.target);
      b.y += 0.03 * Math.sin(t * 17) - 0.06 * bite;
      c.lerpVectors(a, b, 0.5);
      c.y -= (0.22 + 0.05 * H.dist) * (1 - 0.7 * bite);
      c.y = Math.max(c.y, g + 0.04);
    } else {
      // (to where the fish's own line starts)
      b.setFromMatrixPosition(this.b.catch.matrixWorld).applyQuaternion(this.root.quaternion);
      const u = clamp((t - H.R0) / HOOK.reel, 0, 1);
      c.lerpVectors(a, b, 0.5);
      c.y -= 0.06 * (1 - u);
      if (u > 0.92) {
        this.line.hide();
        return;
      }
    }
    // (into runner space)
    const Qi = _q.copy(this.root.quaternion).invert();
    a.applyQuaternion(Qi);
    b.applyQuaternion(Qi);
    c.applyQuaternion(Qi);
    this.line.lay(a, c, b);
  }

  // A splash where the fish hits the road, or where it bursts up out of it
  // (simulation space; it stays where it happened). Only on land.
  hookSplash(p, hit) {
    if (this.submerged) return;
    _v.copy(p).applyQuaternion(_q.copy(this.root.quaternion).invert());
    _v.y += 0.004;
    this.splashes.burst(_v, _dv.set(0, 0, 0), true, hit, 0);
  }

  // A point pushed out of whatever of him it's inside (r: its own size).
  pushOut(p, r) {
    for (const c of this.cols) {
      if (c.kind === 'ell') {
        _o1.subVectors(p, c.c);
        const x = _o1.dot(c.ax[0]) / (c.r[0] + r), y = _o1.dot(c.ax[1]) / (c.r[1] + r), z = _o1.dot(c.ax[2]) / (c.r[2] + r);
        const k = Math.hypot(x, y, z);
        if (k < 1 && k > 1e-6) {
          const f = 1 / k - 1;
          p.addScaledVector(c.ax[0], x * f * (c.r[0] + r)).addScaledVector(c.ax[1], y * f * (c.r[1] + r)).addScaledVector(c.ax[2], z * f * (c.r[2] + r));
        }
      } else {
        _o2.subVectors(c.b, c.a);
        const L2 = _o2.lengthSq() || 1e-9;
        const tt = clamp(_o1.subVectors(p, c.a).dot(_o2) / L2, 0, 1);
        const cx = c.a.x + _o2.x * tt, cy = c.a.y + _o2.y * tt, cz = c.a.z + _o2.z * tt;
        _o1.set(p.x - cx, p.y - cy, p.z - cz);
        const d = _o1.length();
        const rr = c.ra + (c.rb - c.ra) * tt + r;
        if (d < rr && d > 1e-6) p.addScaledVector(_o1, (rr - d) / d);
      }
    }
  }
}
