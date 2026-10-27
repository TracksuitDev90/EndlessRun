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
};

const COMMON = /* glsl */ `
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uBend;
vec3 bendPos(vec3 wp) {
  float a = uCamPos.z - wp.z;
  float d = clamp(a - uBend.w, 0.0, 320.0);
  float d2 = d * d;
  wp.y -= uBend.x * d2;
  wp.x += uBend.y * d2;
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

const FS_HEAD = /* glsl */ `
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uFog;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vFx;
` + SKY_FN;

const FS_TOON = FS_HEAD + /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uShadowTint;
uniform vec3 uHiTint;
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

  float ndl = dot(n, uLightDir);
  float lit = smoothstep(-0.04, 0.06, ndl);
  float hi = smoothstep(0.62, 0.7, ndl);
  float up = clamp(n.y, 0.0, 1.0);
  vec3 sh = mix(uShadowTint, mix(uShadowTint, vec3(1.0), 0.35), up);
  vec3 shade = mix(sh, vec3(1.0), lit);
  shade = mix(shade, uHiTint, hi);
  vec3 col = mix(base * shade, base, vFx.y);

  float g = texture2D(uNoise, gl_FragCoord.xy * (1.0 / 128.0)).r - 0.5;
  float wash = texture2D(uNoise, vPos.xz * (1.0 / 64.0)).g - 0.5;
  col *= 1.0 + g * 0.05 + wash * 0.09;

  float f = smoothstep(uFog.x, uFog.y, dist);
  f *= 1.0 - vFx.y * uFog.z;
  col = mix(col, skyColor(v / dist), f);
  gl_FragColor = vec4(col, 1.0);
}
`;

const FS_INK = FS_HEAD + /* glsl */ `
uniform vec3 uInk;
void main() {
  vec3 ink = mix(uInk, vColor * 0.3, 0.42);
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  float f = smoothstep(uFog.x, uFog.y, dist);
  gl_FragColor = vec4(mix(ink, skyColor(v / dist), f), 1.0);
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
  c = mix(c, skyColor(v / dist), f);
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
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.3, 1.0, r)) * vFade;
  gl_FragColor = vec4(mix(vec3(1.0), uShadowColor, a), 1.0);
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
    c = mix(c, uMoonColor, disc * (1.0 - cut));
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
  c += (texture2D(uNoise, gl_FragCoord.xy * (1.0 / 128.0)).r - 0.5) * 0.02;
  gl_FragColor = vec4(c, 1.0);
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

export function makeEnvUniforms(env) {
  return {
    uSkyTop: { value: color(env.sky[0]) },
    uSkyHorizon: { value: color(env.sky[1]) },
    uSkyBottom: { value: color(env.sky[2]) },
    uSunDir: { value: dir(env.sun.dir) },
    uSunColor: { value: color(env.sun.glow) },
    uSunDisc: { value: color(env.sun.disc || '#ffffff') },
    uMoonDir: { value: dir(env.moon ? env.moon.dir : [0, 1, 0]) },
    uMoonColor: { value: color(env.moon ? env.moon.color : '#ffffff') },
    uSkyFx: {
      value: new THREE.Vector4(
        env.stars || 0,
        env.sun.size ? Math.cos(env.sun.size) : 2,
        env.moon ? Math.cos(env.moon.size) : 2,
        0
      ),
    },
    uLightDir: { value: dir(env.light.dir) },
    uShadowTint: { value: color(env.light.shadow) },
    uHiTint: { value: color(env.light.hi) },
    uInk: { value: color(env.ink) },
    uFog: { value: new THREE.Vector4(env.fog[0], env.fog[1], 0.65, 0) },
    uGroundA: { value: color(env.ground[0]) },
    uGroundB: { value: color(env.ground[1]) },
    uGroundC: { value: color(env.ground[2]) },
    uShadowColor: { value: color(env.shadowDecal) },
    uGlass: { value: new THREE.Vector4(...color(env.glass ? env.glass[0] : '#ffffff').toArray(), env.glass ? env.glass[1] : 0.2) },
    uGlowGain: { value: env.glowGain ?? 1 },
  };
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
    uMarkRepeat: { value: new THREE.Vector2(...(o.marks || [3, 3])) },
  });
  const defines = {};
  if (o.ground) defines.GROUND = o.ground;
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: VS_OBJECT,
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
    vertexShader: VS_OBJECT,
    fragmentShader: FS_INK,
    vertexColors: true,
    side: THREE.BackSide,
  });
}

export function makeGlassMaterial(env, o = {}) {
  const uniforms = withShared(env, {
    uAnim: { value: animVector(o.anim) },
    uWobble: { value: new THREE.Vector4(0, 0, 1, 0) },
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

export function makeShadowMaterial(env, o = {}) {
  const uniforms = withShared(env, { uAnim: { value: animVector(o.anim) } });
  return new THREE.ShaderMaterial({
    uniforms,
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
