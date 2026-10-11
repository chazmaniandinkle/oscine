import { cc, note, many, keysSeg, seg, pitchMod } from './kit.js';

// AKAI MPK mini. Factory default program (PROG 1 / "MPK3 default"): keys ch1; 8 pads on ch10; 8 knobs K1..K8 =
// CC70..77 on ch1; joystick X = pitch bend, Y = CC1. Sources: the published default-program tables (not the
// device in Chaz's hands yet: verified:false). Pad notes follow the MPC layout (bottom row 36..39, top row 40..43,
// bank B 44..51), which is also what Oscine's drum-lane mapping (note 36 = first lane) expects.
const padNotes = (base) => (i) => note(base + i, 10);
const mpkBase = (id, name, match) => ({
  id, name, maker: 'Akai Professional', match, verified: false,
  source: 'Akai MPK mini factory default program (public manual)',
  segments: [
    pitchMod({ label: 'Joystick' }),
    seg('knobs', 'knobs', 'Knobs', many('k', 'knob', 8, (i) => cc(70 + i), { labelPrefix: 'K' }), { cols: 4 }),
    seg('pads', 'pads', 'Pads (bank A)', many('p', 'pad', 8, padNotes(36), { labelPrefix: 'P' }), { cols: 4, order: 'mpc' }),
    seg('pads-b', 'pads', 'Pads (bank B)', many('pb', 'pad', 8, padNotes(44), { labelPrefix: 'B' }), { cols: 4, order: 'mpc', collapsed: true }),
    keysSeg(48, 72, { ch: 1 }),
  ],
});

export const mpkMini3 = mpkBase('akai-mpk-mini-3', 'MPK mini mk3', /mpk\s*mini\s*(3|iii|mk\s*3|mkiii)\b/i);
// mk3 first: the mk2/mk1 pattern would also match "MPK mini 3".
export const mpkMini = mpkBase('akai-mpk-mini', 'MPK mini', /mpk\s*mini(\s*(mk\s*)?(1|2|i|ii))?\b/i);
export default [mpkMini3, mpkMini];
