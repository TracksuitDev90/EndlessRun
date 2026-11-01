import * as THREE from '../../vendor/three/three.module.min.js';
import { makeBubbleMaterial } from '../render/shaders.js';
import { mulberry32 } from '../core/rng.js';
import { Dust } from './dust.js';

// Under the sea (a world with env.bubbles): the water is only a look — the
// runner runs as fast as anywhere — but it shows on everything they do.
// Bubbles stream off them as they run and in little breaths from their
// mouth; every footfall puffs up sand and a few bubbles; a jump leaves a
// burst at their feet and a trail behind, a landing a ring of sand and
// bubbles, a slide a churn of both; and all the while the water swirls round
// them, tiny bubbles spiralling round their body and peeling off behind.
//
// The bubbles are thrown from the runner and left in the water (track
// coordinates, like the explorer's dust): carried along a moment in their
// wake, then slowed by the water and rising, wobbling and swelling, until
// they fall behind. The swirl is worked out on the GPU from the runner's
// position alone. The sand is the explorer's dust (game/dust.js), lit by the
// road it comes off. One draw call each, and none at all out of the water.

const MAX = 110;
const TAU = Math.PI * 2;

class Bubbles {
  constructor(env) {
    this.pos = new Float32Array(MAX * 3);
    this.attr = new Float32Array(MAX * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aB', new THREE.BufferAttribute(this.attr, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(geo, makeBubbleMaterial(env));
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.visible = false;
    this.p = Array.from({ length: MAX }, () => ({ live: false, x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, age: 0, life: 1, size: 0.05, rise: 1.5, seed: 0 }));
    this.next = 0;
    this.rnd = mulberry32(77);
  }

  // One bubble at (x, y, d) in track space, moving at (vx, vy, vd) (vd along
  // the run), r metres across.
  emit(x, y, d, vx, vy, vd, r) {
    const it = this.p[this.next];
    this.next = (this.next + 1) % MAX;
    const s = this.rnd();
    it.live = true;
    it.x = x;
    it.y = y;
    it.d = d;
    it.vx = vx;
    it.vy = vy;
    it.vd = vd;
    it.age = 0;
    it.seed = s;
    it.size = r;
    it.life = 1.4 + s * 1.4;
    // bigger bubbles rise faster
    it.rise = 0.9 + r * 9 + s * 0.4;
  }

  update(dt, z, dist) {
    let n = 0;
    const drag = Math.exp(-2.4 * dt);
    for (const it of this.p) {
      if (!it.live) continue;
      it.age += dt;
      it.vx *= drag;
      it.vd *= drag;
      it.vy += (it.rise - it.vy) * (1 - Math.exp(-3 * dt));
      // wobbling as it rises
      it.x += (it.vx + Math.sin(it.age * (7 + it.seed * 5) + it.seed * 30) * 0.35) * dt;
      it.y += it.vy * dt;
      it.d += it.vd * dt;
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 9 || it.y > 9) {
        it.live = false;
        continue;
      }
      this.pos[n * 3] = it.x;
      this.pos[n * 3 + 1] = it.y;
      this.pos[n * 3 + 2] = z - (it.d - dist);
      this.attr[n * 4] = it.size * (1 + it.age * 0.25);
      this.attr[n * 4 + 1] = Math.min(1, u * 10) * (1 - u * u);
      this.attr[n * 4 + 2] = it.seed;
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aB.needsUpdate = true;
    }
  }

  clear() {
    for (const it of this.p) it.live = false;
    this.points.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }

  forCompile(on) {
    this.points.visible = on;
    this.points.geometry.setDrawRange(0, on ? 1 : 0);
  }
}

// The swirl: a fixed set of motes, each spiralling round the runner on its
// own radius, height, spin and beat (see VS_SWIRL).
class Swirl {
  constructor(env, count = 120) {
    const rnd = mulberry32(31);
    const pos = new Float32Array(count * 3);
    const s = new Float32Array(count * 4);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // round the legs, round the arms and the body, and the odd wide one
      const k = rnd();
      const h = k < 0.45 ? 0.1 + rnd() * 0.55 : k < 0.85 ? 0.75 + rnd() * 0.65 : rnd() * 1.6;
      const r = (k < 0.85 ? 0.3 : 0.6) + rnd() * 0.35;
      s.set([r, h, (rnd() < 0.5 ? -1 : 1) * (3.5 + rnd() * 4), rnd()], i * 4);
      size[i] = 0.03 + rnd() * rnd() * 0.06;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aS', new THREE.BufferAttribute(s, 4));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.material = makeBubbleMaterial(env, true);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.visible = false;
  }

  set(x, y, z, amount, speed, lean) {
    const u = this.material.uniforms;
    u.uSwirlAt.value.set(x, y, z, amount);
    u.uSwirlRun.value.set(speed, lean, 0, 0);
    this.points.visible = amount > 0.005;
  }
}

export class WaterFx {
  constructor(env) {
    this.bubbles = new Bubbles(env);
    this.swirl = new Swirl(env);
    this.sand = new Dust(env);
    this.amount = 0;
    this.rnd = mulberry32(5);
    this.reset();
    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  get objects() {
    return [this.bubbles.points, this.swirl.points, this.sand.points];
  }

  reset() {
    this.amount = 0;
    this.breathAt = 1;
    this.breath = 0;
    this.trail = 0;
    this.lastStep = 0;
    this.wasGrounded = true;
    this.wasSliding = false;
    this.wasLane = 1;
    this.bubbles.clear();
    this.sand.clear();
    this.swirl.set(0, 0, 0, 0, 0, 0);
  }

  // A cloud of bubbles bursting out of the runner (diving in, a crash).
  burst(p, dist, n, spread = 0.6, up = 1.6) {
    const r = this.rnd;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU;
      const big = r() < 0.3;
      this.bubbles.emit(p.x + Math.cos(a) * spread * r(), p.y + 0.2 + r() * 1.3, dist + (r() - 0.5) * spread, Math.cos(a) * 1.5 * r(), up * r(), p.speed * (0.4 + r() * 0.4) + Math.sin(a) * 1.5, big ? 0.07 + r() * 0.07 : 0.025 + r() * 0.035);
    }
  }

  // Sand puffed up at (x, d) on the road, in the runner's space.
  puff(p, x, y, size, n, spread = 0.25) {
    const r = this.rnd;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU;
      this._p.set(x - p.x + Math.cos(a) * spread * r(), y - p.y + 0.05, Math.sin(a) * spread * r());
      this._v.set(Math.cos(a) * (0.8 + r()), 0.4 + r() * 0.8, -p.speed * (0.25 + r() * 0.2));
      this.sand.emit(this._p, this._v, size * (0.7 + r() * 0.6));
    }
  }

  // wet: 0..1, how far underwater the runner is (eases in and out).
  update(dt, game, wet) {
    const p = game.player;
    const was = this.amount;
    this.amount += (wet - this.amount) * (1 - Math.exp(-6 * dt));
    if (this.amount < 0.002 && wet === 0) this.amount = 0;
    const z = -(game.dist - game.origin);
    const dist = game.dist;
    const a = this.amount;
    const r = this.rnd;
    const running = game.state === 'running' && p.mode === 'run';
    if (a > 0.05 && was <= 0.05 && game.state === 'running') this.burst(p, dist, 26, 0.9, 2.2);
    if (a > 0.05 && running) {
      // the runner's wake: bubbles shed off the body, more the faster they go
      this.trail += dt * (10 + game.speed * 0.9) * a;
      while (this.trail >= 1) {
        this.trail -= 1;
        const side = r() < 0.5 ? -1 : 1;
        this.bubbles.emit(p.x + side * (0.15 + r() * 0.25), p.y + 0.3 + r() * 1.1, dist + 0.2, side * r() * 0.6, 0.3 + r() * 0.6, game.speed * (0.55 + r() * 0.3), 0.018 + r() * r() * 0.05);
      }
      // a breath now and then: a little string of bubbles from the mouth
      this.breathAt -= dt;
      if (this.breathAt <= 0) {
        this.breath = 0.32;
        this.breathAt = 1.3 + r() * 1.1;
      }
      if (this.breath > 0) {
        this.breath -= dt;
        if (r() < dt * 26) this.bubbles.emit(p.x + (r() - 0.5) * 0.05, p.y + 1.38, dist - 0.18, (r() - 0.5) * 0.3, 0.6 + r() * 0.5, game.speed * (0.75 + r() * 0.15), 0.025 + r() * 0.035);
      }
      // footfalls: a puff of sand and a few bubbles where each foot lands
      const step = Math.floor(p.phase / Math.PI);
      if (step !== this.lastStep && p.grounded && !p.sliding && game.speed > 3) {
        const side = step % 2 ? 1 : -1;
        const fx = p.x + side * 0.13;
        this.puff(p, fx, p.y, 0.22, 1, 0.08);
        for (let i = 0; i < 2; i++) this.bubbles.emit(fx, p.y + 0.06, dist + 0.1, (r() - 0.5) * 0.6, 0.6 + r(), game.speed * 0.5, 0.02 + r() * 0.03);
      }
      this.lastStep = step;
      // taking off: a burst at the feet; in the air, a trail off them
      if (!p.grounded && this.wasGrounded) {
        this.puff(p, p.x, 0, 0.3, 4, 0.35);
        for (let i = 0; i < 10; i++) this.bubbles.emit(p.x + (r() - 0.5) * 0.5, 0.1 + r() * 0.3, dist + r() * 0.4, (r() - 0.5) * 2, 0.5 + r() * 1.5, game.speed * (0.45 + r() * 0.3), 0.02 + r() * 0.06);
      }
      if (!p.grounded && r() < dt * 22) this.bubbles.emit(p.x + (r() - 0.5) * 0.3, p.y + 0.1 + r() * 0.3, dist + 0.2, (r() - 0.5) * 0.4, 0.2, game.speed * 0.6, 0.02 + r() * 0.03);
      // landing: a ring of sand and bubbles thrown out round the feet
      if (p.grounded && !this.wasGrounded) {
        this.puff(p, p.x, p.y, 0.34, 6, 0.45);
        for (let i = 0; i < 12; i++) {
          const ang = r() * TAU;
          this.bubbles.emit(p.x + Math.cos(ang) * 0.3, p.y + 0.08, dist + Math.sin(ang) * 0.3, Math.cos(ang) * (1 + r() * 1.5), 0.6 + r(), game.speed * 0.45 + Math.sin(ang) * 1.5, 0.02 + r() * 0.06);
        }
      }
      // a slide: churning sand and a stream of bubbles off the body
      if (p.sliding) {
        if (!this.wasSliding) this.puff(p, p.x, 0, 0.36, 5, 0.4);
        if (r() < dt * 14) this.puff(p, p.x + (r() - 0.5) * 0.3, 0, 0.3, 1, 0.15);
        if (r() < dt * 30) this.bubbles.emit(p.x + (r() - 0.5) * 0.5, 0.15 + r() * 0.5, dist + 0.3, (r() - 0.5) * 1.2, 0.5 + r(), game.speed * 0.5, 0.025 + r() * 0.05);
      }
      // a lane change stirs up a little swirl on the side it leaves
      if (p.lane !== this.wasLane) {
        const side = Math.sign(p.lane - this.wasLane);
        for (let i = 0; i < 7; i++) this.bubbles.emit(p.x - side * 0.3, 0.3 + r() * 1.1, dist + r() * 0.4, -side * (0.6 + r()), 0.4 + r() * 0.6, game.speed * 0.55, 0.02 + r() * 0.04);
      }
    }
    // a stumble or a crash: a cloud of bubbles
    if (a > 0.05 && p.stumbleT > 0.55 && !this.stumbled) this.burst(p, dist, 16, 0.6, 1.8);
    this.stumbled = p.stumbleT > 0.55;
    if (a > 0.05 && p.crashed && !this.crashedFx) this.burst(p, dist, 28, 0.9, 2.4);
    this.crashedFx = p.crashed;
    this.wasGrounded = p.grounded;
    this.wasSliding = p.sliding;
    this.wasLane = p.lane;

    this.bubbles.update(dt, z, dist);
    this.sand.update(dt, p.root, z, dist);
    const moving = game.state === 'title' ? 0.45 : 1;
    this.swirl.set(p.x, p.y, z, a * moving, game.speed, THREE.MathUtils.clamp(p.vx / 9, -1, 1));
  }

  forCompile(on) {
    this.bubbles.forCompile(on);
    this.sand.forCompile(on);
    this.swirl.points.visible = on;
  }
}

