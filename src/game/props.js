import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials } from '../render/shaders.js';
import { palette } from './kit.js';
import { part, merge, M } from './spill.js';

// What the bunny pulls out of his satchel to float down on: a big umbrella
// (teal and cream panels, a crook handle), a balloon on a string (its colour
// picked each time) or a giant dandelion clock. Each is a little model drawn
// with the runners' own illustrated shader (PROPS in CHAR_DETAIL), built
// round where his hand grips it (+y up away from his hand), in two parts: the
// part that opens or grows (the canopy, the balloon, the clock of seeds) and
// the rest. While he holds one it's a child of his own root, placed at his
// hand each frame (see Bunny.propStep); a balloon he lets go of is left
// behind in the world (track coordinates), rising and drifting off as he runs
// on. At most one held and one let go (four draw calls each, none at rest).

const COL = {
  1: '#3d9db0', // the umbrella's canopy: teal panels...
  2: '#f6ecd6', // ...and cream ones
  3: '#2c7383', // its hem
  4: '#e8453c', // the balloon (its colour picked each time)
  5: '#6f9a3c', // the dandelion's stem and its sepals
  6: '#fbf8ee', // its clock of seeds
  7: '#a39352', // its bald head, once the seeds have gone
  8: '#8a5a36', // wood
  9: '#d9d2c0', // the umbrella's tip
  10: '#efe6d6', // the balloon's string
  30: '#ffffff',
};
const BALLOONS = ['#e8453c', '#3f8fe0', '#f07aa8', '#f3b82c', '#58b66a'];

// --- the models --------------------------------------------------------------------
function curveTube(pts, r, m) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return part(new THREE.TubeGeometry(curve, 16, r, 6, false), m, null, false);
}

// The umbrella's canopy, its apex at the origin: a shallow dome scalloped
// between its eight ribs (uv.x round it, uv.y from the apex to the hem).
function canopy() {
  const prof = [[0.0, 0.0], [0.06, -0.004], [0.14, -0.022], [0.23, -0.055], [0.31, -0.098], [0.37, -0.138], [0.41, -0.168]];
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 48);
  const P = g.getAttribute('position');
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i), y = P.getY(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    // (the cloth sags between the ribs and lifts at their ends)
    const k = (r / 0.41) ** 2;
    P.setY(i, y + 0.03 * k * (1 - Math.abs(Math.cos(a * 4))) - 0.008 * k);
  }
  g.computeVertexNormals();
  return part(g, 1, null, false);
}

function umbrella() {
  return {
    grow: merge([canopy(), part(new THREE.CylinderGeometry(0.0, 0.009, 0.06, 8), 9, M(0, 0.03, 0))], 0.8),
    growAt: [0, 0.66, 0],
    rest: merge([
      part(new THREE.CylinderGeometry(0.0085, 0.0085, 0.72, 8), 8, M(0, 0.31, 0), false),
      part(new THREE.TorusGeometry(0.04, 0.011, 8, 14, Math.PI), 8, M(0.04, -0.05, 0, 0, 0, Math.PI), false),
      part(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 8), 3, M(0, 0.62, 0), false),
    ]),
  };
}

function balloon() {
  const g = new THREE.SphereGeometry(0.23, 24, 16);
  const P = g.getAttribute('position');
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i) / 0.23;
    // a teardrop: taller than wide, pinched in toward its knot
    const pinch = y < 0 ? 1 - 0.3 * y * y : 1;
    P.setXYZ(i, P.getX(i) * pinch, P.getY(i) * 1.15 + 0.265, P.getZ(i) * pinch);
  }
  g.computeVertexNormals();
  return {
    grow: merge([part(g, 4, null, false), part(new THREE.CylinderGeometry(0.004, 0.014, 0.03, 8), 4, M(0, 0.0, 0), false)], 0.8),
    growAt: [0.012, 0.6, 0.016],
    rest: merge([curveTube([[0, -0.02, 0], [0.012, 0.17, -0.01], [-0.006, 0.38, 0.012], [0.012, 0.6, 0.016]], 0.0032, 10)], 0.5),
  };
}

function dandelion() {
  // the clock: a ball of seeds, lumpy with their tufts
  const g = new THREE.IcosahedronGeometry(0.24, 4);
  const P = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const n = v.clone().normalize();
    const bump = 0.014 * Math.sin(n.x * 23 + n.y * 7) * Math.sin(n.y * 19 - n.z * 11) + 0.01 * Math.sin(n.z * 31 + n.x * 13) + 0.006 * Math.sin(n.x * 57 - n.y * 41);
    v.addScaledVector(n, bump);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).normalize();
    uv[i * 2] = Math.atan2(v.z, v.x) / (2 * Math.PI) + 0.5;
    uv[i * 2 + 1] = v.y * 0.5 + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return {
    grow: merge([part(g, 6, null, false)], 0.7),
    growAt: [0.034, 0.8, -0.024],
    rest: merge([
      curveTube([[0, -0.06, 0], [0.014, 0.2, 0.008], [0.036, 0.48, -0.008], [0.036, 0.73, -0.024]], 0.009, 5),
      part(new THREE.CylinderGeometry(0.04, 0.01, 0.055, 10), 5, M(0.036, 0.75, -0.024), false),
      part(new THREE.SphereGeometry(0.046, 12, 8), 7, M(0.034, 0.795, -0.024), false),
    ]),
  };
}

export const KINDS = ['umbrella', 'balloon', 'dandelion'];
const MAKE = { umbrella, balloon, dandelion };

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class Props {
  constructor(env) {
    const make = () => {
      const mats = makeCharacterMaterials(env, palette(COL), [], 0.0065, null, { style: 'props' });
      mats.mat.side = THREE.DoubleSide;
      return mats;
    };
    this.mats = make();
    // (the balloon let go of keeps its own colour while another is held)
    this.freeMats = make();
    this.models = {};
    for (const k of KINDS) {
      const m = MAKE[k]();
      this.models[k] = m;
    }
    const pair = (geo, mats) => {
      const g = new THREE.Group();
      for (const mat of [mats.mat, mats.ink]) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = -20;
        g.add(mesh);
      }
      return g;
    };
    // held: one of each, a child of the runner's root (see attach)
    this.held = {};
    for (const k of KINDS) {
      const m = this.models[k];
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.visible = false;
      const rest = pair(m.rest, this.mats);
      const grow = pair(m.grow, this.mats);
      grow.position.fromArray(m.growAt);
      g.add(rest, grow);
      this.held[k] = { g, grow };
    }
    // let go of: the balloon, left behind in the world
    this.free = new THREE.Group();
    this.free.name = 'props';
    const fb = this.models.balloon;
    this.freeBalloon = new THREE.Group();
    this.freeBalloon.add(pair(fb.rest, this.freeMats));
    const fg = pair(fb.grow, this.freeMats);
    fg.position.fromArray(fb.growAt);
    this.freeBalloon.add(fg);
    this.freeBalloon.visible = false;
    this.free.add(this.freeBalloon);
    this.loose = { live: false, x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, age: 0, spin: 0, q: new THREE.Quaternion() };
    this.shown = null;
  }

  attach(root) {
    for (const k of KINDS) root.add(this.held[k].g);
  }

  // A fresh balloon's colour (never the last one's).
  pickColour() {
    let c;
    do c = BALLOONS[Math.floor(Math.random() * BALLOONS.length)];
    while (c === this.lastColour && BALLOONS.length > 1);
    this.lastColour = c;
    this.mats.mat.uniforms.uPal.value[4].set(c);
  }

  // Hold kind at M (his hand's grip, root space): open, how far it's open
  // or grown (0 shut or tiny .. 1), size, its overall scale.
  hold(kind, Mg, open, size) {
    if (this.shown && this.shown !== kind) this.held[this.shown].g.visible = false;
    this.shown = kind;
    const H = this.held[kind];
    H.g.visible = size > 0.01;
    H.g.matrix.copy(Mg);
    H.g.matrix.scale(_s.setScalar(Math.max(size, 1e-3)));
    H.g.matrixWorldNeedsUpdate = true;
    const o = Math.min(1, Math.max(0, open));
    if (kind === 'umbrella') {
      // furled round its shaft, then the canopy springs open
      const e = o * o * (3 - 2 * o);
      H.grow.scale.set(0.07 + 0.93 * e, 2.5 - 1.5 * e, 0.07 + 0.93 * e);
    } else {
      // blown up, or grown out of nothing
      const e = 0.12 + 0.88 * o;
      H.grow.scale.setScalar(e);
    }
  }

  hide() {
    if (this.shown) this.held[this.shown].g.visible = false;
    this.shown = null;
  }

  // Where (root space) the held one's growing part is.
  growPoint(out) {
    const H = this.held[this.shown];
    if (!H) return out.set(0, 0, 0);
    return out.copy(H.grow.position).applyMatrix4(H.g.matrix);
  }

  // Let the held balloon go: it's left behind in the world, rising.
  letGo(root, z, dist, vel) {
    const H = this.held.balloon;
    if (this.shown !== 'balloon') return;
    const L = this.loose;
    H.g.matrix.decompose(_v, _q, _s);
    const w = _v.applyQuaternion(root.quaternion).add(root.position);
    L.live = true;
    L.x = w.x;
    L.y = w.y;
    L.d = dist - (w.z - z);
    // (it keeps most of his speed at first, so it's seen rising away over
    // him before the still air takes it and it drifts back past you)
    L.vx = vel.x * 0.4 + (Math.random() - 0.5) * 0.6;
    L.vy = 1.4 + Math.random() * 0.5;
    L.vd = -vel.z * 0.8;
    L.age = 0;
    L.s = _s.x;
    L.spin = (Math.random() - 0.5) * 1.4;
    L.q.copy(root.quaternion).multiply(_q);
    this.freeMats.mat.uniforms.uPal.value[4].copy(this.mats.mat.uniforms.uPal.value[4]);
    this.freeMats.ink.uniforms.uPal.value[4].copy(this.mats.mat.uniforms.uPal.value[4]);
    this.hide();
  }

  // The balloon let go of: it rises, bobbing and turning, the still air
  // taking his speed off it, and it shrinks away into the sky.
  update(dt, z, dist) {
    const L = this.loose;
    if (!L.live) {
      this.freeBalloon.visible = false;
      return;
    }
    L.age += dt;
    const k = Math.exp(-1.1 * dt);
    L.vx *= k;
    L.vd *= k;
    L.vy += (2.2 - L.vy) * (1 - Math.exp(-1.2 * dt));
    L.x += (L.vx + 0.25 * Math.sin(L.age * 2.3)) * dt;
    L.y += L.vy * dt;
    L.d += L.vd * dt;
    const fade = 1 - Math.min(1, Math.max(0, (L.age - 1.8) / 1.4));
    if (fade <= 0 || L.d < dist - 30) {
      L.live = false;
      this.freeBalloon.visible = false;
      return;
    }
    const B = this.freeBalloon;
    B.visible = true;
    B.position.set(L.x, L.y, z - (L.d - dist));
    _q.setFromAxisAngle(_v.set(0, 1, 0), L.spin * L.age);
    B.quaternion.copy(L.q).premultiply(_q);
    // (it rights itself as it rises, string hanging)
    B.quaternion.slerp(_q, Math.min(1, L.age * 1.5));
    B.scale.setScalar(L.s * (0.6 + 0.4 * fade));
  }

  clear() {
    this.hide();
    this.loose.live = false;
    this.freeBalloon.visible = false;
  }

  forCompile(on) {
    for (const k of KINDS) this.held[k].g.visible = on;
    this.freeBalloon.visible = on;
    if (!on) this.shown = null;
  }
}
