import { cc, note, many, keysSeg, seg, pitchMod } from './kit.js';

// Novation Launchkey Mini mk3. In its default (non-InControl) mode: 8 knobs CC21..28 on ch1, pads on ch10 notes
// 36..43 / 44..51 (drum layout), pitch bend + mod wheel strips. Transport/track buttons are InControl-only (they
// stay silent on the standard port), so the layout leaves them out. verified:false: published values.
const launchkeyMini3 = {
  id: 'novation-launchkey-mini-3', name: 'Launchkey Mini mk3', maker: 'Novation', match: /launchkey\s*mini(\s*(mk\s*)?3|\s*iii)?/i, verified: false,
  source: 'Novation Launchkey Mini MK3 programmer reference (default mode)',
  segments: [
    pitchMod({ label: 'Touch strips' }),
    seg('knobs', 'knobs', 'Knobs', many('k', 'knob', 8, (i) => cc(21 + i, 1), { labelPrefix: 'K' }), { cols: 4 }),
    seg('pads', 'pads', 'Pads', many('p', 'pad', 16, (i) => note(36 + i, 10), { labelPrefix: 'P' }), { cols: 4, order: 'mpc' }),
    keysSeg(48, 72),
  ],
};
export default [launchkeyMini3];
