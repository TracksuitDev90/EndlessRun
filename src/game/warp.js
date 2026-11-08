import * as THREE from '../../vendor/three/three.module.min.js';

// Through a doorway into a world with env.warp (the Red Drift), the runner
// jumps to light speed. The instant they're through, the stars stretch into
// streaks pouring out of the point the road runs to - white, ice blue,
// cyan, violet, a few hot magenta - faster and longer as the jump takes
// hold, the world smeared out along them toward the centre and sunk in a
// blue tunnel, a white-hot core blazing where they all come from; then they
// drop out of it: the streaks snap back into points, a flash rings out
// across the screen, and there they are, running on the red dust under the
// planets. About a second and a half in all - the streaks racing faster
// and faster the whole time it holds, the tunnel turning round them.
//
// The runner is left out of the smear (and the streaks thin round them):
// it's the universe that's moving, not them, and the road stays readable.
//
// Like the splash, it's drawn over the finished frame (copied into a
// texture) in one full-screen pass, only while it runs.

export const WARP_TIME = 1.5;

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FS = /* glsl */ `
uniform sampler2D uFrame;
uniform vec2 uRes;
uniform float uT;
uniform float uSeed;
uniform vec2 uVP;     // where the streaks pour from (uv)
uniform vec3 uRunner; // the runner on screen: xy (uv), z their height on it
varying vec2 vUv;

float h1(float n) {
  return fract(sin(n * 127.1 + uSeed * 13.7) * 43758.5453);
}
vec3 streakColor(float h) {
  if (h < 0.34) return vec3(0.92, 0.96, 1.0);
  if (h < 0.58) return vec3(0.55, 0.82, 1.0);
  if (h < 0.74) return vec3(0.3, 0.9, 1.0);
  if (h < 0.86) return vec3(0.45, 0.5, 1.0);
  if (h < 0.95) return vec3(0.68, 0.42, 1.0);
  return vec3(1.0, 0.42, 0.86);
}

void main() {
  float aspect = uRes.x / uRes.y;
  float t = uT;
  // how far in: the jump takes hold at once, holds, and drops out
  float I = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(1.0, 1.16, t));
  // how long the streaks are: they stretch as it takes hold and snap back
  // to points as it drops out
  float S = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.96, 1.07, t));
  float flash = exp(-pow((t - 1.05) / 0.045, 2.0));
  float settle = 1.0 - smoothstep(1.1, 1.5, t);

  vec2 q = (vUv - uVP) * vec2(aspect, 1.0);
  float r = length(q);
  // (the tunnel turns as it goes)
  float th = atan(q.y, q.x) + t * t * 0.5 * I;

  // the runner, kept clear of it all
  vec2 rq = (vUv - uRunner.xy) * vec2(aspect, 1.0) / vec2(uRunner.z * 0.34, uRunner.z * 0.56);
  float keep = 1.0 - smoothstep(0.45, 1.25, length(rq));

  // the world, smeared out toward the point it's all pouring from
  vec2 dir = uVP - vUv;
  float k = 0.34 * I * S * (1.0 - keep);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 10; i++) {
    float s = float(i) / 9.0;
    acc += texture2D(uFrame, vUv + dir * k * s * s).rgb;
  }
  acc /= 10.0;
  vec3 c = mix(texture2D(uFrame, vUv).rgb, acc, step(0.0001, k));
  // sunk in a blue tunnel, darkest round the edges
  float tunnel = I * (1.0 - 0.6 * keep) * (0.45 + 0.4 * smoothstep(0.2, 0.9, r));
  c = mix(c, c * vec3(0.3, 0.38, 0.75) + vec3(0.0, 0.02, 0.07), tunnel);

  // the streaks: three layers of them, each a ray out of the centre
  vec3 st = vec3(0.0);
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float N = L == 0 ? 90.0 : L == 1 ? 180.0 : 340.0;
    float a = (th / 6.2831853 + 0.5) * N;
    float i = floor(a);
    float f = fract(a);
    float hA = h1(i + fl * 1013.0);
    float hB = h1(i * 1.71 + 3.1 + fl * 1013.0);
    float hC = h1(i * 2.37 + 7.3 + fl * 1013.0);
    if (hA < 0.16) continue;
    // across: how far this pixel is from the ray (in screen heights)
    float c0 = 0.2 + 0.6 * hA;
    float dAcross = abs(f - c0) / N * 6.2831853 * r;
    // along: its head flies outward, faster the further out (in log space,
    // like something rushing past), faster and faster as the jump holds,
    // its tail trailing behind it
    float spd = (1.0 + 1.8 * hB) * (1.7 + 0.6 * fl);
    float u = fract(hB * 7.31 + hC * 3.7 + t * spd * (1.0 + 0.9 * t));
    float head = exp(mix(log(0.02), log(1.8), u));
    float len = head * (0.05 + 1.2 * S) * (0.4 + 0.6 * hC);
    float tail = clamp((r - (head - len)) / max(len, 1e-4), 0.0, 1.0);
    float along = step(head - len, r) * (1.0 - smoothstep(head, head + 0.006 + 0.01 * head, r));
    float w = (0.9 + 2.6 * head) / 900.0 * (L == 0 ? 1.7 : 1.0);
    float line = 1.0 - smoothstep(w * 0.35, w + 1.2 / uRes.y, dAcross);
    float glow = 1.0 - smoothstep(0.0, w * 4.0, dAcross);
    float b = (0.35 + 0.65 * tail * tail) * (0.6 + 0.6 * hA) * smoothstep(0.015, 0.08, r);
    st += streakColor(hC) * (line + glow * 0.25) * along * b;
  }
  st *= max(I, 0.0) * (1.0 - 0.75 * keep);
  c += st * 1.5;

  // the white-hot core they all pour out of
  c += vec3(0.75, 0.88, 1.0) * (exp(-r * 16.0) * 1.6 + exp(-r * 4.0) * 0.28) * I;
  // dropping out: a flash, and a ring of light racing out across the screen
  float ringR = smoothstep(1.0, 1.22, t) * 1.8;
  float ring = exp(-pow((r - ringR) / 0.06, 2.0)) * (1.0 - smoothstep(1.1, 1.28, t)) * step(1.0, t);
  c += vec3(0.8, 0.9, 1.0) * (flash * 0.38 + ring * 0.5);
  // and a faint blue afterglow that lets go of the picture
  c = mix(c, c + vec3(0.02, 0.05, 0.12), settle * (1.0 - I) * step(1.05, t) * 0.8);
  gl_FragColor = vec4(c, 1.0);
}
`;

const _p = new THREE.Vector3();

export class Warp {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFrame: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uT: { value: 0 },
        uSeed: { value: 0 },
        uVP: { value: new THREE.Vector2(0.5, 0.6) },
        uRunner: { value: new THREE.Vector3(0.5, 0.25, 0.2) },
      },
      vertexShader: VS,
      fragmentShader: FS,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.Camera();
    this.size = new THREE.Vector2();
    this.tex = null;
    this.t = Infinity;
  }

  start() {
    this.t = 0;
    this.material.uniforms.uSeed.value = Math.random() * 100;
  }

  stop() {
    this.t = Infinity;
  }

  get active() {
    return this.t < WARP_TIME;
  }

  update(dt) {
    if (this.active) this.t += dt;
  }

  // Where it pours from (straight ahead, level: where the road runs to) and
  // where the runner is, on screen.
  aim(camera, runner) {
    const u = this.material.uniforms;
    _p.copy(camera.position);
    _p.z -= 500;
    _p.project(camera);
    u.uVP.value.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);
    _p.set(runner.x, runner.y + 0.8, runner.z).project(camera);
    const cx = _p.x * 0.5 + 0.5;
    const cy = _p.y * 0.5 + 0.5;
    _p.set(runner.x, runner.y + 1.7, runner.z).project(camera);
    u.uRunner.value.set(cx, cy, Math.max(0.05, Math.abs(_p.y * 0.5 + 0.5 - cy) * 2.2));
  }

  // Draw one, unseen (under the loading screen), so its program is used and
  // its frame texture allocated before the run.
  warm(renderer) {
    const t = this.t;
    this.t = 0.3;
    try {
      this.render(renderer);
    } finally {
      this.t = t;
      renderer.clear(true, true, true);
    }
  }

  render(renderer) {
    if (!this.active) return;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    if (!this.tex || this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex?.dispose();
      this.tex = new THREE.FramebufferTexture(w, h);
      this.tex.minFilter = THREE.LinearFilter;
      this.tex.magFilter = THREE.LinearFilter;
    }
    renderer.copyFramebufferToTexture(this.tex);
    const u = this.material.uniforms;
    u.uFrame.value = this.tex;
    u.uRes.value.set(w, h);
    u.uT.value = this.t;
    renderer.render(this.scene, this.camera);
  }
}
