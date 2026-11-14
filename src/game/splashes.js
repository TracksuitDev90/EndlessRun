import * as THREE from '../../vendor/three/three.module.min.js';
import { makeSplashMaterial } from '../render/shaders.js';

// Water thrown up from under the fisherman's boots, splashing as water
// does: a boot coming down drives a thin sheet of it out from under the
// sole, which tears at its rim into ligaments, each beading at its tip and
// shedding a run of fine droplets as it stretches; a burst of smaller spray
// goes up with it, the finest of it hanging in the air as mist; and the
// road's left wet, ripples running out over it. Hundreds of small things
// rather than a few big ones, and clear rather than painted: you see it by
// the light it catches and the dark it bends at its edges.
//   - the sheet: the wall of the crown itself - a few broad, thin films of
//     water standing up round where the boot came down, almost clear, a
//     brighter thickened rim along their top - up and gone in a moment,
//     breaking up into droplets along that rim;
//   - ligaments: thin tongues of water from a root on the road to a head
//     flying on its own arc, a bead at the head; they shed droplets off the
//     head as they go, pinch off the bead as it tops out, and what's left
//     falls back into the root;
//   - droplets: beads on their own arcs - the air drags the fine ones back
//     harder than the heavy ones, so the spray sorts itself out, big drops
//     flying on and mist hanging; drawn stretched along their way when
//     they're fast; the heavier ones, where they fall, make a ripple of
//     their own and a couple of tiny drops jump back up;
//   - mist: soft puffs of the finest spray, swelling and thinning;
//   - ripples: rings running out over the wet road, lit on one side;
//   - the wet: an uneven film left where it happened, glinting.
// Take-off is small and quick, kicked back off the soles; a landing is
// bigger, in one of three shapes (dealt so the same one never comes twice
// running): a crown thrown up all round, a fan thrown low and wide to the
// sides, or a spray driven up tall round a jet. Everything's in track
// coordinates (as the dust is), so it's left behind where it happened,
// carried on with a share of the runner's speed (water flung off a running
// boot keeps some of its way) - except what lies on the road, which stays
// put.
//
// All of it is one draw call of camera-facing quads out of fixed pools (no
// garbage, nothing drawn while the air is dry); none of it touches the run.

const FLATS = 20; // ripples and wet
const MISTS = 28;
const SEGS = 80; // sheets, ligaments and jets at once
const DROPS = 300;
const QUADS = FLATS + MISTS + SEGS + DROPS;
const G = 15; // how hard it falls (m/s^2: the game's gravity is strong)
const STYLES = ['crown', 'fan', 'spray'];
const TAU = Math.PI * 2;

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
    const P = () => ({ live: false, x: 0, y: 0, d: 0, vx: 0, vy: 0, vd: 0, bx: 0, by: 0, bd: 0, bvx: 0, bvd: 0, age: 0, life: 1, size: 0.02, w: 0.02, seed: 0, ground: 0, popped: false, kind: 0, grow: 1, shedT: 0, sheds: 0, wait: 0 });
    this.flats = Array.from({ length: FLATS }, P);
    this.mists = Array.from({ length: MISTS }, P);
    this.segs = Array.from({ length: SEGS }, P);
    this.drops = Array.from({ length: DROPS }, P);
    this.next = { flats: 0, mists: 0, segs: 0, drops: 0 };
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

  take(pool) {
    const arr = this[pool];
    const it = arr[this.next[pool]];
    this.next[pool] = (this.next[pool] + 1) % arr.length;
    it.live = true;
    it.age = 0;
    it.popped = false;
    it.sheds = 0;
    it.wait = 0;
    it.seed = Math.random();
    return it;
  }

  // (a point and a velocity from runner space into track coordinates)
  toTrack(it, p, v, root, z, dist) {
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

  // A droplet, already in track coordinates.
  drop(x, y, d, vx, vy, vd, size, ground, life = 0.7) {
    const it = this.take('drops');
    it.x = x;
    it.y = y;
    it.d = d;
    it.vx = vx;
    it.vy = vy;
    it.vd = vd;
    it.size = size;
    it.life = life;
    it.ground = ground;
    it.kind = 0;
    return it;
  }

  // Something lying on the road (track coordinates): a ripple (kind 2) or
  // the wet (kind 3), from size, growing by grow, after wait.
  flat(x, y, d, kind, size, grow, life, wait = 0) {
    const it = this.take('flats');
    it.x = x;
    it.y = y;
    it.d = d;
    it.vx = it.vy = it.vd = 0;
    it.kind = kind;
    it.size = size;
    it.grow = grow;
    it.life = life;
    it.wait = wait;
    return it;
  }

  spawn(Q, root, z, dist) {
    const r = Math.random;
    const land = Q.land;
    const hit = Math.min(1.6, Math.max(0.4, Q.hit));
    const pw = land ? Math.sqrt(hit) : 0.8;
    // (water off a running boot keeps a share of its way; what lies on the
    // road stays where it is)
    const carry = land ? 0.58 : 0.7;
    const run = Q.run;
    const style = land ? Q.style : 'takeoff';
    const ground = root.position.y + Q.p.y;
    const cvx = run.x * carry, cvz = run.z * carry;
    // --- the sheet: the crown's wall, standing up round the sole (a
    // landing only)
    const films = !land ? 0 : style === 'fan' ? 4 : style === 'crown' ? 6 : 4;
    const f0 = r() * TAU;
    for (let k = 0; k < films; k++) {
      const it = this.take('segs');
      let a = f0 + (k / films) * TAU + (r() - 0.5) * 0.5;
      if (style === 'fan') a = (k & 1 ? 0 : Math.PI) + (r() - 0.5) * 1.1;
      const ca = Math.cos(a), sa = Math.sin(a);
      const r0 = 0.05 + 0.02 * r();
      _v.set(Q.p.x + ca * r0 * 0.75, Q.p.y + 0.004, Q.p.z + sa * r0 * 1.15);
      const up = (style === 'spray' ? 2.3 : style === 'fan' ? 1.0 : 1.5) * (0.8 + 0.4 * r()) * pw;
      const out = (style === 'fan' ? 1.9 : style === 'spray' ? 0.5 : 1.0) * (0.8 + 0.4 * r()) * pw;
      this.toTrack(it, _v, null, root, z, dist);
      it.bx = it.x;
      it.by = it.y;
      it.bd = it.d;
      const vv = _w.set(ca * out + cvx, up, sa * out + cvz).applyQuaternion(root.quaternion);
      it.vx = vv.x;
      it.vy = vv.y;
      it.vd = -vv.z;
      const rv = _v.set(ca * out * 0.45 + cvx, 0, sa * out * 0.45 + cvz).applyQuaternion(root.quaternion);
      it.bvx = rv.x;
      it.bvd = -rv.z;
      it.w = (0.05 + 0.03 * r()) * (0.8 + 0.25 * hit);
      it.life = 0.2 + 0.08 * r();
      it.ground = ground;
      it.kind = 2;
      it.shedT = 0.06 + 0.04 * r();
    }
    // --- torn into ligaments: thrown out from round the sole (a little
    // ellipse, longer along the run - a boot's print), more of it out to
    // the sides and ahead than back under the heel
    const ligs = style === 'takeoff' ? 4 + Math.floor(r() * 3) : style === 'fan' ? 8 + Math.floor(r() * 4) : style === 'crown' ? 9 + Math.floor(r() * 4) : 6 + Math.floor(r() * 3);
    const a0 = r() * TAU;
    for (let k = 0; k < ligs; k++) {
      const it = this.take('segs');
      let a = a0 + (k / ligs) * TAU + (r() - 0.5) * 0.45;
      // (the fan: only out to the two sides)
      if (style === 'fan') a = (k & 1 ? 0 : Math.PI) + (r() - 0.5) * 1.5;
      const ca = Math.cos(a), sa = Math.sin(a);
      const r0 = (land ? 0.045 : 0.03) + 0.02 * r();
      _v.set(Q.p.x + ca * r0 * 0.75, Q.p.y + 0.004, Q.p.z + sa * r0 * 1.15);
      // how it's thrown: up and out, no two alike
      let up, out;
      if (style === 'fan') (up = 0.9 + 1.3 * r()), (out = 2.2 + 1.8 * r());
      else if (style === 'spray') (up = 2.6 + 2.0 * r()), (out = 0.5 + 0.8 * r());
      else if (style === 'crown') (up = 1.7 + 1.9 * r() * r()), (out = 1.2 + 1.1 * r());
      else (up = 0.9 + 1.0 * r()), (out = 0.5 + 0.7 * r());
      // (take-off: kicked back off the soles)
      const back = style === 'takeoff' ? 1.2 + 0.8 * r() : 0;
      const dir = 0.8 + 0.3 * Math.abs(ca) + (land ? 0.15 * Math.max(0, -sa) : 0);
      const s = pw * dir * (k % 3 === 1 ? 0.7 : 1);
      this.toTrack(it, _v, null, root, z, dist);
      it.bx = it.x;
      it.by = it.y;
      it.bd = it.d;
      const vv = _w.set(ca * out * s + cvx, up * s, sa * out * s + cvz + back).applyQuaternion(root.quaternion);
      it.vx = vv.x;
      it.vy = vv.y;
      it.vd = -vv.z;
      // (the root creeps outward with it, slower, and on with the run)
      const rv = _v.set(ca * out * 0.3 + cvx, 0, sa * out * 0.3 + cvz).applyQuaternion(root.quaternion);
      it.bvx = rv.x;
      it.bvd = -rv.z;
      it.w = (land ? 0.016 : 0.012) * (0.55 + 0.9 * r() * r());
      it.life = (land ? 0.34 : 0.22) + 0.14 * r();
      it.ground = ground;
      it.kind = 0;
      it.shedT = 0.05 + 0.06 * r();
    }
    // --- the jet: a column straight up out of the middle (the spray always;
    // a crown now and then; a take-off never)
    if (style === 'spray' || (style === 'crown' && r() < 0.4)) {
      const it = this.take('segs');
      _v.set(Q.p.x, Q.p.y + 0.004, Q.p.z);
      this.toTrack(it, _v, null, root, z, dist);
      it.bx = it.x;
      it.by = it.y;
      it.bd = it.d;
      const vv = _w.set(cvx + (r() - 0.5) * 0.3, (style === 'spray' ? 4.4 : 3.4) * pw, cvz).applyQuaternion(root.quaternion);
      it.vx = vv.x;
      it.vy = vv.y;
      it.vd = -vv.z;
      const rv = _v.set(cvx, 0, cvz).applyQuaternion(root.quaternion);
      it.bvx = rv.x;
      it.bvd = -rv.z;
      it.w = 0.026 * (0.85 + 0.3 * r());
      it.life = 0.44 + 0.1 * r();
      it.ground = ground;
      it.kind = 1;
      it.shedT = 0.07;
    }
    // --- spray: a burst of droplets on their own, most of them fine, a few
    // heavy
    const n = Math.round((style === 'takeoff' ? 12 : style === 'spray' ? 44 : 36) * (0.75 + 0.5 * r()) * (land ? 0.7 + 0.3 * hit : 1));
    for (let k = 0; k < n; k++) {
      const a = r() * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      // (a cone: steep ones go high, shallow ones go far)
      const el = style === 'fan' ? 0.25 + 0.6 * r() : style === 'spray' ? 0.9 + 0.55 * r() : 0.5 + 0.8 * r();
      const sp = (style === 'takeoff' ? 1.6 + 1.6 * r() : 2.0 + 3.6 * r() * r() + 1.2 * r()) * pw;
      const out = Math.cos(el) * sp * (style === 'fan' ? 1.5 * Math.abs(ca) + 0.3 : 1);
      const up = Math.sin(el) * sp;
      const heavy = r() < 0.14;
      const size = heavy ? 0.011 + 0.008 * r() : 0.0035 + 0.006 * r() * r();
      const r0 = 0.05 * Math.sqrt(r());
      _v.set(Q.p.x + ca * r0, Q.p.y + 0.02 + 0.03 * r(), Q.p.z + sa * r0 * 1.3);
      _w.set(ca * out + cvx, up, sa * out + cvz + (style === 'takeoff' ? 1.4 * r() : 0));
      const it = this.take('drops');
      this.toTrack(it, _v, _w, root, z, dist);
      it.size = size;
      it.life = 0.45 + 0.4 * r();
      it.ground = ground;
      it.kind = 0;
    }
    // --- mist: the finest of it, hanging
    const puffs = style === 'takeoff' ? 1 : 3 + Math.floor(r() * 2);
    for (let k = 0; k < puffs; k++) {
      const it = this.take('mists');
      const a = r() * TAU;
      _v.set(Q.p.x + Math.cos(a) * 0.05, Q.p.y + 0.05 + 0.08 * r(), Q.p.z + Math.sin(a) * 0.07);
      _w.set(Math.cos(a) * 0.5 + cvx * 0.9, (0.7 + 1.1 * r()) * pw, Math.sin(a) * 0.5 + cvz * 0.9);
      this.toTrack(it, _v, _w, root, z, dist);
      it.size = (land ? 0.07 : 0.045) * (0.8 + 0.5 * r());
      it.grow = (land ? 0.34 : 0.2) * (0.8 + 0.4 * r()) * pw;
      it.life = 0.34 + 0.2 * r();
      it.ground = ground;
      it.kind = 4;
    }
    // --- on the road: ripples running out (two, one after the other), the
    // wet left where it came down
    _v.set(Q.p.x, Q.p.y + 0.006, Q.p.z);
    const w = _tp.copy(_v).applyQuaternion(root.quaternion).add(root.position);
    const fd = dist - (w.z - z);
    if (!land) {
      this.flat(w.x, w.y, fd, 2, 0.05, 0.22, 0.26);
      return;
    }
    const reach = (style === 'fan' ? 0.75 : 0.55) * (0.7 + 0.35 * hit);
    this.flat(w.x, w.y, fd, 2, 0.07, reach, 0.4 + 0.08 * r());
    this.flat(w.x, w.y, fd, 2, 0.05, reach * 0.6, 0.36 + 0.08 * r(), 0.07);
    this.flat(w.x, w.y - 0.002, fd, 3, (0.15 + 0.06 * r()) * (0.8 + 0.3 * hit), 0.35, 0.5 + 0.15 * r());
  }

  // root: the runner's root; z: where they are along the scene's z; dist:
  // how far they've run.
  update(dt, root, z, dist) {
    for (let i = 0; i < this.queued; i++) this.spawn(this.queue[i], root, z, dist);
    this.queued = 0;
    for (let i = 0; i < this.trailed; i++) {
      const T = this.trail[i];
      const it = this.take('drops');
      this.toTrack(it, T.p, T.v, root, z, dist);
      it.size = T.size;
      it.life = 0.5;
      it.ground = root.position.y - 0.5;
      it.kind = 0;
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
    const r = Math.random;
    // --- ripples and the wet: flat on the road (drawn first: under the rest)
    for (const it of this.flats) {
      if (!it.live) continue;
      if (dt > 0) {
        if (it.wait > 0) it.wait -= dt;
        else it.age += dt;
      }
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 14) {
        it.live = false;
        continue;
      }
      if (it.wait > 0) continue;
      // (running out fast and slowing)
      const e = 1 - (1 - u) * (1 - u);
      const ring = it.kind === 2;
      const s = ring ? it.size + it.grow * e : it.size * (1 + it.grow * e);
      const a = ring ? (1 - u) * (1 - u) * Math.min(1, u * 12) : (1 - u * u) * Math.min(1, u * 16);
      const v0 = n * 4;
      const zz = sz(it.d);
      for (let c = 0; c < 4; c++) put(v0 + c, it.x, it.y, zz, 0, 0, 0, c & 1 ? 1 : -1, c & 2 ? 1 : -1, s, it.kind, a, u, it.seed, 0);
      n++;
    }
    // --- mist: soft puffs, swelling and thinning, slowed by the air
    for (const it of this.mists) {
      if (!it.live) continue;
      if (dt > 0) {
        it.age += dt;
        it.vy -= G * 0.25 * dt;
        const k = Math.exp(-3.2 * dt);
        it.vx *= k;
        it.vy *= k;
        it.vd *= k;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.d += it.vd * dt;
      }
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 14) {
        it.live = false;
        continue;
      }
      const s = it.size + it.grow * (1 - (1 - u) * (1 - u));
      const a = (1 - u) * Math.min(1, u * 9);
      const v0 = n * 4;
      const zz = sz(it.d);
      const y = Math.max(it.ground + s * 0.45, it.y);
      for (let c = 0; c < 4; c++) put(v0 + c, it.x, y, zz, 0, 1, 0, c & 1 ? 1 : -1, c & 2 ? 1 : -1, s, 4, a, u, it.seed, 0);
      n++;
    }
    // --- ligaments and jets: a stroke from the root to the head
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
        // (stretching, it sheds a droplet off its head every so often...)
        if (!it.popped && it.age > it.shedT && it.sheds < 4) {
          it.sheds++;
          it.shedT = it.age + 0.035 + 0.05 * r();
          const j = 0.82 + 0.3 * r();
          // (a sheet breaks up all along its rim, into finer drops)
          const film = it.kind === 2;
          const sx = film ? (r() - 0.5) * it.w * 1.6 : 0;
          this.drop(it.x + sx, it.y, it.d + sx, it.vx * j + (r() - 0.5) * 0.5, it.vy * j + 0.4 * r(), it.vd * j + (r() - 0.5) * 0.5, film ? 0.004 + 0.005 * r() : it.w * (0.22 + 0.2 * r()), it.ground, 0.55);
        }
        // (...and its bead pinches off as it tops out, a smaller one after it)
        if (!it.popped && it.vy < 0.5 && it.kind === 2) it.popped = true;
        if (!it.popped && it.vy < 0.5) {
          it.popped = true;
          this.drop(it.x, it.y, it.d, it.vx, it.vy, it.vd, it.w * (it.kind === 1 ? 0.62 : 0.56), it.ground, 0.6);
          this.drop(it.x - it.vx * 0.012, it.y - 0.02, it.d - it.vd * 0.012, it.vx * 0.9, it.vy - 0.3, it.vd * 0.9, it.w * 0.3, it.ground, 0.5);
        }
      }
      const u = it.age / it.life;
      if (u >= 1 || it.d < dist - 14) {
        it.live = false;
        continue;
      }
      // (once its head's gone it falls back into the root)
      const fall = it.popped ? Math.min(1, it.age / it.life) : 0;
      const k = it.popped ? Math.max(0.05, 1 - fall * fall * 1.4) : 1;
      let hx = it.bx + (it.x - it.bx) * k;
      let hy = Math.max(it.ground + 0.005, it.by + (it.y - it.by) * k);
      let hz = sz(it.bd + (it.d - it.bd) * k);
      const bz = sz(it.bd);
      let tx = hx - it.bx, ty = hy - it.by, tz = hz - bz;
      const L = Math.hypot(tx, ty, tz) || 1e-4;
      tx /= L;
      ty /= L;
      tz /= L;
      // (it thins as it stretches: the same water, drawn out longer)
      const thin = 1 / (1 + L * 2.2);
      const fade = (1 - u * u) * Math.min(1, it.age * 40);
      const wd = it.kind === 2 ? it.w * (1 + 0.5 * u) : it.w * (0.55 + 0.9 * thin) * (1 - 0.4 * u);
      const v0 = n * 4;
      const ex = it.kind === 2 ? 4 : it.popped ? 2 + it.kind : it.kind;
      // (the head's a bead the stroke's own width across: a little past it)
      const ex2 = it.kind === 2 ? 0 : wd;
      hx += tx * ex2;
      hy += ty * ex2;
      hz += tz * ex2;
      const asp = (L + ex2) / wd;
      put(v0, it.bx, it.by, bz, tx, ty, tz, -1, 0, wd, 0, fade, asp, it.seed, ex);
      put(v0 + 1, it.bx, it.by, bz, tx, ty, tz, 1, 0, wd, 0, fade, asp, it.seed, ex);
      put(v0 + 2, hx, hy, hz, tx, ty, tz, -1, 1, wd, 0, fade, asp, it.seed, ex);
      put(v0 + 3, hx, hy, hz, tx, ty, tz, 1, 1, wd, 0, fade, asp, it.seed, ex);
      n++;
    }
    // --- droplets
    for (const it of this.drops) {
      if (!it.live) continue;
      if (dt > 0) {
        it.age += dt;
        it.vy -= G * dt;
        // (the air drags the fine ones harder)
        const k = Math.exp(-(0.5 + 0.0075 / it.size) * dt);
        it.vx *= k;
        it.vy *= k;
        it.vd *= k;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.d += it.vd * dt;
      }
      if (it.y < it.ground && it.vy < 0) {
        // (a heavy one, where it falls: a ripple of its own, and a couple
        // of tiny drops jumping back up)
        if (it.size > 0.0085 && it.kind === 0 && it.d > dist - 10) {
          this.flat(it.x, it.ground + 0.006, it.d, 2, 0.015, 0.1 + 6 * it.size, 0.24);
          for (let b = 0; b < 2; b++) {
            const c = this.drop(it.x, it.ground + 0.01, it.d, it.vx * 0.35 + (r() - 0.5) * 0.9, -it.vy * (0.16 + 0.16 * r()), it.vd * 0.35 + (r() - 0.5) * 0.9, it.size * 0.36, it.ground, 0.3);
            c.kind = 1;
          }
        }
        it.live = false;
        continue;
      }
      if (it.age >= it.life || it.d < dist - 14) {
        it.live = false;
        continue;
      }
      // (stretched along its way when it's fast: the eye's own blur)
      const sp = Math.hypot(it.vx, it.vy, it.vd) || 1e-4;
      const st = Math.min(3.2, 1 + sp * 0.006 / it.size);
      const u = it.age / it.life;
      const a = Math.min(1, (1 - u) * 3.5);
      const v0 = n * 4;
      const tx = it.vx / sp, ty = it.vy / sp, tz = -it.vd / sp;
      const zz = sz(it.d);
      for (let c = 0; c < 4; c++) put(v0 + c, it.x, it.y, zz, tx, ty, tz, c & 1 ? 1 : -1, c & 2 ? 1 : -1, it.size, 1, a, st, it.seed, 0);
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
    for (const a of [this.flats, this.mists, this.segs, this.drops]) for (const it of a) it.live = false;
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  // drawn once at warm-up so its shader is compiled before the run
  forCompile(on) {
    this.mesh.visible = on;
    this.mesh.geometry.setDrawRange(0, on ? 6 : 0);
  }
}
