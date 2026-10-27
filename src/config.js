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
