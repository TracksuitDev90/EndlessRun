import * as THREE from '../../vendor/three/three.module.min.js';

// Hands that are hands: four fingers and a thumb, each three bones (sculpted
// and bound by tools/runner/hands.py), curled, spread and closed into
// shapes - a loose fist pumping on the run, fingers flung wide in the air,
// splayed for balance, cupped round nothing much when they stand about, or
// shut round whatever they carry.
//
// A shape is four angles a digit (radians): for each finger - index,
// middle, ring, little - how far it spreads from its rest (+ toward the
// thumb), and how far its knuckle, middle joint and end joint bend; for the
// thumb, how far it swings round in front of the palm (opposition), and how
// far its base, its knuckle and its end joint bend. 20 numbers, the thumb
// last.
//
// Each frame the character says what each hand is doing (a few named
// shapes and their weights: see Player.handShapes); the blend is what each
// finger reaches for, and it gets there on a spring of its own - the index
// quickest, the little finger lagging after it - so a hand opens and closes
// in a ripple rather than all at once, flops a touch on a hard swing, and
// never snaps.
export const DIGITS = 5;
export const N_HAND = DIGITS * 4;

const shape = (fingers, thumb) => Float32Array.from([...fingers.flat(), ...thumb]);

export const SHAPES = {
  // hanging at rest: a gentle curl, deeper toward the little finger
  relaxed: shape(
    [
      [0, 0.26, 0.4, 0.2],
      [0, 0.31, 0.47, 0.24],
      [0, 0.37, 0.53, 0.27],
      [0, 0.44, 0.58, 0.3],
    ],
    [0.32, 0.1, 0.18, 0.2]
  ),
  // on the run: a loose fist, the fingers curled in but not clenched, the
  // thumb resting along the index
  loose: shape(
    [
      [-0.02, 0.82, 1.05, 0.5],
      [0, 0.92, 1.12, 0.55],
      [0.02, 1.0, 1.15, 0.58],
      [0.05, 1.08, 1.18, 0.6],
    ],
    [0.62, 0.32, 0.38, 0.35]
  ),
  // a fist: clenched, the thumb across the first two fingers
  fist: shape(
    [
      [-0.04, 1.42, 1.62, 0.72],
      [0, 1.5, 1.66, 0.78],
      [0.03, 1.55, 1.66, 0.78],
      [0.07, 1.58, 1.6, 0.72],
    ],
    [1.05, 0.5, 0.62, 0.55]
  ),
  // flung open: fingers straight and fanned wide, the thumb stretched away
  open: shape(
    [
      [0.16, 0.02, 0.05, 0.03],
      [0.03, 0.0, 0.04, 0.03],
      [-0.1, 0.02, 0.05, 0.04],
      [-0.24, 0.06, 0.07, 0.05],
    ],
    [-0.2, -0.15, 0.02, 0.06]
  ),
  // a blade: fingers straight and together, the thumb along the side
  flat: shape(
    [
      [-0.07, 0.06, 0.06, 0.04],
      [0, 0.06, 0.06, 0.04],
      [0.06, 0.07, 0.07, 0.05],
      [0.13, 0.08, 0.08, 0.05],
    ],
    [0.12, 0.05, 0.06, 0.05]
  ),
  // reaching for something: spread, the tips curled - catching the air,
  // or bracing for the road
  claw: shape(
    [
      [0.12, 0.32, 0.85, 0.55],
      [0.02, 0.36, 0.92, 0.58],
      [-0.07, 0.42, 0.98, 0.6],
      [-0.17, 0.48, 1.0, 0.58],
    ],
    [0.35, 0.15, 0.4, 0.45]
  ),
  // hooked over an edge (a rail, a ledge): bent at the middle joints
  hook: shape(
    [
      [0.02, 0.45, 1.45, 0.85],
      [0, 0.48, 1.5, 0.9],
      [-0.02, 0.52, 1.5, 0.9],
      [-0.04, 0.56, 1.45, 0.85],
    ],
    [0.15, 0.1, 0.2, 0.25]
  ),
};

// How quickly each digit follows (Hz): the index first, the little finger
// last; the thumb in between. Damping: a little under critical, so a hand
// flung open quivers once as it stops.
const FREQ = [15, 13.5, 12, 10.5, 12.5];
const ZETA = 0.62;

const _q = new THREE.Quaternion();

export class Hands {
  // player: the runner (rig.hands from their asset, bones by name)
  constructor(player) {
    this.sides = player.rig.hands.map((h) => ({
      name: h.side,
      digits: h.digits.map((d) => ({
        bones: d.bones.map((n) => player.b[n]),
        spread: new THREE.Vector3(...d.spread).normalize(),
        flex: new THREE.Vector3(...d.flex).normalize(),
        bind: d.bind,
      })),
      // where each angle is reaching for, where it is, how fast it goes
      target: new Float32Array(N_HAND),
      x: new Float32Array(N_HAND),
      v: new Float32Array(N_HAND),
      // the shape this hand was bound in (one sculpted holding something
      // holds it: see Player.handShapes)
      bound: Float32Array.from(h.digits.flatMap((d) => d.bind)),
      ready: false,
    }));
    this.L = this.sides.find((s) => s.name === 'L');
    this.R = this.sides.find((s) => s.name === 'R');
  }

  // Start a hand's target over (before laying shapes on it).
  clear(side) {
    side.target.fill(0);
    side.w = 0;
  }

  // Lay a shape on a hand's target, by w (shape: a name, or 20 numbers).
  add(side, shape, w) {
    if (w <= 1e-4) return;
    const S = typeof shape === 'string' ? (shape === 'bound' ? side.bound : SHAPES[shape]) : shape;
    const T = side.target;
    for (let i = 0; i < N_HAND; i++) T[i] += S[i] * w;
    side.w += w;
  }

  // (after the shapes: divide the blend through)
  done(side) {
    if (side.w > 1e-6) {
      const T = side.target;
      for (let i = 0; i < N_HAND; i++) T[i] /= side.w;
    } else side.target.set(SHAPES.relaxed);
  }

  // Draw a hand's target toward a shape by w (0..1), over whatever's there.
  mix(side, shape, w) {
    if (w <= 1e-4) return;
    const S = typeof shape === 'string' ? (shape === 'bound' ? side.bound : SHAPES[shape]) : shape;
    const T = side.target;
    w = Math.min(1, w);
    for (let i = 0; i < N_HAND; i++) T[i] += (S[i] - T[i]) * w;
  }

  // Curl every digit an extra k radians at its joints (a squeeze, a flop).
  curl(side, k, from = 0, to = DIGITS) {
    const T = side.target;
    for (let d = from; d < to; d++) {
      T[d * 4 + 1] += k;
      T[d * 4 + 2] += k * 1.1;
      T[d * 4 + 3] += k * 0.6;
    }
  }

  // Follow the targets on their springs and turn the bones.
  update(dt) {
    for (const s of this.sides) {
      if (!s.ready || !(dt > 0)) {
        s.x.set(s.target);
        s.v.fill(0);
        s.ready = true;
      } else {
        // (stepped implicitly, as rig.js's Spring is - stable however stiff
        // and however long the frame - in steps of at most 1/120 s, so it
        // rings the same at 30 fps as at 60)
        const n = Math.max(1, Math.ceil(dt * 120 - 1e-6));
        const h = dt / n;
        for (let d = 0; d < DIGITS; d++) {
          const w = FREQ[d] * 2 * Math.PI;
          const den = 1 + 2 * ZETA * w * h + w * w * h * h;
          for (let j = 0; j < 4; j++) {
            const i = d * 4 + j;
            let x = s.x[i], v = s.v[i];
            const t = s.target[i];
            for (let k = 0; k < n; k++) {
              v = (v + h * w * w * (t - x)) / den;
              x += v * h;
            }
            s.x[i] = x;
            s.v[i] = v;
          }
        }
      }
      this.pose(s);
    }
  }

  pose(s) {
    const X = s.x;
    for (let d = 0; d < DIGITS; d++) {
      const D = s.digits[d];
      const o = d * 4;
      const B = D.bind;
      const [a, b, c] = D.bones;
      a.quaternion.setFromAxisAngle(D.spread, X[o] - B[0]);
      a.quaternion.multiply(_q.setFromAxisAngle(D.flex, X[o + 1] - B[1]));
      b.quaternion.setFromAxisAngle(D.flex, X[o + 2] - B[2]);
      c.quaternion.setFromAxisAngle(D.flex, X[o + 3] - B[3]);
    }
  }
}
