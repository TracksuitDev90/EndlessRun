import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { shared, makeEnvUniforms, copyEnvUniforms, lerpEnvUniforms, DRAIN_NONE, DRAIN_ALL } from '../render/shaders.js';
import { Particles } from '../render/particles.js';
import { World } from '../world/world.js';
import { WORLD_DEFS } from '../world/index.js';
import { RNG } from '../core/rng.js';
import { Course } from './course.js';
import { ChunkStreamer } from './chunks.js';
import { ObstacleField } from './obstacles.js';
import { GemField } from './gems.js';
import { Sparkles } from '../render/sparkles.js';
import { CHARACTERS, characterById, pickableById } from './characters.js';
import { ChaseCamera } from './camera.js';
import { Portal } from './portal.js';
import { Dream } from './dream.js';
import { WaterFx } from './bubbles.js';
import { Splash } from './splash.js';
import { Warp } from './warp.js';
import { Sands } from './sands.js';
import { COMPANIONS, companionById } from './companions.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth01 = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const NO_MOTES = { color: '#000000', size: 1, drift: [0, 0, 0], opacity: 0 };
const CHEST = 0.9; // a collected gem is sucked into the runner's chest, this high above their feet
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const numeral = (n) => NUMERALS[n - 1] || String(n);

// Where a popping lid (spec.lid: a sunken chest) is in its cycle, keeping
// time exactly as the object shader does (LID): c, seconds into the cycle
// (it pops at POP_AT), and how hard this one pops (0 it stays shut, 0.4 a
// burp, 1 flung wide).
const POP_AT = 0.42;
export function lidPop(time, p0, every) {
  const tt = time + p0 * 0.15915 * every;
  const cyc = Math.floor(tt / every);
  const h = (cyc * 0.618034 + p0 * 0.3183) % 1;
  return { c: tt - cyc * every, pop: h < 0.15 ? 0 : h < 0.4 ? 0.4 : 1 };
}

// Orchestrates one run: streaming, obstacles, the player, doorways between
// worlds, the camera and the two-pass portal render.
export class Game {
  constructor({ renderer, ui, audio, params, assets, companionAssets = {} }) {
    this.renderer = renderer;
    this.ui = ui;
    this.audio = audio;
    this.params = params;

    this.worlds = WORLD_DEFS.map((d) => new World(d));
    // The doorways: every world's door - the way INTO it, built in its own
    // style (def.gate, def.door) - in one shared set that always stands in
    // the world you're running through, lit by it (see updateDoors).
    this.doors = new World({
      id: 'doors',
      name: 'doors',
      env: WORLD_DEFS[0].env,
      build: (b) => {
        for (const d of WORLD_DEFS) d.door(b.prefixed(`${d.id}.`));
      },
    });
    this.doors.root.remove(this.doors.sky);
    this.course = new Course(this.worlds);
    this.chunks = new ChunkStreamer(this);
    this.obstacles = new ObstacleField(this);
    this.gems = new GemField(this);
    // every runner you can pick is built up front (so picking one on the
    // title screen is instant and never compiles a shader mid-game); only
    // the one you picked is simulated and drawn
    this.runners = {};
    for (const c of CHARACTERS) this.runners[c.id] = c.make(WORLD_DEFS[0].env, assets[c.id]);
    // (a runner whose jump can keep them up longer asks first: see roadClear)
    for (const r of Object.values(this.runners)) r.roomAhead = (sec) => this.roadClear(sec);
    // (?runner= runs as anyone, even one still locked; the one remembered
    // only if they can still be picked)
    this.runnerId = (params.runner ? characterById(params.runner) : pickableById(readString('er.runner'))).id;
    this.player = this.runners[this.runnerId];
    // the animal who runs with you: every one you can pick built up front, as
    // the runners are (?companion=none to run alone)
    this.companions = {};
    for (const c of COMPANIONS) if (companionAssets[c.id]) this.companions[c.id] = c.mind(this, c, c.make(WORLD_DEFS[0].env, companionAssets[c.id]));
    this.alone = params.companion === 'none';
    const cdef = this.alone ? null : companionById(params.companion || readString('er.companion') || CONFIG.companion.id);
    this.companionId = cdef && this.companions[cdef.id] ? cdef.id : null;
    this.companion = this.companionId ? this.companions[this.companionId] : null;
    this.cam = new ChaseCamera();
    this.portal = new Portal();
    this.particles = new Particles();
    // a second layer some worlds use (env.particles2): Hell's falling ash
    // under its rising embers; invisible elsewhere
    this.particles2 = new Particles(320, 7);
    this.sparkles = new Sparkles();
    this.dream = new Dream();
    // under the sea: the bubbles, swirl and sand round the runner, lit as
    // the runner is (see bubbles.js)
    this.waterU = makeEnvUniforms(WORLD_DEFS[0].env);
    this.water = new WaterFx(this.waterU);
    // coming into a world with env.splash, the screen is splashed with water
    this.splash = new Splash();
    // through a doorway into a world with env.warp, the jump to light speed
    this.warp = new Warp();
    // a world with env.sands: the runner's footprints in it, and the surf
    // before a doorway into the sea (see sands.js)
    this.sands = new Sands();

    this.sceneMain = new THREE.Scene();
    this.scenePortal = new THREE.Scene();
    this.sceneMain.add(...this.player.objects, this.portal.depthMesh, this.particles.points, this.particles2.points, this.sparkles.points, ...this.water.objects);
    if (this.companion) this.sceneMain.add(...this.companion.objects);
    this.sceneMain.add(this.doors.root);
    this.scenePortal.add(this.portal.stencilMesh);

    this.time = 0;
    this.frameStep = 1 / 60; // the usual frame interval (set by the main loop)
    this.god = !!params.god;
    this.tutorialDone = readFlag('er.tutorialDone');
    this.best = readNumber('er.best');
    this.ui.setBest(this.best);
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
    this.doors.clearAll();
    this.portal.active = false;
    this.next = null;
    this.door = null;

    this.course.reset(new RNG(seed ^ 0x5bd1e995), this.params.world, this.params.visit || 0, this.params.dream);
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
    this.score = 0;
    this.gemCount = 0; // gems in hand (not yet exchanged)
    this.gemWorth = 0; // what they're worth at the exchange, before the haul bonus
    this.bestBefore = this.best;
    this.passedBest = false;
    this.ui.setGems(0);
    this.sparkles.reset();
    this.water.reset();
    this.splash.stop();
    this.warp.stop();
    this.sands.reset(seed);

    this.course.ensure(0, CONFIG.speed.start);
    this.depth = this.course.segAt(0).ordinal;
    this.ui.setScore(0, this.depth - 1);
    this.dream.reset(this.course.segAt(0).dream);
    this.current = this.course.segAt(0).world;
    this.current.applyVisit(this.course.segAt(0).visit);
    this.sceneMain.add(this.current.root);
    this.chunks.reset(seed, 0);
    this.obstacles.reset(this.rng, 0, !this.tutorialDone && !this.params.world);
    this.gems.reset(new RNG(seed ^ 0x2c1b3c6d), 0);
    this.ui.setGemColor(this.current.def.gem?.color, this.current.def.gem?.icon);

    this.player.reset();
    this.companion?.reset(title);
    this.startDrain(this.current, 'settle');
    copyEnvUniforms(this.player.u, this.current.u);
    this.setParticles(this.current.env, this.current.env, 0);

    this.chunks.update(0);
    this.obstacles.update(0, 0);
    this.gems.update(0, 0);
    for (const w of this.worlds) w.flush(this.origin);
    this.doors.flush(this.origin);

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
    this.companion?.start();
  }

  restart() {
    this.finishRun();
    this.ui.hideCrash();
    this.newRun(false);
  }

  // Back to the title screen (from the pause or crash card), to pick again.
  toTitle() {
    this.finishRun();
    this.ui.hideCrash();
    this.ui.showPause(false);
    this.saveBest();
    this.newRun(true);
  }

  // Leaving the crash card for good: any gems still in hand are exchanged
  // (nobody loses a haul by not pressing the button), and the score saved.
  finishRun() {
    if (this.state !== 'crashed') return;
    if (this.gemCount > 0) this.score += this.exchangeOffer().bonus;
    this.gemCount = 0;
    this.gemWorth = 0;
    this.saveBest();
  }

  // Pick who runs (title screen only): the new runner steps in where the old
  // one stood, lit by the same world, and says hello.
  selectRunner(id) {
    const def = characterById(id);
    const next = def.id === id && !def.locked ? this.runners[def.id] : null;
    if (this.state !== 'title' || !next) return false;
    if (next !== this.player) {
      this.sceneMain.remove(...this.player.objects);
      this.player = next;
      this.runnerId = characterById(id).id;
      this.player.reset();
      this.player.mode = 'idle';
      copyEnvUniforms(this.player.u, this.current.u);
      this.player.u.uDrain.value.copy(this.current.u.uDrain.value);
      this.sceneMain.add(...this.player.objects);
      writeString('er.runner', this.runnerId);
    }
    this.player.greet();
    this.companion?.greet();
    return true;
  }

  // Pick who runs with you (title screen only): they appear beside the
  // runner, lit by the same world, and say hello.
  selectCompanion(id) {
    const def = companionById(id);
    const next = def && this.companions[def.id];
    if (this.state !== 'title' || !next) return false;
    if (next !== this.companion) {
      if (this.companion) this.sceneMain.remove(...this.companion.objects);
      this.companion = next;
      this.companionId = def.id;
      next.reset(true);
      copyEnvUniforms(next.body.u, this.player.u);
      next.body.u.uDrain.value.copy(this.current.u.uDrain.value);
      this.sceneMain.add(...next.objects);
      writeString('er.companion', def.id);
    }
    this.companion.greet();
    return true;
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'reviving') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.saveBest();
    this.ui.showPause(true, this.score, this.exchangeOffer());
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
    this.companion?.revived();
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

  // --- gems -----------------------------------------------------------------
  // Each gem pays its points × depth with a chime that climbs the scale along
  // its run, and is sucked into the runner with a few motes of its colour;
  // taking a whole run pays a bonus on top. A gem missed costs nothing. And
  // every gem banks a worth toward the exchange at the end of the run: more
  // the more worlds you've come through, and the further into its world it
  // was found.
  collectGems() {
    const got = this.gems.collect(this.player, this.prevDist, this.dist, this.time);
    for (const g of got) this.creditGem(g);
  }

  // A gem is yours: taken by you, or caught by your companion (tossed: she
  // throws it back to you, its motes bursting as it arrives - see
  // companion.js).
  creditGem(g, tossed = false) {
    const p = this.player;
    const S = CONFIG.gems.score;
    if (tossed) this.gems.take(g, this.time, this.dist, true);
    this.score += (g.crown ? S.crown : S.gem) * this.depth;
    this.gemCount++;
    this.gemWorth += this.gemWorthAt(g.d, g.crown);
    if (!tossed) this.sparkles.emit(g.x - p.x, g.y - (p.y + CHEST), g.light, this.time, g.crown ? 1.25 : 1);
    p.onGem?.(g);
    this.audio.gem(g.index, g.crown);
    if (g.whole) {
      const bonus = S.perfect * g.run.size * this.depth;
      this.score += bonus;
      this.ui.scorePop(bonus);
      this.audio.gemRun();
      this.companion?.wholeRun();
    }
    this.ui.gem(this.gemCount);
  }

  // What a gem found at d is worth at the exchange (see CONFIG.gems.exchange).
  gemWorthAt(d, crown) {
    const X = CONFIG.gems.exchange;
    const seg = this.course.segAt(d);
    const into = Math.min(1, Math.max(0, (d - seg.start) / Math.max(1, seg.end - seg.start)));
    return X.base * (1 + X.perWorld * (seg.ordinal - 1)) * (1 + X.into * into) * (crown ? X.crown : 1);
  }

  // The gems in hand, cashed in: their worth times the haul bonus.
  exchangeOffer() {
    const X = CONFIG.gems.exchange;
    const haul = 1 + X.haul * Math.min(1, this.gemCount / X.big);
    return { gems: this.gemCount, haul, bonus: Math.round((this.gemWorth * haul) / 5) * 5 };
  }

  // Exchange the gems in hand for points (the crash card's button): they're
  // spent, so a Continue picks up with none, and the next crash offers
  // whatever's been found since.
  exchangeGems() {
    if (this.state !== 'crashed' || this.gemCount === 0) return;
    const offer = this.exchangeOffer();
    const from = this.score;
    this.score += offer.bonus;
    this.gemCount = 0;
    this.gemWorth = 0;
    this.saveBest();
    this.ui.setGems(0);
    this.ui.exchanged(offer, from, this.score, this.best, this.score > this.bestBefore);
    this.audio.exchange(offer.gems);
  }

  // --- score ----------------------------------------------------------------
  // The clear bonus for one obstacle at the current depth: it climbs with
  // every world you've come through (see CONFIG.score).
  clearBonus() {
    const S = CONFIG.score;
    return Math.round((S.clear * this.depth * (1 + S.grow * (this.depth - 1))) / 5) * 5;
  }

  updateScore(dt) {
    const S = CONFIG.score;
    this.score += this.speed * dt * S.perMeter * this.depth;
    const cleared = this.obstacles.collectCleared(this.dist - CONFIG.player.halfDepth);
    if (cleared > 0) {
      const bonus = cleared * this.clearBonus();
      this.score += bonus;
      this.ui.scorePop(bonus);
    }
    if (!this.passedBest && this.bestBefore > 0 && this.score > this.bestBefore) {
      this.passedBest = true;
      this.ui.newBest();
      this.audio.fanfare();
    }
    this.ui.setScore(this.score, this.depth - 1);
  }

  saveBest() {
    if (this.score <= this.best) return;
    this.best = Math.floor(this.score);
    writeNumber('er.best', this.best);
    this.ui.setBest(this.best);
  }

  // Whether the road's clear from just past whatever's being jumped now to
  // sec seconds ahead, in every lane (the bunny only floats - longer in the
  // air than any jump - when it is: so a float never comes down onto a bar
  // or a wall nobody could have seen it was going to).
  roadClear(sec) {
    const v = Math.max(this.speed, CONFIG.speed.start);
    const from = this.dist + v * 0.42;
    const to = this.dist + v * (sec + 0.3);
    for (const o of this.obstacles.records) if (o.d > from && o.d < to) return false;
    return true;
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
      o.group.hit = true;
      // dropping into water from a mistimed jump trips you just like running in
      if ((frontal || o.wade) && !glancing) {
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
    this.companion?.stumbled();
  }

  crash() {
    this.state = 'crashed';
    this.saveBest();
    this.player.crash();
    this.companion?.crashed();
    this.cam.kick(1.25);
    this.crashTimer = 1.0;
    this.crashShown = false;
  }

  // Ambient motes, blended between two worlds' settings (t = 0..1).
  setParticles(a, b, t) {
    this.particles.set(a.particles, b.particles, t);
    this.particles2.set(a.particles2 || NO_MOTES, b.particles2 || NO_MOTES, t);
  }

  // --- the colour drain ---------------------------------------------------------
  // A world whose env asks for it (Hell) is seen through its doorway in full
  // colour; come through and its colour is sapped away down a plughole in the
  // middle of the screen, the front closing in on it in spiral arms, leaving
  // black, grey and white — only what burns (and the runner's cape) keeps its
  // colour. Leaving, it runs backwards: the world beyond the doorway out is
  // grey too, until, on the last stretch of the run-up, its colour wells up
  // out of the middle of the doorway and spirals out to fill it, sweeping
  // over the runner (see updateDoor).
  // mode: 'in' sap it away, 'settle' just set where it ends up.
  startDrain(world, mode) {
    const u = world.u.uDrain.value;
    const drains = !!world.def.env.drain;
    this.drainWorld = null;
    if (mode !== 'in' || !drains) {
      u.set(drains ? 1 : 0, drains ? DRAIN_ALL : DRAIN_NONE, 0, 0);
      return;
    }
    this.drainWorld = world;
    this.drainT = 0;
    u.set(1, CONFIG.drain.inFrom, 1, 1);
  }

  updateDrain(dt) {
    const w = this.drainWorld;
    if (!w) return;
    const D = CONFIG.drain;
    const u = w.u.uDrain.value;
    this.drainT = Math.min(1, this.drainT + dt / D.inTime);
    // lingering round the edges at first, then sucked away faster and faster
    // down the hole
    u.y = D.inFrom + (DRAIN_ALL - D.inFrom) * Math.pow(this.drainT, D.inEase);
    if (this.drainT >= 1) this.startDrain(w, 'settle');
    // the runner drains with it (while the doorway's still on screen, the
    // runner, already through it, takes the world beyond's uniforms anyway)
    if (w === this.current && !this.portal.active) this.player.u.uDrain.value.copy(u);
  }

  // Out of a drained world (t: 0..1 over the run-up to the doorway): the world
  // beyond stays grey (but for a hint of its colour) until the last stretch,
  // then its colour wells up out of the middle of the doorway — by then
  // filling the screen — and spirals out to the edges, the runner's with it.
  wellUp(t) {
    const D = CONFIG.drain;
    const w = smooth01(D.wellFrom, 1, t);
    const live = w > 0 && w < 1 ? 1 : 0;
    const y = w > 0 ? D.outFrom + (D.outTo - D.outFrom) * Math.pow(w, 1.25) : DRAIN_ALL;
    this.next.u.uDrain.value.set(w > 0 ? 1 : D.hint, y, -1, live);
    this.player.u.uDrain.value.set(1, y, -1, live);
  }

  // --- under the sea -------------------------------------------------------------
  // In a world with env.bubbles the water shows on the runner: from the
  // moment they pass through its doorway until they pass out of it.
  updateWater(dt) {
    const wet = this.course.segAt(this.dist).world.def.env.bubbles || 0;
    if (wet === 0 && this.water.amount === 0) return;
    copyEnvUniforms(this.waterU, this.player.u);
    this.water.update(dt, this, wet);
  }

  // Obstacles that announce themselves (spec.call: the whale's song, a few
  // seconds before it crosses the road).
  callAhead() {
    if (this.state !== 'running') return;
    const ahead = Math.max(this.speed, CONFIG.speed.start) * 3.2;
    for (const g of this.obstacles.groups) {
      if (g.called || !g.spec?.call || g.d < this.dist || g.d - this.dist > ahead) continue;
      g.called = true;
      this.audio.call(g.spec.call);
    }
  }

  // A chest's lid popping open is heard (a muffled clunk and a glug of
  // bubbles, quieter further off) while it's far enough ahead to open.
  lidPops(dt) {
    if (this.state !== 'running' || dt <= 0) return;
    for (const g of this.obstacles.groups) {
      const lid = g.spec?.lid;
      if (!lid || g.world !== this.current) continue;
      const ahead = g.d - this.dist;
      if (ahead < 12 || ahead > 70) continue;
      const now = lidPop(this.time, g.p0, lid[0]);
      if (now.pop > 0 && now.c >= POP_AT && now.c - dt < POP_AT) this.audio.chest(now.pop, ahead);
    }
  }

  // --- time coming unstuck ------------------------------------------------------
  // A world whose env asks for it (env.wonk: [at the start, by the end], the
  // Gallery of Hours) has its clock hands spin wonkier and wonkier the
  // further you run through it — and a little wonkier each time it comes
  // round. Seen through a doorway, it's as calm as it starts.
  wonkOf(world, seg, t) {
    const w = world.def.env.wonk;
    if (!w) return 0;
    return Math.min(2.2, w[0] + (w[1] - w[0]) * t + 0.3 * (seg?.visit || 0));
  }

  updateWonk() {
    const seg = this.course.segAt(this.dist);
    if (seg.world === this.current) {
      const t = Math.min(1, Math.max(0, (this.dist - seg.start) / Math.max(1, seg.end - seg.start)));
      this.current.u.uWonk.value = this.wonkOf(this.current, seg, t);
    }
    if (this.next && this.door) this.next.u.uWonk.value = this.wonkOf(this.next, this.door.seg, 0);
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
        this.next.u.uDrain.value.set(this.next.def.env.drain ? 1 : 0, DRAIN_NONE, 0, 0);
        // (the doorway is the world it leads into's: its shape and depth)
        const gate = b.to.world.def.gate;
        this.door = { d: b.d, quadD: b.d + gate.depth / 2, seg: b.to };
        this.portal.setShape(gate);
        this.portal.setTrip(this.current.u.uTrip.value);
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
      if (this.current.def.env.drain && !this.next.def.env.drain) this.wellUp(t);
      this.setParticles(this.current.env, this.next.env, t);
      this.dream.set(this.course.prevOf(door.seg)?.dream ?? door.seg.dream, door.seg.dream, t);
      // into a world that drains, its colour starts going the moment the
      // runner reaches the doorway, not when the camera follows them through
      if (!door.drained && this.next.def.env.drain && this.dist >= door.d) {
        door.drained = true;
        this.startDrain(this.next, 'in');
      }
      // and into one with env.warp, the jump to light speed: the moment the
      // runner is through
      if (!door.warped && this.next.def.env.warp && this.dist >= door.d) {
        door.warped = true;
        this.startWarp();
      }
      if (this.camDist() >= door.quadD - 0.45) this.crossDoor();
    }
  }

  crossDoor() {
    const old = this.current;
    this.chunks.dropWorld(old);
    this.obstacles.dropWorld(old);
    this.gems.dropWorld(old);
    old.clearAll();
    old.flush(this.origin);
    old.root.removeFromParent();

    this.current = this.next;
    this.next = null;
    this.current.setStencil(false);
    this.sceneMain.add(this.current.root);
    this.portal.active = false;
    if (!this.door.drained) this.startDrain(this.current, 'in');
    copyEnvUniforms(this.player.u, this.current.u);
    this.setParticles(this.current.env, this.current.env, 0);
    this.announceWorld(this.door.seg);
    this.ui.setGemColor(this.current.def.gem?.color, this.current.def.gem?.icon);
    this.depth = this.door.seg.ordinal;
    this.dream.set(this.door.seg.dream, this.door.seg.dream, 0);
    this.dream.doorway(this.current.def, this.current.env, !!old.def.env.drain);
    this.audio.door();
    if (this.current.def.env.splash) {
      this.splash.start();
      this.audio.splash();
    }
    if (this.current.def.env.warp && !this.door.warped) this.startWarp();
    this.door = null;
  }

  startWarp() {
    this.warp.start();
    this.audio.warp();
  }

  // Jump straight to a distance (debug / tests).
  teleport(d) {
    for (const w of this.worlds) {
      w.clearAll();
      w.setStencil(false);
      w.root.removeFromParent();
      w.flush(0);
    }
    this.doors.clearAll();
    this.doors.flush(0);
    this.portal.active = false;
    this.next = null;
    this.door = null;
    this.dist = d;
    this.prevDist = d;
    this.origin = Math.floor(d / CONFIG.rebaseStep) * CONFIG.rebaseStep;
    this.course.ensure(d, Math.max(this.speed, CONFIG.speed.start));
    this.current = this.course.segAt(d).world;
    this.current.applyVisit(this.course.segAt(d).visit);
    this.depth = this.course.segAt(d).ordinal;
    this.dream.reset(this.course.segAt(d).dream);
    this.sceneMain.add(this.current.root);
    this.chunks.reset(this.seed, d);
    this.obstacles.reset(this.rng, d, false);
    this.gems.reset(new RNG(this.seed ^ 0x2c1b3c6d ^ Math.floor(d)), d);
    this.ui.setGemColor(this.current.def.gem?.color, this.current.def.gem?.icon);
    this.startDrain(this.current, 'settle');
    copyEnvUniforms(this.player.u, this.current.u);
    this.setParticles(this.current.env, this.current.env, 0);
    this.water.reset();
    this.splash.stop();
    this.warp.stop();
    this.sands.reset(this.seed ^ Math.floor(d));
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
    this.splash.update(dt);
    this.warp.update(dt);
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
        this.ui.showCrash(this.continuesLeft, this.score, this.best, this.score > this.bestBefore && this.score > 0, this.exchangeOffer());
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
    // the ground's patterns blur along the run by the shutter's share of a
    // frame's travel (see runLine in shaders.js) — a usual frame's, not this
    // one's: a late frame mustn't flash the road blurrier for an instant
    shared.uMotion.value = this.speed * Math.min(this.frameStep, 1 / 50) * CONFIG.motionBlur;

    if (this.dist - this.origin > CONFIG.rebaseStep) {
      this.origin += CONFIG.rebaseStep;
      for (const w of this.worlds) w.markAllDirty();
      this.doors.markAllDirty();
      this.companion?.rebase?.(CONFIG.rebaseStep);
    }

    this.course.ensure(this.dist, Math.max(this.speed, CONFIG.speed.start));
    this.chunks.update(this.dist);
    if (st !== 'title') {
      this.obstacles.update(this.dist, this.runTime);
      this.gems.update(this.dist, this.runTime);
    }

    // (over water nothing kicks up dust; the surf lapping up the sand before
    // a doorway into the sea counts)
    this.sands.surf(dt, this);
    this.player.wet = this.obstacles.wetAt(this.player.x, this.dist) || this.sands.wetAt(this.player.x, this.dist);
    // (this world's stones: the elder's sparks come in their colours)
    this.player.gemSpec = this.current.def.gem;
    // low gravity from the moment the runner is through the doorway into it
    // until they're through the one out (see Player)
    this.player.lowG = st !== 'title' && !!this.course.segAt(this.dist).world.def.lowGravity;
    const boosts = this.player.boosted;
    this.player.update(dt, this.speed, (x) => this.obstacles.groundAt(x, this.dist));
    if (this.player.boosted !== boosts) {
      this.cam.boost(this.player.thrust);
      this.audio.thrust(this.player.thrust);
    }
    if (this.state === 'running') this.collide();
    if (this.state === 'running') this.collectGems();
    if (this.state === 'running') this.updateScore(dt);

    const pz = -(this.dist - this.origin);
    this.player.place(pz, this.dist);
    this.companion?.update(dt);
    this.sands.update(dt, this);
    this.updateWater(dt);
    this.callAhead();
    this.lidPops(dt);
    shared.uGemAt.value.set(this.player.x, this.player.y + CHEST, pz);
    this.dream.update(dt);
    this.updateDrain(dt);
    this.cam.sway = this.dream.sway;
    this.cam.update(dt, this.player, pz, this.speed, this.time);
    if (this.warp.active) this.warp.aim(this.cam.camera, this.player.root.position);
    shared.uCamPos.value.copy(this.cam.camera.position);
    this.updateDoor();
    this.updateWonk();
    shared.uCamPos.value.copy(this.cam.camera.position);

    const sway = CONFIG.swayAmount * Math.sin((this.time * Math.PI * 2) / CONFIG.swayPeriod);
    // the world is kept true out to where the runner will be in a few seconds
    const R = CONFIG.dream.read;
    const read = Math.min(R[2], Math.max(R[1], CONFIG.camera.back + Math.max(this.speed, CONFIG.speed.start) * R[0]));
    shared.uBend.value.set(CONFIG.bend, sway, read, CONFIG.bendStart);
    this.particles.update(this.dist);
    this.particles2.update(this.dist);
    for (const w of this.worlds) w.sky.position.copy(this.cam.camera.position);
    // (the planets hang in the sky round the camera, drifting nearer and
    // further: see world/planets.js)
    this.current.planets?.update(this.cam.camera, this.time);
    if (this.next) this.next.planets?.update(this.cam.camera, this.time);
    // the companion is lit as the runner is, carried between worlds with them
    if (this.companion) copyEnvUniforms(this.companion.body.u, this.player.u);

    this.current.flush(this.origin);
    if (this.next) this.next.flush(this.origin);
    // (the doors stand in the world you're in, lit by it)
    copyEnvUniforms(this.doors.u, this.current.u);
    this.doors.flush(this.origin);
    const camDist = this.camDist();
    const twisting = shared.uDream.value.x !== 0;
    this.current.cull(camDist, twisting);
    if (this.next) this.next.cull(camDist, twisting);
    this.doors.cull(camDist, twisting);

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
    // the runner's and the companion's shadows: their silhouettes this frame
    // (see render/caster.js)
    this.player.renderShadow(r);
    this.companion?.body.renderShadow(r);
    r.clear(true, true, true);
    this.portal.depthMesh.visible = this.portal.active;
    if (this.portal.active) {
      r.render(this.scenePortal, camera);
      r.clearDepth();
    }
    r.render(this.sceneMain, camera);
    this.splash.render(r);
    this.warp.render(r);
  }

  resize(w, h) {
    this.cam.resize(w, h);
  }

  // Compile every shader up front so the first doorway never hitches; while
  // the GPU compiles, index every world's geometry (see weld in geo.js); then
  // draw everything once, out of sight under the loading screen, so every
  // buffer and texture is on the GPU and every program has been used before
  // the run begins (otherwise each world uploads its geometry the first time
  // its doorway comes into view).
  async precompile() {
    const scene = new THREE.Scene();
    const roots = [];
    for (const w of [...this.worlds, this.doors]) {
      roots.push([w.root, w.root.parent]);
      w.setAllVisibleForCompile(true);
      scene.add(w.root);
    }
    for (const r of Object.values(this.runners)) {
      scene.add(...r.objects);
      r.forCompile?.(true);
    }
    scene.add(this.particles.points, this.particles2.points, this.sparkles.points, this.portal.depthMesh, this.portal.stencilMesh, ...this.water.objects);
    for (const c of Object.values(this.companions)) {
      scene.add(...c.objects);
      c.forCompile(true);
    }
    this.water.forCompile(true);
    scene.add(this.splash.mesh);
    try {
      const compiling = this.renderer.compileAsync ? this.renderer.compileAsync(scene, this.cam.camera) : this.renderer.compile(scene, this.cam.camera);
      let t = performance.now();
      for (const w of [...this.worlds, this.doors]) {
        for (const _ of w.weldAll()) {
          if (performance.now() - t > 12) {
            await new Promise((r) => setTimeout(r, 0));
            t = performance.now();
          }
        }
      }
      await compiling;
      const r = this.renderer;
      r.setScissorTest(true);
      r.setScissor(0, 0, 1, 1);
      r.render(scene, this.cam.camera);
      r.setScissorTest(false);
      // (and every shadow's silhouette target allocated now)
      for (const x of Object.values(this.runners)) x.renderShadow(r);
      for (const c of Object.values(this.companions)) c.body.renderShadow(r);
      r.clear(true, true, true);
    } finally {
      for (const w of [...this.worlds, this.doors]) w.setAllVisibleForCompile(false);
      this.water.forCompile(false);
      this.splash.scene.add(this.splash.mesh);
      for (const [root, parent] of roots) {
        root.removeFromParent();
        if (parent) parent.add(root);
      }
      for (const r of Object.values(this.runners)) {
        r.forCompile?.(false);
        for (const o of r.objects) o.removeFromParent();
      }
      this.sceneMain.add(...this.player.objects, this.portal.depthMesh, this.particles.points, this.particles2.points, this.sparkles.points, ...this.water.objects);
      for (const c of Object.values(this.companions)) {
        c.forCompile(false);
        for (const o of c.objects) o.removeFromParent();
      }
      if (this.companion) this.sceneMain.add(...this.companion.objects);
      this.scenePortal.add(this.portal.stencilMesh);
    }
    // (and the splash's copy of the frame allocated now, not the instant the
    // first one hits)
    this.splash.warm(this.renderer);
    this.warp.warm(this.renderer);
  }
}

function readFlag(k) {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}
function readNumber(k) {
  try {
    return Math.max(0, Number(localStorage.getItem(k)) || 0);
  } catch {
    return 0;
  }
}
function writeNumber(k, v) {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* storage unavailable (private mode) */
  }
}
function readString(k) {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
}
function writeString(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable (private mode) */
  }
}
function writeFlag(k) {
  try {
    localStorage.setItem(k, '1');
  } catch {
    /* storage unavailable (private mode) */
  }
}
