// Instrument barrel: importing this module registers every built-in
// instrument. To add your own, create the module and import it here.

import './polysynth.js';
import './fmsynth.js';
import './drumkit.js';
import './reese.js';
import './breaks.js';
import './atmos.js';
import './gb.js';

export * from './registry.js';
