import village from './village.js';
import rooftops from './rooftops.js';
import corridor from './corridor.js';
import conservatory from './conservatory.js';
import causeway from './causeway.js';
import forest from './forest.js';
import hell from './hell.js';
import time from './time.js';
import ocean from './ocean.js';
import space from './space.js';

// The worlds always nest inward in this order, and every lap comes back
// round the same way, grouped so each leads into the next:
//   green and growing - the Cypress Lane (the breather, every lap starts on
//     it), the Glasshouse, the Deepwood: day into ever deeper shade;
//   after dark, by lamplight - the Night Rooftops, then down into the
//     endless library of the Hall of Doors;
//   the sun and its eclipse - the Sky Road of the sun, then Hell, where the
//     sun has gone out;
//   out past the world - the Gallery of Hours (heavenly, its sands running
//     out), the sea lapping in through its doorway to the Kelp Deep, and out
//     past the sea, the stars of the Red Drift.
export const WORLD_DEFS = [village, conservatory, forest, rooftops, corridor, causeway, hell, time, ocean, space];
