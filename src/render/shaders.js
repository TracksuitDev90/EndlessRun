import * as THREE from '../../vendor/three/three.module.min.js';

// We author every color in sRGB and want it on screen untouched — the look is
// flat illustration, not physically based lighting.
THREE.ColorManagement.enabled = false;

// Uniforms shared by every material in the game (same JS objects, so one write
// updates all programs).
export const shared = {
  uCamPos: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  uBend: { value: new THREE.Vector4(0.00085, 0, 0, 10) }, // x: bend, y: sway, w: start
  uMarks: { value: null },
  uNoise: { value: null },
  uPixelRatio: { value: 1 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  // Dream depth (see game/dream.js), shared by every world so the doorway
  // and both worlds around it always warp together.
  uDream: { value: new THREE.Vector4() }, // x twist, y waves, z melt, w breathe
  uDream2: { value: new THREE.Vector4() }, // x colour rings, y sky swirl, z neon ink, w doorway rush
  uDream3: { value: new THREE.Vector4() }, // x palette hue shift, y saturation push, z rush progress, w rush swell
  // the doorway bloom: x how much of it is the new world's own colours, y how
  // much is rainbow (the deeper the trip, the more rainbow); its three colours
  uBloom: { value: new THREE.Vector4(1, 0, 0, 0) },
  uBloomCol: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
  // the runner's chest: a collected gem flies into it (see VS_GEM)
  uGemAt: { value: new THREE.Vector3() },
};

const COMMON = /* glsl */ `
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uBend;
uniform vec4 uTrip; // x hue shift, y far-world undulation, z hue drift
uniform vec4 uDream;
uniform vec4 uDream3;
// The curved world, plus everything the dream does to the shape of it. All of
// it grows with distance, so the stretch of road you're actually reading is
// always true.
vec3 bendPos(vec3 wp) {
  vec3 o = wp;
  float a = uCamPos.z - wp.z;
  float d = clamp(a - uBend.w, 0.0, 320.0);
  float d2 = d * d;
  wp.y -= uBend.x * d2;
  wp.x += uBend.y * d2;
  float wv = uTrip.y + uDream.y;
  if (wv != 0.0) {
    // the distant world breathes in slow waves rolling toward you
    float k = d * 0.0125;
    k *= k;
    wp.y += sin(a * 0.045 - uTime * 0.7) * wv * k * 5.0;
    wp.x += sin(a * 0.028 + uTime * 0.45) * wv * k * 8.0;
  }
  if (uDream.z != 0.0) {
    // melt: the far world wobbles like jelly, the tall things most
    float k = smoothstep(12.0, 70.0, d) * uDream.z;
    float h = max(o.y, 0.0);
    wp.x += sin(o.y * 0.42 + uTime * 1.3 + a * 0.05) * k * (0.45 + h * 0.26);
    wp.y += sin(o.x * 0.35 + uTime * 0.9 + a * 0.03) * k * h * 0.1;
  }
  if (uDream.x != 0.0) {
    // twist: the road ahead corkscrews about its own axis
    float k = smoothstep(14.0, 130.0, d);
    float ang = uDream.x * k * (0.75 + 0.45 * sin(uTime * 0.16));
    vec2 c = vec2(0.0, 1.5 - uBend.x * d2);
    vec2 r = wp.xy - c;
    float cs = cos(ang);
    float sn = sin(ang);
    wp.xy = c + vec2(r.x * cs - r.y * sn, r.x * sn + r.y * cs);
  }
  if (uDream3.w > 0.0) {
    // through a doorway: a swell races out across the world ahead
    float x = (a - uDream3.z * 150.0) / 9.0;
    wp.y += uDream3.w * exp(-x * x) * 1.6 * smoothstep(8.0, 30.0, a);
  }
  return wp;
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
`;

const SKY_FN = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uGrade; // x saturation, y contrast, z vignette, w exposure
uniform vec3 uVignette;
uniform vec2 uResolution;
uniform vec4 uDream2;
uniform vec4 uDream3;
uniform vec4 uBloom;
uniform vec3 uBloomCol[3];
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// Per-world color grade + tinted vignette, applied to everything opaque, plus
// the dream's colour: a palette shift, rings of hue rolling toward you through
// the world (dist < 0: no world position, e.g. the sky), and a bloom of colour
// from the centre of the screen as you come through a doorway — bands of the
// new world's own colours laid over the picture's light and shade, turning to
// rainbow as the trip deepens.
vec3 grade(vec3 c, vec4 trip, float dist) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uGrade.x * (1.0 + uDream3.y));
  c = (c - 0.5) * uGrade.y + 0.5;
  c *= uGrade.w;
  vec2 q = gl_FragCoord.xy / uResolution - 0.5;
  float r = length(q) * 1.414;
  float h = trip.x + trip.z * sin(uTime * 0.13) + uDream3.x;
  if (uDream2.x > 0.0 && dist >= 0.0) h += uDream2.x * sin(dist * 0.06 - uTime * 1.3) * 1.6 * smoothstep(10.0, 40.0, dist);
  if (uDream2.w > 0.0) {
    float k = uDream2.w * smoothstep(0.05, 0.5, r);
    float s = sin(r * 9.0 - uTime * 7.0);
    float u = 0.5 + 0.5 * s;
    vec3 band = u < 0.5 ? mix(uBloomCol[0], uBloomCol[1], u * 2.0) : mix(uBloomCol[1], uBloomCol[2], u * 2.0 - 1.0);
    float lc = dot(c, vec3(0.299, 0.587, 0.114));
    float lb = max(dot(band, vec3(0.299, 0.587, 0.114)), 0.05);
    vec3 tinted = min(band * (0.4 + 0.9 * lc / lb), vec3(1.25));
    c = mix(c, tinted, clamp(k * uBloom.x, 0.0, 0.85)) + band * (k * uBloom.x * 0.2 * u * u);
    h += k * uBloom.y * s * 1.4;
  }
  if (h != 0.0) c = hueRot(c, h);
  float vg = smoothstep(0.42, 0.95, r) * uGrade.z;
  return mix(c, c * uVignette, vg);
}
vec3 grade(vec3 c, vec4 trip) {
  return grade(c, trip, -1.0);
}
vec3 skyColor(vec3 dir) {
  float h = dir.y;
  vec3 upC = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.62, pow(max(h, 0.0), 0.8)));
  vec3 dnC = mix(uSkyHorizon, uSkyBottom, smoothstep(0.0, 0.2, -h));
  vec3 c = h > 0.0 ? upC : dnC;
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (pow(s, 5.0) * 0.22 + pow(s, 48.0) * 0.42);
  return c;
}
`;

// ---------------------------------------------------------------------------
// Object vertex shader: instancing, pop-up unfold, swinging doors, foliage
// wobble, ink-outline extrusion and the curved-world bend.
// uAnim.x mode: 0 static, 1 pop-up hinge, 2 rise (per-vertex), 3 swing
// ---------------------------------------------------------------------------
const VS_OBJECT = COMMON + /* glsl */ `
uniform vec4 uAnim;
uniform vec4 uWobble;
uniform vec4 uFly; // x flap amplitude (rad), y flap speed, z drift radius, w drift speed
uniform float uDreamK; // 1 for props that may breathe (see makeToonMaterial)
attribute vec3 fx;
#ifdef OUTLINE
uniform float uOutline;
attribute vec3 onrm;
#endif
#ifdef USE_INSTANCING
attribute vec4 aInst;
#endif
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vFx;

vec3 rotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
vec3 rotXcs(vec3 v, float c, float s) {
  return vec3(v.x, v.y * c + v.z * s, -v.y * s + v.z * c);
}
float easeOutBack(float t) {
  float u = t - 1.0;
  return 1.0 + 2.5 * u * u * u + 1.5 * u * u;
}

void main() {
  mat4 M = modelMatrix;
  float phase = 0.0;
  float sgn = 1.0;
  #ifdef USE_INSTANCING
    M = modelMatrix * instanceMatrix;
    phase = aInst.x;
    sgn = aInst.y;
  #endif
  vec3 lp = position;
  vec3 ln = normal;
  #ifdef OUTLINE
    vec3 lo = onrm;
  #endif
  vec3 pivot = M[3].xyz;
  float aP = uCamPos.z - pivot.z;
  int mode = int(uAnim.x + 0.5);

  if (mode == 3) {
    float t = 1.0 - smoothstep(uAnim.y, uAnim.z, aP);
    t = t * t * (3.0 - 2.0 * t);
    float ang = sgn * t * uAnim.w;
    lp = rotY(lp, ang);
    ln = rotY(ln, ang);
    #ifdef OUTLINE
      lo = rotY(lo, ang);
    #endif
  }
  if (uFly.x != 0.0) {
    // wings / book covers hinge on the local z axis and beat
    float side = lp.x < 0.0 ? -1.0 : 1.0;
    float ang = side * (0.15 + (0.5 + 0.5 * sin(uTime * uFly.y + phase * 3.0)) * uFly.x) * smoothstep(0.015, 0.09, abs(lp.x));
    float fc = cos(ang), fs = sin(ang);
    lp.xy = vec2(lp.x * fc - lp.y * fs, lp.x * fs + lp.y * fc);
    ln.xy = vec2(ln.x * fc - ln.y * fs, ln.x * fs + ln.y * fc);
    #ifdef OUTLINE
      lo.xy = vec2(lo.x * fc - lo.y * fs, lo.x * fs + lo.y * fc);
    #endif
  }
  if (uWobble.x != 0.0) {
    float h = abs(lp.y);
    lp.x += sin(uTime * uWobble.z + phase) * uWobble.x * h * h;
  }
  if (uWobble.y != 0.0) {
    lp.y += sin(uTime * uWobble.z * 0.8 + phase * 1.7) * uWobble.y;
  }

  vec3 wp = (M * vec4(lp, 1.0)).xyz;
  vec3 wn = normalize(mat3(M) * ln);
  #ifdef OUTLINE
    vec3 wo = mat3(M) * lo;
  #endif
  if (uFly.z != 0.0) {
    float ft = uTime * uFly.w + phase * 5.0;
    vec3 off = vec3(sin(ft), 0.45 * sin(ft * 1.7 + 1.0), cos(ft * 0.8)) * uFly.z;
    wp += off;
    pivot += off;
  }

  if (mode == 1) {
    // Pop-up book: lies flat (folded away from camera) when far, stands up as it nears.
    float t = 1.0 - smoothstep(uAnim.y, uAnim.z, aP);
    float ang = (1.0 - easeOutBack(t)) * 1.5708;
    float c = cos(ang), s = sin(ang);
    wp = pivot + rotXcs(wp - pivot, c, s);
    wn = rotXcs(wn, c, s);
    #ifdef OUTLINE
      wo = rotXcs(wo, c, s);
    #endif
  } else if (mode == 2) {
    // Continuous structures grow up out of the ground in a travelling wave.
    float t = 1.0 - smoothstep(uAnim.y, uAnim.z, uCamPos.z - wp.z);
    wp.y = pivot.y + (wp.y - pivot.y) * max(easeOutBack(t), 0.002);
  } else if (mode == 4) {
    // Big masses (buildings, islands) lift up out of the depths.
    float t = 1.0 - smoothstep(uAnim.y, uAnim.z, aP);
    wp.y -= (1.0 - easeOutBack(t)) * uAnim.w;
  }

  if (uDream.w * uDreamK > 0.0) {
    // breathe: props in the distance swell and settle like living things,
    // and firm up into their true shape as they come close
    float k = smoothstep(26.0, 64.0, aP) * uDream.w * uDreamK;
    float b = sin(uTime * 1.6 + phase * 2.0 + aP * 0.06) * k;
    wp.y = pivot.y + (wp.y - pivot.y) * (1.0 + b * 0.34);
    wp.xz = pivot.xz + (wp.xz - pivot.xz) * (1.0 - b * 0.12);
  }

  vPos = wp;
  #ifdef OUTLINE
    float w = length(onrm);
    if (w > 0.0001) {
      float dist = length(wp - uCamPos);
      wp += normalize(wo) * (w * uOutline * (1.0 + dist * 0.011));
    }
  #endif
  wp = bendPos(wp);
  vWorld = wp;
  vNormal = wn;
  vUv = uv;
  #ifdef GROUND
    #if GROUND == 6
      vUv.y += phase; // the pattern runs on across chunks (p0 = chunk distance)
    #endif
  #endif
  vFx = fx;
  vec3 col = color;
  #ifdef USE_INSTANCING_COLOR
    col = mix(col, col * instanceColor, fx.z);
  #endif
  vColor = col;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Skinned characters: one continuous mesh deformed by a skeleton (three.js
// supplies the bone texture), with the ink-outline normals skinned as well.
// ---------------------------------------------------------------------------
const VS_SKIN = COMMON + /* glsl */ `
#include <skinning_pars_vertex>
attribute vec3 fx;
#ifdef OUTLINE
uniform float uOutline;
attribute vec3 onrm;
#endif
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vFx;

void main() {
  vec3 lp = position;
  vec3 ln = normal;
  #ifdef OUTLINE
    vec3 lo = onrm;
  #endif
  #ifdef USE_SKINNING
    mat4 skinM = skinWeight.x * getBoneMatrix(skinIndex.x)
      + skinWeight.y * getBoneMatrix(skinIndex.y)
      + skinWeight.z * getBoneMatrix(skinIndex.z)
      + skinWeight.w * getBoneMatrix(skinIndex.w);
    skinM = bindMatrixInverse * skinM * bindMatrix;
    lp = (skinM * vec4(lp, 1.0)).xyz;
    ln = mat3(skinM) * ln;
    #ifdef OUTLINE
      lo = mat3(skinM) * lo;
    #endif
  #endif
  vec3 wp = (modelMatrix * vec4(lp, 1.0)).xyz;
  vec3 wn = normalize(mat3(modelMatrix) * ln);
  vPos = wp;
  #ifdef OUTLINE
    float w = length(onrm);
    if (w > 0.0001) {
      float dist = length(wp - uCamPos);
      wp += normalize(mat3(modelMatrix) * lo) * (w * uOutline * (1.0 + dist * 0.011));
    }
  #endif
  wp = bendPos(wp);
  vWorld = wp;
  vNormal = wn;
  vUv = uv;
  vFx = fx;
  vColor = color;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FS_HEAD = /* glsl */ `
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uFog;
uniform vec4 uMist;  // rgb, amount
uniform vec4 uMistH; // x top height, y thickness, z near, w far
uniform vec4 uTrip;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vFx;
` + SKY_FN + /* glsl */ `
// Low-lying mist by true height, then distance fog into the sky color.
vec3 atmos(vec3 col, vec3 v, float dist, float emissive) {
  float mh = 1.0 - smoothstep(uMistH.x - uMistH.y, uMistH.x, vPos.y);
  float md = smoothstep(uMistH.z, uMistH.w, dist);
  col = mix(col, uMist.rgb, mh * md * uMist.a * (1.0 - emissive * 0.6));
  float f = smoothstep(uFog.x, uFog.y, dist);
  f *= 1.0 - emissive * uFog.z;
  return mix(col, skyColor(v / dist), f);
}
`;

const FS_TOON = FS_HEAD + /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uShadowTint;
uniform vec3 uHiTint;
uniform vec4 uLightK; // x terminator softness, y wrap, z highlight amount, w sky fill on upward faces
uniform vec4 uRim;    // rgb back-light color, w band width
uniform vec4 uDapple; // x amount, y scale, z drift
uniform vec4 uWall;   // wall-cast shadow: x wall x (signed), y wall top, z run per meter of drop, w strength
uniform sampler2D uMarks;
uniform sampler2D uNoise;
uniform vec2 uMarkRepeat;
#ifdef GROUND
uniform vec3 uGroundA;
uniform vec3 uGroundB;
uniform vec3 uGroundC;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float edgeMask(vec2 f, vec2 size, float w) {
  vec2 e = min(f, 1.0 - f) * size;
  float aa = max(fwidth(vUv.y), fwidth(vUv.x)) * 0.8;
  return smoothstep(w - aa, w + aa, min(e.x, e.y));
}
vec3 groundColor(vec2 p, float dist) {
  float far = smoothstep(25.0, 140.0, dist);
  vec3 avg = mix(uGroundA, uGroundB, 0.5);
  #if GROUND == 1
    // cobblestones in staggered rows
    vec2 cs = vec2(0.46, 0.32);
    vec2 q = p / cs;
    q.x += mod(floor(q.y), 2.0) * 0.5;
    vec2 cell = floor(q);
    float h = hash12(cell + 17.0);
    vec3 c = mix(uGroundA, uGroundB, h);
    c = mix(mix(uGroundC, c, 0.35), c, mix(edgeMask(fract(q), cs, 0.026), 1.0, far * 0.8));
    c = mix(c, avg, far * 0.5);
    float border = smoothstep(3.95, 4.05, abs(p.x));
    return mix(c, uGroundC * 1.12, border);
  #elif GROUND == 2
    // slate roof walkway with lane seams
    vec2 cs = vec2(0.8, 0.55);
    vec2 q = p / cs;
    q.x += mod(floor(q.y), 2.0) * 0.5;
    vec2 cell = floor(q);
    float h = hash12(cell + 3.0);
    vec3 c = mix(uGroundA, uGroundB, h);
    c = mix(uGroundC, c, mix(edgeMask(fract(q), cs, 0.03), 1.0, far * 0.8));
    float lane = 1.0 - smoothstep(0.05, 0.09, abs(abs(p.x) - 1.2));
    c = mix(c, uGroundC, lane * 0.55 * (1.0 - far));
    float border = smoothstep(4.0, 4.1, abs(p.x));
    return mix(c, uGroundC, border);
  #elif GROUND == 3
    // black & cream checkerboard aligned to lanes
    vec2 q = vec2(p.x + 3.6, p.y) / 1.2;
    vec2 cell = floor(q);
    float k = mod(cell.x + cell.y, 2.0);
    vec3 c = mix(uGroundA, uGroundB, k);
    c = mix(c, avg, far * 0.85);
    float border = smoothstep(3.6, 3.68, abs(p.x));
    return mix(c, uGroundC, border);
  #elif GROUND == 4
    // diamond terracotta/pale tiles
    vec2 r = vec2(p.x + p.y, p.y - p.x) * 0.7071 / 0.85;
    vec2 cell = floor(r);
    float k = mod(cell.x + cell.y, 2.0);
    vec3 c = mix(uGroundA, uGroundB, k);
    c = mix(uGroundC, c, mix(edgeMask(fract(r), vec2(0.85), 0.03), 1.0, far * 0.8));
    c = mix(c, avg, far * 0.6);
    float border = smoothstep(3.75, 3.85, abs(p.x));
    return mix(c, uGroundC, border);
  #elif GROUND == 6
    // forest floor: long grass laid down in painterly strokes (two staggered
    // layers of tapering blades, dark at the root, catching light at the tip),
    // a trodden earth path wandering down the middle, flecks of wildflowers.
    // p.y runs on from chunk to chunk (see the vertex shader), so every period
    // here divides the 4096 m it wraps at.
    float soften = smoothstep(0.25, 0.9, fwidth(p.x) * 9.0);
    vec3 c = mix(uGroundA, uGroundB, 0.3);
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      vec2 gs = vec2(0.075, 0.42);
      vec2 q = vec2(p.x + sin(p.y * 0.785398 + fk * 2.1) * 0.1 + fk * 0.0375, p.y + fk * 0.21) / gs;
      q.y += hash12(vec2(floor(q.x), 7.0 + fk)) * 4.0;
      vec2 cell = floor(q);
      vec2 f = fract(q);
      float h = hash12(cell + 11.0 + fk * 5.0);
      float h2 = hash12(cell + 23.0 + fk);
      float lean = (hash12(cell + 3.0) - 0.5) * 0.7;
      // a spindle: fades in at the root, widest low down, tapering to a point
      float wdt = 0.62 * (1.0 - f.y) * smoothstep(0.0, 0.35, f.y) * (0.65 + h2 * 0.7);
      float aa = fwidth(q.x) + 0.04;
      float blade = 1.0 - smoothstep(wdt - aa, wdt + aa, abs(f.x - 0.5 - (h2 - 0.5) * 0.3 - lean * f.y));
      vec3 bc = mix(uGroundA, uGroundB, h * 0.55 + f.y * 0.45);
      c = mix(c, bc, blade * (1.0 - soften * 0.75) * (k == 0 ? 1.0 : 0.8));
    }
    float wander = sin(p.y * 0.0490874) * 0.9 + sin(p.y * 0.1963495 + 1.7) * 0.4;
    float pw = 1.05 + 0.4 * sin(p.y * 0.392699 + 0.6);
    float wash = texture2D(uNoise, p * 0.0625).g;
    float edge = abs(p.x - wander) - pw + (wash - 0.5) * 0.9;
    // grass creeping in over the edges in streaks along the path
    float tuft = texture2D(uNoise, vec2(p.x * 1.6, p.y * 0.375)).g;
    float dirt = 1.0 - smoothstep(-0.3, 0.05, edge + (tuft - 0.5) * 0.7);
    vec3 earth = uGroundC * (0.85 + texture2D(uNoise, p * 0.25).g * 0.3);
    c = mix(c, earth, dirt * (1.0 - far * 0.4));
    // wildflowers dotted through the grass (not on the path)
    vec2 fq = p / 0.5;
    vec2 fc = floor(fq);
    float fh = hash12(fc + 41.0);
    vec2 fo = vec2(hash12(fc + 3.7), hash12(fc + 9.1)) * 0.6 + 0.2;
    float fd = length((fract(fq) - fo) * vec2(1.0, 0.7));
    float faa = fwidth(fq.x) * 1.2;
    float petal = (1.0 - smoothstep(0.07 - faa, 0.07 + faa, fd)) * step(0.91, fh) * (1.0 - dirt) * (1.0 - far);
    vec3 bloom = fh > 0.975 ? vec3(0.8, 0.68, 1.0) : fh > 0.945 ? vec3(1.0, 0.86, 0.36) : vec3(1.0, 0.98, 0.9);
    c = mix(c, bloom, petal);
    c = mix(c, mix(uGroundA, uGroundB, 0.4), far * 0.55);
    float border = smoothstep(3.9, 4.4, abs(p.x));
    return mix(c, uGroundA * 0.85, border);
  #else
    // causeway road with dashed lane lines
    float n = hash12(floor(p * vec2(1.0, 0.5)));
    vec3 c = uGroundA * (0.985 + n * 0.03);
    float dash = step(fract(p.y / 4.0), 0.5);
    float aa = fwidth(p.x) + 0.01;
    float lane = 1.0 - smoothstep(0.08 - aa, 0.08 + aa, abs(abs(p.x) - 1.2));
    c = mix(c, uGroundB, lane * dash * (1.0 - far * 0.6));
    float edge = 1.0 - smoothstep(0.1 - aa, 0.1 + aa, abs(abs(p.x) - 3.9));
    c = mix(c, uGroundB, edge * (1.0 - far * 0.5));
    float border = smoothstep(4.05, 4.15, abs(p.x));
    return mix(c, uGroundC, border);
  #endif
}
#endif

void main() {
  vec3 n = normalize(vNormal);
  n = gl_FrontFacing ? n : -n;
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  #ifdef GROUND
    vec3 base = groundColor(vUv, dist) * vColor;
  #else
    vec3 base = vColor;
  #endif
  float m = texture2D(uMarks, vUv * uMarkRepeat).a * vFx.x;
  base = mix(base, base * 0.64, m);

  vec3 V = v / dist;
  float ndl = dot(n, uLightDir);
  float wl = (ndl + uLightK.y) / (1.0 + uLightK.y);
  float lit = smoothstep(-uLightK.x, uLightK.x + 0.03, wl);
  if (uWall.w > 0.0) {
    // everything between a tall wall and the line its top casts is in shade
    float side = uWall.x > 0.0 ? 1.0 : -1.0;
    float wx = abs(uWall.x);
    float edge = wx - (uWall.y - vPos.y) * uWall.z;
    float px = vPos.x * side;
    float inSh = smoothstep(edge - 0.015, edge + 0.015, px) * (1.0 - step(wx + 0.4, px)) * step(vPos.y, uWall.y);
    lit *= 1.0 - inSh * uWall.w;
  }
  float hi = smoothstep(0.62, 0.68 + uLightK.x, ndl) * uLightK.z * lit;
  float up = clamp(n.y, 0.0, 1.0);
  vec3 sh = mix(uShadowTint, mix(uShadowTint, vec3(1.0), 0.35), up * uLightK.w);
  vec3 shade = mix(sh, vec3(1.0), lit);
  shade = mix(shade, uHiTint, hi);
  #ifdef GROUND
    if (uDapple.x > 0.0) {
      // sunlight dappled through leaves / glazing bars, drifting slowly
      vec2 dq = vPos.xz * uDapple.y + vec2(uTime * uDapple.z, uTime * uDapple.z * 0.6);
      float dp = texture2D(uNoise, dq).g * 0.6 + texture2D(uNoise, dq * 2.3 + 0.37).g * 0.4;
      shade *= 1.0 + (smoothstep(0.42, 0.62, dp) - 0.45) * uDapple.x;
    }
  #endif
  vec3 col = mix(base * shade, base, vFx.y);

  #ifdef WATER
    // running water (local u is downstream): a dark body that takes a wash of
    // reflected sky at grazing angles, ripple streaks drifting downstream, and
    // glints that ignore the shade so a stream still reads in the dark
    vec2 fq = vUv * vec2(0.3, 0.9) + vec2(-uTime * 0.22, 0.0);
    float r1 = texture2D(uNoise, fq).g;
    float r2 = texture2D(uNoise, fq * vec2(2.1, 2.6) + vec2(-uTime * 0.13, 0.41)).g;
    float rip = smoothstep(0.58, 0.7, r1 * 0.6 + r2 * 0.5);
    float trough = 1.0 - smoothstep(0.3, 0.46, r1 * 0.5 + r2 * 0.5);
    float glint = smoothstep(0.76, 0.81, r1 * 0.45 + r2 * 0.65);
    float wfres = pow(1.0 - abs(V.y), 3.0);
    vec3 skyW = skyColor(reflect(V, vec3(0.0, 1.0, 0.0)));
    vec3 hl = mix(skyW, vec3(0.86, 0.78, 1.0), 0.55) * 1.35 + 0.18;
    col = mix(base * mix(vec3(1.0), shade, 0.4), skyW, 0.18 + 0.5 * wfres);
    col *= 1.0 - trough * 0.45;
    col = mix(col, hl, rip * 0.5 + glint * 0.5);
  #endif

  #ifndef GROUND
    // back light: silhouettes catch the light when it's behind them
    float fres = 1.0 - abs(dot(n, V));
    float back = clamp(dot(uLightDir, V) * 0.6 + 0.4, 0.0, 1.0);
    float rim = smoothstep(1.0 - uRim.w, 1.0 - uRim.w * 0.55, fres) * back * (1.0 - smoothstep(0.5, 0.9, n.y));
    col += uRim.rgb * (0.45 + 0.55 * base) * rim * (1.0 - vFx.y);
  #endif

  float g = texture2D(uNoise, gl_FragCoord.xy * (1.0 / 128.0)).r - 0.5;
  float wash = texture2D(uNoise, vPos.xz * (1.0 / 64.0)).g - 0.5;
  col *= 1.0 + g * 0.05 + wash * 0.09;

  col = atmos(col, v, dist, vFx.y);
  gl_FragColor = vec4(grade(col, uTrip, dist), 1.0);
}
`;

const FS_INK = FS_HEAD + /* glsl */ `
uniform vec3 uInk;
void main() {
  vec3 ink = mix(uInk, vColor * 0.3, 0.42);
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  float glow = 0.0;
  if (uDream2.z > 0.0) {
    // deep in the dream the ink lines burn in neon, cycling through the hues
    glow = uDream2.z * smoothstep(8.0, 30.0, dist);
    vec3 neon = hueRot(vec3(1.0, 0.25, 0.62), uTime * 0.6 + vWorld.z * 0.04 + vWorld.y * 0.12);
    ink = mix(ink, neon * 1.2, glow);
  }
  gl_FragColor = vec4(grade(atmos(ink, v, dist, glow * 0.7), uTrip, dist), 1.0);
}
`;

// ---------------------------------------------------------------------------
// The runner: an illustrated look of its own. Flat local colours, one crisp,
// broad shadow shape (warm, with a share of the world's tint), a restrained
// rim, no specular. Linework that would be fussy to model — quilting seams,
// laces, the face, trims — is drawn from each vertex's rest position and a few
// smooth garment coordinates (aD), so it stays crisp at any distance. The ink
// hull is thin and takes a dark shade of the local colour.
// ---------------------------------------------------------------------------
const VS_CHAR = COMMON + /* glsl */ `
#include <skinning_pars_vertex>
attribute vec4 aD;
attribute float aMat;
#ifdef OUTLINE
uniform float uOutline;
attribute vec3 onrm;
#endif
#ifdef CAPE
// The cape: each vertex knows only where it lies on the particle grid; the
// surface is rebuilt here through the simulated particles (Catmull-Rom, so it
// passes through every one of them, with exact normals from its tangents).
uniform sampler2D uCape; // particle positions in the runner's space, cols x rows
uniform vec4 uCapeGrid; // x cols, y rows, z half thickness
attribute vec4 aCape; // x, y grid position; z side (+1 outside, -1 lining); w 0 inside, 1 border, 2 edge strip
attribute vec2 aEdge; // which border(s): -1 / +1 across and down
vec4 capeRaw(int i, int j) {
  return texelFetch(uCape, ivec2(i, j), 0);
}
// past the border the grid continues its last segment straight on (w, the
// fold, just carries on as it is at the border)
vec4 capeOn(vec4 a, vec4 b) {
  return vec4(2.0 * a.xyz - b.xyz, a.w);
}
vec4 capeRow(int i, int j) {
  int C = int(uCapeGrid.x);
  if (i < 0) return capeOn(capeRaw(0, j), capeRaw(1, j));
  if (i >= C) return capeOn(capeRaw(C - 1, j), capeRaw(C - 2, j));
  return capeRaw(i, j);
}
vec4 capeP(int i, int j) {
  int R = int(uCapeGrid.y);
  if (j < 0) return capeOn(capeRow(i, 0), capeRow(i, 1));
  if (j >= R) return capeOn(capeRow(i, R - 1), capeRow(i, R - 2));
  return capeRow(i, j);
}
vec4 crW(float t) {
  float t2 = t * t, t3 = t2 * t;
  return 0.5 * vec4(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2);
}
vec4 crD(float t) {
  float t2 = t * t;
  return 0.5 * vec4(-3.0 * t2 + 4.0 * t - 1.0, 9.0 * t2 - 10.0 * t, -9.0 * t2 + 8.0 * t + 1.0, 3.0 * t2 - 2.0 * t);
}
// position, tangents across (u) and down (v), and how deeply the cloth folds
// there (curvature measured per particle, carried in w, smoothly blended)
void capeSurface(vec2 g, out vec3 P, out vec3 Tu, out vec3 Tv, out float fold) {
  int i0 = int(clamp(floor(g.x), 0.0, uCapeGrid.x - 2.0));
  int j0 = int(clamp(floor(g.y), 0.0, uCapeGrid.y - 2.0));
  float fu = g.x - float(i0), fv = g.y - float(j0);
  vec4 wu = crW(fu), du = crD(fu);
  vec4 wv = crW(fv), dv = crD(fv);
  P = vec3(0.0);
  Tu = vec3(0.0);
  Tv = vec3(0.0);
  fold = 0.0;
  for (int b = 0; b < 4; b++) {
    vec3 r = vec3(0.0), rd = vec3(0.0);
    float k = 0.0;
    for (int a = 0; a < 4; a++) {
      vec4 c = capeP(i0 - 1 + a, j0 - 1 + b);
      r += c.xyz * wu[a];
      rd += c.xyz * du[a];
      k += c.w * wu[a];
    }
    P += r * wv[b];
    Tu += rd * wv[b];
    Tv += r * dv[b];
    fold += k * wv[b];
  }
}
vec3 safeNormalize(vec3 v) {
  return v * inversesqrt(max(dot(v, v), 1e-12));
}
#endif
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vFx;
varying vec3 vRest;
varying vec4 vD;
varying float vMat;

void main() {
  vec3 lp = position;
  vec3 ln = normal;
  #ifdef OUTLINE
    vec3 lo = onrm;
  #endif
  #ifdef CAPE
    vec3 P, Tu, Tv;
    float fold;
    capeSurface(aCape.xy, P, Tu, Tv, fold);
    vec3 nC = safeNormalize(cross(Tv, Tu));
    float side = aCape.z;
    // > 0 in the valleys of its folds and waves as seen from this side
    vFx = vec3(fold * side, 0.0, 0.0);
    vec3 e = vec3(0.0);
    if (aCape.w > 0.5) {
      vec3 eu = safeNormalize(Tu - nC * dot(nC, Tu));
      vec3 ev = safeNormalize(Tv - nC * dot(nC, Tv));
      e = safeNormalize(aEdge.x * eu + aEdge.y * ev);
    }
    lp = P + nC * (side * uCapeGrid.z);
    ln = aCape.w > 1.5 ? e : nC * side;
    #ifdef OUTLINE
      lo = (aCape.w > 0.5 ? safeNormalize(nC * side + e) : nC * side) * 0.6;
    #endif
  #endif
  #ifdef USE_SKINNING
    mat4 skinM = skinWeight.x * getBoneMatrix(skinIndex.x)
      + skinWeight.y * getBoneMatrix(skinIndex.y)
      + skinWeight.z * getBoneMatrix(skinIndex.z)
      + skinWeight.w * getBoneMatrix(skinIndex.w);
    skinM = bindMatrixInverse * skinM * bindMatrix;
    lp = (skinM * vec4(lp, 1.0)).xyz;
    ln = mat3(skinM) * ln;
    #ifdef OUTLINE
      lo = mat3(skinM) * lo;
    #endif
  #endif
  vec3 wp = (modelMatrix * vec4(lp, 1.0)).xyz;
  vPos = wp;
  #ifdef OUTLINE
    float w = length(lo);
    if (w > 0.0001) {
      float dist = length(wp - uCamPos);
      wp += normalize(mat3(modelMatrix) * lo) * (w * uOutline * (1.0 + dist * 0.011));
    }
  #endif
  wp = bendPos(wp);
  vWorld = wp;
  vNormal = normalize(mat3(modelMatrix) * ln);
  vColor = vec3(0.0);
  vUv = vec2(0.0);
  #ifndef CAPE
    vFx = vec3(0.0);
  #endif
  vRest = position;
  vD = aD;
  vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

// Palette slots beyond the garment ids (see COL in game/outfit.js).
const CHAR_DETAIL = /* glsl */ `
uniform vec3 uPal[32];
// [0]: x sock line, y boot x offset, z sleeve cuff start, w shorts hem;
// [1]: x boot collar height over the ankle, y its rise toward the heel, z sole height
uniform vec4 uRig[2];
varying vec3 vRest;
varying vec4 vD;
varying float vMat;
#define P_SEAM 13
#define P_CUFF 14
#define P_SOCK 15
#define P_BOOT_DARK 16
#define P_SOLE 17
#define P_MIDSOLE 18
#define P_LACE 19
#define P_LINING 21
#define P_EYE 22
#define P_IRIS 23
#define P_INK 24
#define P_MOUTH 25
#define P_BLUSH 26
#define P_FLAP 27
#define P_SHORTS_LINE 28
#define P_ZIP 29
// antialiased coverage of d < 0, and of a band |d| < halfw
float fill(float d) {
  float w = fwidth(d) * 0.75 + 1e-6;
  return 1.0 - smoothstep(-w, w, d);
}
float band(float d, float halfw) {
  return fill(abs(d) - halfw);
}
// lines at every integer of x, halfw in the same units
float lines(float x, float halfw) {
  return band(abs(fract(x + 0.5) - 0.5), halfw);
}
// The face, drawn on the front of the head like an illustration: almond eyes
// with a heavy upper lash line, brows, a small smile, a touch of blush.
// Returns the colour and how much of it ignores the light (the eyes glint).
vec3 drawFace(vec3 base, vec3 r, inout float unlit) {
  float front = smoothstep(-0.055, -0.08, r.z);
  if (front <= 0.0) return base;
  vec2 f = vec2(abs(r.x), r.y);
  vec3 c = base;
  vec2 E = vec2(0.036, 1.389);
  // blush
  vec2 bq = (f - vec2(0.058, 1.35)) / vec2(0.017, 0.009);
  c = mix(c, uPal[P_BLUSH], 0.4 * (1.0 - smoothstep(0.6, 1.0, length(bq))) * front);
  // eye white: an almond, wider than tall, flatter along the upper lid
  vec2 q = f - E;
  vec2 qa = vec2(q.x, q.y * (q.y > 0.0 ? 1.15 : 1.0));
  float dS = (length(qa / vec2(0.0225, 0.0185)) - 1.0) * 0.0185;
  float sclera = fill(dS) * front;
  c = mix(c, uPal[P_EYE], sclera);
  unlit = max(unlit, sclera * 0.4);
  // iris filling the eye's height, pupil, one catch-light
  float dI = length(q - vec2(-0.003, -0.001)) - 0.0148;
  c = mix(c, uPal[P_IRIS], fill(max(dI, dS)) * front);
  c = mix(c, uPal[P_INK], fill(max(length(q - vec2(-0.003, -0.0015)) - 0.0068, dS)) * front);
  float hl = fill(length(q - vec2(0.0035, 0.0055)) - 0.0036) * front;
  c = mix(c, vec3(1.0), hl);
  unlit = max(unlit, hl);
  // upper lid line, heavier toward the outer corner where it flicks out
  vec2 lq = qa / vec2(0.0236, 0.0196);
  float upper = smoothstep(-0.35, 0.05, q.y / 0.0196);
  float lash = band(length(lq) - 1.0, 0.1 + 0.16 * smoothstep(-0.01, 0.022, q.x)) * upper;
  float flick = band(q.y - 0.004 - (q.x - 0.02) * 0.45, 0.0018) * step(0.019, q.x) * step(q.x, 0.0275);
  c = mix(c, uPal[P_INK], max(lash, flick) * front);
  // brows
  vec2 bc = (f - vec2(0.039, 1.408)) / vec2(0.026, 0.02);
  float brow = band(length(bc) - 1.0, 0.22 - 0.08 * smoothstep(-0.3, 0.9, bc.x)) * step(0.4, bc.y) * step(abs(bc.x), 0.95);
  c = mix(c, uPal[P_INK], brow * front);
  // smile
  vec2 m = r.xy - vec2(0.0, 1.352);
  float smile = band(length(m) - 0.02, 0.0016) * step(m.y, -0.011) * step(abs(m.x), 0.015);
  c = mix(c, uPal[P_MOUTH], smile * front);
  return c;
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 1) {
    c = drawFace(base, d.xyz, unlit); // head space (the head is placed scaled)
  } else if (m == 3) {
    // quilted puffer: stitched seams round the body and the sleeves, ribbed
    // cuffs, the zip up the front
    float torso = d.z;
    float seamT = lines(d.x, 0.026) * step(-0.5, d.x) * step(d.x, 4.5) * torso;
    float seamS = lines(d.y, 0.024) * step(-0.5, d.y) * step(d.y, 2.5) * (1.0 - torso) * step(d.w, uRig[0].z - 0.012);
    c = mix(c, uPal[P_SEAM], max(seamT, seamS) * 0.85);
    c = mix(c, uPal[P_CUFF], fill(uRig[0].z - d.w) * (1.0 - torso));
    float zip = band(r.x, 0.0024) * step(r.z, -0.05);
    c = mix(c, uPal[P_ZIP], zip);
  } else if (m == 5) {
    c = mix(c, uPal[P_SHORTS_LINE], band(r.y - uRig[0].w - 0.013, 0.0015));
  } else if (m == 6) {
    float side = r.x < 0.0 ? -1.0 : 1.0;
    float a = atan(r.z, r.x - side * uRig[0].y);
    c = mix(c, uPal[P_SOCK], fill(r.y - (uRig[0].x + 0.0025 * sin(a * 3.0 + side))));
  } else if (m == 7) {
    // hiking boots: lugged outsole, cream midsole, darker toe cap, heel and
    // padded collar, laces criss-crossing the tongue
    float side = r.x < 0.0 ? -1.0 : 1.0;
    float x = r.x - side * uRig[0].y;
    float y = r.y - 0.028 * pow(smoothstep(-0.08, -0.205, r.z), 2.0);
    c = mix(c, uPal[P_BOOT_DARK], fill(r.z + 0.128 + max(0.0, y - 0.056) * 0.9));
    c = mix(c, uPal[P_BOOT_DARK], fill(0.04 - r.z + max(0.0, y - 0.08) * 0.9));
    float collar = uRig[1].x + uRig[1].y * (r.z - 0.004);
    c = mix(c, uPal[P_BOOT_DARK], fill(collar - 0.01 - r.y));
    c = mix(c, uPal[P_MIDSOLE], fill(y - uRig[1].z));
    c = mix(c, uPal[P_SOLE], fill(y - uRig[1].z * 0.6));
    // laces up the instep, from the toe box to the collar
    float onTongue = step(r.z, -0.1 + (r.y - 0.085) * 0.55) * step(abs(x), 0.026) * step(0.085, r.y) * step(r.y, collar - 0.008);
    float lace = max(band(abs(fract((r.y + x * 0.9) / 0.024 + 0.5) - 0.5), 0.1), band(abs(fract((r.y - x * 0.9) / 0.024 + 0.5) - 0.5), 0.1));
    c = mix(c, uPal[P_LACE], lace * onTongue * step(abs(x), 0.021));
    float eyelet = fill(length(vec2(abs(x) - 0.023, fract((r.y - 0.085) / 0.024 + 0.5) * 0.024 - 0.012)) - 0.0028) * onTongue;
    c = mix(c, uPal[P_LACE], eyelet);
  } else if (m == 9) {
    // hood and collar: crimson wool; the hood's seam sinks into its middle,
    // and its lining shows where it opens under the collar (x across the
    // hood, y down from its top, z on the hood, w lining)
    c = mix(c, uPal[P_LINING], d.w);
    c = mix(c, c * 0.84, band(d.x, 0.03) * d.z * step(0.02, d.y));
    c = mix(c, c * 0.7, band(d.y - 0.0045, 0.0013) * d.z);
  } else if (m == 10) {
    // the cape (u, v across and down; w: the lining side)
    c = mix(c, uPal[P_LINING], step(0.5, d.w));
  } else if (m == 11) {
    c = mix(c, uPal[P_FLAP], step(0.5, d.x));
  }
  return c;
}
`;

const FS_CHAR = FS_HEAD + CHAR_DETAIL + /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uShadowTint;
uniform vec4 uRim;
uniform sampler2D uNoise;
void main() {
  int m = int(vMat + 0.5);
  float unlit = 0.0;
  vec3 base = charDetail(m, uPal[m], vRest, vD, unlit);
  vec3 n = normalize(vNormal);
  n = gl_FrontFacing ? n : -n;
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  vec3 V = v / dist;
  // one broad, crisp shadow shape (softer on the cape, so its folds shade in
  // soft gradients like the cloth they are)
  float soft = m == 10 ? 0.16 : m == 9 ? 0.09 : 0.045;
  float lit = smoothstep(-soft, soft, dot(n, uLightDir) + 0.15);
  vec3 sh = mix(vec3(0.84, 0.75, 0.8), uShadowTint, 0.35);
  vec3 col = base * mix(sh, vec3(1.0), max(lit, unlit));
  if (m == 10) {
    // the cape's folds and waves keep a soft shadow in their valleys, under
    // any light (as a painter would shade them)
    float fold = smoothstep(0.8, 4.0, vFx.x) - 0.25 * smoothstep(1.0, 5.0, -vFx.x);
    col *= mix(vec3(1.0), mix(sh, vec3(1.0), 0.3), clamp(fold, -0.3, 1.0) * 0.7);
  }
  if (m == 2) {
    // one restrained lighter tone where the curls face the light from above
    float hl = smoothstep(0.58, 0.64, dot(n, uLightDir)) * smoothstep(0.25, 0.5, n.y);
    col = mix(col, uPal[30], hl * 0.8);
  }
  float fres = 1.0 - abs(dot(n, V));
  float back = clamp(dot(uLightDir, V) * 0.6 + 0.4, 0.0, 1.0);
  float rim = smoothstep(1.0 - uRim.w, 1.0 - uRim.w * 0.55, fres) * back * (1.0 - smoothstep(0.5, 0.9, n.y));
  col += uRim.rgb * base * rim * 0.45 * (1.0 - unlit);
  col *= 1.0 + (texture2D(uNoise, gl_FragCoord.xy * (1.0 / 128.0)).r - 0.5) * 0.035;
  col = atmos(col, v, dist, 0.0);
  gl_FragColor = vec4(grade(col, uTrip), 1.0);
}
`;

const FS_CHAR_INK = FS_HEAD + CHAR_DETAIL + /* glsl */ `
void main() {
  vec3 ink = uPal[int(vMat + 0.5)] * 0.3;
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  gl_FragColor = vec4(grade(atmos(ink, v, dist, 0.0), uTrip), 1.0);
}
`;

const FS_GLASS = FS_HEAD + /* glsl */ `
uniform vec4 uGlass;
void main() {
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  vec3 n = normalize(vNormal);
  float fres = pow(1.0 - abs(dot(n, v / dist)), 2.0);
  float k = fract(dot(vPos, vec3(0.16, 0.3, 0.11)));
  float streak = smoothstep(0.84, 0.87, k) * (1.0 - smoothstep(0.9, 0.93, k));
  vec3 c = uGlass.rgb * vColor + streak * 0.45 + fres * 0.18;
  float a = uGlass.a + fres * 0.22 + streak * 0.35;
  float f = smoothstep(uFog.x, uFog.y, dist);
  c = grade(atmos(c, v, dist, 0.0), uTrip, dist);
  gl_FragColor = vec4(c, a * (1.0 - f * 0.7));
}
`;

const FS_PORTAL = /* glsl */ `
void main() { gl_FragColor = vec4(0.0); }
`;

// --- Camera-facing glow billboards (lamps, windows) ------------------------
const VS_GLOW = COMMON + /* glsl */ `
uniform vec4 uAnim;
uniform vec4 uFog;
attribute vec4 aInst;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec3 pivot = M[3].xyz;
  float sc = length(M[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float aP = uCamPos.z - pivot.z;
  float pop = 1.0 - smoothstep(uAnim.y, uAnim.z, aP);
  vec3 bp = bendPos(pivot);
  vec3 wp = bp + (right * position.x + up * position.y) * sc;
  float dist = length(bp - uCamPos);
  float flick = 0.88 + 0.12 * sin(uTime * 6.0 + aInst.x * 13.0) * sin(uTime * 2.3 + aInst.x);
  vFade = pop * flick * (1.0 - 0.75 * smoothstep(uFog.x, uFog.y, dist));
  vUv = uv;
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FS_GLOW = /* glsl */ `
uniform float uGlowGain;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.4);
  gl_FragColor = vec4(vColor * a * vFade * uGlowGain, 1.0);
}
`;

// --- Soft multiply shadows on the ground -----------------------------------
const VS_SHADOW = COMMON + /* glsl */ `
uniform vec4 uAnim;
uniform vec4 uFog;
varying vec2 vUv;
varying float vFade;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec3 wp = (M * vec4(position, 1.0)).xyz;
  vec3 pivot = M[3].xyz;
  float pop = 1.0 - smoothstep(uAnim.y, uAnim.z, uCamPos.z - pivot.z);
  wp = bendPos(wp);
  float dist = length(wp - uCamPos);
  vFade = pop * (1.0 - smoothstep(uFog.x * 0.8, uFog.y * 0.85, dist));
  #ifdef USE_INSTANCING_COLOR
    vFade *= instanceColor.r;
  #endif
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FS_SHADOW = /* glsl */ `
uniform vec3 uShadowColor;
varying vec2 vUv;
varying float vFade;
void main() {
  #ifdef HARD
    // crisp-edged cast shadow (harsh light)
    vec2 e = abs(vUv - 0.5) * 2.0;
    float aa = fwidth(e.x) + fwidth(e.y);
    float a = (1.0 - smoothstep(1.0 - aa * 2.0, 1.0, max(e.x, e.y))) * vFade;
  #else
    float r = length(vUv - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.3, 1.0, r)) * vFade;
  #endif
  gl_FragColor = vec4(mix(vec3(1.0), uShadowColor, a), 1.0);
}
`;

// --- Light shafts and lamp cones (additive, soft-edged volumes) -------------
const FS_BEAM = FS_HEAD + /* glsl */ `
uniform vec4 uBeam; // rgb, intensity
void main() {
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  vec3 n = normalize(vNormal);
  float facing = abs(dot(n, v / dist));
  float core = facing * facing;
  float along = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
  float shimmer = 0.8 + 0.2 * sin(uTime * 0.9 + vPos.x * 0.7 + vPos.z * 0.3);
  float fade = (1.0 - smoothstep(uFog.x, uFog.y, dist)) * smoothstep(1.5, 7.0, dist);
  gl_FragColor = vec4(uBeam.rgb * vColor * core * along * shimmer * fade * uBeam.a, 1.0);
}
`;

// Additive pool of light on the ground under a lamp.
const FS_POOL = /* glsl */ `
uniform vec3 uPool;
varying vec2 vUv;
varying float vFade;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 1.6);
  gl_FragColor = vec4(uPool * a * vFade, 1.0);
}
`;

// --- Sky dome ---------------------------------------------------------------
const VS_SKY = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FS_SKY = /* glsl */ `
uniform float uTime;
uniform vec4 uSkyFx; // x stars, y sun disc cos, z moon cos
uniform vec4 uSkyFx2; // x sun rays, y cloud bands, z aurora, w planet ring (moon drawn full)
uniform vec4 uTrip;
uniform vec3 uSunDisc;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform sampler2D uNoise;
varying vec3 vDir;
` + SKY_FN + /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
void main() {
  vec3 d = normalize(vDir);
  float sw = uDream2.y;
  if (sw > 0.0) {
    // a swirling sky: azimuth and elevation stirred like paint
    float az0 = atan(d.x, -d.z);
    float el = asin(clamp(d.y, -1.0, 1.0));
    az0 += sw * 0.6 * sin(el * 7.0 + uTime * 0.25);
    el += sw * 0.12 * sin(az0 * 4.0 - uTime * 0.3) * cos(el);
    d = vec3(sin(az0) * cos(el), sin(el), -cos(az0) * cos(el));
  }
  vec3 c = skyColor(d);
  float sd = dot(d, uSunDir);
  float sun = smoothstep(uSkyFx.y - 0.00012, uSkyFx.y + 0.00012, sd);
  c = mix(c, uSunDisc, sun);
  if (uSkyFx.z < 1.0) {
    float md = dot(d, uMoonDir);
    float disc = smoothstep(uSkyFx.z - 0.00012, uSkyFx.z + 0.00012, md);
    vec3 off = normalize(uMoonDir + vec3(0.026, 0.014, 0.0));
    float cut = smoothstep(uSkyFx.z - 0.00012, uSkyFx.z + 0.00012, dot(d, off));
    c += uMoonColor * pow(max(md, 0.0), 900.0) * 0.35;
    if (uSkyFx2.w > 0.0) {
      // a ringed planet instead of a crescent: shaded full disc + tilted ring
      vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mu = cross(mr, uMoonDir);
      vec2 pq = vec2(dot(d, mr), dot(d, mu));
      float R = sqrt(max(1.0 - uSkyFx.z * uSkyFx.z, 0.0));
      float tl = 0.35;
      vec2 rq = vec2(pq.x * cos(tl) + pq.y * sin(tl), -pq.x * sin(tl) + pq.y * cos(tl));
      float rr = length(vec2(rq.x, rq.y * 3.6)) / R;
      float ring = smoothstep(1.45, 1.5, rr) * (1.0 - smoothstep(2.15, 2.2, rr)) * (0.75 + 0.25 * sin(rr * 40.0));
      float behind = step(0.0, rq.y) * disc;
      float shade = 0.55 + 0.45 * smoothstep(-R, R, pq.x - pq.y);
      c = mix(c, uMoonColor * shade, disc);
      c = mix(c, mix(uMoonColor, vec3(1.0, 0.92, 0.75), 0.6), ring * (1.0 - behind) * uSkyFx2.w);
    } else {
      c = mix(c, uMoonColor, disc * (1.0 - cut));
    }
  }
  if (uSkyFx.x > 0.0) {
    vec3 p = d * 150.0;
    vec3 cell = floor(p);
    float h = hash13(cell);
    if (h > 0.984) {
      vec3 jitter = vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5;
      vec3 f = fract(p) - 0.5 - jitter * 0.5;
      float s = smoothstep(0.2, 0.0, length(f));
      float tw = 0.55 + 0.45 * sin(uTime * (1.3 + h * 20.0) + h * 90.0);
      c += vec3(1.0, 0.95, 0.85) * s * tw * uSkyFx.x * smoothstep(0.02, 0.3, d.y);
    }
  }
  float az = atan(d.x, -d.z);
  if (uSkyFx2.x > 0.0) {
    // crepuscular rays fanning out from the sun
    vec3 rt = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 upv = cross(rt, uSunDir);
    float ang = atan(dot(d, upv), dot(d, rt));
    float r1 = texture2D(uNoise, vec2(ang * 0.55 + uTime * 0.004, 0.31)).g;
    float r2 = texture2D(uNoise, vec2(ang * 1.3 - uTime * 0.003, 0.73)).g;
    float rays = smoothstep(0.42, 0.78, r1 * 0.65 + r2 * 0.45);
    float near = pow(max(sd, 0.0), 5.0);
    c += uSunColor * rays * near * uSkyFx2.x * smoothstep(-0.05, 0.08, d.y);
  }
  if (uSkyFx2.y > 0.0) {
    // long soft cloud bands above the horizon, drifting
    float n1 = texture2D(uNoise, vec2(az * 0.9 + uTime * 0.002, d.y * 2.2)).g;
    float n2 = texture2D(uNoise, vec2(az * 2.1 - uTime * 0.0015, d.y * 5.0 + 0.4)).g;
    float band = smoothstep(0.5, 0.78, n1 * 0.7 + n2 * 0.4) * smoothstep(0.0, 0.08, d.y) * (1.0 - smoothstep(0.18, 0.5, d.y));
    vec3 cc = mix(uSkyHorizon, vec3(1.0), 0.55) + uSunColor * pow(max(sd, 0.0), 3.0) * 0.6;
    c = mix(c, cc, band * uSkyFx2.y);
  }
  if (uSkyFx2.z > 0.0) {
    // aurora curtains
    float wv = sin(az * 3.0 + sin(az * 7.0 + uTime * 0.21) * 0.8 + uTime * 0.05);
    float curtain = smoothstep(0.55, 1.0, wv * 0.5 + 0.5) * smoothstep(0.12, 0.3, d.y) * (1.0 - smoothstep(0.45, 0.8, d.y));
    float streak = 0.6 + 0.4 * texture2D(uNoise, vec2(az * 6.0, uTime * 0.01)).g;
    vec3 ac = mix(vec3(0.25, 1.0, 0.65), vec3(0.85, 0.35, 0.95), smoothstep(0.2, 0.5, d.y));
    c += ac * curtain * streak * uSkyFx2.z;
  }
  if (sw > 0.0) c = hueRot(c, sw * 1.3 * sin(az * 3.0 + d.y * 9.0 + uTime * 0.35));
  c += (texture2D(uNoise, gl_FragCoord.xy * (1.0 / 128.0)).r - 0.5) * 0.02;
  gl_FragColor = vec4(grade(c, uTrip), 1.0);
}
`;

// --- Floating dust / fireflies / embers -------------------------------------
const VS_PARTICLES = COMMON + /* glsl */ `
uniform float uDistMod;
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uDrift;
attribute float aRand;
varying float vAlpha;
void main() {
  vec3 p = position;
  p += uDrift * uTime * (0.6 + aRand * 0.8);
  p.x += sin(uTime * 0.7 + aRand * 30.0) * 0.6;
  p.z += uDistMod;
  p.z = mod(p.z + 92.0, 98.0) - 92.0;
  p.y = mod(p.y, 13.0);
  p.x = mod(p.x + 15.0, 30.0) - 15.0;
  vec3 wp = vec3(uCamPos.x + p.x, p.y, uCamPos.z + p.z);
  wp = bendPos(wp);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_PointSize = uSize * (0.5 + aRand) * uPixelRatio * (40.0 / max(-mv.z, 1.0));
  vAlpha = smoothstep(-92.0, -60.0, p.z) * smoothstep(6.0, 1.0, p.z) * (0.55 + 0.45 * sin(uTime * (1.0 + aRand * 3.0) + aRand * 50.0));
  vAlpha *= smoothstep(1.5, 4.5, -mv.z); // no giant blobs drifting across the lens
  gl_Position = projectionMatrix * mv;
}
`;
const FS_PARTICLES = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c)) * vAlpha * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

// ---------------------------------------------------------------------------
// Gems: stones that turn slowly and bob where they hang, unfold out of
// nothing as they come in range like the rest of the world, and when you run
// through one, are sucked into you — drawn in faster and faster, stretching
// toward you and shrinking to nothing inside the runner's body, over a
// quarter of a second, so taking them never pulls your eye off the road.
// aInst.x is the phase (it ripples along a run of gems), aInst.z the moment
// it was collected, aInst.w how far ahead of the runner it was then.
// ---------------------------------------------------------------------------
const GEM_MOTION = /* glsl */ `
uniform vec4 uAnim;  // y, z: grown in fully / not yet begun, in meters from the camera
uniform vec4 uSpin;  // x turn (rad/s), y bob rate, z bob height, w nod (rad)
uniform vec3 uGemAt;
float easeOutBack(float t) {
  float u = t - 1.0;
  return 1.0 + 2.5 * u * u * u + 1.5 * u * u;
}
// x: 0..1 through the pick-up (-1 before), y: the gem's size, z: how far it's
// been drawn in (accelerating, like suction)
vec3 gemCollect(float at) {
  if (at <= 0.0) return vec3(-1.0, 1.0, 0.0);
  float ct = clamp((uTime - at) / 0.26, 0.0, 1.0);
  float pull = ct * ct;
  return vec3(ct, 1.0 - pull, pull);
}
// Where a gem hangs, bobbing — or, once taken, where it is on its way into the
// runner: held level with them as they run on (dz ahead of their chest), and
// drawn in to it.
vec3 gemCentre(vec3 pivot, float phase, vec3 pick, float dz) {
  vec3 c = pivot + vec3(0.0, sin(uTime * uSpin.y + phase * 1.3) * uSpin.z, 0.0);
  if (pick.x < 0.0) return c;
  c.z = uGemAt.z + dz;
  return mix(c, uGemAt, pick.z);
}
`;

const VS_GEM = COMMON + GEM_MOTION + /* glsl */ `
attribute vec3 fx;
attribute vec3 edge;
#ifdef OUTLINE
uniform float uOutline;
attribute vec3 onrm;
#endif
#ifdef USE_INSTANCING
attribute vec4 aInst;
#endif
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vFx;
varying vec3 vLocalN;
varying vec3 vLocal;
varying float vFlash;
varying float vKind;
varying vec3 vEdge;

vec3 turn(vec3 v, float a, float b) {
  float c = cos(a), s = sin(a);
  v = vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
  c = cos(b);
  s = sin(b);
  return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

void main() {
  mat4 M = modelMatrix;
  float phase = 0.0;
  float at = 0.0;
  float dz = 0.0;
  #ifdef USE_INSTANCING
    // every stone the world has is in this one geometry, its triangles marked
    // with their kind (uv.x): an instance draws only its own (aInst.y), the
    // rest collapse to nothing and are never rasterised
    if (abs(uv.x - aInst.y) > 0.5) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    M = modelMatrix * instanceMatrix;
    phase = aInst.x;
    at = aInst.z;
    dz = aInst.w;
  #endif
  vec3 pivot = M[3].xyz;
  float aP = uCamPos.z - pivot.z;
  vec3 pick = gemCollect(at);
  // turning on its own axis with a gentle nod, spun up as it's drawn in
  float spin = uTime * uSpin.x + phase + max(pick.x, 0.0) * 5.0;
  float nod = sin(uTime * uSpin.y * 0.5 + phase * 0.7) * uSpin.w;
  vec3 lp = turn(position, spin, nod);
  vec3 ln = turn(normal, spin, nod);
  float grow = max(easeOutBack(1.0 - smoothstep(uAnim.y, uAnim.z, aP)), 0.0) * pick.y;
  vec3 c = gemCentre(pivot, phase, pick, dz);
  mat3 S = mat3(M);
  vec3 off = S * lp * grow;
  if (pick.x >= 0.0) {
    // stretched out toward the runner as it's sucked in
    vec3 to = uGemAt - c;
    float len = length(to);
    vec3 dir = to / max(len, 1e-4);
    off += dir * dot(off, dir) * 3.2 * pick.z * (1.0 - pick.z) * smoothstep(0.05, 0.3, len);
  }
  vec3 wp = c + off;
  vPos = wp;
  #ifdef OUTLINE
    float w = length(onrm);
    if (w > 0.0001) {
      float dist = length(wp - uCamPos);
      wp += normalize(S * turn(onrm, spin, nod)) * (w * uOutline * min(grow, 1.0) * (1.0 + dist * 0.011));
    }
  #endif
  wp = bendPos(wp);
  vWorld = wp;
  vNormal = normalize(S * ln);
  vLocalN = normal;
  vLocal = position;
  vKind = uv.x;
  vEdge = edge;
  vFlash = pick.x < 0.0 ? 0.0 : sin(pick.x * 3.14159);
  vUv = uv;
  vFx = fx;
  vec3 col = color;
  #ifdef USE_INSTANCING_COLOR
    col = mix(col, col * instanceColor, fx.z);
  #endif
  vColor = col;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

// Stone shading, painted rather than ray-traced: every facet takes its own
// tone between the stone's dark depths and the pale light caught on top, so
// its shape reads in any light; the colour burns brightest through the face
// turned to you, edges go pale, and facets that mirror a light into your eye
// flash white (one light is the world's, one sits over the camera's shoulder,
// so a gem sparkles even in the dark). It lights itself for the most part, so
// it holds its colour against anything.
//
// Each kind of stone has its own surface (uKind*, indexed by the kind): its
// colour can wander through it in patches, toward a second colour (mottle);
// it can carry grains and inclusions (speckle), wavy layers along it or rings
// round its heart (bands: agate, malachite, colour zoning, striations), and a
// network of cracks, pale or in a dark matrix (veins: turquoise's web,
// rhodonite's black seams); a rough stone takes the light unevenly and its
// glints break up into glitter; an opaque one is lit like a pebble, not a
// glass. All of it is fixed in the stone (its own coordinates), so it turns
// with it. fx = (shine, crystal, tint): non-crystal parts (a gold bezel, the
// rock a cluster grows from) are lit like any prop, shine marking polished
// metal.
const FS_GEM = FS_HEAD + /* glsl */ `
#define GEM_KINDS 8
uniform vec3 uLightDir;
uniform vec3 uShadowTint;
uniform vec4 uGemK; // x self-lit (ignores the world's shade), y glints, z hue spread across facets, w fire
uniform vec4 uKindA[GEM_KINDS]; // x veins, y mottle, z speckle, w bands
uniform vec4 uKindB[GEM_KINDS]; // x opaque, y rough, z texture scale (per meter), w band frequency
uniform vec4 uKindC[GEM_KINDS]; // rgb second colour, w how the bands lie: 0 layers along it, 1 round its heart, 2 nested like its faces (octahedral zoning)
uniform vec4 uKindD[GEM_KINDS]; // rgb vein colour, w how much veins take it (0: pale cracks)
uniform vec4 uKindE[GEM_KINDS]; // x glints, y how much the bands wander, z metallic
varying vec3 vLocalN;
varying vec3 vLocal;
varying float vFlash;
varying float vKind;
varying vec3 vEdge;
float facetHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 cellHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.103, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// distance to the nearest crack (0 on one): the walls between cells, only
// some of them cracked through, so the network breaks up like a real one
float cracks(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  float d1 = 8.0;
  float d2 = 8.0;
  vec3 c1 = vec3(0.0);
  vec3 c2 = vec3(0.0);
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = i + g;
        float d = length(g + cellHash(o) * 0.85 - f);
        if (d < d1) {
          d2 = d1;
          c2 = c1;
          d1 = d;
          c1 = o;
        } else if (d < d2) {
          d2 = d;
          c2 = o;
        }
      }
    }
  }
  float wall = fract(cellHash(c1).y + cellHash(c2).y); // the same either side of a wall
  return d2 - d1 + (1.0 - smoothstep(0.35, 0.75, wall)) * 0.5;
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(1.0, 0.0);
  return mix(
    mix(mix(facetHash(i), facetHash(i + e.xyy), f.x), mix(facetHash(i + e.yxy), facetHash(i + e.xxy), f.x), f.y),
    mix(mix(facetHash(i + e.yyx), facetHash(i + e.xyx), f.x), mix(facetHash(i + e.yxx), facetHash(i + e.xxx), f.x), f.y),
    f.z
  );
}
float fbm(vec3 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.07 + 13.1) * 0.3 + vnoise(p * 4.31 + 7.7) * 0.15;
}
void main() {
  vec3 n = normalize(vNormal);
  n = gl_FrontFacing ? n : -n;
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  vec3 V = v / dist;
  vec3 R = reflect(V, n);
  vec3 L = uLightDir;
  vec3 L2 = normalize(vec3(-0.35, 0.8, 0.45));
  float lit = smoothstep(-0.2, 0.3, dot(n, L));
  vec3 base = vColor;
  vec3 col;
  if (vFx.y > 0.5) {
    int k = int(vKind + 0.5);
    vec4 A = uKindA[k];
    vec4 B = uKindB[k];
    vec4 C = uKindC[k];
    vec4 D = uKindD[k];
    vec3 q = vLocal * B.z;
    float m = fbm(q);
    float seed = facetHash(floor(vLocalN * 7.0 + 0.5) + 11.0);
    float env = smoothstep(-0.45, 0.8, R.y) * 0.65 + max(dot(R, L), 0.0) * 0.35;
    // a rough stone's faces don't take the light evenly; an opaque one has no glassy depths
    float t = clamp(0.18 + env * 0.72 + (seed - 0.5) * 0.6 + (m - 0.5) * B.y, 0.0, 1.0);
    t = mix(t, 0.3 + t * 0.55, B.x * 0.6);
    vec3 deep = base * base * 0.6;
    vec3 lite = mix(base, vec3(1.0), 0.5);
    col = t < 0.5 ? mix(deep, base, t * 2.0) : mix(base, lite, t * 2.0 - 1.0);
    // a metallic stone (pyrite) mirrors its surroundings in its own brass
    col = mix(col, base * (0.3 + 1.1 * env) + pow(max(dot(R, L), 0.0), 12.0) * 0.6, uKindE[k].z);
    // and every stone has a fine grain to it, like pigment settling in a wash
    col *= 1.0 + (vnoise(q * 9.0) - 0.5) * 0.14;
    vec3 two = C.rgb * (0.55 + 0.7 * t); // the second colour, in the stone's own light and shade
    if (A.y > 0.0) {
      col *= 1.0 + (m - 0.5) * 0.8 * A.y;
      col = mix(col, two, smoothstep(0.5, 0.8, fbm(q * 0.6 + 4.3)) * A.y);
    }
    if (A.w > 0.0) {
      vec3 aq = abs(q);
      float along = C.w > 1.5 ? aq.x + aq.y + aq.z : C.w > 0.5 ? length(q) : q.y;
      float b = along * B.w + (fbm(q * 0.7 + 1.7) - 0.5) * uKindE[k].y;
      col = mix(col, two, smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(b)) * A.w);
    }
    col = hueRot(col, (seed - 0.5) * uGemK.z);
    float face = abs(dot(n, V));
    col += base * pow(face, 4.0) * uGemK.w * (1.0 - B.x);
    vec3 shade = mix(mix(uShadowTint, vec3(1.0), 0.45), vec3(1.0), lit);
    col *= mix(shade, vec3(1.0), uGemK.x * (1.0 - B.x * 0.4));
    col = mix(col, lite * 1.15, pow(1.0 - face, 2.2) * 0.55 * (1.0 - B.x * 0.7));
    if (A.z > 0.0) {
      vec3 sq = q * 3.0;
      vec3 cell = floor(sq);
      float dd = length(sq - cell - (cellHash(cell + 5.0) * 0.6 + 0.2));
      float on = step(1.0 - A.z, facetHash(cell + 3.7));
      col = mix(col, two * 1.1, (1.0 - smoothstep(0.1, 0.18 + fwidth(dd), dd)) * on * 0.9);
    }
    if (A.x > 0.0) {
      // dark matrix seams run heavier than pale cracks
      float c = cracks(q);
      float vein = 1.0 - smoothstep(0.016 + D.w * 0.03, 0.036 + D.w * 0.04 + fwidth(c) * 1.5, c);
      col = mix(col, mix(lite * 1.08, D.rgb, D.w), vein * A.x);
    }
    // the facets' edges catch the light in fine pale lines, as in a painting
    // of a stone (fading out with distance, before they'd shimmer)
    float ed = min(vEdge.x, min(vEdge.y, vEdge.z));
    float line = (1.0 - smoothstep(0.0, fwidth(ed) * 1.4, ed)) * (1.0 - smoothstep(9.0, 26.0, dist));
    col = mix(col, lite * 1.2, line * 0.5 * (1.0 - B.x * 0.5));
    float g = pow(max(dot(R, L), 0.0), 40.0) + pow(max(dot(R, L2), 0.0), 40.0) * 0.8;
    g *= mix(1.0, smoothstep(0.5, 0.75, vnoise(q * 5.0)) * 1.6, B.y);
    float tw = smoothstep(0.93, 1.0, sin(uTime * 2.7 + seed * 37.0)) * step(0.55, seed);
    col += vec3(g * 1.4 + tw * 0.75) * uGemK.y * uKindE[k].x;
  } else {
    col = base * mix(uShadowTint, vec3(1.0), lit);
    if (vFx.x > 0.5) {
      col *= 0.75 + 0.5 * smoothstep(-0.3, 0.6, R.y);
      col += mix(base, vec3(1.0), 0.6) * (pow(max(dot(R, L), 0.0), 18.0) + pow(max(dot(R, L2), 0.0), 22.0) * 0.7);
    }
  }
  col *= 1.0 + vFlash * 0.3;
  // like the runner, a gem keeps its own colour however far the dream turns
  // the palette (undone here, before the fog, so the fog still matches the sky)
  col = hueRot(col, -uDream3.x);
  col = atmos(col, v, dist, 0.8);
  gl_FragColor = vec4(grade(col, uTrip, dist), 1.0);
}
`;

// The soft glow round a gem (a camera-facing halo that bobs with it) and, with
// POOL, the light it spills on the ground beneath (instance colour carries how
// bright: gems hung high for a jump light the road less).
const VS_GEM_GLOW = COMMON + GEM_MOTION + /* glsl */ `
uniform vec4 uFog;
attribute vec4 aInst;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec3 pivot = M[3].xyz;
  float sc = length(M[0].xyz);
  float phase = aInst.x;
  float aP = uCamPos.z - pivot.z;
  vec3 pick = gemCollect(aInst.z);
  float fade = (1.0 - smoothstep(uAnim.y, uAnim.z, aP)) * (0.82 + 0.18 * sin(uTime * 2.4 + phase * 1.7));
  if (pick.x >= 0.0) fade *= (1.0 - pick.x) * (1.0 - pick.x);
  #ifdef POOL
    vec3 wp = bendPos(pivot + vec3(position.x, 0.0, -position.y) * sc);
    float dist = length(wp - uCamPos);
  #else
    // the halo is drawn in with its gem, shrinking
    vec3 c = gemCentre(pivot, phase, pick, aInst.w);
    if (pick.x >= 0.0) sc *= 1.0 - pick.z;
    vec3 bp = bendPos(c);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 wp = bp + (right * position.x + up * position.y) * sc;
    float dist = length(bp - uCamPos);
  #endif
  vFade = fade * (1.0 - 0.7 * smoothstep(uFog.x, uFog.y, dist)) * smoothstep(1.5, 4.0, dist);
  vUv = uv;
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FS_GEM_GLOW = /* glsl */ `
uniform float uGemGlow;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  float r = max(1.0 - length(vUv - 0.5) * 2.0, 0.0);
  float a = pow(r, 2.6) * 0.8 + pow(r, 9.0) * 0.5;
  gl_FragColor = vec4(vColor * a * vFade * uGemGlow, 1.0);
}
`;

// A few faint glints in the gem's colour, sucked into the runner with it: a
// handful of slots, each a little shell of four-pointed motes round where the
// gem was, spiralling in to the runner's chest and fading as they arrive.
const VS_SPARKLE = COMMON + /* glsl */ `
uniform vec4 uBurst[SLOTS]; // x, y: where the gem was, from the runner's chest; z: size; w: start time (0 = idle)
uniform vec3 uBurstCol[SLOTS];
uniform vec3 uGemAt;
uniform float uPixelRatio;
attribute vec4 aSpark; // xyz direction, w random
attribute float aSlot;
varying vec3 vColor;
varying float vAlpha;
void main() {
  int s = int(aSlot + 0.5);
  vec4 b = uBurst[s];
  float t = uTime - b.w;
  vColor = uBurstCol[s];
  if (b.w <= 0.0 || t < 0.0 || t > 0.34) {
    vAlpha = 0.0;
    gl_PointSize = 0.0;
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float k = t / 0.34;
  float pull = k * k;
  float a = k * 2.4;
  vec3 d = aSpark.xyz * (0.18 + aSpark.w * 0.28) * b.z;
  d.xz = vec2(d.x * cos(a) - d.z * sin(a), d.x * sin(a) + d.z * cos(a));
  vec3 p = uGemAt + (vec3(b.x, b.y, 0.0) + d) * (1.0 - pull);
  vec4 mv = viewMatrix * vec4(bendPos(p), 1.0);
  gl_PointSize = (2.0 + aSpark.w * 2.5) * b.z * uPixelRatio * (40.0 / max(-mv.z, 1.0)) * (1.0 - pull * 0.6);
  vAlpha = smoothstep(0.0, 0.05, t) * (1.0 - pull) * 0.5;
  gl_Position = projectionMatrix * mv;
}
`;
const FS_SPARKLE = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float core = pow(max(1.0 - length(c) * 2.0, 0.0), 3.0);
  float rays = max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2) + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
  float a = (core + rays * 0.7) * vAlpha;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.3) * a, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Uniform sets per world environment
// ---------------------------------------------------------------------------
const color = (v) => (Array.isArray(v) ? new THREE.Color(v[0], v[1], v[2]) : new THREE.Color(v));
const dir = (v) => new THREE.Vector3(v[0], v[1], v[2]).normalize();
const setColor = (c, v) => (Array.isArray(v) ? c.setRGB(v[0], v[1], v[2]) : c.set(v));

// Uniform layout shared by every world environment (and the player, who
// carries a blend of two). Optional env fields fall back to neutral values.
export function makeEnvUniforms(env) {
  const v3 = () => ({ value: new THREE.Vector3() });
  const v4 = () => ({ value: new THREE.Vector4() });
  const c = () => ({ value: new THREE.Color() });
  const u = {
    uSkyTop: c(), uSkyHorizon: c(), uSkyBottom: c(),
    uSunDir: v3(), uSunColor: c(), uSunDisc: c(),
    uMoonDir: v3(), uMoonColor: c(),
    uSkyFx: v4(), uSkyFx2: v4(),
    uLightDir: v3(), uShadowTint: c(), uHiTint: c(), uLightK: v4(), uRim: v4(), uDapple: v4(), uWall: v4(),
    uInk: c(), uFog: v4(), uMist: v4(), uMistH: v4(), uGrade: v4(), uVignette: c(), uTrip: v4(),
    uGroundA: c(), uGroundB: c(), uGroundC: c(),
    uShadowColor: c(), uGlass: v4(), uGlowGain: { value: 1 },
    uBeam: v4(), uPool: c(),
  };
  writeEnvUniforms(u, env);
  return u;
}

export function writeEnvUniforms(u, env) {
  const L = env.light;
  setColor(u.uSkyTop.value, env.sky[0]);
  setColor(u.uSkyHorizon.value, env.sky[1]);
  setColor(u.uSkyBottom.value, env.sky[2]);
  u.uSunDir.value.copy(dir(env.sun.dir));
  setColor(u.uSunColor.value, env.sun.glow);
  setColor(u.uSunDisc.value, env.sun.disc || '#ffffff');
  u.uMoonDir.value.copy(dir(env.moon ? env.moon.dir : [0, 1, 0]));
  setColor(u.uMoonColor.value, env.moon ? env.moon.color : '#ffffff');
  u.uSkyFx.value.set(env.stars || 0, env.sun.size ? Math.cos(env.sun.size) : 2, env.moon ? Math.cos(env.moon.size) : 2, 0);
  const sk = env.skyFx || {};
  u.uSkyFx2.value.set(sk.rays || 0, sk.clouds || 0, sk.aurora || 0, sk.ring || 0);
  u.uLightDir.value.copy(dir(L.dir));
  setColor(u.uShadowTint.value, L.shadow);
  setColor(u.uHiTint.value, L.hi);
  u.uLightK.value.set(L.soft ?? 0.05, L.wrap ?? 0, L.hiAmt ?? 1, L.lift ?? 1);
  const rim = env.rim || [0, 0, 0, 0.3];
  u.uRim.value.set(rim[0], rim[1], rim[2], rim[3]);
  const dp = env.dapple || [0, 0.05, 0];
  u.uDapple.value.set(dp[0], dp[1], dp[2], 0);
  const ws = env.wallShadow || [0, 0, 0, 0];
  u.uWall.value.set(ws[0], ws[1], ws[2], ws[3]);
  setColor(u.uInk.value, env.ink);
  u.uFog.value.set(env.fog[0], env.fog[1], 0.65, 0);
  const mist = env.mist || { color: '#ffffff', amount: 0 };
  const mc = color(mist.color);
  u.uMist.value.set(mc.r, mc.g, mc.b, mist.amount);
  u.uMistH.value.set(mist.top ?? 2, mist.fade ?? 4, mist.near ?? 12, mist.far ?? 90);
  const gr = env.grade || {};
  u.uGrade.value.set(gr.sat ?? 1, gr.contrast ?? 1, gr.vignette ?? 0, gr.exposure ?? 1);
  setColor(u.uVignette.value, gr.tint || '#000000');
  const tr = env.trip || [0, 0, 0];
  u.uTrip.value.set(tr[0], tr[1], tr[2], 0);
  setColor(u.uGroundA.value, env.ground[0]);
  setColor(u.uGroundB.value, env.ground[1]);
  setColor(u.uGroundC.value, env.ground[2]);
  setColor(u.uShadowColor.value, env.shadowDecal);
  const gc = color(env.glass ? env.glass[0] : '#ffffff');
  u.uGlass.value.set(gc.r, gc.g, gc.b, env.glass ? env.glass[1] : 0.2);
  u.uGlowGain.value = env.glowGain ?? 1;
  const bm = env.beam || { color: '#ffffff', amount: 0 };
  const bc = color(bm.color);
  u.uBeam.value.set(bc.r, bc.g, bc.b, bm.amount);
  setColor(u.uPool.value, env.pool || '#000000');
}

// Blend environment uniforms (used for the player, who carries light between worlds).
export function lerpEnvUniforms(out, a, b, t) {
  for (const key of Object.keys(out)) {
    const o = out[key].value;
    const va = a[key].value;
    const vb = b[key].value;
    if (typeof o === 'number') out[key].value = va + (vb - va) * t;
    else if (o.isColor) o.copy(va).lerp(vb, t);
    else if (o.isVector3 || o.isVector4) {
      o.copy(va).lerp(vb, t);
      if (o.isVector3 && (key === 'uSunDir' || key === 'uLightDir' || key === 'uMoonDir')) o.normalize();
    }
  }
}

export function copyEnvUniforms(out, src) {
  lerpEnvUniforms(out, src, src, 0);
}

// ---------------------------------------------------------------------------
// Material factories
// ---------------------------------------------------------------------------
const ANIM_PRESETS = {
  none: [0, 0, 1, 0],
  pop: [1, 72, 128, 0],
  popEarly: [1, 96, 138, 0],
  popLate: [1, 52, 100, 0],
  rise: [2, 62, 120, 0],
  lift: [4, 70, 135, 24],
  liftFar: [4, 110, 190, 40],
};

function animVector(anim) {
  if (!anim) return new THREE.Vector4(...ANIM_PRESETS.none);
  if (typeof anim === 'string') return new THREE.Vector4(...ANIM_PRESETS[anim]);
  return new THREE.Vector4(...anim);
}

function withShared(env, extra) {
  return Object.assign({}, shared, env, extra);
}

export function makeToonMaterial(env, o = {}) {
  const anim = animVector(o.anim);
  // Only props that pop up or lift in may breathe with the dream: continuous
  // structures, ground strips and doorway pieces would come apart at the seams.
  const breathes = anim.x === 1 || anim.x === 4;
  const uniforms = withShared(env, {
    uAnim: { value: anim },
    uDreamK: { value: o.dream ?? (breathes ? 1 : 0) },
    uWobble: { value: new THREE.Vector4(...(o.wobble || [0, 0, 1, 0])) },
    uFly: { value: new THREE.Vector4(...(o.fly || [0, 0, 0, 0])) },
    uMarkRepeat: { value: new THREE.Vector2(...(o.marks || [3, 3])) },
  });
  const defines = {};
  if (o.ground) defines.GROUND = o.ground;
  if (o.water) defines.WATER = '';
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: o.skinned ? VS_SKIN : VS_OBJECT,
    fragmentShader: FS_TOON,
    vertexColors: true,
    side: o.side ?? THREE.FrontSide,
  });
}

export function makeInkMaterial(toon, width) {
  const uniforms = Object.assign({}, toon.uniforms, { uOutline: { value: width } });
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { OUTLINE: '' },
    vertexShader: toon.vertexShader,
    fragmentShader: FS_INK,
    vertexColors: true,
    side: THREE.BackSide,
  });
}

// The runner's surface and ink materials (VS_CHAR / FS_CHAR). pal is an array
// of 32 THREE.Color palette slots indexed by material id; rig a Vector4 of
// garment constants (sock line, boot offset, sleeve cuff start). cape: the
// particle texture and grid (Vector4: cols, rows, half thickness) the cape's
// pair of materials rebuild its surface from.
export function makeCharacterMaterials(env, pal, rig, outline, cape) {
  // The runner keeps their own colours however deep the dream goes (uDream3
  // carries the palette shift; its doorway-swell terms never reach this close).
  const uniforms = withShared(env, { uPal: { value: pal }, uRig: { value: rig }, uDream3: { value: new THREE.Vector4() } }); // rig: [Vector4, Vector4]
  const make = (defines, extra) => {
    const u = Object.assign({}, uniforms, extra);
    return [
      new THREE.ShaderMaterial({ uniforms: u, defines, vertexShader: VS_CHAR, fragmentShader: FS_CHAR }),
      new THREE.ShaderMaterial({
        uniforms: Object.assign({}, u, { uOutline: { value: outline } }),
        defines: Object.assign({ OUTLINE: '' }, defines),
        vertexShader: VS_CHAR,
        fragmentShader: FS_CHAR_INK,
        side: THREE.BackSide,
      }),
    ];
  };
  const [mat, ink] = make({}, {});
  const [capeMat, capeInk] = make({ CAPE: '' }, { uCape: { value: cape.texture }, uCapeGrid: { value: cape.grid } });
  return { mat, ink, capeMat, capeInk };
}

export function makeGlassMaterial(env, o = {}) {
  const uniforms = withShared(env, {
    uAnim: { value: animVector(o.anim) },
    uWobble: { value: new THREE.Vector4(0, 0, 1, 0) },
    uFly: { value: new THREE.Vector4() },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_OBJECT,
    fragmentShader: FS_GLASS,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function makeGlowMaterial(env, o = {}) {
  const uniforms = withShared(env, { uAnim: { value: animVector(o.anim) } });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_GLOW,
    fragmentShader: FS_GLOW,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function makeBeamMaterial(env, o = {}) {
  const uniforms = withShared(env, {
    uAnim: { value: animVector(o.anim) },
    uWobble: { value: new THREE.Vector4(0, 0, 1, 0) },
    uFly: { value: new THREE.Vector4() },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_OBJECT,
    fragmentShader: FS_BEAM,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

export function makePoolMaterial(env, o = {}) {
  const uniforms = withShared(env, { uAnim: { value: animVector(o.anim) } });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_SHADOW,
    fragmentShader: FS_POOL,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function makeShadowMaterial(env, o = {}) {
  const uniforms = withShared(env, { uAnim: { value: animVector(o.anim) } });
  return new THREE.ShaderMaterial({
    uniforms,
    defines: o.hard ? { HARD: '' } : {},
    vertexShader: VS_SHADOW,
    fragmentShader: FS_SHADOW,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
  });
}

export function makeSkyMaterial(env) {
  const uniforms = withShared(env, {});
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_SKY,
    fragmentShader: FS_SKY,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

export function makePortalMaterial(mode) {
  const uniforms = withShared({}, {
    uAnim: { value: animVector('none') },
    uWobble: { value: new THREE.Vector4(0, 0, 1, 0) },
    uFly: { value: new THREE.Vector4() },
    uTrip: { value: new THREE.Vector4() },
  });
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_OBJECT,
    fragmentShader: FS_PORTAL,
    vertexColors: true,
    side: THREE.DoubleSide,
    colorWrite: false,
  });
  if (mode === 'stencil') {
    m.depthWrite = false;
    m.depthTest = false;
    m.stencilWrite = true;
    m.stencilRef = 1;
    m.stencilFunc = THREE.AlwaysStencilFunc;
    m.stencilZPass = THREE.ReplaceStencilOp;
  } else {
    m.depthWrite = true;
    m.depthTest = true;
  }
  return m;
}

// A world's gems: o.spin = [turn, bob rate, bob height, nod] (see VS_GEM),
// o.look = [self-lit, glints, facet hue spread, fire] (see FS_GEM), o.kinds
// each stone kind's surface: { veins, veinColor, mottle, speckle, bands,
// bandFreq, wander, rings ('round' its heart or 'nested' like its faces),
// second, opaque, rough, metal, scale, glints }.
const GEM_KINDS = 8;
export function makeGemMaterial(env, o = {}) {
  const v4 = (f) => ({ value: Array.from({ length: GEM_KINDS }, (_, i) => new THREE.Vector4(...f((o.kinds || [])[i] || {}))) });
  const rgbOf = (c) => {
    const col = new THREE.Color(c);
    return [col.r, col.g, col.b];
  };
  const uniforms = withShared(env, {
    uAnim: { value: animVector(o.anim ?? 'popEarly') },
    uSpin: { value: new THREE.Vector4(...(o.spin || [1.2, 2, 0.07, 0.12])) },
    uGemK: { value: new THREE.Vector4(...(o.look || [0.78, 1, 0.3, 0.35])) },
    uKindA: v4((k) => [k.veins ?? 0, k.mottle ?? 0, k.speckle ?? 0, k.bands ?? 0]),
    uKindB: v4((k) => [k.opaque ?? 0, k.rough ?? 0, k.scale ?? 6, k.bandFreq ?? 10]),
    uKindC: v4((k) => [...rgbOf(k.second ?? '#ffffff'), k.rings === 'nested' ? 2 : k.rings ? 1 : 0]),
    uKindD: v4((k) => [...rgbOf(k.veinColor ?? '#ffffff'), k.veinColor ? 1 : 0]),
    uKindE: v4((k) => [k.glints ?? 1, k.wander ?? 6, k.metal ?? 0, 0]),
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_GEM,
    fragmentShader: FS_GEM,
    vertexColors: true,
  });
}

// The halo round each gem, or (o.pool) the light it spills on the ground.
export function makeGemGlowMaterial(env, o = {}) {
  const uniforms = withShared(env, {
    uAnim: { value: animVector(o.anim ?? 'popEarly') },
    uSpin: { value: new THREE.Vector4(...(o.spin || [1.2, 2, 0.07, 0.12])) },
    uGemGlow: { value: o.gain ?? 0.6 },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    defines: o.pool ? { POOL: '' } : {},
    vertexShader: VS_GEM_GLOW,
    fragmentShader: FS_GEM_GLOW,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function makeSparkleMaterial(slots) {
  const uniforms = withShared({}, {
    uBurst: { value: Array.from({ length: slots }, () => new THREE.Vector4()) },
    uBurstCol: { value: Array.from({ length: slots }, () => new THREE.Color()) },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { SLOTS: slots },
    vertexShader: VS_SPARKLE,
    fragmentShader: FS_SPARKLE,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function makeParticleMaterial() {
  const uniforms = withShared({}, {
    uDistMod: { value: 0 },
    uSize: { value: 1 },
    uDrift: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uOpacity: { value: 0.8 },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_PARTICLES,
    fragmentShader: FS_PARTICLES,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
