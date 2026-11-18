import { CONFIG } from '../config.js';
import { clamp } from './rig.js';
import { Companion } from './companion.js';
import { ZAP } from './thistle.js';

// Teasel's mind: the storm thistle who runs with you (see thistle.js for its
// body). Built on the fox's (companion.js) for everything that keeps it safe
// - reading the road, round the walls, over the hurdles, out from under your
// feet - and how it gathers and sheds speed; but it runs as a seedpod on
// three roots runs: a quick scurry a lane over, never far from you.
//
// What's its own is the static. Every step it takes builds it (more the
// faster it goes): its crown lifts, fans and parts, and once it's full the
// sparks start snapping (the body draws all of that from `charge`). Full,
// it can travel through a spark: whenever it's fallen behind - a hurdle, a
// wall, a dawdle - it picks a clear spot up beside you and goes there along
// a bolt, arriving braced; the crown falls loose and the charge starts again
// from nothing. And if it's been full a while with no need to, it drops back
// on purpose, for the joy of it.
//
// It can catch the air, too: over the top of a hop or a leap, now and then,
// its crown holds it up and it glides a moment before it lands - and is
// straight back into its stride.
//
// Its ideas, every few seconds:
//   - glide: a hop up into the air, and a glide down;
//   - dash: a quick scurry out ahead, a look back at you;
//   - dawdle: it falls behind, distracted - and either sparks back up to you
//     (full) or scurries back in a hurry;
//   - fetch: a gem in another lane (the fox's), caught in its crown.
// On the title screen it sits by the runner, its charge creeping up; picked,
// it hops and its crown crackles. A stumble jolts some of its charge out of
// it; a crash, all of it.

const LANES = CONFIG.laneX;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Scurrier extends Companion {
  reset(title) {
    this.charge = title ? 0.3 : 0;
    this.fullT = 0;
    this.holdT = rand(...this.C.zap.hold);
    this.zap = null;
    this.gliding = 0;
    this.gNow = this.C.gravity;
    super.reset(title);
    this.body.charge = this.charge;
    this.body.glide = 0;
  }

  // --- what happens to the runner ---------------------------------------------------
  // (the run starts: whatever it built up waiting, it starts from nothing)
  start() {
    super.start();
    if (this.charge > 0.3) this.body.crown.crackleAcc += 2;
    this.charge = 0;
  }

  greet() {
    if (!this.grounded || this.zap) return;
    this.jump(0.32, 'hop');
    this.cheer(1.4);
    this.body.flick();
    this.body.crown.crackleAcc += 3;
  }

  stumbled() {
    super.stumbled();
    // (jolted: some of the static leaks out of it in a crackle)
    if (this.charge > 0.5) this.body.crown.crackleAcc += 2;
    this.charge *= 0.7;
  }

  crashed() {
    super.crashed();
    if (this.charge > 0.3) this.body.crown.crackleAcc += 3;
    this.charge = 0;
  }

  powerBegin() {
    super.powerBegin();
    this.zap = null;
  }

  wholeRun() {
    this.cheer(1.3);
    if (Math.random() < 0.4 && !this.beat && !this.fetching && !this.zap && this.grounded && this.canLeap(1.6)) this.startBeat('glide');
  }

  // --- the frame ---------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    // the static: built by every step it takes, faster the faster it goes;
    // on the title screen it creeps up, to show
    if (g.state === 'running' && this.grounded && !this.zap) this.charge = Math.min(1, this.charge + (dt * clamp(g.speed / 12, 0.5, 1.6)) / this.C.charge.full);
    else if (g.state === 'title') this.charge += (0.55 - this.charge) * (1 - Math.exp(-dt * 0.15));
    this.fullT = this.charge >= 1 ? this.fullT + dt : 0;
    super.update(dt);
    // (now and then a spark in its crown ticks)
    const cr = this.body.crown;
    if (cr.snapped) {
      if (g.state === 'running' && Math.random() < 0.3) g.audio?.crackle?.(clamp(this.x / 3, -1, 1));
      cr.snapped = 0;
    }
  }

  place(dt) {
    super.place(dt);
    const b = this.body;
    const ctx = this.ctx;
    // (its own gravity while it glides; slowed to a braced shuffle as it
    // arrives through a spark)
    if (!this.grounded) ctx.fall = this.gNow;
    if (this.air) ctx.airKind = this.gliding > 0.5 ? 'glide' : this.air.kind;
    ctx.speed *= 1 - 0.6 * b.brace;
    b.glide += ((this.gliding > 0 ? 1 : 0) - b.glide) * (1 - Math.exp(-(dt || 0) * 9));
    b.charge = this.charge;
    b.act = { idle: this.game.state === 'title' || this.sitting ? 1 : 0 };
  }

  // Over the top, now and then, it glides: held up by its crown, sinking
  // slowly, for a moment.
  fall(dt) {
    const C = this.C.glide;
    if (this.vy < 0 && this.air && this.air.glide && this.air.t - this.air.top < C.max) {
      this.gliding = 1;
      // (the more charged, the wider its crown and the slower it sinks)
      this.gNow = this.C.gravity * C.fall * (1.15 - 0.3 * this.charge);
      if (this.vy < -C.sink) this.vy += (-C.sink - this.vy) * (1 - Math.exp(-dt * 10));
    } else {
      this.gliding = 0;
      this.gNow = this.C.gravity;
    }
    if (this.air && this.vy <= 0 && this.air.top === undefined) this.air.top = this.air.t;
    const G = this.gNow;
    this.y += this.vy * dt - 0.5 * G * dt * dt;
    this.vy -= G * dt;
    this.air.t += dt;
    if (this.y <= 0 && this.vy < 0) {
      this.y = 0;
      const hit = clamp(-this.vy / 8, 0.3, 1.4);
      this.vy = 0;
      this.grounded = true;
      this.gliding = 0;
      this.gNow = this.C.gravity;
      this.body.land(hit);
    }
  }

  // (a leap over a hurdle glides now and then; a glide's hop always does)
  launch(H, kind) {
    super.launch(H, kind === 'glide' ? 'hop' : kind);
    if (this.air) this.air.glide = kind === 'glide' || (kind === 'leap' && Math.random() < this.C.glide.chance);
  }

  // --- thinking ------------------------------------------------------------------------
  think(dt) {
    if (this.zap) return this.zapStep(dt);
    if (this.sitting) this.sitting = false;
    // full a while, or fallen behind: through a spark, up to you
    if (this.charge >= 1 && this.canZap()) {
      const behind = this.dz < this.C.zap.behind;
      if ((behind || (this.beat === 'dawdle' && this.stage === 1)) && this.tryZap()) return;
      if (this.fullT > this.holdT && !this.beat && !this.fetching) this.startBeat('dawdle');
    }
    super.think(dt);
  }

  safety() {
    if (this.zap) return;
    super.safety();
  }

  move(dt) {
    if (this.zap) {
      // (braced where it stands while the bolt finds its mark: the road
      // goes by under it)
      const g = this.game;
      if (!this.zap.there) {
        this.vdz = -g.speed;
        this.dz += this.vdz * dt;
        this.vx = 0;
      }
      return;
    }
    super.move(dt);
  }

  canZap() {
    const p = this.game.player;
    return this.grounded && !this.windup && !this.fetching && !this.power && this.game.state === 'running' && !p.dead;
  }

  // Where to go: a lane beside yours, a little ahead, with the road clear
  // round the spot it lands on.
  tryZap() {
    const g = this.game;
    const p = g.player;
    const Z = this.C.zap;
    const T = ZAP.lock + ZAP.travel;
    const lane = this.laneOf(p.x);
    // (mostly the nearer lane beside you; now and then across the road)
    const lanes = [0, 1, 2].filter((l) => l !== lane).sort((a, b) => Math.abs(LANES[a] - this.x) - Math.abs(LANES[b] - this.x));
    if (Math.random() < 0.35) lanes.reverse();
    for (const l of lanes) {
      const ahead = rand(Z.land[0], Z.land[1]);
      const d = g.dist + g.speed * T + ahead;
      // (clear round the spot, and nothing tall just short of it to hide it
      // from you)
      if (this.blocked(LANES[l], d - 4.5, d + Math.max(g.speed, 8) * 1.1)) continue;
      const from = { x: this.x, y: this.y + (this.lift || 0), d: g.dist + this.dz };
      const to = { x: LANES[l], y: 0, d };
      if (Math.abs(to.d - from.d) > 18) continue;
      this.endBeat();
      this.zap = { to, lane: l, t: 0, there: false };
      this.body.zap(from, to);
      g.audio?.zap?.(clamp(from.x / 3, -1, 1));
      this.lookFor(0.6, { x: to.x, y: 0.2, dz: ahead });
      return true;
    }
    return false;
  }

  // Anything at all in the way round x between d0 and d1 - climbs (a
  // market stall, a cart) included, which the road-reading leaves to the
  // leaps.
  blocked(x, d0, d1) {
    for (const o of this.game.obstacles.records) {
      if (o.d + o.len < d0 || o.d > d1) continue;
      if (Math.abs(x - o.x) <= o.hw + this.hw + 0.3) return true;
    }
    return false;
  }

  zapStep(dt) {
    const g = this.game;
    const Z = this.zap;
    Z.t += dt;
    const b = this.body;
    if (!Z.there && b.zapReady) {
      // there: at the far end of the bolt, braced
      Z.there = true;
      this.x = Z.to.x;
      this.vx = 0;
      this.dz = Z.to.d - g.dist;
      this.vdz = 0;
      this.y = 0;
      this.goal.x = this.x;
      this.goal.dz = this.dz;
      this.yaw = 0;
      b.arrive();
      this.lookFor(0.7, 'runner');
      g.audio?.zap?.(clamp(this.x / 3, -1, 1), true);
      this.cheer(1.2);
    }
    if (Z.there && Z.t >= ZAP.lock + ZAP.travel + ZAP.loose && this.charge > 0) {
      // a beat later its crown falls loose: it starts building again
      this.charge = 0;
      this.holdT = rand(...this.C.zap.hold);
    }
    // (if the run's over before it gets there, it's there anyway)
    if ((Z.there && Z.t > ZAP.lock + ZAP.travel + ZAP.loose + 0.05) || Z.t > 2) {
      if (!Z.there) {
        this.x = Z.to.x;
        this.dz = Z.to.d - g.dist;
        b.arrive();
      }
      this.zap = null;
      this.charge = 0;
      this.restT = rand(1, 2);
      this.slot = null;
    }
  }

  // --- scurrying beside you -------------------------------------------------------------
  escort(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    if (!this.slot || (this.slotT -= dt) <= 0) {
      const lane = this.laneOf(p.x);
      const others = [0, 1, 2].filter((l) => l !== lane);
      const ahead = Math.random() < 0.2;
      this.slot = { lane: ahead ? lane : pick(others), dz: ahead ? rand(2.6, 3.6) : rand(-0.6, 2.4), off: rand(-0.3, 0.3) };
      this.slotT = rand(2.5, 5);
      if (Math.random() < 0.35) this.lookFor(rand(0.5, 1.1), Math.random() < 0.6 ? 'runner' : 'camera');
    }
    G.x = LANES[this.slot.lane] + this.slot.off;
    G.dz = this.slot.dz;
    G.w = 4.2;
    G.wz = 1.5;
    G.low = 0;
  }

  chooseBeat() {
    const g = this.game;
    const p = g.player;
    const opts = [
      ['glide', this.canLeap(1.6) && this.openRoad(this.x, 1.8) ? 1.4 : 0],
      ['dash', this.openRoad(this.x, 2.5) ? 1.2 : 0],
      ['dawdle', p.grounded && this.openRoad(this.x, 3) ? 1.0 : 0],
    ];
    if (this.lastBeat) for (const o of opts) if (o[0] === this.lastBeat) o[1] *= 0.3;
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
    const lane = this.laneOf(this.game.player.x);
    const others = [0, 1, 2].filter((l) => l !== lane);
    this.beatLane = this.laneOf(this.x) !== lane ? this.laneOf(this.x) : pick(others);
  }

  beatStep(dt) {
    const g = this.game;
    const G = this.goal;
    this.beatT += dt;
    const t = this.beatT;
    G.x = LANES[this.beatLane];
    G.w = 4.2;
    G.wz = 1.5;
    switch (this.beat) {
      case 'glide': {
        // up, and a glide down
        G.dz = clamp(this.dz, 0.5, 3);
        if (this.stage === 0 && this.grounded && !this.windup && t > 0.1) {
          if (this.canLeap(1.4)) {
            this.jump(this.C.glide.hop, 'glide');
            this.cheer(1.2);
            this.stage = 1;
          } else this.endBeat();
        } else if (this.stage === 1 && this.grounded && !this.windup) this.endBeat();
        if (t > 4) this.endBeat();
        break;
      }
      case 'dash': {
        // a quick scurry out ahead, then a look back
        G.dz = 4.6;
        G.wz = 2.6;
        if (this.stage === 0 && this.dz > 3.8) {
          this.stage = 1;
          this.lookFor(1.0, 'camera');
          this.cheer(0.8);
        }
        if (t > 3) this.endBeat();
        break;
      }
      case 'dawdle': {
        // it falls behind, looking at something - then realises, and either
        // sparks back (think: full) or scurries back up in a hurry
        if (!this.openRoad(this.x, 1.6) && this.stage === 0) {
          this.endBeat();
          break;
        }
        if (this.stage === 0) {
          G.dz = this.C.behind * 0.9;
          G.wz = 1.0;
          this.lookFor(0.3, { x: this.x + 2.5, y: 0.3, dz: this.dz - 4 });
          if (t > 1.8 || this.dz < this.C.behind * 0.7) {
            this.stage = 1;
            this.lookFor(0.6, 'runner');
            this.mood.earsBack = 0.6;
          }
        } else {
          G.dz = 1.4;
          G.wz = 2.4;
          if (this.dz > 0.9 || t > 6) {
            this.endBeat();
            this.cheer(0.8);
          }
        }
        break;
      }
      default:
        this.endBeat();
    }
  }

  canWhirl() {
    return false;
  }
}
