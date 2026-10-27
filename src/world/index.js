import village from './village.js';
import rooftops from './rooftops.js';
import corridor from './corridor.js';
import conservatory from './conservatory.js';
import causeway from './causeway.js';

// The first lap always nests inward in this order; later laps shuffle.
export const WORLD_DEFS = [village, rooftops, corridor, conservatory, causeway];
