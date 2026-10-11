import { cc, note, many, keysSeg, seg } from './kit.js';

// AKAI MPK mini mk3 (Chaz's unit, grey edition; photo 2026-10-11). Physical layout, left to right:
//   joystick (top-left) + arpeggiator buttons under it | 8 pads in 2 rows of 4 (PAD 1-4 bottom, 5-8 top) | OLED +
//   pad-mode buttons (BANK A/B, CC, PROG CHANGE, PROG SELECT) over 8 knobs K1-K8 in 2 rows of 4 | 25 keys.
//
// What we know and what we only assume (every number below is the factory default program, NOT yet read off the
// device: verified:false, and each control carries verified:false until the "Check my controller" flow in the
// surface panel has seen the real message):
//   keys   ch1, notes 48..72 at the default octave (OCT -/+ shifts them: a device-local setting)
//   pads   ch10, bank A notes 36..43 (pad 1 = 36), bank B 44..51. Same numbers Oscine's drum-lane mapping expects.
//   knobs  K1..K8 = CC 70..77 on ch1
//   stick  X = pitch bend, Y up = CC1. Y down is NOT claimed (the editor lets each direction be assigned; some
//          programs send CC2): that slot stays empty for the check to fill.
// Buttons marked `local` work inside the controller (arp, tap tempo, octave, full level, note repeat, bank / CC /
// prog modes) and send no MIDI, so Oscine can't see or map them. PROG CHANGE mode makes the pads send program
// change numbers the profile doesn't claim either.
const unv = (controls) => controls.map((c) => (c.src ? { ...c, verified: false } : c));
// `short` is what the cramped surface draws under a pad or knob ("5"); `label` ("PAD 5") is what prompts and titles say.
const shorten = (controls, f) => controls.map((c, i) => ({ ...c, short: f(c, i) }));
const padNotes = (base) => (i) => note(base + i, 10);
const dev = (id, label, title) => ({ id, label, kind: 'button', local: true, ...(title ? { title } : {}) });

const mk3Segments = () => [
  seg('stick', 'stick', 'Joystick', unv([
    { id: 'pb', label: '◂▸', kind: 'pitchbend', src: { t: 'pb' }, title: 'Left / right: pitch bend' },
    { id: 'mod', label: '▲', kind: 'modwheel', src: cc(1), title: 'Up: mod wheel (CC1)' },
    { id: 'moddn', label: '▼', kind: 'modwheel', title: 'Down: not known yet. Check my controller fills it in' },
  ]), { area: 'stick', cols: 3 }),
  seg('arp', 'buttons', 'Arp (device only)', [
    dev('arp', 'Arp', 'ARP ON/OFF'), dev('tap', 'Tap', 'TAP TEMPO'), dev('octm', '−Oct'), dev('octp', 'Oct+'),
    dev('full', 'Full', 'FULL LEVEL'), dev('rep', 'Rpt', 'NOTE REPEAT'),
  ], { area: 'arp', cols: 2, local: true }),
  seg('padmode', 'buttons', 'Pad modes (device only)', [
    dev('bankab', 'A/B', 'BANK A/B: switches the pads between notes 36-43 and 44-51'), dev('ccmode', 'CC'),
    dev('pc', 'PC', 'PROG CHANGE: pads send program change numbers'), dev('psel', 'Sel', 'PROG SELECT'),
  ], { area: 'pmode', cols: 4, local: true }),
  seg('pads', 'pads', 'Pads', shorten(unv(many('p', 'pad', 8, padNotes(36), { labelPrefix: 'PAD ' })), (c, i) => String(i + 1)), { area: 'pads', cols: 4, order: 'mpc', bank: 'A' }),
  seg('pads-b', 'pads', 'Pads', shorten(unv(many('pb', 'pad', 8, padNotes(44), { labelPrefix: 'B·' })), (c, i) => 'B' + (i + 1)), { area: 'pads', cols: 4, order: 'mpc', bank: 'B' }),
  seg('knobs', 'knobs', 'Knobs', shorten(unv(many('k', 'knob', 8, (i) => cc(70 + i), { labelPrefix: 'K' })), (c, i) => String(i + 1)), { area: 'knobs', cols: 4 }),
  keysSeg(48, 72, { ch: 1, area: 'keys' }),
];

const mk3Layout = {
  cols: 'minmax(0, 0.9fr) minmax(0, 2fr) minmax(0, 2fr)',
  areas: ['stick pads pmode', 'stick pads knobs', 'arp pads knobs', 'keys keys keys'],
};

const mpkBase = (id, name, match) => ({
  id, name, maker: 'Akai Professional', match, verified: false,
  source: 'Akai MPK mini factory default program (public manual): default program, verify by discovery',
  layout: mk3Layout,
  segments: mk3Segments(),
});

export const mpkMini3 = mpkBase('akai-mpk-mini-3', 'MPK mini mk3', /mpk\s*mini\s*(3|iii|mk\s*3|mkiii)\b/i);
// mk3 first: the mk2/mk1 pattern would also match "MPK mini 3".
export const mpkMini = mpkBase('akai-mpk-mini', 'MPK mini', /mpk\s*mini(\s*(mk\s*)?(1|2|i|ii))?\b/i);
export default [mpkMini3, mpkMini];
