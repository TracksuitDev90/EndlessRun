import { Wayfarer } from './wayfarer.js';
import { Explorer } from './explorer.js';
import { Elder } from './elder.js';
import { Bunny } from './bunny.js';
import { Skater } from './skater.js';
import { Samurai } from './samurai.js';
import { Fisher } from './fisher.js';

// Who you can run as. Each has their sculpted asset (tools/runner/), the art
// their card on the title screen is cut from (tools/characters/cards.py), a
// name and a line about how they run, the colour their card is washed in, and
// the class that dresses and moves them. One that's `locked` is still being
// worked on: built with the rest, their card dealt greyed out, but not to be
// picked (only ?runner=<id> runs as them). The first who isn't locked is the
// default.
export const CHARACTERS = [
  {
    id: 'wayfarer',
    name: 'Rowan',
    title: 'the wayfarer',
    blurb: 'tall · a heavy charge · cape on the wind',
    asset: 'assets/runner/',
    card: 'assets/characters/wayfarer.webp',
    tint: ['#ffb54a', '#f2702a'],
    locked: true,
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
  {
    id: 'samurai',
    name: 'Birch',
    title: 'the samurai',
    blurb: 'a white tiger · brutally fast · a blade at his hip',
    asset: 'assets/samurai/',
    card: 'assets/characters/samurai.webp',
    tint: ['#f2a48e', '#a3302a'],
    make: (env, asset) => new Samurai(env, asset),
  },
  {
    id: 'fisher',
    name: 'Reed',
    title: 'the angler',
    blurb: 'easy-striding · a fish on his line · splashes where he lands',
    asset: 'assets/fisher/',
    card: 'assets/characters/fisher.webp',
    tint: ['#9fe3ef', '#2f86b8'],
    make: (env, asset) => new Fisher(env, asset),
  },
];

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

// The runner by id if they can be picked, else the default.
export const pickableById = (id) => {
  const c = CHARACTERS.find((d) => d.id === id);
  return c && !c.locked ? c : CHARACTERS.find((d) => !d.locked) || CHARACTERS[0];
};
