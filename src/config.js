// Every gameplay and feel tunable lives here so the game can be balanced
// without touching systems code.

export const CONFIG = {
  title: 'EndlessRun',

  // Track layout (meters). The player runs toward -z; "distance" grows forward.
  laneX: [-2.4, 0, 2.4],
  obstacleHalfWidth: 1.0,
  trackHalfWidth: 4.4,

  player: {
    halfWidth: 0.33,
    halfDepth: 0.3,
    height: 1.5,
    slideHeight: 0.72,
    // how far below the top of a hurdle they can come down on it, or run
    // into it, and still find themselves standing on it
    stepUp: 0.3,
  },

  // Speed in m/s eases from start toward max: v = max - (max - start) * e^(-t / ramp)
  speed: { start: 12, max: 28, ramp: 220 },

  // Obstacle pacing. Spacing is measured in seconds of running, so it stays
  // fair as speed climbs. Difficulty = 1 - e^(-runTime / ramp): ~25% after a
  // minute, ~60% after three, ~85% after seven.
  obstacles: {
    firstAt: 125, // meters of open road before the first obstacle
    firstAtTutorial: 95,
    ramp: 210,
    gapEasy: 3.1, // seconds between patterns at the very start...
    gapHard: 1.05, // ...and once fully ramped
    gapJitter: [0.88, 1.22],
    rowGapEasy: 1.25, // seconds between rows inside one pattern
    rowGapHard: 0.62,
    minAfterVertical: 0.92, // after a row you must jump/slide (airtime 0.64 s, slide 0.72 s)
    minAfterLane: 0.55, // after a row you only steer around
    breatherEvery: [5, 8], // patterns between longer rests
    breatherMul: 1.9,
    tutorialGap: 3.3,
    // A breather world (def.calm: the Cypress Lane) on every lap: it is laid
    // at only `diff` of the run's difficulty, every gap is stretched by
    // `space`, it never deals a pattern that unlocks past `most` (no zigzags,
    // tunnels, sweeps or hop-duck doubles), and lone obstacles come up
    // `lone` times as often.
    calm: { diff: 0.55, space: 1.12, most: 0.3, lone: 1.5 },
  },

  jump: { height: 1.6, time: 0.64 }, // apex height (m), total airtime (s)
  // Low gravity (a world with def.lowGravity: the Red Drift; see
  // game/drift.js). The boost - the jump, there - leaves the ground at v0
  // (m/s) under `up` gravity (m/s²) until it's climbing slower than `hover`,
  // hangs under `hang` until it's sinking faster than that, then comes down
  // under `down`: about 1.3 s in the air and 2.3 m up at the top. A
  // second press while it hangs (`rethrust`: up to that many) fires the
  // thruster again, from wherever they are, at `again` m/s. The bound:
  // after a few steps on the ground (`steps`: at least, at most) the runner
  // bounces off at v0 under g - a long, low lope - and so on. gk: how much
  // of their weight the runner's cape, hair and beard keep. Obstacles in
  // that world come up `pace.space` times further apart, and never closer
  // than `pace.air` times the usual gap after one you have to jump or duck.
  // So about 2 s in the air and 2.7 m up at the top. While they hang they
  // fly in one of the `styles` (see Player.flyOverlay), dealt so the same
  // one never comes twice running; a spinning one turns over `spin` [from,
  // to] seconds into the boost.
  drift: {
    boost: { v0: 11, up: 30, hover: 2.2, hang: 3.2, down: 15, rethrust: 1, again: 6.5 },
    bound: { v0: 3.2, g: 13, steps: [2, 4] },
    gk: 0.32,
    pace: { space: 1.12, air: 1.95 },
    styles: ['jet', 'reach', 'starfish', 'roll', 'flip'],
    spin: [0.62, 1.5],
  },
  slide: { time: 0.72 },
  // Rendered figure for the obstacle kinds (see obstacles.js): H obstacles hang
  // no lower than duckLine so the gap under them always reads as passable.
  duckLine: 1.14,
  fastFall: 22, // downward velocity when swiping down in the air
  // lane changes follow a critically damped spring of this rate (1/s): about
  // 80% of the way across in 0.1 s, settled in 0.2 s (higher = snappier)
  laneSpring: 32,
  inputBuffer: 0.16, // seconds a jump pressed in mid-air is remembered (to the moment they touch down)
  ledgeGrace: 0.1, // seconds after running off the top of something a jump still takes off from it

  // Score: every meter run is worth `perMeter` points times the depth you're
  // at (1 in the first world, 2 through the first doorway, …; the badge on
  // the score counts the worlds you've come through), and every obstacle you
  // get past without a hit pays a clear bonus that climbs with every world:
  // `clear` × depth × (1 + `grow` × worlds come through), to the nearest 5 —
  // 10, 25, 45, 70, 100, 135, 175… (full-width rows count `wide` times).
  score: { perMeter: 1, clear: 10, grow: 0.25, wide: 2 },

  // Gems (see game/gems.js): laid in runs along a "ghost" route through the
  // obstacles ahead. Missing them costs nothing. Times are seconds of running
  // (so the layout stays fair as speed climbs); [easy, hard] pairs ease from
  // the first to the second with the obstacle difficulty.
  gems: {
    firstAt: 30, // meters of road before the first run
    size: 1.25, // scale on the cuts as built (an everyday stone ends up ~0.7 m, half the runner's height)
    spacing: 0.135, // seconds between gems in a run (2.3–3.9 m)
    ground: 0.86, // height of a gem's centre on the road...
    low: 0.55, // ...and under a duck bar
    reach: 0.55, // how far outside the runner's body a gem is still picked up
    run: [4, 7], // gems in a run along open road (a few more later on)
    maxRun: 14,
    mix: 0.35, // chance a gem is another of the world's stones, not its run's lead
    often: [0.6, 0.85], // chance a stretch of open road gets a run
    rest: [1.3, 0.6], // seconds of empty road after a run
    lead: [1.05, 0.42], // how long before a wall in its lane a run swerves out of it
    react: [0.6, 0.36], // a gem is never closer than this to a wall in its lane
    swerve: 0.3, // seconds a run takes to drift across one lane
    // the difficulty each move first shows up at: runs hung on a jump over a
    // hurdle, ducked under a bar, wandering across lanes on open road, and
    // jumps on open road for gems you don't strictly need
    unlock: { arc: 0.06, slide: 0.13, wander: 0.1, hop: 0.3 },
    doorTrail: 0.75, // chance of a line of gems leading through a doorway
    // points (× depth) for a gem and a crown stone; a run taken whole pays
    // `perfect` × its length on top
    score: { gem: 10, crown: 30, perfect: 5 },
    // The exchange (on the crash card): every gem banks a worth as it's taken
    // — `base` × (1 + `perWorld` × the worlds come through before it) × (1 +
    // `into` × how far through its world it was found), a crown stone `crown`
    // times that — and the gems in hand are cashed in for that many points,
    // plus a haul bonus that grows with how many there are, up to +`haul`
    // (×1.5) at `big` gems — in all, about two fifths again on top of what
    // the run scored. Gems not exchanged by the time the run is over are
    // exchanged anyway.
    exchange: { base: 10, perWorld: 0.5, into: 0.75, crown: 3, haul: 0.5, big: 400 },
  },

  // The companion who runs with you (see game/companions.js): who it is by
  // default ('fox', 'dragon' or 'pitcher'; 'none' to run alone; the title screen's
  // pick, then ?companion=, override it). The fox (game/companion.js): her
  // gravity (m/s²) and
  // how long she winds up before each kind of jump (s), how high she leaps
  // (m: over a hurdle, the mousing pounce; and never a pounce within
  // pounceEvery s of the last), how far ahead of you she ranges
  // and how far back she drops (m), how much faster or slower than you she
  // can run (m/s), how she crosses the road (lateral: her speed across as a
  // share of her speed along - slant, or dodge when a wall's coming - plus
  // base m/s; how hard she can gather and shed it, m/s², on her feet,
  // dodging and in the air), chasing her tail (whirl: how long once round
  // takes, s, and never again within every s), how long she rests between
  // ideas (s), how long she rides on your shoulder (s), and her gem
  // fetching: how often she looks for one (s), how far ahead of you it must
  // be (m), the chance she goes for it, and the chance it's a cheeky one
  // right in front of you.
  companion: {
    id: 'fox',
    gravity: 26,
    // how long she winds up before each kind of jump (s)
    windup: { leap: 0.1, pounce: 0.2, hop: 0.07 },
    leap: 1.25,
    pounce: 1.45,
    pounceEvery: 20,
    ahead: 9,
    behind: -2.8,
    surge: [-7.5, 10],
    lateral: { slant: 0.4, dodge: 0.62, base: 0.6, acc: 10, accDodge: 24, accAir: 5 },
    whirl: { dur: 0.82, every: 35 },
    rest: [1.2, 3.2],
    ride: [2.6, 4.6],
    fetch: { every: [7, 14], reach: [6, 26], chance: 0.6, mischief: 0.15 },
    // The pitcher plant (game/pitcher.js, his mind game/sprout.js), over
    // the fox's: heavier, hopping lower, never pouncing; slower to surge
    // ahead or drop back and slower across the road (he keeps pace, no
    // more); never far ahead; resting longer between ideas, and fetching
    // less often.
    pitcher: {
      gravity: 22,
      windup: { leap: 0.1, pounce: 0.2, hop: 0.1 },
      leap: 1.15,
      pounceEvery: 1e9,
      ahead: 5,
      behind: -2.6,
      surge: [-4.5, 6],
      lateral: { slant: 0.34, dodge: 0.66, base: 0.55, acc: 8.5, accDodge: 30, accAir: 5 },
      rest: [1.8, 3.8],
      fetch: { every: [10, 18], reach: [6, 24], chance: 0.5, mischief: 0.08 },
    },
    // A companion who flies (the dragon - see game/flyer.js): the wind her
    // body streams back in (m/s: base + a share of your pace; less of it and
    // she coils and ripples more, more and she streams out straighter); how
    // hard she can change her speed (m/s²: across, up and down, along) and
    // how quickly that pull can build or ease off (m/s³: her turns curve in
    // rather than kinking - three times as quick when there's a wall
    // coming); how fast she goes across and up and down (m/s) and along, slower or
    // faster than you; the height she glides at (m, her head), how far
    // ahead of you she keeps (m), the height she clears you at when she
    // passes over you, the highest she'll go to sail over a wall or a bar
    // (any taller and she goes round, or under), how far in from the edges
    // of the screen she keeps (NDC: 1 the edge), how far ahead and behind
    // she ever goes; how long she
    // rests between ideas (s); the twirl she says hello with (s, m); her
    // loop-the-loop and corkscrew (how long, how big, how far the loop's
    // turned out toward the edge of the road, how many turns, never again
    // within every s); and her gem fetching (how often she looks,
    // how far ahead it must be, the chance she goes for it).
    flyer: {
      wind: [2.6, 0.08],
      acc: [8, 8, 8],
      jerk: 34,
      vmax: [5.5, 4.5],
      surge: [-6, 9],
      cruise: [1.3, 1.8],
      slot: [0.4, 2.8],
      over: 2.85,
      overWalls: 4.3,
      screen: 0.74,
      ahead: 9,
      behind: -1.5,
      rest: [2.5, 5],
      twirl: 2.2,
      twirlHeight: 0.95,
      loop: { dur: 1.9, radius: 1.0, tilt: 0.9, every: 24 },
      screw: { dur: 1.6, radius: 0.5, turns: 1, every: 12 },
      fetch: { every: [8, 15], reach: [9, 28], chance: 0.6 },
    },
  },

  // Hits
  stumbleWindow: 4.5, // a second hit within this many seconds ends the run
  stumbleSpeedMul: 0.72,
  continuesPerRun: 1,
  reviveInvulnerable: 2.6,

  // Streaming
  chunkLength: 16,
  viewAhead: 216,
  despawnBehind: 26,
  rebaseStep: 512, // floating-origin step; must be a multiple of 64 and chunkLength
  continuationLength: 176, // how far the old world keeps going behind a doorway

  // Worlds: each world lasts roughly worldSeconds at the speed you enter it
  worldSeconds: 36,
  worldMin: 576,
  worldMax: 1040,
  firstWorldLength: 672,
  doorClearBefore: 52, // no obstacles this close before a doorway
  doorClearAfter: 36, // ...or this close after it

  // Dream depth (see game/dream.js), counted in worlds (1 = the first). The
  // worlds are untouched until morphFrom, when the far distance starts quietly
  // to morph; the colour trip begins at tripFrom; everything is in by full.
  // schedule: the world each effect can first appear in and the world it
  // reaches full strength. lucidChance: odds a deeper world comes up calm.
  // rushTime: how long a doorway burst lasts (seconds); rushBase: its
  // strength before the dream deepens it.
  // reducedMotion scales the shape warps and camera sway when the OS asks for
  // less motion (colour is untouched).
  dream: {
    morphFrom: 4,
    tripFrom: 8,
    full: 18,
    schedule: {
      breathe: [4, 13], waves: [4, 14], melt: [6, 16],
      swirl: [8, 16], rings: [9, 17], palette: [10, 18], neon: [11, 18], twist: [12, 19],
    },
    lucidChance: 0.18,
    // read: [seconds, min m, max m] — how far ahead the world is kept true:
    // the shape warps (waves, melt, twist, breathing) only start past the
    // road the runner will cover in this many seconds, so obstacles and gems
    // are always where they look while you can still react to them
    read: [3.0, 40, 96],
    rushTime: 0.65,
    rushBase: 0.75,
    reducedMotion: 0.3,
  },

  // The colour drain (Hell, see game.js). The front is a radius from the
  // centre of the screen (1 = the corners) inside which the colour still
  // holds out. Coming in it starts the moment the runner reaches the doorway,
  // already eating in from the corners (inFrom), lingers as it swirls round
  // the edges of the screen, then gathers speed down the plughole (inEase:
  // how much it holds back at first), all over inTime seconds. Going out, the world beyond the doorway shows only a hint of its
  // colour (hint: how grey it is) until wellFrom of the way through the
  // run-up (the last ~55 m), then the colour wells back out from outFrom to
  // outTo as you reach the doorway.
  drain: { inTime: 1.0, inFrom: 0.95, inEase: 1.6, hint: 0.88, wellFrom: 0.55, outFrom: -0.05, outTo: 1.55 },

  // Camera
  camera: { back: 6.6, height: 4.1, lookAhead: 7.5, lookHeight: 0.95, minFov: 52, maxFov: 76, coverHalfWidth: 3.0 },

  // Curved-world look: y drops by bend * d^2 beyond bendStart meters ahead
  bend: 0.00085,
  bendStart: 10,
  swayAmount: 0.00055,
  swayPeriod: 34,

  // Rendering
  maxPixelRatio: 2,
  minPixelRatio: 1,
  // The ground's patterns are blurred along the run by this share of how far
  // the road moves in a frame (a camera's shutter: 0.5 = half the frame), so
  // tiles and grass don't strobe at speed; 0 turns it off.
  motionBlur: 0.5,
};
