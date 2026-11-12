import { Fox } from './fox.js';
import { Dragon } from './dragon.js';
import { Companion } from './companion.js';
import { Flyer } from './flyer.js';
import { Pitcher } from './pitcher.js';
import { Sprout } from './sprout.js';
import { CONFIG } from '../config.js';

// Who can run with you, picked on the title screen. Each has their sculpted
// asset (tools/runner/), a name and a line about them, the portrait and
// colours of their badge on the title screen, the class that dresses and
// moves them (make) and their mind (mind: companion.js for one who runs,
// flyer.js for one who flies; tune, hw, mouth and beats bend the runner's
// mind to a different body). The first is the default (CONFIG.companion.id
// picks; the title screen's pick, then ?companion=, override it; 'none' runs
// alone).
export const COMPANIONS = [
  {
    id: 'fox',
    name: 'Sorrel',
    title: 'the red fox',
    blurb: 'quick · sly · fetches gems',
    asset: 'assets/fox/',
    face: 'assets/characters/fox-face.webp',
    tint: ['#ffb36b', '#d9541e'],
    make: (env, asset) => new Fox(env, asset),
    mind: (game, def, body) => new Companion(game, def, body),
  },
  {
    id: 'dragon',
    name: 'Iris',
    title: 'the wind dragon',
    blurb: 'rides the wind · flows like water',
    asset: 'assets/dragon/',
    face: 'assets/characters/dragon-face.webp',
    tint: ['#8fe3e6', '#3b56c4'],
    make: (env, asset) => new Dragon(env, asset),
    mind: (game, def, body) => new Flyer(game, def, body),
  },
  {
    id: 'pitcher',
    name: 'Nep',
    title: 'the pitcher plant',
    blurb: 'wobbles · sloshes · keeps up (just)',
    asset: 'assets/pitcher/',
    face: 'assets/characters/pitcher-face.webp',
    tint: ['#d9ec6a', '#e0786a'],
    make: (env, asset) => new Pitcher(env, asset),
    // (a mind of his own - sprout.js: slower, wobblier, never far from you -
    // built on the runner's for reading the road; his own tunables over
    // the fox's, his size, and his mouth on top)
    mind: (game, def, body) => new Sprout(game, def, body),
    tune: CONFIG.companion.pitcher,
    hw: 0.27,
    mouth: [0.12, 0.66],
    // (how far his pot reaches, for tools/companion/audit.js)
    extent: { front: 0.26, back: 0.26, side: 0.24, top: 0.98 },
  },
];

export const companionById = (id) => (id === 'none' ? null : COMPANIONS.find((c) => c.id === id) || COMPANIONS[0]);
