import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';
import { clamp } from './rig.js';

// A companion who flies (the first, Iris the wind dragon - see
// companions.js): her mind. As the fox's (companion.js) it's almost all for
// show, but for the gems she fetches, and it answers the same calls from the
// game (start, greet, stumbled, crashed, revived, wholeRun).
//
// She is mostly in the air, and she keeps out of your way: the runner and
// the road just ahead of them are yours. Her place is a lane over from you,
// a little ahead and a couple of metres up, where she glides along on the
// wind, never quite still - weaving lazily, rising and falling, drifting
// ahead and dropping back - her body flowing after her head (dragon.js).
// When you swerve into her lane she lifts clear over you before she slips
// aside; when she changes sides she goes high and ahead, never across you
// low. Every few seconds she gets an idea (a "beat"):
//   - soar: up high and over to your other side, then down again;
//   - skim: down along her lane, a hand's breadth off the road, whiskers
//     streaming, and up again;
//   - linger: drops back level with you, low, and looks at you a while;
//   - corkscrew: tears ahead rolling over and over round her own length (a
//     treat; and when you take a whole run of gems);
//   - loop: a loop-the-loop ahead in her own lane, her body following her
//     head right round it like a ribbon (rarer still);
//   - fetch: spots a gem in a lane you're not in, swoops on it, snaps it up
//     and sends it to you.
// Under all of it she reads the road: she won't stay in a lane with a wall
// coming (they're too tall to fly over), keeps up over the hurdles, slips
// under the bars low or goes round them - in good time, for her whole long
// body has to follow her head through. When you go down she lands beside
// you, on all fours, and looks at you; on the title screen she stands up on
// her hind legs beside you, and twirls up into the air and down again to say
// hello.
//
// Positions are kept on the track, as the fox's are: x across it, y the
// height of her head (its pivot, at the top of her neck), dz how far ahead of
// the runner (- behind), in metres.

const LANES = CONFIG.laneX;
const BODY = 2.45; // nose to plume (m)
const HW = 0.16; // half her body's width, with her frills (m)
const MOUTH = [0.29, -0.05]; // her jaws: ahead of and below her head's pivot
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const easeD = (t) => 30 * t * t * (t - 1) * (t - 1);

// A critically damped spring toward target, solved exactly; [x, v] in out.
function follow(x, v, target, w, dt, out) {
  const e = Math.exp(-w * dt);
  const d = x - target;
  const j = (v + w * d) * dt;
  out[0] = target + (d + j) * e;
  out[1] = (v - w * j) * e;
  return out;
}
const _f = [0, 0];

export class Flyer {
  constructor(game, def, body) {
    this.game = game;
    this.def = def;
    this.body = body;
    this.C = CONFIG.companion.flyer;
    this.later = [];
    this.ctx = { mode: 'stand', head: new THREE.Vector3(), vel: new THREE.Vector3(), frameZ: 0, wind: 2, speed: 0, spot: new THREE.Vector3(), yaw: 0, swim: 1, spin: 0, upright: 1, loop: 0 };
    this.prevHead = new THREE.Vector3();
    this.reset(true);
  }

  get objects() {
    return this.body.objects;
  }

  reset(title) {
    const p = this.game.player;
    this.mode = 'stand';
    this.x = p.x + 1.2;
    this.y = 1.2;
    this.dz = 0.7;
    this.vx = this.vy = this.vdz = 0;
    this.off = { x: 0, y: 0, dz: 0 };
    this.script = null;
    this.spot = new THREE.Vector3(this.x, 0, 0);
    this.yaw = 0.4;
    this.yawV = 0;
    this.landing = null;
    this.goal = { x: this.x, y: 1.8, dz: 2, wx: 2.2, wy: 2.6, wz: 1.6, urgent: false };
    this.lane = 2;
    this.laneT = 0;
    this.runnerLane = p.lane ?? 1;
    this.cruise = 1.8;
    this.slotDz = 2.2;
    this.beat = null;
    this.beatT = 0;
    this.stage = 0;
    this.restT = rand(2, 4);
    this.fetchT = rand(5, 9);
    this.fetching = null;
    this.loopAt = -99;
    this.screwAt = -99;
    this.lastBeat = null;
    this.happyT = 0;
    this.alarmT = 0;
    this.lookT = 0;
    this.lookAt = null;
    this.idleT = rand(5, 9);
    this.idle = null;
    this.wind = 2;
    this.swim = 1;
    this.threading = 0;
    this.thread = 0;
    this.t = 0;
    this.title = !!title;
    this.later.length = 0;
    this.body.reset();
    if (Number.isFinite(this.game.dist)) {
      this.titleSpot(true);
      this.place(0);
    }
  }

  // --- what happens to the runner -------------------------------------------------
  start() {
    this.title = false;
    this.idle = null;
    this.script = null;
    this.off.x = this.off.y = this.off.dz = 0;
    this.takeOff(2.6, 2.2);
    this.restT = rand(2.5, 4);
    this.cheer(1);
  }

  // Picked on the title screen (or her runner changed): she twirls up into
  // the air round where she stands and comes down again.
  greet() {
    this.cheer(1.6);
    if (this.game.state !== 'title') return;
    if (this.script?.kind === 'twirl') return;
    this.idle = null;
    this.takeOff(0, 0);
    this.script = { kind: 'twirl', t: 0, dur: this.C.twirl, from: this.headTrack(new THREE.Vector3()) };
  }

  stumbled() {
    this.alarmT = 1.2;
    this.lookFor(1.1, 'runner');
    if (this.script && this.script.kind !== 'twirl') this.endScript();
  }

  crashed() {
    this.endBeat();
    this.fetching = null;
    this.endScript();
    this.alarmT = 1.6;
  }

  revived() {
    this.alarmT = 0;
    this.cheer(1.4);
    this.landing = null;
    if (this.mode !== 'fly') this.takeOff(2.4, 1.5);
  }

  wholeRun() {
    this.cheer(1.4);
    if (Math.random() < 0.35 && !this.beat && !this.fetching && !this.script && this.canScrew()) this.startBeat('corkscrew');
  }

  cheer(t) {
    this.happyT = Math.max(this.happyT, t);
  }

  lookFor(t, at) {
    this.lookT = t;
    this.lookAt = at;
  }

  // --- the frame -------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const st = g.state;
    this.t += dt;
    this.goal.urgent = false;
    if (st === 'title') this.titleStep(dt);
    else if (st === 'crashed' || (st === 'reviving' && g.speed < 0.5)) this.down(dt);
    else if (st === 'running' || st === 'reviving') {
      if (this.mode !== 'fly') this.takeOff(2.4, 1.5);
      this.think(dt);
      this.safety(dt);
    }
    if (this.mode === 'fly') this.fly(dt);
    this.scriptStep(dt);
    this.happyT = Math.max(0, this.happyT - dt);
    this.alarmT = Math.max(0, this.alarmT - dt);
    this.lookT = Math.max(0, this.lookT - dt);
    this.sparkLater();
    this.place(dt);
  }

  // --- where she is ----------------------------------------------------------------
  get pz() {
    return -(this.game.dist - this.game.origin);
  }

  // Her head on the track (anchor + any scripted flourish).
  headTrack(out) {
    return out.set(this.x + this.off.x, this.y + this.off.y, this.dz + this.off.dz);
  }

  place(dt) {
    const g = this.game;
    const b = this.body;
    const c = this.ctx;
    const pz = this.pz;
    c.speed = g.speed;
    c.frameZ = pz;
    c.mode = this.mode;
    c.spot.copy(this.spot);
    c.yaw = this.yaw;
    if (this.mode === 'fly') {
      this.headTrack(_p);
      c.head.set(_p.x, _p.y, pz - _p.z);
    } else {
      b.standHead(this.spot, this.yaw, this.mode, c.head);
      // (her anchor kept on her head, to take off from)
      this.x = c.head.x;
      this.y = c.head.y;
      this.dz = pz - c.head.z;
    }
    if (dt > 0) c.vel.subVectors(c.head, this.prevHead).divideScalar(dt);
    else c.vel.set(0, 0, -g.speed);
    this.prevHead.copy(c.head);
    // the wind she streams in: less in a loop (her body follows her head
    // right round), a breath of it standing still
    const sc = this.script;
    const loop = sc?.kind === 'loop' ? Math.sin(Math.PI * clamp(sc.t / sc.dur, 0, 1)) : 0;
    // (threading obstacles, the wind runs at the road's own speed: her body
    // follows exactly where her head has been, gap after gap)
    this.thread += ((this.threading ? 1 : 0) - this.thread) * (1 - Math.exp(-dt * (this.threading ? 8 : 1.5)));
    const free = lerp(this.C.wind[0] + this.C.wind[1] * g.speed, g.speed * 0.97, this.thread);
    const wantWind = g.state === 'title' ? 1.6 : lerp(free, 1.0, loop);
    this.wind += (wantWind - this.wind) * (1 - Math.exp(-dt * 4));
    c.wind = this.wind;
    c.loop = loop;
    c.upright = 1 - loop;
    c.spin = sc?.kind === 'corkscrew' ? sc.spin : 0;
    c.swim += ((this.swim ?? 1) - c.swim) * (1 - Math.exp(-dt * 3));
    b.happy = this.happyT > 0 ? 1 : 0;
    b.alarm = this.alarmT > 0 ? 1 : 0;
    b.wet = g.current?.def.env.bubbles ? 1 : 0;
    // where she's looking
    let at = null;
    if (this.lookT > 0 && this.lookAt) {
      if (this.lookAt === 'runner') at = _v.set(g.player.x, g.player.y + 1.4, pz);
      else if (this.lookAt === 'camera') at = _v.copy(g.cam.camera.position);
      else at = _v.set(this.lookAt.x, this.lookAt.y, pz - this.lookAt.dz);
    }
    b.lookAt = at ? (b._look || (b._look = new THREE.Vector3())).copy(at) : null;
    b.lookW += ((at ? 1 : 0) - b.lookW) * (1 - Math.exp(-(dt || 0) * 5));
    b.update(dt, c);
  }

  // --- moving through the air ---------------------------------------------------------
  // Toward her goal on critically damped springs, never faster or harder than
  // a dragon swims through air; and never quite still - a slow wander
  // (sines at odd rates) laid over wherever she means to be.
  fly(dt) {
    const g = this.game;
    const G = this.goal;
    const t = this.t;
    // (coming in to land, or to a gem, she holds steady)
    const calm = this.landing ? 0 : this.fetching ? 0.1 : this.script ? 0.3 : 1;
    const wx = (0.36 * Math.sin(t * 0.61) + 0.2 * Math.sin(t * 1.43 + 1)) * calm * (1 - 0.6 * this.thread);
    const wy = (0.2 * Math.sin(t * 0.71 + 2) + 0.1 * Math.sin(t * 1.63)) * calm * (1 - 0.6 * this.thread);
    const wz = (0.55 * Math.sin(t * 0.37 + 0.5) + 0.3 * Math.sin(t * 0.97 + 2)) * calm;
    const A = this.C.acc;
    const step = (pos, vel, target, w, amax, vmin, vmax) => {
      follow(pos, vel, target, w, dt, _f);
      const nv = clamp(clamp(_f[1], vel - amax * dt, vel + amax * dt), vmin, vmax);
      return nv;
    };
    const urgent = G.urgent ? 1.8 : 1;
    // (gliding along beside you, her wander kept on the screen too)
    let tx = G.x + wx;
    if (G.vis && !this.threading && !this.fetching && !this.beat) tx = clamp(tx, Math.min(G.x, G.vis[0]), Math.max(G.x, G.vis[1]));
    G.vis = null;
    this.vx = step(this.x, this.vx, tx, G.wx * urgent, A[0] * urgent, -this.C.vmax[0], this.C.vmax[0]);
    this.vy = step(this.y, this.vy, G.y + wy, G.wy * urgent, A[1] * urgent, -this.C.vmax[1], this.C.vmax[1]);
    this.vdz = step(this.dz, this.vdz, G.dz + wz, G.wz, A[2], this.C.surge[0], this.C.surge[1]);
    // (while you run she never flies backward over the ground)
    if (g.state === 'running' && g.speed + this.vdz < 0) this.vdz = -g.speed;
    this.x += this.vx * dt;
    this.y = Math.max(0.45, this.y + this.vy * dt);
    this.dz += this.vdz * dt;
  }

  takeOff(vy, vdz) {
    if (this.mode !== 'fly') {
      this.mode = 'fly';
      this.body.takeOff();
      this.vy = vy;
      this.vdz = vdz;
      this.vx = 0;
      this.goal.x = this.x;
      this.goal.y = this.y + 0.6;
      this.goal.dz = this.dz + 0.5;
    }
    this.landing = null;
  }

  // Fly her head to where it'll be standing at spot, then set down there.
  landAt(spot, yaw, mode, dt) {
    if (this.mode === mode) {
      this.spot.copy(spot);
      return true;
    }
    const L = this.landing || (this.landing = { spot: new THREE.Vector3(), yaw, mode, head: new THREE.Vector3() });
    L.spot.copy(spot);
    L.yaw = yaw;
    L.mode = mode;
    this.body.standHead(spot, yaw, mode, L.head);
    const G = this.goal;
    G.x = L.head.x;
    G.y = L.head.y;
    G.dz = this.pz - L.head.z;
    G.wx = G.wy = 3.2;
    G.wz = 3;
    this.headTrack(_p);
    const d = Math.hypot(_p.x - G.x, _p.y - G.y, _p.z - G.dz);
    const sp = Math.hypot(this.vx, this.vy, this.vdz);
    if (d < 0.3 && sp < 1.8) {
      this.mode = mode;
      this.spot.copy(spot);
      this.yaw = yaw;
      this.landing = null;
      this.body.land(0.7);
      this.vx = this.vy = this.vdz = 0;
      return true;
    }
    // (turning to face the way she'll stand as she comes in)
    this.turnYaw(yaw, 3, dt);
    return false;
  }

  turnYaw(want, k, dt) {
    let d = want - this.yaw;
    d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
    follow(0, this.yawV, d, k, dt, _f);
    this.yaw += _f[0];
    this.yawV = _f[1];
  }

  // --- the title screen ------------------------------------------------------------------
  // Standing up beside the runner, turned toward you, looking about; now and
  // then she goes down on all fours for a stretch, and back up.
  titleSpot(snap) {
    const g = this.game;
    const tall = (g.cam.aspect || 1) < 1.25;
    const x = g.player.x + (tall ? 1.25 : -1.2);
    const dz = tall ? 0.8 : -0.25;
    this.spot.set(x, 0, this.pz - dz);
    const cam = g.cam.camera.position;
    const want = Math.atan2(-(cam.x - x), -(cam.z - this.spot.z)) + (tall ? 0.5 : -0.65);
    if (snap) this.yaw = want;
    return want;
  }

  titleStep(dt) {
    const want = this.titleSpot(false);
    if (this.script?.kind === 'twirl') return;
    if (this.mode === 'fly') {
      this.landAt(this.spot, want, 'stand', dt);
      return;
    }
    this.turnYaw(want, 4, dt);
    // now and then down on all fours for a stretch, and back up
    this.idleT -= dt;
    if (this.idleT <= 0) {
      if (this.mode === 'stand') {
        this.mode = 'crouch';
        this.idleT = rand(2.5, 4);
      } else {
        this.mode = 'stand';
        this.idleT = rand(7, 12);
        this.body.land(0.4);
      }
    }
    if (this.lookT <= 0 && Math.random() < dt * 0.35) this.lookFor(rand(1.2, 2.6), Math.random() < 0.45 ? 'camera' : 'runner');
  }

  // --- down: the runner's gone over ---------------------------------------------------
  down(dt) {
    const g = this.game;
    const p = g.player;
    if (this.mode === 'fly') {
      // hover by them while they slide to a stop, then land beside them,
      // on all fours, facing them
      const side = this.x >= p.x ? 1 : -1;
      if (g.speed > 2.5 && !this.landing) {
        const G = this.goal;
        G.x = clamp(p.x + side * 1.3, -3.2, 3.2);
        G.y = 1.4;
        G.dz = 1.6;
        G.wx = G.wy = 2.5;
        G.wz = 2.5;
        this.swim = 0.7;
        return;
      }
      if (!this.landing) {
        const sx = clamp(p.x + side * 1.05, -3.3, 3.3);
        _v.set(sx, 0, this.pz - 1.2);
        this.landing = { spot: _v.clone(), yaw: Math.atan2(-(p.x - sx), -(this.pz - _v.z)), mode: 'crouch', head: new THREE.Vector3() };
      }
      this.landAt(this.landing.spot, this.landing.yaw, 'crouch', dt);
    } else {
      this.lookFor(0.5, 'runner');
    }
  }

  // --- her ideas ---------------------------------------------------------------------------
  think(dt) {
    this.fetchT -= dt;
    this.swim = 1;
    if (this.fetching) this.fetchStep(dt);
    else if (this.beat) this.beatStep(dt);
    else {
      this.escort(dt);
      this.restT -= dt;
      if (this.fetchT <= 0 && !this.script && this.tryFetch()) return;
      if (this.restT <= 0 && !this.script) this.chooseBeat();
    }
  }

  // Her place: a lane you're not in (the one on her side of you if it's
  // clear, the far one when you're on the edge), a little ahead, a couple of
  // metres up - a slot she shifts every few seconds.
  escort(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    this.laneT -= dt;
    if (p.lane !== this.runnerLane || this.laneT <= 0) {
      this.runnerLane = p.lane;
      this.lane = this.pickLane();
      this.laneT = rand(3, 6);
      // (higher in the lane beside you - you might swerve into it - lower
      // two lanes over)
      const by = Math.abs(this.lane - p.lane) === 1;
      this.cruise = rand(this.C.cruise[0], this.C.cruise[1]) + (by ? 0.25 : -0.1);
      this.slotDz = rand(this.C.slot[0], this.C.slot[1]);
      if (Math.random() < 0.3) this.lookFor(rand(0.8, 1.4), Math.random() < 0.65 ? 'runner' : 'camera');
    }
    // (a little in from her lane's outer edge, and on the screen: a tall
    // phone sees not much more than a lane either side of you)
    const away = Math.sign(LANES[this.lane] - p.x) || 1;
    const vis = this.visibleX(this.slotDz, this.cruise);
    G.x = clamp(LANES[this.lane] - away * 0.15, vis[0], vis[1]);
    G.vis = vis;
    G.y = this.cruise;
    G.dz = this.slotDz;
    G.wx = 2.0;
    G.wy = 2.2;
    G.wz = 1.3;
  }

  // The lane she'd rather be in: not yours; with room before its next wall;
  // the one she's in, or at least on her side of you; the far one if you're
  // on the edge.
  pickLane() {
    const p = this.game.player;
    const rl = p.lane;
    const here = this.laneOf(this.x);
    const mySide = Math.sign(this.x - p.x) || 1;
    const vis = this.visibleX(this.slotDz, this.cruise);
    let best = here, score = -1e9;
    for (let l = 0; l < 3; l++) {
      if (l === rl) continue;
      const room = Math.min(this.roomIn(l), 60);
      let sc = room * 0.1 + (l === here ? 1.5 : 0);
      if (Math.sign(LANES[l] - p.x) !== mySide) sc -= 2.5;
      // (where you can see her)
      if (LANES[l] < vis[0] - 0.3 || LANES[l] > vis[1] + 0.3) sc -= 8;
      if (sc > score) {
        score = sc;
        best = l;
      }
    }
    return best;
  }

  chooseBeat() {
    const g = this.game;
    const C = this.C;
    if (this.threading) {
      this.restT = 0.8;
      return;
    }
    const opts = [
      ['soar', 1.4],
      ['skim', this.clearBand(this.lane, 2.8, 0.55) ? 1.2 : 0],
      ['linger', 1.0],
      ['corkscrew', this.canScrew() ? 0.55 : 0],
      ['loop', this.canLoop() ? 0.4 : 0],
    ];
    if (this.lastBeat) for (const o of opts) if (o[0] === this.lastBeat) o[1] *= 0.25;
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
    if (name === 'soar') {
      // over to your other side (if there's room there), high and ahead
      const other = [0, 1, 2].filter((l) => l !== p.lane && Math.sign(LANES[l] - p.x) !== Math.sign(this.x - p.x));
      const ok = other.filter((l) => this.roomIn(l) > 30);
      this.beatLane = ok.length ? pick(ok) : this.lane;
    }
    if (name === 'corkscrew') {
      this.screwAt = this.game.time;
      this.startScript('corkscrew');
      this.cheer(this.C.screw.dur + 0.5);
    }
    if (name === 'loop') {
      this.loopAt = this.game.time;
      this.startScript('loop');
      this.cheer(this.C.loop.dur + 0.5);
    }
  }

  endBeat() {
    this.beat = null;
    this.restT = rand(this.C.rest[0], this.C.rest[1]);
    this.laneT = 0;
  }

  beatStep(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    this.beatT += dt;
    const t = this.beatT;
    switch (this.beat) {
      case 'soar': {
        // up and over, ahead of you, then down on the other side
        G.x = LANES[this.beatLane] + (Math.sign(LANES[this.beatLane] - p.x) || 1) * 0.3;
        G.wx = 1.4;
        G.wz = 1.2;
        if (this.stage === 0) {
          G.y = this.C.over + 0.25;
          G.dz = 4.2;
          G.wy = 2.6;
          // (up first, then over)
          if (this.y < this.C.over - 0.35) G.x = this.x;
          if (Math.abs(this.x - G.x) < 0.4 || t > 4.5) this.stage = 1;
          {
            const vis = this.visibleX(G.dz, G.y);
            G.x = clamp(G.x, vis[0], vis[1]);
          }
        } else {
          G.y = this.cruise;
          G.dz = this.slotDz;
          G.wy = 1.6;
          if (Math.abs(this.y - G.y) < 0.3 || t > 6.5) {
            this.lane = this.beatLane;
            this.endBeat();
          }
        }
        break;
      }
      case 'skim': {
        // down along her lane, just off the road, and up again
        if (!this.clearBand(this.lane, 1.4, 0.55)) {
          this.endBeat();
          break;
        }
        this.escort(0);
        G.y = this.stage === 0 ? 0.62 : this.cruise;
        G.wy = 2.4;
        G.dz = 2.8;
        this.swim = 0.75;
        if (this.stage === 0 && t > 2.2) this.stage = 1;
        if (t > 3.6) this.endBeat();
        break;
      }
      case 'linger': {
        // level with you, lower, looking at you
        this.escort(0);
        G.dz = 0.2;
        G.y = 1.25;
        G.wz = 1.6;
        if (this.stage === 0 && Math.abs(this.dz - G.dz) < 0.8) {
          this.stage = 1;
          this.lookFor(1.6, 'runner');
          this.cheer(1.2);
        }
        if (t > 3.6) this.endBeat();
        break;
      }
      case 'corkscrew':
      case 'loop': {
        this.escort(0);
        G.dz = Math.max(G.dz, 3.2);
        if (!this.script) this.endBeat();
        break;
      }
      default:
        this.endBeat();
    }
  }

  // --- flourishes: her head swept along a path of its own -----------------------------------
  // (laid over where she's going; eased in and out, so she never jerks)
  startScript(kind) {
    const C = kind === 'loop' ? this.C.loop : this.C.screw;
    this.script = { kind, t: 0, dur: C.dur, spin: 0, dir: Math.random() < 0.5 ? 1 : -1 };
  }

  endScript() {
    if (!this.script) return;
    // (whatever's left of the flourish she makes up as she flies on)
    this.x += this.off.x;
    this.y += this.off.y;
    this.dz += this.off.dz;
    this.off.x = this.off.y = this.off.dz = 0;
    this.script = null;
  }

  scriptStep(dt) {
    const S = this.script;
    if (!S) return;
    S.t += dt;
    const k = clamp(S.t / S.dur, 0, 1);
    const e = ease(k);
    const O = this.off;
    if (S.kind === 'loop') {
      // up, back over (upside down at the top) and down: a circle stood up
      // on the road and turned out toward its edge, so from behind you see
      // it open as a ring
      const R = this.C.loop.radius;
      const a = e * Math.PI * 2;
      const side = Math.sign(this.x - this.game.player.x) || 1;
      const tilt = this.C.loop.tilt;
      O.x = side * R * Math.sin(a) * Math.sin(tilt);
      O.y = R * (1 - Math.cos(a));
      O.dz = R * Math.sin(a) * Math.cos(tilt);
      this.swim = 0.55;
    } else if (S.kind === 'corkscrew') {
      // round and round her own length as she tears ahead, rolling with it
      const R = this.C.screw.radius;
      const turns = this.C.screw.turns;
      const a = e * Math.PI * 2 * turns * S.dir;
      const rr = R * Math.sin(Math.PI * k);
      O.x = rr * Math.sin(a);
      O.y = rr * (1 - Math.cos(a)) * 0.8;
      O.dz = 0;
      S.spin = (easeD(k) / S.dur) * Math.PI * 2 * turns * S.dir;
      this.swim = 0.6;
    } else if (S.kind === 'twirl') {
      // up off her feet, once round the place she stood, and down again
      const H = this.C.twirlHeight;
      const a = e * Math.PI * 2;
      const rr = 0.6 * Math.sin(Math.PI * e);
      this.x = S.from.x + rr * Math.sin(a);
      this.y = S.from.y + H * Math.sin(Math.PI * Math.min(1, e * 1.15));
      this.dz = S.from.z + rr * (1 - Math.cos(a)) * 0.9;
      this.vx = this.vy = this.vdz = 0;
      this.goal.x = this.x;
      this.goal.y = this.y;
      this.goal.dz = this.dz;
      this.swim = 1.2;
      if (k >= 1) {
        this.script = null;
        this.mode = 'stand';
        this.landing = null;
        this.body.land(0.8);
        this.cheer(1.2);
      }
      return;
    }
    if (k >= 1) this.endScript();
  }

  canLoop() {
    const g = this.game;
    return g.time - this.loopAt > this.C.loop.every && this.clearLane(this.lane, 3.2) && Math.abs(LANES[this.lane] - g.player.x) > 2 && this.clearBand(this.lane, 3.4, 0.5) && this.y > 1.3;
  }

  canScrew() {
    const g = this.game;
    return g.time - this.screwAt > this.C.screw.every && this.clearLane(this.lane, 2.5) && this.clearBand(this.lane, 2.6, 0.5) && Math.abs(LANES[this.lane] - g.player.x) > 1.8;
  }

  // --- fetching a gem ------------------------------------------------------------------------
  // A gem in a lane you're not in, far enough ahead to reach, with the way
  // to it clear: she swoops on it, snaps it up and sends it to you.
  tryFetch() {
    const g = this.game;
    const p = g.player;
    const C = this.C.fetch;
    this.fetchT = rand(C.every[0], C.every[1]) * 0.35;
    if (Math.random() > C.chance) return false;
    let best = null;
    const dh = g.dist + this.dz;
    for (const gem of g.gems.gems) {
      if (gem.taken) continue;
      const ahead = gem.d - g.dist;
      if (ahead < C.reach[0] || ahead > C.reach[1] || gem.d - dh < 3) continue;
      if (gem.y > 2.4 || Math.abs(gem.x - p.x) < 1.4) continue;
      const vis = this.visibleX(Math.min(ahead, 8), gem.y);
      if (gem.x < vis[0] - 0.4 || gem.x > vis[1] + 0.4) continue;
      const l = this.laneOf(gem.x);
      if (this.roomIn(l) < ahead + 4 || !this.clearBand(l, (ahead + 3) / Math.max(g.speed, 8), 0)) continue;
      if (this.laneOf(this.x) !== l && Math.abs(l - this.laneOf(this.x)) === 2 && p.lane === 1) continue;
      if (!best || gem.d < best.d) best = gem;
    }
    if (!best) return false;
    this.fetching = { gem: best, t: 0 };
    this.fetchT = rand(C.every[0], C.every[1]);
    this.lookFor(0.8, { x: best.x, y: best.y, dz: best.d - g.dist });
    return true;
  }

  fetchStep(dt) {
    const g = this.game;
    const F = this.fetching;
    const gem = F.gem;
    F.t += dt;
    const G = this.goal;
    const vf = Math.max(g.speed + this.vdz, 1);
    const mz = this.dz + MOUTH[0];
    if (gem.taken || gem.d - g.dist < mz - 1.2 || F.t > 5) {
      this.fetching = null;
      this.restT = rand(0.8, 1.6);
      return;
    }
    // into its lane, at its height, and on to meet it
    G.x = gem.x;
    G.y = Math.max(gem.y - MOUTH[1], 0.55);
    G.dz = clamp(gem.d - g.dist - MOUTH[0] - 1.5, 1.2, 6);
    G.wx = 3.4;
    G.wy = 3.6;
    G.wz = 2;
    this.swim = 0.8;
    this.lookT = Math.max(this.lookT, 0.2);
    this.lookAt = { x: gem.x, y: gem.y, dz: gem.d - g.dist };
    // jaws open as it comes
    const near = gem.d - g.dist - mz;
    this.body.jawOpen = near < vf * 0.25 && near > -0.4 ? 0.85 : 0;
    // caught?
    const mx = this.x + this.off.x, my = this.y + this.off.y + MOUTH[1];
    const md = g.dist + mz;
    const prev = md - vf * dt - 0.05;
    if (gem.d >= prev - 0.4 && gem.d <= md + 0.45 && Math.abs(gem.x - mx) < 0.5 && Math.abs(gem.y - my) < 0.5) {
      this.body.jawOpen = 0;
      this.body.snap();
      g.creditGem(gem, true);
      this.later.push({ at: g.time + 0.48, gem });
      this.cheer(1.4);
      this.lookFor(0.9, 'runner');
      this.fetching = null;
      this.restT = rand(1, 2);
      // (and away with a flourish)
      if (this.canScrew() && Math.random() < 0.5) this.startBeat('corkscrew');
    }
  }

  sparkLater() {
    const g = this.game;
    for (let i = this.later.length - 1; i >= 0; i--) {
      const L = this.later[i];
      if (g.time < L.at) continue;
      g.sparkles.emit(0, 0.1, L.gem.light, g.time, L.gem.crown ? 1.1 : 0.85);
      this.later.splice(i, 1);
    }
  }

  // --- reading the road ------------------------------------------------------------------------
  laneOf(x) {
    return clamp(Math.round((x - LANES[0]) / 2.4), 0, 2);
  }

  // The obstacles in lane l (by x) over track distances d0..d1.
  each(x, d0, d1, fn) {
    for (const o of this.game.obstacles.records) {
      if (o.d + o.len < d0 || o.d > d1) continue;
      if (Math.abs(x - o.x) > o.hw + HW) continue;
      fn(o);
    }
  }

  // How far ahead of her head lane l is clear of walls (m; her body behind
  // her head counts too).
  roomIn(l) {
    const g = this.game;
    const dh = g.dist + this.dz;
    let room = 1e9;
    this.each(LANES[l], dh - BODY - 0.5, dh + 80, (o) => {
      if (o.kind === 'W') room = Math.min(room, o.d - dh);
    });
    return room;
  }

  clearLane(l, secs) {
    const g = this.game;
    const v = Math.max(g.speed, CONFIG.speed.start);
    return this.roomIn(l) > v * secs + 4;
  }

  // No hurdle or bar in lane l for secs (one she'd have to rise over or dip
  // under), keeping `low` m of air under her.
  clearBand(l, secs, low) {
    const g = this.game;
    const v = Math.max(g.speed, CONFIG.speed.start);
    const dh = g.dist + this.dz;
    let ok = true;
    this.each(LANES[l], dh - BODY - 0.5, dh + v * secs + 3, (o) => {
      if (o.kind !== 'W' && (o.kind === 'H' || o.y1 + 0.3 > low)) ok = false;
    });
    return ok;
  }

  // Keep her clear of everything: walls (lanes), hurdles (over) and bars
  // (under, or round), the runner (you're never under her low, never
  // crossed low in front of), the road.
  safety(dt) {
    const g = this.game;
    const p = g.player;
    const G = this.goal;
    const v = Math.max(g.speed, CONFIG.speed.start);
    const dh = g.dist + this.dz;
    const here = this.laneOf(this.x);
    const room = this._room || (this._room = [0, 0, 0]);
    for (let l = 0; l < 3; l++) room[l] = this.roomIn(l);
    // walls (too tall to fly over): row by row, she threads the gaps - in
    // the gap of the row coming at her, as near as it lets her to the gap in
    // the row after it, so a slalom's a sway and not a scramble; and she
    // keeps to it till the row's gone by her tail
    // Most walls aren't so very tall to look at (a cart, a wardrobe, a
    // boulder): rather than squeeze into your lane to get by one, she sails
    // over it, if that's not up off the top of the screen.
    const rows = this.wallRows(dh, v);
    this.threading = rows.length ? 1 : 0;
    let wallLo = 0;
    if (rows.length) {
      if (this.script) this.endScript();
      if (this.beat && this.beat !== 'linger') this.endBeat();
      const A = rows[0];
      let I = nearestGap(A.gaps, this.x);
      const inGap = I && this.x >= I[0] && this.x <= I[1];
      if (I && !inGap && A.d1 > dh - 0.9) {
        const top = this.rowTop(A, this.x);
        const tA = (A.d0 - dh) / v;
        const yours = I[0] < p.x + 1.3 && I[1] > p.x - 1.3;
        const reach = Math.abs((I[0] + I[1]) / 2 - this.x) / 4 + 0.35;
        if (top + 0.55 <= this.C.overWalls && (A.over || yours || reach > tA)) {
          for (const o of A.walls) o.flyOver = true;
          wallLo = top + 0.55;
          I = null;
        }
      }
      if (I) {
        let want = G.x;
        if (rows[1]) {
          const J = nearestGap(rows[1].gaps, clamp(this.x, I[0], I[1]));
          if (J) want = clamp(want, J[0], J[1]);
        }
        G.x = clamp(want, I[0], I[1]);
        const tA = (A.d0 - dh) / v;
        if (this.x < I[0] || this.x > I[1] || (tA < 1.2 && Math.abs(G.x - this.x) > 0.25)) G.urgent = true;
        this.lane = this.laneOf(G.x);
        if (this.fetching && Math.abs(this.fetching.gem.x - G.x) > 0.6) this.fetching = null;
      }
    }
    // hurdles and bars where she is and where she's going: over the
    // hurdles, under the bars (or, where both, round) - in good time, a
    // bar sooner (it's further down to go)
    // (taken in the order they come: only those too close together to
    // get from under one to over the next count as one; the nearest first.
    // Threading them, the wind runs at the road's speed and her body follows
    // her head's path exactly, so each matters only till it's by her head)
    const cons = this._cons || (this._cons = []);
    cons.length = 0;
    for (const x of [this.x, G.x]) {
      this.each(x, dh - 0.9, dh + v * 1.7 + 6, (o) => {
        if (o.kind !== 'W' && cons.indexOf(o) < 0) cons.push(o);
      });
    }
    cons.sort((a, b) => a.d - b.d);
    let lo = Math.max(0.5, wallLo), hi = 99, soon = false;
    // (a bar she goes under, or - near you, or if she's nearer the top of
    // it - over; decided once for each)
    const nearYou = Math.abs(this.x - p.x) < 1.6 && this.dz > -1.5 && this.dz < 7;
    if (cons.length) {
      const gap = v * 0.55 + BODY;
      let end = cons[0].d + cons[0].len;
      for (const o of cons) {
        if (o.d > end + gap) break;
        end = Math.max(end, o.d + o.len);
        if (o.kind === 'L') {
          if (o.d < dh + v * 1.15 + 4) lo = Math.max(lo, o.y1 + 0.38);
        } else {
          const over = this.visTop(o) + 0.5;
          if (!o.fly) o.fly = over <= this.C.overWalls && (nearYou || this.y > (o.y0 - 0.34 + over) / 2) ? 'over' : 'under';
          // (found under it near you - put there by the walls - she goes
          // over after all, if there's time to climb)
          else if (o.fly === 'under' && nearYou && over <= this.C.overWalls && o.d > dh + v * 0.6) o.fly = 'over';
          if (o.fly === 'over') {
            if (o.d < dh + v * 1.3 + 4) lo = Math.max(lo, over);
          } else {
            hi = Math.min(hi, o.y0 - 0.34);
            if (o.d < dh + v * 1.0 + 4) soon = true;
          }
        }
      }
    }
    if (hi < 99 || lo > 0.5) {
      if (this.script) this.endScript();
      this.swim = Math.min(this.swim, 0.5);
      this.threading = 1;
      if (hi < lo + 0.15) {
        // no way through: round, if there's a lane that's clear of them;
        // else the nearest of them first
        const alt = [0, 1, 2].filter((l) => l !== here && l !== p.lane && room[l] > v * 1.5 && this.clearBand(l, 1.6, 0.5)).sort((a, b) => room[b] - room[a])[0];
        if (alt !== undefined) {
          G.x = LANES[alt];
          this.lane = alt;
          G.urgent = true;
        } else {
          G.y = cons[0].kind === 'H' ? hi : lo;
          G.wy = Math.max(G.wy, 3.6);
          G.urgent = true;
        }
      } else {
        G.y = clamp(G.y, lo, hi);
        G.wy = Math.max(G.wy, 3.4);
        // (a bar coming, and she's still above it: down hard - a little
        // below where she needs to be, so she's there in time)
        if (soon && this.y > hi + 0.04) {
          G.urgent = true;
          G.wy = 5.5;
          G.y = Math.max(0.5, hi - 0.12);
        }
        if (this.y < lo - 0.04 && (wallLo || cons.length) && (wallLo || cons[0].d < dh + v * 1.0 + 3)) {
          G.urgent = true;
          G.wy = 5.5;
          G.y = lo + 0.12;
        }
      }
    }
    // the runner: never low over you, nor low across the road just ahead of
    // you
    const near = this.dz > -3 && this.dz < 5.5;
    const over = Math.abs(this.x - p.x) < 1.45 || (Math.sign(this.x - p.x) !== Math.sign(G.x - p.x) && Math.abs(G.x - p.x) > 0.5);
    if (near && over && !this.fetching) {
      // (and higher as you jump up toward her)
      const lift = this.C.over + Math.max(0, p.y) * 0.9 + (this.threading ? 0.25 : 0);
      G.y = Math.max(G.y, Math.min(lift, hi));
      G.dz = Math.max(G.dz, 2.4);
      G.wy = Math.max(G.wy, 3.4);
      if (this.y < 2.4) G.urgent = true;
      // (and up first, then across)
      if (this.y < this.C.over - 0.5 && Math.abs(this.x - p.x) > 0.9) G.x = this.x + clamp(G.x - this.x, -0.6, 0.6);
    }
    G.x = clamp(G.x, -3.3, 3.3);
    G.y = clamp(G.y, 0.5, 4.2);
    G.dz = clamp(G.dz, this.C.behind, this.C.ahead);
  }

  // The stretch of road across (x) the camera sees at dz ahead of you and
  // height y, a margin in from the edges of the screen.
  visibleX(dz, y) {
    const out = this._vis || (this._vis = [-3, 3]);
    const cam = this.game.cam.camera;
    if (!cam.aspect) return out;
    cam.updateMatrixWorld();
    const z = this.pz - Math.max(dz, -1);
    const a = _p.set(-6, y, z).project(cam).x;
    const b = _v.set(6, y, z).project(cam).x;
    if (!(b - a > 1e-3)) return out;
    const k = 12 / (b - a);
    const m = this.C.screen;
    out[0] = -6 + (-m - a) * k;
    out[1] = -6 + (m - a) * k;
    return out;
  }

  // How tall an obstacle stands to look at (its prop's top), once.
  visTop(o) {
    if (o.vis !== undefined) return o.vis;
    let top = 0;
    const spec = o.group?.spec, w = o.group?.world;
    if (spec && w) {
      for (const n of [spec.name, ...(spec.with || [])]) {
        const geo = w.batches.get(n)?.mesh?.geometry;
        if (!geo) continue;
        if (!geo.boundingBox) geo.computeBoundingBox();
        top = Math.max(top, geo.boundingBox.max.y);
      }
    }
    return (o.vis = top > 0 ? top : 6);
  }

  // The top of the walls of a row that she'd meet at x.
  rowTop(row, x) {
    let top = 0;
    for (const o of row.walls) if (Math.abs(x - o.x) < o.hw + HW + 0.15) top = Math.max(top, this.visTop(o));
    return top;
  }

  // The rows of walls from her tail to a couple of seconds ahead of her
  // head, nearest first: each its span along the road and the gaps across it
  // she fits through (x intervals, her own width allowed for).
  wallRows(dh, v) {
    const rows = this._rows || (this._rows = []);
    rows.length = 0;
    for (const o of this.game.obstacles.records) {
      if (o.kind !== 'W' || o.d + o.len < dh - BODY - 0.6 || o.d > dh + v * 2.2 + 8) continue;
      let row = null;
      for (const r of rows) if (o.d < r.d1 + 1.5 && o.d + o.len > r.d0 - 1.5) row = r;
      if (!row) rows.push((row = { d0: o.d, d1: o.d + o.len, blocks: [], gaps: [], walls: [], over: false }));
      row.walls.push(o);
      if (o.flyOver) row.over = true;
      row.d0 = Math.min(row.d0, o.d);
      row.d1 = Math.max(row.d1, o.d + o.len);
      row.blocks.push([o.x - o.hw - HW - 0.14, o.x + o.hw + HW + 0.14]);
    }
    rows.sort((a, b) => a.d0 - b.d0);
    for (const r of rows) {
      r.blocks.sort((a, b) => a[0] - b[0]);
      let x = -3.4;
      for (const [b0, b1] of r.blocks) {
        if (b0 > x + 0.05) r.gaps.push([x, b0]);
        x = Math.max(x, b1);
      }
      if (x < 3.35) r.gaps.push([x, 3.4]);
    }
    return rows;
  }

  forCompile(on) {
    this.body.forCompile(on);
  }
}

// The gap (x interval) nearest x, or null.
function nearestGap(gaps, x) {
  let best = null, bd = 1e9;
  for (const g of gaps) {
    const d = x < g[0] ? g[0] - x : x > g[1] ? x - g[1] : 0;
    if (d < bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
