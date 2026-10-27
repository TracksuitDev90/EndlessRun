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
};

const COMMON = /* glsl */ `
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uBend;
uniform vec4 uTrip; // x hue shift, y far-world undulation, z hue drift
vec3 bendPos(vec3 wp) {
  float a = uCamPos.z - wp.z;
  float d = clamp(a - uBend.w, 0.0, 320.0);
  float d2 = d * d;
  wp.y -= uBend.x * d2;
  wp.x += uBend.y * d2;
  if (uTrip.y != 0.0) {
    // the distant world breathes in slow waves rolling toward you
    float k = d * 0.0125;
    k *= k;
    wp.y += sin(a * 0.045 - uTime * 0.7) * uTrip.y * k * 5.0;
    wp.x += sin(a * 0.028 + uTime * 0.45) * uTrip.y * k * 8.0;
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
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// Per-world color grade + tinted vignette, applied to everything opaque.
vec3 grade(vec3 c, vec4 trip) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uGrade.x);
  c = (c - 0.5) * uGrade.y + 0.5;
  c *= uGrade.w;
  float h = trip.x + trip.z * sin(uTime * 0.13);
  if (h != 0.0) c = hueRot(c, h);
  vec2 q = gl_FragCoord.xy / uResolution - 0.5;
  float vg = smoothstep(0.42, 0.95, length(q) * 1.414) * uGrade.z;
  return mix(c, c * uVignette, vg);
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
  gl_FragColor = vec4(grade(col, uTrip), 1.0);
}
`;

const FS_INK = FS_HEAD + /* glsl */ `
uniform vec3 uInk;
void main() {
  vec3 ink = mix(uInk, vColor * 0.3, 0.42);
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  gl_FragColor = vec4(grade(atmos(ink, v, dist, 0.0), uTrip), 1.0);
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
    float w = length(onrm);
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
  vFx = vec3(0.0);
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
#define P_TRIM 20
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
    // mantle: crimson wool, burgundy lining, gold at the hem and round the hood
    c = mix(c, uPal[P_LINING], step(0.5, d.w));
    c = mix(c, uPal[P_TRIM], max(fill(d.x - 0.016), band(d.y, 0.0035) * step(d.w, 0.5)));
  } else if (m == 10) {
    // the cape (u, v across and down): lining inside, a gold hem band, and
    // the crest — a sun over two peaks in a ring — on the back
    c = mix(c, uPal[P_LINING], step(0.5, d.w));
    c = mix(c, uPal[P_TRIM], band(d.y - 0.955, 0.018));
    if (d.w < 0.5) {
      vec2 p = (d.xy - vec2(0.5, 0.38)) * vec2(0.74, -0.62);
      float rr = length(p);
      float ring = band(rr - 0.074, 0.0055);
      vec2 pk = vec2(abs(p.x + 0.006), p.y + 0.028);
      float peaks = fill(max(pk.y - 0.062 + pk.x * 1.4, -pk.y)) * step(rr, 0.065);
      float sun = fill(length(p - vec2(0.03, 0.034)) - 0.012);
      c = mix(c, uPal[P_TRIM], max(ring, max(peaks, sun)));
    }
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
  // one broad, crisp shadow shape (a touch softer on the hanging cloth, whose
  // panels bend against each other)
  float soft = (m == 9 || m == 10) ? 0.09 : 0.045;
  float lit = smoothstep(-soft, soft, dot(n, uLightDir) + 0.15);
  vec3 sh = mix(vec3(0.84, 0.75, 0.8), uShadowTint, 0.35);
  vec3 col = base * mix(sh, vec3(1.0), max(lit, unlit));
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
  c = grade(atmos(c, v, dist, 0.0), uTrip);
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
  const uniforms = withShared(env, {
    uAnim: { value: animVector(o.anim) },
    uWobble: { value: new THREE.Vector4(...(o.wobble || [0, 0, 1, 0])) },
    uFly: { value: new THREE.Vector4(...(o.fly || [0, 0, 0, 0])) },
    uMarkRepeat: { value: new THREE.Vector2(...(o.marks || [3, 3])) },
  });
  const defines = {};
  if (o.ground) defines.GROUND = o.ground;
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
// garment constants (sock line, boot offset, sleeve cuff start).
export function makeCharacterMaterials(env, pal, rig, outline) {
  const uniforms = withShared(env, { uPal: { value: pal }, uRig: { value: rig } }); // rig: [Vector4, Vector4]
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VS_CHAR, fragmentShader: FS_CHAR });
  const ink = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, uniforms, { uOutline: { value: outline } }),
    defines: { OUTLINE: '' },
    vertexShader: VS_CHAR,
    fragmentShader: FS_CHAR_INK,
    side: THREE.BackSide,
  });
  return { mat, ink };
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
