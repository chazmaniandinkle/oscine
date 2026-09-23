// Effects barrel: importing this registers every built-in effect with the
// registry. Add a module here and it appears in the insert menu.
import './eq3.js';
import './resofilter.js';
import './saturator.js';
import './stereodelay.js';
import './algoreverb.js';
import './chorus.js';
import './phaser.js';
// dynamics (compressor / limiter / gate / utility) land next.

export * from './registry.js';
