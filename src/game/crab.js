import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCharacterMaterials, makeEnvUniforms, makeCrabGlassMaterial } from '../render/shaders.js';
import { palette, bodyGeometry } from './kit.js';
import { TAU, clamp, smooth, Spring } from './rig.js';
import { CastShadow } from '../render/caster.js';
import { Dust } from './dust.js';

// Shoal, the giant opal crab who runs with you: the body and how it moves.
// A broad, softly rounded crab knee-high to the runner at the crown of his
// shell, everything about him grown from translucent opalescent mineral -
// his shell in tiers of plates, eight faceted crystal legs, a little claw
// and one very big one, the big one's middle a window of clear crystal -
// with coral growing out of his shell. Sculpted offline
// (tools/runner/crab.py) and drawn with the runners' illustrated shader
// (CRAB in CHAR_DETAIL); the window in his claw by a pass of its own, after
// him, see-through (FS_CRAB_GLASS).
//
// Nothing here decides where he goes - that's his mind (scuttler.js, built
// on the runners' companion.js), which hands him a place in the world, how
// fast he's moving, what he's doing, the world he's in, and the things he
// does on purpose (a curious tilt, a wave, a smash of his claw). This module
// turns that into:
//   - the scuttle: his eight legs in two sets of four - the front and third
//     on one side with the second and fourth on the other - each set planted
//     while the other swings through, a little wave rippling front to back
//     along each side; every foot placed by a two-bone reach (the knee bowed
//     up and out). His shell rides the steps in a gentle bob, rocking from
//     set to set, leaning a little into his run and his turns;
//   - his face: two eyes on curved stalks that sway on springs as he moves,
//     each glancing about on its own and both turning to whatever he's
//     looking at; blinks; a soft smile (drawn by the shader) that widens and
//     squeezes his eyes up from beneath when he's pleased;
//   - curious tilts: now and then (and whenever he looks at you) he leans his
//     whole shell over to one side, eyes and all, the way a dog cocks its
//     head;
//   - his claws: the big one heavy, resting forward on the road, swinging
//     on a slow spring, its finger working now and then; the little one held
//     up, clicking, and waved when he's happy; a smash (Living Bulldozer):
//     wound back, then swung through across the road and up;
//   - the coral on his back swaying on springs to every lurch;
//   - his colour: each world has his mineral (a palette, WORLDS below): his
//     shell, legs, joints, claws and coral all turn to it as he enters a
//     world - over a couple of seconds, a band of light sweeping up him as
//     it goes - while the window in his claw stays clear, only tinted by it;
//   - glints of opal off his feet as they strike the road; a puff on a
//     landing.

// His colours, by palette slot (see CRAB in shaders.js): the ones every
// world keeps, then each world's mineral over the default (the sheet's own:
// icy aqua opal, coral pink).
const FIXED = {
  7: '#121018', // the eyes
  23: '#3a2430', // his smile
  24: '#ff9fae', // his cheeks
  11: '#000000',
  12: '#000000',
};
const BASE = {
  1: '#a6d4de', // the shell
  2: '#e8e3da', // his pale body and face
  3: '#acd9df', // the leg crystals
  4: '#6f98a6', // the joints
  5: '#d9cbf2', // the claws' casing
  6: '#eaf6f8', // the window's tint
  8: '#ebe6dc', // the eye stalks
  9: '#f39478', // the coral
  10: '#f3f0ea', // the crust round its roots
  13: '#b6f0df', // the play of colour: mint
  14: '#d6b6ff', // lavender
  15: '#ffc6dc', // pink
  16: '#5d8ea2', // deep inside the stone
  17: '#f4fbff', // the veins
  18: '#e4f6fb', // the plates' lit edges
  19: '#ffc4ac', // the coral's tips
  20: '#c25e52', // the coral's pores
  21: '#f2a6d6', // the claws' colour: rose
  22: '#a6c8ff', // and blue
  25: '#c8f4ff', // his glow when he resonates
  30: '#ffffff', // sheen
};
// Each world's mineral, as it differs from his own.
export const WORLDS = {
  village: {},
  conservatory: { 1: '#b8e6d6', 3: '#a8dcc8', 4: '#5f927f', 5: '#e9a7b6', 9: '#e86a7a', 13: '#7fe3c0', 14: '#ffb3c8', 15: '#fff0b0', 16: '#3f8f7a', 19: '#ffb0b8', 21: '#ff8fa8', 22: '#8fe8c8', 25: '#b8ffe0', 6: '#eafaf2' },
  // the Deepwood: moss and amber
  forest: {
    1: '#93b47c', 2: '#e2dcb8', 3: '#9cc08a', 4: '#4f6b3c', 5: '#c2c86e', 6: '#f6eccc', 8: '#dcd6b0', 9: '#cc8a2e', 10: '#e8e2c0',
    13: '#b8e86a', 14: '#ffc24a', 15: '#6fd0a0', 16: '#3e5a2a', 17: '#fff2c0', 18: '#f4f8d0', 19: '#ffd27a', 20: '#6b3e14', 21: '#e8b040', 22: '#8cd85a', 25: '#ffd870', 30: '#fff8d8',
  },
  // Candy World: soft pinks and candy-coloured opal
  candy: {
    1: '#f6c6dc', 2: '#fff0f4', 3: '#f2c0e0', 4: '#c88ab0', 5: '#ffb8d8', 6: '#fff4fa', 8: '#fff0f6', 9: '#ff7eb6', 10: '#fff6fa',
    13: '#ff9ccf', 14: '#b8a8ff', 15: '#9cf0e0', 16: '#c06a98', 17: '#ffffff', 18: '#fff4fa', 19: '#ffd0ea', 20: '#c0407a', 21: '#ff8ac0', 22: '#ffd27e', 25: '#ffc8e8',
  },
  // the Night Rooftops: dusk blues and lamplight
  rooftops: {
    1: '#7484b4', 2: '#d8d0e8', 3: '#7e90c2', 4: '#3c4670', 5: '#9a8ad8', 6: '#e8ecff', 8: '#d8d4e8', 9: '#e07a68', 10: '#d8dcf0',
    13: '#ffc870', 14: '#8aa8ff', 15: '#d090ff', 16: '#2a3360', 17: '#fff0c8', 18: '#f0f0ff', 19: '#ffc890', 20: '#6a2a38', 21: '#ffb860', 22: '#7ab0ff', 25: '#ffd890',
  },
  // the Hall of Doors: emerald and the lamps among the books
  corridor: {
    1: '#a8c89c', 2: '#efe2c8', 3: '#9cc4a0', 4: '#6a5038', 5: '#6ac890', 6: '#f0fff4', 9: '#d8553a', 13: '#58d890', 14: '#ffb060', 15: '#e86a50', 16: '#2f5a40', 17: '#fff4d8', 19: '#ffb080', 21: '#2fd080', 22: '#ffcc66', 25: '#9cffc0',
  },
  // the Sky Road: turquoise, lapis, carnelian and gold
  causeway: {
    1: '#9ad8d0', 2: '#f6ead0', 3: '#a0dcd4', 4: '#c09040', 5: '#e0b848', 6: '#fffaf0', 9: '#e0703a', 13: '#4fd8d0', 14: '#3a6ad8', 15: '#ff9a4a', 16: '#2a5aa0', 17: '#fff8e0', 19: '#ffc070', 21: '#ffd060', 22: '#48c8e0', 25: '#ffe090',
  },
  // Hell: obsidian, lit from within like embers
  hell: {
    1: '#3e3238', 2: '#6a5a58', 3: '#4a3c40', 4: '#241c20', 5: '#5a2a28', 6: '#ffe0c8', 8: '#6a5650', 9: '#ff5a2a', 10: '#5a4a48',
    13: '#ff6a2a', 14: '#ffb040', 15: '#c03060', 16: '#120a0c', 17: '#ff9a50', 18: '#ff8a5a', 19: '#ffc040', 20: '#5a0a00', 21: '#ff4a1a', 22: '#ffaa30', 25: '#ff7a30', 30: '#ffc8a0',
  },
  // the Gallery of Hours: pale gold and heaven's white
  time: {
    1: '#f2e6c8', 2: '#fff8e8', 3: '#f0e2c0', 4: '#b89860', 5: '#f0d080', 6: '#fffaf0', 9: '#f0b080', 13: '#ffe8a0', 14: '#c8d8ff', 15: '#ffd0c0', 16: '#b8a070', 19: '#fff0c8', 21: '#ffd870', 22: '#e8f0ff', 25: '#fff0b8',
  },
  // the Kelp Deep: pearl
  ocean: {
    1: '#a8d8e0', 2: '#f4f0f0', 3: '#a0d0d8', 4: '#3a7a8a', 5: '#e8e0f8', 6: '#e0fff8', 9: '#ff8070', 13: '#90f0e0', 14: '#f0c8f0', 15: '#a0c0ff', 16: '#2a6a80', 19: '#ffd0b8', 21: '#ffd0f0', 22: '#a0f0ff', 25: '#a0fff0',
  },
  // the Blue Hour: cool blues and violet
  coast: {
    1: '#8eaada', 2: '#dcdcf0', 3: '#8ab0e0', 4: '#3c4c80', 5: '#8a78e0', 6: '#e8f0ff', 8: '#dcdaf0', 9: '#d88ab8', 10: '#d8e0f0',
    13: '#7ac0ff', 14: '#a080ff', 15: '#60e0e8', 16: '#1e2a60', 17: '#e0f0ff', 18: '#e8f0ff', 19: '#ffc0e0', 20: '#4a2a6a', 21: '#8a6aff', 22: '#4ab0ff', 25: '#a8c8ff', 30: '#e8f0ff',
  },
  // the Frostbound Pass: ice, and alexandrite
  frost: {
    1: '#d8f0fa', 2: '#f8fcff', 3: '#d0eef8', 4: '#7aa0c0', 5: '#c0d8ff', 6: '#f4fcff', 9: '#f0a0b8', 10: '#ffffff', 13: '#a0e8ff', 14: '#e0d0ff', 15: '#80ffd8', 16: '#6aa0c8', 18: '#ffffff', 19: '#ffffff', 20: '#8a5a7a', 21: '#8ad8ff', 22: '#d0a8ff', 25: '#e0f8ff',
  },
  // the Red Drift: nebula red and starlight
  space: {
    1: '#7c5c8a', 2: '#d8c8d8', 3: '#8a6a98', 4: '#3a2a48', 5: '#c06080', 6: '#f0e8ff', 8: '#d8c8d8', 9: '#ff6a4a', 10: '#c8b8d0',
    13: '#ff6a5a', 14: '#6a8aff', 15: '#ffd070', 16: '#1a1030', 17: '#ffe0f0', 18: '#ffd8e8', 19: '#ffd0a0', 20: '#3a0a20', 21: '#ff5a7a', 22: '#7a6aff', 25: '#ff9ac0',
  },
};
const MORPH = Object.keys(BASE).map(Number);
// his palette in a world, as colours - and laid on thick: every world's
// mineral much more saturated than it's written (INTENSE: how much more, and
// how far its pale tones are pulled down toward the full colour), so he's
// unmistakably the world's own colour wherever you meet him. His window's
// tint and his sheen only a little; his own sheet's colours as they are.
export const INTENSE = { sat: 1.75, lift: 0.14, dark: 0.12 };
const GENTLE = new Set([6, 17, 18, 30]);
const _hsl = {};
const _palCache = {};
function worldPal(id) {
  if (_palCache[id]) return _palCache[id];
  const w = WORLDS[id] || {};
  const out = {};
  for (const k of MORPH) {
    const c = new THREE.Color(w[k] || BASE[k]);
    if (id !== 'village' && WORLDS[id]) {
      c.getHSL(_hsl);
      const g = GENTLE.has(k) ? 0.3 : 1;
      const s = Math.min(1, _hsl.s * (1 + (INTENSE.sat - 1) * g) + INTENSE.lift * g);
      // (pale tones down toward the full colour, dark ones a little up)
      let l = _hsl.l;
      if (l > 0.62) l -= (l - 0.62) * INTENSE.dark * 3 * g;
      c.setHSL(_hsl.h, s, l);
    }
    out[k] = c;
  }
  return (_palCache[id] = out);
}
export const COL = { ...BASE, ...FIXED };

// He's sculpted life-size (a giant of a crab), and drawn smaller: big
// beside the runner, never towering over them.
export const SCALE = 0.68;
// How much bigger he grows for the Living Bulldozer.
export const GROW = 0.5;
// How long his colours take to turn to a new world's (s).
export const MORPH_T = 2.2;

const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _k = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _UP = new THREE.Vector3(0, 1, 0);

// A spring with a force on it (a damped oscillator, semi-implicit: steady at
// any frame time).
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

// (the two sets of legs: the first and third on his right with the second
// and fourth on his left, and the rest)
const SET_A = new Set(['R0', 'R2', 'L1', 'L3']);

export class Crab {
  constructor(env, asset) {
    this.asset = asset;
    this.rig = asset.meta.rig;
    this.u = makeEnvUniforms(env);
    this.root = new THREE.Group();
    this.root.name = 'crab';
    this.buildSkeleton();
    this.buildLook();
    this.buildShadow();
    this.dust = new Dust(this.u, 220);
    this.S = {};
    for (const k of ['bob', 'roll', 'pitch', 'yaw', 'squash', 'tilt', 'clawLift', 'clawSwing', 'clawFinger', 'lilLift', 'lilFinger', 'cAx', 'cAz', 'cBx', 'cBz', 'eLx', 'eLz', 'eRx', 'eRz']) this.S[k] = new Sway();
    this.wS = { run: new Spring(), stand: new Spring(1), sit: new Spring(), air: new Spring() };
    this.w = { run: 0, stand: 1, sit: 0, air: 0 };
    this.low = new Spring();
    this.growS = new Spring();
    // set by his mind: the world he's in (its id), how strongly he
    // resonates (0..1), the bulldozer (0..1: how far grown into it)
    this.world = null;
    this.resonate = 0;
    this.dozer = 0;
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
    const R = this.rig;
    this.legs = Object.entries(R.legs).map(([L, g]) => {
      const hip = new THREE.Vector3().fromArray(g.hip);
      const knee = new THREE.Vector3().fromArray(g.knee);
      const tip = new THREE.Vector3().fromArray(g.tip);
      return {
        L,
        s: g.s,
        i: g.i,
        set: SET_A.has(L) ? 0 : 1,
        // the hip, in the shell's space; the foot where it rests (body space)
        hip: hip.clone().sub(B.shell),
        tip,
        l1: knee.distanceTo(hip),
        l2: tip.distanceTo(knee),
        restK: knee.clone().sub(hip),
        restT: tip.clone().sub(knee),
        out: new THREE.Vector3(tip.x - hip.x, 0, tip.z - hip.z).normalize(),
        foot: tip.clone(),
        lift: 0,
        down: true,
      };
    });
    // the claws: the axis each lifts about (level, across its reach) and its
    // finger's hinge (out of its face)
    this.claws = {};
    for (const S of ['R', 'L']) {
      const c = R.claws[S];
      const sh = new THREE.Vector3().fromArray(c.shoulder);
      const tip = new THREE.Vector3().fromArray(c.tip);
      const reach = tip.clone().sub(sh);
      reach.y = 0;
      reach.normalize();
      this.claws[S] = {
        lift: new THREE.Vector3().crossVectors(reach, _UP).normalize(),
        hinge: new THREE.Vector3().fromArray(c.M[2]).normalize(),
        tip,
      };
    }
  }

  // --- the look ---------------------------------------------------------------------
  buildLook() {
    this.faceU = { value: new THREE.Vector4(1, 0, 0, 0) };
    const E = this.rig.eyes.R.eye;
    this.eyeU = { value: new THREE.Vector4(E[0], E[1], E[2], this.rig.eyeR) };
    this.crabU = { value: new THREE.Vector4(0, 0, 0, 0) };
    this.pal = palette(COL);
    const mats = makeCharacterMaterials(this.u, this.pal, [], 0.008, null, { style: 'crab', uniforms: { uFace: this.faceU, uEye: this.eyeU, uCrab: this.crabU } });
    this.mat = mats.mat;
    this.inkMat = mats.ink;
    this.glassMat = makeCrabGlassMaterial(this.mat.uniforms);
    const geo = bodyGeometry(this.asset);
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.inkMesh = new THREE.SkinnedMesh(geo, this.inkMat);
    this.glassMesh = new THREE.SkinnedMesh(geo, this.glassMat);
    for (const m of [this.mesh, this.inkMesh, this.glassMesh]) {
      m.frustumCulled = false;
      m.renderOrder = -20;
      this.root.add(m);
    }
    this.glassMesh.renderOrder = 6;
    this.root.updateMatrixWorld(true);
    this.mesh.bind(this.skeleton);
    this.inkMesh.bind(this.skeleton, this.mesh.bindMatrix);
    this.glassMesh.bind(this.skeleton, this.mesh.bindMatrix);
    // his colours now, and what they're turning from and to
    this.palFrom = {};
    this.palNow = {};
    for (const k of MORPH) {
      this.palFrom[k] = new THREE.Color(BASE[k]);
      this.palNow[k] = new THREE.Color(BASE[k]);
    }
    this.palTo = worldPal('village');
    this.morphT = MORPH_T;
    this.shownWorld = null;
  }

  buildShadow() {
    this.cast = new CastShadow(this.u, { res: 192 });
    this.shadow = this.cast.mesh;
  }

  renderShadow(renderer) {
    if (this.cast.casters.length === 0) this.cast.setCasters([this.root]);
    // (the window's too faint to throw much of a shadow: leave it out)
    this.glassMesh.visible = false;
    this.cast.render(renderer);
    this.glassMesh.visible = true;
  }

  get objects() {
    return [this.root, this.shadow, this.dust.points];
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
    this.snapT = 9;
    this.blinkT = 2;
    this.blink = 0;
    this.lookAt = null;
    this.lookW = 0;
    this.spin = 0;
    this.lat = 0;
    this.curl = 0;
    this.crouch = 0;
    this.tiltT = 3;
    this.tiltDir = 1;
    this.tiltAmt = 0;
    this.tiltK = 0;
    this.tiltAt = -9;
    this.tiltDur = 1;
    this.waveT = 9;
    this.clickT = 2;
    this.click = 0;
    this.fingerT = 3;
    this.finger = 0;
    this.glance = [{ x: 0, y: 0, tx: 0, ty: 0, t: 1 }, { x: 0, y: 0, tx: 0, ty: 0, t: 1.4 }];
    this.smashT = 9;
    this.smashDir = 1;
    this.vel = new THREE.Vector3();
    this.velS = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.accL = new THREE.Vector3();
    this.ready = false;
    this.prevYaw = null;
    this.yawRate = 0;
    this.lastDt = 0;
    this.stepped = [false, false];
    this.resonate = 0;
    this.dozer = 0;
    this.grow = 0;
    // (how far he's turned side on to the way he's going: his mind sets it)
    this.crabwise = 0;
    for (const k in this.wS) this.wS[k].reset(k === 'sit' ? 1 : 0);
    for (const s of Object.values(this.S)) s.reset();
    this.low.reset();
    this.growS.reset();
    this.dust?.clear();
    this.root.visible = true;
  }

  // --- the frame ----------------------------------------------------------------------
  // ctx (as the fox's): { speed: m/s over the ground, vel: world velocity,
  // mode: 'run' | 'air' | 'sit' | 'stand', airT / airDur / airKind while in
  // the air, fall: his gravity while falling, lat: sideways speed, crouch:
  // 0..1 winding up for a jump }
  update(dt, ctx) {
    this.time += dt;
    this.lastDt += dt;
    const t = this.time;
    this.speed = ctx.speed;
    this.mode = ctx.mode === 'ride' ? 'stand' : ctx.mode;
    this.lat = ctx.lat || 0;
    this.crouch = ctx.crouch || 0;
    if (ctx.vel) {
      if (!this.ready) this.velS.copy(ctx.vel);
      _v.copy(this.velS);
      this.velS.lerp(ctx.vel, 1 - Math.exp(-dt * 30));
      if (dt > 0) this.acc.subVectors(this.velS, _v).divideScalar(dt).clampLength(0, 80);
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
    this.snapT += dt;
    this.smashT += dt;
    const yaw = this.rootYaw();
    if (this.prevYaw !== null && dt > 0) {
      let d = yaw - this.prevYaw;
      d -= TAU * Math.round(d / TAU);
      this.yawRate += (d / dt - this.yawRate) * (1 - Math.exp(-dt * 20));
    }
    this.prevYaw = yaw;
    // the scuttle: quick little steps, quicker the faster he goes (his feet
    // can't keep up with a sprint stride for stride - they patter)
    const run = this.mode === 'run';
    this.freq = clamp(1.4 + 0.2 * this.speed, 1.6, 5.2) * (1 - 0.25 * this.dozer);
    const ph0 = this.phase;
    this.phase = (this.phase + dt * (run ? this.freq : 0)) % 1;
    this.stepped = run ? [crossed(ph0, this.phase, 0.25), crossed(ph0, this.phase, 0.75)] : [false, false];

    // blinks (both eyes together, mostly; now and then one a beat behind)
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.16;
      this.blinkT = 2 + Math.random() * 4.5;
    }
    this.blink = Math.max(0, this.blink - dt);
    const bl = this.blink > 0 ? Math.sin((this.blink / 0.16) * Math.PI) : 0;
    this.faceU.value.set(clamp(1 - bl * 1.25, 0, 1) * (1 - 0.25 * clamp(this.earBias, 0, 1)), clamp(this.happy * 0.85 + this.wag * 0.15, 0, 1), 0, this.dozer);

    // curious tilts: every so often (and when he looks at something) his
    // whole shell leans over to one side and back, slow
    this.tiltT -= dt;
    if (this.tiltT <= 0) {
      this.tiltT = 3.5 + Math.random() * 5;
      this.tiltNow(Math.random() < 0.5 ? -1 : 1, 0.6 + Math.random() * 0.4);
    }
    const tk = clamp((t - this.tiltAt) / this.tiltDur, 0, 1);
    this.tiltAmt = this.tiltDir * Math.sin(Math.PI * tk) ** 0.7 * this.tiltK * (tk < 1 ? 1 : 0);

    // his colours: turning to the world he's in
    this.colours(dt);
    this.animate(dt, t);
  }

  // A curious tilt toward dir (-1 his left, +1 his right), of strength k.
  tiltNow(dir, k = 1) {
    if (this.time - this.tiltAt < this.tiltDur * 0.8) return;
    this.tiltDir = dir;
    this.tiltK = k;
    this.tiltAt = this.time;
    this.tiltDur = 1.3 + Math.random() * 0.7;
  }

  // A wave of his little claw (happy to see you).
  wave() {
    this.waveT = 0;
  }

  // His big claw swung through (dir: +1 sweeping to his left, across the
  // road from his right, -1 back).
  smash(dir = 1) {
    this.smashT = 0;
    this.smashDir = dir;
  }

  rootYaw() {
    _v.set(0, 0, -1).applyQuaternion(this.root.quaternion);
    return Math.atan2(-_v.x, -_v.z);
  }

  land(k = 1) {
    this.landClock = 0;
    this.landHit = k;
    this.landed = true;
  }

  // A gem caught (in his little claw).
  snap() {
    this.snapT = 0;
    this.click = 1;
  }

  flick(i) {
    if (i === 0) this.click = 1;
    else this.finger = Math.max(this.finger, 0.6);
  }

  // --- his colour -------------------------------------------------------------------
  colours(dt) {
    const want = this.world || 'village';
    if (want !== this.shownWorld) {
      const first = this.shownWorld === null;
      for (const k of MORPH) this.palFrom[k].copy(this.palNow[k]);
      this.palTo = worldPal(want);
      this.morphT = first ? MORPH_T : 0;
      this.shownWorld = want;
    }
    this.morphT += dt;
    const k = smooth(0, MORPH_T, this.morphT);
    // (the new colour climbs him from his feet: what's low turns first - the
    // sweep in the shader shows where it's got to; here it's eased over all
    // of him)
    for (const s of MORPH) {
      this.palNow[s].copy(this.palFrom[s]).lerp(this.palTo[s], k);
      this.pal[s].copy(this.palNow[s]);
    }
    const sweep = clamp(this.morphT / (MORPH_T * 0.8), 0, 1.3);
    // resonating: the pulse's phase runs on
    this.resPh = ((this.resPh || 0) + dt * (0.9 + 0.6 * this.resonate)) % 1;
    this.crabU.value.set(this.resonate, this.resPh, sweep, this.morphT < MORPH_T * 1.05 ? 1 - smooth(MORPH_T * 0.7, MORPH_T * 1.05, this.morphT) : 0);
  }

  // --- moving ---------------------------------------------------------------------------
  animate(dt, t) {
    const m = this.mode;
    const W = this.wS;
    let tr = 0, ts = 0, tsit = 0, ta = 0;
    if (m === 'run') {
      const k = smooth(0.3, 1.6, this.speed);
      tr = k;
      ts = 1 - k;
    } else if (m === 'air') ta = 1;
    else if (m === 'sit') tsit = 1;
    else ts = 1;
    const w = this.w;
    w.run = Math.max(0, W.run.step(tr, 5, 0.9, dt));
    w.stand = Math.max(0, W.stand.step(ts, 4, 0.9, dt));
    w.sit = Math.max(0, W.sit.step(tsit, 2.2, 0.95, dt));
    w.air = Math.max(0, W.air.step(ta, 8, 0.85, dt));
    const tot = w.run + w.stand + w.sit + w.air || 1;
    const run = w.run / tot, sit = w.sit / tot, air = w.air / tot;
    const low = this.low.step(this.lowTarget || 0, 3.2, 0.9, dt);
    this.grow = clamp(this.growS.step(this.dozer, 1.6, 0.75, dt), 0, 1.15);
    const S = this.S;
    const b = this.b;
    const ph = this.phase * TAU;
    const sp = clamp(this.speed / 20, 0, 1.3);
    _qi.copy(this.root.quaternion).invert();
    const acc = this.accL.copy(this.acc).applyQuaternion(_qi);

    // --- the shell: riding the steps ---
    // (a bob on every plant - twice a stride, one set then the other - and a
    // rock from one set to the other; a slow breath when he's still)
    const bob = run * (0.018 + 0.016 * Math.min(sp, 1)) * Math.abs(Math.sin(ph)) + (1 - run) * 0.006 * Math.sin(t * 1.7);
    const rockT = run * 0.045 * Math.sin(ph) + 0.03 * this.wag * Math.sin(t * 7);
    const tiltR = this.tiltAmt * 0.22;
    const roll = S.roll.step(rockT + tiltR, 2.4, 0.35, -acc.x * 0.012, dt);
    const pitchT = run * (0.035 + 0.035 * Math.min(sp, 1)) + clamp(-acc.z * 0.006, -0.12, 0.12) - 0.05 * sit + this.tiltAmt * 0.04 + 0.08 * this.grow * run;
    const pitch = S.pitch.step(pitchT, 2, 0.4, 0, dt);
    // where he's looking: his shell turns a little toward it
    const lk = this.lookAt ? clamp(Math.atan2(-this.lookAt.x, -this.lookAt.z), -0.6, 0.6) * this.lookW : 0;
    // (a smash throws his whole body into it)
    const sm = this.smashT < 0.9 ? this.smashT : 9;
    const smashBody = sm < 0.9 ? this.smashDir * (sm < 0.18 ? -0.2 * smooth(0, 0.18, sm) : 0.3 * Math.sin(Math.PI * clamp((sm - 0.18) / 0.6, 0, 1))) : 0;
    const yaw = S.yaw.step(lk * 0.45 + smashBody * 0.7 + run * 0.04 * Math.sin(ph * 0.5), 2.6, 0.55, 0, dt);
    // squash: down into a wind-up and a landing
    const cr = this.crouch;
    const ce = cr * cr * (3 - 2 * cr);
    let sq = -0.08 * ce - 0.03 * sit;
    if (this.landHit > 0 && this.landClock < 1.2) sq -= 0.1 * this.landHit * impulse(this.landClock, 4, 0.35, 0);
    const squash = S.squash.step(sq, 5, 0.4, 0, dt);
    const sy = 1 + squash, sxz = 1 / Math.sqrt(Math.max(0.5, sy));
    b.shell.scale.set(sxz, sy, sxz);
    _e.set(pitch, yaw, -roll - smashBody * 0.25, 'YXZ');
    b.shell.quaternion.setFromEuler(_e);
    b.shell.position.copy(this.rest.shell);
    // (low: he flattens himself under a bar; sitting, he settles onto the
    // road; in the air he tucks his legs up under him)
    b.shell.position.y += bob - 0.12 * sit - 0.28 * low - 0.05 * ce - 0.03 * air;
    this.lowNow = low;
    b.shell.position.x += -roll * 0.05;
    this.root.matrixWorld.identity();
    this.body.updateWorldMatrix(false, true);

    this.legsStep(dt, t, run, air, sit, low, sp);
    this.clawsStep(dt, t, run, air, sit, acc, sm);
    this.eyesStep(dt, t, run, acc);
    this.coralStep(dt, acc, low);
    this.body.updateWorldMatrix(false, true);
    this.feet(dt, run);
    this.landed = false;
  }

  // His legs: each foot planted while its set carries him, then lifted and
  // swung through; a two-bone reach to it, the knee bowed up and out.
  legsStep(dt, t, run, air, sit, low, sp) {
    const b = this.b;
    const shell = b.shell;
    // (his stride: as long as he can take; his feet slide a little at a
    // sprint - they patter)
    const amp = clamp(this.speed / (4 * this.freq), 0, 0.15) * run;
    const p = clamp(this.airT / Math.max(0.05, this.airDur), 0, 1);
    for (const g of this.legs) {
      // the set's phase, a little later down each side (a ripple front to
      // back), quarter strides apart
      const ph = (this.phase + g.set * 0.5 + g.i * 0.07) % 1;
      const a = TAU * ph;
      const swing = Math.cos(a);
      const up = Math.max(0, Math.sin(a));
      const hip = _p.copy(g.hip).applyMatrix4(shell.matrix);
      const foot = _t.copy(g.tip);
      // (the stride runs the way he's going over the ground: straight back
      // under him as he runs forward, across under him when he runs
      // crabwise - see crabwise)
      foot.x -= Math.sin(this.crabwise || 0) * amp * swing;
      foot.z += Math.cos(this.crabwise || 0) * amp * swing;
      foot.y += (0.05 + 0.25 * amp) * up * up * run;
      // (crossing the road: his feet reach the way he's going)
      foot.x += clamp(this.lat * 0.03, -0.12, 0.12) * up;
      // sitting: splayed out, settled; ducking: splayed wide to let him down
      foot.addScaledVector(g.out, 0.06 * sit + 0.16 * low);
      // in the air: tucked up under him, toes down, paddling a little
      if (air > 0.01) {
        _v2.copy(g.tip).sub(_v.copy(g.hip).add(this.bind.shell)).multiplyScalar(0.55);
        _v2.add(hip);
        _v2.y = hip.y - 0.22 + 0.04 * Math.sin(t * 18 + g.i + g.s);
        foot.lerp(_v2, air);
      }
      foot.y = Math.max(foot.y, 0);
      g.lift = foot.y;
      const wasDown = g.down;
      g.down = foot.y < 0.012 && air < 0.5;
      g.struck = !wasDown && g.down;
      g.foot.copy(foot);
      this.reach(g, hip, foot);
    }
  }

  // Two bones from the hip to the foot: the knee found where both reach,
  // bowed up and out from the line between them.
  reach(g, hip, foot) {
    const b = this.b;
    const leg = b['leg' + g.L];
    const knee = b['knee' + g.L];
    leg.position.copy(hip);
    _v.subVectors(foot, hip);
    let d = _v.length();
    const l1 = g.l1, l2 = g.l2;
    d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    _v.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    // the bow: up, and out the way the leg points
    _v2.copy(_UP).addScaledVector(g.out, 0.35);
    _v2.addScaledVector(_v, -_v2.dot(_v)).normalize();
    _k.copy(hip).addScaledVector(_v, a).addScaledVector(_v2, h);
    aim(leg, g.restK, _s.subVectors(_k, hip));
    leg.updateMatrixWorld(true);
    // (the foot, measured from where the knee really is)
    _v3.copy(foot).sub(_k);
    aim(knee, g.restT, _v3);
  }

  // The claws. The big one heavy on a slow spring, resting forward on the
  // road, nodding along with his steps; its finger working now and then. The
  // little one held up, clicking; waved when he's pleased.
  clawsStep(dt, t, run, air, sit, acc, sm) {
    const b = this.b;
    const S = this.S;
    const ph = this.phase * TAU;
    // a smash: drawn back and up, then swung through across the road and up
    let smashLift = 0, smashSwing = 0, smashOpen = 0;
    if (sm < 0.9) {
      const d = this.smashDir;
      if (sm < 0.18) {
        const k = smooth(0, 0.18, sm);
        smashLift = 0.45 * k;
        smashSwing = -0.5 * d * k;
        smashOpen = 0.6 * k;
      } else {
        const k = clamp((sm - 0.18) / 0.42, 0, 1);
        const e = 1 - (1 - k) ** 3;
        smashLift = 0.45 + 0.25 * Math.sin(Math.PI * e) - 0.45 * e;
        smashSwing = d * (-0.5 + 1.45 * e) * (1 - smooth(0.6, 0.9, sm));
        smashOpen = 0.6 * (1 - e);
      }
    }
    // (the bulldozer: held up off the road, ready, swaying)
    const ready = this.grow;
    const liftT = run * 0.05 * Math.sin(ph + 0.6) + 0.18 * air + 0.1 * this.happy * Math.sin(t * 3) * 0.3 + ready * (0.22 + 0.06 * Math.sin(t * 4)) + smashLift - 0.04 * sit;
    const lift = S.clawLift.step(liftT, 2.2, 0.32, -acc.y * 0.03, dt);
    const swing = S.clawSwing.step(smashSwing + ready * 0.12 * Math.sin(t * 2.2), smashSwing ? 6 : 1.8, 0.5, -acc.x * 0.01 - this.yawRate * 0.05, dt);
    // its finger: opening a little now and then, wide when he's surprised
    this.fingerT -= dt;
    if (this.fingerT <= 0) {
      this.fingerT = 2 + Math.random() * 5;
      this.finger = 0.35 + Math.random() * 0.4;
    }
    this.finger = Math.max(0, this.finger - dt * 0.9);
    const fo = S.clawFinger.step(Math.max(Math.sin(Math.PI * clamp(this.finger / 0.75, 0, 1)) * 0.35, smashOpen, 0.25 * clamp(this.earBias, 0, 1)), 4, 0.5, 0, dt);
    const R = this.claws.R;
    _q.setFromAxisAngle(R.lift, clamp(lift, -0.2, 0.9));
    _q2.setFromAxisAngle(_UP, swing);
    b.armR.quaternion.copy(_q2).multiply(_q);
    // (the forearm bends a little with it, so the claw stays level-ish)
    _q.setFromAxisAngle(R.lift, -clamp(lift, -0.2, 0.9) * 0.45);
    b.handR.quaternion.copy(_q);
    b.fingerR.quaternion.setFromAxisAngle(R.hinge, clamp(fo, -0.05, 0.75));

    // the little one: up, clicking; a wave
    this.waveT += dt;
    const wv = this.waveT < 1.4 ? Math.sin(Math.PI * (this.waveT / 1.4)) : 0;
    this.clickT -= dt;
    if (this.clickT <= 0) {
      this.clickT = 1.2 + Math.random() * 3.5;
      if (Math.random() < 0.6) this.click = 1;
    }
    this.click = Math.max(0, this.click - dt * 5);
    const L = this.claws.L;
    const lT = 0.05 + 0.05 * run * Math.sin(ph + 2) + 0.35 * wv + 0.15 * air + 0.12 * this.happy - 0.1 * sit + 0.25 * clamp(this.jawOpen, 0, 1);
    const ll = S.lilLift.step(lT, 3, 0.35, -acc.y * 0.04, dt);
    _q.setFromAxisAngle(L.lift, -clamp(ll, -0.3, 0.9));
    _q2.setFromAxisAngle(_UP, wv * 0.35 * Math.sin(this.waveT * 14));
    b.armL.quaternion.copy(_q2).multiply(_q);
    const lf = S.lilFinger.step(Math.max(Math.sin(Math.PI * this.click) * 0.6, 0.4 * wv * (0.5 + 0.5 * Math.sin(this.waveT * 18)), 0.55 * clamp(this.jawOpen, 0, 1)), 6, 0.4, 0, dt);
    b.fingerL.quaternion.setFromAxisAngle(L.hinge, -clamp(lf, -0.05, 0.8));
  }

  // His eyes on their stalks: swaying on springs as he moves (thrown back as
  // he speeds up, out on a turn), each glancing about on its own, both
  // turning to whatever he's looking at.
  eyesStep(dt, t, run, acc) {
    const b = this.b;
    const S = this.S;
    const look = this.lookAt;
    let lx = 0, ly = 0;
    if (look && this.lookW > 0.01) {
      lx = clamp(Math.atan2(-look.x, -look.z), -0.9, 0.9) * this.lookW;
      ly = clamp(Math.atan2(look.y - 0.7, Math.hypot(look.x, look.z)), -0.5, 0.6) * this.lookW;
    }
    ['L', 'R'].forEach((E, i) => {
      const gl = this.glance[i];
      gl.t -= dt;
      if (gl.t <= 0) {
        // (a glance somewhere: quick there, then a while looking)
        gl.t = 0.6 + Math.random() * 2.2;
        gl.tx = (Math.random() - 0.5) * 0.8;
        gl.ty = (Math.random() - 0.4) * 0.4;
        if (Math.random() < 0.5) {
          // (and mostly both eyes go together)
          const o = this.glance[1 - i];
          o.tx = gl.tx + (Math.random() - 0.5) * 0.15;
          o.ty = gl.ty;
          o.t = Math.max(o.t, 0.4);
        }
      }
      gl.x += (gl.tx - gl.x) * (1 - Math.exp(-dt * 14));
      gl.y += (gl.ty - gl.y) * (1 - Math.exp(-dt * 14));
      const w = 1 - this.lookW;
      const sx = S['e' + E + 'x'].step(-0.1 * run, 3.2, 0.25, acc.z * 0.05 - acc.y * 0.04, dt);
      const sz = S['e' + E + 'z'].step(0, 3.2, 0.25, acc.x * 0.05 + this.yawRate * 0.06, dt);
      // the stalk leans (toward the look a little; out when he tilts)
      _e.set(clamp(sx + ly * 0.3, -0.5, 0.5), (lx * 0.4 + gl.x * 0.3 * w), clamp(-sz + this.tiltAmt * 0.1 + (i ? -1 : 1) * 0.04 * this.happy, -0.5, 0.5), 'YXZ');
      b['stalk' + E].quaternion.setFromEuler(_e);
      // the eye turns to look
      _e.set(clamp(ly * 0.7 + gl.y * w, -0.6, 0.6), clamp(lx * 0.8 + gl.x * w, -0.9, 0.9), 0, 'YXZ');
      b['eye' + E].quaternion.setFromEuler(_e);
    });
  }

  // The coral swaying on his back (and laid back flat along his shell when
  // he flattens himself under a bar: it's living coral, it gives).
  coralStep(dt, acc, low) {
    const b = this.b;
    const S = this.S;
    for (const [C, k] of [['A', 1], ['B', 1.2]]) {
      const x = S['c' + C + 'x'].step(0, 2.6 / k, 0.18, (acc.z * 0.03 + acc.y * 0.01) * k, dt);
      const z = S['c' + C + 'z'].step(0, 2.6 / k, 0.18, (-acc.x * 0.03 - this.yawRate * 0.04) * k, dt);
      b['coral' + C].rotation.set(clamp(x * 0.5, -0.3, 0.3) + 1.15 * low, 0, clamp(z * 0.5, -0.3, 0.3) * (1 - low));
    }
  }

  // His feet striking the road: a glint of opal off each crystal point now
  // and then, a puff; a spray of glints and a puff under every foot when he
  // lands.
  feet(dt, run) {
    if (dt <= 0) return;
    for (const g of this.legs) {
      if (this.landed) {
        _p.copy(g.foot);
        _p.y = 0.04;
        _v.set(g.out.x * 0.8, 0.5, g.out.z * 0.8);
        this.emit(_p, _v, 0.32 + 0.1 * this.landHit, 0, 0.55, 0.9, 1.1);
        _v.set(g.out.x * (0.5 + Math.random()), 1 + Math.random() * 1.4, g.out.z * (0.5 + Math.random()));
        this.emit(_p, _v, 0.05 + 0.02 * Math.random(), 7);
        continue;
      }
      if (!g.struck || run < 0.3) continue;
      if (Math.random() < 0.35) {
        _p.copy(g.foot);
        _p.y = 0.03;
        _v.set(g.out.x * 0.4, 0.4, 0.4);
        this.emit(_p, _v, 0.2 + 0.08 * Math.random(), 0, 0.4, 0.7, 0.9);
      }
      if (Math.random() < 0.25 + 0.3 * this.resonate) {
        _p.copy(g.foot);
        _p.y = 0.04;
        _v.set(g.out.x * (0.3 + Math.random() * 0.6), 0.9 + Math.random() * 1.3, 0.4 + Math.random() * 0.6);
        this.emit(_p, _v, 0.035 + 0.025 * Math.random(), 7);
      }
    }
  }

  emit(p, v, size, kind, alpha = -1, life = 1, grow = 1) {
    this.dust.emit(p.multiplyScalar(this.scale || SCALE), v, size, kind, alpha, life, grow);
  }

  after(z, dist, lowG = false) {
    this.dust.g = lowG ? 6 : 16;
    this.dust.update(this.lastDt, this.root, z, dist);
    this.lastDt = 0;
  }

  // Where the tip of his big claw is in the world (for what it strikes).
  clawTip(out) {
    // (the tip, carried by the hand - its bind position through the hand's
    // skinning, built from the bones' own matrices so it holds whenever it's
    // asked - then out into the world)
    const b = this.b;
    out.copy(this.claws.R.tip).sub(this.bind.handR);
    out.applyMatrix4(b.handR.matrix).applyMatrix4(b.armR.matrix).applyMatrix4(b.shell.matrix);
    this.root.updateMatrix();
    return out.applyMatrix4(this.root.matrix);
  }

  // --- placing him in the world ---------------------------------------------------------
  place(pos, q, ground = 0, shadow = 1) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    this.scale = SCALE * (1 + GROW * this.grow);
    this.root.scale.setScalar(this.scale);
    if (this.spin) {
      _q.setFromAxisAngle(_UP, this.spin);
      this.root.quaternion.multiply(_q);
    }
    const h = Math.max(0, pos.y - ground);
    const r = 1.25 * this.scale;
    this.cast.aim(pos.x - r, pos.x + r, pos.y - 0.05, pos.y + 1.35 * this.scale, pos.z - r * 1.15, pos.z + r, ground, pos.x, pos.z, {
      alpha: 0.95 * clamp(1 - h * 0.2, 0.5, 1) * shadow,
      contact: 0.4 * clamp(1 - h * 3, 0, 1) * shadow,
      reach: 0.22,
    });
  }

  forCompile(on) {
    this.root.visible = true;
    this.shadow.visible = on;
    this.dust.forCompile(on);
  }
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

// Aim a bone so its rest offset to the next joint (rest, its parent's
// frame at bind) points along dir (in the root's space).
const _ap = new THREE.Vector3();
const _as = new THREE.Vector3();
const _ar = new THREE.Vector3();
const _ad = new THREE.Vector3();
const _aq = new THREE.Quaternion();
const _aq2 = new THREE.Quaternion();
const _aqd = new THREE.Quaternion();
function aim(bone, rest, dir) {
  _ad.copy(dir).normalize();
  bone.parent.matrixWorld.decompose(_ap, _aq, _as);
  _ar.copy(rest).normalize().applyQuaternion(_aq);
  _aqd.setFromUnitVectors(_ar, _ad);
  _aq2.copy(_aq).invert();
  bone.quaternion.copy(_aq2).multiply(_aqd).multiply(_aq);
}
