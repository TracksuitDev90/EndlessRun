import { Wayfarer } from './wayfarer.js';
import { Explorer } from './explorer.js';
import { Elder } from './elder.js';
import { Bunny } from './bunny.js';
import { Skater } from './skater.js';

// Who you can run as. Each has their sculpted asset (tools/runner/), the art
// their card on the title screen is cut from (tools/characters/cards.py), a
// name and a line about how they run, the colour their card is washed in, and
// the class that dresses and moves them. The first is the default.
export const CHARACTERS = [
  {
    id: 'wayfarer',
    name: 'Rowan',
    title: 'the wayfarer',
    blurb: 'tall · a heavy charge · cape on the wind',
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
  {
    id: 'elder',
    name: 'Alder',
    title: 'the elder',
    blurb: 'ancient · hobbles on his stick',
    asset: 'assets/elder/',
    card: 'assets/characters/elder.webp',
    tint: ['#9fd0c6', '#2f6f7c'],
    make: (env, asset) => new Elder(env, asset),
  },
  {
    id: 'bunny',
    name: 'Bramble',
    title: 'the tumbler',
    blurb: 'small · springy · jumps the highest',
    asset: 'assets/bunny/',
    card: 'assets/characters/bunny.webp',
    tint: ['#ffd36b', '#e0702e'],
    make: (env, asset) => new Bunny(env, asset),
  },
  {
    id: 'skater',
    name: 'Hazel',
    title: 'the skater',
    blurb: 'cool · rides her board · flips it over everything',
    asset: 'assets/skater/',
    card: 'assets/characters/skater.webp',
    tint: ['#d9b3ff', '#7046c4'],
    make: (env, asset) => new Skater(env, asset),
  },
];

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
