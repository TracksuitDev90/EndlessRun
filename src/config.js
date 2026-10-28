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
  },

  jump: { height: 1.6, time: 0.64 }, // apex height (m), total airtime (s)
  slide: { time: 0.72 },
  // Rendered figure for the obstacle kinds (see obstacles.js): H obstacles hang
  // no lower than duckLine so the gap under them always reads as passable.
  duckLine: 1.14,
  fastFall: 22, // downward velocity when swiping down in the air
  laneRate: 16, // lane-change responsiveness (higher = snappier)
  inputBuffer: 0.16, // seconds a jump pressed in mid-air is remembered

  // Score: every meter run is worth `perMeter` points times the depth you're
  // at (×1 in the first world, ×2 through the first doorway, …), and every
  // obstacle you get past without a hit pays `clear` × depth (full-width rows
  // count `wide` times).
  score: { perMeter: 1, clear: 10, wide: 2 },

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
  // rushBase: strength of the doorway bloom before the dream deepens it.
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
    rushTime: 1.3,
    rushBase: 0.75,
    reducedMotion: 0.3,
  },

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
};
