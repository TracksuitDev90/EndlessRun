import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { shared, copyEnvUniforms, lerpEnvUniforms } from '../render/shaders.js';
import { Particles } from '../render/particles.js';
import { World } from '../world/world.js';
import { WORLD_DEFS } from '../world/index.js';
import { RNG } from '../core/rng.js';
import { Course } from './course.js';
import { ChunkStreamer } from './chunks.js';
import { ObstacleField } from './obstacles.js';
import { Player } from './player.js';
import { ChaseCamera } from './camera.js';
import { Portal } from './portal.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth01 = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const numeral = (n) => NUMERALS[n - 1] || String(n);

// Orchestrates one run: streaming, obstacles, the player, doorways between
// worlds, the camera and the two-pass portal render.
export class Game {
  constructor({ renderer, ui, audio, params }) {
    this.renderer = renderer;
    this.ui = ui;
    this.audio = audio;
    this.params = params;

    this.worlds = WORLD_DEFS.map((d) => new World(d));
    this.course = new Course(this.worlds);
    this.chunks = new ChunkStreamer(this);
    this.obstacles = new ObstacleField(this);
    this.player = new Player(WORLD_DEFS[0].env);
    this.cam = new ChaseCamera();
    this.portal = new Portal();
    this.particles = new Particles();

    this.sceneMain = new THREE.Scene();
    this.scenePortal = new THREE.Scene();
    this.sceneMain.add(this.player.root, this.player.shadow, this.portal.depthMesh, this.particles.points);
    this.scenePortal.add(this.portal.stencilMesh);

    this.time = 0;
    this.god = !!params.god;
    this.tutorialDone = readFlag('er.tutorialDone');
    this.newRun(true);
  }

  speedAt(t) {
    const s = CONFIG.speed;
    return s.max - (s.max - s.start) * Math.exp(-t / s.ramp);
  }

  worldVisible(world) {
    return world === this.current;
  }

  // --- run lifecycle ----------------------------------------------------------
  newRun(title) {
    const seed = this.params.seed ?? (Math.random() * 1e9) | 0;
    this.seed = seed;
    this.rng = new RNG(seed);
    for (const w of this.worlds) {
      w.clearAll();
      w.setStencil(false);
      w.root.removeFromParent();
    }
    this.portal.active = false;
    this.next = null;
    this.door = null;

    this.course.reset(new RNG(seed ^ 0x5bd1e995), this.params.world, this.params.visit || 0);
    this.dist = 0;
    this.prevDist = 0;
    this.origin = 0;
    this.runTime = 0;
    this.speed = 0;
    this.speedMul = 1;
    this.stumbleWindow = 0;
    this.continuesLeft = CONFIG.continuesPerRun;
    this.crashTimer = 0;
    this.crashShown = false;

    this.course.ensure(0, CONFIG.speed.start);
    this.current = this.course.segAt(0).world;
    this.current.applyVisit(this.course.segAt(0).visit);
    this.sceneMain.add(this.current.root);
    this.chunks.reset(seed, 0);
    this.obstacles.reset(this.rng, 0, !this.tutorialDone && !this.params.world);

    this.player.reset();
    copyEnvUniforms(this.player.u, this.current.u);
    const pd = this.current.env.particles;
    this.particles.set(pd, pd, 0);

    this.chunks.update(0);
    this.obstacles.update(0, 0);
    for (const w of this.worlds) w.flush(this.origin);

    this.state = title ? 'title' : 'running';
    this.player.mode = title ? 'idle' : 'run';
    this.cam.introTarget = title ? 1 : 0;
    if (!title) {
      this.cam.intro = 0.35;
      this.speed = CONFIG.speed.start * 0.5;
      this.announceWorld(this.course.segAt(0));
    }
    this.ui.setInk(0);
  }

  start() {
    if (this.state !== 'title') return;
    this.state = 'running';
    this.player.mode = 'run';
    this.cam.introTarget = 0;
    this.speed = 2;
    this.announceWorld(this.course.segAt(0));
  }

  restart() {
    this.ui.hideCrash();
    this.newRun(false);
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'reviving') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.ui.showPause(true);
    this.audio.suspend();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.ui.showPause(false);
    this.audio.resume();
  }

  continueRun() {
    if (this.state !== 'crashed' || this.continuesLeft <= 0) return;
    this.continuesLeft--;
    this.ui.hideCrash();
    this.obstacles.clearRange(this.dist - 6, this.dist + 80);
    this.player.revive();
    this.state = 'reviving';
    this.reviveTimer = 0.9;
    this.stumbleWindow = 0;
    this.speedMul = 0.85;
    this.speed = 0;
  }

  action(a) {
    if (this.state === 'title') {
      this.start();
      return;
    }
    if (this.state === 'running') this.player.action(a);
  }

  announceWorld(seg) {
    this.ui.toast(numeral(seg.ordinal), seg.world.name);
  }

  // --- hits -----------------------------------------------------------------
  collide() {
    const p = this.player;
    if (p.invulnT > 0 || p.crashed || this.god) return;
    const pw = CONFIG.player.halfWidth;
    const pd = CONFIG.player.halfDepth;
    // swept along the distance covered this frame so slow frames can't tunnel
    const z0 = Math.min(this.prevDist, this.dist) - pd;
    const z1 = this.dist + pd;
    const prevFront = this.prevDist + pd;
    const y0 = p.y;
    const y1 = p.y + p.height;
    for (const o of this.obstacles.records) {
      if (o.hit || (o.grace && o.grace > this.time)) continue;
      if (z1 < o.d || z0 > o.d + o.len) continue;
      const dx = Math.abs(p.x - o.x);
      if (dx >= o.hw + pw) continue;
      if (y1 <= o.y0 || y0 >= o.y1) continue;

      const frontal = prevFront <= o.d + 0.05;
      const glancing = dx > 0.62;
      if (frontal && !glancing) {
        if (o.kind === 'W') {
          this.crash();
          return;
        }
        o.hit = true;
        if (o.kind === 'L') {
          // trip over it with a stumbling hop
          p.vy = 5.2;
          p.grounded = false;
        } else {
          p.slideT = Math.max(p.slideT, 0.35);
        }
        this.stumble();
      } else {
        // clipped it from the side while changing lanes
        o.grace = this.time + 0.6;
        if (o.kind !== 'W') o.hit = true;
        p.nudgeAwayFrom(o.x);
        this.stumble();
      }
      return;
    }
  }

  stumble() {
    if (this.stumbleWindow > 0) {
      this.crash();
      return;
    }
    this.stumbleWindow = CONFIG.stumbleWindow;
    this.speedMul = CONFIG.stumbleSpeedMul;
    this.player.stumble();
    this.cam.kick(0.75);
  }

  crash() {
    this.state = 'crashed';
    this.player.crash();
    this.cam.kick(1.25);
    this.crashTimer = 1.0;
    this.crashShown = false;
  }

  // --- doorways ---------------------------------------------------------------
  camDist() {
    return this.origin - this.cam.camera.position.z;
  }

  updateDoor() {
    if (!this.portal.active) {
      const b = this.course.boundaryAfter(this.camDist());
      if (b && b.from.world === this.current && b.d - this.dist < CONFIG.viewAhead + 24) {
        this.next = b.to.world;
        this.next.applyVisit(b.to.visit);
        this.door = { d: b.d, quadD: b.d + this.current.def.gate.depth / 2, seg: b.to };
        this.portal.setShape(this.current.def.gate);
        this.portal.active = true;
        this.next.setStencil(true);
        this.scenePortal.add(this.next.root);
      }
    }
    if (this.portal.active) {
      const door = this.door;
      this.portal.place(-(door.quadD - this.origin));
      const t = smooth01(55, 0, door.quadD - this.dist);
      lerpEnvUniforms(this.player.u, this.current.u, this.next.u, t);
      this.particles.set(this.current.env.particles, this.next.env.particles, t);
      if (this.camDist() >= door.quadD - 0.45) this.crossDoor();
    }
  }

  crossDoor() {
    const old = this.current;
    this.chunks.dropWorld(old);
    this.obstacles.dropWorld(old);
    old.clearAll();
    old.flush(this.origin);
    old.root.removeFromParent();

    this.current = this.next;
    this.next = null;
    this.current.setStencil(false);
    this.sceneMain.add(this.current.root);
    this.portal.active = false;
    copyEnvUniforms(this.player.u, this.current.u);
    const pd = this.current.env.particles;
    this.particles.set(pd, pd, 0);
    this.announceWorld(this.door.seg);
    this.audio.door();
    this.door = null;
  }

  // Jump straight to a distance (debug / tests).
  teleport(d) {
    for (const w of this.worlds) {
      w.clearAll();
      w.setStencil(false);
      w.root.removeFromParent();
      w.flush(0);
    }
    this.portal.active = false;
    this.next = null;
    this.door = null;
    this.dist = d;
    this.prevDist = d;
    this.origin = Math.floor(d / CONFIG.rebaseStep) * CONFIG.rebaseStep;
    this.course.ensure(d, Math.max(this.speed, CONFIG.speed.start));
    this.current = this.course.segAt(d).world;
    this.current.applyVisit(this.course.segAt(d).visit);
    this.sceneMain.add(this.current.root);
    this.chunks.reset(this.seed, d);
    this.obstacles.reset(this.rng, d, false);
    copyEnvUniforms(this.player.u, this.current.u);
    const pd = this.current.env.particles;
    this.particles.set(pd, pd, 0);
  }

  skipToNextDoor(before = 150) {
    const b = this.course.boundaryAfter(this.dist + 1);
    if (b) this.teleport(b.d - before);
  }

  // --- frame ------------------------------------------------------------------
  update(dt) {
    if (this.state === 'paused') return;
    this.time += dt;
    shared.uTime.value = this.time;
    const st = this.state;

    if (st === 'running') {
      this.runTime += dt;
      this.stumbleWindow = Math.max(0, this.stumbleWindow - dt);
      this.speedMul = damp(this.speedMul, 1, 0.8, dt);
      const target = this.speedAt(this.runTime) * this.speedMul;
      this.speed = damp(this.speed, target, this.speed < target * 0.8 ? 2.2 : 4, dt);
    } else if (st === 'crashed') {
      this.speed = damp(this.speed, 0, 10, dt);
      this.crashTimer -= dt;
      if (this.crashTimer <= 0 && !this.crashShown) {
        this.crashShown = true;
        this.ui.showCrash(this.continuesLeft);
      }
    } else if (st === 'reviving') {
      this.speed = 0;
      this.reviveTimer -= dt;
      if (this.reviveTimer <= 0) this.state = 'running';
    } else {
      this.speed = 0;
    }

    this.prevDist = this.dist;
    this.dist += this.speed * dt;

    if (this.dist - this.origin > CONFIG.rebaseStep) {
      this.origin += CONFIG.rebaseStep;
      for (const w of this.worlds) w.markAllDirty();
    }

    this.course.ensure(this.dist, Math.max(this.speed, CONFIG.speed.start));
    this.chunks.update(this.dist);
    if (st !== 'title') this.obstacles.update(this.dist, this.runTime);

    this.player.update(dt, this.speed, (x) => this.obstacles.groundAt(x, this.dist));
    if (this.state === 'running') this.collide();

    const pz = -(this.dist - this.origin);
    this.player.place(pz);
    this.cam.update(dt, this.player, pz, this.speed, this.time);
    shared.uCamPos.value.copy(this.cam.camera.position);
    this.updateDoor();
    shared.uCamPos.value.copy(this.cam.camera.position);

    const sway = CONFIG.swayAmount * Math.sin((this.time * Math.PI * 2) / CONFIG.swayPeriod);
    shared.uBend.value.set(CONFIG.bend, sway, 0, CONFIG.bendStart);
    this.particles.update(this.dist);
    for (const w of this.worlds) w.sky.position.copy(this.cam.camera.position);

    this.current.flush(this.origin);
    if (this.next) this.next.flush(this.origin);

    // tutorial hints
    if (st === 'running' && !this.tutorialDone) {
      const g = this.obstacles.nextHint(this.dist, this.speed * 1.9 + 6);
      if (g) {
        g.hinted = true;
        this.ui.hint(g.hint);
        if (g.hint === 'side') {
          this.tutorialDone = true;
          writeFlag('er.tutorialDone');
        }
      }
    }
    this.ui.setInk(this.stumbleWindow / CONFIG.stumbleWindow);
    const sp = (this.speed - CONFIG.speed.start) / (CONFIG.speed.max - CONFIG.speed.start);
    this.audio.setIntensity(this.state === 'running' ? 0.3 + 0.7 * Math.max(0, sp) : 0.15);
  }

  render() {
    const r = this.renderer;
    const camera = this.cam.camera;
    r.clear(true, true, true);
    this.portal.depthMesh.visible = this.portal.active;
    if (this.portal.active) {
      r.render(this.scenePortal, camera);
      r.clearDepth();
    }
    r.render(this.sceneMain, camera);
  }

  resize(w, h) {
    this.cam.resize(w, h);
  }

  // Compile every shader up front so the first doorway never hitches.
  async precompile() {
    const scene = new THREE.Scene();
    const roots = [];
    for (const w of this.worlds) {
      roots.push([w.root, w.root.parent]);
      w.setAllVisibleForCompile(true);
      scene.add(w.root);
    }
    scene.add(this.player.root, this.player.shadow, this.particles.points, this.portal.depthMesh, this.portal.stencilMesh);
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(scene, this.cam.camera);
      else this.renderer.compile(scene, this.cam.camera);
    } finally {
      for (const w of this.worlds) w.setAllVisibleForCompile(false);
      for (const [root, parent] of roots) {
        root.removeFromParent();
        if (parent) parent.add(root);
      }
      this.sceneMain.add(this.player.root, this.player.shadow, this.portal.depthMesh, this.particles.points);
      this.scenePortal.add(this.portal.stencilMesh);
    }
  }
}

function readFlag(k) {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}
function writeFlag(k) {
  try {
    localStorage.setItem(k, '1');
  } catch {
    /* storage unavailable (private mode) */
  }
}
