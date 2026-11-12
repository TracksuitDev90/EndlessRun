import { CONFIG } from '../config.js';
import { clamp } from './rig.js';
import { Companion } from './companion.js';

// Nep's mind: the pitcher plant who runs with you (see pitcher.js for his
// body). He isn't the fox. She's quick and sly and forever darting off; he's
// a pot of water on two short roots, doing his best to keep up - never far
// from you, ambling along a lane over, a little behind or a little ahead,
// wobbling. He keeps pace (he has to), but he never dashes, never shoots
// between your legs, never rides on your shoulder, never pounces.
//
// From the fox's mind he keeps only what keeps him safe (reading the road:
// round the walls, over the hurdles, out from under your feet), how he
// gathers and sheds speed, and fetching a gem now and then (into his mouth,
// the leaf clapped shut on it). His own ideas, every few seconds:
//   - totter: he loses his balance and wobbles from side to side a while,
//     the water slopping out over his rim, before he rights himself;
//   - shake: shakes himself off like a wet dog, twisting to and fro on his
//     roots - water flung off his rim, soil off his feet;
//   - bask: slows up beside you and turns his face up to the light, his leaf
//     lifted right off his mouth, tendrils up, eyes shut in bliss;
//   - bounce: a little run of bouncy hops in a row, splashing on every
//     landing;
//   - dawdle: falls behind looking at something, then realises and hurries
//     back up to you in a flap, tendrils flailing;
//   - sway: dances along beside you, weaving from side to side and leaning
//     right over into every swing.
// On the title screen he stands by the runner swaying to a tune only he can
// hear; picked, he hops and gives himself a shake. When you stumble he
// totters; when you take a whole run of gems he bounces.

const LANES = CONFIG.laneX;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Sprout extends Companion {
  reset(title) {
    this.fx = { totter: 0, shake: 0, bask: 0, flail: 0, sway: 0 };
    this.fxT = { totter: 0, shake: 0, bask: 0, flail: 0, sway: 0 };
    this.hops = 0;
    super.reset(title);
  }

  // --- what happens to the runner ---------------------------------------------------
  greet() {
    if (!this.grounded) return;
    this.jump(0.3, 'hop');
    this.cheer(1.6);
    this.later2 = { at: this.game.time + 0.55, what: 'shake' };
  }

  stumbled() {
    this.mood.earsBack = 1.0;
    this.lookFor(0.9, 'runner');
    this.fxT.totter = Math.max(this.fxT.totter, 0.8);
  }

  revived() {
    super.revived();
    this.fxT.shake = 0.9;
  }

  wholeRun() {
    this.cheer(1.4);
    if (Math.random() < 0.45 && !this.beat && !this.fetching && this.grounded && this.canLeap(1.4)) this.startBeat('bounce');
  }

  // --- the frame ---------------------------------------------------------------------
  place(dt) {
    super.place(dt);
    const g = this.game;
    if (this.later2 && g.time >= this.later2.at) {
      this.fxT[this.later2.what] = 0.9;
      this.later2 = null;
    }
    // his flourishes, each held for its time and eased in and out
    const out = this.act || (this.act = {});
    for (const k in this.fxT) {
      if (this.fxT[k] > 0) this.fxT[k] = Math.max(0, this.fxT[k] - (dt || 0));
      const want = this.fxT[k] > 0 ? 1 : 0;
      const rate = want ? 7 : k === 'bask' ? 2.5 : 4;
      this.fx[k] += (want - this.fx[k]) * (1 - Math.exp(-(dt || 0) * rate));
      out[k] = this.fx[k];
    }
    // (the way he's swaying, for a dance)
    out.swayDir = this.swayDir || 0;
    // on the title screen he sways to himself
    out.idle = g.state === 'title' || this.sitting ? 1 : 0;
    this.body.act = out;
  }

  // --- ambling beside you --------------------------------------------------------------
  // A lane over (now and then ahead in yours, but never far), a little behind
  // or a little ahead of you, drifting slowly.
  escort(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    if (!this.slot || (this.slotT -= dt) <= 0) {
      const lane = this.laneOf(p.x);
      const others = [0, 1, 2].filter((l) => l !== lane);
      const ahead = Math.random() < 0.15;
      this.slot = { lane: ahead ? lane : pick(others), dz: ahead ? rand(2.4, 3.2) : rand(-0.8, 2.2), off: rand(-0.3, 0.3) };
      this.slotT = rand(3.5, 6.5);
      if (Math.random() < 0.4) this.lookFor(rand(0.6, 1.2), Math.random() < 0.6 ? 'runner' : 'camera');
    }
    G.x = LANES[this.slot.lane] + this.slot.off;
    G.dz = this.slot.dz;
    G.w = 3.2;
    G.wz = 1.1;
    G.low = 0;
  }

  chooseBeat() {
    const g = this.game;
    const p = g.player;
    const opts = [
      ['totter', 1.5],
      ['shake', this.openRoad(this.x, 1.4) ? 1.2 : 0],
      ['bask', this.openRoad(this.x, 1.6) ? 1.3 : 0],
      ['bounce', this.canLeap(1.6) && this.openRoad(this.x, 1.6) ? 0.9 : 0],
      ['dawdle', p.grounded && this.openRoad(this.x, 3.5) ? 1.2 : 0],
      ['sway', [0, 1, 2].some((l) => l !== this.laneOf(p.x) && this.openRoad(LANES[l], 3)) ? 1.3 : 0],
      // (and, if a gem's about, fetching it - see think)
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

  startBeat(name) {
    this.beat = name;
    this.lastBeat = name;
    this.beatT = 0;
    this.stage = 0;
    const p = this.game.player;
    const lane = this.laneOf(p.x);
    const others = [0, 1, 2].filter((l) => l !== lane);
    this.beatLane = this.laneOf(this.x) !== lane ? this.laneOf(this.x) : pick(others);
    if (name === 'totter') this.fxT.totter = rand(1.4, 2.1);
    if (name === 'shake') this.fxT.shake = rand(0.8, 1.1);
    if (name === 'bask') {
      this.fxT.bask = rand(2, 2.8);
      this.cheer(this.fxT.bask);
    }
    if (name === 'bounce') this.hops = 2 + Math.floor(Math.random() * 3);
    if (name === 'sway') {
      if (this.beatLane === lane) this.beatLane = pick(others);
      this.swayDir = 1;
    }
  }

  endBeat() {
    super.endBeat();
    this.swayDir = 0;
    this.hops = 0;
    this.fxT.flail = 0;
    this.fxT.sway = 0;
  }

  beatStep(dt) {
    const G = this.goal;
    this.beatT += dt;
    const t = this.beatT;
    // (whatever the idea, he keeps to his lane and his place unless it says
    // otherwise)
    G.x = LANES[this.beatLane];
    G.w = 3.2;
    G.wz = 1.1;
    switch (this.beat) {
      case 'totter': {
        // tottering about where he is
        G.dz = clamp(this.dz, -0.5, 2.5);
        if (t > 0.6 && this.fxT.totter <= 0) {
          this.endBeat();
          this.cheer(0.6);
        }
        break;
      }
      case 'shake': {
        G.dz = clamp(this.dz, 0, 2.5);
        if (this.fxT.shake <= 0 && t > 0.3) {
          this.endBeat();
          this.lookFor(0.8, 'camera');
          this.cheer(0.9);
        }
        break;
      }
      case 'bask': {
        // slowing up level with you, face to the light
        G.dz = 0.4;
        G.wz = 0.9;
        this.lookAt = { x: this.x, y: 20, dz: this.dz + 4 };
        this.lookT = 0.2;
        if (this.fxT.bask <= 0 && t > 0.5) this.endBeat();
        break;
      }
      case 'bounce': {
        // hop, hop, hop: each one as soon as he's down from the last
        G.dz = clamp(this.dz, 0.5, 2.5);
        if (this.grounded && !this.windup && this.hops > 0 && t > 0.15) {
          if (this.canLeap(0.9)) {
            this.jump(rand(0.26, 0.4), 'hop');
            this.hops--;
            this.cheer(0.8);
          } else this.hops = 0;
        }
        if (this.hops <= 0 && this.grounded && !this.windup) this.endBeat();
        if (t > 5) this.endBeat();
        break;
      }
      case 'dawdle': {
        // drifting back, distracted - then, realising, hurrying back up
        // (only with the road clear: anything coming, and he gives it up)
        if (!this.openRoad(this.x, 1.6)) {
          this.endBeat();
          break;
        }
        if (this.stage === 0) {
          G.dz = this.C.behind * 0.6;
          G.wz = 0.9;
          this.lookFor(0.3, { x: this.x + 3, y: 0.3, dz: this.dz - 4 });
          if (t > 1.5 || this.dz < this.C.behind * 0.6) {
            this.stage = 1;
            this.lookFor(0.6, 'runner');
            this.mood.earsBack = 0.8;
          }
        } else {
          G.dz = 1.4;
          G.wz = 2.1;
          this.fxT.flail = 0.3;
          if (this.dz > 0.9 || t > 6) {
            this.endBeat();
            this.cheer(0.8);
          }
        }
        break;
      }
      case 'sway': {
        // weaving to and fro across his lane, leaning into each swing
        const ph = Math.sin(t * 2.4);
        G.x = LANES[this.beatLane] + 0.55 * ph;
        G.w = 4.5;
        G.dz = 1.2;
        this.swayDir = Math.cos(t * 2.4);
        this.fxT.sway = 0.3;
        if (Math.random() < dt * 0.6) this.lookFor(0.8, 'camera');
        if (t > 3.2) this.endBeat();
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
}
