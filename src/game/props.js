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
// hand each frame (see Bunny.propStep); when he lands he lets it go, and it
// floats away on its own (track coordinates, kept a little way back from
// him at first so you see it go), each in its own way (see update). At most
// one held and one of each let go (four draw calls each, none at rest).

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
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// Let go of, each turns about a point of its own (up it from his grip):
// the umbrella about the middle of its shaft, the balloon about the end of
// its string, the dandelion about its head (its stalk swinging under it).
const PIVOT = { umbrella: 0.42, balloon: 0, dandelion: 0.8 };

export class Props {
  constructor(env) {
    const make = () => {
      const mats = makeCharacterMaterials(env, palette(COL), [], 0.0065, null, { style: 'props' });
      mats.mat.side = THREE.DoubleSide;
      return mats;
    };
    this.mats = make();
    // (let go of: a balloon keeps its own colour while another is held)
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
    // let go of: one of each, floating away in the world
    this.free = new THREE.Group();
    this.free.name = 'props';
    this.loose = {};
    for (const k of KINDS) {
      const m = this.models[k];
      const g = new THREE.Group();
      g.add(pair(m.rest, this.freeMats));
      const grow = pair(m.grow, this.freeMats);
      grow.position.fromArray(m.growAt);
      g.add(grow);
      g.visible = false;
      this.free.add(g);
      this.loose[k] = { kind: k, g, grow, live: false, x: 0, y: 0, rel: 0, vx: 0, vy: 0, vrel: 0, age: 0, s: 1, side: 1, ph: 0, seedT: 0, q: new THREE.Quaternion() };
    }
    this.seeds = null; // (the bunny's: the dandelion sheds them as it goes)
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

  // Let go of the one he's holding (kind): it floats away from where it is
  // (dist: how far he's run; vel: his own sideways and upward speed, which
  // it keeps a little of).
  letGo(kind, root, dist, vel) {
    const H = this.held[kind];
    if (!H || this.shown !== kind) return;
    const L = this.loose[kind];
    H.g.matrix.decompose(_v, _q, _s);
    L.q.copy(root.quaternion).multiply(_q);
    L.s = _s.x;
    // (where its pivot is, in the world)
    _v2.set(0, PIVOT[kind] * L.s, 0).applyQuaternion(L.q);
    const w = _v.applyQuaternion(root.quaternion).add(root.position).add(_v2);
    L.live = true;
    L.x = w.x;
    L.y = w.y;
    // (ahead of him, - behind: it starts in his hand and is let fall back)
    L.rel = -(w.z - root.position.z);
    L.age = 0;
    L.ph = Math.random() * Math.PI * 2;
    // (toward the nearer edge of the road, mostly)
    L.side = Math.sign(w.x + (Math.random() - 0.5) * 2.4) || 1;
    L.seedT = 0;
    L.vx = vel.x * 0.35;
    L.vy = vel.y * 0.25;
    L.vrel = 0;
    if (kind === 'balloon') {
      L.vy += 1.2;
      L.vx += (Math.random() - 0.5) * 0.5;
      this.freeMats.mat.uniforms.uPal.value[4].copy(this.mats.mat.uniforms.uPal.value[4]);
      this.freeMats.ink.uniforms.uPal.value[4].copy(this.mats.mat.uniforms.uPal.value[4]);
    } else if (kind === 'umbrella') {
      // (a gust catches it under its canopy)
      L.vy += 4.4;
      L.vx += L.side * 1.5;
    } else {
      L.vy += 0.9;
      L.vx += L.side * 0.35;
    }
    // (as it was: open, grown, blown up)
    L.grow.scale.copy(H.grow.scale);
    this.hide();
  }

  // Everything let go of, floating away: the air takes it off him - it
  // drifts back from where he's got to, slowly at first (it's carried along
  // in the rush of air behind him a moment), faster and faster, back past
  // you - while it goes its own way:
  //   - the balloon rises straight up and away, quicker as it goes, swaying
  //     on its string like a pendulum and turning slowly, shrinking away
  //     into the sky;
  //   - the umbrella is caught by a gust: up it goes, tumbling end over end
  //     and twirling round its shaft, sailing out over the edge of the road,
  //     then sinking, rocking, as the gust lets it down;
  //   - the dandelion drifts lazily up, rocking side to side like a feather
  //     and turning, shedding its seeds in a stream behind it till its head
  //     is bald - and then its bare stalk tips over and sinks away.
  update(dt, z, dist) {
    // (how fast he's running: the seeds the dandelion sheds go at its pace)
    const run = dt > 0 && this.lastDist !== undefined ? (dist - this.lastDist) / dt : 0;
    this.run = run > 0 && run < 60 ? run : 0;
    this.lastDist = dist;
    for (const k of KINDS) {
      const L = this.loose[k];
      if (!L.live) {
        L.g.visible = false;
        continue;
      }
      L.age += dt;
      const a = L.age;
      const g = L.g;
      let life, fade;
      if (k === 'balloon') {
        L.vy += (2.8 - L.vy) * (1 - Math.exp(-1.4 * dt));
        L.vx *= Math.exp(-0.9 * dt);
        L.vrel += (-4 - L.vrel) * (1 - Math.exp(-0.7 * dt));
        L.x += (L.vx + 0.3 * Math.sin(a * 2.1 + L.ph)) * dt;
        L.y += L.vy * dt;
        L.rel += L.vrel * dt;
        // (righting itself as it rises, string hanging; swaying, and turning
        // a little this way and that - never right round: the shine's drawn
        // on it, and it would come round to face you and white it out)
        const up = Math.min(1, a * 1.6);
        _q.setFromAxisAngle(_Z, 0.28 * Math.sin(a * 2.1 + L.ph + 1.3) * up);
        _q2.setFromAxisAngle(_Y, 0.3 * Math.sin(a * 1.1 + L.ph));
        _q.multiply(_q2);
        g.quaternion.copy(L.q).slerp(_q, up);
        life = 3.4;
        fade = smooth(2.2, 3.4, a);
      } else if (k === 'umbrella') {
        // the gust: it lifts it, then lets it down
        L.vy += (0.3 - L.vy) * (1 - Math.exp(-1.1 * dt));
        L.vx *= Math.exp(-0.5 * dt);
        L.vrel += (-4.2 - L.vrel) * (1 - Math.exp(-0.8 * dt));
        L.x += (L.vx + 0.25 * Math.sin(a * 3.3 + L.ph)) * dt;
        L.y = Math.max(0.45, L.y + L.vy * dt);
        L.rel += L.vrel * dt;
        // tumbling end over end (over backward, the canopy leading), quick
        // at first, slowing as the gust drops; twirling round its shaft;
        // rocking as it sails
        const tumble = -(5.5 * (1 - Math.exp(-a)) + 0.6 * a);
        _q.setFromAxisAngle(_X, tumble);
        _q2.setFromAxisAngle(_Z, L.side * (0.5 * smooth(0, 0.6, a) + 0.22 * Math.sin(a * 3.3 + L.ph)));
        _q.premultiply(_q2);
        g.quaternion.copy(L.q).premultiply(_q);
        g.quaternion.multiply(_q2.setFromAxisAngle(_Y, L.side * (8.4 * (1 - Math.exp(-a / 1.2)) + 1.5 * a)));
        // (its canopy fluttering)
        const fl = 1 + 0.06 * Math.sin(a * 13 + L.ph) * Math.exp(-a * 0.8);
        L.grow.scale.set(fl, 1 / fl, fl);
        life = 3.0;
        fade = smooth(2.3, 3.0, a);
      } else {
        // a feather on the air: up lazily, rocking; once bald, down again
        const bald = smooth(1.3, 2.1, a);
        L.vy += (0.35 * (1 - bald) - 0.9 * bald - L.vy) * (1 - Math.exp(-1.6 * dt));
        L.vx *= Math.exp(-1.2 * dt);
        L.vrel += (-3.2 - L.vrel) * (1 - Math.exp(-0.6 * dt));
        const rock = Math.sin(a * 2.6 + L.ph);
        L.x += (L.vx + 0.45 * rock) * dt;
        L.y = Math.max(0.3, L.y + (L.vy + 0.18 * Math.abs(rock)) * dt);
        L.rel += L.vrel * dt;
        // (rocking about its head as it slides side to side, turning; its
        // bare stalk tipping over as it sinks)
        const up = Math.min(1, a * 1.2);
        _q.setFromAxisAngle(_Z, -0.45 * rock * up + L.side * 1.3 * bald);
        _q2.setFromAxisAngle(_X, 0.25 * Math.sin(a * 1.7 + L.ph) * up);
        _q.multiply(_q2);
        _q.multiply(_q2.setFromAxisAngle(_Y, 0.9 * a));
        g.quaternion.copy(L.q).slerp(_q, up);
        // its clock blown away, seed by seed
        const left = 1 - smooth(0.05, 1.9, a);
        L.grow.scale.setScalar(Math.max(1e-3, 0.12 + 0.88 * left) * (left > 0.02 ? 1 : left / 0.02));
        L.seedT -= dt;
        if (left > 0.03 && L.seedT <= 0 && this.seeds) {
          L.seedT = 0.035 + 0.04 * Math.random();
          this.shed(L, dist, left);
        }
        life = 3.4;
        fade = smooth(2.7, 3.4, a);
      }
      if (a >= life || L.rel < -14) {
        L.live = false;
        g.visible = false;
        continue;
      }
      g.visible = true;
      // (placed by its pivot)
      g.scale.setScalar(L.s * (k === 'balloon' ? 1 - 0.45 * fade : 1 - fade));
      _v.set(0, -PIVOT[k] * g.scale.x, 0).applyQuaternion(g.quaternion);
      g.position.set(L.x + _v.x, L.y + _v.y, z - L.rel + _v.z);
    }
  }

  // A seed or two off the loose dandelion's clock, blown back off it into
  // the air, rising a little on it.
  shed(L, dist, left) {
    const r = Math.random;
    const n = 1 + (r() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      _v2.set(r() - 0.5, r() - 0.2, r() - 0.5).normalize();
      const rad = 0.22 * L.s * (0.12 + 0.88 * left);
      const d = dist + L.rel - _v2.z * rad;
      this.seeds.emitWorld(L.x + _v2.x * rad, L.y + _v2.y * rad, d, _v2.x * 0.6 + L.vx, 0.3 + 0.5 * r(), this.run + L.vrel + (r() - 0.6) * 0.8, 0.07 + 0.03 * r(), 0.12 + 0.2 * r());
    }
  }

  clear() {
    this.hide();
    for (const k of KINDS) {
      this.loose[k].live = false;
      this.loose[k].g.visible = false;
    }
  }

  forCompile(on) {
    for (const k of KINDS) {
      this.held[k].g.visible = on;
      this.loose[k].g.visible = on;
    }
    if (!on) this.shown = null;
  }
}
