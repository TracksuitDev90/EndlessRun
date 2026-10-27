// Small helpers shared by the runner's animation and secondary motion.

export const TAU = Math.PI * 2;

export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Damped spring follower (implicit Euler, stable at any frame time). Low zeta
// = bouncy overshoot; it is what makes limbs feel loose rather than driven.
export class Spring {
  constructor(x = 0) {
    this.x = x;
    this.v = 0;
  }
  step(target, freq, zeta, dt) {
    const w = TAU * freq;
    this.v = (this.v + dt * w * w * (target - this.x)) / (1 + 2 * zeta * w * dt + w * w * dt * dt);
    this.x += this.v * dt;
    return this.x;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
  }
}
