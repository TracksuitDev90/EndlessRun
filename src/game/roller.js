import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { clamp } from './rig.js';
import { Companion } from './companion.js';

// Knotling's mind: the living knot who runs with you (see knotling.js for
// his body). He goes by rolling, swinging and reshaping himself, and he
// keeps to one place: beside you and a little behind, out of the way of you
// and of what's coming (a lane's width in from the edge of the road on
// whichever side of you there's room, never in front of you on the screen).
// It's all for show: nothing he does touches the run.
//
//   - rolling is his natural pace: he rolls along at your speed, turned by
//     exactly as far as he's rolled over the ground;
//   - now and then - about three tenths of the way, over a stretch of road,
//     with stretches of plain rolling in between so each swing is a choice
//     (CONFIG.companion.knot.swing) - he swings, the way a monkey swings on a
//     vine, except he brings his own: he bunches and hops, feeding part of
//     himself out ahead and up into an open ring (the rest of him drawing
//     smaller as it goes); its far end catches on a point in the air, the
//     slack pulls taut, and his weight swings down under it and forward in an
//     arc; at the far end he lets go, draws the loop back into himself as he
//     flies, lands with a squash and rolls straight on with what he carried;
//     all of it on his own side of you;
//   - a hurdle he jumps (bunching his lower loops against the ground and
//     pushing off with them); a bar he slides under (his top loops slip out
//     and he skims under it low and wide, then gathers himself back up); a
//     wall he rolls round.
// His eyes look at you - and now and then he glances right up at you.
//
// From the fox's mind he keeps reading the road (round the walls, over the
// hurdles), how he gathers and sheds speed, the title screen and what he
// does when you stumble or go down. No abilities yet (powers.js has none
// for him), and he fetches no gems: where he is, is all he's for, for now.

const LANES = CONFIG.laneX;
const _a = new THREE.Vector3();
const _turn = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const ease = (t) => t * t * (3 - 2 * t);

export class Roller extends Companion {
  reset(title) {
    this.swing = null;
    this.side = 1;
    this.rolled = 0;
    this.swung = 0;
    this.swingIn = rand(2.5, 4);
    this.glanceT = rand(2, 5);
    this.glancing = 0;
    // his ideas between swings (see ideas), and what he's copying of you
    this.ideaT = rand(1.5, 3);
    this.lastIdea = null;
    this.hops = [];
    this.wobbleT = 0;
    this.copyT = 0;
    this.lowT = 0;
    this.wasPJ = false;
    this.wasPS = false;
    this.ph = [rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)];
    super.reset(title);
    this.fetchT = 1e9;
    const b = this.body;
    b.ringOut = 0;
    b.ringTaut = 0;
    b.turn = null;
  }

  // --- what happens to the runner ---------------------------------------------------
  // Picked: he hops, and waves a lobe of himself at you.
  greet() {
    if (this.grounded && !this.swing) this.jump(0.32, 'hop');
    this.hops = [0.22];
    this.body.wave(_a.copy(this.game.cam.camera.position).sub(this.body.root.position), 1.6);
    this.body.peek(Math.PI, 0.35, 1.8);
    this.cheer(1.4);
    this.lookFor(1.4, 'camera');
  }

  // You stumbled: a shudder through every loop, and his eyes round on you.
  stumbled() {
    this.mood.earsBack = 1.1;
    this.lookFor(1.2, 'runner');
    this.glancing = 0.9;
    this.body.shake(0.3);
    this.body.peek(this.body.runnerSide * Math.PI * 0.6, 0.3, 1.4);
  }

  revived() {
    super.revived();
    this.hops = [0.3, 0.2];
  }

  crashed() {
    this.letGo();
    super.crashed();
  }

  powerBegin() {
    this.letGo();
    super.powerBegin();
  }

  // A whole run of gems: delighted - a wave, and a bounce or two.
  wholeRun() {
    this.cheer(1.4);
    if (this.swing || !this.grounded) return this.body.flick();
    this.body.wave(_a.set(this.game.player.x - this.x, 0, -0.3), 1.3);
    if (Math.random() < 0.6) this.hops = [0.26, 0.18];
  }

  // --- the frame ---------------------------------------------------------------------
  update(dt) {
    super.update(dt);
    const g = this.game;
    if (g.state === 'running') {
      // (how his time's been shared out, rolling and swinging)
      if (this.swing) this.swung += dt;
      else this.rolled += dt;
    }
  }

  think(dt) {
    if (this.sitting) this.sitting = false;
    if (this.power?.drive?.(this, dt)) return;
    // (his glances up at you)
    this.glanceT -= dt;
    if (this.glanceT <= 0) {
      this.glanceT = rand(3.5, 8);
      this.glancing = rand(0.6, 1.1);
      this.lookFor(this.glancing, 'runner');
    }
    if (this.swing) {
      this.swingStep(dt);
      return;
    }
    this.escort(dt);
    this.ideas(dt);
    this.swingIn -= dt;
    if (this.swingIn <= 0 && this.canSwing()) this.startSwing();
  }

  // --- his ideas ---------------------------------------------------------------------------
  // Between swings he's never just a ball rolling along: every few seconds
  // an idea (a wave of a lobe of himself at you; a run of bounces; a
  // shudder, every loop let loose and cinched tight again; a stretch,
  // drawn up tall; his eyes sent round to look back at you, or right round
  // him; a wobbly roll, rocking side to side), and he copies you - hopping
  // when you jump, flattening when you slide.
  ideas(dt) {
    const g = this.game;
    const p = g.player;
    const b = this.body;
    const G = this.goal;
    // copying you
    const pj = !p.grounded, ps = !!p.sliding;
    if (pj && !this.wasPJ && Math.random() < 0.4) this.copyT = rand(0.08, 0.18);
    if (ps && !this.wasPS && Math.random() < 0.55) this.lowT = rand(0.5, 0.8);
    this.wasPJ = pj;
    this.wasPS = ps;
    if (this.copyT > 0 && (this.copyT -= dt) <= 0 && this.grounded && !this.windup && this.canLeap(0.9)) this.jump(0.4, 'hop');
    if (this.lowT > 0) {
      this.lowT -= dt;
      G.low = 1;
    }
    // bouncing on, one after another
    if (this.hops.length && this.grounded && !this.windup) {
      if (this.canLeap(0.8)) this.jump(this.hops.shift(), 'hop');
      else this.hops.length = 0;
    }
    // a wobbly roll: rocking, weaving a little across his line
    if (this.wobbleT > 0) {
      this.wobbleT -= dt;
      G.x += 0.2 * Math.sin(g.time * 5.2);
    }
    b.wobble += ((this.wobbleT > 0 ? 1 : 0) - b.wobble) * (1 - Math.exp(-dt * 4));
    this.ideaT -= dt;
    if (this.ideaT > 0 || this.hops.length || !this.grounded || this.windup || G.low || this.wobbleT > 0) return;
    const I = this.C.ideas;
    this.ideaT = rand(I.every[0], I.every[1]);
    const near = Math.abs(p.x - this.x) < 2.6;
    const opts = [
      ['wave', near ? 1 : 0.2],
      ['bounce', this.canLeap(1.4) ? 1.1 : 0],
      ['shake', 0.8],
      ['stretch', 0.6],
      ['peek', 0.9],
      ['circle', 0.6],
      ['wobble', this.openRoad(this.x, 2.5) ? 0.7 : 0],
    ];
    for (const o of opts) if (o[0] === this.lastIdea) o[1] *= 0.15;
    let r = Math.random() * opts.reduce((a, o) => a + o[1], 0);
    let pick = opts[0][0];
    for (const [n, w] of opts) if ((r -= w) <= 0 && w > 0) {
      pick = n;
      break;
    }
    this.lastIdea = pick;
    switch (pick) {
      case 'wave':
        b.wave(_a.set(p.x - this.x, 0, -0.35), rand(1.1, 1.7));
        b.peek(b.runnerSide * Math.PI * 0.55, 0.35, 1.6);
        this.lookFor(1.3, 'runner');
        this.glancing = 1.1;
        this.cheer(1.2);
        break;
      case 'bounce':
        this.hops = Math.random() < 0.5 ? [0.24, 0.36, 0.18] : [0.3, 0.2];
        this.cheer(1.2);
        break;
      case 'shake':
        b.shake(rand(0.4, 0.65));
        break;
      case 'stretch':
        b.stretchUp(rand(0.45, 0.7));
        this.lookFor(0.9, 'camera');
        break;
      case 'peek':
        b.peek(Math.PI + rand(-0.4, 0.4), rand(0.2, 0.5), rand(1.3, 2));
        this.lookFor(1.2, 'camera');
        break;
      case 'circle':
        b.circleEyes(rand(1.6, 2.4), Math.random() < 0.5 ? 1 : -1);
        break;
      case 'wobble':
        this.wobbleT = rand(1.6, 2.6);
        break;
    }
  }

  // --- beside you, a little behind ------------------------------------------------------
  // The slot on the side of you he's on (or, if that's off the road, the
  // other); he changes sides only when he must, and goes round behind you
  // to do it.
  escort() {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    const S = this.C.slot;
    const px = LANES[clamp(p.lane ?? this.laneOf(p.x), 0, 2)];
    const at = (s) => px + s * S.off;
    const ok = (s) => Math.abs(at(s)) <= S.edge;
    if (!ok(this.side)) this.side = -this.side;
    // (the other side's nearer where he is now by a good way: he takes it)
    else if (ok(-this.side) && Math.abs(at(-this.side) - this.x) < Math.abs(at(this.side) - this.x) - 0.6) this.side = -this.side;
    // (never quite still in it: drifting forward and back a little,
    // and across)
    const t = g.time;
    G.x = at(this.side) + 0.1 * Math.sin(t * 0.8 + this.ph[0]);
    G.dz = S.dz + 0.24 * Math.sin(t * 0.63 + this.ph[1]) + 0.1 * Math.sin(t * 1.7 + this.ph[2]);
    G.w = 5;
    G.wz = 2;
    G.low = 0;
    // you're coming across his line (a lane change his way), or he's going
    // round behind you: he holds his line until you're by and drops back -
    // far enough that he's under the camera's view of your feet, so you're
    // never hidden and never run into him
    const moving = Math.abs(p.x - px) > 0.15;
    const across = moving && (p.x - this.x) * (px - this.x) < 0;
    if (across || Math.abs(p.x - this.x) < S.off * 0.8) {
      G.dz = S.back;
      G.wz = 7;
      // (mid-change, coming his way: he waits where he is)
      if (across) G.x = this.x;
    }
  }

  // As the fox reads the road, and: a bar over his line he slides under,
  // low and wide.
  safety() {
    if (this.swing) return;
    super.safety();
    const g = this.game;
    const G = this.goal;
    const vf = Math.max(g.speed + this.vdz, 2);
    const df = g.dist + this.dz;
    if (this.threat(this.x, df - 1.4, df + vf * this.C.duck + 1.2, 'H')) G.low = 1;
    // walled into your lane: he drops back behind you (below the camera's
    // view of you) rather than dashing past you - unless he's ahead already,
    // or level and on his way forward (back would take him through you):
    // then on ahead
    const p = g.player;
    if (Math.abs(this.x - p.x) < 0.8 && this.dz < 1.4 && this.dz > -2.2) {
      if (this.dz > 0.6 || (this.dz > -0.3 && this.vdz > 0.5)) G.dz = Math.max(G.dz, 2.4);
      else {
        G.dz = Math.min(G.dz, this.C.slot.back - 0.4);
        G.wz = Math.max(G.wz, 7);
      }
    }
  }

  // --- swinging ---------------------------------------------------------------------------
  // Clear road ahead for the whole of it, on the ground, nothing else on.
  canSwing() {
    const g = this.game;
    if (g.state !== 'running' || !this.grounded || this.windup || this.goal.low || this.lowNowish() || this.hops.length || this.wobbleT > 0) return false;
    if (Math.abs(this.x - this.goal.x) > 0.5 || Math.abs(this.vx) > 2) return false;
    const S = this.C.swing;
    // (nothing anywhere near his line - a wall beside it would meet the
    // ring - for as long as the swing takes)
    for (const dx of [0, -0.45, 0.45]) if (!this.openRoad(this.x + dx, S.clear)) return false;
    return true;
  }

  lowNowish() {
    return (this.body.lowNow || 0) > 0.05;
  }

  startSwing() {
    const S = this.C.swing;
    const G = this.C.gravity;
    // the arc: a point in the air ahead of him and up, the length of rope
    // from it to his middle, and how far round he swings either side of
    // straight under it
    const l = S.length;
    const th = S.angle;
    const v0 = Math.sqrt(2 * G * S.hop);
    const tUp = v0 / G;
    const R = this.body.cy || 0.36;
    // where his middle will be at the top of his hop - the ring catches there
    const dzC = this.dz + this.vdz * (S.gather + tUp);
    const yC = S.hop + R;
    this.swing = {
      stage: 'gather',
      t: 0,
      l,
      th,
      v0,
      tUp,
      ax: this.x + this.side * S.out,
      adz: dzC + l * Math.sin(th),
      ay: yC + l * Math.cos(th),
      out: 0,
      taut: 0,
    };
    this.windup = { t: 0, dur: S.gather, H: 0, kind: 'leap' };
    this.lookFor(0.7, { x: this.swing.ax, y: this.swing.ay, dz: this.swing.adz });
  }

  swingStep(dt) {
    const W = this.swing;
    const S = this.C.swing;
    W.t += dt;
    if (W.stage === 'gather') {
      // bunched, about to go
      if (this.windup) this.windup.t = W.t;
      if (W.t >= S.gather) {
        this.windup = null;
        W.stage = 'reach';
        W.t = 0;
        this.grounded = false;
        this.vy = W.v0;
        this.air = { t: 0, T: W.tUp * 2, kind: 'leap' };
        this.y0 = this.y;
        this.dz0 = this.dz;
      }
    } else if (W.stage === 'reach') {
      // up off the ground, the ring feeding out toward the point
      const k = clamp(W.t / W.tUp, 0, 1);
      W.out = 1 - (1 - k) * (1 - k);
      if (k >= 1) {
        // caught: from here he hangs from it
        W.stage = 'hang';
        W.t = 0;
        const R = this.body.cy || 0.36;
        const cy = this.y + R;
        W.l = Math.hypot(this.dz - W.adz, W.ay - cy);
        // (he's behind it and under it: the swing starts that far back)
        W.th0 = Math.abs(Math.atan2(this.dz - W.adz, W.ay - cy));
        W.T = S.period * Math.sqrt(W.l / S.length);
      }
    } else if (W.stage === 'hang') {
      W.taut = Math.min(1, W.taut + dt / 0.07);
      W.out = 1;
      if (W.t > S.release * W.T || this.game.state !== 'running') this.letGo();
    } else if (W.stage === 'back') {
      // let go: the loop drawn back into him as he flies
      W.out = Math.max(0, W.out - dt / S.back);
      W.taut = Math.max(0, W.taut - dt * 6);
      this.escort(dt);
      if (W.out <= 0 && this.grounded) {
        this.swing = null;
        // (then rolling a while: long enough each swing's a choice, and on
        // the whole about the share of the time the tuning asks for)
        const share = this.swung / Math.max(1, this.rolled + this.swung);
        const mean = (S.time * (1 - S.share)) / S.share;
        const lean = share > S.share ? 1.25 : share > S.share * 0.85 ? 0.8 : 0.45;
        this.swingIn = clamp(mean * lean * rand(0.55, 1.5) * (Math.random() < 0.18 ? 1.8 : 1), S.gap[0], S.gap[1]);
      }
    }
  }

  // Let go of the point (or never reach it): he flies on with what he has,
  // and draws the loop back in.
  letGo() {
    const W = this.swing;
    if (!W) return;
    if (W.stage === 'gather') {
      this.windup = null;
      this.swing = null;
      return;
    }
    if (W.stage === 'back') return;
    if (W.stage === 'hang') {
      const w = this.swingRate(W);
      const th = this.swingAngle(W);
      this.vdz = W.l * w * Math.cos(th);
      this.vy = W.l * w * Math.sin(th);
    }
    W.stage = 'back';
    W.t = 0;
    W.taut = 0.4;
    if (this.grounded) return;
    const G = this.C.gravity;
    this.air = { t: 0, T: Math.max(0.2, (this.vy + Math.sqrt(this.vy * this.vy + 2 * G * Math.max(0, this.y))) / G), kind: 'leap' };
  }

  // the pendulum: its angle from straight down (+ ahead) and how fast it's
  // turning, t into the swing
  swingAngle(W) {
    return -W.th0 * Math.cos((Math.PI * W.t) / W.T);
  }

  swingRate(W) {
    return ((W.th0 * Math.PI) / W.T) * Math.sin((Math.PI * W.t) / W.T);
  }

  move(dt) {
    const W = this.swing;
    if (!W || W.stage === 'back') {
      super.move(dt);
      return;
    }
    // (holding his line across while he swings)
    this.vx *= Math.exp(-dt * 6);
    this.x += this.vx * dt;
    if (W.stage === 'gather') return;
    if (W.stage === 'reach') {
      // the hop: up, and on at the pace he had
      this.y += this.vy * dt - 0.5 * this.C.gravity * dt * dt;
      this.vy -= this.C.gravity * dt;
      this.air.t += dt;
      this.dz += this.vdz * dt;
      return;
    }
    // hanging: under the point, round the arc
    const th = this.swingAngle(W);
    const R = this.body.cy || 0.36;
    const dzN = W.adz + W.l * Math.sin(th);
    const cyN = Math.max(R + 0.05, W.ay - W.l * Math.cos(th));
    this.vdz = (dzN - this.dz) / Math.max(dt, 1e-4);
    this.vy = (cyN - R - this.y) / Math.max(dt, 1e-4);
    this.dz = dzN;
    this.y = cyN - R;
    this.air.t += dt;
  }

  // --- placing him --------------------------------------------------------------------------
  place(dt) {
    super.place(dt);
    const g = this.game;
    const b = this.body;
    const W = this.swing;
    // the ring, and while he hangs from it, his turn about the point
    if (W && W.stage !== 'gather') {
      b.ringOut = ease(clamp(W.out, 0, 1));
      b.ringTaut = W.taut;
      b.ringAt.set(W.ax, W.ay, this.pz - W.adz);
    } else {
      b.ringOut = 0;
      b.ringTaut = 0;
    }
    if (W && W.stage === 'hang') b.turn = _turn.set(this.swingRate(W), 0, 0);
    else if (W && W.stage === 'reach') b.turn = _turn.multiplyScalar(0.9);
    else if (!this.grounded && Number.isFinite(g.speed)) {
      // flying: easing toward the roll he'll land into, so it carries on
      const r = b.cy || 0.36;
      _a.set(-(g.speed + this.vdz) / r, 0, -this.vx / r);
      b.turn = _turn.lerp(_a, 1 - Math.exp(-(dt || 0) * 3));
    } else b.turn = null;
    if (!b.turn) _turn.set(0, 0, 0);
    // where his eyes look: you (or the camera, or whatever he's looking at)
    const pl = g.player;
    b.runnerSide = pl.x >= this.x ? 1 : -1;
    const at = (b.gazeAt ||= new THREE.Vector3());
    if (this.lookT > 0 && this.lookAt === 'camera') at.copy(g.cam.camera.position);
    else if (this.lookT > 0 && this.lookAt && this.lookAt !== 'runner') at.set(this.lookAt.x, this.lookAt.y, this.pz - this.lookAt.dz);
    else at.set(pl.x, pl.y + 1.45, this.pz);
    this.glancing = Math.max(0, this.glancing - (dt || 0));
    b.glance += ((this.glancing > 0 ? 1 : 0) - (b.glance || 0)) * (1 - Math.exp(-(dt || 0) * 10));
  }
}
