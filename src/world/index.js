import village from './village.js';
import rooftops from './rooftops.js';
import corridor from './corridor.js';
import conservatory from './conservatory.js';
import causeway from './causeway.js';
import forest from './forest.js';
import hell from './hell.js';
import time from './time.js';
import ocean from './ocean.js';

// The first lap always nests inward in this order; later laps shuffle.
export const WORLD_DEFS = [village, forest, rooftops, corridor, conservatory, causeway, hell, time, ocean];
