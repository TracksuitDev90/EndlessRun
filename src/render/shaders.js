import * as THREE from '../../vendor/three/three.module.min.js';

// We author every color in sRGB and want it on screen untouched — the look is
// flat illustration, not physically based lighting.
THREE.ColorManagement.enabled = false;

// Uniforms shared by every material in the game (same JS objects, so one write
// updates all programs).
export const shared = {
  uCamPos: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  // x: bend, y: sway, z: how far ahead of the camera the world is kept true
  // (the dream's shape warps start past it, see bendPos), w: where the bend starts
  uBend: { value: new THREE.Vector4(0.00085, 0, 40, 10) },
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
  // how far the road moves under the runner while a frame is shown, times the
  // shutter (CONFIG.motionBlur): the ground's patterns blur along the run by
  // this much (see runBlur)
  uMotion: { value: 0 },
};

const COMMON = /* glsl */ `
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uBend;
uniform vec4 uTrip; // x hue shift, y far-world undulation, z hue drift
uniform vec4 uDream;
uniform vec4 uDream3;
// The curved world, plus everything the dream does to the shape of it. All of
// the dream's warps start only past uBend.z — the stretch of road the runner
// covers in the next few seconds, longer the faster they run — and grow from
// there, so every obstacle and gem is where it looks from the moment you can
// see it until you reach it, however deep the dream.
vec3 bendPos(vec3 wp) {
  vec3 o = wp;
  float a = uCamPos.z - wp.z;
  float d = clamp(a - uBend.w, 0.0, 320.0);
  float d2 = d * d;
  wp.y -= uBend.x * d2;
  wp.x += uBend.y * d2;
  float far = clamp(a - uBend.z, 0.0, 320.0);
  float wv = clamp(uTrip.y + uDream.y, -1.2, 1.2);
  if (wv != 0.0) {
    // the distant world breathes in slow waves rolling toward you
    float k = far * 0.0125;
    k *= k;
    wp.y += sin(a * 0.045 - uTime * 0.7) * wv * k * 5.0;
    wp.x += sin(a * 0.028 + uTime * 0.45) * wv * k * 8.0;
  }
  if (uDream.z != 0.0) {
    // melt: the far world wobbles like jelly, the tall things most
    float k = smoothstep(0.0, 58.0, far) * uDream.z;
    float h = max(o.y, 0.0);
    wp.x += sin(o.y * 0.42 + uTime * 1.3 + a * 0.05) * k * (0.45 + h * 0.26);
    wp.y += sin(o.x * 0.35 + uTime * 0.9 + a * 0.03) * k * h * 0.1;
  }
  if (uDream.x != 0.0) {
    // twist: the road ahead corkscrews about its own axis
    float k = smoothstep(0.0, 116.0, far);
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
// the paper grain: one texel of the noise texture's white noise per pixel
#define GRAIN (1.0 / 256.0)
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uGrade; // x saturation, y contrast, z vignette, w exposure
uniform vec3 uVignette;
// the vignette's shape (env.grade.edge): x where it starts, y where it's full
// (0 the centre of the screen, 1 the corners; the sides are about 0.7)
uniform vec4 uVigShape;
uniform vec2 uResolution;
uniform vec4 uDream2;
uniform vec4 uDream3;
uniform vec4 uBloom;
uniform vec3 uBloomCol[3];
// The colour drain (a world whose env asks for it, see game.js): x how much,
// y the radius (from the centre of the screen) the colour still holds out
// inside (big: untouched; below zero: all gone), z which way the front is
// going (+1 the colour is sucked away down a plughole in the middle of the
// screen, -1 it wells back up out of it), w 1 while the front is moving. gKeep
// marks what keeps its colour through it (lava, embers, the runner's cape)
// and gEmit pixels that light themselves (a ground pattern's glowing cracks);
// the shaders set them before grade().
uniform vec4 uDrain;
float gKeep = 0.0;
float gEmit = 0.0;
// x stars, y sun disc cos, z moon cos, w smoke (a ceiling of smoke with dry
// lightning in it, env.skyFx.smoke)
uniform vec4 uSkyFx;
// Under the sea (env.sea): x how much of the rippling surface shows overhead,
// y shafts of light fanning down from it, z how bright the caustics are on
// everything that faces up, w their scale (per metre)
uniform vec4 uSea;
// Deeper toward the bottom of the screen (env.deep): x how much, y where it
// begins and z where it's full (0 the top of the screen, 1 the bottom); the
// picture is multiplied toward uDeepTint, so the water darkens and cools the
// further down you look. What lights itself (gEmit) mostly keeps its glow.
uniform vec4 uDeep;
uniform vec3 uDeepTint;
// Dry lightning in a smoking sky: every 2.3 s there may be a strike. x its
// flash now (0..1), y the azimuth it strikes at, z the height its bolt comes
// down from, w which strike it is.
vec4 lightning() {
  float slot = floor(uTime / 2.3);
  float f = uTime - slot * 2.3;
  float h1 = fract(sin(slot * 12.9898) * 43758.5453);
  float h2 = fract(sin(slot * 78.233) * 43758.5453);
  float h3 = fract(sin(slot * 39.425) * 43758.5453);
  float t = f - h2 * 1.4;
  float fl = step(0.0, t) * (exp(-t * 14.0) + 0.7 * exp(-abs(t - 0.14) * 45.0) + 0.4 * exp(-abs(t - 0.3) * 35.0));
  return vec4(min(fl, 1.0) * step(0.42, h1) * min(uSkyFx.w, 1.0), (h3 - 0.5) * 2.0, 0.2 + 0.3 * h2, slot);
}
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// Per-world color grade + tinted vignette, applied to everything opaque, plus
// the dream's colour: a palette shift, rings of hue rolling toward you through
// the world (dist < 0: no world position, e.g. the sky), and a burst of colour
// from the centre of the screen as you come through a doorway — a ring of the
// new world's own colours racing out and off the edges of the screen, bands
// of them trailing behind it over the picture's light and shade, turning to
// rainbow as the trip deepens.
vec3 grade(vec3 c, vec4 trip, float dist) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uGrade.x * (1.0 + uDream3.y));
  c = (c - 0.5) * uGrade.y + 0.5;
  c *= uGrade.w;
  vec2 q = gl_FragCoord.xy / uResolution - 0.5;
  float r = length(q) * 1.414;
  // the same, kept round on any shape of screen (1 at the corners): the
  // burst and the drain are circles, not stretched to the screen
  vec2 qa = q * vec2(uResolution.x / uResolution.y, 1.0);
  float ra = length(qa) / length(vec2(0.5 * uResolution.x / uResolution.y, 0.5));
  float h = trip.x + trip.z * sin(uTime * 0.13) + uDream3.x;
  if (uDream2.x > 0.0 && dist >= 0.0) h += uDream2.x * sin(dist * 0.06 - uTime * 1.3) * 1.6 * smoothstep(10.0, 40.0, dist);
  if (uDream2.w > 0.0) {
    // the burst: its front flies out fast and eases off the edges of the
    // screen (uDream3.z runs 0..1 over the burst), a bright crest on it and
    // bands of colour streaming behind, fading as fast as they came
    float p = uDream3.z;
    float R = 1.4 * (1.0 - (1.0 - p) * (1.0 - p)) + 0.03;
    float behind = R - ra;
    float wake = smoothstep(-0.04, 0.015, behind) * exp(-max(behind, 0.0) * 1.8);
    float crest = 1.0 - smoothstep(0.0, 0.06, abs(behind - 0.02));
    float k = uDream2.w * wake;
    float s = sin(behind * 17.0);
    float u = 0.5 + 0.5 * s;
    vec3 band = u < 0.5 ? mix(uBloomCol[0], uBloomCol[1], u * 2.0) : mix(uBloomCol[1], uBloomCol[2], u * 2.0 - 1.0);
    float lc = dot(c, vec3(0.299, 0.587, 0.114));
    float lb = max(dot(band, vec3(0.299, 0.587, 0.114)), 0.05);
    vec3 tinted = min(band * (0.4 + 0.9 * lc / lb), vec3(1.25));
    c = mix(c, tinted, clamp(k * uBloom.x, 0.0, 0.85)) + band * (uDream2.w * uBloom.x * (0.22 * u * u * wake + 0.45 * crest));
    h += k * uBloom.y * s * 1.4;
  }
  if (h != 0.0) c = hueRot(c, h);
  if (uDrain.x > 0.0) {
    // The world drains to ash: everything but what burns goes to black, grey
    // and white (a little more contrast, so dark stones and rock still read
    // against the ash). Coming in, the colour is sapped away down a plughole
    // in the middle of the screen: the front closes in on it in spiral arms
    // that wind round as they go, under a dark rim, with streaks of colour
    // dragged in after it, and the colour left inside squeezed more vivid
    // as it's pulled toward the hole. Going out it runs backwards — the
    // colour wells up out of the hole and spirals out to the edges.
    float dir = uDrain.z;
    float live = uDrain.w;
    float e = ra - uDrain.y;
    float streak = 0.0;
    if (live > 0.0) {
      float th = atan(qa.y, qa.x);
      float lr = log(ra + 0.035);
      // log spirals: turning with time, they also slide in (or out) along
      // themselves
      // (turning a little slowly, so the swirl creeps rather than spins)
      float arms = sin(th * 3.0 + lr * 7.0 + uTime * 5.0 * dir);
      e -= arms * live * 0.085 * smoothstep(-0.15, 0.3, uDrain.y);
      float lines = smoothstep(0.35, 0.95, sin(th * 5.0 + lr * 11.0 + uTime * 8.5 * dir));
      streak = lines * exp(-max(e, 0.0) * 4.5) * step(0.0, e) * live;
    }
    float gone = smoothstep(-0.04, 0.1, e);
    float k = uDrain.x * gone * (1.0 - gKeep) * (1.0 - 0.85 * streak);
    float lg = dot(c, vec3(0.299, 0.587, 0.114));
    // what colour is left is squeezed more vivid as it's sucked toward the hole
    float squeeze = live * max(dir, 0.0) * (1.0 - gone) * (1.0 - smoothstep(0.0, 1.2, uDrain.y));
    c = mix(vec3(lg), c, 1.0 + squeeze * 0.8);
    lg = clamp((lg - 0.45) * 1.12 + 0.45, 0.0, 1.2);
    c = mix(c, vec3(lg), k);
    // the rim of the front: dark as the colour is sapped, bright as it wells back
    float rim = live * uDrain.x * (1.0 - smoothstep(0.0, 0.08, abs(e - 0.02))) * (1.0 - gKeep);
    c = dir > 0.0 ? c * (1.0 - 0.45 * rim) : c + rim * 0.22;
  }
  if (uDeep.x > 0.0) {
    // the water deepens down the screen: teal at the top, sinking through
    // green and blue into the dark at the bottom
    float yb = 1.0 - gl_FragCoord.y / uResolution.y;
    float dk = smoothstep(uDeep.y, uDeep.z, yb) * uDeep.x * (1.0 - 0.75 * gEmit);
    c = mix(c, c * uDeepTint, dk);
  }
  float vg = smoothstep(uVigShape.x, uVigShape.y, r) * uGrade.z;
  if (uSkyFx.w > 0.0) {
    // a lightning flash lights the whole world for an instant, a cold white
    // light thrown right out into the dark at the edges
    float fl = lightning().x;
    c += (c * 1.1 + vec3(0.07, 0.07, 0.1)) * fl * (1.0 - gEmit);
    vg *= 1.0 - 0.6 * fl;
  }
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
#ifdef CLOTH
// washing in the breeze (toon option cloth): x how far a hem sways, y how
// fast, z the line's height, w how far the washing hangs below it
uniform vec4 uCloth;
#endif
#ifdef TURN
// x spin about the local z axis (rad/s; gears, clock hands), y swing about the
// local x axis (radians; a pendulum hung from the origin), z swing rate, w
// spin about the local y axis (rad/s)
uniform vec4 uTurn;
#endif
attribute vec3 fx;
#ifdef OUTLINE
uniform float uOutline;
attribute vec3 onrm;
#endif
#ifdef USE_INSTANCING
attribute vec4 aInst;
#endif
#ifdef WONKY
// Time coming unstuck (env.wonk, see game.js): 0 every hand keeps its own
// steady pace; higher, they lurch, stall, race and tick back and forth. A
// clock's hands are one batch: role 0 the minute hand, 1 the hour hand.
uniform float uWonk;
#endif
#if defined(SAND) || defined(WONKY) || defined(JELLY)
attribute float role;
#endif
#ifdef CURRENT
// Swaying in the current (kelp, seagrass, anemones): a wave runs up the prop
// from its foot, more and more the higher it reaches. x how far it leans
// across, y how fast, z how quickly the wave travels up it (per metre), w how
// far it leans along the run. (Nothing moves at the foot.)
uniform vec4 uCurrent;
#endif
#ifdef SCHOOL
// A school of fish (or a column of bubbles): one instance, every fish its own
// vertices built nose to +x round the origin, fish.xyz where it swims in the
// school and fish.w its own beat. x how fast they swim (m/s), y the length of
// the loop they follow (m), z how far the stream snakes, w the shape: 0 a
// stream flowing along +x, 1 a ball milling round the y axis, 2 a column
// rising up y.
uniform vec4 uSchool;
attribute vec4 fish;
#endif
#ifdef JELLY
// A jellyfish: the bell (role 0) squeezes and relaxes, a quick beat and a
// slow ease back, and the arms and tentacles below it (role 1) trail and
// ripple a beat behind; it lifts a little on each beat and sinks back. x beats
// per second, y how hard the bell squeezes, z how far the trailing parts
// ripple, w how far it lifts.
uniform vec4 uJelly;
#endif
#ifdef CROSS
// Something swimming across the run (a whale): it glides sideways along its
// own x as the runner comes up to it — uCross.x metres for every metre
// between them — so that it is right across the road the moment the runner
// is under it, however fast they run. Its tail half beats up and down (y
// rate, z how far at the flukes), and while it's far off it rises and dips a
// little (w). Turned about by its phase (p0 past pi), it swims the other way.
uniform vec4 uCross;
uniform vec3 uGemAt;
#endif
#ifdef SAND
// An hourglass that works: its sand runs from the top bulb to the bottom over
// uSand.x seconds — the pile above sinking into the neck, a thin stream
// falling, the pile below growing — then the whole glass turns over on its
// waist and starts again. y the waist's height, z its depth (the turn's
// pivot), w how far below the waist the floor of the lower bulb is. role: 1
// the sand above, 2 the sand below, 3 the stream (built 0..1 along y).
uniform vec4 uSand;
#endif
#ifdef SPLASH
// Lava splashing: every droplet leaps from where it lies (spA.xyz) at its
// own launch velocity (spB.xyz), arcs up and falls back in, over and over
// (every spB.w seconds, its phase spA.w), stretched along its flight
attribute vec4 spA;
attribute vec4 spB;
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
  #ifdef KINDS
    // one batch, several designs (a hall's paintings): each vertex carries
    // its design in uv.x and an instance shows only its own (aInst.y); the
    // rest collapse off screen
    if (abs(uv.x - aInst.y) > 0.5) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
  #endif
  #ifdef SCHOOL
    {
      // each fish along its loop, turned the way it's heading, its tail
      // beating; at the ends of a stream's loop they shrink away to nothing,
      // so its wrapping round never shows
      float spd = uSchool.x * (0.86 + 0.28 * fract(fish.w * 7.31));
      float L = uSchool.y;
      float t = uTime + phase * 13.0;
      vec3 c;
      float fade = 1.0;
      float yaw = 0.0;
      if (uSchool.w < 0.5) {
        float s = mod(fish.x + t * spd, L) - 0.5 * L;
        fade = 1.0 - smoothstep(0.34 * L, 0.5 * L, abs(s));
        float ph = s * 0.11 + t * 0.35;
        float ph2 = s * 0.07 - t * 0.21 + 1.7;
        c = vec3(s, fish.y + sin(ph2) * uSchool.z * 0.35, fish.z + sin(ph) * uSchool.z);
        yaw = atan(-cos(ph) * 0.11 * uSchool.z, 1.0);
      } else if (uSchool.w < 1.5) {
        float r = max(fish.z, 0.5);
        float a = fish.x / L * 6.2831 + t * spd / r;
        c = vec3(cos(a) * r, fish.y + sin(a * 2.0 + fish.w * 6.2831) * 0.35, sin(a) * r);
        yaw = atan(-cos(a), -sin(a));
      } else {
        // a column of bubbles rising, wobbling, swelling as they go
        float s = mod(fish.x + t * spd, L);
        fade = smoothstep(0.0, 0.05 * L, s) * (1.0 - smoothstep(0.88 * L, L, s)) * (0.65 + 0.7 * s / L);
        c = vec3(fish.z + sin(t * 3.1 + fish.w * 40.0) * 0.09, s, fish.y + cos(t * 2.7 + fish.w * 31.0) * 0.09);
      }
      if (uSchool.w < 1.5) {
        float wig = sin(uTime * (7.0 + spd * 1.3) + fish.w * 6.2831 - lp.x * 9.0);
        lp.z += wig * (0.6 * max(-lp.x, 0.0) - 0.08 * max(lp.x, 0.0));
      }
      lp *= fade;
      lp = rotY(lp, yaw);
      ln = rotY(ln, yaw);
      #ifdef OUTLINE
        lo = rotY(lo, yaw) * fade;
      #endif
      lp += c;
    }
  #endif
  #ifdef JELLY
    {
      // a quick squeeze, a slow ease back
      float f = fract(uTime * uJelly.x + phase * 0.1592);
      float con = smoothstep(0.0, 0.16, f) * (1.0 - smoothstep(0.16, 0.8, f));
      if (role < 0.5) {
        // the bell: its rim pulls in hardest, its crown stretches up
        float rim = 1.0 - smoothstep(0.0, 0.9, lp.y);
        lp.xz *= 1.0 - uJelly.y * con * (0.35 + 0.65 * rim);
        lp.y *= 1.0 + uJelly.y * 0.55 * con;
      } else {
        // the arms and tentacles: drawn in with the bell at the top, rippling
        // further down, a beat behind
        float hang = max(-lp.y, 0.0);
        lp.xz *= 1.0 - uJelly.y * 0.8 * con * clamp(1.0 - hang * 0.6, 0.0, 1.0);
        float tt = uTime * 1.7 + phase * 3.0 - hang * 1.6;
        lp.x += sin(tt) * uJelly.z * hang * 0.22;
        lp.z += sin(tt * 0.83 + 1.9) * uJelly.z * hang * 0.18;
        lp.y += con * uJelly.y * hang * 0.22;
      }
      // it lifts on each beat and sinks slowly back
      lp.y += uJelly.w * mix(smoothstep(0.0, 0.35, f), 1.0 - smoothstep(0.35, 1.0, f), step(0.35, f));
    }
  #endif
  #ifdef CROSS
    float crossDir = phase > 3.14159 ? -1.0 : 1.0;
    {
      // the tail half beats up and down, more and more toward the flukes, a
      // wave running back along it
      float tl = clamp((-lp.x - 2.0) / 7.6, 0.0, 1.0);
      lp.y += sin(uTime * uCross.y + phase * 2.0 + lp.x * 0.3) * uCross.z * tl * tl;
      // (turned about, to swim the other way)
      lp.xz *= crossDir;
      ln.xz *= crossDir;
      #ifdef OUTLINE
        lo.xz *= crossDir;
      #endif
    }
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
  #ifdef SAND
    {
      float s = fract(uTime / uSand.x + phase * 0.1592);
      float run = clamp(s / 0.84, 0.0, 1.0);
      vec3 waist = vec3(0.0, uSand.y, uSand.z);
      vec3 base = vec3(0.0, uSand.y - uSand.w, uSand.z);
      if (role > 0.5 && role < 1.5) {
        // the pile above sinks into the neck
        lp = waist + (lp - waist) * pow(1.0 - run, 0.333);
      } else if (role > 1.5 && role < 2.5) {
        // the pile below grows up off the floor of the bulb
        lp = base + (lp - base) * pow(run, 0.333);
      } else if (role > 2.5) {
        // the stream: from the neck down onto the top of the pile
        float top = base.y + uSand.w * 0.6 * pow(run, 0.333);
        float on = step(0.003, run) * (1.0 - step(0.997, run)) * (0.75 + 0.25 * sin(uTime * 37.0 + lp.y * 25.0));
        lp.y = mix(top, waist.y, lp.y);
        lp.xz = waist.xz + (lp.xz - waist.xz) * on;
      }
      // turned over on its waist once it has run through
      float ang = smoothstep(0.86, 1.0, s) * 3.14159265;
      float c = cos(ang), sn = sin(ang);
      vec2 r = lp.yz - waist.yz;
      lp.yz = waist.yz + vec2(r.x * c - r.y * sn, r.x * sn + r.y * c);
      ln.yz = vec2(ln.y * c - ln.z * sn, ln.y * sn + ln.z * c);
      #ifdef OUTLINE
        lo.yz = vec2(lo.y * c - lo.z * sn, lo.y * sn + lo.z * c);
      #endif
    }
  #endif
  #ifdef TURN
    {
      // (the phase starts a spinning thing at its own angle; something that
      // only swings, like a pendulum, still hangs straight down)
      float a = uTurn.x * uTime + (uTurn.x != 0.0 ? phase * 6.2831 : 0.0);
      #ifdef WONKY
        // each hand its own pace, either way round; then, the more time comes
        // unstuck, lurching back and forth, racing and stalling, and ticking
        // in jerks that snap forward and back
        float hp = phase + role * 3.17;
        float h1 = fract(hp * 0.731 + 0.13);
        float h2 = fract(hp * 1.37 + 0.71);
        float h3 = fract(hp * 2.11 + 0.37);
        a = uTurn.x * (1.0 - 0.76 * role) * uTime * (0.5 + 1.6 * h1) * (h3 < 0.38 ? -1.0 : 1.0) + hp * 6.2831;
        a += uWonk * (2.4 * sin(uTime * (0.45 + h2 * 1.3) + h3 * 6.28) + 1.2 * sin(uTime * (1.8 + h1 * 2.6) + h2 * 6.28));
        float tk = uTime * (1.1 + h2 * 2.2) + h1 * 5.0;
        a += uWonk * 0.6 * sin(floor(tk) * 2.39 + h3 * 9.0) * smoothstep(0.0, 0.1, fract(tk));
      #endif
      float c = cos(a), sn = sin(a);
      lp.xy = vec2(lp.x * c - lp.y * sn, lp.x * sn + lp.y * c);
      ln.xy = vec2(ln.x * c - ln.y * sn, ln.x * sn + ln.y * c);
      #ifdef OUTLINE
        lo.xy = vec2(lo.x * c - lo.y * sn, lo.x * sn + lo.y * c);
      #endif
      float b = uTurn.y * sin(uTime * uTurn.z + phase * 6.2831);
      c = cos(b);
      sn = sin(b);
      lp.yz = vec2(lp.y * c - lp.z * sn, lp.y * sn + lp.z * c);
      ln.yz = vec2(ln.y * c - ln.z * sn, ln.y * sn + ln.z * c);
      #ifdef OUTLINE
        lo.yz = vec2(lo.y * c - lo.z * sn, lo.y * sn + lo.z * c);
      #endif
      lp = rotY(lp, uTurn.w * uTime + phase);
      ln = rotY(ln, uTurn.w * uTime + phase);
      #ifdef OUTLINE
        lo = rotY(lo, uTurn.w * uTime + phase);
      #endif
    }
  #endif
  #ifdef SPLASH
    {
      float per = spB.w;
      float t = mod(uTime + spA.w * per + phase * 1.7, per);
      float grav = 15.0;
      float flight = 2.0 * spB.y / grav;
      float tt = min(t, flight);
      vec3 vel = spB.xyz - vec3(0.0, grav * tt, 0.0);
      float sz = smoothstep(0.0, 0.06, tt) * (1.0 - smoothstep(flight * 0.75, flight, tt)) * step(t, flight);
      vec3 vd = normalize(vel + vec3(0.0, 0.001, 0.0));
      lp *= sz;
      lp += vd * dot(lp, vd) * length(vel) * 0.09;
      lp += spA.xyz + spB.xyz * tt - vec3(0.0, 0.5 * grav * tt * tt, 0.0);
    }
  #endif
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
  #ifdef CURRENT
    {
      float h = max(lp.y, 0.0);
      float k = pow(h * 0.1, 1.3);
      float tt = uTime * uCurrent.y + phase * 6.2831 - h * uCurrent.z;
      lp.x += (sin(tt) + 0.35 * sin(tt * 2.3 + 1.1)) * uCurrent.x * k;
      lp.z += sin(tt * 0.77 + 2.1) * uCurrent.w * k;
    }
  #endif
  #ifdef CLOTH
    // washing on the line (uv.y > 0.5, each garment on its own beat in uv.x)
    // stirs in the breeze: it swings gently on its pegs and billows, ripples
    // running across it, more and more the further it hangs below the line;
    // a swing only ever lifts the hem
    if (uv.y > 0.5) {
      float hang = clamp((uCloth.z - lp.y) / uCloth.w, 0.0, 1.0);
      float t = uTime * uCloth.y + uv.x * 6.2831 + phase * 2.0;
      float sway = sin(t) * 0.65 + sin(t * 2.1 + 1.3) * 0.35;
      float ra = t * 1.7 - lp.x * 5.0 + hang * 3.0;
      float rip = sin(ra);
      float dz = uCloth.x * (hang * hang * sway + 0.3 * hang * rip);
      // (sideways too, the hem fluttering more than the rest)
      float dx = uCloth.x * hang * hang * (0.55 * sin(t * 0.8 + 2.0) + 0.2 * sin(t * 2.9 - lp.x * 3.0));
      lp.z += dz;
      lp.x += dx;
      lp.y += (dz * dz + dx * dx) / (2.0 * max(uCloth.z - lp.y, 0.3));
      // tilt the cloth's normals with the billow
      float dzdy = -uCloth.x * (2.0 * hang * sway + 0.3 * rip + 0.9 * hang * cos(ra)) / uCloth.w;
      float dzdx = -uCloth.x * 1.5 * hang * cos(ra);
      ln.xy -= vec2(dzdx, dzdy) * ln.z;
      ln = normalize(ln);
    }
  #endif
  #ifdef FLAME
    // a fire's tongues (its fully self-lit parts) lick and flicker, each on
    // its own beat (uv.x), more and more toward its tip (uv.y)
    if (fx.y > 0.95) {
      float k = clamp(uv.y, 0.0, 1.0);
      float t = uTime * (6.5 + uv.x * 3.5) + uv.x * 17.0 + phase * 5.0;
      lp.x += (sin(t) * 0.07 + sin(t * 2.7 + 1.3) * 0.03) * k * k;
      lp.z += sin(t * 1.3 + 2.0) * 0.045 * k * k;
      lp.y += (sin(t * 1.9 + 0.7) * 0.5 + 0.5) * 0.14 * k;
    }
  #endif

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
  #ifdef CROSS
    {
      // right across the road when the runner is under it, gliding in from
      // its tail's side and on out past its head's
      float aR = uGemAt.z - pivot.z;
      float off = -aR * uCross.x * crossDir;
      wp.x += off;
      wp.y += sin(uTime * 0.35 + phase) * uCross.w * smoothstep(30.0, 90.0, aR);
      pivot.x += off;
    }
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

  if (uDream.w * uDreamK > 0.0) {
    // breathe: props in the distance swell and settle like living things,
    // and firm up into their true shape as they come close
    float k = smoothstep(max(26.0, uBend.z - 10.0), max(64.0, uBend.z + 28.0), aP) * uDream.w * uDreamK;
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
    #if GROUND >= 6
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
// 1 for what you play against (obstacles and gems): it cuts through the low
// mist and the distance fog more than the scenery does, so it reads far off
uniform float uClear;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec2 vUv;
varying vec3 vFx;
` + SKY_FN + /* glsl */ `
// Low-lying mist by true height, then distance fog into the sky color. (The
// near part of the world — most of the screen — has no fog at all: it skips
// working out the sky's colour there, since none of it would show.)
vec3 atmos(vec3 col, vec3 v, float dist, float emissive) {
  float mh = 1.0 - smoothstep(uMistH.x - uMistH.y, uMistH.x, vPos.y);
  float md = smoothstep(uMistH.z, uMistH.w, dist);
  col = mix(col, uMist.rgb, mh * md * uMist.a * (1.0 - emissive * 0.6) * (1.0 - 0.7 * uClear));
  if (dist <= uFog.x) return col;
  float f = smoothstep(uFog.x, uFog.y, dist);
  f *= (1.0 - emissive * uFog.z) * (1.0 - 0.45 * uClear);
  return mix(col, skyColor(v / dist), f);
}
`;

// Caustics (env.sea, after a shader's uNoise): the light let down through a
// rippling surface gathers into a bright net that wavers and drifts over
// everything facing up — two drifting sets of wiggling lines, warped by a
// slower swell, brightest where they cross. Returns how much light to add (a
// share of what's there already). The scale (uSea.w) should be a multiple of
// 1/256, so the net doesn't jump when the world re-bases.
const CAUSTIC = /* glsl */ `
float causticLine(float a, float fq, float w) {
  // the distance to the line, measured along the slope of the noise, so the
  // line keeps one width on the ground wherever the noise runs steep or flat
  float d = abs(a - 0.5) / max(fwidth(a) / fq, 0.05);
  return (1.0 - smoothstep(w, w + fq * 1.5, d)) + 0.22 * (1.0 - smoothstep(0.0, w * 6.0, d));
}
float caustic(vec3 p, vec3 n, float dist) {
  if (uSea.z <= 0.0) return 0.0;
  float t = uTime;
  vec2 q = p.xz * uSea.w;
  float w0 = texture2D(uNoise, q * 0.5 + vec2(t * 0.013, -t * 0.009)).g - 0.5;
  vec2 qw = q + vec2(w0, -w0) * 0.6;
  float a = texture2D(uNoise, qw + vec2(t * 0.031, t * 0.017)).g;
  float b = texture2D(uNoise, qw * 1.5 + vec2(0.37 - t * 0.021, 0.61 + t * 0.027)).g;
  float fq = max(fwidth(qw.x) + fwidth(qw.y), 1e-4);
  float la = causticLine(a, fq, 0.011);
  float lb = causticLine(b, fq * 1.5, 0.014);
  float c = la * 0.5 + lb * 0.45 + la * lb * 1.6;
  float up = smoothstep(-0.35, 0.85, n.y);
  return c * up * uSea.z * (1.0 - smoothstep(26.0, 78.0, dist));
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
` + CAUSTIC + /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
#ifdef CRUST
// A textured crust for rock, charred wood and volcanic glass (Hell's
// obstacles and stones). Each part picks its kind with its mark flag (fx.x:
// 0 basalt, 0.5 charred wood, 1 obsidian; no marks are drawn on a crust).
// x how much its cracks glow, y ash settled on what faces up, z scale (keep it
// a multiple of 1/512 so the texture doesn't jump when the world re-bases).
uniform vec4 uCrust;
float tri(vec3 p, vec3 an) {
  return texture2D(uNoise, p.yz).g * an.x + texture2D(uNoise, p.xz).g * an.y + texture2D(uNoise, p.xy).g * an.z;
}
#endif
#ifdef BARK
// Bark and sawn wood (toon option bark), each part picking its kind with its
// mark flag (fx.x: 0.4 bark, 0.3 a sawn end; anything else gets the usual
// marks). Both return how much to darken the part's own colour.
//
// Bark, its uv laid out round the trunk or log (x: 0..16 round it, y: plates
// along it; see asBark in forest.js): rounded ridges between deep V-shaped
// furrows, two dozen round the trunk, wandering along the grain at two
// scales; here and there a furrow splits a ridge down its middle; the ridges
// break across now and then into corky plates, each its own shade, the cracks
// slanting; a fibrous streak runs through it all, and pale-green lichen grows
// in patches. The detail eases off to an even tone where it would shimmer.
vec3 barkTex(vec2 p) {
  float w1 = texture2D(uNoise, vec2(p.x * 0.0625, p.y * 0.05)).g;
  float w2 = texture2D(uNoise, vec2(p.x * 0.25 + 0.37, p.y * 0.18)).g;
  float fx = p.x * 1.5 + (w1 - 0.5) * 3.0 + (w2 - 0.5) * 1.1;
  float col = mod(floor(fx), 24.0);
  float f = fract(fx);
  float ridge = pow(sin(3.14159 * f), 0.7);
  float split = smoothstep(0.55, 0.7, texture2D(uNoise, vec2(p.x * 0.125 + 0.71, p.y * 0.07)).g);
  ridge *= 1.0 - split * (1.0 - smoothstep(0.0, 0.16, abs(f - 0.5)));
  float far = smoothstep(0.25, 0.6, max(fwidth(fx), fwidth(p.y)));
  ridge = mix(ridge, 0.6, far);
  float py = p.y + hash12(vec2(col, 1.7)) * 5.0 + (f - 0.5) * 0.35 + (w2 - 0.5) * 0.8;
  float pc = floor(py);
  float pf = fract(py);
  float crack = (1.0 - smoothstep(0.0, 0.045, min(pf, 1.0 - pf))) * step(0.5, hash12(vec2(col, pc) + 0.7));
  crack *= smoothstep(0.3, 0.7, ridge) * (1.0 - far);
  float tone = mix(hash12(vec2(col, pc) + 3.1), 0.5, far);
  float grain = texture2D(uNoise, vec2(p.x * 0.5, p.y * 0.45) + 0.5).g;
  float k = mix(0.3, 1.08, ridge) * (0.88 + 0.24 * tone) * (1.0 - 0.45 * crack) * (0.88 + 0.24 * grain);
  float lich = smoothstep(0.6, 0.78, texture2D(uNoise, vec2(p.x * 0.0625 + 0.21, p.y * 0.07 + 0.6)).g) * ridge;
  return mix(vec3(k), vec3(k * 1.12, k * 1.3, k * 1.02), lich * 0.6);
}
// A sawn end, its uv a cylinder's cap (centred on 0.5): growth rings round a
// pith a little off-centre, wavering; darker heartwood in the middle, pale
// sapwood out by the bark, and checks split in from the rim as it dried.
float endGrain(vec2 uv) {
  vec2 q = uv - 0.5 + vec2(0.035, -0.025);
  float r = length(q) * 2.0;
  float a = atan(q.y, q.x);
  float wob = texture2D(uNoise, vec2(a * 0.15915 + 0.5, 0.37)).g - 0.5;
  float rings = (r + wob * 0.14 * r) * 11.0;
  float rf = fract(rings);
  float fw = fwidth(rings);
  float late = smoothstep(0.55, 0.85, rf) * (1.0 - smoothstep(0.85, 1.0, rf));
  late = mix(late, 0.25, smoothstep(0.25, 0.7, fw));
  float k = (1.0 - 0.3 * late) * mix(0.72, 1.0, smoothstep(0.0, 0.32, r)) * (1.0 + 0.08 * smoothstep(0.7, 0.92, r));
  float ck = smoothstep(0.99, 0.998, cos(a * 3.0 + 0.7 + wob * 2.0)) * smoothstep(0.3, 0.85, r);
  return k * (1.0 - 0.55 * ck * (1.0 - smoothstep(0.25, 0.7, fw)));
}
#endif
#ifdef PLEATS
// A whale's skin (toon option pleats, on parts whose mark flag is 0.6; uv.x
// runs along the body tail to snout, uv.y round it from the spine): long
// grooves down its throat and belly, pale between dark lines, from the chin
// back past the flippers; and a few pale scars and barnacle scuffs
// scattered over the rest. Returns how much to scale the part's colour.
float pleats(vec2 uv) {
  float belly = 1.0 - smoothstep(0.15, 0.24, abs(uv.y - 0.5));
  float along = smoothstep(0.38, 0.5, uv.x) * (1.0 - smoothstep(0.93, 0.98, uv.x));
  float g = uv.y * 70.0;
  float fw = fwidth(g);
  float groove = 1.0 - smoothstep(0.12, 0.12 + fw * 1.5, abs(fract(g) - 0.5));
  groove *= 1.0 - smoothstep(0.35, 0.8, fw);
  float k = 1.0 - groove * belly * along * 0.42;
  float sc = texture2D(uNoise, uv * vec2(9.0, 4.0)).g;
  float scar = smoothstep(0.7, 0.74, sc) * (1.0 - belly) * smoothstep(0.55, 0.9, uv.x);
  return k * (1.0 + scar * 0.45);
}
#endif
#ifdef GROUND
uniform vec3 uGroundA;
uniform vec3 uGroundB;
uniform vec3 uGroundC;
uniform float uMotion;
float edgeMask(vec2 f, vec2 size, float w) {
  vec2 e = min(f, 1.0 - f) * size;
  float aa = max(fwidth(vUv.y), fwidth(vUv.x)) * 0.8;
  return smoothstep(w - aa, w + aa, min(e.x, e.y));
}
// A line of half-width w across the road, d metres away (along the run),
// filtered over a pixel (aa) and over the frame's travel: at speed the road
// moves further in a frame than its tiles are deep (28 m/s against 32 cm
// cobbles is a row and a half a frame), and a crisp line seems to strobe or
// crawl backwards. Smeared over the travel, as a camera's shutter would, it
// widens and fades instead. Returns the line's coverage.
float runLine(float d, float w, float aa) {
  float b = max(aa, uMotion);
  return (1.0 - smoothstep(w - b, w + b, d)) * min(1.0, (2.0 * w + aa) / (2.0 * w + b));
}
// edgeMask for tiles laid across the run, their joins across it blurred by
// the run (identical to edgeMask standing still)
float edgeMaskRun(vec2 f, vec2 size, float w) {
  vec2 e = min(f, 1.0 - f) * size;
  float aa = max(fwidth(vUv.y), fwidth(vUv.x)) * 0.8;
  float along = smoothstep(w - aa, w + aa, e.x);
  if (uMotion <= aa) return min(along, smoothstep(w - aa, w + aa, e.y));
  return min(along, 1.0 - runLine(e.y, w, aa));
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
    c = mix(mix(uGroundC, c, 0.35), c, mix(edgeMaskRun(fract(q), cs, 0.026), 1.0, far * 0.8));
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
    c = mix(uGroundC, c, mix(edgeMaskRun(fract(q), cs, 0.03), 1.0, far * 0.8));
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
    // (and at speed, as each blade passes under the camera faster than a
    // frame can follow, they smear into the grass's own tone; standing
    // still this is no change)
    soften = max(soften, smoothstep(0.2, 0.6, uMotion / 0.42));
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
  #elif GROUND == 7
    // (p.y runs on from chunk to chunk, like the forest's grass, so every
    // period here divides the 4096 m it wraps at)
    // A plain of dark ash and cinders out to the edge of the world, and
    // through it the road: a pale path of bone-white ash, packed and scuffed
    // by feet, fraying at its edges into the dark. Embers smoulder here and
    // there in the plain, and out beyond the road the crust splits in glowing
    // fissures (embers and fissures keep their colour, and their light, when
    // the world drains).
    float n1 = texture2D(uNoise, p * 0.09375).g;
    float n2 = texture2D(uNoise, p * 0.40625 + 0.31).g;
    float n3 = texture2D(uNoise, p * 1.5 + 0.67).g;
    vec3 c = mix(uGroundA, uGroundB, smoothstep(0.25, 0.75, n1 * 0.7 + n2 * 0.3));
    c *= 0.8 + 0.4 * n3 * (1.0 - far * 0.7);
    float rip = sin(p.y * 1.9635 + n1 * 7.0 + p.x * 0.35) * 0.5 + 0.5;
    float edgeN = (n2 - 0.5) * 0.7 + (n1 - 0.5) * 0.9;
    float road = 1.0 - smoothstep(3.5, 4.6, abs(p.x) + edgeN);
    float scuff = texture2D(uNoise, vec2(p.x * 0.625, p.y * 0.046875)).g;
    vec3 bone = vec3(0.46, 0.43, 0.41) * (0.78 + 0.22 * n2 + 0.16 * scuff + 0.1 * n3) * (0.93 + 0.09 * rip);
    c = mix(c, bone, road * (1.0 - far * 0.3));
    // cinders on the road, pale flakes of ash out in the plain
    vec2 cq = p / 0.53;
    vec2 cc = floor(cq);
    float ch = hash12(cc + 5.0);
    vec2 co = vec2(hash12(cc + 1.3), hash12(cc + 7.7)) * 0.6 + 0.2;
    float cr = 0.04 + 0.09 * hash12(cc + 2.9);
    float cfa = fwidth(cq.x) + 0.02;
    float cf = (1.0 - smoothstep(cr - cfa, cr + cfa, length((fract(cq) - co) * vec2(1.0, 1.0 + hash12(cc + 4.1))))) * step(0.9, ch) * (1.0 - far);
    c = mix(c, mix(vec3(0.7, 0.67, 0.64), uGroundC, road), cf * 0.75);
    // embers smouldering in the dark ash beside the road
    vec2 eq = p / 0.85;
    vec2 ec = floor(eq);
    float eh = hash12(ec + 31.0);
    vec2 eo = vec2(hash12(ec + 2.1), hash12(ec + 8.3)) * 0.6 + 0.2;
    float er = 0.05 + 0.06 * hash12(ec + 6.6);
    float efa = fwidth(eq.x) + 0.02;
    float ed = length(fract(eq) - eo);
    float ember = (1.0 - smoothstep(er - efa, er + efa, ed)) * step(0.955, eh) * (1.0 - road) * (1.0 - far * 0.8);
    float eglow = (1.0 - smoothstep(0.0, er * 3.5, ed)) * step(0.955, eh) * (1.0 - road) * (1.0 - far * 0.8);
    float flick = 0.65 + 0.35 * sin(uTime * (2.0 + eh * 5.0) + eh * 40.0);
    c = mix(c, vec3(0.9, 0.25, 0.04) * flick, eglow * 0.35);
    c = mix(c, vec3(1.0, 0.62, 0.2) * (0.7 + 0.3 * flick), ember);
    gKeep = max(ember, eglow * 0.6);
    gEmit = max(ember, eglow * 0.4);
    float off = smoothstep(5.0, 7.0, abs(p.x));
    if (off > 0.0) {
      float f = texture2D(uNoise, p * 0.0234375).g * 0.75 + texture2D(uNoise, p * 0.0703125 + 0.5).g * 0.25;
      float line = abs(f - 0.5);
      float w = fwidth(f) * 1.2 + 0.002;
      // (broken up, so they read as separate rifts rather than a net)
      float rift = smoothstep(0.38, 0.55, texture2D(uNoise, p * 0.01171875 + 0.23).g) * off;
      float crack = (1.0 - smoothstep(0.004, 0.004 + w, line)) * rift;
      float halo = (1.0 - smoothstep(0.0, 0.05 + w * 2.0, line)) * rift;
      float pulse = 0.78 + 0.22 * sin(uTime * 1.7 + p.y * 0.19635 + p.x * 0.13);
      vec3 hot = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.8, 0.3), crack) * pulse;
      c = mix(c * (1.0 - halo * 0.5), hot, max(crack, halo * 0.45));
      gKeep = max(gKeep, max(crack, halo * 0.7));
      gEmit = max(gEmit, max(crack, halo * 0.55));
    }
    return c;
  #elif GROUND == 8
    // the gallery floor: long slabs of ivory stone laid to the lanes, faintly
    // veined, and brass let into it — a bezel of clock ticks down each edge of
    // the walk (every half metre, a long one every two), and beyond it a
    // border of darker stone. (p.y runs on from chunk to chunk; every period
    // divides the 4096 m it wraps at.)
    vec2 cs = vec2(2.4, 3.2);
    vec2 q = vec2(p.x + 1.2, p.y) / cs;
    q.y += mod(floor(q.x), 2.0) * 0.5;
    vec2 cell = floor(q);
    float h = hash12(cell + 9.0);
    vec3 c = mix(uGroundA, uGroundB, 0.25 + h * 0.6);
    float vein = texture2D(uNoise, p * vec2(0.09375, 0.0390625) + h * 0.37).g;
    float vw = fwidth(vein) + 0.01;
    c = mix(c, uGroundC * 1.3, (1.0 - smoothstep(0.0, 0.02 + vw, abs(vein - 0.55))) * 0.3 * (1.0 - far));
    c = mix(mix(uGroundC, c, 0.55), c, mix(edgeMask(fract(q), cs, 0.022), 1.0, far * 0.8));
    vec3 brass = vec3(0.8, 0.6, 0.3);
    float ax = abs(p.x);
    float aa = fwidth(p.y) * 1.2 + 0.004;
    float tq = abs(fract(p.y / 0.5) - 0.5) * 0.5;
    float major = 1.0 - step(0.13, abs(fract(p.y / 2.0) - 0.5));
    float tickW = mix(0.022, 0.045, major);
    float tickIn = mix(4.08, 3.9, major);
    float tick = (uMotion <= aa ? 1.0 - smoothstep(tickW - aa, tickW + aa, tq) : runLine(tq, tickW, aa)) * step(tickIn, ax) * step(ax, 4.36);
    float rimA = 1.0 - smoothstep(0.018, 0.018 + aa + fwidth(ax), abs(ax - 3.82));
    float rimB = 1.0 - smoothstep(0.03, 0.03 + aa + fwidth(ax), abs(ax - 4.42));
    float metal = max(max(tick, rimA), rimB) * (1.0 - far * 0.7);
    float border = smoothstep(4.46, 4.52, ax);
    c = mix(c, mix(uGroundC, uGroundA, 0.3), border);
    c = mix(c, brass * (0.9 + 0.2 * hash12(cell)), metal);
    return c;
  #elif GROUND == 9
    // The ocean floor: a path of pale sand down the middle, rippled by the
    // current — the ripples run along the path, so they never strobe however
    // fast you run — strewn with shells and pebbles and now and then a
    // starfish; beyond it the sand sinks into a darker seabed patched with
    // seagrass. (p.y runs on from chunk to chunk; every period here divides
    // the 4096 m it wraps at.)
    float n1 = texture2D(uNoise, p * 0.0625).g;
    float n2 = texture2D(uNoise, p * 0.25 + 0.31).g;
    float n3 = texture2D(uNoise, p * vec2(0.75, 0.1875) + 0.67).g;
    float rx = p.x * 2.4 + sin(p.y * 0.19635) * 0.8 + (n1 - 0.5) * 5.0 + (n3 - 0.5) * 1.4;
    float rip = sin(rx * 3.14159);
    float rk = (1.0 - far * 0.8) * (1.0 - smoothstep(0.4, 1.2, fwidth(rx)));
    // each ripple's lee a shade darker, its crest catching the light
    vec3 c = mix(uGroundB, uGroundA, 0.55 + 0.45 * rip * rk);
    c *= 0.92 + 0.16 * n2;
    float edgeN = (n1 - 0.5) * 2.0 + (n2 - 0.5) * 0.8;
    float bed = smoothstep(4.6, 8.0, abs(p.x) + edgeN);
    float grassP = smoothstep(0.5, 0.62, texture2D(uNoise, p * 0.09375 + 0.53).g);
    float blade = texture2D(uNoise, vec2(p.x * 2.5, p.y * 0.375) + 0.21).g;
    vec3 seabed = uGroundC * (0.75 + 0.45 * n2);
    vec3 grass = mix(vec3(0.16, 0.34, 0.18), vec3(0.42, 0.6, 0.28), blade);
    seabed = mix(seabed, grass, max(grassP, 0.35) * (0.55 + 0.45 * blade) * (1.0 - far * 0.5));
    c = mix(c, seabed, bed);
    // shells and pebbles, pale on the dark and dark on the pale
    vec2 sq = p / 0.62;
    vec2 sc = floor(sq);
    float sh = hash12(sc + 19.0);
    vec2 so = vec2(hash12(sc + 2.3), hash12(sc + 6.1)) * 0.6 + 0.2;
    vec2 sd = (fract(sq) - so) * vec2(1.0, 1.0 + hash12(sc + 4.7) * 0.8);
    float sr = 0.06 + 0.07 * hash12(sc + 8.2);
    float sfa = fwidth(sq.x) + 0.02;
    float pebble = (1.0 - smoothstep(sr - sfa, sr + sfa, length(sd))) * step(0.86, sh) * (1.0 - far);
    vec3 pc = sh > 0.95 ? vec3(0.98, 0.9, 0.84) : sh > 0.91 ? vec3(0.95, 0.72, 0.62) : mix(uGroundC, vec3(0.5, 0.5, 0.48), 0.5);
    c = mix(c, pc, pebble);
    // and the odd starfish
    vec2 fq = p / 2.6;
    vec2 fc = floor(fq);
    float fh = hash12(fc + 71.0);
    vec2 fo = (fract(fq) - vec2(hash12(fc + 3.3), hash12(fc + 5.9)) * 0.6 - 0.2) * 2.6;
    float fr = length(fo);
    float fang = atan(fo.y, fo.x) + fh * 6.2831;
    float arm = 0.08 + 0.18 * pow(0.5 + 0.5 * cos(fang * 5.0), 2.0);
    float ffa = fwidth(fq.x) * 2.6 + 0.01;
    float star = (1.0 - smoothstep(arm - ffa, arm + ffa, fr)) * step(0.95, fh) * (1.0 - far);
    vec3 starC = fh > 0.982 ? vec3(0.62, 0.36, 0.86) : vec3(1.0, 0.5, 0.32);
    c = mix(c, starC * (0.8 + 0.4 * clamp(1.0 - fr / 0.26, 0.0, 1.0)), star);
    return mix(c, mix(uGroundA, uGroundC, bed * 0.8 + 0.1), far * 0.5);
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
  #ifdef CRUST
    vec3 an = abs(n);
    an /= an.x + an.y + an.z;
    vec3 cp = vPos * uCrust.z;
    float c1 = tri(cp, an);
    float c2 = tri(cp * 3.0 + 0.37, an);
    float c3 = tri(cp * 8.0 + 0.71, an);
    float vein = 0.0;
    float glass = 0.0;
    if (vFx.y > 0.5) {
      // (what glows of itself is left as it is)
    } else if (vFx.x < 0.25) {
      // basalt: pitted and mottled, laid down in faint strata, split by
      // cracks with fire glowing deep in them
      base *= 0.68 + 0.5 * c2 + 0.3 * (c3 - 0.5);
      float strata = smoothstep(0.72, 0.95, sin(vPos.y * 9.0 + c1 * 7.0) * 0.5 + 0.5);
      base *= 1.0 - strata * 0.35;
      float cw = fwidth(c1) * 1.2 + 0.004;
      vein = (1.0 - smoothstep(0.005, 0.005 + cw, abs(c1 - 0.5 + (c3 - 0.5) * 0.04))) * smoothstep(0.38, 0.6, c2);
    } else if (vFx.x < 0.75) {
      // charred wood: split along the grain into blocks (alligatored), each
      // block a little domed and sooty, embers glowing in the splits
      vec2 uvp = an.z > max(an.x, an.y) ? vPos.xy : (an.y > an.x ? vPos.xz : vPos.zy);
      vec2 gq = uvp * vec2(3.5, 7.0) + vec2(c2, c1) * 0.9;
      gq.x += hash12(vec2(floor(gq.y), 3.0)) * 0.7;
      vec2 cell = floor(gq);
      vec2 f = fract(gq);
      float edge = min(min(f.x, 1.0 - f.x) * 0.5, min(f.y, 1.0 - f.y));
      float fw = fwidth(gq.y) * 0.6 + 0.01;
      float split = 1.0 - smoothstep(0.03, 0.05 + fw, edge);
      base *= (0.7 + 0.45 * hash12(cell + 7.0)) * (0.72 + 0.45 * smoothstep(0.02, 0.3, edge));
      base *= 1.0 - split * 0.6;
      vein = split * smoothstep(0.42, 0.62, c2);
    } else {
      // obsidian: black glass, rippled where it broke away in shells, with
      // sharp glints and the fire reflected faintly in it
      float shell = sin(c1 * 46.0 + c2 * 9.0) * 0.5 + 0.5;
      base *= 0.75 + 0.5 * shell * c2;
      glass = 1.0;
      float cw = fwidth(c2) * 1.2 + 0.003;
      vein = (1.0 - smoothstep(0.003, 0.003 + cw, abs(c2 - 0.5))) * 0.6 * smoothstep(0.45, 0.6, c1);
    }
    // ash settled on whatever faces up
    float ashTop = smoothstep(0.5, 0.85, n.y + (c2 - 0.5) * 0.7) * uCrust.y * step(vFx.y, 0.5);
    base = mix(base, vec3(0.62, 0.59, 0.56) * (0.85 + 0.3 * c3), ashTop);
    vein *= (1.0 - ashTop) * uCrust.x;
  #else
    #ifdef BARK
      if (abs(vFx.x - 0.4) < 0.02) {
        base *= barkTex(vUv);
      } else if (abs(vFx.x - 0.3) < 0.02) {
        base *= endGrain(vUv);
      } else {
        float m = texture2D(uMarks, vUv * uMarkRepeat).a * vFx.x;
        base = mix(base, base * 0.64, m);
      }
    #elif defined(PLEATS)
      if (abs(vFx.x - 0.6) < 0.02) {
        base *= pleats(vUv);
      } else {
        float m = texture2D(uMarks, vUv * uMarkRepeat).a * vFx.x;
        base = mix(base, base * 0.64, m);
      }
    #else
      float m = texture2D(uMarks, vUv * uMarkRepeat).a * vFx.x;
      base = mix(base, base * 0.64, m);
    #endif
  #endif

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
  // under the sea, the caustics' net of light over everything facing up
  shade *= 1.0 + caustic(vPos, n, dist) * (1.0 - vFx.y);
  vec3 col = mix(base * shade, base, max(vFx.y, gEmit));
  gKeep = max(gKeep, vFx.y);

  #ifdef CRUST
    if (glass > 0.0) {
      // obsidian's glints, and the fire on the horizon caught in its faces
      vec3 rf = reflect(V, n);
      float gl = pow(max(dot(rf, uLightDir), 0.0), 36.0);
      float fr = pow(1.0 - abs(dot(n, V)), 3.0);
      col += vec3(1.0, 0.9, 0.8) * gl * 0.9 + uRim.rgb * fr * 0.25;
    }
    vec3 hot = mix(vec3(1.0, 0.28, 0.03), vec3(1.0, 0.74, 0.28), c3) * (0.75 + 0.25 * sin(uTime * 2.3 + c1 * 20.0));
    col = mix(col, hot, vein);
    gKeep = max(gKeep, vein);
    gEmit = max(gEmit, vein);
  #endif

  #ifdef LAVA
    // molten rock, churning: black crust plates rafting on a flow that runs
    // from deep red through orange to white-yellow where it's hottest, the
    // seams between the plates white-hot, bubbles swelling and bursting all
    // over it; it lights itself and keeps its colour when the world drains
    vec2 lq = vUv * vec2(0.5, 0.3) + vec2(0.0, -uTime * 0.07);
    float l1 = texture2D(uNoise, lq).g;
    float l2 = texture2D(uNoise, lq * 2.3 + vec2(0.37, uTime * 0.05)).g;
    float l3 = texture2D(uNoise, lq * 5.1 + vec2(-uTime * 0.04, 0.61)).g;
    float lf = l1 * 0.62 + l2 * 0.38;
    float plate = smoothstep(0.53, 0.57, lf + (l3 - 0.5) * 0.08);
    float seam = 1.0 - smoothstep(0.0, 0.035, abs(lf + (l3 - 0.5) * 0.08 - 0.52));
    float heat = clamp(0.55 + (0.5 - lf) * 2.6 + 0.25 * sin(uTime * 2.2 + l2 * 11.0 + l3 * 5.0), 0.0, 1.0);
    vec3 flow = mix(vec3(0.55, 0.03, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.0, 0.45, heat));
    flow = mix(flow, vec3(1.0, 0.86, 0.4), smoothstep(0.6, 1.0, heat));
    vec3 crust = vec3(0.05, 0.022, 0.018) * (0.7 + 0.6 * l3);
    // faint heat still glowing through the thinnest crust
    crust += vec3(0.45, 0.06, 0.0) * smoothstep(0.6, 0.85, l3) * 0.35;
    col = mix(flow, crust, plate);
    col = mix(col, vec3(1.0, 0.95, 0.72), seam * 0.85);
    // bubbles: here and there one swells up and bursts
    vec2 bq = vUv * 0.9;
    vec2 bc = floor(bq);
    float bh = hash12(bc + 13.0);
    float bt = fract(uTime * (0.45 + bh * 0.6) + bh * 9.0);
    vec2 bo = vec2(hash12(bc + 4.4), hash12(bc + 8.8)) * 0.5 + 0.25;
    float bd = length(fract(bq) - bo);
    float br = 0.22 * bt * step(0.35, bh);
    float bring = (1.0 - smoothstep(0.0, 0.03, abs(bd - br))) * (1.0 - smoothstep(0.75, 1.0, bt));
    float bdome = (1.0 - smoothstep(0.0, br + 0.001, bd)) * (1.0 - smoothstep(0.75, 1.0, bt));
    float bpop = (1.0 - smoothstep(0.0, 0.3, bd)) * smoothstep(0.88, 0.94, bt) * (1.0 - smoothstep(0.94, 1.0, bt)) * step(0.35, bh);
    col = mix(col, vec3(1.0, 0.55, 0.08), bdome * 0.6);
    col = mix(col, vec3(1.0, 0.92, 0.6), max(bring * 0.9, bpop));
    col *= 1.1;
    gKeep = 1.0;
    gEmit = 1.0;
  #endif

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
    col += uRim.rgb * (0.45 + 0.55 * base) * rim * (1.0 - max(vFx.y, gEmit));
  #endif

  float g = texture2D(uNoise, gl_FragCoord.xy * GRAIN).r - 0.5;
  float wash = texture2D(uNoise, vPos.xz * (1.0 / 64.0)).g - 0.5;
  col *= 1.0 + g * 0.05 + wash * 0.09;

  col = atmos(col, v, dist, max(vFx.y, gEmit));
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
    #ifdef EXPLORER
      // long hair: the inside lies on the simulated surface and the outside
      // stands off it, full at the crown and thinning to the tips, in clumps
      float gv = aCape.y / (uCapeGrid.y - 1.0);
      float gu = aCape.x / (uCapeGrid.x - 1.0);
      float th = uCapeGrid.z * mix(1.5, 0.45, smoothstep(0.15, 1.0, gv)) * (0.8 + 0.2 * cos(gu * 50.0 + gv * 3.0));
      lp = P + nC * (th * (side + 1.0));
    #else
      lp = P + nC * (side * uCapeGrid.z);
    #endif
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
// wayfarer: [0]: x sock line, y boot x offset, z sleeve cuff start, w shorts
// hem; [1]: x boot collar height over the ankle, y its rise toward the heel,
// z sole height. explorer: [0]: x sock top, y shoe x offset, z where the
// sleeves bunch, w shorts hem; [1]: x shoe collar height, y its rise toward
// the heel, z sole height, w knee height; [2]: x, y the band across the
// chest, z the sweater's hem.
uniform vec4 uRig[3];
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
#define P_CAPE_HEM 20
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
#if defined(ITEMS)
// --- the things that fly out of the explorer's backpack -------------------------
// (d: x, y across the part, z which face: 1 the front, 2 the back, 0 an edge)
#define I_INK 14
#define I_RIVER 15
#define I_GREEN 16
#define I_RED 10
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  float front = step(0.5, d.z) * step(d.z, 1.5);
  if (m == 1) {
    // a page torn from her sketchbook: ruled lines, a margin, a doodled hill
    // under a sun
    c = mix(c, uPal[I_RIVER] * 1.15, lines(d.y * 13.0, 0.05) * step(0.08, d.y) * front * 0.55);
    c = mix(c, uPal[I_RED], band(d.x - 0.14, 0.004) * front * 0.7);
    vec2 g = d.xy - vec2(0.58, 0.42);
    float hill = band(g.y + 0.16 - 0.5 * abs(g.x) * (1.0 + 0.6 * sin(g.x * 9.0)), 0.006) * step(abs(g.x), 0.3);
    float sun = band(length(d.xy - vec2(0.75, 0.68)) - 0.06, 0.006);
    c = mix(c, uPal[I_INK], max(hill, sun) * front * 0.8);
  } else if (m == 2) {
    // a map: a river winding across it, woods, a dotted way to an X; folds
    float rv = d.y - 0.5 - 0.18 * sin(d.x * 7.0 + 1.0);
    c = mix(c, uPal[I_RIVER], fill(abs(rv) - 0.025) * front);
    float wood = fill(length((d.xy - vec2(0.25, 0.75)) * vec2(1.0, 1.4)) - 0.11) + fill(length((d.xy - vec2(0.8, 0.25)) * vec2(1.0, 1.5)) - 0.09);
    c = mix(c, uPal[I_GREEN], min(1.0, wood) * front * 0.85);
    float py = 0.25 + 0.5 * d.x + 0.08 * sin(d.x * 11.0);
    float path = band(d.y - py, 0.008) * step(0.5, fract(d.x * 22.0)) * step(0.08, d.x) * step(d.x, 0.82);
    c = mix(c, uPal[I_RED], path * front);
    vec2 xq = abs(d.xy - vec2(0.86, 0.68));
    c = mix(c, uPal[I_RED], band(xq.x - xq.y, 0.012) * step(max(xq.x, xq.y), 0.045) * front);
    c = mix(c, c * 0.78, band(abs(fract(d.x * 3.0 + 0.5) - 0.5), 0.012));
  } else if (m == 4) {
    // glass: pale, bright, a streak of light across it
    float k = fract(d.x * 0.8 + d.y * 0.6);
    c = mix(c, vec3(1.0), smoothstep(0.42, 0.47, k) * (1.0 - smoothstep(0.55, 0.6, k)) * 0.8);
    unlit = 0.55;
  } else if (m == 5) {
    c = mix(c, c * 0.78, lines(d.x * 9.0 + sin(d.y * 20.0) * 0.2, 0.1) * 0.6);
  } else if (m == 6) {
    // the pencil's painted sides, a darker line down each edge
    c = mix(c, c * 0.8, lines(d.x * 6.0, 0.06));
  } else if (m == 9) {
    // the compass's face: ticks round it, N, the needle (red to the north)
    vec2 q = d.xy - 0.5;
    float a = atan(q.y, q.x);
    float rr = length(q);
    c = mix(c, uPal[I_INK], band(rr - 0.4, 0.012));
    c = mix(c, uPal[I_INK], lines(a / 6.2832 * 16.0, 0.08) * step(0.33, rr) * step(rr, 0.39));
    vec2 nq = vec2(abs(q.x) * 4.0, q.y);
    float needle = step(nq.x, 0.3 - abs(q.y) * 0.9) * step(abs(q.y), 0.3);
    c = mix(c, mix(uPal[3] * 0.4, uPal[I_RED], step(0.0, q.y)), needle);
    c = mix(c, uPal[3], fill(rr - 0.04));
  } else if (m == 12) {
    // a sticking plaster: the pad in the middle, little holes either side
    c = mix(c, c * 0.88, fill(abs(d.x - 0.5) - 0.17));
    vec2 h = fract(d.xy * vec2(14.0, 4.0)) - 0.5;
    c = mix(c, c * 0.8, fill(length(h) - 0.12) * step(0.2, abs(d.x - 0.5)) * front);
  } else if (m == 13) {
    // a pressed leaf: its midrib and veins
    float mid = band(d.y - 0.5, 0.012);
    float vein = band(abs(fract((d.x + abs(d.y - 0.5) * 0.8) * 6.0) - 0.5), 0.05) * step(0.12, d.x) * step(d.x, 0.92);
    c = mix(c, c * 0.72, max(mid, vein * 0.6) * front);
  }
  return c;
}
#elif !defined(EXPLORER)
// The face, drawn on the front of the head like an illustration: big warm
// brown eyes under relaxed lids (the upper lid sits a little over the iris, so
// they read content rather than startled), a heavy upper lash line, soft
// brows resting low over them, a small easy smile and a touch of blush on the
// full cheeks. Returns the colour and how much of it ignores the light (the
// eyes glint).
vec3 drawFace(vec3 base, vec3 r, inout float unlit) {
  float front = smoothstep(-0.055, -0.08, r.z);
  if (front <= 0.0) return base;
  vec2 f = vec2(abs(r.x), r.y);
  vec3 c = base;
  vec2 E = vec2(0.041, 1.38);
  // blush, round and soft on the cheeks
  vec2 bq = (f - vec2(0.064, 1.348)) / vec2(0.021, 0.012);
  c = mix(c, uPal[P_BLUSH], 0.32 * (1.0 - smoothstep(0.4, 1.0, length(bq))) * front);
  // the eye: an almond whose upper lid is lowered into a gentle curve
  vec2 q = f - E;
  vec2 qa = vec2(q.x, q.y * (q.y > 0.0 ? 1.2 : 1.0));
  float dA = (length(qa / vec2(0.025, 0.0205)) - 1.0) * 0.0205;
  // (highest just inside the middle, easing down toward the outer corner:
  // a kind, unhurried look)
  float lid = q.y - (0.0128 - 7.0 * (q.x + 0.003) * (q.x + 0.003));
  float dS = max(dA, lid);
  float eye = fill(dS) * front;
  c = mix(c, uPal[P_EYE], eye);
  unlit = max(unlit, eye * 0.35);
  // a large iris nearly filling the opening, pupil, two catch-lights
  vec2 ic = q - vec2(-0.0015, -0.0016);
  float dI = length(ic) - 0.0168;
  c = mix(c, uPal[P_IRIS], fill(max(dI, dS)) * front);
  c = mix(c, mix(uPal[P_IRIS], uPal[P_INK], 0.45), fill(max(abs(length(ic) - 0.0146) - 0.0014, dS)) * front);
  c = mix(c, uPal[P_INK], fill(max(length(ic) - 0.0072, dS)) * front);
  float hl = fill(max(length(q - vec2(0.0042, 0.0042)) - 0.0036, dS)) * front;
  hl = max(hl, fill(max(length(q - vec2(-0.0062, -0.0068)) - 0.0016, dS)) * front * 0.8);
  c = mix(c, vec3(1.0), hl);
  unlit = max(unlit, hl);
  // the upper lash line along the lowered lid, heavier toward the outer
  // corner where it flicks out; a faint lower lid
  float onTop = step(0.0, q.y + 0.004) * step(abs(q.x), 0.0265);
  float lash = band(lid + 0.0006, 0.0011 + 0.0012 * smoothstep(-0.015, 0.02, q.x)) * onTop * step(dA, 0.0016);
  float flick = band(q.y - 0.0035 - (q.x - 0.021) * 0.35, 0.0016) * step(0.0205, q.x) * step(q.x, 0.0285);
  c = mix(c, uPal[P_INK], max(lash, flick) * front);
  float lower = band(dA, 0.0007) * step(q.y, -0.007) * step(abs(q.x), 0.017);
  c = mix(c, mix(base, uPal[P_INK], 0.5), lower * front * 0.7);
  // brows: soft, full and low, resting close over the eyes
  vec2 bc = f - vec2(0.042, 1.3905);
  bc.y += 0.08 * bc.x;
  float br = length(bc * vec2(1.0, 1.35)) - 0.0225;
  float bw = 0.0027 - 0.0012 * smoothstep(-0.01, 0.024, bc.x);
  float brow = band(br, bw) * step(0.006, bc.y) * step(-0.019, bc.x) * step(bc.x, 0.024);
  c = mix(c, mix(uPal[P_INK], uPal[2], 0.35), brow * front);
  // a small easy smile, its corners just lifting
  vec2 m = r.xy - vec2(0.0, 1.353);
  float smile = band(length(m) - 0.019, 0.0017) * step(m.y, -0.012) * step(abs(m.x), 0.0135);
  float corner = band(length(vec2(abs(m.x) - 0.0148, m.y + 0.0118)) - 0.0028, 0.0011) * step(abs(m.x), 0.0168) * step(0.0128, abs(m.x)) * step(-0.0124, m.y);
  c = mix(c, uPal[P_MOUTH], max(smile, corner * 0.8) * front);
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
    c = mix(c, mix(uPal[10], uPal[P_CAPE_HEM], 0.12), smoothstep(1.2, 1.08, r.y));
    c = mix(c, uPal[P_LINING], d.w);
    c = mix(c, c * 0.84, band(d.x, 0.03) * d.z * step(0.02, d.y));
    c = mix(c, c * 0.7, band(d.y - 0.0045, 0.0013) * d.z);
  } else if (m == 10) {
    // the cape (u, v across and down; w: the lining side): light orange at
    // the collar deepening toward the hem, the lining a burnt orange
    float v = smoothstep(0.0, 1.0, d.y);
    c = mix(c, uPal[P_CAPE_HEM], v * (0.75 + 0.25 * v));
    c = mix(c, mix(uPal[P_LINING], uPal[P_LINING] * 0.78, v), step(0.5, d.w));
  } else if (m == 11) {
    c = mix(c, uPal[P_FLAP], step(0.5, d.x));
  }
  return c;
}
#else
// --- the explorer -------------------------------------------------------------
#define E_STRIPE 13
#define E_RIB 14
#define E_SOCK 15
#define E_PANEL 16
#define E_SOLE 17
#define E_SOLE_LINE 18
#define E_LACE 19
#define E_HAIR_DEEP 20
#define E_HAIR_IN 21
#define E_EYE 22
#define E_IRIS 23
#define E_INK 24
#define E_MOUTH 25
#define E_BLUSH 26
#define E_IRIS_IN 27
#define E_SEAM 28
#define E_ZIP 29
#define E_PLASTER 31
// Her face, drawn on the front of the head: huge round eyes, green with a
// gold ring round the pupil and two catch-lights, under a heavy upper lash
// line that flicks out at the corner; thick dark brows a little raised in the
// middle (earnest, a touch worried); a tiny nose, a small mouth and a hint of
// blush. (r: the rest position, the head being sculpted where it sits.)
vec3 drawFace(vec3 base, vec3 r, inout float unlit) {
  float front = smoothstep(-0.05, -0.08, r.z);
  if (front <= 0.0) return base;
  vec2 f = vec2(abs(r.x), r.y);
  vec3 c = base;
  // blush
  vec2 bq = (f - vec2(0.063, 1.236)) / vec2(0.02, 0.011);
  c = mix(c, uPal[E_BLUSH], 0.28 * (1.0 - smoothstep(0.3, 1.0, length(bq))) * front);
  // the eye: a tall, round opening, its top a little flattened by the lid
  vec2 E = vec2(0.046, 1.267);
  vec2 q = f - E;
  float lidY = 0.0245 - 2.0 * (q.x + 0.002) * (q.x + 0.002);
  float dA = (length(q / vec2(0.0285, 0.0315)) - 1.0) * 0.029;
  float dS = max(dA, q.y - lidY);
  float eye = fill(dS) * front;
  c = mix(c, uPal[E_EYE], eye);
  unlit = max(unlit, eye * 0.4);
  // iris: green, a gold ring round the pupil, a dark rim
  vec2 ic = q - vec2(-0.0012, -0.0008);
  float ir = length(ic);
  float iris = fill(max(ir - 0.0222, dS)) * front;
  c = mix(c, uPal[E_IRIS], iris);
  c = mix(c, mix(uPal[E_IRIS], uPal[E_INK], 0.55), fill(max(abs(ir - 0.0203) - 0.002, dS)) * front);
  c = mix(c, uPal[E_IRIS_IN], fill(max(ir - 0.0128, dS)) * front * 0.9);
  c = mix(c, uPal[E_INK], fill(max(ir - 0.0078, dS)) * front);
  // catch-lights
  float hl = fill(max(length(q - vec2(-0.0068, 0.0085)) - 0.0055, dS)) * front;
  hl = max(hl, fill(max(length(q - vec2(0.0075, -0.0085)) - 0.0025, dS)) * front * 0.85);
  c = mix(c, vec3(1.0), hl);
  unlit = max(unlit, hl);
  // the upper lash line: heavy along the lid, flicking out past the corner
  float onTop = step(0.0, q.y) * step(abs(q.x), 0.0305);
  float lash = band(q.y - lidY - 0.0009, 0.002 + 0.0013 * smoothstep(-0.01, 0.027, q.x)) * onTop;
  lash = max(lash, band(dA + 0.0009, 0.0018) * step(0.005, q.y) * step(abs(q.x), 0.029));
  float flick = band(q.y - 0.019 - (q.x - 0.027) * 0.55, 0.0019) * step(0.025, q.x) * step(q.x, 0.037);
  c = mix(c, uPal[E_INK], max(lash, flick) * front);
  // a fine lower lash line, and a soft crease over the lid
  float lower = band(dA, 0.0008) * step(q.y, -0.014) * step(abs(q.x), 0.021);
  c = mix(c, mix(base, uPal[E_INK], 0.55), lower * front);
  float crease = band(length((q - vec2(0.0, -0.004)) / vec2(0.032, 0.037)) - 1.0, 0.035) * step(0.014, q.y) * step(abs(q.x), 0.024);
  c = mix(c, mix(base, uPal[E_MOUTH], 0.35), crease * front * 0.5);
  // brows: thick and dark, lifting a little toward the middle
  vec2 bc = f - vec2(0.048, 1.323);
  float by = bc.y + 0.12 * bc.x + 2.0 * bc.x * bc.x;
  float bw = 0.0048 - 0.0018 * smoothstep(-0.01, 0.028, bc.x);
  float brow = band(by, bw) * step(-0.024, bc.x) * step(bc.x, 0.029);
  c = mix(c, mix(uPal[E_INK], uPal[2], 0.2), brow * front);
  // nose: a small hook of line
  vec2 nq = r.xy - vec2(0.0, 1.252);
  float nose = band(length(nq - vec2(0.003, 0.004)) - 0.005, 0.0008) * step(nq.y, 0.003) * step(-0.0005, nq.x);
  c = mix(c, mix(base, uPal[E_MOUTH], 0.7), nose * front * 0.8);
  // mouth: small and closed, a short line with a shade under the lower lip
  vec2 m = r.xy - vec2(0.0, 1.214);
  float mouth = band(m.y + 18.0 * m.x * m.x - 0.0006, 0.0011) * step(abs(m.x), 0.0085);
  c = mix(c, uPal[E_MOUTH], mouth * front);
  float lip = band(length(m / vec2(1.0, 0.6) + vec2(0.0, 0.0065)) - 0.006, 0.0012) * step(m.y, -0.002);
  c = mix(c, mix(base, uPal[E_MOUTH], 0.4), lip * front * 0.6);
  return c;
}
// Strands drawn along a lock: a few darker lines that wander a little.
float strands(float u, float v, float k) {
  float s = u * k + 0.35 * sin(v * 7.0 + u * 13.0);
  return lines(s, 0.07) * smoothstep(0.02, 0.18, v);
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 1) {
    c = drawFace(base, d.xyz, unlit);
  } else if (m == 3) {
    // the sweater: rose knit, a peach band across the chest (and round the
    // upper sleeves), ribbed collar and hem, the shoved-up sleeves bunched
    // in rolls of rib (d: x rib, z on the body, w down the arm)
    float torso = d.z;
    float stripeT = fill(abs(r.y - 0.5 * (uRig[2].x + uRig[2].y)) - 0.5 * (uRig[2].y - uRig[2].x));
    float stripeS = fill(abs(d.w - 0.118) - 0.022);
    c = mix(c, uPal[E_STRIPE], mix(stripeS, stripeT, torso));
    float cuff = smoothstep(uRig[0].z - 0.035, uRig[0].z - 0.025, d.w) * (1.0 - torso);
    float rib = max(d.x, cuff);
    c = mix(c, uPal[E_RIB], rib * 0.85);
    float ribLines = lines(atan(r.z, r.x) * 30.0, 0.18) * d.x + lines(atan(r.z, abs(r.x) - 0.2) * 22.0, 0.16) * cuff;
    c = mix(c, uPal[E_RIB] * 0.85, ribLines * 0.5);
  } else if (m == 5) {
    // shorts: the rolled hem, a side seam, the front pockets' openings
    c = mix(c, uPal[E_SEAM], band(r.y - uRig[0].w - 0.016, 0.0014));
    float side = abs(r.x);
    c = mix(c, uPal[E_SEAM], band(r.z - 0.006 + (side - 0.12) * 0.0, 0.0012) * step(0.1, side) * 0.6);
    vec2 pk = vec2(side - 0.05, r.y - 0.79);
    float pocket = band(length(pk / vec2(1.0, 1.3)) - 0.06, 0.0014) * step(r.z, -0.02) * step(pk.x, 0.06) * step(pk.y, 0.0);
    c = mix(c, uPal[E_SEAM], pocket * 0.8);
  } else if (m == 6) {
    // legs: pink socks slouched round the ankles, folds between their
    // rolls; a plaster on her right knee
    float sock = fill(r.y - (uRig[0].x + 0.003 * sin(atan(r.z, r.x) * 5.0)));
    c = mix(c, uPal[E_SOCK], sock);
    c = mix(c, uPal[E_SOCK] * 0.8, lines(r.y / 0.025 + 0.3, 0.06) * sock * step(0.13, r.y));
    vec2 kq = vec2(r.x - 0.069, r.y - uRig[1].w + 0.01);
    float ca = 0.866, sa = 0.5;
    kq = vec2(ca * kq.x - sa * kq.y, sa * kq.x + ca * kq.y);
    float knee = step(0.0, r.x) * smoothstep(-0.01, -0.025, r.z);
    vec2 kb = abs(kq) - vec2(0.022, 0.0075);
    float plaster = fill(length(max(kb, 0.0)) + min(max(kb.x, kb.y), 0.0) - 0.004) * knee;
    c = mix(c, uPal[E_PLASTER], plaster);
    float pad = fill(max(abs(kq.x) - 0.0075, abs(kq.y) - 0.0072)) * knee;
    c = mix(c, uPal[E_PLASTER] * 0.86, pad);
  } else if (m == 7) {
    // chunky trainers: thick cream soles striped grey low down, grey panels
    // down the sides and round the heel, grey laces over the tongue
    float side = r.x < 0.0 ? -1.0 : 1.0;
    float x = r.x - side * uRig[0].y;
    float y = r.y - 0.026 * pow(smoothstep(-0.07, -0.18, r.z), 2.0);
    float heel = fill(0.03 - r.z + max(0.0, y - 0.11) * 0.8) * step(uRig[1].z, y);
    float swoosh = fill(abs(y - 0.078 - (r.z + 0.03) * 0.3) - 0.011) * step(0.033, abs(x)) * step(-0.11, r.z) * step(r.z, 0.035);
    float toe = fill(r.z + 0.15 + max(0.0, y - 0.062) * 0.6) * step(uRig[1].z, y);
    c = mix(c, uPal[E_PANEL], max(max(heel, swoosh), toe * 0.85));
    c = mix(c, uPal[E_SOLE], fill(y - uRig[1].z));
    c = mix(c, uPal[E_SOLE_LINE], fill(y - 0.012) * 0.9);
    c = mix(c, uPal[E_SOLE_LINE], band(y - uRig[1].z, 0.0012) * 0.7);
    float collar = uRig[1].x + uRig[1].y * r.z;
    float onTongue = step(r.z, -0.07 + (r.y - 0.085) * 0.7) * step(abs(x), 0.024) * step(0.085, r.y) * step(r.y, collar + 0.012);
    float lace = max(band(abs(fract((r.y + x * 0.9) / 0.02 + 0.5) - 0.5), 0.12), band(abs(fract((r.y - x * 0.9) / 0.02 + 0.5) - 0.5), 0.12));
    c = mix(c, uPal[E_LACE], lace * onTongue * step(abs(x), 0.02));
  } else if (m == 9) {
    // the backpack: zips round the lid and the front pocket, a mesh
    // bottle pocket, the dark inside under the lid (d: x lid, y pocket,
    // z bottle pocket, w the opening)
    c = mix(c, c * 1.08, d.x);
    c = mix(c, uPal[E_ZIP], band(d.x - 0.5, 0.08) * 0.9);
    c = mix(c, uPal[E_ZIP], band(d.y - 0.5, 0.08) * 0.9);
    float mesh = max(lines((r.y + r.z) * 90.0, 0.12), lines((r.y - r.z) * 90.0, 0.12));
    c = mix(c, uPal[E_ZIP], mesh * smoothstep(0.4, 0.7, d.z) * 0.6);
    c = mix(c, uPal[E_ZIP] * 0.45, d.w);
  } else if (m == 11) {
    // the sketchbook: sage covers, a doodle of a little cat on the front,
    // cream pages showing at the edges (d: x across, y down, z out of the
    // cover, w the spiral)
    float cover = smoothstep(0.55, 0.8, abs(d.z));
    c = mix(uPal[E_EYE] * 0.95, c, cover);
    c = mix(c, uPal[E_EYE] * 0.8, lines(d.z * 6.0, 0.12) * (1.0 - cover) * 0.6);
    vec2 g = vec2(d.x * 0.068, d.y * 0.184 - 0.1);
    float head = band(length(g / vec2(1.0, 0.85)) - 0.026, 0.0012);
    float ears = band(abs(abs(g.x) - 0.016) + (g.y + 0.026) * 0.5 - 0.008, 0.0012) * step(g.y, -0.012) * step(-0.034, g.y);
    float eyes = fill(length(vec2(abs(g.x) - 0.009, g.y + 0.002)) - 0.0028);
    float doodle = max(max(head, ears), eyes) * step(0.8, d.z);
    c = mix(c, c * 0.62, doodle);
  } else if (m == 12) {
    // webbing straps, a ridge down them; plastic buckles a shade lighter
    c = mix(c, c * 1.3, d.x);
  } else if (m == 10) {
    // the long hair (d: x across, y down, w the inside): strands down its
    // length, deeper toward the tips and on the inside
    c = mix(c, uPal[E_HAIR_DEEP], strands(d.x, d.y, 26.0) * 0.45);
    c = mix(c, uPal[E_HAIR_DEEP], smoothstep(0.55, 1.0, d.y) * 0.25);
    c = mix(c, uPal[E_HAIR_IN], step(0.5, d.w) * 0.8);
  }
  return c;
}
// The long hair parts into pointed locks toward its ends: > 0 past a lock's
// edge (d.x across the sheet, d.y down it).
float hairCut(vec4 d) {
  float n = 11.0;
  float k = d.x * n;
  float i = floor(k);
  float h = fract(sin(i * 12.9898 + 4.1) * 43758.5453);
  float x = abs(fract(k) - 0.5) * 2.0;
  float end = 0.985 - 0.09 * h;
  float depth = 0.16 + 0.1 * fract(h * 7.31);
  return d.y - (end - depth * pow(x, 1.4));
}
#endif
`;

const FS_CHAR = FS_HEAD + CHAR_DETAIL + /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uShadowTint;
uniform vec4 uRim;
uniform sampler2D uNoise;
` + CAUSTIC + /* glsl */ `
void main() {
  int m = int(vMat + 0.5);
  float unlit = 0.0;
  #if defined(EXPLORER) && !defined(ITEMS)
    #ifdef CAPE
      // (the long hair's ends part into locks; a dark edge where they do)
      float cut = hairCut(vD);
      if (cut > 0.0) discard;
    #endif
    // (her hair burns on through a drain, as his cape does)
    gKeep = (m == 2 || m == 10) ? 1.0 : 0.0;
  #else
    gKeep = (m == 9 || m == 10) ? 1.0 : 0.0;
  #endif
  vec3 base = charDetail(m, uPal[m], vRest, vD, unlit);
  #if defined(EXPLORER) && defined(CAPE)
    base = mix(base, uPal[m] * 0.32, smoothstep(-0.016, -0.003, cut) * 0.85);
  #endif
  vec3 n = normalize(vNormal);
  n = gl_FrontFacing ? n : -n;
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  vec3 V = v / dist;
  // one broad, crisp shadow shape (softer on the cape, so its folds shade in
  // soft gradients like the cloth they are)
  #ifdef EXPLORER
    float soft = m == 10 ? 0.12 : m == 2 ? 0.07 : m == 3 ? 0.06 : 0.045;
  #else
    float soft = m == 10 ? 0.16 : m == 9 ? 0.09 : 0.045;
  #endif
  float lit = smoothstep(-soft, soft, dot(n, uLightDir) + 0.15);
  vec3 sh = mix(vec3(0.84, 0.75, 0.8), uShadowTint, 0.35);
  vec3 col = base * mix(sh, vec3(1.0), max(lit, unlit));
  if (m == 10) {
    // the cape's folds and waves keep a soft shadow in their valleys, under
    // any light (as a painter would shade them)
    float fold = smoothstep(0.8, 4.0, vFx.x) - 0.25 * smoothstep(1.0, 5.0, -vFx.x);
    col *= mix(vec3(1.0), mix(sh, vec3(1.0), 0.3), clamp(fold, -0.3, 1.0) * 0.7);
  }
  #ifdef EXPLORER
  if (m == 2 || m == 10) {
  #else
  if (m == 2) {
  #endif
    // one restrained lighter tone where the curls face the light from above
    float hl = smoothstep(0.58, 0.64, dot(n, uLightDir)) * smoothstep(0.25, 0.5, n.y);
    col = mix(col, uPal[30], hl * 0.8);
  }
  float fres = 1.0 - abs(dot(n, V));
  float back = clamp(dot(uLightDir, V) * 0.6 + 0.4, 0.0, 1.0);
  float rim = smoothstep(1.0 - uRim.w, 1.0 - uRim.w * 0.55, fres) * back * (1.0 - smoothstep(0.5, 0.9, n.y));
  col += uRim.rgb * base * rim * 0.45 * (1.0 - unlit);
  // under the sea, the caustics play over the runner too
  col *= 1.0 + caustic(vPos, n, dist) * 0.8 * (1.0 - unlit);
  col *= 1.0 + (texture2D(uNoise, gl_FragCoord.xy * GRAIN).r - 0.5) * 0.035;
  col = atmos(col, v, dist, 0.0);
  gl_FragColor = vec4(grade(col, uTrip), 1.0);
}
`;

const FS_CHAR_INK = FS_HEAD + CHAR_DETAIL + /* glsl */ `
void main() {
  int m = int(vMat + 0.5);
  #if defined(EXPLORER) && !defined(ITEMS)
    #ifdef CAPE
      if (hairCut(vD) > 0.0) discard;
    #endif
    gKeep = (m == 2 || m == 10) ? 1.0 : 0.0;
  #else
    gKeep = (m == 9 || m == 10) ? 1.0 : 0.0;
  #endif
  vec3 ink = uPal[m] * 0.3;
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
#ifdef CROSS
// the shadow of something swimming across the run, gliding with it (see
// CROSS in the object shader)
uniform vec4 uCross;
uniform vec3 uGemAt;
attribute vec4 aInst;
#endif
varying vec2 vUv;
varying float vFade;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec3 lp = position;
  #ifdef CROSS
    float crossDir = aInst.x > 3.14159 ? -1.0 : 1.0;
    lp.xz *= crossDir;
  #endif
  vec3 wp = (M * vec4(lp, 1.0)).xyz;
  vec3 pivot = M[3].xyz;
  #ifdef CROSS
    wp.x -= (uGemAt.z - pivot.z) * uCross.x * crossDir;
  #endif
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

// Additive pool of light on the ground under a lamp (or round a fire).
const FS_POOL = /* glsl */ `
uniform vec3 uPool;
uniform float uTime;
varying vec2 vUv;
varying float vFade;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 1.6);
  #ifdef FLICKER
    a *= 0.82 + 0.1 * sin(uTime * 9.0) + 0.08 * sin(uTime * 23.0 + 1.3);
  #endif
  gl_FragColor = vec4(uPool * a * vFade, 1.0);
}
`;

// --- Sky dome ---------------------------------------------------------------
// (drawn after everything opaque, on the far plane: the depth test then
// leaves it only the pixels nothing else covered, instead of shading the
// whole screen and painting the world over it)
const VS_SKY = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w * 0.99999;
}
`;
const FS_SKY = /* glsl */ `
uniform float uTime;
uniform vec4 uSkyFx2; // x sun rays, y cloud bands, z aurora, w planet ring (moon drawn full)
// a total eclipse in place of the sun (env.eclipse): x how much, y how bright
// its ring of fire burns, z the corona's reach
uniform vec4 uEclipse;
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
// Everything in the sky behind the sun: its gradient, the moon, stars, rays,
// clouds, smoke and lightning, aurora.
vec3 skyBack(vec3 d) {
  vec3 c = skyColor(d);
  float sd = dot(d, uSunDir);
  if (uEclipse.x <= 0.0) {
    float sun = smoothstep(uSkyFx.y - 0.00012, uSkyFx.y + 0.00012, sd);
    c = mix(c, uSunDisc, sun);
  }
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
  if (uSkyFx.w > 0.0) {
    // a ceiling of smoke rolling over the sky, lit from beneath by the fires
    // on the horizon and opening onto a band of glow just above it; dry
    // lightning flickers inside it and, now and then, forks down to the plain
    vec2 sp = d.xz / (d.y + 0.12) * 0.11 + vec2(uTime * 0.004, -uTime * 0.012);
    float s1 = texture2D(uNoise, sp).g;
    float s2 = texture2D(uNoise, sp * 2.0 + vec2(0.31 + uTime * 0.003, 0.0)).g;
    float s3 = texture2D(uNoise, sp * 4.0 + 0.67).g;
    float sn = s1 * 0.55 + s2 * 0.3 + s3 * 0.15;
    float cover = smoothstep(0.3, 0.6, sn) * smoothstep(0.02, 0.22, d.y);
    float low = 1.0 - smoothstep(0.03, 0.4, d.y);
    vec3 smoke = vec3(0.05, 0.035, 0.032) * (0.6 + 1.6 * smoothstep(0.4, 0.85, s2) + 0.8 * s3);
    smoke += (uSunColor * 0.5 + uSkyHorizon * 0.35) * low * (1.0 - smoothstep(0.35, 0.75, sn));
    c = mix(c, smoke, cover * min(uSkyFx.w, 1.0) * (1.0 - 0.55 * uEclipse.x * pow(max(sd, 0.0), 90.0)));
    vec4 L = lightning();
    if (L.x > 0.0) {
      float daz = az - L.y;
      float dz = d.y - L.z;
      float glow = exp(-daz * daz * 5.0 - dz * dz * 12.0);
      c += vec3(0.75, 0.72, 0.85) * L.x * (glow * (0.35 + 0.9 * cover) + 0.06);
      // the bolt forks down out of the smoke
      float bx = L.y + (texture2D(uNoise, vec2(d.y * 2.2, L.w * 0.137)).g - 0.5) * 0.4 + (texture2D(uNoise, vec2(d.y * 9.0, L.w * 0.291)).g - 0.5) * 0.09;
      float aa = fwidth(az) * 1.5 + 0.0004;
      float bolt = (1.0 - smoothstep(0.0012, 0.0012 + aa, abs(az - bx))) * step(d.y, L.z) * step(-0.01, d.y);
      c = mix(c, vec3(0.96, 0.94, 1.0), bolt * smoothstep(0.3, 0.6, L.x));
    }
  }
  if (uSkyFx2.z > 0.0) {
    // aurora curtains
    float wv = sin(az * 3.0 + sin(az * 7.0 + uTime * 0.21) * 0.8 + uTime * 0.05);
    float curtain = smoothstep(0.55, 1.0, wv * 0.5 + 0.5) * smoothstep(0.12, 0.3, d.y) * (1.0 - smoothstep(0.45, 0.8, d.y));
    float streak = 0.6 + 0.4 * texture2D(uNoise, vec2(az * 6.0, uTime * 0.01)).g;
    vec3 ac = mix(vec3(0.25, 1.0, 0.65), vec3(0.85, 0.35, 0.95), smoothstep(0.2, 0.5, d.y));
    c += ac * curtain * streak * uSkyFx2.z;
  }
  if (uSea.x > 0.0 && d.y > 0.0) {
    // Under the sea, the sky is the underside of the surface, far overhead:
    // a ceiling of light, rippling, its swells drawn in bright wavering
    // lines, brightest round the sun (the window the light comes in by) and
    // sinking into the murk toward the horizon.
    vec2 sp = d.xz / (d.y + 0.08) * 0.05;
    float s1 = texture2D(uNoise, sp + vec2(uTime * 0.006, uTime * 0.004)).g;
    float s2 = texture2D(uNoise, sp * 2.3 + vec2(0.31 - uTime * 0.008, uTime * 0.005)).g;
    float sw = s1 * 0.65 + s2 * 0.45;
    float lw = abs(sw - 0.55);
    float lines = 1.0 - smoothstep(0.0, 0.025 + fwidth(sw) * 1.5, lw);
    float hi = smoothstep(0.08, 0.55, d.y);
    float win = pow(max(sd, 0.0), 3.0);
    vec3 surf = mix(uSkyTop, vec3(1.0), 0.25 + 0.3 * win);
    c = mix(c, surf, hi * (0.2 + 0.35 * smoothstep(0.4, 0.7, sw)) * uSea.x);
    c += mix(uSkyTop, uSunColor, 0.6) * lines * hi * uSea.x * (0.25 + 0.75 * win);
    c += uSunColor * pow(max(sd, 0.0), 12.0) * 0.5 * uSea.x;
  }
  if (uSea.y > 0.0) {
    // shafts of light slanting down out of the surface, fanning out from the
    // sun and reaching far down toward the horizon, drifting slowly
    vec3 rt = normalize(cross(uSunDir, vec3(0.0, 0.0, 1.0)) + vec3(0.0, 1e-4, 0.0));
    vec3 upv = cross(rt, uSunDir);
    float ang = atan(dot(d, upv), dot(d, rt));
    float r1 = texture2D(uNoise, vec2(ang * 0.7 + uTime * 0.006, 0.17)).g;
    float r2 = texture2D(uNoise, vec2(ang * 1.9 - uTime * 0.009, 0.59)).g;
    float rays = smoothstep(0.45, 0.8, r1 * 0.6 + r2 * 0.5);
    float reach = smoothstep(-0.3, 0.85, sd) * smoothstep(-0.25, 0.12, d.y);
    c += mix(uSunColor, vec3(1.0), 0.3) * rays * reach * reach * 0.35 * uSea.y;
  }
  return c;
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
  vec3 c = skyBack(d);
  if (uEclipse.x > 0.0 && dot(d, uSunDir) > 0.95) {
    // A total eclipse, the sun gone black: a ring of fire hugs the rim of the
    // disc where the last of the light spills past it, hottest at its inner
    // edge, tongues of flame licking off it and flickering; round it a short
    // corona streams out in flickering wisps. All of it burns, so it keeps its
    // colour when the world drains.
    vec3 rt = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 upv = cross(rt, uSunDir);
    vec2 pq = vec2(dot(d, rt), dot(d, upv));
    float R = sqrt(max(1.0 - uSkyFx.y * uSkyFx.y, 1e-6));
    float x = length(pq) / R; // in disc radii
    float ang = atan(pq.y, pq.x);
    float spin = uTime * 0.12;
    // the corona: wisps of fire streaming a little way out of the rim
    float st = texture2D(uNoise, vec2(ang * 0.48 + spin * 0.2, x * 0.05 - uTime * 0.02)).g;
    float st2 = texture2D(uNoise, vec2(ang * 1.27 - spin * 0.3, x * 0.11 + 0.37)).g;
    float streamers = smoothstep(0.35, 0.85, st * 0.6 + st2 * 0.5);
    float out1 = max(x - 1.0, 0.0);
    float reach = max(uEclipse.z, 0.2);
    float corona = exp(-out1 * (3.4 / reach)) * (0.35 + 0.9 * streamers) * step(1.0, x);
    corona += exp(-out1 * 1.6 / reach) * 0.1 * streamers;
    vec3 coronaCol = mix(vec3(0.6, 0.06, 0.02), vec3(1.0, 0.45, 0.1), exp(-out1 * 2.5));
    c += coronaCol * corona * uEclipse.x;
    // the ring of fire: flames licking off the rim, flickering
    float lick = texture2D(uNoise, vec2(ang * 0.95 + spin * 0.6, uTime * 0.05)).g;
    float flick = 0.82 + 0.18 * sin(ang * 13.0 + uTime * 3.1) * sin(ang * 7.0 - uTime * 2.3);
    float w = 0.06 + 0.08 * smoothstep(0.35, 0.8, lick);
    float ring = exp(-pow(max(x - 1.0, 0.0) / w, 2.0) - pow(min(x - 1.0, 0.0) / 0.012, 2.0)) * flick;
    vec3 ringCol = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.86, 0.55), exp(-pow((x - 1.0) / 0.035, 2.0)));
    c += ringCol * ring * 1.8 * uEclipse.y * uEclipse.x;
    // the black disc itself
    float hole = 1.0 - smoothstep(0.985, 1.0, x);
    c = mix(c, vec3(0.0), hole * uEclipse.x);
    gKeep = max(gKeep, min(1.0, max(ring * 1.3, corona * 1.6)) * (1.0 - hole));
  }
  if (sw > 0.0) {
    float az = atan(d.x, -d.z);
    c = hueRot(c, sw * 1.3 * sin(az * 3.0 + d.y * 9.0 + uTime * 0.35));
  }
  c += (texture2D(uNoise, gl_FragCoord.xy * GRAIN).r - 0.5) * 0.02;
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
// 0 a soft mote; 1 a bubble: a bright rim round a clear middle and a glint
// up on one side (env.particles.ring)
uniform float uRing;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  float a = smoothstep(0.5, 0.1, r);
  if (uRing > 0.0) {
    float rim = smoothstep(0.5, 0.4, r) * smoothstep(0.22, 0.42, r);
    float glint = smoothstep(0.13, 0.03, length(c - vec2(-0.14, -0.14)));
    a = mix(a, rim * 0.85 + 0.12 * smoothstep(0.5, 0.3, r) + glint, uRing);
  }
  a *= vAlpha * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

// ---------------------------------------------------------------------------
// Dust kicked up off the road (the explorer's slide): puffs that bloom and
// thin out like painted clouds - a lumpy edge, lit from above, the colour of
// the road they came off - and specks of grit flung up with them. Positions
// are written by the CPU (a few dozen at most); lit, fogged and graded like
// the world around them, so they drain to grey in Hell with everything else.
// ---------------------------------------------------------------------------
const VS_DUST = COMMON + /* glsl */ `
uniform vec2 uResolution;
attribute vec4 aDust; // x size (m), y opacity, z 1 for grit, w seed
varying vec4 vDust;
varying vec3 vWorld;
varying vec3 vPos;
void main() {
  vec3 wp = bendPos(position);
  vPos = wp;
  vWorld = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float px = aDust.x * projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.5);
  gl_PointSize = clamp(px, 1.5, 360.0);
  vDust = aDust;
  // (no giant blobs drifting across the lens)
  vDust.y *= smoothstep(1.4, 3.2, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const FS_DUST = FS_HEAD + /* glsl */ `
uniform vec3 uGroundA;
uniform vec3 uGroundB;
uniform vec3 uShadowTint;
varying vec4 vDust;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  float grit = vDust.z;
  float a = atan(c.y, c.x);
  // (the lumps stay inside the sprite, or its square would cut them off)
  float lump = (0.028 * sin(a * 5.0 + vDust.w * 6.3) + 0.016 * sin(a * 9.0 - vDust.w * 4.1)) * (1.0 - grit);
  float edge = smoothstep(mix(0.45, 0.5, grit) + lump, mix(0.36, 0.22, grit) + lump, r);
  float alpha = edge * vDust.y;
  if (alpha < 0.01) discard;
  // the road's own colour, paled with dust; lit from above, a shade beneath
  vec3 dust = mix(mix(uGroundA, uGroundB, 0.5), vec3(0.98, 0.95, 0.88), 0.62);
  float lit = smoothstep(0.2, -0.25, c.y + 0.06 * sin(a * 3.0 + vDust.w));
  vec3 sh = mix(vec3(0.84, 0.75, 0.8), uShadowTint, 0.35);
  vec3 col = dust * mix(sh, vec3(1.0), 0.35 + 0.65 * lit);
  col = mix(col, dust * 0.42, grit);
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  col = atmos(col, v, dist, 0.0);
  gl_FragColor = vec4(grade(col, uTrip), alpha);
}
`;

// ---------------------------------------------------------------------------
// Bubbles under the sea (game/bubbles.js): the ones the runner sheds as they
// run, breathe, land and slide (positions written by the CPU, a hundred at
// most), and the swirl of tiny ones the water spins round them, worked out
// here from the runner's position alone. Each a bubble: a clear middle, a
// bright rim, a darker edge where it bends the light, and a glint up on one
// side; fogged and graded like the world.
// ---------------------------------------------------------------------------
const VS_BUBBLE = COMMON + /* glsl */ `
uniform vec2 uResolution;
attribute vec4 aB; // x radius (m), y opacity, z seed
varying vec4 vB;
varying vec3 vStreak;
varying vec3 vWorld;
varying vec3 vPos;
void main() {
  vStreak = vec3(0.0);
  vec3 wp = bendPos(position);
  vPos = wp;
  vWorld = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_PointSize = clamp(aB.x * 2.0 * projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.5), 1.0, 160.0);
  vB = aB;
  vB.y *= smoothstep(0.8, 2.4, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const VS_SWIRL = COMMON + /* glsl */ `
uniform vec2 uResolution;
// xyz the runner's feet, w how strongly the water swirls (0: not at all)
uniform vec4 uSwirlAt;
// x how fast they run (m/s), y how far they lean into a lane change
uniform vec4 uSwirlRun;
attribute vec4 aS; // x radius, y height, z spin (rad/s, either way), w phase
attribute float aSize;
varying vec4 vB;
varying vec3 vStreak;
varying vec3 vWorld;
varying vec3 vPos;
// where a mote is, tau of the way through its spiral
vec3 swirlAt(float tau, float T) {
  float th = aS.w * 6.2831 + aS.z * tau * T;
  float r = aS.x * (1.0 + tau * 1.4);
  return uSwirlAt.xyz + vec3(cos(th) * r - uSwirlRun.y * tau * 0.8, aS.y + tau * (0.35 + aS.x * 0.6), sin(th) * r * 0.75 + tau * (1.0 + uSwirlRun.x * 0.1));
}
void main() {
  // each mote spirals round the runner's body and peels off behind them,
  // over and over, widening and rising as it goes; most are drawn as a
  // streak along the way they're going (the swirl made visible), the rest
  // as little bubbles
  float T = 0.75 + fract(aS.w * 3.7) * 0.55;
  float tau = fract(uTime / T + aS.w);
  vec3 wp = bendPos(swirlAt(tau, T));
  vPos = wp;
  vWorld = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vec4 c0 = projectionMatrix * mv;
  vec4 c1 = projectionMatrix * viewMatrix * vec4(bendPos(swirlAt(max(tau - 0.055, 0.0), T)), 1.0);
  vec2 dv = (c0.xy / c0.w - c1.xy / c1.w) * 0.5 * uResolution;
  float len = min(length(dv), 70.0);
  float sz = aSize * (0.7 + 0.6 * tau);
  float bub = clamp(sz * 2.0 * projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.5), 1.0, 80.0);
  float streak = step(0.38, fract(aS.w * 13.7)) * len;
  float ps = bub + streak;
  gl_PointSize = ps;
  // (the sprite's own y runs down the screen)
  vStreak = vec3(normalize(vec2(dv.x, -dv.y) + 1e-5), streak / ps);
  vB = vec4(bub / ps, sin(3.14159 * tau) * uSwirlAt.w * smoothstep(0.8, 2.4, -mv.z), fract(aS.w * 7.3), 0.0);
  gl_Position = c0;
}
`;
const FS_BUBBLE = FS_HEAD + /* glsl */ `
varying vec4 vB;
varying vec3 vStreak;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (vStreak.z > 0.0) {
    // a streak of swirling water: a thin line along the way it's going,
    // fading in from its tail to its head — a pale core in a darker fringe
    // where it bends the light, so it shows on bright sand and dark water
    float along = dot(c, vStreak.xy);
    float across = dot(c, vec2(-vStreak.y, vStreak.x));
    float h = vStreak.z * 0.5;
    float d = length(vec2(max(abs(along) - h, 0.0), across));
    float w = vB.x * 0.26;
    float core = 1.0 - smoothstep(w * 0.3, w * 0.9, d);
    float fringe = 1.0 - smoothstep(w * 0.9, w * 2.0, d);
    float k = smoothstep(-h, h * 0.6, along) * vB.y;
    float a = max(core * 0.6, fringe * 0.28) * k;
    if (a < 0.004) discard;
    vec3 sc = mix(uSkyHorizon * 0.5, mix(uSkyHorizon, vec3(1.0), 0.85), core);
    vec3 sv = vWorld - uCamPos;
    gl_FragColor = vec4(grade(atmos(sc, sv, length(sv), 0.3), uTrip), a);
    return;
  }
  float r = length(c) * 2.0;
  if (r > 1.0 || vB.y < 0.004) discard;
  float rim = smoothstep(0.5, 0.86, r) * (1.0 - smoothstep(0.86, 1.0, r));
  float edge = smoothstep(0.84, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float glint = 1.0 - smoothstep(0.0, 0.32, length(c - vec2(-0.17, -0.17)) * 2.0);
  vec3 tint = mix(uSkyHorizon, vec3(1.0), 0.7);
  vec3 col = mix(tint, vec3(1.0), rim * 0.5 + glint);
  col = mix(col, uSkyHorizon * 0.35, edge * 0.55);
  float a = (0.08 + rim * 0.55 + edge * 0.25 + glint * 0.85) * vB.y;
  vec3 v = vWorld - uCamPos;
  col = atmos(col, v, length(v), 0.3);
  gl_FragColor = vec4(grade(col, uTrip), min(a, 1.0));
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
uniform float uGemPolish;
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
    // (gem.polish: polished stones that keep their own colour in any light,
    // a pearl's lustre rather than a mirror's)
    col = base * mix(mix(uShadowTint, vec3(1.0), lit), vec3(1.0), uGemPolish);
    if (vFx.x > 0.5) {
      col *= 0.75 + 0.5 * smoothstep(-0.3, 0.6, R.y);
      col += mix(base, vec3(1.0), 0.6 - 0.25 * uGemPolish) * (pow(max(dot(R, L), 0.0), 18.0) + pow(max(dot(R, L2), 0.0), 22.0) * 0.7) * (1.0 - 0.45 * uGemPolish);
      col += base * pow(1.0 - abs(dot(n, V)), 2.0) * 0.35 * uGemPolish;
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
// uDrain.y (the radius the colour still holds out inside) when a world is
// untouched, and once its colour has all gone
export const DRAIN_NONE = 9;
export const DRAIN_ALL = -0.45;

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
    uBeam: v4(), uPool: c(), uDrain: v4(), uWonk: { value: 0 }, uEclipse: v4(), uVigShape: v4(),
    uSea: v4(), uDeep: v4(), uDeepTint: c(),
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
  const sk = env.skyFx || {};
  u.uSkyFx.value.set(env.stars || 0, env.sun.size ? Math.cos(env.sun.size) : 2, env.moon ? Math.cos(env.moon.size) : 2, sk.smoke || 0);
  u.uSkyFx2.value.set(sk.rays || 0, sk.clouds || 0, sk.aurora || 0, sk.ring || 0);
  const ec = env.eclipse || [0, 0, 1];
  u.uEclipse.value.set(ec[0], ec[1] ?? 1, ec[2] ?? 1, 0);
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
  const edge = gr.edge || [0.42, 0.95];
  u.uVigShape.value.set(edge[0], edge[1], 0, 0);
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
  // under the sea: the surface overhead, its shafts of light, the caustics
  // (scale: a multiple of 1/256 per metre)
  const sea = env.sea || {};
  u.uSea.value.set(sea.surface || 0, sea.rays || 0, sea.caustics || 0, sea.scale ?? 0.1875);
  const deep = env.deep || {};
  u.uDeep.value.set(deep.amount || 0, deep.from ?? 0.3, deep.to ?? 1, 0);
  setColor(u.uDeepTint.value, deep.tint || '#ffffff');
  // a draining world starts in full colour: game.js saps it when you come
  // through its doorway
  u.uDrain.value.set(env.drain ? 1 : 0, DRAIN_NONE, 0, 0);
}

// Blend environment uniforms (used for the player, who carries light between
// worlds; every frame while a doorway is in view).
const envKeys = new WeakMap();
export function lerpEnvUniforms(out, a, b, t) {
  let keys = envKeys.get(out);
  if (!keys) envKeys.set(out, (keys = Object.keys(out)));
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
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
    uClear: { value: o.clear ?? 0 },
    uWobble: { value: new THREE.Vector4(...(o.wobble || [0, 0, 1, 0])) },
    uFly: { value: new THREE.Vector4(...(o.fly || [0, 0, 0, 0])) },
    uMarkRepeat: { value: new THREE.Vector2(...(o.marks || [3, 3])) },
  });
  const defines = {};
  if (o.ground) defines.GROUND = o.ground;
  if (o.water) defines.WATER = '';
  if (o.lava) defines.LAVA = '';
  if (o.kinds) defines.KINDS = '';
  if (o.splash) defines.SPLASH = '';
  if (o.wonky) defines.WONKY = '';
  if (o.flame) defines.FLAME = '';
  if (o.bark) defines.BARK = '';
  if (o.cloth) {
    defines.CLOTH = '';
    uniforms.uCloth = { value: new THREE.Vector4(...o.cloth) };
  }
  if (o.sand) {
    // [seconds to run through, waist height, waist depth, floor below the waist]
    defines.SAND = '';
    uniforms.uSand = { value: new THREE.Vector4(...o.sand) };
  }
  if (o.crust) {
    // [glow, ash, scale]
    defines.CRUST = '';
    uniforms.uCrust = { value: new THREE.Vector4(o.crust[0] ?? 1, o.crust[1] ?? 0.6, o.crust[2] ?? 0.5, 0) };
  }
  if (o.turn) {
    defines.TURN = '';
    uniforms.uTurn = { value: new THREE.Vector4(...o.turn) };
  }
  // under the sea (see the object shader): [lean across, rate, wave per
  // metre up, lean along]; [speed, loop, snaking, shape]; [beats per second,
  // squeeze, ripple, lift]; [glide per metre, beat rate, beat at the flukes,
  // far rise]
  if (o.current) {
    defines.CURRENT = '';
    uniforms.uCurrent = { value: new THREE.Vector4(...o.current) };
  }
  if (o.school) {
    defines.SCHOOL = '';
    uniforms.uSchool = { value: new THREE.Vector4(...o.school) };
  }
  if (o.jelly) {
    defines.JELLY = '';
    uniforms.uJelly = { value: new THREE.Vector4(...o.jelly) };
  }
  if (o.cross) {
    defines.CROSS = '';
    uniforms.uCross = { value: new THREE.Vector4(...o.cross) };
  }
  if (o.pleats) defines.PLEATS = '';
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
  // (the ink hull turns with its prop)
  const defines = { OUTLINE: '' };
  for (const k of ['TURN', 'KINDS', 'SPLASH', 'SAND', 'WONKY', 'FLAME', 'CLOTH', 'CURRENT', 'SCHOOL', 'JELLY', 'CROSS']) if (toon.defines && k in toon.defines) defines[k] = '';
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
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
export function makeCharacterMaterials(env, pal, rig, outline, cape, o = {}) {
  // The runner keeps their own colours however deep the dream goes (uDream3
  // carries the palette shift; its doorway-swell terms never reach this close).
  // o.style: 'explorer' draws her details (see CHAR_DETAIL).
  while (rig.length < 3) rig.push(new THREE.Vector4());
  const uniforms = withShared(env, { uPal: { value: pal }, uRig: { value: rig }, uDream3: { value: new THREE.Vector4() } }); // rig: [Vector4 x 3]
  const style = o.style === 'explorer' ? { EXPLORER: '' } : o.style === 'items' ? { ITEMS: '' } : {};
  const make = (defines0, extra) => {
    const defines = Object.assign({}, style, defines0);
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
  if (!cape) return { mat, ink };
  const [capeMat, capeInk] = make({ CAPE: '' }, { uCape: { value: cape.texture }, uCapeGrid: { value: cape.grid } });
  return { mat, ink, capeMat, capeInk };
}

export function makeGlassMaterial(env, o = {}) {
  const uniforms = withShared(env, {
    uAnim: { value: animVector(o.anim) },
    uWobble: { value: new THREE.Vector4(...(o.wobble || [0, 0, 1, 0])) },
    uFly: { value: new THREE.Vector4(...(o.fly || [0, 0, 0, 0])) },
    uDreamK: { value: 0 },
  });
  const defines = {};
  if (o.sand) {
    // (an hourglass's glass turns over with it, see SAND)
    defines.SAND = '';
    uniforms.uSand = { value: new THREE.Vector4(...o.sand) };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
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
    uWobble: { value: new THREE.Vector4(...(o.wobble || [0, 0, 1, 0])) },
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

// o.color: a light of its own colour rather than the world's (env.pool);
// o.flicker: firelight, wavering.
export function makePoolMaterial(env, o = {}) {
  const uniforms = withShared(env, { uAnim: { value: animVector(o.anim) } });
  if (o.color) uniforms.uPool = { value: new THREE.Color(o.color) };
  return new THREE.ShaderMaterial({
    uniforms,
    defines: o.flicker ? { FLICKER: '' } : {},
    vertexShader: VS_SHADOW,
    fragmentShader: FS_POOL,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function makeShadowMaterial(env, o = {}) {
  const uniforms = withShared(env, { uAnim: { value: animVector(o.anim) } });
  const defines = o.hard ? { HARD: '' } : {};
  if (o.cross) {
    defines.CROSS = '';
    uniforms.uCross = { value: new THREE.Vector4(...o.cross) };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
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
    uGemPolish: { value: o.polish ?? 0 },
    uClear: { value: 1 },
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

// The dust kicked up off the road (game/dust.js), lit by env.
export function makeDustMaterial(env) {
  return new THREE.ShaderMaterial({
    uniforms: withShared(env, {}),
    vertexShader: VS_DUST,
    fragmentShader: FS_DUST,
    transparent: true,
    depthWrite: false,
  });
}

// The runner's bubbles (game/bubbles.js), lit by env; swirl: the swirl of
// tiny ones round them, worked out on the GPU.
export function makeBubbleMaterial(env, swirl = false) {
  const extra = swirl ? { uSwirlAt: { value: new THREE.Vector4() }, uSwirlRun: { value: new THREE.Vector4() } } : {};
  return new THREE.ShaderMaterial({
    uniforms: withShared(env, extra),
    vertexShader: swirl ? VS_SWIRL : VS_BUBBLE,
    fragmentShader: FS_BUBBLE,
    transparent: true,
    depthWrite: false,
  });
}

export function makeParticleMaterial() {
  const uniforms = withShared({}, {
    uDistMod: { value: 0 },
    uSize: { value: 1 },
    uDrift: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uOpacity: { value: 0.8 },
    uRing: { value: 0 },
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
