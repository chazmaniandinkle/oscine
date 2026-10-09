// Game Boy timbre tables. Built-ins here are generic (textbook shapes, not
// taken from any game). If tools/gb-extract.mjs has been run, the local
// gbdata.game.js (gitignored) adds the wave tables and drum register
// sequences of the games we have disassemblies of (Pokemon Crystal, Zelda
// Oracles), keyed 'crystal:<n>' / 'oracles:<id>:<name>' / 'crystal:<Drum>'.

const ramp = (f) => Array.from({ length: 32 }, (_, i) => Math.max(0, Math.min(15, Math.round(f(i / 32)))));
export const BUILTIN_WAVES = {
  'triangle': ramp(x => 15 * (x < 0.5 ? 2 * x : 2 - 2 * x)),
  'saw': ramp(x => 15 * x),
  'square50': ramp(x => (x < 0.5 ? 15 : 0)),
  'sine': ramp(x => 7.5 + 7.5 * Math.sin(2 * Math.PI * x)),
  'bass-bump': ramp(x => (x < 0.25 ? 15 * x * 4 : x < 0.5 ? 15 : x < 0.75 ? 15 * (3 - 4 * x) : 0)),
};
// Drum steps: frames (at 60 Hz) each, then the last step rings out.
//   vol 0-15, envPeriod 0-7 (0 = hold), envUp, nr43 = clock shift <<4 | width7 <<3 | divisor code
export const BUILTIN_DRUMS = {
  kick: [{ frames: 1, vol: 15, envPeriod: 1, nr43: 0x6b }, { frames: 2, vol: 12, envPeriod: 1, nr43: 0x50 }],
  snare: [{ frames: 1, vol: 13, envPeriod: 2, nr43: 0x33 }],
  hat: [{ frames: 1, vol: 9, envPeriod: 1, nr43: 0x10 }],
  ohat: [{ frames: 1, vol: 9, envPeriod: 4, nr43: 0x11 }],
  metal: [{ frames: 1, vol: 10, envPeriod: 2, nr43: 0x18 }], // 7-bit LFSR: tonal, the metallic GB hat
  crash: [{ frames: 1, vol: 12, envPeriod: 6, nr43: 0x22 }],
};

let game = { waves: {}, drums: {}, oraclesNoise: [] };
try { game = (await import('./gbdata.game.js')).default; } catch { /* not extracted: built-ins only */ }
export const GAME = game;
export const WAVES = { ...BUILTIN_WAVES, ...game.waves };
export const DRUMS = { ...BUILTIN_DRUMS, ...game.drums };
