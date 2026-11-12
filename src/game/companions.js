import { Fox } from './fox.js';
import { Dragon } from './dragon.js';
import { Companion } from './companion.js';
import { Flyer } from './flyer.js';
import { Pitcher } from './pitcher.js';
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
    blurb: 'scampers · sloshes · fetches gems',
    asset: 'assets/pitcher/',
    face: 'assets/characters/pitcher-face.webp',
    tint: ['#d9ec6a', '#e0786a'],
    make: (env, asset) => new Pitcher(env, asset),
    // (he runs with the fox's mind, on his own tunables: smaller, rounder,
    // his mouth on top; no riding on your shoulder - he'd soak you - and
    // no mousing pounce; a twirl instead of chasing a tail he hasn't got)
    mind: (game, def, body) => new Companion(game, def, body),
    tune: CONFIG.companion.pitcher,
    hw: 0.19,
    mouth: [0.1, 0.44],
    beats: { ride: 0, pounce: 0, whirl: 1.4 },
  },
];

export const companionById = (id) => (id === 'none' ? null : COMPANIONS.find((c) => c.id === id) || COMPANIONS[0]);
