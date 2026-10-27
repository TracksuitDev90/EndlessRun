import * as THREE from '../../vendor/three/three.module.min.js';

// Position-based cloth (the cape). A grid of particles, row 0 pinned to the
// body, joined by stretch, shear and bend constraints, with long-range
// tethers so strong wind can never stretch it. It is kept off the body by
// capsules (round, or elliptic for the torso) and the ground, and driven by:
//   - gravity plus the inertial push of the runner's own acceleration;
//   - an aerodynamic model: the air pushes on each particle along the cloth
//     normal in proportion to the wind through the surface (that alone makes
//     it billow and settle at the right angle for the speed), plus a little
//     skin drag along it;
//   - travelling turbulence that ripples from the shoulders to the hem, faster
//     and harder as the wind rises — the flapping.
// A soft ceiling a little above the pins lets it billow but never whip up
// over the shoulders.
// Simulation space has world axes with its origin at the runner, so turning
// and leaning swing the cape rather than carrying it rigidly.

const ITERATIONS = 4;
const STEP = 1 / 120;

export class Cloth {
  // bind: Float32Array(cols * rows * 3), the rest shape (row 0 at the top).
  constructor(cols, rows, bind) {
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.n = n;
    this.bind = bind;
    this.p = new Float32Array(n * 3);
    this.q = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.pinA = new Float32Array(cols * 3);
    this.pinB = new Float32Array(cols * 3);
    this.colliders = [];

    const id = (i, j) => j * cols + i;
    const A = [];
    const B = [];
    const L = [];
    const K = [];
    const add = (a, b, k) => {
      A.push(a);
      B.push(b);
      L.push(Math.hypot(bind[a * 3] - bind[b * 3], bind[a * 3 + 1] - bind[b * 3 + 1], bind[a * 3 + 2] - bind[b * 3 + 2]));
      K.push(k);
    };
    // top-down first: hanging cloth converges fastest solved from the pins out
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols; i++) add(id(i, j), id(i, j + 1), 1);
    for (let j = 1; j < rows; j++) for (let i = 0; i < cols - 1; i++) add(id(i, j), id(i + 1, j), 1);
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        add(id(i, j), id(i + 1, j + 1), 0.6);
        add(id(i + 1, j), id(i, j + 1), 0.6);
      }
    }
    for (let j = 1; j < rows; j++) for (let i = 0; i < cols - 2; i++) add(id(i, j), id(i + 2, j), 0.4);
    for (let j = 0; j < rows - 2; j++) for (let i = 0; i < cols; i++) add(id(i, j), id(i, j + 2), 0.5);
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
        this.tether[id(i, j)] = len * 1.01;
      }
    }
    this.restDown = this.tether[id(0, rows - 1)] / 1.01 / (rows - 1);
    // flutter is strongest at the free edges
    this.edge = new Float32Array(n);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const side = i === 0 || i === cols - 1 ? 0.35 : 0;
        this.edge[id(i, j)] = (j / (rows - 1)) * (1 + side) + (j === rows - 1 ? 0.25 : 0);
      }
    }
  }

  // Colliders, rebuilt by the owner each frame in simulation space.
  // capsule(a, b, r) and ellipse capsules (radius r along ex, rz along ez).
  setColliderCount(count) {
    while (this.colliders.length < count) {
      this.colliders.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0, rz: 0, ell: false, ex: [0, 0, 0], ez: [0, 0, 0], cx: 0, cy: 0, cz: 0, R2: 0 });
    }
    this.colliderCount = count;
  }

  // Place every particle from the bind shape through a transform (reset).
  place(fn) {
    const v = _v;
    for (let i = 0; i < this.n; i++) {
      v.fromArray(this.bind, i * 3);
      fn(v);
      v.toArray(this.p, i * 3);
      v.toArray(this.q, i * 3);
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
  // the runner), turb (m/s), freq (Hz), wave (m), kn, kt (aero gains), damp
  // (1/s), floor, lift (allowed rise above the pins), t }
  step(dt, f) {
    if (dt <= 0) return;
    const steps = Math.min(8, Math.max(1, Math.ceil(dt / STEP - 0.01)));
    const h = dt / steps;
    const { cols, n, p, q, nrm, cA, cB, cL, cK } = this;
    const keep = 1 - (f.damp ?? 0.35) * h;
    const nc = cA.length;
    for (let s = 0; s < steps; s++) {
      const t = f.t - dt + h * (s + 1);
      // pins slide from last frame's anchors to this frame's
      const u = (s + 1) / steps;
      for (let i = 0; i < cols * 3; i++) {
        const v = this.pinA[i] + (this.pinB[i] - this.pinA[i]) * u;
        p[i] = v;
        q[i] = v;
      }
      this.computeNormals();
      const wv = 6.2832 / f.wave;
      const om = 6.2832 * f.freq;
      for (let k = cols; k < n; k++) {
        const o = k * 3;
        const j = (k / cols) | 0;
        const i = k - j * cols;
        const px = p[o], py = p[o + 1], pz = p[o + 2];
        const vx = (px - q[o]) / h, vy = (py - q[o + 1]) / h, vz = (pz - q[o + 2]) / h;
        const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
        // gusts travel down the cape: a wave through the surface
        const ph = j * this.restDown * wv - om * t + i * 0.42;
        const e = this.edge[k];
        const tb = f.turb * e * (Math.sin(ph) + 0.55 * Math.sin(1.93 * ph + 1.3 + i * 0.37) + 0.3 * Math.sin(0.61 * ph - 0.7 * i));
        const wx = f.ax + nx * tb - vx;
        const wy = f.ay + ny * tb - vy;
        const wz = f.az + nz * tb - vz;
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
      for (let it = 0; it < ITERATIONS; it++) {
        // sweep alternately forward and back: Gauss-Seidel converges far
        // faster when corrections can travel both ways along the cloth
        const back = it & 1;
        for (let n2 = 0; n2 < nc; n2++) {
          const c = back ? nc - 1 - n2 : n2;
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
        if (it === 1 || it === ITERATIONS - 1) this.collide(f.floor, f.lift);
      }
    }
    this.pinA.set(this.pinB);
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

  collide(floor, lift) {
    const { cols, n, p, q } = this;
    let ceil = 0;
    for (let i = 0; i < cols; i++) ceil += p[i * 3 + 1];
    ceil = ceil / cols + lift;
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
    for (let ci = 0; ci < (this.colliderCount || 0); ci++) {
      const c = this.colliders[ci];
      const R = Math.sqrt(c.R2);
      if (c.cx + R > x0 && c.cx - R < x1 && c.cy + R > y0 && c.cy - R < y1 && c.cz + R > z0 && c.cz - R < z1) near.push(c);
    }
    const count = near.length;
    for (let k = cols; k < n; k++) {
      const o = k * 3;
      let x = p[o], y = p[o + 1], z = p[o + 2];
      for (let ci = 0; ci < count; ci++) {
        const c = near[ci];
        const ox = x - c.cx, oy = y - c.cy, oz = z - c.cz;
        if (ox * ox + oy * oy + oz * oz > c.R2) continue;
        const abx = c.bx - c.ax, aby = c.by - c.ay, abz = c.bz - c.az;
        const dx = x - c.ax, dy = y - c.ay, dz = z - c.az;
        const l2 = abx * abx + aby * aby + abz * abz;
        let tt = l2 > 1e-9 ? (dx * abx + dy * aby + dz * abz) / l2 : 0;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const rx = dx - abx * tt, ry = dy - aby * tt, rz = dz - abz * tt;
        if (c.ell) {
          const ex = c.ex, ez = c.ez;
          const uu = rx * ex[0] + ry * ex[1] + rz * ex[2];
          const ww = rx * ez[0] + ry * ez[1] + rz * ez[2];
          const e2 = (uu * uu) / (c.r * c.r) + (ww * ww) / (c.rz * c.rz);
          if (e2 < 1) {
            if (e2 < 1e-6) {
              x += ez[0] * c.rz;
              y += ez[1] * c.rz;
              z += ez[2] * c.rz;
            } else {
              const s = 1 / Math.sqrt(e2) - 1;
              x += (ex[0] * uu + ez[0] * ww) * s;
              y += (ex[1] * uu + ez[1] * ww) * s;
              z += (ex[2] * uu + ez[2] * ww) * s;
            }
          }
        } else {
          const d2 = rx * rx + ry * ry + rz * rz;
          if (d2 < c.r * c.r) {
            const d = Math.sqrt(d2) || 1e-6;
            const s = c.r / d - 1;
            x += rx * s;
            y += ry * s;
            z += rz * s;
          }
        }
      }
      if (y > ceil) y = ceil + (y - ceil) * 0.3;
      if (y < floor) {
        y = floor;
        // ground friction: drag the last position along
        q[o] += (x - q[o]) * 0.5;
        q[o + 2] += (z - q[o + 2]) * 0.5;
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
        let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const o = (j * cols + i) * 3;
        nrm[o] = nx / l;
        nrm[o + 1] = ny / l;
        nrm[o + 2] = nz / l;
      }
    }
  }

  // Orientation of the surface at a particle (x across, y up the cloth, z out)
  // from any position array laid out like the grid.
  static frame(arr, cols, rows, i, j, out) {
    const i0 = i > 0 ? i - 1 : 0;
    const i1 = i < cols - 1 ? i + 1 : cols - 1;
    const j0 = j > 0 ? j - 1 : 0;
    const j1 = j < rows - 1 ? j + 1 : rows - 1;
    _a.fromArray(arr, (j * cols + i1) * 3).sub(_b.fromArray(arr, (j * cols + i0) * 3));
    _c.fromArray(arr, (j1 * cols + i) * 3).sub(_b.fromArray(arr, (j0 * cols + i) * 3));
    _n.crossVectors(_c, _a).normalize();
    _a.addScaledVector(_n, -_a.dot(_n)).normalize();
    _c.crossVectors(_n, _a);
    _m.makeBasis(_a, _c, _n);
    return out.setFromRotationMatrix(_m);
  }
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
