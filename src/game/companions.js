import { CONFIG } from '../config.js';

// Who can run with you, picked on the title screen. Each has their sculpted
// asset (tools/runner/), a name and a line about them, the portrait and
// colours of their badge on the title screen, the class that dresses and
// moves them (make) and their mind (mind: companion.js for one who runs,
// flyer.js for one who flies; tune, hw, mouth and beats bend the runner's
// mind to a different body). The first is the default (CONFIG.companion.id
// picks; the title screen's pick, then ?companion=, override it; 'none' runs
// alone). Each one's body and mind are in modules of their own, fetched only
// when they're wanted (load(), as for the runners: see characters.js).
export const COMPANIONS = [
  {
    id: 'fox',
    name: 'Sorrel',
    title: 'the red fox',
    blurb: 'quick · sly · fetches gems',
    asset: 'assets/fox/',
    face: 'assets/characters/fox-face.webp',
    tint: ['#ffb36b', '#d9541e'],
    load: lazy(() => Promise.all([import('./fox.js'), import('./companion.js')]), ([b, m]) => ({
      make: (env, asset) => new b.Fox(env, asset),
      mind: (game, def, body) => new m.Companion(game, def, body),
    })),
  },
  {
    id: 'dragon',
    name: 'Iris',
    title: 'the wind dragon',
    blurb: 'rides the wind · flows like water',
    asset: 'assets/dragon/',
    face: 'assets/characters/dragon-face.webp',
    tint: ['#8fe3e6', '#3b56c4'],
    load: lazy(() => Promise.all([import('./dragon.js'), import('./flyer.js')]), ([b, m]) => ({
      make: (env, asset) => new b.Dragon(env, asset),
      mind: (game, def, body) => new m.Flyer(game, def, body),
    })),
  },
  {
    id: 'pitcher',
    name: 'Nep',
    title: 'the pitcher plant',
    blurb: 'wobbles · sloshes · keeps up (just)',
    asset: 'assets/pitcher/',
    face: 'assets/characters/pitcher-face.webp',
    tint: ['#d9ec6a', '#e0786a'],
    // (a mind of his own - sprout.js: slower, wobblier, never far from you -
    // built on the runner's for reading the road; his own tunables over
    // the fox's, his size, and his mouth on top)
    load: lazy(() => Promise.all([import('./pitcher.js'), import('./sprout.js')]), ([b, m]) => ({
      make: (env, asset) => new b.Pitcher(env, asset),
      mind: (game, def, body) => new m.Sprout(game, def, body),
    })),
    tune: CONFIG.companion.pitcher,
    hw: 0.27,
    mouth: [0.12, 0.66],
    // (how far his pot reaches, for tools/companion/audit.js)
    extent: { front: 0.26, back: 0.26, side: 0.24, top: 0.98 },
  },
  {
    id: 'thistle',
    name: 'Teasel',
    title: 'the storm thistle',
    blurb: 'scurries · glides · travels by spark',
    asset: 'assets/thistle/',
    face: 'assets/characters/thistle-face.webp',
    tint: ['#d8b4ff', '#7a2a5e'],
    // (a mind of its own - scurrier.js: quick on its three roots, charging
    // as it runs, catching up through a spark - built on the runner's for
    // reading the road; its own tunables over the fox's, its size, and
    // where it catches a gem: in its crown)
    load: lazy(() => Promise.all([import('./thistle.js'), import('./scurrier.js')]), ([b, m]) => ({
      make: (env, asset) => new b.Thistle(env, asset),
      mind: (game, def, body) => new m.Scurrier(game, def, body),
    })),
    tune: CONFIG.companion.thistle,
    hw: 0.34,
    mouth: [0.0, 0.62],
    // (how far its pod and legs reach, for tools/companion/audit.js)
    extent: { front: 0.24, back: 0.34, side: 0.29, top: 0.56 },
  },
  {
    id: 'crab',
    name: 'Shoal',
    title: 'the giant opal crab',
    blurb: 'gentle · curious · turns to every world',
    asset: 'assets/crab/',
    face: 'assets/characters/crab-face.webp',
    tint: ['#c6eef2', '#c98ad8'],
    // (a mind of his own - scuttler.js: unhurried, curious, fond of you -
    // built on the runner's for reading the road; his own tunables over the
    // fox's, his breadth, and where he catches a gem: in his little claw)
    load: lazy(() => Promise.all([import('./crab.js'), import('./scuttler.js')]), ([b, m]) => ({
      make: (env, asset) => new b.Crab(env, asset),
      mind: (game, def, body) => new m.Scuttler(game, def, body),
    })),
    tune: CONFIG.companion.crab,
    hw: 0.72,
    mouth: [0.38, 0.32],
    // (how far his shell, legs and claws reach, for tools/companion/audit.js)
    // (duck: how much lower he is flattened under a bar)
    extent: { front: 0.87, back: 0.46, side: 0.7, top: 1.03, duck: 0.42 },
  },
];

// (load(): fetch the modules once, set def.make and def.mind from them; one
// that failed is fetched afresh next time)
function lazy(fetch, parts) {
  let p = null;
  return function () {
    p ??= fetch().then(
      (m) => Object.assign(this, parts(m)),
      (e) => {
        p = null;
        throw e;
      }
    );
    return p;
  };
}

export const companionById = (id) => (id === 'none' ? null : COMPANIONS.find((c) => c.id === id) || COMPANIONS[0]);
