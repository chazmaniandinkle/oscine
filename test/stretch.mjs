// Stretch/pitch verification: node has no AudioBuffer, so shim the two
// methods stretchBuffer touches. Ground truth by zero-crossing pitch estimate.
import { stretchBuffer, derivedKey } from '../src/engine/stretch.js';

const SR = 44100;
class FakeBuffer {
  constructor(chans, sr) { this._c = chans; this.sampleRate = sr; this.numberOfChannels = chans.length; this.length = chans[0].length; }
  getChannelData(i) { return this._c[i]; }
  copyToChannel(a, i) { this._c[i].set(a); }
}
const ctx = { createBuffer: (n, len, sr) => new FakeBuffer(Array.from({ length: n }, () => new Float32Array(len)), sr) };

function tone(f, sec) { const n = Math.round(sec * SR), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f * i / SR); return new FakeBuffer([x], SR); }
function pitchOf(x) { // zero crossings on the middle 60% (skip vocoder edges)
  const a = Math.floor(x.length * 0.2), b = Math.floor(x.length * 0.8); let z = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) z++;
  return z / ((b - a) / SR);
}
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : '')); if (!ok) fails++; };

const src = tone(220, 2.0);
const s15 = stretchBuffer(ctx, src, { stretch: 1.5 });
check('stretch 1.5x -> length ~1.5x', Math.abs(s15.length / src.length - 1.5) < 0.03, (s15.length / src.length).toFixed(3));
check('stretch 1.5x -> pitch preserved (220 Hz)', Math.abs(pitchOf(s15.getChannelData(0)) - 220) < 4, pitchOf(s15.getChannelData(0)).toFixed(1) + ' Hz');

const p7 = stretchBuffer(ctx, src, { semitones: 7 });
check('+7 st -> length preserved', Math.abs(p7.length / src.length - 1) < 0.03, (p7.length / src.length).toFixed(3));
check('+7 st -> pitch 220*2^(7/12)=329.6', Math.abs(pitchOf(p7.getChannelData(0)) - 329.63) < 6, pitchOf(p7.getChannelData(0)).toFixed(1) + ' Hz');

const m12 = stretchBuffer(ctx, src, { semitones: -12 });
check('-12 st -> 110 Hz', Math.abs(pitchOf(m12.getChannelData(0)) - 110) < 3, pitchOf(m12.getChannelData(0)).toFixed(1) + ' Hz');

const half = stretchBuffer(ctx, src, { stretch: 0.5 });
check('stretch 0.5x -> half length', Math.abs(half.length / src.length - 0.5) < 0.03, (half.length / src.length).toFixed(3));

check('identity params -> same length', stretchBuffer(ctx, src, {}).length === src.length);
check('derivedKey stable + distinct', derivedKey('abc', { stretch: 1.5 }) === derivedKey('abc', { stretch: 1.5 }) && derivedKey('abc', { stretch: 1.5 }) !== derivedKey('abc', { semitones: 1 }));

console.log(fails ? `\n${fails} FAILED` : '\nstretch: all checks passed');
process.exit(fails ? 1 : 0);
