import * as THREE from '../../vendor/three/three.module.min.js';
import { makeSplashMaterial } from '../render/shaders.js';

// Water splashing up from under the fisherman's boots - drawn like a
// cartoon's water, flat and bright: a white-aqua heart, a teal edge, a fine
// darker line round it. Every splash is made of a few pieces:
//   - fingers: tongues of water thrown up and out from round where the boot
//     came down (a crown of them), each a tapering stroke from its root on
//     the road to its head flying up on its own arc, a drop pinching off its
//     head as it slows and the rest of it falling back;
//   - a jet: one thick column straight up out of the middle (now and then),
//     a drop pinching off its top;
//   - drops: round beads flung off on their own arcs, gone where they fall;
//   - a ring: a thin broken ellipse on the road, spreading out and fading;
//   - a puddle: an uneven flat splat where it landed, shrinking away.
// Take-off is small and quick: a short spray, a few drops; a landing is
// bigger, flung outward, in one of three shapes (dealt so the same one
// never comes twice running): an upward spray round a jet, an uneven crown,
// or a low fan thrown out to the sides. Everything's in track coordinates
// (as the dust is), so it's left behind where it happened, carried on with a
// share of the runner's speed (water flung off a running boot keeps some of
// its way) - except what lies on the road, which stays put.
//
// All of it is one draw call of camera-facing quads out of fixed pools (no
// garbage, nothing drawn while the air is dry); none of it touches the run.

const SEGS = 56; // fingers and jets at once
const DROPS = 72;
const FLATS = 8; // rings and puddles
const QUADS = SEGS + DROPS + FLATS;
const G = 15; // how hard it falls (m/s^2: the game's gravity is strong)
const STYLES = ['spray', 'crown', 'fan'];

const _w = new THREE.Vector3();
const _v = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _tv = new THREE.Vector3();

export class Splashes {
  constructor(env) {
    const n = QUADS * 4;
    this.pos = new Float32Array(n * 3);
    this.tan = new Float32Array(n * 3);
    this.q = new Float32Array(n * 4);
    this.info = new Float32Array(n * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aTan', new THREE.BufferAttribute(this.tan, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aQ', new THREE.BufferAttribute(this.q, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array(QUADS * 6);
    for (let k = 0; k < QUADS; k++) {
      const a = k * 4;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.material = makeSplashMaterial(env);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    this.mesh.userData.noCast = true;
    const P = () => ({ live: false, x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, bx: 0, by: 0, bd: 0, bvx: 0, bvd: 0, age: 0, life: 1, size: 0.02, w: 0.02, seed: 0, ground: 0, popped: false, kind: 0, grow: 1 });
    this.segs = Array.from({ length: SEGS }, P);
    this.drops = Array.from({ length: DROPS }, P);
    this.flats = Array.from({ length: FLATS }, P);
    this.next = { segs: 0, drops: 0, flats: 0 };
    // (what's been asked for since the last update, in runner space)
    this.queue = Array.from({ length: 8 }, () => ({ p: new THREE.Vector3(), run: new THREE.Vector3(), land: false, hit: 1, style: 'crown', side: 0 }));
    this.queued = 0;
    this.trail = Array.from({ length: 12 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), size: 0.01 }));
    this.trailed = 0;
    this.lastStyle = '';
    this.deck = [];
  }

  // A splash at p (runner space, on the road) as a boot takes off (land
  // false) or comes down (land true) - hit: how hard (1 a plain jump's
  // landing) - the runner moving at run (runner space). side: which boot
  // (the two boots of one landing share its shape).
  burst(p, run, land, hit, side = 0) {
    if (this.queued >= this.queue.length) return;
    const Q = this.queue[this.queued++];
    Q.p.copy(p);
    Q.run.copy(run);
    Q.land = land;
    Q.hit = hit;
    Q.side = side;
    if (land && side === 0) {
      if (!this.deck.length) {
        const d = STYLES.slice().sort(() => Math.random() - 0.5);
        if (d[d.length - 1] === this.lastStyle) d.reverse();
        this.deck = d;
      }
      this.lastStyle = this.deck.pop();
    }
    Q.style = this.lastStyle || 'crown';
  }

  // A drop shed off a sole just after take-off (runner space, moving at v).
  shed(p, v, size) {
    if (this.trailed >= this.trail.length) return;
    const T = this.trail[this.trailed++];
    T.p.copy(p);
    T.v.copy(v);
    T.size = size;
  }

  take(pool, key) {
    const arr = this[pool];
    const it = arr[this.next[key]];
    this.next[key] = (this.next[key] + 1) % arr.length;
    it.live = true;
    it.age = 0;
    it.popped = false;
    it.seed = Math.random();
    return it;
  }

  // (a point and a velocity from runner space into track coordinates)
  toTrack(it, p, v, root, z, dist, carry) {
    const w = _tp.copy(p).applyQuaternion(root.quaternion).add(root.position);
    it.x = w.x;
    it.y = w.y;
    it.d = dist - (w.z - z);
    if (v) {
      const vv = _tv.copy(v).applyQuaternion(root.quaternion);
      it.vx = vv.x;
      it.vy = vv.y;
      it.vd = -vv.z;
    }
  }

  spawn(Q, root, z, dist) {
    const r = Math.random;
    const land = Q.land;
    const hit = Math.min(1.6, Math.max(0.4, Q.hit));
    // (water off a running boot keeps a share of its way; what lies on the
    // road stays where it is)
    const carry = land ? 0.55 : 0.68;
    const run = Q.run;
    const style = land ? Q.style : 'takeoff';
    const ground = root.position.y + Q.p.y;
    const fingers = style === 'takeoff' ? 4 + Math.floor(r() * 3) : style === 'crown' ? 9 + Math.floor(r() * 4) : style === 'fan' ? 8 + Math.floor(r() * 3) : 5 + Math.floor(r() * 3);
    const a0 = r() * Math.PI * 2;
    // fingers
    for (let k = 0; k < fingers; k++) {
      const it = this.take('segs', 'segs');
      const a = a0 + (k / fingers) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      // (a little ellipse, longer along the run - a boot's print)
      const r0 = (land ? 0.05 : 0.035) + 0.015 * r();
      _v.set(Q.p.x + ca * r0 * 0.8, Q.p.y + 0.004, Q.p.z + sa * r0);
      // how it's thrown: up and out (the fan: mostly out, low; the spray:
      // mostly up; take-off: short and quick)
      let up, out;
      if (style === 'fan') (up = 1.1 + 0.9 * r()), (out = 1.8 + 1.1 * r());
      else if (style === 'spray') (up = 2.2 + 1.2 * r()), (out = 0.5 + 0.6 * r());
      else if (style === 'crown') (up = 1.5 + 1.3 * r() * r()), (out = 0.9 + 0.6 * r());
      else (up = 1.1 + 0.8 * r()), (out = 0.5 + 0.5 * r());
      const s = (land ? Math.sqrt(hit) : 0.85) * (k % 3 === 1 ? 0.7 : 1);
      this.toTrack(it, _v, null, root, z, dist, carry);
      it.bx = it.x;
      it.by = it.y;
      it.bd = it.d;
      const vv = _w.set(ca * out * s + run.x * carry, up * s, sa * out * s + run.z * carry).applyQuaternion(root.quaternion);
      it.vx = vv.x;
      it.vy = vv.y;
      it.vd = -vv.z;
      // (the root creeps outward with it, slower, and on with the run)
      const rv = _v.set(ca * out * 0.25 + run.x * carry, 0, sa * out * 0.25 + run.z * carry).applyQuaternion(root.quaternion);
      it.bvx = rv.x;
      it.bvd = -rv.z;
      it.w = (land ? 0.04 : 0.03) * (0.75 + 0.5 * r()) * (style === 'fan' ? 0.85 : 1);
      it.life = (land ? 0.36 : 0.24) + 0.12 * r();
      it.ground = ground;
      it.kind = 0;
    }
    // the jet (the spray always; a crown now and then; a take-off never)
    if (style === 'spray' || (style === 'crown' && r() < 0.5)) {
      const it = this.take('segs', 'segs');
      _v.set(Q.p.x, Q.p.y + 0.004, Q.p.z);
      this.toTrack(it, _v, null, root, z, dist, carry);
      it.bx = it.x;
      it.by = it.y;
      it.bd = it.d;
      const vv = _w.set(run.x * carry + (r() - 0.5) * 0.3, (style === 'spray' ? 3.4 : 2.7) * Math.sqrt(hit), run.z * carry).applyQuaternion(root.quaternion);
      it.vx = vv.x;
      it.vy = vv.y;
      it.vd = -vv.z;
      const rv = _v.set(run.x * carry, 0, run.z * carry).applyQuaternion(root.quaternion);
      it.bvx = rv.x;
      it.bvd = -rv.z;
      it.w = 0.065 * (0.85 + 0.3 * r());
      it.life = 0.42 + 0.1 * r();
      it.ground = ground;
      it.kind = 1;
    }
    // drops flung off on their own
    const drops = style === 'takeoff' ? 3 + Math.floor(r() * 3) : 5 + Math.floor(r() * 5);
    for (let k = 0; k < drops; k++) {
      const it = this.take('drops', 'drops');
      const a = r() * Math.PI * 2;
      const out = (style === 'fan' ? 2.4 : 1.2) * (0.6 + 0.8 * r());
      const up = (style === 'fan' ? 1.6 : style === 'spray' ? 3.6 : 2.6) * (0.5 + 0.7 * r()) * (land ? Math.sqrt(hit) : 0.7);
      _v.set(Q.p.x + Math.cos(a) * 0.04, Q.p.y + 0.03, Q.p.z + Math.sin(a) * 0.04);
      _w.set(Math.cos(a) * out + run.x * carry, up, Math.sin(a) * out + run.z * carry);
      this.toTrack(it, _v, _w, root, z, dist, carry);
      it.size = (land ? 0.034 : 0.026) * (0.6 + 0.8 * r());
      it.life = 0.6;
      it.ground = ground;
      it.kind = 2;
    }
    if (!land) return;
    // the ring, spreading out over the road, and the splat where it landed
    const ring = this.take('flats', 'flats');
    _v.set(Q.p.x, Q.p.y + 0.006, Q.p.z);
    this.toTrack(ring, _v, null, root, z, dist, 0);
    ring.vx = ring.vy = ring.vd = 0;
    ring.size = 0.12;
    ring.grow = (style === 'fan' ? 0.85 : 0.6) * (0.8 + 0.4 * hit);
    ring.life = 0.34 + 0.08 * r();
    ring.kind = 3;
    const pud = this.take('flats', 'flats');
    _v.set(Q.p.x, Q.p.y + 0.004, Q.p.z);
    this.toTrack(pud, _v, null, root, z, dist, 0);
    pud.vx = pud.vy = pud.vd = 0;
    pud.size = (0.12 + 0.05 * r()) * (0.8 + 0.3 * hit);
    pud.grow = 0.25;
    pud.life = 0.3 + 0.1 * r();
    pud.kind = 4;
  }

  // root: the runner's root; z: where they are along the scene's z; dist:
  // how far they've run.
  update(dt, root, z, dist) {
    for (let i = 0; i < this.queued; i++) this.spawn(this.queue[i], root, z, dist);
    this.queued = 0;
    for (let i = 0; i < this.trailed; i++) {
      const T = this.trail[i];
      const it = this.take('drops', 'drops');
      this.toTrack(it, T.p, T.v, root, z, dist, 1);
      it.size = T.size;
      it.life = 0.5;
      it.ground = root.position.y - 0.5;
      it.kind = 2;
    }
    this.trailed = 0;
    let n = 0;
    const put = (v, x, y, zz, tx, ty, tz, qx, qy, qw, kind, a, u, seed, extra) => {
      const i3 = v * 3, i4 = v * 4;
      this.pos[i3] = x;
      this.pos[i3 + 1] = y;
      this.pos[i3 + 2] = zz;
      this.tan[i3] = tx;
      this.tan[i3 + 1] = ty;
      this.tan[i3 + 2] = tz;
      this.q[i4] = qx;
      this.q[i4 + 1] = qy;
      this.q[i4 + 2] = qw;
      this.q[i4 + 3] = kind;
      this.info[i4] = a;
      this.info[i4 + 1] = u;
      this.info[i4 + 2] = seed;
      this.info[i4 + 3] = extra;
    };
    const sz = (d) => z - (d - dist);
    // fingers and jets: a stroke from the root to the head
    for (const it of this.segs) {
      if (!it.live) continue;
      if (dt > 0) {
        it.age += dt;
        it.vy -= G * dt;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.d += it.vd * dt;
        it.bx += it.bvx * dt;
        it.bd += it.bvd * dt;
        const k = Math.exp(-3 * dt);
        it.bvx *= k;
        it.bvd *= k;
        // (its head pinches off into a drop as it tops out)
        if (!it.popped && it.vy < 0.4) {
          it.popped = true;
          const dr = this.take('drops', 'drops');
          dr.x = it.x;
          dr.y = it.y;
          dr.d = it.d;
          dr.vx = it.vx;
          dr.vy = it.vy;
          dr.vd = it.vd;
          dr.size = it.w * (it.kind === 1 ? 1.1 : 0.95);
          dr.life = 0.5;
          dr.ground = it.ground;
          dr.kind = 2;
        }
      }
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 14) {
        it.live = false;
        continue;
      }
      // (once its head's gone it falls back into the root)
      const fall = it.popped ? Math.min(1, (it.age - 0.0) / it.life) : 0;
      const k = it.popped ? Math.max(0.05, 1 - fall * fall * 1.4) : 1;
      const hx = it.bx + (it.x - it.bx) * k;
      const hy = Math.max(it.ground + 0.005, it.by + (it.y - it.by) * k);
      const hz = sz(it.bd + (it.d - it.bd) * k);
      const bz = sz(it.bd);
      let tx = hx - it.bx, ty = hy - it.by, tz = hz - bz;
      const L = Math.hypot(tx, ty, tz) || 1e-4;
      tx /= L;
      ty /= L;
      tz /= L;
      const fade = 1 - u * u;
      const wb = it.w * (1 - 0.45 * u), wh = it.w * (it.kind === 1 ? 0.75 : 0.62) * (1 - 0.5 * u);
      const v0 = n * 4;
      put(v0, it.bx, it.by, bz, tx, ty, tz, -1, 0, wb, 0, fade, 0, it.seed, it.kind);
      put(v0 + 1, it.bx, it.by, bz, tx, ty, tz, 1, 0, wb, 0, fade, 0, it.seed, it.kind);
      put(v0 + 2, hx, hy, hz, tx, ty, tz, -1, 1, wh, 0, fade, 1, it.seed, it.kind);
      put(v0 + 3, hx, hy, hz, tx, ty, tz, 1, 1, wh, 0, fade, 1, it.seed, it.kind);
      n++;
    }
    // drops: round beads
    for (const it of this.drops) {
      if (!it.live) continue;
      if (dt > 0) {
        it.age += dt;
        it.vy -= G * dt;
        const k = Math.exp(-1.0 * dt);
        it.vx *= k;
        it.vd *= k;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.d += it.vd * dt;
      }
      if (it.age >= it.life || (it.y < it.ground && it.vy < 0) || it.d < dist - 14) {
        it.live = false;
        continue;
      }
      // (stretched a little along its way when it's fast)
      const sp = Math.hypot(it.vx, it.vy, it.vd) || 1e-4;
      const st = Math.min(1.8, 1 + sp * 0.08);
      const s = it.size * (1 - 0.3 * (it.age / it.life));
      const v0 = n * 4;
      const tx = it.vx / sp, ty = it.vy / sp, tz = -it.vd / sp;
      const zz = sz(it.d);
      for (let c = 0; c < 4; c++) put(v0 + c, it.x, it.y, zz, tx, ty, tz, c & 1 ? 1 : -1, c & 2 ? 1 : -1, s, 1, 1, st, it.seed, 0);
      n++;
    }
    // rings and puddles: flat on the road
    for (const it of this.flats) {
      if (!it.live) continue;
      if (dt > 0) it.age += dt;
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 14) {
        it.live = false;
        continue;
      }
      const e = 1 - (1 - u) * (1 - u);
      const s = it.kind === 3 ? it.size + it.grow * e : it.size * (1 + it.grow * e);
      const a = it.kind === 3 ? (1 - u) * Math.min(1, u * 10) : (1 - u * u) * Math.min(1, u * 14);
      const v0 = n * 4;
      const zz = sz(it.d);
      for (let c = 0; c < 4; c++) put(v0 + c, it.x, it.y, zz, 0, 0, 0, c & 1 ? 1 : -1, c & 2 ? 1 : -1, s, it.kind === 3 ? 2 : 3, a, u, it.seed, 0);
      n++;
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
    if (n > 0) {
      for (const k of ['position', 'aTan', 'aQ', 'aInfo']) geo.attributes[k].needsUpdate = true;
    }
  }

  clear() {
    this.queued = 0;
    this.trailed = 0;
    for (const a of [this.segs, this.drops, this.flats]) for (const it of a) it.live = false;
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  // drawn once at warm-up so its shader is compiled before the run
  forCompile(on) {
    this.mesh.visible = on;
    this.mesh.geometry.setDrawRange(0, on ? 6 : 0);
  }
}
