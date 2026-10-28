import * as THREE from '../../vendor/three/three.module.min.js';

// Position-based cloth (the cape). A grid of particles — row 0 sewn under the
// collar, the rest free — joined by stretch, shear and bend constraints, with
// long-range tethers so strong wind can never stretch it. Each row also has a
// growing leash to where the body would carry it (its "skin" position): none
// at the neck, a little over the shoulders, none at all from the middle of
// the back down — so the top follows the body exactly and the cloth gains
// freedom progressively toward the hem. It is kept off the body by ellipsoids
// and round capsules (the jacket's own volumes, the limbs) and off the ground.
// It is driven by:
//   - gravity plus the inertial push of the runner's own acceleration;
//   - an aerodynamic model: the air pushes on each particle along the cloth
//     normal in proportion to the wind through the surface (that alone makes
//     it billow and settle at the right angle for the speed), plus a little
//     skin drag along it;
//   - gusts: a smooth noise field carried down the cape at the wind's pace,
//     so pressure waves roll from the shoulders to the hem — irregular, never
//     a repeating sine, and different under each half of the cape;
//   - the free edges catching the air on their own, now and then curling over
//     to show the lining.
// A soft ceiling over the collar, sloping up behind, lets it stream up behind
// the back but never whip forward over the shoulders. Simulation space has
// world axes with its origin at the runner, so turning and leaning swing the
// cape rather than carrying it rigidly. Steps are fixed-size (at most 1/120 s)
// and velocities are measured against the step that produced them, so the
// motion is the same at any frame rate.

const ITERATIONS = 4;
const STEP = 1 / 120;

// Smooth 2D gradient noise in [-1, 1] (seeded permutation, quintic fade).
const PERM = new Uint8Array(512);
const GX = new Float32Array(256);
const GY = new Float32Array(256);
{
  let s = 0x2c9a17;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) | 0) >>> 0) / 4294967296;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = rnd() * Math.PI * 2;
    GX[i] = Math.cos(a);
    GY[i] = Math.sin(a);
  }
}
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const h00 = PERM[PERM[X] + Y], h10 = PERM[PERM[X + 1] + Y];
  const h01 = PERM[PERM[X] + Y + 1], h11 = PERM[PERM[X + 1] + Y + 1];
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const n00 = GX[h00] * xf + GY[h00] * yf, n10 = GX[h10] * (xf - 1) + GY[h10] * yf;
  const n01 = GX[h01] * xf + GY[h01] * (yf - 1), n11 = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.41;
}

export class Cloth {
  // bind: Float32Array(cols * rows * 3), the rest shape (row 0 at the top).
  constructor(cols, rows, bind) {
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.n = n;
    this.p = new Float32Array(n * 3);
    this.q = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.skin = new Float32Array(n * 3); // where the body would carry each particle (this frame)
    this.skinPrev = new Float32Array(n * 3); // ...and last frame
    this.leash = new Float32Array(rows).fill(Infinity); // how far it may stray from there, by row
    this.pinA = new Float32Array(cols * 3);
    this.pinB = new Float32Array(cols * 3);
    this.colliders = [];
    this.colliderCount = 0;
    this.hPrev = STEP;
    this.groundStep = 0;
    // gusts grow toward the hem
    this.gustRow = Float32Array.from({ length: rows }, (_, j) => 0.2 + 0.8 * Math.pow(j / (rows - 1), 1.3));
    this.setRest(bind);
  }

  // (Re)build every constraint from a rest shape.
  setRest(bind) {
    const { cols, rows, n } = this;
    this.bind = bind;
    const id = (i, j) => j * cols + i;
    const A = [], B = [], L = [], K = [];
    const add = (a, b, k) => {
      A.push(a);
      B.push(b);
      L.push(Math.hypot(bind[a * 3] - bind[b * 3], bind[a * 3 + 1] - bind[b * 3 + 1], bind[a * 3 + 2] - bind[b * 3 + 2]));
      K.push(k);
    };
    // top-down first: hanging cloth converges fastest solved from the pins out
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols; i++) add(id(i, j), id(i, j + 1), 1);
    for (let j = 1; j < rows; j++) for (let i = 0; i < cols - 1; i++) add(id(i, j), id(i + 1, j), 1);
    // shear: one diagonal per cell, alternating like a checkerboard (half
    // the work of both, and no bias toward either)
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        if ((i + j) & 1) add(id(i, j), id(i + 1, j + 1), 0.7);
        else add(id(i + 1, j), id(i, j + 1), 0.7);
      }
    }
    // bending: firm enough to carry broad curves, soft enough to roll; a
    // little firmer across the top, where the cloth is gathered
    for (let j = 0; j < rows - 2; j++) for (let i = 0; i < cols; i++) add(id(i, j), id(i, j + 2), j < 3 ? 0.9 : 0.75);
    for (let j = 1; j < rows; j++) for (let i = 0; i < cols - 2; i++) add(id(i, j), id(i + 2, j), j < 4 ? 0.85 : 0.65);
    // long bends keep the big curves big (no crumpling into small kinks);
    // they are only solved on the first iterations, their job is shape
    this.nShort = A.length;
    for (let j = 0; j < rows - 4; j++) for (let i = j & 1; i < cols; i += 2) add(id(i, j), id(i, j + 4), 0.2);
    for (let j = 1; j < rows; j += 2) for (let i = 0; i < cols - 4; i++) add(id(i, j), id(i + 4, j), 0.12);
    this.cA = Uint16Array.from(A);
    this.cB = Uint16Array.from(B);
    this.cL = Float32Array.from(L);
    this.cK = Float32Array.from(K);

    // tether every particle to the pin at the top of its column
    this.tether = new Float32Array(n);
    for (let i = 0; i < cols; i++) {
      let len = 0;
      for (let j = 1; j < rows; j++) {
        const a = id(i, j - 1) * 3;
        const b = id(i, j) * 3;
        len += Math.hypot(bind[a] - bind[b], bind[a + 1] - bind[b + 1], bind[a + 2] - bind[b + 2]);
        this.tether[id(i, j)] = len * 1.02;
      }
    }
    this.length = this.tether[id(cols >> 1, rows - 1)] / 1.02;
  }

  // Colliders, rebuilt by the owner each frame in simulation space:
  // ellipsoids (centre c, unit axes ax ay az, r2 = 1 / radius^2 along each)
  // and capsules a -> b whose radius runs ra -> rb; R2 bounds either.
  // Like the pins, each substep sees them part way from where they were last
  // frame (prev) to where they are now (colliders), so a fast-moving limb
  // sweeps the cloth aside instead of jumping into it.
  setColliderCount(count) {
    const make = () => ({ ell: false, cx: 0, cy: 0, cz: 0, ax: [0, 0, 0], ay: [0, 0, 0], az: [0, 0, 0], r2: [1, 1, 1], a: [0, 0, 0], b: [0, 0, 0], ra: 0, rb: 0, R2: 0 });
    this.prev = this.prev || [];
    this.live = this.live || [];
    while (this.colliders.length < count) {
      this.colliders.push(make());
      this.prev.push(make());
      this.live.push(make());
    }
    if (count !== this.colliderCount) this.collidersMoved = false;
    this.colliderCount = count;
  }

  // Colliders u of the way from last frame's to this frame's.
  blendColliders(u) {
    const lerp3 = (o, a, b, norm) => {
      o[0] = a[0] + (b[0] - a[0]) * u;
      o[1] = a[1] + (b[1] - a[1]) * u;
      o[2] = a[2] + (b[2] - a[2]) * u;
      if (norm) {
        const l = Math.hypot(o[0], o[1], o[2]) || 1;
        o[0] /= l;
        o[1] /= l;
        o[2] /= l;
      }
    };
    for (let k = 0; k < this.colliderCount; k++) {
      const a = this.collidersMoved ? this.prev[k] : this.colliders[k];
      const b = this.colliders[k];
      const o = this.live[k];
      o.ell = b.ell;
      o.cx = a.cx + (b.cx - a.cx) * u;
      o.cy = a.cy + (b.cy - a.cy) * u;
      o.cz = a.cz + (b.cz - a.cz) * u;
      o.R2 = b.R2;
      if (b.ell) {
        lerp3(o.ax, a.ax, b.ax, true);
        lerp3(o.ay, a.ay, b.ay, true);
        lerp3(o.az, a.az, b.az, true);
        o.r2[0] = b.r2[0];
        o.r2[1] = b.r2[1];
        o.r2[2] = b.r2[2];
      } else {
        lerp3(o.a, a.a, b.a, false);
        lerp3(o.b, a.b, b.b, false);
        o.ra = b.ra;
        o.rb = b.rb;
      }
    }
  }

  // Remember this frame's colliders as where the next frame's start from.
  keepColliders() {
    for (let k = 0; k < this.colliderCount; k++) {
      const a = this.prev[k], b = this.colliders[k];
      a.cx = b.cx;
      a.cy = b.cy;
      a.cz = b.cz;
      for (const key of ['ax', 'ay', 'az', 'a', 'b']) {
        a[key][0] = b[key][0];
        a[key][1] = b[key][1];
        a[key][2] = b[key][2];
      }
    }
    this.collidersMoved = true;
  }

  // Place every particle through a transform of the rest shape (reset).
  place(fn) {
    const v = _v;
    for (let i = 0; i < this.n; i++) {
      fn(v.fromArray(this.bind, i * 3));
      this.p[i * 3] = this.q[i * 3] = v.x;
      this.p[i * 3 + 1] = this.q[i * 3 + 1] = v.y;
      this.p[i * 3 + 2] = this.q[i * 3 + 2] = v.z;
    }
  }

  // Move every particle by a rigid offset (keeps velocities).
  shift(dx, dy, dz) {
    for (let i = 0; i < this.n * 3; i += 3) {
      this.p[i] += dx;
      this.p[i + 1] += dy;
      this.p[i + 2] += dz;
      this.q[i] += dx;
      this.q[i + 1] += dy;
      this.q[i + 2] += dz;
    }
  }

  // f: { gx, gy, gz (gravity + inertial), ax, ay, az (mean wind relative to
  // the runner), wake (how much of the headwind the body shades), draw (how
  // hard the wake pulls in, per metre off the middle), gust (m/s), gustSpeed
  // (m/s down the cape), gustLen (m), curl (m/s at the free edges), kn, kt
  // (aero gains), damp (1/s), floor, groundV (how fast the ground runs back
  // under the runner), lift (allowed rise above the pins), t }
  step(dt, f) {
    if (dt <= 0) return;
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / STEP - 0.01)));
    const h = dt / steps;
    const { cols, rows, n, p, q, nrm, cA, cB, cL, cK } = this;
    const keep = Math.exp(-(f.damp ?? 0.35) * h);
    const nc = cA.length;
    const len = this.length;
    for (let s = 0; s < steps; s++) {
      const t = f.t - dt + h * (s + 1);
      // pins, skin targets and colliders slide from last frame's to this
      // frame's
      const u = (s + 1) / steps;
      for (let i = 0; i < cols * 3; i++) {
        const v = this.pinA[i] + (this.pinB[i] - this.pinA[i]) * u;
        p[i] = v;
        q[i] = v;
      }
      this.blendColliders(u);
      this.computeNormals();
      // (velocity over the step that made it: a change of step size neither
      // adds nor removes energy)
      const vs = 1 / this.hPrev;
      const gw = f.gustSpeed / f.gustLen;
      for (let k = cols; k < n; k++) {
        const o = k * 3;
        const j = (k / cols) | 0;
        const i = k - j * cols;
        const px = p[o], py = p[o + 1], pz = p[o + 2];
        const vx = (px - q[o]) * vs, vy = (py - q[o + 1]) * vs, vz = (pz - q[o + 2]) * vs;
        const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
        const cu = i / (cols - 1);
        const cv = j / (rows - 1);
        // gusts: pressure carried down the cape with the air
        const xi = (cv * len) / f.gustLen - t * gw;
        let tb = noise2(xi, cu * 1.3 + 3.7) + 0.25 * noise2(xi * 1.7 + 11.3, cu * 2.1 - 5.1);
        tb *= f.gust * this.gustRow[j];
        // the free edges catch the air on their own, each side its own way
        const side = cu < 0.5 ? cu : 1 - cu;
        if (side < 0.2) {
          const e = (1 - side / 0.2) * cv;
          tb += f.curl * e * e * noise2(t * 0.45 + (cu < 0.5 ? 0 : 17.3), cv * 1.4 + (cu < 0.5 ? 40 : 61));
        }
        // the body's wake: behind the back the headwind is weaker and draws
        // in toward the middle, so the cape streams back as a tail rather
        // than filling like a sail
        let ax = f.ax, az = f.az;
        if (pz > 0.05 && az > 0) {
          const k = Math.exp(-(px * px) / 0.09 - (pz - 0.05) * 1.6);
          az *= 1 - f.wake * k;
          ax -= f.draw * az * px * Math.min(1, (pz - 0.05) * 4);
        }
        const wx = ax + nx * tb - vx;
        const wy = f.ay + ny * tb - vy;
        const wz = az + nz * tb - vz;
        const wn = wx * nx + wy * ny + wz * nz;
        const fx = f.kn * wn * nx + f.kt * (wx - wn * nx);
        const fy = f.kn * wn * ny + f.kt * (wy - wn * ny);
        const fz = f.kn * wn * nz + f.kt * (wz - wn * nz);
        q[o] = px;
        q[o + 1] = py;
        q[o + 2] = pz;
        p[o] = px + vx * h * keep + (f.gx + fx) * h * h;
        p[o + 1] = py + vy * h * keep + (f.gy + fy) * h * h;
        p[o + 2] = pz + vz * h * keep + (f.gz + fz) * h * h;
      }
      this.hPrev = h;
      this.groundStep = (f.groundV || 0) * h;
      for (let it = 0; it < ITERATIONS; it++) {
        // sweep alternately forward and back: Gauss-Seidel converges far
        // faster when corrections can travel both ways along the cloth
        const back = it & 1;
        const m = it < 2 ? nc : this.nShort;
        for (let n2 = 0; n2 < m; n2++) {
          const c = back ? m - 1 - n2 : n2;
          const a = cA[c];
          const b = cB[c];
          const ia = a * 3;
          const ib = b * 3;
          const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 1e-7) continue;
          const diff = ((d - cL[c]) / d) * cK[c];
          if (a < cols) {
            // pinned end: only the free particle moves
            p[ib] -= dx * diff;
            p[ib + 1] -= dy * diff;
            p[ib + 2] -= dz * diff;
          } else {
            const hx = dx * diff * 0.5, hy = dy * diff * 0.5, hz = dz * diff * 0.5;
            p[ia] += hx;
            p[ia + 1] += hy;
            p[ia + 2] += hz;
            p[ib] -= hx;
            p[ib + 1] -= hy;
            p[ib + 2] -= hz;
          }
        }
        this.tethers();
        this.leashes(u);
        if (it >= ITERATIONS - 2) this.collide(f.floor, f.lift, it === ITERATIONS - 1 ? 2 : 1);
      }
    }
    this.pinA.set(this.pinB);
    this.skinPrev.set(this.skin);
    this.keepColliders();
  }

  // Keep each row within its leash of where the body would carry it.
  leashes(u) {
    const { cols, rows, p, leash } = this;
    const A = this.skinPrev, B = this.skin;
    for (let j = 1; j < rows; j++) {
      const r = leash[j];
      if (!(r < 1e3)) break;
      for (let i = 0; i < cols; i++) {
        const o = (j * cols + i) * 3;
        const sx = A[o] + (B[o] - A[o]) * u, sy = A[o + 1] + (B[o + 1] - A[o + 1]) * u, sz = A[o + 2] + (B[o + 2] - A[o + 2]) * u;
        const dx = p[o] - sx, dy = p[o + 1] - sy, dz = p[o + 2] - sz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r * r) {
          const s = r / Math.sqrt(d2);
          p[o] = sx + dx * s;
          p[o + 1] = sy + dy * s;
          p[o + 2] = sz + dz * s;
        }
      }
    }
  }

  tethers() {
    const { cols, n, p, tether } = this;
    for (let k = cols; k < n; k++) {
      const o = k * 3;
      const c = (k % cols) * 3;
      const dx = p[o] - p[c], dy = p[o + 1] - p[c + 1], dz = p[o + 2] - p[c + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      const T = tether[k];
      if (d2 > T * T) {
        const s = T / Math.sqrt(d2);
        p[o] = p[c] + dx * s;
        p[o + 1] = p[c + 1] + dy * s;
        p[o + 2] = p[c + 2] + dz * s;
      }
    }
  }

  collide(floor, lift, passes) {
    const { cols, n, p, q } = this;
    // A ceiling over the collar keeps the cloth from flipping forward over
    // the shoulders or the head (firm in front of the neck; behind, it slopes
    // up and gives, so the cape can still stream up and back falling from a
    // jump), and a soft wall in front of the chest stops it wrapping round
    // to the front.
    let ceil = 0, back = 0;
    for (let i = 0; i < cols; i++) {
      ceil += p[i * 3 + 1];
      back += p[i * 3 + 2];
    }
    ceil = ceil / cols + lift;
    const front = back / cols - 0.15;
    back = back / cols + 0.06;
    // broad phase: only colliders whose bounds reach the cloth's box
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let o = cols * 3; o < n * 3; o += 3) {
      const x = p[o], y = p[o + 1], z = p[o + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const near = this.near || (this.near = []);
    near.length = 0;
    for (let ci = 0; ci < this.colliderCount; ci++) {
      const c = this.live[ci];
      const R = Math.sqrt(c.R2);
      if (c.cx + R > x0 && c.cx - R < x1 && c.cy + R > y0 && c.cy - R < y1 && c.cz + R > z0 && c.cz - R < z1) near.push(c);
    }
    // (the owner lists limbs before the body's own volumes; the last time
    // round, a particle that touched anything is checked again, so cloth a
    // swinging arm presses inward still ends up outside the torso)
    const count = near.length;
    for (let k = cols; k < n; k++) {
      const o = k * 3;
      let x = p[o], y = p[o + 1], z = p[o + 2];
      for (let pass = 0, hit = true; pass < passes && hit; pass++) {
        hit = false;
        for (let ci = 0; ci < count; ci++) {
          const c = near[ci];
          const ox = x - c.cx, oy = y - c.cy, oz = z - c.cz;
          if (ox * ox + oy * oy + oz * oz > c.R2) continue;
          if (c.ell) {
            // out along the surface's normal (one Newton step on the
            // ellipsoid's field), not along its radius: where two volumes
            // meet, neither pushes the cloth into the other
            const X = c.ax, Y = c.ay, Z = c.az, r2 = c.r2;
            const u = ox * X[0] + oy * X[1] + oz * X[2];
            const v = ox * Y[0] + oy * Y[1] + oz * Y[2];
            const w = ox * Z[0] + oy * Z[1] + oz * Z[2];
            const e2 = u * u * r2[0] + v * v * r2[1] + w * w * r2[2];
            if (e2 < 1) {
              const gu = u * r2[0], gv = v * r2[1], gw = w * r2[2];
              const gx = X[0] * gu + Y[0] * gv + Z[0] * gw;
              const gy = X[1] * gu + Y[1] * gv + Z[1] * gw;
              const gz = X[2] * gu + Y[2] * gv + Z[2] * gw;
              const g = Math.sqrt(gx * gx + gy * gy + gz * gz);
              if (g < 1e-6) {
                y += 1 / Math.sqrt(r2[1]);
                hit = true;
                continue;
              }
              hit = true;
              const e = Math.sqrt(e2);
              const d = ((1 - e) * e) / g + 1e-4;
              x += (gx / g) * d;
              y += (gy / g) * d;
              z += (gz / g) * d;
            }
          } else {
            const A = c.a, Bv = c.b;
            const abx = Bv[0] - A[0], aby = Bv[1] - A[1], abz = Bv[2] - A[2];
            const dx = x - A[0], dy = y - A[1], dz = z - A[2];
            const l2 = abx * abx + aby * aby + abz * abz;
            let tt = l2 > 1e-9 ? (dx * abx + dy * aby + dz * abz) / l2 : 0;
            tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
            const rx = dx - abx * tt, ry = dy - aby * tt, rz = dz - abz * tt;
            const r = c.ra + (c.rb - c.ra) * tt;
            const d2 = rx * rx + ry * ry + rz * rz;
            if (d2 < r * r) {
              hit = true;
              const d = Math.sqrt(d2) || 1e-6;
              const s = r / d - 1;
              x += rx * s;
              y += ry * s;
              z += rz * s;
              // a limb shoves the cloth aside without flinging it: most of
              // the push is not kept as speed (it slides off a swinging arm)
              q[o] += rx * s * 0.7;
              q[o + 1] += ry * s * 0.7;
              q[o + 2] += rz * s * 0.7;
            }
          }
        }
      }
      if (z > back) {
        const top = ceil + (z - back) * 1.4;
        if (y > top) y = top + (y - top) * 0.3;
      } else if (y > ceil) {
        y = ceil;
      }
      if (z < front && k >= cols * 3) z = front + (z - front) * 0.3;
      if (y < floor) {
        y = floor;
        // ground friction: the ground runs back under the runner, so it drags
        // the cloth back along with it (velocity eased toward the ground's)
        q[o] += (x - q[o]) * 0.4;
        q[o + 2] += (z - this.groundStep - q[o + 2]) * 0.4;
      }
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = z;
    }
  }

  computeNormals() {
    const { cols, rows, p, nrm } = this;
    for (let j = 0; j < rows; j++) {
      const j0 = j > 0 ? j - 1 : 0;
      const j1 = j < rows - 1 ? j + 1 : rows - 1;
      for (let i = 0; i < cols; i++) {
        const i0 = i > 0 ? i - 1 : 0;
        const i1 = i < cols - 1 ? i + 1 : cols - 1;
        const a = (j * cols + i0) * 3, b = (j * cols + i1) * 3;
        const c = (j0 * cols + i) * 3, d = (j1 * cols + i) * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[d] - p[c], vy = p[d + 1] - p[c + 1], vz = p[d + 2] - p[c + 2];
        // n = down x across: points away from the body
        const nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const o = (j * cols + i) * 3;
        nrm[o] = nx / l;
        nrm[o + 1] = ny / l;
        nrm[o + 2] = nz / l;
      }
    }
  }
}

const _v = new THREE.Vector3();
