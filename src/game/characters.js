import { Wayfarer } from './wayfarer.js';
import { Explorer } from './explorer.js';

// Who you can run as. Each has their sculpted asset (tools/runner/), the art
// their card on the title screen is cut from (tools/characters/cards.py), a
// name and a line about how they run, the colour their card is washed in, and
// the class that dresses and moves them. The first is the default.
export const CHARACTERS = [
  {
    id: 'wayfarer',
    name: 'Rowan',
    title: 'the wayfarer',
    blurb: 'steady stride · cape on the wind',
    asset: 'assets/runner/',
    card: 'assets/characters/wayfarer.webp',
    tint: ['#ffb54a', '#f2702a'],
    make: (env, asset) => new Wayfarer(env, asset),
  },
  {
    id: 'explorer',
    name: 'Wren',
    title: 'the explorer',
    blurb: 'nimble · quick on her feet',
    asset: 'assets/explorer/',
    card: 'assets/characters/explorer.webp',
    tint: ['#9fdcc8', '#3f9a8c'],
    make: (env, asset) => new Explorer(env, asset),
  },
];

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
