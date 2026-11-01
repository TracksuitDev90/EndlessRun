import * as THREE from '../../vendor/three/three.module.min.js';
import { CONFIG } from '../config.js';

// Chase camera: frames all three lanes at any aspect ratio (portrait phones
// get a wider vertical FOV and a slightly longer boom), follows lanes and
// jumps with soft lag, kicks FOV with speed, shakes on hits.

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class ChaseCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.2, 1000);
    this.x = 0;
    this.y = CONFIG.camera.height;
    this.shake = 0;
    this.intro = 1; // 1 = title framing, 0 = run framing
    this.introTarget = 1;
    this.baseFov = 60;
    this.boom = 1;
    this.roll = 0;
    this.sway = 0; // dream depth: a slow drunken roll and breathing FOV
    this.look = new THREE.Vector3();
  }

  resize(w, h) {
    const aspect = w / h;
    this.aspect = aspect;
    this.camera.aspect = aspect;
    const c = CONFIG.camera;
    const D = Math.hypot(c.back, c.height - 1);
    // vertical FOV needed so the lanes fit horizontally at the player's depth
    const tanH = c.coverHalfWidth / D;
    let vfov = THREE.MathUtils.radToDeg(2 * Math.atan(tanH / aspect));
    this.boom = 1;
    if (vfov > c.maxFov) {
      const tanV = Math.tan(THREE.MathUtils.degToRad(c.maxFov) / 2);
      this.boom = c.coverHalfWidth / (tanV * aspect) / D;
      vfov = c.maxFov;
    }
    this.baseFov = Math.max(c.minFov, vfov);
    this.camera.updateProjectionMatrix();
  }

  kick(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  update(dt, player, playerZ, speed, time) {
    const c = CONFIG.camera;
    this.intro = damp(this.intro, this.introTarget, 2.6, dt);
    const i = this.intro * this.intro * (3 - 2 * this.intro);
    const sp = Math.min(1, Math.max(0, (speed - CONFIG.speed.start) / (CONFIG.speed.max - CONFIG.speed.start)));
    const boom = this.boom * (1 + sp * 0.06);

    this.x = damp(this.x, player.x * 0.72, 7, dt);
    const slide = player.w ? player.w.slide : 0;
    const ty = c.height * boom + Math.max(0, player.y) * 0.45 - slide * 0.35;
    this.y = damp(this.y, ty, 5, dt);

    // run framing
    let px = this.x;
    let py = this.y;
    let pz = playerZ + c.back * boom;
    let lx = player.x * 0.55 + this.x * 0.45;
    let ly = c.lookHeight + Math.max(0, player.y) * 0.3;
    let lz = playerZ - c.lookAhead;

    // title framing: low, close, a little to the side, looking past the
    // runner; on a tall screen, further back and looking down the road, so
    // they stand up in the middle of it above the cards that choose them
    const tall = (this.aspect || 1) < 1.25;
    const tx = tall ? 1.05 : 1.7;
    const tY = tall ? 1.3 : 1.35;
    const tz = playerZ + (tall ? 4.9 : 3.6);
    px = px + (tx - px) * i;
    py = py + (tY - py) * i;
    pz = pz + (tz - pz) * i;
    lx = lx + ((tall ? -0.55 : -0.4) - lx) * i;
    ly = ly + ((tall ? -1.55 : 1.25) - ly) * i;
    lz = lz + (playerZ - 6 - lz) * i;

    // shake
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake;
    px += Math.sin(time * 61) * 0.22 * s;
    py += Math.sin(time * 47 + 1.3) * 0.18 * s;

    // a heavy landing's thud (the runner's own bounce, a few cm: see
    // FEEL.land.thud); it dips the camera, not shakes it
    const thud = (player.camDip || 0) * (1 - i);
    py -= thud;
    ly -= thud * 0.6;

    this.camera.position.set(px, py, pz);
    this.look.set(lx, ly, lz);
    this.camera.lookAt(this.look);
    this.roll = damp(this.roll, -player.vx * 0.006, 8, dt);
    const sw = Math.min(1, this.sway) * (1 - i);
    this.camera.rotateZ(this.roll * (1 - i) + sw * (0.045 * Math.sin(time * 0.31) + 0.02 * Math.sin(time * 0.83 + 1.2)));

    const fov = this.baseFov + sp * 7 + i * 4 + sw * 2.4 * Math.sin(time * 0.47);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
