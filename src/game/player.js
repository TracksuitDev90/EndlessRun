import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { P, part, merge } from '../render/geo.js';
import { makeEnvUniforms, makeToonMaterial, makeInkMaterial } from '../render/shaders.js';

// The runner: a boy in a bright orange coat, built from simple shapes and
// animated procedurally (run cycle, jump tuck, feet-first slide, stumble,
// fall). Also owns lane/jump/slide movement.

const COL = {
  coat: '#ff7a1c',
  coatDark: '#e0561a',
  skin: '#f3c4a0',
  hair: '#3b2417',
  pants: '#2b3558',
  shoe: '#5a3220',
  sole: '#f2e8d4',
  scarf: '#1d7090',
  stripe: '#5fb6c8',
  strap: '#6b3f1f',
  bag: '#8a5a2c',
};

// pose channels
const K = {
  hipsY: 0, hipsYaw: 1, lean: 2, twist: 3, headPitch: 4, headYaw: 5,
  shL: 6, shR: 7, shLz: 8, shRz: 9, elL: 10, elR: 11,
  thL: 12, thR: 13, knL: 14, knR: 15, thLz: 16, thRz: 17,
  scarf: 18, bodyPitch: 19, bodyZ: 20,
};
const N = 21;
const STAND_Y = 0.765;

const G = (8 * CONFIG.jump.height) / (CONFIG.jump.time * CONFIG.jump.time);
const V0 = (4 * CONFIG.jump.height) / CONFIG.jump.time;

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class Player {
  constructor(envDef) {
    this.u = makeEnvUniforms(envDef);
    this.mat = makeToonMaterial(this.u, {});
    this.inkMat = makeInkMaterial(this.mat, 0.03);
    this.root = new THREE.Group();
    this.root.name = 'player';
    this.buildRig();
    this.buildShadow();

    this.pose = new Float32Array(N);
    this.pRun = new Float32Array(N);
    this.pJump = new Float32Array(N);
    this.pSlide = new Float32Array(N);
    this.pIdle = new Float32Array(N);
    this.pCrash = new Float32Array(N);
    this.w = { run: 0, jump: 0, slide: 0, idle: 1 };
    this.reset();
  }

  // --- model ----------------------------------------------------------------
  addMesh(parent, geo) {
    for (const mat of [this.mat, this.inkMat]) {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = -20;
      m.frustumCulled = false;
      parent.add(m);
    }
  }

  buildRig() {
    const g = (name, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Group();
      o.name = name;
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    this.body = g('body', this.root);
    this.hips = g('hips', this.body, 0, STAND_Y, 0);
    this.torso = g('torso', this.hips);
    this.head = g('head', this.torso, 0, 0.43, 0);
    this.shoulderL = g('shoulderL', this.torso, -0.19, 0.33, 0);
    this.shoulderR = g('shoulderR', this.torso, 0.19, 0.33, 0);
    this.elbowL = g('elbowL', this.shoulderL, 0, -0.25, 0);
    this.elbowR = g('elbowR', this.shoulderR, 0, -0.25, 0);
    this.scarfTail = g('scarf', this.torso, 0.035, 0.43, 0.1);
    this.thighL = g('thighL', this.hips, -0.095, -0.02, 0);
    this.thighR = g('thighR', this.hips, 0.095, -0.02, 0);
    this.kneeL = g('kneeL', this.thighL, 0, -0.34, 0);
    this.kneeR = g('kneeR', this.thighR, 0, -0.34, 0);

    const coat = [
      [0, -0.26], [0.255, -0.26], [0.238, -0.14], [0.206, -0.02], [0.19, 0.08],
      [0.205, 0.2], [0.2, 0.3], [0.165, 0.37], [0.1, 0.415], [0, 0.425],
    ];
    this.addMesh(this.torso, merge([
      part(P.lathe(coat, 14), null, { sz: 0.8, grad: [COL.coatDark, COL.coat, -0.26, 0.35] }),
      part(P.cyl(0.198, 0.2, 0.05, 14), COL.coatDark, { y: 0.03, sz: 0.8, outline: 0.6 }),
      part(P.sphere(0.13, 10, 8), COL.coatDark, { y: 0.32, z: 0.12, sx: 1.15, sy: 0.72, sz: 0.55 }),
      part(P.cyl(0.095, 0.105, 0.08, 12), COL.coatDark, { y: 0.42 }),
      part(P.torus(0.088, 0.042, 6, 14), COL.scarf, { y: 0.45, rx: Math.PI / 2 }),
      part(P.box(0.045, 0.6, 0.025), COL.strap, { y: 0.1, z: 0.168, rz: 0.62, outline: 0.6 }),
      part(P.box(0.2, 0.17, 0.08), COL.bag, { x: 0.2, y: -0.1, z: 0.1, ry: -0.5 }),
      part(P.box(0.21, 0.045, 0.086), COL.strap, { x: 0.2, y: -0.025, z: 0.1, ry: -0.5, outline: 0.6 }),
    ]));
    this.addMesh(this.head, merge([
      part(P.cyl(0.05, 0.056, 0.1, 8), COL.skin, { y: 0.02 }),
      part(P.sphere(0.152, 14, 12), COL.skin, { y: 0.15, z: -0.012 }),
      part(P.sphere(0.162, 14, 12), COL.hair, { y: 0.176, z: 0.02, sy: 0.93 }),
      part(P.sphere(0.036, 8, 6), COL.skin, { x: -0.153, y: 0.14, sx: 0.6 }),
      part(P.sphere(0.036, 8, 6), COL.skin, { x: 0.153, y: 0.14, sx: 0.6 }),
      part(P.cone(0.055, 0.13, 6), COL.hair, { y: 0.33, z: 0.04, rx: -0.7 }),
      part(P.cone(0.042, 0.1, 6), COL.hair, { x: 0.06, y: 0.31, z: 0.08, rx: -1.0, rz: -0.4 }),
    ]));
    const upperArm = merge([part(P.capsule(0.056, 0.16, 3, 8), COL.coat, { y: -0.12 })]);
    const forearm = merge([
      part(P.capsule(0.05, 0.12, 3, 8), COL.coat, { y: -0.09 }),
      part(P.cyl(0.058, 0.058, 0.05, 10), COL.coatDark, { y: -0.17, outline: 0.6 }),
      part(P.sphere(0.047, 8, 6), COL.skin, { y: -0.225 }),
    ]);
    this.addMesh(this.shoulderL, upperArm);
    this.addMesh(this.shoulderR, upperArm);
    this.addMesh(this.elbowL, forearm);
    this.addMesh(this.elbowR, forearm);
    const thigh = merge([part(P.capsule(0.074, 0.2, 3, 8), COL.pants, { y: -0.17 })]);
    const shin = merge([
      part(P.capsule(0.063, 0.2, 3, 8), COL.pants, { y: -0.16 }),
      part(P.box(0.115, 0.09, 0.22), COL.shoe, { y: -0.35, z: -0.035 }),
      part(P.sphere(0.058, 8, 6), COL.shoe, { y: -0.35, z: -0.13, sy: 0.8 }),
      part(P.box(0.122, 0.032, 0.25), COL.sole, { y: -0.39, z: -0.05, outline: 0.6 }),
    ]);
    this.addMesh(this.thighL, thigh);
    this.addMesh(this.thighR, thigh);
    this.addMesh(this.kneeL, shin);
    this.addMesh(this.kneeR, shin);
    this.addMesh(this.scarfTail, merge([
      part(P.box(0.1, 0.34, 0.026), COL.scarf, { y: -0.17 }),
      part(P.box(0.103, 0.05, 0.03), COL.stripe, { y: -0.22, outline: 0.5 }),
      part(P.box(0.103, 0.04, 0.03), COL.stripe, { y: -0.29, outline: 0.5 }),
      part(P.box(0.02, 0.06, 0.02), COL.scarf, { x: -0.03, y: -0.37, outline: 0.5 }),
      part(P.box(0.02, 0.06, 0.02), COL.scarf, { x: 0.03, y: -0.37, outline: 0.5 }),
    ]));
  }

  buildShadow() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0.35 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uAlpha; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.25, 1.0, r)) * uAlpha; gl_FragColor = vec4(0.06, 0.03, 0.1, a); }',
      transparent: true,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(geo, mat);
    this.shadow.renderOrder = -19;
    this.shadow.frustumCulled = false;
  }

  // --- state ------------------------------------------------------------------
  reset() {
    this.lane = 1;
    this.prevLane = 1;
    this.x = CONFIG.laneX[1];
    this.vx = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.slideT = 0;
    this.jumpBuffer = 0;
    this.slideQueued = false;
    this.stumbleT = 0;
    this.invulnT = 0;
    this.crashed = false;
    this.crashT = 0;
    this.reviveT = 0;
    this.landT = 0;
    this.phase = 0;
    this.time = 0;
    this.mode = 'idle';
    this.w.run = 0;
    this.w.jump = 0;
    this.w.slide = 0;
    this.w.idle = 1;
    this.root.visible = true;
  }

  get sliding() {
    return this.slideT > 0;
  }

  get height() {
    return this.sliding ? CONFIG.player.slideHeight : CONFIG.player.height;
  }

  action(a) {
    if (this.crashed || this.mode !== 'run') return;
    if (a === 'left' || a === 'right') {
      const next = Math.max(0, Math.min(2, this.lane + (a === 'left' ? -1 : 1)));
      if (next !== this.lane) {
        this.prevLane = this.lane;
        this.lane = next;
      }
    } else if (a === 'up') {
      if (this.grounded) this.jump();
      else this.jumpBuffer = CONFIG.inputBuffer;
    } else if (a === 'down') {
      if (this.grounded) {
        this.slideT = CONFIG.slide.time;
      } else {
        this.vy = Math.min(this.vy, -CONFIG.fastFall);
        this.slideQueued = true;
        this.jumpBuffer = 0;
      }
    }
  }

  jump() {
    this.vy = V0;
    this.grounded = false;
    this.slideT = 0;
    this.slideQueued = false;
    this.jumpBuffer = 0;
  }

  bounceBack() {
    const back = this.prevLane;
    this.prevLane = this.lane;
    this.lane = back;
  }

  // Push sideways out of an obstacle we clipped while changing lanes.
  nudgeAwayFrom(ox) {
    const dir = Math.sign(this.x - ox) || 1;
    const target = Math.max(0, Math.min(2, Math.round((ox + dir * 2.4 - CONFIG.laneX[0]) / 2.4)));
    this.prevLane = this.lane;
    this.lane = target;
  }

  stumble() {
    this.stumbleT = 0.6;
  }

  crash() {
    this.crashed = true;
    this.crashT = 0;
    this.slideT = 0;
    this.vy = Math.max(this.vy, 2.5);
    this.grounded = false;
  }

  revive() {
    this.crashed = false;
    this.reviveT = 0.9;
    this.invulnT = CONFIG.reviveInvulnerable;
    this.vy = 0;
    this.y = 0;
    this.grounded = true;
    this.slideT = 0;
    this.lane = Math.round((this.x - CONFIG.laneX[0]) / 2.4);
    this.prevLane = this.lane;
  }

  update(dt, speed, groundAt) {
    this.time += dt;
    // lanes
    const tx = CONFIG.laneX[this.lane];
    const nx = this.crashed ? this.x : damp(this.x, tx, CONFIG.laneRate, dt);
    this.vx = (nx - this.x) / Math.max(dt, 1e-4);
    this.x = nx;

    // vertical
    const ground = groundAt ? groundAt(this.x) : 0;
    this.groundY = ground;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (!this.grounded) {
      const prevY = this.y;
      this.vy -= G * dt;
      this.y += this.vy * dt;
      // land only when arriving from above; running into a ledge is a hit, not a mantle
      if (this.y <= ground && this.vy <= 0 && prevY >= ground - 0.3) {
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        this.landT = 1;
        if (this.crashed) {
          // stay down
        } else if (this.jumpBuffer > 0) {
          this.jump();
        } else if (this.slideQueued) {
          this.slideQueued = false;
          this.slideT = CONFIG.slide.time;
        }
      }
    } else if (this.y > ground + 0.02) {
      // walked off the top of something
      this.grounded = false;
      this.vy = 0;
    } else if (ground - this.y < 0.3) {
      this.y = ground;
    }
    if (!this.grounded && this.y < 0) {
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
    }
    if (this.slideT > 0) this.slideT -= dt;
    if (this.stumbleT > 0) this.stumbleT -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.reviveT > 0) this.reviveT -= dt;
    if (this.landT > 0) this.landT = Math.max(0, this.landT - dt * 5);
    if (this.crashed) this.crashT += dt;

    this.animate(dt, speed);
  }

  // --- animation ---------------------------------------------------------------
  animate(dt, speed) {
    const sp = Math.min(1, Math.max(0, (speed - CONFIG.speed.start) / (CONFIG.speed.max - CONFIG.speed.start)));
    const freq = this.mode === 'run' ? 1.35 + speed * 0.06 : 0;
    this.phase += dt * Math.PI * 2 * freq;
    const f = this.phase;

    // target weights
    let tRun = 0, tJump = 0, tSlide = 0, tIdle = 0;
    if (this.mode !== 'run') tIdle = 1;
    else if (!this.grounded) tJump = 1;
    else if (this.sliding) tSlide = 1;
    else tRun = 1;
    const k = 16;
    this.w.run = damp(this.w.run, tRun, k, dt);
    this.w.jump = damp(this.w.jump, tJump, k * 1.2, dt);
    this.w.slide = damp(this.w.slide, tSlide, k * 1.3, dt);
    this.w.idle = damp(this.w.idle, tIdle, 4, dt);

    // run
    const r = this.pRun;
    r[K.hipsY] = STAND_Y - 0.03 + 0.055 * Math.abs(Math.sin(f));
    r[K.hipsYaw] = -0.12 * Math.sin(f);
    r[K.lean] = 0.22 + 0.08 * sp;
    r[K.twist] = 0.16 * Math.sin(f);
    r[K.headPitch] = 0.15;
    r[K.headYaw] = -0.12 * Math.sin(f);
    r[K.thL] = 0.12 + 0.92 * Math.sin(f);
    r[K.thR] = 0.12 + 0.92 * Math.sin(f + Math.PI);
    const knee = (p) => {
      const c = 0.5 + 0.5 * Math.cos(p + 0.6);
      return 0.3 + 1.3 * c * c;
    };
    r[K.knL] = knee(f);
    r[K.knR] = knee(f + Math.PI);
    r[K.thLz] = 0.04;
    r[K.thRz] = -0.04;
    r[K.shL] = -0.8 * Math.sin(f);
    r[K.shR] = 0.8 * Math.sin(f);
    r[K.shLz] = 0.16;
    r[K.shRz] = -0.16;
    r[K.elL] = 1.2 + 0.35 * Math.sin(f);
    r[K.elR] = 1.2 - 0.35 * Math.sin(f);
    r[K.scarf] = 0.9 + 0.35 * sp + 0.14 * Math.sin(f * 2);
    r[K.bodyPitch] = 0;
    r[K.bodyZ] = 0;

    // jump: tucked on the way up, reaching for the ground on the way down
    const j = this.pJump;
    const fall = Math.min(1, Math.max(0, -this.vy / V0 + 0.3));
    const mixv = (a, b) => a + (b - a) * fall;
    j[K.hipsY] = STAND_Y;
    j[K.hipsYaw] = 0;
    j[K.lean] = mixv(0.2, 0.08);
    j[K.twist] = 0.05;
    j[K.headPitch] = 0.1;
    j[K.headYaw] = 0;
    j[K.thL] = mixv(1.25, 0.55);
    j[K.thR] = mixv(0.25, 0.1);
    j[K.knL] = mixv(1.75, 0.5);
    j[K.knR] = mixv(1.4, 0.7);
    j[K.thLz] = 0.08;
    j[K.thRz] = -0.08;
    j[K.shL] = mixv(-0.6, 0.4);
    j[K.shR] = mixv(1.3, 0.6);
    j[K.shLz] = mixv(0.55, 1.0);
    j[K.shRz] = mixv(-0.4, -1.0);
    j[K.elL] = 0.8;
    j[K.elR] = 0.9;
    j[K.scarf] = mixv(1.4, 0.4);
    j[K.bodyPitch] = 0;
    j[K.bodyZ] = 0;

    // slide: feet-first, leaning back, one hand trailing on the floor
    const s = this.pSlide;
    s[K.hipsY] = 0.3;
    s[K.hipsYaw] = 0.1;
    s[K.lean] = -1.0;
    s[K.twist] = -0.15;
    s[K.headPitch] = -0.75;
    s[K.headYaw] = 0;
    s[K.thL] = 1.5;
    s[K.thR] = 1.2;
    s[K.knL] = 0.12;
    s[K.knR] = 1.45;
    s[K.thLz] = 0.1;
    s[K.thRz] = -0.15;
    s[K.shL] = -0.7;
    s[K.shR] = 0.6;
    s[K.shLz] = 0.65;
    s[K.shRz] = -0.35;
    s[K.elL] = 0.25;
    s[K.elR] = 0.9;
    s[K.scarf] = 1.5;
    s[K.bodyPitch] = 0;
    s[K.bodyZ] = 0;

    // idle (title screen): breathing, looking around a little
    const id = this.pIdle;
    const t = this.time;
    id[K.hipsY] = STAND_Y + Math.sin(t * 2.1) * 0.006;
    id[K.hipsYaw] = 0;
    id[K.lean] = 0.04 + Math.sin(t * 2.1) * 0.012;
    id[K.twist] = Math.sin(t * 0.5) * 0.05;
    id[K.headPitch] = 0.02 + Math.sin(t * 0.7) * 0.04;
    id[K.headYaw] = Math.sin(t * 0.43) * 0.35;
    id[K.thL] = 0.04;
    id[K.thR] = -0.06;
    id[K.knL] = 0.08;
    id[K.knR] = 0.12;
    id[K.thLz] = 0.05;
    id[K.thRz] = -0.05;
    id[K.shL] = 0.08;
    id[K.shR] = 0.02;
    id[K.shLz] = 0.12;
    id[K.shRz] = -0.12;
    id[K.elL] = 0.3;
    id[K.elR] = 0.25;
    id[K.scarf] = 0.12 + Math.sin(t * 1.3) * 0.06;
    id[K.bodyPitch] = 0;
    id[K.bodyZ] = 0;

    const total = this.w.run + this.w.jump + this.w.slide + this.w.idle || 1;
    const P = this.pose;
    for (let i = 0; i < N; i++) {
      P[i] = (r[i] * this.w.run + j[i] * this.w.jump + s[i] * this.w.slide + id[i] * this.w.idle) / total;
    }

    // landing squash
    P[K.hipsY] -= 0.09 * this.landT * this.landT;
    P[K.knL] += 0.4 * this.landT;
    P[K.knR] += 0.4 * this.landT;

    // stumble overlay: pitch forward, arms windmill
    let roll = 0;
    if (this.stumbleT > 0) {
      const a = this.stumbleT / 0.6;
      const e = Math.sin(a * Math.PI);
      P[K.lean] += 0.55 * e;
      P[K.headPitch] -= 0.5 * e;
      P[K.shL] += Math.sin(t * 24) * 1.2 * e;
      P[K.shR] += Math.cos(t * 24) * 1.2 * e;
      P[K.shLz] += 0.9 * e;
      P[K.shRz] -= 0.9 * e;
      roll = Math.sin(t * 15) * 0.16 * e;
    }

    // crash: knocked onto your back; revive gets you back up
    const c = this.pCrash;
    let cw = 0;
    if (this.crashed) cw = Math.min(1, this.crashT / 0.45);
    else if (this.reviveT > 0) cw = Math.min(1, this.reviveT / 0.9);
    if (cw > 0) {
      const e = cw * cw * (3 - 2 * cw);
      c.set(P);
      c[K.bodyPitch] = 1.42;
      c[K.bodyZ] = 0.55;
      c[K.hipsY] = STAND_Y;
      c[K.lean] = -0.1;
      c[K.headPitch] = 0.35;
      c[K.thL] = 0.75;
      c[K.thR] = 0.35;
      c[K.knL] = 0.6;
      c[K.knR] = 0.25;
      c[K.shL] = 2.5;
      c[K.shR] = 2.2;
      c[K.shLz] = 0.9;
      c[K.shRz] = -0.7;
      c[K.elL] = 0.3;
      c[K.elR] = 0.4;
      c[K.scarf] = 0.1;
      for (let i = 0; i < N; i++) P[i] += (c[i] - P[i]) * e;
    }

    // apply
    this.hips.position.y = P[K.hipsY];
    this.hips.rotation.y = P[K.hipsYaw];
    this.torso.rotation.set(-P[K.lean], P[K.twist], 0);
    this.head.rotation.set(P[K.headPitch], P[K.headYaw] - P[K.twist] * 0.6, 0);
    this.shoulderL.rotation.set(P[K.shL], 0, P[K.shLz]);
    this.shoulderR.rotation.set(P[K.shR], 0, P[K.shRz]);
    this.elbowL.rotation.set(P[K.elL], 0, 0);
    this.elbowR.rotation.set(P[K.elR], 0, 0);
    this.thighL.rotation.set(P[K.thL], 0, P[K.thLz]);
    this.thighR.rotation.set(P[K.thR], 0, P[K.thRz]);
    this.kneeL.rotation.set(-P[K.knL], 0, 0);
    this.kneeR.rotation.set(-P[K.knR], 0, 0);
    this.scarfTail.rotation.set(-P[K.scarf], Math.sin(t * 7) * 0.15 * this.w.run, 0);
    this.body.rotation.set(P[K.bodyPitch], 0, roll);
    this.body.position.z = P[K.bodyZ];

    // lean into lane changes
    const lean = Math.max(-0.4, Math.min(0.4, -this.vx * 0.035));
    this.root.rotation.z = damp(this.root.rotation.z, this.crashed ? 0 : lean, 12, dt);
    this.root.rotation.y = damp(this.root.rotation.y, this.crashed ? 0 : Math.max(-0.35, Math.min(0.35, -this.vx * 0.025)), 12, dt);

    // invulnerability blink
    this.root.visible = this.invulnT > 0 && !this.crashed ? Math.floor(this.invulnT * 12) % 2 === 0 : true;
  }

  place(z) {
    this.root.position.set(this.x, this.y, z);
    const h = Math.max(0, this.y);
    const s = Math.max(0.35, 1 - h * 0.25);
    this.shadow.position.set(this.x, 0.04 + (this.groundY || 0), z + 0.05);
    this.shadow.scale.set(0.95 * s * (this.sliding ? 1.3 : 1), 1, 1.25 * s * (this.sliding ? 1.6 : 1));
    this.shadow.material.uniforms.uAlpha.value = 0.38 * s;
  }
}
