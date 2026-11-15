// Candy World's shaders, spliced into the object shaders (see shaders.js):
//
//   toon option bend    a stretch of the chocolate river (or its banks), built
//                       straight and bent along its arc on the GPU (BEND_VS)
//   toon option choco   its surface: thick melted chocolate, flowing
//                       (CHOCO_FS)
//   toon option candy   what sweets are made of, part by part (CANDY_FS): a
//                       part's mark flag picks it (see CANDY in world/candy.js)
//   ground pattern 17   the biscuit-and-wafer road (BISCUIT_GROUND)
//
// Everything keyed on where a fragment is in the world (vPos) is scaled by a
// multiple of 1/512 and hashed over a period that divides 512, so nothing
// jumps when the world re-bases.

// --- the river, bent ------------------------------------------------------------
// The piece's arc and banks are laid out exactly as world/river.js lays them
// (riverWob there is this one, line for line), so what you see of a bank is
// where the game has it.
export const BEND_VS_HEAD = /* glsl */ `
#ifdef BEND
// A stretch of the chocolate river (see world/river.js): built along +x from
// 0 to 1 (its length, aInst.z m), across z - |z| <= 1 the surface, bank to
// bank, as a share of the half-width; |z| >= 5 a bank, |z| - 10 m out from the
// edge of the chocolate. aInst.y is the curvature of its arc (+ turning left),
// aInst.x how far along the river it starts; instanceColor its half-width at
// the start and the end (r, g) and which way it flows (b, +1 or -1).
varying vec4 vRiver; // x how far along the river (m), y across it (m), z across it bank to bank (-1..1), w which way it flows
varying vec3 vRiverT; // which way the river runs here, in the world
float riverWob(float u, float side) {
  return 0.17 * sin(u * 0.83 + side * 1.7 + 0.3) + 0.1 * sin(u * 2.17 + side * 0.6 + 1.1) + 0.05 * sin(u * 4.9 + side * 2.3);
}
#endif
`;

export const BEND_VS_MAIN = /* glsl */ `
  #ifdef BEND
    {
      float len = aInst.z;
      float k = aInst.y;
      float s = lp.x * len;
      float u = aInst.x + s;
      float side = lp.z < 0.0 ? -1.0 : 1.0;
      float t = clamp(lp.x, 0.0, 1.0);
      t = t * t * (3.0 - 2.0 * t);
      vec3 ic = vec3(1.0);
      #ifdef USE_INSTANCING_COLOR
        ic = instanceColor;
      #endif
      float hw = mix(ic.r, ic.g, t) + riverWob(u, side);
      float az = abs(lp.z);
      float bank = step(5.0, az);
      float n = mix(lp.z * hw, side * (hw + az - 10.0), bank);
      vRiver = vec4(u, n, mix(lp.z, side * (1.0 + (az - 10.0) / max(hw, 0.3)), bank), ic.b);
      float a = k * s;
      float ca = cos(a), sa = sin(a);
      vec2 c = abs(k) > 1e-4 ? vec2(sa / k, -(1.0 - ca) / k) : vec2(s, -0.5 * k * s * s);
      lp = vec3(c.x + n * sa, lp.y, c.y + n * ca);
      ln = rotY(ln, a);
      #ifdef OUTLINE
        lo = rotY(lo, a);
      #endif
      vRiverT = normalize(mat3(M) * vec3(ca, 0.0, -sa));
    }
  #endif
`;

// --- the chocolate ----------------------------------------------------------------
export const CHOCO_FS = /* glsl */ `
#ifdef BEND
varying vec4 vRiver;
varying vec3 vRiverT;
#endif
#ifdef CHOCO
// The chocolate's surface height (0..1-ish) at q (x downstream, y across, m):
// broad slow swells, and a ripple rolling across them, wavering.
float chocoH(vec2 q) {
  float n1 = texture2D(uNoise, q * vec2(0.055, 0.14)).g;
  float n2 = texture2D(uNoise, q * vec2(0.17, 0.33) + 0.37).g;
  float r = sin(q.x * 2.6 + n1 * 8.0 + q.y * 0.45);
  return n1 * 0.62 + n2 * 0.38 + r * (0.12 + 0.08 * n2);
}
float chocoHash(float x) {
  return fract(sin(x * 91.3458) * 47453.5453);
}
vec3 chocolateRiver(vec3 V, float dist) {
  float flow = vRiver.w;
  float u = vRiver.x * flow; // downstream
  float w = vRiver.y;
  float a = clamp(vRiver.z, -1.0, 1.0);
  float side = a < 0.0 ? -1.0 : 1.0;
  float t = uTime;
  // It flows quicker mid-stream than by the banks. The surface is carried
  // downstream in two staggered phases, each blended out just as it starts
  // over, so the shear never tears it apart.
  float prof = 1.0 - 0.6 * a * a;
  float sp = 0.85;
  float T = 6.0;
  float f1 = fract(t / T);
  float f2 = fract(t / T + 0.5);
  float k2 = abs(f1 - 0.5) * 2.0;
  vec2 o1 = vec2(-sp * prof * f1 * T, 0.0);
  vec2 o2 = vec2(-sp * prof * f2 * T + 7.3, 2.1);
  vec2 q = vec2(u, w);
  const float e = 0.12;
  float h0 = mix(chocoH(q + o1), chocoH(q + o2), k2);
  float hu = mix(chocoH(q + o1 + vec2(e, 0.0)), chocoH(q + o2 + vec2(e, 0.0)), k2);
  float hw = mix(chocoH(q + o1 + vec2(0.0, e)), chocoH(q + o2 + vec2(0.0, e)), k2);
  // marbling: streaks of milk chocolate drawn out long by the current
  float m1 = texture2D(uNoise, (q + o1) * vec2(0.07, 0.34) + 0.61).g;
  float m2 = texture2D(uNoise, (q + o2) * vec2(0.07, 0.34) + 0.61).g;
  float mb = mix(m1, m2, k2);
  float fw = fwidth(mb) + 0.004;
  float streak = 1.0 - smoothstep(0.012, 0.012 + fw * 1.5, abs(mb - 0.56));
  streak += 0.5 * (1.0 - smoothstep(0.008, 0.008 + fw * 1.5, abs(mb - 0.43)));

  // Eddies: slow whirls sitting in the slack water by each bank, one every
  // few metres, turning against the stream; they wind the marbling into
  // spirals and dimple the surface.
  float cellL = 4.6;
  float ci = floor(vRiver.x / cellL);
  float eh = chocoHash(ci * 1.7 + side * 13.1);
  float uc = (ci + 0.5 + (eh - 0.5) * 0.5) * cellL;
  vec2 ed = vec2(vRiver.x - uc, (a - side * 0.52) * 1.45);
  float er = length(ed);
  float present = step(0.3, eh);
  float spin = side * flow * (eh > 0.65 ? 1.0 : 0.7);
  float ang = atan(ed.y, ed.x);
  float arm = sin(ang * 2.0 + er * 3.6 - t * 1.1 * spin);
  float ek = (1.0 - smoothstep(0.35, 1.55, er)) * smoothstep(0.04, 0.3, er) * present;
  float swirl = smoothstep(0.55, 0.95, arm) * ek;
  float dimple = (1.0 - smoothstep(0.0, 0.45, er)) * present;
  h0 += arm * ek * 0.08 - dimple * 0.12;

  // the surface's normal, from the swells (in the world: along the river and across it)
  vec3 T3 = normalize(vRiverT) * flow;
  vec3 R3 = vec3(-T3.z, 0.0, T3.x);
  float bump = 0.95;
  vec3 N = normalize(vec3(0.0, 1.0, 0.0) - bump * ((hu - h0) / e * T3 + (hw - h0) / e * R3) * 0.12);

  // bubbles: carried along with the stream, here and there one swells up,
  // glossy, and pops
  vec2 bq = vec2(u - sp * 0.7 * t, w) * vec2(0.62, 1.1);
  vec2 bc = floor(bq);
  float bh = chocoHash(bc.x * 3.1 + bc.y * 17.7 + 0.5);
  float bt = fract(t * (0.16 + bh * 0.14) + bh * 5.0);
  vec2 bo = vec2(chocoHash(bc.x + bc.y * 7.0 + 2.1), chocoHash(bc.x * 5.0 + bc.y + 4.2)) * 0.5 + 0.25;
  vec2 bd2 = (fract(bq) - bo) / vec2(0.62, 1.1);
  float bdist = length(bd2);
  float on = step(0.72, bh) * (1.0 - smoothstep(0.82, 0.86, abs(a)));
  float br = 0.17 * smoothstep(0.0, 0.78, bt) * on;
  float baa = fwidth(bdist) + 0.002;
  float dome = (1.0 - smoothstep(br - baa, br + baa, bdist)) * step(bt, 0.84);
  float pop = smoothstep(0.84, 0.88, bt) * (1.0 - smoothstep(0.88, 0.97, bt)) * on;
  float ring = pop * (1.0 - smoothstep(0.0, 0.025 + baa, abs(bdist - 0.2 * (bt - 0.7) * 3.0)));
  vec3 bn = normalize(vec3(bd2.x, 0.0, bd2.y) * 0.0 + N);
  if (dome > 0.0) {
    // the bubble's own round normal
    vec2 dl = bd2 / max(br, 1e-3);
    float hz = sqrt(max(1.0 - dot(dl, dl), 0.0));
    bn = normalize(dl.x * T3 + dl.y * R3 + vec3(0.0, 1.0, 0.0) * (hz + 0.2));
    N = normalize(mix(N, bn, dome));
  }

  // its colour: deep and dark in the troughs, warmer on the swells, the
  // marbling milk chocolate, a little thicker and lighter where it laps at
  // the banks, a dark line where it meets them
  vec3 dark = vec3(0.2, 0.085, 0.035);
  vec3 midc = vec3(0.36, 0.17, 0.075);
  vec3 lite = vec3(0.5, 0.27, 0.12);
  vec3 milk = vec3(0.74, 0.5, 0.3);
  float hh = clamp(h0, 0.0, 1.0);
  vec3 c = mix(dark, midc, smoothstep(0.25, 0.55, hh));
  c = mix(c, lite, smoothstep(0.55, 0.82, hh) * 0.9);
  float near = 1.0 - smoothstep(0.0, 0.5, fwidth(vRiver.x) * 3.0);
  c = mix(c, milk, clamp(streak * 0.55 + swirl * 0.6, 0.0, 0.85) * (0.4 + 0.6 * near));
  float edge = smoothstep(0.72, 0.95, abs(a));
  c = mix(c, lite * 1.08, edge * 0.55);
  c *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.05, abs(abs(a) - 0.985)));
  c = mix(c, lite * 1.15, dome * 0.35);

  // light: soft and warm, the swells catching it; long glossy highlights
  // moving with the swells, and the sky in it at a glance
  float ndl = dot(N, uLightDir);
  float lit = smoothstep(-0.25, 0.45, ndl);
  vec3 col = c * mix(mix(uShadowTint, vec3(1.0), 0.55), vec3(1.08), lit);
  vec3 rf = reflect(V, N);
  float rl = max(dot(rf, uLightDir), 0.0);
  float spec = pow(rl, 80.0) * 1.6 + pow(rl, 22.0) * 0.45 + pow(rl, 6.0) * 0.12;
  // (and the soft light of the open sky over it: the swells that turn up
  // toward you catch a glossy sheen whatever the sun is doing)
  float sheen = pow(max(dot(N, normalize(-V + vec3(0.0, 1.4, 0.0))), 0.0), 36.0);
  spec += sheen * 0.55;
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);
  vec3 sky = skyColor(rf);
  col = mix(col, sky * vec3(1.0, 0.86, 0.74) * 0.75, 0.08 + 0.32 * fres);
  col += mix(uHiTint, vec3(1.0, 0.96, 0.9), 0.6) * spec * (0.6 + 0.4 * near);
  col += vec3(1.0, 0.95, 0.88) * (ring * 0.5 + dome * pow(rl, 24.0) * 0.8);
  return col;
}
#endif
`;

// --- what sweets are made of ------------------------------------------------------
// A part's mark flag (fx.x, 0.10 to 0.56 in steps of 0.02) picks its stuff;
// see CANDY in world/candy.js for the list. Worked out in two steps: the
// surface (candySurface: its colour, texture and relief, before it's lit) and
// its light (candyLight: gloss, sparkle, light through it, after).
export const CANDY_FS = /* glsl */ `
#ifdef CANDY
float cId = -1.0;
float cSpec = 0.0;  // the sharp highlight
float cPow = 40.0;  // its sharpness
float cBroad = 0.0; // a soft broad sheen
float cFres = 0.0;  // the sky caught at a glance
float cTrans = 0.0; // light through it (gummies, boiled sweets, caramel)
float cSpark = 0.0; // sugar glitter
float cSoft = 0.0;  // softer shadows (frosting, marshmallow)
vec3 cSparkN = vec3(0.0, 1.0, 0.0);
vec3 cHash3(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
float cHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
// (wrapped over a period that divides the re-base, so cells keep their dice)
vec2 cWrap(vec2 c) {
  return mod(c, 256.0);
}
float cTri(vec3 p, vec3 an) {
  return texture2D(uNoise, p.yz).g * an.x + texture2D(uNoise, p.xz).g * an.y + texture2D(uNoise, p.xy).g * an.z;
}
vec2 cPlane(vec3 p, vec3 an) {
  return an.x > max(an.y, an.z) ? p.zy : (an.y > an.z ? p.xz : p.xy);
}
// the colours sprinkles come in
vec3 sprinkleCol(float h) {
  if (h < 0.15) return vec3(1.0, 0.42, 0.66);
  if (h < 0.3) return vec3(1.0, 0.85, 0.3);
  if (h < 0.45) return vec3(0.42, 0.78, 1.0);
  if (h < 0.58) return vec3(0.45, 0.9, 0.66);
  if (h < 0.7) return vec3(1.0, 0.98, 0.95);
  if (h < 0.84) return vec3(1.0, 0.6, 0.3);
  return vec3(0.72, 0.56, 1.0);
}
// rod-shaped sprinkles scattered over a surface (q in cells, density 0..1)
vec4 sprinkles(vec2 q, float density) {
  vec2 c = floor(q);
  vec3 h = cHash3(cWrap(c) + 11.0);
  vec2 f = fract(q) - 0.5 - (h.yz - 0.5) * 0.36;
  float an = h.x * 6.2832;
  vec2 r = vec2(cos(an) * f.x + sin(an) * f.y, -sin(an) * f.x + cos(an) * f.y);
  float d = length(vec2(max(abs(r.x) - 0.2, 0.0), r.y));
  float aa = fwidth(q.x) * 1.2 + 0.005;
  float on = (1.0 - smoothstep(0.075 - aa, 0.075 + aa, d)) * step(1.0 - density, fract(h.z * 7.13));
  // each one rounded in the light
  float rr = clamp(r.y / 0.075, -1.0, 1.0);
  return vec4(sprinkleCol(fract(h.y * 3.7 + h.x)) * (1.08 - 0.25 * rr * rr), on);
}
float spinStripe(float x, float w, float aa) {
  float f = abs(fract(x) - 0.5);
  return 1.0 - smoothstep(w - aa, w + aa, f);
}

// a surface's stuff (id), before it's lit
void candySurface(inout vec3 base, inout vec3 n, vec3 V, float dist) {
  float id = floor((vFx.x - 0.1) / 0.02 + 0.5);
  cId = id;
  vec3 an = abs(n);
  an /= an.x + an.y + an.z;
  vec3 p = vPos;
  float px = length(fwidth(p)) + 1e-4; // metres a pixel
  vec2 pl = cPlane(p, an);
  if (id < 0.5) {
    // 0.10 SUGAR: a gumdrop's coat of coarse sugar - the jelly's colour
    // frosted over and paler, every grain its own shade, some catching the
    // light and glittering as you pass
    vec2 q = pl * 48.0;
    vec3 h = cHash3(cWrap(floor(q)));
    float fine = 1.0 - smoothstep(0.006, 0.02, px);
    float coat = cTri(p * 0.875, an);
    base = mix(base, vec3(1.0), 0.13 + 0.12 * coat);
    base *= mix(1.0, 0.86 + 0.28 * h.x, fine);
    vec2 g = fract(q) - 0.5;
    float grain = 1.0 - smoothstep(0.25, 0.5, length(g));
    cSpark = fine * step(0.6, h.y) * grain + (1.0 - fine) * 0.12;
    cSparkN = normalize(n + (h - 0.5) * 1.5);
    cTrans = 0.45;
    cSoft = 0.3;
    cBroad = 0.06;
  } else if (id < 1.5) {
    // 0.12 COOKIE: baked dough - lumpy and crumbly, toasted in patches, little
    // pits and cracks, a few grains of raw sugar
    float detail = 1.0 - smoothstep(0.01, 0.05, px);
    float n1 = cTri(p * 1.75, an);
    vec3 pp = p * 6.25 + 0.3;
    float n2 = cTri(pp, an);
    float n3 = cTri(p * 19.0 + 0.7, an);
    vec3 gr = vec3(cTri(pp + vec3(0.04, 0.0, 0.0), an), cTri(pp + vec3(0.0, 0.04, 0.0), an), cTri(pp + vec3(0.0, 0.0, 0.04), an)) - n2;
    n = normalize(n - gr * 9.0 * detail);
    base *= 0.84 + 0.28 * n2 + 0.16 * (n3 - 0.5) * detail;
    base = mix(base, base * vec3(0.7, 0.56, 0.45), smoothstep(0.55, 0.8, n1) * 0.5);
    vec2 q = pl * 14.0;
    vec3 h = cHash3(cWrap(floor(q)) + 7.0);
    float pit = (1.0 - smoothstep(0.08, 0.2, length(fract(q) - 0.25 - h.xy * 0.5))) * step(0.68, h.z) * detail;
    base *= 1.0 - pit * 0.5;
    float ck = cTri(p * 3.0 + 0.11, an);
    float cw = fwidth(ck) + 0.002;
    base *= 1.0 - 0.35 * (1.0 - smoothstep(0.004, 0.004 + cw, abs(ck - 0.5))) * smoothstep(0.45, 0.65, n1) * detail;
    vec2 q2 = pl * 40.0;
    vec3 h2 = cHash3(cWrap(floor(q2)) + 3.0);
    float sp = (1.0 - smoothstep(0.1, 0.3, length(fract(q2) - 0.5))) * step(0.87, h2.x) * (1.0 - smoothstep(0.004, 0.012, px));
    base = mix(base, vec3(1.0, 0.95, 0.84), sp * 0.75);
    cBroad = 0.04;
  } else if (id < 2.5) {
    // 0.14 CHOCOLATE: smooth and glossy, a faint bloom of lighter and darker
    base *= 0.93 + 0.14 * cTri(p * 2.25, an);
    cSpec = 1.0;
    cPow = 64.0;
    cBroad = 0.25;
    cFres = 0.22;
  } else if (id < 3.5) {
    // 0.16 GUMMY: jelly the light goes into - glowing through its thin edges,
    // never dark in its shade
    base *= 0.95 + 0.1 * cTri(p * 3.0, an);
    cTrans = 1.0;
    cSpec = 0.8;
    cPow = 40.0;
    cBroad = 0.28;
    cFres = 0.18;
    cSoft = 0.5;
  } else if (id < 4.5) {
    // 0.18 HARD candy: boiled sugar, clear as glass - swirled faintly inside,
    // a sharp white highlight and the sky caught in it
    base *= 0.92 + 0.16 * cTri(p * 1.5, an);
    cSpec = 1.15;
    cPow = 96.0;
    cFres = 0.4;
    cTrans = 0.5;
    cBroad = 0.1;
  } else if (id < 5.5) {
    // 0.20 CREAM: frosting, icing, whipped cream - satin, soft in its shade,
    // the faint ripple of where it was piped
    base *= 0.965 + 0.07 * cTri(p * 9.0, an);
    cSoft = 0.6;
    cBroad = 0.16;
    cSpec = 0.12;
    cPow = 14.0;
  } else if (id < 6.5) {
    // 0.22 WAFER: crisp, pressed in a grid of little squares, toasted gold
    vec2 q = pl * 9.0;
    vec2 f = fract(q);
    float aa = fwidth(q.x) + fwidth(q.y);
    float ed = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float detail = 1.0 - smoothstep(0.25, 0.6, aa);
    float groove = 1.0 - smoothstep(0.07, 0.07 + aa * 1.2, ed);
    float bevel = smoothstep(0.35, 0.0, f.y) * (1.0 - groove);
    base *= mix(0.97, (1.0 - groove * 0.3) * (1.0 + 0.07 * bevel), detail);
    base *= 0.94 + 0.12 * cTri(p * 24.0, an) * detail;
    cBroad = 0.05;
  } else if (id < 7.5) {
    // 0.24 GLAZE with SPRINKLES: a glossy glaze (a donut's, a cupcake's
    // icing) scattered all over with sprinkles
    vec4 s = sprinkles(pl * 22.0, 0.55);
    float detail = 1.0 - smoothstep(0.012, 0.03, px);
    base = mix(base, s.rgb, s.a * detail);
    base = mix(base, mix(base, vec3(0.85, 0.75, 0.8), 0.12), 1.0 - detail);
    cSpec = 0.6;
    cPow = 44.0;
    cBroad = 0.18;
    cFres = 0.15;
    cSoft = 0.25;
  } else if (id < 8.5) {
    // 0.26 ROCK candy: sugar grown into crystals - every facet its own tilt
    // and shade, flashing as it turns, the light deep in it
    vec3 q = p * 9.0;
    vec3 c = mod(floor(q), 256.0);
    vec3 h = vec3(cHash13(c), cHash13(c + 7.1), cHash13(c + 3.3));
    n = normalize(n + (h - 0.5) * 0.9);
    base *= 0.82 + 0.36 * h.x;
    cSpec = 1.2;
    cPow = 70.0;
    cTrans = 0.65;
    cSpark = 0.5;
    cSparkN = n;
    cFres = 0.3;
  } else if (id < 9.5) {
    // 0.28 CARAMEL: amber and glossy, the light glowing in it, streaked
    base *= 0.88 + 0.18 * cTri(p * vec3(1.0, 3.0, 1.0) * 2.0, an);
    cSpec = 0.85;
    cPow = 52.0;
    cTrans = 0.6;
    cBroad = 0.16;
    cFres = 0.22;
  } else if (id < 10.5) {
    // 0.30 MARSHMALLOW: powdery, matte, soft all over, dusted with starch
    float dust = cTri(p * 7.0, an);
    base = mix(base, vec3(1.0, 0.99, 0.97), smoothstep(0.45, 0.8, dust) * 0.2);
    cSoft = 0.8;
    cBroad = 0.05;
  } else if (id < 11.5) {
    // 0.32 GINGERBREAD: deep spiced brown, flecked with the spice, pocked
    float detail = 1.0 - smoothstep(0.008, 0.03, px);
    base *= 0.86 + 0.24 * cTri(p * 3.0, an);
    vec2 q = pl * 30.0;
    vec3 h = cHash3(cWrap(floor(q)) + 19.0);
    float fleck = (1.0 - smoothstep(0.12, 0.3, length(fract(q) - 0.5))) * step(0.82, h.x) * detail;
    base *= 1.0 - fleck * 0.4;
    base = mix(base, base * 1.25, step(0.96, h.y) * detail * 0.6);
    cBroad = 0.05;
  } else if (id < 12.5) {
    // 0.34 SPONGE: cake crumb, full of little air holes, each with its rim
    float detail = 1.0 - smoothstep(0.008, 0.03, px);
    vec2 q = pl * 26.0;
    vec3 h = cHash3(cWrap(floor(q)) + 23.0);
    float r = length(fract(q) - 0.5 - (h.xy - 0.5) * 0.4);
    float hr = 0.12 + 0.18 * h.z;
    float hole = 1.0 - smoothstep(hr - 0.06, hr, r);
    float rim = smoothstep(hr - 0.02, hr, r) * (1.0 - smoothstep(hr, hr + 0.1, r));
    base *= 1.0 - hole * 0.42 * detail;
    base *= 1.0 + rim * 0.12 * detail;
    base *= 0.94 + 0.12 * cTri(p * 5.0, an);
    cSoft = 0.3;
  } else if (id < 13.5) {
    // 0.36 STRIPE: a candy cane's twist - uv.x round it, uv.y along it in
    // metres: a broad stripe in its own colour and a thin one beside it,
    // winding round on cream-white, glossy
    float t = vUv.x * 2.0 + vUv.y * 0.95;
    float aa = fwidth(t) * 1.2;
    float s = spinStripe(t, 0.17, aa) + spinStripe(t + 0.31, 0.035, aa);
    base = mix(vec3(1.0, 0.97, 0.94), base, clamp(s, 0.0, 1.0));
    cSpec = 1.0;
    cPow = 80.0;
    cFres = 0.35;
    cTrans = 0.3;
    cBroad = 0.1;
  } else if (id < 14.5) {
    // 0.38 SWIRL: a lollipop's face (uv centred on 0.5) - arms of colour
    // winding in to the middle; a white sweet gets every colour there is,
    // a coloured one its own colour on white
    vec2 q = vUv - 0.5;
    float r = length(q) * 2.0;
    float a = atan(q.y, q.x) / 6.2832;
    float t = a * 6.0 + r * 2.4;
    float k = floor(mod(t, 6.0));
    float f = fract(t);
    float aa = fwidth(t) * 1.2;
    float gap = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, min(f, 1.0 - f));
    vec3 rainbow = sprinkleCol(fract(k / 6.0 * 0.999 + 0.02));
    float white = step(2.85, base.r + base.g + base.b);
    vec3 arm = mix(mix(base, vec3(1.0, 0.97, 0.95), step(1.0, mod(k, 2.0))), rainbow, white);
    base = mix(arm, vec3(1.0, 0.98, 0.95), gap * 0.8);
    cSpec = 1.1;
    cPow = 90.0;
    cFres = 0.35;
    cTrans = 0.35;
  } else if (id < 15.5) {
    // 0.40 JELLY BEAN: glossy, a little mottled, some speckled
    float detail = 1.0 - smoothstep(0.004, 0.015, px);
    base *= 0.94 + 0.12 * cTri(p * 6.0, an);
    vec2 q = pl * 70.0;
    vec3 h = cHash3(cWrap(floor(q)) + 31.0);
    float sp = (1.0 - smoothstep(0.15, 0.35, length(fract(q) - 0.5))) * step(0.8, h.x) * detail * step(0.5, fract(base.r * 9.0 + base.b * 5.0));
    base *= 1.0 - sp * 0.35;
    cSpec = 0.95;
    cPow = 56.0;
    cBroad = 0.2;
    cFres = 0.25;
    cTrans = 0.25;
  } else if (id < 16.5) {
    // 0.42 MACARON shell: smooth, matte, a satin sheen
    base *= 0.97 + 0.06 * cTri(p * 12.0, an);
    cBroad = 0.12;
    cSoft = 0.35;
  } else if (id < 17.5) {
    // 0.44 BRITTLE: amber sugar glass set hard round peanuts
    vec2 q = pl * 7.0;
    vec3 h = cHash3(cWrap(floor(q)) + 41.0);
    vec2 f = fract(q) - 0.5 - (h.xy - 0.5) * 0.3;
    float nut = 1.0 - smoothstep(0.2, 0.26, length(f * vec2(1.0, 1.5)));
    nut *= step(0.25, h.z);
    vec3 nc = vec3(0.86, 0.66, 0.42) * (0.85 + 0.3 * cTri(p * 20.0, an));
    base = mix(base * (0.9 + 0.2 * cTri(p * 3.0, an)), nc, nut * 0.9);
    cSpec = 0.8;
    cPow = 48.0;
    cTrans = 0.5 * (1.0 - nut);
    cBroad = 0.12;
  } else if (id < 18.5) {
    // 0.46 FIELD: frosting spread over the ground - soft piped swirls, a
    // scatter of sprinkles and a glitter of sugar
    float detail = 1.0 - smoothstep(0.02, 0.06, px);
    float s1 = cTri(p * 0.25, an);
    float sw = sin((p.x * 1.3 + p.z * 0.9) + s1 * 12.0);
    base *= 0.95 + 0.07 * sw * detail + 0.06 * (s1 - 0.5);
    vec4 s = sprinkles(pl * 11.0, 0.16);
    base = mix(base, s.rgb, s.a * detail * 0.9);
    vec2 q = pl * 24.0;
    vec3 h = cHash3(cWrap(floor(q)) + 5.0);
    cSpark = step(0.8, h.y) * (1.0 - smoothstep(0.01, 0.03, px));
    cSparkN = normalize(n + (h - 0.5) * 1.6);
    cSoft = 0.45;
    cBroad = 0.06;
  } else if (id < 19.5) {
    // 0.48 SOUR belt: bands of colour along it (uv.x across it), every one
    // coated in sour sugar that glitters
    float t = vUv.x * 5.0;
    float k = floor(t);
    vec3 band = k < 1.0 ? vec3(1.0, 0.35, 0.4) : k < 2.0 ? vec3(1.0, 0.65, 0.25) : k < 3.0 ? vec3(1.0, 0.9, 0.32) : k < 4.0 ? vec3(0.45, 0.88, 0.45) : vec3(0.4, 0.66, 1.0);
    vec2 q = pl * 48.0;
    vec3 h = cHash3(cWrap(floor(q)) + 13.0);
    float fine = 1.0 - smoothstep(0.006, 0.02, px);
    base = mix(band, vec3(1.0), 0.14) * mix(1.0, 0.88 + 0.24 * h.x, fine);
    cSpark = fine * step(0.62, h.y);
    cSparkN = normalize(n + (h - 0.5) * 1.5);
    cTrans = 0.3;
    cSoft = 0.25;
  } else if (id < 20.5) {
    // 0.50 LICORICE: a twisted rope (uv.x round it, uv.y along it in
    // metres), deep grooves winding round it, glossy
    float t = vUv.x * 5.0 + vUv.y * 3.0;
    float f = fract(t);
    float aa = fwidth(t);
    float ridge = smoothstep(0.0, 0.5, f) * (1.0 - smoothstep(0.5, 1.0, f));
    base *= mix(0.95, 0.6 + 0.6 * ridge, 1.0 - smoothstep(0.3, 0.8, aa));
    n = normalize(n + vec3(0.0, (ridge - 0.5) * 0.4, 0.0));
    cSpec = 0.75;
    cPow = 46.0;
    cFres = 0.22;
    cBroad = 0.12;
  } else if (id < 21.5) {
    // 0.52 WRAPPER: cellophane and foil, crinkled - the light breaking up
    // into bright creases
    float detail = 1.0 - smoothstep(0.01, 0.04, px);
    vec3 pp = p * 16.0;
    float c0 = cTri(pp, an);
    vec3 gr = vec3(cTri(pp + vec3(0.05, 0.0, 0.0), an), cTri(pp + vec3(0.0, 0.05, 0.0), an), cTri(pp + vec3(0.0, 0.0, 0.05), an)) - c0;
    n = normalize(n - gr * 22.0 * detail);
    cSpec = 1.3;
    cPow = 60.0;
    cFres = 0.45;
    cBroad = 0.2;
  } else {
    // 0.54 PEPPERMINT: a pinwheel (uv centred on 0.5) - curved wedges of its
    // colour on white, glossy
    vec2 q = vUv - 0.5;
    float r = length(q) * 2.0;
    float a = atan(q.y, q.x) / 6.2832;
    float t = a * 8.0 + r * 0.7;
    float aa = fwidth(t) * 1.2;
    float wedge = spinStripe(t, 0.22 * (0.4 + 0.6 * r), aa) * smoothstep(0.08, 0.18, r);
    base = mix(vec3(1.0, 0.98, 0.96), base, wedge);
    cSpec = 1.1;
    cPow = 90.0;
    cFres = 0.35;
    cTrans = 0.35;
  }
}

// ... and its light, once it's lit
void candyLight(inout vec3 col, vec3 base, vec3 n, vec3 V, vec3 shade, float lit) {
  // frosting and marshmallow are never deep in shade
  col = mix(col, base * mix(shade, vec3(1.0), 0.5), cSoft * 0.55);
  if (cTrans > 0.0) {
    // light going into it: brightest and most vivid through its thin edges
    // and with the sun behind it; the shade lit from within
    float thin = pow(1.0 - abs(dot(n, V)), 1.5);
    float behind = max(dot(V, uLightDir), 0.0);
    vec3 glow = min(base * 1.3 + 0.04, vec3(1.25));
    col = mix(col, glow * mix(vec3(1.0), shade, 0.3), cTrans * (0.22 + 0.4 * thin));
    col += base * base * cTrans * behind * thin * 0.5;
  }
  vec3 rf = reflect(V, n);
  float rl = max(dot(rf, uLightDir), 0.0);
  float spec = pow(rl, cPow) * cSpec + pow(rl, 6.0) * cBroad;
  col += mix(uHiTint, vec3(1.0, 0.98, 0.95), 0.7) * spec * (0.3 + 0.7 * lit);
  if (cFres > 0.0) {
    float fr = pow(1.0 - abs(dot(n, V)), 3.0);
    col = mix(col, skyColor(rf) * 1.05 + 0.04, cFres * (0.25 + 0.75 * fr) * 0.5);
  }
  if (cSpark > 0.0) {
    float gl = pow(max(dot(reflect(V, cSparkN), uLightDir), 0.0), 22.0);
    col += vec3(1.0, 0.98, 0.94) * gl * cSpark * 1.4 * (0.4 + 0.6 * lit);
  }
}
#endif
`;

// --- the road --------------------------------------------------------------------
// Ground pattern 17: Candy World's road. Big biscuits laid in staggered
// courses down each lane, each docked with a grid of little holes, a row of
// them down its middle, toasted darker round its edges and crumbed; strips
// of wafer, their grid pressed in and a line of pink cream showing at each
// side, run down the lane lines; and round butter cookies - chocolate-chip,
// jam-centred, or a ring pressed in - scallop the edges of the road. (p.y
// runs on from chunk to chunk: every period divides the 4096 m it wraps at.)
export const BISCUIT_GROUND = /* glsl */ `
  #elif GROUND == 17
    float soften = max(smoothstep(0.25, 0.9, fwidth(p.x) * 9.0), smoothstep(0.2, 0.6, uMotion / 0.42));
    float fade = (1.0 - far) * (1.0 - soften * 0.75);
    float n1 = texture2D(uNoise, p * vec2(0.25, 0.125)).g;
    float n2 = texture2D(uNoise, p * vec2(0.75, 0.75) + 0.31).g;
    float ax = abs(p.x);
    float aa = fwidth(p.x) * 1.2;
    vec3 c;
    if (ax < 3.62) {
      // which lane, and across it
      float li = clamp(floor((p.x + 3.6) / 2.4), 0.0, 2.0);
      float lx = p.x - (li - 1.0) * 2.4;
      float wx = abs(abs(p.x) - 1.2);
      // two biscuits across each lane, their courses staggered lane to lane
      float bw = 1.035;
      float bx = (lx + bw) / bw;
      float bi = clamp(floor(bx), 0.0, 1.0);
      float fx = bx - bi;
      float bl = 0.8;
      float by = p.y / bl + li * 0.37 + bi * 0.5;
      float row = floor(by);
      float fy = fract(by);
      float h = hash12(vec2(li * 2.0 + bi, mod(row, 512.0)) + 17.0);
      c = mix(uGroundA, uGroundB, h * 0.45 + n1 * 0.3);
      // toasted toward its edges
      float ex = min(fx, 1.0 - fx) * bw;
      float ey = min(fy, 1.0 - fy) * bl;
      float e = min(ex, ey);
      c = mix(c, uGroundB * 0.92, (1.0 - smoothstep(0.0, 0.13, e)) * 0.55);
      // docked: a grid of little holes, and a row of them down its middle
      vec2 hp = vec2(fx * bw, fy * bl);
      vec2 hs = vec2(0.17, 0.16);
      vec2 hq = (hp - vec2(0.09, 0.08)) / hs;
      vec2 hf = (fract(hq) - 0.5) * hs;
      float inner = step(0.0, hq.x) * step(hq.x, 5.0) * step(0.0, hq.y) * step(hq.y, 4.0);
      float hole = (1.0 - smoothstep(0.012, 0.02, length(hf))) * inner;
      float mid = (1.0 - smoothstep(0.008, 0.014, abs(fx * bw - bw * 0.5))) * step(0.5, fract(fy * bl / 0.05));
      c = mix(c, uGroundC * 0.9, max(hole * 0.8, mid * 0.5) * fade);
      c *= 1.0 + (n2 - 0.5) * 0.14;
      // crumbs
      float cr = hash12(floor(p * 22.0) + 3.0);
      c = mix(c, uGroundB * 0.8, step(0.94, cr) * 0.35 * fade);
      // the gaps between biscuits
      float joint = 1.0 - smoothstep(0.016 - aa, 0.016 + aa, ex);
      joint = max(joint, runLine(ey, 0.016, fwidth(p.y) * 1.2));
      c = mix(c, uGroundC * 0.75, joint * 0.85 * (1.0 - far * 0.6));
      // a strip of wafer down each lane line
      float onW = 1.0 - smoothstep(0.18 - aa, 0.18 + aa, wx);
      if (onW > 0.0) {
        vec3 wc = mix(uGroundA, vec3(1.0, 0.92, 0.7), 0.35);
        vec2 g = vec2((p.x - sign(p.x) * 1.2 + 0.18) / 0.064, p.y / 0.064);
        vec2 gf = fract(g);
        float ge = min(min(gf.x, 1.0 - gf.x), min(gf.y, 1.0 - gf.y));
        float ga = fwidth(g.y) + fwidth(g.x);
        float grid = 1.0 - smoothstep(0.08, 0.08 + ga * 1.2, ge);
        wc *= 1.0 - grid * 0.28 * (1.0 - smoothstep(0.3, 0.7, ga));
        // its sides: a line of pink cream, then a shadow on the biscuit
        float side = smoothstep(0.13, 0.15, wx);
        wc = mix(wc, vec3(1.0, 0.72, 0.8), side * 0.9);
        c = mix(c, wc, onW);
      }
      c *= 1.0 - 0.25 * smoothstep(0.17, 0.2, wx) * (1.0 - smoothstep(0.2, 0.27, wx));
    } else {
      // round butter cookies along the edge of the road
      float cl = 0.8;
      float cy = p.y / cl;
      float ci = floor(cy + 0.5);
      vec2 d = vec2(ax - 4.02, (cy - ci) * cl);
      float r = length(d);
      float h = hash12(vec2(ci, sign(p.x)) + 29.0);
      float in0 = 1.0 - smoothstep(0.38 - aa, 0.38 + aa, r);
      vec3 ck = mix(vec3(1.0, 0.86, 0.6), vec3(0.95, 0.74, 0.46), h * 0.5 + n2 * 0.3);
      ck = mix(ck, ck * 0.8, smoothstep(0.26, 0.38, r));
      if (h < 0.4) {
        // chocolate chips
        vec2 q = d * 9.0;
        float hc = hash12(floor(q) + ci);
        float chip = (1.0 - smoothstep(0.2, 0.36, length(fract(q) - 0.5))) * step(0.72, hc) * step(r, 0.3);
        ck = mix(ck, vec3(0.3, 0.15, 0.08), chip * fade);
      } else if (h < 0.7) {
        // a jam centre
        float jam = 1.0 - smoothstep(0.1 - aa, 0.1 + aa, r);
        ck = mix(ck, vec3(0.92, 0.2, 0.32), jam);
        ck = mix(ck, vec3(1.0, 0.6, 0.66), jam * smoothstep(0.06, 0.0, length(d - vec2(-0.03, 0.03))));
      } else {
        // a ring and a scallop pressed in
        float ring = 1.0 - smoothstep(0.012, 0.02 + aa, abs(r - 0.22));
        float sc = 1.0 - smoothstep(0.01, 0.018 + aa, abs(r - 0.31 - 0.02 * sin(atan(d.y, d.x) * 12.0)));
        ck *= 1.0 - (ring + sc) * 0.22 * fade;
      }
      vec3 between = mix(uGroundC, vec3(0.98, 0.78, 0.84), 0.45);
      c = mix(between, ck, in0);
    }
    return mix(c, mix(uGroundA, uGroundB, 0.4), far * 0.55);
`;
