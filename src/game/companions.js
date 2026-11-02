import { Fox } from './fox.js';

// Who can run with you. Each has their sculpted asset (tools/runner/), a
// name, and the class that dresses and moves them; companion.js is their
// mind. The first is the default (CONFIG.companion.id picks; 'none' runs
// alone).
export const COMPANIONS = [
  {
    id: 'fox',
    name: 'Sorrel',
    title: 'the red fox',
    asset: 'assets/fox/',
    make: (env, asset) => new Fox(env, asset),
  },
];

export const companionById = (id) => (id === 'none' ? null : COMPANIONS.find((c) => c.id === id) || COMPANIONS[0]);
