import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials, makeEnvUniforms, makePlumeMaterial, makeArcMaterial } from '../render/shaders.js';
import { palette, bodyGeometry } from './kit.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { CastShadow } from '../render/caster.js';
import { Dust } from './dust.js';

// Teasel, the storm thistle who runs with you: the body and how it moves.
// A living seedpod about the size of a grapefruit - a deep plum husk of
// overlapping papery leaves, two small amber eyes peeking out from under the
// hood, three root legs - sculpted offline (tools/runner/thistle.py) and
// drawn with the runners' illustrated shader (THISTLE in CHAR_DETAIL); and
// on top of it its crown, which is not sculpted: a few curved strips laid
// along simulated spines, each drawn from one shared feather texture (made
// here, once: makeFeatherAtlas) so the fine branching - a slender stem
// dividing into finer and finer silver filaments, open between them - costs
// nothing but a few dozen triangles.
//
// Nothing here decides where it goes - that's its mind (scurrier.js, built on
// the runners' companion.js), which hands it a place in the world, how fast
// it's moving, what it's doing, how much static it holds (charge, 0..1),
// whether it's gliding (glide, 0..1), and when it travels through a spark
// (zap). This module turns that into:
//   - the scurry: three legs, two in front and one behind. The front roots
//     reach and plant in turn, then the rear root plants and pushes the pod
//     forward; the pod's weight rolls toward whichever feet are down (a
//     loose spring: it sways on after each shift), bobs down onto each plant
//     and lunges on each push. Each foot is placed (a two-bone reach to it,
//     the knee bowed out), held while it carries the pod, lifted and swung
//     through. In the air the legs dangle and paddle, splayed wide when it
//     glides; braced wide when it lands hard or arrives through a spark;
//   - the crown: each plume a chain of points pulled toward its rest shape -
//     stiff at its root, looser toward its tip - and pushed about by the
//     body's own lurches, the air going past and a flutter, so the roots go
//     with the body while the fine tips lag, flutter and settle; the long
//     ones drag on the road;
//   - the static: as it charges, its plumes lift one by one from swept back
//     (the longest wisps brushing the ground) to fanned out wide; their
//     hairs part (the strips widen, so the barbs stand out from the stem and
//     the finest come apart); charged plumes push each other apart; and only
//     near full do tiny violet sparks start snapping across the gaps between
//     them, glinting off their tips and crawling along its leaves' edges;
//   - travelling through a spark (at full charge, to catch up): a short
//     crooked bolt from its feet to where it's going, flickering into being;
//     its body gone in a flash at one end as a bright pulse races along the
//     bolt, there again at the other in a flash of violet light, its roots
//     braced; the bolt fading; and a beat later the crown falls loose and
//     begins building again.

export const COL = {
  1: '#6a2350', // the husk: deep plum
  2: '#7c2b5d', // the hood
  3: '#2a0c22', // the core, in the hood's shade
  4: '#e5800f', // the eyes: amber
  5: '#d49d88', // the root legs
  6: '#8f3e68', // the tuft
  13: '#46102f', // plum, deepest
  14: '#d7a0a9', // the veins
  15: '#f2c6a8', // the edges: dried peach
  16: '#9a3f74', // magenta
  17: '#2b0e05', // the pupils
  18: '#ffd57c', // the eyes' hearts
  19: '#9c6655', // bark, dark
  20: '#f1cbb6', // bark, light
  21: '#b38bff', // static: violet
  22: '#c88d84', // the edges, drier
  30: '#b8729a', // sheen: a dry, lighter plum
};

// Sculpted the size of a grapefruit and drawn larger than life (as Nep is):
// big enough to see its feet step from the camera behind the runner.
export const SCALE = 1.9;

// Travelling through a spark (s): the bolt flickers into being, the pulse
// races along it, the bolt fades; the crown falls loose this long after it
// arrives.
export const ZAP = { lock: 0.09, travel: 0.15, fade: 0.3, loose: 0.3 };

const K = 9; // points along each plume's spine
const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _M = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);
const _kt = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _kn = new THREE.Vector3();
const _ka = new THREE.Vector3();

// A spring with a force on it (a damped oscillator, semi-implicit).
class Sway {
  constructor() {
    this.x = 0;
    this.v = 0;
  }
  step(target, freq, zeta, f, dt) {
    const w = TAU * freq;
    const n = Math.min(6, Math.max(1, Math.ceil(dt * 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v = (this.v + h * (w * w * (target - this.x) + f)) / (1 + 2 * zeta * w * h + w * w * h * h);
      this.x += this.v * h;
    }
    return this.x;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
  }
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the feather atlas -------------------------------------------------------------
// One texture for every plume: four columns, each a feather standing up its
// middle (v 0 its root, 1 its tip): three plumes, a bare stem at the root
// dividing into barbs that sweep toward the tip and divide again into finer
// filaments, with open space between them; and one stray wisp. Red: the stem
// and the barbs; green: the finer filaments; blue: the hairs' tips.
const ATLAS = 512;
let atlas = null;
export function makeFeatherAtlas() {
  if (atlas) return atlas;
  const W = ATLAS, H = ATLAS, CW = W / 4;
  const layers = [0, 1, 2].map(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineCap = 'round';
    return g;
  });
  const [R, G, Bc] = layers;
  const r = rng(7);
  const inCol = (x, col) => clamp(x, col * CW + 5, col * CW + CW - 5);
  for (let col = 0; col < 3; col++) {
    const X0 = col * CW + CW / 2;
    const bow = (r() - 0.5) * 6;
    const stemX = (y) => X0 + bow * Math.sin((Math.PI * y) / H);
    // the stem
    for (let y = 0; y < H - 6; y += 4) {
      R.globalAlpha = 1;
      R.lineWidth = lerp(3.6, 0.9, y / H);
      R.beginPath();
      R.moveTo(stemX(y), y);
      R.lineTo(stemX(y + 4), y + 4);
      R.stroke();
    }
    for (const side of [-1, 1]) {
      let y = H * (0.09 + 0.03 * r());
      while (y < H * 0.975) {
        const v = y / H;
        const prof = Math.pow(Math.sin(Math.PI * clamp((v - 0.06) / 0.98, 0, 1)), 0.6) * (0.72 + 0.28 * r());
        const len = (CW / 2 - 7) * prof * (1.05 + 0.35 * v);
        const ang = lerp(1.0, 0.42, v) + (r() - 0.5) * 0.25; // off the stem, toward the tip
        const sx = stemX(y);
        const ex = inCol(sx + side * Math.sin(ang) * len, col);
        const ey = Math.min(H - 3, y + Math.cos(ang) * len * 0.95 + len * 0.18);
        const cx = sx + side * Math.sin(ang) * len * 0.62;
        const cy = y + Math.cos(ang) * len * 0.3;
        // the barb, curving up toward the tip
        R.globalAlpha = 0.95;
        R.lineWidth = lerp(1.5, 0.9, v);
        R.beginPath();
        R.moveTo(sx, y);
        R.quadraticCurveTo(cx, cy, ex, ey);
        R.stroke();
        // filaments off it, and finer hairs off them
        const n = 3 + Math.floor(len / 9);
        for (let i = 1; i <= n; i++) {
          const t = (i / (n + 1)) * (0.92 + 0.08 * r());
          const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex;
          const py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cy + t * t * ey;
          const tx = 2 * (1 - t) * (cx - sx) + 2 * t * (ex - cx);
          const ty = 2 * (1 - t) * (cy - y) + 2 * t * (ey - cy);
          const tl = Math.hypot(tx, ty) || 1;
          for (const out of [1, -1]) {
            if (out < 0 && r() < 0.55) continue;
            const a = Math.atan2(ty, tx) + out * side * (0.35 + 0.3 * r()) * -1;
            const fl = len * (0.22 + 0.22 * r()) * (1 - t * 0.45);
            const fx = inCol(px + Math.cos(a) * fl, col);
            const fy = Math.min(H - 2, py + Math.sin(a) * fl + fl * 0.15);
            G.globalAlpha = 0.85;
            G.lineWidth = 0.8;
            G.beginPath();
            G.moveTo(px, py);
            G.quadraticCurveTo(px + (tx / tl) * fl * 0.4, py + (ty / tl) * fl * 0.4, fx, fy);
            G.stroke();
            // (and a finer hair off that)
            if (r() < 0.6) {
              const mx = (px + fx) / 2, my = (py + fy) / 2;
              const b2 = a + side * (r() - 0.3) * 0.9;
              const hl = fl * (0.35 + 0.3 * r());
              const hx = inCol(mx + Math.cos(b2) * hl, col), hy = Math.min(H - 2, my + Math.sin(b2) * hl + hl * 0.2);
              G.globalAlpha = 0.6;
              G.lineWidth = 0.55;
              G.beginPath();
              G.moveTo(mx, my);
              G.lineTo(hx, hy);
              G.stroke();
              Bc.globalAlpha = 0.6;
              Bc.beginPath();
              Bc.arc(hx, hy, 1.1, 0, TAU);
              Bc.fill();
            }
            Bc.globalAlpha = 0.85;
            Bc.beginPath();
            Bc.arc(fx, fy, 1.4, 0, TAU);
            Bc.fill();
          }
        }
        Bc.globalAlpha = 1;
        Bc.beginPath();
        Bc.arc(ex, ey, 1.8, 0, TAU);
        Bc.fill();
        y += 4.5 + r() * 4.5 + (v < 0.2 ? 3 : 0);
      }
    }
  }
  // the wisp: one long wavering hair, a few finer ones off it
  {
    const col = 3, X0 = col * CW + CW / 2;
    const wx = (y) => X0 + 7 * Math.sin(y * 0.018) + 3 * Math.sin(y * 0.047 + 1);
    for (let y = 0; y < H - 6; y += 4) {
      R.globalAlpha = 1;
      R.lineWidth = lerp(2.2, 0.8, y / H);
      R.beginPath();
      R.moveTo(wx(y), y);
      R.lineTo(wx(y + 4), y + 4);
      R.stroke();
    }
    for (let y = H * 0.25; y < H * 0.97; y += 10 + r() * 16) {
      const side = r() < 0.5 ? -1 : 1;
      const a = Math.PI / 2 - side * (0.6 + 0.5 * r());
      const l = 14 + r() * 26;
      const fx = inCol(wx(y) + Math.cos(a) * l * side * side * (side), col), fy = Math.min(H - 2, y + Math.abs(Math.sin(a)) * l);
      G.globalAlpha = 0.8;
      G.lineWidth = 0.7;
      G.beginPath();
      G.moveTo(wx(y), y);
      G.quadraticCurveTo(wx(y) + side * l * 0.3, y + l * 0.2, fx, fy);
      G.stroke();
      Bc.globalAlpha = 0.9;
      Bc.beginPath();
      Bc.arc(fx, fy, 1.4, 0, TAU);
      Bc.fill();
    }
    Bc.beginPath();
    Bc.arc(wx(H - 8), H - 8, 2, 0, TAU);
    Bc.fill();
  }
  const data = new Uint8Array(W * H * 4);
  const px = layers.map((g) => g.getImageData(0, 0, W, H).data);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = px[0][i * 4];
    data[i * 4 + 1] = px[1][i * 4];
    data[i * 4 + 2] = px[2][i * 4];
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  atlas = tex;
  return tex;
}

// --- the crown ----------------------------------------------------------------------
// The plumes: their shapes swept back (low) and fanned out (high), how long
// and wide, the charge each lifts at, and which feather they're drawn from.
// Round: 0 its front, + toward its right (deg); up: deg above level; droop:
// how fast the spine bends down (rad/m, - curls up).
function plumeDefs() {
  const r = rng(31);
  const defs = [];
  // twelve plumes, six to a side, fanned across behind and round it
  const fan = [30, 55, 78, 102, 126, 152];
  for (let i = 0; i < 12; i++) {
    const s = i < 6 ? 1 : -1;
    const k = i % 6;
    const az = s * (fan[k] + (r() - 0.5) * 12);
    const sideways = Math.sin(Math.abs(az) * (Math.PI / 180));
    defs.push({
      az: [180 + s * (8 + 9 * k + r() * 6), az],
      up: [lerp(30, 44, r()), lerp(74, 22, sideways ** 1.6) + (r() - 0.5) * 12],
      droop: [lerp(5.3, 6.6, r()), lerp(0.9, 2.2, r())],
      curl: lerp(2.0, 3.6, r()),
      twist: (r() - 0.5) * 1.2,
      len: lerp(0.36, 0.56, r()) * (k === 2 || k === 3 ? 1.08 : 1),
      w: lerp(0.048, 0.066, r()),
      th: 0.04 + 0.5 * r(),
      col: Math.floor(r() * 3),
      seed: r(),
      wisp: false,
    });
  }
  // and a few stray wisps, longer and finer, breaking the outline
  for (let i = 0; i < 5; i++) {
    const s = i % 2 ? 1 : -1;
    const az = s * lerp(20, 165, r());
    defs.push({
      az: [180 + s * lerp(4, 40, r()), az],
      up: [lerp(32, 44, r()), lerp(20, 70, r())],
      droop: [lerp(5.2, 6.4, r()), lerp(1.0, 2.6, r())],
      curl: lerp(1.0, 3.0, r()),
      twist: (r() - 0.5) * 2.4,
      len: lerp(0.5, 0.64, r()),
      w: lerp(0.012, 0.018, r()),
      th: 0.25 + 0.45 * r(),
      col: 3,
      seed: r(),
      wisp: true,
    });
  }
  return defs;
}

class Crown {
  constructor(u) {
    this.defs = plumeDefs();
    const P = this.defs.length;
    this.P = P;
    this.pos = new Float32Array(P * K * 3);
    this.vel = new Float32Array(P * K * 3);
    this.tgt = new Float32Array(P * K * 3);
    this.lift = new Float32Array(P);
    this.sep = new Float32Array(P);
    this.glow = new Float32Array(P);
    const n = P * K * 2;
    const geo = new THREE.BufferGeometry();
    this.aPos = new Float32Array(n * 3);
    this.aTan = new Float32Array(n * 3);
    this.aFix = new Float32Array(n * 3);
    this.aPl = new Float32Array(n * 4);
    this.aSt = new Float32Array(n * 4);
    const dyn = (arr, k) => new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.aPos, 3));
    geo.setAttribute('aTan', dyn(this.aTan, 3));
    geo.setAttribute('aFix', dyn(this.aFix, 3));
    geo.setAttribute('aPl', dyn(this.aPl, 4));
    geo.setAttribute('aSt', dyn(this.aSt, 4));
    const idx = [];
    for (let i = 0; i < P; i++) {
      for (let k = 0; k < K - 1; k++) {
        const a = (i * K + k) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mat = makePlumeMaterial(u, makeFeatherAtlas());
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    // (after the world's own see-through things - a puddle's sheen on the
    // road behind it - since it writes no depth)
    this.mesh.renderOrder = 10;
    this.mesh.name = 'thistleCrown';
    this.ready = false;
    this.loose = 0;
    // the sparks snapping between the plumes: [plume a, point, plume b,
    // point, life left, jitter seed]
    this.crackles = [];
    this.crackleAcc = 0;
  }

  reset() {
    this.ready = false;
    this.loose = 0;
    this.crackles.length = 0;
  }

  // The spines' rest shapes, in the root's own (sculpted) space: up out of
  // the crown at its socket (crown, rotated with the pod by podQ), bending as
  // each plume's lift says. ground: the road's height in that space.
  targets(t, crown, podQ, charge, glide, speed, ground, sit) {
    const D = this.defs;
    const fan = smooth(0.25, 0.95, charge);
    for (let i = 0; i < this.P; i++) {
      const d = D[i];
      // each lifts in its own time as the charge builds, and its hairs part
      // a little after
      const l = smooth(d.th, d.th + 0.3, charge);
      const sp = smooth(d.th + 0.12, d.th + 0.45, charge);
      this.lift[i] = l;
      this.sep[i] = Math.max(sp, 0.25 * glide);
      const k = l * 0.65 + fan * 0.35;
      let az = lerp(d.az[0], d.az[1], k) * (Math.PI / 180);
      let up = lerp(d.up[0], d.up[1], k) * (Math.PI / 180);
      let droop = lerp(d.droop[0], d.droop[1], l);
      // (sitting, they rest a little lower and closer; gliding, they're
      // held up and out like a parachute)
      up += glide * 0.35 - sit * 0.15;
      droop *= 1 - 0.65 * glide;
      const curl = d.curl * l;
      const h = _v.set(Math.sin(az), 0, -Math.cos(az));
      const dir = _v2.copy(h).multiplyScalar(Math.cos(up)).addScaledVector(_UP, Math.sin(up)).applyQuaternion(podQ);
      const seg = d.len / (K - 1);
      const o = i * K * 3;
      // (each from its own spot in the socket)
      let x = crown.x + h.x * 0.008, y = crown.y, z = crown.z + h.z * 0.008;
      const T = this.tgt;
      for (let j = 0; j < K; j++) {
        // a flutter on the target, growing toward the tip and with the pace
        // (charged, it stiffens to a fine quiver)
        const f = j / (K - 1);
        const fa = f ** 1.5 * ((0.008 + 0.0011 * Math.min(speed, 22)) * (1 - 0.55 * l) + 0.003 * (d.wisp ? 1 : 0));
        const ph = d.seed * 40 + j * 0.7;
        T[o + j * 3] = x + fa * Math.sin(t * (4.1 + 2 * d.seed) + ph);
        T[o + j * 3 + 1] = Math.max(ground + 0.004, y + fa * Math.sin(t * (5.3 + 1.5 * d.seed) + ph * 1.3));
        T[o + j * 3 + 2] = z + fa * Math.sin(t * (3.3 + 2.4 * d.seed) + ph * 0.7);
        x += dir.x * seg;
        y += dir.y * seg;
        z += dir.z * seg;
        // bend: down (droop) along the plume, curling back up toward its
        // tip as it lifts, and a little round to one side
        const bend = (droop - curl * smooth(0.45, 1, f)) * seg;
        _v3.crossVectors(dir, _UP);
        if (_v3.lengthSq() < 0.04) _v3.crossVectors(h, _UP);
        _v3.normalize();
        dir.applyAxisAngle(_v3, -bend);
        dir.applyAxisAngle(_UP, d.twist * seg);
      }
    }
  }

  // One step of the plumes: each point pulled to its target, stiff at the
  // root and looser toward the tip, thrown by the body's own acceleration
  // (acc, its space), swept by the air going past (air: its velocity
  // relative to the body), charged plumes pushing each other apart; held to
  // their lengths, the root pinned, nothing through the road.
  step(dt, acc, air, charge, ground) {
    const P = this.P, D = this.defs;
    const p = this.pos, v = this.vel, T = this.tgt;
    if (!this.ready) {
      p.set(T);
      v.fill(0);
      this.ready = true;
    }
    const n = Math.min(8, Math.max(1, Math.ceil(dt * 150)));
    const h = dt / n;
    const loose = this.loose;
    const q2 = charge * charge;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < P; i++) {
        const d = D[i];
        const l = this.lift[i];
        const o = i * K * 3;
        // (the root goes wherever the body puts it)
        p[o] = T[o];
        p[o + 1] = T[o + 1];
        p[o + 2] = T[o + 2];
        v[o] = v[o + 1] = v[o + 2] = 0;
        const wind = (1 - 0.6 * l) * (d.wisp ? 1.6 : 1);
        for (let j = 1; j < K; j++) {
          const f = j / (K - 1);
          let w = TAU * lerp(8.5, 1.7, f ** 0.7) * (1 + 0.9 * l) * (d.wisp ? 0.75 : 1) * (1 - 0.55 * loose);
          const zeta = 0.3 + 0.15 * l;
          const inert = 0.25 + 0.75 * f ** 0.8;
          const a = o + j * 3;
          for (let c = 0; c < 3; c++) {
            const F = -acc[c] * inert + air[c] * wind * 1.1 * f + (c === 1 ? -9.8 * 0.35 * loose * f : 0);
            v[a + c] = (v[a + c] + h * (w * w * (T[a + c] - p[a + c]) + F)) / (1 + 2 * zeta * w * h + w * w * h * h);
          }
        }
      }
      // charged plumes push each other apart (mid-plume and at the tips)
      if (q2 > 0.02) {
        for (const j of [Math.round((K - 1) * 0.6), K - 1]) {
          for (let a = 0; a < P; a++) {
            const ia = (a * K + j) * 3;
            for (let b = a + 1; b < P; b++) {
              const ib = (b * K + j) * 3;
              const dx = p[ia] - p[ib], dy = p[ia + 1] - p[ib + 1], dz = p[ia + 2] - p[ib + 2];
              const r2 = dx * dx + dy * dy + dz * dz + 0.0004;
              if (r2 > 0.04) continue;
              const k = Math.min(60, (0.12 * q2 * this.lift[a] * this.lift[b]) / r2) / Math.sqrt(r2);
              v[ia] += dx * k * h;
              v[ia + 1] += dy * k * h;
              v[ia + 2] += dz * k * h;
              v[ib] -= dx * k * h;
              v[ib + 1] -= dy * k * h;
              v[ib + 2] -= dz * k * h;
            }
          }
        }
      }
      for (let i = 0; i < P; i++) {
        const seg = D[i].len / (K - 1);
        const o = i * K * 3;
        for (let j = 1; j < K; j++) {
          const a = o + j * 3, b = a - 3;
          p[a] += v[a] * h;
          p[a + 1] += v[a + 1] * h;
          p[a + 2] += v[a + 2] * h;
          let dx = p[a] - p[b], dy = p[a + 1] - p[b + 1], dz = p[a + 2] - p[b + 2];
          const l = Math.hypot(dx, dy, dz) || 1;
          const k = seg / l;
          p[a] = p[b] + dx * k;
          p[a + 1] = p[b + 1] + dy * k;
          p[a + 2] = p[b + 2] + dz * k;
          // (on the road it drags)
          if (p[a + 1] < ground + 0.003) {
            p[a + 1] = ground + 0.003;
            if (v[a + 1] < 0) v[a + 1] = 0;
            v[a] *= 0.6;
            v[a + 2] *= 0.6;
          }
        }
      }
    }
  }

  // Sparks snapping across the gaps between plumes: only near full charge,
  // more the fuller it is.
  crackle(dt, charge, burst) {
    const C = this.crackles;
    for (let i = C.length - 1; i >= 0; i--) {
      C[i][4] -= dt;
      if (C[i][4] <= 0) C.splice(i, 1);
    }
    const k = smooth(0.82, 1.0, charge);
    if (k <= 0 && !burst) return;
    this.crackleAcc += dt * (3 + 30 * k * k) + burst;
    const p = this.pos;
    let tries = 0;
    while (this.crackleAcc >= 1 && C.length < 8 && tries++ < 12) {
      this.crackleAcc -= 1;
      const a = Math.floor(Math.random() * this.P);
      const ja = 3 + Math.floor(Math.random() * (K - 3));
      const ia = (a * K + ja) * 3;
      let best = -1, bj = 0, bd = 1e9;
      for (let b = 0; b < this.P; b++) {
        if (b === a) continue;
        for (let j = 3; j < K; j++) {
          const ib = (b * K + j) * 3;
          const d = Math.hypot(p[ia] - p[ib], p[ia + 1] - p[ib + 1], p[ia + 2] - p[ib + 2]);
          if (d > 0.015 && d < 0.09 && d < bd) {
            bd = d;
            best = b;
            bj = j;
          }
        }
      }
      if (best < 0) continue;
      C.push([a, ja, best, bj, 0.04 + Math.random() * 0.06, Math.random()]);
      this.glow[a] = this.glow[best] = 1;
      this.snapped = (this.snapped || 0) + 1;
    }
    if (this.crackleAcc > 2) this.crackleAcc = 2;
  }

  // Lay the strips along the spines, in the world (M: the root's matrix).
  write(M, q, charge, vis, t) {
    const P = this.P, D = this.defs;
    const p = this.pos;
    const glowAll = smooth(0.8, 1.0, charge);
    for (let i = 0; i < P; i++) {
      const d = D[i];
      const o = i * K * 3;
      const az = lerp(d.az[0], d.az[1], this.lift[i]) * (Math.PI / 180);
      // (lying in its fan: across it, level)
      _v3.set(Math.cos(az), 0, Math.sin(az)).applyQuaternion(q);
      const sepW = 0.36 + 0.64 * this.sep[i];
      this.glow[i] = Math.max(0, this.glow[i] - 0.08);
      const glow = Math.max(glowAll * (0.35 + 0.25 * Math.sin(t * 9 + d.seed * 20)), this.glow[i]);
      for (let j = 0; j < K; j++) {
        const a = o + j * 3;
        const f = j / (K - 1);
        _p.set(p[a], p[a + 1], p[a + 2]).applyMatrix4(M);
        const j0 = Math.max(0, j - 1), j1 = Math.min(K - 1, j + 1);
        _v.set(p[o + j1 * 3] - p[o + j0 * 3], p[o + j1 * 3 + 1] - p[o + j0 * 3 + 1], p[o + j1 * 3 + 2] - p[o + j0 * 3 + 2]).applyQuaternion(q).normalize();
        const hw = d.w * SCALE * sepW * (0.32 + 0.68 * Math.sin(Math.PI * Math.min(1, f * 1.2 + 0.08)) ** 0.6);
        for (let s = 0; s < 2; s++) {
          const vi = (i * K + j) * 2 + s;
          _p.toArray(this.aPos, vi * 3);
          _v.toArray(this.aTan, vi * 3);
          _v3.toArray(this.aFix, vi * 3);
          this.aPl[vi * 4] = s ? 1 : -1;
          this.aPl[vi * 4 + 1] = f;
          this.aPl[vi * 4 + 2] = d.col;
          this.aPl[vi * 4 + 3] = hw;
          this.aSt[vi * 4] = this.sep[i];
          this.aSt[vi * 4 + 1] = this.lift[i];
          this.aSt[vi * 4 + 2] = d.seed;
          this.aSt[vi * 4 + 3] = glow;
        }
      }
    }
    for (const k of ['position', 'aTan', 'aFix', 'aPl', 'aSt']) this.geo.attributes[k].needsUpdate = true;
    this.mat.uniforms.uPlume.value.x = vis;
  }

  // A point on a plume, in the world.
  point(i, j, M, out) {
    const a = (i * K + j) * 3;
    return out.set(this.pos[a], this.pos[a + 1], this.pos[a + 2]).applyMatrix4(M);
  }
}

// --- arcs ----------------------------------------------------------------------------
// Crooked strips of light: the crackles in the crown and the bolt it travels
// by. Each frame: begin(), add() each arc as it is (world points), end().
const ARCS = 14;
const AN = 18;
class Arcs {
  constructor(u) {
    const n = ARCS * AN * 2;
    const geo = new THREE.BufferGeometry();
    this.aPos = new Float32Array(n * 3);
    this.aTan = new Float32Array(n * 3);
    this.aArc = new Float32Array(n * 4);
    this.aPulse = new Float32Array(n * 3);
    const dyn = (arr, k) => new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.aPos, 3));
    geo.setAttribute('aTan', dyn(this.aTan, 3));
    geo.setAttribute('aArc', dyn(this.aArc, 4));
    geo.setAttribute('aPulse', dyn(this.aPulse, 3));
    const idx = [];
    for (let i = 0; i < ARCS; i++) {
      for (let k = 0; k < AN - 1; k++) {
        const a = (i * AN + k) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, makeArcMaterial(u));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.name = 'thistleArcs';
    this.mesh.visible = false;
    this.n = 0;
    this.pts = Array.from({ length: AN }, () => new THREE.Vector3());
  }

  begin() {
    this.n = 0;
  }

  // pts: world points along it (2..), half width (m), brightness, the
  // pulse's place along it (< 0 none) and length, how much of it is drawn
  add(pts, count, hw, bright, pulse = -1, plen = 0.1, drawn = 1) {
    if (this.n >= ARCS || count < 2) return;
    const i = this.n++;
    // (resampled to AN points by length along it)
    let total = 0;
    for (let k = 1; k < count; k++) total += pts[k].distanceTo(pts[k - 1]);
    let seg = 0, acc = 0;
    for (let k = 0; k < AN; k++) {
      const s = (k / (AN - 1)) * total;
      while (seg < count - 2 && acc + pts[seg + 1].distanceTo(pts[seg]) < s) {
        acc += pts[seg + 1].distanceTo(pts[seg]);
        seg++;
      }
      const L = pts[seg + 1].distanceTo(pts[seg]) || 1;
      const t = clamp((s - acc) / L, 0, 1);
      this.pts[k].copy(pts[seg]).lerp(pts[seg + 1], t);
    }
    for (let k = 0; k < AN; k++) {
      const k0 = Math.max(0, k - 1), k1 = Math.min(AN - 1, k + 1);
      _v.subVectors(this.pts[k1], this.pts[k0]).normalize();
      // (tapering at both ends)
      const f = k / (AN - 1);
      const w = hw * (0.45 + 0.55 * Math.sin(Math.PI * clamp(f * 1.1 - 0.05, 0, 1)) ** 0.5);
      for (let s = 0; s < 2; s++) {
        const vi = (i * AN + k) * 2 + s;
        this.pts[k].toArray(this.aPos, vi * 3);
        _v.toArray(this.aTan, vi * 3);
        this.aArc[vi * 4] = s ? 1 : -1;
        this.aArc[vi * 4 + 1] = f;
        this.aArc[vi * 4 + 2] = w;
        this.aArc[vi * 4 + 3] = bright;
        this.aPulse[vi * 3] = pulse;
        this.aPulse[vi * 3 + 1] = plen;
        this.aPulse[vi * 3 + 2] = drawn;
      }
    }
  }

  end() {
    this.geo.setDrawRange(0, this.n * (AN - 1) * 6);
    this.mesh.visible = this.n > 0;
    if (this.n) for (const k of ['position', 'aTan', 'aArc', 'aPulse']) this.geo.attributes[k].needsUpdate = true;
  }
}

// A crooked line from a to b: n points, each step knocked aside (more in the
// middle), arched up by `arch` (m) - into out (Vector3s).
const _ja = new THREE.Vector3();
const _jb = new THREE.Vector3();
const _jd = new THREE.Vector3();
const _j1 = new THREE.Vector3();
const _j2 = new THREE.Vector3();
function jag(a0, b0, n, rough, arch, out) {
  const a = _ja.copy(a0), b = _jb.copy(b0);
  _jd.subVectors(b, a);
  const L = _jd.length() || 1e-3;
  _j1.crossVectors(_jd, _UP);
  if (_j1.lengthSq() < 1e-8) _j1.set(1, 0, 0);
  _j1.normalize();
  _j2.crossVectors(_j1, _jd).normalize();
  let ox = 0, oy = 0;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const env = Math.sin(Math.PI * t);
    ox = ox * 0.4 + (Math.random() - 0.5) * 2 * rough * L;
    oy = oy * 0.4 + (Math.random() - 0.5) * 2 * rough * L;
    out[k]
      .copy(a)
      .lerp(b, t)
      .addScaledVector(_j1, ox * env)
      .addScaledVector(_j2, oy * env)
      .addScaledVector(_UP, arch * env);
  }
  return out;
}

// --- the body ------------------------------------------------------------------------
export class Thistle {
  constructor(env, asset) {
    this.asset = asset;
    this.rig = asset.meta.rig;
    this.u = makeEnvUniforms(env);
    this.root = new THREE.Group();
    this.root.name = 'thistle';
    this.buildSkeleton();
    this.buildLook();
    this.buildShadow();
    this.crown = new Crown(this.u);
    this.arcs = new Arcs(this.u);
    this.dust = new Dust(this.u, 120);
    this.S = {};
    for (const k of ['roll', 'pitch', 'yaw', 'surge', 'heave', 'squash', 'brow', 'lean', 'side']) this.S[k] = new Sway();
    this.wS = { run: new Spring(), stand: new Spring(1), sit: new Spring(), air: new Spring() };
    this.w = { run: 0, stand: 1, sit: 0, air: 0 };
    this.low = new Spring();
    this.braceS = new Spring();
    // set by its mind (scurrier.js): how much static it holds (0..1), how
    // much it's gliding (0..1)
    this.charge = 0;
    this.glide = 0;
    this.act = {};
    this.boltPts = Array.from({ length: 14 }, () => new THREE.Vector3());
    this.tmpPts = Array.from({ length: 8 }, () => new THREE.Vector3());
    this.trackPts = Array.from({ length: 14 }, () => new THREE.Vector3());
    this.reset();
  }

  // --- skeleton -------------------------------------------------------------------
  buildSkeleton() {
    const bones = [];
    this.b = {};
    for (const d of this.asset.meta.bones) {
      const b = new THREE.Bone();
      b.name = d.name;
      b.position.fromArray(d.p);
      b.quaternion.fromArray(d.q);
      if (d.parent) this.b[d.parent].add(b);
      bones.push(b);
      this.b[d.name] = b;
    }
    this.bones = bones;
    this.body = this.b.body;
    this.root.add(this.body);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.bind = {};
    for (const b of bones) this.bind[b.name] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    this.rest = {};
    for (const b of bones) this.rest[b.name] = b.position.clone();
    const B = this.bind;
    // each leg: its hip on the pod (pod space), its two segments, its
    // ankle's rest place and which way its knee bows
    this.legs = ['L', 'R', 'B'].map((L) => {
      const hip = B['hip' + L], knee = B['knee' + L], ankle = B['foot' + L];
      const az = this.rig.legs[L].az * (Math.PI / 180);
      return {
        L,
        s: L === 'L' ? -1 : L === 'R' ? 1 : 0,
        hip: hip.clone().sub(B.pod),
        a: knee.distanceTo(hip),
        c: ankle.distanceTo(knee),
        upper: knee.clone().sub(hip),
        lower: ankle.clone().sub(knee),
        ankle: ankle.clone(),
        out: new THREE.Vector3(Math.sin(az), 0, -Math.cos(az)),
        plant: new THREE.Vector3(),
        lift: 0,
        down: true,
      };
    });
    this.crownRest = B.crown.clone();
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    this.faceU = { value: new THREE.Vector4(1, 0, 0, 0) };
    const E = this.rig.eyes[1];
    this.eyeU = { value: new THREE.Vector4(Math.abs(E[0]), E[1], E[2], this.rig.eyeR) };
    this.staticU = { value: new THREE.Vector4() };
    const mats = makeCharacterMaterials(this.u, palette(COL), [], 0.0062, null, { style: 'thistle', uniforms: { uFace: this.faceU, uEye: this.eyeU, uStatic: this.staticU } });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    const geo = bodyGeometry(this.asset);
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.inkMesh = new THREE.SkinnedMesh(geo, this.inkMat);
    for (const m of [this.mesh, this.inkMesh]) {
      m.frustumCulled = false;
      m.renderOrder = -20;
      this.root.add(m);
    }
    this.root.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.inkMesh.bind(this.skeleton, this.mesh.bindMatrix);
  }

  buildShadow() {
    this.cast = new CastShadow(this.u, { res: 160 });
    this.shadow = this.cast.mesh;
  }

  renderShadow(renderer) {
    if (this.cast.casters.length === 0) this.cast.setCasters([this.root]);
    if (this.root.visible) this.cast.render(renderer);
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points, this.crown.mesh, this.arcs.mesh];
  }

  reset() {
    this.time = 0;
    this.phase = 0;
    this.speed = 0;
    this.mode = 'sit';
    this.airT = 0;
    this.airDur = 1;
    this.airKind = 'leap';
    this.landClock = 9;
    this.landHit = 0;
    this.happy = 0;
    this.wag = 0;
    this.earBias = 0;
    this.lowTarget = 0;
    this.jawOpen = 0;
    this.blinkT = 2;
    this.blink = 0;
    this.lookAt = null;
    this.lookW = 0;
    this.spin = 0;
    this.lat = 0;
    this.curl = 0;
    this.crouch = 0;
    this.peekT = 3;
    this.peek = 0;
    this.twitch = 9;
    this.vel = new THREE.Vector3();
    this.velS = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.accL = new THREE.Vector3();
    this.air = new THREE.Vector3();
    this.ready = false;
    this.lastDt = 0;
    this.stepped = [false, false, false];
    this.brace = 0;
    this.flash = 0;
    this.zapT = -1;
    this.loosed = true;
    this.groundY = 0;
    this.zapFrom = null;
    this.zapTo = null;
    this.arrived = false;
    this.vis = 1;
    this.rejagT = 0;
    this.spikes = [];
    for (const k in this.wS) this.wS[k].reset(k === 'sit' ? 1 : 0);
    for (const s of Object.values(this.S)) s.reset();
    this.low.reset();
    this.braceS.reset();
    this.crown?.reset();
    this.dust?.clear();
    this.root.visible = true;
  }

  // --- what its mind tells it --------------------------------------------------------
  // A landing of strength k (1 a plain leap).
  land(k = 1) {
    this.landClock = 0;
    this.landHit = k;
    this.landed = true;
  }

  // (no mouth to snap shut: a gem it catches it catches in its crown - see
  // scurrier.js)
  snap() {
    this.twitch = 0;
  }

  flick() {
    this.twitch = 0;
  }

  // Travel through a spark from `from` to `to` (track coordinates: x, y,
  // d - how far along the run). Its mind moves it when the pulse gets there
  // (zapReady), then calls arrive().
  zap(from, to) {
    this.zapT = 0;
    this.arrived = false;
    this.loosed = false;
    this.zapFrom = { ...from };
    this.zapTo = { ...to };
    this.newBolt();
  }

  // (the pulse is there: its mind can put it at the far end)
  get zapReady() {
    return this.zapT >= ZAP.lock + ZAP.travel && !this.arrived;
  }

  get zapping() {
    return this.zapT >= 0;
  }

  arrive() {
    this.arrived = true;
    this.flash = 1;
    this.brace = 1;
    this.ready = false;
    this.spikes.push({ at: this.zapTo, t: 0.12 });
  }

  // A fresh crooked line for the bolt (it re-forks as it flickers), in
  // track coordinates.
  newBolt() {
    const A = _p.set(this.zapFrom.x, this.zapFrom.y + 0.03, this.zapFrom.d);
    const B = _s.set(this.zapTo.x, this.zapTo.y + 0.03, this.zapTo.d);
    const L = A.distanceTo(B);
    jag(A, B, this.trackPts.length, 0.07, Math.min(0.9, 0.12 + L * 0.12), this.trackPts);
    // (a fork or two off it)
    this.forks = [0, 1].map(() => ({ at: 3 + Math.floor(Math.random() * 8), dir: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize(), len: 0.15 + Math.random() * 0.3 }));
  }

  // --- the frame ----------------------------------------------------------------------
  // ctx (as the fox's): { speed, vel, mode, airT / airDur / airKind, fall,
  // lat, crouch, crouchKind, curl }
  update(dt, ctx) {
    this.time += dt;
    this.lastDt += dt;
    const t = this.time;
    this.speed = ctx.speed;
    this.mode = ctx.mode === 'ride' ? 'stand' : ctx.mode;
    this.lat = ctx.lat || 0;
    this.curl = ctx.curl || 0;
    this.crouch = ctx.crouch || 0;
    if (ctx.vel) {
      if (!this.ready) this.velS.copy(ctx.vel);
      _v.copy(this.velS);
      this.velS.lerp(ctx.vel, 1 - Math.exp(-dt * 30));
      if (dt > 0) this.acc.subVectors(this.velS, _v).divideScalar(dt).clampLength(0, 60);
      if (!this.ready) this.acc.set(0, 0, 0);
      this.acc.y += ctx.fall || 0;
      this.vel.copy(ctx.vel);
      this.ready = true;
    }
    if (this.mode === 'air') {
      this.airT = ctx.airT;
      this.airDur = ctx.airDur;
      this.airKind = ctx.airKind;
    }
    this.landClock += dt;
    this.twitch += dt;
    // travelling through a spark
    if (this.zapT >= 0) {
      this.zapT += dt;
      if (this.arrived && this.zapT > ZAP.lock + ZAP.travel + Math.max(ZAP.fade, ZAP.loose) + 0.05) this.zapT = -1;
    }
    const hidden = this.zapT >= ZAP.lock && !this.arrived;
    this.vis = hidden ? 0 : 1;
    this.root.visible = !hidden;
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.brace = Math.max(this.brace - dt * 1.8, 0);

    // the scurry's rhythm: quick, quicker the faster it goes (each foot
    // still has its moment to be seen)
    const run = this.mode === 'run';
    this.freq = clamp(2.5 + 0.13 * this.speed, 2.8, 5.0);
    const ph0 = this.phase;
    this.phase = (this.phase + dt * (run ? this.freq : 0)) % 1;
    this.stepped = run ? [crossed(ph0, this.phase, 0.3), crossed(ph0, this.phase, 0.6), crossed(ph0, this.phase, 0.96)] : [false, false, false];

    // blinks; a happy squint; where it looks
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.13;
      this.blinkT = 1.4 + Math.random() * 3.5 + (Math.random() < 0.25 ? -1 : 0);
    }
    this.blink = Math.max(0, this.blink - dt);
    const bl = this.blink > 0 ? Math.sin((this.blink / 0.13) * Math.PI) : 0;
    const lx = this.lookAt ? clamp(this.lookAt.x / Math.max(0.3, Math.hypot(this.lookAt.x, this.lookAt.z)), -1, 1) * this.lookW : 0;
    const ly = this.lookAt ? clamp(this.lookAt.y / Math.max(0.5, Math.hypot(this.lookAt.x, this.lookAt.z)), -1, 1) * this.lookW : 0;
    // (startled, it squints; arriving through a spark, eyes wide)
    this.faceU.value.set(clamp(1 - bl * 1.2 - 0.3 * clamp(this.earBias, 0, 1) + 0.2 * this.brace, 0, 1), clamp(this.happy, 0, 1), lx, ly);
    // now and then it lifts its hood to peek out from under it
    this.peekT -= dt;
    if (this.peekT <= 0) {
      this.peekT = 2.5 + Math.random() * 5;
      this.peekDur = 0.45 + Math.random() * 0.5;
      this.peekAt = t;
    }
    this.peek = this.peekAt !== undefined && t - this.peekAt < this.peekDur ? Math.sin(((t - this.peekAt) / this.peekDur) * Math.PI) : 0;
    this.animate(dt, t);
  }

  animate(dt, t) {
    const m = this.mode;
    const W = this.wS;
    let tr = 0, ts = 0, tsit = 0, ta = 0;
    if (m === 'run') {
      const k = smooth(0.3, 1.4, this.speed);
      tr = k;
      ts = 1 - k;
    } else if (m === 'air') ta = 1;
    else if (m === 'sit') tsit = 1;
    else ts = 1;
    const w = this.w;
    // (off a landing it's straight back into its stride: no pause)
    w.run = Math.max(0, W.run.step(tr, 9, 0.9, dt));
    w.stand = Math.max(0, W.stand.step(ts, 4, 0.9, dt));
    w.sit = Math.max(0, W.sit.step(tsit, 2.5, 0.95, dt));
    w.air = Math.max(0, W.air.step(ta, 12, 0.85, dt));
    const tot = w.run + w.stand + w.sit + w.air || 1;
    const run = w.run / tot, sit = w.sit / tot, air = w.air / tot;
    const low = this.low.step(this.lowTarget || 0, 3.5, 0.9, dt);
    const brace = this.braceS.step(this.brace, 7, 0.7, dt);
    const S = this.S;
    const b = this.b;
    const ph = this.phase;
    const sp = clamp(this.speed / 18, 0, 1.2);
    _qi.copy(this.root.quaternion).invert();
    const acc = this.accL.copy(this.acc).applyQuaternion(_qi);
    const A = this.act;
    const idle = A.idle || 0;
    const glide = this.glide;

    // --- the pod: its weight over whichever feet are down ---
    // the front left swings (its weight on the right and the rear root:
    // rolled right), then the front right (rolled left), then the rear root
    // pushes (pitched forward, lunging) and swings through
    const swingL = window01(ph, 0.0, 0.3), swingR = window01(ph, 0.3, 0.6), push = pulse(ph, 0.64, 0.065), swingB = window01(ph, 0.72, 0.96);
    const plantL = pulse(ph, 0.3, 0.035), plantR = pulse(ph, 0.6, 0.035);
    const rollAmt = (0.15 + 0.07 * Math.min(sp, 1)) * run;
    const rollT = rollAmt * (bump(swingL) - bump(swingR)) + idle * 0.06 * Math.sin(t * 2.1) + 0.04 * this.wag * Math.sin(t * 8);
    const roll = clamp(S.roll.step(rollT, 3.2, 0.32, -acc.x * 0.05, dt), -0.4, 0.4);
    // (pitched forward into its run, more on each push; back when it pulls
    // up, gliding, or braced)
    const pitchT = run * (-0.1 - 0.06 * Math.min(sp, 1) - 0.1 * push + 0.05 * bump(swingB)) + clamp(acc.z * 0.01, -0.15, 0.15) + 0.12 * brace + 0.15 * glide * air - 0.12 * this.crouch + idle * 0.03 * Math.sin(t * 3.1);
    const pitch = clamp(S.pitch.step(pitchT, 2.6, 0.35, 0, dt), -0.5, 0.5);
    const yawT = run * 0.06 * (bump(swingR) - bump(swingL)) + (this.lookAt ? clamp(Math.atan2(-this.lookAt.x, -this.lookAt.z), -0.6, 0.6) * this.lookW * 0.5 : 0);
    const yaw = S.yaw.step(yawT, 3.5, 0.5, 0, dt);
    const side = S.side.step(clamp(acc.x * 0.008, -0.18, 0.18), 2.6, 0.55, 0, dt);
    // (lunging forward on the push, settling back)
    const surge = S.surge.step(run * (-0.016 * push + 0.006 * bump(swingB)) * (0.6 + 0.6 * Math.min(sp, 1)), 6, 0.5, 0, dt);
    // (down onto each plant, up on the push)
    const heaveT = run * (0.007 * push - 0.006 * (plantL + plantR)) - 0.018 * this.crouch * this.crouch - 0.016 * brace - 0.024 * sit - 0.02 * low + air * 0.01;
    const heave = S.heave.step(heaveT, 6, 0.45, 0, dt);
    // squash and stretch: down into a wind-up and a landing
    let sq = -0.08 * this.crouch - 0.04 * sit - 0.05 * brace;
    if (m === 'air') {
      const p = clamp(this.airT / Math.max(0.05, this.airDur), 0, 1);
      sq += 0.06 * (1 - p) * (1 - glide);
    }
    if (this.landHit > 0 && this.landClock < 1) sq -= 0.1 * this.landHit * impulse(this.landClock, 5, 0.35, 0);
    sq -= run * 0.025 * (plantL + plantR);
    const squash = S.squash.step(sq, 6, 0.4, 0, dt);
    const sy = 1 + squash, sxz = 1 / Math.sqrt(Math.max(0.5, sy));
    b.pod.scale.set(sxz, sy, sxz);
    _e.set(pitch, yaw, -roll - side, 'YXZ');
    b.pod.quaternion.setFromEuler(_e);
    b.pod.position.copy(this.rest.pod);
    b.pod.position.y += heave;
    b.pod.position.z += surge;
    // the hood's brow: lifted to peek or when curious, pressed down when
    // startled, lifted by the air gliding, bouncing on each plant
    const browT = 0.32 * this.peek * (1 - air) + 0.14 * this.lookW + 0.12 * this.happy - 0.3 * clamp(this.earBias, 0, 1) + 0.25 * glide * air + 0.12 * brace + (this.twitch < 0.3 ? Math.sin((this.twitch / 0.3) * Math.PI) * 0.2 : 0);
    const brow = S.brow.step(browT, 4, 0.3, -acc.y * 0.4 + acc.z * 0.2, dt);
    _e.set(clamp(brow, -0.3, 0.5), 0, 0);
    b.brow.quaternion.setFromEuler(_e);
    this.root.matrixWorld.identity();
    this.body.updateWorldMatrix(false, true);

    // --- the legs ---
    this.legsStep(dt, t, run, air, sit, brace, glide);
    this.body.updateWorldMatrix(false, true);

    // --- the crown ---
    this.crownStep(dt, t, sit);

    // --- static: on the husk, and the flash of arriving ---
    const c = this.charge;
    this.staticU.value.set(c, this.flash * this.flash, smooth(0.8, 1, c), 0);

    // --- a puff of dust off each foot as it plants; more on a landing ---
    this.puffs(run, sp);
    this.landed = false;
  }

  // Each foot: planted while it carries the pod (sliding back under it),
  // then lifted and swung through. The front roots reach well forward; the
  // rear root plants under the pod and pushes away behind it. Each leg is a
  // two-bone reach from its hip on the pod to its foot, the knee bowed out
  // and up.
  legsStep(dt, t, run, air, sit, brace, glide) {
    const b = this.b;
    const pod = b.pod;
    // (the stride: longer the faster it goes, but always short and quick)
    const S = clamp(0.026 + 0.0055 * this.speed, 0.03, 0.12) * run;
    const p = clamp(this.airT / Math.max(0.05, this.airDur), 0, 1);
    for (let i = 0; i < 3; i++) {
      const g = this.legs[i];
      const front = i < 2;
      const [s0, s1] = i === 0 ? [0.0, 0.3] : i === 1 ? [0.3, 0.6] : [0.72, 0.96];
      const zf = front ? -0.62 * S : -0.3 * S;
      const zb = front ? 0.38 * S : 0.7 * S;
      let u = window01(this.phase, s0, s1);
      const ank = _v.copy(g.ankle);
      let lift = 0;
      if (u >= 0) {
        // swinging through: back to front, lifted
        const e = u * u * (3 - 2 * u);
        ank.z += lerp(zb, zf, e);
        lift = (0.012 + 0.16 * S) * Math.sin(Math.PI * u) ** 0.8;
        ank.y += lift;
        // (the front roots reach out a little as they go)
        ank.addScaledVector(g.out, 0.006 * Math.sin(Math.PI * u) * (front ? 1 : 0.3));
        g.down = false;
      } else {
        // planted: from where it came down to where it leaves the road
        const st = stance(this.phase, s1, s0);
        // (the rear root's push: most of its sweep back comes late)
        const k = front ? st : st ** 1.7;
        ank.z += lerp(zf, zb, k);
        g.down = true;
      }
      // braced: splayed wide (arriving through a spark, a hard landing);
      // sitting: tucked in under it
      ank.addScaledVector(g.out, 0.03 * brace - 0.022 * sit);
      // in the air its legs hang and paddle - splayed wide as it glides,
      // reaching for the road as it comes down
      if (air > 0.01) {
        const hip = _v2.copy(g.hip).applyMatrix4(pod.matrix);
        _v3.copy(hip).addScaledVector(g.out, 0.035 + 0.04 * glide);
        _v3.y = hip.y - (g.a + g.c) * (0.72 - 0.18 * glide) + 0.02 * p;
        _v3.z += 0.012 * Math.sin(t * (glide > 0.3 ? 7 : 14) + i * 2.1) * (0.4 + glide);
        _v3.y += 0.008 * Math.sin(t * (glide > 0.3 ? 7 : 14) + i * 2.1 + 1.4);
        ank.lerp(_v3, air);
      }
      ank.y = Math.max(ank.y, g.ankle.y - 0.002);
      g.lift = ank.y - g.ankle.y;
      g.plant.copy(ank);
      // the hip: on the pod's underside, wherever the pod is
      const hip = _p.copy(g.hip).applyMatrix4(pod.matrix);
      // two-bone reach: the knee bowed out (and up) from the line hip-ankle
      const to = _kt.subVectors(ank, hip);
      let d = to.length();
      d = clamp(d, Math.abs(g.a - g.c) + 0.005, (g.a + g.c) * 0.995);
      const dir = to.normalize();
      // (the pole: out from the body and up)
      _v2.copy(g.out).addScaledVector(_UP, 0.8);
      _v2.addScaledVector(dir, -_v2.dot(dir)).normalize();
      const ca = clamp((g.a * g.a + d * d - g.c * g.c) / (2 * g.a * d), -1, 1);
      const sa = Math.sqrt(1 - ca * ca);
      const kn = _kn.copy(hip).addScaledVector(dir, g.a * ca).addScaledVector(_v2, g.a * sa);
      const an = _ka.copy(hip).addScaledVector(dir, d);
      const hb = b['hip' + g.L];
      hb.position.copy(hip);
      aimTo(hb, g.upper, _v2.subVectors(kn, hip));
      hb.updateMatrixWorld(true);
      const kb = b['knee' + g.L];
      aimTo(kb, g.lower, _v2.subVectors(an, kn));
      kb.updateMatrixWorld(true);
      // the foot: flat on the road (its parent's turn undone), its toes
      // curled down as it lifts
      const fb = b['foot' + g.L];
      kb.matrixWorld.decompose(_v2, _q, _v3);
      _q.invert();
      _e.set(lift * 6, 0, 0);
      _q2.setFromEuler(_e);
      fb.quaternion.copy(_q).multiply(_q2);
    }
  }

  // The crown: its socket where the pod has it, its plumes' rest shapes for
  // the charge, the step, and the strips laid out in the world.
  crownStep(dt, t, sit) {
    const cr = this.crown;
    const b = this.b;
    // (root space: the root's matrix is cleared while it's posed)
    _p.setFromMatrixPosition(b.crown.matrixWorld);
    b.pod.matrixWorld.decompose(_v2, _q, _v3);
    const ground = -(this.root.position.y - this.groundY) / SCALE;
    // (a beat after it arrives through a spark, the crown falls loose)
    if (this.arrived && !this.loosed && this.zapT >= ZAP.lock + ZAP.travel + ZAP.loose) {
      cr.loose = 1;
      this.loosed = true;
    }
    cr.loose = Math.max(0, cr.loose - dt * 1.4);
    cr.targets(t, _p, _q, this.charge, this.glide, this.speed, ground, sit);
    // (the air going past, in its own space and size; the body's own
    // lurches)
    this.air.copy(this.vel).applyQuaternion(_qi.copy(this.root.quaternion).invert()).multiplyScalar(-1 / SCALE);
    this.air.y *= 0.5;
    this.air.clampLength(0, 16);
    const acc = _v.copy(this.accL).multiplyScalar(1 / SCALE);
    const accA = [acc.x, acc.y, acc.z], airA = [this.air.x, this.air.y, this.air.z];
    if (dt > 0) cr.step(dt, accA, airA, this.charge, ground);
    cr.crackle(dt, this.vis ? this.charge : 0, 0);
    _M.compose(this.root.position, this.root.quaternion, _s.setScalar(SCALE));
    cr.write(_M, this.root.quaternion, this.charge, this.vis, t);
    this.crownM = this.crownM || new THREE.Matrix4();
    this.crownM.copy(_M);
  }

  puffs(run, sp) {
    if (this.lastDt <= 0 || !this.vis) return;
    for (let i = 0; i < 3; i++) {
      const g = this.legs[i];
      if (this.stepped[i] && Math.random() < 0.7) {
        _p.copy(g.plant);
        _p.y = 0.012;
        _v.set(g.out.x * 0.3, 0.25, 0.5 + 0.4 * sp);
        this.emit(_p, _v, 0.07 + 0.04 * Math.random(), 0, 0.35, 0.6, 0.7);
      }
      if (this.landed) {
        _p.copy(g.plant);
        _p.y = 0.015;
        _v.set(g.out.x * 0.7, 0.35, g.out.z * 0.7);
        this.emit(_p, _v, 0.12 + 0.06 * this.landHit, 0, 0.45, 0.8, 1);
      }
    }
  }

  emit(p, v, size, kind, alpha = -1, life = 1, grow = 1) {
    this.dust.emit(p.multiplyScalar(SCALE), v, size, kind, alpha, life, grow);
  }

  // After the frame: its dust, and the arcs - the crackles in its crown and
  // the bolt it travels by - laid into the world (z: the runner's scene z,
  // dist: how far they've run).
  after(z, dist, lowG = false) {
    this.dust.g = lowG ? 6 : 16;
    this.dust.update(this.lastDt, this.root, z, dist);
    const dt = this.lastDt;
    this.lastDt = 0;
    const A = this.arcs;
    A.begin();
    const cr = this.crown;
    const M = this.crownM;
    // the crackles, re-jagged every frame (they snap)
    if (M && this.vis) {
      for (const c of cr.crackles) {
        cr.point(c[0], c[1], M, _p);
        cr.point(c[2], c[3], M, _s);
        const n = 7;
        const pts = jag(_v.copy(_p), _v2.copy(_s), n, 0.32, 0, this.tmpPts);
        A.add(pts, n, 0.022 + 0.012 * Math.random(), 0.9 + 0.5 * Math.random());
      }
    }
    // the bolt
    if (this.zapT >= 0 && this.zapFrom) {
      const T = this.zapT;
      const world = (q, out) => out.set(q.x, q.y, z - ((q.d ?? q.z) - dist));
      this.rejagT -= dt;
      if (this.rejagT <= 0) {
        this.newBolt();
        this.rejagT = 0.035 + Math.random() * 0.03;
      }
      const n = this.trackPts.length;
      for (let k = 0; k < n; k++) world(this.trackPts[k], this.boltPts[k]);
      const end = ZAP.lock + ZAP.travel;
      let bright, pulse = -1, drawn = 1;
      if (T < ZAP.lock) {
        // flickering into being from its feet
        drawn = clamp(T / (ZAP.lock * 0.7), 0.05, 1);
        bright = 0.45 + 0.35 * Math.random();
      } else if (T < end || !this.arrived) {
        pulse = clamp((T - ZAP.lock) / ZAP.travel, 0, 1);
        bright = 1;
      } else {
        // fading, flickering out
        const f = 1 - clamp((T - end) / ZAP.fade, 0, 1);
        bright = f * f * (0.5 + 0.7 * Math.random());
      }
      if (bright > 0.01) {
        A.add(this.boltPts, n, 0.07, bright, pulse, 0.1, drawn);
        for (const f of this.forks || []) {
          const p0 = this.boltPts[Math.min(n - 1, f.at)];
          const pts = jag(_v.copy(p0), _v2.copy(p0).addScaledVector(f.dir, f.len), 5, 0.25, 0, this.tmpPts);
          if (drawn >= f.at / (n - 1)) A.add(pts, 5, 0.03, bright * 0.7);
        }
      }
      // (a flash at its feet as it goes)
      if (T >= ZAP.lock && T < ZAP.lock + 0.08) this.burst(world(this.zapFrom, _p), 0.6 * (1 - (T - ZAP.lock) / 0.08));
    }
    // arrival: a burst of short sparks at its feet
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.spikes.splice(i, 1);
        continue;
      }
      this.burst(_p.set(s.at.x, s.at.y + 0.02, z - (s.at.d - dist)), s.t / 0.12);
    }
    A.end();
  }

  // A few short sparks leaping off a point.
  burst(at, k) {
    if (k <= 0) return;
    const c = _bc.copy(at);
    for (let i = 0; i < 4; i++) {
      _v2.set(Math.random() - 0.5, 0.2 + Math.random() * 0.8, Math.random() - 0.5).normalize();
      const pts = jag(_v.copy(c), _s.copy(c).addScaledVector(_v2, 0.12 + 0.2 * Math.random()), 5, 0.3, 0, this.tmpPts);
      this.arcs.add(pts, 5, 0.035, k);
    }
  }

  // --- placing it in the world ----------------------------------------------------------
  place(pos, q, ground = 0, shadow = 1) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    this.root.scale.setScalar(SCALE);
    this.groundY = ground;
    if (this.spin) {
      _q.setFromAxisAngle(_UP, this.spin);
      this.root.quaternion.multiply(_q);
    }
    const h = Math.max(0, pos.y - ground);
    const r = 0.36 * SCALE;
    const vis = this.vis ?? 1;
    this.cast.aim(pos.x - r, pos.x + r, pos.y - 0.05, pos.y + 0.45 * SCALE, pos.z - r, pos.z + r, ground, pos.x, pos.z, {
      alpha: 0.9 * clamp(1 - h * 0.2, 0.5, 1) * shadow * vis,
      contact: 0.3 * clamp(1 - h * 3, 0, 1) * shadow * vis,
      reach: 0.16,
    });
  }

  forCompile(on) {
    this.root.visible = true;
    this.shadow.visible = on;
    this.dust.forCompile(on);
    this.crown.mesh.visible = on;
    this.arcs.mesh.visible = on;
    if (on) {
      // (something in the arcs' buffers, so their shader has work to compile)
      this.arcs.begin();
      this.arcs.add([new THREE.Vector3(0, -50, 0), new THREE.Vector3(0, -50.1, 0)], 2, 0.001, 0);
      this.arcs.end();
    } else this.crown.mesh.visible = true;
  }
}

// Where the phase is through [a, b) (0..1), or -1 outside it.
function window01(ph, a, b) {
  return ph >= a && ph < b ? (ph - a) / (b - a) : -1;
}

// A bump over a window's progress (0 outside it).
function bump(u) {
  return u < 0 ? 0 : Math.sin(Math.PI * u);
}

// A soft pulse at `at` in the cycle, w wide (wrapping).
function pulse(ph, at, w) {
  let d = ph - at;
  d -= Math.round(d);
  return Math.exp(-(d * d) / (w * w));
}

// How far through its stance a foot is: from s1 (it came down) round to s0
// (it lifts), wrapping.
function stance(ph, s1, s0) {
  const len = (s0 - s1 + 1) % 1 || 1;
  return ((ph - s1 + 1) % 1) / len;
}

function crossed(a, b, at) {
  if (b >= a) return a < at && b >= at;
  return a < at || b >= at;
}

function impulse(t, freq, zeta, delay) {
  t -= delay;
  if (t <= 0) return 0;
  const w = TAU * freq, r = Math.sqrt(1 - zeta * zeta);
  if (t * zeta * w > 8) return 0;
  const peak = r * Math.exp((-zeta / r) * Math.atan(r / zeta));
  return (Math.exp(-zeta * w * t) * Math.sin(w * r * t)) / peak;
}

// Turn a bone so its rest offset to the next joint (bind space: every bone's
// bind turn is none) points along dir (root space).
const _ap = new THREE.Vector3();
const _as = new THREE.Vector3();
const _aq = new THREE.Quaternion();
function aimTo(bone, rest, dir) {
  bone.parent.matrixWorld.decompose(_ap, _aq, _as);
  _qd.setFromUnitVectors(_ap.copy(rest).normalize(), _as.copy(dir).normalize());
  _aq.invert();
  bone.quaternion.copy(_aq).multiply(_qd);
}
