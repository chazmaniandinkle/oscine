import { cc, note, many, keysSeg, seg, pitchMod } from './kit.js';

// Arturia. Factory "DAW/Analog Lab" templates differ between firmwares and the MiniLab's encoders are user-configurable
// in MIDI Control Center, so only the layout (what is there, in what rows) is claimed here: controls without a `src`
// are slots the wizard fills from the first message each one sends. verified:false throughout.
const minilab3 = {
  id: 'arturia-minilab-3', name: 'MiniLab 3', maker: 'Arturia', match: /minilab\s*(3|iii|mk\s*3)/i, verified: false,
  source: 'Arturia MiniLab 3 layout (public manual); CC numbers left for the wizard',
  segments: [
    pitchMod({ label: 'Touch strips' }),
    seg('knobs', 'encoders', 'Encoders', many('e', 'encoder', 8, null, { labelPrefix: 'E', rel: 'binoff' }), { cols: 4 }),
    seg('faders', 'faders', 'Faders', many('f', 'fader', 4, null, { labelPrefix: 'F', strip: true }), { cols: 4 }),
    seg('pads', 'pads', 'Pads', many('p', 'pad', 8, (i) => note(36 + i, 10), { labelPrefix: 'P' }), { cols: 4, order: 'mpc' }),
    keysSeg(48, 72),
  ],
};
const keystep = {
  id: 'arturia-keystep', name: 'KeyStep', maker: 'Arturia', match: /key\s*step/i, verified: false,
  source: 'Arturia KeyStep layout (public manual)',
  segments: [
    pitchMod({ label: 'Touch strips' }),
    seg('buttons', 'buttons', 'Transport', [
      { id: 'play', label: 'Play', kind: 'button', role: 'transport.toggle' },
      { id: 'rec', label: 'Rec', kind: 'button', role: 'transport.record' },
    ], { cols: 2 }),
    keysSeg(48, 84),
  ],
};
export default [minilab3, keystep];
