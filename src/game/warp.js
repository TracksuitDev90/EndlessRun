import * as THREE from '../../vendor/three/three.module.min.js';

// Through a doorway into a world with env.warp (the Red Drift), the runner
// jumps to light speed - and is sucked into it. The instant they're through
// the world itself comes apart into light: the camera lunges at the point
// the road runs to, everything round it is drawn out toward that point into
// long trails of its own colour, split into the spectrum along their length
// (red at the tail, violet at the head - the world's red dust, the doorway's
// violet, the planets' blues all pulled into ribbons), twisting into a
// vortex that tightens toward the centre, while bright dashes race out along
// every trail past the edges of the screen, faster and faster. It isn't
// streaks painted on top of the picture: the picture is the streaks. Then
// they drop out - the trails snap back into the world, a flash and a ring
// of rainbow light race out across the screen, and there they are, running
// on the red dust under the planets. Quick: under nine-tenths of a second
// in all, the drop out at a little past half a second.
//
// The runner is left out of it (the trails thin round them): it's the
// universe that's moving, not them, and the road stays readable.
//
// Like the splash, it's drawn over the finished frame (copied into a
// texture) in one full-screen pass, only while it runs.

export const WARP_TIME = 0.85;

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
uniform vec2 uVP;     // where it all pours into (uv)
uniform vec3 uRunner; // the runner on screen: xy (uv), z their height on it
varying vec2 vUv;

float h1(float n) {
  return fract(sin(n * 127.1 + uSeed * 13.7) * 43758.5453);
}
// a rainbow, round the colour wheel
vec3 spectrum(float x) {
  return 0.5 + 0.5 * cos(6.2831853 * (x + vec3(0.0, 0.33, 0.67)));
}

void main() {
  float aspect = uRes.x / uRes.y;
  float t = uT;
  // how far in: it grabs at once, holds, and lets go
  float I = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.5, 0.6, t));
  // how long the trails are drawn: out as it takes hold, snapping back as
  // it drops out
  float S = smoothstep(0.0, 0.11, t) * (1.0 - smoothstep(0.47, 0.57, t));
  float flash = exp(-pow((t - 0.56) / 0.03, 2.0));
  float settle = 1.0 - smoothstep(0.58, 0.85, t);

  vec2 q = (vUv - uVP) * vec2(aspect, 1.0);
  float r = length(q);
  float th = atan(q.y, q.x);

  // the runner, kept clear of it all
  vec2 rq = (vUv - uRunner.xy) * vec2(aspect, 1.0) / vec2(uRunner.z * 0.34, uRunner.z * 0.56);
  float keep = 1.0 - smoothstep(0.45, 1.25, length(rq));
  float free = 1.0 - keep;

  vec3 orig = texture2D(uFrame, vUv).rgb;
  vec3 c = orig;
  if (I > 0.0) {
    float pull = I * S * free;
    // the vortex: a twist, tightening toward the centre and winding up
    // faster the longer it holds
    float tw = 0.2 * pull * (0.5 + 3.0 * t) / (r + 0.28);
    float cs = cos(tw), sn = sin(tw);
    vec2 qr = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
    // the lunge: the picture swelling out of the centre as the camera is
    // dragged into it
    vec2 d = qr / vec2(aspect, 1.0) * (1.0 - 0.3 * pull);
    // the trails themselves: this pixel's colour gathered from all the
    // way in along its ray, each step of the way tinted further round the
    // spectrum - so the world is pulled into long ribbons of its own
    // colours, rainbowed along their length
    float k = 0.8 * pull;
    float a0 = floor((th / 6.2831853 + 0.5) * 70.0);
    float hue = h1(a0 + 77.0) * 0.5 + t * 0.8;
    vec3 acc = vec3(0.0);
    vec3 wsum = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float s = float(i) / 11.0;
      vec3 w = mix(vec3(1.0), spectrum(hue + s * 0.85), 0.8 * I * free);
      acc += texture2D(uFrame, uVP + d * (1.0 - k * s * (0.4 + 0.6 * s))).rgb * w;
      wsum += w;
    }
    vec3 smear = acc / wsum;

    // light racing out along them: two sets of thin rays out of the
    // centre, each a run of long-tailed dashes flying outward (in log
    // space, like something rushing past), faster and faster
    float lr = log(max(r, 1e-3));
    float T = t * 7.0 + t * t * 26.0;
    float lines = 0.0;
    vec3 tint = vec3(0.0);
    for (int L = 0; L < 2; L++) {
      float fl = float(L);
      float N = L == 0 ? 110.0 : 230.0;
      float a = ((th + tw * 0.8) / 6.2831853 + 0.5) * N;
      float i = floor(a);
      float f = fract(a);
      float hA = h1(i + fl * 1013.0);
      float hB = h1(i * 1.71 + 3.1 + fl * 1013.0);
      float hC = h1(i * 2.37 + 7.3 + fl * 1013.0);
      if (hA < 0.28) continue;
      float dAcross = abs(f - (0.25 + 0.5 * hA)) / N * 6.2831853 * r;
      float w = (0.5 + 3.2 * r) / 750.0 * (0.6 + 0.8 * hB);
      float line = 1.0 - smoothstep(w * 0.3, w + 1.4 / uRes.y, dAcross);
      float glow = 1.0 - smoothstep(0.0, w * 5.0, dAcross);
      float ph = fract(lr * (0.8 + 0.7 * hC) - T * (0.6 + 0.8 * hB) + hA * 5.0);
      float len = mix(0.12, 0.92, S);
      float dash = smoothstep(1.0 - len, 1.0, ph) * (1.0 - smoothstep(0.975, 1.0, ph));
      float v = (line + glow * 0.3) * dash * (0.45 + 0.75 * hC);
      lines += v;
      tint += spectrum(hC + fl * 0.37 + t * 0.9) * v;
    }
    float on = I * free * smoothstep(0.012, 0.09, r);
    float lum = dot(smear, vec3(0.3, 0.59, 0.11));
    // the dashes take the colour of the world they're made of, lit up and
    // pushed round the spectrum
    vec3 lit = smear * 1.7 + lum * 0.35 + 0.08;
    vec3 trailCol = mix(lit, lit * 0.45 + tint / max(lines, 1e-3) * 0.85, 0.6);
    // between them the world, drawn into the tunnel, darker toward its walls
    c = mix(orig, smear, I) * (1.0 - 0.42 * I * free * smoothstep(0.05, 0.7, r));
    c += trailCol * clamp(lines, 0.0, 2.0) * on * 0.8;
    // the mouth of it, glowing with what's being pulled in
    float core = exp(-r * 22.0) * 0.95 + exp(-r * 5.0) * 0.14;
    c += mix(vec3(1.0, 0.96, 1.0), smear * 1.6 + 0.35, 0.35) * core * I;
  }

  // dropping out: a flash, and a ring of rainbow light racing out across
  // the screen
  float ringR = smoothstep(0.52, 0.7, t) * 1.8;
  float ring = exp(-pow((r - ringR) / 0.07, 2.0)) * (1.0 - smoothstep(0.62, 0.74, t)) * step(0.52, t);
  c += vec3(0.85, 0.92, 1.0) * flash * 0.42 + spectrum(th / 6.2831853 + r * 0.6) * ring * 0.45;
  // and a faint blue afterglow that lets go of the picture
  c = mix(c, c + vec3(0.02, 0.05, 0.12), settle * (1.0 - I) * step(0.56, t) * 0.8);
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
