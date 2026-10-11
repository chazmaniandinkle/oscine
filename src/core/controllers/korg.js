import { cc, many, keysSeg, seg, pitchMod } from './kit.js';

// Korg nanoKONTROL2 in its factory CC mode: 8 strips of fader CC0..7, knob CC16..23, S/M/R buttons CC32..39 / 48..55 /
// 64..71 (all ch1), transport Play 41 / Stop 42 / Rew 43 / FF 44 / Rec 45 / Cycle 46. Buttons send 127 on press and 0 on
// release. verified:false: published values (Korg's Kontrol Editor can remap everything).
const strips = (prefix, kind, base, label, extra = {}) =>
  many(prefix, kind, 8, (i) => cc(base + i, 1), { labelPrefix: label, strip: true, ...extra });
const nano2 = {
  id: 'korg-nanokontrol2', name: 'nanoKONTROL2', maker: 'Korg', match: /nano\s*kontrol\s*(2|ii)?/i, verified: false,
  source: 'Korg nanoKONTROL2 factory CC assignments (public manual)',
  segments: [
    seg('knobs', 'knobs', 'Knobs', strips('k', 'knob', 16, 'K'), { cols: 8 }),
    seg('faders', 'faders', 'Faders', strips('f', 'fader', 0, 'F'), { cols: 8 }),
    seg('solo', 'buttons', 'Solo', strips('s', 'button', 32, 'S', { role: 'strip.solo' }), { cols: 8 }),
    seg('mute', 'buttons', 'Mute', strips('m', 'button', 48, 'M', { role: 'strip.mute' }), { cols: 8 }),
    seg('rec', 'buttons', 'Rec', strips('r', 'button', 64, 'R', { role: 'strip.arm' }), { cols: 8 }),
    seg('transport', 'buttons', 'Transport', [
      { id: 'rew', label: '◀◀', kind: 'button', src: cc(43, 1), role: 'transport.rewind' },
      { id: 'ff', label: '▶▶', kind: 'button', src: cc(44, 1), role: 'transport.ffwd' },
      { id: 'stop', label: '■', kind: 'button', src: cc(42, 1), role: 'transport.stop' },
      { id: 'play', label: '▶', kind: 'button', src: cc(41, 1), role: 'transport.toggle' },
      { id: 'record', label: '●', kind: 'button', src: cc(45, 1), role: 'transport.record' },
      { id: 'cycle', label: 'Cycle', kind: 'button', src: cc(46, 1), role: 'transport.loop' },
    ], { cols: 6 }),
  ],
};

// Korg microKEY (original/Air): keys only, plus pitch bend / modulation, sustain pedal CC64. Key count varies (25/37/49/61).
const microkey = {
  id: 'korg-microkey', name: 'microKEY', maker: 'Korg', match: /micro\s*key/i, verified: false,
  source: 'Korg microKEY (public manual)',
  segments: [
    pitchMod({ label: 'Pitch / Mod' }),
    seg('pedal', 'buttons', 'Pedal', [{ id: 'sustain', label: 'Sustain', kind: 'button', src: cc(64) }], { cols: 1 }),
    keysSeg(48, 84),
  ],
};
export default [nano2, microkey];
