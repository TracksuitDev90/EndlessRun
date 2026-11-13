import * as THREE from '../../vendor/three/three.module.min.js';

// We author every color in sRGB and want it on screen untouched — the look is
// flat illustration, not physically based lighting.
THREE.ColorManagement.enabled = false;

// How many footprints the sand keeps at once (see game/sands.js).
export const PRINTS = 12;

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
// The Gallery's sands (env.sands; ground pattern 10, toon options dunes and
// thread). Track coordinates: p.x across the walk, p.y along the run (the
// chunk distance, mod 4096 — every period here divides it, so nothing jumps
// where it wraps). Needs uNoise and uShore declared first:
//   uShore: x where the doorway out stands (track m, mod 4096), y how much the
//   beach before it is washed flat (0..1), z the sea lapping up it (0..1),
//   w how far up the beach the sea can reach (m).
const SANDS_COMMON = /* glsl */ `
float sandN(vec2 q) { return texture2D(uNoise, q).g; }
// how far out from the middle of the walk the drift banked against this
// side's balustrade starts to rise: well into the walk here, hardly at all
// there
float driftFoot(float d, float side) {
  float n = sandN(vec2(d * 0.015625 + side * 0.31, 0.17 + side * 0.23));
  float n2 = sandN(vec2(d * 0.0625 + side * 0.53, 0.61));
  return mix(5.6, 3.5, smoothstep(0.3, 0.7, n)) - (n2 - 0.5) * 1.2;
}
// how far before the doorway out a point is (m; < 0 past it)
float doorAhead(float d) {
  return mod(uShore.x - d + 2048.0, 4096.0) - 2048.0;
}
`;
const SANDS_VS = /* glsl */ `
#if defined(DUNES) || defined(THREAD)
uniform sampler2D uNoise;
uniform vec4 uShore;
// x the drift's height against the balustrade, y a pile's height, z a
// pile's cycle (s), w the share of the arches sand falls from
uniform vec4 uDunes;
` + SANDS_COMMON + /* glsl */ `
// where a pile and its thread stand, out from the middle of the walk
#define PILE_X 5.85
// the share of a pile's cycle it builds for (the rest it slumps)
#define BUILD 0.8
// the sea washes the beach in front of a doorway into it flat
float sandWash(float d) {
  return uShore.y * (1.0 - smoothstep(uShore.w + 2.0, uShore.w + 14.0, doorAhead(d)));
}
// The pile under the arch at cell (its chunk distance) on this side, if
// there is one (returns 0 if not): its height and radius, and where it is
// in its cycle (f: 0..1) of T seconds.
float pileCycle(float cell, float side, out float H, out float R0, out float f, out float T) {
  float h0 = hash13(vec3(cell, side + 2.0, 1.37));
  float h1 = hash13(vec3(cell, side + 2.0, 7.13));
  float h2 = hash13(vec3(cell, side + 2.0, 4.91));
  T = uDunes.z * (0.75 + 0.5 * h1);
  f = fract(uTime / T + h2);
  H = uDunes.y * (0.65 + 0.55 * h2);
  R0 = 1.3 + 0.5 * h1;
  return step(h0, uDunes.w);
}
// a heap's profile, 1 at its peak to 0 at its foot: a cone of sand, its
// top rounded and its foot easing out
float heap(float u) {
  float c = clamp(1.0 - u, 0.0, 1.0);
  return 0.5 * c + 0.5 * c * c * (3.0 - 2.0 * c);
}
// A pile heaped against the balustrade under every so many arches (at the
// chunk seams), fed by a thread of sand falling from the cornice: it builds
// up while the sand runs, and when the sand stops it slumps out across the
// floor toward the walk; that apron settles into the drift as the next one
// grows. slip: how much sand is running down it here (0..1).
float pileHeight(vec2 p, float side, out float slip) {
  slip = 0.0;
  float cell = floor(p.y * 0.0625 + 0.5) * 16.0;
  float H, R0, f, T;
  if (pileCycle(mod(cell, 4096.0), side, H, R0, f, T) < 0.5) return 0.0;
  float g = min(f / BUILD, 1.0);
  float c = clamp((f - BUILD) / (1.0 - BUILD), 0.0, 1.0);
  // (it gives way all at once, then settles)
  float k = 1.0 - (1.0 - c) * (1.0 - c) * (1.0 - c);
  float dy = p.y - cell;
  float rc = R0 * (0.4 + 0.6 * sqrt(g)) * (1.0 + 0.9 * k);
  float r = length(vec2(p.x - side * (PILE_X - 0.7 * k), dy));
  float cone = H * pow(g, 0.6) * (1.0 - k) * heap(r / rc);
  float ra = length(vec2(p.x - side * (PILE_X - 0.7), dy));
  float apron = H * 0.22 * max(k, 1.0 - smoothstep(0.0, 0.7, g)) * heap(ra / (R0 * 2.1));
  float on = 1.0 - smoothstep(rc, rc * 1.15, r);
  slip = max(4.0 * k * (1.0 - k) * on, 0.45 * step(f, BUILD) * on * smoothstep(0.0, 0.1, g));
  return cone + apron;
}
// The sand's height at p: the drift banked against the balustrade, its crest
// rising and falling along the walk and creeping slowly on, and the piles;
// nothing in the lanes, and nothing on the beach the sea has washed flat.
float sandHeight(vec2 p, out float slip) {
  slip = 0.0;
  float ax = abs(p.x);
  if (ax < 3.2) return 0.0;
  float side = p.x < 0.0 ? -1.0 : 1.0;
  float foot = driftFoot(p.y, side);
  float crest = sandN(vec2(p.y * 0.03125 + side * 0.71 - uTime * 0.004, 0.43));
  float drift = uDunes.x * (0.5 + 0.7 * crest) * pow(smoothstep(foot, 6.3, ax), 1.7);
  float pile = pileHeight(p, side, slip);
  return (drift + pile) * smoothstep(3.2, 3.9, ax) * (1.0 - sandWash(p.y));
}
#endif
`;

// The Frostbound Pass's snow (env.snow; ground pattern 15, toon options banks
// and snow). Track coordinates, as the sands': p.x across the route, p.y along
// the run (the chunk distance, mod 4096 — every period here divides it).
// Needs uNoise declared first.
const FROST_COMMON = /* glsl */ `
float frostN(vec2 q) { return texture2D(uNoise, q).g; }
// Where the canyon opens out on this side of the route (0 walled in by the
// glacier, 1 open onto the ice field): the left opens first, then both, then
// the right, then the walls close in again — every 512 m (frost.js stands its
// cliffs by the same rule: see openAt there).
float openAt(float d, float side) {
  return smoothstep(0.56, 0.74, 0.5 + 0.5 * sin(d * 0.01227185 + (side < 0.0 ? 0.4 : 2.4)));
}
`;
const FROST_VS = /* glsl */ `
#if defined(BANKS) || defined(SNOW)
// Snow settling (env.snow, see Game.updateSnow): x how much has built up (0 a
// dusting, 1 as deep as it gets), y how far the dream lifts far drifts apart
uniform vec4 uSnow;
#endif
#ifdef SNOW
// How far each vertex moves, in the prop's own space, by the time the snow
// lies as deep as it gets (caps thicken, drifts swell, laden boughs sag); and
// in w, which slab of a far drift it is (0 the one that stays on the ground:
// see the lift, below).
attribute vec4 snow;
#endif
#ifdef BANKS
uniform sampler2D uNoise;
// x how deep the snow lies here (m)
varying vec2 vSnowH;
` + FROST_COMMON + /* glsl */ `
// The snow's height at p. Nothing on the route itself; along each edge of it
// a bank (the route's boundary: low and broken at first, a wall of drift once
// the snow lies deep), its crest wandering in and out and rising and falling;
// beyond that the snowfield, blown into long dunes — or, where the canyon
// opens out, sinking away to the flat of the ice field, which the wind keeps
// scoured.
float snowHeight(vec2 p) {
  float ax = abs(p.x);
  if (ax < 4.1) return 0.0;
  float side = p.x < 0.0 ? -1.0 : 1.0;
  float lv = uSnow.x;
  float n1 = frostN(vec2(p.y * 0.015625 + side * 0.31, 0.17 + side * 0.23));
  float n2 = frostN(vec2(p.y * 0.0625 + side * 0.53, 0.61));
  float crest = 5.5 + (n1 - 0.5) * 1.5;
  float hb = mix(0.36, 1.4, lv) * (0.68 + 0.64 * n2);
  float open = openAt(p.y, side) * smoothstep(7.0, 10.5, ax);
  float dune = frostN(vec2(p.x * 0.03125 + 0.4, p.y * 0.03125 + side * 0.2));
  float field = (mix(0.12, 0.8, lv) * (0.5 + dune) + lv * 1.5 * smoothstep(0.5, 0.85, dune)) * (1.0 - open);
  float h = hb * smoothstep(4.15, crest, ax);
  return mix(h, field, smoothstep(crest, crest + 3.0, ax));
}
#endif
`;

const VS_OBJECT = COMMON + SANDS_VS + FROST_VS + /* glsl */ `
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
#ifdef TUMBLE
// Tumbling about its own middle (an asteroid): x turns a second about the
// local x axis, y about the local z axis, both through (0, z, 0); each
// instance starts at its own angle and goes at its own pace (its phase).
uniform vec4 uTumble;
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
#if defined(SAND) || defined(WONKY) || defined(JELLY) || defined(THREAD) || defined(LID) || defined(SWIM)
attribute float role;
#endif
#if defined(SCHOOL) || defined(LID)
attribute vec4 fish;
#endif
#ifdef DUNES
// x how much sand is running down here, y how deep it lies
varying vec2 vSand;
#endif
#ifdef THREAD
// A thread of sand falling from the cornice onto a pile (see pileHeight;
// p0 the chunk distance of the arch it falls under, p1 which side): x the
// height it falls from, y its radius. role 0 the stream (built 0..1 up y),
// 1 the grains bouncing where it lands.
uniform vec4 uThread;
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
#endif
#ifdef SWIM
// A critter zooming round its spot (the Kelp Deep's sea lions, octopuses
// and seahorses), built nose to +x round the origin. It swims a figure of
// eight - uSwim.y either way along its own x, uSwim.w either way across (z),
// bobbing uSwim.z up and down - going round uSwim.x radians a second,
// putting on speed and easing off as it goes (uSwim3.x), turned the way it's
// heading, nosing up and down with its path (uSwim3.y: 0 it stays upright),
// banked into its turns (uSwim2.x) and now and then, once round each loop,
// flinging itself into a barrel roll (uSwim2.y rolls). Its beat: uSwim2.z
// a second, uSwim2.w how hard, the way of its kind (uSwim3.z): 0 a sea lion
// - a wave down its body to the hind flippers, the fore flippers (role 1)
// sweeping; 1 an octopus - a jet, its arms (role 1) drawn in and flung out
// behind it, rippling; 2 a seahorse - upright, its fin (role 1) a blur, its
// tail (role 2) curling and uncurling.
uniform vec4 uSwim;
uniform vec4 uSwim2;
uniform vec4 uSwim3;
#endif
#ifdef JELLY
// A jellyfish: the bell (role 0) squeezes and relaxes, a quick beat and a
// slow ease back, and the arms and tentacles below it (role 1) trail and
// ripple a beat behind; it lifts a little on each beat and sinks back. x beats
// per second, y how hard the bell squeezes, z how far the trailing parts
// ripple, w how far it lifts.
uniform vec4 uJelly;
#endif
#ifdef LID
// A lid that pops open now and then (a sunken chest). role 1 the lid, hinged
// on the local x axis through (y, z) = (uLid.y, uLid.z); role 2 the bubbles
// that pour out (each its own vertices round the origin, fish.xyz where it
// starts and fish.w its own beat); role 3 coins flung up out of it, flipping
// and falling back in. x seconds between pops, w how wide it flings open
// (radians). Each pop is its own (see lidPop in game.js, which keeps time
// with this for the sound): most fling it wide, some only burp it open a
// little and let out a few bubbles, now and then it stays shut. It's held
// shut once the runner is close (the bubbles still seep out round it).
uniform vec4 uLid;
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
#ifdef SWIM
// rolled about x, pitched about z, then yawed about y (see SWIM)
vec3 swimTurn(vec3 v, vec2 r, vec2 p, float yaw) {
  v = vec3(v.x, v.y * r.x - v.z * r.y, v.y * r.y + v.z * r.x);
  v = vec3(v.x * p.x - v.y * p.y, v.x * p.y + v.y * p.x, v.z);
  return rotY(v, yaw);
}
#endif
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
  #ifdef SNOW
    // the snow that has settled on it so far
    lp += snow.xyz * uSnow.x;
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
  #ifdef SWIM
    {
      float u = uTime * uSwim.x + phase;
      float th = u + uSwim3.x * sin(u);
      // where it is round its figure of eight, which way it's going, and
      // how its heading is turning
      vec3 c = vec3(uSwim.y * sin(th), uSwim.z * sin(3.0 * th + 0.7), uSwim.w * sin(2.0 * th));
      vec3 d = vec3(uSwim.y * cos(th), 3.0 * uSwim.z * cos(3.0 * th + 0.7), 2.0 * uSwim.w * cos(2.0 * th));
      vec2 dd = vec2(-uSwim.y * sin(th), -4.0 * uSwim.w * sin(2.0 * th));
      float hl = max(length(d.xz), 1e-3);
      float yaw = atan(-d.z, d.x);
      float pitch = atan(d.y, hl) * uSwim3.y;
      float turn = clamp((d.x * dd.y - d.z * dd.x) / (hl * hl), -2.5, 2.5);
      float roll = turn * uSwim2.x;
      float lap = fract(th / 6.2831853 + phase * 0.1591549);
      roll += 6.2831853 * uSwim2.y * smoothstep(0.55, 0.8, lap);
      float bt = uTime * uSwim2.z * 6.2831853 + phase * 9.0;
      float w = uSwim2.w;
      if (uSwim3.z < 0.5) {
        float back = max(0.15 - lp.x, 0.0);
        lp.y += sin(bt - lp.x * 3.0) * w * back * back;
        if (role > 0.5) lp.y += sin(bt + 1.2) * w * 2.2 * abs(lp.z);
      } else if (uSwim3.z < 1.5) {
        float pulse = 0.5 + 0.5 * sin(bt);
        if (role > 0.5) {
          float k = max(0.05 - lp.x, 0.0);
          lp.yz *= 1.0 - 0.4 * pulse * min(k * 1.6, 1.0);
          lp.z += sin(bt * 1.5 - lp.x * 7.0 + lp.y * 4.0) * w * k;
          lp.y += cos(bt * 1.3 - lp.x * 6.0 + lp.z * 4.0) * w * k;
        } else {
          lp.yz *= 1.0 + 0.07 * (1.0 - pulse);
        }
      } else {
        if (role > 0.5 && role < 1.5) lp.z += sin(uTime * 40.0 + lp.y * 30.0 + phase) * 0.014;
        if (role > 1.5) lp.x += sin(bt) * w * max(-lp.y, 0.0);
        lp.y += sin(bt * 0.5) * 0.03;
      }
      vec2 rr = vec2(cos(roll), sin(roll));
      vec2 pp = vec2(cos(pitch), sin(pitch));
      lp = swimTurn(lp, rr, pp, yaw) + c;
      ln = swimTurn(ln, rr, pp, yaw);
      #ifdef OUTLINE
        lo = swimTurn(lo, rr, pp, yaw);
      #endif
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
  #ifdef LID
    {
      float T = uLid.x;
      float tt = uTime + phase * 0.15915 * T;
      float cyc = floor(tt / T);
      float c = tt - cyc * T;
      float h = fract(cyc * 0.618034 + phase * 0.3183);
      float pop = h < 0.15 ? 0.0 : h < 0.4 ? 0.4 : 1.0;
      float allow = smoothstep(17.0, 27.0, aP);
      if (role > 0.5 && role < 1.5) {
        // something pushing from inside rattles it, then it pops open with an
        // overshoot, bobs while the bubbles pour out, drops shut and bounces
        float rattle = c < 0.42 ? sin(c * 72.0) * 0.045 * smoothstep(0.0, 0.42, c) : 0.0;
        float up = 0.0;
        if (c >= 0.42 && c < 0.6) up = easeOutBack((c - 0.42) / 0.18);
        else if (c >= 0.6 && c < 1.75) up = 1.0 + 0.07 * sin((c - 0.6) * 8.0) * exp(-(c - 0.6) * 2.5);
        else if (c >= 1.75 && c < 2.05) up = 1.0 - pow((c - 1.75) / 0.3, 2.0);
        float bounce = c >= 2.05 && c < 2.4 ? sin((c - 2.05) / 0.35 * 3.14159) * 0.09 : 0.0;
        float a = (rattle + up * uLid.w + bounce) * min(pop * 1.4, 1.0) * allow;
        float cs = cos(a), sn = sin(a);
        vec2 r = vec2(lp.y - uLid.y, lp.z - uLid.z);
        lp.yz = vec2(uLid.y + r.x * cs + r.y * sn, uLid.z - r.x * sn + r.y * cs);
        ln.yz = vec2(ln.y * cs + ln.z * sn, -ln.y * sn + ln.z * cs);
        #ifdef OUTLINE
          lo.yz = vec2(lo.y * cs + lo.z * sn, -lo.y * sn + lo.z * cs);
        #endif
      } else if (role > 1.5 && role < 2.5) {
        // a bubble, let go while the lid's up (a burp lets out only a few):
        // rising faster and faster, wobbling and swelling, then gone
        float age = c - 0.48 - fish.w * 0.95;
        float on = step(0.0, age) * step(age, 2.7) * step(fish.w, pop);
        float grow = smoothstep(0.0, 0.12, age) * (1.0 + 0.28 * age) * (1.0 - smoothstep(2.2, 2.7, age));
        float rise = 0.55 * age + 0.45 * age * age;
        vec3 at = vec3(
          fish.x * (1.0 + 0.35 * age) + sin(age * 6.0 + fish.w * 40.0) * 0.07 * age,
          fish.y + rise,
          fish.z - 0.18 * age + cos(age * 5.3 + fish.w * 31.0) * 0.06 * age);
        float wob = sin(age * 14.0 + fish.w * 20.0) * 0.12;
        lp = lp * vec3(1.0 + wob, 1.0 - wob, 1.0 + wob) * grow * on + at;
      } else if (role > 2.5) {
        // a coin flung up on a big pop, flipping over and over, falling back in
        float age = c - 0.47 - fish.w * 0.12;
        float on = step(0.0, age) * step(age, 1.25) * step(0.7, pop) * allow;
        float spin = age * (9.0 + fish.w * 6.0);
        float cs = cos(spin), sn = sin(spin);
        lp.yz = vec2(lp.y * cs - lp.z * sn, lp.y * sn + lp.z * cs);
        ln.yz = vec2(ln.y * cs - ln.z * sn, ln.y * sn + ln.z * cs);
        #ifdef OUTLINE
          lo.yz = vec2(lo.y * cs - lo.z * sn, lo.y * sn + lo.z * cs);
        #endif
        lp = lp * on + fish.xyz + vec3((fish.w - 0.5) * 0.8 * age, 2.3 * age - 1.84 * age * age, 0.3 * age);
      }
    }
  #endif

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
  #ifdef TUMBLE
    {
      vec3 c = vec3(0.0, uTumble.z, 0.0);
      vec3 r = lp - c;
      float pace = 0.7 + 0.6 * fract(phase * 0.731);
      float a = uTime * uTumble.x * pace + phase * 6.2831;
      float b = uTime * uTumble.y * pace + phase * 3.917;
      float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
      r = vec3(r.x, r.y * ca - r.z * sa, r.y * sa + r.z * ca);
      r = vec3(r.x * cb - r.y * sb, r.x * sb + r.y * cb, r.z);
      ln = vec3(ln.x, ln.y * ca - ln.z * sa, ln.y * sa + ln.z * ca);
      ln = vec3(ln.x * cb - ln.y * sb, ln.x * sb + ln.y * cb, ln.z);
      #ifdef OUTLINE
        lo = vec3(lo.x, lo.y * ca - lo.z * sa, lo.y * sa + lo.z * ca);
        lo = vec3(lo.x * cb - lo.y * sb, lo.x * sb + lo.y * cb, lo.z);
      #endif
      lp = c + r;
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

  #ifdef DUNES
    {
      // the sands (see sandHeight): the strip is laid flat, uv in metres
      // (y along the run, from p0); its normal from the slope of the sand
      float slip, s1, s2;
      vec2 sp = vec2(lp.x, uv.y + phase);
      float h = sandHeight(sp, slip);
      float hx = sandHeight(sp + vec2(0.15, 0.0), s1);
      float hd = sandHeight(sp + vec2(0.0, 0.15), s2);
      lp.y += h;
      ln = normalize(vec3((h - hx) / 0.15, 1.0, (hd - h) / 0.15));
      vSand = vec2(slip, h);
    }
  #endif
  #ifdef BANKS
    {
      // the snow banked along the route and lying over the field (see
      // snowHeight): the strip is laid flat, uv in metres (y along the run,
      // from p0); its normal from the slope of the snow
      vec2 sp = vec2(lp.x, uv.y + phase);
      float h = snowHeight(sp);
      float hx = snowHeight(sp + vec2(0.3, 0.0));
      float hd = snowHeight(sp + vec2(0.0, 0.3));
      lp.y += h;
      ln = normalize(vec3((h - hx) / 0.3, 1.0, (hd - h) / 0.3));
      vSnowH = vec2(h, 0.0);
    }
  #endif
  #ifdef THREAD
    {
      // its head falls from the cornice when the sand starts to run, and
      // when it stops, its tail falls after it; nothing where there's no
      // pile, or on the beach the sea has washed flat
      float H, R0, f, T, slip;
      float has = pileCycle(phase, sgn, H, R0, f, T) * (1.0 - step(0.3, sandWash(phase)));
      float land = sandHeight(vec2(sgn * PILE_X, phase), slip);
      float ts = f * T;
      float te = (f - BUILD) * T;
      float bot = max(land, uThread.x - 4.9 * ts * ts);
      float top = te > 0.0 ? uThread.x - 4.9 * te * te : uThread.x;
      float on = has * step(bot + 0.05, top);
      if (role < 0.5) {
        float y = mix(bot, top, lp.y);
        // a thin, grainy stream, wavering a little as it falls
        float grain = 0.7 + 0.3 * sin(uTime * 41.0 + y * 37.0 + phase);
        lp.xz *= uThread.y * on * grain;
        lp.x += sin(uTime * 2.3 + y * 0.7 + phase) * 0.025 * on;
        lp.y = y;
      } else {
        // where it lands, grains bouncing off the top of the pile
        float hit = on * step(bot, land + 0.01);
        lp *= hit * (0.75 + 0.35 * sin(uTime * 23.0 + phase * 3.0));
        lp.y += land;
      }
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
  #ifdef SNOW
    if (uSnow.y > 0.0 && snow.w > 0.0) {
      // deep in the dream, far off, a drift comes apart in slabs that lift
      // off one another and hang there, rocking; they settle back together
      // well before the runner reaches them (past the stretch of road that's
      // kept true, like every other warp of the dream)
      float k = smoothstep(max(44.0, uBend.z), max(130.0, uBend.z + 86.0), aP) * uSnow.y;
      float bob = sin(uTime * 0.45 + phase * 2.0 + snow.w * 1.9);
      wp.y += k * snow.w * (2.3 + 0.7 * bob);
      wp.x += k * snow.w * 0.5 * sin(uTime * 0.21 + phase * 3.0 + snow.w);
    }
  #endif
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
  #ifdef SHELVES
    // a wall of books along the run runs on across chunks (its uv.x laid
    // out along the run, p0 the chunk distance); the stacks across it don't
    if (abs(fx.x - 0.7) < 0.02) vUv.x += phase;
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
  #ifdef SHELL
    float fur = aD.w * uFurWind.w;
    lp += ln * fur * aShell;
    vShell = aShell;
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

// Ground pattern 10, the Gallery's sands (inside FS_TOON's GROUND block,
// after hash12): packed sand and the loose sand spilled in off the drifts,
// the runner's footprints, and the surf lapping up the beach before a
// doorway into the sea (see game/sands.js for what drives them).
const SANDS_FS = /* glsl */ `
#if GROUND == 14
// how much a puddle on the roof gives back the sky (see pattern 14)
float gSheen = 0.0;
#endif
#if GROUND == 10 || GROUND == 15
// The runner's footprints (game/sands.js), pressed into the Gallery's sand
// and into the Frostbound Pass's snow alike.
#define PRINTS ${PRINTS}
// each footprint: x, d (track m, mod 4096), heading (rad, toward +x), kind
// (0 a boot, 1 a trainer, 2 a slide's furrow); and its length (a furrow's),
// width (a furrow's), depth (m), and 1 or -1 (a right or a left foot)
uniform vec4 uPrintA[PRINTS];
uniform vec4 uPrintB[PRINTS];
// x the runner (track m), y how far back the prints go (m), z how many
uniform vec4 uPrintZone;
// the relief the pattern gives the ground (added to its normal), and how
// much of the sky it gives back (wet sand bared by the backwash; bare ice)
vec3 gBump = vec3(0.0);
float gSheen = 0.0;
float wrapD(float a) {
  return mod(a + 2048.0, 4096.0) - 2048.0;
}
#endif
#if GROUND == 10
uniform vec4 uShore;
` + SANDS_COMMON + /* glsl */ `
// the swash: x its front (m before the doorway), y how far this wave
// reached, z the wet line, w 1 while it draws back
uniform vec4 uSurf;
// x how far its foam has been carried (m), yzw the phases of its front's lobes
uniform vec4 uSurf2;
// x how much lace the wave carries (0..1), y how far its lobes reach (m),
// z where the runner is across the walk, w how much they're wading
uniform vec4 uSurf3;
uniform vec3 uSeaShallow;
uniform vec3 uSeaDeep;
uniform vec3 uSeaFoam;
#ifdef DUNES
varying vec2 vSand;
#else
const vec2 vSand = vec2(0.0);
#endif
#endif
#if GROUND == 10 || GROUND == 15
// A footprint, q in its own frame (m: y toward the toe, x to the outside of
// the foot): how deep it presses the sand (1 at the deepest; the rim of sand
// squeezed up round it below 0). kind 0 a hiking boot's lugs, 1 a trainer's
// wavy tread, a size smaller (both drawn a third over life size, so they
// read from the camera); fine: how far the tread is lost to distance.
float footprint(vec2 q, float kind, float fine) {
  q /= mix(1.32, 1.18, kind);
  float fore = (length((q - vec2(0.008, 0.062)) / vec2(0.056, 0.088)) - 1.0) * 0.056;
  float heel = (length((q - vec2(0.0, -0.092)) / vec2(0.045, 0.056)) - 1.0) * 0.045;
  float k = 0.035;
  float hh = clamp(0.5 + 0.5 * (heel - fore) / k, 0.0, 1.0);
  float sdf = mix(heel, fore, hh) - k * hh * (1.0 - hh);
  float inner = smoothstep(0.003, -0.008, sdf);
  // a runner's print: the ball and toes dug in deepest, the heel barely
  float dig = mix(0.4, 1.0, smoothstep(-0.12, 0.04, q.y));
  float lug = kind < 0.5 ? fract(q.y * 26.0 + abs(q.x) * 12.0) : fract(q.y * 32.0 + sin(q.x * 75.0) * 0.3);
  float tread = mix(smoothstep(0.3, 0.45, lug) * (1.0 - smoothstep(0.75, 0.9, lug)), 0.5, fine);
  float rim = smoothstep(0.032, 0.006, sdf) * smoothstep(-0.004, 0.006, sdf);
  return inner * dig * (0.82 + 0.18 * tread) - rim * 0.32;
}
// A slide's furrow, its end at the origin running back len metres, w wide,
// the sand it shoved along heaped up at its end.
float furrow(vec2 q, float len, float w) {
  float d = length(vec2(q.x, q.y - clamp(q.y, -len, 0.0))) - w * 0.5;
  float trough = smoothstep(0.02, -w * 0.45, d);
  float rim = smoothstep(0.09, 0.0, d) * smoothstep(-0.03, 0.02, d);
  float push = exp(-pow((q.y - 0.07) / 0.07, 2.0)) * smoothstep(w * 0.6, 0.0, abs(q.x));
  return trough - 0.35 * rim - 0.5 * push;
}
// The hole a walking stick's tip punches (the elder's), a little sand
// squeezed up round it.
float stickHole(vec2 q) {
  float d = length(q) - 0.021;
  float rim = smoothstep(0.018, 0.004, d) * smoothstep(-0.004, 0.006, d);
  return smoothstep(0.003, -0.012, d) - rim * 0.35;
}
// A rabbit's print (the bunny's big bare feet): a long sole pad, three round
// toe pads ahead of it, the toes dug in deepest; drawn a little over life
// size, as the others are.
float pawPrint(vec2 q) {
  q /= 1.15;
  float sole = (length((q - vec2(0.0, -0.02)) / vec2(0.036, 0.085)) - 1.0) * 0.036;
  float toes = 9.0;
  for (int k = -1; k <= 1; k++) toes = min(toes, length(q - vec2(float(k) * 0.023, 0.088 - 0.012 * abs(float(k)))) - 0.0135);
  float k = 0.012;
  float hh = clamp(0.5 + 0.5 * (toes - sole) / k, 0.0, 1.0);
  float sdf = mix(toes, sole, hh) - k * hh * (1.0 - hh);
  float inner = smoothstep(0.003, -0.007, sdf);
  float dig = mix(0.45, 1.0, smoothstep(-0.09, 0.07, q.y));
  float rim = smoothstep(0.028, 0.005, sdf) * smoothstep(-0.004, 0.006, sdf);
  return inner * dig - rim * 0.3;
}
// A big cat's pugmark (the samurai's bare paws): a broad main pad, three
// lobes along its back edge, and four oval toes in an arc ahead of it - no
// claws (a cat's are drawn in as it walks); a little over life size.
float pugmark(vec2 q) {
  q /= 1.1;
  vec2 m = q - vec2(0.0, -0.035);
  float pad = (length(m / vec2(0.052, 0.04)) - 1.0) * 0.04;
  // (the lobes: its back edge scalloped in three)
  pad += 0.004 * (1.0 - cos(atan(m.x, -m.y) * 3.0)) * smoothstep(0.0, -0.03, m.y);
  float toes = 9.0;
  for (int k = 0; k < 4; k++) {
    float x = (float(k) - 1.5) * 0.031;
    vec2 t = q - vec2(x, 0.05 - 0.018 * abs(float(k) - 1.5) * abs(float(k) - 1.5) * 0.6);
    toes = min(toes, (length(t / vec2(0.0135, 0.018)) - 1.0) * 0.0135);
  }
  float sdf = min(pad, toes);
  float inner = smoothstep(0.003, -0.007, sdf);
  float dig = mix(0.55, 1.0, smoothstep(-0.07, 0.06, q.y));
  float rim = smoothstep(0.028, 0.005, sdf) * smoothstep(-0.004, 0.006, sdf);
  return inner * dig - rim * 0.3;
}
float printShape(vec2 q, vec4 A, vec4 B, float fine) {
  return A.w > 4.5 ? pugmark(q) : A.w > 3.5 ? pawPrint(q) : A.w > 2.5 ? stickHole(q) : A.w > 1.5 ? furrow(q, B.x, B.y) : footprint(q, A.w, fine);
}
// The runner's footprints round p: how deep they press the sand here (m);
// the slope they give it is added to grad (dh/dx, dh/dd).
float printsAt(vec2 p, float fine, inout vec2 grad) {
  float dz = wrapD(p.y - uPrintZone.x);
  if (uPrintZone.z < 0.5 || dz > 0.8 || dz < -uPrintZone.y) return 0.0;
  float deep = 0.0;
  for (int i = 0; i < PRINTS; i++) {
    if (float(i) >= uPrintZone.z) break;
    vec4 A = uPrintA[i];
    vec4 B = uPrintB[i];
    vec2 hd = vec2(sin(A.z), cos(A.z));
    vec2 rt = vec2(hd.y, -hd.x);
    vec2 dp = vec2(p.x - A.x, wrapD(p.y - A.y));
    float along = dot(dp, hd);
    float across = dot(dp, rt);
    float back = A.w > 1.5 ? B.x : 0.0;
    if (abs(across) > 0.4 || along > 0.38 || along < -back - 0.38) continue;
    vec2 q = vec2(across * B.w, along);
    float e = 0.012;
    float h0 = printShape(q, A, B, fine);
    float hx = printShape(q + vec2(e, 0.0), A, B, fine);
    float hy = printShape(q + vec2(0.0, e), A, B, fine);
    vec2 g = -vec2((hx - h0) * B.w, hy - h0) / e * B.z * 1.5;
    grad += g.x * rt + g.y * hd;
    deep = max(deep, h0 * B.z);
  }
  return deep;
}
#endif
#if GROUND == 10
// the swash's front rolls along in lobes (as in game/sands.js)
float surfLobes(float x) {
  return uSurf3.y * (0.7 * sin(0.42 * x + uSurf2.y) + 0.45 * sin(1.07 * x + uSurf2.z) + 0.2 * sin(2.3 * x + uSurf2.w));
}
// Cells of foam: x how far from the nearest cell's heart, y how far from
// the nearest wall between two cells. Their hearts wander, so the lace keeps
// reshaping as it slides.
vec2 foamCells(vec2 q) {
  vec2 c = floor(q);
  vec2 f = fract(q);
  float d1 = 9.0;
  float d2 = 9.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = vec2(hash12(c + o + 3.1), hash12(c + o + 11.7));
      vec2 pt = o + 0.5 + 0.4 * sin(6.2831 * h + uTime * (0.7 + 0.6 * h.yx));
      float d = length(pt - f);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec2(d1, d2 - d1);
}
vec3 sandGround(vec2 p, float dist, float far) {
  float ax = abs(p.x);
  float side = p.x < 0.0 ? -1.0 : 1.0;
  // how much ground a pixel covers here (m), for what must fade with distance
  float fw = fwidth(p.x) + fwidth(p.y);
  // fine pale sand in broad soft patches
  float n1 = sandN(p * 0.0625);
  float n2 = sandN(p * 0.25 + 0.31);
  vec3 c = mix(uGroundB, uGroundA, smoothstep(0.2, 0.75, n1 * 0.65 + n2 * 0.35));
  // ripples the wind has drawn in it (their crests run along the walk, so
  // they never strobe), creeping slowly sideways: each a long gentle rise
  // to its crest and a short steep face in its own shade
  float rx = p.x * 1.4 + (n1 - 0.5) * 3.0 + sin(p.y * 0.19635) * 0.5 + (n2 - 0.5) * 0.8 + uTime * 0.025;
  float rk = (1.0 - far * 0.8) * (1.0 - smoothstep(0.25, 0.6, fwidth(rx)));
  float rf = fract(rx);
  float lee = smoothstep(0.78, 0.93, rf) * (1.0 - smoothstep(0.95, 1.0, rf));
  c *= 1.0 + (0.035 * rf - 0.08 * lee) * rk;
  // loose sand spilled in off the drift on each side: tongues of it reaching
  // into the walk, far in here, hardly at all there, paler than the packed
  // sand, with a soft lip facing the walk, lit or shaded as it faces the
  // light
  float t1 = sandN(vec2(p.y * 0.125 + side * 0.37, 0.77 + side * 0.11));
  float t2 = sandN(vec2(p.y * 0.375 + side * 0.19, 0.29));
  float reach = max(0.6, driftFoot(p.y, side) - 0.3 - smoothstep(0.35, 0.75, t1) * 2.3 - (t2 - 0.5) * 0.9);
  float lt = clamp((ax - reach) / 0.35, 0.0, 1.0);
  float loose = lt * lt * (3.0 - 2.0 * lt);
  float lip = 4.0 * lt * (1.0 - lt) * (1.0 - far);
  c = mix(c, c * vec3(1.04, 1.03, 1.0) + vec3(0.012, 0.01, 0.004), loose);
  c *= 1.0 + lip * (0.025 - 0.11 * side * uLightDir.x);
  vec2 grad = vec2(0.0);
  // grains trickling down the drifts and the piles, running when one slumps
  float slope = 1.0 - normalize(vNormal).y;
  float run = sandN(vec2(p.y * 1.5 + side * 0.4, ax * 0.3 + uTime * 0.09));
  float trickle = max(smoothstep(0.55, 0.72, run) * smoothstep(0.04, 0.25, slope), vSand.x * smoothstep(0.42, 0.62, run));
  c *= 1.0 + 0.08 * trickle * (1.0 - far);
  // the deeper it lies, the looser and paler
  c *= 1.0 + 0.03 * smoothstep(0.2, 0.8, vSand.y);
  // wisps of fine sand blowing across the walk, coming and going in gusts
  float gust = smoothstep(0.42, 0.7, sandN(vec2(p.x * 0.025 - uTime * 0.04, p.y * 0.03125 + uTime * 0.015)));
  float wisp = smoothstep(0.56, 0.74, sandN(vec2(p.x * 0.1 - uTime * 0.38, p.y * 0.625)));
  c = mix(c, c * 1.06 + vec3(0.04, 0.036, 0.026), wisp * gust * 0.9 * (1.0 - far));
  // the odd dark grain
  vec2 gq = p * 4.0;
  vec2 gc = floor(gq);
  vec2 go = fract(gq) - (vec2(hash12(gc + 1.7), hash12(gc + 5.3)) * 0.6 + 0.2);
  float gr = 0.07 + 0.05 * hash12(gc + 9.1);
  float speck = (1.0 - smoothstep(gr - 0.04, gr + 0.04, length(go))) * step(0.94, hash12(gc + 23.0)) * (1.0 - smoothstep(0.02, 0.06, fw));
  c = mix(c, c * vec3(0.55, 0.52, 0.5), speck * 0.75);
  // the runner's footprints, darker and cooler where they're pressed in
  float deep = printsAt(p, smoothstep(0.004, 0.015, fw), grad);
  c = mix(c, c * uShadowTint * 0.92, clamp(deep * 24.0, 0.0, 0.85));

  // The sea, lapping up the beach before a doorway into it: a front of
  // white foam rolling up the sand and drawing back, lace trailing behind it
  // over the water, the sand it has wet darker, glistening as it's bared
  if (uShore.z > 0.0) {
    float s = doorAhead(p.y);
    float lob = surfLobes(p.x);
    float u = uSurf.x + lob - s;
    float wet = smoothstep(0.8, -1.5, s - (uSurf.z + lob * 0.8)) * uShore.z;
    c *= mix(vec3(1.0), vec3(0.8, 0.75, 0.69), wet);
    gSheen = uSurf.w * step(u, 0.0) * (1.0 - smoothstep(0.0, max(uSurf.y - uSurf.x, 0.5) * 0.9 + 0.3, -u));
    if (u > -0.6) {
      // a thin film running ahead of the foam
      c = mix(c, c * 0.9 + vec3(0.06, 0.08, 0.09), smoothstep(-0.55, 0.0, u) * 0.5);
      // the foam: cells of it carried with the water — solid at the front,
      // opening into lace behind, the lace thinning and breaking up further
      // back — and the strand on the light's side shading the water in each
      // hole
      vec2 q = vec2(p.x, s - uSurf2.x) * 1.35;
      q += (vec2(sandN(q * 0.11 + 0.3), sandN(q * 0.11 + 0.71)) - 0.5) * 0.9;
      float aa = fw * 1.6 + 0.02;
      float L = 1.4 + 3.6 * uSurf3.x;
      float w = mix(0.95, 0.08, smoothstep(0.05, L * 0.8, u));
      // (each hole a rounded pebble: the cell, shrunk from its walls, its
      // corners trimmed round)
      float r = 0.64 - 0.3 * w;
      float brk = smoothstep(0.3, 0.6, sandN(q * 0.07 + vec2(0.13, 0.0)));
      float keep = mix(1.0, brk, smoothstep(L * 0.35, L, u)) * (1.0 - smoothstep(L, L * 1.9, u));
      vec2 cl = vec2(0.4, 0.0);
      float foam = 0.0;
      float lee = 0.0;
      // (out in open water, with no lace left, the cells aren't worked out)
      if (keep > 0.0) {
        cl = foamCells(q);
        foam = (1.0 - smoothstep(w - aa, w + aa, cl.y) * (1.0 - smoothstep(r - aa, r + aa, cl.x))) * keep;
        foam *= smoothstep(-0.02, 0.04 + aa * 0.5, u + 0.16 * (0.45 - cl.x));
        vec2 toLight = normalize(vec2(uLightDir.x, uLightDir.z) + 1e-4) * 0.16;
        vec2 cs = foamCells(q + toLight);
        lee = (1.0 - smoothstep(w - aa, w + aa, cs.y) * (1.0 - smoothstep(r - aa, r + aa, cs.x))) * keep * (1.0 - foam);
      }
      // the water: pale and thin at the front, deepening toward the doorway
      vec3 water = mix(uSeaShallow, uSeaDeep, smoothstep(0.5, 12.0, u)) * (1.0 - 0.2 * lee);
      float sheet = smoothstep(0.0, 0.6, u);
      c = mix(c, water, sheet);
      // (far off, the lace blurs to a pale wash)
      foam = mix(foam, keep * clamp(w * 1.3, 0.0, 1.0) * smoothstep(0.0, 0.3, u), smoothstep(0.25, 0.9, aa));
      // round the runner's legs as they wade, the water churned white, and a
      // wake trailing off behind them
      if (uSurf3.w > 0.0) {
        vec2 rq = vec2(p.x - uSurf3.z, wrapD(p.y - uPrintZone.x));
        float churn = smoothstep(0.55, 0.2, length(rq * vec2(1.0, 0.7)) + (cl.x - 0.4) * 0.3);
        float aft = max(-rq.y, 0.0);
        float vee = abs(abs(rq.x) - (0.22 + aft * 0.3));
        float wake = (1.0 - smoothstep(0.03, 0.08 + aft * 0.03, vee)) * step(rq.y, 0.1) * (1.0 - smoothstep(0.8, 5.0, aft));
        foam = max(foam, clamp(churn + wake * 0.85, 0.0, 1.0) * uSurf3.w * sheet);
      }
      c = mix(c, uSeaFoam, foam);
      grad *= 1.0 - sheet;
    }
  }
  gBump = vec3(-grad.x, 0.0, grad.y);
  return mix(c, mix(uGroundA, uGroundB, 0.4), far * 0.5);
}
#endif
`;

// Ground pattern 15, the Frostbound Pass (inside FS_TOON's GROUND block, after
// the footprints): a route of wind-packed snow lying in long patches over
// blue glacier ice, the ice scoured bare between them — and less and less of
// it showing as the snow settles (uSnow.x) — cracked, and feathered here and
// there with hoar frost; either side a bank of drifted snow (heaped up by the
// vertex shader: toon option banks, see snowHeight), the route's only edge;
// beyond it the snowfield or, where the canyon opens out, pack ice in plates
// with dark water in the leads between them. The runner's footprints press
// into the snow (never the ice), and the bare ice gives back the sky.
const FROST_FS = /* glsl */ `
#if GROUND == 15
#ifdef BANKS
varying vec2 vSnowH;
#else
const vec2 vSnowH = vec2(0.0);
#endif
` + FROST_COMMON + /* glsl */ `
// how thickly the snow lies on the route at p: long streaks of it, laid along
// the run by the wind (the ice shows wherever this falls short of what has
// settled so far)
float snowLie(vec2 p, float n1, float n2) {
  return frostN(p * vec2(0.09375, 0.03125) + 0.67) * 0.62 + n2 * 0.23 + n1 * 0.15;
}
// A frond of hoar frost grown across the ice from the origin along +y, len
// long: a stem, and barbs raking off it either side, shorter toward its tip.
// aa: how soft its lines are (a pixel, and a share of the frame's travel).
float frond(vec2 q, float len, float aa) {
  float t = q.y / len;
  if (t < 0.0 || t > 1.0) return 0.0;
  float axq = abs(q.x);
  float reach = len * 0.34 * (1.0 - t * t) * smoothstep(0.0, 0.12, t);
  if (axq > reach + 0.05) return 0.0;
  float stem = 1.0 - smoothstep(0.016, 0.016 + aa, axq);
  float bf = abs(fract((q.y - axq * 0.8) / 0.15) - 0.5) * 0.15;
  float barb = (1.0 - smoothstep(0.012, 0.012 + aa, bf)) * (1.0 - smoothstep(reach * 0.72, reach, axq));
  return max(stem, barb) * (1.0 - smoothstep(0.85, 1.0, t));
}
// here and there on the bare ice, a spray of three of them from one point
float hoar(vec2 p, float aa) {
  vec2 g = p / 2.6;
  vec2 c = floor(g);
  float h = hash12(c + 7.3);
  if (h < 0.38) return 0.0;
  vec2 d = (fract(g) - (vec2(hash12(c + 1.9), hash12(c + 4.7)) * 0.3 + 0.35)) * 2.6;
  float cov = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float a = h * 6.2831 + fk * 2.0944 + (hash12(c + fk * 3.1 + 0.7) - 0.5) * 1.1;
    vec2 dir = vec2(sin(a), cos(a));
    vec2 q = vec2(d.x * dir.y - d.y * dir.x, dot(d, dir));
    q.x += q.y * q.y * 0.3 * (hash12(c + fk + 13.0) - 0.5);
    cov = max(cov, frond(q, 0.5 + 0.4 * hash12(c + fk * 5.7 + 2.0), aa));
  }
  return cov;
}
// Pack ice: x how far a point is from the lead between its plate and the
// next (0 in the water), y the plate's own number.
vec2 packIce(vec2 g) {
  vec2 c = floor(g);
  vec2 f = fract(g);
  float d1 = 9.0;
  float d2 = 9.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 pt = o + 0.5 + 0.76 * (vec2(hash12(c + o + 3.1), hash12(c + o + 11.7)) - 0.5);
      float d = length(pt - f);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash12(c + o + 23.0);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec2(d2 - d1, id);
}
vec3 frostGround(vec2 p, float dist, float far) {
  float ax = abs(p.x);
  float side = p.x < 0.0 ? -1.0 : 1.0;
  float lv = uSnow.x;
  // how much ground a pixel covers here (m), for what must fade with distance
  float fw = fwidth(p.x) + fwidth(p.y);
  float near = 1.0 - smoothstep(0.02, 0.07, fw);
  float n1 = frostN(p * 0.0625);
  float n2 = frostN(p * 0.25 + 0.31);
  // the ice: turquoise, milky where it's frosted over and deepening to cobalt
  // where it's clear; pressure cracks wander through it along the noise's
  // contours, most of them healed white, a few still open and dark
  vec3 ice = mix(uGroundB, uGroundC, smoothstep(0.3, 0.8, n1 * 0.5 + n2 * 0.5));
  float f = frostN(p * 0.046875 + 0.13) * 0.72 + frostN(p * 0.1875 + 0.57) * 0.28;
  float wl = fwidth(f) * 1.3 + 0.002;
  float healed = 1.0 - smoothstep(0.004, 0.004 + wl, abs(f - 0.5));
  float split = 1.0 - smoothstep(0.003, 0.003 + wl, abs(f - 0.63));
  ice = mix(ice, vec3(0.88, 0.97, 1.0), healed * 0.5 * (1.0 - far));
  ice = mix(ice, uGroundC * 0.6, split * 0.55 * (1.0 - far));
  // the snow on the route: patches of it over the ice, more of the ice
  // covered the more has settled; all snow once off the route
  float cov = snowLie(p, n1, n2);
  // (eased: the second visit still shows streaks of it, the third little)
  float th = 0.56 - 0.2 * lv * lv;
  float e = 0.028 + fw * 0.25;
  float snow = smoothstep(th - e, th + e, cov);
  float off = smoothstep(4.0, 4.5, ax);
  // it lies proud of the ice, thicker the more has settled: toward the light
  // its edge is lit, and away from it, it throws a cool shadow onto the ice
  // (p.y runs along the run, toward -z)
  vec2 L2 = normalize(vec2(uLightDir.x, -uLightDir.z) + vec2(1e-4, 0.0));
  vec2 pl = p + L2 * (0.14 + 0.3 * lv);
  float snowL = smoothstep(th - e, th + e, snowLie(pl, frostN(pl * 0.0625), frostN(pl * 0.25 + 0.31)));
  ice = mix(ice, ice * uShadowTint * 0.94, snowL * (1.0 - snow) * (1.0 - off) * 0.65);
  snow = max(snow, off);
  // white, a breath of lavender in its hollows; the wind has drawn it into
  // low ridges that run along the route (so they never strobe)
  vec3 sc = uGroundA * (0.975 + 0.04 * n2);
  sc = mix(sc, sc * vec3(0.9, 0.925, 1.0), smoothstep(0.6, 0.25, n1) * 0.3);
  float rx = p.x * 1.1 + (n1 - 0.5) * 3.0 + sin(p.y * 0.19635) * 0.5 + (n2 - 0.5) * 0.8;
  float rk = (1.0 - far * 0.8) * (1.0 - smoothstep(0.25, 0.6, fwidth(rx)));
  float rf = fract(rx);
  float lee = smoothstep(0.78, 0.93, rf) * (1.0 - smoothstep(0.95, 1.0, rf));
  sc *= 1.0 + (0.02 * rf - 0.05 * lee) * rk;
  sc *= 1.0 + 0.035 * snow * (1.0 - snowL) * (1.0 - off);
  // a cool shade where the bank meets the route
  sc *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.45, abs(ax - 4.3)));
  // hoar frost feathering the bare ice
  if (snow < 0.97 && near > 0.0) {
    float hf = hoar(p, fw * 1.2 + uMotion * 0.3);
    ice = mix(ice, vec3(0.93, 0.985, 1.0), hf * 0.6 * near * (1.0 - 0.5 * smoothstep(0.1, 0.5, uMotion)));
  }
  vec3 c = mix(ice, sc, snow);
  // the ice field, out past the bank where the canyon opens: plates of pack
  // ice, each its own white, its broken edge showing turquoise, dark water
  // in the leads between
  float open = openAt(p.y, side) * smoothstep(7.5, 10.5, ax + (n2 - 0.5) * 2.5);
  float bare = 1.0 - snow;
  if (open > 0.0) {
    vec2 pk = packIce(p / 6.0 + (vec2(n2, n1) - 0.5) * 0.3);
    float aa = fw * 0.25;
    float lead = 1.0 - smoothstep(0.03, 0.03 + aa, pk.x);
    float rim = 1.0 - smoothstep(0.03, 0.13 + aa, pk.x);
    vec3 plate = uGroundA * mix(vec3(0.9, 0.93, 1.0), vec3(1.0), pk.y) * (0.96 + 0.06 * n2);
    plate = mix(plate, mix(uGroundB, vec3(0.3, 0.8, 0.9), 0.5), rim * 0.85);
    plate = mix(plate, uGroundC * 0.42, lead);
    c = mix(c, plate, open);
    bare = mix(bare, max(rim * 0.6, lead), open);
  }
  // the runner's footprints, pressed into the snow, cool in their hollows
  vec2 grad = vec2(0.0);
  float deep = printsAt(p, smoothstep(0.004, 0.015, fw), grad) * snow;
  c = mix(c, c * uShadowTint * 0.94, clamp(deep * 22.0, 0.0, 0.8));
  gBump = vec3(-grad.x, 0.0, grad.y) * snow;
  // the odd crystal catching the light
  float sh = hash12(floor(p * 26.0));
  c += step(0.9965, sh) * (0.5 + 0.5 * sin(uTime * 4.0 + sh * 400.0)) * near * snow * 0.3;
  gSheen = bare;
  return mix(c, mix(uGroundA, uGroundB, 0.25), far * 0.4);
}
#endif
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
// Snow settling (env.snow, see Game.updateSnow): x how much has built up (0 a
// dusting, 1 as deep as it gets)
uniform vec4 uSnow;
#ifdef SNOW
// Snow lying on whatever faces up (toon option snow): x how squarely a face
// must look up to hold it while there's only a dusting, y once it lies deep,
// z how soft its edge is, w how much of it (0: none, the prop only moves)
uniform vec4 uSnowCap;
#endif
#ifdef ICE
// Glacier ice (toon option ice, on parts whose mark flag is 0.2): x how
// strongly it's banded, y its glints, z how much light it holds (its shade
// never quite dark, a glow at its edges)
uniform vec4 uIce;
#endif
#ifdef CREVASSE
// The mouth of a crevasse (toon option crevasse, on parts whose mark flag is
// 0.9; uv in metres, y from its near lip to its far one): x how wide it is,
// y how deep, z how fast its walls close in on each other (m per m down)
uniform vec4 uCrev;
#endif
` + CAUSTIC + /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hashS(vec2 p) {
  return hash12(p);
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
#ifdef LEAF
// A big leaf's face (toon option leaf, on parts whose mark flag is 0.35;
// uv.x across it, 0.5 down its midrib, uv.y from its foot to its tip - see
// monsteraLeaf in conservatory.js): a pale midrib, and pale veins running out
// from it either side, curving on toward the tip as they go, the blade a
// shade deeper between them by the rib and a shade lighter toward its edge.
// Where the lines would shimmer (far off) it settles into the leaf's tone.
// Returns how much to scale the part's colour.
float leafVeins(vec2 uv) {
  float ax = abs(uv.x - 0.5) * 2.0;
  float fw = fwidth(uv.x) + fwidth(uv.y);
  float far = smoothstep(0.05, 0.14, fw);
  float mid = 1.0 - smoothstep(0.016, 0.016 + fw, abs(uv.x - 0.5));
  mid *= smoothstep(0.02, 0.1, uv.y) * (1.0 - smoothstep(0.86, 0.97, uv.y));
  float g = (uv.y - 0.3 * ax * ax) * 7.0 + 0.25;
  float fg = fwidth(g);
  float f = fract(g);
  float side = 1.0 - smoothstep(0.05, 0.05 + fg * 1.5, abs(f - 0.5));
  side *= smoothstep(0.06, 0.16, ax) * (1.0 - smoothstep(0.72, 0.92, ax)) * smoothstep(0.08, 0.2, uv.y);
  float between = 0.5 + 0.5 * cos(f * 6.2832);
  float k = 1.0 + 0.2 * mid + 0.1 * side - 0.06 * between * (1.0 - ax) + 0.07 * ax * ax;
  return mix(k, 1.0, far);
}
#endif
#ifdef BRICK
// Brick (toon option brick, on parts whose mark flag is 0.55): laid in
// running bond in world space on whichever wall it's on, each brick its own
// shade, pale mortar between; nothing on the faces that look up or down.
// Where the courses would shimmer (far off) it settles into the wall's tone.
vec3 brickBond(vec3 n) {
  vec3 an = abs(n);
  if (an.y > max(an.x, an.z)) return vec3(1.0);
  vec2 q = an.x > an.z ? vPos.zy : vPos.xy;
  vec2 bs = vec2(0.4, 0.125);
  vec2 g = q / bs;
  g.x += mod(floor(g.y), 2.0) * 0.5;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float h = hash12(cell + 5.0);
  vec2 e = min(f, 1.0 - f) * bs;
  float aa = max(fwidth(q.x), fwidth(q.y));
  float w = 0.011;
  float mortar = 1.0 - smoothstep(w - aa, w + aa, min(e.x, e.y));
  float far = smoothstep(0.025, 0.07, aa);
  vec3 c = vec3(0.84 + 0.26 * h, 0.85 + 0.22 * h, 0.86 + 0.18 * h);
  c = mix(c, vec3(1.32, 1.26, 1.18), mortar * 0.75);
  return mix(c, vec3(1.0), far);
}
// A tower's windows (parts marked 0.45): a grid of them on every wall, in
// world space, a share lit warm (and the odd one the blue of a television),
// lighting themselves (gEmit); the rest dark glass. Far off, the grid
// settles into a twinkle of lit and dark.
vec3 towerWindows(vec3 n, vec3 base) {
  vec3 an = abs(n);
  if (an.y > max(an.x, an.z)) return base;
  vec2 q = an.x > an.z ? vPos.zy : vPos.xy;
  vec2 ws = vec2(1.6, 3.2);
  vec2 g = q / ws;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float aa = max(fwidth(g.x), fwidth(g.y));
  vec2 e = min(f - vec2(0.2, 0.22), vec2(0.8, 0.82) - f);
  float pane = smoothstep(-aa, aa, min(e.x, e.y));
  pane = mix(pane, 0.36, smoothstep(0.12, 0.35, aa));
  float h = hash12(cell + 11.0);
  float lit = step(0.6, h);
  vec3 warm = mix(vec3(1.0, 0.74, 0.38), vec3(1.0, 0.9, 0.62), fract(h * 7.0));
  if (fract(h * 13.0) > 0.92) warm = vec3(0.6, 0.78, 1.0);
  vec3 glass = mix(base * 0.4, warm * 1.1, lit);
  gEmit = max(gEmit, pane * lit);
  return mix(base, glass, pane);
}
#endif
#ifdef SHELVES
#ifndef GROUND
uniform float uMotion;
#endif
// Shelves of books (toon option shelves, on parts whose mark flag is 0.7 -
// along the run - or 0.75 - across it; uv in metres, x along the shelf, y
// up): a board every 0.62 m and a row of books standing on each, every one
// its own width and height and its own leather - oxblood, navy, bottle
// green, tan, black, a cream vellum now and then - its spine rounded in the
// light, gilt bands at head and foot, now and then a paper label; above the
// shorter ones the dark back of the shelf, and the board's front edge
// catching the light. Where the spines would shimmer (far off, or rushing
// past at speed) it settles into the shelf's own tone.
vec3 bookCol(float h) {
  if (h < 0.16) return vec3(0.46, 0.1, 0.08);
  if (h < 0.3) return vec3(0.12, 0.17, 0.36);
  if (h < 0.42) return vec3(0.12, 0.28, 0.16);
  if (h < 0.55) return vec3(0.55, 0.36, 0.2);
  if (h < 0.64) return vec3(0.08, 0.06, 0.06);
  if (h < 0.74) return vec3(0.62, 0.18, 0.12);
  if (h < 0.82) return vec3(0.82, 0.74, 0.58);
  if (h < 0.9) return vec3(0.3, 0.12, 0.26);
  return vec3(0.7, 0.5, 0.18);
}
vec3 bookSpines(vec2 p, float dist, float along) {
  float sh = 0.62;
  float row = floor(p.y / sh);
  float fy = p.y - row * sh;
  float bw = 0.105;
  float u = p.x / bw + hashS(vec2(row, 3.7)) * 9.0;
  float cell = floor(u);
  float f = fract(u);
  float h1 = hashS(vec2(cell, row));
  float h2 = hashS(vec2(cell, row + 17.0));
  float h3 = hashS(vec2(cell + 5.0, row - 3.0));
  // books stand in sets - a run of a dozen or so volumes bound alike - so
  // even where the spines blur together the shelves read as bands of colour
  float su = u / 14.0 + hashS(vec2(row, 9.1)) * 3.0;
  float setH = hashS(vec2(floor(su), row + 41.0));
  vec3 setC = bookCol(setH) * (0.9 + 0.2 * hashS(vec2(floor(su), row + 7.0)));
  float boardH = 0.05;
  float bh = boardH + sh * mix(0.6 + 0.3 * h2, 0.78 + 0.08 * h2, step(0.35, setH));
  vec3 back = vec3(0.07, 0.045, 0.035);
  vec3 col = mix(setC, bookCol(h1), step(0.72, h1) * 0.85) * (0.85 + 0.3 * h3);
  // the spine rounded in the light, a crease at each side
  col *= 0.7 + 0.42 * sin(3.14159 * f);
  // gilt bands at head and foot, a label in the middle now and then
  float y = (fy - boardH) / (bh - boardH);
  float gilt = step(0.35, h2) * (smoothstep(0.83, 0.85, y) * (1.0 - smoothstep(0.88, 0.9, y)) + smoothstep(0.1, 0.12, y) * (1.0 - smoothstep(0.15, 0.17, y)));
  col = mix(col, vec3(0.92, 0.72, 0.32), gilt * 0.85);
  float label = step(0.72, h3) * smoothstep(0.52, 0.54, y) * (1.0 - smoothstep(0.68, 0.7, y)) * smoothstep(0.18, 0.24, f) * (1.0 - smoothstep(0.76, 0.82, f));
  col = mix(col, vec3(0.9, 0.84, 0.7), label);
  // above the book, the shelf's dark back; a gap where a book's been taken
  float gap = step(0.94, h3);
  col = fy > bh || gap > 0.5 ? back : col;
  // the board, its front edge catching the light
  vec3 wood = vec3(0.36, 0.21, 0.12);
  float board = 1.0 - step(boardH, fy);
  col = mix(col, wood * (1.0 + 0.4 * smoothstep(0.0, boardH, fy)), board);
  // settle into the set's own tone where the spines would shimmer, and
  // into the shelf's where even the sets do
  vec3 avg = mix(vec3(0.36, 0.23, 0.16), back, 0.15);
  vec3 setAvg = mix(setC * 0.88, back, 0.15);
  float fw = fwidth(u);
  float soft = max(smoothstep(0.3, 0.9, fw), along * smoothstep(0.6, 2.4, uMotion / bw));
  float setSoft = smoothstep(0.4, 1.2, fw / 14.0);
  vec3 blur = mix(setAvg, avg, setSoft);
  col = mix(col, mix(blur, wood, board * 0.5), soft);
  // (and the rows themselves, once they're too fine to tell apart)
  float rowSoft = smoothstep(0.25, 0.7, fwidth(p.y / sh));
  return mix(col, avg * 0.9, rowSoft);
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
` + SANDS_FS + FROST_FS + /* glsl */ `
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
  #elif GROUND == 14
    // a New York roof: tar paper rolled out in strips across the run, their
    // lapped seams, patches of fresher tar, grit, and here and there a
    // puddle left by the rain giving back the sky (gSheen). (p.y runs on from
    // chunk to chunk: every period divides the 4096 m it wraps at.)
    float soften = max(smoothstep(0.25, 0.9, fwidth(p.x) * 9.0), smoothstep(0.2, 0.6, uMotion / 0.42));
    float sw = 1.0;
    float row = floor(p.y / sw);
    float h = hash12(vec2(row, 13.0));
    float wash = texture2D(uNoise, p * 0.25).g;
    vec3 c = mix(uGroundA, uGroundB, h * 0.55 + wash * 0.45);
    float fy = fract(p.y / sw);
    float aa = fwidth(p.y) * 1.2;
    // the lap: a thin dark line, a pale lip just past it
    float seam = runLine(fy * sw, 0.018, aa) + runLine((1.0 - fy) * sw, 0.008, aa);
    c = mix(c, uGroundC, min(seam, 1.0) * 0.75 * (1.0 - far));
    c = mix(c, c * 1.12, runLine(abs(fy * sw - 0.05), 0.02, aa) * 0.6 * (1.0 - far));
    float patchy = texture2D(uNoise, p * 0.0625 + 0.31).g;
    c = mix(c, uGroundC * 1.4, smoothstep(0.64, 0.67, patchy) * 0.4);
    // grit
    float grit = hash12(floor(p * 16.0));
    c *= mix(0.9 + 0.2 * grit, 1.0, soften);
    // puddles
    float pud = texture2D(uNoise, p * 0.125 + 0.73).g;
    float wet = smoothstep(0.7, 0.73, pud) * (1.0 - smoothstep(3.6, 4.0, abs(p.x)));
    c = mix(c, uGroundC, wet * 0.45);
    gSheen = wet * 1.7;
    c = mix(c, avg, far * 0.5);
    float border = smoothstep(3.95, 4.3, abs(p.x));
    return mix(c, uGroundC, border);
  #elif GROUND == 13
    // the Glasshouse's path: old square stone pavers laid in staggered
    // courses, worn and damp, moss grown into every joint and creeping in
    // over the edges from the beds in patches. (p.y runs on from chunk to
    // chunk, so every period here divides the 4096 m it wraps at.)
    vec2 cs = vec2(0.62, 0.5);
    vec2 q = p / cs;
    q.x += mod(floor(q.y), 2.0) * 0.5;
    vec2 cell = floor(q);
    float h = hash12(cell + 29.0);
    float wear = texture2D(uNoise, p * 0.25).g;
    vec3 c = mix(uGroundA, uGroundB, h * 0.65 + wear * 0.35);
    // (now and then a paver gone green all over)
    c = mix(c, mix(c, uGroundC, 0.3), step(0.93, h));
    float joint = mix(edgeMaskRun(fract(q), cs, 0.024), 1.0, far * 0.8);
    c = mix(mix(uGroundC * 0.85, c, 0.3), c, joint);
    float patchy = texture2D(uNoise, p * 0.125).g;
    float creep = smoothstep(2.9, 4.2, abs(p.x) + (patchy - 0.5) * 1.8);
    c = mix(c, uGroundC * (0.8 + wear * 0.4), creep * (1.0 - far * 0.5));
    c = mix(c, avg, far * 0.55);
    float border = smoothstep(3.95, 4.35, abs(p.x));
    return mix(c, uGroundC * 0.75, border);
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
    // the grass isn't one even sward: broad patches of deeper moss and
    // brighter clover drift through it (32 m and 8 m swells)
    float swell = texture2D(uNoise, p * 0.03125 + 0.17).g * 0.65 + texture2D(uNoise, p * 0.125 + 0.53).g * 0.35;
    c *= mix(0.8, 1.16, smoothstep(0.28, 0.72, swell));
    float mossy = smoothstep(0.6, 0.78, texture2D(uNoise, p * 0.0625 + 0.71).g);
    c = mix(c, uGroundA * vec3(0.78, 0.95, 0.72), mossy * 0.55 * (1.0 - far));
    // the path: packed darker down the middle where the feet go, dry and pale
    // at its shoulders, and grained with the noise
    vec3 earth = uGroundC * (0.85 + texture2D(uNoise, p * 0.25).g * 0.3);
    float mid = abs(p.x - wander) / pw;
    earth *= mix(0.84, 1.1, smoothstep(0.15, 0.85, mid)) * (0.92 + 0.16 * texture2D(uNoise, vec2(p.x * 2.0, p.y * 0.5) + 0.4).g);
    // roots of the great trees snaking across it, now and then (one in three
    // 8 m stretches), each lit along its top edge
    float rcell = floor(p.y * 0.125);
    float rh = hash12(vec2(rcell, 17.0));
    float ry = (rcell + 0.25 + 0.5 * hash12(vec2(rcell, 29.0))) * 8.0 + sin(p.x * 1.7 + rh * 6.0) * 0.28 + (p.x - wander) * (rh - 0.5) * 0.5;
    float rw = (0.07 + 0.05 * rh) * (1.0 - smoothstep(0.3, 1.25, mid) * 0.55);
    float rd = p.y - ry;
    float raa = fwidth(p.y) * 1.5;
    float root = (1.0 - smoothstep(rw - raa, rw + raa, abs(rd))) * step(0.62, rh);
    vec3 rootC = mix(uGroundC * 0.42, uGroundC * 1.35 + vec3(0.04, 0.03, 0.02), smoothstep(-rw, rw, -rd));
    earth = mix(earth * (1.0 - 0.35 * (1.0 - smoothstep(rw, rw + 0.12, abs(rd))) * step(0.62, rh)), rootC, root);
    // pebbles: small and round, a lit top, a dark rim where they sit
    vec2 pq = p / 0.25;
    vec2 pc = floor(pq);
    float ph = hash12(pc + 61.0);
    vec2 po = vec2(hash12(pc + 2.3), hash12(pc + 8.9)) * 0.6 + 0.2;
    vec2 pd = (fract(pq) - po) * vec2(1.0, 1.35);
    float pr = 0.12 + 0.12 * hash12(pc + 4.4);
    float pl = length(pd);
    float paa = fwidth(pq.x) * 1.2;
    float peb = (1.0 - smoothstep(pr - paa, pr + paa, pl)) * step(0.86, ph);
    vec3 stoneC = mix(vec3(0.36, 0.37, 0.33), vec3(0.62, 0.6, 0.52), hash12(pc + 9.0)) * (0.75 + 0.5 * smoothstep(pr, -pr, pd.y + pd.x * 0.3));
    earth = mix(earth * (1.0 - 0.45 * (1.0 - smoothstep(pr, pr * 1.6, pl)) * step(0.86, ph)), stoneC, peb);
    // fallen leaves littering the path and drifting in at its edges: little
    // pointed ovals turned every way, olive, ochre and rust
    vec2 lq = p / 0.5;
    vec2 lc = floor(lq);
    float lh = hash12(lc + 83.0);
    vec2 lo = vec2(hash12(lc + 5.1), hash12(lc + 12.7)) * 0.6 + 0.2;
    float la = hash12(lc + 31.0) * 6.2832;
    vec2 ld = fract(lq) - lo;
    ld = vec2(cos(la) * ld.x - sin(la) * ld.y, sin(la) * ld.x + cos(la) * ld.y);
    float lw = 0.11 * (1.0 - (ld.x / 0.24) * (ld.x / 0.24));
    float laa = fwidth(lq.x) * 1.2;
    float leafM = (1.0 - smoothstep(lw - laa, lw + laa, abs(ld.y))) * step(abs(ld.x), 0.24);
    vec3 leafC = lh > 0.86 ? vec3(0.55, 0.3, 0.12) : lh > 0.72 ? vec3(0.62, 0.48, 0.18) : vec3(0.34, 0.38, 0.14);
    leafC *= 0.8 + 0.35 * smoothstep(-0.2, 0.2, ld.x) - 0.25 * (1.0 - smoothstep(0.0, 0.015, abs(ld.y)));
    float onPath = smoothstep(-0.6, 0.1, -edge + 0.35);
    float showLeaf = leafM * step(0.58, lh) * onPath * (1.0 - soften * 0.6);
    earth = mix(earth, leafC, showLeaf * (1.0 - far));
    c = mix(c, earth, dirt * (1.0 - far * 0.4));
    // and leaves blown in over the grass at the path's edge
    c = mix(c, leafC, showLeaf * (1.0 - dirt) * 0.8 * (1.0 - far));
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
  #elif GROUND == 10
    return sandGround(p, dist, far);
  #elif GROUND == 15
    return frostGround(p, dist, far);
  #elif GROUND == 12
    // The Sky Road: a processional way. Down its middle a band of lapis
    // strewn with gold stars like the ceiling of a tomb, gilt-edged; either
    // side of it great slabs of painted limestone, faintly veined; and along
    // each edge a border of painted bands - red, gold, lapis, gold, green -
    // the way a temple wall is framed. The bands all run along the road, so
    // they never strobe; the stars and the slab joints smear at speed.
    // (p.y runs on from chunk to chunk; every period divides 4096 m.)
    float ax = abs(p.x);
    float aa = fwidth(p.x) + 0.004;
    vec2 cs = vec2(2.6, 3.2);
    vec2 q = vec2(p.x + 1.3, p.y) / cs;
    q.y += mod(floor(q.x), 2.0) * 0.5;
    vec2 cell = floor(q);
    float h = hash12(cell + 9.0);
    vec3 c = mix(uGroundA, uGroundB, 0.3 + h * 0.5);
    float vein = texture2D(uNoise, p * vec2(0.09375, 0.0390625) + h * 0.37).g;
    c *= 0.94 + 0.12 * vein;
    c = mix(mix(uGroundC, c, 0.6), c, mix(edgeMaskRun(fract(q), cs, 0.022), 1.0, far * 0.8));
    // the lapis band and its stars
    vec3 lapis = vec3(0.12, 0.22, 0.56);
    vec3 gold = vec3(0.95, 0.76, 0.28);
    float band = 1.0 - smoothstep(0.62 - aa, 0.62 + aa, ax);
    vec2 sq = vec2(p.x / 0.62, p.y / 1.0);
    vec2 sc = floor(sq);
    vec2 sf = fract(sq) - 0.5;
    sf.x += (hash12(sc + 3.0) - 0.5) * 0.3;
    float ang = atan(sf.y, sf.x);
    float r = length(sf * vec2(1.0, 0.62));
    float star = 1.0 - smoothstep(0.06 + 0.07 * pow(0.5 + 0.5 * cos(ang * 5.0), 2.0), 0.08 + 0.07 * pow(0.5 + 0.5 * cos(ang * 5.0), 2.0) + aa * 2.0, r);
    star *= 1.0 - smoothstep(0.08, 0.3, uMotion) * 0.6;
    vec3 lap = mix(lapis, gold, star * 0.9);
    c = mix(c, mix(lap, lapis * 1.1, far * 0.6), band);
    float gilt = 1.0 - smoothstep(0.035, 0.035 + aa, abs(ax - 0.66));
    c = mix(c, gold, gilt);
    // the painted border along each edge
    if (ax > 3.4) {
      float bx = ax - 3.4;
      vec3 bc = bx < 0.12 ? vec3(0.12, 0.08, 0.06)
        : bx < 0.3 ? vec3(0.72, 0.22, 0.15)
        : bx < 0.38 ? gold
        : bx < 0.62 ? lapis
        : bx < 0.7 ? gold
        : bx < 0.88 ? vec3(0.2, 0.5, 0.34)
        : vec3(0.12, 0.08, 0.06);
      // a row of little upright bars in the lapis, like a frieze
      float fr = step(0.38, bx) * step(bx, 0.62) * step(0.5, fract(p.y / 0.25)) * (1.0 - smoothstep(0.04, 0.1, uMotion));
      bc = mix(bc, gold, fr * 0.6);
      c = mix(c, bc, smoothstep(0.0, aa * 2.0, bx));
    }
    return c;
  #elif GROUND == 11
    // The Red Drift: regolith - half Mars, half moon. Rust-red sand drifted
    // in soft mottles, flats of grey-violet basalt showing through it,
    // craters great and small (each bowl shaded away from the sun, its far
    // wall and raised rim catching the light, a splash of pale ejecta round
    // the big ones), rocks and pebbles scattered over it all, and out beyond
    // the road the sand blown into ripples. Down the middle, where everyone
    // runs, the dust is trodden fine and pale. (p.y runs on from chunk to
    // chunk; every period divides the 4096 m it wraps at.)
    float n1 = texture2D(uNoise, p * 0.03125).g;
    float n2 = texture2D(uNoise, p * 0.125 + 0.31).g;
    float n3 = texture2D(uNoise, p * 0.5 + 0.67).g;
    float n4 = texture2D(uNoise, p * 2.0 + 0.13).g;
    vec3 c = mix(uGroundA, uGroundB, smoothstep(0.28, 0.78, n1 * 0.6 + n2 * 0.4));
    // the moon showing through: grey-violet basalt flats
    float flats = smoothstep(0.58, 0.7, n1 * 0.75 + n2 * 0.25) * smoothstep(3.0, 7.0, abs(p.x));
    vec3 basalt = mix(uGroundC, vec3(0.5, 0.44, 0.5), 0.45) * (0.85 + 0.3 * n3);
    c = mix(c, basalt, flats * 0.8);
    c *= 0.86 + 0.28 * n3 * (1.0 - far * 0.6) + 0.08 * (n4 - 0.5) * (1.0 - far);
    // the road: trodden fine and pale, its edges frayed
    float edgeN = (n2 - 0.5) * 1.4 + (n3 - 0.5) * 0.6;
    float road = 1.0 - smoothstep(3.4, 5.0, abs(p.x) + edgeN);
    vec3 trod = mix(uGroundB, vec3(1.0, 0.86, 0.74), 0.16) * (0.93 + 0.1 * n3 + 0.05 * n4);
    c = mix(c, trod, road * 0.78 * (1.0 - far * 0.35));
    // ripples blown into the sand out beyond the road (they run along it,
    // so they never strobe)
    float rx = p.x * 1.6 + sin(p.y * 0.0981748) * 1.4 + (n2 - 0.5) * 4.0;
    float rip = sin(rx * 3.14159) * (1.0 - smoothstep(0.35, 1.0, fwidth(rx)));
    c *= 1.0 + rip * 0.07 * (1.0 - road) * (1.0 - flats) * (1.0 - far * 0.8);
    // craters: small ones everywhere (fainter on the road), big ones off it
    // (the sun across the ground: p.y runs along the run, toward -z)
    vec2 L2 = normalize(vec2(uLightDir.x, -uLightDir.z) + vec2(1e-4, 0.0));
    for (int k = 0; k < 2; k++) {
      float S = k == 0 ? 8.0 : 32.0;
      vec2 cq = p / S;
      vec2 cell = floor(cq);
      float h = hash12(cell + 37.0 + float(k) * 17.0);
      if (h < (k == 0 ? 0.55 : 0.45)) continue;
      vec2 o = vec2(hash12(cell + 2.7), hash12(cell + 9.4)) * 0.5 + 0.25;
      float R = S * (k == 0 ? 0.1 + 0.14 * hash12(cell + 5.1) : 0.12 + 0.12 * hash12(cell + 5.1));
      vec2 dv = (fract(cq) - o) * S;
      float rr = length(dv) / R;
      if (rr > 2.2) continue;
      float side = dot(dv / max(length(dv), 1e-3), L2);
      float onRoad = k == 0 ? 0.45 : 0.0;
      float keep = mix(1.0, onRoad, road);
      // the bowl: in shade on the side toward the sun, its far wall lit
      float bowl = 1.0 - smoothstep(0.92, 1.0, rr);
      float wall = smoothstep(0.25, 0.95, rr) * bowl;
      float shade = 1.0 - 0.42 * wall * smoothstep(-0.3, 0.7, side) + 0.2 * wall * smoothstep(-0.2, -0.9, side);
      shade *= 1.0 - 0.1 * bowl;
      // the raised rim, lit on its sunward face and shaded behind
      float rim = exp(-pow((rr - 1.04) / 0.11, 2.0));
      shade *= 1.0 + rim * (0.12 + 0.12 * side);
      // ejecta: a pale splash round the big ones
      float ej = (1.0 - smoothstep(1.0, 2.1, rr)) * step(1.0, rr) * float(k) * (0.6 + 0.4 * n4);
      vec3 cc = c * shade;
      cc = mix(cc, mix(uGroundB, vec3(1.0, 0.9, 0.82), 0.3), ej * 0.22);
      c = mix(c, cc, keep * (1.0 - far * 0.7));
    }
    // rocks and pebbles: dark on the sand, a sunlit cap on each
    vec2 sq = p / 0.5;
    vec2 sc = floor(sq);
    float sh = hash12(sc + 23.0);
    vec2 so = vec2(hash12(sc + 3.3), hash12(sc + 6.6)) * 0.6 + 0.2;
    vec2 sd = (fract(sq) - so) * vec2(1.0, 1.0 + 0.6 * hash12(sc + 1.9));
    float sr = 0.05 + 0.1 * hash12(sc + 4.4);
    float sfa = fwidth(sq.x) + 0.02;
    float pebble = (1.0 - smoothstep(sr - sfa, sr + sfa, length(sd))) * step(mix(0.82, 0.93, road), sh) * (1.0 - far);
    float cap = smoothstep(-0.2, 0.6, dot(normalize(sd + 1e-4), L2));
    vec3 pc = mix(uGroundC * 0.9, mix(uGroundC, uGroundB, 0.6), cap);
    c = mix(c, pc, pebble);
    return mix(c, mix(uGroundA, uGroundC, 0.25), far * 0.45);
  #elif GROUND == 16
    // the Hall of Doors: dark old floorboards laid wall to wall along the
    // run, storybook-whimsical - their seams wandering in long slow waves,
    // deep dark grooves between them with a worn pale lip beside each, the
    // grain streaked along every board, board ends staggered, now and then a
    // knot curled up into a spiral, a crack or two. Kept dark so the books,
    // chairs and doors stand out against it. (p.y runs on from chunk to
    // chunk: every period divides the 4096 m it wraps at.)
    float soften = max(smoothstep(0.25, 0.9, fwidth(p.x) * 9.0), smoothstep(0.2, 0.6, uMotion / 0.42));
    float fade = (1.0 - far) * (1.0 - soften * 0.6);
    float n1 = texture2D(uNoise, p * vec2(0.125, 0.0625)).g;
    float n2 = texture2D(uNoise, p * vec2(0.5, 0.125) + 0.31).g;
    // the seams wander: a slow wave down the run, bent differently across it
    float wx = p.x + (n1 - 0.5) * 0.7 + sin(p.y * 0.3926991 + p.x * 0.9) * 0.12;
    float pw = 0.78;
    float bi = floor(wx / pw);
    float fx = fract(wx / pw);
    // board ends, staggered board to board
    float bl = 4.0;
    float by = p.y / bl + hash12(vec2(bi, 5.0));
    float seg = floor(by);
    float fy = fract(by);
    float h = hash12(vec2(bi, seg) + 41.0);
    float wash = texture2D(uNoise, p * 0.25 + 0.57).g;
    vec3 c = mix(uGroundA, uGroundB, h * 0.55 + wash * 0.45);
    // grain: long streaks along the board, lighter and darker
    float gr = texture2D(uNoise, vec2(wx * 2.0 + h * 7.0, p.y * 0.0625)).g;
    float streak = smoothstep(0.35, 0.75, gr);
    c *= mix(1.0, 0.82 + 0.36 * streak, fade);
    float fine = sin((wx * 26.0 + (gr - 0.5) * 9.0) );
    c *= 1.0 + fine * 0.035 * fade * (1.0 - smoothstep(0.3, 1.0, fwidth(wx * 26.0)));
    // the grooves between boards, wider here and narrower there, and a worn
    // pale lip along each one's lit side
    float ex = min(fx, 1.0 - fx) * pw;
    float gw = 0.02 + 0.03 * n2;
    float aa = fwidth(wx) * 1.2;
    float groove = 1.0 - smoothstep(gw - aa, gw + aa, ex);
    float lip = (1.0 - smoothstep(gw, gw + 0.07 + aa, fx * pw)) * step(gw, fx * pw);
    c = mix(c, c * 1.28 + uGroundA * 0.08, lip * 0.55 * fade);
    // the board ends: a dark joint across the board
    float ey = min(fy, 1.0 - fy) * bl;
    float joint = runLine(ey, 0.014, fwidth(p.y) * 1.2);
    // a knot curled into a spiral, one board in every few
    vec2 kc = vec2((bi + 0.3 + 0.4 * hash12(vec2(seg, bi) + 3.0)) * pw, (seg + 0.25 + 0.5 * hash12(vec2(bi, seg) + 9.0) - hash12(vec2(bi, 5.0))) * bl);
    vec2 kd = vec2(wx, p.y) - kc;
    kd.y *= 0.8;
    float kr = length(kd);
    float hasKnot = step(0.72, hash12(vec2(bi, seg) + 77.0));
    float kR = 0.13 + 0.07 * hash12(vec2(seg, bi) + 13.0);
    float ang = atan(kd.y, kd.x) / 6.2831853;
    float turns = kr / kR * 2.3 - ang;
    float sp = abs(fract(turns) - 0.5) * 2.0;
    float coil = (1.0 - smoothstep(0.55, 0.8, sp)) * (1.0 - smoothstep(kR * 0.85, kR, kr)) * smoothstep(0.012, 0.03, kr);
    coil *= 1.0 - smoothstep(0.3, 1.0, fwidth(turns));
    // the wood round a knot swells darker, the grain bent round it
    c = mix(c, uGroundB * 0.85, (1.0 - smoothstep(kR * 0.6, kR * 1.9, kr)) * 0.45 * hasKnot);
    // cracks: thin and jagged, running a little way along the grain
    float ck = texture2D(uNoise, vec2(wx * 2.0 + 0.11, p.y * 0.0625)).g;
    float cw = fwidth(ck);
    float c0 = 0.2 + 0.6 * hash12(vec2(seg, bi) + 31.0);
    float crack = (1.0 - smoothstep(cw * 0.5, cw * 1.5, abs(ck - 0.5))) * step(0.8, hash12(vec2(bi, seg) + 23.0)) * smoothstep(0.15, 0.3, fx) * smoothstep(0.15, 0.3, 1.0 - fx) * (1.0 - smoothstep(0.04, 0.16, abs(fy - c0)));
    float dark = max(max(groove, joint * (1.0 - groove)), max(coil * hasKnot, crack) * fade);
    c = mix(c, uGroundC, dark * 0.92);
    // a little warmth and a little cold, painted in patches
    c *= 0.9 + 0.2 * n1;
    return mix(c, mix(uGroundA, uGroundB, 0.5) * 0.85, far * 0.6);
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
    #if GROUND == 10 || GROUND == 15
      // the sand's own relief (footprints, the lip of the loose sand), and a
      // soft form shading so its drifts and piles read in any light: lighter
      // turned toward the light than the flat floor is, shaded turned away
      // (and the same for the Frostbound Pass's snow and its banks)
      n = normalize(n + gBump);
      float sl = dot(n, uLightDir) - uLightDir.y;
      base *= mix(0.86, 1.06, smoothstep(-0.35, 0.2, sl));
      base = mix(base, base * uShadowTint, 0.6 * smoothstep(-0.12, -0.38, sl));
    #endif
  #else
    vec3 base = vColor;
  #endif
  #ifdef SHELVES
    if (vFx.x > 0.68 && vFx.x < 0.77) {
      base = bookSpines(vUv, dist, vFx.x < 0.72 ? 1.0 : 0.0) * mix(vec3(1.0), vColor, 0.25);
    }
  #endif
  // (ice and the mouth of a crevasse wear no scribble marks)
  float markK = 1.0;
  #ifdef ICE
    float isIce = step(abs(vFx.x - 0.2), 0.02);
    if (isIce > 0.0) {
      // glacier ice, laid down in bands year on year, tilted and wavering: a
      // darker line between one and the next, each band its own depth of
      // blue, and paler streaks of trapped air running through it. (Along
      // the run every scale is a multiple of 1/512, so nothing jumps when
      // the world re-bases.) Where the bands would shimmer it settles into
      // the ice's own tone.
      float w1 = texture2D(uNoise, vPos.xz * 0.0546875 + vPos.y * 0.03).g;
      float sy = vPos.y * 0.5 + vPos.x * 0.09 + vPos.z * 0.0546875 + (w1 - 0.5) * 2.2;
      float bf = fract(sy);
      float fwB = fwidth(sy);
      float soft = smoothstep(0.25, 0.7, fwB);
      float line = (1.0 - smoothstep(0.03, 0.03 + fwB * 1.5, min(bf, 1.0 - bf))) * (1.0 - soft);
      float tone = mix(hash12(vec2(mod(floor(sy), 28.0), 3.7)), 0.5, soft);
      base *= 1.0 + ((tone - 0.5) * 0.2 - line * 0.16) * uIce.x;
      float air = texture2D(uNoise, vec2(vPos.x * 0.09 + vPos.z * 0.0546875, vPos.y * 0.9)).g;
      base = mix(base, base * 1.12 + 0.03, smoothstep(0.62, 0.78, air) * 0.5 * uIce.x * (1.0 - soft));
    }
    markK = 1.0 - isIce;
  #endif
  #ifdef CREVASSE
    float isCrev = step(0.85, vFx.x);
    markK *= 1.0 - isCrev;
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
        float m = texture2D(uMarks, vUv * uMarkRepeat).a * vFx.x * markK;
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
      float m = texture2D(uMarks, vUv * uMarkRepeat).a * vFx.x * markK;
      #ifdef SHELVES
        if (vFx.x > 0.68 && vFx.x < 0.77) m = 0.0;
      #endif
      #ifdef LEAF
        if (abs(vFx.x - 0.35) < 0.02) {
          m = 0.0;
          base *= leafVeins(vUv);
        }
      #endif
      #ifdef BRICK
        if (abs(vFx.x - 0.55) < 0.02) {
          m = 0.0;
          base *= brickBond(n);
        } else if (abs(vFx.x - 0.45) < 0.02) {
          m = 0.0;
          base = towerWindows(n, base);
        }
      #endif
      base = mix(base, base * 0.64, m);
    #endif
  #endif
  #ifdef SNOW
    {
      // snow lying on whatever faces up, its edge ragged; the more has
      // settled, the steeper the faces it clings to
      float sn = texture2D(uNoise, vPos.xz * 0.109375 + vPos.y * 0.07).g;
      float th = mix(uSnowCap.x, uSnowCap.y, uSnow.x);
      float lying = smoothstep(th, th + uSnowCap.z, n.y + (sn - 0.5) * 0.3) * uSnowCap.w * step(vFx.y, 0.5);
      base = mix(base, vec3(0.955, 0.972, 1.0) * (0.97 + 0.05 * sn), lying);
    }
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
  #ifdef GROUND
    #if GROUND == 10 || GROUND == 14
      // wet sand just bared by the backwash (a puddle on a roof) shines
      // with the sky
      if (gSheen > 0.0) col = mix(col, skyColor(reflect(V, vec3(0.0, 1.0, 0.0))) * 1.1 + 0.05, gSheen * 0.28);
    #endif
    #if GROUND == 15
      // bare ice gives back the sky, more and more toward the horizon
      if (gSheen > 0.0) col = mix(col, skyColor(reflect(V, vec3(0.0, 1.0, 0.0))) * 1.05 + 0.04, gSheen * (0.1 + 0.5 * pow(1.0 - abs(V.y), 4.0)));
    #endif
  #endif
  #ifdef ICE
    if (isIce > 0.0) {
      // ice holds the light: its shade is never quite dark, its edges glow,
      // and a facet turned just so flashes white. (No refraction: one more
      // term in the same pass.)
      col = mix(col, base * mix(shade, vec3(1.0), 0.5), 0.6 * uIce.z);
      float gl = pow(max(dot(reflect(V, n), uLightDir), 0.0), 26.0);
      float fr = pow(1.0 - abs(dot(n, V)), 2.5);
      col += vec3(0.86, 0.97, 1.0) * gl * 0.8 * uIce.y + mix(uRim.rgb, vec3(0.5, 0.92, 1.0), 0.6) * fr * 0.24 * uIce.z;
    }
  #endif
  #ifdef CREVASSE
    if (isCrev > 0.0) {
      // The mouth of a crevasse, a flat band across the route: what shows in
      // it is worked out from where the eye's ray would land on its far wall
      // (the walls lean in on each other going down) - the pale lip, then
      // turquoise, cobalt, and blue-black far down - so it reads as a line of
      // bright ice from far off and opens into the deep as you come up to it.
      float W = uCrev.x;
      float s0 = clamp(vUv.y, 0.0, W);
      float fz = max(-V.z, 0.05);
      float dn = max(-V.y, 0.02);
      float tau = (W - s0) / (fz + uCrev.z * dn);
      float dep = dn * tau;
      float wn = texture2D(uNoise, vec2((vPos.x + V.x * tau) * 0.125, dep * 0.11)).g;
      float k = clamp(dep / uCrev.y + (wn - 0.5) * 0.22, 0.0, 1.0);
      // (kept dark on purpose, so a crack reads as a crack from far off: a
      // sliver of pale ice at the lip, then straight down into the blue)
      vec3 cw = mix(vec3(0.7, 0.95, 0.99), vec3(0.16, 0.62, 0.84), smoothstep(0.0, 0.08, k));
      cw = mix(cw, vec3(0.06, 0.26, 0.66), smoothstep(0.08, 0.35, k));
      cw = mix(cw, vec3(0.02, 0.05, 0.2), smoothstep(0.3, 0.85, k));
      // strata down the wall
      float band = abs(fract(dep * 1.7 + wn * 1.5) - 0.5);
      cw *= 1.0 - 0.16 * (1.0 - smoothstep(0.04, 0.1, band)) * (1.0 - k);
      col = cw * mix(uShadowTint, vec3(1.0), 0.75);
    }
  #endif

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

  #ifdef SANDFALL
    // a curtain of sand pouring down (the Gallery of Hours' cornices, gears
    // and ledges): streaks of paler and darker grain sliding down it, a
    // glitter caught in them, and a little light of its own so it reads
    // against the shade
    vec2 sq = vec2((vPos.x + vPos.z) * 0.55, vPos.y * 0.07 + uTime * 0.55);
    float sf1 = texture2D(uNoise, sq).g;
    float sf2 = texture2D(uNoise, sq * vec2(2.4, 1.6) + vec2(0.37, uTime * 0.31)).g;
    float streak = smoothstep(0.3, 0.78, sf1 * 0.62 + sf2 * 0.48);
    col *= 0.8 + 0.42 * streak;
    col += vec3(1.0, 0.92, 0.7) * smoothstep(0.8, 0.87, sf2) * 0.3;
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
#ifdef SHELL
// Fur (the fox's): the surface again, a few times over, each layer lifted off
// it along its normal by a share of how long the fur grows there (aD.w), and
// combed: bent along uFurWind.xyz (the lie of the fur, gravity and the wind
// through it; world space, m per m of fur) more toward the tips. The
// fragment shader thins each layer to strands.
attribute float aShell; // 0..1: which layer
uniform vec4 uFurWind; // xyz the comb, w how long the fur is (a scale on aD.w)
varying float vShell;
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
#ifdef SKATER
// the skater's tee (and her shorts' legs) rippling in the wind: x how far
// (m), y the waves' clock, z how hard the wind is
uniform vec4 uFlutter;
#endif

void main() {
  vec3 lp = position;
  vec3 ln = normal;
  #ifdef OUTLINE
    vec3 lo = onrm;
  #endif
  #if defined(SKATER) && !defined(CAPE)
    // (waves running round and down the loose cotton, where it hangs free:
    // aD.x on the tee; the shorts' legs toward their hems)
    if (aMat > 2.5 && aMat < 4.5) {
      bool tee = aMat < 3.5;
      float loose = tee ? aD.x : smoothstep(0.72, 0.6, position.y) * 0.45;
      float az = atan(position.x, position.z);
      float wv = sin(position.y * 48.0 + az * 3.0 - uFlutter.y) + 0.55 * sin(position.y * 29.0 - position.x * 37.0 - uFlutter.y * 1.37 + 1.7);
      lp += ln * (wv * uFlutter.x * loose);
    }
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
    #elif defined(ELDER)
      if (uCapeGrid.w > 0.5) {
        // the long beard (w: a hair sheet): the inside on the simulated
        // surface, the outside standing off it - full under the chin,
        // thinning to the tips, in wavy clumps
        float gv = aCape.y / (uCapeGrid.y - 1.0);
        float gu = aCape.x / (uCapeGrid.x - 1.0);
        // (fullest right under the chin, and rounded across: thickest down
        // its middle, thinner at its sides)
        float th = uCapeGrid.z * mix(2.7, 0.35, pow(smoothstep(0.0, 1.0, gv), 0.65)) * (0.8 + 0.2 * cos(gu * 38.0 + gv * 9.0)) * (0.55 + 0.45 * sin(3.1416 * clamp(gu, 0.0, 1.0)));
        lp = P + nC * (th * (side + 1.0));
      } else {
        // the robe's skirts: heavy wool, thicker still along their free
        // edges and their hems, where they're turned back and faced (so they
        // never read paper thin as they swing open)
        float gv = aCape.y / (uCapeGrid.y - 1.0);
        float gu = aCape.x / (uCapeGrid.x - 1.0);
        float rim = max(smoothstep(0.78, 1.0, abs(2.0 * gu - 1.0)), smoothstep(0.74, 1.0, gv));
        lp = P + nC * (side * uCapeGrid.z * (1.0 + 1.5 * rim));
      }
    #else
      lp = P + nC * (side * uCapeGrid.z);
    #endif
    ln = aCape.w > 1.5 ? e : nC * side;
    #ifdef OUTLINE
      lo = (aCape.w > 0.5 ? safeNormalize(nC * side + e) : nC * side) * 0.6;
    #endif
  #endif
  #ifdef SHELL
    float fur = aD.w * uFurWind.w;
    lp += ln * fur * aShell;
    vShell = aShell;
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
  #ifdef SHELL
    wp += uFurWind.xyz * fur * aShell * aShell;
  #endif
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
#if defined(FOX)
// --- Sorrel, the red fox ------------------------------------------------------------
// (d: x how far inside the white (m), y how dark (the stockings, the backs of
// the ears), z how far along the tail (-1 off it), w how long the fur grows;
// r: the rest position. See tools/runner/fox.py.)
#define F_LIGHT 13
#define F_DEEP 14
#define F_WHITE 15
#define F_CREAM 16
#define F_STOCK 17
#define F_EARBACK 18
#define F_NOSE 19
#define F_MOUTH 20
#define F_IRIS 23
#define F_INK 24
#define F_EARIN 25
#define F_IRIS_IN 27
// x eyes open (0 shut .. 1), y how happily they're squeezed shut (arcs), zw
// where the pupils look (across, up; -1..1)
uniform vec4 uFace;
#ifdef SHELL
varying float vShell;
#endif
float foxHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float foxNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(foxHash(i), foxHash(i + vec3(1, 0, 0)), f.x), mix(foxHash(i + vec3(0, 1, 0)), foxHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(foxHash(i + vec3(0, 0, 1)), foxHash(i + vec3(1, 0, 1)), f.x), mix(foxHash(i + vec3(0, 1, 1)), foxHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// The lie of the fur at a rest position: back along the body and down the
// tail, down the legs. Strokes and strands are drawn stretched along it.
vec3 foxStretch(vec3 r, float tail) {
  float leg = (1.0 - smoothstep(0.22, 0.3, r.y)) * (1.0 - tail);
  return mix(vec3(1.0, 1.0, 0.22), vec3(1.0, 0.25, 1.0), leg);
}
// One eye, drawn on the side of the face (q: the rest position, mirrored onto
// the right side): big and round, only a little almond, tipped up toward the
// ear under a dark rim, the inner corner running down the muzzle in the
// fox's dark tear line; an amber iris round a big dark pupil, with two
// catch-lights. It shuts (uFace.x) under a lid of fur, or squeezes shut in a
// happy arc (uFace.y).
vec3 foxEye(vec3 c, vec3 q, inout float unlit) {
  vec3 E = vec3(0.0352, 0.613, -0.487);
  vec3 ne = normalize(vec3(0.52, 0.2, -1.0));
  vec3 ea = normalize(vec3(0.7, 0.26, 0.58));
  ea = normalize(ea - ne * dot(ea, ne));
  vec3 ev = normalize(cross(ne, ea));
  if (ev.y < 0.0) ev = -ev;
  vec3 o = q - E;
  if (dot(o, ne) < -0.02) return c;
  vec2 e = vec2(dot(o, ea), dot(o, ev));
  float hl = 0.0168, hh = 0.0128;
  float x = clamp(e.x / hl, -1.0, 1.0);
  float prof = pow(max(1.0 - x * x, 0.0), 0.56);
  // the eye (signed, m): the top a little fuller than the bottom
  float top = hh * prof * 1.04;
  float bot = -hh * prof * 0.92;
  float dA = max(max(e.y - top, bot - e.y), abs(e.x) - hl);
  float open = clamp(uFace.x, 0.0, 1.0) * (1.0 - uFace.y);
  // the lid comes down from the top
  float lid = mix(bot, top, open);
  float dS = max(dA, e.y - lid);
  vec3 ink = uPal[F_INK];
  // the rim, and the tear line running from the inner corner down the
  // side of the muzzle
  float rim = fill(dA - 0.0016) * (1.0 - fill(dS));
  vec2 t0 = e - vec2(-hl * 0.96, -0.0008);
  vec2 td = normalize(vec2(-0.42, -0.9));
  float along = dot(t0, td);
  float across = t0.x * td.y - t0.y * td.x - 0.02 * along * along / 0.016;
  float tear = band(across, 0.0014 * (1.0 - 0.55 * smoothstep(0.0, 0.017, along))) * step(0.0, along) * (1.0 - smoothstep(0.012, 0.018, along));
  float flick = band(e.y - top * 0.25 - (e.x - hl * 0.8) * 0.45, 0.0011) * step(hl * 0.82, e.x) * step(e.x, hl * 1.22);
  c = mix(c, ink, max(max(rim, tear * 0.85), flick));
  // the eye itself
  float eye = fill(dS);
  vec2 look = uFace.zw * vec2(0.0035, 0.0022);
  vec2 ic = e - look - vec2(-0.0004, 0.0002);
  float ir = length(ic);
  vec3 iris = mix(uPal[F_IRIS], uPal[F_IRIS_IN], smoothstep(0.0098, 0.003, ir));
  iris = mix(iris, ink, smoothstep(0.0088, 0.0108, ir) * 0.55);
  // a big pupil, a tall oval (a fox's slit, opened wide)
  float pup = fill(length(ic / vec2(0.74, 1.0)) - 0.0066);
  iris = mix(iris, ink, pup);
  // two catch-lights: a big one up toward the ear, a little one below
  float glint = max(fill(length(e - look - vec2(0.0034, 0.0042)) - 0.0026), fill(length(e - look - vec2(-0.0032, -0.0036)) - 0.0012) * 0.9);
  iris = mix(iris, vec3(1.0), glint);
  c = mix(c, iris, eye);
  unlit = max(unlit, eye * (0.35 + 0.65 * glint));
  // the lid's line, while it's coming down
  float lidLine = band(e.y - lid, 0.0011) * step(abs(e.x), hl * prof + 0.001) * step(dA, 0.0) * (1.0 - step(0.98, open));
  c = mix(c, ink, lidLine);
  // happy: shut tight in an arc, bowed up
  float arc = band(e.y - (hh * 0.3) * (1.0 - x * x) + 0.0015, 0.0014) * step(abs(e.x), hl * 0.95);
  c = mix(c, ink, arc * smoothstep(0.3, 0.7, uFace.y));
  return c;
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 5) {
    // inside the mouth: the roof and the tongue
    return mix(uPal[F_MOUTH], uPal[F_MOUTH] * 1.35 + vec3(0.08, 0.0, 0.02), smoothstep(0.553, 0.562, r.y));
  }
  float tail = step(0.0, d.z);
  // painted fur: long strokes laid along the lie of the fur, deeper and
  // lighter, more of them on the back and the brush
  vec3 sc = foxStretch(r, tail);
  float st = foxNoise(r * sc * 62.0 + vec3(0.0, 0.0, d.z * 3.0));
  float st2 = foxNoise(r * sc * 150.0 + 7.3);
  float s = st * 0.6 + st2 * 0.4;
  float back = smoothstep(0.36, 0.47, r.y) * (1.0 - tail) * smoothstep(-0.36, -0.25, r.z);
  c = mix(c, uPal[F_DEEP], (smoothstep(0.48, 0.22, s) * 0.38 + back * 0.3) * (1.0 - smoothstep(0.85, 1.0, d.z)));
  c = mix(c, uPal[F_LIGHT], smoothstep(0.58, 0.82, s) * 0.42);
  // the tail darkens a little toward the tip before it goes white
  c = mix(c, uPal[F_DEEP] * 0.9, tail * smoothstep(0.55, 0.8, d.z) * 0.35);
  // the white, torn into points where it meets the red: tufts of white
  // pointing out into it, and of red into the white
  float jag = (foxNoise(r * sc * 260.0) - 0.5) * 0.014 + (st2 - 0.5) * 0.008;
  float wh = smoothstep(-0.0015, 0.0015, d.x + jag);
  vec3 white = mix(uPal[F_WHITE], uPal[F_CREAM], smoothstep(0.45, 0.2, s) * 0.6);
  if (m == 3) {
    // the ears: cream inside, black behind and at the tips
    c = mix(c, mix(uPal[F_EARIN], uPal[F_WHITE], smoothstep(0.5, 0.8, s)), wh);
    c = mix(c, uPal[F_EARBACK], smoothstep(0.3, 0.7, d.y + (s - 0.5) * 0.25) * (1.0 - wh * 0.8));
    return c;
  }
  c = mix(c, white, wh);
  // the stockings: dark from the elbows and hocks down, brushed in
  float dk = smoothstep(0.15, 0.75, d.y + (s - 0.5) * 0.35);
  c = mix(c, mix(uPal[F_STOCK], uPal[F_EARBACK], smoothstep(0.7, 1.0, d.y)), dk);
  if (m == 1 && r.z < -0.42 && r.y > 0.53) {
    vec3 q = vec3(abs(r.x), r.y, r.z);
    c = foxEye(c, q, unlit);
    // the nose: a black button, damp, a glint on top
    vec3 N = vec3(0.0, 0.577, -0.566);
    float nd = length((r - N) * vec3(1.0, 1.2, 1.15)) - 0.0172;
    c = mix(c, uPal[F_NOSE], fill(nd));
    float ng = fill(length((r - N - vec3(0.0, 0.0098, -0.0045)) * vec3(0.8, 2.0, 1.0)) - 0.0042);
    c = mix(c, vec3(0.85), ng * 0.6);
    unlit = max(unlit, ng * 0.6);
  }
  return c;
}
#elif defined(DRAGON)
// --- Iris, the wind dragon ----------------------------------------------------------
// (on her body d: x, y her fish scales' grid (round her, along her: one scale
// each), z how far inside the gold of her belly (m), w how pale (her hands,
// forearms, shins and feet); on her mane x, y the same grid, w how long its
// fur grows; on a feather or a frill x across the vane (-1..1), y along it;
// on her antlers, claws and whiskers y along them. r: the rest position - she
// is laid out straight, nose to -z, her spine along z at height 0.4. See
// tools/runner/dragon.py.)
#define D_DEEP 13
#define D_TEAL 14
#define D_GREEN 15
#define D_VIOLET 16
#define D_BELLY 17
#define D_RIDGE 18
#define D_PALE 19
#define D_PALE2 20
#define D_MAGENTA 21
#define D_PURPLE 22
#define D_IRIS 23
#define D_INK 24
#define D_MUZZLE 25
#define D_BROW 26
#define D_IRIS_IN 27
#define D_MANE_V 28
#define D_MANE_T 29
#define D_SHINE 30
// her spine's height laid out, and the scale her head is sculpted at (the
// face is drawn in head units about its pivot)
#define D_Y0 0.5
#define D_HS 1.42
// x eyes open (0 shut .. 1), y how happily they're squeezed shut (arcs), zw
// where the pupils look
uniform vec4 uFace;
#ifdef SHELL
varying float vShell;
#endif
// set by the lighting pass before the detail is drawn: how far the surface is
// turned away from you (0 facing, 1 edge-on)
float gFres = 0.0;
// and handed back to it: how much of a scale's shine this point has
float gShine = 0.0;
float drHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float drNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(drHash(i), drHash(i + vec3(1, 0, 0)), f.x), mix(drHash(i + vec3(0, 1, 0)), drHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(drHash(i + vec3(0, 0, 1)), drHash(i + vec3(1, 0, 1)), f.x), mix(drHash(i + vec3(0, 1, 1)), drHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Her scales' colours round a loop - violet, deep blue, teal, green - so
// that turning a scale in the light slides its colour along it, as
// iridescence does (h: 0 deep blue, 0.25 teal, 0.5 green, 0.75 violet).
vec3 drIri(float h) {
  h = fract(h) * 4.0;
  vec3 a = uPal[D_DEEP], b = uPal[D_TEAL], c = uPal[D_GREEN], d = uPal[D_VIOLET];
  float k = fract(h);
  k = k * k * (3.0 - 2.0 * k);
  if (h < 1.0) return mix(a, b, k);
  if (h < 2.0) return mix(b, c, k);
  if (h < 3.0) return mix(c, mix(b, d, 0.5), k);
  return mix(d, a, k);
}
// Fish scales laid like shingles: rows round her, each half a scale over from
// the last, each scale's front tucked under the row before, its free edge
// rounded toward her tail. Returns x: where on its scale (0 just out from
// under the one before .. 1 its free edge), y: a number of its own, z: how
// near its free edge (in scales), w: round the scale (for its ridges).
vec4 drScales(vec2 g) {
  float R = 0.74;
  vec2 A = vec2(1.0, 0.82);
  float j0 = floor(g.y) - 1.0;
  for (int dj = 0; dj < 3; dj++) {
    float j = j0 + float(dj);
    float off = 0.5 * mod(j, 2.0);
    float i = floor(g.x - off + 0.5);
    for (int di = -1; di <= 1; di++) {
      vec2 c = vec2(i + float(di) + off, j);
      vec2 q = (g - c) * A;
      float r = length(q);
      if (r < R) {
        // out from under the row before: how far past its nearest scale's
        // edge
        float jp = j - 1.0;
        float offp = 0.5 * mod(jp, 2.0);
        float ip = floor(g.x - offp + 0.5);
        float under = 9.0;
        for (int dk = -1; dk <= 1; dk++) {
          vec2 cp = vec2(ip + float(dk) + offp, jp);
          under = min(under, length((g - cp) * A) - R);
        }
        float e1 = R - r;
        float t = clamp(under / max(under + e1, 1e-3), 0.0, 1.0);
        return vec4(t, drHash(vec3(c, 7.1)), e1, atan(q.x, q.y));
      }
    }
  }
  return vec4(0.5, 0.0, 1.0, 0.0);
}
// One eye, drawn on the side of her face (q the rest position mirrored onto
// the right side): big and round, an orange iris round a big dark pupil, two
// catch-lights, a dark rim heavier along the top in a sweep of lashes. It
// shuts (uFace.x) under a lid, or squeezes shut in a happy arc (uFace.y).
// (k: where on her it may be drawn. Drawn everywhere and masked, never
// branched round: the antialiasing takes screen-space derivatives, which
// aren't to be had across a branch.)
vec3 drEye(vec3 c, vec3 q, float k, inout float unlit) {
  vec3 E = vec3(0.0397, 0.0541, -0.138);
  vec3 ne = normalize(vec3(0.62, 0.22, -0.75));
  vec3 ea = normalize(vec3(0.6, 0.12, 0.79));
  ea = normalize(ea - ne * dot(ea, ne));
  vec3 ev = normalize(cross(ne, ea));
  if (ev.y < 0.0) ev = -ev;
  vec3 o = q - E;
  k *= step(-0.025, dot(o, ne));
  vec2 e = vec2(dot(o, ea), dot(o, ev));
  float hl = 0.0205, hh = 0.0188;
  float x = clamp(e.x / hl, -1.0, 1.0);
  float prof = pow(max(1.0 - x * x, 0.0), 0.5);
  float top = hh * prof * (1.0 + 0.06 * x);
  float bot = -hh * prof * 0.9;
  float dA = max(max(e.y - top, bot - e.y), abs(e.x) - hl);
  float open = clamp(uFace.x, 0.0, 1.0) * (1.0 - uFace.y);
  float lid = mix(bot, top, open);
  float dS = max(dA, e.y - lid);
  vec3 ink = uPal[D_INK];
  // the rim, heavy along the top, and lashes flicking out at the back corner
  float rimW = mix(0.0014, 0.0032, smoothstep(-0.3, 0.6, e.y / hh));
  float rim = fill(dA - rimW) * (1.0 - fill(dS));
  float lash = band(e.y - top * 0.55 - (e.x - hl * 0.85) * 0.75, 0.0013) * step(hl * 0.8, e.x) * step(e.x, hl * 1.35);
  lash = max(lash, band(e.y - top * 0.95 - (e.x - hl * 0.55) * 0.55, 0.0011) * step(hl * 0.55, e.x) * step(e.x, hl * 1.15));
  c = mix(c, ink, max(rim, lash) * k);
  float eye = fill(dS) * k;
  vec2 look = uFace.zw * vec2(0.004, 0.003);
  vec2 ic = e - look - vec2(-0.0006, -0.0006);
  float ir = length(ic);
  vec3 iris = mix(uPal[D_IRIS], uPal[D_IRIS_IN], smoothstep(0.0125, 0.004, ir));
  iris = mix(iris, ink, smoothstep(0.0128, 0.0158, ir) * 0.7);
  // a big round pupil
  float pup = fill(length(ic / vec2(0.88, 1.0)) - 0.0078);
  iris = mix(iris, ink, pup);
  // the white round it, only at the very corners
  iris = mix(iris, vec3(0.98, 0.97, 1.0), smoothstep(0.0158, 0.0175, ir) * 0.85);
  float glint = max(fill(length(e - look - vec2(0.0045, 0.0055)) - 0.0034), fill(length(e - look - vec2(-0.004, -0.0045)) - 0.0016) * 0.9);
  iris = mix(iris, vec3(1.0), glint);
  c = mix(c, iris, eye);
  unlit = max(unlit, eye * (0.4 + 0.6 * glint));
  float lidLine = band(e.y - lid, 0.0013) * step(abs(e.x), hl * prof + 0.001) * step(dA, 0.0) * (1.0 - step(0.98, open));
  c = mix(c, ink, lidLine * k);
  float arc = band(e.y - (hh * 0.35) * (1.0 - x * x) + 0.002, 0.0017) * step(abs(e.x), hl * 0.95);
  c = mix(c, ink, arc * smoothstep(0.3, 0.7, uFace.y) * k);
  return c;
}
// A feather's vane (or a frill): a dark shaft down its middle, barbs angled
// out along it, colour running from root to tip.
vec3 drFeather(vec3 root, vec4 d, inout float unlit) {
  float a = abs(d.x), y = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(root, uPal[D_PURPLE], smoothstep(0.15, 0.6, y));
  c = mix(c, uPal[D_MAGENTA], smoothstep(0.55, 0.95, y + 0.15 * a));
  // barbs: fine lines sweeping out and back toward the tip
  float barb = fract(y * 16.0 - a * 2.2);
  float bw = fwidth(y * 16.0 - a * 2.2) * 0.75 + 1e-4;
  float bl = smoothstep(0.5 - bw, 0.5, barb) * (1.0 - smoothstep(0.5, 0.5 + bw * 2.0, barb));
  c = mix(c, c * 0.72, bl * 0.5 * smoothstep(0.08, 0.2, a));
  // the shaft, pale; the vane lighter toward its edge
  c = mix(c, mix(c, uPal[D_PALE], 0.55), band(a, 0.07) * (1.0 - smoothstep(0.85, 1.0, y)));
  c = mix(c, c * 1.18 + 0.03, smoothstep(0.55, 1.0, a) * 0.6);
  // the tips catch the light
  unlit = max(unlit, smoothstep(0.8, 1.0, y) * 0.15);
  return c;
}
// A feather's (or a frill's) edge frays into its barbs, and its tip into a
// few points: > 0 where there's nothing (d.x across the vane, -1..1 edge to
// edge; d.y along it).
float drFray(int m, vec4 d) {
  if (m != 7 && m != 9) return -1.0;
  float a = abs(d.x), y = clamp(d.y, 0.0, 1.0);
  float barb = fract(y * 16.0 - a * 2.2 + (d.x < 0.0 ? 0.5 : 0.0));
  float saw = abs(barb - 0.5) * 2.0;
  return a - (0.66 + 0.34 * saw) - smoothstep(0.0, 0.25, y) * 0.0 + smoothstep(0.88, 1.0, y) * 0.2 * (1.0 - saw);
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  if (m == 5) {
    // inside the mouth: the roof and the tongue
    return mix(uPal[5], uPal[5] * 1.4 + vec3(0.1, 0.0, 0.03), smoothstep(-0.02, -0.008, (r.y - D_Y0) / D_HS));
  }
  if (m == 3) {
    // antlers: cream, golden toward the burr, ridged along
    vec3 c = mix(base * vec3(0.93, 0.8, 0.6), base * 1.06, smoothstep(0.0, 0.5, d.y));
    float rid = drNoise(vec3(r.x * 900.0, d.y * 18.0, r.z * 900.0));
    c *= 0.93 + 0.12 * rid;
    return c;
  }
  if (m == 6) {
    // claws: dark, a glint along the top
    return mix(base, base * 2.4 + 0.08, smoothstep(0.3, 1.0, d.y) * 0.4);
  }
  if (m == 7) return drFeather(base, d, unlit);
  if (m == 9) return drFeather(base, d, unlit);
  if (m == 8) {
    // whiskers: deep blue to teal at the tips
    return mix(base, uPal[D_TEAL], smoothstep(0.3, 1.0, d.y));
  }
  if (m == 2) {
    // the mane: deep indigo, streaked violet, the tips catching teal
    vec3 st = r * vec3(130.0, 60.0, 16.0);
    float s1 = drNoise(st), s2 = drNoise(st * 2.3 + 4.1);
    float s = s1 * 0.6 + s2 * 0.4;
    float top = clamp((length(r.xy - vec2(0.0, D_Y0)) - 0.08) / 0.07, 0.0, 1.0);
    vec3 c = mix(base * 0.8, uPal[D_MANE_V], smoothstep(0.45, 0.75, s) * 0.7);
    c = mix(c, uPal[D_MANE_T], smoothstep(0.55, 0.85, s2) * top * 0.6);
    #ifdef SHELL
      c = mix(c, c * 1.25 + 0.04, vShell * 0.5);
    #endif
    return c;
  }
  // --- her body (and the jaw) ---
  vec3 hq = vec3(r.x, r.y - D_Y0, r.z) / D_HS;
  float head = 1.0 - smoothstep(-0.06, 0.03, r.z);
  float rho = length(r.xy - vec2(0.0, D_Y0));
  float side = atan(abs(r.x), r.y - D_Y0); // 0 her back, pi her belly
  // her colour by where it lies: deep blue along her back, teal down her
  // flanks, green low on them, violet creeping in toward her plume
  float h = mix(0.02, 0.27, smoothstep(0.35, 1.6, side)) + 0.2 * smoothstep(1.7, 2.35, side);
  h = mix(h, 0.86, smoothstep(1.2, 2.1, r.z) * 0.6);
  // (her legs deeper: blue running to indigo)
  float leg = smoothstep(D_Y0 - 0.13, D_Y0 - 0.2, r.y) * (1.0 - smoothstep(-0.02, 0.02, -r.z));
  h = mix(h, 0.94, leg * 0.7);
  // scales
  vec2 g = d.xy;
  float lod = smoothstep(0.32, 0.75, length(fwidth(g)));
  vec4 sc = drScales(g);
  float scaly = (1.0 - head) * (1.0 - smoothstep(0.35, 0.8, d.w)) * (1.0 - lod) * (m == 1 ? 1.0 : 0.0);
  // each scale its own shade; turned in the light, its colour slides
  float hue = h + (sc.y - 0.5) * 0.08 * scaly - 0.22 * gFres + 0.04 * sin(r.z * 7.0);
  vec3 c = drIri(hue);
  // the head: smooth, teal, lighter toward the muzzle, deeper over the crown
  vec3 hc = mix(uPal[D_TEAL] * 0.95, uPal[D_DEEP] * 1.1, smoothstep(0.03, 0.08, hq.y) * smoothstep(-0.16, -0.06, hq.z));
  hc = mix(hc, uPal[D_MUZZLE], smoothstep(-0.14, -0.2, hq.z) * smoothstep(0.035, -0.01, hq.y) * 0.75);
  c = mix(c, hc, head);
  // shading within each scale: dark where it comes out from under the row
  // before, bright toward its free edge, a fine dark line along the edge and
  // a bright one just inside it; fine ridges fanning out across it
  float edgeW = fwidth(sc.z) + 1e-4;
  float shade = mix(0.72, 1.1, smoothstep(0.0, 0.85, sc.x));
  float rim = smoothstep(0.03 + edgeW, 0.03, sc.z) * smoothstep(0.0, 0.03 + edgeW, sc.z);
  float line = 1.0 - smoothstep(0.0, 0.02 + edgeW, sc.z);
  float ridges = 0.5 + 0.5 * sin(sc.w * 14.0);
  ridges *= 1.0 - smoothstep(0.1, 0.4, fwidth(sc.w * 14.0));
  vec3 cs = c * shade * (0.96 + 0.08 * ridges * sc.x);
  cs = mix(cs, mix(c, uPal[D_SHINE], 0.45), rim * 0.65);
  cs = mix(cs, c * 0.45, line * 0.6);
  c = mix(c * mix(0.92, 1.0, lod), cs, scaly);
  // (seen from afar, the scales a fine texture, only a soft sheen)
  gShine = scaly * smoothstep(0.35, 1.0, sc.x) + 0.1 * (1.0 - head) * (1.0 - scaly);
  // pale: her hands and feet, lavender-white, in its own soft shade
  float pale = smoothstep(0.15, 0.85, d.w);
  vec3 pc = mix(uPal[D_PALE], uPal[D_PALE2], smoothstep(0.85, 0.3, d.w) * 0.6);
  c = mix(c, pc, pale);
  // her belly: gold, ridged across in chevrons (each plate's V toward her
  // tail), its edge scalloped by the scales
  float bz = d.z + (sc.x - 0.5) * 0.004 * (1.0 - lod);
  float bw = fwidth(bz) * 0.75 + 1e-5;
  float bel = smoothstep(-bw, bw, bz);
  if (m == 4) bel = smoothstep(-0.022, -0.03, hq.y);
  float pz = (r.z - abs(r.x) * 0.9) / 0.03;
  float pl = fract(pz);
  float pw = fwidth(pz) * 0.8 + 1e-4;
  float ridge = smoothstep(1.0 - pw * 1.5, 1.0, pl) + (1.0 - smoothstep(0.0, pw, pl));
  ridge *= (1.0 - smoothstep(0.15, 0.45, pw)) * (1.0 - head * 0.8);
  vec3 bc = mix(uPal[D_BELLY] * 0.9, uPal[D_BELLY] * 1.05, smoothstep(0.0, 0.9, pl));
  bc = mix(bc, uPal[D_RIDGE], ridge * 0.75);
  c = mix(c, bc, bel);
  gShine *= 1.0 - bel;
  // the face (drawn everywhere, kept to her face: see drEye)
  {
    float face = (m == 1 || m == 4) ? step(hq.z, -0.04) * step(-0.06, hq.y) : 0.0;
    vec3 q = vec3(abs(hq.x), hq.y, hq.z);
    // brows: a dark sweep over each eye
    vec2 bq = vec2(q.z + 0.14, q.y - 0.075);
    float brow = band(bq.y + 0.25 * bq.x + 6.0 * bq.x * bq.x, 0.0035 * (1.0 - smoothstep(0.0, 0.03, abs(bq.x)))) * step(abs(bq.x), 0.03) * step(0.025, q.x);
    c = mix(c, uPal[D_BROW], brow * 0.85 * face);
    c = drEye(c, q, face, unlit);
    // nostrils: two dark commas on the nose
    vec3 N = vec3(0.0105, 0.02, -0.226);
    float nd = length((q - N) * vec3(1.6, 1.0, 1.3)) - 0.0042;
    c = mix(c, uPal[D_INK] * 1.6, fill(nd) * 0.85 * face);
    // the smile: a line up into the cheek from the corner of the mouth
    vec2 mq = vec2(q.z + 0.1, q.y + 0.006);
    float smile = band(mq.y - 0.25 * mq.x - 9.0 * mq.x * mq.x, 0.0016) * step(-0.02, mq.x) * step(mq.x, 0.012) * step(0.03, q.x);
    c = mix(c, uPal[D_INK], smile * 0.8 * face);
  }
  return c;
}
#elif defined(PITCHER)
// --- Nep, the pitcher plant -----------------------------------------------------------
// (on the pitcher d: x how far up it (0 the bottom, 1 the rim), y how far
// round; on a leaf x across it (-1..1, + toward its wide side), y along it (0
// the stalk, 1 the tip), z how far in from its edge (m), w which face (1 the
// top); on the vines and roots y how far along them. r: the rest position.
// See tools/runner/pitcher.py.)
#define PT_YELLOW 13
#define PT_LINE 14
#define PT_FRECKLE 15
#define PT_RIM_DEEP 16
#define PT_RIM_LIGHT 17
#define PT_VEIN 18
#define PT_UNDER 19
#define PT_RUST 20
#define PT_TIP 21
#define PT_ROOT_DARK 22
#define PT_ROOT_LIGHT 23
#define PT_EYE 24
#define PT_EYE_IN 25
#define PT_DEEP 26
#define PT_WATER_LIGHT 27
#define PT_GLOW 28
// x eyes open (0 shut .. 1), y how happily they're squeezed shut (arcs), zw
// where they look (across, up; -1..1)
uniform vec4 uFace;
float ptHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float ptNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(ptHash(i), ptHash(i + vec3(1, 0, 0)), f.x), mix(ptHash(i + vec3(0, 1, 0)), ptHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(ptHash(i + vec3(0, 0, 1)), ptHash(i + vec3(1, 0, 1)), f.x), mix(ptHash(i + vec3(0, 1, 1)), ptHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Freckles: little round spots scattered over a surface, a few of them
// bigger (cells of a jittered grid at rest position r, scale k).
float ptFreckles(vec3 r, float k, float share) {
  vec3 g = r * k;
  vec3 i = floor(g);
  float h = ptHash(i + 17.0);
  vec3 c = i + 0.25 + 0.5 * vec3(ptHash(i), ptHash(i + 3.1), ptHash(i + 7.7));
  float rad = mix(0.07, 0.17, ptHash(i + 9.3) * ptHash(i + 9.3));
  return fill(length(g - c) - rad) * step(1.0 - share, h);
}
// His eyes: two warm yellow ovals glowing on the back wall of the hollow,
// looking out from the dark. They blink (uFace.x), squeeze shut in happy
// arcs (uFace.y) and look about (uFace.zw).
vec3 ptEyes(vec3 c, vec3 r, inout float unlit) {
  vec3 E = vec3(0.032, 0.444, 0.086);
  vec2 look = uFace.zw * vec2(0.006, 0.004);
  vec2 e = vec2(abs(r.x) - E.x - look.x * sign(r.x), r.y - E.y - look.y);
  float open = clamp(uFace.x, 0.0, 1.0) * (1.0 - uFace.y);
  float hw = 0.0118, hh = 0.0188 * mix(0.12, 1.0, open);
  float d = (length(e / vec2(hw, hh)) - 1.0) * min(hw, hh);
  // a soft glow round them in the dark
  float halo = exp(-max(length(e / vec2(hw * 1.9, hh * 1.5 + 0.004)) - 0.5, 0.0) * 2.4) * 0.5;
  c = mix(c, uPal[PT_GLOW], halo * 0.55);
  float eye = fill(d);
  vec3 col = mix(uPal[PT_EYE], uPal[PT_EYE_IN], smoothstep(0.0, -0.006, d));
  // happy: shut tight in arcs, bowed up
  float x = clamp(e.x / hw, -1.0, 1.0);
  float arc = band(e.y + 0.004 - 0.009 * (1.0 - x * x), 0.0026) * step(abs(e.x), hw * 1.05);
  float happy = smoothstep(0.3, 0.7, uFace.y);
  c = mix(c, col, max(eye * (1.0 - happy), arc * happy));
  unlit = max(unlit, max(max(eye * (1.0 - happy), arc * happy), halo * 0.8));
  return c;
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 1) {
    // the pitcher: lime, warming to yellow round his middle and the front of
    // his belly, deeper green low down and up the neck; mottled; light
    // growth lines running up it, curving as they rise; freckles
    float ang = atan(r.x, -r.z);
    float mid = exp(-pow((d.x - 0.42) / 0.3, 2.0));
    float front = 0.5 + 0.5 * cos(ang);
    float mott = ptNoise(r * 26.0) * 0.6 + ptNoise(r * 70.0) * 0.4;
    c = mix(c, uPal[PT_YELLOW], clamp(mid * (0.35 + 0.45 * front) + (mott - 0.5) * 0.5, 0.0, 1.0) * 0.85);
    c = mix(c, uPal[PT_DEEP], (smoothstep(0.32, 0.0, d.x) * 0.5 + smoothstep(0.7, 1.0, d.x) * 0.3) * (0.6 + 0.4 * mott));
    float a = ang * 11.0 / 6.2831853 + 0.55 * sin(r.y * 14.0 + 0.6) * smoothstep(0.06, 0.2, r.y);
    float gl = band(abs(fract(a + 0.5) - 0.5), 0.05 + 0.03 * (1.0 - d.x)) * smoothstep(0.06, 0.18, d.x) * smoothstep(1.0, 0.82, d.x);
    c = mix(c, uPal[PT_LINE], gl * 0.6);
    float fr = max(ptFreckles(r, 95.0, 0.38), ptFreckles(r + 3.7, 160.0, 0.3) * 0.8);
    c = mix(c, uPal[PT_FRECKLE], fr * 0.6 * smoothstep(0.08, 0.3, d.x));
    // a pink flush rising up the neck to the rim, broken by the mottling,
    // the growth lines running pink into it
    float flush = smoothstep(0.66, 0.96, d.x + (mott - 0.5) * 0.18);
    c = mix(c, mix(uPal[PT_RIM_LIGHT], uPal[2], 0.5), flush * 0.55);
    c = mix(c, uPal[PT_RIM_DEEP], gl * flush * 0.6);
    return c;
  }
  if (m == 2) {
    // the rim: coral pink, fine ridges running across the lip, deeper toward
    // the inside, lighter along its rolled top
    vec3 q = r - vec3(0.0, 0.43, 0.0);
    vec3 n = vec3(0.0, 0.927, -0.375);
    vec3 e2 = cross(n, vec3(1.0, 0.0, 0.0));
    float u = q.x, v = dot(q, e2), h = dot(q, n);
    float th = atan(u, -v);
    float rho = length(vec2(u, v));
    float R = 0.106 * (1.0 + 0.08 * cos(th) * cos(th)) + 0.019 + 0.008 * cos(th * 9.0);
    float ridge = band(abs(fract(th * 64.0 / 6.2831853) - 0.5) - 0.5, 0.12);
    c = mix(c, uPal[PT_RIM_DEEP], smoothstep(0.002, -0.012, rho - R) * 0.75);
    c = mix(c, uPal[PT_RIM_LIGHT], smoothstep(0.006, 0.018, h - 0.008 * cos(th * 9.0)) * 0.6);
    c = mix(c, uPal[PT_RIM_DEEP], ridge * 0.45);
    return c;
  }
  if (m == 3) {
    // the hollow: dark all the way down, a little warmth just under the rim
    float h = dot(r - vec3(0.0, 0.43, 0.0), vec3(0.0, 0.927, -0.375));
    // the coral of the rim running down inside it, fading into the dark
    c = mix(c, uPal[PT_RIM_DEEP] * 0.9, smoothstep(-0.05, -0.008, h) * 0.85);
    c = mix(c, uPal[PT_RIM_DEEP] * 0.4, smoothstep(-0.09, -0.05, h) * (1.0 - smoothstep(-0.05, -0.02, h)) * 0.6);
    unlit = 0.6;
    if (r.z > 0.03) c = ptEyes(c, r, unlit);
    return c;
  }
  if (m == 4) {
    // a leaf: green, yellower down the middle, a light midrib and veins
    // running out from it toward the tip, darker toward the edges and freckled
    // with rust along them, a fine yellow-brown line round its edge; paler
    // beneath
    float t = d.y, x = d.x;
    float edge = d.z;
    float mott = ptNoise(r * 40.0) * 0.6 + ptNoise(r * 120.0) * 0.4;
    c = mix(c, uPal[PT_YELLOW], smoothstep(0.75, 0.0, abs(x)) * 0.22 * smoothstep(0.0, 0.3, t));
    c = mix(c, uPal[PT_DEEP], smoothstep(0.35, 1.0, abs(x)) * 0.35 + (mott - 0.5) * 0.3);
    float rib = band(x, 0.035 * (1.0 - 0.75 * t) + 0.006);
    float va = (t - abs(x) * 0.42) * 8.0;
    float vein = band(abs(fract(va) - 0.5) - 0.5, 0.045) * step(0.08, abs(x)) * smoothstep(0.96, 0.7, abs(x)) * step(0.05, t) * step(t, 0.93);
    float fine = band(ptNoise(r * vec3(160.0, 160.0, 160.0)) - 0.5, 0.025) * 0.35;
    c = mix(c, uPal[PT_VEIN], max(max(rib * 0.85, vein * 0.6), fine * smoothstep(0.1, 0.4, abs(x))));
    float rust = smoothstep(0.014, 0.0, edge) * smoothstep(0.55, 0.75, ptNoise(r * 90.0 + 3.0));
    rust = max(rust, ptFreckles(r, 120.0, 0.12) * smoothstep(0.03, 0.006, edge));
    c = mix(c, uPal[PT_RUST], rust * 0.75);
    c = mix(c, mix(uPal[PT_YELLOW], uPal[PT_RUST], 0.45), fill(edge - 0.0022) * 0.7);
    c = mix(c, uPal[PT_UNDER] * (0.85 + 0.3 * mott), (1.0 - d.w) * 0.65);
    return c;
  }
  if (m == 5) {
    // the vines: green, streaked along, going orange-brown at the tips
    float s = ptNoise(r * vec3(90.0, 260.0, 90.0));
    c = mix(c, uPal[PT_DEEP], smoothstep(0.55, 0.25, s) * 0.3);
    c = mix(c, uPal[PT_TIP], smoothstep(0.78, 0.98, d.y));
    return c;
  }
  if (m == 6) {
    // the roots: brown bark, streaked, darker in its cracks, paler toward
    // the rootlets' tips
    vec3 sc = d.y > 0.35 ? vec3(160.0, 300.0, 160.0) : vec3(260.0, 70.0, 260.0);
    float s = ptNoise(r * sc) * 0.7 + ptNoise(r * 600.0) * 0.3;
    c = mix(c, uPal[PT_ROOT_DARK], smoothstep(0.42, 0.2, s) * 0.7);
    c = mix(c, uPal[PT_ROOT_LIGHT], smoothstep(0.62, 0.85, s) * 0.5 + smoothstep(0.6, 1.0, d.y) * 0.3);
    return c;
  }
  if (m == 7) {
    // the water standing in him: dark in the hollow, glinting where it moves
    float w = ptNoise(vec3(r.xz * 60.0, uTime * 1.7)) * 0.6 + ptNoise(vec3(r.xz * 150.0, uTime * 2.9)) * 0.4;
    float g = smoothstep(0.66, 0.8, w);
    c = mix(c, uPal[PT_WATER_LIGHT], g * 0.8);
    unlit = g * 0.6;
    return c;
  }
  return c;
}
#elif defined(ITEMS)
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
#elif defined(ELDER)
// --- the elder ------------------------------------------------------------------
// (palette: see COL in game/elder.js; r is the rest position, the head being
// sculpted where it sits)
#define L_ROBE_DEEP 14
#define L_ROBE_IN 15
#define L_SKIN_LINE 16
#define L_SKIN_WARM 17
#define L_BOOT_DARK 18
#define L_WOOD_DARK 19
#define L_WOOD_LIGHT 20
#define L_HAIR_SHADE 21
#define L_EYE 22
#define L_IRIS 23
#define L_INK 24
#define L_MOUTH 25
#define L_FLUSH 26
#define L_GLASS_DEEP 27
#define L_GLINT 28
#define L_SASH_DARK 29
#define L_LEG_DARK 31
float elderHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float elderNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(elderHash(i), elderHash(i + vec3(1, 0, 0)), f.x), mix(elderHash(i + vec3(0, 1, 0)), elderHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(elderHash(i + vec3(0, 0, 1)), elderHash(i + vec3(1, 0, 1)), f.x), mix(elderHash(i + vec3(0, 1, 1)), elderHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Worn cloth, washed like a watercolour: soft blotches a shade deeper and a
// shade paler, and long streaks down the fall of the cloth.
vec3 elderWorn(vec3 c, vec3 deep, vec3 q) {
  float n = elderNoise(q * vec3(9.0, 4.0, 9.0)) * 0.65 + elderNoise(q * 23.0 + 3.1) * 0.35;
  float streak = elderNoise(vec3(q.x * 40.0 + q.z * 40.0, q.y * 2.0, 1.7));
  c = mix(c, deep, smoothstep(0.5, 0.8, n) * 0.45 + smoothstep(0.62, 0.85, streak) * 0.2);
  return mix(c, c * 1.12 + 0.02, smoothstep(0.38, 0.12, n) * 0.4);
}
// His face, drawn on the front of the head: small, deep-set, kindly eyes
// under heavy drooping lids (pale blue-grey, a catch-light in each), bags
// under them and crow's feet fanning from their corners; three long lines
// across the high forehead; the weathered tan flushed at the tip of the nose
// and on the cheeks, darker in the creases; age spots on the bald crown.
vec3 drawFace(vec3 base, vec3 r, float ear, inout float unlit) {
  vec3 c = base;
  // weathering: a warm, uneven tan, darker in its creases
  float n = elderNoise(r * 60.0);
  c = mix(c, uPal[L_SKIN_WARM], smoothstep(0.55, 0.85, n) * 0.35);
  // age spots on the crown
  float spots = smoothstep(0.72, 0.8, elderNoise(r * 95.0 + 4.0)) * smoothstep(1.93, 1.97, r.y);
  c = mix(c, uPal[L_SKIN_LINE], spots * 0.5);
  // the ears: a deeper flush in their bowls
  c = mix(c, uPal[L_FLUSH], ear * 0.3);
  float front = smoothstep(-0.055, -0.085, r.z);
  if (front <= 0.0) return c;
  vec2 f = vec2(abs(r.x), r.y);
  // flush: the nose's long tip, the cheekbones
  c = mix(c, uPal[L_FLUSH], 0.45 * (1.0 - smoothstep(0.004, 0.026, length(vec3(r.x, r.y - 1.815, r.z + 0.158)))) * front);
  c = mix(c, uPal[L_FLUSH], 0.22 * (1.0 - smoothstep(0.2, 1.0, length((f - vec2(0.058, 1.838)) / vec2(0.02, 0.012)))) * front);
  vec3 line = mix(c, uPal[L_SKIN_LINE], 0.75);
  // forehead: three long wavy lines
  float fh = 0.0;
  for (int k = 0; k < 3; k++) {
    float y0 = 1.912 + 0.0125 * float(k);
    fh = max(fh, band(r.y - y0 - 0.0035 * sin(r.x * 70.0 + float(k)) - 0.06 * r.x * r.x, 0.0009) * step(abs(r.x), 0.052 - 0.008 * float(k)));
  }
  c = mix(c, line, fh * front * 0.8);
  // the eye: a small almond under a heavy, drooping lid
  vec2 E = vec2(0.041, 1.859);
  vec2 q = f - E;
  float dA = (length(q / vec2(0.0135, 0.0082)) - 1.0) * 0.0082;
  float lid = q.y - (0.0034 - 18.0 * (q.x + 0.004) * (q.x + 0.004) - 0.07 * q.x);
  float dS = max(dA, lid);
  float eye = fill(dS) * front;
  c = mix(c, uPal[L_EYE], eye);
  unlit = max(unlit, eye * 0.3);
  vec2 ic = q - vec2(-0.0012, -0.0012);
  c = mix(c, uPal[L_IRIS], fill(max(length(ic) - 0.0064, dS)) * front);
  c = mix(c, uPal[L_INK], fill(max(length(ic) - 0.0031, dS)) * front);
  float hl = fill(max(length(q - vec2(0.0022, 0.0018)) - 0.0018, dS)) * front;
  c = mix(c, vec3(1.0), hl);
  unlit = max(unlit, hl);
  // the heavy upper lid's line, and the fold of skin over it
  float lash = band(lid, 0.001 + 0.0006 * smoothstep(-0.01, 0.012, q.x)) * step(abs(q.x), 0.0145) * step(dA, 0.0012);
  c = mix(c, uPal[L_INK], lash * front);
  float fold = band(q.y - 0.0072 + 22.0 * (q.x + 0.002) * (q.x + 0.002), 0.0008) * step(abs(q.x + 0.001), 0.016);
  c = mix(c, line, fold * front * 0.8);
  // bags under the eyes: two soft arcs
  float bag = band(length((q - vec2(0.0, 0.004)) / vec2(0.0165, 0.0175)) - 1.0, 0.045) * step(q.y, -0.006) * step(abs(q.x), 0.014);
  bag = max(bag, band(length((q - vec2(0.0, 0.003)) / vec2(0.019, 0.023)) - 1.0, 0.035) * step(q.y, -0.01) * step(abs(q.x), 0.013) * 0.7);
  c = mix(c, line, bag * front * 0.7);
  // crow's feet: three short lines fanning from the outer corner
  vec2 cf = q - vec2(0.0165, 0.0005);
  float crow = 0.0;
  for (int k = -1; k <= 1; k++) {
    float a = 0.38 * float(k);
    vec2 dir = vec2(cos(a), sin(a));
    float along = dot(cf, dir);
    float across = cf.x * dir.y - cf.y * dir.x;
    crow = max(crow, band(across, 0.0007) * step(0.002, along) * step(along, 0.012 - 0.003 * abs(float(k))));
  }
  c = mix(c, line, crow * front * 0.8);
  return c;
}
// Strands drawn along a lock: a few darker lines that wander a little.
float elderStrands(float u, float v, float k) {
  float s = u * k + 0.45 * sin(v * 9.0 + u * 17.0);
  return lines(s, 0.08);
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 1) {
    c = drawFace(base, d.xyz, d.w, unlit);
  } else if (m == 8) {
    // old hands: the knuckles and the backs of the hands a shade deeper
    c = mix(c, uPal[L_SKIN_WARM], smoothstep(0.5, 0.8, elderNoise(r * 70.0)) * 0.35);
  } else if (m == 2) {
    // white hair, combed into strands falling down round the head (and
    // down the beard), a cool grey in their depths
    float a = atan(r.x, -(r.z + 0.01));
    float st = lines(a * 34.0 + sin(r.y * 95.0 + a * 6.0) * 0.35, 0.1) * d.x;
    c = mix(c, uPal[L_HAIR_SHADE], st * 0.5 + (1.0 - d.x) * 0.15);
  } else if (m == 3 || m == 4) {
    // the robe: worn teal cloth (the sea-green under-robe down the V), the
    // outer robe's open edge turned back along the V; the bell sleeves
    // darker inside (d: x on the body, y down the arm, z across the V's
    // edge, w inside a sleeve)
    vec3 deep = m == 3 ? uPal[L_ROBE_DEEP] : uPal[L_ROBE_IN];
    c = elderWorn(c, deep, r);
    float edge = band(d.z - 0.004, 0.0035) * d.x;
    c = mix(c, uPal[L_ROBE_DEEP], edge * 0.8);
    c = mix(c, deep * 0.72, d.w);
  } else if (m == 9) {
    // the hood: its seam sinks into its middle, its lining shows at its mouth
    c = elderWorn(c, uPal[L_ROBE_DEEP], r);
    c = mix(c, uPal[L_ROBE_IN], d.w * 0.85);
    c = mix(c, c * 0.8, band(d.x, 0.04) * step(0.02, d.y));
    c = mix(c, c * 0.7, band(d.y - 0.005, 0.0015));
  } else if (m == 10) {
    // the skirt (d: x across, y down, w the lining side): worn teal,
    // deepening toward the hem; the lining sea-green, turned back down its
    // open edges in a broad facing, a stitched line along it
    float v = smoothstep(0.1, 1.0, d.y);
    vec3 q = vec3(d.x * 1.6, d.y * 0.9, 0.0);
    c = elderWorn(c, uPal[L_ROBE_DEEP], q);
    c = mix(c, uPal[L_ROBE_DEEP], v * 0.45);
    vec3 lin = elderWorn(uPal[4], uPal[L_ROBE_IN], q + 5.0);
    float edge = abs(2.0 * d.x - 1.0);
    float facing = smoothstep(0.935, 0.95, edge) * step(0.04, d.y);
    c = mix(c, mix(lin, uPal[L_ROBE_IN], 0.3 + v * 0.3), facing);
    c = mix(c, uPal[L_ROBE_DEEP] * 0.8, band(edge - 0.93, 0.0035) * step(0.04, d.y) * 0.8);
    c = mix(c, mix(lin, uPal[L_ROBE_IN], v * 0.5), step(0.5, d.w));
  } else if (m == 14) {
    // the under-robe's skirt (d as the skirt's): sea-green, worn, deepening
    // toward its hem, in long soft folds; a deeper shade inside
    float v = smoothstep(0.05, 1.0, d.y);
    vec3 q = vec3(d.x * 1.3, d.y * 0.8, 3.0);
    c = elderWorn(uPal[4], uPal[L_ROBE_IN], q);
    c = mix(c, uPal[L_ROBE_IN], v * 0.4);
    c = mix(c, uPal[L_ROBE_IN] * 0.85, step(0.5, d.w) * 0.7);
    c = mix(c, uPal[L_ROBE_IN] * 0.8, band(d.y - 0.93, 0.006) * 0.7);
  } else if (m == 13) {
    // the long beard (d: x across, y down, w the inside): wavy clumps down
    // its length, strands in them, a cool grey in its depths and on the inside
    float clump = 0.5 + 0.5 * sin(d.x * 15.0 + sin(d.y * 7.0 + d.x * 4.0) * 1.6);
    c = mix(c, uPal[L_HAIR_SHADE], smoothstep(0.55, 0.95, clump) * 0.18);
    c = mix(c, uPal[L_HAIR_SHADE], elderStrands(d.x, d.y, 34.0) * 0.35);
    c = mix(c, uPal[L_HAIR_SHADE], step(0.5, d.w) * 0.45 + smoothstep(0.6, 1.0, d.y) * 0.12);
  } else if (m == 5) {
    // leggings: wrinkled at the ankles
    c = mix(c, uPal[L_LEG_DARK], lines(r.y / 0.018, 0.08) * smoothstep(0.26, 0.17, r.y) * 0.6);
  } else if (m == 6) {
    // the sash: a coarse weave, its edges darker
    c = mix(c, uPal[L_SASH_DARK], lines(r.y * 140.0 + d.x * 0.0, 0.12) * 0.35 * (1.0 - d.x));
    c = mix(c, uPal[L_SASH_DARK], lines((r.y + abs(r.x) * 0.2) * 60.0, 0.1) * 0.4 * d.x);
  } else if (m == 7) {
    // old boots: a dark worn sole, the cuff's turned edge, the strap,
    // scuffs
    float y = r.y - 0.035 * pow(smoothstep(-0.1, -0.2, r.z), 2.0);
    c = mix(c, uPal[L_BOOT_DARK], fill(y - uRig[0].z));
    c = mix(c, uPal[L_BOOT_DARK], d.y * 0.8);
    c = mix(c, c * 1.15, d.x * 0.6);
    c = mix(c, uPal[L_BOOT_DARK], smoothstep(0.62, 0.85, elderNoise(r * 80.0)) * 0.35);
  } else if (m == 11) {
    // the stick (d: its own frame, up its length): twisted grain spiralling
    // round it, knots; dark with the dirt of the road at its foot, worn pale
    // and smooth where his hand holds it
    float a = atan(d.z, d.x) / 6.2832;
    float grain = lines(a * 5.0 + d.y * 4.2, 0.16);
    float fine = lines(a * 13.0 + d.y * 4.2 + sin(d.y * 31.0) * 0.15, 0.12);
    c = mix(c, uPal[L_WOOD_DARK], grain * 0.55 + fine * 0.25);
    c = mix(c, uPal[L_WOOD_LIGHT], smoothstep(0.6, 0.85, elderNoise(vec3(a * 6.0, d.y * 9.0, 0.0))) * 0.4);
    c = mix(c, uPal[L_WOOD_LIGHT], smoothstep(1.02, 1.09, d.y) * smoothstep(1.24, 1.14, d.y) * 0.35);
    c = mix(c, uPal[L_WOOD_DARK] * 0.8, smoothstep(0.14, 0.0, d.y) * 0.7);
  } else if (m == 12) {
    // orange spectacles: a deeper orange round their inner edges
    c = mix(c, uPal[L_GLASS_DEEP], 0.25);
  }
  return c;
}
// The long beard parts into pointed, wavy locks toward its end, and the
// skirt's hem is ragged, hanging in long uneven points: > 0 past an edge
// (d.x across the sheet, d.y down it).
float elderCut(int m, vec4 d) {
  bool beard = m == 13;
  // (the under-robe's hem is worn, but only a little: shallow, close points)
  if (m == 14) {
    float k = d.x * 19.0;
    float h = fract(sin(floor(k) * 12.9898 + 3.1) * 43758.5453);
    return d.y - (0.995 - 0.03 * h - (0.035 + 0.025 * fract(h * 5.17)) * pow(abs(fract(k) - 0.5) * 2.0, 1.4));
  }
  float n = beard ? 7.0 : 13.0;
  float k = d.x * n + (beard ? 0.25 * sin(d.y * 14.0) : 0.0);
  float i = floor(k);
  float h = fract(sin(i * 12.9898 + (beard ? 2.3 : 7.7)) * 43758.5453);
  float x = abs(fract(k) - 0.5) * 2.0;
  float end = beard ? 0.995 - 0.1 * h : 0.995 - 0.06 * h;
  float depth = beard ? 0.22 + 0.1 * fract(h * 7.31) : 0.09 + 0.08 * fract(h * 5.17);
  float cut = d.y - (end - depth * pow(x, beard ? 1.2 : 1.6));
  if (beard) {
    // (and its sides wavy, in tufts, below the chin)
    float side = min(d.x, 1.0 - d.x);
    float wave = 0.035 + 0.03 * sin(d.y * 31.0 + step(0.5, d.x) * 2.1) + 0.02 * sin(d.y * 67.0 + 1.3);
    cut = max(cut, (wave - side) * smoothstep(0.12, 0.3, d.y));
  }
  return cut;
}
#elif defined(BUNNY) && defined(PROPS)
// --- what the bunny pulls out of his satchel (game/props.js) -----------------------
// (d: x, y the part's own uv, z which part: see props.js)
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 1) {
    // the umbrella's canopy: panels in two colours, a hem round its edge
    float k = fract(d.x * 8.0 + 0.25);
    c = mix(uPal[1], uPal[2], step(0.5, fract(d.x * 4.0)));
    c = mix(c, c * 0.82, smoothstep(0.42, 0.5, abs(k - 0.5)) * 0.6);
    c = mix(c, uPal[3], smoothstep(0.93, 0.96, d.y));
  } else if (m == 4) {
    // the balloon: a soft shine up on one side, and its knot
    float hl = 1.0 - smoothstep(0.0, 0.22, length(vec2(d.x - 0.32, (d.y - 0.68) * 1.3)));
    c = mix(c, vec3(1.0), hl * 0.75);
    unlit = max(unlit, hl * 0.6);
  } else if (m == 6) {
    // the dandelion's clock: a soft white ball of seeds, each one's tuft a
    // little star of hairs, the seeds themselves dark specks deep in it
    vec2 g = d.xy * vec2(46.0, 26.0);
    vec2 cell = floor(g);
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5);
    vec2 f = fract(g) - 0.5 - (vec2(h, fract(h * 7.3)) - 0.5) * 0.4;
    float a = atan(f.y, f.x);
    float star = (1.0 - smoothstep(0.0, 0.45, length(f))) * (0.5 + 0.5 * cos(a * 6.0 + h * 6.28));
    c = mix(c * 0.9, c, star);
    c = mix(c, uPal[7] * 0.7, (1.0 - smoothstep(0.0, 0.07, length(f))) * 0.4);
    unlit = max(unlit, 0.75);
  }
  return c;
}
#elif defined(BUNNY)
// --- the bunny ------------------------------------------------------------------
// (palette: see COL in game/bunny.js; r is the rest position - he is
// sculpted where he stands; see tools/runner/bunny.py)
#define N_FUR_DEEP 16
#define N_FUR_LIGHT 17
#define N_CREAM 18
#define N_PINK 19
#define N_SHIRT_LINE 20
#define N_RUST_DEEP 21
#define N_EYE 22
#define N_IRIS 23
#define N_INK 24
#define N_MOUTH 25
#define N_BLUSH 26
#define N_HAT_DEEP 27
#define N_OLIVE_DEEP 28
#define N_BRASS_LIGHT 29
#define N_PAD 31
float bunHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float bunNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(bunHash(i), bunHash(i + vec3(1, 0, 0)), f.x), mix(bunHash(i + vec3(0, 1, 0)), bunHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(bunHash(i + vec3(0, 0, 1)), bunHash(i + vec3(1, 0, 1)), f.x), mix(bunHash(i + vec3(0, 1, 1)), bunHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Painted fur: short strokes running down him (the noise stretched along
// y), a shade deeper and a shade lighter.
vec3 bunFur(vec3 c, vec3 q, float k) {
  float n = bunNoise(q * vec3(120.0, 48.0, 120.0)) * 0.6 + bunNoise(q * vec3(260.0, 110.0, 260.0) + 3.7) * 0.4;
  c = mix(c, uPal[N_FUR_DEEP], smoothstep(0.56, 0.86, n) * 0.42 * k);
  return mix(c, uPal[N_FUR_LIGHT], smoothstep(0.42, 0.14, n) * 0.32 * k);
}
// Stitching: dashes along a line (along: distance along it in stitches).
float bunStitch(float across, float along, float halfw) {
  return band(across, halfw) * step(0.42, fract(along));
}
// The cream of his muzzle, his lower cheeks and his chin, faded into the
// brown in tufts.
float bunCream(vec3 r) {
  vec2 f = vec2(abs(r.x), r.y);
  float mz = length((f - vec2(0.019, 0.867)) / vec2(0.047, 0.034));
  float ch = length((f - vec2(0.056, 0.852)) / vec2(0.042, 0.024));
  float chin = length((f - vec2(0.0, 0.833)) / vec2(0.048, 0.028));
  float k = min(min(mz, ch), chin);
  float jag = (bunNoise(r * vec3(380.0, 160.0, 380.0)) - 0.5) * 0.34;
  return (1.0 - smoothstep(0.8, 1.02, k + jag)) * smoothstep(-0.03, -0.065, r.z);
}
// His face, drawn on the front of his head: big round eyes (dark brown
// irises, two catch-lights each) behind his glasses, brows springing up over
// them; a soft blush; the little 'w' of his mouth under his nose.
vec3 drawFace(vec3 c, vec3 r, inout float unlit) {
  float front = smoothstep(-0.06, -0.085, r.z);
  vec2 f = vec2(abs(r.x), r.y);
  c = mix(c, uPal[N_BLUSH], 0.25 * (1.0 - smoothstep(0.2, 1.0, length((f - vec2(0.078, 0.884)) / vec2(0.022, 0.013)))) * front);
  // the eye: a big round white, a little taller than wide
  vec2 E = vec2(0.055, 0.942);
  vec2 q = f - E;
  float dA = (length(q / vec2(0.0245, 0.0278)) - 1.0) * 0.0245;
  float eye = fill(dA) * front;
  vec3 ink = uPal[N_INK];
  c = mix(c, ink, fill(dA - 0.0016) * front);
  c = mix(c, uPal[N_EYE], eye);
  unlit = max(unlit, eye * 0.35);
  // the iris: looking a touch in toward his nose and up, curious
  vec2 ic = q - vec2(-0.0038, 0.0016);
  float ir = length(ic / vec2(0.9, 1.0));
  vec3 iris = mix(uPal[N_IRIS], uPal[N_IRIS] * 1.6 + 0.04, smoothstep(0.005, 0.016, ir) * 0.5 * step(ic.y, 0.0));
  iris = mix(iris, ink, fill(ir - 0.0088));
  float inI = fill(max(ir - 0.0168, dA)) * front;
  c = mix(c, iris, inI);
  float g1 = fill(length(q - vec2(0.0018, 0.0082)) - 0.005);
  float g2 = fill(length(q - vec2(-0.0072, -0.0044)) - 0.0023);
  float glint = max(g1, g2 * 0.9) * inI;
  c = mix(c, vec3(1.0), glint);
  unlit = max(unlit, max(inI * 0.25, glint));
  // the upper lid's line, heavier at the outer corner
  float lid = band(dA, 0.0011 + 0.0012 * smoothstep(-0.01, 0.02, q.x)) * step(0.004, q.y) * front;
  c = mix(c, ink, lid);
  // brows: a couple of darker tufts springing up and out over the rims
  vec2 bq = f - vec2(0.058, 0.992 - 6.0 * (f.x - 0.05) * (f.x - 0.05));
  float brow = fill(length(bq / vec2(0.02, 0.0044)) - 1.0) * step(0.036, f.x);
  c = mix(c, uPal[N_FUR_DEEP] * 0.82, brow * front);
  // the mouth: a line down from the nose parting into two little arcs
  float mfront = smoothstep(-0.095, -0.112, r.z);
  float phil = band(f.x, 0.0009) * step(0.8615, r.y) * step(r.y, 0.884);
  float arc = band(length(f - vec2(0.0115, 0.8665)) - 0.0115, 0.0009) * step(r.y, 0.8665) * step(f.x, 0.0225);
  float tip = band(length(f - vec2(0.0225, 0.8705)) - 0.004, 0.0008) * step(r.y, 0.8705) * step(0.0225, f.x) * step(f.x, 0.0268);
  c = mix(c, uPal[N_MOUTH], max(max(phil, arc), tip) * mfront);
  return c;
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 1) {
    // brown fur, the cream of his muzzle, his face
    c = bunFur(c, r, 1.0);
    vec3 cream = mix(uPal[N_CREAM], uPal[N_CREAM] * 1.06 + 0.02, bunNoise(r * 220.0));
    c = mix(c, cream, bunCream(r));
    // (his tufts a shade deeper toward their roots)
    c = mix(c, uPal[N_FUR_DEEP], d.w * 0.25);
    c = drawFace(c, r, unlit);
  } else if (m == 15) {
    // the nose: pink, a darker underside and a shine on top
    vec3 q = r - vec3(0.0, 0.893, -0.122);
    c = mix(c, c * 0.7, smoothstep(0.002, -0.006, q.y) * 0.6);
    float hl = fill(length((q - vec3(0.0, 0.0045, -0.006)) * vec3(0.8, 1.6, 1.0)) - 0.0042);
    c = mix(c, vec3(1.0, 0.93, 0.9), hl * 0.7);
    unlit = max(unlit, hl * 0.5);
  } else if (m == 2) {
    // the ears: brown fur outside, pink inside (deeper down its middle, a
    // paler rim of fur round it)
    float n = bunNoise(vec3(d.z * 3.0, d.y * 60.0, 0.0)) * 0.6 + bunNoise(vec3(d.z * 9.0, d.y * 150.0, 3.0)) * 0.4;
    c = mix(c, uPal[N_FUR_DEEP], smoothstep(0.55, 0.85, n) * 0.4);
    c = mix(c, uPal[N_FUR_LIGHT], smoothstep(0.42, 0.15, n) * 0.3);
    vec3 pink = mix(uPal[N_PINK], uPal[N_PINK] * vec3(0.9, 0.78, 0.8), (1.0 - abs(d.z)) * smoothstep(0.15, 0.6, d.y) * 0.5);
    pink = mix(pink, uPal[N_CREAM], smoothstep(0.6, 0.85, abs(d.z)) * 0.6);
    c = mix(c, pink, smoothstep(0.25, 0.75, d.x));
  } else if (m == 6 || m == 8) {
    c = bunFur(c, r, 1.0);
  } else if (m == 7) {
    // big feet: tan, the shin's brown fur running down onto the instep,
    // three toes, a pinker pad underneath
    vec3 fq = vec3(r.x * 1.5, r.y, r.z * 0.6);
    c = mix(c, uPal[6], smoothstep(0.045, 0.075, r.y + 0.25 * max(0.0, r.z)) * 0.85);
    c = bunFur(c, fq, 0.6);
    c = mix(c, uPal[N_PAD], d.x * 0.7);
    float toe = band(abs(d.y) - 1.0, 0.09) * smoothstep(-0.11, -0.14, r.z) * step(0.008, r.y);
    c = mix(c, uPal[N_FUR_DEEP], toe * 0.65);
  } else if (m == 11) {
    // the tail: cream, fluffy
    c = mix(c, uPal[N_CREAM], bunNoise(r * 300.0) * 0.5);
    c = mix(c, c * 1.08, smoothstep(0.5, 0.8, bunNoise(r * 140.0 + 2.0)));
  } else if (m == 3) {
    // the shirt (d: x on the body, y down the arm, z on the collar):
    // buttons down the front, the edges of the placket, the sleeves' hems
    float frontB = smoothstep(-0.05, -0.065, r.z) * d.x;
    float plk = band(abs(r.x) - 0.0075, 0.0007) * step(r.y, 0.738) * frontB;
    float yb = (r.y - 0.534) / 0.039;
    float bi = floor(yb + 0.5);
    float btn = fill(length(vec2(r.x, (yb - bi) * 0.039)) - 0.0048) * step(0.5, bi) * step(bi, 5.5) * frontB;
    float btnRim = band(length(vec2(r.x, (yb - bi) * 0.039)) - 0.0048, 0.0007) * step(0.5, bi) * step(bi, 5.5) * frontB;
    c = mix(c, uPal[N_SHIRT_LINE], max(plk, btnRim * 0.9));
    c = mix(c, c * 0.93, btn * (1.0 - btnRim));
    float hem = band(d.y - 0.064, 0.0011) * (1.0 - d.x);
    c = mix(c, uPal[N_SHIRT_LINE], hem * 0.9);
    c = mix(c, uPal[N_SHIRT_LINE], smoothstep(0.55, 0.85, bunNoise(r * vec3(80.0, 30.0, 80.0))) * 0.18);
  } else if (m == 4) {
    // the trousers: rust, deeper in their folds; the waistband's edge, the
    // fly, slant pockets, gathers into the cuffs
    float n = bunNoise(r * vec3(40.0, 18.0, 40.0));
    c = mix(c, uPal[N_RUST_DEEP], smoothstep(0.5, 0.85, n) * 0.35);
    float bandLine = band(r.y - 0.527, 0.0011);
    c = mix(c, uPal[N_RUST_DEEP] * 0.75, bandLine);
    float frontT = smoothstep(-0.04, -0.07, r.z);
    float fly = band(r.x - 0.012 * smoothstep(0.43, 0.41, r.y) * (1.0 - smoothstep(0.38, 0.4, r.y)), 0.0009) * step(0.39, r.y) * step(r.y, 0.526) * frontT;
    vec2 pk = vec2(abs(r.x), r.y);
    float pocket = band((pk.x - 0.068) - (0.526 - pk.y) * 0.55, 0.0011) * step(0.45, pk.y) * step(pk.y, 0.526) * frontT;
    c = mix(c, uPal[N_RUST_DEEP] * 0.7, max(fly, pocket));
    float cx = r.x - sign(r.x) * 0.079;
    float a = atan(cx, r.z);
    float gather = lines(a * 1.43, 0.12) * smoothstep(0.24, 0.16, r.y) * smoothstep(0.1, 0.16, r.y);
    c = mix(c, uPal[N_RUST_DEEP], gather * 0.45 + d.y * 0.2);
    c = mix(c, uPal[N_RUST_DEEP] * 0.75, band(r.y - 0.1185, 0.0012) * d.y + band(r.y - 0.1525, 0.0012) * d.y);
  } else if (m == 5) {
    // the suspenders: stitched down both edges
    c = mix(c, c * 1.35 + 0.03, bunStitch(abs(d.x) - 0.66, r.y * 110.0, 0.09));
  } else if (m == 14) {
    // brass: a brighter rim where it catches the light
    c = mix(c, uPal[N_BRASS_LIGHT], 0.35);
  } else if (m == 9) {
    // the satchel (d: xyz its own coordinates; w 0 its body, 1 the flap, 2
    // the strap): stitched round its faces and its flap's edge, and down
    // both edges of the strap
    vec3 q = d.xyz;
    vec3 deep = uPal[N_OLIVE_DEEP];
    c = mix(c, deep, smoothstep(0.55, 0.85, bunNoise(r * 70.0)) * 0.25);
    if (d.w > 1.5) {
      c = mix(c, c * 1.3 + 0.03, bunStitch(abs(q.x) - 0.7, q.y * 120.0, 0.08));
    } else if (d.w > 0.5) {
      float edge = -0.012 - 0.016 * cos(clamp(q.x / 0.058, -1.0, 1.0) * 1.5708);
      c = mix(c, c * 1.3 + 0.03, bunStitch(q.y - edge - 0.0065, q.x * 130.0, 0.0008) * step(0.0, q.z));
      c = mix(c, deep * 0.8, band(q.y - edge, 0.0012) * step(0.0, q.z));
    } else {
      float s = max(bunStitch(abs(q.x) - 0.049, q.y * 130.0, 0.0008), bunStitch(q.y + 0.053, q.x * 130.0, 0.0008)) * step(0.018, q.z);
      c = mix(c, c * 1.3 + 0.03, s);
    }
  } else if (m == 10) {
    // the hat (d: xyz the hat's own coordinates, w on the brim): its
    // crown in six panels, stitched either side of each seam; rings of
    // stitching round the brim
    vec3 q = d.xyz;
    float rho = length(q.xz);
    float th = atan(q.x, -q.z);
    float u = th * 0.9549 + 0.5;
    float seam = abs(fract(u) - 0.5) * rho * 1.0472;
    float crown = 1.0 - d.w;
    float sd = rho > 0.02 ? 1.0 : 0.0;
    c = mix(c, uPal[N_HAT_DEEP], band(seam, 0.0008) * crown * sd * smoothstep(0.0, 0.03, q.y));
    c = mix(c, uPal[N_HAT_DEEP], bunStitch(abs(seam) - 0.004, q.y * 140.0, 0.0006) * crown * sd * smoothstep(0.01, 0.03, q.y));
    float ring = (rho - 0.116) / 0.0115;
    c = mix(c, uPal[N_HAT_DEEP], bunStitch(abs(fract(ring) - 0.5) * 0.0115 - 0.0, th * rho * 140.0, 0.0006) * step(0.5, ring) * d.w);
    c = mix(c, c * 0.88, smoothstep(0.55, 0.85, bunNoise(r * 60.0)) * 0.3);
  } else if (m == 12) {
    c = mix(c, c * 1.6 + 0.04, 0.0);
  } else if (m == 13) {
    // buck teeth: a little shade at their tips
    c = mix(c, c * 0.88, smoothstep(0.844, 0.837, r.y));
  }
  return c;
}
#elif defined(SKATER)
// --- the skater ------------------------------------------------------------------
// (palette: see COL in game/skater.js; r is the rest position - she is
// sculpted where she stands; see tools/runner/skater.py)
#define K_BRAID_WARM 14
#define K_SKIN_DEEP 15
#define K_SKIN_LIGHT 16
#define K_LIP 17
#define K_LIP_LIGHT 18
#define K_TEE_DEEP 19
#define K_TEE_LIGHT 20
#define K_PIPE 21
#define K_EYE 22
#define K_IRIS 23
#define K_INK 24
#define K_BLUE 25
#define K_RED 26
#define K_PANEL 27
#define K_TREAD 28
#define K_MAPLE 29
#define K_GRAPHIC 31
float skHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float skNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(skHash(i), skHash(i + vec3(1, 0, 0)), f.x), mix(skHash(i + vec3(0, 1, 0)), skHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(skHash(i + vec3(0, 0, 1)), skHash(i + vec3(1, 0, 1)), f.x), mix(skHash(i + vec3(0, 1, 1)), skHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Her skin: warm and even, a shade deeper in its hollows (under the jaw,
// round the knee), catching a soft sheen up high. (Only a whisper of
// mottling on her face: any more reads as dirt at the game's distance.)
vec3 skSkin(vec3 c, vec3 r, float k) {
  float n = skNoise(r * 90.0);
  c = mix(c, uPal[K_SKIN_DEEP], 0.12 * k * smoothstep(0.45, 0.8, n));
  return mix(c, uPal[K_SKIN_LIGHT], 0.08 * k * smoothstep(0.5, 0.2, n));
}
// Her face, drawn on the front of her head as her sheet draws it: big
// almond-shaped eyes, warm brown irises filling most of them, under heavy
// lids lowered over the tops of the irises (cool, not much impressed), a
// bold upper lash line winging out at the corner; thick brows, arched toward
// their outer ends; a small soft nose, its nostrils; full rosy-brown lips,
// the lower one catching the light, closed in an even line.
vec3 drawFace(vec3 base, vec3 r, vec4 d, inout float unlit) {
  float front = smoothstep(-0.05, -0.072, r.z);
  vec3 c = base;
  vec2 f = vec2(abs(r.x), r.y);
  vec3 ink = uPal[K_INK];
  // a sheen across the cheekbones and down the bridge of the nose
  float cheek = 1.0 - smoothstep(0.2, 1.0, length((f - vec2(0.047, 1.493)) / vec2(0.019, 0.011)));
  float bridge = (1.0 - smoothstep(0.0025, 0.006, f.x)) * smoothstep(1.47, 1.482, r.y) * (1.0 - smoothstep(1.505, 1.515, r.y));
  c = mix(c, uPal[K_SKIN_LIGHT], (0.3 * cheek + 0.26 * bridge) * front);
  // (a shade deeper under the jaw, and a warm blush over the cheeks)
  c = mix(c, uPal[K_SKIN_DEEP], 0.28 * smoothstep(1.43, 1.405, r.y) * smoothstep(-0.02, -0.06, r.z));
  float blush = 1.0 - smoothstep(0.0, 1.0, length((f - vec2(0.05, 1.48)) / vec2(0.022, 0.014)));
  c = mix(c, uPal[K_LIP_LIGHT], 0.18 * blush * front);
  if (front <= 0.0) return c;
  // the eye: a big almond, its outer corner lifted
  vec2 E = vec2(0.0352, 1.5125);
  vec2 q = f - E;
  q.y -= 0.14 * q.x;
  float w = 0.0192;
  float xn = clamp(q.x / w, -1.0, 1.0);
  float yU = 0.0118 * (1.0 - xn * xn) * (1.0 + 0.18 * xn);
  float yL = -0.0074 * (1.0 - xn * xn) * (1.0 - 0.15 * xn);
  float dA = max(max(q.y - yU, yL - q.y), abs(q.x) - w);
  // the heavy upper lid, lowered over the top of the iris
  float lidY = yU * 0.66 - 0.0004;
  float dS = max(dA, q.y - lidY);
  float eye = fill(dS) * front;
  c = mix(c, uPal[K_EYE], eye);
  unlit = max(unlit, eye * 0.45);
  // the iris (warm brown, lighter low down where the light comes through, a
  // dark ring round it), the pupil, two catch-lights
  vec2 ic = q - vec2(-0.0012, -0.0004);
  float ir = length(ic);
  float IR = 0.0094;
  vec3 iris = mix(uPal[K_IRIS] * 1.9 + 0.03, uPal[K_IRIS], smoothstep(-0.006, 0.004, ic.y));
  iris = mix(iris, uPal[K_IRIS] * 0.45, smoothstep(IR - 0.0022, IR, ir));
  iris = mix(iris, ink, fill(ir - 0.0034));
  float inI = fill(max(ir - IR, dS)) * front;
  // (the lid casts a soft shadow over the top of the iris and the white)
  float lidSh = smoothstep(lidY - 0.0035, lidY, q.y);
  c = mix(c, iris, inI);
  c *= 1.0 - 0.3 * lidSh * eye;
  float glint = max(fill(length(ic - vec2(0.0033, 0.0022)) - 0.0017), 0.8 * fill(length(ic - vec2(-0.003, -0.0036)) - 0.0008)) * inI;
  c = mix(c, vec3(1.0), glint);
  unlit = max(unlit, max(inI * 0.3, glint));
  // the lid: its bold lash line, thickest toward the outer corner and
  // winging out past it, and the fold of the lid over it
  float lash = band(q.y - lidY, 0.0009 + 0.0011 * smoothstep(-0.012, 0.016, q.x)) * step(abs(q.x), w + 0.0004) * step(yL, q.y);
  float wing = band(q.y - (lidY + (q.x - w * 0.8) * 0.5), 0.0011 * (1.0 - smoothstep(w, w + 0.0055, q.x)) + 0.0003) * step(w * 0.8, q.x) * step(q.x, w + 0.0055);
  c = mix(c, ink, max(lash, wing) * front);
  float fold = band(q.y - (yU + 0.0036) * (1.0 - 0.12 * xn), 0.0006) * step(abs(q.x), w * 0.85);
  c = mix(c, uPal[K_SKIN_DEEP] * 0.75, fold * front * 0.75);
  // (the lid itself a touch deeper, between the lash line and the fold)
  float lid = step(lidY, q.y) * step(q.y, (yU + 0.0036) * (1.0 - 0.12 * xn)) * step(abs(q.x), w);
  c = mix(c, uPal[K_SKIN_DEEP], lid * front * 0.25);
  float lower = band(q.y - yL, 0.00055) * step(abs(q.x), w * 0.8) * smoothstep(-w, w * 0.2, q.x);
  c = mix(c, ink, lower * front * 0.55);
  // brows: thick and neat, rising to an arch two-thirds of the way out and
  // falling to a fine tail
  // (a parabola either side of the arch: flatter toward her nose, falling
  // only a few millimetres to the tail - never down her cheek)
  vec2 bq = f - vec2(0.0335, 1.536);
  float bx = bq.x;
  float ba = bx - 0.008;
  bq.y -= 0.0032 - (ba > 0.0 ? 17.0 : 4.5) * ba * ba;
  float bw = 0.0032 - 0.002 * smoothstep(0.0, 0.024, bx) + 0.0004 * smoothstep(-0.008, -0.018, bx);
  float brow = band(bq.y, bw) * smoothstep(-0.0215, -0.019, bx) * (1.0 - smoothstep(0.022, 0.025, bx));
  float hairs = 0.8 + 0.2 * lines(bx * 900.0 + bq.y * 400.0, 0.3);
  c = mix(c, mix(ink, uPal[2], 0.35), brow * front * hairs);
  // the nostrils under the tip of her nose
  vec2 nq = vec2(f.x - 0.0074, r.y - 1.4658);
  float nos = fill(length(nq / vec2(0.0033, 0.0017)) - 1.0) * smoothstep(-0.088, -0.094, r.z);
  c = mix(c, uPal[K_SKIN_DEEP] * 0.55, nos * 0.8);
  // lips: full, rosy brown, the lower catching the light; closed in an
  // even line
  float mz = smoothstep(-0.07, -0.08, r.z);
  vec2 lq = vec2(r.x, r.y - 1.443);
  float bow = 0.0016 * (1.0 - smoothstep(0.0, 0.008, abs(lq.x)));
  float up = (length(vec2(lq.x / 0.0205, (lq.y - 0.0052) / (0.0062 - bow * 0.6))) - 1.0);
  float lo = (length(vec2(lq.x / 0.0185, (lq.y + 0.0052) / 0.0074)) - 1.0);
  float lips = fill(min(up, lo) * 0.008) * mz;
  vec3 lip = mix(uPal[K_LIP], uPal[K_LIP_LIGHT], 0.35 * smoothstep(0.0, -0.008, lq.y));
  lip = mix(lip, uPal[K_LIP_LIGHT] * 1.12, 0.6 * (1.0 - smoothstep(0.0, 0.7, length(vec2(lq.x / 0.009, (lq.y + 0.0055) / 0.003)))));
  c = mix(c, lip, lips);
  float seam = band(lq.y + 0.0002 + 0.001 * smoothstep(0.01, 0.018, abs(lq.x)), 0.0006) * step(abs(lq.x), 0.0185) * mz;
  c = mix(c, uPal[K_LIP] * 0.45, seam);
  // (the face takes the light softly)
  unlit = max(unlit, 0.22 * front);
  return c;
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 1) {
    c = skSkin(c, r, 0.4);
    // (the inside of the ear a shade deeper)
    c = mix(c, uPal[K_SKIN_DEEP], d.y * 0.35 * smoothstep(0.004, -0.004, r.z - 0.018));
    c = drawFace(c, r, d, unlit);
  } else if (m == 5 || m == 8) {
    c = skSkin(c, r, 1.0);
    if (m == 5) {
      // the crew socks: white, ribbed, a little square badge on the outside
      // near the top (blue round red), the cuff's ribs
      float side = r.x < 0.0 ? -1.0 : 1.0;
      float x = r.x - side * 0.087;
      float a = atan(r.z - 0.008, x * side);
      float sock = fill(r.y - (uRig[0].x + 0.0015 * sin(a * 5.0)));
      vec3 sk = uPal[6];
      sk = mix(sk, sk * 0.92, lines(a * 9.5, 0.22) * 0.6);
      vec2 bq = vec2(a / 1.4, r.y - (uRig[0].x - 0.045));
      bq.x *= 0.04;
      float badge = fill(max(abs(bq.x), abs(bq.y)) - 0.0085);
      float inner = fill(max(abs(bq.x), abs(bq.y)) - 0.0052);
      float core = fill(max(abs(bq.x - 0.0008), abs(bq.y + 0.0008)) - 0.0024);
      sk = mix(sk, uPal[K_BLUE], badge * (1.0 - inner));
      sk = mix(sk, uPal[K_RED], inner * (1.0 - core));
      sk = mix(sk, uPal[K_BLUE], core);
      sk = mix(sk, sk * 0.86, d.x * lines(a * 14.0, 0.25));
      c = mix(c, sk, sock);
      // (a soft shade where the sock's cuff meets her leg)
      c = mix(c, uPal[K_SKIN_DEEP], 0.25 * (1.0 - sock) * smoothstep(0.012, 0.0, r.y - uRig[0].x));
    }
  } else if (m == 2) {
    // the cap of braids: the parts between them showing her scalp, the
    // braids plaited, pulled up toward the cuff (and the gold cuff round
    // the ponytail)
    float on = smoothstep(0.2, 0.62, d.x);
    vec3 scalp = mix(uPal[K_SKIN_DEEP] * 0.75, uPal[2], 0.35);
    float plait = lines(d.y / 0.0105 + 0.3 * skNoise(r * 400.0), 0.18);
    c = mix(c, c * 0.62, plait * on);
    c = mix(scalp, c, on);
    c = mix(c, uPal[9], smoothstep(0.4, 0.7, d.z));
    unlit = max(unlit, 0.15 * smoothstep(0.4, 0.7, d.z));
  } else if (m == 13) {
    // the braids: three strands plaited down each - chevrons along it, a
    // shade between - each braid its own (a few of them warmer, browner)
    float warm = step(0.62, d.z) * step(d.z, 0.86) + step(d.z, 0.08);
    c = mix(c, uPal[K_BRAID_WARM], warm * 0.75);
    c *= 0.9 + 0.2 * fract(d.z * 7.3);
    float v = d.x / 0.0105 + 0.55 * abs(sin(d.y));
    float groove = lines(v, 0.16);
    c = mix(c, c * 0.5, groove);
    c = mix(c, c * 1.25 + 0.012, (1.0 - smoothstep(0.0, 0.32, abs(fract(v) - 0.5))) * 0.4);
    // (the ends, sealed, a touch lighter)
    c = mix(c, c * 1.15, smoothstep(0.9, 1.0, fract(d.x * 0.0)));
  } else if (m == 3) {
    // the tee: neon lime cotton; the collar's rib, the hems stitched, the
    // folds a shade deeper where it hangs loose
    float n = skNoise(r * vec3(40.0, 14.0, 40.0));
    c = mix(c, uPal[K_TEE_DEEP], 0.18 * smoothstep(0.5, 0.85, n) * d.x);
    c = mix(c, uPal[K_TEE_LIGHT], 0.18 * smoothstep(0.45, 0.15, n));
    float rib = d.z * (0.7 + 0.3 * lines(atan(r.x, r.z) * 40.0, 0.22));
    c = mix(c, uPal[K_TEE_DEEP], 0.35 * rib);
    float hem = uRig[2].y - 0.018 * clamp(r.z / 0.11, -1.0, 1.0) + 0.012 * smoothstep(0.09, 0.16, abs(r.x));
    float stitch = band(r.y - hem - 0.016, 0.0007) * step(0.4, fract(atan(r.x, r.z) * 70.0)) * (1.0 - d.y);
    float sl = band(d.w - (uRig[2].x - 0.018), 0.0008) * step(0.4, fract(atan(r.y, r.z) * 60.0)) * step(0.6, d.y);
    c = mix(c, uPal[K_TEE_DEEP], max(stitch, sl) * 0.9);
  } else if (m == 4) {
    // the shorts: black, a faint sheen; white piping down the outside of each
    // leg and round its hem; slant pockets; the waistband's edge
    float side = r.x < 0.0 ? -1.0 : 1.0;
    float a = atan(r.z - 0.012, abs(r.x) - 0.08);
    float hem = uRig[0].w + 0.01 * clamp(r.z / 0.09, -1.0, 1.0);
    float pipe = band(a, 0.045) * smoothstep(0.86, 0.84, r.y) + band(r.y - hem - 0.011, 0.0013) * (1.0 - band(a, 0.4) * 0.0);
    c = mix(c, c * 1.5 + 0.03, 0.4 * smoothstep(0.55, 0.85, skNoise(r * vec3(30.0, 10.0, 30.0))));
    float pocket = band((abs(r.x) - 0.12) - (0.86 - r.y) * 0.35, 0.0008) * step(0.74, r.y) * step(r.y, 0.86) * step(r.z, 0.0);
    c = mix(c, c * 2.4 + 0.05, pocket * 0.6);
    c = mix(c, uPal[K_PIPE], pipe);
  } else if (m == 7) {
    // chunky skate shoes: a thick white cupsole, its wall grooved all
    // round, a tread line along its top; light grey suede over the toe cap
    // and the heel; laces criss-crossing up the front; a padded collar
    float side = r.x < 0.0 ? -1.0 : 1.0;
    float x = r.x - side * uRig[0].y;
    float y = r.y - 0.02 * pow(smoothstep(-0.1, -0.2, r.z), 2.0);
    float sole = fill(y - uRig[1].z);
    float a = atan(x, r.z - 0.0);
    vec3 so = mix(uPal[7], uPal[7] * 0.97, 0.5);
    so = mix(so, uPal[K_TREAD], lines(r.z * 60.0 + x * 20.0, 0.12) * step(0.008, y) * step(y, uRig[1].z - 0.008) * 0.6);
    so = mix(so, uPal[K_TREAD], band(y - (uRig[1].z - 0.006), 0.0012));
    so = mix(so, uPal[K_TREAD] * 0.8, fill(y - 0.006));
    // panels: the toe cap, the heel counter, a stripe along the quarter
    // (uRig[1].y, .w: the heel's and the toe's ends along it)
    float tz = uRig[1].w + 0.066, hz = uRig[1].y - 0.056;
    float toe = fill(r.z - tz + max(0.0, y - 0.07) * 1.2);
    float heel = fill(hz - r.z + max(0.0, y - 0.105) * 0.8);
    float quarter = band(y - 0.08 - 0.25 * (r.z + 0.04), 0.008) * step(-0.08, r.z) * step(r.z, hz) * step(0.028, abs(x));
    vec3 up = uPal[7];
    up = mix(up, uPal[K_PANEL], max(max(toe, heel), quarter));
    up = mix(up, uPal[K_PANEL] * 0.92, band(r.z - tz + max(0.0, y - 0.07) * 1.2, 0.0012));
    // the laces up the instep and the tongue
    float onT = step(r.z, -0.026 + (y - 0.095) * 0.2) * step(tz - 0.004, r.z) * step(abs(x), 0.025) * step(0.088, y) * step(y, uRig[1].x);
    float lace = max(band(abs(fract((r.z * 1.0 + x * 0.9) / 0.019 + 0.5) - 0.5), 0.12), band(abs(fract((r.z - x * 0.9) / 0.019 + 0.5) - 0.5), 0.12));
    up = mix(up, vec3(0.99, 0.98, 0.96), lace * onT * step(abs(x), 0.02));
    up = mix(up, uPal[K_TREAD] * 0.85, (band(abs(x) - 0.022, 0.0015) * onT));
    float collar = smoothstep(uRig[1].x - 0.022, uRig[1].x - 0.01, r.y);
    up = mix(up, uPal[K_PANEL] * 1.03, collar * 0.6);
    c = mix(up, so, sole);
  } else if (m == 9) {
    // gold: warm, with a bright edge where it catches the light
    c = mix(c, vec3(1.0, 0.9, 0.55), 0.25);
    unlit = max(unlit, 0.22);
  } else if (m == 10) {
    // the deck: black grip on top (grainy, its truck bolts showing), the
    // maple plies round its edge, the graphic underneath - a purple deck,
    // three lime chevrons up it toward the nose, scuffed at the ends
    float g = skHash(floor(r * 900.0));
    if (d.z > 0.5) {
      c = mix(c, c * 1.6 + 0.02, step(0.86, g) * 0.6);
      vec2 bq = vec2(abs(r.x), abs(abs(r.z) - 0.18));
      float bolt = fill(length(vec2(bq.x - 0.019, bq.y - 0.022)) - 0.0042);
      c = mix(c, uPal[11] * 1.1, bolt);
    } else if (d.z < -0.5) {
      vec3 gr = uPal[K_GRAPHIC];
      float u = d.y + abs(d.x) * 0.45;
      float chev = 0.0;
      for (int k = 0; k < 3; k++) chev = max(chev, band(u - (-0.42 + 0.17 * float(k)), 0.042));
      gr = mix(gr, uPal[3], chev * step(abs(d.x), 0.86));
      gr = mix(gr, uPal[12], band(d.y - 0.55, 0.035) * step(abs(d.x), 0.86));
      float wear = smoothstep(0.82, 0.97, abs(d.y)) * step(0.55, skNoise(r * 200.0));
      gr = mix(gr, uPal[K_MAPLE], wear * 0.8);
      c = gr;
    } else {
      float ply = lines((r.y - 0.087) / 0.0017, 0.18);
      c = mix(uPal[K_MAPLE], uPal[K_MAPLE] * 0.72, ply * 0.6);
    }
  } else if (m == 11) {
    // the trucks: brushed metal, the baseplate darker
    c = mix(c, c * 0.72, step(0.068, r.y));
    c = mix(c, c * 1.15, lines(r.x * 260.0, 0.2) * 0.3);
  } else if (m == 12) {
    // the wheels: cream urethane, the bearing showing at the hub
    vec2 hq = vec2(r.y - 0.027, abs(r.z) - 0.18);
    float rho = length(hq);
    c = mix(c, vec3(0.32, 0.32, 0.35), fill(rho - 0.011) * step(0.8, d.w));
    c = mix(c, c * 0.88, band(rho - 0.017, 0.0011) * step(0.8, d.w));
  }
  return c;
}
#elif defined(SAMURAI)
// --- the samurai -----------------------------------------------------------------
// (palette: see COL in game/samurai.js; r is the rest position - he is
// sculpted where he stands; see tools/runner/samurai.py. uRig[0]: x, y his
// shoulder joint, z how far out his arms hang (rad), w his feet's x.)
#define T_STRIPE 17
#define T_LIGHT 18
#define T_SHADE 19
#define T_KIMONO_LIGHT 20
#define T_KIMONO_DEEP 21
#define T_IRIS_LIGHT 22
#define T_IRIS 23
#define T_INK 24
#define T_MOUTH 25
#define T_EAR_IN 26
#define T_OBI_DEEP 27
#define T_HAKAMA_DEEP 28
#define T_STEEL_LIGHT 29
#define T_PAD 30
#define T_SAME 31
float tgHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float tgNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(tgHash(i), tgHash(i + vec3(1, 0, 0)), f.x), mix(tgHash(i + vec3(0, 1, 0)), tgHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(tgHash(i + vec3(0, 0, 1)), tgHash(i + vec3(1, 0, 1)), f.x), mix(tgHash(i + vec3(0, 1, 1)), tgHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Tiger stripes: dark bands across s (freq of them a metre), wavering and
// forking as they go, each its own width, pointed at its ends - reaching
// round from where across is 0 (the outside of a limb, his spine, the
// middle of his brow) only so far toward |across| = 1, some further than
// others, a little to one side or the other. Coverage, antialiased.
float tgStripes(float s, float across, float freq, float seed, float w) {
  float n = tgNoise(vec3(s * freq * 0.55, across * 2.2, seed)) - 0.5;
  float n2 = tgNoise(vec3(s * freq * 1.7, across * 6.0, seed + 7.0)) - 0.5;
  float v = s * freq + n * 0.85 + n2 * 0.3;
  float id = floor(v);
  float h = fract(sin(id * 12.9898 + seed * 78.233) * 43758.5453);
  float h2 = fract(h * 7.13 + 0.31);
  float reach = 0.42 + 0.62 * h2;
  float a = abs(across + (h - 0.5) * 0.5);
  float taper = 1.0 - smoothstep(reach * 0.35, reach, a);
  float width = w * (0.55 + 0.7 * h) * pow(taper, 0.7);
  float d = abs(fract(v) - 0.5) - width * 0.5;
  // (a few split in two along part of their length)
  float split = step(0.72, h) * smoothstep(0.2, 0.5, a) * band(fract(v) - 0.5, width * 0.12);
  return fill(d) * (1.0 - split) * step(0.02, width);
}
// Painted fur: short strokes running down him, a shade deeper and lighter.
vec3 tgFur(vec3 c, vec3 q, float k) {
  float n = tgNoise(q * vec3(110.0, 42.0, 110.0)) * 0.6 + tgNoise(q * vec3(240.0, 95.0, 240.0) + 3.7) * 0.4;
  c = mix(c, uPal[T_SHADE], smoothstep(0.55, 0.85, n) * 0.4 * k);
  return mix(c, uPal[T_LIGHT], smoothstep(0.42, 0.15, n) * 0.45 * k);
}
// A stripe's colour: charcoal brown, a little warmer and softer at its
// edges where the fur grows through.
vec3 tgInk(vec3 c, float s, vec3 q) {
  float n = tgNoise(q * 300.0);
  vec3 st = mix(uPal[T_STRIPE], uPal[T_STRIPE] * 1.35 + 0.03, 0.35 * n);
  return mix(c, st, s);
}
// Round a limb (axis down y through (cx, cz)): 0 on its outside (side: +1
// for the right side), 1 on its inside, signed by front and back.
float tgRound(vec3 r, float cx, float cz, float side) {
  return atan(r.z - cz, (r.x - cx) * side) / 3.1416;
}
// --- his face, drawn on the front of his head: stern golden eyes, the brow
// pressed down over them in a heavy V, a cheetah's dark tear line running
// from each inner corner down beside his muzzle; white above the eyes,
// rows of whisker spots, the dusty-rose nose, the mouth set hard, its
// corners turned down; the tiger's marks over his brow and crown, curving
// down his cheeks, ringing his neck.
vec3 tgFace(vec3 c, vec3 r, vec4 d, inout float unlit) {
  vec3 ink = uPal[T_INK];
  vec2 f = vec2(abs(r.x), r.y);
  float front = smoothstep(-0.075, -0.1, r.z);
  // white: the muzzle, the chin and throat, above the eyes, the cheeks
  // under the eyes
  float muz = 1.0 - smoothstep(0.75, 1.05, length((f - vec2(0.024, 1.742)) / vec2(0.054, 0.04)));
  float chin = 1.0 - smoothstep(0.7, 1.05, length((f - vec2(0.0, 1.708)) / vec2(0.06, 0.03)));
  float throat = smoothstep(1.74, 1.66, r.y) * smoothstep(-0.02, -0.07, r.z) * (1.0 - smoothstep(0.03, 0.075, f.x));
  float above = 1.0 - smoothstep(0.6, 1.0, length((f - vec2(0.05, 1.818)) / vec2(0.024, 0.011)));
  float under = 1.0 - smoothstep(0.6, 1.0, length((f - vec2(0.06, 1.78)) / vec2(0.03, 0.016)));
  float white = max(max(muz, chin), max(max(throat, above * front), under * front * 0.7));
  c = mix(c, uPal[T_LIGHT], white * 0.85);
  // the marks: bars across his brow and crown, from the middle out (a gap
  // left down the middle of his forehead), round toward his ears
  float ph = atan(r.z - 0.014, r.y - 1.835);
  float crown = smoothstep(1.815, 1.84, r.y) * (1.0 - above);
  float bars = tgStripes(ph * 0.11, r.x / 0.085, 52.0, 3.0, 0.38) * crown;
  bars *= smoothstep(0.004, 0.012, f.x) + 0.6 * step(0.0, r.z);
  // (the middle of the brow: three short dark dashes, like a brush's)
  float mid = band(f.x - 0.0, 0.0028) * smoothstep(1.842, 1.848, r.y) * (1.0 - smoothstep(1.874, 1.88, r.y)) * front;
  mid = max(mid, band(abs(r.x) - 0.014, 0.0024) * smoothstep(1.85, 1.856, r.y) * (1.0 - smoothstep(1.866, 1.872, r.y)) * front);
  // down his cheeks and through the ruff, sweeping back and down
  float side = smoothstep(0.06, 0.085, f.x) * smoothstep(1.83, 1.8, r.y);
  float cheek = tgStripes(r.y + (f.x - 0.06) * 0.7 - r.z * 0.25, (r.z + 0.04) / 0.07, 46.0, 9.0, 0.34) * side * (1.0 - under * 0.8);
  // ringing the neck behind, fading round to the white throat
  float neck = tgStripes(r.y + 0.12 * r.z, atan(r.x, r.z) / 3.1416 * 1.6, 30.0, 4.0, 0.36) * smoothstep(1.735, 1.71, r.y) * (1.0 - throat);
  float marks = max(max(bars, mid), max(cheek, neck * 0.9));
  c = tgInk(c, marks, r);
  if (front <= 0.0) return c;
  // the eye: an almond, slanting up toward its outer corner
  vec2 E = vec2(0.0455, 1.7995);
  vec2 q = f - E;
  q.y -= 0.3 * q.x;
  float w = 0.0182;
  float xn = clamp(q.x / w, -1.0, 1.0);
  float yU = 0.0078 * (1.0 - xn * xn) * (1.0 + 0.12 * xn);
  float yL = -0.0062 * (1.0 - xn * xn) * (1.0 - 0.25 * xn);
  float dA = max(max(q.y - yU, yL - q.y), abs(q.x) - w);
  // (stern: the upper lid lowered flat across the top of the eye)
  float lidY = min(yU, 0.0032 - 0.0016 * xn);
  float dS = max(dA, q.y - lidY);
  float eye = fill(dS);
  // the iris fills it: gold, lighter low down where the light comes through,
  // a darker ring round its edge; a round dark pupil, small and fixed on
  // you; a catch-light
  vec2 ic = q - vec2(-0.0006, -0.0006);
  float ir = length(ic);
  vec3 iris = mix(uPal[T_IRIS_LIGHT], uPal[T_IRIS], smoothstep(-0.006, 0.004, ic.y));
  iris = mix(iris, uPal[T_IRIS] * 0.55, smoothstep(0.0072, 0.0098, ir));
  iris = mix(iris, ink, fill(ir - 0.0033));
  c = mix(c, iris, eye);
  float glint = fill(length(ic - vec2(0.0026, 0.0018)) - 0.0012) * eye;
  c = mix(c, vec3(1.0), glint);
  unlit = max(unlit, max(eye * 0.55, glint));
  gKeep = max(gKeep, eye);
  // (the lid's shadow over the top of the iris)
  c *= 1.0 - 0.35 * smoothstep(lidY - 0.003, lidY, q.y) * eye;
  // dark rims all round it, heavy along the lowered lid, running out at the
  // inner corner into the tear line
  float rim = band(dS, 0.0011 + 0.0011 * smoothstep(-0.004, 0.012, q.x)) * step(abs(q.x), w + 0.0015);
  float lid = band(q.y - lidY, 0.0016 + 0.0008 * smoothstep(0.0, 0.016, q.x)) * step(abs(q.x), w + 0.001) * step(yL, q.y);
  // the cheetah's tear line: from the inner corner down beside the bridge
  // of his nose and over the whisker pad toward the corner of his mouth
  float ty = clamp((E.y - 0.004 - r.y) / 0.064, 0.0, 1.0);
  float tx = 0.0315 - 0.006 * ty + 0.016 * ty * ty;
  float tear = band(f.x - tx, 0.0023 * (1.0 - 0.55 * ty) + 0.0004) * step(r.y, E.y - 0.003) * smoothstep(E.y - 0.074, E.y - 0.06, r.y);
  // the brow: a heavy dark mark pressed down over each eye, low by his nose
  // and rising to the outside - a scowl in a V
  vec2 bq = f - vec2(0.046, 1.8155 + 0.36 * (f.x - 0.046));
  float browW = 0.0034 * (1.0 - smoothstep(0.0, 0.03, f.x - 0.03)) + 0.0012;
  float brow = band(bq.y, browW) * smoothstep(0.018, 0.024, f.x) * (1.0 - smoothstep(0.066, 0.072, f.x));
  c = mix(c, ink, max(max(rim, lid), max(tear, brow * 0.92)));
  // the whisker spots: rows of little dark dots on each pad
  vec2 wq = f - vec2(0.03, 1.748);
  float spots = 0.0;
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 4; j++) {
      vec2 o = vec2(0.008 + 0.0105 * float(j), 0.0105 - 0.0075 * float(i) - 0.0025 * float(j));
      spots = max(spots, fill(length(wq - o + vec2(0.03, 0.0)) - 0.0016));
    }
  }
  c = mix(c, uPal[T_STRIPE], spots * smoothstep(-0.12, -0.135, r.z) * 0.75);
  // the mouth: down from the nose, parting along the bottom of each whisker
  // pad, its corners turned down hard
  float mz = smoothstep(-0.1, -0.115, r.z);
  float phil = band(f.x, 0.0011) * step(1.727, r.y) * step(r.y, 1.756);
  float ly = 1.7285 - 0.24 * f.x - 2.2 * f.x * f.x;
  float lip = band(r.y - ly, 0.0015 + 0.0008 * smoothstep(0.0, 0.05, f.x)) * step(f.x, 0.056);
  c = mix(c, uPal[T_MOUTH], max(phil, lip) * mz);
  return c;
}
vec3 charDetail(int m, vec3 base, vec3 r, vec4 d, inout float unlit) {
  vec3 c = base;
  if (m == 1) {
    c = tgFur(c, r, 0.8);
    // (his ruff's tufts a shade deeper toward their roots)
    c = mix(c, uPal[T_SHADE], d.w * 0.25);
    c = tgFace(c, r, d, unlit);
  } else if (m == 2) {
    // the nose: dusty rose, a darker rim and nostrils underneath, a shine
    vec3 q = r - vec3(0.0, 1.772, -0.172);
    c = mix(c, c * 0.72, smoothstep(0.0, -0.01, q.y) * 0.6);
    vec2 nq = vec2(abs(q.x) - 0.009, q.y + 0.0065);
    c = mix(c, uPal[T_MOUTH], fill(length(nq / vec2(0.006, 0.0028)) - 1.0) * smoothstep(-0.16, -0.168, r.z));
    float hl = fill(length((q - vec3(0.0, 0.006, -0.008)) * vec3(0.7, 1.4, 1.0)) - 0.0032);
    c = mix(c, vec3(1.0, 0.94, 0.92), hl * 0.4);
    unlit = max(unlit, hl * 0.2);
  } else if (m == 3) {
    // the ears: dark behind with a white spot in the middle, pale and furred
    // inside the dish
    float back = 1.0 - smoothstep(0.25, 0.6, d.x);
    vec3 dark = mix(uPal[T_STRIPE], uPal[T_STRIPE] * 1.4, tgNoise(r * 260.0) * 0.4);
    float spot = 1.0 - smoothstep(0.28, 0.44, length(vec2(d.z * 1.1, (d.y - 0.5) * 1.6)));
    vec3 outside = mix(dark, uPal[T_LIGHT], spot * 0.9);
    // (pale fur at its very base, where it grows out of his head)
    outside = mix(outside, base, smoothstep(0.22, 0.05, d.y));
    vec3 inside = mix(uPal[T_EAR_IN], uPal[T_LIGHT], smoothstep(0.3, 0.75, abs(d.z)) * 0.7 + tgNoise(r * 400.0) * 0.25);
    c = mix(inside, outside, back);
  } else if (m == 5 || m == 9 || m == 10) {
    // fur: his chest in the V, his forearms, his lower legs, his hands and
    // paws - ivory, striped
    c = tgFur(c, r, 0.7);
    vec2 S = uRig[0].xy;
    float ar = uRig[0].z;
    float sx = r.x < 0.0 ? -1.0 : 1.0;
    float st = 0.0;
    if (r.y < 0.62) {
      // a leg: rings down it from the outside, round toward the inside
      float cx = sx * uRig[0].w;
      float a = tgRound(r, cx, 0.01, sx);
      st = tgStripes(r.y - 0.05 * r.z, abs(a) * 1.1 - 0.05, 30.0, 11.0 + sx, 0.34);
      // (pale on the inside of the leg and down the front of the paw)
      st *= smoothstep(0.06, 0.1, r.y + 0.3 * max(0.0, -r.z - 0.04)) * (m == 10 ? 0.85 : 1.0);
      if (m == 10) {
        // the paw: the pads underneath, the toes parted on top
        c = mix(c, uPal[T_PAD], d.x * 0.9);
        c = mix(c, uPal[T_SHADE] * 0.7, band(fract(d.y * 0.5) - 0.5, 0.06) * d.z * 0.7 * step(0.014, r.y));
      }
    } else if (abs(r.x) > 0.2 || r.y < 1.12) {
      // an arm (and a hand): rings round it, from the outside
      vec2 dn = vec2(sx * sin(ar), -cos(ar));
      vec2 o = r.xy - vec2(sx * S.x, S.y);
      float u = dot(o, dn);
      float acr = dot(o, vec2(-dn.y, dn.x)) * sx;
      float a = atan(r.z, acr) / 3.1416;
      st = tgStripes(u, abs(a + 0.15) * 1.05, 26.0, 21.0 + sx, 0.32);
      // (the palms and the fingers pale)
      st *= m == 9 ? smoothstep(0.66, 0.62, u) * step(0.0, acr + 0.004) : 1.0;
    } else {
      // the chest in the V: pale down the middle, a few marks at its sides
      float a = abs(r.x) / 0.08;
      st = tgStripes(r.y - abs(r.x) * 0.4, 1.0 - a, 34.0, 5.0, 0.26) * smoothstep(0.035, 0.06, abs(r.x));
      c = mix(c, uPal[T_LIGHT], 0.4 * (1.0 - smoothstep(0.0, 0.05, abs(r.x))));
      // (the shadow of the kimono's edges over it)
      float e = (0.078 - (1.648 - r.y) * 0.37) - abs(r.x);
      c *= 1.0 - 0.28 * smoothstep(0.018, 0.0, e);
    }
    c = tgInk(c, st, r);
  } else if (m == 11) {
    // the tail: rings down it, wider toward the end, its tip dark
    float s = d.x;
    float wob = (tgNoise(r * 40.0) - 0.5) * 0.04;
    float ring = tgStripes(s + wob, 0.0, 9.5 + 3.0 * d.y, 13.0, 0.36 + 0.24 * d.y);
    c = tgFur(c, r, 0.6);
    c = tgInk(c, max(ring, smoothstep(0.9, 0.95, d.y)), r);
  } else if (m == 12) {
    // claws: dark horn, paler toward the tips
    c = mix(c, c * 2.2 + 0.08, smoothstep(0.4, 1.0, tgNoise(r * 900.0)) * 0.3);
  } else if (m == 4) {
    // the kimono (d: x on the body, y down the arm, z across the collar band
    // (-1 off it), w inside a sleeve): heavy cotton, deeper in its folds; the
    // collar band a shade lighter, two lines of stitching down it; the
    // sleeves dark inside
    float n = tgNoise(r * vec3(36.0, 14.0, 36.0));
    c = mix(c, uPal[T_KIMONO_DEEP], smoothstep(0.5, 0.85, n) * 0.5);
    c = mix(c, uPal[T_KIMONO_LIGHT], smoothstep(0.4, 0.15, n) * 0.25);
    // (the weave: a fine grain across it)
    c = mix(c, uPal[T_KIMONO_LIGHT], lines(r.y * 420.0 + sin(r.x * 300.0) * 0.3, 0.12) * 0.12);
    if (d.z > -0.5) {
      c = mix(c, uPal[T_KIMONO_LIGHT], 0.55);
      float stitch = max(band(d.z - 0.22, 0.04), band(d.z - 0.78, 0.04)) * step(0.45, fract(r.y * 160.0));
      c = mix(c, uPal[T_KIMONO_LIGHT] * 1.5 + 0.04, stitch * 0.6);
      c = mix(c, uPal[T_KIMONO_DEEP] * 0.7, band(d.z, 0.05) + band(d.z - 1.0, 0.05));
    }
    c = mix(c, uPal[T_KIMONO_DEEP] * 0.6, d.w * 0.8);
    // (the hem and the sleeves' ends, stitched)
    float hem = band(r.y - 0.948, 0.0012) * d.x;
    c = mix(c, uPal[T_KIMONO_LIGHT] * 1.3, hem * 0.7);
  } else if (m == 6) {
    // the hakama: charcoal, its knife pleats down the front pressed into
    // dark creases, deeper in the folds, the gathered cuffs tied
    float n = tgNoise(r * vec3(30.0, 10.0, 30.0));
    c = mix(c, uPal[T_HAKAMA_DEEP], smoothstep(0.5, 0.85, n) * 0.5);
    float pleat = lines(d.y * 7.0 / 6.2832 + 0.5, 0.05) * smoothstep(0.3, 0.6, cos(d.y)) * smoothstep(0.34, 0.5, r.y) * smoothstep(1.2, 1.05, r.y);
    c = mix(c, uPal[T_HAKAMA_DEEP] * 0.75, pleat * 0.8);
    c = mix(c, uPal[T_HAKAMA_DEEP] * 0.8, smoothstep(0.36, 0.3, r.y) * 0.4);
    float tie = band(r.y - 0.305, 0.0035) * d.x;
    c = mix(c, uPal[T_OBI_DEEP], tie * 0.9);
  } else if (m == 7) {
    // the obi: woven, faint lines along it, darker at its edges; its ends
    // stitched across where they're hemmed
    float n = tgNoise(r * vec3(60.0, 20.0, 60.0));
    c = mix(c, uPal[T_OBI_DEEP], smoothstep(0.5, 0.85, n) * 0.35);
    float edge = smoothstep(0.78, 0.95, abs(d.z)) * (1.0 - d.x);
    c = mix(c, uPal[T_OBI_DEEP], edge * 0.7);
    c = mix(c, uPal[T_OBI_DEEP], lines(d.z * 3.0, 0.06) * (1.0 - d.x) * 0.35);
    c = mix(c, uPal[T_OBI_DEEP] * 0.8, d.x * smoothstep(0.38, 0.41, d.y) * 0.6);
  } else if (m == 8) {
    // the wraps: wound round in overlapping turns (d: x down the arm, y
    // round it), the edge of each turn dark, the fur showing through here
    // and there between them
    float v = d.x * 70.0 + d.y / 6.2832;
    float k = fract(v);
    c = mix(c, uPal[T_OBI_DEEP], smoothstep(0.75, 0.98, k) * 0.7);
    c = mix(c, c * 1.18, smoothstep(0.1, 0.4, k) * (1.0 - smoothstep(0.4, 0.7, k)) * 0.5);
    float gap = step(0.62, tgNoise(vec3(floor(v) * 3.1, d.y * 1.6, 0.0))) * band(k - 0.92, 0.05);
    vec3 fur = mix(uPal[5], uPal[T_STRIPE], step(0.55, tgNoise(r * 80.0)));
    c = mix(c, fur, gap);
  } else if (m == 13) {
    // the scabbard: black lacquer, a long soft sheen along it
    float sheen = smoothstep(0.35, 0.95, tgNoise(vec3(d.y * 6.0, d.x * 40.0, 0.0))) * 0.25;
    c = mix(c, c * 2.6 + 0.05, sheen);
  } else if (m == 14) {
    // gold: the guard, the collars and caps
    c = mix(c, c * 1.3 + 0.06, smoothstep(0.4, 0.8, tgNoise(r * 260.0)) * 0.4);
  } else if (m == 15) {
    // the hilt: dark braid wound over it in a lattice, the pale ray-skin
    // showing through in little diamonds down each face
    float u = d.y / 0.0205;
    float a = atan(d.x, d.z) / 3.1416 * 2.0;
    float d1 = abs(fract(u + a) - 0.5), d2 = abs(fract(u - a) - 0.5);
    float win = fill(0.3 - min(d1, d2)) * step(abs(d.x), 0.011);
    vec3 same = mix(uPal[T_SAME], uPal[T_SAME] * 0.85, tgNoise(r * 700.0));
    c = mix(c, same, win * 0.9);
    c = mix(c, c * 1.6, band(min(d1, d2) - 0.06, 0.02) * 0.4);
  } else if (m == 16) {
    // the blade: polished steel, dark and mirror-bright along its flat; the
    // hardened edge frosted white behind a wavy temper line; the ridge line
    float t = clamp((d.y - 0.05) / 0.72, 0.0, 1.0);
    float c0 = -0.022 * t * t;
    float zr = d.z - c0;
    float hamon = 0.0035 + 0.0022 * sin(d.y * 120.0) + 0.001 * sin(d.y * 310.0 + 1.0);
    float frost = smoothstep(-0.001, 0.001, zr - (0.0155 * (1.0 - 0.22 * t) - 0.0085 - hamon));
    c = mix(uPal[16] * 0.62, uPal[T_STEEL_LIGHT], frost * 0.85);
    float ridge = band(zr + 0.0155 * (1.0 - 0.22 * t) * 0.36, 0.0005);
    c = mix(c, uPal[T_STEEL_LIGHT], ridge * 0.6);
    unlit = max(unlit, 0.55);
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
  #if defined(FOX)
    #ifdef SHELL
      // the fur's strands: each a cell of the surface stretched along the
      // lie of the fur, standing to its own height; the layers thin out
      // toward the tips
      vec3 sc = foxStretch(vRest, step(0.0, vD.z));
      vec3 fq = vRest * sc * 260.0;
      float tall = foxNoise(fq) * 0.65 + foxNoise(vRest * sc * 90.0 + 5.1) * 0.35;
      // strands under a couple of pixels across would shimmer as she moves:
      // there the fur thins to a soft solid fringe instead (the inner
      // layers whole, the outer ones gone)
      float lod = smoothstep(0.35, 1.1, length(fwidth(fq)));
      tall = mix(tall, 1.0 - 0.9 * vShell, lod);
      // each strand's edge antialiased (through the multisampling, as
      // coverage)
      float thr = 0.3 + vShell * 0.5;
      float aa = max(fwidth(tall), 1e-3);
      float cover = smoothstep(thr - aa, thr + aa, tall);
      if (cover < 0.5 || m == 5) discard;
    #endif
    // (a fox is a flame in the dark: its coat keeps its colour through a
    // drain, as the cape does)
    gKeep = 1.0;
  #elif defined(DRAGON)
    #ifdef SHELL
      // her mane's fur: strands drawn out along it (back toward her tail,
      // and up), the layers thinning toward the tips; where a strand would
      // be under a couple of pixels, a soft solid fringe instead
      vec3 fq = vRest * vec3(300.0, 150.0, 60.0);
      float tall = drNoise(fq) * 0.65 + drNoise(vRest * vec3(110.0, 55.0, 22.0) + 5.1) * 0.35;
      float lod = smoothstep(0.35, 1.1, length(fwidth(fq)));
      tall = mix(tall, 1.0 - 0.9 * vShell, lod);
      float thr = 0.3 + vShell * 0.5;
      float aa = max(fwidth(tall), 1e-3);
      if (smoothstep(thr - aa, thr + aa, tall) < 0.5) discard;
    #endif
    #ifndef SHELL
      // her feathers' and frills' edges fray into barbs
      if (drFray(m, vD) > 0.0) discard;
    #endif
    // (a dragon keeps her colours in the dark, as the fox does)
    gKeep = 1.0;
    {
      // how far she's turned from you here: her scales' colours slide with it
      vec3 nn = normalize(vNormal);
      nn = gl_FrontFacing ? nn : -nn;
      gFres = 1.0 - abs(dot(nn, normalize(vWorld - uCamPos)));
    }
  #elif defined(EXPLORER) && !defined(ITEMS)
    #ifdef CAPE
      // (the long hair's ends part into locks; a dark edge where they do)
      float cut = hairCut(vD);
      if (cut > 0.0) discard;
    #endif
    // (her hair burns on through a drain, as his cape does)
    gKeep = (m == 2 || m == 10) ? 1.0 : 0.0;
  #elif defined(ELDER)
    #ifdef CAPE
      // (the beard parts into locks, the skirt's hem is ragged)
      float cut = elderCut(m, vD);
      if (cut > 0.0) discard;
    #endif
    // (his robe and his orange spectacles keep their colour through a drain)
    gKeep = (m == 3 || m == 4 || m == 9 || m == 10 || m == 12 || m == 14) ? 1.0 : 0.0;
  #elif defined(BUNNY) && defined(PROPS)
    // (what he floats down on keeps its colour through a drain)
    gKeep = 1.0;
  #elif defined(BUNNY)
    // (his yellow hat and his rust trousers keep their colour through a drain)
    gKeep = (m == 4 || m == 10) ? 1.0 : 0.0;
  #elif defined(SKATER)
    // (her neon tee burns on through a drain, and her board's graphic)
    gKeep = (m == 3 || (m == 10 && vD.z < -0.5)) ? 1.0 : 0.0;
  #elif defined(SAMURAI)
    // (his red obi and wraps burn on through a drain - and his eyes: see
    // tgFace)
    gKeep = (m == 7 || m == 8) ? 1.0 : 0.0;
  #elif defined(PITCHER)
    // (his coral rim, his leaf and the eyes in the dark keep their colour
    // through a drain)
    gKeep = (m == 2 || m == 3 || m == 4) ? 1.0 : 0.0;
  #else
    gKeep = (m == 9 || m == 10) ? 1.0 : 0.0;
  #endif
  vec3 base = charDetail(m, uPal[m], vRest, vD, unlit);
  #if defined(EXPLORER) && defined(CAPE)
    base = mix(base, uPal[m] * 0.32, smoothstep(-0.016, -0.003, cut) * 0.85);
  #elif defined(ELDER) && defined(CAPE)
    base = mix(base, uPal[m == 14 ? 4 : m] * (m == 13 ? 0.6 : 0.4), smoothstep(-0.014, -0.002, cut) * 0.7);
  #endif
  vec3 n = normalize(vNormal);
  n = gl_FrontFacing ? n : -n;
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  vec3 V = v / dist;
  // one broad, crisp shadow shape (softer on the cape, so its folds shade in
  // soft gradients like the cloth they are)
  #if defined(FOX)
    // fur takes the light softly
    float soft = 0.13;
  #elif defined(DRAGON)
    // (scales a little crisper than fur; feathers soft)
    float soft = (m == 2 || m == 7 || m == 9) ? 0.12 : 0.075;
  #elif defined(EXPLORER)
    float soft = m == 10 ? 0.12 : m == 2 ? 0.07 : m == 3 ? 0.06 : 0.045;
  #elif defined(ELDER)
    float soft = (m == 10 || m == 14) ? 0.15 : m == 13 ? 0.13 : m == 2 ? 0.08 : (m == 3 || m == 4 || m == 9) ? 0.09 : 0.05;
  #elif defined(BUNNY) && defined(PROPS)
    float soft = 0.1;
  #elif defined(SAMURAI)
    // (fur takes the light softly; heavy cotton in soft gradients; steel,
    // lacquer and gold crisp)
    float soft = (m == 1 || m == 3 || m == 5 || m == 9 || m == 10 || m == 11) ? 0.11 : (m == 4 || m == 6) ? 0.09 : (m >= 13 && m <= 16) ? 0.035 : 0.06;
  #elif defined(SKATER)
    // (loose cotton in soft gradients; the board and the gold crisp)
    float soft = m == 3 ? 0.1 : m == 13 ? 0.08 : m == 4 ? 0.07 : m == 1 ? 0.12 : (m >= 9 && m <= 12) ? 0.035 : 0.065;
  #elif defined(PITCHER)
    // (a waxy, rounded pitcher in soft gradients; the leaves a little softer)
    float soft = (m == 4) ? 0.12 : (m == 6) ? 0.06 : 0.085;
  #elif defined(BUNNY)
    // (fur takes the light softly; the billowy trousers in soft gradients)
    float soft = (m == 1 || m == 2 || m == 6 || m == 8 || m == 11) ? 0.1 : m == 4 ? 0.11 : (m == 12 || m == 14) ? 0.04 : 0.07;
  #else
    float soft = m == 10 ? 0.16 : m == 9 ? 0.09 : 0.045;
  #endif
  float lit = smoothstep(-soft, soft, dot(n, uLightDir) + 0.15);
  vec3 sh = mix(vec3(0.84, 0.75, 0.8), uShadowTint, 0.35);
  vec3 col = base * mix(sh, vec3(1.0), max(lit, unlit));
  #if defined(ELDER)
  if (m == 10 || m == 13 || m == 14) {
  #else
  if (m == 10) {
  #endif
    // the cape's folds and waves keep a soft shadow in their valleys, under
    // any light (as a painter would shade them)
    float fold = smoothstep(0.8, 4.0, vFx.x) - 0.25 * smoothstep(1.0, 5.0, -vFx.x);
    col *= mix(vec3(1.0), mix(sh, vec3(1.0), 0.3), clamp(fold, -0.3, 1.0) * 0.7);
  }
  #if defined(FOX)
  if (m <= 4) {
    // sunlit fur: a warm lighter tone where it faces the light, broken up
    // along the strokes
    float hl = smoothstep(0.45, 0.62, dot(n, uLightDir) + (foxNoise(vRest * foxStretch(vRest, step(0.0, vD.z)) * 90.0) - 0.5) * 0.35);
    col = mix(col, min(base * uPal[30] * 1.22, vec3(1.0)), hl * 0.5 * (1.0 - smoothstep(0.6, 0.85, base.g)));
  }
  #ifdef SHELL
    // the roots of the fur lie in their own shade, the tips catch the light
    col *= mix(0.9, 1.04, vShell);
  #endif
  #elif defined(DRAGON)
  {
    // her scales shine where the light glances off them, tinted by their
    // own colour, brightest toward their free edges
    vec3 hv = normalize(uLightDir - V);
    float spec = pow(max(dot(n, hv), 0.0), 16.0);
    col += mix(uPal[30], base, 0.5) * min(spec * gShine * 0.32, 0.2) * lit;
    // her feathers, frills and mane: a lighter tone facing the light
    if (m == 2 || m == 7 || m == 9) col = mix(col, min(base * 1.3 + 0.05, vec3(1.0)), smoothstep(0.45, 0.7, dot(n, uLightDir)) * 0.35);
    #ifdef SHELL
      col *= mix(0.88, 1.06, vShell);
    #endif
  }
  if (m == 99) {
  #elif defined(EXPLORER)
  if (m == 2 || m == 10) {
  #elif defined(ELDER)
  if (m == 2 || m == 13) {
  #elif defined(BUNNY)
  if (m == 10) {
  #elif defined(SKATER)
  if (m == 2 || m == 13) {
  #elif defined(SAMURAI)
  if (m == 99) {
  #elif defined(PITCHER)
  // (a waxy sheen on his pitcher and his leaves where they face the light)
  if (m == 1 || m == 4 || m == 2) {
  #else
  if (m == 2) {
  #endif
  #if !defined(FOX)
    // one restrained lighter tone where the curls face the light from above
    float hl = smoothstep(0.58, 0.64, dot(n, uLightDir)) * smoothstep(0.25, 0.5, n.y);
    col = mix(col, uPal[30], hl * 0.8);
  }
  #endif
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
  #if defined(FOX)
    gKeep = 1.0;
  #elif defined(DRAGON)
    if (drFray(m, vD) > 0.0) discard;
    gKeep = 1.0;
  #elif defined(EXPLORER) && !defined(ITEMS)
    #ifdef CAPE
      if (hairCut(vD) > 0.0) discard;
    #endif
    gKeep = (m == 2 || m == 10) ? 1.0 : 0.0;
  #elif defined(ELDER)
    #ifdef CAPE
      if (elderCut(m, vD) > 0.0) discard;
    #endif
    gKeep = (m == 3 || m == 4 || m == 9 || m == 10 || m == 12 || m == 14) ? 1.0 : 0.0;
  #elif defined(BUNNY) && defined(PROPS)
    gKeep = 1.0;
  #elif defined(BUNNY)
    gKeep = (m == 4 || m == 10) ? 1.0 : 0.0;
  #elif defined(SKATER)
    gKeep = m == 3 ? 1.0 : 0.0;
  #elif defined(SAMURAI)
    gKeep = (m == 7 || m == 8) ? 1.0 : 0.0;
  #elif defined(PITCHER)
    gKeep = (m == 2 || m == 3 || m == 4) ? 1.0 : 0.0;
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
#ifdef FIREFLY
// A firefly (glow option firefly): x how far it wanders round its spot (m),
// y how fast, z flashes a second (about), w how much it glows between them.
// Each its own path and its own beat (its phase); a core and its halo put
// with the same phase wander and flash as one.
uniform vec4 uFirefly;
#endif
attribute vec4 aInst;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec3 pivot = M[3].xyz;
  #ifdef FIREFLY
    float fh = fract(aInst.x * 0.1591549);
    float ft = uTime * uFirefly.y * (0.7 + 0.6 * fract(fh * 7.31));
    pivot += vec3(
      sin(ft * 1.3 + fh * 31.0) + 0.5 * sin(ft * 2.9 + fh * 17.0),
      0.55 * sin(ft * 1.7 + fh * 13.0) + 0.25 * sin(ft * 4.1 + fh * 5.0),
      cos(ft * 1.1 + fh * 23.0) + 0.4 * sin(ft * 2.3 + fh * 11.0)
    ) * uFirefly.x;
  #endif
  float sc = length(M[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float aP = uCamPos.z - pivot.z;
  float pop = 1.0 - smoothstep(uAnim.y, uAnim.z, aP);
  vec3 bp = bendPos(pivot);
  vec3 wp = bp + (right * position.x + up * position.y) * sc;
  float dist = length(bp - uCamPos);
  float flick = 0.88 + 0.12 * sin(uTime * 6.0 + aInst.x * 13.0) * sin(uTime * 2.3 + aInst.x);
  #ifdef FIREFLY
    // a slow swell into a flash and a quick fade, then dark a while
    float bt = fract(uTime * uFirefly.z * (0.6 + 0.8 * fract(fh * 3.7)) + fh * 9.0);
    flick = uFirefly.w + (1.0 - uFirefly.w) * smoothstep(0.0, 0.1, bt) * (1.0 - smoothstep(0.14, 0.42, bt));
  #endif
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

// --- A figure's own shadow (render/caster.js) --------------------------------
// The runner's (or the companion's) silhouette, rendered flat along the
// world's light into uCastMap, laid on the ground: softened by a few taps
// (more the softer the light and the higher they are off the ground), with
// a little contact shade round the feet, multiplied over whatever it falls on
// in the world's own shadow colour.
const VS_CAST = COMMON + /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 wp = bendPos((modelMatrix * vec4(position, 1.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FS_CAST = /* glsl */ `
uniform sampler2D uCastMap;
uniform vec3 uShadowColor;
uniform vec4 uCastK; // xy the blur (uv), z how dark, w the contact shade
uniform vec4 uFoot; // xy the feet (uv), zw 1 / the contact shade's radius (uv)
varying vec2 vUv;
float cov(vec2 o) {
  return texture2D(uCastMap, vUv + o).a;
}
void main() {
  vec2 r = uCastK.xy;
  vec2 q = r * 0.7071;
  float a = cov(vec2(0.0)) * 0.2;
  a += (cov(vec2(r.x, 0.0)) + cov(vec2(-r.x, 0.0)) + cov(vec2(0.0, r.y)) + cov(vec2(0.0, -r.y))) * 0.12;
  a += (cov(q) + cov(-q) + cov(vec2(q.x, -q.y)) + cov(vec2(-q.x, q.y))) * 0.08;
  a *= uCastK.z;
  vec2 f = (vUv - uFoot.xy) * uFoot.zw;
  float ao = (1.0 - smoothstep(0.0, 1.0, dot(f, f))) * uCastK.w;
  a += ao * (1.0 - a);
  // (never a hard edge where the frame it was drawn in ends)
  vec2 e = abs(vUv - 0.5) * 2.0;
  a *= 1.0 - smoothstep(0.92, 1.0, max(e.x, e.y));
  gl_FragColor = vec4(mix(vec3(1.0), uShadowColor, clamp(a, 0.0, 1.0)), 1.0);
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
// deep space (env.space): x nebula ribbons, y galaxies, z the starfield, w comets
uniform vec4 uSkyFx3;
// x a winged sun (skyFx.wings), y its span in sun radii, z a range of
// mountains along the horizon (skyFx.range: how high they stand)
uniform vec4 uSkyFx4;
uniform vec3 uNeb0;
uniform vec3 uNeb1;
uniform vec3 uNeb2;
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
// Deep space (env.space, the Red Drift): the whole sky, all round and below
// the horizon where the little world falls away, crowded with stars - three
// layers of them, white, ice blue, gold and rose, the brightest throwing
// four-pointed sparkles - a milky way of fainter ones in a dusty band; across
// it, a nebula in flowing ribbons of flat colour like cut paper, stippled,
// pink into orange into blue, wisps of glow round them; two spiral galaxies
// turning slowly, pink arms streaked with gold round a white-hot core; and,
// on later laps, comets.
float triN(vec3 p, vec3 w) {
  return texture2D(uNoise, p.yz).g * w.x + texture2D(uNoise, p.xz).g * w.y + texture2D(uNoise, p.xy).g * w.z;
}
vec3 starCol(float h) {
  return h < 0.5 ? vec3(1.0, 0.97, 0.92) : h < 0.7 ? vec3(0.72, 0.86, 1.0) : h < 0.86 ? vec3(1.0, 0.86, 0.6) : vec3(1.0, 0.7, 0.8);
}
vec3 galaxy(vec3 d, vec3 g, float size, float tilt, float spin, vec3 armC, vec3 dustC) {
  float facing = dot(d, g);
  if (facing < 0.9) return vec3(0.0);
  vec3 e1 = normalize(cross(g, vec3(0.0, 1.0, 0.0)));
  vec3 e2 = cross(e1, g);
  vec2 p = vec2(dot(d, e1), dot(d, e2)) / size;
  float ct = cos(tilt), st = sin(tilt);
  p = vec2(p.x * ct - p.y * st, (p.x * st + p.y * ct) / 0.42);
  float r = length(p);
  if (r > 1.6) return vec3(0.0);
  float a = atan(p.y, p.x);
  float arms = sin(2.0 * a - log(r + 0.02) * 4.2 - uTime * spin);
  float arm = pow(0.5 + 0.5 * arms, 3.0);
  float lane = texture2D(uNoise, vec2(a * 0.32 + r * 0.6, r * 0.8 - uTime * spin * 0.05)).g;
  float fall = exp(-r * 2.4);
  vec3 c = armC * arm * fall * (0.55 + 0.6 * lane) * 1.4;
  c += mix(dustC, vec3(1.0, 0.9, 0.6), 0.5) * smoothstep(0.62, 0.8, lane) * arm * fall * 0.9;
  c += vec3(1.0, 0.95, 0.82) * (exp(-r * 13.0) * 1.4 + exp(-r * 5.0) * 0.35);
  return c * smoothstep(1.6, 0.9, r);
}
vec3 spaceSky(vec3 c, vec3 d) {
  vec3 w = abs(d);
  w = w * w * w;
  w /= w.x + w.y + w.z;
  // the milky way: a dusty band across the sky, thick with faint stars
  vec3 mwAx = normalize(vec3(0.42, 0.52, -0.74));
  float mwD = dot(d, mwAx);
  float mwN = triN(d * 1.6 + 0.21, w);
  float mw = exp(-pow(mwD / (0.2 + 0.08 * mwN), 2.0)) * uSkyFx3.z;
  c += mix(uNeb2, vec3(0.85, 0.8, 1.0), 0.55) * mw * (0.05 + 0.08 * smoothstep(0.35, 0.75, mwN));
  // the nebula: ribbons of flat colour flowing across the sky
  if (uSkyFx3.x > 0.0) {
    vec3 ax = normalize(vec3(-0.55, 0.62, 0.55));
    float n1 = triN(d * 0.55 + vec3(uTime * 0.0015, 0.0, 0.0), w);
    float n2 = triN(d * 1.3 + 0.37, w);
    float n3 = triN(d * 3.4 + 0.71, w);
    float f = dot(d, ax) * 3.2 + (n1 - 0.5) * 2.6 + (n2 - 0.5) * 0.8;
    float e = fwidth(f) * 1.2 + 0.015;
    float belt = 1.0 - smoothstep(1.0, 1.6, abs(f + 0.1));
    // three ribbons and a dark lane between, each edge wavering on its own
    float b0 = smoothstep(-1.15 - e, -1.15 + e, f + (n3 - 0.5) * 0.25);
    float b1 = smoothstep(-0.5 - e, -0.5 + e, f + (n2 - 0.5) * 0.35);
    float b2 = smoothstep(0.15 - e, 0.15 + e, f - (n3 - 0.5) * 0.3);
    float b3 = smoothstep(0.75 - e, 0.75 + e, f + (n1 - 0.5) * 0.3);
    vec3 rib = mix(uNeb2 * 0.75, uNeb0, b0);
    rib = mix(rib, uNeb1, b1 * (1.0 - b2));
    rib = mix(rib, mix(uNeb0, uNeb2, 0.5), b2);
    rib = mix(rib, uNeb2, b3);
    float on = belt * smoothstep(-1.4, -1.15, f) * (1.0 - smoothstep(1.2, 1.5, f));
    // stippled, like a print
    float sp = hash13(floor(d * 700.0));
    rib *= 0.9 + 0.22 * step(0.82, sp) - 0.1 * step(sp, 0.12);
    rib *= 0.82 + 0.3 * n3;
    c = mix(c, rib, on * 0.62 * uSkyFx3.x);
    // and wisps of glow drifting round them
    float wisp = smoothstep(0.5, 0.85, n1 * 0.55 + n2 * 0.35 + n3 * 0.2);
    c += mix(uNeb0, uNeb2, n2) * wisp * 0.22 * uSkyFx3.x * (1.0 - on * 0.5);
  }
  // galaxies
  if (uSkyFx3.y > 0.0) {
    c += galaxy(d, normalize(vec3(-0.62, 0.22, -0.75)), 0.085, 0.5, 0.02, vec3(1.0, 0.45, 0.78), vec3(1.0, 0.75, 0.3)) * uSkyFx3.y;
    c += galaxy(d, normalize(vec3(0.7, 0.32, -0.64)), 0.05, -0.9, -0.03, vec3(0.6, 0.55, 1.0), vec3(0.45, 0.9, 1.0)) * uSkyFx3.y * 0.85;
  }
  // stars, three layers deep (more of them in the milky way)
  if (uSkyFx3.z > 0.0) {
    vec3 e1 = normalize(cross(d, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 e2 = cross(e1, d);
    for (int L = 0; L < 3; L++) {
      float sc = L == 0 ? 70.0 : L == 1 ? 160.0 : 340.0;
      vec3 p = d * sc;
      vec3 cell = floor(p);
      float h = hash13(cell + float(L) * 17.3);
      float th = (L == 0 ? 0.955 : L == 1 ? 0.93 : 0.9) - mw * 0.12 * float(L);
      if (h < th) continue;
      vec3 jit = vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5;
      vec3 f = fract(p) - 0.5 - jit * 0.6;
      vec2 fq = vec2(dot(f, e1), dot(f, e2));
      float px = length(fwidth(p)) * 0.6;
      float sz = L == 0 ? 0.11 : 0.085;
      float rad = max(sz, px);
      float s = (1.0 - smoothstep(0.0, rad, length(fq))) * (sz / rad);
      float hk = fract(h * 13.7);
      float tw = 0.65 + 0.35 * sin(uTime * (1.1 + hk * 4.0) + hk * 60.0);
      float b = (L == 0 ? 1.5 : L == 1 ? 1.0 : 0.65) * (0.5 + hk);
      vec3 col = starCol(fract(h * 7.31));
      c += col * s * tw * b * uSkyFx3.z;
      if (L == 0 && h > 0.988) {
        // the brightest throw four-pointed sparkles
        float k = 0.03 + px;
        float spk = exp(-abs(fq.x) / k) * exp(-abs(fq.y) * 7.0) + exp(-abs(fq.y) / k) * exp(-abs(fq.x) * 7.0);
        c += col * spk * 0.8 * tw * uSkyFx3.z;
      }
    }
  }
  // comets: a few, each crossing the sky over a minute or so, its tail
  // streaming away from the sun
  if (uSkyFx3.w > 0.0) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float T = 70.0 + 25.0 * fi;
      float u = fract(uTime / T + fi * 0.37);
      float az = mix(-0.9, 0.9, u) * (i == 1 ? -1.0 : 1.0) + fi * 0.6;
      float el = 0.12 + 0.12 * fi + 0.06 * sin(u * 3.0 + fi);
      vec3 hd = normalize(vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el)));
      // (the tail: along the sky, straight away from the sun)
      vec3 tl = normalize(-uSunDir + hd * dot(hd, uSunDir) + vec3(1e-4, 2e-4, 0.0));
      vec3 q = d - hd;
      float along = dot(q, tl);
      float across = length(q - tl * along);
      float headG = exp(-dot(q, q) / 0.00002);
      float tailG = step(0.0, along) * exp(-along / 0.09) * exp(-pow(across / (0.0025 + along * 0.12), 2.0));
      c += (vec3(1.0, 0.98, 0.92) * headG * 1.5 + mix(vec3(0.6, 0.85, 1.0), vec3(0.95, 0.9, 1.0), exp(-along * 20.0)) * tailG * 0.55) * uSkyFx3.w * smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.92, 1.0, u));
    }
  }
  return c;
}
// The winged sun (skyFx.wings, the Sky Road): Ra's disc hung over the end
// of the road with great feathered wings spread either side of it, as over
// every temple door - a row of little covert feathers in lapis and red, a
// band of green, then the long flight feathers hanging below, lapis and
// gold by turns, each one outlined - in flat painted colour.
vec3 wingedSun(vec3 c, vec3 d) {
  vec3 rt = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 upv = cross(rt, uSunDir);
  float R = sqrt(max(1.0 - uSkyFx.y * uSkyFx.y, 1e-6));
  vec2 q = vec2(dot(d, rt), dot(d, upv)) / R;
  float ax = abs(q.x);
  float span = uSkyFx4.y;
  if (ax < 1.05 || ax > span) return c;
  float t = (ax - 1.05) / (span - 1.05);
  // the wing's top edge rises off the disc and sweeps down to the tip; the
  // flight feathers hang below it, longest near the body
  float top = 0.55 + 0.35 * sin(t * 2.6) - 0.55 * t * t;
  float bandY = top - 0.32;
  float greenY = bandY - 0.22;
  float featherN = 9.0 + span * 3.0;
  float fi = floor(t * featherN);
  float ff = fract(t * featherN);
  float flen = (1.05 - 0.6 * t) * (0.85 + 0.15 * sin(fi * 2.3));
  float tip = greenY - flen + 0.12 * (1.0 - abs(ff - 0.5) * 2.0);
  float inWing = step(tip, q.y) * step(q.y, top);
  if (inWing <= 0.0) return c;
  float e = fwidth(q.y) * 1.5;
  vec3 lapis = vec3(0.16, 0.3, 0.72);
  vec3 gold = vec3(0.96, 0.76, 0.26);
  vec3 red = vec3(0.76, 0.24, 0.17);
  vec3 green = vec3(0.22, 0.56, 0.38);
  vec3 col;
  if (q.y > bandY) {
    // coverts: little rounded scales, lapis and red in rows
    float sx = t * featherN * 2.0;
    float sy = (q.y - bandY) / 0.16;
    float row = floor(sy);
    float cx = fract(sx + row * 0.5) - 0.5;
    float scale = 1.0 - smoothstep(0.38, 0.5, length(vec2(cx, fract(sy) - 0.3)));
    col = mix(mod(row, 2.0) < 1.0 ? lapis : red, gold, 1.0 - scale);
  } else if (q.y > greenY) {
    col = green;
    col = mix(col, gold, 1.0 - smoothstep(0.0, e + 0.02, abs(q.y - bandY + 0.02)));
  } else {
    // flight feathers, lapis and gold by turns, outlined
    col = mod(fi, 2.0) < 1.0 ? lapis : gold;
    float edge = 1.0 - smoothstep(0.0, fwidth(ff) * 1.5 + 0.04, min(ff, 1.0 - ff));
    col = mix(col, vec3(0.12, 0.08, 0.06), edge * 0.8);
  }
  // a dark outline round the whole wing
  float outline = 1.0 - smoothstep(0.0, e + 0.02, min(top - q.y, q.y - tip));
  col = mix(col, vec3(0.12, 0.08, 0.06), outline * 0.85);
  // lit warm by the sun behind it, a little hazed toward the tips
  col = mix(col * 1.05, c, 0.12 + 0.25 * t);
  return mix(c, col, inWing * uSkyFx4.x);
}
// Everything in the sky behind the sun: its gradient, the moon, stars, rays,
// clouds, smoke and lightning, aurora.
vec3 skyBack(vec3 d) {
  vec3 c = skyColor(d);
  if (uSkyFx3.x + uSkyFx3.y + uSkyFx3.z + uSkyFx3.w > 0.0) c = spaceSky(c, d);
  float sd = dot(d, uSunDir);
  if (uEclipse.x <= 0.0) {
    float sun = smoothstep(uSkyFx.y - 0.00012, uSkyFx.y + 0.00012, sd);
    c = mix(c, uSunDisc, sun);
  }
  if (uSkyFx4.x > 0.0 && sd > 0.7) c = wingedSun(c, d);
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
  if (uSkyFx4.z > 0.0 && d.y < uSkyFx4.z * 1.3) {
    // A range of jagged mountains along the horizon, far beyond everything
    // (skyFx.range, the Frostbound Pass: they stand at the end of the canyon
    // and through its arches, and never come any nearer): horns and saddles,
    // snow on all but their feet, each slope lit if it faces the sun's side
    // of the sky and in the sky's own blue shade if not, sinking into the
    // haze toward the horizon. In front of the sun and the clouds.
    float r1 = texture2D(uNoise, vec2(az * 0.31 + 0.2, 0.21)).g;
    float r2 = texture2D(uNoise, vec2(az * 1.27, 0.63)).g;
    // (a skyline of horns and saddles: big peaks, smaller ones on their
    // shoulders, and a jagged edge on all of them)
    float tx = az * 7.0 + r1 * 4.0;
    float fx = fract(tx);
    float horn = 1.0 - abs(fx * 2.0 - 1.0);
    float tx2 = az * 19.0 + r2 * 3.0;
    float horn2 = 1.0 - abs(fract(tx2) * 2.0 - 1.0);
    float jag = texture2D(uNoise, vec2(az * 9.0, 0.37)).g;
    float h = uSkyFx4.z * (0.12 + 0.3 * r1 + pow(horn, 1.6) * (0.35 + 0.4 * r2) + 0.16 * horn2 + 0.08 * jag);
    float e = fwidth(d.y) * 1.2;
    float m = 1.0 - smoothstep(h - e, h + e, d.y);
    if (m > 0.0) {
      // (carried on down below the horizon, so the ground always meets them)
      float up = max(d.y, 0.0) / max(h, 1e-3);
      float sunAz = atan(uSunDir.x, -uSunDir.z);
      float lit = smoothstep(-0.25, 0.25, (fx < 0.5 ? -1.0 : 1.0) * (sunAz - az));
      float line = texture2D(uNoise, vec2(az * 6.0, d.y * 9.0)).g;
      float snowy = smoothstep(0.26, 0.4, up + (line - 0.5) * 0.4);
      vec3 rock = mix(uSkyTop, vec3(0.4, 0.43, 0.76), 0.6) * mix(0.8, 1.05, lit);
      vec3 snow = mix(mix(uSkyTop, vec3(0.82, 0.86, 1.0), 0.65), mix(vec3(1.0), uSunColor, 0.3), lit);
      vec3 mc = mix(rock, snow, snowy);
      // (haze: thick at their feet, and a breath of it over the whole range)
      mc = mix(mc, c, 0.12 + 0.55 * (1.0 - smoothstep(0.0, 0.55, up)));
      c = mix(c, mc, m);
    }
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
// 1: they hang dead still where they are - no sway, no twinkle (snowflakes
// stopped in the air: env.particles.still)
uniform float uStill;
attribute float aRand;
varying float vAlpha;
void main() {
  vec3 p = position;
  p += uDrift * uTime * (0.6 + aRand * 0.8);
  p.x += sin(uTime * 0.7 + aRand * 30.0) * 0.6 * (1.0 - uStill);
  p.z += uDistMod;
  p.z = mod(p.z + 92.0, 98.0) - 92.0;
  p.y = mod(p.y, 13.0);
  p.x = mod(p.x + 15.0, 30.0) - 15.0;
  vec3 wp = vec3(uCamPos.x + p.x, p.y, uCamPos.z + p.z);
  wp = bendPos(wp);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_PointSize = uSize * (0.5 + aRand) * uPixelRatio * (40.0 / max(-mv.z, 1.0));
  vAlpha = smoothstep(-92.0, -60.0, p.z) * smoothstep(6.0, 1.0, p.z) * mix(0.55 + 0.45 * sin(uTime * (1.0 + aRand * 3.0) + aRand * 50.0), 0.85, uStill);
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
// 0 a mote of light, added onto what's behind it; 1 a snowflake, laid over
// it (env.particles.flake) - white, a faint cool rim round it, so it shows
// against snow as well as against the sky
uniform float uFlake;
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
  // (blended premultiplied: with no alpha that's the additive glow these
  // have always been - colour times alpha, squared, as it was - and with
  // alpha, a flake laid over the scene)
  vec3 flake = mix(uColor, vec3(0.66, 0.71, 0.9), smoothstep(0.12, 0.42, r) * 0.7);
  gl_FragColor = vec4(mix(uColor * a * a, flake * a, uFlake), a * uFlake);
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
attribute vec4 aDust; // x size (m), y opacity, z kind (0 a puff, 1 grit, 2 a drop of water, 3 spray, 4 vapour, 5 a crumb of soil, 6 a big clear drop), w seed
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
uniform float uDustPale;
varying vec4 vDust;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  // (drops of water are drawn like grit, spray like a puff)
  float soil = step(4.5, vDust.z) * (1.0 - step(5.5, vDust.z));
  float drop = step(5.5, vDust.z);
  float grit = max(max(step(0.5, vDust.z) * (1.0 - step(2.5, vDust.z)), soil), drop);
  float wet = step(1.5, vDust.z) * (1.0 - soil) * (1.0 - drop);
  float a = atan(c.y, c.x);
  // (the lumps stay inside the sprite, or its square would cut them off)
  float lump = (0.028 * sin(a * 5.0 + vDust.w * 6.3) + 0.016 * sin(a * 9.0 - vDust.w * 4.1)) * (1.0 - grit);
  float edge = smoothstep(mix(0.45, 0.5, grit) + lump, mix(0.36, 0.22, grit) + lump, r);
  float alpha = edge * vDust.y;
  if (alpha < 0.01) discard;
  // the road's own colour, paled with dust; lit from above, a shade beneath
  vec3 dust = mix(mix(uGroundA, uGroundB, 0.5), vec3(0.98, 0.95, 0.88), uDustPale);
  float lit = smoothstep(0.2, -0.25, c.y + 0.06 * sin(a * 3.0 + vDust.w));
  vec3 sh = mix(vec3(0.84, 0.75, 0.8), uShadowTint, 0.35);
  vec3 col = dust * mix(sh, vec3(1.0), 0.35 + 0.65 * lit);
  col = mix(col, dust * 0.42, grit * (1.0 - wet));
  // water: white, a glassy teal shade beneath
  col = mix(col, mix(vec3(0.62, 0.84, 0.86), vec3(1.0), 0.4 + 0.6 * lit), wet);
  // vapour (a thruster's plume): bright white, a cold lilac shade beneath
  float vap = step(3.5, vDust.z) * (1.0 - soil) * (1.0 - drop);
  // (taking a little of the ground's colour where the dust is red)
  vec3 vapC = mix(vec3(0.7, 0.72, 0.95), vec3(1.0, 0.99, 0.97), 0.35 + 0.65 * lit);
  vapC = mix(vapC, dust * (0.75 + 0.35 * lit), clamp((0.62 - uDustPale) * 0.45, 0.0, 0.3));
  col = mix(col, vapC, vap);
  // soil: a rich brown crumb, lit from above
  col = mix(col, mix(vec3(0.24, 0.15, 0.09), vec3(0.5, 0.34, 0.2), 0.3 + 0.7 * lit), soil);
  // a big drop: a little lens of water - a clear teal body, darker toward
  // its rim, a bright glint up top
  float glint = 1.0 - smoothstep(0.06, 0.13, length(c - vec2(-0.1, -0.12)));
  vec3 dropC = mix(vec3(0.16, 0.45, 0.55), vec3(0.55, 0.86, 0.9), smoothstep(0.48, 0.1, r) * (0.4 + 0.6 * lit));
  col = mix(col, mix(dropC, vec3(1.0), glint), drop);
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  col = atmos(col, v, dist, 0.0);
  gl_FragColor = vec4(grade(col, uTrip), alpha);
}
`;

// ---------------------------------------------------------------------------
// Ribbons of water whipping off the samurai (game/ribbon.js): trails of
// points written by the CPU, each stretch turned to face you and widened
// to its width there; drawn as a water bender's water - a bright, glassy
// white heart, a cool teal toward its edges, streaks running down it as it
// flows, thinning and breaking up toward its tail. Lit, fogged and graded
// with the world.
// ---------------------------------------------------------------------------
const VS_RIBBON = COMMON + /* glsl */ `
attribute vec3 aTan;
attribute vec4 aRib; // x side (-1 / +1), y how far down it (+ its seed), z how much of it is left, w half its width (m)
varying vec4 vRib;
varying vec3 vWorld;
varying vec3 vPos;
void main() {
  vec3 view = normalize(position - uCamPos);
  vec3 side = cross(aTan, view);
  float l = length(side);
  side = l > 1e-4 ? side / l : vec3(0.0, 1.0, 0.0);
  vec3 wp = position + side * aRib.x * aRib.w;
  wp = bendPos(wp);
  vPos = wp;
  vWorld = wp;
  vRib = aRib;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FS_RIBBON = FS_HEAD + /* glsl */ `
uniform vec3 uShadowTint;
varying vec4 vRib;
void main() {
  float e = abs(vRib.x);
  float u = fract(vRib.y);
  float left = vRib.z;
  if (left <= 0.0) discard;
  // streaks running down it as it flows, breaking it up toward its tail
  float flow = sin(vRib.y * 46.0 - uTime * 26.0 + vRib.x * 2.2) * 0.5 + 0.5;
  float flow2 = sin(vRib.y * 97.0 - uTime * 41.0 - vRib.x * 3.1) * 0.5 + 0.5;
  float body = smoothstep(1.0, 0.6 - 0.2 * flow, e);
  float tail = smoothstep(0.0, 0.25, left);
  float alpha = body * tail * (0.78 + 0.22 * flow) * mix(1.0, step(0.35, flow2), smoothstep(0.4, 0.85, u));
  if (alpha < 0.02) discard;
  // a white heart, a cool teal only at its very edges, brighter streaks
  // running through it
  vec3 teal = vec3(0.45, 0.8, 0.88);
  vec3 col = mix(vec3(0.98, 1.0, 1.0), teal, smoothstep(0.45, 1.0, e) * 0.8);
  col = mix(col, vec3(0.86, 0.95, 0.98), (1.0 - flow) * 0.35 * (1.0 - e));
  vec3 v = vWorld - uCamPos;
  float dist = length(v);
  col = atmos(col, v, dist, 0.0);
  gl_FragColor = vec4(grade(col, uTrip), alpha * 0.9);
}
`;

// ---------------------------------------------------------------------------
// Sparks off the elder's walking stick (game/sparks.js): each a twinkling
// four-pointed glint, a white-hot heart in its gem's colour, turning as it
// flies; drawn additively (it lights what's behind it) and keeping its colour
// through a drain, as magic should.
// ---------------------------------------------------------------------------
const VS_SPARK = COMMON + /* glsl */ `
uniform vec2 uResolution;
attribute vec3 aSpark; // x size (m), y brightness, z seed
attribute vec3 aCol;
varying vec3 vSpark;
varying vec3 vCol;
varying vec3 vWorld;
varying vec3 vPos;
void main() {
  vec3 wp = bendPos(position);
  vPos = wp;
  vWorld = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float px = aSpark.x * projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.5);
  gl_PointSize = clamp(px, 2.0, 96.0);
  vSpark = aSpark;
  vCol = aCol;
  gl_Position = projectionMatrix * mv;
}
`;
const FS_SPARK = FS_HEAD + /* glsl */ `
varying vec3 vSpark;
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = vSpark.z * 6.2832 + uTime * (2.0 + 3.0 * vSpark.z);
  vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * c;
  float r2 = dot(c, c);
  float core = exp(-r2 / 0.004);
  float halo = exp(-r2 / 0.03) * 0.35;
  float rays = exp(-abs(q.x) * 46.0) * exp(-abs(q.y) * 6.5) + exp(-abs(q.y) * 46.0) * exp(-abs(q.x) * 6.5);
  float tw = 0.7 + 0.3 * sin(uTime * 31.0 + vSpark.z * 50.0);
  float k = (core + halo + rays * 0.8) * vSpark.y * tw;
  if (k < 0.01) discard;
  // (white only at the very heart: the rays and the halo are its colour)
  vec3 col = mix(vCol * 1.15, vec3(1.0), clamp(core * core * 0.7, 0.0, 1.0));
  gKeep = 1.0;
  gl_FragColor = vec4(grade(col, uTrip), min(k, 1.0));
}
`;

// ---------------------------------------------------------------------------
// Dandelion seeds off the bunny's giant clock (game/seeds.js): each a tuft of
// fine white hairs fanning up from the top of a stalk, the seed itself a
// little brown spindle at its foot, turning as it drifts. Fogged and graded
// like the world.
// ---------------------------------------------------------------------------
const VS_SEED = COMMON + /* glsl */ `
uniform vec2 uResolution;
attribute vec4 aSeed; // x size (m), y opacity, z turn (rad), w seed
varying vec4 vSeed;
varying vec3 vWorld;
varying vec3 vPos;
void main() {
  vec3 wp = bendPos(position);
  vPos = wp;
  vWorld = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float px = aSeed.x * projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.5);
  gl_PointSize = clamp(px, 2.0, 160.0);
  vSeed = aSeed;
  // (none drifting right across the lens)
  vSeed.y *= smoothstep(0.8, 2.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const FS_SEED = FS_HEAD + /* glsl */ `
varying vec4 vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  c.y = -c.y;
  float a = vSeed.z;
  vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * c;
  // the tuft: fine hairs fanning up from the top of the stalk
  vec2 t = q - vec2(0.0, 0.04);
  float r = length(t);
  float ang = atan(t.x, t.y);
  float fan = step(abs(ang), 1.45) * smoothstep(0.47, 0.36, r) * smoothstep(0.015, 0.05, r);
  float ray = abs(fract(ang * 4.2 + vSeed.w) - 0.5) * 2.0;
  float hairs = smoothstep(0.72 + 0.2 * r, 1.0, ray) * fan;
  float haze = fan * 0.22 * (1.0 - r / 0.47);
  // the stalk and the seed at its foot
  float stalk = (1.0 - smoothstep(0.006, 0.014, abs(q.x))) * step(-0.26, q.y) * step(q.y, 0.05);
  float seed = 1.0 - smoothstep(0.85, 1.0, length((q - vec2(0.0, -0.3)) / vec2(0.028, 0.07)));
  float alpha = max(max(hairs * 0.95, haze), max(stalk * 0.85, seed)) * vSeed.y;
  if (alpha < 0.02) discard;
  vec3 col = mix(vec3(0.97, 0.96, 0.92), vec3(0.88, 0.85, 0.78), stalk);
  col = mix(col, vec3(0.45, 0.33, 0.2), seed);
  vec3 v = vWorld - uCamPos;
  col = atmos(col, v, length(v), 0.0);
  gl_FragColor = vec4(grade(col, uTrip), min(alpha, 1.0));
}
`;

// ---------------------------------------------------------------------------
// The bunny's whiskers: thin ribbons through points on the head, turned to
// face you and widened in screen space so that they are never under about a
// pixel across - fainter instead, so they don't shimmer away when he's far.
// ---------------------------------------------------------------------------
const VS_WHISKER = COMMON + /* glsl */ `
uniform vec2 uResolution;
attribute vec4 aW; // xyz the way the whisker runs here (model space); w side (-1 / +1) x half its width (m)
varying vec3 vWorld;
varying vec3 vPos;
varying float vA;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 wt = normalize(mat3(modelMatrix) * aW.xyz);
  vec3 a = bendPos(wp);
  vec3 b = bendPos(wp + wt * 0.01);
  vPos = a;
  vWorld = a;
  vec4 ca = projectionMatrix * viewMatrix * vec4(a, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(b, 1.0);
  vec2 half_ = uResolution * 0.5;
  vec2 sa = ca.xy / ca.w * half_;
  vec2 sb = cb.xy / cb.w * half_;
  vec2 dir = sb - sa;
  dir = dot(dir, dir) > 1e-8 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float ppm = projectionMatrix[1][1] * half_.y / max(ca.w, 0.05);
  float hw = abs(aW.w) * ppm;
  vA = clamp(hw / 0.55, 0.3, 1.0);
  hw = max(hw, 0.55);
  ca.xy += nrm * sign(aW.w) * hw / half_ * ca.w;
  gl_Position = ca;
}
`;
const FS_WHISKER = FS_HEAD + /* glsl */ `
uniform vec3 uInk;
varying float vA;
void main() {
  vec3 v = vWorld - uCamPos;
  vec3 col = atmos(uInk, v, length(v), 0.0);
  gl_FragColor = vec4(grade(col, uTrip), vA);
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
// been drawn in (accelerating, like suction). A gem a companion caught is
// tossed to the runner instead (dz carried 1000 over): it flies back to them
// in an arc over a little over half a second, full size until it arrives.
vec3 gemCollect(float at, float dz) {
  if (at <= 0.0) return vec3(-1.0, 1.0, 0.0);
  float toss = step(500.0, dz);
  float ct = clamp((uTime - at) / mix(0.26, 0.56, toss), 0.0, 1.0);
  float pull = mix(ct * ct, ct * ct * (3.0 - 2.0 * ct), toss);
  return vec3(ct, 1.0 - mix(pull, smoothstep(0.72, 1.0, ct), toss), pull);
}
// Where a gem hangs, bobbing — or, once taken, where it is on its way into the
// runner: held level with them as they run on (dz ahead of their chest), and
// drawn in to it (tossed: over an arc).
vec3 gemCentre(vec3 pivot, float phase, vec3 pick, float dz) {
  vec3 c = pivot + vec3(0.0, sin(uTime * uSpin.y + phase * 1.3) * uSpin.z, 0.0);
  if (pick.x < 0.0) return c;
  float toss = step(500.0, dz);
  dz -= toss * 1000.0;
  c.z = uGemAt.z + dz;
  c = mix(c, uGemAt, pick.z);
  c.y += toss * sin(pick.x * 3.14159) * (0.9 + 0.05 * abs(dz));
  return c;
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
  vec3 pick = gemCollect(at, dz);
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
    off += dir * dot(off, dir) * 3.2 * pick.z * (1.0 - pick.z) * smoothstep(0.05, 0.3, len) * (1.0 - 0.75 * step(500.0, dz));
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
uniform vec4 uKindE[GEM_KINDS]; // x glints, y how much the bands wander, z metallic, w nacre (a pearl: its lustre and orient; second is the orient's overtone)
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
    // a light of its own from within, in its own colour
    col += base * 0.16 * (1.0 - B.x * 0.6);
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
  } else if (vFx.x > 0.5 && uKindE[int(vKind + 0.5)].w > 0.0) {
    // A pearl (a kind with nacre): lustre, not facets. A soft body in its own
    // colour, brighter where it faces up to the light and darkening toward
    // its edge; over it the orient — light thrown back from layer on layer
    // of nacre, interfering into pink, green, gold and peacock blue — banded
    // round it in the ring between the glint and the rim and sliding over it
    // as it turns (the layers' thickness wanders through the pearl, fixed in
    // its own space); a broad soft sheen in those colours and a crisp white
    // window glint on top. Dark pearls (a Tahitian's peacock black) show their
    // orient brightest, as real ones do.
    int k = int(vKind + 0.5);
    float nacre = uKindE[k].w;
    float face = abs(dot(n, V));
    float sky = smoothstep(-0.5, 0.9, R.y);
    vec3 body = base * (0.6 + 0.5 * sky) * mix(0.66 - 0.3 * nacre * nacre, 1.0, smoothstep(0.0, 0.75, face));
    body *= mix(mix(uShadowTint, vec3(1.0), 0.55 + 0.45 * uGemPolish), vec3(1.0), lit);
    vec3 q = vLocal * 4.0;
    float th = fbm(q + 2.3);
    float ph = 6.2831 * (0.6 * face + 0.7 * th + 0.18 * R.y) + float(k) * 1.3;
    vec3 film = 0.5 + 0.5 * cos(ph + vec3(0.0, 2.1, 4.2));
    // (each kind's orient leans toward its own overtone: rosé, green, blue...)
    film = mix(film, uKindC[k].rgb, 0.5);
    const vec3 LUM = vec3(0.299, 0.587, 0.114);
    float lum = dot(body, LUM);
    // the orient shifts the body's hue at its own brightness (a dark pearl's
    // a little brighter than its body, so it shows)
    vec3 over = film / max(dot(film, LUM), 0.05) * (lum + 0.17 * nacre * nacre);
    float ring = smoothstep(0.02, 0.45, face) * (1.0 - 0.7 * smoothstep(0.55, 0.95, face));
    col = mix(body, over, ring * nacre * 0.75);
    float sheen = pow(max(dot(R, L), 0.0), 7.0) * 0.3 + pow(max(dot(R, L2), 0.0), 9.0) * 0.16;
    col += mix(vec3(1.0), film, 0.3) * sheen * (0.6 + nacre);
    col += vec3(pow(max(dot(R, L2), 0.0), 60.0) * 0.95 + pow(max(dot(R, L), 0.0), 140.0) * 1.1);
    // nacre has a faint fine grain to it
    col *= 1.0 + (vnoise(q * 5.0) - 0.5) * 0.07;
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
  vec3 pick = gemCollect(aInst.z, aInst.w);
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
  // a hot core, the body of the halo, and a wide faint bloom round it
  float a = pow(r, 2.6) * 0.8 + pow(r, 9.0) * 0.5 + pow(r, 1.5) * 0.2;
  // in the stone's own colour, deepened a little so it reads as that colour
  // and not as white light
  float peak = max(max(vColor.r, vColor.g), max(vColor.b, 0.05));
  vec3 c = mix(vColor, vColor * vColor / peak, 0.35);
  #ifdef POOL
    float k = 1.2;
  #else
    float k = 1.45;
  #endif
  gl_FragColor = vec4(c * a * vFade * uGemGlow * k, 1.0);
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
// Planets (world/planets.js): whole worlds hung in the sky round the camera,
// one instanced draw for the lot (and one for their rings, one for the glow
// of their air). Every one has its own style and palette: a gas giant in
// banded flat colour with a great storm in the south, an ice giant soft and
// pale with a blaze of colour round its rim, a cratered moon, an ocean world
// of continents under drifting cloud, a candy-striped one in pastel bands
// like an illustration, a rust-red one with a polar cap. Each turns on its
// own axis; lit by the world's sun, its night side sinks into a crescent of
// violet, crisp at the terminator; air glows at the limb; the print's grain
// is over all of it; and low on the horizon, the dust of the little world
// hazes them over.
// aPlanet: x style, y seed, z spin (rad/s), w bands; aAtmo: rgb, strength.
// ---------------------------------------------------------------------------
const VS_PLANET = /* glsl */ `
uniform float uTime;
attribute vec4 aPlanet;
attribute vec3 aColA;
attribute vec3 aColB;
attribute vec3 aColC;
attribute vec4 aAtmo;
varying vec3 vN;
varying vec3 vWN;
varying vec3 vWP;
varying vec4 vPl;
varying vec3 vA;
varying vec3 vB;
varying vec3 vC;
varying vec4 vAtmo;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec4 wp = M * vec4(position, 1.0);
  vWP = wp.xyz;
  vWN = normalize(mat3(M) * normal);
  float a = uTime * aPlanet.z + aPlanet.y * 6.2831;
  float ca = cos(a), sa = sin(a);
  vN = vec3(ca * normal.x + sa * normal.z, normal.y, -sa * normal.x + ca * normal.z);
  vPl = aPlanet;
  vA = aColA;
  vB = aColB;
  vC = aColC;
  vAtmo = aAtmo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FS_PLANET = /* glsl */ `
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uTrip;
uniform sampler2D uNoise;
uniform vec3 uPlanetShade;
varying vec3 vN;
varying vec3 vWN;
varying vec3 vWP;
varying vec4 vPl;
varying vec3 vA;
varying vec3 vB;
varying vec3 vC;
varying vec4 vAtmo;
` + SKY_FN + /* glsl */ `
float hashP(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float triP(vec3 p, vec3 w) {
  return texture2D(uNoise, p.yz).g * w.x + texture2D(uNoise, p.xz).g * w.y + texture2D(uNoise, p.xy).g * w.z;
}
// flat bands: four tones, crisp-edged
vec3 bands4(float b, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
  float e = fwidth(b) + 0.012;
  float k = fract(b);
  vec3 c = mix(c0, c1, smoothstep(0.25 - e, 0.25 + e, k));
  c = mix(c, c2, smoothstep(0.5 - e, 0.5 + e, k));
  c = mix(c, c3, smoothstep(0.75 - e, 0.75 + e, k));
  return mix(c, c0, smoothstep(1.0 - e, 1.0, k));
}
void main() {
  vec3 n = normalize(vN);
  vec3 wn = normalize(vWN);
  vec3 V = normalize(uCamPos - vWP);
  vec3 w = abs(n);
  w = w * w * w;
  w /= w.x + w.y + w.z;
  float seed = vPl.y;
  float style = vPl.x;
  float n1 = triP(n * 0.6 + seed, w);
  float n2 = triP(n * 1.5 + seed * 1.37 + 0.3, w);
  float n3 = triP(n * 4.0 + seed * 2.11 + 0.6, w);
  float lat = n.y;
  float lon = atan(n.z, n.x);
  vec3 col;
  if (style < 0.5) {
    // gas giant: banded, the bands swirling where they meet, a great storm
    float b = lat * vPl.w + (n1 - 0.5) * 1.1 + (n2 - 0.5) * 0.4 + sin(lon * 3.0 + lat * 9.0 + seed) * 0.05;
    col = bands4(b, vA, vB, vC, mix(vA, vB, 0.5));
    vec2 sq = vec2(mod(lon - seed * 2.0 + 3.14159, 6.28318) - 3.14159, (lat + 0.34) * 3.0);
    float sr = length(sq);
    float storm = 1.0 - smoothstep(0.24, 0.29, sr);
    col = mix(col, mix(vC, vec3(1.0, 0.5, 0.36), 0.55) * (0.88 + 0.16 * sin(sr * 40.0 - uTime * 0.6)), storm);
    col = mix(col, mix(vA, vec3(1.0), 0.3), (1.0 - smoothstep(0.29, 0.34, sr)) * (1.0 - storm) * 0.6);
  } else if (style < 1.5) {
    // ice giant: soft and pale, a few fine bright streaks, a dark spot
    col = mix(vA, vB, smoothstep(-0.9, 0.9, lat * 1.6 + (n1 - 0.5) * 0.8));
    float st = smoothstep(0.9, 0.98, sin(lat * 16.0 + (n2 - 0.5) * 5.0) * 0.5 + 0.5) * smoothstep(0.5, 0.68, n1);
    col = mix(col, vec3(1.0), st * 0.75);
    col = mix(col, vC, smoothstep(0.6, 0.7, n2) * 0.35);
    vec2 sq = vec2(mod(lon - seed * 3.0 + 3.14159, 6.28318) - 3.14159, (lat + 0.22) * 3.6);
    float spot = 1.0 - smoothstep(0.16, 0.21, length(sq));
    col = mix(col, vC * 0.45, spot);
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.03, 0.07, length(sq - vec2(0.05, -0.12)))) * 0.9);
  } else if (style < 2.5) {
    // a cratered moon: highlands and dark seas, craters great and small
    col = mix(vA, vB, smoothstep(0.35, 0.7, n1 * 0.7 + n2 * 0.3));
    col = mix(col, vC, smoothstep(0.56, 0.62, n2 * 0.8 + n1 * 0.2) * 0.65);
    for (int k = 0; k < 2; k++) {
      float S = k == 0 ? 4.0 : 9.0;
      vec3 p = n * S + seed * 5.0;
      vec3 cell = floor(p);
      float h = hashP(cell + float(k) * 3.7);
      if (h < 0.5) continue;
      vec3 o = vec3(hashP(cell + 1.3), hashP(cell + 2.9), hashP(cell + 4.1)) * 0.5 + 0.25;
      vec3 dv = fract(p) - o;
      dv -= n * dot(dv, n);
      float rr = length(dv) / (0.16 + 0.16 * h);
      float bowl = 1.0 - smoothstep(0.85, 1.0, rr);
      float rim = exp(-pow((rr - 1.02) / 0.12, 2.0));
      float sl = dot(normalize(dv + 1e-4), normalize(uSunDir - n * dot(uSunDir, n) + 1e-4));
      col *= 1.0 - bowl * (0.18 + 0.2 * smoothstep(-0.2, 0.8, sl)) + rim * 0.14;
    }
  } else if (style < 3.5) {
    // an ocean world: continents, ice caps, cloud drifting over it all
    float land = smoothstep(0.53, 0.56, n1 * 0.65 + n2 * 0.35);
    col = mix(vA * (0.85 + 0.3 * n3), vB * (0.78 + 0.45 * n3), land);
    col = mix(col, vec3(0.95, 0.97, 1.0), smoothstep(0.8, 0.85, abs(lat) + (n3 - 0.5) * 0.12));
    float cl = smoothstep(0.55, 0.7, triP(n * 2.1 + vec3(uTime * 0.003, 0.0, 0.0) + seed * 0.7, w) * 0.7 + n3 * 0.3);
    col = mix(col, vec3(1.0), cl * 0.85);
  } else if (style < 4.5) {
    // candy stripes: bold flat bands in pastel, wavering a little
    float b = lat * vPl.w + sin(lon * 2.0 + seed * 5.0) * 0.12 + (n1 - 0.5) * 0.3;
    col = bands4(b, vA, vB, vC, mix(vB, vec3(1.0), 0.35));
    col *= 0.94 + 0.12 * step(0.75, hashP(floor(n * 160.0)));
  } else {
    // rust-red: dark markings, dust, a white polar cap
    col = mix(vA, vB, smoothstep(0.3, 0.7, n1 * 0.6 + n2 * 0.4));
    col = mix(col, vC, smoothstep(0.58, 0.66, n2 * 0.6 + n3 * 0.4) * 0.8);
    col = mix(col, vec3(1.0, 0.96, 0.94), smoothstep(0.84, 0.88, lat + (n3 - 0.5) * 0.08));
  }
  // light: a crisp terminator, the night side sunk in violet
  float ndl = dot(wn, uSunDir);
  float lit = smoothstep(-0.05, 0.16, ndl);
  vec3 c = col * mix(uPlanetShade, vec3(1.0), lit);
  c *= 0.9 + 0.14 * smoothstep(0.15, 1.0, ndl);
  // air glowing at the limb, brightest on the day side
  float mu = max(dot(wn, V), 0.0);
  float fres = pow(1.0 - mu, 2.5);
  c += vAtmo.rgb * fres * vAtmo.a * (0.35 + 0.9 * smoothstep(-0.4, 0.45, ndl));
  // the print's grain, and a dark edge on the night side's rim
  c *= 1.0 + (texture2D(uNoise, gl_FragCoord.xy * GRAIN).r - 0.5) * 0.08 + (n3 - 0.5) * 0.06;
  c = mix(c, c * 0.4, smoothstep(0.14, 0.02, mu) * (1.0 - lit) * (1.0 - vAtmo.a * 0.5));
  // low on the horizon the dust hazes them over
  vec3 dir = normalize(vWP - uCamPos);
  c = mix(c, skyColor(dir), (1.0 - smoothstep(-0.04, 0.13, dir.y)) * 0.6);
  gl_FragColor = vec4(grade(c, uTrip), 1.0);
}
`;
// The rings: a flat annulus about the planet's equator (geometry radii 1..2
// mapped onto aRing.x..aRing.y planet radii), banded, with gaps, lit by the
// sun and dark where the planet shades them.
const VS_RING = /* glsl */ `
attribute vec4 aPlanet;
attribute vec3 aColB;
attribute vec3 aColC;
attribute vec4 aRing;
varying vec3 vWP;
varying vec3 vCtr;
varying float vRad;
varying float vR;
varying vec4 vPl;
varying vec3 vB;
varying vec3 vC;
varying vec4 vRing;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  float r0 = length(position.xz);
  vR = clamp(r0 - 1.0, 0.0, 1.0);
  vec3 p = vec3(position.xz / max(r0, 1e-4) * mix(aRing.x, aRing.y, vR), 0.0).xzy;
  vec4 wp = M * vec4(p, 1.0);
  vWP = wp.xyz;
  vCtr = (M * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vRad = length(M[0].xyz);
  vPl = aPlanet;
  vB = aColB;
  vC = aColC;
  vRing = aRing;
  // (a ring with no width is no ring)
  gl_Position = aRing.y > aRing.x ? projectionMatrix * viewMatrix * wp : vec4(0.0, 0.0, 2.0, 1.0);
}
`;
const FS_RING = /* glsl */ `
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uTrip;
uniform sampler2D uNoise;
uniform vec3 uPlanetShade;
varying vec3 vWP;
varying vec3 vCtr;
varying float vRad;
varying float vR;
varying vec4 vPl;
varying vec3 vB;
varying vec3 vC;
varying vec4 vRing;
` + SKY_FN + /* glsl */ `
void main() {
  float r = vR;
  float seed = vPl.y;
  float bands = 0.55 + 0.25 * sin(r * 38.0 + seed * 7.0) + 0.2 * sin(r * 91.0 + seed * 3.0);
  float gap = smoothstep(0.02, 0.05, abs(r - 0.6)) * smoothstep(0.01, 0.025, abs(r - 0.83));
  float edge = smoothstep(0.0, 0.06, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float a = vRing.z * clamp(bands, 0.0, 1.0) * gap * edge;
  if (a < 0.01) discard;
  vec3 col = mix(vB, vC, smoothstep(0.35, 0.75, sin(r * 12.0 + seed) * 0.5 + 0.5));
  // in the planet's shadow?
  vec3 rel = vWP - vCtr;
  float t = dot(rel, uSunDir);
  float d2 = dot(rel, rel) - t * t;
  float shadow = step(t, 0.0) * (1.0 - smoothstep(vRad * vRad * 0.85, vRad * vRad * 1.05, d2));
  col *= mix(vec3(1.0), uPlanetShade * 0.8, shadow);
  vec3 dir = normalize(vWP - uCamPos);
  col = mix(col, skyColor(dir), (1.0 - smoothstep(-0.04, 0.13, dir.y)) * 0.6);
  gl_FragColor = vec4(grade(col, uTrip), a);
}
`;
// The air round a planet: a soft glow just outside its limb, brightest on
// the day side (a billboard facing the camera, additive).
const VS_HALO = /* glsl */ `
uniform vec3 uSunDir;
attribute vec4 aAtmo;
varying vec2 vQ;
varying vec4 vAtmo;
varying float vSun;
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  vec3 ctr = (M * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float R = length(M[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vQ = position.xy * 2.9;
  vec3 wp = ctr + (right * vQ.x + up * vQ.y) * R;
  // (which way the sun is, across the screen)
  vec2 sv = vec2(dot(uSunDir, right), dot(uSunDir, up));
  vSun = atan(sv.y, sv.x);
  vAtmo = aAtmo;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FS_HALO = /* glsl */ `
uniform vec4 uGrade;
varying vec2 vQ;
varying vec4 vAtmo;
varying float vSun;
void main() {
  float r = length(vQ);
  if (r < 0.98 || vAtmo.a <= 0.0) discard;
  float g = exp(-(r - 1.0) * 7.0) * smoothstep(0.98, 1.01, r);
  float side = dot(vQ / r, vec2(cos(vSun), sin(vSun)));
  g *= 0.3 + 0.7 * smoothstep(-0.6, 0.5, side);
  gl_FragColor = vec4(vAtmo.rgb * g * vAtmo.a * 0.55 * uGrade.w, 1.0);
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
  const v40 = () => ({ value: new THREE.Vector4(0, 0, 0, 0) });
  const c = () => ({ value: new THREE.Color() });
  const u = {
    uSkyTop: c(), uSkyHorizon: c(), uSkyBottom: c(),
    uSunDir: v3(), uSunColor: c(), uSunDisc: c(),
    uMoonDir: v3(), uMoonColor: c(),
    uSkyFx: v4(), uSkyFx2: v4(), uSkyFx3: v40(), uSkyFx4: v40(),
    uNeb0: c(), uNeb1: c(), uNeb2: c(),
    uLightDir: v3(), uShadowTint: c(), uHiTint: c(), uLightK: v4(), uRim: v4(), uDapple: v4(), uWall: v4(),
    uInk: c(), uFog: v4(), uMist: v4(), uMistH: v4(), uGrade: v4(), uVignette: c(), uTrip: v4(),
    uGroundA: c(), uGroundB: c(), uGroundC: c(),
    uShadowColor: c(), uGlass: v4(), uGlowGain: { value: 1 },
    uBeam: v4(), uPool: c(), uDrain: v4(), uWonk: { value: 0 }, uEclipse: v4(), uVigShape: v4(),
    // which way shadows fall (env.cast: m of shadow per m of height, x
    // sideways, y toward the camera) - the runner's and the companion's
    // silhouettes are laid on the ground along it (see render/caster.js)
    uCast: v40(),
    // how pale the dust kicked up off the ground is (env.dustPale)
    uDustPale: { value: 0.62 },
    uSea: v4(), uDeep: v4(), uDeepTint: c(),
    // The Gallery's sands (env.sands, see the sand ground): its dunes, and
    // what game/sands.js writes each frame — the surf before a doorway into
    // the sea, and the runner's footprints
    uDunes: v4(), uShore: v40(), uSurf: v40(), uSurf2: v40(), uSurf3: v40(),
    uSeaShallow: c(), uSeaDeep: c(), uSeaFoam: c(),
    uPrintA: { value: Array.from({ length: PRINTS }, () => new THREE.Vector4()) },
    uPrintB: { value: Array.from({ length: PRINTS }, () => new THREE.Vector4()) },
    uPrintZone: v40(),
    // Snow settling (env.snow, the Frostbound Pass): x how much has built
    // up, written every frame by Game.updateSnow; y how far the dream lifts
    // far drifts apart (env.snow.lift)
    uSnow: v40(),
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
  // deep space (env.space): x the nebula's ribbons, y spiral galaxies, z a
  // dense starfield all round, w comets; the nebula's three colours
  // x: a winged sun (skyFx.wings: how much), y: its span (sun radii)
  u.uSkyFx4.value.set(sk.wings || 0, sk.wingSpan || 7, sk.range || 0, 0);
  const spc = env.space || {};
  u.uSkyFx3.value.set(spc.nebula || 0, spc.galaxies || 0, spc.stars || 0, spc.comets || 0);
  const neb = spc.colors || ['#ff6aa8', '#ff9a52', '#4a8adf'];
  setColor(u.uNeb0.value, neb[0]);
  setColor(u.uNeb1.value, neb[1]);
  setColor(u.uNeb2.value, neb[2]);
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
  const cast = env.cast || [0, 0];
  u.uCast.value.set(cast[0], cast[1], 0, 0);
  const gc = color(env.glass ? env.glass[0] : '#ffffff');
  u.uGlass.value.set(gc.r, gc.g, gc.b, env.glass ? env.glass[1] : 0.2);
  u.uGlowGain.value = env.glowGain ?? 1;
  const bm = env.beam || { color: '#ffffff', amount: 0 };
  const bc = color(bm.color);
  u.uBeam.value.set(bc.r, bc.g, bc.b, bm.amount);
  setColor(u.uPool.value, env.pool || '#000000');
  u.uDustPale.value = env.dustPale ?? 0.62;
  // under the sea: the surface overhead, its shafts of light, the caustics
  // (scale: a multiple of 1/256 per metre)
  const sea = env.sea || {};
  u.uSea.value.set(sea.surface || 0, sea.rays || 0, sea.caustics || 0, sea.scale ?? 0.1875);
  const deep = env.deep || {};
  u.uDeep.value.set(deep.amount || 0, deep.from ?? 0.3, deep.to ?? 1, 0);
  setColor(u.uDeepTint.value, deep.tint || '#ffffff');
  // the sands: [drift height at the wall, pile height, a pile's cycle (s),
  // share of the arches sand falls from]; the sea's colours where it laps
  // up the beach
  const sands = env.sands || {};
  const dn = sands.dunes || [0, 0, 1, 0];
  u.uDunes.value.set(dn[0], dn[1], dn[2], dn[3]);
  const sw = sands.sea || ['#8fd9d4', '#4cb3c4', '#ffffff'];
  setColor(u.uSeaShallow.value, sw[0]);
  setColor(u.uSeaDeep.value, sw[1]);
  setColor(u.uSeaFoam.value, sw[2]);
  // (how much snow has settled, uSnow.x, is the game's to say: see
  // Game.updateSnow)
  u.uSnow.value.y = env.snow ? env.snow.lift || 0 : 0;
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
  if (o.sandfall) defines.SANDFALL = '';
  if (o.flame) defines.FLAME = '';
  if (o.bark) defines.BARK = '';
  // shelves of books on parts marked 0.7 (along the run) or 0.75 (across it)
  if (o.shelves) defines.SHELVES = '';
  // brick in running bond on parts marked 0.55 (see brickBond)
  if (o.brick) defines.BRICK = '';
  if (o.leaf) defines.LEAF = '';
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
  // [turns a second about x, about z, the height of its middle]
  if (o.tumble) {
    defines.TUMBLE = '';
    uniforms.uTumble = { value: new THREE.Vector4(o.tumble[0], o.tumble[1], o.tumble[2] ?? 0, 0) };
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
  // a critter zooming round its spot (see SWIM): [loop rate, along,
  // up, across]; [bank, barrel rolls a loop, beats a second, beat]; [surge,
  // pitch, kind (0 sea lion, 1 octopus, 2 seahorse)]
  if (o.swim) {
    defines.SWIM = '';
    uniforms.uSwim = { value: new THREE.Vector4(...o.swim) };
    uniforms.uSwim2 = { value: new THREE.Vector4(...(o.swim2 || [0, 0, 1, 0])) };
    const s3 = o.swim3 || [];
    uniforms.uSwim3 = { value: new THREE.Vector4(s3[0] ?? 0, s3[1] ?? 1, s3[2] ?? 0, 0) };
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
  // a lid that pops open now and then: [seconds between pops, hinge height,
  // hinge depth, how wide it opens (rad)]
  if (o.lid) {
    defines.LID = '';
    uniforms.uLid = { value: new THREE.Vector4(...o.lid) };
  }
  // the sands (env.sands): a ground strip heaped into drifts and piles, and
  // the threads of sand falling onto the piles ([height they fall from,
  // radius])
  if (o.dunes) defines.DUNES = '';
  // the Frostbound Pass (env.snow): a ground strip heaped into banks along
  // the route and dunes beyond (banks); a prop the snow settles on - its
  // vertices move by their `snow` attribute as it builds up, and what faces
  // up is whitened: snow: [how squarely a face must look up to hold it under
  // a dusting, and once it lies deep, how soft its edge, how much] (true:
  // the usual; a last 0: the prop only moves); glacier ice on parts marked
  // 0.2: ice: [banding, glints, how much light it holds]; and the mouth of a
  // crevasse on parts marked 0.9: crevasse: [width, depth, how fast its
  // walls close in]
  if (o.banks) defines.BANKS = '';
  if (o.snow) {
    defines.SNOW = '';
    const c = o.snow === true ? [] : o.snow;
    uniforms.uSnowCap = { value: new THREE.Vector4(c[0] ?? 0.8, c[1] ?? 0.35, c[2] ?? 0.2, c[3] ?? 1) };
  }
  if (o.ice) {
    defines.ICE = '';
    const c = o.ice === true ? [] : o.ice;
    uniforms.uIce = { value: new THREE.Vector4(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, 0) };
  }
  if (o.crevasse) {
    defines.CREVASSE = '';
    uniforms.uCrev = { value: new THREE.Vector4(o.crevasse[0], o.crevasse[1] ?? 5, o.crevasse[2] ?? 0.18, 0) };
  }
  if (o.thread) {
    defines.THREAD = '';
    uniforms.uThread = { value: new THREE.Vector4(o.thread[0], o.thread[1], 0, 0) };
  }
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
  for (const k of ['TURN', 'TUMBLE', 'KINDS', 'SPLASH', 'SAND', 'WONKY', 'FLAME', 'CLOTH', 'CURRENT', 'SCHOOL', 'SWIM', 'JELLY', 'CROSS', 'LID', 'SNOW']) if (toon.defines && k in toon.defines) defines[k] = '';
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
  // o.style: 'explorer' draws her details, 'elder' his (see CHAR_DETAIL).
  // cape may be a list of them (one pair of materials each: the elder's
  // beard and skirt).
  while (rig.length < 3) rig.push(new THREE.Vector4());
  const uniforms = withShared(env, Object.assign({ uPal: { value: pal }, uRig: { value: rig }, uDream3: { value: new THREE.Vector4() } }, o.uniforms)); // rig: [Vector4 x 3]
  const STYLES = { explorer: 'EXPLORER', items: 'ITEMS', fox: 'FOX', elder: 'ELDER', dragon: 'DRAGON', bunny: 'BUNNY', props: 'BUNNY PROPS', skater: 'SKATER', samurai: 'SAMURAI', pitcher: 'PITCHER' };
  const style = STYLES[o.style] ? Object.fromEntries(STYLES[o.style].split(' ').map((k) => [k, ''])) : {};
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
  // o.shell: a material for the layers of fur grown over the body (see SHELL)
  const shell = o.shell ? new THREE.ShaderMaterial({ uniforms: Object.assign({}, uniforms, { uFurWind: { value: o.shell } }), defines: Object.assign({ SHELL: '' }, style), vertexShader: VS_CHAR, fragmentShader: FS_CHAR }) : null;
  if (!cape) return { mat, ink, shell };
  const sheets = (Array.isArray(cape) ? cape : [cape]).map((c) => make({ CAPE: '' }, { uCape: { value: c.texture }, uCapeGrid: { value: c.grid } }));
  return { mat, ink, capeMat: sheets[0][0], capeInk: sheets[0][1], sheets };
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
  const defines = {};
  if (o.firefly) {
    defines.FIREFLY = '';
    uniforms.uFirefly = { value: new THREE.Vector4(...o.firefly) };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
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

// A figure's own shadow (see FS_CAST): map, its silhouette render target's
// texture; env, the uniforms the figure is lit by.
export function makeCastShadowMaterial(env, map) {
  const uniforms = withShared(env, {
    uCastMap: { value: map },
    uCastK: { value: new THREE.Vector4(0.01, 0.01, 1, 0) },
    uFoot: { value: new THREE.Vector4(0.5, 0.5, 1, 1) },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_CAST,
    fragmentShader: FS_CAST,
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

// A world's planets (world/planets.js): the globes, their rings and the
// glow of their air. shade: the colour their night side sinks into.
export function makePlanetMaterials(env, shade) {
  const uniforms = withShared(env, { uPlanetShade: { value: new THREE.Color(shade) } });
  const planet = new THREE.ShaderMaterial({ uniforms, vertexShader: VS_PLANET, fragmentShader: FS_PLANET });
  const ring = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_RING,
    fragmentShader: FS_RING,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const halo = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_HALO,
    fragmentShader: FS_HALO,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { planet, ring, halo };
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
// second, opaque, rough, metal, scale, glints, nacre }. A kind with nacre
// lights its polished (metal) parts as pearls, its second colour the overtone
// its orient leans toward.
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
    uKindE: v4((k) => [k.glints ?? 1, k.wander ?? 6, k.metal ?? 0, k.nacre ?? 0]),
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

// --- the companions' abilities (game/powerfx.js) ------------------------------
// Pitcher Protection: the water Nep drenches the runner in, a clear coat
// wrapped round them - all but invisible face-on, a teal sheen toward its
// edges where you look through more of it, streams of water running down it
// and a glint up top. uAlpha fades it (it thins out before the protection
// does); uFlow how hard it runs.
const VS_SHEEN = COMMON + /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec3 vLocal;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vLocal = position;
  vNormal = normalize(mat3(modelMatrix) * normal);
  wp = bendPos(wp);
  vPos = wp;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FS_SHEEN = FS_HEAD + /* glsl */ `
uniform float uAlpha;
uniform float uFlow;
varying vec3 vLocal;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float f = 1.0 - abs(dot(N, V));
  float fres = f * f;
  // streams running down it, each wavering, each at its own pace
  float lane = vLocal.x * 7.0 + sin(vLocal.z * 6.0 + vLocal.y * 3.0) * 1.2;
  float run = sin(lane) * 0.5 + 0.5;
  float flow = sin(vLocal.y * 9.0 + uTime * 6.0 * uFlow + floor(lane) * 1.7);
  float stream = smoothstep(0.82, 1.0, run) * smoothstep(0.1, 0.9, flow);
  float glint = smoothstep(0.86, 0.97, dot(N, normalize(vec3(-0.35, 0.82, 0.45))));
  float ripple = 0.5 + 0.5 * sin(vLocal.y * 22.0 - uTime * 4.0 + vLocal.x * 5.0);
  vec3 col = mix(vec3(0.3, 0.66, 0.78), vec3(0.82, 0.97, 1.0), clamp(fres * 0.8 + stream * 0.6, 0.0, 1.0));
  col += glint * 0.55;
  float a = uAlpha * (0.06 + 0.5 * fres + 0.32 * stream + 0.4 * glint + 0.05 * ripple * fres);
  vec3 v = vWorld - uCamPos;
  col = atmos(col, v, length(v), 0.4);
  gl_FragColor = vec4(grade(col, uTrip), clamp(a, 0.0, 0.8));
}
`;
export function makeSheenMaterial(env) {
  return new THREE.ShaderMaterial({
    uniforms: withShared(env, { uAlpha: { value: 0 }, uFlow: { value: 1 } }),
    vertexShader: VS_SHEEN,
    fragmentShader: FS_SHEEN,
    transparent: true,
    depthWrite: false,
  });
}

// Root Reach: one of Nep's roots, a tapering cylinder 0..1 along y (scaled
// to its length), wriggling as it goes - more at the tip, and less once
// it's grabbed (uRoot.y: 0 reaching, 1 holding) - bark-brown, its tip a
// paler new growth, lit from above.
const VS_ROOT = COMMON + /* glsl */ `
uniform vec4 uRoot; // x seed, y hold, z length (m)
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPos;
varying vec3 vLocal;
void main() {
  vec3 p = position;
  float k = p.y;
  float wig = sin(k * 7.0 + uTime * 9.0 + uRoot.x * 6.3) * (1.0 - 0.6 * uRoot.y);
  float wig2 = cos(k * 5.0 - uTime * 7.0 + uRoot.x * 3.1) * (1.0 - 0.6 * uRoot.y);
  float amp = sin(k * 3.14159) * min(0.22, 0.05 * uRoot.z);
  // (the wriggle in metres, whatever the length it's scaled to)
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 side = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
  vec3 side2 = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  wp += side * wig * amp + side2 * wig2 * amp * 0.7;
  vLocal = p;
  vNormal = normalize(mat3(modelMatrix) * normal);
  wp = bendPos(wp);
  vPos = wp;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FS_ROOT = FS_HEAD + /* glsl */ `
uniform vec3 uLightDir;
varying vec3 vLocal;
void main() {
  vec3 N = normalize(vNormal);
  float lit = clamp(dot(N, normalize(uLightDir)) * 0.5 + 0.55, 0.25, 1.0);
  float bark = 0.5 + 0.5 * sin(vLocal.y * 40.0 + atan(vLocal.x, vLocal.z) * 2.0);
  vec3 col = mix(vec3(0.31, 0.19, 0.11), vec3(0.54, 0.35, 0.2), bark * 0.6);
  col = mix(col, vec3(0.78, 0.66, 0.42), smoothstep(0.82, 1.0, vLocal.y));
  col *= lit;
  vec3 v = vWorld - uCamPos;
  col = atmos(col, v, length(v), 0.0);
  gl_FragColor = vec4(grade(col, uTrip), 1.0);
}
`;
export function makeRootMaterial(env) {
  return new THREE.ShaderMaterial({
    uniforms: withShared(env, { uRoot: { value: new THREE.Vector4() } }),
    vertexShader: VS_ROOT,
    fragmentShader: FS_ROOT,
  });
}

// The samurai's ribbons of water (game/ribbon.js), lit by env.
export function makeRibbonMaterial(env) {
  return new THREE.ShaderMaterial({
    uniforms: withShared(env, {}),
    vertexShader: VS_RIBBON,
    fragmentShader: FS_RIBBON,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// The elder's sparks (game/sparks.js), graded by env.
export function makeSparkMaterial(env) {
  return new THREE.ShaderMaterial({
    uniforms: withShared(env, {}),
    vertexShader: VS_SPARK,
    fragmentShader: FS_SPARK,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// The bunny's dandelion seeds (game/seeds.js), lit by env.
export function makeSeedMaterial(env) {
  return new THREE.ShaderMaterial({
    uniforms: withShared(env, {}),
    vertexShader: VS_SEED,
    fragmentShader: FS_SEED,
    transparent: true,
    depthWrite: false,
  });
}

// The bunny's whiskers (game/bunny.js), in ink of colour ink.
export function makeWhiskerMaterial(env, ink) {
  return new THREE.ShaderMaterial({
    uniforms: withShared(env, { uInk: { value: new THREE.Color(ink) } }),
    vertexShader: VS_WHISKER,
    fragmentShader: FS_WHISKER,
    transparent: true,
    side: THREE.DoubleSide,
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
    uStill: { value: 0 },
    uFlake: { value: 0 },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS_PARTICLES,
    fragmentShader: FS_PARTICLES,
    transparent: true,
    depthWrite: false,
    // premultiplied (see FS_PARTICLES): additive glow or a flake laid over
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}
