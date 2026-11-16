// The Blue Hour's shaders, spliced into the object shaders (see shaders.js):
//
//   toon option coast    the lighthouse's beam sweeping over whatever it's on
//                        (beaconAt), and the coast's surfaces picked by a
//                        part's mark flag: 0.13 foam, 0.23 the body of a wave,
//                        0.33 wet stone, 0.43 the inside of a tidal cut
//   toon option wind     long grass (or a rope's end, a seed head) bending
//                        in the wind, gusts running through it (WIND)
//   toon option sea      the sea itself: a strip of swell rolling in on the
//                        land, foam at its edge (SEA)
//   toon option surge    an overtopping wave: a swell that rears up beside
//                        the causeway and pours over into an outer lane
//                        (SURGE: a dodge)
//   toon option wash     a low ridge of white water spilling across the whole
//                        causeway (WASH: a jump)
//   toon option breaker  a swell striking the rocks off the road and
//                        bursting into spray, the foam draining back down
//                        them (BREAKER: scenery)
//   ground patterns      18 the coastal path through the grass, 19 the
//                        causeway's wet slabs, 20 the fishing landing's
//                        boards and setts (COAST_GROUND)
//
// A surge's and a wash's progress (p1, 0 far off .. 1 the moment the runner
// reaches it .. 2 drained away) is the world's to write every frame (see
// frame in world/coast.js), from how long the runner will take to get there;
// so a wave always breaks as you come up to it, however fast you're running,
// and never un-breaks if you stumble.
//
// Everything keyed on where a fragment is in the world (vPos, wp) has its
// periods along the run divide 512 m, and everything keyed on the distance
// along the track (uv.y + p0) divides 4096 m, so nothing jumps where the
// world re-bases or the distance wraps.

// --- shared: the wind, and the lighthouse --------------------------------------
export const COAST_COMMON = /* glsl */ `
#ifdef COAST
// x, y, z the lantern (world, before the bend), w which way its beams point
// (rad: (cos w, -sin w) in x, z; two beams, back to back)
uniform vec4 uBeacon;
// x how bright the beams are on what they cross, y their half-width (rad),
// z how far they reach (m), w the flare (the scenic moment: the beam slowed
// across the runner, the spray lit up)
uniform vec4 uBeacon2;
// x, y which way the wind blows (x, z: from the sea toward the land), z how
// hard the gusts come, w how much the grass leans between them
uniform vec4 uWind;
#define BEACON_COL vec3(1.0, 0.76, 0.46)
// How hard the wind is blowing at p (world x, z): broad waves rolling in off
// the sea across the fields - the blades all leaning together and lifting
// again - and on them patches of stronger gusts, carried the same way, that
// press a field flat as they run through it. (Along the run every period
// divides 512 m.)
float gustAt(vec2 p) {
  float t = uTime;
  float a = sin(p.x * -0.13 + p.y * 0.1227185 - t * 1.25);
  float b = sin(p.x * -0.071 + p.y * 0.0613592 - t * 0.62 + 1.7);
  float base = 0.55 + 0.3 * a + 0.15 * b;
  vec2 q = vec2(p.x * 0.015625 + t * 0.055, p.y * 0.015625 - t * 0.042);
  float g = texture2D(uNoise, q).g * 0.7 + texture2D(uNoise, q * 2.0 + vec2(0.37, 0.11)).g * 0.3;
  return base * uWind.w + smoothstep(0.5, 0.78, g) * uWind.z;
}
// How much of the lighthouse's light falls on p: inside either beam's wedge
// as it sweeps round, out to its reach (and never right under the tower).
float beaconAt(vec3 p) {
  vec2 to = p.xz - uBeacon.xz;
  float d = length(to);
  vec2 dir = vec2(cos(uBeacon.w), -sin(uBeacon.w));
  float c = abs(dot(to / max(d, 0.001), dir));
  float w = uBeacon2.y;
  float lit = smoothstep(cos(w), cos(w * 0.3), c);
  lit *= 1.0 - smoothstep(uBeacon2.z * 0.6, uBeacon2.z, d);
  return lit * smoothstep(10.0, 45.0, d) * uBeacon2.x;
}
#endif
`;

// --- vertex: declarations --------------------------------------------------------
export const COAST_VS_HEAD = /* glsl */ `
#ifdef COAST
#if !defined(DUNES) && !defined(THREAD) && !defined(BANKS)
uniform sampler2D uNoise;
#endif
` + COAST_COMMON + /* glsl */ `
#endif
#ifdef WIND
// how it bends: x how far (per m of height, squared), y how much it
// flutters, z how stiff its foot is (m that hardly move) - or, hung, the
// height it hangs from - w 1: it hangs
uniform vec4 uWindK;
varying float vWind;
#endif
#ifdef SEA
// x how high the swell stands here (-1 trough .. 1 crest), y how far out
// from the shore (m), z, w the track position (x across, y along)
varying vec4 vSea;
#endif
#if defined(SURGE) || defined(WASH) || defined(BREAKER)
// spray: 1 for the droplets thrown up (the lighthouse's beam catches them)
varying float vSpray;
#endif
#ifdef BREAKER
// x its cycle (s), y how high it rears (m above the sea), z 1: its progress
// is p1 (written by the world - the great wave as you come onto the
// causeway) rather than its own clock
uniform vec4 uBreak;
#endif
#if defined(SEA) || defined(SURGE) || defined(WASH) || defined(BREAKER)
// the sea's level, below the road
#define SEA_Y -2.4
#endif
`;

// --- vertex: in the prop's own space (before it's placed) ------------------------
export const COAST_VS_LOCAL = /* glsl */ `
#if defined(SURGE) || defined(WASH) || defined(BREAKER)
  // (built for the sea on the right, +x; one on the left side of the road
  // is turned round - the wash by its phase - and the sea is out to -x)
  #ifdef WASH
    float cSide = phase > 3.14159 ? -1.0 : 1.0;
  #else
    float cSide = M[3].x < 0.0 ? -1.0 : 1.0;
  #endif
  vSpray = 0.0;
#endif
#ifdef SURGE
  {
    // An overtopping wave. u: its progress (p1). The swell rolls in from
    // well out, rising as it comes; it rears up against the causeway's
    // wall beside its lane, its lip feathering spray (the warning: this
    // lane), pitches over, and pours down into the lane; the lane runs a
    // foot deep in churning foam until the runner's past, and it drains.
    float u = sgn;
    float t = uTime;
    float rise = smoothstep(0.0, 0.58, u);
    float X = mix(12.5, 3.0, rise);
    float E = mix(0.7, 6.3, smoothstep(0.03, 0.56, u)) * (1.0 - smoothstep(0.62, 0.9, u));
    if (role < 0.5) {
      // the swell: a long ridge of water, its land face steepening
      lp.x = lp.x * mix(1.7, 1.0, rise) + X;
      lp.y = SEA_Y + lp.y * E + sin(t * 1.6 + lp.z * 0.7) * 0.08 * E;
    } else if (role < 1.5) {
      // the lip, on its crest: it feathers, then throws forward over the
      // lane (turned about z, its root on the crest)
      float sc = smoothstep(0.26, 0.44, u) * (1.0 - smoothstep(0.7, 0.86, u));
      float a = 2.05 * smoothstep(0.45, 0.68, u);
      float c = cos(a), s = sin(a);
      lp *= sc * (0.6 + 0.4 * E / 6.3);
      lp.xy = vec2(lp.x * c - lp.y * s, lp.x * s + lp.y * c);
      ln.xy = vec2(ln.x * c - ln.y * s, ln.x * s + ln.y * c);
      lp += vec3(X - 0.5, SEA_Y + E * 0.97, 0.0);
      lp.z += sin(t * 3.0 + lp.x) * 0.05;
    } else if (role < 2.5) {
      // the curtain: falling from the lip down into the lane, then
      // slumping after it
      float on = step(0.6, u) * (1.0 - step(1.1, u));
      float top = mix(3.7, 0.0, smoothstep(0.8, 1.06, u));
      float bot = mix(top, 0.0, smoothstep(0.6, 0.72, u));
      float k = lp.y;
      lp.y = mix(bot, top, k);
      lp.x = lp.x + mix(0.15, 1.5, k) + sin(t * 9.0 + lp.z * 3.0 + k * 6.0) * 0.06;
      lp.xz *= on;
      lp.y *= on;
    } else if (role < 3.5) {
      // the flood: the lane heaped with churning foam, then draining away
      float hf = 1.45 * smoothstep(0.64, 0.8, u) * (1.0 - 0.5 * smoothstep(0.84, 1.15, u)) * (1.0 - smoothstep(1.25, 1.85, u));
      float ch = 0.82 + 0.18 * sin(t * 4.3 + lp.x * 3.1 + lp.z * 2.3);
      lp.y *= hf * ch;
      lp.x = mix(lp.x * 0.4 + 0.8, lp.x, smoothstep(0.64, 0.78, u));
    } else {
      // spray: thrown off the lip as it feathers and up out of the impact
      float tau = (u - spA.w) * 3.3;
      float g = 15.0;
      float fl = 2.0 * spB.y / g;
      float sz = step(0.0, tau) * (1.0 - smoothstep(fl * 0.7, fl, tau));
      float tt = clamp(tau, 0.0, fl);
      vec3 vel = spB.xyz - vec3(0.0, g * tt, 0.0);
      vec3 vd = normalize(vel + vec3(0.0, 0.001, 0.0));
      lp *= sz * (0.7 + 0.5 * smoothstep(0.0, 0.25, tt));
      lp += vd * dot(lp, vd) * length(vel) * 0.06;
      lp += spA.xyz + spB.xyz * tt - vec3(0.0, 0.5 * g * tt * tt, 0.0);
      vSpray = 1.0;
    }
  }
#endif
#ifdef WASH
  {
    // A wash: a swell builds beside the causeway and breaks over its edge,
    // and a low ridge of white water runs right across the road, covering
    // every lane before the runner gets to it; once they're over it, it
    // spills off the far side and drains away.
    float u = sgn;
    float t = uTime;
    float E = mix(0.5, 2.9, smoothstep(0.0, 0.42, u)) * (1.0 - smoothstep(0.44, 0.62, u));
    if (role < 0.5) {
      float F = mix(6.4, -7.2, smoothstep(0.4, 0.74, u));
      float on = smoothstep(F - 0.05, F + 1.5, lp.x);
      float k = 1.0 - smoothstep(1.12, 1.6, u);
      lp.y *= on * k * (0.9 + 0.1 * sin(t * 5.0 + lp.x * 2.2 + lp.z * 4.0));
      lp.z *= mix(0.55, 1.0, on);
      lp.x = max(lp.x, F);
      lp.z += sin(t * 3.0 + lp.x * 0.8) * 0.05 * on;
    } else if (role < 1.5) {
      // the swell beside the road (built out at x 7.5, foot at the sea)
      lp.x += mix(5.0, 0.0, smoothstep(0.0, 0.42, u));
      lp.y = SEA_Y + lp.y * E;
    } else {
      float tau = (u - spA.w) * 3.0;
      float g = 15.0;
      float fl = 2.0 * spB.y / g;
      float sz = step(0.0, tau) * (1.0 - smoothstep(fl * 0.7, fl, tau));
      float tt = clamp(tau, 0.0, fl);
      lp *= sz;
      lp += spA.xyz + spB.xyz * tt - vec3(0.0, 0.5 * g * tt * tt, 0.0);
      vSpray = 1.0;
    }
  }
#endif
#ifdef BREAKER
  {
    // A swell striking the rocks: it rolls in and rears, bursts into spray
    // (thrown up and out to sea, never in over the road), throws a sheet
    // of foam over the rocks, and drains back down through the cracks
    // between them. On its own clock - or, for the great wave as you come
    // onto the causeway, on the runner's (uBreak.z).
    float f = uBreak.z > 0.5 ? sgn : fract(uTime / uBreak.x + phase * 0.1591549);
    float secs = uBreak.z > 0.5 ? 3.2 : uBreak.x;
    float t = uTime;
    float a = smoothstep(0.0, 0.42, f);
    float E = mix(0.4, uBreak.y, a) * (1.0 - smoothstep(0.43, 0.56, f));
    if (role < 0.5) {
      lp.x = lp.x * mix(1.5, 1.0, a) + mix(11.0, 0.8, a);
      lp.y = SEA_Y + lp.y * E + sin(t * 1.5 + lp.z * 0.6) * 0.06 * E;
    } else if (role < 1.5) {
      float tau = (f - spA.w) * secs;
      float g = 15.0;
      float fl = 2.0 * spB.y / g;
      float sz = step(0.0, tau) * (1.0 - smoothstep(fl * 0.65, fl, tau));
      float tt = clamp(tau, 0.0, fl);
      vec3 vel = spB.xyz - vec3(0.0, g * tt, 0.0);
      vec3 vd = normalize(vel + vec3(0.0, 0.001, 0.0));
      lp *= sz * (0.6 + 0.6 * smoothstep(0.0, 0.3, tt));
      lp += vd * dot(lp, vd) * length(vel) * 0.07;
      lp += spA.xyz + spB.xyz * tt - vec3(0.0, 0.5 * g * tt * tt, 0.0);
      vSpray = 1.0;
    } else if (role < 2.5) {
      // the sheet of foam over the rocks, sinking away
      float s = smoothstep(0.42, 0.5, f) * (1.0 - smoothstep(0.66, 0.95, f));
      lp *= s;
      lp.y -= smoothstep(0.5, 0.95, f) * 1.4;
      vSpray = 0.5;
    } else if (role > 3.5) {
      // the lip, feathering on the crest and throwing forward
      float sc = smoothstep(0.24, 0.36, f) * (1.0 - smoothstep(0.45, 0.5, f));
      float a2 = 1.9 * smoothstep(0.33, 0.47, f);
      float c = cos(a2), s = sin(a2);
      lp *= sc * min(E / 4.2, 1.2);
      lp.z *= 1.0 / min(E / 4.2, 1.2);
      lp.xy = vec2(lp.x * c - lp.y * s, lp.x * s + lp.y * c);
      ln.xy = vec2(ln.x * c - ln.y * s, ln.x * s + ln.y * c);
      lp += vec3(mix(11.0, 0.8, a) - 0.4, SEA_Y + E * 0.96, 0.0);
    } else {
      // the rivulets: running back down through the cracks to the sea
      float k = clamp((f - 0.5) / 0.4, 0.0, 1.0);
      float head = k * 1.25;
      float on = step(0.5, f) * step(f, 0.92);
      lp.y = mix(-head, -head + 0.85, lp.y) * on;
      lp.xz *= on;
    }
  }
#endif
#if defined(SURGE) || defined(WASH) || defined(BREAKER)
  lp.x *= cSide;
  ln.x *= cSide;
  #ifdef OUTLINE
    lo.x *= cSide;
  #endif
#endif
#ifdef SEA
  {
    // The swell rolling in on the land from both sides (it's whichever way
    // is in from the open sea: under the causeway, where the two meet,
    // nothing shows). Three trains of it, slanting a little along the run,
    // their crests peaked, growing the further out; the strip is laid flat,
    // uv in metres (y along the run, from p0). p1: how far out the shore is
    // here (m from the middle of the road).
    vec2 sp = vec2(lp.x, uv.y + phase);
    float ax = abs(sp.x);
    float t = uTime;
    float env = mix(0.3, 1.0, smoothstep(5.0, 45.0, ax)) * (1.0 - smoothstep(170.0, 240.0, ax));
    vec3 ph = vec3(0.21 * ax + 0.0383495 * sp.y + 1.05 * t, 0.13 * ax - 0.0613592 * sp.y + 0.8 * t + 1.3, 0.37 * ax + 0.0981748 * sp.y + 1.6 * t + 2.1);
    vec3 A = vec3(0.5, 0.42, 0.14) * env;
    vec3 s = sin(ph);
    vec3 c = cos(ph);
    // (peaked: a crest is sharper than a trough is deep)
    vec3 pk = s + 0.35 * s * s - 0.175;
    float h = dot(A, pk);
    vec3 dpk = c * (1.0 + 0.7 * s);
    float sx = sp.x < 0.0 ? -1.0 : 1.0;
    float dhx = dot(A * dpk, vec3(0.21, 0.13, 0.37)) * sx;
    float dhy = dot(A * dpk, vec3(0.0383495, -0.0613592, 0.0981748));
    lp.y += h;
    // (the strip's local -z is further along the run)
    ln = normalize(vec3(-dhx, 1.0, dhy));
    vSea = vec4(h / max(dot(A, vec3(1.0)), 0.05), ax - sgn, sp);
  }
#endif
`;

// --- vertex: in the world (after it's placed) ------------------------------------
export const COAST_VS_WORLD = /* glsl */ `
#ifdef WIND
  {
    // Bent by the wind: the higher up the blade, the further (its foot
    // hardly moves); how far by the gusts running over the field where it
    // stands, and a flutter of its own on top.
    // (or, hung from something - a rope's end, a net's edge, torn sail -
    // the further below where it hangs from, uWindK.w)
    float sy = length(M[1].xyz);
    float hgt = uWindK.w > 0.5 ? max(uWindK.z - lp.y, 0.0) * sy : max(lp.y * sy - uWindK.z, 0.0);
    float g = gustAt(pivot.xz + (wp.xz - pivot.xz) * 0.3);
    float k = hgt * hgt * uWindK.x;
    float fl = (sin(uTime * 6.1 + phase * 7.0 + hgt * 2.5) * 0.6 + sin(uTime * 9.3 + wp.x * 1.7 + wp.z * 1.3) * 0.4) * uWindK.y;
    float bend = k * (g + fl);
    wp.xz += uWind.xy * bend;
    // (and it bows, rather than stretching: a blade down, a hanging thing up)
    wp.y -= min(bend * bend / max(2.0 * hgt, 0.2), hgt * 0.6) * (uWindK.w > 0.5 ? -1.0 : 1.0);
    vWind = g * smoothstep(0.0, 0.6, hgt);
  }
#endif
`;

// --- vertex: a long thing that should stay straight on screen ------------------
// (a lighthouse's beam, reaching from the far headland right over the road:
// it's laid out as it will look after the world's bend, so it doesn't bow)
export const UNBEND_VS = /* glsl */ `
#ifdef UNBEND
  {
    float d0 = clamp(uCamPos.z - pivot.z - uBend.w, 0.0, 320.0);
    float d1 = clamp(uCamPos.z - wp.z - uBend.w, 0.0, 320.0);
    wp.y += uBend.x * (d1 * d1 - d0 * d0);
  }
#endif
`;

// --- fragment: declarations --------------------------------------------------------
export const COAST_FS_HEAD = /* glsl */ `
` + COAST_COMMON + /* glsl */ `
#ifdef COAST
// a tidal cut's opening (parts marked 0.43; uv in metres, y from its near
// lip to its far one): x its length along the run, y how deep the water lies
uniform vec4 uCut;
// how wet the ground is here (the ground patterns set it): it gives back
// the sky, and the lantern's warm light streaked down it toward you
float gWet = 0.0;
// The sky and the lantern in something wet (a puddle, wet stone, the sea),
// lying flat (or along n).
vec3 wetLight(vec3 col, vec3 V, vec3 n, float wet, float rough) {
  vec3 r = reflect(V, n);
  // (what it gives back is the low sky, the bright band over the horizon,
  // as rippled water does)
  vec3 rs = normalize(vec3(r.x, r.y * 0.3, r.z));
  float fr = 0.3 + 0.7 * pow(1.0 - abs(dot(V, n)), 3.0);
  col = mix(col, mix(skyColor(rs), col, 0.3) * 1.04, clamp(wet * fr * 0.7 + smoothstep(0.6, 1.0, wet) * 0.25, 0.0, 0.8));
  vec3 toL = uBeacon.xyz - vPos;
  vec2 hl = normalize(toL.xz);
  vec2 hr = normalize(r.xz + vec2(0.0, 1e-5));
  float az = dot(hl, hr);
  float el = abs(normalize(toL).y - r.y);
  float streak = smoothstep(1.0 - 0.0016 * rough, 1.0 - 0.0001, az) * (1.0 - smoothstep(0.04, 0.4 + 0.3 * rough, el));
  // (broken up by the ripples on it)
  float brk = texture2D(uNoise, vPos.xz * vec2(0.5, 0.25) + vec2(0.0, uTime * 0.05)).g;
  return col + BEACON_COL * streak * wet * wet * smoothstep(0.35, 0.65, brk) * 0.7;
}
#endif
#ifdef WIND
varying float vWind;
#endif
#ifdef SEA
varying vec4 vSea;
#endif
#if defined(SURGE) || defined(WASH) || defined(BREAKER)
varying float vSpray;
#endif
`;

// --- fragment: which surface (after the other mark flags are read) --------------
export const COAST_FS_CODES = /* glsl */ `
  #ifdef COAST
    float isFoam = step(abs(vFx.x - 0.13), 0.02);
    float isWave = step(abs(vFx.x - 0.23), 0.02);
    float isWet = step(abs(vFx.x - 0.33), 0.02);
    float isCut = step(abs(vFx.x - 0.43), 0.02);
    markK *= 1.0 - max(max(isFoam, isWave), isCut);
  #endif
`;

// --- fragment: the base colour (before it's lit) ----------------------------------
export const COAST_FS_BASE = /* glsl */ `
  #ifdef COAST
    if (isFoam > 0.0) {
      // foam: churning white, blue-grey where it's thinner, the bubbles in
      // it crawling
      float f1 = texture2D(uNoise, vPos.xz * 0.34375 + vec2(vPos.y * 0.25, -uTime * 0.35)).g;
      float f2 = texture2D(uNoise, vec2(vPos.x + vPos.z, vPos.y) * 0.59375 + vec2(uTime * 0.21, -uTime * 0.5)).g;
      float fm = smoothstep(0.28, 0.72, f1 * 0.6 + f2 * 0.4);
      base = mix(vec3(0.66, 0.76, 0.82), vec3(0.95, 0.97, 0.98), fm) * mix(vec3(1.0), vColor, 0.15);
    }
    if (isWave > 0.0) {
      // the body of a wave: slate and denim, paler and greener toward its
      // crest where the light comes through it, streaked as it runs
      float st = texture2D(uNoise, vec2((vPos.x + vPos.z) * 0.15625, vPos.y * 0.28 - uTime * 0.22)).g;
      // (how far up the wave: its parts are painted black at the foot to
      // white at the crest)
      float up = vColor.r;
      base = mix(vec3(0.07, 0.13, 0.19), vec3(0.17, 0.3, 0.36), up) * (0.88 + 0.26 * st);
      // white water streaming off its crest
      float crest = smoothstep(0.55, 0.95, up);
      base = mix(base, vec3(0.84, 0.9, 0.93), smoothstep(0.55, 0.75, st + crest * 0.35) * crest * 0.85);
    }
    #ifdef WIND
      // a gust running through the grass turns up the pale undersides of
      // the blades: silver bands rippling across the field
      base = mix(base, base * 1.3 + vec3(0.07, 0.09, 0.1), smoothstep(0.7, 1.55, vWind) * 0.65);
    #endif
  #endif
`;

// --- fragment: once lit -------------------------------------------------------------
export const COAST_FS_LIGHT = /* glsl */ `
  #ifdef COAST
  {
    float bk = beaconAt(vPos);
    #ifdef SEA
      {
        // the open sea: deep denim in the troughs, slate-teal up the swells,
        // the sky in it toward the horizon; foam breaking along the crests
        // and lacing white along the shore, the sky and the lantern in it,
        // and the beam glittering on it as it sweeps by
        float h = vSea.x;
        vec2 sp = vSea.zw;
        vec3 deep = vec3(0.075, 0.13, 0.2);
        vec3 body = mix(deep, vec3(0.15, 0.26, 0.32), smoothstep(-0.7, 0.4, h));
        body = mix(body, vec3(0.24, 0.4, 0.44), smoothstep(0.35, 0.95, h));
        float fr = 0.05 + 0.5 * pow(1.0 - max(dot(n, -V), 0.0), 5.0);
        vec3 sky = skyColor(reflect(V, n));
        col = mix(body * mix(shade, vec3(1.0), 0.5), sky, fr);
        float t = uTime;
        float n1 = texture2D(uNoise, sp * vec2(0.046875, 0.0625) + vec2(t * 0.012, t * 0.02)).g;
        float n2 = texture2D(uNoise, sp * vec2(0.140625, 0.1875) + vec2(-t * 0.03, t * 0.017)).g;
        float cap = smoothstep(0.78, 0.98, h + (n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.3) * smoothstep(8.0, 25.0, vSea.y);
        // the shore: lace drawn in and out with the swell, solid white
        // right against the rocks
        float off = vSea.y;
        float surge = 0.5 + 0.5 * sin(t * 1.05 + sp.y * 0.0383495 + 0.4);
        float band = 1.0 - smoothstep(0.0, 6.0 + 3.0 * surge, off);
        float lace = smoothstep(0.42, 0.62, n2 * 0.7 + n1 * 0.3 + band * 0.35) * band;
        float solid = 1.0 - smoothstep(0.0, 1.4 + 1.6 * surge, off);
        float foam = max(max(cap * 0.85, lace), solid);
        float far = smoothstep(60.0, 200.0, dist);
        foam *= 1.0 - far * 0.6;
        col = mix(col, vec3(0.86, 0.91, 0.94) * mix(shade, vec3(1.0), 0.7), foam);
        // glitter: the ripples catching the sky
        float gl = smoothstep(0.83, 0.9, n2 * 0.6 + n1 * 0.5) * (1.0 - foam) * (1.0 - far);
        col += vec3(0.5, 0.62, 0.78) * gl * 0.12;
        // the lantern laid down the water toward you in a broken streak
        col = wetLight(col, V, normalize(n + vec3(n1 - 0.5, 0.0, n2 - 0.5) * 0.25), 0.9 * (1.0 - foam) * smoothstep(0.35, 0.5, n2 * 0.5 + n1 * 0.5 + 0.15), 3.0);
        col += BEACON_COL * bk * (0.16 + 0.7 * foam + 0.5 * gl);
        gKeep = max(gKeep, foam * 0.5);
      }
    #else
      #ifdef GROUND
        if (gWet > 0.0) col = wetLight(col, V, vec3(0.0, 1.0, 0.0), gWet, 1.0);
        col += BEACON_COL * bk * base * 0.3;
      #else
        if (isFoam > 0.0) {
          // foam holds the light: barely shaded, the beam lighting it up
          col = mix(col, base * mix(shade, vec3(1.0), 0.7), 0.75);
          col += BEACON_COL * bk * (0.5 + 1.5 * uBeacon2.w);
        }
        if (isWave > 0.0) {
          float fr = pow(1.0 - abs(dot(n, V)), 3.0);
          col = mix(col, skyColor(reflect(V, n)), 0.1 + fr * 0.5);
          col += BEACON_COL * bk * 0.22;
        }
        if (isWet > 0.0) {
          // wet stone: the sky caught on its edges, pale and cold
          float fr = pow(1.0 - abs(dot(n, V)), 2.5);
          col += vec3(0.42, 0.56, 0.7) * fr * 0.45;
          col = wetLight(col, V, n, 0.35, 2.0);
        }
        col += BEACON_COL * bk * base * 0.6 * (1.0 - isFoam);
        #if defined(SURGE) || defined(WASH) || defined(BREAKER)
          // the spray flung up into the beam lights up warm
          col += BEACON_COL * bk * vSpray * (0.9 + 4.0 * uBeacon2.w);
        #endif
      #endif
    #endif
    if (isCut > 0.0) {
      // A tidal cut through the causeway (a flat opening across it, uv in
      // metres from its near lip): what shows is worked out from where the
      // eye's ray would land inside - the far wall, pale wet stone at its
      // lip darkening down into the gap, or the sea rushing through below,
      // white with foam - so the gap reads as a gap from far off, a bright
      // line at each edge.
      float W = uCut.x;
      float s0 = clamp(vUv.y, 0.0, W);
      float fz = max(-V.z, 0.05);
      float dn = max(-V.y, 0.02);
      float Dw = uCut.y + 0.3 * sin(uTime * 1.4 + vPos.x * 0.3);
      float tau = (W - s0) / fz;
      float dep = dn * tau;
      vec3 cc;
      if (dep < Dw) {
        float wn = texture2D(uNoise, vec2((vPos.x + V.x * tau) * 0.25, dep * 0.3)).g;
        cc = mix(vec3(0.5, 0.58, 0.64), vec3(0.16, 0.2, 0.25), smoothstep(0.0, 0.22, dep));
        cc = mix(cc, vec3(0.05, 0.07, 0.1), smoothstep(0.3, 1.6, dep));
        cc *= 0.8 + 0.4 * wn;
        // the far wall wet, glistening in streaks
        cc += vec3(0.3, 0.4, 0.5) * smoothstep(0.72, 0.8, wn) * 0.3;
      } else {
        float tw = Dw / dn;
        vec2 q = vec2(vPos.x + V.x * tw, s0 + fz * tw);
        float f1 = texture2D(uNoise, vec2(q.x * 0.1875 - uTime * 0.85, q.y * 0.5)).g;
        float f2 = texture2D(uNoise, vec2(q.x * 0.375 - uTime * 1.6, q.y * 0.875 + 0.3)).g;
        float foam = smoothstep(0.38, 0.66, f1 * 0.6 + f2 * 0.5);
        cc = mix(vec3(0.1, 0.2, 0.26), vec3(0.82, 0.88, 0.92), foam);
        // (in the shadow of the near wall, further down)
        cc *= 0.8 + 0.2 * smoothstep(0.0, 1.0, q.y / W);
        cc += BEACON_COL * bk * foam * 0.6;
      }
      // the lips, pale wet stone
      float aa = fwidth(vUv.y) * 1.5 + 0.01;
      float lip = 1.0 - smoothstep(0.08, 0.08 + aa, min(vUv.y, W - vUv.y));
      cc = mix(cc, vec3(0.62, 0.7, 0.76), lip * 0.85);
      col = cc * mix(uShadowTint, vec3(1.0), 0.8);
      gEmit = max(gEmit, 0.35);
    }
  }
  #endif
`;

// --- the ground ---------------------------------------------------------------------
// (spliced into groundColor; p.x across the road, p.y along it - the track
// distance, wrapping at 4096 m - and every period along it divides that)
export const COAST_GROUND = /* glsl */ `
  #elif GROUND == 18
    // The coastal path through the grass: packed earth and grit worn into
    // three paler tracks, grass growing up the ridges between them,
    // puddles standing in the hollows; its edge ragged into the field.
    // The field: sage and slate-green in drifts, combed along the wind,
    // the gusts paling it in silver bands as they run over it (the same
    // gusts the long grass bends to). Below the brow on the seaward side,
    // dark rock.
    float ax = abs(p.x);
    float n1 = texture2D(uNoise, p * 0.03125).g;
    float n2 = texture2D(uNoise, p * 0.125 + 0.3).g;
    float n3 = texture2D(uNoise, p * vec2(0.5, 0.25) + 0.71).g;
    float edge = 4.25 + (n1 - 0.5) * 1.2 + (n2 - 0.5) * 0.4;
    float pat = texture2D(uNoise, p * 0.0078125 + 0.61).g;
    vec3 field = mix(vec3(0.15, 0.25, 0.25), vec3(0.33, 0.43, 0.4), smoothstep(0.3, 0.75, pat * 0.7 + n2 * 0.3));
    float comb = texture2D(uNoise, vec2(p.x * 0.6 + p.y * 0.35, p.y * 0.0625 - p.x * 0.05)).g;
    field *= 0.88 + 0.22 * comb * (1.0 - far);
    // straw-pale seed heads in drifts
    field = mix(field, vec3(0.52, 0.53, 0.47), smoothstep(0.66, 0.8, n1 * 0.5 + pat * 0.5) * 0.35);
    float gs = gustAt(vPos.xz);
    field = mix(field, field * 1.35 + vec3(0.08, 0.1, 0.11), smoothstep(0.75, 1.6, gs) * 0.6);
    // rock below the brow
    float rockN = texture2D(uNoise, p * 0.25 + 0.13).g;
    vec3 rock = mix(vec3(0.1, 0.12, 0.15), vec3(0.24, 0.28, 0.32), rockN);
    field = mix(field, rock, smoothstep(-0.3, -0.9, vPos.y + (rockN - 0.5) * 0.6));
    // the path
    float lx = abs(p.x - 2.4 * floor(p.x / 2.4 + 0.5));
    float worn = 1.0 - smoothstep(0.35, 0.95, lx);
    vec3 path = mix(uGroundA, uGroundB, n2 * 0.7 + n3 * 0.3);
    path = mix(path, uGroundA * 1.12, worn * 0.55);
    float ridge = smoothstep(0.85, 1.15, lx) * smoothstep(0.45, 0.7, n3);
    path = mix(path, vec3(0.22, 0.3, 0.29), ridge * 0.6 * (1.0 - far));
    // grit and small stones, soft-edged
    float gn = texture2D(uNoise, p * vec2(0.6875, 0.4375) + 0.19).g * 0.6 + texture2D(uNoise, p * vec2(0.21875, 0.1875) + 0.47).g * 0.4;
    path = mix(path, uGroundC, smoothstep(0.55, 0.8, gn) * 0.22 * (1.0 - far));
    path = mix(path, uGroundA * 1.25, smoothstep(0.74, 0.86, n3) * 0.25 * (1.0 - far));
    float pd = texture2D(uNoise, p * vec2(0.34375, 0.25) + 0.17).g;
    float puddle = smoothstep(0.75, 0.79, pd + worn * 0.06) * (1.0 - smoothstep(3.6, 4.0, ax));
    path = mix(path, path * 0.8, puddle);
    float on = 1.0 - smoothstep(edge - 0.3, edge + 0.3, ax);
    gWet = puddle * on;
    vec3 c = mix(field, path, on);
    return mix(c, mix(vec3(0.25, 0.33, 0.33), uGroundB, on), far * 0.4);
  #elif GROUND == 19
    // The causeway: big dark slabs laid in three runs, their joints along
    // the lane lines; worn paler down the middle of each run, weed dark in
    // the joints, wet all over and standing in puddles in the hollows.
    float ax = abs(p.x);
    float run = floor((p.x + 4.8) / 2.4);
    float off = hash12(vec2(run, 7.0)) * 3.0;
    float L = 1.6;
    float q = (p.y + off) / L;
    float row = floor(q);
    float h = hash12(vec2(run, row) + 3.0);
    vec2 f = vec2(fract((p.x + 4.8) / 2.4), fract(q));
    float m = mix(edgeMaskRun(f, vec2(2.4, L), 0.04), 1.0, far * 0.8);
    vec3 c = mix(uGroundA, uGroundB, h) * vec3(0.6, 0.64, 0.68) * (0.9 + 0.2 * texture2D(uNoise, p * 0.1875 + 0.4).g);
    float worn = 1.0 - smoothstep(0.25, 0.48, abs(f.x - 0.5));
    c = mix(c, c * 1.18 + 0.02, worn * 0.4);
    c = mix(mix(vec3(0.06, 0.1, 0.1), uGroundC, 0.5), c, m);
    float pd = texture2D(uNoise, p * vec2(0.40625, 0.25) + 0.53).g;
    float puddle = smoothstep(0.72, 0.76, pd + h * 0.05);
    c = mix(c, c * 0.8, puddle);
    // the sea's left a scum of foam in the joints by the edges
    float scum = (1.0 - m) * smoothstep(3.0, 4.6, ax) * smoothstep(0.55, 0.7, pd);
    c = mix(c, vec3(0.7, 0.78, 0.82), scum * 0.6 * (1.0 - far));
    gWet = 0.32 + 0.68 * puddle + 0.2 * (1.0 - m);
    return mix(c, mix(uGroundA, uGroundB, 0.5), far * 0.5);
  #elif GROUND == 20
    // The fishing landing: a stretch of grey boards (laid along the run,
    // butt-jointed, nail heads rusting), then a stretch of old setts, in
    // turn; a capstone edge along the quay on the seaward side.
    float ax = abs(p.x);
    float sec = floor(p.y / 32.0);
    float boards = step(0.45, hash12(vec2(sec, 4.0)));
    float n1 = texture2D(uNoise, p * vec2(0.25, 0.0625)).g;
    vec3 c;
    if (boards > 0.5) {
      float bw = 0.3;
      float bi = floor(p.x / bw);
      float fx = fract(p.x / bw);
      float len = 3.2;
      float bo = hash12(vec2(bi, 1.0)) * len;
      float q = (p.y + bo) / len;
      float bj = floor(q);
      float h = hash12(vec2(bi, bj));
      c = mix(uGroundB * 1.05, uGroundA * 1.1, h) * (0.88 + 0.24 * n1);
      float aa = fwidth(p.x / bw) * 1.2;
      float gap = 1.0 - smoothstep(0.04, 0.04 + aa, min(fx, 1.0 - fx));
      float fy = fract(q) * len;
      float butt = runLine(min(fy, len - fy), 0.02, fwidth(p.y) * 1.2);
      // grain along the board
      float gr = texture2D(uNoise, vec2(p.x * 2.0, p.y * 0.125)).g;
      c *= 0.92 + 0.14 * gr;
      c = mix(c, uGroundC, max(gap, butt) * (1.0 - far * 0.8));
      gWet = 0.12;
    } else {
      vec2 cs = vec2(0.42, 0.3);
      vec2 q = p / cs;
      q.x += mod(floor(q.y), 2.0) * 0.5;
      vec2 cell = floor(q);
      float h = hash12(cell + 9.0);
      c = mix(vec3(0.26, 0.3, 0.34), vec3(0.4, 0.44, 0.47), h);
      c = mix(mix(uGroundC, c, 0.3), c, mix(edgeMaskRun(fract(q), cs, 0.03), 1.0, far * 0.8));
      float pd = texture2D(uNoise, p * vec2(0.15, 0.125) + 0.37).g;
      float puddle = smoothstep(0.62, 0.66, pd);
      c = mix(c, vec3(0.08, 0.11, 0.15), puddle * 0.7);
      gWet = 0.2 + 0.8 * puddle;
    }
    // the kerb where the stretches meet
    float sy = abs(p.y - 32.0 * floor(p.y / 32.0 + 0.5));
    float kerb = runLine(sy, 0.16, fwidth(p.y) * 1.2);
    c = mix(c, vec3(0.36, 0.4, 0.44), kerb);
    // the quay's capstones along the seaward edge
    float cap = smoothstep(5.0, 5.08, p.x);
    c = mix(c, vec3(0.42, 0.46, 0.5) * (0.85 + 0.3 * n1), cap);
    return mix(c, mix(uGroundA, uGroundB, 0.5), far * 0.5);
`;
