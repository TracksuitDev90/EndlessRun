// The worlds always nest inward in this order, and every lap comes back
// round the same way, grouped so each leads into the next:
//   green and growing - the Cypress Lane (the breather, every lap starts on
//     it), the Glasshouse, the Deepwood: day into ever deeper shade; and out
//     of the shade into the sugar-bright clearing of Candy World, where the
//     chocolate river runs;
//   after dark, by lamplight - the Night Rooftops, then down into the
//     endless library of the Hall of Doors;
//   the sun and its eclipse - the Sky Road of the sun, then Hell, where the
//     sun has gone out;
//   out past the world - the Gallery of Hours (heavenly, its sands running
//     out), the sea lapping in through its doorway to the Kelp Deep; up out
//     of the sea onto the ice of the Frostbound Pass, where the snow lies a
//     little deeper every time you come back to it; and over the pass, the
//     stars of the Red Drift.
//
// Each world's module is only fetched when it's wanted (see World.load): the
// first world's before the title screen, the rest behind it, in this order,
// a world or two ahead of the runner. (A bare import() each, written out, so
// tools/preload.py can find them.)
export const WORLD_ORDER = [
  { id: 'village', load: () => import('./village.js') },
  { id: 'conservatory', load: () => import('./conservatory.js') },
  { id: 'forest', load: () => import('./forest.js') },
  { id: 'candy', load: () => import('./candy.js') },
  { id: 'rooftops', load: () => import('./rooftops.js') },
  { id: 'corridor', load: () => import('./corridor.js') },
  { id: 'causeway', load: () => import('./causeway.js') },
  { id: 'hell', load: () => import('./hell.js') },
  { id: 'time', load: () => import('./time.js') },
  { id: 'ocean', load: () => import('./ocean.js') },
  { id: 'frost', load: () => import('./frost.js') },
  { id: 'space', load: () => import('./space.js') },
];
