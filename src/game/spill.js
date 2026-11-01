import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials } from '../render/shaders.js';
import { palette } from './kit.js';

// What flies out of the explorer's backpack when its lid pops: a page torn
// from her sketchbook, a folded map, a magnifying glass, a compass, a pencil,
// a brass key, a spyglass, a sticking plaster, a pressed leaf. Each is a
// little model drawn with the runners' own illustrated shader (ITEMS in
// CHAR_DETAIL), thrown up out of the pack and left behind in the world: they
// carry her speed away with them, then the still air takes it - the flat
// things catch it on their faces and glide, flutter and tumble; the heavy
// ones arc, bounce and skid along the road - and they fall away past the
// camera. At most a handful fly at once (two draw calls each, none at rest).

const COL = {
  1: '#fbf5e8', // paper
  2: '#ecd39c', // map
  3: '#d9a640', // brass
  4: '#cfeef5', // glass
  5: '#8a5a36', // wood, leather
  6: '#f3c33a', // pencil
  7: '#f08aa0', // eraser
  8: '#3a3436', // graphite
  9: '#f7f2e6', // the compass's face
  10: '#d8483a', // red
  12: '#e9bb8e', // plaster
  13: '#7fb35a', // leaf
  14: '#4a3a30', // ink
  15: '#5ea3d4', // river, ruled lines
  16: '#8cbc6a', // woods
  30: '#f6e6c2',
};

// --- the models --------------------------------------------------------------
// A part: a three.js geometry placed by a matrix, drawn as material m. Each
// vertex carries the part's own uv and which face it's on (1 front, 2 back,
// 0 an edge) for the shader to draw on.
const _n = new THREE.Vector3();
function part(geo, m, M, faces = true) {
  if (M) geo.applyMatrix4(M);
  const g = geo.index ? geo : geo;
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const count = g.getAttribute('position').count;
  const d = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    _n.fromBufferAttribute(nrm, i);
    d[i * 4] = uv ? uv.getX(i) : 0;
    d[i * 4 + 1] = uv ? uv.getY(i) : 0;
    d[i * 4 + 2] = faces ? (_n.z > 0.7 ? 1 : _n.z < -0.7 ? 2 : 0) : 1;
  }
  return { g, m, d };
}

function merge(parts, outline = 1) {
  let nv = 0, ni = 0;
  for (const p of parts) {
    nv += p.g.getAttribute('position').count;
    ni += p.g.index ? p.g.index.count : p.g.getAttribute('position').count;
  }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), on = new Float32Array(nv * 3);
  const det = new Float32Array(nv * 4), mat = new Uint8Array(nv);
  const idx = new Uint16Array(ni);
  let v = 0, k = 0;
  for (const p of parts) {
    const P = p.g.getAttribute('position'), Nn = p.g.getAttribute('normal');
    const c = P.count;
    pos.set(P.array, v * 3);
    nrm.set(Nn.array, v * 3);
    for (let i = 0; i < c * 3; i++) on[v * 3 + i] = Nn.array[i] * outline;
    det.set(p.d, v * 4);
    mat.fill(p.m, v, v + c);
    if (p.g.index) for (let i = 0; i < p.g.index.count; i++) idx[k++] = p.g.index.array[i] + v;
    else for (let i = 0; i < c; i++) idx[k++] = v + i;
    v += c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('onrm', new THREE.BufferAttribute(on, 3));
  geo.setAttribute('aD', new THREE.BufferAttribute(det, 4));
  geo.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

// bend a flat box's vertices: z += f(x, y)
function bend(geo, f) {
  const P = geo.getAttribute('position');
  for (let i = 0; i < P.count; i++) P.setZ(i, P.getZ(i) + f(P.getX(i), P.getY(i)));
  geo.computeVertexNormals();
  return geo;
}

const KINDS = {
  page: {
    weight: 3,
    flat: true,
    make: () => [part(bend(new THREE.BoxGeometry(0.21, 0.28, 0.004, 8, 8, 1), (x, y) => 0.035 * Math.sin((x / 0.21) * Math.PI) * 0.6 + 0.02 * (y / 0.28) ** 2), 1)],
  },
  map: {
    weight: 2,
    flat: true,
    // folded in three, the folds still standing a little open
    make: () => [part(bend(new THREE.BoxGeometry(0.32, 0.22, 0.004, 12, 4, 1), (x) => 0.025 * Math.abs(((x / 0.32 + 0.5) * 3) % 2 - 1) - 0.0125), 2)],
  },
  lens: {
    weight: 2,
    make: () => [
      part(new THREE.TorusGeometry(0.056, 0.01, 8, 24), 3, null, false),
      part(new THREE.CylinderGeometry(0.052, 0.052, 0.007, 24), 4, M(0, 0, 0, Math.PI / 2), false),
      part(new THREE.CylinderGeometry(0.014, 0.012, 0.025, 10), 3, M(0, -0.075, 0)),
      part(new THREE.CylinderGeometry(0.012, 0.014, 0.11, 10), 5, M(0, -0.14, 0), false),
    ],
  },
  compass: {
    weight: 1.5,
    make: () => [
      part(new THREE.CylinderGeometry(0.05, 0.052, 0.024, 24), 3, M(0, 0, 0, Math.PI / 2), false),
      part(new THREE.CylinderGeometry(0.043, 0.043, 0.004, 24), 9, M(0, 0, -0.012, Math.PI / 2, 0, 0)),
      part(new THREE.TorusGeometry(0.012, 0.004, 6, 12), 3, M(0, 0.058, 0), false),
    ],
  },
  pencil: {
    weight: 1.5,
    make: () => [
      part(new THREE.CylinderGeometry(0.01, 0.01, 0.17, 6), 6, null, false),
      part(new THREE.CylinderGeometry(0.0035, 0.01, 0.032, 6), 5, M(0, -0.101, 0, Math.PI), false),
      part(new THREE.CylinderGeometry(0.0, 0.0035, 0.01, 6), 8, M(0, -0.121, 0, Math.PI), false),
      part(new THREE.CylinderGeometry(0.0105, 0.0105, 0.014, 10), 3, M(0, 0.092, 0), false),
      part(new THREE.CylinderGeometry(0.0095, 0.0095, 0.016, 10), 7, M(0, 0.107, 0), false),
    ],
  },
  key: {
    weight: 1,
    make: () => [
      part(new THREE.TorusGeometry(0.022, 0.007, 8, 18), 3, M(0, 0.06, 0), false),
      part(new THREE.CylinderGeometry(0.0055, 0.0055, 0.1, 8), 3, M(0, 0, 0), false),
      part(new THREE.BoxGeometry(0.022, 0.008, 0.007), 3, M(0.012, -0.04, 0), false),
      part(new THREE.BoxGeometry(0.016, 0.008, 0.007), 3, M(0.009, -0.025, 0), false),
    ],
  },
  spyglass: {
    weight: 1,
    make: () => [
      part(new THREE.CylinderGeometry(0.028, 0.028, 0.12, 14), 3, M(0, 0.07, 0), false),
      part(new THREE.CylinderGeometry(0.0295, 0.0295, 0.05, 14), 5, M(0, 0.07, 0), false),
      part(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 12), 3, M(0, -0.03, 0), false),
      part(new THREE.CylinderGeometry(0.017, 0.017, 0.07, 12), 3, M(0, -0.11, 0), false),
      part(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 14), 4, M(0, 0.135, 0), false),
    ],
  },
  plaster: {
    weight: 1,
    flat: true,
    make: () => [part(new THREE.BoxGeometry(0.11, 0.036, 0.003, 4, 1, 1), 12)],
  },
  leaf: {
    weight: 1,
    flat: true,
    make: () => {
      const g = new THREE.BoxGeometry(0.15, 0.09, 0.003, 10, 4, 1);
      const P = g.getAttribute('position');
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i) / 0.075;
        P.setY(i, P.getY(i) * Math.sqrt(Math.max(0.02, 1 - x * x)) * (1 - 0.25 * x));
        P.setZ(i, P.getZ(i) + 0.012 * (1 - (P.getY(i) / 0.045) ** 2));
      }
      g.computeVertexNormals();
      return [part(g, 13)];
    },
  },
};
const NAMES = Object.keys(KINDS);
const TOTAL = NAMES.reduce((a, k) => a + KINDS[k].weight, 0);

// Items are a little larger than life so they read at a glance.
const SCALE = 1.35;
const MAX = 6;
const G_FLAT = 9.8;
const G_HEAVY = 17;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qd = new THREE.Quaternion();

export class Spill {
  constructor(env) {
    const mats = makeCharacterMaterials(env, palette(COL), [], 0.0075, null, { style: 'items' });
    this.mat = mats.mat;
    this.ink = mats.ink;
    this.mat.side = THREE.DoubleSide;
    this.geos = {};
    for (const k of NAMES) this.geos[k] = merge(KINDS[k].make());
    this.group = new THREE.Group();
    this.group.name = 'spill';
    this.items = [];
    for (let i = 0; i < MAX; i++) {
      const a = new THREE.Mesh(this.geos.page, this.mat);
      const b = new THREE.Mesh(this.geos.page, this.ink);
      for (const m of [a, b]) {
        m.visible = false;
        m.scale.setScalar(SCALE);
        m.renderOrder = -18;
        this.group.add(m);
      }
      this.items.push({ live: false, mesh: a, ink: b, kind: 'page', x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, q: new THREE.Quaternion(), w: new THREE.Vector3(), age: 0, rest: false, seed: 0 });
    }
    this.queue = [];
    this.last = [];
  }

  // Pick a kind: by weight, but not one of the last two thrown.
  pick(rnd) {
    for (let tries = 0; tries < 6; tries++) {
      let r = rnd() * TOTAL;
      for (const k of NAMES) {
        r -= KINDS[k].weight;
        if (r <= 0) {
          if (!this.last.includes(k) || tries === 5) {
            this.last.push(k);
            if (this.last.length > 2) this.last.shift();
            return k;
          }
          break;
        }
      }
    }
    return 'page';
  }

  // Throw one: p, v in the runner's space (where the pack's lid is and how
  // fast it's moving with her), carried into the world by place().
  throw(p, v, rnd = Math.random) {
    this.queue.push({ p: p.clone(), v: v.clone(), kind: this.pick(rnd), r: rnd() });
  }

  // Launch the queued throws (root: the runner's object, placed; dist: how
  // far they've run) and fly every live item one step.
  update(dt, root, z, dist) {
    for (const t of this.queue) {
      let it = this.items.find((i) => !i.live);
      if (!it) it = this.items.reduce((a, b) => (a.age > b.age ? a : b));
      it.live = true;
      it.kind = t.kind;
      it.flat = !!KINDS[t.kind].flat;
      it.mesh.geometry = it.ink.geometry = this.geos[t.kind];
      _v.copy(t.p).applyQuaternion(root.quaternion).add(root.position);
      it.x = _v.x;
      it.y = _v.y;
      it.d = dist - (_v.z - z);
      _w.copy(t.v).applyQuaternion(root.quaternion);
      it.vx = _w.x;
      it.vy = _w.y;
      it.vd = -_w.z;
      it.q.setFromEuler(new THREE.Euler(t.r * 6, t.r * 17, t.r * 11));
      const spin = it.flat ? 7 : 11;
      it.w.set((t.r - 0.5) * spin * 2, (((t.r * 7.3) % 1) - 0.5) * spin, (((t.r * 13.1) % 1) - 0.5) * spin * 1.6);
      it.age = 0;
      it.rest = false;
      it.seed = t.r * 100;
    }
    this.queue.length = 0;
    if (dt <= 0) return this.place(z, dist);
    for (const it of this.items) {
      if (!it.live) continue;
      it.age += dt;
      if (it.flat) this.flutter(it, dt);
      else this.tumble(it, dt);
      // gone once it's well behind the camera, or has lain a while
      if (it.d < dist - 11 || it.age > 6) {
        it.live = false;
        it.mesh.visible = it.ink.visible = false;
      }
    }
    this.place(z, dist);
  }

  // Flat things catch the air on their faces: the push is along the face's
  // normal, in proportion to the air through it (so they glide edge-on and
  // drop slowly face-down), a little drag along it, and they turn over and
  // over in it.
  flutter(it, dt) {
    const n = _v.set(0, 0, 1).applyQuaternion(it.q);
    if (it.rest) return this.lie(it, dt);
    // velocity in track space: x, y, along (d, forward); the air is still
    const vf = -it.vd; // forward is -z
    const vn = it.vx * n.x + it.vy * n.y + vf * n.z;
    const kn = 5.5, kt = 0.5;
    let ax = -kn * vn * n.x - kt * (it.vx - vn * n.x);
    let ay = -kn * vn * n.y - kt * (it.vy - vn * n.y) - G_FLAT;
    let az = -kn * vn * n.z - kt * (vf - vn * n.z);
    // a wavering of the air, so no two fall alike
    const s = it.seed + it.age * 3.1;
    ax += 2.2 * Math.sin(s * 1.7);
    ay += 1.2 * Math.sin(s * 2.3 + 1);
    it.vx += ax * dt;
    it.vy += ay * dt;
    it.vd -= az * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    it.d += it.vd * dt;
    // turning over: the spin wanders, and settles as it slows
    it.w.x += Math.sin(s * 1.3) * 18 * dt;
    it.w.z += Math.cos(s * 0.9) * 12 * dt;
    it.w.multiplyScalar(Math.exp(-0.6 * dt));
    this.spin(it, dt);
    if (it.y < 0.02) {
      it.y = 0.02;
      it.rest = true;
      it.vy = 0;
    }
  }

  // Heavy things arc under gravity with a little drag, spinning, then bounce
  // and skid to a stop.
  tumble(it, dt) {
    if (it.rest) return this.lie(it, dt);
    const k = 0.35;
    it.vx -= it.vx * k * dt;
    it.vd -= it.vd * k * dt;
    it.vy -= (G_HEAVY + it.vy * k) * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    it.d += it.vd * dt;
    this.spin(it, dt);
    if (it.y < 0.05 && it.vy < 0) {
      it.y = 0.05;
      if (it.vy > -2.5) {
        it.rest = true;
        it.vy = 0;
      } else {
        it.vy *= -0.38;
        it.vd *= 0.55;
        it.vx *= 0.6;
        it.w.multiplyScalar(0.6);
      }
    }
  }

  // On the road: it slides to a stop (friction against the ground it lies
  // on) and settles flat.
  lie(it, dt) {
    const f = Math.exp(-7 * dt);
    it.vd *= f;
    it.vx *= f;
    it.d += it.vd * dt;
    it.x += it.vx * dt;
    it.w.multiplyScalar(Math.exp(-6 * dt));
    this.spin(it, dt);
    // ease toward lying flat, face up or down as it landed
    const n = _v.set(0, 0, 1).applyQuaternion(it.q);
    const up = n.y >= 0 ? 1 : -1;
    _qd.setFromUnitVectors(n, _w.set(0, up, 0));
    _q.identity().slerp(_qd, 1 - Math.exp(-10 * dt));
    if (it.flat) it.q.premultiply(_q);
  }

  spin(it, dt) {
    const a = it.w.length();
    if (a < 1e-5) return;
    _qd.setFromAxisAngle(_v.copy(it.w).divideScalar(a), a * dt);
    it.q.premultiply(_qd);
  }

  place(z, dist) {
    for (const it of this.items) {
      if (!it.live) continue;
      it.mesh.visible = it.ink.visible = true;
      it.mesh.position.set(it.x, it.y, z - (it.d - dist));
      it.mesh.quaternion.copy(it.q);
      it.ink.position.copy(it.mesh.position);
      it.ink.quaternion.copy(it.q);
    }
  }

  clear() {
    this.queue.length = 0;
    for (const it of this.items) {
      it.live = false;
      it.mesh.visible = it.ink.visible = false;
    }
  }

  // Show every model once (warm-up: compiled and uploaded before the run).
  forCompile(on) {
    this.items.forEach((it, i) => {
      it.mesh.visible = it.ink.visible = on;
      if (on) it.mesh.geometry = it.ink.geometry = this.geos[NAMES[i % NAMES.length]];
    });
  }
}
