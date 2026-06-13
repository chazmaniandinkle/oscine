// Instrument barrel: importing this module registers every built-in
// instrument. To add your own, create the module and import it here.

import './polysynth.js';
import './fmsynth.js';
import './drumkit.js';

export * from './registry.js';
