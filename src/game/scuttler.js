import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { clamp } from './rig.js';
import { Companion } from './companion.js';

// Shoal's mind: the giant opal crab who runs with you (see crab.js for his
// body). He isn't the fox, darting about; he's big and gentle and very
// fond of you. Most of the time he ambles along level with you a lane over
// (now and then a little ahead, never far), and his ideas are quiet ones:
//   - peer: he drifts in a little closer, level with you, and looks at you
//     with his head on one side - the way a dog does - his eyes on you;
//   - wave: a wave of his little claw, and a smile;
//   - shuffle: now and then he turns side on and runs along crabwise, the
//     way a crab really goes, weaving a little from side to side in his
//     lane (and sometimes turning about to face the other side), his eyes
//     kept on the road ahead, then turns back to it;
//   - sidle: he changes lane the way a crab would, crabwise - turned side
//     on, scuttling across - and turns back to the road;
//   - gaze: something at the side of the road catches his eye and he
//     watches it go by, tilting after it;
//   - hop: a little hop, for no reason but that he's happy.
// From the fox's mind he keeps what keeps him safe (reading the road: round
// the walls, over the hurdles, out from under your feet), how he gathers
// and sheds speed, and fetching a gem now and then (snapped up in his
// little claw). He's broad: a bar across his lane he goes round if he can,
// and if he can't he flattens himself and scuttles under it. When you
// stumble he looks back at you, worried; when you take a whole run of gems
// he waves. On the title screen he sits by you, looking about and tilting
// his head at you; picked, he waves.
//
// He tells his body the world he's in (its colours turn to it as he enters
// it - see crab.js), and his abilities (powers.js) tell it how strongly he
// resonates and how far he's grown into the bulldozer.

const LANES = CONFIG.laneX;
const _q = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Scuttler extends Companion {
  reset(title) {
    this.peerT = rand(3, 6);
    this.crabwise = 0;
    super.reset(title);
  }

  // --- what happens to the runner ---------------------------------------------------
  greet() {
    this.body.wave();
    this.body.tiltNow(1, 1);
    this.cheer(1.8);
    this.lookFor(1.4, 'camera');
  }

  stumbled() {
    this.mood.earsBack = 1.0;
    this.lookFor(1.2, 'runner');
    this.body.tiltNow(this.x > this.game.player.x ? -1 : 1, 0.8);
  }

  revived() {
    super.revived();
    this.body.wave();
  }

  wholeRun() {
    this.cheer(1.4);
    if (Math.random() < 0.5) this.body.wave();
  }

  powerBegin() {
    super.powerBegin();
  }

  // --- the frame ---------------------------------------------------------------------
  place(dt) {
    super.place(dt);
    const g = this.game;
    const b = this.body;
    // (the world he's standing in: his colours turn to it)
    if (Number.isFinite(g.dist) && g.course?.segAt) b.world = g.course.segAt(g.dist + this.dz)?.world?.def?.id || b.world;
    else if (g.current) b.world = g.current.def.id;
    // crabwise: turned side on to the way he's going (and, whenever no idea
    // of his wants it, easing back round to face the road)
    if (this.beat !== 'sidle' && this.beat !== 'shuffle') this.crabwise *= Math.exp(-(dt || 0) * 5);
    if (Math.abs(this.crabwise) < 1e-3) this.crabwise = 0;
    if (this.crabwise) b.root.quaternion.multiply(_q.setFromAxisAngle(_UP, this.crabwise));
    // (his legs step the way he's really going over the ground)
    b.crabwise = this.crabwise;
  }

  // His eyes and a tilt follow what he looks at; and every so often he
  // peers at you.
  think(dt) {
    super.think(dt);
    const g = this.game;
    if (g.state !== 'running' || this.power) return;
    this.peerT -= dt;
    if (this.peerT <= 0 && !this.beat && !this.fetching) {
      this.peerT = rand(...this.C.peer.every);
      if (Math.random() < 0.6) this.startBeat('peer');
    }
  }

  // --- ambling beside you --------------------------------------------------------------
  escort(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    if (!this.slot || (this.slotT -= dt) <= 0) {
      const lane = this.laneOf(p.x);
      const others = [0, 1, 2].filter((l) => l !== lane);
      // (never in your lane: he's too big to see past)
      const was = this.slot?.lane;
      this.slot = { lane: pick(others), dz: rand(-0.4, 2.6), off: rand(-0.2, 0.2) };
      this.slotT = rand(4, 7);
      if (was !== undefined && was !== this.slot.lane && Math.random() < this.C.sidle && this.grounded) this.startBeat('sidle', this.slot.lane);
      else if (Math.random() < 0.4) this.lookFor(rand(0.8, 1.4), Math.random() < 0.7 ? 'runner' : 'camera');
    }
    G.x = LANES[this.slot.lane] + this.slot.off;
    G.dz = this.slot.dz;
    G.w = 3;
    G.wz = 1.1;
    G.low = 0;
  }

  chooseBeat() {
    const p = this.game.player;
    const lane = this.laneOf(p.x);
    const opts = [
      ['wave', 1.2],
      ['gaze', this.openRoad(this.x, 2) ? 1.3 : 0],
      ['hop', this.canLeap(1.2) && this.openRoad(this.x, 1.4) ? 0.7 : 0],
      ['sidle', [0, 1, 2].some((l) => l !== lane && l !== this.laneOf(this.x) && this.openRoad(LANES[l], 2.4)) ? 1 : 0],
      ['peer', this.openRoad(this.x, 2.4) ? 1 : 0],
      ['shuffle', this.grounded && this.openRoad(this.x, 2.5) ? 2.4 : 0],
    ];
    if (this.lastBeat) for (const o of opts) if (o[0] === this.lastBeat) o[1] *= 0.2;
    let total = 0;
    for (const o of opts) total += o[1];
    let r = Math.random() * total;
    for (const [name, w] of opts) {
      r -= w;
      if (w > 0 && r <= 0) {
        this.startBeat(name);
        return;
      }
    }
    this.restT = 1;
  }

  startBeat(name, toLane) {
    this.beat = name;
    this.lastBeat = name;
    this.beatT = 0;
    this.stage = 0;
    const p = this.game.player;
    const lane = this.laneOf(p.x);
    const others = [0, 1, 2].filter((l) => l !== lane);
    this.beatLane = this.laneOf(this.x) !== lane ? this.laneOf(this.x) : pick(others);
    if (name === 'wave') {
      this.body.wave();
      this.cheer(1.6);
      this.lookFor(1.4, Math.random() < 0.6 ? 'runner' : 'camera');
    }
    if (name === 'peer') {
      // (from whichever side of you he's on, his head over toward you)
      this.lookFor(rand(...this.C.peer.look), 'runner');
      this.body.tiltNow(this.x > p.x ? -1 : 1, 1);
      this.cheer(1);
    }
    if (name === 'gaze') {
      this.gazeSide = this.x >= 0 ? 1 : -1;
      this.body.tiltNow(this.gazeSide, 0.9);
    }
    if (name === 'hop') this.jump(rand(0.22, 0.32), 'hop');
    if (name === 'shuffle') {
      this.beatLane = this.laneOf(this.x) !== lane ? this.laneOf(this.x) : pick(others);
      // (which side he turns to face: toward you, mostly)
      this.sideDir = (this.x > p.x ? 1 : -1) * (Math.random() < 0.75 ? 1 : -1);
      this.shuffleT = rand(...this.C.shuffle.dur);
      this.flipAt = Math.random() < 0.35 ? rand(0.4, 0.6) * this.shuffleT : -1;
      this.cheer(1);
    }
    if (name === 'sidle') {
      const from = this.laneOf(this.x);
      this.beatLane = toLane ?? pick([0, 1, 2].filter((l) => l !== lane && l !== from));
      if (this.beatLane === undefined) this.beatLane = pick(others);
      this.sideDir = LANES[this.beatLane] > this.x ? 1 : -1;
    }
  }

  endBeat() {
    super.endBeat();
  }

  beatStep(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    this.beatT += dt;
    const t = this.beatT;
    G.x = LANES[this.beatLane];
    G.w = 3;
    G.wz = 1.1;
    switch (this.beat) {
      case 'wave': {
        G.dz = clamp(this.dz, -0.4, 2.4);
        if (t > 1.5) this.endBeat();
        break;
      }
      case 'peer': {
        // in close, level with you, looking
        G.x = LANES[this.laneOf(this.x)] + (p.x > this.x ? 0.35 : -0.35);
        G.dz = 0.3;
        G.wz = 1.4;
        if (t > 2.2) {
          this.endBeat();
          if (Math.random() < 0.5) this.body.wave();
        }
        break;
      }
      case 'gaze': {
        // watching something go by at the side of the road
        G.dz = clamp(this.dz, 0, 2.6);
        G.wz = 0.9;
        this.lookFor(0.2, { x: this.gazeSide * 7, y: 0.8, dz: this.dz + 6 - t * 9 });
        if (t > 1.8) this.endBeat();
        break;
      }
      case 'hop': {
        G.dz = clamp(this.dz, 0.4, 2.6);
        if (this.grounded && !this.windup && t > 0.2) {
          this.cheer(0.8);
          this.endBeat();
        }
        break;
      }
      case 'shuffle': {
        // side on, running along crabwise and weaving a little across his
        // lane; the moment there's anything to see to, back to the road
        G.dz = clamp(this.dz, 0, 2.4);
        G.x = LANES[this.beatLane] + this.C.shuffle.weave * Math.sin(t * this.C.shuffle.rate);
        G.w = 3.5;
        if (this.flipAt > 0 && t > this.flipAt) {
          this.sideDir = -this.sideDir;
          this.flipAt = -1;
        }
        const ending = t > this.shuffleT || !this.openRoad(this.x, 1.2) || !this.grounded;
        const want = ending ? 0 : this.sideDir * Math.PI * 0.5;
        this.crabwise += (want - this.crabwise) * (1 - Math.exp(-dt * 5));
        // (his eyes on the road ahead, whichever way he's turned)
        this.lookFor(0.2, { x: this.x, y: 0.6, dz: this.dz + 8 });
        if (ending && Math.abs(this.crabwise) < 0.08) this.endBeat();
        if (t > this.shuffleT + 3) this.endBeat();
        break;
      }
      case 'sidle': {
        // across crabwise: turned side on, scuttling across the lanes (and
        // the moment there's anything to see to, back to the road)
        G.dz = clamp(this.dz, 0, 2.4);
        G.w = 2.4;
        const there = Math.abs(this.x - G.x) < 0.2;
        const want = there || t > 3 || !this.grounded ? 0 : this.sideDir * Math.PI * 0.5;
        this.crabwise += (want - this.crabwise) * (1 - Math.exp(-dt * 6));
        if (!this.openRoad(this.x, 1.2)) this.crabwise *= 0.8;
        if (there && Math.abs(this.crabwise) < 0.05) this.endBeat();
        if (t > 4) this.endBeat();
        break;
      }
      default:
        this.endBeat();
    }
  }

  // (no tail to chase)
  canWhirl() {
    return false;
  }

  // --- keeping safe ------------------------------------------------------------------
  // As the fox reads the road, and: a bar across his lane he goes round if
  // there's a lane clear of it he can reach; if not, he flattens himself
  // under it. (Out ahead as the bulldozer he needn't: whatever's in his way
  // is about to be smashed - see powers.js.)
  safety() {
    const A = this.power;
    if (A && A.def?.id === 'dozer' && A.phase !== 'back') {
      const G = this.goal;
      G.x = clamp(G.x, -3, 3);
      return;
    }
    super.safety();
    const g = this.game;
    const G = this.goal;
    const vf = Math.max(g.speed + this.vdz, 2);
    const df = g.dist + this.dz;
    const near = df + vf * this.C.duck + 2.5;
    const bar = (x) => this.threat(x, df - 1.2, near, 'H');
    if (this.grounded && bar(G.x)) {
      // (a lane with no bar and no wall, within reach)
      const here = this.laneOf(this.x);
      let best = null;
      for (const l of [here, here - 1, here + 1]) {
        if (l < 0 || l > 2) continue;
        if (bar(LANES[l]) || this.threat(LANES[l], df - 1, near + vf, 'W')) continue;
        if (Math.abs(LANES[l] - this.x) > vf * 0.35 + 1.6) continue;
        best = l;
        break;
      }
      if (best !== null && !(this.dz < 1.7 && Math.abs(LANES[best] - g.player.x) < 0.75)) {
        G.x = LANES[best];
        G.w = Math.max(G.w, 12);
        G.urgent = true;
      }
    }
    // (he's broad: with a wall beside his lane, coming or alongside, he
    // keeps to the very middle of it - the fox's easy drift off it would
    // bring his legs up against the wall)
    {
      const l = this.laneOf(G.x);
      if (Math.abs(G.x - LANES[l]) < 0.6) {
        for (const o of g.obstacles.records) {
          if (o.kind !== 'W' || o.d > df + vf * 1.2 + 2 || o.d + o.len < df - 1.2) continue;
          const gap = Math.abs(o.x - LANES[l]);
          if (gap > 0.5 && gap < 3) {
            G.x = LANES[l];
            break;
          }
        }
      }
    }
    // (under one now, or about to be: flat)
    if (bar(this.x) && this.threat(this.x, df - 1.2, df + vf * 0.55 + 1.8, 'H')) G.low = 1;
    // and he's broad: anywhere near you, never in your lane (a lane over,
    // the way clear of walls, or else back behind you or out ahead of you)
    const p = g.player;
    if (this.grounded && Math.abs(this.dz) < 3 && (Math.abs(this.x - p.x) < 1.7 || Math.abs(G.x - p.x) < 1.7)) {
      const pl = this.laneOf(p.x);
      const ls = [pl - 1, pl + 1].filter((l) => l >= 0 && l <= 2 && !this.threat(LANES[l], df - 1, df + vf * 1.2 + 2, 'WH'));
      if (ls.length) {
        const l = ls.reduce((a, b2) => (Math.abs(LANES[b2] - this.x) < Math.abs(LANES[a] - this.x) ? b2 : a));
        G.x = LANES[l];
        G.w = Math.max(G.w, 10);
      } else G.dz = this.dz > 0 ? Math.max(G.dz, 3.4) : Math.min(G.dz, -2.6);
    }
  }
}
