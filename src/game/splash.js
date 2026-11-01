import * as THREE from '../../vendor/three/three.module.min.js';
import { shared } from '../render/shaders.js';

// Coming into a world with env.splash (the Kelp Deep), the screen is
// splashed with water. The instant the camera comes through the doorway a
// wall of water hits the lens — the picture swims behind it, white water
// flashing across — then the sheet slides off down the screen, faster and
// faster, its front edge a bright wavering meniscus; and behind it, left on
// the glass, drops big and small hang a moment and then streak away down
// the screen, stretching as they speed up, each one a little lens with a
// glint on top and a wet trail beaded with tiny drops behind it. A second
// and a half in all.
//
// It's drawn over the finished frame: the frame is copied into a texture
// and one full-screen pass refracts it through the water — only while a
// splash is running, so it costs nothing the rest of the time.

export const SPLASH_TIME = 1.65;

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FS = /* glsl */ `
uniform sampler2D uFrame;
uniform sampler2D uNoise;
uniform vec2 uRes;
uniform float uT;
uniform float uSeed;
varying vec2 vUv;

float hash(float n) {
  return fract(sin(n * 91.3458 + uSeed * 17.17) * 47453.5453);
}
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 3.7) * 43758.5453);
}
// Where the sheet's front edge is (0 the bottom of the screen, 1 the top):
// it slides off down the screen, faster and faster, wavering.
float frontAt(float x, float t) {
  float tt = max(t - 0.07, 0.0);
  return 1.06 - 3.2 * tt * tt - 0.4 * tt + 0.035 * sin(x * 11.0 + t * 5.0) + 0.018 * sin(x * 27.0 - t * 8.0 + 1.3);
}
// when it passes height y
float passAt(float y) {
  float c = max(1.06 - y, 0.0);
  return (-0.4 + sqrt(0.16 + 12.8 * c)) / 6.4 + 0.07;
}

// One layer of drops, one to a column: each hangs where the sheet left it,
// then streaks down, faster and faster, its head round and its body
// stretched up behind it, a wet trail beaded with little drops above it.
// Returns xy how far it bends the picture, z its glint, w its dark edge.
vec4 drops(vec2 p, float aspect, float cols, float size, float speed, float t, float seed) {
  float cw = aspect / cols;
  float ci = floor(p.x / cw);
  float h1 = hash(ci * 1.31 + seed);
  float h2 = hash(ci * 2.77 + seed + 1.9);
  float h3 = hash(ci * 4.13 + seed + 5.3);
  if (h3 < 0.22) return vec4(0.0);
  float y0 = 0.15 + 0.9 * h1;
  float start = passAt(y0) + h2 * 0.22;
  float tt = max(t - start, 0.0);
  float acc = speed * (0.55 + h2 * 0.9);
  float y = y0 - acc * tt * tt - 0.12 * tt;
  float r = size * (0.55 + 0.9 * h1 * h3);
  float x = (ci + 0.5 + (h3 - 0.5) * 0.5) * cw + sin(tt * 8.0 + h1 * 30.0) * r * 0.25 * min(tt * 4.0, 1.0);
  float vel = 2.0 * acc * tt + 0.12;
  vec2 d = p - vec2(x, y);
  float st = 1.0 + min(vel * 1.8, 3.2);
  vec2 e = vec2(d.x / r, d.y / (r * (d.y > 0.0 ? st : 0.92)));
  float L = length(e);
  float inside = 1.0 - smoothstep(0.84, 1.0, L);
  vec2 bend = -e * r * 1.1 * inside;
  float glint = (1.0 - smoothstep(0.0, 0.32, length(e - vec2(-0.32, 0.38)))) * inside;
  float edge = smoothstep(0.55, 0.95, L) * inside;
  // the trail behind it: a thin wet streak up to where it hung, beaded
  float run = max(y0 - y, 0.0);
  float tw = r * 0.3;
  float onTrail = step(0.0, d.y) * step(d.y, run) * step(0.012, tt);
  float bp = p.y / 0.024 + h1 * 7.0;
  float bc = floor(bp);
  float bh = hash(bc * 3.1 + ci * 7.7 + seed);
  vec2 bd = vec2(d.x - (bh - 0.5) * tw, (fract(bp) - 0.5) * 0.024) / (tw * (0.7 + bh * 0.9));
  float bead = (1.0 - smoothstep(0.75, 1.0, length(bd))) * step(0.45, bh) * onTrail;
  float streak = (1.0 - smoothstep(tw * 0.25, tw * 0.6, abs(d.x))) * onTrail * 0.5;
  float wet = max(bead, streak) * (1.0 - smoothstep(0.35, 0.8, tt)) * (1.0 - inside);
  bend += -bd * tw * 0.8 * bead * (1.0 - inside);
  bend.x += sign(d.x) * streak * tw * 0.4;
  glint = max(glint, wet * 0.25);
  return vec4(bend, glint, max(edge, bead * 0.4));
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 uv = vUv;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uT;
  float fade = 1.0 - smoothstep(1.2, 1.65, t);
  float n1 = texture2D(uNoise, p * 0.9 + vec2(0.0, t * 0.6)).g;
  float n2 = texture2D(uNoise, p * 2.3 + vec2(t * 0.2, t * 1.1) + 0.37).g;

  // the sheet: thick water over everything below its front edge, the
  // picture swimming behind it, ripples running down it
  float front = frontAt(p.x, t) + (n1 - 0.5) * 0.03;
  float film = smoothstep(front + 0.004, front - 0.035, p.y);
  vec2 off = vec2(sin(p.y * 21.0 + t * 9.0 + n1 * 6.0), cos(p.x * 15.0 - t * 7.0 + n2 * 6.0)) * 0.014 * film;
  off += (vec2(n2, n1) - 0.5) * 0.03 * film;
  // its front edge: a bright meniscus that bends the picture as it passes
  // (a rounded lip of water: it lifts the picture as it passes, light caught
  // along its crest and a darker band under it where it bends the most)
  float fe = p.y - front + 0.012;
  float lip = 1.0 - smoothstep(0.0, 0.04, abs(fe));
  off.y += lip * lip * 0.045 * sign(fe);
  float glint = (1.0 - smoothstep(0.0, 0.012, abs(fe - 0.006))) * (0.22 + 0.3 * n2);
  float dark = (1.0 - smoothstep(0.0, 0.035, abs(fe + 0.022))) * 0.45 * film;

  // drops left on the glass above it, streaking away
  float above = 1.0 - film;
  vec4 d1 = drops(p, aspect, 8.0, 0.05, 1.5, t, 1.0);
  vec4 d2 = drops(p, aspect, 19.0, 0.026, 2.3, t, 7.0);
  vec4 d3 = drops(p + vec2(aspect / 38.0, 0.0), aspect, 19.0, 0.018, 3.0, t, 13.0);
  off += (d1.xy + d2.xy + d3.xy) * above;
  glint = max(glint, max(d1.z, max(d2.z, d3.z)) * above);
  dark = max(dark, max(d1.w, max(d2.w, d3.w)) * above);
  // and a scatter of tiny ones that just cling, fading away
  vec2 sq = p / 0.032;
  vec2 sc = floor(sq);
  float sh = hash2(sc);
  vec2 so = vec2(hash2(sc + 1.7), hash2(sc + 4.3)) * 0.6 + 0.2;
  float sr = 0.1 + 0.18 * hash2(sc + 8.1);
  vec2 sd = (fract(sq) - so) / sr;
  float sl = length(sd);
  float speck = (1.0 - smoothstep(0.7, 1.0, sl)) * step(0.62, sh) * above * step(passAt(p.y), t) * (1.0 - smoothstep(0.6, 1.3, t - passAt(p.y)));
  off -= sd * 0.032 * sr * 0.8 * speck;
  glint = max(glint, (1.0 - smoothstep(0.0, 0.4, length(sd - vec2(-0.35, 0.35)))) * speck);
  dark = max(dark, smoothstep(0.5, 0.95, sl) * speck * 0.6);

  vec2 suv = uv + vec2(off.x / aspect, off.y) * fade;
  vec3 c = texture2D(uFrame, suv).rgb;
  if (film > 0.01) {
    // behind the sheet the picture is soft, swimming in thick water
    float b = 0.007 * film * fade;
    vec3 soft = texture2D(uFrame, suv + vec2(b, b * 0.6)).rgb + texture2D(uFrame, suv + vec2(-b, b * 0.5)).rgb + texture2D(uFrame, suv + vec2(0.0, -b)).rgb;
    c = mix(c, soft / 3.0, 0.75 * film);
  }
  // the sheet tints and lifts what's behind it a little
  c = mix(c, c * vec3(0.84, 1.02, 1.06) + vec3(0.04, 0.09, 0.1), film * 0.75 * fade);
  // the first instant: white water flashing across the whole screen, flung
  // out in streaks from where it hit
  float hit = 1.0 - smoothstep(0.0, 0.22, t);
  vec2 q = vec2(p.x - aspect * 0.5, p.y + 0.15);
  float ang = atan(q.x, q.y);
  float ray = texture2D(uNoise, vec2(ang * 1.7, 0.31)).g;
  float crown = smoothstep(0.45, 0.7, ray) * smoothstep(t * 5.5 - 0.6, t * 5.5, length(q)) * (1.0 - smoothstep(t * 5.5, t * 5.5 + 0.35, length(q)));
  float foam = smoothstep(0.42, 0.62, n1 * 0.6 + n2 * 0.5);
  c = mix(c, vec3(0.88, 1.0, 0.98), clamp(hit * (0.3 + 0.45 * foam) + crown * 0.55 * (1.0 - smoothstep(0.1, 0.35, t)), 0.0, 0.9));
  c *= 1.0 - dark * 0.4 * fade;
  c += vec3(0.85, 1.0, 1.0) * glint * 0.7 * fade;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Splash {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFrame: { value: null },
        uNoise: shared.uNoise,
        uRes: { value: new THREE.Vector2(1, 1) },
        uT: { value: 0 },
        uSeed: { value: 0 },
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
    return this.t < SPLASH_TIME;
  }

  update(dt) {
    if (this.active) this.t += dt;
  }

  // Over the finished frame: copy it, then draw it again through the water.
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
