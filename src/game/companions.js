import { Fox } from './fox.js';
import { Dragon } from './dragon.js';
import { Companion } from './companion.js';
import { Flyer } from './flyer.js';

// Who can run with you, picked on the title screen. Each has their sculpted
// asset (tools/runner/), a name and a line about them, the portrait and
// colours of their badge on the title screen, the class that dresses and
// moves them (make) and their mind (mind: companion.js for one who runs,
// flyer.js for one who flies). The first is the default (CONFIG.companion.id
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
];

export const companionById = (id) => (id === 'none' ? null : COMPANIONS.find((c) => c.id === id) || COMPANIONS[0]);
